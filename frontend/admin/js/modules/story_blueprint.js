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

  const W = { arc: 248, chapter: 268, node: 300 };
  const TYPE_LABEL = { dialogue: '对话', choice: '选择', battle: '战斗', cutscene: '过场', event: '事件' };

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
        <button class="btn btn-gold btn-sm" id="bp-run" title="逐个节点载入真实画面">▶ 运行本章</button>
        <button class="btn btn-outline btn-sm" id="bp-refresh">↻ 刷新</button>
        <button class="btn btn-outline btn-sm" id="bp-list-view" title="切回原来的表格/卡片列表">☰ 列表视图</button>
        <div style="flex:1"></div>
        <div class="bp-legend">
          <span><i style="border-top-color:rgba(79,143,247,.7)"></i>归属</span>
          <span><i style="border-top-color:rgba(76,175,136,.9)"></i>分支</span>
          <span><i style="border-top-color:rgba(224,85,85,.9)"></i>战斗</span>
          <span><i style="border-top-color:rgba(139,143,163,.6);border-top-style:dashed"></i>顺序</span>
        </div>
      </div>
      <div class="bp-body">
        <div class="bp-canvas" id="bp-canvas">
          <div class="bp-canvas-hint">拖空白平移 · 滚轮缩放 · 单击节点编辑 · 从右侧圆点拖出连线建分支</div>
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

  /* ---------------- 自动布局 ---------------- */
  function autoLayout() {
    const { arcs, chapters, nodes } = state.data;
    const estNode = 106;
    let ay = 70;
    const seenArc = new Set();

    const layArcChapters = (arc) => {
      let cy = ay;
      chapters.filter(c => c.story_arc_id === arc.id)
        .sort((a, b) => (a.chapter_order - b.chapter_order) || (a.id - b.id))
        .forEach((ch) => {
          const key = `chapter:${ch.id}`;
          if (!state.layout.has(key) || state.manualLayout) state.layout.set(key, { x: 370, y: cy });
          let ny = cy;
          nodes.filter(n => n.chapter_id === ch.id)
            .sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id))
            .forEach((n) => {
              const nk = `node:${n.id}`;
              if (!state.layout.has(nk) || state.manualLayout) state.layout.set(nk, { x: 700, y: ny });
              ny += Math.max(96, estNode);
            });
          cy = Math.max(cy + 82, ny) + 30;
        });
      return cy;
    };

    arcs.forEach((arc) => {
      seenArc.add(arc.id);
      if (!state.layout.has(`arc:${arc.id}`) || state.manualLayout) state.layout.set(`arc:${arc.id}`, { x: 60, y: ay });
      const end = layArcChapters(arc);
      ay = Math.max(ay + 82, end) + 56;
    });

    // 没有归属故事的章节
    chapters.filter(c => !c.story_arc_id || !seenArc.has(c.story_arc_id)).forEach((ch) => {
      state.layout.set(`chapter:${ch.id}`, { x: 370, y: ay });
      let ny = ay;
      nodes.filter(n => n.chapter_id === ch.id).forEach((n) => {
        state.layout.set(`node:${n.id}`, { x: 700, y: ny });
        ny += estNode;
      });
      ay = Math.max(ay + 82, ny) + 30;
    });

    // 章节缺失的节点兜底
    const chIds = new Set(chapters.map(c => c.id));
    nodes.filter(n => !chIds.has(n.chapter_id)).forEach((n, i) => {
      state.layout.set(`node:${n.id}`, { x: 700, y: ay + i * estNode });
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
        <div class="bp-port out" data-port="out"></div>`, W.arc);
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
        <div class="bp-port in" data-port="in"></div>
        <div class="bp-port out" data-port="out"></div>`, W.chapter);
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
          <div class="bp-meta">${n.dialogue_count} 句 · 序号 ${n.order_index}${n.choices_count ? ` · ${n.choices_count} 选项` : ''}</div>
          ${badges.length ? `<div class="bp-badge-row">${badges.join('')}</div>` : ''}
        </div>
        <div class="bp-port in" data-port="in"></div>
        <div class="bp-port out" data-port="out" title="拖到另一个节点可建分支"></div>
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

  function bez(x1, y1, x2, y2, vertical) {
    if (vertical) {
      const dy = Math.max(24, Math.abs(y2 - y1) * 0.42);
      return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
    }
    const dx = Math.max(36, Math.abs(x2 - x1) * 0.46);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function drawLinks() {
    const { chapters, nodes, choices } = state.data;
    const parts = [];
    const labelParts = [];

    const line = (d, cls, title, label) => {
      parts.push(`<path class="bp-link ${cls}" d="${d}"><title>${esc(title)}</title></path>`);
      if (label) {
        const m = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // 不实际测量路径，标签统一放在终点左侧上方，足够清楚
        labelParts.push(`<text class="bp-link-label" x="${label.x}" y="${label.y}">${esc(label.text)}</text>`);
      }
    };

    chapters.forEach((c) => {
      if (!c.story_arc_id) return;
      const a = rectOf(`arc:${c.story_arc_id}`);
      const r = rectOf(`chapter:${c.id}`);
      if (!a || !r) return;
      const sy = Math.max(a.y + 10, Math.min(a.y + a.h - 10, r.cy));
      line(bez(a.x + a.w, sy, r.x, r.cy), 'link-owner', `章节归属：${c.title}`);
    });

    // 章节 → 节点：先汇到一条垂直总线，再从总线水平接入每个节点。
    // 18 个节点如果都从章节卡同一点发散会糊成一团，总线画法像专业节点工作流。
    const byChapter = {};
    nodes.forEach((n) => { (byChapter[n.chapter_id] = byChapter[n.chapter_id] || []).push(n); });
    Object.keys(byChapter).forEach((chId) => {
      const c = rectOf(`chapter:${chId}`);
      if (!c) return;
      const list = byChapter[chId]
        .map(n => ({ n, r: rectOf(`node:${n.id}`) }))
        .filter(x => x.r);
      if (!list.length) return;
      const busX = c.x + c.w + 30;
      const ys = list.map(x => x.r.cy);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const sy = Math.max(c.y + 10, Math.min(c.y + c.h - 10, (minY + maxY) / 2));
      if (maxY - minY > 2) {
        parts.push(`<path class="bp-link link-bus" d="M ${busX} ${minY} L ${busX} ${maxY}"></path>`);
      }
      parts.push(`<path class="bp-link link-membership" d="${bez(c.x + c.w, sy, busX, minY)}"><title>章节节点总线</title></path>`);
      list.forEach(({ n, r }) => {
        parts.push(`<path class="bp-link link-membership" d="M ${busX} ${r.cy} L ${r.x} ${r.cy}"><title>章节包含：${esc(n.title || n.id)}</title></path>`);
      });
    });

    // 同章节顺序（纵向）
    const byCh = {};
    nodes.forEach(n => { (byCh[n.chapter_id] = byCh[n.chapter_id] || []).push(n); });
    Object.values(byCh).forEach((list) => {
      list.sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id));
      for (let i = 1; i < list.length; i++) {
        const a = rectOf(`node:${list[i - 1].id}`);
        const b = rectOf(`node:${list[i].id}`);
        if (!a || !b) continue;
        line(bez(a.cx, a.y + a.h, b.cx, b.y, true), 'link-seq', '顺序推进');
      }
    });

    // 选项分支
    choices.forEach((ch) => {
      if (!ch.next_node_id) return;
      const a = rectOf(`node:${ch.node_id}`);
      const b = rectOf(`node:${ch.next_node_id}`);
      if (!a || !b) return;
      const d = bez(a.x + a.w, a.cy + 8, b.x, b.cy);
      line(d, 'link-choice', `选项「${ch.choice_text}」→ #${ch.next_node_id}`, null);
      const t = (ch.choice_text || '').slice(0, 10) + (ch.choice_text && ch.choice_text.length > 10 ? '…' : '');
      if (t) labelParts.push(`<text class="bp-link-label" x="${(a.x + a.w + b.x) / 2 - 16}" y="${(a.cy + b.cy) / 2 - 5}">${esc(t)}</text>`);
    });

    // 战斗分支
    nodes.forEach((n) => {
      const links = n.battle_links || {};
      const a = rectOf(`node:${n.id}`);
      if (!a) return;
      Object.keys(links).forEach((k) => {
        const b = rectOf(`node:${links[k]}`);
        if (!b) return;
        const name = { victory_node_id: '胜利', defeat_node_id: '失败', flee_node_id: '逃跑' }[k] || k;
        line(bez(a.x + a.w, a.cy + 18, b.x, b.cy), 'link-battle', `${name} → #${links[k]}`, null);
        labelParts.push(`<text class="bp-link-label" x="${(a.x + a.w + b.x) / 2 - 10}" y="${(a.cy + b.cy) / 2 + 12}">${esc(name)}</text>`);
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
    const r = canvas.getBoundingClientRect();
    state.view.x = r.width / 2 - (p.x + 150) * state.view.scale;
    state.view.y = r.height / 2 - (p.y + 55) * state.view.scale;
    applyView();
    drawMinimap();
  }

  /* ---------------- 连线拖拽 ---------------- */
  function startLink(e, fromKey) {
    e.stopPropagation();
    e.preventDefault();
    const p = state.layout.get(fromKey);
    const s = state.sizes.get(fromKey) || { w: 300, h: 90 };
    const right = fromKey.startsWith('node:') ? { x: p.x + s.w, y: p.y + s.h / 2 + 8 } : { x: p.x + s.w, y: p.y + s.h / 2 };
    linkDrag = { fromKey, anchor: right };
    canvas.classList.add('bp-linking');
    ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ghost.setAttribute('class', 'bp-link-ghost');
    ghost.innerHTML = '<path class="bp-link link-hover" d=""></path>';
    world.appendChild(ghost);
  }

  function moveLink(e) {
    if (!linkDrag || !ghost) return;
    const w = toWorld(e.clientX, e.clientY);
    const a = linkDrag.anchor;
    const path = ghost.querySelector('path');
    path.setAttribute('d', bez(a.x, a.y, w.x, w.y));
    // 高亮悬停目标
    nodeEls.forEach((el) => el.classList.remove('bp-drop'));
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const card = target && target.closest ? target.closest('.bp-node') : null;
    if (card && card.dataset.key !== linkDrag.fromKey) card.classList.add('bp-drop');
  }

  async function endLink(e) {
    if (!linkDrag) return;
    const from = linkDrag.fromKey;
    linkDrag = null;
    canvas.classList.remove('bp-linking');
    if (ghost) { ghost.remove(); ghost = null; }
    nodeEls.forEach((el) => el.classList.remove('bp-drop'));

    const target = document.elementFromPoint(e.clientX, e.clientY);
    const card = target && target.closest ? target.closest('.bp-node') : null;
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
      const port = e.target.closest('.bp-port');
      if (port) {
        const card = port.closest('.bp-node');
        if (card) startLink(e, card.dataset.key);
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
      autoLayoutIfMissing();
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
      // 保留已手动摆放的故事卡，重排章节与节点
      state.layout.forEach((v, k) => { if (!k.startsWith('arc:')) state.layout.delete(k); });
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
  // 内容纵向通常很长，直接 fit 会缩到看不清；先把视图定在第一个故事卡上，保证可读
  const firstKey = state.data.arcs.length
    ? `arc:${state.data.arcs[0].id}`
    : (state.data.chapters.length ? `chapter:${state.data.chapters[0].id}` : null);
  const fp = firstKey ? state.layout.get(firstKey) : null;
  if (fp) {
    state.view.scale = 0.8;
    state.view.x = 40 - fp.x * 0.8;
    state.view.y = 30 - fp.y * 0.8;
    applyView();
  }
  setTimeout(() => {
    const b = contentBounds();
    const r = canvas.getBoundingClientRect();
    // 整体放得下就适配；放不下就保留 0.8 的局部视图（用户可点「适应画布」看全貌）
    if (b.h * 0.8 < r.height - 70 && b.w * 0.8 < r.width - 70) fitView();
    else drawMinimap();
  }, 120);

  // 深链：?bp_node=123 直接打开该节点的检查器（便于从列表跳过来定位）
  const deepNode = Number(new URLSearchParams(location.search).get('bp_node') || 0);
  if (deepNode && state.data.nodes.some(n => n.id === deepNode)) {
    setTimeout(() => { select({ kind: 'node', ref_id: deepNode }); focusNode(deepNode); }, 220);
  }
});
