// ========== API 调用封装 ==========

const API_BASE = '/api';

// 安全的 localStorage 访问（防止隐私模式/安全策略导致异常）
function _safeStorage(key, defaultValue) {
    try { if (typeof localStorage === 'undefined') return defaultValue; return localStorage.getItem(key) || defaultValue; } catch(e) { return defaultValue; }
}
function _safeStorageSet(key, value) {
    try { if (typeof localStorage === 'undefined') return; localStorage.setItem(key, value); } catch(e) {}
}
function _safeStorageRemove(key) {
    try { if (typeof localStorage === 'undefined') return; localStorage.removeItem(key); } catch(e) {}
}

// 用户登录令牌（localStorage 持久化）
// 使用 var 避免 const 初始化失败导致 TDZ 问题
var Auth = {
    token: _safeStorage('rpg_user_token', ''),
    user: (() => { try { return JSON.parse(_safeStorage('rpg_user_info', 'null')); } catch(e) { return null; } })(),

    setSession(token, user) {
        this.token = token;
        this.user = user;
        _safeStorageSet('rpg_user_token', token);
        _safeStorageSet('rpg_user_info', JSON.stringify(user));
    },
    clear() {
        this.token = '';
        this.user = null;
        _safeStorageRemove('rpg_user_token');
        _safeStorageRemove('rpg_user_info');
    },
    isLoggedIn() { return !!this.token; },
};

