/* ============================================================
 * TTSManager —— 剧情对话语音播放器
 *
 * 要解决的核心问题是「不能让玩家感觉到磕磕绊绊」。
 * 单句在线合成实测要 1.4~2.6 秒，如果等到该说话了才去合成，
 * 每一句前面都会卡一下，剧情就废了。这里的对策是三层预取：
 *
 *   第一层  当前句：已经解码、正在从 <audio> 里响
 *   第二层  下一句：当前句开口的同时，下一句的 MP3 已经从服务器下载完并预解码
 *   第三层  余下句：一进入剧情节点就把整个节点的句子全部提交后台批量合成
 *
 * 再加上浏览器 + 服务端两级缓存（同一句第二次进入是 0ms），
 * 实际游玩时绝大多数句子都是「已经准备好了」的状态。
 *
 * 另一条底线：**语音出问题绝不影响剧情推进**。
 * 任何一句拿不到音频就静默跳过，打字机照常走。
 * ============================================================ */

const TTSManager = {
    // ---------- 可调配置（localStorage 持久化） ----------
    enabled: true,      // 总开关
    volume: 0.9,        // 音量 0~1
    autoAdvance: false, // 语音播完后是否自动进入下一句

    // ---------- 运行时状态 ----------
    _lines: [],         // 当前节点的句子清单 [{key,url,duration_ms,text,speaker_name,node_id,order_index}]
    _byKey: {},         // key -> line，查句用
    _prepSeq: 0,        // 节点切换的世代号：旧世的异步结果必须丢弃，否则会串音
    _cur: null,         // 当前在播的那句
    _els: [],           // 双 <audio> 缓冲元素
    _activeIdx: 0,      // 当前正在发声的元素下标（A/B 交替）
    _preloaders: {},    // key -> Audio()，给后续句子做静默预下载
    _ready: false,      // 后端是否预热过
    _lastError: '',

    STORE_KEY: 'rpg_tts_settings',

    init() {
        this._loadSettings();
        this._buildAudioElements();
        this._bindUi();
        // 预热放在后台，不阻塞首屏：目的只是把服务端的冷启动成本提前付掉
        setTimeout(() => this.warmup(), 300);
    },

    // ======================= 配置持久化 =======================
    _loadSettings() {
        try {
            const raw = localStorage.getItem(this.STORE_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                if (typeof s.enabled === 'boolean') this.enabled = s.enabled;
                if (typeof s.volume === 'number') this.volume = s.volume;
                if (typeof s.autoAdvance === 'boolean') this.autoAdvance = s.autoAdvance;
            }
        } catch (e) { /* 隐私模式可能禁用 localStorage，用默认值即可 */ }
    },
    _saveSettings() {
        try {
            localStorage.setItem(this.STORE_KEY, JSON.stringify({
                enabled: this.enabled, volume: this.volume, autoAdvance: this.autoAdvance,
            }));
        } catch (e) { /* 忽略 */ }
    },

    // ======================= 预热 =======================
    async warmup() {
        try {
            const r = await API.post('/tts/warmup', {});
            this._ready = true;
            console.log('[TTS] 引擎预热完成', r.elapsed_ms + 'ms', 'ffmpeg=' + r.ffmpeg);
            return r;
        } catch (e) {
            // 预热失败不影响使用：真正用到时还会再试一次
            this._lastError = '预热失败：' + e.message;
            console.warn('[TTS]', this._lastError);
            return null;
        }
    },

    // ======================= 音频元素 =======================
    _buildAudioElements() {
        // 两个元素轮流用：一个在发声时，另一个可以无干扰地 load 下一句。
        // 只用一个元素的话，切 src 必然产生一次撕裂式停顿。
        this._els = [0, 1].map(() => {
            const a = new Audio();
            a.preload = 'auto';
            a.volume = this.volume;
            return a;
        });
        this._els.forEach((el, i) => {
            el.addEventListener('ended', () => this._onEnded(i));
            el.addEventListener('error', () => {
                // 单个音频加载失败不能让整套语音挂掉，静默跳过即可
                console.warn('[TTS] 音频播放出错，跳过该句');
            });
        });
    },

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        this._els.forEach(el => { el.volume = this.volume; });
        this._saveSettings();
        this._syncUi();
    },
    setEnabled(on) {
        this.enabled = !!on;
        if (!this.enabled) this.stopAll();
        this._saveSettings();
        this._syncUi();
    },
    setAutoAdvance(on) {
        this.autoAdvance = !!on;
        this._saveSettings();
        this._syncUi();
    },

    // ======================= 第三层：按节点批量预合成 =======================
    /**
     * 进入剧情节点时调用。一次性把整节点（可含多个节点）的句子全部合成好。
     * @param {number[]} nodeIds
     * @param {(done:number,total:number)=>void} onProgress  装载进度回调
     * @returns {Promise<number>} 就绪的句子数
     */
    async prepareNodes(nodeIds, onProgress) {
        if (!this.enabled || !nodeIds || !nodeIds.length) return 0;
        const seq = ++this._prepSeq;
        this._lines = [];
        this._byKey = {};
        try {
            if (typeof onProgress === 'function') onProgress(0, 0);
            const res = await API.post('/tts/nodes', { node_ids: nodeIds });
            // 节点已经切走了（玩家点了跳过），这批结果作废
            if (seq !== this._prepSeq) return 0;

            const items = (res.items || []).filter(it => it && it.url);
            this._lines = items;
            this._byKey = {};
            items.forEach(it => { this._byKey[it.key] = it; });

            // 让浏览器先把前几句下载下来——服务端合成完不等于客户端能立刻播
            this._preloadAhead(0, Math.min(3, items.length));
            if (typeof onProgress === 'function') onProgress(items.length, items.length);
            return items.length;
        } catch (e) {
            this._lastError = '语音预载失败：' + e.message;
            console.warn('[TTS]', this._lastError);
            return 0;
        }
    },

    /** 一句话 Line 是否已经有音频 */
    has(key) {
        return !!(this._byKey[key] && this._byKey[key].url);
    },

    getLine(key) {
        return this._byKey[key] || null;
    },

    /**
     * 对话 key 的构造规则，必须与后端一致：
     *   有 dialogue 记录的句子 -> `dialogue-{dialogue_id}`
     *   旧式单句节点          -> `node-{node_id}`
     */
    keyFor(dialogueId, nodeId) {
        return dialogueId ? `dialogue-${dialogueId}` : `node-${nodeId}`;
    },

    // ======================= 第二层：前瞻预下载 =======================
    _preloadAhead(fromIdx, count) {
        for (let i = fromIdx; i < fromIdx + count && i < this._lines.length; i++) {
            const line = this._lines[i];
            if (!line || !line.url || this._preloaders[line.key]) continue;
            // 用一个不发声的 Audio 触发下载，浏览器会把文件塞进 HTTP 缓存，
            // 之后真正轮到它播放时几乎没有等待。
            const a = new Audio();
            a.preload = 'auto';
            a.src = line.url;
            this._preloaders[line.key] = a;
        }
    },

    // ======================= 第一层：播放 =======================
    /**
     * 播放一句。
     * @param {string} key
     * @returns {{duration_ms:number, ok:boolean}}
     */
    play(key) {
        const info = { duration_ms: 0, ok: false };
        if (!this.enabled) return info;
        const line = this._byKey[key];
        if (!line || !line.url) return info;   // 没音频就静默跳过，剧情继续
        info.duration_ms = line.duration_ms || 0;

        try {
            // A/B 交替：先停另一个，再用当前下标的元素
            const idx = this._activeIdx;
            const el = this._els[idx];
            this._activeIdx = 1 - idx;
            this.pause(idx);
            el.src = line.url;
            el.volume = this.volume;
            el.currentTime = 0;
            const p = el.play();
            if (p && typeof p.catch === 'function') {
                // 浏览器可能因未交互而拒绝自动播放；这不是错误，忽略即可
                p.catch(() => {});
            }
            this._cur = { key, el, idx };
            info.ok = true;

            // 同时把后面 3 句提前下载起来
            const i = this._lines.indexOf(line);
            if (i >= 0) this._preloadAhead(i + 1, 3);
        } catch (e) {
            console.warn('[TTS] 播放失败', e);
        }
        return info;
    },

    pause(idx) {
        const el = typeof idx === 'number' ? this._els[idx] : null;
        const targets = el ? [el] : this._els;
        targets.forEach(a => { try { a.pause(); } catch (e) { /* ignore */ } });
    },

    /** 立即停掉当前语音（玩家点了「下一句」时用） */
    stopCurrent() {
        if (!this._cur) return;
        try { this._cur.el.pause(); this._cur.el.currentTime = 0; } catch (e) { /* ignore */ }
        this._cur = null;
    },

    stopAll() {
        this._els.forEach(a => { try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ } });
        this._cur = null;
    },

    isPlaying() {
        return !!this._cur && !this._cur.el.paused;
    },

    _onEnded(idx) {
        if (!this._cur || this._cur.idx !== idx) return;
        const key = this._cur.key;
        this._cur = null;
        if (typeof this.onLineEnded === 'function') {
            try { this.onLineEnded(key); } catch (e) { console.warn(e); }
        }
    },

    // 语音结束回调：由 dialogue.js 挂载，用于「自动播放下一句」
    onLineEnded: null,

    // ======================= 单句兜底合成 =======================
    /** 某句没走到批量预取（比如临场插入的台词），临时补一次合成 */
    async synthNow(text, key, opts = {}) {
        if (!this.enabled || !text) return null;
        try {
            const res = await API.post('/tts/synth', {
                text, character_id: opts.characterId || null, gender: opts.gender || 'unknown',
            });
            if (res && res.url) {
                const line = {
                    key, url: res.url, duration_ms: res.duration_ms || 0,
                    text, speaker_name: opts.speakerName || '',
                };
                this._byKey[key] = line;
                // 塞进队列末尾，保证后续 prefetch 能找到它
                if (!this._lines.some(l => l.key === key)) this._lines.push(line);
                return line;
            }
        } catch (e) {
            console.warn('[TTS] 单句合成失败', e);
        }
        return null;
    },

    // ======================= UI =======================
    _bindUi() {
        // 控制面板由 injectUi 动态插入，事件用委托，避免注入时机问题
        document.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-tts-action]');
            if (!btn) return;
            ev.stopPropagation();
            const act = btn.getAttribute('data-tts-action');
            if (act === 'toggle') this.setEnabled(!this.enabled);
            else if (act === 'auto') this.setAutoAdvance(!this.autoAdvance);
            else if (act === 'vol-down') this.setVolume(Math.max(0, +(this.volume - 0.1).toFixed(2)));
            else if (act === 'vol-up') this.setVolume(Math.min(1, +(this.volume + 0.1).toFixed(2)));
        });
        document.addEventListener('input', (ev) => {
            if (ev.target && ev.target.id === 'tts-volume-range') {
                this.setVolume(parseFloat(ev.target.value) / 100);
            }
        });
    },

    injectUi(hostSel) {
        if (document.querySelector('#tts-control')) return;
        const host = document.querySelector(hostSel) || document.body;
        const box = document.createElement('div');
        box.id = 'tts-control';
        box.innerHTML = `
            <button data-tts-action="toggle" class="tts-btn" id="tts-toggle" title="开关人物语音">
                <span id="tts-toggle-icon">◉</span>
            </button>
            <div class="tts-panel" id="tts-panel">
                <div class="tts-row">
                    <span>人物语音</span>
                    <button data-tts-action="toggle" class="tts-mini" id="tts-switch">开</button>
                </div>
                <div class="tts-row">
                    <span>自动播放</span>
                    <button data-tts-action="auto" class="tts-mini" id="tts-auto">关</button>
                </div>
                <div class="tts-row">
                    <span>音量</span>
                    <input type="range" id="tts-volume-range" min="0" max="100" value="90">
                </div>
                <div class="tts-row tts-hint" id="tts-hint"></div>
            </div>`;
        host.appendChild(box);
        // 整条面板在点不到的时候自动收起
        box.addEventListener('mouseleave', () => box.classList.remove('open'));
        this._syncUi();
        return box;
    },

    _syncUi() {
        const icon = document.querySelector('#tts-toggle-icon');
        const sw = document.querySelector('#tts-switch');
        const au = document.querySelector('#tts-auto');
        const rg = document.querySelector('#tts-volume-range');
        const box = document.querySelector('#tts-control');
        if (icon) icon.textContent = this.enabled ? '◉' : '◌';
        if (box) box.classList.toggle('muted', !this.enabled);
        if (sw) sw.textContent = this.enabled ? '开' : '关';
        if (au) au.textContent = this.autoAdvance ? '开' : '关';
        if (rg) rg.value = Math.round(this.volume * 100);
    },

    /** 语音装载提示：在玩家等待合成的地方显示「语音准备中 n/m」 */
    showLoading(done, total, elId) {
        const el = document.querySelector(elId || '#tts-hint');
        if (!el) return;
        if (!this.enabled) { el.textContent = '语音已关闭'; return; }
        if (!total) { el.textContent = '语音准备中…'; return; }
        el.textContent = done >= total
            ? `语音就绪 ${total}/${total}`
            : `语音准备中 ${done}/${total}`;
    },

    /**
     * 把一段音频时长换算成打字机的每字毫秒数。
     * 目的是让「字打完」和「话说完」尽量同步，这是口语节奏感的关键。
     * 必须 clamp：一句 31 秒的超长台词如果真的按 1200ms/字 去打，玩家会以为死了。
     */
    typingSpeedFor(durationMs, charCount) {
        if (!durationMs || !charCount) return null;
        const raw = durationMs / charCount;
        return Math.max(28, Math.min(110, Math.round(raw)));
    },
};

// 尽早初始化，但要等 DOM 就绪再挂 UI
(function () {
    function boot() {
        TTSManager.init();
        TTSManager.injectUi('#dialogue-overlay');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
