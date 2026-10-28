// ========== 装备管理模块 ==========
// 覆盖全部 9 类装备/法宝/技能书（与前台人物面板、数据库 equipments.equipment_type 完全一致）：
//   weapon 武器 / head 头部 / shoulders 护肩 / chest 胸甲 / gloves 手套 / pants 护腿 / boots 靴子
//   artifact 法宝 / skill 技能书
// 说明：技能书（skill）只挂「授予技能」，不使用「装备词条」——词条只属于武器/防具/法宝。
// 属性数值统一写入 equipments.stat_bonuses（JSON），字段与前台 battle/character 面板一致：
//   atk(攻击) def(防御) recovery(恢复) spirit(精神) speed(速度) critRate(暴击率%)
//   max_hp(最大生命) max_mp(最大灵力) luck(幸运)
Admin.registerPage('equipments', async (container) => {
  // ---------- 装备类型（与数据库一致） ----------
  const TYPE_LIST = [
    { value: 'weapon',    label: '武器' },
    { value: 'head',      label: '头部' },
    { value: 'shoulders', label: '护肩' },
    { value: 'chest',     label: '胸甲' },
    { value: 'gloves',    label: '手套' },
    { value: 'pants',     label: '护腿' },
    { value: 'boots',     label: '靴子' },
    { value: 'artifact',  label: '法宝' },
    { value: 'skill',     label: '技能书' },
  ];
  const TYPE_MAP = TYPE_LIST.reduce((m, t) => (m[t.value] = t.label, m), {});
  const TYPE_TAG = {
    weapon: 'battle', skill: 'cutscene', artifact: 'player',
    head: 'choice', shoulders: 'choice', chest: 'choice',
    gloves: 'choice', pants: 'choice', boots: 'choice',
  };
  const TYPE_CHAR = {
    weapon: '武', head: '盔', shoulders: '肩', chest: '甲', gloves: '腕',
    pants: '腿', boots: '靴', artifact: '宝', skill: '书',
  };
  // 兼容历史数据里的旧类型名
  const LEGACY_TYPE_MAP = { set: 'chest', accessory: 'artifact' };

  const RARITY_MAP = { common: '普通', uncommon: '精良', rare: '稀有', epic: '史诗', legendary: '传说' };
  const RARITY_CLASS = { common: 'common', uncommon: 'common', rare: 'rare', epic: 'epic', legendary: 'epic' };

  // ---------- 属性数值定义（数字编辑项） ----------
  const STAT_DEFS = [
    { key: 'atk',       label: '攻击',     abbr: 'ATK',  hint: '普通攻击伤害' },
    { key: 'def',       label: '防御',     abbr: 'DEF',  hint: '减免受到的伤害' },
    { key: 'recovery',  label: '恢复',     abbr: 'REC',  hint: '每回合 / 治疗量' },
    { key: 'spirit',    label: '精神',     abbr: 'SPR',  hint: '灵力与法术强度' },
    { key: 'speed',     label: '速度',     abbr: 'SPD',  hint: '出手顺序' },
    { key: 'critRate',  label: '暴击率',   abbr: 'CRIT', hint: '单位 %', unit: '%' },
    { key: 'max_hp',    label: '最大生命', abbr: 'HP',   hint: '生命上限' },
    { key: 'max_mp',    label: '最大灵力', abbr: 'MP',   hint: '灵力上限' },
    { key: 'luck',      label: '幸运',     abbr: 'LUK',  hint: '掉落 / 命中' },
  ];
  const STAT_LABEL = STAT_DEFS.reduce((m, s) => (m[s.key] = s.label, m), {});

  // 系统类型节点（与自定义分类合并显示在分类栏中）
  const SYSTEM_TYPE_NODES = TYPE_LIST.map(t => ({ value: t.value, label: t.label }));

  let equipments = [], viewMode = 'list', selectedIds = new Set();
  let allAffixes = [], allSkills = [];
  let allItemsCache = []; // 全部数据，用于分类计数
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;

  async function loadAffixes() {
    try { allAffixes = await Admin.get('/equipments/affixes'); } catch (e) { allAffixes = []; }
  }

  async function loadSkills() {
    try { allSkills = await Admin.get('/skills'); } catch (e) { allSkills = []; }
  }

  async function load() {
    allItemsCache = await Admin.get('/equipments/');
    applyClientFilter();
  }

  // ---------- 工具 ----------
  function parseJson(str, fallback) {
    if (str == null || str === '') return fallback;
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // 兼容旧类型名 → 实际类型
  function normType(t) {
    if (!t) return '';
    return LEGACY_TYPE_MAP[t] || t;
  }

  // 属性文本，如 "攻+34 防+6 爆+3%"
  function statText(eq, sep = ' ') {
    const stats = parseJson(eq.stat_bonuses, {}) || {};
    return STAT_DEFS
      .filter(s => stats[s.key])
      .map(s => `${s.label}+${stats[s.key]}${s.unit || ''}`)
      .join(sep);
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
      // 选中系统类型节点：按装备类型筛选（忽略 category_path）
      const t = getTypeFromPath(currentCategory);
      filtered = filtered.filter(x => normType(x.equipment_type) === t);
    } else if (currentCategory) {
      // 选中自定义分类：按 category_path 筛选
      filtered = filtered.filter(x => x.category_path === currentCategory);
    } else {
      // 未分类：显示没有 category_path 的装备
      filtered = filtered.filter(x => !x.category_path);
    }
    equipments = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(x => !x.category_path).length;
    if (isTypePath(path)) {
      const t = getTypeFromPath(path);
      return allItemsCache.filter(x => normType(x.equipment_type) === t).length;
    }
    return allItemsCache.filter(x => x.category_path === path).length;
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="equipments-toolbar"></div>
      <div id="equipments-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'equipment', {
      label: '装备分类',
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

  function typeTag(t) {
    const cls = TYPE_TAG[t] || 'npc';
    return `<span class="tag tag-${cls}">${TYPE_MAP[t] || t || '未分类'}</span>`;
  }

  function render() {
    initLayout();
    if (categoryBarInstance) {
      // 同步分类栏的活跃状态和面包屑
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('equipments-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${equipments.length} 件</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 件</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建装备</button>
        </div>
      `;
    }

    let bodyHtml = '';
    if (equipments.length === 0) {
      bodyHtml = '<div class="table-empty">暂无装备</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px">';
      equipments.forEach(eq => {
        const t = normType(eq.equipment_type);
        const checked = selectedIds.has(eq.id) ? 'checked' : '';
        const imgHtml = eq.image
          ? `<img src="${eq.image}" style="width:100%;height:110px;object-fit:contain;border-radius:4px;margin-bottom:8px;background:var(--bg-input)">`
          : `<div style="width:100%;height:110px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;font-size:30px;color:var(--text-muted)">${TYPE_CHAR[t] || '?'}</div>`;
        const st = statText(eq);
        bodyHtml += `
          <div class="stat-card" style="padding:10px;text-align:center;position:relative">
            <input type="checkbox" class="eq-checkbox" data-id="${eq.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:13px;font-weight:500;margin-bottom:2px">${eq.name}</div>
            <div style="font-size:11px;margin-bottom:4px">
              ${typeTag(t)}
              <span class="tag tag-${RARITY_CLASS[eq.rarity] || 'common'}">${RARITY_MAP[eq.rarity] || eq.rarity}</span>
            </div>
            <div style="font-size:11px;color:var(--gold);min-height:16px;margin-bottom:4px">${st || '<span style="color:var(--text-muted)">— 无属性加成 —</span>'}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">${eq.description ? eq.description.substring(0, 30) : ''}</div>
            <div style="display:flex;gap:4px;justify-content:center">
              <button class="btn btn-outline btn-sm btn-edit" data-id="${eq.id}">编辑</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${eq.id}" style="color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th>名称</th><th>类型</th><th>稀有度</th><th>属性数值</th><th>需求境界</th><th>价格</th><th>描述</th><th style="width:120px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      equipments.forEach(eq => {
        const t = normType(eq.equipment_type);
        const checked = selectedIds.has(eq.id) ? 'checked' : '';
        const st = statText(eq, ' ');
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="eq-checkbox" data-id="${eq.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${eq.name}</td>
            <td>${typeTag(t)}</td>
            <td><span class="tag tag-${RARITY_CLASS[eq.rarity] || 'common'}">${RARITY_MAP[eq.rarity] || eq.rarity}</span></td>
            <td style="font-size:12px;color:var(--gold)">${st || '<span style="color:var(--text-muted)">—</span>'}</td>
            <td>Lv.${eq.required_realm_level}</td>
            <td>${eq.price || 0}</td>
            <td style="font-size:12px">${(eq.description || '').substring(0, 30)}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${eq.id}">编辑</button>
                <button class="btn-del" data-id="${eq.id}" style="color:var(--red)">删除</button>
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

    const bodyEl = document.getElementById('equipments-body');
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
      if (e.target.checked) equipments.forEach(eq => selectedIds.add(eq.id));
      else selectedIds.clear();
      render();
    });

    document.querySelectorAll('.eq-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        render();
      });
    });

    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 件装备？`)) return;
      for (const id of selectedIds) {
        try { await Admin.del(`/equipments/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => { if (selectedIds.size === 0) return; selectedIds.clear(); render(); });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const eq = equipments.find(e => e.id === parseInt(btn.dataset.id));
        if (eq) showForm(eq);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('确定删除该装备？')) return;
        try {
          await Admin.del(`/equipments/${id}`);
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
          await Admin.put(`/equipments/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  // ===================== 新建 / 编辑表单 =====================
  function showForm(data = null) {
    const isEdit = !!data;
    const eqType = normType(data?.equipment_type) || 'weapon';
    const typeOptions = TYPE_LIST.map(t =>
      `<option value="${t.value}" ${eqType === t.value ? 'selected' : ''}>${t.label}</option>`).join('');

    const statCardHtml = (s) => `
      <div class="form-group" style="margin-bottom:10px">
        <label title="${s.hint}">${s.label} <span style="color:var(--text-muted);font-size:10px">${s.abbr}</span></label>
        <input id="stat-${s.key}" type="number" step="1" placeholder="0"
          style="padding:7px 10px" value="">
      </div>`;

    const bodyHtml = `
      <div class="form-row">
        <div class="form-group">
          <label>名称 *</label>
          <input name="name" value="${data?.name || ''}" required placeholder="如：神行逐月靴">
        </div>
        <div class="form-group">
          <label>装备类型 *</label>
          <select name="equipment_type" id="eq-type-select">
            ${typeOptions}
          </select>
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>稀有度</label>
          <select name="rarity">
            ${Object.entries(RARITY_MAP).map(([k, v]) =>
              `<option value="${k}" ${(data?.rarity || 'common') === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>需求境界等级</label>
          <input name="required_realm_level" type="number" value="${data?.required_realm_level ?? 1}">
        </div>
        <div class="form-group">
          <label>价格</label>
          <input name="price" type="number" value="${data?.price ?? 0}">
        </div>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="equipment-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-row">
        <div><div id="eq-image-upload-area"></div></div>
        <div>
          <div class="form-group">
            <label>装备图片路径</label>
            <input name="image" id="eq_image_input" value="${data?.image || ''}" placeholder="如: /images/icons/item/xxx.png">
          </div>
          <div class="form-group">
            <label>描述（神通/法宝的效果文案也写这里）</label>
            <textarea name="description" style="min-height:60px">${data?.description || ''}</textarea>
          </div>
        </div>
      </div>

      <!-- 属性数值：会写入数据库 stat_bonuses -->
      <div style="border:1px solid var(--border);padding:14px;border-radius:6px;margin-bottom:12px">
        <h4 style="font-size:13px;margin-bottom:4px;color:var(--gold)">属性数值加成（数字）</h4>
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          留空 / 0 表示不加成。保存后写入 <code>equipments.stat_bonuses</code>，前台人物面板的数值变化与拖拽预览都读这里。
        </p>
        <div class="form-row form-row-3">
          ${STAT_DEFS.slice(0, 3).map(statCardHtml).join('')}
        </div>
        <div class="form-row form-row-3">
          ${STAT_DEFS.slice(3, 6).map(statCardHtml).join('')}
        </div>
        <div class="form-row form-row-3">
          ${STAT_DEFS.slice(6, 9).map(statCardHtml).join('')}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
          保存内容预览：<code id="stat-preview" style="color:var(--gold);word-break:break-all">{}</code>
        </div>
      </div>

      <!-- 装备词条（武器 / 防具 / 法宝可多选；技能书不使用词条） -->
      <div id="eq-affix-block" style="border:1px solid var(--border);padding:14px;border-radius:6px;margin-bottom:12px">
        <h4 style="font-size:13px;margin-bottom:10px;color:var(--gold)">装备词条（可多选，可留空）</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:150px;overflow-y:auto">
          ${allAffixes.length === 0 ? '<span style="font-size:12px;color:var(--text-muted)">暂无词条，请先在「装备词条」里创建</span>' : allAffixes.map(a => {
            const active = (data ? parseJson(data.affix_ids, []) : []).includes(a.id);
            const style = active ? 'background:var(--gold);border-color:var(--gold);color:#000' : 'background:transparent;border-color:var(--border);color:var(--text-primary)';
            return `<span class="affix-chip" data-affix-id="${a.id}" data-active="${active ? '1' : '0'}" title="${(a.description || '').replace(/"/g, '')}" style="display:inline-block;padding:3px 8px;font-size:11px;border:1px solid;border-radius:10px;cursor:pointer;user-select:none;${style}">${a.is_special ? '★' : ''}${a.name}</span>`;
          }).join('')}
        </div>
      </div>

      <!-- 授予技能（技能书必选；法宝可选） -->
      <div id="eq-skill-block" style="border:1px solid var(--border);padding:14px;border-radius:6px;margin-bottom:12px">
        <h4 style="font-size:13px;margin-bottom:4px;color:var(--gold)">授予技能（技能书必选，法宝可选）</h4>
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          技能书装到人物面板的 4 个技能书槽位后，战斗中就只能使用这里授予的技能（后台「技能书」里维护）。
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:150px;overflow-y:auto">
          ${allSkills.length === 0 ? '<span style="font-size:12px;color:var(--text-muted)">暂无技能书，请先在后台「技能书」里创建</span>' : allSkills.map(s => {
            const active = (data ? parseJson(data.skill_ids, []) : []).includes(s.id);
            const style = active ? 'background:var(--gold);border-color:var(--gold);color:#000' : 'background:transparent;border-color:var(--border);color:var(--text-primary)';
            return `<span class="skill-chip" data-skill-id="${s.id}" data-active="${active ? '1' : '0'}" style="display:inline-block;padding:3px 8px;font-size:11px;border:1px solid;border-radius:10px;cursor:pointer;user-select:none;${style}">${s.name}</span>`;
          }).join('')}
        </div>
      </div>
    `;

    Admin.showModal(isEdit ? `编辑装备 · ${data.name || ''}` : '新建装备', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');

      if (!formData.name || !String(formData.name).trim()) {
        Admin.toast('请填写装备名称', 'error');
        return;
      }
      if (!TYPE_MAP[formData.equipment_type]) {
        Admin.toast('请选择正确的装备类型', 'error');
        return;
      }

      // ---- 属性数值 → stat_bonuses JSON（只保留非 0 的项，保持数据干净）----
      const stats = {};
      STAT_DEFS.forEach(s => {
        const raw = document.getElementById('stat-' + s.key)?.value;
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n !== 0) stats[s.key] = n;
      });
      formData.stat_bonuses = JSON.stringify(stats);

      // ---- 词条 / 技能 ----
      const selectedAffixes = [];
      document.querySelectorAll('.affix-chip').forEach(c => {
        if (c.dataset.active === '1') selectedAffixes.push(parseInt(c.dataset.affixId));
      });
      const selectedSkills = [];
      document.querySelectorAll('.skill-chip').forEach(c => {
        if (c.dataset.active === '1') selectedSkills.push(parseInt(c.dataset.skillId));
      });
      formData.affix_ids = JSON.stringify(selectedAffixes);
      formData.skill_ids = JSON.stringify(selectedSkills);

      // 空分类要能真正清空（后端对 None 会跳过更新，传 '' 才会清）
      if (formData.category_path == null) formData.category_path = '';
      if (formData.image == null) formData.image = '';

      try {
        if (isEdit) {
          await Admin.put(`/equipments/${data.id}`, formData);
          Admin.toast('装备已更新', 'success');
        } else {
          await Admin.post('/equipments', formData);
          Admin.toast('装备已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    }, { size: 'large' });

    setTimeout(() => {
      // ---- 回填已有属性数值 ----
      const curStats = data ? parseJson(data.stat_bonuses, {}) || {} : {};
      STAT_DEFS.forEach(s => {
        const el = document.getElementById('stat-' + s.key);
        if (el) el.value = curStats[s.key] != null ? curStats[s.key] : '';
      });

      // ---- 实时预览将要保存的 stat_bonuses ----
      const preview = document.getElementById('stat-preview');
      const refreshPreview = () => {
        const tmp = {};
        STAT_DEFS.forEach(s => {
          const n = parseInt(document.getElementById('stat-' + s.key)?.value, 10);
          if (!isNaN(n) && n !== 0) tmp[s.key] = n;
        });
        if (preview) preview.textContent = JSON.stringify(tmp);
      };
      STAT_DEFS.forEach(s => document.getElementById('stat-' + s.key)?.addEventListener('input', refreshPreview));
      refreshPreview();

      // ---- 加载自定义分类下拉选项 ----
      (async () => {
        try {
          const catData = await Admin.get('/resource-categories/equipment/tree');
          const catSelect = document.getElementById('equipment-category-select');
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
            catSelect.innerHTML = '<option value="">-- 未分类 --</option>' + buildOpts((catData.tree || []), 0);
          }
        } catch (e) { console.warn('加载分类失败:', e); }
      })();

      // ---- 图片上传 ----
      const imgArea = document.getElementById('eq-image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.image, (url) => {
          document.getElementById('eq_image_input').value = url;
        }, 'icons/item');
      }

      // ---- 技能书类型：隐藏词条，只保留「授予技能」----
      const typeSel = document.getElementById('eq-type-select');
      const affixBlock = document.getElementById('eq-affix-block');
      const syncTypeBlocks = () => {
        const t = typeSel ? typeSel.value : 'weapon';
        const isBook = t === 'skill';
        if (affixBlock) affixBlock.style.display = isBook ? 'none' : '';
      };
      if (typeSel) typeSel.addEventListener('change', syncTypeBlocks);
      syncTypeBlocks();

      // ---- 词条/技能 chip 点击切换 ----
      document.querySelectorAll('.affix-chip, .skill-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const isActive = chip.dataset.active === '1';
          chip.dataset.active = isActive ? '0' : '1';
          if (isActive) {
            chip.style.background = 'transparent';
            chip.style.borderColor = 'var(--border)';
            chip.style.color = 'var(--text-primary)';
          } else {
            chip.style.background = 'var(--gold)';
            chip.style.borderColor = 'var(--gold)';
            chip.style.color = '#000';
          }
        });
      });
    }, 100);
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await loadAffixes();
  await loadSkills();
  await load();
});
