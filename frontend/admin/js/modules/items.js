// ========== 物品管理模块（列表默认 + 批量操作 + 标签 + 系统类型与自定义分类合并） ==========
Admin.registerPage('items', async (container) => {
  const TYPE_MAP = { consumable: '消耗物品', quest: '任务物品' };
  const RARITY_MAP = { common: '普通', uncommon: '精良', rare: '稀有', epic: '史诗', legendary: '传说' };
  const RARITY_CLASS = { common: 'common', uncommon: 'common', rare: 'rare', epic: 'epic', legendary: 'epic' };
  // 系统类型节点配置（与自定义分类合并显示在分类栏中）
  const SYSTEM_TYPE_NODES = [
    { value: 'quest', label: '任务物品' },
    { value: 'consumable', label: '消耗物品' },
  ];
  let items = [], currentType = '', viewMode = 'list', selectedIds = new Set();
  let allTags = [], selectedTagIds = new Set();
  let allItemsCache = []; // 全部数据，用于分类计数
  let currentCategory = ''; // 当前选中的分类路径（系统类型路径 __type__:xxx 或自定义路径）
  let categoryBarInstance = null;
  let layoutInitialized = false;

  async function loadTags() {
    try { allTags = await Admin.get('/tags/'); } catch (e) { allTags = []; }
  }

  async function load() {
    allItemsCache = await Admin.get('/items');
    applyClientFilter();
  }

  // 判断路径是否为系统类型节点路径
  function isTypePath(path) {
    return path && path.startsWith(CategoryBar.SYSTEM_TYPE_PREFIX);
  }

  function getTypeFromPath(path) {
    if (!isTypePath(path)) return '';
    return path.slice(CategoryBar.SYSTEM_TYPE_PREFIX.length);
  }

  function applyClientFilter() {
    let filtered = allItemsCache;
    if (isTypePath(currentCategory)) {
      // 选中系统类型节点：按物品类型筛选（忽略 category_path）
      const t = getTypeFromPath(currentCategory);
      filtered = filtered.filter(x => x.item_type === t);
    } else if (currentCategory) {
      // 选中自定义分类：按 category_path 筛选
      filtered = filtered.filter(x => x.category_path === currentCategory);
    } else {
      // 未分类：显示没有 category_path 的物品
      filtered = filtered.filter(x => !x.category_path);
    }
    // 标签筛选（叠加）
    if (selectedTagIds.size > 0) {
      filtered = filtered.filter(x => {
        let tagIds = [];
        try { tagIds = typeof x.tags === 'string' ? JSON.parse(x.tags) : (x.tags || []); } catch {}
        return Array.isArray(tagIds) && tagIds.some(id => selectedTagIds.has(id));
      });
    }
    items = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(x => !x.category_path).length;
    if (isTypePath(path)) {
      const t = getTypeFromPath(path);
      return allItemsCache.filter(x => x.item_type === t).length;
    }
    return allItemsCache.filter(x => x.category_path === path).length;
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="items-toolbar"></div>
      <div id="items-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'item', {
      label: '物品分类',
      totalCount: 0,
      getCount: countInCategory,
      systemNodes: SYSTEM_TYPE_NODES,
      onSelect: (path) => {
        currentCategory = path || '';
        applyClientFilter();
      },
      onTreeChange: () => render(),
    });
  }

  function renderTagFilterBar() {
    if (allTags.length === 0) return '';
    const count = selectedTagIds.size;
    return `<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center">
      <button class="btn btn-outline btn-sm" id="btn-tag-filter" type="button" style="font-size:12px">🏷 标签筛选${count > 0 ? ` <span style="color:var(--gold)">(${count})</span>` : ''}</button>
      ${count > 0 ? '<button class="btn btn-outline btn-sm" id="btn-clear-tags" type="button" style="font-size:10px;padding:1px 8px">清除</button>' : ''}
    </div>`;
  }

  function render() {
    initLayout();
    if (categoryBarInstance) {
      // 同步分类栏的活跃状态和面包屑
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('items-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${items.length} 个</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-outline btn-sm" id="btn-tag-selected" ${batchAttr}>批量打标签</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建物品</button>
        </div>
        ${renderTagFilterBar()}
      `;
    }

    let bodyHtml = '';
    if (items.length === 0) {
      bodyHtml = '<div class="table-empty">暂无物品</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px">';
      items.forEach(it => {
        const checked = selectedIds.has(it.id) ? 'checked' : '';
        const imgHtml = it.image
          ? `<img src="${it.image}" style="width:100%;height:140px;object-fit:contain;border-radius:4px;margin-bottom:8px;background:var(--bg-input)">`
          : `<div style="width:100%;height:140px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">无图标</div>`;
        bodyHtml += `
          <div class="stat-card" style="padding:10px;text-align:center;position:relative">
            <input type="checkbox" class="item-checkbox" data-id="${it.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:13px;font-weight:500;margin-bottom:2px">${it.name}</div>
            <div style="font-size:11px;margin-bottom:4px">
              <span class="tag tag-${it.item_type === 'quest' ? 'choice' : 'ally'}">${TYPE_MAP[it.item_type] || it.item_type}</span>
              <span class="tag tag-${RARITY_CLASS[it.rarity] || 'common'}">${RARITY_MAP[it.rarity] || it.rarity}</span>
            </div>
            <div style="font-size:10px;color:var(--text-muted)">价格: ${it.price || 0}</div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:4px">
              <button class="btn btn-outline btn-sm btn-edit" data-id="${it.id}">编辑</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${it.id}" style="color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th style="width:60px">图标</th><th>名称</th><th>类型</th><th>稀有度</th><th>价格</th><th>描述</th><th style="width:120px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      items.forEach(it => {
        const checked = selectedIds.has(it.id) ? 'checked' : '';
        const imgHtml = it.image
          ? `<img src="${it.image}" style="width:48px;height:48px;object-fit:contain;border-radius:4px;background:var(--bg-input)">`
          : `<div style="width:48px;height:48px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">无</div>`;
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-id="${it.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${imgHtml}</td>
            <td>${it.name}</td>
            <td><span class="tag tag-${it.item_type === 'quest' ? 'choice' : 'ally'}">${TYPE_MAP[it.item_type] || it.item_type}</span></td>
            <td><span class="tag tag-${RARITY_CLASS[it.rarity] || 'common'}">${RARITY_MAP[it.rarity] || it.rarity}</span></td>
            <td>${it.price || 0}</td>
            <td style="font-size:12px">${(it.description || '').substring(0, 30)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${it.id}">编辑</button>
                <button class="btn-del" data-id="${it.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    const bodyEl = document.getElementById('items-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('btn-tag-filter')?.addEventListener('click', () => {
      Admin.showTagFilterModal(allTags, selectedTagIds, (newSelection) => {
        selectedTagIds = newSelection;
        Admin.closeModal();
        render();
      });
    });

    document.getElementById('btn-clear-tags')?.addEventListener('click', () => {
      selectedTagIds.clear();
      render();
    });

    document.getElementById('btn-view-grid')?.addEventListener('click', () => { viewMode = 'grid'; render(); });
    document.getElementById('btn-view-list')?.addEventListener('click', () => { viewMode = 'list'; render(); });
    document.getElementById('btn-add')?.addEventListener('click', () => showForm());

    // 子分类文件夹卡片点击
    container.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => {
        const path = el.dataset.path || '';
        currentCategory = path;
        if (categoryBarInstance) categoryBarInstance.setPath(path);
        applyClientFilter();
      });
    });

    document.getElementById('select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) items.forEach(it => selectedIds.add(it.id));
      else selectedIds.clear();
      render();
    });

    document.querySelectorAll('.item-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        render();
      });
    });

    document.getElementById('btn-move-selected')?.addEventListener('click', () => batchMoveToCategory());
    document.getElementById('btn-tag-selected')?.addEventListener('click', () => batchTag());
    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个物品？`)) return;
      for (const id of selectedIds) {
        try { await Admin.del(`/items/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await load();
    });
    document.getElementById('btn-clear-selected')?.addEventListener('click', () => { if (selectedIds.size === 0) return; selectedIds.clear(); render(); });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(i => i.id === parseInt(btn.dataset.id));
        if (item) showForm(item);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('确定删除该物品？')) return;
        try {
          await Admin.del(`/items/${id}`);
          Admin.toast('已删除', 'success');
          await load();
        } catch (e) { Admin.toast('删除失败: ' + e.message, 'error'); }
      });
    });
  }

  function batchMoveToCategory() {
    if (selectedIds.size === 0) return;
    const tree = categoryBarInstance ? categoryBarInstance.getTree() : [];
    function buildOpts(nodes, depth) {
      let html = '';
      nodes.forEach(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        html += `<option value="${n.path}">${prefix}${n.name}</option>`;
        if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
      });
      return html;
    }
    const bodyHtml = `
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedIds.size}</b> 项移动到自定义分类：</p>
      <div class="form-group">
        <select id="batch-move-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
          ${buildOpts(tree, 0)}
        </select>
      </div>
    `;
    Admin.showModal('批量移动分类', bodyHtml, async () => {
      const newCat = document.getElementById('batch-move-cat')?.value || '';
      let success = 0, fail = 0;
      for (const id of selectedIds) {
        try {
          await Admin.put(`/items/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  function batchTag() {
    if (selectedIds.size === 0) return;
    const bodyHtml = `
      <p style="font-size:14px;margin-bottom:16px">为选中的 <b style="color:var(--gold)">${selectedIds.size}</b> 个物品批量打标签：</p>
      <div class="form-group">
        <label>选择标签（可多选）</label>
        <div id="batch-tags-area" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);min-height:60px;max-height:220px;overflow-y:auto">
          ${allTags.length === 0 ? '<span style="font-size:12px;color:var(--text-muted)">暂无标签</span>' : allTags.map(t =>
            `<span class="batch-tag-chip" data-tag-id="${t.id}" data-active="0" style="display:inline-block;padding:3px 8px;font-size:11px;border:1px solid var(--border);border-radius:10px;cursor:pointer;user-select:none;background:transparent;color:var(--text-primary)">${t.name}</span>`
          ).join('')}
        </div>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:4px">提示：物品标签功能需要后端支持，当前仅记录选择。</p>
    `;
    Admin.showModal('批量打标签', bodyHtml, async () => {
      const sel = [];
      document.querySelectorAll('.batch-tag-chip').forEach(c => {
        if (c.dataset.active === '1') sel.push(parseInt(c.dataset.tagId));
      });
      Admin.toast(`已选择 ${sel.length} 个标签`, 'success');
      Admin.closeModal();
    });
    setTimeout(() => {
      document.querySelectorAll('.batch-tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const isActive = chip.dataset.active === '1';
          chip.dataset.active = isActive ? '0' : '1';
          chip.style.background = isActive ? 'transparent' : 'var(--gold)';
          chip.style.borderColor = isActive ? 'var(--border)' : 'var(--gold)';
          chip.style.color = isActive ? 'var(--text-primary)' : '#000';
        });
      });
    }, 100);
  }

  function showForm(data = null) {
    const isEdit = !!data;
    const bodyHtml = `
      <div class="form-row">
        <div class="form-group">
          <label>名称 *</label>
          <input name="name" value="${data?.name || ''}" required>
        </div>
        <div class="form-group">
          <label>类型</label>
          <select name="item_type">
            <option value="consumable" ${data?.item_type === 'consumable' ? 'selected' : ''}>消耗物品</option>
            <option value="quest" ${data?.item_type === 'quest' ? 'selected' : ''}>任务物品</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>稀有度</label>
          <select name="rarity">
            ${Object.entries(RARITY_MAP).map(([k, v]) =>
              `<option value="${k}" ${data?.rarity === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>价格</label>
          <input name="price" type="number" value="${data?.price || 0}">
        </div>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="item-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div id="item-image-upload-area"></div>
      <div class="form-group">
        <label>物品图片路径</label>
        <input name="image" id="item_image_input" value="${data?.image || ''}" placeholder="如: /images/icons/item/xxx.png">
      </div>
      <div class="form-group">
        <label>效果（JSON格式）</label>
        <textarea name="effect" rows="3">${data?.effect || '{}'}</textarea>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑物品' : '新建物品', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      try {
        if (isEdit) {
          await Admin.put(`/items/${data.id}`, formData);
          Admin.toast('物品已更新', 'success');
        } else {
          await Admin.post('/items', formData);
          Admin.toast('物品已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });

    setTimeout(() => {
      // 加载自定义分类下拉选项
      (async () => {
        try {
          const catData = await Admin.get('/resource-categories/item/tree');
          const catSelect = document.getElementById('item-category-select');
          if (catSelect) {
            const initialCat = data?.category_path || currentCategory || '';
            function buildOpts(nodes, depth) {
              let html = '';
              nodes.forEach(n => {
                const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
                html += `<option value="${n.path}" ${initialCat === n.path ? 'selected' : ''}>${prefix}${n.name}</option>`;
                if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
              });
              return html;
            }
            let opts = '<option value="">-- 未分类 --</option>';
            opts += buildOpts((catData.tree || []), 0);
            catSelect.innerHTML = opts;
          }
        } catch (e) { console.warn('加载分类失败:', e); }
      })();

      const imgArea = document.getElementById('item-image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.image, (url) => {
          document.getElementById('item_image_input').value = url;
        }, 'icons/item');
      }
    }, 100);
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await loadTags();
  await load();
});
