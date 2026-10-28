// ========== 主应用入口（新UI） ==========

const App = {
    storyNodeIndex: 0,
    storyNodeIds: [],
    _uiVisible: true,
    _currentUC: null, // 当前用户角色实例

    async init() {
        this.bindEvents();

        // 先彻底清空背景层，防止任何缓存图片闪现
        this._resetBackground();

        // 启动平台层（取代直接进入剧情）
        if (typeof Platform !== 'undefined') {
            await Platform.init();
        }
    },

    // 由 Platform 调用：进入游戏，传入用户角色实例和目标章节
    async enterGame(userCharacter, targetChapterId = null) {
        this._currentUC = userCharacter;
        GameState.userCharacter = userCharacter;

        // 用 UserCharacter 数据初始化 GameState.player（兼容现有 UI）
        const base = userCharacter.base_character || {};
        GameState.player = {
            id: userCharacter.id,
            uc_id: userCharacter.id, // 用户角色ID（用于装备/背包API）
            base_id: userCharacter.base_character_id,
            name: userCharacter.custom_name || base.name || '玩家',
            title: base.title || '',
            level: userCharacter.level,
            realm_level: userCharacter.realm_level,
            exp: userCharacter.exp,
            hp: userCharacter.hp,
            max_hp: userCharacter.max_hp,
            mp: userCharacter.mp,
            max_mp: userCharacter.max_mp,
            attack: userCharacter.attack,
            defense: userCharacter.defense,
            speed: userCharacter.speed,
            luck: userCharacter.luck,
            portrait_image: base.portrait_image || '',
            character_type: base.character_type || 'player',
            personality: base.personality || '',
            background_story: base.background_story || '',
            last_story_node_id: userCharacter.last_story_node_id,
            last_chapter_id: userCharacter.last_chapter_id,
        };
        GameState.updatePlayerUI();
        Utils.toast(`欢迎，${GameState.player.name}`);

        // 显示章节封面，再加载故事
        await this.showChapterCover(targetChapterId);
        await this.loadStory(targetChapterId, userCharacter.last_story_node_id);
    },

    // 彻底清空背景层
    _resetBackground() {
        const bgImg = document.querySelector('#bg-image');
        if (bgImg) {
            bgImg.src = '';
            bgImg.style.display = 'none';
        }
        const bgLayer = document.querySelector('#background-layer');
        if (bgLayer) {
            bgLayer.style.background = '#000';
        }
    },

    // 显示章节封面
    async showChapterCover(targetChapterId = null) {
        try {
            const chapters = await API.story.getChapters();
            if (chapters.length === 0) return;

            // 优先目标章节，否则用户上次章节，否则第一章
            let chapter = null;
            if (targetChapterId) {
                chapter = chapters.find(c => c.id === targetChapterId);
            }
            if (!chapter && this._currentUC?.last_chapter_id) {
                chapter = chapters.find(c => c.id === this._currentUC.last_chapter_id);
            }
            if (!chapter) chapter = chapters[0];
            GameState.currentChapter = chapter;

            // 设置封面背景
            const coverEl = document.querySelector('#chapter-cover');
            const bgEl = document.querySelector('#chapter-cover-bg');
            const titleEl = document.querySelector('#chapter-cover-title');
            const subEl = document.querySelector('#chapter-cover-subtitle');

            if (chapter.image && bgEl) {
                bgEl.style.backgroundImage = `url('${chapter.image}')`;
            }

            // 隐藏所有游戏层，仅显示封面层
            document.querySelector('#background-layer')?.classList.add('hidden');
            document.querySelector('#ui-layer')?.classList.add('hidden');
            document.querySelector('#dialogue-overlay')?.classList.add('hidden');
            document.querySelector('#chapter-cover')?.classList.remove('hidden');

            // 设置标题
            if (titleEl) titleEl.textContent = chapter.title;
            // 副标题：优先用描述，否则显示章节序号
            if (subEl) subEl.textContent = chapter.description || `第 ${chapter.chapter_order} 章`;

            // 强制回流后触发显示动画
            void coverEl.offsetHeight;
            requestAnimationFrame(() => {
                coverEl?.classList.add('show');
            });

            // 如果有封面动效，应用动效
            if (chapter.cover_animation_effect_id) {
                try {
                    const effect = await API.get(`/animation-effects/${chapter.cover_animation_effect_id}`);
                    if (effect) {
                        const duration = effect.duration || 2000;
                        const params = effect.params ? JSON.parse(effect.params) : {};
                        bgEl.style.transition = '';
                        bgEl.style.animation = '';
                        bgEl.style.filter = 'brightness(0.8) saturate(1.1)';
                        switch (effect.effect_type) {
                            case 'zoom':
                                bgEl.style.transition = `transform ${duration}ms ease`;
                                bgEl.style.transform = `scale(${params.scale || 1.1})`;
                                break;
                            case 'darken':
                                bgEl.style.filter = `brightness(${1 - (params.intensity || 0.2)}) saturate(1.1)`;
                                break;
                            case 'blur':
                                bgEl.style.filter = `brightness(0.8) saturate(1.1) blur(${params.radius || 3}px)`;
                                break;
                            case 'shake': {
                                const inten = params.intensity || 3;
                                const px = Math.round(inten * 2);
                                const styleId = 'dyn-cover-shake';
                                let styleEl = document.getElementById(styleId);
                                if (!styleEl) {
                                    styleEl = document.createElement('style');
                                    styleEl.id = styleId;
                                    document.head.appendChild(styleEl);
                                }
                                styleEl.textContent = `@keyframes dyn-cover-shake {
                                    0%, 100% { transform: translateX(0); }
                                    25% { transform: translateX(-${px}px); }
                                    50% { transform: translateX(${px}px); }
                                    75% { transform: translateX(-${px * 0.5}px); }
                                }`;
                                bgEl.style.animation = `dyn-cover-shake ${duration}ms ease`;
                                break;
                            }
                            case 'color_shift':
                                bgEl.style.transition = `filter ${duration}ms ease`;
                                bgEl.style.filter = `brightness(0.8) saturate(1.1) hue-rotate(${params.hue || 30}deg)`;
                                break;
                            case 'flash': {
                                const flashColor = params.color || '#ffffff';
                                const flashIntensity = params.intensity || 0.8;
                                bgEl.style.transition = 'none';
                                bgEl.style.filter = `brightness(1) saturate(1.1)`;
                                const flashOverlay = document.createElement('div');
                                flashOverlay.style.cssText = `position:absolute;inset:0;background:${flashColor};opacity:0;transition:opacity ${duration*0.3}ms ease;z-index:2;pointer-events:none;`;
                                bgEl.parentElement.appendChild(flashOverlay);
                                requestAnimationFrame(() => { flashOverlay.style.opacity = flashIntensity; });
                                setTimeout(() => {
                                    flashOverlay.style.opacity = '0';
                                    setTimeout(() => flashOverlay.remove(), 500);
                                }, duration * 0.6);
                                break;
                            }
                            default:
                                break;
                        }
                        await new Promise(r => setTimeout(r, duration));
                    }
                } catch (e) { /* ignore */ }
            } else {
                await new Promise(r => setTimeout(r, 3000));
            }

            // 封面淡出
            coverEl?.classList.remove('show');
            await new Promise(r => setTimeout(r, 600));

            // 恢复各层显示
            coverEl?.classList.add('hidden');
            document.querySelector('#background-layer')?.classList.remove('hidden');
            document.querySelector('#ui-layer')?.classList.remove('hidden');
            document.querySelector('#dialogue-overlay')?.classList.remove('hidden');
        } catch (e) {
            console.error('章节封面加载失败:', e);
        }
    },

    bindEvents() {
        // 点击头像 → 人物面板
        Utils.on('#hud-portrait', 'click', () => {
            CharacterPanel.show();
        });

        // 左侧菜单图标
        Utils.on('#left-menu', 'click', (e) => {
            const icon = e.target.closest('.menu-icon');
            if (!icon) return;
            const panel = icon.dataset.panel;
            if (panel === 'character') CharacterPanel.show();
            else if (panel === 'inventory') this._showInventory();
            else if (panel === 'map') MapPanel.show();
            else if (panel === 'menu') MenuPanel.show();
        });

        // 对话框点击
        Utils.on('#dialogue-box', 'click', () => {
            DialogueUI.handleClick();
        });

        // 面板关闭
        Utils.on('#panel-close', 'click', () => {
            Utils.hide('#panel-overlay');
        });
        Utils.on('#panel-overlay', 'click', (e) => {
            if (e.target === e.currentTarget) Utils.hide('#panel-overlay');
        });

        // UI开关
        Utils.on('#ui-toggle', 'click', () => {
            this._uiVisible = !this._uiVisible;
            const uiLayer = document.querySelector('#ui-layer');
            const dialogueOverlay = document.querySelector('#dialogue-overlay');
            const toggle = document.querySelector('#ui-toggle');
            if (this._uiVisible) {
                uiLayer.classList.remove('hidden');
                dialogueOverlay.classList.remove('hidden');
                toggle.textContent = '•';
                toggle.title = '隐藏界面';
            } else {
                uiLayer.classList.add('hidden');
                dialogueOverlay.classList.add('hidden');
                toggle.textContent = '○';
                toggle.title = '显示界面';
            }
        });

        // 键盘快捷键（战斗中的按键由 CombatUI 自己处理）
        document.addEventListener('keydown', (e) => {
            if (GameState.isInCombat) return;
            if (e.key === 'Escape') {
                Utils.hide('#panel-overlay');
            }
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (GameState.isInDialogue && !GameState.isInCombat) {
                    DialogueUI.handleClick();
                }
            }
            if (e.key === 'c') CharacterPanel.show();
            if (e.key === 'i') this._showInventory();
            if (e.key === 'm') MapPanel.show();
            if (e.key === 'h') {
                document.querySelector('#ui-toggle')?.click();
            }
        });
    },

    async loadStory(targetChapterId = null, lastNodeId = null) {
        try {
            const chapters = await API.story.getChapters();
            if (chapters.length === 0) return;

            // 选择章节
            let chapter = null;
            if (targetChapterId) chapter = chapters.find(c => c.id === targetChapterId);
            if (!chapter && this._currentUC?.last_chapter_id) {
                chapter = chapters.find(c => c.id === this._currentUC.last_chapter_id);
            }
            if (!chapter) chapter = chapters[0];

            const nodes = await API.story.getNodes({ chapter_id: chapter.id });
            this.storyNodeIds = nodes.map(n => n.id);

            // 如果有上次存档节点，从该节点继续；否则从第一个开始
            let startNodeId = null;
            if (lastNodeId && this.storyNodeIds.includes(lastNodeId)) {
                startNodeId = lastNodeId;
                const idx = this.storyNodeIds.indexOf(lastNodeId);
                this.storyNodeIndex = idx;
            } else if (this.storyNodeIds.length > 0) {
                startNodeId = this.storyNodeIds[0];
                this.storyNodeIndex = 0;
            }

            if (startNodeId) {
                const first = await API.story.getNode(startNodeId);
                if (first?.node_type === 'battle') {
                    await this.handleBattleNode(first);
                } else {
                    await DialogueUI.showNode(startNodeId, this.handleStoryChoice.bind(this));
                }
            }
        } catch (e) {
            console.error('加载故事失败:', e);
            Utils.toast('故事数据加载失败');
        }
    },

    async handleStoryChoice(result) {
        if (result && result.nextAfter) {
            const jumpedNodeId = result.nextAfter;
            const currentIdx = this.storyNodeIds.indexOf(jumpedNodeId);

            if (currentIdx !== -1) {
                this.storyNodeIndex = currentIdx + 1;
            } else {
                try {
                    const nodeInfo = await API.story.getNode(jumpedNodeId);
                    if (nodeInfo && nodeInfo.chapter_id) {
                        const newNodes = await API.story.getNodes({ chapter_id: nodeInfo.chapter_id });
                        this.storyNodeIds = newNodes.map(n => n.id);
                        const newIdx = this.storyNodeIds.indexOf(jumpedNodeId);
                        this.storyNodeIndex = newIdx + 1;
                        // 保存进度
                        if (this._currentUC) {
                            try {
                                await API.games.saveProgress(this._currentUC.id, {
                                    last_story_node_id: jumpedNodeId,
                                    last_chapter_id: nodeInfo.chapter_id,
                                });
                            } catch {}
                        }
                    } else {
                        this.storyNodeIndex = this.storyNodeIds.length;
                    }
                } catch (e) {
                    console.error('跨章节跳转失败:', e);
                    this.storyNodeIndex = this.storyNodeIds.length;
                }
            }

            if (this.storyNodeIndex < this.storyNodeIds.length) {
                const nextNodeId = this.storyNodeIds[this.storyNodeIndex];
                const node = await API.story.getNode(nextNodeId);
                // 自动存档
                if (this._currentUC) {
                    try {
                        await API.games.saveProgress(this._currentUC.id, {
                            last_story_node_id: nextNodeId,
                            last_chapter_id: node.chapter_id,
                        });
                    } catch {}
                }
                if (node.node_type === 'battle') {
                    await this.handleBattleNode(node);
                } else {
                    await DialogueUI.showNode(nextNodeId, this.handleStoryChoice.bind(this));
                }
            }
        }
    },

    async handleBattleNode(node) {
        Utils.hide('#dialogue-box');
        Utils.hide('#choices-container');

        // 敌人、数值、AI 全部由后端按 story_nodes.battle_config 解析；
        // 节点里没配时后端会按"场景NPC → 节点登场人物 → 说话者"兜底。
        await CombatUI.start({ storyNodeId: node.id, node });
    },

    async _showInventory() {
        // 背包集成在CharacterPanel中了，直接打开人物面板
        await CharacterPanel.show();
    },

    // 保存当前进度
    async saveCurrentProgress(extraData = {}) {
        if (!this._currentUC) return;
        try {
            await API.games.saveProgress(this._currentUC.id, {
                last_story_node_id: this._currentUC.last_story_node_id,
                last_chapter_id: this._currentUC.last_chapter_id,
                ...extraData,
            });
            Utils.toast('已保存');
        } catch (e) {
            Utils.toast('保存失败: ' + e.message);
        }
    },
};

// 启动入口：兼容 DOMContentLoaded 已触发的情况
function bootApp() {
    App.init().catch(e => {
        console.error('App.init 失败:', e);
        // 在页面上显示错误，便于排查
        const area = document.querySelector('#platform-user-area');
        if (area) area.innerHTML = `<div style="color:#dc3545;font-size:12px">初始化失败: ${e.message}</div>`;
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
} else {
    bootApp();
}
