// ========== 可搜索下拉框（全局通用） ==========
// 解决的两件事：
//   1) <datalist> 的原生下拉又白又窄，模型/LoRA 的长路径根本看不全，右边的下拉箭头
//      还会吞掉点击；
//   2) 几百个模型时纯 select 翻起来要命。
// 现在的行为：输入框 + ▾ 按钮（真的点得开），弹层宽度取「输入框宽度的 2 倍或 420px」，
// 长路径换行显示完整，输入即筛选（包含匹配），↑↓ 选择、回车确认、Esc 关闭。
//
// 用法 A（显式创建）：
//   Combo.create(container, { value, options, placeholder, onChange })
// 用法 B（就地升级已有表单，保留原 id/name，业务代码零改动）：
//   Combo.upgradeDatalists(document.querySelector('.modal-body'))
(function () {
  if (window.Combo) return;

  let pop = null;        // 全局唯一的弹层
  let cur = null;        // 当前打开弹层的实例

  function ensureStyle() {
    if (document.getElementById('cb-style-tag')) return;
    const s = document.createElement('style');
    s.id = 'cb-style-tag';
    s.textContent = `
      .cb-wrap{display:flex;align-items:stretch;gap:0;position:relative;min-width:0;width:100%}
      .cb-wrap>input{flex:1;min-width:0;border-top-right-radius:0;border-bottom-right-radius:0}
      .cb-btn{flex:0 0 26px;width:26px;display:flex;align-items:center;justify-content:center;
        border:1px solid var(--border);border-left:none;border-top-right-radius:var(--radius,4px);
        border-bottom-right-radius:var(--radius,4px);background:var(--bg-input,#1a1a1a);
        color:var(--text-muted);cursor:pointer;font-size:10px;user-select:none;padding:0}
      .cb-btn:hover{color:var(--gold);border-color:var(--gold)}
      .cb-pop{position:fixed;z-index:99999;background:var(--bg-card,#17171b);border:1px solid var(--gold);
        border-radius:6px;box-shadow:0 12px 34px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column}
      .cb-pop .h{font-size:10px;color:var(--text-muted);padding:5px 9px;border-bottom:1px solid var(--border);
        background:rgba(255,255,255,.03);display:flex;gap:8px;align-items:center}
      .cb-pop .l{overflow:auto;max-height:340px}
      .cb-item{font-size:12px;line-height:1.45;padding:5px 9px;cursor:pointer;color:var(--text-primary);
        word-break:break-all;border-left:2px solid transparent}
      .cb-item:hover,.cb-item.on{background:rgba(201,168,76,.14);border-left-color:var(--gold)}
      .cb-item .hl{color:var(--gold);font-weight:600}
      .cb-item .dim{color:var(--text-muted);font-size:10px;margin-left:6px}
      .cb-empty{font-size:12px;color:var(--text-muted);padding:12px;text-align:center}
    `;
    document.head.appendChild(s);
  }

  function ensurePop() {
    ensureStyle();
    if (pop && document.body.contains(pop)) return pop;
    pop = document.createElement('div');
    pop.className = 'cb-pop';
    pop.style.display = 'none';
    pop.innerHTML = '<div class="h"><span class="cnt"></span></div><div class="l"></div>';
    document.body.appendChild(pop);
    // 点弹层外部关闭（用 mousedown 捕获，避免与输入框失焦打架）
    document.addEventListener('mousedown', (e) => {
      if (!pop || pop.style.display === 'none') return;
      if (pop.contains(e.target)) return;
      if (cur && cur.wrap.contains(e.target)) return;
      close();
    }, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', (e) => {
      if (!pop || pop.style.display === 'none') return;
      if (pop.contains(e.target)) return;
      close();
    }, true);
    return pop;
  }

  function close() {
    if (pop) pop.style.display = 'none';
    if (cur) cur.items = cur.items || [];
    cur = null;
  }

  function hl(text, kw) {
    const t = String(text == null ? '' : text);
    if (!kw) return escapeHtml(t);
    const i = t.toLowerCase().indexOf(kw.toLowerCase());
    if (i < 0) return escapeHtml(t);
    return escapeHtml(t.slice(0, i)) + '<span class="hl">' + escapeHtml(t.slice(i, i + kw.length)) +
      '</span>' + escapeHtml(t.slice(i + kw.length));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------- 实例 ----------------
  function attach(input, getOptions, opts) {
    opts = opts || {};
    ensureStyle();
    let wrap = input.closest('.cb-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'cb-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('div');
      btn.className = 'cb-btn';
      btn.title = '展开全部选项';
      btn.textContent = '▼';
      wrap.appendChild(btn);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pop && pop.style.display !== 'none' && cur && cur.input === input) { close(); return; }
        input.focus();
        open();
      });
    }
    const inst = { input, wrap, getOptions, opts, typed: false };

    // typed 用来区分「用户正在输入筛选」和「只是点开了下拉」：
    // 像「模型方案」这种有预填值的框，聚焦时若拿当前值当关键词，
    // 展开就只剩它自己那一项 —— 看着像"只有一个方案可选"。
    input.addEventListener('input', () => { inst.typed = true; window.__lastCb = inst; open(inst); });
    input.addEventListener('focus', () => { inst.typed = false; window.__lastCb = inst; open(inst); });
    input.addEventListener('blur', () => { inst.typed = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (!pop || pop.style.display === 'none') {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(inst); }
        return;
      }
      const items = [...pop.querySelectorAll('.cb-item')];
      let idx = items.findIndex((x) => x.classList.contains('on'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = Math.min(items.length - 1, idx + 1);
        items.forEach((x, i) => x.classList.toggle('on', i === idx));
        items[idx] && items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = Math.max(0, idx - 1);
        items.forEach((x, i) => x.classList.toggle('on', i === idx));
        items[idx] && items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (idx >= 0 && items[idx]) {
          e.preventDefault();
          pick(items[idx].dataset.v);
        }
      }
    });
    input._cb = inst;
    return inst;
  }

  function pick(val) {
    if (!cur) return;
    const inst = cur;
    inst.input.value = val == null ? '' : val;
    inst.typed = false;   // 选中后立刻收起，别再用这个值去二次过滤
    inst.input.dispatchEvent(new Event('input', { bubbles: true }));
    inst.input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    if (inst.opts.onChange) inst.opts.onChange(inst.input.value);
  }

  function open(explicit) {
    const src = explicit || (document.activeElement && document.activeElement._cb) || window.__lastCb;
    if (!src) return;
    cur = src;
    ensurePop();
    // 只有用户真的敲了字才按关键词过滤；刚聚焦 / 点箭头展开时列出全部
    const kw = src.typed ? String(src.input.value || '').trim() : '';
    const all = src.getOptions() || [];
    const list = kw ? all.filter((v) => String(v).toLowerCase().includes(kw.toLowerCase())) : all;

    const r = src.wrap.getBoundingClientRect();
    const width = Math.max(r.width * 2, 420);
    pop.style.width = Math.min(width, window.innerWidth - 24) + 'px';
    pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - Math.min(width, window.innerWidth - 24) - 12) + 'px';
    const h = Math.min(360, 40 + list.length * 30);
    if (r.bottom + h > window.innerHeight - 8 && r.top > h) {
      pop.style.top = Math.max(8, r.top - h - 2) + 'px';
    } else {
      pop.style.top = (r.bottom + 2) + 'px';
    }
    pop.querySelector('.cnt').textContent =
      `共 ${all.length} 项` + (kw ? `，筛选出 ${list.length} 项` : '') + '（输入可筛选，↑↓ 选择，回车确认）';
    pop.querySelector('.l').innerHTML = list.length
      ? list.map((v) => `<div class="cb-item${v === src.input.value ? ' on' : ''}" data-v="${escapeHtml(v)}">${hl(v, kw)}</div>`).join('')
      : '<div class="cb-empty">没有匹配项（可直接手填路径）</div>';
    pop.querySelectorAll('.cb-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(el.dataset.v); });
      el.addEventListener('mouseenter', () => {
        pop.querySelectorAll('.cb-item').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
      });
    });
    pop.style.display = 'flex';
  }

  // 记录最近聚焦的 combo 输入框（open() 里用）
  document.addEventListener('focusin', (e) => {
    if (e.target && e.target._cb) window.__lastCb = e.target._cb;
  });

  // ---------------- 对外 ----------------
  function create(container, opts) {
    opts = opts || {};
    ensureStyle();
    container.innerHTML = `<input type="text" class="${opts.inputClass || ''}"
      placeholder="${escapeHtml(opts.placeholder || '输入可筛选…')}" value="${escapeHtml(opts.value || '')}">`;
    const input = container.querySelector('input');
    const inst = attach(input, () => opts.options || [], opts);
    inst.setOptions = (arr) => { opts.options = arr || []; };
    inst.setValue = (v) => { input.value = v == null ? '' : v; };
    inst.getValue = () => input.value.trim();
    inst.setDisabled = (b) => { input.disabled = !!b; };
    return inst;
  }

  /** 把 root 里所有 <input list="xxx"> 就地升级（保留 id / name / value，业务代码不用改） */
  function upgradeDatalists(root) {
    if (!root) return 0;
    let n = 0;
    root.querySelectorAll('input[list]').forEach((input) => {
      const dl = document.getElementById(input.getAttribute('list'));
      const options = dl ? [...dl.querySelectorAll('option')].map((o) => o.value).filter(Boolean) : [];
      input.removeAttribute('list');
      attach(input, () => options, {});
      n += 1;
    });
    return n;
  }

  window.Combo = { create, attach, upgradeDatalists, close, escapeHtml };
})();
