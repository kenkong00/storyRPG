// ========== 仪表盘模块 ==========
Admin.registerPage('dashboard', async (container) => {
  try {
    const [chars, items, scenes, skills, chapters, nodes] = await Promise.all([
      Admin.get('/characters'),
      Admin.get('/items'),
      Admin.get('/scenes'),
      Admin.get('/skills'),
      Admin.get('/story/chapters'),
      Admin.get('/story/nodes'),
    ]);

    container.innerHTML = `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${chars.length}</div>
          <div class="stat-label">人物角色</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${items.length}</div>
          <div class="stat-label">物品道具</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${scenes.length}</div>
          <div class="stat-label">游戏场景</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${nodes.length}</div>
          <div class="stat-label">剧情节点</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="table-container">
          <div class="table-header"><h3>最近角色</h3></div>
          <table>
            <thead><tr><th>名称</th><th>类型</th><th>等级</th><th>HP</th></tr></thead>
            <tbody>
              ${chars.slice(0, 5).map(c => `
                <tr>
                  <td>${c.name}</td>
                  <td><span class="tag tag-${c.character_type}">${c.character_type}</span></td>
                  <td>Lv.${c.level}</td>
                  <td>${c.hp}/${c.max_hp}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="table-container">
          <div class="table-header"><h3>章节列表</h3></div>
          <table>
            <thead><tr><th>标题</th><th>顺序</th><th>类型</th></tr></thead>
            <tbody>
              ${chapters.map(ch => `
                <tr>
                  <td>${ch.title}</td>
                  <td>${ch.chapter_order}</td>
                  <td><span class="tag tag-${ch.is_main_story ? 'ally' : 'npc'}">${ch.is_main_story ? '主线' : '支线'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="table-container">
          <div class="table-header"><h3>场景概览</h3></div>
          <table>
            <thead><tr><th>名称</th><th>类型</th><th>安全区</th></tr></thead>
            <tbody>
              ${scenes.map(s => `
                <tr>
                  <td>${s.name}</td>
                  <td>${s.scene_type}</td>
                  <td>${s.is_safe_zone ? '是' : '否'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="table-container">
          <div class="table-header"><h3>技能列表</h3></div>
          <table>
            <thead><tr><th>名称</th><th>类型</th><th>威力</th><th>属性</th></tr></thead>
            <tbody>
              ${skills.slice(0, 6).map(sk => `
                <tr>
                  <td>${sk.name}</td>
                  <td>${sk.skill_type}</td>
                  <td>${sk.power}</td>
                  <td>${sk.element}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="table-empty">加载仪表盘失败: ${e.message}</div>`;
  }
});