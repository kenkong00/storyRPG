// ========== 人物管理模块（网格/列表 + 图片 + 多选） ==========
Admin.registerPage('characters', async (container) => {
  const TYPE_MAP = { player: '玩家', npc: 'NPC', enemy: '敌人', ally: '盟友' };
  // 9 个装备槽位中文标签（与前后台一致）
  const SLOT_LABELS = { weapon: '武器', head: '头部', shoulders: '肩部', chest: '胸甲', gloves: '手套', pants: '腿部', boots: '足部', artifact: '法宝', skill: '技能书', set: '套装', accessory: '配饰' };
  let chars = [], viewMode = 'grid', selectedIds = new Set();
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;
  let allItemsCache = []; // 全部数据，用于分类计数
  let _runtimeChars = []; // 前台玩家运行时角色（user_characters），用于「看前台关联」

  async function load() {
    allItemsCache = await Admin.get('/characters');
    // 一并拉取前台玩家运行时角色，让后台也能看到/管理前台实际装备
    try {
      _runtimeChars = await Admin.get('/admin/user-characters');
    } catch (e) {
      console.warn('加载前台玩家角色失败', e);
      _runtimeChars = [];
    }
    applyClientFilter();
  }

  function applyClientFilter() {
    if (currentCategory) {
      chars = allItemsCache.filter(c => c.category_path === currentCategory);
    } else {
      chars = allItemsCache.filter(c => !c.category_path);
    }
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    if (!path) return allItemsCache.filter(c => !c.category_path).length;
    return allItemsCache.filter(c => c.category_path === path).length;
  }

  // 初始化整体布局（只执行一次，分类栏容器保持稳定）
  // ======================= 语音配置面板 =======================
  // 音色清单缓存在模块级：表单是反复打开的，每次都去拉一遍接口既慢，
  // 更糟的是万一用户比列表先点「保存」，下拉里还是空的，已配好的音色会被写成空值。
  let _ttsVoiceGroups = null;

  async function ensureTtsVoices(force = false) {
    if (_ttsVoiceGroups && !force) return _ttsVoiceGroups;
    try {
      const res = await Admin.get('/tts/voices?grouped=true');
      _ttsVoiceGroups = res.groups || [];
    } catch (e) {
      console.warn('[characters] 音色列表加载失败', e);
      _ttsVoiceGroups = [];
    }
    return _ttsVoiceGroups;
  }

  const VOICE_GROUP_LABEL = {
    standard: '普通话通用',
    dialect: '方言乡音',
    regional: '地区口音（粤语 / 台普）',
    multilingual: '多语言（读中文，建议试听）',
    role: '角色声线（派生）',
  };
  const VOICE_AGE_LABEL = { child: '童声', adult: '', elder: '老年' };

  /**
   * 把某个引擎的音色渲染成 optgroup。
   *
   * 分组维度刻意选了「来源」而不是「性别」：26 个音色如果只按男女分两组，
   * 每组十几个还是没法选；按来源分（普通话 / 方言 / 地区口音 / 角色声线）
   * 更符合选角时的思路 —— 先想要什么味道，再在这一组里挑男女。
   * 性别和年龄则写进每个选项的文本里，一眼可辨。
   */
  function buildVoiceOptions(groups, engineId, currentValue) {
    const g = groups.find(x => x.id === engineId);
    if (!g || !g.voices || !g.voices.length) {
      // 列表还没到也别把已存的值弄丢
      return currentValue ? `<option value="${esc(currentValue)}">${esc(currentValue)}（当前配置）</option>` : '';
    }
    const genderIcon = v => (v.gender === 'male' ? '男' : v.gender === 'female' ? '女' : '?');
    const order = ['standard', 'dialect', 'regional', 'multilingual', 'role'];
    const rest = [...new Set(g.voices.map(v => v.group || 'standard'))].filter(x => !order.includes(x));
    let html = '';
    order.concat(rest).forEach(groupKey => {
      const list = g.voices.filter(v => (v.group || 'standard') === groupKey);
      if (!list.length) return;
      html += `<optgroup label="${VOICE_GROUP_LABEL[groupKey] || groupKey}">`;
      list.forEach(v => {
        const age = VOICE_AGE_LABEL[v.age] || '';
        const name = [
          genderIcon(v),
          v.name,
          v.style ? `·${v.style}` : '',
          age ? `[${age}]` : '',
        ].filter(Boolean).join(' ');
        const sel = v.voice_id === currentValue ? ' selected' : '';
        html += `<option value="${esc(v.voice_id)}"${sel}>${esc(name)}</option>`;
      });
      html += '</optgroup>';
    });
    // 配了列表里没有的音色（比如换了引擎），也要保留，避免静默丢失
    if (currentValue && !g.voices.some(v => v.voice_id === currentValue)) {
      html = `<option value="${esc(currentValue)}">${esc(currentValue)}（当前配置）</option>` + html;
    }
    return html;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function updateVoiceHint(gender, voiceSel, engineSel, hint) {
    if (!hint) return;
    const cur = voiceSel && voiceSel.value;
    if (!gender || gender === 'unknown' || !cur) {
      hint.textContent = '';
      hint.style.color = 'var(--text-muted)';
      return;
    }
    const g = (_ttsVoiceGroups || []).find(x => x.id === (engineSel && engineSel.value));
    const v = g && (g.voices || []).find(x => x.voice_id === cur);
    if (!v) { hint.textContent = ''; return; }
    const gTxt = v.gender === 'male' ? '男' : v.gender === 'female' ? '女' : '未知';
    const ageTxt = { child: '童声', elder: '老年', adult: '' }[v.age] || '';
    const head = `已选：${v.name}（${gTxt}声${ageTxt ? '·' + ageTxt : ''}·${v.style || '默认'}）`;
    // 派生声线自带 rate/pitch 偏移，而下面的滑杆只显示角色自己的值（初始 0）。
    // 不把偏移量说清楚，用户会以为「滑杆是 0 怎么会变慢」。
    const dRate = Number(v.rate) || 0;
    const dPitch = Number(v.pitch) || 0;
    const delta = (dRate || dPitch)
      ? `；合成时会在此基础音色上自动叠加语速 ${dRate >= 0 ? '+' : ''}${dRate}%、音调 ${dPitch >= 0 ? '+' : ''}${dPitch}（滑杆是在此之上的微调）`
      : '';
    if (v.gender === gender) {
      hint.textContent = `${head}${v.note ? ' — ' + v.note : ''}${delta}`;
      hint.style.color = 'var(--text-muted)';
    } else {
      hint.textContent = `注意：这个角色性别设为「${gender === 'male' ? '男' : '女'}」，但音色是「${v.name}（${gTxt}声）」，会显得不搭。`;
      hint.style.color = 'var(--danger, #e06c56)';
    }
  }

  function initCharacterVoicePanel(data) {
    const genderSel = document.getElementById('char-gender');
    const engineSel = document.getElementById('char-tts-engine');
    const voiceSel = document.getElementById('char-tts-voice');
    const hint = document.getElementById('char-tts-voice-hint');
    const rateEl = document.getElementById('char-tts-rate');
    const pitchEl = document.getElementById('char-tts-pitch');
    const rateVal = document.getElementById('char-rate-val');
    const pitchVal = document.getElementById('char-pitch-val');
    if (!genderSel || !voiceSel) return;

    // 回填已有配置
    genderSel.value = data?.gender || 'unknown';
    engineSel.value = data?.tts_engine || 'edge';
    rateEl.value = data?.tts_rate ?? 0;
    pitchEl.value = data?.tts_pitch ?? 0;
    rateVal.textContent = rateEl.value;
    pitchVal.textContent = pitchEl.value;

    function render() {
      voiceSel.innerHTML = buildVoiceOptions(_ttsVoiceGroups || [], engineSel.value, data?.tts_voice || '');
      updateVoiceHint(genderSel.value, voiceSel, engineSel, hint);
    }

    // 先用缓存同步渲染一遍（没有再异步补），保证「保存」永远拿得到当前值
    if (data?.tts_voice && (!_ttsVoiceGroups || !_ttsVoiceGroups.length)) {
      voiceSel.innerHTML = `<option value="${data.tts_voice}">${data.tts_voice}（当前配置）</option>`;
    }
    ensureTtsVoices().then(render).catch(() => {});
    if (_ttsVoiceGroups && _ttsVoiceGroups.length) render();

    genderSel.addEventListener('change', () => {
      updateVoiceHint(genderSel.value, voiceSel, engineSel, hint);
      // 换了性别就自动挑一个同性别音色，省得用户自己去琢磨哪一个才是男声。
      // 挑的时候避开派生声线（老人/小孩/威严这些是刻意选的口味，不该被自动选中），
      // 只从普通话通用里选一个青壮年音色作为起点。
      const g = (_ttsVoiceGroups || []).find(x => x.id === engineSel.value);
      if (g && genderSel.value !== 'unknown') {
        const pool = (g.voices || []).filter(
          v => v.gender === genderSel.value && !v.derived && (v.group || 'standard') === 'standard');
        const first = pool[0] || (g.voices || []).find(v => v.gender === genderSel.value);
        if (first) voiceSel.value = first.voice_id;
      }
      updateVoiceHint(genderSel.value, voiceSel, engineSel, hint);
    });

    engineSel.addEventListener('change', render);
    voiceSel.addEventListener('change', () => updateVoiceHint(genderSel.value, voiceSel, engineSel, hint));
    rateEl.addEventListener('input', () => { rateVal.textContent = rateEl.value; });
    pitchEl.addEventListener('input', () => { pitchVal.textContent = pitchEl.value; });

    // 试听
    const btn = document.getElementById('btn-tts-preview');
    if (btn) {
      btn.addEventListener('click', async () => {
        const text = (document.getElementById('char-tts-preview-text') || {}).value || '';
        if (!text.trim()) { Admin.toast('请输入试听内容', 'error'); return; }
        const old = btn.textContent;
        btn.textContent = '生成中…';
        btn.disabled = true;
        try {
          const res = await Admin.post('/tts/synth', {
            text,
            engine_id: engineSel.value,
            voice_id: voiceSel.value || null,
            rate: Number(rateEl.value) || 0,
            pitch: Number(pitchEl.value) || 0,
            gender: genderSel.value || 'unknown',
          });
          if (!res || !res.url) throw new Error((res && res.error) || '未返回音频');
          const a = new Audio(res.url);
          a.volume = 0.95;
          await a.play().catch(() => {});
          Admin.toast('试听中…', 'success');
        } catch (e) {
          Admin.toast('试听失败：' + e.message, 'error');
        } finally {
          btn.textContent = old;
          btn.disabled = false;
        }
      });
    }
  }

  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div id="cat-bar-host"></div>
      <div id="chars-toolbar"></div>
      <div id="chars-body"></div>
    `;
    // 挂载分类栏（只挂载一次）
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'character', {
      label: '人物分类',
      totalCount: 0,
      getCount: countInCategory,
      onSelect: (path) => {
        currentCategory = path || '';
        applyClientFilter();
      },
      onTreeChange: () => render(),
    });
  }

  function render() {
    initLayout();
    if (categoryBarInstance) {
      // 同步分类栏的活跃状态和面包屑
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('chars-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${chars.length} 个人物</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="btn-view-grid" title="网格视图">&#9638;</button>
          <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="btn-view-list" title="列表视图">&#9776;</button>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 新建人物</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (chars.length === 0) {
      bodyHtml = '<div class="table-empty">暂无人物</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = '<div class="ch-card-grid">';
      chars.forEach(c => {
        const checked = selectedIds.has(c.id) ? 'checked' : '';
        const isPlayer = c.character_type === 'player';
        const powerSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
          stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>`;
        const imgHtml = c.portrait_image
          ? `<img src="${c.portrait_image}" alt="${esc(c.name)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <span class="ch-noimg" style="display:none">无立绘</span>`
          : `<span class="ch-noimg">无立绘</span>`;
        const powerBtn = isPlayer
          ? `<button type="button" class="ch-icon-btn ${c.is_activated ? 'on' : 'off'}"
               data-act="${c.is_activated ? 'deactivate' : 'activate'}" data-id="${c.id}"
               title="${c.is_activated ? '已激活 · 点击取消激活' : '未激活 · 点击激活'}">${powerSvg}</button>`
          : '';
        bodyHtml += `
          <div class="ch-card" data-id="${c.id}">
            <input type="checkbox" class="ch-check item-checkbox" data-id="${c.id}" ${checked}
              title="多选">
            <div class="ch-card-actions">
              ${powerBtn}
              <button type="button" class="ch-icon-btn ch-del" data-act="del" data-id="${c.id}"
                title="删除这个人物">✕</button>
            </div>
            <div class="ch-card-img">${imgHtml}</div>
            <div class="ch-card-body">
              <div class="ch-card-name" title="${esc(c.name)}">${esc(c.name)}</div>
              <div class="ch-card-sub">
                <span class="tag tag-${c.character_type}">${TYPE_MAP[c.character_type] || c.character_type}</span>
                <span>Lv.${c.level}</span>
                <span style="opacity:.5">·</span>
                <span>境界 ${c.realm_level || 1}</span>
                ${isPlayer ? `<span style="color:${c.is_activated ? 'var(--green)' : 'var(--text-muted)'}">${c.is_activated ? '● 已激活' : '○ 未激活'}</span>` : ''}
              </div>
              <div class="ch-card-line">
                <span class="ch-hp">HP ${c.hp}/${c.max_hp}</span>
                <span class="ch-mp">MP ${c.mp}/${c.max_mp}</span>
              </div>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th style="width:60px">立绘</th><th>名称</th><th>类型</th><th>等级</th><th>HP/MP</th><th>称号</th><th>激活</th><th style="width:150px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';
      chars.forEach(c => {
        const checked = selectedIds.has(c.id) ? 'checked' : '';
        const imgHtml = c.portrait_image
          ? `<img src="${c.portrait_image}" style="width:48px;height:48px;object-fit:cover;border-radius:4px">`
          : `<div style="width:48px;height:48px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">无</div>`;
        // 激活状态（仅 player 类型显示）
        let activateCell = '<span style="color:var(--text-muted)">-</span>';
        if (c.character_type === 'player') {
          if (c.is_activated) {
            activateCell = '<span class="tag tag-ally" style="color:var(--green)">已激活</span>';
          } else {
            activateCell = '<span class="tag" style="color:var(--text-muted)">未激活</span>';
          }
        }
        // 激活按钮（仅 player 类型）
        let activateBtn = '';
        if (c.character_type === 'player') {
          activateBtn = c.is_activated
            ? `<button class="btn-edit btn-deactivate" data-id="${c.id}" style="color:var(--red)">取消激活</button>`
            : `<button class="btn-edit btn-activate" data-id="${c.id}" style="color:var(--green)">激活</button>`;
        }
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-id="${c.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${imgHtml}</td>
            <td>${c.name}</td>
            <td><span class="tag tag-${c.character_type}">${TYPE_MAP[c.character_type] || c.character_type}</span></td>
            <td>Lv.${c.level}</td>
            <td>${c.hp}/${c.max_hp}</td>
            <td>${c.title || '-'}</td>
            <td>${activateCell}</td>
            <td>
              <div class="action-btns">
                ${activateBtn}
                <button class="btn-edit" data-id="${c.id}">编辑</button>
                <button class="btn-del" data-id="${c.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    const bodyEl = document.getElementById('chars-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml + renderRuntimeSection();
    bindEvents();
  }

  function renderRuntimeSection() {
    if (!_runtimeChars || !_runtimeChars.length) return '';
    const rows = _runtimeChars.map(uc => `
      <tr>
        <td>${uc.id}</td>
        <td>${uc.custom_name || ('角色' + uc.id)}</td>
        <td>Lv.${uc.level}</td>
        <td>装备${uc.equip_count}/背包${uc.inventory_count}</td>
        <td><button class="btn-open-runtime btn btn-outline btn-sm" data-uc-id="${uc.id}">打开背包/装备</button></td>
      </tr>`).join('');
    return `<div style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px">
      <div class="cp2-panel-title" style="margin-bottom:6px">前台玩家角色（运行时 · 与模板人物关联）</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">这些角色是前台玩家实际使用的实例（基于上面的模板人物创建）。点「打开」直接进入玩家角色管理页，查看/编辑其真实装备与背包。</div>
      <div class="table-container"><table><thead><tr><th>ID</th><th>名称</th><th>等级</th><th>装备/背包</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  function bindEvents() {
    document.getElementById('btn-view-grid')?.addEventListener('click', () => { viewMode = 'grid'; render(); });
    document.getElementById('btn-view-list')?.addEventListener('click', () => { viewMode = 'list'; render(); });
    document.getElementById('btn-add')?.addEventListener('click', () => showForm());
    document.getElementById('btn-move-selected')?.addEventListener('click', () => batchMoveToCategory());

    // 子分类文件夹卡片点击
    container.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => {
        const path = el.dataset.path || '';
        currentCategory = path;
        if (categoryBarInstance) categoryBarInstance.setPath(path);
        applyClientFilter();
      });
    });

    // 全选
    document.getElementById('select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        chars.forEach(c => selectedIds.add(c.id));
      } else {
        selectedIds.clear();
      }
      render();
    });

    // 复选框
    document.querySelectorAll('.item-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        render();
      });
    });

    // ===== 人物卡片：点卡片进编辑，右上角小图标做激活 / 删除 =====
    container.querySelectorAll('.ch-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-act]') || e.target.classList.contains('ch-check')) return;
        const char = chars.find(c => c.id === parseInt(card.dataset.id));
        if (char) showForm(char);
      });
    });
    container.querySelectorAll('.ch-card .ch-check').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
    container.querySelectorAll('.ch-card [data-act="del"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const confirmed = await Admin.confirm('确定要删除该人物吗？此操作不可恢复。');
        if (!confirmed) return;
        try {
          await Admin.del(`/characters/${id}`);
          selectedIds.delete(id);
          Admin.toast('人物已删除', 'success');
          await load();
        } catch (err) { Admin.toast('删除失败: ' + err.message, 'error'); }
      });
    });
    container.querySelectorAll('.ch-card [data-act="activate"], .ch-card [data-act="deactivate"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const act = btn.dataset.act;
        if (act === 'deactivate' && !await Admin.confirm('取消激活后该玩家角色将不再被前台用户选择，确定？')) return;
        try {
          await Admin.post(`/characters/${id}/${act}`);
          Admin.toast(act === 'activate' ? '已激活，该玩家角色现在可被前台用户选择' : '已取消激活', 'success');
          await load();
        } catch (err) { Admin.toast('操作失败: ' + err.message, 'error'); }
      });
    });

    // 批量删除
    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const confirmed = await Admin.confirm(`确定要删除选中的 ${selectedIds.size} 个人物吗？`);
      if (!confirmed) return;
      let success = 0, fail = 0;
      for (const id of selectedIds) {
        try {
          await Admin.del(`/characters/${id}`);
          success++;
        } catch (e) {
          fail++;
        }
      }
      Admin.toast(`删除完成: ${success} 个成功, ${fail} 个失败`, fail > 0 ? 'error' : 'success');
      await load();
    });

    // 取消选择
    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      selectedIds.clear();
      render();
    });

    // 编辑
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const char = chars.find(c => c.id === parseInt(btn.dataset.id));
        if (char) showForm(char);
      });
    });

    // 打开前台玩家角色（运行时）管理页，直接看到其真实背包/装备
    container.querySelectorAll('.btn-open-runtime').forEach(btn => {
      btn.addEventListener('click', () => {
        window.__adminOpenUC = parseInt(btn.dataset.ucId);
        Admin.navigate('players');
      });
    });

    // 删除
    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const confirmed = await Admin.confirm('确定要删除该人物吗？此操作不可恢复。');
        if (!confirmed) return;
        try {
          await Admin.del(`/characters/${id}`);
          selectedIds.delete(id);
          Admin.toast('人物已删除', 'success');
          await load();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });

    // 激活/取消激活（仅 player 类型）
    document.querySelectorAll('.btn-activate').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        try {
          await Admin.post(`/characters/${id}/activate`);
          Admin.toast('已激活，该玩家角色现在可被前台用户选择', 'success');
          await load();
        } catch (e) { Admin.toast('激活失败: ' + e.message, 'error'); }
      });
    });
    document.querySelectorAll('.btn-deactivate').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (!await Admin.confirm('取消激活后该玩家角色将不再被前台用户选择，确定？')) return;
        try {
          await Admin.post(`/characters/${id}/deactivate`);
          Admin.toast('已取消激活', 'success');
          await load();
        } catch (e) { Admin.toast('操作失败: ' + e.message, 'error'); }
      });
    });
  }

  function batchMoveToCategory() {
    if (selectedIds.size === 0) return;
    const tree = categoryBarInstance ? categoryBarInstance.getTree() : [];
    function buildOpts(nodes, depth) {
      let html = '';
      nodes.forEach(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        html += `<option value="${n.path}">${prefix}${n.name}</option>`;
        if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
      });
      return html;
    }
    const bodyHtml = `
      <div class="form-group">
        <label>目标分类</label>
        <select id="batch-move-cat" name="category_path">
          <option value="">-- 未分类 --</option>
          ${buildOpts(tree, 0)}
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">
          将把选中的 ${selectedIds.size} 个人物移动到该分类
        </span>
      </div>
    `;
    Admin.showModal('批量移动分类', bodyHtml, async () => {
      const newCat = document.getElementById('batch-move-cat')?.value || '';
      let success = 0, fail = 0;
      for (const id of selectedIds) {
        try {
          await Admin.put(`/characters/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  function showForm(data = null, focusOpts = null) {
    const isEdit = !!data;
    // 兼容两种写法：showForm(rec, {tab:'pose'}) 或 showForm(rec, 'pose')
    const wantTab = (typeof focusOpts === 'string' ? focusOpts
      : (focusOpts && focusOpts.tab)) || null;
    const bodyHtml = `
      <div style="display:flex;gap:2px;margin-bottom:14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <button type="button" class="char-tab-btn btn btn-outline btn-sm" data-tab="basic" style="border:none;border-bottom:2px solid var(--accent);border-radius:0;color:var(--accent);background:transparent">基础属性</button>
        <button type="button" class="char-tab-btn btn btn-outline btn-sm" data-tab="appear" style="border:none;border-radius:0;background:transparent">外观配置</button>
        <button type="button" class="char-tab-btn btn btn-outline btn-sm" data-tab="pose" style="border:none;border-radius:0;background:transparent">动作表情</button>
        <button type="button" class="char-tab-btn btn btn-outline btn-sm" data-tab="gear" style="border:none;border-radius:0;background:transparent">背包与装备</button>
        <button type="button" class="char-tab-btn btn btn-outline btn-sm" data-tab="voice" style="border:none;border-radius:0;background:transparent">语音</button>
        <button type="button" class="char-tab-btn btn btn-outline btn-sm" data-tab="level" style="border:none;border-radius:0;background:transparent">等级</button>
      </div>

      <!-- ===================== 基础属性 = 外观拼装 ===================== -->
      <div id="char-tab-basic">
      <!-- 基础参数压成一行：名称/类型/称号/分类/性别/存活/队伍/性格 -->
      <div class="char-row1">
        <label class="cf" style="flex:1.4 1 180px"><span>名称 *</span>
          <input name="name" value="${data?.name || ''}" required></label>
        <label class="cf" style="flex:0 0 104px"><span>类型</span>
          <select name="character_type">
            <option value="player" ${data?.character_type === 'player' ? 'selected' : ''}>玩家</option>
            <option value="npc" ${data?.character_type === 'npc' ? 'selected' : ''}>NPC</option>
            <option value="enemy" ${data?.character_type === 'enemy' ? 'selected' : ''}>敌人</option>
            <option value="ally" ${data?.character_type === 'ally' ? 'selected' : ''}>盟友</option>
          </select></label>
        <label class="cf" style="flex:1 1 140px"><span>称号</span>
          <input name="title" value="${data?.title || ''}"></label>
        <label class="cf" style="flex:0 0 140px"><span>自定义分类</span>
          <select name="category_path" id="char-category-select"><option value="">-- 未分类 --</option></select></label>
        <label class="cf" style="flex:0 0 88px"><span>性别</span>
          <select name="gender" id="char-gender">
            <option value="unknown" ${data?.gender === 'unknown' || !data?.gender ? 'selected' : ''}>未指定</option>
            <option value="male" ${data?.gender === 'male' ? 'selected' : ''}>男</option>
            <option value="female" ${data?.gender === 'female' ? 'selected' : ''}>女</option>
          </select></label>
        <label class="cf" style="flex:0 0 76px"><span>存活</span>
          <select name="is_alive">
            <option value="1" ${data?.is_alive !== 0 ? 'selected' : ''}>是</option>
            <option value="0" ${data?.is_alive === 0 ? 'selected' : ''}>否</option>
          </select></label>
        <label class="cf" style="flex:0 0 76px"><span>队伍</span>
          <select name="is_party_member">
            <option value="0" ${!data?.is_party_member ? 'selected' : ''}>否</option>
            <option value="1" ${data?.is_party_member ? 'selected' : ''}>是</option>
          </select></label>
        <label class="cf" style="flex:1.2 1 160px"><span>性格（逗号分隔）</span>
          <input name="personality" value="${data?.personality || ''}"></label>
      </div>

      <!-- 立绘 + 背景故事：左相框（不显示路径），右故事框撑满 -->
      <div class="char-row1 char-row2">
        <div class="cf char-portrait"><span>立绘</span>
          <div id="image-upload-area"></div>
          <input type="hidden" name="portrait_image" id="portrait_image_input" value="${data?.portrait_image || ''}">
        </div>
        <label class="cf char-story"><span>背景故事</span>
          <textarea name="background_story">${data?.background_story || ''}</textarea></label>
      </div>

      </div><!-- /char-tab-basic -->

      <!-- ===================== 外观配置（独立选项卡） ===================== -->
      <div id="char-tab-appear" style="display:none">
      <div class="cap-section">
        <div class="cap-head">
          <span class="cap-title">外观拼装配置</span>
          <span class="cap-desc">一套配置 = 一套着装 / 一种年龄状态（日常、战斗、童年…）。点配置卡切换，卡片上的按钮可直接改名 / 复制 / 设默认 / 删除。</span>
          <label class="cap-sensitive">
            <input type="checkbox" id="cap-sensitive" checked> 显示成人维度
          </label>
        </div>
        <div id="cap-preset-list" class="cap-list"></div>
        <div id="cap-empty" class="cap-hint" style="padding:8px 0">点击上方配置卡开始编辑外观。</div>
        <div id="cap-editor-wrap" style="display:none;margin-top:10px">
          <div class="cap-bar">
            <span>正在编辑：<b id="cap-current-name">—</b></span>
            <span class="cap-frame-view">立绘取景：<b id="cap-framing-view">全身</b>
              <span class="cap-hint" style="margin-left:4px">（随外观配置自动设定，在下方编辑器顶部修改）</span>
            </span>
            <span id="cap-render-status" class="cap-hint"></span>
            <span class="cap-actions">
              <button type="button" class="btn btn-primary btn-sm" id="cap-render">🖼 按此配置出立绘</button>
            </span>
          </div>
          <div class="cap-note">半身取景会自动略去「裙摆 / 裤腿 / 鞋袜」等下半身描述，并在提示词里强调只画腰部以上。</div>
          <div id="char-appearance-host" style="min-height:120px">
            <div style="font-size:13px;color:var(--text-muted);padding:10px">加载外观维度…</div>
          </div>
        </div>
      </div>
      </div><!-- /char-tab-appear -->

      <!-- ===================== 等级 ===================== -->
      <div id="char-tab-level" style="display:none">
        <div class="form-group">
          <label>境界等级（选择后自动填入标准属性）</label>
          <select name="realm_level" id="char-realm-select">
            <option value="1" ${(!data || data.realm_level === 1) ? 'selected' : ''}>练气期初期（默认）</option>
          </select>
          <span id="realm-desc" style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px"></span>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label>人物等级</label>
            <input name="level" type="number" value="${data?.level || 1}">
          </div>
          <div class="form-group">
            <label>经验值</label>
            <input name="exp" type="number" value="${data?.exp || 0}">
          </div>
          <div class="form-group">
            <label>幸运</label>
            <input name="luck" type="number" value="${data?.luck || 5}" id="char-luck">
          </div>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label>最大HP</label>
            <input name="max_hp" type="number" value="${data?.max_hp || 100}" id="char-max-hp">
          </div>
          <div class="form-group">
            <label>当前HP</label>
            <input name="hp" type="number" value="${data?.hp || data?.max_hp || 100}" id="char-hp">
          </div>
          <div class="form-group">
            <label>最大MP</label>
            <input name="max_mp" type="number" value="${data?.max_mp || 50}" id="char-max-mp">
          </div>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label>当前MP</label>
            <input name="mp" type="number" value="${data?.mp || data?.max_mp || 50}" id="char-mp">
          </div>
          <div class="form-group">
            <label>攻击力</label>
            <input name="attack" type="number" value="${data?.attack || 10}" id="char-attack">
          </div>
          <div class="form-group">
            <label>防御力</label>
            <input name="defense" type="number" value="${data?.defense || 5}" id="char-defense">
          </div>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label>速度</label>
            <input name="speed" type="number" value="${data?.speed || 5}" id="char-speed">
          </div>
          <div class="form-group">
            <label>恢复 (REC)</label>
            <input name="recovery" type="number" value="${data?.recovery ?? 60}">
          </div>
          <div class="form-group">
            <label>精神 (SPR)</label>
            <input name="spirit" type="number" value="${data?.spirit ?? 50}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>暴击率 (%)</label>
            <input name="crit_rate" type="number" value="${data?.crit_rate ?? 8}">
          </div>
        </div>
        <div class="ag-tip">
          等级与战斗属性从基础属性里独立出来放在这一页。选境界会把该境界的标准数值一键填入，
          填完仍可手动微调覆盖。
        </div>
      </div>

      <!-- ===================== 动作表情 ===================== -->
      <div id="char-tab-pose" style="display:none">
        ${isEdit
          ? '<div id="char-pose-host" style="min-height:200px"><div style="font-size:12px;color:var(--text-muted);padding:10px">加载动作表情…</div></div>'
          : '<div class="table-empty">请先保存人物，再管理动作表情</div>'}
      </div>

      <!-- 背包与装备（统一面板，布局与前台人物面板一致；这里是编辑态，可增删改） -->
      <div id="char-tab-gear" style="display:none">
        ${isEdit ? `
          <div class="ag-tip">
            这里的配置 = 玩家「新建人物 / 扮演该角色」时的<b>初始装备与背包</b>；
            武器、装备、技能书在这里添加，前台人物面板显示的就是这些数据。
          </div>
          <div id="ag-root" class="ag-root">加载中...</div>
        ` : '<div class="table-empty">请先保存人物后再管理背包与装备</div>'}
      </div>

      <!-- 语音选项卡：给这个角色挑一个说话的声音 -->
      <div id="char-tab-voice" style="display:none">
        <div class="form-row">
          <div class="form-group">
            <label>性别（在「基础属性」里改）</label>
            <div id="char-gender-hint" style="font-size:12px;color:var(--text-muted);padding:6px 0">
              决定下拉里优先推荐哪一批音色
            </div>
          </div>
          <div class="form-group">
            <label>语音引擎</label>
            <select name="tts_engine" id="char-tts-engine">
              <option value="edge">Edge TTS（在线 · 推荐）</option>
              <option value="onecore">本机 Windows 语音（离线）</option>
            </select>
            <small style="color:var(--text-muted);font-size:11px">断网时会自动退到本机语音</small>
          </div>
        </div>

        <div class="form-group">
          <label>语音主播（音色）</label>
          <select name="tts_voice" id="char-tts-voice">
            <option value="">加载中…</option>
          </select>
          <div id="char-tts-voice-hint" style="margin-top:6px;font-size:11px;color:var(--text-muted)"></div>
          <small style="color:var(--text-muted);font-size:11px;display:block;margin-top:4px">
            下拉分四组：普通话通用 / 方言乡音 / 地区口音 / <b>角色声线（派生）</b>。
            官方音色里没有老人，想配长者、稚童、帝王、说书人这类声线，请到「角色声线」组里选——
            它们是用语速和音调在基础音色上派生出来的，不额外增加合成耗时。
          </small>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>语速 <span id="char-rate-val">0</span>%</label>
            <input type="range" name="tts_rate" id="char-tts-rate" min="-50" max="50" value="0">
          </div>
          <div class="form-group">
            <label>音调 <span id="char-pitch-val">0</span>%</label>
            <input type="range" name="tts_pitch" id="char-tts-pitch" min="-30" max="30" value="0">
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <input id="char-tts-preview-text" value="前方似有埋伏，公子小心。"
                 style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text-primary)">
          <button type="button" class="btn btn-outline btn-sm" id="btn-tts-preview">试听</button>
        </div>
        <small style="color:var(--text-muted);font-size:11px">试试上面的句子，听感满意再保存。</small>
      </div>
    `;

    let appearanceEditor = null;
    // 多套外观配置：每条 = 一套着装 / 年龄状态。新人物先存本地，创建人物后再落库。
    let appearancePresets = [];
    let activePresetId = null;
    let appearanceSensitive = true;
    // 这两个状态必须在这里先声明：自动切页签的点击可能早于下面代码执行，
    // 放在下面会落进「暂时性死区」，点击回调抛错被吞掉，面板就永远不加载。
    let posePanelMounted = false;
    let gearPanelLoaded = false;

    function capGetActive() {
      return appearancePresets.find(p => p.id === activePresetId) || null;
    }
    function capSyncEditorToPreset() {
      const p = capGetActive();
      if (p && appearanceEditor) p.appearance = appearanceEditor.getAppearance();
    }

    Admin.showModal(isEdit ? '编辑人物' : '新建人物', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      capSyncEditorToPreset();
      try {
        if (isEdit) {
          await Admin.put(`/characters/${data.id}`, formData);
          for (const p of appearancePresets) {
            try {
              await Admin.put(`/characters/${data.id}/appearances/${p.id}`,
                { appearance: p.appearance || {} });
            } catch (e) { console.warn('保存外观配置失败', p.name, e); }
          }
          Admin.toast(`人物已更新（${appearancePresets.length} 套外观配置）`, 'success');
        } else {
          const created = await Admin.post('/characters', formData);
          if (created && created.id) {
            for (let i = 0; i < appearancePresets.length; i++) {
              const p = appearancePresets[i];
              try {
                await Admin.post(`/characters/${created.id}/appearances`, {
                  name: p.name || '默认外观',
                  appearance: p.appearance || {},
                  is_default: !!p.is_default || (i === 0 && !appearancePresets.some(x => x.is_default)),
                });
              } catch (e) { console.warn('创建外观配置失败', e); }
            }
          }
          Admin.toast('人物已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    }, { size: 'xl' });

    setTimeout(async () => {
      // 加载自定义分类下拉选项
      try {
        const catData = await Admin.get('/resource-categories/character/tree');
        const catSelect = document.getElementById('char-category-select');
        if (catSelect) {
          const initialCat = data?.category_path || currentCategory || '';
          function buildOpts(nodes, depth) {
            let html = '';
            nodes.forEach(n => {
              const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
              html += `<option value="${n.path}" ${initialCat === n.path ? 'selected' : ''}>${prefix}${n.name}</option>`;
              if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
            });
            return html;
          }
          let opts = '<option value="">-- 未分类 --</option>';
          opts += buildOpts((catData.tree || []), 0);
          catSelect.innerHTML = opts;
        }
      } catch (e) { console.warn('加载分类失败:', e); }

      // 加载境界等级列表并填充下拉框
      try {
        const realms = await Admin.get('/realms/');
        const select = document.getElementById('char-realm-select');
        if (select && realms.length > 0) {
          select.innerHTML = realms.map(r =>
            `<option value="${r.level}" ${data?.realm_level === r.level ? 'selected' : ''}>Lv.${r.level} ${r.full_name} (HP:${r.max_hp}/MP:${r.max_mp}/攻:${r.attack})</option>`
          ).join('');
          // 触发一次描述更新
          updateRealmDesc(select.value, realms);
        }
        // 绑定境界选择变化时自动填入属性
        if (select) {
          select.addEventListener('change', () => {
            const realm = realms.find(r => r.level === parseInt(select.value));
            if (!realm) return;
            // 自动填入属性数值
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            setVal('char-max-hp', realm.max_hp);
            setVal('char-hp', realm.max_hp);
            setVal('char-max-mp', realm.max_mp);
            setVal('char-mp', realm.max_mp);
            setVal('char-attack', realm.attack);
            setVal('char-defense', realm.defense);
            setVal('char-speed', realm.speed);
            setVal('char-luck', realm.luck);
            updateRealmDesc(select.value, realms);
            Admin.toast(`已应用「${realm.full_name}」属性`, 'success');
          });
        }
        function updateRealmDesc(level, list) {
          const r = list.find(x => x.level === parseInt(level));
          const descEl = document.getElementById('realm-desc');
          if (descEl && r) {
            descEl.textContent = `${r.full_name} | 寿命约${r.lifespan >= 10000 ? (r.lifespan/10000).toFixed(0)+'万' : r.lifespan}年 | ${r.description ? r.description.substring(0, 60) : ''}`;
          }
        }
      } catch (e) {
        console.warn('加载境界列表失败:', e);
      }

      const imgArea = document.getElementById('image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.portrait_image, (url) => {
          document.getElementById('portrait_image_input').value = url;
        });
      }
      // ===== 选项卡切换 =====
      document.querySelectorAll('.char-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          // 切换显示
          ['basic', 'appear', 'level', 'pose', 'gear', 'voice'].forEach(t => {
            const el = document.getElementById(`char-tab-${t}`);
            if (el) el.style.display = t === tab ? '' : 'none';
          });
          // 切换按钮样式
          document.querySelectorAll('.char-tab-btn').forEach(b => {
            if (b.dataset.tab === tab) {
              b.style.borderBottom = '2px solid var(--accent)';
              b.style.color = 'var(--accent)';
            } else {
              b.style.borderBottom = '2px solid transparent';
              b.style.color = 'var(--text-secondary)';
            }
          });
          // 懒加载「背包与装备」统一面板
          if (tab === 'gear' && isEdit) loadGearPanel();
          // 懒加载「动作表情」面板（首帧不请求，避免弹窗一打开就卡）
          if (tab === 'pose' && isEdit) mountPosePanel();
          // 外观编辑器体积大，等真的切到「外观配置」再挂（藏着的容器里量不出宽度）
          if (tab === 'appear') ensureCapEditor();
        });
      });

      // 从左侧栏任务卡点进来时，直接停在指定选项卡
      if (wantTab) {
        const btn = document.querySelector(`.char-tab-btn[data-tab="${wantTab}"]`);
        if (btn) setTimeout(() => btn.click(), 30);
      }

      // ===== 外观拼装：多套配置（着装 / 年龄状态 / 战斗装） =====
      const capListEl = document.getElementById('cap-preset-list');
      const capEmptyEl = document.getElementById('cap-empty');
      const capWrapEl = document.getElementById('cap-editor-wrap');
      const capNameEl = document.getElementById('cap-current-name');
      const capFramingViewEl = document.getElementById('cap-framing-view');
      const capSensEl = document.getElementById('cap-sensitive');
      const capHost = document.getElementById('char-appearance-host');

      if (capSensEl) {
        try {
          appearanceSensitive = true;
          capSensEl.checked = true;
        } catch (_) {}
      }

      function capFramingOf(p) {
        return (p && p.appearance && p.appearance.framing) || 'full';
      }

      // 取景是外观配置内置属性，这里只读展示，不提供选择
      function capUpdateFrameView() {
        const p = capGetActive();
        const half = p ? capFramingOf(p) === 'half' : false;
        if (capFramingViewEl) capFramingViewEl.textContent = half ? '半身' : '全身';
        if (capListEl) {
          const idx = appearancePresets.findIndex(x => x.id === (p && p.id));
          const tag = idx >= 0 ? capListEl.querySelector(`.cap-card[data-i="${idx}"] .cap-frame-tag`) : null;
          if (tag) {
            tag.classList.toggle('half', half);
            tag.textContent = half ? '半身' : '全身';
          }
        }
      }

      function capRenderPresets() {
        if (!capListEl) return;
        capListEl.innerHTML = appearancePresets.map((p, i) => `
          <div class="cap-card${p.id === activePresetId ? ' on' : ''}" data-i="${i}"
               title="点击编辑这套外观">
            <div class="cap-card-h">
              <span class="cap-star">${p.is_default ? '★' : '☆'}</span>
              <b>${esc(p.name)}</b>
              <span class="cap-frame-tag ${capFramingOf(p) === 'half' ? 'half' : ''}">
                ${capFramingOf(p) === 'half' ? '半身' : '全身'}
              </span>
            </div>
            <div class="cap-card-ops">
              <button type="button" data-act="rename" title="重命名">✎</button>
              <button type="button" data-act="copy" title="复制一套">⧉</button>
              <button type="button" data-act="default" title="设为默认" class="${p.is_default ? 'on' : ''}">${p.is_default ? '★' : '☆'}</button>
              <button type="button" data-act="del" title="删除这套配置">✕</button>
            </div>
          </div>`).join('') + `
          <div class="cap-card cap-add" id="cap-add" title="新增一套外观配置">＋ 新建配置</div>`;

        capListEl.querySelectorAll('.cap-card[data-i]').forEach(el => {
          el.addEventListener('click', async (e) => {
            if (e.target.closest('[data-act]')) return;
            const p = appearancePresets[parseInt(el.dataset.i, 10)];
            if (!p || p.id === activePresetId) return;
            await capSwitchTo(p);
          });
        });
        capListEl.querySelectorAll('[data-act]').forEach(b => {
          b.addEventListener('click', async (e) => {
            e.stopPropagation();
            const card = b.closest('.cap-card');
            const p = appearancePresets[parseInt(card.dataset.i, 10)];
            if (!p) return;
            const act = b.dataset.act;
            if (act === 'rename') {
              const name = await Admin.prompt('重命名外观配置', {
                label: '这套外观叫什么？（日常 / 战斗 / 童年…）', value: p.name,
              });
              if (!name || !name.trim()) return;
              p.name = name.trim();
              if (isEdit) {
                try { await Admin.put(`/characters/${data.id}/appearances/${p.id}`, { name: p.name }); }
                catch (err) { Admin.toast('重命名失败：' + err.message, 'error'); return; }
              }
              capRenderPresets();
              if (p.id === activePresetId && capNameEl) capNameEl.textContent = p.name;
            } else if (act === 'copy') {
              capSyncEditorToPreset();
              const base = escapeCopy(p.appearance || {});
              const name = await Admin.prompt('复制外观配置', {
                label: '复制成新配置，名称：', value: p.name + ' 副本',
              });
              if (!name || !name.trim()) return;
              const np = { id: 'tmp' + Date.now(), name: name.trim(), is_default: false, appearance: base };
              if (isEdit) {
                try {
                  const r = await Admin.post(`/characters/${data.id}/appearances`,
                    { name: np.name, appearance: base });
                  np.id = r.id; np.is_default = !!r.is_default;
                } catch (err) { Admin.toast('复制失败：' + err.message, 'error'); return; }
              }
              appearancePresets.push(np);
              await capSwitchTo(np);
            } else if (act === 'default') {
              if (p.is_default) return;
              appearancePresets.forEach(x => x.is_default = false);
              p.is_default = true;
              if (isEdit) {
                try { await Admin.post(`/characters/${data.id}/appearances/${p.id}/default`); }
                catch (err) { Admin.toast('设置默认失败：' + err.message, 'error'); }
              }
              capRenderPresets();
            } else if (act === 'del') {
              if (appearancePresets.length <= 1) {
                Admin.toast('至少保留一套外观配置', 'error'); return;
              }
              if (!await Admin.confirm(`删除外观配置「${p.name}」？已出的图不受影响。`)) return;
              if (isEdit) {
                try { await Admin.del(`/characters/${data.id}/appearances/${p.id}`); }
                catch (err) { Admin.toast('删除失败：' + err.message, 'error'); return; }
              }
              appearancePresets = appearancePresets.filter(x => x.id !== p.id);
              if (!appearancePresets.some(x => x.is_default)) appearancePresets[0].is_default = true;
              if (activePresetId === p.id) {
                activePresetId = appearancePresets[0].id;
                await capMountEditor(appearancePresets[0]);
              }
              capRenderPresets();
            }
          });
        });
        const addBtn = document.getElementById('cap-add');
        if (addBtn) {
          addBtn.addEventListener('click', async () => {
            capSyncEditorToPreset();
            const name = await Admin.prompt('新增外观配置', {
              label: '这套外观叫什么？（日常 / 战斗 / 童年…）', value: '新外观',
            });
            if (!name || !name.trim()) return;
            const base = escapeCopy((capGetActive() || {}).appearance || {});
            const np = { id: 'tmp' + Date.now(), name: name.trim(), is_default: false, appearance: base };
            if (isEdit) {
              try {
                const r = await Admin.post(`/characters/${data.id}/appearances`,
                  { name: np.name, appearance: base });
                np.id = r.id; np.is_default = !!r.is_default;
              } catch (err) { Admin.toast('新增失败：' + err.message, 'error'); return; }
            }
            appearancePresets.push(np);
            await capSwitchTo(np);
          });
        }
      }

      function escapeCopy(obj) {
        try { return JSON.parse(JSON.stringify(obj || {})); } catch (_) { return {}; }
      }

      async function capSwitchTo(p) {
        capSyncEditorToPreset();
        const prev = appearancePresets.find(x => x.id === activePresetId);
        if (isEdit && prev && prev.id && String(prev.id).indexOf('tmp') !== 0) {
          try {
            await Admin.put(`/characters/${data.id}/appearances/${prev.id}`,
              { appearance: prev.appearance || {} });
          } catch (_) {}
        }
        activePresetId = p.id;
        capRenderPresets();
        await capMountEditor(p);
      }

      // 外观配置现在是独立选项卡，编辑器等切过去再挂（藏在 display:none 里布局量不出来）
      let capMounted = false;
      async function ensureCapEditor() {
        if (capMounted) return;
        const p = capGetActive() || appearancePresets[0];
        if (p) await capMountEditor(p);
      }

      async function capMountEditor(p) {
        if (!capHost) return;
        capMounted = true;
        if (capWrapEl) capWrapEl.style.display = '';
        if (capEmptyEl) capEmptyEl.style.display = 'none';
        if (capNameEl) capNameEl.textContent = p.name + (p.is_default ? '（默认）' : '');
        capUpdateFrameView();
        capHost.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:10px">加载外观维度…</div>';
        appearanceEditor = null;
        try {
          appearanceEditor = await window.AppearanceEditor.mount(capHost, escapeCopy(p.appearance), {
            includeSensitive: appearanceSensitive,
            layout: 'split',
            onChange: (app) => { p.appearance = app; capUpdateFrameView(); },
            onSave: async (app) => {
              p.appearance = app;
              if (!isEdit) {
                Admin.toast('外观已暂存：保存人物时一并写入', 'success');
                return;
              }
              try {
                await Admin.put(`/characters/${data.id}/appearances/${p.id}`, { appearance: app });
                Admin.toast('这套外观已保存', 'success');
              } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
            },
          });
        } catch (e) {
          capHost.innerHTML = '<div class="table-empty">外观编辑器加载失败：' + e.message + '</div>';
        }
      }

      // 立绘取景已内置到外观配置编辑器中（顶部工具栏），此处只读展示，不再单独选择

      // 显示 / 隐藏成人维度（身体特征里的成人描述）
      capSensEl?.addEventListener('change', async () => {
        appearanceSensitive = !!capSensEl.checked;
        const p = capGetActive();
        if (!p) return;
        capSyncEditorToPreset();
        await capMountEditor(p);
      });

      // 按当前配置出立绘（全身 / 半身由取景下拉决定）
      document.getElementById('cap-render')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!appearanceEditor) { Admin.toast('外观还没加载完', 'error'); return; }
        const p = capGetActive();
        const app = appearanceEditor.getAppearance();
        p.appearance = app;
        const gp = window.GenParams ? await GenParams.ensure('characters') : {};
        const status = document.getElementById('cap-render-status');
        const curName = (document.querySelector('.modal-body input[name="name"]')?.value || '').trim()
          || data?.name || '人物';
        btn.disabled = true;
        if (status) status.textContent = '已提交到 ComfyUI，后台生成中…';
        try {
          const r = await Admin.post('/render/appearance', {
            appearance: app,
            // 提示词框手改过就用手改的这段出图
            positive: appearanceEditor.isPromptEdited() ? appearanceEditor.getPromptText() : null,
            include_sensitive: appearanceSensitive,
            model_preset: gp.model_preset || null,
            width: gp.width || null,
            height: gp.height || null,
            filename_prefix: 'portrait',
            page: 'characters',
            title: `${curName} · ${p.name} · 立绘`,
            character_id: isEdit ? data.id : null,
            character_name: curName,
          });
          const jobId = r.job_id;
          const timer = setInterval(async () => {
            let job = null;
            try { job = await Admin.get(`/jobs/${jobId}`); } catch (_) { return; }
            if (!job) return;
            if (job.status === 'running') {
              if (status) status.textContent = `生成中… ${job.message || ''}`;
              return;
            }
            clearInterval(timer);
            btn.disabled = false;
            if (job.status === 'error') {
              if (status) status.textContent = '失败：' + (job.message || '未知原因');
              Admin.toast('出图失败：' + (job.message || ''), 'error');
              return;
            }
            const it = job.render || (job.results || [])[0] || {};
            if (status) status.textContent = `已出图 ${it.width || ''}${it.width ? '×' : ''}${it.height || ''}`;
            if (it.url) {
              const pInput = document.getElementById('portrait_image_input');
              if (pInput) pInput.value = it.url;
              const area = document.getElementById('image-upload-area');
              if (area && window.AssetPicker) {
                area.innerHTML = '';
                Admin.renderImageUpload(area, it.url, (u) => {
                  const el = document.getElementById('portrait_image_input'); if (el) el.value = u;
                });
              }
              if (isEdit) {
                try { await Admin.put(`/characters/${data.id}`, { portrait_image: it.url }); } catch (_) {}
              }
              if (window.ImagePreview) {
                ImagePreview.open([{
                  url: it.url, title: `${curName} · 立绘`,
                  prompt: it.prompt || '', width: it.width, height: it.height,
                  meta: { '人物': curName, '配置': p.name, '取景': app.framing === 'half' ? '半身' : '全身' },
                }], 0);
              }
              Admin.toast('立绘已生成并设为人物立绘', 'success');
            }
          }, 2000);
        } catch (err) {
          btn.disabled = false;
          if (status) status.textContent = '提交失败：' + err.message;
          Admin.toast('提交失败：' + err.message, 'error');
        }
      });

      // 初始化配置列表
      try {
        if (isEdit) {
          const r = await Admin.get(`/characters/${data.id}/appearances`);
          appearancePresets = (r.items || []).map(x => ({
            id: x.id, name: x.name, is_default: !!x.is_default,
            appearance: x.appearance || {},
          }));
          if (!appearancePresets.length) {
            appearancePresets = [{ id: 'tmp1', name: '默认外观', is_default: true, appearance: {} }];
          }
        } else {
          appearancePresets = [{ id: 'tmp1', name: '默认外观', is_default: true, appearance: {} }];
          try {
            const rr = await Admin.post('/appearance/random', { include_sensitive: appearanceSensitive });
            appearancePresets[0].appearance = rr.appearance || {};
          } catch (_) {}
        }
        const def = appearancePresets.find(x => x.is_default) || appearancePresets[0];
        activePresetId = def.id;
        capRenderPresets();
        // 编辑器延迟到切进「外观配置」选项卡时再挂，弹窗打开更快
      } catch (e) {
        if (capHost) capHost.innerHTML = `<div class="table-empty">外观配置加载失败：${esc(e.message)}</div>`;
      }

      // ===== 动作表情（按需挂载） =====
      async function mountPosePanel() {
        if (posePanelMounted || !isEdit) return;
        const host = document.getElementById('char-pose-host');
        if (!host) return;
        posePanelMounted = true;
        try {
          await window.CharacterPosePanel.mount(host, data.id, {
            includeSensitive: false, charName: data.name,
          });
        } catch (e) {
          host.innerHTML = '<div class="table-empty">动作表情面板加载失败：' + e.message + '</div>';
        }
      }

      // 左侧栏任务卡点进来时：直接打开这个人物并停在「动作表情」
      window.__charFocusHandler = async (focus) => {
        const cid = focus && focus.character_id;
        if (!cid) return;
        try {
          const rec = await Admin.get(`/characters/${cid}`);
          if (rec) { Admin.closeModal(); showForm(rec, { tab: (focus && focus.tab) || 'pose' }); }
        } catch (e) { /* 人物可能被删了，忽略 */ }
      };
      if (window.PageFocus) PageFocus.set('characters', window.__charFocusHandler);

      // ===== 语音面板：音色列表 / 性别联动 / 试听 =====
      initCharacterVoicePanel(data);

      // ===== 背包与装备（统一面板：布局与前台人物面板一致；此处为「编辑态」，可增删改） =====
      // 前台 character.js 只是显示，这里是数据源：玩家新建角色时会复制这里的装备 / 背包 / 技能书。
      const GEAR_PARTS = [
        { slot: 'head', label: '头部' }, { slot: 'shoulders', label: '护肩' },
        { slot: 'weapon', label: '武器' }, { slot: 'chest', label: '胸甲' },
        { slot: 'gloves', label: '手套' }, { slot: 'pants', label: '护腿' },
        { slot: 'boots', label: '靴子' },
      ];
      const GEAR_MULTI = [{ slot: 'artifact', label: '法宝', cap: 4 }];
      const BOOK_CAP = 4;
      const GEAR_CAP = { weapon: 1, head: 1, shoulders: 1, chest: 1, gloves: 1, pants: 1, boots: 1, artifact: 4, set: 1, accessory: 2 };
      const STAT_KEYS = ['attack', 'defense', 'recovery', 'spirit', 'speed', 'luck', 'max_hp', 'max_mp', 'crit_rate'];
      const STAT_LABEL = { attack: '攻击', defense: '防御', recovery: '恢复', spirit: '精神', speed: '速度', luck: '幸运', max_hp: '生命', max_mp: '灵力', crit_rate: '暴击' };
      const RARITY_LABEL = { common: '普通', uncommon: '精良', rare: '稀有', epic: '史诗', legendary: '传说' };

      let _gearEquipped = [], _gearInventory = [], _gearBooks = [], _gearSkills = [], _gearEquipLib = [];
      let _invFilter = 'all', _invSearch = '';

      function _parseJson(s) { if (!s) return {}; try { return JSON.parse(s) || {}; } catch { return {}; } }
      function _gearStatSummary(bonuses) {
        const b = _parseJson(bonuses);
        return STAT_KEYS.filter(k => b[k]).map(k => `${STAT_LABEL[k]}${b[k] > 0 ? '+' : ''}${b[k]}`).join(' ');
      }

      async function loadGearPanel() {
        const root = document.getElementById('ag-root');
        if (!root) return;
        root.innerHTML = '<div style="color:var(--text-muted);font-size:12px">加载中...</div>';
        try {
          const [equipLib, equipped, inventory, skills, books] = await Promise.all([
            Admin.get('/equipments/').catch(() => []),
            Admin.get(`/equipments/character/${data.id}`).catch(() => []),
            Admin.get(`/items/character/${data.id}/inventory`).catch(() => []),
            Admin.get('/skills').catch(() => []),
            Admin.get(`/skill-books/character/${data.id}`).catch(() => []),
          ]);
          _gearEquipLib = equipLib; _gearEquipped = equipped; _gearInventory = inventory;
          _gearSkills = skills; _gearBooks = books;
          renderGear();
        } catch (e) {
          root.innerHTML = `<div style="color:var(--red);font-size:12px">加载失败: ${e.message}</div>`;
        }
      }

      function _equippedAt(slot, idx) {
        return _gearEquipped.find(ce => ce.slot === slot && (ce.slot_index || 1) === idx);
      }
      function _bookAt(idx) {
        return _gearBooks.find(b => (b.slot_index || 1) === idx);
      }

      function renderGear() {
        const root = document.getElementById('ag-root');
        if (!root) return;
        root.innerHTML = `
          <div class="ag-col ag-left">
            <div class="ag-h">属性（基础 + 装备加成）</div>
            <div id="ag-stats" class="ag-stats">${renderGearStats()}</div>
            <div class="ag-h">已装备技能书（决定战斗可用功法）</div>
            <div id="ag-book-list" class="ag-book-list">${renderBookList()}</div>
          </div>

          <div class="ag-col ag-center">
            <div class="ag-char-name">${esc(data.name || '')}<span class="ag-lv">Lv.${data.level || 1}</span></div>
            <div class="ag-stage">
              <div class="ag-portrait">${data.portrait_image ? `<img src="${data.portrait_image}" alt="">` : esc((data.name || '?')[0])}</div>
              ${GEAR_PARTS.map((p, i) => {
                const col = i % 2 === 0 ? 1 : 3;
                const row = Math.floor(i / 2) + 1;
                return `<div class="ag-slot-wrap" style="grid-column:${col};grid-row:${row}">${renderSlot(p.slot, p.label, 1)}</div>`;
              }).join('')}
            </div>
            ${GEAR_MULTI.map(g => `
              <div class="ag-sub">${g.label} <small>×${g.cap}</small></div>
              <div class="ag-multi">${Array.from({ length: g.cap }, (_, i) => renderSlot(g.slot, `${g.label}${i + 1}`, i + 1)).join('')}</div>
            `).join('')}
            <div class="ag-sub">技能书 <small>×${BOOK_CAP} · 来自后台「技能书」</small></div>
            <div class="ag-multi">${Array.from({ length: BOOK_CAP }, (_, i) => renderBookSlot(i + 1)).join('')}</div>
          </div>

          <div class="ag-col ag-right">
            <div class="ag-toolbar">
              <button type="button" class="btn btn-primary btn-sm" id="ag-add-equip">+ 装备入包</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-add-item">+ 物品入包</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-new-equip">新建装备</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-new-item">新建物品</button>
              <button type="button" class="btn btn-outline btn-sm" id="ag-new-book">新建技能书</button>
            </div>
            <div class="ag-filters">
              ${[{ id: 'all', label: '全部' }, { id: 'equipment', label: '装备' }, { id: 'item', label: '物品' }]
                .map(f => `<button type="button" class="ag-filter ${_invFilter === f.id ? 'active' : ''}" data-f="${f.id}">${f.label}</button>`).join('')}
              <input type="text" class="ag-search" placeholder="搜索名称..." value="${esc(_invSearch)}">
            </div>
            <div class="ag-inv" id="ag-inv">${renderInventory()}</div>
          </div>
        `;
        bindGear();
      }

      function renderGearStats() {
        const bonus = {};
        STAT_KEYS.forEach(k => bonus[k] = 0);
        _gearEquipped.forEach(ce => {
          const st = _parseJson(ce.equipment && ce.equipment.stat_bonuses);
          STAT_KEYS.forEach(k => { if (st[k]) bonus[k] += st[k]; });
        });
        return STAT_KEYS.map(k => {
          const base = Number(data[k] ?? 0);
          const b = bonus[k];
          return `<div class="ag-stat"><span>${STAT_LABEL[k]}</span><b>${base + b}</b>${b ? `<i class="up">+${b}</i>` : ''}</div>`;
        }).join('');
      }

      function renderBookList() {
        if (!_gearBooks.length) return '<div class="ag-empty">尚未装备技能书</div>';
        return _gearBooks.map(b => {
          const s = b.skill || {};
          return `<div class="ag-book-row">
            <span class="ag-book-idx">${b.slot_index}</span>
            <span class="ag-book-name">${esc(s.name || '#' + b.skill_id)}</span>
            ${s.is_ultimate ? '<em class="ag-ult">神通</em>' : ''}
            <span class="ag-book-meta">威${s.power || 0} MP${s.mp_cost || 0}${s.rage_cost ? ' 怒' + s.rage_cost : ''}</span>
          </div>`;
        }).join('');
      }

      function renderSlot(slotKey, label, idx) {
        const ce = _equippedAt(slotKey, idx);
        const eq = ce && ce.equipment;
        const filled = !!eq;
        return `<div class="ag-slot ${filled ? 'filled' : ''} ${eq && eq.rarity ? 'r-' + eq.rarity : ''}" data-slot="${slotKey}" data-idx="${idx}">
          ${filled
            ? `<div class="ag-slot-img">${eq.image ? `<img src="${eq.image}" alt="">` : esc((eq.name || '?')[0])}</div>
               <div class="ag-slot-name">${esc(eq.name)}</div>
               <button type="button" class="ag-slot-x" data-act="unequip" title="卸下">&times;</button>`
            : `<div class="ag-slot-add" data-act="pick">+</div>`}
          <div class="ag-slot-label">${label}</div>
        </div>`;
      }

      function renderBookSlot(idx) {
        const b = _bookAt(idx);
        const s = b && b.skill;
        return `<div class="ag-slot ag-slot-book ${s ? 'filled' : ''} ${s && s.is_ultimate ? 'is-ult' : ''}" data-book-idx="${idx}">
          ${s
            ? `<div class="ag-slot-img">${s.image ? `<img src="${s.image}" alt="">` : '书'}</div>
               <div class="ag-slot-name">${esc(s.name)}</div>
               <button type="button" class="ag-slot-x" data-act="unbook" title="卸下">&times;</button>`
            : `<div class="ag-slot-add" data-act="pickbook">+</div>`}
          <div class="ag-slot-label">技能书${idx}</div>
        </div>`;
      }

      function renderInventory() {
        let items = _gearInventory;
        if (_invFilter === 'equipment') items = items.filter(i => i.item_kind === 'equipment');
        if (_invFilter === 'item') items = items.filter(i => i.item_kind !== 'equipment');
        if (_invSearch) {
          const q = _invSearch.toLowerCase();
          items = items.filter(i => (i.name || '').toLowerCase().includes(q));
        }
        if (!items.length) return '<div class="ag-empty">背包为空 —— 用上方按钮把装备/物品加进来</div>';
        return items.map(inv => {
          const isEq = inv.item_kind === 'equipment';
          const sum = isEq ? _gearStatSummary(inv.stat_bonuses) : '';
          return `<div class="ag-inv-cell ${inv.rarity ? 'r-' + inv.rarity : ''}">
            <div class="ag-inv-icon">${inv.image ? `<img src="${inv.image}" alt="">` : esc((inv.name || '?')[0])}</div>
            <div class="ag-inv-info">
              <div class="ag-inv-name">${esc(inv.name)}</div>
              <div class="ag-inv-meta">
                <span class="ag-tag ${isEq ? 'eq' : 'it'}">${isEq ? '装备' : '物品'}</span>
                ${inv.item_type ? `<span class="ag-tag">${SLOT_LABELS[inv.item_type] || inv.item_type}</span>` : ''}
                ${sum ? `<span class="ag-inv-stat">${esc(sum)}</span>` : ''}
              </div>
            </div>
            <div class="ag-inv-ops">
              ${isEq ? `<button type="button" class="ag-op" data-act="equip" data-inv="${inv.id}">装备</button>` : ''}
              <button type="button" class="ag-op" data-act="qty" data-inv="${inv.id}" data-delta="-1">-</button>
              <span class="ag-qty">${inv.quantity}</span>
              <button type="button" class="ag-op" data-act="qty" data-inv="${inv.id}" data-delta="1">+</button>
              <button type="button" class="ag-op danger" data-act="del" data-inv="${inv.id}">×</button>
            </div>
          </div>`;
        }).join('');
      }

      function bindGear() {
        const root = document.getElementById('ag-root');
        if (!root) return;

        // 装备槽：点空槽选装备，点 × 卸下
        root.querySelectorAll('.ag-slot[data-slot]').forEach(el => {
          el.addEventListener('click', async (e) => {
            const slot = el.dataset.slot, idx = parseInt(el.dataset.idx);
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'unequip') {
              try {
                await Admin.del(`/equipments/character/${data.id}/slot/${slot}?slot_index=${idx}`);
                Admin.toast('已卸下', 'success');
                await loadGearPanel();
              } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
              return;
            }
            const picked = await Admin.Pickers.equipment({ multi: false, typeFilter: slot });
            if (!picked) return;
            const eq = Array.isArray(picked) ? picked[0] : picked;
            try {
              await Admin.post(`/equipments/character/${data.id}`, { equipment_id: eq.id, slot, slot_index: idx });
              // 装备后从背包里扣掉一件（与前台穿戴逻辑一致）
              const inv = _gearInventory.find(i => i.item_kind === 'equipment' && i.item_id === eq.id);
              if (inv) await Admin.del(`/items/character/${data.id}/inventory/${inv.id}`);
              Admin.toast('已装备：' + eq.name, 'success');
              await loadGearPanel();
            } catch (err) { Admin.toast('装备失败: ' + err.message, 'error'); }
          });
        });

        // 技能书槽
        root.querySelectorAll('.ag-slot[data-book-idx]').forEach(el => {
          el.addEventListener('click', async (e) => {
            const idx = parseInt(el.dataset.bookIdx);
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'unbook') {
              try {
                await Admin.del(`/skill-books/character/${data.id}/slot/${idx}`);
                Admin.toast('已卸下技能书', 'success');
                await loadGearPanel();
              } catch (err) { Admin.toast('卸下失败: ' + err.message, 'error'); }
              return;
            }
            pickSkillBook(idx);
          });
        });

        // 背包操作
        root.querySelectorAll('.ag-op').forEach(btn => {
          btn.addEventListener('click', async () => {
            const act = btn.dataset.act, invId = parseInt(btn.dataset.inv);
            const inv = _gearInventory.find(i => i.id === invId);
            try {
              if (act === 'del') {
                await Admin.del(`/items/character/${data.id}/inventory/${invId}`);
                Admin.toast('已移除', 'success');
              } else if (act === 'qty') {
                const delta = parseInt(btn.dataset.delta);
                const next = (inv?.quantity || 0) + delta;
                await Admin.put(`/items/character/${data.id}/inventory/${invId}/quantity?quantity=${next}`);
              } else if (act === 'equip') {
                const slot = inv.item_type;
                if (!GEAR_CAP[slot]) { Admin.toast('该物品不能装备', 'error'); return; }
                await Admin.post(`/equipments/character/${data.id}`, { equipment_id: inv.item_id, slot });
                await Admin.del(`/items/character/${data.id}/inventory/${invId}`);
                Admin.toast('已装备：' + inv.name, 'success');
              }
              await loadGearPanel();
            } catch (err) { Admin.toast('操作失败: ' + err.message, 'error'); }
          });
        });

        // 筛选 / 搜索
        root.querySelectorAll('.ag-filter').forEach(b => {
          b.addEventListener('click', () => { _invFilter = b.dataset.f; renderGear(); });
        });
        const search = root.querySelector('.ag-search');
        if (search) {
          search.addEventListener('input', (e) => {
            _invSearch = e.target.value;
            const inv = document.getElementById('ag-inv');
            if (inv) inv.innerHTML = renderInventory();
          });
        }

        // 工具栏
        document.getElementById('ag-add-equip')?.addEventListener('click', async () => {
          const picked = await Admin.Pickers.equipment({ multi: true });
          const list = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
          if (!list.length) return;
          let ok = 0;
          for (const eq of list) {
            try {
              await Admin.post(`/items/character/${data.id}/inventory`, { item_id: eq.id, item_kind: 'equipment', quantity: 1 });
              ok++;
            } catch (_) {}
          }
          Admin.toast(`已加入背包 ${ok} 件装备`, ok ? 'success' : 'error');
          await loadGearPanel();
        });
        document.getElementById('ag-add-item')?.addEventListener('click', async () => {
          const picked = await Admin.Pickers.item({ multi: true });
          const list = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
          if (!list.length) return;
          let ok = 0;
          for (const it of list) {
            try {
              await Admin.post(`/items/character/${data.id}/inventory`, { item_id: it.id, item_kind: 'item', quantity: 1 });
              ok++;
            } catch (_) {}
          }
          Admin.toast(`已加入背包 ${ok} 个物品`, ok ? 'success' : 'error');
          await loadGearPanel();
        });
        document.getElementById('ag-new-equip')?.addEventListener('click', () => showCreateEquipmentModal(data.id, true));
        document.getElementById('ag-new-item')?.addEventListener('click', () => showCreateItemModal(data.id, true));
        document.getElementById('ag-new-book')?.addEventListener('click', () => showCreateSkillBookModal());
      }

      // 选择一本后台「技能书」装到指定槽位
      function pickSkillBook(idx) {
        const opts = _gearSkills.map(s =>
          `<option value="${s.id}">${esc(s.name)}${s.is_ultimate ? '（神通）' : ''} · 威${s.power || 0} MP${s.mp_cost || 0}</option>`).join('');
        Admin.showModal(`装备技能书到槽位 ${idx}`, `
          <div class="form-group">
            <label>从后台「技能书」中选择</label>
            <select id="ag-book-sel">${opts || '<option value="">（后台技能书库为空，请先新建）</option>'}</select>
            <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">
              技能书 = 后台「技能书」栏目里的一条记录；装什么书，战斗就能用什么功法。
            </span>
          </div>`, async () => {
          const sid = parseInt(document.getElementById('ag-book-sel')?.value);
          if (!sid) { Admin.toast('请选择一本技能书', 'error'); return; }
          try {
            await Admin.post(`/skill-books/character/${data.id}`, { skill_id: sid, slot_index: idx });
            Admin.toast('技能书已装备', 'success');
            Admin.closeModal();
            await loadGearPanel();
          } catch (e) { Admin.toast('装备失败: ' + e.message, 'error'); }
        });
      }

      // 新建一本技能书（写入后台「技能书」库）
      function showCreateSkillBookModal() {
        Admin.showModal('新建技能书', `
          <div class="form-group"><label>名称 *</label><input name="name" required placeholder="如：九霄雷动诀"></div>
          <div class="form-row">
            <div class="form-group"><label>类型</label>
              <select name="skill_type"><option value="physical">物理</option><option value="magic">魔法</option><option value="special">特殊</option><option value="passive">被动</option></select></div>
            <div class="form-group"><label>是否神通</label>
              <select name="is_ultimate"><option value="0">普通技能</option><option value="1">神通（消耗怒气）</option></select></div>
          </div>
          <div class="form-row form-row-3">
            <div class="form-group"><label>威力</label><input name="power" type="number" value="100"></div>
            <div class="form-group"><label>MP消耗</label><input name="mp_cost" type="number" value="0"></div>
            <div class="form-group"><label>怒气消耗</label><input name="rage_cost" type="number" value="0"></div>
          </div>
          <div class="form-group"><label>描述</label><textarea name="description"></textarea></div>
        `, async () => {
          const fd = Admin.getFormData('.modal-body');
          if (!fd.name || !fd.name.trim()) { Admin.toast('请填写名称', 'error'); return; }
          try {
            const sk = await Admin.post('/skills', {
              name: fd.name.trim(), skill_type: fd.skill_type || 'physical',
              power: parseInt(fd.power || 0), mp_cost: parseInt(fd.mp_cost || 0),
              rage_cost: parseInt(fd.rage_cost || 0),
              is_ultimate: parseInt(fd.is_ultimate || 0),
              description: fd.description || null,
            });
            Admin.toast('技能书已创建：' + sk.name, 'success');
            Admin.closeModal();
            await loadGearPanel();
          } catch (e) { Admin.toast('创建失败: ' + e.message, 'error'); }
        });
      }
        // 自定义新建物品并加入背包
      async function showCreateItemModal(characterId) {
        const typeOpts = ['consumable','weapon','armor','accessory','key_item','material']
          .map(t => `<option value="${t}">${t}</option>`).join('');
        const bodyHtml = `
          <div class="form-group"><label>名称 *</label><input name="name" required></div>
          <div class="form-row">
            <div class="form-group"><label>类型</label><select name="item_type">${typeOpts}</select></div>
            <div class="form-group"><label>品质</label><select name="rarity"><option value="common">普通</option><option value="uncommon">精良</option><option value="rare">稀有</option><option value="epic">史诗</option><option value="legendary">传说</option></select></div>
          </div>
          <div class="form-group"><label>描述</label><textarea name="description"></textarea></div>
          <div class="form-group"><label>战斗效果 (JSON 数组，如 [{"kind":"heal","power":50}])</label><input name="effects" placeholder='[{"kind":"heal","power":50}]'></div>
          <div class="form-group"><label>图片路径</label><input name="image" placeholder="/images/xxx.png"></div>
        `;
        Admin.showModal('自定义新建物品', bodyHtml, async () => {
          const fd = Admin.getFormData('.modal-body');
          if (!fd.name || !fd.name.trim()) { Admin.toast('请填写名称', 'error'); return; }
          const payload = {
            name: fd.name.trim(),
            item_type: fd.item_type || 'consumable',
            rarity: fd.rarity || 'common',
            description: fd.description || null,
          };
          if (fd.effects) { try { payload.effects = JSON.stringify(JSON.parse(fd.effects)); } catch { Admin.toast('战斗效果 JSON 格式错误', 'error'); return; } }
          if (fd.image) payload.image = fd.image;
          try {
            const item = await Admin.post('/items', payload);
            await Admin.post(`/items/character/${characterId}/inventory`, { item_id: item.id, item_kind: 'item', quantity: 1 });
            Admin.toast('已创建并加入背包：' + item.name, 'success');
            Admin.closeModal();
            await loadGearPanel();
          } catch (e) { Admin.toast('创建失败: ' + e.message, 'error'); }
        });
      }

      // 自定义新建装备（武器/防具/法宝），创建后放进人物背包，可从背包里装备到槽位
      async function showCreateEquipmentModal(characterId) {
        const typeOpts = ['weapon','head','shoulders','chest','gloves','pants','boots','artifact']
          .map(t => `<option value="${t}">${SLOT_LABELS[t] || t}</option>`).join('');
        const bodyHtml = `
          <div class="form-group"><label>名称 *</label><input name="name" required></div>
          <div class="form-row">
            <div class="form-group"><label>类型（决定能装到哪个槽位）*</label><select name="equipment_type">${typeOpts}</select></div>
            <div class="form-group"><label>品质</label><select name="rarity"><option value="common">普通</option><option value="uncommon">精良</option><option value="rare">稀有</option><option value="epic">史诗</option><option value="legendary">传说</option></select></div>
          </div>
          <div class="form-group"><label>描述</label><textarea name="description"></textarea></div>
          <div class="form-group"><label>属性加成 (JSON，如 {"attack":20,"defense":10})</label><input name="stat_bonuses" placeholder='{"attack":20}'></div>
          <div class="form-group"><label>图片路径</label><input name="image" placeholder="/images/xxx.png"></div>
          <div style="font-size:11px;color:var(--text-muted)">技能书请在「新建技能书」里创建（技能书 = 后台「技能书」栏目的一条记录）。</div>
        `;
        Admin.showModal('自定义新建装备', bodyHtml, async () => {
          const fd = Admin.getFormData('.modal-body');
          if (!fd.name || !fd.name.trim()) { Admin.toast('请填写名称', 'error'); return; }
          const payload = {
            name: fd.name.trim(),
            equipment_type: fd.equipment_type,
            rarity: fd.rarity || 'common',
            description: fd.description || null,
          };
          if (fd.stat_bonuses) { try { payload.stat_bonuses = JSON.stringify(JSON.parse(fd.stat_bonuses)); } catch { Admin.toast('属性加成 JSON 格式错误', 'error'); return; } }
          if (fd.image) payload.image = fd.image;
          try {
            const eq = await Admin.post('/equipments/', payload);
            await Admin.post(`/items/character/${characterId}/inventory`, { item_id: eq.id, item_kind: 'equipment', quantity: 1 });
            Admin.toast('已创建并加入背包：' + eq.name, 'success');
            Admin.closeModal();
            await loadGearPanel();
          } catch (e) { Admin.toast('创建失败: ' + e.message, 'error'); }
        });
      }

  }, 100);
  }

  // 挂上「任务卡 → 直接打开这个人物并停在动作表情」的处理器。
  // 必须放在页面级注册（不是等用户先打开过某个人物），否则首次从左侧栏点进来没人接手。
  window.__charFocusHandler = async (focus) => {
    const cid = focus && focus.character_id;
    if (!cid) return;
    try {
      const rec = await Admin.get(`/characters/${cid}`);
      if (rec) { Admin.closeModal(); showForm(rec, { tab: (focus && focus.tab) || 'pose' }); }
    } catch (e) { /* 人物可能被删了，忽略 */ }
  };
  if (window.PageFocus) PageFocus.set('characters', window.__charFocusHandler);

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});