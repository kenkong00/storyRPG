// ========== 共享：角色语音卡片网格（平铺 + 点击试听） ==========
//
// 一处实现，三处复用：
//   1. 「角色语音库」平铺页面（voice_library.js）
//   2. 批量导入里每个角色 / 旁白选音色的弹窗（story.js → openVoicePicker）
//   3. 对话列表每句 🎙 语音生成弹窗里的音色选择（story.js → openVoicePop）
//
// 设计要点（对照 Windows 轻量 AI 桌面助手「语音设置 → 角色语音非常多」）：
//   · 所有音色（普通话 / 方言 / 地区口音 / 多语言 / 派生角色声线 / 本机）平铺成卡片；
//   · 每张卡：头像（按性别取色）+ 名称 + 性别/年龄/风格徽章 + 分类标签 + 备注 + ▶ 试听；
//   · 顶部筛选：搜索（名称/备注/风格）、性别、年龄、分类，随手收窄；
//   · 点击卡片 = 选中（onPick），当前选中高亮描边；点 ▶ = 合成试听，再点 = 停；
//   · 派生声线（如「苍老长者 = 云健·语速-20% 音调-32%」）会显示来源，试听时
//     后端 provider 自动把 rate/pitch 偏移叠加上去，老人声线真的会变老。
//
// 不写死任何提示词 / 音色字面量——数据全部来自 /api/tts/voices?grouped=true。
(function () {
  const SAMPLE = '前方似有埋伏，公子小心。';
  let _audio = null;
  function stopAudio() {
    if (_audio) { try { _audio.pause(); } catch (_) {} _audio = null; }
  }
  function playUrl(url, onEnd) {
    stopAudio();
    _audio = new Audio(url);
    _audio.onended = () => { _audio = null; if (onEnd) onEnd(); };
    _audio.play().catch(() => { _audio = null; if (onEnd) onEnd(); });
  }

  const GENDER = { male: { t: '男', c: '#3B82F6' }, female: { t: '女', c: '#EC4899' }, unknown: { t: '·', c: '#94A3B8' } };
  const AGE = { adult: '成人', child: '儿童', elder: '老人' };
  const GROUP = {
    standard: '普通话', dialect: '方言', regional: '地区口音',
    multilingual: '多语言', role: '角色声线', unknown: '其它',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectStyle() {
    if (document.getElementById('vg-style')) return;
    const st = document.createElement('style');
    st.id = 'vg-style';
    st.textContent = `
      .vg{display:flex;flex-direction:column;gap:12px}
      .vg-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .vg-search{flex:1;min-width:160px;padding:7px 11px;background:var(--bg-input);
        border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px}
      .vg-chip{padding:5px 12px;border:1px solid var(--border);border-radius:999px;
        background:var(--bg-input);color:var(--text-muted);font-size:12px;cursor:pointer;
        user-select:none;white-space:nowrap;transition:.12s}
      .vg-chip:hover{border-color:var(--gold);color:var(--text-primary)}
      .vg-chip.on{background:var(--gold);border-color:var(--gold);color:#1A1408;font-weight:600}
      .vg-count{font-size:12px;color:var(--text-muted);margin-left:auto;white-space:nowrap}
      .vg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(186px,1fr));gap:12px}
      .vg-popup .vg-grid{max-height:46vh;overflow:auto;padding:2px}
      .vg-card{position:relative;background:var(--bg-card);border:1px solid var(--border);
        border-radius:12px;padding:12px 12px 10px;cursor:pointer;transition:.14s;overflow:hidden}
      .vg-card:hover{transform:translateY(-2px);border-color:var(--gold);
        box-shadow:0 6px 18px rgba(0,0,0,.28)}
      .vg-card.sel{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold) inset}
      .vg-top{display:flex;align-items:center;gap:10px}
      .vg-av{width:40px;height:40px;border-radius:50%;flex:none;color:#fff;font-weight:700;
        display:flex;align-items:center;justify-content:center;font-size:15px}
      .vg-name{font-size:13.5px;font-weight:600;color:var(--text-primary);line-height:1.25}
      .vg-grp{font-size:10.5px;color:var(--text-muted);margin-top:1px}
      .vg-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}
      .vg-b{font-size:10.5px;padding:1px 7px;border-radius:6px;background:rgba(255,255,255,.06);
        color:var(--text-muted);border:1px solid var(--border)}
      .vg-b.g{color:#fff}
      .vg-note{font-size:11px;color:var(--text-muted);line-height:1.5;margin-top:8px;
        max-height:32px;overflow:hidden}
      .vg-derived{font-size:10.5px;color:#d9b25a;margin-top:6px;line-height:1.4}
      .vg-play{position:absolute;right:9px;bottom:9px;width:30px;height:30px;border-radius:50%;
        border:1px solid var(--border);background:var(--bg-input);color:var(--gold);
        font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;
        transition:.12s}
      .vg-play:hover{background:var(--gold);color:#1A1408;border-color:var(--gold)}
      .vg-play.playing{background:var(--gold);color:#1A1408;border-color:var(--gold);
        animation:vgpulse 1s infinite}
      @keyframes vgpulse{0%{box-shadow:0 0 0 0 rgba(201,168,76,.5)}70%{box-shadow:0 0 0 8px rgba(201,168,76,0)}100%{box-shadow:0 0 0 0 rgba(201,168,76,0)}}
      .vg-empty{padding:26px;text-align:center;color:var(--text-muted);font-size:13px}
    `;
    document.head.appendChild(st);
  }

  function buildFilters(voices) {
    const genders = [{ v: '', t: '全部性别' }].concat(
      [...new Set(voices.map(v => v.gender))].map(g => ({ v: g, t: GENDER[g] ? GENDER[g].t : (g || '未知') })));
    const ages = [{ v: '', t: '全部年龄' }].concat(
      [...new Set(voices.map(v => v.age))].map(a => ({ v: a, t: AGE[a] || a || '未知' })));
    const groups = [{ v: '', t: '全部分类' }].concat(
      [...new Set(voices.map(v => v.group))].map(gr => ({ v: gr, t: GROUP[gr] || gr || '其它' })));
    return { genders, ages, groups };
  }

  function cardHtml(v) {
    const g = GENDER[v.gender] || GENDER.unknown;
    const initial = (v.name || '?').slice(0, 1);
    const badges = [];
    badges.push(`<span class="vg-b g" style="background:${g.c}">${g.t}</span>`);
    if (v.age && AGE[v.age]) badges.push(`<span class="vg-b">${AGE[v.age]}</span>`);
    if (v.style) badges.push(`<span class="vg-b">${esc(v.style)}</span>`);
    let derived = '';
    if (v.derived) {
      const parts = [];
      if (v.base_name) parts.push('基 ' + v.base_name);
      if (v.rate) parts.push('语速' + (v.rate >= 0 ? '+' : '') + v.rate + '%');
      if (v.pitch) parts.push('音调' + (v.pitch >= 0 ? '+' : '') + v.pitch);
      if (parts.length) derived = `<div class="vg-derived">${esc(parts.join(' · '))}</div>`;
    }
    return `
      <div class="vg-card" data-vid="${esc(v.voice_id)}" title="${esc(v.note || v.name)}">
        <div class="vg-top">
          <div class="vg-av" style="background:linear-gradient(135deg,${g.c},${g.c}99)">${esc(initial)}</div>
          <div style="min-width:0">
            <div class="vg-name">${esc(v.name)}</div>
            <div class="vg-grp">${GROUP[v.group] || v.group || '其它'}</div>
          </div>
        </div>
        <div class="vg-badges">${badges.join('')}</div>
        <div class="vg-note">${esc(v.note || '')}</div>
        ${derived}
        <button type="button" class="vg-play" data-play="${esc(v.voice_id)}" title="试听">▶</button>
      </div>`;
  }

  function mount(container, voices, opts) {
    opts = opts || {};
    injectStyle();
    stopAudio();
    const state = {
      voices: voices || [],
      current: opts.current || '',
      onPick: opts.onPick || function () {},
      previewText: opts.previewText || SAMPLE,
      kw: '', gender: '', age: '', group: '',
    };
    const f = buildFilters(state.voices);

    const wrap = document.createElement('div');
    wrap.className = 'vg' + (opts.variant === 'popup' ? ' vg-popup' : '');

    const bar = document.createElement('div');
    bar.className = 'vg-bar';
    bar.innerHTML = `
      <input class="vg-search" placeholder="搜索音色名 / 备注 / 风格…" value="${esc(state.kw)}">
      <span class="vg-chip" data-g="gender">${f.genders.map(x => `<span class="vg-chip${x.v === '' ? ' on' : ''}" data-v="${esc(x.v)}">${esc(x.t)}</span>`).join('')}</span>
      <span class="vg-chip" data-g="age">${f.ages.map(x => `<span class="vg-chip${x.v === '' ? ' on' : ''}" data-v="${esc(x.v)}">${esc(x.t)}</span>`).join('')}</span>
      <span class="vg-chip" data-g="group">${f.groups.map(x => `<span class="vg-chip${x.v === '' ? ' on' : ''}" data-v="${esc(x.v)}">${esc(x.t)}</span>`).join('')}</span>
      <span class="vg-count"></span>`;
    wrap.appendChild(bar);

    const grid = document.createElement('div');
    grid.className = 'vg-grid';
    wrap.appendChild(grid);

    container.appendChild(wrap);

    function filtered() {
      const kw = state.kw.trim().toLowerCase();
      return state.voices.filter(v => {
        if (state.gender && v.gender !== state.gender) return false;
        if (state.age && v.age !== state.age) return false;
        if (state.group && v.group !== state.group) return false;
        if (kw) {
          const hay = ((v.name || '') + ' ' + (v.note || '') + ' ' + (v.style || '') + ' ' + (v.base_name || '')).toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      });
    }

    function paint() {
      const list = filtered();
      const cnt = wrap.querySelector('.vg-count');
      if (cnt) cnt.textContent = `共 ${list.length} / ${state.voices.length} 个音色`;
      if (!list.length) {
        grid.innerHTML = '<div class="vg-empty">没有符合条件的音色</div>';
        return;
      }
      grid.innerHTML = list.map(cardHtml).join('');
      // 选中高亮
      grid.querySelectorAll('.vg-card').forEach(c => {
        const on = c.dataset.vid === state.current;
        c.classList.toggle('sel', on);
      });
    }

    function doPreview(vid) {
      const v = state.voices.find(x => x.voice_id === vid);
      if (!v) return;
      // 注意：paint() 会重建整个网格，之前抓到的按钮节点会失效，
      // 所以标记「正在播」必须在重建之后再重新查一次节点。
      const btn = grid.querySelector(`.vg-play[data-play="${CSS.escape(vid)}"]`);
      if (btn && btn.classList.contains('playing')) {
        stopAudio();
        btn.classList.remove('playing');
        return;
      }
      stopAudio();
      grid.querySelectorAll('.vg-play.playing').forEach(b => b.classList.remove('playing'));
      if (btn) btn.classList.add('playing');
      Admin.post('/tts/synth', {
        text: state.previewText,
        voice_id: vid,
        engine_id: v.engine || '',
      }).then(r => {
        if (r && r.error) { Admin.toast('试听失败：' + r.error, 'error'); stopAudio(); paint(); return; }
        if (!r || !r.url) { Admin.toast('试听没有产出音频', 'error'); stopAudio(); paint(); return; }
        playUrl(r.url, () => {
          const b = grid.querySelector('.vg-play.playing');
          if (b) b.classList.remove('playing');
        });
      }).catch(e => { Admin.toast('试听失败：' + e.message, 'error'); stopAudio(); paint(); });
    }

    // 事件
    bar.querySelector('.vg-search').addEventListener('input', e => { state.kw = e.target.value; paint(); });
    bar.querySelectorAll('.vg-chip').forEach(groupEl => {
      const dim = groupEl.dataset.g;
      groupEl.addEventListener('click', e => {
        const chip = e.target.closest('.vg-chip');
        if (!chip) return;
        const val = chip.dataset.v;
        state[dim] = val;
        groupEl.querySelectorAll('.vg-chip').forEach(c => c.classList.toggle('on', c.dataset.v === val));
        paint();
      });
    });
    grid.addEventListener('click', e => {
      const playBtn = e.target.closest('.vg-play');
      const card = e.target.closest('.vg-card');
      if (playBtn) { e.stopPropagation(); doPreview(playBtn.dataset.play); return; }
      if (card) {
        const vid = card.dataset.vid;
        state.current = vid;
        grid.querySelectorAll('.vg-card').forEach(c => c.classList.toggle('sel', c === card));
        state.onPick(vid);
      }
    });

    paint();

    return {
      el: wrap,
      setCurrent(vid) { state.current = vid || ''; paint(); },
      setPreviewText(t) { state.previewText = t || SAMPLE; },
      preview(vid) { if (vid) doPreview(vid); },
      stop: stopAudio,
      refresh() { paint(); },
      destroy() { stopAudio(); },
    };
  }

  window.VoiceGrid = { mount, stop: stopAudio };
})();
