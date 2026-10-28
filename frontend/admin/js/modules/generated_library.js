// ========== 图片管理 · AI 生成图（按人物串起脉络） ==========
// 解决的问题：「批量出了十几张动作表情，图去哪了？」
//   · 左栏按人物归拢（含「未归属」），点谁就看谁的图
//   · 右栏按动作分类分组，缩略图带尺寸/时间，点开是大图 + 提示词
//   · 支持搜索提示词、按来源筛选、删图（连磁盘一起删）、把历史遗留文件补登记
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
      .gl-wrap{display:grid;grid-template-columns:246px minmax(0,1fr);gap:12px;align-items:start}
      .gl-side{border:1px solid var(--border);border-radius:8px;background:var(--bg-input);overflow:hidden}
      .gl-side-head{padding:8px 10px;font-size:12.5px;color:var(--gold);font-weight:600;
        border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px}
      .gl-side-head .c{margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:400}
      .gl-chars{max-height:calc(100vh - 320px);overflow:auto}
      .gl-char{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;
        font-size:12.5px;border-left:2px solid transparent}
      .gl-char:hover{background:rgba(255,255,255,.04)}
      .gl-char.on{background:rgba(201,168,76,.14);border-left-color:var(--gold)}
      .gl-char .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gl-char .c{font-size:11px;color:var(--text-muted);flex:0 0 auto}
      .gl-char .dot{width:6px;height:6px;border-radius:50%;background:var(--gold);opacity:.7;flex:0 0 auto}
      .gl-main{border:1px solid var(--border);border-radius:8px;background:var(--bg-input);padding:10px}
      .gl-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
      .gl-bar .inp{background:var(--bg-card,#1a1a1a);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:12.5px;height:30px;padding:0 8px}
      .gl-bar select.inp{min-width:120px}
      .gl-bar .hint{font-size:11.5px;color:var(--text-muted);margin-left:auto}
      .gl-sec{font-size:12px;color:var(--gold);font-weight:600;margin:10px 0 6px;
        border-bottom:1px dashed var(--border);padding-bottom:4px}
      .gl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(136px,1fr));gap:9px}
      .gl-card{border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-card,#17171b);
        position:relative}
      .gl-card img{width:100%;display:block;aspect-ratio:2/3;object-fit:contain;
        background:repeating-conic-gradient(#232327 0% 25%, #1a1a1e 0% 50%) 50%/14px 14px;cursor:zoom-in}
      .gl-card .m{padding:5px 7px;font-size:12.5px;color:var(--text-primary);display:flex;gap:7px;align-items:center}
      .gl-card .m .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .gl-card .m .px{font-size:11.5px;color:var(--gold);opacity:.9;flex:0 0 auto;font-variant-numeric:tabular-nums}
      .gl-card .x{position:absolute;right:4px;top:4px;width:18px;height:18px;border-radius:50%;
        background:rgba(0,0,0,.6);color:#ddd;font-size:11px;display:none;align-items:center;
        justify-content:center;cursor:pointer}
      .gl-card:hover .x{display:flex}
      .gl-card .x:hover{background:var(--red);color:#fff}
      .gl-empty{font-size:12.5px;color:var(--text-muted);padding:26px;text-align:center;
        border:1px dashed var(--border);border-radius:6px}
    `;
    document.head.appendChild(st);
  }

  async function mount(host) {
    ensureStyle();
    let summary = { total: 0, characters: [], unattached: 0, by_source: {} };
    let items = [];
    let current = { type: 'all', id: null };   // all / char / unattached
    let kw = '';
    let src = '';

    host.innerHTML = `
      <div class="gl-wrap">
        <div class="gl-side">
          <div class="gl-side-head">按人物浏览 <span class="c" id="gl-total"></span></div>
          <div class="gl-chars" id="gl-chars"></div>
        </div>
        <div class="gl-main">
          <div class="gl-bar">
            <input class="inp" id="gl-q" placeholder="搜提示词 / 动作 / 文件名…" style="width:240px">
            <select class="inp" id="gl-src">
              <option value="">全部来源</option>
              <option value="pose_batch">动作表情</option>
              <option value="appearance_render">立绘</option>
              <option value="imported">磁盘导入</option>
              <option value="manual">手动生成</option>
            </select>
            <button class="btn btn-outline btn-sm" id="gl-scan" title="把 generated 目录里没登记的图补进来">同步磁盘</button>
            <span class="hint" id="gl-hint"></span>
          </div>
          <div id="gl-body"></div>
        </div>
      </div>
    `;
    const $ = (id) => host.querySelector('#' + id);

    async function loadSummary() {
      summary = await Admin.get('/generated-images/summary');
      $('gl-total').textContent = `${summary.total} 张`;
      renderChars();
    }

    function renderChars() {
      const rows = [
        `<div class="gl-char${current.type === 'all' ? ' on' : ''}" data-type="all">
           <span class="dot"></span><span class="n">全部生成图</span>
           <span class="c">${summary.total}</span></div>`,
      ];
      (summary.characters || []).forEach((c) => {
        rows.push(`<div class="gl-char${current.type === 'char' && current.id === c.character_id ? ' on' : ''}"
          data-type="char" data-id="${c.character_id}">
          <span class="n" title="${esc(c.name)}">${esc(c.name || '未命名')}</span>
          <span class="c">${c.count}</span></div>`);
      });
      if (summary.unattached) {
        rows.push(`<div class="gl-char${current.type === 'unattached' ? ' on' : ''}" data-type="unattached">
          <span class="n" style="color:var(--text-muted)">未归属人物</span>
          <span class="c">${summary.unattached}</span></div>`);
      }
      $('gl-chars').innerHTML = rows.join('');
      host.querySelectorAll('.gl-char').forEach((el) => {
        el.addEventListener('click', () => {
          current = { type: el.dataset.type, id: Number(el.dataset.id) || null };
          renderChars();
          loadItems();
        });
      });
    }

    async function loadItems() {
      const body = $('gl-body');
      body.innerHTML = '<div class="gl-empty">加载中…</div>';
      const qs = new URLSearchParams();
      if (current.type === 'char') qs.set('character_id', current.id);
      if (current.type === 'unattached') qs.set('only_unattached', 'true');
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
          去「人物管理 → 动作表情」批量生成，或者在拼装页点「按当前外观出图」。</div>`;
        return;
      }
      // 按动作分类分组（未分类归到「其他」）
      const groups = new Map();
      items.forEach((it) => {
        const key = it.category || '其他';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      });
      const order = ['idle', 'battle', 'magic', 'daily', 'sport', 'emotion', 'funny', 'love', 'adult', '其他'];
      const keys = [...groups.keys()].sort((a, b) => {
        const ia = order.indexOf(a); const ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      body.innerHTML = keys.map((k) => `
        <div class="gl-sec">${esc(catName(k))} <span style="color:var(--text-muted);font-weight:400">${groups.get(k).length} 张</span></div>
        <div class="gl-grid">${groups.get(k).map((it) => card(it)).join('')}</div>
      `).join('');
      bindCards();
    }

    function catName(id) {
      const map = { idle: '待机', battle: '战斗', magic: '施法', daily: '日常', sport: '运动',
        emotion: '情绪特写', funny: '搞笑', love: '恋爱互动', adult: '成人互动', '其他': '其他' };
      return map[id] || id;
    }

    function card(it) {
      return `<div class="gl-card" data-id="${it.id}">
        <img src="${esc(it.url)}" loading="lazy" alt="">
        <span class="x" data-del="${it.id}" title="删除这张图">✕</span>
        <div class="m"><span class="nm" title="${esc(it.pose_name || SRC_LABEL[it.source] || '')}">
          ${esc(it.pose_name || SRC_LABEL[it.source] || '生成图')}</span>
          <span class="px">${it.width ? it.width + '×' + it.height : ''}</span></div>
      </div>`;
    }

    function previewList() {
      return items.map((it) => ({
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
      }));
    }

    function bindCards() {
      host.querySelectorAll('.gl-card').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target.dataset.del) return;
          const i = items.findIndex((x) => String(x.id) === el.dataset.id);
          if (window.ImagePreview) ImagePreview.open(previewList(), i < 0 ? 0 : i);
        });
      });
      host.querySelectorAll('[data-del]').forEach((el) => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!await Admin.confirm('删除这张图？（记录和磁盘文件都会删掉）')) return;
          try {
            await Admin.del(`/generated-images/${el.dataset.del}?remove_file=true`);
            Admin.toast('已删除', 'success');
            await loadSummary();
            await loadItems();
          } catch (err) { Admin.toast('删除失败：' + err.message, 'error'); }
        });
      });
    }

    // ---- 交互 ----
    let timer = null;
    $('gl-q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { kw = $('gl-q').value.trim(); loadItems(); }, 250);
    });
    $('gl-src').addEventListener('change', () => { src = $('gl-src').value; loadItems(); });
    $('gl-scan').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await Admin.post('/generated-images/scan', {});
        Admin.toast(r.added ? `补登记 ${r.added} 张` : '没有发现新文件', 'success');
        await loadSummary();
        await loadItems();
      } catch (err) {
        Admin.toast('同步失败：' + err.message, 'error');
      } finally { btn.disabled = false; }
    });

    await loadSummary();
    await loadItems();

    return { reload: async () => { await loadSummary(); await loadItems(); } };
  }

  window.GeneratedLibrary = { mount };
})();
