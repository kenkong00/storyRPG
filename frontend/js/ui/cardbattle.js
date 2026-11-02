// ==========================================================================
// 卡牌对决 · 前台战斗界面（服务端权威 · 事件流驱动）
//
// 分工
// ----
// 后端 services/card_battle_engine.py：全部规则与数值。
// 这里只做两件事：① 把后端事件一条条演出来；② 在轮到自己时把操作 POST 回去。
// 所以「改卡牌数值 / 加新卡 / 调职业面板」都不需要动这个文件。
//
// 事件类型（后端 emit）：
//   log / play / hero_hit / guard_hit / guard_spawn / guard_clear / buff / heal /
//   draw / burn / discard / fatigue / status / status_clear / cleanse / steal /
//   crit_perk / round_start / turn_start / turn_end / await_ai / ai_done /
//   emotion / game_over / state / error / deal
//
// 入口：
//   CardBattleUI.start({ storyNodeId, node })   —— 剧情战斗节点直接调用
//   CardBattleUI.startDemo()                    —— 平台「卡牌对决」入口，自选职业试玩
// ==========================================================================

const CardBattleUI = {
  catalog: null,
  battleId: null,
  state: null,
  ctx: {},
  busy: false,
  over: false,
  pinnedGuard: null,
  refs: {},
  els: {},
  _mounted: false,
  _audio: null,
  _bound: false,

  ICONS: {
    attack: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6.9 15.1l-2.1 2.1 1.4 1.4 2.1-2.1 1.4 1.4-2.1 2.1 1.1 1.1 2.6-2.6 1.8-4.4L9.4 10l-4.4 1.8L2.4 14.4l1.1 1.1zM14 2l-2.9 5.3 5.6 5.6L22 10z"/></svg>',
    guard: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2L4 5v6.5c0 5 3.4 9.7 8 10.5 4.6-.8 8-5.5 8-10.5V5z"/></svg>',
    special: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.2 6.2L20 12l-5.8 3.8L12 22l-2.2-6.2L4 12l5.8-3.8z"/></svg>',
    skill: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3 7h7l-5.5 4.4L18.6 21 12 16.7 5.4 21l2.1-7.6L2 9h7z"/></svg>',
    dialogue: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16a1 1 0 011 1v11a1 1 0 01-1 1H9l-4 4v-4H4a1 1 0 01-1-1V5a1 1 0 011-1z"/></svg>',
    log: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h10v2H4z"/></svg>',
  },

  // 卡牌出牌的「飞向哪儿」不再按 category 猜——后端 play 事件直接给 target
  // （self / foe / guard_self / guard_foe），演出只看这个字段。

  // ======================================================================
  // 入口
  // ======================================================================
  async start(opts = {}) {
    this.ctx = {
      storyNodeId: opts.storyNodeId ?? opts.story_node_id ?? null,
      node: opts.node || null,
      postChoices: opts.postChoices || [],
      demo: false,
    };
    this._mount();
    try {
      await this.loadCatalog();
    } catch (e) {
      console.error('卡牌目录加载失败', e);
      Utils.toast('卡牌系统未就绪：' + (e.message || e));
      throw e;
    }
    // 后台「卡牌系统 → 提示词与设置」可一键关掉卡牌战斗，回退旧的回合制战斗
    if (Number((this.catalog.settings || {}).battle_enabled) === 0) {
      throw new Error('卡牌战斗已在后台关闭');
    }
    const body = {
      story_node_id: this.ctx.storyNodeId,
      user_character_id: (typeof GameState !== 'undefined' && GameState.player)
        ? (GameState.player.uc_id || GameState.player.id || null) : null,
      source: this.ctx.storyNodeId ? 'story' : 'demo',
    };
    const res = await this.post('/api/cardgame/battle/start', body);
    this._open(res);
    return true;
  },

  // 后台「卡牌系统 → 对战演示」配置好双方人物与职业后，前台按这套参数直接开局。
  // 不带 storyNodeId，所以走的是 source=demo（不写剧情进度、不影响存档）。
  async startConfigured(opts = {}) {
    this._mount();
    await this.loadCatalog();
    if (Number((this.catalog.settings || {}).battle_enabled) === 0) {
      throw new Error('卡牌战斗已在后台关闭');
    }
    this.ctx = { storyNodeId: null, node: null, postChoices: [], demo: true };
    const body = { source: 'demo' };
    if (opts.pchar) body.player_character_id = Number(opts.pchar);
    if (opts.pclass) body.player_class = String(opts.pclass);
    if (opts.echar) body.enemy_character_id = Number(opts.echar);
    if (opts.eclass) body.enemy_class = String(opts.eclass);
    const res = await this.post('/api/cardgame/battle/start', body);
    this._open(res);
    return true;
  },

  async startDemo() {
    this._mount();
    await this.loadCatalog();
    const classes = this.catalog.classes.filter(c => c.enabled !== 0);
    const box = this.els.modalBox;
    box.innerHTML = `
      <div class="cb-modal-title">卡牌对决 · 选择你的职业</div>
      <div class="cb-modal-sub">
        六职业各 30 张牌组（通用 18 + 专属 12）。对局按「比速度 → 法力出牌 → 清守卫 → 扣 DEF → 扣 HP」推进；
        右边战斗对话与表情由后台规则触发生成。
      </div>
      <div class="cb-class-grid">
        ${classes.map(c => `
          <div class="cb-class-item" data-class="${c.code}">
            <div class="cb-class-name">${c.name}</div>
            <div class="cb-class-stats">
              <span>HP <b>${c.hp}</b></span>
              <span>DEF <b>${c.defense}</b></span>
              <span>SPD <b>${c.spd}</b></span>
              <span>CRI <b>${c.cri}%</b></span>
            </div>
            <div class="cb-class-role">${c.role || ''}</div>
          </div>`).join('')}
      </div>`;
    this.els.modal.classList.add('on');
    box.querySelectorAll('[data-class]').forEach(el => {
      el.addEventListener('click', async () => {
        // 这次点击就是用户手势：顺手把浏览器音频解锁，演示里的语音才出得来
        if (window.TTSManager) window.TTSManager.unlockAudio();
        const pc = el.dataset.class;
        const others = classes.filter(c => c.code !== pc);
        const ec = others[Math.floor(Math.random() * others.length)].code;
        this.ctx = { storyNodeId: null, node: null, postChoices: [], demo: true };
        this.els.modal.classList.remove('on');
        try {
          const res = await this.post('/api/cardgame/battle/start', {
            player_class: pc, enemy_class: ec, source: 'demo',
          });
          this._open(res);
        } catch (e) {
          Utils.toast('开局失败：' + (e.message || e));
        }
      });
    });
  },

  // ======================================================================
  // 数据 / 请求
  // ======================================================================
  async loadCatalog(force = false) {
    if (this.catalog && !force) return this.catalog;
    const res = await fetch('/api/cardgame/catalog');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    this.catalog = await res.json();
    return this.catalog;
  },

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    try {
      if (typeof Auth !== 'undefined' && Auth.token) h['X-User-Token'] = Auth.token;
    } catch (e) { /* ignore */ }
    return h;
  },

  async post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: this._headers(), body: JSON.stringify(body || {}) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || ('HTTP ' + res.status));
    }
    return res.json();
  },

  // ======================================================================
  // DOM 骨架
  // ======================================================================
  _mount() {
    if (this._mounted) return;
    this._mounted = true;
    const el = document.createElement('div');
    el.id = 'cb-layer';
    el.innerHTML = `
      <div class="cb-bg"></div>
      <div class="cb-vignette"></div>

      <header class="cb-top">
        <div class="cb-round"><span>ROUND</span><b id="cb-round">1</b></div>
        <div class="cb-speed" id="cb-speed">—</div>
        <div class="cb-tools">
          <button class="cb-tool cb-tool-ico" data-cb="dialogue" title="战斗对话">${this.ICONS.dialogue}<i>对话</i></button>
          <button class="cb-tool cb-tool-ico" data-cb="log" title="战报">${this.ICONS.log}<i>战报</i></button>
          <button class="cb-tool" data-cb="emote">表情</button>
          <button class="cb-tool" data-cb="rules">规则</button>
          <button class="cb-tool danger" data-cb="flee">脱离</button>
        </div>
      </header>

      <div class="cb-main">
        <section class="cb-board">
          <div class="cb-side-row enemy">
            <div class="cb-hero enemy" id="cb-hero-1"></div>
            <div class="cb-foe-hand">
              <div class="cb-hand-back" id="cb-handback"></div>
              <div class="cb-hand-back-label" id="cb-enemy-count"></div>
            </div>
          </div>

          <!-- 前线守卫交战区：守卫牌像扑克一样摊在桌面上，两排分别属于对手 / 自己 -->
          <div class="cb-arena">
            <div class="cb-lane foe" id="cb-lane-1">
              <span class="cb-lane-tag">对手防线</span>
              <div class="cb-guards" id="cb-guards-1"></div>
            </div>
            <div class="cb-mid"><div class="cb-phase" id="cb-phase">准备中</div></div>
            <div class="cb-lane self" id="cb-lane-0">
              <span class="cb-lane-tag">你的防线</span>
              <div class="cb-guards" id="cb-guards-0"></div>
            </div>
          </div>

          <div class="cb-side-row self">
            <div class="cb-hero self" id="cb-hero-0"></div>
          </div>
        </section>
      </div>

      <div class="cb-drawer-scrim" id="cb-drawer-scrim"></div>
      <!-- 战斗对话 / 战报：顶栏图标触发，从右侧滑出抽屉 -->
      <div class="cb-drawer" id="cb-drawer-dialogue">
        <div class="cb-drawer-head"><span>战斗对话</span><button class="cb-drawer-x" data-drawer="dialogue" aria-label="关闭">✕</button></div>
        <div class="cb-dialogue-list" id="cb-dialogue"></div>
      </div>
      <div class="cb-drawer" id="cb-drawer-log">
        <div class="cb-drawer-head"><span>战报</span><button class="cb-drawer-x" data-drawer="log" aria-label="关闭">✕</button></div>
        <div class="cb-log-list" id="cb-log"></div>
      </div>

      <div class="cb-dock">
        <div class="cb-dock-info">
          <span>牌库 <b id="cb-deck">0</b></span>
          <span>手牌 <b id="cb-handcount">0</b></span>
          <span id="cb-pinned"></span>
          <span class="cb-hint" id="cb-hint">点击卡牌出牌 · 点击敌方守卫可指定目标</span>
        </div>
        <div class="cb-hand" id="cb-hand"></div>
        <div class="cb-dock-actions">
          <button class="cb-endturn" id="cb-endturn">结束回合</button>
        </div>
      </div>

      <div class="cb-floats" id="cb-floats"></div>
      <div class="cb-showcase" id="cb-showcase"></div>
      <div class="cb-banner" id="cb-banner"></div>
      <div class="cb-emotion" id="cb-emotion"></div>
      <div class="cb-result" id="cb-result"></div>
      <div class="cb-modal" id="cb-modal"><button class="cb-modal-x" id="cb-modal-x" aria-label="关闭">✕</button><div class="cb-modal-box" id="cb-modal-box"></div></div>
    `;
    document.body.appendChild(el);
    this.layer = el;
    this.els = {
      round: el.querySelector('#cb-round'),
      speed: el.querySelector('#cb-speed'),
      phase: el.querySelector('#cb-phase'),
      hand: el.querySelector('#cb-hand'),
      handCount: el.querySelector('#cb-handcount'),
      deck: el.querySelector('#cb-deck'),
      pin: el.querySelector('#cb-pinned'),
      hint: el.querySelector('#cb-hint'),
      endturn: el.querySelector('#cb-endturn'),
      log: el.querySelector('#cb-log'),
      dialogue: el.querySelector('#cb-dialogue'),
      guards: [el.querySelector('#cb-guards-0'), el.querySelector('#cb-guards-1')],
      lanes: [el.querySelector('#cb-lane-0'), el.querySelector('#cb-lane-1')],
      enemyCount: el.querySelector('#cb-enemy-count'),
      handBack: el.querySelector('#cb-handback'),
      floats: el.querySelector('#cb-floats'),
      showcase: el.querySelector('#cb-showcase'),
      banner: el.querySelector('#cb-banner'),
      emotion: el.querySelector('#cb-emotion'),
      result: el.querySelector('#cb-result'),
      scrim: el.querySelector('#cb-drawer-scrim'),
      drawerD: el.querySelector('#cb-drawer-dialogue'),
      drawerL: el.querySelector('#cb-drawer-log'),
      btnDialogue: el.querySelector('[data-cb="dialogue"]'),
      btnLog: el.querySelector('[data-cb="log"]'),
      modal: el.querySelector('#cb-modal'),
      modalBox: el.querySelector('#cb-modal-box'),
    };
    this._buildHero(0);
    this._buildHero(1);
    this._bind();
    this._bindPlatformEntry();
  },

  _bindPlatformEntry() {
    const link = document.querySelector('#platform-cards');
    if (link && !link.dataset.cbBound) {
      link.dataset.cbBound = '1';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.TTSManager) window.TTSManager.unlockAudio();
        this.startDemo();
      });
    }
  },

  _buildHero(side) {
    const root = document.querySelector('#cb-hero-' + side);
    if (!root) return;
    root.innerHTML = `
      <div class="cb-portrait">
        <div class="cb-pf-empty">影</div>
        <div class="cb-pf-lv"></div>
      </div>
      <div class="cb-hero-body">
        <div class="cb-hero-head">
          <div class="cb-hero-id">
            <div class="cb-hero-name"></div>
            <span class="cb-hero-class"></span>
          </div>
          <div class="cb-quickstats">
            <span class="cb-qstat def"><i>防御</i><b>0</b></span>
            <span class="cb-qstat spd"><i>速度</i><b>0</b></span>
            <span class="cb-qstat cri"><i>暴击</i><b>0%</b></span>
          </div>
        </div>
        <div class="cb-hp-row">
          <div class="cb-hp-track"><div class="cb-hp-fill" style="width:100%"></div></div>
          <div class="cb-hp-text">0/0</div>
        </div>
        <div class="cb-mana"></div>
        <div class="cb-badges"></div>
      </div>`;
    this.refs[side] = {
      root,
      portrait: root.querySelector('.cb-portrait'),
      lv: root.querySelector('.cb-pf-lv'),
      empty: root.querySelector('.cb-pf-empty'),
      name: root.querySelector('.cb-hero-name'),
      cls: root.querySelector('.cb-hero-class'),
      hpFill: root.querySelector('.cb-hp-fill'),
      hpText: root.querySelector('.cb-hp-text'),
      def: root.querySelector('.cb-qstat.def b'),
      spd: root.querySelector('.cb-qstat.spd b'),
      cri: root.querySelector('.cb-qstat.cri b'),
      mana: root.querySelector('.cb-mana'),
      badges: root.querySelector('.cb-badges'),
    };
  },

  _bind() {
    if (this._bound) return;
    this._bound = true;
    this.els.endturn.addEventListener('click', () => this.endTurn());
    this.layer.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cb]');
      if (t) {
        const act = t.dataset.cb;
        if (act === 'emote') this.openEmotePanel();
        if (act === 'rules') this.openRulesPanel();
        if (act === 'flee') this.surrender();
        if (act === 'dialogue') this.toggleDrawer('dialogue');
        if (act === 'log') this.toggleDrawer('log');
        return;
      }
      const dw = e.target.closest('[data-drawer]');
      if (dw) { this.toggleDrawer(dw.dataset.drawer, true); return; }
      if (e.target.id === 'cb-drawer-scrim') { this.closeDrawers(); return; }
      const guard = e.target.closest('.cb-guard');
      if (guard && this.isMyTurn()) {
        const uid = guard.dataset.uid;
        this.pinnedGuard = (this.pinnedGuard === uid) ? null : uid;
        this.render();
        this._sfx('tap');
        return;
      }
      const cardEl = e.target.closest('.cb-card');
      if (cardEl && this.els.hand.contains(cardEl)) {
        this.onPlayCard(cardEl.dataset.uid);
      }
    });
    this.els.modal.addEventListener('click', (e) => {
      if (e.target === this.els.modal) this.els.modal.classList.remove('on');
    });
    const closeX = this.layer.querySelector('#cb-modal-x');
    if (closeX) closeX.addEventListener('click', () => this.els.modal.classList.remove('on'));
    this.els.result.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-res]');
      if (!btn) return;
      const act = btn.dataset.res;
      if (act === 'again') { this._closeAll(); this.start(this.ctx); }
      else if (act === 'exit') this.exitToStory();
    });
    document.addEventListener('keydown', (e) => {
      if (!this.layer.classList.contains('cb-on')) return;
      const modalOpen = this.els.modal.classList.contains('on');
      if (e.key === 'Escape') {
        if ((this.els.drawerD && this.els.drawerD.classList.contains('on')) ||
            (this.els.drawerL && this.els.drawerL.classList.contains('on'))) {
          this.closeDrawers();
        } else {
          this.els.modal.classList.remove('on');
        }
        return;
      }
      if (modalOpen) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!this.over) this.endTurn();
      }
      if (e.key.toLowerCase() === 'e') this.openEmotePanel();
    });
  },

  // 顶栏「对话 / 战报」图标 → 右侧滑出抽屉；两个抽屉互斥，点遮罩或 ✕ 关闭。
  toggleDrawer(which, forceClose = false) {
    const map = { dialogue: this.els.drawerD, log: this.els.drawerL };
    const target = map[which];
    if (!target) return;
    const willOpen = forceClose ? false : !target.classList.contains('on');
    if (willOpen) {
      this.els.drawerD.classList.toggle('on', which === 'dialogue');
      this.els.drawerL.classList.toggle('on', which === 'log');
      this.els.scrim.classList.add('on');
    } else {
      this.closeDrawers();
    }
    // 顶栏图标按钮同步高亮
    if (this.els.btnDialogue) this.els.btnDialogue.classList.toggle('on', which === 'dialogue' && willOpen);
    if (this.els.btnLog) this.els.btnLog.classList.toggle('on', which === 'log' && willOpen);
  },

  closeDrawers() {
    if (this.els.drawerD) this.els.drawerD.classList.remove('on');
    if (this.els.drawerL) this.els.drawerL.classList.remove('on');
    if (this.els.scrim) this.els.scrim.classList.remove('on');
    if (this.els.btnDialogue) this.els.btnDialogue.classList.remove('on');
    if (this.els.btnLog) this.els.btnLog.classList.remove('on');
  },

  // ======================================================================
  // 开局
  // ======================================================================
  _open(res) {
    this.battleId = res.battle_id;
    this.state = res.state;
    this.over = false;
    this.busy = true;
    this.pinnedGuard = null;
    // 结局分支：赢 / 输 / 逃 各自去哪个剧情节点，由战斗节点的 battle_config 决定
    this.outcomeNodes = res.outcome_nodes || {};
    this.battleConfig = res.battle_config || {};
    this.outcome = null;
    this.els.log.innerHTML = '';
    this.els.dialogue.innerHTML = '';
    this.els.result.classList.remove('on');
    this.els.result.innerHTML = '';
    this.els.hand.innerHTML = '';
    this.closeDrawers();
    this.layer.classList.add('cb-on');
    if (typeof GameState !== 'undefined') GameState.isInCombat = true;
    this.render();
    this._sfx('start');
    this.playEvents(res.events || []).then(() => {
      this.state = res.state;
      this.render();
      this.busy = false;
      this.afterResponse({ state: res.state, over: false });
    });
  },

  // ======================================================================
  // 渲染
  // ======================================================================
  isMyTurn() {
    return this.state && this.state.phase === 'active' && this.state.active === 0 && !this.busy;
  },

  myPlayer() { return this.state.players[0]; },
  foePlayer() { return this.state.players[1]; },
  myHand() { return (this.state.players[0].hand || []); },

  render() {
    if (!this.state) return;
    const st = this.state;
    const me = st.players[0], foe = st.players[1];
    this.els.round.textContent = st.round;
    this.els.phase.textContent = st.phase === 'over'
      ? '对局结束'
      : (st.active === 0 ? '你的回合' : '对方行动中');
    this.els.phase.classList.toggle('you', st.active === 0 && st.phase === 'active');
    this.els.phase.classList.toggle('foe', st.active === 1 && st.phase === 'active');

    this._renderHero(0, me);
    this._renderHero(1, foe);
    this._renderGuards(0, me.guards || []);
    this._renderGuards(1, foe.guards || []);
    this._setGuardedBadge(0, (me.guards || []).length > 0);
    this._setGuardedBadge(1, (foe.guards || []).length > 0);

    this.els.enemyCount.textContent = `手牌 ${foe.hand_count}`;
    this.els.handBack.innerHTML = Array.from({ length: Math.min(6, foe.hand_count) })
      .map(() => '<div class="cb-back-card"></div>').join('');

    this.els.deck.textContent = me.deck_count;
    this.els.handCount.textContent = me.hand.length;

    const turn = st.phase === 'active' && st.active === 0;
    this.els.endturn.disabled = !turn || this.busy;
    this.els.pin.textContent = this.pinnedGuard ? '已锁定守卫：集火中' : '';

    // 费点不够出任何牌、只剩「结束回合」可选时，高亮提示按钮。
    const canPlay = turn && !this.busy && me.hand.some(c => c.cost <= me.mana && !c.locked);
    this.els.endturn.classList.toggle('urgent', !!turn && !this.busy && !canPlay);

    this._renderHand(me);
  },

  _renderHero(side, p) {
    const r = this.refs[side];
    if (!r) return;
    r.name.textContent = p.name || '—';
    r.cls.textContent = p.class_name || '';
    const pct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.max_hp)) * 100));
    r.hpFill.style.width = pct + '%';
    r.hpText.textContent = `${p.hp}/${p.max_hp}`;
    r.def.textContent = p.defense;
    r.spd.textContent = p.spd;
    r.cri.textContent = p.cri + '%';
    if (p.portrait) {
      r.portrait.style.backgroundImage = `url('${p.portrait}')`;
      r.empty.style.display = 'none';
    } else {
      r.portrait.style.backgroundImage = '';
      r.empty.style.display = 'flex';
    }
    r.lv.textContent = (p.class_name || '') + (p.is_ai ? ' · 对手' : ' · 你');
    r.root.classList.toggle('active-self', side === 0 && this.state.active === 0 && this.state.phase === 'active');
    r.root.classList.toggle('active-enemy', side === 1 && this.state.active === 1 && this.state.phase === 'active');

    // 法力宝石（只显示自己的具体费，敌方显示上限）
    const gems = [];
    for (let i = 1; i <= 5; i++) {
      let cls = 'cb-gem';
      if (i <= p.mana) cls += ' on';
      else if (i <= p.max_mana) cls += ' spent';
      gems.push(`<span class="${cls}"></span>`);
    }
    r.mana.innerHTML = gems.join('') + `<span class="cb-mana-text">${p.mana}/${p.max_mana} 费</span>`;

    // 状态徽标
    const d = p.debuffs || {};
    const items = [];
    if (d.atk) items.push({ t: `降攻 -${d.atk}`, c: 'neg' });
    if (d.def) items.push({ t: `降防 -${d.def}`, c: 'neg' });
    if (d.spd) items.push({ t: `减速 -${d.spd}`, c: 'warn' });
    if (d.mana_penalty) items.push({ t: `降费 -${d.mana_penalty}`, c: 'warn' });
    if (d.dodge) items.push({ t: `闪身 -${d.dodge}`, c: '' });
    r.badges.innerHTML = items.map(i => `<span class="cb-badge ${i.c}">${i.t}</span>`).join('');
  },

  _renderGuards(side, guards) {
    const box = this.els.guards[side];
    if (!box) return;
    box.innerHTML = '';
    const lane = this.els.lanes[side];
    if (lane) lane.classList.toggle('has-guards', guards.length > 0);
    if (!guards.length) {
      box.innerHTML = '<div class="cb-lane-empty">空</div>';
      return;
    }
    guards.forEach((g) => box.appendChild(this._guardEl(g)));
  },

  /**
   * 桌面上的守卫牌：就是一张正面朝上的扑克牌（卡图 + 名牌 + 血量徽记），
   * 不是缩在英雄面板角落的小 buff 图标。
   */
  _guardEl(g, extraClass = '') {
    const div = document.createElement('div');
    div.className = 'cb-guard' + (extraClass ? ' ' + extraClass : '') +
      (this.pinnedGuard === g.uid ? ' pinned' : '');
    div.dataset.uid = g.uid;
    div.title = '点击锁定为攻击目标';
    const art = g.art
      ? `<div class="cb-guard-art" style="background-image:url('${g.art}')"></div>`
      : `<div class="cb-guard-art cb-guard-art-empty">${this.ICONS.guard}</div>`;
    const pct = Math.max(0, (g.hp / Math.max(1, g.max_hp)) * 100);
    div.innerHTML = `
      ${art}
      <div class="cb-guard-shade"></div>
      <div class="cb-guard-tag">守卫</div>
      <div class="cb-guard-hp">${g.hp}</div>
      <div class="cb-guard-foot">
        <div class="cb-guard-name">${g.name}</div>
        <div class="cb-guard-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    return div;
  },

  // 英雄头顶「🛡 守卫中」徽章：有守卫时显示，全清后移除
  _setGuardedBadge(side, on) {
    const b = this.refs[side] && this.refs[side].badges;
    if (!b) return;
    let el = b.querySelector('.cb-guarded-badge');
    if (on) {
      if (!el) {
        el = document.createElement('span');
        el.className = 'cb-guarded-badge cb-badge';
        el.textContent = '🛡 守卫中';
        b.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  },

  _renderHand(me) {
    const box = this.els.hand;
    box.innerHTML = '';
    if (!me.hand.length) {
      box.innerHTML = '<div class="cb-empty-hand">手牌已空</div>';
      return;
    }
    const turn = this.state.active === 0 && this.state.phase === 'active' && !this.busy;
    me.hand.forEach(card => {
      const el = this._cardEl(card);
      if (!turn || card.cost > me.mana) el.classList.add('cant');
      if (card.locked) el.classList.add('locked');
      box.appendChild(el);
    });
  },

  _cardEl(card) {
    const div = document.createElement('div');
    div.className = 'cb-card cat-' + (card.category || 'skill');
    div.dataset.uid = card.uid;
    const catLabel = card.category_label || ({ attack: '攻击', guard: '守卫', special: '功能', skill: '技能' }[card.category] || '');
    const art = card.art
      ? `<div class="cb-card-art" style="background-image:url('${card.art}')">`
      : `<div class="cb-card-art"><div class="cb-art-empty">${this.ICONS[card.category] || this.ICONS.skill}<span>待生成卡面</span></div>`;
    div.innerHTML = `
      ${art}
        <div class="cb-cost">${card.cost}</div>
        <div class="cb-card-cat">${catLabel}</div>
        <div class="cb-card-name">${card.name}</div>
      </div>
      <div class="cb-card-text">${card.desc || ''}</div>
      <div class="cb-card-foot">
        <span>${card.class_label || ''}</span>
        <span>${card.hits > 1 ? card.hits + ' 段' : (card.value ? card.value : '')}</span>
      </div>
      ${card.locked ? '<div class="cb-card-lock">下回合可用</div>' : ''}`;
    return div;
  },

  // ======================================================================
  // 操作
  // ======================================================================
  async onPlayCard(uid) {
    if (this.busy || !this.state || this.state.phase !== 'active') return;
    if (this.state.active !== 0) { Utils.toast('现在是对方回合'); return; }
    const card = this.myHand().find(c => c.uid === uid);
    if (!card) return;
    if (card.locked) { Utils.toast('夺心偷来的牌要下回合才能用'); this._sfx('error'); return; }
    if (card.cost > this.myPlayer().mana) {
      Utils.toast(`法力不足：需要 ${card.cost}，剩 ${this.myPlayer().mana}`);
      this._sfx('error');
      return;
    }
    this.busy = true;
    this.render();
    let res;
    try {
      res = await this.post(`/api/cardgame/battle/${this.battleId}/play`, {
        card_uid: uid,
        target_guard_uid: this.pinnedGuard || null,
      });
    } catch (e) {
      Utils.toast(e.message || '出牌失败');
      this.busy = false;
      this.render();
      return;
    }
    this.pinnedGuard = null;
    await this.playEvents(res.events || []);
    await this.afterResponse(res);
  },

  async endTurn() {
    if (this.busy || !this.state || this.state.phase !== 'active' || this.state.active !== 0) return;
    this.busy = true;
    this.render();
    let res;
    try {
      res = await this.post(`/api/cardgame/battle/${this.battleId}/end-turn`, {});
    } catch (e) {
      Utils.toast(e.message || '结束回合失败');
      this.busy = false;
      this.render();
      return;
    }
    await this.playEvents(res.events || []);
    await this.afterResponse(res);
  },

  async afterResponse(res) {
    this.state = res.state || this.state;
    this.render();
    if (res.over) {
      this.showResult(res);
      return;
    }
    if (this.state.await_ai) {
      await this.runAi();
      return;
    }
    this.busy = false;
    this.render();
  },

  async runAi() {
    this.busy = true;
    this.render();
    let guard = 0;
    while (this.state && this.state.await_ai && !this.over && guard++ < 40) {
      let res;
      try {
        res = await this.post(`/api/cardgame/battle/${this.battleId}/ai-step`, {});
      } catch (e) {
        console.error('AI 行动失败', e);
        break;
      }
      await this.playEvents(res.events || []);
      this.state = res.state || this.state;
      this.render();
      if (res.over) { this.showResult(res); return; }
      if (!this.state.await_ai) break;
    }
    this.busy = false;
    this.render();
  },

  async surrender() {
    if (!this.battleId) return;
    if (!confirm('脱离战斗？本局按逃跑处理，剧情会走「逃跑」那条分支。')) return;
    try {
      this.outcome = 'flee';
      const res = await this.post(`/api/cardgame/battle/${this.battleId}/surrender`, {});
      await this.playEvents(res.events || []);
      this.state = res.state || this.state;
      this.showResult({ ...res, over: true, winner: 1, fled: true });
    } catch (e) {
      Utils.toast(e.message || '操作失败');
    }
  },

  // ======================================================================
  // 事件演出
  // ======================================================================
  async playEvents(events) {
    for (const ev of events) {
      try {
        await this.handleEvent(ev);
      } catch (e) {
        console.warn('事件演出异常', ev, e);
      }
    }
  },

  wait(ms) { return new Promise(r => setTimeout(r, ms)); },

  async handleEvent(ev) {
    switch (ev.type) {
      case 'log':
        this.addLog(ev.text, ev.kind);
        await this.wait(30);
        break;

      case 'deal':
        this._sfx('draw');
        await this.wait(180);
        break;

      case 'play': {
        this._sfx('card');
        this.addLog(`▸ ${this.state.players[ev.side].name} 打出「${ev.card.name}」`, 'info');
        await this.cardImpact(ev);
        this._speakCard(ev.card, ev.side);
        break;
      }

      case 'hero_hit': {
        const r = this.refs[ev.side];
        if (r) {
          r.hpFill.style.width = `${Math.max(0, (ev.hp / Math.max(1, ev.max_hp)) * 100)}%`;
          r.hpText.textContent = `${ev.hp}/${ev.max_hp}`;
          r.root.classList.remove('hit');
          void r.root.offsetWidth;
          r.root.classList.add('hit');
          const pt = this._center(r.root);
          if (ev.absorbed) this.float(pt.x + 60, pt.y, `DEF -${ev.absorbed}`, 'def');
          if (ev.hp_damage) this.float(pt.x, pt.y, `-${ev.hp_damage}`, ev.crit ? 'crit' : 'dmg');
          if (!ev.absorbed && !ev.hp_damage && ev.dodge) this.float(pt.x, pt.y, `闪避 -${ev.dodge}`, 'info');
        }
        this._sfx(ev.crit ? 'crit' : 'hit');
        await this.wait(ev.crit ? 520 : 340);
        break;
      }

      case 'guard_hit': {
        const el = document.querySelector(`.cb-guard[data-uid="${ev.guard_uid}"]`);
        if (el) {
          el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
          const num = el.querySelector('.cb-guard-hp');
          const bar = el.querySelector('.cb-guard-bar > i');
          if (num) num.textContent = ev.hp;
          if (bar) bar.style.width = Math.max(0, (ev.hp / Math.max(1, ev.max_hp)) * 100) + '%';
          const pt = this._center(el);
          this.float(pt.x, pt.y - 10, `-${ev.amount}`, ev.crit ? 'crit' : 'dmg');
          if (ev.destroyed) { el.classList.add('destroyed'); }
        }
        this._sfx(ev.crit ? 'crit' : 'hit');
        await this.wait(ev.destroyed ? 440 : 260);
        break;
      }

      case 'guard_spawn': {
        this._sfx('guard');
        const box = this.els.guards[ev.side];
        if (box) {
          const g = ev.guard;
          box.querySelector('.cb-lane-empty')?.remove();
          const lane = this.els.lanes[ev.side];
          if (lane) lane.classList.add('has-guards');
          // 守卫牌「落到桌面」：先亮一下落点，再把牌摆上去（spawn 动画带一点拍桌子的下坠感）
          if (lane) {
            lane.classList.remove('receive'); void lane.offsetWidth; lane.classList.add('receive');
          }
          const div = this._guardEl(g, 'spawn');
          box.appendChild(div);
          const pt = this._center(div);
          this.float(pt.x, pt.y - 20, `+${g.hp} 守卫`, 'def');
          this._setGuardedBadge(ev.side, true);
        }
        await this.wait(260);
        break;
      }

      case 'guard_clear':
        this._sfx('boom');
        this.els.guards[ev.side].querySelectorAll('.cb-guard').forEach(g => g.classList.add('destroyed'));
        this._setGuardedBadge(ev.side, false);
        await this.wait(380);
        this.els.guards[ev.side].innerHTML = '<div class="cb-lane-empty">已清空</div>';
        if (this.els.lanes[ev.side]) this.els.lanes[ev.side].classList.remove('has-guards');
        break;

      case 'buff': {
        const r = this.refs[ev.side];
        if (r) {
          r.def.textContent = ev.defense;
          const pt = this._center(r.root);
          this.float(pt.x, pt.y, `+${ev.delta || ''} DEF`, 'def');
        }
        this._sfx('guard');
        await this.wait(200);
        break;
      }

      case 'heal': {
        const r = this.refs[ev.side];
        const p = this.state && this.state.players[ev.side];
        const maxHp = Math.max(1, (p && p.max_hp) || ev.hp || 1);
        if (r) {
          r.hpFill.style.width = `${Math.max(0, (ev.hp / maxHp) * 100)}%`;
          r.hpText.textContent = `${ev.hp}/${maxHp}`;
          const pt = this._center(r.root);
          this.float(pt.x, pt.y, `+${ev.amount}`, 'heal');
        }
        this._sfx('heal');
        await this.wait(260);
        break;
      }

      case 'draw':
        this._sfx('draw');
        if (ev.side === 0) {
          this.els.deck.textContent = ev.deck;
          this.els.handCount.textContent = ev.hand;
        }
        await this.wait(120);
        break;

      case 'burn':
        this.addLog(`手牌已满，弃置「${ev.card.name}」`, 'warn');
        await this.wait(120);
        break;

      case 'discard':
        this.addLog(`弃掉「${ev.card.name}」`, 'warn');
        await this.wait(120);
        break;

      case 'fatigue':
        if (this.refs[ev.side]) {
          const r = this.refs[ev.side];
          const pt = this._center(r.root);
          this.float(pt.x, pt.y, '牌库空 -3', 'info');
        }
        await this.wait(200);
        break;

      case 'status':
        this._sfx('debuff');
        if (ev.side === 0 || ev.side === 1) {
          const r = this.refs[ev.side];
          if (r) { const pt = this._center(r.root); this.float(pt.x, pt.y - 40, this._statusText(ev), 'info'); }
        }
        await this.wait(180);
        break;

      case 'status_clear':
        await this.wait(60);
        break;

      case 'cleanse':
        this._sfx('heal');
        {
          const r = this.refs[ev.side];
          if (r) { const pt = this._center(r.root); this.float(pt.x, pt.y - 30, '净化', 'heal'); }
        }
        await this.wait(220);
        break;

      case 'steal':
        this._sfx('debuff');
        this.addLog(`「${ev.card.name}」被${ev.mode === 'copy' ? '复制' : '夺走'}`, 'special');
        await this.wait(200);
        break;

      case 'crit_perk':
        this.banner('暴击爽点 · 额外抽牌');
        this._sfx('crit');
        await this.wait(420);
        break;

      case 'round_start':
        this.els.round.textContent = ev.round;
        this.els.speed.innerHTML = `速度比拼：<b>${this.state.players[0].name} SPD ${ev.spd[0]}</b> vs <b>${this.state.players[1].name} SPD ${ev.spd[1]}</b>${ev.tie ? ' · 同速猜拳' : ''}`;
        this.banner(`第 ${ev.round} 回合 · ${this.state.players[ev.first].name}先手`);
        await this.wait(520);
        break;

      case 'turn_start': {
        const p = this.state.players[ev.side];
        if (p) { p.mana = ev.mana; p.max_mana = ev.max_mana; }
        this._sfx('turn');
        if (ev.side === 0) this.banner('你的回合');
        this.render();
        await this.wait(ev.side === 0 ? 480 : 260);
        break;
      }

      case 'turn_end':
        await this.wait(80);
        break;

      case 'emotion':
        this.addDialogue(ev);
        if (ev.flash) await this.showEmotion(ev);
        await this.wait(90);
        break;

      case 'game_over':
        this.over = true;
        this.outcome = ev.winner === 0 ? 'victory' : 'defeat';
        this._sfx(ev.winner === 0 ? 'win' : 'lose');
        this.banner(ev.winner === 0 ? '胜利' : '战败');
        await this.wait(700);
        break;

      case 'state':
        if (ev.state) { this.state = ev.state; this.render(); }
        break;

      case 'error':
        Utils.toast(ev.text || '操作无效');
        this._sfx('error');
        await this.wait(120);
        break;

      default:
        break;
    }
  },

  _statusText(ev) {
    const map = { def: 'DEF 下降', spd: 'SPD 下降', mana_penalty: '下回合法力 -1', atk: '下一击威力下降', dodge: '闪身：受击减伤' };
    return map[ev.key] || ev.key;
  },

  // ======================================================================
  // 视觉细节
  // ======================================================================
  _center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },

  float(x, y, text, kind = 'dmg') {
    const el = document.createElement('div');
    el.className = 'cb-float ' + kind;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.textContent = text;
    this.els.floats.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  },

  banner(text) {
    const b = this.els.banner;
    b.textContent = text;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
  },

  addLog(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'cb-log-line ' + (kind || 'info');
    el.textContent = text;
    this.els.log.prepend(el);
    while (this.els.log.children.length > 160) this.els.log.lastChild.remove();
  },

  addDialogue(ev) {
    const el = document.createElement('div');
    el.className = 'cb-dlg' + (ev.side === 1 ? ' foe' : '');
    el.innerHTML = `
      <div class="cb-dlg-head">
        <span class="cb-dlg-name">${ev.speaker || ''}</span>
        <span class="cb-dlg-emo" style="color:${ev.color || '#d4af37'}">${ev.name || ''}</span>
      </div>
      <div class="cb-dlg-text">${this._emoLine(ev)}</div>`;
    this.els.dialogue.appendChild(el);
    this.els.dialogue.scrollTop = this.els.dialogue.scrollHeight;
    while (this.els.dialogue.children.length > 40) this.els.dialogue.firstChild.remove();
  },

  async showcase(card, ms = 420) {
    if (!card) return;
    const wrap = this.els.showcase;
    wrap.innerHTML = '';
    const el = this._cardEl({
      uid: 'showcase', name: card.name, cost: card.cost, desc: card.desc,
      category: card.category, category_label: '', class_label: '', art: card.art,
    });
    wrap.appendChild(el);
    wrap.classList.add('on');
    await this.wait(ms);
    wrap.classList.remove('on');
    wrap.innerHTML = '';
  },

  // 出牌时卡牌「从哪儿飞、飞到哪儿」的演出。
  //
  // 之前的 bug：不管谁出牌，起点都写死成玩家手牌区，于是对手的牌是从「我自己的手牌」
  // 飞向我的人物面板；守卫牌的落点又是个空盒子，量出来 0×0，牌就飞到屏幕左上角去了。
  //
  // 现在：
  //   起点 —— 我方 = 手牌里这张卡所在的屏幕位置；对手 = 右上角那摞对手手牌。
  //   落点 —— 由后端 play 事件的 target 决定（数据化，不靠 category 猜）：
  //            self 出牌方英雄 / foe 对方英雄 /
  //            guard_self 出牌方的前线守卫区（牌就摆在自己这半张桌上）/
  //            guard_foe 对方的守卫区（先把对面的守卫牌打掉）。
  async cardImpact(ev) {
    const card = ev.card || {};
    const side = ev.side === 1 ? 1 : 0;
    const target = ev.target || this._fallbackImpactTarget(card, side);
    const from = this._playOrigin(side, card.uid);
    const to = this._impactPoint(target, side);
    const isGuardLand = target === 'guard_self' || target === 'guard_foe';
    const isFoeSide = side === 1;

    const clone = this._cardEl({
      uid: 'proj', name: card.name, cost: card.cost, desc: card.desc,
      category: card.category, category_label: '', class_label: '', art: card.art,
    });
    clone.classList.add('cb-proj');
    if (isFoeSide) clone.classList.add('cb-proj-foe');
    this.layer.appendChild(clone);
    clone.style.left = from.x + 'px';
    clone.style.top = from.y + 'px';
    clone.style.opacity = '0';

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const dur = Math.round(Math.max(300, Math.min(560, 240 + dist * 0.55)));
    const s0 = isFoeSide ? 0.4 : 0.52;
    const s1 = isGuardLand ? 0.46 : 0.96;
    const arc = Math.min(90, 34 + dist * 0.12);
    const spin = isGuardLand ? 0 : (isFoeSide ? -8 : 6);
    const base = 'translate(-50%,-50%) ';

    try {
      const anim = clone.animate([
        { opacity: 0, transform: `${base}translate(0px,0px) scale(${s0}) rotate(${isFoeSide ? -6 : 0}deg)` },
        { opacity: 1, offset: 0.14, transform: `${base}translate(${dx * 0.1}px, ${dy * 0.1 - arc * 0.15}px) scale(${s0 * 1.05}) rotate(0deg)` },
        { opacity: 1, offset: 0.72, transform: `${base}translate(${dx * 0.72}px, ${dy * 0.72 - arc * 0.7}px) scale(${(s0 + s1) / 2}) rotate(${spin}deg)` },
        { opacity: 1, transform: `${base}translate(${dx}px, ${dy}px) scale(${s1}) rotate(0deg)` },
      ], { duration: dur, easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'forwards' });
      await anim.finished.catch(() => {});
    } catch (_) {
      clone.style.opacity = '1';
      clone.style.transform = `${base}translate(${dx}px, ${dy}px) scale(${s1})`;
      await this.wait(dur);
    }

    // 落点反馈
    if (isGuardLand) {
      const lane = this.els.lanes[target === 'guard_self' ? side : 1 - side];
      if (lane) { lane.classList.remove('receive'); void lane.offsetWidth; lane.classList.add('receive'); }
      this._sfx('guard');
      this.float(to.x, to.y - 10, '🛡', 'def');
    } else if (target === 'self') {
      const r = this.refs[side];
      if (r) {
        r.root.classList.remove('shield'); void r.root.offsetWidth; r.root.classList.add('shield');
      }
      this.float(to.x, to.y, '🛡', 'def');
    } else {
      const r = this.refs[1 - side];
      if (r) {
        r.root.classList.remove('impact'); void r.root.offsetWidth; r.root.classList.add('impact');
        this.layer.classList.remove('shake'); void this.layer.offsetWidth; this.layer.classList.add('shake');
      }
    }
    // 守卫牌落桌：卡面收成桌面上的那张牌，不要在半空炸掉
    if (isGuardLand) {
      await this.wait(70);
      clone.style.transition = 'opacity .12s ease';
      clone.style.opacity = '0';
      await this.wait(120);
    }
    clone.remove();
    await this.wait(90);
  },

  /** 老后端（play 事件还没带 target）时的兜底映射，按卡牌类型猜落点。 */
  _fallbackImpactTarget(card, side) {
    const cat = card.category || 'skill';
    const script = card.script || '';
    if (cat === 'guard') return 'guard_self';
    if (['buff_def', 'buff_def_draw', 'def_heal', 'heal', 'heal_def', 'cleanse', 'dodge', 'draw2'].includes(script)) return 'self';
    if (script === 'clear_guards') return 'guard_foe';
    const foeGuards = (this.state && this.state.players[1 - side] && this.state.players[1 - side].guards) || [];
    return foeGuards.length ? 'guard_foe' : 'foe';
  },

  /** 出牌方的「手牌位置」——我方是那张牌本身，对手是右上角的手牌背面。 */
  _playOrigin(side, uid) {
    if (side === 0) {
      const el = uid ? this.els.hand.querySelector(`.cb-card[data-uid="${uid}"]`) : null;
      if (el) return this._center(el);
      const h = this.els.hand.getBoundingClientRect();
      return { x: h.left + h.width / 2, y: h.top + Math.min(h.height, 200) / 2 };
    }
    const back = this.els.handBack ? this.els.handBack.getBoundingClientRect() : null;
    if (back && back.width > 4 && back.height > 4) {
      return { x: back.left + back.width / 2, y: back.top + back.height / 2 };
    }
    const hero = this.refs[1] && this.refs[1].root;
    if (hero) return this._center(hero);
    return { x: window.innerWidth - 140, y: 110 };
  },

  /** 落点中心坐标：英雄面板 / 前线守卫区（有守卫牌就对准第一张牌）。 */
  _impactPoint(target, side) {
    const heroOf = (s) => (this.refs[s] && this.refs[s].root) || null;
    if (target === 'self') {
      const el = heroOf(side);
      return el ? this._center(el) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    if (target === 'guard_self' || target === 'guard_foe') {
      const gs = target === 'guard_self' ? side : 1 - side;
      const box = this.els.guards[gs];
      const lane = this.els.lanes[gs];
      const firstCard = box ? box.querySelector('.cb-guard:not(.destroyed)') : null;
      if (firstCard) return this._center(firstCard);
      if (box) {
        const r = box.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      if (lane) {
        const r = lane.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      const el = heroOf(gs);
      return el ? this._center(el) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    const el = heroOf(1 - side);
    return el ? this._center(el) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  },

  // 出牌时朗读卡牌名（用该角色的音色；无角色则取默认音）。
  _speakCard(card, side) {
    const TM = window.TTSManager;
    if (!TM || !TM.enabled || !card) return;
    const text = card.name || '';
    if (!text) return;
    const p = (this.state && this.state.players[side]) || {};
    const key = 'cbcard:' + (card.code || card.uid || 'x') + ':' + side;
    TM.synthNow(text, key, {
      characterId: p.character_id || null, gender: p.gender || 'unknown', speakerName: p.name || '',
    }).then((line) => { if (line) TM.play(key); }).catch(() => {});
  },

  /**
   * 情感演出到底放哪段声音。
   *
   * ① 后台「卡牌系统 → 情感与表现」给这个角色的这条情感生成/上传过语音
   *    （事件里带 voice_url）→ 直接播那个文件。这是玩家自己挑好的音色，
   *    也是「说话有情绪」的唯一来源。
   * ② 没有才回落到现场 TTS 合成（音色取决于角色语音配置，缺省是引擎默认音）。
   *
   * 两条路都返回「播完才 resolve」的 Promise，情感演出的停留时长统一按它算，
   * 所以图会一直留到这句话真的说完。
   */
  _emotionSpeak(ev, line, token) {
    const TM = window.TTSManager;
    const side = ev && ev.side;
    if (!TM || !TM.enabled) return Promise.resolve({ duration_ms: 0, ok: false });
    const url = String((ev && ev.voice_url) || '').trim();
    if (!url) return this._speakLine(line, side, token);
    const tok = token || {};
    return TM.playUrlUntilEnd(url).then((r) => {
      if (r && r.ok) return r;
      // 文件缺失 / 解码失败 / 被跳过 —— 别让画面卡住，退回合成或按后台节奏收尾
      if (tok.aborted) return { duration_ms: 0, ok: false, aborted: true };
      return this._speakLine(line, side, token);
    }).catch(() => this._speakLine(line, side, token));
  },

  // 情感闪现时朗读台词（战斗对话）。
  // 返回 Promise<{duration_ms}>：语音真实播完才 resolve，情感演出靠它对齐时长。
  // token.aborted 由「点击跳过」置位：合成还在路上时被跳过，就别再开口了。
  _speakLine(text, side, token) {
    const TM = window.TTSManager;
    if (!TM || !TM.enabled || !text) return Promise.resolve({ duration_ms: 0, ok: false });
    const p = (this.state && this.state.players[side]) || {};
    const key = 'cbemo:' + (this.battleId || 0) + ':' + side + ':' + String(text).slice(0, 48);
    const tok = token || {};
    const synth = Promise.resolve(TM.synthNow(text, key, {
      characterId: p.character_id || null, gender: p.gender || 'unknown', speakerName: p.name || '',
    })).then((line) => {
      if (!line) return { duration_ms: 0, ok: false };
      if (tok.aborted) return { duration_ms: 0, ok: false, aborted: true };
      return TM.playUntilEnd(key);
    }).catch(() => ({ duration_ms: 0, ok: false }));
    // 合成迟迟不回来（引擎故障 / 网络慢）就别把画面挂在半空等它：
    // 2.5 秒还没开口，就按「这句没有语音」走后台节奏收尾。
    const giveUp = this.wait(2500).then(() => {
      tok.aborted = true;
      return { duration_ms: 0, ok: false, timedOut: true };
    });
    return Promise.race([synth, giveUp]);
  },

  /**
   * 情感演出的停留闸门。
   *   · 有语音：语音一播完就收画面（只留 120ms 尾巴），不再额外干等 hold 时间。
   *   · 没语音：按后台节奏（淡入 + 停留 + 淡出）走。
   *   · 点鼠标 / 空格 / 回车 / Esc：立刻跳过并掐掉正在播的语音。
   * 旧实现在等语音时把 skip 排除在外，且整层 pointer-events:none，所以「点了没反应、
   * 说完了还不消失」——这两处是同一组 bug。
   */
  async _emotionGate(speakP, holdMs, token) {
    const box = this.els.emotion;
    const tok = token || {};
    let skipped = false;
    let force = null;
    const skipP = new Promise((r) => { force = () => { if (!skipped) { skipped = true; tok.aborted = true; r('skip'); } }; });
    const onSkip = (e) => {
      if (e && e.type === 'pointerdown' && e.button > 0) return;
      // 触发情感的那块面板（表情抽屉 / 按钮）还在手底下：这一下点不算「跳过」，
      // 否则玩家点表情的同一秒画面就收了，看起来像根本没演。
      const t = e && e.target;
      if (t && t.closest && t.closest('.cb-emote-pop, .cb-emote, [data-emo], .cb-panel')) return;
      force();
    };
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); force();
      }
    };
    box.classList.add('skippable');
    box.addEventListener('pointerdown', onSkip, { capture: true });
    // 整层可点还不够：这层是绝对定位的，某些布局下会被别的面板压住。
    // 挂在 window 捕获阶段，玩家点哪儿都算「跳过并掐掉语音」。
    window.addEventListener('pointerdown', onSkip, true);
    window.addEventListener('keydown', onKey, true);
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    try {
      const voiceP = Promise.resolve(speakP || { duration_ms: 0 }).then((v) => ({ done: 'voice', v }));
      const first = await Promise.race([
        voiceP,
        skipP.then(() => ({ done: 'skip' })),
        this.wait(20000).then(() => ({ done: 'timeout' })),
      ]);
      if (first.done === 'skip') return true;
      if (first.done === 'voice') {
        const ms = Number((first.v && first.v.duration_ms) || 0);
        if (ms > 0) {
          // 语音已经播完：只留一小截尾巴让画面收得自然
          await Promise.race([this.wait(120), skipP]);
        } else {
          // 没语音（或被合成超时截断）：补足后台节奏的剩余停留时间
          const remain = Math.max(0, holdMs - elapsed());
          if (remain > 0) await Promise.race([this.wait(remain), skipP]);
        }
        return skipped;
      }
      // 语音 20 秒都没回来（合成卡住 / 静音）：退回按后台节奏停留，别把玩家晾着
      await Promise.race([this.wait(Math.max(0, holdMs - elapsed())), skipP]);
      return skipped;
    } finally {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onSkip, true);
      box.removeEventListener('pointerdown', onSkip, { capture: true });
      box.classList.remove('skippable');
      if (skipped) {
        try { if (window.TTSManager) window.TTSManager.stopAll(); } catch (_) { /* ignore */ }
      }
    }
  },

  /**
   * 情感台词清洗：后台「情感与表现」里存过的台词有可能是整段出图提示词
   * （【人物】…【服装】…），铺到全屏对话框里会直接把版面撑爆。
   * 判断口径与后台预览一致（含【】或超长 → 视为脏），脏了退回通用台词。
   */
  _emoLine(ev) {
    const s = String((ev && ev.line) || '').trim();
    const fallback = String((ev && ev.default_line) || '').trim();
    if (!s) return fallback || '……';
    if (s.includes('【') || s.length > 120) return fallback || '……';
    return s;
  },

  async showEmotion(ev) {
    const box = this.els.emotion;
    // 后台「卡牌系统 → 表现样式」存过样式，就按那套铺舞台演（人物图 + 对话框）。
    // 角色有独立样式用独立的，没有用全局的；都没有就走下面的老表情卡。
    const sty = this.emotionStyle(ev);
    if (sty) return this.showEmotionStyled(ev, sty);
    const color = ev.color || '#d4af37';
    const cfg = this.emotionTiming();
    const line = this._emoLine(ev);
    // 有角色专属立绘就显示立绘，没有就用符号占位。
    // 图 + 台词 = 一次完整的「情感表现」，这是玩家真正记住的部分。
    const sigil = ev.image_url
      ? `<div class="cb-emo-portrait" style="background-image:url('${ev.image_url}')"></div>`
      : `<div class="cb-emo-sigil">${(ev.name || '').slice(0, 2)}</div>`;
    box.innerHTML = `
      <div class="cb-emo-card ${ev.image_url ? 'has-art' : ''}" style="color:${color};--cb-emo-in:${cfg.fadeIn}ms;--cb-emo-out:${cfg.fadeOut}ms">
        <div class="cb-emo-code">EMOTE${ev.customized ? ' · 专属' : ''}</div>
        ${sigil}
        <div class="cb-emo-name">${ev.name || ''}</div>
        <div class="cb-emo-tag">${(cfg.showTag && ev.tag) ? '【' + ev.tag + '】' : ''}</div>
        <div class="cb-emo-line">${line}</div>
        <div class="cb-emo-speaker">${ev.speaker || ''}</div>
      </div>`;
    box.classList.add('on');
    this._sfx(ev.side === 0 ? 'turn' : 'debuff');
    // 停留时间由后台「卡牌系统 → 提示词与设置」决定；有语音时以语音结束为准，
    // 点一下鼠标可强行结束（_emotionGate）。
    const token = {};
    const speakP = line ? this._emotionSpeak(ev, line, token) : null;
    await this._emotionGate(speakP, cfg.fadeIn + cfg.hold + cfg.fadeOut, token);
    box.classList.remove('on');
    box.innerHTML = '';
  },

  /** 后台「表现样式」那套舞台参数：角色独立样式优先，其次全局，没有 → null（走老表情卡）。 */
  emotionStyle(ev) {
    const st = (this.catalog && this.catalog.settings) || {};
    const ok = (o) => !!(o && typeof o === 'object' &&
      (o.boxW != null || o.boxX != null || o.figureX != null || o.figureUrl != null || o.bg != null));
    // 角色独立样式：后台把每套存成 emotion_style_chars = { 角色id: 样式 }
    if (ev && st.emotion_style_chars) {
      try {
        const map = JSON.parse(st.emotion_style_chars) || {};
        const p = ((this.state || {}).players || [])[ev.side] || {};
        const mine = map[String(p.character_id)];
        if (ok(mine)) return mine;
      } catch (_) { /* 坏 JSON 就当没有 */ }
    }
    const raw = st.emotion_style_current;
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      return ok(o) ? o : null;
    } catch (_) { return null; }
  },

  /** #rrggbb + 0~100 → rgba，对话框底色要能调透明度。 */
  _rgba(hex, alpha) {
    let h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    const a = Math.max(0, Math.min(100, Number(alpha == null ? 100 : alpha))) / 100;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  },

  // 按后台配的样式演一次：人物图在后/前、对话框位置大小、前后关系、颜色字号，全部照搬。
  // 真·全屏：背景 cover 铺满可视区（可裁切），人物 contain 永远完整、占满近整屏高度。
  async showEmotionStyled(ev, s) {
    const box = this.els.emotion;
    const cfg = this.emotionTiming();
    const vw = box.clientWidth || window.innerWidth;
    const figZ = s.figureFront ? 3 : 1;
    const boxZ = s.figureFront ? 2 : 4;
    // 对话框宽度按可视区百分比，保证不溢出；后台 boxScale 在此基础上再缩放。
    const boxW = Math.max(180, Math.round(vw * (Number(s.boxW) || 56) / 100));
    // 人物图取值顺序必须和后台预览逐条一致，否则「预览里站着个人、游戏里是空白」：
    //   样式里指定的人物图 > 这条情感自己的图 > 这个角色在战斗里用的立绘
    // 最后那一档是这次补的：角色只给少数几种情感出过图时，
    // 没出图的那条以前在游戏里是「只剩一个对话框」，看着就像坏掉了。
    const p0 = ((this.state || {}).players || [])[ev.side] || {};
    const figUrl = s.figureUrl || ev.image_url || p0.portrait || '';
    const name = ev.speaker || ev.name || '';
    const figX = Number.isFinite(Number(s.figureX)) ? Number(s.figureX) : 50;
    const boxX = Number.isFinite(Number(s.boxX)) ? Number(s.boxX) : 50;
    // 纵向位置：距底部百分比（后台「表现样式」里调，人物/对话框各一条）
    const figBottom = Number.isFinite(Number(s.figureBottom)) ? Number(s.figureBottom) : 20;
    const boxBottom = Number.isFinite(Number(s.boxBottom)) ? Number(s.boxBottom) : 3;
    const figScale = (Number(s.figureScale) || 100) / 100;
    const boxScale = (Number(s.boxScale) || 100) / 100;
    // 背景：不透明时一定铺底色（有没有背景图都铺）——之前只有「有背景图 + 不透明」
    // 才铺，所以后台把背景改成白色也看不到任何变化。
    const bgLayer = s.bgTransparent ? ''
      : `<div class="cb-emobg" style="background-color:${s.bg || 'transparent'};${
          s.bgImage ? `background-image:url('${s.bgImage}');background-size:cover;background-position:center;` : ''
        }"></div>`;
    box.innerHTML = `
      <div class="cb-emofit" id="cb-emofit">
        ${bgLayer}
        ${figUrl
          ? `<div class="cb-emofig" style="left:${figX}%;bottom:${figBottom}%;transform:translateX(-50%) scale(${figScale});z-index:${figZ};background-image:url('${figUrl}')"></div>`
          : ''}
        <!-- 定位层与动效层必须分开：入场动画改的是 transform，
             如果动画和「translateX(-50%)」写在同一个元素上，动画期间会丢掉居中偏移，
             于是先看到对话框偏右、动画结束后「闪跳」回正 —— 这就是那个闪跳的根因。 -->
        <div class="cb-emobox-fit" style="left:${boxX}%;bottom:${boxBottom}%;width:${boxW}px;
            transform:translateX(-50%) scale(${boxScale});z-index:${boxZ}">
          <div class="cb-emobox" style="background:${this._rgba(s.boxBg, s.boxAlpha)};
              border-radius:${Number(s.boxRadius) || 0}px;
              padding:${Number(s.boxPad) || 0}px ${(Number(s.boxPad) || 0) + 6}px;
              --cb-emo-in:${cfg.fadeIn}ms">
            <div class="cb-emoname" style="color:${s.nameColor || '#e8c46a'};font-size:${Number(s.nameSize) || 18}px">${name}</div>
            <div class="cb-emoline" style="color:${s.textColor || '#eae6da'};font-size:${Number(s.textSize) || 17}px">${this._emoLine(ev)}</div>
          </div>
        </div>
        <div class="cb-emoskip">点击任意处跳过 ▸</div>
      </div>`;
    box.classList.add('on');
    this._sfx(ev.side === 0 ? 'turn' : 'debuff');
    // 有语音时：说完立刻收；点击立刻跳过（_emotionGate）
    const token = {};
    const line = this._emoLine(ev);
    const speakP = line ? this._emotionSpeak(ev, line, token) : null;
    await this._emotionGate(speakP, cfg.fadeIn + cfg.hold + cfg.fadeOut, token);
    box.classList.remove('on');
    box.innerHTML = '';
  },

  /** 情感演出的节奏（毫秒）。后台可调，缺省给一套「看得清」的值。 */
  emotionTiming() {
    const st = (this.catalog && this.catalog.settings) || {};
    const num = (k, d) => {
      const v = parseInt(st[k], 10);
      return Number.isFinite(v) && v >= 0 ? v : d;
    };
    return {
      fadeIn: num('emotion_fade_in_ms', 260),
      hold: num('emotion_hold_ms', 1600),
      fadeOut: num('emotion_fade_out_ms', 320),
      showTag: String(st.emotion_show_tag ?? '1') !== '0',
    };
  },

  // ======================================================================
  // 结算
  // ======================================================================
  showResult(res) {
    this.over = true;
    this.busy = false;
    const win = res.winner === 0;
    const st = this.state;
    const me = st.players[0], foe = st.players[1];
    const box = this.els.result;
    box.innerHTML = `
      <div class="cb-result-card ${win ? 'win' : 'lose'}">
        <div class="cb-result-kicker">${this.ctx.demo ? '卡牌试玩 · 对局结束' : '裂界对决 · 对局结束'}</div>
        <div class="cb-result-title">${win ? '胜利' : '战败'}</div>
        <div class="cb-result-sub">
          ${win
            ? `${me.name}（${me.class_name}）击穿了 ${foe.name} 的防线。`
            : `${foe.name}（${foe.class_name}）先一步把你的生命压到 0。`}
        </div>
        <div class="cb-result-rows">
          <div class="cb-result-row"><span>回合数</span><b>${st.round}</b></div>
          <div class="cb-result-row"><span>剩余生命</span><b>${me.hp} / ${me.max_hp}</b></div>
          <div class="cb-result-row"><span>已出牌</span><b>${st.total_cards_played || 0} 张</b></div>
          <div class="cb-result-row"><span>剩余牌库</span><b>${me.deck_count} 张</b></div>
        </div>
        <div class="cb-result-actions">
          ${win ? '' : '<button class="cb-btn" data-res="again">再战一次</button>'}
          <button class="cb-btn primary" data-res="exit">${win ? '继续剧情' : '返回剧情'}</button>
        </div>
      </div>`;
    box.classList.add('on');
    this.render();
  },

  async exitToStory() {
    const nodeId = this.ctx.storyNodeId;
    const demo = this.ctx.demo;
    this._closeAll();
    this.battleId = null;
    this.state = null;
    if (typeof GameState !== 'undefined') GameState.isInCombat = false;

    if (demo) {
      // 试玩是从平台首页进的，退出时把平台层恢复回来
      if (typeof Platform !== 'undefined' && typeof Platform.returnToPlatform === 'function') {
        Platform.returnToPlatform();
      } else {
        document.querySelector('#platform-layer')?.classList.remove('hidden');
      }
      return;
    }
    if (typeof DialogueUI !== 'undefined') {
      DialogueUI.callback = (res) => App.handleStoryChoice(res);
    }
    // ① 战斗节点配了「赢 / 输 / 逃」分支 → 直接去对应剧情节点。
    //    这三条分支在后台「剧情管理 → 节点 → 战斗配置」里填，
    //    字段名 victory_node_id / defeat_node_id / flee_node_id（与旧战斗系统一致）。
    const out = this.outcome || 'victory';
    const target = (this.outcomeNodes || {})[out];
    if (target && typeof DialogueUI !== 'undefined') {
      try {
        await DialogueUI.showNode(target, (res) => App.handleStoryChoice(res));
        return;
      } catch (e) {
        console.warn('战斗后跳转节点失败', target, e);
      }
    }
    // ② 没配分支 → 退回战斗节点自带的后置选项
    if (this.ctx.postChoices && this.ctx.postChoices.length && typeof DialogueUI !== 'undefined') {
      Utils.setText('#speaker-name', '旁白');
      Utils.setText('#dialogue-text', out === 'victory' ? '风停了。' : '你退出了这场交锋。');
      DialogueUI.showChoices(this.ctx.postChoices);
      return;
    }
    if (typeof App !== 'undefined' && nodeId) {
      await App.handleStoryChoice({ nextAfter: nodeId });
    }
  },

  _closeAll() {
    this.layer.classList.remove('cb-on');
    this.els.result.classList.remove('on');
    this.els.modal.classList.remove('on');
    this.els.emotion.classList.remove('on');
    this.els.showcase.classList.remove('on');
  },

  // ======================================================================
  // 面板：表情 / 规则
  // ======================================================================
  openEmotePanel() {
    if (!this.catalog) return;
    const box = this.els.modalBox;
    const list = this.catalog.emotions.filter(e => e.enabled !== 0);
    box.innerHTML = `
      <div class="cb-modal-title">战斗表情</div>
      <div class="cb-modal-sub">
        点一个表情，对面会按「回应情感」的规则回敬一句。台词、回应关系、冷却都在后台「卡牌系统 → 战斗表情」里改。
      </div>
      <div class="cb-emo-grid">
        ${list.map(e => `
          <div class="cb-emo-item" data-emo="${e.code}" style="--emo:${e.color}" title="${e.tag || ''}">
            <div class="cb-emo-item-ico">${e.emoji || '✦'}</div>
            <div class="cb-emo-item-body">
              <div class="cb-emo-item-name">${e.name}</div>
              <div class="cb-emo-item-tag">${e.tag || ''}</div>
            </div>
          </div>`).join('')}
      </div>`;
    this.els.modal.classList.add('on');
    box.querySelectorAll('[data-emo]').forEach(el => {
      el.addEventListener('click', async () => {
        this.els.modal.classList.remove('on');
        try {
          const res = await this.post(`/api/cardgame/battle/${this.battleId}/emote`, { code: el.dataset.emo });
          await this.playEvents(res.events || []);
          if (res.state) { this.state = res.state; this.render(); }
        } catch (e) {
          Utils.toast(e.message || '表情发送失败');
        }
      });
    });
  },

  openRulesPanel() {
    const box = this.els.modalBox;
    const rules = [
      ['胜负', '先把对方英雄 HP 打到 0 者胜。伤害先扣 DEF，再扣 HP；有守卫时守卫先挡刀。'],
      ['法力', '第 1 回合 2 费 → 3 → 4，第 4 回合起 5 费封顶。每回合回满，不累计。'],
      ['抽牌', '起手 5 张，每回合抽 1；手牌上限 7，超出弃置；牌库空后每抽 1 张掉 3 血。'],
      ['先手', '每回合比 SPD，高者先动；同速由系统判定并写进战报。'],
      ['暴击', '掷 1~100 ≤ 暴击率即双倍伤害；单次暴击最终伤害 ≥5 时本回合额外抽 1 张（每回合限 1 次）。'],
      ['守卫', '有守卫时伤害必须先打守卫，溢出部分继续传导；「清场」每回合限 1 张。'],
      ['负面', '降攻一次性；降防 / 降速持续到目标下回合结束且不叠加（只刷新）；降费作用于对手下回合，保底 1 费。'],
      ['偷牌', '复制类每回合 1 次；夺心偷来的牌本回合锁定，下回合才可用。'],
    ];
    box.innerHTML = `
      <div class="cb-modal-title">规则速查</div>
      <div class="cb-modal-sub">完整规则见后台「卡牌系统 → 战斗规则」，这里的每一条都由引擎按同一份规则执行。</div>
      <div class="cb-rule-grid">
        ${rules.map(([k, v]) => `
          <div class="cb-rule-item">
            <div class="cb-rule-k">${k}</div>
            <div class="cb-rule-v">${v}</div>
          </div>`).join('')}
      </div>`;
    this.els.modal.classList.add('on');
  },

  // ======================================================================
  // 音效（WebAudio 合成，不依赖素材文件）
  // ======================================================================
  _ctxAudio() {
    if (!this._audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._audio = new AC();
    }
    if (this._audio && this._audio.state === 'suspended') this._audio.resume();
    return this._audio;
  },

  _sfx(kind) {
    const ctx = this._ctxAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const tone = (freq, dur, type = 'sine', vol = .08, slideTo = null) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    };
    switch (kind) {
      case 'card': tone(520, .09, 'triangle', .06, 760); break;
      case 'draw': tone(360, .07, 'sine', .05, 620); break;
      case 'hit': tone(180, .2, 'sawtooth', .16, 60); break;
      case 'crit': [220, 440, 880].forEach((f, i) => setTimeout(() => tone(f, .3, 'sawtooth', .12, f * .4), i * 18)); break;
      case 'guard': [262, 330, 392].forEach((f, i) => setTimeout(() => tone(f, .26, 'triangle', .07), i * 30)); break;
      case 'heal': tone(660, .22, 'sine', .07, 990); break;
      case 'debuff': tone(320, .25, 'square', .07, 120); break;
      case 'turn': [440, 554, 659].forEach((f, i) => setTimeout(() => tone(f, .2, 'sine', .06), i * 45)); break;
      case 'boom': tone(120, .4, 'sawtooth', .2, 30); break;
      case 'tap': tone(700, .05, 'sine', .04); break;
      case 'error': tone(150, .16, 'sawtooth', .1, 110); break;
      case 'start': [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, .28, 'triangle', .09), i * 70)); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .42, 'triangle', .1), i * 90)); break;
      case 'lose': [330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, .5, 'sine', .1), i * 130)); break;
      default: break;
    }
  },
};

