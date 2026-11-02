// ==========================================================================
// 卡牌系统后台（裂界誓约 · 六职业 30 张回合卡牌对决）
//
// 分页：
//   卡牌库    —— 41 张卡的全部参数，可改可加可删
//   卡面生产  —— 拼装提示词 → 直接丢 ComfyUI 出图 → 自动套回卡面
//   职业      —— 6 职业面板 + 男女衣着 + 默认牌组
//   战斗情感  —— 20 条情感（emoji / 台词 / 回应）
//   战斗对话  —— 29 条触发规则（触发点 / 权重 / 冷却 / 每局一次）
//   角色卡组  —— 给角色管理里的人物配职业与 30 张牌组
//   提示词设置—— 模板、负向、模型预设、尺寸、取景、自动套图
//   战斗规则  —— 触发点与规则说明（只读，给策划看）
// ==========================================================================
Admin.registerPage('cards', async (container) => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const $ = (id) => document.getElementById(id);

  const TABS = [
    ['deck', '卡牌库'],
    ['art', '卡面生产'],
    ['sets', '卡牌套装'],
    ['classes', '职业'],
    ['demo', '对战演示'],
    ['emotions', '战斗情感'],
    ['emoprof', '情感与表现'],
    ['emostyle', '表现样式'],
    ['dialogues', '战斗对话'],
    ['loadouts', '角色卡组'],
    ['settings', '提示词与设置'],
    ['rules', '战斗规则'],
  ];
  const CATEGORY = [
    ['universal', '通用'], ['attack', '攻击'], ['guard', '守卫'],
    ['special', '功能'], ['skill', '技能'], ['passive', '被动'],
  ];
  const CAT_COLOR = { attack: '#c8564f', guard: '#3f86c4', special: '#9155c8', skill: '#b08e3a' };

  let tab = localStorage.getItem('cg_tab') || 'deck';
  const S = {
    cards: [], classes: [], emotions: [], dialogues: [], triggers: [],
    loadouts: [], chars: [], settings: {},
    sets: [], setActive: '', deckReport: null,
    filter: { class_code: 'all', category: 'all', q: '', set_code: 'all' },
    artFilter: { class_code: 'all', only: 'todo', set_code: 'all' },
    art: { class_code: '', gender: 'female', character_id: '' },
    setCodes: {},   // set_code -> Set(card_code)，按套装筛选时缓存
    loaded: false,
  };

  // ====================== 通用小工具 ======================
  function mountShell() {
    container.innerHTML = `
      <div class="cg-tabs" id="cg-tabs">
        ${TABS.map(([k, label]) =>
          `<div class="cg-tab ${k === tab ? 'on' : ''}" data-tab="${k}">${label}</div>`).join('')}
      </div>
      <div class="cg-body" id="cg-body"></div>`;
    container.querySelectorAll('.cg-tab').forEach((el) => {
      el.addEventListener('click', () => {
        tab = el.dataset.tab;
        emoStyleScopeChar = null;   // 手动点 tab = 编辑全局样式；独立样式只能从「情感与表现」进
        localStorage.setItem('cg_tab', tab);
        container.querySelectorAll('.cg-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
        render();
      });
    });
  }

  async function loadAll(force) {
    if (S.loaded && !force) return;
    const [cards, classes, emotions, dialogues, triggers, loadouts, chars, settings,
      sets, deckReport] = await Promise.all([
      Admin.get('/cardgame/cards'),
      Admin.get('/cardgame/classes'),
      Admin.get('/cardgame/emotions'),
      Admin.get('/cardgame/dialogues'),
      Admin.get('/cardgame/triggers'),
      Admin.get('/cardgame/loadouts'),
      Admin.get('/cardgame/characters'),
      Admin.get('/cardgame/settings'),
      Admin.get('/cardgame/art/sets'),
      Admin.get('/cardgame/deck/report'),
    ]);
    Object.assign(S, {
      cards, classes, emotions, dialogues, triggers, loadouts, chars, settings,
      sets: sets.items || [], setActive: sets.active || 'default', deckReport, loaded: true,
    });
  }

  // 通用表单构建：fields = [{k,label,type,options,hint,span}]
  function formHtml(groups, item) {
    return groups.map((g) => `
      <div class="cg-form-group">
        <div class="cg-form-title">${esc(g.title)}</div>
        <div class="cg-form-grid">
          ${g.fields.map((f) => {
            const v = item && item[f.k] !== undefined ? item[f.k] : (f.def !== undefined ? f.def : '');
            const style = f.span ? `style="grid-column:1/-1"` : '';
            let ctrl = '';
            if (f.type === 'select') {
              const opts = typeof f.options === 'function' ? f.options() : f.options;
              ctrl = `<select class="cg-in" data-k="${f.k}">
                ${opts.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}
              </select>`;
            } else if (f.type === 'textarea' || f.type === 'json') {
              const val = f.type === 'json' ? JSON.stringify(v || [], null, 2) : (v || '');
              ctrl = `<textarea class="cg-in cg-ta" data-k="${f.k}" rows="${f.rows || 3}">${esc(val)}</textarea>`;
            } else if (f.type === 'bool') {
              ctrl = `<label class="cg-check"><input type="checkbox" data-k="${f.k}" ${Number(v) === 1 || v === true ? 'checked' : ''}> 启用</label>`;
            } else if (f.type === 'number') {
              ctrl = `<input class="cg-in" type="number" data-k="${f.k}" value="${esc(v)}">`;
            } else if (f.type === 'color') {
              ctrl = `<div class="cg-color"><input type="color" data-k="${f.k}" value="${esc(v || '#d4af37')}">
                <input class="cg-in" type="text" data-k2="${f.k}" value="${esc(v || '')}"></div>`;
            } else {
              ctrl = `<input class="cg-in" type="text" data-k="${f.k}" value="${esc(v)}" ${f.readonly ? 'readonly' : ''}>`;
            }
            return `<div class="cg-field" ${style}>
              <label>${esc(f.label)}${f.hint ? `<i title="${esc(f.hint)}">?</i>` : ''}</label>
              ${ctrl}
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');
  }

  function readForm(groups) {
    const out = {};
    const body = Admin.getModalBody();
    if (!body) return out;
    groups.forEach((g) => g.fields.forEach((f) => {
      const n = body.querySelector(`[data-k="${f.k}"]`);
      if (!n) return;
      if (f.type === 'bool') out[f.k] = n.checked ? 1 : 0;
      else if (f.type === 'number') out[f.k] = Number(n.value || 0);
      else if (f.type === 'json') {
        try { out[f.k] = JSON.parse(n.value || '[]'); } catch (_) { out[f.k] = n.value; }
      } else if (f.type === 'color') {
        const t = body.querySelector(`[data-k2="${f.k}"]`);
        out[f.k] = (t && t.value.trim()) || n.value;
      } else out[f.k] = n.value;
    }));
    return out;
  }

  function classOptions(includeUniversal) {
    const list = S.classes.map((c) => [c.code, c.name]);
    return includeUniversal ? [['universal', '通用（六职业共用）']].concat(list) : list;
  }

  // ====================== 渲染分发 ======================
  async function render() {
    const body = $('cg-body');
    if (!body) return;
    body.innerHTML = '<div class="cg-loading">加载中…</div>';
    try {
      await loadAll();
    } catch (e) {
      body.innerHTML = `<div class="table-empty">加载失败：${esc(e.message)}</div>`;
      return;
    }
    if (tab === 'deck') return renderDeck(body);
    if (tab === 'art') return renderArt(body);
    if (tab === 'sets') return renderSets(body);
    if (tab === 'classes') return renderClasses(body);
    if (tab === 'demo') return renderDemo(body);
    if (tab === 'emotions') return renderEmotions(body);
    if (tab === 'emoprof') return renderEmotionProfiles(body);
    if (tab === 'emostyle') return renderEmoStyle(body);
    if (tab === 'dialogues') return renderDialogues(body);
    if (tab === 'loadouts') return renderLoadouts(body);
    if (tab === 'settings') return renderSettings(body);
    if (tab === 'rules') return renderRules(body);
  }

  // ====================== 1. 卡牌库 ======================
  // 按套装筛选时，先把这个套装已出过图的卡牌 code 拉下来缓存。
  async function ensureSetCodes(code) {
    if (!code || code === 'all') return null;
    if (S.setCodes[code]) return S.setCodes[code];
    try {
      const rows = await Admin.get('/cardgame/art/list?set_code=' + encodeURIComponent(code));
      S.setCodes[code] = new Set((rows || []).map((r) => r.card_code));
    } catch (_) {
      S.setCodes[code] = new Set();
    }
    return S.setCodes[code];
  }

  function inSet(c) {
    const code = S.filter.set_code || 'all';
    if (code === 'all') return true;
    const set = S.setCodes[code];
    return !set || set.has(c.code);
  }

  function filteredCards() {
    const f = S.filter;
    const q = f.q.trim().toLowerCase();
    return S.cards.filter((c) => {
      if (f.class_code !== 'all' && c.class_code !== f.class_code) return false;
      if (f.category !== 'all' && c.category !== f.category) return false;
      if (!inSet(c)) return false;
      if (q && !(c.name + c.code + (c.desc || '')).toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderDeck(body) {
    const list = filteredCards();
    const withArt = S.cards.filter((c) => c.image_url).length;
    body.innerHTML = `
      <div class="cg-bar">
        <span class="cg-stat">共 <b>${S.cards.length}</b> 张 · 已出卡面 <b>${withArt}</b> 张</span>
        <select class="cg-in cg-sel" id="cg-f-class">
          <option value="all">全部职业</option>
          ${classOptions(true).map(([v, l]) =>
            `<option value="${v}" ${S.filter.class_code === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <select class="cg-in cg-sel" id="cg-f-cat">
          <option value="all">全部分类</option>
          ${CATEGORY.map(([v, l]) =>
            `<option value="${v}" ${S.filter.category === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <select class="cg-in cg-sel" id="cg-f-set">
          <option value="all">全部套装</option>
          ${(S.sets || []).map((s) =>
            `<option value="${esc(s.code)}" ${S.filter.set_code === s.code ? 'selected' : ''}>${esc(s.name || s.code)}</option>`).join('')}
        </select>
        <input class="cg-in cg-search" id="cg-f-q" placeholder="搜卡名 / 代码 / 描述" value="${esc(S.filter.q)}">
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="cg-add-card">+ 新建卡牌</button>
      </div>
      <div class="cg-cards">
        ${list.length ? list.map(cardTile).join('') : '<div class="table-empty">没有匹配的卡牌</div>'}
      </div>`;

    $('cg-f-class').addEventListener('change', (e) => { S.filter.class_code = e.target.value; renderDeck(body); });
    $('cg-f-cat').addEventListener('change', (e) => { S.filter.category = e.target.value; renderDeck(body); });
    $('cg-f-set').addEventListener('change', async (e) => {
      S.filter.set_code = e.target.value;
      await ensureSetCodes(S.filter.set_code);
      renderDeck(body);
    });
    let t = null;
    $('cg-f-q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { S.filter.q = e.target.value; renderDeck(body); }, 220);
    });
    $('cg-add-card').addEventListener('click', () => openCardEditor(null));
    body.querySelectorAll('[data-edit]').forEach((el) =>
      el.addEventListener('click', () => openCardEditor(S.cards.find((c) => c.code === el.dataset.edit))));
    body.querySelectorAll('[data-gen]').forEach((el) =>
      el.addEventListener('click', () => openArtDialog(S.cards.find((c) => c.code === el.dataset.gen))));
  }

  function cardTile(c) {
    const color = CAT_COLOR[c.category] || '#8a8478';
    const classLabel = c.class_label || c.class_code || '';
    const catLabel = c.category_label
      || (CATEGORY.find(([v]) => v === c.category) || [, c.category])[1] || '';
    // 右上类别标：职业 + 分类拼起来（和前台「通用功能」一致）
    const badge = (classLabel + catLabel).replace(/\s+/g, '');
    // 费用角标 / 类别标 / 名称都压在插画上（和前台一致），因此嵌套进 art 容器，
    // 让它们以图片为定位基准：名称 = 图片左下、费用 = 图片左上、类别 = 图片右上。
    const overlays = `
        <div class="cg-ctx-cost">${c.cost}</div>
        ${badge ? `<div class="cg-ctx-tag">${esc(badge)}</div>` : ''}
        <div class="cg-ctx-name">${esc(c.name)}</div>`;
    const art = c.image_url
      ? `<div class="cg-ctx-art" style="background-image:url('${esc(c.image_url)}')">${overlays}</div>`
      : `<div class="cg-ctx-art cg-ct-empty"><span>${c.art_status === 'running' ? '生成中…' : '待生成'}</span>${overlays}</div>`;
    // 描述里把数值高亮成金色（和前台一致：伤害数字金色），不参与 HTML 转义外的注入
    const desc = highlightCardValue(esc(c.desc || ''), c.value);
    return `
      <div class="cg-card" style="--cc:${color}">
        ${art}
        <div class="cg-ctx-info"><div class="cg-ctx-desc">${desc}</div></div>
        <div class="cg-ctx-foot">
          <span class="cg-ctx-cls">${esc(classLabel || '—')}</span>
          <span class="cg-ctx-val">${c.value ? c.value : '—'}</span>
        </div>
        <div class="cg-ct-acts">
          <button class="btn btn-outline btn-sm" data-edit="${c.code}">编辑</button>
          <button class="btn btn-outline btn-sm" data-gen="${c.code}">生图</button>
        </div>
      </div>`;
  }

  // 把描述文本里出现的数值（value）高亮成金色，匹配前台卡面效果。
  // 只高亮不被其他数字夹着的独立整数，避免误伤其它数字。
  function highlightCardValue(text, value) {
    if (!value) return text;
    const v = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('([^0-9]|^)' + v + '(?![0-9])', 'g'),
      (m, pre) => pre + '<span class="cg-gold">' + value + '</span>');
  }

  function openCardEditor(card) {
    const isNew = !card;
    const groups = [
      {
        title: '基础',
        fields: [
          { k: 'code', label: '卡牌代码（唯一）', type: 'text', readonly: !isNew, hint: '引擎与牌组用，建好后不建议改' },
          { k: 'name', label: '卡牌名', type: 'text' },
          { k: 'class_code', label: '所属职业', type: 'select', options: () => classOptions(true) },
          { k: 'category', label: '分类', type: 'select', options: CATEGORY },
          { k: 'category_label', label: '分类显示名', type: 'text' },
          { k: 'class_label', label: '职业显示名', type: 'text' },
          { k: 'cost', label: '法力消耗', type: 'number', def: 1 },
          { k: 'max_copies', label: '牌组中最多张数', type: 'number', def: 2 },
          { k: 'sort', label: '排序', type: 'number', def: 999 },
          { k: 'enabled', label: '启用', type: 'bool', def: 1 },
        ],
      },
      {
        title: '引擎数值（决定实战效果）',
        fields: [
          { k: 'script', label: '引擎分支', type: 'select', options: [
            ['', '纯伤害（按 value / hits 结算）'],
            ['buff_def', '加 DEF'], ['buff_def_draw', '加 DEF + 抽牌'],
            ['def_heal', '加 DEF + 回血'], ['heal', '回血'], ['heal_def', '回血 + 加 DEF'],
            ['draw2', '抽牌'], ['clear_guards', '清空守卫'], ['pierce_hero', '无视守卫打英雄'],
            ['attack_heal_if_def', '伤害 + 条件回血'], ['cleanse', '清除负面'],
            ['mana_penalty', '削对手法力'], ['def_down', '降对手 DEF'],
            ['spd_down', '降对手 SPD'], ['steal_copy', '复制对手手牌'],
            ['mind_take', '夺取对手手牌'], ['dodge', '闪避'],
          ], hint: '卡牌行为由引擎分支决定，其余数值是它的参数' },
          { k: 'value', label: '伤害值', type: 'number', def: 0 },
          { k: 'hits', label: '段数', type: 'number', def: 1 },
          { k: 'extra_def', label: '加 DEF', type: 'number', def: 0 },
          { k: 'heal_val', label: '回血', type: 'number', def: 0 },
          { k: 'draw_count', label: '抽牌数', type: 'number', def: 0 },
          { k: 'bonus_crit', label: '暴击率加成 %', type: 'number', def: 0 },
          { k: 'crit_bonus_flat', label: '暴击额外伤害', type: 'number', def: 0 },
          { k: 'atk_debuff', label: '降对手攻击', type: 'number', def: 0 },
          { k: 'half_def_pierce', label: '无视一半 DEF', type: 'bool', def: 0 },
          { k: 'needs_target', label: '需要指定目标', type: 'bool', def: 0 },
        ],
      },
      {
        title: '文案与卡面',
        fields: [
          { k: 'desc', label: '卡面描述', type: 'textarea', rows: 2, span: true },
          { k: 'rules_detail', label: '规则细节（JSON 数组）', type: 'json', rows: 3, span: true },
          { k: 'lore', label: '背景故事', type: 'textarea', rows: 2, span: true },
          { k: 'quote', label: '台词', type: 'textarea', rows: 2, span: true },
          { k: 'art_action', label: '卡面动作', type: 'textarea', rows: 2, span: true, hint: '会拼进提示词' },
          { k: 'art_expression', label: '卡面表情', type: 'text', span: true },
          { k: 'art_extra', label: '额外提示词', type: 'text', span: true },
          { k: 'image_url', label: '卡面图片地址', type: 'text', span: true },
        ],
      },
    ];
    Admin.showModal(isNew ? '新建卡牌' : `编辑卡牌 · ${card.name}`,
      formHtml(groups, card || { class_code: 'universal', category: 'skill', enabled: 1 }),
      async () => {
        const data = readForm(groups);
        try {
          if (isNew) await Admin.post('/cardgame/cards', data);
          else await Admin.put('/cardgame/cards/' + card.code, data);
          Admin.closeModal();
          Admin.toast(isNew ? '卡牌已创建' : '已保存', 'success');
          await loadAll(true);
          render();
        } catch (e) {
          Admin.toast('保存失败：' + e.message, 'error');
        }
      }, { size: 'large' });
  }

  // ====================== 2. 卡面生产 ======================
  function renderArt(body) {
    const f = S.artFilter;
    const list = S.cards.filter((c) => {
      if (f.class_code !== 'all' && c.class_code !== f.class_code) return false;
      if (f.only === 'todo' && c.image_url) return false;
      if (f.only === 'done' && !c.image_url) return false;
      if (f.set_code && f.set_code !== 'all') {
        const set = S.setCodes[f.set_code];
        if (!set || !set.has(c.code)) return false;
      }
      return true;
    });
    const done = S.cards.filter((c) => c.image_url).length;
    body.innerHTML = `
      <div class="cg-bar">
        <span class="cg-stat">已出卡面 <b>${done}</b> / ${S.cards.length}</span>
        <select class="cg-in cg-sel" id="cg-a-class">
          <option value="all">全部职业</option>
          ${classOptions(true).map(([v, l]) =>
            `<option value="${v}" ${f.class_code === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <select class="cg-in cg-sel" id="cg-a-only">
          <option value="todo" ${f.only === 'todo' ? 'selected' : ''}>只看未生成</option>
          <option value="done" ${f.only === 'done' ? 'selected' : ''}>只看已生成</option>
          <option value="all" ${f.only === 'all' ? 'selected' : ''}>全部</option>
        </select>
        <select class="cg-in cg-sel" id="cg-a-set">
          <option value="all">全部套装</option>
          ${(S.sets || []).map((s) =>
            `<option value="${esc(s.code)}" ${f.set_code === s.code ? 'selected' : ''}>${esc(s.name || s.code)}</option>`).join('')}
        </select>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" id="cg-a-apply">套用最新</button>
        <button class="btn btn-primary btn-sm" id="cg-a-batch">批量生成所选</button>
      </div>
      <div class="cg-hintbar">
        拼装链路：<b>这张卡</b>（动作 + 表情 + 附加）→ <b>职业</b>（画风 + 男女衣着）→ <b>角色</b>（发型/发色/瞳色/肤色）
        → 尺寸与模型预设 → ComfyUI。工具条「提示词与设置」里可改模板。
      </div>
      <div class="cg-arts">
        ${list.length ? list.map(artRow).join('') : '<div class="table-empty">没有匹配的卡牌</div>'}
      </div>`;

    $('cg-a-class').addEventListener('change', (e) => { f.class_code = e.target.value; renderArt(body); });
    $('cg-a-only').addEventListener('change', (e) => { f.only = e.target.value; renderArt(body); });
    $('cg-a-set').addEventListener('change', async (e) => {
      f.set_code = e.target.value;
      await ensureSetCodes(f.set_code);
      renderArt(body);
    });
    body.querySelectorAll('[data-preview]').forEach((el) =>
      el.addEventListener('click', () => openArtDialog(S.cards.find((c) => c.code === el.dataset.preview))));
    body.querySelectorAll('[data-history]').forEach((el) =>
      el.addEventListener('click', () => openArtHistory(el.dataset.history)));
    $('cg-a-apply').addEventListener('click', applyLatestArt);
    $('cg-a-batch').addEventListener('click', () => batchGenerate(list));
  }

  function artRow(c) {
    const thumb = c.image_url
      ? `<div class="cg-ar-thumb" style="background-image:url('${esc(c.image_url)}')"></div>`
      : `<div class="cg-ar-thumb cg-ct-empty"><span>${c.art_status === 'running' ? '生成中' : '—'}</span></div>`;
    const status = c.image_url
      ? '<span class="cg-pill ok">已套用</span>'
      : (c.art_status === 'running' ? '<span class="cg-pill run">生成中</span>'
        : (c.art_status === 'failed' ? '<span class="cg-pill bad">失败</span>' : '<span class="cg-pill">待生成</span>'));
    return `
      <div class="cg-ar" data-code="${c.code}">
        <label class="cg-ar-check"><input type="checkbox" data-pick="${c.code}"></label>
        ${thumb}
        <div class="cg-ar-main">
          <div class="cg-ar-name">${esc(c.name)} <small>${esc(c.cost)} 费 · ${esc(c.class_label || c.class_code)}</small></div>
          <div class="cg-ar-prompt">动作：${esc(c.art_action || '（未填）')}<br>表情：${esc(c.art_expression || '（未填）')}</div>
        </div>
        <div class="cg-ar-status">${status}</div>
        <div class="cg-ar-acts">
          <button class="btn btn-outline btn-sm" data-preview="${c.code}">提示词 / 生成</button>
          <button class="btn btn-outline btn-sm" data-history="${c.code}">历史</button>
        </div>
      </div>`;
  }

  async function batchGenerate(list) {
    const picked = [...document.querySelectorAll('[data-pick]:checked')].map((n) => n.dataset.pick);
    const targets = picked.length ? list.filter((c) => picked.includes(c.code)) : list;
    if (!targets.length) { Admin.toast('没有要生成的目标', 'error'); return; }
    if (!confirm(`将一次性提交 ${targets.length} 张卡面到 ComfyUI 队列，继续？`)) return;
    // 以前是「提交一张 → 等它出完 → 再提交下一张」，任务面板永远只有 1 个任务。
    // 现在一次性全部建任务，后端串行排队；面板能看到真实的 N 个任务。
    let submitted = 0, failed = 0;
    try {
      const res = await Admin.post('/cardgame/art/generate-batch', {
        card_codes: targets.map((c) => c.code),
        class_code: S.art.class_code || '',
        gender: S.art.gender,
        character_id: S.art.character_id || null,
      });
      submitted = res.submitted || 0;
      failed = (res.total || 0) - submitted;
      (res.items || []).filter((it) => !it.ok).forEach((it) => {
        const c = targets.find((x) => x.code === it.card_code);
        Admin.toast(`${(c && c.name) || it.card_code} 提交失败：${it.error}`, 'error');
      });
      Admin.toast(`已提交 ${submitted} 张${failed ? `，失败 ${failed} 张` : ''}，可在右上角任务面板查看进度`,
        submitted ? 'success' : 'error');
    } catch (e) {
      Admin.toast('批量提交失败：' + e.message, 'error');
      return;
    }
    await loadAll(true);
    render();
    // 统一轮询：全部出完再刷新一次列表
    pollBatch(targets.map((c) => c.code));
  }

  /** 批量任务的统一轮询：只读 art/list，不阻塞提交。 */
  function pollBatch(codes) {
    const pending = new Set(codes);
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks++;
      if (ticks > 240 || !pending.size) {
        clearInterval(timer);
        await loadAll(true);
        render();
        return;
      }
      let arts = [];
      try { arts = await Admin.get('/cardgame/art/list'); } catch (_) { return; }
      const byCode = {};
      arts.forEach((a) => { if (a.image_url && !byCode[a.card_code]) byCode[a.card_code] = a; });
      pending.forEach((code) => {
        if (byCode[code]) {
          pending.delete(code);
          const row = document.querySelector(`.cg-ar[data-code="${code}"] .cg-ar-status`);
          if (row) row.innerHTML = '<span class="cg-pill ok">已出图</span>';
        }
      });
    }, 4000);
  }

  function pollArtJob(code, onDone) {
    return new Promise((resolve) => {
      const row = document.querySelector(`.cg-ar[data-code="${code}"] .cg-ar-status`);
      if (row) row.innerHTML = '<span class="cg-pill run">生成中</span>';
      let ticks = 0;
      const timer = setInterval(async () => {
        ticks++;
        if (ticks > 180) { clearInterval(timer); resolve(false); return; }
        let arts = [];
        try { arts = await Admin.get('/cardgame/art/list?card_code=' + encodeURIComponent(code)); } catch (_) { }
        const a = arts[0];
        if (a && a.image_url) {
          clearInterval(timer);
          if (row) row.innerHTML = '<span class="cg-pill ok">已出图</span>';
          if (onDone) onDone(a);
          resolve(true);
        }
      }, 2500);
    });
  }

  async function openArtDialog(card) {
    if (!card) return;
    const q = (extra) => {
      const p = new URLSearchParams({ card_code: card.code, gender: S.art.gender });
      if (S.art.class_code) p.set('class_code', S.art.class_code);
      if (S.art.character_id) p.set('character_id', S.art.character_id);
      return '/cardgame/art/preview?' + p.toString() + (extra || '');
    };
    let pv;
    try { pv = await Admin.get(q()); } catch (e) { Admin.toast('提示词拼装失败：' + e.message, 'error'); return; }
    const body = `
      <div class="cg-form-group">
        <div class="cg-form-title">拼装参数</div>
        <div class="cg-form-grid">
          <div class="cg-field"><label>职业（决定画风与衣着）</label>
            <select class="cg-in" id="cg-pv-class">
              <option value="">按卡牌所属职业</option>
              ${classOptions(false).map(([v, l]) =>
                `<option value="${v}" ${S.art.class_code === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
            </select></div>
          <div class="cg-field"><label>性别 / 衣着</label>
            <select class="cg-in" id="cg-pv-gender">
              <option value="female" ${S.art.gender === 'female' ? 'selected' : ''}>女</option>
              <option value="male" ${S.art.gender === 'male' ? 'selected' : ''}>男</option>
              <option value="other" ${S.art.gender === 'other' ? 'selected' : ''}>其他</option>
            </select></div>
          <div class="cg-field"><label>关联角色（带脸带发型）</label>
            <select class="cg-in" id="cg-pv-char">
              <option value="">不关联（只按职业画风）</option>
              ${S.chars.map((c) =>
                `<option value="${c.id}" ${String(S.art.character_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}（${esc(c.character_type || '人物')}）</option>`).join('')}
            </select></div>
          <div class="cg-field"><label>尺寸 / 模型</label>
            <div class="cg-ro">${pv.width}×${pv.height} · ${esc(pv.model_preset || '默认方案')}</div></div>
        </div>
        <div class="cg-form-title" style="margin-top:14px">正面提示词（可直接改，改完就按这个跑）</div>
        <textarea class="cg-in cg-ta cg-prompt" id="cg-pv-pos" rows="6">${esc(pv.positive || '')}</textarea>
        <div class="cg-form-title" style="margin-top:10px">负向提示词</div>
        <textarea class="cg-in cg-ta" id="cg-pv-neg" rows="3">${esc(pv.negative || '')}</textarea>
        <div class="cg-parts">
          ${Object.entries(pv.parts || {}).map(([k, v]) =>
            `<span><i>${esc(k)}</i>${esc(v || '—')}</span>`).join('')}
        </div>
      </div>`;
    Admin.showModal(`卡面 · ${card.name}`, body, async () => {
      const pos = $('cg-pv-pos').value.trim();
      try {
        const r = await Admin.post('/cardgame/art/generate', {
          card_code: card.code,
          class_code: $('cg-pv-class').value,
          gender: $('cg-pv-gender').value,
          character_id: $('cg-pv-char').value || null,
          prompt: pos,
        });
        Admin.closeModal();
        Admin.toast('已提交出图任务', 'success');
        await pollArtJob(card.code);
        await loadAll(true);
        render();
      } catch (e) {
        Admin.toast('提交失败：' + e.message, 'error');
      }
    }, { size: 'large' });

    // 切换参数即时重拼
    setTimeout(() => {
      const sync = async () => {
        S.art.class_code = $('cg-pv-class').value;
        S.art.gender = $('cg-pv-gender').value;
        S.art.character_id = $('cg-pv-char').value;
        try {
          const np = await Admin.get(q());
          $('cg-pv-pos').value = np.positive || '';
          $('cg-pv-neg').value = np.negative || '';
        } catch (_) { }
      };
      ['cg-pv-class', 'cg-pv-gender', 'cg-pv-char'].forEach((id) =>
        $(id)?.addEventListener('change', sync));
    }, 60);
  }

  async function openArtHistory(code) {
    let arts = [];
    try { arts = await Admin.get('/cardgame/art/list?card_code=' + encodeURIComponent(code)); }
    catch (e) { Admin.toast('读取失败：' + e.message, 'error'); return; }
    const body = arts.length ? `
      <div class="cg-hist">
        ${arts.map((a) => `
          <div class="cg-hist-item">
            <div class="cg-hist-img" ${a.image_url ? `style="background-image:url('${esc(a.image_url)}')"` : ''}>
              ${a.image_url ? '' : '<span>无图</span>'}
            </div>
            <div class="cg-hist-info">
              <div>${esc(a.gender === 'male' ? '男' : a.gender === 'other' ? '其他' : '女')} · ${a.width}×${a.height} · ${esc(a.model_preset || '')}</div>
              <div class="cg-hist-prompt">${esc((a.prompt || '').slice(0, 120))}…</div>
              ${a.is_active ? '<span class="cg-pill ok">当前使用</span>' : ''}
            </div>
            <div class="cg-hist-acts">
              ${a.image_url && !a.is_active
                ? `<button class="btn btn-outline btn-sm" data-apply="${a.id}">套用</button>` : ''}
              <button class="btn btn-danger btn-sm" data-del="${a.id}">删</button>
            </div>
          </div>`).join('')}
      </div>` : '<div class="table-empty">这张卡还没有生成记录</div>';
    Admin.showModal(`卡面历史 · ${code}`, body, null, { size: 'large' });
    setTimeout(() => {
      document.querySelectorAll('[data-apply]').forEach((el) => el.addEventListener('click', async () => {
        try {
          await Admin.post('/cardgame/art/apply', { art_id: Number(el.dataset.apply) });
          Admin.toast('已套用', 'success');
          Admin.closeModal();
          await loadAll(true); render();
        } catch (e) { Admin.toast('套用失败：' + e.message, 'error'); }
      }));
      document.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
        if (!confirm('删除这条卡面记录？')) return;
        try {
          await Admin.del('/cardgame/art/' + el.dataset.del);
          Admin.closeModal();
          await loadAll(true); render();
        } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
      }));
    }, 60);
  }

  async function applyLatestArt() {
    const rows = [...document.querySelectorAll('[data-pick]:checked')].map((n) => n.dataset.pick);
    if (!rows.length) { Admin.toast('先在左侧勾选要套用的卡牌', 'error'); return; }
    let ok = 0;
    for (const code of rows) {
      try {
        const arts = await Admin.get('/cardgame/art/list?card_code=' + encodeURIComponent(code));
        const first = arts.find((a) => a.image_url);
        if (!first) continue;
        await Admin.post('/cardgame/art/apply', { art_id: first.id });
        ok++;
      } catch (_) { }
    }
    Admin.toast(`已套用 ${ok} 张`, ok ? 'success' : 'error');
    await loadAll(true); render();
  }

  // ====================== 3. 职业 ======================
  function renderClasses(body) {
    body.innerHTML = `
      <div class="cg-bar">
        <span class="cg-stat">共 <b>${S.classes.length}</b> 个职业</span>
        <span class="cg-stat" style="color:var(--text-muted)">
          这里就是「卡牌外观拼装 → 卡牌角色」下拉里的<b>职业</b>：改名 / 改画风 / 增删都在这一页
        </span>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="cg-cls-add">+ 新建职业</button>
      </div>
      <div class="cg-grid2">
        ${S.classes.map((c) => `
          <div class="cg-panel">
            <div class="cg-panel-head">
              <b>${esc(c.icon || '')} ${esc(c.name)}</b>
              <div style="flex:1"></div>
              <button class="btn btn-outline btn-sm" data-cls="${c.code}">编辑</button>
              <button class="btn btn-outline btn-sm" data-clsdel="${c.code}" style="color:var(--red);border-color:rgba(200,80,80,.5)">删除</button>
            </div>
            <div class="cg-kv">
              <span>HP <b>${c.hp}</b></span><span>DEF <b>${c.defense}</b></span>
              <span>SPD <b>${c.spd}</b></span><span>CRI <b>${c.cri}%</b></span>
              <span>牌组 <b>${c.deck_size}</b> 张</span>
            </div>
            <div class="cg-p">${esc(c.role || '')}</div>
            <div class="cg-p cg-dim">克制：${esc(c.counters || '—')}<br>天敌：${esc(c.nemesis || '—')}</div>
            <div class="cg-p cg-dim">画风：${esc((c.art_style || '').slice(0, 60))}…</div>
          </div>`).join('')}
      </div>`;
    body.querySelectorAll('[data-cls]').forEach((el) =>
      el.addEventListener('click', () => openClassEditor(S.classes.find((c) => c.code === el.dataset.cls), false)));
    body.querySelectorAll('[data-clsdel]').forEach((el) =>
      el.addEventListener('click', () => deleteClass(S.classes.find((c) => c.code === el.dataset.clsdel))));
    const addBtn = $('cg-cls-add');
    if (addBtn) addBtn.addEventListener('click', () => openClassEditor(null, true));
  }

  async function deleteClass(cls) {
    if (!cls) return;
    const ok = await Admin.confirm(
      `删除职业「${cls.name}」？\n\n` +
      '这个职业下如果还有卡牌，会先拦住不让删（先去卡牌库把那些卡转走或删掉）。\n' +
      '已经配过这个角色的外观、卡组、情感台词不会被自动清理。');
    if (!ok) return;
    try {
      await Admin.del('/cardgame/classes/' + encodeURIComponent(cls.code));
      Admin.toast('已删除「' + cls.name + '」', 'success');
      await loadAll(true);
      render();
    } catch (e) {
      Admin.toast('删除失败：' + e.message, 'error');
    }
  }

  function openClassEditor(cls, isNew) {
    const base = cls || {
      code: '', name: '', icon: '⚔', hp: 100, defense: 0, spd: 10,
      cri: 10, sort: (S.classes.length + 1) * 10, enabled: 1,
      role: '', counters: '', nemesis: '',
      art_style: '', outfit_male: '', outfit_female: '', outfit_other: '',
    };
    const groups = [{
      title: isNew ? '新建职业' : `${base.name} · 面板与画风`,
      fields: [
        { k: 'code', label: '职业代码（英文，唯一，建好不能改）', type: 'text', readonly: !isNew },
        { k: 'name', label: '职业名', type: 'text' },
        { k: 'icon', label: '图标字符', type: 'text' },
        { k: 'hp', label: 'HP', type: 'number' },
        { k: 'defense', label: 'DEF', type: 'number' },
        { k: 'spd', label: 'SPD', type: 'number' },
        { k: 'cri', label: '暴击率 %', type: 'number' },
        { k: 'sort', label: '排序', type: 'number' },
        { k: 'enabled', label: '启用', type: 'bool' },
        { k: 'role', label: '定位', type: 'textarea', rows: 2, span: true },
        { k: 'counters', label: '擅长克制', type: 'textarea', rows: 2, span: true },
        { k: 'nemesis', label: '主要天敌', type: 'textarea', rows: 2, span: true },
      ],
    }, {
      title: '卡面拼装（会拼进每张专属卡与通用卡的提示词）',
      fields: [
        { k: 'art_style', label: '职业画风', type: 'textarea', rows: 3, span: true },
        { k: 'outfit_male', label: '男性衣着', type: 'textarea', rows: 2, span: true },
        { k: 'outfit_female', label: '女性衣着', type: 'textarea', rows: 2, span: true },
        { k: 'outfit_other', label: '其他衣着', type: 'textarea', rows: 2, span: true },
      ],
    }];
    Admin.showModal(`职业 · ${isNew ? '新建' : base.name}`, formHtml(groups, base), async () => {
      try {
        const data = readForm(groups);
        if (isNew) {
          if (!String(data.code || '').trim()) { Admin.toast('先填职业代码', 'error'); return; }
          await Admin.post('/cardgame/classes', data);
          Admin.toast('已新建「' + (data.name || data.code) + '」', 'success');
        } else {
          await Admin.put('/cardgame/classes/' + base.code, data);
          Admin.toast('已保存', 'success');
        }
        Admin.closeModal();
        await loadAll(true);
        render();
      } catch (e) { Admin.toast((isNew ? '新建' : '保存') + '失败：' + e.message, 'error'); }
    }, { size: 'large' });
  }

  // ====================== 4. 战斗情感 ======================
  function renderEmotions(body) {
    body.innerHTML = `
      <div class="cg-bar">
        <span class="cg-stat">共 <b>${S.emotions.length}</b> 条情感，战斗中点「表情」可主动触发</span>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="cg-add-emo">+ 新建情感</button>
      </div>
      <table class="cg-table">
        <thead><tr>
          <th style="width:54px">图标</th><th style="width:120px">名称</th><th style="width:110px">标签</th>
          <th>己方台词</th><th>敌方台词</th><th style="width:150px">回应情感</th>
          <th style="width:60px">启用</th><th style="width:110px">操作</th>
        </tr></thead>
        <tbody>
          ${S.emotions.map((e) => `
            <tr>
              <td style="font-size:16px">${esc(e.emoji || '')}</td>
              <td><b style="color:${esc(e.color || '#d4af37')}">${esc(e.name)}</b><br><small>${esc(e.code)}</small></td>
              <td>${esc(e.tag || '')}</td>
              <td class="cg-td-text">${esc(e.player_line || '')}</td>
              <td class="cg-td-text">${esc(e.ai_line || '')}</td>
              <td><small>${esc((e.reply_codes || []).join(' / ') || '—')}</small></td>
              <td>${e.enabled ? '✅' : '—'}</td>
              <td><button class="btn btn-outline btn-sm" data-emo="${e.code}">编辑</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    body.querySelectorAll('[data-emo]').forEach((el) =>
      el.addEventListener('click', () => openEmotionEditor(S.emotions.find((e) => e.code === el.dataset.emo))));
    $('cg-add-emo').addEventListener('click', () => openEmotionEditor(null));
  }

  function openEmotionEditor(emo) {
    const isNew = !emo;
    const groups = [{
      title: '情感',
      fields: [
        { k: 'code', label: '代码', type: 'text', readonly: !isNew },
        { k: 'name', label: '名称', type: 'text' },
        { k: 'tag', label: '标签', type: 'text' },
        { k: 'emoji', label: 'emoji', type: 'text' },
        { k: 'color', label: '主色', type: 'text' },
        { k: 'accent', label: '文字色', type: 'text' },
        { k: 'sort', label: '排序', type: 'number' },
        { k: 'enabled', label: '启用', type: 'bool' },
        { k: 'player_line', label: '己方触发台词', type: 'textarea', rows: 2, span: true },
        { k: 'ai_line', label: '敌方触发台词', type: 'textarea', rows: 2, span: true },
        { k: 'reply_codes', label: '回应情感（JSON 数组，写情感 code）', type: 'json', rows: 3, span: true },
      ],
    }];
    Admin.showModal(isNew ? '新建情感' : `情感 · ${emo.name}`,
      formHtml(groups, emo || { enabled: 1, color: '#d4af37', accent: '#fff' }),
      async () => {
        const data = readForm(groups);
        try {
          if (isNew) await Admin.post('/cardgame/emotions', data);
          else await Admin.put('/cardgame/emotions/' + emo.code, data);
          Admin.closeModal();
          Admin.toast('已保存', 'success');
          await loadAll(true); render();
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      });
  }

  // ====================== 5. 战斗对话 ======================
  function renderDialogues(body) {
    const byTrigger = {};
    S.dialogues.forEach((d) => { (byTrigger[d.trigger] = byTrigger[d.trigger] || []).push(d); });
    const tmap = {};
    S.triggers.forEach((t) => { tmap[t.key] = t; });
    body.innerHTML = `
      <div class="cg-bar">
        <span class="cg-stat">共 <b>${S.dialogues.length}</b> 条规则 · 战斗中的对话由这些规则按权重抽</span>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="cg-add-dlg">+ 新建规则</button>
      </div>
      <div class="cg-hintbar">
        抽台词顺序：<b>触发点 + 阵营</b> 过滤 → 冷却 / 每局一次 → 按权重随机 → 有台词用台词，没有就用该情感的默认台词。
        台词里可写 <code>{name}</code> <code>{enemy}</code> <code>{round}</code> <code>{dmg}</code> <code>{hp}</code> 占位符。
      </div>
      ${Object.keys(byTrigger).map((tr) => `
        <div class="cg-block">
          <div class="cg-block-head">
            <b>${esc(tmap[tr] ? tmap[tr].label : tr)}</b>
            <code>${esc(tr)}</code>
            <span>${esc(tmap[tr] ? tmap[tr].desc : '')}</span>
          </div>
          <table class="cg-table">
            <thead><tr>
              <th style="width:70px">阵营</th><th style="width:130px">情感</th><th>台词</th>
              <th style="width:60px">权重</th><th style="width:80px">冷却</th>
              <th style="width:80px">每局一次</th><th style="width:70px">启用</th><th style="width:80px">操作</th>
            </tr></thead>
            <tbody>
              ${byTrigger[tr].map((d) => `
                <tr>
                  <td>${d.side === 'self' || d.side === 0 ? '己方' : '敌方'}</td>
                  <td><small>${esc(d.emotion_code || '—')}</small></td>
                  <td class="cg-td-text">${esc(d.text || '（用情感默认台词）')}</td>
                  <td>${d.weight}</td>
                  <td>${d.cooldown_rounds || 0}</td>
                  <td>${d.once_per_battle ? '✅' : '—'}</td>
                  <td>${d.enabled ? '✅' : '—'}</td>
                  <td><button class="btn btn-outline btn-sm" data-dlg="${d.id}">编辑</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('')}`;
    body.querySelectorAll('[data-dlg]').forEach((el) =>
      el.addEventListener('click', () =>
        openDialogueEditor(S.dialogues.find((d) => String(d.id) === el.dataset.dlg))));
    $('cg-add-dlg').addEventListener('click', () => openDialogueEditor(null));
  }

  function openDialogueEditor(d) {
    const isNew = !d;
    const groups = [{
      title: '触发规则',
      fields: [
        { k: 'trigger', label: '触发点', type: 'select', options: () => S.triggers.map((t) => [t.key, `${t.label}（${t.key}）`]) },
        { k: 'side', label: '阵营', type: 'select', options: [['self', '己方'], ['enemy', '敌方']] },
        { k: 'emotion_code', label: '情感', type: 'select', options: () => [['', '（不指定）']].concat(S.emotions.map((e) => [e.code, e.name])) },
        { k: 'weight', label: '权重', type: 'number', def: 10 },
        { k: 'cooldown_rounds', label: '冷却回合', type: 'number', def: 0 },
        { k: 'priority', label: '优先级', type: 'number', def: 0 },
        { k: 'once_per_battle', label: '每局只一次', type: 'bool', def: 0 },
        { k: 'enabled', label: '启用', type: 'bool', def: 1 },
        { k: 'text', label: '台词（留空则用情感默认台词）', type: 'textarea', rows: 2, span: true },
        { k: 'note', label: '备注', type: 'text', span: true },
      ],
    }];
    Admin.showModal(isNew ? '新建对话规则' : '编辑对话规则',
      formHtml(groups, d || { weight: 10, enabled: 1 }),
      async () => {
        const data = readForm(groups);
        if (data.side === 'self') data.side = 0;
        if (data.side === 'enemy') data.side = 1;
        try {
          if (isNew) await Admin.post('/cardgame/dialogues', data);
          else await Admin.put('/cardgame/dialogues/' + d.id, data);
          Admin.closeModal();
          Admin.toast('已保存', 'success');
          await loadAll(true); render();
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      });
  }

  // ====================== 6. 角色卡组 ======================
  function renderLoadouts(body) {
    body.innerHTML = `
      <div class="cg-bar">
        <span class="cg-stat">人物来自「人物管理」· 配好职业与牌组就能在剧情里开打</span>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" id="cg-auto-load">给没配卡的人物自动分配</button>
      </div>
      <div class="cg-loads">
        ${S.chars.map((c) => `
          <div class="cg-load" data-cid="${c.id}">
            <div class="cg-load-pf" ${c.portrait ? `style="background-image:url('${esc(c.portrait)}')"` : ''}>
              ${c.portrait ? '' : '<span>无立绘</span>'}
            </div>
            <div class="cg-load-main">
              <div class="cg-load-name">${esc(c.name)}
                <small>${esc(c.character_type || '')} · ${esc(c.gender || '')} · Lv${c.level || 1}</small></div>
              <div class="cg-load-cls">
                ${c.has_loadout
                  ? `<span class="cg-pill ok">${esc(c.class_code)}</span> <span>${c.deck_size} 张</span>`
                  : '<span class="cg-pill bad">未配卡组</span>'}
              </div>
            </div>
            <button class="btn btn-outline btn-sm" data-load="${c.id}">${c.has_loadout ? '改卡组' : '配卡组'}</button>
          </div>`).join('')}
      </div>`;
    body.querySelectorAll('[data-load]').forEach((el) =>
      el.addEventListener('click', () => openLoadoutEditor(S.chars.find((c) => String(c.id) === el.dataset.load))));
    $('cg-auto-load').addEventListener('click', async () => {
      try {
        const r = await Admin.post('/cardgame/loadouts/auto', {});
        Admin.toast(`已自动分配 ${r.created} 个人物`, 'success');
        await loadAll(true); render();
      } catch (e) { Admin.toast('失败：' + e.message, 'error'); }
    });
  }

  async function openLoadoutEditor(ch) {
    if (!ch) return;
    let clsCode = ch.class_code || S.classes[0].code;
    let deck = Object.assign({}, ch.deck || {});
    const target = 30;

    const draw = () => {
      const pool = S.cards.filter((c) => c.enabled
        && (c.class_code === 'universal' || c.class_code === clsCode));
      const total = Object.values(deck).reduce((a, b) => a + (Number(b) || 0), 0);
      return `
        <div class="cg-form-grid">
          <div class="cg-field"><label>职业</label>
            <select class="cg-in" id="cg-lo-class">
              ${S.classes.map((c) =>
                `<option value="${c.code}" ${c.code === clsCode ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>
          <div class="cg-field"><label>牌组张数</label>
            <div class="cg-ro ${total === target ? '' : 'warn'}">${total} / ${target}</div></div>
        </div>
        <div class="cg-deck">
          ${pool.map((c) => `
            <div class="cg-deck-row">
              <div class="cg-deck-name">${esc(c.name)}
                <small>${esc(c.cost)} 费 · ${esc(c.category_label || c.category)} · 上限 ${c.max_copies}</small></div>
              <div class="cg-deck-ctl">
                <button class="btn btn-outline btn-sm" data-minus="${c.code}">−</button>
                <b>${Number(deck[c.code]) || 0}</b>
                <button class="btn btn-outline btn-sm" data-plus="${c.code}">+</button>
              </div>
            </div>`).join('')}
        </div>`;
    };

    const bind = () => {
      const body = Admin.getModalBody();
      $('cg-lo-class').addEventListener('change', async (e) => {
        clsCode = e.target.value;
        deck = {};
        body.querySelector('.cg-modal-body-inner')?.remove();
        Admin.closeModal();
        openLoadoutEditor({ ...ch, class_code: clsCode, deck: {} });
      });
      body.querySelectorAll('[data-plus]').forEach((el) => el.addEventListener('click', () => {
        const code = el.dataset.plus;
        const card = S.cards.find((c) => c.code === code);
        const cur = Number(deck[code]) || 0;
        if (card && cur >= card.max_copies) { Admin.toast(`「${card.name}」最多 ${card.max_copies} 张`, 'error'); return; }
        deck[code] = cur + 1;
        refresh();
      }));
      body.querySelectorAll('[data-minus]').forEach((el) => el.addEventListener('click', () => {
        const code = el.dataset.minus;
        const cur = Number(deck[code]) || 0;
        if (cur <= 0) return;
        if (cur === 1) delete deck[code]; else deck[code] = cur - 1;
        refresh();
      }));
    };

    const refresh = () => {
      const body = Admin.getModalBody();
      body.innerHTML = draw() + '<div class="cg-modal-body-inner" hidden></div>';
      bind();
    };

    Admin.showModal(`配卡组 · ${ch.name}`, draw(), async () => {
      const total = Object.values(deck).reduce((a, b) => a + (Number(b) || 0), 0);
      if (total <= 0) { Admin.toast('卡组不能为空', 'error'); return; }
      try {
        await Admin.post('/cardgame/loadouts', {
          character_id: ch.id, class_code: clsCode, deck,
          note: `${ch.name} · ${clsCode}`,
        });
        Admin.closeModal();
        Admin.toast(`已保存（${total} 张）`, 'success');
        await loadAll(true); render();
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    }, { size: 'large' });
    setTimeout(bind, 60);
  }

  // ====================== 6.5 卡牌套装（换装 + 固定模板） ======================
  // 用户的原始问题：
  //   「卡牌都生成完了，如果换装就要在现有卡牌上直接换，好像不太好，能不能有套装卡牌，
  //    我换套装就整一套换了，A 套装能玩 B 套装也能玩，随时切换，也可以生成很多套。
  //    每次游玩必须有多少张卡牌，应该是要个固定模板的，游戏完整性不能漏卡吧。」
  // 所以这一页只干两件事：整副换装（互不覆盖）、卡组合规体检。
  let setPollTimer = null;

  function renderSets(body) {
    const sets = S.sets || [];
    const active = S.sets.find((x) => x.is_active) || {};
    const rep = S.deckReport || { classes: [], loadouts: [], deck_size: 30 };

    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

    body.innerHTML = `
      <div class="cg-hintbar">
        一套套装 = <b>全套卡面换同一身衣服 / 同一种画风</b>。切换套装只会把这套的图换上去，
        别的套装的图原样留在库里，A 玩腻了换 B，随时能切回 A，<b>不会互相覆盖</b>。
        新套装没图时点「补齐缺的 N 张」就会按这套的衣着把 41 张全部重出一遍。
      </div>

      <div class="cg-bar">
        <span class="cg-stat">共 <b>${sets.length}</b> 套 · 正在使用 <b>${esc(active.name || '默认套装')}</b></span>
        <button class="btn btn-primary btn-sm" id="cg-set-new">＋ 新建套装</button>
      </div>

      <div class="cg-setlist">
        ${sets.map((st) => `
          <div class="cg-set ${st.is_active ? 'on' : ''}" data-code="${esc(st.code)}">
            <div class="cg-set-hd">
              <div class="cg-set-name">
                <b>${esc(st.name)}</b>
                <span class="cg-set-code">${esc(st.code)}</span>
                ${st.is_active ? '<span class="cg-set-badge">使用中</span>' : ''}
              </div>
              <div class="cg-set-cnt ${st.missing > 0 ? 'warn' : ''}">
                ${st.done} / ${st.total}${st.missing > 0 ? ` · 缺 ${st.missing}` : ' · 齐了'}
              </div>
            </div>
            <div class="cg-set-bar"><i style="width:${pct(st.done, st.total)}%"></i></div>
            <div class="cg-set-note">${esc(st.note || '')}</div>
            <div class="cg-set-acts">
              <button class="btn btn-outline btn-sm" data-act="use" ${st.is_active ? 'disabled' : ''}>用这套</button>
              <button class="btn btn-outline btn-sm" data-act="fill" ${st.missing === 0 ? 'disabled' : ''}>
                ${st.missing > 0 ? `补齐缺的 ${st.missing} 张` : '已齐'}
              </button>
              <button class="btn btn-outline btn-sm" data-act="edit">改衣着 / 画风</button>
              <button class="btn btn-outline btn-sm danger" data-act="del" ${st.is_active ? 'disabled' : ''}>删除</button>
            </div>
            <div class="cg-set-edit" hidden>
              <div class="cg-form-grid">
                <div class="cg-field"><label>套装名</label>
                  <input class="cg-in" data-f="name" value="${esc(st.name)}"></div>
                <div class="cg-field"><label>备注</label>
                  <input class="cg-in" data-f="note" value="${esc(st.note || '')}"></div>
              </div>
              <div class="cg-field"><label>画风（留空 = 沿用各职业的画风）</label>
                <textarea class="cg-in cg-ta" rows="2" data-f="art_style" placeholder="例如：水墨淡彩，宣纸质感，留白构图">${esc(st.art_style || '')}</textarea></div>
              <div class="cg-form-grid">
                <div class="cg-field"><label>男性衣着</label>
                  <textarea class="cg-in cg-ta" rows="3" data-f="outfit_male" placeholder="留空 = 沿用职业设定">${esc(st.outfit_male || '')}</textarea></div>
                <div class="cg-field"><label>女性衣着</label>
                  <textarea class="cg-in cg-ta" rows="3" data-f="outfit_female" placeholder="留空 = 沿用职业设定">${esc(st.outfit_female || '')}</textarea></div>
              </div>
              <div class="cg-field"><label>其他/未知性别衣着</label>
                <textarea class="cg-in cg-ta" rows="2" data-f="outfit_other" placeholder="留空 = 沿用职业设定">${esc(st.outfit_other || '')}</textarea></div>
              <div class="cg-set-acts">
                <button class="btn btn-primary btn-sm" data-act="save">保存</button>
                <button class="btn btn-outline btn-sm" data-act="cancel">取消</button>
              </div>
              <div class="cg-form-desc" style="margin-top:6px">
                改完衣着后，只有<b>这套</b>之后生成的图会用新衣着；已经出过的图不会自动重出，
                想全部换成新衣着请删掉这套重建，或在「卡面生产」里单张重出。
              </div>
            </div>
          </div>`).join('')}
      </div>

      <div class="cg-form-group" style="margin-top:22px">
        <div class="cg-form-title">卡组固定模板 · 每副 ${rep.deck_size} 张</div>
        <div class="cg-form-desc">
          规则原版就是 <b>通用 18 张 + 职业专属 12 张 = 30 张</b>。少了会中期断手牌，
          多了会稀释抽牌概率，带不存在的卡开局发牌直接炸。这里对每个职业的标准模板、
          以及每个角色实际在用的卡组做一次体检。
        </div>
        <div class="cg-deckcheck">
          ${(rep.classes || []).map((c) => `
            <div class="cg-dc-row ${c.ok ? 'ok' : 'bad'}">
              <div class="cg-dc-name">${esc(c.name)} <small>${esc(c.code)}</small></div>
              <div class="cg-dc-cnt">${c.total} / ${rep.deck_size} 张</div>
              <div class="cg-dc-st">${c.ok ? '✓ 合规' : '✗ ' + esc((c.issues || []).join('；'))}</div>
            </div>`).join('')}
        </div>

        ${(rep.loadouts || []).length ? `
          <div class="cg-form-title" style="margin-top:16px">角色卡组</div>
          <div class="cg-deckcheck">
            ${rep.loadouts.map((l) => `
              <div class="cg-dc-row ${l.ok ? 'ok' : 'bad'}">
                <div class="cg-dc-name">${esc(l.character_name)} <small>${esc(l.class_code)}</small></div>
                <div class="cg-dc-cnt">${l.total} / ${rep.deck_size} 张</div>
                <div class="cg-dc-st">${l.ok ? '✓ 合规' : '✗ ' + esc((l.issues || []).join('；'))}</div>
              </div>`).join('')}
          </div>` : ''}

        <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="cg-dc-repair">按模板补齐不合规的</button>
          <button class="btn btn-outline btn-sm" id="cg-dc-refresh">重新体检</button>
          <span class="cg-form-desc" style="margin:0">
            ${rep.ok ? '全部合规，不需要处理。' : `发现 ${rep.bad_classes} 个职业模板、${rep.bad_loadouts} 个角色卡组不合规。`}
            只改不合规的，你手工调过的牌组不会被冲掉。
          </span>
        </div>
      </div>`;

    // ---- 新建套装 ----
    $('cg-set-new').addEventListener('click', () => {
      Admin.showModal('新建卡牌套装', `
        <div class="cg-form-grid">
          <div class="cg-field"><label>套装名称</label>
            <input class="cg-in" id="cg-ns-name" placeholder="例如：B 套装 · 冬日白袍"></div>
          <div class="cg-field"><label>复制哪一套的衣着设定</label>
            <select class="cg-in" id="cg-ns-copy">
              <option value="">不复制（留空 = 沿用各职业）</option>
              ${sets.map((x) => `<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('')}
            </select></div>
        </div>
        <div class="cg-form-desc" style="margin-top:8px">
          新建后这一套是空的（0 / ${active.total || 41} 张），点「补齐缺的 N 张」就会按这套的衣着把全套重出一遍。
          原来的套装完全不受影响。
        </div>`, async () => {
        const name = ($('cg-ns-name').value || '').trim();
        if (!name) { Admin.toast('请填套装名称', 'error'); return; }
        try {
          await Admin.post('/cardgame/art/sets', {
            name, copy_from: $('cg-ns-copy').value || undefined,
          });
          Admin.closeModal();
          Admin.toast('套装已创建，接着点「补齐缺的 N 张」出图', 'success');
          await loadAll(true); render();
        } catch (e) { Admin.toast('创建失败：' + e.message, 'error'); }
      }, { size: 'medium' });
    });

    // ---- 每张套装卡片的操作 ----
    body.querySelectorAll('.cg-set').forEach((el) => {
      const code = el.dataset.code;
      const st = sets.find((x) => x.code === code);
      const edit = el.querySelector('.cg-set-edit');
      el.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.act;
          if (act === 'edit') {
            edit.hidden = !edit.hidden;
            el.classList.toggle('editing', !edit.hidden);
            return;
          }
          if (act === 'cancel') {
            edit.hidden = true;
            el.classList.remove('editing');
            return;
          }
          if (act === 'save') {
            const payload = {};
            edit.querySelectorAll('[data-f]').forEach((inp) => { payload[inp.dataset.f] = inp.value; });
            try {
              await Admin.put(`/cardgame/art/sets/${code}`, payload);
              Admin.toast('已保存', 'success');
              await loadAll(true); render();
            } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
            return;
          }
          if (act === 'use') {
            btn.disabled = true; btn.textContent = '切换中…';
            try {
              const r = await Admin.post(`/cardgame/art/sets/${code}/activate`, {});
              Admin.toast(`已切到「${r.set_name}」：换上 ${r.applied} 张，其余 ${r.kept} 张保留原图`, 'success');
              await loadAll(true); render();
            } catch (e) {
              btn.disabled = false; btn.textContent = '用这套';
              Admin.toast('切换失败：' + e.message, 'error');
            }
            return;
          }
          if (act === 'fill') {
            btn.disabled = true; btn.textContent = '提交中…';
            try {
              const r = await Admin.post(`/cardgame/art/sets/${code}/generate`, { only_missing: true });
              Admin.toast(`已提交 ${r.submitted} / ${r.total} 张，任务面板里能看到全部排队`,
                r.submitted ? 'success' : 'error');
              pollSets();
            } catch (e) {
              btn.disabled = false; btn.textContent = '补齐';
              Admin.toast('提交失败：' + e.message, 'error');
            }
            return;
          }
          if (act === 'del') {
            const yes = await Admin.confirm(
              `确定删除套装「${st.name}」？这套的 ${st.done} 张图会一起删掉（正在使用的卡面不受影响）。`);
            if (!yes) return;
            try {
              await Admin.del(`/cardgame/art/sets/${code}`);
              Admin.toast('已删除', 'success');
              await loadAll(true); render();
            } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
          }
        });
      });
    });

    // ---- 卡组合规 ----
    $('cg-dc-repair')?.addEventListener('click', async () => {
      try {
        const r = await Admin.post('/cardgame/deck/repair', {});
        Admin.toast(`已补齐 ${r.fixed_classes} 个职业模板、${r.fixed_loadouts} 个角色卡组`, 'success');
        await loadAll(true); render();
      } catch (e) { Admin.toast('补齐失败：' + e.message, 'error'); }
    });
    $('cg-dc-refresh')?.addEventListener('click', async () => {
      S.deckReport = await Admin.get('/cardgame/deck/report');
      S.loaded = false; await loadAll(true); render();
    });
  }

  /** 出图是串行的，刷新几次把完整度补上就好，不用盯任务面板。 */
  function pollSets() {
    if (setPollTimer) clearInterval(setPollTimer);
    let n = 0;
    setPollTimer = setInterval(async () => {
      n += 1;
      try {
        const r = await Admin.get('/cardgame/art/sets');
        S.sets = r.items || [];
        S.setActive = r.active || 'default';
        if (tab === 'sets') {
          const body = $('cg-body');
          if (body) renderSets(body);
        }
      } catch (e) { /* 忽略：下次再刷 */ }
      const left = (S.sets || []).reduce((a, x) => a + (x.missing || 0), 0);
      if (n >= 40 || left === 0) clearInterval(setPollTimer);
    }, 6000);
  }

  // ====================== 7. 提示词与设置 ======================
  function renderSettings(body) {
    const s = S.settings || {};
    body.innerHTML = `
      <div class="cg-hintbar">
        这张模板给所有卡面生图共用，<b>每个标签都会被真实数据替换</b>：
        <b>{style}</b> 职业画风（在「职业」里改，或按人物在「人物管理 › 卡牌角色」里覆盖）、<b>{name}</b> 人物名、
        <b>{gender}</b> 性别 / <b>{age}</b> 年龄 / <b>{head}</b> 头脸特征（取自该人物的
        <b>外观拼装</b>，在「人物管理」编辑）、<b>{outfit}</b> 衣着（职业服装 / 卡牌套装覆盖 / 卡牌角色覆盖）、
        <b>{action}</b> 动作 / <b>{expression}</b> 表情（在「卡牌」里逐张改）、<b>{extra}</b> 追加词。
        <br>想按人物单独改画风、衣着、或加前后缀，去<b>人物管理 → 编辑人物 → 卡牌角色</b>；
        想调某个角色在战斗里的动作 / 神情，去<b>角色情感表现</b>。下面「模板拼装预览」可以选一张卡 + 一个人物，直接看这套标签会被填成什么。
      </div>
      <div class="cg-form-group">
        <div class="cg-form-title">正面模板</div>
        <textarea class="cg-in cg-ta" id="cg-st-tpl" rows="5">${esc(s.art_template || '')}</textarea>
        <div class="cg-form-title" style="margin-top:10px">负向提示词</div>
        <textarea class="cg-in cg-ta" id="cg-st-neg" rows="3">${esc(s.art_negative || '')}</textarea>

        <div class="cg-form-title" style="margin-top:14px">模板拼装预览</div>
        <div class="cg-form-desc">选一张卡 + 一个人物，看看上面那些标签最终会被填成什么。</div>
        <div class="cg-form-grid" style="margin-top:8px">
          <div class="cg-field"><label>卡牌</label><select class="cg-in" id="cg-pv-card"></select></div>
          <div class="cg-field"><label>人物（提供外观拼装）</label><select class="cg-in" id="cg-pv-char"></select></div>
          <div class="cg-field" style="align-self:end">
            <button class="btn btn-outline btn-sm" id="cg-pv-btn">预览拼装</button></div>
        </div>
        <div id="cg-pv-out" class="cg-form-desc"
             style="white-space:pre-wrap;margin-top:8px;border:1px solid var(--border);border-radius:6px;padding:8px;display:none"></div>
        <div class="cg-form-title" style="margin-top:14px">卡牌出图参数</div>
        <div class="cg-form-desc">
          这里只影响<b>卡牌系统</b>自己的出图。人物、场景、漫画等栏目各存各的，互不干扰；
          没改过的项自动沿用「设置 › 全局出图参数」的起点值。
        </div>
        <div id="cg-gen-params" style="margin-top:8px"></div>
        <div class="cg-form-grid" style="margin-top:12px">
          <div class="cg-field"><label>取景</label>
            <select class="cg-in" id="cg-st-frame">
              <option value="half" ${s.art_framing === 'half' ? 'selected' : ''}>半身</option>
              <option value="full" ${s.art_framing === 'full' ? 'selected' : ''}>全身</option>
              <option value="bust" ${s.art_framing === 'bust' ? 'selected' : ''}>胸像</option>
            </select></div>
          <div class="cg-field"><label>出图后自动套用卡面</label>
            <label class="cg-check"><input type="checkbox" id="cg-st-auto" ${Number(s.art_auto_apply) ? 'checked' : ''}> 自动</label></div>
          <div class="cg-field"><label>战斗系统</label>
            <label class="cg-check"><input type="checkbox" id="cg-st-battle" ${Number(s.battle_enabled) ? 'checked' : ''}> 启用</label></div>
          <div class="cg-field"><label>试玩默认我方职业</label>
            <select class="cg-in" id="cg-st-pc">
              ${S.classes.map((c) =>
                `<option value="${c.code}" ${s.battle_demo_class === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>
          <div class="cg-field"><label>试玩默认对手职业</label>
            <select class="cg-in" id="cg-st-ec">
              ${S.classes.map((c) =>
                `<option value="${c.code}" ${s.battle_demo_enemy_class === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>
        </div>

        <div class="cg-form-title" style="margin-top:18px">战斗情感演出节奏</div>
        <div class="cg-form-desc">
          玩家反馈「情感卡一闪就没了、看不清」。这里控制每一张情感卡从淡入、停留到淡出的总时长，
          战斗中顺序播放，改完立刻生效（同「动效展示」里的时长语义一致：毫秒）。
        </div>
        <div class="cg-form-grid" style="margin-top:10px">
          <div class="cg-field"><label>淡入（ms）</label>
            <input class="cg-in" type="number" min="0" step="20" id="cg-st-efi" value="${esc(s.emotion_fade_in_ms || 260)}"></div>
          <div class="cg-field"><label>停留（ms）</label>
            <input class="cg-in" type="number" min="0" step="100" id="cg-st-eho" value="${esc(s.emotion_hold_ms || 1600)}"></div>
          <div class="cg-field"><label>淡出（ms）</label>
            <input class="cg-in" type="number" min="0" step="20" id="cg-st-efo" value="${esc(s.emotion_fade_out_ms || 320)}"></div>
          <div class="cg-field"><label>显示情感标签</label>
            <label class="cg-check"><input type="checkbox" id="cg-st-etag" ${String(s.emotion_show_tag ?? '1') !== '0' ? 'checked' : ''}> 显示</label></div>
        </div>
        <div class="cg-form-desc" id="cg-st-eprev" style="margin-top:6px;color:var(--text-muted)"></div>
        <div style="margin-top:14px">
          <button class="btn btn-primary btn-sm" id="cg-st-save">保存设置</button>
        </div>
      </div>`;
    const syncEmoPreview = () => {
      const a = Number($('cg-st-efi').value || 0);
      const b = Number($('cg-st-eho').value || 0);
      const c = Number($('cg-st-efo').value || 0);
      const el = $('cg-st-eprev');
      if (el) el.textContent = `单张情感卡约 ${(a + b + c) / 1000} 秒（淡入 ${a} + 停留 ${b} + 淡出 ${c}）`;
    };
    ['cg-st-efi', 'cg-st-eho', 'cg-st-efo'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', syncEmoPreview);
    });
    syncEmoPreview();

    $('cg-st-save').addEventListener('click', async () => {
      const payload = {
        art_template: $('cg-st-tpl').value,
        art_negative: $('cg-st-neg').value,
        art_framing: $('cg-st-frame').value,
        art_auto_apply: $('cg-st-auto').checked ? 1 : 0,
        battle_enabled: $('cg-st-battle').checked ? 1 : 0,
        battle_demo_class: $('cg-st-pc').value,
        battle_demo_enemy_class: $('cg-st-ec').value,
        emotion_fade_in_ms: Number($('cg-st-efi').value || 0),
        emotion_hold_ms: Number($('cg-st-eho').value || 0),
        emotion_fade_out_ms: Number($('cg-st-efo').value || 0),
        emotion_show_tag: $('cg-st-etag').checked ? 1 : 0,
      };
      try {
        S.settings = await Admin.put('/cardgame/settings', payload);
        Admin.toast('设置已保存', 'success');
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    });

    // 挂载「全局出图参数」面板：尺寸 / 模型方案与人物、场景等所有出图入口共用同一份
    const gpHost = $('cg-gen-params');
    if (gpHost && window.GenParams) {
      GenParams.init(gpHost, { scope: 'cards' }).catch((e) => {
        gpHost.innerHTML = `<div class="cg-form-desc">参数加载失败：${esc(e.message)}</div>`;
      });
    }

    // ---- 模板拼装预览：选卡 + 人物 → 调 /cardgame/art/preview，看标签的真实替换值 ----
    const cardSel = $('cg-pv-card');
    const charSel = $('cg-pv-char');
    if (cardSel) {
      cardSel.innerHTML = (S.cards || []).map((c) =>
        `<option value="${esc(c.code)}">${esc(c.name || c.code)}</option>`).join('');
    }
    if (charSel) {
      charSel.innerHTML = '<option value="">（不用人物，用卡牌自身）</option>' +
        (S.chars || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    }
    const pvBtn = $('cg-pv-btn');
    if (pvBtn) pvBtn.addEventListener('click', async () => {
      const out = $('cg-pv-out');
      out.style.display = 'block';
      out.textContent = '拼装中…';
      try {
        const q = `/cardgame/art/preview?card_code=${encodeURIComponent(cardSel ? cardSel.value : '')}`
          + `&character_id=${encodeURIComponent(charSel && charSel.value ? charSel.value : '')}`;
        const r = await Admin.get(q);
        const parts = r.parts || {};
        const tagLines = Object.keys(parts).filter((k) => parts[k])
          .map((k) => `「{${k}}」 → ${parts[k]}`).join('\n');
        out.textContent = `尺寸 ${r.width}×${r.height} · 方案 ${r.model_preset || '（全局）'}\n\n`
          + `【最终正面提示词】\n${r.positive}\n\n【标签替换明细】\n${tagLines}`;
      } catch (e) {
        out.textContent = '预览失败：' + e.message;
      }
    });
  }

  // ====================== 7.5 对战演示 ======================
  // 后台配好人 × 职业，点「演示」直接开一局真打——不是静态预览。
  // 原理：把双方 id 与职业拼成前台地址的参数（/?carddemo=1&pchar=…），
  // 前台 CardBattleUI.startConfigured 读到就立刻开局。
  const DEMO_KEY = 'cg_demo_setup_v1';
  function demoLoad() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function demoSave(o) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(o || {})); } catch (_) {}
  }

  function demoPicker(state) {
    const chars = (S.chars || []);
    const classes = (S.classes || []).filter((c) => Number(c.enabled) !== 0);
    const clsOf = (code) => classes.find((c) => c.code === code) || null;
    const chOf = (id) => chars.find((c) => String(c.id) === String(id)) || null;

    const side = (key, title, tone) => {
      const cid = state[key + 'char'];
      const ccode = state[key + 'class'];
      const ch = chOf(cid);
      const cls = clsOf(ccode);
      return `
        <div class="cg-demo-side ${tone}">
          <div class="cg-demo-side-head">
            <span class="cg-demo-badge">${title}</span>
          </div>
          <div class="cg-demo-pv" style="${ch && ch.portrait ? `background-image:url('${esc(ch.portrait)}')` : ''}">
            ${ch && ch.portrait ? '' : (ch ? esc(ch.name) : '未选人物')}
          </div>
          <label class="cg-demo-field"><span>人物</span>
            <select class="cg-in" data-demo="${key}char">
              ${chars.map((c) => `<option value="${c.id}" ${String(c.id) === String(cid) ? 'selected' : ''}>${esc(c.name)}${c.character_type ? `（${esc(c.character_type)}）` : ''}</option>`).join('') || '<option value="">还没有人物</option>'}
            </select>
          </label>
          <label class="cg-demo-field"><span>职业</span>
            <select class="cg-in" data-demo="${key}class">
              ${classes.map((c) => `<option value="${esc(c.code)}" ${c.code === ccode ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <div class="cg-demo-stats">
            <span>HP <b>${cls ? cls.hp : '—'}</b></span>
            <span>DEF <b>${cls ? cls.defense : '—'}</b></span>
            <span>SPD <b>${cls ? cls.spd : '—'}</b></span>
            <span>CRI <b>${cls ? cls.cri + '%' : '—'}</b></span>
          </div>
          <div class="cg-demo-note">
            ${ch && ch.deck_size
              ? `角色卡组：<b>${ch.deck_size}</b> 张${ch.class_code ? `（原职业 ${esc(ch.class_code)}）` : ''}`
              : '这个人物还没配卡组，将按所选职业的默认牌组开打'}
          </div>
        </div>`;
    };

    const pcls = clsOf(state.pclass);
    const ecls = clsOf(state.eclass);
    return `
      <div class="cg-demo-grid">
        ${side('p', '己方', 'self')}
        <div class="cg-demo-vs">
          <div class="cg-demo-vs-mark">VS</div>
          <div class="cg-demo-vs-sub">${esc((pcls && pcls.name) || '—')} 对 ${esc((ecls && ecls.name) || '—')}</div>
        </div>
        ${side('e', '敌方', 'enemy')}
      </div>`;
  }

  function renderDemo(body) {
    const chars = (S.chars || []);
    if (!chars.length) {
      body.innerHTML = '<div class="table-empty">还没有人物，先到「人物管理」建两个再回来配对战</div>';
      return;
    }
    const classes = (S.classes || []).filter((c) => Number(c.enabled) !== 0);
    const saved = demoLoad();
    const pick = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : v);
    const st = {
      pchar: pick(saved.pchar, chars[0].id),
      pclass: pick(saved.pclass, (classes[0] && classes[0].code) || ''),
      echar: pick(saved.echar, (chars[1] || chars[0]).id),
      eclass: pick(saved.eclass, (classes[1] || classes[0] || {}).code || ''),
    };

    const buildUrl = () => {
      const q = new URLSearchParams({
        carddemo: '1', pchar: st.pchar, pclass: st.pclass, echar: st.echar, eclass: st.eclass,
      });
      return location.origin + '/?' + q.toString();
    };

    const draw = () => {
      body.innerHTML = `
        <div class="cg-bar">
          <span class="cg-stat">对垒配置</span>
          <span class="cg-stat" style="color:var(--text-muted)">选两边的人物与职业，点「演示」即刻开一局真打</span>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm" data-dm="swap" title="两边对调">⇄ 对调</button>
          <button class="btn btn-outline btn-sm" data-dm="copy">复制演示链接</button>
          <button class="btn btn-primary btn-sm" data-dm="go">▶ 演示</button>
        </div>
        <div class="cg-hintbar">
          演示开在前台游戏页的新标签页里，按这里的<b>人物</b>与<b>职业</b>直接开局：走的是试玩通道（source=demo），
          <b>不会写剧情进度</b>。人物身上已经有卡组就用他的卡组，没有就按所选职业的默认牌组发牌。
        </div>
        ${demoPicker(st)}
        <div class="cg-demo-url"><span>演示地址</span><code>${esc(buildUrl())}</code></div>`;

      body.querySelectorAll('[data-demo]').forEach((el) => {
        el.addEventListener('change', () => {
          st[el.dataset.demo] = el.value;
          demoSave(st);
          draw();
        });
      });
      body.querySelector('[data-dm="swap"]').addEventListener('click', () => {
        const t = { pchar: st.pchar, pclass: st.pclass };
        st.pchar = st.echar; st.pclass = st.eclass;
        st.echar = t.pchar; st.eclass = t.pclass;
        demoSave(st);
        draw();
      });
      body.querySelector('[data-dm="copy"]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(buildUrl());
          Admin.toast('演示链接已复制', 'success');
        } catch (_) { Admin.toast('复制失败，可手动选中地址复制', 'error'); }
      });
      body.querySelector('[data-dm="go"]').addEventListener('click', () => {
        demoSave(st);
        window.open(buildUrl(), '_blank');
      });
    };
    draw();
  }

  // ====================== 7.6 情感与表现 ======================
  // 一个角色 × 一种情感 = 一张图 + 一句话。
  //
  // 这一版按「人物 → 外观 → 提示词」走，和卡面模板彻底分开：
  //   · 左栏是人物管理里的角色列表（不再是工具栏右上角一个下拉）
  //   · 外观配置直接取「人物管理 → 该角色」的那几套，列出来让人挑
  //   · 挑中哪套，提示词框就显示那套外观自己的提示词（可改），
  //     动作与神情合并成一个「动作神情」输入框，拼在提示词末尾
  //   · 保存时写成一条独立提示词（后端 prompt_text），
  //     「提示词与设置」里改模板 / 负面词都不会影响它
  const EP = {
    data: null,          // 最近一次 /emotion-profiles 的返回
    sel: new Set(),      // 勾选的 emotion_code（批量生图用）
    appOf: {},           // character_id -> 外观配置列表缓存
    promptOf: {},        // "charId:appId" -> 该外观配的提示词缓存
    editing: '',         // 非空 = 正在编辑这个 emotion_code
    polling: null,       // 批量生图的轮询定时器
    selChar: null,
  };
  let emoProfCharId = null;

  function epChar() {
    return (S.chars || []).find((c) => String(c.id) === String(emoProfCharId)) || {};
  }
  function epClassLabel(code) {
    const c = (S.classes || []).find((x) => x.code === code);
    return c ? c.name : '';
  }

  function epPill(it) {
    if (it.job_id && !it.image_url) return '<span class="cg-pill run">出图中</span>';
    if (it.customized) return '<span class="cg-pill ok">已个性化</span>';
    return '<span class="cg-pill">沿用通用</span>';
  }

  // 老数据里有些「台词」被塞进了整段提示词（带【人物】【服装】这种块标记），
  // 直接显示会把列表撑得很乱 —— 这里只提示、原文留在编辑页让用户自己清。
  function epLineIsDirty(it) {
    const s = (it.line || '').trim();
    return !!s && (s.includes('【') || s.length > 120);
  }
  function epLineHtml(it) {
    if (epLineIsDirty(it)) {
      return '<span style="color:#ff9b9b">台词里混进了提示词，点开清理</span>';
    }
    return esc((it.line || '').trim() || it.default_line || '（还没写台词）');
  }

  // ---------- 卡牌语音：音色分组加载 / 下拉选项（与剧情对话面板同一套音色库） ----------
  let _cgVoiceGroups = null;
  async function cgVoiceGroups() {
    if (_cgVoiceGroups) return _cgVoiceGroups;
    try {
      const r = await Admin.get('/tts/voices?grouped=true');
      _cgVoiceGroups = (r && r.groups) || r || [];
    } catch (_) { _cgVoiceGroups = []; }
    return _cgVoiceGroups;
  }
  function cgVoiceSelectHtml(groups, current) {
    const g = (groups || []).filter(x => (x.voices || []).length);
    if (!g.length) return '<option value="">（没有可用音色）</option>';
    return g.map(gr => {
      const opts = (gr.voices || []).map(v => {
        const origin = (v.origin === 'online' ? ' · 在线' : v.origin === 'local' ? ' · 本地' : '');
        return `<option value="${esc(v.voice_id)}"${String(v.voice_id) === String(current) ? ' selected' : ''}>${esc((v.label || v.name || v.voice_id) + origin)}</option>`;
      }).join('');
      return `<optgroup label="${esc(gr.name || gr.id || '')}">${opts}</optgroup>`;
    }).join('');
  }
  // 卡牌角色绑定的音色是否生效（有值就算绑了）
  function epVoiceBound(v) {
    v = v || {};
    return !!(v.engine || v.voice_id);
  }
  // 批量生成语音时每行要带的音色覆盖（绑定过才传，否则交给角色默认配置）
  function epVoiceRowOverrides(v) {
    v = v || {};
    const o = {};
    if (v.engine) o.engine = v.engine;
    if (v.voice_id) o.voice_id = v.voice_id;
    if (v.rate) o.rate = parseInt(v.rate, 10);
    if (v.pitch) o.pitch = parseInt(v.pitch, 10);
    if (v.volume) o.volume = parseInt(v.volume, 10);
    return o;
  }

  async function epLoadApps(chId) {
    const key = String(chId);
    if (EP.appOf[key]) return EP.appOf[key];
    try {
      const r = await Admin.get(`/characters/${chId}/appearances`);
      EP.appOf[key] = r.items || [];
    } catch (_) {
      EP.appOf[key] = [];
    }
    return EP.appOf[key];
  }

  // 取某套外观配置自己的提示词（走 /appearance/prompt，即人物外观拼装那套，
  // 与卡牌模板无关）。appId = 0 表示人物档案里的默认外观。
  async function epAppearancePrompt(chId, appId) {
    const key = chId + ':' + (appId || 0);
    if (EP.promptOf[key] !== undefined) return EP.promptOf[key];
    let app = {};
    try {
      if (appId) {
        const rows = await epLoadApps(chId);
        const hit = rows.find((a) => Number(a.id) === Number(appId));
        app = (hit && hit.appearance) || {};
      } else {
        const r = await Admin.get(`/characters/${chId}/appearance`);
        app = r.appearance || {};
      }
      const r2 = await Admin.post('/appearance/prompt', { appearance: app, include_sensitive: false });
      EP.promptOf[key] = ((r2 && r2.prompt && r2.prompt.posCn) || '').trim();
    } catch (_) {
      EP.promptOf[key] = '';
    }
    return EP.promptOf[key];
  }

  async function renderEmotionProfiles(body) {
    // 编辑页单独一条路：同一个 body，换内容不换 tab
    if (EP.editing) return renderEmotionEditor(body, EP.editing);

    const chars = (S.chars || []);
    if (!chars.length) {
      body.innerHTML = '<div class="table-empty">还没有人物，先到「人物管理」建一个</div>';
      return;
    }
    if (!emoProfCharId || !chars.some((c) => String(c.id) === String(emoProfCharId))) {
      const firstLoad = (S.loadouts || [])[0];
      emoProfCharId = (firstLoad && firstLoad.character_id) || chars[0].id;
    }
    let data;
    try {
      data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
    } catch (e) {
      body.innerHTML = `<div class="table-empty">加载失败：${esc(e.message)}</div>`;
      return;
    }
    EP.data = data;
    if (String(EP.selChar) !== String(emoProfCharId)) {
      EP.sel.clear();
      EP.selChar = emoProfCharId;
    }
    const items = data.items || [];
    const selN = items.filter((i) => EP.sel.has(i.emotion_code)).length;
    const ch = epChar();
    const vBound = epVoiceBound(data.voice);
    await emoStyleChars();   // 独立样式缓存：按钮上要显示这个角色有没有定制过

    // ---- 左栏：角色列表（人物管理里的人，带卡组职业） ----
    const charList = chars.map((c) => {
      const on = String(c.id) === String(emoProfCharId);
      const cls = epClassLabel(c.class_code);
      return `
        <div class="cg-epchar ${on ? 'on' : ''}" data-cid="${c.id}" title="${esc(c.name)}">
          <div class="cg-epchar-ava" style="${c.portrait ? `background-image:url('${esc(c.portrait)}')` : ''}">
            ${c.portrait ? '' : esc((c.name || '?').slice(0, 1))}
          </div>
          <div class="cg-epchar-tx">
            <b>${esc(c.name)}</b>
            <span>${cls ? esc(cls) : (c.deck_size ? '已配卡组' : '未配卡组')}</span>
          </div>
        </div>`;
    }).join('');

    // ---- 主区：情感卡 ----
    const cards = items.map((it) => `
      <div class="cg-epcard ${EP.sel.has(it.emotion_code) ? 'on' : ''}" data-code="${esc(it.emotion_code)}">
        <input type="checkbox" class="cg-epchk" data-chk="${esc(it.emotion_code)}"
               ${EP.sel.has(it.emotion_code) ? 'checked' : ''} title="勾选后可批量生成">
        <span class="cg-epcard-flag">${epPill(it)}</span>
        <div class="cg-epcard-pv ${it.image_url ? '' : 'empty'}"
             style="${it.image_url ? `background-image:url('${esc(it.image_url)}')` : ''}">
          ${it.image_url ? '' : (it.job_id ? '出图中…' : '无图')}
        </div>
        <div class="cg-epcard-bd">
          <div class="cg-epcard-tt">
            <span class="cg-ep-dot" style="background:${esc(it.color || '#d4af37')}"></span>
            <b>${esc(it.name)}</b>
            ${it.tag ? `<span class="cg-ep-tag">${esc(it.tag)}</span>` : ''}
          </div>
          <div class="cg-epcard-ln">${epLineHtml(it)}</div>
          <div class="cg-epcard-ft">
            <button class="btn btn-outline btn-sm" data-play="${esc(it.emotion_code)}" title="按当前表现样式立刻演一遍">▶ 演示</button>
            ${it.voice_url
              ? `<button class="btn btn-outline btn-sm" data-vplay="${esc(it.emotion_code)}" title="试听这条情感已生成的语音">🔊 试听</button>`
              : `<button class="btn btn-outline btn-sm" data-vone="${esc(it.emotion_code)}" title="把这条情感的台词合成语音（没写台词就自动填通用台词）">🎙 语音</button>`}
            ${it.image_url
              ? '<span class="cg-ep-tag">点开编辑</span>'
              : `<button class="btn btn-outline btn-sm" data-gen="${esc(it.emotion_code)}">生成图</button>`}
          </div>
        </div>
      </div>`).join('');

    body.innerHTML = `
      <div class="cg-epwrap">
        <aside class="cg-epside">
          <div class="cg-epside-head">角色 <span>${chars.length}</span></div>
          <div class="cg-epside-list">${charList}</div>
        </aside>
        <div class="cg-epmain">
          <div class="cg-bar">
            <span class="cg-stat">已个性化 <b>${data.customized}</b> / ${data.total} 种情感</span>
            <button class="btn btn-outline btn-sm" data-ep="all">全选</button>
            <button class="btn btn-outline btn-sm" data-ep="none">全不选</button>
            <button class="btn btn-outline btn-sm" data-ep="todo" title="只勾选还没有图的情感">勾选未出图</button>
            <div style="flex:1"></div>
            <span class="cg-stat" id="cg-ep-seln">已选 ${selN}</span>
            <button class="btn btn-outline btn-sm" data-ep="charstyle"
              title="给这个角色单独定制一套表现样式，没定制的角色用全局的"
              style="${emoCharOverride(emoProfCharId) ? 'color:var(--gold,#e8c46a);border-color:rgba(232,196,106,.55)' : ''}">🎭 独立样式${emoCharOverride(emoProfCharId) ? ' · 已定制' : ''}</button>
            <button class="btn btn-outline btn-sm" data-ep="style" title="调整人物与对话框的排版">表现样式</button>
            <button class="btn btn-outline btn-sm" data-ep="playall" title="用当前角色的第一张情感图演一遍">▶ 立即演示</button>
            <button class="btn btn-outline btn-sm" id="cg-ep-voice-cfg"
              title="给这个卡牌角色绑定音色（绑了批量语音用它，没绑就用声音管理里的角色默认配置）"
              style="${vBound ? 'color:var(--gold,#e8c46a);border-color:rgba(232,196,106,.55)' : ''}">🔊 角色音色${vBound ? ' · 已绑定' : ''}</button>
            <button class="btn btn-outline btn-sm" id="cg-ep-voice-batch" ${selN ? '' : 'disabled'}
              title="把勾选情感的台词合成语音：没写台词就自动填通用台词再生成，勾了部分=这部分重新生成">🎙 批量语音 (${selN})</button>
            <button class="btn btn-primary btn-sm" id="cg-ep-batch" ${selN ? '' : 'disabled'}>批量生成 (${selN})</button>
          </div>
          <div class="cg-hintbar">
            左栏选角色，主区选情感。点任意一块进<b>编辑页</b>：挑一套<b>外观配置</b>，提示词框就会显示那套外观自己的提示词，
            再补一句<b>动作神情</b>即可。这里的提示词是独立的一条，和「提示词与设置」里的卡面模板<b>没有任何关系</b>。
            每张卡都有「▶ 演示」，按当前表现样式立刻看效果。
          </div>
          <div class="cg-epgrid">${cards || '<div class="table-empty">没有情感数据</div>'}</div>
        </div>
      </div>`;

    body.querySelectorAll('.cg-epchar').forEach((el) => {
      el.addEventListener('click', () => {
        emoProfCharId = el.dataset.cid;
        EP.editing = '';
        renderEmotionProfiles(body);
      });
    });

    const refreshSel = () => {
      const n = EP.sel.size;
      const sn = $('cg-ep-seln');
      const bb = $('cg-ep-batch');
      const vb = $('cg-ep-voice-batch');
      if (sn) sn.textContent = '已选 ' + n;
      if (bb) {
        bb.textContent = `批量生成 (${n})`;
        bb.disabled = !n;
      }
      if (vb) {
        vb.textContent = `🎙 批量语音 (${n})`;
        vb.disabled = !n;
      }
    };

    body.querySelectorAll('[data-ep]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.ep;
        if (act === 'style') { openEmoStyle(); return; }
        if (act === 'charstyle') { openEmoStyle(emoProfCharId); return; }
        if (act === 'playall') {
          const hit = items.find((i) => i.image_url) || items[0];
          if (!hit) return;
          epPlay(hit);
          return;
        }
        const items2 = EP.data.items || [];
        if (act === 'all') items2.forEach((i) => EP.sel.add(i.emotion_code));
        if (act === 'none') EP.sel.clear();
        if (act === 'todo') {
          EP.sel.clear();
          items2.filter((i) => !i.image_url).forEach((i) => EP.sel.add(i.emotion_code));
        }
        body.querySelectorAll('.cg-epcard').forEach((c) => {
          const on = EP.sel.has(c.dataset.code);
          c.classList.toggle('on', on);
          const ck = c.querySelector('.cg-epchk');
          if (ck) ck.checked = on;
        });
        refreshSel();
      });
    });

    body.querySelectorAll('.cg-epchk').forEach((ck) => {
      ck.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = ck.dataset.chk;
        if (ck.checked) EP.sel.add(code); else EP.sel.delete(code);
        ck.closest('.cg-epcard').classList.toggle('on', ck.checked);
        refreshSel();
      });
    });

    body.querySelectorAll('.cg-epcard').forEach((card) => {
      card.addEventListener('click', () => {
        EP.editing = card.dataset.code;
        EP.sel.clear();
        renderEmotionProfiles(body);
      });
    });

    body.querySelectorAll('[data-play]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const it = items.find((x) => x.emotion_code === btn.dataset.play);
        if (it) epPlay(it);
      });
    });

    body.querySelectorAll('[data-gen]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const code = btn.dataset.gen;
        btn.disabled = true;
        btn.textContent = '提交中…';
        try {
          await epGenerateOne(code, {});
          Admin.toast('已加入出图队列，出完自动套回这张卡', 'success');
          epPollUntil(body, [code]);
        } catch (e2) {
          Admin.toast('提交失败：' + e2.message, 'error');
          btn.disabled = false;
          btn.textContent = '生成图';
        }
      });
    });

    $('cg-ep-batch')?.addEventListener('click', async () => {
      const codes = Array.from(EP.sel);
      if (!codes.length) return;
      if (!await Admin.confirm(`要批量生成 ${codes.length} 张情感图吗？<br>任务会依次排队出图（一次只跑一张，避免显存爆掉）。`, { danger: false })) return;
      const bb = $('cg-ep-batch');
      bb.disabled = true;
      let ok = 0, fail = 0;
      for (const code of codes) {
        bb.textContent = `提交中 ${ok + fail + 1}/${codes.length}…`;
        try { await epGenerateOne(code, {}); ok++; } catch (_) { fail++; }
      }
      Admin.toast(`已提交 ${ok} 张${fail ? `，${fail} 张失败` : ''}`, fail ? 'error' : 'success');
      EP.sel.clear();
      epPollUntil(body, codes);
    });

    // ===== 卡牌语音：角色音色绑定 / 批量生成 / 单条生成 / 试听 =====
    $('cg-ep-voice-cfg')?.addEventListener('click', () => epOpenVoiceCfg(body));

    $('cg-ep-voice-batch')?.addEventListener('click', async () => {
      const codes = Array.from(EP.sel);
      if (!codes.length) return;
      if (!await Admin.confirm(`要批量生成 ${codes.length} 条情感的语音吗？\n勾选了几条就生成几条（勾选部分 = 这部分重新生成）；没写台词的会自动填通用台词再生成。\n产物进声音管理 → 卡牌语音。`, { danger: false })) return;
      const vb = $('cg-ep-voice-batch');
      vb.disabled = true;
      try {
        const r = await epGenVoice(codes);
        EP.sel.clear();
        EP.data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
        renderEmotionProfiles(body);
        if (r.fails.length) {
          const list = r.fails.slice(0, 3).map(f => `${f.code}：${f.error}`).join('\n');
          Admin.toast(`语音生成：${r.ok} 条成功，${r.fails.length} 条失败：\n${list}${r.fails.length > 3 ? `\n…还有 ${r.fails.length - 3} 条` : ''}\n失败的可点卡片上的 🎙 单独重试`, 'error');
        } else {
          Admin.toast(`语音生成完成：${r.ok} 条成功${r.skip ? `，${r.skip} 条没台词已跳过` : ''}，产物进声音管理 → 卡牌语音`, 'success');
        }
      } catch (e) { Admin.toast('批量语音失败：' + e.message, 'error'); vb.disabled = false; }
    });

    body.querySelectorAll('[data-vplay]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const it = items.find((x) => x.emotion_code === btn.dataset.vplay);
        if (it && it.voice_url) epPlayVoiceUrl(it.voice_url);
      });
    });

    body.querySelectorAll('[data-vone]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const code = btn.dataset.vone;
        btn.disabled = true;
        btn.textContent = '生成中…';
        try {
          const r = await epGenVoice([code]);
          EP.data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
          renderEmotionProfiles(body);
          if (r.ok) Admin.toast('语音已生成，卡片上可 🔊 试听', 'success');
          else if (r.fails.length) Admin.toast('生成失败：' + r.fails[0].error, 'error');
          else Admin.toast('这条情感还没台词，先点开编辑写一句（留空会用通用台词）', 'error');
        } catch (e2) { Admin.toast('生成失败：' + e2.message, 'error'); btn.disabled = false; btn.textContent = '🎙 语音'; }
      });
    });

    // 供调试 / 让他处能读到当前角色
    EP.curChar = ch;
  }

  // ---------- 卡牌语音生成：勾选部分 = 重新生成 ----------
  // 每行的文本来源：已写台词 > 通用台词（default_line）；台词为空时生成后会把通用台词填进该行的 line（自动填入）。
  async function epGenVoice(codes) {
    const items = (EP.data && EP.data.items) || [];
    const voice = (EP.data && EP.data.voice) || {};
    const over = epVoiceRowOverrides(voice);
    const rowCodes = [];
    const rows = [];
    for (const code of codes) {
      const it = items.find((x) => x.emotion_code === code);
      const content = (((it && it.line) || '').trim() || (it && it.default_line) || '').trim();
      if (!content) continue;
      rowCodes.push(code);
      rows.push(Object.assign({ speaker_id: Number(emoProfCharId), content }, over));
    }
    const fails = [];
    let ok = 0;
    if (rows.length) {
      const res = await Admin.post('/voice-gen/dialogue', {
        rows,
        pack_path: '卡牌语音/' + ((epChar().name || '角色' + emoProfCharId) + '').slice(0, 20),
      });
      for (const it of (res.items || [])) {
        const code = rowCodes[it.index];
        if (!it.ok) { fails.push({ code, error: it.error || '未知错误' }); continue; }
        const item = items.find((x) => x.emotion_code === code);
        const lineToSave = (((item && item.line) || '').trim() || (item && item.default_line) || '').trim();
        try {
          await Admin.put('/cardgame/emotion-profiles', {
            character_id: Number(emoProfCharId), emotion_code: code,
            line: lineToSave, voice_url: it.sound.url,
          });
          ok++;
        } catch (e2) { fails.push({ code, error: '保存语音字段失败：' + e2.message }); }
      }
    }
    return { ok, skip: codes.length - rows.length, fails };
  }

  let _epVoiceAudio = null;
  function epPlayVoiceUrl(url) {
    if (!url) return;
    if (_epVoiceAudio) { _epVoiceAudio.pause(); _epVoiceAudio = null; }
    const a = new Audio(url);
    a.onended = () => { _epVoiceAudio = null; };
    a.onerror = () => { _epVoiceAudio = null; Admin.toast('试听失败：音频无法播放（文件可能已被删除）', 'error'); };
    a.play().catch(() => Admin.toast('试听失败：浏览器阻止了自动播放', 'error'));
    _epVoiceAudio = a;
  }

  // ---------- 卡牌角色音色绑定弹窗 ----------
  async function epOpenVoiceCfg(body) {
    const groups = await cgVoiceGroups();
    const cur = (EP.data && EP.data.voice) || {};
    const engOpts = [['', '（用人物默认音色）']].concat(
      (groups || []).filter((g) => (g.voices || []).length && g.available !== false)
        .map((g) => [g.id, g.name || g.id]));
    const voiceOpts = [['', '（用人物默认音色）']].concat(
      (groups || []).filter((g) => (g.voices || []).length)
        .flatMap((g) => (g.voices || []).map((v) =>
          [v.voice_id, `${g.name || g.id} · ${v.label || v.name || v.voice_id}${v.origin === 'online' ? '（在线）' : v.origin === 'local' ? '（本地）' : ''}`])));
    const fields = [
      { k: 'engine', label: '引擎', type: 'select', options: engOpts, def: cur.engine || '' },
      { k: 'voice_id', label: '音色', type: 'select', options: voiceOpts, def: cur.voice_id || '' },
      { k: 'rate', label: '语速 %', type: 'number', def: cur.rate || '' },
      { k: 'pitch', label: '音调 %', type: 'number', def: cur.pitch || '' },
      { k: 'volume', label: '音量 %', type: 'number', def: cur.volume || '' },
    ];
    const groups2 = [{ title: '绑定这个卡牌角色的音色（空 = 用人物默认）', fields }];
    Admin.showModal(`🔊 角色音色 · ${esc(epChar().name || '')}`,
      formHtml(groups2, {
        engine: cur.engine || '', voice_id: cur.voice_id || '',
        rate: cur.rate || '', pitch: cur.pitch || '', volume: cur.volume || '',
      }),
      async () => {
        const d = readForm(groups2);
        try {
          await Admin.put('/cardgame/character-voice', {
            character_id: Number(emoProfCharId),
            tts_engine: d.engine || '',
            tts_voice_id: d.voice_id || '',
            tts_rate: String(d.rate || ''),
            tts_pitch: String(d.pitch || ''),
            tts_volume: String(d.volume || ''),
          });
          Admin.closeModal();
          Admin.toast(d.engine || d.voice_id ? '已绑定音色：批量生成语音会用它' : '已清除绑定：回落到人物默认音色', 'success');
          EP.data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
          renderEmotionProfiles(body);
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      });
  }

  async function epGenerateOne(code, extra) {
    return Admin.post('/cardgame/emotion-profiles/generate', Object.assign({
      character_id: Number(emoProfCharId),
      emotion_code: code,
    }, extra || {}));
  }

  // 出图要几十秒到几分钟，轮询等到有图就重画列表
  function epPollUntil(body, codes) {
    if (EP.polling) clearInterval(EP.polling);
    const started = Date.now();
    EP.polling = setInterval(async () => {
      if (Date.now() - started > 15 * 60 * 1000) { clearInterval(EP.polling); EP.polling = null; return; }
      if (!document.body.contains(body) || EP.editing) { clearInterval(EP.polling); EP.polling = null; return; }
      try {
        const d = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
        const items = d.items || [];
        const done = codes.every((c) => {
          const hit = items.find((x) => x.emotion_code === c);
          return hit && hit.image_url;
        });
        if (done) {
          clearInterval(EP.polling);
          EP.polling = null;
          Admin.toast('情感图已出完', 'success');
          renderEmotionProfiles(body);
        }
      } catch (_) { /* 继续等 */ }
    }, 5000);
  }

  // ---------------------- 编辑页 ----------------------
  async function renderEmotionEditor(body, code) {
    if (!EP.data || String(EP.selChar) !== String(emoProfCharId)) {
      try { EP.data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId); }
      catch (_) { EP.data = { items: [] }; }
      EP.selChar = emoProfCharId;
    }
    const it = (EP.data.items || []).find((x) => x.emotion_code === code);
    if (!it) {
      EP.editing = '';
      return renderEmotionProfiles(body);
    }
    const ch = epChar();
    EP.appOf = EP.appOf || {};
    const apps = await epLoadApps(emoProfCharId);
    const curApp = Number(it.appearance_id || 0);

    // 这个情感已经挂了哪些触发规则（来自「战斗对话」表）
    const rules = (S.dialogues || []).filter((d) => d.emotion_code === code);
    const trigOpts = (def) => (S.triggers || []).map((t) =>
      `<option value="${esc(t.key)}" ${t.key === def ? 'selected' : ''}>${esc(t.label)}</option>`).join('');

    const ruleRows = rules.length ? rules.map((r) => `
      <div class="cg-rule-row" data-rid="${r.id}">
        <select class="cg-in" data-rf="trigger">${trigOpts(r.trigger)}</select>
        <input class="cg-in" type="number" min="0" data-rf="weight" value="${Number(r.weight) || 0}" title="权重：越大越容易被抽中">
        <input class="cg-in" type="number" min="0" data-rf="cooldown_rounds" value="${Number(r.cooldown_rounds) || 0}" title="冷却回合：同一条规则几回合内不重复">
        <label class="cg-check" style="padding-top:0"><input type="checkbox" data-rf="once_per_battle" ${Number(r.once_per_battle) ? 'checked' : ''}> 每局一次</label>
        <button class="cg-rule-del" data-rdel="${r.id}" title="删除这条规则">×</button>
      </div>`).join('') : '<div class="cg-ep-tag" style="padding:8px 0">还没有任何规则挂在这个情感上 —— 战斗中它不会被自动触发，只能手动调用。</div>';

    const appRow = (id, name, sub, isDef) => `
      <div class="cg-epe-approw ${curApp === id ? 'on' : ''}" data-app="${id}">
        <span class="cg-epe-radio"></span>
        <div class="cg-epe-apptx">
          <b>${esc(name)}</b>
          <span>${esc(sub)}</span>
        </div>
        ${isDef ? '<span class="cg-ep-tag">默认</span>' : ''}
      </div>`;

    body.innerHTML = `
      <div class="cg-epe-bar">
        <button class="btn btn-outline btn-sm" id="cg-epe-back">← 返回列表</button>
        <div class="cg-epe-name">
          <span class="cg-ep-dot" style="background:${esc(it.color || '#d4af37')}"></span>
          <b>${esc(it.name)}</b>
          <span class="cg-ep-tag">${esc(ch.name || '')}</span>
          ${it.tag ? `<span class="cg-ep-tag">${esc(it.tag)}</span>` : ''}
          ${epPill(it)}
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" id="cg-epe-play" title="按当前表现样式立刻演一遍">▶ 立即演示</button>
        <button class="btn btn-outline btn-sm" id="cg-epe-save">保存</button>
        <button class="btn btn-primary btn-sm" id="cg-epe-gen">保存并生成图</button>
      </div>
      <div class="cg-epe2">
        <div class="cg-epe2-left">
          <div class="cg-epe-pv ${it.image_url ? '' : 'empty'}"
               style="${it.image_url ? `background-image:url('${esc(it.image_url)}')` : ''}">
            ${it.image_url ? '' : (it.job_id ? '出图中…' : '还没有图')}
          </div>
          <div class="cg-epe-sec">外观配置 <span>就是「人物管理」里 ${esc(ch.name || '')} 的那几套</span></div>
          <div class="cg-epe-applist">
            ${appRow(0, '默认外观', '人物档案里当前那套', !curApp)}
            ${apps.map((a) => appRow(a.id, a.name,
              (a.framing === 'half' ? '半身' : '全身') + (a.is_default ? ' · 人物默认' : ''), false)).join('')}
            ${apps.length ? '' : '<div class="cg-ep-tag" style="padding:8px 0">这个角色还没有别套外观，去「人物外观拼装」给他加几套</div>'}
          </div>
        </div>
        <div class="cg-epe2-main">
          <div class="cg-epe-sec">提示词 <span>选外观配置会自动带出它自己的提示词，可随手改 · 与「提示词与设置」无关</span></div>
          <textarea class="cg-in cg-ta" id="cg-epe-prompt" rows="9" spellcheck="false"
            placeholder="选一套外观配置，这里会自动填入那套外观的提示词">${esc(it.prompt_text || '')}</textarea>
          <div class="cg-epe-live" id="cg-epe-len"></div>

          <div class="cg-epe-2col" style="margin-top:12px">
            <div class="cg-epe-field">
              <label>动作神情 <i title="原来分开的「动作」「神情」合并成一个框，会拼在提示词末尾">?</i></label>
              <input class="cg-in" id="cg-epe-act" value="${esc(it.action_prompt || '')}"
                placeholder="例如 抱臂后仰，眼角上挑，嘴角压着笑">
            </div>
            <div class="cg-epe-field">
              <label>台词 <i title="战斗中这个角色触发该情感时说的那句话">?</i></label>
              <input class="cg-in" id="cg-epe-line" value="${esc(it.line || '')}"
                placeholder="留空 = 用通用台词：${esc(it.default_line || '（无）')}">
            </div>
          </div>
          <div class="cg-epe-voice" style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <label style="font-size:12px;color:var(--text-muted,#9aa0aa)">语音</label>
            <button class="btn btn-outline btn-sm" id="cg-epe-vgen"
              title="把这条情感的台词合成声音：没写台词就自动用通用台词，成功后台词与语音一并保存">🎙 生成语音</button>
            ${it.voice_url
              ? `<button class="btn btn-outline btn-sm" id="cg-epe-vplay" title="试听这条情感已生成的语音">🔊 试听</button><span class="cg-ep-tag">已生成语音</span>`
              : '<span class="cg-ep-tag">还没生成语音</span>'}
          </div>
          <div class="cg-epe-2col" style="margin-top:10px">
            <div class="cg-epe-field">
              <label>前置拼接 <i title="整段贴在提示词最前面（画质 / 风格锚点之类）">?</i></label>
              <input class="cg-in" id="cg-epe-prefix" value="${esc(it.prefix_prompt || '')}"
                placeholder="留空 = 不加。出图时拼在最前面，例如：杰作，最高画质">
            </div>
            <div class="cg-epe-field">
              <label>后置拼接 <i title="整段贴在提示词最后面（构图 / 光线之类）">?</i></label>
              <input class="cg-in" id="cg-epe-suffix" value="${esc(it.suffix_prompt || '')}"
                placeholder="留空 = 不加。出图时拼在最后面，例如：电影感打光，细腻质感">
            </div>
          </div>
          ${epLineIsDirty(it) ? '<div class="cg-form-desc" style="border-left-color:rgba(224,85,85,.6);color:#ff9b9b">这段台词里混进了提示词（带【人物】【服装】之类的块标记）。台词只该是角色说的那句话，建议清空后重写。</div>' : ''}

          <div class="cg-epe-sec">触发规则 <span>满足条件时，战斗里才会放出这张图 + 台词</span>
            <div style="flex:1"></div>
            <button class="btn btn-outline btn-sm" id="cg-epe-addrule">＋ 新增规则</button>
          </div>
          <div class="cg-form-desc">
            规则就是「战斗对话」表里的那套：<b>触发点</b>决定什么时候判定，<b>权重</b>决定同触发点上被抽中的概率，
            <b>冷却回合</b>保证同一句不会连着刷，勾了<b>每局一次</b>就整局只说一次。
          </div>
          <div class="cg-rule-head"><span>触发点</span><span>权重</span><span>冷却回合</span><span>限制</span><span></span></div>
          <div id="cg-epe-rules">${ruleRows}</div>
        </div>
      </div>`;

    // ---- 外观配置：点哪套就换成哪套的提示词 ----
    const q = (s) => body.querySelector(s);
    const promptEl = q('#cg-epe-prompt');
    const actEl = q('#cg-epe-act');
    const lenEl = q('#cg-epe-len');
    let appId = curApp;

    const showLen = () => {
      if (!lenEl) return;
      const n = (promptEl.value || '').length;
      lenEl.textContent = n ? `${n} 字 · 出图就用这段原文` : '提示词为空：保存后出图会退回卡面模板拼装';
    };

    const applyPrompt = (base, act, overwrite) => {
      const parts = [];
      if ((base || '').trim()) parts.push(base.trim());
      if ((act || '').trim()) parts.push('【动作神情】' + act.trim());
      const text = parts.join('\n');
      if (overwrite) promptEl.value = text;
      showLen();
    };

    const syncApp = async () => {
      const base = await epAppearancePrompt(emoProfCharId, appId);
      applyPrompt(base, actEl.value, true);
      if (!base) {
        Admin.toast('这套外观还没拼装过提示词，去「人物外观拼装」给它配一套', 'error');
      }
    };

    body.querySelectorAll('.cg-epe-approw').forEach((row) => {
      row.addEventListener('click', async () => {
        appId = Number(row.dataset.app) || 0;
        body.querySelectorAll('.cg-epe-approw').forEach((r) => r.classList.toggle('on', r === row));
        await syncApp();
      });
    });

    // 已经拉过的那套外观提示词（改动作神情时直接拿缓存拼，不再打接口）
    const cachedAppPrompt = (id) => EP.promptOf[emoProfCharId + ':' + (id || 0)] || '';
    actEl.addEventListener('input', () => applyPrompt(cachedAppPrompt(appId), actEl.value, true));

    promptEl.addEventListener('input', showLen);
    showLen();

    // 进来时：有存过的独立提示词就显示它；没有就用「外观 + 动作神情」拼一份
    if (!(it.prompt_text || '').trim()) {
      const base = await epAppearancePrompt(emoProfCharId, appId);
      applyPrompt(base, it.action_prompt || '', true);
    }

    const formValues = () => ({
      prompt_text: promptEl.value || '',
      action_prompt: (actEl.value || '').trim(),
      expression_prompt: '',
      prefix_prompt: ((q('#cg-epe-prefix') || {}).value || '').trim(),
      suffix_prompt: ((q('#cg-epe-suffix') || {}).value || '').trim(),
      line: (q('#cg-epe-line') || {}).value || '',
      appearance_id: appId,
    });

    const doSave = async () => {
      const vals = formValues();
      await Admin.put('/cardgame/emotion-profiles', Object.assign({
        character_id: Number(emoProfCharId),
        emotion_code: code,
      }, vals));
      const rows = body.querySelectorAll('.cg-rule-row');
      for (const row of rows) {
        const rid = row.dataset.rid;
        if (!rid || rid === 'new') continue;
        const f = (k) => row.querySelector(`[data-rf="${k}"]`);
        await Admin.put('/cardgame/dialogues/' + rid, {
          trigger: f('trigger').value,
          weight: Number(f('weight').value || 0),
          cooldown_rounds: Number(f('cooldown_rounds').value || 0),
          once_per_battle: f('once_per_battle').checked ? 1 : 0,
        });
      }
      for (const row of rows) {
        if (row.dataset.rid !== 'new') continue;
        const f = (k) => row.querySelector(`[data-rf="${k}"]`);
        await Admin.post('/cardgame/dialogues', {
          trigger: f('trigger').value,
          side: 'self',
          emotion_code: code,
          weight: Number(f('weight').value || 10),
          cooldown_rounds: Number(f('cooldown_rounds').value || 2),
          once_per_battle: f('once_per_battle').checked ? 1 : 0,
          enabled: 1,
        });
      }
      S.dialogues = await Admin.get('/cardgame/dialogues');
      return vals;
    };

    q('#cg-epe-save').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await doSave();
        Admin.toast('已保存', 'success');
        EP.data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
        renderEmotionEditor(body, code);
      } catch (e2) {
        Admin.toast('保存失败：' + e2.message, 'error');
        b.disabled = false;
      }
    });

    q('#cg-epe-gen').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '提交中…';
      try {
        const vals = await doSave();
        await epGenerateOne(code, vals);
        Admin.toast('已保存并加入出图队列', 'success');
        EP.editing = '';
        renderEmotionProfiles(body);
        epPollUntil(body, [code]);
      } catch (e2) {
        Admin.toast('提交失败：' + e2.message, 'error');
        b.disabled = false;
        b.textContent = '保存并生成图';
      }
    });

    q('#cg-epe-play').addEventListener('click', () => {
      epPlay({
        emotion_code: code, name: it.name, color: it.color,
        image_url: it.image_url,
        line: (q('#cg-epe-line') || {}).value || '', default_line: it.default_line,
      });
    });

    // ===== 编辑页语音：生成（自动填台词） / 试听 =====
    q('#cg-epe-vgen')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '生成中…';
      try {
        const line = ((q('#cg-epe-line') || {}).value || '').trim();
        const defaultLine = it.default_line || '';
        const content = line || defaultLine;
        if (!content) {
          Admin.toast('这条情感没有台词（连通用台词也没有），先去补一句', 'error');
          b.disabled = false; b.textContent = '🎙 生成语音';
          return;
        }
        const voice = (EP.data && EP.data.voice) || {};
        const over = epVoiceRowOverrides(voice);
        const res = await Admin.post('/voice-gen/dialogue', {
          rows: [Object.assign({ speaker_id: Number(emoProfCharId), content }, over)],
          pack_path: '卡牌语音/' + ((epChar().name || '角色' + emoProfCharId) + '').slice(0, 20),
        });
        const item = (res.items || [])[0];
        if (!item || !item.ok) {
          Admin.toast('生成失败：' + ((item && item.error) || '未知错误'), 'error');
          b.disabled = false; b.textContent = '🎙 生成语音';
          return;
        }
        // 台词留空时把通用台词填进该情感（用户要的「把对话台词也填入进去」）
        await Admin.put('/cardgame/emotion-profiles', {
          character_id: Number(emoProfCharId), emotion_code: code,
          line: line || defaultLine, voice_url: item.sound.url,
        });
        EP.data = await Admin.get('/cardgame/emotion-profiles?character_id=' + emoProfCharId);
        Admin.toast('语音已生成并保存，可试听 🔊', 'success');
        renderEmotionEditor(body, code);
      } catch (e2) {
        Admin.toast('生成失败：' + e2.message, 'error');
        b.disabled = false; b.textContent = '🎙 生成语音';
      }
    });

    q('#cg-epe-vplay')?.addEventListener('click', () => {
      if (it.voice_url) epPlayVoiceUrl(it.voice_url);
    });

    q('#cg-epe-back').addEventListener('click', () => {
      EP.editing = '';
      renderEmotionProfiles(body);
    });

    q('#cg-epe-addrule').addEventListener('click', () => {
      const host = q('#cg-epe-rules');
      const empty = host.querySelector('.cg-ep-tag');
      if (empty) empty.remove();
      const div = document.createElement('div');
      div.className = 'cg-rule-row';
      div.dataset.rid = 'new';
      div.innerHTML = `
        <select class="cg-in" data-rf="trigger">${trigOpts('round_start')}</select>
        <input class="cg-in" type="number" min="0" data-rf="weight" value="10" title="权重">
        <input class="cg-in" type="number" min="0" data-rf="cooldown_rounds" value="2" title="冷却回合">
        <label class="cg-check" style="padding-top:0"><input type="checkbox" data-rf="once_per_battle"> 每局一次</label>
        <button class="cg-rule-del" data-rdel="new" title="去掉这条（还没保存，不会影响线上）">×</button>`;
      host.appendChild(div);
      div.querySelector('[data-rdel]').addEventListener('click', () => div.remove());
    });

    body.querySelectorAll('[data-rdel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rid = btn.dataset.rdel;
        if (rid === 'new') { btn.closest('.cg-rule-row').remove(); return; }
        if (!await Admin.confirm('删掉这条触发规则？删了之后战斗里就不会再因为它放出这个情感。', { danger: true })) return;
        try {
          await Admin.del('/cardgame/dialogues/' + rid);
          S.dialogues = await Admin.get('/cardgame/dialogues');
          Admin.toast('已删除', 'success');
          renderEmotionEditor(body, code);
        } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
      });
    });
  }

  // ====================== 7.7 表现样式（情感与表现的统一排版） ======================
  // 一套样式 = 人物图 + 对话框（姓名 + 内容）那套排版参数：
  // 前后层级、人物/对话框各自的屏幕位置与大小、对话框外观、文字颜色字号。
  // 存在 localStorage（和剧情节点「参数配置」同一套做法）：纯个人排版偏好，不进数据库。
  const EMO_STYLE_KEY = 'cg_emostyle_presets_v1';
  const EMO_STYLE_CUR = 'cg_emostyle_current_v1';
  const EMO_STYLE_BASE = {
    name: '默认样式',
    stageW: 1920, stageH: 1080, bg: '#000000', bgImage: '',
    // 人物后面的背景默认透明：游戏里透出战斗场景，演示里透出那层游戏背景。
    bgTransparent: true,
    // 默认构图：人物站左半边，对话框压在右下角、并在人物前面（文字永远读得清）。
    // 人物在前面是可选玩法，但那样会盖住对话框左边一截字，不适合当默认。
    // figureBottom / boxBottom = 距屏幕底部的百分比（纵向位置，和前台的玩法完全一致）。
    figureUrl: '', figureX: 26, figureBottom: 20, figureScale: 100,
    boxX: 63, boxBottom: 3, boxW: 54, boxScale: 100,
    figureFront: false,
    boxBg: '#0d0f14', boxAlpha: 88, boxRadius: 10, boxPad: 18,
    nameColor: '#e8c46a', textColor: '#eae6da', nameSize: 18, textSize: 17,
  };

  // ---- 角色独立样式：emotion_style_chars = { [character_id]: cfg } 存在卡牌设置里 ----
  // 没有独立样式的角色自动用全局那套（emoStyleActive）。两个都读不到才退到 EMO_STYLE_BASE。
  let ES_CHARS = null;              // 服务端拉下来的缓存
  let ES_CHARS_LOADING = null;
  function emoStyleChars() {
    if (ES_CHARS) return Promise.resolve(ES_CHARS);
    if (ES_CHARS_LOADING) return ES_CHARS_LOADING;
    ES_CHARS_LOADING = Admin.get('/cardgame/settings').then((s) => {
      try { ES_CHARS = JSON.parse((s && s.emotion_style_chars) || '{}') || {}; }
      catch (_) { ES_CHARS = {}; }
      return ES_CHARS;
    }).catch(() => { ES_CHARS = {}; return ES_CHARS; });
    return ES_CHARS_LOADING;
  }
  function emoCharOverride(chId) {
    return (ES_CHARS && ES_CHARS[String(chId)]) || null;
  }
  function emoCharOverrideSave(chId, cfg) {
    const done = emoStyleChars().then(() => {
      if (cfg) ES_CHARS[String(chId)] = cfg;
      else delete ES_CHARS[String(chId)];
      return Admin.put('/cardgame/settings', {
        emotion_style_chars: JSON.stringify(ES_CHARS),
      });
    });
    return done;
  }
  // 某个角色实际生效的样式：独立定制 > 全局当前 > 默认
  function emoStyleActiveFor(chId) {
    if (chId && emoCharOverride(chId)) {
      return Object.assign({}, EMO_STYLE_BASE, emoCharOverride(chId));
    }
    return emoStyleActive();
  }

  function emoStyles() {
    try {
      const a = JSON.parse(localStorage.getItem(EMO_STYLE_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  }
  function emoStylesSave(list) {
    try { localStorage.setItem(EMO_STYLE_KEY, JSON.stringify(list)); } catch (_) {}
  }
  function emoStyleCurId() {
    try { return localStorage.getItem(EMO_STYLE_CUR) || ''; } catch (_) { return ''; }
  }
  function emoStyleUse(id) {
    try { localStorage.setItem(EMO_STYLE_CUR, id || ''); } catch (_) {}
  }
  function emoStyleActive() {
    const list = emoStyles();
    const hit = list.find((x) => x.id === emoStyleCurId());
    const cfg = Object.assign({}, EMO_STYLE_BASE, (hit && hit.cfg) || {});
    if (hit && hit.name) cfg.name = hit.name;
    return cfg;
  }
  // #rrggbb + 百分比 → rgba（对话框底色要能调透明度）
  function hexA(hex, alpha) {
    let h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    const a = Math.max(0, Math.min(100, Number(alpha == null ? 100 : alpha))) / 100;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 舞台 HTML：演示与样式预览共用一份，保证「预览 == 游戏里」。
  //
  // 关键点（之前预览和游戏不一样就坏在这里）：
  //   舞台 = 整个网页可视区，尺寸永远是 window.innerWidth × window.innerHeight，
  //   不再有「舞台宽/高」这种参数。预览时把这块 W×H 的舞台整体等比缩放到
  //   预览框里（transform: scale），所以字号、人物、对话框的相对位置与大小
  //   和游戏里 1:1 一致 —— 所见即所得。全屏编辑时倍数正好是 1。
  function emoStageHtml(s, name, line, preview) {
    const figZ = s.figureFront ? 3 : 1;
    const boxZ = s.figureFront ? 2 : 4;
    const W = Math.max(640, Math.round(window.innerWidth || 1600));
    const H = Math.max(360, Math.round(window.innerHeight || 900));
    // 背景：只要不是「背景透明」就一定要铺底色（有没有背景图都铺）。
    // 之前只在「有背景图」时才铺，所以把背景色改成白色也看不到任何变化。
    const bgLayer = s.bgTransparent ? '' : `
      <div class="cg-emd-bg" style="background-color:${esc(s.bg || '#000')};${
        s.bgImage ? `background-image:url('${esc(s.bgImage)}');background-size:cover;background-position:center;` : ''
      }"></div>`;
    const fig = s.figureUrl
      ? `<div class="cg-emd-fig" style="left:${Number(s.figureX) || 50}%;
           bottom:${Number.isFinite(Number(s.figureBottom)) ? Number(s.figureBottom) : 20}%;
           transform:translateX(-50%) scale(${(Number(s.figureScale) || 100) / 100});z-index:${figZ};
           background-image:url('${esc(s.figureUrl)}')"></div>`
      : `<div class="cg-emd-fig cg-emd-nofig" style="left:${Number(s.figureX) || 50}%;
           bottom:${Number.isFinite(Number(s.figureBottom)) ? Number(s.figureBottom) : 20}%;
           transform:translateX(-50%);z-index:${figZ}">这条情感还没有人物图<br>（游戏里也是空着，只有对话框）</div>`;
    return `
      <div class="cg-emd-fit">
        <div class="cg-emd-stage${preview ? ' is-preview' : ''}"
             data-stage-w="${W}" data-stage-h="${H}"
             style="width:${W}px;height:${H}px">
          <div class="cg-emd-gamebg"></div>
          <div class="cg-emd-veil"></div>
          ${bgLayer}
          ${fig}
          <div class="cg-emd-box" style="left:${Number(s.boxX) || 50}%;width:${Number(s.boxW) || 56}%;
               bottom:${Number.isFinite(Number(s.boxBottom)) ? Number(s.boxBottom) : 3}%;
               transform:translateX(-50%) scale(${(Number(s.boxScale) || 100) / 100});z-index:${boxZ};
               background:${hexA(s.boxBg, s.boxAlpha)};border-radius:${Number(s.boxRadius) || 0}px;
               padding:${Number(s.boxPad) || 0}px ${(Number(s.boxPad) || 0) + 6}px">
            <div class="cg-emd-name" style="color:${s.nameColor || '#e8c46a'};font-size:${Number(s.nameSize) || 18}px">${esc(name || '')}</div>
            <div class="cg-emd-text" style="color:${s.textColor || '#eae6da'};font-size:${Number(s.textSize) || 17}px">${esc(line || '（这句还没写台词）')}</div>
          </div>
        </div>
      </div>`;
  }

  // 把 W×H 的舞台等比缩到宿主容器里（保持比例，不裁切、不拉伸）。
  function fitEmoStage(host) {
    if (!host) return;
    const stage = host.querySelector('.cg-emd-stage');
    const fit = host.querySelector('.cg-emd-fit');
    if (!stage || !fit) return;
    const W = Number(stage.dataset.stageW) || 1600;
    const H = Number(stage.dataset.stageH) || 900;
    const hostW = host.clientWidth || W;
    const hostH = host.clientHeight || H;
    if (!hostW || !hostH) return;
    const k = Math.max(0.04, Math.min(hostW / W, hostH / H));
    stage.style.transform = `scale(${k})`;
    fit.style.width = Math.round(W * k) + 'px';
    fit.style.height = Math.round(H * k) + 'px';
  }

  let emoDemoEl = null;
  function emoDemoClose() {
    if (emoDemoEl) { emoDemoEl.remove(); emoDemoEl = null; }
    document.removeEventListener('keydown', emoDemoKey);
  }
  function emoDemoKey(e) { if (e.key === 'Escape') emoDemoClose(); }

  // 立刻演一遍：用某张情感图 + 台词，按当前样式铺在舞台上演出来
  function epPlay(it) {
    if (!it) return;
    const ch = epChar();
    // 这个角色有独立样式就用独立的那套，没有就用全局当前样式
    const s = emoStyleActiveFor(emoProfCharId);
    const style = Object.assign({}, s);
    if (!style.figureUrl) style.figureUrl = it.image_url || ch.portrait || '';
    // 老数据里有的「台词」其实是整段提示词（带【人物】【服装】），
    // 直接铺到对话框里会撑爆版面 —— 这种就用通用台词顶上。
    const rawLine = (it.line || '').trim();
    const showLine = (rawLine && !epLineIsDirty(it))
      ? rawLine
      : (it.default_line || rawLine || '');
    emoDemoClose();
    const el = document.createElement('div');
    el.className = 'cg-emodemo';
    el.id = 'cg-emodemo';
    el.innerHTML = `
      <div class="cg-emodemo-mask"></div>
      <div class="cg-emodemo-body">
        <div class="cg-emodemo-bar">
          <b>情感演示</b>
          <span class="cg-emodemo-tag">${esc(it.name || '')}</span>
          <span class="cg-emodemo-sub">样式：${esc(s.name || '默认样式')}</span>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm" data-emd="style">调整样式</button>
          <button class="btn btn-primary btn-sm" data-emd="close">✕ 退出演示（Esc）</button>
        </div>
        <div class="cg-emodemo-stagewrap">
          ${emoStageHtml(style, ch.name || '', showLine)}
        </div>
        <div class="cg-emodemo-tip">和游戏里的战斗演出同一套渲染 —— 这里看到什么样，游戏里就是什么样</div>
      </div>`;
    document.body.appendChild(el);
    emoDemoEl = el;
    const fitHost = el.querySelector('.cg-emodemo-stagewrap');
    fitEmoStage(fitHost);
    requestAnimationFrame(() => fitEmoStage(fitHost));

    el.querySelector('.cg-emodemo-mask').addEventListener('click', emoDemoClose);
    el.querySelector('[data-emd="close"]').addEventListener('click', emoDemoClose);
    el.querySelector('[data-emd="style"]').addEventListener('click', () => {
      emoDemoClose();
      openEmoStyle();
    });
    document.addEventListener('keydown', emoDemoKey);
  }

  // 从任意位置跳到「表现样式」页。带 chId = 为这个角色定制独立样式。
  function openEmoStyle(chId) {
    tab = 'emostyle';
    emoStyleScopeChar = chId ? String(chId) : null;
    // 独立模式要先拿到服务端里已存的独立样式，再画
    const go = () => {
      try { localStorage.setItem('cg_tab', tab); } catch (_) {}
      const tabsEl = document.getElementById('cg-tabs');
      if (tabsEl) tabsEl.querySelectorAll('.cg-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
      render();
    };
    if (chId) emoStyleChars().then(go).catch(go);
    else go();
  }

  // 非 null = 正在「为某个角色定制独立样式」；null = 编辑全局当前样式
  let emoStyleScopeChar = null;

  function renderEmoStyle(body) {
    const charScope = emoStyleScopeChar;
    const ES_UNIT = {
      figureX: ' %', figureBottom: ' %', figureScale: ' %',
      boxX: ' %', boxBottom: ' %', boxW: ' %', boxScale: ' %',
      boxRadius: ' px', boxPad: ' px', boxAlpha: ' %',
      nameSize: ' px', textSize: ' px',
    };
    let list = emoStyles();
    let curId = emoStyleCurId();
    if (!list.some((x) => x.id === curId)) curId = list.length ? list[0].id : '';
    // 本机没有本地配置，但后端可能已经存过（换台机器 / 换浏览器就会这样）。
    // 不先取一次的话，一进页面就拿默认值把线上正在用的样式覆盖掉。
    if (!curId && !renderEmoStyle._seeded) {
      renderEmoStyle._seeded = true;
      Admin.get('/cardgame/settings').then((s) => {
        const raw = (s && s.emotion_style_current) || '';
        if (!raw) return;
        let o = null;
        try { o = JSON.parse(raw); } catch (_) { return; }
        if (!o || !(Number(o.stageW) > 0)) return;
        renderEmoStyle._remote = o;
        renderEmoStyle(body);
      }).catch(() => {});
    }
    let cfg = curId
      ? Object.assign({}, EMO_STYLE_BASE, (list.find((x) => x.id === curId) || {}).cfg || {})
      : Object.assign({}, EMO_STYLE_BASE, renderEmoStyle._remote || {});
    // 角色独立模式：套他自己的样式；还没定制过就拿全局当前值当起点改
    if (charScope) {
      const ov = emoCharOverride(charScope);
      cfg = Object.assign({}, EMO_STYLE_BASE, ov || emoStyleActive());
    }

    const slider = (k, label, min, max, step, unit) => `
      <label class="cg-es-slider">
        <span class="cg-es-sl-head"><span>${label}</span><output data-out="${k}">${cfg[k]}${unit || ''}</output></span>
        <span class="cg-es-sl-row">
          <input type="range" data-es="${k}" min="${min}" max="${max}" step="${step}" value="${cfg[k]}">
          <input type="number" class="cg-es-num" data-esn="${k}" min="${min}" max="${max}" step="${step}" value="${cfg[k]}">
        </span>
      </label>`;
    const color = (k, label) => `
      <label class="cg-es-color"><span>${label}</span>
        <input type="color" data-es="${k}" value="${cfg[k]}">
        <input class="cg-in cg-es-hex" type="text" data-es2="${k}" value="${cfg[k]}">
      </label>`;

    const scopeCh = charScope ? epChar() : null;
    const draw = () => {
      body.innerHTML = `
        <div class="cg-bar">
          <span class="cg-stat">${charScope ? '角色独立样式 · ' + esc((scopeCh && scopeCh.name) || '') : '表现样式'}</span>
          <span class="cg-stat" style="color:var(--text-muted)">人物图 + 对话框（姓名 + 内容）的统一排版</span>
          <div style="flex:1"></div>
          <span class="cg-stat" id="cg-es-state">${charScope
            ? (emoCharOverride(charScope) ? '这个角色正在用<b>独立样式</b>' : '还没有独立样式（沿用全局，下面一改就是给他定制的）')
            : (curId ? '正在编辑：' + esc((list.find((x) => x.id === curId) || {}).name || '') : '未选择配置（改的是临时参数）')}</span>
        </div>
        <div class="cg-hintbar">
          ${charScope
            ? `给 <b>${esc((scopeCh && scopeCh.name) || '')}</b> 单独调一套摆法：想突出某个角色的表情就给他定制。` +
              '保存后战斗里<b>只有这个角色</b>用这套；没定制的角色自动按全局样式。'
            : '这套样式管的是「情感与表现」里<b>怎么摆</b>：人物图与对话框谁在前、各自在屏幕上的位置与大小、对话框底色与文字。\n' +
              '配置可以<b>新建 / 改名 / 保存 / 删除</b>，选中的那套就是「▶ 立即演示」用的样式。'}
        </div>
        <div class="cg-es-wrap">
          <div class="cg-es-side">
            ${charScope ? `
            <div class="cg-es-sidehead">独立样式</div>
            <div class="cg-es-store">
              <div class="cg-es-storebtns">
                <button class="btn btn-outline btn-sm" data-esact="refill" title="丢掉当前改动，重新按全局样式的当前值填">↩ 按全局重填</button>
                <button class="btn btn-primary btn-sm" data-esact="savechar" title="把当前参数存成这个角色专属的样式">💾 保存为${esc((scopeCh && scopeCh.name) || '')}的独立样式</button>
                <button class="btn btn-outline btn-sm" data-esact="clearchar" title="删掉独立样式，这个角色恢复跟随全局" style="color:var(--red);border-color:rgba(200,80,80,.5)">🗑 清除独立样式</button>
              </div>
            </div>` : `
            <div class="cg-es-sidehead">样式配置</div>
            <div class="cg-es-store">
              <select class="cg-in" id="cg-es-sel">
                <option value="">-- 选择一套已存配置 --</option>
                ${list.map((x) => `<option value="${esc(x.id)}" ${x.id === curId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
              </select>
              <div class="cg-es-storebtns">
                <button class="btn btn-outline btn-sm" data-esact="new" title="用当前参数存一套新配置">＋ 新建</button>
                <button class="btn btn-outline btn-sm" data-esact="rename" title="给选中的这套改名" ${curId ? '' : 'disabled'}>✎ 改名</button>
                <button class="btn btn-outline btn-sm" data-esact="save" title="用当前参数覆盖选中的这套" ${curId ? '' : 'disabled'}>💾 保存</button>
                <button class="btn btn-outline btn-sm" data-esact="del" title="删掉选中的这套" ${curId ? '' : 'disabled'} style="color:var(--red);border-color:rgba(200,80,80,.5)">🗑 删除</button>
              </div>
            </div>`}

            <div class="cg-es-sidehead">舞台背景（舞台＝网页全屏，没有宽高可调）</div>
            <div class="cg-es-rows">
              <div class="cg-hintbar" style="margin:0">
                舞台就是<b>游戏那一整屏</b>（玩家窗口的可视区），永远铺满、不需要也不能调宽高。
                右边预览会把这一整屏<b>等比缩小</b>给你看，点「⛶ 全屏编辑」就是 1:1 原尺寸。
                人物和对话框各有<b>水平 / 纵向两组位置</b>：纵向是「距屏幕底部的百分比」，
                调大 = 往上抬，调小 = 往下沉（负数 = 沉到屏幕外，可以做半截入镜的效果）。
              </div>
              <label class="cg-check" style="padding:2px 0">
                <input type="checkbox" data-es="bgTransparent" ${cfg.bgTransparent ? 'checked' : ''}>
                背景透明（勾上 = 人物后面不留底色，直接透出战斗场景。<b>想用下面的背景色 / 背景图，必须先取消勾选</b>；
                改背景色或填背景图时会自动帮你取消勾选）
              </label>
              ${color('bg', '背景色')}
              <label class="cg-es-text"><span>背景图（可空）</span>
                <input class="cg-in" data-es="bgImage" value="${esc(cfg.bgImage || '')}" placeholder="/images/xxx.png"></label>
            </div>

            <div class="cg-es-sidehead">人物</div>
            <div class="cg-es-rows">
              <label class="cg-es-text"><span>人物图（留空 = 用这张情感图）</span>
                <input class="cg-in" data-es="figureUrl" value="${esc(cfg.figureUrl || '')}" placeholder="留空自动用角色情感图"></label>
              ${slider('figureX', '水平位置（左/右，可越出屏幕）', -150, 250, 0.5, ' %')}
              ${slider('figureBottom', '纵向位置（距屏幕底部）', -40, 95, 0.5, ' %')}
              ${slider('figureScale', '大小', 10, 400, 1, ' %')}
            </div>

            <div class="cg-es-sidehead">对话框</div>
            <div class="cg-es-rows">
              ${slider('boxX', '水平位置（左/右，可越出屏幕）', -150, 250, 0.5, ' %')}
              ${slider('boxBottom', '纵向位置（距屏幕底部）', -40, 95, 0.5, ' %')}
              ${slider('boxW', '宽度', 5, 200, 1, ' %')}
              ${slider('boxScale', '大小', 10, 400, 1, ' %')}
              ${slider('boxRadius', '圆角', 0, 60, 1, ' px')}
              ${slider('boxPad', '内边距', 0, 80, 1, ' px')}
              ${color('boxBg', '底色')}
              ${slider('boxAlpha', '不透明度', 0, 100, 1, ' %')}
            </div>

            <div class="cg-es-sidehead">文字</div>
            <div class="cg-es-rows">
              ${color('nameColor', '姓名颜色')}
              ${slider('nameSize', '姓名字号', 8, 80, 1, ' px')}
              ${color('textColor', '正文字色')}
              ${slider('textSize', '正文字号', 8, 80, 1, ' px')}
            </div>

            <div class="cg-es-sidehead">前后关系</div>
            <div class="cg-es-rows">
              <label class="cg-check" style="padding:2px 0">
                <input type="checkbox" data-es="figureFront" ${cfg.figureFront ? 'checked' : ''}>
                人物压在对话框<b>前面</b>（取消勾选 = 对话框盖住人物）
              </label>
            </div>
          </div>
          <div class="cg-es-main">
            <div class="cg-es-preview">
              <div class="cg-es-preview-head">
                <span>实时预览</span>
                <span class="cg-es-scalehint" id="cg-es-subject"></span>
                <span class="cg-es-scalehint" id="cg-es-scalehint"></span>
                <button class="btn btn-outline btn-sm" id="cg-es-fs" title="全屏编辑：预览铺满窗口（Esc 或右上角退出按钮可退出）">⛶ 全屏编辑</button>
              </div>
              <div class="cg-es-stagebox" id="cg-es-stagebox"></div>
            </div>
          </div>
        </div>`;
      bind();
      paintStage();
    };

    // 只存在 localStorage 的话，这套「统一显示样式」就只在这台机器的这个浏览器里生效，
    // 前台游戏演出读不到。所以每次改完都顺手推一份到后端设置：
    //   emotion_style_current / emotion_style_presets
    // 前台 loadCatalog() 能直接拿到，游戏里演出就是这里调出来的样子。
    let pushTimer = null;
    const pushServer = () => {
      // 角色独立样式不自动推：滑杆拖一下就写库太吵，只有点「保存为独立样式」才落库
      if (charScope) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = null;
        Admin.put('/cardgame/settings', {
          emotion_style_current: JSON.stringify(Object.assign({}, cfg)),
          emotion_style_presets: JSON.stringify(emoStyles()),
        }).catch(() => { /* 落库失败不挡本地编辑 */ });
      }, 600);
    };

    const paintStage = () => {
      pushServer();
      const box = document.getElementById('cg-es-stagebox');
      if (!box) return;
      const ch = epChar();
      const items = (EP.data && EP.data.items) || [];
      // 优先用「有图且台词干净」的那条当样本，否则版面会被一整段提示词撑爆
      const sample = items.find((i) => i.image_url && (i.line || '').trim() && !epLineIsDirty(i))
        || items.find((i) => i.image_url)
        || {};
      const clean = (i) => {
        const raw = (i.line || '').trim();
        return (raw && !epLineIsDirty(i)) ? raw : (i.default_line || '');
      };
      const s = Object.assign({}, cfg);
      // 预览要有人物图，否则看到的是一块占位框，和游戏里差得远。
      // 优先级：样式里指定的人物图 > 情感图 > 当前角色立绘 > 后台第一个有立绘的人物（懒加载一次）
      // 人物图取值必须和游戏里逐条一致（cardbattle.js showEmotionStyled）：
      //   样式里指定的人物图 > 这条情感自己的图 > 当前角色的立绘
      // 都拿不到时才临时借一个「示例人物」的立绘，并且在上方明确标出来是谁 ——
      // 以前是默默借一个，于是预览里永远站着人、游戏里却是空的，看着像两套渲染。
      const keep = renderEmoStyle._figFallback;
      const fig = s.figureUrl || sample.image_url || ch.portrait || keep || '';
      const subjectEl = document.getElementById('cg-es-subject');
      if (subjectEl) {
        if (s.figureUrl) subjectEl.textContent = '人物：样式里指定的图';
        else if (sample.image_url) subjectEl.textContent = '人物：这条情感自己的图';
        else if (ch.portrait) subjectEl.textContent = '人物：' + (ch.name || '当前角色') + ' 的立绘';
        else if (keep) subjectEl.textContent = '人物：示例（借 ' + (renderEmoStyle._figName || '其他角色') + ' 的立绘，仅用于对位置）';
        else subjectEl.textContent = '人物：这条情感还没有图（游戏里空着）';
      }
      if (!fig && !renderEmoStyle._figLoading) {
        renderEmoStyle._figLoading = true;
        Admin.get('/cardgame/characters').then((list) => {
          const withPortrait = (list || []).find((c) => c.portrait);
          renderEmoStyle._figLoading = false;
          if (withPortrait && withPortrait.portrait) {
            renderEmoStyle._figFallback = withPortrait.portrait;
            renderEmoStyle._figName = withPortrait.name || '';
            if (document.getElementById('cg-es-stagebox')) paintStage();
          }
        }).catch(() => { renderEmoStyle._figLoading = false; });
      }
      // 没有人物图就如实显示占位框：游戏里这一刻也是这样（只剩对话框），
      // 预览不该替玩家「美化」出一个其实不存在的人。
      // 舞台按「当前窗口可视区」的真实像素渲染，再整体缩放到预览框里 ——
      // 这样字号 / 人物 / 对话框的相对位置跟游戏里逐像素一致。
      cfg.stageW = Math.round(window.innerWidth || 1600);
      cfg.stageH = Math.round(window.innerHeight || 900);
      box.innerHTML = emoStageHtml(
        Object.assign({}, s, { figureUrl: fig }),
        ch.name || '角色名',
        clean(sample) || '这里是这个角色此刻说的话。',
        true
      );
      fitStage();
    };

    // 等比缩放舞台到预览框；全屏编辑时预览框 = 整个窗口，倍数正好 1。
    const fitStage = () => {
      const box = document.getElementById('cg-es-stagebox');
      const hint = document.getElementById('cg-es-scalehint');
      if (!box) return;
      const wrap = box.closest('.cg-es-wrap');
      const fs = !!(wrap && wrap.classList.contains('fs'));
      fitEmoStage(box);
      if (hint) {
        const k = box.querySelector('.cg-emd-fit');
        const pct = k && window.innerWidth
          ? Math.round((parseFloat(k.style.width) / window.innerWidth) * 100) : 100;
        hint.textContent = fs
          ? '全屏编辑 · 1:1 与游戏渲染完全一致（Esc 退出）'
          : `与游戏渲染一致 · 预览缩放 ${pct}%（点「⛶ 全屏编辑」看 1:1）`;
      }
    };

    function bind() {
      const setVal = (k, v) => {
        cfg[k] = v;
        const out = document.querySelector(`[data-out="${k}"]`);
        if (out) out.textContent = v + (ES_UNIT[k] || '');
        const num = body.querySelector(`[data-esn="${k}"]`);
        if (num && document.activeElement !== num) num.value = v;
        paintStage();
      };
      body.querySelectorAll('[data-es]').forEach((el) => {
        const k = el.dataset.es;
        const handler = () => {
          if (el.type === 'checkbox') { cfg[k] = el.checked; paintStage(); return; }
          if (el.type === 'range') { setVal(k, Number(el.value)); return; }
          cfg[k] = el.value;
          // 改了背景色 / 背景图就自动取消「背景透明」，否则这个改动根本不会显示出来
          // （之前「把背景改成白色完全没变化」就是这个原因）
          if ((k === 'bg' || k === 'bgImage') && String(el.value || '').trim()) {
            cfg.bgTransparent = false;
            const chk = body.querySelector('[data-es="bgTransparent"]');
            if (chk) chk.checked = false;
          }
          if (k === 'bg' || k === 'boxBg' || k === 'nameColor' || k === 'textColor') {
            const twin = body.querySelector(`[data-es2="${k}"]`);
            if (twin && twin !== el) twin.value = el.value;
          }
          paintStage();
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      });
      body.querySelectorAll('[data-es2]').forEach((el) => {
        const k = el.dataset.es2;
        el.addEventListener('change', () => {
          const v = (el.value || '').trim();
          if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) { Admin.toast('颜色要写成 #aabbcc', 'error'); return; }
          cfg[k] = v;
          if ((k === 'bg' || k === 'bgImage') && v) {
            cfg.bgTransparent = false;
            const chk = body.querySelector('[data-es="bgTransparent"]');
            if (chk) chk.checked = false;
          }
          const twin = body.querySelector(`[data-es="${k}"]`);
          if (twin) twin.value = v;
          paintStage();
        });
      });

      // 数值输入框：可以直接键入精确位置（越出屏幕也能打），回车/失焦生效
      body.querySelectorAll('[data-esn]').forEach((el) => {
        el.addEventListener('change', () => {
          const k = el.dataset.esn;
          const v = Number(el.value);
          if (Number.isNaN(v)) return;
          const r = body.querySelector(`[data-es="${k}"]`);
          if (r) {
            const clamped = Math.max(Number(r.min), Math.min(Number(r.max), v));
            r.value = clamped;
            setVal(k, clamped);
          } else {
            setVal(k, v);
          }
        });
      });

      // 全屏编辑：舞台按窗口真实尺寸 1:1 铺满整屏（不是把预览框放大），
      // 右侧参数面板改成浮动层，可一键收起看完整的「游戏画面」。
      // 注意：滑杆一动就会重画整个表单，这里所有状态都按 id 现查现用，
      // 不缓存节点引用，避免旧闭包删不掉新按钮。
      const setFs = (on) => {
        const wrap = document.querySelector('.cg-es-wrap');
        if (!wrap) return;
        wrap.classList.toggle('fs', on);
        if (!on) wrap.classList.remove('hide-side');
        const btn = document.getElementById('cg-es-fs');
        if (btn) btn.textContent = on ? '✕ 退出全屏' : '⛶ 全屏编辑';
        let chip = document.getElementById('cg-es-fsexit');
        if (on && !chip) {
          chip = document.createElement('button');
          chip.id = 'cg-es-fsexit';
          chip.className = 'cg-es-fsexit';
          chip.textContent = '✕ 退出全屏编辑（Esc）';
          chip.addEventListener('click', () => setFs(false));
          document.body.appendChild(chip);
        }
        if (chip && !on) chip.remove();
        let toggle = document.getElementById('cg-es-fsside');
        if (on && !toggle) {
          toggle = document.createElement('button');
          toggle.id = 'cg-es-fsside';
          toggle.className = 'cg-es-fsside';
          toggle.textContent = '☰ 隐藏面板';
          toggle.addEventListener('click', () => {
            const w = document.querySelector('.cg-es-wrap.fs');
            if (!w) return;
            const hidden = w.classList.toggle('hide-side');
            toggle.textContent = hidden ? '☰ 显示面板' : '☰ 隐藏面板';
            fitStage();
          });
          document.body.appendChild(toggle);
        }
        if (toggle && !on) toggle.remove();
        requestAnimationFrame(() => fitStage());
        setTimeout(fitStage, 60);
      };
      const fsBtn = document.getElementById('cg-es-fs');
      if (fsBtn) fsBtn.addEventListener('click', () => {
        const wrap = document.querySelector('.cg-es-wrap');
        if (wrap) setFs(!wrap.classList.contains('fs'));
      });
      // Esc 退出全屏编辑（只在本页签处于全屏态时响应）；只挂一次，处理函数全走 DOM 查询
      if (!renderEmoStyle._fsKeyBound) {
        renderEmoStyle._fsKeyBound = true;
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') return;
          if (document.querySelector('.cg-es-wrap.fs')) setFs(false);
        });
      }
      // 窗口尺寸一变，舞台可用的可视区就变了：预览倍数、全屏 1:1 都要跟着重算
      if (!renderEmoStyle._resizeBound) {
        renderEmoStyle._resizeBound = true;
        window.addEventListener('resize', () => {
          const box = document.getElementById('cg-es-stagebox');
          const stage = box && box.querySelector('.cg-emd-stage');
          if (stage) {
            const W = Math.round(window.innerWidth || 1600);
            const H = Math.round(window.innerHeight || 900);
            stage.dataset.stageW = W;
            stage.dataset.stageH = H;
            stage.style.width = W + 'px';
            stage.style.height = H + 'px';
          }
          if (box && box.querySelector('.cg-emd-fit')) fitEmoStage(box);
        });
      }

      const sel = document.getElementById('cg-es-sel');
      // 角色独立样式模式下没有「选择已存配置」的下拉
      if (sel) sel.addEventListener('change', () => {
        curId = sel.value;
        emoStyleUse(curId);
        const hit = list.find((x) => x.id === curId);
        cfg = hit ? Object.assign({}, EMO_STYLE_BASE, hit.cfg || {}) : Object.assign({}, EMO_STYLE_BASE);
        draw();
        Admin.toast('已切换到「' + ((hit && hit.name) || '默认样式') + '」', 'success');
      });

      body.querySelectorAll('[data-esact]').forEach((b) => {
        b.addEventListener('click', async () => {
          const act = b.dataset.esact;
          // ---- 角色独立样式的三个动作（全局模式下没有这些按钮） ----
          if (act === 'savechar') {
            b.disabled = true;
            try {
              const save = Object.assign({}, cfg);
              delete save.name;
              await emoCharOverrideSave(charScope, save);
              ES_CHARS[String(charScope)] = save;
              Admin.toast('已保存为这个角色的独立样式，战斗里只有他用这套', 'success');
              draw();
            } catch (e) {
              Admin.toast('保存失败：' + e.message, 'error');
            }
            b.disabled = false;
            return;
          }
          if (act === 'clearchar') {
            if (!emoCharOverride(charScope)) { Admin.toast('这个角色还没有独立样式', 'error'); return; }
            if (!await Admin.confirm('删掉这个角色的独立样式？删了就恢复跟随全局样式。')) return;
            try {
              await emoCharOverrideSave(charScope, null);
              Admin.toast('已清除，这个角色恢复跟随全局样式', 'success');
              cfg = Object.assign({}, EMO_STYLE_BASE, emoStyleActive());
              draw();
            } catch (e) {
              Admin.toast('清除失败：' + e.message, 'error');
            }
            return;
          }
          if (act === 'refill') {
            cfg = Object.assign({}, EMO_STYLE_BASE, emoStyleActive());
            draw();
            Admin.toast('已按全局样式当前值重新填入', 'success');
            return;
          }
          list = emoStyles();
          const hit = list.find((x) => x.id === curId);
          if (act === 'new') {
            const name = await Admin.prompt('新建样式配置', { label: '给这套样式起个名字（例如：右侧半身 / 左侧特写）', value: '' });
            if (!name) return;
            const item = { id: 's' + Date.now().toString(36), name: name, cfg: Object.assign({}, cfg) };
            delete item.cfg.name;
            list.push(item);
            emoStylesSave(list);
            curId = item.id;
            emoStyleUse(curId);
            draw();
            Admin.toast('已存为「' + name + '」', 'success');
            return;
          }
          if (!hit) { Admin.toast('先选一套配置', 'error'); return; }
          if (act === 'rename') {
            const name = await Admin.prompt('改名', { label: '改成什么名字：', value: hit.name });
            if (!name) return;
            hit.name = name;
            emoStylesSave(list);
            draw();
            Admin.toast('已改名', 'success');
            return;
          }
          if (act === 'save') {
            hit.cfg = Object.assign({}, cfg);
            delete hit.cfg.name;
            // 顺手把选中态固定下来：否则下次进页面又会退回第一套
            emoStylesSave(list);
            draw();
            Admin.toast('已把当前参数存进「' + hit.name + '」', 'success');
            return;
          }
          if (act === 'del') {
            if (!await Admin.confirm(`删掉「${hit.name}」这套样式？删了就找不回来了。`)) return;
            emoStylesSave(list.filter((x) => x.id !== curId));
            curId = '';
            emoStyleUse('');
            list = emoStyles();
            cfg = Object.assign({}, EMO_STYLE_BASE);
            draw();
            Admin.toast('已删除', 'success');
          }
        });
      });
    }

    draw();
    // 首帧宽度要等布局落定才量得准，这里补一次
    requestAnimationFrame(() => fitStage());
    setTimeout(fitStage, 120);
    // 窗口尺寸变化时重新适配预览
    const onResize = () => fitStage();
    window.addEventListener('resize', onResize);
    // 离开页面后解绑（body 被换掉时 clientWidth 取不到，顺手清掉监听）
    const mo = new MutationObserver(() => {
      if (!document.body.contains(body)) { window.removeEventListener('resize', onResize); mo.disconnect(); }
    });
    mo.observe(document.getElementById('content-area') || document.body, { childList: true });
  }

  // ====================== 8. 战斗规则 ======================
  function renderRules(body) {
    const rules = [
      ['胜负', '先把对方英雄 HP 打到 0 者胜。伤害先扣 DEF，再扣 HP；有守卫时守卫先挡刀，溢出伤害继续传导。'],
      ['法力', '第 1 回合 2 费 → 3 → 4，第 4 回合起 5 费封顶。每回合回满，不累计。'],
      ['抽牌', '起手 5 张，每回合抽 1；手牌上限 7，超出弃置；牌库空后每抽 1 张掉 3 血。'],
      ['先手', '每回合比 SPD，高者先动；同速由系统判定并写进战报。'],
      ['暴击', '掷 1~100 ≤ 暴击率即双倍伤害；单次暴击最终伤害 ≥5 时本回合额外抽 1 张（每回合限 1 次）。'],
      ['守卫', '有守卫时伤害必须先打守卫，溢出部分继续传导；「清场」每回合限 1 张。'],
      ['负面', '降攻一次性；降防/降速持续到目标下回合结束且不叠加（只刷新）；降费作用于对手下回合，保底 1 费。'],
      ['偷牌', '复制类每回合 1 次；夺心偷来的牌本回合锁定，下回合才可用。'],
    ];
    body.innerHTML = `
      <div class="cg-grid2">
        ${rules.map(([k, v]) => `
          <div class="cg-panel">
            <div class="cg-panel-head"><b>${esc(k)}</b></div>
            <div class="cg-p">${esc(v)}</div>
          </div>`).join('')}
      </div>
      <div class="cg-block">
        <div class="cg-block-head"><b>对话触发点</b><span>战斗对话规则里可选的全部触发点</span></div>
        <table class="cg-table">
          <thead><tr><th style="width:180px">触发点</th><th style="width:140px">名称</th><th>触发时机</th></tr></thead>
          <tbody>
            ${S.triggers.map((t) => `
              <tr><td><code>${esc(t.key)}</code></td><td>${esc(t.label)}</td><td>${esc(t.desc)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ====================== 启动 ======================
  // 顶栏那个红色的「对战演示」图标靠这个切分页：
  // 已经在卡牌系统里时直接换 tab，不用整页重进。
  window.CardGameTabs = {
    goto(t) {
      if (!TABS.some(([k]) => k === t)) return false;
      tab = t;
      try { localStorage.setItem('cg_tab', t); } catch (_) {}
      container.querySelectorAll('.cg-tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
      render();
      return true;
    },
    current: () => tab,
  };

  mountShell();
  await render();
});
