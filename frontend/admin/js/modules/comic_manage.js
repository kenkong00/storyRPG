// ========== 漫画管理 ==========
// 用来管所有漫画工程文件：分类、批量删除、批量移动、发布状态。
// 「漫画制作」是编辑器，「漫画管理」是文件管理台，两者共用同一套 /api/comic 数据。
(function () {
  if (window.ComicManage) return;

  const API = '/comic';

  const MG = {
    items: [],
    cats: [],
    sel: new Set(),
    q: '',
    cat: '__all__',
    status: '',
    sort: 'updated',
  };

  const MODE_NAME = { manga: '页漫', scroll: '条漫', lianhuanhua: '小人书' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function toast(msg, err) {
    if (window.Admin && Admin.toast) Admin.toast(msg, err ? 'error' : 'success');
  }

  async function reload() {
    const d = await Admin.get(`${API}/manage`);
    MG.items = d.projects || [];
    MG.cats = d.categories || [];
    // 已不存在的选中项清掉
    const alive = new Set(MG.items.map((x) => x.id));
    [...MG.sel].forEach((id) => { if (!alive.has(id)) MG.sel.delete(id); });
    render();
  }

  function filtered() {
    const q = MG.q.trim().toLowerCase();
    let list = MG.items.slice();
    if (MG.cat === '__none__') list = list.filter((x) => !x.category_path);
    else if (MG.cat !== '__all__') list = list.filter((x) => x.category_path === MG.cat);
    if (MG.status === 'pub') list = list.filter((x) => x.is_published);
    if (MG.status === 'draft') list = list.filter((x) => !x.is_published);
    if (q) {
      list = list.filter((x) => (x.title + ' ' + x.author + ' ' + x.description).toLowerCase().includes(q));
    }
    if (MG.sort === 'updated') list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    if (MG.sort === 'created') list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (MG.sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    if (MG.sort === 'done') list.sort((a, b) => (b.done / Math.max(1, b.cells)) - (a.done / Math.max(1, a.cells)));
    return list;
  }

  function catLabel(c) {
    return c || '未分类';
  }

  /* ==================== 渲染 ==================== */
  function render() {
    const bar = document.getElementById('mg-bar');
    const body = document.getElementById('mg-body');
    if (!bar || !body) return;

    const list = filtered();
    const allOn = list.length > 0 && list.every((x) => MG.sel.has(x.id));

    bar.innerHTML = `
      <input class="cm-input" id="mg-q" placeholder="搜索作品名 / 作者 / 简介" value="${esc(MG.q)}"
             style="width:210px;height:28px;padding:0 9px;border-radius:5px;border:1px solid var(--border);background:#12151d;color:#dfe4f0;font-size:13px;font-family:inherit">
      <select class="cm-sel" id="mg-cat">
        <option value="__all__">全部分类</option>
        <option value="__none__">未分类</option>
        ${MG.cats.map((c) => `<option value="${esc(c)}" ${MG.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <select class="cm-sel" id="mg-status">
        <option value="">全部状态</option>
        <option value="pub" ${MG.status === 'pub' ? 'selected' : ''}>已发布</option>
        <option value="draft" ${MG.status === 'draft' ? 'selected' : ''}>草稿</option>
      </select>
      <select class="cm-sel" id="mg-sort">
        <option value="updated" ${MG.sort === 'updated' ? 'selected' : ''}>按更新时间</option>
        <option value="created" ${MG.sort === 'created' ? 'selected' : ''}>按创建时间</option>
        <option value="title" ${MG.sort === 'title' ? 'selected' : ''}>按名称</option>
        <option value="done" ${MG.sort === 'done' ? 'selected' : ''}>按完成度</option>
      </select>
      <span class="sep" style="width:1px;height:20px;background:var(--border);margin:0 4px"></span>
      <button class="cm-btn" id="mg-batch-cat" ${MG.sel.size ? '' : 'disabled'}>批量分类</button>
      <button class="cm-btn" id="mg-batch-pub" ${MG.sel.size ? '' : 'disabled'}>批量发布</button>
      <button class="cm-btn" id="mg-batch-unpub" ${MG.sel.size ? '' : 'disabled'}>取消发布</button>
      <button class="cm-btn danger" id="mg-batch-del" ${MG.sel.size ? '' : 'disabled'}>批量删除</button>
      <span style="flex:1"></span>
      <span style="color:var(--text-muted);font-size:13px;white-space:nowrap">${list.length} 部 · 已选 ${MG.sel.size}</span>
      <button class="cm-btn" id="mg-refresh">刷新</button>
      <button class="cm-btn primary" id="mg-new">＋ 新建漫画</button>
    `;

    body.innerHTML = `
      <table class="cm-mg-table">
        <thead>
          <tr>
            <th style="width:34px"><input type="checkbox" id="mg-all" ${allOn ? 'checked' : ''}></th>
            <th style="width:56px">封面</th>
            <th>作品</th>
            <th style="width:86px">形态</th>
            <th style="width:110px">结构</th>
            <th style="width:130px">完成度</th>
            <th style="width:110px">分类</th>
            <th style="width:76px">状态</th>
            <th style="width:150px">更新时间</th>
            <th style="width:190px">操作</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((x) => {
            const pct = x.cells ? Math.round((x.done / x.cells) * 100) : 0;
            return `
            <tr class="${MG.sel.has(x.id) ? 'on' : ''}" data-row="${x.id}">
              <td><input type="checkbox" data-check="${x.id}" ${MG.sel.has(x.id) ? 'checked' : ''}></td>
              <td>${x.cover
                ? `<img class="cm-mg-cover" src="${esc(x.cover)}" loading="lazy">`
                : '<div class="cm-mg-cover ph">▤</div>'}</td>
              <td>
                <div class="cm-mg-title">${esc(x.title)}</div>
                <div class="cm-mg-sub">${x.author ? esc(x.author) + ' · ' : ''}${esc((x.description || '').slice(0, 40)) || '暂无简介'}</div>
              </td>
              <td><span class="cm-mg-tag">${MODE_NAME[x.mode] || x.mode}</span></td>
              <td style="color:#a9b1c3">${x.books} 册 / ${x.pages} 页<br><span style="color:var(--text-muted);font-size:12px">${x.cells} 格</span></td>
              <td>
                <div style="color:#a9b1c3">${x.done}/${x.cells} 格 · ${pct}%</div>
                <div style="height:4px;border-radius:2px;background:#1e2432;margin-top:4px;overflow:hidden">
                  <i style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#c9a84c,#e8c76a)"></i>
                </div>
              </td>
              <td><span class="cm-mg-tag">${esc(catLabel(x.category_path))}</span></td>
              <td>${x.is_published
                ? '<span class="cm-mg-tag pub">已发布</span>'
                : '<span class="cm-mg-tag">草稿</span>'}</td>
              <td style="color:var(--text-muted)">${esc((x.updated_at || '').replace('T', ' ').slice(0, 16))}</td>
              <td>
                <div class="cm-mg-acts">
                  <button class="cm-btn cm-mini" data-edit="${x.id}">编辑</button>
                  <button class="cm-btn cm-mini" data-pub="${x.id}">${x.is_published ? '下架' : '发布'}</button>
                  <button class="cm-btn cm-mini danger" data-del="${x.id}">删除</button>
                </div>
              </td>
            </tr>`;
          }).join('') || `<tr><td colspan="10"><div class="cm-mg-empty">还没有漫画工程，点右上角「新建漫画」开始</div></td></tr>`}
        </tbody>
      </table>`;

    bind(bar, body);
  }

  /* ==================== 交互 ==================== */
  function bind(bar, body) {
    const q = bar.querySelector('#mg-q');
    q.addEventListener('input', (e) => {
      MG.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const nq = document.getElementById('mg-q');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    });
    bar.querySelector('#mg-cat').addEventListener('change', (e) => { MG.cat = e.target.value; render(); });
    bar.querySelector('#mg-status').addEventListener('change', (e) => { MG.status = e.target.value; render(); });
    bar.querySelector('#mg-sort').addEventListener('change', (e) => { MG.sort = e.target.value; render(); });
    bar.querySelector('#mg-refresh').addEventListener('click', () => reload().then(() => toast('已刷新')));
    bar.querySelector('#mg-new').addEventListener('click', () => {
      Admin.navigate('comic');
    });
    bar.querySelector('#mg-batch-cat').addEventListener('click', async () => {
      const v = await Admin.prompt('批量分类', {
        label: '分类名（留空 = 移出分类）',
        placeholder: '例如：连载中 / 短篇 / 练习稿',
      });
      if (v === null || v === undefined) return;
      await batch('category', { category_path: v });
    });
    bar.querySelector('#mg-batch-pub').addEventListener('click', () => batch('publish'));
    bar.querySelector('#mg-batch-unpub').addEventListener('click', () => batch('unpublish'));
    bar.querySelector('#mg-batch-del').addEventListener('click', async () => {
      const n = MG.sel.size;
      if (!await Admin.confirm(`删除选中的 ${n} 部漫画？工程里的所有页面、格子与图片文件都会一起删掉，不可恢复。`, { danger: true })) return;
      await batch('delete');
    });

    body.querySelector('#mg-all')?.addEventListener('change', (e) => {
      const list = filtered();
      if (e.target.checked) list.forEach((x) => MG.sel.add(x.id));
      else list.forEach((x) => MG.sel.delete(x.id));
      render();
    });
    body.querySelectorAll('[data-check]').forEach((el) => el.addEventListener('change', (e) => {
      const id = Number(el.dataset.check);
      e.target.checked ? MG.sel.add(id) : MG.sel.delete(id);
      render();
    }));
    body.querySelectorAll('[data-row]').forEach((tr) => tr.addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
      openEditor(Number(tr.dataset.row));
    }));
    body.querySelectorAll('[data-edit]').forEach((el) => el.addEventListener('click', () => {
      openEditor(Number(el.dataset.edit));
    }));
    body.querySelectorAll('[data-pub]').forEach((el) => el.addEventListener('click', async () => {
      const id = Number(el.dataset.pub);
      const it = MG.items.find((x) => x.id === id);
      if (!it) return;
      try {
        await Admin.post(`${API}/projects/${id}/publish`, { published: !it.is_published });
        await reload();
        toast(it.is_published ? '已下架' : '已发布，前台书架可见');
      } catch (e) { toast(e.message, true); }
    }));
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const id = Number(el.dataset.del);
      const it = MG.items.find((x) => x.id === id);
      if (!it) return;
      if (!await Admin.confirm(`删除「${it.title}」？所有页面、格子、图片文件都会一起删掉。`, { danger: true })) return;
      try {
        await Admin.del(`${API}/projects/${id}`);
        await reload();
        toast('已删除');
      } catch (e) { toast(e.message, true); }
    }));
  }

  function openEditor(id) {
    try { localStorage.setItem('comic_last_project', String(id)); } catch (_) {}
    Admin.navigate('comic');
  }

  async function batch(action, extra) {
    if (!MG.sel.size) { toast('先勾选要操作的漫画'); return; }
    const ids = [...MG.sel];
    try {
      const r = await Admin.post(`${API}/projects/batch`, Object.assign({ action, ids }, extra || {}));
      MG.sel.clear();
      await reload();
      toast(`已处理 ${r.count} 部`);
    } catch (e) { toast(e.message, true); }
  }

  /* ==================== 挂载 ==================== */
  async function mount(host) {
    host.innerHTML = `
      <div class="cm-mg">
        <div class="cm-mg-bar" id="mg-bar"></div>
        <div class="cm-mg-body" id="mg-body"></div>
      </div>`;
    try {
      await reload();
    } catch (e) {
      host.querySelector('#mg-body').innerHTML =
        `<div class="cm-mg-empty">加载失败：${esc(e.message)}</div>`;
    }
  }

  window.ComicManage = { mount, state: MG, reload };
  Admin.registerPage('comic_manage', mount);
})();
