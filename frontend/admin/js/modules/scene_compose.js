// ========== 人物 × 场景 合成（边界框拼图版） ==========
// 数据模型：一条「合成图配置」包含若干「元素」（人物 / 景物 / 文字）。
// 每个元素既是一段提示词来源，也是画布上的一个框——单一数据源，不再出现
// 「人物行」和「角色框」两套数据各自往提示词里灌导致的重复。
//   · 元素框（中栏）里增删改元素 → 左侧画布实时增删改框 → 右侧提示词实时重编译
//   · 点画布上的框 或 点元素框里的子元素，二者双向高亮联动
//   · 类型在创建时就固定（人物框不能变成景物框），避免误改
//   · 出图：有元素就按布局编译；勾选若干条 → 顶部「生成勾选的合成图」逐条排队
Admin.registerPage('compose', async (container) => {
  const state = {
    chars: [], scenes: [], poses: [], poseCats: {},
    presetsByChar: {},          // charId -> [外观配置]
    configs: [],                // 已保存的合成配置
    checked: new Set(),         // 勾选要生成的配置 id
    editId: null,               // 正在编辑的配置 id（null = 新建未保存）
    edit: null,                 // 正在编辑的配置对象（含 layout.items = 元素数组）
    dirty: false,
    jobs: new Map(),            // configId -> { jobId, name, status, ... }
    promptMemo: {},             // 配置 id -> { generated, text }（手改提示词用）
    recentItems: [],            // 最近的合成图（底部图库）
    gallerySel: new Set(),      // 图库里选中（单击选中 / Shift 多选）的图 id
  };
  let previewTimer = null;
  let pollTimer = null;
  let bbSel = -1;               // 当前选中的元素 / 画框下标（画布与元素框共用）

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TYPE_MAP = { player: '玩家', npc: 'NPC', enemy: '敌人', ally: '盟友' };
  const BB_TXT = { character: '人物', object: '景物', text: '文字', scene: '场景' };
  const STATUS_TXT = {
    queued: '排队中', running: '生成中', paused: '已暂停', done: '已完成',
    partial: '部分完成', error: '失败', canceled: '已取消', expired: '任务已过期',
  };

  container.innerHTML = `
    <div class="cmp-wrap">
      <!-- 顶部：出图参数 + 批量生成（按钮永不置灰，提交即返回） -->
      <section class="cmp-panel" style="margin-bottom:14px">
        <div class="cmp-h">
          <span>出图参数与生成</span>
          <span class="cmp-tip" style="margin-left:auto">场景域独立参数（与人物出图各记一份）</span>
        </div>
        <div class="cmp-body">
          <div id="cmp-gen-params"></div>
          <div class="cmp-runbar">
            <button class="cmp-btn primary" id="cmp-render" style="font-size:14px;padding:9px 20px">
              🎨 生成勾选的合成图
            </button>
            <button class="cmp-btn" id="cmp-check-all">全选</button>
            <button class="cmp-btn" id="cmp-uncheck">清空勾选</button>
            <span id="cmp-status" class="cmp-tip" style="margin:0"></span>
          </div>
          <div class="cmp-queue" id="cmp-queue"></div>
        </div>
      </section>

      <!-- 合成配置列表：横向卡片条，半宽增高，场景缩略图，图标放卡内，绿/黄边框 -->
      <section class="cmp-panel cmp-cfg-strip-panel" style="margin-bottom:14px">
        <div class="cmp-h">
          <span>合成配置 <b id="cmp-cfg-count">0</b></span>
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="cmp-btn" id="cmp-new" style="font-size:12.5px;padding:3px 10px">＋ 新建</button>
          </span>
        </div>
        <div class="cmp-cfg-strip" id="cmp-cfg-list"></div>
      </section>

      <!-- 主区：边界框拼图面板（左，含画布 + 场景栏） | 元素框（中） | 拼好的提示词（右） -->
      <div class="cmp-puzzle">
        <section class="cmp-panel cmp-bb-panel">
          <div class="cmp-h"><span>边界框拼图面板</span>
            <span class="cmp-tip" id="cmp-bb-size" style="margin-left:8px"></span>
          </div>
          <div class="cmp-bb-stage"><div class="cmp-bb-canvas" id="cmp-bb-canvas"></div></div>
        </section>

        <section class="cmp-panel cmp-elem-panel">
          <div class="cmp-h"><span>元素框</span>
            <span class="cmp-h-ico">
              <button class="cmp-ico" id="cmp-add-char" title="添加人物元素">👤 人物</button>
              <button class="cmp-ico" id="cmp-add-obj" title="添加景物元素">🌄 景物</button>
              <button class="cmp-ico" id="cmp-add-text" title="添加文字元素">🅣 文字</button>
              <button class="cmp-ico" id="cmp-add-scene" title="添加场景元素（下拉选场景、显示场景提示词）">🌐 场景</button>
              <button class="cmp-ico ghost" id="cmp-elem-clear" title="清空所有元素">✕ 清空</button>
            </span>
          </div>
          <div class="cmp-elem-list" id="cmp-elem-list"></div>
        </section>

        <section class="cmp-panel cmp-prompt-panel">
          <div class="cmp-h"><span>拼好的提示词</span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="cmp-btn" id="cmp-copy" style="font-size:11.5px;padding:3px 9px">复制</button>
            </span>
          </div>
          <textarea class="cmp-prompt" id="cmp-prompt" spellcheck="false"
            placeholder="在「元素框」里加人物 / 景物 / 文字，这里会实时编译出布局提示词"></textarea>
        </section>
      </div>

      <div class="cmp-h" style="border:1px solid var(--border);border-radius:8px;margin-top:16px;background:rgba(201,168,76,.09)">
        最近的合成图 <span id="cmp-gallery-sel" style="margin-left:8px;font-weight:400;color:var(--text-muted)"></span>
      </div>
      <div class="cmp-gallery" id="cmp-gallery"></div>
    </div>
  `;

  const $ = (id) => document.getElementById(id);

  // ==================== 数据加载 ====================
  async function loadBase() {
    const [chars, scenes, lib] = await Promise.all([
      Admin.get('/characters').catch(() => []),
      Admin.get('/scenes/').catch(() => []),
      Admin.get('/poses/library').catch(() => ({ poses: [], categories: [] })),
    ]);
    state.chars = chars || [];
    state.scenes = scenes || [];
    state.poses = lib.poses || [];
    (lib.categories || []).forEach(c => { state.poseCats[c.id] = c.name; });
  }

  async function loadConfigs() {
    const r = await Admin.get('/scene-gen/compose/configs').catch(() => ({ items: [] }));
    state.configs = r.items || [];
    const ids = new Set(state.configs.map(c => c.id));
    [...state.checked].forEach(id => { if (!ids.has(id)) state.checked.delete(id); });
    renderList();
  }

  async function ensurePresets(charId) {
    const cid = Number(charId) || 0;
    if (!cid) return [];
    if (state.presetsByChar[cid]) return state.presetsByChar[cid];
    let items = [];
    try {
      const r = await Admin.get(`/characters/${cid}/appearances`);
      items = r.items || [];
    } catch (_) { items = []; }
    state.presetsByChar[cid] = items;
    return items;
  }

  function presetOf(charId, appearanceId) {
    const list = state.presetsByChar[Number(charId)] || [];
    return list.find(a => a.id === Number(appearanceId))
      || list.find(a => a.is_default) || list[0] || null;
  }
  function appearanceFraming(charId, appearanceId) {
    const p = presetOf(charId, appearanceId);
    return p ? (p.framing || 'full') : 'full';
  }

  function charOf(charId) {
    return state.chars.find(c => c.id === Number(charId)) || null;
  }
  function sceneOf(sceneId) {
    return state.scenes.find(s => s.id === Number(sceneId)) || null;
  }

  // ==================== 元素（单一数据源） ====================
  function layoutItems() {
    const e = state.edit;
    if (!e) return [];
    if (!e.layout || !Array.isArray(e.layout.items)) e.layout = { items: [] };
    return e.layout.items;
  }
  function charElements() { return layoutItems().filter(b => b.type === 'character'); }
  function objectElements() { return layoutItems().filter(b => b.type === 'object'); }
  function noteSuffix(note) { return (note && String(note).trim()) ? '，' + String(note).trim() : ''; }

  /** 动作下拉：按分类分 optgroup，当前选中项高亮；空值 = 无动作 */
  function poseOptions(cur) {
    const opts = ['<option value="">— 无动作 —</option>'];
    const byCat = {};
    (state.poses || []).forEach(p => {
      const cat = p.cat || '';
      (byCat[cat] = byCat[cat] || []).push(p);
    });
    Object.keys(byCat).forEach(cat => {
      const catName = cat ? (state.poseCats[cat] || cat) : '其他动作';
      if (cat) opts.push(`<optgroup label="${esc(catName)}">`);
      byCat[cat].forEach(p => {
        const sel = (p.id === cur) ? ' selected' : '';
        opts.push(`<option value="${esc(p.id)}"${sel}>${esc(p.name || p.id)}</option>`);
      });
      if (cat) opts.push('</optgroup>');
    });
    return opts.join('');
  }

  // ==================== 配置列表 ====================
  function renderList() {
    $('cmp-cfg-count').textContent = state.configs.length;
    const host = $('cmp-cfg-list');
    if (!state.configs.length) {
      host.innerHTML = '<div class="cmp-empty">还没有合成配置。<br>点右上「＋ 新建」建一条，在「元素框」里加人物/景物，勾上就能出图。</div>';
      return;
    }
    host.innerHTML = state.configs.map(c => {
      const scene = sceneOf(c.scene_id);
      const sceneImg = (scene && scene.background_image) ? esc(scene.background_image) : '';
      const firstChar = (c.characters || [])[0];
      const ch = firstChar ? charOf(firstChar.character_id) : null;
      const who = (c.characters || []).map(x => {
        const cc = charOf(x.character_id);
        return cc ? cc.name : ('#' + x.character_id);
      }).join('、') || '未选人物';
      const boxN = (c.layout && c.layout.items && c.layout.items.length) || 0;
      const desc = `${who} · ${esc(scene ? scene.name : '未选场景')}${boxN ? ' · ' + boxN + ' 元素' : ''}`;
      return `
        <div class="cmp-cfg-card${state.editId === c.id ? ' sel' : ''}${state.checked.has(c.id) ? ' on' : ''}" data-id="${c.id}" title="${desc}">
          <input type="checkbox" class="cmp-cfg-ck" data-ck="${c.id}" ${state.checked.has(c.id) ? 'checked' : ''}>
          ${sceneImg ? `<img src="${sceneImg}" alt="">` : '<div class="ph32">无场景图</div>'}
          <div class="t">${esc(c.name)}</div>
          <div class="ico-row">
            <button class="cmp-ico sm" data-act="rename" data-id="${c.id}" title="重命名这条配置">✎</button>
            <button class="cmp-ico sm" data-act="copy" data-id="${c.id}" title="复制这条配置">⧉</button>
            <button class="cmp-ico sm" data-act="save" data-id="${c.id}" title="保存这条配置">💾</button>
            <button class="cmp-ico sm danger" data-act="del" data-id="${c.id}" title="删除这条配置">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  // ==================== 编辑器（场景栏） ====================
  function blankConfig() {
    const firstScene = state.scenes[0];
    return {
      id: null,
      name: '新建配置',
      scene_id: firstScene ? firstScene.id : null,
      scene_appearance: null,
      scene_prompt: '',
      characters: [],
      layout: { items: [] },
    };
  }

  /** 读 0~1 的归一化数值：只有「不是有效数字」才用兜底。注意 0 是合法值，不能用 || */
  function num01(v, dflt) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }

  /** 把已保存配置（可能只有 characters，没有 layout）规整成统一的「元素」数组 */
  function normalizeLayout(saved) {
    const raw = (saved.layout && Array.isArray(saved.layout.items)) ? saved.layout.items : [];
    if (raw.length) {
      return raw.map((b, i) => {
        const type = ['character', 'object', 'text', 'scene'].includes(b.type) ? b.type : 'object';
        const isScene = type === 'scene';
        // 场景是背景，缺坐标就铺满画布；其它元素才用错位默认值。
        // 关键：0 是合法坐标（背景框就是 0,0），不能用 || 兜底，否则 x=0 会被改成 0.3。
        let x = num01(b.x, isScene ? 0 : 0.3 + 0.1 * (i % 3));
        let y = num01(b.y, isScene ? 0 : 0.18 + 0.1 * Math.floor(i / 3));
        let w = num01(b.w, isScene ? 1 : 0.25);
        let h = num01(b.h, isScene ? 1 : 0.45);
        // 夹回画布内：旧数据可能存在 x+w>1 / y+h>1 的越界框（会整块往右下跑）
        x = Math.min(Math.max(0, x), 0.98);
        y = Math.min(Math.max(0, y), 0.98);
        w = Math.min(Math.max(0.02, w), 1 - x);
        h = Math.min(Math.max(0.02, h), 1 - y);
        return {
          type, x, y, w, h,
          character_id: b.character_id ? Number(b.character_id) : null,
          appearance_id: b.appearance_id ? Number(b.appearance_id) : null,
          pose_id: b.pose_id || '',
          note: b.note || '',
          character_name: b.character_name || '',
          scene_id: b.scene_id ? Number(b.scene_id) : null,
          image: b.image || '',
          scene_prompt: b.scene_prompt || '',
          text: b.text || '',
          caption: b.caption || '',
          base: b.base || b.caption || '',
          auto: !!b.auto, _collapsed: false, locked: !!b.locked,
        };
      });
    }
    // 旧配置：把人物行转成角色框
    const ch = Array.isArray(saved.characters) ? saved.characters.filter(c => c.character_id) : [];
    return ch.map((c, i) => {
      const cc = charOf(c.character_id);
      const p = presetOf(c.character_id, c.appearance_id);
      return {
        type: 'character',
        x: 0.3 + 0.1 * (i % 3), y: 0.18 + 0.1 * Math.floor(i / 3), w: 0.25, h: 0.5,
        character_id: Number(c.character_id),
        appearance_id: c.appearance_id ? Number(c.appearance_id) : (p ? p.id : null),
        pose_id: c.pose_id || '',
        note: c.note || '',
        character_name: cc ? cc.name : '',
        text: '', caption: '', base: '', auto: true,
      };
    });
  }

  async function selectConfig(cfg) {
    state.editId = cfg ? cfg.id : null;
    const base = cfg ? JSON.parse(JSON.stringify(cfg)) : blankConfig();
    base.characters = [];                       // 人物行不再单独存，统一走元素
    base.layout = { items: cfg ? normalizeLayout(cfg) : [] };
    state.edit = base;
    bbSel = -1;
    state.dirty = !cfg;
    // 预载每个人物的外观配置列表
    for (const el of charElements()) {
      if (el.character_id) await ensurePresets(el.character_id);
    }
    renderList();
    renderSceneBar();
    renderElements();
    renderCanvas();
    refreshSceneSummary();
    await refreshSceneElements();
    renderElements();
    schedulePreview();
  }

  function renderSceneBar() {
    const host = $('cmp-scene-bar');
    const e = state.edit;
    if (!host) return;
    if (!e) { host.innerHTML = ''; return; }
    const sceneOpts = '<option value="">— 选择场景 —</option>' + state.scenes.map(s =>
      `<option value="${s.id}" ${Number(e.scene_id) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const sc = e.scene_id ? sceneOf(e.scene_id) : null;
    const sceneImg = (sc && sc.background_image) ? esc(sc.background_image) : '';
    host.innerHTML = `
      <label class="cmp-field" style="flex:1 1 150px;min-width:0"><span>配置名称</span>
        <input class="cmp-inp" data-f="name" value="${esc(e.name || '')}"></label>
      <div class="cmp-scene-pick">
        <label class="cmp-field" style="flex:1 1 140px;min-width:0"><span>场景</span>
          <select class="cmp-sel" data-f="scene_id">${sceneOpts}</select></label>
        <div class="cmp-scene-thumb" id="cmp-scene-thumb">
          ${sceneImg ? `<img src="${sceneImg}" alt=""><button class="x" data-act="clear-scene" title="取消关联场景">✕</button>` : '<div class="ph">选场景后显示缩略图</div>'}
        </div>
      </div>
      <label class="cmp-field" style="flex:1 1 180px;min-width:0"><span>场景补充提示词（可空）</span>
        <input class="cmp-inp" data-f="scene_prompt" value="${esc(e.scene_prompt || '')}" placeholder="例如：远处有一座亮着灯的塔"></label>
    `;
  }

  function refreshSceneSummary() {
    // 占位：场景摘要已并入场景栏，无需独立显示
  }

  function refreshSceneThumb() {
    const host = $('cmp-scene-thumb');
    const e = state.edit;
    if (!host || !e) return;
    const sc = e.scene_id ? sceneOf(e.scene_id) : null;
    const img = (sc && sc.background_image) ? esc(sc.background_image) : '';
    host.innerHTML = img
      ? `<img src="${img}" alt=""><button class="x" data-act="clear-scene" title="取消关联场景">✕</button>`
      : '<div class="ph">选场景后显示缩略图</div>';
  }

  /** 一个场景的「拼装外观 + 该场景提示词 + 封面图」——场景元素的唯一数据来源 */
  async function sceneBundle(sceneId) {
    const sid = Number(sceneId) || 0;
    if (!sid) return { app: {}, caption: '', image: '', name: '' };
    let sc = null, app = {};
    try {
      sc = await Admin.get(`/scenes/${sid}`);
      try { app = sc.appearance_json ? JSON.parse(sc.appearance_json) : {}; } catch (_) { app = {}; }
      if (!app || !Object.keys(app).length) {
        const r = await Admin.post('/scene-gen/random', {});
        app = r.scene || {};
        const MAP = { town: 'town', forest: 'forest', castle: 'castle', dungeon: 'cave', wilderness: 'forest', cave: 'cave', battlefield: 'battlefield' };
        if (MAP[sc.scene_type]) app.sceneType = MAP[sc.scene_type];
      }
    } catch (_) { sc = null; app = {}; }
    let caption = '';
    if (Object.keys(app || {}).length) {
      try {
        const r2 = await Admin.post('/scene-gen/compose/captions', {
          characters: [], scene_id: sid, scene_appearance: app,
        });
        caption = r2.scene_caption || '';
      } catch (_) { caption = ''; }
    }
    return {
      app,
      caption,
      image: (sc && sc.background_image) ? sc.background_image : '',
      name: (sc && sc.name) || '',
    };
  }

  async function onSceneChange(sid) {
    const e = state.edit;
    e.scene_id = sid ? Number(sid) : null;
    e.scene_appearance = null;
    let sceneCaption = '';
    if (e.scene_id) {
      const b = await sceneBundle(e.scene_id);
      e.scene_appearance = Object.keys(b.app || {}).length ? b.app : null;
      sceneCaption = b.caption;
    }
    state.dirty = true;
    refreshSceneThumb();
    schedulePreview();
    await applySceneToBoxes();
    return sceneCaption;
  }

  /** 加载配置后，把场景元素的缩略图与提示词回填（场景元素只存 scene_id，图/提示词现拉） */
  async function refreshSceneElements() {
    const items = layoutItems();
    for (const el of items) {
      if (el.type !== 'scene') continue;
      if (!el.scene_id) continue;
      const b = await sceneBundle(el.scene_id);
      el.image = b.image;
      if (!el.scene_prompt && state.edit && state.edit.scene_prompt) el.scene_prompt = state.edit.scene_prompt;
      if (!el.caption) el.caption = b.caption;
    }
  }

  /** 切换场景元素的场景：图、提示词、配置级场景一起换（这是「切场景就切提示词」的实现） */
  async function applySceneToElement(i, sid) {
    const el = layoutItems()[i];
    if (!el) return;
    el.scene_id = sid ? Number(sid) : null;
    if (!el.scene_id) {
      el.caption = ''; el.image = '';
      state.dirty = true; renderElements(); renderCanvas(); schedulePreview();
      return;
    }
    const b = await sceneBundle(el.scene_id);
    el.image = b.image;
    el.caption = b.caption || '';
    const e = state.edit;
    e.scene_id = el.scene_id;
    e.scene_appearance = Object.keys(b.app || {}).length ? b.app : null;
    state.dirty = true;
    await applySceneToBoxes();          // 「自动」景物框跟着换场景描述
    renderElements(); renderCanvas(); schedulePreview();
  }

  // ---- 场景选择浮层（点小图切场景，跟「对话列表」的动作表情选择同一套交互）----
  let scenePopOutside = null;
  function closeScenePicker() {
    const old = document.getElementById('cmp-scene-pop');
    if (old) old.remove();
    if (scenePopOutside) { document.removeEventListener('mousedown', scenePopOutside, true); scenePopOutside = null; }
  }
  function openScenePicker(i, anchor) {
    closeScenePicker();
    const el = layoutItems()[i];
    if (!el) return;
    const pop = document.createElement('div');
    pop.className = 'cmp-scene-pop';
    pop.id = 'cmp-scene-pop';
    const cells = (state.scenes || []).map(s => {
      const img = s.background_image
        ? `<img src="${esc(s.background_image)}" alt="">`
        : '<div class="noimg">无封面</div>';
      return `<div class="cmp-scene-cell${Number(el.scene_id) === s.id ? ' on' : ''}" data-sid="${s.id}" title="${esc(s.name)}">
        ${img}<span class="nm">${esc(s.name)}</span></div>`;
    }).join('');
    pop.innerHTML = `
      <div class="cmp-scene-pop-h">
        <span>选择场景 <span class="sub">点图片即切换，提示词跟着换</span></span>
        <button type="button" class="x" title="关闭">×</button>
      </div>
      <div class="cmp-scene-grid">${cells || '<div class="empty">还没有场景，先去「场景管理」建一个</div>'}</div>`;
    document.body.appendChild(pop);

    const r = anchor.getBoundingClientRect();
    const W = pop.offsetWidth || 520;
    const H = pop.offsetHeight || 360;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - W - 12));
    let top = r.bottom + 6;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    pop.querySelector('.x').addEventListener('click', closeScenePicker);
    pop.querySelectorAll('.cmp-scene-cell').forEach(cell => {
      cell.addEventListener('click', async () => {
        const sid = Number(cell.dataset.sid);
        closeScenePicker();
        await applySceneToElement(i, sid);
        Admin.toast('已切换到场景「' + (sceneOf(sid) ? sceneOf(sid).name : '') + '」', 'success');
      });
    });
    scenePopOutside = (ev) => {
      const p = document.getElementById('cmp-scene-pop');
      if (p && !p.contains(ev.target) && !ev.target.closest('[data-bact="pick-scene"]')) closeScenePicker();
    };
    setTimeout(() => document.addEventListener('mousedown', scenePopOutside, true), 0);
  }

  // ==================== 元素框（中栏） ====================
  function renderElements() {
    const host = $('cmp-elem-list');
    if (!host) return;
    const items = layoutItems();
    if (!items.length) {
      host.innerHTML = '<div class="cmp-elem-empty">还没有元素。<br>点上方「👤人物 / 🌄景物 / 🅣文字」添加，元素会同时出现在左侧画布上。</div>';
      return;
    }
    host.innerHTML = items.map((b, i) => {
      const sel = i === bbSel ? ' sel' : '';
      const collapsed = !!b._collapsed;
      const capHint = b.type === 'scene' ? '（未生成场景提示词）' : '（参数变动后自动生成）';
      let body = '';
      if (b.type === 'character') {
        const presets = state.presetsByChar[Number(b.character_id)] || [];
        const appOpts = presets.length
          ? presets.map(a => `<option value="${a.id}" ${Number(b.appearance_id) === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')
          : '<option value="">（默认外观）</option>';
        body = `
          <label class="cmp-el-f"><span>人物</span>
            <select class="cmp-sel" data-ef="character_id" data-ei="${i}">${state.chars.map(c => `<option value="${c.id}" ${Number(b.character_id) === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(TYPE_MAP[c.character_type] || c.character_type)}</option>`).join('')}</select></label>
          <label class="cmp-el-f"><span>外观配置</span>
            <select class="cmp-sel" data-ef="appearance_id" data-ei="${i}">${appOpts}</select></label>
          <label class="cmp-el-f"><span>动作</span>
            <select class="cmp-sel" data-ef="pose_id" data-ei="${i}">${poseOptions(b.pose_id)}</select></label>
          <label class="cmp-el-f full"><span>可添加内容（拼进该人物提示词）</span>
            <input class="cmp-inp" data-ef="note" data-ei="${i}" value="${esc(b.note || '')}" placeholder="例如：右手握着断剑"></label>
          <div class="cmp-el-cap"><span class="cap-t">当前提示词</span><span class="cap-x">${esc(b.caption || capHint)}</span></div>`;
      } else if (b.type === 'object') {
        body = `
          <label class="cmp-el-f full"><span>景物描述（编译进布局提示词）</span>
            <textarea class="cmp-ta" data-ef="caption" data-ei="${i}" style="min-height:48px" placeholder="例如：雨夜中的石拱桥，桥下流水泛着月光">${esc(b.caption || '')}</textarea></label>`;
      } else if (b.type === 'scene') {
        const sc = b.scene_id ? sceneOf(b.scene_id) : null;
        body = `
          <div class="cmp-el-f full"><span>场景（点下面这张图，从场景列表里挑）</span>
            <button type="button" class="cmp-scene-big" data-bact="pick-scene" data-ei="${i}" title="点这里从场景列表里换场景">
              ${b.image ? `<img src="${esc(b.image)}" alt="">` : '<span class="ph">点这里选场景</span>'}
              <span class="ov"><span class="nm">${esc(sc ? sc.name : '未选场景')}</span><span class="tip">切换场景 ▸</span></span>
            </button>
          </div>
          <label class="cmp-el-f full"><span>场景补充提示词（可空）</span>
            <input class="cmp-inp" data-ef="scene_prompt" data-ei="${i}" value="${esc(b.scene_prompt || '')}" placeholder="例如：远处有一座亮着灯的塔"></label>
          <div class="cmp-el-cap"><span class="cap-t">场景提示词</span><span class="cap-x">${esc(b.caption || capHint)}</span></div>`;
      } else {
        body = `
          <label class="cmp-el-f full"><span>画面文字内容</span>
            <input class="cmp-inp" data-ef="text" data-ei="${i}" value="${esc(b.text || '')}" placeholder="例如：第三章 · 暗影纪元"></label>`;
      }
      const title = b.type === 'character'
        ? (b.character_name || '未选人物')
        : (b.type === 'scene'
          ? (b.scene_id ? (sceneOf(b.scene_id) ? sceneOf(b.scene_id).name : '未选场景') : '未选场景')
          : (b.type === 'text' ? ('文字：' + (b.text || '未填')) : '景物'));
      return `
        <div class="cmp-el t-${esc(b.type)}${sel}${collapsed ? ' collapsed' : ''}" data-ei="${i}">
          <div class="cmp-el-h">
            <span class="cmp-el-badge t-${esc(b.type)}">${BB_TXT[b.type] || '景物'}</span>
            <span class="cmp-el-title">${esc(title)}</span>
            ${b.type === 'scene' ? `<button class="cmp-el-mini lock${b.locked ? ' on' : ''}" data-bact="lock" data-ei="${i}"
              title="${b.locked ? '已锁定：画框点不中、拖不动，点此解锁' : '锁定这个画框（防止误拖动）'}">${b.locked ? '🔒' : '🔓'}</button>` : ''}
            <button class="cmp-el-mini" data-bact="promote" data-ei="${i}" title="把这个元素排到第一位">⤒</button>
            <button class="cmp-el-mini fold" data-bact="toggle" data-ei="${i}"
              title="${collapsed ? '展开这个元素（也可以双击卡片）' : '收起：只留标题行（也可以双击卡片）'}">${collapsed ? '▸' : '▾'}</button>
            <button class="cmp-el-x" data-act="del-el" data-ei="${i}" title="删除这个元素">✕</button>
          </div>
          ${collapsed ? '' : `<div class="cmp-el-body">${body}</div>`}
        </div>`;
    }).join('');
  }

  /** 卡片里的「当前提示词」就地更新：不重建 DOM，所以输入时不丢焦点、也能立刻看到结果 */
  function syncElementCaption(i) {
    const el = layoutItems()[i];
    if (!el) return;
    const node = document.querySelector(`.cmp-el[data-ei="${i}"] .cap-x`);
    if (!node) return;
    node.textContent = el.caption || (el.type === 'scene' ? '（未生成场景提示词）' : '（参数变动后自动生成）');
  }

  /** 文字元素的标题就是内容，改字时同步标题（同样不重建 DOM） */
  function syncElementTitle(i) {
    const el = layoutItems()[i];
    if (!el || el.type !== 'text') return;
    const node = document.querySelector(`.cmp-el[data-ei="${i}"] .cmp-el-title`);
    if (node) node.textContent = '文字：' + (el.text || '未填');
  }

  /** 把当前选中的元素卡片滚进可视区（列表内部滚动，不跳动整页） */
  function scrollElemIntoView() {
    const host = $('cmp-elem-list');
    if (!host || bbSel < 0) return;
    const card = host.querySelector(`.cmp-el[data-ei="${bbSel}"]`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  /** 只同步选中高亮，不重建 DOM（保住输入框焦点，避免「点两次」） */
  function syncSelClasses() {
    const list = $('cmp-elem-list');
    if (list) list.querySelectorAll('.cmp-el').forEach(el => el.classList.toggle('sel', Number(el.dataset.ei) === bbSel));
    const cv = $('cmp-bb-canvas');
    if (cv) cv.querySelectorAll('.cmp-bb-box').forEach(el => el.classList.toggle('sel', Number(el.dataset.bi) === bbSel));
  }

  async function addElement(type) {
    const e = state.edit;
    if (!e) return;
    const items = layoutItems();
    const n = items.length;
    if (type === 'scene') {
      const exist = items.find(x => x.type === 'scene');
      if (exist) {
        bbSel = items.indexOf(exist);
        if (!exist.caption || !exist.image) {
          const b = await sceneBundle(exist.scene_id || e.scene_id);
          exist.caption = b.caption || exist.caption;
          exist.image = b.image || exist.image;
        }
        renderCanvas(); renderElements(); schedulePreview(); scrollElemIntoView();
        return;
      }
      const sid = e.scene_id || (state.scenes[0] ? state.scenes[0].id : null);
      // 场景是背景：铺满画布、默认锁定（点不中也拖不动，防误操作），解锁后照样能调
      const el = {
        type: 'scene', x: 0, y: 0, w: 1, h: 1,
        scene_id: sid || null, image: '', scene_prompt: e.scene_prompt || '',
        caption: '', text: '', auto: false, locked: true,
      };
      items.unshift(el);                 // 场景是背景：放最前（先画、在人物后面）
      bbSel = 0;
      state.dirty = true;
      renderCanvas(); renderElements(); scrollElemIntoView();
      if (sid) {
        const b = await sceneBundle(sid);
        el.caption = b.caption || '';
        el.image = b.image;
        e.scene_id = sid;
        e.scene_appearance = Object.keys(b.app || {}).length ? b.app : null;
        renderElements(); renderCanvas(); schedulePreview(); scrollElemIntoView();
      } else {
        schedulePreview();
      }
      return;
    }
    let el;
    if (type === 'character') {
      const cid = state.chars[0] ? state.chars[0].id : null;
      if (cid) await ensurePresets(cid);
      const cc = charOf(cid);
      const p = presetOf(cid, null);
      el = {
        type: 'character', x: 0.30 + 0.10 * (n % 3), y: 0.16 + 0.10 * Math.floor(n / 3), w: 0.24, h: 0.5,
        character_id: cid, appearance_id: p ? p.id : null, pose_id: '', note: '',
        character_name: cc ? cc.name : '', text: '', caption: '', base: '', auto: true,
      };
    } else if (type === 'object') {
      el = { type: 'object', x: 0.05, y: 0.55, w: 0.9, h: 0.4, text: '', caption: '', base: '', auto: false };
    } else {
      el = { type: 'text', x: 0.1, y: 0.1, w: 0.3, h: 0.12, text: '', caption: '', base: '', auto: false };
    }
    items.push(el);
    bbSel = items.length - 1;
    state.dirty = true;
    renderCanvas();
    renderElements();
    if (type === 'character') {
      await refreshCharCaptions();
    } else if (type === 'object') {
      // 景物框默认带上当前场景描述（原来的「填场景」按钮，现在自动化）
      if (!el.caption && state.edit.scene_id) {
        const b = await sceneBundle(state.edit.scene_id);
        if (b.caption) { el.caption = b.caption; el.auto = true; renderElements(); renderCanvas(); }
      }
      schedulePreview();
    } else {
      schedulePreview();
    }
    scrollElemIntoView();
  }

  /** 折叠/展开整块元素面板：折叠后只剩标题行（按钮和双击卡片都走这里） */
  function toggleCollapse(i) {
    const el = layoutItems()[i];
    if (!el) return;
    el._collapsed = !el._collapsed;
    renderElements();
  }

  /** 排序：把某个元素排到第一位（场景是背景，始终留在最前，所以其它元素排到它后面） */
  function promoteElement(i) {
    const items = layoutItems();
    if (i < 0 || i >= items.length) return;
    const sceneIdx = items.findIndex(x => x.type === 'scene');
    const target = (sceneIdx >= 0 && items[i].type !== 'scene') ? sceneIdx + 1 : 0;
    if (i === target) return;
    const el = items.splice(i, 1)[0];
    items.splice(Math.min(target, items.length), 0, el);
    bbSel = items.indexOf(el);
    state.dirty = true;
    renderCanvas();
    renderElements();
    scrollElemIntoView();
    schedulePreview();                   // 顺序变了，提示词 items 顺序也变
  }

  async function changeElement(i, field, value) {
    const el = layoutItems()[i];
    if (!el) return;
    if (field === 'character_id') {
      el.character_id = Number(value) || null;
      el.appearance_id = null;
      if (el.character_id) {
        await ensurePresets(el.character_id);
        const cc = charOf(el.character_id);
        el.character_name = cc ? cc.name : '';
        const p = presetOf(el.character_id, null);
        if (p) el.appearance_id = p.id;
      } else { el.character_name = ''; }
      state.dirty = true; renderElements(); renderCanvas();
      await refreshCharCaptions();
    } else if (field === 'appearance_id') {
      el.appearance_id = Number(value) || null;
      state.dirty = true; renderElements(); renderCanvas();
      await refreshCharCaptions();
    } else if (field === 'pose_id') {
      el.pose_id = value;
      state.dirty = true; renderElements(); renderCanvas();
      await refreshCharCaptions();
    } else if (field === 'scene_id') {
      await applySceneToElement(i, value);
    } else if (field === 'scene_prompt') {
      el.scene_prompt = value;
      state.edit.scene_prompt = value;
      state.dirty = true; schedulePreview();
    } else if (field === 'note') {
      // 可添加内容：本地拼到描述后，卡片里那句「当前提示词」就地更新（不重建 DOM）
      el.note = value;
      el.caption = (el.base || '') + noteSuffix(el.note);
      state.dirty = true; syncElementCaption(i); renderCanvas(); schedulePreview();
    } else if (field === 'caption') {
      el.caption = value; el.auto = false;
      state.dirty = true; syncElementCaption(i); renderCanvas(); schedulePreview();
    } else if (field === 'text') {
      el.text = value;
      state.dirty = true; syncElementTitle(i); renderCanvas(); schedulePreview();
    }
  }

  async function fetchCaptions(els) {
    const e = state.edit;
    const chars = (els || []).map(c => ({
      character_id: Number(c.character_id),
      appearance_id: c.appearance_id ? Number(c.appearance_id) : null,
      // 空值 = 用户明确选了「无动作」：用 __none__ 告诉后端把外观自带的姿态也清掉
      pose_id: c.pose_id || '__none__',
    }));
    return Admin.post('/scene-gen/compose/captions', {
      characters: chars,
      scene_id: e.scene_id || null,
      scene_appearance: (e.scene_appearance && Object.keys(e.scene_appearance).length) ? e.scene_appearance : null,
    });
  }

  async function fetchSceneCaption(sceneId) {
    const e = state.edit;
    const sid = (sceneId != null) ? sceneId : (e.scene_id || null);
    return Admin.post('/scene-gen/compose/captions', {
      characters: [],
      scene_id: sid || null,
      scene_appearance: (e.scene_appearance && Object.keys(e.scene_appearance).length) ? e.scene_appearance : null,
    });
  }

  /** 人物元素：按（人物+外观+动作）重新拉一句话描述，note 拼在后面；参数一动就实时刷新 */
  async function refreshCharCaptions() {
    const els = charElements().filter(e => e.character_id);
    if (!els.length) { renderCanvas(); schedulePreview(); return; }
    try {
      const r = await fetchCaptions(els);
      // 后端按请求顺序逐个返回，用下标对齐最稳（同一个人物出现两次也不会串）
      els.forEach((e, idx) => {
        const ok = (r.characters || [])[idx];
        if (ok && ok.caption) { e.base = ok.caption; e.caption = ok.caption + noteSuffix(e.note); }
      });
      layoutItems().forEach((el, idx) => { if (el.type === 'character') syncElementCaption(idx); });
      renderCanvas();
      schedulePreview();
    } catch (_) { renderCanvas(); schedulePreview(); }
  }

  /** 场景变化：把「自动」景物框的描述刷新成当前场景拼装 */
  async function applySceneToBoxes() {
    const objs = objectElements().filter(e => e.auto);
    if (!objs.length) return;
    try {
      const r = await fetchSceneCaption();
      if (r.scene_caption) {
        objs.forEach(o => { o.caption = r.scene_caption; });
        layoutItems().forEach((el, idx) => { if (el.type === 'object') syncElementCaption(idx); });
        renderCanvas(); schedulePreview();
      }
    } catch (_) { /* ignore */ }
  }


  // ==================== 边界框画布（左栏） ====================
  function gpSize() {
    const gp = window.GenParams ? GenParams.get('scenes') : {};
    return { w: parseInt(gp.width) || 1344, h: parseInt(gp.height) || 768 };
  }

  function renderCanvas() {
    const host = $('cmp-bb-canvas');
    if (!host) return;
    const { w, h } = gpSize();
    const sizeTip = $('cmp-bb-size');
    if (sizeTip) sizeTip.textContent = `画布 ${w}×${h}（跟随上方出图参数）`;
    host.style.aspectRatio = `${w} / ${h}`;
    const items = layoutItems();
    if (!items.length) {
      host.innerHTML = '<div class="cmp-bb-empty">还没有元素。<br>点「元素框」里的 👤人物 / 🌄景物 / 🅣文字 / 🌐场景 开始布局，框会显示在这里；拖动移动、四角改大小。</div>';
      return;
    }
    host.innerHTML = items.map((b, i) => {
      const inner = b.type === 'text'
        ? (b.text || '（文字）')
        : (b.type === 'character'
            ? (b.character_name ? b.character_name + '：' : '') + (b.caption || '（未填描述）')
            : (b.type === 'scene'
                ? (b.caption || '（未生成场景提示词）')
                : (b.caption || '（未填描述）')));
      const scName = (b.type === 'scene' && b.scene_id && sceneOf(b.scene_id)) ? '·' + esc(sceneOf(b.scene_id).name) : '';
      return `
        <div class="cmp-bb-box t-${esc(b.type)}${i === bbSel ? ' sel' : ''}${b.locked ? ' locked' : ''}" data-bi="${i}"
          style="left:${(b.x * 100).toFixed(2)}%;top:${(b.y * 100).toFixed(2)}%;width:${(b.w * 100).toFixed(2)}%;height:${(b.h * 100).toFixed(2)}%">
          <div class="cmp-bb-tag">${b.locked ? '🔒' : ''}${esc(BB_TXT[b.type] || '景物')}${b.type === 'character' && b.character_name ? '·' + esc(b.character_name) : ''}${scName}</div>
          <div class="cmp-bb-cap">${esc(inner)}</div>
          <div class="cmp-bb-rs rs-tl" data-rs="${i}" data-corner="tl" title="拖动改大小"></div>
          <div class="cmp-bb-rs rs-tr" data-rs="${i}" data-corner="tr" title="拖动改大小"></div>
          <div class="cmp-bb-rs rs-bl" data-rs="${i}" data-corner="bl" title="拖动改大小"></div>
          <div class="cmp-bb-rs rs-br" data-rs="${i}" data-corner="br" title="拖动改大小"></div>
        </div>`;
    }).join('');
  }

  function bindCanvas() {
    const host = $('cmp-bb-canvas');
    if (!host) return;
    let drag = null;
    host.addEventListener('pointerdown', (ev) => {
      const box = ev.target.closest('.cmp-bb-box');
      if (!box) { if (bbSel !== -1) { bbSel = -1; renderCanvas(); renderElements(); } return; }
      const i = Number(box.dataset.bi);
      const b = layoutItems()[i];
      if (!b) return;
      const rs = ev.target.closest('[data-rs]');
      if (b.locked) {                     // 锁定的画框：点不中、拖不动（元素框里点 🔒 可解）
        return;
      }
      if (bbSel !== i) {
        bbSel = i;
        renderCanvas();
        syncSelClasses();                 // 只同步高亮，不重建元素框（保住输入焦点）
      }
      drag = {
        i, mode: rs ? 'resize' : 'move',
        corner: rs ? (rs.dataset.corner || 'br') : '',
        rect: host.getBoundingClientRect(),
        startX: ev.clientX, startY: ev.clientY,
        ox: b.x, oy: b.y, ow: b.w, oh: b.h,
        moved: false,
      };
      try { host.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      ev.preventDefault();
    });
    host.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const b = layoutItems()[drag.i];
      if (!b) return;
      const dx = (ev.clientX - drag.startX) / drag.rect.width;
      const dy = (ev.clientY - drag.startY) / drag.rect.height;
      if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) drag.moved = true;
      if (drag.mode === 'move') {
        b.x = Math.min(Math.max(0, drag.ox + dx), 1 - b.w);
        b.y = Math.min(Math.max(0, drag.oy + dy), 1 - b.h);
      } else {
        const MIN = 0.04;
        let x1 = drag.ox, y1 = drag.oy, x2 = drag.ox + drag.ow, y2 = drag.oy + drag.oh;
        const c = drag.corner;
        if (c.includes('l')) x1 = drag.ox + dx;
        if (c.includes('r')) x2 = drag.ox + drag.ow + dx;
        if (c.includes('t')) y1 = drag.oy + dy;
        if (c.includes('b')) y2 = drag.oy + drag.oh + dy;
        let nx = Math.min(x1, x2), ny = Math.min(y1, y2);
        let nw = Math.min(1, Math.max(MIN, Math.abs(x2 - x1)));
        let nh = Math.min(1, Math.max(MIN, Math.abs(y2 - y1)));
        nx = Math.min(Math.max(0, nx), 1 - nw);
        ny = Math.min(Math.max(0, ny), 1 - nh);
        b.x = nx; b.y = ny; b.w = nw; b.h = nh;
      }
      const el = host.querySelector(`[data-bi="${drag.i}"]`);
      if (el) {
        el.style.left = (b.x * 100).toFixed(2) + '%';
        el.style.top = (b.y * 100).toFixed(2) + '%';
        el.style.width = (b.w * 100).toFixed(2) + '%';
        el.style.height = (b.h * 100).toFixed(2) + '%';
      }
    });
    const endDrag = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      state.dirty = true;
      schedulePreview();
      // 只是「点了一下画框」→ 把它对应的元素排到第一位（排序功能）
      if (!d.moved && d.mode === 'move') promoteElement(d.i);
    };
    host.addEventListener('pointerup', endDrag);
    host.addEventListener('pointercancel', endDrag);
  }

  // ==================== 提示词预览 ====================
  function promptKey() { return state.editId ? String(state.editId) : 'new'; }
  function schedulePreview() {
    const k = promptKey();
    if (state.promptMemo[k]) state.promptMemo[k] = null;   // 参数一变，手动改的内容作废
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 260);
  }

  function composeBody() {
    const e = state.edit;
    const gp = window.GenParams ? GenParams.get('scenes') : {};
    const chars = charElements().filter(c => c.character_id).map(c => ({
      character_id: Number(c.character_id),
      appearance_id: c.appearance_id ? Number(c.appearance_id) : null,
      // 「无动作」要明确告诉后端清掉外观自带姿态（否则提示词里还会写出动作）
      pose_id: c.pose_id || '__none__',
      framing: appearanceFraming(c.character_id, c.appearance_id),
      shot: null, placement: null, note: c.note || null,
    }));
    return {
      characters: chars,
      scene_id: e.scene_id ? Number(e.scene_id) : null,
      scene_appearance: (e.scene_appearance && Object.keys(e.scene_appearance).length) ? e.scene_appearance : null,
      scene_prompt: e.scene_prompt || '',
      shot: 'medium', placement: 'center', extra: '',
      width: parseInt(gp.width) || 1344, height: parseInt(gp.height) || 768,
    };
  }

  async function refreshPreview() {
    const ta = $('cmp-prompt');
    if (!ta) return;
    const k = promptKey();
    const memo = state.promptMemo[k];
    const keepManual = !!(memo && memo.text !== memo.generated);
    const e = state.edit;
    if (!e) { ta.value = ''; state.promptMemo[k] = null; return; }
    const items = layoutItems();
    const hasContent = items.some(it =>
      (it.type === 'character' && it.character_id)
      || (it.type === 'object' && (it.caption || '').trim())
      || (it.type === 'scene' && (it.scene_id || (it.caption || '').trim()))
      || (it.type === 'text' && (it.text || '').trim()));
    if (hasContent) {
      const gp = window.GenParams ? GenParams.get('scenes') : {};
      const scene = e.scene_id ? sceneOf(e.scene_id) : null;
      const base = (scene ? scene.name : '') + (e.scene_prompt ? ('：' + e.scene_prompt) : '');
      try {
        const r = await Admin.post('/scene-gen/compose/layout', {
          layout: e.layout,
          width: parseInt(gp.width) || 1344,
          height: parseInt(gp.height) || 768,
          base_prompt: base || null,
        });
        const text = r.prompt || '（布局为空）';
        if (keepManual && memo.generated === text) { state.promptMemo[k] = { generated: text, text: memo.text }; return; }
        ta.value = text;
        state.promptMemo[k] = { generated: text, text };
      } catch (err) {
        ta.value = '布局编译失败：' + err.message;
        state.promptMemo[k] = null;
      }
      return;
    }
    const body = composeBody();
    if (!body.characters.length) { ta.value = '在「元素框」里加至少一个人物的画框。'; state.promptMemo[k] = null; return; }
    if (!body.scene_id) { ta.value = '先在左侧选一个场景。'; state.promptMemo[k] = null; return; }
    try {
      const r = await Admin.post('/scene-gen/compose/prompt', body);
      const text = r.prompt?.posCn || '（提示词为空）';
      if (keepManual && memo.generated === text) { state.promptMemo[k] = { generated: text, text: memo.text }; return; }
      ta.value = text;
      state.promptMemo[k] = { generated: text, text };
    } catch (er) {
      ta.value = '提示词生成失败：' + er.message;
      state.promptMemo[k] = null;
    }
  }

  // ==================== 保存 / 复制 / 删除 ====================
  function configBody() {
    const e = state.edit;
    const gp = window.GenParams ? GenParams.get('scenes') : {};
    const characters = charElements().filter(c => c.character_id).map(c => ({
      character_id: Number(c.character_id),
      appearance_id: c.appearance_id ? Number(c.appearance_id) : null,
      // 「无动作」要明确告诉后端清掉外观自带姿态（否则提示词里还会写出动作）
      pose_id: c.pose_id || '__none__',
      framing: appearanceFraming(c.character_id, c.appearance_id),
      shot: null, placement: null, note: c.note || null,
    }));
    return {
      name: e.name || '',
      scene_id: e.scene_id || null,
      scene_appearance: e.scene_appearance || null,
      scene_prompt: e.scene_prompt || '',
      characters,
      shot: 'medium', placement: 'center', extra: '',
      width: parseInt(gp.width) || null,
      height: parseInt(gp.height) || null,
      model_preset: gp.model_preset || null,
      // 折叠(_collapsed)只是临时 UI 状态，不进库；否则下次打开配置一进来就是收起的
      layout: {
        items: ((e.layout && Array.isArray(e.layout.items)) ? e.layout.items : []).map(it => {
          const copy = Object.assign({}, it);
          delete copy._collapsed;
          return copy;
        }),
      },
    };
  }

  async function saveEdit(silent) {
    const e = state.edit;
    if (!e) return null;
    const chars = charElements().filter(c => c.character_id);
    const boxes = (e.layout.items || []).filter(b =>
      (b.type === 'character' && b.character_id) || (b.type === 'object' && (b.caption || '').trim())
      || (b.type === 'scene' && (b.scene_id || (b.caption || '').trim())) || (b.type === 'text' && (b.text || '').trim()));
    if (!chars.length && !boxes.length) {
      if (!silent) Admin.toast('先在「元素框」里加至少一个人物的画框', 'error');
      return null;
    }
    const body = configBody();
    try {
      const saved = e.id
        ? await Admin.put(`/scene-gen/compose/configs/${e.id}`, body)
        : await Admin.post('/scene-gen/compose/configs', body);
      const i = state.configs.findIndex(c => c.id === saved.id);
      if (i >= 0) state.configs[i] = saved; else state.configs.push(saved);
      if (!e.id && state.promptMemo.new) {
        state.promptMemo[String(saved.id)] = state.promptMemo.new;
        delete state.promptMemo.new;
      }
      state.editId = saved.id;
      state.edit = JSON.parse(JSON.stringify(saved));
      state.edit.characters = [];
      state.edit.layout = { items: (saved.layout && saved.layout.items) || [] };
      state.dirty = false;
      renderList();
      renderSceneBar();
      renderElements();
      renderCanvas();
      if (!silent) Admin.toast('配置已保存', 'success');
      return saved;
    } catch (err) {
      if (!silent) Admin.toast('保存失败：' + err.message, 'error');
      return null;
    }
  }

  async function copyConfig(id) {
    try {
      const dup = await Admin.post(`/scene-gen/compose/configs/${id}/copy`);
      await loadConfigs();
      const found = state.configs.find(c => c.id === dup.id) || dup;
      await selectConfig(found);
      Admin.toast('已复制出新配置', 'success');
    } catch (e) { Admin.toast('复制失败：' + e.message, 'error'); }
  }

  async function deleteConfig(id) {
    if (!await Admin.confirm('删除这条合成配置？（已出的图不受影响）')) return;
    try {
      await Admin.del(`/scene-gen/compose/configs/${id}`);
      state.checked.delete(id);
      if (state.editId === id) { state.editId = null; state.edit = null; }
      await loadConfigs();
      // 删除后保证仍有一个有效选中态，避免无法再点选
      if (state.editId && !state.configs.find(c => c.id === state.editId)) { state.editId = null; state.edit = null; }
      if (state.editId == null) {
        if (state.configs.length) await selectConfig(state.configs[0]);
        else { state.edit = blankConfig(); renderSceneBar(); renderElements(); renderCanvas(); }
      }
      Admin.toast('已删除配置', 'success');
    } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
  }

  async function saveThisConfig(id) {
    const cfg = state.configs.find(c => c.id === id);
    if (!cfg) return;
    if (state.editId !== id) await selectConfig(cfg);
    await saveEdit(false);
  }

  /** 卡片内联重命名：把标题换成输入框，回车/失焦提交，Esc 取消 */
  function startRename(id, card) {
    if (!card) return;
    const t = card.querySelector('.t');
    if (!t || t.querySelector('input')) return;
    const cfg = state.configs.find(c => c.id === id);
    if (!cfg) return;
    const old = cfg.name || '';
    t.innerHTML = '';
    const inp = document.createElement('input');
    inp.className = 'cmp-rename-inp';
    inp.value = old;
    t.appendChild(inp);
    inp.focus(); inp.select();
    let done = false;
    const commit = async (save) => {
      if (done) return; done = true;
      if (save) await renameConfig(id, inp.value);
      else renderList();
    };
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
      ev.stopPropagation();
    });
    inp.addEventListener('click', (ev) => ev.stopPropagation());
    inp.addEventListener('blur', () => commit(true));
  }

  /** 新建：立刻落库一条「新建配置」并选中，绝不动已有配置 */
  async function newConfig() {
    try {
      const firstScene = state.scenes[0];
      const created = await Admin.post('/scene-gen/compose/configs', {
        name: '新建配置',
        scene_id: firstScene ? firstScene.id : null,
      });
      const i = state.configs.findIndex(c => c.id === created.id);
      if (i >= 0) state.configs[i] = created; else state.configs.push(created);
      await selectConfig(created);
      Admin.toast('已新建配置「新建配置」，点 ✎ 可重命名', 'success');
    } catch (e) { Admin.toast('新建失败：' + e.message, 'error'); }
  }

  async function renameConfig(id, newName) {
    const cfg = state.configs.find(c => c.id === id);
    if (!cfg) { renderList(); return; }
    newName = String(newName || '').trim() || '新建配置';
    cfg.name = newName;
    if (state.editId === id && state.edit) state.edit.name = newName;
    renderList();
    if (cfg.id != null) {
      try { await Admin.put(`/scene-gen/compose/configs/${id}`, { name: newName }); }
      catch (e) { Admin.toast('改名保存失败：' + e.message, 'error'); }
    }
  }

  // ==================== 出图（提交即返回，按钮不置灰）====================
  async function renderChecked() {
    if (state.edit && state.dirty) {
      const saved = await saveEdit(true);
      if (!saved) return;
      state.checked.add(saved.id);
      renderList();
    }
    const ids = [...state.checked];
    if (!ids.length) { Admin.toast('先勾选要生成的合成配置', 'error'); return; }
    const gp = window.GenParams ? GenParams.get('scenes') : {};
    const prompts = {};
    ids.forEach((id) => { if (isPromptEdited(id)) prompts[id] = state.promptMemo[String(id)].text; });
    try {
      const r = await Admin.post('/scene-gen/compose/batch', {
        ids,
        width: parseInt(gp.width) || null,
        height: parseInt(gp.height) || null,
        // 步数 / CFG 必须显式传：不传就会退回全局参数，出现「面板改 10 步、实际跑 12 步」
        steps: Number(gp.steps) || null,
        cfg: Number(gp.cfg) || null,
        model_preset: gp.model_preset || null,
        prompts: Object.keys(prompts).length ? prompts : null,
      });
      (r.submitted || []).forEach(x => {
        state.jobs.set(x.id, { jobId: x.job_id, name: x.name, status: 'queued', message: '已提交', done: 0, total: 1 });
      });
      const skipped = r.skipped || [];
      $('cmp-status').textContent = `已提交 ${r.count || 0} 条到 ComfyUI 队列` +
        (skipped.length ? `，跳过 ${skipped.length} 条（${skipped.map(s => s.name + '：' + s.reason).join('；')}）` : '');
      Admin.toast(`已提交 ${r.count || 0} 条，后台排队出图`, 'success');
      renderQueue();
      startPolling();
    } catch (e) {
      $('cmp-status').textContent = '提交失败：' + e.message;
      Admin.toast('提交失败：' + e.message, 'error');
    }
  }

  function isPromptEdited(id) {
    const m = state.promptMemo[String(id)];
    return !!(m && m.text && m.text !== m.generated);
  }

  function renderQueue() {
    const host = $('cmp-queue');
    if (!host) return;
    if (!state.jobs.size) { host.innerHTML = ''; return; }
    host.innerHTML = [...state.jobs.entries()].map(([cid, j]) => {
      const st = j.status || 'queued';
      const prog = (st === 'running' && j.total > 1) ? ` ${j.done}/${j.total}` : '';
      return `<div class="q">
        <span class="cmp-badge ${st}">${STATUS_TXT[st] || st}</span>
        <b>${esc(j.name || ('#' + cid))}</b>
        <span>${esc(j.message || '')}${prog}</span>
      </div>`;
    }).join('');
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollJobs, 2000);
    pollJobs();
  }

  async function pollJobs() {
    if (!state.jobs.size) { stopPolling(); return; }
    let data;
    try { data = await Admin.get('/jobs'); } catch (_) { return; }
    const byId = {};
    (data.jobs || []).forEach(j => { byId[j.id] = j; });
    let live = false;
    let finishedNew = false;
    state.jobs.forEach((rec) => {
      const j = byId[rec.jobId];
      if (!j) return;
      rec.status = j.status;
      rec.message = j.message || rec.message;
      rec.done = j.done || 0;
      rec.total = j.total || 1;
      if (['queued', 'running', 'paused'].includes(j.status)) live = true;
      if (j.status === 'done' && !rec.seen) {
        rec.seen = true;
        finishedNew = true;
        Admin.toast(`「${rec.name || '合成图'}」出图完成`, 'success');
      }
    });
    renderQueue();
    if (finishedNew) await loadRecent();
    if (!live) {
      const n = [...state.jobs.values()].filter(x => x.status === 'done').length;
      $('cmp-status').textContent = `本轮 ${state.jobs.size} 条任务已结束（成功 ${n} 条）`;
      stopPolling();
    }
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function loadRecent() {
    try {
      const r = await Admin.get('/scene-gen/compose/recent?limit=24');
      state.recentItems = r.items || [];
      renderGallery();
    } catch (_) { /* ignore */ }
  }

  function galleryItems() {
    return (state.recentItems || []).map(x => ({
      url: x.url, title: '人物 × 场景合成', prompt: x.prompt || '',
      width: x.width, height: x.height,
    }));
  }

  function renderGallery() {
    const host = $('cmp-gallery');
    if (!host) return;
    const items = state.recentItems || [];
    if (!items.length) {
      host.innerHTML = '<div class="sc-empty" style="grid-column:1/-1">还没有合成图</div>';
      paintGallerySel();
      return;
    }
    host.innerHTML = items.map((it, i) => `
      <div class="cmp-shot${state.gallerySel.has(String(it.id)) ? ' sel' : ''}" data-id="${it.id}" data-i="${i}" data-url="${esc(it.url)}">
        <img src="${esc(it.url)}" alt="" loading="lazy" title="单击选中 · 双击看大图 · 右键菜单">
        <div class="m">${esc(it.character_name || '人物')} · ${it.width && it.height ? it.width + '×' + it.height : ''}</div>
      </div>`).join('');
    host.querySelectorAll('.cmp-shot').forEach(card => {
      const id = card.dataset.id;
      card.addEventListener('click', (e) => {
        if (e.shiftKey) {
          if (state.gallerySel.has(id)) state.gallerySel.delete(id); else state.gallerySel.add(id);
        } else { state.gallerySel.clear(); state.gallerySel.add(id); }
        paintGallerySel();
      });
      card.addEventListener('dblclick', () => {
        const i = Number(card.dataset.i) || 0;
        if (window.ImagePreview) ImagePreview.open(galleryItems(), i);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openGalleryMenu(e.clientX, e.clientY, id);
      });
    });
    paintGallerySel();
  }

  function paintGallerySel() {
    const host = $('cmp-gallery');
    if (host) host.querySelectorAll('.cmp-shot').forEach(card => {
      card.classList.toggle('sel', state.gallerySel.has(card.dataset.id));
    });
    const sc = $('cmp-gallery-sel');
    if (sc) sc.textContent = state.gallerySel.size ? `已选 ${state.gallerySel.size} 张` : '';
  }

  function openGalleryMenu(x, y, id) {
    if (!state.gallerySel.has(id)) { state.gallerySel.clear(); state.gallerySel.add(id); paintGallerySel(); }
    const items = state.recentItems || [];
    const picked = items.filter(it => state.gallerySel.has(String(it.id)));
    const sceneId = state.edit && state.edit.scene_id;
    const menu = document.createElement('div');
    menu.className = 'cmp-gmenu';
    menu.innerHTML = `
      <button type="button" data-act="view">🔍 查看大图</button>
      <button type="button" data-act="copy">📋 复制提示词（${picked.length} 张）</button>
      ${sceneId ? '<button type="button" data-act="cover">🖼 设为场景封面</button>' : ''}
      <button type="button" data-act="del" class="danger">🗑 删除选中（${picked.length} 张）</button>`;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 220)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 170)) + 'px';
    document.body.appendChild(menu);
    const close = () => { menu.remove(); document.removeEventListener('mousedown', onDocDown); };
    function onDocDown(ev) { if (!menu.contains(ev.target)) close(); }
    setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
    menu.querySelector('[data-act="view"]').addEventListener('click', (e) => {
      e.stopPropagation(); close();
      const idx = items.findIndex(it => String(it.id) === id);
      if (window.ImagePreview) ImagePreview.open(galleryItems(), idx < 0 ? 0 : idx);
    });
    menu.querySelector('[data-act="copy"]').addEventListener('click', async (e) => {
      e.stopPropagation(); close();
      const text = picked.map(it => it.prompt || '').filter(Boolean).join('\n\n');
      if (!text) { Admin.toast('这些图没有提示词', 'info'); return; }
      try { await navigator.clipboard.writeText(text); Admin.toast(`已复制 ${picked.length} 张提示词`, 'success'); }
      catch { Admin.toast('复制失败', 'error'); }
    });
    const coverBtn = menu.querySelector('[data-act="cover"]');
    if (coverBtn) coverBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); close();
      const it = picked[0];
      try {
        await Admin.put(`/scenes/${sceneId}`, { background_image: it.url });
        const sc = sceneOf(sceneId);
        if (sc) sc.background_image = it.url;
        if (state.edit.scene_id === Number(sceneId)) refreshSceneThumb();
        Admin.toast('已设为场景封面', 'success');
      } catch (err) { Admin.toast('设置失败：' + err.message, 'error'); }
    });
    menu.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
      e.stopPropagation(); close();
      if (!await Admin.confirm(`删除选中的 ${picked.length} 张合成图？（引用它的场景封面会一并清除）`)) return;
      let ok = 0;
      for (const it of picked) {
        try { await Admin.del(`/assets/${it.id}?remove_file=true&force=true`); ok++; }
        catch (err) { Admin.toast('删除失败：' + (err.message || ''), 'error'); }
      }
      state.gallerySel.clear();
      await loadRecent();
      Admin.toast(`已删除 ${ok} 张`, ok ? 'success' : 'error');
    });
  }

  // ==================== 事件 ====================
  // ---- 列表（复制/删除/保存图标 + 卡片点选 + 勾选）----
  $('cmp-cfg-list').addEventListener('click', async (e) => {
    if (e.target.closest('.cmp-rename-inp')) return;      // 正在重命名，别触发选中/重渲染
    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      const id = Number(act.dataset.id);
      if (act.dataset.act === 'copy') await copyConfig(id);
      else if (act.dataset.act === 'del') await deleteConfig(id);
      else if (act.dataset.act === 'save') await saveThisConfig(id);
      else if (act.dataset.act === 'rename') startRename(id, act.closest('.cmp-cfg-card'));
      return;
    }
    const ck = e.target.closest('[data-ck]');
    if (ck) {
      const id = Number(ck.dataset.ck);
      if (ck.checked) state.checked.add(id); else state.checked.delete(id);
      const card = ck.closest('.cmp-cfg-card');
      if (card) card.classList.toggle('on', ck.checked);
      return;
    }
    const card = e.target.closest('.cmp-cfg-card');
    if (card) {
      const cfg = state.configs.find(c => c.id === Number(card.dataset.id));
      if (cfg) await selectConfig(cfg);
    }
  });

  $('cmp-new').addEventListener('click', () => newConfig());
  $('cmp-check-all').addEventListener('click', () => {
    state.configs.forEach(c => state.checked.add(c.id));
    renderList();
  });
  $('cmp-uncheck').addEventListener('click', () => {
    state.checked.clear();
    renderList();
  });

  // ---- 元素框：增删改 + 选中联动 ----
  $('cmp-add-char').addEventListener('click', () => addElement('character'));
  $('cmp-add-obj').addEventListener('click', () => addElement('object'));
  $('cmp-add-text').addEventListener('click', () => addElement('text'));
  $('cmp-add-scene').addEventListener('click', () => addElement('scene'));
  $('cmp-elem-clear').addEventListener('click', async () => {
    if (!layoutItems().length) return;
    if (!await Admin.confirm('清空所有元素？画框和提示词会一起清掉（配置文件本身还在）')) return;
    layoutItems().splice(0);
    bbSel = -1; state.dirty = true;
    renderCanvas(); renderElements(); schedulePreview();
  });

  $('cmp-elem-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-act="del-el"]');
    if (del) {
      e.stopPropagation();
      const i = Number(del.dataset.ei);
      const el = layoutItems()[i];
      if (!el) return;
      const what = el.type === 'character'
        ? ('人物「' + (el.character_name || '未选') + '」')
        : (el.type === 'scene' ? '场景' : (el.type === 'text' ? '文字' : '景物'));
      // 删除必须确认：这很容易误点
      if (!await Admin.confirm('删除这个' + what + '元素？画框和它的提示词会一起移除')) return;
      layoutItems().splice(i, 1);
      if (bbSel === i) bbSel = -1;
      else if (bbSel > i) bbSel--;
      state.dirty = true;
      renderCanvas(); renderElements(); schedulePreview();
      return;
    }
    const pick = e.target.closest('[data-bact="pick-scene"]');
    if (pick) {
      e.stopPropagation();
      openScenePicker(Number(pick.dataset.ei), pick);
      return;
    }
    const lock = e.target.closest('[data-bact="lock"]');
    if (lock) {
      e.stopPropagation();
      const i = Number(lock.dataset.ei);
      const el = layoutItems()[i];
      if (el) {
        el.locked = !el.locked;
        state.dirty = true;
        renderCanvas(); renderElements();
        Admin.toast(el.locked ? '已锁定：这个画框点不中、拖不动' : '已解锁：可以选中和拖动这个画框', 'success');
      }
      return;
    }
    const top = e.target.closest('[data-bact="promote"]');
    if (top) {
      e.stopPropagation();
      promoteElement(Number(top.dataset.ei));
      return;
    }
    const tog = e.target.closest('[data-bact="toggle"]');
    if (tog) {
      e.stopPropagation();
      toggleCollapse(Number(tog.dataset.ei));
      return;
    }
    const row = e.target.closest('.cmp-el');
    if (row) {
      const i = Number(row.dataset.ei);
      if (bbSel !== i) {
        bbSel = i;
        renderCanvas();
        // 点的是表单控件（输入框/下拉）：只同步高亮，不重建列表，避免第一次点击丢失焦点
        if (e.target.closest('input,select,textarea,button')) syncSelClasses();
        else renderElements();
      }
    }
  });
  /** 双击元素卡任意空白处 = 折叠/展开整块（用户要求的快捷方式） */
  $('cmp-elem-list').addEventListener('dblclick', (e) => {
    if (e.target.closest('input,select,textarea,button,a,label')) return;
    const row = e.target.closest('.cmp-el');
    if (!row) return;
    e.preventDefault();
    toggleCollapse(Number(row.dataset.ei));
  });
  $('cmp-elem-list').addEventListener('input', (e) => {
    const el = e.target.closest('[data-ef]');
    if (!el) return;
    if (el.tagName === 'SELECT') return;         // 下拉交给 change，避免重复请求
    changeElement(Number(el.dataset.ei), el.dataset.ef, el.value);
  });
  $('cmp-elem-list').addEventListener('change', (e) => {
    const el = e.target.closest('[data-ef]');
    if (!el) return;
    changeElement(Number(el.dataset.ei), el.dataset.ef, el.value);
  });

  // ---- 选中画框后按 Delete 直接删（不弹确认；正在输入框里打字时忽略）----
  if (window.__cmpDelKey) document.removeEventListener('keydown', window.__cmpDelKey);
  window.__cmpDelKey = (ev) => {
    if (ev.key !== 'Delete') return;
    if (!document.body.contains(container)) return;      // 已切到别的页面
    const t = ev.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (bbSel < 0) return;
    const items = layoutItems();
    if (!items[bbSel]) return;
    ev.preventDefault();
    items.splice(bbSel, 1);
    bbSel = -1;
    state.dirty = true;
    renderCanvas(); renderElements(); schedulePreview();
    Admin.toast('已删除选中的画框（Delete）', 'success');
  };
  document.addEventListener('keydown', window.__cmpDelKey);

  // ---- 顶部 ----
  $('cmp-render').addEventListener('click', renderChecked);
  $('cmp-prompt').addEventListener('input', (e) => {
    const k = promptKey();
    const memo = state.promptMemo[k] || { generated: '', text: '' };
    memo.text = e.target.value;
    state.promptMemo[k] = memo;
  });
  $('cmp-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('cmp-prompt').value || '');
      Admin.toast('提示词已复制', 'success');
    } catch { Admin.toast('复制失败', 'error'); }
  });

  if (window.GenParams) {
    try { await GenParams.init($('cmp-gen-params'), { scope: 'scenes' }); }
    catch (e) { $('cmp-gen-params').innerHTML = `<div class="cmp-tip">参数加载失败：${esc(e.message)}</div>`; }
  }
  bindCanvas();
  if (window.GenParams) GenParams.onChange(() => renderCanvas(), 'scenes');

  // ==================== 初始化 ====================
  try {
    await loadBase();
    await loadConfigs();
    if (state.configs.length) await selectConfig(state.configs[0]);
    else { state.edit = blankConfig(); renderSceneBar(); renderElements(); renderCanvas(); }
    await loadRecent();
  } catch (e) {
    container.innerHTML = `<div class="table-empty">合成页初始化失败：${esc(e.message)}</div>`;
  }
});
