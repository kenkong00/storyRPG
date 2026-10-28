// ========== 战斗界面 v2（服务端权威 · 事件流驱动） ==========
//
// 设计原则
// --------
// 1. 规则在后端：伤害公式、行动条、状态、AI、升级、掉落全在 battle_engine。
//    前端**不写任何数值逻辑**，因此加技能 / 加敌人 / 调数值都不需要改这个文件。
// 2. 前端只做两件事：
//    ① 把后端返回的 events 一条条"演"出来（动画 / 飘字 / 日志 / 台词）；
//    ② 在 await_input 时收集玩家指令，POST 回去拿下一批 events。
// 3. 事件类型是开放的：遇到不认识的事件直接忽略（向后兼容）。
//
// 事件类型：turn_start / cast / damage / heal / mp / shield / shield_add /
//           status_add / status_remove / resist_status / cleanse / rage /
//           down / revive / phase / banter / miss / item / defend / skip /
//           cooldown / flee_ok / flee_fail / victory / defeat / await_input

const CombatUI = {
    /* ================= 运行时状态 ================= */
    battleId: null,
    state: null,          // 最新权威状态（服务端返回的 to_client_state）
    view: {},             // uid -> {hp,mp,rage,shield,statuses} 用于逐帧演出
    els: {},              // uid -> {card, hpFill, hpText, ...}
    awaitUid: null,       // 正在等待输入的单位
    pending: null,        // {type, skill} 待选目标的指令
    pool: [],             // 可选目标 uid
    auto: false,
    skip: false,
    busy: false,
    ctx: {},              // {storyNodeId, node, postChoices}
    rewards: null,
    _autoRunning: false,
    _nudgeGuard: 0,
    _bound: false,

    /* ================= 入口 ================= */

    /** 开始战斗。opts: {storyNodeId, node, postChoices, enemies, allies, config} */
    async start(opts = {}) {
        this.ctx = {
            storyNodeId: opts.storyNodeId ?? opts.story_node_id ?? null,
            node: opts.node || null,
            postChoices: opts.postChoices || [],
        };
        this.battleId = null;
        this.state = null;
        this.view = {};
        this.els = {};
        this._artHold = {};
        this.awaitUid = null;
        this.pending = null;
        this.pool = [];
        this.rewards = null;
        this.auto = false;
        this.skip = false;
        this.busy = true;
        this._autoRunning = false;
        this._nudgeGuard = 0;

        // 战后抉择：战斗节点自带的选项（调用方没传就自己取一次）
        if (!this.ctx.postChoices.length && this.ctx.storyNodeId) {
            try {
                const full = await API.story.getNodeFull(this.ctx.storyNodeId);
                this.ctx.postChoices = (full && full.choices ? full.choices : [])
                    .filter(c => !c.is_hidden);
                if (full && full.node) this.ctx.node = this.ctx.node || full.node;
            } catch (e) { /* ignore */ }
        }

        this._openLayer();

        let res;
        try {
            res = await API.battle.v2Start({
                story_node_id: this.ctx.storyNodeId,
                user_character_id: GameState.player?.uc_id || GameState.player?.id || null,
                battle_type: 'story',
                enemies: opts.enemies || null,
                ally_character_ids: opts.allies || null,
                config_override: opts.config || null,
            });
        } catch (e) {
            console.error('战斗初始化失败:', e);
            Utils.toast('战斗初始化失败：' + (e.message || e));
            this._closeLayer();
            // 避免卡在战斗节点上
            if (typeof App !== 'undefined' && this.ctx.storyNodeId) {
                await App.handleStoryChoice({ nextAfter: this.ctx.storyNodeId });
            }
            return;
        }

        this.battleId = res.battle_id;
        this.state = res.state;
        this._buildUI();

        const cfg = this.state.config || {};
        const bg = Utils.$('#battle-bg');
        if (bg && cfg.background) bg.style.backgroundImage = `url('${cfg.background}')`;

        await this._banner('战斗开始', 850);
        await this.play(res.events || []);
    },

    /** 兼容旧调用：startBattle(enemyIds, storyNodeId, {node, postChoices}) */
    async startBattle(enemyIds, storyNodeId, opts = {}) {
        return this.start({
            storyNodeId,
            node: opts.node,
            postChoices: opts.postChoices,
            enemies: (enemyIds || []).map(id => ({ character_id: id })),
        });
    },

    /* ================= 层显示 / 隐藏 ================= */

    _openLayer() {
        this._bindOnce();
        GameState.isInCombat = true;
        Utils.hide('#dialogue-box');
        Utils.hide('#choices-container');
        Utils.hide('#ui-layer');
        Utils.hide('#dialogue-overlay');
        Utils.hide('#chapter-cover');
        Utils.hide('#ui-toggle');   // 右上角的 UI 开关与战斗工具冲突

        const box = Utils.$('#battle-result');
        if (box) { box.innerHTML = ''; box.classList.remove('show'); Utils.hide(box); }
        ['#battle-enemies', '#battle-party', '#battle-log', '#turn-order-list'].forEach(sel => {
            const el = Utils.$(sel);
            if (el) el.innerHTML = '';
        });
        Utils.hide('#battle-banter');
        this._hideBanner();
        this._closeCommand();
        this._exitTargetMode();
        this._setTools();

        const layer = Utils.$('#battle-layer');
        Utils.show(layer);
        if (layer) {
            layer.classList.remove('battle-enter');
            void layer.offsetWidth;
            layer.classList.add('battle-enter');
        }
        if (typeof DialogueUI !== 'undefined' && DialogueUI.hideAllSprites) DialogueUI.hideAllSprites();
    },

    _closeLayer() {
        GameState.isInCombat = false;
        this._setActor(null);
        Utils.hide('#battle-layer');
        const box = Utils.$('#battle-result');
        if (box) { box.classList.remove('show'); Utils.hide(box); }
        this._closeCommand();
        this._exitTargetMode();
        this.skip = false;
        this._setTools();
        Utils.show('#ui-layer');
        Utils.show('#dialogue-overlay');
        Utils.show('#dialogue-box');
        Utils.show('#ui-toggle');
    },

    /* ================= DOM 构造 ================= */

    _buildUI() {
        const st = this.state;
        if (!st) return;
        const eWrap = Utils.$('#battle-enemies');
        const pWrap = Utils.$('#battle-party');
        if (eWrap) { eWrap.innerHTML = ''; eWrap.dataset.count = String(st.units.filter(u => u.side === 'enemy').length); }
        if (pWrap) pWrap.innerHTML = '';

        this.els = {};
        this.view = {};
        this._artHold = {};

        st.units.forEach(u => {
            this.view[u.uid] = this._initView(u);
            if (u.side === 'enemy') {
                if (eWrap) eWrap.appendChild(this._makeEnemyCard(u));
            } else {
                if (pWrap) pWrap.appendChild(this._makePartyCard(u));
            }
        });

        this._renderRound(st.round);
        this._renderOrder();
        this._syncAll();
    },

    _initView(u) {
        return {
            hp: u.start_hp != null ? u.start_hp : u.hp,
            mp: u.start_mp != null ? u.start_mp : u.mp,
            rage: u.start_rage != null ? u.start_rage : (u.rage || 0),
            shield: u.shield || 0,
            statuses: (u.statuses || []).map(s => Object.assign({}, s)),
        };
    },

    /** 卡牌式单位卡：外框 + 立绘窗 + 名牌 + 血条区（敌我共用一套结构） */
    _makeUnitCard(u, isParty) {
        const card = document.createElement('div');
        card.className = isParty
            ? 'unit-card party' + (u.is_ally ? ' ally' : ' main')
            : 'unit-card enemy' + (u.is_boss ? ' boss' : '');
        card.dataset.uid = u.uid;

        const img = this._artUrl(u, 'idle');
        const portrait = img
            ? `<img src="${img}" alt="">`
            : `<span class="uc-ph" style="background:${Utils.getAvatarPlaceholder(u.name)}">${this._esc((u.name || '?').slice(0, 1))}</span>`;
        // 我方 / 敌方 / Boss 统一显示 血·蓝·黄(怒气) 三条 + 护盾，保持版面一致
        const extraBars = '<div class="uc-bar mp"><i></i></div><div class="uc-bar rage"><i></i></div>';
        const sub = '<span class="uc-hp"></span><span class="uc-mp"></span><span class="uc-shield"></span><span class="uc-rage"></span>';

        card.innerHTML = `
            <div class="uc-frame">
                <div class="uc-status"></div>
                <div class="uc-portrait">
                    ${portrait}
                    ${(!isParty && u.is_boss) ? '<div class="uc-boss-mark">BOSS</div>' : ''}
                </div>
                <div class="uc-plate">
                    <div class="uc-name">
                        ${this._elementTag(u.element)}
                        <span class="uc-nm">${this._esc(u.name)}</span>
                        <span class="uc-lv">Lv.${u.level}</span>
                    </div>
                    <div class="uc-bar hp"><i></i></div>
                    ${extraBars}
                    <div class="uc-sub">${sub}</div>
                </div>
            </div>`;

        card.addEventListener('click', () => this._onUnitClick(u.uid));
        const els = {
            card,
            portraitImg: card.querySelector('.uc-portrait img'),
            hpFill: card.querySelector('.uc-bar.hp > i'),
            hpText: card.querySelector('.uc-hp'),
            shieldText: card.querySelector('.uc-shield'),
            rageText: card.querySelector('.uc-rage'),
            statusEl: card.querySelector('.uc-status'),
            mpFill: card.querySelector('.uc-bar.mp > i'),
            rageFill: card.querySelector('.uc-bar.rage > i'),
            mpText: card.querySelector('.uc-mp'),
        };
        this.els[u.uid] = els;
        return card;
    },

    _makeEnemyCard(u) { return this._makeUnitCard(u, false); },
    _makePartyCard(u) { return this._makeUnitCard(u, true); },

    /* ---------- 立绘：按动作 / 血量切图 ---------- */

    _artOf(u) { return (u && u.art) || {}; },

    /**
     * 选图规则（数据由后端 art 资源包给出，前端不做数值判断外的决策）：
     *   1) mode 指定了动作图（attack/cast/defend/ultimate/down）→ 有就用
     *   2) 损血档位 art.hurt（按 HP% 从高到低）→ 取满足条件的最低档
     *   3) 兜底 art.idle → 旧的 states → portrait
     */
    _artImage(u, mode, hpPct) {
        const art = this._artOf(u);
        const pct = hpPct == null ? 100 : hpPct;
        if (mode === 'down' && art.down) return art.down;
        if (mode && mode !== 'idle' && mode !== 'hurt' && art[mode]) return art[mode];
        let url = '';
        for (const step of (art.hurt || [])) {
            if (pct <= step.min) url = step.url || '';
        }
        return url || art.idle || this._stateImage(u, mode || 'idle');
    },

    /** 用当前血量算出该显示哪张（血量取演出中的显示值，掉血瞬间就换表情） */
    _artUrl(u, mode) {
        if (!u) return '';
        const v = this.view[u.uid] || {};
        const maxHp = Math.max(1, (u.eff && u.eff.max_hp) || (u.base && u.base.max_hp) || 1);
        const hp = v.hp != null ? v.hp : u.hp;
        return this._artImage(u, mode, (hp / maxHp) * 100);
    },

    /**
     * 换立绘。mode 为空 = 按血量自动；给了 holdMs 表示"这张动作图先显示这么久"，
     * 期间即使血量变化也不切回去（否则出手图会被随后那条伤害事件瞬间顶掉）。
     */
    _setArt(uid, mode, holdMs) {
        const el = this.els[uid];
        const u = this._unit(uid);
        if (!el || !el.portraitImg || !u) return;
        if (!this._artHold) this._artHold = {};
        const hold = this._artHold[uid];
        let use = mode;
        if (use == null && hold && hold.until > Date.now()) use = hold.mode;
        if (use && holdMs) {
            this._artHold[uid] = { mode: use, until: Date.now() + holdMs };
        } else if (use === 'down') {
            this._artHold[uid] = { mode: 'down', until: Number.MAX_SAFE_INTEGER };
        }
        const url = this._artUrl(u, use);
        if (!url || el.artUrl === url) return;
        el.artUrl = url;
        el.portraitImg.src = url;
        el.portraitImg.classList.remove('art-swap');
        void el.portraitImg.offsetWidth;
        el.portraitImg.classList.add('art-swap');
    },

    _stateImage(u, key) {
        const states = u.states || {};
        const pick = (v) => {
            if (!v) return '';
            if (typeof v === 'string') return v;
            if (typeof v === 'object') {
                const keys = Object.keys(v).sort(
                    (a, b) => (parseFloat(b) || 0) - (parseFloat(a) || 0));
                for (const k of keys) {
                    const s = pick(v[k]);
                    if (s) return s;
                }
            }
            return '';
        };
        for (const k of [key, 'idle', 'standing', 'normal', 'default', 'battle']) {
            const s = pick(states[k]);
            if (s) return s;
        }
        for (const k of Object.keys(states)) {
            const s = pick(states[k]);
            if (s) return s;
        }
        return u.portrait || '';
    },

    _elementTag(el) {
        const map = { fire: ['火', '#ff7a3d'], water: ['水', '#5bb8ff'], wind: ['风', '#7ee7a5'],
                      earth: ['土', '#d3a559'], light: ['光', '#ffe9a3'], dark: ['暗', '#b07dff'] };
        const m = map[el];
        if (!m) return '';
        return `<span class="uc-el" style="color:${m[1]};border-color:${m[1]}">${m[0]}</span>`;
    },

    /* ================= 同步渲染 ================= */

    _unit(uid) {
        if (!this.state) return null;
        return this.state.units.find(u => u.uid === uid) || null;
    },

    _syncBars(uid) {
        const el = this.els[uid];
        const v = this.view[uid];
        if (!el || !v) return;
        const u = this._unit(uid);
        const eff = (u && u.eff) || {};
        const base = (u && u.base) || {};
        const maxHp = Math.max(1, eff.max_hp || base.max_hp || 1);
        const maxMp = Math.max(1, eff.max_mp || base.max_mp || 1);

        const hpPct = Utils.percent(v.hp, maxHp);
        if (el.hpFill) {
            el.hpFill.style.width = hpPct + '%';
            el.hpFill.classList.toggle('low', hpPct <= 30);
        }
        if (el.hpText) el.hpText.textContent = `${Math.round(v.hp)}/${Math.round(maxHp)}`;
        if (el.mpFill) el.mpFill.style.width = Utils.percent(v.mp, maxMp) + '%';
        if (el.mpText) el.mpText.textContent = `${Math.round(v.mp)}/${Math.round(maxMp)}`;
        if (el.rageFill) el.rageFill.style.width = Utils.percent(v.rage, 100) + '%';
        if (el.card) {
            el.card.classList.toggle('rage-full', v.rage >= 100);
            el.card.classList.toggle('defending', !!v.defending);
        }
        if (el.shieldText) el.shieldText.textContent = v.shield > 0 ? `🛡${Math.round(v.shield)}` : '';
        if (el.rageText) el.rageText.textContent = v.rage > 0 ? `怒${Math.round(v.rage)}` : '';
        this._renderStatuses(uid);
        // 血量变化 → 立绘跟着换（配置了损血档位/表情图时才有视觉变化）
        this._setArt(uid, null);
    },

    _renderStatuses(uid) {
        const el = this.els[uid];
        const v = this.view[uid];
        if (!el || !el.statusEl) return;
        const list = (v && v.statuses) || [];
        el.statusEl.innerHTML = list.map(s => {
            const stack = (s.stacks || 1) > 1 ? ` ×${s.stacks}` : '';
            const tip = `${s.name || s.key}${stack}${s.turns ? '（剩余 ' + s.turns + ' 回合）' : ''}`;
            return `<span class="st" title="${this._esc(tip)}" style="color:${s.color || '#ddd'};border-color:${s.color || '#ddd'}">${s.icon || '◆'}${s.turns ? `<i>${s.turns}</i>` : ''}</span>`;
        }).join('');
    },

    _renderRound(round) {
        const el = Utils.$('#battle-round');
        if (el) el.textContent = `第 ${Math.max(1, round || 1)} 回合`;
    },

    /** 行动顺序：左侧序号徽章（1 最先出手）+ 头像 + 名字 / 血条 */
    _renderOrder() {
        const wrap = Utils.$('#turn-order-list');
        if (!wrap || !this.state) return;
        const order = this.state.order || [];
        const marks = { 0: '当前', 1: '下一位' };
        wrap.innerHTML = order.slice(0, 8).map((o, i) => {
            const u = this._unit(o.uid);
            const img = u ? this._artUrl(u, 'idle') : '';
            const maxHp = Math.max(1, (u && u.eff && u.eff.max_hp) || 1);
            const pct = u ? Utils.percent(u.hp, maxHp) : 100;
            const cls = [
                o.side === 'enemy' ? 'enemy' : 'player',
                i === 0 ? 'first' : '',
                i === 1 ? 'next' : '',
                pct <= 30 ? 'low' : '',
                u && !u.alive ? 'out' : '',
            ].join(' ');
            const mark = marks[i] || '';
            return `<div class="to-item ${cls}" title="${this._esc(`第 ${i + 1} 位 · ${o.name || ''}`)}">
                <span class="to-idx">${i + 1}</span>
                <span class="to-face">
                    ${img ? `<img src="${img}" alt="">` : `<span class="to-ph">${this._esc((o.name || '?').slice(0, 1))}</span>`}
                    ${i === 0 ? '<i class="to-now"></i>' : ''}
                </span>
                <span class="to-meta">
                    <span class="to-line">
                        <b>${this._esc(o.name || '')}</b>
                        ${mark ? `<i class="to-mark">${mark}</i>` : ''}
                    </span>
                    <span class="to-hp"><i style="width:${pct}%"></i></span>
                </span>
            </div>`;
        }).join('');
    },

    /** 播放结束后把显示值对齐到权威状态，防止漂移 */
    _syncAll() {
        const st = this.state;
        if (!st) return;
        st.units.forEach(u => {
            const v = this.view[u.uid];
            if (!v) return;
            v.hp = u.hp;
            v.mp = u.mp;
            v.rage = u.rage || 0;
            v.shield = u.shield || 0;
            v.defending = !!u.defending;
            v.statuses = (u.statuses || []).map(s => Object.assign({}, s));
            const el = this.els[u.uid];
            if (el && el.card) el.card.classList.toggle('down', !u.alive);
            this._syncBars(u.uid);
        });
        this._renderOrder();
        this._renderRound(st.round);
        this._syncCommands();
        this._setTools();
    },

    /* ================= 事件播放 ================= */

    _d(ms) {
        if (this.skip) return 0;
        if (this.auto) return Math.round(ms * 0.35);
        return ms;
    },

    async play(events) {
        if (!events || !events.length) { this._afterPlay(); return; }
        for (const ev of events) {
            if (!ev || !ev.t) continue;
            if (ev.t === 'await_input') { this.awaitUid = ev.uid; continue; }
            await this._playEvent(ev);
        }
        this._afterPlay();
    },

    async _playEvent(ev) {
        const nm = (uid) => (this._unit(uid) || {}).name || '???';
        switch (ev.t) {
            case 'turn_start': {
                this.awaitUid = null;
                if (this._artHold) delete this._artHold[ev.uid];
                this._setArt(ev.uid, null);
                this._focus(ev.uid);
                this._renderRound(ev.round);
                await Utils.sleep(this._d(150));
                break;
            }
            case 'cast': {
                const basic = !ev.skill_id;
                // 出手图：绝招 > 技能 > 普攻（没配的话会自动落回血量图）
                this._setArt(ev.uid, ev.ultimate ? 'ultimate' : (basic ? 'attack' : 'cast'), this._d(1100));
                this._castFx(ev.uid, ev.element);
                this._castName(ev.uid, ev.skill, ev.ultimate);
                this._log(`${nm(ev.uid)} 使用了【${ev.skill}】`, basic ? 'action' : 'skill');
                await Utils.sleep(this._d(basic ? 140 : 300));
                break;
            }
            case 'damage': {
                const v = this.view[ev.uid];
                if (v) v.hp = ev.hp != null ? ev.hp : Math.max(0, v.hp - (ev.value || 0));
                if (ev.self_cost) {
                    this._float(ev.uid, `-${ev.value}`, 'self');
                    this._log(`${nm(ev.uid)} 以 ${ev.value} 点生命为代价`, 'self');
                } else {
                    this._float(ev.uid, `-${ev.value}`, ev.crit ? 'crit' : (ev.dot ? 'dot' : 'dmg'));
                    if (ev.crit) this._banner('暴击！', 420, 'crit');
                    else if (ev.weak) this._banner('克制！', 380, 'weak');
                    else if (ev.resist) this._banner('被抵抗', 360, 'resist');
                    this._hit(ev.uid, !!ev.crit);
                    const tail = ev.dot ? `（${ev.status || '持续伤害'}）` : (ev.crit ? '（暴击）' : '');
                    this._log(`${nm(ev.uid)} 受到 ${ev.value} 点伤害${tail}`, 'damage');
                }
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(ev.crit ? 340 : 230));
                break;
            }
            case 'heal': {
                const v = this.view[ev.uid];
                if (v) v.hp = ev.hp != null ? ev.hp : Math.min(v.hp + (ev.value || 0), 99999);
                this._float(ev.uid, `+${ev.value}`, 'heal');
                this._log(`${nm(ev.uid)} 恢复 ${ev.value} 点生命`, 'heal');
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(240));
                break;
            }
            case 'mp': {
                const v = this.view[ev.uid];
                if (v) v.mp = ev.mp != null ? ev.mp : v.mp;
                if (ev.delta) this._float(ev.uid, `${ev.delta > 0 ? '+' : ''}${ev.delta}`, 'mp');
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(90));
                break;
            }
            case 'shield_add':
            case 'shield': {
                const v = this.view[ev.uid];
                if (v) v.shield = ev.shield || 0;
                if (ev.absorbed) this._float(ev.uid, `🛡-${ev.absorbed}`, 'shield');
                else if (v && v.shield > 0) this._float(ev.uid, `🛡+${Math.round(v.shield)}`, 'shield');
                if (ev.t === 'shield_add' && v && v.shield > 0) {
                    this._log(`${nm(ev.uid)} 获得 ${Math.round(v.shield)} 点护盾`, 'status');
                }
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(150));
                break;
            }
            case 'rage': {
                const v = this.view[ev.uid];
                if (v) v.rage = ev.value != null ? ev.value : v.rage;
                this._syncBars(ev.uid);
                break;
            }
            case 'status_add': {
                const v = this.view[ev.uid];
                const st = ev.status || {};
                if (v) {
                    const i = v.statuses.findIndex(s => s.key === st.key && s.stat === st.stat);
                    if (i >= 0) v.statuses[i] = Object.assign({}, st);
                    else v.statuses.push(Object.assign({}, st));
                }
                this._float(ev.uid, `${st.icon || ''}${st.name || ''}`, 'status');
                this._log(`${nm(ev.uid)} 获得【${st.name || st.key}】${st.turns ? `（${st.turns} 回合）` : ''}`, 'status');
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(220));
                break;
            }
            case 'status_remove': {
                const v = this.view[ev.uid];
                if (v) v.statuses = v.statuses.filter(s => s.key !== ev.key);
                this._syncBars(ev.uid);
                break;
            }
            case 'cleanse': {
                const v = this.view[ev.uid];
                if (v) v.statuses = v.statuses.filter(s => s.kind === 'buff' || s.kind === 'hot');
                this._float(ev.uid, '净化', 'heal');
                this._log(`${nm(ev.uid)} 清除了 ${ev.count} 个负面状态`, 'status');
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(200));
                break;
            }
            case 'resist_status': {
                this._float(ev.uid, '抵抗', 'resist');
                this._log(`${nm(ev.uid)} 抵抗了【${ev.name || '效果'}】`, 'status');
                await Utils.sleep(this._d(160));
                break;
            }
            case 'miss': {
                this._float(ev.uid, 'MISS', 'miss');
                this._log(`${nm(ev.uid)} 的【${ev.skill || '攻击'}】落空了`, 'miss');
                await Utils.sleep(this._d(220));
                break;
            }
            case 'down': {
                const el = this.els[ev.uid];
                if (el && el.card) el.card.classList.add('down');
                this._setArt(ev.uid, 'down');
                this._log(`${nm(ev.uid)} 倒下了！`, 'down');
                await this._banner(`${nm(ev.uid)} 倒下`, 620, 'down');
                break;
            }
            case 'revive': {
                const el = this.els[ev.uid];
                if (el && el.card) el.card.classList.remove('down');
                if (this._artHold) delete this._artHold[ev.uid];
                const v = this.view[ev.uid];
                if (v) v.hp = ev.hp != null ? ev.hp : v.hp;
                this._setArt(ev.uid, null);
                this._syncBars(ev.uid);
                this._log(`${nm(ev.uid)} 重新站了起来！`, 'heal');
                await this._banner('复活！', 520, 'heal');
                break;
            }
            case 'phase': {
                this._setArt(ev.uid, null);
                this._log(`${nm(ev.uid)} 进入【${ev.name}】`, 'phase');
                await this._banner(ev.name || '形态变化', 780, 'phase');
                break;
            }
            case 'banter': {
                await this._banter(ev.speaker, ev.line, ev.expression);
                break;
            }
            case 'item': {
                this._float(ev.uid, `◈${ev.item}`, 'heal');
                this._log(`${nm(ev.uid)} 使用了【${ev.item}】`, 'item');
                await Utils.sleep(this._d(240));
                break;
            }
            case 'defend': {
                const v = this.view[ev.uid];
                if (v) { v.defending = true; v.rage = ev.rage != null ? ev.rage : v.rage; }
                this._setArt(ev.uid, 'defend', this._d(900));
                this._float(ev.uid, '防御', 'guard');
                this._log(`${nm(ev.uid)} 摆出防御姿态`, 'action');
                this._syncBars(ev.uid);
                await Utils.sleep(this._d(200));
                break;
            }
            case 'skip': {
                this._float(ev.uid, '无法行动', 'miss');
                this._log(`${nm(ev.uid)} 无法行动`, 'status');
                await Utils.sleep(this._d(260));
                break;
            }
            case 'flee_ok': {
                this._log('成功脱离战斗', 'system');
                await this._banner('脱离战斗', 700, 'flee');
                break;
            }
            case 'flee_fail': {
                this._log('逃跑失败！', 'system');
                await this._banner('逃跑失败', 600, 'lose');
                break;
            }
            case 'victory': {
                this._log('战斗胜利！', 'system');
                await this._banner('战斗胜利', 900, 'victory');
                break;
            }
            case 'defeat': {
                this._log('战斗失败…', 'system');
                await this._banner('战斗失败', 900, 'defeat');
                break;
            }
            case 'cooldown':
            default:
                break;
        }
    },

    /* ================= 演出小工具 ================= */

    _float(uid, text, cls) {
        const card = (this.els[uid] || {}).card;
        if (!card || !text) return;
        const el = document.createElement('div');
        el.className = 'float-text' + (cls ? ' ' + cls : '');
        el.style.setProperty('--rx', (Math.random() * 34 - 17).toFixed(0) + 'px');
        el.textContent = text;
        card.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    },

    _hit(uid, crit) {
        const card = (this.els[uid] || {}).card;
        if (!card) return;
        card.classList.remove('hit', 'hit-crit');
        void card.offsetWidth;
        card.classList.add(crit ? 'hit-crit' : 'hit');
        setTimeout(() => card.classList.remove('hit', 'hit-crit'), 480);
    },

    _castFx(uid, element) {
        const card = (this.els[uid] || {}).card;
        if (!card) return;
        const color = { fire: '#ff7a3d', water: '#5bb8ff', wind: '#7ee7a5',
                        earth: '#d3a559', light: '#ffe9a3', dark: '#b07dff' }[element] || '#d4af37';
        card.style.setProperty('--fx', color);
        card.classList.remove('cast-fx');
        void card.offsetWidth;
        card.classList.add('cast-fx');
        setTimeout(() => card.classList.remove('cast-fx'), 720);
    },

    _castName(uid, name, ult) {
        const card = (this.els[uid] || {}).card;
        if (!card || !name) return;
        const el = document.createElement('div');
        el.className = 'cast-name' + (ult ? ' ult' : '');
        el.textContent = name;
        card.appendChild(el);
        setTimeout(() => el.remove(), 950);
    },

    _focus(uid) {
        Object.keys(this.els).forEach(k => {
            const c = this.els[k].card;
            if (c) c.classList.toggle('acting', k === uid);
        });
    },

    async _banner(text, ms = 700, cls = '') {
        const el = Utils.$('#battle-banner');
        if (!el) { if (!this.skip) await Utils.sleep(ms); return; }
        el.textContent = text;
        el.classList.remove('hidden', 'crit', 'weak', 'resist', 'phase', 'victory', 'defeat', 'down', 'heal', 'flee', 'lose');
        if (cls) el.classList.add(cls);
        el.classList.add('show');
        await Utils.sleep(this._d(ms));
        el.classList.remove('show');
        el.classList.add('hidden');
    },

    _hideBanner() {
        const el = Utils.$('#battle-banner');
        if (el) { el.classList.remove('show'); el.classList.add('hidden'); }
    },

    async _banter(speaker, text, expression) {
        const box = Utils.$('#battle-banter');
        if (!box || !text) return;
        const n = Utils.$('#banter-name');
        const t = Utils.$('#banter-text');
        if (n) n.textContent = speaker || '';
        if (t) t.textContent = text;
        Utils.show(box);
        box.classList.remove('show');
        void box.offsetWidth;
        box.classList.add('show');
        this._log(`${speaker || ''}：「${text}」`, 'banter');
        await Utils.sleep(this._d(1500));
        box.classList.remove('show');
        Utils.hide(box);
    },

    _log(text, kind = 'info') {
        const wrap = Utils.$('#battle-log');
        if (!wrap) return;
        const line = document.createElement('div');
        line.className = 'log-line ' + kind;
        line.textContent = text;
        wrap.appendChild(line);
        while (wrap.children.length > 60 && wrap.children[0]) {
            wrap.removeChild(wrap.children[0]);
        }
        wrap.scrollTop = wrap.scrollHeight;
    },

    /* ================= 主循环 ================= */

    _afterPlay() {
        this.busy = false;
        this._syncAll();
        const st = this.state;
        if (!st) return;
        if (st.status !== 'active') { this._finish(); return; }

        const uid = st.turn_uid || this.awaitUid;
        const actor = uid ? this._unit(uid) : null;
        if (!actor) {
            if (this._nudgeGuard++ < 3) { this._nudge(); return; }
            st.status = 'fled';
            this._finish();
            return;
        }
        if (!actor.alive) { this._nudge(); return; }

        if (this.auto) { this._doAuto(); return; }

        this.awaitUid = actor.uid;
        this._openCommand(actor);
    },

    async _nudge() {
        if (this.busy || !this.battleId) return;
        this.busy = true;
        try {
            const res = await API.battle.v2Action(this.battleId, {});
            this.state = res.state;
            await this.play(res.events || []);
        } catch (e) {
            this.busy = false;
            Utils.toast('战斗推进失败：' + (e.message || e));
        }
    },

    async _submit(action) {
        if (this.busy || !this.battleId) return;
        const uid = action.uid || this.awaitUid;
        this._exitTargetMode();
        this._closeCommand();
        this.busy = true;
        this._syncCommands();
        let res;
        try {
            res = await API.battle.v2Action(this.battleId, Object.assign({}, action, { uid }));
        } catch (e) {
            this.busy = false;
            Utils.toast('指令失败：' + (e.message || e));
            this._afterPlay();
            return;
        }
        this.state = res.state;
        this._nudgeGuard = 0;
        await this.play(res.events || []);
    },

    async _doAuto() {
        if (this._autoRunning) return;
        this._autoRunning = true;
        try {
            while (this.auto && this.state && this.state.status === 'active' && this.state.turn_uid) {
                this.busy = true;
                this._closeCommand();
                this._syncCommands();
                let res;
                try {
                    res = await API.battle.v2Action(this.battleId, {
                        uid: this.state.turn_uid, type: 'auto',
                    });
                } catch (e) {
                    this.auto = false;
                    this.busy = false;
                    Utils.toast('自动战斗中断：' + (e.message || e));
                    break;
                }
                this.state = res.state;
                await this.play(res.events || []);
                if (this.state.status !== 'active') break;
            }
        } finally {
            this._autoRunning = false;
            if (this.auto && (!this.state || this.state.status !== 'active')) {
                this.auto = false;
                this._setTools();
            }
        }
        if (!this.auto) this._afterPlay();
    },

    async setAuto(on) {
        this.auto = !!on;
        this._setTools();
        if (this.auto) {
            this.awaitUid = null;
            this._closeCommand();
            this._syncCommands();
            this._doAuto();
        } else {
            if (!this.busy) this._afterPlay();
        }
    },

    /* ================= 指令面板 ================= */

    _openCommand(actor) {
        this._closeSubOnly();
        this.awaitUid = actor.uid;
        const hint = Utils.$('#battle-hint');
        const who = actor.uid === 'p1' ? '你的回合' : `${actor.name} 的回合`;
        if (hint) hint.textContent = `${who} · 请选择行动`;
        this._setActor(actor);
        Utils.show('#battle-command');
        Utils.show('#cmd-main');
        this._syncCommands();
        this._focus(actor.uid);
    },

    _setActor(actor) {
        const el = Utils.$('#battle-actor');
        if (!el) return;
        el.textContent = actor ? `${actor.name} 行动` : '';
        el.classList.toggle('auto', !actor);
    },

    _closeCommand() {
        this._closeSubOnly();
        this.awaitUid = this.awaitUid;
        this._syncCommands();
        const hint = Utils.$('#battle-hint');
        if (hint && this.auto) hint.textContent = '自动战斗中…';
    },

    _closeSubOnly() {
        const sub = Utils.$('#cmd-sub');
        if (sub) { sub.innerHTML = ''; Utils.hide(sub); }
        const main = Utils.$('#cmd-main');
        if (main) Utils.show(main);
    },

    _backToMain() {
        this.pending = null;
        this._exitTargetMode();
        this._closeSubOnly();
        const hint = Utils.$('#battle-hint');
        const actor = this.awaitUid ? this._unit(this.awaitUid) : null;
        if (hint && actor) hint.textContent = `${actor.name} 的回合 · 请选择行动`;
    },

    _syncCommands() {
        const st = this.state;
        const actor = this.awaitUid ? this._unit(this.awaitUid) : null;
        const canAct = !!(st && st.status === 'active' && this.awaitUid && !this.busy && !this.auto);
        const main = Utils.$('#cmd-main');
        if (main) {
            main.querySelectorAll('.cmd-btn').forEach(b => {
                b.disabled = !canAct;
                b.classList.toggle('active', !!this.pending && b.dataset.cmd === this.pending.type);
            });
        }
        const rage = (this.view[this.awaitUid] || {}).rage || (actor && actor.rage) || 0;
        const ult = main && main.querySelector('.cmd-btn[data-cmd="ultimate"]');
        if (ult) {
            const i = ult.querySelector('i');
            if (i) i.textContent = `怒气 ${Math.round(rage)}/100`;
            ult.classList.toggle('ready', rage >= 100);
            if (canAct && rage < 100) ult.disabled = true;
        }
        const flee = main && main.querySelector('.cmd-btn[data-cmd="flee"]');
        if (flee) flee.disabled = !canAct || !!(st && (st.config || {}).allow_flee === false);
    },

    _setTools() {
        const a = Utils.$('#btn-auto');
        if (a) {
            a.textContent = this.auto ? '自动 ON' : '自动 OFF';
            a.classList.toggle('on', this.auto);
        }
        const s = Utils.$('#btn-skip');
        if (s) {
            s.textContent = this.skip ? '跳过 ON' : '跳过演出';
            s.classList.toggle('on', this.skip);
        }
    },

    /* ================= 技能 / 物品 / 目标 ================= */

    async _onCmd(cmd) {
        if (this.busy || this.auto || !this.awaitUid || !this.battleId) return;
        const actor = this._unit(this.awaitUid);
        if (!actor) return;
        switch (cmd) {
            case 'attack': this._selectTarget('attack', null); break;
            case 'defend': await this._submit({ type: 'defend', uid: actor.uid }); break;
            case 'flee': await this._submit({ type: 'flee', uid: actor.uid }); break;
            case 'skill': this._showSkills(actor, false); break;
            case 'ultimate': this._showSkills(actor, true); break;
            case 'item': this._showItems(actor); break;
            default: break;
        }
    },

    _skillTag(s) {
        const kinds = s.kinds || [];
        const tags = [];
        if (s.target_type === 'all_enemies') tags.push('群体');
        else if (s.target_type === 'all_allies') tags.push('群体辅助');
        else if (s.target_type === 'single_ally' || s.target_type === 'self') tags.push('辅助');
        else tags.push('单体');
        if (kinds.includes('heal')) tags.push('治疗');
        if (kinds.includes('dot')) tags.push('持续');
        if (kinds.includes('control')) tags.push('控制');
        if (kinds.includes('shield')) tags.push('护盾');
        if (s.is_ultimate) tags.unshift('神通');
        return tags.join('·');
    },

    _showSkills(actor, onlyUltimate) {
        const sub = Utils.$('#cmd-sub');
        const main = Utils.$('#cmd-main');
        if (!sub) return;
        const list = (actor.skills || []).filter(s => !!s.is_ultimate === !!onlyUltimate);
        const rows = list.map(s => {
            const cost = [];
            if (s.mp_cost) cost.push(`灵力 ${s.mp_cost}`);
            if (s.hp_cost) cost.push(`生命 ${s.hp_cost}`);
            if (s.rage_cost) cost.push(`怒气 ${s.rage_cost}`);
            const ok = s.usable !== false;
            return `<button class="sub-btn skill" data-id="${s.id}" ${ok ? '' : 'disabled'}
                        title="${this._esc(s.description || '')}">
                <b>${this._esc(s.name)}</b>
                <span class="sb-cost">${cost.join(' · ') || '无消耗'}</span>
                <span class="sb-tag">${this._skillTag(s)}</span>
                ${ok ? '' : `<span class="sb-reason">${this._esc(s.reason || '不可用')}</span>`}
            </button>`;
        }).join('');
        const empty = list.length ? '' :
            `<div class="sub-empty">${onlyUltimate ? '怒气不足，暂无可用神通' : '暂时没有可用技能'}</div>`;
        sub.innerHTML = `${rows}${empty}
            <button class="sub-btn back" data-back="1">返回</button>`;
        Utils.show(sub);
        if (main) Utils.hide(main);
        const hint = Utils.$('#battle-hint');
        if (hint) hint.textContent = onlyUltimate ? '选择释放的神通' : '选择要使用的技能';
    },

    _showItems(actor) {
        const sub = Utils.$('#cmd-sub');
        const main = Utils.$('#cmd-main');
        if (!sub) return;
        const list = actor.items || [];
        const rows = list.map(it => `<button class="sub-btn item" data-item-id="${it.id}">
                <b>${this._esc(it.name)}</b>
                <span class="sb-cost">剩余 ${it.quantity}</span>
                <span class="sb-tag">${this._esc(it.description || '').slice(0, 12)}</span>
            </button>`).join('');
        const empty = list.length ? '' : '<div class="sub-empty">背包中没有可用的道具</div>';
        sub.innerHTML = `${rows}${empty}
            <button class="sub-btn back" data-back="1">返回</button>`;
        Utils.show(sub);
        if (main) Utils.hide(main);
        const hint = Utils.$('#battle-hint');
        if (hint) hint.textContent = '选择要使用的道具';
    },

    _selectTarget(type, skill) {
        const st = this.state;
        const actor = this.awaitUid ? this._unit(this.awaitUid) : null;
        if (!st || !actor) return;
        const ttype = (skill && skill.target_type) || 'single_enemy';
        const base = { type, uid: actor.uid };
        if (skill && skill.id != null) base.skill_id = skill.id;

        const autoAll = (targetUid) => this._submit(Object.assign({}, base, { target_uid: targetUid }));

        if (ttype === 'self') return autoAll(actor.uid);
        if (ttype === 'all_enemies' || ttype === 'all_allies') return autoAll(null);

        const pool = st.units.filter(u => u.alive && (ttype === 'single_ally'
            ? u.side === actor.side : u.side !== actor.side));
        if (!pool.length) {
            Utils.toast(ttype === 'single_ally' ? '没有可援助的队友' : '没有可选的目标');
            return;
        }
        if (pool.length === 1) return autoAll(pool[0].uid);

        this.pending = { type, skill };
        this.pool = pool.map(u => u.uid);
        this._enterTargetMode();
    },

    _enterTargetMode() {
        this.pool.forEach(uid => {
            const c = (this.els[uid] || {}).card;
            if (c) c.classList.add('targetable');
        });
        const hint = Utils.$('#battle-hint');
        if (hint) hint.textContent = '请点击立绘选择目标';
        const sub = Utils.$('#cmd-sub');
        const main = Utils.$('#cmd-main');
        if (sub) {
            sub.innerHTML = `<button class="sub-btn back" data-back="1">取消</button>`;
            Utils.show(sub);
        }
        if (main) Utils.hide(main);
        this._syncCommands();
    },

    _exitTargetMode() {
        (this.pool || []).forEach(uid => {
            const c = (this.els[uid] || {}).card;
            if (c) c.classList.remove('targetable');
        });
        this.pool = [];
        this.pending = null;
    },

    _onUnitClick(uid) {
        if (!this.pool.length) return Promise.resolve();
        if (this.pool.indexOf(uid) < 0) return Promise.resolve();
        const p = this.pending;
        this._exitTargetMode();
        return this._submit({
            type: p.type, uid: this.awaitUid,
            skill_id: p.skill ? p.skill.id : undefined,
            target_uid: uid,
        });
    },

    /* ================= 结算 ================= */

    async _finish() {
        this._closeCommand();
        this._exitTargetMode();
        this.awaitUid = null;
        this._syncCommands();
        await this._settle();
        this._showResult(this.state ? this.state.status : '');
    },

    async _settle() {
        if (this.rewards !== null) return this.rewards;
        this.rewards = {};
        if (!this.battleId) return this.rewards;
        try {
            const res = await API.battle.v2Settle(this.battleId);
            this.rewards = res.rewards || {};
            this._applyRewardsToPlayer(this.rewards);
        } catch (e) {
            console.error('战斗结算失败:', e);
        }
        return this.rewards;
    },

    _applyRewardsToPlayer(rw) {
        const ch = rw && rw.character;
        if (!ch) return;
        const keys = ['level', 'exp', 'realm_level', 'hp', 'max_hp', 'mp', 'max_mp',
                      'attack', 'defense', 'speed', 'luck'];
        if (GameState.player) {
            keys.forEach(k => { if (ch[k] != null) GameState.player[k] = ch[k]; });
            GameState.updatePlayerUI();
        }
        if (GameState.userCharacter) {
            keys.forEach(k => { if (ch[k] != null) GameState.userCharacter[k] = ch[k]; });
        }
        if (typeof App !== 'undefined' && App._currentUC &&
            (App._currentUC.id === ch.id)) {
            keys.forEach(k => { if (ch[k] != null) App._currentUC[k] = ch[k]; });
        }
    },

    _row(label, value) {
        return `<div class="br-row"><span>${this._esc(label)}</span><b>${this._esc(String(value))}</b></div>`;
    },

    _showResult(status) {
        const box = Utils.$('#battle-result');
        if (!box) return;
        const rw = this.rewards || {};
        const win = status === 'player_won';
        const fled = status === 'fled';
        const title = win ? '战斗胜利' : (fled ? '成功脱离' : '战斗失败');

        const rows = [];
        if (win) {
            rows.push(this._row('获得经验', `+${rw.exp || 0}`));
            const lv = rw.level_up || [];
            if (lv.length) {
                const from = lv[0].level - 1;
                rows.push(this._row('等级提升', `Lv.${from} → Lv.${lv[lv.length - 1].level}`));
                if (lv.some(x => x.realm_up)) rows.push(this._row('境界突破', '每 5 级一次'));
            }
            const extra = rw.extra || {};
            if (extra.realm) rows.push(this._row('境界突破', extra.realm));
            if (extra.skills && extra.skills.length) rows.push(this._row('习得技能', extra.skills.join('、')));
            if (rw.character) {
                rows.push(this._row('当前状态', `Lv.${rw.character.level}　EXP ${rw.character.exp}`));
            }
        } else if (fled) {
            rows.push(this._row('结果', '你脱离了战斗'));
        } else {
            rows.push(this._row('结果', '你失去了意识…'));
            if (rw.character) {
                rows.push(this._row('当前生命', `${rw.character.hp} / ${rw.character.max_hp}`));
            }
        }

        const drops = rw.drops || [];
        const dropHtml = drops.length ? `<div class="br-drops">${drops.map(d =>
            `<div class="br-drop">${d.image ? `<img src="${d.image}" alt="">` : '<span class="bd-ph">◈</span>'}
             <b>${this._esc(d.name || '物品')}</b><i>×${d.quantity || 1}</i></div>`).join('')}</div>` : '';

        const actions = [];
        if (win) {
            actions.push('<button class="br-btn primary" data-act="continue">继续剧情</button>');
            actions.push('<button class="br-btn" data-act="replay">再打一次</button>');
        } else if (fled) {
            actions.push('<button class="br-btn primary" data-act="continue">继续</button>');
        } else {
            actions.push('<button class="br-btn primary" data-act="retry">再战一次</button>');
            actions.push('<button class="br-btn" data-act="continue">放弃战斗</button>');
        }

        box.innerHTML = `
            <div class="br-card ${win ? 'win' : (fled ? 'flee' : 'lose')}">
                <div class="br-title">${title}</div>
                <div class="br-rows">${rows.join('')}</div>
                ${dropHtml}
                <div class="br-actions">${actions.join('')}</div>
            </div>`;
        Utils.show(box);
        this._raf(() => box.classList.add('show'));
    },

    async _onResultClick(act) {
        if (act === 'retry' || act === 'replay') {
            const box = Utils.$('#battle-result');
            if (box) { box.classList.remove('show'); Utils.hide(box); }
            this.battleId = null;
            this.state = null;
            this.rewards = null;
            await this.start(this.ctx);
            return;
        }
        await this._exit();
    },

    async _exit() {
        const status = this.state ? this.state.status : '';
        const cfg = (this.state && this.state.config) || {};
        const nodeId = this.ctx.storyNodeId;
        this._closeLayer();

        if (typeof DialogueUI !== 'undefined') {
            DialogueUI.callback = (res) => App.handleStoryChoice(res);
        }

        const special = status === 'player_won' ? cfg.victory_node_id
            : status === 'enemy_won' ? cfg.defeat_node_id
                : status === 'fled' ? cfg.flee_node_id : null;

        if (special && typeof DialogueUI !== 'undefined') {
            await DialogueUI.showNode(special, (res) => App.handleStoryChoice(res));
            return;
        }
        if (this.ctx.postChoices && this.ctx.postChoices.length && typeof DialogueUI !== 'undefined') {
            Utils.setText('#speaker-name', '旁白');
            Utils.setText('#dialogue-text', status === 'player_won' ? '敌人倒下了……' : '……');
            DialogueUI.showChoices(this.ctx.postChoices);
            return;
        }
        if (typeof App !== 'undefined' && nodeId) {
            await App.handleStoryChoice({ nextAfter: nodeId });
        }
    },

    /* ================= 事件绑定（一次） ================= */

    _bindOnce() {
        if (this._bound) return;
        this._bound = true;

        Utils.on('#cmd-main', 'click', (e) => {
            const btn = e.target.closest('.cmd-btn');
            if (!btn || btn.disabled) return;
            this._onCmd(btn.dataset.cmd);
        });

        Utils.on('#cmd-sub', 'click', (e) => {
            const btn = e.target.closest('.sub-btn');
            if (!btn || btn.disabled) return;
            if (btn.dataset.back) { this._backToMain(); return; }
            const actor = this.awaitUid ? this._unit(this.awaitUid) : null;
            if (!actor) return;
            if (btn.dataset.id != null) {
                const sk = (actor.skills || []).find(s => String(s.id) === String(btn.dataset.id));
                if (sk) this._selectTarget('skill', sk);
            } else if (btn.dataset.itemId != null) {
                const it = (actor.items || []).find(i => String(i.id) === String(btn.dataset.itemId));
                if (it) {
                    // 物品默认给自己 / 血量最低的队友；对敌道具交给引擎的 target 规则
                    this._submit({ type: 'item', uid: actor.uid, item_id: it.id });
                }
            }
        });

        Utils.on('#battle-result', 'click', (e) => {
            const btn = e.target.closest('.br-btn');
            if (!btn) return;
            this._onResultClick(btn.dataset.act);
        });

        Utils.on('#btn-auto', 'click', () => this.setAuto(!this.auto));
        Utils.on('#btn-skip', 'click', () => {
            this.skip = !this.skip;
            this._setTools();
            if (this.skip) Utils.toast('已跳过演出');
        });

        document.addEventListener('keydown', (e) => {
            if (!GameState.isInCombat) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key === 'a' || e.key === 'A') { this.setAuto(!this.auto); }
            else if (e.key === ' ') { e.preventDefault(); this.skip = !this.skip; this._setTools(); }
            else if (e.key === 'Escape') {
                if (this.pool.length) this._backToMain();
            } else if (e.key === '1') this._onCmd('attack');
            else if (e.key === '2') this._onCmd('skill');
            else if (e.key === '3') this._onCmd('item');
            else if (e.key === '4') this._onCmd('defend');
            else if (e.key === '5') this._onCmd('ultimate');
        });
    },

    /* ================= 杂项 ================= */

    _raf(fn) {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
        else setTimeout(fn, 16);
    },

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
};

if (typeof window !== 'undefined') window.CombatUI = CombatUI;
