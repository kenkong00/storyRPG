// ========== 对话系统UI（慢速默认，点击加速，完成才可继续） ==========

const DialogueUI = {
    expressions: {
        normal: '平静', happy: '微笑', angry: '愤怒', sad: '悲伤',
        surprised: '惊讶', arrogant: '狂傲', defeated: '战败',
        jealous: '妒忌', regretful: '悔恨', crying: '哭泣',
        begging: '求饶', confident: '自信', shocked: '震惊',
        desperate: '绝望', determined: '坚定',
    },

    currentNodeId: null,
    callback: null,
    currentAudio: null,
    pendingBattleNode: null, // 战斗节点：读完台词后点击进入战斗

    // ===== 对话列表（一个节点多句对白） =====
    _lines: [],
    _lineIndex: -1,
    _nodeChoices: [],
    _nodeFinished: false, // 本节点所有对白已读完，等玩家点击才收尾
    _removeQueue: [],     // 说完即消失的角色（下一句开始时移除）
    currentNodeData: null,

    // ===== 立绘舞台参数 =====
    STAGE_BASE_RATIO: 0.85, // 立绘基准高度 = 舞台高 × 该比例 × scale
    LEGACY_SCALE: 0.5,      // 旧节点（无对话列表）默认缩放，视觉接近原来的 44vh
    POS_LEGACY_MAP: {
        'left-1': 12, 'left-2': 25, 'left-3': 38, 'left': 25,
        'center': 50, 'first_person': 50,
        'right-1': 88, 'right-2': 75, 'right-3': 62, 'right': 75,
    },

    // ===== 舞台焦点：说话者突出 / 其他人变暗 =====
    // 默认 off：不做任何提亮 / 发光 / 变暗，立绘按原色调显示。
    // 强度档位（subtle / normal / strong）可在游戏内「设置 → 画面特效」切换。
    FOCUS_PRESETS: {
        // 关闭：无任何滤镜（原色调、无辉光、不变暗）
        off: { dim: '', speak: '' },
        // 说明：只做「变暗」，不做透明（透明会让立绘和背景叠在一起，看不清边界）
        subtle: { dim: 'brightness(.85) saturate(.9)', speak: 'brightness(1.06)' },
        normal: { dim: 'brightness(.72) saturate(.8)', speak: 'brightness(1.12) saturate(1.05)' },
        strong: { dim: 'brightness(.6) saturate(.72) blur(.5px)', speak: 'brightness(1.18) saturate(1.12) drop-shadow(0 0 16px rgba(212,175,55,.45))' },
    },
    get focusStyle() {
        const key = (typeof localStorage !== 'undefined' && localStorage.getItem('rpg_stage_focus')) || 'off';
        return this.FOCUS_PRESETS[key] || this.FOCUS_PRESETS.off;
    },

    // 说完即消失：渐隐退场时长（ms），需与 CSS .stage-char.leaving 的 transition 保持一致
    LEAVE_FADE_MS: 1000,

    // 打字机状态
    _typingTimer: null,
    _typingText: '',
    _typingEl: null,
    _typingIndex: 0,
    _isTypingFinished: false,
    _resolveTyping: null,
    _typingMode: 'idle', // 'idle' | 'slow' | 'fast' | 'done'

    // 显示对话节点
    async showNode(nodeId, callback) {
        this.callback = callback;
        const full = await GameState.loadNode(nodeId);
        if (!full) return;

        Utils.hide('#choices-container');
        Utils.hide('#combat-actions');
        Utils.hide('#dialogue-indicator');
        Utils.show('#dialogue-box');
        GameState.isInDialogue = true;

        const node = full.node;
        this.currentNodeId = node.id;
        this.currentNodeData = node;
        this._nodeChoices = full.choices || [];

        // === 优先设置场景背景（在说话者和表情之前，避免黑屏间隙） ===
        const overlay = document.querySelector('#bg-overlay');
        if (overlay) {
            overlay.style.background = '';
            overlay.style.transition = '';
        }
        if (node.background_change) {
            this.changeBackground(node.background_change, node.bg_animation_effect_id || null);
        } else if (node.scene_id) {
            try {
                const scene = await API.scenes.get(node.scene_id);
                Utils.setSceneBg(scene.scene_type, scene.background_image);
            } catch (e) {}
        }

        // 处理音乐
        if (node.bgm) this.playMusic(node.bgm);

        // ===== 新：对话列表（一个节点多句对白） =====
        const lines = (full.dialogues || []).filter(d => d && (d.content || d.speaker_id));
        if (lines.length > 0) {
            this._lines = lines;
            this._lineIndex = -1;
            this._nodeFinished = false;
            this._removeQueue = [];
            this.clearStage();

            // 语音第三层预取：进入节点就把整个节点的台词提交合成。
            // 不等它完成——先让画面和第一句起来，音频在后台陆续到位。
            // 但会显示装载进度，玩家知道「正在准备语音」而不是「卡住了」。
            this._prepareNodeVoice(node.id);

            await this._playLine();
            return;
        }

        // ===== 兼容：旧单句模式（无对话列表） =====
        this._lines = [];
        this._lineIndex = -1;
        this._nodeFinished = true; // 单句读完同样等玩家点击

        // 显示说话者
        const speakerName = await this.getSpeakerName(node.speaker_id);
        Utils.setText('#speaker-name', speakerName || '旁白');

        // 显示表情（支持单人和多人）
        await this.renderExpressions(node);

        // 旧式单句节点也要出声
        await this._speakLine({ id: null, content: node.content || '', speaker_id: node.speaker_id });

        // 打字机显示对话（默认慢速，点击加速）
        this._isTypingFinished = false;
        this._typingMode = 'idle';
        await this._typeTextSlow('#dialogue-text', node.content || '', this._speechTypingSpeed);

        // 打字完成，显示指示器
        this._isTypingFinished = true;

        // === 战斗节点：先把挑衅台词显示完，再等玩家点击进入战斗 ===
        if (node.node_type === 'battle') {
            this.pendingBattleNode = node;
            Utils.hide('#choices-container');
            Utils.show('#dialogue-indicator');
            return;
        }

        Utils.show('#dialogue-indicator');

        // 如果是选择节点，显示选项
        if (node.node_type === 'choice' && full.choices.length > 0) {
            this.showChoices(full.choices);
        }
    },

    /**
     * 节点级语音预载（第三层预取）。
     *
     * 刻意不 await：如果在这里死等 9 句话全部合成完（实测约 4.7s），
     * 玩家会觉得游戏卡住了。做法是让它自己在后台跑，
     * 第一句由 _speakLine 里的单句兜底合成来救急，
     * 后面的句子则在轮到之前就已经躺在缓存里了。
     */
    _prepareNodeVoice(nodeId) {
        if (typeof TTSManager === 'undefined') return;

        // 自动播放：语音播完后替玩家点一次，间隔留够，避免句子贴脸相接
        if (!TTSManager.onLineEnded) {
            TTSManager.onLineEnded = () => {
                if (!TTSManager.autoAdvance) return;
                setTimeout(() => {
                    if (GameState.isInDialogue && !GameState.isInCombat) {
                        try { this.handleClick(); } catch (e) { /* ignore */ }
                    }
                }, 450);
            };
        }

        this._voicePrepareSeq = (this._voicePrepareSeq || 0) + 1;
        const seq = this._voicePrepareSeq;
        TTSManager.prepareNodes([nodeId], (done, total) => {
            // 玩家已经翻页了就别再更新 UI
            if (seq !== this._voicePrepareSeq) return;
            TTSManager.showLoading(done, total, '#tts-hint');
        }).then(n => {
            if (seq === this._voicePrepareSeq && n > 0) {
                console.log('[TTS] 节点语音就绪', n, '句 node=' + nodeId);
            }
        }).catch(() => { /* 预载失败不影响剧情 */ });
    },

    // ===== 对话列表：逐句播放 =====
    async _playLine() {
        const idx = ++this._lineIndex;
        if (idx >= this._lines.length) {
            await this._finishNode();
            return;
        }

        const line = this._lines[idx];
        const node = this.currentNodeData;

        Utils.hide('#choices-container');
        Utils.hide('#dialogue-indicator');

        // 上一句标记「说完消失」的角色，此刻退场
        this._flushRemoveQueue();

        // 本句背景 / 音乐（可选覆盖）
        if (line.bg_change) {
            this.changeBackground(line.bg_change, node?.bg_animation_effect_id || null);
        }
        if (line.bgm) this.playMusic(line.bgm);

        // 说话者（顺带缓存到 line 上，语音兜底合成时要带名字）
        const speakerName = line.speaker_id ? await this.getSpeakerName(line.speaker_id) : null;
        line.__speakerName = speakerName || '旁白';
        Utils.setText('#speaker-name', line.__speakerName);

        // 立绘（坐标 / 缩放 / 裁剪）
        await this.renderStage(line);

        // ===== 语音：让当前发言的角色开口，并把打字速度对齐到音频时长 =====
        await this._speakLine(line);

        // 打字机（速度已由语音时长换算，无语音时用默认的 50ms/字）
        this._isTypingFinished = false;
        this._typingMode = 'idle';
        await this._typeTextSlow('#dialogue-text', line.content || '', this._speechTypingSpeed);
        this._isTypingFinished = true;

        // 最后一句也要等玩家点击才收尾（不再自动跳下一节点）
        if (idx >= this._lines.length - 1) {
            this._nodeFinished = true;
        }
        Utils.show('#dialogue-indicator');

        // 该角色说完这句就退场 → 排到退场队列，下一次点击时移除
        if (line.disappear_after && line.speaker_id) {
            this._removeQueue.push(line.speaker_id);
        }
    },

    /**
     * 让一句话「说出来」。
     *
     * 这里刻意不返回 Promise 去等语音播完——打字完成后对话框就该交还给玩家，
     * 语音可以继续在背景响。若真的等它播完，快读的玩家会被按在这里动不了。
     * 返回值通过 this._speechTypingSpeed 传递打字速度。
     */
    async _speakLine(line) {
        this._speechTypingSpeed = 50;      // 默认
        this._currentLineKey = null;
        if (typeof TTSManager === 'undefined' || !TTSManager.enabled) return;

        const key = TTSManager.keyFor(line.id, this.currentNodeId);
        this._currentLineKey = key;

        let res = TTSManager.play(key);
        if (!res.ok) {
            // 这句没被批量预取到（节点刚进来还没预热完、或是新加的台词），现场补一次
            const tmp = await TTSManager.synthNow(line.content || '', key, {
                characterId: line.speaker_id,
                speakerName: line.__speakerName || '',
            });
            if (tmp) res = TTSManager.play(key);
        }
        const text = line.content || '';
        this._speechTypingSpeed =
            TTSManager.typingSpeedFor(res.duration_ms, text.length) || 50;
    },

    /** 提供给 _playLine 用：把说话人名字提前算出来，语音兜底时要用 */
    async _resolveSpeakerName(speakerId) {
        return await this.getSpeakerName(speakerId);
    },

    // 移除退场队列里的角色立绘
    _flushRemoveQueue() {
        if (!this._removeQueue || !this._removeQueue.length) return;
        const layer = document.querySelector('#expression-layer');
        if (layer) {
            for (const cid of this._removeQueue) {
                const el = layer.querySelector(`.stage-char[data-char-id="${cid}"]`);
                if (!el) continue;
                el.classList.remove('show');
                el.classList.remove('speaking', 'dimmed');
                el.style.filter = 'none';
                el.classList.add('leaving');
                el.__leaveTimer = setTimeout(() => el.remove(), this.LEAVE_FADE_MS);
            }
        }
        this._removeQueue = [];
    },

    // 节点内所有对白播完后的收尾（由玩家点击触发）
    async _finishNode() {
        const node = this.currentNodeData;
        if (!node) return;

        this._flushRemoveQueue();

        if (node.node_type === 'battle') {
            this.pendingBattleNode = node;
            Utils.hide('#choices-container');
            Utils.show('#dialogue-indicator');
            return;
        }
        if (node.node_type === 'choice' && this._nodeChoices.length > 0) {
            this.showChoices(this._nodeChoices);
            return;
        }
        Utils.show('#dialogue-indicator');
        if (this.callback) this.callback({ nextAfter: this.currentNodeId });
    },

    // 由对话/选择 进入战斗节点
    async startPendingBattle() {
        const node = this.pendingBattleNode;
        this.pendingBattleNode = null;
        if (!node) return false;
        Utils.hide('#dialogue-indicator');
        if (typeof App !== 'undefined' && typeof App.handleBattleNode === 'function') {
            await App.handleBattleNode(node);
            return true;
        }
        if (typeof CombatUI !== 'undefined') {
            const ids = node.speaker_id ? [node.speaker_id] : [];
            await CombatUI.startBattle(ids.length ? ids : [2], node.id);
            return true;
        }
        return false;
    },

    // === 多人表情渲染（旧单句模式兼容：固定站位 → 百分比坐标） ===
    async renderExpressions(node) {
        const layer = document.querySelector('#expression-layer');
        if (!layer) return;
        layer.innerHTML = '';

        let characters = [];

        // 优先检查 multi_characters 字段（多人同场）
        if (node.multi_characters) {
            try {
                const parsed = typeof node.multi_characters === 'string'
                    ? JSON.parse(node.multi_characters)
                    : node.multi_characters;
                if (Array.isArray(parsed)) characters = parsed;
            } catch (e) {}
        }

        // 如果没有多人物数据，回退到单人物模式
        if (characters.length === 0 && node.speaker_id) {
            characters.push({
                speaker_id: node.speaker_id,
                expression: node.expression,
                position: node.position || 'center'
            });
        }

        if (characters.length === 0) return;

        // 依次上台（旧站位枚举 → 百分比坐标）
        for (const ch of characters) {
            try {
                const charData = await API.characters.get(ch.speaker_id);
                const imgUrl = this._resolveExpressionUrl(charData, ch.expression);
                if (!imgUrl) continue;

                await this._putOnStage(layer, ch.speaker_id, imgUrl, {
                    pos_x: this.POS_LEGACY_MAP[ch.position || 'center'] ?? 50,
                    pos_y: 0,
                    scale: this.LEGACY_SCALE,
                    crop_top: 0,
                    crop_bottom: 100,
                    flip: false,
                    z_index: 1,
                    animation_effect_id: ch.animation_effect_id || null,
                });
            } catch (e) {}
        }

        // 聚焦当前说话者，其余淡化
        this._focusSpeaker(node.speaker_id);
    },

    // ===== 立绘舞台（新：对话列表逐句渲染） =====
    async renderStage(line) {
        const layer = document.querySelector('#expression-layer');
        if (!layer) return;

        const speakerId = line?.speaker_id || null;

        if (speakerId) {
            try {
                const charData = await API.characters.get(speakerId);
                const imgUrl = this._resolveExpressionUrl(charData, line.expression);
                if (imgUrl) {
                    await this._putOnStage(layer, speakerId, imgUrl, {
                        pos_x: this._num(line.pos_x, 50),
                        pos_y: this._num(line.pos_y, 0),
                        scale: this._num(line.scale, 1),
                        crop_top: this._num(line.crop_top, 0),
                        crop_bottom: this._num(line.crop_bottom, 100),
                        flip: !!line.flip,
                        z_index: line.z_index || 1,
                        animation_effect_id: line.animation_effect_id || null,
                    });
                }
            } catch (e) {}
        }

        this._focusSpeaker(speakerId);
    },

    _num(v, def) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : def;
    },

    _resolveExpressionUrl(charData, expression) {
        if (expression && charData?.expressions) {
            try {
                const exprs = typeof charData.expressions === 'string'
                    ? JSON.parse(charData.expressions) : charData.expressions;
                if (exprs && exprs[expression]) return exprs[expression];
            } catch (e) {}
        }
        return charData?.portrait_image || null;
    },

    clearStage() {
        const layer = document.querySelector('#expression-layer');
        if (layer) layer.innerHTML = '';
    },

    // 聚焦当前说话者：说话者提亮，其余明显变暗
    _focusSpeaker(speakerId) {
        this._lastSpeaker = (speakerId == null) ? null : speakerId;
        const layer = document.querySelector('#expression-layer');
        if (!layer) return;
        const st = this.focusStyle;
        layer.querySelectorAll('.stage-char').forEach(el => {
            const id = parseInt(el.dataset.charId, 10);
            const isSpeaker = !!(speakerId && id === speakerId);
            el.classList.toggle('dimmed', !isSpeaker);
            el.classList.toggle('speaking', isSpeaker);
            el.style.filter = isSpeaker ? st.speak : st.dim;
            // 不再改透明度：非说话者只变暗，保持不透明，避免与背景/其他立绘叠色
            el.style.opacity = '';
        });
    },

    // 设置面板切换特效档位后即时重绘
    refreshFocus() {
        this._focusSpeaker(this._lastSpeaker || null);
    },

    // 把角色放到舞台上（不存在则创建）
    async _putOnStage(layer, charId, imgUrl, cfg) {
        let el = layer.querySelector(`.stage-char[data-char-id="${charId}"]`);
        let isNew = false;
        if (!el) {
            el = document.createElement('div');
            el.className = 'stage-char';
            el.dataset.charId = String(charId);
            const img = document.createElement('img');
            el.appendChild(img);
            layer.appendChild(el);
            isNew = true;
        }
        // 该角色正在退场（上一句勾了「消失」）但又重新登场 → 取消退场
        if (!isNew && el.classList.contains('leaving')) {
            clearTimeout(el.__leaveTimer);
            el.classList.remove('leaving');
        }
        el.__cfg = cfg;
        el.style.zIndex = String(cfg.z_index || 1);

        const img = el.querySelector('img');
        if (img.dataset.src !== imgUrl) {
            img.dataset.src = imgUrl;
            img.src = imgUrl;
            await new Promise(resolve => {
                if (img.complete && img.naturalHeight) resolve();
                else {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                }
            });
        }

        this._layoutStageChar(el, img, cfg);

        if (isNew) requestAnimationFrame(() => el.classList.add('show'));
        else el.classList.add('show');

        if (cfg.animation_effect_id) {
            setTimeout(() => this._applyExpressionEffect(img, cfg.animation_effect_id), 400);
        }
    },

    // 按坐标/缩放/裁剪计算立绘视窗与图片位置
    _layoutStageChar(el, img, cfg) {
        const layer = el.parentElement;
        if (!layer) return;
        const stageH = layer.clientHeight || window.innerHeight || 800;
        const stageW = layer.clientWidth || window.innerWidth || 1200;

        let imgH = stageH * this.STAGE_BASE_RATIO * (cfg.scale || 1);
        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        const ratio = (nw && nh) ? (nw / nh) : 0.62;
        let imgW = imgH * ratio;

        const maxW = stageW * 0.92;
        if (imgW > maxW) {
            const k = maxW / imgW;
            imgW *= k;
            imgH *= k;
        }

        const top = Math.min(100, Math.max(0, cfg.crop_top ?? 0));
        const bottom = Math.min(100, Math.max(top + 2, cfg.crop_bottom ?? 100));
        const winH = imgH * (bottom - top) / 100;

        el.style.width = imgW + 'px';
        el.style.height = winH + 'px';
        el.style.left = (cfg.pos_x ?? 50) + '%';
        el.style.bottom = (cfg.pos_y ?? 0) + '%';

        img.style.width = imgW + 'px';
        img.style.height = imgH + 'px';
        img.style.left = '0px';
        img.style.top = (-imgH * top / 100) + 'px';
        img.style.transform = cfg.flip ? 'scaleX(-1)' : 'none';
    },

    // 窗口尺寸变化后重新排版
    _relayoutAll() {
        const layer = document.querySelector('#expression-layer');
        if (!layer) return;
        layer.querySelectorAll('.stage-char').forEach(el => {
            if (!el.__cfg) return;
            const img = el.querySelector('img');
            if (img) this._layoutStageChar(el, img, el.__cfg);
        });
    },

    // === 打字机系统 ===

    /**
     * 打字机。
     * @param speed 每字毫秒数。不给就用默认 50；给了（通常来自语音时长换算）
     *              就让「字打完」与「话说完」尽量同步，这是口语节奏感的来源。
     */
    _typeTextSlow(element, text, speed) {
        return new Promise((resolve) => {
            if (typeof element === 'string') element = document.querySelector(element);
            element.textContent = '';
            this._typingEl = element;
            this._typingText = text;
            this._typingIndex = 0;
            this._resolveTyping = resolve;
            this._typingMode = 'slow';
            this._typingSpeed = speed || 50;

            this._scheduleNextChar(this._typingSpeed);
        });
    },

    _scheduleNextChar(speed) {
        if (this._typingTimer) {
            clearTimeout(this._typingTimer);
            this._typingTimer = null;
        }

        if (this._typingIndex >= this._typingText.length) {
            this._finishTyping();
            return;
        }

        this._typingTimer = setTimeout(() => {
            this._typingEl.textContent += this._typingText[this._typingIndex];
            this._typingIndex++;

            if (this._typingIndex >= this._typingText.length) {
                this._finishTyping();
            } else {
                // slow 模式沿用本句的实际速度（可能已按语音时长调整过），fast 是点击加速
                const currentSpeed = (this._typingMode === 'fast') ? 10 : (this._typingSpeed || 50);
                this._scheduleNextChar(currentSpeed);
            }
        }, speed);
    },

    _finishTyping() {
        if (this._typingTimer) {
            clearTimeout(this._typingTimer);
            this._typingTimer = null;
        }
        this._typingMode = 'done';
        this._isTypingFinished = true;
        if (this._resolveTyping) {
            this._resolveTyping();
            this._resolveTyping = null;
        }
    },

    // 点击对话框
    async handleClick() {
        if (GameState.isInCombat) return;
        if (!Utils.$('#choices-container')?.classList.contains('hidden')) return;
        if (!GameState.isInDialogue) return;

        if (!this._isTypingFinished) {
            if (this._typingMode === 'slow') {
                // 第一次点击：文字立刻加速铺满，语音继续播（不打断）
                this._typingMode = 'fast';
                this._scheduleNextChar(10);
            } else if (this._typingMode === 'fast') {
                // 第二次点击：直接全显
                this._skipTyping();
            }
            return;
        }

        // 走到这里说明要翻下一句了 —— 当前这句的语音必须立刻停，
        // 否则上一句的声音会盖到下一句上，听起来就是两个人抢话。
        if (typeof TTSManager !== 'undefined') TTSManager.stopCurrent();

        if (this.pendingBattleNode) {
            await this.startPendingBattle();
            return;
        }

        // 本节点已读完 → 收尾（显示选项 / 挂起战斗 / 进入下一节点）
        if (this._nodeFinished) {
            this._nodeFinished = false;
            await this._finishNode();
            return;
        }

        // 对话列表：还有下一句 → 继续播
        if (this._lines.length > 0 && this._lineIndex >= 0 && this._lineIndex < this._lines.length) {
            await this._playLine();
            return;
        }

        if (this.currentNodeId && this.callback) {
            this.callback({ nextAfter: this.currentNodeId });
        }
    },

    _skipTyping() {
        if (this._typingTimer) {
            clearTimeout(this._typingTimer);
            this._typingTimer = null;
        }
        if (this._typingEl && this._typingText) {
            this._typingEl.textContent = this._typingText;
            this._typingIndex = this._typingText.length;
        }
        this._finishTyping();
    },

    // 播放音乐
    playMusic(url) {
        if (this.currentAudio) { this.currentAudio.pause(); this.currentAudio = null; }
        if (!url) return;
        try {
            const audio = new Audio(url);
            audio.loop = true;
            audio.volume = 0.5;
            audio.play().catch(() => {});
            this.currentAudio = audio;
        } catch (e) { /* ignore */ }
    },

    changeBackground(imageUrl, effectId = null) {
        const bgImg = document.querySelector('#bg-image');
        const overlay = document.querySelector('#bg-overlay');

        if (effectId) {
            // 先应用转场动效
            this._applyBackgroundEffect(bgImg, overlay, effectId, () => {
                bgImg.src = imageUrl;
                bgImg.style.display = 'block';
            });
        } else {
            bgImg.src = imageUrl;
            bgImg.style.display = 'block';
        }
    },

    // 应用背景动效
    _applyBackgroundEffect(bgImg, overlay, effectId, onComplete) {
        // 加载动效配置
        API.get(`/animation-effects/${effectId}`).then(effect => {
            if (!effect) { onComplete(); return; }

            const duration = effect.duration || 1000;
            const params = effect.params ? JSON.parse(effect.params) : {};

            switch (effect.effect_type) {
                case 'shake': {
                    const intensity = params.intensity || 5;
                    const maxPx = Math.round(intensity * 3.5); // intensity 1→4px, 5→18px, 10→35px
                    // 动态创建关键帧
                    const styleId = 'dyn-shake-bg';
                    let styleEl = document.getElementById(styleId);
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = styleId;
                        document.head.appendChild(styleEl);
                    }
                    styleEl.textContent = `@keyframes dyn-bg-shake {
                        0%, 100% { transform: translateX(0); }
                        10% { transform: translateX(-${maxPx}px); }
                        20% { transform: translateX(${maxPx}px); }
                        30% { transform: translateX(-${maxPx * 0.7}px); }
                        40% { transform: translateX(${maxPx * 0.7}px); }
                        50% { transform: translateX(-${maxPx * 0.4}px); }
                        60% { transform: translateX(${maxPx * 0.4}px); }
                        70% { transform: translateX(-${maxPx * 0.2}px); }
                        80% { transform: translateX(${maxPx * 0.2}px); }
                    }`;
                    bgImg.style.animation = `dyn-bg-shake ${duration}ms ease`;
                    bgImg.addEventListener('animationend', () => {
                        bgImg.style.animation = '';
                        onComplete();
                    }, { once: true });
                    break;
                }
                case 'fade': {
                    const fromOp = params.from_opacity !== undefined ? params.from_opacity : 1;
                    const toOp = params.to_opacity !== undefined ? params.to_opacity : 0;
                    bgImg.style.transition = `opacity ${duration}ms ease`;
                    bgImg.style.opacity = fromOp;
                    setTimeout(() => {
                        bgImg.style.opacity = toOp;
                        setTimeout(() => {
                            onComplete();
                            setTimeout(() => { bgImg.style.opacity = '1'; }, 50);
                        }, duration);
                    }, 50);
                    break;
                }
                case 'darken':
                    overlay.style.transition = `opacity ${duration}ms ease`;
                    overlay.style.background = `rgba(0,0,0,${params.intensity || 0.6})`;
                    setTimeout(onComplete, duration);
                    break;
                case 'blur':
                    bgImg.style.transition = `filter ${duration}ms ease`;
                    bgImg.style.filter = `brightness(1) saturate(0.9) blur(${params.radius || 4}px)`;
                    setTimeout(() => {
                        bgImg.style.filter = 'brightness(1) saturate(0.9) blur(0px)';
                        onComplete();
                    }, duration);
                    break;
                case 'color_shift':
                    overlay.style.transition = `background ${duration}ms ease`;
                    overlay.style.background = params.color || 'rgba(255,0,0,0.2)';
                    setTimeout(() => {
                        overlay.style.background = '';
                        onComplete();
                    }, duration);
                    break;
                case 'zoom':
                    bgImg.style.transition = `transform ${duration}ms ease`;
                    bgImg.style.transform = `scale(${params.scale || 1.15})`;
                    setTimeout(() => {
                        bgImg.style.transform = 'scale(1)';
                        onComplete();
                    }, duration);
                    break;
                case 'flash': {
                    const flashIntensity = params.intensity || 0.8;
                    const flashColor = params.color || '#ffffff';
                    overlay.style.transition = 'none';
                    overlay.style.background = flashColor;
                    overlay.style.opacity = flashIntensity;
                    setTimeout(() => {
                        overlay.style.transition = `opacity ${duration/2}ms ease`;
                        overlay.style.opacity = '0';
                        setTimeout(() => {
                            overlay.style.background = '';
                            onComplete();
                        }, duration / 2);
                    }, 100);
                    break;
                }
                default:
                    onComplete();
            }
        }).catch(() => onComplete());
    },

    // 应用表情动效
    _applyExpressionEffect(img, effectId) {
        if (!img || !effectId) return;
        API.get(`/animation-effects/${effectId}`).then(effect => {
            if (!effect) return;
            const duration = effect.duration || 1000;
            const params = effect.params ? JSON.parse(effect.params) : {};

            switch (effect.effect_type) {
                case 'shake': {
                    const intensity = params.intensity || 5;
                    const maxPx = Math.round(intensity * 1.6); // intensity 1→2px, 5→8px, 10→16px
                    const styleId = 'dyn-shake-expr';
                    let styleEl = document.getElementById(styleId);
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = styleId;
                        document.head.appendChild(styleEl);
                    }
                    styleEl.textContent = `@keyframes dyn-expr-shake {
                        0%, 100% { transform: translateX(0) rotate(0deg); }
                        20% { transform: translateX(-${maxPx}px) rotate(-${intensity * 0.2}deg); }
                        40% { transform: translateX(${maxPx}px) rotate(${intensity * 0.2}deg); }
                        60% { transform: translateX(-${maxPx * 0.6}px) rotate(-${intensity * 0.1}deg); }
                        80% { transform: translateX(${maxPx * 0.6}px) rotate(${intensity * 0.1}deg); }
                    }`;
                    img.style.animation = `dyn-expr-shake ${duration}ms ease`;
                    setTimeout(() => { img.style.animation = ''; }, duration);
                    break;
                }
                case 'darken':
                    img.style.filter = `brightness(${1 - (params.intensity || 0.3)})`;
                    setTimeout(() => { img.style.filter = ''; }, duration);
                    break;
                case 'zoom':
                    img.style.transition = `transform ${duration}ms ease`;
                    img.style.transform = `scale(${params.scale || 1.1})`;
                    setTimeout(() => { img.style.transform = ''; }, duration);
                    break;
                case 'flash': {
                    const flashIntensity = params.intensity || 0.8;
                    const brightness = 1 + flashIntensity;
                    img.style.filter = `brightness(${brightness})`;
                    setTimeout(() => { img.style.filter = ''; }, duration);
                    break;
                }
            }
        }).catch(() => {});
    },

    async getSpeakerName(speakerId) {
        if (!speakerId) return null;
        try { const char = await API.characters.get(speakerId); return char.name; }
        catch { return '???'; }
    },

    showChoices(choices) {
        const container = document.querySelector('#choices-list');
        container.innerHTML = '';
        choices.forEach(choice => {
            if (choice.is_hidden) return;
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = choice.choice_text;
            btn.addEventListener('click', () => this.handleChoice(choice));
            container.appendChild(btn);
        });
        Utils.show('#choices-container');
        Utils.hide('#dialogue-indicator');
    },

    async handleChoice(choice) {
        Utils.hide('#choices-container');
        Utils.hide('#dialogue-indicator');
        if (choice.effects) {
            try {
                const effects = JSON.parse(choice.effects);
                if (effects.favorability) {
                    for (const [name, delta] of Object.entries(effects.favorability)) {
                        Utils.toast(`${name} 好感度 ${delta > 0 ? '+' : ''}${delta}`);
                    }
                }
                if (effects.flag) await API.story.setFlag({ flag_key: effects.flag, flag_value: '1' });
            } catch (e) { /* ignore */ }
        }
        if (choice.next_node_id) {
            // 跳转到指定节点，用户读完该节点后自然触发回调，从该节点按顺序继续
            await this.showNode(choice.next_node_id, this.callback);
        } else {
            // 没有跳转目标，按顺序播放下一个节点
            if (this.callback) this.callback({ nextAfter: this.currentNodeId });
        }
    },

    hideAllSprites() {
        document.querySelectorAll('#expression-layer .stage-char').forEach(el => {
            el.classList.add('dimmed');
        });
        document.querySelectorAll('.char-sprite').forEach(el => {
            el.classList.remove('active');
            el.style.boxShadow = 'none';
        });
    },
};

// 窗口尺寸变化 → 重新排版立绘（坐标是百分比，需按新尺寸换算）
window.addEventListener('resize', () => {
    if (typeof DialogueUI !== 'undefined' && DialogueUI._relayoutAll) DialogueUI._relayoutAll();
});