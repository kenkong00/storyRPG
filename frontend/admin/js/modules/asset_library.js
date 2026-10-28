// ========== 素材库总览（图片管理 → 素材总览） ==========
//
// 这里是「所有图片」的唯一入口：AI 出的、本地上传的、从老目录扫进来的，全在一张表里。
// 素材和用途是分开的 —— 这张图属于哪类素材（kind）和它现在被谁用着（引用）是两件事，
// 所以卡片上能看到「被 2 处使用」，点开能看到具体是哪个人物/哪个场景，删之前先让人看一眼。

window.AssetLibrary = (function () {
  const KIND_LABEL = {
    portrait: '人物立绘', pose: '人物动作', scene: '场景', illustration: '人物场景合成',
    item: '物品',
    monster: '怪物', ui: '界面', icon: '图标', other: '其他',
  };
  const KIND_LIST = Object.keys(KIND_LABEL);
  const ORIGIN_LABEL = { ai: 'AI 生成', upload: '本地上传', import: '外部导入' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function ensureStyle() {
    if (document.getElementById('asset-lib-style')) return;
    const el = document.createElement('style');
    el.id = 'asset-lib-style';
    el.textContent = `
.al-wrap { display:flex; flex-direction:column; gap:12px; }
.al-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.al-bar input, .al-bar select {
  height:32px; padding:0 10px; border:1px solid var(--border); border-radius:6px;
  background:var(--bg-input); color:var(--text-primary); font-size:12.5px;
}
.al-bar input:focus, .al-bar select:focus { outline:none; border-color:var(--gold); }
.al-bar .grow { flex:1 1 200px; min-width:160px; }
.al-bar .btn { height:32px; }
.al-stat { font-size:12px; color:var(--text-muted); margin-left:auto; }
.al-stat b { color:var(--gold); }

.al-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(158px,1fr)); gap:12px; }
.al-card {
  position:relative; border:1px solid var(--border); border-radius:9px;
  background:var(--bg-card); overflow:hidden; cursor:pointer;
  transition:border-color .15s, transform .15s;
}
.al-card:hover { border-color:var(--gold); transform:translateY(-2px); }
.al-thumb { width:100%; aspect-ratio:1/1; background:var(--bg-input); overflow:hidden; }
.al-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.al-body { padding:6px 8px 8px; }
.al-name { font-size:12px; color:var(--text-primary); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.al-sub { display:flex; align-items:center; gap:6px; margin-top:3px;
  font-size:10.5px; color:var(--text-muted); font-variant-numeric:tabular-nums; }
.al-sub .k { color:var(--gold); }
.al-tag {
  position:absolute; left:6px; top:6px; padding:0 5px; border-radius:3px;
  font-size:9.5px; line-height:15px;
  background:rgba(10,11,15,.8); color:#cfd3e0; border:1px solid rgba(255,255,255,.16);
}
.al-tag.ai { color:var(--gold); border-color:rgba(201,168,76,.45); }
.al-use {
  position:absolute; right:6px; top:6px; padding:0 5px; border-radius:3px;
  font-size:9.5px; line-height:15px;
  background:rgba(47,133,90,.85); color:#eafff4;
}
.al-arch { position:absolute; inset:0; background:rgba(8,9,12,.62);
  display:flex; align-items:center; justify-content:center;
  font-size:12px; color:#ffb3a7; }

/* 详情弹层 */
.al-ov { position:fixed; inset:0; z-index:10500; background:rgba(6,7,10,.74);
  display:flex; align-items:center; justify-content:center; padding:26px; }
.al-dlg { width:min(980px,94vw); max-height:90vh; display:flex; flex-direction:column;
  background:var(--bg-card); border:1px solid var(--border); border-radius:14px;
  box-shadow:0 24px 70px rgba(0,0,0,.6); overflow:hidden; }
.al-hd { display:flex; align-items:center; gap:10px; padding:13px 18px;
  border-bottom:1px solid var(--border); }
.al-hd h3 { margin:0; font-size:14.5px; }
.al-hd .x { margin-left:auto; width:28px; height:28px; border-radius:6px; cursor:pointer;
  border:1px solid var(--border); background:transparent; color:var(--text-secondary); font-size:15px; }
.al-hd .x:hover { color:var(--text-primary); border-color:var(--gold); }
.al-bd { flex:1 1 auto; display:flex; min-height:0; }
.al-pv { flex:0 0 46%; background:#111218; display:flex; align-items:center;
  justify-content:center; padding:14px; overflow:auto; }
.al-pv img { max-width:100%; max-height:62vh; object-fit:contain; border-radius:6px; }
.al-side { flex:1 1 auto; overflow:auto; padding:16px 18px; display:flex;
  flex-direction:column; gap:14px; }
.al-kv { display:grid; grid-template-columns:74px 1fr; gap:7px 10px; font-size:12.5px; }
.al-kv .k { color:var(--text-muted); }
.al-kv .v { color:var(--text-primary); word-break:break-all; }
.al-sec-t { font-size:11.5px; color:var(--text-muted); letter-spacing:.04em; margin-bottom:6px; }
.al-use-row { display:flex; align-items:center; gap:8px; padding:6px 8px;
  border:1px solid var(--border); border-radius:6px; font-size:12px; margin-bottom:5px; }
.al-use-row .lb { color:var(--gold); }
.al-use-row .go { margin-left:auto; font-size:11.5px; color:var(--text-muted); cursor:pointer; }
.al-use-row .go:hover { color:var(--gold); }
.al-prompt { font-size:12px; line-height:1.7; color:var(--text-secondary);
  background:var(--bg-input); border:1px solid var(--border); border-radius:6px;
  padding:8px 10px; max-height:130px; overflow:auto; white-space:pre-wrap; }
.al-ft { display:flex; align-items:center; gap:8px; padding:11px 18px;
  border-top:1px solid var(--border); }
.al-empty { padding:60px 20px; text-align:center; color:var(--text-muted); font-size:12.5px; line-height:1.9; }
`;
    document.head.appendChild(el);
  }

  // ------------------------------------------------------------
  async function mount(host) {
    ensureStyle();
    const S = { kind: 'all', origin: 'all', q: '', status: 'usable', items: [], total: 0, usage: {} };

    host.innerHTML = `
      <div class="al-wrap">
        <div class="al-bar">
          <input class="al-q grow" type="text" placeholder="搜名称 / 主体 / 动作 / 提示词 / 标签…">
          <select class="al-kind">
            <option value="all">全部类型</option>
            ${KIND_LIST.map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join('')}
          </select>
          <select class="al-origin">
            <option value="all">全部来源</option>
            <option value="ai">AI 生成</option>
            <option value="upload">本地上传</option>
            <option value="import">外部导入</option>
          </select>
          <select class="al-status">
            <option value="usable">在用（隐藏已弃用）</option>
            <option value="archived">已弃用</option>
            <option value="all">全部</option>
          </select>
          <button class="btn btn-outline btn-sm al-sync" type="button">同步磁盘</button>
          <span class="al-stat"></span>
        </div>
        <div class="al-grid"></div>
      </div>`;

    const grid = host.querySelector('.al-grid');
    const stat = host.querySelector('.al-stat');

    async function load() {
      grid.innerHTML = '<div class="al-empty">加载中…</div>';
      const p = new URLSearchParams();
      if (S.kind !== 'all') p.set('kind', S.kind);
      if (S.origin !== 'all') p.set('origin', S.origin);
      if (S.q) p.set('q', S.q);
      p.set('status', S.status);
      p.set('limit', '500');
      try {
        const [list, usage] = await Promise.all([
          Admin.get(`/assets?${p.toString()}`),
          Admin.get('/assets/usage-index/all'),
        ]);
        S.items = list.items || [];
        S.total = list.total || 0;
        S.usage = usage.index || {};
      } catch (e) {
        grid.innerHTML = `<div class="al-empty" style="color:var(--red)">加载失败：${esc(e.message || e)}</div>`;
        return;
      }
      paint();
    }

    function paint() {
      stat.innerHTML = `共 <b>${S.total}</b> 张`;
      if (!S.items.length) {
        grid.innerHTML = `<div class="al-empty">没有符合条件的素材。<br>
          点右上角 <b>同步磁盘</b> 把目录里还没入库的图片收进来。</div>`;
        return;
      }
      grid.innerHTML = S.items.map((a) => {
        const name = a.subject_name || a.variant_name || a.name || KIND_LABEL[a.kind] || '素材';
        const dim = a.width && a.height ? `${a.width}×${a.height}` : '';
        const used = S.usage[a.url] || 0;
        return `<div class="al-card" data-id="${a.id}">
          <div class="al-thumb"><img loading="lazy" src="${esc(a.url)}" alt=""></div>
          <span class="al-tag ${a.origin === 'ai' ? 'ai' : ''}">${esc(ORIGIN_LABEL[a.origin] || '')}</span>
          ${used ? `<span class="al-use">被用 ${used}</span>` : ''}
          ${a.status === 'archived' ? '<div class="al-arch">已弃用</div>' : ''}
          <div class="al-body">
            <div class="al-name" title="${esc(name)}">${esc(name)}</div>
            <div class="al-sub"><span class="k">${esc(KIND_LABEL[a.kind] || '其他')}</span><span>${dim}</span></div>
          </div>
        </div>`;
      }).join('');
      grid.querySelectorAll('.al-card').forEach((c) => {
        c.addEventListener('click', () => {
          const a = S.items.find((x) => String(x.id) === c.dataset.id);
          if (a) openDetail(a, load);
        });
      });
    }

    host.querySelector('.al-q').addEventListener('input', (e) => {
      clearTimeout(S._t);
      S._t = setTimeout(() => { S.q = e.target.value.trim(); load(); }, 280);
    });
    host.querySelector('.al-kind').addEventListener('change', (e) => { S.kind = e.target.value; load(); });
    host.querySelector('.al-origin').addEventListener('change', (e) => { S.origin = e.target.value; load(); });
    host.querySelector('.al-status').addEventListener('change', (e) => { S.status = e.target.value; load(); });
    host.querySelector('.al-sync').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = '扫描中…';
      try {
        const r = await Admin.post('/assets/sync', {});
        Admin.toast(`新增 ${r.added || 0} 张（扫到 ${r.scanned || 0} 个文件）`, 'success');
        await load();
      } catch (err) {
        Admin.toast('同步失败：' + (err.message || err), 'error');
      } finally {
        b.disabled = false; b.textContent = '同步磁盘';
      }
    });

    await load();
    return { reload: load };
  }

  // ------------------------------------------------------------
  async function openDetail(a, onChanged) {
    ensureStyle();
    let full = a;
    try {
      full = await Admin.get(`/assets/${a.id}`);
    } catch (e) { /* 用列表里的信息兜底 */ }

    const ov = document.createElement('div');
    ov.className = 'al-ov';
    ov.innerHTML = `
      <div class="al-dlg">
        <div class="al-hd">
          <h3>素材详情</h3>
          <span style="font-size:11.5px;color:var(--text-muted)">#${full.id}</span>
          <button class="x" type="button">×</button>
        </div>
        <div class="al-bd">
          <div class="al-pv"><img src="${esc(full.url)}" alt=""></div>
          <div class="al-side">
            <div class="al-kv">
              <span class="k">尺寸</span><span class="v">${full.width || '?'} × ${full.height || '?'}</span>
              <span class="k">大小</span><span class="v">${full.bytes ? (full.bytes / 1024).toFixed(0) + ' KB' : '—'}</span>
              <span class="k">来源</span><span class="v">${esc(full.origin_label || '')}${full.source ? ' · ' + esc(full.source) : ''}</span>
              <span class="k">主体</span><span class="v">${esc(full.subject_name || '未关联')}</span>
              <span class="k">路径</span><span class="v" style="font-size:11.5px;color:var(--text-muted)">${esc(full.url)}</span>
            </div>

            <div>
              <div class="al-sec-t">素材类型（决定在选择器里归到哪一栏）</div>
              <select class="al-edit-kind" style="height:34px;padding:0 8px;border:1px solid var(--border);
                border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:12.5px;
                width:100%;max-width:240px">
                ${KIND_LIST.map((k) => `<option value="${k}" ${full.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}
              </select>
            </div>

            <div>
              <div class="al-sec-t">正在被这些地方使用（${(full.usages || []).length}）</div>
              <div class="al-uses">${(full.usages || []).length
                ? full.usages.map((u) => `<div class="al-use-row">
                    <span class="lb">${esc(u.label)}</span><span>${esc(u.name || '#' + u.owner_id)}</span>
                    <span class="go" data-page="${esc(u.page || '')}">前往 →</span></div>`).join('')
                : '<div style="font-size:12px;color:var(--text-muted)">暂时没有引用 —— 可以安全删除或弃用。</div>'}</div>
            </div>

            ${full.prompt ? `<div>
              <div class="al-sec-t">生成提示词</div>
              <div class="al-prompt">${esc(full.prompt)}</div>
            </div>` : ''}
          </div>
        </div>
        <div class="al-ft">
          <button class="btn btn-outline btn-sm" data-act="archive">${full.status === 'archived' ? '恢复启用' : '弃用（保留文件）'}</button>
          <button class="btn btn-outline btn-sm" data-act="use-as">预览大图</button>
          <span style="margin-left:auto"></span>
          <button class="btn btn-outline btn-sm" data-act="close">关闭</button>
          <button class="btn btn-danger btn-sm" data-act="del">删除</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const close = () => ov.remove();
    ov.querySelector('.al-hd .x').addEventListener('click', close);
    ov.querySelector('[data-act="close"]').addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });

    ov.querySelectorAll('.al-use-row .go').forEach((g) => {
      g.addEventListener('click', () => {
        const page = g.dataset.page;
        if (!page) return;
        close();
        Admin.navigate(page);
      });
    });

    ov.querySelector('.al-edit-kind').addEventListener('change', async (e) => {
      try {
        await Admin.patch(`/assets/${full.id}`, { kind: e.target.value });
        full.kind = e.target.value;
        Admin.toast('已更新类型', 'success');
        onChanged && onChanged();
      } catch (err) {
        Admin.toast('更新失败：' + (err.message || err), 'error');
      }
    });

    ov.querySelector('[data-act="archive"]').addEventListener('click', async (e) => {
      const next = full.status === 'archived' ? 'final' : 'archived';
      try {
        await Admin.patch(`/assets/${full.id}`, { status: next });
        Admin.toast(next === 'archived' ? '已弃用（文件保留，选择器里不再出现）' : '已恢复启用', 'success');
        close();
        onChanged && onChanged();
      } catch (err) {
        Admin.toast('操作失败：' + (err.message || err), 'error');
      }
    });

    ov.querySelector('[data-act="use-as"]').addEventListener('click', () => {
      close();
      if (window.AssetPicker) AssetPicker.preview(full.url);
    });

    ov.querySelector('[data-act="del"]').addEventListener('click', async () => {
      const ok = await Admin.confirm(
        `删除这张素材？\n${full.url}\n\n` +
        ((full.usages || []).length ? `注意：还有 ${full.usages.length} 处引用，删完那边会显示图片失效。` : '没有引用，可以放心删。')
      );
      if (!ok) return;
      try {
        await Admin.del(`/assets/${full.id}?remove_file=true&force=true`);
        Admin.toast('已删除', 'success');
        close();
        onChanged && onChanged();
      } catch (err) {
        Admin.toast('删除失败：' + (err.message || err), 'error');
      }
    });
  }

  return { mount, openDetail, KIND_LABEL };
})();
