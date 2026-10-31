// ========== 漫画制作工作台 ==========
// 核心设计：
//   1. 页面是一张白纸，格子是绝对定位的 div；斜构图靠 clip-path 多边形 + 旋转，
//      边框用叠在上面的 SVG（vector-effect 保证边框粗细不随缩放变形）。
//   2. 每格独立：提示词 / 人物 / 参数 / 版本全挂在格子上，复制出的格子是新 id，彻底脱钩。
//   3. 生成走服务端队列，前端只轮询 /queue；哪格先完成就先回填哪格。
(function () {
  if (window.ComicStudio) return;

  // 注意：Admin.get/post/put/del 内部会自己拼 /api 前缀，这里不能再带 /api
  const API = '/comic';

  // 文档标签配色：每个打开的工程/格子拿一个，标签卡左侧色块
  const DOC_COLORS = ['#e8b44a', '#5fa8d8', '#7fbf6a', '#c07fd8', '#e08a6f', '#4fbfb5', '#d86f8f'];

  const S = {
    projects: [],
    pid: null,
    tree: null,
    pageId: null,
    cellId: null,
    selection: new Set(),
    zoom: 0.5,
    panX: 0,
    panY: 0,
    // 每个「文档 + 页面」各自记住缩放与平移（切标签 / 切面板不再被重置回「适应」）
    view: {},                // viewKey() -> {zoom, panX, panY}
    spaceDown: false,
    tool: 'select',          // select | draw
    snap: true,
    showOrder: true,
    showBorder: true,
    vertexMode: false,
    tab: 'layout',
    options: null,
    characters: null,
    queue: null,
    knownTask: {},           // taskId -> status
    pollTimer: null,
    saveTimers: {},
    promptTimer: null,
    queueOpen: false,
    // ---- 多文档 ----
    docs: [],                // [{key,type:'project'|'cell',pid,pageId,cellId,title,color}]
    active: null,            // 当前文档 key
    collapsed: {},           // bookId -> true 表示该分册折叠
    overlay: null,           // 当前选中的叠加层 {type:'bubble'|'fx', cellId, index}
    ovOpen: {},              // 叠加层卡片展开状态： key `${type}:${i}` -> true
  };

  // 左侧图层树拖拽时的临时数据（跨 dragover 传递，dataTransfer 在 dragover 里读不到）
  let DRAG = null;

  const IMG_CACHE = new Map();

  /* ==================== 基础工具 ==================== */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, err) {
    const d = document.createElement('div');
    d.className = 'cm-toast' + (err ? ' err' : '');
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  function loadImg(url) {
    if (!url) return Promise.resolve(null);
    if (IMG_CACHE.has(url)) return Promise.resolve(IMG_CACHE.get(url));
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => { IMG_CACHE.set(url, im); res(im); };
      im.onerror = () => res(null);
      im.src = url;
    });
  }

  function normPoints(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return [[0, 0], [1, 0], [1, 1], [0, 1]];
    }
    return points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
  }

  function polyCss(pts) {
    return 'polygon(' + pts.map((p) =>
      `${(p[0] * 100).toFixed(2)}% ${(p[1] * 100).toFixed(2)}%`).join(',') + ')';
  }

  function polySvgPts(pts) {
    return pts.map((p) => `${(p[0] * 100).toFixed(2)},${(p[1] * 100).toFixed(2)}`).join(' ');
  }

  function openModal(opts) {
    const mask = document.createElement('div');
    mask.className = 'cm-modal-mask';
    mask.innerHTML = `
      <div class="cm-modal ${opts.cls || ''}" style="${opts.width ? 'width:' + opts.width + 'px' : ''}">
        <div class="cm-modal-head"><h3>${esc(opts.title || '')}</h3>
          <button class="x" data-x>&times;</button></div>
        <div class="cm-modal-body">${opts.body || ''}</div>
        ${opts.footer === false ? '' : `<div class="cm-modal-foot">${opts.footer || '<button class="cm-btn" data-x>关闭</button>'}</div>`}
      </div>`;
    document.body.appendChild(mask);
    // onClose：关闭时（✕ / 关闭按钮 / 点遮罩 / 代码里调 close）都会走一次。
    // 新建版本用它回收「点了取消还留在列表里的空草稿」。
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (_) {} }
      mask.remove();
    };
    mask.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    // root 是整个弹窗（含头/脚）：footer 里的按钮（创建/保存/关闭…）不在 body 里，
    // 只查 body 会拿到 null 直接抛错 —— 新建工程、预览、工程设置都栽在这里过。
    const api = {
      mask, close,
      root: mask.querySelector('.cm-modal'),
      body: mask.querySelector('.cm-modal-body'),
    };
    if (opts.onMount) opts.onMount(api);
    return api;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function dataUrlToBlob(durl) {
    const [head, b64] = durl.split(',');
    const mime = (head.match(/:(.*?);/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ==================== 数据 ==================== */
  function currentBook() {
    if (!S.tree) return null;
    return S.tree.books.find((b) => b.pages.some((p) => p.id === S.pageId)) || S.tree.books[0] || null;
  }

  function currentPage() {
    if (!S.tree) return null;
    for (const b of S.tree.books) {
      const p = b.pages.find((x) => x.id === S.pageId);
      if (p) return p;
    }
    return null;
  }

  function allCells() {
    if (!S.tree) return [];
    const out = [];
    S.tree.books.forEach((b) => b.pages.forEach((p) => (p.cells || []).forEach((c) => out.push(c))));
    return out;
  }

  function currentCell() {
    if (S.cellId) {
      const c = allCells().find((x) => x.id === S.cellId);
      if (c) return c;
    }
    const sel = [...S.selection];
    if (sel.length === 1) return allCells().find((x) => x.id === sel[0]) || null;
    return null;
  }

  function cellById(id) { return allCells().find((c) => c.id === id); }

  async function loadProjects() {
    S.projects = await Admin.get(API + '/projects');
  }

  async function loadOptions() {
    if (S.options) return S.options;
    S.options = await Admin.get(API + '/options');
    return S.options;
  }

  async function loadCharacters(force) {
    if (S.characters && !force) return S.characters;
    S.characters = await Admin.get(API + '/characters');
    return S.characters;
  }

  async function loadTree(pid, keepPage) {
    const data = await Admin.get(API + '/projects/' + pid);
    S.pid = pid;
    S.tree = data;
    const pages = data.books.flatMap((b) => b.pages);
    if (!pages.length) {
      S.pageId = null;
    } else if (!keepPage || !pages.some((p) => p.id === S.pageId)) {
      S.pageId = pages[0].id;
    }
    S.selection.clear();
    S.cellId = null;
    try { localStorage.setItem('comic_last_project', pid); } catch (_) {}
    renderAll();
  }

  /* ==================== 多文档（PS 式标签卡） ==================== */
  function docKey(type, id) { return (type === 'cell' ? 'c' : 'p') + id; }

  function activeDoc() {
    return S.docs.find((d) => d.key === S.active) || null;
  }

  function activeCellDoc() {
    const d = activeDoc();
    return d && d.type === 'cell' ? d : null;
  }

  function nextColor() {
    return DOC_COLORS[S.docs.length % DOC_COLORS.length];
  }

  function renderDocTabs() {
    const bar = document.getElementById('cm-docs');
    if (!bar) return;
    bar.innerHTML = S.docs.map((d) => `
      <div class="cm-doc ${d.key === S.active ? 'on' : ''}" data-doc="${d.key}" title="${esc(d.title)}">
        <span class="dot" style="background:${d.color}"></span>
        <span class="t">${esc(d.title)}</span>
        <span class="x" data-closedoc="${d.key}" title="关闭">×</span>
      </div>`).join('') + `
      <div class="cm-doc" id="cm-open-doc" title="打开已有工程" style="color:#7d8598">＋</div>`;

    bar.querySelectorAll('[data-doc]').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-closedoc]')) return;
        if (el.dataset.doc === S.active) return;
        activateDoc(el.dataset.doc);
      });
    });
    bar.querySelectorAll('[data-closedoc]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDoc(el.dataset.closedoc);
      });
    });
    bar.querySelector('#cm-open-doc')?.addEventListener('click', openDocPicker);
  }

  async function openProjectDoc(pid, title) {
    const key = docKey('project', pid);
    let d = S.docs.find((x) => x.key === key);
    if (!d) {
      d = { key, type: 'project', pid, title: title || '未命名工程', color: nextColor() };
      S.docs.push(d);
    } else if (title) {
      d.title = title;
    }
    await activateDoc(key);
  }

  async function openCellDoc(cellId) {
    const cell = cellById(cellId);
    if (!cell) return;
    const page = currentPage();
    const key = docKey('cell', cellId);
    let d = S.docs.find((x) => x.key === key);
    // 不同页里的「格子 1」会重名，重名时补一个 id 尾巴，标签卡上能分清
    const base = `格子 ${cell.read_order}`;
    const dup = S.docs.some((x) => x.type === 'cell' && x.key !== key && x.title === base);
    const label = dup ? `${base} #${cellId}` : base;
    if (!d) {
      d = {
        key, type: 'cell', pid: S.pid, cellId, pageId: page ? page.id : S.pageId,
        title: label, color: nextColor(),
      };
      S.docs.push(d);
    } else {
      d.pageId = page ? page.id : d.pageId;
      d.title = label;
    }
    await activateDoc(key);
  }

  async function activateDoc(key) {
    const d = S.docs.find((x) => x.key === key);
    if (!d) return;
    saveView();                 // 先记住「原来在看的地方」，切回来才能原样恢复
    S.active = key;
    if (!S.tree || d.pid !== S.pid) {
      try {
        await loadTree(d.pid, true);
      } catch (e) {
        toast('打开失败：' + e.message, true);
        return;
      }
    }
    if (d.type === 'cell') {
      S.pageId = d.pageId || S.pageId;
      S.cellId = d.cellId;
      S.selection = new Set([d.cellId]);
      if (S.tab === '_page') S.tab = 'layout';
      renderAll();
      setTimeout(restoreOrFit, 20);
    } else {
      S.selection.clear();
      S.cellId = null;
      renderAll();
      setTimeout(restoreOrFit, 30);
    }
  }

  function closeDoc(key) {
    const i = S.docs.findIndex((x) => x.key === key);
    if (i < 0) return;
    S.docs.splice(i, 1);
    if (S.active !== key) { renderDocTabs(); return; }
    const next = S.docs[i] || S.docs[i - 1];
    if (next) { activateDoc(next.key); return; }
    S.active = null;
    S.tree = null;
    renderAll();
  }

  async function openDocPicker() {
    await loadProjects();
    const opened = new Set(S.docs.filter((d) => d.type === 'project').map((d) => d.pid));
    const list = S.projects.filter((p) => !opened.has(p.id));
    if (!list.length) { toast('所有工程都已经打开了'); return; }
    const m = openModal({
      title: '打开工程',
      width: 520,
      body: `<div class="cm-lib">${list.map((p) => `
        <div class="cm-lib-card" data-open="${p.id}">
          <div class="ph" style="height:74px;${p.cover ? `background:url('${esc(p.cover)}') center/cover` : ''}">${p.cover ? '' : '▤'}</div>
          <div class="n">${esc(p.title)}</div>
        </div>`).join('')}</div>`,
      footer: `<button class="cm-btn" id="od-cancel">关闭</button>`,
    });
    m.root.querySelector('#od-cancel').addEventListener('click', () => m.close());
    m.root.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', async () => {
      const id = Number(el.dataset.open);
      const pj = S.projects.find((x) => x.id === id);
      m.close();
      await openProjectDoc(id, pj ? pj.title : '');
    }));
  }

  /* ==================== 主渲染 ==================== */
  function renderAll() {
    renderDocTabs();
    renderTop();
    renderTree();
    renderStage();
    renderInspector();
    renderQueueBar();
  }

  /* ---------- 顶部工具条图标（全部 SVG，按功能分组，用分隔符切开） ---------- */
  const svg = (d, extra) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra || ''}</svg>`;
  const IC = {
    save: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M9 4v5h6V4"/><path d="M9 14h6"/>'),
    saveas: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M9 4v5h6V4"/><path d="M15.5 12.5h4M17.5 10.5v4"/>'),
    newcell: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke-dasharray="3 2.5"/><path d="M12 9v6M9 12h6"/>'),
    layout: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15M3.5 12h17"/>'),
    split: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 4.5v15" stroke-dasharray="3 2.5"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 5.5H5.5a1 1 0 0 0-1 1v10"/>'),
    del: svg('<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9L17.5 7"/>'),
    snap: svg('<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 4h4"/><path d="M14 4h4"/>'),
    vertex: svg('<path d="M4.5 6.5L19 4.5l1.2 15-14.7 1.2z"/><circle cx="4.5" cy="6.5" r="1.6"/><circle cx="19" cy="4.5" r="1.6"/><circle cx="20.2" cy="19.5" r="1.6"/><circle cx="5.5" cy="20.7" r="1.6"/>'),
    order: svg('<path d="M5 6h9M5 12h9M5 18h9"/><path d="M17.5 5.5l2.5-2 2.5 2M17.5 18.5l2.5 2 2.5-2"/>'),
    undo: svg('<path d="M9 7H5.5V3.5"/><path d="M5.6 7.2a7.5 7.5 0 1 1-1.1 7.3"/>'),
    redo: svg('<path d="M15 7h3.5V3.5"/><path d="M18.4 7.2a7.5 7.5 0 1 0 1.1 7.3"/>'),
    zoomin: svg('<circle cx="11" cy="11" r="6.5"/><path d="M11 8v6M8 11h6"/><path d="M16 16l4.5 4.5"/>'),
    zoomout: svg('<circle cx="11" cy="11" r="6.5"/><path d="M8 11h6"/><path d="M16 16l4.5 4.5"/>'),
    fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>'),
    genpage: svg('<rect x="4.5" y="3.5" width="12" height="17" rx="1.5"/><path d="M7 8h7M7 12h7M7 16h4"/><path d="M19 6l.8 2.2 2.2.8-2.2.8L19 12l-.8-2.2-2.2-.8 2.2-.8z"/>'),
    genbook: svg('<path d="M4.5 5.5h6a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2h-6z"/><path d="M19.5 5.5h-6a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h6z"/><path d="M19 18.5l.7 1.9 1.9.7-1.9.7-.7 1.9"/>'),
    gencell: svg('<path d="M12 3.5l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
    pickimg: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 4 3.5 3-2.5 3.5 3.5"/>'),
    clearimg: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M4.5 19.5L19.5 4.5"/>'),
    export: svg('<path d="M12 3.5v11"/><path d="M8 11l4 4 4-4"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>'),
    publish: svg('<path d="M12 19.5V6"/><path d="M7 10.5L12 5.5l5 5"/><path d="M5 20.5h14"/>'),
    unpublish: svg('<path d="M12 5.5v13"/><path d="M7 14.5l5 5 5-5"/><path d="M5 20.5h14"/>'),
  };

  // 一个图标按钮（title 必带，鼠标悬停能看懂）
  const ibtn = (id, icon, title, opt = {}) =>
    `<button class="cm-ibtn${opt.on ? ' on' : ''}${opt.cls ? ' ' + opt.cls : ''}" id="${id}" title="${esc(title)}"
      ${opt.disabled ? 'disabled' : ''}>${icon}${opt.label ? `<span class="t">${esc(opt.label)}</span>` : ''}</button>`;

  /** 这一格有没有提示词内容（自由词 / 手写覆盖 / 绑定人物，任一非空即可） */
  function cellHasPrompt(c) {
    return !!((c.prompt_override || '').trim() || (c.prompt_positive || '').trim()
      || (Array.isArray(c.characters) ? c.characters.length : 0));
  }
  /** 批量出图前置条件：ComfyUI 已配置（服务地址 + 至少一套模型方案） */
  function comfyReady() { return !!(S.options && S.options.comfyui && S.options.comfyui.ready); }

  /** 整页 / 整册生成的可用性 + 置灰原因 */
  function batchGenState(scope) {
    const page = currentPage();
    const book = currentBook();
    let cells = [];
    if (scope === 'page') cells = (page && page.cells) || [];
    else cells = ((book && book.pages) || []).flatMap((p) => p.cells || []);
    const name = scope === 'page' ? '整页' : '整册';
    if (!cells.length) return { ok: false, why: `${name}：还没有格子` };
    if (!comfyReady()) {
      const o = S.options || {};
      const noUrl = !(o.comfyui && o.comfyui.url);
      return { ok: false, why: `${name}：ComfyUI 还没配好（${noUrl ? '缺服务地址' : '缺模型方案'}）` };
    }
    const empty = cells.filter((c) => !cellHasPrompt(c));
    if (empty.length) {
      return { ok: false, why: `${name}：还有 ${empty.length} 格没写提示词（如第 ${empty.slice(0, 4).map((c) => c.read_order).join('、')} 格）` };
    }
    return { ok: true, why: `${name}生成：${cells.length} 格，全部提示词已就绪` };
  }

  /* ---------- 撤销 / 重做 ----------
     思路：每一步只记「改了哪些字段、改前是什么、改后是什么」，撤销就是把改前的值写回去。
     比整页快照轻，也不会因为画布重绘而失效；同一次连续拖动 / 连续输入会合并成一步。 */
  const HIST = { undo: [], redo: [], limit: 80, lock: false };
  const histClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // 字段 → 中文动作名（撤销提示里显示「已撤销：移动格子」这种，而不是字段名）
  const HIST_LABELS = {
    x: '移动格子', y: '移动格子', w: '调整尺寸', h: '调整尺寸', rotation: '旋转',
    points: '编辑顶点', border_color: '格子边框', border_width: '格子边框',
    border_style: '格子边框', border_radius: '圆角', opacity: '不透明度',
    z_index: '层级', bg_color: '格子背景', bg_enabled: '格子背景',
    img_scale: '图片缩放', img_offset_x: '图片位置', img_offset_y: '图片位置',
    fit: '取景', flip_h: '镜像', is_locked: '锁定',
    bubbles: '台词气泡', effects: '特效', characters: '出场人物',
    prompt_positive: '提示词', prompt_override: '提示词', prompt_negative: '负面词',
    model_preset: '模型方案', workflow_preset: '工作流', steps: '步数',
    cfg: 'CFG', seed: '种子', seed_mode: '种子模式',
  };
  function histLabel(keys) {
    const s = new Set(keys.map((k) => HIST_LABELS[k] || k));
    return [...s].join(' / ');
  }

  function histPush(label, undoFn, redoFn, coalesce) {
    if (HIST.lock) return;
    const now = Date.now();
    const last = HIST.undo[HIST.undo.length - 1];
    if (coalesce && last && last.coalesce === coalesce && now - last.at < 900) {
      last.redo = redoFn;               // 连续操作并进上一步
      last.at = now;
      last.label = label;
    } else {
      HIST.undo.push({ label, undo: undoFn, redo: redoFn, coalesce: coalesce || '', at: now });
      if (HIST.undo.length > HIST.limit) HIST.undo.shift();
    }
    HIST.redo.length = 0;
    renderTop();
  }

  /** 撤销 / 重做唯一的落库口：把一格的若干字段写回去 */
  async function applyCellFields(cellId, fields) {
    const c = cellById(cellId);
    if (!c) return;
    const p = histClone(fields) || {};
    Object.assign(c, p);
    try { await Admin.put(`${API}/cells/${cellId}`, p); } catch (e) { toast(e.message, true); }
  }

  /** pairs: [[cellId, 改前字段, 改后字段], ...]（拖动多格 / 改多个字段都能用） */
  function histPushFields(label, pairs, coalesce) {
    const snap = pairs.map(([id, b, a]) => [id, histClone(b), histClone(a)]);
    histPush(label,
      async () => { for (const [id, b] of snap) await applyCellFields(id, b); renderStage(); renderInspector(); },
      async () => { for (const [id, , a] of snap) await applyCellFields(id, a); renderStage(); renderInspector(); },
      coalesce);
  }

  async function runHist(dir) {
    const src = dir === 'undo' ? HIST.undo : HIST.redo;
    const dst = dir === 'undo' ? HIST.redo : HIST.undo;
    if (!src.length || HIST.lock) return;
    const entry = src.pop();
    HIST.lock = true;
    try {
      await entry[dir]();
    } catch (e) {
      toast(e.message || '这一步撤不回去了', true);
    } finally {
      HIST.lock = false;
    }
    dst.push(entry);
    renderStage();
    renderInspector();
    renderTop();
    toast(`${dir === 'undo' ? '已撤销：' : '已重做：'}${entry.label || '操作'}`);
  }
  const undoStep = () => runHist('undo');
  const redoStep = () => runHist('redo');

  function renderTop() {
    const top = document.getElementById('cm-top');
    if (!top) return;
    const doc = activeDoc();
    const p = S.tree && S.tree.project;
    const isCell = !!(doc && doc.type === 'cell');
    const hasSel = S.selection.size > 0;
    const page = currentPage();
    const zl = Math.round(S.zoom * 100);
    const stPage = batchGenState('page');
    const stBook = batchGenState('book');

    const midProject = `
      ${ibtn('cm-tool-draw', IC.newcell, '新建格：在页面空白处拖一个框', { on: S.tool === 'draw' })}
      ${ibtn('cm-apply-layout', IC.layout, '套版式', { disabled: !page })}
      ${ibtn('cm-split', IC.split, '拆分选中的格子', { disabled: !hasSel })}
      ${ibtn('cm-duplicate', IC.copy, '复制选中的格子', { disabled: !hasSel })}
      ${ibtn('cm-delete', IC.del, '删除选中的格子', { cls: 'danger', disabled: !hasSel })}`;

    // 吸附 / 斜格顶点 / 序号：紧跟在「删除格子」后面，用分割线隔开（仅页面态有）
    const midSnap = !isCell ? `
        <span class="sep"></span>
        ${ibtn('cm-snap', IC.snap, '吸附：拖动 / 缩放吸附到 10px 网格', { on: S.snap })}
        ${ibtn('cm-vertex', IC.vertex, '斜格顶点：拖四个顶点做斜构图', { on: S.vertexMode })}
        ${ibtn('cm-order-toggle', IC.order, '序号：显示格子阅读顺序', { on: S.showOrder })}` : '';

    // 撤销 / 重做：紧跟在「序号」后面（单格模式没有序号，直接接在格子动作后面）
    const lastU = HIST.undo[HIST.undo.length - 1];
    const lastR = HIST.redo[HIST.redo.length - 1];
    const midHist = `
        <span class="sep"></span>
        ${ibtn('cm-undo', IC.undo, `返回上一步${lastU ? '：' + lastU.label : ''}（Ctrl+Z）`, { disabled: !HIST.undo.length })}
        ${ibtn('cm-redo', IC.redo, `重做${lastR ? '：' + lastR.label : ''}（Ctrl+Y）`, { disabled: !HIST.redo.length })}`;

    // 右侧整组（margin-left:auto → 贴最右）：整页 / 整册 / 导出 / 发布，最后是缩放（放大镜 + 数字 + 适应窗口）
    const aux = `
      <div class="cm-aux">
        ${ibtn('cm-gen-page', IC.genpage, stPage.why, { disabled: !stPage.ok })}
        ${ibtn('cm-gen-book', IC.genbook, stBook.why, { disabled: !stBook.ok })}
        <span class="sep"></span>
        ${ibtn('cm-export', IC.export, '导出', { disabled: !p })}
        ${ibtn('cm-publish', p && p.is_published ? IC.unpublish : IC.publish,
          p && p.is_published ? '取消发布' : '发布到前台', { cls: 'primary', disabled: !p })}
        <span class="sep"></span>
        <div class="cm-zoom">
          ${ibtn('cm-zoom-out', IC.zoomout, '缩小')}
          <span class="v" id="cm-zoom-val">${zl}%</span>
          ${ibtn('cm-zoom-in', IC.zoomin, '放大')}
          ${ibtn('cm-zoom-fit', IC.fit, '适应窗口')}
        </div>
      </div>`;

    const midCell = `
      ${ibtn('cm-gen-cell', IC.gencell, '生成此格（ComfyUI）', { cls: 'primary' })}
      ${ibtn('cm-pick-img', IC.pickimg, '从素材库选图')}
      ${ibtn('cm-clear-img', IC.clearimg, '清空这一格的图')}
      <span class="sep"></span>
      ${ibtn('cm-duplicate', IC.copy, '复制此格')}
      ${ibtn('cm-delete', IC.del, '删除此格', { cls: 'danger' })}`;

    top.innerHTML = `
      <span class="cm-brand">漫画制作</span>
      ${ibtn('cm-save', IC.save, '保存当前文件（Ctrl+S）')}
      ${ibtn('cm-saveas', IC.saveas, '另存为：复制成一份新工程')}
      <span class="sep"></span>
      <div class="cm-tools">
        ${isCell ? midCell : midProject}
        ${midSnap}
        ${midHist}
      </div>
      ${aux}
    `;

    const q = (s) => top.querySelector(s);
    q('#cm-save')?.addEventListener('click', saveActive);
    q('#cm-saveas')?.addEventListener('click', saveAs);
    q('#cm-tool-draw')?.addEventListener('click', () => {
      S.tool = S.tool === 'draw' ? 'select' : 'draw';
      renderTop();
      const wrap = document.getElementById('cm-stage-wrap');
      wrap?.classList.toggle('draw-mode', S.tool === 'draw');
      if (S.tool === 'draw') toast('在页面空白处拖一个框，就能新建一格');
    });
    q('#cm-apply-layout')?.addEventListener('click', applyLayoutModal);
    q('#cm-split')?.addEventListener('click', splitSelected);
    q('#cm-duplicate')?.addEventListener('click', duplicateSelected);
    q('#cm-delete')?.addEventListener('click', deleteSelected);
    q('#cm-undo')?.addEventListener('click', undoStep);
    q('#cm-redo')?.addEventListener('click', redoStep);
    q('#cm-snap')?.addEventListener('click', () => { S.snap = !S.snap; renderTop(); });
    q('#cm-vertex')?.addEventListener('click', () => {
      S.vertexMode = !S.vertexMode; renderTop(); renderStage();
    });
    q('#cm-order-toggle')?.addEventListener('click', () => {
      S.showOrder = !S.showOrder; renderTop(); renderStage();
    });
    q('#cm-zoom-in')?.addEventListener('click', () => zoomBy(1.15));
    q('#cm-zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.15));
    q('#cm-zoom-fit')?.addEventListener('click', () => fitZoom(true));
    q('#cm-gen-cell')?.addEventListener('click', generateSelected);
    q('#cm-pick-img')?.addEventListener('click', pickImageForCell);
    q('#cm-clear-img')?.addEventListener('click', clearImageForCell);
    q('#cm-gen-page')?.addEventListener('click', generatePage);
    q('#cm-gen-book')?.addEventListener('click', generateBook);
    q('#cm-export')?.addEventListener('click', openExport);
    q('#cm-publish')?.addEventListener('click', togglePublish);
  }

  function paintZoomLabel() {
    const el = document.getElementById('cm-zoom-val');
    if (el) el.textContent = Math.round(S.zoom * 100) + '%';
  }

  /* ---------- 视图记忆：每个文档（工程按页）单独记 zoom / pan ---------- */
  function viewKey() {
    const d = activeDoc();
    if (!d) return null;
    // 单格文档：一文档一视图；工程文档：同一工程的不同页面各自记一份
    return d.type === 'cell' ? ('c:' + d.key) : ('p:' + d.key + ':' + (S.pageId || ''));
  }
  function saveView() {
    const k = viewKey();
    if (k) S.view[k] = { zoom: S.zoom, panX: S.panX, panY: S.panY };
  }
  function restoreView() {
    const k = viewKey();
    const v = k && S.view[k];
    if (!v || !Number.isFinite(v.zoom)) return false;
    S.zoom = v.zoom; S.panX = v.panX; S.panY = v.panY;
    return true;
  }
  /** 切文档 / 切页后恢复视图：有记忆就用记忆，没有才「适应」 */
  function restoreOrFit() {
    if (restoreView()) { renderStage(); applyView(); return; }
    fitZoom(true);
    applyView();
  }

  // 只改 transform，不重建 DOM（滚轮连续缩放时保持流畅）
  function applyView() {
    const st = document.getElementById('cm-stage');
    if (st) st.style.transform = `translate(${S.panX}px, ${S.panY}px) scale(${S.zoom})`;
    const pg = document.getElementById('cm-page');
    if (pg) pg.style.setProperty('--hs', 1 / S.zoom);
    paintZoomLabel();
    saveView();
  }

  /* ==================== 保存 / 另存为 ==================== */
  async function saveActive() {
    const doc = activeDoc();
    if (!doc) { toast('没有打开的文件'); return; }
    try {
      if (doc.type === 'cell') {
        const c = cellById(doc.cellId);
        if (c) {
          const fresh = await Admin.put(`${API}/cells/${c.id}`, {
            x: c.x, y: c.y, w: c.w, h: c.h, rotation: c.rotation,
            prompt_positive: c.prompt_positive,
            prompt_override: c.prompt_override, bubbles: c.bubbles,
            characters: c.characters,
          });
          Object.assign(c, {
            current_image: fresh.current_image,
            current_version_id: fresh.current_version_id,
            gen_status: fresh.gen_status,
          });
        }
      } else {
        const pg = currentPage();
        if (pg) {
          await Admin.put(`${API}/pages/${pg.id}`, {
            title: pg.title, width: pg.width, height: pg.height,
            bg_color: pg.bg_color, note: pg.note,
          });
        }
        await loadTree(doc.pid, true);
      }
      toast('已保存');
    } catch (e) {
      toast('保存失败：' + e.message, true);
    }
  }

  async function saveAs() {
    const p = S.tree && S.tree.project;
    if (!p) { toast('没有打开的工程'); return; }
    const name = await Admin.prompt('另存为', {
      label: '新工程名称',
      value: p.title + ' 副本',
    });
    if (name === null || name === undefined) return;
    try {
      const d = await Admin.post(`${API}/projects/${p.id}/duplicate`, { title: name || undefined });
      await loadProjects();
      await openProjectDoc(d.project.id, d.project.title);
      toast('已另存为「' + d.project.title + '」');
    } catch (e) {
      toast('另存为失败：' + e.message, true);
    }
  }

  /* ==================== 素材库选图 / 清空 ==================== */
  async function pickImageForCell() {
    const c = currentCell();
    if (!c) { toast('先选一个格子'); return; }
    if (!window.AssetPicker) { toast('素材库组件未加载', true); return; }
    const a = await AssetPicker.open({ kind: 'all', currentUrl: c.current_image, title: '选图' });
    if (!a || !a.url) return;
    try {
      const fresh = await Admin.post(`${API}/cells/${c.id}/image`, { url: a.url });
      Object.assign(c, fresh);
      renderStage(); renderInspector(); renderTree();
      toast('已设为当前图');
    } catch (e) { toast(e.message, true); }
  }

  async function clearImageForCell() {
    const c = currentCell();
    if (!c) { toast('先选一个格子'); return; }
    if (!await Admin.confirm('清空这一格的图？（版本历史会保留）', { danger: true })) return;
    try {
      const fresh = await Admin.post(`${API}/cells/${c.id}/clear-image`, {});
      Object.assign(c, fresh);
      renderStage(); renderInspector(); renderTree();
    } catch (e) { toast(e.message, true); }
  }

  function renderTree() {
    const box = document.getElementById('cm-tree');
    if (!box) return;
    if (!S.tree) {
      box.innerHTML = '<div class="cm-empty-hint"><span class="ico">▤</span>还没有打开任何工程<br>点上面的 ＋ 新建，或点标签栏的 ＋ 打开</div>';
      return;
    }
    const isCellDoc = !!activeCellDoc();
    box.innerHTML = S.tree.books.map((b) => {
      const closed = !!S.collapsed[b.id];
      return `
      <div class="cm-book ${closed ? 'closed' : ''}" data-book="${b.id}">
        <div class="cm-book-row" data-bookrow="${b.id}" draggable="true">
          <span class="fold" data-fold="${b.id}">${closed ? '▸' : '▾'}</span>
          <span class="name" data-bname="${b.id}" title="双击改名">${esc(b.title)}</span>
          <span class="cnt">${b.pages.length} 页</span>
          <span class="acts">
            <button class="cm-icon-btn" data-addpage="${b.id}" title="在本册新建页">＋</button>
          </span>
        </div>
        <div class="cm-pages" data-bookpages="${b.id}">
          ${b.pages.map((p) => `
            <div class="cm-page-item ${!isCellDoc && p.id === S.pageId ? 'on' : ''}" data-pg="${p.id}" draggable="true">
              <div class="cm-page-thumb"><canvas width="68" height="92" data-thumb="${p.id}"></canvas></div>
              <div class="cm-page-meta">
                <div class="t" data-pname="${p.id}" title="双击改名">${esc(p.title || '第 ' + p.page_no + ' 页')}</div>
                <div class="s">${(p.cells || []).length} 格 · ${(p.cells || []).filter((c) => c.current_image).length} 完成</div>
              </div>
              <div class="acts">
                <button class="cm-icon-btn" data-duppage="${p.id}" title="复制页">⧉</button>
                <button class="cm-icon-btn" data-delpage="${p.id}" title="删除页">✕</button>
              </div>
            </div>`).join('') || '<div style="padding:3px 12px 6px 26px;color:#5f6879;font-size:calc(10px + 2px)">空分册，可把页面拖进来</div>'}
        </div>
      </div>`;
    }).join('');

    /* ---- 折叠 ---- */
    box.querySelectorAll('[data-fold]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.fold);
      S.collapsed[id] = !S.collapsed[id];
      renderTree();
    }));

    /* ---- 选页 ---- */
    box.querySelectorAll('[data-pg]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (e.target.closest('.cm-rename')) return;
        const pgid = Number(el.dataset.pg);
        const projDoc = S.docs.find((d) => d.type === 'project' && d.pid === S.pid);
        if (activeCellDoc() && projDoc) { saveView(); S.active = projDoc.key; }
        saveView();
        S.pageId = pgid;
        S.selection.clear();
        S.cellId = null;
        renderAll();
        setTimeout(restoreOrFit, 20);
      });
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('.cm-page-meta') || e.target.closest('.cm-page-thumb')) {
          e.stopPropagation();
          startRenamePage(el.querySelector('[data-pname]'));
        }
      });
    });

    /* ---- 重命名分册 ---- */
    box.querySelectorAll('[data-bname]').forEach((el) => el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRenameBook(el);
    }));

    /* ---- 新建页 ---- */
    box.querySelectorAll('[data-addpage]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const b = Number(el.dataset.addpage);
      try {
        const pg = await Admin.post(`${API}/books/${b}/pages`, {});
        await loadTree(S.pid, true);
        S.pageId = pg.id;
        S.collapsed[b] = false;
        renderAll();
        setTimeout(restoreOrFit, 20);
        toast('已新建页面');
      } catch (err) { toast(err.message, true); }
    }));

    /* ---- 复制 / 删除页 ---- */
    box.querySelectorAll('[data-duppage]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const pg = await Admin.post(`${API}/pages/${el.dataset.duppage}/duplicate`, {});
        await loadTree(S.pid, true);
        S.pageId = pg.id;
        renderAll();
        toast('已复制页面');
      } catch (err) { toast(err.message, true); }
    }));
    box.querySelectorAll('[data-delpage]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pid = Number(el.dataset.delpage);
      if (!await Admin.confirm('删除这一页？页面里的格子与版本历史会一起删除。', { danger: true })) return;
      try {
        await Admin.del(`${API}/pages/${pid}`);
        await loadTree(S.pid, true);
        S.pageId = currentPage() ? S.pageId : (S.tree.books[0].pages[0] || {}).id;
        renderAll();
      } catch (err) { toast(err.message, true); }
    }));

    /* ---- 拖拽排序 / 拖进拖出分册 ---- */
    bindTreeDrag(box);

    // 页面缩略图
    const pages = S.tree.books.flatMap((b) => b.pages);
    pages.forEach((p) => {
      const cv = box.querySelector(`[data-thumb="${p.id}"]`);
      if (cv) paintThumb(cv, p);
    });
  }

  /* ---------- 图层树拖拽 ---------- */
  function clearDropMarks(box) {
    box.querySelectorAll('.drop-into,.drop-before').forEach((el) => {
      el.classList.remove('drop-into', 'drop-before');
    });
  }

  function bindTreeDrag(box) {
    const pagesOf = (bookId) => {
      const b = S.tree.books.find((x) => x.id === bookId);
      return b ? b.pages : [];
    };

    box.querySelectorAll('[data-pg]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        DRAG = { kind: 'page', id: Number(el.dataset.pg) };
        el.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'page'); } catch (_) {}
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        clearDropMarks(box);
        DRAG = null;
      });
      el.addEventListener('dragover', (e) => {
        if (!DRAG) return;
        e.preventDefault();
        e.stopPropagation();
        const r = el.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        clearDropMarks(box);
        el.classList.add(before ? 'drop-before' : 'drop-into');
        el.dataset.side = before ? 'before' : 'after';
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-into'));
      el.addEventListener('drop', async (e) => {
        if (!DRAG || DRAG.kind !== 'page') return;
        e.preventDefault();
        e.stopPropagation();
        const targetId = Number(el.dataset.pg);
        const side = el.dataset.side || 'before';
        const bookRow = el.closest('.cm-book');
        const targetBook = bookRow ? Number(bookRow.dataset.book) : null;
        const list = pagesOf(targetBook);
        let idx = list.findIndex((x) => x.id === targetId);
        if (idx < 0) idx = list.length;
        if (side === 'after') idx += 1;
        await movePageTo(DRAG.id, targetBook, idx);
        clearDropMarks(box);
      });
    });

    box.querySelectorAll('[data-bookrow]').forEach((el) => {
      const bookId = Number(el.dataset.bookrow);
      el.addEventListener('dragstart', (e) => {
        DRAG = { kind: 'book', id: bookId };
        el.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'book'); } catch (_) {}
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        clearDropMarks(box);
        DRAG = null;
      });
      el.addEventListener('dragover', (e) => {
        if (!DRAG) return;
        e.preventDefault();
        if (DRAG.kind === 'page') {
          clearDropMarks(box);
          el.classList.add('drop-into');
          return;
        }
        if (DRAG.kind === 'book' && DRAG.id !== bookId) {
          const r = el.getBoundingClientRect();
          const before = (e.clientY - r.top) < r.height / 2;
          clearDropMarks(box);
          el.classList.add(before ? 'drop-before' : 'drop-into');
          el.dataset.side = before ? 'before' : 'after';
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-into', 'drop-before'));
      el.addEventListener('drop', async (e) => {
        if (!DRAG) return;
        e.preventDefault();
        e.stopPropagation();
        if (DRAG.kind === 'page') {
          // 页面拖到分册标题上 = 放进这一册末尾
          await movePageTo(DRAG.id, bookId, pagesOf(bookId).length);
        } else if (DRAG.kind === 'book' && DRAG.id !== bookId) {
          const side = el.dataset.side || 'before';
          const order = S.tree.books.map((b) => b.id).filter((x) => x !== DRAG.id);
          let at = order.indexOf(bookId);
          if (at < 0) at = order.length;
          if (side === 'after') at += 1;
          order.splice(at, 0, DRAG.id);
          await Admin.post(`${API}/books/${DRAG.id}/reorder`, { index: at })
            .catch((err) => toast(err.message, true));
          await loadTree(S.pid, true);
        }
        clearDropMarks(box);
      });
    });
  }

  async function movePageTo(pgid, bookId, index) {
    if (!bookId) return;
    try {
      await Admin.post(`${API}/pages/${pgid}/move`, { book_id: bookId, index });
      const src = S.tree.books.flatMap((b) => b.pages).find((p) => p.id === pgid);
      if (src) S.pageId = src.id;
      await loadTree(S.pid, true);
      toast('已移动');
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ---------- 内联改名 ---------- */
  function inlineRename(el, value, onDone) {
    if (!el || el.querySelector('.cm-rename')) return;
    const old = el.textContent;
    const inp = document.createElement('input');
    inp.className = 'cm-rename';
    inp.value = value;
    el.textContent = '';
    el.appendChild(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      el.textContent = commit && v ? v : old;
      if (commit && v && v !== value) await onDone(v);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  function startRenameBook(el) {
    const id = Number(el.dataset.bname);
    const b = S.tree.books.find((x) => x.id === id);
    if (!b) return;
    inlineRename(el, b.title, async (v) => {
      await Admin.put(`${API}/books/${id}`, { title: v }).catch((e) => toast(e.message, true));
      b.title = v;
      renderTree();
    });
  }

  function startRenamePage(el) {
    if (!el) return;
    const id = Number(el.dataset.pname);
    const pg = S.tree.books.flatMap((b) => b.pages).find((x) => x.id === id);
    if (!pg) return;
    inlineRename(el, pg.title || '', async (v) => {
      await Admin.put(`${API}/pages/${id}`, { title: v }).catch((e) => toast(e.message, true));
      pg.title = v;
      renderTree();
    });
  }

  function paintThumb(cv, page) {
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const sx = w / page.width, sy = h / page.height;
    ctx.fillStyle = page.bg_color || '#fff';
    ctx.fillRect(0, 0, w, h);
    const cells = [...(page.cells || [])].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
    cells.forEach((c) => {
      const pts = normPoints(c.points);
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const px = (c.x + pt[0] * c.w) * sx;
        const py = (c.y + pt[1] * c.h) * sy;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = c.current_image ? '#cfd6e2' : '#eceef3';
      ctx.fill();
      ctx.strokeStyle = '#98a0b0';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    });
    // 有图的格子异步补上图
    cells.filter((c) => c.current_image).slice(0, 8).forEach((c) => {
      loadImg(c.current_image).then((im) => {
        if (!im) return;
        const pts = normPoints(c.points);
        ctx.save();
        ctx.beginPath();
        pts.forEach((pt, i) => {
          const px = (c.x + pt[0] * c.w) * sx;
          const py = (c.y + pt[1] * c.h) * sy;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        const bw = c.w * sx, bh = c.h * sy;
        const s = Math.max(bw / im.width, bh / im.height);
        ctx.drawImage(im, c.x * sx + (bw - im.width * s) / 2, c.y * sy + (bh - im.height * s) / 2,
          im.width * s, im.height * s);
        ctx.restore();
      });
    });
  }

  /** 浮到格子外的叠加层：单独一层挂在页面上，跟着格子的位置/旋转走，但不被格子遮挡 */
  function outLayerHtml(c) {
    const inner = bubblesHtml(c, 'out') + fxHtml(c, 'out');
    if (!inner) return '';
    return `<div class="cm-outwrap" data-ovcell="${c.id}"
      style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;transform:rotate(${c.rotation || 0}deg)">${inner}</div>`;
  }

  function renderStage() {
    const wrap = document.getElementById('cm-stage-wrap');
    if (!wrap) return;
    const doc = activeDoc();
    if (!doc) {
      wrap.innerHTML = '<div class="cm-empty-hint" style="margin-top:80px"><span class="ico">▤</span>没有打开的文件</div>';
      return;
    }
    if (doc.type === 'cell') { renderCellStage(wrap, doc); return; }

    const page = currentPage();
    if (!page) {
      wrap.innerHTML = '<div class="cm-empty-hint" style="margin-top:80px">还没有页面，请在左侧「新建分册」或点分册右边的 ＋ 新建页</div>';
      return;
    }
    const z = S.zoom;
    const cells = [...(page.cells || [])].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
    wrap.classList.toggle('draw-mode', S.tool === 'draw');
    wrap.innerHTML = `
      <div class="cm-viewport">
        <div class="cm-stage" id="cm-stage" style="transform:translate(${S.panX}px, ${S.panY}px) scale(${z})">
          <div class="cm-page" id="cm-page" style="width:${page.width}px;height:${page.height}px;background:${page.bg_color || '#fff'};--hs:${1 / z}">
            ${cells.map((c) => cellHtml(c)).join('')}
            ${cells.map((c) => outLayerHtml(c)).join('')}
          </div>
        </div>
      </div>
      <div class="cm-canvas-hint">滚轮缩放 · 拖空白 / 中键 / 空格 平移画布 · 双击格子单独编辑</div>`;
    bindStage(wrap);
    bindCells(wrap);
  }

  // 单个格子文档：把这一格放大到画布中央，和页面里看到的是同一份数据
  function renderCellStage(wrap, doc) {
    const cell = cellById(doc.cellId);
    if (!cell) {
      wrap.innerHTML = '<div class="cm-empty-hint" style="margin-top:80px">这个格子已经被删除了，关掉标签即可</div>';
      return;
    }
    const availW = Math.max(240, wrap.clientWidth - 110);
    const availH = Math.max(240, wrap.clientHeight - 110);
    // 首次进入自动铺满；之后沿用滚轮缩放与平移，不再强行重置
    if (!doc._fitted) {
      doc._fitted = true;
      const fit = Math.max(0.12, Math.min(availW / cell.w, availH / cell.h, 2.2));
      S.zoom = fit;
      S.panX = Math.max(20, (wrap.clientWidth - cell.w * fit) / 2);
      S.panY = Math.max(20, (wrap.clientHeight - cell.h * fit) / 2);
    }
    const z = S.zoom;
    // 进入格子后只按矩形显示：斜格顶点/斜构图是页面排版属性，不该在这一层生效
    const solo = Object.assign({}, cell, { x: 0, y: 0, rotation: 0, is_locked: 0, points: null });
    wrap.classList.remove('draw-mode');
    wrap.innerHTML = `
      <div class="cm-viewport">
        <div class="cm-stage" id="cm-stage" style="transform:translate(${S.panX}px, ${S.panY}px) scale(${z})">
          <div class="cm-page" id="cm-page" style="width:${cell.w}px;height:${cell.h}px;--hs:${1 / z};background:${Number(cell.bg_enabled) === 0 ? 'transparent' : (cell.bg_color || '#ffffff')}">
            ${cellHtml(solo, { plain: true })}
            ${outLayerHtml(solo)}
          </div>
        </div>
      </div>
      <div class="cm-canvas-hint">格子独立编辑 · 滚轮缩放 · 中键 / 空格 平移 · 改动自动存回页面</div>`;
    bindStage(wrap);
    bindOverlays();
    paintZoomLabel();
  }

  function cellHtml(c, opt) {
    const plain = !!(opt && opt.plain);
    const pts = normPoints(c.points);
    const sel = !plain && S.selection.has(c.id);
    const img = c.current_image;
    const statusMap = { done: '', failed: '失败', pending: '待生成', queued: '排队', rendering: '生成中', empty: '', stale: '词已改' };
    const flag = (c.gen_status && statusMap[c.gen_status]) ?
      `<span class="cm-flag ${c.gen_status}">${statusMap[c.gen_status]}</span>` : '';
    const imgStyle = `object-fit:${c.fit === 'contain' ? 'contain' : 'cover'};transform: translate(${c.img_offset_x || 0}%, ${c.img_offset_y || 0}%) scale(${c.img_scale || 1}) scaleX(${c.flip_h ? -1 : 1});`;
    const bw = c.border_style === 'none' ? 0 : (c.border_width ?? 3);
    const dash = c.border_style === 'dashed' ? 'stroke-dasharray="7 5"'
      : (c.border_style === 'dotted' ? 'stroke-dasharray="2 4"' : '');
    // 格子底色：bg_enabled=0 → 透明（露出页面底色）
    const noBg = Number(c.bg_enabled) === 0;
    const cellBg = noBg ? 'transparent' : (c.bg_color || '#ffffff');
    return `
      <div class="cm-cell ${sel ? 'sel' : ''} ${c.is_locked ? 'locked' : ''}" data-cell="${c.id}"
           style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;transform:rotate(${c.rotation || 0}deg);z-index:${10 + (c.z_index || 0)};opacity:${c.opacity ?? 1}">
        <div class="cm-underlayer">${bubblesHtml(c, 'under')}${fxHtml(c, 'under')}</div>
        <div class="cm-clip${noBg ? ' nobg' : ''}" style="clip-path:${polyCss(pts)};background:${cellBg}">
          ${img ? `<img class="cm-img" src="${esc(img)}" style="${imgStyle}" draggable="false">` :
            `<div class="cm-empty"><span class="big">＋</span><span>空镜头</span></div>`}
        </div>
        <svg class="cm-border" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon class="outline" points="${polySvgPts(pts)}" fill="none"
            stroke="${esc(c.border_color || '#111')}" stroke-width="${bw}"
            stroke-linejoin="round" ${dash} vector-effect="non-scaling-stroke"></polygon>
        </svg>
        <div class="cm-bubbles">${bubblesHtml(c, 'in')}</div>
        <div class="cm-fxlayer">${fxHtml(c, 'in')}</div>
        ${S.showOrder && !plain ? `<span class="cm-order">${c.read_order}</span>` : ''}
        ${flag}
        ${c.gen_status === 'rendering' ? `<div class="cm-progress"><i style="width:${c.progress || 0}%"></i></div>` : ''}
        ${sel ? handlesHtml(c, pts) : ''}
      </div>`;
  }

  /** #rrggbb → rgba()：台词框底色要能单独调透明，直接给 CSS 一个 rgba 最省事 */
  function hexToRgba(c, a) {
    const s = String(c || '').trim();
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) return s;                       // 已经是 rgba()/颜色名，原样透传
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ==================== 气泡形状（SVG 几何，编辑视图与导出共用） ====================
  // 全部在 0–100 的视框里画，渲染时按气泡实际宽高非等比拉伸 —— 所以「圆形」在宽气泡上
  // 就是椭圆、云朵的凸起也跟着变宽，和特效的风格一致。好处是：编辑视图和导出的画布
  // 用的是同一份几何，不会出现「编辑器里是爆炸形、导出来是个圆角矩形」。
  const bpN = (v) => Math.round(v * 100) / 100;
  const bpP = (x, y) => `${bpN(x)},${bpN(y)}`;
  const bpClamp = (v, d, lo, hi) => {
    const n = Number(v);
    return Math.max(lo, Math.min(hi, isNaN(n) ? d : n));
  };

  function bubRR(r) {
    const q = Math.max(0, Math.min(r, 50));
    return `M${bpN(q)},0 H${bpN(100 - q)} Q100,0 100,${bpN(q)} V${bpN(100 - q)} Q100,100 ${bpN(100 - q)},100 `
      + `H${bpN(q)} Q0,100 0,${bpN(100 - q)} V${bpN(q)} Q0,0 ${bpN(q)},0 Z`;
  }

  // 尖 ↔ 谷 交替绕一圈：shout 用浅谷（爆炸），rage 用深谷（更凶的锯齿）
  function bubStar(M, R1, R2) {
    const pts = [];
    for (let k = 0; k < M * 2; k++) {
      const a = (k / (M * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = (k % 2 === 0) ? R1 : R2;
      pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
    }
    return `M${pts.map((p) => bpP(p[0], p[1])).join(' L')} Z`;
  }

  // 云朵：沿内圈均分 N 段，每段向外鼓一个圆弧（半径取弦长的 0.62 倍 → 凸起明显且互相重叠）
  function bubCloud(N = 9, R = 40) {
    const c = 2 * R * Math.sin(Math.PI / N);
    const r = c * 0.56;
    let d = '';
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
      const p0 = [50 + Math.cos(a0) * R, 50 + Math.sin(a0) * R];
      const p1 = [50 + Math.cos(a1) * R, 50 + Math.sin(a1) * R];
      if (i === 0) d += `M${bpP(p0[0], p0[1])}`;
      d += ` A${bpN(r)},${bpN(r)} 0 0 1 ${bpP(p1[0], p1[1])}`;
    }
    return `${d} Z`;
  }

  const BUBBLE_SHAPES = {
    round: 'M50,0 A50,50 0 1 1 50,100 A50,50 0 1 1 50,0 Z',
    rect: 'M0,0 H100 V100 H0 Z',
    narration: 'M0,0 H100 V100 H0 Z',
    soft: bubRR(44),
    thought: bubCloud(9, 40),
    cloud: bubCloud(11, 41),
    shout: bubStar(13, 46, 33),
    rage: bubStar(17, 47, 26),
  };
  function bubbleShapePath(type) {
    return BUBBLE_SHAPES[type] || bubRR(10);
  }

  // 各种气泡默认长什么样的尾巴：思考是气泡点、暴躁/爆炸是闪电，其它是三角
  const TAIL_DEFAULT = {
    speech: 'tri', round: 'tri', rect: 'tri', soft: 'tri', narration: 'none',
    thought: 'dots', cloud: 'tri', shout: 'bolt', rage: 'bolt',
  };
  const TAIL_KINDS = [['tri', '三角'], ['curve', '弧尾'], ['bolt', '闪电'], ['dots', '气泡点'], ['none', '不画']];
  const bubbleTailKind = (b) => b.tail || TAIL_DEFAULT[b.type || 'speech'] || 'tri';

  /** 尾巴的几何（返回 path d 数组）。编辑视图和导出画布都吃这一份，样式永远一致。
   *  锚点故意往气泡里缩一点，并且**先画尾巴、后画气泡**，根部被填充盖住 —— 接缝就彻底没了。 */
  function bubbleTailPaths(b) {
    const kind = bubbleTailKind(b);
    if (kind === 'none') return [];
    const type = b.type || 'speech';
    const len = bpClamp(b.tail_len, 30, 3, 80);
    const w = bpClamp(b.tail_w, 14, 3, 60);
    const ang = bpClamp(b.tail_angle, 132, 0, 360) * Math.PI / 180;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const nx = -dy, ny = dx;
    // 锚点离中心多远：云朵 / 爆炸类用形状的内圈半径；方框类按「圆角矩形」求交，
    // 这样斜角上的尾巴是从圆角弧面长出来的，不会悬在矩形角外面。
    const RAD = { speech: 10, rect: 0, narration: 0, soft: 44, round: 50 };
    let ax, ay;
    if (type === 'cloud' || type === 'thought') { ax = 50 + dx * 37; ay = 50 + dy * 37; }
    else if (type === 'shout') { ax = 50 + dx * 31; ay = 50 + dy * 31; }
    else if (type === 'rage') { ax = 50 + dx * 25; ay = 50 + dy * 25; }
    else {
      const r = RAD[type] || 0;
      let t = Math.min(Math.abs(dx) < 1e-4 ? 1e9 : 50 / Math.abs(dx),
        Math.abs(dy) < 1e-4 ? 1e9 : 50 / Math.abs(dy));
      if (r > 0) {
        const px = 50 + dx * t, py = 50 + dy * t;
        if (Math.abs(px - 50) > 50 - r && Math.abs(py - 50) > 50 - r) {
          const cx2 = 50 + Math.sign(dx) * (50 - r), cy2 = 50 + Math.sign(dy) * (50 - r);
          const ox = 50 - cx2, oy = 50 - cy2;
          const bb = dx * ox + dy * oy, cc = ox * ox + oy * oy - r * r;
          const disc = bb * bb - cc;
          if (disc >= 0) t = -bb + Math.sqrt(disc);
        }
      }
      // 再往气泡里缩 2：根部被气泡填充一盖，接缝看不见，又不至于把尾巴藏掉大半
      ax = 50 + dx * (t - 2); ay = 50 + dy * (t - 2);
    }
    const tip = [ax + dx * len, ay + dy * len];
    const p1 = [ax + nx * w / 2, ay + ny * w / 2];
    const p2 = [ax - nx * w / 2, ay - ny * w / 2];
    // 每一项：f=填充用（闭合），s=描边用（**不闭底边**）。
    // 底边故意不描边 —— 它落在气泡内部，描出来就是一道横穿气泡的黑线；
    // 只描外露的两条边，看起来才是「气泡自身长出来的一个尖」。
    const mk = (body, closed) => ({ f: body + 'Z', s: closed ? body + 'Z' : body });
    if (kind === 'dots') {
      // 三颗由大到小、沿方向排开的气泡点（思考）。大小跟「粗细」走，
      // 间距跟「长度」走 —— 不然放大到画布上就是三个看不清的小芝麻。
      const rs = [w * 0.34, w * 0.23, w * 0.15];
      const gap = Math.max(w * 0.16, (len - (rs[0] * 1.95 + rs[1] + rs[2])) / 2);
      let dcur = rs[0] * 0.95;
      const out = [];
      for (let i = 0; i < 3; i++) {
        const cx = ax + dx * dcur, cy = ay + dy * dcur, r = rs[i];
        const body = `M${bpP(cx - r, cy)} A${bpN(r)},${bpN(r)} 0 1 0 ${bpP(cx + r, cy)} `
          + `A${bpN(r)},${bpN(r)} 0 1 0 ${bpP(cx - r, cy)}`;
        out.push(mk(body, true));
        dcur += rs[i] + gap;
      }
      return out;
    }
    if (kind === 'bolt') {
      // 闪电尾：两条边各折一下，看着像 "⚡" 那种硬边拖尾
      const m1 = [ax + dx * len * 0.58 + nx * w * 0.46, ay + dy * len * 0.58 + ny * w * 0.46];
      const m2 = [ax + dx * len * 0.52 - nx * w * 0.40, ay + dy * len * 0.52 - ny * w * 0.40];
      return [mk(`M${bpP(p1[0], p1[1])} L${bpP(m1[0], m1[1])} L${bpP(tip[0], tip[1])} `
        + `L${bpP(m2[0], m2[1])} L${bpP(p2[0], p2[1])}`, false)];
    }
    if (kind === 'curve') {
      // 弧尾：两条边都往外弯，像手绘甩出来的一笔
      const c1 = [ax + dx * len * 0.55 + nx * w * 0.72, ay + dy * len * 0.55 + ny * w * 0.72];
      const c2 = [ax + dx * len * 0.55 - nx * w * 0.62, ay + dy * len * 0.55 - ny * w * 0.62];
      return [mk(`M${bpP(p1[0], p1[1])} Q${bpP(c1[0], c1[1])} ${bpP(tip[0], tip[1])} `
        + `Q${bpP(c2[0], c2[1])} ${bpP(p2[0], p2[1])}`, false)];
    }
    return [mk(`M${bpP(p1[0], p1[1])} L${bpP(tip[0], tip[1])} L${bpP(p2[0], p2[1])}`, false)];
  }

  function bubbleTailSvg(b) {
    const ds = bubbleTailPaths(b);
    if (!ds.length) return '';
    return ds.map(({ f, s }) => `<path d="${f}" fill="var(--bg)" stroke="none"/>`
      + `<path d="${s}" fill="none" stroke="var(--bc)" stroke-linejoin="round" stroke-linecap="round" `
      + `vector-effect="non-scaling-stroke"/>`).join('');
  }

  // 气泡本体 + 尾巴的整块 SVG
  function bubbleSvgHtml(b) {
    const type = b.type || 'speech';
    const bw = b.border_width == null ? 2 : Number(b.border_width);
    const noBorder = (b.border_style === 'none') || bw <= 0;
    const dash = { dashed: '7 5', dotted: '2 4' }[b.border_style] || '';
    const d = bubbleShapePath(type);
    const strokeAttr = noBorder ? 'stroke="none"'
      : `stroke="var(--bc)" stroke-width="${bw}"${dash ? ` stroke-dasharray="${dash}"` : ''}`;
    const tail = bubbleTailSvg(b);
    let s = `<svg class="cm-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`;
    // 尾巴先画、形状后画：根部被填充盖住，任何角度都不会露出接缝
    if (tail) s += tail;
    s += `<path d="${d}" fill="var(--bg)" ${strokeAttr} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    if (b.border_style === 'double' && !noBorder) {
      // 双线：用底色再压一条细线进去，比用两条描边简单也不会有毛边
      s += `<path d="${d}" fill="none" stroke="var(--bg)" stroke-width="${bpN(bw * 0.42)}" vector-effect="non-scaling-stroke"/>`;
    }
    return `${s}</svg>`;
  }

  function bubbleStyle(b) {
    const bc = b.border || '#111';
    const alpha = (b.bg_alpha == null) ? 1 : Math.max(0, Math.min(1, Number(b.bg_alpha) || 0));
    const bgRaw = b.bg || (b.type === 'narration' ? '#fffdf2' : '#ffffff');
    const bg = (alpha >= 0.999) ? bgRaw : hexToRgba(bgRaw, alpha);
    const v = (b.direction === 'v');
    // 底色和描边交给内部 SVG（形状 / 尾巴都在那儿画），div 只负责排版和命中
    return `left:${b.x ?? 10}%;top:${b.y ?? 10}%;width:${b.w ?? 40}%;` +
      (b.h ? `height:${b.h}%;` : '') +
      (v ? 'writing-mode:vertical-rl;text-orientation:upright;' : '') +
      `font-size:${b.size || 13}px;color:${b.color || '#111'};text-align:${b.align || (b.type === 'narration' ? 'left' : 'center')};` +
      `--bg:${bg};--bc:${bc};` +
      `transform:${ovTransform(b)};`;
  }

  /** 气泡 class：类型 + 无边框时关掉尾巴装饰（边框是可分离的，关了就真的没有描边） */
  function bubbleCls(b) {
    const noBorder = (b.border_style === 'none') || Number(b.border_width) === 0;
    return 'cm-bubble ' + (b.type || 'speech') + (noBorder ? ' nb' : '') + (b.locked ? ' locked' : '');
  }

  function bubblesHtml(c, layer = 'in') {
    if (!Array.isArray(c.bubbles)) return '';
    return c.bubbles.map((b, i) => ({ b, i }))
      .filter(({ b }) => ovLayer(b) === layer)
      .map(({ b, i }) =>
        `<div class="${bubbleCls(b)}" data-bi="${i}" style="${bubbleStyle(b)}">${bubbleSvgHtml(b)}<span class="cm-btxt-node">${esc(b.text || '')}</span>${b.locked ? cmLockHtml() : ''}</div>`).join('');
  }

  // ==================== 漫画特效库（可复用资源） ====================
  // 每个特效都是矢量 SVG，颜色用 currentColor，方便在编辑器里整体改色。
  // 视图坐标统一 0 0 100 100，渲染时按叠加层尺寸拉伸。
  // 设计原则：都按「漫画笔触」来做 —— 一头粗一头尖的楔形、锯齿爆点、手绘曲线的弧线，
  // 而不是几何图形直接描边。这样放大到整格也不会显廉价。

  const fxNum = (v, d, lo, hi) => {
    const n = Number(v);
    return Math.max(lo, Math.min(hi, isNaN(n) ? d : n));
  };
  // 固定种子的伪随机：同一条参数渲染多次也长一样，拖动滑块时不会乱闪
  const fxRnd = (i, k) => {
    const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const fxPt = (cx, cy, a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const fxN = (n) => Number(n).toFixed(2);
  // 一条「一头尖一头粗」的楔形线：(px,py)=尖头，(qx,qy)=粗头，w=粗头宽度，tp=0 等宽 / 1 全尖
  function fxWedge(px, py, qx, qy, w, tp = 0.9) {
    const dx = qx - px, dy = qy - py;
    const L = Math.hypot(dx, dy) || 1;
    const ux = -dy / L, uy = dx / L;
    const h1 = w / 2 * (1 - tp);
    const h2 = w / 2;
    return `<polygon points="${fxN(px + ux * h1)},${fxN(py + uy * h1)} `
      + `${fxN(px - ux * h1)},${fxN(py - uy * h1)} `
      + `${fxN(qx - ux * h2)},${fxN(qy - uy * h2)} `
      + `${fxN(qx + ux * h2)},${fxN(qy + uy * h2)}" fill="currentColor"/>`;
  }

  /** 把一条中心线 + 每点半宽做成「粗细可变的一笔」闭合轮廓。
   *  比 stroke 好在：宽度能沿路径变化，两端还是真圆头（stroke-linecap 做不到变宽）。
   *  capA / capB = 0 平头，1 圆头。同色再描一道极细边，消掉缩放后的抗锯齿缝。 */
  function fxTube(line, hws, capA = 1, capB = 1) {
    const n = line.length;
    if (n < 2) return '';
    const up = [], dn = [], dirs = [];
    for (let k = 0; k < n; k++) {
      const p0 = line[Math.max(0, k - 1)], p1 = line[Math.min(n - 1, k + 1)];
      let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      dirs.push([dx, dy]);
      const hw = hws[k];
      up.push([line[k][0] - dy * hw, line[k][1] + dx * hw]);
      dn.push([line[k][0] + dy * hw, line[k][1] - dx * hw]);
    }
    const P = (q) => `${fxN(q[0])},${fxN(q[1])}`;
    let d = `M${P(up[0])}`;
    for (let k = 1; k < n; k++) d += ` L${P(up[k])}`;
    if (capB) {
      const e = line[n - 1], de = dirs[n - 1], hw = hws[n - 1] * 1.35;
      d += ` Q${P([e[0] + de[0] * hw, e[1] + de[1] * hw])} ${P(dn[n - 1])}`;
    } else d += ` L${P(dn[n - 1])}`;
    for (let k = n - 2; k >= 0; k--) d += ` L${P(dn[k])}`;
    if (capA) {
      const a = line[0], da = dirs[0], hw = hws[0] * 1.35;
      d += ` Q${P([a[0] - da[0] * hw, a[1] - da[1] * hw])} ${P(up[0])}`;
    }
    return `<path d="${d}Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"
      stroke-linejoin="round"/>`;
  }

  /** 把一组点圈出来的图形居中放进 0–100（放不下就等比缩小）。
   *  锯齿/箭头这类形状的参数调大后很容易顶出 viewBox，而 .cm-fx > svg 是 overflow:hidden，
   *  一超就被裁掉 —— 统一在这里兜一次，四周永远留白。 */
  function fxFitWrap(pts, body, pad = 2) {
    if (!pts.length) return body;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
    const k = Math.min(1, (100 - pad * 2) / w, (100 - pad * 2) / h);
    const tx = (100 - w * k) / 2 - minX * k;
    const ty = (100 - h * k) / 2 - minY * k;
    return `<g transform="translate(${fxN(tx)} ${fxN(ty)}) scale(${k.toFixed(4)})">${body}</g>`;
  }

  const FX_LIB = {
    explosion: {
      name: '爆炸', icon: '💥',
      // 漫画爆点：尖 ↔ 谷 交替绕一圈，每条边可以「往圆心内弯」——内弯=0 就是纯直线锯齿星，
      // 内弯大了边会凹进去（参考图里那种一边直、一边弯的爆点）。单色实心，不再叠白色环
      // （之前叠了两层白环，缩小看就是红白相间的花，而且外圈还顶出 viewBox 被裁）。
      svg: (b = {}) => {
        const M = Math.round(fxNum(b.spikes, 14, 5, 48));
        const jag = fxNum(b.jag, 45, 0, 100) / 100;
        const bow = fxNum(b.bow, 45, 0, 100) / 100;
        const line = (b.style === 'line');
        // R 是从圆心算的**半径**，不是边长：圆心在 (50,50)，所以最多只能到 48，
        // 写 90 就变成 180 直径直接顶出画面四边（这就是之前爆炸四周被切的原因）。
        const R = 46;
        const vs = [];
        for (let k = 0; k < M * 2; k++) {
          const tip = (k % 2 === 0);
          const a = (k / (M * 2)) * Math.PI * 2 - Math.PI / 2;
          const jit = 1 + (fxRnd(k, 3) - 0.5) * jag * (tip ? 0.5 : 0.34);
          // 抖动可能把尖角顶出画面，这里硬卡在 48 —— 锯齿拉满也只是尖角微微变平
          vs.push([a, Math.min(48, (tip ? R : R * 0.42) * jit)]);
        }
        let d = '';
        for (let k = 0; k < vs.length; k++) {
          const [a0, r0] = vs[k];
          const [a1, r1] = vs[(k + 1) % vs.length];
          const p0 = fxPt(50, 50, a0, r0);
          const p1 = fxPt(50, 50, a1, r1);
          if (k === 0) d += `M${fxN(p0[0])},${fxN(p0[1])} `;
          if (bow < 0.03) { d += `L${fxN(p1[0])},${fxN(p1[1])} `; continue; }
          // 控制点从「两点中点」往圆心拉：拉得越多，这条边凹得越深
          const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
          const cx2 = 50 + (mx - 50) * (1 - bow * 0.62);
          const cy2 = 50 + (my - 50) * (1 - bow * 0.62);
          d += `Q${fxN(cx2)},${fxN(cy2)} ${fxN(p1[0])},${fxN(p1[1])} `;
        }
        d += 'Z';
        // 内芯：把同一个轮廓等比缩小后填一层色 —— 线稿样式下就是「黑边 + 彩色心」，
        // 实心样式下就是一枚双色爆点。inner=0（默认）不画，老作品外观完全不变。
        const inner = Math.round(fxNum(b.inner, 0, 0, 95));
        const core = (inner > 0 && b.cc)
          ? `<path d="${d}" transform="translate(50 50) scale(${(inner / 100).toFixed(3)}) translate(-50 -50)" fill="${b.cc}"/>`
          : '';
        if (line) {
          return core + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="3.4"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
        }
        return `<path d="${d}" fill="currentColor"/>${core}`;
      },
    },
    bang: {
      name: '感叹号', icon: '❗',
      // 两种造型：
      //   round 圆嘟嘟 —— 上端饱满的圆头、向下微微收细、底端也是圆的，下面一颗圆点
      //   block 方方正正 —— 直角梯形杆 + 方点
      // 原来两侧那两条「冲击线」去掉了（缩小看就是两片莫名其妙的小碎块）。
      svg: (b = {}) => {
        const t = fxNum(b.thick, 1, 0.4, 2.2);
        const L = fxNum(b.blen, 0.72, 0.45, 0.95);      // 杆长占整体高度的比例
        const block = (b.style === 'block');
        const y0 = 3;
        const y1 = y0 + L * 74;                         // 杆的下端
        // 杆宽跟着杆长走：杆短的时候不许比长度还胖，否则「加粗」一拉就糊成一个圆
        const rTop = Math.min(17 * t, (y1 - y0) / 2.6, 26);
        const rBot = rTop * 0.72;
        const rd = Math.min(12.5 * t, rTop * 0.86, 20); // 下面那颗点的半径
        const gap = Math.min(4.6 * t, 9);
        const dotY = y1 + gap + rd;                     // 点的圆心
        const pts = [];
        let s = '';
        if (block) {
          const wT = Math.min(16 * t, (y1 - y0) / 2.6, 26), wB = wT * 0.75;
          pts.push([50 - wT, y0], [50 + wT, y0], [50 + wB, y1], [50 - wB, y1]);
          s += `<polygon points="${[[50 - wT, y0], [50 + wT, y0], [50 + wB, y1], [50 - wB, y1]]
            .map((q) => q.map(fxN).join(',')).join(' ')}" fill="currentColor"/>`;
          // 方点：只留一点点圆角，纯粹为了不出现锯齿毛边
          s += `<rect x="${fxN(50 - rd)}" y="${fxN(dotY - rd)}" width="${fxN(rd * 2)}"
            height="${fxN(rd * 2)}" rx="1.6" fill="currentColor"/>`;
          pts.push([50 - rd, dotY - rd], [50 + rd, dotY + rd]);
        } else {
          // 圆头 + 梯形 + 圆底，三块同色叠在一起（视觉上就是一整根胖胖的杆）
          s += `<circle cx="50" cy="${fxN(y0 + rTop)}" r="${fxN(rTop)}" fill="currentColor"/>`;
          s += `<polygon points="${[[50 - rTop, y0 + rTop], [50 + rTop, y0 + rTop],
            [50 + rBot, y1 - rBot], [50 - rBot, y1 - rBot]]
            .map((q) => q.map(fxN).join(',')).join(' ')}" fill="currentColor"/>`;
          s += `<circle cx="50" cy="${fxN(y1 - rBot)}" r="${fxN(rBot)}" fill="currentColor"/>`;
          s += `<circle cx="50" cy="${fxN(dotY)}" r="${fxN(rd)}" fill="currentColor"/>`;
          pts.push([50 - rTop, y0], [50 + rTop, y0], [50 - rd, dotY + rd], [50 + rd, dotY + rd]);
        }
        return fxFitWrap(pts, s, 2);
      },
    },
    speedlines: {
      name: '速度线', icon: '💨',
      // 参数：
      //   mode  radial 中心发散 / h 横向 / v 纵向 / hv 左右对撞
      //   count 条数 4–400   thick 粗头宽 0.2–10   taper 尖头 0–1
      //   len   长短 5–110    vary 长短差异 0–100   jit 疏密差异 0–100（仅平行线）
      //   cx/cy 发散焦点 0–100（仅中心发散）
      // 平行线一律「粗头贴边对齐」，靠长短差异形成参差的尖头 —— 这是漫画速度线的样子
      svg: (b = {}) => {
        const mode = b.mode || 'radial';
        const N = Math.round(fxNum(b.count, 40, 4, 400));
        const th = fxNum(b.thick, 2.4, 0.2, 10);
        const tp = fxNum(b.taper, 0.9, 0, 1);
        const len = fxNum(b.len, 62, 5, 110);
        const vary = fxNum(b.vary, 45, 0, 100) / 100;
        const jit = fxNum(b.jit, 30, 0, 100) / 100;
        if (mode === 'radial') {
          const cx = fxNum(b.cx, 50, -40, 140), cy = fxNum(b.cy, 50, -40, 140);
          const base = 130 * (1 - len / 100);       // 越长 → 尖头离焦点越近
          let s = '';
          for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2 + (fxRnd(i, 1) - 0.5) * (Math.PI * 2 / N) * 0.85;
            const r0 = Math.max(0, base * (0.22 + fxRnd(i, 2) * (0.5 + vary * 1.7)));
            const r1 = 200 + fxRnd(i, 3) * 40;      // 粗头一律射到框外，边上不会露断口
            const w = th * (0.45 + fxRnd(i, 4) * (0.55 + vary * 1.1));
            const [px, py] = fxPt(cx, cy, a, r0);
            const [qx, qy] = fxPt(cx, cy, a, r1);
            s += fxWedge(px, py, qx, qy, w, tp);
          }
          return s;
        }
        // 平行线：h 单向横向 / v 单向纵向 / hv 左右（上下）对撞
        const horiz = (mode === 'h' || mode === 'hv');
        const two = (mode === 'hv');
        const span = len * 1.15;
        // 条数一多，线宽必须让位给「间距」：否则整块糊成黑的百叶窗，看不到一根根的线
        // （viewBox 会被非等比拉伸，所以只能按用户单位里的间距来卡）
        const wCap = (100 / N) * 0.82;
        let s = '';
        for (let i = 0; i < N; i++) {
          const t = (i + 0.5) / N;
          // 疏密：低频扰动，间距有大有小但整体仍按顺序排，不会互相穿插
          const amp = jit * (100 / N) * 1.7;
          const pos = Math.max(-3, Math.min(103,
            t * 100 + amp * (Math.sin(i * 1.9 + 0.7) * 0.62 + Math.sin(i * 0.61 + 1.3) * 0.38)));
          const wRaw = th * (0.45 + fxRnd(i, 2) * (0.6 + vary * 1.6));
          const w = wRaw > wCap ? wCap * (0.62 + fxRnd(i, 7) * 0.38) : wRaw;
          const L = Math.max(4, span * (1 - vary * fxRnd(i, 3) * 0.85));
          const fromStart = two ? (i % 2 === 0) : true;
          if (horiz) {
            if (fromStart) s += fxWedge(-8, pos, -8 + L, pos, w, tp);
            else s += fxWedge(108, pos, 108 - L, pos, w, tp);
          } else if (fromStart) s += fxWedge(pos, -8, pos, -8 + L, w, tp);
          else s += fxWedge(pos, 108, pos, 108 - L, w, tp);
        }
        return s;
      },
    },
    swoosh: {
      name: '动感线', icon: '〰',
      // 一排手绘风线：两头尖的透镜形弧线，长度 / 粗细 / 数量都可调
      svg: (b = {}) => {
        const N = Math.round(fxNum(b.count, 4, 2, 16));
        const th = fxNum(b.thick, 9, 1, 24);
        const len = fxNum(b.len, 88, 20, 100);
        let s = '';
        for (let i = 0; i < N; i++) {
          const y = 20 + ((i + 0.5) / N) * 64 + (fxRnd(i, 1) - 0.5) * (64 / N) * 0.7;
          const bend = 8 + fxRnd(i, 2) * 18;
          const w = th * (0.4 + fxRnd(i, 3) * 0.7);
          const L = len * (0.6 + fxRnd(i, 4) * 0.4);
          const x0 = 2, x1 = x0 + L * 0.98;
          const mx = (x0 + x1) / 2;
          s += `<path d="M${fxN(x0)},${fxN(y)} Q${fxN(mx)},${fxN(y - bend)} ${fxN(x1)},${fxN(y - 2)} `
            + `Q${fxN(mx)},${fxN(y - bend + w)} ${fxN(x0)},${fxN(y)} Z" fill="currentColor" opacity="0.95"/>`;
        }
        return s;
      },
    },
    arrow: {
      name: '箭头', icon: '➤',
      // 一整条闭合轮廓画完：尖尾 → 笔身两侧渐宽 → 颈部 → 上下翼尖（后掠） → 箭尖 → 回笔身闭合。
      // 之前是「细矩形 + 三角」两块拼的，接缝正好落在颈部（笔身宽度和三角底边对不上就是一道沟，
      // 而且弯曲时三角底边是直的、笔身是弯的，缝更明显）。现在共用同一条 path，任何粗细 / 弯曲都没有拼缝。
      // bend 把整根拱起来（C 形），wave 让前后两段反向弯（S 形 / 回旋）。
      svg: (b = {}) => {
        const t = fxNum(b.thick, 1, 0.2, 2.4);
        const hs = fxNum(b.head, 1, 0.5, 2.2);
        const bend = fxNum(b.bend, 0, -100, 100) / 100;
        const wave = fxNum(b.wave, 0, -100, 100) / 100;
        // 中心线（三次贝塞尔）：A 是尾，T 是箭尖
        const A = [14, 52], T = [88, 52];
        const dx = T[0] - A[0];
        const C1 = [A[0] + dx * 0.34, A[1] + bend * 30 + wave * 21];
        const C2 = [A[0] + dx * 0.68, A[1] + bend * 30 - wave * 21];
        const at = (u) => {
          const m = 1 - u;
          return [m * m * m * A[0] + 3 * m * m * u * C1[0] + 3 * m * u * u * C2[0] + u * u * u * T[0],
            m * m * m * A[1] + 3 * m * m * u * C1[1] + 3 * m * u * u * C2[1] + u * u * u * T[1]];
        };
        const dirAt = (u) => {
          const m = 1 - u;
          const vx = 3 * m * m * (C1[0] - A[0]) + 6 * m * u * (C2[0] - C1[0]) + 3 * u * u * (T[0] - C2[0]);
          const vy = 3 * m * m * (C1[1] - A[1]) + 6 * m * u * (C2[1] - C1[1]) + 3 * u * u * (T[1] - C2[1]);
          const L = Math.hypot(vx, vy) || 1;
          return [vx / L, vy / L];
        };
        // 按弧长参数化：贝塞尔的 u 不是等距的，直接按 u 取点会让笔身的粗细分布一头挤一头疏
        const STEP = 64;
        const cum = [0];
        for (let k = 0; k < STEP; k++) {
          const p1 = at(k / STEP), p2 = at((k + 1) / STEP);
          cum.push(cum[k] + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
        }
        const total = cum[STEP] || 1;
        const uAt = (s) => {
          if (s <= 0) return 0;
          if (s >= total) return 1;
          for (let k = 1; k <= STEP; k++) {
            if (cum[k] >= s) {
              const f = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
              return (k - 1 + f) / STEP;
            }
          }
          return 1;
        };
        const ptAtS = (s) => at(uAt(s));
        const dirAtS = (s) => dirAt(uAt(s));
        // 尺寸：笔身颈部半宽 / 尾部半宽（几乎收成尖）/ 翼展半宽 / 头部长度。
        // 关键比例：颈部宽度要在头宽的一半左右 —— 笔身太细时，头部就像一根棍子上插了两根细刺；
        // 参考图里那种箭头本质是「一条越来越宽的带子，末端张开成两个尖」。
        const headHW = Math.min((10 + 6.5 * t) * hs, 34);
        const headLen = Math.min(headHW * 1.05, total * 0.5);
        const neckHW = Math.min(headHW * (0.30 + 0.16 * Math.min(t, 1.6)), 13);
        const tailHW = Math.min(0.6 * t, 2);
        const sNeck = total - headLen;
        // 笔身两侧：尾部到颈部，宽度按 0.7 次幂鼓起来（前段长得快，才像一条鞭子而不是锥子）
        const KN = 32;
        const up = [], dn = [];
        for (let k = 0; k <= KN; k++) {
          const p = ptAtS(sNeck * (k / KN)), d = dirAtS(sNeck * (k / KN));
          const hw = tailHW + (neckHW - tailHW) * Math.pow(k / KN, 0.7);
          up.push([p[0] - d[1] * hw, p[1] + d[0] * hw]);
          dn.push([p[0] + d[1] * hw, p[1] - d[0] * hw]);
        }
        // 箭头：尖端就是中心线终点，两只翼尖从颈部往外张、再向后掠（漫画那种钩形）
        const nk = ptAtS(sNeck), nd = dirAtS(sNeck);
        const tip = ptAtS(total);
        const back = headLen * 0.52;
        const w1 = [nk[0] - nd[1] * headHW - nd[0] * back, nk[1] + nd[0] * headHW - nd[1] * back];
        const w2 = [nk[0] + nd[1] * headHW - nd[0] * back, nk[1] - nd[0] * headHW - nd[1] * back];
        const ring = dn.concat([w2, tip, w1], up.slice().reverse());
        const pts = ring.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
        const d = 'M' + pts.map((q) => `${fxN(q[0])},${fxN(q[1])}`).join(' L') + ' Z';
        return fxFitWrap(pts, `<path d="${d}" fill="currentColor" stroke="currentColor"
          stroke-width="0.6" stroke-linejoin="round"/>`, 2);
      },
    },
    question: {
      name: '问号', icon: '❓',
      // 一条「粗细可变」的笔触顺着钩画下来，结尾收成一根短茎 —— 不是字体里的问号，
      // 钩的起笔细、往右上渐粗，和下面那颗点一起才像手绘的。
      svg: (b = {}) => {
        const t = fxNum(b.thick, 1, 0.4, 1.9);
        const w = Math.min(6.4 * t, 10);           // 笔触半宽
        const cx = 50, cy = 34, r = 16;
        const line = [], hws = [];
        // 钩：从左侧偏下（158°）顺时针绕到正下方（90°+360°）
        for (let k = 0; k <= 26; k++) {
          const f = k / 26;
          const a = (158 + 292 * f) * Math.PI / 180;
          line.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
          hws.push(w * (0.72 + 0.28 * Math.min(1, f * 1.5)));
        }
        // 茎：接在钩的末端往下一小段（宽度和钩尾一致，接口处天然对齐）
        const stem = 9 + 3 * t;
        for (let k = 1; k <= 6; k++) {
          line.push([50, cy + r + stem * (k / 6)]);
          hws.push(w * 0.92);
        }
        const pts = [[cx - r - w, cy - r - w], [cx + r + w, cy + r + stem + w]];
        // 下面那颗点
        const rd = Math.min(5.6 * t, 8.6);
        const dotY = cy + r + stem + 7 + rd;
        pts.push([50 - rd, dotY - rd], [50 + rd, dotY + rd]);
        return fxFitWrap(pts, fxTube(line, hws, 2, 2)
          + `<circle cx="50" cy="${fxN(dotY)}" r="${fxN(rd)}" fill="currentColor"/>`, 2);
      },
    },
    ellipsis: {
      name: '省略号', icon: '…',
      // 一排点：数量 / 大小 / 间距可调，方点交给 style
      svg: (b = {}) => {
        const N = Math.round(fxNum(b.count, 3, 2, 6));
        const r = Math.min(7 * fxNum(b.thick, 1, 0.4, 2), 13);
        const gapK = fxNum(b.gap, 1, 0.4, 2.4);
        const gap = r * 2 * gapK;
        const span = gap * (N - 1);
        const x0 = 50 - span / 2;
        const y = 50;
        const block = (b.style === 'block');
        let s = '';
        for (let i = 0; i < N; i++) {
          const x = x0 + gap * i;
          s += block
            ? `<rect x="${fxN(x - r * 0.84)}" y="${fxN(y - r * 0.84)}" width="${fxN(r * 1.68)}"
                height="${fxN(r * 1.68)}" rx="${fxN(r * 0.22)}" fill="currentColor"/>`
            : `<circle cx="${fxN(x)}" cy="${fxN(y)}" r="${fxN(r)}" fill="currentColor"/>`;
        }
        return fxFitWrap([[x0 - r, y - r], [x0 + span + r, y + r]], s, 2);
      },
    },
    dash: {
      name: '破折号', icon: '➖',
      // 一根长笔触：可以弯，也可以「中间粗两头细」或反过来「两头粗中间细」（taper 正负）
      svg: (b = {}) => {
        const th = fxNum(b.thick, 12, 2, 40);
        const len = fxNum(b.len, 92, 20, 100);
        const taper = fxNum(b.taper, 0, -100, 100) / 100;
        const bend = fxNum(b.bend, 0, -100, 100) / 100;
        const A = [50 - len / 2, 50], T = [50 + len / 2, 50];
        const C = [50, 50 + bend * 34];
        const KN = 36;
        const line = [], hws = [];
        for (let k = 0; k <= KN; k++) {
          const u = k / KN, m = 1 - u;
          line.push([m * m * A[0] + 2 * m * u * C[0] + u * u * T[0],
            m * m * A[1] + 2 * m * u * C[1] + u * u * T[1]]);
          // 中间的鼓/收：sin 曲线，两端恒为 1；taper>0 中间往粗走，<0 中间往细走
          const bell = Math.sin(Math.PI * u);
          const f = taper >= 0 ? (1 + taper * (bell * 1.15 - 0.15)) : (1 + taper * (1 - bell));
          hws.push(Math.max(0.9, th / 2 * f));
        }
        const pts = [[50 - len / 2 - th, 50 - th - Math.abs(bend) * 34],
          [50 + len / 2 + th, 50 + th + Math.abs(bend) * 34]];
        return fxFitWrap(pts, fxTube(line, hws, 2, 2), 2);
      },
    },
    sweat: {
      name: '流汗', icon: '💧',
      // 一大两小的汗滴，带高光；主要用在尴尬 / 紧张的表情旁
      svg: () => {
        const drop = (cx, cy, r, seed) => {
          const tilt = (fxRnd(seed, 1) - 0.5) * 22;
          const d = `M${fxN(cx)},${fxN(cy - r)} `
            + `C${fxN(cx + r * 0.8)},${fxN(cy - r * 0.2)} ${fxN(cx + r * 0.62)},${fxN(cy + r * 0.56)} ${fxN(cx)},${fxN(cy + r * 0.56)} `
            + `C${fxN(cx - r * 0.62)},${fxN(cy + r * 0.56)} ${fxN(cx - r * 0.8)},${fxN(cy - r * 0.2)} ${fxN(cx)},${fxN(cy - r)} Z`;
          return `<g transform="rotate(${fxN(tilt)} ${fxN(cx)} ${fxN(cy)})">`
            + `<path d="${d}" fill="currentColor"/>`
            + `<ellipse cx="${fxN(cx - r * 0.24)}" cy="${fxN(cy - r * 0.04)}" rx="${fxN(r * 0.15)}" ry="${fxN(r * 0.26)}" fill="#fff" opacity="0.9"/>`
            + `</g>`;
        };
        return drop(46, 42, 28, 3) + drop(76, 64, 14, 5) + drop(70, 24, 9, 9);
      },
    },
    vein: {
      name: '青筋', icon: '💢',
      // 十字爆筋：四条向外弯的粗笔触（圆头），中间留空 —— 就是漫画里那个「💢」
      svg: () => {
        let s = '';
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.PI / 4;   // 斜向张开，呈 X 形
          const p0 = fxPt(50, 50, a, 12);
          const c1 = fxPt(50, 50, a + 0.38, 31);
          const p1 = fxPt(50, 50, a + 0.78, 39);     // 外端往侧面弯，形成勾
          s += `<path d="M${fxN(p0[0])},${fxN(p0[1])} Q${fxN(c1[0])},${fxN(c1[1])} `
            + `${fxN(p1[0])},${fxN(p1[1])}" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>`;
        }
        return s;
      },
    },
  };
  const FX_ORDER = ['explosion', 'bang', 'question', 'ellipsis', 'dash',
    'speedlines', 'swoosh', 'arrow', 'sweat', 'vein'];
  const fxDef = (t) => FX_LIB[t] || { name: t || '特效', icon: '✳', svg: () => '' };

  // 各特效可调的形状参数
  //   a 面板属性名  k 数据字段  l 标签  min/max/step/dec 滑块  def 默认值  opts 时改出下拉
  const FX_PARAMS = {
    speedlines: [
      { a: 'fxcnt', k: 'count', l: '数量', min: 4, max: 400, step: 1, dec: 0, def: 40 },
      { a: 'fxthk', k: 'thick', l: '粗细', min: 0.2, max: 10, step: 0.1, dec: 1, def: 2.4 },
      { a: 'fxtap', k: 'taper', l: '尖头', min: 0, max: 100, step: 5, dec: 0, def: 90 },
      { a: 'fxlen', k: 'len', l: '长短', min: 5, max: 110, step: 1, dec: 0, def: 62 },
      { a: 'fxvar', k: 'vary', l: '长短差', min: 0, max: 100, step: 5, dec: 0, def: 45 },
      { a: 'fxjit', k: 'jit', l: '疏密', min: 0, max: 100, step: 5, dec: 0, def: 30 },
      { a: 'fxfcx', k: 'cx', l: '焦点 X', min: -40, max: 140, step: 1, dec: 0, def: 50 },
      { a: 'fxfcy', k: 'cy', l: '焦点 Y', min: -40, max: 140, step: 1, dec: 0, def: 50 },
    ],
    explosion: [
      { a: 'fxspk', k: 'spikes', l: '尖角', min: 5, max: 48, step: 1, dec: 0, def: 14 },
      { a: 'fxjag', k: 'jag', l: '长短差', min: 0, max: 100, step: 5, dec: 0, def: 45 },
      { a: 'fxbow', k: 'bow', l: '内弯', min: 0, max: 100, step: 5, def: 45, dec: 0 },
      { a: 'fxstyle', k: 'style', l: '样式', def: 'solid',
        opts: [['solid', '实心'], ['line', '描边（线稿）']] },
      { a: 'fxcc', k: 'cc', l: '内芯色', t: 'color', def: '#ffffff' },
      { a: 'fxcin', k: 'inner', l: '内心大小', min: 0, max: 95, step: 1, dec: 0, def: 0 },
    ],
    question: [
      { a: 'fxthk', k: 'thick', l: '粗细', min: 0.4, max: 1.9, step: 0.1, dec: 1, def: 1 },
    ],
    ellipsis: [
      { a: 'fxcnt', k: 'count', l: '数量', min: 2, max: 6, step: 1, dec: 0, def: 3 },
      { a: 'fxthk', k: 'thick', l: '大小', min: 0.4, max: 2, step: 0.1, dec: 1, def: 1 },
      { a: 'fxgap', k: 'gap', l: '间距', min: 0.4, max: 2.4, step: 0.1, dec: 1, def: 1 },
      { a: 'fxstyle', k: 'style', l: '形状', def: 'round',
        opts: [['round', '圆点'], ['block', '方点']] },
    ],
    dash: [
      { a: 'fxthk', k: 'thick', l: '粗细', min: 2, max: 40, step: 1, dec: 0, def: 12 },
      { a: 'fxlen', k: 'len', l: '长度', min: 20, max: 100, step: 1, dec: 0, def: 92 },
      { a: 'fxtap', k: 'taper', l: '中间/两端', min: -100, max: 100, step: 5, dec: 0, def: 0 },
      { a: 'fxbend', k: 'bend', l: '弯曲', min: -100, max: 100, step: 5, dec: 0, def: 0 },
    ],
    swoosh: [
      { a: 'fxcnt', k: 'count', l: '数量', min: 2, max: 16, step: 1, dec: 0, def: 4 },
      { a: 'fxthk', k: 'thick', l: '粗细', min: 1, max: 24, step: 1, dec: 0, def: 9 },
      { a: 'fxlen', k: 'len', l: '长短', min: 20, max: 100, step: 1, dec: 0, def: 88 },
    ],
    arrow: [
      { a: 'fxthk', k: 'thick', l: '尾巴粗细', min: 0.3, max: 2.4, step: 0.1, dec: 1, def: 1 },
      { a: 'fxhead', k: 'head', l: '箭头大小', min: 0.5, max: 1.9, step: 0.1, dec: 1, def: 1 },
      { a: 'fxbend', k: 'bend', l: '弯曲', min: -100, max: 100, step: 5, dec: 0, def: 0 },
    ],
    bang: [
      { a: 'fxstyle', k: 'style', l: '样式', def: 'round',
        opts: [['round', '圆嘟嘟'], ['block', '方方正正']] },
      { a: 'fxthk', k: 'thick', l: '粗细', min: 0.4, max: 2.2, step: 0.1, dec: 1, def: 1 },
      { a: 'fxblen', k: 'blen', l: '杆长', min: 0.45, max: 0.95, step: 0.01, dec: 2, def: 0.72 },
    ],
    sweat: [],
    vein: [],
  };
  // 面板里按 0–100 显示、存储按 0–1 记的字段（vary / jit / jag 本身就存 0–100，别换算）
  const FX_PCT = { taper: 1 };

  // 画布上的「小锁」：只在锁定时渲染，悬停才显形，点它只做一件事 —— 解锁。
  // 锁定 = 鼠标穿透（pointer-events: none），好让下面的格子 / 格子内容能被拖动；
  // 所以解锁入口必须挂在元素自己身上（子元素可以单独恢复命中）。
  const CM_LOCK_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/>
    <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1"/></svg>`;
  const cmLockHtml = () => `<span class="cm-lockbtn" data-cmunlock="1" role="button" title="点击解锁">${CM_LOCK_SVG}</span>`;
  function syncLockBtn(el, on) {
    const btn = el.querySelector(':scope > .cm-lockbtn');
    if (on) { if (!btn) el.insertAdjacentHTML('beforeend', cmLockHtml()); }
    else if (btn) btn.remove();
  }

  // 叠加层的三个「层」：under 压在格子图片下面 / in 格子内（默认）/ out 浮到所有格子之上
  const ovLayer = (b) => (b && (b.layer === 'under' || b.layer === 'out')) ? b.layer : 'in';
  // 旋转 + 翻转合成一个 transform：拆成两次赋值会把翻转覆盖掉
  const ovTransform = (b) =>
    `rotate(${b.rotation || 0}deg) scale(${b.flip_h ? -1 : 1}, ${b.flip_v ? -1 : 1})`;

  function fxStyle(b) {
    return `left:${b.x ?? 30}%;top:${b.y ?? 30}%;width:${b.w ?? 18}%;` +
      (b.h ? `height:${b.h}%;` : 'height:18%;') +
      `color:${b.color || '#111111'};opacity:${b.opacity != null ? b.opacity : 1};` +
      `transform:${ovTransform(b)};`;
  }

  function fxHtml(c, layer = 'in') {
    if (!Array.isArray(c.effects)) return '';
    return c.effects.map((b, i) => ({ b, i }))
      .filter(({ b }) => ovLayer(b) === layer)
      .map(({ b, i }) => {
        const inner = fxDef(b.type).svg(b);
        const lk = b.locked ? ' locked' : '';
        return `<div class="cm-fx${lk}" data-fi="${i}" style="${fxStyle(b)}">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">${inner}</svg>${b.locked ? cmLockHtml() : ''}
      </div>`;
      }).join('');
  }

  // 叠加层元素定位：可能长在格子里，也可能长在「浮到格子外」的层里，两个地方都要找
  function ovEl(cellId, type, index) {
    const attr = type === 'fx' ? 'fi' : 'bi';
    const dom = type === 'fx' ? '.cm-fx' : '.cm-bubble';
    return document.querySelector(
      `.cm-cell[data-cell="${cellId}"] ${dom}[data-${attr}="${index}"], `
      + `[data-ovcell="${cellId}"] ${dom}[data-${attr}="${index}"]`);
  }

  // 只改这一个气泡的 DOM，不整页重绘（滑块连续拖动时才不会卡）
  function restyleBubble(cell, i) {
    const b = (cell.bubbles || [])[i];
    const el = ovEl(cell.id, 'bubble', i);
    if (!b || !el) return;
    el.className = bubbleCls(b) + (el.classList.contains('sel-ov') ? ' sel-ov' : '');
    el.setAttribute('style', bubbleStyle(b));
    // 形状 / 尾巴参数（类型、颜色、边框、角度…）变了要重画那一整块 SVG
    const sh = el.querySelector(':scope > .cm-shape');
    if (sh) sh.outerHTML = bubbleSvgHtml(b);
    else el.insertAdjacentHTML('afterbegin', bubbleSvgHtml(b));
    // 只改文字节点：气泡里还挂着锁按钮与缩放手柄，整块 textContent 覆盖会把它们一起删掉
    const tn = el.querySelector('.cm-btxt-node');
    if (tn) { if (tn.textContent !== (b.text || '')) tn.textContent = b.text || ''; }
    else if (el.textContent !== (b.text || '')) el.textContent = b.text || '';
    syncLockBtn(el, !!b.locked);
  }

  function restyleFx(cell, i) {
    const b = (cell.effects || [])[i];
    const el = ovEl(cell.id, 'fx', i);
    if (!b || !el) return;
    el.className = 'cm-fx' + (b.locked ? ' locked' : '') + (el.classList.contains('sel-ov') ? ' sel-ov' : '');
    el.setAttribute('style', fxStyle(b));
    const svg = el.querySelector('svg');
    if (svg) svg.innerHTML = fxDef(b.type).svg(b);
    syncLockBtn(el, !!b.locked);
  }

  // ==================== 叠加层（气泡 / 特效）通用交互 ====================
  function overlayHandlesHtml() {
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((k) =>
      `<div class="cm-ov-handle ${k}" data-ovh="${k}"></div>`).join('') +
      `<div class="cm-ov-handle rot" data-ovh="rot"></div>`;
  }

  function clearOverlay() {
    S.overlay = null;
    document.querySelectorAll('.cm-ov-handle').forEach((h) => h.remove());
    document.querySelectorAll('.cm-bubble.sel-ov, .cm-fx.sel-ov')
      .forEach((o) => o.classList.remove('sel-ov'));
  }


  function selectOverlay(cellId, type, index, fromCanvas) {
    clearOverlay();
    S.overlay = { cellId, type, index };
    const el = ovEl(cellId, type, index);
    if (!el) return;
    el.classList.add('sel-ov');
    // 锁定的叠加层不给缩放手柄（能选中看参数，但不能拖），否则「锁定」就没意义了
    const rec = (type === 'fx' ? (cellById(cellId) || {}).effects : (cellById(cellId) || {}).bubbles) || [];
    if (!(rec[index] && rec[index].locked)) {
      el.insertAdjacentHTML('beforeend', overlayHandlesHtml());
      bindOverlayHandles();
    }
    // 选中后把右侧面板切到对应页；只展开这一张卡，其余全收起（列表一长就没法看了）
    S.tab = type;
    Object.keys(S.ovOpen).forEach((k) => {
      if (k.startsWith('fx:') || k.startsWith('bubble:')) S.ovOpen[k] = false;
    });
    // 没写进 S.ovOpen 的卡片会走「第 0 张默认展开」的分支，所以这里要逐条显式置 false
    const ovCell = cellById(cellId) || {};
    (ovCell[type === 'fx' ? 'effects' : 'bubbles'] || []).forEach((_, k) => {
      S.ovOpen[type + ':' + k] = (k === index);
    });
    S.ovOpen[type + ':' + index] = true;
    // 单格文档模式下面板只服务那一格；普通模式跟随被点中的格子
    const syncPanel = () => {
      if (!S.overlay || S.overlay.type !== type) return;
      if (!activeCellDoc()) {
        S.cellId = cellId;
        S.selection = new Set([cellId]);
        refreshHandles();
        renderTop();
      }
      renderInspector();
      // 把刚点中的那张卡片滚进可视区（列表长了也知道改的是哪一条）
      setTimeout(() => {
        const card = document.querySelector(`#cm-panel-body [data-ovcard="${type}:${index}"]`);
        card?.scrollIntoView({ block: 'nearest' });
      }, 0);
    };
    // 画布上点气泡/特效也要切到属性页；延后一拍再渲染，避免打断刚开始的拖动
    if (fromCanvas) setTimeout(syncPanel, 0);
    else syncPanel();
  }

  function bindOverlayHandles() {
    document.querySelectorAll('.cm-ov-handle').forEach((h) => {
      h.onpointerdown = (e) => {
        if (e.button !== 0 || S.spaceDown) return;
        e.stopPropagation(); e.preventDefault();
        const ov = S.overlay; if (!ov) return;
        const el = ovEl(ov.cellId, ov.type, ov.index);
        if (!el) return;
        if (h.dataset.ovh === 'rot') startOverlayRotate(e, el, ov);
        else startOverlayResize(e, el, ov, h.dataset.ovh);
      };
    });
  }

  // 屏幕位移 → 该格子本地坐标（抵消格子自身的旋转）
  function screenDeltaToCellLocal(dx, dy, cell) {
    const r = (cell.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(-r), sin = Math.sin(-r);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
  }

  function getOvRec(cell, ov) {
    const arr = ov.type === 'fx' ? (cell.effects || []) : (cell.bubbles || []);
    return arr[ov.index] || {};
  }
  function saveOv(cell, ov) {
    const key = ov.type === 'fx' ? 'effects' : 'bubbles';
    const list = cell[key] || [];
    Admin.put(`${API}/cells/${cell.id}`, { [key]: list }).catch((e) => toast(e.message, true));
  }
  function scheduleOvSave(cell, ov, debounce) {
    clearTimeout(S.saveTimers['ov' + cell.id + ov.type]);
    if (debounce) S.saveTimers['ov' + cell.id + ov.type] = setTimeout(() => saveOv(cell, ov), debounce);
    else saveOv(cell, ov);
  }
  function syncOvInspector(ov) {
    if (S.tab === ov.type) renderInspector();
  }

  /** 叠加层拖动结束后记一步历史：整条列表的前后快照（rec 是就地改的，只能整列表比对） */
  function pushOverlayHist(cell, ov, beforeList, label) {
    const key = ov.type === 'fx' ? 'effects' : 'bubbles';
    histPushFields(label, [[cell.id, { [key]: beforeList }, { [key]: histClone(cell[key] || []) }]],
      cell.id + ':' + key + ':' + ov.index);
  }

  function startOverlayMove(e, el, ov) {
    e.preventDefault();
    const cell = cellById(ov.cellId); if (!cell) return;
    const rec = getOvRec(cell, ov);
    const beforeList = histClone(cell[ov.type === 'fx' ? 'effects' : 'bubbles'] || []);
    const sx = e.clientX, sy = e.clientY;
    const ox = rec.x || 0, oy = rec.y || 0;
    let moved = false;
    const move = (ev) => {
      const dxS = (ev.clientX - sx) / S.zoom, dyS = (ev.clientY - sy) / S.zoom;
      const { dx, dy } = screenDeltaToCellLocal(dxS, dyS, cell);
      if (Math.abs(ev.clientX - sx) > 2 || Math.abs(ev.clientY - sy) > 2) moved = true;
      let nx = ox + dx / cell.w * 100, ny = oy + dy / cell.h * 100;
      // 放开范围：台词 / 特效不再被格子框限制，可以拖到页面任意位置
      nx = Math.max(-100, Math.min(300, nx)); ny = Math.max(-100, Math.min(300, ny));
      rec.x = Math.round(nx * 10) / 10; rec.y = Math.round(ny * 10) / 10;
      el.style.left = rec.x + '%'; el.style.top = rec.y + '%';
      scheduleOvSave(cell, ov, 120);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (moved) {
        saveOv(cell, ov);
        pushOverlayHist(cell, ov, beforeList, ov.type === 'fx' ? '移动特效' : '移动气泡');
        syncOvInspector(ov);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startOverlayResize(e, el, ov, dir) {
    e.preventDefault();
    const cell = cellById(ov.cellId); if (!cell) return;
    const rec = getOvRec(cell, ov);
    const sx = e.clientX, sy = e.clientY;
    const beforeList = histClone(cell[ov.type === 'fx' ? 'effects' : 'bubbles'] || []);
    const o = { x: rec.x || 0, y: rec.y || 0, w: rec.w || (ov.type === 'fx' ? 18 : 40) };
    const baseH = el.offsetHeight ? el.offsetHeight / (cell.h * S.zoom) * 100 : 0;
    const oH = (rec.h || 0) || baseH;
    const move = (ev) => {
      const dxS = (ev.clientX - sx) / S.zoom, dyS = (ev.clientY - sy) / S.zoom;
      const { dx, dy } = screenDeltaToCellLocal(dxS, dyS, cell);
      let w = o.w, h = oH, x = o.x, y = o.y;
      if (dir.includes('e')) w = o.w + dx / cell.w * 100;
      if (dir.includes('s')) h = oH + dy / cell.h * 100;
      if (dir.includes('w')) { x = o.x + dx / cell.w * 100; w = o.w - dx / cell.w * 100; }
      if (dir.includes('n')) { y = o.y + dy / cell.h * 100; h = oH - dy / cell.h * 100; }
      w = Math.max(3, w); h = Math.max(3, h);
      rec.x = Math.round(x * 10) / 10; rec.y = Math.round(y * 10) / 10;
      rec.w = Math.round(w * 10) / 10; rec.h = Math.round(h * 10) / 10;
      el.style.left = rec.x + '%'; el.style.top = rec.y + '%';
      el.style.width = rec.w + '%'; el.style.height = rec.h + '%';
      scheduleOvSave(cell, ov, 120);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      saveOv(cell, ov);
      pushOverlayHist(cell, ov, beforeList, ov.type === 'fx' ? '调整特效尺寸' : '调整气泡尺寸');
      syncOvInspector(ov);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startOverlayRotate(e, el, ov) {
    e.preventDefault();
    const cell = cellById(ov.cellId); if (!cell) return;
    const rec = getOvRec(cell, ov);
    const beforeList = histClone(cell[ov.type === 'fx' ? 'effects' : 'bubbles'] || []);
    const r0 = el.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const rot0 = rec.rotation || 0;
    const move = (ev) => {
      const p = el.getBoundingClientRect();
      const px = p.left + p.width / 2, py = p.top + p.height / 2;
      let deg = rot0 + (Math.atan2(ev.clientY - py, ev.clientX - px) - a0) * 180 / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      rec.rotation = Math.round(deg * 10) / 10;
      el.style.transform = ovTransform(rec);
      scheduleOvSave(cell, ov, 120);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      saveOv(cell, ov);
      pushOverlayHist(cell, ov, beforeList, ov.type === 'fx' ? '旋转特效' : '旋转气泡');
      syncOvInspector(ov);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // 给画布上所有叠加层（气泡 / 特效）绑定选中与拖动
  function bindOverlays() {
    document.querySelectorAll('.cm-bubble, .cm-fx').forEach((el) => {
      const cellEl = el.closest('.cm-cell') || el.closest('[data-ovcell]');
      if (!cellEl) return;
      const cellId = Number(cellEl.dataset.cell ?? cellEl.dataset.ovcell);
      const type = el.classList.contains('cm-fx') ? 'fx' : 'bubble';
      const index = Number(el.dataset[type === 'fx' ? 'fi' : 'bi']);
      const rec = (type === 'fx' ? (cellById(cellId) || {}).effects : (cellById(cellId) || {}).bubbles) || [];
      el.onpointerdown = (e) => {
        // 锁定时元素本身 pointer-events:none（鼠标穿透），只有右上角的小锁还能收到事件；
        // 事件从锁按钮冒泡上来，这里负责解锁。
        if (e.target.closest && e.target.closest('.cm-lockbtn')) {
          e.stopPropagation(); e.preventDefault();
          unlockOverlay(cellId, type, index);
          return;
        }
        // 注意用 class 实时判断：面板/小锁解锁后不会重新绑定，闭包里抓的快照会过期
        if (el.classList.contains('locked')) return;   // 已锁定：不选中、不拖动，让下面接住
        if (e.button !== 0 || S.spaceDown) return;
        e.stopPropagation(); e.preventDefault();
        selectOverlay(cellId, type, index, true);
        startOverlayMove(e, el, S.overlay);
      };
    });
    bindOverlayHandles();
  }

  // 「内部图片内容」框：代表图片实际占位（由 img_scale / 偏移决定），
  // 可与整体缩放外框、斜格顶点外框共存；拖动它等同于改右侧「图片取景」参数。
  function innerFrameStyle(c) {
    const r2 = (n) => Math.round(n * 100) / 100;      // 别把 4.2999999999% 这种浮点噪声写进样式
    const s = c.img_scale || 1;
    const ox = c.img_offset_x || 0, oy = c.img_offset_y || 0;
    const w = s * 100, h = s * 100;
    return `left:${r2(50 + ox - w / 2)}%;top:${r2(50 + oy - h / 2)}%;width:${r2(w)}%;height:${r2(h)}%;`;
  }

  function syncInnerFrame(el, c) {
    // 保险起见更新全部同名节点：只要漏删一次，旧框就会停在老位置变成残影
    el.querySelectorAll('.cm-innerframe').forEach((fr) => fr.setAttribute('style', innerFrameStyle(c)));
  }

  function applyImgTransform(el, c) {
    const img = el.querySelector('.cm-img');
    if (img) {
      img.style.transform = `translate(${c.img_offset_x || 0}%, ${c.img_offset_y || 0}%) ` +
        `scale(${c.img_scale || 1}) scaleX(${c.flip_h ? -1 : 1})`;
    }
    syncInnerFrame(el, c);
  }

  function handlesHtml(c, pts) {
    const h = (cls) => `<div class="cm-handle ${cls}" data-h="${cls}"></div>`;
    let out = '';
    // 斜格顶点与「整体缩放外框」互斥：顶点模式开启后，缩放框整体隐藏且不可用
    if (!S.vertexMode) {
      out += h('nw') + h('n') + h('ne') + h('e') + h('se') + h('s') + h('sw') + h('w') + h('rot');
    }
    // 内部图片内容框：上面两种框都能与它共存
    if (c.current_image) {
      const corners = ['nw', 'ne', 'se', 'sw'].map((k) =>
        `<div class="cm-handle inner ${k}" data-inner="${k}"></div>`).join('');
      out += `<div class="cm-innerframe" data-innerframe="1" style="${innerFrameStyle(c)}">
        ${corners}<div class="cm-handle innerpan" data-innerpan="1" title="拖动调整图片位置"></div>
      </div>`;
    }
    if (S.vertexMode) {
      out += pts.map((p, i) => `<div class="cm-handle vertex" data-v="${i}"
        style="left:calc(${p[0] * 100}% - 5px);top:calc(${p[1] * 100}% - 5px)"></div>`).join('');
    }
    return out;
  }

  function zoomBy(f) {
    const wrap = document.getElementById('cm-stage-wrap');
    const cw = wrap ? wrap.clientWidth : 900;
    const ch = wrap ? wrap.clientHeight : 640;
    const mx = cw / 2, my = ch / 2;
    const nz = Math.min(3, Math.max(0.08, S.zoom * f));
    const k = nz / S.zoom;
    S.panX = mx - (mx - S.panX) * k;
    S.panY = my - (my - S.panY) * k;
    S.zoom = nz;
    applyView();
  }

  function fitZoom(reset) {
    const wrap = document.getElementById('cm-stage-wrap');
    const page = currentPage();
    if (!wrap || !page || activeCellDoc()) return;
    const z = Math.min((wrap.clientWidth - 100) / page.width, (wrap.clientHeight - 100) / page.height);
    S.zoom = Math.max(0.08, Math.min(2, z));
    S.panX = Math.max(16, (wrap.clientWidth - page.width * S.zoom) / 2);
    S.panY = Math.max(16, (wrap.clientHeight - page.height * S.zoom) / 2);
    renderStage();
    paintZoomLabel();
  }

  /* ==================== 画布交互 ==================== */
  function snapVal(v) { return S.snap ? Math.round(v / 10) * 10 : Math.round(v); }

  // 事件只绑一次：#cm-stage-wrap 这个外层元素在多次 renderStage 之间是同一个，
  // 反复绑会让一次滚轮/一次拖动被处理 N 遍（缩放忽大忽小、平移抖动）。
  function bindStage(wrap) {
    if (!wrap.querySelector('#cm-page')) return;
    if (wrap.dataset.bound === '1') return;
    wrap.dataset.bound = '1';

    // 滚轮：以鼠标位置为中心缩放（PS 习惯，不按 Ctrl）——页面与单格文档都生效
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = Math.min(3, Math.max(0.08, S.zoom * f));
      const k = nz / S.zoom;
      S.panX = mx - (mx - S.panX) * k;
      S.panY = my - (my - S.panY) * k;
      S.zoom = nz;
      applyView();
    }, { passive: false });

    // 统一入口：中键 / 空格+左键 / 左键拖空白 都能平移
    wrap.addEventListener('pointerdown', (e) => {
      const cellEl = e.target.closest && e.target.closest('.cm-cell');
      const onPage = !!(e.target.closest && e.target.closest('#cm-page'));

      // 1) 中键（任意位置，格子上也算）—— 抓手平移
      if (e.button === 1) { startPan(e); return; }
      if (e.button !== 0) return;

      // 2) 空格 + 左键（任意位置）—— 抓手平移
      if (S.spaceDown) { startPan(e); return; }

      // 3) 格子上：交给格子自己的移动/缩放逻辑
      if (cellEl) return;

      // 4) 页面空白处：画格工具 → 拉框新建；否则拖动平移、单击取消选择
      if (onPage && S.tool === 'draw' && !activeCellDoc()) {
        const pageEl = document.getElementById('cm-page');
        if (pageEl) startDraw(e, pageEl);
        return;
      }
      startPan(e, () => {
        if (activeCellDoc()) return;             // 单格标签：没有「取消选择」的概念
        // 画布空白处单击：只取消气泡/特效的选中，**格子选中保持不变**
        // （否则一点空白右侧就跳回「页面属性」，正在调的格子参数全丢）
        if (S.overlay) {
          clearOverlay();
          if (S.tab === 'bubble' || S.tab === 'fx') S.tab = 'layout';
          renderInspector();
          return;
        }
        // 已经选中格子时，空白处单击什么也不做；要取消请按 Esc
        if (S.selection.size || S.cellId != null) return;
      });
    });

    // 中键：屏蔽浏览器自动滚动（否则真机上会先弹出四向滚动圈）
    wrap.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    wrap.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    wrap.addEventListener('contextmenu', (e) => {
      // 抓手状态里屏蔽右键菜单
      if (S.spaceDown || wrap.classList.contains('panning')) { e.preventDefault(); return; }
      const ovEl2 = e.target.closest && e.target.closest('.cm-bubble, .cm-fx');
      if (ovEl2) {
        e.preventDefault();
        const cellEl = ovEl2.closest('.cm-cell') || ovEl2.closest('[data-ovcell]');
        if (!cellEl) return;
        const cellId = Number(cellEl.dataset.cell ?? cellEl.dataset.ovcell);
        const type = ovEl2.classList.contains('cm-fx') ? 'fx' : 'bubble';
        const index = Number(ovEl2.dataset[type === 'fx' ? 'fi' : 'bi']);
        const arr = (type === 'fx' ? (cellById(cellId) || {}).effects : (cellById(cellId) || {}).bubbles) || [];
        const locked = !!(arr[index] && arr[index].locked);
        if (!locked) selectOverlay(cellId, type, index, false);
        openCtxMenu(e.clientX, e.clientY, ovCtxItems(cellId, type, index));
        return;
      }
      const cellEl = e.target.closest && e.target.closest('.cm-cell');
      if (cellEl) {
        e.preventDefault();
        const cellId = Number(cellEl.dataset.cell);
        if (!S.selection.has(cellId)) { S.selection.clear(); S.selection.add(cellId); }
        S.cellId = cellId;
        renderTop(); refreshHandles(); renderInspector();
        openCtxMenu(e.clientX, e.clientY, cellCtxItems(cellId));
        return;
      }
      // 页面空白处：给一个撤销/重做入口，其余保留浏览器菜单
      if (e.target.closest && e.target.closest('#cm-page')) {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, [
          { label: '撤销', key: 'Ctrl+Z', disabled: !HIST.undo.length, run: undoStep },
          { label: '重做', key: 'Ctrl+Y', disabled: !HIST.redo.length, run: redoStep },
        ]);
      }
    });
  }

  /* ---------- 画布右键菜单 ---------- */
  let ctxCleanup = null;
  function closeCtxMenu() {
    document.querySelectorAll('.cm-ctx').forEach((m) => m.remove());
    if (ctxCleanup) { ctxCleanup(); ctxCleanup = null; }
  }
  function openCtxMenu(clientX, clientY, items) {
    closeCtxMenu();
    const list = items.filter(Boolean);
    const m = document.createElement('div');
    m.className = 'cm-ctx';
    m.innerHTML = list.map((it, i) => (it.sep ? '<div class="sep"></div>'
      : `<div class="it${it.danger ? ' danger' : ''}${it.disabled ? ' dis' : ''}" data-i="${i}"
           style="${it.disabled ? 'opacity:.4;pointer-events:none' : ''}">
           <span class="ck">${it.check ? '✓' : ''}</span><span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</div>`)).join('');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(clientX, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(6, Math.min(clientY, window.innerHeight - r.height - 8)) + 'px';
    m.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
      const it = list[Number(el.dataset.i)];
      closeCtxMenu();
      if (it && it.run) { try { await it.run(); } catch (err) { toast(err.message, true); } }
    }));
    const onDown = (ev) => { if (!m.contains(ev.target)) closeCtxMenu(); };
    const onKeyDown = (ev) => { if (ev.key === 'Escape') closeCtxMenu(); };
    setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('keydown', onKeyDown, true);
    }, 0);
    ctxCleanup = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }

  function cellCtxItems(cellId) {
    const cell = cellById(cellId);
    const multi = S.selection.size > 1;
    return [
      { label: multi ? `复制 ${S.selection.size} 个格子` : '复制格子', key: 'Ctrl+D', run: duplicateSelected },
      { sep: true },
      { label: '置于顶层', run: () => zOrder(cellId, 'front') },
      { label: '置于底层', run: () => zOrder(cellId, 'back') },
      { sep: true },
      { label: multi ? `删除 ${S.selection.size} 个格子` : '删除格子', key: 'Del', danger: true, run: deleteSelected },
    ].filter((x) => x.sep || cell);
  }

  function ovCtxItems(cellId, type, index) {
    const isFx = type === 'fx';
    const cell = cellById(cellId) || {};
    const arr = (isFx ? cell.effects : cell.bubbles) || [];
    const b = arr[index] || {};
    const name = isFx ? '特效' : '气泡';
    const layer = ovLayer(b);
    const set = (p, label, restage) => () => setOvFields(cellId, type, index, p, { label, restage });
    if (b.locked) {
      return [
        { label: '已锁定（不可选择）', disabled: true },
        { sep: true },
        { label: '解锁', run: set({ locked: 0 }, '解锁' + name) },
        { sep: true },
        { label: '删除' + name, danger: true, run: () => deleteOverlay(cellId, type, index) },
      ];
    }
    return [
      { label: '左右翻转', check: !!b.flip_h, run: set({ flip_h: b.flip_h ? 0 : 1 }, '左右翻转' + name) },
      { label: '上下翻转', check: !!b.flip_v, run: set({ flip_v: b.flip_v ? 0 : 1 }, '上下翻转' + name) },
      { sep: true },
      { label: '锁定（锁定后不可选择）', check: !!b.locked, run: set({ locked: 1 }, '锁定' + name) },
      { sep: true },
      { label: '压在格子下', check: layer === 'under', run: set({ layer: 'under' }, name + '层：格子下', true) },
      { label: '放在格子里', check: layer === 'in', run: set({ layer: 'in' }, name + '层：格子内', true) },
      { label: '浮到格子外', check: layer === 'out', run: set({ layer: 'out' }, name + '层：格子外', true) },
      { sep: true },
      { label: '复制' + name, run: () => duplicateOverlay(cellId, type, index) },
      { label: '删除' + name, danger: true, run: () => deleteOverlay(cellId, type, index) },
    ];
  }

  /** 改一个气泡 / 特效自己的字段（翻转 / 锁定 / 层级都走这里），带撤销 */
  async function setOvFields(cellId, type, index, p, opt = {}) {
    const cell = cellById(cellId); if (!cell) return;
    const key = type === 'fx' ? 'effects' : 'bubbles';
    const before = histClone(cell[key] || []);
    const list = histClone(cell[key] || []);
    if (!list[index]) return;
    Object.assign(list[index], p);
    await applyCellFields(cellId, { [key]: list });
    histPushFields(opt.label || '调整叠加层', [[cellId, { [key]: before }, { [key]: histClone(list) }]]);
    if (opt.restage) {
      // renderStage() 会重建画布，bindCells 第一件事就是 clearOverlay()，
      // 所以「改层级 / 锁定」这类需要重画的改动会把选中状态一起抹掉 —— 先记下再补回来。
      const keepOv = (S.overlay && S.overlay.cellId === cellId
        && S.overlay.type === type && S.overlay.index === index) ? { ...S.overlay } : null;
      renderStage();
      if (keepOv) {
        S.overlay = keepOv;
        const el2 = ovEl(cellId, type, index);
        if (el2) {
          el2.classList.add('sel-ov');
          // 锁定的不给手柄：能看参数、但拖不动（手柄是拖拽入口）
          if (!list[index].locked) {
            el2.insertAdjacentHTML('beforeend', overlayHandlesHtml());
            bindOverlayHandles();
          }
        }
      }
    } else if (type === 'fx') restyleFx(cell, index);
    else restyleBubble(cell, index);
    if (S.tab === type) renderInspector();
  }

  /** 画布小锁：点一下就解锁（锁定仍然靠右键菜单 / 右侧面板） */
  async function unlockOverlay(cellId, type, index) {
    const cell = cellById(cellId);
    const key = type === 'fx' ? 'effects' : 'bubbles';
    const rec = ((cell && cell[key]) || [])[index];
    if (!rec || !rec.locked) return;
    await setOvFields(cellId, type, index, { locked: 0 }, { label: '解锁' + (type === 'fx' ? '特效' : '台词') });
    toast((type === 'fx' ? '特效' : '台词') + '已解锁');
  }

  /** 复制一个气泡 / 特效（稍微错开一点，看得出是两个） */
  async function duplicateOverlay(cellId, type, index) {
    const cell = cellById(cellId);
    const key = type === 'fx' ? 'effects' : 'bubbles';
    const list = histClone(cell[key] || []);
    const src = list[index];
    if (!src) return;
    const copy = { ...histClone(src) };
    copy.x = Math.round(((copy.x ?? 10) + 4) * 10) / 10;
    copy.y = Math.round(((copy.y ?? 10) + 4) * 10) / 10;
    const before = histClone(cell[key] || []);
    list.splice(index + 1, 0, copy);
    await applyCellFields(cellId, { [key]: list });
    histPushFields(type === 'fx' ? '复制特效' : '复制气泡',
      [[cellId, { [key]: before }, { [key]: histClone(list) }]]);
    renderStage(); renderInspector();
    selectOverlay(cellId, type, index + 1, false);
    toast(type === 'fx' ? '已复制特效' : '已复制气泡');
  }

  async function deleteOverlay(cellId, type, index) {
    const cell = cellById(cellId);
    const key = type === 'fx' ? 'effects' : 'bubbles';
    const before = histClone(cell[key] || []);
    const list = before.slice();
    if (!list[index]) return;
    list.splice(index, 1);
    if (S.overlay && S.overlay.type === type && S.overlay.index === index) clearOverlay();
    await applyCellFields(cellId, { [key]: list });
    histPushFields(type === 'fx' ? '删除特效' : '删除气泡',
      [[cellId, { [key]: before }, { [key]: histClone(list) }]]);
    renderStage(); renderInspector();
  }

  async function zOrder(cellId, where) {
    const page = currentPage(); if (!page) return;
    const zs = (page.cells || []).map((c) => c.z_index || 0);
    const z = where === 'front' ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
    const before = (cellById(cellId) || {}).z_index || 0;
    await applyCellFields(cellId, { z_index: z });
    histPushFields('调整层级', [[cellId, { z_index: before }, { z_index: z }]]);
    renderStage(); renderInspector();
  }

  // onTap：按下后没有移动就松开 —— 当成一次单击
  function startPan(e, onTap) {
    const wrap = document.getElementById('cm-stage-wrap');
    if (!wrap) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = S.panX, oy = S.panY;
    const eager = e.button === 1 || S.spaceDown;   // 中键 / 空格：一按下就给抓手光标
    let moved = false;
    const mark = () => {
      wrap.classList.add('panning');
      document.body.classList.add('cm-panning');
    };
    if (eager) mark();
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;   // 抖动不当作拖动
        moved = true;
        mark();
      }
      S.panX = ox + dx;
      S.panY = oy + dy;
      applyView();
    };
    const up = () => {
      wrap.classList.remove('panning');
      document.body.classList.remove('cm-panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved && onTap) onTap();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startDraw(e, pageEl, stageEl) {
    const z = S.zoom;
    const rect = pageEl.getBoundingClientRect();
    const x0 = (e.clientX - rect.left) / z;
    const y0 = (e.clientY - rect.top) / z;
    const box = document.createElement('div');
    box.className = 'cm-drawbox';
    pageEl.appendChild(box);
    const move = (ev) => {
      const x1 = (ev.clientX - rect.left) / z;
      const y1 = (ev.clientY - rect.top) / z;
      const left = Math.min(x0, x1), top = Math.min(y0, y1);
      box.style.left = left + 'px';
      box.style.top = top + 'px';
      box.style.width = Math.abs(x1 - x0) + 'px';
      box.style.height = Math.abs(y1 - y0) + 'px';
    };
    const up = async (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.remove();
      const x1 = (ev.clientX - rect.left) / z;
      const y1 = (ev.clientY - rect.top) / z;
      const x = snapVal(Math.min(x0, x1)), y = snapVal(Math.min(y0, y1));
      const w = Math.max(40, snapVal(Math.abs(x1 - x0)));
      const h = Math.max(40, snapVal(Math.abs(y1 - y0)));
      S.tool = 'select';
      const cell = await Admin.post(`${API}/pages/${S.pageId}/cells`, { x, y, w, h });
      const page = currentPage();
      page.cells.push(cell);
      S.selection.clear();
      S.selection.add(cell.id);
      S.cellId = cell.id;
      renderTop();
      renderStage();
      renderInspector();
      renderTree();
      const holder = { id: cell.id };
      histPush('新建格子',
        async () => { await removeCellById(holder.id); },
        async () => {
          const c = await Admin.post(`${API}/pages/${S.pageId}/cells`, { x, y, w, h });
          holder.id = c.id;
          page.cells.push(c);
          S.selection = new Set([c.id]);
          S.cellId = c.id;
          renderAll();
        });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function bindCells(wrap) {
    clearOverlay();
    wrap.querySelectorAll('.cm-cell').forEach((el) => {
      const id = Number(el.dataset.cell);
      el.addEventListener('pointerdown', (e) => {
        if (S.tool === 'draw') return;
        if (e.button !== 0 || S.spaceDown) return;   // 中键 / 空格+左键：交给画布平移
        const cell = cellById(id);
        if (!cell) return;
        clearOverlay();   // 点到格子本身 → 取消叠加层选择
        const handle = e.target.closest('.cm-handle');
        const vertex = e.target.closest('.cm-handle.vertex');
        const innerH = e.target.closest('.cm-handle.inner');
        const innerPan = e.target.closest('[data-innerpan]');

        // 选择
        if (e.shiftKey) {
          S.selection.has(id) ? S.selection.delete(id) : S.selection.add(id);
        } else if (!S.selection.has(id)) {
          S.selection.clear();
          S.selection.add(id);
        }
        S.cellId = id;
        renderTop();
        refreshHandles();

        if (innerH) { startInnerScale(e, cell, innerH.dataset.inner, el); return; }
        if (innerPan) { startInnerPan(e, cell, el); return; }
        if (vertex) {
          startVertexDrag(e, cell, Number(vertex.dataset.v), el);
          return;
        }
        if (handle) {
          if (handle.dataset.h === 'rot') startRotate(e, cell, el);
          else startResize(e, cell, handle.dataset.h, el);
          return;
        }
        if (cell.is_locked) {
          highlightSelection();
          renderInspector();
          return;
        }
        startMove(e, el);
      });

      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('.cm-handle')) return;
        if (!S.options) return;
        openCellDoc(Number(el.dataset.cell));
      });
    });

    highlightSelection();
    bindHandles();
    bindOverlays();
    renderInspector();
  }

  function highlightSelection() {
    document.querySelectorAll('.cm-cell').forEach((el) => {
      el.classList.toggle('sel', S.selection.has(Number(el.dataset.cell)));
    });
  }

  // 只重绘选中格的手柄（不整页重绘——整页重绘会把正在拖拽的 DOM 换掉）
  function refreshHandles() {
    document.querySelectorAll('.cm-cell').forEach((el) => {
      const id = Number(el.dataset.cell);
      const c = cellById(id);
      // 注意：内框（.cm-innerframe）是手柄容器的一部分，必须一起清掉。
      // 只删 .cm-handle 会把旧内框留下来 —— 每拖一次复制一份，画布上就是一圈残影。
      el.querySelectorAll('.cm-handle, .cm-innerframe').forEach((h) => h.remove());
      const on = S.selection.has(id);
      el.classList.toggle('sel', on);
      if (on && c) el.insertAdjacentHTML('beforeend', handlesHtml(c, normPoints(c.points)));
    });
    // 手柄需要重新绑事件：直接复用整页的绑定逻辑代价太大，这里单独给手柄绑
    bindHandles();
    bindOverlays();
  }

  function bindHandles() {
    document.querySelectorAll('.cm-cell').forEach((el) => {
      const id = Number(el.dataset.cell);
      el.querySelectorAll('.cm-handle').forEach((h) => {
        h.onpointerdown = (e) => {
          if (e.button !== 0 || S.spaceDown) return;   // 中键 / 空格：让画布平移
          e.stopPropagation();
          e.preventDefault();
          const cell = cellById(id);
          if (!cell) return;
          if (h.classList.contains('inner')) startInnerScale(e, cell, h.dataset.inner, el);
          else if (h.dataset.innerpan) startInnerPan(e, cell, el);
          else if (h.classList.contains('vertex')) startVertexDrag(e, cell, Number(h.dataset.v), el);
          else if (h.dataset.h === 'rot') startRotate(e, cell, el);
          else startResize(e, cell, h.dataset.h, el);
        };
      });
    });
  }

  function pointerPagePos(e) {
    const pageEl = document.getElementById('cm-page');
    const r = pageEl.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
  }

  /** 拖动格子时同步「浮到格子外」的那层（它挂在页面上，不会跟着格子元素动） */
  function syncOutWrap(cellId, box) {
    const w = document.querySelector(`.cm-outwrap[data-ovcell="${cellId}"]`);
    if (!w) return;
    if (box.left != null) {
      w.style.left = box.left; w.style.top = box.top;
      if (box.width != null) { w.style.width = box.width; w.style.height = box.height; }
    }
    if (box.transform) w.style.transform = box.transform;
  }

  function startMove(e, el) {
    e.preventDefault();
    const z = S.zoom;
    const moving = [...S.selection].map((id) => {
      const c = cellById(id);
      return c ? { c, el: document.querySelector(`.cm-cell[data-cell="${id}"]`), x: c.x, y: c.y } : null;
    }).filter(Boolean);
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      moving.forEach((m) => {
        let nx = m.x + dx, ny = m.y + dy;
        if (S.snap && !ev.altKey) { nx = Math.round(nx / 10) * 10; ny = Math.round(ny / 10) * 10; }
        m.el.style.left = nx + 'px';
        m.el.style.top = ny + 'px';
        syncOutWrap(m.c.id, { left: nx + 'px', top: ny + 'px' });
        m._nx = nx; m._ny = ny;
      });
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) { renderInspector(); return; }
      const pairs = [];
      for (const m of moving) {
        m.c.x = Math.round(m._nx ?? m.x);
        m.c.y = Math.round(m._ny ?? m.y);
        pairs.push([m.c.id, { x: m.x, y: m.y }, { x: m.c.x, y: m.c.y }]);
        try { await Admin.put(`${API}/cells/${m.c.id}`, { x: m.c.x, y: m.c.y }); } catch (err) { toast(err.message, true); }
      }
      histPushFields('移动格子', pairs);
      renderInspector();
      refreshThumb(S.pageId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startResize(e, cell, dir, el) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const z = S.zoom;
    const o = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
    const move = (ev) => {
      let dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      let { x, y, w, h } = o;
      if (dir.includes('e')) w = o.w + dx;
      if (dir.includes('s')) h = o.h + dy;
      if (dir.includes('w')) { x = o.x + dx; w = o.w - dx; }
      if (dir.includes('n')) { y = o.y + dy; h = o.h - dy; }
      if (S.snap && !ev.altKey) { x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10; w = Math.round(w / 10) * 10; h = Math.round(h / 10) * 10; }
      w = Math.max(30, w); h = Math.max(30, h);
      Object.assign(cell, { x, y, w, h });
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.width = w + 'px'; el.style.height = h + 'px';
      syncOutWrap(cell.id, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        await Admin.put(`${API}/cells/${cell.id}`, { x: cell.x, y: cell.y, w: cell.w, h: cell.h });
      } catch (err) { toast(err.message, true); }
      histPushFields('调整格子尺寸', [[cell.id, o, { x: cell.x, y: cell.y, w: cell.w, h: cell.h }]]);
      renderInspector();
      renderStage();
      refreshThumb(S.pageId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startRotate(e, cell, el) {
    e.preventDefault();
    const pos = pointerPagePos(e);
    const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
    const a0 = Math.atan2(pos.y - cy, pos.x - cx);
    const r0 = cell.rotation || 0;
    const move = (ev) => {
      const p = pointerPagePos(ev);
      let deg = r0 + (Math.atan2(p.y - cy, p.x - cx) - a0) * 180 / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      cell.rotation = Math.round(deg * 10) / 10;
      el.style.transform = `rotate(${cell.rotation}deg)`;
      syncOutWrap(cell.id, { transform: `rotate(${cell.rotation}deg)` });
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      await Admin.put(`${API}/cells/${cell.id}`, { rotation: cell.rotation }).catch((err) => toast(err.message, true));
      histPushFields('旋转格子', [[cell.id, { rotation: r0 }, { rotation: cell.rotation }]]);
      renderInspector();
      refreshThumb(S.pageId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startVertexDrag(e, cell, idx, el) {
    e.preventDefault();
    const pts0 = normPoints(cell.points).map((p) => [...p]);
    const pts = normPoints(cell.points).map((p) => [...p]);
    // 支持把矩形直接拖成梯形/平行四边形
    const move = (ev) => {
      const p = pointerPagePos(ev);
      const nx = (p.x - cell.x) / cell.w;
      const ny = (p.y - cell.y) / cell.h;
      pts[idx] = [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000];
      const newPts = pts.map((x) => [...x]);
      cell.points = newPts;
      const clip = el.querySelector('.cm-clip');
      clip.style.clipPath = polyCss(newPts);
      el.querySelector('.cm-border polygon').setAttribute('points', polySvgPts(newPts));
      el.querySelectorAll('.cm-handle.vertex').forEach((h, i) => {
        if (i !== idx) return;
        h.style.left = `calc(${newPts[idx][0] * 100}% - 5px)`;
        h.style.top = `calc(${newPts[idx][1] * 100}% - 5px)`;
      });
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      await Admin.put(`${API}/cells/${cell.id}`, { points: cell.points }).catch((err) => toast(err.message, true));
      histPushFields('编辑格子顶点', [[cell.id, { points: pts0 }, { points: cell.points }]]);
      renderInspector();
      refreshThumb(S.pageId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // 内部图片内容：拖四角改缩放（= 右侧「图片取景 / 缩放」）
  function startInnerScale(e, cell, corner, el) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const z = S.zoom || 1;
    const s0 = cell.img_scale || 1;
    const dirX = corner.includes('e') ? 1 : -1;
    const dirY = corner.includes('s') ? 1 : -1;
    const base = Math.max(80, Math.min(cell.w, cell.h));
    const move = (ev) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      const d = (dx * dirX + dy * dirY) / 2;
      let s = s0 + (d / base) * 2;
      s = Math.max(0.3, Math.min(4, Math.round(s * 100) / 100));
      cell.img_scale = s;
      applyImgTransform(el, cell);
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      await Admin.put(`${API}/cells/${cell.id}`, { img_scale: cell.img_scale })
        .catch((err) => toast(err.message, true));
      histPushFields('图片缩放', [[cell.id, { img_scale: s0 }, { img_scale: cell.img_scale }]]);
      renderInspector();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // 内部图片内容：拖中心 ✥ 改偏移（= 右侧「图片取景 / 水平·垂直偏移」）
  function startInnerPan(e, cell, el) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const z = S.zoom || 1;
    const ox0 = cell.img_offset_x || 0, oy0 = cell.img_offset_y || 0;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / (cell.w * z) * 100;
      const dy = (ev.clientY - sy) / (cell.h * z) * 100;
      cell.img_offset_x = Math.max(-100, Math.min(100, Math.round((ox0 + dx) * 10) / 10));
      cell.img_offset_y = Math.max(-100, Math.min(100, Math.round((oy0 + dy) * 10) / 10));
      applyImgTransform(el, cell);
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      await Admin.put(`${API}/cells/${cell.id}`, {
        img_offset_x: cell.img_offset_x, img_offset_y: cell.img_offset_y,
      }).catch((err) => toast(err.message, true));
      histPushFields('图片位置', [[cell.id,
        { img_offset_x: ox0, img_offset_y: oy0 },
        { img_offset_x: cell.img_offset_x, img_offset_y: cell.img_offset_y }]]);
      renderInspector();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function refreshThumb(pageId) {
    const page = S.tree && S.tree.books.flatMap((b) => b.pages).find((p) => p.id === pageId);
    const cv = document.querySelector(`[data-thumb="${pageId}"]`);
    if (page && cv) paintThumb(cv, page);
  }

  /* ==================== 右侧面板 ==================== */
  function renderInspector() {
    const box = document.getElementById('cm-right');
    if (!box) return;
    const doc = activeDoc();
    if (!doc) {
      box.innerHTML = '<div class="cm-empty-hint">打开一个工程后，这里会显示所选元素的属性</div>';
      return;
    }
    // 单格文档：面板只服务于这一格，绝不显示页面属性，避免两套参数混在一起
    const cellDoc = activeCellDoc();
    const cell = cellDoc ? cellById(cellDoc.cellId) : currentCell();
    const page = currentPage();
    if (!cell) {
      if (page) {
        box.innerHTML = pagePanelHtml(page);
        bindPagePanel(box, page);
      } else {
        box.innerHTML = '<div class="cm-empty-hint">在左侧选一个页面</div>';
      }
      return;
    }
    const tabs = cellDoc
      ? [['layout', '尺寸'], ['version', '版本'], ['bubble', '台词'], ['fx', '特效'], ['param', '参数']]
      : [['layout', '排版'], ['version', '版本'], ['bubble', '台词'], ['fx', '特效'], ['param', '参数']];
    if (!tabs.some(([k]) => k === S.tab)) S.tab = 'layout';
    box.innerHTML = `
      <div class="cm-tabs">
        ${tabs.map(([k, n]) => `<div class="cm-tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${n}</div>`).join('')}
      </div>
      ${cellDoc ? `<div class="cm-cellscope">格子 ${esc(String(cell.read_order ?? ''))} · 只改这一格</div>` : ''}
      <div class="cm-panel" id="cm-panel-body">${panelHtml(cell, page, !!cellDoc)}</div>`;
    box.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
      S.tab = t.dataset.tab;
      renderInspector();
    }));
    bindPanel(box, cell);
  }

  /* ---------- 页面属性面板（没选中格子时显示） ---------- */
  function pagePanelHtml(page) {
    const book = currentBook();
    const cells = page.cells || [];
    const done = cells.filter((c) => c.current_image).length;
    return `
      <div class="cm-pagehead">页面属性<span class="sub">${book ? esc(book.title) : ''}</span></div>
      <div class="cm-panel">
        <div class="cm-field"><label>页面名称</label>
          <input type="text" id="pg-title" value="${esc(page.title || '')}"></div>
        <div class="cm-section">尺寸（本页独立）</div>
        ${sliderField('宽', 'pg-w', page.width, 320, 4000, 10, 'px')}
        ${sliderField('高', 'pg-h', page.height, 320, 4000, 10, 'px')}
        <div class="cm-field"><label>背景色</label>
          <input type="color" id="pg-bg" value="${page.bg_color || '#ffffff'}"></div>
        <div class="cm-field"><label>备注</label>
          <textarea id="pg-note" rows="2">${esc(page.note || '')}</textarea></div>
        <div class="cm-section">本页统计</div>
        <div class="cm-kv"><span>格子数</span><b>${cells.length}</b></div>
        <div class="cm-kv"><span>已出图</span><b>${done}</b></div>
        <div class="cm-kv"><span>尺寸</span><b id="pg-size-kv">${page.width} × ${page.height}</b></div>
        <div class="cm-section">操作</div>
        <div style="display:flex;gap:6px">
          <button class="cm-btn" id="pg-layout" style="flex:1;justify-content:center">套版式</button>
          <button class="cm-btn" id="pg-dup" style="flex:1;justify-content:center">复制此页</button>
        </div>
        <div class="hint" style="margin-top:10px">双击画布上的格子 → 在标签栏里单独打开，右侧变成那一格的属性。</div>
      </div>`;
  }

  function bindPagePanel(box, page) {
    const put = async (payload, restage) => {
      Object.assign(page, payload);
      try { await Admin.put(`${API}/pages/${page.id}`, payload); }
      catch (e) { toast(e.message, true); }
      if (restage) renderStage();
      renderTree();
    };
    box.querySelector('#pg-title')?.addEventListener('change', (e) => put({ title: e.target.value }));
    box.querySelector('#pg-note')?.addEventListener('change', (e) => put({ note: e.target.value }));
    box.querySelector('#pg-bg')?.addEventListener('input', (e) => put({ bg_color: e.target.value }, true));
    // 宽 / 高两个滑块当前值（拖动中要同时给画布和统计用，避免互相覆盖）
    const liveSize = () => {
      const rs = box.querySelector('#pg-w'), hs = box.querySelector('#pg-h');
      return {
        w: Math.round(Number(rs ? rs.value : page.width) || page.width),
        h: Math.round(Number(hs ? hs.value : page.height) || page.height),
      };
    };
    // 画布上的页面尺寸实时跟着变（不重建 DOM，保证拖动顺滑）
    const paintLiveSize = () => {
      const { w, h } = liveSize();
      const kv = box.querySelector('#pg-size-kv');
      if (kv) kv.textContent = `${w} × ${h}`;
      const pg = document.getElementById('cm-page');
      if (pg) { pg.style.width = w + 'px'; pg.style.height = h + 'px'; }
    };
    // 页面宽高：滑块拖动实时预览，数值框可精确输入
    [['pg-w', 'width'], ['pg-h', 'height']].forEach(([id, key]) => {
      const r = box.querySelector('#' + id), n = box.querySelector('#' + id + '-n'), lab = box.querySelector('#' + id + '-v');
      if (!r) return;
      const kv = box.querySelector('#pg-size-kv');
      const set = (raw) => {
        let v = Math.round(Number(raw) || 0);
        v = Math.max(320, Math.min(4000, v));
        r.value = v; if (n) n.value = v; if (lab) lab.textContent = v;
        setSliderFill(r);
        paintLiveSize();   // 统计里的尺寸也跟着变，不用等重新渲染
        put({ [key]: v }, true);
      };
      setSliderFill(r);
      // 拖动中：数值框 / 标签 / 统计 立刻跟随（不在这里发请求，松手才落库）
      r.addEventListener('input', () => {
        const v = Math.round(Number(r.value) || 0);
        if (lab) lab.textContent = v;
        if (n && document.activeElement !== n) n.value = v;
        paintLiveSize();   // 拖动中：数值框 / 标签 / 统计 / 画布 全部立刻跟随（松手才落库）
        setSliderFill(r);
      });
      r.addEventListener('change', () => set(r.value));
      n?.addEventListener('input', () => {
        const v = Math.round(Number(n.value) || 0);
        if (lab) lab.textContent = v; r.value = v; setSliderFill(r);
        paintLiveSize();
      });
      n?.addEventListener('change', () => set(n.value));
    });
    box.querySelector('#pg-layout')?.addEventListener('click', applyLayoutModal);
    box.querySelector('#pg-dup')?.addEventListener('click', async () => {
      try {
        const pg = await Admin.post(`${API}/pages/${page.id}/duplicate`, {});
        await loadTree(S.pid, true);
        S.pageId = pg.id;
        renderAll();
        setTimeout(restoreOrFit, 20);
        toast('已复制页面');
      } catch (e) { toast(e.message, true); }
    });
  }

  function projectPanelHtml() {
    const p = S.tree.project;
    const chars = (p.mode === 'scroll') ? '条漫' : (p.mode === 'lianhuanhua' ? '小人书' : '页漫');
    return `
      <div class="cm-section">当前工程</div>
      <div class="cm-field"><label>作品名</label>
        <input type="text" id="pj-title" value="${esc(p.title)}"></div>
      <div class="cm-field"><label>形态 / 阅读方向</label>
        <div class="row">
          <select id="pj-mode">
            <option value="manga" ${p.mode === 'manga' ? 'selected' : ''}>页漫</option>
            <option value="scroll" ${p.mode === 'scroll' ? 'selected' : ''}>条漫</option>
            <option value="lianhuanhua" ${p.mode === 'lianhuanhua' ? 'selected' : ''}>小人书</option>
          </select>
          <select id="pj-dir">
            <option value="right_to_left" ${p.reading_direction === 'right_to_left' ? 'selected' : ''}>右→左</option>
            <option value="left_to_right" ${p.reading_direction === 'left_to_right' ? 'selected' : ''}>左→右</option>
            <option value="top_to_bottom" ${p.reading_direction === 'top_to_bottom' ? 'selected' : ''}>上→下</option>
          </select>
        </div>
      </div>
      <div class="cm-section">默认出图</div>
      <div class="cm-field"><label>模型方案</label>
        <select id="pj-model"></select></div>
      <div class="cm-field"><label>默认步数 <b id="pj-steps-v">${p.steps ?? '方案自带'}</b></label>
        <div class="cm-slider-row">
          <input type="range" id="pj-steps" min="1" max="60" step="1" value="${p.steps ?? 20}">
          <button class="cm-btn cm-mini" id="pj-steps-clear">方案自带</button>
        </div></div>
      <div class="cm-field"><label>默认 CFG <b id="pj-cfg-v">${p.cfg ?? '方案自带'}</b></label>
        <div class="cm-slider-row">
          <input type="range" id="pj-cfg" min="1" max="20" step="0.1" value="${p.cfg ?? 5}">
          <button class="cm-btn cm-mini" id="pj-cfg-clear">方案自带</button>
        </div></div>
      <div class="cm-section">统计</div>
      <div class="hint" style="line-height:2">
        形态：${chars} · 阅读：${p.reading_direction === 'right_to_left' ? '右→左' : (p.reading_direction === 'left_to_right' ? '左→右' : '上→下')}<br>
        分册 ${p.stats?.books || 0} · 页面 ${p.stats?.pages || 0} · 格子 ${p.stats?.cells || 0}<br>
        已完成 ${p.stats?.done || 0} · 待生成 ${p.stats?.pending || 0} · 失败 ${p.stats?.failed || 0}
      </div>
      <div class="cm-section">发布</div>
      <div class="hint">发布后出现在前台「漫画」书架上，读者可翻页 / 滚动阅读。</div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="cm-btn primary" id="pj-publish" style="flex:1;justify-content:center">${p.is_published ? '取消发布' : '发布到前台'}</button>
        <button class="cm-btn" id="pj-open">${p.is_published ? '看前台' : '预览'}</button>
      </div>
    `;
  }

  function bindProjectPanel(box) {
    const p = S.tree.project;
    const save = (patch) => {
      Object.assign(p, patch);
      Admin.put(`${API}/projects/${p.id}`, patch).catch((e) => toast(e.message, true));
    };
    box.querySelector('#pj-title')?.addEventListener('change', (e) => {
      save({ title: e.target.value.trim() || '未命名漫画' });
      loadProjects().then(renderTop);
    });
    box.querySelector('#pj-mode')?.addEventListener('change', (e) => save({ mode: e.target.value }));
    box.querySelector('#pj-dir')?.addEventListener('change', (e) => save({ reading_direction: e.target.value }));
    // 默认步数 / CFG：滑块 + 「方案自带」清空
    [['pj-steps', 'steps', null], ['pj-cfg', 'cfg', (v) => (Math.round(v * 10) / 10).toFixed(1)]].forEach(([id, key, fmt]) => {
      const r = box.querySelector('#' + id), lab = box.querySelector('#' + id + '-v');
      r?.addEventListener('input', () => { if (lab) lab.textContent = fmt ? fmt(Number(r.value)) : r.value; });
      r?.addEventListener('change', () => {
        const v = Number(r.value);
        if (lab) lab.textContent = fmt ? fmt(v) : v;
        save({ [key]: v });
      });
      box.querySelector('#' + id + '-clear')?.addEventListener('click', () => {
        if (lab) lab.textContent = '方案自带';
        save({ [key]: null });
      });
    });

    const modelSel = box.querySelector('#pj-model');
    if (modelSel) {
      const opts = (S.options?.model_presets || []).map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
      modelSel.innerHTML = `<option value="">（跟随全局激活方案）</option>` + opts;
      modelSel.value = p.model_preset || '';
      modelSel.addEventListener('change', (e) => save({ model_preset: e.target.value }));
    }
    box.querySelector('#pj-publish')?.addEventListener('click', togglePublish);
    box.querySelector('#pj-open')?.addEventListener('click', () => {
      if (p.is_published) window.open('/comic', '_blank');
      else openPreview();
    });
  }

  function panelHtml(cell, page, cellDoc) {
    switch (S.tab) {
      case 'param': return paramPanelHtml(cell);
      case 'version': return versionPanelHtml(cell);
      case 'bubble': return bubblePanelHtml(cell);
      case 'fx': return effectPanelHtml(cell);
      default: return layoutPanelHtml(cell, page, cellDoc);
    }
  }

  // 数字参数统一用「滑块 + 可读写数值框」：滑块拖动实时改，数值框可精确输入
  function sliderField(label, id, val, min, max, step, unit) {
    const v = Number(val);
    return `<div class="cm-field"><label>${esc(label)} <b id="${id}-v">${v}</b>${unit ? ' ' + esc(unit) : ''}</label>
      <div class="cm-slider-row">
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}">
        <input type="number" class="cm-num-inline" id="${id}-n" value="${v}" step="${step}" min="${min}" max="${max}">
      </div></div>`;
  }

  // 滑块拖动时填充轨道（金色的已选部分），让“拉到哪”一眼可见
  function setSliderFill(input) {
    if (!input) return;
    const min = Number(input.min), max = Number(input.max), v = Number(input.value);
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct + '%');
  }

  /** 纯数字小字段（不要滑块）：位置/尺寸这类大范围数值，滑杆不好拖也没精度，直接填数字更快 */
  function numField(label, id, val, min, max, step, unit) {
    const v = Number(val);
    return `<div class="cm-field cm-field-tight"><label>${esc(label)}${unit ? ` <span style="opacity:.65">${esc(unit)}</span>` : ''}</label>
      <input type="number" class="num" id="${id}" value="${v}" step="${step}" min="${min}" max="${max}"></div>`;
  }
  function numPair(a, b) { return `<div class="cm-grid2">${a}${b}</div>`; }

  function layoutPanelHtml(cell, page, cellDoc) {
    const pg = page || { width: 900, height: 640 };
    const presets = [
      ['rect', '矩形'], ['trapL', '左斜'], ['trapR', '右斜'],
      ['para', '平行'], ['bowtie', '对称梯形'],
    ];
    return `
      ${cellDoc ? '' : `
      <div class="cm-section">层级与锁定</div>
      <div class="cm-row-inline">
        <input type="number" class="num" id="c-z" value="${cell.z_index || 0}" step="1" min="-10" max="10"
               title="层级（数字越大越靠前）" style="flex:0 0 68px">
        <button class="cm-btn cm-mini" id="c-front">置顶</button>
        <button class="cm-btn cm-mini" id="c-back">置底</button>
        <button class="cm-btn cm-mini ${cell.is_locked ? 'on' : ''}" id="c-lock">${cell.is_locked ? '已锁定' : '锁定'}</button>
      </div>`}

      <div class="cm-section">素材</div>
      <div class="row" style="gap:6px">
        <button class="cm-btn" id="c-pick-img" style="flex:1;justify-content:center">从素材库选图</button>
        <button class="cm-btn danger" id="c-clear-img">清空图</button>
      </div>

      ${cellDoc
        ? '<div class="cm-section">格子尺寸</div>'
        : '<div class="cm-section">位置与尺寸 <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">页面 ' + pg.width + '×' + pg.height + '</span></div>'}
      ${numPair(
        numField('X', 'c-x', cell.x, -200, pg.width + 200, 1),
        numField('Y', 'c-y', cell.y, -200, pg.height + 200, 1),
      )}
      ${numPair(
        numField('宽', 'c-w', cell.w, 30, pg.width + 200, 1),
        numField('高', 'c-h', cell.h, 30, pg.height + 200, 1),
      )}
      ${cellDoc ? '' : `
      <div class="cm-row-inline">
        <span class="cm-inline-lab">旋转（度）</span>
        <input type="number" class="num" id="c-rot" value="${cell.rotation || 0}" step="0.5" min="-180" max="180">
        <button class="cm-btn cm-mini" id="c-rot-reset" style="flex:0 0 50px">归零</button>
      </div>

      <div class="cm-section">斜构图（顶点形状）</div>
      <div class="cm-grid2" style="grid-template-columns:repeat(3,1fr)">
        ${presets.map(([k, n]) => `<button class="cm-btn cm-mini" data-shape="${k}">${n}</button>`).join('')}
      </div>`}

      ${cellDoc ? '' : `
      <div class="cm-section">图片取景</div>
      <div class="cm-field"><label>填充方式</label>
        <select id="c-fit">
          <option value="cover" ${(cell.fit || 'cover') !== 'contain' ? 'selected' : ''}>填充裁切（cover）</option>
          <option value="contain" ${cell.fit === 'contain' ? 'selected' : ''}>完整显示（contain）</option>
        </select>
      </div>
      ${sliderField('缩放', 'c-scale', Number(cell.img_scale || 1), 0.2, 3, 0.01, '×')}
      ${sliderField('水平偏移', 'c-ox', Number(cell.img_offset_x || 0), -50, 50, 1, '%')}
      ${sliderField('垂直偏移', 'c-oy', Number(cell.img_offset_y || 0), -50, 50, 1, '%')}
      <div class="row" style="gap:6px;margin-top:4px">
        <button class="cm-btn cm-mini" id="c-flip">水平翻转</button>
        <button class="cm-btn cm-mini" id="c-reset-img">复位取景</button>
      </div>`}

      ${cellDoc ? '' : `
      <div class="cm-section">格子边框</div>
      <div class="cm-grid2">
        <div class="cm-field"><label>线型</label>
          <select id="c-bs">
            ${[['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['none', '无边框']]
              .map(([v, n]) => `<option value="${v}" ${(cell.border_style || 'solid') === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="cm-field"><label>颜色</label>
          <input type="color" id="c-bc" value="${esc(cell.border_color || '#111111')}" style="height:27px;padding:0">
        </div>
      </div>
      ${sliderField('粗细', 'c-bw', Number(cell.border_width ?? 3), 0, 14, 1, 'px')}
      `}

      <div class="cm-section">格子背景</div>
      <div class="cm-field"><label>背景有无 / 颜色</label>
        <div class="row">
          <select id="c-bgen">
            <option value="1" ${Number(cell.bg_enabled) === 0 ? '' : 'selected'}>有背景</option>
            <option value="0" ${Number(cell.bg_enabled) === 0 ? 'selected' : ''}>无背景（透明，默认）</option>
          </select>
          <input type="color" id="c-bgc" value="${esc(cell.bg_color || '#ffffff')}" style="height:27px;padding:0;flex:0 0 38px">
        </div>
      </div>
    `;
  }

  function promptPanelHtml(cell) {
    const ver = (cell.versions || []).find((v) => v.id === cell.current_version_id);
    const verLabel = ver ? `版本 #${ver.id}${ver.name ? ` · ${ver.name}` : ''}` : '（还没有版本）';
    return `
      <div class="cm-section cm-section-norule">最终提示词预览 <span class="cm-ver-tag">${esc(verLabel)}</span>
        <span style="flex:1"></span>
        <button class="cm-gen-fab" id="c-save" title="把当前提示词保存到这版（不生成新版本、不出图）">${SAVE_ICON}</button>
        <button class="cm-gen-fab" id="c-gen" title="生成此格（ComfyUI）" style="margin-left:5px">${GEN_ICON}</button>
      </div>
      <div class="cm-prompt-preview" id="c-preview">加载中…</div>
      <div class="hint" style="margin:5px 0 2px">拼接顺序：绑定人物（按出场顺序）→ 本格自由正向词；填了「整格手写覆盖」就整段替换。</div>
      <div class="cm-section">人物区块（随绑定自动带入）</div>
      <div id="c-charblock" class="hint">未绑定人物</div>
      <div class="cm-section">本格自由正向词</div>
      <div class="cm-field">
        <textarea id="c-pos" rows="8" style="min-height:170px" placeholder="近景，握紧剑柄抬头望向城门，坚定表情，清晨石板路…">${esc(cell.prompt_positive)}</textarea>
      </div>
      <div class="cm-chips" id="c-snippets"></div>
      <div class="cm-section">整格手写覆盖</div>
      <div class="cm-field">
        <textarea id="c-override" rows="3" placeholder="填了就完全按这段出图，不再拼人物与画风前缀">${esc(cell.prompt_override)}</textarea>
      </div>
    `;
  }

  // 右上角小图标：sparkle = 直接生成此格；person+ = 从人物库添加
  const GEN_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>
      <path d="M18.4 15.2l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/></svg>`;
  const ADD_CHAR_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="9.5" cy="8" r="3.2"/>
      <path d="M3.8 19.2c0-3.1 2.6-5.2 5.7-5.2s5.7 2.1 5.7 5.2"/>
      <path d="M18.2 6.6v5.2M15.6 9.2h5.2"/></svg>`;
  const SAVE_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 4h11l3 3v13H5z"/>
      <path d="M9 4v5h6V4"/>
      <path d="M9 14h6"/></svg>`;

  function charPanelHtml(cell) {
    const list = Array.isArray(cell.characters) ? cell.characters : [];
    return `
      <div class="cm-section cm-section-norule">出场人物
        <span style="flex:1"></span>
        <button class="cm-gen-fab" id="c-add-char" title="从人物库添加">${ADD_CHAR_ICON}</button>
        <button class="cm-gen-fab" id="c-char-gen" title="直接生成此格（ComfyUI）" style="margin-left:5px">${GEN_ICON}</button>
      </div>
      <div class="cm-charlist" id="c-charlist">
        ${list.length ? list.map((r, i) => {
          const ch = (S.characters || []).find((x) => x.id === r.character_id);
          const apps = ch?.appearances || [];
          return `
          <div class="cm-char" data-cid="${r.character_id}" data-idx="${i}">
            ${ch && ch.portrait ? `<img src="${esc(ch.portrait)}">` : '<div class="ph"></div>'}
            <div class="info">
              <div class="nm">${esc(r.name || ch?.name || '人物')}</div>
              <div class="sub">
                ${apps.length > 1
                  ? `<select class="cm-sel" data-app="${i}" style="height:20px;font-size:10.5px;padding:0 3px">
                       ${apps.map((a) => `<option value="${a.id}" ${a.id === r.appearance_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
                     </select>`
                  : `<span>${esc(apps[0]?.name || '默认外观')}</span>`}
              </div>
            </div>
            <div class="ops">
              <button data-up="${i}" title="上移">↑</button>
              <button data-down="${i}" title="下移">↓</button>
              <button data-del="${i}" title="移除">✕</button>
            </div>
          </div>`;
        }).join('') : ''}
      </div>
      <div class="cm-section">附加说明</div>
      <div class="cm-field">
        <textarea id="c-char-note" rows="2" placeholder="例如：阿远在画面左侧，背影，披风被风掀起">${esc(list.map((r) => r.note).filter(Boolean).join('；'))}</textarea>
      </div>
      <div class="cm-section">生成描述</div>
      <div class="cm-prompt-preview" id="c-charprev" style="max-height:180px">绑定人物后这里显示自动拼出的外观描述</div>
    `;
  }

  function paramPanelHtml(cell) {
    return `
      <div class="cm-ov-card ${S.ovOpen['mpe'] != null ? (S.ovOpen['mpe'] ? 'open' : '') : 'open'}" data-ovcard="mpe">
        <div class="hd" data-ovtoggle="mpe"><span class="chev">▶</span><span class="ttl">模型方案（选一套 / 编辑 / 新建）</span></div>
        <div class="bd"><div id="mpe-comic-host"></div></div>
      </div>

      <div class="cm-section">采样参数</div>
      <div class="cm-field"><label>步数 <b id="p-steps-v">${cell.steps ?? '继承'}</b></label>
        <div class="cm-slider-row">
          <input type="range" id="p-steps" min="1" max="60" step="1" value="${cell.steps ?? 20}">
          <button class="cm-btn cm-mini" id="p-steps-clear" title="留空则继承工程">继承</button>
        </div></div>

      <div class="cm-section">出图尺寸</div>
      <div class="cm-sizebox" id="p-size">
        <div class="cm-szrow"><span class="k">格子比例</span><span class="v" id="p-size-cell">—</span></div>
        <div class="cm-szarrow">↓ 按比例自动换算</div>
        <div class="cm-szrow big"><span class="k">出图像素</span><span class="v" id="p-size-px">—</span></div>
        <div class="cm-sznote">长边 1024，短边按格子比例算，并对齐到 16 的倍数</div>
      </div>

      <div class="cm-section">批量</div>
      <button class="cm-btn" id="p-apply-page" style="width:100%;justify-content:center">把本格参数应用到本页所有格</button>
      <div class="hint" style="margin-top:6px">只复制模型方案与步数，不动提示词与人物。</div>
    `;
  }

  // ============== 版本面板（自包含配方：人物 + 前置 + 后置；功能全收进编辑弹窗） ==============
  // 版本列表里「刚点选中的那一版」，按格子记（草稿没有图也能高亮）
  const vSelMap = {};

  function versionPanelHtml(cell) {
    const vers = cell.versions || [];
    // 选中态：优先用刚点过的那一版（草稿也能高亮），否则用后端标记的「当前」
    let cur = vSelMap[cell.id];
    if (cur == null || !vers.some((v) => Number(v.id) === Number(cur))) {
      cur = (vers.find((v) => v.is_selected) || {}).id ?? null;
    }
    return `
      <div class="cm-section cm-section-norule">版本
        <span class="cm-bhead-n">${vers.length}</span>
        <span style="flex:1"></span>
        <button class="cm-iconbtn" id="v-new" title="新建版本（先存草稿，出图后才算成品）" aria-label="新建版本">${ADD_VERSION_ICON}</button>
      </div>
      <div class="cm-vlist" id="cm-vlist">
        ${vers.length ? vers.map((v) => verRowHtml(v, cur)).join('')
          : '<div class="cm-empty-hint" style="padding:18px 8px;line-height:1.7">还没有版本。<br>点右上角的 ＋ 建一个，编辑好人物和提示词再生成。</div>'}
      </div>
    `;
  }

  // 版本行右侧的四个动作图标
  const ADD_VERSION_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="4" y="3.6" width="16" height="16" rx="2.2" stroke-dasharray="3 2.6"/>'
    + '<path d="M12 8.4v7.2M8.4 12h7.2"/></svg>';
  const VIC = {
    edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l4 4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5h5v2M6.5 7l.8 12.2A1.8 1.8 0 0 0 9.1 21h5.8a1.8 1.8 0 0 0 1.8-1.8L17.5 7"/></svg>',
    gen: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6l2.3 2.3M16.1 16.1l2.3 2.3M18.4 5.6l-2.3 2.3M7.9 16.1l-2.3 2.3"/><circle cx="12" cy="12" r="3.1"/></svg>',
  };

  function verRowHtml(v, curId) {
    const isCur = curId != null && Number(curId) === Number(v.id);
    const st = v.is_draft
      ? '<span class="cm-vst draft">草稿</span>'
      : (v.is_selected ? '<span class="cm-vst sel">当前</span>' : '<span class="cm-vst done">成品</span>');
    const thumb = v.image_url
      ? `<img src="${esc(v.image_url)}" loading="lazy" draggable="false">`
      : '<span class="ph">草</span>';
    const n = Array.isArray(v.characters) ? v.characters.length : 0;
    const meta = [`#${v.id}`];
    if (n) meta.push(`${n} 人`);
    if (v.width && v.height) meta.push(`${v.width}×${v.height}`);
    if (v.created_at) meta.push(String(v.created_at).slice(0, 16).replace('T', ' '));
    return `
      <div class="cm-vrow ${isCur ? 'sel' : ''} ${v.is_draft ? 'draft' : ''}" data-ver-row="${v.id}" title="点击选中这一版">
        <div class="pv">${thumb}</div>
        <div class="mi">
          <div class="nm"><span class="vn">${esc(v.name || ('#' + v.id))}</span>${st}</div>
          <div class="meta">${meta.map(esc).join(' · ')}</div>
        </div>
        <div class="cm-vact">
          <button class="cm-vbtn" data-vedit="${v.id}" title="编辑：改名称 / 人物 / 前置·后置提示词">${VIC.edit}</button>
          <button class="cm-vbtn" data-vcopy="${v.id}" title="复制成一个新草稿">${VIC.copy}</button>
          <button class="cm-vbtn danger" data-vdel="${v.id}" title="删除这一版">${VIC.del}</button>
          <button class="cm-vbtn gen" data-vgen="${v.id}" title="用这一版的提示词生图">${VIC.gen}</button>
        </div>
      </div>`;
  }

  const INS_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M12 8v8"/></svg>`;

  const ADD_BUBBLE_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 5.5h16a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H9.2L5 19v-3H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/>
      <path d="M12 8.2v5M9.5 10.7h5"/></svg>`;

  // 版本 → 可编辑草稿。老版本没有配方，把 prompt_positive（历史成品）当「后置」，人物留空避免重复。
  function versionToDraft(v) {
    const legacy = !!v.legacy;
    return {
      id: v.id,
      name: v.name || '',
      prompt_prefix: legacy ? '' : (v.prompt_prefix || ''),
      prompt_suffix: legacy ? (v.prompt_positive || '') : (v.prompt_suffix || ''),
      prompt_override: legacy ? '' : (v.prompt_override || ''),
      characters: legacy ? [] : JSON.parse(JSON.stringify(v.characters || [])),
    };
  }

  function versionEditorBody(v, d) {
    return `
      <div class="ve2">
        <div class="ve2-col">
          <div class="cm-field"><label>版本名称</label>
            <input id="ve-name" class="cm-inp" value="${esc(d.name)}" placeholder="留空就显示 #${v.id}"></div>
          <div class="cm-section cm-section-norule">最终提示词预览
            <span style="flex:1"></span><span class="hint" id="ve-len"></span></div>
          <div class="cm-prompt-preview ve-preview" id="ve-preview">加载中…</div>
          <details class="ve-adv">
            <summary>高级：整段手写覆盖（填了就忽略上面的全部）</summary>
            <textarea id="ve-override" class="cm-ta" rows="4" placeholder="填了就完全按这段出图：前置 / 人物 / 后置 都不再拼">${esc(d.prompt_override)}</textarea>
          </details>
        </div>
        <div class="ve2-col">
          <div class="cm-section cm-section-norule">出场人物
            <span style="flex:1"></span>
            <button class="cm-btn cm-mini" id="ve-addchar">＋ 添加人物</button></div>
          <div class="cm-charlist" id="ve-charlist"></div>
          <div class="cm-section">自定义内容</div>
          <div class="ve-io">
            <div class="ve-io-head">
              <span class="ve-io-ttl">前置 · 拼在人物前面</span>
              <button class="ve-ins" data-ins="prefix" type="button" title="从「提示词管理」插入">${INS_ICON} 插入提示词</button>
            </div>
            <textarea id="ve-prefix" class="cm-ta" rows="4" placeholder="例如：漫画分镜，黑白线稿，网点纸，高对比，机位平视">${esc(d.prompt_prefix)}</textarea>
          </div>
          <div class="ve-io">
            <div class="ve-io-head">
              <span class="ve-io-ttl">后置 · 拼在人物后面</span>
              <button class="ve-ins" data-ins="suffix" type="button" title="从「提示词管理」插入">${INS_ICON} 插入提示词</button>
            </div>
            <textarea id="ve-suffix" class="cm-ta" rows="6" placeholder="例如：近景，握紧剑柄抬头望向城门，坚定表情，清晨石板路">${esc(d.prompt_suffix)}</textarea>
          </div>
        </div>
      </div>`;
  }

  async function openVersionEditor(cell, v, opts = {}) {
    const d = versionToDraft(v);
    // 新建的草稿是「点＋」时先落库拿到 id 的（生图要按 id 提交），
    // 所以用户点关闭/✕ 时要把这条空草稿回收，否则取消也会在列表里留下一个版本。
    let keep = !opts.isNew;
    const dropDraft = () => {
      Admin.del(`${API}/cells/${cell.id}/versions/${v.id}`)
        .then(() => Admin.get(`${API}/cells/${cell.id}`))
        .then((fresh) => { Object.assign(cell, fresh); })
        .catch(() => {})
        .finally(() => { renderInspector(); renderTree(); });
    };
    const m = openModal({
      title: `版本 ${v.name ? esc(v.name) : '#' + v.id} · 编辑`,
      cls: 'cm-ver-editor',
      width: 1326,
      body: versionEditorBody(v, d),
      footer: `
        <button class="cm-btn danger" data-vedel>删除</button>
        <button class="cm-btn" data-vedup title="复制出一个新草稿">复制</button>
        <span style="flex:1"></span>
        <button class="cm-btn" data-x>关闭</button>
        <button class="cm-btn" id="ve-save">保存</button>
        <button class="cm-btn primary" id="ve-savegen">保存并生图</button>`,
      onClose: () => { if (!keep) dropDraft(); },
    });
    const q = (s) => m.root.querySelector(s);
    const nameEl = q('#ve-name'), pre = q('#ve-prefix'), suf = q('#ve-suffix'), ov = q('#ve-override');
    const previewEl = q('#ve-preview'), lenEl = q('#ve-len');

    const sync = () => {
      d.name = (nameEl.value || '').trim();
      d.prompt_prefix = pre.value;
      d.prompt_suffix = suf.value;
      d.prompt_override = ov.value;
    };
    let ptimer = null;
    const doPreview = async () => {
      try {
        const data = await Admin.post(`${API}/cells/${cell.id}/versions/preview`, {
          prompt_prefix: d.prompt_prefix, prompt_suffix: d.prompt_suffix,
          prompt_override: d.prompt_override, characters: d.characters,
        });
        const parts = data.parts || [];
        previewEl.innerHTML = parts.length
          ? parts.map((p) => `<div class="cm-prompt-part"><span class="lb">${esc(p.label)}</span>${esc(p.text)}</div>`).join('')
          : '<span style="color:#7b8296">还没有内容：写前置/后置，或绑人物</span>';
        if (data.override) previewEl.insertAdjacentHTML('afterbegin', '<div style="color:var(--orange);margin-bottom:4px">已整段覆盖，按覆盖内容出图</div>');
        if (lenEl) lenEl.textContent = `${(data.positive || '').length} 字`;
      } catch (e) { previewEl.textContent = '预览失败：' + e.message; }
    };
    const schedulePreview = () => { sync(); clearTimeout(ptimer); ptimer = setTimeout(doPreview, 300); };

    [nameEl, pre, suf, ov].forEach((el) => el && el.addEventListener('input', schedulePreview));
    m.root.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => {
      const isPrefix = b.dataset.ins === 'prefix';
      openPromptPicker({ textarea: isPrefix ? pre : suf, onDone: schedulePreview });
    }));

    const paintChars = () => renderVeChars(m, d, () => { paintChars(); doPreview(); });
    await loadCharacters().catch(() => {});
    paintChars();
    q('#ve-addchar')?.addEventListener('click', () => {
      openCharPickerFor((ch) => {
        if ((d.characters || []).some((r) => r.character_id === ch.id)) { toast('这个人物已在列表里'); return; }
        const def = ((ch.appearances || []).find((a) => a.is_default)) || (ch.appearances || [])[0];
        d.characters.push({ character_id: ch.id, appearance_id: def ? def.id : null, name: ch.name, note: '' });
        paintChars(); doPreview();
      });
    });
    doPreview();

    const save = async () => {
      sync();
      const r = await Admin.put(`${API}/cells/${cell.id}/versions/${v.id}`, {
        name: d.name, prompt_prefix: d.prompt_prefix, prompt_suffix: d.prompt_suffix,
        prompt_override: d.prompt_override, characters: d.characters,
      });
      keep = true;                       // 保存过就算用户要它了，关闭时不再回收
      const arr = cell.versions || [];
      const idx = arr.findIndex((x) => x.id === v.id);
      if (idx >= 0) Object.assign(arr[idx], r.version);
      return r.version;
    };
    q('#ve-save')?.addEventListener('click', async () => {
      try { await save(); renderInspector(); renderTree(); toast('已保存'); }
      catch (e) { toast(e.message, true); }
    });
    q('#ve-savegen')?.addEventListener('click', async () => {
      try {
        await save();
        await Admin.post(`${API}/cells/${cell.id}/versions/${v.id}/generate`, {});
        cell.gen_status = 'queued';
        m.close(); renderStage(); renderInspector(); ensurePolling();
        toast('已提交生图，出图后自动回填到这一版');
      } catch (e) { toast(e.message, true); }
    });
    q('[data-vedup]')?.addEventListener('click', async () => {
      try {
        await save();
        const r = await Admin.post(`${API}/cells/${cell.id}/versions/${v.id}/duplicate`, {});
        const fresh = await Admin.get(`${API}/cells/${cell.id}`);
        Object.assign(cell, fresh);
        m.close(); renderInspector(); renderTree();
        toast('已复制出一个新草稿');
        const nv = (fresh.versions || []).find((x) => x.id === r.version.id);
        if (nv) openVersionEditor(cell, nv);
      } catch (e) { toast(e.message, true); }
    });
    q('[data-vedel]')?.addEventListener('click', async () => {
      if (!await Admin.confirm('删除这个版本？图片文件不会删，但会从版本列表移除。', { danger: true })) return;
      try {
        await Admin.del(`${API}/cells/${cell.id}/versions/${v.id}`);
        keep = true;                     // 已经删了，关闭时别再去删一遍
        const fresh = await Admin.get(`${API}/cells/${cell.id}`);
        Object.assign(cell, fresh);
        m.close(); renderInspector(); renderTree(); renderStage();
        toast('已删除');
      } catch (e) { toast(e.message, true); }
    });
  }

  // 弹窗里的人物列表（改的是 draft.characters，不碰格子）
  function renderVeChars(m, d, onChange) {
    const box = m.root.querySelector('#ve-charlist');
    if (!box) return;
    const list = d.characters || [];
    box.innerHTML = list.length ? list.map((r, i) => {
      const ch = (S.characters || []).find((x) => x.id === r.character_id);
      const apps = ch?.appearances || [];
      return `
        <div class="cm-char" data-ci="${i}">
          ${ch && ch.portrait ? `<img src="${esc(ch.portrait)}">` : '<div class="ph"></div>'}
          <div class="info">
            <div class="nm">${esc(r.name || ch?.name || '人物')}</div>
            <div class="sub">
              ${apps.length > 1
                ? `<select class="cm-sel" data-vapp="${i}" style="height:20px;font-size:10.5px;padding:0 3px">
                     ${apps.map((a) => `<option value="${a.id}" ${a.id === r.appearance_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
                   </select>`
                : `<span>${esc(apps[0]?.name || '默认外观')}</span>`}
            </div>
          </div>
          <div class="ops">
            <button data-vup="${i}" title="上移">↑</button>
            <button data-vdown="${i}" title="下移">↓</button>
            <button data-vdel="${i}" title="移除">✕</button>
          </div>
        </div>`;
    }).join('') : '<div class="hint" style="padding:8px 2px">还没有人物。点右上「＋ 添加人物」。</div>';

    box.querySelectorAll('[data-vup]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.vup);
      if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; onChange(); }
    });
    box.querySelectorAll('[data-vdown]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.vdown);
      if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; onChange(); }
    });
    box.querySelectorAll('[data-vdel]').forEach((b) => b.onclick = () => {
      list.splice(Number(b.dataset.vdel), 1); onChange();
    });
    box.querySelectorAll('[data-vapp]').forEach((s) => s.onchange = () => {
      const i = Number(s.dataset.vapp);
      list[i] = { ...list[i], appearance_id: Number(s.value) };
      onChange();
    });
  }

  // 人物库选择器（回调式，供弹窗把人物加进 draft）
  async function openCharPickerFor(onPick) {
    const list = await loadCharacters();
    const m = openModal({
      title: '人物库 · 点击加入本版',
      cls: 'cm-lib', width: 720,
      body: `<div class="cm-lib-bar">
          <input class="cm-inp" id="lib-q" placeholder="搜索人物名 / 性格" style="flex:1;height:30px">
          <span class="hint" id="lib-count"></span></div>
        <div class="cm-lib-grid" id="lib-grid"></div>`,
      footer: '<button class="cm-btn" data-x>完成</button>',
    });
    const grid = m.body.querySelector('#lib-grid');
    const paint = (kw) => {
      const rows = list.filter((c) => !kw ||
        (c.name || '').toLowerCase().includes(kw) || (c.personality || '').toLowerCase().includes(kw));
      m.body.querySelector('#lib-count').textContent = `${rows.length} 位人物`;
      grid.innerHTML = rows.map((c) => `
        <div class="cm-lib-card" data-cid="${c.id}">
          ${c.portrait ? `<img src="${esc(c.portrait)}">` : '<div class="ph">☺</div>'}
          <span class="tag">${(c.appearances || []).length} 套外观</span>
          <div class="n">${esc(c.name)}</div>
        </div>`).join('') || '<div class="hint">没有匹配的人物</div>';
      grid.querySelectorAll('[data-cid]').forEach((el) => el.addEventListener('click', () => {
        const ch = list.find((x) => x.id === Number(el.dataset.cid));
        if (ch) { onPick(ch); el.classList.add('on'); }
      }));
    };
    paint('');
    m.body.querySelector('#lib-q')?.addEventListener('input', (e) => paint(e.target.value.trim().toLowerCase()));
  }

  // 插入提示词：统一走全局「提示词浮窗」（可拖动、置顶、无遮罩、按光标插入）
  function openPromptPicker({ textarea, onDone }) {
    if (!window.PromptPad) { toast('提示词浮窗未加载', true); return; }
    PromptPad.open({ target: textarea, onPick: () => { if (onDone) onDone(); } });
  }

  // 气泡参数用「标签 + 滑块」紧凑排布（数字参数一律滑块调节）
  function miniSlider(label, attr, i, val, min, max, step, unit) {
    const v = Number(val) || 0;
    return `<div class="cm-field" style="margin-top:4px"><label>${esc(label)}
        <b data-${attr}-v="${i}">${v}</b>${unit ? ' ' + esc(unit) : ''}</label>
      <input type="range" data-${attr}="${i}" min="${min}" max="${max}" step="${step}" value="${v}" style="width:100%">
    </div>`;
  }

  const BUBBLE_TYPES = [
    ['speech', '对话'], ['round', '圆形'], ['rect', '方形'], ['soft', '胶囊'],
    ['narration', '旁白'], ['thought', '思考'], ['cloud', '云朵'],
    ['shout', '爆炸'], ['rage', '暴躁'],
  ];

  // 气泡 / 特效共用的一行：左右翻转、上下翻转、锁定、层级
  const OV_LOCK_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/>
    <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1"/></svg>`;
  function ovCommonRow(i, b) {
    const layer = ovLayer(b);
    const tg = (on, attr, val, icon, tip) =>
      `<button type="button" class="cm-tg${on ? ' on' : ''}" data-${attr}="${i}" data-v="${val}" title="${tip}">${icon}</button>`;
    return `
      <div class="cm-ovrow">
        <div class="cm-tggrp">
          ${tg(!!b.flip_h, 'ovflip', 'h', '⇔', '左右翻转')}
          ${tg(!!b.flip_v, 'ovflip', 'v', '⇕', '上下翻转')}
          ${tg(!!b.locked, 'ovlock', '1', OV_LOCK_SVG, b.locked ? '已锁定，点一下解锁' : '锁定后鼠标可穿透，能拖下面的格子')}
        </div>
        <select class="cm-bsel" data-ovlayer="${i}" title="与格子的层级关系">
          <option value="in"${layer === 'in' ? ' selected' : ''}>放在格子里</option>
          <option value="under"${layer === 'under' ? ' selected' : ''}>压在格子下（被画面挡住）</option>
          <option value="out"${layer === 'out' ? ' selected' : ''}>浮到格子外（盖住格子）</option>
        </select>
      </div>`;
  }

  function bubblePanelHtml(cell) {
    const list = Array.isArray(cell.bubbles) ? cell.bubbles : [];
    // 画布上选中了哪一条，面板里就把它高亮、其余变灰
    const selIdx = (S.overlay && S.overlay.type === 'bubble' && S.overlay.cellId === cell.id) ? S.overlay.index : -1;
    const card = (b, i) => {
      const key = 'bubble:' + i;
      const isSel = i === selIdx;
      const open = S.ovOpen[key] != null ? S.ovOpen[key] : (i === 0);
      const cls = 'cm-ov-card' + (open ? ' open' : '') + (isSel ? ' sel' : '') + (selIdx >= 0 && !isSel ? ' dim' : '');
      const title = (b.text || '').trim().slice(0, 14) || ('气泡 ' + (i + 1));
      const typeLabel = (BUBBLE_TYPES.find((t) => t[0] === (b.type || 'speech')) || [, '对话'])[1];
      const alpha = Math.round((b.bg_alpha == null ? 1 : Number(b.bg_alpha)) * 100);
      return `
      <div class="${cls}" data-ovcard="${key}" data-ovidx="${i}">
        <div class="hd" data-ovtoggle="${key}">
          <span class="chev">▶</span>
          <span class="ttl">${esc(title)}</span>
          <span class="badge">${typeLabel}</span>
          <span class="x" data-ovdel="${key}" title="删除">✕</span>
        </div>
        <div class="bd">
          ${ovCommonRow(i, b)}
          <textarea class="cm-btxt" rows="4" data-btext="${i}" placeholder="输入台词，回车换行">${esc(b.text || '')}</textarea>

          <div class="cm-brow3">
            <label class="cm-f"><span>字号 <b data-bsize-v="${i}">${b.size || 13}</b></span>
              <input type="range" data-bsize="${i}" min="8" max="40" step="1" value="${b.size || 13}">
            </label>
            <div class="cm-f"><span>对齐</span>
              <div class="cm-align">
                ${[['left', '左'], ['center', '中'], ['right', '右']].map(([v, n]) => `<button type="button" class="cm-align-btn ${(b.align || 'center') === v ? 'on' : ''}" data-balign="${i}" data-v="${v}" title="文字${n}对齐">${n}</button>`).join('')}
              </div>
            </div>
            <label class="cm-f"><span>方向</span>
              <select data-bdir="${i}" class="cm-bsel">
                <option value="h" ${(b.direction || 'h') === 'h' ? 'selected' : ''}>横排</option>
                <option value="v" ${(b.direction || 'h') === 'v' ? 'selected' : ''}>竖排</option>
              </select>
            </label>
          </div>

          <div class="cm-sub">台词框</div>
          <div class="cm-brow4">
            <label class="cm-f"><span>气泡样式</span>
              <select data-btype="${i}">${BUBBLE_TYPES.map(([v, n]) => `<option value="${v}" ${(b.type || 'speech') === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
            </label>
            <label class="cm-f"><span>底色</span><input type="color" data-bbbg="${i}" value="${b.bg || '#ffffff'}"></label>
            <label class="cm-f"><span>文字</span><input type="color" data-bcolor="${i}" value="${b.color || '#111111'}"></label>
            <label class="cm-f"><span>描边</span><input type="color" data-bborder="${i}" value="${b.border || '#111111'}"></label>
          </div>
          <div class="cm-row-inline cm-brow" style="margin-top:7px">
            <span class="cm-inline-lab">底透明度</span>
            <input type="range" data-bbgop="${i}" min="0" max="100" step="1" value="${alpha}" style="flex:1 1 0;min-width:0">
            <b class="cm-inline-val" data-bbgop-v="${i}">${alpha}</b><span class="cm-u">%</span>
          </div>

          <div class="cm-sub">尾巴<span class="cm-sub-hint">指向说话的人</span></div>
          <div class="cm-brow4">
            <label class="cm-f"><span>样式</span>
              <select data-btail="${i}">${TAIL_KINDS.map(([v, n]) => `<option value="${v}" ${bubbleTailKind(b) === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
            </label>
            <label class="cm-f"><span>角度 <b data-bta-v="${i}">${Math.round(b.tail_angle ?? 132)}</b>°</span>
              <input type="range" data-bta="${i}" min="0" max="359" step="1" value="${Math.round(b.tail_angle ?? 132)}">
            </label>
            <label class="cm-f"><span>长度 <b data-btl-v="${i}">${Math.round(b.tail_len ?? 30)}</b></span>
              <input type="range" data-btl="${i}" min="3" max="80" step="1" value="${Math.round(b.tail_len ?? 30)}">
            </label>
            <label class="cm-f"><span>粗细 <b data-btw-v="${i}">${Math.round(b.tail_w ?? 14)}</b></span>
              <input type="range" data-btw="${i}" min="3" max="60" step="1" value="${Math.round(b.tail_w ?? 14)}">
            </label>
          </div>

          <div class="cm-sub">边框<span class="cm-sub-hint">可单独关闭</span></div>
          <div class="cm-grid2">
            <div class="cm-field"><label>线型</label>
              <select data-bbstyle="${i}">
                ${[['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['double', '双线'], ['none', '无边框']].map(([v, n]) => `<option value="${v}" ${(b.border_style || 'solid') === v ? 'selected' : ''}>${n}</option>`).join('')}
              </select>
            </div>
            <div class="cm-field"><label>粗细（px，0 = 无）</label>
              <input type="number" class="num" data-bbw="${i}" value="${b.border_width ?? 2}" step="1" min="0" max="14">
            </div>
          </div>
        </div>
      </div>`;
    };
    return `
      <div class="cm-section cm-section-norule cm-bhead">
        <span>台词气泡</span><span class="cm-bhead-n">${list.length}</span>
        <span style="flex:1"></span>
        <button class="cm-iconbtn" id="b-add" title="添加台词气泡" aria-label="添加台词气泡">${ADD_BUBBLE_ICON}</button>
      </div>
      <div id="b-list">
        ${list.length ? list.map(card).join('') : '<div class="cm-empty-hint" style="padding:16px 8px;line-height:1.7">还没有台词。<br>点右上角的 ＋ 添加一个气泡。</div>'}
      </div>
    `;
  }

  /** 某个特效的形状参数（按类型生成，不同类型只显示自己那几个） */
  function fxParamHtml(b, i, type) {
    const list = FX_PARAMS[type] || [];
    if (!list.length) return '';
    const mode = b.mode || 'radial';
    const keep = (p) => {
      if (type !== 'speedlines') return true;
      if (p.k === 'jit') return mode !== 'radial';               // 疏密只对平行线有意义
      if (p.k === 'cx' || p.k === 'cy') return mode === 'radial'; // 焦点只对中心发散有意义
      return true;
    };
    const field = (p) => {
      if (p.t === 'color') {
        return `<label class="cm-f"><span>${p.l}</span>
          <input type="color" data-${p.a}="${i}" value="${b[p.k] || p.def}">
        </label>`;
      }
      if (p.opts) {
        const cur = b[p.k] || p.def;
        return `<label class="cm-f"><span>${p.l}</span>
          <select data-${p.a}="${i}">
            ${p.opts.map(([v, n]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>`;
      }
      const d = b[p.k] == null ? p.def : Number(b[p.k]);
      const v = FX_PCT[p.k] ? Math.round(d * 100) : d;
      const shown = p.dec ? v.toFixed(p.dec) : Math.round(v);
      return `<label class="cm-f"><span>${p.l} <b data-${p.a}-v="${i}">${shown}</b></span>
        <input type="range" data-${p.a}="${i}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">
      </label>`;
    };
    const modeSel = type !== 'speedlines' ? '' : `
      <label class="cm-f"><span>方向</span>
        <select data-fxmode="${i}">
          ${[['radial', '中心发散'], ['h', '横向'], ['v', '纵向'], ['hv', '左右对撞']].map(([v, n]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>`;
    return `<div class="cm-fxgrid">${[modeSel, ...list.filter(keep).map(field)].join('')}</div>`;
  }

  function effectPanelHtml(cell) {
    const list = Array.isArray(cell.effects) ? cell.effects : [];
    const selIdx = (S.overlay && S.overlay.type === 'fx' && S.overlay.cellId === cell.id) ? S.overlay.index : -1;
    const card = (b, i) => {
      const key = 'fx:' + i;
      const isSel = i === selIdx;
      const open = S.ovOpen[key] != null ? S.ovOpen[key] : (i === 0);
      const cls = 'cm-ov-card' + (open ? ' open' : '') + (isSel ? ' sel' : '') + (selIdx >= 0 && !isSel ? ' dim' : '');
      const def = fxDef(b.type);
      const type = b.type || 'explosion';
      const title = def.name + ' #' + (i + 1);
      const op = Math.round((b.opacity != null ? Number(b.opacity) : 1) * 100);
      return `
      <div class="${cls}" data-ovcard="${key}" data-ovidx="${i}">
        <div class="hd" data-ovtoggle="${key}">
          <span class="chev">▶</span>
          <span class="ttl">${esc(title)}</span>
          ${b.locked ? '<span class="lk" title="已锁定">🔒</span>' : ''}
          <span class="x" data-ovdel="${key}" title="删除">✕</span>
        </div>
        <div class="bd">
          ${ovCommonRow(i, b)}
          <div class="cm-fxrow">
            <label class="cm-f"><span>类型</span>
              <select data-fxtype="${i}">${FX_ORDER.map((t) => `<option value="${t}" ${type === t ? 'selected' : ''}>${FX_LIB[t].name}</option>`).join('')}</select>
            </label>
            <label class="cm-f"><span>颜色</span>
              <input type="color" data-fxcolor="${i}" value="${b.color || '#111111'}">
            </label>
            <label class="cm-f"><span>不透明度 <b data-fxo-v="${i}">${op}</b>%</span>
              <input type="range" data-fxo="${i}" min="0" max="100" step="1" value="${op}">
            </label>
          </div>
          ${fxParamHtml(b, i, type)}
        </div>
      </div>`;
    };
    return `
      <div class="cm-section">特效素材库（点一下加到格子）</div>
      <div class="cm-fx-palette">
        ${FX_ORDER.map((t) => `<button class="cm-fx-chip" data-fxadd="${t}"><span class="ic">${FX_LIB[t].icon}</span><span>${FX_LIB[t].name}</span></button>`).join('')}
      </div>
      <div class="cm-section">已放置（${list.length}）</div>
      <div id="fx-list">
        ${list.length ? list.map(card).join('') : '<div class="hint">还没有特效，点上面的素材加一个</div>'}
      </div>
    `;
  }

  /* --- 面板事件绑定 --- */
  function bindPanel(box, cell) {
    const num = (id) => box.querySelector(id);

    const patch = (p, opt = {}) => {
      // 记录改前的值，供撤销用（必须在 Object.assign 之前取）
      const keys = Object.keys(p);
      const hkey = cell.id + ':' + keys.join(',');
      const before = {};
      if (!opt.noHist) {
        keys.forEach((k) => { before[k] = histClone(cell[k]); });
        // 拖动滑块会连发几十次 patch，只保留这一串操作的「最初始值」
        if (!S.histPending) S.histPending = {};
        if (!S.histPending[hkey]) S.histPending[hkey] = before;
      }
      Object.assign(cell, p);
      const apply = () => {
        const el = document.querySelector(`.cm-cell[data-cell="${cell.id}"]`);
        if (el && !opt.noRestyle) restyleCell(el, cell);
      };
      apply();
      clearTimeout(S.saveTimers[cell.id]);
      const commit = () => {
        if (opt.noHist) return;
        const first = (S.histPending && S.histPending[hkey]) || before;
        if (S.histPending) delete S.histPending[hkey];
        const after = {};
        keys.forEach((k) => { after[k] = histClone(cell[k]); });
        histPushFields(opt.label || histLabel(keys), [[cell.id, first, after]], hkey);
      };
      const run = async () => {
        try {
          const fresh = await Admin.put(`${API}/cells/${cell.id}`, p);
          Object.assign(cell, {
            current_image: fresh.current_image,
            current_version_id: fresh.current_version_id,
            gen_status: fresh.gen_status,
          });
          if (!opt.silent) renderTree();
        } catch (e) { toast(e.message, true); }
        commit();
      };
      if (opt.debounce) S.saveTimers[cell.id] = setTimeout(run, opt.debounce);
      else run();
    };

    // 叠加层卡片：折叠 / 删除（气泡与特效共用 data-ovtoggle / data-ovdel）
    box.querySelectorAll('[data-ovtoggle]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.dataset.ovtoggle;
      const type = key.split(':')[0];
      const idx = Number((key.split(':')[1]) || '0');
      const isOv = (type === 'fx' || type === 'bubble');
      const cur = S.overlay;
      const isSel = isOv && cur && cur.cellId === cell.id && cur.type === type && cur.index === idx;
      // 点还没选中的卡片 = 在面板里选中它（画布同步高亮、自动展开）；再点已选中的才折叠
      if (isOv && !isSel) { selectOverlay(cell.id, type, idx, false); return; }
      S.ovOpen[key] = !(S.ovOpen[key] != null ? S.ovOpen[key] : idx === 0);
      renderInspector();
    }));
    // 卡片空白处点一下也等于选中（表单控件不动，避免打断滑块拖动 / 取色器）
    box.querySelectorAll('[data-ovcard][data-ovidx]').forEach((cd) => {
      cd.addEventListener('click', (e) => {
        if (e.target.closest('input,select,textarea,button,label,.cm-align,.hd,.x')) return;
        const type = (cd.dataset.ovcard || '').split(':')[0];
        if (type !== 'fx' && type !== 'bubble') return;
        const i = Number(cd.dataset.ovidx);
        const cur = S.overlay;
        if (cur && cur.cellId === cell.id && cur.type === type && cur.index === i) return;
        selectOverlay(cell.id, type, i, false);
      });
    });
    box.querySelectorAll('[data-ovdel]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.dataset.ovdel;
      const type = key.split(':')[0];
      const i = Number(key.split(':')[1]);
      if (type === 'fx') {
        const list = [...(cell.effects || [])];
        list.splice(i, 1);
        patch({ effects: list });
      } else {
        const list = [...(cell.bubbles || [])];
        list.splice(i, 1);
        patch({ bubbles: list });
      }
      if (S.overlay && S.overlay.type === type && S.overlay.index === i) clearOverlay();
      renderInspector(); renderStage();
    }));

    if (S.tab === 'layout') {
      // 数字参数统一走滑块：range 与可读写数值框双向同步
      const bindSlider = (id, key, opt = {}) => {
        const r = num('#' + id), n = num('#' + id + '-n'), lab = num('#' + id + '-v');
        if (!r) return;
        const set = (raw) => {
          let v = Number(raw);
          if (isNaN(v)) v = 0;
          if (lab) lab.textContent = (key === 'img_scale') ? v.toFixed(2) : v;
          if (n && document.activeElement !== n) n.value = v;
          if (r.value != v) r.value = v;
          setSliderFill(r);
          patch({ [key]: v }, opt);
          if (opt.restage) renderStage();
        };
        setSliderFill(r);
        r.addEventListener('input', () => set(r.value));
        n?.addEventListener('input', (e) => { r.value = e.target.value; set(e.target.value); });
        n?.addEventListener('change', (e) => { r.value = e.target.value; set(e.target.value); });
      };
      // 纯数字字段（X / Y / 宽 / 高 / 旋转 / 层级）：已去掉滑块，直接绑定数字框
      const bindNum = (id, key, opt = {}) => {
        const n = num('#' + id);
        if (!n) return;
        const set = (raw) => {
          let v = Number(raw);
          if (isNaN(v)) v = 0;
          patch({ [key]: v }, opt);
          if (opt.restage) renderStage();
        };
        n.addEventListener('input', (e) => set(e.target.value));
        n.addEventListener('change', (e) => set(e.target.value));
      };
      bindNum('c-x', 'x', { restage: true });
      bindNum('c-y', 'y', { restage: true });
      bindNum('c-w', 'w', { restage: true });
      bindNum('c-h', 'h', { restage: true });
      bindNum('c-rot', 'rotation', { restage: true });
      bindNum('c-z', 'z_index', { restage: true });
      bindSlider('c-bw', 'border_width', { restage: true });
      bindSlider('c-op', 'opacity');
      bindSlider('c-scale', 'img_scale');
      bindSlider('c-ox', 'img_offset_x');
      bindSlider('c-oy', 'img_offset_y');
      num('#c-rot-reset')?.addEventListener('click', () => {
        num('#c-rot').value = 0; if (num('#c-rot-n')) num('#c-rot-n').value = 0;
        patch({ rotation: 0 }, { restage: true });
      });
      box.querySelectorAll('[data-shape]').forEach((b) => b.addEventListener('click', () => {
        patch({ points: shapePoints(b.dataset.shape) });
        renderStage();
      }));
      // (线宽已改为滑块绑定，见上方 bindSlider)
      num('#c-bc')?.addEventListener('input', (e) => patch({ border_color: e.target.value }, { debounce: 200 }));
      num('#c-bs')?.addEventListener('change', (e) => { patch({ border_style: e.target.value }); renderStage(); });
      // 格子背景：有无 + 颜色
      num('#c-bgen')?.addEventListener('change', (e) => {
        patch({ bg_enabled: Number(e.target.value) ? 1 : 0 });
        renderStage();
      });
      num('#c-bgc')?.addEventListener('input', (e) => patch({ bg_color: e.target.value }, { debounce: 200 }));
      // (不透明度已改为滑块绑定，见上方 bindSlider)
      num('#c-fit')?.addEventListener('change', (e) => patch({ fit: e.target.value }));
      // (缩放已改为滑块绑定，见上方 bindSlider)
      // (水平/垂直偏移已改为滑块绑定，见上方 bindSlider)
      num('#c-flip')?.addEventListener('click', () => { patch({ flip_h: cell.flip_h ? 0 : 1 }); renderStage(); });
      num('#c-reset-img')?.addEventListener('click', () => {
        patch({ img_scale: 1, img_offset_x: 0, img_offset_y: 0, flip_h: 0 });
        renderInspector(); renderStage();
      });
      // 置顶 / 置底：改完顺手把层级数字框同步一下（不整块重画面板，避免闪）
      const syncZ = (v) => { const n = num('#c-z'); if (n) n.value = v; };
      num('#c-front')?.addEventListener('click', () => {
        const max = Math.max(...(currentPage().cells || []).map((c) => c.z_index || 0));
        patch({ z_index: max + 1 }); syncZ(max + 1); renderStage();
      });
      num('#c-back')?.addEventListener('click', () => {
        const min = Math.min(...(currentPage().cells || []).map((c) => c.z_index || 0));
        patch({ z_index: min - 1 }); syncZ(min - 1); renderStage();
      });
      num('#c-lock')?.addEventListener('click', () => {
        patch({ is_locked: cell.is_locked ? 0 : 1 });
        renderInspector(); renderStage();
      });
      num('#c-pick-img')?.addEventListener('click', async () => {
        if (!window.AssetPicker) return toast('素材选择器未加载', true);
        const asset = await AssetPicker.open({ kind: 'all', currentUrl: cell.current_image || '', title: '为这一格选图' });
        if (!asset || !asset.url) return;
        try {
          const fresh = await Admin.post(`${API}/cells/${cell.id}/image`, { url: asset.url, note: '手动选图' });
          Object.assign(cell, fresh);
          renderStage(); renderInspector(); renderTree();
          toast('已设为当前图');
        } catch (e) { toast(e.message, true); }
      });
      num('#c-clear-img')?.addEventListener('click', async () => {
        if (!await Admin.confirm('清空这一格的当前图？版本历史仍保留，可以随时选回来。', { danger: true })) return;
        try {
          const fresh = await Admin.post(`${API}/cells/${cell.id}/clear-image`, {});
          Object.assign(cell, fresh);
          renderStage(); renderTree(); renderInspector();
        } catch (e) { toast(e.message, true); }
      });
    }

    if (S.tab === 'prompt') {
      const ta = num('#c-pos');
      ta?.addEventListener('input', (e) => patch({ prompt_positive: e.target.value }, { debounce: 500, noRestyle: true, silent: true }));
      const ov = num('#c-override');
      ov?.addEventListener('input', (e) => patch({ prompt_override: e.target.value }, { debounce: 500, noRestyle: true, silent: true }));
      [ta, ov].forEach((el) => el?.addEventListener('input', () => {
        clearTimeout(S.promptTimer);
        S.promptTimer = setTimeout(() => refreshPromptPreview(cell), 550);
      }));
      const sp = num('#c-snippets');
      if (sp) {
        const snips = (S.options?.snippets || []).slice(0, 24);
        sp.innerHTML = snips.map((s, i) => `<span class="cm-chip" data-snip="${i}">${esc(s.name)}</span>`).join('');
        sp.querySelectorAll('[data-snip]').forEach((c) => c.addEventListener('click', () => {
          const sn = snips[Number(c.dataset.snip)];
          const cur = ta.value;
          ta.value = cur ? cur.replace(/[，,]\s*$/, '') + '，' + sn.text : sn.text;
          patch({ prompt_positive: ta.value }, { debounce: 400, noRestyle: true, silent: true });
          refreshPromptPreview(cell);
        }));
      }
      num('#c-gen')?.addEventListener('click', () => generateSelected());
      // 保存：只把当前提示词写进当前版本，不新增版本、不出图
      num('#c-save')?.addEventListener('click', async () => {
        try {
          const p = {
            prompt_positive: ta ? ta.value : (cell.prompt_positive || ''),
            prompt_override: ov ? ov.value : (cell.prompt_override || ''),
          };
          Object.assign(cell, p);
          await Admin.put(`${API}/cells/${cell.id}`, p);
          const fresh = await Admin.post(`${API}/cells/${cell.id}/versions/current/save-prompt`, {});
          Object.assign(cell, fresh);
          renderInspector(); renderTree(); renderStage();
          toast('提示词已保存到当前版本');
        } catch (e) { toast(e.message, true); }
      });
      refreshPromptPreview(cell);
    }

    if (S.tab === 'char') {
      num('#c-char-gen')?.addEventListener('click', () => generateSelected());
      num('#c-add-char')?.addEventListener('click', () => openCharacterPicker(cell));
      box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => moveChar(cell, Number(b.dataset.up), -1)));
      box.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => moveChar(cell, Number(b.dataset.down), 1)));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        const list = [...(cell.characters || [])];
        list.splice(Number(b.dataset.del), 1);
        patch({ characters: list }, { noRestyle: true });
        renderInspector(); renderStage();
      }));
      box.querySelectorAll('[data-app]').forEach((s) => s.addEventListener('change', () => {
        const i = Number(s.dataset.app);
        const list = [...(cell.characters || [])];
        list[i] = { ...list[i], appearance_id: Number(s.value) };
        patch({ characters: list }, { noRestyle: true });
        toast('已切换外观');
      }));
      // 本格人物说明：随输入实时保存（防抖），并刷新提示词/人物预览，
      // 但「不重建整个面板」——避免每次敲字都把焦点和提示词框刷掉。
      let noteTimer = null;
      num('#c-char-note')?.addEventListener('input', (e) => {
        const parts = e.target.value.split(/[；;]/).map((s) => s.trim());
        const list = (cell.characters || []).map((r, i) => ({ ...r, note: parts[i] || '' }));
        patch({ characters: list }, { debounce: 400, noRestyle: true, silent: true });
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => {
          refreshCharPreview(cell);
          refreshPromptPreview(cell);
        }, 460);
      });
      refreshCharPreview(cell);
    }

    if (S.tab === 'param') {
      const bindNumSlider = (id, key, fmt) => {
        const r = num('#' + id), lab = num('#' + id + '-v');
        r?.addEventListener('input', () => {
          if (lab) lab.textContent = r.value;
        });
        r?.addEventListener('change', () => {
          const v = Number(r.value);
          if (lab) lab.textContent = fmt ? fmt(v) : v;
          patch({ [key]: v });
        });
        num('#' + id + '-clear')?.addEventListener('click', () => {
          if (lab) lab.textContent = '继承';
          patch({ [key]: null });
          renderInspector();
        });
      };
      bindNumSlider('p-steps', 'steps');
      num('#p-apply-page')?.addEventListener('click', async () => {
        const page = currentPage();
        const patchData = {
          model_preset: cell.model_preset,
          steps: cell.steps,
        };
        for (const c of page.cells) {
          if (c.id === cell.id) continue;
          try {
            await Admin.put(`${API}/cells/${c.id}`, patchData);
            Object.assign(c, patchData);
          } catch (_) {}
        }
        toast(`已应用到本页 ${page.cells.length - 1} 格`);
      });
      const sizeBox = num('#p-size');
      if (sizeBox) {
        const s = calcSize(cell.w, cell.h);
        const g = (a, b) => (b ? g(b, a % b) : a);
        const gw = Math.round(cell.w), gh = Math.round(cell.h);
        const d = g(gw, gh) || 1;
        const rw = gw / d, rh = gh / d;
        // 约得出小整数比就写 4:3，约不出来（如 1144×1658）写小数比更好懂
        const ratio = (rw <= 12 && rh <= 12) ? `${rw}:${rh}` : `${(gw / gh).toFixed(2)} : 1`;
        const cellEl = num('#p-size-cell');
        const pxEl = num('#p-size-px');
        if (cellEl) cellEl.textContent = `${gw} × ${gh} （${ratio}）`;
        if (pxEl) pxEl.textContent = `${s[0]} × ${s[1]} px`;
      }
      // 复用「模型方案编辑器」控件（与 ComfyUI 设置页同一套，统一维护一处即可）
      const mpeHost = num('#mpe-comic-host');
      if (mpeHost && window.ModelPresetEditor) {
        ModelPresetEditor.mount(mpeHost, {
          current: cell.model_preset || '',
          compact: true,
          onSelect: (name) => {
            patch({ model_preset: name || null });
          },
        });
      }
    }

    if (S.tab === 'version') {
      // 版本列表不在页面树里（一起返回太重），进这个标签时单独拉一次
      if (!cell.versions) {
        Admin.get(`${API}/cells/${cell.id}`).then((fresh) => {
          Object.assign(cell, fresh);
          if (S.cellId === cell.id && S.tab === 'version') renderInspector();
        }).catch(() => {});
      }
      num('#v-new')?.addEventListener('click', async () => {
        try {
          const r = await Admin.post(`${API}/cells/${cell.id}/versions`, {});
          const fresh = await Admin.get(`${API}/cells/${cell.id}`);
          Object.assign(cell, fresh);
          renderInspector();
          const nv = (fresh.versions || []).find((x) => x.id === r.version.id);
          if (nv) openVersionEditor(cell, nv, { isNew: true });
        } catch (e) { toast(e.message, true); }
      });
      // ── 版本行：点一下＝选中（立刻在画布显形），右侧四个图标才做动作 ──
      const pickRow = async (vid) => {
        const v = (cell.versions || []).find((x) => x.id === vid);
        if (!v) return;
        vSelMap[cell.id] = vid;                 // 先把高亮切过去，手感立刻有
        if (!v.image_url) {
          renderInspector();
          toast('这一版还是草稿，点右边的「生图」出图', true);
          return;
        }
        try {
          const fresh = await Admin.post(`${API}/cells/${cell.id}/versions/${vid}/select`, {});
          Object.assign(cell, fresh);
          renderStage(); renderTree(); renderInspector();
          toast('已切换到「' + (v.name || '#' + vid) + '」');
        } catch (e) { toast(e.message, true); }
      };

      box.querySelectorAll('[data-ver-row]').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.cm-vbtn')) return;   // 点图标不触发选中
          pickRow(Number(row.dataset.verRow));
        });
      });
      const findVer = (id) => (cell.versions || []).find((x) => x.id === id);
      box.querySelectorAll('[data-vedit]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = findVer(Number(b.dataset.vedit));
        if (v) openVersionEditor(cell, v);
      }));
      box.querySelectorAll('[data-vcopy]').forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const vid = Number(b.dataset.vcopy);
        try {
          const r = await Admin.post(`${API}/cells/${cell.id}/versions/${vid}/duplicate`, {});
          const fresh = await Admin.get(`${API}/cells/${cell.id}`);
          Object.assign(cell, fresh);
          vSelMap[cell.id] = r.version.id;
          renderInspector(); toast('已复制出一个新草稿');
        } catch (err) { toast(err.message, true); }
      }));
      box.querySelectorAll('[data-vdel]').forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const vid = Number(b.dataset.vdel);
        const v = findVer(vid);
        if (!await Admin.confirm(`删除版本「${(v && v.name) || ('#' + vid)}」？图片文件不会删，但会从列表移除。`, { danger: true })) return;
        try {
          await Admin.del(`${API}/cells/${cell.id}/versions/${vid}`);
          const fresh = await Admin.get(`${API}/cells/${cell.id}`);
          Object.assign(cell, fresh);
          delete vSelMap[cell.id];
          renderStage(); renderTree(); renderInspector(); toast('已删除');
        } catch (err) { toast(err.message, true); }
      }));
      box.querySelectorAll('[data-vgen]').forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const vid = Number(b.dataset.vgen);
        try {
          await Admin.post(`${API}/cells/${cell.id}/versions/${vid}/generate`, {});
          cell.gen_status = 'queued';
          renderStage(); renderInspector(); ensurePolling();
          toast('已提交生图，出图后回填到这一版');
        } catch (err) { toast(err.message, true); }
      }));
    }

    // 气泡 / 特效共用的三项：左右翻转、上下翻转、锁定、层级（压在格子下 / 格子里 / 格子外）
    if (S.tab === 'bubble' || S.tab === 'fx') {
      const type = S.tab;
      const key = type === 'fx' ? 'effects' : 'bubbles';
      const rec = (i) => ((cell[key] || [])[i] || {});
      box.querySelectorAll('[data-ovflip]').forEach((el) => el.addEventListener('click', () => {
        const i = Number(el.dataset.ovflip);
        const prop = el.dataset.v === 'v' ? 'flip_v' : 'flip_h';
        setOvFields(cell.id, type, i, { [prop]: rec(i)[prop] ? 0 : 1 },
          { label: prop === 'flip_v' ? '上下翻转' : '左右翻转' });
      }));
      box.querySelectorAll('[data-ovlock]').forEach((el) => el.addEventListener('click', () => {
        const i = Number(el.dataset.ovlock);
        const on = !rec(i).locked;
        setOvFields(cell.id, type, i, { locked: on ? 1 : 0 },
          { label: on ? '锁定叠加层' : '解锁叠加层', restage: true });
      }));
      box.querySelectorAll('[data-ovlayer]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.ovlayer);
        setOvFields(cell.id, type, i, { layer: el.value }, { label: '调整叠加层层级', restage: true });
      }));
    }

    if (S.tab === 'bubble') {
      num('#b-add')?.addEventListener('click', () => {
        const list = [...(cell.bubbles || [])];
        list.push({ type: 'speech', text: '说点什么…', x: 12, y: 10 + (list.length * 8), w: 38, h: 0, size: 13 });
        patch({ bubbles: list });
        renderInspector(); renderStage();
      });
      box.querySelectorAll('[data-btext]').forEach((el) => el.addEventListener('input', () => {
        const i = Number(el.dataset.btext);
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], text: el.value };
        patch({ bubbles: list }, { debounce: 350, noRestyle: true, silent: true });
        restyleBubble(cell, i);
      }));
      box.querySelectorAll('[data-btype]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.btype);
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], type: el.value };
        // 云朵 / 爆炸这类「有形状」的气泡，自动高度会把形状压成一条扁的 ——
        // 换成这类时如果还没设高度，按格子比例补一个接近方形的框
        const boxy = ['shout', 'rage', 'thought', 'cloud', 'round', 'soft'];
        if (boxy.includes(el.value) && !(Number(list[i].h) > 0)) {
          const wp = Number(list[i].w) || 38;
          list[i].h = Math.min(34, Math.max(12, (wp * cell.w) / Math.max(1, cell.h)));
        }
        patch({ bubbles: list }, { noRestyle: true });
        restyleBubble(cell, i);
        // 类型变了，卡片头的类型标签和尾巴的默认样式都要跟着换 → 重出面板
        // （展开状态记在 S.ovOpen 里，不会因为重绘收起来）
        renderInspector();
      }));
      box.querySelectorAll('[data-bdir]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.bdir);
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], direction: el.value };
        patch({ bubbles: list }, { noRestyle: true });
        restyleBubble(cell, i);
      }));
      box.querySelectorAll('[data-btail]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.btail);
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], tail: el.value };
        patch({ bubbles: list }, { noRestyle: true });
        restyleBubble(cell, i);
      }));
      // 数字参数统一滑块：拖动即时改样式，松手时落库（debounce）
      const BKEYS = {
        bsize: 'size', bx: 'x', by: 'y', bw: 'w', bh: 'h', brot: 'rotation', bbw: 'border_width',
        bta: 'tail_angle', btl: 'tail_len', btw: 'tail_w',
      };
      Object.keys(BKEYS).forEach((k) => {
        box.querySelectorAll(`[data-${k}]`).forEach((el) => el.addEventListener('input', () => {
          const i = Number(el.dataset[k]);
          const v = Number(el.value);
          const lab = box.querySelector(`[data-${k}-v="${i}"]`);
          if (lab) lab.textContent = v;
          const list = [...(cell.bubbles || [])];
          list[i] = { ...list[i], [BKEYS[k]]: v };
          patch({ bubbles: list }, { debounce: 260, noRestyle: true, silent: true });
          restyleBubble(cell, i);
        }));
      });
      // 文字色 / 底色 / 描边色
      [['bcolor', 'color'], ['bbbg', 'bg'], ['bborder', 'border']].forEach(([attr, key]) => {
        box.querySelectorAll(`[data-${attr}]`).forEach((el) => el.addEventListener('input', () => {
          const i = Number(el.dataset[attr]);
          const list = [...(cell.bubbles || [])];
          list[i] = { ...list[i], [key]: el.value };
          patch({ bubbles: list }, { debounce: 200, noRestyle: true, silent: true });
          restyleBubble(cell, i);
        }));
      });
      // 底色透明度：0 = 全透明（只剩描边/文字），100 = 实色
      box.querySelectorAll('[data-bbgop]').forEach((el) => el.addEventListener('input', () => {
        const i = Number(el.dataset.bbgop);
        const v = Number(el.value);
        const lab = box.querySelector(`[data-bbgop-v="${i}"]`);
        if (lab) lab.textContent = v;
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], bg_alpha: v / 100 };
        patch({ bubbles: list }, { debounce: 220, noRestyle: true, silent: true });
        restyleBubble(cell, i);
      }));
      // 文字对齐：左 / 中 / 右（分段按钮，立即生效）
      box.querySelectorAll('[data-balign]').forEach((el) => el.addEventListener('click', () => {
        const i = Number(el.dataset.balign);
        const v = el.dataset.v || 'center';
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], align: v };
        patch({ bubbles: list }, { noRestyle: true });
        restyleBubble(cell, i);
        box.querySelectorAll(`[data-balign="${i}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      }));
      // 边框线型（与气泡本体分离，可设 none 关掉边框）
      box.querySelectorAll('[data-bbstyle]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.bbstyle);
        const list = [...(cell.bubbles || [])];
        list[i] = { ...list[i], border_style: el.value };
        patch({ bubbles: list }, { noRestyle: true });
        restyleBubble(cell, i);
      }));
      // （气泡删除已由顶部共享的 data-ovdel 处理）
    }

    if (S.tab === 'fx') {
      box.querySelectorAll('[data-fxadd]').forEach((el) => el.addEventListener('click', () => {
        const t = el.dataset.fxadd;
        const list = [...(cell.effects || [])];
        // 宽高都是「格子的百分比」，格子通常不是正方形：w=h=20 会得到一个竖长的框，
        // 爆炸/感叹号/箭头会被非等比拉伸。这里按格子比例反算高度，让新特效框在屏幕上正好是方的。
        const wPct = 20;
        const hPct = Math.min(60, Math.max(6, (wPct * cell.w) / Math.max(1, cell.h)));
        list.push({ type: t, x: 40, y: Math.max(4, (100 - hPct) / 2 - 8), w: wPct, h: hPct,
          rotation: 0, color: '#111111', opacity: 1 });
        patch({ effects: list });
        S.ovOpen['fx:' + (list.length - 1)] = true;
        renderInspector(); renderStage();
      }));
      box.querySelectorAll('[data-fxtype]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.fxtype);
        const list = [...(cell.effects || [])];
        list[i] = { ...list[i], type: el.value };
        patch({ effects: list });
        renderInspector(); renderStage();
      }));
      const FKEYS = { fxx: 'x', fxy: 'y', fxw: 'w', fxh: 'h', fxr: 'rotation', fxo: 'opacity' };
      Object.keys(FKEYS).forEach((k) => {
        box.querySelectorAll(`[data-${k}]`).forEach((el) => el.addEventListener('input', () => {
          const i = Number(el.dataset[k]);
          let v = Number(el.value);
          const lab = box.querySelector(`[data-${k}-v="${i}"]`);
          if (lab) lab.textContent = v;
          const list = [...(cell.effects || [])];
          const val = (k === 'fxo') ? (v / 100) : v;   // 不透明度面板用 0–100，存储用 0–1
          list[i] = { ...list[i], [FKEYS[k]]: val };
          patch({ effects: list }, { debounce: 260, noRestyle: true, silent: true });
          restyleFx(cell, i);
        }));
      });
      box.querySelectorAll('[data-fxcolor]').forEach((el) => el.addEventListener('input', () => {
        const i = Number(el.dataset.fxcolor);
        const list = [...(cell.effects || [])];
        list[i] = { ...list[i], color: el.value };
        patch({ effects: list }, { debounce: 200, noRestyle: true, silent: true });
        restyleFx(cell, i);
      }));
      // 速度线的形状参数：方向 / 数量 / 粗细 / 尖头 / 长短 / 疏密 / 焦点
      box.querySelectorAll('[data-fxmode]').forEach((el) => el.addEventListener('change', () => {
        const i = Number(el.dataset.fxmode);
        const list = [...(cell.effects || [])];
        list[i] = { ...list[i], mode: el.value };
        patch({ effects: list }, { noRestyle: true });
        restyleFx(cell, i);
        renderInspector();   // 换方向后要重出参数（焦点 / 疏密是互斥的）
      }));
      // 所有 FX_PARAMS 里的参数统一绑定：滑块 / 下拉 → 字段（百分比字段存 0–1）
      const FPARAM = {};
      Object.values(FX_PARAMS).flat().forEach((p) => {
        FPARAM[p.a] = { key: p.k, pct: !!FX_PCT[p.k], dec: p.dec || 0, sel: !!p.opts, color: p.t === 'color' };
      });
      Object.keys(FPARAM).forEach((attr) => {
        const meta = FPARAM[attr];
        box.querySelectorAll(`[data-${attr}]`).forEach((el) => el.addEventListener(
          meta.sel ? 'change' : 'input', () => {
            const i = Number(el.dataset[attr]);
            const list = [...(cell.effects || [])];
            let val;
            if (meta.color) {
              val = el.value;
            } else if (meta.sel) {
              val = el.value;
            } else {
              const raw = Number(el.value);
              const lab = box.querySelector(`[data-${attr}-v="${i}"]`);
              if (lab) lab.textContent = meta.dec ? raw.toFixed(meta.dec) : Math.round(raw);
              val = meta.pct ? raw / 100 : raw;
            }
            list[i] = { ...list[i], [meta.key]: val };
            // 点了内芯色却还没开内芯 —— 顺手把「内心大小」拉起来，省得用户以为没生效
            if (meta.key === 'cc' && !(Number(list[i].inner) > 0)) {
              list[i].inner = 86;
              const sl = box.querySelector(`[data-fxcin="${i}"]`);
              if (sl) {
                sl.value = '86';
                setSliderFill(sl);
                const lb = box.querySelector(`[data-fxcin-v="${i}"]`);
                if (lb) lb.textContent = '86';
              }
            }
            if (meta.sel) patch({ effects: list }, { noRestyle: true });
            else patch({ effects: list }, { debounce: 220, noRestyle: true, silent: true });
            restyleFx(cell, i);
          }));
      });
    }

    // 让所有滑块（含气泡/特效折叠卡里的 mini 滑块）初始就显示金色已填充比例，
    // 并在拖动过程中实时刷新填充（气泡卡里的滑块没有走 sliderField，不会自己更新）
    box.querySelectorAll('input[type=range]').forEach((el) => {
      setSliderFill(el);
      el.addEventListener('input', () => setSliderFill(el));
    });
  }

  function restyleCell(el, c) {
    const pts = normPoints(c.points);
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
    el.style.width = c.w + 'px'; el.style.height = c.h + 'px';
    el.style.transform = `rotate(${c.rotation || 0}deg)`;
    el.style.opacity = c.opacity ?? 1;
    el.style.zIndex = 10 + (c.z_index || 0);
    const clip = el.querySelector('.cm-clip');
    if (clip) {
      clip.style.clipPath = polyCss(pts);
      // 格子底色：改色 / 切「无背景」都要立刻重画
      const noBg = Number(c.bg_enabled) === 0;
      clip.style.background = noBg ? 'transparent' : (c.bg_color || '#ffffff');
      clip.classList.toggle('nobg', noBg);
    }
    const pg = el.querySelector('.cm-border polygon');
    if (pg) {
      pg.setAttribute('points', polySvgPts(pts));
      pg.setAttribute('stroke', c.border_color || '#111');
      pg.setAttribute('stroke-width', c.border_style === 'none' ? 0 : (c.border_width ?? 3));
      pg.setAttribute('stroke-dasharray', c.border_style === 'dashed' ? '7 5' : (c.border_style === 'dotted' ? '2 4' : ''));
    }
    const img = el.querySelector('.cm-img');
    if (img) {
      img.style.objectFit = c.fit === 'contain' ? 'contain' : 'cover';
    }
    applyImgTransform(el, c);
    el.classList.toggle('locked', !!c.is_locked);
  }

  function shapePoints(kind) {
    switch (kind) {
      case 'trapL': return [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.72]];   // 左下收
      case 'trapR': return [[0.0, 0.0], [1.0, 0.0], [1.0, 0.72], [0.0, 1.0]];   // 右下压
      case 'para': return [[0.0, 0.18], [1.0, 0.0], [1.0, 0.82], [0.0, 1.0]];   // 平行四边形
      case 'bowtie': return [[0.0, 0.0], [1.0, 0.12], [1.0, 1.0], [0.0, 0.88]];
      default: return null;   // 矩形
    }
  }

  function calcSize(w, h) {
    const aspect = w / h;
    let W, H;
    if (aspect >= 1) { W = 1024; H = 1024 / aspect; } else { H = 1024; W = 1024 * aspect; }
    W = Math.max(384, Math.min(1280, W));
    H = Math.max(384, Math.min(1280, H));
    const r = (v) => Math.round(v / 16) * 16;
    return [r(W), r(H)];
  }

  async function refreshPromptPreview(cell) {
    const box = document.querySelector('#c-preview');
    if (!box) return;
    try {
      const data = await Admin.post(`${API}/cells/${cell.id}/prompt-preview`, {});
      const parts = data.parts || [];
      box.innerHTML = parts.length ? parts.map((p) =>
        `<div class="cm-prompt-part"><span class="lb">${esc(p.label)}</span>${esc(p.text)}</div>`).join('')
        : '<span style="color:#7b8296">还没有内容：先绑人物或写自由词</span>';
      if (data.override) box.insertAdjacentHTML('afterbegin', '<div style="color:var(--orange);margin-bottom:4px">已整格手写覆盖，下面按覆盖内容出图</div>');
      // 负面词一律不展示、不出图（CFG=1 的模型负面词不生效，只会多跑一次 CLIP）
    } catch (e) {
      box.textContent = '预览失败：' + e.message;
    }
  }

  async function refreshCharPreview(cell) {
    const box = document.querySelector('#c-charprev');
    if (!box) return;
    try {
      const data = await Admin.post(`${API}/cells/${cell.id}/prompt-preview`, {});
      const parts = (data.parts || []).filter((p) => p.label.startsWith('人物'));
      box.innerHTML = parts.length ? parts.map((p) =>
        `<div class="cm-prompt-part"><span class="lb">${esc(p.label)}</span>${esc(p.text)}</div>`).join('')
        : '<span style="color:#7b8296">还没有绑定人物</span>';
    } catch (_) {}
  }

  function moveChar(cell, i, dir) {
    const list = [...(cell.characters || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    Object.assign(cell, { characters: list });
    Admin.put(`${API}/cells/${cell.id}`, { characters: list }).catch((e) => toast(e.message, true));
    renderInspector();
  }

  /* ==================== 人物库 ==================== */
  async function openCharacterPicker(cell) {
    // 统一走 openCharPickerFor，避免两套人物库弹窗各写一遍
    await openCharPickerFor((ch) => { addCharacter(cell, ch); toast(`已加入：${ch.name || ''}`); });
  }

  function addCharacter(cell, ch) {
    const arr = [...(cell.characters || [])];
    if (arr.some((r) => r.character_id === ch.id)) return toast('这个人物已经在格子里了');
    const def = (ch.appearances || []).find((a) => a.is_default) || (ch.appearances || [])[0];
    arr.push({ character_id: ch.id, appearance_id: def ? def.id : null, name: ch.name, note: '' });
    Object.assign(cell, { characters: arr });
    Admin.put(`${API}/cells/${cell.id}`, { characters: arr })
      .then(() => { if (S.tab === 'char') renderInspector(); refreshPromptPreview(cell); })
      .catch((e) => toast(e.message, true));
  }

  /* ==================== 版式 / 拆分 / 复制 / 删除 ==================== */
  function applyLayoutModal() {
    const page = currentPage();
    const layouts = (S.options?.layouts || []).filter((l) =>
      !l.modes || l.modes.includes(S.tree.project.mode) || l.id === 'blank');
    const m = openModal({
      title: `套用版式 · ${esc(page.title || '当前页')}`,
      width: 720,
      body: `<div class="hint" style="margin-bottom:8px">套用会替换当前页的全部格子（已有图片的格子会被删掉，请先确认）。</div>
        <div class="cm-layout-grid">
          ${layouts.map((l) => `<div class="cm-layout-card" data-lay="${l.id}">
            <div class="pv">${previewLayoutBoxes(l.id, page)}</div>
            <div class="n">${esc(l.name)}</div><div class="d">${esc(l.desc || '')}</div>
          </div>`).join('')}
        </div>`,
      footer: '<button class="cm-btn" data-x>取消</button>',
    });
    m.body.querySelectorAll('[data-lay]').forEach((el) => el.addEventListener('click', async () => {
      if (!await Admin.confirm('套用版式会清空本页现有格子（含图片与版本），确定？', { danger: true })) return;
      try {
        await Admin.post(`${API}/pages/${page.id}/relayout`, { layout: el.dataset.lay });
        await loadTree(S.pid, true);
        renderAll();
        m.close();
        toast('版式已套用');
      } catch (e) { toast(e.message, true); }
    }));
  }

  function previewLayoutBoxes(id, page) {
    const boxes = layoutBoxesMock(id);
    return boxes.map((b) => `<i style="left:${b[0] * 100}%;top:${b[1] * 100}%;width:${b[2] * 100}%;height:${b[3] * 100}%"></i>`).join('');
  }

  function layoutBoxesMock(id) {
    const r = (x, y, w, h) => [x, y, w, h];
    switch (id) {
      case 'splash': return [r(0, 0, 1, 1)];
      case 'grid-2x2': return [r(0, 0, .49, .49), r(.51, 0, .49, .49), r(0, .51, .49, .49), r(.51, .51, .49, .49)];
      case 'grid-3rows': return [r(0, 0, 1, .31), r(0, .345, 1, .31), r(0, .69, 1, .31)];
      case 'grid-6': return [0, 1, 2].flatMap((i) => [r(0, i * .34, .49, .31), r(.51, i * .34, .49, .31)]);
      case 'scroll-3': return [r(0, 0, 1, .31), r(0, .345, 1, .31), r(0, .69, 1, .31)];
      case 'scroll-4': return [0, 1, 2, 3].map((i) => r(0, i * .255, 1, .23));
      case 'manga-action': return [r(0, 0, .61, 1), r(.63, 0, .37, .49), r(.63, .51, .37, .49)];
      case 'manga-diagonal': return [r(0, 0, 1, .56), r(0, .44, 1, .56)];
      case 'manga-3slash': return [r(0, 0, 1, .31), r(0, .345, 1, .31), r(0, .69, 1, .31)];
      case 'manga-rotated': return [r(.05, .06, .55, .36), r(.4, .52, .55, .36)];
      case 'lianhuanhua-2': return [r(0, 0, 1, .55), r(0, .56, 1, .44)];
      case 'manga-classic': return [r(0, 0, 1, .4), r(.42, .417, .58, .29), r(0, .417, .4, .29), r(0, .72, 1, .28)];
      default: return [];
    }
  }

  async function splitSelected() {
    const id = [...S.selection][0];
    if (!id) return;
    const m = openModal({
      title: '拆分格子',
      body: `<div class="hint" style="margin-bottom:10px">把这一格切成多格，提示词与人物会保留在第一格。</div>
        <div class="cm-export-list">
          <div class="cm-export-row"><div class="t"><b>左右两格</b><span>竖着切一刀</span></div><button class="cm-btn" data-mode="v">切</button></div>
          <div class="cm-export-row"><div class="t"><b>上下两格</b><span>横着切一刀</span></div><button class="cm-btn" data-mode="h">切</button></div>
          <div class="cm-export-row"><div class="t"><b>田字四格</b><span>切成 2×2</span></div><button class="cm-btn" data-mode="grid">切</button></div>
          <div class="cm-export-row"><div class="t"><b>纵向三格</b><span>切成三条</span></div><button class="cm-btn" data-mode="3">切</button></div>
        </div>`,
      footer: '<button class="cm-btn" data-x>取消</button>',
    });
    m.body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await Admin.post(`${API}/cells/${id}/split`, { mode: b.dataset.mode });
        await loadTree(S.pid, true);
        renderAll();
        m.close();
        toast('已拆分');
      } catch (e) { toast(e.message, true); }
    }));
  }

  /** 从画布与本地模型里移除一格（含后端删除），撤销/重做复用 */
  async function removeCellById(cellId) {
    try { await Admin.del(`${API}/cells/${cellId}`); } catch (e) { /* 已经没了就算了 */ }
    const page = currentPage();
    if (page) page.cells = page.cells.filter((c) => c.id !== cellId);
    S.selection.delete(cellId);
    if (S.cellId === cellId) S.cellId = null;
    renderAll();
  }

  async function duplicateSelected() {
    const id = [...S.selection][0];
    if (!id || HIST.lock) return;
    try {
      const cell = await Admin.post(`${API}/cells/${id}/duplicate`, { with_image: true });
      currentPage().cells.push(cell);
      S.selection.clear();
      S.selection.add(cell.id);
      S.cellId = cell.id;
      renderStage(); renderTree(); renderInspector(); renderTop();
      const nv = (cell.versions || []).length;
      toast(`已复制为新格（含 ${nv} 个版本与全部参数，与原格脱钩）`);
      const holder = { id: cell.id };
      histPush('复制格子',
        async () => { await removeCellById(holder.id); },
        async () => {
          const c = await Admin.post(`${API}/cells/${id}/duplicate`, { with_image: true });
          holder.id = c.id;
          currentPage().cells.push(c);
          S.selection = new Set([c.id]);
          S.cellId = c.id;
          renderAll();
        });
    } catch (e) { toast(e.message, true); }
  }

  /** 只留服务端认的字段（撤销「删除格子」时按这份快照重建） */
  function cellRestorePayload(c) {
    const keys = ['x', 'y', 'w', 'h', 'rotation', 'points', 'border_color', 'border_width',
      'border_style', 'border_radius', 'opacity', 'z_index', 'fit', 'img_scale',
      'img_offset_x', 'img_offset_y', 'flip_h', 'bg_enabled', 'bg_color',
      'prompt_positive', 'prompt_negative', 'prompt_override', 'prompt_locked',
      'characters', 'workflow_preset', 'model_preset', 'steps', 'cfg', 'seed', 'seed_mode',
      'bubbles', 'effects', 'current_image', 'gen_status'];
    const o = {};
    keys.forEach((k) => { if (c[k] !== undefined) o[k] = histClone(c[k]); });
    return o;
  }

  async function deleteSelected() {
    const ids = [...S.selection];
    if (!ids.length || HIST.lock) return;
    if (!await Admin.confirm(`删除选中的 ${ids.length} 个格子？版本历史会一起删除。`, { danger: true })) return;
    const page = currentPage();
    const snaps = ids.map((id) => cellById(id)).filter(Boolean).map((c) => cellRestorePayload(c));
    for (const id of ids) {
      try {
        await Admin.del(`${API}/cells/${id}`);
        page.cells = page.cells.filter((c) => c.id !== id);
      } catch (e) { toast(e.message, true); }
    }
    S.selection.clear();
    S.cellId = null;
    renderAll();
    // 撤销删除：按快照重建（图与版本没法回溯，但排版/提示词/气泡/特效都在）
    const live = { ids: ids.slice() };
    histPush('删除格子',
      async () => {
        const created = [];
        for (const s of snaps) {
          try { created.push(await Admin.post(`${API}/pages/${page.id}/cells`, { ...s, restore: true })); } catch (e) { toast(e.message, true); }
        }
        page.cells.push(...created);
        live.ids = created.map((c) => c.id);
        S.selection = new Set(live.ids);
        S.cellId = live.ids[0] ?? null;
        renderAll();
      },
      async () => {
        for (const cid of live.ids.slice()) await removeCellById(cid);
      });
  }

  /* ==================== 生成 / 队列 ==================== */
  async function generateSelected() {
    const cell = currentCell();
    if (!cell) return;
    try {
      await Admin.post(`${API}/cells/${cell.id}/generate`, {});
      cell.gen_status = 'queued';
      cell.progress = 0;
      renderStage(); renderInspector();
      ensurePolling();
      toast('已提交，出图后自动回填');
    } catch (e) { toast(e.message, true); }
  }

  async function generatePage() {
    const page = currentPage();
    if (!page) return;
    try {
      const r = await Admin.post(`${API}/pages/${page.id}/generate`, { only_pending: false });
      toast(`已入队 ${r.count} 格${r.skipped ? `，跳过 ${r.skipped} 格（已在队列）` : ''}`);
      ensurePolling();
    } catch (e) { toast(e.message, true); }
  }

  async function generateBook() {
    const book = currentBook();
    if (!book) return;
    try {
      const r = await Admin.post(`${API}/projects/${S.pid}/generate`, {
        book_id: book.id, only_pending: true, batch_name: `${book.title} · 整册`,
      });
      toast(`已入队 ${r.count} 格${r.skipped ? `，跳过 ${r.skipped}` : ''}`);
      ensurePolling();
    } catch (e) { toast(e.message, true); }
  }

  function ensurePolling() {
    if (S.pollTimer) return;
    S.pollTimer = setInterval(pollQueue, 1500);
    pollQueue();
  }

  async function pollQueue() {
    if (!S.pid) return;
    let q;
    try { q = await Admin.get(`${API}/queue?project_id=${S.pid}`); } catch (_) { return; }
    S.queue = q;
    renderQueueBar();
    if (S.queueOpen) renderQueueList();

    // 完成 / 失败 → 更新对应格子
    let needTree = false;
    (q.tasks || []).forEach((t) => {
      const prev = S.knownTask[t.id];
      S.knownTask[t.id] = t.status;
      const cell = cellById(t.cell_id);
      if (!cell) return;
      if (t.status === 'running') { cell.gen_status = 'rendering'; cell.progress = t.progress; }
      if (t.status === 'waiting') { cell.gen_status = 'queued'; }
      if ((t.status === 'success' || t.status === 'failed' || t.status === 'canceled') && prev !== t.status) {
        if (t.status === 'success') {
          cell.current_image = t.image;
          cell.gen_status = 'done';
          cell.progress = 100;
          // 拉一次详情拿版本与选中 id
          Admin.get(`${API}/cells/${t.cell_id}`).then((fresh) => {
            const c2 = cellById(fresh.id);
            if (c2) Object.assign(c2, fresh);
            if (S.cellId === t.cell_id) renderInspector();
            renderStage(); renderTree();
          }).catch(() => {});
        } else if (t.status === 'failed') {
          cell.gen_status = 'failed';
          cell.last_error = t.error || t.message;
          toast(`第 ${cell.read_order} 格生成失败：${t.message}`, true);
        } else {
          cell.gen_status = 'pending';
        }
        needTree = true;
      }
    });
    if (needTree) { renderStage(); renderTree(); }
    // 没有活动任务就停止轮询（省电）
    const active = (q.tasks || []).some((t) => ['waiting', 'running'].includes(t.status));
    if (!active && !q.paused) {
      clearInterval(S.pollTimer); S.pollTimer = null;
    }
  }

  function renderQueueBar() {
    const bar = document.getElementById('cm-queue');
    if (!bar) return;
    const q = S.queue || { counts: {}, tasks: [], paused: false };
    const c = q.counts || {};
    const total = (c.success || 0) + (c.failed || 0) + (c.waiting || 0) + (c.running || 0);
    const run = (q.tasks || []).find((t) => t.status === 'running');
    const pct = (n) => total ? (n / total * 100) + '%' : '0%';
    bar.innerHTML = `
      <span style="color:${q.paused ? 'var(--orange)' : 'var(--green)'}">${q.paused ? '⏸ 已暂停' : '● 队列'}</span>
      <div class="qbar">
        <i class="ok" style="width:${pct(c.success || 0)}"></i>
        <i class="fail" style="width:${pct(c.failed || 0)}"></i>
        <i class="run" style="width:${pct(c.running || 0)}"></i>
      </div>
      <span class="qstat">
        <span>完成 <b>${c.success || 0}</b></span>
        <span>排队 <b>${c.waiting || 0}</b></span>
        <span>运行 <b>${c.running || 0}</b></span>
        <span style="color:${c.failed ? 'var(--red)' : 'inherit'}">失败 <b>${c.failed || 0}</b></span>
      </span>
      <span class="qtask">${run ? '正在跑：第 ' + (cellById(run.cell_id)?.read_order || '?') + ' 格 · ' + esc(run.message) : (q.paused ? '队列暂停中' : '空闲')}</span>
      <button class="cm-btn cm-mini" id="q-pause">${q.paused ? '继续' : '暂停'}</button>
      <button class="cm-btn cm-mini" id="q-cancel">取消当前</button>
      <button class="cm-btn cm-mini" id="q-abort">中止批次</button>
    `;
    bar.querySelector('#q-pause').addEventListener('click', async () => {
      await Admin.post(`${API}/queue/${q.paused ? 'resume' : 'pause'}`, {});
      ensurePolling();
    });
    bar.querySelector('#q-cancel').addEventListener('click', async () => {
      const running = (q.tasks || []).find((t) => t.status === 'running');
      if (!running) return toast('当前没有正在跑的格子');
      await Admin.post(`${API}/queue/cancel`, { task_id: running.id });
      toast('已请求中断当前格');
    });
    bar.querySelector('#q-abort').addEventListener('click', async () => {
      if (!await Admin.confirm('中止本批次？已生成的图会保留，未开始的格子回到待生成。', { danger: true })) return;
      await Admin.post(`${API}/queue/cancel`, {});
      ensurePolling();
    });
    const cntEl = document.getElementById('cm-queue-cnt');
    if (cntEl) cntEl.textContent = (c.waiting || 0) + (c.running || 0);
  }

  function toggleQueueList() {
    let el = document.getElementById('cm-qlist');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cm-qlist';
      el.className = 'cm-qlist';
      document.querySelector('.cm-app').appendChild(el);
    }
    S.queueOpen = !S.queueOpen;
    el.classList.toggle('show', S.queueOpen);
    if (S.queueOpen) { ensurePolling(); renderQueueList(); }
  }

  function renderQueueList() {
    const el = document.getElementById('cm-qlist');
    if (!el || !S.queue) return;
    const rows = (S.queue.tasks || []).slice().reverse().slice(0, 60);
    const label = { waiting: '排队', running: '生成', success: '完成', failed: '失败', canceled: '取消', canceling: '中断中' };
    const color = { waiting: '#4a6fa5', running: '#2bb3a3', success: '#2f9e6f', failed: '#b94343', canceled: '#6a6f80', canceling: '#b9803f' };
    el.innerHTML = rows.length ? rows.map((t) => {
      const cell = cellById(t.cell_id);
      return `<div class="cm-qrow" data-cid="${t.cell_id}">
        <span class="st" style="background:${color[t.status] || '#555'}">${label[t.status] || t.status}</span>
        <span class="pg">第 ${cell?.read_order || '?'} 格</span>
        <span class="msg">${esc(t.message || '')}</span>
        <button class="cm-icon-btn" data-cancel="${t.id}" title="取消">✕</button>
      </div>`;
    }).join('') : '<div class="hint" style="padding:14px">还没有任务</div>';
    el.querySelectorAll('[data-cid]').forEach((r) => r.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selectCellAndScroll(Number(r.dataset.cid));
    }));
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await Admin.post(`${API}/queue/cancel`, { task_id: b.dataset.cancel });
      toast('已取消');
    }));
  }

  function selectCellAndScroll(id) {
    const cell = cellById(id);
    if (!cell) return;
    if (cell.page_id !== S.pageId) {
      S.pageId = cell.page_id;
      renderTree(); renderStage();
    }
    S.selection.clear();
    S.selection.add(id);
    S.cellId = id;
    renderStage(); renderInspector(); renderTop();
    const el = document.querySelector(`.cm-cell[data-cell="${id}"]`);
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }

  /* ==================== 新建工程 / 设置 ==================== */
  async function newProjectModal() {
    await loadOptions();
    const m = openModal({
      title: '新建漫画工程',
      width: 660,
      body: `
        <div class="cm-grid2">
          <div class="cm-field"><label>作品名</label><input type="text" id="np-title" value="我的漫画"></div>
          <div class="cm-field"><label>形态</label>
            <select id="np-mode">
              <option value="manga">页漫（多格排版）</option>
              <option value="scroll">条漫（纵向长条）</option>
              <option value="lianhuanhua">小人书（一页一格）</option>
            </select>
          </div>
        </div>
        <div class="cm-grid2">
          <div class="cm-field"><label>页面尺寸</label>
            <select id="np-size">
              <option value="1240x1754">A4 竖版 1240×1754</option>
              <option value="900x2600">条漫 900×2600</option>
              <option value="1080x1920">手机竖屏 1080×1920</option>
              <option value="1600x1200">横版 1600×1200</option>
            </select>
          </div>
          <div class="cm-field"><label>阅读方向</label>
            <select id="np-dir">
              <option value="right_to_left">右 → 左（日漫）</option>
              <option value="left_to_right">左 → 右</option>
              <option value="top_to_bottom">上 → 下</option>
            </select>
          </div>
        </div>
        <div class="cm-field"><label>首屏版式</label>
          <select id="np-layout">
            <option value="manga-classic">页漫 · 经典三行</option>
            <option value="manga-action">页漫 · 大格压场</option>
            <option value="manga-diagonal">页漫 · 斜切两格</option>
            <option value="manga-3slash">页漫 · 三段斜切</option>
            <option value="manga-rotated">页漫 · 旋转双格</option>
            <option value="grid-2x2">页漫 · 四格</option>
            <option value="splash">整页满幅</option>
            <option value="scroll-3">条漫 · 三格</option>
            <option value="blank">空白页</option>
          </select>
        </div>
        <div class="cm-field"><label>默认模型方案</label>
          <select id="np-model">
            <option value="">（跟随全局激活方案）</option>
            ${(S.options.model_presets || []).map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}
          </select>
        </div>
      `,
      footer: `<button class="cm-btn" data-x>取消</button><button class="cm-btn primary" id="np-ok">创建</button>`,
    });
    m.body.querySelector('#np-mode').addEventListener('change', (e) => {
      const sel = m.body.querySelector('#np-size');
      if (e.target.value === 'scroll') { sel.value = '900x2600'; m.body.querySelector('#np-layout').value = 'scroll-3'; m.body.querySelector('#np-dir').value = 'top_to_bottom'; }
      if (e.target.value === 'lianhuanhua') { sel.value = '1240x1754'; m.body.querySelector('#np-layout').value = 'splash'; m.body.querySelector('#np-dir').value = 'right_to_left'; }
    });
    m.root.querySelector('#np-ok').addEventListener('click', async () => {
      const [w, h] = m.body.querySelector('#np-size').value.split('x').map(Number);
      const payload = {
        title: m.body.querySelector('#np-title').value.trim() || '我的漫画',
        mode: m.body.querySelector('#np-mode').value,
        page_w: w, page_h: h,
        reading_direction: m.body.querySelector('#np-dir').value,
        layout: m.body.querySelector('#np-layout').value,
        model_preset: m.body.querySelector('#np-model').value,
      };
      try {
        const data = await Admin.post(`${API}/projects`, payload);
        m.close();
        await loadProjects();
        await openProjectDoc(data.project.id, data.project.title);
        toast('工程已创建');
      } catch (e) { toast(e.message, true); }
    });
  }

  async function projectSettingsModal() {
    if (!S.tree) { toast('先打开一个工程'); return; }
    const p = S.tree.project;
    const m = openModal({
      title: '工程设置',
      width: 792,
      cls: 'cm-settings-xl',
      body: `
        <div class="cm-field"><label>作品名称</label>
          <input type="text" id="ps-title" value="${esc(p.title)}"></div>
        <div class="cm-field"><label>作者</label>
          <input type="text" id="ps-author" value="${esc(p.author || '')}" placeholder="填作者名，会显示在前台书架上"></div>
        <div class="cm-field"><label>简介</label>
          <textarea id="ps-desc" rows="4" placeholder="一两句话介绍这部漫画">${esc(p.description || '')}</textarea></div>
        <div class="cm-field"><label>封面图（留空则自动取第一张成品图）</label>
          <div id="ps-cover" style="display:flex;gap:10px;align-items:center">
            <img id="ps-cover-img" src="${esc(p.cover || '')}" style="width:64px;height:86px;object-fit:cover;border-radius:5px;background:#1b1f2a;border:1px solid #2d3444">
            <div style="display:flex;flex-direction:column;gap:6px">
              <button class="cm-btn" id="ps-pick">从素材库选封面</button>
              <button class="cm-btn ghost" id="ps-clear">清除封面</button>
            </div>
          </div>
        </div>
      `,
      footer: `<button class="cm-btn" data-x>取消</button><button class="cm-btn primary" id="ps-ok">保存</button>`,
    });
    let cover = p.cover || '';
    m.body.querySelector('#ps-pick').addEventListener('click', async () => {
      if (!window.AssetPicker) return;
      const a = await AssetPicker.open({ kind: 'all', currentUrl: cover, title: '选封面' });
      if (a && a.url) {
        cover = a.url;
        m.body.querySelector('#ps-cover-img').src = cover;
      }
    });
    m.body.querySelector('#ps-clear').addEventListener('click', () => {
      cover = '';
      m.body.querySelector('#ps-cover-img').src = '';
    });
    m.root.querySelector('#ps-ok').addEventListener('click', async () => {
      const patch = {
        title: m.body.querySelector('#ps-title').value.trim() || '未命名漫画',
        author: m.body.querySelector('#ps-author').value.trim(),
        description: m.body.querySelector('#ps-desc').value,
        cover,
      };
      try {
        await Admin.put(`${API}/projects/${p.id}`, patch);
        m.close();
        await loadProjects();
        await loadTree(S.pid, true);
        // 标签卡上的名字跟着改
        const d = S.docs.find((x) => x.type === 'project' && x.pid === S.pid);
        if (d) d.title = patch.title;
        renderDocTabs();
        toast('已保存');
      } catch (e) { toast(e.message, true); }
    });
  }

  async function togglePublish() {
    const p = S.tree.project;
    try {
      const r = await Admin.post(`${API}/projects/${p.id}/publish`, { published: !p.is_published });
      p.is_published = r.is_published;
      await loadProjects();
      renderTop(); renderInspector();
      if (r.is_published) {
        toast('已发布，前台「漫画」里可以看了');
      } else {
        toast('已取消发布');
      }
    } catch (e) { toast(e.message, true); }
  }

  /* ==================== 画布渲染（导出 / 预览共用） ==================== */
  async function renderPageCanvas(page, cells, scale = 1) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(page.width * scale);
    cv.height = Math.round(page.height * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = page.bg_color || '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const sorted = [...cells].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
    for (const c of sorted) await drawCell(ctx, c, scale);
    // 浮到格子外的叠层最后画：盖在所有格子之上（和画布上的层叠顺序一致）
    for (const c of sorted) await drawOutLayer(ctx, c, scale);
    return cv;
  }

  /** 只画「浮到格子外」那一层的叠加层 */
  async function drawOutLayer(ctx, c, scale) {
    const bubbles = (c.bubbles || []).filter((b) => ovLayer(b) === 'out');
    const fx = (c.effects || []).filter((b) => ovLayer(b) === 'out');
    bubbles.forEach((b) => drawBubble(ctx, c, b, scale));
    for (const b of fx) await drawFx(ctx, c, b, scale);
  }

  async function drawCell(ctx, c, scale) {
    const pts = normPoints(c.points);
    const img = c.current_image ? await loadImg(c.current_image) : null;
    const cx = (c.x + c.w / 2) * scale;
    const cy = (c.y + c.h / 2) * scale;
    ctx.save();
    ctx.globalAlpha = c.opacity ?? 1;
    ctx.translate(cx, cy);
    ctx.rotate((c.rotation || 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);

    const path = () => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const px = (c.x + p[0] * c.w) * scale;
        const py = (c.y + p[1] * c.h) * scale;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
    };

    // 压在格子下面的叠层：先画，随后被格子底色与画面盖住
    if (Array.isArray(c.bubbles)) {
      c.bubbles.forEach((b) => { if (ovLayer(b) === 'under') drawBubble(ctx, c, b, scale); });
    }
    if (Array.isArray(c.effects)) {
      for (const b of c.effects) if (ovLayer(b) === 'under') await drawFx(ctx, c, b, scale);
    }

    path();
    // 格子底色：bg_enabled=0 → 不填色，保留透明 / 露出页面底色
    if (Number(c.bg_enabled) !== 0) {
      ctx.fillStyle = c.bg_color || '#ffffff';
      ctx.fill();
    }

    if (img) {
      ctx.save();
      path();
      ctx.clip();
      const bw = c.w * scale, bh = c.h * scale;
      const base = c.fit === 'contain'
        ? Math.min(bw / img.width, bh / img.height)
        : Math.max(bw / img.width, bh / img.height);
      const s = base * (c.img_scale || 1);
      const dw = img.width * s, dh = img.height * s;
      const bx = c.x * scale + (bw - dw) / 2 + (c.img_offset_x || 0) / 100 * bw;
      const by = c.y * scale + (bh - dh) / 2 + (c.img_offset_y || 0) / 100 * bh;
      if (c.flip_h) {
        ctx.translate(bx + dw, by);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, dw, dh);
      } else {
        ctx.drawImage(img, bx, by, dw, dh);
      }
      ctx.restore();
    }

    // 边框
    if (c.border_style !== 'none' && (c.border_width ?? 3) > 0) {
      path();
      ctx.strokeStyle = c.border_color || '#111111';
      ctx.lineWidth = (c.border_width ?? 3) * scale;
      ctx.lineJoin = 'round';
      ctx.setLineDash(c.border_style === 'dashed' ? [7 * scale, 5 * scale]
        : (c.border_style === 'dotted' ? [2 * scale, 4 * scale] : []));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 气泡
    if (Array.isArray(c.bubbles)) {
      c.bubbles.forEach((b) => { if (ovLayer(b) === 'in') drawBubble(ctx, c, b, scale); });
    }
    if (Array.isArray(c.effects)) {
      for (const b of c.effects) if (ovLayer(b) === 'in') await drawFx(ctx, c, b, scale);
    }
    ctx.restore();
  }

  function drawBubble(ctx, c, b, scale) {
    const bw = (b.w ?? 40) / 100 * c.w * scale;
    const bh = b.h ? (b.h / 100 * c.h * scale) : null;
    const fs = (b.size || 13) * scale;
    const pad = Math.max(3, fs * 0.4);
    const v = b.direction === 'v';
    ctx.save();
    ctx.font = `${fs}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`;
    ctx.textBaseline = 'top';

    // 先计算排版（列/行），再确定高度
    const text = String(b.text || '');
    let lines = [];
    if (v) {
      // 竖排：每列从上到下，多列时从右往左排
      const maxCol = bh ? Math.max(1, Math.floor((bh - pad * 2) / (fs * 1.02))) : text.length;
      const chars = [...text];
      for (let i = 0; i < chars.length; i += maxCol) lines.push(chars.slice(i, i + maxCol).join(''));
    } else {
      let line = '';
      for (const ch of text) {
        const t = line + ch;
        if (ctx.measureText(t).width > bw - pad * 2 && line) { lines.push(line); line = ch; }
        else line = t;
      }
      if (line) lines.push(line);
    }
    // 真实盒高
    let boxH;
    if (bh) boxH = bh;
    else if (v) boxH = lines.length * fs * 1.02 + pad * 2;
    else boxH = lines.length * fs * 1.4 + pad * 2;

    const bx = (c.x + (b.x ?? 10) / 100 * c.w) * scale;
    const by = (c.y + (b.y ?? 10) / 100 * c.h) * scale;
    // 绕中心旋转（与画布 CSS transform:rotate 一致）
    const ccx = bx + bw / 2, ccy = by + boxH / 2;
    ctx.translate(ccx, ccy);
    ctx.rotate(((b.rotation || 0) * Math.PI) / 180);
    if (b.flip_h || b.flip_v) ctx.scale(b.flip_h ? -1 : 1, b.flip_v ? -1 : 1);
    ctx.translate(-bw / 2, -boxH / 2);

    // 背景 / 描边：和编辑视图同一套几何（形状 path + 尾巴 path），所以导出不会再「变回圆角矩形」
    const bwPx = Math.max(1, (b.border_width == null ? 2 : Number(b.border_width)) * scale);
    const noBorder = (b.border_style === 'none') || Number(b.border_width) === 0;
    const alpha = (b.bg_alpha == null) ? 1 : Math.max(0, Math.min(1, Number(b.bg_alpha) || 0));
    const bgRaw = b.bg || (b.type === 'narration' ? '#fffdf2' : '#ffffff');
    const bg = alpha >= 0.999 ? bgRaw : hexToRgba(bgRaw, alpha);
    const mtx = new DOMMatrix([bw / 100, 0, 0, boxH / 100, 0, 0]);
    const toP2 = (d) => { const p = new Path2D(); p.addPath(new Path2D(d), mtx); return p; };
    const shapeP = toP2(bubbleShapePath(b.type || 'speech'));
    ctx.save();
    ctx.fillStyle = bg;
    ctx.strokeStyle = b.border || '#111111';
    ctx.lineWidth = bwPx;
    ctx.lineJoin = 'round';
    if (!noBorder) {
      if (b.border_style === 'dashed') ctx.setLineDash([7 * scale, 5 * scale]);
      else if (b.border_style === 'dotted') ctx.setLineDash([2 * scale, 4 * scale]);
    }
    // 尾巴先画 —— 根部被气泡本体盖住，接缝看不见（与编辑器里的叠放顺序一致）
    bubbleTailPaths(b).forEach(({ f, s }) => {
      ctx.fill(toP2(f));
      if (!noBorder) ctx.stroke(toP2(s));
    });
    ctx.fill(shapeP);
    if (!noBorder) ctx.stroke(shapeP);
    if (b.border_style === 'double' && !noBorder) {
      ctx.setLineDash([]);
      ctx.strokeStyle = bg;
      ctx.lineWidth = Math.max(0.6, bwPx * 0.42);
      ctx.stroke(shapeP);
    }
    ctx.restore();

    // 文字
    ctx.fillStyle = b.color || '#111111';
    if (v) {
      const colW = fs;                       // 竖排列宽 ≈ 字号
      const totalW = lines.length * colW;
      const startX = bw - pad - totalW;       // 从右往左
      lines.forEach((col, ci) => {
        const x = startX + ci * colW;
        for (let ri = 0; ri < col.length; ri++) ctx.fillText(col[ri], x, pad + ri * fs * 1.02);
      });
    } else {
      const lh = fs * 1.4;
      lines.forEach((ln, i) => {
        const tw = ctx.measureText(ln).width;
        ctx.fillText(ln, (bw - tw) / 2, pad + i * lh);
      });
    }
    ctx.restore();
  }

  // 把矢量 SVG 特效栅格化后画到导出画布上（颜色 / 旋转 / 不透明度一致）
  async function drawFx(ctx, c, b, scale) {
    const def = fxDef(b.type);
    if (!def || !def.svg) return;
    const w = (b.w ?? 18) / 100 * c.w * scale;
    const h = (b.h ? b.h : 18) / 100 * c.h * scale;
    const x = (c.x + (b.x ?? 30) / 100 * c.w) * scale;
    const y = (c.y + (b.y ?? 30) / 100 * c.h) * scale;
    const color = b.color || '#111111';
    const inner = (def.svg(b) || '').replace(/currentColor/g, color);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="${w}" height="${h}">${inner}</svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const im = await loadImg(url);
    if (!im) return;
    ctx.save();
    ctx.globalAlpha = b.opacity != null ? b.opacity : 1;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(((b.rotation || 0) * Math.PI) / 180);
    if (b.flip_h || b.flip_v) ctx.scale(b.flip_h ? -1 : 1, b.flip_v ? -1 : 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ==================== 预览 ==================== */
  function openPreview() {
    const p = S.tree.project;
    const pages = S.tree.books.flatMap((b) => b.pages);
    if (!pages.length) return toast('还没有页面', true);
    let idx = Math.max(0, pages.findIndex((x) => x.id === S.pageId));
    const m = openModal({
      title: `预览 · ${esc(p.title)}`,
      cls: 'cm-reader' + (p.mode === 'scroll' ? '' : ' mode-page'),
      body: `<div class="stage" id="pv-stage"></div>`,
      footer: `<span style="margin-right:auto;color:var(--text-muted);font-size:11.5px" id="pv-info"></span>
        <button class="cm-btn" id="pv-prev">上一页</button>
        <button class="cm-btn" id="pv-next">下一页</button>
        <button class="cm-btn primary" id="pv-close">关闭</button>`,
    });
    m.root.querySelector('#pv-close').addEventListener('click', m.close);
    const stage = m.body.querySelector('#pv-stage');
    const info = m.root.querySelector('#pv-info');

    const show = async () => {
      const page = pages[idx];
      info.textContent = `${idx + 1} / ${pages.length} · ${page.title || ''}`;
      stage.innerHTML = '<div class="hint" style="color:#888;padding:30px">渲染中…</div>';
      const cv = await renderPageCanvas(page, page.cells || [], 1);
      // 兜底：容器高度还没算出来时不能让 s 掉到 0，否则画布被压成一条线
      const maxH = Math.max(240, stage.clientHeight - 36);
      const s = Math.min(1, maxH / page.height);
      cv.style.width = Math.round(page.width * s) + 'px';
      cv.style.height = Math.round(page.height * s) + 'px';
      stage.innerHTML = '';
      stage.appendChild(cv);
    };
    const step = (d) => {
      const rtl = p.reading_direction === 'right_to_left';
      idx = Math.min(pages.length - 1, Math.max(0, idx + (rtl ? -d : d)));
      show();
    };
    m.root.querySelector('#pv-prev').addEventListener('click', () => step(-1));
    m.root.querySelector('#pv-next').addEventListener('click', () => step(1));
    stage.addEventListener('click', () => step(1));
    show();
  }

  /* ==================== 导出 ==================== */
  function openExport() {
    const p = S.tree.project;
    const book = currentBook();
    const page = currentPage();
    const m = openModal({
      title: '导出',
      width: 560,
      body: `
        <div class="hint" style="margin-bottom:10px">导出用的是画布上「当前选中版本」的图，所见即所得。</div>
        <div class="cm-export-list">
          <div class="cm-export-row"><div class="t"><b>当前页 PNG</b><span>${esc(page.title || '')} · ${page.width}×${page.height}</span></div><button class="cm-btn" data-ex="page">导出</button></div>
          <div class="cm-export-row"><div class="t"><b>本册全部页 PNG</b><span>${esc(book.title)} · 共 ${book.pages.length} 页，逐张下载</span></div><button class="cm-btn" data-ex="book">导出</button></div>
          <div class="cm-export-row"><div class="t"><b>本册 PDF</b><span>按页序合成一个 PDF</span></div><button class="cm-btn" data-ex="pdf">导出</button></div>
          <div class="cm-export-row"><div class="t"><b>本册长图</b><span>纵向拼接成一张长图（条漫/连读）</span></div><button class="cm-btn" data-ex="long">导出</button></div>
          <div class="cm-export-row"><div class="t"><b>工程 JSON</b><span>全部册/页/格/提示词/版本索引，可备份</span></div><button class="cm-btn" data-ex="json">导出</button></div>
        </div>`,
      footer: '<button class="cm-btn" data-x>关闭</button>',
    });
    m.body.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await doExport(b.dataset.ex, p, book, page);
      } catch (e) { toast(e.message || '导出失败', true); }
      b.disabled = false;
    }));
  }

  async function doExport(kind, p, book, page) {
    const safe = (p.title || 'comic').replace(/[\\/:*?"<>|]/g, '_');
    if (kind === 'page') {
      const cv = await renderPageCanvas(page, page.cells || [], 1);
      download(dataUrlToBlob(cv.toDataURL('image/png')), `${safe}_${page.page_no}.png`);
      toast('已导出当前页');
      return;
    }
    if (kind === 'json') {
      const data = await Admin.get(`${API}/projects/${p.id}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      download(blob, `${safe}.json`);
      toast('已导出工程 JSON');
      return;
    }
    const pages = book.pages;
    if (kind === 'book') {
      for (const pg of pages) {
        const cv = await renderPageCanvas(pg, pg.cells || [], 1);
        download(dataUrlToBlob(cv.toDataURL('image/png')), `${safe}_${String(pg.page_no).padStart(3, '0')}.png`);
        await new Promise((r) => setTimeout(r, 350));
      }
      toast(`已导出 ${pages.length} 页`);
      return;
    }
    if (kind === 'long') {
      const canvases = [];
      for (const pg of pages) canvases.push(await renderPageCanvas(pg, pg.cells || [], 1));
      const gap = 16;
      const W = Math.max(...canvases.map((c) => c.width));
      const H = canvases.reduce((s, c) => s + c.height, 0) + gap * (canvases.length - 1);
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      let y = 0;
      canvases.forEach((c) => {
        ctx.drawImage(c, (W - c.width) / 2, y);
        y += c.height + gap;
      });
      download(dataUrlToBlob(out.toDataURL('image/png')), `${safe}_long.png`);
      toast('已生成长图');
      return;
    }
    if (kind === 'pdf') {
      const imgs = [];
      for (const pg of pages) {
        const cv = await renderPageCanvas(pg, pg.cells || [], 1);
        imgs.push({ w: cv.width, h: cv.height, data: cv.toDataURL('image/jpeg', 0.9) });
      }
      const blob = buildPdf(imgs);
      download(blob, `${safe}.pdf`);
      toast('已导出 PDF');
    }
  }

  // 极简 PDF 生成（每页一张整页 JPEG）
  function buildPdf(imgs) {
    const enc = (s) => {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    };
    const parts = [];
    let size = 0;
    const push = (u8) => { parts.push(u8); size += u8.length; };
    const offsets = [];
    let objCount = 2 + imgs.length * 3;
    let str = '%PDF-1.4\n';
    push(enc(str));

    const addObj = (idx, bodyStr, streamBytes) => {
      offsets[idx] = size;
      push(enc(`${idx} 0 obj\n${bodyStr}\n`));
      if (streamBytes) {
        push(streamBytes);
        push(enc('\nendstream\n'));
      }
      push(enc('endobj\n'));
    };

    addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = imgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    addObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${imgs.length} >>`);

    imgs.forEach((im, i) => {
      const pageIdx = 3 + i * 3, contIdx = 4 + i * 3, imgIdx = 5 + i * 3;
      const scale = 0.6;
      const w = (im.w * scale).toFixed(2), h = (im.h * scale).toFixed(2);
      addObj(pageIdx, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imgIdx} 0 R >> >> /Contents ${contIdx} 0 R >>`);
      const cstream = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
      addObj(contIdx, `<< /Length ${cstream.length} >>\nstream`, enc(cstream));
      const b64 = im.data.split(',')[1];
      const bin = atob(b64);
      const raw = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) raw[k] = bin.charCodeAt(k);
      const header = `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${raw.length} >>\nstream`;
      addObj(imgIdx, header, raw);
    });

    const xrefPos = size;
    let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objCount; i++) {
      xref += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
    }
    push(enc(xref));
    push(enc(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`));

    return new Blob(parts, { type: 'application/pdf' });
  }

  /* ==================== 双击大图编辑 ==================== */
  // 双击格子 → 打开一个放大的单格编辑视图（提示词 + 人物 + 生成 + 版本）
  // 双击格子现在直接在画布标签里打开（openCellDoc），不再弹窗

  async function mount(host) {
    host.innerHTML = `
      <div class="cm-app">
        <div class="cm-tabsbar" id="cm-docs"></div>
        <div class="cm-top" id="cm-top"></div>
        <div class="cm-body">
          <aside class="cm-left">
            <div class="cm-left-bar">
              <span class="ttl">工程结构</span>
              <button class="ib" id="cm-new-project" title="新建工程">＋</button>
              <button class="ib" id="cm-project-settings" title="工程设置（名称 / 作者 / 简介 / 封面）">⚙</button>
            </div>
            <div class="cm-left-sub">
              <button class="cm-addbook" id="cm-add-book">＋ 新建分册</button>
            </div>
            <div class="cm-tree" id="cm-tree"></div>
          </aside>
          <div class="cm-stage-wrap" id="cm-stage-wrap"></div>
          <aside class="cm-right" id="cm-right"></aside>
        </div>
        <div class="cm-queue" id="cm-queue"></div>
      </div>`;

    document.getElementById('cm-new-project')?.addEventListener('click', newProjectModal);
    document.getElementById('cm-project-settings')?.addEventListener('click', projectSettingsModal);
    document.getElementById('cm-add-book')?.addEventListener('click', addBookModal);

    try {
      await Promise.all([loadProjects(), loadOptions(), loadCharacters(true)]);
    } catch (e) {
      toast('初始化失败：' + e.message, true);
    }

    let pid = null;
    try { pid = Number(localStorage.getItem('comic_last_project')) || null; } catch (_) {}
    if (!pid || !S.projects.some((p) => p.id === pid)) pid = S.projects[0]?.id || null;

    if (!pid) {
      renderAll();
      setTimeout(newProjectModal, 200);
    } else {
      const pj = S.projects.find((p) => p.id === pid);
      try {
        await openProjectDoc(pid, pj ? pj.title : '');
      } catch (e) {
        toast('加载工程失败：' + e.message, true);
      }
    }
    ensurePolling();

    if (!mount.bound) {
      mount.bound = true;
      document.addEventListener('keydown', onKey);
      document.addEventListener('keyup', onKeyUp);
      // 切走窗口时清掉空格抓手的粘滞状态，否则切回来画布会一直跟着鼠标跑
      window.addEventListener('blur', () => {
        S.spaceDown = false;
        document.getElementById('cm-stage-wrap')?.classList.remove('space-pan');
      });
      let rz = null;
      window.addEventListener('resize', () => {
        clearTimeout(rz);
        rz = setTimeout(() => {
          if (document.body.dataset.page !== 'comic') return;
          if (activeCellDoc()) renderStage();
          else applyView();
        }, 160);
      });
    }
  }

  async function addBookModal() {
    if (!S.tree) { toast('先打开一个工程'); return; }
    const name = await Admin.prompt('新建分册', {
      label: '分册名称',
      placeholder: '第 ' + (S.tree.books.length + 1) + ' 话',
    });
    if (!name) return;
    try {
      const b = await Admin.post(`${API}/projects/${S.pid}/books`, { title: name });
      S.collapsed[b.id] = false;
      await loadTree(S.pid, true);
      toast('已新建分册「' + name + '」');
    } catch (e) { toast(e.message, true); }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      S.spaceDown = false;
      document.getElementById('cm-stage-wrap')?.classList.remove('space-pan');
    }
  }

  function onKey(e) {
    if (document.body.dataset.page !== 'comic') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    // 空格 = 临时抓手（按住拖画布）
    if (e.code === 'Space') {
      S.spaceDown = true;
      e.preventDefault();
      document.getElementById('cm-stage-wrap')?.classList.add('space-pan');
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) saveAs(); else saveActive();
      return;
    }
    if (mod && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (S.active) closeDoc(S.active);
      return;
    }
    if (e.key === 'Escape') {
      S.tool = 'select';
      renderTop();
      const wrap = document.getElementById('cm-stage-wrap');
      wrap?.classList.remove('draw-mode');
      // 再按一次 Esc：先退气泡/特效选中，再退格子选中（回到页面属性）
      if (S.overlay) { clearOverlay(); renderInspector(); return; }
      if (!activeCellDoc() && (S.selection.size || S.cellId != null)) {
        S.selection.clear();
        S.cellId = null;
        refreshHandles();
        renderInspector();
        renderTop();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
    // Ctrl+Z 撤销 / Ctrl+Y（或 Ctrl+Shift+Z）重做
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoStep(); else undoStep();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redoStep(); return; }
    if (e.key === 'g' && !mod) generateSelected();
    if (e.key === '+' || e.key === '=') zoomBy(1.15);
    if (e.key === '-') zoomBy(1 / 1.15);
    if (e.key === '0' && !mod) fitZoom(true);

    const step = e.shiftKey ? 10 : 1;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && S.selection.size) {
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
      const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
      [...S.selection].forEach((id) => {
        const c = cellById(id);
        if (!c || c.is_locked) return;
        c.x += dx; c.y += dy;
        Admin.put(`${API}/cells/${c.id}`, { x: c.x, y: c.y }).catch(() => {});
        const el = document.querySelector(`.cm-cell[data-cell="${c.id}"]`);
        if (el) { el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; }
      });
      renderInspector();
    }
  }

  // ==================== 任务中心「定位」：跳到正在生成的那一格 ====================
  // 任务由 ComicQueue 登记进统一任务表（page='comic'，
  // focus={project_id, page_id, cell_id}），抽屉里双击/点 ↗ 都走这里。
  async function focusCellFromJob(focus) {
    const f = focus || {};
    const pid = Number(f.project_id) || S.pid;
    const pageId = Number(f.page_id) || null;
    const cid = Number(f.cell_id) || null;
    if (!pid) return;
    await openProjectDoc(pid);        // 切到该工程（没有这个文档标签就新建一个）
    await loadTree(pid, false);       // 再拉一次：任务刚出的图只写在后端，前端缓存是旧的
    if (pageId) {
      const book = (S.tree.books || []).find((b) => (b.pages || []).some((p) => p.id === pageId));
      if (book) {
        S.collapsed[book.id] = false; // 展开分册，左侧树里能看见这一页
        S.pageId = pageId;
      }
    }
    if (cid && cellById(cid)) {
      S.cellId = cid;
      S.selection = new Set([cid]);
      if (S.tab === '_page') S.tab = 'layout';
    }
    renderAll();
    setTimeout(() => {
      const el = document.querySelector(`.cm-cell[data-cell="${cid}"]`);
      if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      toast(cid ? `已定位到格子 ${cid}` : '已定位到该页');
    }, 260);
  }

  // 刚切页时漫画模块还在加载工程列表，等它把树拉回来再定位
  async function comicFocusHandler(focus) {
    for (let i = 0; i < 60 && !S.tree; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    try { await focusCellFromJob(focus); } catch (e) { /* 工程被删了就忽略 */ }
  }
  if (window.PageFocus) window.PageFocus.set('comic', comicFocusHandler);

  window.ComicStudio = {
    mount, state: S, reload: () => loadTree(S.pid, true),
    openProjectDoc, openCellDoc, closeDoc, saveActive, saveAs,
    fitZoom, zoomBy, renderAll,
    // 给导出 / 自动化验证用：把一页画成 canvas、把多页打成 PDF
    renderPageCanvas, buildPdf, doExport,
  };
  Admin.registerPage('comic', mount);
})();
