// ========== 全局统一图片网格组件 ==========
// 作用：把「图片」在系统里各处看/选/操作的方式统一成一套：
//   · 单击 = 选中（单选）
//   · Shift+单击 = 以锚点为起点连选一段（区间多选）
//   · Ctrl/⌘+单击 = 单独加选 / 取消
//   · 双击 = 用统一大图控件（ImagePreview）打开
//   · 右键 = 上下文菜单（查看大图 / 复制提示词 / 删除选中 / 宿主扩展项）
// 任何需要图片列表的地方（素材总览、AI 生图按人物、其它栏目生成的图）都复用它，
// 保证全系统图片操作方式一致。
(function () {
  if (window.ImageGrid) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureStyle() {
    if (document.getElementById('ig-style-tag')) return;
    const st = document.createElement('style');
    st.id = 'ig-style-tag';
    st.textContent = `
      [data-ig-id].sel{outline:2px solid var(--gold);outline-offset:-2px;
        box-shadow:0 0 0 1px var(--gold) inset;border-radius:6px}
      .ig-menu{position:fixed;z-index:99999;min-width:188px;background:var(--bg-input,#1d1d22);
        border:1px solid var(--border,#333);border-radius:8px;padding:4px;
        box-shadow:0 8px 28px rgba(0,0,0,.5);font-size:12.5px}
      .ig-menu button{display:flex;width:100%;align-items:center;gap:8px;text-align:left;
        background:transparent;border:none;color:var(--text-primary,#eee);
        padding:7px 10px;border-radius:6px;cursor:pointer;font-size:12.5px}
      .ig-menu button:hover{background:rgba(201,168,76,.16)}
      .ig-menu button.danger{color:#ff6b6b}
      .ig-menu button.danger:hover{background:rgba(255,80,80,.16)}
      .ig-menu .ig-sep{height:1px;background:var(--border,#333);margin:3px 2px}
      .ig-selbar{display:flex;align-items:center;gap:10px;margin:0 0 8px;
        font-size:12px;color:var(--text-muted);min-height:30px}
      .ig-selbar b{color:var(--gold);font-weight:600}
      .ig-selbar .grow{flex:1}
    `;
    document.head.appendChild(st);
  }

  // 复制文本到剪贴板（兼容无权限场景）
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) { return false; }
  }

  function mount(opts) {
    ensureStyle();
    const o = Object.assign({
      container: null,
      items: [],
      getId: (it) => String(it.id),
      renderCard: (it) => `<div data-ig-id="${esc(it.id)}"><img src="${esc(it.url)}" alt=""></div>`,
      getPreview: (it) => ({ url: it.url, title: '', prompt: it.prompt || '', width: it.width, height: it.height }),
      getPreviewList: null,      // 可选：返回完整 ImagePreview 列表
      onDelete: null,            // async (ids[]) => void
      onActivate: null,          // 纯单击（无修饰键）后的额外动作，默认仅选中
      menuItems: null,           // (it) => [{label, act, danger}]
      onMenuAct: null,           // (act, ids[], it) => void
      emptyText: '没有图片',
      showSelBar: false,         // 是否在网格上方显示「已选 N 张 / 全选 / 清空」工具条
    }, opts || {});

    if (!o.container) throw new Error('ImageGrid.mount 需要 container');

    const sel = new Set();   // 选中项的 id（字符串）
    let anchor = -1;         // 区间选择的锚点下标
    let items = o.items || [];

    const api = {
      setItems(next) { items = next || []; anchor = -1; repaint(); syncSelBar(); },
      getSelected() { return [...sel]; },
      getSelectedItems() { return items.filter((it) => sel.has(getId(it))); },
      selectAll() { items.forEach((it) => sel.add(getId(it))); repaint(); syncSelBar(); },
      clearSelection() { sel.clear(); anchor = -1; repaint(); syncSelBar(); },
      repaint,
      destroy() { closeMenu(); o.container.innerHTML = ''; },
    };

    function getId(it) { return o.getId(it); }
    function indexOfId(id) { return items.findIndex((it) => getId(it) === id); }

    function paintCardClasses() {
      o.container.querySelectorAll('[data-ig-id]').forEach((el) => {
        el.classList.toggle('sel', sel.has(el.getAttribute('data-ig-id')));
      });
    }

    function repaint() {
      if (!items.length) {
        o.container.innerHTML = `<div class="ig-empty" style="grid-column:1/-1;padding:26px;text-align:center;color:var(--text-muted);border:1px dashed var(--border);border-radius:6px">${esc(o.emptyText)}</div>`;
        return;
      }
      o.container.innerHTML = items.map((it, i) => o.renderCard(it, i)).join('');
      o.container.querySelectorAll('[data-ig-id]').forEach((el) => {
        const id = el.getAttribute('data-ig-id');
        const i = indexOfId(id);
        const it = items[i];
        el.classList.toggle('sel', sel.has(id));
        el.addEventListener('click', (e) => onCardClick(e, el, id, i, it));
        el.addEventListener('dblclick', (e) => { e.preventDefault(); openPreviewAt(i); });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, id, i, it); });
      });
    }

    function onCardClick(e, el, id, i, it) {
      if (e.shiftKey) {
        if (anchor < 0) anchor = i;
        const [a, b] = [anchor, i].sort((x, y) => x - y);
        for (let k = a; k <= b; k++) { const it2 = items[k]; if (it2) sel.add(getId(it2)); }
      } else if (e.ctrlKey || e.metaKey) {
        if (sel.has(id)) sel.delete(id); else { sel.add(id); anchor = i; }
      } else {
        sel.clear(); sel.add(id); anchor = i;
      }
      paintCardClasses();
      syncSelBar();
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && typeof o.onActivate === 'function') {
        try { o.onActivate(it); } catch (_) {}
      }
    }

    function previewList() {
      if (typeof o.getPreviewList === 'function') {
        try { return o.getPreviewList(); } catch (_) {}
      }
      return items.map((it) => o.getPreview(it));
    }

    function openPreviewAt(i) {
      if (!window.ImagePreview) return;
      const list = previewList();
      const idx = i < 0 ? 0 : i;
      ImagePreview.open(list, idx < list.length ? idx : 0);
    }

    // ---------- 右键菜单 ----------
    function closeMenu() {
      const m = document.querySelector('.ig-menu');
      if (m) m.remove();
      document.removeEventListener('mousedown', onDocDown, true);
    }
    function onDocDown(ev) {
      const m = document.querySelector('.ig-menu');
      if (m && !m.contains(ev.target)) closeMenu();
    }

    function buildMenuItems(it) {
      const picked = api.getSelectedItems();
      const list = [
        { label: '🔍 查看大图', act: 'view' },
        { label: `📋 复制提示词（${picked.length} 张）`, act: 'copy', show: picked.some((x) => (x.prompt || '').trim()) },
        { sep: true },
        { label: `🗑 删除选中（${picked.length} 张）`, act: 'del', danger: true, show: !!o.onDelete },
      ];
      if (typeof o.menuItems === 'function') {
        try {
          const extra = o.menuItems(it) || [];
          extra.forEach((x) => list.push(x));
        } catch (_) {}
      }
      return list.filter((x) => x.show !== false);
    }

    async function runAct(act, id, i, it) {
      const picked = api.getSelectedItems();
      if (act === 'view') {
        openPreviewAt(i);
      } else if (act === 'copy') {
        const text = picked.map((x) => x.prompt || '').filter(Boolean).join('\n\n');
        if (!text) { Admin.toast('这些图没有提示词', 'info'); return; }
        const ok = await copyText(text);
        Admin.toast(ok ? `已复制 ${picked.length} 张提示词` : '复制失败', ok ? 'success' : 'error');
      } else if (act === 'del') {
        if (!o.onDelete) return;
        if (!await Admin.confirm(`删除选中的 ${picked.length} 张图？（记录与磁盘文件都会删掉）`)) return;
        try { await o.onDelete(api.getSelected()); api.clearSelection(); }
        catch (err) { Admin.toast('删除失败：' + (err.message || err), 'error'); }
      } else if (typeof o.onMenuAct === 'function') {
        try { await o.onMenuAct(act, api.getSelected(), it); } catch (err) { Admin.toast('操作失败：' + (err.message || err), 'error'); }
      }
    }

    function openMenu(x, y, id, i, it) {
      closeMenu();
      // 右键的图不在选中集里时，先只选它
      if (!sel.has(id)) { sel.clear(); sel.add(id); anchor = i; paintCardClasses(); syncSelBar(); }
      const items = buildMenuItems(it);
      if (!items.length) return;
      const menu = document.createElement('div');
      menu.className = 'ig-menu';
      menu.innerHTML = items.map((m, k) => m.sep
        ? '<div class="ig-sep"></div>'
        : `<button type="button" data-k="${k}" class="${m.danger ? 'danger' : ''}">${esc(m.label)}</button>`).join('');
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 210)) + 'px';
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 30 * items.length - 20)) + 'px';
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
      menu.querySelectorAll('button[data-k]').forEach((b) => {
        b.addEventListener('click', () => {
          const m = items[Number(b.dataset.k)];
          closeMenu();
          if (m && m.act) runAct(m.act, id, i, it);
        });
      });
    }

    // ---------- 选择工具条（可选） ----------
    let selBar = null;
    function ensureSelBar() {
      if (!o.showSelBar) return;
      if (selBar && selBar.parentNode) return;
      selBar = document.createElement('div');
      selBar.className = 'ig-selbar';
      selBar.innerHTML = `<span>已选 <b class="ig-cnt">0</b> 张</span>
        <button type="button" class="btn btn-outline btn-sm ig-all">全选</button>
        <button type="button" class="btn btn-outline btn-sm ig-clear">清空</button>
        <span class="grow"></span>`;
      o.container.parentNode && o.container.parentNode.insertBefore(selBar, o.container);
      selBar.querySelector('.ig-all').addEventListener('click', () => api.selectAll());
      selBar.querySelector('.ig-clear').addEventListener('click', () => api.clearSelection());
    }
    function syncSelBar() {
      if (!o.showSelBar || !selBar) return;
      const c = selBar.querySelector('.ig-cnt');
      if (c) c.textContent = String(sel.size);
    }

    ensureSelBar();
    repaint();
    syncSelBar();
    return api;
  }

  window.ImageGrid = { mount };
})();
