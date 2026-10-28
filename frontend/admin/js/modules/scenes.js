// ========== 场景管理（全面改造：场景库 / 场景拼装 / 定义管理） ==========
// 核心变化：
//   1) 场景不再只是「一张背景图」，而是一套可拼装的提示词（地点 / 时间 / 天气 / 光线 / 构图…）；
//   2) 直接接 ComfyUI 出图，出图记录留在场景下，最新一张可设为封面；
//   3) 点场景卡直接进拼装页，和人物外观一样「左侧参数、右侧提示词」对照。
Admin.registerPage('scenes', async (container) => {
  const TYPE_MAP = { town: '城镇', forest: '森林', castle: '城堡', dungeon: '地下城', wilderness: '荒野', cave: '洞穴', battlefield: '战场' };
  const DEFAULT_W = 1344, DEFAULT_H = 768;

  let allScenes = [], scenes = [], currentCategory = '';
  let selectedIds = new Set();
  let defs = null, themes = [];
  let currentScene = null;
  const state = { appearance: {}, free: '', negative: '' };
  let promptTimer = null;
  let promptPos = '', promptNeg = '';
  let images = [];
  let categoryBar = null;
  let genPanelMounted = false;
  let activeDim = '';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  container.innerHTML = `
    <div class="sc-wrap">
      <div class="sc-tabs">
        <button class="sc-tab active" data-tab="library">场景库</button>
        <button class="sc-tab" data-tab="assembly">场景拼装</button>
        <button class="sc-tab" data-tab="manage">定义管理</button>
      </div>

      <div class="sc-pane active" id="sc-pane-library">
        <div id="sc-cat-host"></div>
        <div id="sc-toolbar" class="sc-toolbar"></div>
        <div id="sc-lib-body"></div>
      </div>

      <div class="sc-pane" id="sc-pane-assembly">
        <!-- 第 1 行：场景与操作（和人物编辑面板的摆放一致） -->
        <div class="sc-toolbar">
          <label class="sc-field"><span>当前场景</span>
            <select id="sc-scene" class="sc-sel" style="min-width:220px"></select>
          </label>
          <button class="sc-btn" id="sc-new">＋ 新建场景</button>
          <button class="sc-btn" id="sc-edit-basic">基础属性</button>
          <button class="sc-btn" id="sc-save-cfg">💾 保存拼装</button>
          <label class="sc-field"><span>场景方案（选后随机只在这类里）</span>
            <select id="sc-theme" class="sc-sel"><option value="">全部 / 不限定</option></select>
          </label>
          <button class="sc-btn" id="sc-random">🎲 整体随机</button>
          <span class="grow"></span>
          <span id="sc-hint" style="font-size:12.5px;color:var(--text-muted)">选择场景后可以保存与出图</span>
        </div>

        <!-- 第 2 行：全局出图参数（常显，不再藏进折叠里） -->
        <div id="sc-genbox" style="margin-bottom:10px"><div id="sc-gen-params"></div></div>

        <!-- 第 3 行：外观配置（晴天 / 雨天 / 夜晚…） + 出图按钮 -->
        <div class="sc-toolbar" style="margin-bottom:10px">
          <span class="sc-field" style="flex:0 0 auto"><span>外观配置</span></span>
          <div id="sc-app-list" class="sc-app-list"></div>
          <button class="sc-btn primary" id="sc-render">🖼 按当前配置出图</button>
          <span id="sc-render-status" style="font-size:12px;color:var(--text-muted);max-width:320px;line-height:1.5"></span>
        </div>

        <div class="sc-assembly">
          <div class="sc-panel">
            <div class="sc-panel-h">
              <span>场景拼装维度</span>
              <span class="sp"><span style="font-size:12px;color:var(--text-muted);font-weight:400">改任意一项，右侧提示词实时更新</span></span>
            </div>
            <div class="sc-groups" id="sc-groups" style="padding:10px"></div>
          </div>

          <div class="sc-side">
            <div class="sc-panel">
              <div class="sc-panel-h"><span>场景提示词</span>
                <span class="sp"><button class="sc-btn" id="sc-copy" style="font-size:11.5px;padding:3px 9px">复制</button></span>
              </div>
              <textarea class="sc-prompt" id="sc-prompt" spellcheck="false"
                placeholder="提示词会显示在这里，可直接修改；改完出图就用这段"></textarea>
            </div>

            <div class="sc-panel">
              <div class="sc-panel-h"><span>自由提示词 / 负面</span></div>
              <div style="padding:9px 10px">
                <textarea id="sc-free" class="sc-ta" placeholder="补充画面内容，例如：远处有一座亮着灯的塔，空中飘着纸灯笼…"></textarea>
                <div style="font-size:11.5px;color:var(--text-muted);margin:7px 0 3px">负面提示词（留空用默认：不要人物 / 文字 / 水印）</div>
                <textarea id="sc-neg" class="sc-ta" style="min-height:46px" placeholder="低质量, 模糊…"></textarea>
              </div>
            </div>

            <div class="sc-panel">
              <div class="sc-panel-h"><span>出图结果</span>
                <span class="sp" style="font-size:12px;color:var(--text-muted)">
                  参数与出图按钮都在页面顶部
                </span>
              </div>
              <div style="padding:9px 10px">
              <div class="sc-result" id="sc-result">
                <div class="ph">还没有出图。<br>调好左侧参数后点顶部「按当前配置出图」。</div>
              </div>
              </div>
              <div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">出图记录（最新在前）</div>
              <div class="sc-gallery" id="sc-gallery" style="padding:0 10px 10px"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="sc-pane" id="sc-pane-manage">
        <div class="sc-toolbar">
          <button class="sc-btn" id="sc-mg-reset">恢复默认定义</button>
          <button class="sc-btn" id="sc-dim-add">＋ 新增维度</button>
          <button class="sc-btn" id="sc-group-add">＋ 新增分组</button>
          <span style="font-size:12.5px;color:var(--text-muted)">改动立即写盘，同时影响拼装下拉与场景提示词。</span>
        </div>
        <div class="sc-split">
          <div class="sc-list" id="sc-dim-tree"></div>
          <div class="sc-panel" id="sc-dim-editor">
            <div class="sc-empty">左侧选择一个维度开始编辑</div>
          </div>
        </div>
        <div style="margin-top:14px" class="sc-panel">
          <div class="sc-panel-h"><span>题材（定向随机包）</span>
            <span class="sp"><button class="sc-btn" id="sc-theme-add" style="font-size:11.5px;padding:3px 10px">＋ 新增题材</button></span>
          </div>
          <div id="sc-theme-list" style="padding:9px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px"></div>
        </div>
      </div>

      <!-- 场景卡弹窗：基础属性 + 场景拼装 两个选项卡 -->
      <div id="sc-card-modal" class="sc-modal" style="display:none">
        <div class="sc-modal-mask" id="sc-modal-mask"></div>
        <div class="sc-modal-box">
          <div class="sc-modal-h">
            <span id="sc-modal-title">场景</span>
            <span class="grow"></span>
            <button class="sc-close" id="sc-modal-close" title="关闭">✕</button>
          </div>
          <div class="sc-modal-tabs">
            <button class="sc-mtab" data-mtab="basic">基础属性</button>
            <button class="sc-mtab active" data-mtab="assembly">场景拼装</button>
          </div>
          <div class="sc-modal-body">
            <div class="sc-mpane" id="sc-modal-basic"></div>
            <div class="sc-mpane active" id="sc-modal-assembly"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => document.getElementById(id);

  // ==================== 通用小弹窗 ====================
  function prompt2(title, fields) {
    return new Promise((resolve) => {
      const body = fields.map(f => `
        <div style="margin-bottom:9px">
          <label style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:3px">${esc(f.label)}</label>
          ${f.type === 'textarea'
            ? `<textarea name="${f.name}" style="width:100%;min-height:70px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);padding:7px;font-size:13px">${esc(f.value || '')}</textarea>`
            : `<input name="${f.name}" value="${esc(f.value || '')}" style="width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);padding:7px;font-size:13px">`}
        </div>`).join('');
      Admin.showModal(title, body, () => {
        const data = {};
        document.querySelectorAll('.modal-body [name]').forEach(el => { data[el.name] = el.value; });
        Admin.closeModal();
        resolve(data);
      });
      setTimeout(() => {
        const b = document.querySelector('.modal-body input, .modal-body textarea');
        if (b) b.focus();
      }, 40);
    });
  }

  // ==================== Tab 切换 ====================
  function switchTab(name) {
    container.querySelectorAll('.sc-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    container.querySelectorAll('.sc-pane').forEach(p => p.classList.toggle('active', p.id === 'sc-pane-' + name));
    if (name === 'manage') loadManage();
    if (name === 'assembly') {
      renderGroups();
      if (currentScene) loadImages(currentScene.id);
    }
  }
  container.querySelectorAll('.sc-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ==================== 场景库 ====================
  async function loadLibrary() {
    allScenes = await Admin.get('/scenes/');
    applyCategory();
  }

  function applyCategory() {
    scenes = currentCategory
      ? allScenes.filter(x => x.category_path === currentCategory)
      : allScenes.filter(x => !x.category_path);
    selectedIds.clear();
    renderLibrary();
    refreshSceneSelect();
  }

  function countInCategory(path) {
    if (!path) return allScenes.filter(x => !x.category_path).length;
    return allScenes.filter(x => x.category_path === path).length;
  }

  function initCategoryBar() {
    if (categoryBar) return;
    const host = $('sc-cat-host');
    categoryBar = CategoryBar.mount(host, 'scene', {
      label: '场景分类',
      totalCount: 0,
      getCount: countInCategory,
      onSelect: (path) => { currentCategory = path || ''; applyCategory(); },
      onTreeChange: () => renderLibrary(),
    });
  }

  function renderLibrary() {
    initCategoryBar();
    if (categoryBar) categoryBar.setPath(currentCategory);
    const tb = $('sc-toolbar');
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:.45;cursor:not-allowed"' : '';
    tb.innerHTML = `
      <span style="font-size:13.5px;color:var(--text-muted)">共 ${scenes.length} 个场景</span>
      <span style="font-size:13.5px;color:var(--gold)">已选 ${selectedIds.size}</span>
      <button class="sc-btn" id="sc-move" ${batchAttr}>移动分类</button>
      <button class="sc-btn" id="sc-del-selected" ${batchAttr} style="color:var(--red)">删除选中</button>
      <span class="grow"></span>
      <button class="sc-btn primary" id="sc-add">＋ 新建场景</button>
    `;

    let folderHtml = categoryBar ? categoryBar.renderFolderCards() : '';
    let body = '';
    if (!scenes.length) {
      body = '<div class="sc-empty">这个分类下还没有场景。点右上角「新建场景」，或到「场景拼装」里先调一套提示词。</div>';
    } else {
      body = '<div class="sc-grid">' + scenes.map(s => {
        const checked = selectedIds.has(s.id) ? 'checked' : '';
        const img = s.background_image
          ? `<img src="${esc(s.background_image)}" alt="" loading="lazy">`
          : `<div class="none">还没有出图</div>`;
        return `<div class="sc-card" data-id="${s.id}">
          <input type="checkbox" class="item-checkbox" data-id="${s.id}" ${checked}
            style="position:absolute;top:8px;left:8px;z-index:3;width:17px;height:17px;accent-color:var(--gold);cursor:pointer">
          <div class="sc-card-ops">
            <button class="ch-icon-btn ch-del" data-del="${s.id}" title="删除场景">✕</button>
          </div>
          <div class="sc-card-img">${img}
            <span class="sc-card-badge">${TYPE_MAP[s.scene_type] || s.scene_type || '场景'}</span>
          </div>
          <div class="sc-card-body">
            <div class="sc-card-name">${esc(s.name)}</div>
            <div class="sc-card-meta">
              ${s.is_safe_zone ? '<span class="tag tag-ally">安全区</span>' : '<span class="tag tag-enemy">危险区</span>'}
              <span>${esc(s.parent_region || '未归属区域')}</span>
            </div>
            <div class="sc-card-desc">${esc(s.description || '还没有描述。点卡片进入拼装，给这个场景写提示词并出图。')}</div>
          </div>
        </div>`;
      }).join('') + '</div>';
    }
    const host = $('sc-lib-body');
    host.innerHTML = folderHtml + body;
    bindLibrary();
  }

  function bindLibrary() {
    $('sc-add')?.addEventListener('click', () => openBasic(null));
    $('sc-move')?.addEventListener('click', batchMove);
    $('sc-del-selected')?.addEventListener('click', batchDelete);
    container.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => {
        currentCategory = el.dataset.path || '';
        if (categoryBar) categoryBar.setPath(currentCategory);
        applyCategory();
      });
    });
    container.querySelectorAll('.item-checkbox').forEach(cb => {
      cb.addEventListener('click', e => e.stopPropagation());
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        renderLibrary();
      });
    });
    container.querySelectorAll('.sc-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('[data-del]') || e.target.classList.contains('item-checkbox')) return;
        const sc = allScenes.find(x => x.id === parseInt(card.dataset.id));
        if (sc) openCardModal(sc);
      });
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.del);
        if (!await Admin.confirm('确定删除这个场景？关联的出图记录也会一起删掉。')) return;
        try {
          await Admin.del(`/scenes/${id}`);
          if (currentScene && currentScene.id === id) currentScene = null;
          Admin.toast('场景已删除', 'success');
          await loadLibrary();
        } catch (err) { Admin.toast('删除失败：' + err.message, 'error'); }
      });
    });
  }

  async function batchMove() {
    if (!selectedIds.size) return;
    const tree = categoryBar ? categoryBar.getTree() : [];
    const opts = [];
    (function walk(nodes, depth) {
      nodes.forEach(n => {
        opts.push(`<option value="${esc(n.path)}">${'　'.repeat(depth)}${esc(n.name)}</option>`);
        if (n.children) walk(n.children, depth + 1);
      });
    })(tree, 0);
    const body = `<div class="form-group"><label>目标分类</label>
      <select id="sc-move-cat" style="width:100%;padding:8px 10px;background:var(--bg-input);
        border:1px solid var(--border);border-radius:4px;color:var(--text-primary)">
        <option value="">-- 未分类 --</option>${opts.join('')}
      </select></div>`;
    Admin.showModal('移动场景分类', body, async () => {
      const cat = document.getElementById('sc-move-cat')?.value || '';
      let ok = 0;
      for (const id of selectedIds) {
        try { await Admin.put(`/scenes/${id}`, { category_path: cat }); ok++; } catch (_) {}
      }
      Admin.toast(`已移动 ${ok} 个场景`, ok ? 'success' : 'error');
      Admin.closeModal();
      await loadLibrary();
    });
  }

  async function batchDelete() {
    if (!selectedIds.size) return;
    if (!await Admin.confirm(`删除选中的 ${selectedIds.size} 个场景？出图记录会一起删除。`)) return;
    let ok = 0;
    for (const id of selectedIds) {
      try { await Admin.del(`/scenes/${id}`); ok++; } catch (_) {}
    }
    Admin.toast(`已删除 ${ok} 个场景`, ok ? 'success' : 'error');
    await loadLibrary();
  }

  // ==================== 基础属性弹窗 ====================
  function openBasic(sc, afterSave) {
    const isEdit = !!sc;
    const body = `
      <div class="sc-toolbar" style="margin-bottom:10px">
        <label class="sc-field" style="flex:1 1 220px"><span>场景名称 *</span>
          <input id="scb-name" class="sc-inp" value="${esc(sc?.name || '')}"></label>
        <label class="sc-field"><span>类型</span>
          <select id="scb-type" class="sc-sel">
            ${Object.entries(TYPE_MAP).map(([k, v]) => `<option value="${k}" ${sc?.scene_type === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></label>
        <label class="sc-field"><span>安全区</span>
          <select id="scb-safe" class="sc-sel">
            <option value="0" ${!sc?.is_safe_zone ? 'selected' : ''}>危险区</option>
            <option value="1" ${sc?.is_safe_zone ? 'selected' : ''}>安全区</option>
          </select></label>
      </div>
      <div class="sc-toolbar" style="margin-bottom:10px">
        <label class="sc-field" style="flex:1 1 200px"><span>所属区域</span>
          <input id="scb-region" class="sc-inp" value="${esc(sc?.parent_region || '')}"></label>
        <label class="sc-field" style="flex:1 1 200px"><span>自定义分类</span>
          <select id="scb-cat" class="sc-sel"><option value="">-- 未分类 --</option></select></label>
        <label class="sc-field"><span>坐标 JSON</span>
          <input id="scb-coord" class="sc-inp" value="${esc(sc?.coordinates || '{"x":0,"y":0}')}"></label>
      </div>
      <div class="sc-field" style="margin-bottom:10px"><span>场景描述</span>
        <textarea id="scb-desc" class="sc-ta">${esc(sc?.description || '')}</textarea></div>
      <div id="scb-img"></div>
      <input type="hidden" id="scb-img-value" value="${esc(sc?.background_image || '')}">
    `;
    Admin.showModal(isEdit ? '编辑场景 · 基础属性' : '新建场景', body, async () => {
      const name = $('scb-name').value.trim();
      if (!name) { Admin.toast('请填写场景名称', 'error'); return; }
      const payload = {
        name,
        scene_type: $('scb-type').value,
        description: $('scb-desc').value,
        parent_region: $('scb-region').value,
        is_safe_zone: parseInt($('scb-safe').value),
        coordinates: $('scb-coord').value,
        category_path: $('scb-cat').value || null,
        background_image: $('scb-img-value').value || null,
      };
      try {
        let rec;
        if (isEdit) { rec = await Admin.put(`/scenes/${sc.id}`, payload); Admin.toast('场景已更新', 'success'); }
        else { rec = await Admin.post('/scenes', payload); Admin.toast('场景已创建，接着拼装并出图吧', 'success'); }
        Admin.closeModal();
        await loadLibrary();
        if (rec) {
          if (afterSave) afterSave(rec);
          else if (!isEdit) openAssembly(rec);
        }
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    }, { size: 'large' });

    setTimeout(async () => {
      try {
        const catData = await Admin.get('/resource-categories/scene/tree');
        const build = (nodes, depth) => nodes.map(n => {
          const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
          return `<option value="${esc(n.path)}" ${sc?.category_path === n.path ? 'selected' : ''}>${prefix}${esc(n.name)}</option>` +
            (n.children && n.children.length ? build(n.children, depth + 1) : '');
        }).join('');
        $('scb-cat').innerHTML = '<option value="">-- 未分类 --</option>' + build(catData.tree || [], 0);
      } catch (_) {}
      const area = $('scb-img');
      if (area) {
        Admin.renderImageUpload(area, sc?.background_image || '', (url) => {
          $('scb-img-value').value = url || '';
        });
      }
    }, 60);
  }

  // ==================== 场景外观配置（晴天 / 雨天 / 夜晚… 多套并存） ====================
  // 和人物的「多套外观」一个道理：同一个场景的不同天气 / 时段各存一套，
  // 出图时选哪套就用哪套，图库里也记下是哪套出的，方便按配置筛。
  const scApp = { items: [], activeId: null };

  async function loadSceneAppearances() {
    if (!currentScene) { scApp.items = []; scApp.activeId = null; renderSceneAppearances(); return; }
    try {
      const r = await Admin.get(`/scene-gen/${currentScene.id}/appearances`);
      scApp.items = r.items || [];
    } catch (_) { scApp.items = []; }
    if (!scApp.items.length) {
      scApp.items = [{ id: null, name: '默认配置', appearance: {}, is_default: true }];
    }
    const d = scApp.items.find(x => x.is_default) || scApp.items[0];
    scApp.activeId = (scApp.items.some(x => x.id === scApp.activeId) ? scApp.activeId : d.id);
    const cur = scApp.items.find(x => x.id === scApp.activeId) || d;
    state.appearance = cur.appearance || {};
    if (cur.prompt_text) state.free = cur.prompt_text;
    if (cur.negative_prompt) state.negative = cur.negative_prompt;
    renderSceneAppearances();
    renderGroups();
    refreshPrompt();
  }

  function renderSceneAppearances() {
    const host = $('sc-app-list');
    if (!host) return;
    host.innerHTML = scApp.items.map((a, i) => `
      <div class="sc-app-card${a.id === scApp.activeId ? ' on' : ''}" data-i="${i}" title="切换到这套配置">
        <div class="h"><span class="star">${a.is_default ? '★' : '☆'}</span><b>${esc(a.name)}</b></div>
        <div class="ops">
          <button type="button" data-act="rename" title="重命名">✎</button>
          <button type="button" data-act="copy" title="复制一套">⧉</button>
          <button type="button" data-act="default" title="设为默认" class="${a.is_default ? 'on' : ''}">${a.is_default ? '★' : '☆'}</button>
          <button type="button" data-act="del" title="删除这套配置">✕</button>
        </div>
      </div>`).join('') + '<div class="sc-app-card add" id="sc-app-add" title="新增一套配置">＋ 新建</div>';

    host.querySelectorAll('.sc-app-card[data-i]').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act]')) return;
        const a = scApp.items[Number(el.dataset.i)];
        if (!a || a.id === scApp.activeId) return;
        await saveActiveAppearance();           // 先把当前这套存下来再切
        scApp.activeId = a.id;
        state.appearance = a.appearance || {};
        if (a.prompt_text) state.free = a.prompt_text;
        if (a.negative_prompt) state.negative = a.negative_prompt;
        if ($('sc-free')) $('sc-free').value = state.free || '';
        if ($('sc-neg')) $('sc-neg').value = state.negative || '';
        renderSceneAppearances();
        renderGroups();
        refreshPrompt();
      });
    });
    host.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const a = scApp.items[Number(b.closest('.sc-app-card').dataset.i)];
        if (!a) return;
        await sceneAppAction(b.dataset.act, a);
      });
    });
    const addBtn = $('sc-app-add');
    if (addBtn) addBtn.addEventListener('click', async () => {
      if (!currentScene) { Admin.toast('先选择一个场景', 'error'); return; }
      const name = await Admin.prompt('新增场景外观配置', {
        label: '这套配置叫什么？（晴天 / 雨天 / 夜晚 / 血月…）', value: '新配置',
      });
      if (!name) return;
      await saveActiveAppearance();
      try {
        const r = await Admin.post(`/scene-gen/${currentScene.id}/appearances`, {
          name, appearance: state.appearance || {},
          prompt_text: $('sc-free')?.value || '', negative_prompt: $('sc-neg')?.value || '',
        });
        scApp.activeId = r.id;
        await loadSceneAppearances();
        Admin.toast('已新增配置：' + name, 'success');
      } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
    });
  }

  async function sceneAppAction(act, a) {
    if (!currentScene) { Admin.toast('先选择一个场景', 'error'); return; }
    if (act === 'rename') {
      const name = await Admin.prompt('重命名配置', { label: '配置名称：', value: a.name });
      if (!name) return;
      try {
        await Admin.put(`/scene-gen/${currentScene.id}/appearances/${a.id}`, { name });
        await loadSceneAppearances();
      } catch (e) { Admin.toast('重命名失败：' + e.message, 'error'); }
      return;
    }
    if (act === 'copy') {
      const name = await Admin.prompt('复制配置', { label: '复制成新配置，名称：', value: a.name + ' 副本' });
      if (!name) return;
      try {
        const r = await Admin.post(`/scene-gen/${currentScene.id}/appearances`, {
          name, appearance: a.appearance || {},
          prompt_text: a.prompt_text || '', negative_prompt: a.negative_prompt || '',
        });
        scApp.activeId = r.id;
        await loadSceneAppearances();
        Admin.toast('已复制：' + name, 'success');
      } catch (e) { Admin.toast('复制失败：' + e.message, 'error'); }
      return;
    }
    if (act === 'default') {
      if (a.is_default) return;
      try {
        await Admin.post(`/scene-gen/${currentScene.id}/appearances/${a.id}/default`, {});
        await loadSceneAppearances();
        Admin.toast('已设为默认配置', 'success');
      } catch (e) { Admin.toast('设置失败：' + e.message, 'error'); }
      return;
    }
    if (act === 'del') {
      if (scApp.items.length <= 1) { Admin.toast('至少保留一套配置', 'error'); return; }
      if (!await Admin.confirm(`删除配置「${esc(a.name)}」？已出的图不受影响。`)) return;
      try {
        await Admin.del(`/scene-gen/${currentScene.id}/appearances/${a.id}`);
        scApp.activeId = null;
        await loadSceneAppearances();
        Admin.toast('已删除配置', 'success');
      } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
    }
  }

  /** 把当前编辑中的这套配置写回服务端（切换 / 新建前调用，避免丢失改动） */
  async function saveActiveAppearance() {
    if (!currentScene || !scApp.activeId) return;
    const a = scApp.items.find(x => x.id === scApp.activeId);
    if (!a) return;
    a.appearance = state.appearance || {};
    a.prompt_text = $('sc-free')?.value || '';
    a.negative_prompt = $('sc-neg')?.value || '';
    try {
      await Admin.put(`/scene-gen/${currentScene.id}/appearances/${a.id}`, {
        appearance: a.appearance, prompt_text: a.prompt_text, negative_prompt: a.negative_prompt,
      });
    } catch (_) { /* 静默：切配置时写不进去也不该打断操作 */ }
  }

  // ==================== 场景拼装 ====================
  async function ensureDefs() {
    if (!defs) defs = await Admin.get('/scene-gen/defs');
    if (!themes.length) themes = await Admin.get('/scene-gen/themes');
  }

  function refreshSceneSelect() {
    const sel = $('sc-scene');
    if (!sel) return;
    sel.innerHTML = '<option value="">— 未选择（仅供预览 / 可出图但不归属场景）—</option>' +
      allScenes.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    if (currentScene) sel.value = String(currentScene.id);
  }

  function openAssembly(scene) {
    currentScene = scene;
    try { state.appearance = scene.appearance_json ? JSON.parse(scene.appearance_json) : {}; } catch (_) { state.appearance = {}; }
    state.free = scene.prompt_text || '';
    state.negative = scene.negative_prompt || '';
    switchTab('assembly');
    refreshSceneSelect();
    if ($('sc-free')) $('sc-free').value = state.free || '';
    if ($('sc-neg')) $('sc-neg').value = state.negative || '';
    renderGroups();
    loadImages(scene.id);
    $('sc-hint').textContent = '正在编辑：' + scene.name;
    ensureGenPanel();
    loadSceneAppearances().then(() => {
      // 旧场景没有拼装数据：给一套题材内随机，省得面对空下拉
      if (!Object.keys(state.appearance).length) randomAll(true);
      else refreshPrompt();
    });
  }

  // ==================== 场景卡弹窗（基础属性 + 场景拼装） ====================
  // 做法：把页面级的「场景拼装」面板整体挪进弹窗，关闭时挪回原位。
  // 这样拼装的全部逻辑（维度、外观配置、出图、提示词）都不用重写，事件也跟着节点走。
  function switchModalTab(name) {
    container.querySelectorAll('.sc-mtab').forEach(b => b.classList.toggle('active', b.dataset.mtab === name));
    container.querySelectorAll('.sc-mpane').forEach(p => p.classList.toggle('active', p.id === 'sc-modal-' + name));
    if (name === 'assembly') {
      renderGroups();
      if (currentScene) loadImages(currentScene.id);
    }
  }

  async function openCardModal(scene) {
    currentScene = scene;
    renderCardBasic(scene);
    const pane = $('sc-pane-assembly');
    if (pane) {
      const holder = document.createElement('div');
      holder.id = 'sc-assembly-holder';
      pane.parentNode.insertBefore(holder, pane);
      pane.classList.add('active');
      pane.remove();
      $('sc-modal-assembly').appendChild(pane);
      // 弹窗里已有「基础属性」选项卡，隐藏拼装工具栏里重复的按钮
      ['sc-new', 'sc-edit-basic'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
    }
    const modal = $('sc-card-modal');
    modal.style.display = 'flex';
    $('sc-modal-title').textContent = '场景 · ' + scene.name;
    // 拼装初始化（复用 openAssembly 的同一套逻辑，只是面板挪到了弹窗里）
    try { state.appearance = scene.appearance_json ? JSON.parse(scene.appearance_json) : {}; } catch (_) { state.appearance = {}; }
    state.free = scene.prompt_text || '';
    state.negative = scene.negative_prompt || '';
    if ($('sc-scene')) $('sc-scene').value = String(scene.id);
    if ($('sc-free')) $('sc-free').value = state.free || '';
    if ($('sc-neg')) $('sc-neg').value = state.negative || '';
    renderGroups();
    loadImages(scene.id);
    if ($('sc-hint')) $('sc-hint').textContent = '正在编辑：' + scene.name;
    ensureGenPanel();
    await loadSceneAppearances();
    if (!Object.keys(state.appearance).length) randomAll(true); else refreshPrompt();
    switchModalTab('assembly');
  }

  function closeCardModal() {
    const modal = $('sc-card-modal');
    const pane = $('sc-pane-assembly');
    const holder = $('sc-assembly-holder');
    if (pane && holder) {
      pane.classList.remove('active');
      holder.parentNode.insertBefore(pane, holder);
      holder.remove();
    }
    ['sc-new', 'sc-edit-basic'].forEach(id => { const el = $(id); if (el) el.style.display = ''; });
    modal.style.display = 'none';
    loadLibrary();
  }

  async function renderCardBasic(sc) {
    const host = $('sc-modal-basic');
    if (!host) return;
    host.innerHTML = `
      <div class="sc-toolbar" style="margin-bottom:10px">
        <label class="sc-field" style="flex:1 1 220px"><span>场景名称 *</span>
          <input id="scb2-name" class="sc-inp" value="${esc(sc?.name || '')}"></label>
        <label class="sc-field"><span>类型</span>
          <select id="scb2-type" class="sc-sel">
            ${Object.entries(TYPE_MAP).map(([k, v]) => `<option value="${k}" ${sc?.scene_type === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></label>
        <label class="sc-field"><span>安全区</span>
          <select id="scb2-safe" class="sc-sel">
            <option value="0" ${!sc?.is_safe_zone ? 'selected' : ''}>危险区</option>
            <option value="1" ${sc?.is_safe_zone ? 'selected' : ''}>安全区</option>
          </select></label>
      </div>
      <div class="sc-toolbar" style="margin-bottom:10px">
        <label class="sc-field" style="flex:1 1 200px"><span>所属区域</span>
          <input id="scb2-region" class="sc-inp" value="${esc(sc?.parent_region || '')}"></label>
        <label class="sc-field" style="flex:1 1 200px"><span>自定义分类</span>
          <select id="scb2-cat" class="sc-sel"><option value="">-- 未分类 --</option></select></label>
        <label class="sc-field"><span>坐标 JSON</span>
          <input id="scb2-coord" class="sc-inp" value="${esc(sc?.coordinates || '{"x":0,"y":0}')}"></label>
      </div>
      <div class="sc-field" style="margin-bottom:10px"><span>场景描述</span>
        <textarea id="scb2-desc" class="sc-ta">${esc(sc?.description || '')}</textarea></div>
      <div class="sc-field" style="margin-bottom:10px"><span>封面背景图</span>
        <div id="scb2-img"></div>
        <input type="hidden" id="scb2-img-value" value="${esc(sc?.background_image || '')}">
      </div>
      <div class="sc-toolbar">
        <button class="sc-btn primary" id="scb2-save">💾 保存基础属性</button>
        <span id="scb2-status" style="font-size:12px;color:var(--text-muted)"></span>
      </div>
    `;
    $('scb2-save').addEventListener('click', async () => {
      const name = $('scb2-name').value.trim();
      if (!name) { Admin.toast('请填写场景名称', 'error'); return; }
      const payload = {
        name,
        scene_type: $('scb2-type').value,
        description: $('scb2-desc').value,
        parent_region: $('scb2-region').value,
        is_safe_zone: parseInt($('scb2-safe').value),
        coordinates: $('scb2-coord').value,
        category_path: $('scb2-cat').value || null,
        background_image: $('scb2-img-value').value || null,
      };
      try {
        const rec = await Admin.put(`/scenes/${sc.id}`, payload);
        currentScene = rec;
        $('sc-modal-title').textContent = '场景 · ' + rec.name;
        $('scb2-status').textContent = '已保存';
        Admin.toast('基础属性已更新', 'success');
        await loadLibrary();
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    });
    try {
      const catData = await Admin.get('/resource-categories/scene/tree');
      const build = (nodes, depth) => nodes.map(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        return `<option value="${esc(n.path)}" ${sc?.category_path === n.path ? 'selected' : ''}>${prefix}${esc(n.name)}</option>` +
          (n.children && n.children.length ? build(n.children, depth + 1) : '');
      }).join('');
      $('scb2-cat').innerHTML = '<option value="">-- 未分类 --</option>' + build(catData.tree || [], 0);
    } catch (_) {}
    const area = $('scb2-img');
    if (area) {
      Admin.renderImageUpload(area, sc?.background_image || '', (url) => {
        $('scb2-img-value').value = url || '';
      });
    }
  }

  function renderGroups() {
    const host = $('sc-groups');
    if (!host) return;
    if (!defs) { host.innerHTML = '<div class="sc-empty">加载场景维度…</div>'; return; }
    host.innerHTML = (defs.groups || []).map(g => `
      <section class="sc-group">
        <div class="sc-group-h"><span>${esc(g.icon || '')}</span><span>${esc(g.name)}</span></div>
        <div class="body">
          ${(g.dims || []).map(d => `
            <div class="sc-row" data-dim="${esc(d.id)}">
              <label title="${esc(d.name)}">${esc(d.name)}</label>
              <select data-dim="${esc(d.id)}">
                <option value="">（默认）</option>
                ${(d.options || []).map(o => `<option value="${esc(o.id)}" ${state.appearance[d.id] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
              </select>
              <button class="sc-dice" data-dice="${esc(d.id)}" title="单独随机">🎲</button>
            </div>`).join('')}
        </div>
      </section>`).join('');

    host.querySelectorAll('.sc-row select').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.value) state.appearance[sel.dataset.dim] = sel.value;
        else delete state.appearance[sel.dataset.dim];
        refreshPrompt();
      });
    });
    host.querySelectorAll('.sc-dice').forEach(btn => {
      btn.addEventListener('click', () => rerollDim(btn.dataset.dice));
    });
  }

  async function rerollDim(dim) {
    try {
      const r = await Admin.post('/scene-gen/reroll', {
        scene: state.appearance, dim, theme: state.appearance.theme || $('sc-theme')?.value || undefined,
      });
      state.appearance = r.scene;
      renderGroups();
      refreshPrompt();
    } catch (e) { Admin.toast('随机失败：' + e.message, 'error'); }
  }

  async function randomAll(silent) {
    const theme = $('sc-theme')?.value || undefined;
    try {
      const r = await Admin.post('/scene-gen/random', { theme });
      state.appearance = r.scene;
      renderGroups();
      refreshPrompt();
      if (!silent) Admin.toast('已随机一套场景' + (theme ? '（' + theme + '）' : ''), 'success');
    } catch (e) { Admin.toast('随机失败：' + e.message, 'error'); }
  }

  // 提示词框可直接改；但只要任一维度/补充词变了，就重新生成并覆盖手改内容
  let promptEdited = false;

  function refreshPrompt() {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(async () => {
      try {
        const r = await Admin.post('/scene-gen/prompt', {
          scene: state.appearance, free_prompt: $('sc-free')?.value || '',
        });
        promptPos = r.prompt?.posCn || '';
        promptNeg = r.prompt?.negCn || '';
        promptEdited = false;
        const el = $('sc-prompt');
        if (el) el.value = promptPos || '（还没有选择任何维度）';
        const negEl = $('sc-neg');
        if (negEl && !negEl.value.trim()) negEl.placeholder = promptNeg || '低质量, 模糊…';
      } catch (e) {
        const el = $('sc-prompt');
        if (el) el.value = '提示词生成失败：' + e.message;
      }
    }, 160);
  }

  async function saveAssembly() {
    if (!currentScene) { Admin.toast('先在上方选择一个场景（或新建）', 'error'); return; }
    try {
      // 优先写到当前这套外观配置里（默认配置会被镜像回 scenes，旧接口也读得到）
      if (scApp.activeId) {
        await saveActiveAppearance();
        await Admin.put(`/scenes/${currentScene.id}`, {
          appearance_json: JSON.stringify(state.appearance),
          prompt_text: $('sc-free')?.value || '',
          negative_prompt: $('sc-neg')?.value || '',
        });
      } else {
        await Admin.put(`/scenes/${currentScene.id}`, {
          appearance_json: JSON.stringify(state.appearance),
          prompt_text: $('sc-free')?.value || '',
          negative_prompt: $('sc-neg')?.value || '',
        });
      }
      currentScene = await Admin.get(`/scenes/${currentScene.id}`);
      $('sc-hint').textContent = '已保存：' + currentScene.name;
      Admin.toast('场景拼装已保存', 'success');
      await loadLibrary();
    } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
  }

  async function loadImages(sceneId) {
    if (!sceneId) { images = []; renderImages(); return; }
    try {
      const r = await Admin.get(`/scene-gen/${sceneId}/images`);
      images = r.images || [];
    } catch (_) { images = []; }
    renderImages();
  }

  function renderImages() {
    const host = $('sc-gallery');
    if (!host) return;
    if (!images.length) {
      host.innerHTML = '<div class="sc-empty" style="grid-column:1/-1;padding:16px">还没有出图记录</div>';
      return;
    }
    host.innerHTML = images.map(im => `
      <div class="sc-shot" data-url="${esc(im.url)}" title="${esc(im.prompt || '')}">
        <img src="${esc(im.url)}" alt="" loading="lazy">
        ${im.is_cover ? '<span class="cover">封面</span>' : ''}
        <div class="m">
          <span>${im.width && im.height ? im.width + '×' + im.height : '场景图'}</span>
          <span>
            ${im.is_cover ? '' : `<span class="x" data-cover="${im.url}" title="设为封面">★</span>`}
            <span class="x" data-del="${im.id}" title="删除记录">✕</span>
          </span>
        </div>
      </div>`).join('');
    host.querySelectorAll('.sc-shot').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.dataset.del || e.target.dataset.cover) return;
        if (window.ImagePreview) {
          const list = images.map(im => ({
            url: im.url, title: currentScene?.name || '场景图', prompt: im.prompt || '',
            width: im.width, height: im.height,
            meta: { '场景': currentScene?.name || '', '模型方案': im.model_preset || '', '时间': im.created_at || '' },
          }));
          ImagePreview.open(list, images.findIndex(x => x.url === el.dataset.url));
        }
      });
    });
    host.querySelectorAll('[data-del]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentScene) return;
        if (!await Admin.confirm('删除这条出图记录？（不会删除磁盘文件）')) return;
        try {
          await Admin.del(`/scene-gen/${currentScene.id}/images/${el.dataset.del}`);
          await loadImages(currentScene.id);
          Admin.toast('已删除记录', 'success');
        } catch (err) { Admin.toast('删除失败：' + err.message, 'error'); }
      });
    });
    host.querySelectorAll('[data-cover]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentScene) return;
        try {
          currentScene = await Admin.put(`/scenes/${currentScene.id}`, { background_image: el.dataset.cover });
          await loadImages(currentScene.id);
          await loadLibrary();
          Admin.toast('已设为场景封面', 'success');
        } catch (err) { Admin.toast('设置失败：' + err.message, 'error'); }
      });
    });
  }

  // 出图任务追踪：按钮不再置灰，可连续多次点击，每次都提交到后台队列
  let renderJobs = new Set();

  async function renderScene() {
    const btn = $('sc-render');
    if (!btn) return;
    // 尺寸 / 模型方案 / 步数… 全部取自顶部的全局出图参数，不再单独写死
    const gp = window.GenParams ? GenParams.get('scenes') : {};
    const width = parseInt(gp.width) || DEFAULT_W;
    const height = parseInt(gp.height) || DEFAULT_H;
    try {
      const cfgName = (scApp.items.find(x => x.id === scApp.activeId) || {}).name || '';
      const r = await Admin.post('/scene-gen/generate', {
        scene_id: currentScene ? currentScene.id : null,
        appearance_id: scApp.activeId || null,
        appearance: state.appearance,
        // 提示词框手改过就用改后的这段出图
        prompt_override: promptEdited ? ($('sc-prompt')?.value || '') : null,
        free_prompt: $('sc-free')?.value || '',
        negative_prompt: $('sc-neg')?.value || '',
        width, height,
        model_preset: gp.model_preset || null,
        use_active_model_preset: !gp.model_preset,
        title: (currentScene?.name || '场景预览') + (cfgName ? ` · ${cfgName}` : '') + ' · 场景出图',
        page: 'scenes',
      });
      const jobId = r.job_id;
      renderJobs.add(jobId);
      updateRenderStatus();
      const timer = setInterval(async () => {
        let job = null;
        try { job = await Admin.get('/jobs/' + jobId); } catch (_) { return; }
        if (!job) return;
        if (job.status === 'running') {
          $('sc-render-status').textContent = `生成中…（进行中 ${renderJobs.size} 个任务）${job.message || ''}`;
          return;
        }
        clearInterval(timer);
        renderJobs.delete(jobId);
        if (job.status === 'error') {
          $('sc-render-status').textContent = '失败：' + (job.message || '未知原因');
          Admin.toast('出图失败：' + (job.message || ''), 'error');
          updateRenderStatus();
          return;
        }
        const it = job.render || (job.results || [])[0] || {};
        $('sc-render-status').textContent = `已出图 ${it.width || width}×${it.height || height}` + (renderJobs.size ? `（还有 ${renderJobs.size} 个排队中）` : '');
        if (it.url) {
          $('sc-result').innerHTML = `<img src="${esc(it.url)}" alt="场景图">`;
          if (currentScene) {
            currentScene = await Admin.get(`/scenes/${currentScene.id}`).catch(() => currentScene);
            await loadImages(currentScene.id);
            await loadLibrary();
          }
          if (window.ImagePreview) {
            ImagePreview.open([{ url: it.url, title: currentScene?.name || '场景图', prompt: it.prompt || '', width: it.width, height: it.height }], 0);
          }
        }
        updateRenderStatus();
      }, 2000);
    } catch (e) {
      $('sc-render-status').textContent = '提交失败：' + e.message;
      Admin.toast('提交失败：' + e.message, 'error');
    }
  }

  function updateRenderStatus() {
    const btn = $('sc-render');
    if (!btn) return;
    btn.classList.toggle('busy', renderJobs.size > 0);
  }

  async function onThemeChange() {
    const v = $('sc-theme')?.value;
    if (!v) return;
    await randomAll();
  }

  // 拼装页按钮
  $('sc-new').addEventListener('click', () => openBasic(null));
  $('sc-edit-basic').addEventListener('click', () => {
    if (!currentScene) { Admin.toast('先选择一个场景', 'error'); return; }
    openBasic(currentScene, (rec) => { currentScene = rec; openAssembly(rec); });
  });
  $('sc-save-cfg').addEventListener('click', saveAssembly);
  $('sc-random').addEventListener('click', () => randomAll());
  $('sc-theme').addEventListener('change', onThemeChange);
  $('sc-modal-close').addEventListener('click', closeCardModal);
  $('sc-modal-mask').addEventListener('click', closeCardModal);
  container.querySelectorAll('.sc-mtab').forEach(b => b.addEventListener('click', () => switchModalTab(b.dataset.mtab)));
  // 手改提示词：出图用框里的内容，参数一变就被重新生成的覆盖
  $('sc-prompt').addEventListener('input', (e) => {
    promptEdited = e.target.value !== (promptPos || '');
  });
  $('sc-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('sc-prompt')?.value || promptPos || ''); Admin.toast('提示词已复制', 'success'); }
    catch { Admin.toast('复制失败，请手动选择', 'error'); }
  });
  $('sc-render').addEventListener('click', renderScene);
  $('sc-scene').addEventListener('change', async (e) => {
    const id = parseInt(e.target.value);
    if (!id) {
      currentScene = null;
      state.appearance = {};
      state.free = ''; state.negative = '';
      $('sc-free').value = ''; $('sc-neg').value = '';
      scApp.activeId = null;
      await loadSceneAppearances();
      renderGroups(); refreshPrompt(); renderImages();
      $('sc-hint').textContent = '未选择场景：可以拼装、出图，但不会保存到场景';
      return;
    }
    try {
      const sc = await Admin.get(`/scenes/${id}`);
      openAssembly(sc);
    } catch (err) { Admin.toast('加载场景失败：' + err.message, 'error'); }
  });
  $('sc-free').addEventListener('input', refreshPrompt);
  $('sc-neg').addEventListener('input', () => {});
  // 出图参数不再折叠：进页面就挂出来，和人物「动作表情」那块是同一份全局参数
  async function ensureGenPanel() {
    if (genPanelMounted || !window.GenParams) return;
    genPanelMounted = true;
    try { await GenParams.init($('sc-gen-params'), { scope: 'scenes' }); }
    catch (e) { $('sc-gen-params').innerHTML = `<div style="font-size:12px;color:var(--red)">参数加载失败：${esc(e.message)}</div>`; }
  }
  ensureGenPanel();

  // ==================== 定义管理 ====================
  async function loadManage() {
    await ensureDefs();
    renderDimTree();
    renderThemes();
    if (activeDim) renderDimEditor(activeDim);
  }

  function renderDimTree() {
    const host = $('sc-dim-tree');
    if (!host) return;
    host.innerHTML = (defs.groups || []).map(g => `
      <div style="padding:7px 9px;font-size:13px;font-weight:600;color:var(--gold);
        background:rgba(201,168,76,.08);border-bottom:1px dashed var(--border)">
        ${esc(g.icon || '')} ${esc(g.name)}
      </div>
      ${(g.dims || []).map(d => `
        <div class="sc-item${activeDim === d.id ? ' on' : ''}" data-dim="${esc(d.id)}">
          <span>${esc(d.name)}</span>
          <span class="n">${(d.options || []).length}</span>
        </div>`).join('')}`).join('');
    host.querySelectorAll('[data-dim]').forEach(el => {
      el.addEventListener('click', () => { activeDim = el.dataset.dim; renderDimTree(); renderDimEditor(activeDim); });
    });
  }

  function renderDimEditor(dimId) {
    const host = $('sc-dim-editor');
    const g = (defs.groups || []).find(x => (x.dims || []).some(d => d.id === dimId));
    const d = g && g.dims.find(x => x.id === dimId);
    if (!d) { host.innerHTML = '<div class="sc-empty">维度不存在</div>'; return; }
    host.innerHTML = `
      <div class="sc-panel-h">
        <span>维度：${esc(d.name)} <span style="color:var(--text-muted);font-size:11.5px">(${esc(d.id)})</span></span>
        <span class="sp">
          <button class="sc-btn" id="sc-opt-add" style="font-size:11.5px;padding:3px 10px">＋ 新增选项</button>
          <button class="sc-btn" id="sc-dim-save" style="font-size:11.5px;padding:3px 10px">保存维度</button>
          <button class="sc-btn" id="sc-dim-del" style="font-size:11.5px;padding:3px 10px;color:var(--red)">删除维度</button>
        </span>
      </div>
      <div style="display:flex;gap:10px;padding:9px 10px;flex-wrap:wrap">
        <label class="sc-field"><span>显示名</span><input id="sc-dim-name" class="sc-inp" value="${esc(d.name)}"></label>
        <label class="sc-field"><span>所属分组</span>
          <select id="sc-dim-group" class="sc-sel">
            ${(defs.groups || []).map(x => `<option value="${esc(x.id)}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select></label>
      </div>
      <div class="sc-opts" id="sc-opts">
        ${(d.options || []).map(o => `
          <div class="sc-opt" data-oid="${esc(o.id)}">
            <input class="nm" data-f="name" value="${esc(o.name)}" title="显示名">
            <input class="cn" data-f="cn" value="${esc(o.cn || '')}" placeholder="提示词文本（留空用显示名）">
            <button data-osave="${esc(o.id)}">存</button>
            <button data-omove="${esc(o.id)}">↑</button>
            <button data-odel="${esc(o.id)}">✕</button>
          </div>`).join('') || '<div class="sc-empty">该维度还没有选项</div>'}
      </div>
    `;
    $('sc-dim-save').addEventListener('click', async () => {
      try {
        await Admin.put(`/scene-gen/manage/dims/${dimId}`, {
          name: $('sc-dim-name').value, group: $('sc-dim-group').value,
        });
        await loadManage();
        Admin.toast('维度已保存', 'success');
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    });
    $('sc-dim-del').addEventListener('click', async () => {
      if (!await Admin.confirm('删除这个维度？已有场景里该维度的值会被忽略。')) return;
      try {
        await Admin.del(`/scene-gen/manage/dims/${dimId}`);
        defs = await Admin.get('/scene-gen/defs');
        activeDim = '';
        await loadManage();
        $('sc-dim-editor').innerHTML = '<div class="sc-empty">左侧选择一个维度开始编辑</div>';
        Admin.toast('维度已删除', 'success');
      } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
    });
    $('sc-opt-add').addEventListener('click', async () => {
      const d2 = await prompt2('新增场景选项', [
        { name: 'id', label: '选项 id（英文/数字，唯一）', value: '' },
        { name: 'name', label: '显示名', value: '' },
        { name: 'cn', label: '提示词文本', type: 'textarea', value: '' },
      ]);
      if (!d2 || !d2.name) return;
      try {
        await Admin.post(`/scene-gen/manage/dims/${dimId}/options`, d2);
        defs = await Admin.get('/scene-gen/defs');
        await loadManage();
        Admin.toast('已新增选项', 'success');
      } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
    });
    host.querySelectorAll('[data-osave]').forEach(b => {
      b.addEventListener('click', async () => {
        const row = b.closest('.sc-opt');
        try {
          await Admin.put(`/scene-gen/manage/dims/${dimId}/options/${b.dataset.osave}`, {
            name: row.querySelector('[data-f="name"]').value,
            cn: row.querySelector('[data-f="cn"]').value,
          });
          defs = await Admin.get('/scene-gen/defs');
          Admin.toast('选项已保存', 'success');
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      });
    });
    host.querySelectorAll('[data-omove]').forEach(b => {
      b.addEventListener('click', async () => {
        await Admin.post(`/scene-gen/manage/dims/${dimId}/options/${b.dataset.omove}/move`, { delta: -1 });
        defs = await Admin.get('/scene-gen/defs');
        await loadManage(); renderDimEditor(dimId);
      });
    });
    host.querySelectorAll('[data-odel]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!await Admin.confirm('删除这个选项？')) return;
        await Admin.del(`/scene-gen/manage/dims/${dimId}/options/${b.dataset.odel}`);
        defs = await Admin.get('/scene-gen/defs');
        await loadManage(); renderDimEditor(dimId);
      });
    });
  }

  function renderThemes() {
    const host = $('sc-theme-list');
    if (!host) return;
    host.innerHTML = (themes || []).map(t => `
      <div class="sc-panel" style="padding:8px 10px">
        <div style="display:flex;align-items:center;gap:7px">
          <b style="font-size:13.5px">${esc(t.name)}</b>
          <span style="font-size:11px;color:var(--text-muted)">${esc(t.id)}</span>
          <button class="sc-btn" data-tedit="${esc(t.id)}" style="margin-left:auto;font-size:11px;padding:2px 8px">编辑</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5">${esc(t.desc || t.cn || '')}</div>
      </div>`).join('') || '<div class="sc-empty">还没有题材</div>';
    host.querySelectorAll('[data-tedit]').forEach(b => {
      b.addEventListener('click', () => editTheme(b.dataset.tedit));
    });
  }

  async function editTheme(themeId) {
    const raw = await Admin.get('/scene-gen/manage/raw');
    const t = (raw.themes || []).find(x => x.id === themeId) || {};
    const d = await prompt2('编辑场景题材', [
      { name: 'name', label: '名称', value: t.name || '' },
      { name: 'desc', label: '说明', value: t.desc || '' },
      { name: 'cn', label: '题材描述（拼进提示词）', type: 'textarea', value: t.cn || '' },
      { name: 'colors', label: '色板（逗号分隔的选项 id，可空）', value: (t.colors || []).join(',') },
      { name: 'pools', label: '收敛池 pools（JSON）', type: 'textarea', value: JSON.stringify(t.pools || {}, null, 1) },
    ]);
    if (!d || !d.name) return;
    let pools = {};
    try { pools = d.pools ? JSON.parse(d.pools) : {}; } catch { Admin.toast('pools 不是合法 JSON', 'error'); return; }
    try {
      await Admin.put(`/scene-gen/manage/themes/${themeId}`, {
        name: d.name, desc: d.desc, cn: d.cn,
        colors: (d.colors || '').split(',').map(s => s.trim()).filter(Boolean),
        pools,
      });
      themes = await Admin.get('/scene-gen/themes');
      renderThemes();
      fillThemeSelect();
      Admin.toast('题材已保存', 'success');
    } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
  }

  $('sc-theme-add').addEventListener('click', async () => {
    const d = await prompt2('新增场景题材', [
      { name: 'id', label: 'id（英文，唯一）', value: '' },
      { name: 'name', label: '名称', value: '' },
      { name: 'cn', label: '题材描述', type: 'textarea', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/scene-gen/manage/themes', { id: d.id || null, name: d.name, desc: '', cn: d.cn });
      themes = await Admin.get('/scene-gen/themes');
      renderThemes(); fillThemeSelect();
      Admin.toast('已新增题材', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  $('sc-mg-reset').addEventListener('click', async () => {
    if (!await Admin.confirm('恢复出厂场景定义？自定义的维度/选项/题材会被覆盖（场景数据不受影响）。')) return;
    await Admin.post('/scene-gen/manage/reset', {});
    defs = await Admin.get('/scene-gen/defs');
    themes = await Admin.get('/scene-gen/themes');
    await loadManage(); fillThemeSelect();
    Admin.toast('已恢复默认场景定义', 'success');
  });

  $('sc-dim-add').addEventListener('click', async () => {
    const d = await prompt2('新增场景维度', [
      { name: 'id', label: '维度 id（英文，唯一）', value: '' },
      { name: 'name', label: '显示名', value: '' },
      { name: 'group', label: `所属分组（${(defs.groups || []).map(g => g.id).join(' / ')}）`, value: (defs.groups || [])[0]?.id || 'place' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/scene-gen/manage/dims', { id: d.id || null, name: d.name, group: d.group });
      defs = await Admin.get('/scene-gen/defs');
      await loadManage();
      Admin.toast('已新增维度，记得去加选项', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  $('sc-group-add').addEventListener('click', async () => {
    const d = await prompt2('新增场景分组', [
      { name: 'id', label: '分组 id（英文，唯一）', value: '' },
      { name: 'name', label: '显示名', value: '' },
      { name: 'icon', label: '图标（emoji）', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/scene-gen/manage/groups', { id: d.id || null, name: d.name, icon: d.icon });
      defs = await Admin.get('/scene-gen/defs');
      await loadManage();
      Admin.toast('已新增分组', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  function fillThemeSelect() {
    const sel = $('sc-theme');
    if (!sel) return;
    const cur = sel.value;
    const all = themes || [];
    const plan = all.filter(t => (t.cat || 'genre') === 'plan');
    const genre = all.filter(t => (t.cat || 'genre') !== 'plan');
    const opt = (t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`;
    sel.innerHTML = '<option value="">全部 / 不限定</option>'
      + (plan.length ? `<optgroup label="场景方案（具体地点）">${plan.map(opt).join('')}</optgroup>` : '')
      + (genre.length ? `<optgroup label="题材（风格约束）">${genre.map(opt).join('')}</optgroup>` : '');
    sel.value = cur;
  }

  // ==================== 初始化 ====================
  try {
    await ensureDefs();
    fillThemeSelect();
    await loadLibrary();
    renderGroups();
    refreshPrompt();
  } catch (e) {
    container.innerHTML = `<div class="table-empty">场景管理初始化失败：${esc(e.message)}</div>`;
    return;
  }
});
