// ========== 标签管理模块 ==========
Admin.registerPage('tags', async (container) => {
  const CATEGORY_MAP = {
    character: '人物标签',
    item: '物品标签',
    scene: '场景标签',
    plot: '剧情标签',
  };
  const CATEGORY_TAG_CLASS = {
    character: 'player',
    item: 'enemy',
    scene: 'ally',
    plot: 'npc',
  };
  let tags = [], currentTagCat = '', selectedIds = new Set();
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;
  let allItemsCache = []; // 全部数据，用于分类计数

  async function load() {
    allItemsCache = await Admin.get('/tags/');
    applyClientFilter();
  }

  function applyClientFilter() {
    let filtered = currentCategory
      ? allItemsCache.filter(x => x.category_path === currentCategory)
      : allItemsCache.filter(x => !x.category_path);
    if (currentTagCat) {
      filtered = filtered.filter(x => x.category === currentTagCat);
    }
    tags = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(x => !x.category_path).length;
    return allItemsCache.filter(x => x.category_path === path).length;
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="tags-toolbar"></div>
      <div id="tags-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'tag', {
      label: '标签分类',
      totalCount: 0,
      getCount: countInCategory,
      onSelect: (path) => {
        currentCategory = path || '';
        applyClientFilter();
      },
      onTreeChange: () => render(),
    });
  }

  function render() {
    initLayout();
    if (categoryBarInstance) {
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('tags-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <select id="cat-filter" style="padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="" ${currentTagCat === '' ? 'selected' : ''}>全部分类</option>
            ${Object.entries(CATEGORY_MAP).map(([k, v]) =>
              `<option value="${k}" ${currentTagCat === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
          <span style="color:var(--text-muted);line-height:2">共 ${tags.length} 个标签</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建标签</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (tags.length === 0) {
      bodyHtml = '<div class="table-empty">暂无标签</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th style="width:60px">ID</th><th>名称</th><th>分类</th><th>来源</th><th>描述</th><th style="width:120px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      tags.forEach(t => {
        const checked = selectedIds.has(t.id) ? 'checked' : '';
        const sourceLabel = t.is_auto
          ? (t.source_type === 'character' ? '自动(人物名)' : `自动(${t.source_type})`)
          : '手动';
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-id="${t.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${t.id}</td>
            <td style="font-weight:500">${t.name}</td>
            <td><span class="tag tag-${CATEGORY_TAG_CLASS[t.category] || 'npc'}">${CATEGORY_MAP[t.category] || t.category}</span></td>
            <td style="font-size:11px;color:var(--text-muted)">${sourceLabel}</td>
            <td style="font-size:12px">${(t.description || '').substring(0, 40)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${t.id}">编辑</button>
                <button class="btn-del" data-id="${t.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    const bodyEl = document.getElementById('tags-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('cat-filter')?.addEventListener('change', (e) => {
      currentTagCat = e.target.value;
      applyClientFilter();
    });

    document.getElementById('btn-add')?.addEventListener('click', () => showForm());
    document.getElementById('btn-move-selected')?.addEventListener('click', () => batchMoveToCategory());

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
      if (e.target.checked) {
        tags.forEach(t => selectedIds.add(t.id));
      } else {
        selectedIds.clear();
      }
      render();
    });

    document.querySelectorAll('.item-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        render();
      });
    });

    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const confirmed = await Admin.confirm(`确定要删除选中的 ${selectedIds.size} 个标签吗？关联的图片标签也会被清除。`);
      if (!confirmed) return;
      let success = 0, fail = 0;
      for (const id of selectedIds) {
        try {
          await Admin.del(`/tags/${id}`);
          success++;
        } catch (e) {
          fail++;
        }
      }
      Admin.toast(`删除完成: ${success} 个成功, ${fail} 个失败`, fail > 0 ? 'error' : 'success');
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      selectedIds.clear();
      render();
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = tags.find(t => t.id === parseInt(btn.dataset.id));
        if (tag) showForm(tag);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const confirmed = await Admin.confirm('确定要删除该标签吗？');
        if (!confirmed) return;
        try {
          await Admin.del(`/tags/${id}`);
          selectedIds.delete(id);
          Admin.toast('标签已删除', 'success');
          await load();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
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
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedIds.size}</b> 项移动到：</p>
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
          await Admin.put(`/tags/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
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
          <label>分类</label>
          <select name="category">
            ${Object.entries(CATEGORY_MAP).map(([k, v]) =>
              `<option value="${k}" ${data?.category === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description" rows="3">${data?.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="tag-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑标签' : '新建标签', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      try {
        if (isEdit) {
          await Admin.put(`/tags/${data.id}`, formData);
          Admin.toast('标签已更新', 'success');
        } else {
          await Admin.post('/tags/', formData);
          Admin.toast('标签已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });

    setTimeout(async () => {
      // 加载自定义分类下拉选项
      try {
        const catData = await Admin.get('/resource-categories/tag/tree');
        const catSelect = document.getElementById('tag-category-select');
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
    }, 100);
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});
