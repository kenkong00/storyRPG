// ========== 前台漫画阅读器 ==========
// 书架 → 打开作品 → 页漫翻页（右→左可切换）/ 条漫纵向滚动 / 小人书逐页
// 画面用 canvas 重画（和后台导出同一套绘制规则），保证所见即所得。
(function () {
  const API = '/api/comic/public';
  const IMG = new Map();

  const ST = {
    projects: [],
    project: null,     // 作品树
    bookId: null,
    pageId: null,
    idx: 0,
    pages: [],         // 当前册的页面
    scroll: false,     // 是否纵向滚动
    rtl: true,
    tocOpen: false,
  };

  const $ = (s) => document.querySelector(s);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function loadImg(url) {
    if (!url) return Promise.resolve(null);
    if (IMG.has(url)) return Promise.resolve(IMG.get(url));
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => { IMG.set(url, im); res(im); };
      im.onerror = () => res(null);
      im.src = url;
    });
  }

  function normPoints(points) {
    if (!Array.isArray(points) || points.length < 3) return [[0, 0], [1, 0], [1, 1], [0, 1]];
    return points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
  }

  /* ---------------- 书架 ---------------- */
  async function loadShelf() {
    const grid = $('#shelf-grid');
    const empty = $('#shelf-empty');
    grid.innerHTML = '<div class="shelf-empty">加载中…</div>';
    try {
      const list = await (await fetch(`${API}/projects`)).json();
      ST.projects = Array.isArray(list) ? list : [];
    } catch (e) {
      ST.projects = [];
    }
    if (!ST.projects.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    const modeLabel = { manga: '页漫', scroll: '条漫', lianhuanhua: '小人书' };
    grid.innerHTML = ST.projects.map((p) => `
      <div class="comic-card" data-id="${p.id}">
        <div class="cover">
          ${p.cover ? `<img src="${esc(p.cover)}" alt="">` : '<div class="ph">▤</div>'}
          <span class="mode">${modeLabel[p.mode] || '漫画'}</span>
        </div>
        <div class="t">${esc(p.title)}</div>
        <div class="m">${p.author ? esc(p.author) + ' · ' : ''}${p.page_count || 0} 页${p.stats ? ` · ${p.stats.done} 格完成` : ''}</div>
      </div>`).join('');
    grid.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => openProject(Number(el.dataset.id))));
  }

  /* ---------------- 打开作品 ---------------- */
  async function openProject(id) {
    let data;
    try {
      const r = await fetch(`${API}/projects/${id}`);
      if (!r.ok) throw new Error('作品未发布或不存在');
      data = await r.json();
    } catch (e) {
      showHint(e.message);
      return;
    }
    ST.project = data;
    ST.rtl = data.project.reading_direction !== 'left_to_right';
    ST.scroll = data.project.mode === 'scroll';

    const books = data.books || [];
    ST.bookId = books[0]?.id || null;
    const sel = $('#rd-book');
    sel.innerHTML = books.map((b) => `<option value="${b.id}">${esc(b.title)} · ${b.pages.length} 页</option>`).join('');
    sel.value = ST.bookId;
    sel.style.display = books.length > 1 ? '' : 'none';

    $('#rd-title').textContent = data.project.title;
    $('#rd-mode').textContent = ST.scroll ? '滚动模式' : '翻页模式';
    $('#rd-mode').classList.toggle('on', ST.scroll);
    $('#shelf').style.display = 'none';
    $('#reader').classList.add('on');

    selectBook(ST.bookId, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
  }

  function selectBook(bookId, reset) {
    ST.bookId = bookId;
    const book = (ST.project.books || []).find((b) => b.id === bookId);
    ST.pages = book ? book.pages : [];
    const saved = Number(localStorage.getItem('comic_progress_' + ST.project.project.id) || 0);
    ST.idx = reset && saved && saved < ST.pages.length ? saved : 0;
    ST.pageId = ST.pages[ST.idx]?.id || null;
    renderToc();
    render();
  }

  /* ---------------- 渲染 ---------------- */
  let renderSeq = 0;
  async function render() {
    const stage = $('#rd-stage');
    const seq = ++renderSeq;
    if (!ST.pages.length) {
      stage.innerHTML = '<div class="shelf-empty">这一册还没有页面</div>';
      return;
    }
    stage.className = 'rd-stage' + (ST.scroll ? ' scroll' : '');
    stage.innerHTML = '';
    if (ST.scroll) {
      $('#rd-idx').textContent = `滚动 · 共 ${ST.pages.length} 页`;
      $('#rd-progress-fill').style.width = '100%';
      for (let i = 0; i < ST.pages.length; i++) {
        const pg = ST.pages[i];
        const wrap = document.createElement('div');
        wrap.className = 'rd-page-wrap';
        stage.appendChild(wrap);
        const w = Math.max(320, Math.min(880, stage.clientWidth - 56));
        const cv = await renderPage(pg, w);
        if (seq !== renderSeq) return;
        wrap.appendChild(cv);
      }
      return;
    }
    const pg = ST.pages[ST.idx];
    const wrap = document.createElement('div');
    wrap.className = 'rd-page-wrap';
    stage.appendChild(wrap);
    const availW = Math.max(280, stage.clientWidth - 96);
    const availH = Math.max(280, stage.clientHeight - 34);
    const s = Math.min(availW / pg.width, availH / pg.height);
    const cv = await renderPage(pg, pg.width * s);
    if (seq !== renderSeq) return;
    wrap.appendChild(cv);
    updatePager();
    saveProgress();
  }

  async function renderPage(page, cssW) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = cssW / page.width;
    const cv = document.createElement('canvas');
    cv.width = Math.round(page.width * scale * dpr);
    cv.height = Math.round(page.height * scale * dpr);
    cv.style.width = Math.round(page.width * scale) + 'px';
    cv.style.height = Math.round(page.height * scale) + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = page.bg_color || '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const cells = [...(page.cells || [])].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
    for (const c of cells) await drawCell(ctx, c, scale);
    return cv;
  }

  async function drawCell(ctx, c, scale) {
    const pts = normPoints(c.points);
    const img = c.current_image ? await loadImg(c.current_image) : null;
    const cx = (c.x + c.w / 2) * scale;
    const cy = (c.y + c.h / 2) * scale;
    ctx.save();
    ctx.globalAlpha = c.opacity ?? 1;
    ctx.translate(cx, cy);
    ctx.rotate((c.rotation || 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);

    const path = () => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const px = (c.x + p[0] * c.w) * scale;
        const py = (c.y + p[1] * c.h) * scale;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
    };

    path();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    if (img) {
      ctx.save();
      path();
      ctx.clip();
      const bw = c.w * scale, bh = c.h * scale;
      const base = c.fit === 'contain'
        ? Math.min(bw / img.width, bh / img.height)
        : Math.max(bw / img.width, bh / img.height);
      const s = base * (c.img_scale || 1);
      const dw = img.width * s, dh = img.height * s;
      const bx = c.x * scale + (bw - dw) / 2 + (c.img_offset_x || 0) / 100 * bw;
      const by = c.y * scale + (bh - dh) / 2 + (c.img_offset_y || 0) / 100 * bh;
      if (c.flip_h) {
        ctx.translate(bx + dw, by);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, dw, dh);
      } else {
        ctx.drawImage(img, bx, by, dw, dh);
      }
      ctx.restore();
    }

    if (c.border_style !== 'none' && (c.border_width ?? 3) > 0) {
      path();
      ctx.strokeStyle = c.border_color || '#111111';
      ctx.lineWidth = (c.border_width ?? 3) * scale;
      ctx.lineJoin = 'round';
      ctx.setLineDash(c.border_style === 'dashed' ? [7 * scale, 5 * scale]
        : (c.border_style === 'dotted' ? [2 * scale, 4 * scale] : []));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (Array.isArray(c.bubbles)) c.bubbles.forEach((b) => drawBubble(ctx, c, b, scale));
    ctx.restore();
  }

  function drawBubble(ctx, c, b, scale) {
    const bx = (c.x + (b.x ?? 10) / 100 * c.w) * scale;
    const by = (c.y + (b.y ?? 10) / 100 * c.h) * scale;
    const bw = (b.w ?? 40) / 100 * c.w * scale;
    const fs = (b.size || 13) * scale;
    ctx.save();
    ctx.font = `${fs}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'top';
    const pad = Math.max(3, fs * 0.4);
    const lines = [];
    let line = '';
    for (const ch of String(b.text || '')) {
      const t = line + ch;
      if (ctx.measureText(t).width > bw - pad * 2 && line) { lines.push(line); line = ch; }
      else line = t;
    }
    if (line) lines.push(line);
    const lh = fs * 1.4;
    const bh = b.h ? (b.h / 100 * c.h * scale) : (lines.length * lh + pad * 2);
    ctx.fillStyle = b.bg || '#ffffff';
    ctx.strokeStyle = b.border || '#111111';
    ctx.lineWidth = Math.max(1, (b.border_width ?? 2) * scale);
    if (b.type === 'narration') {
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
    } else {
      const r = Math.min(bw, bh) * 0.18;
      roundRect(ctx, bx, by, bw, bh, r);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = b.color || '#111111';
    lines.forEach((ln, i) => {
      const tw = ctx.measureText(ln).width;
      ctx.fillText(ln, bx + (bw - tw) / 2, by + pad + i * lh);
    });
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- 翻页 ---------------- */
  function goto(idx, silent) {
    if (ST.scroll) return;
    const n = ST.pages.length;
    const next = Math.max(0, Math.min(n - 1, idx));
    if (next === ST.idx && !silent) return;
    ST.idx = next;
    ST.pageId = ST.pages[next]?.id;
    render();
    renderToc();
  }

  function step(dir) {
    // dir: 1 = 往后读
    if (ST.scroll) {
      $('#rd-stage').scrollBy({ top: dir * (window.innerHeight * 0.82), behavior: 'smooth' });
      return;
    }
    goto(ST.idx + dir);
  }

  function updatePager() {
    $('#rd-idx').textContent = `${ST.idx + 1} / ${ST.pages.length}`;
    $('#rd-progress-fill').style.width = `${((ST.idx + 1) / ST.pages.length) * 100}%`;
    $('#rd-prev').style.opacity = ST.idx <= 0 ? .4 : 1;
    $('#rd-next').style.opacity = ST.idx >= ST.pages.length - 1 ? .4 : 1;
    const left = $('#rd-nav-left'), right = $('#rd-nav-right');
    // 右→左阅读时：左侧是「下一页」
    left.textContent = ST.rtl ? '‹' : '›';
    right.textContent = ST.rtl ? '›' : '‹';
  }

  function saveProgress() {
    try {
      localStorage.setItem('comic_progress_' + ST.project.project.id, String(ST.idx));
    } catch (_) {}
  }

  /* ---------------- 目录 ---------------- */
  function renderToc() {
    const list = $('#rd-toc-list');
    $('#rd-toc-head').textContent = `目录 · ${ST.pages.length} 页`;
    list.innerHTML = ST.pages.map((p, i) => `
      <div class="item ${i === ST.idx ? 'on' : ''}" data-i="${i}">
        <div class="thumb"><canvas width="30" height="40" data-toc="${i}"></canvas></div>
        <span class="n">${esc(p.title || '第 ' + (i + 1) + ' 页')}</span>
        <span class="c">${(p.cells || []).length} 格</span>
      </div>`).join('');
    list.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
      goto(Number(el.dataset.i));
      if (ST.scroll) {
        const wrap = $('#rd-stage').children[Number(el.dataset.i)];
        wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }));

    // 缩略图：只画格子轮廓 + 已有的图
    ST.pages.forEach((p, i) => {
      const cv = list.querySelector(`[data-toc="${i}"]`);
      if (cv) paintTocThumb(cv, p);
    });
  }

  function paintTocThumb(cv, page) {
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const sx = w / page.width, sy = h / page.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    (page.cells || []).forEach((c) => {
      const pts = normPoints(c.points);
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const px = (c.x + pt[0] * c.w) * sx, py = (c.y + pt[1] * c.h) * sy;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = c.current_image ? '#d8dde6' : '#eff1f5';
      ctx.fill();
      ctx.strokeStyle = '#a6adba';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  }

  /* ---------------- 事件 ---------------- */
  function showHint(msg) {
    const h = $('#rd-hint');
    h.textContent = msg;
    h.classList.add('on');
    clearTimeout(showHint._t);
    showHint._t = setTimeout(() => h.classList.remove('on'), 2200);
  }

  function onKey(e) {
    if ($('#reader').classList.contains('on') === false) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(ST.rtl ? -1 : 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(ST.rtl ? 1 : -1); }
    else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') { backToShelf(); }
    else if (e.key === 'f' || e.key === 'F') { toggleFull(); }
    else if (e.key === 't' || e.key === 'T') { toggleToc(); }
  }

  function onResize() {
    clearTimeout(onResize._t);
    onResize._t = setTimeout(() => { if (ST.project) render(); }, 220);
  }

  function backToShelf() {
    $('#reader').classList.remove('on');
    $('#shelf').style.display = '';
    loadShelf();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
  }

  function toggleToc() {
    ST.tocOpen = !ST.tocOpen;
    $('#rd-toc').classList.toggle('on', ST.tocOpen);
    $('#rd-toc-btn').classList.toggle('on', ST.tocOpen);
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function downloadPage() {
    const cv = $('#rd-stage').querySelector('canvas');
    if (!cv) return;
    const a = document.createElement('a');
    a.download = `${ST.project.project.title}_${ST.idx + 1}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  /* ---------------- 启动 ---------------- */
  function bind() {
    $('#rd-back').addEventListener('click', backToShelf);
    $('#rd-book').addEventListener('change', (e) => selectBook(Number(e.target.value), true));
    $('#rd-prev').addEventListener('click', () => step(-1));
    $('#rd-next').addEventListener('click', () => step(1));
    $('#rd-nav-left').addEventListener('click', () => step(ST.rtl ? 1 : -1));
    $('#rd-nav-right').addEventListener('click', () => step(ST.rtl ? -1 : 1));
    $('#rd-toc-btn').addEventListener('click', toggleToc);
    $('#rd-full').addEventListener('click', toggleFull);
    $('#rd-save').addEventListener('click', downloadPage);
    $('#rd-mode').addEventListener('click', () => {
      ST.scroll = !ST.scroll;
      $('#rd-mode').textContent = ST.scroll ? '滚动模式' : '翻页模式';
      $('#rd-mode').classList.toggle('on', ST.scroll);
      render();
    });
    $('#rd-progress').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const p = (e.clientX - r.left) / r.width;
      goto(Math.round(p * (ST.pages.length - 1)));
    });
    $('#rd-stage').addEventListener('scroll', () => {
      if (!ST.scroll) return;
      const stage = $('#rd-stage');
      const wrappers = [...stage.querySelectorAll('.rd-page-wrap')];
      let cur = 0;
      wrappers.forEach((w, i) => {
        if (w.offsetTop - stage.scrollTop < stage.clientHeight * 0.4) cur = i;
      });
      if (cur !== ST.idx) {
        ST.idx = cur;
        renderToc();
      }
      const total = stage.scrollHeight - stage.clientHeight;
      $('#rd-progress-fill').style.width = total > 0 ? (stage.scrollTop / total * 100) + '%' : '0%';
      $('#rd-idx').textContent = `${cur + 1} / ${ST.pages.length}`;
    }, { passive: true });
    // 页面模式下点击空白也翻页（点图以外区域）
    $('#rd-stage').addEventListener('click', (e) => {
      if (ST.scroll) return;
      if (e.target.closest('.rd-page-wrap')) return;
      if (e.target.closest('.rd-nav')) return;
      step(1);
    });
  }

  bind();
  loadShelf();

  window.ComicReader = { openProject, state: ST };
})();
