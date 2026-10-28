// ========== 图片浏览控件（整屏画布版） ==========
// 出图之后最常问的三件事：这张图多大？用的什么提示词？哪个方案、什么种子？
// 现在把它做成一个「画布」：
//   · 整个屏幕就是画布，图片居中，滚轮以光标为锚点缩放，按住拖动可平移
//   · 顶部居中一条工具条：上一张 / 下一张 / 显示隐藏信息面板 / 适应屏幕 / 1:1 / 关闭
//   · 右侧信息面板可收起；翻到上一张下一张时，尺寸、提示词、参数全部跟着换
//   · ← → 翻页，Esc 关闭，双击复位
//
// 用法：
//   ImagePreview.open([{url, title, prompt, width, height, meta:{...}}], 0)
(function () {
  if (window.ImagePreview) return;

  // 当前视图状态（每次 open 重置）
  let box = null;
  let items = [];
  let idx = 0;
  let scale = 1;
  let tx = 0, ty = 0;
  let infoOpen = true;
  let dragging = false;
  let dragX = 0, dragY = 0;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function prettyTime(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(v || '');
  }

  function ensureStyle() {
    if (document.getElementById('ip-style-tag')) return;
    const st = document.createElement('style');
    st.id = 'ip-style-tag';
    st.textContent = `
      .ip-overlay{position:fixed;inset:0;background:rgba(8,8,10,.96);z-index:9600;
        overflow:hidden;user-select:none}
      /* 画布：图片在里面自由缩放平移 */
      .ip-canvas{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        cursor:grab;transition:margin-right .2s ease}
      /* 信息面板占掉右侧一条（510px = 原 340 加宽 50%），让图片在剩下的空间里居中 */
      .ip-canvas{margin-right:510px}
      .ip-overlay.noinfo .ip-canvas{margin-right:0}
      @media (max-width:1100px){ .ip-canvas{margin-right:0} }
      .ip-canvas.grab{cursor:grabbing}
      .ip-canvas.layered{background-image:linear-gradient(45deg,#22222a 25%,transparent 25%),
          linear-gradient(-45deg,#22222a 25%,transparent 25%),
          linear-gradient(45deg,transparent 75%,#22222a 75%),
          linear-gradient(-45deg,transparent 75%,#22222a 75%);
        background-size:22px 22px;background-position:0 0,0 11px,11px -11px,-11px 0;
        background-color:#141418}
      .ip-img{max-width:100%;max-height:100%;display:block;transform-origin:0 0;
        box-shadow:0 18px 60px rgba(0,0,0,.55);will-change:transform}
      /* 顶部居中工具条 */
      .ip-bar{position:absolute;top:14px;left:50%;transform:translateX(-50%);
        display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:24px;
        background:rgba(24,24,28,.92);border:1px solid rgba(255,255,255,.12);
        box-shadow:0 8px 26px rgba(0,0,0,.5);z-index:5}
      .ip-bar button{height:34px;min-width:34px;padding:0 10px;border-radius:17px;border:none;
        background:transparent;color:#d8d8e0;font-size:16px;cursor:pointer;line-height:1;
        display:flex;align-items:center;gap:5px}
      .ip-bar button:hover{background:rgba(201,168,76,.18);color:var(--gold)}
      .ip-bar button.on{background:var(--gold);color:#171410}
      .ip-bar button:disabled{opacity:.35;cursor:not-allowed;background:transparent;color:#888}
      .ip-bar .sep{width:1px;height:18px;background:rgba(255,255,255,.14);margin:0 2px}
      .ip-bar .txt{font-size:14.5px;color:#cfd3e6;padding:0 6px;font-variant-numeric:tabular-nums}
      /* 右侧信息面板（加宽 50%：340 → 510） */
      .ip-side{position:absolute;top:0;right:0;bottom:0;width:510px;max-width:92vw;
        background:rgba(20,20,26,.97);border-left:1px solid rgba(255,255,255,.1);
        padding:18px 20px;overflow:auto;z-index:4;transition:transform .2s ease}
      .ip-overlay.noinfo .ip-side{transform:translateX(100%)}
      .ip-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
      .ip-head b{font-size:16px;color:var(--text-primary);flex:1;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ip-close{cursor:pointer;color:var(--text-muted);font-size:20px;line-height:1}
      .ip-close:hover{color:var(--red)}
      .ip-size{font-size:14.5px;color:var(--text-primary);margin-bottom:12px;
        padding:9px 11px;background:var(--bg-input);border-radius:5px;border:1px solid var(--border)}
      .ip-size .dim{opacity:.62;font-size:13.5px;margin-left:8px}
      .ip-kv{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
      .ip-kv span{font-size:13px;padding:4px 9px;border:1px solid var(--border);border-radius:10px;
        color:var(--text-muted);max-width:100%;word-break:break-all}
      .ip-kv b{color:var(--text-primary);font-weight:600}
      .ip-sec{font-size:13px;color:var(--gold);margin:14px 0 6px;font-weight:600}
      .ip-pre{font-size:13.5px;line-height:1.75;color:var(--text-primary);white-space:pre-wrap;
        background:var(--bg-input);border:1px solid var(--border);border-radius:5px;
        padding:11px 12px;max-height:440px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;margin:0}
      .ip-btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
      .ip-btns button{font-size:13px;padding:6px 12px;border-radius:4px;border:1px solid var(--border);
        background:transparent;color:var(--text-primary);cursor:pointer}
      .ip-btns button:hover{border-color:var(--gold);color:var(--gold)}
      .ip-url{font-size:12.5px;color:var(--text-muted);word-break:break-all;line-height:1.6}
      .ip-zoomtag{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
        font-size:13.5px;color:#cfd3e6;background:rgba(0,0,0,.55);padding:4px 13px;border-radius:12px;z-index:5}
      .ip-hint{position:absolute;bottom:12px;left:16px;font-size:13px;color:#7a7a86;z-index:5}
    `;
    document.head.appendChild(st);
  }

  function close() {
    if (box) { box.remove(); box = null; }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
  }

  function onKey(e) {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === '1') { e.preventDefault(); actual(); }
  }

  function go(i) {
    if (!items.length) return;
    idx = (i + items.length) % items.length;
    resetView();
    paint();
  }

  function resetView() { scale = 1; tx = 0; ty = 0; }

  function applyTransform() {
    const img = box && box.querySelector('.ip-img');
    if (!img) return;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    const tag = box.querySelector('.ip-zoomtag');
    if (tag) tag.textContent = Math.round(scale * 100) + '%';
  }

  /** 适应屏幕：按图片原始尺寸和画布大小算出刚好放下的比例 */
  function fit() {
    const img = box.querySelector('.ip-img');
    const cv = box.querySelector('.ip-canvas');
    if (!img || !cv) return;
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    // cv 的宽度已经排除了信息面板（靠 margin-right 让出来的），这里只留一点边距
    const cw = cv.clientWidth - 48;
    const ch = cv.clientHeight - 96;
    scale = Math.min(cw / nw, ch / nh, 8);
    tx = 0; ty = 0;
    applyTransform();
  }

  function actual() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  // ---------- 滚轮缩放（以光标为锚点） ----------
  function onWheel(e) {
    if (!box) return;
    e.preventDefault();
    const cv = box.querySelector('.ip-canvas');
    const rect = cv.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.min(16, Math.max(0.05, scale * factor));
    const k = next / scale;
    // 让光标下的那个像素在缩放后仍然停在光标下
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    scale = next;
    applyTransform();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    dragX = e.clientX; dragY = e.clientY;
    box.querySelector('.ip-canvas').classList.add('grab');
  }
  function onMove(e) {
    if (!dragging || !box) return;
    tx += e.clientX - dragX;
    ty += e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    applyTransform();
  }
  function onUp() {
    dragging = false;
    if (box) box.querySelector('.ip-canvas')?.classList.remove('grab');
  }

  function toggleInfo(force) {
    infoOpen = force === undefined ? !infoOpen : !!force;
    box.classList.toggle('noinfo', !infoOpen);
    const b = box.querySelector('[data-a="info"]');
    if (b) {
      b.classList.toggle('on', infoOpen);
      b.title = infoOpen ? '隐藏信息面板' : '显示信息面板';
    }
  }

  function paint() {
    const it = items[idx] || {};
    const img = box.querySelector('.ip-img');
    const cv = box.querySelector('.ip-canvas');
    img.src = it.url || '';
    img.style.transform = '';
    scale = 1; tx = 0; ty = 0;

    // 顶部工具条状态
    const n = items.length;
    box.querySelector('.ip-count').textContent = n > 1 ? `${idx + 1} / ${n}` : '';
    box.querySelector('[data-a="prev"]').disabled = n < 2;
    box.querySelector('[data-a="next"]').disabled = n < 2;
    box.querySelector('.ip-title').textContent = it.title || '图片预览';

    // 尺寸：先显示记录值，图片加载出来后用真实像素校正
    const sizeEl = box.querySelector('.ip-size');
    const showSize = (realW, realH) => {
      const w = it.width || realW || 0, h = it.height || realH || 0;
      const extra = [];
      if (realW && realH) extra.push(`实际 ${realW}×${realH}`);
      if (it.width && it.height && realW && (it.width !== realW || it.height !== realH)) {
        extra.push(`出图参数 ${it.width}×${it.height}`);
      }
      sizeEl.innerHTML = w && h
        ? `<b>${w} × ${h}</b> 像素${extra.length ? `<span class="dim">${esc(extra.join('　'))}</span>` : ''}`
        : '<span style="opacity:.7">尺寸未知</span>';
    };
    showSize(0, 0);
    if (img.complete && img.naturalWidth) showSize(img.naturalWidth, img.naturalHeight);
    img.onload = () => { showSize(img.naturalWidth, img.naturalHeight); applyTransform(); };

    // 参数信息
    const meta = it.meta || {};
    const kv = box.querySelector('.ip-kv');
    const rows = Object.entries(meta)
      .filter(([, v]) => v !== '' && v != null && v !== undefined)
      .map(([k, v]) => [k, k === '时间' ? prettyTime(v) : v]);
    kv.innerHTML = rows.length
      ? rows.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')
      : '';

    const pre = box.querySelector('.ip-pre');
    const hasPrompt = !!(it.prompt || '').trim();
    pre.textContent = hasPrompt
      ? it.prompt
      : '（这张是早期生成的图，当时还没记录提示词——重新出图后会带上完整提示词）';
    pre.style.opacity = hasPrompt ? '1' : '.62';
    pre.style.fontStyle = hasPrompt ? '' : 'italic';
    box.querySelector('.ip-copy-prompt').style.display = hasPrompt ? '' : 'none';
    box.querySelector('.ip-url').textContent = it.url || '';
  }

  function open(list, start) {
    ensureStyle();
    items = (Array.isArray(list) ? list : [list]).filter((x) => x && x.url);
    if (!items.length) { Admin.toast('没有可预览的图片', 'error'); return; }
    idx = Math.max(0, Math.min(start || 0, items.length - 1));
    infoOpen = true;
    resetView();
    close();

    box = document.createElement('div');
    box.className = 'ip-overlay';
    box.innerHTML = `
      <div class="ip-canvas layered">
        <img class="ip-img" src="" alt="" draggable="false">
      </div>
      <div class="ip-bar">
        <button data-a="prev" title="上一张（←）">‹</button>
        <span class="txt ip-count"></span>
        <button data-a="next" title="下一张（→）">›</button>
        <span class="sep"></span>
        <button data-a="info" class="on" title="隐藏信息面板">ℹ</button>
        <button data-a="fit" title="适应屏幕（0）">⤢ 适应</button>
        <button data-a="one" title="原始大小 1:1（1）">1:1</button>
        <span class="sep"></span>
        <button data-a="close" title="关闭（Esc）">✕</button>
      </div>
      <div class="ip-side">
        <div class="ip-head"><b class="ip-title">图片预览</b></div>
        <div class="ip-size"></div>
        <div class="ip-kv"></div>
        <div class="ip-sec">使用的提示词</div>
        <pre class="ip-pre"></pre>
        <div class="ip-btns">
          <button class="ip-copy-prompt">复制提示词</button>
          <button class="ip-raw">打开原图</button>
        </div>
        <div class="ip-sec">文件</div>
        <div class="ip-url"></div>
      </div>
      <div class="ip-zoomtag">100%</div>
      <div class="ip-hint">滚轮缩放 · 按住拖动平移 · ← → 翻页 · Esc 关闭</div>
    `;
    document.body.appendChild(box);

    const cv = box.querySelector('.ip-canvas');
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('dblclick', () => (scale === 1 ? fit() : actual()));
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-a]');
      if (btn) {
        const a = btn.dataset.a;
        if (a === 'prev') go(idx - 1);
        else if (a === 'next') go(idx + 1);
        else if (a === 'info') toggleInfo();
        else if (a === 'fit') fit();
        else if (a === 'one') actual();
        else if (a === 'close') close();
        return;
      }
      // 点画布空白处（不是图片）也关闭
      if (e.target === cv) close();
    });

    box.querySelector('.ip-raw').addEventListener('click', () => {
      window.open(items[idx].url, '_blank');
    });
    box.querySelector('.ip-copy-prompt').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(items[idx].prompt || '');
        Admin.toast('提示词已复制', 'success');
      } catch (_) { Admin.toast('复制失败，可手动选中文本', 'error'); }
    });

    document.addEventListener('keydown', onKey, true);
    paint();
  }

  window.ImagePreview = { open, close };
})();
