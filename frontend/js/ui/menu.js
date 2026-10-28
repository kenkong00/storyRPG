// ========== 菜单UI ==========

const MenuPanel = {
    async show() {
        const body = Utils.$('#panel-body');
        body.innerHTML = '<h2>游戏菜单</h2>';

        body.innerHTML += `
            <button class="sidebar-btn" onclick="MenuPanel.startGame()" style="width:100%;margin:8px 0">开始新游戏</button>
            <button class="sidebar-btn" onclick="MenuPanel.showSettings()" style="width:100%;margin:8px 0">设置</button>
            <button class="sidebar-btn" onclick="MenuPanel.showStoryFlags()" style="width:100%;margin:8px 0">剧情标记</button>
            <button class="sidebar-btn" onclick="MenuPanel.about()" style="width:100%;margin:8px 0">关于</button>
        `;

        Utils.show('#panel-overlay');
    },

    async startGame() {
        Utils.hide('#panel-overlay');
        Utils.toast('开始新游戏...');

        // 初始化游戏
        await GameState.init();
        await GameState.enterScene(3); // 废弃城堡

        // 加载第一章故事
        try {
            const chapters = await API.story.getChapters();
            if (chapters.length > 0) {
                const nodes = await API.story.getNodes({ chapter_id: chapters[0].id });
                if (nodes.length > 0) {
                    await DialogueUI.showNode(nodes[0].id, App.handleStoryChoice);
                }
            }
        } catch (e) {
            console.error('加载故事失败:', e);
        }
    },

    async showStoryFlags() {
        const body = Utils.$('#panel-body');
        body.innerHTML = '<h2>剧情标记</h2>';

        try {
            const flags = await API.story.getFlags();
            flags.forEach(flag => {
                body.innerHTML += `
                    <div class="panel-item">
                        <span class="label">${flag.flag_key}</span>
                        <span class="value gold">${flag.flag_value || '未设置'}</span>
                    </div>
                `;
            });
        } catch (e) {
            body.innerHTML += '<p>无标记数据</p>';
        }

        Utils.show('#panel-overlay');
    },

    async showSettings() {
        const body = Utils.$('#panel-body');
        const cur = (typeof localStorage !== 'undefined' && localStorage.getItem('rpg_stage_focus')) || 'off';
        const opts = [
            { key: 'off',    label: '关闭（原色调，不叠加任何滤镜）' },
            { key: 'subtle', label: '柔和（轻微提亮 / 变暗）' },
            { key: 'normal', label: '标准（明显提亮说话者）' },
            { key: 'strong', label: '强烈（提亮 + 金色辉光）' },
        ];
        body.innerHTML = '<h2>设置</h2>';
        body.innerHTML += '<h3 style="margin:16px 0 8px;color:var(--accent)">画面特效</h3>';
        body.innerHTML += '<p style="font-size:12px;color:#888;line-height:1.7;margin-bottom:10px">对话中立绘的提亮 / 发光 / 变暗强度。默认「关闭」按原图显示，不叠加任何滤镜。</p>';
        body.innerHTML += opts.map(o => `
            <button class="sidebar-btn focus-opt ${o.key === cur ? 'active' : ''}" data-key="${o.key}" style="width:100%;margin:6px 0;text-align:left">
                <b>${o.label}</b>${o.key === cur ? ' &nbsp;✓ 当前' : ''}
            </button>`).join('');
        body.innerHTML += '<button class="sidebar-btn" onclick="MenuPanel.show()" style="width:100%;margin:16px 0 0">← 返回</button>';
        body.querySelectorAll('.focus-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                try { localStorage.setItem('rpg_stage_focus', key); } catch (e) {}
                if (window.DialogueUI && DialogueUI.refreshFocus) DialogueUI.refreshFocus();
                Utils.toast('画面特效：' + (key === 'off' ? '关闭' : key === 'subtle' ? '柔和' : key === 'normal' ? '标准' : '强烈'));
                MenuPanel.showSettings();
            });
        });
        Utils.show('#panel-overlay');
    },

    about() {
        const body = Utils.$('#panel-body');
        body.innerHTML = `
            <h2>关于</h2>
            <p style="line-height:2;color:#888">
                暗影纪元 - RPG故事游戏<br>
                版本: 0.2.0<br>
                一个复杂的剧情式RPG游戏<br>
                融合多系统：人物互动、升级、<br>
                故事分支、回合制战斗、<br>
                NPC关系与事件介入
            </p>
        `;
        Utils.show('#panel-overlay');
    },
};