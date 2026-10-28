// ========== 人物外观拼装（拼装 / 动作表情库 / 定义管理） ==========
// 三个 Tab：
//   1. 外观拼装：选人物编辑外观、按题材定向随机、批量新建一批人物
//   2. 动作表情库：动作分类与条目的增删改（自定义分类）
//   3. 定义管理：分组 / 维度 / 选项 / 题材的增删改（改完立刻影响拼装与提示词）
Admin.registerPage('character_appearance', async (container) => {
  ensureStyle();

  const state = {
    defs: null,
    themes: [],
    library: { categories: [], poses: [] },
    chars: [],
    charId: null,
    includeSensitive: false,
    editor: null,
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  container.innerHTML = `
    <div class="ap-wrap">
      <div class="ap-tabs">
        <button class="ap-tab active" data-tab="assembly">外观拼装</button>
        <button class="ap-tab" data-tab="poses">动作表情库</button>
        <button class="ap-tab" data-tab="manage">定义管理</button>
      </div>

      <!-- ============ 外观拼装 ============ -->
      <div id="ap-tab-assembly" class="ap-pane active">
        <div class="ap-toolbar">
          <label class="ap-field"><span>人物</span>
            <select id="ap-char" class="ap-sel" style="min-width:190px"></select>
          </label>
          <label class="ap-field"><span>成人维度</span>
            <select id="ap-sensitive" class="ap-sel">
              <option value="0">隐藏</option>
              <option value="1">显示</option>
            </select>
          </label>
          <button class="ap-btn" id="ap-batch-toggle">＋ 批量新建人物</button>
          <button class="ap-btn" id="ap-gen-toggle" title="展开/收起全局出图参数">⚙ 出图参数</button>
          <button class="ap-btn primary" id="ap-render" title="用当前外观直接出一张图">🖼 按当前外观出图</button>
          <span class="ap-hint" id="ap-hint">未选择人物时仅供预览</span>
        </div>

        <!-- 全局出图参数（默认收起，点了才展开，不占版面） -->
        <div id="ap-genbox" style="display:none;margin-bottom:10px">
          <div id="ap-gen-params"></div>
        </div>
        <div id="ap-render-status" class="ap-hint" style="margin:-4px 0 8px"></div>

        <div class="ap-batch" id="ap-batch" style="display:none">
          <div class="ap-batch-row">
            <label class="ap-field"><span>数量</span>
              <input id="ap-b-count" type="number" value="10" min="1" max="100" class="ap-inp"></label>
            <label class="ap-field"><span>名字前缀</span>
              <input id="ap-b-prefix" value="角色" class="ap-inp" style="width:100px"></label>
            <label class="ap-field"><span>类型</span>
              <select id="ap-b-type" class="ap-sel">
                <option value="npc">NPC</option><option value="player">玩家</option>
                <option value="enemy">敌人</option><option value="ally">盟友</option>
              </select></label>
            <label class="ap-field"><span>题材</span>
              <select id="ap-b-theme" class="ap-sel"><option value="">不限定</option></select></label>
            <label class="ap-field"><span>性别</span>
              <select id="ap-b-gender" class="ap-sel">
                <option value="">随机</option><option value="male">男</option><option value="female">女</option>
              </select></label>
            <label class="ap-field"><span>分类</span>
              <select id="ap-b-cat" class="ap-sel"><option value="">未分类</option></select></label>
            <button class="ap-btn primary" id="ap-b-run">开始生成</button>
            <span class="ap-hint" id="ap-b-status"></span>
          </div>
          <div class="ap-hint" style="margin-top:4px">
            每个名字独立随机一套外观（题材内收敛：服饰 / 发型 / 道具 / 身份），生成后可在列表里逐个微调。
          </div>
        </div>

        <div id="ap-editor-host"><div class="ap-hint" style="padding:12px">加载维度…</div></div>
      </div>

      <!-- ============ 动作表情库 ============ -->
      <div id="ap-tab-poses" class="ap-pane">
        <div class="ap-split">
          <div class="ap-side">
            <div class="ap-side-head">动作分类 <button class="ap-btn xs" id="ap-cat-add">＋</button></div>
            <div id="ap-cat-list" class="ap-list"></div>
          </div>
          <div class="ap-main">
            <div class="ap-side-head">
              <span id="ap-pose-title">动作条目</span>
              <span style="margin-left:auto;display:flex;gap:6px">
                <button class="ap-btn xs" id="ap-pose-add">＋ 新增动作</button>
              </span>
            </div>
            <div id="ap-pose-list" class="ap-poses"></div>
          </div>
        </div>
      </div>

      <!-- ============ 定义管理 ============ -->
      <div id="ap-tab-manage" class="ap-pane">
        <div class="ap-toolbar">
          <button class="ap-btn" id="ap-mg-reset">恢复默认定义</button>
          <span class="ap-hint">改动立即写盘，同时影响「外观拼装」的下拉与出图提示词。</span>
        </div>
        <div class="ap-split">
          <div class="ap-side">
            <div class="ap-side-head">分组 / 维度 <button class="ap-btn xs" id="ap-dim-add">＋</button></div>
            <div id="ap-dim-tree" class="ap-list"></div>
          </div>
          <div class="ap-main" id="ap-dim-editor">
            <div class="ap-hint" style="padding:16px">左侧选一个维度开始编辑</div>
          </div>
        </div>
        <div style="margin-top:14px">
          <div class="ap-side-head">题材（定向随机包） <button class="ap-btn xs" id="ap-theme-add">＋ 新增题材</button></div>
          <div id="ap-theme-list" class="ap-themes"></div>
        </div>
      </div>
    </div>
  `;

  // ---------- tab 切换 ----------
  container.querySelectorAll('.ap-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.ap-tab').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.ap-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ap-tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'poses') loadLibrary();
      if (btn.dataset.tab === 'manage') renderManage();
    });
  });

  const $ = (id) => document.getElementById(id);

  // ==================== 通用输入弹窗 ====================
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
      setTimeout(() => {
        const b = document.querySelector('.modal-body input, .modal-body textarea');
        if (b) b.focus();
      }, 30);
    });
  }

  // ==================== Tab1：外观拼装 ====================
  async function loadChars() {
    state.chars = await Admin.get('/characters/');
    const sel = $('ap-char');
    const cur = state.charId;
    sel.innerHTML = `<option value="">— 未选择（仅预览）—</option>` +
      state.chars.map(c => `<option value="${c.id}">${esc(c.name)}（${esc(c.character_type)}）</option>`).join('');
    if (cur) sel.value = String(cur);
    // 批量新建里的分类下拉
    try {
      const catData = await Admin.get('/resource-categories/character/tree');
      const build = (nodes, depth) => nodes.map(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        return `<option value="${esc(n.path)}">${prefix}${esc(n.name)}</option>` +
          (n.children && n.children.length ? build(n.children, depth + 1) : '');
      }).join('');
      $('ap-b-cat').innerHTML = '<option value="">未分类</option>' + build(catData.tree || [], 0);
    } catch (e) { /* 分类拉不到不影响主流程 */ }
  }

  async function mountEditor() {
    const host = $('ap-editor-host');
    host.innerHTML = '';
    let appearance = {};
    if (state.charId) {
      try {
        const r = await Admin.get(`/characters/${state.charId}/appearance?include_sensitive=${state.includeSensitive}`);
        appearance = r.appearance || {};
      } catch (e) { /* 新人物还没有外观 */ }
    }
    state.editor = await window.AppearanceEditor.mount(host, appearance, {
      includeSensitive: state.includeSensitive,
      // 参数在左、提示词在右，改一个下拉就能立刻对照提示词变化
      layout: 'split',
      onSave: async (app) => {
        if (!state.charId) { Admin.toast('请先选择人物再保存', 'error'); return; }
        try {
          await Admin.put(`/characters/${state.charId}/appearance`, { appearance: app });
          Admin.toast('外观已保存到人物（默认配置）', 'success');
        } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
      },
    });
  }

  $('ap-char').addEventListener('change', async (e) => {
    state.charId = e.target.value ? parseInt(e.target.value) : null;
    const name = state.chars.find(c => c.id === state.charId)?.name || '';
    $('ap-hint').textContent = state.charId ? '已载入：' + name : '未选择人物：随机生成仅预览，不会保存。';
    await mountEditor();
  });

  $('ap-sensitive').addEventListener('change', async (e) => {
    state.includeSensitive = e.target.value === '1';
    try { await Admin.put('/comfyui/include-sensitive', { value: state.includeSensitive }); } catch (_) {}
    await mountEditor();
  });

  // ---------- 全局出图参数 / 按当前外观出图 ----------
  let genPanelMounted = false;
  $('ap-gen-toggle').addEventListener('click', async () => {
    const box = $('ap-genbox');
    const open = box.style.display === 'none';
    box.style.display = open ? '' : 'none';
    if (open && !genPanelMounted && window.GenParams) {
      genPanelMounted = true;
      try { await GenParams.init($('ap-gen-params'), { scope: 'characters' }); } catch (e) {
        $('ap-gen-params').innerHTML = `<div class="ap-hint">参数加载失败：${esc(e.message)}</div>`;
      }
    }
  });

  $('ap-render').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!state.editor) { Admin.toast('外观还没加载完', 'error'); return; }
    const app = state.editor.getAppearance();
    const gp = window.GenParams ? GenParams.get('characters') : {};
    const name = state.chars.find(c => c.id === state.charId)?.name || '';
    btn.disabled = true;
    $('ap-render-status').textContent = '已提交到 ComfyUI，后台生成中（顶栏可看进度）…';
    try {
      const r = await Admin.post('/render/appearance', {
        appearance: app,
        // 提示词框手改过就用手改的这段出图
        positive: state.editor.isPromptEdited() ? state.editor.getPromptText() : null,
        include_sensitive: state.includeSensitive,
        model_preset: gp.model_preset || null,
        width: gp.width || null,
        height: gp.height || null,
        filename_prefix: 'render',
        page: 'character_appearance',
        title: `立绘 · ${name || '未命名预览'}${app.framing === 'half' ? '（半身）' : ''}`,
        character_id: state.charId || null,
        character_name: name || null,
      });
      const jobId = r.job_id;
      const timer = setInterval(async () => {
        let job = null;
        try { job = await Admin.get('/jobs/' + jobId); } catch (_) { return; }
        if (!job) return;
        if (job.status === 'running') {
          $('ap-render-status').textContent = `生成中… ${job.message || ''}`;
          return;
        }
        clearInterval(timer);
        btn.disabled = false;
        if (job.status === 'error') {
          $('ap-render-status').textContent = '失败：' + (job.message || '未知原因');
          Admin.toast('出图失败：' + (job.message || ''), 'error');
          return;
        }
        const it = job.render || (job.results || [])[0] || {};
        $('ap-render-status').textContent =
          `已出图 ${it.width || ''}${it.width ? '×' : ''}${it.height || ''} — 点缩略图看提示词`;
        if (it.url && window.ImagePreview) {
          ImagePreview.open([{
            url: it.url, title: `立绘 · ${name || '预览'}`,
            prompt: it.prompt || '', width: it.width, height: it.height,
            meta: { '人物': name || '未归属', '尺寸': it.width ? `${it.width}×${it.height}` : '',
                    '方案': it.prompt ? (gp.model_preset || '激活方案') : '' },
          }], 0);
        }
      }, 2000);
    } catch (err) {
      btn.disabled = false;
      $('ap-render-status').textContent = '提交失败：' + err.message;
      Admin.toast('提交失败：' + err.message, 'error');
    }
  });

  $('ap-batch-toggle').addEventListener('click', () => {
    const el = $('ap-batch');
    el.style.display = el.style.display === 'none' ? '' : 'none';
  });

  $('ap-b-run').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const body = {
      count: Math.max(1, Math.min(100, parseInt($('ap-b-count').value) || 10)),
      name_prefix: $('ap-b-prefix').value || '角色',
      character_type: $('ap-b-type').value,
      category_path: $('ap-b-cat').value || null,
      theme: $('ap-b-theme').value || null,
      gender: $('ap-b-gender').value || null,
      include_sensitive: state.includeSensitive,
    };
    btn.disabled = true;
    $('ap-b-status').textContent = '生成中…';
    try {
      const r = await Admin.post('/appearance/batch-characters', body);
      $('ap-b-status').textContent = `已创建 ${r.count} 个：${r.characters.map(c => c.name).slice(0, 4).join('、')}${r.count > 4 ? ' …' : ''}`;
      Admin.toast(`已创建 ${r.count} 个人物`, 'success');
      await loadChars();
    } catch (err) {
      $('ap-b-status').textContent = '失败：' + err.message;
      Admin.toast('批量创建失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ==================== Tab2：动作表情库 ====================
  async function loadLibrary() {
    state.library = await Admin.get('/poses/library');
    renderCats();
    renderPoses();
  }

  let activeCat = '';

  function renderCats() {
    const cats = [{ id: '', name: '全部', count: state.library.poses.length }]
      .concat(state.library.categories || []);
    $('ap-cat-list').innerHTML = cats.map(c => `
      <div class="ap-item${activeCat === c.id ? ' on' : ''}" data-cat="${esc(c.id)}">
        <span class="ap-item-t">${esc(c.name)}</span>
        <span class="ap-item-n">${c.count || 0}</span>
        ${c.id ? `<span class="ap-item-ops">
          <button data-cedit="${esc(c.id)}" title="重命名">✎</button>
          <button data-cdel="${esc(c.id)}" title="删除">✕</button></span>` : ''}
      </div>`).join('');

    $('ap-cat-list').querySelectorAll('.ap-item').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.dataset.cedit || ev.target.dataset.cdel) return;
        activeCat = el.dataset.cat;
        renderCats(); renderPoses();
      });
    });
    $('ap-cat-list').querySelectorAll('[data-cedit]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cur = state.library.categories.find(c => c.id === b.dataset.cedit);
        const d = await prompt2('重命名分类', [{ name: 'name', label: '分类名', value: cur?.name || '' }]);
        if (!d || !d.name) return;
        await Admin.put(`/poses/categories/${b.dataset.cedit}`, { name: d.name, desc: cur?.desc || '' });
        await loadLibrary();
        Admin.toast('已更新', 'success');
      });
    });
    $('ap-cat-list').querySelectorAll('[data-cdel]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await Admin.confirm('删除该分类会同时删除其下所有动作条目，确定？')) return;
        await Admin.del(`/poses/categories/${b.dataset.cdel}`);
        if (activeCat === b.dataset.cdel) activeCat = '';
        await loadLibrary();
        Admin.toast('已删除', 'success');
      });
    });
  }

  function renderPoses() {
    const list = (state.library.poses || []).filter(p => !activeCat || p.cat === activeCat);
    const catName = (id) => (state.library.categories.find(c => c.id === id) || {}).name || id || '未分类';
    $('ap-pose-title').textContent = `动作条目 · ${list.length} 条` + (activeCat ? `（${catName(activeCat)}）` : '');
    $('ap-pose-list').innerHTML = list.length ? list.map((p, i) => `
      <div class="ap-pose" data-pose="${esc(p.id)}">
        <div class="ap-pose-head">
          <b>${esc(p.name)}</b>
          <span class="ap-chip">${esc(catName(p.cat))}</span>
          <span class="ap-pose-ops">
            <button data-pedit="${esc(p.id)}">编辑</button>
            <button data-pdel="${esc(p.id)}">删除</button>
          </span>
        </div>
        <div class="ap-pose-cn">${esc(p.cn || '（无描述，出图时会缺少动作细节）')}</div>
      </div>`).join('') : '<div class="ap-empty">该分类下还没有动作</div>';

    $('ap-pose-list').querySelectorAll('[data-pedit]').forEach(b => {
      b.addEventListener('click', () => editPose(b.dataset.pedit));
    });
    $('ap-pose-list').querySelectorAll('[data-pdel]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!await Admin.confirm('删除这条动作？已生成的图片记录不受影响。')) return;
        await Admin.del(`/poses/items/${b.dataset.pdel}`);
        await loadLibrary();
        Admin.toast('已删除', 'success');
      });
    });
  }

  async function editPose(poseId) {
    const cur = (state.library.poses || []).find(p => p.id === poseId);
    const cats = state.library.categories || [];
    if (!cats.length) { Admin.toast('请先创建至少一个动作分类', 'error'); return; }
    const d = await prompt2(cur ? '编辑动作' : '新增动作', [
      { name: 'name', label: '动作名（简短）', value: cur?.name || '' },
      { name: 'cat', label: `分类（填 id：${cats.map(c => c.id).join(' / ')}）`, value: cur?.cat || activeCat || cats[0].id },
      { name: 'cn', label: '动作表情描述（直接作为提示词，写清姿势 + 表情）', type: 'textarea', value: cur?.cn || '' },
    ]);
    if (!d || !d.name) return;
    try {
      if (cur) {
        await Admin.put(`/poses/items/${poseId}`, { name: d.name, cat: d.cat, cn: d.cn });
      } else {
        await Admin.post('/poses/items', { name: d.name, cat: d.cat, cn: d.cn });
      }
      await loadLibrary();
      Admin.toast(cur ? '已更新' : '已新增', 'success');
    } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
  }

  $('ap-cat-add').addEventListener('click', async () => {
    const d = await prompt2('新增动作分类', [
      { name: 'name', label: '分类名（如：战斗 / 日常 / 恋爱）', value: '' },
      { name: 'desc', label: '说明（可选）', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/poses/categories', { name: d.name, desc: d.desc });
      await loadLibrary();
      Admin.toast('已新增分类', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  $('ap-pose-add').addEventListener('click', () => editPose(null));

  // ==================== Tab3：定义管理 ====================
  let activeDim = '';

  async function renderManage() {
    state.defs = await Admin.get('/appearance/defs?include_sensitive=1');
    state.themes = await Admin.get('/appearance/themes');
    renderDimTree();
    if (activeDim) renderDimEditor(activeDim);
    renderThemes();
  }

  function renderDimTree() {
    const defs = state.defs;
    $('ap-dim-tree').innerHTML = defs.groups.map(g => `
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

    $('ap-dim-tree').querySelectorAll('[data-dim]').forEach(el => {
      el.addEventListener('click', () => { activeDim = el.dataset.dim; renderDimTree(); renderDimEditor(activeDim); });
    });
    $('ap-dim-tree').querySelectorAll('[data-gedit]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const g = state.defs.groups.find(x => x.id === b.dataset.gedit);
        const d = await prompt2('重命名分组', [
          { name: 'name', label: '分组名', value: g?.name || '' },
          { name: 'icon', label: '图标（emoji）', value: g?.icon || '' },
        ]);
        if (!d || !d.name) return;
        await Admin.put(`/appearance/manage/groups/${b.dataset.gedit}`, { name: d.name, icon: d.icon });
        await renderManage();
      });
    });
    $('ap-dim-tree').querySelectorAll('[data-gdel]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await Admin.confirm('删除分组会连带删除该分组下所有维度，确定？')) return;
        await Admin.del(`/appearance/manage/groups/${b.dataset.gdel}`);
        await renderManage();
      });
    });
  }

  function renderDimEditor(dimId) {
    const g = state.defs.groups.find(x => x.dims.some(d => d.id === dimId));
    const d = g?.dims.find(x => x.id === dimId);
    if (!d) { $('ap-dim-editor').innerHTML = '<div class="ap-hint" style="padding:16px">维度不存在</div>'; return; }

    $('ap-dim-editor').innerHTML = `
      <div class="ap-side-head">
        <span>维度：${esc(d.name)} <span class="ap-hint">(${esc(d.id)})</span></span>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="ap-btn xs" id="ap-opt-add">＋ 新增选项</button>
          <button class="ap-btn xs" id="ap-dim-del">删除维度</button>
        </span>
      </div>
      <div class="ap-form-row">
        <label class="ap-field"><span>显示名</span><input id="ap-dim-name" class="ap-inp" value="${esc(d.name)}"></label>
        <label class="ap-field"><span>所属分组</span>
          <select id="ap-dim-group" class="ap-sel">
            ${state.defs.groups.map(x => `<option value="${esc(x.id)}"${x.id === g.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select></label>
        <label class="ap-field"><span>成人维度</span>
          <select id="ap-dim-sens" class="ap-sel">
            <option value="0"${d.sensitive ? '' : ' selected'}>否</option>
            <option value="1"${d.sensitive ? ' selected' : ''}>是</option>
          </select></label>
        <label class="ap-field"><span>颜色维度</span>
          <select id="ap-dim-color" class="ap-sel">
            <option value="0"${d.is_color ? '' : ' selected'}>否</option>
            <option value="1"${d.is_color ? ' selected' : ''}>是</option>
          </select></label>
        <button class="ap-btn" id="ap-dim-save">保存维度</button>
      </div>
      <div class="ap-field" style="margin:6px 0">
        <span>显示条件 cond（JSON，可空）—— 例：{"gender":"female","not_band":["toddler","child"],"requires":{"nudity":["none"]}}</span>
        <textarea id="ap-dim-cond" class="ap-ta">${esc(JSON.stringify(d.cond || null))}</textarea>
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

    $('ap-dim-save').addEventListener('click', async () => {
      let cond = null;
      const raw = $('ap-dim-cond').value.trim();
      if (raw && raw !== 'null') {
        try { cond = JSON.parse(raw); }
        catch { Admin.toast('cond 不是合法 JSON', 'error'); return; }
      }
      try {
        await Admin.put(`/appearance/manage/dims/${dimId}`, {
          name: $('ap-dim-name').value,
          group: $('ap-dim-group').value,
          sensitive: $('ap-dim-sens').value === '1',
          is_color: $('ap-dim-color').value === '1',
          cond,
        });
        await renderManage();
        Admin.toast('维度已保存', 'success');
      } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
    });

    $('ap-dim-del').addEventListener('click', async () => {
      if (!await Admin.confirm('删除该维度？已保存的人物外观里该键会被忽略。')) return;
      await Admin.del(`/appearance/manage/dims/${dimId}`);
      activeDim = '';
      await renderManage();
    });

    $('ap-opt-add').addEventListener('click', async () => {
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
        await renderManage();
        Admin.toast('已新增', 'success');
      } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
    });

    $('ap-dim-editor').querySelectorAll('[data-osave]').forEach(b => {
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
    $('ap-dim-editor').querySelectorAll('[data-omove]').forEach(b => {
      b.addEventListener('click', async () => {
        await Admin.post(`/appearance/manage/dims/${dimId}/options/${b.dataset.omove}/move`, { delta: -1 });
        await renderManage();
      });
    });
    $('ap-dim-editor').querySelectorAll('[data-odel]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!await Admin.confirm('删除该选项？')) return;
        await Admin.del(`/appearance/manage/dims/${dimId}/options/${b.dataset.odel}`);
        await renderManage();
      });
    });
  }

  function renderThemes() {
    $('ap-theme-list').innerHTML = (state.themes || []).map(t => `
      <div class="ap-theme">
        <div class="ap-theme-h"><b>${esc(t.name)}</b>
          <span class="ap-chip">${esc(t.id)}</span>
          ${t.nationality ? `<span class="ap-chip">${esc(t.nationality)}</span>` : ''}
          <span class="ap-pose-ops"><button data-tedit="${esc(t.id)}">编辑</button></span>
        </div>
        <div class="ap-pose-cn">${esc(t.desc || t.cn || '')}</div>
        <div class="ap-hint">收敛维度：${esc((t.pool_dims || []).join('、') || '无')}</div>
      </div>`).join('') || '<div class="ap-empty">还没有题材</div>';

    $('ap-theme-list').querySelectorAll('[data-tedit]').forEach(b => {
      b.addEventListener('click', () => editTheme(b.dataset.tedit));
    });
  }

  async function editTheme(themeId) {
    const raw = await Admin.get('/appearance/manage/raw');
    const t = (raw.themes || []).find(x => x.id === themeId) || {};
    const d = await prompt2('编辑题材', [
      { name: 'name', label: '题材名', value: t.name || '' },
      { name: 'desc', label: '说明', value: t.desc || '' },
      { name: 'cn', label: '题材描述（拼进提示词）', type: 'textarea', value: t.cn || '' },
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
      state.themes = await Admin.get('/appearance/themes');
      renderThemes();
      refreshBatchThemes();
      Admin.toast('题材已保存', 'success');
    } catch (e) { Admin.toast('保存失败：' + e.message, 'error'); }
  }

  $('ap-mg-reset').addEventListener('click', async () => {
    if (!await Admin.confirm('恢复出厂定义？自定义的分组/维度/选项/题材都会被覆盖（人物数据不受影响）。')) return;
    await Admin.post('/appearance/manage/reset', {});
    await renderManage();
    await mountEditor();
    Admin.toast('已恢复默认定义', 'success');
  });

  $('ap-theme-add').addEventListener('click', async () => {
    const d = await prompt2('新增题材', [
      { name: 'id', label: '题材 id（英文，唯一）', value: '' },
      { name: 'name', label: '题材名', value: '' },
      { name: 'cn', label: '题材描述（拼进提示词）', type: 'textarea', value: '' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/appearance/manage/themes', { id: d.id || null, name: d.name, cn: d.cn, desc: '' });
      state.themes = await Admin.get('/appearance/themes');
      renderThemes(); refreshBatchThemes();
      Admin.toast('已新增题材', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  $('ap-dim-add').addEventListener('click', async () => {
    const d = await prompt2('新增维度', [
      { name: 'id', label: '维度 id（英文，唯一）', value: '' },
      { name: 'name', label: '显示名', value: '' },
      { name: 'group', label: `所属分组 id（${state.defs.groups.map(g => g.id).join(' / ')}）`, value: state.defs.groups[0]?.id || 'meta' },
      { name: 'sensitive', label: '成人维度（1/0）', value: '0' },
    ]);
    if (!d || !d.name) return;
    try {
      await Admin.post('/appearance/manage/dims', {
        id: d.id || null, name: d.name, group: d.group,
        sensitive: d.sensitive === '1', is_color: false, cond: null,
      });
      await renderManage();
      Admin.toast('已新增维度，记得去加选项', 'success');
    } catch (e) { Admin.toast('新增失败：' + e.message, 'error'); }
  });

  function refreshBatchThemes() {
    const sel = $('ap-b-theme');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">不限定</option>' +
      (state.themes || []).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    sel.value = cur;
  }

  // ==================== 初始化 ====================
  try {
    state.defs = await Admin.get('/appearance/defs?include_sensitive=0');
    state.themes = await Admin.get('/appearance/themes');
    refreshBatchThemes();
    try {
      const cfg = await Admin.get('/comfyui/config');
      state.includeSensitive = !!cfg.include_sensitive;
      $('ap-sensitive').value = state.includeSensitive ? '1' : '0';
    } catch (_) {}
    await loadChars();
    await mountEditor();
    await loadLibrary();
  } catch (e) {
    container.innerHTML = `<div class="table-empty">初始化失败：${esc(e.message)}</div>`;
  }

  // ==================== 样式 ====================
  function ensureStyle() {
    if (document.getElementById('ap-style-tag')) return;
    const s = document.createElement('style');
    s.id = 'ap-style-tag';
    s.textContent = `
      .ap-wrap{padding:12px 16px;max-width:1500px;margin:0 auto}
      .ap-tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border)}
      .ap-tab{background:none;border:none;color:var(--text-muted);padding:7px 16px;cursor:pointer;
        font-size:13px;border-bottom:2px solid transparent}
      .ap-tab.active{color:var(--gold);border-bottom-color:var(--gold)}
      .ap-pane{display:none}.ap-pane.active{display:block}
      .ap-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:10px}
      .ap-field{display:flex;flex-direction:column;gap:2px}
      .ap-field>span{font-size:10px;color:var(--text-muted)}
      .ap-sel,.ap-inp,.ap-ta{background:var(--bg-input);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:12px;padding:3px 6px;height:26px}
      .ap-ta{height:auto;min-height:52px;width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}
      .ap-btn{font-size:12px;padding:4px 11px;border-radius:4px;border:1px solid var(--border);
        background:transparent;color:var(--text-primary);cursor:pointer;white-space:nowrap}
      .ap-btn:hover{border-color:var(--gold);color:var(--gold)}
      .ap-btn.primary{background:var(--gold);border-color:var(--gold);color:#000}
      .ap-btn.xs{font-size:11px;padding:2px 7px}
      .ap-hint{font-size:11px;color:var(--text-muted)}
      .ap-batch{border:1px solid var(--border);border-radius:6px;background:var(--bg-input);padding:10px;margin-bottom:12px}
      .ap-batch-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
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
      .ap-poses{padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
        gap:6px;max-height:560px;overflow:auto}
      .ap-pose{border:1px solid var(--border);border-radius:5px;padding:5px 8px;background:var(--bg-card,#151515)}
      .ap-pose-head{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-primary)}
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
    `;
    document.head.appendChild(s);
  }
});
