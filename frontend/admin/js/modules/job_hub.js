// ========== 顶栏任务图标 + 任务中心抽屉 ==========
// 参考「windows轻量AI桌面助手」的任务面板，改造成后台里的形态：
//   · 顶栏「打开游戏」左边一个圆形任务图标，有任务在跑时四周一圈金色圆弧不停旋转
//     （暂停了 → 圆弧变琥珀色并停住，这样一眼能分清「在跑」和「停了」）
//   · 点图标从右侧滑出任务抽屉，列出所有 ComfyUI 任务
//   · 每条任务可 暂停 / 继续 / 取消 / 删除，还能定位到它所在的页面
//   · 顶部有 全部开始 / 全部暂停 / 清空已完成
//
// 数据来源：JobMonitor 已经在轮询 /api/jobs，这里只订阅它的 'jobs:update' 事件，
// 绝不自己再开一个定时器（否则两个轮询打架、进度跳来跳去）。
(function () {
  if (window.JobHub) return;

  const KIND_LABEL = {
    pose_batch: '动作表情',
    appearance_render: '立绘生成',
  };
  const STATUS_LABEL = {
    running: '进行中',
    queued: '等待中',
    paused: '已暂停',
    done: '已完成',
    partial: '部分成功',
    error: '失败',
    canceled: '已取消',
  };
  const LIVE = ['running', 'queued'];

  const S = {
    open: false,
    filterStatus: 'all',
    filterKind: 'all',
    sort: 'queue',        // queue / old / status
    drawer: null,
    scroll: 0,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function jobsOf() {
    return (window.JobMonitor && JobMonitor.jobs()) || [];
  }

  function counts() {
    const c = { running: 0, paused: 0, queued: 0, done: 0, error: 0 };
    jobsOf().forEach((j) => { c[j.status] = (c[j.status] || 0) + 1; });
    return c;
  }

  function elapsed(j) {
    if (!j.started_at) return 0;
    const t0 = new Date(j.started_at.replace(/-/g, '/')).getTime();
    const end = j.finished_at ? new Date(j.finished_at.replace(/-/g, '/')).getTime() : Date.now();
    return Math.max(0, Math.round((end - t0) / 1000));
  }

  function dur(sec) {
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    return m + ' 分 ' + (sec % 60) + ' 秒';
  }

  function canLocate(j) {
    return !!(j.page && (j.focus && Object.keys(j.focus).length));
  }

  // ---------------- 顶栏图标 ----------------
  function mountIcon() {
    const topbar = document.querySelector('.topbar');
    if (!topbar || document.getElementById('task-hub')) return;
    const btn = document.createElement('button');
    btn.id = 'task-hub';
    btn.className = 'task-hub';
    btn.title = '任务中心';
    btn.innerHTML = `
      <span class="th-ring"></span>
      <svg class="th-ico" viewBox="0 0 24 24" width="17" height="17" fill="none"
           stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7h16M4 12h10M4 17h7"/>
        <circle cx="17.5" cy="16.5" r="3.2"/>
        <path d="M17.5 15v1.6l1.1.7"/>
      </svg>
      <span class="th-badge" hidden>0</span>`;
    // 插在「打开游戏」前面
    const game = topbar.querySelector('a.btn');
    if (game) topbar.insertBefore(btn, game);
    else topbar.appendChild(btn);
    btn.addEventListener('click', () => toggle());

    // 最新图片：和任务中心同一排，点开从右往左滑出最近生成的图
    const img = document.createElement('button');
    img.id = 'image-hub';
    img.className = 'task-hub';
    img.title = '最新图片';
    img.innerHTML = `
      <svg class="th-ico" viewBox="0 0 24 24" width="17" height="17" fill="none"
           stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2.5"/>
        <circle cx="8.6" cy="10" r="1.6"/>
        <path d="M4 17l4.5-4.2L12 16l3.2-2.6L20 17"/>
      </svg>`;
    if (game) topbar.insertBefore(img, game);
    else topbar.appendChild(img);
    img.addEventListener('click', () => toggleImages());
  }

  function paintIcon() {
    const btn = document.getElementById('task-hub');
    if (!btn) return;
    const c = counts();
    const running = c.running || 0;
    const paused = c.paused || 0;
    const queued = c.queued || 0;
    btn.classList.toggle('run', running > 0);
    btn.classList.toggle('paused', running === 0 && paused > 0);
    const badge = btn.querySelector('.th-badge');
    const n = running + queued + paused;
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.classList.toggle('amber', running === 0);
    } else {
      badge.hidden = true;
    }
    btn.title = n
      ? `任务中心：${running} 运行中${paused ? ' · ' + paused + ' 暂停' : ''}${queued ? ' · ' + queued + ' 等待' : ''}`
      : '任务中心';
  }

  // ---------------- 抽屉 ----------------
  function ensureDrawer() {
    if (S.drawer && S.drawer.isConnected) return S.drawer;
    const d = document.createElement('div');
    d.id = 'task-drawer';
    d.className = 'td-wrap';
    d.innerHTML = `
      <div class="td-head">
        <div class="td-title">任务中心<span class="td-stat"></span></div>
        <div class="td-head-btns">
          <button class="td-hbtn" data-act="resume-all" title="开始全部">▶ 全部开始</button>
          <button class="td-hbtn" data-act="pause-all" title="暂停全部">⏸ 全部暂停</button>
          <button class="td-hbtn" data-act="clear" title="清空已结束的任务">清空已完成</button>
          <button class="td-hbtn td-close" data-act="close" title="关闭">✕</button>
        </div>
      </div>
      <div class="td-filters">
        <select class="td-sel" data-f="status">
          <option value="all">全部状态</option>
          <option value="live">运行 / 等待</option>
          <option value="running">进行中</option>
          <option value="paused">已暂停</option>
          <option value="done">已完成</option>
          <option value="error">失败</option>
          <option value="canceled">已取消</option>
        </select>
        <select class="td-sel" data-f="kind"><option value="all">全部来源</option></select>
        <select class="td-sel" data-f="sort">
          <option value="queue">最新在前</option>
          <option value="old">最早在前</option>
          <option value="status">按状态</option>
        </select>
      </div>
      <div class="td-list"></div>`;
    document.body.appendChild(d);
    S.drawer = d;

    d.querySelector('[data-act="close"]').addEventListener('click', () => toggle(false));
    d.querySelector('[data-act="clear"]').addEventListener('click', async () => {
      try { await Admin.post('/jobs/clear', {}); } catch (_) { /* 忽略 */ }
      refresh();
    });
    d.querySelector('[data-act="pause-all"]').addEventListener('click', async () => {
      try {
        const r = await Admin.post('/jobs/pause-all', {});
        Admin.toast(r.n ? `已暂停 ${r.n} 个任务` : '没有可暂停的任务', r.n ? 'success' : 'error');
      } catch (e) { Admin.toast('暂停失败：' + e.message, 'error'); }
      refresh();
    });
    d.querySelector('[data-act="resume-all"]').addEventListener('click', async () => {
      try {
        const r = await Admin.post('/jobs/resume-all', {});
        Admin.toast(r.n ? `已继续 ${r.n} 个任务` : '没有暂停中的任务', r.n ? 'success' : 'error');
      } catch (e) { Admin.toast('继续失败：' + e.message, 'error'); }
      refresh();
    });

    d.querySelectorAll('.td-sel').forEach((sel) => {
      sel.addEventListener('change', () => {
        S['filter' + sel.dataset.f[0].toUpperCase() + sel.dataset.f.slice(1)] = sel.value;
        render();
      });
    });
    return d;
  }

  function filtered() {
    let list = jobsOf().slice();
    const st = S.filterStatus;
    const kd = S.filterKind;
    if (st === 'live') list = list.filter((j) => ['running', 'queued', 'paused'].includes(j.status));
    else if (st !== 'all') list = list.filter((j) => j.status === st);
    if (kd !== 'all') list = list.filter((j) => j.kind === kd);
    if (S.sort === 'old') {
      list.sort((a, b) => new Date(a.started_at.replace(/-/g, '/')) - new Date(b.started_at.replace(/-/g, '/')));
    } else if (S.sort === 'status') {
      const w = { running: 0, queued: 1, paused: 2, error: 3, partial: 4, done: 5, canceled: 6 };
      list.sort((a, b) => (w[a.status] ?? 9) - (w[b.status] ?? 9));
    }
    return list;
  }

  function rowHtml(j) {
    const live = LIVE.includes(j.status);
    const paused = j.status === 'paused';
    const done = j.done + j.failed;
    const pct = j.total ? Math.min(100, Math.round(done / j.total * 100)) : 0;
    const sec = elapsed(j);
    const bits = [];
    if (j.total > 1 || done) bits.push(`${done}/${j.total}`);
    if (sec > 0.5) bits.push(dur(sec));
    if (paused) bits.push('已暂停');
    if (j.status === 'canceled') bits.push('已取消');
    if (j.canceling && j.status === 'running') bits.push('取消中…');

    const acts = [];
    if (j.status === 'running' || j.status === 'queued') {
      acts.push(`<button class="td-act" data-a="pause" data-id="${esc(j.id)}" title="暂停（当前这张会中断，继续后重跑）">⏸</button>`);
    }
    if (paused) {
      acts.push(`<button class="td-act go" data-a="resume" data-id="${esc(j.id)}" title="继续">▶</button>`);
    }
    if (live || paused) {
      acts.push(`<button class="td-act danger" data-a="cancel" data-id="${esc(j.id)}" title="取消这个任务">✕</button>`);
    }
    if (canLocate(j)) {
      acts.push(`<button class="td-act" data-a="locate" data-id="${esc(j.id)}" title="跳到它所在的页面">↗</button>`);
    }
    if ((j.images || []).length) {
      acts.push(`<button class="td-act" data-a="view" data-id="${esc(j.id)}" title="看已出的图">🖼</button>`);
    }
    if (!live && !paused) {
      acts.push(`<button class="td-act danger" data-a="remove" data-id="${esc(j.id)}" title="从列表删除这条记录">🗑</button>`);
    }

    return `<div class="td-row ${esc(j.status)}" data-id="${esc(j.id)}">
      <div class="td-dot"></div>
      <div class="td-main">
        <div class="td-line">
          <span class="td-kind">${esc(KIND_LABEL[j.kind] || j.kind)}</span>
          <span class="td-name" title="${esc(j.title)}">${esc(j.title)}</span>
        </div>
        <div class="td-meta">
          <span class="td-sub" title="${esc(j.message || '')}">${esc(j.message || STATUS_LABEL[j.status] || '')}</span>
          <span class="td-info">${esc(bits.join(' · '))}</span>
        </div>
        ${live || paused ? `<div class="td-bar"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="td-acts">${acts.join('')}</div>
    </div>`;
  }

  function render() {
    const d = ensureDrawer();
    const list = filtered();
    const c = counts();

    // 来源下拉：按当前已有任务动态生成，别写死
    const kindSel = d.querySelector('[data-f="kind"]');
    const kinds = [...new Set(jobsOf().map((j) => j.kind))];
    const want = ['all', ...kinds].join('|');
    if (kindSel.dataset.kinds !== want) {
      kindSel.dataset.kinds = want;
      kindSel.innerHTML = '<option value="all">全部来源</option>' +
        kinds.map((k) => `<option value="${esc(k)}">${esc(KIND_LABEL[k] || k)}</option>`).join('');
      kindSel.value = S.filterKind;
    }
    d.querySelector('[data-f="status"]').value = S.filterStatus;
    d.querySelector('[data-f="sort"]').value = S.sort;

    const live = (c.running || 0) + (c.queued || 0);
    d.querySelector('.td-stat').textContent =
      `　运行 ${c.running || 0} · 暂停 ${c.paused || 0} · 完成 ${c.done || 0}` +
      ((c.error || 0) ? ` · 失败 ${c.error}` : '');

    const box = d.querySelector('.td-list');
    S.scroll = box.scrollTop;
    box.innerHTML = list.length
      ? list.map(rowHtml).join('')
      : `<div class="td-empty">${jobsOf().length ? '当前筛选下没有任务' : '还没有任务。到「人物管理 → 动作表情」或「外观拼装」出图，任务会出现在这里。'}</div>`;
    box.scrollTop = S.scroll;

    // 行内按钮
    box.querySelectorAll('.td-act').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        act(b.dataset.a, b.dataset.id);
      });
    });
    // 点行本身 = 跳到它的页面（能定位的话）
    box.querySelectorAll('.td-row').forEach((r) => {
      r.addEventListener('click', () => {
        const j = jobsOf().find((x) => x.id === r.dataset.id);
        if (j && canLocate(j)) PageFocus.run(j);
      });
    });
    d.querySelector('.td-head-btns [data-act="pause-all"]').disabled = live === 0;
    d.querySelector('.td-head-btns [data-act="resume-all"]').disabled = !(c.paused || 0);
    paintIcon();
  }

  async function act(a, id) {
    const j = jobsOf().find((x) => x.id === id);
    if (a === 'locate') { if (j) { toggle(false); PageFocus.run(j); } return; }
    if (a === 'view') {
      if (!j || !(j.images || []).length) return;
      const items = j.images.map((u) => {
        const r = (j.results || []).find((x) => x.image === u) || {};
        return {
          url: u, title: r.pose_name || j.title, prompt: r.prompt || '',
          width: r.width, height: r.height,
          meta: { 任务: j.title, 动作: r.pose_name || '', 状态: STATUS_LABEL[j.status] || j.status },
        };
      });
      window.ImagePreview.open(items, 0);
      return;
    }
    const map = {
      pause: ['/jobs/' + id + '/pause', '已暂停'],
      resume: ['/jobs/' + id + '/resume', '已继续'],
      cancel: ['/jobs/' + id + '/cancel', '已请求取消'],
    };
    try {
      if (a === 'remove') {
        await Admin.del('/jobs/' + id);
        Admin.toast('已删除记录', 'success');
      } else if (map[a]) {
        await Admin.post(map[a][0], {});
        Admin.toast(map[a][1], 'success');
      }
    } catch (e) {
      Admin.toast('操作失败：' + e.message, 'error');
    }
    refresh();
  }

  function refresh() {
    if (window.JobMonitor) JobMonitor.refresh();
  }

  function toggle(force) {
    const want = force === undefined ? !S.open : !!force;
    const d = ensureDrawer();
    S.open = want;
    d.classList.toggle('on', want);
    document.body.classList.toggle('task-drawer-open', want);
    const btn = document.getElementById('task-hub');
    if (btn) btn.classList.toggle('active', want);
    if (want) { render(); refresh(); }
  }

  // ==================== 最新图片抽屉 ====================
  // 和任务中心同一套交互：顶栏图标 → 从右往左滑出面板 → 点缩略图用图片浏览控件打开整组。
  const IMG = {
    open: false,
    origin: 'ai',        // ai / upload / ''（全部）
    items: [],
    loading: false,
    drawer: null,
  };

  function imgDrawer() {
    if (IMG.drawer && IMG.drawer.isConnected) return IMG.drawer;
    const d = document.createElement('div');
    d.id = 'image-drawer';
    d.className = 'td-wrap id-wrap';
    d.innerHTML = `
      <div class="td-head">
        <div class="td-title">最新图片<span class="td-stat" id="id-stat"></span></div>
        <div class="td-head-btns">
          <select class="td-sel" id="id-origin" style="height:27px">
            <option value="ai">只看 AI 生成</option>
            <option value="upload">只看上传</option>
            <option value="">全部</option>
          </select>
          <button class="td-hbtn" data-act="reload" title="重新拉取">⟳ 刷新</button>
          <button class="td-hbtn td-close" data-act="close" title="关闭">✕</button>
        </div>
      </div>
      <div class="id-list"></div>`;
    document.body.appendChild(d);
    IMG.drawer = d;

    d.querySelector('[data-act="close"]').addEventListener('click', () => toggleImages(false));
    d.querySelector('[data-act="reload"]').addEventListener('click', () => loadImages(true));
    d.querySelector('#id-origin').addEventListener('change', (e) => {
      IMG.origin = e.target.value;
      loadImages(true);
    });
    return d;
  }

  async function loadImages(force) {
    const d = imgDrawer();
    const box = d.querySelector('.id-list');
    if (IMG.loading) return;
    IMG.loading = true;
    if (force || !IMG.items.length) box.innerHTML = '<div class="td-empty">加载中…</div>';
    try {
      const q = IMG.origin ? `&origin=${encodeURIComponent(IMG.origin)}` : '';
      const r = await Admin.get(`/assets?sort=new&limit=120${q}`);
      IMG.items = r.items || [];
    } catch (e) {
      box.innerHTML = `<div class="td-empty">拉取失败：${esc(e.message)}</div>`;
      IMG.loading = false;
      return;
    }
    IMG.loading = false;
    renderImages();
  }

  function prettyTime(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(v || '');
  }

  function imgItems() {
    return IMG.items.map((a) => ({
      url: a.url,
      title: a.subject_name ? `${a.subject_name} · ${a.variant_name || a.kind_label}` : (a.variant_name || a.kind_label || '图片'),
      prompt: a.prompt || '',
      width: a.width, height: a.height,
      meta: {
        '类型': a.kind_label || '',
        '来源': a.origin_label || '',
        '主体': a.subject_name || '',
        '动作/变体': a.variant_name || '',
        '尺寸': a.width && a.height ? `${a.width}×${a.height}` : '',
        '模型方案': a.model_preset || '',
        '时间': prettyTime(a.created_at),
      },
    }));
  }

  function renderImages() {
    const d = imgDrawer();
    const box = d.querySelector('.id-list');
    d.querySelector('#id-stat').textContent = `　共 ${IMG.items.length} 张`;
    const sel = d.querySelector('#id-origin');
    if (sel) sel.value = IMG.origin;
    if (!IMG.items.length) {
      box.innerHTML = '<div class="td-empty">还没有图片。出图后最近的图会出现在这里。</div>';
      return;
    }
    box.innerHTML = IMG.items.map((a, i) => `
      <div class="id-card" data-i="${i}" title="点击查看大图">
        <img src="${esc(a.url)}" loading="lazy" alt="">
        <div class="id-meta">
          <span class="id-nm">${esc(a.subject_name || a.variant_name || a.filename || '')}</span>
          <span class="id-px">${a.width && a.height ? a.width + '×' + a.height : ''}</span>
        </div>
        <div class="id-sub">${esc(a.kind_label || '')}${a.variant_name ? ' · ' + esc(a.variant_name) : ''} · ${esc(prettyTime(a.created_at))}</div>
      </div>`).join('');
    box.querySelectorAll('.id-card').forEach((c) => {
      c.addEventListener('click', () => {
        if (!window.ImagePreview) return;
        ImagePreview.open(imgItems(), Number(c.dataset.i) || 0);
      });
    });
  }

  function toggleImages(force) {
    const want = force === undefined ? !IMG.open : !!force;
    const d = imgDrawer();
    IMG.open = want;
    d.classList.toggle('on', want);
    document.body.classList.toggle('image-drawer-open', want);
    const btn = document.getElementById('image-hub');
    if (btn) btn.classList.toggle('active', want);
    if (want) loadImages(false);
  }

  // 新图出完自动刷新一下「最新图片」的红点提示（只更新数量，不打断当前滚动）
  function paintImageIcon() {
    const btn = document.getElementById('image-hub');
    if (!btn) return;
    btn.title = IMG.items.length ? `最新图片：${IMG.items.length} 张` : '最新图片';
    if (IMG.open) renderImages();
  }

  function boot() {
    if (document.getElementById('task-hub')) return;
    mountIcon();
    paintIcon();
    // 只订阅，不另开轮询
    document.addEventListener('jobs:update', () => {
      paintIcon();
      if (S.open) render();
    });
    // 任务刚跑完 → 说明有新图了，最新图片面板顺手刷新
    document.addEventListener('job:finished', () => {
      if (IMG.open || IMG.items.length) loadImages(true);
      else paintImageIcon();
    });
    // Esc 关闭抽屉
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.open) toggle(false);
      if (e.key === 'Escape' && IMG.open) toggleImages(false);
    });
  }

  window.JobHub = {
    boot, toggle, open: () => toggle(true), refresh,
    toggleImages, openImages: () => toggleImages(true),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
