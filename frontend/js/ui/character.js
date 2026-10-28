// ========== 人物面板（完全复刻暗黑风参考页） ==========
// 左：人物属性（ATK/DEF/REC/SPR/SPD/CRIT + 悬停数值变化）+ 神通词条
// 中：立绘（正常比例）+ 7 个身体部位装备槽环绕 + 法宝(4) + 技能书(4)
// 右：背包（筛选 全部/装备/法宝/技能书 + 搜索 + 大字号网格）
// 交互：悬停看数值变化、拖拽穿戴（含神通）、右键操作

const CharacterPanel = {
    _player: null,
    _charEquipment: [],   // 已装备（含 equipment 详情）
    _inventory: [],       // 背包（含物品详情）
    _attributes: [],      // 附加属性（character_attributes）
    _baseChar: null,      // 基础人物模板（含 recovery/spirit/crit_rate）
    _container: null,
    _cleanupBound: false,

    _filterType: 'all',   // all | equip | artifact | skill
    _searchText: '',
    _hovered: null,       // { item, source } 当前悬停物品
    _hoverKey: '',        // 去重：inv:<id> / equip:<slot>:<idx>
    _dragging: false,
    _dragData: null,      // { source, inv?, slot?, slotIndex?, equipmentId, type }
    _dragGhost: null,     // 跟随鼠标的拖拽幽灵元素
    _menuOpen: false,

    // 7 个身体部位（槽位环绕立绘，使用百分比定位 → 立绘高度随窗口自适应，永远一页显示）
    EQUIP_PARTS: [
        { slot: 'head',      label: '头部', pos: 'top:0; left:0;' },
        { slot: 'shoulders', label: '护肩', pos: 'top:0; right:0;' },
        { slot: 'weapon',    label: '武器', pos: 'top:31%; left:0;' },
        { slot: 'chest',     label: '胸甲', pos: 'top:31%; right:0;' },
        { slot: 'gloves',    label: '手套', pos: 'top:62%; left:0;' },
        { slot: 'pants',     label: '护腿', pos: 'top:62%; right:0;' },
        { slot: 'boots',     label: '靴子', pos: 'bottom:0; right:8%;' },
    ],
    MULTI_SLOTS: [
        { slot: 'artifact', label: '法宝', cap: 4 },
        { slot: 'skill',    label: '技能书', cap: 4 },
    ],
    SLOT_CAPACITY: { weapon: 1, head: 1, shoulders: 1, chest: 1, gloves: 1, pants: 1, boots: 1, artifact: 4, skill: 4 },

    STAT_KEYS: ['atk', 'def', 'recovery', 'spirit', 'speed', 'critRate'],
    EXTRA_STAT_KEYS: ['max_hp', 'max_mp', 'luck'],
    STAT_LABEL: { atk: '攻击', def: '防御', recovery: '恢复', spirit: '精神', speed: '速度', critRate: '暴击率', max_hp: '最大生命', max_mp: '最大灵力', luck: '幸运' },
    STAT_ABBR:  { atk: 'ATK', def: 'DEF', recovery: 'REC', spirit: 'SPR', speed: 'SPD', critRate: 'CRIT', max_hp: 'HP', max_mp: 'MP', luck: 'LUK' },
    STAT_SHORT: { atk: '攻', def: '防', recovery: '恢', spirit: '精', speed: '速', critRate: '爆', max_hp: '命', max_mp: '灵', luck: '运' },
    STAT_PCT:   { critRate: true },
    RARITY_LABEL: { common: '普通', uncommon: '精良', rare: '稀有', epic: '史诗', legendary: '传说' },
    RARITY_RANK:  { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 },
    TYPE_LABEL: { weapon: '武器', head: '头部', shoulders: '护肩', chest: '胸甲', gloves: '手套', pants: '护腿', boots: '靴子', artifact: '法宝', skill: '技能书' },
    TYPE_CHAR:  { weapon: '武', head: '盔', shoulders: '肩', chest: '甲', gloves: '腕', pants: '腿', boots: '靴', artifact: '宝', skill: '书' },

    async show() {
        const body = document.querySelector('#panel-body');
        this._container = body;

        if (!GameState.player) {
            body.innerHTML = '<p style="color:var(--text-dim);padding:20px">未加载玩家数据</p>';
            this._enterFullscreen();
            Utils.show('#panel-overlay');
            return;
        }
        if (!GameState.player.uc_id) {
            body.innerHTML = '<p style="color:var(--text-dim);padding:20px">当前角色非用户角色，无法管理装备/背包</p>';
            this._enterFullscreen();
            Utils.show('#panel-overlay');
            return;
        }

        this._player = GameState.player;
        body.innerHTML = '<p style="color:var(--text-dim);padding:20px">加载中...</p>';
        this._enterFullscreen();
        Utils.show('#panel-overlay');

        try {
            await this._refreshData();
        } catch (e) {
            console.warn('加载装备/背包数据失败:', e);
        }
        this._renderPanel(body);
    },

    _enterFullscreen() {
        const content = document.querySelector('#panel-content');
        const body = document.querySelector('#panel-body');
        content.classList.add('fullscreen');
        body.classList.add('fullscreen-body');
        if (!this._cleanupBound) {
            const cleanup = () => {
                content.classList.remove('fullscreen');
                body.classList.remove('fullscreen-body');
                this._destroyTooltip();
            };
            document.querySelector('#panel-close').addEventListener('click', cleanup);
            document.querySelector('#panel-overlay').addEventListener('click', (e) => {
                if (e.target === e.currentTarget) cleanup();
            });
            this._cleanupBound = true;
        }
    },

    async _refreshData() {
        const ucId = this._player.uc_id;
        const baseId = this._player.base_id;
        const [charEquip, inventory, attributes, baseChar, skills, books] = await Promise.all([
            API.games.getCharEquipments(ucId).catch(() => []),
            API.games.getCharInventory(ucId).catch(() => []),
            (baseId ? API.characters.getAttributes(baseId) : Promise.resolve([])).catch(() => []),
            (baseId ? API.characters.get(baseId) : Promise.resolve(null)).catch(() => null),
            API.skills.list().catch(() => []),
            API.skillBooks.ofUserCharacter(ucId).catch(() => []),
        ]);
        this._charEquipment = charEquip;
        this._inventory = inventory;
        this._attributes = attributes || [];
        this._baseChar = baseChar;
        // 技能字典：用于判断技能书是否为「神通」(终极技)，便于显示「通」前缀
        this._skillsMap = {};
        (skills || []).forEach(s => { this._skillsMap[s.id] = s; });
        // 已装备技能书（后台「技能书」栏目维护，前后台同一份数据）
        this._skillBooks = (books || []).map(b => ({
            id: b.id,
            skill_id: b.skill_id,
            slot_index: b.slot_index || 1,
            skill: b.skill || this._skillsMap[b.skill_id] || null,
        }));
    },

    // 取某槽位的技能书（后台数据源；没建过则回退旧 equipment 型技能书）
    _getSkillBook(index) {
        const b = (this._skillBooks || []).find(x => (x.slot_index || 1) === index);
        if (b) return b;
        const legacy = this._getEquipped('skill', index);
        if (legacy && legacy.equipment) {
            return { id: legacy.id, slot_index: index, equipment: legacy.equipment, skill: null };
        }
        return null;
    },

    // 把技能书归一化成卡片可渲染的对象
    _bookAsItem(book) {
        if (!book) return null;
        if (book.equipment) return book.equipment;
        const sk = book.skill || {};
        return {
            id: sk.id,
            name: sk.name || '技能书',
            image: sk.image || '',
            rarity: sk.is_ultimate ? 'legendary' : 'rare',
            description: sk.description || '',
            equipment_type: 'skill',
            skill_ids: JSON.stringify([book.skill_id]),
        };
    },

    // 判断一件装备(技能书)是否为神通（终极技）
    _isUltimateBook(eq) {
        if (!eq || !eq.skill_ids) return false;
        try {
            const ids = JSON.parse(eq.skill_ids);
            return ids.some(id => this._skillsMap[id] && this._skillsMap[id].is_ultimate);
        } catch { return false; }
    },

    // ===================== 渲染 =====================
    _renderPanel(container) {
        container.innerHTML = `
            <div class="cp2-root">
                ${this._renderLeft()}
                ${this._renderCenter()}
                ${this._renderRight()}
            </div>
            <div id="cp2-context-menu" class="cp2-ctx-menu hidden"></div>
        `;
        this._bindEvents(container);
    },

    // ---------- 左栏：属性 + 神通词条 ----------
    _renderLeft() {
        return `
            <div class="cp2-left">
                <div class="cp2-panel-title">人物属性</div>
                <div class="cp2-left-body">
                    ${this._renderVitals()}
                    <div class="cp2-block-title">战斗属性</div>
                    <div class="cp2-stats" id="cp2-stats">${this._renderStatsBody(null)}</div>
                    ${this._renderSkillWords()}
                    ${this._renderAttributes()}
                </div>
            </div>
        `;
    },

    _renderVitals() {
        const p = this._player;
        const hpPct = p.max_hp ? Math.round((p.hp / p.max_hp) * 100) : 100;
        const mpPct = p.max_mp ? Math.round((p.mp / p.max_mp) * 100) : 100;
        return `
            <div class="cp2-vitals">
                <div class="cp2-vital-row">
                    <span class="cp2-vital-lbl">HP</span>
                    <div class="cp2-vital-track"><div class="cp2-vital-fill hp" style="width:${hpPct}%"></div></div>
                    <span class="cp2-vital-val">${p.hp}/${p.max_hp}</span>
                </div>
                <div class="cp2-vital-row">
                    <span class="cp2-vital-lbl">MP</span>
                    <div class="cp2-vital-track"><div class="cp2-vital-fill mp" style="width:${mpPct}%"></div></div>
                    <span class="cp2-vital-val">${p.mp}/${p.max_mp}</span>
                </div>
            </div>
        `;
    },

    _baseStats() {
        const b = this._baseChar || {};
        const p = this._player || {};
        return {
            atk: b.attack ?? p.attack ?? 0,
            def: b.defense ?? p.defense ?? 0,
            recovery: b.recovery ?? 0,
            spirit: b.spirit ?? 0,
            speed: b.speed ?? p.speed ?? 0,
            critRate: b.crit_rate ?? 0,
        };
    },

    _parseStats(s) {
        if (!s) return {};
        try { return JSON.parse(s) || {}; } catch { return {}; }
    },

    _equipBonus() {
        const bonus = {};
        this.STAT_KEYS.forEach(k => bonus[k] = 0);
        this._charEquipment.forEach(ce => {
            const eq = ce.equipment;
            if (!eq || !eq.stat_bonuses) return;
            const st = this._parseStats(eq.stat_bonuses);
            this.STAT_KEYS.forEach(k => { if (st[k]) bonus[k] += st[k]; });
        });
        return bonus;
    },

    _currentStats() {
        const base = this._baseStats();
        const bonus = this._equipBonus();
        const out = {};
        this.STAT_KEYS.forEach(k => { out[k] = Math.max(0, (base[k] || 0) + (bonus[k] || 0)); });
        return out;
    },

    // 悬停背包物品时，计算替换后的属性差值
    _diffFor(item) {
        if (!item) return null;
        const type = item.item_type || (item.equipment && item.equipment.equipment_type);
        const stats = this._parseStats(item.stat_bonuses);
        if (!type || Object.keys(stats).length === 0) return null;

        const current = this._currentStats();
        const newStats = { ...current };

        let replaced = null;
        if (this.SLOT_CAPACITY[type] === 1) {
            replaced = this._getEquipped(type, 1);
        } else {
            // 法宝/神通：取空位或最低品质占用位
            const cap = this.SLOT_CAPACITY[type];
            const occ = this._slotItems(type);
            const used = new Set(occ.map(c => c.slot_index || 1));
            let emptyIdx = null;
            for (let i = 1; i <= cap; i++) if (!used.has(i)) { emptyIdx = i; break; }
            if (emptyIdx !== null) {
                replaced = null;
            } else {
                replaced = occ.reduce((lo, c) =>
                    (this.RARITY_RANK[c.equipment?.rarity] ?? 99) < (this.RARITY_RANK[lo.equipment?.rarity] ?? 99) ? c : lo);
            }
        }
        const repStats = replaced ? this._parseStats(replaced.equipment.stat_bonuses) : {};
        this.STAT_KEYS.forEach(k => {
            newStats[k] = Math.max(0, newStats[k] - (repStats[k] || 0) + (stats[k] || 0));
        });
        const diff = {};
        this.STAT_KEYS.forEach(k => { const d = newStats[k] - current[k]; if (d !== 0) diff[k] = d; });
        return diff;
    },

    _renderStatsBody(diffItem) {
        const current = this._currentStats();
        const diff = diffItem ? this._diffFor(diffItem) : null;
        return this.STAT_KEYS.map(k => {
            const val = current[k];
            const d = diff ? (diff[k] || 0) : 0;
            const isPct = k === 'critRate';
            const suffix = isPct ? '%' : '';
            if (d !== 0) {
                const newVal = val + d;
                return `
                    <div class="cp2-stat-row changed" data-stat="${k}">
                        <span class="cp2-stat-lbl">${this.STAT_LABEL[k]} <i>${this.STAT_ABBR[k]}</i></span>
                        <span class="cp2-stat-val">
                            <span class="cp2-stat-old">${val}${suffix}</span>
                            <span class="cp2-stat-arrow">→</span>
                            <span class="cp2-stat-new ${d > 0 ? 'up' : 'down'}">${newVal}${suffix}</span>
                            <span class="cp2-stat-diff ${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${d})</span>
                        </span>
                    </div>`;
            }
            return `
                <div class="cp2-stat-row" data-stat="${k}">
                    <span class="cp2-stat-lbl">${this.STAT_LABEL[k]} <i>${this.STAT_ABBR[k]}</i></span>
                    <span class="cp2-stat-val"><span class="cp2-stat-cur">${val}${suffix}</span></span>
                </div>`;
        }).join('');
    },

    // 已装备技能书：数据源为后台「技能书」(skills)，不再使用词条
    _skillWords() {
        const out = [];
        for (let i = 1; i <= 4; i++) {
            const book = this._getSkillBook(i);
            if (!book) continue;
            const sk = book.skill || this._skillsMap[book.skill_id];
            const granted = sk ? [sk] : [];
            if (!sk && book.equipment) {
                try {
                    JSON.parse(book.equipment.skill_ids || '[]').forEach(id => {
                        const s = this._skillsMap[id];
                        if (s) granted.push(s);
                    });
                } catch (e) { /* ignore */ }
            }
            out.push({
                name: sk ? sk.name : (book.equipment ? book.equipment.name : '技能书'),
                desc: sk ? (sk.description || '') : (book.equipment ? (book.equipment.description || '') : ''),
                isUltimate: granted.some(s => s.is_ultimate),
                skills: granted,
                slot: i,
            });
        }
        return out;
    },

    _renderSkillWords() {
        const books = this._skillWords();
        const body = books.length === 0
            ? '<p class="cp2-empty-hint">尚未装备技能书</p>'
            : `<ul class="cp2-word-list">${books.map(b => `
                  <li>
                    <span class="cp2-word-char ${b.isUltimate ? 'is-ult' : ''}">${b.isUltimate ? '通' : '书'}</span>
                    <span class="cp2-word-name">${this._esc(b.name)}${b.isUltimate ? ' <em class="cp2-ult-tag">神通</em>' : ''}</span>
                    ${b.skills.length
                        ? `<div class="cp2-word-skills">授予功法：${b.skills.map(s => `<span class="cp2-skill-chip ${s.is_ultimate ? 'is-ult' : ''}">${this._esc(s.name)}${s.is_ultimate ? '·神通' : ''}</span>`).join('')}</div>`
                        : '<div class="cp2-word-desc" style="color:var(--text-muted)">（该书未配置授予技能）</div>'}
                    ${b.desc ? `<div class="cp2-word-desc">说明：${this._esc(b.desc)}</div>` : ''}
                  </li>`).join('')}</ul>`;
        return `
            <div class="cp2-block-title">技能书 / 神通</div>
            <div class="cp2-block-hint">这里的数据来自后台「技能书」栏目。装什么书，战斗就能用什么功法。</div>
            ${body}
        `;
    },

    _renderAttributes() {
        if (!this._attributes || this._attributes.length === 0) return '';
        const rows = this._attributes.map(a =>
            `<div class="cp2-attr-row"><span>${this._esc(a.attr_key)}</span><span>${a.attr_value}</span></div>`).join('');
        return `
            <div class="cp2-block-title">附加属性</div>
            <div class="cp2-attr-list">${rows}</div>
        `;
    },

    // ---------- 中栏：立绘 + 装备槽 ----------
    _renderCenter() {
        const p = this._player;
        const portraitStyle = p.portrait_image
            ? `background-image:url('${p.portrait_image}');`
            : '';
        const portraitInner = p.portrait_image
            ? ''
            : `<div class="cp2-portrait-empty">${(p.name || '?')[0]}</div>`;

        const partSlots = this.EQUIP_PARTS.map(part => {
            const ce = this._getEquipped(part.slot, 1);
            return this._renderSlot(part.slot, ce ? ce.equipment : null, part.label, 1, false, part.pos);
        }).join('');

        const artifactHtml = this.MULTI_SLOTS[0];
        const skillHtml = this.MULTI_SLOTS[1];

        const renderMulti = (cfg) => {
            let html = '';
            for (let i = 1; i <= cfg.cap; i++) {
                if (cfg.slot === 'skill') {
                    // 技能书槽：数据来自后台「技能书」库
                    const book = this._getSkillBook(i);
                    const item = this._bookAsItem(book);
                    const name = item ? item.name : `${cfg.label}${i}`;
                    html += this._renderSlot(cfg.slot, item, name, i, true, '');
                } else {
                    const ce = this._getEquipped(cfg.slot, i);
                    html += this._renderSlot(cfg.slot, ce ? ce.equipment : null, `${cfg.label}${i}`, i, true, '');
                }
            }
            return `<div class="cp2-multi-row">${html}</div>`;
        };

        return `
            <div class="cp2-center">
                <div class="cp2-char-name">${this._esc(p.name || '')}<span class="cp2-char-lv">Lv.${p.level || 1} · ${p.realm_level || 1}境</span></div>
                <div class="cp2-portrait-stage">
                    <div class="cp2-portrait-bg" style="${portraitStyle}">
                        <div class="cp2-portrait-grad"></div>
                        ${portraitInner}
                    </div>
                    ${partSlots}
                </div>
                <div class="cp2-sub-title">${artifactHtml.label} <small>提升恢复 / 速度 / 暴击</small></div>
                ${renderMulti(artifactHtml)}
                <div class="cp2-sub-title">${skillHtml.label} <small>来自后台「技能书」· 装什么书，战斗就用什么功法</small></div>
                ${renderMulti(skillHtml)}
            </div>
        `;
    },

    _renderSlot(slotKey, item, label, slotIndex, isMulti, posStyle) {
        const rarity = item && item.rarity ? item.rarity : '';
        const char = this.TYPE_CHAR[slotKey] || '?';
        // 技能书若为终极技(神通)，显示「通」角标
        const isUlt = slotKey === 'skill' && this._isUltimateBook(item);
        const ultBadge = isUlt ? '<span class="cp2-ult-badge" title="神通·终极技">通</span>' : '';
        const inner = item
            ? `<div class="cp2-slot-item" draggable="true" data-hover="equip" data-slot="${slotKey}" data-slot-index="${slotIndex}">
                   ${item.image
                        ? `<img src="${item.image}" alt="">`
                        : `<span class="cp2-slot-char">${char}</span>`}
                   ${ultBadge}
               </div>`
            : `<span class="cp2-slot-char">${char}</span>`;
        return `
            <div class="cp2-slot ${rarity ? 'r2-' + rarity : ''} ${isMulti ? 'cp2-slot-multi' : ''} ${isUlt ? 'cp2-slot-ult' : ''}"
                 data-drop="1" data-slot="${slotKey}" data-slot-index="${slotIndex}" style="${posStyle || ''}">
                ${inner}
                <span class="cp2-slot-label">${label}</span>
            </div>`;
    },

    _getEquipped(slot, index) {
        return this._charEquipment.find(ce => ce.slot === slot && (ce.slot_index || 1) === index);
    },
    _slotItems(slot) {
        return this._charEquipment.filter(ce => ce.slot === slot);
    },

    // ---------- 右栏：背包 ----------
    _renderRight() {
        return `
            <div class="cp2-right">
                <div class="cp2-right-head">
                    <div class="cp2-panel-title">背包 <span class="cp2-inv-count">${this._inventory.length}</span></div>
                    <div class="cp2-filters">
                        ${[{ id: 'all', label: '全部' }, { id: 'equip', label: '装备' }, { id: 'artifact', label: '法宝' }, { id: 'skill', label: '技能书' }]
                            .map(f => `<button class="cp2-filter-btn ${this._filterType === f.id ? 'active' : ''}" data-filter="${f.id}">${f.label}</button>`).join('')}
                    </div>
                    <div class="cp2-search">
                        <input type="text" class="cp2-search-input" placeholder="搜索物品名称..." value="${this._esc(this._searchText)}">
                    </div>
                </div>
                <div class="cp2-inv-grid" id="cp2-inv-grid">${this._renderInventory()}</div>
                <div class="cp2-hint">悬停看数值变化 · 拖拽时可用槽位会发光、接触槽位立即高亮 · 右键操作</div>
            </div>
        `;
    },

    _getFilteredInventory() {
        let items = this._inventory;
        if (this._filterType === 'equip') {
            items = items.filter(i => i.item_kind === 'equipment' && !['artifact', 'skill'].includes(i.item_type));
        } else if (this._filterType === 'artifact') {
            items = items.filter(i => i.item_kind === 'equipment' && i.item_type === 'artifact');
        } else if (this._filterType === 'skill') {
            items = items.filter(i => i.item_kind === 'equipment' && i.item_type === 'skill');
        }
        if (this._searchText) {
            const q = this._searchText.toLowerCase();
            items = items.filter(i => (i.name || '').toLowerCase().includes(q));
        }
        return items;
    },

    // 属性摘要（背包卡片上的一行小字，如 "攻+34 防+6"）
    _statSummary(item) {
        const stats = this._parseStats(item && item.stat_bonuses);
        const keys = [...this.STAT_KEYS, ...this.EXTRA_STAT_KEYS];
        const parts = [];
        keys.forEach(k => {
            const v = stats[k];
            if (!v) return;
            parts.push(`${this.STAT_SHORT[k] || k}${v > 0 ? '+' : ''}${v}`);
        });
        return parts.join(' ');
    },

    _renderInventory() {
        const items = this._getFilteredInventory();
        if (items.length === 0) {
            return '<div class="cp2-inv-empty">背包空空如也</div>';
        }
        return items.map(inv => {
            const isEquip = inv.item_kind === 'equipment';
            const rarity = inv.rarity || 'common';
            const char = this.TYPE_CHAR[inv.item_type] || '?';
            const img = inv.image
                ? `<img src="${inv.image}" alt="">`
                : `<span class="cp2-inv-char">${char}</span>`;
            const qty = inv.quantity > 1 ? `<span class="cp2-inv-qty">×${inv.quantity}</span>` : '';
            const summary = this._statSummary(inv);
            const typeLabel = this.TYPE_LABEL[inv.item_type] || '';
            return `
                <div class="cp2-inv-cell r2-${rarity}" data-hover="inv" data-inv-id="${inv.id}" ${isEquip ? 'draggable="true"' : ''}>
                    <div class="cp2-inv-icon">${img}</div>
                    <div class="cp2-inv-info">
                        <div class="cp2-inv-name">${this._esc(inv.name || '')}</div>
                        <div class="cp2-inv-meta">
                            ${typeLabel ? `<span class="cp2-inv-type">${typeLabel}</span>` : ''}
                            ${summary ? `<span class="cp2-inv-stat">${this._esc(summary)}</span>` : ''}
                        </div>
                    </div>
                    ${qty}
                </div>`;
        }).join('');
    },

    // ---------- 悬停提示 ----------
    _tooltipHtml(item) {
        if (!item) return '';
        const stats = this._parseStats(item.stat_bonuses);
        const statRows = [...this.STAT_KEYS, ...this.EXTRA_STAT_KEYS]
            .filter(k => stats[k])
            .map(k => `<div class="cp2-tt-row"><span>${this.STAT_LABEL[k]}</span><span class="${stats[k] > 0 ? 'up' : 'down'}">${stats[k] > 0 ? '+' : ''}${stats[k]}${this.STAT_PCT[k] ? '%' : ''}</span></div>`)
            .join('');
        const affix = item.description
            ? `<div class="cp2-tt-affix"><i>✦</i> ${this._esc(item.description)}</div>` : '';
        const typeLabel = this.TYPE_LABEL[item.item_type] || item.equipment_type || '';
        return `
            <div class="cp2-tt-name ${item.rarity ? 'r2-text-' + item.rarity : ''}">${this._esc(item.name || '')}</div>
            <div class="cp2-tt-meta">${this.RARITY_LABEL[item.rarity] || item.rarity || ''} · ${typeLabel}</div>
            ${statRows ? `<div class="cp2-tt-stats">${statRows}</div>` : ''}
            ${affix}
        `;
    },

    _ensureTooltip() {
        let el = document.getElementById('cp2-tooltip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'cp2-tooltip';
            el.className = 'cp2-tooltip hidden';
            document.body.appendChild(el);
        }
        return el;
    },
    _destroyTooltip() {
        const el = document.getElementById('cp2-tooltip');
        if (el) el.remove();
        this._hovered = null;
        this._hoverKey = '';
        this._killDragGhost();
        document.body.classList.remove('cp2-dragging-active');
    },

    // 只刷新左侧属性面板的预览（拖拽接触槽位时用，不弹 tooltip）
    _previewStats(item) {
        const statsEl = document.getElementById('cp2-stats');
        if (statsEl) statsEl.innerHTML = this._renderStatsBody(item);
    },

    _showHover(item, source) {
        this._hovered = { item, source };
        const tip = this._ensureTooltip();
        tip.innerHTML = this._tooltipHtml(item);
        tip.classList.remove('hidden');
        if (source === 'inventory') this._previewStats(item);
    },
    _clearHover() {
        this._hovered = null;
        this._hoverKey = '';
        const tip = document.getElementById('cp2-tooltip');
        if (tip) tip.classList.add('hidden');
        this._previewStats(null);
    },

    // ===================== 拖拽视觉反馈 =====================
    // 现在悬停的槽位能否接收当前拖拽物
    _canDropOn(slotKey, d) {
        if (!d || !slotKey) return false;
        if (!this.SLOT_CAPACITY[slotKey]) return false;
        // 装备 → 同类型槽位；已装备之间 → 同类型槽位（用于法宝/神通内部换位）
        return d.type === slotKey;
    },

    _startDragFeedback(e, d, item) {
        document.body.classList.add('cp2-dragging-active');
        this._clearHover();               // 清掉拖拽前的悬停提示，避免残留
        this._makeDragGhost(item, d.type);
        // 隐藏浏览器默认的拖拽缩略图（用我们的幽灵代替）
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1; canvas.height = 1;
            e.dataTransfer.setDragImage(canvas, 0, 0);
        } catch (_) { /* 忽略 */ }
        // 高亮所有可放置的槽位（脉冲提示"这里可以放"）
        const root = this._container.querySelector('.cp2-root');
        if (root) {
            root.querySelectorAll('.cp2-slot[data-drop]').forEach(slot => {
                slot.classList.remove('dragover', 'dragover-invalid');
                if (this._canDropOn(slot.dataset.slot, d)) slot.classList.add('drop-candidate');
            });
        }
    },

    _endDragFeedback() {
        this._dragging = false;
        this._dragData = null;
        document.body.classList.remove('cp2-dragging-active');
        this._killDragGhost();
        const root = this._container ? this._container.querySelector('.cp2-root') : null;
        if (root) {
            root.querySelectorAll('.cp2-dragging').forEach(c => c.classList.remove('cp2-dragging'));
            root.querySelectorAll('.cp2-slot').forEach(c => c.classList.remove('dragover', 'dragover-invalid', 'drop-candidate'));
            root.querySelectorAll('.cp2-inv-grid').forEach(c => c.classList.remove('dragover'));
        }
        this._previewStats(null);
    },

    _makeDragGhost(item, type) {
        this._killDragGhost();
        if (!item) return;
        const char = this.TYPE_CHAR[type] || '?';
        const el = document.createElement('div');
        el.id = 'cp2-drag-ghost';
        el.innerHTML = `<span class="g-icon">${item.image ? `<img src="${item.image}" alt="">` : `<span>${char}</span>`}</span><b>${this._esc(item.name || '')}</b>`;
        el.style.left = '-9999px';
        el.style.top = '-9999px';
        document.body.appendChild(el);
        this._dragGhost = el;
    },
    _moveDragGhost(x, y) {
        if (!this._dragGhost) return;
        this._dragGhost.style.left = x + 'px';
        this._dragGhost.style.top = y + 'px';
        // 跟随鼠标时避免贴边溢出
        if (x < 60) this._dragGhost.style.transform = 'translate(0, -50%)';
        else this._dragGhost.style.transform = 'translate(-50%, -50%)';
    },
    _killDragGhost() {
        if (this._dragGhost) { this._dragGhost.remove(); this._dragGhost = null; }
        document.querySelectorAll('#cp2-drag-ghost').forEach(n => n.remove());
    },

    // ===================== 事件 =====================
    _bindEvents(container) {
        const root = container.querySelector('.cp2-root');
        if (!root) return;

        // ---- 悬停（委托）----
        root.addEventListener('mouseover', (e) => {
            if (this._dragging) return;
            const el = e.target.closest('[data-hover]');
            if (!el) { this._clearHover(); return; }
            const kind = el.dataset.hover;
            if (kind === 'inv') {
                const inv = this._inventory.find(i => String(i.id) === String(el.dataset.invId));
                if (!inv) return;
                const key = 'inv:' + inv.id;
                if (this._hoverKey === key) return;
                this._hoverKey = key;
                this._showHover(inv, 'inventory');
            } else if (kind === 'equip') {
                const ce = this._getEquipped(el.dataset.slot, parseInt(el.dataset.slotIndex));
                if (!ce || !ce.equipment) return;
                const key = 'equip:' + ce.slot + ':' + ce.slot_index;
                if (this._hoverKey === key) return;
                this._hoverKey = key;
                this._showHover(ce.equipment, 'equipped');
            }
        });
        root.addEventListener('mouseout', (e) => {
            const el = e.target.closest('[data-hover]');
            if (!el) return;
            if (e.relatedTarget && el.contains(e.relatedTarget)) return;
            this._clearHover();
        });

        // ---- 拖拽开始（委托）----
        root.addEventListener('dragstart', (e) => {
            const cell = e.target.closest('.cp2-inv-cell');
            if (cell && cell.dataset.invId) {
                const inv = this._inventory.find(i => String(i.id) === String(cell.dataset.invId));
                if (!inv) return;
                this._dragging = true;
                this._dragData = { source: 'inventory', inv, equipmentId: inv.item_id, type: inv.item_type };
                cell.classList.add('cp2-dragging');
                this._startDragFeedback(e, this._dragData, inv);
                try { e.dataTransfer.setData('text/plain', 'inv:' + inv.id); e.dataTransfer.effectAllowed = 'move'; } catch {}
                return;
            }
            const slotItem = e.target.closest('.cp2-slot-item');
            if (slotItem) {
                const slot = slotItem.dataset.slot;
                const idx = parseInt(slotItem.dataset.slotIndex);
                const ce = this._getEquipped(slot, idx);
                if (!ce) return;
                this._dragging = true;
                this._dragData = { source: 'equipped', slot, slotIndex: idx, equipmentId: ce.equipment_id, type: slot };
                slotItem.classList.add('cp2-dragging');
                this._startDragFeedback(e, this._dragData, ce.equipment);
                try { e.dataTransfer.setData('text/plain', 'equip:' + slot + ':' + idx); e.dataTransfer.effectAllowed = 'move'; } catch {}
            }
        });
        root.addEventListener('dragend', () => this._endDragFeedback());

        // ---- 槽位作为放置目标（接触反馈：同类高亮 + 放置按钮 / 异类红框抖动）----
        root.querySelectorAll('.cp2-slot[data-drop]').forEach(slot => {
            const slotType = slot.dataset.slot;
            const slotIndex = parseInt(slot.dataset.slotIndex);
            slot.addEventListener('dragover', (e) => {
                // 必须 preventDefault 才允许放下；类型不匹配也允许放下，由业务层给出提示
                e.preventDefault();
                const d = this._dragData;
                if (!d) return;
                e.dataTransfer.dropEffect = 'move';
                const ok = this._canDropOn(slotType, d);
                if (ok) {
                    if (!slot.classList.contains('dragover')) {
                        slot.classList.remove('dragover-invalid');
                        slot.classList.add('dragover');
                        // 接触即预览：左侧属性面板实时显示换装后的数值变化
                        if (d.source === 'inventory' && d.inv) this._previewStats(d.inv);
                    }
                } else if (!slot.classList.contains('dragover-invalid')) {
                    slot.classList.remove('dragover');
                    slot.classList.add('dragover-invalid');
                }
            });
            slot.addEventListener('dragleave', (e) => {
                if (e.relatedTarget && slot.contains(e.relatedTarget)) return;
                slot.classList.remove('dragover', 'dragover-invalid');
                if (this._dragData) this._previewStats(null);
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                slot.classList.remove('dragover', 'dragover-invalid');
                this._onDropOnSlot(slotType, slotIndex);
                this._endDragFeedback();
            });
        });

        // ---- 背包区域：把已装备物品拖回此处 = 卸下 ----
        const grid = root.querySelector('#cp2-inv-grid');
        if (grid) {
            grid.addEventListener('dragover', (e) => {
                e.preventDefault();
                const d = this._dragData;
                if (d && d.source === 'equipped') {
                    e.dataTransfer.dropEffect = 'move';
                    grid.classList.add('dragover');
                }
            });
            grid.addEventListener('dragleave', (e) => {
                if (e.relatedTarget && grid.contains(e.relatedTarget)) return;
                grid.classList.remove('dragover');
            });
            grid.addEventListener('drop', (e) => {
                e.preventDefault();
                grid.classList.remove('dragover');
                const d = this._dragData;
                if (d && d.source === 'equipped') this._doUnequip(d.slot, d.slotIndex, d.equipmentId);
                this._endDragFeedback();
            });
        }

        // ---- 右键菜单（委托）----
        root.addEventListener('contextmenu', (e) => {
            const cell = e.target.closest('.cp2-inv-cell');
            if (cell && cell.dataset.invId) {
                e.preventDefault();
                const inv = this._inventory.find(i => String(i.id) === String(cell.dataset.invId));
                if (inv) this._openMenu(e.clientX, e.clientY, inv, 'inventory');
                return;
            }
            const slotItem = e.target.closest('.cp2-slot-item');
            if (slotItem) {
                e.preventDefault();
                const slot = slotItem.dataset.slot;
                const idx = parseInt(slotItem.dataset.slotIndex);
                const ce = this._getEquipped(slot, idx);
                if (ce) this._openMenu(e.clientX, e.clientY, ce, 'equipped');
            }
        });

        // ---- 筛选 / 搜索 ----
        root.querySelectorAll('.cp2-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._filterType = btn.dataset.filter;
                root.querySelectorAll('.cp2-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
                this._updateInventoryGrid();
            });
        });
        const search = root.querySelector('.cp2-search-input');
        if (search) {
            search.addEventListener('input', (e) => {
                this._searchText = e.target.value;
                this._updateInventoryGrid();
            });
        }

        // ---- 全局：跟随鼠标的 tooltip + 关闭菜单 ----
        this._bindGlobalOnce();
    },

    _bindGlobalOnce() {
        if (this._globalBound) return;
        this._globalBound = true;
        document.addEventListener('mousemove', (e) => {
            if (!this._hovered) return;
            const tip = document.getElementById('cp2-tooltip');
            if (!tip) return;
            let x = e.clientX + 18, y = e.clientY + 18;
            const r = tip.getBoundingClientRect();
            if (x + r.width > window.innerWidth - 10) x = e.clientX - r.width - 18;
            if (y + r.height > window.innerHeight - 10) y = e.clientY - r.height - 18;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        });
        // 拖拽中：幽灵跟随鼠标（drag 期间只有 dragover 会持续触发）
        document.addEventListener('dragover', (e) => {
            if (this._dragGhost) this._moveDragGhost(e.clientX, e.clientY);
        }, true);
        // 兜底清理：无论拖到哪儿结束，都收掉幽灵与高亮
        document.addEventListener('dragend', () => this._endDragFeedback());
        document.addEventListener('drop', () => this._endDragFeedback());
        document.addEventListener('click', () => this._closeMenu());
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this._closeMenu(); this._clearHover(); this._endDragFeedback(); } });
    },

    _updateInventoryGrid() {
        const grid = this._container.querySelector('#cp2-inv-grid');
        if (!grid) return;
        grid.innerHTML = this._renderInventory();
        // 计数更新
        const cnt = this._container.querySelector('.cp2-inv-count');
        if (cnt) cnt.textContent = this._inventory.length;
    },

    // ===================== 右键菜单 =====================
    _openMenu(x, y, target, source) {
        this._closeMenu();
        const menu = document.getElementById('cp2-context-menu');
        if (!menu) return;
        this._menuOpen = true;
        let html = '';
        if (source === 'inventory') {
            const inv = target;
            const canEquip = inv.item_kind === 'equipment';
            html += `<div class="cp2-ctx-title ${inv.rarity ? 'r2-text-' + inv.rarity : ''}">${this._esc(inv.name || '')}</div>`;
            if (canEquip) html += `<button class="cp2-ctx-item" data-act="equip">装备</button>`;
            html += `<button class="cp2-ctx-item danger" data-act="discard">分解丢弃</button>`;
            menu.dataset.target = 'inv:' + inv.id;
        } else {
            const ce = target;
            html += `<div class="cp2-ctx-title">${this._esc(ce.equipment.name || '')}</div>`;
            html += `<button class="cp2-ctx-item" data-act="unequip">卸下</button>`;
            menu.dataset.target = 'equip:' + ce.slot + ':' + ce.slot_index;
        }
        menu.innerHTML = html;
        menu.classList.remove('hidden');
        let mx = x, my = y;
        const mw = 140;
        if (mx + mw > window.innerWidth) mx = window.innerWidth - mw - 10;
        menu.style.left = mx + 'px';
        menu.style.top = my + 'px';

        menu.querySelectorAll('.cp2-ctx-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const act = btn.dataset.act;
                const t = menu.dataset.target;
                this._closeMenu();
                if (act === 'equip' && t.startsWith('inv:')) {
                    const inv = this._inventory.find(i => 'inv:' + i.id === t);
                    if (inv) this._quickEquip(inv);
                } else if (act === 'discard' && t.startsWith('inv:')) {
                    const inv = this._inventory.find(i => 'inv:' + i.id === t);
                    if (inv) this._discard(inv);
                } else if (act === 'unequip' && t.startsWith('equip:')) {
                    const [, slot, idx] = t.split(':');
                    const ce = this._getEquipped(slot, parseInt(idx));
                    if (ce) this._doUnequip(slot, parseInt(idx), ce.equipment_id);
                }
            });
        });
    },
    _closeMenu() {
        const menu = document.getElementById('cp2-context-menu');
        if (menu) menu.classList.add('hidden');
        this._menuOpen = false;
    },

    // ===================== 装备 / 卸下 / 分解 =====================
    _autoSlotIndex(slot) {
        const cap = this.SLOT_CAPACITY[slot] || 1;
        const occ = this._slotItems(slot);
        const used = new Set(occ.map(c => c.slot_index || 1));
        for (let i = 1; i <= cap; i++) if (!used.has(i)) return i;
        // 全满：替换最低品质占用位
        let lo = occ[0];
        occ.forEach(c => {
            if ((this.RARITY_RANK[c.equipment?.rarity] ?? 99) < (this.RARITY_RANK[lo.equipment?.rarity] ?? 99)) lo = c;
        });
        return lo.slot_index || 1;
    },

    async _quickEquip(inv) {
        const slot = inv.item_type;
        if (!this.SLOT_CAPACITY[slot]) { Utils.toast('该物品无法装备'); return; }
        const idx = this._autoSlotIndex(slot);
        await this._doEquip(inv, slot, idx);
    },

    async _doEquip(inv, slot, slotIndex) {
        const ucId = this._player.uc_id;
        const equipmentId = inv.item_id;
        const replaced = this._getEquipped(slot, slotIndex);
        try {
            await API.games.equip(ucId, { equipment_id: equipmentId, slot, slot_index: slotIndex });
            await API.games.removeInventory(ucId, inv.id);
            if (replaced && replaced.equipment_id !== equipmentId) {
                await API.games.addInventory(ucId, { item_id: replaced.equipment_id, item_kind: 'equipment', quantity: 1 });
            }
            Utils.toast('装备成功');
            await this._refreshData();
            this._renderPanel(this._container);
        } catch (e) {
            Utils.toast('装备失败: ' + (e.message || '未知错误'));
        }
    },

    async _doUnequip(slot, slotIndex, equipmentId) {
        const ucId = this._player.uc_id;
        try {
            await API.games.unequip(ucId, slot, equipmentId, slotIndex);
            await API.games.addInventory(ucId, { item_id: equipmentId, item_kind: 'equipment', quantity: 1 });
            Utils.toast('已卸下');
            await this._refreshData();
            this._renderPanel(this._container);
        } catch (e) {
            Utils.toast('卸下失败: ' + (e.message || '未知错误'));
        }
    },

    async _discard(inv) {
        const ucId = this._player.uc_id;
        try {
            await API.games.removeInventory(ucId, inv.id);
            Utils.toast('已分解');
            await this._refreshData();
            this._renderPanel(this._container);
        } catch (e) {
            Utils.toast('分解失败: ' + (e.message || '未知错误'));
        }
    },

    _onDropOnSlot(slotType, slotIndex) {
        const d = this._dragData;
        this._dragData = null;
        this._dragging = false;
        if (!d) return;
        const match = (slotType === 'artifact' && d.type === 'artifact') ||
                      (slotType === 'skill' && d.type === 'skill') ||
                      (slotType === d.type);
        if (!match) { Utils.toast('类型不匹配，无法放入该槽位'); return; }
        if (d.source === 'inventory') {
            this._doEquip(d.inv, slotType, slotIndex);
        } else if (d.source === 'equipped') {
            if (d.slot === slotType && d.slotIndex !== slotIndex) {
                this._swapEquipped(slotType, d.slotIndex, slotIndex);
            }
        }
    },

    async _swapEquipped(slot, fromIdx, toIdx) {
        const ucId = this._player.uc_id;
        const from = this._getEquipped(slot, fromIdx);
        const to = this._getEquipped(slot, toIdx);
        if (!from) return;
        try {
            if (to) {
                await API.games.unequip(ucId, slot, to.equipment_id, toIdx);
                await API.games.equip(ucId, { equipment_id: to.equipment_id, slot, slot_index: fromIdx });
            }
            await API.games.unequip(ucId, slot, from.equipment_id, fromIdx);
            await API.games.equip(ucId, { equipment_id: from.equipment_id, slot, slot_index: toIdx });
            await this._refreshData();
            this._renderPanel(this._container);
        } catch (e) {
            Utils.toast('移动失败: ' + (e.message || '未知错误'));
        }
    },

    // ===================== 工具 =====================
    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};
