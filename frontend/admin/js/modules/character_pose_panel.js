// ========== 人物「动作表情」面板 ==========
// 用途：给某个角色按动作批量出图（同一穿着、不同动作），并按分类浏览/删除已出图。
// 供 人物管理 → 动作表情 选项卡使用。
//
// 关键改动（本次）：
//   · 尺寸 / 模型方案 / 步数 等参数不再写死，改成挂载「全局出图参数」面板（GenParams），
//     与其它出图入口共用同一份服务端配置
//   · 出图改成任务制：请求立刻返回 job_id，每出一张画廊就多一张，不用关掉重开
//   · 缩略图点开是大图预览，能看到尺寸、提示词、种子、时间
(function () {
  if (window.CharacterPosePanel) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureStyle() {
    if (document.getElementById('cpp-style-tag')) return;
    const s = document.createElement('style');
    s.id = 'cpp-style-tag';
    s.textContent = `
      .cpp-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;
        background:var(--bg-input);border:1px solid var(--border);border-radius:6px;padding:9px 11px;margin-bottom:8px}
      .cpp-field{display:flex;flex-direction:column;gap:3px}
      .cpp-field>span{font-size:12px;color:var(--text-muted)}
      .cpp-sel,.cpp-inp{background:var(--bg-card,#1a1a1a);border:1px solid var(--border);border-radius:4px;
        color:var(--text-primary);font-size:13px;padding:0 6px;height:30px;box-sizing:border-box}
      .cpp-inp{width:64px;text-align:center}
      .cpp-btn{font-size:12px;padding:6px 13px;border-radius:4px;border:1px solid var(--border);
        background:transparent;color:var(--text-primary);cursor:pointer;white-space:nowrap;height:30px}
      .cpp-btn:hover{border-color:var(--gold);color:var(--gold)}
      .cpp-btn.primary{background:var(--gold);border-color:var(--gold);color:#000;font-weight:600}
      .cpp-btn:disabled{opacity:.45;cursor:not-allowed}
      .cpp-cats{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 8px}
      .cpp-cat{font-size:14px;padding:6px 15px;border-radius:15px;border:1px solid #3a3e50;
        color:#cfd3e6;cursor:pointer;user-select:none;background:rgba(255,255,255,.055);
        transition:all .15s ease;letter-spacing:.3px}
      .cpp-cat:hover{border-color:var(--gold);color:var(--gold);background:rgba(201,168,76,.1)}
      .cpp-cat.on{border-color:var(--gold);color:#171410;background:var(--gold);font-weight:700;
        box-shadow:0 0 0 1px rgba(201,168,76,.35), 0 3px 12px rgba(201,168,76,.18)}
      .cpp-cat .c{opacity:.85;font-size:11.5px;margin-left:5px}
      .cpp-poses{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:5px;
        max-height:262px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--bg-input)}
      .cpp-pose{display:flex;align-items:center;gap:5px;font-size:13.5px;padding:6px 8px;border-radius:4px;
        cursor:pointer;border:1px solid transparent;color:var(--text-primary);min-width:0}
      .cpp-pose:hover{background:rgba(255,255,255,.06)}
      .cpp-pose.sel{border-color:var(--gold);background:rgba(201,168,76,.14)}
      .cpp-pose.has::after{content:'●';color:var(--gold);font-size:10px;margin-left:auto}
      .cpp-pose span.t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cpp-pose .tag{font-size:10px;color:var(--text-muted);border:1px solid var(--border);
        border-radius:3px;padding:0 4px;margin-left:auto;flex:0 0 auto}
      .cpp-bar{display:flex;gap:8px;align-items:center;margin:12px 0 8px;font-size:13px;color:var(--text-muted)}
      .cpp-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(138px,1fr));gap:10px}
      .cpp-card{border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-input);position:relative}
      .cpp-card img{width:100%;display:block;aspect-ratio:2/3;object-fit:contain;background:
        repeating-conic-gradient(#232327 0% 25%, #1a1a1e 0% 50%) 50%/14px 14px}
      .cpp-card .m{display:flex;justify-content:space-between;align-items:center;padding:5px 7px 2px;
        font-size:12.5px;color:var(--text-primary);gap:7px}
      .cpp-card .m .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cpp-card .px{font-size:11.5px;color:var(--gold);opacity:.9;flex:0 0 auto;font-variant-numeric:tabular-nums}
      .cpp-card .cfgm{font-size:11px;color:var(--text-muted);padding:0 7px 5px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cpp-card .x{cursor:pointer;color:var(--text-muted);flex:0 0 auto}
      .cpp-card .x:hover{color:var(--red)}
      .cpp-card{cursor:pointer;user-select:none}
      .cpp-card.sel{outline:2px solid var(--gold);outline-offset:-2px;
        box-shadow:0 0 0 2px rgba(201,168,76,.35),0 4px 16px rgba(201,168,76,.16)}
      .cpp-frame-view{display:flex;align-items:center;justify-content:center;height:30px;min-width:56px;
        padding:0 9px;font-size:13px;color:var(--text-primary);box-sizing:border-box;
        border:1px dashed var(--border);border-radius:4px;background:var(--bg-card,#1a1a1a)}
      .cpp-menu{position:fixed;z-index:99999;background:var(--bg-card,#1e1e1e);
        border:1px solid var(--border);border-radius:6px;padding:4px;
        box-shadow:0 8px 28px rgba(0,0,0,.5);min-width:184px}
      .cpp-menu button{display:block;width:100%;text-align:left;background:none;border:none;
        color:var(--text-primary);font-size:13px;padding:7px 10px;border-radius:4px;cursor:pointer;
        white-space:nowrap;font-family:inherit}
      .cpp-menu button:hover{background:rgba(201,168,76,.16);color:var(--gold)}
      .cpp-empty{font-size:12.5px;color:var(--text-muted);padding:16px;text-align:center;
        border:1px dashed var(--border);border-radius:6px}
      .cpp-progress{font-size:12px;color:var(--gold)}
      .cpp-note{font-size:11px;color:var(--text-muted);line-height:1.6;margin-top:8px}
    `;
    document.head.appendChild(s);
  }

  async function mount(host, charId, opts = {}) {
    ensureStyle();
    let lib = { categories: [], poses: [] };
    let images = [];
    let covered = {};
    let activeCat = '';
    let appearances = [];
    let activeAppearance = '';
    let pollTimer = null;
    let lastSeenCount = -1;
    const selected = new Set();
    const gallerySel = new Set();   // 图片列表的多选集合（存图片记录 id）

    host.innerHTML = `
      <div class="cpp-toolbar" id="cpp-gen-params">
        <span style="font-size:12px;color:var(--text-muted)">加载出图参数…</span>
      </div>
      <div class="cpp-toolbar" style="border-top:none;margin-top:-8px;border-radius:0 0 6px 6px">
        <label class="cpp-field"><span>外观配置</span>
          <select class="cpp-sel" id="cpp-appearance" style="min-width:150px"></select>
        </label>
        <label class="cpp-field"><span>立绘取景</span>
          <span class="cpp-frame-view" id="cpp-framing-view"
                title="取景已内置到外观配置，切换外观配置后自动识别，不可单独选择">全身</span>
        </label>
        <button class="cpp-btn primary" id="cpp-gen">生成选中动作</button>
        <button class="cpp-btn" id="cpp-gen-rand">按分类随机生成</button>
        <button class="cpp-btn" id="cpp-clear">清空选择</button>
        <span class="cpp-progress" id="cpp-progress"></span>
        <span style="margin-left:auto;font-size:12px;color:var(--text-muted)" id="cpp-stat"></span>
      </div>
      <div class="cpp-cats" id="cpp-cats"></div>
      <div class="cpp-poses" id="cpp-poses"></div>
      <div class="cpp-bar">
        <span>已出图</span>
        <span id="cpp-cover"></span>
        <span id="cpp-selcount" style="color:var(--gold)"></span>
        <span style="margin-left:auto">当前筛选 <b id="cpp-total">0</b> 张（单击选中 · Shift 多选 · 双击看大图 · 右键操作）</span>
      </div>
      <div class="cpp-gallery" id="cpp-gallery"></div>
      <div class="cpp-note">同一套外观 + 逐条替换动作 → 穿着一致、动作不同。切换「外观配置」可以给每个人物的每套衣服分别出一组动作表情；
        切换上方分类，下面的图也会跟着筛。出图在后台跑，切到别的栏目也能在顶栏任务图标看到进度。</div>
    `;

    const $ = (sel) => host.querySelector(sel && sel[0] === '#' ? sel : '#' + sel);

    // ---- 全局出图参数面板 ----
    let gpInst = null;
    if (window.GenParams) {
      try {
        gpInst = await GenParams.init($('#cpp-gen-params'), { scope: 'characters' });
      } catch (e) {
        $('#cpp-gen-params').innerHTML =
          `<span style="font-size:12px;color:var(--red)">出图参数加载失败：${esc(e.message)}</span>`;
      }
    }

    async function loadLib() {
      lib = await Admin.get('/poses/library');
      renderCats();
      renderPoses();
    }

    async function loadAppearances() {
      try {
        const r = await Admin.get(`/characters/${charId}/appearances`);
        appearances = r.items || [];
      } catch (_) { appearances = []; }
      const sel = $('#cpp-appearance');
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = `<option value="">全部配置</option>` + appearances.map(a =>
        `<option value="${a.id}">${esc(a.name)}${a.is_default ? ' ★' : ''}</option>`).join('');
      sel.value = appearances.some(a => String(a.id) === cur) ? cur : '';
      activeAppearance = sel.value;
      refreshFramingView();
    }

    // 取景只读：跟随所选外观配置自带的 framing 自动显示
    function refreshFramingView() {
      const el = $('#cpp-framing-view');
      if (!el) return;
      if (!activeAppearance) { el.textContent = '随配置'; return; }
      const a = appearances.find(x => String(x.id) === String(activeAppearance));
      el.textContent = (a && a.framing === 'half') ? '半身' : '全身';
    }

    function filteredImages() {
      return images.filter(im => {
        if (activeAppearance && String(im.appearance_id || '') !== String(activeAppearance)) return false;
        if (activeCat && (im.category || '') !== activeCat) return false;
        return true;
      });
    }

    async function loadImages() {
      if (!charId) return;
      const r = await Admin.get(`/characters/${charId}/poses`);
      images = r.images || [];
      covered = r.covered || {};
      renderCats();
      renderGallery();
      renderPoses();
      const list = filteredImages();
      const covSet = new Set(list.map(i => i.pose_id).filter(Boolean));
      const catCount = visiblePoses().length;
      const cov = Math.min(covSet.size, catCount);
      $('#cpp-total').textContent = list.length;
      $('#cpp-stat').textContent = `动作库 ${catCount} 条 · 已覆盖 ${cov} 个动作`;
      $('#cpp-cover').textContent = catCount ? `${Math.round(cov / catCount * 100)}%` : '—';
    }

    function visiblePoses() {
      const all = lib.poses || [];
      // 没开成人维度时不显示「成人互动」分类下的动作
      if (opts.includeSensitive) return all;
      return all.filter(p => p.cat !== 'adult');
    }

    function renderCats() {
      const pool = visiblePoses();
      let cats = (lib.categories || []);
      if (!opts.includeSensitive) cats = cats.filter(c => c.id !== 'adult');
      const imgCount = (cat) => images.filter(im => {
        if (activeAppearance && String(im.appearance_id || '') !== String(activeAppearance)) return false;
        return cat ? (im.category || '') === cat : true;
      }).length;
      cats = [{ id: '', name: '全部', count: imgCount('') }].concat(
        cats.map(c => ({ ...c, count: imgCount(c.id) })));
      $('#cpp-cats').innerHTML = cats.map(c =>
        `<span class="cpp-cat${activeCat === c.id ? ' on' : ''}" data-cat="${esc(c.id)}"
          title="${c.id ? '该分类已出 ' + c.count + ' 张图' : '全部已出 ' + c.count + ' 张图'}">${esc(c.name)}<span class="c">${c.count}</span></span>`
      ).join('');
      host.querySelectorAll('.cpp-cat').forEach(el => {
        el.addEventListener('click', () => {
          activeCat = el.dataset.cat;
          renderCats();
          renderPoses();
          // 分类同时过滤下面的出图结果：点了「战斗」就只看战斗动作的图
          renderGallery();
          const list = filteredImages();
          const covSet = new Set(list.map(i => i.pose_id).filter(Boolean));
          const catCount = visiblePoses().filter(p => !activeCat || p.cat === activeCat).length;
          $('#cpp-total').textContent = list.length;
          $('#cpp-cover').textContent = catCount ? `${Math.round(Math.min(covSet.size, catCount) / catCount * 100)}%` : '—';
        });
      });
    }

    function currentPoses() {
      return visiblePoses().filter(p => !activeCat || p.cat === activeCat);
    }

    function renderPoses() {
      const list = currentPoses();
      const hasImage = (poseId) => images.some(im => im.pose_id === poseId &&
        (!activeAppearance || String(im.appearance_id || '') === String(activeAppearance)));
      $('#cpp-poses').innerHTML = list.map(p => `
        <div class="cpp-pose${selected.has(p.id) ? ' sel' : ''}${hasImage(p.id) ? ' has' : ''}"
             data-pose="${esc(p.id)}" title="${esc(p.cn || p.name)}${p.duo ? '（需双人）' : ''}">
          <span class="t">${esc(p.name)}</span>${p.duo ? '<span class="tag">双</span>' : ''}
        </div>`).join('') || '<div class="cpp-empty" style="grid-column:1/-1">该分类下没有动作</div>';
      host.querySelectorAll('.cpp-pose').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.dataset.pose;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          renderPoses();
          updateProgress();
        });
      });
      updateProgress();
    }

    function updateProgress() {
      const n = selected.size;
      $('#cpp-progress').textContent = n ? `已选 ${n} 个动作` : '';
      $('#cpp-gen').disabled = n === 0;
    }

    function galleryItems() {
      return filteredImages().map((im) => ({
        url: im.image_url,
        title: im.pose_name || im.category || '动作表情',
        prompt: im.prompt || '',
        width: im.width, height: im.height,
        meta: {
          '动作': im.pose_name || '',
          '分类': im.category || '',
          '外观配置': im.appearance_name || '（旧图 / 未记录）',
          '取景': (im.framing || 'full') === 'half' ? '半身' : '全身',
          '模型方案': im.model_preset || (GenParams.get('characters').model_preset || '激活方案'),
          '尺寸': im.width && im.height ? `${im.width}×${im.height}` : '',
          '时间': im.created_at || '',
        },
      }));
    }

    function renderGallery() {
      // 清理已不存在的选中 id（删图后 / 切外观配置后）
      gallerySel.forEach(id => { if (!images.some(im => String(im.id) === String(id))) gallerySel.delete(id); });
      const list = filteredImages();
      if (!list.length) {
        $('#cpp-gallery').innerHTML = `<div class="cpp-empty" style="grid-column:1/-1">${
          images.length
            ? '当前筛选下没有图。换个外观配置 / 动作分类，或直接生成。'
            : '还没有动作表情图。选中动作后点「生成选中动作」。'
        }</div>`;
        paintGallerySel();
        return;
      }
      $('#cpp-gallery').innerHTML = list.map((im, i) => `
        <div class="cpp-card" data-id="${im.id}" data-i="${i}">
          <img src="${esc(im.image_url)}" loading="lazy" title="点击查看尺寸与提示词">
          <div class="m">
            <span class="nm">${esc(im.pose_name || im.category || '')}</span>
            <span class="px">${im.width ? im.width + '×' + im.height : ''}</span>
            <span class="x" data-del="${im.id}" title="删除记录">✕</span>
          </div>
          <div class="cfgm">${esc(im.appearance_name || '旧图')} · ${(im.framing || 'full') === 'half' ? '半身' : '全身'}</div>
        </div>`).join('');
      host.querySelectorAll('.cpp-card').forEach(card => {
        const id = card.dataset.id;
        card.addEventListener('click', (e) => {
          if (e.target.dataset.del) return;
          // 单击选中；按住 Shift 切换多选
          if (e.shiftKey) {
            if (gallerySel.has(id)) gallerySel.delete(id); else gallerySel.add(id);
          } else {
            gallerySel.clear(); gallerySel.add(id);
          }
          paintGallerySel();
        });
        // 双击打开大图预览
        card.addEventListener('dblclick', (e) => {
          if (e.target.dataset.del) return;
          const i = Number(card.dataset.i) || 0;
          if (window.ImagePreview) ImagePreview.open(galleryItems(), i);
        });
        // 右键：对选中项重新生成 / 批量删除
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openCardMenu(e.clientX, e.clientY, id);
        });
      });
      host.querySelectorAll('[data-del]').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!await Admin.confirm('删除这条图片记录？（不会删除磁盘文件）')) return;
          try {
            await Admin.del(`/characters/${charId}/poses/${el.dataset.del}`);
            gallerySel.delete(String(el.dataset.del));
            await loadImages();
            Admin.toast('已删除记录', 'success');
          } catch (err) { Admin.toast('删除失败：' + err.message, 'error'); }
        });
      });
      paintGallerySel();
    }

    // 刷新图片选中高亮 + 计数
    function paintGallerySel() {
      host.querySelectorAll('.cpp-card').forEach(card => {
        card.classList.toggle('sel', gallerySel.has(card.dataset.id));
      });
      const sc = $('#cpp-selcount');
      if (sc) sc.textContent = gallerySel.size ? `已选 ${gallerySel.size} 张` : '';
    }

    // 右键菜单：重新生成 / 批量删除
    function openCardMenu(x, y, imgId) {
      // 右键的卡片不在已选集合里 → 先只选中它，避免误操作到无关的图
      if (!gallerySel.has(imgId)) {
        gallerySel.clear(); gallerySel.add(imgId);
        paintGallerySel();
      }
      const n = gallerySel.size;
      const menu = document.createElement('div');
      menu.className = 'cpp-menu';
      menu.innerHTML = `
        <button type="button" data-act="regen">🔄 重新生成选中（${n} 张）</button>
        <button type="button" data-act="del">🗑 删除选中（${n} 张）</button>`;
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 200)) + 'px';
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 90)) + 'px';
      document.body.appendChild(menu);
      const close = () => { menu.remove(); document.removeEventListener('mousedown', onDocDown); };
      function onDocDown(ev) { if (!menu.contains(ev.target)) close(); }
      setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
      menu.querySelector('[data-act="regen"]').addEventListener('click', (e) => { e.stopPropagation(); close(); regenerateSelected(); });
      menu.querySelector('[data-act="del"]').addEventListener('click', (e) => { e.stopPropagation(); close(); deleteSelected(); });
    }

    // 重新生成：按图片记录的 appearance_id + framing 分组，各提交一批
    async function regenerateSelected() {
      const ids = Array.from(gallerySel);
      if (!ids.length) return;
      const imgs = images.filter(im => ids.includes(String(im.id)));
      const groups = new Map();
      for (const im of imgs) {
        if (!im.pose_id) continue;
        const key = `${im.appearance_id || ''}|${im.framing || ''}`;
        if (!groups.has(key)) groups.set(key, { appearance_id: im.appearance_id, framing: im.framing, pose_ids: new Set() });
        groups.get(key).pose_ids.add(im.pose_id);
      }
      if (!groups.size) { Admin.toast('选中的图没有可重生成的动作', 'error'); return; }
      const gp = window.GenParams ? GenParams.get('characters') : {};
      const jobIds = [];
      for (const g of groups.values()) {
        try {
          const r = await Admin.post(`/characters/${charId}/poses/generate`, {
            model_preset: gp.model_preset || null,
            use_active_model_preset: !gp.model_preset,
            include_sensitive: !!opts.includeSensitive,
            appearance_id: g.appearance_id ? parseInt(g.appearance_id, 10)
              : (activeAppearance ? parseInt(activeAppearance, 10) : undefined),
            framing: g.framing || undefined,
            width: gp.width || undefined,
            height: gp.height || undefined,
            pose_ids: Array.from(g.pose_ids),
            page: 'characters',
            title: `${opts.charName || '人物'} · 重新生成 ${g.pose_ids.size} 个动作`,
          });
          if (r.job_id) jobIds.push(r.job_id);
        } catch (e) { Admin.toast('重新生成提交失败：' + e.message, 'error'); }
      }
      if (jobIds.length) {
        Admin.toast(`已提交重新生成（${jobIds.length} 组）`, 'success');
        startMultiPoll(jobIds);
      }
    }

    // 批量删除选中的图片记录
    async function deleteSelected() {
      const ids = Array.from(gallerySel);
      if (!ids.length) return;
      if (!await Admin.confirm(`删除选中的 ${ids.length} 条图片记录？（不会删除磁盘文件）`)) return;
      let ok = 0;
      for (const id of ids) {
        try { await Admin.del(`/characters/${charId}/poses/${id}`); ok++; } catch (_) {}
      }
      gallerySel.clear();
      await loadImages();
      Admin.toast(`已删除 ${ok} 条记录`, 'success');
    }

    // 多任务轮询：重新生成可能分多组，合并进度
    function startMultiPoll(jobIds) {
      stopPoll();
      let seen = -1;
      const tick = async () => {
        if (!host.isConnected) { stopPoll(); return; }
        let totalDone = 0, total = 0, allFinished = true, anyError = false;
        for (const jid of jobIds) {
          let j = null;
          try { j = await Admin.get(`/jobs/${jid}`); } catch (_) { continue; }
          if (!j) continue;
          total += j.total || 0;
          totalDone += (j.done || 0) + (j.failed || 0);
          if (j.status === 'running') allFinished = false;
          if (j.status === 'error') anyError = true;
        }
        $('#cpp-progress').textContent = allFinished
          ? `完成 ${totalDone}/${total}` : `生成中 ${totalDone}/${total}`;
        if (totalDone !== seen) { seen = totalDone; await loadImages(); }
        if (allFinished) {
          stopPoll();
          $('#cpp-gen').disabled = selected.size === 0;
          $('#cpp-gen-rand').disabled = false;
          if (anyError) Admin.toast('部分重新生成失败', 'error');
          else Admin.toast(`已重新生成 ${totalDone} 张`, 'success');
          await loadImages();
        }
      };
      pollTimer = setInterval(tick, 2000);
      tick();
    }

    // ---- 任务轮询：出完一张就追加一张 ----
    function stopPoll() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function startPoll(jobId, btn) {
      stopPoll();
      lastSeenCount = -1;
      const tick = async () => {
        if (!host.isConnected) { stopPoll(); return; }
        let j = null;
        try { j = await Admin.get(`/jobs/${jobId}`); } catch (_) { return; }
        if (!j) return;
        const finished = j.status !== 'running';
        const doneCount = j.done + j.failed;
        $('#cpp-progress').textContent = finished
          ? (j.status === 'error' ? '生成失败' : `完成 ${j.done}/${j.total}`)
          : `生成中 ${doneCount}/${j.total} · ${j.message || '正在调用 ComfyUI'}`;
        // 每多一张就刷新画廊（不用等全部跑完）
        if (j.done !== lastSeenCount) {
          lastSeenCount = j.done;
          await loadImages();
        }
        if (finished) {
          stopPoll();
          if (btn) { btn.disabled = false; }
          $('#cpp-gen').disabled = selected.size === 0;
          $('#cpp-gen-rand').disabled = false;
          if (j.status === 'error') {
            const firstErr = (j.results || []).find(r => !r.ok);
            Admin.toast('生成失败：' + (j.message || (firstErr && firstErr.error) || '未知原因'), 'error');
          } else {
            selected.clear();
            renderPoses();
            Admin.toast(`已生成 ${j.done} 张动作表情图`, 'success');
          }
          await loadImages();
        }
      };
      pollTimer = setInterval(tick, 2000);
      tick();
    }

    async function generate(body, btn) {
      if (!charId) { Admin.toast('请先保存人物后再生成', 'error'); return; }
      const gp = window.GenParams ? GenParams.get('characters') : {};
      const preset = gp.model_preset || null;
      const old = btn.textContent;
      btn.disabled = true;
      $('#cpp-gen-rand').disabled = true;
      btn.textContent = '生成中…';
      $('#cpp-progress').textContent = '正在提交到 ComfyUI…';
      try {
        const r = await Admin.post(`/characters/${charId}/poses/generate`, Object.assign({
          model_preset: preset,
          use_active_model_preset: !preset,
          include_sensitive: !!opts.includeSensitive,
          appearance_id: activeAppearance ? parseInt(activeAppearance, 10) : undefined,
          width: gp.width || undefined,
          height: gp.height || undefined,
          page: 'characters',
          title: `${opts.charName || '人物'} · 动作表情`,
        }, body));
        btn.textContent = old;
        if (r.job_id) {
          Admin.toast('已提交，后台生成中（可切到别的栏目，左侧栏会显示进度）', 'success');
          startPoll(r.job_id, btn);
        } else {
          btn.disabled = false;
          $('#cpp-gen-rand').disabled = false;
        }
      } catch (e) {
        $('#cpp-progress').textContent = '';
        btn.disabled = false;
        $('#cpp-gen-rand').disabled = false;
        btn.textContent = old;
        Admin.toast('提交失败：' + e.message, 'error');
      }
    }

    $('#cpp-gen').addEventListener('click', (e) => {
      if (selected.size === 0) return;
      generate({ pose_ids: Array.from(selected), title: `${opts.charName || '人物'} · 选中 ${selected.size} 个动作` }, e.currentTarget);
    });

    $('#cpp-gen-rand').addEventListener('click', (e) => {
      const cat = activeCat;
      if (!cat) { Admin.toast('请先选一个动作分类（不要选「全部」）', 'error'); return; }
      const gp = window.GenParams ? GenParams.get('characters') : {};
      const count = Math.max(1, Math.min(60, parseInt(gp.count) || 10));
      const catName = (lib.categories || []).find(c => c.id === cat)?.name || cat;
      generate({ category: cat, count, title: `${opts.charName || '人物'} · ${catName} ×${count}` }, e.currentTarget);
    });

    $('#cpp-clear').addEventListener('click', () => {
      selected.clear();
      gallerySel.clear();
      renderPoses();
      paintGallerySel();
    });

    $('#cpp-appearance')?.addEventListener('change', async (e) => {
      activeAppearance = e.target.value;
      refreshFramingView();
      gallerySel.clear();
      await loadImages();
      Admin.toast(activeAppearance ? '已切换到这套外观配置' : '显示全部配置的图', 'info');
    });

    // ---- 初始化 ----
    await loadAppearances();
    await loadLib();
    await loadImages();

    // 如果这个人物已经有任务在跑（比如刚切页回来），自动接上进度
    const running = (window.JobMonitor ? JobMonitor.jobs() : [])
      .find(j => j.status === 'running' && j.kind === 'pose_batch' &&
        j.focus && String(j.focus.character_id) === String(charId));
    if (running) startPoll(running.id, null);

    // 兜底：不管任务是本面板提交的还是别处提交的，都跟着全局任务状态走。
    // 每多一张就刷画廊，收尾时再拉一次（这样别人在别的页面提交也看得见）。
    let seenGlobal = -1;
    const onJobsUpdate = (e) => {
      const jobs = Array.isArray(e.detail) ? e.detail : [];
      const mine = jobs.filter(j => j.kind === 'pose_batch' &&
        j.focus && String(j.focus.character_id) === String(charId));
      if (!mine.length) return;
      const j = mine.find(x => x.status === 'running') || mine[0];
      const doneCount = j.done + j.failed;
      if (doneCount !== seenGlobal) {
        seenGlobal = doneCount;
        if (!pollTimer) loadImages();
      }
    };
    document.addEventListener('jobs:update', onJobsUpdate);

    return {
      reload: async () => { await loadLib(); await loadImages(); },
      stop: () => { stopPoll(); document.removeEventListener('jobs:update', onJobsUpdate); },
      genParams: gpInst,
    };
  }

  window.CharacterPosePanel = { mount, esc };
})();
