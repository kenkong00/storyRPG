// ========== 声音管理模块 ==========
Admin.registerPage('sounds', async (container) => {
  let sounds = [], selectedIds = new Set();
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;
  let allItemsCache = []; // 全部数据，用于分类计数
  let currentFilterCat = ''; // voice/bgm 客户端筛选

  async function load() {
    allItemsCache = await Admin.get('/sounds/');
    applyClientFilter();
  }

  function applyClientFilter() {
    let filtered = currentCategory
      ? allItemsCache.filter(x => x.category_path === currentCategory)
      : allItemsCache.filter(x => !x.category_path);
    if (currentFilterCat) {
      filtered = filtered.filter(x => x.category === currentFilterCat);
    }
    sounds = filtered;
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
      <div id="sounds-toolbar"></div>
      <div id="sounds-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'sound', {
      label: '声音分类',
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
    const toolbar = document.getElementById('sounds-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${sounds.length} 个声音</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <select id="filter-category" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">
            <option value="" ${currentFilterCat === '' ? 'selected' : ''}>全部分类</option>
            <option value="voice" ${currentFilterCat === 'voice' ? 'selected' : ''}>人声</option>
            <option value="bgm" ${currentFilterCat === 'bgm' ? 'selected' : ''}>背景音乐</option>
          </select>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 上传声音</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (sounds.length === 0) {
      bodyHtml = '<div class="table-empty">暂无声音</div>';
    } else {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px">';
      sounds.forEach(s => {
        const checked = selectedIds.has(s.id) ? 'checked' : '';
        const catLabel = s.category === 'bgm' ? '背景音乐' : '人声';
        const formatLabel = s.file_format ? s.file_format.toUpperCase() : '';
        bodyHtml += `
          <div class="stat-card" style="padding:14px;position:relative">
            <input type="checkbox" class="item-checkbox" data-id="${s.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            <div style="font-size:28px;text-align:center;margin:8px 0">${s.category === 'bgm' ? '&#9835;' : '&#128266;'}</div>
            <div style="font-size:13px;font-weight:500;text-align:center;margin-bottom:4px">${s.name}</div>
            <div style="text-align:center;margin-bottom:6px">
              <span class="tag tag-${s.category === 'bgm' ? 'player' : 'npc'}">${catLabel}</span>
              ${formatLabel ? `<span class="tag tag-item">${formatLabel}</span>` : ''}
            </div>
            <div style="font-size:10px;color:var(--text-muted);text-align:center;margin-bottom:8px">${s.description || ''}</div>
            <div style="display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm btn-preview" data-url="${s.file_url}" style="font-size:10px;padding:2px 8px">&#9654; 试听</button>
              <button class="btn btn-outline btn-sm btn-edit" data-id="${s.id}" style="font-size:10px;padding:2px 8px">编辑</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${s.id}" style="font-size:10px;padding:2px 8px;color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    }

    const bodyEl = document.getElementById('sounds-body');
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

    const filterCat = document.getElementById('filter-category');
    if (filterCat) {
      filterCat.addEventListener('change', () => {
        currentFilterCat = filterCat.value;
        applyClientFilter();
      });
    }

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
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个声音？`)) return;
      for (const id of selectedIds) {
        try { await Admin.del(`/sounds/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      selectedIds.clear();
      render();
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = sounds.find(x => x.id === parseInt(btn.dataset.id));
        if (s) showForm(s);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Admin.confirm('确定删除此声音？')) return;
        await Admin.del(`/sounds/${btn.dataset.id}`);
        Admin.toast('已删除', 'success');
        await load();
      });
    });

    // 试听功能
    document.querySelectorAll('.btn-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const existing = document.getElementById('audio-preview-player');
        if (existing) existing.remove();

        const player = document.createElement('div');
        player.id = 'audio-preview-player';
        player.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
        player.innerHTML = `
          <audio controls autoplay style="width:280px;height:36px">
            <source src="${url}" type="audio/mpeg">
            <source src="${url}" type="audio/ogg">
            <source src="${url}" type="audio/wav">
          </audio>
          <button class="btn btn-outline btn-sm" id="close-preview-player" style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;padding:0;border-radius:50%;font-size:12px;line-height:1">&times;</button>
        `;
        document.body.appendChild(player);
        document.getElementById('close-preview-player').addEventListener('click', () => player.remove());
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
          await Admin.put(`/sounds/${id}`, { category_path: newCat });
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
        <select name="category_path" id="sound-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>分类</label>
          <select name="category">
            <option value="voice" ${data?.category === 'voice' ? 'selected' : ''}>人声</option>
            <option value="bgm" ${data?.category === 'bgm' ? 'selected' : ''}>背景音乐</option>
          </select>
        </div>
        <div class="form-group">
          <label>文件格式</label>
          <select name="file_format">
            <option value="mp3" ${data?.file_format === 'mp3' ? 'selected' : ''}>MP3</option>
            <option value="wav" ${data?.file_format === 'wav' ? 'selected' : ''}>WAV</option>
            <option value="ogg" ${data?.file_format === 'ogg' ? 'selected' : ''}>OGG</option>
            <option value="flac" ${data?.file_format === 'flac' ? 'selected' : ''}>FLAC</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>文件路径/URL *</label>
        <input name="file_url" value="${data?.file_url || ''}" placeholder="如: /sounds/bgm_001.mp3" required>
      </div>
      <div class="form-group">
        <label>文件系统路径</label>
        <input name="file_path" value="${data?.file_path || ''}">
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
      ${data?.file_url ? `
        <div class="form-group">
          <label>当前试听</label>
          <audio controls style="width:100%"><source src="${data.file_url}"></audio>
        </div>
      ` : ''}
    `;

    Admin.showModal(isEdit ? '编辑声音' : '上传声音', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      formData.file_path = formData.file_path || formData.file_url;
      try {
        if (isEdit) {
          await Admin.put(`/sounds/${data.id}`, formData);
          Admin.toast('声音已更新', 'success');
        } else {
          await Admin.post('/sounds/', formData);
          Admin.toast('声音已创建', 'success');
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
        const catData = await Admin.get('/resource-categories/sound/tree');
        const catSelect = document.getElementById('sound-category-select');
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