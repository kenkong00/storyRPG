// ========== 出图参数面板（按作用域隔离，各出图入口互不串扰） ==========
// 背景：以前「动作表情」里尺寸是写死的 832×1216，别的页面要出图又各自写一份，
// 用户根本不知道当前会用多大的图，也没法调。
//
// 现在参数存在服务端（/api/comfyui/gen-params?scope=xxx），前端这个组件负责渲染它。
// 作用域（scope）让不同出图入口用各自独立的配置，互不污染：
//   global     —— ComfyUI 设置面板（全局默认）
//   scenes     —— 场景出图（场景管理 / 场景合成）
//   characters —— 人物动作表情 / 人物外观出图
// 任何一处改动 → 写回服务端（带 scope）→ 只广播给同作用域的面板，跨作用域互不影响。
//
// 用法：
//   const p = await GenParams.mount(hostEl, { scope: 'characters' });
//   GenParams.get('characters')   // 起任务时取当前作用域参数
//   GenParams.onChange(fn, 'characters')   // 同作用域改了参数时通知我
//   GenParams.summary('characters')        // "832×1216 · Moss_8步_透明底"
(function () {
  if (window.GenParams) return;

  const API = '/comfyui';   // Admin.get 自带 /api 前缀
  const S = {
    byScope: {},          // scope -> 参数对象
    loadingByScope: {},
    timerByScope: {},
    savedByScope: {},
    presets: [],          // 模型方案名（全局配置，不随 scope 变）
    sizePresets: [],
    activePreset: '',
  };
  const subs = new Set();      // 每项 { fn, scope }
  const instances = new Set(); // 每项 { host, opts, scope, repaint, params }

  const SCOPE_LABEL = {
    global: { tag: '全局出图参数', title: '这份参数是全局的：任何一处改动，其它出图入口同步生效' },
    scenes: { tag: '场景出图参数', title: '仅作用于场景出图，与人物 / 全局配置互不影响' },
    characters: { tag: '人物出图参数', title: '仅作用于人物动作表情 / 外观出图，与场景 / 全局配置互不影响' },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureStyle() {
    if (document.getElementById('gp-style-tag')) return;
    const st = document.createElement('style');
    st.id = 'gp-style-tag';
    st.textContent = `
      .gp-bar{display:grid;grid-template-columns:repeat(9,minmax(104px,1fr)) 112px;
        gap:9px 12px;align-items:end;
        background:var(--bg-input);border:1px solid var(--border);border-radius:6px;
        padding:10px 13px 12px}
      .gp-bar .gp-tag{grid-column:1/-1;font-size:11px;color:var(--gold);border:1px solid var(--gold);
        border-radius:10px;padding:2px 9px;align-self:start;justify-self:start;
        white-space:nowrap;margin-bottom:-2px}
      .gp-f{display:flex;flex-direction:column;gap:4px;min-width:0;justify-content:flex-end}
      /* 宽 × 高 占两格：中间要塞一个对调按钮，一格放不下两个 4 位数字框 */
      .gp-f.wh{grid-column:span 2}
      .gp-f>span{font-size:12px;color:var(--text-muted);white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;height:17px;line-height:17px}
      .gp-f .row{display:flex;align-items:center;gap:4px}
      .gp-f .row .gp-sel{flex:0 0 76px;width:76px;min-width:0}
      .gp-f .row .gp-inp{flex:1 1 0;width:auto;min-width:0}
      .gp-sel,.gp-inp{background:var(--bg-card,#1a1a1a);border:1px solid var(--border);
        border-radius:4px;color:var(--text-primary);font-size:13px;height:32px;padding:0 7px;
        box-sizing:border-box;font-family:inherit;width:100%;min-width:0}
      .gp-sel{min-width:0}
      .gp-inp{width:100%;text-align:center}
      .gp-inp.wide{width:100%}
      .gp-x{color:var(--text-muted);font-size:12px;flex:0 0 auto}
      /* 宽高对调小按钮：夹在宽、高两个输入框中间 */
      .gp-f .gp-swap{flex:0 0 auto;width:26px;height:32px;padding:0;display:flex;align-items:center;justify-content:center;
        border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-muted);
        cursor:pointer;font-size:13px;line-height:1;font-family:inherit}
      .gp-f .gp-swap:hover{color:var(--gold);border-color:var(--gold);background:rgba(201,168,76,.10)}
      .gp-actions{display:flex;align-items:center;gap:8px;justify-self:end;padding-bottom:1px;
        min-width:0;white-space:nowrap}
      .gp-actions button{white-space:nowrap}
      .gp-state{font-size:11px;color:var(--text-muted);min-width:54px;text-align:right}
      .gp-state.ok{color:#7bd88f}
      .gp-more{font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.6}
      .gp-neg{grid-column:1/-1;width:100%;margin-top:2px;background:var(--bg-card,#1a1a1a);
        border:1px solid var(--border);border-radius:4px;color:var(--text-primary);
        font-size:12px;padding:6px 8px;min-height:52px;box-sizing:border-box;
        font-family:inherit;display:none}
      .gp-bar.open .gp-neg{display:block}
      /* 可搜索下拉（模型方案）与数字框同高，避免整排参差不齐 */
      .gp-bar .cb-wrap>input{height:32px;border:1px solid var(--border);
        border-radius:4px 0 0 4px;background:var(--bg-card,#1a1a1a);
        color:var(--text-primary);font-size:13px;padding:0 7px;box-sizing:border-box;width:100%}
      .gp-bar .cb-btn{height:32px;box-sizing:border-box}
      @media (max-width:1280px){
        .gp-bar{grid-template-columns:repeat(4,minmax(0,1fr))}
        .gp-bar .gp-tag{grid-column:1/-1;justify-self:start}
      }
    `;
    document.head.appendChild(st);
  }

  async function load(scope, force) {
    scope = scope || 'global';
    if (S.byScope[scope] && !force) return S.byScope[scope];
    if (S.loadingByScope[scope] && !force) return S.loadingByScope[scope];
    S.loadingByScope[scope] = (async () => {
      const [gp, cfg] = await Promise.all([
        Admin.get(`${API}/gen-params?scope=${encodeURIComponent(scope)}`),
        Admin.get(`${API}/config`).catch(() => ({})),
      ]);
      S.byScope[scope] = gp.params || {};
      S.sizePresets = gp.size_presets || [];
      S.presets = ((cfg && cfg.model_presets) || []).map((p) => p.name);
      if (cfg && cfg.active_model_preset && !S.byScope[scope].model_preset) {
        S.activePreset = cfg.active_model_preset;
      }
      return S.byScope[scope];
    })();
    return S.loadingByScope[scope];
  }

  function notify(scope) {
    instances.forEach((inst) => {
      if (inst.scope !== scope) return;
      if (!inst.host.isConnected) { instances.delete(inst); return; }
      inst.repaint();
    });
    subs.forEach((entry) => {
      if (entry.scope !== scope) return;
      try { entry.fn(S.byScope[scope]); } catch (e) { /* 忽略 */ }
    });
  }

  async function push(patch, scope) {
    scope = scope || 'global';
    const params = S.byScope[scope] || (S.byScope[scope] = {});
    Object.assign(params, patch);
    notify(scope);                             // 本地先同步，同作用域别处立刻看到
    clearTimeout(S.timerByScope[scope]);
    S.timerByScope[scope] = setTimeout(async () => {
      try {
        const r = await Admin.put(`${API}/gen-params?scope=${encodeURIComponent(scope)}`, S.byScope[scope]);
        S.byScope[scope] = r.params || S.byScope[scope];
        S.savedByScope[scope] = Date.now();
        notify(scope);
      } catch (e) {
        Admin.toast('出图参数保存失败：' + e.message, 'error');
      }
    }, 350);
  }

  /** 尺寸预设 → 宽高联动 */
  function applySizePreset(id, scope) {
    const p = (S.sizePresets || []).find((x) => x.id === id);
    if (!p) return push({ size_preset: id }, scope);
    if (id === 'custom') return push({ size_preset: 'custom' }, scope);
    return push({ size_preset: id, width: p.width, height: p.height }, scope);
  }

  function render(host, opts) {
    opts = opts || {};
    const scope = opts.scope || 'global';
    ensureStyle();
    host.innerHTML = `<div class="gp-bar"><span style="font-size:12px;color:var(--text-muted)">加载出图参数…</span></div>`;
    const bar = host.querySelector('.gp-bar');
    const label = SCOPE_LABEL[scope] || SCOPE_LABEL.global;

    const inst = {
      host, opts, scope, params: () => S.byScope[scope],
      repaint,
    };

    function repaint() {
      const p = S.byScope[scope] || {};
      const sizes = S.sizePresets || [];
      const cur = p.size_preset || 'custom';
      const fixed = p.seed_mode === 'fixed';
      bar.innerHTML = `
        <span class="gp-tag" title="${esc(label.title)}">${esc(label.tag)}</span>
        <label class="gp-f"><span>尺寸</span>
          <select class="gp-sel" data-k="size_preset">
            ${sizes.map((s) => `<option value="${esc(s.id)}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}${s.width ? ` ${s.width}×${s.height}` : ''}</option>`).join('')}
          </select>
        </label>
        <label class="gp-f wh"><span>宽 × 高（像素）</span>
          <span class="row">
            <input class="gp-inp" type="number" min="64" max="4096" step="8" data-k="width" value="${esc(p.width || 832)}">
            <button type="button" class="gp-swap" data-act="swap" title="宽高对调（横竖换向）">⇄</button>
            <input class="gp-inp" type="number" min="64" max="4096" step="8" data-k="height" value="${esc(p.height || 1216)}">
          </span>
        </label>
        <label class="gp-f"><span>模型方案</span>
          <span class="row" id="gp-preset-host"></span>
        </label>
        <label class="gp-f"><span title="0 表示使用模型方案自带的步数">步数覆盖</span>
          <input class="gp-inp" type="number" min="0" max="200" data-k="steps" value="${esc(p.steps || 0)}">
        </label>
        <label class="gp-f"><span title="0 表示使用模型方案自带的 CFG">CFG 覆盖</span>
          <input class="gp-inp" type="number" min="0" max="30" step="0.1" data-k="cfg" value="${esc(p.cfg || 0)}">
        </label>
        <label class="gp-f"><span>种子</span>
          <span class="row">
            <select class="gp-sel" data-k="seed_mode" style="min-width:76px">
              <option value="random"${!fixed ? ' selected' : ''}>随机</option>
              <option value="fixed"${fixed ? ' selected' : ''}>固定</option>
            </select>
            <input class="gp-inp" type="number" data-k="seed" value="${esc(p.seed == null ? -1 : p.seed)}"
              ${fixed ? '' : 'disabled'} style="width:88px" title="固定种子可复现同一张图">
          </span>
        </label>
        <label class="gp-f"><span>批量张数</span>
          <input class="gp-inp" type="number" min="1" max="60" data-k="count" value="${esc(p.count || 10)}">
        </label>
        <div class="gp-actions">
          <button class="gp-btn" data-act="neg" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer">附加负面</button>
          <span class="gp-state" id="gp-state"></span>
        </div>
        <textarea class="gp-neg" data-k="extra_negative" placeholder="追加到负面的词（可留空）">${esc(p.extra_negative || '')}</textarea>
      `;
      bar.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        if (el.classList.contains('gp-neg')) return;
        el.addEventListener('change', () => {
          let v = el.value;
          if (el.type === 'number') v = v === '' ? 0 : Number(v);
          if (k === 'size_preset') { applySizePreset(v, scope); return; }
          if (k === 'width' || k === 'height') {
            push({ size_preset: 'custom', [k]: v }, scope);
            return;
          }
          push({ [k]: v }, scope);
          if (k === 'seed_mode') repaint();
        });
      });
      const neg = bar.querySelector('.gp-neg');
      neg.addEventListener('change', () => push({ extra_negative: neg.value }, scope));

      // 宽高对调：一键把横竖换向（同时切成自定义尺寸，避免预设又把值覆盖回去）
      const swapBtn = bar.querySelector('[data-act="swap"]');
      if (swapBtn) swapBtn.addEventListener('click', () => {
        const cur = S.byScope[scope] || {};
        const w = parseInt(cur.width) || 832;
        const h = parseInt(cur.height) || 1216;
        push({ size_preset: 'custom', width: h, height: w }, scope);
        repaint();                       // 主动重画：按钮点着时中间层会跳过自动重绘
      });

      const negBtn = bar.querySelector('[data-act="neg"]');
      if (negBtn) negBtn.addEventListener('click', () => {
        bar.classList.toggle('open');
        if (bar.classList.contains('open')) neg.focus();
      });

      // 模型方案：用可搜索下拉（方案名可能很多）
      const presetHost = bar.querySelector('#gp-preset-host');
      if (presetHost) {
        const activeName = S.activePreset || '';
        const curPreset = p.model_preset || '';
        const inst2 = Combo.create(presetHost, {
          value: curPreset,
          options: S.presets.slice(),
          inputClass: 'gp-sel',
          placeholder: activeName ? `激活方案：${activeName}` : '用激活方案',
          onChange: (v) => push({ model_preset: (v || '').trim() }, scope),
        });
        // 空值表示「跟随激活方案」
        inst2.input.addEventListener('change', () => {
          if (!inst2.getValue()) push({ model_preset: '' }, scope);
        });
      }
      // 同步状态提示
      updateState();
    }

    function updateState() {
      const el = bar.querySelector('#gp-state');
      if (!el) return;
      const saved = S.savedByScope[scope];
      if (!saved) { el.textContent = ''; return; }
      const ago = Math.round((Date.now() - saved) / 1000);
      el.className = 'gp-state ok';
      el.textContent = ago < 3 ? '✓ 已同步' : '';
    }

    inst.repaint = () => {
      // 只在数据真的变了才重建（避免打字时被覆盖）
      if (document.activeElement && bar.contains(document.activeElement) &&
          document.activeElement.tagName !== 'SELECT') return;
      repaint();
    };
    instances.add(inst);
    return inst;
  }

  async function init(host, opts) {
    opts = opts || {};
    const scope = opts.scope || 'global';
    await load(scope);
    const inst = render(host, opts);
    inst.repaint();
    return inst;
  }

  window.GenParams = {
    init,
    mount: init,
    load,
    // 确保某作用域参数已加载（点击出图前调用，返回该作用域参数）
    ensure: async (scope) => load(scope || 'global'),
    get: (scope) => Object.assign({}, S.byScope[scope || 'global'] || {}),
    refresh: async (scope) => { scope = scope || 'global'; await load(scope, true); notify(scope); },
    onChange: (fn, scope) => { const entry = { fn, scope: scope || 'global' }; subs.add(entry); return () => subs.delete(entry); },
    sizePresets: () => (S.sizePresets || []).slice(),
    presetNames: () => S.presets.slice(),
    summary: (scope) => {
      scope = scope || 'global';
      const p = S.byScope[scope] || {};
      const name = p.model_preset || (S.activePreset ? S.activePreset + '（激活）' : '未选方案');
      return `${p.width || '?'}×${p.height || '?'} · ${name}`;
    },
  };
})();
