// ========== 地图/场景UI ==========

const MapPanel = {
    async show() {
        const body = Utils.$('#panel-body');
        body.innerHTML = '<h2>场景地图</h2>';

        try {
            const scenes = await API.scenes.list();
            const currentId = GameState.currentScene?.id;

            let html = '';
            scenes.forEach(scene => {
                const isCurrent = scene.id === currentId;
                const typeIcon = {
                    town: '🏘️', forest: '🌲', castle: '🏰', dungeon: '🗼',
                    wilderness: '🌿', cave: '🕳️', battlefield: '⚔️',
                }[scene.scene_type] || '📍';

                html += `
                    <div class="panel-item" style="cursor:pointer;${isCurrent ? 'background:rgba(201,168,76,0.1);' : ''}"
                         onclick="MapPanel.travelTo(${scene.id})">
                        <span class="label">${typeIcon} ${scene.name}</span>
                        <span class="value" style="font-size:12px">${isCurrent ? '← 当前' : scene.scene_type}</span>
                    </div>
                `;
            });

            body.innerHTML += html;

            if (GameState.currentScene) {
                body.innerHTML += `<h2 style="margin-top:20px">可前往</h2>`;
                if (GameState.sceneConnections.length > 0) {
                    GameState.sceneConnections.forEach(async conn => {
                        try {
                            const targetScene = await API.scenes.get(conn.to_scene_id);
                            const locked = conn.is_locked ? '🔒' : '';
                            const div = document.createElement('div');
                            div.className = 'panel-item';
                            div.style.cursor = conn.is_locked ? 'not-allowed' : 'pointer';
                            div.innerHTML = `<span class="label">${locked} ${targetScene.name}</span>
                                           <span class="value" style="font-size:12px">${conn.travel_text || ''}</span>`;
                            if (!conn.is_locked) {
                                div.addEventListener('click', () => this.travelTo(conn.to_scene_id));
                            }
                            body.appendChild(div);
                        } catch (e) { /* ignore */ }
                    });
                }
            }
        } catch (e) {
            body.innerHTML += '<p>无法加载场景数据</p>';
        }

        Utils.show('#panel-overlay');
    },

    async travelTo(sceneId) {
        Utils.hide('#panel-overlay');
        const scene = await GameState.enterScene(sceneId);
        if (scene) {
            // 加载场景的故事节点
            try {
                const nodes = await API.story.getNodes({ scene_id: sceneId });
                if (nodes.length > 0) {
                    await DialogueUI.showNode(nodes[0].id, null);
                } else {
                    Utils.setText('#dialogue-text', `你来到了${scene.name}。这里似乎没什么特别的...`);
                    Utils.setText('#speaker-name', '旁白');
                }
            } catch (e) {
                Utils.setText('#dialogue-text', `你来到了${scene.name}。`);
                Utils.setText('#speaker-name', '旁白');
            }
        }
    },
};