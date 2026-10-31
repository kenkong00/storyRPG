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
  function catModels() {
    const c = S.catalog || {};
    const seen = new Set();
    const out = [];
    [...(c.unet || []), ...(c.diffusion_models || []), ...(c.unet_gguf || []), ...(c.checkpoints || [])]
      .forEach((v) => {
        if (v && isBigModel(v) && !seen.has(v)) { seen.add(v); out.push(v); }
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
    // 提示词已独立成「提示词管理」栏目、工作流也不再在本页维护，这里不再重复拉取
    const [cfg, presets, providers] = await Promise.all([
      Admin.get('/comfyui/config'),
      Admin.get('/comfyui/model-presets').catch(() => []),
      Admin.get('/comfyui/providers').catch(() => []),
    ]);
    S.cfg = cfg || {};
    S.presets = Array.isArray(presets) ? presets : [];
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
          <div class="cs-field"><label>超时（秒）</label>
            <input id="cf-timeout" type="number" min="30" value="${esc(c.timeout_sec || 600)}"></div>
        </div>

        <div class="cs-sec">启动器（可选，用于从后台拉起 ComfyUI）</div>
        <div class="cs-form">
          <div class="cs-field" style="grid-column:span 2"><label>ComfyUI 安装目录</label>
            <input id="cf-installdir" type="text" value="${esc(c.install_dir || '')}"></div>
          <div class="cs-field"><label>Python 目录</label>
            <input id="cf-pydir" type="text" value="${esc(c.python_dir || '')}"></div>
        </div>

        <div class="cs-ft" style="margin-top:16px">
          <button class="btn btn-primary btn-sm" data-act="save-conn">保存设置</button>
          <button class="btn btn-outline btn-sm" data-act="test-conn">测试连接</button>
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

  // ---------------- 模态：模型方案编辑器 ----------------
  // 表单本体由共用部件 ModelPresetEditor 提供（改一处，设置页 / 漫画 / 人物外观 全生效）
  function openPresetEditor(idx, preset, isNew) {
    if (!window.ModelPresetEditor) { Admin.toast("模型方案编辑器未加载", "error"); return; }
    ModelPresetEditor.setCatalog(S.catalog);   // 复用本页已读到的模型清单，避免重复拉取
    ModelPresetEditor.openForm(preset, isNew, {
      activeName: S.activePreset,
      onSaved: async () => { await loadAll(); paint(); },
    });
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
      // 只保留：服务地址 / 超时 / ComfyUI 安装目录 / Python 目录
      // （后端是 PATCH 语义，没提交的字段不会被动到，保留原值）
      const patch = {
        url: g('cf-url').value.trim(),
        timeout_sec: parseInt(g('cf-timeout').value, 10) || 600,
        install_dir: g('cf-installdir').value.trim(),
        python_dir: g('cf-pydir').value.trim(),
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

  }

  function paint() {
    if (!rootEl) return;
    if (window.Combo) Combo.upgradeDatalists(rootEl);
    let body = '';
    if (S.tab === 'conn') body = viewConn();
    else if (S.tab === 'providers') body = viewProviders();
    else if (S.tab === 'presets') body = viewPresets();
    else { S.tab = 'conn'; body = viewConn(); }   // 提示词/工作流标签已移到独立栏目，兜底回连接页

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
