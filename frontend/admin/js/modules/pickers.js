// ========== 统一选择器组件（图片/人物/装备/物品/词条/法器技能/动效） ==========
// 提供7种统一的"选择xxx的组件窗口"，所有选择器以弹窗形式弹出，
// 支持单选/多选、分类筛选、标签筛选、搜索、分页。
// 调用方式：Admin.Pickers.image({ multi:false, category:'characters/portrait' }).then(url => {...})
//           Admin.Pickers.character({ multi:true }).then(chars => {...})

Admin.Pickers = (function () {
  // ===== 公共样式与工具 =====
  const OVERLAY_STYLE = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  const DIALOG_STYLE = 'background:var(--bg-card);border-radius:12px;max-width:960px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,0.6)';
  const HEADER_STYLE = 'display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)';
  const BODY_STYLE = 'flex:1;overflow:auto;padding:16px 20px';
  const FOOTER_STYLE = 'display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-top:1px solid var(--border);gap:8px';
  const FILTER_STYLE = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px';
  const GRID_STYLE = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // 创建弹窗骨架
  function createDialog(title, options = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';
    overlay.style.cssText = OVERLAY_STYLE;
    const multi = !!options.multi;
    overlay.innerHTML = `
      <div class="picker-dialog" style="${DIALOG_STYLE}">
        <div class="picker-header" style="${HEADER_STYLE}">
          <h3 style="font-size:15px;margin:0">${esc(title)}</h3>
          <button class="btn btn-outline btn-sm picker-close" type="button">&times;</button>
        </div>
        <div class="picker-filter" style="${FILTER_STYLE}padding:16px 20px 0"></div>
        <div class="picker-body" style="${BODY_STYLE}"></div>
        <div class="picker-footer" style="${FOOTER_STYLE}">
          <span class="picker-info" style="font-size:12px;color:var(--text-muted)"></span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline btn-sm picker-cancel" type="button">取消</button>
            ${multi ? '<button class="btn btn-primary btn-sm picker-confirm" type="button" disabled>确定(0)</button>' : ''}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.picker-close').addEventListener('click', close);
    overlay.querySelector('.picker-cancel').addEventListener('click', close);

    return {
      overlay,
      body: overlay.querySelector('.picker-body'),
      filterArea: overlay.querySelector('.picker-filter'),
      info: overlay.querySelector('.picker-info'),
      confirmBtn: overlay.querySelector('.picker-confirm'),
      close,
    };
  }

  // 渲染标签筛选chip
  function renderTagChips(container, tags, selectedSet, onChange) {
    if (!tags || tags.length === 0) {
      container.innerHTML = '';
      return;
    }
    const grouped = {};
    tags.forEach(t => {
      const cat = t.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    });
    const catLabels = { character: '人物', item: '物品', scene: '场景', plot: '剧情' };
    let html = '<span style="font-size:11px;color:var(--text-muted)">标签:</span>';
    Object.entries(grouped).forEach(([cat, list]) => {
      list.forEach(t => {
        const active = selectedSet.has(t.id);
        const style = active
          ? 'background:var(--gold);border-color:var(--gold);color:#000'
          : 'background:transparent;border-color:var(--border);color:var(--text-primary)';
        html += `<span class="picker-tag-chip" data-tag-id="${t.id}" style="display:inline-block;padding:2px 8px;font-size:11px;border:1px solid;border-radius:10px;cursor:pointer;user-select:none;${style}">${esc(catLabels[cat] || cat)}: ${esc(t.name)}</span>`;
      });
    });
    if (selectedSet.size > 0) {
      html += '<button class="btn btn-outline btn-sm picker-clear-tags" type="button" style="font-size:10px;padding:1px 8px">清除</button>';
    }
    container.innerHTML = html + '<div style="flex:1"></div>';
    container.querySelectorAll('.picker-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tid = parseInt(chip.dataset.tagId);
        if (selectedSet.has(tid)) selectedSet.delete(tid);
        else selectedSet.add(tid);
        onChange();
      });
    });
    container.querySelector('.picker-clear-tags')?.addEventListener('click', () => {
      selectedSet.clear();
      onChange();
    });
  }

  // 通用选择核心：基于实体列表渲染网格
  function renderEntityGrid(body, items, opts) {
    // opts: { idKey, nameKey, imageKey, subtitle, selectedIds:Set, multi, onPick, onToggle, emptyText }
    const idKey = opts.idKey || 'id';
    const nameKey = opts.nameKey || 'name';
    const imageKey = opts.imageKey || 'image';
    if (!items || items.length === 0) {
      body.innerHTML = `<div class="table-empty">${opts.emptyText || '暂无数据'}</div>`;
      return;
    }
    let html = `<div style="${GRID_STYLE}">`;
    items.forEach(item => {
      const id = item[idKey];
      const name = item[nameKey] || '';
      const img = item[imageKey];
      const selected = opts.selectedIds && opts.selectedIds.has(id);
      const selStyle = selected ? 'border-color:var(--gold);background:rgba(212,175,55,0.1)' : 'border-color:var(--border)';
      const subtitle = opts.subtitle ? opts.subtitle(item) : '';
      const imgHtml = img
        ? `<img src="${esc(img)}" style="width:100%;height:90px;object-fit:cover;border-radius:4px;margin-bottom:4px" loading="lazy">`
        : `<div style="width:100%;height:90px;background:var(--bg-input);border-radius:4px;margin-bottom:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:11px">无图</div>`;
      html += `
        <div class="picker-item" data-id="${esc(id)}" style="border:2px solid ${selected ? 'var(--gold)' : 'var(--border)'};border-radius:6px;padding:6px;cursor:pointer;${selStyle}">
          ${imgHtml}
          <div style="font-size:12px;font-weight:500;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
          ${subtitle ? `<div style="font-size:10px;color:var(--text-muted)">${subtitle}</div>` : ''}
          ${opts.multi && selected ? '<div style="font-size:10px;color:var(--gold);margin-top:2px">✓ 已选</div>' : ''}
        </div>
      `;
    });
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.picker-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const numId = isNaN(id) ? id : Number(id);
        if (opts.multi) {
          if (opts.selectedIds.has(numId)) opts.selectedIds.delete(numId);
          else opts.selectedIds.add(numId);
          opts.onToggle && opts.onToggle();
        } else {
          opts.onPick && opts.onPick(numId, items.find(i => String(i[idKey]) === String(id)));
        }
      });
    });
  }

  // 通用实体选择器（人物/装备/物品/词条/技能/动效/场景）
  function pickEntity(config) {
    return new Promise((resolve) => {
      const dlg = createDialog(config.title, { multi: config.multi });
      let allItems = [];
      let filtered = [];
      const selectedIds = new Set();
      const selectedItems = [];
      // 预选
      if (config.multi && Array.isArray(config.preSelect) && config.preSelect.length > 0) {
        config.preSelect.forEach(id => selectedIds.add(id));
      }
      let searchKw = '';
      let currentTypeFilter = config.typeFilterDefault || '';
      let currentCatFilter = ''; // 自定义分类筛选

      // 类型筛选下拉 + 自定义分类筛选下拉
      const filterArea = dlg.filterArea;
      let filterHtml = '';
      if (config.typeFilters && config.typeFilters.length > 0) {
        filterHtml += `<select class="picker-type-filter" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">
          <option value="">全部${config.typeLabel || '类型'}</option>
          ${config.typeFilters.map(t => `<option value="${t.value}" ${t.value === currentTypeFilter ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>`;
      }
      // 自定义分类筛选下拉（如果配置了 resourceType）
      if (config.resourceType) {
        filterHtml += `<select class="picker-cat-filter" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px;max-width:200px">
          <option value="">全部分类</option>
        </select>`;
      }
      filterHtml += `<input class="picker-search" type="text" placeholder="搜索名称..." value="${esc(searchKw)}" style="flex:1;max-width:240px;padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">`;
      filterHtml += '<div class="picker-tag-area" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"></div>';
      filterArea.innerHTML = filterHtml;

      // 搜索框
      const searchInput = filterArea.querySelector('.picker-search');
      searchInput.addEventListener('input', () => {
        searchKw = searchInput.value.trim().toLowerCase();
        applyFilter();
      });
      // 类型筛选
      filterArea.querySelector('.picker-type-filter')?.addEventListener('change', (e) => {
        currentTypeFilter = e.target.value;
        applyFilter();
      });
      // 自定义分类筛选：加载分类树并绑定事件
      const catFilterSelect = filterArea.querySelector('.picker-cat-filter');
      if (catFilterSelect) {
        (async () => {
          try {
            const catData = await Admin.get(`/resource-categories/${config.resourceType}/tree`);
            let opts = '<option value="">全部分类</option>';
            function buildCatOpts(nodes, depth) {
              nodes.forEach(n => {
                const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
                opts += `<option value="${esc(n.path)}">${prefix}${esc(n.name)}</option>`;
                if (n.children && n.children.length > 0) buildCatOpts(n.children, depth + 1);
              });
            }
            buildCatOpts((catData.tree || []), 0);
            catFilterSelect.innerHTML = opts;
          } catch (e) {
            catFilterSelect.innerHTML = '<option value="">全部分类</option>';
          }
        })();
        catFilterSelect.addEventListener('change', (e) => {
          currentCatFilter = e.target.value;
          applyFilter();
        });
      }

      async function loadTags() {
        if (!config.tagEndpoint) return [];
        try {
          return await Admin.get(config.tagEndpoint);
        } catch (e) {
          return [];
        }
      }

      let allTags = [];
      let selectedTagIds = new Set();
      const tagArea = filterArea.querySelector('.picker-tag-area');

      function applyFilter() {
        filtered = allItems.filter(item => {
          // 类型筛选
          if (currentTypeFilter && item[config.typeField] !== currentTypeFilter) return false;
          // 自定义分类筛选（匹配该分类或其子分类）
          if (currentCatFilter) {
            const itemCat = item.category_path || '';
            if (itemCat !== currentCatFilter && !itemCat.startsWith(currentCatFilter + '/')) return false;
          }
          // 搜索
          if (searchKw) {
            const name = String(item[config.nameKey] || '').toLowerCase();
            if (!name.includes(searchKw)) return false;
          }
          // 标签筛选
          if (selectedTagIds.size > 0 && config.itemTagsField) {
            let itemTagIds = [];
            try {
              const raw = item[config.itemTagsField];
              itemTagIds = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
            } catch (e) {}
            const hasAny = itemTagIds.some(t => selectedTagIds.has(t));
            if (!hasAny) return false;
          }
          return true;
        });
        renderList();
        updateInfo();
      }

      function renderList() {
        renderEntityGrid(dlg.body, filtered, {
          idKey: config.idKey,
          nameKey: config.nameKey,
          imageKey: config.imageKey,
          subtitle: config.subtitle,
          selectedIds,
          multi: config.multi,
          emptyText: config.emptyText || '暂无数据',
          onPick: (id, item) => {
            dlg.close();
            resolve(config.multi ? [item] : item);
          },
          onToggle: () => {
            renderList();
            updateInfo();
          },
        });
      }

      function updateInfo() {
        if (config.multi) {
          const count = selectedIds.size;
          if (dlg.confirmBtn) {
            dlg.confirmBtn.disabled = count === 0;
            dlg.confirmBtn.textContent = `确定(${count})`;
          }
          dlg.info.textContent = `已选 ${count} 项 / 共 ${filtered.length} 项`;
        } else {
          dlg.info.textContent = `共 ${filtered.length} 项`;
        }
      }

      if (config.multi && dlg.confirmBtn) {
        dlg.confirmBtn.addEventListener('click', () => {
          // 收集已选完整对象
          const result = allItems.filter(it => selectedIds.has(it[config.idKey]));
          dlg.close();
          resolve(result);
        });
      }

      // 加载数据
      (async () => {
        dlg.body.innerHTML = '<div class="table-empty">加载中...</div>';
        try {
          const [items, tags] = await Promise.all([
            Admin.get(config.endpoint),
            loadTags(),
          ]);
          allItems = items;
          allTags = tags;
          // 渲染标签筛选
          if (tagArea && allTags.length > 0) {
            renderTagChips(tagArea, allTags, selectedTagIds, applyFilter);
          }
          applyFilter();
        } catch (e) {
          dlg.body.innerHTML = `<div class="table-empty" style="color:var(--red)">加载失败: ${esc(e.message)}</div>`;
        }
      })();
    });
  }

  // ===== 图片选择器 =====
  function pickImage(opts = {}) {
    // 统一走全局素材选择器（AI 出图 + 本地上传一处挑），见 modules/asset_picker.js
    // 单选取回「url 字符串」——所有调用点都是当字符串用的。
    if (window.AssetPicker) {
      return window.AssetPicker.open({
        multiple: !!opts.multi,
        kind: (window.Admin && Admin._kindFromCategory) ? Admin._kindFromCategory(opts.category) : '',
        currentUrl: opts.currentUrl || '',
        allowUpload: opts.allowUpload !== false,
        slotLabel: opts.slotLabel || '',
        subjectType: opts.subjectType || '',
        subjectId: opts.subjectId || null,
      }).then((r) => {
        if (!r) return opts.multi ? [] : null;
        return opts.multi ? r.map((a) => a.url) : r.url;
      });
    }
    return pickImageLegacy(opts);
  }

  function pickImageLegacy(opts = {}) {
    // opts: { multi, category, currentUrl, allowUpload:true }
    return new Promise((resolve) => {
      const allowUpload = opts.allowUpload !== false;
      const dlg = createDialog('选择图片', { multi: opts.multi });
      const selectedIds = new Set();        // 多选时使用filename作为key
      const selectedUrls = [];              // 多选结果（按选择顺序）
      let currentCategory = opts.category || '';
      let searchKw = '';
      let allTags = [];
      let selectedTagIds = new Set();
      let allImages = [];

      // 顶部筛选区
      const filterArea = dlg.filterArea;
      filterArea.innerHTML = `
        <select class="img-cat-filter" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px;max-width:200px">
          <option value="">全部分类</option>
        </select>
        <input class="img-search" type="text" placeholder="搜索文件名..." style="flex:1;max-width:240px;padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">
        ${allowUpload ? '<button class="btn btn-primary btn-sm img-upload-btn" type="button">+ 上传图片</button>' : ''}
        <div class="img-tag-area" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"></div>
      `;

      // 加载分类
      (async () => {
        const catSelect = filterArea.querySelector('.img-cat-filter');
        try {
          const catData = await Admin.get('/upload/categories-tree');
          let catHtml = '<option value="">全部分类</option>';
          function buildOptions(nodes, depth) {
            nodes.forEach(n => {
              const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
              catHtml += `<option value="${esc(n.path)}" ${n.path === currentCategory ? 'selected' : ''}>${prefix}${esc(n.name)}</option>`;
              if (n.children && n.children.length > 0) buildOptions(n.children, depth + 1);
            });
          }
          if (catData.tree && catData.tree.length > 0) {
            buildOptions(catData.tree, 0);
          } else {
            // 后端未提供分类树时回退
            catHtml += '<option value="__uncategorized__">未分类</option>';
          }
          catSelect.innerHTML = catHtml;
        } catch (e) {
          // 回退到固定分类
          catSelect.innerHTML = '<option value="">全部分类</option><option value="__uncategorized__">未分类</option>';
        }
        catSelect.value = currentCategory;
      })();

      filterArea.querySelector('.img-cat-filter').addEventListener('change', (e) => {
        currentCategory = e.target.value;
        loadImages();
      });
      filterArea.querySelector('.img-search').addEventListener('input', (e) => {
        searchKw = e.target.value.trim().toLowerCase();
        loadImages();
      });
      if (allowUpload) {
        filterArea.querySelector('.img-upload-btn').addEventListener('click', () => {
          openImageUploader(currentCategory, () => loadImages());
        });
      }

      const tagArea = filterArea.querySelector('.img-tag-area');

      async function loadTags() {
        try {
          allTags = await Admin.get('/tags/');
        } catch (e) {
          allTags = [];
        }
        if (allTags.length > 0) {
          renderTagChips(tagArea, allTags, selectedTagIds, loadImages);
        } else {
          tagArea.innerHTML = '';
        }
      }

      async function loadImages() {
        dlg.body.innerHTML = '<div class="table-empty">加载中...</div>';
        const params = [];
        if (currentCategory) params.push(`category=${encodeURIComponent(currentCategory)}`);
        if (selectedTagIds.size > 0) {
          params.push(`tag_ids=${encodeURIComponent(Array.from(selectedTagIds).join(','))}`);
          params.push('tag_match=any');
        }
        const query = params.length > 0 ? '?' + params.join('&') : '';
        try {
          const data = await Admin.get(`/upload/images${query}`);
          allImages = data.images;
          let list = allImages;
          if (searchKw) {
            list = list.filter(img => (img.filename || '').toLowerCase().includes(searchKw) || (img.original_name || '').toLowerCase().includes(searchKw));
          }
          renderImageList(list);
          updateInfo();
        } catch (e) {
          dlg.body.innerHTML = `<div class="table-empty" style="color:var(--red)">加载失败: ${esc(e.message)}</div>`;
        }
      }

      function renderImageList(images) {
        if (!images || images.length === 0) {
          dlg.body.innerHTML = '<div class="table-empty">暂无图片</div>';
          return;
        }
        let html = `<div style="${GRID_STYLE}">`;
        images.forEach(img => {
          const sel = opts.multi ? selectedIds.has(img.filename) : (opts.currentUrl && img.url === opts.currentUrl);
          const selStyle = sel ? 'border-color:var(--gold);background:rgba(212,175,55,0.1)' : 'border-color:var(--border)';
          html += `
            <div class="picker-img-item" data-url="${esc(img.url)}" data-filename="${esc(img.filename)}" style="border:2px solid ${sel ? 'var(--gold)' : 'var(--border)'};border-radius:6px;padding:4px;cursor:pointer;${selStyle}">
              <img src="${esc(img.url)}" style="width:100%;height:90px;object-fit:cover;border-radius:4px" loading="lazy">
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(img.filename)}">${esc(img.category_label || '未分类')}</div>
              ${opts.multi && sel ? '<div style="font-size:10px;color:var(--gold)">✓ 已选</div>' : ''}
            </div>
          `;
        });
        html += '</div>';
        dlg.body.innerHTML = html;
        dlg.body.querySelectorAll('.picker-img-item').forEach(el => {
          el.addEventListener('click', () => {
            const url = el.dataset.url;
            const filename = el.dataset.filename;
            if (opts.multi) {
              if (selectedIds.has(filename)) {
                selectedIds.delete(filename);
                const idx = selectedUrls.indexOf(url);
                if (idx >= 0) selectedUrls.splice(idx, 1);
              } else {
                selectedIds.add(filename);
                selectedUrls.push(url);
              }
              renderImageList(allImages.filter(img => searchKw ? (img.filename || '').toLowerCase().includes(searchKw) : true));
              updateInfo();
            } else {
              dlg.close();
              resolve({ url, filename });
            }
          });
        });
      }

      function updateInfo() {
        if (opts.multi) {
          const count = selectedIds.size;
          if (dlg.confirmBtn) {
            dlg.confirmBtn.disabled = count === 0;
            dlg.confirmBtn.textContent = `确定(${count})`;
          }
          dlg.info.textContent = `已选 ${count} 张 / 共 ${allImages.length} 张`;
        } else {
          dlg.info.textContent = `共 ${allImages.length} 张`;
        }
      }

      if (opts.multi && dlg.confirmBtn) {
        dlg.confirmBtn.addEventListener('click', () => {
          const result = selectedUrls.map(url => ({ url }));
          dlg.close();
          resolve(result);
        });
      }

      loadTags();
      loadImages();
    });
  }

  // ===== 图片上传浮层（拖拽 + 批量） =====
  function openImageUploader(defaultCategory = '', onDone) {
    const overlay = document.createElement('div');
    overlay.style.cssText = OVERLAY_STYLE + ';z-index:10001';
    overlay.innerHTML = `
      <div style="${DIALOG_STYLE};max-width:520px">
        <div style="${HEADER_STYLE}">
          <h3 style="font-size:15px;margin:0">上传图片</h3>
          <button class="btn btn-outline btn-sm upload-close" type="button">&times;</button>
        </div>
        <div style="${BODY_STYLE}">
          <div class="form-group">
            <label>选择分类</label>
            <select class="upload-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px"></select>
          </div>
          <div class="upload-zone" style="border:2px dashed var(--border);border-radius:8px;padding:30px;text-align:center;cursor:pointer;transition:all .2s">
            <div style="font-size:32px;color:var(--text-muted)">&#128228;</div>
            <p style="margin:8px 0 4px;font-size:13px">点击或拖拽图片到此处上传</p>
            <p style="font-size:11px;color:var(--text-muted);margin:0">支持 JPG/PNG/GIF/WebP，最大 10MB；多张批量直传</p>
          </div>
          <input type="file" class="upload-file-input" accept="image/*" multiple style="display:none">
          <div class="upload-preview" style="margin-top:12px"></div>
        </div>
        <div style="${FOOTER_STYLE}">
          <span class="upload-info" style="font-size:12px;color:var(--text-muted)"></span>
          <button class="btn btn-outline btn-sm upload-done" type="button">完成</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.upload-close').addEventListener('click', close);
    overlay.querySelector('.upload-done').addEventListener('click', () => { close(); onDone && onDone(); });

    // 加载分类树到下拉
    const catSelect = overlay.querySelector('.upload-cat');
    (async () => {
      try {
        const catData = await Admin.get('/upload/categories-tree');
        let html = '<option value="">未分类</option>';
        function buildOpts(nodes, depth) {
          nodes.forEach(n => {
            const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
            html += `<option value="${esc(n.path)}" ${n.path === defaultCategory ? 'selected' : ''}>${prefix}${esc(n.name)}</option>`;
            if (n.children && n.children.length > 0) buildOpts(n.children, depth + 1);
          });
        }
        if (catData.tree && catData.tree.length > 0) buildOpts(catData.tree, 0);
        catSelect.innerHTML = html;
        catSelect.value = defaultCategory;
      } catch (e) {
        catSelect.innerHTML = '<option value="">未分类</option>';
      }
    })();

    const uploadZone = overlay.querySelector('.upload-zone');
    const fileInput = overlay.querySelector('.upload-file-input');
    const preview = overlay.querySelector('.upload-preview');
    const info = overlay.querySelector('.upload-info');

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--gold)'; });
    uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = 'var(--border)'; });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--border)';
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    });
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      handleFiles(files);
      fileInput.value = '';
    });

    async function handleFiles(files) {
      if (!files || files.length === 0) return;
      const category = catSelect.value || '';
      let ok = 0;
      for (const f of files) {
        try {
          const res = await Admin.uploadFile(f, category);
          const item = document.createElement('div');
          item.style.cssText = 'display:inline-block;margin:4px;border:2px solid var(--gold);border-radius:4px;padding:2px';
          item.innerHTML = `<img src="${res.url}" style="width:80px;height:80px;object-fit:cover;border-radius:2px">`;
          preview.appendChild(item);
          ok++;
        } catch (e) {
          console.warn('上传失败', e);
        }
      }
      info.textContent = `成功上传 ${ok}/${files.length} 张`;
      if (ok > 0) Admin.toast(`已上传 ${ok} 张图片`, 'success');
    }
  }

  // ===== 各类选择器对外接口 =====
  return {
    // 图片选择器
    // 注意：pickImage 已经按约定直接返回结果（单选=url 字符串，多选=url 字符串数组），
    // 这里不能再套一层 .url —— 之前套过一次，字符串上取 .url 得到 undefined，
    // 表现为「选完图却什么都没变」（剧情节点列表改背景就是这么坏的）。
    image(opts = {}) {
      return pickImage(opts);
    },
    // 人物选择器
    character(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择人物（可多选）' : '选择人物',
        multi: opts.multi,
        endpoint: '/characters',
        idKey: 'id',
        nameKey: 'name',
        imageKey: 'portrait_image',
        resourceType: 'character',
        typeFilters: [
          { value: 'player', label: '玩家' },
          { value: 'npc', label: 'NPC' },
          { value: 'enemy', label: '敌人' },
          { value: 'ally', label: '盟友' },
        ],
        typeField: 'character_type',
        typeLabel: '类型',
        typeFilterDefault: opts.typeFilter || '',
        preSelect: opts.preSelect || [],
        subtitle: (c) => `${({ player: '玩家', npc: 'NPC', enemy: '敌人', ally: '盟友' })[c.character_type] || c.character_type} Lv.${c.level}`,
        emptyText: '暂无人物',
      });
    },
    // 装备选择器
    equipment(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择装备（可多选）' : '选择装备',
        multi: opts.multi,
        endpoint: '/equipments/',
        idKey: 'id',
        nameKey: 'name',
        imageKey: 'image',
        resourceType: 'equipment',
        typeFilters: [
          { value: 'weapon', label: '武器' },
          { value: 'head', label: '头部' },
          { value: 'shoulders', label: '肩部' },
          { value: 'chest', label: '胸甲' },
          { value: 'gloves', label: '手套' },
          { value: 'pants', label: '腿部' },
          { value: 'boots', label: '足部' },
          { value: 'artifact', label: '法宝' },
          { value: 'skill', label: '技能书' },
          { value: 'set', label: '套装' },
          { value: 'accessory', label: '配饰' },
        ],
        typeField: 'equipment_type',
        typeLabel: '类型',
        typeFilterDefault: opts.typeFilter || '',
        preSelect: opts.preSelect || [],
        subtitle: (e) => `${({ weapon:'武器', head:'头部', shoulders:'肩部', chest:'胸甲', gloves:'手套', pants:'腿部', boots:'足部', artifact:'法宝', skill:'技能书', set:'套装', accessory:'配饰' })[e.equipment_type] || e.equipment_type} · ${e.rarity || ''}`,
        emptyText: '暂无装备',
      });
    },
    // 物品选择器
    item(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择物品（可多选）' : '选择物品',
        multi: opts.multi,
        endpoint: '/items',
        idKey: 'id',
        nameKey: 'name',
        imageKey: 'image',
        resourceType: 'item',
        typeFilters: [
          { value: 'consumable', label: '消耗品' },
          { value: 'key_item', label: '关键物品' },
          { value: 'material', label: '材料' },
          { value: 'weapon', label: '武器' },
          { value: 'armor', label: '护甲' },
          { value: 'accessory', label: '配饰' },
        ],
        typeField: 'item_type',
        typeLabel: '类型',
        typeFilterDefault: opts.typeFilter || '',
        preSelect: opts.preSelect || [],
        subtitle: (i) => `${i.item_type || ''} · ${i.rarity || ''}`,
        emptyText: '暂无物品',
      });
    },
    // 装备词条选择器
    affix(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择装备词条（可多选）' : '选择装备词条',
        multi: opts.multi,
        endpoint: '/equipments/affixes',
        idKey: 'id',
        nameKey: 'name',
        imageKey: '_no_image_',
        resourceType: 'affix',
        preSelect: opts.preSelect || [],
        subtitle: (a) => `${a.is_special ? '★ 特殊' : '普通'} · ${a.effect_type || ''}`,
        emptyText: '暂无词条',
      });
    },
    // 法器技能选择器
    skill(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择法器技能（可多选）' : '选择法器技能',
        multi: opts.multi,
        endpoint: '/skills',
        idKey: 'id',
        nameKey: 'name',
        imageKey: 'image',
        resourceType: 'skill',
        preSelect: opts.preSelect || [],
        subtitle: (s) => `${s.skill_type || ''} · Lv.${s.level || 1}`,
        emptyText: '暂无技能',
      });
    },
    // 动效选择器
    animation(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择动效（可多选）' : '选择动效',
        multi: opts.multi,
        endpoint: '/animation-effects/',
        idKey: 'id',
        nameKey: 'name',
        imageKey: '_no_image_',
        resourceType: 'animation',
        preSelect: opts.preSelect || [],
        subtitle: (a) => `${a.effect_type || ''} · ${a.duration || 0}ms`,
        emptyText: '暂无动效',
      });
    },
    // 场景选择器
    scene(opts = {}) {
      return pickEntity({
        title: opts.multi ? '选择场景（可多选）' : '选择场景',
        multi: opts.multi,
        endpoint: '/scenes/',
        idKey: 'id',
        nameKey: 'name',
        imageKey: 'background_image',
        resourceType: 'scene',
        preSelect: opts.preSelect || [],
        subtitle: (s) => s.location || '',
        emptyText: '暂无场景',
      });
    },
    // 上传图片浮层（图片管理专用）
    uploadImage(defaultCategory, onDone) {
      return openImageUploader(defaultCategory, onDone);
    },
  };
})();