window.CardBattleUI = CardBattleUI;

// 平台入口可能比本脚本先/后渲染，这里再兜一次
document.addEventListener('DOMContentLoaded', () => CardBattleUI._bindPlatformEntry?.());

// ==========================================================================
// 后台「对战演示」跳转入口：/?carddemo=1&pchar=人物id&pclass=职业code
//                            &echar=人物id&eclass=职业code
// 打开就跑一局，不写剧情进度。参数用完即从地址栏抹掉，
// 否则刷新一下又自动开一局，像是在打架。
// ==========================================================================
(function bootDemoFromQuery() {
  function run() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (q.get('carddemo') !== '1') return;
    const opts = {
      pchar: q.get('pchar') || '',
      pclass: q.get('pclass') || '',
      echar: q.get('echar') || '',
      eclass: q.get('eclass') || '',
    };
    try {
      const u = new URL(location.href);
      ['carddemo', 'pchar', 'pclass', 'echar', 'eclass'].forEach((k) => u.searchParams.delete(k));
      history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
    } catch (e) { /* 地址栏改不动也不影响开局 */ }
    CardBattleUI.startConfigured(opts).catch((err) => {
      console.error('对战演示开局失败', err);
      try { Utils.toast('演示开局失败：' + (err.message || err)); } catch (_) {}
      try { alert('对战演示开局失败：' + (err.message || err)); } catch (_) {}
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
