// ========== 提示词管理（快捷提示词库）==========
// 照抄「windows轻量AI桌面助手 5.0」的提示词库：
//   * 数据：{id, name, text, folder, builtin}，内置种子（三视图/表情九宫格/老照片修复…）
//   * 检索：名称 / 分类 / 正文 全命中（空格分隔多个关键词，全部命中才算）
//   * 分组：按分类展示，分类顺序 角色 → 修图 → 合成 → 漫画（未分类排最后）
//   * 操作：新建 / 编辑 / 复制 / 删除 / 批量删除 / 恢复内置
// 界面形态沿用本项目刚定下来的「卡片列表 + 弹窗编辑」（不做左右分栏）。
//
// 两个老问题的修复记录：
//   ① 分类残留：分类标签以前是写死的 FOLDER_ORDER（角色/修图/合成/漫画），
//      数据删光了标签还在。现在标签一律由真实数据算出来，带条数。
//   ② 删了又回来：唯一会把删掉的条目加回来的就是「恢复内置」按钮（按名称补回全部内置）。
//      现在它必须二次确认，且文案写清楚，不再一点就把删掉的全补回来。
Admin.registerPage('prompt_lib', async (container) => {
  // 注意：Admin.get/post/put/del 会自动补 /api 前缀，这里不能再写 /api
  const API = '/comfyui/prompt-presets';

  // 分类展示顺序（只用于排序，不再写死成标签；标签只显示真实存在的分类）
  const FOLDER_ORDER = ['角色', '修图', '合成', '漫画'];
  const VIEW_KEY = 'pl_view_mode';

  const S = {
    all: [], kw: '', folder: '',
    view: (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card'),
    sel: new Set(),
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // 一条提示词的稳定 key：优先用后端下发的 id，老数据没有 id 时退回下标
  const keyOf = (p, i) => String(p && p.id ? p.id : ('idx:' + i));
  const findByKey = (k) => {
    const i = S.all.findIndex((p, ix) => keyOf(p, ix) === k);
    return i < 0 ? null : { i, p: S.all[i] };
  };

  // 一行预览：换行压成空格，超长截断（参考项目 PromptPreset.preview）
  function preview(text, n) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…';
  }

  function folderRank(f) {
    const v = String(f || '').trim();
    if (!v) return 10 ** 6;
    const i = FOLDER_ORDER.indexOf(v);
    return i < 0 ? FOLDER_ORDER.length + 1 : i;
  }

  // 检索：名称 / 分类 / 正文，空格分词，全部命中才算
  function search(items, kw) {
    const words = String(kw || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items.slice();
    return items.filter((p) => {
      const hay = `${p.name || ''}\n${p.folder || ''}\n${p.text || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  // 一条提示词的实际分类（空 → 未分类）
  const folderOf = (p) => String(p.folder || '').trim() || '未分类';

  // 真实存在的分类（带条数），按 FOLDER_ORDER 排，未分类排最后
  function folderStats() {
    const map = new Map();
    S.all.forEach((p) => {
      const f = folderOf(p);
      map.set(f, (map.get(f) || 0) + 1);
    });
    return [...map.entries()]
      .sort((a, b) => (folderRank(a[0] === '未分类' ? '' : a[0]) - folderRank(b[0] === '未分类' ? '' : b[0]))
        || a[0].localeCompare(b[0]));
  }

  function knownFolders() {
    return folderStats().map((x) => x[0]);
  }

  async function load() {
    S.all = await Admin.get(API).catch(() => []) || [];
    // 分类被删空 / 已不存在时，筛选条件要自动回到「全部」
    if (S.folder && !folderStats().some((x) => x[0] === S.folder)) S.folder = '';
    // 清掉已经不存在的选中项
    const alive = new Set(S.all.map((p, i) => keyOf(p, i)));
    [...S.sel].forEach((k) => { if (!alive.has(k)) S.sel.delete(k); });
    render();
  }

  // 当前筛选 + 搜索后可见的条目
  function visible() {
    return search(S.all, S.kw).filter((p) => !S.folder || folderOf(p) === S.folder);
  }

  // ---------------- 渲染 ----------------
  function render() {
    const vis = visible();

    // 按分类分组
    const bucket = new Map();
    vis.forEach((p) => {
      const f = folderOf(p);
      if (!bucket.has(f)) bucket.set(f, []);
      bucket.get(f).push(p);
    });
    const groups = [...bucket.entries()]
      .sort((a, b) => (folderRank(a[0] === '未分类' ? '' : a[0]) - folderRank(b[0] === '未分类' ? '' : b[0]))
        || a[0].localeCompare(b[0]));

    // ① 分类标签：只显示真实存在的分类（删空了标签就没了，不再残留）
    const stats = folderStats();
    const folderBtns = [`<button class="pl-fbtn${S.folder === '' ? ' on' : ''}" data-folder="">全部 <span class="pl-count">${S.all.length}</span></button>`]
      .concat(stats.map(([f, n]) => `<button class="pl-fbtn${S.folder === f ? ' on' : ''}" data-folder="${esc(f)}">${esc(f)} <span class="pl-count">${n}</span></button>`))
      .join('');

    const selN = S.sel.size;
    // 全选按钮：当前筛出来的全部都已选中时才置灰
    const allSel = vis.length > 0 && vis.every((p) => S.sel.has(keyOf(p, S.all.indexOf(p))));

    const cardBody = (list) => list.map((p) => {
      const i = S.all.indexOf(p);
      const k = keyOf(p, i);
      const on = S.sel.has(k);
      return `<div class="pl-card${on ? ' on' : ''}" data-idx="${i}" data-act="pl-edit">
        <label class="pl-chk" data-act="pl-chk" data-key="${esc(k)}" title="选中以便批量删除">
          <input type="checkbox" ${on ? 'checked' : ''} data-act="pl-chk" data-key="${esc(k)}"></label>
        <div class="pl-title">${esc(p.name)}${p.builtin ? '<span class="pl-badge">内置</span>' : ''}</div>
        <div class="pl-sub">${esc(preview(p.text, 90)) || '（空内容）'}</div>
        <div class="pl-ft">
          <span class="pl-len">${String(p.text || '').length} 字</span>
          <span style="flex:1"></span>
          <button class="btn btn-outline btn-sm" data-act="pl-edit" data-idx="${i}">编辑</button>
          <button class="btn btn-outline btn-sm" data-act="pl-dup" data-idx="${i}">复制</button>
          <button class="btn btn-outline btn-sm" data-act="pl-del" data-idx="${i}">删除</button>
        </div>
      </div>`;
    }).join('');

    const rowBody = (list) => list.map((p) => {
      const i = S.all.indexOf(p);
      const k = keyOf(p, i);
      const on = S.sel.has(k);
      return `<div class="pl-row${on ? ' on' : ''}" data-idx="${i}" data-act="pl-edit">
        <label class="pl-chk" data-act="pl-chk" data-key="${esc(k)}"><input type="checkbox" ${on ? 'checked' : ''} data-act="pl-chk" data-key="${esc(k)}"></label>
        <div class="pl-row-name">${esc(p.name)}${p.builtin ? '<span class="pl-badge">内置</span>' : ''}</div>
        <div class="pl-row-folder">${esc(folderOf(p))}</div>
        <div class="pl-row-text">${esc(preview(p.text, 110)) || '（空内容）'}</div>
        <div class="pl-row-len">${String(p.text || '').length} 字</div>
        <div class="pl-row-ops">
          <button class="btn btn-outline btn-sm" data-act="pl-edit" data-idx="${i}">编辑</button>
          <button class="btn btn-outline btn-sm" data-act="pl-dup" data-idx="${i}">复制</button>
          <button class="btn btn-outline btn-sm" data-act="pl-del" data-idx="${i}">删除</button>
        </div>
      </div>`;
    }).join('');

    const body = groups.length ? groups.map(([f, list]) => {
      const allOn = list.every((p) => S.sel.has(keyOf(p, S.all.indexOf(p))));
      return `
      <div class="pl-sec">
        <span class="pl-sec-name">${esc(f)}</span>
        <span class="pl-count">${list.length}</span>
        <button class="pl-mini" data-act="pl-selgroup" data-group="${esc(f)}" data-on="${allOn ? '1' : '0'}">${allOn ? '取消本组' : '选中本组'}</button>
      </div>
      <div class="${S.view === 'list' ? 'pl-rows' : 'pl-grid'}">
        ${S.view === 'list' ? rowBody(list) : cardBody(list)}
      </div>`;
    }).join('') : '<div class="pl-empty">没有匹配的提示词</div>';

    container.innerHTML = `
      <div class="pl-folders">${folderBtns}</div>
      <div class="pl-bar">
        <input id="pl-search" class="pl-search" type="text" placeholder="搜索名称 / 分类 / 正文（空格分隔多个关键词）" value="${esc(S.kw)}">
        <div class="pl-seg">
          <button class="pl-segbtn${S.view === 'card' ? ' on' : ''}" data-act="pl-view" data-view="card">卡片</button>
          <button class="pl-segbtn${S.view === 'list' ? ' on' : ''}" data-act="pl-view" data-view="list">列表</button>
        </div>
        <span style="flex:1"></span>
        <span class="pl-selcount${selN ? '' : ' dim'}">已选 <b>${selN}</b> 条</span>
        <button class="pl-mini" data-act="pl-sel-all" ${allSel ? 'disabled' : ''} title="选中当前筛出来的全部">全选</button>
        <button class="pl-mini" data-act="pl-sel-invert" ${vis.length ? '' : 'disabled'} title="当前显示的：选中的取消、没选的选中">反选</button>
        <button class="pl-mini" data-act="pl-sel-none" ${selN ? '' : 'disabled'} title="清空所有选中">清空</button>
        <button class="btn btn-primary btn-sm" data-act="pl-new">＋ 新建</button>
        <button class="btn btn-danger btn-sm" data-act="pl-delmany" ${selN ? '' : 'disabled style="opacity:.45;cursor:not-allowed"'}>批量删除${selN ? `（${selN}）` : ''}</button>
        <button class="btn btn-outline btn-sm" data-act="pl-restore" title="把被删掉的内置提示词补回来，不会覆盖你改过的同名条目">恢复内置</button>
      </div>
      ${body}
      <div class="pl-status">共 ${S.all.length} 条 ｜ 当前显示 ${vis.length} 条</div>`;

    bind();
  }

  function bind() {
    const box = document.getElementById('pl-search');
    if (box) {
      box.addEventListener('input', () => {
        S.kw = box.value; render();
        const b = document.getElementById('pl-search');
        if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
      });
    }
    container.querySelectorAll('[data-folder]').forEach((el) => {
      el.addEventListener('click', () => { S.folder = el.dataset.folder; render(); });
    });
  }

  // ---------------- 编辑弹窗 ----------------
  function openEditor(idx, isNew) {
    const p = isNew
      ? { name: uniqueName('新提示词'), text: '', folder: S.folder || '' }
      : S.all[idx];
    if (!p) return;
    const folders = knownFolders();
    const bodyHtml = `
      <div class="pl-form">
        <div class="pl-field"><label>名称（短一点，选词时要放得下）</label>
          <input id="ple-name" class="pl-inp" type="text" value="${esc(p.name || '')}" placeholder="例：三视图"></div>
        <div class="pl-field"><label>分类（可留空，也可直接输新的）</label>
          <input id="ple-folder" class="pl-inp" type="text" list="pl-dl-folder" value="${esc(p.folder || '')}" placeholder="可留空">
          <datalist id="pl-dl-folder">${folders.map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist></div>
        <div class="pl-field"><label>内容（完整提示词，可多行）</label>
          <textarea id="ple-text" class="pl-ta" rows="10" placeholder="这里写完整的提示词内容…">${esc(p.text || '')}</textarea>
          <div class="pl-meta" id="ple-meta"></div></div>
      </div>`;

    Admin.showModal(isNew ? '新建提示词' : '编辑提示词', bodyHtml, async () => {
      const name = (document.getElementById('ple-name').value || '').trim();
      const text = document.getElementById('ple-text').value || '';
      const folder = (document.getElementById('ple-folder').value || '').trim();
      if (!name) { Admin.toast('名称不能为空', 'error'); return; }
      try {
        if (isNew) await Admin.post(API, { name, text, folder });
        else await Admin.put(`${API}/${idx}`, { name, text, folder });
        Admin.toast('已保存：' + name, 'success');
        Admin.closeModal();
        await load();
      } catch (e) { Admin.toast(e.message || '保存失败', 'error'); }
    }, { size: 'xl' });

    const root = document.querySelector('.modal-body');
    const ta = document.getElementById('ple-text');
    const meta = document.getElementById('ple-meta');
    const upd = () => {
      const t = ta.value;
      meta.textContent = `${t.length} 字 ｜ ${t.split('\n').length} 行`;
    };
    if (ta) { ta.addEventListener('input', upd); upd(); }
    // 分类输入也用可搜索下拉（和模型配置页一致，避免原生 datalist 又白又窄）
    if (root && window.Combo) Combo.upgradeDatalists(root);
  }

  function uniqueName(base) {
    const names = new Set(S.all.map((p) => p.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i += 1;
    return `${base} ${i}`;
  }

  // ---------------- 批量删除 ----------------
  function selectedItems() {
    return [...S.sel].map(findByKey).filter(Boolean);
  }

  async function removeItems(items) {
    if (!items.length) return 0;
    const ids = [];
    const names = [];
    items.forEach(({ p }) => {
      if (p.id) ids.push(String(p.id));
      else names.push(String(p.name || ''));
    });
    const r = await Admin.post(API + '/delete-many', { ids, names });
    return (r && r.removed) || 0;
  }

  // ---------------- 事件 ----------------
  container.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const idx = el.dataset.idx === undefined || el.dataset.idx === '' ? null : Number(el.dataset.idx);

    if (act === 'pl-new') { openEditor(-1, true); return; }
    if (act === 'pl-edit') { openEditor(idx, false); return; }

    // 复选框：整块 label + input 都算，阻止冒泡到卡片的「编辑」
    if (act === 'pl-chk') {
      e.preventDefault();
      e.stopPropagation();
      const k = el.dataset.key;
      if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k);
      render();
      return;
    }

    if (act === 'pl-view') {
      S.view = el.dataset.view === 'list' ? 'list' : 'card';
      localStorage.setItem(VIEW_KEY, S.view);
      render();
      return;
    }

    if (act === 'pl-sel-all') {
      visible().forEach((p) => S.sel.add(keyOf(p, S.all.indexOf(p))));
      render();
      return;
    }
    if (act === 'pl-sel-invert') {
      visible().forEach((p) => {
        const k = keyOf(p, S.all.indexOf(p));
        if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k);
      });
      render();
      return;
    }
    if (act === 'pl-sel-none') { S.sel.clear(); render(); return; }

    if (act === 'pl-selgroup') {
      const g = el.dataset.group;
      const toOn = el.dataset.on !== '1';
      S.all.forEach((p, i) => {
        if (folderOf(p) !== g) return;
        const k = keyOf(p, i);
        if (toOn) S.sel.add(k); else S.sel.delete(k);
      });
      render();
      return;
    }

    if (act === 'pl-dup') {
      const p = S.all[idx];
      if (!p) return;
      try {
        await Admin.post(API, { name: uniqueName((p.name || '新提示词') + ' 副本'), text: p.text || '', folder: p.folder || '' });
        Admin.toast('已复制', 'success');
        await load();
      } catch (err) { Admin.toast(err.message || '复制失败', 'error'); }
      return;
    }

    if (act === 'pl-del') {
      const p = S.all[idx];
      if (!p) return;
      if (!(await Admin.confirm(`删除提示词「${p.name}」？删除后不可恢复。`, { danger: true, okText: '删除' }))) return;
      try {
        await removeItems([{ p }]);
        S.sel.delete(keyOf(p, idx));
        Admin.toast('已删除：' + p.name, 'success');
        await load();
      } catch (err) { Admin.toast(err.message || '删除失败', 'error'); }
      return;
    }

    if (act === 'pl-delmany') {
      const items = selectedItems();
      if (!items.length) { Admin.toast('还没有勾选任何提示词', 'info'); return; }
      const nm = items.length === 1
        ? `「${items[0].p.name}」`
        : `选中的 ${items.length} 条提示词（${items.slice(0, 4).map((x) => x.p.name).join('、')}${items.length > 4 ? '…' : ''}）`;
      const ok = await Admin.confirm(`确定删除 ${nm}？<br><br>删除后不可恢复；想找回内置条目请点「恢复内置」。`,
        { danger: true, okText: `删除 ${items.length} 条`, title: '批量删除提示词' });
      if (!ok) return;
      try {
        const n = await removeItems(items);
        S.sel.clear();
        Admin.toast(`已删除 ${n} 条提示词`, 'success');
        await load();
      } catch (err) { Admin.toast(err.message || '批量删除失败', 'error'); }
      return;
    }

    if (act === 'pl-restore') {
      // 这个按钮是唯一会把「删掉的内置提示词」补回来的入口，必须二次确认，
      // 免得误点一下又把之前辛苦删掉的全都加回来。
      const ok = await Admin.confirm(
        '会把内置提示词里<b>你删掉的那几条</b>补回来（按名称判重，已存在的同名条目不会被覆盖）。<br><br>'
        + '如果你只是想刷新列表，请点「取消」。',
        { danger: false, title: '恢复内置提示词', okText: '补回缺失的内置项' },
      );
      if (!ok) return;
      try {
        const d = await Admin.post(API + '/restore-builtin', {});
        Admin.toast(d.added ? `已补回 ${d.added} 条内置提示词` : '内置提示词都在，无需补回', 'success');
        await load();
      } catch (err) { Admin.toast(err.message || '恢复失败', 'error'); }
    }
  });

  injectCss();
  await load();
});

// ---------------- 样式 ----------------
let _plCss = false;
function injectCss() {
  if (_plCss || document.getElementById('pl-style-tag')) return;
  _plCss = true;
  const st = document.createElement('style');
  st.id = 'pl-style-tag';
  st.textContent = `
  .pl-folders{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .pl-fbtn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:var(--bg-input);
    border:1px solid var(--border);border-radius:999px;color:var(--text-secondary,#9aa3b2);
    font-size:12px;cursor:pointer;line-height:1.4}
  .pl-fbtn:hover{border-color:rgba(201,168,76,.5);color:var(--text-primary)}
  .pl-fbtn.on{border-color:var(--gold);color:var(--gold);background:rgba(201,168,76,.12)}
  .pl-count{font-size:10px;padding:0 6px;border-radius:8px;background:var(--bg-input);
    color:var(--text-muted);font-weight:400}
  .pl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .pl-search{flex:0 1 420px;min-width:220px;padding:7px 10px;background:var(--bg-input);
    border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px}
  .pl-search:focus{border-color:var(--gold)}
  .pl-seg{display:inline-flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
  .pl-segbtn{padding:5px 12px;background:var(--bg-input);border:0;color:var(--text-muted);
    font-size:12px;cursor:pointer}
  .pl-segbtn.on{background:var(--gold);color:#000;font-weight:600}
  .pl-selcount{font-size:12px;color:var(--text-secondary,#9aa3b2);white-space:nowrap}
  .pl-selcount.dim{opacity:.5}
  .pl-selcount b{color:var(--gold)}
  .pl-mini{padding:2px 9px;background:transparent;border:1px solid var(--border);
    border-radius:999px;color:var(--text-secondary,#9aa3b2);font-size:11px;cursor:pointer}
  .pl-mini:not(:disabled):hover{border-color:var(--gold);color:var(--gold)}
  .pl-mini:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(1)}
  .pl-sec{display:flex;align-items:center;gap:8px;margin:16px 0 8px;font-size:12px;font-weight:700;
    color:var(--gold);border-bottom:1px dashed var(--border);padding-bottom:5px}
  .pl-sec-name{letter-spacing:.5px}
  .pl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
  .pl-card{position:relative;border:1px solid var(--border);border-radius:var(--radius);padding:12px 12px 12px 34px;
    background:var(--bg-input);cursor:pointer;display:flex;flex-direction:column}
  .pl-card:hover{border-color:rgba(201,168,76,.55)}
  .pl-card.on{border-color:var(--gold);background:rgba(201,168,76,.10)}
  .pl-chk{position:absolute;left:10px;top:12px;display:inline-flex;align-items:center;cursor:pointer}
  .pl-chk input{width:14px;height:14px;accent-color:var(--gold);cursor:pointer}
  .pl-title{font-size:13px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px}
  .pl-badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--gold);color:#000;font-weight:700}
  .pl-sub{font-size:11px;color:var(--text-muted);line-height:1.6;margin:6px 0 10px;
    max-height:52px;overflow:hidden;word-break:break-word}
  .pl-ft{display:flex;align-items:center;gap:5px;margin-top:auto;flex-wrap:wrap}
  .pl-len{font-size:10px;color:var(--text-muted)}
  .pl-rows{display:flex;flex-direction:column;gap:6px}
  .pl-row{position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 32px;
    border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);cursor:pointer}
  .pl-row:hover{border-color:rgba(201,168,76,.55)}
  .pl-row.on{border-color:var(--gold);background:rgba(201,168,76,.10)}
  .pl-row .pl-chk{left:9px;top:50%;transform:translateY(-50%)}
  .pl-row-name{flex:0 0 170px;font-size:12px;font-weight:600;color:var(--text-primary);
    display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pl-row-folder{flex:0 0 62px;font-size:11px;color:var(--gold)}
  .pl-row-text{flex:1 1 auto;min-width:0;font-size:11px;color:var(--text-muted);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pl-row-len{flex:0 0 52px;font-size:10px;color:var(--text-muted);text-align:right}
  .pl-row-ops{flex:0 0 auto;display:flex;gap:5px}
  .pl-empty{text-align:center;padding:36px 12px;color:var(--text-muted);font-size:13px}
  .pl-status{margin-top:16px;font-size:11px;color:var(--text-muted)}
  .pl-form{display:flex;flex-direction:column;gap:12px}
  .pl-field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px}
  .pl-inp,.pl-ta{width:100%;box-sizing:border-box;padding:7px 10px;background:var(--bg-input);
    border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);
    font-size:12px;font-family:inherit}
  .pl-inp:focus,.pl-ta:focus{border-color:var(--gold)}
  .pl-ta{min-height:200px;line-height:1.7;resize:vertical}
  .pl-meta{margin-top:4px;font-size:11px;color:var(--text-muted)}
  `;
  document.head.appendChild(st);
}
