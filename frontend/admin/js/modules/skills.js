// ========== 技能书模块（每一条记录 = 一本技能书，装到人物技能书槽位即可在战斗中使用） ==========
Admin.registerPage('skills', async (container) => {
  const TYPE_MAP = { physical: '物理', magic: '魔法', special: '特殊', passive: '被动' };
  const ELE_MAP = { none: '无', fire: '火', water: '水', light: '光', dark: '暗', wind: '风', earth: '土' };
  const ELE_ICON = { fire: '🔥', water: '💧', light: '☀️', dark: '🌙', wind: '💨', earth: '⛰️', none: '⚡' };
  const TARGET_MAP = { single_enemy: '单体敌人', all_enemies: '全体敌人', single_ally: '单体友方', all_allies: '全体友方', self: '自己' };
  let skills = [], viewMode = 'list', selectedIds = new Set();
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;
  let allItemsCache = []; // 全部数据，用于分类计数

  async function load() {
    allItemsCache = await Admin.get('/skills');
    applyClientFilter();
  }

  function applyClientFilter() {
    if (currentCategory) {
      skills = allItemsCache.filter(x => x.category_path === currentCategory);
    } else {
      skills = allItemsCache.filter(x => !x.category_path);
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
      <div id="skills-toolbar"></div>
      <div id="skills-body"></div>
    `;
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'skill', {
      label: '技能书分类',
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
    const toolbar = document.getElementById('skills-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${skills.length} 本技能书</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建技能书</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (skills.length === 0) {
      bodyHtml = '<div class="table-empty">暂无技能书</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px">';
      skills.forEach(sk => {
        const checked = selectedIds.has(sk.id) ? 'checked' : '';
        const icon = ELE_ICON[sk.element] || '⚡';
        const imgHtml = sk.image
          ? `<img src="${sk.image}" style="width:100%;height:100px;object-fit:contain;border-radius:4px;margin-bottom:8px;background:var(--bg-input)">`
          : `<div style="width:100%;height:100px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;font-size:32px">${icon}</div>`;
        bodyHtml += `
          <div class="stat-card" style="padding:10px;text-align:center;position:relative">
            <input type="checkbox" class="item-checkbox" data-id="${sk.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:13px;font-weight:500;margin-bottom:2px">${sk.name}</div>
            <div style="font-size:11px;margin-bottom:4px">
              <span class="tag tag-${sk.skill_type === 'special' ? 'epic' : sk.skill_type === 'magic' ? 'accent' : 'enemy'}">${TYPE_MAP[sk.skill_type] || sk.skill_type}</span>
              ${sk.element && sk.element !== 'none' ? `<span class="tag tag-npc">${ELE_MAP[sk.element] || sk.element}</span>` : ''}
            </div>
            <div style="font-size:10px;color:var(--text-muted)">
              ${sk.is_ultimate ? '<span class="tag tag-epic" style="margin-right:4px">绝招</span>' : ''}${sk.effects ? '<span class="tag tag-accent" style="margin-right:4px">战斗效果</span>' : ''}威力:${sk.power} MP:${sk.mp_cost} 命中:${sk.accuracy}%
            </div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:4px">
              <button class="btn btn-outline btn-sm btn-edit" data-id="${sk.id}">编辑</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${sk.id}" style="color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th style="width:60px">图标</th><th>名称</th><th>类型</th><th>元素</th><th>威力</th><th>MP消耗</th><th>目标</th><th>暴击率</th><th style="width:120px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      skills.forEach(sk => {
        const checked = selectedIds.has(sk.id) ? 'checked' : '';
        const icon = ELE_ICON[sk.element] || '⚡';
        const imgHtml = sk.image
          ? `<img src="${sk.image}" style="width:48px;height:48px;object-fit:contain;border-radius:4px;background:var(--bg-input)">`
          : `<div style="width:48px;height:48px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:20px">${icon}</div>`;
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-id="${sk.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${imgHtml}</td>
            <td>${sk.name}</td>
            <td><span class="tag tag-${sk.skill_type === 'special' ? 'epic' : sk.skill_type === 'magic' ? 'accent' : 'enemy'}">${TYPE_MAP[sk.skill_type] || sk.skill_type}</span></td>
            <td>${ELE_MAP[sk.element] || sk.element}</td>
            <td>${sk.power || 0}</td>
            <td>${sk.mp_cost || 0}</td>
            <td style="font-size:12px">${TARGET_MAP[sk.target_type] || sk.target_type}</td>
            <td>${sk.critical_rate || 0}%</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${sk.id}">编辑</button>
                <button class="btn-del" data-id="${sk.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    const bodyEl = document.getElementById('skills-body');
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
      if (e.target.checked) skills.forEach(sk => selectedIds.add(sk.id));
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
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 本技能书？`)) return;
      for (const id of selectedIds) {
        try { await Admin.del(`/skills/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => { if (selectedIds.size === 0) return; selectedIds.clear(); render(); });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const skill = skills.find(s => s.id === parseInt(btn.dataset.id));
        if (skill) showForm(skill);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('确定删除该技能书？')) return;
        try {
          await Admin.del(`/skills/${id}`);
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
          await Admin.put(`/skills/${id}`, { category_path: newCat });
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
          <label>类型</label>
          <select name="skill_type">
            <option value="physical" ${data?.skill_type === 'physical' ? 'selected' : ''}>物理</option>
            <option value="magic" ${data?.skill_type === 'magic' ? 'selected' : ''}>魔法</option>
            <option value="special" ${data?.skill_type === 'special' ? 'selected' : ''}>特殊</option>
            <option value="passive" ${data?.skill_type === 'passive' ? 'selected' : ''}>被动</option>
          </select>
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>威力</label>
          <input name="power" type="number" value="${data?.power || 0}">
        </div>
        <div class="form-group">
          <label>MP消耗</label>
          <input name="mp_cost" type="number" value="${data?.mp_cost || 0}">
        </div>
        <div class="form-group">
          <label>HP消耗</label>
          <input name="hp_cost" type="number" value="${data?.hp_cost || 0}">
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>命中率(%)</label>
          <input name="accuracy" type="number" value="${data?.accuracy || 95}">
        </div>
        <div class="form-group">
          <label>暴击率(%)</label>
          <input name="critical_rate" type="number" value="${data?.critical_rate || 5}">
        </div>
        <div class="form-group">
          <label>元素</label>
          <select name="element">
            ${Object.entries(ELE_MAP).map(([k, v]) =>
              `<option value="${k}" ${data?.element === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>目标类型</label>
          <select name="target_type">
            ${Object.entries(TARGET_MAP).map(([k, v]) =>
              `<option value="${k}" ${data?.target_type === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>需求等级</label>
          <input name="required_level" type="number" value="${data?.required_level || 1}">
        </div>
      </div>
      <div id="skill-image-upload-area"></div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="skill-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-group">
        <label>技能书图标路径</label>
        <input name="image" id="skill_image_input" value="${data?.image || ''}" placeholder="如: /images/icons/skill/xxx.png">
      </div>
      <div style="margin:14px 0 8px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;font-weight:600;color:var(--accent)">
        战斗效果（v2 引擎）
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>技能书定位</label>
          <select name="is_ultimate">
            <option value="0" ${data?.is_ultimate ? '' : 'selected'}>普通技能书</option>
            <option value="1" ${data?.is_ultimate ? 'selected' : ''}>绝招（消耗怒气）</option>
          </select>
        </div>
        <div class="form-group">
          <label>怒气消耗</label>
          <input name="rage_cost" type="number" value="${data?.rage_cost != null ? data.rage_cost : (data?.is_ultimate ? 100 : 0)}">
        </div>
        <div class="form-group">
          <label>冷却（回合）</label>
          <input name="cooldown" type="number" value="${data?.cooldown || 0}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>攻击段数</label>
          <input name="hits" type="number" value="${data?.hits || 1}">
        </div>
        <div class="form-group">
          <label>达到等级自动学会</label>
          <select name="auto_learn">
            <option value="0" ${data?.auto_learn ? '' : 'selected'}>否（需手动学习）</option>
            <option value="1" ${data?.auto_learn ? 'selected' : ''}>是（等级达标即学会）</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>效果列表 effects（JSON 数组）</label>
        <textarea name="effects" id="skill-effects" rows="6" spellcheck="false"
          style="font-family:Consolas,'Courier New',monospace;font-size:12px"
          placeholder='[{"kind":"damage","power":150}]'>${data?.effects || ''}</textarea>
        <div id="skill-effects-hint" style="font-size:11px;margin-top:4px"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button type="button" class="btn btn-outline btn-sm" data-tpl="damage">+伤害</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="heal">+治疗</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="buff">+增益</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="debuff">+减益</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="dot">+持续伤害</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="shield">+护盾</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="control">+控制</button>
          <button type="button" class="btn btn-outline btn-sm" data-tpl="cleanse">+净化</button>
        </div>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">
          kind 可选：damage / heal / restore_mp / buff / debuff / dot / hot / shield / control / cleanse / rage / revive。
          留空则按旧版算法（用上面的「威力」算一次伤害）——新技能书建议填写。
        </span>
      </div>
      <div class="form-group">
        <label>状态效果（旧字段，JSON）</label>
        <textarea name="status_effect" rows="2">${data?.status_effect || ''}</textarea>
      </div>
      <div class="form-group">
        <label>战斗动画描述</label>
        <textarea name="battle_animation_desc">${data?.battle_animation_desc || ''}</textarea>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑技能书' : '新建技能书', bodyHtml, async () => {
      const fx = document.getElementById('skill-effects');
      if (fx && (fx.value || '').trim()) {
        try {
          const arr = JSON.parse(fx.value);
          if (!Array.isArray(arr)) throw new Error('必须是数组');
        } catch (e) {
          Admin.toast('effects JSON 有误：' + e.message, 'error');
          return;
        }
      }
      const formData = Admin.getFormData('.modal-body');
      try {
        if (isEdit) {
          await Admin.put(`/skills/${data.id}`, formData);
          Admin.toast('技能书已更新', 'success');
        } else {
          await Admin.post('/skills', formData);
          Admin.toast('技能书已创建', 'success');
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
          const catData = await Admin.get('/resource-categories/skill/tree');
          const catSelect = document.getElementById('skill-category-select');
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

      const imgArea = document.getElementById('skill-image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.image, (url) => {
          document.getElementById('skill_image_input').value = url;
        }, 'icons/skill');
      }

      // ---- 战斗效果 editors：模板插入 + 实时 JSON 校验 ----
      const fx = document.getElementById('skill-effects');
      const hint = document.getElementById('skill-effects-hint');
      if (fx && hint) {
        const TPLS = {
          damage: { kind: 'damage', power: 150 },
          heal: { kind: 'heal', value: 120, target: 'self' },
          buff: { kind: 'buff', stat: 'attack', value: 25, turns: 3, name: '攻击提升' },
          debuff: { kind: 'debuff', stat: 'defense', value: -25, turns: 3, name: '破甲' },
          dot: { kind: 'dot', key: 'poison', value: 18, turns: 3, name: '中毒' },
          shield: { kind: 'shield', power: 18, turns: 3 },
          control: { kind: 'control', control: 'stun', turns: 1, chance: 80 },
          cleanse: { kind: 'cleanse', count: 1 },
        };
        const validate = () => {
          const raw = (fx.value || '').trim();
          if (!raw) {
            hint.innerHTML = '<span style="color:var(--text-muted)">未填写：按旧版算法计算</span>';
            return;
          }
          try {
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) throw new Error('必须是数组');
            const kinds = arr.map(e => e.kind || '?').join('、');
            hint.innerHTML = `<span style="color:var(--accent)">✓ ${arr.length} 个效果：${kinds}</span>`;
          } catch (e) {
            hint.innerHTML = `<span style="color:var(--red)">JSON 错误：${e.message}</span>`;
          }
        };
        fx.addEventListener('input', validate);
        document.querySelectorAll('.modal-body [data-tpl]').forEach(btn => {
          btn.addEventListener('click', () => {
            let arr = [];
            try {
              const parsed = JSON.parse(fx.value || '[]');
              arr = Array.isArray(parsed) ? parsed : [];
            } catch (e) { arr = []; }
            const tpl = TPLS[btn.dataset.tpl];
            if (tpl) arr.push(JSON.parse(JSON.stringify(tpl)));
            fx.value = JSON.stringify(arr, null, 1);
            validate();
          });
        });
        validate();
      }
    }, 100);
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});
