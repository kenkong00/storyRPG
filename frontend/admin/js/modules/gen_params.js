// ========== 出图参数面板（按作用域隔离，各出图入口互不串扰） ==========
// 背景：以前「动作表情」里尺寸是写死的 832×1216，别的页面要出图又各自写一份，
// 用户根本不知道当前会用多大的图，也没法调。
//
// 现在参数存在服务端（/api/comfyui/gen-params?scope=xxx），前端这个组件负责渲染它。
// 作用域（scope）= 一个出图栏目，每个栏目各存一份，**互不影响**：
//   global               —— 设置 > 全局出图参数（所有栏目的起点 / 默认值）
//   characters           —— 人物管理 / 人物动作表情
//   character_appearance —— 人物外观拼装
//   scenes               —— 场景管理
//   scene_compose        —— 人物场景合成
//   comic                —— 漫画制作
//   cards                —— 卡牌系统
//   cards_appearance     —— 卡牌外观拼装
// 语义：栏目没单独改过 → 跟随 global；在栏目里改过一次 → 写进自己的格子，从此与别处无关。
//
// 用法：
//   const p = await GenParams.mount(hostEl, { scope: 'scenes' });
//   GenParams.get('scenes')   // 起任务时取当前作用域参数
//   GenParams.onChange(fn, 'scenes')   // 同作用域改了参数时通知我
//   GenParams.summary('scenes')        // "832×1216 · Moss_8步_透明底"
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
    globalPreset: '',     // 全局出图参数里选的方案，给「跟随全局」提示用
  };
  const subs = new Set();      // 每项 { fn, scope }
  const instances = new Set(); // 每项 { host, opts, scope, repaint, params }

  const SCOPE_LABEL = {
    global: {
      tag: '全局出图参数',
      title: '所有栏目的起点。这里只是默认值：哪个栏目没单独调过就跟这里走，一旦在栏目里改过就以栏目自己的为准',
    },
    characters: { tag: '人物出图参数', title: '仅作用于「人物管理 / 人物动作表情」，改这里不影响别的栏目' },
    character_appearance: { tag: '人物外观参数', title: '仅作用于「人物外观拼装」，改这里不影响别的栏目' },
    scenes: { tag: '场景出图参数', title: '仅作用于「场景管理」，改这里不影响别的栏目' },
    scene_compose: { tag: '场景合成参数', title: '仅作用于「人物场景合成」，改这里不影响别的栏目' },
    comic: { tag: '漫画出图参数', title: '仅作用于「漫画制作」，改这里不影响别的栏目' },
    cards: { tag: '卡牌出图参数', title: '仅作用于「卡牌系统」，改这里不影响别的栏目' },
    cards_appearance: { tag: '卡牌外观参数', title: '仅作用于「卡牌外观拼装」，改这里不影响别的栏目' },
    story_import: { tag: '剧情导入出图参数', title: '仅作用于「批量导入剧情 → 顺手生成人物立绘」。故意和人物管理分开：那里的出图尺寸/方案不适合批量立绘时，在这里单独调' },
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
      /* 仅保留「模型方案」+「尺寸·宽×高」两组，标签在上、控件在下、底对齐 */
      .gp-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 30px;
        background:var(--bg-input);border:1px solid var(--border);border-radius:6px;
        padding:12px 15px 13px}
      .gp-tag{font-size:11px;color:var(--gold);border:1px solid var(--gold);
        border-radius:10px;padding:2px 9px;white-space:nowrap;align-self:flex-start;
        margin-bottom:3px}
      .gp-group{display:flex;flex-direction:column;gap:5px;min-width:0}
      .gp-lbl{font-size:12px;color:var(--text-muted);white-space:nowrap;height:17px;line-height:17px}
      .gp-group .row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      /* 模型方案这一排：下拉与齿轮必须始终同一行，靠下拉收缩让位，不靠换行 */
      .gp-group.gp-scheme .row{min-width:300px;flex-wrap:nowrap}
      .gp-group.gp-scheme .row>.cb-wrap{flex:1 1 0;min-width:150px}
      .gp-group.gp-size .row{min-width:440px}
      .gp-bar .cb-wrap{flex:1 1 auto;min-width:0}
      .gp-sel,.gp-inp{background:var(--bg-card,#1a1a1a);border:1px solid var(--border);
        border-radius:4px;color:var(--text-primary);font-size:13px;height:32px;padding:0 8px;
        box-sizing:border-box;font-family:inherit}
      .gp-sel{flex:1 1 auto;min-width:130px;width:auto}
      .gp-inp{flex:0 0 86px;width:86px;text-align:center}
      /* 宽高对调小按钮：夹在宽、高两个输入框中间 */
      .gp-swap{flex:0 0 auto;width:28px;height:32px;padding:0;display:flex;align-items:center;justify-content:center;
        border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-muted);
        cursor:pointer;font-size:13px;line-height:1;font-family:inherit}
      .gp-swap:hover{color:var(--gold);border-color:var(--gold);background:rgba(201,168,76,.10)}
      .gp-actions{display:flex;align-items:flex-end;gap:8px;margin-left:auto}
      .gp-state{font-size:11px;color:var(--text-muted);min-width:54px;text-align:right}
      .gp-state.ok{color:#7bd88f}
      /* 齿轮弹窗顶部的说明条 */
      .gp-modal-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        padding:9px 12px;margin-bottom:12px;border:1px solid rgba(201,168,76,.45);
        border-radius:8px;background:rgba(201,168,76,.10)}
      .gp-modal-tag{font-size:12px;color:var(--gold);border:1px solid var(--gold);
        border-radius:10px;padding:2px 9px;white-space:nowrap}
      .gp-modal-hint{font-size:12px;color:var(--text-muted);line-height:1.6}
      .gp-modal-sp{flex:1 1 auto}
      /* 可搜索下拉（模型方案）与数字框同高，避免整排参差不齐 */
      .gp-bar .cb-wrap>input{height:32px;border:1px solid var(--border);
        border-radius:4px 0 0 4px;background:var(--bg-card,#1a1a1a);
        color:var(--text-primary);font-size:13px;padding:0 7px;box-sizing:border-box;width:100%}
      .gp-bar .cb-btn{height:32px;box-sizing:border-box}
      @media (max-width:1080px){
        .gp-group{width:100%}
        .gp-group.gp-scheme .row,.gp-group.gp-size .row{min-width:0;width:100%}
        .gp-actions{margin-left:0}
      }
    `;
    document.head.appendChild(st);
  }

  async function load(scope, force) {
    scope = scope || 'global';
    if (S.byScope[scope] && !force) return S.byScope[scope];
    if (S.loadingByScope[scope] && !force) return S.loadingByScope[scope];
    S.loadingByScope[scope] = (async () => {
      const [gp, cfg, _g] = await Promise.all([
        Admin.get(`${API}/gen-params?scope=${encodeURIComponent(scope)}`),
        Admin.get(`${API}/config`).catch(() => ({})),
        // 非 global 作用域顺带把 global 读进来，用来提示「跟随全局：XX」，并给齿轮跳转兜底
        scope === 'global' ? Promise.resolve(null) : load('global').catch(() => null),
      ]);
      S.byScope[scope] = gp.params || {};
      S.sizePresets = gp.size_presets || [];
      S.presets = ((cfg && cfg.model_presets) || []).map((p) => p.name);
      S.globalPreset = (S.byScope.global || {}).model_preset || '';
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

  /** 齿轮弹窗：模型配置（切换 / 编辑 / 新建方案，全在原地完成）
   *  注意：这里必须用「叠加层弹窗」而不是普通 showModal —— 齿轮可能是从
   *  人物编辑弹窗里点出来的，往 #modal-container 里一写就把正在填的表单冲掉了。 */
  function openPresetModal(scope, curPreset, followName, label) {
    if (!window.ModelPresetEditor) { Admin.toast('模型方案编辑器未加载', 'error'); return; }
    if (!Admin.showLayerModal) { Admin.toast('界面组件版本不一致，请 Ctrl+F5 强刷', 'error'); return; }
    // 同一时刻只留一个齿轮弹窗
    if (document.querySelector('#layer-container .gp-modal-bar')) return;
    const hostId = 'gp-preset-modal-host';
    const effective = curPreset || (scope === 'global' ? (followName || '') : '');
    const followTxt = followName ? `全局正在用「${followName}」` : '全局还没选方案';
    const body = `
      <div class="gp-modal-bar">
        <span class="gp-modal-tag">${esc(label.tag)}</span>
        <span class="gp-modal-hint">${scope === 'global'
          ? '这里是所有栏目的起点：栏目没单独改过就跟这里走。'
          : `只影响「${esc(label.tag)}」，其它栏目互不影响。${esc(followTxt)}`}</span>
        <span class="gp-modal-sp"></span>
        ${scope === 'global' ? '' : '<button type="button" class="btn btn-outline btn-sm" id="gp-modal-follow">改为跟随全局</button>'}
      </div>
      <div id="${hostId}"></div>`;
    const dlg = Admin.showLayerModal('模型配置', body, null, { size: 'xl', okOnly: true });
    const host = dlg.body.querySelector('#' + hostId);
    if (!host) return;
    const closeIt = () => Admin.closeLayerModal();
    ModelPresetEditor.mount(host, {
      current: effective,
      selectable: true,
      onSelect: (name) => {
        push({ model_preset: name || '' }, scope);
        closeIt();
        Admin.toast(`「${label.tag}」已改用「${name}」`, 'success');
      },
    });
    const fb = dlg.body.querySelector('#gp-modal-follow');
    if (fb) fb.addEventListener('click', () => {
      push({ model_preset: '' }, scope);
      closeIt();
      Admin.toast('已改为跟随全局', 'success');
    });
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
      bar.innerHTML = `
        <span class="gp-tag" title="${esc(label.title)}">${esc(label.tag)}</span>
        <div class="gp-group gp-scheme">
          <span class="gp-lbl">模型方案（选一套 / 编辑 / 新建）</span>
          <span class="row" id="gp-preset-host"></span>
        </div>
        <div class="gp-group gp-size">
          <span class="gp-lbl">尺寸 · 宽 × 高（像素）</span>
          <span class="row">
            <select class="gp-sel" data-k="size_preset">
              ${sizes.map((s) => `<option value="${esc(s.id)}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}${s.width ? ` ${s.width}×${s.height}` : ''}</option>`).join('')}
            </select>
            <input class="gp-inp" type="number" min="64" max="4096" step="8" data-k="width" value="${esc(p.width || 832)}">
            <button type="button" class="gp-swap" data-act="swap" title="宽高对调（横竖换向）">⇄</button>
            <input class="gp-inp" type="number" min="64" max="4096" step="8" data-k="height" value="${esc(p.height || 1216)}">
          </span>
        </div>
        <div class="gp-actions">
          <span class="gp-state" id="gp-state"></span>
        </div>
      `;
      bar.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        if (el.classList.contains('gp-neg')) return;
        el.addEventListener('change', () => {
          // 勾选框（如「随机」）：直接读 checked，并联动种子输入框的可用状态
          if (el.type === 'checkbox') {
            if (k === 'seed_mode') {
              const on = el.checked;
              const seedInput = bar.querySelector('[data-k="seed"]');
              if (seedInput) seedInput.disabled = on;
              push({ seed_mode: on ? 'random' : 'fixed' }, scope);
              return;
            }
            push({ [k]: el.checked }, scope);
            return;
          }
          let v = el.value;
          if (el.type === 'number') v = v === '' ? 0 : Number(v);
          if (k === 'size_preset') { applySizePreset(v, scope); return; }
          if (k === 'width' || k === 'height') {
            push({ size_preset: 'custom', [k]: v }, scope);
            return;
          }
          push({ [k]: v }, scope);
        });
      });

      // 宽高对调：一键把横竖换向（同时切成自定义尺寸，避免预设又把值覆盖回去）
      const swapBtn = bar.querySelector('[data-act="swap"]');
      if (swapBtn) swapBtn.addEventListener('click', () => {
        const cur = S.byScope[scope] || {};
        const w = parseInt(cur.width) || 832;
        const h = parseInt(cur.height) || 1216;
        push({ size_preset: 'custom', width: h, height: w }, scope);
        repaint();                       // 主动重画：按钮点着时中间层会跳过自动重绘
      });

      // 模型方案：用可搜索下拉（方案名可能很多）
      const presetHost = bar.querySelector('#gp-preset-host');
      if (presetHost) {
        const curPreset = p.model_preset || '';
        // 本栏目没选方案时跟谁走：非 global 跟「设置 > 全局出图参数」，global 自动用第一套
        const followName = scope === 'global' ? (S.presets[0] || '') : (S.globalPreset || '');
        const placeholder = curPreset ? '' : (scope === 'global'
          ? (followName ? `未选（自动用「${followName}」）` : '还没建模型方案')
          : (followName ? `跟随全局：${followName}` : '跟随全局参数'));
        const inst2 = Combo.create(presetHost, {
          value: curPreset,
          options: S.presets.slice(),
          inputClass: 'gp-sel',
          placeholder,
          onChange: (v) => push({ model_preset: (v || '').trim() }, scope),
        });
        // 清空 = 回到「跟随」
        inst2.input.addEventListener('change', () => {
          if (!inst2.getValue()) push({ model_preset: '' }, scope);
        });
        // 齿轮：原地弹窗显示「模型配置」，不再跳去设置页（跳一次就丢了当前页面的编辑状态）。
        // 交互对齐漫画格子参数面板里的「模型方案」：卡片上直接「使用这套」，选完即关窗。
        const mgrBtn = document.createElement('button');
        mgrBtn.type = 'button';
        mgrBtn.className = 'gp-swap';
        mgrBtn.title = '打开模型配置（弹窗），可切换 / 编辑本栏目使用的模型方案';
        mgrBtn.textContent = '⚙';
        presetHost.appendChild(mgrBtn);
        mgrBtn.addEventListener('click', () => {
          openPresetModal(scope, curPreset, followName, label);
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
    // 每次挂载都重读：从「设置 > 模型配置」回来时，方案名可能已改过
    try { await load(scope, true); } catch (_) { await load(scope); }
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
      const name = p.model_preset
        || (scope === 'global'
          ? (S.presets[0] ? S.presets[0] + '（默认）' : '未选方案')
          : (S.globalPreset ? S.globalPreset + '（跟随全局）' : '跟随全局'));
      return `${p.width || '?'}×${p.height || '?'} · ${name}`;
    },
  };
})();
