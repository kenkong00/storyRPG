// ========== 游戏平台层（首页 + 认证 + 游戏开始画面 + 新建人物 + 读档） ==========

const Platform = {
    // 平台状态
    allGames: [],
    carouselGames: [],
    myLibrary: [],
    currentCategory: '', // '' 表示全部
    carouselIndex: 0,
    carouselTimer: null,

    // 当前打开的游戏开始画面
    currentGame: null,
    currentGameDetail: null,

    async init() {
        try {
            this.bindEvents();
            // 平台默认显示
            document.querySelector('#platform-layer')?.classList.remove('hidden');
            document.querySelector('#game-container')?.style.setProperty('display', 'none');

            // 如果已登录，加载清单；否则渲染登录提示
            await this.refreshUserArea();
            await this.loadPlatformData();
        } catch (e) {
            console.error('Platform.init 失败:', e);
            const area = document.querySelector('#platform-user-area');
            if (area) area.innerHTML = `<div style="color:#dc3545;font-size:12px">平台加载失败: ${e.message}</div>`;
            const grid = document.querySelector('#platform-grid');
            if (grid) grid.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545">加载失败: ${e.message}</div>`;
        }
    },

    // ===== 事件绑定 =====
    bindEvents() {
        // 认证弹窗
        Utils.on('#auth-close', 'click', () => Utils.hide('#auth-modal'));
        Utils.on('#auth-modal', 'click', (e) => {
            if (e.target === e.currentTarget) Utils.hide('#auth-modal');
        });
        // 认证标签切换（使用事件委托，绑定到所有.auth-tab）
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const t = e.target.closest('.auth-tab');
                if (!t) return;
                this._switchAuthTab(t.dataset.mode);
            });
        });
        Utils.on('#auth-submit', 'click', () => this._handleAuthSubmit());

        // 游戏开始画面 - 返回
        Utils.on('#game-start-back', 'click', () => this.closeGameStart());

        // 通用平台弹窗
        Utils.on('#platform-modal-close', 'click', () => Utils.hide('#platform-modal'));
        Utils.on('#platform-modal', 'click', (e) => {
            if (e.target === e.currentTarget) Utils.hide('#platform-modal');
        });
    },

    // ===== 用户区域 =====
    async refreshUserArea() {
        const area = document.querySelector('#platform-user-area');
        if (!area) return;
        if (!Auth.isLoggedIn()) {
            area.innerHTML = `<button class="btn-platform primary" id="btn-go-login">登录 / 注册</button>`;
            Utils.on('#btn-go-login', 'click', () => this.showAuthModal('login'));
            return;
        }
        // 尝试获取最新用户信息
        try {
            const me = await API.auth.me();
            Auth.setSession(Auth.token, me);
        } catch (e) {
            // token 失效
            Auth.clear();
            area.innerHTML = `<button class="btn-platform primary" id="btn-go-login">登录 / 注册</button>`;
            Utils.on('#btn-go-login', 'click', () => this.showAuthModal('login'));
            return;
        }
        const u = Auth.user || {};
        const avatar = u.avatar
            ? `<img src="${u.avatar}" alt="">`
            : `<span>${(u.nickname || u.username || '?').charAt(0).toUpperCase()}</span>`;
        area.innerHTML = `
            <div class="platform-user-info">
                <div class="platform-avatar">${avatar}</div>
                <span>${u.nickname || u.username}</span>
            </div>
            <button class="btn-platform" id="btn-my-library">我的清单</button>
            <button class="btn-platform danger" id="btn-logout">退出</button>
        `;
        Utils.on('#btn-my-library', 'click', () => this.showMyLibrary());
        Utils.on('#btn-logout', 'click', () => this._handleLogout());
    },

    // ===== 加载平台数据 =====
    async loadPlatformData() {
        try {
            const [carousel, allGames] = await Promise.all([
                API.games.carousel().catch(() => []),
                API.games.list({ is_published: 1 }).catch(() => []),
            ]);
            this.carouselGames = carousel || [];
            this.allGames = (allGames || []).filter(g => g.is_published === 1);
        } catch (e) {
            console.error('加载平台数据失败:', e);
            Utils.toast('加载游戏数据失败');
            return;
        }
        // 如果已登录，加载清单
        if (Auth.isLoggedIn()) {
            try {
                this.myLibrary = await API.games.myLibrary();
            } catch { this.myLibrary = []; }
        } else {
            this.myLibrary = [];
        }
        this.renderCarousel();
        this.renderCategories();
        this.renderGrid();
    },

    // ===== 轮播图 =====
    renderCarousel() {
        const wrap = document.querySelector('#platform-carousel');
        if (!wrap) return;
        if (this.carouselGames.length === 0) {
            wrap.classList.add('hidden');
            wrap.innerHTML = '';
            return;
        }
        wrap.classList.remove('hidden');
        this.carouselIndex = 0;
        const slides = this.carouselGames.map((g, i) => `
            <div class="carousel-slide ${i === 0 ? 'active' : ''}" data-idx="${i}" data-game-id="${g.id}">
                <img src="${g.image}" alt="${g.name}">
                <div class="carousel-info">
                    <h2>${g.name}</h2>
                    ${g.description ? `<p>${g.description}</p>` : ''}
                    <span class="carousel-play">立即游玩</span>
                </div>
            </div>
        `).join('');
        const dots = this.carouselGames.map((_, i) =>
            `<span class="carousel-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></span>`
        ).join('');
        wrap.innerHTML = `${slides}<div class="carousel-dots">${dots}</div>`;

        // 点击轮播图进入游戏
        wrap.querySelectorAll('.carousel-slide').forEach(el => {
            el.addEventListener('click', () => {
                const gid = parseInt(el.dataset.gameId);
                this.openGameStart(gid);
            });
        });
        wrap.querySelectorAll('.carousel-dot').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this._gotoCarousel(parseInt(el.dataset.idx));
            });
        });

        this._startCarouselTimer();
    },

    _startCarouselTimer() {
        if (this.carouselTimer) clearInterval(this.carouselTimer);
        if (this.carouselGames.length <= 1) return;
        this.carouselTimer = setInterval(() => {
            this._gotoCarousel((this.carouselIndex + 1) % this.carouselGames.length);
        }, 6000);
    },

    _gotoCarousel(idx) {
        const slides = document.querySelectorAll('#platform-carousel .carousel-slide');
        const dots = document.querySelectorAll('#platform-carousel .carousel-dot');
        slides.forEach((s, i) => s.classList.toggle('active', i === idx));
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
        this.carouselIndex = idx;
    },

    // ===== 分类筛选 =====
    renderCategories() {
        const wrap = document.querySelector('#platform-cats');
        if (!wrap) return;
        // 从所有游戏中收集分类
        const cats = new Set();
        this.allGames.forEach(g => {
            if (g.category_path) cats.add(g.category_path);
        });
        // 顶级分类（取路径第一段）
        const topCats = new Set();
        cats.forEach(c => topCats.add(c.split('/')[0]));

        let html = `<span class="platform-cat ${this.currentCategory === '' ? 'active' : ''}" data-cat="">全部</span>`;
        Array.from(topCats).sort().forEach(c => {
            html += `<span class="platform-cat ${this.currentCategory === c ? 'active' : ''}" data-cat="${c}">${c}</span>`;
        });
        wrap.innerHTML = html;
        wrap.querySelectorAll('.platform-cat').forEach(el => {
            el.addEventListener('click', () => {
                this.currentCategory = el.dataset.cat;
                this.renderCategories();
                this.renderGrid();
            });
        });
    },

    // ===== 游戏网格 =====
    renderGrid() {
        const wrap = document.querySelector('#platform-grid');
        if (!wrap) return;
        let games = this.allGames;
        if (this.currentCategory) {
            games = games.filter(g => g.category_path && g.category_path.startsWith(this.currentCategory));
        }
        if (games.length === 0) {
            wrap.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-dim)">暂无游戏</div>';
            return;
        }
        const libIds = new Set(this.myLibrary.map(l => l.game_id));
        wrap.innerHTML = games.map(g => {
            const inLib = libIds.has(g.id);
            const badges = [];
            if (g.is_coming_soon === 1) badges.push('<span class="game-card-badge coming">即将发布</span>');
            if (inLib) badges.push('<span class="game-card-in-lib">已在清单</span>');
            const catLabel = g.category_path ? g.category_path.split('/')[0] : '';
            const libBtn = inLib
                ? ''
                : `<button class="game-card-lib-btn" data-lib-action="add" data-game-id="${g.id}">加入清单</button>`;
            return `
                <div class="game-card" data-game-id="${g.id}">
                    <div class="game-card-cover">
                        ${g.image ? `<img src="${g.image}" alt="${g.name}">` : '<div class="no-img">无封面</div>'}
                        ${badges.join('')}
                    </div>
                    <div class="game-card-info">
                        <h3>${g.name}</h3>
                        ${catLabel ? `<div class="game-card-cat">${catLabel}</div>` : ''}
                        ${libBtn}
                    </div>
                </div>
            `;
        }).join('');
        // 加入清单按钮
        wrap.querySelectorAll('.game-card-lib-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const gid = parseInt(btn.dataset.gameId);
                try {
                    await API.games.addLibrary(gid);
                    this.myLibrary = await API.games.myLibrary();
                    Utils.toast('已加入清单');
                    this.renderGrid();
                } catch (err) {
                    Utils.toast('加入清单失败: ' + err.message);
                }
            });
        });
        wrap.querySelectorAll('.game-card').forEach(el => {
            el.addEventListener('click', () => {
                this.openGameStart(parseInt(el.dataset.gameId));
            });
        });
    },

    // ===== 认证弹窗 =====
    showAuthModal(mode = 'login') {
        this._switchAuthTab(mode);
        Utils.show('#auth-modal');
        setTimeout(() => document.querySelector('#auth-username')?.focus(), 50);
    },

    _switchAuthTab(mode) {
        document.querySelectorAll('.auth-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === mode);
        });
        const nicknameInput = document.querySelector('#auth-nickname');
        if (nicknameInput) nicknameInput.style.display = mode === 'register' ? 'block' : 'none';
        const submitBtn = document.querySelector('#auth-submit');
        if (submitBtn) submitBtn.textContent = mode === 'register' ? '注册' : '登录';
        const msgEl = document.querySelector('#auth-msg');
        if (msgEl) msgEl.textContent = '';
    },

    async _handleAuthSubmit() {
        const username = document.querySelector('#auth-username')?.value.trim();
        const password = document.querySelector('#auth-password')?.value;
        const nickname = document.querySelector('#auth-nickname')?.value.trim();
        const mode = document.querySelector('.auth-tab.active')?.dataset.mode || 'login';
        const msgEl = document.querySelector('#auth-msg');
        if (!username || !password) {
            if (msgEl) msgEl.textContent = '请填写用户名和密码';
            return;
        }
        try {
            if (mode === 'register') {
                await API.auth.register(username, password, nickname || null);
                // 注册成功后自动登录
                const res = await API.auth.login(username, password);
                Auth.setSession(res.token, res.user);
                Utils.toast('注册成功，已自动登录');
            } else {
                const res = await API.auth.login(username, password);
                Auth.setSession(res.token, res.user);
                Utils.toast('登录成功');
            }
            Utils.hide('#auth-modal');
            // 清空表单
            document.querySelector('#auth-username').value = '';
            document.querySelector('#auth-password').value = '';
            if (document.querySelector('#auth-nickname')) document.querySelector('#auth-nickname').value = '';
            await this.refreshUserArea();
            await this.loadPlatformData();
        } catch (e) {
            if (msgEl) msgEl.textContent = e.message || '操作失败';
        }
    },

    async _handleLogout() {
        try { await API.auth.logout(); } catch {}
        Auth.clear();
        Utils.toast('已退出登录');
        await this.refreshUserArea();
        await this.loadPlatformData();
    },

    // ===== 我的清单 =====
    async showMyLibrary() {
        if (!Auth.isLoggedIn()) {
            this.showAuthModal('login');
            return;
        }
        try {
            this.myLibrary = await API.games.myLibrary();
        } catch (e) {
            Utils.toast('加载清单失败: ' + e.message);
            return;
        }
        const body = document.querySelector('#platform-modal-body');
        if (this.myLibrary.length === 0) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">清单为空，请从游戏列表中加入游戏</div>';
        } else {
            body.innerHTML = `
                <h3>我的游戏清单（${this.myLibrary.length}）</h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
                    ${this.myLibrary.map(lib => `
                        <div class="game-card" data-game-id="${lib.game_id}">
                            <div class="game-card-cover">
                                ${lib.image ? `<img src="${lib.image}" alt="">` : '<div class="no-img">无封面</div>'}
                            </div>
                            <div class="game-card-info">
                                <h3>${lib.name}</h3>
                                <button class="btn-platform danger remove-lib" data-game-id="${lib.game_id}" style="margin-top:6px;width:100%">移出清单</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            body.querySelectorAll('.game-card').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.remove-lib')) return;
                    this.openGameStart(parseInt(el.dataset.gameId));
                });
            });
            body.querySelectorAll('.remove-lib').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const gid = parseInt(btn.dataset.gameId);
                    try {
                        await API.games.removeLibrary(gid);
                        Utils.toast('已移出清单');
                        await this.loadPlatformData();
                        this.showMyLibrary();
                    } catch (err) {
                        Utils.toast('移出失败: ' + err.message);
                    }
                });
            });
        }
        Utils.show('#platform-modal');
    },

    // ===== 游戏开始画面 =====
    async openGameStart(gameId) {
        if (!Auth.isLoggedIn()) {
            Utils.toast('请先登录');
            this.showAuthModal('login');
            return;
        }
        try {
            const detail = await API.games.get(gameId);
            this.currentGame = detail;
            this.currentGameDetail = detail;
            this._renderGameStart();
            Utils.show('#game-start-modal');
        } catch (e) {
            Utils.toast('加载游戏失败: ' + e.message);
        }
    },

    _renderGameStart() {
        const stage = document.querySelector('#game-start-stage');
        const game = this.currentGame;
        if (!stage || !game) return;
        const bgStyle = game.image
            ? `background-image:url('${game.image}');background-size:cover;background-position:center;`
            : '';
        let html = `<div class="game-start-overlay"></div>`;
        // 描述（仅显示，不阻碍按钮点击）
        if (game.description) {
            html += `<div class="game-start-desc">${game.description}</div>`;
        }
        // 即将发布时，所有按钮不可用
        const comingSoon = game.is_coming_soon === 1;
        // 渲染按钮
        (game.buttons || []).forEach(b => {
            const enabled = comingSoon ? false : (b.is_enabled === 1);
            const x = b.position_x ?? 50;
            const y = b.position_y ?? 50;
            // 图片加载失败时回退为文字，避免出现"看不见的按钮"
            const label = (b.label || '').replace(/'/g, "\\'");
            const inner = b.image
                ? `<img src="${b.image}" alt="${b.label}" onerror="this.style.display='none';if(!this.nextElementSibling||this.nextElementSibling.tagName!=='SPAN'){this.insertAdjacentHTML('afterend', '<span>${label}</span>')}">`
                : `<span>${label}</span>`;
            html += `<button class="game-start-btn ${enabled ? '' : 'disabled'}"
                        style="left:${x}%;top:${y}%"
                        data-action="${b.action_type}"
                        data-button-id="${b.id}"
                        data-target-chapter="${b.target_story_chapter_id || ''}"
                        ${enabled ? '' : 'disabled'}>${inner}</button>`;
        });
        stage.style.cssText = `position:relative;width:100%;height:100%;${bgStyle}`;
        stage.innerHTML = html;
        // 绑定按钮
        stage.querySelectorAll('.game-start-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                const action = btn.dataset.action;
                this._handleGameButton(action, btn.dataset);
            });
        });
    },

    closeGameStart() {
        Utils.hide('#game-start-modal');
        this.currentGame = null;
        this.currentGameDetail = null;
    },

    // 处理游戏按钮点击
    async _handleGameButton(action, dataset) {
        const game = this.currentGame;
        if (!game) return;
        if (action === 'new_char') {
            await this.showNewCharModal(game);
        } else if (action === 'load') {
            await this.showLoadSaveModal(game);
        } else if (action === 'start') {
            await this._startGameWithCheck(game, dataset.targetChapter ? parseInt(dataset.targetChapter) : null);
        } else if (action === 'save') {
            // 保存按钮在平台层不会触发，因为还没进入游戏
            Utils.toast('请先进入游戏后再保存');
        } else if (action === 'exit') {
            this.closeGameStart();
        } else if (action === 'custom') {
            await this._startGameWithCheck(game, dataset.targetChapter ? parseInt(dataset.targetChapter) : null);
        }
    },

    // ===== 新建人物 =====
    async showNewCharModal(game) {
        // 必须先把游戏加入清单
        const libIds = new Set(this.myLibrary.map(l => l.game_id));
        if (!libIds.has(game.id)) {
            try {
                await API.games.addLibrary(game.id);
                this.myLibrary = await API.games.myLibrary();
                Utils.toast('已加入游戏清单');
            } catch (e) {
                Utils.toast('加入清单失败: ' + e.message);
                return;
            }
        }
        const options = game.player_options || [];
        if (options.length === 0) {
            Utils.toast('该游戏暂未配置可选玩家');
            return;
        }
        let selectedCharId = null;
        // 扮演角色：直接使用所选角色的名字（不再让玩家自定义改名，避免与剧情/称呼混乱）
        const charNameOf = (id) => {
            const o = options.find(x => x.character_id === id) || {};
            return (o.character && o.character.name) || '未命名';
        };

        const body = document.querySelector('#platform-modal-body');
        body.innerHTML = `
            <h3>选择扮演角色 - ${game.name}</h3>
            <p style="font-size:12px;color:var(--text-dim);margin:0 0 8px">
                选择一个角色来扮演，游戏中将直接使用该角色的名字（装备 / 背包 / 技能书均从后台该角色配置复制）。
            </p>
            <label>选择角色</label>
            <div class="char-pick-list">
                ${options.map(o => {
                    const c = o.character || {};
                    return `<div class="char-pick-card" data-char-id="${o.character_id}">
                        ${c.portrait_image ? `<img src="${c.portrait_image}" alt="">` : '<div style="width:100%;height:120px;background:rgba(0,0,0,0.3);border-radius:4px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;color:var(--text-dim)">无图</div>'}
                        <div class="cp-name">${c.name || '未命名'}</div>
                        <div class="cp-stats">${c.title || ''} | Lv.${c.level || 1}</div>
                    </div>`;
                }).join('')}
            </div>
            <div id="new-char-picked" style="font-size:12px;color:var(--gold);min-height:16px;margin-top:6px">未选择</div>
            <div id="new-char-msg" style="font-size:12px;color:var(--red);min-height:16px;margin-top:4px"></div>
            <button class="btn-platform primary" id="new-char-confirm" style="width:100%;margin-top:8px">确认扮演</button>
        `;
        Utils.show('#platform-modal');
        const pickedEl = () => body.querySelector('#new-char-picked');
        body.querySelectorAll('.char-pick-card').forEach(card => {
            card.addEventListener('click', () => {
                body.querySelectorAll('.char-pick-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedCharId = parseInt(card.dataset.charId);
                pickedEl().textContent = '将扮演：' + charNameOf(selectedCharId);
            });
        });
        body.querySelector('#new-char-confirm').addEventListener('click', async () => {
            const msgEl = body.querySelector('#new-char-msg');
            if (!selectedCharId) {
                msgEl.textContent = '请选择角色';
                return;
            }
            try {
                const uc = await API.games.createCharacter({
                    game_id: game.id,
                    base_character_id: selectedCharId,
                    custom_name: charNameOf(selectedCharId),
                });
                Utils.toast('人物创建成功');
                Utils.hide('#platform-modal');
                // 直接进入游戏
                await this._enterGame(uc.id);
            } catch (e) {
                msgEl.textContent = e.message || '创建失败';
            }
        });
    },

    // ===== 读取存档 =====
    async showLoadSaveModal(game) {
        const libIds = new Set(this.myLibrary.map(l => l.game_id));
        if (!libIds.has(game.id)) {
            Utils.toast('请先把游戏加入清单');
            return;
        }
        let chars = [];
        try {
            chars = await API.games.myCharacters(game.id);
        } catch (e) {
            Utils.toast('加载存档失败: ' + e.message);
            return;
        }
        const body = document.querySelector('#platform-modal-body');
        if (chars.length === 0) {
            body.innerHTML = `
                <h3>读取存档 - ${game.name}</h3>
                <div style="text-align:center;padding:30px;color:var(--text-dim)">
                    暂无存档，请先新建人物
                </div>
                <button class="btn-platform primary" id="goto-new-char" style="width:100%">新建人物</button>
            `;
            Utils.show('#platform-modal');
            body.querySelector('#goto-new-char').addEventListener('click', () => {
                Utils.hide('#platform-modal');
                this.showNewCharModal(game);
            });
            return;
        }
        body.innerHTML = `
            <h3>读取存档 - ${game.name}</h3>
            <div class="save-list">
                ${chars.map(c => `
                    <div class="save-item" data-uc-id="${c.id}">
                        <div class="si-info">
                            <div class="si-name">${c.custom_name}</div>
                            <div class="si-meta">Lv.${c.level} | HP ${c.hp}/${c.max_hp} | 更新: ${this._formatTime(c.updated_at)}</div>
                        </div>
                        <button class="si-del" data-uc-id="${c.id}">删除</button>
                    </div>
                `).join('')}
            </div>
        `;
        Utils.show('#platform-modal');
        body.querySelectorAll('.save-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.si-del')) return;
                const ucId = parseInt(item.dataset.ucId);
                Utils.hide('#platform-modal');
                await this._enterGame(ucId);
            });
        });
        body.querySelectorAll('.si-del').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ucId = parseInt(btn.dataset.ucId);
                if (!confirm('确定删除该存档？')) return;
                try {
                    await API.games.deleteCharacter(ucId);
                    Utils.toast('已删除');
                    this.showLoadSaveModal(game);
                } catch (err) {
                    Utils.toast('删除失败: ' + err.message);
                }
            });
        });
    },

    // ===== 进入游戏前的检查 =====
    async _startGameWithCheck(game, targetChapterId) {
        // 必须先加入清单
        const libIds = new Set(this.myLibrary.map(l => l.game_id));
        if (!libIds.has(game.id)) {
            try {
                await API.games.addLibrary(game.id);
                this.myLibrary = await API.games.myLibrary();
            } catch (e) {
                Utils.toast('加入清单失败: ' + e.message);
                return;
            }
        }
        // 检查是否有存档
        let chars = [];
        try {
            chars = await API.games.myCharacters(game.id);
        } catch {}
        if (chars.length === 0) {
            Utils.toast('请先新建人物');
            this.showNewCharModal(game);
            return;
        }
        if (chars.length === 1) {
            await this._enterGame(chars[0].id, targetChapterId);
            return;
        }
        // 多存档，弹出选择
        this.showLoadSaveModal(game);
    },

    // ===== 进入游戏（切换到游戏容器） =====
    async _enterGame(ucId, targetChapterId = null) {
        Utils.hide('#game-start-modal');
        Utils.hide('#platform-modal');
        try {
            // 获取用户角色完整信息
            const uc = await API.games.myCharacterFull(ucId);
            // 切换显示
            document.querySelector('#platform-layer')?.classList.add('hidden');
            const gc = document.querySelector('#game-container');
            if (gc) gc.style.display = '';
            // 调用 App 进入游戏
            if (typeof App !== 'undefined' && typeof App.enterGame === 'function') {
                await App.enterGame(uc, targetChapterId);
            } else {
                Utils.toast('游戏入口未就绪');
            }
        } catch (e) {
            Utils.toast('进入游戏失败: ' + e.message);
        }
    },

    // ===== 返回平台（从游戏中返回） =====
    returnToPlatform() {
        document.querySelector('#platform-layer')?.classList.remove('hidden');
        const gc = document.querySelector('#game-container');
        if (gc) gc.style.display = 'none';
        // 重新加载数据
        this.refreshUserArea();
        this.loadPlatformData();
    },

    _formatTime(t) {
        if (!t) return '-';
        try {
            const d = new Date(t);
            if (isNaN(d.getTime())) return t;
            return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch { return t; }
    },
};
