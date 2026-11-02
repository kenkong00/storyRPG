// ==========================================================================
// 卡牌外观拼装（左侧「游戏」栏目 · 卡牌系统之后）
//
// 新版：和「人物外观拼装」同一套维度体系，自由建立卡牌角色外观。
//   · 角色 = 职业 / 人物，全部外观参数（发型/发色/瞳色/肤色/体型/衣着/风格…）
//     都暴露成可手动修改、可增可删的维度 —— 不再有「花括号占位符」模板。
//   · 维度 / 选项 / 题材的定义在「定义管理」里增删改，与人物外观拼装共享同一套，
//     改完立即影响这里的下拉选项与出图提示词。
//   · 右侧提示词实时按「角色外观 + 卡牌动作表情 + 卡面参数」拼装。
//
// 三个 Tab：
//   1. 卡牌角色外观 —— 选角色 + 选卡，自由编辑全部外观参数
//   2. 卡牌提示词 —— 全部卡的动作 / 表情 / 附加一屏看全，可搜索、可批量改
//   3. 定义管理 —— 分组 / 维度 / 选项 / 题材的增删改（与人物外观共用）
// ==========================================================================
Admin.registerPage('card_appearance', async (container) => {
  ensureStyle();

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const $ = (id) => document.getElementById(id);

  const ST = {
    tab: localStorage.getItem('ca_tab') || 'role',
    roles: { classes: [], characters: [] },
    cards: [],
    settings: {}, sets: [],
    role: parseRole(localStorage.getItem('ca_role') || ''),  // {kind,id}
    cls: '',          // 当前角色对应的职业 code（预览 / 出图 / 卡牌过滤用）
    card: localStorage.getItem('ca_card') || '',
    gender: localStorage.getItem('ca_gender') || 'female',
    p: {},            // 卡面参数（画风覆盖/男装/女装/兜底/前后缀/备注/enabled）
    cardF: { art_action: '', art_expression: '', art_extra: '' },
    appearance: {},
    editor: null,
    loaded: false,
    _pt: null,
  };

  function parseRole(v) {
    const s = String(v || '');
    const i = s.indexOf(':');
    if (i > 0 && (s.slice(0, i) === 'class' || s.slice(0, i) === 'character')) {
      return { kind: s.slice(0, i), id: s.slice(i + 1) };
    }
    return { kind: 'class', id: '' };
  }
  const roleVal = (r) => r.kind + ':' + r.id;

  // ---------------- 数据 ----------------
  async function loadAll(force) {
    const [classes, cards, settings, sets] = await Promise.all([
      Admin.get('/cardgame/classes'),
      Admin.get('/cardgame/cards'),
      Admin.get('/cardgame/settings'),
      Admin.get('/cardgame/art/sets'),
    ]);
    ST.cards = cards || [];
    ST.settings = settings || {};
    ST.sets = (sets && sets.items) || [];
  }

  async function loadRoles(force) {
    if (ST.loaded && !force) return;
    const r = await Admin.get('/cardgame/art/roles');
    ST.roles = { classes: r.classes || [], characters: r.characters || [] };
    ST.loaded = true;
  }

  function currentRole() {
    if (ST.role.kind === 'character') {
      return ST.roles.characters.find(x => String(x.id) === String(ST.role.id)) || null;
    }
    return ST.roles.classes.find(x => x.code === ST.role.id) || null;
  }

  function roleLabel(r) {
    if (!r) return '';
    return r.name || r.code || String(r.id) || '';
  }

  const cardOf = (code) => ST.cards.find((c) => c.code === code) || null;

  function cardsForRole() {
    let list = ST.cards;
    if (ST.cls) {
      const hit = list.filter(c => c.class_code === ST.cls || c.class_code === 'universal');
      if (hit.length) list = hit;
    }
    return list;
  }

  // 切角色：取详情 → 装卡牌 → 重挂编辑器
  async function applyRole() {
    const role = currentRole();
    if (!role) return;
    ST.cls = ST.role.kind === 'character' ? (role.class_code || '') : role.code;
    const detail = await Admin.get(`/cardgame/art/roles/${ST.role.kind}/${encodeURIComponent(ST.role.id)}`);
    ST.appearance = detail.appearance || {};
    // 编辑的是「职业」时，把外观编辑器的职业下拉直接对上——
    // 这样题材 × 职业 的参数池一打开就落在正确的款式上。
    if (ST.role.kind === 'class' && ST.role.id) {
      ST.appearance.classCode = ST.role.id;
    }
    ST.p = Object.assign({
      style_override: '', outfit_male: '', outfit_female: '', outfit_other: '',
      prefix_prompt: '', suffix_prompt: '', note: '', enabled: 1,
    }, detail.params || {});
    const list = cardsForRole();
    if (!ST.card || !list.some(c => c.code === ST.card)) {
      ST.card = (list[0] || {}).code || '';
    }
    loadCardFields();
    // 必须 await：不等待挂载完成就 refreshPrompt()，会作用在旧编辑器实例上，
    // 把刚切好的职业/题材下拉又刷回上一套值。
    await mountEditor();
  }

  function loadCardFields() {
    const card = cardOf(ST.card) || {};
    ST.cardF = {
      art_action: card.art_action || '',
      art_expression: card.art_expression || '',
      art_extra: card.art_extra || '',
    };
  }

  // ---------------- 外壳 ----------------
  container.innerHTML = `
    <div class="apx-wrap">
      <div class="apx-tabs">
        <button class="apx-tab${ST.tab === 'role' ? ' on' : ''}" data-catab="role">卡牌角色外观</button>
        <button class="apx-tab${ST.tab === 'prompts' ? ' on' : ''}" data-catab="prompts">卡牌提示词</button>
        <button class="apx-tab${ST.tab === 'manage' ? ' on' : ''}" data-catab="manage">定义管理</button>
      </div>
      <div id="apx-body"><div class="apx-loading">加载中…</div></div>
    </div>`;

  container.querySelectorAll('.apx-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      ST.tab = btn.dataset.catab;
      try { localStorage.setItem('ca_tab', ST.tab); } catch (_) {}
      container.querySelectorAll('.apx-tab').forEach((b) => b.classList.toggle('on', b === btn));
      renderPane();
    });
  });

  function renderPane() {
    if (ST.tab === 'prompts') return renderPrompts();
    if (ST.tab === 'manage') return renderManage();
    return renderRole();
  }

  // ====================================================================
  // Tab1：卡牌角色外观（自由参数拼装）
  // ====================================================================
  function renderRole() {
    const body = $('apx-body');
    if (!body) return;
    if (!ST.roles.classes.length && !ST.roles.characters.length) {
      body.innerHTML = '<div class="table-empty">还没有职业与人物，先去「卡牌系统 / 人物管理」建一批</div>';
      return;
    }
    const role = currentRole();
    if (!role) {
      ST.role = { kind: 'class', id: (ST.roles.classes[0] || {}).code || '' };
      applyRole();
      return;
    }
    if (!ST.card) {
      body.innerHTML = '<div class="table-empty">卡牌库里还没有卡，先去「卡牌系统 → 卡牌库」建一张</div>';
      return;
    }

    const clsOpts = ST.roles.classes.map((c) => {
      const sel = ST.role.kind === 'class' && ST.role.id === c.code ? ' selected' : '';
      return `<option value="class:${esc(c.code)}"${sel}>${esc(c.name || '')}${c.has_appearance ? ' ◆' : ''}</option>`;
    }).join('');
    const charOpts = ST.roles.characters.map((c) => {
      const sel = ST.role.kind === 'character' && String(ST.role.id) === String(c.id) ? ' selected' : '';
      const clsName = (ST.roles.classes.find(x => x.code === c.class_code) || {}).name || c.class_code || '';
      return `<option value="character:${esc(c.id)}"${sel}>${esc(c.name || '')}${clsName ? '（' + esc(clsName) + '）' : ''}</option>`;
    }).join('');
    const cardOpts = cardsForRole().map((c) =>
      `<option value="${esc(c.code)}" ${c.code === ST.card ? 'selected' : ''}>${esc(c.name)}（${esc(c.code)}）</option>`).join('') || '<option value="">没有卡牌</option>';

    const isChar = ST.role.kind === 'character';
    const pf = (k, label, ph, area) => `
      <label class="cx-f"><span>${label}</span>
        ${area
          ? `<textarea class="apx-ta cx-pin" data-pk="${k}" rows="2" spellcheck="false" placeholder="${esc(ph || '')}">${esc(ST.p[k] || '')}</textarea>`
          : `<input class="apx-inp cx-pin" data-pk="${k}" value="${esc(ST.p[k] || '')}" placeholder="${esc(ph || '')}">`}
      </label>`;

    body.innerHTML = `
      <div class="apx-bar">
        <label class="apx-field"><span>卡牌角色（职业 / 人物）</span>
          <select class="apx-sel" id="ca-role" style="min-width:210px">
            <optgroup label="职业">${clsOpts}</optgroup>
            <optgroup label="人物">${charOpts}</optgroup>
          </select>
        </label>
        <label class="apx-field"><span>卡牌（动作表情取自这张）</span>
          <select class="apx-sel" id="ca-card" style="min-width:190px">${cardOpts}</select>
        </label>
        <label class="apx-field"><span>性别（兜底衣着 / 出图参数）</span>
          <select class="apx-sel" id="ca-gender">
            <option value="female"${ST.gender === 'female' ? ' selected' : ''}>女</option>
            <option value="male"${ST.gender === 'male' ? ' selected' : ''}>男</option>
            <option value="unknown"${ST.gender === 'unknown' ? ' selected' : ''}>不确定</option>
          </select>
        </label>
        <button class="apx-btn" id="ca-gen-toggle" title="展开 / 收起全局出图参数">⚙ 出图参数</button>
        <button class="apx-btn" id="ca-params-toggle" title="画风覆盖 / 衣着覆盖 / 前后缀">⚙ 卡面参数</button>
        <button class="apx-btn primary" id="ca-render">🖼 按当前外观出图</button>
        <button class="apx-btn primary" id="ca-save">💾 保存</button>
        <span class="apx-hint" id="ca-status"></span>
      </div>

      <div id="ca-genbox" style="display:none;margin-bottom:10px"><div id="ca-gen-params"></div></div>

      <div class="apx-hintbar">
        上面「卡牌角色」里的<b>职业</b>就是卡牌系统里的「职业」：改名 / 改画风 / 新增 / 删除都在
        <b>卡牌系统 → 职业</b> 那一页（每个职业自带一套面板、画风与男女衣着）。
        <button class="apx-btn xs" id="ca-goto-classes">去管理职业 →</button>
      </div>


      <div id="ca-params" class="cx-params" style="display:none">
        <div class="cx-params-h">
          <span>卡面参数</span>
          <span class="apx-hint">${isChar ? '存在这个人身上，优先级：这里 > 套装 > 职业' : '直接写回职业（与「卡牌系统 → 职业」同一份）'}</span>
        </div>
        <div class="cx-params-grid">
          ${pf('style_override', isChar ? '画风覆盖（留空 = 套装/职业画风）' : '职业画风',
              '例如：水墨卡牌风，宣纸质感，朱红点缀', true)}
          ${pf('outfit_male', '男装着装', '例如：玄铁重铠，护肩刻裂纹，腰悬断剑')}
          ${pf('outfit_female', '女装着装', '例如：银白长裙，腰束流苏，锁骨链坠魂晶')}
          ${pf('outfit_other', '兜底装（性别未知）', '男女都不合适时用这段')}
          ${isChar ? pf('prefix_prompt', '前置（贴在整段最前）', '例如：全身卡面，暗金边框，背景是燃烧的裂界', true) : ''}
          ${isChar ? pf('suffix_prompt', '后置（贴在整段最后）', '例如：脚下碎裂的石板，衣角被热浪掀起', true) : ''}
          ${isChar ? pf('note', '备注（只给自己看）', '例如：这套只给 SSR 版本用') : ''}
        </div>
        ${isChar ? `
        <div class="cx-params-en">
          <label class="cx-f" style="flex-direction:row;align-items:center;gap:6px">
            <input type="checkbox" id="ca-enabled" ${Number(ST.p.enabled) ? 'checked' : ''}>
            <span>启用这份卡牌角色配置（关掉 = 完全按职业/套装/人物外观来拼）</span>
          </label>
        </div>` : ''}
      </div>

      <div id="ca-editor" class="cx-editor"></div>`;

    // ---- 绑定 ----
    $('ca-role').addEventListener('change', async (e) => {
      ST.role = parseRole(e.target.value);
      try { localStorage.setItem('ca_role', roleVal(ST.role)); } catch (_) {}
      await applyRole();
      refreshPrompt();
    });
    $('ca-card').addEventListener('change', (e) => {
      ST.card = e.target.value;
      try { localStorage.setItem('ca_card', ST.card); } catch (_) {}
      loadCardFields();
      refreshPrompt();
    });
    $('ca-gender').addEventListener('change', (e) => {
      ST.gender = e.target.value;
      try { localStorage.setItem('ca_gender', ST.gender); } catch (_) {}
      refreshPrompt();
    });
    $('ca-params-toggle').addEventListener('click', () => {
      const box = $('ca-params');
      box.style.display = box.style.display === 'none' ? '' : 'none';
    });
    body.querySelectorAll('.cx-pin').forEach((el) => {
      el.addEventListener('input', () => {
        ST.p[el.dataset.pk] = el.value;
        schedulePromptRefresh();
      });
    });
    const enEl = $('ca-enabled');
    if (enEl) enEl.addEventListener('change', () => { ST.p.enabled = enEl.checked ? 1 : 0; });
    const gotoCls = $('ca-goto-classes');
    if (gotoCls) gotoCls.addEventListener('click', () => {
      // 先切到卡牌系统页，等它挂好再切到「职业」分页（模块是懒加载的）
      const jump = () => { if (window.CardGameTabs) window.CardGameTabs.goto('classes'); };
      if (Admin.navigate) { Admin.navigate('cards'); setTimeout(jump, 350); } else jump();
    });
    $('ca-save').addEventListener('click', saveAll);
    $('ca-render').addEventListener('click', generate);

    let genMounted = false;
    $('ca-gen-toggle').addEventListener('click', async () => {
      const box = $('ca-genbox');
      const open = box.style.display === 'none';
      box.style.display = open ? '' : 'none';
      if (open && !genMounted && window.GenParams) {
        genMounted = true;
        try { await GenParams.init($('ca-gen-params'), { scope: 'cards_appearance' }); }
        catch (e) { $('ca-gen-params').innerHTML = `<div class="apx-hint">参数加载失败：${esc(e.message)}</div>`; }
      }
    });

    mountEditor();
  }

  function schedulePromptRefresh() {
    clearTimeout(ST._pt);
    ST._pt = setTimeout(refreshPrompt, 260);
  }

  async function refreshPrompt() {
    if (ST.editor && typeof ST.editor.refresh === 'function') ST.editor.refresh();
  }

  // ---- 提示词构建器：角色外观 + 卡牌动作表情 + 卡面参数 → 卡面提示词 ----
  async function cardPromptBuilder(appearance) {
    const payload = {
      card_code: ST.card,
      gender: ST.gender,
      appearance: appearance || {},
      style_override: ST.p.style_override,
      outfit_male: ST.p.outfit_male,
      outfit_female: ST.p.outfit_female,
      outfit_other: ST.p.outfit_other,
      prefix_prompt: ST.p.prefix_prompt,
      suffix_prompt: ST.p.suffix_prompt,
      art_action: ST.cardF.art_action,
      art_expression: ST.cardF.art_expression,
      art_extra: ST.cardF.art_extra,
    };
    if (ST.cls) payload.class_code = ST.cls;
    if (ST.role.kind === 'character') payload.character_id = ST.role.id;
    return Admin.post('/cardgame/art/preview-live', payload);
  }

  async function mountEditor() {
    const host = $('ca-editor');
    if (!host) return;
    host.innerHTML = '<div class="apx-loading">加载外观编辑器…</div>';
    ST.editor = await window.AppearanceEditor.mount(host, ST.appearance, {
      includeSensitive: false,   // 卡面出图一律干净，成人维度不参与
      layout: 'split',
      onPrompt: cardPromptBuilder,
      onChange: () => { ST.appearance = ST.editor ? ST.editor.getAppearance() : ST.appearance; },
      onSave: async () => saveAll(),
    });
  }

  // ---- 保存 ----
  async function saveRole() {
    await Admin.put(`/cardgame/art/roles/${ST.role.kind}/${encodeURIComponent(ST.role.id)}`, {
      appearance: ST.editor ? ST.editor.getAppearance() : ST.appearance,
      style_override: ST.p.style_override,
      outfit_male: ST.p.outfit_male,
      outfit_female: ST.p.outfit_female,
      outfit_other: ST.p.outfit_other,
      prefix_prompt: ST.p.prefix_prompt,
      suffix_prompt: ST.p.suffix_prompt,
      note: ST.p.note,
      enabled: ST.p.enabled,
    });
  }

  async function saveAll(e) {
    const btn = e && e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      await saveRole();
      await loadAll(true);
      await loadRoles(true);
      Admin.toast('已保存：角色外观 + 卡面参数', 'success');
    } catch (err) {
      Admin.toast('保存失败：' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---- 出图 ----
  async function generate(e) {
    const btn = e && e.currentTarget;
    const text = ST.editor ? ST.editor.getPromptText() : '';
    if (!text) { Admin.toast('提示词是空的，先拼一份', 'error'); return; }
    if (btn) btn.disabled = true;
    $('ca-status').textContent = '已提交到 ComfyUI，后台生成中（顶栏可看进度）…';
    try {
      const payload = {
        card_code: ST.card,
        class_code: ST.cls || '',
        gender: ST.gender,
        prompt: text,
      };
      if (ST.role.kind === 'character') payload.character_id = ST.role.id;
      const r = await Admin.post('/cardgame/art/generate', payload);
      const jobId = r.job_id;
      const timer = setInterval(async () => {
        let job = null;
        try { job = await Admin.get('/jobs/' + jobId); } catch (_) { return; }
        if (!job) return;
        if (job.status === 'running' || job.status === 'queued') {
          $('ca-status').textContent = `生成中… ${job.message || ''}`;
          return;
        }
        clearInterval(timer);
        if (btn) btn.disabled = false;
        if (job.status === 'error') {
          $('ca-status').textContent = '失败：' + (job.message || '未知原因');
          Admin.toast('出图失败：' + (job.message || ''), 'error');
          return;
        }
        $('ca-status').textContent = '已出图，可到「卡牌系统 → 卡面生产」查看与启用';
        Admin.toast('卡面已生成', 'success');
        await loadAll(true);
      }, 2500);
    } catch (err) {
      if (btn) btn.disabled = false;
      $('ca-status').textContent = '提交失败：' + err.message;
      Admin.toast('提交失败：' + err.message, 'error');
    }
  }

  // ====================================================================
  // Tab2：卡牌提示词（全量可查可改）
  // ====================================================================
  const PF = { cls: 'all', q: '' };

  function renderPrompts() {
    const body = $('apx-body');
    if (!body) return;
    const clsName = (code) => (ST.roles.classes.find((c) => c.code === code) || {}).name || '通用';
    const list = ST.cards.filter((c) => {
      if (PF.cls !== 'all' && c.class_code !== PF.cls) return false;
      if (PF.q) {
        const t = (c.name + c.code + (c.art_action || '') + (c.art_expression || '') + (c.art_extra || '')).toLowerCase();
        if (!t.includes(PF.q.toLowerCase())) return false;
      }
      return true;
    });

    body.innerHTML = `
      <div class="apx-bar">
        <span class="apx-stat">共 <b>${ST.cards.length}</b> 张卡，当前筛选 <b>${list.length}</b></span>
        <select class="apx-sel" id="apx-pf-cls">
          <option value="all">全部职业</option>
          <option value="universal">通用</option>
          ${ST.roles.classes.map((c) => `<option value="${esc(c.code)}" ${PF.cls === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <input class="apx-inp" id="apx-pf-q" placeholder="搜索卡名 / 动作 / 表情 / 附加" value="${esc(PF.q)}" style="width:260px;min-width:0">
        <div style="flex:1"></div>
        <button class="apx-btn primary" id="apx-pf-save">💾 保存所有改动</button>
      </div>
      <div class="apx-hintbar">
        这里就是<b>卡牌系统里能影响卡面提示词的全部文字</b>：动作 / 表情 / 附加。
        右侧三列直接改、点「保存所有改动」一次性落库；改完「卡面生产」和「情感与表现」出图立刻用新词。
      </div>
      <div class="apx-tablewrap">
        <table class="apx-table">
          <thead>
            <tr>
              <th style="width:180px">卡牌</th>
              <th style="width:90px">职业</th>
              <th style="width:70px">分类</th>
              <th>动作 art_action</th>
              <th>表情 art_expression</th>
              <th>附加 art_extra</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((c) => `
              <tr data-card="${esc(c.code)}">
                <td><b>${esc(c.name)}</b><br><small style="color:var(--text-muted)">${esc(c.code)}</small></td>
                <td>${esc(clsName(c.class_code))}</td>
                <td>${esc(c.category_label || c.category || '')}</td>
                <td><input class="apx-inp" data-pf="art_action" value="${esc(c.art_action || '')}"></td>
                <td><input class="apx-inp" data-pf="art_expression" value="${esc(c.art_expression || '')}"></td>
                <td><input class="apx-inp" data-pf="art_extra" value="${esc(c.art_extra || '')}"></td>
              </tr>`).join('') || '<tr><td colspan="6"><div class="table-empty">没有匹配的卡牌</div></td></tr>'}
          </tbody>
        </table>
      </div>`;

    $('apx-pf-cls').addEventListener('change', (e) => { PF.cls = e.target.value; renderPrompts(); });
    $('apx-pf-q').addEventListener('input', (e) => {
      PF.q = e.target.value;
      clearTimeout(PF._t);
      PF._t = setTimeout(renderPrompts, 220);
    });
    $('apx-pf-save').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '保存中…';
      let ok = 0, fail = 0;
      const rows = body.querySelectorAll('tr[data-card]');
      for (const tr of rows) {
        const code = tr.dataset.card;
        const val = (k) => {
          const n = tr.querySelector(`[data-pf="${k}"]`);
          return n ? n.value : '';
        };
        try {
          await Admin.put('/cardgame/cards/' + encodeURIComponent(code), {
            art_action: val('art_action'),
            art_expression: val('art_expression'),
            art_extra: val('art_extra'),
          });
          ok++;
        } catch (_) { fail++; }
      }
      b.disabled = false;
      b.textContent = '💾 保存所有改动';
      Admin.toast(`已保存 ${ok} 张${fail ? `，${fail} 张失败` : ''}`, fail ? 'error' : 'success');
      await loadAll(true);
    });
  }

  // ====================================================================
  // Tab3：定义管理（分组 / 维度 / 选项 / 题材 —— 与人物外观拼装共用同一套）
  // ====================================================================
  let activeDim = '';

  function renderManage() {
    const body = $('apx-body');
    if (!body) return;
    body.innerHTML = `
      <div class="apx-hintbar">
        <b>定义管理</b>：分组 / 维度 / 选项 / 题材在这里增删改，与「人物外观拼装」<b>共用同一套定义</b>。
        新增一个维度 = 所有角色外观里多出一个可自由改写的参数；新增选项 = 下拉里多一个可选项。
        改动立即写盘，两侧页面同时生效。
      </div>
      <div class="ap-toolbar" style="margin-bottom:10px">
        <button class="ap-btn" id="cx-mg-reset">恢复默认定义</button>
        <span class="ap-hint">恢复出厂会把自定义的分组 / 维度 / 选项 / 题材覆盖（已保存的外观数据不受影响）。</span>
      </div>
      <div class="ap-split">
        <div class="ap-side">
          <div class="ap-side-head">分组 / 维度 <button class="ap-btn xs" id="cx-dim-add">＋</button></div>
          <div id="cx-dim-tree" class="ap-list"></div>
        </div>
        <div class="ap-main" id="cx-dim-editor">
          <div class="ap-hint" style="padding:16px">左侧选一个维度开始编辑</div>
        </div>
      </div>
      <div style="margin-top:14px">
        <div class="ap-side-head">题材（定向随机包） <button class="ap-btn xs" id="cx-theme-add">＋ 新增题材</button></div>
        <div id="cx-theme-list" class="ap-themes"></div>
      </div>`;

    $('cx-mg-reset').addEventListener('click', async () => {
      if (!await Admin.confirm('恢复出厂定义？自定义的分组/维度/选项/题材都会被覆盖（人物与卡牌角色外观数据不受影响）。')) return;
      await Admin.post('/appearance/manage/reset', {});
      await renderManage();
      Admin.toast('已恢复默认定义', 'success');
    });
    $('cx-dim-add').addEventListener('click', addDim);
    $('cx-theme-add').addEventListener('click', addTheme);
    loadManage();
  }

  async function loadManage() {
    const defs = await Admin.get('/appearance/defs?include_sensitive=1');
    const themes = await Admin.get('/appearance/themes');
    ST._defs = defs;
    ST._themes = themes;
    renderDimTree();
    if (activeDim) renderDimEditor(activeDim);
    renderThemes();
  }

  function renderDimTree() {
    const defs = ST._defs;
    $('cx-dim-tree').innerHTML = defs.groups.map(g => `
      <div class="ap-group">
        <div class="ap-group-h">${esc(g.icon || '')} ${esc(g.name)}
          <span class="ap-item-ops">
            <button data-gedit="${esc(g.id)}" title="改名">✎</button>
            <button data-gdel="${esc(g.id)}" title="删除分组">✕</button>
          </span>
        </div>
        ${g.dims.map(d => `
          <div class="ap-item${activeDim === d.id ? ' on' : ''}" data-dim="${esc(d.id)}">
            <span class="ap-item-t">${esc(d.name)}${d.sensitive ? ' <em>R18</em>' : ''}</span>
            <span class="ap-item-n">${d.options.length}</span>
          </div>`).join('')}
      </div>`).join('');

    $('cx-dim-tree').querySelectorAll('[data-dim]').forEach(el => {
      el.addEventListener('click', () => { activeDim = el.dataset.dim; renderDimTree(); renderDimEditor(activeDim); });
    });
    $('cx-dim-tree').querySelectorAll('[data-gedit]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const g = ST._defs.groups.find(x => x.id === b.dataset.gedit);
        const d = await prompt2('重命名分组', [
          { name: 'name', label: '分组名', value: g?.name || '' },
          { name: 'icon', label: '图标（emoji）', value: g?.icon || '' },
        ]);
        if (!d || !d.name) return;
        await Admin.put(`/appearance/manage/groups/${b.dataset.gedit}`, { name: d.name, icon: d.icon });
        await loadManage();
      });
    });
    $('cx-dim-tree').querySelectorAll('[data-gdel]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await Admin.confirm('删除分组会连带删除该分组下所有维度，确定？')) return;
        await Admin.del(`/appearance/manage/groups/${b.dataset.gdel}`);
        await loadManage();
      });
    });
  }

  function renderDimEditor(dimId) {
    const defs = ST._defs;
    const g = defs.groups.find(x => x.dims.some(d => d.id === dimId));
    const d = g?.dims.find(x => x.id === dimId);
    if (!d) { $('cx-dim-editor').innerHTML = '<div class="ap-hint" style="padding:16px">维度不存在</div>'; return; }

    $('cx-dim-editor').innerHTML = `
      <div class="ap-side-head">
        <span>维度：${esc(d.name)} <span class="ap-hint">(${esc(d.id)})</span></span>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="ap-btn xs" id="cx-opt-add">＋ 新增选项</button>
          <button class="ap-btn xs" id="cx-dim-del">删除维度</button>
        </span>
      </div>
      <div class="ap-form-row">
        <label class="ap-field"><span>显示名</span><input id="cx-dim-name" class="ap-inp" value="${esc(d.name)}"></label>
        <label class="ap-field"><span>所属分组</span>
          <select id="cx-dim-group" class="ap-sel">
            ${defs.groups.map(x => `<option value="${esc(x.id)}"${x.id === g.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select></label>
        <label class="ap-field"><span>成人维度</span>
          <select id="cx-dim-sens" class="ap-sel">
            <option value="0"${d.sensitive ? '' : ' selected'}>否</option>
            <option value="1"${d.sensitive ? ' selected' : ''}>是</option>
          </select></label>
        <label class="ap-field"><span>颜色维度</span>
          <select id="cx-dim-color" class="ap-sel">
            <option value="0"${d.is_color ? '' : ' selected'}>否</option>
            <option value="1"${d.is_color ? ' selected' : ''}>是</option>
          </select></label>
        <button class="ap-btn" id="cx-dim-save">保存维度</button>
      </div>
      <div class="ap-field" style="margin:6px 0">
        <span>显示条件 cond（JSON，可空）—— 例：{"gender":"female","not_band":["toddler","child"],"requires":{"nudity":["none"]}}</span>
        <textarea id="cx-dim-cond" class="ap-ta">${esc(JSON.stringify(d.cond || null))}</textarea>
      </div>
      <div class="ap-opt-head">选项（${d.options.length}）</div>
      <div class="ap-opts">
        ${d.options.map(o => `
          <div class="ap-opt" data-oid="${esc(o.id)}">
            <input class="ap-inp ap-opt-name" data-f="name" value="${esc(o.name)}" title="显示名">
            <input class="ap-inp ap-opt-cn" data-f="cn" value="${esc(o.cn || '')}" placeholder="提示词文本（留空则用显示名）">
            <input class="ap-inp ap-opt-tags" data-f="tags" value="${esc((o.tags || []).join(','))}" placeholder="tags">
            <input class="ap-inp ap-opt-cat" data-f="cat" value="${esc(o.cat || '')}" placeholder="分类" style="width:72px">
            <button class="ap-btn xs" data-osave="${esc(o.id)}">存</button>
            <button class="ap-btn xs" data-omove="${esc(o.id)}">↑</button>
            <button class="ap-btn xs" data-odel="${esc(o.id)}">✕</button>
          </div>`).join('') || '<div class="ap-empty">该维度还没有选项</div>'}
      </div>
    `;

    $('cx-dim-save').addEventListener('click', async () => {
      let cond = null;
      const raw = $('cx-dim-cond').value.trim();
      if (raw && raw !== 'null') {
        try { cond = JSON.parse(raw); }
        catch { Admin.toast('cond 不是合法 JSON', 'error'); return; }
      }
      try {
        await Admin.put(`/appearance/manage/dims/${dimId}`, {
          name: $('cx-dim-name').value,
          group: $('cx-dim-group').value,
          sensitive: $('cx-dim-sens').value === '1',
          is_color: $('cx-dim-color').value === '1',
          cond,
        });
        await loadManage();
        Admin.toast('维度已保存', 'success');
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    });

    $('cx-dim-del').addEventListener('click', async () => {
      if (!await Admin.confirm('删除该维度？已保存的人物/卡牌角色外观里该键会被忽略。')) return;
      await Admin.del(`/appearance/manage/dims/${dimId}`);
      activeDim = '';
      await loadManage();
    });

    $('cx-opt-add').addEventListener('click', async () => {
      const d2 = await prompt2('新增选项', [
        { name: 'id', label: '选项 id（英文/数字，唯一）', value: '' },
        { name: 'name', label: '显示名', value: '' },
        { name: 'cn', label: '提示词文本（可空）', type: 'textarea', value: '' },
        { name: 'tags', label: 'tags（逗号分隔）', value: '' },
        { name: 'cat', label: '分类（动作维度用）', value: '' },
      ]);
      if (!d2 || !d2.name) return;
      try {
        await Admin.post(`/appearance/manage/dims/${dimId}/options`, {
          id: d2.id || null, name: d2.name, cn: d2.cn || '',
          tags: (d2.tags || '').split(',').map(s => s.trim()).filter(Boolean),
          cat: d2.cat || '',
        });
        await loadManage();
        Admin.toast('已新增', 'success');
      } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
    });

    $('cx-dim-editor').querySelectorAll('[data-osave]').forEach(b => {
      b.addEventListener('click', async () => {
        const row = b.closest('.ap-opt');
        const val = (f) => row.querySelector(`[data-f="${f}"]`).value;
        try {
          await Admin.put(`/appearance/manage/dims/${dimId}/options/${b.dataset.osave}`, {
            name: val('name'),
            cn: val('cn'),
            tags: val('tags').split(',').map(s => s.trim()).filter(Boolean),
            cat: val('cat'),
          });
          Admin.toast('已保存选项', 'success');
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      });
    });
    $('cx-dim-editor').querySelectorAll('[data-omove]').forEach(b => {
      b.addEventListener('click', async () => {
        await Admin.post(`/appearance/manage/dims/${dimId}/options/${b.dataset.omove}/move`, { delta: -1 });
        await loadManage();
      });
    });
    $('cx-dim-editor').querySelectorAll('[data-odel]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!await Admin.confirm('删除该选项？')) return;
        await Admin.del(`/appearance/manage/dims/${dimId}/options/${b.dataset.odel}`);
        await loadManage();
      });
    });
  }

  function renderThemes() {
    $('cx-theme-list').innerHTML = (ST._themes || []).map(t => `
      <div class="ap-theme">
        <div class="ap-theme-h"><b>${esc(t.name)}</b>
          <span class="ap-chip">${esc(t.id)}</span>
          ${t.nationality ? `<span class="ap-chip">${esc(t.nationality)}</span>` : ''}
          <span class="ap-pose-ops"><button data-tedit="${esc(t.id)}">编辑</button></span>
        </div>
        <div class="ap-pose-cn">${esc(t.desc || t.cn || '')}</div>
        <div class="ap-hint">收敛维度：${esc((t.pool_dims || []).join('、') || '无')}</div>
      </div>`).join('') || '<div class="ap-empty">还没有题材</div>';

    $('cx-theme-list').querySelectorAll('[data-tedit]').forEach(b => {
      b.addEventListener('click', () => editTheme(b.dataset.tedit));
    });
  }

  async function editTheme(themeId) {
    const raw = await Admin.get('/appearance/manage/raw');
    const t = (raw.themes || []).find(x => x.id === themeId) || {};
    const d = await prompt2('编辑题材', [
      { name: 'name', label: '题材名', value: t.name || '' },
      { name: 'desc', label: '说明', value: t.desc || '' },
      { name: 'cn', label: '备注（不拼进提示词，仅供后台查看）', type: 'textarea', value: t.cn || '' },
      { name: 'nationality', label: '默认国族 id', value: t.nationality || '' },
      { name: 'tags', label: 'tags（逗号分隔）', value: (t.tags || []).join(',') },
      { name: 'colors', label: '色板（逗号分隔，可空）', value: (t.colors || []).join(',') },
      { name: 'pools', label: '收敛池 pools（JSON：{"top":["id1"],"shoes":["id2"]}）', type: 'textarea', value: JSON.stringify(t.pools || {}, null, 1) },
    ]);
    if (!d || !d.name) return;
    let pools = {};
    try { pools = d.pools ? JSON.parse(d.pools) : {}; }
    catch { Admin.toast('pools 不是合法 JSON', 'error'); return; }
    try {
      await Admin.put(`/appearance/manage/themes/${themeId}`, {
        name: d.name, desc: d.desc, cn: d.cn, nationality: d.nationality,
        tags: (d.tags || '').split(',').map(s => s.trim()).filter(Boolean),
        colors: (d.colors || '').split(',').map(s => s.trim()).filter(Boolean),
        pools,
      });
      ST._themes = await Admin.get('/appearance/themes');
      renderThemes();
      Admin.toast('题材已保存', 'success');
    } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
  }

  async function addTheme() {
    const d = await prompt2('新增题材', [
      { name: 'id', label: '题材 id（英文，唯一）', value: '' },
      { name: 'name', label: '题材名', value: '' },
      { name: 'cn', label: '备注（不拼进提示词，仅供后台查看）', type: 'textarea', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/appearance/manage/themes', { id: d.id || null, name: d.name, cn: d.cn, desc: '' });
      ST._themes = await Admin.get('/appearance/themes');
      renderThemes();
      Admin.toast('已新增题材', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  }

  async function addDim() {
    const d = await prompt2('新增维度', [
      { name: 'id', label: '维度 id（英文，唯一）', value: '' },
      { name: 'name', label: '显示名', value: '' },
      { name: 'group', label: `所属分组 id（${(ST._defs?.groups || []).map(g => g.id).join(' / ')}）`, value: ST._defs?.groups[0]?.id || 'meta' },
      { name: 'sensitive', label: '成人维度（1/0）', value: '0' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/appearance/manage/dims', {
        id: d.id || null, name: d.name, group: d.group,
        sensitive: d.sensitive === '1', is_color: false, cond: null,
      });
      await loadManage();
      Admin.toast('已新增维度，记得去加选项', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  }

  // 通用输入弹窗（与人物外观拼装页一致）
  function prompt2(title, fields) {
    return new Promise((resolve) => {
      const body = fields.map(f => `
        <div style="margin-bottom:8px">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">${esc(f.label)}</label>
          ${f.type === 'textarea'
            ? `<textarea name="${f.name}" style="width:100%;min-height:70px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);padding:6px;font-size:12px">${esc(f.value || '')}</textarea>`
            : `<input name="${f.name}" value="${esc(f.value || '')}" style="width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);padding:6px;font-size:12px">`}
        </div>`).join('');
      Admin.showModal(title, body, () => {
        const data = {};
        document.querySelectorAll('.modal-body [name]').forEach(el => { data[el.name] = el.value; });
        Admin.closeModal();
        resolve(data);
      });
    });
  }

  // ---------------- 初始化 ----------------
  try {
    await Promise.all([loadAll(), loadRoles()]);
    if (!currentRole()) {
      ST.role = { kind: 'class', id: (ST.roles.classes[0] || {}).code || '' };
      try { localStorage.setItem('ca_role', roleVal(ST.role)); } catch (_) {}
    }
    await applyRole();
    renderPane();
  } catch (e) {
    $('apx-body').innerHTML = `<div class="table-empty">初始化失败：${esc(e.message)}</div>`;
  }

  // ---------------- 样式 ----------------
  function ensureStyle() {
    if (document.getElementById('apx-style-tag')) return;
    const s = document.createElement('style');
    s.id = 'apx-style-tag';
    s.textContent = `
      .apx-wrap{padding:12px 16px;max-width:1560px;margin:0 auto}
      .apx-tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border)}
      .apx-tab{background:none;border:none;color:var(--text-muted);padding:7px 16px;cursor:pointer;
        font-size:13px;border-bottom:2px solid transparent}
      .apx-tab.on{color:var(--gold);border-bottom-color:var(--gold)}
      .apx-loading{padding:40px;text-align:center;color:var(--text-muted)}
      .apx-bar{display:flex;flex-wrap:wrap;gap:9px;align-items:flex-end;margin-bottom:10px}
      .apx-field{display:flex;flex-direction:column;gap:3px;min-width:0}
      .apx-field>span{font-size:11px;color:var(--text-muted)}
      .apx-sel,.apx-inp,.apx-ta{background:var(--bg-input);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:12.5px;padding:4px 7px;height:30px;box-sizing:border-box;font-family:inherit}
      .apx-sel:focus,.apx-inp:focus,.apx-ta:focus{outline:1px solid var(--gold)}
      .apx-ta{height:auto;width:100%;resize:vertical;line-height:1.6;font-size:12.5px}
      .apx-inp{width:100%}
      .apx-btn{font-size:12px;padding:6px 12px;border-radius:4px;border:1px solid var(--border);
        background:transparent;color:var(--text-primary);cursor:pointer;white-space:nowrap;font-family:inherit}
      .apx-btn:hover{border-color:var(--gold);color:var(--gold)}
      .apx-btn.primary{background:var(--gold);border-color:var(--gold);color:#000;font-weight:600}
      .apx-btn.primary:hover{filter:brightness(1.1);color:#000}
      .apx-btn.xs{font-size:11px;padding:3px 8px}
      .apx-hint{font-size:11px;color:var(--text-muted)}
      .apx-stat{font-size:12px;color:var(--text-secondary)}
      .apx-stat b{color:var(--gold)}
      .apx-hintbar{font-size:12px;line-height:1.9;color:var(--text-secondary);
        background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.2);
        border-left:2px solid var(--gold);padding:9px 13px;margin-bottom:12px}
      .apx-hintbar b{color:var(--gold)}
      .apx-hintbar code{background:rgba(255,255,255,.07);padding:1px 5px;border-radius:3px;color:#e6d5a6;font-size:11.5px}
      .apx-tablewrap{border:1px solid var(--border);border-radius:6px;overflow:auto;max-height:calc(100vh - 300px)}
      .apx-table{width:100%;border-collapse:collapse;font-size:12px}
      .apx-table th{position:sticky;top:0;z-index:1;background:#1a1a1e;text-align:left;
        padding:7px 9px;font-weight:600;color:var(--gold);border-bottom:1px solid var(--border);white-space:nowrap}
      .apx-table td{padding:5px 9px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle}
      .apx-table tr:hover td{background:rgba(255,255,255,.025)}
      .cx-params{border:1px solid var(--border);border-radius:6px;background:var(--bg-input);margin-bottom:12px;overflow:hidden}
      .cx-params-h{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12.5px;font-weight:600;
        color:var(--gold);background:rgba(201,168,76,.10)}
      .cx-params-h .apx-hint{margin-left:auto;font-weight:400}
      .cx-params-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:9px 10px}
      @media(max-width:1100px){.cx-params-grid{grid-template-columns:1fr 1fr}}
      @media(max-width:760px){.cx-params-grid{grid-template-columns:1fr}}
      .cx-params-en{padding:0 10px 9px}
      .cx-f{display:flex;flex-direction:column;gap:3px;min-width:0}
      .cx-f>span{font-size:11px;color:var(--text-muted)}
      .cx-cardf{border:1px solid var(--border);border-radius:6px;background:var(--bg-input);margin-bottom:12px;overflow:hidden}
      .cx-cardf-h{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12.5px;font-weight:600;
        color:var(--gold);background:rgba(201,168,76,.10)}
      .cx-cardf-h .apx-hint{margin-left:auto;font-weight:400}
      .cx-cardf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:9px 10px 4px}
      @media(max-width:900px){.cx-cardf-grid{grid-template-columns:1fr}}
      .cx-cardf .apx-note{padding:0 10px 9px}
      .cx-editor{margin-top:2px}
      /* 外观工具栏（题材 / 职业 / 动作等） */
      .ap-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:10px}
      .ap-field{display:flex;flex-direction:column;gap:2px}
      .ap-field>span{font-size:10px;color:var(--text-muted)}
      .ap-sel,.ap-inp,.ap-ta{background:var(--bg-input);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:12px;padding:3px 6px;height:26px;font-family:inherit}
      .ap-ta{height:auto;min-height:52px;width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}
      .ap-btn{font-size:12px;padding:4px 11px;border-radius:4px;border:1px solid var(--border);
        background:transparent;color:var(--text-primary);cursor:pointer;white-space:nowrap;font-family:inherit}
      .ap-btn:hover{border-color:var(--gold);color:var(--gold)}
      .ap-btn.primary{background:var(--gold);border-color:var(--gold);color:#000}
      .ap-btn.xs{font-size:11px;padding:2px 7px}
      .ap-hint{font-size:11px;color:var(--text-muted)}
      .ap-split{display:grid;grid-template-columns:250px 1fr;gap:12px;align-items:start}
      @media(max-width:980px){.ap-split{grid-template-columns:1fr}}
      .ap-side,.ap-main{border:1px solid var(--border);border-radius:6px;background:var(--bg-input);overflow:hidden}
      .ap-side-head{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:12px;font-weight:600;
        color:var(--gold);background:rgba(201,168,76,.10)}
      .ap-list{max-height:520px;overflow:auto;padding:4px}
      .ap-group{margin-bottom:6px}
      .ap-group-h{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);
        padding:3px 6px;border-bottom:1px dashed var(--border)}
      .ap-item{display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;
        font-size:12px;cursor:pointer;color:var(--text-primary)}
      .ap-item:hover{background:rgba(255,255,255,.05)}
      .ap-item.on{background:rgba(201,168,76,.16);color:var(--gold)}
      .ap-item-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ap-item-t em{font-style:normal;font-size:9px;color:var(--red);margin-left:3px}
      .ap-item-n{font-size:10px;color:var(--text-muted)}
      .ap-item-ops,.ap-pose-ops{display:none;gap:2px}
      .ap-item:hover .ap-item-ops,.ap-pose:hover .ap-pose-ops{display:flex}
      .ap-item-ops button,.ap-pose-ops button{background:none;border:none;color:var(--text-muted);
        cursor:pointer;font-size:11px;padding:0 3px}
      .ap-item-ops button:hover,.ap-pose-ops button:hover{color:var(--gold)}
      .ap-pose-cn{font-size:11px;color:var(--text-muted);margin-top:3px;line-height:1.45;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .ap-chip{font-size:9px;border:1px solid var(--border);border-radius:8px;padding:0 6px;color:var(--text-muted)}
      .ap-empty{padding:16px;text-align:center;font-size:12px;color:var(--text-muted)}
      .ap-form-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:8px}
      .ap-opt-head{padding:2px 10px 4px;font-size:11px;color:var(--text-muted)}
      .ap-opts{max-height:340px;overflow:auto;padding:0 8px 8px;display:flex;flex-direction:column;gap:3px}
      .ap-opt{display:flex;gap:4px;align-items:center}
      .ap-opt .ap-opt-name{width:130px}
      .ap-opt .ap-opt-cn{flex:1;min-width:0}
      .ap-opt .ap-opt-tags{width:96px}
      .ap-themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px;padding:6px}
      .ap-theme{border:1px solid var(--border);border-radius:5px;padding:6px 9px;background:var(--bg-input)}
      .ap-theme-h{display:flex;align-items:center;gap:6px;font-size:12px}
      .ap-theme-h .ap-pose-ops{margin-left:auto}
    `;
    document.head.appendChild(s);
  }
});
