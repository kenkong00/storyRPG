// ========== 后台任务监视器（无界面，只负责轮询与广播） ==========
// 解决的问题：点「生成 10 个战斗动作」之后，切到别的栏目就完全不知道 ComfyUI
// 还在后台跑，也不会知道已经出完了；回来还得刷新页面才看见图。
//
// 现在（2026-10-28 改）：
//   · 左侧栏底部那排任务卡【已移除】—— 顶栏已经有任务中心图标 + 右侧抽屉，
//     两处都显示同一批任务，重复且占地方；
//   · 本模块退居幕后：只做一件事 —— 全局唯一地轮询 /api/jobs，
//     把结果用 'jobs:update' 事件广播出去（顶栏任务中心、各页面面板都订阅它），
//     并在任务状态翻转时弹一条 toast + 发 'job:finished' 让当前页立刻刷新。
//   · 页面不要各自再开轮询，统一听这个事件。
(function () {
  if (window.JobMonitor) return;

  const S = {
    jobs: [],
    seen: {},            // id -> status，用来识别「刚刚完成」
    timer: null,
    booted: false,
    lastError: '',
  };

  // 页面注册「被任务定位时怎么打开」，例如人物管理收到 focus.character_id 就打开该人物
  const focusHandlers = {};
  window.PageFocus = {
    set(page, fn) { focusHandlers[page] = fn; },
    get(page) { return focusHandlers[page]; },
    async run(job) {
      if (!job || !job.page) return;
      try { await Admin.navigate(job.page); } catch (e) { /* 忽略 */ }
      // 目标页可能在渲染末尾才注册处理器，所以延迟到下一帧再取
      setTimeout(() => {
        const fn = focusHandlers[job.page] || window.__charFocusHandler;
        if (typeof fn !== 'function') return;
        try { fn(job.focus || {}, job); } catch (e) { console.warn(e); }
      }, 120);
    },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 左侧栏任务卡已移除（顶栏任务中心已覆盖）；这里只负责把残留节点清掉
  function ensureHost() { return null; }

  function render() {
    const old = document.getElementById('job-monitor');
    if (old) old.remove();
    const st = document.getElementById('jm-style-tag');
    if (st) st.remove();
  }

  function toastTransitions() {
    S.jobs.forEach((j) => {
      const prev = S.seen[j.id];
      S.seen[j.id] = j.status;
      if (prev === 'running' && j.status !== 'running') {
        const ok = j.status === 'done' || j.status === 'partial';
        Admin.toast(
          `${j.title}：${ok ? '已生成 ' + j.done + ' 张' : '失败'}` +
          (j.failed ? `（${j.failed} 张失败）` : ''),
          ok ? 'success' : 'error'
        );
        // 让当前页自己刷新（图立刻出现，不用手动刷新）
        document.dispatchEvent(new CustomEvent('job:finished', { detail: j }));
      }
    });
  }

  async function fetchNow() {
    try {
      const r = await Admin.get('/jobs');
      S.jobs = r.jobs || [];
      toastTransitions();
      render();
      // 广播给页面内各面板，跟着任务进度自己刷新（不用各自写轮询）
      document.dispatchEvent(new CustomEvent('jobs:update', { detail: S.jobs }));
      return S.jobs;
    } catch (e) {
      S.lastError = String(e && e.message || e);
      console.warn('[JobMonitor] 拉取任务失败:', e);
      return null;
    }
  }

  function schedule() {
    clearTimeout(S.timer);
    const running = S.jobs.some((j) => j.status === 'running');
    S.timer = setTimeout(async () => {
      await fetchNow();
      schedule();
    }, running ? 2000 : 5000);
  }

  // 全局钩子：任何地方一提交出图请求（返回里有 job_id），左侧栏立刻出现任务卡，
  // 不用等下一次轮询。以后新增出图入口也自动生效，不必再各自补一行。
  function hookAdmin() {
    if (!window.Admin || Admin.__jmHooked) return;
    Admin.__jmHooked = true;
    const rawPosts = {};
    ['post', 'put'].forEach((m) => {
      if (typeof Admin[m] !== 'function') return;
      rawPosts[m] = Admin[m].bind(Admin);
      Admin[m] = async function (path, data) {
        const r = await rawPosts[m](path, data);
        if (r && (r.job_id || r.job)) {
          fetchNow().then(() => schedule());
        }
        return r;
      };
    });
  }

  function boot() {
    if (S.booted) return;
    S.booted = true;
    hookAdmin();
    fetchNow().then(() => schedule());
    // 页面隐藏时别空转轮询
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) fetchNow();
    });
  }

  window.JobMonitor = {
    boot,
    refresh: fetchNow,
    jobs: () => S.jobs.slice(),
    lastError: () => S.lastError,
    runningFor: (kind) => S.jobs.filter((j) => j.status === 'running' && (!kind || j.kind === kind)),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
