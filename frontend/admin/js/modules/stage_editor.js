/* ===== 舞台编辑器（共用核心） =====
 * 蓝图检查器(story_blueprint_inspector.js) 与原版节点对话页(story.js) 共用。
 * 只负责一件事：在一个容器里，把「人物」按 pos_x/pos_y/scale 摆好，
 * 并提供 拖动移动 / 滚轮缩放 / 拖角缩放 / 居中吸附 / 方向键微调 / 放大窗口 这些交互，
 * 不再用任何滑块。
 *
 * 数据语义（与后端一致）：
 *   pos_x : 0~100  水平百分比（左右）
 *   pos_y : -40~80 底部百分比（负=下沉）
 *   scale : 0.2~3  缩放倍率
 *   flip/cropT/cropB : 翻转 / 裁剪上% / 裁剪下%
 *
 * API:
 *   StageEditor.build(stageEl, opts) -> { refresh, destroy }
 *     opts.getState() -> {bg, img, name, x, y, scale, flip, cropT, cropB}
 *     opts.onChange({x,y,scale})      // 调用方据此写回自己的模型
 *     opts.readOnly
 *   StageEditor.openBig(opts) -> { close }
 *     opts.title / opts.getState / opts.onApply(state)
 */
window.StageEditor = (function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
  const r1 = (v) => Math.round(v * 10) / 10;
  const bgCss = (u) => (u ? `url("${u.replace(/"/g, '%22')}") center/cover no-repeat` : 'none');

  function build(stageEl, opts) {
    opts = opts || {};
    stageEl.classList.add('stg');
    stageEl.innerHTML = `
      <div class="stg-bg"></div>
      <div class="stg-guide stg-guide-v"></div>
      <div class="stg-guide stg-guide-h"></div>
      <div class="stg-fig" tabindex="0" title="拖动移动 · 滚轮缩放 · 方向键微调">
        <span class="stg-ph"></span>
        <img class="stg-img" alt="" draggable="false">
      </div>
      <div class="stg-resize" title="拖动缩放人物"></div>
      <div class="stg-hud">
        <span class="stg-hud-x">X 50%</span>
        <span class="stg-hud-y">Y 0%</span>
        <span class="stg-hud-s">100%</span>
        <button type="button" class="stg-hud-btn" data-act="center">居中</button>
        <button type="button" class="stg-hud-btn" data-act="left">左</button>
        <button type="button" class="stg-hud-btn" data-act="right">右</button>
        <button type="button" class="stg-hud-btn" data-act="reset">重置</button>
      </div>`;

    const bg = stageEl.querySelector('.stg-bg');
    const fig = stageEl.querySelector('.stg-fig');
    const img = stageEl.querySelector('.stg-img');
    const ph = stageEl.querySelector('.stg-ph');
    const resize = stageEl.querySelector('.stg-resize');
    const gv = stageEl.querySelector('.stg-guide-v');
    const gh = stageEl.querySelector('.stg-guide-h');
    const hx = stageEl.querySelector('.stg-hud-x');
    const hy = stageEl.querySelector('.stg-hud-y');
    const hs = stageEl.querySelector('.stg-hud-s');
    const hud = stageEl.querySelector('.stg-hud');

    let S = { x: 50, y: 0, scale: 1, bg: '', img: '', name: '', flip: 0, cropT: 0, cropB: 100 };
    let mode = null, sx = 0, sy = 0, sState = null;

    function sync() {
      const st = opts.getState ? opts.getState() : S;
      S.x = num(st.x, 50); S.y = num(st.y, 0); S.scale = num(st.scale, 1);
      S.bg = st.bg || ''; S.img = st.img || ''; S.name = st.name || '';
      S.flip = st.flip ? 1 : 0; S.cropT = num(st.cropT, 0); S.cropB = num(st.cropB, 100);
      bg.style.background = S.bg ? bgCss(S.bg) : 'linear-gradient(135deg,#1a1d27,#0c0e15)';
      if (S.img) {
        if (img.getAttribute('src') !== S.img) img.src = S.img;
        img.style.display = 'block'; fig.classList.remove('stg-fig-empty');
      } else {
        img.style.display = 'none'; fig.classList.add('stg-fig-empty');
        ph.textContent = S.name ? S.name.slice(0, 4) : '';
      }
      img.style.transform = S.flip ? 'scaleX(-1)' : 'none';
      img.style.clipPath = S.img ? `inset(${S.cropT}% 0 ${Math.max(0, 100 - S.cropB)}% 0)` : 'none';
      applyPos();
    }

    function applyPos() {
      fig.style.left = S.x + '%';
      fig.style.bottom = S.y + '%';
      fig.style.transform = `translateX(-50%) scale(${S.scale})`;
      hx.textContent = 'X ' + S.x.toFixed(1) + '%';
      hy.textContent = 'Y ' + S.y.toFixed(1) + '%';
      hs.textContent = Math.round(S.scale * 100) + '%';
      positionResize();
    }

    // 缩放句柄是 stage 的子元素（不随 figure 一起 scale），需按 figure 实时位置摆放
    function positionResize() {
      const sr = stageEl.getBoundingClientRect();
      const fr = fig.getBoundingClientRect();
      if (!fr.width) return;
      const hs = resize.offsetWidth || 16;
      resize.style.left = (fr.right - sr.left - hs / 2) + 'px';
      resize.style.top = (fr.top - sr.top - hs / 2) + 'px';
    }

    function emit() { if (opts.onChange) opts.onChange({ x: S.x, y: S.y, scale: S.scale }); }

    // ---- 拖拽移动 ----
    fig.addEventListener('pointerdown', (e) => {
      if (e.target === resize || opts.readOnly) return;
      mode = 'move'; sx = e.clientX; sy = e.clientY; sState = { ...S };
      try { fig.setPointerCapture(e.pointerId); } catch (_) {}
      fig.classList.add('stg-dragging');
      e.preventDefault(); e.stopPropagation();
    });
    // ---- 拖角缩放 ----
    resize.addEventListener('pointerdown', (e) => {
      if (opts.readOnly) return;
      mode = 'scale'; sx = e.clientX; sy = e.clientY; sState = { ...S };
      try { resize.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });

    const onMove = (e) => {
      if (!mode) return;
      const sr = stageEl.getBoundingClientRect();
      if (mode === 'move') {
        const dx = (e.clientX - sx) / sr.width * 100;
        const dy = -(e.clientY - sy) / sr.height * 100;
        let nx = clamp(sState.x + dx, 0, 100);
        let ny = clamp(sState.y + dy, -40, 80);
        const snapX = Math.abs(nx - 50) < 1.5, snapY = Math.abs(ny - 0) < 1.5;
        if (snapX) nx = 50; if (snapY) ny = 0;
        S.x = r1(nx); S.y = r1(ny);
        gv.style.opacity = snapX ? '1' : '0';
        gh.style.opacity = snapY ? '1' : '0';
        applyPos(); emit();
      } else if (mode === 'scale') {
        const fr = fig.getBoundingClientRect();
        const pivotX = fr.left + fr.width / 2, pivotY = fr.bottom;
        const d0 = Math.hypot(pivotX - sx, pivotY - sy) || 1;
        const d1 = Math.hypot(e.clientX - pivotX, e.clientY - pivotY);
        S.scale = Math.round(clamp(sState.scale * (d1 / d0), 0.2, 3) * 100) / 100;
        applyPos(); emit();
      }
    };
    const onUp = () => {
      if (!mode) return;
      mode = null; fig.classList.remove('stg-dragging');
      gv.style.opacity = '0'; gh.style.opacity = '0';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // ---- 滚轮缩放（停在舞台上即可） ----
    stageEl.addEventListener('wheel', (e) => {
      if (opts.readOnly) return;
      e.preventDefault();
      S.scale = Math.round(clamp(S.scale * Math.exp(-e.deltaY * 0.0015), 0.2, 3) * 100) / 100;
      applyPos(); emit();
    }, { passive: false });

    // ---- 键盘微调 ----
    fig.addEventListener('keydown', (e) => {
      if (opts.readOnly) return;
      const step = e.shiftKey ? 2 : 0.5;
      const k = e.key;
      if (k === 'ArrowLeft') S.x = r1(clamp(S.x - step, 0, 100));
      else if (k === 'ArrowRight') S.x = r1(clamp(S.x + step, 0, 100));
      else if (k === 'ArrowUp') S.y = r1(clamp(S.y + step, -40, 80));
      else if (k === 'ArrowDown') S.y = r1(clamp(S.y - step, -40, 80));
      else if (k === '+' || k === '=') S.scale = Math.round(clamp(S.scale * 1.1, 0.2, 3) * 100) / 100;
      else if (k === '-' || k === '_') S.scale = Math.round(clamp(S.scale / 1.1, 0.2, 3) * 100) / 100;
      else return;
      e.preventDefault();
      applyPos(); emit();
    });

    // ---- HUD 快捷 ----
    hud.addEventListener('click', (e) => {
      const act = e.target.dataset.act; if (!act || opts.readOnly) return;
      if (act === 'center') S.x = 50;
      else if (act === 'left') S.x = 20;
      else if (act === 'right') S.x = 80;
      else if (act === 'reset') { S.x = 50; S.y = 0; S.scale = 1; }
      applyPos(); emit();
    });

    const ro = ('ResizeObserver' in window) ? new ResizeObserver(positionResize) : null;
    if (ro) ro.observe(stageEl);
    sync();

    return {
      refresh: sync,
      destroy() {
        if (ro) ro.disconnect();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        stageEl.innerHTML = '';
        stageEl.classList.remove('stg');
      },
    };
  }

  /* ============ 放大窗口 ============ */
  function openBig(opts) {
    opts = opts || {};
    const overlay = document.createElement('div');
    overlay.className = 'stg-modal-overlay';
    overlay.innerHTML = `
      <div class="stg-modal">
        <div class="stg-modal-head">
          <b>${esc(opts.title || '舞台调整')}</b>
          <span class="stg-modal-tip">拖动人物移动 · 滚轮或拖右下角缩放 · 方向键微调 · 关闭自动应用</span>
          <button type="button" class="stg-modal-x" title="关闭">✕</button>
        </div>
        <div class="stg-modal-body">
          <div class="stg-modal-stage" id="stg-modal-stage"></div>
          <div class="stg-modal-side">
            <div class="stg-side-row"><label>背景图</label><input type="text" id="stg-big-bg" placeholder="留空用节点背景"></div>
            <div class="stg-side-row"><label>翻转</label>
              <select id="stg-big-flip"><option value="0">否</option><option value="1">是</option></select></div>
            <div class="stg-side-row"><label>裁剪上 %</label><input type="number" id="stg-big-ct" step="1" value="0"></div>
            <div class="stg-side-row"><label>裁剪下 %</label><input type="number" id="stg-big-cb" step="1" value="100"></div>
            <div class="stg-side-actions">
              <button type="button" class="btn btn-primary btn-sm" id="stg-big-apply">应用</button>
              <button type="button" class="btn btn-outline btn-sm" id="stg-big-cancel">取消</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('#stg-modal-stage');
    const local = opts.getState ? { ...opts.getState() } : { x: 50, y: 0, scale: 1, bg: '', img: '', name: '', flip: 0, cropT: 0, cropB: 100 };
    const inst = build(stage, {
      getState: () => local,
      onChange: (d) => { local.x = d.x; local.y = d.y; local.scale = d.scale; },
    });

    const bgIn = overlay.querySelector('#stg-big-bg');
    const flipIn = overlay.querySelector('#stg-big-flip');
    const ctIn = overlay.querySelector('#stg-big-ct');
    const cbIn = overlay.querySelector('#stg-big-cb');
    bgIn.value = local.bg || '';
    flipIn.value = local.flip ? '1' : '0';
    ctIn.value = local.cropT ?? 0;
    cbIn.value = local.cropB ?? 100;

    const syncSide = () => {
      local.bg = bgIn.value.trim();
      local.flip = flipIn.value === '1' ? 1 : 0;
      local.cropT = parseFloat(ctIn.value) || 0;
      local.cropB = parseFloat(cbIn.value) || 100;
      inst.refresh();
    };
    [bgIn, flipIn, ctIn, cbIn].forEach((el) => el.addEventListener('input', syncSide));

    let applied = false;
    const close = (apply) => {
      if (apply && opts.onApply) { opts.onApply(local); applied = true; }
      inst.destroy();
      overlay.remove();
    };
    overlay.querySelector('#stg-big-apply').addEventListener('click', () => close(true));
    overlay.querySelector('#stg-big-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.stg-modal-x').addEventListener('click', () => close(false));
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(false); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(applied); });

    return { close };
  }

  return { build, openBig };
})();
