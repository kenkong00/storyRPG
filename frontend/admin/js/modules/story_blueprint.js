/* ===== 剧情蓝图（节点画布视图）=====
 * 与「剧情管理」列表视图是同一份数据的两种表现：
 *   - 列表视图：story.js
 *   - 蓝图视图：本文件
 * 两边都走 /api/story 的同一套接口，切页时 admin.js 会重新渲染 → 数据天然同步。
 *
 * 画布交互：
 *   - 空白拖拽平移 / 滚轮缩放 / 拖节点移动（位置存 story_layouts）
 *   - 从节点右侧圆点拖到另一个节点 → 建分支（choice）
 *   - 从章节拖到节点 / 故事拖到章节 → 改归属
 *   - 单击节点打开右侧检查器；双击节点载入演示
 */
Admin.registerPage('story_blueprint', async (container) => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const W = { arc: 224, chapter: 244, node: 288 };
  const TYPE_LABEL = { dialogue: '对话', choice: '选择', battle: '战斗', cutscene: '过场', event: '事件' };

  /* ---- 连线几何常量（CSS 里的 .bp-port 必须与 PORT_Y 一致） ---- */
  const PORT_Y = 15;        // 端口在卡片内的 Y 偏移（标题行中心）
  const PORT_R = 6.5;       // 端口半径
  const LINE_GAP = 7;       // 线端与端口圆心的间隙（避免压住圆点）
  const GAP_X = 66;         // 同一行相邻节点间距
  const PITCH_X = W.node + GAP_X;
  const COL_ARC = 24;
  const COL_CH = 356;
  const COL_NODE = 698;
  const ROW_MAX = 5;        // 每行最多排 5 个节点，超出换行
  const ROW_H = 152;        // 行高估算（上方对齐，实际高度不影响连线）
  const ROW_GAP = 76;
  const BAND_GAP = 86;
  const LAYOUT_VER = 3;     // 布局版本：变化时强制重排一次

  const ARROW_COLOR = {
    owner: '#c9a84c', entry: '#4f8ff7', seq: '#8b8fa3',
    choice: '#4caf88', battle: '#e05555',
  };

  const state = {
    data: null,
    layout: new Map(),      // "kind:ref" -> {x,y,collapsed}
    view: { x: 0, y: 0, scale: 1 },
    sel: null,              // {kind, ref_id}
    arcFilter: 0,           // 0 = 全部
    issues: { errs: new Map(), warns: new Map() },
    run: { active: false, list: [], i: -1 },
    sizes: new Map(),
  };

  let chars = [];
  let scenes = [];
  let saveTimer = null;
  const dirty = new Set();
  let nodeEls = new Map();
  let dragCtx = null;
  let linkDrag = null;
  let ghost = null;

  /* ---------------- 外壳 ---------------- */
  container.innerHTML = `
    <div class="bp-root">
      <div class="bp-toolbar">
        <select id="bp-arc-filter"><option value="0">全部故事</option></select>
        <span class="bp-stats" id="bp-stats">载入中…</span>
        <span class="bp-sep"></span>
        <button class="btn btn-outline btn-sm" id="bp-auto" title="按故事/章节/顺序重新排布">⇅ 自动布局</button>
        <button class="btn btn-outline btn-sm" id="bp-fit" title="缩放到全部内容">⤢ 适应画布</button>
        <button class="btn btn-outline btn-sm" id="bp-zoom-out">−</button>
        <span id="bp-zoom" style="font-size:11px;color:var(--text-muted);min-width:38px;text-align:center">100%</span>
        <button class="btn btn-outline btn-sm" id="bp-zoom-in">＋</button>
        <span class="bp-sep"></span>
        <button class="btn btn-outline btn-sm" id="bp-validate" title="检查断链 / 空节点 / 重复序号 / 循环">✓ 校验</button>
        <button class="btn btn-outline btn-sm" id="bp-import" title="和「剧情管理」里同一套批量导入：贴剧本 → 解析 → 生成人物/节点/配音">↥ 批量导入剧情</button>
        <button class="btn btn-gold btn-sm" id="bp-run" title="逐个节点载入真实画面">▶ 运行本章</button>
        <button class="btn btn-outline btn-sm" id="bp-refresh">↻ 刷新</button>
        <button class="btn btn-outline btn-sm" id="bp-list-view" title="切回原来的表格/卡片列表">☰ 列表视图</button>
        <div style="flex:1"></div>
        <div class="bp-legend">
          <span><i style="border-top-color:#c9a84c"></i>故事归属</span>
          <span><i style="border-top-color:#4f8ff7"></i>进入章节</span>
          <span><i style="border-top-color:#8b8fa3"></i>顺序</span>
          <span><i style="border-top-color:#4caf88"></i>分支</span>
          <span><i style="border-top-color:#e05555;border-top-style:dashed"></i>战斗</span>
        </div>
      </div>
      <div class="bp-body">
        <div class="bp-canvas" id="bp-canvas">
          <div class="bp-canvas-hint">拖空白平移 · 滚轮缩放 · 单击节点编辑 · 从卡片右侧输出点拖到目标卡左侧接收点即可连线</div>
          <div class="bp-world" id="bp-world">
            <svg class="bp-links" id="bp-links"></svg>
            <div class="bp-nodes" id="bp-nodes"></div>
          </div>
          <div class="bp-minimap" id="bp-minimap"><canvas width="168" height="108"></canvas><div class="bp-minimap-view" id="bp-mm-view"></div></div>
          <div class="bp-issues" id="bp-issues"></div>
        </div>
        <aside class="bp-inspector bp-hidden" id="bp-inspector"></aside>
      </div>
      <div class="bp-runbar" id="bp-runbar">
        <div class="bp-runbar-head">
          <b>试运行</b>
          <span class="bp-run-now" id="bp-run-now">—</span>
          <span id="bp-run-pos" style="color:var(--text-muted)"></span>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm" id="bp-run-prev">← 上一节点</button>
          <button class="btn btn-primary btn-sm" id="bp-run-next">下一节点 →</button>
          <button class="btn btn-outline btn-sm" id="bp-run-stop">停止</button>
        </div>
        <iframe id="bp-run-frame" allow="autoplay" src="about:blank"></iframe>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const canvas = $('bp-canvas');
  const world = $('bp-world');
  const svg = $('bp-links');
  const nodesLayer = $('bp-nodes');
  const inspector = $('bp-inspector');

  /* ---------------- 数据 ---------------- */
  async function loadData() {
    const q = state.arcFilter ? `?arc_id=${state.arcFilter}` : '';
    const [bp, cs, sc] = await Promise.all([
      Admin.get(`/story/blueprint${q}`),
      Admin.get('/characters').catch(() => []),
      Admin.get('/scenes/').catch(() => []),
    ]);
    state.data = bp;
    chars = Array.isArray(cs) ? cs : [];
    scenes = Array.isArray(sc) ? sc : [];
    state.layout.clear();
    (bp.layout || []).forEach((it) => state.layout.set(`${it.kind}:${it.ref_id}`, { x: it.x, y: it.y, collapsed: it.collapsed || 0 }));
  }

  /* ---------------- 自动布局 ----------------
   * 横向流水线：故事(第1列) → 章节(第2列) → 节点(第3列起，一行最多 ROW_MAX 个，超出换行)
   * 这样顺序连线永远是「左输出 → 右输入」，不会出现竖直堆叠时那种 U 型回头线。
   */
  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  function orderedNodes(chId) {
    return state.data.nodes
      .filter(n => n.chapter_id === chId)
      .sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id));
  }

  function autoLayout() {
    const { arcs, chapters, nodes } = state.data;
    const set = (key, x, y) => {
      if (!state.layout.has(key) || state.manualLayout) state.layout.set(key, { x, y });
    };
    const arcChapters = (arcId) => chapters
      .filter(c => c.story_arc_id === arcId)
      .sort((a, b) => (a.chapter_order - b.chapter_order) || (a.id - b.id));

    let y = 58;
    const placedCh = new Set();

    // 排一个章节：首行对齐章节卡，其余行依次往下；ys 收集章节卡 y 供故事卡居中
    const layoutChapter = (ch, ys) => {
      placedCh.add(ch.id);
      const rows = chunk(orderedNodes(ch.id), ROW_MAX);
      if (!rows.length) {
        set(`chapter:${ch.id}`, COL_CH, y + 6);
        pushY(ys, y + 6);
        y += 92;
        return;
      }
      rows.forEach((row, ri) => {
        const ry = y + ri * (ROW_H + ROW_GAP);
        row.forEach((n, i) => set(`node:${n.id}`, COL_NODE + i * PITCH_X, ry));
        if (ri === 0) {
          set(`chapter:${ch.id}`, COL_CH, ry + 30);
          pushY(ys, ry + 30);
        }
      });
      y += rows.length * ROW_H + (rows.length - 1) * ROW_GAP + BAND_GAP;
    };
    const pushY = (arr, v) => { if (arr) arr.push(v); };

    arcs.forEach((arc) => {
      if (state.arcFilter && arc.id !== state.arcFilter) return;
      const ys = [];
      const startY = y;
      arcChapters(arc.id).forEach((ch) => layoutChapter(ch, ys));
      // 故事卡垂直居中于它的章节：金色连线向上下扇形展开，而不是全往下扫成一把扫把
      set(`arc:${arc.id}`, COL_ARC, ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : startY + 14);
      y += 24;
    });

    // 没有归属故事（或故事不在当前视图）的章节
    chapters.forEach((ch) => { if (!placedCh.has(ch.id)) layoutChapter(ch); });

    // 章节缺失的节点兜底
    const chIds = new Set(chapters.map(c => c.id));
    nodes.filter(n => !chIds.has(n.chapter_id)).forEach((n, i) => {
      set(`node:${n.id}`, COL_NODE + (i % ROW_MAX) * PITCH_X,
        y + Math.floor(i / ROW_MAX) * (ROW_H + ROW_GAP));
    });

    state.manualLayout = false;
    markAllDirty();
  }

  function markAllDirty() {
    state.layout.forEach((_, k) => dirty.add(k));
    scheduleSaveLayout();
  }

  function scheduleSaveLayout() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushLayout, 600);
  }

  async function flushLayout() {
    const items = [];
    dirty.forEach((k) => {
      const p = state.layout.get(k);
      if (!p) return;
      const [kind, ref] = k.split(':');
      items.push({ kind, ref_id: Number(ref), x: p.x, y: p.y, collapsed: p.collapsed || 0 });
    });
    dirty.clear();
    if (!items.length) return;
    try { await Admin.put('/story/layout', { items }); } catch (_) { /* 位置存不上不影响编辑 */ }
  }

  /* ---------------- 渲染 ---------------- */
  function applyView() {
    world.style.transform = `translate(${state.view.x}px,${state.view.y}px) scale(${state.view.scale})`;
    $('bp-zoom').textContent = Math.round(state.view.scale * 100) + '%';
  }

  function charName(id) {
    const c = chars.find(x => x.id === id);
    return c ? c.name : (state.data.characters && state.data.characters[id]) || '';
  }

  function nodeIssueClass(nid) {
    if (state.issues.errs.has(nid)) return 'bp-error';
    if (state.issues.warns.has(nid)) return 'bp-warn';
    return '';
  }

  function renderNodes() {
    const { arcs, chapters, nodes } = state.data;
    nodesLayer.innerHTML = '';
    nodeEls = new Map();

    const add = (key, html, w, h) => {
      const p = state.layout.get(key) || { x: 0, y: 0 };
      const el = document.createElement('div');
      el.className = 'bp-node';
      el.dataset.key = key;
      el.style.cssText = `left:${p.x}px;top:${p.y}px;width:${w}px;height:${h ? h + 'px' : 'auto'}`;
      el.innerHTML = html;
      nodesLayer.appendChild(el);
      nodeEls.set(key, el);
      return el;
    };

    // 故事
    arcs.forEach((a) => {
      if (state.arcFilter && a.id !== state.arcFilter) return;
      const n = chapters.filter(c => c.story_arc_id === a.id).length;
      const el = add(`arc:${a.id}`, `
        <div class="bp-node-head">
          <span class="bp-kind-tag">故事</span>
          <span class="bp-title">${esc(a.title)}</span>
        </div>
        <div class="bp-node-body">
          <div class="bp-meta">${n} 章 · 排序 ${a.order_index}${a.is_active ? '' : ' · 已停用'}</div>
          ${a.description ? `<div class="bp-line" style="margin-top:3px">${esc(a.description)}</div>` : ''}
        </div>
        <div class="bp-port out" data-port="out" title="输出点：拖到章节可改归属"></div>`, W.arc);
      el.classList.add('bp-kind-arc');
    });

    // 章节
    chapters.forEach((c) => {
      const cnt = nodes.filter(n => n.chapter_id === c.id).length;
      const el = add(`chapter:${c.id}`, `
        <div class="bp-node-head">
          <span class="bp-kind-tag">章节</span>
          <span class="bp-title">第${c.chapter_order}章 ${esc(c.title)}</span>
        </div>
        <div class="bp-node-body">
          <div class="bp-meta">${cnt} 节点${c.is_main_story ? '' : ' · 支线'}</div>
          ${c.description ? `<div class="bp-line" style="margin-top:3px">${esc(c.description)}</div>` : ''}
        </div>
        <div class="bp-port in" data-port="in" title="接收点"></div>
        <div class="bp-port out" data-port="out" title="输出点：拖到节点可把该节点移入本章"></div>`, W.chapter);
      el.classList.add('bp-kind-chapter');
    });

    // 节点
    nodes.forEach((n) => {
      const t = n.node_type || 'dialogue';
      const sp = n.speaker_id ? charName(n.speaker_id) : '';
      const prevSpeakers = [];
      (n.dialogue_preview || []).forEach(d => {
        const nm = d.speaker_id ? charName(d.speaker_id) : '';
        if (nm && !prevSpeakers.includes(nm)) prevSpeakers.push(nm);
      });
      const speakers = prevSpeakers.length ? prevSpeakers : (sp ? [sp] : []);
      const firstLine = (n.dialogue_preview && n.dialogue_preview[0] && n.dialogue_preview[0].content) || n.content || '';
      const badges = [];
      if (n.is_key_node) badges.push('<span class="bp-badge key">关键</span>');
      if (t === 'battle') badges.push('<span class="bp-badge">战斗</span>');
      if (state.issues.errs.has(n.id)) badges.push(`<span class="bp-badge err">${esc(state.issues.errs.get(n.id)[0])}</span>`);
      else if (state.issues.warns.has(n.id)) badges.push(`<span class="bp-badge warn">${esc(state.issues.warns.get(n.id)[0])}</span>`);

      const chp = state.data.chapters.find(c => c.id === n.chapter_id);
      const chLabel = chp ? `第${chp.chapter_order}章` : '未归章';

      const isRun = state.run.active && state.run.list[state.run.i] && state.run.list[state.run.i].id === n.id;
      const isDone = state.run.active && state.run.list.slice(0, state.run.i).some(x => x.id === n.id);
      const isSel = state.sel && state.sel.kind === 'node' && state.sel.ref_id === n.id;

      const el = add(`node:${n.id}`, `
        <div class="bp-node-head">
          <span class="bp-kind-tag">${esc(TYPE_LABEL[t] || t)}</span>
          <span class="bp-title">${esc(n.title || ('节点 #' + n.id))}</span>
          <span style="font-size:9px;color:var(--text-muted)">#${n.id}</span>
        </div>
        <div class="bp-node-body">
          ${n.background_change ? `<div class="bp-node-thumb" style="background-image:url('${esc(n.background_change).replace(/'/g, '%27')}')"></div>` : ''}
          ${speakers.length ? `<div class="bp-line bp-speakers">${esc(speakers.join(' / '))}</div>` : ''}
          ${firstLine ? `<div class="bp-line">${esc(firstLine)}</div>` : '<div class="bp-line" style="color:var(--text-muted)">（空）</div>'}
          <div class="bp-meta">${esc(chLabel)} · ${n.dialogue_count} 句 · 序号 ${n.order_index}${n.choices_count ? ` · ${n.choices_count} 选项` : ''}</div>
          ${badges.length ? `<div class="bp-badge-row">${badges.join('')}</div>` : ''}
        </div>
        <div class="bp-port in" data-port="in" title="接收点"></div>
        <div class="bp-port out" data-port="out" title="输出点：拖到另一个节点可建分支"></div>
        <div class="bp-node-actions">
          <button class="bp-mini-btn" data-act="demo" title="载入真实画面">▶</button>
          <button class="bp-mini-btn" data-act="open" title="打开检查器">✎</button>
        </div>`, W.node);

      el.classList.add('bp-kind-node', 't-' + t);
      const ic = nodeIssueClass(n.id);
      if (ic) el.classList.add(ic);
      if (isSel) el.classList.add('bp-selected');
      if (isRun) el.classList.add('bp-running');
      if (isDone) el.classList.add('bp-done');
    });
  }

  function measureSizes() {
    state.sizes.clear();
    nodeEls.forEach((el, key) => {
      state.sizes.set(key, { w: el.offsetWidth || 300, h: el.offsetHeight || 90 });
    });
  }

  function rectOf(key) {
    const p = state.layout.get(key);
    const s = state.sizes.get(key) || { w: 300, h: 90 };
    if (!p) return null;
    return { x: p.x, y: p.y, w: s.w, h: s.h, cx: p.x + s.w / 2, cy: p.y + s.h / 2 };
  }

  /* ---------------- 连线几何 ----------------
   * 端口约定：每张卡左边 1 个接收点（in），右边 1 个输出点（out），
   * 圆心都在标题行中线上（y = 卡片顶 + PORT_Y）。所有连线一律 out → in，
   * 不再出现接到卡片中点/总线折线的情况。
   */
  function port(key, side) {
    const r = rectOf(key);
    if (!r) return null;
    return { x: side === 'out' ? r.x + r.w : r.x, y: r.y + PORT_Y };
  }

  // 同向平滑曲线；返回路径、中点、切角，供连线与方向标、标签定位
  function curve(a, b, trim = LINE_GAP) {
    const bx = b.x - trim;
    const k = Math.max(38, Math.min(190, Math.abs(bx - a.x) * 0.55));
    const P0 = { x: a.x, y: a.y }, P1 = { x: a.x + k, y: a.y };
    const P2 = { x: bx - k, y: b.y }, P3 = { x: bx, y: b.y };
    const pt = (t) => {
      const u = 1 - t;
      return {
        x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
        y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y,
      };
    };
    return {
      d: `M ${P0.x} ${P0.y} C ${P1.x} ${P1.y}, ${P2.x} ${P2.y}, ${P3.x} ${P3.y}`,
      pt,
      ang: Math.atan2(2 * (b.y - a.y), (P2.x + P3.x) - (P1.x + P0.x)) * 180 / Math.PI,
    };
  }

  // 圆角正交折线（换行回环用）
  function orthPath(pts, r = 12) {
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
      const v1x = Math.sign(cx - px), v1y = Math.sign(cy - py);
      const v2x = Math.sign(nx - cx), v2y = Math.sign(ny - cy);
      const rr = Math.max(2, Math.min(r,
        Math.abs(cx - px) / 2, Math.abs(cy - py) / 2,
        Math.abs(nx - cx) / 2, Math.abs(ny - cy) / 2));
      d += ` L ${cx - v1x * rr} ${cy - v1y * rr} Q ${cx} ${cy} ${cx + v2x * rr} ${cy + v2y * rr}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last[0]} ${last[1]}`;
    return d;
  }

  // 目标在左侧（换行/回环）：从输出点向右出 → 走卡片下方车道 → 从左侧接回接收点
  function wrapPath(a, b, aRect) {
    const bx = b.x - LINE_GAP;
    const outX = a.x + 30;
    const inX = bx - 30;
    const laneY = aRect.y + aRect.h + 26;
    return orthPath([
      [a.x, a.y], [outX, a.y], [outX, laneY], [inX, laneY], [inX, b.y], [bx, b.y],
    ]);
  }

  function drawLinks() {
    const { chapters, nodes, choices } = state.data;
    const parts = [];
    const labelParts = [];

    const put = (d, cls, title) => parts.push(`<path class="bp-link ${cls}" d="${d}"><title>${esc(title)}</title></path>`);
    const text = (x, y, s, cls) => labelParts.push(
      `<text class="bp-link-label ${cls || ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(s)}</text>`);
    // 方向标：放在线中段（每条线中点唯一，多条线汇到同一接收点也不会叠在一起）
    const chev = (cv, color, t = 0.5) => {
      const p = cv.pt(t);
      parts.push(`<path class="bp-chev" stroke="${color}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${cv.ang.toFixed(1)})" d="M -4.4 -3.3 L 3.4 0 L -4.4 3.3"></path>`);
    };
    const CL = ARROW_COLOR;

    // 1) 故事 → 章节（金色，故事卡输出点 → 章节卡接收点）
    chapters.forEach((c) => {
      if (!c.story_arc_id) return;
      const a = port(`arc:${c.story_arc_id}`, 'out');
      const b = port(`chapter:${c.id}`, 'in');
      if (!a || !b) return;
      const arc = state.data.arcs.find(x => x.id === c.story_arc_id);
      const cv = curve(a, b);
      put(cv.d, 'link-owner', `故事「${arc ? arc.title : c.story_arc_id}」→ 章节「${c.title}」`);
      chev(cv, CL.owner);
    });

    // 2) 章节 → 首节点（蓝）+ 章节内顺序推进（灰）
    chapters.forEach((c) => {
      const list = orderedNodes(c.id);
      if (!list.length) return;
      const a = port(`chapter:${c.id}`, 'out');
      const b = port(`node:${list[0].id}`, 'in');
      if (a && b) {
        const cv = curve(a, b);
        put(cv.d, 'link-entry', `章节「${c.title}」→ 首节点「${list[0].title || list[0].id}」`);
        chev(cv, CL.entry);
      }

      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1], cur = list[i];
        const pa = port(`node:${prev.id}`, 'out');
        const pb = port(`node:${cur.id}`, 'in');
        if (!pa || !pb) continue;
        // 目标在左边（换行）→ 走下方车道的直角折线；否则走平滑曲线
        if (pb.x < pa.x - 4) {
          put(wrapPath(pa, pb, rectOf(`node:${prev.id}`)), 'link-seq',
            `顺序：${prev.title || prev.id} → ${cur.title || cur.id}`);
        } else {
          const cv = curve(pa, pb);
          put(cv.d, 'link-seq', `顺序：${prev.title || prev.id} → ${cur.title || cur.id}`);
          chev(cv, CL.seq);
        }
      }
    });

    // 3) 选项分支（绿色，输出点 → 目标接收点，标签在线中前段）
    choices.forEach((ch) => {
      if (!ch.next_node_id) return;
      const a = port(`node:${ch.node_id}`, 'out');
      const b = port(`node:${ch.next_node_id}`, 'in');
      if (!a || !b) return;
      const cv = curve(a, b);
      put(cv.d, 'link-choice', `选项「${ch.choice_text}」→ #${ch.next_node_id}`);
      chev(cv, CL.choice);
      const t = (ch.choice_text || '').trim();
      if (t) {
        const lp = cv.pt(0.3);
        text(lp.x, lp.y - 7, t.length > 12 ? t.slice(0, 12) + '…' : t, 'lab-choice');
      }
    });

    // 4) 战斗分支（红色虚线）
    const BAT = { victory_node_id: '胜利', defeat_node_id: '失败', flee_node_id: '逃跑' };
    nodes.forEach((n) => {
      const a = port(`node:${n.id}`, 'out');
      if (!a) return;
      Object.keys(n.battle_links || {}).forEach((k, i) => {
        const b = port(`node:${n.battle_links[k]}`, 'in');
        if (!b) return;
        const cv = curve(a, b);
        const name = BAT[k] || k;
        put(cv.d, 'link-battle', `${name} → #${n.battle_links[k]}`);
        chev(cv, CL.battle);
        const lp = cv.pt(0.3);
        text(lp.x, lp.y + 13 + i * 11, name, 'lab-battle');
      });
    });

    svg.innerHTML = parts.join('') + labelParts.join('');
  }

  function renderAll() {
    renderNodes();
    // 等一帧拿到真实高度再画线
    requestAnimationFrame(() => {
      measureSizes();
      drawLinks();
      drawMinimap();
    });
    updateStats();
  }

  function updateStats() {
    const d = state.data;
    if (!d) return;
    const issues = state.issues.errs.size + state.issues.warns.size;
    $('bp-stats').innerHTML = `${d.stats.arcs} 故事 · ${d.stats.chapters} 章 · ${d.stats.nodes} 节点`
      + (issues ? ` · <span style="color:${state.issues.errs.size ? 'var(--red)' : 'var(--orange)'}">${issues} 项提示</span>` : '');
  }

  /* ---------------- 迷你地图 ---------------- */
  function contentBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.layout.forEach((p, k) => {
      if (!nodeEls.has(k)) return;
      const s = state.sizes.get(k) || { w: 300, h: 90 };
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 1200, h: 800 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function drawMinimap() {
    const cv = $('bp-minimap').querySelector('canvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const b = contentBounds();
    const pad = 40;
    const bx = b.x - pad, by = b.y - pad, bw = b.w + pad * 2, bh = b.h + pad * 2;
    const sc = Math.min(cv.width / bw, cv.height / bh);

    g.clearRect(0, 0, cv.width, cv.height);
    g.save();
    g.translate((cv.width - bw * sc) / 2, (cv.height - bh * sc) / 2);
    g.scale(sc, sc);
    g.translate(-bx, -by);

    nodeEls.forEach((el, k) => {
      const p = state.layout.get(k);
      const s = state.sizes.get(k) || { w: 300, h: 90 };
      if (!p) return;
      const kind = k.split(':')[0];
      g.fillStyle = kind === 'arc' ? 'rgba(201,168,76,.75)' : kind === 'chapter' ? 'rgba(79,143,247,.7)' : 'rgba(139,143,163,.55)';
      g.fillRect(p.x, p.y, s.w, s.h);
    });

    // 当前视口
    const r = canvas.getBoundingClientRect();
    const vx = (-state.view.x) / state.view.scale;
    const vy = (-state.view.y) / state.view.scale;
    const vw = r.width / state.view.scale;
    const vh = r.height / state.view.scale;
    g.strokeStyle = 'rgba(79,143,247,.9)';
    g.lineWidth = 2 / sc;
    g.strokeRect(vx, vy, vw, vh);
    g.restore();

    // 视口框（DOM 叠加）
    const viewBox = $('bp-mm-view');
    const mmR = $('bp-minimap').getBoundingClientRect();
    const offX = (cv.width - bw * sc) / 2, offY = (cv.height - bh * sc) / 2;
    const left = (offX + (vx - bx) * sc) / cv.width * mmR.width;
    const top = (offY + (vy - by) * sc) / cv.height * mmR.height;
    const ww = vw * sc / cv.width * mmR.width;
    const hh = vh * sc / cv.height * mmR.height;
    viewBox.style.cssText = `position:absolute;left:${Math.max(0, Math.min(mmR.width, left))}px;top:${Math.max(0, Math.min(mmR.height, top))}px;width:${Math.max(6, Math.min(mmR.width, ww))}px;height:${Math.max(6, Math.min(mmR.height, hh))}px;border:1px solid rgba(79,143,247,.8);background:rgba(79,143,247,.1);pointer-events:none`;
  }

  /* ---------------- 视口操作 ---------------- */
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - state.view.x) / state.view.scale,
      y: (clientY - r.top - state.view.y) / state.view.scale,
    };
  }

  function fitView() {
    const b = contentBounds();
    const r = canvas.getBoundingClientRect();
    const pad = 60;
    const sc = Math.max(0.2, Math.min(1.6, Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h)));
    state.view.scale = sc;
    state.view.x = (r.width - b.w * sc) / 2 - b.x * sc;
    state.view.y = (r.height - b.h * sc) / 2 - b.y * sc;
    applyView();
    drawMinimap();
  }

  function focusNode(nid) {
    const p = state.layout.get(`node:${nid}`);
    if (!p) return;
    const s = state.sizes.get(`node:${nid}`) || { w: W.node, h: 120 };
    const r = canvas.getBoundingClientRect();
    state.view.x = r.width / 2 - (p.x + s.w / 2) * state.view.scale;
    state.view.y = r.height / 2 - (p.y + s.h / 2) * state.view.scale;
    applyView();
    drawMinimap();
  }

  /* ---------------- 连线拖拽 ---------------- */
  function startLink(e, fromKey) {
    e.stopPropagation();
    e.preventDefault();
    const a = port(fromKey, 'out');
    if (!a) return;
    linkDrag = { fromKey, anchor: a };
    canvas.classList.add('bp-linking');
    ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ghost.setAttribute('class', 'bp-link-ghost');
    ghost.innerHTML = '<path class="bp-link link-hover" d=""></path>';
    world.appendChild(ghost);
  }

  function hitCard(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.closest ? el.closest('.bp-node') : null;
  }

  function moveLink(e) {
    if (!linkDrag || !ghost) return;
    nodeEls.forEach((el) => el.classList.remove('bp-drop'));
    let target = toWorld(e.clientX, e.clientY);
    const card = hitCard(e);
    if (card && card.dataset.key !== linkDrag.fromKey) {
      card.classList.add('bp-drop');
      // 吸附到目标卡的接收点
      const p = port(card.dataset.key, 'in');
      if (p) target = p;
    }
    ghost.querySelector('path').setAttribute('d', curve(linkDrag.anchor, target, 0).d);
  }

  async function endLink(e) {
    if (!linkDrag) return;
    const from = linkDrag.fromKey;
    linkDrag = null;
    canvas.classList.remove('bp-linking');
    if (ghost) { ghost.remove(); ghost = null; }
    nodeEls.forEach((el) => el.classList.remove('bp-drop'));

    const card = hitCard(e);
    if (!card) return;
    const to = card.dataset.key;
    if (!to || to === from) return;

    const [fk, fr] = from.split(':');
    const [tk, tr] = to.split(':');
    const frId = Number(fr), trId = Number(tr);

    try {
      // 章节 → 故事 / 故事 → 章节：改章节归属
      if ((fk === 'chapter' && tk === 'arc') || (fk === 'arc' && tk === 'chapter')) {
        const chId = fk === 'chapter' ? frId : trId;
        const arcId = fk === 'arc' ? frId : trId;
        await Admin.put(`/story/chapters/${chId}`, { story_arc_id: arcId });
        Admin.toast('章节归属已更新', 'success');
        return refresh();
      }
      // 节点 → 章节：改节点所属章节
      if (fk === 'node' && tk === 'chapter') {
        await changeNodeChapter(frId, trId);
        return;
      }
      if (fk === 'chapter' && tk === 'node') {
        await changeNodeChapter(trId, frId);
        return;
      }
      // 节点 → 节点：建分支
      if (fk === 'node' && tk === 'node') {
        if (frId === trId) return;
        const text = await promptText('新分支的条件/选项文字', '继续');
        if (text == null) return;
        await Admin.post('/story/choices', {
          node_id: frId, choice_text: text || '继续', next_node_id: trId,
          condition_group: null, effects: null, is_hidden: 0,
        });
        Admin.toast('已创建分支', 'success');
        return refresh(frId);
      }
      Admin.toast('这两种节点不能这样连线', 'info');
    } catch (err) {
      Admin.toast('连线失败: ' + err.message, 'error');
    }
  }

  async function changeNodeChapter(nodeId, chapterId) {
    const full = await Admin.get(`/story/nodes/${nodeId}`);
    const payload = {
      chapter_id: chapterId,
      scene_id: full.scene_id, node_type: full.node_type, title: full.title,
      speaker_id: full.speaker_id, content: full.content, content_image: full.content_image,
      expression: full.expression, position: full.position, multi_characters: full.multi_characters,
      bgm: full.bgm, background_change: full.background_change,
      bg_animation_effect_id: full.bg_animation_effect_id,
      is_key_node: full.is_key_node, order_index: full.order_index,
      tags: full.tags, category_path: full.category_path,
      battle_config: full.battle_config, import_batch_id: full.import_batch_id,
    };
    await Admin.put(`/story/nodes/${nodeId}`, payload);
    Admin.toast('节点已移到新章节', 'success');
    await refresh(nodeId);
  }

  function promptText(title, val) {
    return new Promise((resolve) => {
      const v = window.prompt(title, val);
      resolve(v);
    });
  }

  /* ---------------- 拖拽 / 选中 ---------------- */
  function bindCanvas() {
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const before = state.view.scale;
      const next = Math.max(0.22, Math.min(2.2, before * (e.deltaY < 0 ? 1.1 : 0.9)));
      state.view.x = mx - (mx - state.view.x) * (next / before);
      state.view.y = my - (my - state.view.y) * (next / before);
      state.view.scale = next;
      applyView();
      drawMinimap();
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      const portEl = e.target.closest('.bp-port');
      if (portEl) {
        const card = portEl.closest('.bp-node');
        // 只允许从输出点拖出连线；接收点只作为落点
        if (card && portEl.dataset.port === 'out') startLink(e, card.dataset.key);
        return;
      }
      const actionBtn = e.target.closest('[data-act]');
      if (actionBtn) return;

      const card = e.target.closest('.bp-node');
      if (card) {
        const key = card.dataset.key;
        const [kind, ref] = key.split(':');
        select({ kind, ref_id: Number(ref) });
        // 开始拖拽
        const p = state.layout.get(key);
        const w = toWorld(e.clientX, e.clientY);
        dragCtx = { key, dx: w.x - p.x, dy: w.y - p.y, moved: false, startX: e.clientX, startY: e.clientY };
        card.setPointerCapture(e.pointerId);
        card.style.cursor = 'grabbing';
        return;
      }

      // 空白：平移
      dragCtx = { pan: true, startX: e.clientX, startY: e.clientY, vx: state.view.x, vy: state.view.y };
      canvas.classList.add('bp-panning');
      if (state.sel) select(null);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (linkDrag) { moveLink(e); return; }
      if (!dragCtx) return;
      if (dragCtx.pan) {
        state.view.x = dragCtx.vx + (e.clientX - dragCtx.startX);
        state.view.y = dragCtx.vy + (e.clientY - dragCtx.startY);
        applyView();
        drawMinimap();
        return;
      }
      if (dragCtx.key) {
        if (Math.abs(e.clientX - dragCtx.startX) + Math.abs(e.clientY - dragCtx.startY) > 3) dragCtx.moved = true;
        const w = toWorld(e.clientX, e.clientY);
        const p = state.layout.get(dragCtx.key);
        p.x = Math.round(w.x - dragCtx.dx);
        p.y = Math.round(w.y - dragCtx.dy);
        const el = nodeEls.get(dragCtx.key);
        if (el) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
        dirty.add(dragCtx.key);
        drawLinks();
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (linkDrag) { endLink(e); return; }
      if (dragCtx) {
        if (dragCtx.key) {
          if (dragCtx.moved) scheduleSaveLayout();
          const el = nodeEls.get(dragCtx.key);
          if (el) el.style.cursor = 'grab';
        }
        if (dragCtx.pan) canvas.classList.remove('bp-panning');
        dragCtx = null;
      }
      drawMinimap();
    });

    canvas.addEventListener('pointercancel', () => {
      if (ghost) { ghost.remove(); ghost = null; }
      linkDrag = null;
      dragCtx = null;
      canvas.classList.remove('bp-panning', 'bp-linking');
    });

    // 节点上的小按钮
    nodesLayer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const card = b.closest('.bp-node');
      if (!card) return;
      const id = Number(card.dataset.key.split(':')[1]);
      if (b.dataset.act === 'demo') { demoNode(id); return; }
      if (b.dataset.act === 'open') { select({ kind: 'node', ref_id: id }); return; }
    });

    // 双击节点：演示
    nodesLayer.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.bp-node');
      if (!card) return;
      if (card.dataset.key.startsWith('node:')) demoNode(Number(card.dataset.key.split(':')[1]));
    });
  }

  function select(sel) {
    state.sel = sel;
    nodeEls.forEach((el, k) => {
      const [kind, ref] = k.split(':');
      el.classList.toggle('bp-selected', !!sel && sel.kind === kind && sel.ref_id === Number(ref));
    });
    if (!sel) {
      if (window.BPInspector) BPInspector.close();
      return;
    }
    if (window.BPInspector) BPInspector.open(ctx, sel);
  }

  function clearSelection() {
    state.sel = null;
    nodeEls.forEach(el => el.classList.remove('bp-selected'));
  }

  /* ---------------- 校验 ---------------- */
  function validate() {
    const errs = new Map(), warns = new Map();
    const add = (m, id, msg) => {
      const list = m.get(id) || [];
      if (!list.includes(msg)) list.push(msg);
      m.set(id, list);
    };
    const ids = new Set(state.data.nodes.map(n => n.id));

    state.data.nodes.forEach((n) => {
      if (!n.dialogue_count && !(n.content || '').trim()) add(warns, n.id, '没有对白或正文');
      const hasSpeaker = n.speaker_id || (n.dialogue_preview || []).some(d => d.speaker_id);
      if (n.dialogue_count && !hasSpeaker) add(warns, n.id, '对白缺少说话人');
      if (n.node_type === 'battle' && !n.battle_config) add(errs, n.id, '战斗节点缺配置');
      if (n.background_change && /^\s*$/.test(n.background_change)) add(warns, n.id, '背景图为空');
    });

    state.data.choices.forEach((c) => {
      if (!c.next_node_id) add(warns, c.node_id, `选项「${c.choice_text}」未设置跳转`);
      else if (!ids.has(c.next_node_id)) add(errs, c.node_id, `选项跳转到不存在的节点 #${c.next_node_id}`);
    });

    // 同章序号重复
    const byCh = {};
    state.data.nodes.forEach(n => { (byCh[n.chapter_id] = byCh[n.chapter_id] || []).push(n); });
    Object.values(byCh).forEach((list) => {
      const seen = new Map();
      list.forEach((n) => {
        const k = n.order_index;
        if (seen.has(k)) add(warns, n.id, `序号 ${k} 与 #${seen.get(k)} 重复`);
        else seen.set(k, n.id);
      });
    });

    // 分支环检测
    const adj = new Map();
    state.data.choices.forEach((c) => {
      if (c.next_node_id && ids.has(c.next_node_id)) {
        const a = adj.get(c.node_id) || [];
        a.push(c.next_node_id);
        adj.set(c.node_id, a);
      }
    });
    const color = new Map();
    const dfs = (u, stack) => {
      color.set(u, 1);
      (adj.get(u) || []).forEach((v) => {
        if (color.get(v) === 1) {
          const at = stack.indexOf(v);
          const cyc = at >= 0 ? stack.slice(at) : [v];
          cyc.forEach(id => add(errs, id, '分支形成循环'));
        } else if (!color.get(v)) dfs(v, stack.concat([v]));
      });
      color.set(u, 2);
    };
    ids.forEach(id => { if (!color.get(id)) dfs(id, [id]); });

    state.issues = { errs, warns };
    return { errs, warns };
  }

  function showIssues() {
    const { errs, warns } = state.issues;
    const box = $('bp-issues');
    if (!errs.size && !warns.size) {
      box.className = 'bp-issues show';
      box.innerHTML = '<h4>✓ 校验通过</h4><div style="color:var(--text-muted)">没有发现断链、空节点、重复序号或循环分支。</div>';
      return;
    }
    let h = `<h4>${errs.size ? `<span class="lv-err">${errs.size} 个错误</span>` : ''}${errs.size && warns.size ? ' · ' : ''}${warns.size ? `<span class="lv-warn">${warns.size} 个提醒</span>` : ''}</h4>`;
    const rows = [];
    errs.forEach((list, id) => list.forEach(m => rows.push([id, m, 'err'])));
    warns.forEach((list, id) => list.forEach(m => rows.push([id, m, 'warn'])));
    rows.slice(0, 80).forEach(([id, m, lv]) => {
      const n = state.data.nodes.find(x => x.id === id);
      h += `<div class="bp-issue" data-node="${id}"><span class="lv-${lv}">${lv === 'err' ? '✕' : '!'}</span> #${id} ${esc(n ? n.title || n.node_type : '')} — ${esc(m)}</div>`;
    });
    box.className = 'bp-issues show';
    box.innerHTML = h;
  }

  /* ---------------- 试运行 ---------------- */
  const demoUrl = (id) => `/?demo_node=${id}&_t=${Date.now()}`;

  function demoNode(id) {
    const n = state.data.nodes.find(x => x.id === id);
    let host = document.getElementById('demo-layer');
    if (!host) {
      host = document.createElement('div');
      host.id = 'demo-layer';
      document.body.appendChild(host);
    }
    host.innerHTML = `
      <div class="demo-box">
        <div class="demo-head">
          <b>▶ 演示 · ${esc(n ? (n.title || n.node_type) : id)}</b>
          <span class="demo-sub">玩家看到的画面 · 点画面或空格推进 · 不写存档</span>
          <span style="flex:1"></span>
          <button class="btn btn-outline btn-sm" id="demo-reload">↻ 重播</button>
          <button class="btn btn-primary btn-sm" id="demo-close">关闭</button>
        </div>
        <iframe class="demo-frame" id="demo-frame" src="${demoUrl(id)}" allow="autoplay"></iframe>
      </div>`;
    host.style.display = 'flex';
    host.querySelector('#demo-close').onclick = () => { host.style.display = 'none'; host.innerHTML = ''; };
    host.querySelector('#demo-reload').onclick = () => { host.querySelector('#demo-frame').src = demoUrl(id); };
    host.onclick = (e) => { if (e.target === host) { host.style.display = 'none'; host.innerHTML = ''; } };
  }

  function runChapter() {
    let chId = null;
    if (state.sel && state.sel.kind === 'chapter') chId = state.sel.ref_id;
    if (!chId) {
      const firstCh = state.data.chapters[0];
      chId = firstCh ? firstCh.id : null;
    }
    if (!chId) return Admin.toast('还没有章节可运行', 'info');
    const list = state.data.nodes
      .filter(n => n.chapter_id === chId)
      .sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id));
    if (!list.length) return Admin.toast('这一章还没有节点', 'info');

    state.run = { active: true, list, i: 0 };
    $('bp-runbar').classList.add('show');
    loadRunNode();
    renderNodes();
    requestAnimationFrame(() => { measureSizes(); drawLinks(); });
    focusNode(list[0].id);
  }

  function loadRunNode() {
    const r = state.run;
    const n = r.list[r.i];
    if (!n) return stopRun();
    $('bp-run-now').textContent = `#${n.id} ${n.title || n.node_type}`;
    $('bp-run-pos').textContent = `${r.i + 1} / ${r.list.length}`;
    $('bp-run-frame').src = demoUrl(n.id);
    $('bp-run-prev').disabled = r.i <= 0;
    $('bp-run-next').disabled = r.i >= r.list.length - 1;
    renderNodes();
    requestAnimationFrame(() => {
      measureSizes(); drawLinks();
      const el = nodeEls.get(`node:${n.id}`);
      if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    focusNode(n.id);
  }

  function stopRun() {
    state.run = { active: false, list: [], i: -1 };
    $('bp-runbar').classList.remove('show');
    $('bp-run-frame').src = 'about:blank';
    renderNodes();
    requestAnimationFrame(() => { measureSizes(); drawLinks(); });
  }

  /* ---------------- 刷新 ---------------- */
  async function refresh(focusId) {
    try {
      await loadData();
      if (!checkLayoutVersion()) autoLayoutIfMissing();
      validate();
      renderAll();
      updateFilterOptions();
      if (focusId) focusNode(Number(focusId));
      if (state.sel) {
        const still = state.sel.kind === 'arc'
          ? state.data.arcs.some(a => a.id === state.sel.ref_id)
          : state.sel.kind === 'chapter'
            ? state.data.chapters.some(c => c.id === state.sel.ref_id)
            : state.data.nodes.some(n => n.id === state.sel.ref_id);
        if (still && window.BPInspector) BPInspector.open(ctx, state.sel);
        else { state.sel = null; if (window.BPInspector) BPInspector.close(); }
      }
    } catch (e) {
      console.error(e);
      Admin.toast('载入蓝图失败：' + e.message + '（若刚更新代码，请重启后端）', 'error');
    }
  }

  function autoLayoutIfMissing() {
    let missing = 0;
    state.data.arcs.forEach(a => { if (!state.layout.has(`arc:${a.id}`)) missing++; });
    state.data.chapters.forEach(c => { if (!state.layout.has(`chapter:${c.id}`)) missing++; });
    state.data.nodes.forEach(n => { if (!state.layout.has(`node:${n.id}`)) missing++; });
    if (missing > 0) autoLayout();
  }

  // 布局规则变了（例如从竖排改成横排），强制重排一次，避免旧坐标把卡片叠在一起
  function checkLayoutVersion() {
    const k = 'bp_layout_ver';
    let v = 0;
    try { v = Number(localStorage.getItem(k) || 0); } catch (_) { /* 隐私模式忽略 */ }
    if (v === LAYOUT_VER) return false;
    try { localStorage.setItem(k, String(LAYOUT_VER)); } catch (_) { /* ignore */ }
    state.layout.clear();
    autoLayout();
    return true;
  }

  /* ---------------- 工具栏 ---------------- */
  function updateFilterOptions() {
    const selEl = $('bp-arc-filter');
    const cur = String(state.arcFilter || 0);
    selEl.innerHTML = '<option value="0">全部故事</option>' + state.data.arcs
      .map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
    selEl.value = cur;
  }

  function bindToolbar() {
    $('bp-arc-filter').addEventListener('change', async (e) => {
      state.arcFilter = Number(e.target.value) || 0;
      state.sel = null;
      if (window.BPInspector) BPInspector.close();
      await refresh();
      fitView();
    });
    $('bp-auto').addEventListener('click', () => {
      state.manualLayout = true;
      state.layout.clear();
      autoLayout();
      renderAll();
      requestAnimationFrame(fitView);
      Admin.toast('已按故事/章节/顺序重排', 'success');
    });
    $('bp-fit').addEventListener('click', fitView);
    $('bp-zoom-in').addEventListener('click', () => {
      state.view.scale = Math.min(2.2, state.view.scale * 1.15);
      applyView(); drawMinimap();
    });
    $('bp-zoom-out').addEventListener('click', () => {
      state.view.scale = Math.max(0.22, state.view.scale / 1.15);
      applyView(); drawMinimap();
    });
    $('bp-validate').addEventListener('click', () => {
      validate();
      renderAll();
      showIssues();
    });
    $('bp-run').addEventListener('click', runChapter);
    $('bp-refresh').addEventListener('click', () => refresh(state.sel && state.sel.kind === 'node' ? state.sel.ref_id : null));
    // 批量导入：和「剧情管理」里那套弹窗是同一个（选音色已是平铺卡片 + 试听）。
    // 两个分支：
    //   · 本次会话打开过剧情页 → 直接原地弹窗，导完留在蓝图里重画；
    //   · 直接进蓝图（剧情页还没渲染过，导入组件尚未初始化）→ 切到剧情页再弹，
    //     宁可换个页面也不能少功能：章节选择、导入记录、按章节生成都在那边。
    $('bp-import').addEventListener('click', async () => {
      if (typeof window.StoryImport === 'function') {
        await window.StoryImport({
          arcId: state.arcFilter || undefined,
          onDone: async () => {
            try { await refresh(); fitView(); } catch (_) {}
          },
        });
        return;
      }
      const go = await Admin.confirm(
        '批量导入在「剧情管理」页展开（章节选择、导入记录、按章节生成都在那边）。\n\n' +
        '现在就过去？导入完成后点左侧「剧情蓝图」即可回来。');
      if (!go) return;
      await Admin.navigate('story');
      if (typeof window.StoryImport === 'function') {
        window.StoryImport({});
      } else {
        Admin.toast('批量导入入口没就绪，刷新页面再试', 'error');
      }
    });
    $('bp-list-view').addEventListener('click', () => Admin.navigate('story'));
    $('bp-run-prev').addEventListener('click', () => { if (state.run.i > 0) { state.run.i--; loadRunNode(); } });
    $('bp-run-next').addEventListener('click', () => { if (state.run.i < state.run.list.length - 1) { state.run.i++; loadRunNode(); } });
    $('bp-run-stop').addEventListener('click', stopRun);
    $('bp-issues').addEventListener('click', (e) => {
      const row = e.target.closest('[data-node]');
      if (!row) return;
      const id = Number(row.dataset.node);
      state.sel = { kind: 'node', ref_id: id };
      BPInspector.open(ctx, state.sel);
      renderNodes();
      focusNode(id);
    });
    $('bp-minimap').addEventListener('click', (e) => {
      const r = $('bp-minimap').getBoundingClientRect();
      const cv = $('bp-minimap').querySelector('canvas');
      const b = contentBounds();
      const pad = 40, bw = b.w + pad * 2, bh = b.h + pad * 2;
      const sc = Math.min(cv.width / bw, cv.height / bh);
      const offX = (cv.width - bw * sc) / 2, offY = (cv.height - bh * sc) / 2;
      const bx = b.x - pad, by = b.y - pad;
      const wx = bx + ((e.clientX - r.left) / r.width * cv.width - offX) / sc;
      const wy = by + ((e.clientY - r.top) / r.height * cv.height - offY) / sc;
      const cr = canvas.getBoundingClientRect();
      state.view.x = cr.width / 2 - wx * state.view.scale;
      state.view.y = cr.height / 2 - wy * state.view.scale;
      applyView(); drawMinimap();
    });
    window.addEventListener('resize', () => { drawMinimap(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.sel) select(null);
    });
  }

  /* ---------------- 启动 ---------------- */
  const bpCtx = {
    get arcs() { return state.data.arcs; },
    get chapters() { return state.data.chapters; },
    get nodes() { return state.data.nodes; },
    get choices() { return state.data.choices; },
    get chars() { return chars; },
    get scenes() { return scenes; },
    refresh,
    demoNode,
    clearSelection,
  };
  const ctx = bpCtx;

  bindCanvas();
  bindToolbar();
  await refresh();
  // 横排版通常能整体放下；放不下时保留可读缩放，用迷你地图/适应画布看全貌
  requestAnimationFrame(() => {
    const b = contentBounds();
    const r = canvas.getBoundingClientRect();
    const fit = Math.min((r.width - 120) / b.w, (r.height - 120) / b.h);
    if (fit >= 0.42) { fitView(); return; }
    state.view.scale = 0.62;
    state.view.x = 34 - b.x * 0.62;
    state.view.y = 40 - b.y * 0.62;
    applyView();
    drawMinimap();
  });

  // 深链：?bp_node=123 直接打开该节点的检查器（便于从列表跳过来定位）
  const deepNode = Number(new URLSearchParams(location.search).get('bp_node') || 0);
  if (deepNode && state.data.nodes.some(n => n.id === deepNode)) {
    setTimeout(() => { select({ kind: 'node', ref_id: deepNode }); focusNode(deepNode); }, 220);
  }
});
