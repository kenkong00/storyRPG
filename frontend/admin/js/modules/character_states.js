// ========== 人物状态管理模块（表情/战斗状态 + 绑定人物 + 系统类型与自定义分类合并） ==========
Admin.registerPage('character_states', async (container) => {
  const TYPE_MAP = { expression: '表情状态', battle: '战斗状态' };
  const TYPE_TAG_CLASS = { expression: 'tag-ally', battle: 'tag-choice' };
  const CHAR_TYPE_MAP = { player: '玩家', npc: 'NPC', enemy: '敌人', ally: '盟友' };
  // 表情类型（与 characters.js 表情图片编辑区保持一致）
  const EXP_TYPES = ['normal','happy','angry','sad','surprised','arrogant','defeated','jealous','regretful','crying','begging','confident','shocked','desperate','determined'];
  const EXP_LABELS = {'normal':'平静','happy':'微笑','angry':'愤怒','sad':'悲伤','surprised':'惊讶','arrogant':'狂傲','defeated':'战败','jealous':'妒忌','regretful':'悔恨','crying':'哭泣','begging':'求饶','confident':'自信','shocked':'震惊','desperate':'绝望','determined':'坚定'};
  // 战斗动作分组：单图动作用 "100" 作为 key，hurt 例外按 HP 百分比 5 档
  const BATTLE_ACTIONS = [
    { key: 'standing', label: '站立', pcts: ['100'] },
    { key: 'attack', label: '攻击', pcts: ['100'] },
    { key: 'defend', label: '防御', pcts: ['100'] },
    { key: 'cast', label: '施法', pcts: ['100'] },
    { key: 'ultimate', label: '神通大招', pcts: ['100'] },
    { key: 'hurt', label: '被攻击', pcts: ['80','60','40','20','5'] },
    { key: 'defeated', label: '战败', pcts: ['100'] },
  ];
  // 系统类型节点（与自定义分类合并显示在分类栏中）
  const SYSTEM_TYPE_NODES = [
    { value: 'expression', label: '表情状态' },
    { value: 'battle', label: '战斗状态' },
  ];

  let states = [], currentCategory = '', viewMode = 'list', selectedIds = new Set();
  let allItemsCache = [];        // 全部数据，用于分类计数
  let bindingCounts = {};        // 状态ID -> 绑定人物数
  let categoryBarInstance = null;
  let layoutInitialized = false;

  // 判断路径是否为系统类型节点路径
  function isTypePath(path) {
    return path && path.startsWith(CategoryBar.SYSTEM_TYPE_PREFIX);
  }
  function getTypeFromPath(path) {
    if (!isTypePath(path)) return '';
    return path.slice(CategoryBar.SYSTEM_TYPE_PREFIX.length);
  }

  async function load() {
    allItemsCache = await Admin.get('/character-states/');
    // 计算绑定人物数：优先用接口返回字段，否则逐个拉取 bindings
    bindingCounts = {};
    const hasApiField = allItemsCache.length > 0 && (
      allItemsCache[0].binding_count !== undefined || Array.isArray(allItemsCache[0].bindings)
    );
    if (hasApiField) {
      allItemsCache.forEach(s => {
        bindingCounts[s.id] = s.binding_count !== undefined
          ? s.binding_count
          : (Array.isArray(s.bindings) ? s.bindings.length : 0);
      });
    } else {
      await Promise.all(allItemsCache.map(async s => {
        try {
          const b = await Admin.get(`/character-states/${s.id}/bindings`);
          bindingCounts[s.id] = Array.isArray(b) ? b.length : 0;
        } catch { bindingCounts[s.id] = 0; }
      }));
    }
    applyClientFilter();
  }

  function applyClientFilter() {
    let filtered = allItemsCache;
    if (isTypePath(currentCategory)) {
      // 选中系统类型节点：按 state_type 筛选（忽略 category_path）
      const t = getTypeFromPath(currentCategory);
      filtered = filtered.filter(x => x.state_type === t);
    } else if (currentCategory) {
      // 选中自定义分类：只显示直接属于该分类的
      filtered = filtered.filter(x => x.category_path === currentCategory);
    } else {
      // 未分类：显示 category_path 为空
      filtered = filtered.filter(x => !x.category_path);
    }
    states = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(x => !x.category_path).length;
    if (isTypePath(path)) {
      const t = getTypeFromPath(path);
      return allItemsCache.filter(x => x.state_type === t).length;
    }
    return allItemsCache.filter(x => x.category_path === path).length;
  }

  function parseContent(c) {
    if (!c) return {};
    if (typeof c === 'object') return c;
    try { return JSON.parse(c); } catch { return {}; }
  }

  // 取 content 里第一张图作为预览
  function getFirstImage(content, stateType) {
    const obj = parseContent(content);
    if (!obj || typeof obj !== 'object') return '';
    if (stateType === 'expression') {
      for (const k of EXP_TYPES) if (obj[k]) return obj[k];
      for (const k in obj) if (obj[k]) return obj[k];
      return '';
    } else {
      for (const a of BATTLE_ACTIONS) {
        const sub = obj[a.key];
        if (sub && typeof sub === 'object') {
          for (const p of a.pcts) if (sub[p]) return sub[p];
        }
      }
      return '';
    }
  }

  function formatTime(t) {
    if (!t) return '-';
    return String(t).replace('T', ' ').substring(0, 16);
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="states-toolbar"></div>
      <div id="states-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'character_state', {
      label: '状态分类',
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
    const toolbar = document.getElementById('states-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${states.length} 个</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建状态</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (states.length === 0) {
      bodyHtml = '<div class="table-empty">暂无状态</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px">';
      states.forEach(s => {
        const checked = selectedIds.has(s.id) ? 'checked' : '';
        const thumb = getFirstImage(s.content, s.state_type);
        const imgHtml = thumb
          ? `<img src="${thumb}" style="width:100%;height:140px;object-fit:contain;border-radius:4px;margin-bottom:8px;background:var(--bg-input)">`
          : `<div style="width:100%;height:140px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">无图片</div>`;
        bodyHtml += `
          <div class="stat-card" style="padding:10px;text-align:center;position:relative">
            <input type="checkbox" class="item-checkbox" data-id="${s.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:13px;font-weight:500;margin-bottom:2px">${s.name}</div>
            <div style="font-size:11px;margin-bottom:4px">
              <span class="tag ${TYPE_TAG_CLASS[s.state_type] || ''}">${TYPE_MAP[s.state_type] || s.state_type}</span>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">绑定人物: ${bindingCounts[s.id] || 0}</div>
            <div style="display:flex;gap:4px;justify-content:center">
              <button class="btn btn-outline btn-sm btn-edit" data-id="${s.id}">编辑</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${s.id}" style="color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th>名称</th><th>类型</th><th>绑定人物</th><th>分类</th><th>更新时间</th><th style="width:180px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      states.forEach(s => {
        const checked = selectedIds.has(s.id) ? 'checked' : '';
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-id="${s.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${s.name}</td>
            <td><span class="tag ${TYPE_TAG_CLASS[s.state_type] || ''}">${TYPE_MAP[s.state_type] || s.state_type}</span></td>
            <td>${bindingCounts[s.id] || 0}</td>
            <td style="font-size:12px">${s.category_path || '-'}</td>
            <td style="font-size:12px">${formatTime(s.updated_at || s.update_time)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${s.id}">编辑</button>
                <button class="btn-edit btn-bind" data-id="${s.id}" style="color:var(--accent)">绑定人物</button>
                <button class="btn-del" data-id="${s.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    const bodyEl = document.getElementById('states-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('btn-view-grid')?.addEventListener('click', () => { viewMode = 'grid'; render(); });
    document.getElementById('btn-view-list')?.addEventListener('click', () => { viewMode = 'list'; render(); });
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
      if (e.target.checked) states.forEach(s => selectedIds.add(s.id));
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

    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个状态？`)) return;
      for (const id of selectedIds) {
        try { await Admin.del(`/character-states/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await load();
    });
    document.getElementById('btn-clear-selected')?.addEventListener('click', () => { if (selectedIds.size === 0) return; selectedIds.clear(); render(); });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = states.find(x => x.id === parseInt(btn.dataset.id));
        if (s) showForm(s);
      });
    });
    document.querySelectorAll('.btn-bind').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = states.find(x => x.id === parseInt(btn.dataset.id));
        if (s) showBindingsModal(s);
      });
    });
    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('确定删除该状态？')) return;
        try {
          await Admin.del(`/character-states/${id}`);
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
          await Admin.put(`/character-states/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  // 渲染单个图片选择格子
  function renderCellEl(action, pct, url, label) {
    return `
      <div style="border:1px solid var(--border);border-radius:6px;padding:8px;position:relative">
        <div style="font-size:11px;margin-bottom:4px;color:var(--text-muted)">${label}</div>
        <div class="content-img-area" data-action="${action}" data-pct="${pct}" data-url="${url || ''}" style="min-height:70px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden">
          ${url ? `<img src="${url}" style="max-width:100%;max-height:80px;object-fit:contain">` : `<span style="font-size:10px;color:var(--text-muted)">点击选择</span>`}
        </div>
        ${url ? `<button type="button" class="content-clear-btn" data-action="${action}" data-pct="${pct}" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:16px;height:16px;cursor:pointer;font-size:10px;line-height:1;padding:0">&times;</button>` : ''}
      </div>
    `;
  }

  function showForm(data = null) {
    const isEdit = !!data;
    let formContent = parseContent(data?.content);
    let currentStateType = data?.state_type || 'expression';

    const bodyHtml = `
      <div class="form-row">
        <div class="form-group">
          <label>名称 *</label>
          <input name="name" value="${data?.name || ''}" required>
        </div>
        <div class="form-group">
          <label>状态类型 *</label>
          <select name="state_type" id="state-type-select">
            <option value="expression" ${data?.state_type === 'expression' ? 'selected' : ''}>表情状态</option>
            <option value="battle" ${data?.state_type === 'battle' ? 'selected' : ''}>战斗状态</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="state-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label style="margin-bottom:8px">状态图片（点击格子选择图片，可上传）</label>
        <div id="content-editor-area">加载中...</div>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑状态' : '新建状态', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      const stateType = document.getElementById('state-type-select')?.value || currentStateType;
      if (!formData.name) { Admin.toast('请输入名称', 'error'); return; }
      // 按 state_type 收集 content 为 JSON
      let contentObj;
      if (stateType === 'expression') {
        contentObj = {};
        EXP_TYPES.forEach(k => { if (formContent[k]) contentObj[k] = formContent[k]; });
      } else {
        contentObj = {};
        BATTLE_ACTIONS.forEach(a => {
          const sub = formContent[a.key];
          if (sub && typeof sub === 'object') {
            const nonEmpty = {};
            a.pcts.forEach(p => { if (sub[p]) nonEmpty[p] = sub[p]; });
            if (Object.keys(nonEmpty).length > 0) contentObj[a.key] = nonEmpty;
          }
        });
      }
      formData.content = Object.keys(contentObj).length > 0 ? JSON.stringify(contentObj) : null;
      formData.state_type = stateType;
      try {
        if (isEdit) {
          await Admin.put(`/character-states/${data.id}`, formData);
          Admin.toast('状态已更新', 'success');
        } else {
          await Admin.post('/character-states/', formData);
          Admin.toast('状态已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });

    // 根据 state_type 动态渲染 content 编辑区
    function renderContentEditor(stateType) {
      const area = document.getElementById('content-editor-area');
      if (!area) return;
      const imgCategory = stateType === 'expression' ? 'characters/expression' : 'characters/battle';
      let html = '';
      if (stateType === 'expression') {
        html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
        EXP_TYPES.forEach(key => {
          html += renderCellEl(key, '100', formContent[key] || '', EXP_LABELS[key] || key);
        });
        html += '</div>';
      } else {
        BATTLE_ACTIONS.forEach(a => {
          const sub = (formContent[a.key] && typeof formContent[a.key] === 'object') ? formContent[a.key] : {};
          html += `<div style="margin-bottom:14px">`;
          html += `<div style="font-size:12px;color:var(--gold);margin-bottom:6px;font-weight:600">${a.label}${a.key === 'hurt' ? '（按HP百分比）' : ''}</div>`;
          html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
          a.pcts.forEach(p => {
            const label = a.key === 'hurt' ? `HP ${p}%` : a.label;
            html += renderCellEl(a.key, p, sub[p] || '', label);
          });
          html += '</div></div>';
        });
      }
      area.innerHTML = html;

      // 点击格子选择图片
      area.querySelectorAll('.content-img-area').forEach(cell => {
        cell.addEventListener('click', () => {
          const action = cell.dataset.action;
          const pct = cell.dataset.pct;
          const currentUrl = cell.dataset.url || '';
          Admin.Pickers.image({ multi: false, category: imgCategory, currentUrl, allowUpload: true })
            .then(url => {
              if (!url) return;
              if (stateType === 'expression') {
                formContent[action] = url;
              } else {
                if (!formContent[action] || typeof formContent[action] !== 'object') formContent[action] = {};
                formContent[action][pct] = url;
              }
              renderContentEditor(stateType);
              Admin.toast('已选择图片', 'success');
            });
        });
      });
      // 清除按钮
      area.querySelectorAll('.content-clear-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const pct = btn.dataset.pct;
          if (stateType === 'expression') {
            delete formContent[action];
          } else if (formContent[action]) {
            delete formContent[action][pct];
          }
          renderContentEditor(stateType);
        });
      });
    }

    setTimeout(async () => {
      // 加载自定义分类下拉选项
      try {
        const catData = await Admin.get('/resource-categories/character_state/tree');
        const catSelect = document.getElementById('state-category-select');
        if (catSelect) {
          const initialCat = data?.category_path || (currentCategory && !isTypePath(currentCategory) ? currentCategory : '') || '';
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

      // 渲染 content 编辑区
      renderContentEditor(currentStateType);

      // 状态类型切换时重新渲染 content 编辑区
      const typeSelect = document.getElementById('state-type-select');
      if (typeSelect) {
        typeSelect.addEventListener('change', () => {
          currentStateType = typeSelect.value;
          renderContentEditor(currentStateType);
        });
      }
    }, 100);
  }

  // 绑定人物弹窗：多选人物，保存调用批量替换接口
  function showBindingsModal(state) {
    const bodyHtml = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">提示：一套状态可指定给角色A或角色B使用。勾选要绑定此状态的人物，保存后生效。</p>
      <div id="bindings-list" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--bg-input)">加载中...</div>
      <div id="bindings-count" style="font-size:12px;color:var(--gold);margin-top:8px"></div>
    `;
    Admin.showModal(`绑定人物 - ${state.name}`, bodyHtml, async () => {
      const checked = Array.from(document.querySelectorAll('.binding-char-cb:checked')).map(cb => parseInt(cb.value));
      try {
        await Admin.post(`/character-states/${state.id}/bindings/batch`, { character_ids: checked });
        Admin.toast(`已绑定 ${checked.length} 个人物`, 'success');
        Admin.closeModal();
        await load();
      } catch (e) { Admin.toast('保存绑定失败: ' + e.message, 'error'); }
    });

    setTimeout(async () => {
      try {
        const [allChars, bindings] = await Promise.all([
          Admin.get('/characters'),
          Admin.get(`/character-states/${state.id}/bindings`),
        ]);
        const boundIds = new Set(bindings.map(b => b.character_id));
        const list = document.getElementById('bindings-list');
        if (!list) return;
        if (allChars.length === 0) {
          list.innerHTML = '<div class="table-empty">暂无人物</div>';
        } else {
          list.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px">' + allChars.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;${boundIds.has(c.id) ? 'background:rgba(212,175,55,0.1)' : ''}">
              <input type="checkbox" class="binding-char-cb" value="${c.id}" ${boundIds.has(c.id) ? 'checked' : ''} style="accent-color:var(--gold)">
              ${c.portrait_image
                ? `<img src="${c.portrait_image}" style="width:28px;height:28px;border-radius:4px;object-fit:cover">`
                : `<div style="width:28px;height:28px;background:var(--bg-card);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-muted)">人</div>`}
              <span style="font-size:13px">${c.name}</span>
              <span class="tag tag-${c.character_type}" style="font-size:10px">${CHAR_TYPE_MAP[c.character_type] || c.character_type}</span>
            </label>
          `).join('') + '</div>';
        }
        const updateCount = () => {
          const n = document.querySelectorAll('.binding-char-cb:checked').length;
          const el = document.getElementById('bindings-count');
          if (el) el.textContent = `已选 ${n} 个人物`;
        };
        updateCount();
        document.querySelectorAll('.binding-char-cb').forEach(cb => cb.addEventListener('change', updateCount));
      } catch (e) {
        const list = document.getElementById('bindings-list');
        if (list) list.innerHTML = `<div class="table-empty" style="color:var(--red)">加载失败: ${e.message}</div>`;
      }
    }, 100);
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});
