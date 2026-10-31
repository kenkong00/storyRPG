// ========== 全局素材选择器（全站唯一的「选图片」入口） ==========
//
// 两件事，一个文件：
//   1) AssetPicker.slot(容器, 选项)  —— 图片槽位控件（相框，不显示路径）
//   2) AssetPicker.open(选项)        —— 选择器弹窗（AI 生成图 + 本地上传图，一处挑完）
//
// 为什么要有它：以前每个模块各写一套「选择图片 / 上传 / 清除」，样式各异，
// 而且只能看到 /upload 目录，AI 出的图根本选不到。现在统一走 /api/assets。
//
// 用法：
//   AssetPicker.slot(el, { value: url, shape:'portrait', onChange(u){...} })
//   const asset = await AssetPicker.open({ kind:'portrait' })       // 单选
//   const list  = await AssetPicker.open({ multiple:true })         // 多选

window.AssetPicker = (function () {
  const KIND_ORDER = ['portrait', 'pose', 'scene', 'illustration', 'comic', 'item', 'monster', 'ui', 'icon', 'other'];
  const KIND_LABEL = {
    portrait: '人物立绘', pose: '人物动作', scene: '场景', illustration: '人物场景合成',
    comic: '漫画', item: '物品',
    monster: '怪物', ui: '界面', icon: '图标', other: '其他',
  };
  const KIND_ICON = {
    portrait: '👤', pose: '🎭', scene: '🏞', illustration: '🎨', comic: '📖', item: '🎒',
    monster: '👹', ui: '🖼', icon: '✦', other: '📄',
  };
  // 上传时落到哪个目录（沿用后台已有的分类目录）
  const KIND_UPLOAD_CAT = {
    portrait: 'characters/portrait', pose: 'characters/action', scene: 'scenes',
    illustration: 'scenes', item: 'items', monster: 'monsters', ui: 'ui', icon: 'icons', other: '',
  };

  const cache = new Map();          // url -> asset
  let styleDone = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function shortName(a) {
    const f = (a && a.filename) || '';
    if (!f) return '';
    const base = f.replace(/\.[a-z0-9]+$/i, '');
    // 纯 hash 名（32 位以上无分隔）没有可读性，宁可不显示
    if (/^[a-f0-9]{16,}$/i.test(base)) return '';
    return base.length > 26 ? base.slice(0, 24) + '…' : base;
  }
  function px(a) {
    return (a && a.width && a.height) ? `${a.width} × ${a.height}` : '';
  }

  function ensureStyle() {
    if (styleDone) return;
    styleDone = true;
    const css = `
/* ---------- 图片槽位（相框） ---------- */
.islot { display:flex; flex-direction:column; gap:5px; width:100%; max-width:220px; min-width:0; }
.islot-box {
  position:relative; width:100%; border-radius:8px; overflow:hidden;
  border:1px dashed var(--border); background:var(--bg-input);
  cursor:pointer; transition:border-color .16s, box-shadow .16s;
}
.islot-box[data-shape="portrait"] { aspect-ratio:2/3; }
.islot-box[data-shape="square"]   { aspect-ratio:1/1; }
.islot-box[data-shape="wide"]     { aspect-ratio:16/9; }
.islot-box[data-shape="auto"]     { aspect-ratio:4/3; }
.islot-box:hover { border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,168,76,.10); }
.islot-box.has-img { border-style:solid; }
.islot-box img {
  width:100%; height:100%; object-fit:cover; display:block;
  background:repeating-conic-gradient(#2a2c36 0% 25%, #23252d 0% 50%) 50%/16px 16px;
}
.islot-empty {
  position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:4px;
  color:var(--text-muted); font-size:11.5px; user-select:none;
}
.islot-empty .plus { font-size:19px; line-height:1; opacity:.85; }
.islot-mask {
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  gap:6px; background:linear-gradient(180deg, rgba(12,13,17,.10), rgba(12,13,17,.72));
  opacity:0; transition:opacity .16s;
}
.islot-box:hover .islot-mask { opacity:1; }
.islot-mask button {
  height:24px; padding:0 9px; border-radius:5px; cursor:pointer;
  border:1px solid rgba(255,255,255,.28); background:rgba(20,21,26,.82);
  color:#e9e6db; font-size:11.5px; line-height:1;
}
.islot-mask button:hover { border-color:var(--gold); color:var(--gold); }
.islot-tag {
  position:absolute; left:5px; top:5px; z-index:2;
  padding:1px 5px; border-radius:3px; font-size:10px; line-height:15px;
  background:rgba(12,13,17,.72); color:var(--gold);
  border:1px solid rgba(201,168,76,.35); backdrop-filter:blur(3px);
}
.islot-info {
  display:flex; align-items:center; gap:6px; min-width:0;
  font-size:11px; color:var(--text-muted); line-height:1.4;
}
.islot-info .dim { color:var(--gold); font-variant-numeric:tabular-nums; }
.islot-info .nm { flex:1 1 auto; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.islot-info .x {
  flex:0 0 auto; width:17px; height:17px; padding:0; line-height:15px;
  border:1px solid var(--border); border-radius:4px; background:transparent;
  color:var(--text-muted); font-size:11px; cursor:pointer;
}
.islot-info .x:hover { color:#fff; background:var(--red); border-color:var(--red); }
.islot.broken .islot-box { border-color:var(--red); }

/* ---------- 选择器弹窗 ---------- */
.apes-overlay {
  position:fixed; inset:0; z-index:10600; background:rgba(6,7,10,.72);
  display:flex; align-items:center; justify-content:center; padding:24px;
  animation:apes-in .14s ease;
}
@keyframes apes-in { from { opacity:0 } to { opacity:1 } }
.apes-dlg {
  width:min(1180px, 96vw); height:min(780px, 92vh);
  display:flex; flex-direction:column; overflow:hidden;
  background:var(--bg-card); border:1px solid var(--border);
  border-radius:14px; box-shadow:0 24px 70px rgba(0,0,0,.62);
}
.apes-head {
  display:flex; align-items:center; gap:10px;
  padding:14px 18px; border-bottom:1px solid var(--border);
}
.apes-head h3 { margin:0; font-size:15px; font-weight:700; color:var(--text-primary); }
.apes-head .sub { font-size:11.5px; color:var(--text-muted); }
.apes-head .x {
  margin-left:auto; width:28px; height:28px; border-radius:6px; cursor:pointer;
  border:1px solid var(--border); background:transparent;
  color:var(--text-secondary); font-size:16px; line-height:1;
}
.apes-head .x:hover { color:var(--text-primary); border-color:var(--gold); }

.apes-main { flex:1 1 auto; display:flex; min-height:0; }

.apes-rail {
  flex:0 0 186px; overflow:auto; padding:12px 10px;
  border-right:1px solid var(--border); background:rgba(255,255,255,.012);
}
.apes-rail::-webkit-scrollbar { width:8px; }
.apes-rail::-webkit-scrollbar-thumb { background:#3a3d4c; border-radius:4px; }
.apes-grp { margin-bottom:14px; }
.apes-grp .gt {
  font-size:10.5px; letter-spacing:.06em; color:var(--text-muted);
  text-transform:uppercase; padding:0 6px 6px;
}
.apes-facet {
  display:flex; align-items:center; gap:7px; width:100%;
  height:29px; padding:0 8px; margin-bottom:2px; cursor:pointer;
  border:1px solid transparent; border-radius:6px; background:transparent;
  color:var(--text-secondary); font-size:12.5px; text-align:left;
}
.apes-facet:hover { background:var(--bg-hover); color:var(--text-primary); }
.apes-facet.on {
  background:rgba(201,168,76,.13); border-color:rgba(201,168,76,.38); color:var(--gold);
}
.apes-facet .ico { flex:0 0 14px; text-align:center; opacity:.9; font-size:12px; }
.apes-facet .lb { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.apes-facet .n { flex:0 0 auto; font-size:11px; color:var(--text-muted); font-variant-numeric:tabular-nums; }
.apes-facet.on .n { color:var(--gold); }

.apes-right { flex:1 1 auto; display:flex; flex-direction:column; min-width:0; }
.apes-toolbar {
  display:flex; align-items:center; gap:8px; padding:11px 16px;
  border-bottom:1px solid var(--border);
}
.apes-search {
  flex:1 1 auto; min-width:0; height:31px; padding:0 10px;
  border:1px solid var(--border); border-radius:6px;
  background:var(--bg-input); color:var(--text-primary); font-size:12.5px;
}
.apes-search:focus { outline:none; border-color:var(--gold); }
.apes-mini {
  flex:0 0 auto; height:31px; padding:0 10px; cursor:pointer;
  border:1px solid var(--border); border-radius:6px;
  background:var(--bg-input); color:var(--text-secondary); font-size:12px;
}
.apes-mini:hover { color:var(--gold); border-color:var(--gold); }

.apes-body { flex:1 1 auto; overflow:auto; padding:14px 16px; }
.apes-body::-webkit-scrollbar { width:10px; }
.apes-body::-webkit-scrollbar-thumb { background:#3a3d4c; border-radius:5px; }

.apes-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(138px, 1fr)); gap:11px; }
.apes-card {
  position:relative; padding:0; cursor:pointer; overflow:hidden;
  border:2px solid var(--border); border-radius:9px; background:var(--bg-input);
  transition:border-color .14s, transform .14s;
}
.apes-card:hover { border-color:#4a4e60; transform:translateY(-1px); }
.apes-card.on { border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,168,76,.16); }
.apes-thumb {
  display:block; width:100%; aspect-ratio:4/3; overflow:hidden;
  background:repeating-conic-gradient(#2a2c36 0% 25%, #23252d 0% 50%) 50%/14px 14px;
}
.apes-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.apes-cap {
  display:flex; align-items:center; gap:5px; padding:4px 6px;
  font-size:11px; color:var(--text-secondary); background:var(--bg-card);
}
.apes-cap .t { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.apes-cap .d { flex:0 0 auto; font-size:10px; color:var(--text-muted); font-variant-numeric:tabular-nums; }
.apes-badge {
  position:absolute; left:5px; top:5px; padding:0 5px; border-radius:3px;
  font-size:9.5px; line-height:15px; letter-spacing:.02em;
  background:rgba(10,11,15,.78); color:#cfd3e0; border:1px solid rgba(255,255,255,.16);
}
.apes-badge.ai { color:var(--gold); border-color:rgba(201,168,76,.45); }
.apes-check {
  position:absolute; right:5px; top:5px; width:19px; height:19px;
  border-radius:50%; background:var(--gold); color:#16171b;
  font-size:12px; font-weight:700; line-height:19px; text-align:center;
  display:none;
}
.apes-card.on .apes-check { display:block; }
.apes-zoom {
  position:absolute; inset:0; display:flex; align-items:flex-end; justify-content:center;
  padding-bottom:26px; font-size:10.5px; color:#eae7dc;
  background:linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,.62));
  opacity:0; transition:opacity .14s; pointer-events:none;
}
.apes-card:hover .apes-zoom { opacity:1; }

.apes-empty { padding:60px 20px; text-align:center; color:var(--text-muted); font-size:12.5px; line-height:1.9; }
.apes-empty b { color:var(--gold); }

.apes-foot {
  display:flex; align-items:center; gap:10px;
  padding:11px 18px; border-top:1px solid var(--border);
}
.apes-info { flex:1 1 auto; min-width:0; font-size:11.5px; color:var(--text-muted); }
.apes-info b { color:var(--gold); font-weight:600; }
.apes-btn {
  height:32px; padding:0 14px; border-radius:6px; cursor:pointer; font-size:12.5px;
  border:1px solid var(--border); background:var(--bg-input); color:var(--text-secondary);
}
.apes-btn:hover { color:var(--text-primary); border-color:#4a4e60; }
.apes-btn.primary {
  border-color:var(--gold); background:var(--gold); color:#17181c; font-weight:600;
}
.apes-btn.primary:disabled { opacity:.4; cursor:not-allowed; }
.apes-btn.ghost { border-style:dashed; }
`;
    const el = document.createElement('style');
    el.id = 'asset-picker-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ---------- 取数据 ----------
  async function fetchAsset(url) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url);
    try {
      const r = await Admin.get(`/assets?url=${encodeURIComponent(url)}&status=all&limit=1`);
      const a = (r.items || [])[0] || null;
      if (a) cache.set(url, a);
      return a;
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  //  槽位控件
  // ============================================================
  function slot(container, opts = {}) {
    ensureStyle();
    if (!container) return null;
    const o = {
      value: opts.value || '',
      shape: opts.shape || 'auto',
      kind: opts.kind || '',
      subjectType: opts.subjectType || '',
      subjectId: opts.subjectId || null,
      label: opts.label || '',
      readonly: !!opts.readonly,
      allowUpload: opts.allowUpload !== false,
      onChange: opts.onChange || null,
    };

    container.innerHTML = `
      <div class="islot">
        <div class="islot-box" data-shape="${esc(o.shape)}"></div>
        <div class="islot-info"></div>
      </div>`;
    const box = container.querySelector('.islot-box');
    const info = container.querySelector('.islot-info');
    let asset = null;

    function paint() {
      const url = o.value;
      box.classList.toggle('has-img', !!url);
      container.querySelector('.islot').classList.remove('broken');

      if (!url) {
        box.innerHTML = `<div class="islot-empty"><span class="plus">＋</span><span>选择图片</span></div>`;
        info.innerHTML = '<span class="nm">未设置</span>';
        return;
      }
      box.innerHTML = `
        <img src="${esc(url)}" alt="">
        <div class="islot-tag" hidden></div>
        <div class="islot-mask">
          <button type="button" data-act="pick">更换</button>
          <button type="button" data-act="preview">预览</button>
        </div>`;
      box.querySelector('img').addEventListener('error', () => {
        container.querySelector('.islot').classList.add('broken');
        info.innerHTML = '<span class="nm" style="color:var(--red)">图片已失效</span>' +
          '<button class="x" data-act="clear" title="移除">×</button>';
        bindInfoActs();
      });
      info.innerHTML = `<span class="dim"></span><span class="nm"></span>` +
        `<button class="x" data-act="clear" title="移除">×</button>`;
      bindInfoActs();

      // 补一下尺寸 / 来源角标（查不到就静默）
      fetchAsset(url).then((a) => {
        if (!a || o.value !== url) return;
        asset = a;
        const dim = info.querySelector('.dim');
        if (dim && px(a)) dim.textContent = px(a);
        const nm = info.querySelector('.nm');
        if (nm) nm.textContent = a.subject_name || a.variant_name || a.name || shortName(a) || KIND_LABEL[a.kind] || '';
        const tag = box.querySelector('.islot-tag');
        if (tag && a.origin === 'ai') { tag.hidden = false; tag.textContent = 'AI'; }
      });
    }

    function bindInfoActs() {
      info.querySelectorAll('[data-act="clear"]').forEach((b) => {
        b.addEventListener('click', (e) => { e.stopPropagation(); set(''); });
      });
    }

    function set(url, silent) {
      o.value = url || '';
      paint();
      if (!silent && typeof o.onChange === 'function') o.onChange(o.value, asset);
    }

    box.addEventListener('click', async (e) => {
      if (o.readonly) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'preview') {
        e.stopPropagation();
        preview(o.value);
        return;
      }
      if (act === 'clear') return;
      const picked = await open({
        kind: o.kind, currentUrl: o.value, allowUpload: o.allowUpload,
        subjectType: o.subjectType, subjectId: o.subjectId, slotLabel: o.label,
      });
      if (picked && picked.url) set(picked.url);
    });

    paint();
    return {
      set: (u) => set(u),
      get: () => o.value,
      asset: () => asset,
      refresh: paint,
    };
  }

  function preview(url) {
    if (!url) return;
    const a = cache.get(url);
    if (window.ImagePreview) {
      ImagePreview.open([{
        url,
        width: a && a.width, height: a && a.height,
        prompt: a && a.prompt,
        meta: a ? {
          类型: KIND_LABEL[a.kind] || '素材',
          来源: a.origin_label || '',
          主体: a.subject_name || '',
          大小: a.bytes ? (a.bytes / 1024).toFixed(0) + ' KB' : '',
        } : {},
      }], 0);
    } else {
      window.open(url, '_blank');
    }
  }

  // ============================================================
  //  选择器弹窗
  // ============================================================
  function open(opts = {}) {
    ensureStyle();
    const o = {
      multiple: !!opts.multiple,
      kind: opts.kind || 'all',
      currentUrl: opts.currentUrl || '',
      allowUpload: opts.allowUpload !== false,
      subjectType: opts.subjectType || '',
      subjectId: opts.subjectId || null,
      slotLabel: opts.slotLabel || '',
      title: opts.title || '选择素材',
    };

    return new Promise((resolve) => {
      const S = {
        kind: o.kind || 'all',
        origin: 'all',
        q: '',
        items: [],
        total: 0,
        selected: new Map(),   // id -> asset
        facets: { kinds: [], origins: [], total: 0 },
      };

      const overlay = document.createElement('div');
      overlay.className = 'apes-overlay';
      overlay.innerHTML = `
        <div class="apes-dlg">
          <div class="apes-head">
            <h3>${esc(o.title)}</h3>
            <span class="sub">${o.slotLabel ? '为「' + esc(o.slotLabel) + '」挑选' : 'AI 生成图与上传图都在这里'}</span>
            <button class="x" type="button" title="关闭 (Esc)">×</button>
          </div>
          <div class="apes-main">
            <aside class="apes-rail"></aside>
            <section class="apes-right">
              <div class="apes-toolbar">
                <input class="apes-search" type="text" placeholder="搜名称 / 动作 / 提示词 / 文件名…">
                <button class="apes-mini" data-act="sync" title="扫描磁盘上还没入库的图片">同步磁盘</button>
                <button class="apes-mini" data-act="reload" title="重新加载">刷新</button>
              </div>
              <div class="apes-body"></div>
            </section>
          </div>
          <div class="apes-foot">
            <div class="apes-info"></div>
            ${o.allowUpload ? '<button class="apes-btn ghost" data-act="upload">＋ 上传本地图片</button>' : ''}
            <button class="apes-btn" data-act="cancel">取消</button>
            <button class="apes-btn primary" data-act="ok" ${o.multiple ? '' : 'disabled'}>
              ${o.multiple ? '添加所选' : '使用这张'}
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const railEl = overlay.querySelector('.apes-rail');
      const bodyEl = overlay.querySelector('.apes-body');
      const infoEl = overlay.querySelector('.apes-info');
      const searchEl = overlay.querySelector('.apes-search');
      const okBtn = overlay.querySelector('[data-act="ok"]');

      function close(result) {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(result === undefined ? null : result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      }
      document.addEventListener('keydown', onKey);
      overlay.querySelector('.apes-head .x').addEventListener('click', () => close(null));
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });

      // ---- 左栏 ----
      function paintRail() {
        const kd = S.facets.kinds || [];
        const od = S.facets.origins || [];
        let html = `<div class="apes-grp"><div class="gt">素材类型</div>
          <button class="apes-facet ${S.kind === 'all' ? 'on' : ''}" data-f="kind" data-v="all">
            <span class="ico">▦</span><span class="lb">全部素材</span><span class="n">${S.facets.total || 0}</span>
          </button>`;
        kd.forEach((k) => {
          html += `<button class="apes-facet ${S.kind === k.key ? 'on' : ''}" data-f="kind" data-v="${esc(k.key)}">
            <span class="ico">${KIND_ICON[k.key] || '·'}</span><span class="lb">${esc(k.label)}</span>
            <span class="n">${k.count}</span></button>`;
        });
        html += '</div><div class="apes-grp"><div class="gt">来源</div>';
        const originSum = od.reduce((n, x) => n + (x.count || 0), 0);
        [['all', '全部来源', '◍', originSum]].concat(
          od.map((x) => [x.key, x.label, x.key === 'ai' ? '✦' : '↑', x.count])
        ).forEach(([key, label, icon, n]) => {
          html += `<button class="apes-facet ${S.origin === key ? 'on' : ''}" data-f="origin" data-v="${esc(key)}">
            <span class="ico">${icon}</span><span class="lb">${esc(label)}</span>
            <span class="n">${n}</span></button>`;
        });
        html += '</div>';
        railEl.innerHTML = html;
        railEl.querySelectorAll('.apes-facet').forEach((b) => {
          b.addEventListener('click', () => {
            if (b.dataset.f === 'kind') S.kind = b.dataset.v;
            else S.origin = b.dataset.v;
            load();
          });
        });
      }

      // ---- 网格 ----
      function isOn(a) {
        return o.multiple ? S.selected.has(a.id) : a.url === S.currentUrl;
      }

      function paintBody() {
        if (!S.items.length) {
          bodyEl.innerHTML = `<div class="apes-empty">
            这里还没有图片。<br>
            点左下角 <b>＋ 上传本地图片</b>，或先在「动作表情 / 外观拼装」里让 AI 出一张 ——
            出完会立刻出现在这里。</div>`;
          return;
        }
        let html = '<div class="apes-grid">';
        S.items.forEach((a) => {
          const on = isOn(a);
          const cap = a.subject_name || a.variant_name || a.name || shortName(a) || KIND_LABEL[a.kind] || '素材';
          html += `<button class="apes-card ${on ? 'on' : ''}" data-id="${a.id}" data-url="${esc(a.url)}" title="${esc(cap)}">
            <span class="apes-thumb">
              <img loading="lazy" src="${esc(a.url)}" alt="">
              <span class="apes-badge ${a.origin === 'ai' ? 'ai' : ''}">${a.origin === 'ai' ? 'AI' : '上传'}</span>
              <span class="apes-check">✓</span>
              <span class="apes-zoom">${px(a) || ' '}</span>
            </span>
            <span class="apes-cap"><span class="t">${esc(cap)}</span><span class="d">${px(a)}</span></span>
          </button>`;
        });
        html += '</div>';
        bodyEl.innerHTML = html;

        bodyEl.querySelectorAll('.apes-card').forEach((card) => {
          const a = S.items.find((x) => String(x.id) === card.dataset.id);
          if (!a) return;
          card.addEventListener('click', () => {
            if (o.multiple) {
              if (S.selected.has(a.id)) S.selected.delete(a.id);
              else S.selected.set(a.id, a);
              paintBody();
              paintInfo();
            } else {
              S.currentUrl = a.url;
              paintBody();
              paintInfo();
            }
          });
          card.addEventListener('dblclick', () => confirm());
        });
      }

      function paintInfo() {
        if (o.multiple) {
          const n = S.selected.size;
          infoEl.innerHTML = `共 <b>${S.total}</b> 张 · 已选 <b>${n}</b> 张`;
          okBtn.disabled = n === 0;
          okBtn.textContent = `添加所选${n ? '(' + n + ')' : ''}`;
        } else {
          const cur = S.items.find((x) => x.url === S.currentUrl);
          infoEl.innerHTML = `共 <b>${S.total}</b> 张` +
            (cur ? ` · 当前：<b>${esc(cur.subject_name || cur.variant_name || cur.name || shortName(cur) || '素材')}</b>` +
              (px(cur) ? ' ' + px(cur) : '') : '');
          okBtn.disabled = !S.currentUrl;
        }
      }

      async function load() {
        bodyEl.innerHTML = '<div class="apes-empty">加载中…</div>';
        const params = new URLSearchParams();
        if (S.kind && S.kind !== 'all') params.set('kind', S.kind);
        if (S.origin && S.origin !== 'all') params.set('origin', S.origin);
        if (S.q) params.set('q', S.q);
        if (o.subjectType) params.set('subject_type', o.subjectType);
        if (o.subjectId) params.set('subject_id', o.subjectId);
        params.set('status', 'usable');
        params.set('limit', '400');

        try {
          const [list, facets] = await Promise.all([
            Admin.get(`/assets?${params.toString()}`),
            Admin.get(`/assets/facets?${params.toString()}`),
          ]);
          S.items = list.items || [];
          S.total = list.total || 0;
          S.facets = facets || { kinds: [], origins: [], total: 0 };
        } catch (e) {
          bodyEl.innerHTML = `<div class="apes-empty" style="color:var(--red)">加载失败：${esc(e.message || e)}</div>`;
          return;
        }
        paintRail();
        paintBody();
        paintInfo();
      }

      function confirm() {
        if (o.multiple) {
          const arr = Array.from(S.selected.values());
          if (!arr.length) return;
          close(arr);
        } else {
          const a = S.items.find((x) => x.url === S.currentUrl);
          if (!a) return;
          close(a);
        }
      }

      okBtn.addEventListener('click', confirm);
      searchEl.addEventListener('input', () => {
        clearTimeout(S._t);
        S._t = setTimeout(() => { S.q = searchEl.value.trim(); load(); }, 260);
      });
      overlay.querySelector('[data-act="reload"]').addEventListener('click', load);
      overlay.querySelector('[data-act="sync"]').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.textContent = '扫描中…';
        try {
          const r = await Admin.post('/assets/sync', {});
          Admin.toast(`新增 ${r.added || 0} 张（扫到 ${r.scanned || 0} 个文件）`, 'success');
          await load();
        } catch (err) {
          Admin.toast('扫描失败：' + (err.message || err), 'error');
        } finally {
          b.disabled = false; b.textContent = '同步磁盘';
        }
      });

      if (o.allowUpload) {
        overlay.querySelector('[data-act="upload"]').addEventListener('click', () => uploadInto());
      }

      function uploadInto() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = o.multiple;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', async () => {
          const files = Array.from(input.files || []);
          input.remove();
          if (!files.length) return;
          const cat = KIND_UPLOAD_CAT[o.kind] || '';
          let last = null;
          for (const f of files) {
            const fd = new FormData();
            fd.append('file', f);
            fd.append('category', cat);
            try {
              const r = await fetch('/api/upload/image', { method: 'POST', body: fd }).then((x) => x.json());
              if (r && r.url) {
                last = r.url;
                if (o.multiple) S.selected.set(r.url, { id: r.url, url: r.url, filename: r.filename, origin: 'upload', kind: o.kind, width: null, height: null });
              }
            } catch (e) {
              Admin.toast('上传失败：' + (e.message || e), 'error');
            }
          }
          if (last) {
            if (!o.multiple) S.currentUrl = last;
            Admin.toast('已上传', 'success');
          }
          await load();
          if (!o.multiple && last) {
            // 刷新后当前 url 可能不在第一页，直接确认更符合直觉
            setTimeout(() => {
              const hit = S.items.find((x) => x.url === last);
              if (hit) { S.currentUrl = hit.url; paintBody(); paintInfo(); }
            }, 120);
          }
        });
        input.click();
      }

      load();
      setTimeout(() => searchEl.focus(), 60);
    });
  }

  // ============================================================
  //  素材管理页用的小工具
  // ============================================================
  async function usageOf(url) {
    const a = cache.get(url);
    if (!a) return [];
    try {
      const r = await Admin.get(`/assets/${a.id}/usages`);
      return r.usages || [];
    } catch (e) {
      return [];
    }
  }

  return {
    open,
    slot,
    preview,
    fetchAsset,
    usageOf,
    labels: KIND_LABEL,
    icons: KIND_ICON,
    uploadCategory: KIND_UPLOAD_CAT,
  };
})();
