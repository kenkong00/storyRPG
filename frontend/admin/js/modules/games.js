// ========== 游戏设置模块（分类栏+批量操作+网格/列表视图+表单+按钮配置+可选玩家） ==========
Admin.registerPage('games', async (container) => {
  const ACTION_TYPE_MAP = {
    start: '开始游戏', load: '读取存档', save: '保存',
    new_char: '新建人物', exit: '退出', custom: '自定义',
  };
  // 系统类型节点（与自定义分类合并显示在分类栏中）
  const SYSTEM_TYPE_NODES = [
    { value: 'published', label: '已发布' },
    { value: 'carousel', label: '轮播中' },
    { value: 'coming_soon', label: '即将发布' },
  ];
  let games = [], currentCategory = '', viewMode = 'list', selectedIds = new Set();
  let allItemsCache = []; // 全部数据，用于分类计数
  let categoryBarInstance = null;
  let layoutInitialized = false;

  async function load() {
    allItemsCache = await Admin.get('/games/');
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
      const t = getTypeFromPath(currentCategory);
      if (t === 'published') filtered = filtered.filter(x => x.is_published === 1);
      else if (t === 'carousel') filtered = filtered.filter(x => x.is_carousel === 1);
      else if (t === 'coming_soon') filtered = filtered.filter(x => x.is_coming_soon === 1);
    } else if (currentCategory) {
      // 选中自定义分类：只显示直接属于该分类的（不包含子分类）
      filtered = filtered.filter(x => x.category_path === currentCategory);
    } else {
      // 未分类：显示没有 category_path 的游戏
      filtered = filtered.filter(x => !x.category_path);
    }
    games = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(x => !x.category_path).length;
    if (isTypePath(path)) {
      const t = getTypeFromPath(path);
      if (t === 'published') return allItemsCache.filter(x => x.is_published === 1).length;
      if (t === 'carousel') return allItemsCache.filter(x => x.is_carousel === 1).length;
      if (t === 'coming_soon') return allItemsCache.filter(x => x.is_coming_soon === 1).length;
      return 0;
    }
    return allItemsCache.filter(x => x.category_path === path).length;
  }

  function yesNoTag(val) {
    return val ? '<span class="tag tag-ally">是</span>' : '<span class="tag tag-common">否</span>';
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="games-toolbar"></div>
      <div id="games-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'game', {
      label: '游戏分类',
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

  function render() {
    initLayout();
    if (categoryBarInstance) {
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('games-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${games.length} 个</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建游戏</button>
        </div>
      `;
    }

    let bodyHtml = '';
    if (games.length === 0) {
      bodyHtml = '<div class="table-empty">暂无游戏</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">';
      games.forEach(g => {
        const checked = selectedIds.has(g.id) ? 'checked' : '';
        const imgHtml = g.image
          ? `<img src="${g.image}" style="width:100%;height:140px;object-fit:cover;border-radius:4px;margin-bottom:8px">`
          : `<div style="width:100%;height:140px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">无封面</div>`;
        const badges = [];
        if (g.is_published) badges.push('<span class="tag tag-ally">已发布</span>');
        if (g.is_carousel) badges.push('<span class="tag tag-choice">轮播</span>');
        if (g.is_coming_soon) badges.push('<span class="tag tag-enemy">即将发布</span>');
        if (badges.length === 0) badges.push('<span class="tag tag-common">未发布</span>');
        bodyHtml += `
          <div class="stat-card" style="padding:10px;text-align:center;position:relative">
            <input type="checkbox" class="item-checkbox" data-id="${g.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:13px;font-weight:500;margin-bottom:4px">${g.name}</div>
            <div style="font-size:11px;margin-bottom:6px;min-height:18px">${badges.join(' ')}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">排序: ${g.sort_order ?? 0}</div>
            <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm btn-edit" data-id="${g.id}">编辑</button>
              <button class="btn btn-outline btn-sm btn-config" data-id="${g.id}">按钮配置</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${g.id}" style="color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th style="width:70px">封面图</th><th>名称</th><th>分类</th><th>发布</th><th>轮播</th><th>即将发布</th><th>排序</th><th style="width:200px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      games.forEach(g => {
        const checked = selectedIds.has(g.id) ? 'checked' : '';
        const imgHtml = g.image
          ? `<img src="${g.image}" style="width:48px;height:48px;object-fit:cover;border-radius:4px">`
          : `<div style="width:48px;height:48px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">无</div>`;
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-id="${g.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${imgHtml}</td>
            <td>${g.name}</td>
            <td style="font-size:12px;color:var(--text-muted)">${g.category_path || '-'}</td>
            <td>${yesNoTag(g.is_published)}</td>
            <td>${yesNoTag(g.is_carousel)}</td>
            <td>${yesNoTag(g.is_coming_soon)}</td>
            <td>${g.sort_order ?? 0}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${g.id}">编辑</button>
                <button class="btn-config" data-id="${g.id}">按钮配置</button>
                <button class="btn-del" data-id="${g.id}" style="color:var(--red)">删除</button>
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

    const bodyEl = document.getElementById('games-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
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
      if (e.target.checked) games.forEach(g => selectedIds.add(g.id));
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
    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个游戏？`)) return;
      let success = 0, fail = 0;
      for (const id of selectedIds) {
        try { await Admin.del(`/games/${id}`); success++; } catch { fail++; }
      }
      Admin.toast(`删除完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      await load();
    });
    document.getElementById('btn-clear-selected')?.addEventListener('click', () => { if (selectedIds.size === 0) return; selectedIds.clear(); render(); });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = games.find(x => x.id === parseInt(btn.dataset.id));
        if (g) showForm(g);
      });
    });

    document.querySelectorAll('.btn-config').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = games.find(x => x.id === parseInt(btn.dataset.id));
        if (g) showButtonConfig(g);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('确定删除该游戏？相关按钮和玩家配置也会被清除。')) return;
        try {
          await Admin.del(`/games/${id}`);
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
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedIds.size}</b> 个游戏移动到自定义分类：</p>
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
          await Admin.put(`/games/${id}`, { category_path: newCat });
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
        <label>宣传描述</label>
        <textarea name="description" rows="3">${data?.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="game-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div id="game-image-upload-area"></div>
      <div class="form-group">
        <label>封面图片路径 *</label>
        <input name="image" id="game_image_input" value="${data?.image || ''}" placeholder="如: /images/games/xxx.png">
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">游戏开始画面必须要有图片</span>
      </div>
      <div class="form-row" style="display:flex;gap:16px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" name="is_published" value="1" ${data?.is_published ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold)">是否前台发布
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" name="is_carousel" value="1" ${data?.is_carousel ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold)" id="game-is-carousel">是否首页轮播
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" name="is_coming_soon" value="1" ${data?.is_coming_soon ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold)">是否即将发布
        </label>
      </div>
      <div class="form-group">
        <label>排序值</label>
        <input name="sort_order" type="number" value="${data?.sort_order ?? 0}">
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">数值越小越靠前</span>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑游戏' : '新建游戏', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      // 修正复选框值（getFormData 默认取 checkbox.value 不准确）
      formData.is_published = document.querySelector('.modal-body [name="is_published"]')?.checked ? 1 : 0;
      formData.is_carousel = document.querySelector('.modal-body [name="is_carousel"]')?.checked ? 1 : 0;
      formData.is_coming_soon = document.querySelector('.modal-body [name="is_coming_soon"]')?.checked ? 1 : 0;
      // 图片必填校验
      if (!formData.image) {
        Admin.toast('游戏开始画面必须要有图片', 'error');
        return;
      }
      // 轮播校验
      if (formData.is_carousel === 1 && !formData.image) {
        Admin.toast('轮播游戏必须有图片', 'error');
        return;
      }
      try {
        if (isEdit) {
          await Admin.put(`/games/${data.id}`, formData);
          Admin.toast('游戏已更新', 'success');
        } else {
          await Admin.post('/games/', formData);
          Admin.toast('游戏已创建', 'success');
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
          const catData = await Admin.get('/resource-categories/game/tree');
          const catSelect = document.getElementById('game-category-select');
          if (catSelect) {
            const initialCat = data?.category_path || (!isTypePath(currentCategory) ? currentCategory : '') || '';
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

      const imgArea = document.getElementById('game-image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.image, (url) => {
          const inp = document.getElementById('game_image_input');
          if (inp) inp.value = url;
        }, 'games');
      }

      // 轮播勾选时提示
      const carouselCb = document.getElementById('game-is-carousel');
      carouselCb?.addEventListener('change', () => {
        if (carouselCb.checked) {
          const imgInput = document.getElementById('game_image_input');
          if (!imgInput?.value) {
            Admin.toast('轮播游戏必须要有图片，请先设置封面图', 'info');
          }
        }
      });
    }, 100);
  }

  // ===== 按钮配置弹窗（含可视化编辑器 + 可选玩家配置） =====
  function showButtonConfig(game) {
    let buttons = []; // 当前编辑中的按钮列表
    let originalButtonIds = []; // 原始按钮ID集合，用于检测删除
    let players = []; // 当前选中的角色ID列表
    let activatedPlayers = [];
    let chapters = [];
    const isComingSoon = game.is_coming_soon === 1;

    const bodyHtml = `
      <div id="gb-loading" style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>
      <div id="gb-content" style="display:none">
        <div style="display:flex;gap:12px;max-height:68vh">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">▶ 开始画面预览（按钮按位置百分比显示）</div>
            <div id="gb-preview-wrapper" style="position:relative;aspect-ratio:16/9;width:100%;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--bg-input)"></div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:8px">提示：右侧编辑位置/图片/可用性时预览会自动刷新</div>
          </div>
          <div style="flex:1;min-width:0;overflow-y:auto;max-height:68vh;padding-right:4px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:13px;font-weight:600;color:var(--gold)">开始画面按钮</span>
              <button type="button" class="btn btn-primary btn-sm" id="btn-add-game-btn">+ 添加按钮</button>
            </div>
            ${isComingSoon ? '<div style="font-size:11px;color:var(--gold);background:rgba(201,168,76,0.1);padding:6px 8px;border-radius:4px;margin-bottom:8px">⚠ 即将发布游戏按钮默认不可用</div>' : ''}
            <div id="gb-btn-list"></div>

            <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:13px;font-weight:600;color:var(--gold)">可选玩家配置</span>
                <span id="gb-players-count" style="font-size:11px;color:var(--text-muted)">已选 0 个</span>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">每个游戏可指定不同的已激活玩家组合供用户选择</div>
              <div id="gb-players-area" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    Admin.showModal(`按钮配置 - ${game.name}`, bodyHtml, async () => {
      await saveAll();
    });

    // 拉宽模态框
    setTimeout(() => {
      const modal = document.querySelector('#modal-overlay .modal, .modal-overlay .modal');
      if (modal) {
        modal.style.maxWidth = '1100px';
        modal.style.width = '95%';
      }
      loadData();
    }, 50);

    async function loadData() {
      try {
        const [detail, actPlayers, chapList] = await Promise.all([
          Admin.get(`/games/${game.id}`),
          Admin.get('/characters/activated/players').catch(() => []),
          Admin.get('/story/chapters').catch(() => []),
        ]);
        buttons = (detail.buttons || []).map(b => ({ ...b }));
        originalButtonIds = buttons.map(b => b.id);
        players = (detail.player_options || []).map(o => o.character_id);
        activatedPlayers = actPlayers || [];
        chapters = chapList || [];
        document.getElementById('gb-loading').style.display = 'none';
        document.getElementById('gb-content').style.display = '';
        renderList();
        renderPreview();
        renderPlayers();
        bindGlobalEvents();
      } catch (e) {
        document.getElementById('gb-loading').innerHTML = `<div style="color:var(--red);font-size:12px">加载失败: ${e.message}</div>`;
      }
    }

    function renderPreview() {
      const wrapper = document.getElementById('gb-preview-wrapper');
      if (!wrapper) return;
      const bgStyle = game.image
        ? `background-image:url('${game.image}');background-size:cover;background-position:center;`
        : '';
      let html = '';
      if (!game.image) {
        html += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">游戏未设置封面图</div>';
      }
      buttons.forEach((b, i) => {
        const left = (b.position_x ?? 50) + '%';
        const top = (b.position_y ?? 50) + '%';
        const inner = b.image
          ? `<img src="${b.image}" style="max-width:80px;max-height:40px;object-fit:contain">`
          : `<span style="font-size:12px;color:#fff;background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:4px;white-space:nowrap">${b.label || '按钮'}</span>`;
        const disabledStyle = b.is_enabled === 0 ? ';opacity:0.4;filter:grayscale(1)' : '';
        html += `<div data-prev-idx="${i}" style="position:absolute;left:${left};top:${top};transform:translate(-50%,-50%);pointer-events:none${disabledStyle}">${inner}</div>`;
      });
      wrapper.style.cssText = `position:relative;aspect-ratio:16/9;width:100%;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--bg-input);${bgStyle}`;
      wrapper.innerHTML = html;
    }

    function renderList() {
      const listEl = document.getElementById('gb-btn-list');
      if (!listEl) return;
      if (buttons.length === 0) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:10px;text-align:center">暂无按钮，点击上方添加</div>';
        return;
      }
      listEl.innerHTML = buttons.map((b, i) => {
        const showChapter = b.action_type === 'start' || b.action_type === 'custom';
        const chapterOpts = '<option value="">-- 无 --</option>' + chapters.map(c =>
          `<option value="${c.id}" ${b.target_story_chapter_id === c.id ? 'selected' : ''}>${c.title || c.name || '#' + c.id}</option>`
        ).join('');
        return `
          <div class="game-btn-row" data-idx="${i}" style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;background:var(--bg-input)">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
              <input class="gb-label" value="${(b.label || '').replace(/"/g, '&quot;')}" placeholder="按钮文字" style="flex:1;padding:4px 8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:12px">
              <label style="font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="gb-enabled" ${b.is_enabled === 1 ? 'checked' : ''} style="accent-color:var(--gold)">可用</label>
              <button type="button" class="btn-del-btn-row btn btn-outline btn-sm" data-idx="${i}" style="color:var(--red);border-color:var(--red);padding:2px 8px">删除</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;font-size:11px">
              <div><label style="color:var(--text-muted)">位置 X%</label><input type="number" min="0" max="100" class="gb-x" value="${b.position_x ?? 50}" style="width:100%;padding:3px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--text-primary)"></div>
              <div><label style="color:var(--text-muted)">位置 Y%</label><input type="number" min="0" max="100" class="gb-y" value="${b.position_y ?? 50}" style="width:100%;padding:3px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--text-primary)"></div>
              <div><label style="color:var(--text-muted)">动作类型</label><select class="gb-action" style="width:100%;padding:3px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--text-primary)">${Object.entries(ACTION_TYPE_MAP).map(([k, v]) => `<option value="${k}" ${b.action_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
              <div><label style="color:var(--text-muted)">排序</label><input type="number" class="gb-sort" value="${b.sort_order ?? 0}" style="width:100%;padding:3px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--text-primary)"></div>
            </div>
            <div class="gb-chapter-row" style="margin-top:6px;${showChapter ? '' : 'display:none'}">
              <label style="font-size:11px;color:var(--text-muted)">目标故事章节</label>
              <select class="gb-chapter" style="width:100%;padding:3px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--text-primary)">${chapterOpts}</select>
            </div>
            <div style="margin-top:6px">
              <label style="font-size:11px;color:var(--text-muted)">按钮图片（可选，留空显示文字）</label>
              <div style="display:flex;gap:6px;align-items:center">
                <input class="gb-image" value="${(b.image || '').replace(/"/g, '&quot;')}" placeholder="/images/xxx.png" style="flex:1;padding:3px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--text-primary);font-size:11px">
                <button type="button" class="btn-pick-img btn btn-outline btn-sm" data-idx="${i}" style="padding:2px 8px">选图</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
      bindRowEvents();
    }

    function renderPlayers() {
      const area = document.getElementById('gb-players-area');
      if (!area) return;
      if (activatedPlayers.length === 0) {
        area.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">暂无已激活的玩家角色</div>';
        updatePlayersCount();
        return;
      }
      area.innerHTML = activatedPlayers.map(c => {
        const checked = players.includes(c.id);
        return `<label class="player-chip" data-cid="${c.id}" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid ${checked ? 'var(--gold)' : 'var(--border)'};border-radius:6px;cursor:pointer;background:${checked ? 'rgba(201,168,76,0.1)' : 'transparent'}">
          <input type="checkbox" class="player-cb" data-cid="${c.id}" ${checked ? 'checked' : ''} style="accent-color:var(--gold)">
          ${c.portrait_image ? `<img src="${c.portrait_image}" style="width:24px;height:24px;border-radius:3px;object-fit:cover">` : ''}
          <span style="font-size:12px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}${c.title ? ' · ' + c.title : ''}</span>
        </label>`;
      }).join('');
      updatePlayersCount();
      area.querySelectorAll('.player-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const cid = parseInt(cb.dataset.cid);
          if (cb.checked) { if (!players.includes(cid)) players.push(cid); }
          else { players = players.filter(x => x !== cid); }
          const chip = cb.closest('.player-chip');
          if (chip) {
            chip.style.borderColor = cb.checked ? 'var(--gold)' : 'var(--border)';
            chip.style.background = cb.checked ? 'rgba(201,168,76,0.1)' : 'transparent';
          }
          updatePlayersCount();
        });
      });
    }

    function updatePlayersCount() {
      const el = document.getElementById('gb-players-count');
      if (el) el.textContent = `已选 ${players.length} 个`;
    }

    function bindGlobalEvents() {
      document.getElementById('btn-add-game-btn')?.addEventListener('click', () => {
        // 同步已编辑的数据，再添加
        syncFromInputs();
        buttons.push({
          id: null, label: '新按钮', image: '', position_x: 50, position_y: 50,
          action_type: 'start', target_story_chapter_id: null,
          is_enabled: isComingSoon ? 0 : 1, sort_order: buttons.length,
        });
        renderList();
        renderPreview();
      });
    }

    function bindRowEvents() {
      document.querySelectorAll('.btn-del-btn-row').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          buttons.splice(idx, 1);
          renderList();
          renderPreview();
        });
      });

      document.querySelectorAll('.game-btn-row').forEach(row => {
        const idx = parseInt(row.dataset.idx);
        // 实时同步到数据并刷新预览（仅预览，不重新渲染输入行，避免失焦）
        row.querySelector('.gb-label')?.addEventListener('input', e => {
          if (buttons[idx]) { buttons[idx].label = e.target.value; renderPreview(); }
        });
        row.querySelector('.gb-x')?.addEventListener('input', e => {
          if (buttons[idx]) { buttons[idx].position_x = parseInt(e.target.value) || 0; renderPreview(); }
        });
        row.querySelector('.gb-y')?.addEventListener('input', e => {
          if (buttons[idx]) { buttons[idx].position_y = parseInt(e.target.value) || 0; renderPreview(); }
        });
        row.querySelector('.gb-sort')?.addEventListener('input', e => {
          if (buttons[idx]) buttons[idx].sort_order = parseInt(e.target.value) || 0;
        });
        row.querySelector('.gb-enabled')?.addEventListener('change', e => {
          if (buttons[idx]) { buttons[idx].is_enabled = e.target.checked ? 1 : 0; renderPreview(); }
        });
        row.querySelector('.gb-image')?.addEventListener('input', e => {
          if (buttons[idx]) { buttons[idx].image = e.target.value; renderPreview(); }
        });
        const actionSel = row.querySelector('.gb-action');
        actionSel?.addEventListener('change', e => {
          if (buttons[idx]) {
            buttons[idx].action_type = e.target.value;
            const showChapter = e.target.value === 'start' || e.target.value === 'custom';
            const chapterRow = row.querySelector('.gb-chapter-row');
            if (chapterRow) chapterRow.style.display = showChapter ? '' : 'none';
          }
        });
        row.querySelector('.gb-chapter')?.addEventListener('change', e => {
          if (buttons[idx]) buttons[idx].target_story_chapter_id = e.target.value ? parseInt(e.target.value) : null;
        });
        row.querySelector('.btn-pick-img')?.addEventListener('click', () => {
          if (!buttons[idx]) return;
          Admin.Pickers.image({ multi: false, category: 'games/button', currentUrl: buttons[idx].image || '', allowUpload: true })
            .then(url => {
              if (url) {
                buttons[idx].image = url;
                const inp = row.querySelector('.gb-image');
                if (inp) inp.value = url;
                renderPreview();
                Admin.toast('已选择按钮图片', 'success');
              }
            });
        });
      });
    }

    // 从输入框同步当前数据（保存前调用，确保最新值已收集）
    function syncFromInputs() {
      document.querySelectorAll('.game-btn-row').forEach(row => {
        const idx = parseInt(row.dataset.idx);
        const b = buttons[idx];
        if (!b) return;
        b.label = row.querySelector('.gb-label')?.value || '';
        b.image = row.querySelector('.gb-image')?.value || '';
        b.position_x = parseInt(row.querySelector('.gb-x')?.value) || 0;
        b.position_y = parseInt(row.querySelector('.gb-y')?.value) || 0;
        b.action_type = row.querySelector('.gb-action')?.value || 'start';
        b.sort_order = parseInt(row.querySelector('.gb-sort')?.value) || 0;
        b.is_enabled = row.querySelector('.gb-enabled')?.checked ? 1 : 0;
        const chapterVal = row.querySelector('.gb-chapter')?.value;
        b.target_story_chapter_id = chapterVal ? parseInt(chapterVal) : null;
      });
    }

    async function saveAll() {
      syncFromInputs();
      const currentIds = buttons.filter(b => b.id).map(b => b.id);
      const deletedIds = originalButtonIds.filter(id => !currentIds.includes(id));

      let ok = 0, fail = 0;
      // 1. 删除被移除的按钮
      for (const id of deletedIds) {
        try { await Admin.del(`/games/buttons/${id}`); } catch { fail++; }
      }
      // 2. 更新已有按钮 + 创建新按钮
      for (const b of buttons) {
        try {
          const payload = {
            label: b.label || '按钮',
            image: b.image || null,
            position_x: b.position_x,
            position_y: b.position_y,
            action_type: b.action_type,
            target_story_chapter_id: b.target_story_chapter_id || null,
            is_enabled: b.is_enabled,
            sort_order: b.sort_order,
          };
          if (b.id) {
            await Admin.put(`/games/buttons/${b.id}`, payload);
          } else {
            await Admin.post(`/games/${game.id}/buttons`, payload);
          }
          ok++;
        } catch (e) { fail++; }
      }
      // 3. 保存可选玩家（批量替换）
      try {
        await Admin.post(`/games/${game.id}/players/batch`, { character_ids: players });
      } catch (e) { fail++; }

      Admin.toast(`保存完成: ${ok} 个按钮成功${deletedIds.length > 0 ? `, 删除 ${deletedIds.length}` : ''}${fail > 0 ? `, ${fail} 失败` : ''}`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    }
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});
