// ========== 设置：ComfyUI 连接 / 服务商 / 模型配置 / 提示词 / 工作流 ==========
// 配置体系完整移植自「windows轻量AI桌面助手 5.0」的设置 > 模型配置
(function () {
  const API = '/api/comfyui';

  const S = {
    tab: 'conn',
    cfg: null,
    catalog: null,
    presets: [],
    prompts: [],
    wfs: [],
    providers: [],
    activePreset: '',
    activeProvider: '',
    activeWf: '',
    busy: false,
  };

  // ---------------- 小工具 ----------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const base = (p) => String(p || '').replace(/\\/g, '/').split('/').pop();
  const q = encodeURIComponent;

  function options(list, cur, emptyLabel) {
    const arr = (list || []).slice();
    if (cur && !arr.includes(cur)) arr.unshift(cur);
    const head = emptyLabel == null ? '' : `<option value="">${esc(emptyLabel)}</option>`;
    return head + arr.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }

  function datalist(id, list) {
    return `<datalist id="${id}">${(list || []).map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
  }

  function catModels() {
    const c = S.catalog || {};
    const seen = new Set();
    const out = [];
    [...(c.unet || []), ...(c.diffusion_models || [])].forEach((v) => {
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out.sort();
  }
  const catClips = () => {
    const c = S.catalog || {};
    const seen = new Set(); const out = [];
    [...(c.text_encoders || []), ...(c.clip || [])].forEach((v) => {
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out.sort();
  };
  const catVaes = () => (S.catalog && S.catalog.vae) || [];
  const catLoras = () => (S.catalog && S.catalog.loras) || [];

  // ---------------- 数据加载 ----------------
  async function loadAll() {
    const [cfg, presets, prompts, wfs, providers] = await Promise.all([
      Admin.get('/comfyui/config'),
      Admin.get('/comfyui/model-presets').catch(() => []),
      Admin.get('/comfyui/prompt-presets').catch(() => []),
      Admin.get('/comfyui/workflow-presets').catch(() => []),
      Admin.get('/comfyui/providers').catch(() => []),
    ]);
    S.cfg = cfg || {};
    S.presets = Array.isArray(presets) ? presets : [];
    S.prompts = Array.isArray(prompts) ? prompts : [];
    S.wfs = Array.isArray(wfs) ? wfs : [];
    S.providers = Array.isArray(providers) ? providers : [];
    S.activePreset = S.cfg.active_model_preset || '';
    S.activeProvider = S.cfg.active_provider || '';
    S.activeWf = S.cfg.active_workflow_preset || '';
  }

  async function loadCatalog(force) {
    if (S.catalog && !force) return S.catalog;
    try {
      const d = await Admin.get('/comfyui/catalog');
      if (d && d.ok) S.catalog = d.catalog || {};
      else { S.catalog = {}; Admin.toast('读取模型清单失败：' + (d && d.detail || ''), 'error'); }
    } catch (e) {
      S.catalog = {};
      Admin.toast('读取模型清单失败：' + e.message, 'error');
    }
    return S.catalog;
  }

  // ---------------- 样式 ----------------
  const CSS = `
  .cs-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .cs-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}
  .cs-tab{padding:9px 16px;font-size:13px;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;user-select:none}
  .cs-tab:hover{color:var(--text-primary)}
  .cs-tab.active{color:var(--gold);border-bottom-color:var(--gold);font-weight:600}
  .cs-card{background:var(--bg-card,#16161a);border:1px solid var(--border);border-radius:var(--radius);padding:14px;position:relative}
  .cs-card.on{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
  .cs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
  .cs-title{font-size:14px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .cs-sub{font-size:11px;color:var(--text-muted);margin-top:6px;word-break:break-all;line-height:1.55}
  .cs-kv{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .cs-kv span{font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:10px;color:var(--text-muted)}
  .cs-kv b{color:var(--text-primary);font-weight:600}
  .cs-ft{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}
  .cs-badge{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--gold);color:#000;font-weight:700}
  .cs-badge.gray{background:transparent;border:1px solid var(--border);color:var(--text-muted);font-weight:500}
  .cs-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
  .cs-field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px}
  .cs-field input,.cs-field select,.cs-field textarea{width:100%;box-sizing:border-box;padding:7px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px;font-family:inherit}
  .cs-field textarea{resize:vertical;min-height:64px;line-height:1.5}
  .cs-sec{margin:18px 0 10px;font-size:12px;font-weight:700;color:var(--gold);border-bottom:1px dashed var(--border);padding-bottom:6px}
  .cs-lora{display:grid;grid-template-columns:28px 1fr 84px 66px;gap:6px;align-items:center;margin-bottom:6px}
  .cs-lora input[type=text],.cs-lora input[type=number]{padding:6px 8px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:11px;width:100%;box-sizing:border-box}
  .cs-lora .off{opacity:.45}
  .cs-empty{text-align:center;padding:40px;color:var(--text-muted);font-size:13px}
  .cs-test{margin-top:10px;font-size:12px;padding:10px 12px;border-radius:var(--radius);border:1px solid var(--border);color:var(--text-muted);white-space:pre-wrap;line-height:1.6}
  .cs-test.ok{border-color:#2e7d32;color:#7bd88f}
  .cs-test.bad{border-color:var(--red);color:#ff8a8a}
  .cs-hint{font-size:11px;color:var(--text-muted);line-height:1.6;margin-top:6px}
  `;

  function ensureCss() {
    if (document.getElementById('cs-style-tag')) return;
    const st = document.createElement('style');
    st.id = 'cs-style-tag';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---------------- 页面骨架 ----------------
  const TABS = [
    ['conn', '连接'],
    ['providers', '服务商'],
    ['presets', '模型配置'],
    ['prompts', '提示词'],
    ['wfs', '工作流'],
  ];

  function tabBar() {
    return `<div class="cs-tabs">${TABS.map(([k, t]) =>
      `<div class="cs-tab${S.tab === k ? ' active' : ''}" data-act="tab" data-tab="${k}">${t}</div>`).join('')}</div>`;
  }

  // ---------------- Tab 1：连接 ----------------
  function viewConn() {
    const c = S.cfg.comfyui || {};
    const inc = !!S.cfg.include_sensitive;
    return `
      <div class="cs-card">
        <div class="cs-title">ComfyUI 连接</div>
        <div class="cs-hint">地址示例：本地 <code>http://127.0.0.1:8188</code>；远程填对方局域网 IP 或域名。</div>
        <div class="cs-form" style="margin-top:12px">
          <div class="cs-field" style="grid-column:span 2"><label>服务地址</label>
            <input id="cf-url" type="text" value="${esc(c.url || '')}" placeholder="http://127.0.0.1:8188"></div>
          <div class="cs-field"><label>输出文件名前缀</label>
            <input id="cf-prefix" type="text" value="${esc(c.filename_prefix || 'RPG')}"></div>
          <div class="cs-field"><label>批大小</label>
            <input id="cf-batch" type="number" min="1" value="${esc(c.batch_size || 1)}"></div>
          <div class="cs-field"><label>超时（秒）</label>
            <input id="cf-timeout" type="number" min="30" value="${esc(c.timeout_sec || 600)}"></div>
          <div class="cs-field"><label>轮询间隔（毫秒）</label>
            <input id="cf-poll" type="number" min="100" value="${esc(c.poll_interval_ms || 500)}"></div>
          <div class="cs-field"><label>随机种子</label>
            <select id="cf-randseed">
              <option value="1"${c.random_seed !== false ? ' selected' : ''}>每次随机</option>
              <option value="0"${c.random_seed === false ? ' selected' : ''}>固定种子</option>
            </select></div>
          <div class="cs-field" style="grid-column:span 2"><label>输出目录（留空用默认）</label>
            <input id="cf-outdir" type="text" value="${esc(c.output_dir || '')}"></div>
        </div>

        <div class="cs-sec">API 工作流模式（不使用模型配置方案时生效）</div>
        <div class="cs-form">
          <div class="cs-field" style="grid-column:span 2"><label>工作流 JSON 路径</label>
            <input id="cf-wfpath" type="text" value="${esc(c.workflow_path || '')}" placeholder="D:\\\\ComfyUI\\\\workflows\\\\api.json"></div>
          <div class="cs-field"><label>正向提示词节点 ID</label>
            <input id="cf-pos" type="text" value="${esc(c.prompt_node_id || '')}" placeholder="自动识别"></div>
          <div class="cs-field"><label>负面提示词节点 ID</label>
            <input id="cf-neg" type="text" value="${esc(c.negative_node_id || '')}" placeholder="自动识别"></div>
          <div class="cs-field"><label>批次节点 ID</label>
            <input id="cf-batchid" type="text" value="${esc(c.batch_node_id || '')}" placeholder="自动识别"></div>
          <div class="cs-field" style="grid-column:span 2"><label>默认负面提示词</label>
            <textarea id="cf-negprompt">${esc(c.negative_prompt || '')}</textarea></div>
        </div>

        <div class="cs-sec">启动器（可选，用于从后台拉起 ComfyUI）</div>
        <div class="cs-form">
          <div class="cs-field" style="grid-column:span 2"><label>ComfyUI 安装目录</label>
            <input id="cf-installdir" type="text" value="${esc(c.install_dir || '')}"></div>
          <div class="cs-field"><label>Python 目录</label>
            <input id="cf-pydir" type="text" value="${esc(c.python_dir || '')}"></div>
          <div class="cs-field"><label>启动参数</label>
            <input id="cf-args" type="text" value="${esc(c.launch_args || '')}" placeholder="--listen --port 8188"></div>
        </div>

        <div class="cs-ft" style="margin-top:16px">
          <button class="btn btn-primary btn-sm" data-act="save-conn">保存连接设置</button>
          <button class="btn btn-outline btn-sm" data-act="test-conn">测试连接</button>
          <button class="btn btn-outline btn-sm" data-act="reload-catalog">刷新模型清单</button>
        </div>
        <div id="cf-test-out" class="cs-test" style="display:none"></div>
      </div>

      <div class="cs-card" style="margin-top:12px">
        <div class="cs-title">全局出图参数（所有出图入口共用）</div>
        <div class="cs-hint">动作表情批量、立绘生成等所有要调 ComfyUI 的地方都读这一份；
          在任意一处改，别处立刻同步。这里和出图页上看到的是同一份数据。</div>
        <div id="cs-gen-params" style="margin-top:10px"></div>
      </div>

      <div class="cs-card" style="margin-top:12px">
        <div class="cs-title">成人维度</div>
        <div class="cs-hint">关闭后，「人物外观拼装」里胸围 / 下体 / 裸露 / 体毛 等敏感维度会全部隐藏，随机生成与提示词也不会带上它们。</div>
        <div class="cs-ft">
          <button class="btn ${inc ? 'btn-primary' : 'btn-outline'} btn-sm" data-act="toggle-sensitive" data-val="${inc ? '0' : '1'}">
            ${inc ? '当前：显示（点击隐藏）' : '当前：隐藏（点击显示）'}
          </button>
        </div>
      </div>`;
  }

  // ---------------- Tab 2：服务商 ----------------
  function viewProviders() {
    const cards = S.providers.map((p) => {
      const on = p.id === S.activeProvider;
      return `<div class="cs-card${on ? ' on' : ''}">
        <div class="cs-title">${esc(p.name)} ${on ? '<span class="cs-badge">当前</span>' : ''}
          ${p.builtin ? '<span class="cs-badge gray">内置</span>' : ''}</div>
        <div class="cs-sub">${esc(p.url)}${p.desc ? ' · ' + esc(p.desc) : ''}</div>
        <div class="cs-kv"><span>超时 <b>${esc(p.timeout_sec || 600)}</b> 秒</span>
          ${p.api_key ? '<span>已设密钥</span>' : ''}</div>
        <div class="cs-ft">
          <button class="btn btn-outline btn-sm" data-act="test-provider" data-id="${esc(p.id)}">测试</button>
          ${on ? '' : `<button class="btn btn-primary btn-sm" data-act="activate-provider" data-id="${esc(p.id)}">设为当前</button>`}
          <button class="btn btn-outline btn-sm" data-act="edit-provider" data-id="${esc(p.id)}">编辑</button>
          ${p.builtin ? '' : `<button class="btn btn-outline btn-sm" data-act="del-provider" data-id="${esc(p.id)}">删除</button>`}
        </div>
      </div>`;
    }).join('');

    return `
      <div class="cs-card" style="margin-bottom:12px">
        <div class="cs-title">新增服务商</div>
        <div class="cs-form" style="margin-top:12px">
          <div class="cs-field"><label>名称</label><input id="pv-name" type="text" placeholder="远程 3090"></div>
          <div class="cs-field" style="grid-column:span 2"><label>地址</label><input id="pv-url" type="text" placeholder="http://192.168.1.20:8188"></div>
          <div class="cs-field"><label>超时（秒）</label><input id="pv-timeout" type="number" value="600"></div>
          <div class="cs-field"><label>API 密钥（可选）</label><input id="pv-key" type="text" placeholder="留空表示不需要"></div>
          <div class="cs-field"><label>备注</label><input id="pv-desc" type="text"></div>
        </div>
        <div class="cs-ft"><button class="btn btn-primary btn-sm" data-act="add-provider">添加</button></div>
      </div>
      ${cards ? `<div class="cs-grid">${cards}</div>` : '<div class="cs-empty">还没有额外服务商（本地 ComfyUI 默认存在）</div>'}`;
  }

  // ---------------- Tab 3：模型配置 ----------------
  function viewPresets() {
    const cards = S.presets.map((p, i) => {
      const on = p.name === S.activePreset;
      const loras = (p.loras || []);
      const enabled = loras.filter((l) => l.enabled).length;
      const kind = p.recipe === 'qwen_edit' ? '指令编辑' : (p.load_mode === 'checkpoint' ? 'Checkpoint' : 'UNET');
      return `<div class="cs-card${on ? ' on' : ''}">
        <div class="cs-title">${esc(p.name)} ${on ? '<span class="cs-badge">使用中</span>' : ''}</div>
        <div class="cs-sub">${esc(base(p.diffusion_model) || '（未选模型）')}</div>
        <div class="cs-kv">
          <span>${esc(kind)}</span>
          <span>步数 <b>${esc(p.steps)}</b></span>
          <span>CFG <b>${esc(p.cfg)}</b></span>
          <span>${esc(p.sampler || '-')}</span>
          <span>LoRA <b>${enabled}/${loras.length}</b></span>
          ${p.system_prompt ? '<span>系统提示词</span>' : ''}
        </div>
        <div class="cs-ft">
          <button class="btn btn-outline btn-sm" data-act="edit-preset" data-idx="${i}">编辑</button>
          <button class="btn btn-outline btn-sm" data-act="dup-preset" data-idx="${i}">复制</button>
          ${on ? '' : `<button class="btn btn-primary btn-sm" data-act="activate-preset" data-idx="${i}">设为当前</button>`}
          ${on || S.presets.length <= 1 ? '' : `<button class="btn btn-outline btn-sm" data-act="del-preset" data-idx="${i}">删除</button>`}
        </div>
      </div>`;
    }).join('');

    return `
      <div class="cs-head">
        <button class="btn btn-primary btn-sm" data-act="new-preset">＋ 新建方案</button>
        <button class="btn btn-outline btn-sm" data-act="reload-catalog">刷新模型清单</button>
        <span class="cs-hint" style="margin:0">
          ${S.catalog ? `已读取：模型 ${catModels().length} · 文本编码 ${catClips().length} · VAE ${catVaes().length} · LoRA ${catLoras().length}` : '模型清单未加载'}
        </span>
      </div>
      ${cards ? `<div class="cs-grid">${cards}</div>` : '<div class="cs-empty">还没有模型配置方案</div>'}
      <div class="cs-hint" style="margin-top:14px">
        每个方案 = 一套「模型 + LoRA + 采样参数」，人物外观页的生图卡片可以指定用哪套方案，从而实现「不同配置生成不同人物」。
      </div>`;
  }

  // ---------------- Tab 4：提示词 ----------------
  function viewPrompts() {
    const groups = {};
    S.prompts.forEach((p, i) => {
      const f = p.folder || '未分类';
      (groups[f] = groups[f] || []).push({ ...p, _i: i });
    });
    const body = Object.keys(groups).length
      ? Object.entries(groups).map(([f, list]) => `
        <div class="cs-sec">${esc(f)} <span class="cs-badge gray">${list.length}</span></div>
        <div class="cs-grid">
          ${list.map((p) => `<div class="cs-card">
            <div class="cs-title">${esc(p.name)}</div>
            <div class="cs-sub" style="max-height:64px;overflow:hidden">${esc(p.text || '')}</div>
            <div class="cs-ft">
              <button class="btn btn-outline btn-sm" data-act="copy-prompt" data-idx="${p._i}">复制</button>
              <button class="btn btn-outline btn-sm" data-act="edit-prompt" data-idx="${p._i}">编辑</button>
              <button class="btn btn-outline btn-sm" data-act="del-prompt" data-idx="${p._i}">删除</button>
            </div>
          </div>`).join('')}
        </div>`).join('')
      : '<div class="cs-empty">还没有提示词</div>';

    return `<div class="cs-head"><button class="btn btn-primary btn-sm" data-act="new-prompt">＋ 新建提示词</button></div>${body}`;
  }

  // ---------------- Tab 5：工作流 ----------------
  function viewWfs() {
    const cards = S.wfs.map((w, i) => {
      const on = w.name === S.activeWf;
      const isPath = !/^\s*[{[]/.test(String(w.workflow || ''));
      return `<div class="cs-card${on ? ' on' : ''}">
        <div class="cs-title">${esc(w.name)} ${on ? '<span class="cs-badge">使用中</span>' : ''}</div>
        <div class="cs-sub">${isPath ? '文件：' + esc(w.workflow) : '内联 JSON（' + String(w.workflow || '').length + ' 字符）'}</div>
        <div class="cs-kv"><span>覆盖参数 <b>${Object.keys(w.overrides || {}).length}</b></span>${w.note ? `<span>${esc(w.note)}</span>` : ''}</div>
        <div class="cs-ft">
          <button class="btn btn-outline btn-sm" data-act="edit-wf" data-idx="${i}">编辑</button>
          ${on ? '' : `<button class="btn btn-primary btn-sm" data-act="activate-wf" data-idx="${i}">设为当前</button>`}
          <button class="btn btn-outline btn-sm" data-act="del-wf" data-idx="${i}">删除</button>
        </div>
      </div>`;
    }).join('');

    return `
      <div class="cs-head">
        <button class="btn btn-primary btn-sm" data-act="new-wf">＋ 新建工作流</button>
        <span class="cs-hint" style="margin:0">不使用模型配置方案时生效：加载 ComfyUI 里「另存为 API 格式」的 JSON，再把提示词注入指定节点。</span>
      </div>
      ${cards ? `<div class="cs-grid">${cards}</div>` : '<div class="cs-empty">还没有工作流方案</div>'}`;
  }

  // ---------------- 模态：模型方案编辑器 ----------------
  function blankPreset() {
    return {
      name: '新方案', recipe: 'standard', comfy: '', load_mode: 'unet',
      diffusion_model: '', weight_dtype: 'default',
      clip_name: '', clip_type: '', vae_name: '', latent: 'flux2',
      skip_single_layers: '', skip_double_layers: '', skip_end_percent: 0.5,
      loras: [], use_ref_latent: true,
      sampler: 'euler', scheduler: 'normal', steps: 20, cfg: 7.0, denoise: 1.0,
      long_edge: 1024.0, seed: -1, negative: '', prefix: 'RPG', system_prompt: '',
    };
  }

  let loraState = [];

  function loraRows() {
    if (!loraState.length) {
      return '<div class="cs-hint">还没有 LoRA，点下面「添加 LoRA」。</div>';
    }
    return loraState.map((l, i) => `
      <div class="cs-lora">
        <input type="checkbox" data-lora="${i}" data-k="enabled" ${l.enabled ? 'checked' : ''} title="启用">
        <input type="text" list="dl-lora" data-lora="${i}" data-k="name" value="${esc(l.name || '')}"
          placeholder="选择或粘贴 LoRA 文件名" class="${l.enabled ? '' : 'off'}">
        <input type="number" step="0.05" data-lora="${i}" data-k="strength" value="${esc(l.strength)}" title="权重">
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" style="padding:2px 6px;font-size:10px" data-act="lora-up" data-i="${i}">↑</button>
          <button class="btn btn-outline btn-sm" style="padding:2px 6px;font-size:10px" data-act="lora-del" data-i="${i}">✕</button>
        </div>
      </div>`).join('') + `<div style="margin-top:8px"><button class="btn btn-outline btn-sm" data-act="lora-add">＋ 添加 LoRA</button></div>`;
  }

  function openPresetEditor(idx, preset, isNew) {
    const draft = JSON.parse(JSON.stringify(preset || blankPreset()));
    loraState = (draft.loras || []).map((l) => ({
      name: l.name || '', strength: l.strength == null ? 1.0 : Number(l.strength), enabled: !!l.enabled,
    }));
    const origName = isNew ? '' : draft.name;

    const body = `
      ${datalist('dl-unet', catModels())}
      ${datalist('dl-clip', catClips())}
      ${datalist('dl-vae', catVaes())}
      ${datalist('dl-lora', catLoras())}

      <div class="cs-sec" style="margin-top:0">基础</div>
      <div class="cs-form">
        <div class="cs-field" style="grid-column:span 2"><label>方案名称（唯一）</label>
          <input id="mp-name" type="text" value="${esc(draft.name || '')}"></div>
        <div class="cs-field"><label>工作流类型</label>
          <select id="mp-recipe">
            <option value="standard"${draft.recipe === 'standard' ? ' selected' : ''}>通用（UNET / Checkpoint 直出）</option>
            <option value="qwen_edit"${draft.recipe === 'qwen_edit' ? ' selected' : ''}>Qwen-Image-Edit（指令编辑）</option>
          </select></div>
        <div class="cs-field"><label>加载方式</label>
          <select id="mp-loadmode">
            <option value="unet"${draft.load_mode !== 'checkpoint' ? ' selected' : ''}>UNET（单独加载 diffusion model）</option>
            <option value="checkpoint"${draft.load_mode === 'checkpoint' ? ' selected' : ''}>Checkpoint（一体包）</option>
          </select></div>
      </div>

      <div class="cs-sec">模型 / 文本编码器 / VAE</div>
      <div class="cs-form">
        <div class="cs-field" style="grid-column:span 2"><label>扩散模型（UNET）</label>
          <input id="mp-model" type="text" list="dl-unet" value="${esc(draft.diffusion_model || '')}" placeholder="moss image\\moss_image_sft_int8_convrot.safetensors"></div>
        <div class="cs-field"><label>权重精度</label>
          <input id="mp-dtype" type="text" value="${esc(draft.weight_dtype || 'default')}" list="dl-dtype">
          <datalist id="dl-dtype"><option value="default"></option><option value="fp8_e4m3fn"></option><option value="fp8_e5m2"></option><option value="fp16_accumulation"></option></datalist></div>
        <div class="cs-field" style="grid-column:span 2"><label>文本编码器（CLIP）</label>
          <input id="mp-clip" type="text" list="dl-clip" value="${esc(draft.clip_name || '')}"></div>
        <div class="cs-field"><label>CLIP 类型</label>
          <input id="mp-cliptype" type="text" value="${esc(draft.clip_type || '')}" list="dl-cliptype">
          <datalist id="dl-cliptype">
            <option value="moss_image"></option><option value="flux"></option><option value="flux2"></option>
            <option value="sd3"></option><option value="qwen_image"></option><option value="wan"></option>
            <option value="stable_diffusion"></option><option value="sd2"></option>
          </datalist></div>
        <div class="cs-field" style="grid-column:span 2"><label>VAE</label>
          <input id="mp-vae" type="text" list="dl-vae" value="${esc(draft.vae_name || '')}"></div>
        <div class="cs-field"><label>Latent 类型</label>
          <select id="mp-latent">
            <option value="flux2"${draft.latent === 'flux2' ? ' selected' : ''}>Flux2 / MOSS（16 倍数）</option>
            <option value="sd3"${draft.latent === 'sd3' ? ' selected' : ''}>SD3 / Flux（16 倍数）</option>
            <option value="sd"${draft.latent === 'sd' ? ' selected' : ''}>SD / SDXL（8 倍数）</option>
          </select></div>
        <div class="cs-field"><label>使用参考 Latent</label>
          <select id="mp-reflatent">
            <option value="1"${draft.use_ref_latent !== false ? ' selected' : ''}>是</option>
            <option value="0"${draft.use_ref_latent === false ? ' selected' : ''}>否</option>
          </select></div>
      </div>

      <div class="cs-sec">SkipLayer 引导</div>
      <div class="cs-form">
        <div class="cs-field"><label>跳过单层（逗号分隔）</label>
          <input id="mp-skipsingle" type="text" value="${esc(draft.skip_single_layers || '')}" placeholder="22"></div>
        <div class="cs-field"><label>跳过双层（逗号分隔）</label>
          <input id="mp-skipdouble" type="text" value="${esc(draft.skip_double_layers || '')}" placeholder="7,8"></div>
        <div class="cs-field"><label>结束百分比</label>
          <input id="mp-skipend" type="number" step="0.05" min="0" max="1" value="${esc(draft.skip_end_percent == null ? 0.5 : draft.skip_end_percent)}"></div>
      </div>

      <div class="cs-sec">采样参数</div>
      <div class="cs-form">
        <div class="cs-field"><label>采样器</label>
          <input id="mp-sampler" type="text" value="${esc(draft.sampler || '')}" list="dl-sampler">
          <datalist id="dl-sampler">
            <option value="euler"></option><option value="euler_ancestral"></option><option value="er_sde"></option>
            <option value="dpmpp_2m"></option><option value="dpmpp_2m_sde"></option><option value="dpmpp_sde"></option>
            <option value="ddim"></option><option value="uni_pc"></option><option value="res_multistep"></option>
          </datalist></div>
        <div class="cs-field"><label>调度器</label>
          <input id="mp-scheduler" type="text" value="${esc(draft.scheduler || '')}" list="dl-sched">
          <datalist id="dl-sched">
            <option value="normal"></option><option value="karras"></option><option value="exponential"></option>
            <option value="sgm_uniform"></option><option value="simple"></option><option value="ddim_uniform"></option>
            <option value="beta"></option>
          </datalist></div>
        <div class="cs-field"><label>步数</label><input id="mp-steps" type="number" min="1" value="${esc(draft.steps)}"></div>
        <div class="cs-field"><label>CFG</label><input id="mp-cfg" type="number" step="0.1" value="${esc(draft.cfg)}"></div>
        <div class="cs-field"><label>降噪强度</label><input id="mp-denoise" type="number" step="0.05" min="0" max="1" value="${esc(draft.denoise == null ? 1 : draft.denoise)}"></div>
        <div class="cs-field"><label>长边像素</label><input id="mp-longedge" type="number" value="${esc(draft.long_edge || 1024)}"></div>
        <div class="cs-field"><label>种子（-1 随机）</label><input id="mp-seed" type="number" value="${esc(draft.seed == null ? -1 : draft.seed)}"></div>
      </div>

      <div class="cs-sec">LoRA（按顺序叠加）</div>
      <div id="mp-lora-list">${loraRows()}</div>

      <div class="cs-sec">提示词</div>
      <div class="cs-form">
        <div class="cs-field" style="grid-column:span 2"><label>系统提示词（自动拼在正向前面）</label>
          <input id="mp-sysprompt" type="text" value="${esc(draft.system_prompt || '')}" placeholder="isolated on a transparent background,"></div>
        <div class="cs-field" style="grid-column:span 2"><label>默认负面提示词</label>
          <textarea id="mp-negative">${esc(draft.negative || '')}</textarea></div>
        <div class="cs-field"><label>文件名前缀</label><input id="mp-prefix" type="text" value="${esc(draft.prefix || 'RPG')}"></div>
      </div>`;

    Admin.showModal(isNew ? '新建模型配置方案' : '编辑模型配置方案', body, async () => {
      const g = (id) => document.getElementById(id);
      const n = (id, d) => { const v = parseFloat(g(id).value); return isNaN(v) ? d : v; };
      const name = (g('mp-name').value || '').trim();
      if (!name) { Admin.toast('方案名称不能为空', 'error'); return; }
      const out = {
        ...draft,
        name,
        recipe: g('mp-recipe').value,
        load_mode: g('mp-loadmode').value,
        diffusion_model: g('mp-model').value.trim(),
        weight_dtype: g('mp-dtype').value.trim() || 'default',
        clip_name: g('mp-clip').value.trim(),
        clip_type: g('mp-cliptype').value.trim(),
        vae_name: g('mp-vae').value.trim(),
        latent: g('mp-latent').value,
        use_ref_latent: g('mp-reflatent').value === '1',
        skip_single_layers: g('mp-skipsingle').value.trim(),
        skip_double_layers: g('mp-skipdouble').value.trim(),
        skip_end_percent: n('mp-skipend', 0.5),
        sampler: g('mp-sampler').value.trim(),
        scheduler: g('mp-scheduler').value.trim(),
        steps: Math.round(n('mp-steps', 20)),
        cfg: n('mp-cfg', 7),
        denoise: n('mp-denoise', 1),
        long_edge: n('mp-longedge', 1024),
        seed: Math.round(n('mp-seed', -1)),
        negative: g('mp-negative').value,
        prefix: g('mp-prefix').value.trim() || 'RPG',
        system_prompt: g('mp-sysprompt').value.trim(),
        loras: loraState
          .filter((l) => (l.name || '').trim())
          .map((l) => ({ name: l.name.trim(), strength: Number(l.strength) || 0, enabled: !!l.enabled })),
      };
      try {
        if (isNew) {
          await Admin.post('/comfyui/model-presets', { preset: out });
        } else if (name !== origName) {
          // 后端 PUT 以路径名为准、不支持改名：走「新建 + 删旧」
          await Admin.post('/comfyui/model-presets', { preset: out });
          await Admin.del(`/comfyui/model-presets/${q(origName)}`).catch(() => {});
          if (S.activePreset === origName) await Admin.post(`/comfyui/model-presets/${q(name)}/activate`).catch(() => {});
        } else {
          await Admin.put(`/comfyui/model-presets/${q(origName)}`, { preset: out });
        }
        Admin.toast('已保存：' + name, 'success');
        Admin.closeModal();
        await loadAll();
        paint();
      } catch (e) {
        Admin.toast(e.message, 'error');
      }
    }, { size: 'xl' });

    // 模型 / LoRA 这类长路径输入：把 <datalist> 换成「可搜索 + 完整路径弹层」的下拉
    // （原生 datalist 的弹层又窄又白，模型路径根本看不全，右边的箭头还点不动）
    if (window.Combo) {
      Combo.upgradeDatalists(document.querySelector('.modal-body'));
    }

    // 绑定 LoRA 行交互
    const rerender = () => {
      const box = document.getElementById('mp-lora-list');
      if (box) { box.innerHTML = loraRows(); bindLora(); }
    };
    function bindLora() {
      document.querySelectorAll('#mp-lora-list [data-lora]').forEach((el) => {
        el.addEventListener('input', () => {
          const i = +el.dataset.lora;
          const k = el.dataset.k;
          if (!loraState[i]) return;
          loraState[i][k] = k === 'enabled' ? el.checked : (k === 'strength' ? (parseFloat(el.value) || 0) : el.value);
          if (k === 'enabled') rerender();
        });
      });
      document.querySelectorAll('#mp-lora-list [data-act]').forEach((el) => {
        el.addEventListener('click', () => {
          const act = el.dataset.act;
          if (act === 'lora-add') { loraState.push({ name: '', strength: 1.0, enabled: true }); rerender(); return; }
          const i = +el.dataset.i;
          if (act === 'lora-del') loraState.splice(i, 1);
          if (act === 'lora-up' && i > 0) {
            const t = loraState[i - 1]; loraState[i - 1] = loraState[i]; loraState[i] = t;
          }
          rerender();
        });
      });
    }
    bindLora();
  }

  // ---------------- 事件 ----------------
  let rootEl = null;

  async function onAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    // Tab 切换
    if (act === 'tab') { S.tab = el.dataset.tab; paint(); return; }

    // ---- 连接 ----
    if (act === 'save-conn') {
      const g = (id) => document.getElementById(id);
      const patch = {
        url: g('cf-url').value.trim(),
        filename_prefix: g('cf-prefix').value.trim() || 'RPG',
        batch_size: parseInt(g('cf-batch').value, 10) || 1,
        timeout_sec: parseInt(g('cf-timeout').value, 10) || 600,
        poll_interval_ms: parseInt(g('cf-poll').value, 10) || 500,
        random_seed: g('cf-randseed').value === '1',
        output_dir: g('cf-outdir').value.trim(),
        workflow_path: g('cf-wfpath').value.trim(),
        prompt_node_id: g('cf-pos').value.trim(),
        negative_node_id: g('cf-neg').value.trim(),
        batch_node_id: g('cf-batchid').value.trim(),
        negative_prompt: g('cf-negprompt').value,
        install_dir: g('cf-installdir').value.trim(),
        python_dir: g('cf-pydir').value.trim(),
        launch_args: g('cf-args').value.trim(),
      };
      try {
        S.cfg = await Admin.put('/comfyui/config', patch);
        Admin.toast('连接设置已保存', 'success');
        paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'test-conn') {
      const out = document.getElementById('cf-test-out');
      out.style.display = 'block';
      out.className = 'cs-test';
      out.textContent = '正在连接…';
      try {
        const d = await Admin.post('/comfyui/test', {});
        out.className = 'cs-test ' + (d.ok ? 'ok' : 'bad');
        out.textContent = d.ok ? ('✓ ' + (d.detail || '已连接')) : ('✗ ' + (d.detail || '连接失败'));
      } catch (err) {
        out.className = 'cs-test bad';
        out.textContent = '✗ ' + err.message;
      }
      return;
    }

    if (act === 'reload-catalog') {
      el.disabled = true;
      await loadCatalog(true);
      el.disabled = false;
      Admin.toast('模型清单已刷新', 'success');
      paint();
      return;
    }

    if (act === 'toggle-sensitive') {
      const val = el.dataset.val === '1';
      try {
        await Admin.put('/comfyui/include-sensitive', { value: val });
        S.cfg.include_sensitive = val;
        Admin.toast(val ? '成人维度已显示' : '成人维度已隐藏', 'success');
        paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    // ---- 服务商 ----
    if (act === 'add-provider') {
      const g = (id) => document.getElementById(id);
      const name = g('pv-name').value.trim();
      const url = g('pv-url').value.trim();
      if (!name || !url) { Admin.toast('名称和地址必填', 'error'); return; }
      try {
        await Admin.post('/comfyui/providers', {
          name, url,
          desc: g('pv-desc').value.trim(),
          timeout_sec: parseInt(g('pv-timeout').value, 10) || 600,
          api_key: g('pv-key').value.trim(),
        });
        Admin.toast('已添加', 'success');
        await loadAll(); paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'activate-provider') {
      try {
        await Admin.post(`/comfyui/providers/${q(el.dataset.id)}/activate`, {});
        await loadAll(); paint();
        Admin.toast('已切换服务商', 'success');
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'del-provider') {
      if (!(await Admin.confirm('删除这个服务商？'))) return;
      try {
        await Admin.del(`/comfyui/providers/${q(el.dataset.id)}`);
        await loadAll(); paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'test-provider') {
      const p = S.providers.find((x) => x.id === el.dataset.id) || { name: el.dataset.id };
      el.disabled = true;
      try {
        const d = await Admin.post(`/comfyui/test?provider_id=${q(el.dataset.id)}`, {});
        Admin.toast(`${p.name}：${d.ok ? '✓ ' : '✗ '}${d.detail || ''}`, d.ok ? 'success' : 'error');
      } catch (err) {
        Admin.toast(`${p.name}：✗ ${err.message}`, 'error');
      } finally {
        el.disabled = false;
      }
      return;
    }

    if (act === 'edit-provider') {
      const p = S.providers.find((x) => x.id === el.dataset.id);
      if (!p) return;
      Admin.showModal('编辑服务商', `
        <div class="cs-form">
          <div class="cs-field"><label>名称</label><input id="ep-name" type="text" value="${esc(p.name)}"></div>
          <div class="cs-field"><label>超时（秒）</label><input id="ep-timeout" type="number" value="${esc(p.timeout_sec || 600)}"></div>
          <div class="cs-field" style="grid-column:span 2"><label>地址</label><input id="ep-url" type="text" value="${esc(p.url)}"></div>
          <div class="cs-field"><label>备注</label><input id="ep-desc" type="text" value="${esc(p.desc || '')}"></div>
          <div class="cs-field"><label>API 密钥</label><input id="ep-key" type="text" value="${esc(p.api_key || '')}"></div>
        </div>`, async () => {
        try {
          await Admin.put(`/comfyui/providers/${q(p.id)}`, {
            name: document.getElementById('ep-name').value.trim(),
            url: document.getElementById('ep-url').value.trim(),
            desc: document.getElementById('ep-desc').value.trim(),
            timeout_sec: parseInt(document.getElementById('ep-timeout').value, 10) || 600,
            api_key: document.getElementById('ep-key').value.trim(),
          });
          Admin.toast('已保存', 'success');
          Admin.closeModal();
          await loadAll(); paint();
        } catch (err) { Admin.toast(err.message, 'error'); }
      });
      return;
    }

    // ---- 模型方案 ----
    if (act === 'new-preset') {
      ensureCss();
      await loadCatalog();
      openPresetEditor(-1, null, true);
      return;
    }

    if (act === 'edit-preset') {
      await loadCatalog();
      openPresetEditor(+el.dataset.idx, S.presets[+el.dataset.idx], false);
      return;
    }

    if (act === 'dup-preset') {
      const src = S.presets[+el.dataset.idx];
      if (!src) return;
      const copy = JSON.parse(JSON.stringify(src));
      copy.name = src.name + '_副本';
      try {
        await Admin.post('/comfyui/model-presets', { preset: copy });
        Admin.toast('已复制为 ' + copy.name, 'success');
        await loadAll(); paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'activate-preset') {
      const p = S.presets[+el.dataset.idx];
      if (!p) return;
      try {
        await Admin.post(`/comfyui/model-presets/${q(p.name)}/activate`, {});
        await loadAll(); paint();
        Admin.toast('当前方案：' + p.name, 'success');
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'del-preset') {
      const p = S.presets[+el.dataset.idx];
      if (!p) return;
      if (!(await Admin.confirm(`删除模型方案「${p.name}」？`))) return;
      try {
        await Admin.del(`/comfyui/model-presets/${q(p.name)}`);
        await loadAll(); paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    // ---- 提示词 ----
    if (act === 'new-prompt' || act === 'edit-prompt') {
      const isNew = act === 'new-prompt';
      const p = isNew ? { name: '', text: '', folder: '未分类' } : S.prompts[+el.dataset.idx];
      if (!p) return;
      Admin.showModal(isNew ? '新建提示词' : '编辑提示词', `
        <div class="cs-form">
          <div class="cs-field"><label>名称</label><input id="pp-name" type="text" value="${esc(p.name)}"></div>
          <div class="cs-field"><label>分组</label><input id="pp-folder" type="text" value="${esc(p.folder || '未分类')}"></div>
          <div class="cs-field" style="grid-column:span 2"><label>内容</label>
            <textarea id="pp-text" style="min-height:140px">${esc(p.text || '')}</textarea></div>
        </div>`, async () => {
        const body = {
          name: document.getElementById('pp-name').value.trim(),
          folder: document.getElementById('pp-folder').value.trim() || '未分类',
          text: document.getElementById('pp-text').value,
        };
        if (!body.name) { Admin.toast('名称必填', 'error'); return; }
        try {
          if (isNew) await Admin.post('/comfyui/prompt-presets', body);
          else await Admin.put(`/comfyui/prompt-presets/${+el.dataset.idx}`, body);
          Admin.toast('已保存', 'success');
          Admin.closeModal();
          await loadAll(); paint();
        } catch (err) { Admin.toast(err.message, 'error'); }
      });
      return;
    }

    if (act === 'copy-prompt') {
      const p = S.prompts[+el.dataset.idx];
      if (!p) return;
      try {
        await navigator.clipboard.writeText(p.text || '');
        Admin.toast('已复制', 'success');
      } catch (_) {
        Admin.toast('复制失败，请手动选择文本', 'error');
      }
      return;
    }

    if (act === 'del-prompt') {
      const p = S.prompts[+el.dataset.idx];
      if (!p) return;
      if (!(await Admin.confirm(`删除提示词「${p.name}」？`))) return;
      try {
        await Admin.del(`/comfyui/prompt-presets/${+el.dataset.idx}`);
        await loadAll(); paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    // ---- 工作流 ----
    if (act === 'new-wf' || act === 'edit-wf') {
      const isNew = act === 'new-wf';
      const w = isNew ? { name: '', workflow: '', overrides: {}, note: '' } : S.wfs[+el.dataset.idx];
      if (!w) return;
      const origName = isNew ? '' : w.name;
      Admin.showModal(isNew ? '新建工作流方案' : '编辑工作流方案', `
        <div class="cs-form">
          <div class="cs-field"><label>名称</label><input id="wf-name" type="text" value="${esc(w.name)}"></div>
          <div class="cs-field"><label>备注</label><input id="wf-note" type="text" value="${esc(w.note || '')}"></div>
          <div class="cs-field" style="grid-column:span 2"><label>工作流（JSON 全文，或填文件绝对路径）</label>
            <textarea id="wf-json" style="min-height:220px;font-family:Consolas,monospace;font-size:11px">${esc(w.workflow || '')}</textarea></div>
          <div class="cs-field" style="grid-column:span 2"><label>覆盖参数（JSON，可选）</label>
            <textarea id="wf-ov" style="min-height:80px;font-family:Consolas,monospace;font-size:11px">${esc(JSON.stringify(w.overrides || {}, null, 2))}</textarea></div>
        </div>`, async () => {
        const name = document.getElementById('wf-name').value.trim();
        if (!name) { Admin.toast('名称必填', 'error'); return; }
        let ov = {};
        try {
          const t = document.getElementById('wf-ov').value.trim();
          if (t) ov = JSON.parse(t);
        } catch (_) { Admin.toast('覆盖参数不是合法 JSON', 'error'); return; }
        const body = {
          name,
          workflow: document.getElementById('wf-json').value,
          overrides: ov,
          note: document.getElementById('wf-note').value.trim(),
        };
        try {
          if (isNew) await Admin.post('/comfyui/workflow-presets', body);
          else if (name !== origName) {
            await Admin.post('/comfyui/workflow-presets', body);
            await Admin.del(`/comfyui/workflow-presets/${q(origName)}`).catch(() => {});
          } else await Admin.put(`/comfyui/workflow-presets/${q(origName)}`, body);
          Admin.toast('已保存', 'success');
          Admin.closeModal();
          await loadAll(); paint();
        } catch (err) { Admin.toast(err.message, 'error'); }
      }, { size: 'xl' });
      return;
    }

    if (act === 'activate-wf') {
      const w = S.wfs[+el.dataset.idx];
      if (!w) return;
      try {
        await Admin.post(`/comfyui/workflow-presets/${q(w.name)}/activate`, {});
        await loadAll(); paint();
        Admin.toast('当前工作流：' + w.name, 'success');
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }

    if (act === 'del-wf') {
      const w = S.wfs[+el.dataset.idx];
      if (!w) return;
      if (!(await Admin.confirm(`删除工作流「${w.name}」？`))) return;
      try {
        await Admin.del(`/comfyui/workflow-presets/${q(w.name)}`);
        await loadAll(); paint();
      } catch (err) { Admin.toast(err.message, 'error'); }
      return;
    }
  }

  function paint() {
    if (!rootEl) return;
    if (window.Combo) Combo.upgradeDatalists(rootEl);
    let body = '';
    if (S.tab === 'conn') body = viewConn();
    else if (S.tab === 'providers') body = viewProviders();
    else if (S.tab === 'presets') body = viewPresets();
    else if (S.tab === 'prompts') body = viewPrompts();
    else body = viewWfs();

    rootEl.innerHTML = `
      <div class="cs-head">
        <div class="cs-title" style="font-size:15px">ComfyUI · 模型配置中心</div>
        <span class="cs-hint" style="margin:0">
          当前服务商 <b>${esc(S.activeProvider || '-')}</b> · 当前模型方案 <b>${esc(S.activePreset || '未选择')}</b>
        </span>
      </div>
      ${tabBar()}
      <div id="cs-body">${body}</div>`;

    // 连接页底部挂「全局出图参数」面板（和出图页共用同一个组件）
    if (S.tab === 'conn' && window.GenParams) {
      const gpHost = document.getElementById('cs-gen-params');
      if (gpHost) GenParams.init(gpHost).catch(() => {});
    }
  }

  // ---------------- 注册页面 ----------------
  Admin.registerPage('settings', async (container) => {
    ensureCss();
    container.innerHTML = '<div id="cs-root"><div class="cs-empty">加载配置…</div></div>';
    rootEl = document.getElementById('cs-root');
    rootEl.addEventListener('click', onAction);
    try {
      await loadAll();
    } catch (e) {
      rootEl.innerHTML = `<div class="cs-empty">配置加载失败：${esc(e.message)}</div>`;
      return;
    }
    if (!S.catalog) loadCatalog().then(() => { if (S.tab === 'presets') paint(); });
    paint();
  });
})();
