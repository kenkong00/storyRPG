// ========== 图片管理模块（自定义分类树 + 子分类 + 拖拽上传 + 批量管理 + 回收站） ==========
// 两个视图：
//   ① 素材图库：上传的图片（原有逻辑，一字未改，只是把容器换成 tab 里的 div）
//   ② AI 生成图：ComfyUI 出的图，按人物串起来（generated_library.js）
async function renderAssetLibrary(container) {
  let allImages = [], currentCategory = '', viewMode = 'list', selectedFiles = new Set();
  let allTags = [], selectedTagIds = new Set(), imageTagsMap = {};
  let categoryTree = []; // 自定义分类树
  let allImagesFull = []; // 全部图片（不筛选），用于分类计数
  let showRecycleBin = false; // 是否显示回收站视图
  let recycledItems = []; // 回收站中的图片列表
  let recycleSelected = new Set(); // 回收站中选中的文件名

  const TAG_CATEGORY_LABELS = { character: '人物', item: '物品', scene: '场景', plot: '剧情' };

  async function loadCategoryTree() {
    try {
      const data = await Admin.get('/upload/categories-tree');
      categoryTree = data.tree || [];
    } catch (e) {
      categoryTree = [];
    }
  }

  async function loadTags() {
    try {
      allTags = await Admin.get('/tags/');
    } catch (e) {
      allTags = [];
    }
  }

  async function loadImageTags() {
    if (allImagesFull.length === 0) { imageTagsMap = {}; return; }
    try {
      imageTagsMap = await Admin.post('/tags/images/batch-tags', allImagesFull.map(i => i.filename));
    } catch (e) {
      imageTagsMap = {};
    }
  }

  async function load() {
    // 始终加载全部图片（不带分类筛选），用于分类计数和客户端筛选
    const data = await Admin.get('/upload/images');
    allImagesFull = data.images || [];
    await loadImageTags();
    // 客户端筛选显示
    applyClientFilter();
  }

  async function loadRecycleBin() {
    try {
      const data = await Admin.get('/upload/recycle-bin');
      recycledItems = data.items || [];
    } catch (e) {
      recycledItems = [];
      Admin.toast('加载回收站失败: ' + e.message, 'error');
    }
    recycleSelected.clear();
    render();
  }

  // 客户端筛选：按分类 + 标签 + 搜索
  function applyClientFilter() {
    let list = allImagesFull;
    // 分类筛选：未分类显示无分类图片，选中分类只显示直接属于该分类的图片（不递归子分类）
    if (currentCategory) {
      list = list.filter(img => img.category === currentCategory);
    } else {
      list = list.filter(img => !img.category);
    }
    // 标签筛选
    if (selectedTagIds.size > 0) {
      list = list.filter(img => {
        const tags = imageTagsMap[img.filename] || [];
        return tags.some(t => selectedTagIds.has(t.id));
      });
    }
    allImages = list;
    selectedFiles.clear();
    render();
  }

  function tagClass(group) {
    return group === '人物类' ? 'player' : group === '图标类' ? 'accent' : group === '场景类' ? 'ally' : group === '动效类' ? 'enemy' : 'npc';
  }

  // 渲染分类树（左侧或顶部）
  function renderCategoryBar() {
    function buildCatNode(node, depth) {
      const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
      const active = node.path === currentCategory;
      const activeCls = active ? ' active' : '';
      const count = countImagesInCategory(node.path);
      // 自定义分类悬停时显示"改/删"按钮（参考V0.1样式，cat-actions默认隐藏，悬停.cat-node时显示）
      const actionsHtml = node.is_system ? '' : `
        <span class="cat-actions" data-stop-prop="1">
          <button class="cat-action-btn cat-edit" data-path="${node.path}" title="重命名" type="button">改</button>
          <button class="cat-action-btn danger cat-del" data-path="${node.path}" title="删除" type="button">删</button>
        </span>
      `;
      return `
        <span class="cat-node${activeCls}" data-path="${node.path}" data-system="${node.is_system ? '1' : '0'}" title="${node.path}">
          ${prefix}${node.name}<span class="cat-count">(${count})</span>
          ${actionsHtml}
        </span>
      `;
    }

    let html = '<div class="category-bar-wrap">';
    html += '<div class="cat-bar-inner">';
    html += '<span class="cat-bar-label">分类:</span>';
    // 未分类（固定项，显示没有分类的图片）
    const allActive = !currentCategory;
    const uncategorizedCount = countImagesInCategory('');
    html += `<span class="cat-node${allActive ? ' active' : ''}" data-path="" data-system="1">未分类<span class="cat-count">(${uncategorizedCount})</span></span>`;
    categoryTree.forEach(node => {
      html += buildCatNode(node, 0);
    });
    html += '<span style="flex:1"></span>';
    html += '<button class="btn btn-outline btn-sm" id="btn-add-cat" type="button">+ 添加分类</button>';
    html += '</div>';
    // 面包屑路径（含数量）—— "未分类"不是其他分类的父级，只是一个固定分类
    if (currentCategory) {
      const parts = currentCategory.split('/');
      const currentCount = countImagesInCategory(currentCategory);
      html += '<div class="cat-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:11px">';
      html += `<span class="crumb-item" data-path="" style="cursor:pointer;color:var(--text-muted)" title="返回未分类">← 返回未分类</span>`;
      html += `<span style="color:var(--text-muted)">|</span>`;
      html += `<span style="color:var(--text-muted)">分类:</span>`;
      let accPath = '';
      parts.forEach((part, idx) => {
        accPath = accPath ? `${accPath}/${part}` : part;
        const isLast = idx === parts.length - 1;
        html += `<span style="color:var(--text-muted)">›</span>`;
        if (isLast) {
          html += `<span class="crumb-item" data-path="${accPath}" style="cursor:default;color:var(--gold);font-weight:600">${part} <span style="color:var(--text-muted);font-weight:normal">(${currentCount})</span></span>`;
        } else {
          html += `<span class="crumb-item" data-path="${accPath}" style="cursor:pointer;color:var(--text-secondary)">${part}</span>`;
        }
      });
      html += '</div>';
    } else {
      html += `<div class="cat-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:11px"><span style="color:var(--text-muted)">当前: 未分类 (${uncategorizedCount})</span></div>`;
    }
    html += '</div>';
    return html;
  }

  function countImagesInCategory(catPath) {
    // 使用全部图片数据计算（不受当前筛选影响）
    // 未分类（空路径）= 没有分类的图片；有路径 = 精确匹配该分类（不递归子分类）
    if (!catPath) return allImagesFull.filter(img => !img.category).length;
    return allImagesFull.filter(img => img.category === catPath).length;
  }

  function renderTagFilterBar() {
    if (allTags.length === 0) return '';
    const count = selectedTagIds.size;
    return `<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center">
      <button class="btn btn-outline btn-sm" id="btn-tag-filter" type="button" style="font-size:12px">🏷 标签筛选${count > 0 ? ` <span style="color:var(--gold)">(${count})</span>` : ''}</button>
      ${count > 0 ? '<button class="btn btn-outline btn-sm" id="btn-clear-tags" type="button" style="font-size:10px;padding:1px 8px">清除</button>' : ''}
    </div>`;
  }

  // 渲染面包屑路径
  function renderBreadcrumb() {
    if (!currentCategory) return '';
    const parts = currentCategory.split('/');
    let html = '<div class="breadcrumb-bar" style="display:flex;align-items:center;gap:4px;margin-bottom:12px;padding:6px 12px;background:var(--bg-input);border-radius:var(--radius);font-size:12px">';
    html += '<span style="color:var(--text-muted)">路径:</span>';
    html += `<span class="crumb-item" data-path="" style="cursor:pointer;color:var(--text-secondary)" title="返回全部">全部</span>`;
    let accPath = '';
    parts.forEach((part, idx) => {
      accPath = accPath ? `${accPath}/${part}` : part;
      const isLast = idx === parts.length - 1;
      html += `<span style="color:var(--text-muted)">›</span>`;
      html += `<span class="crumb-item" data-path="${accPath}" style="cursor:${isLast ? 'default' : 'pointer'};color:${isLast ? 'var(--gold);font-weight:600' : 'var(--text-secondary)'}">${part}</span>`;
    });
    html += '</div>';
    return html;
  }

  // 渲染子分类文件夹卡片
  function renderSubCategoryFolders() {
    // "未分类"是固定分类，只展示没有分类的图片，不显示其他分类的文件夹
    if (!currentCategory) return '';
    // 找到当前分类节点的子分类
    let children = [];
    const node = findCatNode(categoryTree, currentCategory);
    if (node && node.children && node.children.length > 0) {
      children = node.children;
    }
    if (children.length === 0) return '';

    let html = '<div class="folder-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px">';
    children.forEach(cat => {
      const count = countImagesInCategory(cat.path);
      html += `
        <div class="folder-card" data-path="${cat.path}" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .15s">
          <span style="font-size:20px">📁</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat.name}</div>
            <div style="font-size:10px;color:var(--text-muted)">${count} 张图片</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    return html;
  }

  function render() {
    // 回收站视图：单独渲染
    if (showRecycleBin) {
      renderRecycleBinView();
      return;
    }
    // 批量管理按钮始终显示，未选时禁用
    const hasSel = selectedFiles.size > 0;
    const selCount = selectedFiles.size;
    const batchBtnStyle = hasSel ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"';

    const barHtml = `
      ${renderCategoryBar()}
      <div class="search-bar">
        <span style="color:var(--gold);line-height:2;margin-left:8px">已选 ${selCount} 张</span>
        <span style="margin:0 4px;color:var(--text-muted)">|</span>
        <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchBtnStyle}>移动到分类</button>
        <button class="btn btn-outline btn-sm" id="btn-tag-selected" ${batchBtnStyle}>批量打标签</button>
        <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchBtnStyle}>删除选中</button>
        <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchBtnStyle}>取消选择</button>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" id="btn-recycle-bin" title="回收站" type="button">🗑 回收站</button>
        <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
        <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
        <button class="btn btn-primary btn-sm" id="btn-upload-new">+ 上传图片</button>
      </div>
      ${renderTagFilterBar()}
    `;

    let bodyHtml = renderSubCategoryFolders();
    if (allImages.length === 0 && bodyHtml === '') {
      bodyHtml = '<div class="table-empty">该分类下暂无图片，点击上方"上传图片"按钮添加</div>';
    } else if (allImages.length === 0) {
      bodyHtml += '<div class="table-empty">该分类下暂无图片</div>';
    } else if (viewMode === 'grid') {
      bodyHtml += renderGrid();
    } else {
      bodyHtml += renderList();
    }

    container.innerHTML = barHtml + bodyHtml;
    bindEvents();
  }

  // ===== 回收站视图 =====
  function renderRecycleBinView() {
    const total = recycledItems.length;
    const hasSel = recycleSelected.size > 0;
    const selBtnStyle = hasSel ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"';

    const formatDate = (iso) => {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      } catch { return iso; }
    };

    let rowsHtml = '';
    if (total === 0) {
      rowsHtml = '<div class="table-empty">回收站为空</div>';
    } else {
      rowsHtml = '<div class="table-container"><table><thead><tr>';
      rowsHtml += '<th style="width:40px"><input type="checkbox" id="rb-select-all" title="全选"></th>';
      rowsHtml += '<th style="width:60px">预览</th><th>文件名</th><th>原分类</th><th>大小</th><th>删除时间</th><th style="width:180px">操作</th>';
      rowsHtml += '</tr></thead><tbody>';
      recycledItems.forEach(item => {
        const checked = recycleSelected.has(item.filename) ? 'checked' : '';
        const sizeKB = ((item.size || 0) / 1024).toFixed(1);
        const missingWarn = item.file_exists === false
          ? '<span style="color:var(--red);font-size:11px;margin-left:4px" title="物理文件已丢失">⚠ 文件丢失</span>'
          : '';
        rowsHtml += `
          <tr>
            <td><input type="checkbox" class="rb-checkbox" data-file="${item.filename}" ${checked}
              style="width:16px;height:16px;accent-color:var(--red);cursor:pointer"></td>
            <td>${item.file_exists
              ? `<img src="${item.url}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;opacity:0.7">`
              : '<span style="color:var(--text-muted);font-size:18px">📄</span>'}</td>
            <td style="font-size:12px;word-break:break-all">${item.filename}${missingWarn}</td>
            <td style="font-size:11px">${item.category_label || '未分类'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${sizeKB} KB</td>
            <td style="font-size:11px;color:var(--text-muted)">${formatDate(item.deleted_at)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-restore" data-file="${item.filename}" style="color:var(--gold)">恢复</button>
                <button class="btn-purge" data-file="${item.filename}" style="color:var(--red)">彻底删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      rowsHtml += '</tbody></table></div>';
    }

    const barHtml = `
      <div class="search-bar" style="background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.3);border-radius:8px;padding:8px 12px;margin-bottom:12px">
        <button class="btn btn-outline btn-sm" id="btn-exit-recycle-bin" title="返回图片管理">← 返回</button>
        <span style="color:var(--red);font-size:13px;font-weight:600;line-height:2;margin-left:8px">🗑 回收站</span>
        <span style="color:var(--text-muted);font-size:12px;margin-left:8px">共 ${total} 项</span>
        <span style="margin:0 4px;color:var(--text-muted)">|</span>
        <button class="btn btn-outline btn-sm" id="btn-restore-selected" ${selBtnStyle}>恢复选中</button>
        <button class="btn btn-outline btn-sm" id="btn-restore-all">全部恢复</button>
        <button class="btn btn-danger btn-sm" id="btn-purge-selected" ${selBtnStyle}>删除选中</button>
        <div style="flex:1"></div>
        <button class="btn btn-danger btn-sm" id="btn-empty-recycle-bin">清空回收站</button>
      </div>
    `;

    container.innerHTML = barHtml + rowsHtml;
    bindRecycleBinEvents();
  }

  function bindRecycleBinEvents() {
    document.getElementById('btn-exit-recycle-bin')?.addEventListener('click', () => {
      showRecycleBin = false;
      load();
    });

    // 全选
    document.getElementById('rb-select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        recycledItems.forEach(item => recycleSelected.add(item.filename));
      } else {
        recycleSelected.clear();
      }
      renderRecycleBinView();
    });

    // 单个复选框
    container.querySelectorAll('.rb-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const fn = cb.dataset.file;
        if (cb.checked) recycleSelected.add(fn);
        else recycleSelected.delete(fn);
        renderRecycleBinView();
      });
    });

    // 恢复选中
    document.getElementById('btn-restore-selected')?.addEventListener('click', async () => {
      if (recycleSelected.size === 0) return;
      try {
        const res = await Admin.post('/upload/recycle-bin/restore', Array.from(recycleSelected));
        Admin.toast(`已恢复 ${res.count} 项${res.not_found.length ? `，${res.not_found.length} 项未找到` : ''}`, 'success');
        await loadRecycleBin();
      } catch (e) {
        Admin.toast('恢复失败: ' + e.message, 'error');
      }
    });

    // 彻底删除选中
    document.getElementById('btn-purge-selected')?.addEventListener('click', async () => {
      if (recycleSelected.size === 0) return;
      const confirmed = await Admin.confirm(`确定要彻底删除选中的 ${recycleSelected.size} 项吗？\n此操作不可撤销，硬盘文件将被删除。`);
      if (!confirmed) return;
      try {
        const res = await Admin.post('/upload/recycle-bin/purge', Array.from(recycleSelected));
        Admin.toast(`已彻底删除 ${res.count} 项`, 'success');
        await loadRecycleBin();
      } catch (e) {
        Admin.toast('删除失败: ' + e.message, 'error');
      }
    });

    // 全部恢复
    document.getElementById('btn-restore-all')?.addEventListener('click', async () => {
      if (recycledItems.length === 0) return;
      const confirmed = await Admin.confirm(`确定恢复回收站中的所有 ${recycledItems.length} 项吗？`);
      if (!confirmed) return;
      try {
        const allFns = recycledItems.map(i => i.filename);
        const res = await Admin.post('/upload/recycle-bin/restore', allFns);
        Admin.toast(`已恢复 ${res.count} 项`, 'success');
        await loadRecycleBin();
      } catch (e) {
        Admin.toast('恢复失败: ' + e.message, 'error');
      }
    });

    // 清空回收站
    document.getElementById('btn-empty-recycle-bin')?.addEventListener('click', async () => {
      if (recycledItems.length === 0) return;
      const confirmed = await Admin.confirm(`确定清空回收站吗？\n所有 ${recycledItems.length} 项将被彻底删除，包括硬盘中的文件。此操作不可撤销。`);
      if (!confirmed) return;
      try {
        const res = await Admin.del('/upload/recycle-bin/empty');
        Admin.toast(`已清空回收站（删除 ${res.count} 项）`, 'success');
        await loadRecycleBin();
      } catch (e) {
        Admin.toast('清空失败: ' + e.message, 'error');
      }
    });

    // 单项恢复
    container.querySelectorAll('.btn-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fn = btn.dataset.file;
        try {
          const res = await Admin.post('/upload/recycle-bin/restore', [fn]);
          Admin.toast(`已恢复 ${res.count} 项`, 'success');
          await loadRecycleBin();
        } catch (e) {
          Admin.toast('恢复失败: ' + e.message, 'error');
        }
      });
    });

    // 单项彻底删除
    container.querySelectorAll('.btn-purge').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fn = btn.dataset.file;
        const confirmed = await Admin.confirm(`确定彻底删除 "${fn}" 吗？\n此操作不可撤销。`);
        if (!confirmed) return;
        try {
          const res = await Admin.post('/upload/recycle-bin/purge', [fn]);
          Admin.toast(`已彻底删除 ${res.count} 项`, 'success');
          await loadRecycleBin();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });
  }

  function renderTagsForImage(filename) {
    const tags = imageTagsMap[filename] || [];
    if (tags.length === 0) return '<span style="font-size:10px;color:var(--text-muted)">无标签</span>';
    return tags.map(t => `<span class="tag tag-${t.category === 'character' ? 'player' : t.category === 'item' ? 'item' : t.category === 'scene' ? 'ally' : 'dialogue'}" style="font-size:10px;margin-right:2px">${t.name}</span>`).join('');
  }

  function renderGrid() {
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px">';
    allImages.forEach(img => {
      const checked = selectedFiles.has(img.filename) ? 'checked' : '';
      html += `
        <div class="stat-card" style="padding:10px;text-align:center;position:relative">
          <input type="checkbox" class="img-checkbox" data-file="${img.filename}" data-cat="${img.category}" ${checked}
            style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
          <img src="${img.url}" style="width:100%;height:140px;object-fit:cover;border-radius:4px;margin-bottom:8px">
          <div style="font-size:11px;margin-bottom:2px"><span class="tag tag-${tagClass(img.category_group)}">${img.category_label}</span></div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;word-break:break-all">${img.filename}</div>
          <div style="min-height:18px;margin-bottom:4px;line-height:1.4">${renderTagsForImage(img.filename)}</div>
          <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm btn-copy" data-url="${img.url}">复制</button>
            <button class="btn btn-outline btn-sm btn-edit-img" data-file="${img.filename}" data-cat="${img.category}">编辑</button>
            <button class="btn btn-outline btn-sm btn-del-img" data-file="${img.filename}" data-cat="${img.category}" style="color:var(--red);border-color:var(--red)">删除</button>
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
    html += '<th style="width:60px">缩略图</th><th>文件名</th><th>分类</th><th>标签</th><th>大小</th><th style="width:160px">操作</th>';
    html += '</tr></thead><tbody>';

    allImages.forEach(img => {
      const checked = selectedFiles.has(img.filename) ? 'checked' : '';
      const sizeKB = (img.size / 1024).toFixed(1);
      html += `
        <tr>
          <td><input type="checkbox" class="img-checkbox" data-file="${img.filename}" data-cat="${img.category}" ${checked}
            style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
          <td><img src="${img.url}" style="width:48px;height:48px;object-fit:cover;border-radius:4px"></td>
          <td style="font-size:12px">${img.filename}</td>
          <td><span class="tag tag-${tagClass(img.category_group)}">${img.category_label}</span></td>
          <td style="font-size:11px">${renderTagsForImage(img.filename)}</td>
          <td style="font-size:12px;color:var(--text-muted)">${sizeKB} KB</td>
          <td>
            <div class="action-btns">
              <button class="btn-copy" data-url="${img.url}">复制</button>
              <button class="btn-edit-img" data-file="${img.filename}" data-cat="${img.category}">编辑</button>
              <button class="btn-del-img" data-file="${img.filename}" data-cat="${img.category}" style="color:var(--red)">删除</button>
            </div>
          </td>
        </tr>
      `;
    });
    html += '</tbody></table></div>';
    return html;
  }

  function bindEvents() {
    // 分类节点点击（排除操作按钮区域）
    container.querySelectorAll('.cat-node').forEach(el => {
      el.addEventListener('click', async (e) => {
        // 点击改/删按钮时不触发分类切换
        if (e.target.closest('.cat-actions')) return;
        currentCategory = el.dataset.path || '';
        selectedFiles.clear();
        applyClientFilter();
      });
    });
    // 面包屑导航点击
    container.querySelectorAll('.crumb-item').forEach(el => {
      el.addEventListener('click', () => {
        currentCategory = el.dataset.path || '';
        selectedFiles.clear();
        applyClientFilter();
      });
    });
    // 子分类文件夹卡片点击
    container.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => {
        currentCategory = el.dataset.path || '';
        selectedFiles.clear();
        applyClientFilter();
      });
    });
    // 添加分类
    document.getElementById('btn-add-cat')?.addEventListener('click', () => showAddCategoryForm());
    // 重命名分类
    container.querySelectorAll('.cat-edit').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const path = el.dataset.path;
        showRenameCategoryForm(path);
      });
    });
    // 删除分类
    container.querySelectorAll('.cat-del').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const path = el.dataset.path;
        const confirmed = await Admin.confirm(`确定要删除分类 "${path}" 吗？\n若分类下有图片或子分类，将拒绝删除。`);
        if (!confirmed) return;
        try {
          await Admin.del(`/upload/categories/${encodeURIComponent(path)}`);
          Admin.toast('分类已删除', 'success');
          if (currentCategory === path) currentCategory = '';
          await loadCategoryTree();
          await load();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });

    // 标签筛选弹窗
    document.getElementById('btn-tag-filter')?.addEventListener('click', () => {
      Admin.showTagFilterModal(allTags, selectedTagIds, (newSelection) => {
        selectedTagIds = newSelection;
        Admin.closeModal();
        selectedFiles.clear();
        applyClientFilter();
      });
    });

    // 清除标签筛选
    document.getElementById('btn-clear-tags')?.addEventListener('click', () => {
      selectedTagIds.clear();
      selectedFiles.clear();
      applyClientFilter();
    });

    // 视图切换
    document.getElementById('btn-view-grid')?.addEventListener('click', () => { viewMode = 'grid'; render(); });
    document.getElementById('btn-view-list')?.addEventListener('click', () => { viewMode = 'list'; render(); });

    // 回收站入口
    document.getElementById('btn-recycle-bin')?.addEventListener('click', async () => {
      showRecycleBin = true;
      await loadRecycleBin();
    });

    // 上传（顶部按钮）
    document.getElementById('btn-upload-new')?.addEventListener('click', () => {
      Admin.Pickers.uploadImage(currentCategory, async () => {
        await load();
      });
    });

    // 全选
    document.getElementById('select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        allImages.forEach(img => selectedFiles.add(img.filename));
      } else {
        selectedFiles.clear();
      }
      render();
    });

    // 复选框
    container.querySelectorAll('.img-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedFiles.add(cb.dataset.file);
        } else {
          selectedFiles.delete(cb.dataset.file);
        }
        render();
      });
    });

    // 批量操作按钮（即使禁用也绑定，禁用状态由 disabled 属性处理）
    document.getElementById('btn-move-selected')?.addEventListener('click', () => { if (selectedFiles.size > 0) batchMove(); });
    document.getElementById('btn-tag-selected')?.addEventListener('click', () => { if (selectedFiles.size > 0) batchTag(); });
    document.getElementById('btn-del-selected')?.addEventListener('click', () => { if (selectedFiles.size > 0) batchDelete(); });
    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      if (selectedFiles.size > 0) {
        selectedFiles.clear();
        render();
      }
    });

    // 复制
    container.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = window.location.origin + btn.dataset.url;
        navigator.clipboard.writeText(url).then(() => {
          Admin.toast('链接已复制', 'success');
        }).catch(() => {
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
          Admin.toast('链接已复制', 'success');
        });
      });
    });

    // 编辑
    container.querySelectorAll('.btn-edit-img').forEach(btn => {
      btn.addEventListener('click', () => editImage(btn.dataset.file, btn.dataset.cat));
    });

    // 删除（软删除，进回收站）
    container.querySelectorAll('.btn-del-img').forEach(btn => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.file;
        const cat = btn.dataset.cat;
        const confirmed = await Admin.confirm(`确定要删除 "${filename}" 吗？\n图片将移入回收站，可稍后恢复。`);
        if (!confirmed) return;
        try {
          const delQuery = cat ? `?category=${encodeURIComponent(cat)}` : '';
          await Admin.del(`/upload/image/${filename}${delQuery}`);
          selectedFiles.delete(filename);
          Admin.toast('图片已移入回收站', 'success');
          await load();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });
  }

  // 批量上传文件到指定分类
  async function batchUploadFiles(files, category) {
    if (!files || files.length === 0) return;
    let ok = 0;
    for (const f of files) {
      try {
        await Admin.uploadFile(f, category);
        ok++;
      } catch (e) {
        console.warn(`文件 ${f.name} 上传失败:`, e.message);
      }
    }
    if (ok > 0) {
      Admin.toast(`成功上传 ${ok}/${files.length} 张图片`, 'success');
      await load();
    } else {
      Admin.toast('上传失败', 'error');
    }
  }

  // 添加分类表单
  function showAddCategoryForm(parentPath = '') {
    // 构建可选父分类下拉
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
      <div class="form-group">
        <label>分类名称 *</label>
        <input id="new-cat-name" placeholder="如: 我的素材 / 子分类名称" required>
      </div>
      <div class="form-group">
        <label>父分类（可选，留空为根分类）</label>
        <select id="new-cat-parent" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 作为根分类 --</option>
          ${buildOpts(categoryTree, 0)}
        </select>
      </div>
      <p style="font-size:11px;color:var(--text-muted)">分类创建后可作为图片归属目录，支持在分类下创建子分类。</p>
    `;
    Admin.showModal('添加自定义分类', bodyHtml, async () => {
      const name = document.getElementById('new-cat-name').value.trim();
      const parent = document.getElementById('new-cat-parent').value;
      if (!name) { Admin.toast('请输入分类名称', 'error'); return; }
      try {
        await Admin.post('/upload/categories', { name, parent_path: parent });
        Admin.toast('分类已创建', 'success');
        Admin.closeModal();
        await loadCategoryTree();
        await load();
      } catch (e) {
        Admin.toast('创建失败: ' + e.message, 'error');
      }
    });
  }

  function showRenameCategoryForm(path) {
    const node = findCatNode(categoryTree, path);
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
        await Admin.put(`/upload/categories/${encodeURIComponent(path)}`, { name });
        Admin.toast('分类已重命名', 'success');
        Admin.closeModal();
        await loadCategoryTree();
        await load();
      } catch (e) {
        Admin.toast('重命名失败: ' + e.message, 'error');
      }
    });
  }

  function findCatNode(nodes, path) {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.children && n.children.length > 0) {
        const found = findCatNode(n.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  function editImage(filename, category) {
    const img = allImages.find(i => i.filename === filename);
    const currentTags = imageTagsMap[filename] || [];
    const currentTagIds = new Set(currentTags.map(t => t.id));

    // 构建分类下拉
    function buildCatOpts(nodes, depth) {
      let html = '';
      nodes.forEach(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        html += `<option value="${n.path}" ${n.path === category ? 'selected' : ''}>${prefix}${n.name}</option>`;
        if (n.children && n.children.length > 0) html += buildCatOpts(n.children, depth + 1);
      });
      return html;
    }

    const bodyHtml = `
      <div style="text-align:center;margin-bottom:16px">
        <img src="${img?.url || ''}" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid var(--border)">
      </div>
      <div class="form-group">
        <label>文件名</label>
        <input value="${filename}" disabled style="opacity:0.5">
      </div>
      <div class="form-group">
        <label>当前分类</label>
        <input value="${category || '未分类'}" disabled style="opacity:0.5">
      </div>
      <div class="form-group">
        <label>移动到新分类</label>
        <select id="edit-move-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
          ${buildCatOpts(categoryTree, 0)}
        </select>
      </div>
      <div class="form-group">
        <label>图片链接</label>
        <div style="display:flex;gap:8px">
          <input value="${img?.url || ''}" id="edit-img-url" readonly style="flex:1">
          <button class="btn btn-outline btn-sm" id="btn-copy-url">复制</button>
        </div>
      </div>
      <div class="form-group">
        <label>标签（点击勾选/取消）</label>
        <div id="edit-tags-area" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);min-height:50px;max-height:180px;overflow-y:auto">
          ${allTags.length === 0 ? '<span style="font-size:12px;color:var(--text-muted)">暂无标签，请先在「标签管理」中创建</span>' : allTags.map(t => {
            const active = currentTagIds.has(t.id);
            const style = active
              ? 'background:var(--gold);border-color:var(--gold);color:#000'
              : 'background:transparent;border-color:var(--border);color:var(--text-primary)';
            return `<span class="edit-tag-chip" data-tag-id="${t.id}" style="display:inline-block;padding:3px 8px;font-size:11px;border:1px solid;border-radius:10px;cursor:pointer;user-select:none;${style}">${TAG_CATEGORY_LABELS[t.category]||t.category}: ${t.name}</span>`;
          }).join('')}
        </div>
      </div>
    `;

    Admin.showModal('编辑图片', bodyHtml, async () => {
      const newCat = document.getElementById('edit-move-cat')?.value;
      let moved = false;
      if (newCat !== category) {
        try {
          const fromQuery = category ? `&from_category=${encodeURIComponent(category)}` : '';
          await Admin.put(`/upload/image/${encodeURIComponent(filename)}/move?to_category=${encodeURIComponent(newCat)}${fromQuery}`);
          moved = true;
        } catch (e) {
          Admin.toast('移动失败: ' + e.message, 'error');
          return;
        }
      }

      // 处理标签变更
      const newSelectedIds = new Set();
      document.querySelectorAll('.edit-tag-chip').forEach(chip => {
        const tid = parseInt(chip.dataset.tagId);
        if (chip.dataset.active === '1') newSelectedIds.add(tid);
      });

      const toAdd = Array.from(newSelectedIds).filter(id => !currentTagIds.has(id));
      const toRemove = Array.from(currentTagIds).filter(id => !newSelectedIds.has(id));

      try {
        if (toAdd.length > 0) {
          await Admin.post('/tags/image/assign', { image_filenames: [filename], tag_ids: toAdd });
        }
        if (toRemove.length > 0) {
          await Admin.post('/tags/image/remove', { image_filenames: [filename], tag_ids: toRemove });
        }
        if (moved || toAdd.length > 0 || toRemove.length > 0) {
          Admin.toast('图片已更新', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('标签更新失败: ' + e.message, 'error');
      }
    });

    setTimeout(() => {
      document.getElementById('btn-copy-url')?.addEventListener('click', () => {
        const url = window.location.origin + (document.getElementById('edit-img-url')?.value || '');
        navigator.clipboard.writeText(url).then(() => Admin.toast('链接已复制', 'success'));
      });

      // 标签 chip 点击切换
      document.querySelectorAll('.edit-tag-chip').forEach(chip => {
        const tid = parseInt(chip.dataset.tagId);
        chip.dataset.active = currentTagIds.has(tid) ? '1' : '0';
        chip.addEventListener('click', () => {
          const isActive = chip.dataset.active === '1';
          if (isActive) {
            chip.dataset.active = '0';
            chip.style.background = 'transparent';
            chip.style.borderColor = 'var(--border)';
            chip.style.color = 'var(--text-primary)';
          } else {
            chip.dataset.active = '1';
            chip.style.background = 'var(--gold)';
            chip.style.borderColor = 'var(--gold)';
            chip.style.color = '#000';
          }
        });
      });
    }, 100);
  }

  async function batchTag() {
    if (selectedFiles.size === 0) return;
    const bodyHtml = `
      <p style="font-size:14px;margin-bottom:16px">为选中的 <b style="color:var(--gold)">${selectedFiles.size}</b> 张图片批量打标签：</p>
      <div class="form-group">
        <label>选择标签（可多选）</label>
        <div id="batch-tags-area" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);min-height:60px;max-height:220px;overflow-y:auto">
          ${allTags.length === 0 ? '<span style="font-size:12px;color:var(--text-muted)">暂无标签，请先在「标签管理」中创建</span>' : allTags.map(t =>
            `<span class="batch-tag-chip" data-tag-id="${t.id}" data-active="0" style="display:inline-block;padding:3px 8px;font-size:11px;border:1px solid var(--border);border-radius:10px;cursor:pointer;user-select:none;background:transparent;color:var(--text-primary)">${TAG_CATEGORY_LABELS[t.category]||t.category}: ${t.name}</span>`
          ).join('')}
        </div>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:4px">提示：已存在的标签关联会自动跳过，不会重复。</p>
    `;

    Admin.showModal('批量打标签', bodyHtml, async () => {
      const selectedTagIds = [];
      document.querySelectorAll('.batch-tag-chip').forEach(chip => {
        if (chip.dataset.active === '1') selectedTagIds.push(parseInt(chip.dataset.tagId));
      });
      if (selectedTagIds.length === 0) {
        Admin.toast('请至少选择一个标签', 'error');
        return;
      }
      try {
        const result = await Admin.post('/tags/image/assign', {
          image_filenames: Array.from(selectedFiles),
          tag_ids: selectedTagIds,
        });
        Admin.toast(`打标完成：新增 ${result.added} 个，跳过 ${result.skipped} 个已存在`, 'success');
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('批量打标失败: ' + e.message, 'error');
      }
    });

    setTimeout(() => {
      document.querySelectorAll('.batch-tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const isActive = chip.dataset.active === '1';
          if (isActive) {
            chip.dataset.active = '0';
            chip.style.background = 'transparent';
            chip.style.borderColor = 'var(--border)';
            chip.style.color = 'var(--text-primary)';
          } else {
            chip.dataset.active = '1';
            chip.style.background = 'var(--gold)';
            chip.style.borderColor = 'var(--gold)';
            chip.style.color = '#000';
          }
        });
      });
    }, 100);
  }

  async function batchMove() {
    if (selectedFiles.size === 0) return;
    function buildCatOpts(nodes, depth) {
      let html = '';
      nodes.forEach(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        html += `<option value="${n.path}">${prefix}${n.name}</option>`;
        if (n.children && n.children.length > 0) html += buildCatOpts(n.children, depth + 1);
      });
      return html;
    }
    const bodyHtml = `
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedFiles.size}</b> 张图片移动到：</p>
      <div class="form-group">
        <select id="batch-move-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
          ${buildCatOpts(categoryTree, 0)}
        </select>
      </div>
    `;

    Admin.showModal('批量移动', bodyHtml, async () => {
      const newCat = document.getElementById('batch-move-cat')?.value || '';
      let success = 0, fail = 0;
      for (const filename of selectedFiles) {
        const img = allImages.find(i => i.filename === filename);
        const cat = img?.category || '';
        if (cat === newCat) { success++; continue; }
        try {
          const fromQuery = cat ? `&from_category=${encodeURIComponent(cat)}` : '';
          await Admin.put(`/upload/image/${encodeURIComponent(filename)}/move?to_category=${encodeURIComponent(newCat)}${fromQuery}`);
          success++;
        } catch (e) {
          fail++;
          console.error(`移动 ${filename} 失败:`, e);
        }
      }
      Admin.toast(`移动完成: ${success} 张成功, ${fail} 张失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  async function batchDelete() {
    if (selectedFiles.size === 0) return;
    const confirmed = await Admin.confirm(`确定要删除选中的 ${selectedFiles.size} 张图片吗？\n图片将移入回收站，可稍后恢复。`);
    if (!confirmed) return;
    try {
      const filenames = Array.from(selectedFiles).join(',');
      const catQuery = currentCategory ? `&category=${encodeURIComponent(currentCategory)}` : '';
      const result = await Admin.del(`/upload/batch?filenames=${encodeURIComponent(filenames)}${catQuery}`);
      Admin.toast(`已移入回收站 ${result.count} 张图片`, 'success');
      await load();
    } catch (e) {
      Admin.toast('批量删除失败: ' + e.message, 'error');
    }
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await loadCategoryTree();
  await loadTags();
  await load();
}

Admin.registerPage('images', async (container) => {
  container.innerHTML = `
    <div class="img-tabs" style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px">
      <button class="img-tab active" data-tab="all">素材总览</button>
      <button class="img-tab" data-tab="gen">AI 生成图（按人物）</button>
      <button class="img-tab" data-tab="asset">上传目录</button>
    </div>
    <div id="img-tab-body"></div>`;
  const body = container.querySelector('#img-tab-body');
  let current = 'all';
  let assetRendered = false;

  async function show(tab) {
    current = tab;
    container.querySelectorAll('.img-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.style.color = on ? 'var(--gold)' : 'var(--text-muted)';
      b.style.borderBottom = on ? '2px solid var(--gold)' : '2px solid transparent';
    });
    body.innerHTML = '';
    if (tab === 'all') {
      if (window.AssetLibrary) await AssetLibrary.mount(body);
      else body.innerHTML = '<div class="table-empty">素材库模块未加载</div>';
    } else if (tab === 'asset') {
      // 素材图库每次进入都重新渲染（内容会变），但状态在同一个闭包里
      await renderAssetLibrary(body);
      assetRendered = true;
    } else if (window.GeneratedLibrary) {
      await GeneratedLibrary.mount(body);
    } else {
      body.innerHTML = '<div class="table-empty">生成图库模块未加载</div>';
    }
  }

  container.querySelectorAll('.img-tab').forEach((b) => {
    b.style.cssText += 'font-size:13px;padding:8px 16px;background:transparent;border:none;cursor:pointer';
    b.addEventListener('click', () => show(b.dataset.tab));
  });
  await show('all');
});
