// ========== 提示词浮窗（全局置顶 / 可拖动 / 按光标插入 / 三个选项卡） ==========
// 用途：任何页面、任何能输入内容的框，点开浮窗选一条内容 → 直接插到光标位置。
//
// 三个来源合并成一个浮窗（以前拆成「提示词 / 人物 / 动作表情」三个按钮太乱）：
//   1) 提示词  —— 提示词管理里的自定义提示词（/api/comfyui/prompt-presets）
//   2) 人物    —— 人物管理里的人物，选人 + 选外观 → 用外观拼装生成人物提示词
//   3) 动作表情 —— 人物拼装的动作表情库（/api/poses/library），每条自带中文描述
//
// 关键设计：
//   1. 不带遮罩，不做成模态框（周围不会变黑），只是 body 上的一个 fixed 浮层；
//   2. 标题栏可拖动，位置记在 localStorage；
//   3. 打开时快照「当前聚焦的可输入元素 + 光标位置」，之后点击内容按快照插入，
//      所以即使中途在浮窗里打字搜索，也仍然插回原来那个光标处；
//   4. 没有可用输入框时退化为「复制到剪贴板」，不静默失败。
(function () {
  if (window.PromptPad) return;

  const API_SNIPPET = '/comfyui/prompt-presets';
  const API_CHARS = '/comic/characters';
  const API_POSES = '/poses/library';
  const PAD_ID = 'ppad';
  const LS_POS = 'ppad.pos';
  const LS_TAB = 'ppad.tab';
  const TTL = 60 * 1000;          // 列表缓存 60s

  let el = null, listEl = null, qEl = null, foldEl = null, hintEl = null, tgtEl = null, btnEl = null;
  let tabEls = [];
  let tab = 'snippet';
  let folder = '';                // 提示词分类 / 动作表情分类
  let kw = '';
  let snap = null;                // { el, start, end } 或 { el, range }
  let lastEditable = null;        // 最后一次聚焦过的可输入元素
  let onPick = null;              // 选中某条内容后的回调（漫画版本弹窗用）

  // 三类数据各存一份（互不干扰，切选项卡不用重新拉）
  const store = {
    snippet: { data: null, at: 0 },
    char: { data: null, at: 0 },
    pose: { data: null, at: 0 },
  };
  // 人物：外观列表 / 提示词各自缓存，避免每点一次都请求后端
  const appCache = new Map();       // cid -> appearance items
  const promptCache = new Map();    // 'cid:aid' -> 人物提示词文本
  const charOpenApp = {};           // cid -> 当前选中的 appearance id（0 = 人物默认外观）
  let charOpen = null;              // 当前展开的人物 id

  const TAB_META = {
    snippet: { ph: '搜索名称 / 内容…', hint: '点击提示词插入到光标所在位置' },
    char: { ph: '搜索人物名 / 称号…', hint: '点人物展开 → 选外观 → 点「插入人物提示词」' },
    pose: { ph: '搜索动作 / 表情描述…', hint: '点击动作表情插入到光标所在位置' },
  };

  /* ---------- 工具 ---------- */
  const inPad = (n) => !!(n && n.closest && n.closest('#' + PAD_ID));

  function isEditable(n) {
    if (!n || n.nodeType !== 1) return false;
    if (n.tagName === 'TEXTAREA') return !n.disabled && !n.readOnly;
    if (n.tagName === 'INPUT') {
      const t = (n.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel', 'email', 'number', 'password'].includes(t) && !n.disabled && !n.readOnly;
    }
    return !!n.isContentEditable;
  }

  function labelOf(n) {
    if (!n) return '';
    const ph = n.getAttribute && (n.getAttribute('placeholder') || n.getAttribute('aria-label'));
    if (ph) return ph.slice(0, 12);
    if (n.tagName === 'TEXTAREA') return '多行输入框';
    if (n.tagName === 'INPUT') return '输入框';
    return '可编辑区域';
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 记住「最后一次把光标放进去的输入框」。
  // 光靠 focusin 不够稳（无头浏览器 / 页面未获得焦点时根本不发焦点事件），
  // 所以 pointerdown / keydown / input 都记一遍；浮窗开着时换输入框会重新定位光标。
  const remember = (e) => {
    const t = e.target;
    if (!isEditable(t) || inPad(t)) return;
    lastEditable = t;
    if (isOpen()) {
      setTimeout(() => {
        if (!document.contains(t)) return;
        snap = capture(t);
        paintTarget();
      }, 0);
    }
  };
  ['pointerdown', 'keydown', 'input', 'focusin'].forEach((ev) => document.addEventListener(ev, remember, true));

  /* ---------- 光标快照 / 插入 ---------- */
  function capture(target) {
    let n = target;
    if (!isEditable(n)) n = (isEditable(document.activeElement) && !inPad(document.activeElement))
      ? document.activeElement
      : lastEditable;
    if (!n || !document.contains(n) || !isEditable(n)) return null;
    if (n.isContentEditable) {
      const sel = window.getSelection();
      const range = (sel && sel.rangeCount && n.contains(sel.anchorNode)) ? sel.getRangeAt(0).cloneRange() : null;
      return { el: n, range };
    }
    let s = null, e = null;
    try { s = n.selectionStart; e = n.selectionEnd; } catch (_) { /* number 之类不支持 */ }
    if (s == null) s = e = (n.value || '').length;
    return { el: n, start: s, end: e };
  }

  function copyText(t) {
    try { navigator.clipboard.writeText(t); } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (__) {}
      ta.remove();
    }
  }

  /** 返回 'inserted' | 'copied' */
  function insert(text) {
    // 快照失效（输入框被重渲染 / 页面切过）时再抓一次，抓不到才退化成复制
    if (!snap || !document.contains(snap.el)) snap = capture(null);
    const sn = snap;
    if (!sn || !document.contains(sn.el)) { copyText(text); return 'copied'; }
    const n = sn.el;
    // 多行/富文本框：自动补一个中文逗号分隔，避免两条提示词粘成一串
    const multi = n.isContentEditable || n.tagName === 'TEXTAREA';
    if (n.isContentEditable) {
      n.focus({ preventScroll: true });
      if (sn.range) {
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(sn.range);
      }
      document.execCommand('insertText', false, text);
      const sel = window.getSelection();
      if (sel && sel.rangeCount) sn.range = sel.getRangeAt(0).cloneRange();
      n.dispatchEvent(new Event('input', { bubbles: true }));
      return 'inserted';
    }
    const val = n.value || '';
    const s = Math.min(sn.start, val.length), e = Math.min(sn.end, val.length);
    const before = val.slice(0, s);
    const sep = (multi && before && !/[，,、\s\n]$/.test(before)) ? '，' : '';
    const ins = sep + text;
    n.value = before + ins + val.slice(e);
    const pos = before.length + ins.length;
    sn.start = sn.end = pos;                 // 连续插入时接着往后走
    n.focus({ preventScroll: true });
    try { n.setSelectionRange(pos, pos); } catch (_) {}
    n.dispatchEvent(new Event('input', { bubbles: true }));
    return 'inserted';
  }

  /** 统一的「取一条内容 → 插入 → 提示」，三个选项卡共用 */
  function pick(text, label) {
    const t = String(text || '').trim();
    if (!t) { Admin.toast('这条内容还是空的', 'error'); return; }
    const r = insert(t);
    if (r === 'copied') Admin.toast('没有找到可插入的输入框，已复制到剪贴板', 'info');
    else Admin.toast('已插入：' + (label || '内容'), 'success');
    if (typeof onPick === 'function') onPick({ text: t, name: label });
    paintTarget();
  }

  /* ---------- 数据 ---------- */
  async function load(kind, force) {
    const s = store[kind];
    if (!force && s.data && Date.now() - s.at < TTL) return s.data;
    let d = s.data;
    try {
      if (kind === 'snippet') {
        const r = await Admin.get(API_SNIPPET);
        d = Array.isArray(r) ? r : [];
      } else if (kind === 'char') {
        const r = await Admin.get(API_CHARS);
        d = Array.isArray(r) ? r : [];
      } else {
        const r = await Admin.get(API_POSES);
        d = { categories: (r && r.categories) || [], poses: (r && r.poses) || [] };
      }
    } catch (_) { /* 拉不到就沿用旧数据 */ }
    s.data = d;
    s.at = Date.now();
    return d;
  }

  /** 人物外观列表（带 appearance_json，给生成提示词用） */
  async function charAppearances(cid) {
    if (appCache.has(cid)) return appCache.get(cid);
    let items = [];
    try {
      const r = await Admin.get(`/characters/${cid}/appearances`);
      items = (r && r.items) || [];
    } catch (_) { items = []; }
    appCache.set(cid, items);
    return items;
  }

  /** 由「人物 + 外观」生成人物提示词（复用人物拼装那套生成器） */
  async function charPromptText(cid, app) {
    const aid = app ? app.id : 0;
    const key = cid + ':' + aid;
    if (promptCache.has(key)) return promptCache.get(key);
    let text = '';
    try {
      const body = app && app.appearance ? { appearance: app.appearance } : {};
      const r = await Admin.post(`/characters/${cid}/appearance/prompt`, body);
      const p = (r && r.prompt) || {};
      text = p.posCn || p.cn || '';
    } catch (_) { text = ''; }
    promptCache.set(key, text);
    return text;
  }

  /* ---------- 渲染：分类标签 ---------- */
  function snippetFolders() {
    const out = [];
    ((store.snippet.data) || []).forEach((s) => {
      const f = s.folder || '未分类';
      if (!out.includes(f)) out.push(f);
    });
    return out;
  }

  function paintFolds() {
    if (!foldEl) return;
    if (tab === 'char') { foldEl.innerHTML = ''; foldEl.style.display = 'none'; return; }
    foldEl.style.display = '';
    if (tab === 'snippet') {
      const all = (store.snippet.data || []).length;
      foldEl.innerHTML = [`<button class="ppad-fb ${folder === '' ? 'on' : ''}" data-f="">全部 ${all}</button>`]
        .concat(snippetFolders().map((f) => `<button class="ppad-fb ${folder === f ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}</button>`))
        .join('');
    } else {
      const cats = (store.pose.data && store.pose.data.categories) || [];
      const total = cats.reduce((n, c) => n + (c.count || 0), 0);
      foldEl.innerHTML = [`<button class="ppad-fb ${folder === '' ? 'on' : ''}" data-f="">全部 ${total}</button>`]
        .concat(cats.map((c) => `<button class="ppad-fb ${folder === c.id ? 'on' : ''}" data-f="${esc(c.id)}">${esc(c.name)} ${c.count || 0}</button>`))
        .join('');
    }
    foldEl.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      folder = b.dataset.f;
      paintFolds(); paintBody();
    }));
  }

  /* ---------- 渲染：三个选项卡的正文 ---------- */
  function paintBody() {
    if (tab === 'snippet') return paintSnippet();
    if (tab === 'char') return paintChars();
    return paintPoses();
  }

  function bindClick(node, fn) {
    // 按下就阻止默认行为：不让浮窗抢走原输入框的焦点与光标
    node.addEventListener('mousedown', (e) => e.preventDefault());
    node.addEventListener('click', fn);
  }

  function paintSnippet() {
    const items = (store.snippet.data || []).filter((s) => {
      const f = s.folder || '未分类';
      if (folder && f !== folder) return false;
      if (!kw) return true;
      return `${s.name || ''}\n${f}\n${s.text || ''}`.toLowerCase().includes(kw);
    });
    listEl.innerHTML = items.length ? items.map((s, i) => `
      <div class="ppad-item" data-ppi="${i}" title="点击插入到光标位置">
        <div class="ppad-nm">${esc(s.name || '')}<span class="ppad-fd">${esc(s.folder || '未分类')}</span></div>
        <div class="ppad-tx">${esc((s.text || '').slice(0, 110))}</div>
      </div>`).join('') : '<div class="ppad-empty">没有匹配的提示词</div>';

    listEl.querySelectorAll('[data-ppi]').forEach((node) => {
      bindClick(node, () => {
        const s = items[Number(node.dataset.ppi)];
        if (s) pick(s.text || '', s.name || '');
      });
    });
  }

  function paintChars() {
    const chars = (store.char.data || []).filter((c) => {
      if (!kw) return true;
      return `${c.name || ''}\n${c.title || ''}`.toLowerCase().includes(kw);
    });
    if (!chars.length) { listEl.innerHTML = '<div class="ppad-empty">没有匹配的人物</div>'; return; }

    listEl.innerHTML = chars.map((c) => {
      const open = charOpen === c.id;
      const apps = appCache.get(c.id) || [];
      const curApp = charOpenApp[c.id];
      const app = apps.find((a) => a.id === curApp) || apps.find((a) => a.is_default) || apps[0];
      const txt = promptCache.get(c.id + ':' + ((app && app.id) || 0));
      const appChips = (open && apps.length > 1)
        ? `<div class="ppad-capps">${apps.map((a) => `<button class="ppad-fb ${(app && app.id === a.id) ? 'on' : ''}" data-capp="${c.id}:${a.id}" data-cid="${c.id}">${esc(a.name)}</button>`).join('')}</div>`
        : '';
      const body = open ? `
        ${appChips}
        <div class="ppad-cprompt">${txt ? esc(txt) : (apps.length ? '读取提示词…' : '读取外观…')}</div>
        <div class="ppad-crow">
          <button class="ppad-ins" data-cins="${c.id}" ${txt ? '' : 'disabled'}>插入人物提示词</button>
          <span class="ppad-cmeta">${esc(app ? app.name : '默认外观')}</span>
        </div>` : '';
      return `
        <div class="ppad-item ppad-citem ${open ? 'open' : ''}" data-crow="${c.id}" title="点击展开 / 收起">
          <div class="ppad-char">
            ${c.portrait ? `<img src="${esc(c.portrait)}" alt="">` : '<span class="ppad-ph"></span>'}
            <div class="ppad-cinfo">
              <div class="ppad-nm">${esc(c.name || '')}${c.title ? `<span class="ppad-fd">${esc(c.title.slice(0, 8))}</span>` : ''}</div>
              <div class="ppad-csub">${(c.appearances || []).length} 套外观${c.personality ? ' · ' + esc(String(c.personality).slice(0, 10)) : ''}</div>
            </div>
            <span class="ppad-chev">▾</span>
          </div>
          ${body}
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-crow]').forEach((node) => {
      bindClick(node, (e) => {
        if (e.target.closest('[data-capp]') || e.target.closest('[data-cins]')) return;
        toggleChar(Number(node.dataset.crow));
      });
    });
    listEl.querySelectorAll('[data-capp]').forEach((node) => {
      bindClick(node, () => {
        const cid = Number(node.dataset.cid);
        const aid = Number(node.dataset.capp.split(':')[1]);
        charOpenApp[cid] = aid;
        paintChars();
        loadCharPrompt(cid, aid).then(() => paintChars());
      });
    });
    listEl.querySelectorAll('[data-cins]').forEach((node) => {
      bindClick(node, () => {
        const cid = Number(node.dataset.cins);
        const apps = appCache.get(cid) || [];
        const want = charOpenApp[cid];
        const app = apps.find((a) => a.id === want) || apps.find((a) => a.is_default) || apps[0];
        const txt = promptCache.get(cid + ':' + ((app && app.id) || 0)) || '';
        const ch = (store.char.data || []).find((x) => x.id === cid) || {};
        pick(txt, ch.name || '人物');
      });
    });
  }

  async function toggleChar(cid) {
    if (charOpen === cid) { charOpen = null; paintChars(); return; }
    charOpen = cid;
    paintChars();                       // 先展开，显示「读取中」
    const apps = await charAppearances(cid);
    const app = apps.find((a) => a.id === charOpenApp[cid]) || apps.find((a) => a.is_default) || apps[0];
    if (!app) charOpenApp[cid] = 0;
    await loadCharPrompt(cid, app ? app.id : 0, app);
    paintChars();
  }

  /** 取某个人物某套外观的提示词（缓存里没有才请求） */
  async function loadCharPrompt(cid, aid, app) {
    if (promptCache.has(cid + ':' + (aid || 0))) return;
    const apps = appCache.get(cid) || [];
    const use = app || apps.find((a) => a.id === aid) || null;
    await charPromptText(cid, use);
  }

  function paintPoses() {
    const d = store.pose.data || { categories: [], poses: [] };
    const catName = {};
    (d.categories || []).forEach((c) => { catName[c.id] = c.name; });
    const items = (d.poses || []).filter((p) => {
      if (folder && p.cat !== folder) return false;
      if (!kw) return true;
      return `${p.name || ''}\n${p.cn || ''}\n${catName[p.cat] || ''}`.toLowerCase().includes(kw);
    });
    listEl.innerHTML = items.length ? items.map((p, i) => `
      <div class="ppad-item" data-ppi="${i}" title="点击插入到光标位置">
        <div class="ppad-nm">${esc(p.name || p.id)}<span class="ppad-fd">${esc(catName[p.cat] || '未分类')}</span></div>
        <div class="ppad-tx">${esc((p.cn || '').slice(0, 110) || '（这条没有描述）')}</div>
      </div>`).join('') : '<div class="ppad-empty">没有匹配的动作 / 表情</div>';

    listEl.querySelectorAll('[data-ppi]').forEach((node) => {
      bindClick(node, () => {
        const p = items[Number(node.dataset.ppi)];
        if (!p) return;
        pick(p.cn || p.name || '', p.name || '');
      });
    });
  }

  function paintTarget() {
    if (!tgtEl) return;
    const ok = !!(snap && document.contains(snap.el));
    tgtEl.textContent = ok ? '→ ' + labelOf(snap.el) : '未定位输入框';
    tgtEl.classList.toggle('off', !ok);
  }

  /* ---------- 选项卡 ---------- */
  async function setTab(next, { keepSearch = false } = {}) {
    tab = next;
    folder = '';
    if (!keepSearch) { kw = ''; if (qEl) qEl.value = ''; }
    try { localStorage.setItem(LS_TAB, tab); } catch (_) {}
    tabEls.forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (qEl) qEl.placeholder = TAB_META[tab].ph;
    if (hintEl) hintEl.textContent = TAB_META[tab].hint;
    paintFolds();
    paintBody();            // 有缓存先画一版，避免切过去一片空白
    await refresh(false);   // 没缓存就这时去拉
  }

  async function refresh(force) {
    const d = await load(tab, force);
    if (tab === 'snippet') store.snippet.data = d;
    else if (tab === 'char') store.char.data = d;
    else store.pose.data = d;
    paintFolds();
    paintBody();
  }

  /* ---------- 位置 / 拖动 ---------- */
  function applyPos(left, top) {
    const w = el.offsetWidth || 340, h = el.offsetHeight || 300;
    const L = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    const T = Math.max(6, Math.min(top, window.innerHeight - h - 6));
    el.style.left = L + 'px';
    el.style.top = T + 'px';
    return { L, T };
  }

  function restorePos() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(LS_POS) || 'null'); } catch (_) {}
    if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) return applyPos(p.left, p.top);
    // 默认贴在顶栏下方、右侧
    return applyPos(window.innerWidth - 360 - 26, 62);
  }

  function bindDrag(head) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.ppad-x')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(el.style.left) || 0; oy = parseFloat(el.style.top) || 0;
      head.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyPos(ox + (e.clientX - sx), oy + (e.clientY - sy));
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      try {
        localStorage.setItem(LS_POS, JSON.stringify({
          left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0,
        }));
      } catch (_) {}
    };
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  }

  /* ---------- 构建 ---------- */
  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.id = PAD_ID;
    el.innerHTML = `
      <div class="ppad-head" id="ppad-head">
        <span class="ppad-dot"></span>
        <span class="ppad-ttl">提示词</span>
        <span class="ppad-tgt" id="ppad-tgt">未定位输入框</span>
        <button class="ppad-x" type="button" title="关闭（Esc）">✕</button>
      </div>
      <div class="ppad-tabs" id="ppad-tabs">
        <button class="ppad-tab on" type="button" data-t="snippet">提示词</button>
        <button class="ppad-tab" type="button" data-t="char">人物</button>
        <button class="ppad-tab" type="button" data-t="pose">动作表情</button>
      </div>
      <div class="ppad-bar">
        <input class="ppad-q" id="ppad-q" type="text" placeholder="搜索名称 / 内容…">
        <button class="ppad-rl" type="button" title="重新读取当前选项卡的数据">↻</button>
      </div>
      <div class="ppad-folds" id="ppad-folds"></div>
      <div class="ppad-list" id="ppad-list"></div>
      <div class="ppad-foot" id="ppad-hint">点击提示词插入到光标所在位置</div>`;
    document.body.appendChild(el);

    listEl = el.querySelector('#ppad-list');
    foldEl = el.querySelector('#ppad-folds');
    tgtEl = el.querySelector('#ppad-tgt');
    hintEl = el.querySelector('#ppad-hint');
    qEl = el.querySelector('#ppad-q');
    tabEls = [...el.querySelectorAll('.ppad-tab')];

    bindDrag(el.querySelector('#ppad-head'));
    el.querySelector('.ppad-x').addEventListener('click', () => close());
    tabEls.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.t)));
    qEl.addEventListener('input', () => { kw = qEl.value.trim().toLowerCase(); paintBody(); });
    qEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    el.querySelector('.ppad-rl').addEventListener('click', async () => {
      await refresh(true);
      Admin.toast('已刷新');
    });

    // Esc 关闭（只在浮窗内部按键时生效，不干扰画布/表单自己的 Esc）
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    window.addEventListener('resize', () => { if (isOpen()) restorePos(); });
    return el;
  }

  const isOpen = () => !!(el && el.classList.contains('on'));

  /* ---------- 对外 API ---------- */
  async function open(opts = {}) {
    build();
    snap = capture(opts.target || null);
    onPick = opts.onPick || null;
    el.classList.add('on');
    if (btnEl) btnEl.classList.add('on');
    restorePos();
    paintTarget();
    // 选项卡保持上次用的那个（连续插人物/动作时不用每次重选）
    let last = 'snippet';
    try { last = localStorage.getItem(LS_TAB) || 'snippet'; } catch (_) {}
    if (!TAB_META[last]) last = 'snippet';
    tab = last;
    if (qEl) { qEl.value = ''; qEl.placeholder = TAB_META[tab].ph; }
    kw = ''; folder = '';
    tabEls.forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (hintEl) hintEl.textContent = TAB_META[tab].hint;
    await refresh(false);
    setTimeout(() => qEl.focus(), 30);
    return el;
  }

  function close() {
    if (el) el.classList.remove('on');
    if (btnEl) btnEl.classList.remove('on');
  }

  function toggle(opts) {
    if (isOpen()) close();
    else open(opts);
  }

  window.PromptPad = { open, close, toggle, isOpen, insert };

  /* ---------- 顶栏快捷图标（放在「设置」图标前面） ---------- */
  const PAD_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"'
    + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4 5.5h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9.5L5.5 19v-3.5H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/>'
    + '<path d="M7.2 9.4h9.6M7.2 12.6h6.2"/></svg>';

  function mountButton() {
    if (document.getElementById('tb-pad')) return;
    const slot = document.querySelector('.topbar-actions');
    if (!slot) return;
    const b = document.createElement('button');
    b.id = 'tb-pad';
    b.type = 'button';
    b.className = 'tb-round tb-pad';
    b.title = '提示词浮窗：提示词 / 人物 / 动作表情，选一条插到当前光标处';
    b.innerHTML = PAD_ICON;
    b.addEventListener('click', () => toggle());
    btnEl = b;
    // 固定插在「设置」图标之前；没有设置图标时退到最左
    const settings = document.getElementById('tb-settings');
    if (settings && settings.parentNode === slot) slot.insertBefore(b, settings);
    else slot.insertBefore(b, slot.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountButton);
  } else {
    mountButton();
  }
})();
