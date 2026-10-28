      // ===== 背包与装备（统一面板：布局与前台人物面板一致；此处为「编辑态」，可增删改） =====
      // 前台 character.js 只是显示，这里是数据源：玩家新建角色时会复制这里的装备 / 背包 / 技能书。
      const GEAR_PARTS = [
        { slot: 'head', label: '头部' }, { slot: 'shoulders', label: '护肩' },
        { slot: 'weapon', label: '武器' }, { slot: 'chest', label: '胸甲' },
        { slot: 'gloves', label: '手套' }, { slot: 'pants', label: '护腿' },
        { slot: 'boots', label: '靴子' },
      ];
      const GEAR_MULTI = [{ slot: 'artifact', label: '法宝', cap: 4 }];
      const BOOK_CAP = 4;
      const GEAR_CAP = { weapon: 1, head: 1, shoulders: 1, chest: 1, gloves: 1, pants: 1, boots: 1, artifact: 4, set: 1, accessory: 2 };
      const STAT_KEYS = ['attack', 'defense', 'recovery', 'spirit', 'speed', 'luck', 'max_hp', 'max_mp', 'crit_rate'];
      const STAT_LABEL = { attack: '攻击', defense: '防御', recovery: '恢复', spirit: '精神', speed: '速度', luck: '幸运', max_hp: '生命', max_mp: '灵力', crit_rate: '暴击' };
      const RARITY_LABEL = { common: '普通', uncommon: '精良', rare: '稀有', epic: '史诗', legendary: '传说' };

      let _gearEquipped = [], _gearInventory = [], _gearBooks = [], _gearSkills = [], _gearEquipLib = [];
      let _invFilter = 'all', _invSearch = '';

      function _parseJson(s) { if (!s) return {}; try { return JSON.parse(s) || {}; } catch { return {}; } }
      function _gearStatSummary(bonuses) {
        const b = _parseJson(bonuses);
        return STAT_KEYS.filter(k => b[k]).map(k => `${STAT_LABEL[k]}${b[k] > 0 ? '+' : ''}${b[k]}`).join(' ');
      }

      async function loadGearPanel() {
        const root = document.getElementById('ag-root');
        if (!root) return;
        root.innerHTML = '<div style="color:var(--text-muted);font-size:12px">加载中...</div>';
        try {
          const [equipLib, equipped, inventory, skills, books] = await Promise.all([
            Admin.get('/equipments/').catch(() => []),
            Admin.get(`/equipments/character/${data.id}`).catch(() => []),
            Admin.get(`/items/character/${data.id}/inventory`).catch(() => []),
            Admin.get('/skills').catch(() => []),
            Admin.get(`/skill-books/character/${data.id}`).catch(() => []),
          ]);
          _gearEquipLib = equipLib; _gearEquipped = equipped; _gearInventory = inventory;
          _gearSkills = skills; _gearBooks = books;
          renderGear();
        } catch (e) {
          root.innerHTML = `<div style="color:var(--red);font-size:12px">加载失败: ${e.message}</div>`;
        }
      }

      function _equippedAt(slot, idx) {
        return _gearEquipped.find(ce => ce.slot === slot && (ce.slot_index || 1) === idx);
      }
      function _bookAt(idx) {
        return _gearBooks.find(b => (b.slot_index || 1) === idx);
      }

      function renderGear() {
        const root = document.getElementById('ag-root');
        if (!root) return;
        root.innerHTML = `
          <div class="ag-col ag-left">
            <div class="ag-h">属性（基础 + 装备加成）</div>
            <div id="ag-stats" class="ag-stats">${renderGearStats()}</div>
            <div class="ag-h">已装备技能书（决定战斗可用功法）</div>
            <div id="ag-book-list" class="ag-book-list">${renderBookList()}</div>
          </div>

          <div class="ag-col ag-center">
            <div class="ag-char-name">${esc(data.name || '')}<span class="ag-lv">Lv.${data.level || 1}</span></div>
            <div class="ag-stage">
              <div class="ag-portrait">${data.portrait_image ? `<img src="${data.portrait_image}" alt="">` : esc((data.name || '?')[0])}</div>
              ${GEAR_PARTS.map((p, i) => {
                const col = i % 2 === 0 ? 1 : 3;
                const row = Math.floor(i / 2) + 1;
                return `<div class="ag-slot-wrap" style="grid-column:${col};grid-row:${row}">${renderSlot(p.slot, p.label, 1)}</div>`;
              }).join('')}
            </div>
            ${GEAR_MULTI.map(g => `
              <div class="ag-sub">${g.label} <small>×${g.cap}</small></div>
              <div class="ag-multi">${Array.from({ length: g.cap }, (_, i) => renderSlot(g.slot, `${g.label}${i + 1}`, i + 1)).join('')}</div>
            `).join('')}
            <div class="ag-sub">技能书 <small>×${BOOK_CAP} · 来自后台「技能书」</small></div>
            <div class="ag-multi">${Array.from({ length: BOOK_CAP }, (_, i) => renderBookSlot(i + 1)).join('')}</div>
          </div>

          <div class="ag-col ag-right">
            <div class="ag-toolbar">
              <button type="button" class="btn btn-primary btn-sm" id="ag-add-equip">+ 装备入包</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-add-item">+ 物品入包</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-new-equip">新建装备</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-new-item">新建物品</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-new-book">新建技能书</button>
            </div>
            <div class="ag-filters">
              ${[{ id: 'all', label: '全部' }, { id: 'equipment', label: '装备' }, { id: 'item', label: '物品' }]
                .map(f => `<button type="button" class="ag-filter ${_invFilter === f.id ? 'active' : ''}" data-f="${f.id}">${f.label}</button>`).join('')}
              <input type="text" class="ag-search" placeholder="搜索名称..." value="${esc(_invSearch)}">
            </div>
            <div class="ag-inv" id="ag-inv">${renderInventory()}</div>
          </div>
        `;
        bindGear();
      }

      function renderGearStats() {
        const bonus = {};
        STAT_KEYS.forEach(k => bonus[k] = 0);
        _gearEquipped.forEach(ce => {
          const st = _parseJson(ce.equipment && ce.equipment.stat_bonuses);
          STAT_KEYS.forEach(k => { if (st[k]) bonus[k] += st[k]; });
        });
        return STAT_KEYS.map(k => {
          const base = Number(data[k] ?? 0);
          const b = bonus[k];
          return `<div class="ag-stat"><span>${STAT_LABEL[k]}</span><b>${base + b}</b>${b ? `<i class="up">+${b}</i>` : ''}</div>`;
        }).join('');
      }

      function renderBookList() {
        if (!_gearBooks.length) return '<div class="ag-empty">尚未装备技能书</div>';
        return _gearBooks.map(b => {
          const s = b.skill || {};
          return `<div class="ag-book-row">
            <span class="ag-book-idx">${b.slot_index}</span>
            <span class="ag-book-name">${esc(s.name || '#' + b.skill_id)}</span>
            ${s.is_ultimate ? '<em class="ag-ult">神通</em>' : ''}
            <span class="ag-book-meta">威${s.power || 0} MP${s.mp_cost || 0}${s.rage_cost ? ' 怒' + s.rage_cost : ''}</span>
          </div>`;
        }).join('');
      }

      function renderSlot(slotKey, label, idx) {
        const ce = _equippedAt(slotKey, idx);
        const eq = ce && ce.equipment;
        const filled = !!eq;
        return `<div class="ag-slot ${filled ? 'filled' : ''} ${eq && eq.rarity ? 'r-' + eq.rarity : ''}" data-slot="${slotKey}" data-idx="${idx}">
          ${filled
            ? `<div class="ag-slot-img">${eq.image ? `<img src="${eq.image}" alt="">` : esc((eq.name || '?')[0])}</div>
               <div class="ag-slot-name">${esc(eq.name)}</div>
               <button type="button" class="ag-slot-x" data-act="unequip" title="卸下">&times;</button>`
            : `<div class="ag-slot-add" data-act="pick">+</div>`}
          <div class="ag-slot-label">${label}</div>
        </div>`;
      }

      function renderBookSlot(idx) {
        const b = _bookAt(idx);
        const s = b && b.skill;
        return `<div class="ag-slot ag-slot-book ${s ? 'filled' : ''} ${s && s.is_ultimate ? 'is-ult' : ''}" data-book-idx="${idx}">
          ${s
            ? `<div class="ag-slot-img">${s.image ? `<img src="${s.image}" alt="">` : '书'}</div>
               <div class="ag-slot-name">${esc(s.name)}</div>
               <button type="button" class="ag-slot-x" data-act="unbook" title="卸下">&times;</button>`
            : `<div class="ag-slot-add" data-act="pickbook">+</div>`}
          <div class="ag-slot-label">技能书${idx}</div>
        </div>`;
      }

      function renderInventory() {
        let items = _gearInventory;
        if (_invFilter === 'equipment') items = items.filter(i => i.item_kind === 'equipment');
        if (_invFilter === 'item') items = items.filter(i => i.item_kind !== 'equipment');
        if (_invSearch) {
          const q = _invSearch.toLowerCase();
          items = items.filter(i => (i.name || '').toLowerCase().includes(q));
        }
        if (!items.length) return '<div class="ag-empty">背包为空 —— 用上方按钮把装备/物品加进来</div>';
        return items.map(inv => {
          const isEq = inv.item_kind === 'equipment';
          const sum = isEq ? _gearStatSummary(inv.stat_bonuses) : '';
          return `<div class="ag-inv-cell ${inv.rarity ? 'r-' + inv.rarity : ''}">
            <div class="ag-inv-icon">${inv.image ? `<img src="${inv.image}" alt="">` : esc((inv.name || '?')[0])}</div>
            <div class="ag-inv-info">
              <div class="ag-inv-name">${esc(inv.name)}</div>
              <div class="ag-inv-meta">
                <span class="ag-tag ${isEq ? 'eq' : 'it'}">${isEq ? '装备' : '物品'}</span>
                ${inv.item_type ? `<span class="ag-tag">${SLOT_LABELS[inv.item_type] || inv.item_type}</span>` : ''}
                ${sum ? `<span class="ag-inv-stat">${esc(sum)}</span>` : ''}
              </div>
            </div>
            <div class="ag-inv-ops">
              ${isEq ? `<button type="button" class="ag-op" data-act="equip" data-inv="${inv.id}">装备</button>` : ''}
              <button type="button" class="ag-op" data-act="qty" data-inv="${inv.id}" data-delta="-1">-</button>
              <span class="ag-qty">${inv.quantity}</span>
              <button type="button" class="ag-op" data-act="qty" data-inv="${inv.id}" data-delta="1">+</button>
              <button type="button" class="ag-op danger" data-act="del" data-inv="${inv.id}">×</button>
            </div>
          </div>`;
        }).join('');
      }

      function bindGear() {
        const root = document.getElementById('ag-root');
        if (!root) return;

        // 装备槽：点空槽选装备，点 × 卸下
        root.querySelectorAll('.ag-slot[data-slot]').forEach(el => {
          el.addEventListener('click', async (e) => {
            const slot = el.dataset.slot, idx = parseInt(el.dataset.idx);
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'unequip') {
              try {
                await Admin.del(`/equipments/character/${data.id}/slot/${slot}?slot_index=${idx}`);
                Admin.toast('已卸下', 'success');
                await loadGearPanel();
              } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
              return;
            }
            const picked = await Admin.Pickers.equipment({ multi: false, typeFilter: slot });
            if (!picked) return;
            const eq = Array.isArray(picked) ? picked[0] : picked;
            try {
              await Admin.post(`/equipments/character/${data.id}`, { equipment_id: eq.id, slot, slot_index: idx });
              // 装备后从背包里扣掉一件（与前台穿戴逻辑一致）
              const inv = _gearInventory.find(i => i.item_kind === 'equipment' && i.item_id === eq.id);
              if (inv) await Admin.del(`/items/character/${data.id}/inventory/${inv.id}`);
              Admin.toast('已装备：' + eq.name, 'success');
              await loadGearPanel();
            } catch (err) { Admin.toast('装备失败: ' + err.message, 'error'); }
          });
        });

        // 技能书槽
        root.querySelectorAll('.ag-slot[data-book-idx]').forEach(el => {
          el.addEventListener('click', async (e) => {
            const idx = parseInt(el.dataset.bookIdx);
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'unbook') {
              try {
                await Admin.del(`/skill-books/character/${data.id}/slot/${idx}`);
                Admin.toast('已卸下技能书', 'success');
                await loadGearPanel();
              } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
              return;
            }
            pickSkillBook(idx);
          });
        });

        // 背包操作
        root.querySelectorAll('.ag-op').forEach(btn => {
          btn.addEventListener('click', async () => {
            const act = btn.dataset.act, invId = parseInt(btn.dataset.inv);
            const inv = _gearInventory.find(i => i.id === invId);
            try {
              if (act === 'del') {
                await Admin.del(`/items/character/${data.id}/inventory/${invId}`);
                Admin.toast('已移除', 'success');
              } else if (act === 'qty') {
                const delta = parseInt(btn.dataset.delta);
                const next = (inv?.quantity || 0) + delta;
                await Admin.put(`/items/character/${data.id}/inventory/${invId}/quantity?quantity=${next}`);
              } else if (act === 'equip') {
                const slot = inv.item_type;
                if (!GEAR_CAP[slot]) { Admin.toast('该物品不能装备', 'error'); return; }
                await Admin.post(`/equipments/character/${data.id}`, { equipment_id: inv.item_id, slot });
                await Admin.del(`/items/character/${data.id}/inventory/${invId}`);
                Admin.toast('已装备：' + inv.name, 'success');
              }
              await loadGearPanel();
            } catch (err) { Admin.toast('操作失败: ' + err.message, 'error'); }
          });
        });

        // 筛选 / 搜索
        root.querySelectorAll('.ag-filter').forEach(b => {
          b.addEventListener('click', () => { _invFilter = b.dataset.f; renderGear(); });
        });
        const search = root.querySelector('.ag-search');
        if (search) {
          search.addEventListener('input', (e) => {
            _invSearch = e.target.value;
            const inv = document.getElementById('ag-inv');
            if (inv) inv.innerHTML = renderInventory();
          });
        }

        // 工具栏
        document.getElementById('ag-add-equip')?.addEventListener('click', async () => {
          const picked = await Admin.Pickers.equipment({ multi: true });
          const list = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
          if (!list.length) return;
          let ok = 0;
          for (const eq of list) {
            try {
              await Admin.post(`/items/character/${data.id}/inventory`, { item_id: eq.id, item_kind: 'equipment', quantity: 1 });
              ok++;
            } catch (_) {}
          }
          Admin.toast(`已加入背包 ${ok} 件装备`, ok ? 'success' : 'error');
          await loadGearPanel();
        });
        document.getElementById('ag-add-item')?.addEventListener('click', async () => {
          const picked = await Admin.Pickers.item({ multi: true });
          const list = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
          if (!list.length) return;
          let ok = 0;
          for (const it of list) {
            try {
              await Admin.post(`/items/character/${data.id}/inventory`, { item_id: it.id, item_kind: 'item', quantity: 1 });
              ok++;
            } catch (_) {}
          }
          Admin.toast(`已加入背包 ${ok} 个物品`, ok ? 'success' : 'error');
          await loadGearPanel();
        });
        document.getElementById('ag-new-equip')?.addEventListener('click', () => showCreateEquipmentModal(data.id, true));
        document.getElementById('ag-new-item')?.addEventListener('click', () => showCreateItemModal(data.id, true));
        document.getElementById('ag-new-book')?.addEventListener('click', () => showCreateSkillBookModal());
      }

      // 选择一本后台「技能书」装到指定槽位
      function pickSkillBook(idx) {
        const opts = _gearSkills.map(s =>
          `<option value="${s.id}">${esc(s.name)}${s.is_ultimate ? '（神通）' : ''} · 威${s.power || 0} MP${s.mp_cost || 0}</option>`).join('');
        Admin.showModal(`装备技能书到槽位 ${idx}`, `
          <div class="form-group">
            <label>从后台「技能书」中选择</label>
            <select id="ag-book-sel">${opts || '<option value="">（后台技能书库为空，请先新建）</option>'}</select>
            <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">
              技能书 = 后台「技能书」栏目里的一条记录；装什么书，战斗就能用什么功法。
            </span>
          </div>`, async () => {
          const sid = parseInt(document.getElementById('ag-book-sel')?.value);
          if (!sid) { Admin.toast('请选择一本技能书', 'error'); return; }
          try {
            await Admin.post(`/skill-books/character/${data.id}`, { skill_id: sid, slot_index: idx });
            Admin.toast('技能书已装备', 'success');
            Admin.closeModal();
            await loadGearPanel();
          } catch (e) { Admin.toast('装备失败: ' + e.message, 'error'); }
        });
      }

      // 新建一本技能书（写入后台「技能书」库）
      function showCreateSkillBookModal() {
        Admin.showModal('新建技能书', `
          <div class="form-group"><label>名称 *</label><input name="name" required placeholder="如：九霄雷动诀"></div>
          <div class="form-row">
            <div class="form-group"><label>类型</label>
              <select name="skill_type"><option value="physical">物理</option><option value="magic">魔法</option><option value="special">特殊</option><option value="passive">被动</option></select></div>
            <div class="form-group"><label>是否神通</label>
              <select name="is_ultimate"><option value="0">普通技能</option><option value="1">神通（消耗怒气）</option></select></div>
          </div>
          <div class="form-row form-row-3">
            <div class="form-group"><label>威力</label><input name="power" type="number" value="100"></div>
            <div class="form-group"><label>MP消耗</label><input name="mp_cost" type="number" value="0"></div>
            <div class="form-group"><label>怒气消耗</label><input name="rage_cost" type="number" value="0"></div>
          </div>
          <div class="form-group"><label>描述</label><textarea name="description"></textarea></div>
        `, async () => {
          const fd = Admin.getFormData('.modal-body');
          if (!fd.name || !fd.name.trim()) { Admin.toast('请填写名称', 'error'); return; }
          try {
            const sk = await Admin.post('/skills', {
              name: fd.name.trim(), skill_type: fd.skill_type || 'physical',
              power: parseInt(fd.power || 0), mp_cost: parseInt(fd.mp_cost || 0),
              rage_cost: parseInt(fd.rage_cost || 0),
              is_ultimate: parseInt(fd.is_ultimate || 0),
              description: fd.description || null,
            });
            Admin.toast('技能书已创建：' + sk.name, 'success');
            Admin.closeModal();
            await loadGearPanel();
          } catch (e) { Admin.toast('创建失败: ' + e.message, 'error'); }
        });
      }

