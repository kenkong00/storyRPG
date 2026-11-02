// ========== 场景管理（2026-11-02 重构：拼装即出图，出图即成库） ==========
// 结构变化：
//   · 不再有「场景库」标签，也不再需要新建场景 / 填基础属性 —— 选完参数直接出图；
//   · 出图结果全部落在页面下方的「场景图库」里，单击选中、双击看大图、右键菜单
//     （和「人物场景合成」的操作完全一致）；
//   · 拼装仍是两层：限定项手选（含题材预设）+ 细节元素随地点变化并被随机。
Admin.registerPage('scenes', async (container) => {
  let defs = null, themes = [];
  // appearance = 当前这套拼装；theme = 题材预设（一键套用限定项）
  const state = { appearance: {}, theme: '' };
  let promptTimer = null;
  let promptPos = '', promptNeg = '';
  let promptEdited = false;
  let genPanelMounted = false;

  // 场景图库（= 素材库里 kind=scene 的 AI 出图）
  let gallery = [];
  const gallerySel = new Set();

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  container.innerHTML = `
    <div class="sc-wrap">
      <div class="sc-tabs">
        <button class="sc-tab active" data-tab="assembly">场景拼装</button>
        <button class="sc-tab" data-tab="manage">定义管理</button>
      </div>

      <div class="sc-pane active" id="sc-pane-assembly">
        <div id="sc-gen-params" style="margin-bottom:10px"></div>

        <!-- 操作行：[随机一套] 紧挨在 [按当前配置出图] 左边 -->
        <div class="sc-toolbar" style="margin-bottom:10px">
          <button class="sc-btn" id="sc-random">🎲 随机一套</button>
          <button class="sc-btn primary" id="sc-render">🖼 按当前配置出图</button>
          <span id="sc-render-status" style="font-size:12px;color:var(--text-muted);line-height:1.5"></span>
        </div>

        <div class="sc-assembly">
          <div class="sc-panel">
            <div class="sc-panel-h">
              <span>场景拼装维度</span>
              <span class="sp"><span style="font-size:12px;color:var(--text-muted);font-weight:400">改任意一项，右侧提示词实时更新</span></span>
            </div>
            <div class="sc-groups" id="sc-groups" style="padding:10px"></div>
          </div>

          <div class="sc-side">
            <div class="sc-panel">
              <div class="sc-panel-h"><span>场景提示词</span>
                <span class="sp">
                  <button class="sc-btn" id="sc-reset-prompt" style="font-size:11.5px;padding:3px 9px"
                    title="丢掉手改内容，按当前参数重新生成">重新生成</button>
                  <button class="sc-btn" id="sc-copy" style="font-size:11.5px;padding:3px 9px">复制</button>
                </span>
              </div>
              <textarea class="sc-prompt" id="sc-prompt" spellcheck="false"
                placeholder="提示词会显示在这里，可直接修改；出图就用这段"></textarea>
            </div>
          </div>
        </div>

        <!-- 出图结果：不再弹窗，出完就往这里追加 -->
        <div class="sc-h" id="sc-gallery-h">
          <span>场景图库 <b id="sc-gallery-count">0</b></span>
          <span id="sc-gallery-sel" class="sc-h-sel"></span>
          <span class="sp"></span>
          <span class="sc-h-tip">单击选中 · 双击看大图 · 右键菜单</span>
        </div>
        <div class="sc-gallery" id="sc-gallery"></div>
      </div>

      <div class="sc-pane" id="sc-pane-manage">
        <div class="sc-toolbar">
          <button class="sc-btn" id="sc-mg-reset">恢复默认定义</button>
          <button class="sc-btn" id="sc-dim-add">＋ 新增维度</button>
          <button class="sc-btn" id="sc-group-add">＋ 新增分组</button>
          <span style="font-size:12.5px;color:var(--text-muted)">改动立即写盘，同时影响拼装下拉与场景提示词。</span>
        </div>
        <div class="sc-split">
          <div class="sc-list" id="sc-dim-tree"></div>
          <div class="sc-panel" id="sc-dim-editor">
            <div class="sc-empty">左侧选择一个维度开始编辑</div>
          </div>
        </div>
        <div style="margin-top:14px" class="sc-panel">
          <div class="sc-panel-h"><span>题材（一键套用限定项）</span>
            <span class="sp"><button class="sc-btn" id="sc-theme-add" style="font-size:11.5px;padding:3px 10px">＋ 新增题材</button></span>
          </div>
          <div id="sc-theme-list" style="padding:9px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px"></div>
        </div>
      </div>
    </div>
  `;
  let activeDim = '';

  const $ = (id) => document.getElementById(id);

  // ==================== 通用小弹窗 ====================
  function prompt2(title, fields) {
    return new Promise((resolve) => {
      const body = fields.map(f => `
        <div style="margin-bottom:9px">
          <label style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:3px">${esc(f.label)}</label>
          ${f.type === 'textarea'
            ? `<textarea name="${f.name}" style="width:100%;min-height:70px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);padding:7px;font-size:13px">${esc(f.value || '')}</textarea>`
            : `<input name="${f.name}" value="${esc(f.value || '')}" style="width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);padding:7px;font-size:13px">`}
        </div>`).join('');
      Admin.showModal(title, body, () => {
        const data = {};
        document.querySelectorAll('.modal-body [name]').forEach(el => { data[el.name] = el.value; });
        Admin.closeModal();
        resolve(data);
      });
      setTimeout(() => {
        const b = document.querySelector('.modal-body input, .modal-body textarea');
        if (b) b.focus();
      }, 40);
    });
  }

  // ==================== Tab 切换 ====================
  function switchTab(name) {
    container.querySelectorAll('.sc-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    container.querySelectorAll('.sc-pane').forEach(p => p.classList.toggle('active', p.id === 'sc-pane-' + name));
    if (name === 'manage') loadManage();
  }
  container.querySelectorAll('.sc-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ==================== 场景拼装（限定项手选 + 细节元素随地点） ====================
  const LIMIT_HINT = {
    sceneType: '换地点会整块换掉下面的细节元素',
    era: '时代决定材质与形制',
    depthOfField: '前景/中景/远景的虚实关系',
    camera: '取景角度与构图',
    light: '主光源与光质',
    color: '画面主色调',
    style: '渲染风格',
  };

  async function ensureDefs() {
    if (!defs) defs = await Admin.get('/scene-gen/defs');
    if (!themes.length) themes = await Admin.get('/scene-gen/themes');
  }

  function sceneTypeOption(id) {
    const lim = (defs?.limits || []).find(x => x.id === 'sceneType');
    return ((lim && lim.options) || []).find(o => o.id === id) || null;
  }

  function currentPacks() {
    const o = sceneTypeOption(state.appearance.sceneType);
    return (o && o.packs) || [];
  }

  /** 当前地点类型对应的元素维度（按定义顺序展开所有挂载的包） */
  function elementDims() {
    const want = currentPacks();
    const out = [];
    (defs?.packOrder || []).forEach(pid => {
      if (want.indexOf(pid) < 0) return;
      const p = (defs.packs || {})[pid];
      if (!p) return;
      (p.dims || []).forEach(d => out.push({ ...d, _pack: pid, _packName: p.name, _icon: p.icon }));
    });
    return out;
  }

  function needFill() {
    if (!state.appearance.sceneType) return true;
    const els = elementDims();
    return els.length > 0 && !els.some(d => state.appearance[d.id]);
  }

  function renderGroups() {
    const host = $('sc-groups');
    if (!host) return;
    if (!defs || !defs.limits) { host.innerHTML = '<div class="sc-empty">加载场景维度…</div>'; return; }

    const st = sceneTypeOption(state.appearance.sceneType);
    const els = elementDims();
    const elsPicked = els.filter(d => state.appearance[d.id]).length;
    const limMissing = (defs.limits || []).filter(d => !state.appearance[d.id]).length;

    host.innerHTML = `
      <section class="sc-group sc-limit">
        <div class="sc-group-h">🎯 限定选项<span class="sc-hint-inline">由你手选，随机不会改动</span></div>
        <div class="sc-limit-grid">
          <label class="sc-lim-item sc-lim-theme" title="一键套用某个题材的限定项，套完还能继续手改">
            <span>题材预设</span>
            <select data-theme-preset id="sc-theme"><option value="">（不套用）</option></select>
          </label>
          ${(defs.limits || []).map(d => `
            <label class="sc-lim-item" title="${esc(LIMIT_HINT[d.id] || d.name)}">
              <span>${esc(d.name)}</span>
              <select data-lim="${esc(d.id)}">
                <option value="">（未选）</option>
                ${(d.options || []).map(o => `<option value="${esc(o.id)}" ${state.appearance[d.id] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
              </select>
            </label>`).join('')}
        </div>
      </section>

      <section class="sc-group sc-element" style="margin-top:10px">
        <div class="sc-group-h">
          🧩 细节元素
          <span class="sc-el-title">${st ? esc(st.name) : '先选地点类型'}</span>
          <span class="sc-hint-inline">${els.length ? `随地点变化 · 已选 ${elsPicked}/${els.length}` : '这些是随机的部分'}${limMissing ? ` · 限定项还差 ${limMissing} 项` : ''}</span>
          <span class="sp" style="margin-left:auto">
            <button class="sc-btn" id="sc-el-all" style="font-size:11.5px;padding:3px 10px" ${els.length ? '' : 'disabled'}>🎲 换一批</button>
          </span>
        </div>
        <div class="body">
          ${els.length ? `<div class="sc-el-grid">
            ${els.map(d => `
              <div class="sc-row" data-dim="${esc(d.id)}">
                <label title="${esc(d._packName)} · ${esc(d.name)}">${esc(d.name)}</label>
                <select data-dim="${esc(d.id)}">
                  ${(d.options || []).map(o => `<option value="${esc(o.id)}" ${state.appearance[d.id] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
                </select>
                <button class="sc-dice" data-dice="${esc(d.id)}" title="单独随机这一项">🎲</button>
              </div>`).join('')}
          </div>` : `<div class="sc-empty" style="padding:14px">这个地点类型还没有配细节元素，可以在「定义管理」里补。</div>`}
        </div>
      </section>`;

    fillThemeSelect();

    // 题材预设：一键套用限定项
    const themeSel = $('sc-theme');
    if (themeSel) themeSel.addEventListener('change', onThemeChange);

    // 限定项：手选即生效，不随机
    host.querySelectorAll('[data-lim]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const dim = sel.dataset.lim;
        state.appearance[dim] = sel.value;
        if (dim === 'sceneType') {
          // 换地点 → 旧元素不属于新包，整块清掉再随机一套
          await rerollElements();
        } else {
          renderGroups();
          refreshPrompt();
        }
      });
    });
    host.querySelectorAll('.sc-el-grid select[data-dim]').forEach(sel => {
      sel.addEventListener('change', () => {
        const dim = sel.dataset.dim;
        if (sel.value) state.appearance[dim] = sel.value;
        else delete state.appearance[dim];
        refreshPrompt();
      });
    });
    host.querySelectorAll('.sc-dice').forEach(btn => {
      btn.addEventListener('click', () => rerollDim(btn.dataset.dice));
    });
    const allBtn = $('sc-el-all');
    if (allBtn) allBtn.addEventListener('click', () => rerollElements());
  }

  /** 只重随机细节元素，限定项一个都不动 */
  async function rerollElements() {
    try {
      const r = await Admin.post('/scene-gen/random', {
        theme: state.theme || undefined,
        base: state.appearance,
        fill_limits: false,
      });
      state.appearance = r.scene || state.appearance;
      state.theme = state.appearance.theme || '';
      renderGroups();
      refreshPrompt();
    } catch (e) { Admin.toast('随机失败：' + e.message, 'error'); }
  }

  async function rerollDim(dim) {
    try {
      const r = await Admin.post('/scene-gen/reroll', {
        scene: state.appearance, dim, theme: state.theme || undefined,
      });
      state.appearance = r.scene;
      renderGroups();
      refreshPrompt();
    } catch (e) { Admin.toast('随机失败：' + e.message, 'error'); }
  }

  /** 随机一套：补齐未选的限定项 + 重随机元素，已手选的限定项保持不动 */
  async function randomAll(silent) {
    try {
      const r = await Admin.post('/scene-gen/random', {
        theme: state.theme || undefined, base: state.appearance || {}, fill_limits: true,
      });
      state.appearance = r.scene;
      state.theme = state.appearance.theme || '';
      renderGroups();
      refreshPrompt();
      if (!silent) Admin.toast('已随机一套', 'success');
    } catch (e) { Admin.toast('随机失败：' + e.message, 'error'); }
  }

  async function onThemeChange() {
    const v = $('sc-theme')?.value || '';
    state.theme = v;
    if (!v) return;
    // 题材是「一键套用」：先清掉旧的限定项，再按题材重新填，然后随机元素
    state.appearance = {};
    await randomAll(true);
    Admin.toast('已套用题材预设，限定项可以继续手改', 'success');
  }

  // 提示词框可直接改；只要任一维度变了就重新生成并覆盖手改内容
  function refreshPrompt() {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(async () => {
      try {
        const r = await Admin.post('/scene-gen/prompt', { scene: state.appearance, free_prompt: '' });
        promptPos = r.prompt?.posCn || '';
        promptNeg = r.prompt?.negCn || '';
        promptEdited = false;
        const el = $('sc-prompt');
        if (el) el.value = promptPos || '（还没有选择任何维度）';
      } catch (e) {
        const el = $('sc-prompt');
        if (el) el.value = '提示词生成失败：' + e.message;
      }
    }, 160);
  }

  // ==================== 出图 ====================
  let renderJobs = new Set();

  async function renderScene() {
    const gp = window.GenParams ? GenParams.get('scenes') : {};
    const width = parseInt(gp.width) || 1344;
    const height = parseInt(gp.height) || 768;
    const st = sceneTypeOption(state.appearance.sceneType);
    try {
      const r = await Admin.post('/scene-gen/generate', {
        scene_id: null,
        appearance: state.appearance,
        // 提示词框手改过就用改后的这段出图
        prompt_override: promptEdited ? ($('sc-prompt')?.value || '') : null,
        width, height,
        model_preset: gp.model_preset || null,
        use_active_model_preset: !gp.model_preset,
        title: (st ? st.name : '场景') + ' · 场景出图',
        save_to_scene: false,
      });
      const jobId = r.job_id;
      renderJobs.add(jobId);
      updateRenderStatus();
      const timer = setInterval(async () => {
        let job = null;
        try { job = await Admin.get('/jobs/' + jobId); } catch (_) { return; }
        if (!job) return;
        if (job.status === 'running' || job.status === 'queued') {
          $('sc-render-status').textContent = `生成中…${renderJobs.size > 1 ? `（进行中 ${renderJobs.size} 个）` : ''}`;
          return;
        }
        clearInterval(timer);
        renderJobs.delete(jobId);
        if (job.status === 'error') {
          $('sc-render-status').textContent = '失败：' + (job.message || '未知原因');
          Admin.toast('出图失败：' + (job.message || ''), 'error');
          updateRenderStatus();
          return;
        }
        // 不再弹大图：静默刷新下方图库，新图排在最前
        $('sc-render-status').textContent = '';
        await loadGallery();
        updateRenderStatus();
      }, 1500);
    } catch (e) {
      $('sc-render-status').textContent = '提交失败：' + e.message;
      Admin.toast('提交失败：' + e.message, 'error');
    }
  }

  function updateRenderStatus() {
    const btn = $('sc-render');
    if (btn) btn.classList.toggle('busy', renderJobs.size > 0);
  }

  // ==================== 场景图库 ====================
  async function loadGallery() {
    try {
      // 只看「本页生成出来的」：kind=scene + origin=ai。
      // 上传到场景分类的参考图不在这一页出现，免得图库混进不相关的素材。
      const r = await Admin.get('/assets?kind=scene&origin=ai&sort=new&limit=60');
      gallery = r.items || [];
    } catch (_) { gallery = []; }
    // 已被删掉的选中项要清掉
    const ids = new Set(gallery.map(g => String(g.id)));
    [...gallerySel].forEach(id => { if (!ids.has(id)) gallerySel.delete(id); });
    renderGallery();
  }

  function galleryPreviewList() {
    return gallery.map(it => ({
      url: it.url, title: '场景图', prompt: it.prompt || '',
      width: it.width, height: it.height,
      meta: { '尺寸': it.width && it.height ? it.width + '×' + it.height : '',
              '模型方案': it.model_preset || '', '时间': it.created_at || '' },
    }));
  }

  function renderGallery() {
    const host = $('sc-gallery');
    if (!host) return;
    const cnt = $('sc-gallery-count');
    if (cnt) cnt.textContent = gallery.length;
    if (!gallery.length) {
      host.innerHTML = '<div class="sc-empty" style="grid-column:1/-1">还没有出图。调好左边参数，点上方「按当前配置出图」。</div>';
      paintGallerySel();
      return;
    }
    host.innerHTML = gallery.map((it, i) => `
      <div class="sc-shot${gallerySel.has(String(it.id)) ? ' sel' : ''}" data-id="${it.id}" data-i="${i}"
        title="${esc(it.prompt || '')}">
        <img src="${esc(it.url)}" alt="" loading="lazy">
        <div class="m">
          <span>${it.width && it.height ? it.width + '×' + it.height : '场景图'}</span>
        </div>
      </div>`).join('');
    host.querySelectorAll('.sc-shot').forEach(card => {
      const id = card.dataset.id;
      card.addEventListener('click', (e) => {
        if (e.shiftKey) {
          if (gallerySel.has(id)) gallerySel.delete(id); else gallerySel.add(id);
        } else {
          gallerySel.clear();
          gallerySel.add(id);
        }
        paintGallerySel();
      });
      card.addEventListener('dblclick', () => {
        if (window.ImagePreview) ImagePreview.open(galleryPreviewList(), Number(card.dataset.i) || 0);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openGalleryMenu(e.clientX, e.clientY, id);
      });
    });
    paintGallerySel();
  }

  function paintGallerySel() {
    const host = $('sc-gallery');
    if (host) host.querySelectorAll('.sc-shot').forEach(card => {
      card.classList.toggle('sel', gallerySel.has(card.dataset.id));
    });
    const sc = $('sc-gallery-sel');
    if (sc) sc.textContent = gallerySel.size ? `已选 ${gallerySel.size} 张` : '';
  }

  function pickedGallery() {
    return gallery.filter(it => gallerySel.has(String(it.id)));
  }

  function openGalleryMenu(x, y, id) {
    if (!gallerySel.has(id)) { gallerySel.clear(); gallerySel.add(id); paintGallerySel(); }
    const picked = pickedGallery();
    const menu = document.createElement('div');
    menu.className = 'cmp-gmenu sc-gmenu';
    menu.innerHTML = `
      <button type="button" data-act="view">🔍 查看大图</button>
      <button type="button" data-act="copy">📋 复制提示词（${picked.length} 张）</button>
      <button type="button" data-act="fill">↩ 填入当前提示词</button>
      <button type="button" data-act="del" class="danger">🗑 删除选中（${picked.length} 张）</button>`;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 240)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 190)) + 'px';
    document.body.appendChild(menu);
    const close = () => { menu.remove(); document.removeEventListener('mousedown', onDocDown); };
    function onDocDown(ev) { if (!menu.contains(ev.target)) close(); }
    setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);

    menu.querySelector('[data-act="view"]').addEventListener('click', (e) => {
      e.stopPropagation(); close();
      const idx = gallery.findIndex(it => String(it.id) === id);
      if (window.ImagePreview) ImagePreview.open(galleryPreviewList(), idx < 0 ? 0 : idx);
    });
    menu.querySelector('[data-act="copy"]').addEventListener('click', async (e) => {
      e.stopPropagation(); close();
      const text = picked.map(it => it.prompt || '').filter(Boolean).join('\n\n');
      if (!text) { Admin.toast('这些图没有提示词', 'info'); return; }
      try { await navigator.clipboard.writeText(text); Admin.toast(`已复制 ${picked.length} 张提示词`, 'success'); }
      catch { Admin.toast('复制失败', 'error'); }
    });
    menu.querySelector('[data-act="fill"]').addEventListener('click', (e) => {
      e.stopPropagation(); close();
      const it = picked[0];
      if (!it || !it.prompt) { Admin.toast('这张图没有提示词', 'info'); return; }
      const ta = $('sc-prompt');
      if (ta) { ta.value = it.prompt; promptEdited = true; }
      Admin.toast('已填入提示词框，可直接改了再出图', 'success');
    });
    menu.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
      e.stopPropagation(); close();
      if (!await Admin.confirm(`删除选中的 ${picked.length} 张场景图？文件会一起删掉。`)) return;
      let ok = 0;
      for (const it of picked) {
        try { await Admin.del(`/assets/${it.id}?remove_file=true&force=true`); ok++; }
        catch (err) { Admin.toast('删除失败：' + (err.message || ''), 'error'); }
      }
      gallerySel.clear();
      await loadGallery();
      Admin.toast(`已删除 ${ok} 张`, ok ? 'success' : 'error');
    });
  }

  /** 题材下拉：场景方案在前、题材风格在后 */
  function fillThemeSelect() {
    const sel = $('sc-theme');
    if (!sel) return;
    const all = themes || [];
    const plan = all.filter(t => (t.cat || 'genre') === 'plan');
    const genre = all.filter(t => (t.cat || 'genre') !== 'plan');
    const opt = (t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`;
    sel.innerHTML = '<option value="">（不套用）</option>'
      + (plan.length ? `<optgroup label="场景方案（具体地点）">${plan.map(opt).join('')}</optgroup>` : '')
      + (genre.length ? `<optgroup label="题材（风格约束）">${genre.map(opt).join('')}</optgroup>` : '');
    sel.value = state.theme || '';
  }

  // ==================== 页面事件 ====================
  $('sc-random').addEventListener('click', () => randomAll());
  $('sc-render').addEventListener('click', renderScene);
  $('sc-reset-prompt').addEventListener('click', () => {
    promptEdited = false;
    refreshPrompt();
    Admin.toast('已按当前参数重新生成提示词', 'success');
  });
  $('sc-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('sc-prompt')?.value || promptPos || ''); Admin.toast('提示词已复制', 'success'); }
    catch { Admin.toast('复制失败，请手动选择', 'error'); }
  });
  $('sc-prompt').addEventListener('input', (e) => {
    promptEdited = e.target.value !== (promptPos || '');
  });

  // 出图参数：进页面就挂出来，和别处是同一套「场景出图参数」
  async function ensureGenPanel() {
    if (genPanelMounted || !window.GenParams) return;
    genPanelMounted = true;
    try { await GenParams.init($('sc-gen-params'), { scope: 'scenes' }); }
    catch (e) { $('sc-gen-params').innerHTML = `<div style="font-size:12px;color:var(--red)">参数加载失败：${esc(e.message)}</div>`; }
  }

  // ==================== 定义管理 ====================
  async function loadManage() {
    await ensureDefs();
    renderDimTree();
    renderThemes();
    if (activeDim) renderDimEditor(activeDim);
  }

  function renderDimTree() {
    const host = $('sc-dim-tree');
    if (!host) return;
    host.innerHTML = (defs.groups || []).map(g => `
      <div style="padding:7px 9px;font-size:13px;font-weight:600;color:var(--gold);
        background:rgba(201,168,76,.08);border-bottom:1px dashed var(--border)">
        ${esc(g.icon || '')} ${esc(g.name)}
      </div>
      ${(g.dims || []).map(d => `
        <div class="sc-item${activeDim === d.id ? ' on' : ''}" data-dim="${esc(d.id)}">
          <span>${esc(d.name)}</span>
          <span class="n">${(d.options || []).length}</span>
        </div>`).join('')}`).join('');
    host.querySelectorAll('[data-dim]').forEach(el => {
      el.addEventListener('click', () => { activeDim = el.dataset.dim; renderDimTree(); renderDimEditor(activeDim); });
    });
  }

  function renderDimEditor(dimId) {
    const host = $('sc-dim-editor');
    const g = (defs.groups || []).find(x => (x.dims || []).some(d => d.id === dimId));
    const d = g && g.dims.find(x => x.id === dimId);
    if (!d) { host.innerHTML = '<div class="sc-empty">维度不存在</div>'; return; }
    host.innerHTML = `
      <div class="sc-panel-h">
        <span>维度：${esc(d.name)} <span style="color:var(--text-muted);font-size:11.5px">(${esc(d.id)})</span></span>
        <span class="sp">
          <button class="sc-btn" id="sc-opt-add" style="font-size:11.5px;padding:3px 10px">＋ 新增选项</button>
          <button class="sc-btn" id="sc-dim-save" style="font-size:11.5px;padding:3px 10px">保存维度</button>
          <button class="sc-btn" id="sc-dim-del" style="font-size:11.5px;padding:3px 10px;color:var(--red)">删除维度</button>
        </span>
      </div>
      <div style="display:flex;gap:10px;padding:9px 10px;flex-wrap:wrap">
        <label class="sc-field"><span>显示名</span><input id="sc-dim-name" class="sc-inp" value="${esc(d.name)}"></label>
        <label class="sc-field"><span>所属分组</span>
          <select id="sc-dim-group" class="sc-sel">
            ${(defs.groups || []).map(x => `<option value="${esc(x.id)}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select></label>
      </div>
      <div class="sc-opts" id="sc-opts">
        ${(d.options || []).map(o => `
          <div class="sc-opt" data-oid="${esc(o.id)}">
            <input class="nm" data-f="name" value="${esc(o.name)}" title="显示名">
            <input class="cn" data-f="cn" value="${esc(o.cn || '')}" placeholder="提示词文本（留空用显示名）">
            <button data-osave="${esc(o.id)}">存</button>
            <button data-omove="${esc(o.id)}">↑</button>
            <button data-odel="${esc(o.id)}">✕</button>
          </div>`).join('') || '<div class="sc-empty">该维度还没有选项</div>'}
      </div>
    `;
    $('sc-dim-save').addEventListener('click', async () => {
      try {
        await Admin.put(`/scene-gen/manage/dims/${dimId}`, {
          name: $('sc-dim-name').value, group: $('sc-dim-group').value,
        });
        await loadManage();
        Admin.toast('维度已保存', 'success');
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    });
    $('sc-dim-del').addEventListener('click', async () => {
      if (!await Admin.confirm('删除这个维度？已有场景里该维度的值会被忽略。')) return;
      try {
        await Admin.del(`/scene-gen/manage/dims/${dimId}`);
        defs = await Admin.get('/scene-gen/defs');
        activeDim = '';
        await loadManage();
        $('sc-dim-editor').innerHTML = '<div class="sc-empty">左侧选择一个维度开始编辑</div>';
        Admin.toast('维度已删除', 'success');
      } catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
    });
    $('sc-opt-add').addEventListener('click', async () => {
      const d2 = await prompt2('新增场景选项', [
        { name: 'id', label: '选项 id（英文/数字，唯一）', value: '' },
        { name: 'name', label: '显示名', value: '' },
        { name: 'cn', label: '提示词文本', type: 'textarea', value: '' },
      ]);
      if (!d2 || !d2.name) return;
      try {
        await Admin.post(`/scene-gen/manage/dims/${dimId}/options`, d2);
        defs = await Admin.get('/scene-gen/defs');
        await loadManage();
        Admin.toast('已新增选项', 'success');
      } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
    });
    host.querySelectorAll('[data-osave]').forEach(b => {
      b.addEventListener('click', async () => {
        const row = b.closest('.sc-opt');
        try {
          await Admin.put(`/scene-gen/manage/dims/${dimId}/options/${b.dataset.osave}`, {
            name: row.querySelector('[data-f="name"]').value,
            cn: row.querySelector('[data-f="cn"]').value,
          });
          defs = await Admin.get('/scene-gen/defs');
          Admin.toast('选项已保存', 'success');
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      });
    });
    host.querySelectorAll('[data-omove]').forEach(b => {
      b.addEventListener('click', async () => {
        await Admin.post(`/scene-gen/manage/dims/${dimId}/options/${b.dataset.omove}/move`, { delta: -1 });
        defs = await Admin.get('/scene-gen/defs');
        await loadManage(); renderDimEditor(dimId);
      });
    });
    host.querySelectorAll('[data-odel]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!await Admin.confirm('删除这个选项？')) return;
        await Admin.del(`/scene-gen/manage/dims/${dimId}/options/${b.dataset.odel}`);
        defs = await Admin.get('/scene-gen/defs');
        await loadManage(); renderDimEditor(dimId);
      });
    });
  }

  function renderThemes() {
    const host = $('sc-theme-list');
    if (!host) return;
    host.innerHTML = (themes || []).map(t => `
      <div class="sc-panel" style="padding:8px 10px">
        <div style="display:flex;align-items:center;gap:7px">
          <b style="font-size:13.5px">${esc(t.name)}</b>
          <span style="font-size:11px;color:var(--text-muted)">${esc(t.id)}</span>
          <button class="sc-btn" data-tedit="${esc(t.id)}" style="margin-left:auto;font-size:11px;padding:2px 8px">编辑</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5">${esc(t.desc || t.cn || '')}</div>
      </div>`).join('') || '<div class="sc-empty">还没有题材</div>';
    host.querySelectorAll('[data-tedit]').forEach(b => {
      b.addEventListener('click', () => editTheme(b.dataset.tedit));
    });
  }

  async function editTheme(themeId) {
    const raw = await Admin.get('/scene-gen/manage/raw');
    const t = (raw.themes || []).find(x => x.id === themeId) || {};
    const d = await prompt2('编辑场景题材', [
      { name: 'name', label: '名称', value: t.name || '' },
      { name: 'desc', label: '说明', value: t.desc || '' },
      { name: 'cn', label: '题材描述（拼进提示词）', type: 'textarea', value: t.cn || '' },
      { name: 'colors', label: '色板（逗号分隔的选项 id，可空）', value: (t.colors || []).join(',') },
      { name: 'pools', label: '收敛池 pools（JSON）', type: 'textarea', value: JSON.stringify(t.pools || {}, null, 1) },
    ]);
    if (!d || !d.name) return;
    let pools = {};
    try { pools = d.pools ? JSON.parse(d.pools) : {}; } catch { Admin.toast('pools 不是合法 JSON', 'error'); return; }
    try {
      await Admin.put(`/scene-gen/manage/themes/${themeId}`, {
        name: d.name, desc: d.desc, cn: d.cn,
        colors: (d.colors || '').split(',').map(s => s.trim()).filter(Boolean),
        pools,
      });
      themes = await Admin.get('/scene-gen/themes');
      renderThemes();
      fillThemeSelect();
      Admin.toast('题材已保存', 'success');
    } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
  }

  $('sc-theme-add').addEventListener('click', async () => {
    const d = await prompt2('新增场景题材', [
      { name: 'id', label: 'id（英文，唯一）', value: '' },
      { name: 'name', label: '名称', value: '' },
      { name: 'cn', label: '题材描述', type: 'textarea', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/scene-gen/manage/themes', { id: d.id || null, name: d.name, desc: '', cn: d.cn });
      themes = await Admin.get('/scene-gen/themes');
      renderThemes(); fillThemeSelect();
      Admin.toast('已新增题材', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  $('sc-mg-reset').addEventListener('click', async () => {
    if (!await Admin.confirm('恢复出厂场景定义？自定义的维度/选项/题材会被覆盖（场景数据不受影响）。')) return;
    await Admin.post('/scene-gen/manage/reset', {});
    defs = await Admin.get('/scene-gen/defs');
    themes = await Admin.get('/scene-gen/themes');
    await loadManage(); fillThemeSelect();
    Admin.toast('已恢复默认场景定义', 'success');
  });

  $('sc-dim-add').addEventListener('click', async () => {
    const d = await prompt2('新增场景维度', [
      { name: 'id', label: '维度 id（英文，唯一）', value: '' },
      { name: 'name', label: '显示名', value: '' },
      { name: 'group', label: `所属分组（${(defs.groups || []).map(g => g.id).join(' / ')}）`, value: (defs.groups || [])[0]?.id || 'place' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/scene-gen/manage/dims', { id: d.id || null, name: d.name, group: d.group });
      defs = await Admin.get('/scene-gen/defs');
      await loadManage();
      Admin.toast('已新增维度，记得去加选项', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  $('sc-group-add').addEventListener('click', async () => {
    const d = await prompt2('新增场景分组', [
      { name: 'id', label: '分组 id（英文，唯一）', value: '' },
      { name: 'name', label: '显示名', value: '' },
      { name: 'icon', label: '图标（emoji）', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/scene-gen/manage/groups', { id: d.id || null, name: d.name, icon: d.icon });
      defs = await Admin.get('/scene-gen/defs');
      await loadManage();
      Admin.toast('已新增分组', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  // ==================== 初始化 ====================
  try {
    await ensureDefs();
    await ensureGenPanel();
    await loadGallery();
    renderGroups();
    // 空手进来先给一套起点，用户在这基础上改
    if (needFill()) await randomAll(true);
    else refreshPrompt();
  } catch (e) {
    container.innerHTML = `<div class="table-empty">场景拼装初始化失败：${esc(e.message)}</div>`;
  }
});
