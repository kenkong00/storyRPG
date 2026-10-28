// ========== 后台：玩家角色（前台运行时 user_characters）管理 ==========
// 前台玩家角色(kong 等)的数据与后台"人物管理"编辑的模板人物(characters 表)是
// 两套隔离系统。本页打通前台角色：后台管理员可直接查看/编辑任意玩家角色的
// 装备槽位与统一背包（物品 + 装备 + 技能书）。
// 后端接口：/api/admin/user-characters（见 backend/app/routers/admin_user_chars.py）
(function () {
  const BASE = '/admin/user-characters';

  // 全部 9 个装备槽位（含技能书）。容量与前后台一致。
  const SLOT_DEFS = [
    { slot: 'weapon', label: '武器', type: 'weapon' },
    { slot: 'head', label: '头部', type: 'head' },
    { slot: 'shoulders', label: '肩部', type: 'shoulders' },
    { slot: 'chest', label: '胸甲', type: 'chest' },
    { slot: 'gloves', label: '手套', type: 'gloves' },
    { slot: 'pants', label: '腿部', type: 'pants' },
    { slot: 'boots', label: '足部', type: 'boots' },
    { slot: 'artifact', label: '法宝', type: 'artifact' },
    { slot: 'skill', label: '技能书', type: 'skill' },
  ];
  const SLOT_CAP = {
    weapon: 1, head: 1, shoulders: 1, chest: 1, gloves: 1, pants: 1, boots: 1,
    artifact: 4, skill: 4,
  };

  // 背包物品种类 → 中文标签
  function kindLabel(inv) {
    if (inv.item_kind === 'equipment') {
      if (inv.item_type === 'skill') return '技能书';
      return '装备';
    }
    return '物品';
  }

  // 缓存：用于展示装备/词条/技能详情
  let _allEquipments = [], _allAffixes = [], _allSkills = [];

  async function load(container) {
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">
            前台玩家角色（user_characters）与后台模板人物是两套独立数据。此处可直接管理玩家实时的装备与背包。
          </div>
          <select id="uc-select" class="form-control" style="min-width:260px;max-width:420px">
            <option value="">加载中...</option>
          </select>
        </div>
      </div>
      <div id="uc-detail"><div class="table-empty">请选择一名玩家角色</div></div>
    `;

    // 预加载装备/词条/技能，供详情展示
    try {
      const [eqs, affs, sks] = await Promise.all([
        Admin.get('/equipments/').catch(() => []),
        Admin.get('/equipments/affixes').catch(() => []),
        Admin.get('/skills').catch(() => []),
      ]);
      _allEquipments = eqs; _allAffixes = affs; _allSkills = sks;
    } catch (_) {}

    let list = [];
    try {
      list = await Admin.get(BASE);
    } catch (e) {
      container.innerHTML = `<div style="color:var(--red)">加载玩家角色失败: ${e.message}</div>`;
      return;
    }
    const sel = document.getElementById('uc-select');
    if (!list || list.length === 0) {
      sel.innerHTML = '<option value="">暂无玩家角色</option>';
    } else {
      sel.innerHTML = '<option value="">— 选择玩家角色 —</option>' + list.map(uc =>
        `<option value="${uc.id}">#${uc.id} ${uc.custom_name || ('角色'+uc.id)} Lv.${uc.level} · 装备${uc.equip_count}/背包${uc.inventory_count}</option>`
      ).join('');
      sel.addEventListener('change', () => {
        const id = parseInt(sel.value);
        if (id) renderDetail(document.getElementById('uc-detail'), id);
        else document.getElementById('uc-detail').innerHTML = '<div class="table-empty">请选择一名玩家角色</div>';
      });
      // 从「人物管理」点击「打开」时自动定位到该玩家角色
      if (window.__adminOpenUC && list.length) {
        const target = list.find(uc => uc.id === window.__adminOpenUC);
        if (target) {
          sel.value = target.id;
          renderDetail(document.getElementById('uc-detail'), target.id);
        }
        window.__adminOpenUC = null;
      }
    }
  }

  async function renderDetail(root, ucId) {
    root.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr;gap:16px">
        <div class="panel-card" style="border:1px solid var(--border);border-radius:8px;padding:16px">
          <h3 style="font-size:15px;margin:0 0 4px;color:var(--gold)">装备槽位（9 类 · 技能书可装 4 本）</h3>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">点击「选择装备」从装备管理里挑；技能书槽位的数据来自后台「技能书」栏目（与前台面板、战斗一致）。</div>
          <div id="player-equip-slots">加载中...</div>
        </div>
        <div class="panel-card" style="border:1px solid var(--border);border-radius:8px;padding:16px">
          <h3 style="font-size:15px;margin:0 0 4px;color:var(--gold)">统一背包（物品 / 装备 / 技能书）</h3>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">三类物品统一在此管理，可添加装备/技能书或普通物品，可改数量、可移除。</div>
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="btn-add-eq" type="button">+ 添加装备/技能书</button>
            <button class="btn btn-outline btn-sm" id="btn-add-item" type="button">+ 添加物品</button>
          </div>
          <div id="player-backpack">加载中...</div>
        </div>
      </div>
    `;
    await renderEquipSlots(ucId);
    await renderBackpack(ucId);
  }

  // ===== 装备槽位 =====
  async function renderEquipSlots(ucId) {
    const area = document.getElementById('player-equip-slots');
    if (!area) return;
    try {
      const charEquips = await Admin.get(`${BASE}/${ucId}/equipments`);
      // 技能书走独立接口（后台「技能书」库），不再用 equipment 型技能书
      const books = await Admin.get(`/skill-books/user-character/${ucId}`).catch(() => []);
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">';
      SLOT_DEFS.forEach(s => {
        if (s.slot === 'skill') return; // 技能书单独渲染（见下方）
        const cap = SLOT_CAP[s.slot] || 1;
        const equippedList = charEquips.filter(ce => ce.slot === s.slot);
        const gridHtml = equippedList.length > 0
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-top:8px">
              ${equippedList.map(ce => {
                const eq = ce.equipment;
                if (!eq) return '';
                const imgHtml = eq.image
                  ? `<img src="${eq.image}" style="width:100%;height:56px;object-fit:cover;border-radius:4px">`
                  : `<div style="width:100%;height:56px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">无图</div>`;
                return `
                  <div style="border:1px solid var(--border);border-radius:4px;padding:4px;text-align:center;position:relative">
                    <button type="button" class="btn-unequip-one" data-slot="${s.slot}" data-eq-id="${eq.id}" title="卸下" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:16px;height:16px;cursor:pointer;font-size:10px;line-height:1">&times;</button>
                    ${imgHtml}
                    <div style="font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${eq.name}">${eq.name}</div>
                    <div style="font-size:9px;color:var(--text-muted)">${eq.rarity || ''}</div>
                  </div>`;
              }).join('')}
            </div>`
          : '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">未装备</div>';

        const descHtml = equippedList.length > 0
          ? `<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px">
              ${equippedList.map(ce => {
                const eq = ce.equipment;
                if (!eq) return '';
                let parts = [];
                if (eq.description) parts.push(`<div style="font-size:11px;color:var(--text-muted)">${eq.description}</div>`);
                if (eq.stat_bonuses) {
                  try {
                    const b = JSON.parse(eq.stat_bonuses);
                    const ps = Object.entries(b).map(([k, v]) => v > 0 ? `${k}+${v}` : `${k}${v}`).join(' / ');
                    if (ps) parts.push(`<div style="font-size:11px;color:var(--green)">加成: ${ps}</div>`);
                  } catch {}
                }
                if (eq.affix_ids) {
                  try {
                    const ids = JSON.parse(eq.affix_ids);
                    const affixes = ids.map(aid => _allAffixes.find(a => a.id === aid)).filter(Boolean);
                    if (affixes.length) parts.push(`<div style="font-size:11px;color:var(--accent)">词条: ${affixes.map(a => (a.is_special ? '★' : '') + a.name).join(' / ')}</div>`);
                  } catch {}
                }
                if (eq.skill_ids) {
                  try {
                    const ids = JSON.parse(eq.skill_ids);
                    const skills = ids.map(sid => _allSkills.find(s => s.id === sid)).filter(Boolean);
                    if (skills.length) parts.push(`<div style="font-size:11px;color:var(--gold)">技能: ${skills.map(s => s.name).join(' / ')}</div>`);
                  } catch {}
                }
                return `<div style="border:1px solid var(--border);border-radius:4px;padding:6px 8px;margin-bottom:4px"><div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:2px">${eq.name}</div>${parts.join('')}</div>`;
              }).join('')}
            </div>`
          : '';

        html += `
          <div style="border:1px solid var(--border);border-radius:6px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:13px;font-weight:500;color:var(--gold)">${s.label} <span style="color:var(--text-muted);font-size:11px">(${equippedList.length}/${cap})</span></span>
              <div style="display:flex;gap:6px">
                <button type="button" class="btn btn-primary btn-sm btn-add-equip" data-slot="${s.slot}" data-type="${s.type}">+ 选择装备</button>
                ${equippedList.length > 0 ? `<button type="button" class="btn btn-outline btn-sm btn-unequip-all" data-slot="${s.slot}" style="color:var(--red);border-color:var(--red)">全部卸下</button>` : ''}
              </div>
            </div>
            ${gridHtml}${descHtml}
          </div>`;
      });

      // ===== 技能书槽位（数据源：后台「技能书」库，与前台人物面板 / 战斗完全一致） =====
      {
        const cap = SLOT_CAP.skill;
        const bookGrid = books.length > 0
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-top:8px">
              ${books.map(b => {
                const sk = b.skill || {};
                const imgHtml = sk.image
                  ? `<img src="${sk.image}" style="width:100%;height:56px;object-fit:cover;border-radius:4px">`
                  : `<div style="width:100%;height:56px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--gold);font-size:16px">书</div>`;
                return `
                  <div style="border:1px solid ${sk.is_ultimate ? 'var(--gold)' : 'var(--border)'};border-radius:4px;padding:4px;text-align:center;position:relative">
                    <button type="button" class="btn-unequip-book" data-slot-index="${b.slot_index || 1}" title="卸下" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:16px;height:16px;cursor:pointer;font-size:10px;line-height:1">&times;</button>
                    ${imgHtml}
                    <div style="font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${sk.name || ''}">${sk.name || ('#' + b.skill_id)}</div>
                    <div style="font-size:9px;color:var(--text-muted)">槽${b.slot_index || 1}${sk.is_ultimate ? ' · 神通' : ''}</div>
                  </div>`;
              }).join('')}
            </div>`
          : '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">未装备技能书</div>';

        html += `
          <div style="border:1px solid var(--gold);border-radius:6px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:13px;font-weight:500;color:var(--gold)">技能书 <span style="color:var(--text-muted);font-size:11px">(${books.length}/${cap})</span></span>
              <button type="button" class="btn btn-primary btn-sm btn-add-book">+ 装备技能书</button>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">数据来自后台「技能书」栏目；前台装什么书，战斗就只能用什么功法。</div>
            ${bookGrid}
          </div>`;
      }

      html += '</div>';
      area.innerHTML = html;

      // 技能书：装备（选一本后台技能书放到空槽）
      area.querySelector('.btn-add-book')?.addEventListener('click', async () => {
        const used = books.map(b => b.skill_id);
        const free = [1, 2, 3, 4].filter(i => !books.some(b => (b.slot_index || 1) === i));
        if (free.length === 0) { Admin.toast('技能书槽位已满（最多 4 本），请先卸下一本', 'error'); return; }
        const opts = (_allSkills || []).map(s =>
          `<option value="${s.id}" ${used.includes(s.id) ? 'disabled' : ''}>${s.name}${s.is_ultimate ? '（神通）' : ''}${used.includes(s.id) ? ' · 已装备' : ''}</option>`).join('');
        Admin.showModal('装备技能书（槽位 ' + free.join('/') + '）', `
          <label>从后台「技能书」中选择</label>
          <select id="pb-book-sel" class="form-control">${opts || '<option value="">（技能书库为空，请先在「技能书」新建）</option>'}</select>
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px">将放入第一个空槽（${free[0]}）。</div>
        `, async () => {
          const sid = parseInt(document.getElementById('pb-book-sel')?.value);
          if (!sid) { Admin.toast('请选择一本技能书', 'error'); return; }
          try {
            await Admin.post(`/skill-books/user-character/${ucId}`, { skill_id: sid, slot_index: free[0] });
            Admin.toast('技能书已装备', 'success');
            Admin.closeModal();
            renderDetail(root(), ucId);
          } catch (e) { Admin.toast('装备失败: ' + e.message, 'error'); }
        });
      });
      // 技能书：卸下某槽
      area.querySelectorAll('.btn-unequip-book').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await Admin.del(`/skill-books/user-character/${ucId}/slot/${parseInt(btn.dataset.slotIndex)}`);
            Admin.toast('已卸下技能书', 'success');
            renderDetail(root(), ucId);
          } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
        });
      });

      area.querySelectorAll('.btn-add-equip').forEach(btn => {
        btn.addEventListener('click', async () => {
          const slot = btn.dataset.slot, type = btn.dataset.type;
          const currentEquipped = (await Admin.get(`${BASE}/${ucId}/equipments`)).filter(ce => ce.slot === slot).map(ce => ce.equipment_id);
          const selected = await Admin.Pickers.equipment({ multi: true, typeFilter: type, preSelect: currentEquipped });
          if (!selected || selected.length === 0) return;
          const selectedIds = selected.map(e => e.id);
          const toRemove = currentEquipped.filter(id => !selectedIds.includes(id));
          const toAdd = selectedIds.filter(id => !currentEquipped.includes(id));
          try {
            for (const eqId of toRemove) await Admin.del(`${BASE}/${ucId}/equipments?slot=${slot}&equipment_id=${eqId}`);
            for (const eqId of toAdd) await Admin.post(`${BASE}/${ucId}/equipments`, { equipment_id: eqId, slot });
            Admin.toast(`已更新${slot === 'skill' ? '技能书' : slot === 'artifact' ? '法宝' : slot}装备（${selectedIds.length}件）`, 'success');
            renderDetail(root(), ucId);
          } catch (e) { Admin.toast('装备失败: ' + e.message, 'error'); }
        });
      });
      area.querySelectorAll('.btn-unequip-one').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await Admin.del(`${BASE}/${ucId}/equipments?slot=${btn.dataset.slot}&equipment_id=${parseInt(btn.dataset.eqId)}`);
            Admin.toast('已卸下', 'success');
            renderDetail(root(), ucId);
          } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
        });
      });
      area.querySelectorAll('.btn-unequip-all').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await Admin.del(`${BASE}/${ucId}/equipments?slot=${btn.dataset.slot}`);
            Admin.toast('已全部卸下', 'success');
            renderDetail(root(), ucId);
          } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
        });
      });
    } catch (e) {
      area.innerHTML = `<div style="color:var(--red);font-size:12px">加载失败: ${e.message}</div>`;
    }
  }

  // ===== 统一背包 =====
  async function renderBackpack(ucId) {
    const area = document.getElementById('player-backpack');
    if (!area) return;
    try {
      const inventory = await Admin.get(`${BASE}/${ucId}/inventory`);
      if (inventory.length === 0) {
        area.innerHTML = '<div class="table-empty">背包为空</div>';
      } else {
        let html = '<div class="table-container"><table><thead><tr><th style="width:50px">图片</th><th>名称</th><th>种类</th><th>类型</th><th>数量</th><th style="width:170px">操作</th></tr></thead><tbody>';
        inventory.forEach(inv => {
          const imgHtml = inv.image
            ? `<img src="${inv.image}" style="width:36px;height:36px;object-fit:cover;border-radius:3px">`
            : `<div style="width:36px;height:36px;background:var(--bg-input);border-radius:3px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">无</div>`;
          let extra = '';
          if (inv.stat_bonuses) {
            try { const b = JSON.parse(inv.stat_bonuses); const ps = Object.entries(b).map(([k, v]) => `${k}+${v}`).join('/'); if (ps) extra += ` <span style="color:var(--green);font-size:10px">[${ps}]</span>`; } catch {}
          }
          html += `
            <tr>
              <td>${imgHtml}</td>
              <td>${inv.name || ('#'+inv.item_id)}${extra}</td>
              <td style="font-size:11px"><span class="tag tag-${inv.item_kind === 'equipment' ? (inv.item_type === 'skill' ? 'gold' : 'artifact') : 'item'}">${kindLabel(inv)}</span></td>
              <td style="font-size:11px;color:var(--text-muted)">${inv.item_type || '-'}</td>
              <td><input type="number" min="0" value="${inv.quantity}" class="qty-input" data-inv-id="${inv.id}" style="width:64px;padding:2px 4px"></td>
              <td>
                <button class="btn-save-qty btn btn-outline btn-sm" data-inv-id="${inv.id}" style="color:var(--green);border-color:var(--green)">保存</button>
                <button class="btn-del-backpack btn btn-outline btn-sm" data-inv-id="${inv.id}" style="color:var(--red);border-color:var(--red)">移除</button>
              </td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        area.innerHTML = html;

        area.querySelectorAll('.btn-del-backpack').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await Admin.del(`${BASE}/${ucId}/inventory/${parseInt(btn.dataset.invId)}`);
              Admin.toast('已从背包移除', 'success');
              renderBackpack(ucId);
            } catch (e) { Admin.toast('移除失败: ' + e.message, 'error'); }
          });
        });
        area.querySelectorAll('.btn-save-qty').forEach(btn => {
          btn.addEventListener('click', async () => {
            const invId = parseInt(btn.dataset.invId);
            const qty = parseInt(area.querySelector(`.qty-input[data-inv-id="${invId}"]`).value);
            try {
              await Admin.put(`${BASE}/${ucId}/inventory/${invId}`, { quantity: qty });
              Admin.toast('数量已更新', 'success');
              renderBackpack(ucId);
            } catch (e) { Admin.toast('更新失败: ' + e.message, 'error'); }
          });
        });
      }

      document.getElementById('btn-add-eq')?.addEventListener('click', async () => {
        const selected = await Admin.Pickers.equipment({ multi: true });
        if (!selected || selected.length === 0) return;
        let ok = 0, fail = 0;
        for (const eq of selected) {
          try { await Admin.post(`${BASE}/${ucId}/inventory`, { item_id: eq.id, item_kind: 'equipment', quantity: 1 }); ok++; }
          catch (e) { fail++; }
        }
        Admin.toast(`已添加 ${ok} 件装备/技能书到背包${fail ? `，${fail} 件失败` : ''}`, fail ? 'error' : 'success');
        renderBackpack(ucId);
      });
      document.getElementById('btn-add-item')?.addEventListener('click', async () => {
        const selected = await Admin.Pickers.item({ multi: true });
        if (!selected || selected.length === 0) return;
        let ok = 0, fail = 0;
        for (const it of selected) {
          try { await Admin.post(`${BASE}/${ucId}/inventory`, { item_id: it.id, item_kind: 'item', quantity: 1 }); ok++; }
          catch (e) { fail++; }
        }
        Admin.toast(`已添加 ${ok} 个物品到背包${fail ? `，${fail} 个失败` : ''}`, fail ? 'error' : 'success');
        renderBackpack(ucId);
      });
    } catch (e) {
      area.innerHTML = `<div style="color:var(--red);font-size:12px">加载失败: ${e.message}</div>`;
    }
  }

  // root 容器在 re-render 时需要重新获取（renderDetail 会替换内部 DOM）
  function root() { return document.getElementById('uc-detail'); }

  Admin.registerPage('players', load);
})();
