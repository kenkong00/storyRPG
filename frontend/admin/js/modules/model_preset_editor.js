// ========== 可复用的「模型方案编辑器」(ModelPresetEditor) ==========
// 形态（按用户要求）：**不做左右分栏** —— 就是一个个方案的列表，点「编辑」弹窗设置。
// 表单本体只有这一份，ComfyUI 设置页 / 漫画制作 / 人物外观 等页面共用，改一处全生效。
// 依赖：全局 Admin（get/post/put/del/toast/confirm/showModal/closeModal）、Combo（可搜索下拉）。
//
// 对外 API：
//   ModelPresetEditor.mount(containerEl, { compact, current, onSelect })
//   ModelPresetEditor.openForm(preset, isNew, { onSaved })   // 弹窗编辑（核心）
//   ModelPresetEditor.refresh()
//   ModelPresetEditor.blankPreset()
//   ModelPresetEditor.setCatalog(c)                          // 复用宿主页面已读到的模型清单
//
// 已修好的三个老毛病：
//   1) 模型下拉：不再用原生 <datalist>（又白又窄、点箭头不展开），统一走 Combo 可搜索下拉。
//   2) 「＋ 添加 LoRA」放在 LoRA 标题文字后面，不再孤零零挂列表底部。
//   3) 正面 / 负面提示词上下分行、同宽、等高。
(function () {
  'use strict';
  const API = '/comfyui';

  // ---------------- 小工具 ----------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const base = (p) => String(p || '').replace(/\\/g, '/').split('/').pop();
  const q = encodeURIComponent;

  // ---------------- 内部状态 ----------------
  const state = {
    presets: [],
    catalog: null,
    activeName: '',
    containers: [],   // 已挂载的宿主容器（refresh 时一起重画）
  };
  let loraState = [];  // 弹窗里正在编辑的 LoRA 列表

  function datalist(id, list) {
    return `<datalist id="${id}">${(list || []).map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
  }

  // 「大模型」过滤器：ComfyUI 的 unet / diffusion_models 目录里经常混着
  // 文本编码器、VAE、ControlNet（Flux 生态特别常见），下拉里只该出现真正的扩散模型。
  const BIG_MODEL_EXT = /\.(safetensors|sft|ckpt|pt|pth|gguf|bin)$/i;
  const NOT_BIG_MODEL = /(^|[^a-z])(clip|t5|t5xxl|umt5|ae|vae|text[_-]?encoder|controlnet|ipadapter|ip-adapter|pulid|instantid|sam|upscale|esrgan|embedding|lora|style)/i;
  function isBigModel(p) {
    const name = String(p || '');
    if (!name || !BIG_MODEL_EXT.test(name)) return false;
    const base = name.replace(/\\/g, '/').split('/').pop();
    return !NOT_BIG_MODEL.test(base);
  }
  const catModels = () => {
    const c = state.catalog || {};
    const seen = new Set(); const out = [];
    [...(c.unet || []), ...(c.diffusion_models || []), ...(c.unet_gguf || []), ...(c.checkpoints || [])]
      .forEach((v) => {
        if (v && isBigModel(v) && !seen.has(v)) { seen.add(v); out.push(v); }
      });
    return out.sort();
  };
  const catClips = () => {
    const c = state.catalog || {};
    const seen = new Set(); const out = [];
    [...(c.text_encoders || []), ...(c.clip || [])].forEach((v) => {
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out.sort();
  };
  const catVaes = () => (state.catalog && state.catalog.vae) || [];
  const catLoras = () => (state.catalog && state.catalog.loras) || [];

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

  // ---------------- 数据 ----------------
  async function loadPresets() {
    const [list, cfg] = await Promise.all([
      Admin.get(API + '/model-presets').catch(() => []),
      Admin.get(API + '/config').catch(() => null),
    ]);
    state.presets = Array.isArray(list) ? list : [];
    if (cfg && cfg.active_model_preset) state.activeName = cfg.active_model_preset;
  }

  async function loadCatalog(force) {
    if (state.catalog && !force) return state.catalog;
    try {
      const d = await Admin.get(API + '/catalog');
      state.catalog = (d && d.ok) ? (d.catalog || {}) : {};
    } catch (_) { state.catalog = {}; }
    return state.catalog;
  }

  // ---------------- 列表视图（不是左右分栏）----------------
  function listHtml() {
    if (!state.presets.length) return '<div class="mpe-empty">还没有模型方案，点「＋ 新建方案」。</div>';
    return state.presets.map((p, i) => {
      const on = p.name === state.activeName;
      const loras = p.loras || [];
      const enabled = loras.filter((l) => l.enabled).length;
      const kind = p.recipe === 'qwen_edit' ? '指令编辑' : (p.load_mode === 'checkpoint' ? 'Checkpoint' : 'UNET');
      return `<div class="mpe-card${on ? ' on' : ''}">
        <div class="mpe-card-title">${esc(p.name)}${on ? '<span class="mpe-badge">使用中</span>' : ''}</div>
        <div class="mpe-card-sub">${esc(base(p.diffusion_model) || '（未选模型）')}</div>
        <div class="mpe-card-kv">
          <span>${esc(kind)}</span><span>步数 <b>${esc(p.steps)}</b></span>
          <span>CFG <b>${esc(p.cfg)}</b></span><span>LoRA <b>${enabled}/${loras.length}</b></span>
        </div>
        <div class="mpe-card-ft">
          <button class="btn btn-outline btn-sm" data-act="mpe-edit" data-i="${i}">编辑</button>
          <button class="btn btn-outline btn-sm" data-act="mpe-dup" data-i="${i}">复制</button>
          ${on ? '' : `<button class="btn btn-primary btn-sm" data-act="mpe-activate" data-i="${i}">设为当前</button>`}
          <button class="btn btn-outline btn-sm" data-act="mpe-del" data-i="${i}">删除</button>
        </div>
      </div>`;
    }).join('');
  }

  function pickHtml(sel) {
    return `<select id="mpe-pick" class="mpe-pick">${
      state.presets.map((p) => `<option value="${esc(p.name)}"${p.name === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('')
    }</select>`;
  }

  function renderOne(c) {
    const compact = c._mpeCompact;
    const cur = c._mpeCurrent || state.activeName || (state.presets[0] && state.presets[0].name) || '';
    if (compact) {
      c.innerHTML = `<div class="mpe-pickrow">
        ${pickHtml(cur)}
        <button class="btn btn-outline btn-sm" data-act="mpe-edit-pick">编辑</button>
        <button class="btn btn-outline btn-sm" data-act="mpe-new">＋ 新建</button>
        <button class="btn btn-outline btn-sm" data-act="mpe-manage">管理…</button>
      </div>`;
    } else {
      c.innerHTML = `<div class="mpe-head">
          <button class="btn btn-primary btn-sm" data-act="mpe-new">＋ 新建方案</button>
          <button class="btn btn-outline btn-sm" data-act="mpe-refresh-cat">刷新模型清单</button>
          <span class="mpe-stat">${state.catalog
            ? `模型 ${catModels().length} · 文本编码 ${catClips().length} · VAE ${catVaes().length} · LoRA ${catLoras().length}`
            : '模型清单未加载'}</span>
        </div>
        <div class="mpe-grid">${listHtml()}</div>`;
    }
    bindOne(c);
  }

  function renderAll() {
    // 丢掉已经被页面重画替换掉的旧宿主，避免越积越多
    state.containers = state.containers.filter((c) => c && c.isConnected);
    state.containers.forEach(renderOne);
  }

  // ---------------- 弹窗表单（核心，所有页面共用这一份）----------------
  function loraRows() {
    if (!loraState.length) {
      return '<div class="mpe-hint">还没有 LoRA，点标题右边的「＋ 添加 LoRA」。</div>';
    }
    return loraState.map((l, i) => `
      <div class="mpe-lora${l.enabled ? '' : ' off'}">
        <input type="checkbox" data-lora="${i}" data-k="enabled" ${l.enabled ? 'checked' : ''} title="启用">
        <input type="text" list="dl-lora" data-lora="${i}" data-k="name" value="${esc(l.name || '')}"
          placeholder="选择或粘贴 LoRA 文件名">
        <input type="number" step="0.05" data-lora="${i}" data-k="strength" value="${esc(l.strength)}" title="权重">
        <div class="mpe-lora-acts">
          <button class="btn btn-outline btn-sm" data-act="lora-up" data-i="${i}" title="上移">↑</button>
          <button class="btn btn-outline btn-sm" data-act="lora-down" data-i="${i}" title="下移">↓</button>
          <button class="btn btn-outline btn-sm" data-act="lora-del" data-i="${i}" title="删除">✕</button>
        </div>
      </div>`).join('');
  }

  function formBody(draft) {
    return `
      ${datalist('dl-unet', catModels())}
      ${datalist('dl-clip', catClips())}
      ${datalist('dl-vae', catVaes())}
      ${datalist('dl-lora', catLoras())}

      <div class="mpe-sec" style="margin-top:0">基础</div>
      <div class="mpe-form">
        <div class="mpe-field span2"><label>方案名称（唯一）</label>
          <input id="mp-name" type="text" value="${esc(draft.name || '')}"></div>
        <div class="mpe-field"><label>工作流类型</label>
          <select id="mp-recipe">
            <option value="standard"${draft.recipe === 'standard' ? ' selected' : ''}>通用（UNET / Checkpoint 直出）</option>
            <option value="qwen_edit"${draft.recipe === 'qwen_edit' ? ' selected' : ''}>Qwen-Image-Edit（指令编辑）</option>
          </select></div>
        <div class="mpe-field"><label>加载方式</label>
          <select id="mp-loadmode">
            <option value="unet"${draft.load_mode !== 'checkpoint' ? ' selected' : ''}>UNET（单独加载 diffusion model）</option>
            <option value="checkpoint"${draft.load_mode === 'checkpoint' ? ' selected' : ''}>Checkpoint（一体包）</option>
          </select></div>
      </div>

      <div class="mpe-sec">模型 / 文本编码器 / VAE</div>
      <div class="mpe-form">
        <div class="mpe-field span2"><label>扩散模型（UNET）</label>
          <input id="mp-model" type="text" list="dl-unet" value="${esc(draft.diffusion_model || '')}" placeholder="moss image\\xxx.safetensors"></div>
        <div class="mpe-field"><label>权重精度</label>
          <input id="mp-dtype" type="text" value="${esc(draft.weight_dtype || 'default')}" list="dl-dtype">
          <datalist id="dl-dtype"><option value="default"></option><option value="fp8_e4m3fn"></option><option value="fp8_e5m2"></option><option value="fp16_accumulation"></option></datalist></div>
        <div class="mpe-field span2"><label>文本编码器（CLIP）</label>
          <input id="mp-clip" type="text" list="dl-clip" value="${esc(draft.clip_name || '')}"></div>
        <div class="mpe-field"><label>CLIP 类型</label>
          <input id="mp-cliptype" type="text" value="${esc(draft.clip_type || '')}" list="dl-cliptype">
          <datalist id="dl-cliptype">
            <option value="moss_image"></option><option value="flux"></option><option value="flux2"></option>
            <option value="sd3"></option><option value="qwen_image"></option><option value="wan"></option>
            <option value="stable_diffusion"></option><option value="sd2"></option>
          </datalist></div>
        <div class="mpe-field span2"><label>VAE</label>
          <input id="mp-vae" type="text" list="dl-vae" value="${esc(draft.vae_name || '')}"></div>
        <div class="mpe-field"><label>Latent 类型</label>
          <select id="mp-latent">
            <option value="flux2"${draft.latent === 'flux2' ? ' selected' : ''}>Flux2 / MOSS（16 倍数）</option>
            <option value="sd3"${draft.latent === 'sd3' ? ' selected' : ''}>SD3 / Flux（16 倍数）</option>
            <option value="sd"${draft.latent === 'sd' ? ' selected' : ''}>SD / SDXL（8 倍数）</option>
          </select></div>
        <div class="mpe-field"><label>使用参考 Latent</label>
          <select id="mp-reflatent">
            <option value="1"${draft.use_ref_latent !== false ? ' selected' : ''}>是</option>
            <option value="0"${draft.use_ref_latent === false ? ' selected' : ''}>否</option>
          </select></div>
      </div>

      <div class="mpe-sec">SkipLayer 引导</div>
      <div class="mpe-form">
        <div class="mpe-field"><label>跳过单层（逗号分隔）</label>
          <input id="mp-skipsingle" type="text" value="${esc(draft.skip_single_layers || '')}" placeholder="22"></div>
        <div class="mpe-field"><label>跳过双层（逗号分隔）</label>
          <input id="mp-skipdouble" type="text" value="${esc(draft.skip_double_layers || '')}" placeholder="7,8"></div>
        <div class="mpe-field"><label>结束百分比</label>
          <input id="mp-skipend" type="number" step="0.05" min="0" max="1" value="${esc(draft.skip_end_percent == null ? 0.5 : draft.skip_end_percent)}"></div>
      </div>

      <div class="mpe-sec">采样参数</div>
      <div class="mpe-form">
        <div class="mpe-field"><label>采样器</label>
          <input id="mp-sampler" type="text" value="${esc(draft.sampler || '')}" list="dl-sampler">
          <datalist id="dl-sampler">
            <option value="euler"></option><option value="euler_ancestral"></option><option value="er_sde"></option>
            <option value="dpmpp_2m"></option><option value="dpmpp_2m_sde"></option><option value="dpmpp_sde"></option>
            <option value="ddim"></option><option value="uni_pc"></option><option value="res_multistep"></option>
          </datalist></div>
        <div class="mpe-field"><label>调度器</label>
          <input id="mp-scheduler" type="text" value="${esc(draft.scheduler || '')}" list="dl-sched">
          <datalist id="dl-sched">
            <option value="normal"></option><option value="karras"></option><option value="exponential"></option>
            <option value="sgm_uniform"></option><option value="simple"></option><option value="ddim_uniform"></option>
            <option value="beta"></option>
          </datalist></div>
        <div class="mpe-field"><label>步数</label><input id="mp-steps" type="number" min="1" value="${esc(draft.steps)}"></div>
        <div class="mpe-field"><label>CFG</label><input id="mp-cfg" type="number" step="0.1" value="${esc(draft.cfg)}"></div>
        <div class="mpe-field"><label>降噪强度</label><input id="mp-denoise" type="number" step="0.05" min="0" max="1" value="${esc(draft.denoise == null ? 1 : draft.denoise)}"></div>
        <div class="mpe-field"><label>长边像素</label><input id="mp-longedge" type="number" value="${esc(draft.long_edge || 1024)}"></div>
        <div class="mpe-field"><label>种子（-1 随机）</label><input id="mp-seed" type="number" value="${esc(draft.seed == null ? -1 : draft.seed)}"></div>
      </div>

      <div class="mpe-sec-row">
        <span class="mpe-sec-title">LoRA（按顺序叠加，可任意选择并调权重）</span>
        <button class="btn btn-outline btn-sm" data-act="lora-add">＋ 添加 LoRA</button>
      </div>
      <div id="mp-lora-list">${loraRows()}</div>

      <div class="mpe-sec">提示词</div>
      <div class="mpe-prompt-stack">
        <div class="mpe-field"><label>正面提示词（系统提示词，自动拼在正向前面）</label>
          <textarea id="mp-sysprompt" class="mpe-prompt-box" rows="3" placeholder="isolated on a transparent background,">${esc(draft.system_prompt || '')}</textarea></div>
        <div class="mpe-field"><label>负面提示词（默认负面）</label>
          <textarea id="mp-negative" class="mpe-prompt-box" rows="3">${esc(draft.negative || '')}</textarea></div>
        <div class="mpe-field"><label>文件名前缀</label>
          <input id="mp-prefix" type="text" value="${esc(draft.prefix || 'RPG')}"></div>
      </div>`;
  }

  /** 把所有 <input list="xxx"> 升级成 Combo 可搜索下拉（点击 ▼ 真的展开、长路径能看全） */
  function upgradeCombos(root) {
    if (window.Combo && root) Combo.upgradeDatalists(root);
  }

  function openForm(preset, isNew, opts) {
    opts = opts || {};
    ensureCss();   // 设置页是直接调 openForm（不走 mount），样式必须自己注入
    if (opts.activeName) state.activeName = opts.activeName;   // 宿主页面告知当前生效方案（改名后要重新激活）
    const draft = JSON.parse(JSON.stringify(preset || blankPreset()));
    loraState = (draft.loras || []).map((l) => ({
      name: l.name || '', strength: l.strength == null ? 1.0 : Number(l.strength), enabled: !!l.enabled,
    }));
    const origName = isNew ? '' : draft.name;

    Admin.showModal(isNew ? '新建模型配置方案' : '编辑模型配置方案', formBody(draft), async () => {
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
          await Admin.post(API + '/model-presets', { preset: out });
        } else if (name !== origName) {
          // 后端 PUT 以路径名为准、不支持改名：走「新建 + 删旧」
          await Admin.post(API + '/model-presets', { preset: out });
          await Admin.del(`${API + '/model-presets'}/${q(origName)}`).catch(() => {});
          if (state.activeName === origName) await Admin.post(`${API + '/model-presets'}/${q(name)}/activate`).catch(() => {});
        } else {
          await Admin.put(`${API + '/model-presets'}/${q(origName)}`, { preset: out });
        }
        Admin.toast('已保存：' + name, 'success');
        Admin.closeModal();
        if (typeof opts.onSaved === 'function') opts.onSaved(name);
        else { await loadPresets(); renderAll(); }
      } catch (e) {
        Admin.toast(e.message || '保存失败', 'error');
      }
    }, { size: 'xl' });

    const bodyEl = document.querySelector('.modal-body');
    if (bodyEl) {
      upgradeCombos(bodyEl);
      bindLora(bodyEl);
    }
  }

  function bindLora(bodyEl) {
    const rerender = () => {
      const box = document.getElementById('mp-lora-list');
      if (!box) return;
      box.innerHTML = loraRows();
      upgradeCombos(box);          // 新加的 LoRA 行也要能用下拉选
      bindLora(bodyEl);
    };
    document.querySelectorAll('#mp-lora-list [data-lora]').forEach((el) => {
      el.addEventListener('input', () => {
        const i = +el.dataset.lora; const k = el.dataset.k;
        if (!loraState[i]) return;
        loraState[i][k] = k === 'enabled' ? el.checked : (k === 'strength' ? (parseFloat(el.value) || 0) : el.value);
        if (k === 'enabled') rerender();
      });
    });
    // 「＋ 添加 LoRA」在列表外面（标题行右侧），必须单独绑，否则点了没反应
    const addBtn = document.querySelector('[data-act="lora-add"]');
    if (addBtn) {
      addBtn.onclick = () => { loraState.push({ name: '', strength: 1.0, enabled: true }); rerender(); };
    }
    document.querySelectorAll('#mp-lora-list [data-act]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'lora-add') { loraState.push({ name: '', strength: 1.0, enabled: true }); rerender(); return; }
        const i = +el.dataset.i;
        if (act === 'lora-del') loraState.splice(i, 1);
        if (act === 'lora-up' && i > 0) { const t = loraState[i - 1]; loraState[i - 1] = loraState[i]; loraState[i] = t; }
        if (act === 'lora-down' && i < loraState.length - 1) { const t = loraState[i + 1]; loraState[i + 1] = loraState[i]; loraState[i] = t; }
        rerender();
      });
    });
  }

  // ---------------- 列表交互 ----------------
  function bindOne(c) {
    c.querySelectorAll('[data-act^="mpe-"]').forEach((el) => {
      el.addEventListener('click', async () => {
        const act = el.dataset.act;
        const i = el.dataset.i;
        const p = state.presets[+i];
        if (act === 'mpe-new') { openForm(blankPreset(), true, { onSaved: async () => { await loadPresets(); renderAll(); } }); }
        else if (act === 'mpe-edit') { if (p) openForm(p, false, { onSaved: async () => { await loadPresets(); renderAll(); } }); }
        else if (act === 'mpe-edit-pick') {
          const sel = document.getElementById('mpe-pick');
          const name = sel && sel.value;
          const cur = state.presets.find((x) => x.name === name);
          if (cur) openForm(cur, false, { onSaved: async () => { await loadPresets(); renderAll(); } });
        }
        else if (act === 'mpe-manage') { openManager(); }
        else if (act === 'mpe-dup') {
          if (!p) return;
          const copy = JSON.parse(JSON.stringify(p));
          copy.name = p.name + '（副本）';
          try { await Admin.post(API + '/model-presets', { preset: copy }); Admin.toast('已复制：' + copy.name, 'success'); await loadPresets(); renderAll(); }
          catch (e) { Admin.toast('复制失败：' + e.message, 'error'); }
        }
        else if (act === 'mpe-activate') {
          if (!p) return;
          try { await Admin.post(`${API + '/model-presets'}/${q(p.name)}/activate`, {}); state.activeName = p.name; Admin.toast('当前方案：' + p.name, 'success'); renderAll(); }
          catch (e) { Admin.toast('激活失败：' + e.message, 'error'); }
        }
        else if (act === 'mpe-del') {
          if (!p) return;
          if (!(await Admin.confirm(`删除模型方案「${p.name}」？`, { danger: true }))) return;
          try { await Admin.del(`${API + '/model-presets'}/${q(p.name)}`); Admin.toast('已删除：' + p.name, 'success'); await loadPresets(); renderAll(); }
          catch (e) { Admin.toast('删除失败：' + e.message, 'error'); }
        }
        else if (act === 'mpe-refresh-cat') { await loadCatalog(true); renderAll(); Admin.toast('模型清单已刷新', 'success'); }
      });
    });
    const sel = c.querySelector('#mpe-pick');
    if (sel && c._mpeOnSelect) {
      sel.addEventListener('change', () => c._mpeOnSelect(sel.value));
    }
  }

  // ---------------- 对外 API ----------------
  function mount(container, opts) {
    if (!container) return;
    opts = opts || {};
    ensureCss();
    container._mpeCompact = !!opts.compact;
    container._mpeCurrent = opts.current || '';
    container._mpeOnSelect = opts.onSelect || null;
    if (!state.containers.includes(container)) state.containers.push(container);

    (async () => {
      await Promise.all([loadPresets(), loadCatalog()]);
      if (opts.current) state.activeName = opts.current;
      renderOne(container);
    })();
  }

  async function refresh() {
    await Promise.all([loadPresets(), loadCatalog()]);
    renderAll();
  }

  function openManager() {
    const hostId = 'mpe-manager-host';
    Admin.showModal('模型方案管理', `<div id="${hostId}"></div>`, null, { size: 'xl' });
    const host = document.getElementById(hostId);
    const sb = document.getElementById('modal-save-btn');
    if (sb) sb.style.display = 'none';
    if (host) mount(host, { current: state.activeName || null });
  }

  // ---------------- 样式 ----------------
  const CSS = `
  .mpe-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .mpe-stat{font-size:11px;color:var(--text-muted)}
  .mpe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .mpe-card{border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--bg-input)}
  .mpe-card.on{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
  .mpe-card-title{font-size:13px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px}
  .mpe-card-sub{font-size:11px;color:var(--text-muted);margin-top:4px;word-break:break-all}
  .mpe-card-kv{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  .mpe-card-kv span{font-size:10px;padding:1px 7px;border:1px solid var(--border);border-radius:8px;color:var(--text-muted)}
  .mpe-card-kv b{color:var(--text-primary)}
  .mpe-card-ft{display:flex;gap:6px;flex-wrap:wrap}
  .mpe-badge{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--gold);color:#000;font-weight:700}
  .mpe-pickrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .mpe-pick{flex:1;min-width:160px;max-width:320px}
  .mpe-empty{text-align:center;padding:28px 12px;color:var(--text-muted);font-size:13px}

  .mpe-sec{margin:18px 0 8px;font-size:12px;font-weight:700;color:var(--gold);border-bottom:1px dashed var(--border);padding-bottom:5px}
  .mpe-sec-row{display:flex;align-items:center;gap:10px;margin:18px 0 8px;border-bottom:1px dashed var(--border);padding-bottom:7px}
  .mpe-sec-title{font-size:12px;font-weight:700;color:var(--gold)}
  .mpe-sec-row .btn{margin-left:2px}
  .mpe-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
  .mpe-field{min-width:0}
  .mpe-field.span2{grid-column:span 2}
  .mpe-field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px}
  /* 注意：LoRA 行不在 .mpe-form 里面，必须单独列出来，
     否则它会掉回浏览器默认的白底黑字，在深色面板里非常刺眼 */
  .mpe-form input,.mpe-form select,.mpe-form textarea,
  .mpe-lora input,.mpe-lora select,
  .mpe-prompt-box,.mpe-pick{
    width:100%;box-sizing:border-box;padding:7px 10px;background:var(--bg-input);border:1px solid var(--border);
    border-radius:var(--radius);color:var(--text-primary);font-size:12px;font-family:inherit}
  .mpe-form input:focus,.mpe-form select:focus,
  .mpe-lora input:focus,.mpe-lora select:focus,
  .mpe-prompt-box:focus{border-color:var(--gold)}
  /* 深色面板里的下拉/日期等控件也要跟主题一致 */
  .mpe-lora input[type=checkbox]{width:auto;box-sizing:content-box;accent-color:var(--gold);background:none;border:none}

  /* 正面 / 负面提示词：各占一行、同宽、等高 */
  .mpe-prompt-stack{display:flex;flex-direction:column;gap:12px}
  .mpe-prompt-stack .mpe-field{width:100%}
  .mpe-prompt-box{min-height:82px;height:82px;line-height:1.6;resize:vertical}

  .mpe-lora{display:grid;grid-template-columns:26px 1fr 96px 108px;gap:6px;align-items:center;
    margin-bottom:6px;padding:5px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius)}
  .mpe-lora.off{opacity:.5}
  .mpe-lora-acts{display:flex;gap:3px}
  .mpe-lora-acts .btn{padding:2px 7px;font-size:11px}
  .mpe-hint{font-size:11px;color:var(--text-muted);line-height:1.6;margin-top:6px}
  `;

  function ensureCss() {
    if (document.getElementById('mpe-style-tag')) return;
    const st = document.createElement('style');
    st.id = 'mpe-style-tag';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // 模块一加载就把样式注入，任何入口（mount / openForm）都能用到
  if (typeof document !== 'undefined') ensureCss();

  window.ModelPresetEditor = {
    mount, refresh, openManager, openForm, blankPreset,
    setCatalog: (c) => { state.catalog = c || state.catalog; },
  };
})();