const API = {
    async get(path) {
        const res = await fetch(`${API_BASE}${path}`, {
            headers: Auth.token ? { 'X-User-Token': Auth.token } : {},
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
        return res.json();
    },

    async post(path, data) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(Auth.token ? { 'X-User-Token': Auth.token } : {}) },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
        return res.json();
    },

    async put(path, data) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(Auth.token ? { 'X-User-Token': Auth.token } : {}) },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
        return res.json();
    },

    async del(path) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'DELETE',
            headers: Auth.token ? { 'X-User-Token': Auth.token } : {},
        });
        if (!res.ok && res.status !== 204) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
    },

    // ===== 认证 / 用户 =====
    auth: {
        register(username, password, nickname) {
            return API.post('/users/register', { username, password, nickname });
        },
        login(username, password) {
            return API.post('/users/login', { username, password });
        },
        logout() { return API.post('/users/logout'); },
        me() { return API.get('/users/me'); },
    },

    // ===== 游戏 =====
    games: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/games/${qs ? '?' + qs : ''}`);
        },
        carousel() { return API.get('/games/carousel'); },
        get(id) { return API.get(`/games/${id}`); },
        // 用户游戏清单
        myLibrary() { return API.get('/users/me/library'); },
        addLibrary(gameId) { return API.post(`/users/me/library/${gameId}`); },
        removeLibrary(gameId) { return API.del(`/users/me/library/${gameId}`); },
        // 用户角色（新建人物）
        myCharacters(gameId) {
            const qs = gameId ? `?game_id=${gameId}` : '';
            return API.get(`/users/me/characters${qs}`);
        },
        myCharacterFull(ucId) { return API.get(`/users/me/characters/${ucId}/full`); },
        createCharacter(data) { return API.post('/users/me/characters', data); },
        updateCharacter(ucId, data) { return API.put(`/users/me/characters/${ucId}`, data); },
        deleteCharacter(ucId) { return API.del(`/users/me/characters/${ucId}`); },
        saveProgress(ucId, data) { return API.post(`/users/me/characters/${ucId}/save`, data); },
        // 用户角色装备/背包
        getCharEquipments(ucId) { return API.get(`/users/me/characters/${ucId}/equipments`); },
        equip(ucId, data) { return API.post(`/users/me/characters/${ucId}/equipments`, data); },
        unequip(ucId, slot, equipmentId, slotIndex) {
            const params = new URLSearchParams();
            if (equipmentId != null) params.set('equipment_id', equipmentId);
            if (slotIndex != null) params.set('slot_index', slotIndex);
            return API.del(`/users/me/characters/${ucId}/equipments?slot=${slot}${params.toString() ? '&' + params.toString() : ''}`);
        },
        getCharInventory(ucId) { return API.get(`/users/me/characters/${ucId}/inventory`); },
        addInventory(ucId, data) { return API.post(`/users/me/characters/${ucId}/inventory`, data); },
        updateInventory(ucId, invId, data) { return API.put(`/users/me/characters/${ucId}/inventory/${invId}`, data); },
        removeInventory(ucId, invId) { return API.del(`/users/me/characters/${ucId}/inventory/${invId}`); },
    },

    // ===== 人物 =====
    characters: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/characters${qs ? '?' + qs : ''}`);
        },
        get(id) { return API.get(`/characters/${id}`); },
        getPlayer() { return API.get('/characters/player'); },
        getParty() { return API.get('/characters/party'); },
        create(data) { return API.post('/characters', data); },
        update(id, data) { return API.put(`/characters/${id}`, data); },
        getAttributes(id) { return API.get(`/characters/${id}/attributes`); },
        setAttribute(id, data) { return API.post(`/characters/${id}/attributes`, data); },
    },

    // ===== 关系 =====
    relationships: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/relationships${qs ? '?' + qs : ''}`);
        },
        getBetween(a, b) { return API.get(`/relationships/between/${a}/${b}`); },
        create(data) { return API.post('/relationships', data); },
        update(id, data) { return API.put(`/relationships/${id}`, data); },
        addEvent(id, data) { return API.post(`/relationships/${id}/events`, data); },
    },

    // ===== 技能书（后台「技能书」栏目维护；人物面板 4 个技能书槽用它，战斗中只能用这些功法） =====
    skillBooks: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/skills${qs ? '?' + qs : ''}`);   // 技能书库 = skills 表
        },
        // 玩家角色已装备的技能书
        ofUserCharacter(ucId) { return API.get(`/skill-books/user-character/${ucId}`); },
        equip(ucId, skillId, slotIndex) {
            return API.post(`/skill-books/user-character/${ucId}`, { skill_id: skillId, slot_index: slotIndex });
        },
        unequip(ucId, slotIndex) { return API.del(`/skill-books/user-character/${ucId}/slot/${slotIndex}`); },
        ofCharacter(charId) { return API.get(`/skill-books/character/${charId}`); },
    },

    // ===== 技能 =====
    skills: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/skills${qs ? '?' + qs : ''}`);
        },
        get(id) { return API.get(`/skills/${id}`); },
        getCharacterSkills(charId) { return API.get(`/skills/character/${charId}`); },
        learnSkill(charId, data) { return API.post(`/skills/character/${charId}/learn`, data); },
        getLevels() { return API.get('/skills/levels'); },
    },

    // ===== 场景 =====
    scenes: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/scenes${qs ? '?' + qs : ''}`);
        },
        get(id) { return API.get(`/scenes/${id}`); },
        getConnections(sceneId) { return API.get(`/scenes/${sceneId}/connections`); },
        getNPCs(sceneId) { return API.get(`/scenes/${sceneId}/npcs`); },
    },

    // ===== 故事 =====
    story: {
        getChapters(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/story/chapters${qs ? '?' + qs : ''}`);
        },
        getChapter(id) { return API.get(`/story/chapters/${id}`); },
        getNodes(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/story/nodes${qs ? '?' + qs : ''}`);
        },
        getNode(id) { return API.get(`/story/nodes/${id}`); },
        getNodeFull(id) { return API.get(`/story/nodes/${id}/full`); },
        getChoices(nodeId) { return API.get(`/story/nodes/${nodeId}/choices`); },
        getFlags() { return API.get('/story/flags'); },
        setFlag(data) { return API.post('/story/flags', data); },
        updateFlag(key, value) { return API.put(`/story/flags/${key}?value=${value}`); },
        checkConditions(group) { return API.post(`/story/check-conditions/${group}`); },
    },

    // ===== 战斗 =====
    battle: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/battle${qs ? '?' + qs : ''}`);
        },
        get(id) { return API.get(`/battle/${id}`); },
        start(data) { return API.post('/battle/start', data); },
        getTurns(battleId) { return API.get(`/battle/${battleId}/turns`); },
        addTurn(battleId, data) { return API.post(`/battle/${battleId}/turns`, data); },
        matchExpression(charId, trigger) {
            return API.get(`/battle/expressions/match/${charId}?trigger=${trigger}`);
        },

        // ===== 战斗 v2：服务端权威 · 事件流驱动 =====
        // 规则全在后端（battle_engine），前端只负责演出与收集指令
        v2Start(data) { return API.post('/battle/v2/start', data); },
        v2State(battleId) { return API.get(`/battle/v2/${battleId}`); },
        v2Action(battleId, data) { return API.post(`/battle/v2/${battleId}/action`, data); },
        v2Auto(battleId, enabled) {
            return API.post(`/battle/v2/${battleId}/auto`, { enabled: !!enabled });
        },
        v2Flee(battleId) { return API.post(`/battle/v2/${battleId}/flee`, {}); },
        v2Settle(battleId) { return API.post(`/battle/v2/${battleId}/settle`, {}); },
    },

    // ===== 事件 =====
    events: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/events${qs ? '?' + qs : ''}`);
        },
        trigger(eventId) { return API.post(`/events/${eventId}/trigger`); },
        check(triggerType) { return API.get(`/events/check?trigger_type=${triggerType}`); },
    },

    // ===== 物品 =====
    items: {
        list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return API.get(`/items${qs ? '?' + qs : ''}`);
        },
        getInventory(charId) { return API.get(`/items/character/${charId}/inventory`); },
        addToInventory(charId, data) { return API.post(`/items/character/${charId}/inventory`, data); },
        equipItem(charId, invId) { return API.put(`/items/character/${charId}/inventory/${invId}/equip`); },
    },
};

// 确保全局可访问
window.Auth = Auth;
window.API = API;