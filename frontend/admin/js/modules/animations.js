// ========== 动效展示管理模块（列表视图+分类筛选+批量操作+特效参数+标签系统+系统类型与自定义分类合并） ==========
Admin.registerPage('animations', async (container) => {
  const CATEGORY_MAP = {
    character_transition: '人物过渡',
    scene_change: '场景变化',
    battle_effect: '战斗效果',
  };
  const CATEGORY_ORDER = ['character_transition', 'scene_change', 'battle_effect'];
  const EFFECT_TYPE_MAP = {
    shake: '震动', fade: '渐影', blur: '模糊',
    darken: '昏暗', color_shift: '变色', zoom: '缩放', flash: '闪光',
  };
  // 系统类型节点：动效的 category 字段作为系统类型节点合并到分类栏
  const SYSTEM_TYPE_NODES = CATEGORY_ORDER.map(k => ({ value: k, label: CATEGORY_MAP[k] }));

  // 效果类型对应的参数字段定义
  const EFFECT_PARAMS = {
    shake: [
      { key: 'intensity', label: '震动强度', type: 'range', min: 1, max: 10, default: 5 },
      { key: 'frequency', label: '频率(ms)', type: 'number', min: 50, max: 500, default: 100 },
    ],
    fade: [
      { key: 'from_opacity', label: '起始透明度', type: 'range', min: 0, max: 1, step: 0.1, default: 1 },
      { key: 'to_opacity', label: '结束透明度', type: 'range', min: 0, max: 1, step: 0.1, default: 0 },
    ],
    blur: [
      { key: 'radius', label: '模糊半径(px)', type: 'range', min: 1, max: 20, default: 4 },
    ],
    darken: [
      { key: 'intensity', label: '昏暗强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
    ],
    color_shift: [
      { key: 'color', label: '变色颜色', type: 'color', default: '#ff0000' },
      { key: 'intensity', label: '变色强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.3 },
    ],
    zoom: [
      { key: 'scale', label: '缩放倍数', type: 'range', min: 0.5, max: 3, step: 0.05, default: 1.15 },
    ],
    flash: [
      { key: 'intensity', label: '闪光强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.8 },
      { key: 'color', label: '闪光颜色', type: 'color', default: '#ffffff' },
    ],
  };

  let effects = [], viewMode = 'list', selectedIds = new Set();
  let currentEffectCat = '', currentEffectType = '';
  let allTags = [], selectedTagIds = new Set();
  let allItemsCache = []; // 全部数据，用于分类计数
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;

  async function loadTags() {
    try {
      allTags = await Admin.get('/tags/');
    } catch (e) {
      allTags = [];
    }
  }

  async function load() {
    allItemsCache = await Admin.get('/animation-effects/');
    applyClientFilter();
  }

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
      // 选中系统类型节点：按动效 category 字段筛选（忽略 category_path）
      const t = getTypeFromPath(currentCategory);
      filtered = filtered.filter(x => x.category === t);
    } else if (currentCategory) {
      // 选中自定义分类：按 category_path 筛选
      filtered = filtered.filter(x => x.category_path === currentCategory);
    } else {
      // 未分类：显示没有 category_path 的动效
      filtered = filtered.filter(x => !x.category_path);
    }
    if (currentEffectType) filtered = filtered.filter(x => x.effect_type === currentEffectType);
    if (selectedTagIds.size > 0) {
      filtered = filtered.filter(x => {
        let tagIds = [];
        try { tagIds = typeof x.tags === 'string' ? JSON.parse(x.tags) : (x.tags || []); } catch {}
        return Array.isArray(tagIds) && tagIds.some(id => selectedTagIds.has(id));
      });
    }
    effects = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(x => !x.category_path).length;
    if (isTypePath(path)) {
      const t = getTypeFromPath(path);
      return allItemsCache.filter(x => x.category === t).length;
    }
    return allItemsCache.filter(x => x.category_path === path).length;
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="animations-toolbar"></div>
      <div id="animations-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'animation', {
      label: '动效分类',
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

  function renderTagClass(group) {
    const map = { character_transition: 'player', scene_change: 'ally', battle_effect: 'enemy' };
    return map[group] || 'npc';
  }

  function getTagNames(tagIdsJson) {
    if (!tagIdsJson) return [];
    try {
      const ids = typeof tagIdsJson === 'string' ? JSON.parse(tagIdsJson) : tagIdsJson;
      return ids.map(id => {
        const tag = allTags.find(t => t.id === id);
        return tag ? tag.name : `#${id}`;
      });
    } catch (e) {
      return [];
    }
  }

  function renderTagFilterBar() {
    if (allTags.length === 0) return '';
    const count = selectedTagIds.size;
    return `<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center">
      <button class="btn btn-outline btn-sm" id="btn-tag-filter" type="button" style="font-size:12px">🏷 标签筛选${count > 0 ? ` <span style="color:var(--gold)">(${count})</span>` : ''}</button>
      ${count > 0 ? '<button class="btn btn-outline btn-sm" id="btn-clear-tags" type="button" style="font-size:10px;padding:1px 8px">清除</button>' : ''}
    </div>`;
  }

  const TAG_CATEGORY_LABELS = { character: '人物', item: '物品', scene: '场景', plot: '剧情' };

  function render() {
    initLayout();
    if (categoryBarInstance) {
      // 同步分类栏的活跃状态和面包屑
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('animations-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <select id="effect-filter" style="padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="">全部效果</option>
            ${Object.entries(EFFECT_TYPE_MAP).map(([k, v]) =>
              `<option value="${k}" ${k === currentEffectType ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
          <span style="color:var(--text-muted);line-height:2;margin-left:8px">共 ${effects.length} 个动效</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-batch-category" style="margin-left:4px" ${batchAttr}>批量分类</button>
          <button class="btn btn-outline btn-sm" id="btn-batch-tags" ${batchAttr}>批量打标</button>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建动效</button>
        </div>
        ${renderTagFilterBar()}
      `;
    }

    let bodyHtml = '';
    if (effects.length === 0) {
      bodyHtml = '<div class="table-empty">暂无动效</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = renderGrid();
    } else {
      bodyHtml = renderList();
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    const bodyEl = document.getElementById('animations-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function renderGrid() {
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px">';
    effects.forEach(e => {
      const checked = selectedIds.has(e.id) ? 'checked' : '';
      const tagNames = getTagNames(e.tags);
      const tagHtml = tagNames.length > 0
        ? `<div style="font-size:9px;color:var(--text-muted);margin-bottom:4px">标签: ${tagNames.join(', ')}</div>`
        : '';
      const imgHtml = e.preview_image
        ? `<img src="${e.preview_image}" style="width:100%;height:100px;object-fit:cover;border-radius:4px;margin-bottom:8px">`
        : `<div style="width:100%;height:100px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:11px">无预览</div>`;
      html += `
        <div class="stat-card" style="padding:10px;position:relative">
          <input type="checkbox" class="item-checkbox" data-id="${e.id}" ${checked}
            style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
          ${imgHtml}
          <div style="font-size:13px;font-weight:500;margin-bottom:2px">${e.name}</div>
          <div style="font-size:11px;margin-bottom:2px">
            <span class="tag tag-${renderTagClass(e.category)}">${CATEGORY_MAP[e.category] || e.category}</span>
            <span class="tag tag-npc">${EFFECT_TYPE_MAP[e.effect_type] || e.effect_type}</span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">时长: ${e.duration}ms</div>
          ${tagHtml}
          <div style="display:flex;gap:4px;justify-content:center">
            <button class="btn btn-outline btn-sm btn-edit" data-id="${e.id}">编辑</button>
            <button class="btn btn-outline btn-sm btn-del" data-id="${e.id}" style="color:var(--red);border-color:var(--red)">删除</button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    return html;
  }

  function renderList() {
    let html = '<div class="table-container"><table><thead><tr>';
    html += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
    html += '<th>名称</th><th>分类</th><th>效果类型</th><th>时长</th><th>参数预览</th><th>标签</th><th style="width:120px">操作</th>';
    html += '</tr></thead><tbody>';

    effects.forEach(e => {
      const checked = selectedIds.has(e.id) ? 'checked' : '';
      let paramsPreview = '-';
      if (e.params) {
        try {
          const p = typeof e.params === 'string' ? JSON.parse(e.params) : e.params;
          const paramDefs = EFFECT_PARAMS[e.effect_type] || [];
          paramsPreview = paramDefs.map(pd => {
            const val = p[pd.key] !== undefined ? p[pd.key] : pd.default;
            return `${pd.label}: ${val}`;
          }).join(', ');
        } catch (e2) { paramsPreview = e.params; }
      }
      const tagNames = getTagNames(e.tags);
      const tagHtml = tagNames.length > 0
        ? tagNames.map(n => `<span class="tag tag-npc" style="font-size:9px;margin-right:2px">${n}</span>`).join('')
        : '<span style="font-size:10px;color:var(--text-muted)">-</span>';

      html += `
        <tr>
          <td><input type="checkbox" class="item-checkbox" data-id="${e.id}" ${checked}
            style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
          <td style="font-weight:500">${e.name}</td>
          <td><span class="tag tag-${renderTagClass(e.category)}">${CATEGORY_MAP[e.category] || e.category}</span></td>
          <td><span class="tag tag-npc">${EFFECT_TYPE_MAP[e.effect_type] || e.effect_type}</span></td>
          <td style="font-size:12px;color:var(--text-muted)">${e.duration}ms</td>
          <td style="font-size:11px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${paramsPreview}</td>
          <td style="font-size:11px;max-width:160px">${tagHtml}</td>
          <td>
            <div class="action-btns">
              <button class="btn-edit" data-id="${e.id}">编辑</button>
              <button class="btn-del" data-id="${e.id}" style="color:var(--red)">删除</button>
            </div>
          </td>
        </tr>
      `;
    });
    html += '</tbody></table></div>';
    return html;
  }

  function bindEvents() {
    // 效果类型筛选（动效分类已合并到 CategoryBar 系统类型节点）
    document.getElementById('effect-filter')?.addEventListener('change', async (e) => {
      currentEffectType = e.target.value;
      selectedIds.clear();
      applyClientFilter();
    });

    // 标签筛选点击
    document.getElementById('btn-tag-filter')?.addEventListener('click', () => {
      Admin.showTagFilterModal(allTags, selectedTagIds, (newSelection) => {
        selectedTagIds = newSelection;
        Admin.closeModal();
        applyClientFilter();
      });
    });
    document.getElementById('btn-clear-tags')?.addEventListener('click', () => {
      selectedTagIds.clear();
      applyClientFilter();
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

    // 全选
    document.getElementById('select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        effects.forEach(eff => selectedIds.add(eff.id));
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

    // 批量分类
    document.getElementById('btn-batch-category')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      showBatchCategoryForm();
    });
    // 批量打标
    document.getElementById('btn-batch-tags')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      showBatchTagForm();
    });
    // 批量移动到自定义分类
    document.getElementById('btn-move-selected')?.addEventListener('click', () => batchMoveToCategory());
    // 批量删除
    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个动效？`)) return;
      try {
        await Admin.post('/animation-effects/batch-delete', { ids: Array.from(selectedIds) });
        Admin.toast('删除完成', 'success');
        await load();
      } catch (e) {
        Admin.toast('批量删除失败: ' + e.message, 'error');
      }
    });
    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      selectedIds.clear();
      render();
    });
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const e = effects.find(x => x.id === parseInt(btn.dataset.id));
        if (e) showForm(e);
      });
    });
    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Admin.confirm('确定删除此动效？')) return;
        await Admin.del(`/animation-effects/${btn.dataset.id}`);
        Admin.toast('已删除', 'success');
        await load();
      });
    });
  }

  // ===== 批量移动到自定义分类 =====
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
          await Admin.put(`/animation-effects/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  // ===== 批量分类表单 =====
  function showBatchCategoryForm() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { Admin.toast('请先选择动效', 'info'); return; }
    const bodyHtml = `
      <div style="margin-bottom:12px;font-size:13px">将选中的 <strong>${ids.length}</strong> 个动效批量移动到：</div>
      <div class="form-group">
        <label>目标分类</label>
        <select id="batch-cat-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          ${Object.entries(CATEGORY_MAP).map(([k, v]) =>
            `<option value="${k}">${v}</option>`
          ).join('')}
        </select>
      </div>
    `;

    Admin.showModal('批量分类', bodyHtml, async () => {
      const category = document.getElementById('batch-cat-select')?.value;
      if (!category) { Admin.toast('请选择分类', 'info'); return; }
      try {
        await Admin.post('/animation-effects/batch-update-category', { ids, category });
        Admin.toast(`已将 ${ids.length} 个动效移至「${CATEGORY_MAP[category]}」`, 'success');
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('批量分类失败: ' + e.message, 'error');
      }
    });
  }

  // ===== 批量打标表单 =====
  function showBatchTagForm() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { Admin.toast('请先选择动效', 'info'); return; }

    // 先加载标签列表
    Admin.get('/tags/').then(tags => {
      const grouped = {};
      tags.forEach(t => {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category].push(t);
      });

      let tagOptionsHtml = '';
      Object.entries(grouped).forEach(([cat, tagList]) => {
        tagOptionsHtml += `<optgroup label="${TAG_CATEGORY_LABELS[cat] || cat}">`;
        tagList.forEach(t => {
          tagOptionsHtml += `<option value="${t.id}">${t.name}</option>`;
        });
        tagOptionsHtml += '</optgroup>';
      });

      const bodyHtml = `
        <div style="margin-bottom:12px;font-size:13px">为选中的 <strong>${ids.length}</strong> 个动效批量操作标签：</div>
        <div class="form-group">
          <label>操作模式</label>
          <select id="batch-tag-mode" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="add">追加标签</option>
            <option value="remove">移除标签</option>
            <option value="replace">替换为选定标签</option>
          </select>
        </div>
        <div class="form-group">
          <label>选择标签（可多选）</label>
          <select id="batch-tag-select" multiple style="width:100%;min-height:160px;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            ${tagOptionsHtml}
          </select>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">按住 Ctrl 键多选</div>
        </div>
      `;

      Admin.showModal('批量打标', bodyHtml, async () => {
        const mode = document.getElementById('batch-tag-mode')?.value || 'add';
        const select = document.getElementById('batch-tag-select');
        const tagIds = Array.from(select.selectedOptions).map(o => parseInt(o.value));
        if (tagIds.length === 0) { Admin.toast('请选择标签', 'info'); return; }
        try {
          await Admin.post('/animation-effects/batch-update-tags', { ids, tag_ids: tagIds, mode });
          Admin.toast(`已为 ${ids.length} 个动效${mode === 'add' ? '添加' : mode === 'remove' ? '移除' : '替换'}标签`, 'success');
          Admin.closeModal();
          await load();
        } catch (e) {
          Admin.toast('批量打标失败: ' + e.message, 'error');
        }
      });
    }).catch(e => {
      Admin.toast('加载标签列表失败: ' + e.message, 'error');
    });
  }

  // 生成效果类型对应的参数字段HTML
  function buildEffectParamsHtml(effectType, existingParams) {
    const paramDefs = EFFECT_PARAMS[effectType];
    if (!paramDefs || paramDefs.length === 0) {
      return '<div style="font-size:11px;color:var(--text-muted);padding:8px">该效果类型无额外参数配置</div>';
    }

    let html = '<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-top:8px;background:var(--bg-input)">';
    html += '<label style="font-size:12px;font-weight:500;color:var(--gold);margin-bottom:8px;display:block">特效参数配置</label>';

    let params = {};
    if (existingParams) {
      try {
        params = typeof existingParams === 'string' ? JSON.parse(existingParams) : existingParams;
      } catch (e) {}
    }

    paramDefs.forEach(pd => {
      const val = params[pd.key] !== undefined ? params[pd.key] : pd.default;
      html += `<div class="form-group" style="margin-bottom:8px">`;
      html += `<label style="font-size:11px">${pd.label}</label>`;

      if (pd.type === 'range') {
        const min = pd.min !== undefined ? pd.min : 0;
        const max = pd.max !== undefined ? pd.max : 100;
        const step = pd.step !== undefined ? pd.step : 1;
        html += `
          <div style="display:flex;gap:8px;align-items:center">
            <input type="range" class="effect-param" data-key="${pd.key}" min="${min}" max="${max}" step="${step}" value="${val}" style="flex:1">
            <span class="param-value" id="param-val-${pd.key}" style="font-size:12px;color:var(--text-bright);min-width:40px;text-align:right">${val}</span>
          </div>
        `;
      } else if (pd.type === 'color') {
        html += `<input type="color" class="effect-param" data-key="${pd.key}" value="${val}" style="width:60px;height:32px;padding:2px;cursor:pointer">`;
      } else {
        html += `<input type="number" class="effect-param" data-key="${pd.key}" value="${val}" min="${pd.min || 0}" max="${pd.max || 9999}" style="width:100%">`;
      }

      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function showForm(data = null) {
    const isEdit = !!data;
    let selectedEffectType = data?.effect_type || 'shake';
    let paramsHtml = buildEffectParamsHtml(selectedEffectType, data?.params);

    // 标签选择HTML
    let tagOptionsHtml = '';
    const grouped = {};
    allTags.forEach(t => {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    });
    Object.entries(grouped).forEach(([cat, tagList]) => {
      tagOptionsHtml += `<optgroup label="${TAG_CATEGORY_LABELS[cat] || cat}">`;
      tagList.forEach(t => {
        tagOptionsHtml += `<option value="${t.id}">${t.name}</option>`;
      });
      tagOptionsHtml += '</optgroup>';
    });
    let currentTagIds = [];
    if (data?.tags) {
      try {
        currentTagIds = typeof data.tags === 'string' ? JSON.parse(data.tags) : data.tags;
      } catch (e) {}
    }

    const bodyHtml = `
      <div class="form-group">
        <label>名称 *</label>
        <input name="name" value="${data?.name || ''}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>分类</label>
          <select name="category">
            <option value="character_transition" ${data?.category === 'character_transition' ? 'selected' : ''}>人物过渡</option>
            <option value="scene_change" ${data?.category === 'scene_change' ? 'selected' : ''}>场景变化</option>
            <option value="battle_effect" ${data?.category === 'battle_effect' ? 'selected' : ''}>战斗效果</option>
          </select>
        </div>
        <div class="form-group">
          <label>效果类型</label>
          <select name="effect_type" id="form-effect-type">
            <option value="shake" ${selectedEffectType === 'shake' ? 'selected' : ''}>震动</option>
            <option value="fade" ${selectedEffectType === 'fade' ? 'selected' : ''}>渐影</option>
            <option value="blur" ${selectedEffectType === 'blur' ? 'selected' : ''}>模糊</option>
            <option value="darken" ${selectedEffectType === 'darken' ? 'selected' : ''}>昏暗</option>
            <option value="color_shift" ${selectedEffectType === 'color_shift' ? 'selected' : ''}>变色</option>
            <option value="zoom" ${selectedEffectType === 'zoom' ? 'selected' : ''}>缩放</option>
            <option value="flash" ${selectedEffectType === 'flash' ? 'selected' : ''}>闪光</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="animation-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>时长(毫秒)</label>
          <input name="duration" type="number" value="${data?.duration || 1000}">
        </div>
      </div>
      <div id="effect-params-area">
        ${paramsHtml}
      </div>
      <div id="image-upload-area"></div>
      <div class="form-group">
        <label>预览图片路径</label>
        <input name="preview_image" id="preview_image_input" value="${data?.preview_image || ''}">
      </div>
      <div class="form-group">
        <label>标签（可多选）</label>
        <select name="tags" id="form-tags-select" multiple style="width:100%;min-height:100px;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          ${tagOptionsHtml}
        </select>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">按住 Ctrl 键多选</div>
      </div>
      <input type="hidden" name="params" id="params-json" value='${data?.params || ''}'>
    `;

    Admin.showModal(isEdit ? '编辑动效' : '新建动效', bodyHtml, async () => {
      // 收集参数
      collectParams();

      // 收集标签
      const tagSelect = document.getElementById('form-tags-select');
      if (tagSelect) {
        const selectedTagIds = Array.from(tagSelect.selectedOptions).map(o => parseInt(o.value));
        const tagsInput = document.createElement('input');
        tagsInput.type = 'hidden';
        tagsInput.name = 'tags';
        tagsInput.value = JSON.stringify(selectedTagIds);
        document.querySelector('.modal-body').appendChild(tagsInput);
      }

      const formData = Admin.getFormData('.modal-body');
      try {
        if (isEdit) {
          await Admin.put(`/animation-effects/${data.id}`, formData);
          Admin.toast('动效已更新', 'success');
        } else {
          await Admin.post('/animation-effects/', formData);
          Admin.toast('动效已创建', 'success');
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
          const catData = await Admin.get('/resource-categories/animation/tree');
          const catSelect = document.getElementById('animation-category-select');
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

      // 效果类型变更 → 动态切换参数UI
      const effectTypeSelect = document.getElementById('form-effect-type');
      if (effectTypeSelect) {
        effectTypeSelect.addEventListener('change', () => {
          const newType = effectTypeSelect.value;
          const paramsArea = document.getElementById('effect-params-area');
          if (paramsArea) {
            paramsArea.innerHTML = buildEffectParamsHtml(newType, null);
            bindParamEvents();
          }
        });
      }

      bindParamEvents();

      const imgArea = document.getElementById('image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.preview_image, (url) => {
          document.getElementById('preview_image_input').value = url;
        }, 'animation/cutscene');
      }

      // 初始化标签选中状态
      const tagSelect = document.getElementById('form-tags-select');
      if (tagSelect && currentTagIds.length > 0) {
        Array.from(tagSelect.options).forEach(opt => {
          if (currentTagIds.includes(parseInt(opt.value))) {
            opt.selected = true;
          }
        });
      }
    }, 100);
  }

  function bindParamEvents() {
    document.querySelectorAll('.effect-param').forEach(el => {
      el.addEventListener('input', () => {
        const key = el.dataset.key;
        const valSpan = document.getElementById(`param-val-${key}`);
        if (valSpan) valSpan.textContent = el.value;
        collectParams();
      });
      el.addEventListener('change', () => {
        collectParams();
      });
    });
  }

  function collectParams() {
    const params = {};
    document.querySelectorAll('.effect-param').forEach(el => {
      const key = el.dataset.key;
      let val = el.value;
      // 尝试转数字
      if (val !== '' && !isNaN(val)) val = parseFloat(val);
      params[key] = val;
    });
    const jsonInput = document.getElementById('params-json');
    if (jsonInput) {
      jsonInput.value = JSON.stringify(params);
    }
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await loadTags();
  await load();
});