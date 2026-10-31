// ========== 后台管理系统核心 ==========
const API_BASE = '/api';

const Admin = {
  currentPage: 'dashboard',
  pages: {},
  token: '',

  async init() {
    this.bindNav();
    this.bindSidebarToggle();
    this.registerPages();
    // 从 localStorage 恢复上次访问的页面，避免刷新后丢失
    const lastPage = localStorage.getItem('admin_current_page') || 'dashboard';
    this.navigate(lastPage);
  },

  bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.navigate(page);
      });
    });
  },

  // 收起 / 展开左侧栏目：状态存 localStorage，刷新后保持
  bindSidebarToggle() {
    const btn = document.getElementById('sb-toggle');
    let collapsed = false;
    try { collapsed = localStorage.getItem('admin_sidebar_collapsed') === '1'; } catch (_) {}
    document.body.classList.toggle('sb-collapsed', collapsed);
    btn?.addEventListener('click', () => {
      const now = !document.body.classList.contains('sb-collapsed');
      document.body.classList.toggle('sb-collapsed', now);
      try { localStorage.setItem('admin_sidebar_collapsed', now ? '1' : '0'); } catch (_) {}
      // 画布类页面依赖容器尺寸算缩放，收放后要让它们重算
      window.dispatchEvent(new Event('resize'));
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        btn?.click();
      }
    });
  },

  registerPages() {
    // 各模块在加载时通过 Admin.registerPage(name, renderFn) 注册
  },

  registerPage(name, renderFn) {
    this.pages[name] = renderFn;
  },

  async navigate(page) {
    if (this.currentPage === page && document.getElementById('content-area').children.length > 0) return;

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // 更新标题
    const titles = {
      dashboard: '仪表盘', characters: '人物管理', realms: '境界等级', items: '物品管理',
      equipments: '装备管理', affixes: '装备词条',
      scenes: '场景管理', skills: '技能书', story: '剧情管理', images: '图片管理',
      prompt_lib: '提示词管理',
      tags: '标签管理', animations: '动效展示', sounds: '声音管理',
      games: '游戏设置', users: '用户管理', character_states: '人物状态管理', players: '玩家角色',
      character_appearance: '人物外观拼装', settings: '设置', compose: '人物场景合成',
      comic: '漫画制作', comic_manage: '漫画管理',
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    // 供 CSS 按栏目放大字号 / 定制面板样式用
    document.body.dataset.page = page;

    // 渲染页面
    const content = document.getElementById('content-area');
    content.dataset.page = page;
    content.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)">加载中...</div>';

    try {
      if (this.pages[page]) {
        await this.pages[page](content);
      } else {
        content.innerHTML = `<div class="table-empty">页面 "${page}" 尚未实现</div>`;
      }
    } catch (e) {
      console.error(`页面 ${page} 渲染失败:`, e);
      content.innerHTML = `<div class="table-empty">加载失败: ${e.message}</div>`;
    }

    this.currentPage = page;
    // 持久化当前页面，刷新后可恢复
    try { localStorage.setItem('admin_current_page', page); } catch (_) {}
  },

  // ===== API 封装 =====
  async get(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = Array.isArray(err.detail) ? err.detail.map(e => e.msg || JSON.stringify(e)).join('; ') : (err.detail || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return res.json();
  },

  async post(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = Array.isArray(err.detail) ? err.detail.map(e => e.msg || JSON.stringify(e)).join('; ') : (err.detail || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return res.json();
  },

  async put(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = Array.isArray(err.detail) ? err.detail.map(e => e.msg || JSON.stringify(e)).join('; ') : (err.detail || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return res.json();
  },

  async del(path) {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      const msg = Array.isArray(err.detail) ? err.detail.map(e => e.msg || JSON.stringify(e)).join('; ') : (err.detail || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    // 返回响应体（如果有），便于读取 count 等字段
    if (res.status === 204) return null;
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  },

  async patch(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = Array.isArray(err.detail) ? err.detail.map(e => e.msg || JSON.stringify(e)).join('; ') : (err.detail || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return res.json();
  },

  async uploadFile(file, category = '') {
    const formData = new FormData();
    // 确保 file 有文件名（blob 裁剪后可能没有 name）
    if (file instanceof Blob && (!file.name || file.name === '')) {
      file = new File([file], 'cropped.png', { type: file.type || 'image/png' });
    }
    formData.append('file', file);
    if (category) formData.append('category', category);
    const res = await fetch(`${API_BASE}/upload/image`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '上传失败');
    }
    return res.json();
  },

  // 先裁剪再上传
  uploadWithCrop(file, category, aspectRatio = 0) {
    return new Promise((resolve, reject) => {
      ImageCropper.open({
        file,
        category,
        aspectRatio,
        onCrop: async (blob) => {
          try {
            const result = await this.uploadFile(blob, category);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        },
      });
    });
  },

  // ===== UI 工具 =====
  toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const div = document.createElement('div');
    div.className = `toast-msg toast-${type}`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  },

  // 模态框
  // size: 'normal' | 'large' | 'xl'（xl ≈ 全屏，用于节点编辑这类内容很多的弹窗）
  showModal(title, bodyHtml, onSave, options = {}) {
    const size = options.size || 'normal';
    const sizeClass = size === 'xl' ? 'modal-xl' : (size === 'large' ? 'modal-large' : '');
    const extraClass = options.modalClass ? ' ' + options.modalClass : '';
    const container = document.getElementById('modal-container');
    container.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal ${sizeClass}${extraClass}">
          <div class="modal-header">
            <h3>${title}</h3>
            <div style="display:flex;align-items:center;gap:8px">
              ${size === 'xl' ? '<button class="btn btn-outline btn-sm" id="modal-size-toggle" title="在全屏 / 常规尺寸之间切换" style="padding:3px 10px;font-size:11px">⤢ 切换尺寸</button>' : ''}
              <button class="modal-close" onclick="Admin.closeModal()">&times;</button>
            </div>
          </div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-footer">
            <button class="btn btn-outline" onclick="Admin.closeModal()">取消</button>
            <button class="btn btn-primary" id="modal-save-btn">保存</button>
          </div>
        </div>
      </div>
    `;
    // 弹窗只允许点击关闭按钮或取消/保存按钮关闭，禁止点击空白区域误触
    if (onSave) {
      document.getElementById('modal-save-btn').addEventListener('click', onSave);
    }
    if (size === 'xl') {
      document.getElementById('modal-size-toggle')?.addEventListener('click', () => {
        const m = container.querySelector('.modal');
        if (m) m.classList.toggle('modal-xl');
      });
    }
  },

  closeModal() {
    // 清理可能残留的浮层（对话行的表情选择弹窗 / 右键菜单）
    document.getElementById('dlg-expr-pop')?.remove();
    document.getElementById('dlg-cfg-pop')?.remove();
    document.getElementById('dlg-ctxmenu')?.remove();
    document.getElementById('modal-container').innerHTML = '';
  },

  // 标签筛选弹窗（替代直接显示所有标签芯片）
  showTagFilterModal(allTags, selectedTagIds, onConfirm) {
    const tempSelected = new Set(selectedTagIds);
    let searchKw = '';

    function getFilteredTags() {
      if (!searchKw) return allTags;
      return allTags.filter(t => (t.name || '').toLowerCase().includes(searchKw));
    }

    function renderTagList() {
      const filtered = getFilteredTags();
      const grouped = {};
      filtered.forEach(t => {
        const cat = t.category || '未分组';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(t);
      });
      if (Object.keys(grouped).length === 0) {
        return '<div style="text-align:center;padding:20px;color:var(--text-muted)">无匹配标签</div>';
      }
      return Object.entries(grouped).map(([cat, tags]) => `
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:600">${cat}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${tags.map(t => {
              const checked = tempSelected.has(t.id);
              return `<span class="tag-pick-item" data-id="${t.id}" style="display:inline-block;padding:3px 10px;font-size:12px;border:1px solid ${checked ? 'var(--gold)' : 'var(--border)'};border-radius:12px;cursor:pointer;user-select:none;background:${checked ? 'var(--gold)' : 'transparent'};color:${checked ? '#000' : 'var(--text-primary)'}">${t.name}</span>`;
            }).join('')}
          </div>
        </div>
      `).join('');
    }

    function refreshList() {
      const listArea = document.getElementById('tag-list-area');
      const countEl = document.getElementById('tag-selected-count');
      if (listArea) listArea.innerHTML = renderTagList();
      if (countEl) countEl.textContent = `已选 ${tempSelected.size} 个标签`;
      bindTagItems();
    }

    function bindTagItems() {
      document.querySelectorAll('.tag-pick-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = parseInt(el.dataset.id);
          if (tempSelected.has(id)) tempSelected.delete(id);
          else tempSelected.add(id);
          refreshList();
        });
      });
    }

    const bodyHtml = `
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
        <input type="text" id="tag-search-input" placeholder="搜索标签..." value="${searchKw}"
          style="flex:1;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
        <button class="btn btn-outline btn-sm" id="tag-select-all" type="button">全选</button>
        <button class="btn btn-outline btn-sm" id="tag-select-none" type="button">清空</button>
      </div>
      <div id="tag-selected-count" style="font-size:12px;color:var(--gold);margin-bottom:8px">已选 ${tempSelected.size} 个标签</div>
      <div id="tag-list-area" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--bg-input)">
        ${renderTagList()}
      </div>
    `;

    Admin.showModal('标签筛选', bodyHtml, () => {
      onConfirm(tempSelected);
    });

    setTimeout(() => {
      const searchInput = document.getElementById('tag-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          searchKw = searchInput.value.trim().toLowerCase();
          refreshList();
        });
        searchInput.focus();
      }
      document.getElementById('tag-select-all')?.addEventListener('click', () => {
        getFilteredTags().forEach(t => tempSelected.add(t.id));
        refreshList();
      });
      document.getElementById('tag-select-none')?.addEventListener('click', () => {
        getFilteredTags().forEach(t => tempSelected.delete(t.id));
        refreshList();
      });
      bindTagItems();
    }, 50);
  },

  getModalBody() {
    return document.querySelector('.modal-body');
  },

  // ===== 独立弹窗层 =====
  // 为什么要单独一层：confirm / prompt 以前直接往 #modal-container 里写，
  // 而人物编辑面板本身就住在这个容器里 —— 一弹确认框，编辑面板就被整个冲掉了
  // （表现就是「删个外观配置，整个人物编辑窗口直接没了」）。
  // 现在确认框 / 输入框画在自己的层上，随便弹几次都不会动到底下的编辑面板。
  _dialogLayer() {
    let layer = document.getElementById('dialog-container');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'dialog-container';
      document.body.appendChild(layer);
    }
    return layer;
  },

  _dialogClose() {
    const layer = document.getElementById('dialog-container');
    if (layer) layer.innerHTML = '';
  },

  /**
   * 统一确认框（全站所有「确定要删除吗」都走这里，样式一致）
   * @param {string} msg   正文
   * @param {object} opts  { title, danger, okText, cancelText }
   */
  confirm(msg, opts = {}) {
    return new Promise((resolve) => {
      const layer = this._dialogLayer();
      const title = opts.title || (opts.danger === false ? '确认操作' : '⚠ 危险操作');
      const okText = opts.okText || '确认';
      const cancelText = opts.cancelText || '取消';
      const okCls = opts.danger === false ? 'btn btn-primary' : 'btn btn-danger';
      layer.innerHTML = `
        <div class="modal-overlay dlg-overlay" id="confirm-overlay">
          <div class="modal dlg-modal">
            <div class="modal-header">
              <h3>${title}</h3>
              <button class="modal-close" data-a="no">&times;</button>
            </div>
            <div class="modal-body">
              <div class="dlg-body">
                <span class="dlg-ico${opts.danger === false ? ' info' : ''}">${opts.danger === false ? 'ℹ' : '⚠'}</span>
                <p>${msg}</p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline" data-a="no">${cancelText}</button>
              <button class="${okCls}" data-a="yes">${okText}</button>
            </div>
          </div>
        </div>
      `;
      const done = (v) => { this._dialogClose(); resolve(v); };
      layer.querySelectorAll('[data-a="yes"]').forEach(b => b.addEventListener('click', () => done(true)));
      layer.querySelectorAll('[data-a="no"]').forEach(b => b.addEventListener('click', () => done(false)));
      const ov = layer.querySelector('#confirm-overlay');
      if (ov) ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(false); });
      const okBtn = layer.querySelector('[data-a="yes"]');
      if (okBtn) setTimeout(() => okBtn.focus(), 30);
    });
  },

  /**
   * 统一输入弹窗（替代 window.prompt —— 原生那个和系统样式完全不搭）
   * @param {string} title
   * @param {object} opts { label, value, placeholder }
   * @returns {Promise<string|null>}
   */
  prompt(title, opts = {}) {
    return new Promise((resolve) => {
      const layer = this._dialogLayer();
      const label = opts.label || '';
      const value = opts.value == null ? '' : opts.value;
      layer.innerHTML = `
        <div class="modal-overlay dlg-overlay" id="prompt-overlay">
          <div class="modal dlg-modal">
            <div class="modal-header">
              <h3>${title}</h3>
              <button class="modal-close" data-a="no">&times;</button>
            </div>
            <div class="modal-body">
              ${label ? `<div class="dlg-label">${label}</div>` : ''}
              <input class="dlg-input" id="dlg-prompt-input" value="" placeholder="${opts.placeholder || ''}">
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline" data-a="no">取消</button>
              <button class="btn btn-primary" data-a="yes">确定</button>
            </div>
          </div>
        </div>
      `;
      const input = layer.querySelector('#dlg-prompt-input');
      input.value = value;
      const done = (v) => { this._dialogClose(); resolve(v); };
      const submit = () => {
        const v = (input.value || '').trim();
        done(v || null);
      };
      layer.querySelector('[data-a="yes"]').addEventListener('click', submit);
      layer.querySelectorAll('[data-a="no"]').forEach(b => b.addEventListener('click', () => done(null)));
      const ov = layer.querySelector('#prompt-overlay');
      if (ov) ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  },

  /** 统一提示框（替代 alert） */
  alertBox(msg, opts = {}) {
    return new Promise((resolve) => {
      const layer = this._dialogLayer();
      layer.innerHTML = `
        <div class="modal-overlay dlg-overlay" id="alert-overlay">
          <div class="modal dlg-modal">
            <div class="modal-header"><h3>${opts.title || '提示'}</h3>
              <button class="modal-close" data-a="ok">&times;</button></div>
            <div class="modal-body"><div class="dlg-body"><span class="dlg-ico info">ℹ</span><p>${msg}</p></div></div>
            <div class="modal-footer"><button class="btn btn-primary" data-a="ok">知道了</button></div>
          </div>
        </div>`;
      const done = () => { this._dialogClose(); resolve(true); };
      layer.querySelectorAll('[data-a="ok"]').forEach(b => b.addEventListener('click', done));
      setTimeout(() => layer.querySelector('[data-a="ok"]')?.focus(), 30);
    });
  },

  // 渲染表格
  renderTable(container, columns, rows, actions) {
    let html = '<div class="table-container"><table><thead><tr>';
    columns.forEach(col => { html += `<th>${col}</th>`; });
    if (actions) html += '<th style="width:120px">操作</th>';
    html += '</tr></thead><tbody>';

    if (rows.length === 0) {
      const colSpan = columns.length + (actions ? 1 : 0);
      html += `<tr><td colspan="${colSpan}" class="table-empty">暂无数据</td></tr>`;
    } else {
      rows.forEach(row => {
        html += '<tr>';
        columns.forEach((_, i) => {
          html += `<td>${row[i] !== undefined ? row[i] : ''}</td>`;
        });
        if (actions) {
          html += '<td><div class="action-btns">';
          if (actions.edit) html += `<button class="btn-edit" data-id="${row._id || row[0]}" data-action="edit">编辑</button>`;
          if (actions.delete) html += `<button class="btn-del" data-id="${row._id || row[0]}" data-action="delete">删除</button>`;
          if (actions.custom) {
            actions.custom.forEach(btn => {
              html += `<button class="btn-edit" data-id="${row._id || row[0]}" data-action="${btn.action}">${btn.label}</button>`;
            });
          }
          html += '</div></td>';
        }
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;

    // 绑定操作事件
    if (actions && actions.handler) {
      container.querySelectorAll('.action-btns button').forEach(btn => {
        btn.addEventListener('click', () => {
          actions.handler(btn.dataset.action, parseInt(btn.dataset.id));
        });
      });
    }
  },

  // 图片槽位控件（全站统一，实现在 modules/asset_picker.js）
  //
  // 兼容旧签名：renderImageUpload(container, currentUrl, onSelect, defaultCategory)
  // 之前每个模块都自己画一套「缩略图 + 三个按钮 + 一行路径」，样式各异还会把路径显示出来。
  // 现在统一成相框：有图就是图 + 尺寸 + 来源角标，鼠标移上去才有「更换 / 预览」，不再露路径。
  renderImageUpload(container, currentUrl, onSelect, defaultCategory = '') {
    const kind = Admin._kindFromCategory(defaultCategory) || Admin._inferKindNear(container);
    const shape = { portrait: 'portrait', scene: 'wide', ui: 'wide', icon: 'square', item: 'square' }[kind] || 'auto';

    if (!window.AssetPicker) {
      // 兜底：AssetPicker 没加载时退回最朴素的输入框，别把表单搞崩
      container.innerHTML = `<input type="text" value="${currentUrl || ''}" placeholder="图片路径"
        style="width:100%;height:30px;padding:0 8px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary)">`;
      const inp = container.querySelector('input');
      inp.addEventListener('change', () => onSelect && onSelect(inp.value.trim()));
      return null;
    }

    // 老表单里那个「背景图片路径」输入框：留着存值，但从界面上藏掉
    // （用户明确说不要看到路径 —— 相框本身就是编辑入口）
    const scope = container?.closest('.modal-body') || container?.parentElement || document;
    const pathInput = Array.from(scope.querySelectorAll('input[id$="_input"]'))
      .find((i) => /image|img|portrait|icon|cover|pic|bg/i.test(i.id)
        && !i.closest('#image-upload-area, .islot'));
    if (pathInput) {
      pathInput.value = currentUrl || '';
      pathInput.style.display = 'none';
    }

    return AssetPicker.slot(container, {
      value: currentUrl,
      kind: kind || '',
      shape,
      label: Admin._labelNear(container) || '图片',
      onChange: (url) => {
        if (pathInput) pathInput.value = url || '';
        if (onSelect) onSelect(url);
      },
    });
  },

  // 图片分类 → 素材类型
  _kindFromCategory(cat) {
    if (!cat) return '';
    const c = String(cat).toLowerCase();
    if (c.includes('portrait') || c.includes('characters/avatar')) return 'portrait';
    if (c.includes('action') || c.includes('pose')) return 'pose';
    if (c.includes('scene') || c.includes('cutscene') || c.includes('background')) return 'scene';
    if (c.includes('monster') || c.includes('enemy')) return 'monster';
    if (c.includes('item')) return 'item';
    if (c.includes('skill') || c.includes('icon')) return 'icon';
    if (c.includes('ui') || c.includes('button') || c.includes('game')) return 'ui';
    return '';
  },

  // 从容器附近的字段名猜类型（老调用点没传分类时用）
  _inferKindNear(container) {
    const body = container?.closest('.modal-body');
    if (!body) return '';
    const names = Array.from(body.querySelectorAll('input[id$="_input"]'))
      .map((i) => (i.id + ' ' + (i.name || '')).toLowerCase()).join(' ');
    if (names.includes('portrait')) return 'portrait';
    if (names.includes('background') || names.includes('bg_image') || names.includes('arc_image')) return 'scene';
    if (names.includes('preview')) return 'ui';
    if (names.includes('item_image')) return 'item';
    if (names.includes('skill_image')) return 'icon';
    return '';
  },

  _labelNear(container) {
    const group = container?.closest('.form-group, .cf, .field');
    const lb = group?.querySelector('label, span');
    return lb ? lb.textContent.trim().replace(/[:：*]/g, '') : '';
  },

  // 旧版兼容方法（保留接口，内部改为空操作或简单刷新）
  async _loadImagePickerWithTags(onSelect, categoryFilter = '') {
    // 已弃用：图片选择改为弹窗触发，无需预加载
  },

  async _loadImagePicker(onSelect, categoryFilter = '') {
    // 已弃用：图片选择改为弹窗触发，无需预加载
  },

  // 表单值收集
  getFormData(formSelector) {
    const data = {};
    document.querySelectorAll(`${formSelector} input, ${formSelector} select, ${formSelector} textarea`).forEach(el => {
      if (el.name) {
        let val = el.value;
        if (el.type === 'number') {
          val = val === '' ? null : Number(val);
        } else if (el.tagName === 'SELECT') {
          if (val === '') {
            val = null;
          } else if (/^(id|_id)$/i.test(el.name) || /_id$/i.test(el.name)) {
            // xxx_id 结尾的字段自动转数字
            const num = Number(val);
            val = isNaN(num) ? val : num;
          }
        }
        data[el.name] = val;
      }
    });
    return data;
  },

  // ===== 标签筛选的图片选择器（可复用） =====
  // gridId: 图片网格容器ID
  // filterAreaId: 标签筛选区容器ID
  // category: 图片分类（可选）
  // currentUrl: 当前已选图片URL（用于高亮）
  // onSelect: 选中回调
  async renderImagePickerWithTags(gridId, filterAreaId, category, currentUrl, onSelect) {
    const grid = document.getElementById(gridId);
    const filterArea = document.getElementById(filterAreaId);
    if (!grid) return;

    // 当前选中的标签ID集合
    let selectedTagIds = new Set();

    // 加载所有标签用于筛选
    let allTags = [];
    try {
      allTags = await this.get('/tags/');
    } catch (e) {
      allTags = [];
    }

    // 渲染标签筛选区
    if (filterArea) {
      if (allTags.length === 0) {
        filterArea.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">暂无标签可筛选</span>';
      } else {
        // 按分类分组
        const grouped = {};
        allTags.forEach(t => {
          if (!grouped[t.category]) grouped[t.category] = [];
          grouped[t.category].push(t);
        });
        const catLabels = { character: '人物', item: '物品', scene: '场景', plot: '剧情' };
        let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">';
        html += '<span style="font-size:11px;color:var(--text-muted)">标签筛选:</span>';
        Object.entries(grouped).forEach(([cat, tags]) => {
          tags.forEach(t => {
            html += `<span class="picker-tag" data-tag-id="${t.id}" style="display:inline-block;padding:2px 8px;font-size:11px;border:1px solid var(--border);border-radius:10px;cursor:pointer;user-select:none">${catLabels[cat]||cat}: ${t.name}</span>`;
          });
        });
        html += '<button class="btn btn-outline btn-sm" id="picker-clear-tags" style="font-size:10px;padding:1px 8px">清除</button>';
        html += '</div>';
        filterArea.innerHTML = html;
        // 绑定标签点击
        filterArea.querySelectorAll('.picker-tag').forEach(el => {
          el.addEventListener('click', () => {
            const tid = parseInt(el.dataset.tagId);
            if (selectedTagIds.has(tid)) {
              selectedTagIds.delete(tid);
              el.style.background = '';
              el.style.borderColor = 'var(--border)';
              el.style.color = 'var(--text-primary)';
            } else {
              selectedTagIds.add(tid);
              el.style.background = 'var(--gold)';
              el.style.borderColor = 'var(--gold)';
              el.style.color = '#000';
            }
            loadImages();
          });
        });
        filterArea.querySelector('#picker-clear-tags')?.addEventListener('click', () => {
          selectedTagIds.clear();
          filterArea.querySelectorAll('.picker-tag').forEach(el => {
            el.style.background = '';
            el.style.borderColor = 'var(--border)';
            el.style.color = 'var(--text-primary)';
          });
          loadImages();
        });
      }
    }

    async function loadImages() {
      grid.innerHTML = '加载中...';
      let query = '';
      const params = [];
      if (category) params.push(`category=${encodeURIComponent(category)}`);
      if (selectedTagIds.size > 0) {
        params.push(`tag_ids=${encodeURIComponent(Array.from(selectedTagIds).join(','))}`);
        params.push('tag_match=any');
      }
      if (params.length > 0) query = '?' + params.join('&');
      try {
        const data = await Admin.get(`/upload/images${query}`);
        if (data.images.length === 0) {
          grid.innerHTML = '<span style="color:var(--text-muted);font-size:12px;padding:10px;display:inline-block">暂无图片</span>';
          return;
        }
        grid.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">' +
          data.images.map(img =>
            `<img src="${img.url}" class="img-thumb" data-url="${img.url}" title="${img.category_label} · ${img.filename}" style="width:100%;height:100px;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid transparent${img.url === currentUrl ? ';border-color:var(--gold)' : ''}">`
          ).join('') + '</div>';
        grid.querySelectorAll('img').forEach(thumb => {
          thumb.addEventListener('click', () => {
            const url = thumb.dataset.url;
            if (onSelect) onSelect(url);
          });
        });
      } catch (e) {
        grid.innerHTML = '<span style="color:var(--red);font-size:12px;padding:10px">加载失败</span>';
      }
    }

    await loadImages();
  },
};