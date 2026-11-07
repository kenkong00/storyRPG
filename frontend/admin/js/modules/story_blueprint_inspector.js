/* ===== 剧情蓝图 · 右侧检查器 =====
 * 依赖 Admin（admin.js）。由 story_blueprint.js 调用 BPInspector.open(ctx, sel)。
 *
 * 设计要点：
 * - 节点保存走「PUT /story/nodes/{id} 全量」+ 对白/选项做 diff（增/改/删/排序），
 *   因为后端 update_node 是全量覆盖，少传字段会被重置成默认值。
 * - 输入只写内存模型，不整块重绘，避免打字时焦点丢失。
 */
window.BPInspector = (function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const NODE_TYPES = [['dialogue', '对话'], ['choice', '选择'], ['battle', '战斗'], ['cutscene', '过场']];
  const EXPRS = [
    ['', '无表情'], ['normal', '平静'], ['happy', '微笑'], ['angry', '愤怒'],
    ['sad', '悲伤'], ['surprised', '惊讶'], ['arrogant', '狂傲'], ['defeated', '战败'],
    ['jealous', '妒忌'], ['regretful', '悔恨'], ['crying', '哭泣'], ['begging', '求饶'],
    ['confident', '自信'], ['shocked', '震惊'], ['desperate', '绝望'], ['determined', '坚定'],
  ];
  const POSITIONS = [
    ['', '—'], ['left-1', '最左'], ['left-2', '左二'], ['left-3', '左三'],
    ['center', '居中'], ['right-3', '右三'], ['right-2', '右二'], ['right-1', '最右'],
  ];

  let ctx = null;
  let sel = null;
  let base = null;   // 基础节点（GET /story/nodes/{id}，字段最全）
  let full = null;   // full（对白/选项）
  let dlg = [];      // 工作副本
  let chs = [];
  let activeDlg = 0;
  let busy = false;

  const box = () => document.getElementById('bp-inspector');
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));

  const opt = (list, cur, empty) => {
    let h = empty != null ? `<option value="">${esc(empty)}</option>` : '';
    list.forEach(([v, t]) => { h += `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`; });
    return h;
  };

  function setDeep(path, value) {
    const m = path.match(/^(\w+)\[(\d+)\]\.(\w+)$/);
    if (m) {
      const arr = ({ dlg, chs, base })[m[1]];
      if (arr && arr[Number(m[2])]) arr[Number(m[2])][m[3]] = value;
      return;
    }
    if (base && path.startsWith('base.')) base[path.slice(5)] = value;
  }

  /* ================= 打开 ================= */
  async function open(c, selection) {
    ctx = c;
    sel = selection;
    const el = box();
    if (!el) return;
    el.classList.remove('bp-hidden');
    if (!selection) { close(); return; }
    if (selection.kind === 'node') return openNode(selection.ref_id);
    if (selection.kind === 'chapter') return openChapter(selection.ref_id);
    if (selection.kind === 'arc') return openArc(selection.ref_id);
  }

  function close() {
    const el = box();
    if (el) {
      el.classList.add('bp-hidden');
      el.innerHTML = '';
    }
    sel = null; base = null; full = null; dlg = []; chs = [];
    if (ctx && ctx.clearSelection) ctx.clearSelection();
  }

  function loading(t) {
    box().innerHTML = `<div class="bp-ins-empty">正在载入 ${esc(t)}…</div>`;
  }

  /* ================= 节点 ================= */
  async function openNode(id) {
    loading('节点');
    try {
      const [b, f] = await Promise.all([
        Admin.get(`/story/nodes/${id}`),
        Admin.get(`/story/nodes/${id}/full`),
      ]);
      base = b;
      full = f;
      dlg = (f.dialogues || []).map((d) => ({ ...d }));
      chs = (f.choices || []).map((c) => ({ ...c }));
      if (activeDlg >= dlg.length) activeDlg = Math.max(0, dlg.length - 1);
      renderNode();
    } catch (e) {
      box().innerHTML = `<div class="bp-ins-empty">载入失败：${esc(e.message)}</div>`;
    }
  }

  function renderNode() {
    const nid = base.id;
    const typeLabel = (NODE_TYPES.find(t => t[0] === base.node_type) || ['', base.node_type])[1];
    const chapter = ctx.chapters.find(c => c.id === base.chapter_id);
    const arc = chapter ? ctx.arcs.find(a => a.id === chapter.story_arc_id) : null;
    const curD = dlg[activeDlg] || null;

    let h = `
      <div class="bp-ins-head">
        <span class="bp-kind-tag" style="background:#6ba3ff">${esc(typeLabel)}</span>
        <b>#${nid} ${esc(base.title || '未命名节点')}</b>
        <button class="bp-mini-btn" data-act="close" title="关闭">✕</button>
      </div>
      <div class="bp-meta-line" style="font-size:10.5px;color:var(--text-muted);margin-bottom:8px">
        ${esc(arc ? arc.title : '—')} / ${esc(chapter ? chapter.title : '—')} · 序号 ${base.order_index}
      </div>

      <div class="bp-ins-sec">基础</div>
      <div class="bp-field"><label>节点标题</label>
        <input type="text" data-model="base.title" value="${esc(base.title || '')}" placeholder="给这段剧情起个名字">
      </div>
      <div class="bp-grid2">
        <div class="bp-field"><label>类型</label>
          <select data-model="base.node_type">${opt(NODE_TYPES, base.node_type)}</select>
        </div>
        <div class="bp-field"><label>序号</label>
          <input type="number" data-model="base.order_index" value="${base.order_index ?? 0}">
        </div>
      </div>
      <div class="bp-field"><label>场景</label>
        <select data-model="base.scene_id">${opt(ctx.scenes.map(s => [s.id, s.name || ('场景' + s.id)]), base.scene_id, '（不指定）')}</select>
      </div>
      <div class="bp-grid2">
        <div class="bp-field"><label>默认说话者</label>
          <select data-model="base.speaker_id">${opt(ctx.chars.map(c => [c.id, c.name || ('人物' + c.id)]), base.speaker_id, '（无）')}</select>
        </div>
        <div class="bp-field"><label>表演位置</label>
          <select data-model="base.position">${opt(POSITIONS, base.position)}</select>
        </div>
      </div>
      <div class="bp-field"><label>背景图（可空）</label>
        <div style="display:flex;gap:5px">
          <input type="text" data-model="base.background_change" value="${esc(base.background_change || '')}" placeholder="/static/images/... 或 scene 图片">
          <button class="bp-btn-xs" data-act="preview-bg">预览</button>
        </div>
        <div id="bp-bg-prev" style="margin-top:4px"></div>
      </div>
      <div class="bp-grid2">
        <div class="bp-field"><label>BGM</label>
          <input type="text" data-model="base.bgm" value="${esc(base.bgm || '')}" placeholder="音乐路径">
        </div>
        <div class="bp-field"><label>背景动效 ID</label>
          <input type="number" data-model="base.bg_animation_effect_id" value="${base.bg_animation_effect_id ?? ''}">
        </div>
      </div>
      <div class="bp-field"><label>节点正文（无对白时的旁白/描述）</label>
        <textarea data-model="base.content" placeholder="旁白、过场描述…">${esc(base.content || '')}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary);margin-bottom:8px">
        <input type="checkbox" data-model="base.is_key_node" ${base.is_key_node ? 'checked' : ''}> 关键节点
      </label>
    `;

    // ---- 舞台预览（StageEditor 共用组件：拖动移动 / 滚轮缩放 / 拖角缩放，不再用滑块） ----
    h += `<div class="bp-ins-sec">舞台位置</div>`;
    h += `<div id="bp-stage" style="margin-bottom:6px"></div>`;
    h += `<div style="display:flex;gap:7px;align-items:center;margin-bottom:10px">
      <button class="bp-btn-xs" id="bp-stage-big" title="放大窗口调整位置与缩放">⛶ 放大窗口调整</button>
      <span style="flex:1;font-size:10.5px;color:var(--text-muted);line-height:1.4">拖动人物移动 · 滚轮或拖右上角圆点缩放 · 方向键微调（不再用滑块）</span>
    </div>`;
    if (curD) {
      h += `<div class="bp-grid4">
        <div class="bp-field"><label>层级</label><input type="number" step="1" data-model="dlg[${activeDlg}].z_index" value="${curD.z_index ?? 1}"></div>
        <div class="bp-field"><label>裁剪上%</label><input type="number" step="1" data-model="dlg[${activeDlg}].crop_top" value="${curD.crop_top ?? 0}"></div>
        <div class="bp-field"><label>裁剪下%</label><input type="number" step="1" data-model="dlg[${activeDlg}].crop_bottom" value="${curD.crop_bottom ?? 100}"></div>
        <div class="bp-field"><label>翻转</label><select data-model="dlg[${activeDlg}].flip">${opt([['0','否'],['1','是']], curD.flip ?? 0)}</select></div>
      </div>
      <div class="bp-field" style="margin-bottom:10px"><label>说完消失</label>
        <select data-model="dlg[${activeDlg}].disappear_after" style="width:120px">${opt([['0','否'],['1','是']], curD.disappear_after ?? 0)}</select></div>`;
    }

    // ---- 对白列表 ----
    h += `<div class="bp-ins-sec">对白列表（${dlg.length} 句）</div>`;
    if (!dlg.length) {
      h += `<div style="color:var(--text-muted);font-size:11px;padding:6px 0 8px">还没有对白。可由下面的「单句正文」生成一句，或直接添加。</div>`;
    }
    dlg.forEach((d, i) => {
      const spName = (ctx.chars.find(c => c.id === d.speaker_id) || {}).name || '未指定';
      h += `
      <div class="bp-dlg ${i === activeDlg ? 'bp-dlg-active' : ''}" style="${i === activeDlg ? 'border-color:var(--accent)' : ''}">
        <div class="bp-dlg-head">
          <span class="bp-dlg-idx">#${i + 1}</span>
          <select class="bp-sp" data-model="dlg[${i}].speaker_id" title="说话者">
            ${opt(ctx.chars.map(c => [c.id, c.name || ('人物' + c.id)]), d.speaker_id, '（旁白）')}
          </select>
          <select data-model="dlg[${i}].expression" title="表情" style="width:88px">
            ${opt(EXPRS, d.expression)}
          </select>
          <button class="bp-mini-btn" data-act="dlg-up" data-i="${i}" title="上移">↑</button>
          <button class="bp-mini-btn" data-act="dlg-down" data-i="${i}" title="下移">↓</button>
          <button class="bp-mini-btn" data-act="dlg-del" data-i="${i}" title="删除">✕</button>
        </div>
        <textarea data-model="dlg[${i}].content" placeholder="这句台词…" data-focus="${i}" style="margin-bottom:5px">${esc(d.content || '')}</textarea>
        <div class="bp-grid2" style="margin-bottom:5px">
          <div class="bp-field" style="margin:0"><label>动作追加词</label>
            <input type="text" data-model="dlg[${i}].pose_extra" value="${esc(d.pose_extra || '')}" placeholder="接在提示词末尾">
          </div>
          <div class="bp-field" style="margin:0"><label>语音</label>
            <div style="display:flex;gap:4px">
              <input type="text" data-model="dlg[${i}].voice" value="${esc(d.voice || '')}" placeholder="音频路径">
              <button class="bp-btn-xs" data-act="play-voice" data-i="${i}" title="试听">▶</button>
            </div>
          </div>
        </div>
        <div class="bp-grid2">
          <div class="bp-field" style="margin:0"><label>本句背景切换</label>
            <input type="text" data-model="dlg[${i}].bg_change" value="${esc(d.bg_change || '')}">
          </div>
          <div class="bp-field" style="margin:0"><label>本句 BGM</label>
            <input type="text" data-model="dlg[${i}].bgm" value="${esc(d.bgm || '')}">
          </div>
        </div>
        <div style="text-align:right;margin-top:2px">
          <button class="bp-btn-xs" data-act="dlg-focus" data-i="${i}">${i === activeDlg ? '● 正在编辑' : '编辑位置'}</button>
        </div>
      </div>`;
    });
    h += `<div class="bp-row-actions" style="margin-bottom:6px">
      <button class="bp-btn-xs" data-act="dlg-add">＋ 添加一句</button>
      <button class="bp-btn-xs" data-act="dlg-from-node" title="把节点正文生成一句对白">由正文生成一句</button>
    </div>`;

    // ---- 选项 ----
    h += `<div class="bp-ins-sec">选项与跳转（${chs.length}）</div>`;
    if (!chs.length) {
      h += `<div style="color:var(--text-muted);font-size:11px;padding:2px 0 6px">没有选项。需要分支时再加。</div>`;
    }
    chs.forEach((c, i) => {
      h += `
      <div class="bp-choice-row">
        <div style="flex:1 1 auto;min-width:0">
          <input type="text" data-model="chs[${i}].choice_text" value="${esc(c.choice_text || '')}" placeholder="选项文字" style="width:100%;box-sizing:border-box;padding:4px 6px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:11px;margin-bottom:4px">
          <div style="display:flex;gap:4px">
            <select data-model="chs[${i}].next_node_id" style="flex:1 1 auto;padding:3px 5px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:10.5px">
              ${opt(ctx.nodes.map(n => [n.id, '#' + n.id + ' ' + (n.title || n.node_type)]), c.next_node_id, '（不跳转）')}
            </select>
            <select data-model="chs[${i}].is_hidden" style="width:66px;padding:3px 5px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:10.5px">
              ${opt([['0','显示'],['1','隐藏']], c.is_hidden ?? 0)}
            </select>
          </div>
        </div>
        <button class="bp-mini-btn" data-act="ch-del" data-i="${i}" title="删除">✕</button>
      </div>`;
    });
    h += `<div class="bp-row-actions" style="margin-bottom:6px">
      <button class="bp-btn-xs" data-act="ch-add">＋ 添加选项</button>
    </div>`;

    // ---- 战斗 ----
    if (base.node_type === 'battle') {
      h += `<div class="bp-ins-sec">战斗配置（JSON）</div>
      <div class="bp-field"><textarea data-model="base.battle_config" style="min-height:96px;font-family:Consolas,monospace;font-size:10.5px" placeholder='{"enemies":[],"victory_node_id":null}'>${esc(base.battle_config || '')}</textarea></div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">战斗胜负/逃跑跳转也会画成蓝图里的红色虚线。</div>`;
    }

    h += `<div class="bp-ins-footer">
      <button class="bp-btn-xs danger" data-act="del-node">删除节点</button>
      <button class="bp-btn-xs" data-act="demo">▶ 演示本节点</button>
      <button class="btn btn-primary btn-sm" data-act="save">保存</button>
    </div>`;

    box().innerHTML = h;
    bindNode();
    paintStage(curD);
  }

  function paintStage(d) {
    const stage = document.getElementById('bp-stage');
    if (!stage || !d) return;
    if (stage._stg) { stage._stg.destroy(); stage._stg = null; }
    const curState = () => {
      const cur = dlg[activeDlg] || {};
      return {
        bg: (cur.bg_change || (base && base.background_change) || '').trim(),
        img: (base && base.content_image || '').trim(),
        name: (ctx.chars.find(c => c.id === cur.speaker_id) || {}).name || '旁白',
        x: cur.pos_x ?? 50, y: cur.pos_y ?? 0, scale: cur.scale ?? 1,
        flip: cur.flip ?? 0, cropT: cur.crop_top ?? 0, cropB: cur.crop_bottom ?? 100,
      };
    };
    stage._stg = StageEditor.build(stage, {
      getState: curState,
      onChange: (nd) => {
        const cur = dlg[activeDlg];
        if (cur) { cur.pos_x = nd.x; cur.pos_y = nd.y; cur.scale = nd.scale; }
      },
    });

    const bigBtn = document.getElementById('bp-stage-big');
    if (bigBtn) bigBtn.onclick = () => {
      const cur = dlg[activeDlg] || {};
      StageEditor.openBig({
        title: `舞台调整 · #${base.id} ${base.title || ''}`,
        getState: () => curState(),
        onApply: (st) => {
          cur.pos_x = st.x; cur.pos_y = st.y; cur.scale = st.scale;
          cur.flip = st.flip; cur.crop_top = st.cropT; cur.crop_bottom = st.cropB;
          if (st.bg) cur.bg_change = st.bg;
          if (stage._stg) stage._stg.refresh();
        },
      });
    };
  }

  function bindNode() {
    const el = box();
    el.oninput = (e) => {
      const p = e.target.dataset.model;
      if (!p) return;
      const v = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;
      setDeep(p, v);
    };
    el.onchange = (e) => {
      const p = e.target.dataset.model;
      if (!p) return;
      if (e.target.tagName === 'SELECT') {
        const v = e.target.value;
        setDeep(p, (p.endsWith('_id') || p.endsWith('order_index') || p.endsWith('is_hidden') || p.endsWith('flip') || p.endsWith('z_index') || p.endsWith('disappear_after') || p.endsWith('is_key_node')) && v !== '' ? Number(v) : v);
      }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const i = Number(b.dataset.i || 0);

      if (act === 'close') return close();
      if (act === 'dlg-add') {
        dlg.push({ speaker_id: base.speaker_id || null, content: '', expression: base.expression || '', pos_x: 50, pos_y: 0, scale: 1, crop_top: 0, crop_bottom: 100, flip: 0, z_index: 1, disappear_after: 0 });
        activeDlg = dlg.length - 1;
        return renderNode();
      }
      if (act === 'dlg-from-node') {
        dlg.push({ speaker_id: base.speaker_id || null, content: base.content || '', expression: base.expression || '', pos_x: 50, pos_y: 0, scale: 1, crop_top: 0, crop_bottom: 100, flip: 0, z_index: 1, disappear_after: 0 });
        activeDlg = dlg.length - 1;
        return renderNode();
      }
      if (act === 'dlg-del') {
        if (dlg.length <= 1 || !(await Admin.confirm('删除这句对白？'))) { if (dlg.length <= 1) Admin.toast('至少保留一句，或直接清空内容', 'info'); return; }
        dlg.splice(i, 1);
        activeDlg = Math.max(0, Math.min(activeDlg, dlg.length - 1));
        return renderNode();
      }
      if (act === 'dlg-up' && i > 0) {
        const t = dlg[i - 1]; dlg[i - 1] = dlg[i]; dlg[i] = t;
        activeDlg = i - 1; return renderNode();
      }
      if (act === 'dlg-down' && i < dlg.length - 1) {
        const t = dlg[i + 1]; dlg[i + 1] = dlg[i]; dlg[i] = t;
        activeDlg = i + 1; return renderNode();
      }
      if (act === 'dlg-focus') { activeDlg = i; return renderNode(); }
      if (act === 'ch-add') {
        chs.push({ choice_text: '', next_node_id: null, condition_group: null, is_hidden: 0 });
        return renderNode();
      }
      if (act === 'ch-del') {
        if (!(await Admin.confirm('删除这个选项？'))) return;
        chs.splice(i, 1); return renderNode();
      }
      if (act === 'play-voice') {
        const v = (dlg[i] || {}).voice;
        if (!v) return Admin.toast('这句还没配语音', 'info');
        try { new Audio(v).play(); } catch (_) { Admin.toast('无法播放：' + v, 'error'); }
        return;
      }
      if (act === 'preview-bg') {
        const url = (base.background_change || '').trim();
        const host = document.getElementById('bp-bg-prev');
        if (!url) return Admin.toast('先填背景图路径', 'info');
        host.innerHTML = `<img src="${esc(url)}" style="width:100%;border-radius:4px;border:1px solid var(--border)" onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'图片加载失败',style:'font-size:10px;color:#ff8b8b'}))">`;
        return;
      }
      if (act === 'demo') {
        if (ctx.demoNode) ctx.demoNode(base.id, base.title);
        return;
      }
      if (act === 'del-node') {
        if (!(await Admin.confirm('确定删除这个节点？对白和选项会一起删除。'))) return;
        try {
          await Admin.del(`/story/nodes/${base.id}`);
          Admin.toast('节点已删除', 'success');
          close();
          await ctx.refresh();
        } catch (err) { Admin.toast('删除失败: ' + err.message, 'error'); }
        return;
      }
      if (act === 'save') return saveNode();
    };
  }

  async function saveNode() {
    if (busy) return;
    busy = true;
    const btn = box().querySelector('[data-act="save"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const nid = base.id;
      // 全量提交（后端 update_node 会覆盖所有字段）
      const payload = {
        chapter_id: Number(base.chapter_id),
        scene_id: num(base.scene_id),
        node_type: base.node_type || 'dialogue',
        title: base.title || null,
        speaker_id: num(base.speaker_id),
        content: base.content || null,
        content_image: base.content_image || null,
        expression: base.expression || null,
        position: base.position || null,
        multi_characters: base.multi_characters || null,
        bgm: base.bgm || null,
        background_change: base.background_change || null,
        bg_animation_effect_id: num(base.bg_animation_effect_id),
        is_key_node: base.is_key_node ? 1 : 0,
        order_index: Number(base.order_index) || 0,
        tags: base.tags || null,
        category_path: base.category_path || null,
        battle_config: base.battle_config || null,
        import_batch_id: num(base.import_batch_id),
      };
      await Admin.put(`/story/nodes/${nid}`, payload);

      // ---- 对白 diff ----
      const oldIds = new Set((full.dialogues || []).map(d => d.id));
      const keep = new Set(dlg.filter(d => d.id).map(d => d.id));
      for (const id of oldIds) if (!keep.has(id)) await Admin.del(`/story/nodes/${nid}/dialogues/${id}`);

      const ordered = [];
      for (let i = 0; i < dlg.length; i++) {
        const d = dlg[i];
        const body = {
          order_index: i,
          speaker_id: num(d.speaker_id),
          content: d.content || null,
          expression: d.expression || null,
          pose_extra: d.pose_extra || null,
          pos_x: d.pos_x === '' || d.pos_x == null ? 50 : Number(d.pos_x),
          pos_y: d.pos_y === '' || d.pos_y == null ? 0 : Number(d.pos_y),
          scale: d.scale === '' || d.scale == null ? 1 : Number(d.scale),
          crop_top: d.crop_top === '' || d.crop_top == null ? 0 : Number(d.crop_top),
          crop_bottom: d.crop_bottom === '' || d.crop_bottom == null ? 100 : Number(d.crop_bottom),
          flip: Number(d.flip) ? 1 : 0,
          z_index: d.z_index === '' || d.z_index == null ? 1 : Number(d.z_index),
          disappear_after: Number(d.disappear_after) ? 1 : 0,
          animation_effect_id: num(d.animation_effect_id),
          voice: d.voice || null,
          bg_change: d.bg_change || null,
          bgm: d.bgm || null,
        };
        if (d.id) {
          try {
            await Admin.put(`/story/nodes/${nid}/dialogues/${d.id}`, body);
            ordered.push(d.id);
          } catch (err) {
            // 这一句在别处被删了：自动重建，别让整次保存失败
            if (/对话不存在|404/.test(err.message)) {
              const r = await Admin.post(`/story/nodes/${nid}/dialogues`, body);
              d.id = r.id;
              ordered.push(r.id);
            } else throw err;
          }
        } else {
          const r = await Admin.post(`/story/nodes/${nid}/dialogues`, body);
          d.id = r.id;
          ordered.push(r.id);
        }
      }
      if (ordered.length) await Admin.post(`/story/nodes/${nid}/dialogues/reorder`, { ordered_ids: ordered });

      // ---- 选项 diff ----
      const oldCh = new Set((full.choices || []).map(c => c.id));
      const keepCh = new Set(chs.filter(c => c.id).map(c => c.id));
      for (const id of oldCh) if (!keepCh.has(id)) await Admin.del(`/story/choices/${id}`);
      for (const c of chs) {
        const body = {
          node_id: nid,
          choice_text: (c.choice_text || '').trim() || '（未命名选项）',
          next_node_id: num(c.next_node_id),
          condition_group: c.condition_group || null,
          effects: c.effects || null,
          is_hidden: Number(c.is_hidden) ? 1 : 0,
        };
        if (c.id) {
          try {
            await Admin.put(`/story/choices/${c.id}`, body);
          } catch (err) {
            // 缓存里的选项在别处被删了：重建，避免 404 卡住整次保存
            if (/选项不存在|404/.test(err.message)) await Admin.post('/story/choices', body);
            else throw err;
          }
        } else await Admin.post('/story/choices', body);
      }

      Admin.toast('已保存，蓝图与列表同步', 'success');
      await ctx.refresh(base.id);
    } catch (e) {
      console.error(e);
      Admin.toast('保存失败: ' + e.message, 'error');
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  }

  /* ================= 章节 ================= */
  async function openChapter(id) {
    loading('章节');
    try {
      const c = ctx.chapters.find(x => x.id === id) || await Admin.get(`/story/chapters/${id}`);
      base = { ...c };
      const arcOpts = opt(ctx.arcs.map(a => [a.id, a.title]), base.story_arc_id, '（独立章节）');
      box().innerHTML = `
        <div class="bp-ins-head">
          <span class="bp-kind-tag" style="background:var(--accent)">章节</span>
          <b>第${base.chapter_order}章 ${esc(base.title || '')}</b>
          <button class="bp-mini-btn" data-act="close">✕</button>
        </div>
        <div class="bp-field"><label>章节标题</label><input type="text" data-model="base.title" value="${esc(base.title || '')}"></div>
        <div class="bp-grid2">
          <div class="bp-field"><label>所属故事</label><select data-model="base.story_arc_id">${arcOpts}</select></div>
          <div class="bp-field"><label>章节序号</label><input type="number" data-model="base.chapter_order" value="${base.chapter_order ?? 0}"></div>
        </div>
        <div class="bp-field"><label>描述</label><textarea data-model="base.description">${esc(base.description || '')}</textarea></div>
        <div class="bp-field"><label>封面图</label><input type="text" data-model="base.image" value="${esc(base.image || '')}"></div>
        <div class="bp-grid2">
          <div class="bp-field"><label>是否主线</label><select data-model="base.is_main_story">${opt([['1','是'],['0','否']], base.is_main_story ?? 1)}</select></div>
          <div class="bp-field"><label>前置章节</label><select data-model="base.prerequisite_chapter_id">${opt(ctx.chapters.filter(x => x.id !== base.id).map(x => [x.id, '第' + x.chapter_order + '章 ' + x.title]), base.prerequisite_chapter_id, '（无）')}</select></div>
        </div>
        <div class="bp-field"><label>分类路径</label><input type="text" data-model="base.category_path" value="${esc(base.category_path || '')}"></div>
        <div style="font-size:10.5px;color:var(--text-muted);margin:6px 0 2px">该章共 ${ctx.nodes.filter(n => n.chapter_id === id).length} 个节点。拖动画布上的连线可把节点移到别的章节。</div>
        <div class="bp-ins-footer">
          <button class="bp-btn-xs danger" data-act="del">删除章节</button>
          <button class="btn btn-primary btn-sm" data-act="save">保存</button>
        </div>`;
      bindSimple('chapter', id);
    } catch (e) {
      box().innerHTML = `<div class="bp-ins-empty">载入失败：${esc(e.message)}</div>`;
    }
  }

  /* ================= 故事 ================= */
  async function openArc(id) {
    loading('故事');
    try {
      const a = ctx.arcs.find(x => x.id === id) || await Admin.get(`/story-arcs/${id}`);
      base = { ...a };
      box().innerHTML = `
        <div class="bp-ins-head">
          <span class="bp-kind-tag" style="background:var(--gold)">故事</span>
          <b>${esc(base.title || '')}</b>
          <button class="bp-mini-btn" data-act="close">✕</button>
        </div>
        <div class="bp-field"><label>故事标题</label><input type="text" data-model="base.title" value="${esc(base.title || '')}"></div>
        <div class="bp-field"><label>描述</label><textarea data-model="base.description">${esc(base.description || '')}</textarea></div>
        <div class="bp-field"><label>封面图</label><input type="text" data-model="base.image" value="${esc(base.image || '')}"></div>
        <div class="bp-grid2">
          <div class="bp-field"><label>排序</label><input type="number" data-model="base.order_index" value="${base.order_index ?? 0}"></div>
          <div class="bp-field"><label>启用</label><select data-model="base.is_active">${opt([['1','是'],['0','否']], base.is_active ?? 1)}</select></div>
        </div>
        <div class="bp-field"><label>分类路径</label><input type="text" data-model="base.category_path" value="${esc(base.category_path || '')}"></div>
        <div style="font-size:10.5px;color:var(--text-muted);margin:6px 0 2px">该故事下 ${ctx.chapters.filter(c => c.story_arc_id === id).length} 章。把章节拖到别的故事卡上即可改归属。</div>
        <div class="bp-ins-footer">
          <button class="bp-btn-xs danger" data-act="del">删除故事</button>
          <button class="btn btn-primary btn-sm" data-act="save">保存</button>
        </div>`;
      bindSimple('arc', id);
    } catch (e) {
      box().innerHTML = `<div class="bp-ins-empty">载入失败：${esc(e.message)}</div>`;
    }
  }

  function bindSimple(kind, id) {
    const el = box();
    el.oninput = (e) => {
      const p = e.target.dataset.model;
      if (p && p.startsWith('base.')) base[p.slice(5)] = e.target.value;
    };
    el.onchange = (e) => {
      const p = e.target.dataset.model;
      if (!p || !e.target.tagName === 'SELECT') return;
      if (e.target.tagName === 'SELECT') {
        const v = e.target.value;
        base[p.slice(5)] = v === '' ? null : (p.endsWith('_id') || p.endsWith('_order') || p.endsWith('order_index') || p.endsWith('is_main_story') || p.endsWith('is_active') ? Number(v) : v);
      }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') return close();
      if (b.dataset.act === 'save') {
        try {
          if (kind === 'chapter') {
            await Admin.put(`/story/chapters/${id}`, {
              title: base.title, story_arc_id: num(base.story_arc_id), chapter_order: Number(base.chapter_order) || 0,
              description: base.description || null, image: base.image || null,
              is_main_story: Number(base.is_main_story), prerequisite_chapter_id: num(base.prerequisite_chapter_id),
              category_path: base.category_path || null,
            });
          } else {
            await Admin.put(`/story-arcs/${id}`, {
              title: base.title, description: base.description || null, image: base.image || null,
              order_index: Number(base.order_index) || 0, is_active: Number(base.is_active),
              category_path: base.category_path || null,
            });
          }
          Admin.toast('已保存', 'success');
          await ctx.refresh(kind === 'chapter' ? null : id);
        } catch (err) { Admin.toast('保存失败: ' + err.message, 'error'); }
        return;
      }
      if (b.dataset.act === 'del') {
        if (!(await Admin.confirm('确定删除？其下内容也会一并删除。'))) return;
        try {
          await Admin.del(kind === 'chapter' ? `/story/chapters/${id}` : `/story-arcs/${id}`);
          Admin.toast('已删除', 'success');
          close();
          await ctx.refresh();
        } catch (err) { Admin.toast('删除失败: ' + err.message, 'error'); }
      }
    };
  }

  return { open, close, isOpen: () => !!sel };
})();
