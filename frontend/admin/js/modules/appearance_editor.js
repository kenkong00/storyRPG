// ========== 外观拼装编辑器（人物管理 & 拼装页共用） ==========
// 目标：一套紧凑、可分组折叠的维度编辑器，支持
//   整体随机 / 按题材随机 / 单个维度单独随机 / 条件维度自动显隐 / 中文提示词实时预览
// 用法：
//   const ed = await AppearanceEditor.mount(hostEl, appearance, { includeSensitive, onDirty });
//   ed.getAppearance(); ed.setAppearance(a); ed.randomAll(themeId);
(function () {
  if (window.AppearanceEditor) return;

  const EXCLUDE = new Set(['gender', 'age', 'role', 'nationality', 'mode', 'nudity',
    'framing', 'pose', 'poseCategory', 'expression']);
  // 工具栏只留「国族 / 性别 / 年龄」，身份·性格·风格定位已从维度库移除
  const GLOBAL_DIMS = ['nationality', 'gender', 'age'];

  let cache = { defs: null, sensitive: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureStyle() {
    if (document.getElementById('ae-style-tag')) return;
    const s = document.createElement('style');
    s.id = 'ae-style-tag';
    s.textContent = `
      .ae-root{font-size:13px}
      .ae-toolbar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;margin-bottom:10px;
        background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);padding:9px 12px}
      .ae-field{display:flex;flex-direction:column;gap:3px;min-width:0}
      .ae-field>span{font-size:12px;color:var(--text-muted);letter-spacing:.02em}
      .ae-sel,.ae-inp{background:var(--bg-card,#1a1a1a);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:13px;padding:0 6px;height:30px;max-width:180px;box-sizing:border-box}
      .ae-sel:focus,.ae-inp:focus{outline:1px solid var(--gold)}
      .ae-actions{display:flex;gap:6px;margin-left:auto;align-items:flex-end}
      .ae-btn{font-size:12px;padding:6px 12px;border-radius:4px;border:1px solid var(--border);
        background:transparent;color:var(--text-primary);cursor:pointer;white-space:nowrap}
      .ae-btn:hover{border-color:var(--gold);color:var(--gold)}
      .ae-btn.primary{background:var(--gold);border-color:var(--gold);color:#000;font-weight:600}
      .ae-btn.primary:hover{filter:brightness(1.1);color:#000}
      /* 分栏（多列流式）排版：短分组后面不会留一大块空白，整体不再「错开」 */
      .ae-groups{column-width:300px;column-gap:10px}
      .ae-group{border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-input);
        break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 10px;display:block}
      .ae-group-head{display:flex;align-items:center;gap:6px;padding:6px 9px;cursor:pointer;
        background:rgba(201,168,76,.10);font-size:12.5px;font-weight:600;color:var(--gold);user-select:none}
      .ae-group-head .n{margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:400}
      .ae-group.collapsed .ae-rows{display:none}
      .ae-group-blank .ae-rows{padding:6px 9px 9px}
      /* 自定义追加词：醒目的整框分区（位于分组之前） */
      .ae-free-sec{margin:0 0 10px}
      .ae-free-sec .ae-free-desc{font-size:11.5px;color:var(--text-muted);line-height:1.55;margin-bottom:6px}
      .ae-free-ta{width:100%;box-sizing:border-box;min-height:84px;max-height:220px;resize:vertical;
        background:var(--bg-card,#1a1a1a);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);
        font-size:13px;line-height:1.6;padding:8px;font-family:inherit}
      .ae-free-ta:focus{outline:1px solid var(--gold)}
      .ae-free-ta::placeholder{color:var(--text-muted);opacity:.7}
      .ae-blank-note{font-size:11.5px;color:var(--text-muted);line-height:1.55}
      .ae-nude-hint{font-size:11.5px;color:var(--gold);opacity:.85;line-height:1.55;
        padding:3px 0 5px;border-bottom:1px dashed var(--border);margin-bottom:4px}
      .ae-rows{padding:6px 8px 8px}
      .ae-row{display:flex;align-items:center;gap:6px;padding:2px 0}
      .ae-row.hide{display:none}
      .ae-label{font-size:12.5px;color:var(--text-muted);width:80px;flex:0 0 80px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ae-row .ae-sel{flex:1;min-width:0;max-width:none}
      .ae-dice{flex:0 0 auto;width:26px;height:26px;line-height:1;padding:0;font-size:13px;
        border:1px solid transparent;background:transparent;color:var(--text-muted);cursor:pointer;border-radius:3px}
      .ae-dice:hover{color:var(--gold);border-color:var(--border);background:rgba(255,255,255,.04)}
      .ae-prompt{margin-top:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-input)}
      .ae-prompt-head{display:flex;align-items:center;gap:8px;padding:6px 9px;background:rgba(255,255,255,.03);
        font-size:12px;color:var(--text-muted)}
      .ae-prompt-head .sp{margin-left:auto}
      .ae-prompt pre,.ae-prompt textarea{margin:0;padding:9px;font-size:12.5px;line-height:1.65;white-space:pre-wrap;
        color:var(--text-primary);max-height:230px;overflow:auto;
        font-family:ui-monospace,Menlo,Consolas,monospace}
      /* 提示词框可直接改；改完能立刻复制 / 出图就用这段 */
      .ae-prompt textarea{display:block;width:100%;box-sizing:border-box;height:200px;min-height:120px;
        border:none;outline:none;resize:vertical;background:transparent;tab-size:2}
      .ae-prompt textarea:focus{background:rgba(201,168,76,.06)}
      .ae-prompt.edited .ae-prompt-head{color:var(--gold)}
      .ae-hint{font-size:11.5px;color:var(--text-muted)}
      .ae-pose-filter{display:flex;align-items:center;gap:4px;padding:2px 0 4px}
      .ae-pose-filter select{flex:1}
      /* ---- 左右分栏：左边维度、右边提示词 ---- */
      .ae-split .ae-body{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:12px;align-items:start}
      .ae-split .ae-groups{column-width:264px}
      .ae-split .ae-side{position:sticky;top:0}
      .ae-split .ae-prompt{margin-top:0}
      .ae-split .ae-prompt pre{max-height:min(52vh,520px)}
      .ae-split .ae-prompt textarea{height:min(52vh,520px)}
      .ae-live{font-size:11px;color:var(--gold);opacity:.9;margin-top:6px;line-height:1.6}
    `;
    document.head.appendChild(s);
  }

  async function loadDefs(includeSensitive) {
    const key = !!includeSensitive;
    if (cache.defs && cache.sensitive === key) return cache.defs;
    const d = await Admin.get(`/appearance/defs?include_sensitive=${key}`);
    cache.defs = d;
    cache.sensitive = key;
    return d;
  }

  function indexDims(defs) {
    const map = {};
    (defs.groups || []).forEach(g => g.dims.forEach(d => { d._group = g.id; map[d.id] = d; }));
    return map;
  }

  function condMet(spec, c) {
    if (!spec) return true;
    if (spec.gender && c.gender !== spec.gender) return false;
    const band = ageBand(c.age);
    if (spec.not_band && band && spec.not_band.includes(band)) return false;
    if (spec.not_age) {
      const vals = spec.not_age.map(String);
      if (vals.includes(String(c.age)) || (band && vals.includes(band))) return false;
    }
    if (spec.requires) {
      for (const dim in spec.requires) {
        if (!spec.requires[dim].includes(c[dim])) return false;
      }
    }
    return true;
  }

  function ageBand(age) {
    const n = parseInt(age, 10);
    if (isNaN(n)) return age || '';
    if (n <= 6) return 'toddler';
    if (n <= 12) return 'child';
    if (n <= 17) return 'teen';
    if (n <= 25) return 'young';
    if (n <= 40) return 'adult';
    if (n <= 55) return 'middle';
    if (n <= 70) return 'elder';
    return 'senior';
  }

  function optionSel(dim, value, attrs) {
    const opts = [{ id: '', name: '（默认）' }].concat(dim.options || []);
    return `<select class="ae-sel" ${attrs}>` + opts.map(o =>
      `<option value="${esc(o.id)}"${o.id === value ? ' selected' : ''}>${esc(o.name)}</option>`
    ).join('') + '</select>';
  }

  // ---------------- 主入口 ----------------
  async function mount(host, appearance, opts = {}) {
    ensureStyle();
    const defs = await loadDefs(!!opts.includeSensitive);
    const dims = indexDims(defs);
    const state = {
      app: Object.assign({}, appearance || {}),
      changed: false,
    };
    if (!state.app.mode) state.app.mode = 'default';
    if (!state.app.nudity) state.app.nudity = 'none';
    if (!state.app.framing) state.app.framing = 'full';

    const split = opts.layout === 'split';
    host.innerHTML = `
      <div class="ae-root${split ? ' ae-split' : ''}">
        <div class="ae-toolbar">
          <button class="ae-btn" id="ae-reset" title="把所有参数归为默认（无）；不影响自定义文字框">🔄 重置</button>
          <label class="ae-field"><span>题材（定向随机）</span>
            <select class="ae-sel" id="ae-theme">
              <option value="">全部 / 不限定</option>
              ${(defs.themes || []).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
            </select>
          </label>
          <label class="ae-field"><span>姓名</span>
            <input class="ae-inp" id="ae-name" value="${esc(state.app.name || '')}" placeholder="角色姓名（留空出图不加）" style="min-width:130px">
          </label>
          ${GLOBAL_DIMS.filter(id => dims[id]).map(id => `
            <label class="ae-field"><span>${esc(dims[id].name)}</span>
              ${optionSel(dims[id], state.app[id] || '', `id="ae-g-${id}"`)}
            </label>`).join('')}
          ${dims.nudity ? `<label class="ae-field"><span>${esc(dims.nudity.name)}</span>
            ${optionSel(dims.nudity, state.app.nudity || 'none', 'id="ae-g-nudity"')}
          </label>` : ''}
          ${dims.framing ? `<label class="ae-field"><span>${esc(dims.framing.name)}</span>
            ${optionSel(dims.framing, state.app.framing || 'full', 'id="ae-g-framing"')}
          </label>` : `<label class="ae-field"><span>立绘取景</span>
            <select class="ae-sel" id="ae-g-framing">
              <option value="full"${state.app.framing !== 'half' ? ' selected' : ''}>全身</option>
              <option value="half"${state.app.framing === 'half' ? ' selected' : ''}>半身</option>
            </select>
          </label>`}
          <div class="ae-actions">
            <button class="ae-btn" id="ae-random">🎲 整体随机</button>
            <button class="ae-btn primary" id="ae-save">💾 保存外观</button>
          </div>
        </div>
        <div class="ae-body">
          <div class="ae-main">
            <section class="ae-group ae-free-sec">
              <div class="ae-group-head"><span>✎</span><span>自定义追加词</span>
                <span class="n">接在提示词末尾</span></div>
              <div class="ae-rows">
                <div class="ae-free-desc">下面的内容会接在拼装提示词的末尾，属于提示词的一部分（留空＝无）。例如：眼神锐利，背景飘落樱花，电影感打光。</div>
                <textarea id="ae-free" class="ae-free-ta" spellcheck="false" placeholder="例如：眼神锐利，背景有飘落的樱花，电影感打光">${esc(state.app.free_text || '')}</textarea>
              </div>
            </section>
            <div class="ae-groups" id="ae-groups"></div>
          </div>
          <div class="ae-side">
            <div class="ae-prompt" id="ae-prompt-box">
              <div class="ae-prompt-head">
                <span>中文正向提示词（可编辑，出图就用这段）</span>
                <span class="sp"></span>
                <button class="ae-btn" id="ae-copy">复制</button>
                <button class="ae-btn" id="ae-neg">负面</button>
              </div>
              <textarea id="ae-pos" spellcheck="false"></textarea>
              <pre id="ae-negtext" style="display:none;color:var(--text-muted)"></pre>
            </div>
            <div class="ae-live" id="ae-live"></div>
            <div class="ae-hint" id="ae-hint"></div>
          </div>
        </div>
      </div>
    `;

    // ---------- 分组渲染 ----------
    const groupsHost = host.querySelector('#ae-groups');
    const order = ['basic', 'head', 'body', 'feat', 'cloth', 'pose', 'meta'];
    const groups = [...(defs.groups || [])].sort(
      (a, b) => (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) -
                (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)));

    groupsHost.innerHTML = groups.map(g => {
      const list = g.dims.filter(d => !EXCLUDE.has(d.id));
      if (!list.length) return '';
      return `<section class="ae-group" data-group="${esc(g.id)}">
        <div class="ae-group-head"><span>${esc(g.icon || '')}</span><span>${esc(g.name)}</span>
          <span class="n">${list.length}</span></div>
        <div class="ae-rows">
          ${list.map(d => {
            if (d.id === 'poseCategory') {
              return `<div class="ae-row" data-dim="poseCategory">
                <span class="ae-label">${esc(d.name)}</span>
                ${optionSel(d, state.app.poseCategory || '', 'data-dim="poseCategory"')}
                <button class="ae-dice" data-dice="poseCategory" title="单独随机">🎲</button>
              </div>`;
            }
            return `<div class="ae-row" data-dim="${esc(d.id)}">
              <span class="ae-label" title="${esc(d.name)}">${esc(d.name)}</span>
              ${optionSel(d, state.app[d.id] || '', `data-dim="${esc(d.id)}"`)}
              <button class="ae-dice" data-dice="${esc(d.id)}" title="单独随机">🎲</button>
            </div>`;
          }).join('')}
        </div>
      </section>`;
    }).join('');

    groupsHost.querySelectorAll('.ae-group-head').forEach(h => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
    });

    // ---------- 显隐 ----------
    function refreshVisibility() {
      groupsHost.querySelectorAll('.ae-row').forEach(row => {
        const id = row.dataset.dim;
        const d = dims[id];
        if (!d) return;
        row.classList.toggle('hide', !condMet(d.cond, state.app));
      });
      // 裸露状态下，把上/下装相关行也藏起来，避免「全裸还能选上衣」
      const nud = state.app.nudity || 'none';
      const hideOnNude = {
        full: ['top', 'topColor', 'topPattern', 'sleeve', 'outer', 'outerColor',
          'bottom', 'bottomColor', 'shoes', 'shoeColor', 'socks', 'belt',
          'neckwear', 'gloves', 'backpack', 'prop'],
        upper: ['top', 'topColor', 'topPattern', 'sleeve', 'outer', 'outerColor'],
        lower: ['bottom', 'bottomColor', 'socks'],
      }[nud] || [];
      hideOnNude.forEach(id => {
        const row = groupsHost.querySelector(`.ae-row[data-dim="${id}"]`);
        if (row) row.classList.add('hide');
      });
      // 裸露状态下手动藏掉衣物行 → 在「穿着打扮」组顶加一句说明，
      // 否则用户只看到裸露状态下拉，以为其余选项丢了
      const clothGroup = groupsHost.querySelector('.ae-group[data-group="cloth"]');
      if (clothGroup) {
        let hint = clothGroup.querySelector('.ae-nude-hint');
        const label = { full: '全身赤裸', upper: '上半身赤裸', lower: '下半身赤裸' }[nud] || '';
        if (label && hideOnNude.length) {
          if (!hint) {
            hint = document.createElement('div');
            hint.className = 'ae-nude-hint';
            clothGroup.querySelector('.ae-rows')?.prepend(hint);
          }
          hint.textContent = `${label}：对应的衣物选项已隐藏，改成「完整着装」后会重新出现`;
        } else if (hint) {
          hint.remove();
        }
      }
      // 整组都被条件隐藏时（例如全身赤裸时的「穿着打扮」），补一句说明，
      // 否则卡片只剩个标题，看起来像坏了
      groupsHost.querySelectorAll('.ae-group').forEach(g => {
        const rows = [...g.querySelectorAll('.ae-row')];
        const alive = rows.filter(r => !r.classList.contains('hide')).length;
        g.classList.toggle('ae-group-blank', rows.length > 0 && alive === 0);
        let note = g.querySelector('.ae-blank-note');
        if (rows.length > 0 && alive === 0) {
          if (!note) {
            note = document.createElement('div');
            note.className = 'ae-blank-note';
            g.querySelector('.ae-rows')?.appendChild(note);
          }
          note.textContent = nud === 'full'
            ? '全身赤裸：衣物相关选项已隐藏'
            : '当前状态下该组不适用';
        } else if (note) {
          note.remove();
        }
      });
    }

    // ---------- 动作下拉随分类收敛 ----------
    function refreshPoseOptions() {
      const poseDim = dims['pose'];
      const row = groupsHost.querySelector('.ae-row[data-dim="pose"]');
      if (!poseDim || !row) return;
      const sel = row.querySelector('select');
      const cat = state.app.poseCategory || '';
      const list = (poseDim.options || []).filter(o => !cat || o.cat === cat);
      const cur = state.app.pose || '';
      sel.innerHTML = `<option value="">（默认）</option>` + list.map(o =>
        `<option value="${esc(o.id)}"${o.id === cur ? ' selected' : ''}>${esc(o.name)}</option>`
      ).join('');
      if (cur && !list.some(o => o.id === cur)) {
        // 换了分类，原动作不属于新分类 → 清空
        delete state.app.pose;
        sel.value = '';
      }
    }

    // ---------- 立绘取景提示 ----------
    function refreshFramingHint() {
      const hint = host.querySelector('#ae-hint');
      if (!hint) return;
      if (state.app.framing === 'half') {
        hint.textContent = '半身取景：腰部以下（腿 / 鞋 / 裙摆等）不做提示词描写，出图聚焦上半身。';
      } else {
        hint.textContent = '全身取景：完整身体描写。';
      }
    }

    // ---------- 提示词 ----------
    // 这个框可以直接改：手动改完，「复制」和「出图」都用框里的内容；
    // 但只要上面任何一个参数变了，就重新生成并**覆盖**手动内容（按用户要求）。
    let promptTimer = null;
    let lastPrompt = '';
    let promptEdited = false;
    let generatedPrompt = '';

    function promptBox() {
      return host.querySelector('#ae-prompt-box');
    }

    function setPromptLive(msg) {
      const live = host.querySelector('#ae-live');
      if (live) live.textContent = msg || '';
    }

    async function refreshPrompt() {
      clearTimeout(promptTimer);
      promptTimer = setTimeout(async () => {
        const posEl = host.querySelector('#ae-pos');
        if (!posEl) return;
        const hadEdit = promptEdited;
        try {
          const r = await Admin.post('/appearance/prompt',
            { appearance: state.app, include_sensitive: !!opts.includeSensitive });
          const p = r.prompt || {};
          const text = p.posCn || '';
          posEl.value = text;
          generatedPrompt = text;
          promptEdited = false;
          promptBox()?.classList.remove('edited');
          if (hadEdit) {
            setPromptLive('参数已变化，提示词重新生成，之前的手动修改已被覆盖');
            setTimeout(() => { if (!promptEdited) setPromptLive(''); }, 2600);
          } else if (lastPrompt && text !== lastPrompt) {
            setPromptLive('✓ 提示词已更新');
            setTimeout(() => { if (!promptEdited) setPromptLive(''); }, 2000);
          }
          lastPrompt = text;
          host.querySelector('#ae-negtext').textContent = p.negCn || '';
        } catch (e) {
          posEl.value = '提示词生成失败：' + e.message;
        }
      }, 180);
    }

    // ---------- 单维重摇 ----------
    async function rerollDim(dimId) {
      try {
        const r = await Admin.post('/appearance/reroll', {
          appearance: state.app, dim: dimId,
          include_sensitive: !!opts.includeSensitive,
        });
        state.app = r.appearance;
        syncWholeUI();
        markDirty();
      } catch (e) {
        Admin.toast('随机失败：' + e.message, 'error');
      }
    }

    function syncWholeUI() {
      GLOBAL_DIMS.forEach(id => {
        const el = host.querySelector('#ae-g-' + id);
        if (el) el.value = state.app[id] || '';
      });
      const nudEl = host.querySelector('#ae-g-nudity');
      if (nudEl) nudEl.value = state.app.nudity || 'none';
      const frEl = host.querySelector('#ae-g-framing');
      if (frEl) frEl.value = state.app.framing || 'full';
      // 姓名 / 自定义追加词 / 题材 同步回控件（整体随机或重置后保持视觉一致）
      const nameEl = host.querySelector('#ae-name');
      if (nameEl) nameEl.value = state.app.name || '';
      const freeEl = host.querySelector('#ae-free');
      if (freeEl) freeEl.value = state.app.free_text || '';
      const themeEl = host.querySelector('#ae-theme');
      if (themeEl) themeEl.value = state.app.theme || '';
      refreshFramingHint();
      groupsHost.querySelectorAll('.ae-row').forEach(row => {
        const id = row.dataset.dim;
        const sel = row.querySelector('select');
        if (sel) sel.value = state.app[id] || '';
      });
      refreshPoseOptions();
      refreshVisibility();
      refreshPrompt();
    }

    function markDirty() {
      state.changed = true;
      if (opts.onChange) opts.onChange(state.app);
    }

    // ---------- 事件绑定 ----------
    GLOBAL_DIMS.forEach(id => {
      const el = host.querySelector('#ae-g-' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        state.app[id] = el.value;
        if ((id === 'gender' || id === 'age') && opts.includeSensitive === false) {
          // 性别/年龄变化可能让敏感维度失效，交给后端 normalize 处理即可
        }
        if (id === 'nationality') {
          // 国籍变化时，若当前没有题材，尝试带出对应文化（仅提示，不强制）
        }
        refreshPoseOptions();
        refreshVisibility();
        refreshPrompt();
        markDirty();
      });
    });

    // 裸露状态（工具栏控件，已上提，原在分组内）
    const nudEl = host.querySelector('#ae-g-nudity');
    if (nudEl) nudEl.addEventListener('change', () => {
      state.app.nudity = nudEl.value;
      // 换了裸露状态，顺手清掉不该存在的衣物键
      const clear = {
        full: ['top', 'topColor', 'topPattern', 'sleeve', 'outer', 'outerColor',
          'bottom', 'bottomColor', 'shoes', 'shoeColor', 'socks', 'belt',
          'neckwear', 'gloves', 'backpack', 'prop'],
        upper: ['top', 'topColor', 'topPattern', 'sleeve', 'outer', 'outerColor'],
        lower: ['bottom', 'bottomColor', 'socks'],
      }[nudEl.value] || [];
      clear.forEach(k => delete state.app[k]);
      syncWholeUI();
      markDirty();
    });

    // 立绘取景（全身 / 半身）
    const frEl = host.querySelector('#ae-g-framing');
    if (frEl) frEl.addEventListener('change', () => {
      state.app.framing = frEl.value;
      refreshFramingHint();
      refreshPrompt();
      markDirty();
    });

    // 姓名（拼装进提示词的人物名）
    const nameEl = host.querySelector('#ae-name');
    if (nameEl) nameEl.addEventListener('input', () => {
      state.app.name = nameEl.value;
      refreshPrompt();
      markDirty();
    });

    // 自定义追加词（接在提示词末尾，属于拼装的一部分；重置不影响它）
    const freeEl = host.querySelector('#ae-free');
    if (freeEl) freeEl.addEventListener('input', () => {
      state.app.free_text = freeEl.value;
      refreshPrompt();
      markDirty();
    });

    // 重置按钮：把所有维度参数归为默认（无 / 填空），但保留
    // 裸露状态、立绘取景、自定义追加词（用户明确要求这三处不受重置影响）。
    const resetEl = host.querySelector('#ae-reset');
    if (resetEl) resetEl.addEventListener('click', () => {
      GLOBAL_DIMS.forEach(id => { state.app[id] = ''; });
      groupsHost.querySelectorAll('.ae-row').forEach(row => {
        const id = row.dataset.dim;
        if (id && id !== 'nudity' && id !== 'framing') {
          delete state.app[id];
        }
      });
      delete state.app.theme;
      // nudity / framing / free_text / name 保留不动
      syncWholeUI();
      refreshPrompt();
      markDirty();
      Admin.toast('已重置：所有外观参数归默认（外观状态 / 立绘取景 / 自定义追加词不变）', 'success');
    });

    groupsHost.querySelectorAll('.ae-row select').forEach(sel => {
      sel.addEventListener('change', () => {
        const dim = sel.dataset.dim;
        if (!dim) return;
        if (sel.value) state.app[dim] = sel.value; else delete state.app[dim];
        if (dim === 'poseCategory') refreshPoseOptions();
        if (dim === 'nudity') {
          // 换了裸露状态，顺手清掉不该存在的衣物键
          const clear = {
            full: ['top', 'topColor', 'topPattern', 'sleeve', 'outer', 'outerColor',
              'bottom', 'bottomColor', 'shoes', 'shoeColor', 'socks', 'belt',
              'neckwear', 'gloves', 'backpack', 'prop'],
            upper: ['top', 'topColor', 'topPattern', 'sleeve', 'outer', 'outerColor'],
            lower: ['bottom', 'bottomColor', 'socks'],
          }[sel.value] || [];
          clear.forEach(k => delete state.app[k]);
          syncWholeUI();
        }
        refreshVisibility();
        refreshPrompt();
        markDirty();
      });
    });

    groupsHost.querySelectorAll('.ae-dice').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        rerollDim(b.dataset.dice);
      });
    });

    host.querySelector('#ae-random').addEventListener('click', async () => {
      const theme = host.querySelector('#ae-theme').value || undefined;
      try {
        const body = {
          theme,
          gender: state.app.gender || undefined,
          age: state.app.age || undefined,
          style: theme ? undefined : (state.app.style || undefined),
          nationality: theme ? undefined : (state.app.nationality || undefined),
          pose_category: state.app.poseCategory || undefined,
          include_sensitive: !!opts.includeSensitive,
        };
        const r = await Admin.post('/appearance/random', body);
        const keepFraming = state.app.framing;
        const keepNudity = state.app.nudity;
        state.app = r.appearance;
        if (keepFraming) state.app.framing = keepFraming;
        if (keepNudity) state.app.nudity = keepNudity;
        syncWholeUI();
        markDirty();
        Admin.toast('已随机生成' + (theme ? '（' + theme + '）' : ''), 'success');
      } catch (e) {
        Admin.toast('随机失败：' + e.message, 'error');
      }
    });

    host.querySelector('#ae-save').addEventListener('click', () => {
      if (opts.onSave) opts.onSave(state.app);
    });

    // 手动编辑提示词：标记为「已改」，出图与复制都用框里的内容
    host.querySelector('#ae-pos').addEventListener('input', () => {
      const posEl = host.querySelector('#ae-pos');
      if (!posEl) return;
      const edited = posEl.value !== generatedPrompt;
      if (edited !== promptEdited) {
        promptEdited = edited;
        promptBox()?.classList.toggle('edited', edited);
        setPromptLive(edited ? '已手动编辑 · 上面任一参数变化会被重新生成的提示词覆盖' : '');
      }
    });

    host.querySelector('#ae-copy').addEventListener('click', async () => {
      const txt = host.querySelector('#ae-pos').value || '';
      try {
        await navigator.clipboard.writeText(txt);
        Admin.toast('提示词已复制', 'success');
      } catch {
        Admin.toast('复制失败，请手动选择', 'error');
      }
    });

    host.querySelector('#ae-neg').addEventListener('click', (e) => {
      const neg = host.querySelector('#ae-negtext');
      const show = neg.style.display === 'none';
      neg.style.display = show ? '' : 'none';
      e.currentTarget.textContent = show ? '收起负面' : '负面';
    });

    // ---------- 初始化 ----------
    refreshPoseOptions();
    refreshVisibility();
    refreshFramingHint();
    refreshPrompt();
    if (defs.themes && defs.themes.length && state.app.theme) {
      const th = host.querySelector('#ae-theme');
      if (th) th.value = state.app.theme;
    }

    return {
      getAppearance: () => Object.assign({}, state.app),
      setAppearance: (a) => { state.app = Object.assign({}, a || {}); syncWholeUI(); },
      isDirty: () => state.changed,
      refresh: () => syncWholeUI(),
      // 提示词框的当前内容（可能被手动改过）；出图时优先用它
      getPromptText: () => (host.querySelector('#ae-pos')?.value || '').trim(),
      isPromptEdited: () => promptEdited,
      dims,
      defs,
    };
  }

  window.AppearanceEditor = { mount, esc, ageBand, condMet };
})();
