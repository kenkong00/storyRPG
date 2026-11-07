// ========== 后台设置 → 剧情管理 ==========
// 只做一件事：集中放「跟剧情演出有关的全局参数」。
// 现在有说话人高亮 + 自动播放，以后加转场、字幕、打字速度就往这里加分组，
// 不用再开新页面 —— 用户要的就是这个「以后还能往里放东西」的位置。
//
// 存的是全站默认值（/api/story/settings）。玩家在自己机器上改的只落 localStorage，
// 不影响这里，也不会污染别人的默认值。
(function () {
  if (window.StorySettings) return;

  const S = { cur: null, defaults: null, modes: [], dirty: false };

  const MODES = [
    ['off', '关闭', '原色调，不叠加滤镜'],
    ['subtle', '柔和', '推荐：说话者微亮、其他人微暗'],
    ['normal', '标准', '对比更明显'],
    ['strong', '强烈', '提亮 + 金色辉光'],
    ['custom', '自定义', '用下面的滑块自己调'],
  ];

  const PRESETS = {
    subtle: { dim_brightness: 0.84, dim_saturate: 0.88, speak_brightness: 1.07, speak_saturate: 1.03, speak_glow: 0 },
    normal: { dim_brightness: 0.72, dim_saturate: 0.8, speak_brightness: 1.12, speak_saturate: 1.05, speak_glow: 0 },
    strong: { dim_brightness: 0.6, dim_saturate: 0.72, speak_brightness: 1.18, speak_saturate: 1.12, speak_glow: 45 },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureCss() {
    if (document.getElementById('sst-css')) return;
    const st = document.createElement('style');
    st.id = 'sst-css';
    st.textContent = `
      .sst-wrap{max-width:960px}
      .sst-card{background:var(--bg-card,#151515);border:1px solid var(--border);border-radius:8px;
        padding:16px 18px;margin-bottom:14px}
      .sst-card h4{margin:0 0 4px;font-size:13.5px;color:var(--gold);font-weight:600}
      .sst-sub{font-size:12px;color:var(--text-muted);line-height:1.7;margin:0 0 12px}
      .sst-modes{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
      .sst-mode{flex:1 1 130px;min-width:110px;padding:9px 12px;border-radius:6px;cursor:pointer;
        border:1px solid var(--border);background:transparent;color:var(--text-secondary);
        font-family:inherit;font-size:12.5px;text-align:left;transition:all .18s}
      .sst-mode:hover{border-color:rgba(201,168,76,.5);color:var(--text-primary)}
      .sst-mode.on{border-color:var(--gold);background:rgba(201,168,76,.12);color:var(--gold)}
      .sst-mode i{display:block;font-style:normal;font-size:11px;color:var(--text-muted);margin-top:3px}
      .sst-mode.on i{color:rgba(201,168,76,.75)}
      .sst-row{display:flex;align-items:center;gap:12px;margin:9px 0}
      .sst-lbl{flex:0 0 120px;font-size:12.5px;color:var(--text-secondary)}
      .sst-lbl small{display:block;font-size:10.5px;color:var(--text-muted);margin-top:1px}
      .sst-range{flex:1;height:4px;border-radius:2px;-webkit-appearance:none;appearance:none;outline:none;cursor:pointer;
        background:linear-gradient(90deg,rgba(201,168,76,.55),rgba(201,168,76,.12))}
      .sst-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;
        background:var(--gold);border:2px solid #14100a;box-shadow:0 0 8px rgba(201,168,76,.45);cursor:pointer}
      .sst-val{flex:0 0 62px;text-align:right;font-size:12.5px;color:var(--gold);font-variant-numeric:tabular-nums}
      .sst-ck{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-secondary);cursor:pointer}
      .sst-ck input{accent-color:var(--gold)}
      .sst-actions{display:flex;gap:10px;align-items:center;margin-top:6px}
      .sst-state{font-size:12px;color:var(--text-muted)}
      .sst-state.ok{color:#7bd88f}
      .sst-tip{margin-top:10px;padding:8px 11px;font-size:11.5px;line-height:1.7;color:var(--text-muted);
        background:rgba(201,168,76,.06);border-left:2px solid rgba(201,168,76,.4);border-radius:0 4px 4px 0}
      .sst-todo{border-style:dashed;opacity:.65}
      .sst-todo .sst-sub{margin:0}
      /* 预览条：不打开游戏也能看出这一档的效果 */
      .sst-prev{display:flex;align-items:flex-end;gap:0;height:76px;margin:2px 0 14px;
        border-radius:6px;overflow:hidden;background:linear-gradient(180deg,#1b1b22,#0e0e12)}
      .sst-fig{flex:1;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;
        font-size:11px;color:#cfc6ae;transition:filter .25s}
      .sst-fig b{display:block;text-align:center;font-size:22px;line-height:1;margin-bottom:4px;
        filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
    `;
    document.head.appendChild(st);
  }

  async function load() {
    const r = await Admin.get('/story/settings');
    S.cur = Object.assign({}, r.settings || {});
    S.defaults = Object.assign({}, r.defaults || {});
    S.modes = r.modes || MODES.map(m => m[0]);
  }

  function previewHtml() {
    const s = S.cur || {};
    const on = s.stage_focus_mode !== 'off';
    const dim = on ? `brightness(${s.dim_brightness}) saturate(${s.dim_saturate})` : 'none';
    let spk = on ? `brightness(${s.speak_brightness}) saturate(${s.speak_saturate})` : 'none';
    const glow = Number(s.speak_glow) || 0;
    if (on && glow > 0) {
      spk += ` drop-shadow(0 0 ${Math.round(glow * 0.18)}px rgba(212,175,55,${(glow / 100 * 0.5).toFixed(2)}))`;
    }
    return `<div class="sst-prev">
      <div class="sst-fig" style="filter:${esc(dim)}"><div><b>☺</b>旁听</div></div>
      <div class="sst-fig" style="filter:${esc(spk)}"><div><b>☻</b>说话中</div></div>
      <div class="sst-fig" style="filter:${esc(dim)}"><div><b>☺</b>旁听</div></div>
    </div>`;
  }

  function slider(id, label, hint, min, max, step, val, unit, isInt) {
    return `<div class="sst-row">
      <div class="sst-lbl">${label}${hint ? `<small>${hint}</small>` : ''}</div>
      <input type="range" class="sst-range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
      <div class="sst-val" id="${id}-val">${isInt ? Math.round(val) : Number(val).toFixed(2)}${unit}</div>
    </div>`;
  }

  function render(host) {
    ensureCss();
    if (!S.cur) { host.innerHTML = '<div class="cs-empty">加载中…</div>'; return; }
    const s = S.cur;
    const mode = s.stage_focus_mode || 'subtle';

    host.innerHTML = `<div class="sst-wrap">
      <div class="sst-card">
        <h4>说话人高亮</h4>
        <p class="sst-sub">剧情对话里正在说话的人提亮、在场其他人轻微压暗，一眼分得清谁在讲。
          这里是<b>全站默认值</b>：玩家在游戏内「设置 → 剧情演出」里改的只影响他自己那台机器。</p>
        ${previewHtml()}
        <div class="sst-modes">
          ${MODES.map(([k, name, hint]) => `
            <button type="button" class="sst-mode${k === mode ? ' on' : ''}" data-mode="${k}">
              ${name}<i>${hint}</i>
            </button>`).join('')}
        </div>
      </div>

      <div class="sst-card">
        <h4>细粒度参数</h4>
        <p class="sst-sub">拖任意滑块会自动切到「自定义」。数值越大越亮；非说话者越暗对比越强，但太暗会看不清表情。</p>
        ${slider('s-dim-b', '非说话者亮度', '建议 0.75~0.9', 0.2, 1.2, 0.01, s.dim_brightness, '', false)}
        ${slider('s-dim-s', '非说话者饱和', '越低越灰', 0, 1.6, 0.01, s.dim_saturate, '', false)}
        ${slider('s-spk-b', '说话者亮度', '大于 1 才提亮', 0.7, 1.6, 0.01, s.speak_brightness, '', false)}
        ${slider('s-spk-s', '说话者饱和', '', 0, 2.2, 0.01, s.speak_saturate, '', false)}
        ${slider('s-glow', '说话者辉光', '0 = 不发光', 0, 100, 1, s.speak_glow, '', true)}
        ${slider('s-tr', '过渡时长', '换人时明暗变化速度', 0, 2000, 20, s.focus_transition_ms, 'ms', true)}
      </div>

      <div class="sst-card">
        <h4>自动播放</h4>
        <p class="sst-sub">玩家点右上角「自动」后，每句演完自动继续，适合暂时离开电脑。这里设的是默认行为与节奏。</p>
        <label class="sst-ck"><input type="checkbox" id="s-auto-default" ${s.auto_play_default ? 'checked' : ''}>
          进游戏时默认开启自动播放</label>
        <div style="height:8px"></div>
        ${slider('s-delay', '每句停顿', '语音播完后再等这么久', 0, 4000, 100, s.auto_play_delay_ms, 'ms', true)}
        <div class="sst-tip">遇到选项 / 战斗 / 打开面板时自动停下，不会替玩家做选择。</div>
      </div>

      <div class="sst-card sst-todo">
        <h4>以后还能往这里加</h4>
        <p class="sst-sub">转场时长、字幕样式、打字机速度、旁白节奏……这类剧情演出参数都放这个页面，
          不用再开新栏目。</p>
      </div>

      <div class="sst-actions">
        <button class="btn btn-gold btn-sm" id="s-save">保存为全站默认</button>
        <button class="btn btn-outline btn-sm" id="s-reset">恢复出厂值</button>
        <span class="sst-state" id="s-state"></span>
      </div>
    </div>`;

    // 档位
    host.querySelectorAll('.sst-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.mode;
        if (k !== 'custom' && PRESETS[k]) Object.assign(S.cur, PRESETS[k]);
        S.cur.stage_focus_mode = k;
        S.dirty = true;
        render(host);
        markDirty();
      });
    });

    // 滑块
    const bind = (id, key, unit, isInt) => {
      const el = host.querySelector('#' + id);
      const out = host.querySelector('#' + id + '-val');
      if (!el) return;
      el.addEventListener('input', () => {
        const v = isInt ? Math.round(parseFloat(el.value)) : parseFloat(el.value);
        out.textContent = (isInt ? v : v.toFixed(2)) + unit;
        S.cur[key] = v;
        S.cur.stage_focus_mode = 'custom';
        S.dirty = true;
        // 现场看效果：只重画预览条，不重画整页（否则滑块会失去焦点）
        const pv = host.querySelector('.sst-prev');
        if (pv) pv.outerHTML = previewHtml();
        host.querySelectorAll('.sst-mode').forEach(b =>
          b.classList.toggle('on', b.dataset.mode === 'custom'));
        markDirty();
      });
    };
    bind('s-dim-b', 'dim_brightness', '', false);
    bind('s-dim-s', 'dim_saturate', '', false);
    bind('s-spk-b', 'speak_brightness', '', false);
    bind('s-spk-s', 'speak_saturate', '', false);
    bind('s-glow', 'speak_glow', '', true);
    bind('s-tr', 'focus_transition_ms', 'ms', true);
    bind('s-delay', 'auto_play_delay_ms', 'ms', true);

    host.querySelector('#s-auto-default')?.addEventListener('change', (e) => {
      S.cur.auto_play_default = e.target.checked;
      S.dirty = true;
      markDirty();
    });

    host.querySelector('#s-save')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await Admin.put('/story/settings', { settings: S.cur });
        S.cur = r.settings || S.cur;
        S.dirty = false;
        mark('已保存', true);
        Admin.toast('剧情演出默认值已保存', 'success');
        render(host);
      } catch (err) {
        Admin.toast('保存失败：' + err.message, 'error');
      } finally { btn.disabled = false; }
    });

    host.querySelector('#s-reset')?.addEventListener('click', async () => {
      if (!await Admin.confirm('把所有剧情演出参数恢复成出厂值？')) return;
      try {
        const r = await Admin.post('/story/settings/reset', {});
        S.cur = r.settings || S.cur;
        S.dirty = false;
        mark('已恢复出厂值', true);
        Admin.toast('已恢复出厂值', 'success');
        render(host);
      } catch (err) {
        Admin.toast('恢复失败：' + err.message, 'error');
      }
    });
  }

  function mark(text, ok) {
    const el = document.getElementById('s-state');
    if (!el) return;
    el.textContent = text;
    el.className = 'sst-state' + (ok ? ' ok' : '');
  }
  function markDirty() { mark('有改动未保存'); }

  window.StorySettings = {
    async render(host) {
      if (!S.cur) {
        try { await load(); }
        catch (e) { host.innerHTML = `<div class="cs-empty">加载失败：${esc(e.message)}</div>`; return; }
      }
      render(host);
    },
  };
})();
