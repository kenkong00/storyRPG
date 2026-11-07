// ========== 剧情演出设置（前台共用） ==========
// 服务端 /api/story/settings 存全站默认值（后台「设置 → 剧情管理」改的就是它），
// 玩家在自己浏览器里调的只写 localStorage，不污染别人的默认值。
//
// 优先级：本地覆盖 > 服务端默认 > 内置兜底。
// 之所以要内置兜底：后端没起来 / 首次加载还没回来时，画面不能一帧都不对。
(function () {
  if (window.ShowSettings) return;

  const LS_KEY = 'rpg_story_overrides';

  // 与后端 DEFAULT_STORY_SETTINGS 保持一致
  const FALLBACK = {
    stage_focus_mode: 'subtle',
    dim_brightness: 0.84,
    dim_saturate: 0.88,
    speak_brightness: 1.07,
    speak_saturate: 1.03,
    speak_glow: 0,
    focus_transition_ms: 260,
    auto_play_default: false,
    auto_play_delay_ms: 900,
    auto_play_stop_on_choice: true,
  };

  // 三个快捷档位：选档 = 一次填好下面对应的细粒度参数。
  // 「自定义」不在这里，它是用户手动拖出来的结果。
  const PRESETS = {
    subtle: {
      dim_brightness: 0.84, dim_saturate: 0.88,
      speak_brightness: 1.07, speak_saturate: 1.03, speak_glow: 0,
    },
    normal: {
      dim_brightness: 0.72, dim_saturate: 0.8,
      speak_brightness: 1.12, speak_saturate: 1.05, speak_glow: 0,
    },
    strong: {
      dim_brightness: 0.6, dim_saturate: 0.72,
      speak_brightness: 1.18, speak_saturate: 1.12, speak_glow: 45,
    },
  };

  const S = {
    server: {},
    local: {},
    loaded: false,
    loading: null,
  };

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function writeLocal(o) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(o || {})); } catch (e) { /* ignore */ }
  }

  function get() {
    return Object.assign({}, FALLBACK, S.server, S.local);
  }

  async function load(force) {
    if (S.loaded && !force) return get();
    if (S.loading && !force) return S.loading;
    S.local = readLocal();
    S.loading = (async () => {
      try {
        const r = await fetch('/api/story/settings', { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          if (d && d.settings) S.server = d.settings;
        }
      } catch (e) {
        // 后端没起：用兜底值继续跑，别让画面挂掉
      }
      S.loaded = true;
      return get();
    })();
    return S.loading;
  }

  /** 玩家本机修改（不写服务端） */
  function setLocal(patch) {
    S.local = Object.assign({}, S.local, patch || {});
    writeLocal(S.local);
    applyCss();
    return get();
  }

  function clearLocal() {
    S.local = {};
    writeLocal({});
    applyCss();
    return get();
  }

  /** 选一个快捷档位：把预设数值灌进本地覆盖，并记下档位名 */
  function applyPreset(key) {
    if (key === 'off') return setLocal({ stage_focus_mode: 'off' });
    const p = PRESETS[key];
    if (!p) return get();
    return setLocal(Object.assign({ stage_focus_mode: key }, p));
  }

  /**
   * 算说话者 / 其他人的 CSS 滤镜。
   * 只做亮度与饱和，不做透明度 —— 半透明的立绘会和背景叠色，看着像糊了。
   * 注意：内联 filter 会覆盖 CSS 里的基础落地投影，所以这里把基础阴影一起带上，
   * 否则一开高亮，立绘就像浮在半空。
   */
  const BASE_SHADOW = 'drop-shadow(0 -8px 40px rgba(0,0,0,0.6))';

  function focusStyle() {
    const s = get();
    if (s.stage_focus_mode === 'off') return { dim: '', speak: '' };
    const dim = `brightness(${s.dim_brightness}) saturate(${s.dim_saturate}) ${BASE_SHADOW}`;
    let speak = `brightness(${s.speak_brightness}) saturate(${s.speak_saturate}) ${BASE_SHADOW}`;
    const glow = Number(s.speak_glow) || 0;
    if (glow > 0) {
      const blur = Math.round(glow * 0.18);
      const alpha = (glow / 100 * 0.5).toFixed(2);
      speak += ` drop-shadow(0 0 ${blur}px rgba(212,175,55,${alpha}))`;
    }
    return { dim, speak };
  }

  /** 把过渡时长同步到 CSS 变量，改设置立刻生效，不用等下一句 */
  function applyCss() {
    const s = get();
    const root = document.documentElement;
    if (root) root.style.setProperty('--stage-transition', (Number(s.focus_transition_ms) || 0) + 'ms');
  }

  window.ShowSettings = {
    FALLBACK, PRESETS,
    load, get, setLocal, clearLocal, applyPreset, focusStyle, applyCss,
    /** 后台/服务端保存后回灌，避免还要刷新页面 */
    setServer(d) { if (d) S.server = d; S.loaded = true; },
  };
})();
