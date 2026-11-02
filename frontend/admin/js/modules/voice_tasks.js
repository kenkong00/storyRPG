// ========== 语音任务（语音包）：进页面直接就是语音包列表，点开用弹窗 ==========
//
// 一屏只干一件事：
//   · 进来看到所有「语音包」（任务）的卡片列表 —— 谁的声音、声音包分类、进度、状态；
//   · 点卡片弹窗打开：配置（引擎/音色/语速/音调/音量）、试听、运行/停止/只重跑失败/
//     全部重新生成（用当前配置把已生成的也全部重跑）、台词行增删改 + 批量删除；
//   · 生成好的音频进「声音管理 → 声音库」（category=voice，分类=pack_path）。
//
// 弹窗逻辑放在模块级（IIFE），「声音管理 → 语音包」页也可以直接打开同一个弹窗：
//   window.OpenVoiceTask(id) / window.RefreshVoiceTaskList()
(function () {
  const S = {
    list: [], curId: 0, detail: null,
    chars: [], groups: [], picked: new Set(),
    timer: 0, audio: null, modalOpen: false,
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function injectStyle() {
    if (document.getElementById('vt-style')) return;
    const st = document.createElement('style');
    st.id = 'vt-style';
    st.textContent = `
      .vt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
      .vt-card{border:1px solid var(--border);border-radius:10px;background:var(--bg-card);padding:14px 16px;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s}
      .vt-card:hover{border-color:var(--gold);box-shadow:0 2px 10px rgba(0,0,0,.25)}
      .vt-card .vt-cb-box{position:absolute;top:10px;right:10px}
      .vt-card h3{margin:0 0 6px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}
      .vt-card .vt-meta{font-size:11.5px;color:var(--text-muted);line-height:1.8}
      .vt-prog{height:7px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden;margin:9px 0 7px}
      .vt-prog i{display:block;height:100%;background:linear-gradient(90deg,#2f9c54,#c9a84c);transition:width .3s}
      .vt-st{font-size:11px;padding:1px 8px;border-radius:10px;white-space:nowrap}
      .vt-st.pending,.vt-st.idle{background:rgba(255,255,255,.07);color:var(--text-muted)}
      .vt-st.running{background:rgba(201,168,76,.18);color:var(--gold)}
      .vt-st.done{background:rgba(47,156,84,.18);color:#6ddc94}
      .vt-st.error{background:rgba(224,92,92,.16);color:#ff9b9b}
      .vt-st.stopped{background:rgba(255,255,255,.08);color:#d0d0d0}
      .vt-empty{padding:30px;text-align:center;color:var(--text-muted);font-size:13px}
      .vt-sec{margin-bottom:16px}
      .vt-sec-h{font-size:12px;font-weight:600;color:var(--gold);letter-spacing:.06em;margin-bottom:8px;
        display:flex;align-items:center;gap:8px}
      .vt-sec-h::after{content:'';flex:1;height:1px;background:var(--border)}
      .vt-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
      .vt-f{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--text-muted)}
      .vt-f input,.vt-f select{padding:6px 9px;background:var(--bg-input);border:1px solid var(--border);
        border-radius:6px;color:var(--text-primary);font-size:13px}
      .vt-f input[type=range]{padding:0;width:130px}
      .vt-ta{width:100%;box-sizing:border-box;min-height:64px;padding:8px 10px;background:var(--bg-input);
        border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;line-height:1.7;resize:vertical}
      .vt-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
      .vt-tbl th{text-align:left;font-weight:600;color:var(--text-muted);font-size:11px;padding:6px 8px;
        border-bottom:1px solid var(--border);white-space:nowrap}
      .vt-tbl td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.045);vertical-align:middle}
      .vt-tbl tr:hover td{background:rgba(255,255,255,.025)}
      .vt-txt{max-width:520px;line-height:1.6}
      .vt-txt .vt-inline{width:100%;box-sizing:border-box;padding:5px 7px;background:var(--bg-input);
        border:1px solid var(--border);border-radius:5px;color:var(--text-primary);font-size:12.5px}
      .vt-hint{font-size:11.5px;color:var(--text-muted);line-height:1.7;margin-top:6px}
    `;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- 基础
  async function ensureBase() {
    if (!S.chars.length) {
      try { S.chars = await Admin.get('/characters/'); } catch (_) { S.chars = []; }
    }
    if (!S.groups.length) {
      try { const r = await Admin.get('/tts/voices?grouped=true'); S.groups = (r && r.groups) || r || []; } catch (_) { S.groups = []; }
    }
  }

  async function loadList() {
    S.list = await Admin.get('/voice-tasks/');
    renderList();
  }

  function statusLabel(st) {
    return { pending: '待处理', idle: '待运行', running: '运行中', done: '已完成', error: '出错', stopped: '已停止' }[st] || st;
  }

  function renderList() {
    const box = document.getElementById('vt-list');
    if (!box) return;
    if (!S.list.length) {
      box.innerHTML = '<div class="vt-empty">还没有语音包<br><span style="font-size:11px">点右上「+ 新建语音包」开始，或到「声音管理」里建</span></div>';
      return;
    }
    box.innerHTML = `<div class="vt-grid">` + S.list.map((t) => {
      const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
      return `<div class="vt-card" data-id="${t.id}" title="点击打开这个语音包">
        <label class="vt-cb-box" title="勾选后可批量删除" onclick="event.stopPropagation()">
          <input type="checkbox" class="vt-task-cb" data-id="${t.id}">
        </label>
        <h3>${t.running ? '<span style="color:var(--gold)">●</span>' : ''}${esc(t.name)}</h3>
        <div class="vt-meta">
          ${t.character_name ? `<div>谁的声音：${esc(t.character_name)}</div>` : ''}
          <div>声音包分类：${esc(t.pack_path || '角色语音')}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span class="vt-st ${t.status}">${statusLabel(t.status)}</span>
            <span>${t.done}/${t.total} 条${t.total ? ' · ' + pct + '%' : ''}</span>
          </div>
        </div>
        <div class="vt-prog"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('') + `</div>`;
    box.querySelectorAll('.vt-card').forEach((el) => {
      el.addEventListener('click', () => openTask(parseInt(el.dataset.id, 10)));
    });
  }

  // ---------------------------------------------------------------- 语音主播下拉
  function voiceOptions(engine, current) {
    const groups = (S.groups || []).filter((g) => (g.voices || []).length
      && (!engine || g.id === engine));
    let html = '<option value="">（跟随人物配置 / 引擎默认）</option>';
    let found = false;
    groups.forEach((g) => {
      html += `<optgroup label="${esc(g.name || g.id)}">`;
      (g.voices || []).forEach((v) => {
        const sel = v.voice_id === current ? ' selected' : '';
        if (sel) found = true;
        // 派生声线 = 基础音色变调（如「苍老长者=康康降调」），来源写进选项避免误解
        const origin = v.derived && v.base_name
          ? ` = ${v.base_name}${v.rate ? ` 语速${v.rate >= 0 ? '+' : ''}${v.rate}%` : ''}${v.pitch ? ` 音调${v.pitch >= 0 ? '+' : ''}${v.pitch}` : ''}`
          : '';
        const nm = (v.label || v.name || v.voice_id) + origin;
        html += `<option value="${esc(v.voice_id)}"${sel}>${esc(nm)}</option>`;
      });
      html += '</optgroup>';
    });
    if (current && !found) html += `<option value="${esc(current)}" selected>${esc(current)}（当前）</option>`;
    return html;
  }

  function engineOptions(cur) {
    const opts = [['', '跟随人物配置'], ['edge', 'Edge TTS（在线）'], ['onecore', '本机 Windows 语音（离线）']];
    return opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }

  // ---------------------------------------------------------------- 弹窗
  async function openTask(id) {
    stopPoll();
    S.curId = id;
    S.picked.clear();
    S.detail = await Admin.get(`/voice-tasks/${id}`);
    S.modalOpen = true;
    renderModal();
    if (S.detail.running) startPoll();
  }

  function closeTask() {
    S.modalOpen = false;
    S.curId = 0;
    S.detail = null;
    S.picked.clear();
  }

  function renderModal() {
    const d = S.detail;
    if (!d) return;
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    const charOpts = ['<option value="0">（不绑定人物）</option>'].concat(
      (S.chars || []).map((c) => `<option value="${c.id}"${c.id === d.character_id ? ' selected' : ''}>${esc(c.name)}</option>`)
    ).join('');

    const body = `
      <div class="vt-sec">
        <div class="vt-row">
          <label class="vt-f">语音包名称
            <input id="vt-name" value="${esc(d.name)}" style="min-width:200px">
          </label>
          <label class="vt-f">谁的声音
            <select id="vt-char" style="min-width:150px">${charOpts}</select>
          </label>
          <label class="vt-f">声音包分类
            <input id="vt-pack" value="${esc(d.pack_path)}" placeholder="角色语音/角色名" style="min-width:180px">
          </label>
          <label class="vt-f">名称取前几个字
            <input id="vt-namelen" type="number" min="2" max="20" value="${d.name_len || 8}" style="width:80px">
          </label>
          <div style="flex:1"></div>
          <button class="btn btn-danger btn-sm" id="vt-del">删除语音包</button>
        </div>
      </div>

      <div class="vt-sec">
        <div class="vt-sec-h">语音主播（留空就沿用「声音管理 → 角色语音配置」里这个人物的声音）</div>
        <div class="vt-row">
          <label class="vt-f">语音引擎
            <select id="vt-engine" style="min-width:180px">${engineOptions(d.engine)}</select>
          </label>
          <label class="vt-f">音色
            <select id="vt-voice" style="min-width:250px">${voiceOptions(d.engine, d.voice_id)}</select>
          </label>
        </div>
        <div class="vt-row" style="margin-top:10px">
          <label class="vt-f">语速 <b id="vt-rate-v" style="color:var(--gold)">${d.rate || 0}%</b>
            <input type="range" id="vt-rate" min="-50" max="50" value="${d.rate || 0}">
          </label>
          <label class="vt-f">音调 <b id="vt-pitch-v" style="color:var(--gold)">${d.pitch || 0}%</b>
            <input type="range" id="vt-pitch" min="-30" max="30" value="${d.pitch || 0}">
          </label>
          <label class="vt-f">音量 <b id="vt-volume-v" style="color:var(--gold)">${d.volume || 0}%</b>
            <input type="range" id="vt-volume" min="-50" max="50" value="${d.volume || 0}">
          </label>
          <div style="flex:1"></div>
          <input id="vt-preview-text" value="前方似有埋伏，公子小心。"
            style="padding:6px 9px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);min-width:220px">
          <button class="btn btn-outline btn-sm" id="vt-preview">试听</button>
          <button class="btn btn-outline btn-sm" id="vt-preview-stop" disabled>停止</button>
        </div>
      </div>

      <div class="vt-sec">
        <div class="vt-sec-h">运行</div>
        <div class="vt-row">
          <button class="btn btn-primary btn-sm" id="vt-run">▶ 批量运行</button>
          <button class="btn btn-outline btn-sm" id="vt-rerun">↻ 只重跑失败的</button>
          <button class="btn btn-outline btn-sm" id="vt-rerun-sel" disabled title="先在下面的台词表勾选几条，点这个只重跑选中的那几条">↻ 重跑选中</button>
          <button class="btn btn-gold btn-sm" id="vt-rerun-all" title="无需勾选：用当前这套配置把整个语音包从头到尾全部重新生成">⟳ 全部重新生成</button>
          <button class="btn btn-outline btn-sm" id="vt-stop" ${d.running ? '' : 'disabled'}>⏹ 停止</button>
          <div class="vt-prog"><i style="width:${pct}%"></i></div>
          <span style="font-size:12px;color:var(--text-muted)" id="vt-msg">${esc(d.message || '')}</span>
        </div>
        <div class="vt-hint">
          运行前会把「添加内容」输入框里还没进列表的台词自动加进来。
          只想换几条的声音：勾选那几条 → 点「↻ 重跑选中」；整包用新配置重来一遍就点「⟳ 全部重新生成」（不用勾选）。
        </div>
      </div>

      <div class="vt-sec">
        <div class="vt-sec-h">台词内容（${d.lines.length} 条 · 已选 <b id="vt-picked">0</b>）</div>
        <textarea class="vt-ta" id="vt-addtext" placeholder="一行一条台词，粘贴多行会自动拆成多条：
「你终于来了。」
「这一剑，我等了三年。」"></textarea>
        <div class="vt-row" style="margin-top:8px">
          <button class="btn btn-outline btn-sm" id="vt-add">+ 添加这些内容</button>
          <button class="btn btn-outline btn-sm" id="vt-delsel" disabled>删除选中</button>
          <button class="btn btn-outline btn-sm" id="vt-clearsel" disabled>取消选择</button>
          <div style="flex:1"></div>
          <span style="font-size:11.5px;color:var(--text-muted)">点台词即可就地改；改过的条目会退回「待处理」</span>
        </div>
        <div style="margin-top:10px;max-height:42vh;overflow:auto">
          <table class="vt-tbl">
            <thead><tr>
              <th style="width:30px"><input type="checkbox" id="vt-checkall" title="全选"></th>
              <th style="width:40px">#</th>
              <th>内容</th>
              <th style="width:70px">状态</th>
              <th style="width:60px">时长</th>
              <th style="width:120px">操作</th>
            </tr></thead>
            <tbody id="vt-rows"></tbody>
          </table>
        </div>
      </div>
    `;

    Admin.showModal(`语音包：${esc(d.name)}`, body, async () => {
      // 点「保存」= 关掉弹窗回列表（用户预期：保存即关闭）
      Admin.closeModal();
      closeTask();
      await loadList();
    }, { size: 'xl' });
    renderRows();
    bindDetail();
  }

  function renderRows() {
    const tbody = document.getElementById('vt-rows');
    if (!tbody || !S.detail) return;
    const lines = S.detail.lines || [];
    if (!lines.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="vt-empty">还没有内容，把台词贴到上面点「添加这些内容」</td></tr>';
      return;
    }
    tbody.innerHTML = lines.map((l, i) => {
      const st = l.status || 'pending';
      const stLabel = statusLabel(st);
      const snd = l.sound || {};
      const playable = snd.url ? `<button class="btn btn-outline btn-sm" data-play="${esc(snd.url)}" style="padding:1px 7px;font-size:11px">▶</button>` : '';
      const errTip = l.error ? ` title="${esc(l.error)}"` : '';
      return `<tr data-line="${l.id}">
        <td><input type="checkbox" class="vt-cb" data-id="${l.id}" ${S.picked.has(l.id) ? 'checked' : ''}></td>
        <td style="color:var(--text-muted)">${i + 1}</td>
        <td class="vt-txt"><div data-text="${l.id}" style="cursor:text">${esc(l.text)}</div></td>
        <td><span class="vt-st ${st}"${errTip}>${stLabel}</span></td>
        <td style="color:var(--text-muted)">${l.duration ? l.duration.toFixed(2) + 's' : '—'}</td>
        <td>
          ${playable}
          ${snd.id ? `<button class="btn btn-outline btn-sm" data-edit-sound="${snd.id}" style="padding:1px 7px;font-size:11px">编辑</button>` : ''}
          <button class="btn btn-outline btn-sm" data-del="${l.id}" style="padding:1px 7px;font-size:11px;color:var(--red);border-color:var(--red)">删</button>
        </td>
      </tr>`;
    }).join('');
    bindRows();
    updatePicked();
  }

  function updatePicked() {
    const n = S.picked.size;
    const el = document.getElementById('vt-picked');
    if (el) el.textContent = String(n);
    ['vt-delsel', 'vt-clearsel', 'vt-rerun-sel'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = n === 0;
    });
  }

  function bindRows() {
    const tbody = document.getElementById('vt-rows');
    if (!tbody) return;
    tbody.querySelectorAll('.vt-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id, 10);
        if (cb.checked) S.picked.add(id); else S.picked.delete(id);
        updatePicked();
      });
    });
    tbody.querySelectorAll('[data-play]').forEach((b) => {
      b.addEventListener('click', () => playUrl(b.dataset.play));
    });
    tbody.querySelectorAll('[data-edit-sound]').forEach((b) => {
      b.addEventListener('click', () => openSoundEditor(parseInt(b.dataset.editSound, 10)));
    });
    tbody.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', () => delLines([parseInt(b.dataset.del, 10)]));
    });
    tbody.querySelectorAll('[data-text]').forEach((div) => {
      div.addEventListener('click', () => startEditText(div));
    });
  }

  function startEditText(div) {
    if (div.querySelector('input')) return;
    const id = parseInt(div.dataset.text, 10);
    const line = (S.detail.lines || []).find((x) => x.id === id);
    if (!line) return;
    const old = line.text;
    div.innerHTML = `<input class="vt-inline" value="${esc(old)}">`;
    const inp = div.querySelector('input');
    inp.focus();
    inp.select();
    const commit = async () => {
      const val = inp.value.trim();
      if (!val || val === old) { div.textContent = old; return; }
      try {
        await Admin.put(`/voice-tasks/${S.curId}/lines/${id}`, { text: val });
        await openTask(S.curId);
        Admin.toast('已保存，这条退回待处理', 'success');
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); div.textContent = old; }
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = old; inp.blur(); }
    });
  }

  // ---------------------------------------------------------------- 音频
  function playUrl(url) {
    if (S.audio) { try { S.audio.pause(); } catch (_) {} }
    S.audio = new Audio(url);
    S.audio.play().catch(() => Admin.toast('播放失败', 'error'));
  }

  async function openSoundEditor(soundId) {
    try {
      const s = await Admin.get(`/sounds/${soundId}`);
      Admin.showModal('编辑声音', `
        <div class="form-group"><label>名称</label><input id="vs-name" value="${esc(s.name)}"></div>
        <div class="form-group"><label>分类路径</label><input id="vs-path" value="${esc(s.category_path || '')}"></div>
        <div class="form-group"><label>台词 / 说明</label>
          <textarea id="vs-desc" rows="4" style="width:100%">${esc(s.description || '')}</textarea></div>
        <div style="font-size:12px;color:var(--text-muted)">文件：${esc(s.file_url)}</div>
        <audio controls src="${esc(s.file_url)}" style="width:100%;margin-top:8px"></audio>
      `, async () => {
        await Admin.put(`/sounds/${soundId}`, {
          name: document.getElementById('vs-name').value.trim(),
          category_path: document.getElementById('vs-path').value.trim(),
          description: document.getElementById('vs-desc').value,
        });
        Admin.toast('已保存', 'success');
        if (S.curId) await openTask(S.curId);
      });
    } catch (e) { Admin.toast('打不开这条声音：' + e.message, 'error'); }
  }

  // ---------------------------------------------------------------- 轮询
  function stopPoll() { if (S.timer) { clearTimeout(S.timer); S.timer = 0; } }

  function startPoll() {
    stopPoll();
    const tick = async () => {
      if (!S.curId) return;
      try {
        const p = await Admin.get(`/voice-tasks/${S.curId}/progress`);
        if (S.detail) {
          S.detail.running = p.running;
          S.detail.status = p.status;
          S.detail.done = p.done;
          S.detail.total = p.total;
          S.detail.message = p.message;
          S.detail.lines = p.lines.map((nl) => {
            const old = (S.detail.lines || []).find((x) => x.id === nl.id) || {};
            return Object.assign({}, old, nl);
          });
          if (S.modalOpen) {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
            const bar = document.querySelector('.modal-body .vt-prog i');
            if (bar) bar.style.width = pct + '%';
            const msg = document.getElementById('vt-msg');
            if (msg) msg.textContent = p.message || '';
            renderRows();
          }
        }
        const hit = S.list.find((x) => x.id === S.curId);
        if (hit) { hit.done = p.done; hit.total = p.total; hit.status = p.status; hit.running = p.running; }
        renderList();
        if (p.running) S.timer = setTimeout(tick, 1200);
        else {
          S.timer = 0;
          if (S.curId && S.modalOpen) await openTask(S.curId);  // 跑完拉一次完整数据（带音频 url）
          else await loadList();
        }
      } catch (_) { S.timer = setTimeout(tick, 2500); }
    };
    S.timer = setTimeout(tick, 800);
  }

  // ---------------------------------------------------------------- 动作
  // 运行前把「添加内容」输入框里还没进列表的台词自动加进去，返回加了几条
  async function addPendingText() {
    const el = document.getElementById('vt-addtext');
    const raw = (el && el.value ? el.value : '').trim();
    if (!raw) return 0;
    const r = await Admin.post(`/voice-tasks/${S.curId}/lines`, { text: raw });
    if (el) el.value = '';
    return r.added || 0;
  }

  async function saveTask(patch) {
    if (!S.curId) return;
    const r = await Admin.put(`/voice-tasks/${S.curId}`, patch);
    S.detail = Object.assign(S.detail || {}, r);
    const hit = S.list.find((x) => x.id === S.curId);
    if (hit) Object.assign(hit, r);
    renderList();
    return r;
  }

  async function delLines(ids) {
    if (!ids.length) return;
    if (!await Admin.confirm(`删除选中的 ${ids.length} 条内容？已生成的音频不会跟着删。`)) return;
    await Admin.post(`/voice-tasks/${S.curId}/lines/delete`, { ids });
    ids.forEach((i) => S.picked.delete(i));
    Admin.toast('已删除', 'success');
    await openTask(S.curId);
  }

  function bindDetail() {
    const g = (id) => document.getElementById(id);

    g('vt-name')?.addEventListener('change', () => saveTask({ name: g('vt-name').value.trim() || '未命名语音任务' }));
    g('vt-namelen')?.addEventListener('change', () => saveTask({ name_len: parseInt(g('vt-namelen').value, 10) || 8 }));
    g('vt-pack')?.addEventListener('change', () => saveTask({ pack_path: g('vt-pack').value.trim() }));
    g('vt-char')?.addEventListener('change', async () => {
      const id = parseInt(g('vt-char').value, 10) || 0;
      const ch = (S.chars || []).find((c) => c.id === id);
      const patch = { character_id: id };
      if (ch && (!g('vt-pack').value.trim() || /^角色语音\//.test(g('vt-pack').value.trim()))) {
        patch.pack_path = '角色语音/' + ch.name;
        g('vt-pack').value = patch.pack_path;
      }
      await saveTask(patch);
    });
    g('vt-engine')?.addEventListener('change', async () => {
      const v = g('vt-engine').value;
      g('vt-voice').innerHTML = voiceOptions(v, S.detail.voice_id);
      await saveTask({ engine: v });
    });
    g('vt-voice')?.addEventListener('change', () => saveTask({ voice_id: g('vt-voice').value }));
    ['rate', 'pitch', 'volume'].forEach((k) => {
      const el = g('vt-' + k);
      if (!el) return;
      el.addEventListener('input', () => {
        const out = g(`vt-${k}-v`);
        if (out) out.textContent = el.value + '%';
      });
      el.addEventListener('change', () => saveTask({ [k]: parseInt(el.value, 10) || 0 }));
    });

    g('vt-preview')?.addEventListener('click', async () => {
      const d = S.detail;
      if (!d) { Admin.toast('数据未就绪，请重新打开这个语音包再试听', 'error'); return; }
      const text = (g('vt-preview-text').value || '').trim();
      if (!text) return;
      const btn = g('vt-preview');
      const stopBtn = g('vt-preview-stop');
      btn.disabled = true;
      try {
        const r = await Admin.post('/tts/synth', {
          text,
          engine_id: g('vt-engine').value || '',
          voice_id: g('vt-voice').value || null,
          rate: parseInt(g('vt-rate').value, 10) || 0,
          pitch: parseInt(g('vt-pitch').value, 10) || 0,
          volume: parseInt(g('vt-volume').value, 10) || 0,
          gender: ((S.chars || []).find((c) => c.id === d.character_id) || {}).gender || 'unknown',
        });
        if (r.error) { Admin.toast('合成失败：' + r.error, 'error'); return; }
        if (S.audio) { try { S.audio.pause(); } catch (_) {} }
        S.audio = new Audio(r.url);
        stopBtn.disabled = false;
        S.audio.onended = () => { stopBtn.disabled = true; };
        await S.audio.play();
      } catch (e) { Admin.toast('试听失败：' + e.message, 'error'); }
      finally { btn.disabled = false; }
    });
    g('vt-preview-stop')?.addEventListener('click', () => {
      if (S.audio) { try { S.audio.pause(); S.audio.currentTime = 0; } catch (_) {} }
      g('vt-preview-stop').disabled = true;
    });

    g('vt-run')?.addEventListener('click', async () => {
      try {
        const added = await addPendingText();
        if (added) Admin.toast(`先把输入框的 ${added} 条加进了列表`, 'info');
        await Admin.post(`/voice-tasks/${S.curId}/run`, {});
        S.detail.running = true;
        Admin.toast(added ? '已开始：新加的台词与待处理的一起合成' : '已开始，正在逐条处理', 'success');
        startPoll();
      } catch (e) { Admin.toast(e.message, 'error'); }
    });
    g('vt-stop')?.addEventListener('click', async () => {
      await Admin.post(`/voice-tasks/${S.curId}/stop`, {});
      Admin.toast('已请求停止（当前这条做完就停）', 'success');
    });
    g('vt-rerun')?.addEventListener('click', async () => {
      try {
        const added = await addPendingText();
        if (added) Admin.toast(`先把输入框的 ${added} 条加进了列表`, 'info');
        await Admin.post(`/voice-tasks/${S.curId}/run`, { rerun_failed: true });
        Admin.toast('正在重跑失败的条目', 'success');
        startPoll();
      } catch (e) { Admin.toast(e.message, 'error'); }
    });
    g('vt-rerun-sel')?.addEventListener('click', async () => {
      const ids = [...S.picked];
      if (!ids.length) { Admin.toast('先在台词表勾选要重跑的那几条', 'info'); return; }
      try {
        const added = await addPendingText();
        if (added) Admin.toast(`先把输入框的 ${added} 条加进了列表`, 'info');
        await Admin.post(`/voice-tasks/${S.curId}/run`, { only_ids: ids });
        S.picked.clear();
        updatePicked();
        Admin.toast(`开始重跑选中的 ${ids.length} 条`, 'success');
        startPoll();
      } catch (e) { Admin.toast(e.message, 'error'); }
    });
    g('vt-rerun-all')?.addEventListener('click', async () => {
      const total = S.detail.total || 0;
      if (!await Admin.confirm(
        `用当前这套配置「全部重新生成」？\n\n会把已生成过的 ${total} 条音频清掉，再从第一条开始用最新配置重跑一遍。`)) return;
      try {
        const added = await addPendingText();
        if (added) Admin.toast(`先把输入框的 ${added} 条加进了列表`, 'info');
        await Admin.post(`/voice-tasks/${S.curId}/run`, { rerun_all: true });
        S.detail.running = true;
        Admin.toast('已开始：全部按新配置重新生成', 'success');
        startPoll();
      } catch (e) { Admin.toast(e.message, 'error'); }
    });

    g('vt-add')?.addEventListener('click', async () => {
      const raw = (g('vt-addtext').value || '').trim();
      if (!raw) { Admin.toast('先贴点内容进来', 'error'); return; }
      try {
        const r = await Admin.post(`/voice-tasks/${S.curId}/lines`, { text: raw });
        g('vt-addtext').value = '';
        Admin.toast(`已添加 ${r.added} 条`, 'success');
        await openTask(S.curId);
      } catch (e) { Admin.toast(e.message, 'error'); }
    });

    g('vt-checkall')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      S.picked.clear();
      if (on) (S.detail.lines || []).forEach((l) => S.picked.add(l.id));
      const tbody = document.getElementById('vt-rows');
      tbody?.querySelectorAll('.vt-cb').forEach((cb) => { cb.checked = on; });
      updatePicked();
    });
    g('vt-delsel')?.addEventListener('click', () => delLines([...S.picked]));
    g('vt-clearsel')?.addEventListener('click', () => {
      S.picked.clear();
      const tbody = document.getElementById('vt-rows');
      tbody?.querySelectorAll('.vt-cb').forEach((cb) => { cb.checked = false; });
      const all = document.getElementById('vt-checkall');
      if (all) all.checked = false;
      updatePicked();
    });
    g('vt-del')?.addEventListener('click', async () => {
      if (!await Admin.confirm(
        `删除语音包「${S.detail.name}」？\n\n只删任务和这批台词；已经生成的声音保留在「声音管理 → 声音库」里，可在那边分类/批量删除。`)) return;
      await Admin.del(`/voice-tasks/${S.curId}`);
      Admin.closeModal();
      closeTask();
      Admin.toast('语音包已删除', 'success');
      await loadList();
    });
  }

  // ---------------------------------------------------------------- 新建
  async function newTask() {
    await ensureBase();
    const charOpts = ['<option value="0">（不绑定人物）</option>'].concat(
      (S.chars || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    ).join('');
    Admin.showModal('新建语音包', `
      <div class="form-group"><label>语音包名称</label>
        <input id="nt-name" placeholder="例如：小小 · 第一章台词"></div>
      <div class="form-group"><label>谁的声音</label>
        <select id="nt-char">${charOpts}</select>
        <small style="color:var(--text-muted);font-size:11px">选定后音色/语速会自动沿用「声音管理 → 角色语音配置」里这个人物的声音</small></div>
      <div class="form-group"><label>先贴一批台词（可留空，之后在弹窗里再加）</label>
        <textarea id="nt-texts" rows="6" placeholder="一行一条"></textarea></div>
    `, async () => {
      const cid = parseInt(document.getElementById('nt-char').value, 10) || 0;
      const ch = (S.chars || []).find((c) => c.id === cid);
      const body = {
        name: (document.getElementById('nt-name').value || '').trim()
          || ((ch ? ch.name : '语音') + ' · 语音任务'),
        character_id: cid,
        pack_path: ch ? '角色语音/' + ch.name : '角色语音',
        texts: document.getElementById('nt-texts').value || '',
      };
      const t = await Admin.post('/voice-tasks/', body);
      Admin.toast('语音包已创建', 'success');
      await loadList();
      await openTask(t.id);
    });
  }

  // 批量删除语音包（列表卡片勾选）
  async function batchDeleteTasks() {
    const ids = [...document.querySelectorAll('.vt-task-cb:checked')].map((cb) => parseInt(cb.dataset.id, 10));
    if (!ids.length) { Admin.toast('先在卡片右上角勾选要删的语音包', 'info'); return; }
    if (!await Admin.confirm(`删除选中的 ${ids.length} 个语音包？\n\n只删任务和台词；已生成的声音保留在声音库里。`)) return;
    await Admin.post('/voice-tasks/batch-delete', { ids, with_sounds: false });
    Admin.toast(`已删除 ${ids.length} 个语音包`, 'success');
    await loadList();
  }

  // 供「声音管理 → 语音包」页复用
  window.OpenVoiceTask = (id) => openTask(id);
  window.RefreshVoiceTaskList = () => loadList();

  // ---------------------------------------------------------------- 页面挂载
  Admin.registerPage('voice_tasks', async (container) => {
    injectStyle();
    container.innerHTML = `
      <div class="vt-page">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
          <span style="font-size:15px;font-weight:600">语音包列表</span>
          <span style="font-size:12px;color:var(--text-muted)">点卡片打开语音包 → 在里面配声音、加台词、运行生成；生成结果自动进「声音管理」</span>
          <div style="flex:1"></div>
          <button class="btn btn-outline btn-sm" id="vt-refresh">↻ 刷新</button>
          <button class="btn btn-outline btn-sm" id="vt-batch-del">删除选中</button>
          <button class="btn btn-primary btn-sm" id="vt-new">+ 新建语音包</button>
        </div>
        <div id="vt-list"><div class="vt-empty">加载中…</div></div>
      </div>`;

    document.getElementById('vt-new').addEventListener('click', newTask);
    document.getElementById('vt-refresh').addEventListener('click', loadList);
    document.getElementById('vt-batch-del').addEventListener('click', batchDeleteTasks);

    await ensureBase();
    await loadList();

    // 离开页面时停掉轮询
    const mo = new MutationObserver(() => {
      if (!document.body.contains(container)) { stopPoll(); mo.disconnect(); }
    });
    mo.observe(document.getElementById('content-area') || document.body, { childList: true });
  });
})();
