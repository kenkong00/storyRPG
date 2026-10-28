// ========== 装备词条管理模块 ==========
Admin.registerPage('affixes', async (container) => {
  const EFFECT_TYPE_MAP = {
    immune_death: '无法被杀死', exp_boost: '经验加成', hide_realm: '隐藏修为',
    stat_bonus: '属性加成', lifesteal: '吸血', mp_regen: '灵力恢复',
    dodge: '闪避', reflect: '反伤', armor_pierce: '破甲', extra_attack: '连击',
    revive: '复活', immune_displacement: '免疫位移', immune_debuff: '免疫负面',
    custom: '自定义',
  };
  let affixes = [], selectedIds = new Set();
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;
  let allItemsCache = []; // 全部数据，用于分类计数

  async function load() {
    allItemsCache = await Admin.get('/equipments/affixes');
    applyClientFilter();
  }

  function applyClientFilter() {
    if (currentCategory) {
      affixes = allItemsCache.filter(x => x.category_path === currentCategory);
    } else {
      affixes = allItemsCache.filter(x => !x.category_path);
    }
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
      <div id="affixes-toolbar"></div>
      <div id="affixes-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'affix', {
      label: '词条分类',
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
    const toolbar = document.getElementById('affixes-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${affixes.length} 个词条</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建词条</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (affixes.length === 0) {
      bodyHtml = '<div class="table-empty">暂无词条</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th>名称</th><th>效果类型</th><th>特殊</th><th>效果值</th><th>描述</th><th style="width:120px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      affixes.forEach(a => {
        const checked = selectedIds.has(a.id) ? 'checked' : '';
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="affix-checkbox" data-id="${a.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${a.is_special ? '★ ' : ''}${a.name}</td>
            <td><span class="tag tag-${a.is_special ? 'epic' : 'common'}">${EFFECT_TYPE_MAP[a.effect_type] || a.effect_type}</span></td>
            <td>${a.is_special ? '<span style="color:var(--gold)">是</span>' : '否'}</td>
            <td style="font-size:11px;color:var(--text-muted)">${a.effect_value || '-'}</td>
            <td style="font-size:12px">${(a.description || '').substring(0, 40)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${a.id}">编辑</button>
                <button class="btn-del" data-id="${a.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    const bodyEl = document.getElementById('affixes-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
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
      if (e.target.checked) affixes.forEach(a => selectedIds.add(a.id));
      else selectedIds.clear();
      render();
    });

    document.querySelectorAll('.affix-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        render();
      });
    });

    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个词条？`)) return;
      for (const id of selectedIds) {
        try { await Admin.del(`/equipments/affixes/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => { if (selectedIds.size === 0) return; selectedIds.clear(); render(); });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = affixes.find(x => x.id === parseInt(btn.dataset.id));
        if (a) showForm(a);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('确定删除该词条？')) return;
        try {
          await Admin.del(`/equipments/affixes/${id}`);
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
          await Admin.put(`/equipments/affixes/${id}`, { category_path: newCat });
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
      <div class="form-group">
        <label>名称 *</label>
        <input name="name" value="${data?.name || ''}" required>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="affix-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-group">
        <label>效果类型</label>
        <select name="effect_type" id="affix-effect-type">
          ${Object.entries(EFFECT_TYPE_MAP).map(([k, v]) =>
            `<option value="${k}" ${data?.effect_type === k ? 'selected' : ''}>${v}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>特殊词条</label>
        <select name="is_special">
          <option value="0" ${!data?.is_special ? 'selected' : ''}>否（普通属性词条）</option>
          <option value="1" ${data?.is_special ? 'selected' : ''}>是（特殊效果，如无法被杀死）</option>
        </select>
      </div>
      <div class="form-group">
        <label>效果值（JSON格式）</label>
        <textarea name="effect_value" rows="3">${data?.effect_value || '{}'}</textarea>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">如: {"exp_rate":1.5} 或 {"speed":30} 或 {"min_hp":1}</p>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑词条' : '新建词条', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      formData.is_special = parseInt(formData.is_special);
      try {
        if (isEdit) {
          await Admin.put(`/equipments/affixes/${data.id}`, formData);
          Admin.toast('词条已更新', 'success');
        } else {
          await Admin.post('/equipments/affixes', formData);
          Admin.toast('词条已创建', 'success');
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
        const catData = await Admin.get('/resource-categories/affix/tree');
        const catSelect = document.getElementById('affix-category-select');
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
