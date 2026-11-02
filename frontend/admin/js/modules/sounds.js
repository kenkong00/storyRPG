// ========== 声音管理：统一声音库 + 角色语音配置 + 语音包 ==========
//
//   · 声音库：全系统生成/上传的声音都集中在这（含语音任务、剧情对话语音的产物），
//     可分类、可批量删除、可移动分类、可试听/剪辑；
//   · 角色语音配置：专门给每个人物配引擎/音色/语速/音调/音量（人物管理里的语音页已移除，
//     以后统一在这里配）；
//   · 语音包：语音任务的列表（语音包 = 多条声音 + 参数配置的复合单元），
//     点开直接复用语音任务页同一个弹窗。
Admin.registerPage('sounds', async (container) => {
  let sounds = [], selectedIds = new Set();
  let currentCategory = '';
  let categoryBarInstance = null;
  let layoutInitialized = false;
  let allItemsCache = []; // 全部数据，用于分类计数
  let currentFilterCat = ''; // voice/bgm 客户端筛选
  let currentTab = 'library';
  let charVoiceCache = [];   // 角色语音配置页数据
  let packCache = [];        // 语音包页数据
  let _voiceGroups = null;   // TTS 音色分组缓存

  async function load() {
    allItemsCache = await Admin.get('/sounds/');
    // 后端会按声音数据自动补建分类，这里重新拉一次树，新目录立刻出现在左侧
    if (categoryBarInstance && categoryBarInstance.refresh) {
      try { await categoryBarInstance.refresh(); } catch (_) { /* 忽略 */ }
    }
    applyClientFilter();
  }

  /** 某个声音是否属于某分类（含其子分类）；cat 为空表示「未分类」 */
  function inCategory(path, cat) {
    const p = path || '';
    if (!cat) return !p;
    return p === cat || p.indexOf(cat + '/') === 0;
  }

  function applyClientFilter() {
    // 以前是 category_path === currentCategory 的精确匹配：点父目录「剧情语音」会一条都不显示，
    // 因为声音都挂在「剧情语音/黄蓉出现」这种子路径上。改成前缀匹配。
    let filtered = allItemsCache.filter(x => inCategory(x.category_path, currentCategory));
    if (currentFilterCat) {
      filtered = filtered.filter(x => x.category === currentFilterCat);
    }
    sounds = filtered;
    selectedIds.clear();
    render();
  }

  function countInCategory(path) {
    return allItemsCache.filter(x => inCategory(x.category_path, path)).length;
  }

  // 初始化整体布局（只执行一次：选项卡 + 三个面板容器，分类栏容器保持稳定）
  function initLayout() {
    if (layoutInitialized) return;
    layoutInitialized = true;
    container.innerHTML = `
      <div class="sm-tabs">
        <button type="button" class="sm-tab on" data-tab="library">声音库</button>
        <button type="button" class="sm-tab" data-tab="voices">角色语音配置</button>
        <button type="button" class="sm-tab" data-tab="packs">语音包</button>
      </div>
      <div id="sm-pane-library">
        <div id="cat-bar-host"></div>
        <div id="sounds-toolbar"></div>
        <div id="sounds-body"></div>
      </div>
      <div id="sm-pane-voices" style="display:none"></div>
      <div id="sm-pane-packs" style="display:none"></div>
    `;
    container.querySelectorAll('.sm-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    const host = document.getElementById('cat-bar-host');
    categoryBarInstance = CategoryBar.mount(host, 'sound', {
      label: '声音分类',
      totalCount: 0,
      getCount: countInCategory,
      onSelect: (path) => {
        currentCategory = path || '';
        applyClientFilter();
      },
      onTreeChange: () => render(),
    });
  }

  function switchTab(tab) {
    currentTab = tab;
    container.querySelectorAll('.sm-tab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tab);
    });
    ['library', 'voices', 'packs'].forEach(t => {
      const el = document.getElementById('sm-pane-' + t);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'voices') loadVoices();
    if (tab === 'packs') loadPacks();
  }

  function render() {
    initLayout();
    if (categoryBarInstance) {
      categoryBarInstance.setPath(currentCategory);
    }
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const toolbar = document.getElementById('sounds-toolbar');
    if (toolbar) {
      toolbar.innerHTML = `
        <div class="search-bar">
          <span style="color:var(--text-muted);line-height:2">共 ${sounds.length} 个声音</span>
          <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
          <span style="color:var(--text-muted);margin:0 4px">|</span>
          <button class="btn btn-outline btn-sm" id="btn-move-selected" ${batchAttr}>移动分类</button>
          <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
          <div style="flex:1"></div>
          <select id="filter-category" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">
            <option value="" ${currentFilterCat === '' ? 'selected' : ''}>全部分类</option>
            <option value="voice" ${currentFilterCat === 'voice' ? 'selected' : ''}>人声</option>
            <option value="bgm" ${currentFilterCat === 'bgm' ? 'selected' : ''}>背景音乐</option>
          </select>
          <button class="btn btn-primary btn-sm" id="btn-add">+ 上传声音</button>
          <button class="btn btn-outline btn-sm" id="btn-studio" style="margin-left:6px">🎙 录制 / 剪辑</button>
        </div>
      `;
    }

    let folderHtml = '';
    if (categoryBarInstance) {
      folderHtml = categoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (sounds.length === 0) {
      bodyHtml = '<div class="table-empty">暂无声音</div>';
    } else {
      bodyHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px">';
      sounds.forEach(s => {
        const checked = selectedIds.has(s.id) ? 'checked' : '';
        const catLabel = s.category === 'bgm' ? '背景音乐' : '人声';
        const formatLabel = s.file_format ? s.file_format.toUpperCase() : '';
        bodyHtml += `
          <div class="stat-card" style="padding:14px;position:relative">
            <input type="checkbox" class="item-checkbox" data-id="${s.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            <div style="font-size:28px;text-align:center;margin:8px 0">${s.category === 'bgm' ? '&#9835;' : '&#128266;'}</div>
            <div style="font-size:13px;font-weight:500;text-align:center;margin-bottom:4px">${s.name}</div>
            <div style="text-align:center;margin-bottom:6px">
              <span class="tag tag-${s.category === 'bgm' ? 'player' : 'npc'}">${catLabel}</span>
              ${formatLabel ? `<span class="tag tag-item">${formatLabel}</span>` : ''}
            </div>
            <div style="font-size:10px;color:var(--text-muted);text-align:center;margin-bottom:8px">${s.description || ''}</div>
            <div style="display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm btn-preview" data-url="${s.file_url}" style="font-size:10px;padding:2px 8px">&#9654; 试听</button>
              <button class="btn btn-outline btn-sm btn-edit" data-id="${s.id}" style="font-size:10px;padding:2px 8px">编辑</button>
              <button class="btn btn-outline btn-sm btn-studio-open" data-url="${s.file_url}" data-name="${s.name}" style="font-size:10px;padding:2px 8px">✂ 剪辑</button>
              <button class="btn btn-outline btn-sm btn-del" data-id="${s.id}" style="font-size:10px;padding:2px 8px;color:var(--red);border-color:var(--red)">删除</button>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    }

    const bodyEl = document.getElementById('sounds-body');
    if (bodyEl) bodyEl.innerHTML = folderHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('btn-add')?.addEventListener('click', () => showForm());
    document.getElementById('btn-studio')?.addEventListener('click', () => {
      if (typeof AudioStudio !== 'undefined') {
        AudioStudio.open({ onSaved: () => load() });
      } else {
        Admin.toast('声音工作室未加载', 'error');
      }
    });
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

    const filterCat = document.getElementById('filter-category');
    if (filterCat) {
      filterCat.addEventListener('change', () => {
        currentFilterCat = filterCat.value;
        applyClientFilter();
      });
    }

    document.querySelectorAll('.item-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        render();
      });
    });

    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedIds.size} 个声音？`)) return;
      try {
        const r = await Admin.post('/sounds/batch-delete', { ids: [...selectedIds] });
        Admin.toast(`已删除 ${r.deleted} 个声音`, 'success');
      } catch (e) {
        // 老接口逐个删兜底
        for (const id of selectedIds) {
          try { await Admin.del(`/sounds/${id}`); } catch (_) {}
        }
        Admin.toast('删除完成', 'success');
      }
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      selectedIds.clear();
      render();
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = sounds.find(x => x.id === parseInt(btn.dataset.id));
        if (s) showForm(s);
      });
    });

    document.querySelectorAll('.btn-studio-open').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof AudioStudio !== 'undefined') {
          AudioStudio.open({ url: btn.dataset.url, name: btn.dataset.name, onSaved: () => load() });
        } else {
          Admin.toast('声音工作室未加载', 'error');
        }
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Admin.confirm('确定删除此声音？')) return;
        await Admin.del(`/sounds/${btn.dataset.id}`);
        Admin.toast('已删除', 'success');
        await load();
      });
    });

    // 试听功能
    document.querySelectorAll('.btn-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const existing = document.getElementById('audio-preview-player');
        if (existing) existing.remove();

        const player = document.createElement('div');
        player.id = 'audio-preview-player';
        player.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
        player.innerHTML = `
          <audio controls autoplay style="width:280px;height:36px">
            <source src="${url}" type="audio/mpeg">
            <source src="${url}" type="audio/ogg">
            <source src="${url}" type="audio/wav">
          </audio>
          <button class="btn btn-outline btn-sm" id="close-preview-player" style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;padding:0;border-radius:50%;font-size:12px;line-height:1">&times;</button>
        `;
        document.body.appendChild(player);
        document.getElementById('close-preview-player').addEventListener('click', () => player.remove());
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
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedIds.size}</b> 项移动到：</p>
      <div class="form-group">
        <select id="batch-move-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
          ${buildOpts(tree, 0)}
        </select>
      </div>
    `;
    Admin.showModal('批量移动分类', bodyHtml, async () => {
      const newCat = document.getElementById('batch-move-cat')?.value || '';
      let success = 0, fail = 0;
      for (const id of selectedIds) {
        try {
          await Admin.put(`/sounds/${id}`, { category_path: newCat });
          success++;
        } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await load();
    });
  }

  function showForm(data = null) {
    const isEdit = !!data;
    const bodyHtml = `
      <div class="form-group">
        <label>名称 *</label>
        <input name="name" value="${data?.name || ''}" required>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="sound-category-select">
          <option value="">-- 未分类 --</option>
        </select>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px">归属的自定义分类，可在分类栏中管理</span>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>分类</label>
          <select name="category">
            <option value="voice" ${data?.category === 'voice' ? 'selected' : ''}>人声</option>
            <option value="bgm" ${data?.category === 'bgm' ? 'selected' : ''}>背景音乐</option>
          </select>
        </div>
        <div class="form-group">
          <label>文件格式</label>
          <select name="file_format">
            <option value="mp3" ${data?.file_format === 'mp3' ? 'selected' : ''}>MP3</option>
            <option value="wav" ${data?.file_format === 'wav' ? 'selected' : ''}>WAV</option>
            <option value="ogg" ${data?.file_format === 'ogg' ? 'selected' : ''}>OGG</option>
            <option value="flac" ${data?.file_format === 'flac' ? 'selected' : ''}>FLAC</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>文件路径/URL *</label>
        <input name="file_url" value="${data?.file_url || ''}" placeholder="如: /sounds/bgm_001.mp3" required>
      </div>
      <div class="form-group">
        <label>文件系统路径</label>
        <input name="file_path" value="${data?.file_path || ''}">
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
      ${data?.file_url ? `
        <div class="form-group">
          <label>当前试听</label>
          <audio controls style="width:100%"><source src="${data.file_url}"></audio>
        </div>
      ` : ''}
    `;

    Admin.showModal(isEdit ? '编辑声音' : '上传声音', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      formData.file_path = formData.file_path || formData.file_url;
      try {
        if (isEdit) {
          await Admin.put(`/sounds/${data.id}`, formData);
          Admin.toast('声音已更新', 'success');
        } else {
          await Admin.post('/sounds/', formData);
          Admin.toast('声音已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });

    setTimeout(async () => {
      try {
        const catData = await Admin.get('/resource-categories/sound/tree');
        const catSelect = document.getElementById('sound-category-select');
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
    }, 100);
  }

  // ==================================================================
  // 角色语音配置：每个角色的引擎/音色/语速/音调/音量（人物编辑页的语音页已移除）
  // ==================================================================
  async function loadVoices() {
    const pane = document.getElementById('sm-pane-voices');
    if (!pane) return;
    pane.innerHTML = '<div class="table-empty">加载中…</div>';
    try { charVoiceCache = await Admin.get('/characters/'); } catch (_) { charVoiceCache = []; }
    if (!_voiceGroups) {
      try { const r = await Admin.get('/tts/voices?grouped=true'); _voiceGroups = (r && r.groups) || r || []; } catch (_) { _voiceGroups = []; }
    }
    renderVoices();
  }

  function voiceOptionHtml(engine, current) {
    const groups = (_voiceGroups || []).filter(g => (g.voices || []).length
      && (!engine || g.id === engine));
    let html = '<option value="">（未配置）</option>';
    let found = false;
    groups.forEach(g => {
      html += `<optgroup label="${esc(g.name || g.id)}">`;
      (g.voices || []).forEach(v => {
        const sel = v.voice_id === current ? ' selected' : '';
        if (sel) found = true;
        const origin = v.derived && v.base_name
          ? ` = ${v.base_name}${v.rate ? ` 语速${v.rate >= 0 ? '+' : ''}${v.rate}%` : ''}${v.pitch ? ` 音调${v.pitch >= 0 ? '+' : ''}${v.pitch}` : ''}`
          : '';
        html += `<option value="${esc(v.voice_id)}"${sel}>${esc((v.label || v.name || v.voice_id) + origin)}</option>`;
      });
      html += '</optgroup>';
    });
    if (current && !found) html += `<option value="${esc(current)}" selected>${esc(current)}（当前）</option>`;
    return html;
  }

  function engineOptionHtml(cur) {
    const opts = [['', '跟随默认'], ['edge', 'Edge TTS（在线）'], ['onecore', '本机 Windows 语音（离线）']];
    return opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function renderVoices() {
    const pane = document.getElementById('sm-pane-voices');
    if (!pane) return;
    if (!charVoiceCache.length) {
      pane.innerHTML = '<div class="table-empty">还没有人物：到「人物管理」先建角色</div>';
      return;
    }
    const rows = charVoiceCache.map(c => {
      const gLabel = { male: '男', female: '女', unknown: '未指定' }[c.gender] || c.gender || '未指定';
      return `<tr data-cid="${c.id}">
        <td><b>${esc(c.name)}</b> <span class="tag tag-npc">${esc(gLabel)}</span></td>
        <td style="min-width:150px"><select class="cv-engine" data-cid="${c.id}">${engineOptionHtml(c.tts_engine)}</select></td>
        <td style="min-width:230px"><select class="cv-voice" data-cid="${c.id}">${voiceOptionHtml(c.tts_engine, c.tts_voice)}</select></td>
        <td style="min-width:120px"><input type="range" class="cv-rate" data-cid="${c.id}" min="-50" max="50" value="${c.tts_rate || 0}">
          <b class="cv-rate-v" style="color:var(--gold);font-size:11px">${c.tts_rate || 0}%</b></td>
        <td style="min-width:120px"><input type="range" class="cv-pitch" data-cid="${c.id}" min="-30" max="30" value="${c.tts_pitch || 0}">
          <b class="cv-pitch-v" style="color:var(--gold);font-size:11px">${c.tts_pitch || 0}%</b></td>
        <td style="min-width:120px"><input type="range" class="cv-volume" data-cid="${c.id}" min="-50" max="50" value="${c.tts_volume || 0}">
          <b class="cv-volume-v" style="color:var(--gold);font-size:11px">${c.tts_volume || 0}%</b></td>
        <td style="white-space:nowrap">
          <button class="btn btn-outline btn-sm cv-preview" data-cid="${c.id}">试听</button>
          <button class="btn btn-gold btn-sm cv-save" data-cid="${c.id}">保存</button>
        </td>
      </tr>`;
    }).join('');

    pane.innerHTML = `
      <div class="sm-pane-head">
        专为每个人物配「说话的声音」：引擎 + 音色 + 语速/音调/音量。<br>
        人物管理里的「语音」页已并入这里 —— 语音任务、剧情对话批量生成都会自动沿用这套配置。<br>
        派生声线（角色声线组）= 用语速/音调在基础音色上派生，来源已标注在音色名后面。
      </div>
      <div class="table-container">
        <table style="width:100%">
          <thead><tr>
            <th>人物</th><th>引擎</th><th>音色</th><th>语速</th><th>音调</th><th>音量</th><th>操作</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // 引擎切换 → 重建音色下拉
    pane.querySelectorAll('.cv-engine').forEach(sel => {
      sel.addEventListener('change', () => {
        const cid = sel.dataset.cid;
        const voiceSel = pane.querySelector(`.cv-voice[data-cid="${cid}"]`);
        if (voiceSel) voiceSel.innerHTML = voiceOptionHtml(sel.value, (charVoiceCache.find(c => String(c.id) === cid) || {}).tts_voice);
      });
    });
    // 滑杆数值
    ['rate', 'pitch', 'volume'].forEach(k => {
      pane.querySelectorAll('.cv-' + k).forEach(el => {
        el.addEventListener('input', () => {
          const v = pane.querySelector(`.cv-${k}-v[data-cid="${el.dataset.cid}"]`);
          if (v) v.textContent = el.value + '%';
        });
      });
    });
    // 试听：用当前行配置直接合成
    pane.querySelectorAll('.cv-preview').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = parseInt(btn.dataset.cid, 10);
        const row = pane.querySelector(`tr[data-cid="${cid}"]`);
        const ch = charVoiceCache.find(c => c.id === cid);
        const body = {
          text: '前方似有埋伏，公子小心。',
          engine_id: row.querySelector('.cv-engine').value || '',
          voice_id: row.querySelector('.cv-voice').value || null,
          rate: parseInt(row.querySelector('.cv-rate').value, 10) || 0,
          pitch: parseInt(row.querySelector('.cv-pitch').value, 10) || 0,
          volume: parseInt(row.querySelector('.cv-volume').value, 10) || 0,
          gender: (ch && ch.gender) || 'unknown',
        };
        btn.disabled = true;
        try {
          const r = await Admin.post('/tts/synth', body);
          if (r.error) { Admin.toast('合成失败：' + r.error, 'error'); return; }
          if (window.__cvAudio) { try { window.__cvAudio.pause(); } catch (_) {} }
          window.__cvAudio = new Audio(r.url);
          await window.__cvAudio.play();
        } catch (e) { Admin.toast('试听失败：' + e.message, 'error'); }
        finally { btn.disabled = false; }
      });
    });
    // 保存：写回人物角色
    pane.querySelectorAll('.cv-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = parseInt(btn.dataset.cid, 10);
        const row = pane.querySelector(`tr[data-cid="${cid}"]`);
        const ch = charVoiceCache.find(c => c.id === cid);
        btn.disabled = true;
        try {
          await Admin.put(`/characters/${cid}`, {
            tts_engine: row.querySelector('.cv-engine').value || null,
            tts_voice: row.querySelector('.cv-voice').value || null,
            tts_rate: parseInt(row.querySelector('.cv-rate').value, 10) || 0,
            tts_pitch: parseInt(row.querySelector('.cv-pitch').value, 10) || 0,
            tts_volume: parseInt(row.querySelector('.cv-volume').value, 10) || 0,
          });
          if (ch) {
            ch.tts_engine = row.querySelector('.cv-engine').value;
            ch.tts_voice = row.querySelector('.cv-voice').value;
            ch.tts_rate = parseInt(row.querySelector('.cv-rate').value, 10) || 0;
            ch.tts_pitch = parseInt(row.querySelector('.cv-pitch').value, 10) || 0;
            ch.tts_volume = parseInt(row.querySelector('.cv-volume').value, 10) || 0;
          }
          Admin.toast(`「${ch ? ch.name : cid}」的语音配置已保存`, 'success');
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
        finally { btn.disabled = false; }
      });
    });
  }

  // ==================================================================
  // 语音包：语音任务列表（语音包 = 多条声音 + 参数配置的复合单元）
  // ==================================================================
  async function loadPacks() {
    const pane = document.getElementById('sm-pane-packs');
    if (!pane) return;
    pane.innerHTML = '<div class="table-empty">加载中…</div>';
    try { packCache = await Admin.get('/voice-tasks/'); } catch (_) { packCache = []; }
    renderPacks();
  }

  function renderPacks() {
    const pane = document.getElementById('sm-pane-packs');
    if (!pane) return;
    if (!packCache.length) {
      pane.innerHTML = `
        <div class="sm-pane-head">语音包 = 一批台词 + 一套语音参数配置（引擎/音色/语速等），跑一次把整批都生成好。</div>
        <div class="table-empty">还没有语音包，点右上「+ 新建语音包」，或去「语音任务」页新建</div>`;
      bindPackToolbar(pane);
      return;
    }
    const cards = packCache.map(t => {
      const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
      const stLabel = ({ pending: '待处理', idle: '待运行', running: '运行中', done: '已完成', error: '出错', stopped: '已停止' })[t.status] || t.status;
      return `<div class="vt-card" data-id="${t.id}" title="点击打开语音包">
        <h3>${t.running ? '<span style="color:var(--gold)">●</span>' : ''}${esc(t.name)}</h3>
        <div class="vt-meta">
          ${t.character_name ? `<div>谁的声音：${esc(t.character_name)}</div>` : ''}
          <div>声音包分类：${esc(t.pack_path || '角色语音')} · ${t.done}/${t.total} 条</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span class="vt-st ${t.status}">${stLabel}</span>
            <span>${t.total ? pct + '%' : ''}</span>
            <span style="flex:1"></span>
            <button class="btn btn-gold btn-sm pk-open" data-id="${t.id}">打开</button>
          </div>
        </div>
        <div class="vt-prog"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
    pane.innerHTML = `
      <div class="sm-pane-head">语音包 = 一批台词 + 一套语音参数配置（引擎/音色/语速等），跑一次把整批生成好；
        产物自动进上面的「声音库」。点「打开」进入语音包编辑弹窗。</div>
      <div class="vt-grid">${cards}</div>`;
    bindPackToolbar(pane);
    pane.querySelectorAll('.pk-open, .vt-card').forEach(el => {
      const id = parseInt(el.dataset.id, 10);
      el.addEventListener('click', (e) => {
        if (e.target.closest('.pk-open')) e.stopPropagation();
        openPackModal(id);
      });
    });
  }

  function bindPackToolbar(pane) {
    let tb = pane.querySelector('.pk-toolbar');
    if (!tb) {
      tb = document.createElement('div');
      tb.className = 'pk-toolbar';
      tb.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap';
      tb.innerHTML = `
        <span style="font-size:15px;font-weight:600">语音包</span>
        <span style="font-size:12px;color:var(--text-muted)">（语音任务）</span>
        <span style="flex:1"></span>
        <button class="btn btn-outline btn-sm" id="pk-refresh">↻ 刷新</button>
        <button class="btn btn-primary btn-sm" id="pk-new">+ 新建语音包</button>`;
      pane.prepend(tb);
    }
    tb.querySelector('#pk-refresh')?.addEventListener('click', loadPacks);
    tb.querySelector('#pk-new')?.addEventListener('click', newPackModal);
  }

  // 从声音管理打开语音包：复用语音任务页的弹窗
  function openPackModal(id) {
    if (typeof window.OpenVoiceTask === 'function') {
      window.OpenVoiceTask(id);
    } else {
      Admin.toast('语音任务模块未加载，正在跳转…', 'info');
      setTimeout(() => Admin.navigate('voice_tasks'), 300);
    }
  }

  function newPackModal() {
    Admin.showModal('新建语音包', `
      <div class="form-group"><label>语音包名称</label>
        <input id="np-name" placeholder="例如：小小 · 第一章台词"></div>
      <div class="form-group"><label>谁的声音（可选，留空默认引擎）</label>
        <select id="np-char"><option value="0">（不绑定人物）</option>
          ${(charVoiceCache || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
        </select></div>
    `, async () => {
      const cid = parseInt(document.getElementById('np-char').value, 10) || 0;
      const ch = (charVoiceCache || []).find(c => c.id === cid);
      const body = {
        name: (document.getElementById('np-name').value || '').trim() || '未命名语音包',
        character_id: cid,
        pack_path: ch ? '角色语音/' + ch.name : '角色语音',
      };
      const t = await Admin.post('/voice-tasks/', body);
      Admin.toast('语音包已创建', 'success');
      await loadPacks();
      openPackModal(t.id);
    });
  }

  // ==================================================================
  container.innerHTML = '<div class="table-empty">加载中...</div>';
  initLayout();
  await load();
});
