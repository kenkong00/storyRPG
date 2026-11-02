// ========== 图片管理 · AI 生成图（按人物 / 分类串起脉络） ==========
// 解决的问题：「批量出了十几张动作表情，图去哪了？」
//   · 左栏 = 人物管理里的分类树（可折叠 / 缩进；人物归属到分类下，二级分类也能展开）
//   · 点分类看该分类（含子分类）全部图，点人物只看该人物
//   · 右栏图统一用 ImageGrid：单击选中 / Shift 连选 / Ctrl 切换 / 双击大图 / 右键菜单
//   · 顶栏搜索区新增「全选」「批量删除」
// 数据来自 /api/generated-images（每张图都记了出处：人物 / 动作 / 提示词 / 方案 / 任务）
(function () {
  if (window.GeneratedLibrary) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const SRC_LABEL = {
    pose_batch: '动作表情', appearance_render: '立绘', manual: '手动生成',
    imported: '磁盘导入',
  };

  function ensureStyle() {
    if (document.getElementById('gl-style-tag')) return;
    const st = document.createElement('style');
    st.id = 'gl-style-tag';
    st.textContent = `
      .gl-wrap{display:grid;grid-template-columns:262px minmax(0,1fr);gap:12px;align-items:start}
      .gl-side{border:1px solid var(--border);border-radius:8px;background:var(--bg-input);overflow:hidden}
      .gl-side-head{padding:8px 10px;font-size:12.5px;color:var(--gold);font-weight:600;
        border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px}
      .gl-side-head .c{margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:400}
      .gl-tree{max-height:calc(100vh - 300px);overflow:auto;padding:4px 0}
      .gl-node{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;
        font-size:12.5px;border-left:2px solid transparent;user-select:none}
      .gl-node:hover{background:rgba(255,255,255,.05)}
      .gl-node.on{background:rgba(201,168,76,.14);border-left-color:var(--gold)}
      .gl-node .tw{width:14px;flex:0 0 auto;text-align:center;color:var(--text-muted);
        font-size:10px;transition:transform .12s}
      .gl-node.collapsed .tw{transform:rotate(-90deg)}
      .gl-node .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gl-node .c{font-size:11px;color:var(--text-muted);flex:0 0 auto}
      .gl-node.cat > .n{font-weight:600}
      .gl-node.chr > .n{font-weight:400;color:var(--text-soft,#cfcfcf)}
      .gl-node.chr::before{content:"";width:5px;height:5px;border-radius:50%;
        background:var(--gold);opacity:.6;flex:0 0 auto;margin-left:2px}
      .gl-children{/* 嵌套容器，仅靠缩进区分层级 */}
      .gl-main{border:1px solid var(--border);border-radius:8px;background:var(--bg-input);padding:10px}
      .gl-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
      .gl-bar .inp{background:var(--bg-card,#1a1a1a);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:12.5px;height:30px;padding:0 8px}
      .gl-bar select.inp{min-width:120px}
      .gl-bar .hint{font-size:11.5px;color:var(--text-muted);margin-left:auto}
      .gl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(136px,1fr));gap:9px}
      .gl-card{border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-card,#17171b);
        position:relative}
      .gl-card img{width:100%;display:block;aspect-ratio:2/3;object-fit:contain;
        background:repeating-conic-gradient(#232327 0% 25%, #1a1a1e 0% 50%) 50%/14px 14px;cursor:zoom-in}
      .gl-card .m{padding:5px 7px;font-size:12.5px;color:var(--text-primary);display:flex;gap:7px;align-items:center}
      .gl-card .m .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gl-card .m .px{font-size:11.5px;color:var(--gold);opacity:.9;flex:0 0 auto;font-variant-numeric:tabular-nums}
      .gl-empty{font-size:12.5px;color:var(--text-muted);padding:26px;text-align:center;
        border:1px dashed var(--border);border-radius:6px;grid-column:1/-1}
    `;
    document.head.appendChild(st);
  }

  function catName(id) {
    const map = { idle: '待机', battle: '战斗', magic: '施法', daily: '日常', sport: '运动',
      emotion: '情绪特写', funny: '搞笑', love: '恋爱互动', adult: '成人互动', '其他': '其他' };
    return map[id] || id;
  }

  async function mount(host) {
    ensureStyle();
    let tree = { tree: [], flat: [] };
    let charList = [];                       // 全部人物：{id,name,category_path}
    let summary = { total: 0, characters: [], unattached: 0, by_source: {} };
    let items = [];
    let current = { type: 'all', id: null, path: null };
    let kw = '';
    let src = '';
    const collapsed = new Set();             // 已折叠的分类路径
    let gridApi = null;

    host.innerHTML = `
      <div class="gl-wrap">
        <div class="gl-side">
          <div class="gl-side-head">按分类 / 人物浏览 <span class="c" id="gl-total"></span></div>
          <div class="gl-tree" id="gl-tree"></div>
        </div>
        <div class="gl-main">
          <div class="gl-bar">
            <input class="inp" id="gl-q" placeholder="搜提示词 / 动作 / 文件名…" style="width:230px">
            <select class="inp" id="gl-src">
              <option value="">全部来源</option>
              <option value="pose_batch">动作表情</option>
              <option value="appearance_render">立绘</option>
              <option value="imported">磁盘导入</option>
              <option value="manual">手动生成</option>
            </select>
            <button class="btn btn-outline btn-sm" id="gl-all">全选</button>
            <button class="btn btn-danger btn-sm" id="gl-batch-del">批量删除</button>
            <button class="btn btn-outline btn-sm" id="gl-scan" title="把 generated 目录里没登记的图补进来">同步磁盘</button>
            <span class="hint" id="gl-hint"></span>
          </div>
          <div class="gl-grid" id="gl-grid"></div>
        </div>
      </div>
    `;
    const $ = (id) => host.querySelector('#' + id);

    // ---------- 左侧分类树 ----------
    function countMap() {
      const m = {};
      (summary.characters || []).forEach((c) => { m[c.character_id] = c.count; });
      return m;
    }
    function catCount(node, cmap) {
      let n = (charList || []).filter((c) => c.category_path === node.path)
        .reduce((s, c) => s + (cmap[c.id] || 0), 0);
      (node.children || []).forEach((ch) => { n += catCount(ch, cmap); });
      return n;
    }
    function renderNode(node, depth, cmap) {
      const pad = 8 + depth * 18;
      const isCollapsed = collapsed.has(node.path);
      const childCats = node.children || [];
      const charsHere = (charList || []).filter((c) => c.category_path === node.path);
      const on = current.type === 'cat' && current.path === node.path;
      let html = `<div class="gl-node cat${isCollapsed ? ' collapsed' : ''}${on ? ' on' : ''}"
          data-type="cat" data-path="${esc(node.path)}" style="padding-left:${pad}px">
        <span class="tw" data-toggle>▾</span>
        <span class="n" data-pick>${esc(node.name)}</span>
        <span class="c">${catCount(node, cmap)}</span>
      </div>`;
      if (!isCollapsed) {
        html += '<div class="gl-children">';
        childCats.forEach((ch) => { html += renderNode(ch, depth + 1, cmap); });
        charsHere.forEach((c) => {
          const onC = current.type === 'char' && String(current.id) === String(c.id);
          html += `<div class="gl-node chr${onC ? ' on' : ''}" data-type="char" data-id="${c.id}"
              style="padding-left:${pad + 18}px">
            <span class="n" title="${esc(c.name)}">${esc(c.name || '未命名')}</span>
            <span class="c">${cmap[c.id] || 0}</span>
          </div>`;
        });
        html += '</div>';
      }
      return html;
    }
    function renderSidebar() {
      const cmap = countMap();
      const rows = [
        `<div class="gl-node${current.type === 'all' ? ' on' : ''}" data-type="all" style="padding-left:8px">
           <span class="tw"></span><span class="n" data-pick>全部生成图</span>
           <span class="c">${summary.total}</span></div>`,
      ];
      (tree.tree || []).forEach((node) => { rows.push(renderNode(node, 0, cmap)); });
      // 「未分类」：没有分类路径、或路径不在分类树里的人物
      const validPaths = new Set((tree.flat || []).map((n) => n.path));
      const orphans = (charList || []).filter((c) =>
        !c.category_path || !validPaths.has(c.category_path));
      if (orphans.length) {
        const onU = current.type === 'uncat';
        const isCollapsed = collapsed.has('__uncat__');
        rows.push(`<div class="gl-node cat${isCollapsed ? ' collapsed' : ''}${onU ? ' on' : ''}"
            data-type="uncat" data-path="__uncat__" style="padding-left:8px">
            <span class="tw" data-toggle>▾</span><span class="n" data-pick>未分类人物</span>
            <span class="c">${orphans.reduce((s, c) => s + (cmap[c.id] || 0), 0)}</span></div>`);
        if (!isCollapsed) {
          rows.push('<div class="gl-children">');
          orphans.forEach((c) => {
            const onC = current.type === 'char' && String(current.id) === String(c.id);
            rows.push(`<div class="gl-node chr${onC ? ' on' : ''}" data-type="char" data-id="${c.id}"
                style="padding-left:26px">
              <span class="n" title="${esc(c.name)}">${esc(c.name || '未命名')}</span>
              <span class="c">${cmap[c.id] || 0}</span></div>`);
          });
          rows.push('</div>');
        }
      }
      if (summary.unattached) {
        const onUn = current.type === 'unattached';
        rows.push(`<div class="gl-node${onUn ? ' on' : ''}" data-type="unattached" style="padding-left:8px">
            <span class="tw"></span><span class="n" data-pick style="color:var(--text-muted)">未归属人物</span>
            <span class="c">${summary.unattached}</span></div>`);
      }
      const el = $('gl-tree');
      el.innerHTML = rows.join('');
      el.querySelectorAll('.gl-node').forEach((node) => {
        node.addEventListener('click', (e) => {
          if (e.target.closest('[data-toggle]') && node.querySelector('[data-toggle]')) {
            const p = node.dataset.path;
            if (collapsed.has(p)) collapsed.delete(p); else collapsed.add(p);
            renderSidebar();
            return;
          }
          const type = node.dataset.type;
          if (type === 'all') current = { type: 'all', id: null, path: null };
          else if (type === 'unattached') current = { type: 'unattached', id: null, path: null };
          else if (type === 'uncat') current = { type: 'uncat', id: null, path: null };
          else if (type === 'cat') current = { type: 'cat', id: null, path: node.dataset.path };
          else if (type === 'char') current = { type: 'char', id: Number(node.dataset.id), path: null };
          renderSidebar();
          loadItems();
        });
      });
    }

    // ---------- 右侧图片网格（统一 ImageGrid） ----------
    async function ensureGrid() {
      if (gridApi) return;
      gridApi = window.ImageGrid.mount({
        container: $('gl-grid'),
        items: [],
        getId: (it) => String(it.id),
        renderCard: (it) => `
          <div class="gl-card" data-ig-id="${esc(it.id)}">
            <img src="${esc(it.url)}" loading="lazy" alt="">
            <div class="m"><span class="nm" title="${esc(it.pose_name || SRC_LABEL[it.source] || '')}">
              ${esc(it.pose_name || SRC_LABEL[it.source] || '生成图')}</span>
              <span class="px">${it.width ? it.width + '×' + it.height : ''}</span></div>
          </div>`,
        getPreview: (it) => ({
          url: it.url,
          title: it.pose_name || SRC_LABEL[it.source] || '生成图',
          prompt: it.prompt || '',
          width: it.width, height: it.height,
          meta: {
            '人物': it.character_name || '未归属',
            '动作': it.pose_name || '',
            '分类': catName(it.category),
            '来源': SRC_LABEL[it.source] || it.source,
            '方案': it.model_preset || '',
            '尺寸': it.width && it.height ? `${it.width}×${it.height}` : '',
            '时间': it.created_at || '',
          },
        }),
        getPreviewList: null,
        onDelete: async (ids) => {
          for (const id of ids) {
            await Admin.del(`/generated-images/${id}?remove_file=true`);
          }
          await loadSummary(); renderSidebar(); await loadItems();
        },
        onActivate: null,
        emptyText: '这里还没有图。去「人物管理 → 动作表情」批量生成，或在拼装页点「按当前外观出图」。',
      });
    }

    async function loadSummary() {
      summary = await Admin.get('/generated-images/summary');
      $('gl-total').textContent = `${summary.total} 张`;
    }

    async function loadItems() {
      const body = $('gl-grid');
      body.innerHTML = '<div class="gl-empty">加载中…</div>';
      const qs = new URLSearchParams();
      if (current.type === 'char') qs.set('character_id', current.id);
      else if (current.type === 'unattached') qs.set('only_unattached', 'true');
      else if (current.type === 'cat') qs.set('subject_category', current.path);
      else if (current.type === 'uncat') qs.set('only_uncat', 'true'); // 前端侧：无分类路径的人物（后端用 subject_category 反查，这里走 character 列表已在左栏展示）
      if (src) qs.set('source', src);
      if (kw) qs.set('q', kw);
      try {
        const r = await Admin.get('/generated-images?' + qs.toString());
        items = r.items || [];
      } catch (e) {
        body.innerHTML = `<div class="gl-empty">加载失败：${esc(e.message)}</div>`;
        return;
      }
      $('gl-hint').textContent = `共 ${items.length} 张`;
      if (!items.length) {
        body.innerHTML = `<div class="gl-empty">这里还没有图。<br>
          去「人物管理 → 动作表情」批量生成，或者在拼装页点「按当前外观出图」。
          没有符合当前筛选的图时，也可试试切换左侧分类 / 人物。</div>`;
        return;
      }
      await ensureGrid();
      gridApi.setItems(items);
    }

    // ---- 交互 ----
    let timer = null;
    $('gl-q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { kw = $('gl-q').value.trim(); loadItems(); }, 250);
    });
    $('gl-src').addEventListener('change', () => { src = $('gl-src').value; loadItems(); });
    $('gl-all').addEventListener('click', () => { if (gridApi) gridApi.selectAll(); });
    $('gl-batch-del').addEventListener('click', async () => {
      if (!gridApi) return;
      const ids = gridApi.getSelected();
      if (!ids.length) { Admin.toast('请先选择图片（单击 / Shift / Ctrl，或点「全选」）', 'info'); return; }
      if (!await Admin.confirm(`删除选中的 ${ids.length} 张图？（记录与磁盘文件都会删掉）`)) return;
      try {
        for (const id of ids) await Admin.del(`/generated-images/${id}?remove_file=true`);
        Admin.toast(`已删除 ${ids.length} 张`, 'success');
        await loadSummary(); renderSidebar(); await loadItems();
      } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
    });
    $('gl-scan').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await Admin.post('/generated-images/scan', {});
        Admin.toast(r.added ? `补登记 ${r.added} 张` : '没有发现新文件', 'success');
        await loadSummary(); renderSidebar(); await loadItems();
      } catch (err) {
        Admin.toast('同步失败：' + err.message, 'error');
      } finally { btn.disabled = false; }
    });

    // ---- 初始化 ----
    async function initialLoad() {
      const [tr, cl] = await Promise.all([
        Admin.get('/resource-categories/character/tree'),
        Admin.get('/characters'),
      ]);
      tree = tr || { tree: [], flat: [] };
      charList = cl || [];
      await loadSummary();
      renderSidebar();
      await loadItems();
    }
    await initialLoad();

    return { reload: async () => { await initialLoad(); } };
  }

  window.GeneratedLibrary = { mount };
})();
