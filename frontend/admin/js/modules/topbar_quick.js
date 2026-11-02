// ========== 顶栏快捷图标：设置 / 提示词管理 / 图片管理 ==========
// 原入口在左侧栏「工具」分组，位置靠下不好找。这里把它们做成 SVG 图标放到
// 顶栏右侧、任务中心图标之前，点击直达对应页面。
(function () {
  const ICONS = {
    settings: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    prompt: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="8.6" cy="10" r="1.6"/><path d="M4.5 18l4.5-4.2L12 16.5l3.2-2.6L20 18"/></svg>',
    sound: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l9-2v12"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="15.5" cy="16" r="2.6"/></svg>',
    demo: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 3.6l6 6"/><path d="M20.4 3.6l-6 6"/><path d="M14.4 9.6L20.4 3.6"/><path d="M9.6 9.6L3.6 3.6"/><path d="M8.2 8.2l7.6 7.6"/><path d="M5.6 14.4l4 4"/><path d="M18.4 14.4l-4 4"/><path d="M12 12l-1.2 1.2"/></svg>',
  };
  // 「对战演示」排在最前面，且颜色单独一套（红金），一眼就能找到
  const ITEMS = [
    { id: 'tb-carddemo', page: 'cards', tab: 'demo', title: '对战演示 · 立刻开一局', demo: true },
    { id: 'tb-settings', page: 'settings', title: '设置' },
    { id: 'tb-prompt', page: 'prompt_lib', title: '提示词管理' },
    { id: 'tb-image', page: 'images', title: '图片管理' },
    { id: 'tb-sound', page: 'sounds', title: '声音管理' },
  ];
  const iconFor = (it) => {
    if (it.demo) return ICONS.demo;
    const p = it.page;
    return p === 'prompt_lib' ? ICONS.prompt
      : (p === 'images' ? ICONS.image : (p === 'sounds' ? ICONS.sound : ICONS.settings));
  };

  function syncActive(page) {
    document.querySelectorAll('.tb-quick').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === page);
    });
  }

  function mount() {
    const slot = document.querySelector('.topbar-actions');
    if (!slot || document.getElementById('tb-settings')) return;
    const hub = document.getElementById('task-hub');
    const frag = document.createDocumentFragment();
    const sep = document.createElement('span');
    sep.className = 'tb-sep';
    frag.appendChild(sep);
    ITEMS.forEach((it) => {
      const b = document.createElement('button');
      b.id = it.id;
      b.className = 'tb-round tb-quick' + (it.demo ? ' tb-demo' : '');
      b.type = 'button';
      b.title = it.title;
      b.dataset.page = it.page;
      if (it.tab) b.dataset.tab = it.tab;
      b.innerHTML = iconFor(it);
      b.addEventListener('click', () => {
        if (typeof Admin === 'undefined') return;
        // 带 tab 的（对战演示）：先记住要落到哪个分页，再进卡牌系统
        if (it.tab) {
          try { localStorage.setItem('cg_tab', it.tab); } catch (_) {}
          if (Admin.currentPage === it.page && window.CardGameTabs) {
            window.CardGameTabs.goto(it.tab);
            syncActive(it.page);
            return;
          }
        }
        Admin.navigate(it.page);
      });
      frag.appendChild(b);
    });
    slot.insertBefore(frag, hub || slot.firstChild);

    // 让快捷图标的选中态跟随页面切换（包装 Admin.navigate 一并同步）
    if (typeof Admin !== 'undefined' && typeof Admin.navigate === 'function' && !Admin.__quickWrapped) {
      const _nav = Admin.navigate.bind(Admin);
      // 必须把 opts 原样透传：各栏目出图参数的 ⚙ 就是靠 navigate(page, {params}) 跳转的，
      // 这里只收 page 会把参数吞掉（之前「齿轮跳过去没选中方案」就是被这层包装吃掉的）。
      Admin.navigate = function (page, opts) {
        const r = _nav(page, opts);
        syncActive(page);
        return r;
      };
      Admin.__quickWrapped = true;
    }
    syncActive((typeof Admin !== 'undefined' && Admin.currentPage) || '');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
