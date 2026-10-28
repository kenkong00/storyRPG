// ========== 用户管理模块（只读：列表 + 详情查看） ==========
Admin.registerPage('users', async (container) => {
  let users = [];
  let detailCache = new Map(); // user_id -> detail

  const SLOT_LABELS = { 1: '套装', 2: '配饰', 3: '法器' };

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatTime(t) {
    if (!t) return '—';
    try {
      const d = new Date(t);
      if (isNaN(d.getTime())) return escapeHtml(t);
      return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return escapeHtml(t); }
  }

  function avatarHtml(user, size = 48) {
    if (user && user.avatar) {
      return `<img src="${escapeHtml(user.avatar)}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:${Math.floor(size / 6)}px;background:var(--bg-input)">`;
    }
    const initial = ((user && (user.username || user.nickname)) || '?').charAt(0).toUpperCase();
    return `<div style="width:${size}px;height:${size}px;border-radius:${Math.floor(size / 6)}px;background:var(--bg-input);display:flex;align-items:center;justify-content:center;color:var(--gold);font-weight:600;font-size:${Math.floor(size / 2.4)}px">${escapeHtml(initial)}</div>`;
  }

  async function load() {
    users = await Admin.get('/users/');
    render();
    // 后台预加载每个用户的游戏数量（用于列表展示与详情复用）
    preloadGameCounts();
  }

  async function preloadGameCounts() {
    const concurrency = 8;
    const queue = users.filter(u => !detailCache.has(u.id));
    async function worker() {
      while (queue.length > 0) {
        const u = queue.shift();
        if (!u) return;
        try {
          const detail = await Admin.get(`/users/${u.id}/detail`);
          detailCache.set(u.id, detail);
          const cell = document.getElementById(`user-count-${u.id}`);
          if (cell) cell.textContent = (detail.games || []).length;
        } catch (e) {
          const cell = document.getElementById(`user-count-${u.id}`);
          if (cell) cell.textContent = '—';
        }
      }
    }
    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
  }

  function render() {
    let bodyHtml = '';
    if (users.length === 0) {
      bodyHtml = '<div class="table-empty">暂无用户</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:64px">头像</th><th>用户名</th><th>昵称</th><th>注册时间</th><th>最后登录</th><th style="width:100px">拥有游戏数</th><th style="width:100px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      users.forEach(u => {
        const cached = detailCache.get(u.id);
        const count = cached ? (cached.games || []).length : '…';
        bodyHtml += `
          <tr>
            <td>${avatarHtml(u, 48)}</td>
            <td>${escapeHtml(u.username)}</td>
            <td>${escapeHtml(u.nickname || '—')}</td>
            <td style="font-size:12px">${formatTime(u.created_at)}</td>
            <td style="font-size:12px">${formatTime(u.last_login)}</td>
            <td style="text-align:center"><span class="tag tag-ally" id="user-count-${u.id}">${count}</span></td>
            <td>
              <div class="action-btns">
                <button class="btn-view" data-id="${u.id}">查看详情</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    container.innerHTML = `
      <div class="search-bar">
        <span style="color:var(--text-muted);line-height:2">共 <b style="color:var(--gold)">${users.length}</b> 个用户</span>
      </div>
      ${bodyHtml}
    `;
    bindEvents();
  }

  function bindEvents() {
    container.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', () => showDetail(parseInt(btn.dataset.id)));
    });
  }

  async function showDetail(userId) {
    const user = users.find(u => u.id === userId);
    let detail = detailCache.get(userId);
    if (!detail) {
      Admin.showModal('用户详情', '<div class="table-empty">加载中...</div>', null);
      applyDetailModalStyle();
      try {
        detail = await Admin.get(`/users/${userId}/detail`);
        detailCache.set(userId, detail);
        const cell = document.getElementById(`user-count-${userId}`);
        if (cell) cell.textContent = (detail.games || []).length;
      } catch (e) {
        Admin.toast('加载详情失败: ' + e.message, 'error');
        Admin.closeModal();
        return;
      }
    }
    renderDetailModal(user, detail);
  }

  // 调整模态框为宽版只读样式
  function applyDetailModalStyle() {
    const modal = document.querySelector('#modal-container .modal');
    if (modal) modal.style.maxWidth = '900px';
    const body = document.querySelector('#modal-container .modal-body');
    if (body) { body.style.maxHeight = '72vh'; body.style.overflowY = 'auto'; }
    const saveBtn = document.getElementById('modal-save-btn');
    if (saveBtn) saveBtn.style.display = 'none';
    document.querySelectorAll('#modal-container .modal-footer .btn-outline').forEach(b => {
      b.textContent = '关闭';
    });
  }

  function renderDetailModal(user, detail) {
    const u = detail.user || user || {};
    const games = detail.games || [];

    const infoCard = `
      <div class="stat-card" style="display:flex;gap:16px;align-items:center;padding:16px;margin-bottom:16px">
        ${avatarHtml(u, 64)}
        <div style="flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 16px">
          <div><div style="color:var(--text-muted);font-size:12px">用户名</div><div style="font-weight:600">${escapeHtml(u.username || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:12px">昵称</div><div style="font-weight:600">${escapeHtml(u.nickname || '—')}</div></div>
          <div><div style="color:var(--text-muted);font-size:12px">注册时间</div><div style="font-size:13px">${formatTime(u.created_at)}</div></div>
          <div><div style="color:var(--text-muted);font-size:12px">最后登录</div><div style="font-size:13px">${formatTime(u.last_login)}</div></div>
        </div>
      </div>
    `;

    let gamesHtml = '';
    if (games.length === 0) {
      gamesHtml = '<div class="table-empty">该用户暂无游戏记录</div>';
    } else {
      gamesHtml = `<div style="margin-bottom:8px;font-size:13px;color:var(--text-muted)">共 <b style="color:var(--gold)">${games.length}</b> 个游戏</div>`;
      gamesHtml += '<div style="display:flex;flex-direction:column;gap:10px">';
      games.forEach((g, idx) => { gamesHtml += renderGameBlock(g, idx); });
      gamesHtml += '</div>';
    }

    Admin.showModal(`用户详情 · ${escapeHtml(u.username || '')}`, infoCard + gamesHtml, null);
    applyDetailModalStyle();
    bindDetailEvents();
  }

  function renderGameBlock(game, idx) {
    const chars = game.characters || [];
    const header = `
      <div class="game-collapse-header" data-idx="${idx}" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);user-select:none">
        <span class="collapse-arrow" style="display:inline-block;transition:transform .2s;color:var(--gold);font-size:12px">▶</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${escapeHtml(game.game_name || '未命名游戏')}</div>
          <div style="font-size:11px;color:var(--text-muted)">加入时间: ${formatTime(game.added_at)}</div>
        </div>
        <span class="tag tag-ally">角色 ${chars.length}</span>
      </div>
    `;
    let body = '';
    if (chars.length === 0) {
      body = '<div class="table-empty" style="padding:12px">该游戏暂无角色</div>';
    } else {
      body = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;padding:12px 4px">';
      chars.forEach(c => { body += renderCharacterCard(c); });
      body += '</div>';
    }
    return `
      <div class="game-block" data-idx="${idx}">
        ${header}
        <div class="game-collapse-body" style="display:none;border:1px solid var(--border);border-top:0;border-radius:0 0 var(--radius) var(--radius)">
          ${body}
        </div>
      </div>
    `;
  }

  function renderCharacterCard(c) {
    const name = c.custom_name ? escapeHtml(c.custom_name) : '未命名角色';
    const baseName = c.base_character_name ? `<div style="color:var(--text-muted);font-size:11px">基于: ${escapeHtml(c.base_character_name)}</div>` : '';
    const statRow = (label, val) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span style="color:var(--text-muted)">${label}</span><span style="font-weight:600">${val}</span></div>`;

    // 装备按槽位分组
    const eqGroups = {};
    (c.equipments || []).forEach(e => {
      const slot = e.slot;
      if (!eqGroups[slot]) eqGroups[slot] = [];
      eqGroups[slot].push(e);
    });
    let equipHtml = '';
    [1, 2, 3].forEach(slot => {
      const label = SLOT_LABELS[slot] || `槽位${slot}`;
      const items = eqGroups[slot] || [];
      const itemHtml = items.length > 0
        ? items.map(e => `
            <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:var(--bg-input);border-radius:4px">
              ${e.image ? `<img src="${escapeHtml(e.image)}" style="width:28px;height:28px;object-fit:contain;border-radius:3px;background:var(--bg-card)">` : `<div style="width:28px;height:28px;background:var(--bg-card);border-radius:3px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:9px">无</div>`}
              <span style="font-size:11px">${escapeHtml(e.name || '—')}</span>
            </div>
          `).join('')
        : `<div style="font-size:11px;color:var(--text-muted);padding:4px 0">（空）</div>`;
      equipHtml += `
        <div style="margin-bottom:6px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">${label}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${itemHtml}</div>
        </div>
      `;
    });

    // 背包网格
    const inv = c.inventory || [];
    let invHtml = '';
    if (inv.length === 0) {
      invHtml = '<div style="font-size:11px;color:var(--text-muted)">（空）</div>';
    } else {
      invHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px">';
      inv.forEach(it => {
        invHtml += `
          <div style="text-align:center;padding:4px;background:var(--bg-input);border-radius:4px">
            ${it.image ? `<img src="${escapeHtml(it.image)}" style="width:36px;height:36px;object-fit:contain;border-radius:3px;background:var(--bg-card);display:block;margin:0 auto">` : `<div style="width:36px;height:36px;background:var(--bg-card);border-radius:3px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:9px;margin:0 auto">无</div>`}
            <div style="font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(it.name || '')}">${escapeHtml(it.name || '—')}</div>
            <div style="font-size:10px;color:var(--gold)">×${it.quantity || 0}</div>
          </div>
        `;
      });
      invHtml += '</div>';
    }

    return `
      <div class="stat-card" style="padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-weight:600;font-size:14px">${name}</div>
            ${baseName}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <span class="tag tag-ally">Lv ${c.level ?? 0}</span>
            <span class="tag tag-choice">${escapeHtml(c.realm_level || '—')}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:8px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:8px">
          ${statRow('HP', `${c.hp ?? 0} / ${c.max_hp ?? 0}`)}
          ${statRow('MP', `${c.mp ?? 0} / ${c.max_mp ?? 0}`)}
          ${statRow('攻击', c.attack ?? 0)}
          ${statRow('防御', c.defense ?? 0)}
          ${statRow('速度', c.speed ?? 0)}
          ${statRow('幸运', c.luck ?? 0)}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
          存档节点: <span style="color:var(--text-primary)">${escapeHtml(String(c.last_story_node_id ?? '—'))}</span> · 更新: ${formatTime(c.updated_at)}
        </div>
        <div style="margin-bottom:8px">
          <div style="font-size:11px;color:var(--gold);margin-bottom:4px;font-weight:600">装备</div>
          ${equipHtml}
        </div>
        <div>
          <div style="font-size:11px;color:var(--gold);margin-bottom:4px;font-weight:600">背包 (${inv.length})</div>
          ${invHtml}
        </div>
      </div>
    `;
  }

  function bindDetailEvents() {
    document.querySelectorAll('#modal-container .game-collapse-header').forEach(h => {
      h.addEventListener('click', () => {
        const block = h.closest('.game-block');
        const body = block.querySelector('.game-collapse-body');
        const arrow = h.querySelector('.collapse-arrow');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
      });
    });
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});
