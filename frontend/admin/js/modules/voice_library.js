// ========== 角色语音库（平铺总览页） ==========
//
// 对照「Windows 轻量 AI 桌面助手 → 设置 → 语音设置 → 角色语音」那套体验：
// 把全部音色（普通话 / 方言 / 地区口音 / 多语言 / 派生角色声线 / 本机）
// 不分引擎地平铺成卡片墙，随时点 ▶ 试听，不用先选下拉再点生成。
//
// 数据全部来自 /api/tts/voices?grouped=true，一条也不写死。
// 卡片渲染与试听逻辑共用 voice_grid.js，导入/对话弹窗用的是同一套组件。
(function () {
  let _cache = null;      // 上一次拉到的 {groups:[...]}

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 把分组结构拍平：每个音色补上所属引擎 id / 名称 / 是否可用
  function flatten(groups) {
    const out = [];
    (groups || []).forEach(g => {
      (g.voices || []).forEach(v => {
        out.push(Object.assign({}, v, {
          engine: v.engine || g.id,
          engine_name: g.name,
          engine_available: g.available,
        }));
      });
    });
    return out;
  }

  function injectStyle() {
    if (document.getElementById('vl-style')) return;
    const st = document.createElement('style');
    st.id = 'vl-style';
    st.textContent = `
      .vl-page{display:flex;flex-direction:column;gap:14px;height:100%;min-height:0}
      .vl-head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
      .vl-title{font-size:19px;font-weight:700;letter-spacing:.5px}
      .vl-sub{font-size:12px;color:var(--text-muted);line-height:1.6;max-width:640px}
      .vl-stats{display:flex;gap:10px;flex-wrap:wrap}
      .vl-stat{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;
        padding:7px 13px;display:flex;flex-direction:column;gap:1px;min-width:74px}
      .vl-stat b{font-size:16px;color:var(--gold);line-height:1.2}
      .vl-stat span{font-size:10.5px;color:var(--text-muted)}
      .vl-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;
        background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:10px 12px}
      .vl-toolbar label{font-size:12px;color:var(--text-muted);white-space:nowrap}
      .vl-engines{display:flex;gap:6px;flex-wrap:wrap}
      .vl-eng{padding:5px 12px;border:1px solid var(--border);border-radius:999px;
        background:var(--bg-input);color:var(--text-muted);font-size:12px;cursor:pointer;
        user-select:none;white-space:nowrap;transition:.12s;display:flex;align-items:center;gap:6px}
      .vl-eng:hover{border-color:var(--gold);color:var(--text-primary)}
      .vl-eng.on{background:var(--gold);border-color:var(--gold);color:#1A1408;font-weight:600}
      .vl-eng.off{opacity:.5}
      .vl-dot{width:6px;height:6px;border-radius:50%;background:#33cc77;flex:none}
      .vl-eng.off .vl-dot{background:#999}
      .vl-text{flex:1;min-width:200px;padding:7px 11px;background:var(--bg-input);
        border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px}
      .vl-body{flex:1;min-height:0;overflow:auto;padding-right:4px}
      .vl-loading,.vl-error{padding:36px;text-align:center;color:var(--text-muted);font-size:13px}
      .vl-error{color:var(--danger,#e05353)}
    `;
    document.head.appendChild(st);
  }

  async function loadVoices(force) {
    if (_cache && !force) return _cache;
    const r = await Admin.get('/tts/voices?grouped=true' + (force ? '&refresh=true' : ''), { noCache: true });
    _cache = { groups: (r && r.groups) || [] };
    return _cache;
  }

  Admin.registerPage('voice_library', async (container) => {
    injectStyle();
    container.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'vl-page';
    page.innerHTML = `
      <div class="vl-head">
        <div>
          <div class="vl-title">角色语音库</div>
          <div class="vl-sub">全部音色平铺在此，点卡片右上角的 ▶ 直接试听；派生角色声线会按它自己的语速/音调偏移发声。
            导入剧情、对话配音里选音色用的是同一套卡片。</div>
        </div>
        <div style="flex:1"></div>
        <div class="vl-stats" id="vl-stats"></div>
        <button class="btn btn-outline btn-sm" id="vl-refresh">↻ 重新拉取音色</button>
      </div>
      <div class="vl-toolbar">
        <label>引擎</label>
        <div class="vl-engines" id="vl-engines"></div>
      </div>
      <div class="vl-toolbar">
        <label>试听台词</label>
        <input class="vl-text" id="vl-text" value="前方似有埋伏，公子小心。">
        <span style="font-size:11.5px;color:var(--text-muted);white-space:nowrap">改这一句，再点卡片上的 ▶ 就按新台词念</span>
      </div>
      <div class="vl-body" id="vl-body"><div class="vl-loading">加载音色中…</div></div>
    `;
    container.appendChild(page);

    const bodyEl = page.querySelector('#vl-body');
    const engEl = page.querySelector('#vl-engines');
    const statsEl = page.querySelector('#vl-stats');
    const textEl = page.querySelector('#vl-text');

    let voiceList = [];
    let enginePick = '';     // '' = 全部
    let grid = null;

    function renderStats(list) {
      const M = list.filter(v => v.gender === 'male').length;
      const F = list.filter(v => v.gender === 'female').length;
      const roles = list.filter(v => v.group === 'role').length;
      const engines = new Set(list.map(v => v.engine)).size;
      statsEl.innerHTML = `
        <div class="vl-stat"><b>${list.length}</b><span>音色总数</span></div>
        <div class="vl-stat"><b>${M}</b><span>男声</span></div>
        <div class="vl-stat"><b>${F}</b><span>女声</span></div>
        <div class="vl-stat"><b>${roles}</b><span>角色声线</span></div>
        <div class="vl-stat"><b>${engines}</b><span>引擎</span></div>`;
    }

    function renderEngineChips(groups) {
      const items = [{ id: '', name: '全部引擎', available: true }].concat(
        (groups || []).map(g => ({ id: g.id, name: g.name, available: g.available })));
      engEl.innerHTML = items.map(g => `
        <span class="vl-eng${g.id === enginePick ? ' on' : ''}${g.available ? '' : ' off'}" data-e="${esc(g.id)}">
          <i class="vl-dot"></i>${esc(g.name)}</span>`).join('');
    }

    function paintGrid() {
      if (grid && grid.destroy) grid.destroy();
      bodyEl.innerHTML = '';
      const list = enginePick ? voiceList.filter(v => v.engine === enginePick) : voiceList;
      if (!list.length) {
        bodyEl.innerHTML = '<div class="vl-loading">这个引擎下没有可用音色（可能未安装或需要联网）</div>';
        return;
      }
      grid = VoiceGrid.mount(bodyEl, list, {
        variant: 'page',
        previewText: textEl.value || '前方似有埋伏，公子小心。',
        onPick(vid) {
          const v = list.find(x => x.voice_id === vid);
          if (v) Admin.toast(`已选：${v.name}（${v.voice_id}）`);
        },
      });
    }

    async function boot(force) {
      try {
        const data = await loadVoices(force);
        voiceList = flatten(data.groups);
        renderStats(voiceList);
        renderEngineChips(data.groups);
        paintGrid();
        const bad = (data.groups || []).filter(g => !g.available).map(g => g.name);
        if (bad.length) Admin.toast(`${bad.join('、')} 当前不可用`, 'info');
      } catch (e) {
        bodyEl.innerHTML = `<div class="vl-error">音色加载失败：${esc(e.message)}</div>`;
      }
    }

    engEl.addEventListener('click', e => {
      const chip = e.target.closest('.vl-eng');
      if (!chip) return;
      enginePick = chip.dataset.e || '';
      engEl.querySelectorAll('.vl-eng').forEach(c => c.classList.toggle('on', c === chip));
      paintGrid();
    });
    textEl.addEventListener('input', () => {
      if (grid) grid.setPreviewText(textEl.value);
    });
    page.querySelector('#vl-refresh').addEventListener('click', () => {
      _cache = null;
      bodyEl.innerHTML = '<div class="vl-loading">重新拉取音色中…</div>';
      boot(true);
    });

    boot(false);
  });
})();
