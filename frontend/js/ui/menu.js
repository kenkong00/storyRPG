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
        const s = window.ShowSettings ? ShowSettings.get() : {};
        const mode = s.stage_focus_mode || 'subtle';

        const modeBtn = (key, label, hint) => `
            <button class="sidebar-btn focus-opt ${key === mode ? 'active' : ''}" data-key="${key}"
                style="width:100%;margin:5px 0;text-align:left;padding:7px 12px">
                <b>${label}</b>${key === mode ? ' &nbsp;✓' : ''}
                <div style="font-size:11px;color:${key === mode ? 'rgba(0,0,0,.55)' : '#8a8272'};margin-top:2px">${hint}</div>
            </button>`;

        // 一行滑块：[标签] [range] [数值]
        const slider = (id, label, min, max, step, val, unit, hint) => `
            <div class="ss-row">
                <div class="ss-lbl">${label}${hint ? `<span class="ss-hint">${hint}</span>` : ''}</div>
                <input type="range" class="ss-range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
                <div class="ss-val" id="${id}-val">${val}${unit}</div>
            </div>`;

        body.innerHTML = '<h2>设置</h2>';

        body.innerHTML += '<h3 class="ss-h3">剧情演出 · 说话人高亮</h3>';
        body.innerHTML += `<p class="ss-note">正在说话的人提亮、其他人稍微压暗，一眼能分清谁在讲话。默认「柔和」——看得清又不刺眼。</p>`;
        body.innerHTML += `
            <div class="ss-modes">
                ${modeBtn('off', '关闭', '原色调，不叠加任何滤镜')}
                ${modeBtn('subtle', '柔和', '推荐：微微提亮说话者')}
                ${modeBtn('normal', '标准', '对比更明显')}
                ${modeBtn('strong', '强烈', '提亮 + 金色辉光')}
                ${modeBtn('custom', '自定义', '用下面的滑块自己调')}
            </div>`;

        body.innerHTML += '<h3 class="ss-h3">细粒度参数</h3>';
        body.innerHTML += '<p class="ss-note">拖任意一个滑块会自动切到「自定义」。改完立刻在当前画面上生效。</p>';
        body.innerHTML += slider('ss-dim-b', '非说话者亮度', 0.2, 1.2, 0.01, s.dim_brightness, '', '越小越暗');
        body.innerHTML += slider('ss-dim-s', '非说话者饱和', 0, 1.6, 0.01, s.dim_saturate, '', '越低越灰');
        body.innerHTML += slider('ss-spk-b', '说话者亮度', 0.7, 1.6, 0.01, s.speak_brightness, '', '略高于 1 才有提亮');
        body.innerHTML += slider('ss-spk-s', '说话者饱和', 0, 2.2, 0.01, s.speak_saturate, '', '');
        body.innerHTML += slider('ss-glow', '说话者辉光', 0, 100, 1, s.speak_glow, '', '0 = 不发光');
        body.innerHTML += slider('ss-tr', '过渡时长', 0, 2000, 20, s.focus_transition_ms, 'ms', '换人时明暗变化的速度');

        body.innerHTML += '<h3 class="ss-h3">自动播放</h3>';
        body.innerHTML += `
            <label class="ss-ck"><input type="checkbox" id="ss-auto-default" ${s.auto_play_default ? 'checked' : ''}>
                进游戏时默认开启自动播放</label>
            <p class="ss-note" style="margin:6px 0 10px">开启后右上角那颗「自动」会亮起，每句演完自动继续；点它一下即可暂停。适合暂时离开电脑。</p>
            ${slider('ss-delay', '每句停顿', 0, 4000, 100, s.auto_play_delay_ms, 'ms', '语音播完后再等这么久')}
            <div class="ss-tip">遇到选项 / 战斗 / 打开面板时会自动停下，不会替你选。</div>`;

        body.innerHTML += `
            <div style="display:flex;gap:8px;margin-top:18px">
                <button class="sidebar-btn" id="ss-reset" style="flex:1">恢复默认</button>
                <button class="sidebar-btn" onclick="MenuPanel.show()" style="flex:1">← 返回</button>
            </div>`;

        // ---- 档位：一次把预设数值灌进去 ----
        body.querySelectorAll('.focus-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                if (window.ShowSettings) {
                    if (key === 'custom') ShowSettings.setLocal({ stage_focus_mode: 'custom' });
                    else ShowSettings.applyPreset(key);
                }
                try { localStorage.setItem('rpg_stage_focus', key); } catch (e) {}
                if (window.DialogueUI && DialogueUI.refreshFocus) DialogueUI.refreshFocus();
                const name = { off: '关闭', subtle: '柔和', normal: '标准', strong: '强烈', custom: '自定义' }[key] || key;
                Utils.toast('高亮：' + name);
                MenuPanel.showSettings();
            });
        });

        // ---- 滑块：边拖边生效 ----
        const bindSlider = (id, key, unit, isInt) => {
            const el = document.getElementById(id);
            const out = document.getElementById(id + '-val');
            if (!el) return;
            const apply = () => {
                let v = parseFloat(el.value);
                if (isInt) v = Math.round(v);
                if (out) out.textContent = (isInt ? v : v.toFixed(2)) + unit;
                if (!window.ShowSettings) return;
                const patch = { stage_focus_mode: 'custom' };
                patch[key] = v;
                ShowSettings.setLocal(patch);
                if (window.DialogueUI && DialogueUI.refreshFocus) DialogueUI.refreshFocus();
            };
            el.addEventListener('input', apply);
            el.addEventListener('change', () => {
                // 松手时把档位按钮上的 ✓ 同步成「自定义」
                body.querySelectorAll('.focus-opt').forEach(b =>
                    b.classList.toggle('active', b.dataset.key === 'custom'));
            });
        };
        bindSlider('ss-dim-b', 'dim_brightness', '', false);
        bindSlider('ss-dim-s', 'dim_saturate', '', false);
        bindSlider('ss-spk-b', 'speak_brightness', '', false);
        bindSlider('ss-spk-s', 'speak_saturate', '', false);
        bindSlider('ss-glow', 'speak_glow', '', true);
        bindSlider('ss-tr', 'focus_transition_ms', 'ms', true);
        bindSlider('ss-delay', 'auto_play_delay_ms', 'ms', true);

        // 停顿改完，正在自动播放的也立刻按新间隔走
        document.getElementById('ss-delay')?.addEventListener('change', () => {
            if (window.DialogueUI && DialogueUI.isAutoPlaying && DialogueUI.isAutoPlaying()) {
                DialogueUI.setAutoPlay(true, { silent: true });
            }
        });

        document.getElementById('ss-auto-default')?.addEventListener('change', (e) => {
            if (window.ShowSettings) ShowSettings.setLocal({ auto_play_default: e.target.checked });
            Utils.toast(e.target.checked ? '下次进游戏默认开启自动播放' : '下次进游戏不自动播放');
        });

        document.getElementById('ss-reset')?.addEventListener('click', () => {
            if (window.ShowSettings) ShowSettings.clearLocal();
            if (window.DialogueUI && DialogueUI.refreshFocus) DialogueUI.refreshFocus();
            Utils.toast('已恢复默认（服务端设定）');
            MenuPanel.showSettings();
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