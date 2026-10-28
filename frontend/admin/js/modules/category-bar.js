// ========== 通用分类栏组件（自定义分类 + 子分类 + 悬停改/删 + 系统类型节点） ==========
// 提供 mount() 方法在各资源管理页面挂载分类栏，统一调用 /api/resource-categories 接口
// 参考 images.js 中分类栏样式与交互行为（悬停显示"改/删"按钮）
// 支持系统类型节点（如物品的"任务物品/消耗物品"、装备的"套装/配饰/法器"等）与自定义分类合并显示
const CategoryBar = {
  // 系统类型节点的路径前缀，用于区分自定义分类路径
  SYSTEM_TYPE_PREFIX: '__type__:',

  /**
   * 挂载分类栏到容器
   * @param {HTMLElement} container 渲染容器
   * @param {string} resourceType 资源类型（character/equipment/item/affix/scene/skill/animation/sound/story_arc/chapter/node/tag）
   * @param {Object} options 配置项
   *   - onSelect(path)  选择分类回调（path 为空字符串表示"未分类"）
   *   - getCount(path)  返回该分类下的项目数量（用于显示 (N)）
   *   - totalCount      "未分类"显示的总数量
   *   - label           分类标签文字，默认 "分类"
   *   - autoSelectFirst 是否在加载后自动选中第一个分类（默认 false）
   *   - systemNodes     系统类型节点数组：[{value:'quest',label:'任务物品'}, ...]
   *                     会作为虚拟系统分类节点在根级别渲染，路径为 __type__:<value>
   *   - onTreeChange()  分类树变更回调（新建/重命名/删除分类后触发，宿主可重新渲染文件夹卡片）
   * @returns 实例对象 { getPath, setPath, refresh, render }
   */
  mount(container, resourceType, options = {}) {
    const opts = Object.assign({
      onSelect: () => {},
      getCount: null,
      totalCount: 0,
      label: '分类',
      autoSelectFirst: false,
      systemNodes: [],
      onTreeChange: () => {},
    }, options || {});

    const state = {
      resourceType,
      tree: [],
      currentPath: '',
    };

    // 将系统类型节点转换为统一的树节点结构
    function buildSystemNodes() {
      return (opts.systemNodes || []).map(n => ({
        path: CategoryBar.SYSTEM_TYPE_PREFIX + n.value,
        name: n.label,
        group: '系统类型',
        is_system: true,
        children: [],
        _isTypeNode: true,
      }));
    }

    // 拉取分类树
    async function loadTree() {
      try {
        const data = await Admin.get(`/resource-categories/${resourceType}/tree`);
        state.tree = (data && data.tree) || [];
      } catch (e) {
        state.tree = [];
      }
    }

    function findNode(nodes, path) {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.children && n.children.length > 0) {
          const found = findNode(n.children, path);
          if (found) return found;
        }
      }
      return null;
    }

    // 在合并后的树（系统类型 + 自定义）中查找
    function findNodeInMerged(path) {
      const all = [...buildSystemNodes(), ...state.tree];
      return findNode(all, path);
    }

    function countFor(path) {
      if (!path) return opts.totalCount || 0;
      if (typeof opts.getCount === 'function') {
        try { return opts.getCount(path) || 0; } catch (_) { return 0; }
      }
      return 0;
    }

    // 渲染分类节点（仅渲染当前层级，不递归显示子分类）
    // 子分类通过下方的文件夹卡片展示，避免分类栏过长且子分类挤在父分类旁边
    function buildCatNode(node) {
      const active = node.path === state.currentPath;
      const activeCls = active ? ' active' : '';
      const count = countFor(node.path);
      // 自定义分类悬停时显示"改/删"按钮；系统分类和系统类型节点都不显示
      const actionsHtml = node.is_system ? '' : `
        <span class="cat-actions" data-stop-prop="1">
          <button class="cat-action-btn cat-edit" data-path="${node.path}" title="重命名" type="button">改</button>
          <button class="cat-action-btn danger cat-del" data-path="${node.path}" title="删除" type="button">删</button>
        </span>
      `;
      // 系统类型节点加一个特殊样式标识
      const typeBadge = node._isTypeNode ? '<span style="font-size:9px;color:var(--text-muted);margin-left:2px;vertical-align:1px" title="系统类型">●</span>' : '';
      // 若有子分类，加一个文件夹图标提示
      const hasChildrenBadge = (!node._isTypeNode && node.children && node.children.length > 0)
        ? `<span style="font-size:10px;color:var(--text-muted);margin-left:2px" title="${node.children.length} 个子分类">📁${node.children.length}</span>` : '';
      return `
        <span class="cat-node${activeCls}" data-path="${node.path}" data-system="${node.is_system ? '1' : '0'}" title="${node.path}">
          ${node.name}${typeBadge}${hasChildrenBadge}<span class="cat-count">(${count})</span>
          ${actionsHtml}
        </span>
      `;
    }

    function render() {
      let html = '<div class="category-bar-wrap">';
      html += '<div class="cat-bar-inner">';
      html += `<span class="cat-bar-label">${opts.label}:</span>`;
      const allActive = !state.currentPath;
      const uncategorizedCount = countFor('');
      html += `<span class="cat-node${allActive ? ' active' : ''}" data-path="" data-system="1">未分类<span class="cat-count">(${uncategorizedCount})</span></span>`;
      // 系统类型节点优先渲染（在自定义分类之前）
      buildSystemNodes().forEach(node => {
        html += buildCatNode(node);
      });
      state.tree.forEach(node => {
        html += buildCatNode(node);
      });
      html += '<span style="flex:1"></span>';
      html += '<button class="btn btn-outline btn-sm" id="btn-add-cat" type="button">+ 添加分类</button>';
      html += '</div>';
      // 面包屑路径（含数量）—— "未分类"不是其他分类的父级，只是一个固定分类
      if (state.currentPath) {
        const currentCount = countFor(state.currentPath);
        const currentNode = findNodeInMerged(state.currentPath);
        const currentName = currentNode ? currentNode.name : state.currentPath;
        const isType = currentNode && currentNode._isTypeNode;
        html += '<div class="cat-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:11px">';
        html += `<span class="crumb-item" data-path="" style="cursor:pointer;color:var(--text-muted)" title="返回未分类">← 返回未分类</span>`;
        html += `<span style="color:var(--text-muted)">|</span>`;
        html += `<span style="color:var(--text-muted)">${isType ? '类型:' : '分类:'}</span>`;
        html += `<span class="crumb-item" data-path="${state.currentPath}" style="cursor:default;color:var(--gold);font-weight:600">${currentName} <span style="color:var(--text-muted);font-weight:normal">(${currentCount})</span></span>`;
        html += '</div>';
      } else {
        // 在未分类时也显示数量
        html += `<div class="cat-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:11px"><span style="color:var(--text-muted)">当前: 未分类 (${uncategorizedCount})</span></div>`;
      }
      html += '</div>';
      container.innerHTML = html;
      bindEvents();
    }

    function bindEvents() {
      // 分类节点点击（排除 .cat-actions 区域）
      container.querySelectorAll('.cat-node').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.cat-actions')) return;
          const path = el.dataset.path || '';
          state.currentPath = path;
          render();
          try { opts.onSelect(path); } catch (_) {}
        });
      });
      // 面包屑导航点击
      container.querySelectorAll('.crumb-item').forEach(el => {
        el.addEventListener('click', () => {
          const path = el.dataset.path || '';
          if (path === state.currentPath) return;
          state.currentPath = path;
          render();
          try { opts.onSelect(path); } catch (_) {}
        });
      });
      // 添加分类
      const addBtn = container.querySelector('#btn-add-cat');
      if (addBtn) addBtn.addEventListener('click', () => showAddCategoryForm(''));
      // 重命名
      container.querySelectorAll('.cat-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          showRenameCategoryForm(btn.dataset.path);
        });
      });
      // 删除
      container.querySelectorAll('.cat-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const path = btn.dataset.path;
          const confirmed = await Admin.confirm(`确定要删除分类 "${path}" 吗？\n若分类下有子分类，将拒绝删除。`);
          if (!confirmed) return;
          try {
            await Admin.del(`/resource-categories/${resourceType}/${encodeURIComponent(path)}`);
            Admin.toast('分类已删除', 'success');
            if (state.currentPath === path) state.currentPath = '';
            await loadTree();
            render();
            try { opts.onSelect(state.currentPath); } catch (_) {}
            try { opts.onTreeChange(); } catch (_) {}
          } catch (err) {
            Admin.toast('删除失败: ' + err.message, 'error');
          }
        });
      });
    }

    // 添加分类表单
    function showAddCategoryForm(parentPath = '') {
      function buildOpts(nodes, depth) {
        let html = '';
        nodes.forEach(n => {
          if (n.is_system) return; // 不允许在系统分类或系统类型节点下创建子分类
          const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
          html += `<option value="${n.path}">${prefix}${n.name}</option>`;
          if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
        });
        return html;
      }
      const bodyHtml = `
        <div class="form-group">
          <label>分类名称 *</label>
          <input id="new-cat-name" placeholder="如: 我的分类 / 子分类名称" required>
        </div>
        <div class="form-group">
          <label>父分类（可选，留空为根分类）</label>
          <select id="new-cat-parent" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="">-- 作为根分类 --</option>
            ${buildOpts(state.tree, 0)}
          </select>
        </div>
        <p style="font-size:11px;color:var(--text-muted)">分类创建后可作为资源归属目录，支持在分类下创建子分类。</p>
      `;
      Admin.showModal('添加自定义分类', bodyHtml, async () => {
        const name = document.getElementById('new-cat-name').value.trim();
        const parent = document.getElementById('new-cat-parent').value;
        if (!name) { Admin.toast('请输入分类名称', 'error'); return; }
        try {
          await Admin.post(`/resource-categories/${resourceType}`, { name, parent_path: parent });
          Admin.toast('分类已创建', 'success');
          Admin.closeModal();
          await loadTree();
          render();
          // 通知宿主模块分类树已变更，重新渲染文件夹卡片
          try { opts.onTreeChange(); } catch (_) {}
        } catch (e) {
          Admin.toast('创建失败: ' + e.message, 'error');
        }
      });
    }

    function showRenameCategoryForm(path) {
      const node = findNode(state.tree, path);
      const bodyHtml = `
        <div class="form-group">
          <label>分类路径</label>
          <input value="${path}" disabled style="opacity:0.5">
        </div>
        <div class="form-group">
          <label>新名称 *</label>
          <input id="rename-cat-name" value="${node ? node.name : ''}" required>
        </div>
      `;
      Admin.showModal('重命名分类', bodyHtml, async () => {
        const name = document.getElementById('rename-cat-name').value.trim();
        if (!name) { Admin.toast('请输入名称', 'error'); return; }
        try {
          await Admin.put(`/resource-categories/${resourceType}/${encodeURIComponent(path)}`, { name });
          Admin.toast('分类已重命名', 'success');
          Admin.closeModal();
          await loadTree();
          render();
          try { opts.onTreeChange(); } catch (_) {}
        } catch (e) {
          Admin.toast('重命名失败: ' + e.message, 'error');
        }
      });
    }

    // 初始化：加载树并渲染
    (async () => {
      await loadTree();
      if (opts.autoSelectFirst && !state.currentPath && state.tree.length > 0) {
        // 不自动选中"全部"，保持空（与"全部"等价）
      }
      render();
    })();

    return {
      getPath() { return state.currentPath; },
      setPath(path) {
        state.currentPath = path || '';
        render();
      },
      async refresh() {
        await loadTree();
        render();
      },
      render,
      getTree() { return state.tree; },
      // 获取当前路径的子分类（系统类型节点和"未分类"没有子分类文件夹）
      getChildren() {
        // "未分类"是固定分类，只展示没有分类的数据，不显示其他分类的文件夹
        if (!state.currentPath) return [];
        // 系统类型节点没有子分类
        if (state.currentPath.startsWith(CategoryBar.SYSTEM_TYPE_PREFIX)) return [];
        const node = findNode(state.tree, state.currentPath);
        return (node && node.children) ? node.children : [];
      },
      // 渲染子分类文件夹卡片到指定容器，返回 HTML 字符串
      renderFolderCards() {
        const children = this.getChildren();
        if (!children || children.length === 0) return '';
        let html = '<div class="folder-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px">';
        children.forEach(cat => {
          const count = countFor(cat.path);
          html += `
            <div class="folder-card" data-path="${cat.path}" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .15s">
              <span style="font-size:20px">📁</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat.name}</div>
                <div style="font-size:10px;color:var(--text-muted)">${count} 项</div>
              </div>
            </div>
          `;
        });
        html += '</div>';
        return html;
      },
    };
  }
};

window.CategoryBar = CategoryBar;
