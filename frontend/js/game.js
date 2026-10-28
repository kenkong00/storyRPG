// ========== 游戏状态管理 ==========

const GameState = {
    // 玩家数据（来自 UserCharacter）
    player: null,
    userCharacter: null, // 完整 UserCharacter 对象
    party: [],
    currentScene: null,
    sceneNPCs: [],
    sceneConnections: [],

    // 故事数据
    currentChapter: null,
    currentNode: null,
    currentChoices: [],
    storyFlags: {},

    // 战斗数据
    currentBattle: null,
    battleEnemies: [],
    selectedSkill: null,
    selectedAction: null,

    // 状态
    isInDialogue: false,
    isInCombat: false,
    isTyping: false,
    dialogueQueue: [],
    dialogueCallback: null,

    // 更新玩家HUD（新UI）
    updatePlayerUI() {
        if (!this.player) return;
        const p = this.player;

        const nameEl = document.querySelector('#hud-name');
        const levelEl = document.querySelector('#hud-level');
        const hpText = document.querySelector('#hud-hp-text');
        const mpText = document.querySelector('#hud-mp-text');
        const hpFill = document.querySelector('#hud-hp-fill');
        const mpFill = document.querySelector('#hud-mp-fill');

        if (nameEl) nameEl.textContent = p.name;
        if (levelEl) levelEl.textContent = `Lv.${p.level}${p.title ? ' · ' + p.title : ''}`;
        if (hpText) hpText.textContent = `HP ${p.hp || 0}/${p.max_hp || 0}`;
        if (mpText) mpText.textContent = `MP ${p.mp || 0}/${p.max_mp || 0}`;
        if (hpFill) hpFill.style.width = Utils.percent(p.hp, p.max_hp) + '%';
        if (mpFill) mpFill.style.width = Utils.percent(p.mp, p.max_mp) + '%';

        // 更新头像
        const avatar = document.querySelector('#hud-avatar');
        if (avatar) {
            if (p.portrait_image) {
                avatar.src = p.portrait_image;
                avatar.style.display = 'block';
            } else {
                avatar.style.display = 'none';
            }
        }
    },

    // 进入场景
    async enterScene(sceneId) {
        try {
            const scene = await API.scenes.get(sceneId);
            this.currentScene = scene;
            this.sceneNPCs = await API.scenes.getNPCs(sceneId);
            this.sceneConnections = await API.scenes.getConnections(sceneId);
            Utils.setSceneBg(scene.scene_type, scene.background_image);
            Utils.toast(`进入：${scene.name}`);
            return scene;
        } catch (e) {
            console.error('进入场景失败:', e);
            Utils.toast('无法进入该场景');
        }
    },

    // 加载对话节点
    async loadNode(nodeId) {
        try {
            const full = await API.story.getNodeFull(nodeId);
            this.currentNode = full.node;
            this.currentChoices = full.choices;
            return full;
        } catch (e) {
            console.error('加载节点失败:', e);
        }
    },

    // 刷新玩家数据（从后端拉取最新的 UserCharacter）
    async refreshPlayer() {
        if (!this.userCharacter) return;
        try {
            const uc = await API.games.myCharacterFull(this.userCharacter.id);
            this.userCharacter = uc;
            const base = uc.base_character || {};
            this.player = {
                id: uc.id, uc_id: uc.id, base_id: uc.base_character_id,
                name: uc.custom_name || base.name || '玩家',
                title: base.title || '',
                level: uc.level, realm_level: uc.realm_level, exp: uc.exp,
                hp: uc.hp, max_hp: uc.max_hp, mp: uc.mp, max_mp: uc.max_mp,
                attack: uc.attack, defense: uc.defense, speed: uc.speed, luck: uc.luck,
                portrait_image: base.portrait_image || '',
                character_type: base.character_type || 'player',
                personality: base.personality || '',
                background_story: base.background_story || '',
                last_story_node_id: uc.last_story_node_id,
                last_chapter_id: uc.last_chapter_id,
            };
            this.updatePlayerUI();
        } catch (e) {
            console.error('刷新玩家数据失败:', e);
        }
    },
};
