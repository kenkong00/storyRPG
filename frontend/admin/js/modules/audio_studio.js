// ========== 声音工作室：录制（系统声音 / 麦克风）+ 波形剪辑 ==========
// 录制分两路，按「录制来源」设置自动选：
//  · 系统声音（默认）：后端用 WASAPI 回环直接录扬声器输出 —— 点一下就录，
//    不弹「共享什么」的面板。浏览器做不到这件事：getDisplayMedia 每次都必须让
//    用户手选一个共享对象，这跟「录整个系统的声音」本身没关系，纯属打扰。
//  · 麦克风 / 指定窗口：只能走浏览器。前者 getUserMedia 授权一次就记住；
//    后者是浏览器权限，网页无权替用户选窗口，所以必须弹共享面板。
// 录制完得到 PCM → Web Audio 解码成 AudioBuffer → 波形可视化 +
// 精确选区裁剪、识别裁剪（自动找有声段）、淡入淡出、音量、撤销重做；导出 WAV 上传保存。
const AudioStudio = (function () {
  let ctx = null;
  let state = null; // 当前会话状态
  let overlayEl = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---------- 工具：AudioBuffer <-> 通道数据 ----------
  function bufferFromChannels(channels, sampleRate) {
    const c = ensureCtx();
    const buf = c.createBuffer(channels.length, channels[0].length, sampleRate);
    for (let i = 0; i < channels.length; i++) buf.copyToChannel(channels[i], i);
    return buf;
  }

  // ---------- 工具：AudioBuffer -> WAV(16bit PCM) Blob ----------
  function encodeWAV(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const frames = buffer.length;
    const blockAlign = numCh * 2;
    const dataSize = frames * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);
    const wr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE');
    wr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    wr(36, 'data'); view.setUint32(40, dataSize, true);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  // ---------- 工具：时间格式化 ----------
  function fmt(t) {
    if (!isFinite(t)) return '0.00s';
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2);
    return (m > 0 ? m + ':' + (s.padStart(5, '0')) : s) + 's';
  }

  // ---------- 样式（注入一次） ----------
  function injectStyle() {
    if (document.getElementById('as-style')) return;
    const st = document.createElement('style');
    st.id = 'as-style';
    st.textContent = `
      .as-overlay{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:10000;display:flex;align-items:center;justify-content:center}
      .as-panel{width:94vw;height:90vh;max-width:1400px;background:var(--bg-card,#15161a);border:1px solid var(--border,#2a2c33);
        border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)}
      .as-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border,#2a2c33)}
      .as-head h3{margin:0;font-size:15px;color:var(--text-primary,#e6e6e6)}
      .as-head .as-hint{font-size:11px;color:var(--text-muted,#8a8d96);margin-left:4px}
      .as-body{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
      .as-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .as-sep{width:1px;height:22px;background:var(--border,#2a2c33);margin:0 4px}
      .as-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:6px;font-size:13px;cursor:pointer;
        border:1px solid var(--border,#2a2c33);background:var(--bg-input,#1d1f25);color:var(--text-primary,#e6e6e6);user-select:none}
      .as-btn:hover{border-color:var(--gold,#c9a84c)}
      .as-btn.primary{background:var(--gold,#c9a84c);color:#000;border-color:var(--gold,#c9a84c);font-weight:600}
      .as-btn.danger{border-color:var(--red,#e05c5c);color:var(--red,#e05c5c)}
      .as-btn:disabled{opacity:.4;cursor:not-allowed}
      .as-rec-dot{width:9px;height:9px;border-radius:50%;background:var(--red,#e05c5c);display:inline-block}
      .as-rec-dot.live{animation:asblink 1s infinite}
      @keyframes asblink{50%{opacity:.25}}
      .as-time{font-variant-numeric:tabular-nums;font-size:13px;color:var(--text-muted,#8a8d96);min-width:120px}
      .as-wave-wrap{position:relative;border:1px solid var(--border,#2a2c33);border-radius:8px;background:#0e0f13;overflow:hidden}
      .as-wave{display:block;width:100%;height:200px;cursor:text}
      .as-wave-empty{display:flex;align-items:center;justify-content:center;height:200px;color:var(--text-muted,#8a8d96);font-size:13px}
      .as-zoom{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted,#8a8d96)}
      .as-zoom input[type=range]{flex:1;accent-color:var(--gold,#c9a84c)}
      .as-save{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px dashed var(--border,#2a2c33);padding-top:12px}
      .as-save input,.as-save select{padding:7px 10px;background:var(--bg-input,#1d1f25);border:1px solid var(--border,#2a2c33);
        border-radius:6px;color:var(--text-primary,#e6e6e6);font-size:13px}
      .as-save input[name=as-name]{min-width:220px}
      .as-status{font-size:12px;color:var(--text-muted,#8a8d96);min-height:16px}
      .as-lbl{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted,#8a8d96);white-space:nowrap}
      .as-lbl input,.as-lbl select{padding:4px 6px;background:var(--bg-input,#1d1f25);border:1px solid var(--border,#2a2c33);
        border-radius:5px;color:var(--text-primary,#e6e6e6);font-size:12px}
      .as-note{font-size:11.5px;color:var(--text-muted,#8a8d96);line-height:1.6;padding:2px 2px 0}
    `;
    document.head.appendChild(st);
  }

  // ---------- 打开工作室 ----------
  async function open(opts = {}) {
    const onSaved = opts.onSaved || null;
    injectStyle();
    if (overlayEl) overlayEl.remove();
    state = {
      channels: null, sampleRate: 44100, durationSec: 0,
      sel: null, playhead: 0, view: { start: 0, dur: 1 }, zoom: 1,
      recording: false, recServer: false, recorder: null, recStream: null, recChunks: [], recStart: 0,
      playing: false, src: null, playStartCtx: 0, rafId: 0,
      history: [], redo: [], pendingBlob: null, rawBlob: null, decodeOk: true,
      srcUrl: '',
    };

    overlayEl = document.createElement('div');
    overlayEl.className = 'as-overlay';
    overlayEl.innerHTML = `
      <div class="as-panel">
        <div class="as-head">
          <h3>🎙 声音工作室</h3>
          <span class="as-hint">录制系统声音 / 麦克风 → 波形剪辑 → 保存为声音</span>
          <div style="flex:1"></div>
          <button class="as-btn" id="as-close">关闭</button>
        </div>
        <div class="as-body">
          <div class="as-row">
            <label class="as-lbl">录制来源</label>
            <select id="as-src" style="padding:7px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px">
              <option value="system">系统声音（后端直录 · 不弹窗）</option>
              <option value="mic">麦克风（浏览器 · 授权一次）</option>
              <option value="window">指定窗口 / 标签页（共享面板里选）</option>
            </select>
            <button class="as-btn" id="as-rec-go"><span class="as-rec-dot" id="as-dot"></span> 开始录制</button>
            <button class="as-btn danger" id="as-rec-stop" style="display:none">⏹ 停止录制</button>
            <span class="as-time" id="as-rec-time"></span>
            <span class="as-sep"></span>
            <button class="as-btn" id="as-open">📂 打开音频文件</button>
            <input type="file" id="as-file" accept="audio/*" style="display:none">
          </div>
          <div class="as-note" id="as-src-hint"></div>

          <div class="as-wave-wrap">
            <canvas class="as-wave" id="as-wave"></canvas>
            <div class="as-wave-empty" id="as-empty">尚未载入音频 —— 点「开始录制」（默认录系统声音，不会弹面板），或「打开音频文件」</div>
          </div>

          <div class="as-row">
            <button class="as-btn" id="as-play">▶ 播放</button>
            <button class="as-btn" id="as-play-sel">▶ 播放选中</button>
            <button class="as-btn" id="as-stop">⏹ 停止</button>
            <span class="as-time" id="as-time">00.00s / 00.00s</span>
            <span class="as-time" id="as-sel-time">选区：-</span>
          </div>

          <div class="as-row">
            <button class="as-btn" id="as-autotrim" title="自动找出有声音的那一段，其余裁掉">✂ 识别裁剪</button>
            <span class="as-sep"></span>
            <label class="as-lbl">阈值<input type="number" id="as-t-thr" value="-38" step="1" style="width:58px"> dB</label>
            <label class="as-lbl">合并间隙<input type="number" id="as-t-gap" value="0.35" step="0.05" style="width:58px"> s</label>
            <label class="as-lbl">前后留白<input type="number" id="as-t-pad" value="0.12" step="0.02" style="width:58px"> s</label>
            <label class="as-lbl">取
              <select id="as-t-mode" style="padding:5px 8px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--text-primary)">
                <option value="longest">最长的一段</option>
                <option value="span">首段到末段</option>
              </select>
            </label>
            <span class="as-lbl" id="as-t-info" style="color:var(--gold)"></span>
          </div>

          <div class="as-row">
            <button class="as-btn" id="as-trim">✂ 截取选中</button>
            <button class="as-btn" id="as-del">🗑 删除选中</button>
            <button class="as-btn" id="as-fadein">⇤ 淡入</button>
            <button class="as-btn" id="as-fadeout">⇥ 淡出</button>
            <button class="as-btn" id="as-gain-up">🔊 音量+</button>
            <button class="as-btn" id="as-gain-down">🔉 音量-</button>
            <span class="as-sep"></span>
            <button class="as-btn" id="as-clearsel">清除选区</button>
            <button class="as-btn" id="as-undo">↶ 撤销</button>
            <button class="as-btn" id="as-redo">↷ 重做</button>
          </div>

          <div class="as-zoom">
            <span>缩放</span>
            <input type="range" id="as-zoom" min="1" max="60" value="1">
            <span>滚动</span>
            <input type="range" id="as-scroll" min="0" max="1000" value="0">
          </div>

          <div class="as-status" id="as-status"></div>

          <div class="as-save">
            <input name="as-name" placeholder="声音名称（保存到声音库）">
            <select name="as-cat">
              <option value="voice">人声</option>
              <option value="bgm">背景音乐</option>
              <option value="">未分类</option>
            </select>
            <button class="as-btn primary" id="as-save">💾 导出 WAV 并保存为声音</button>
            <span class="as-status" id="as-save-status" style="min-height:0"></span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    const $ = (id) => overlayEl.querySelector('#' + id);
    const canvas = $('as-wave');
    const empty = $('as-empty');
    const status = $('as-status');

    // ---- 关闭 ----
    function close() {
      stopPlay();
      stopRec(true);
      if (overlayEl) overlayEl.remove();
      overlayEl = null;
    }
    $('as-close').addEventListener('click', close);
    overlayEl.addEventListener('mousedown', (e) => { if (e.target === overlayEl) close(); });

    // ---- 载入音频（Blob / ArrayBuffer） ----
    async function loadArrayBuffer(ab, label) {
      ensureCtx();
      try {
        const buf = await ctx.decodeAudioData(ab.slice(0));
        setChannelsFromBuffer(buf, label);
        state.decodeOk = true;
        status.textContent = '已载入：' + (label || '音频') + '（' + buf.numberOfChannels + '声道 / ' + buf.sampleRate + 'Hz）';
      } catch (err) {
        state.decodeOk = false;
        status.textContent = '⚠ 此浏览器无法解码该格式用于波形剪辑，但可直接保存原始录音（点「直接保存原始文件」）。';
        // 仍允许保存原始
        $('as-save').textContent = '💾 直接保存原始文件';
        state.rawBlob = state.rawBlob || new Blob([ab], { type: 'application/octet-stream' });
      }
    }
    function setChannelsFromBuffer(buf, _label) {
      const ch = [];
      for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c).slice(0));
      state.channels = ch;
      state.sampleRate = buf.sampleRate;
      state.durationSec = buf.duration;
      state.sel = null; state.playhead = 0;
      state.view = { start: 0, dur: buf.duration };
      state.history = []; state.redo = [];
      empty.style.display = 'none';
      canvas.style.display = 'block';
      fitCanvas();
      draw();
      updateTime();
    }

    // ---- 录制 ----
    // 两套实现，按「录制来源」选：
    //   system → 后端 /api/audio/record/*（WASAPI 回环，无弹窗，能录整个系统的声音）
    //   mic / window → 浏览器 getDisplayMedia / getUserMedia（要选窗口就只能这样）
    let srvTimer = 0;
    function stopRec(silent) {
      if (state.recServer) {
        clearTimeout(srvTimer);
        state.recServer = false;
        $('as-rec-stop').style.display = 'none';
        $('as-rec-go').style.display = '';
        $('as-dot').classList.remove('live');
        if (!silent) finishServerRec();
        return;
      }
      if (!state.recording) return;
      try { state.recorder && state.recorder.stop(); } catch (_) {}
      state.recStream && state.recStream.getTracks().forEach(t => t.stop());
      state.recording = false;
      $('as-rec-stop').style.display = 'none';
      $('as-rec-go').style.display = '';
      $('as-dot').classList.remove('live');
      if (!silent) $('as-status').textContent = '录制已停止，正在生成音频…';
    }

    async function finishServerRec() {
      status.textContent = '录制已停止，正在保存…';
      try {
        const r = await Admin.post('/audio/record/stop', { name: '录音_' + stamp() });
        state.srcUrl = r.url;
        $('as-rec-time').textContent = '';
        status.textContent = `已录制 ${r.duration}s（${r.rate}Hz / ${r.channels}声道），可以直接「识别裁剪」`;
        const ab = await (await fetch(r.url)).arrayBuffer();
        state.rawBlob = new Blob([ab], { type: 'audio/wav' });
        await loadArrayBuffer(ab, '系统声音录音');
        // 录完顺手自动识别一次，省得每次都要手动点
        setTimeout(() => autoTrim(false), 60);
      } catch (e) {
        status.textContent = '保存录音失败：' + (e.message || e);
      }
    }

    function stamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    async function startServerRec() {
      try {
        const r = await Admin.post('/audio/record/start', { source: 'system' });
        if (!r.ok) { status.textContent = r.error || '启动失败'; return; }
      } catch (e) {
        status.textContent = '启动后端录制失败：' + (e.message || e) + '（可以改用「指定窗口 / 标签页」）';
        return;
      }
      state.recServer = true;
      state.recStart = performance.now();
      $('as-rec-stop').style.display = '';
      $('as-rec-go').style.display = 'none';
      $('as-dot').classList.add('live');
      status.textContent = '正在录系统声音…（后端直录，没有共享面板）';
      pollServer();
    }

    async function pollServer() {
      if (!state.recServer) return;
      try {
        const s = await Admin.get('/audio/record/status');
        if (s.running) {
          $('as-rec-time').textContent = '● 录制中 ' + fmt(s.seconds);
        }
      } catch (_) { /* 轮询失败不打断录制 */ }
      srvTimer = setTimeout(pollServer, 400);
    }

    async function startBrowserRec(kind) {
      if (!navigator.mediaDevices || (!navigator.mediaDevices.getDisplayMedia && !navigator.mediaDevices.getUserMedia)) {
        status.textContent = '⚠ 当前环境不支持录音（需 localhost 或 https 安全上下文）。';
        return;
      }
      ensureCtx();
      stopPlay();
      let stream;
      try {
        if (kind === 'window') {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (e) {
        status.textContent = '录制授权被取消或失败：' + (e && e.message ? e.message : e);
        return;
      }
      // 共享窗口时会带一条视频轨，直接丢掉，只留声音
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        status.textContent = '⚠ 未获取到音轨。共享面板里要勾上「共享音频」才有声音。';
        return;
      }
      state.recStream = stream;
      state.srcUrl = '';
      const recStream = new MediaStream(audioTracks);
      let mime = '';
      if (window.MediaRecorder) {
        const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        mime = cands.find(m => MediaRecorder.isTypeSupported(m)) || '';
      }
      try {
        state.recorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
      } catch (e) {
        stream.getTracks().forEach(t => t.stop());
        status.textContent = 'MediaRecorder 创建失败：' + e.message;
        return;
      }
      state.recChunks = [];
      state.recorder.ondataavailable = (e) => { if (e.data && e.data.size) state.recChunks.push(e.data); };
      state.recorder.onstop = async () => {
        const blob = new Blob(state.recChunks, { type: state.recorder.mimeType || 'audio/webm' });
        state.rawBlob = blob;
        const ab = await blob.arrayBuffer();
        await loadArrayBuffer(ab, kind === 'window' ? '窗口录音' : '麦克风录音');
        setTimeout(() => autoTrim(false), 60);
      };
      state.recorder.start();
      state.recording = true;
      state.recStart = performance.now();
      $('as-rec-stop').style.display = '';
      $('as-rec-go').style.display = 'none';
      $('as-dot').classList.add('live');
      status.textContent = (kind === 'window' ? '正在录指定窗口（共享面板里记得勾「共享音频」）' : '正在录制麦克风') + '…';
      tickRecTime();
    }

    function startRec() {
      const src = $('as-src').value;
      if (src === 'system') return startServerRec();
      return startBrowserRec(src);
    }

    function tickRecTime() {
      if (!state.recording) { $('as-rec-time').textContent = ''; return; }
      const s = (performance.now() - state.recStart) / 1000;
      $('as-rec-time').textContent = '● 录制中 ' + fmt(s);
      setTimeout(tickRecTime, 200);
    }

    // ---- 录制来源说明 ----
    const SRC_HINT = {
      system: '后端直接录扬声器输出：点「开始录制」就录，不会弹任何面板。录完会自动做一次识别裁剪。',
      mic: '麦克风走浏览器：第一次会问一次权限，之后不再问。',
      window: '指定窗口 / 标签页只能走浏览器的共享面板——这是浏览器权限，网页不能替您选。面板里选哪个窗口，就只录那个窗口的声音，记得勾「共享音频」。',
    };
    function syncSrcHint() {
      const v = $('as-src').value;
      $('as-src-hint').textContent = SRC_HINT[v] || '';
      Admin.put('/audio/record/settings', { source: v }).catch(() => {});
    }
    $('as-src').addEventListener('change', syncSrcHint);

    $('as-rec-go').addEventListener('click', startRec);
    $('as-rec-stop').addEventListener('click', () => stopRec(false));
    $('as-open').addEventListener('click', () => $('as-file').click());
    $('as-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const ab = await f.arrayBuffer();
      state.rawBlob = f;
      state.srcUrl = '';
      await loadArrayBuffer(ab, f.name);
    });

    // ---- 画布 ----
    function fitCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
      canvas.width = Math.max(300, cssW * dpr);
      canvas.height = 200 * dpr;
      canvas._dpr = dpr;
    }
    function sampleAt(i) {
      const ch = state.channels;
      let v = 0;
      for (let c = 0; c < ch.length; c++) v += ch[c][i];
      return v / ch.length;
    }
    function draw() {
      if (!state.channels) return;
      const dpr = canvas._dpr || 1;
      const W = canvas.width, H = canvas.height;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, W, H);
      const sr = state.sampleRate;
      const total = state.channels[0].length;
      const view = state.view;
      const pxPerSec = (W / dpr) / view.dur;
      const mid = H / 2;
      const amp = H / 2 * 0.92;
      // 中线
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
      // 波形
      g.strokeStyle = '#c9a84c';
      const cssW = W / dpr;
      for (let x = 0; x < cssW; x++) {
        const t0 = view.start + x / pxPerSec;
        const t1 = view.start + (x + 1) / pxPerSec;
        let a = Math.floor(t0 * sr), b = Math.floor(t1 * sr);
        if (a < 0) a = 0; if (b > total) b = total;
        if (b <= a) { b = a + 1; }
        let mn = 1, mx = -1;
        for (let i = a; i < b; i++) { const v = sampleAt(i); if (v < mn) mn = v; if (v > mx) mx = v; }
        const yT = mid - mx * amp;
        const yB = mid - mn * amp;
        g.beginPath(); g.moveTo(x * dpr, yT); g.lineTo(x * dpr, Math.max(yB, yT + 0.5)); g.stroke();
      }
      // 选区
      if (state.sel) {
        const xL = (state.sel.start - view.start) * pxPerSec * dpr;
        const xR = (state.sel.end - view.start) * pxPerSec * dpr;
        if (xR > 0 && xL < W) {
          g.fillStyle = 'rgba(201,168,76,.22)';
          g.fillRect(Math.max(0, xL), 0, Math.min(W, xR) - Math.max(0, xL), H);
          g.fillStyle = '#c9a84c';
          g.fillRect(Math.max(0, xL) - 1, 0, 2, H);
          g.fillRect(Math.min(W, xR) - 1, 0, 2, H);
        }
      }
      // 播放头
      const xP = (state.playhead - view.start) * pxPerSec * dpr;
      if (xP >= 0 && xP <= W) {
        g.strokeStyle = '#5ad1ff'; g.beginPath(); g.moveTo(xP, 0); g.lineTo(xP, H); g.stroke();
      }
      updateSelTime();
    }
    function updateTime() {
      $('as-time').textContent = fmt(state.playhead) + ' / ' + fmt(state.durationSec);
    }
    function updateSelTime() {
      $('as-sel-time').textContent = state.sel
        ? ('选区：' + fmt(state.sel.start) + ' → ' + fmt(state.sel.end) + '（' + fmt(state.sel.end - state.sel.start) + '）')
        : '选区：-';
    }

    // ---- 鼠标：选择 / 播放头 ----
    let drag = null;
    canvas.addEventListener('mousedown', (e) => {
      if (!state.channels) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const cssW = rect.width;
      const pxPerSec = cssW / state.view.dur;
      const t = state.view.start + x / pxPerSec;
      let mode = 'new';
      if (state.sel) {
        const xL = (state.sel.start - state.view.start) * pxPerSec;
        const xR = (state.sel.end - state.view.start) * pxPerSec;
        const edge = 7;
        if (x >= xL - edge && x <= xL + edge) mode = 'left';
        else if (x >= xR - edge && x <= xR + edge) mode = 'right';
        else if (x > xL && x < xR) mode = 'move';
        else mode = 'new';
      }
      drag = { mode, startX: x, startTime: t, selStart0: state.sel ? state.sel.start : 0, selEnd0: state.sel ? state.sel.end : 0 };
      try { if (canvas.setPointerCapture && e.pointerId != null) canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!drag || !state.channels) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const cssW = rect.width;
       const pxPerSec = cssW / state.view.dur;
      const t = state.view.start + x / pxPerSec;
      const t0 = drag.startTime;
      if (drag.mode === 'new') {
        const a = Math.min(t0, t), b = Math.max(t0, t);
        state.sel = { start: Math.max(0, a), end: Math.min(state.durationSec, b) };
      } else if (drag.mode === 'left') {
        state.sel.start = Math.max(0, Math.min(t, state.sel.end - 0.02));
      } else if (drag.mode === 'right') {
        state.sel.end = Math.min(state.durationSec, Math.max(t, state.sel.start + 0.02));
      } else if (drag.mode === 'move') {
        const delta = t - t0;
        const len = drag.selEnd0 - drag.selStart0;
        let ns = drag.selStart0 + delta;
        if (ns < 0) ns = 0;
        if (ns + len > state.durationSec) ns = state.durationSec - len;
        state.sel = { start: ns, end: ns + len };
      }
      draw();
    });
    canvas.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const moved = Math.abs((e.clientX - canvas.getBoundingClientRect().left) - drag.startX) > 3;
      if (!moved && drag.mode === 'new') {
        // 单击：设置播放头
        const rect = canvas.getBoundingClientRect();
        const pxPerSec = rect.width / state.view.dur;
        state.playhead = Math.max(0, Math.min(state.durationSec, state.view.start + (e.clientX - rect.left) / pxPerSec));
        updateTime();
      }
      drag = null;
      draw();
    });

    // ---- 缩放 / 滚动 ----
    $('as-zoom').addEventListener('input', (e) => {
      if (!state.channels) return;
      const z = parseInt(e.target.value, 10);
      const prevCenter = state.view.start + state.view.dur / 2;
      const newDur = state.durationSec / z;
      let ns = prevCenter - newDur / 2;
      ns = Math.max(0, Math.min(ns, Math.max(0, state.durationSec - newDur)));
      state.view = { start: ns, dur: newDur };
      draw();
    });
    $('as-scroll').addEventListener('input', (e) => {
      if (!state.channels) return;
      const r = parseInt(e.target.value, 10) / 1000;
      const maxStart = Math.max(0, state.durationSec - state.view.dur);
      state.view.start = maxStart * r;
      draw();
    });

    // ---- 播放 ----
    function stopPlay() {
      state.playing = false;
      if (state.src) { try { state.src.stop(); } catch (_) {} state.src = null; }
      if (state.rafId) cancelAnimationFrame(state.rafId);
      draw();
    }
    function play(fromSel) {
      if (!state.channels) return;
      ensureCtx();
      stopPlay();
      const buf = bufferFromChannels(state.channels, state.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      let offset = state.playhead;
      let dur = buf.duration - offset;
      if (fromSel && state.sel) { offset = state.sel.start; dur = state.sel.end - state.sel.start; }
      state.playhead = offset;
      src.start(0, offset, dur);
      state.src = src;
      state.playing = true;
      state.playStartCtx = ctx.currentTime - offset;
      const tick = () => {
        if (!state.playing) return;
        const t = ctx.currentTime - state.playStartCtx;
        if (t >= offset + dur) { stopPlay(); state.playhead = fromSel && state.sel ? state.sel.end : 0; updateTime(); draw(); return; }
        state.playhead = t;
        // 自动滚动让播放头可见
        if (state.playhead < state.view.start || state.playhead > state.view.start + state.view.dur) {
          const maxStart = Math.max(0, state.durationSec - state.view.dur);
          state.view.start = Math.max(0, Math.min(state.playhead - state.view.dur / 2, maxStart));
          $('as-scroll').value = state.view.dur >= state.durationSec ? 0 : Math.round((state.view.start / maxStart) * 1000);
        }
        updateTime();
        draw();
        state.rafId = requestAnimationFrame(tick);
      };
      state.rafId = requestAnimationFrame(tick);
    }
    $('as-play').addEventListener('click', () => play(false));
    $('as-play-sel').addEventListener('click', () => play(true));
    $('as-stop').addEventListener('click', () => { stopPlay(); updateTime(); });

    // ---- 历史 ----
    function pushHistory() {
      state.history.push(state.channels.map(c => c.slice(0)));
      if (state.history.length > 40) state.history.shift();
      state.redo = [];
    }
    function applyChannels(next, label) {
      state.channels = next;
      state.durationSec = next[0].length / state.sampleRate;
      // 选区整体外移则清空
      if (state.sel && (state.sel.end > state.durationSec)) state.sel = null;
      state.view.dur = state.durationSec;
      fitCanvas(); draw(); updateTime(); updateSelTime();
      status.textContent = label;
    }
    $('as-undo').addEventListener('click', () => {
      if (!state.history.length) return;
      state.redo.push(state.channels.map(c => c.slice(0)));
      applyChannels(state.history.pop(), '已撤销');
    });
    $('as-redo').addEventListener('click', () => {
      if (!state.redo.length) return;
      state.history.push(state.channels.map(c => c.slice(0)));
      applyChannels(state.redo.pop(), '已重做');
    });
    $('as-clearsel').addEventListener('click', () => { state.sel = null; draw(); updateSelTime(); });

    // ---- 识别裁剪 ----
    // 录一段台词，前后往往各挂一大截静音（点了录制才开口、说完忘了停）。
    // 这里按 20ms 一帧算音量，找出连续有声的那一段，自动选中并裁掉其余部分。
    // 算法与后端 audio_trim.py 保持一致（后台批量任务用的是同一套参数），
    // 放在本地做是为了不吃上传、且能对「已经手动编辑过的波形」生效。
    function detectVoice() {
      if (!state.channels) return null;
      const ch = state.channels;
      const sr = state.sampleRate;
      const total = ch[0].length;
      const frameN = Math.max(1, Math.round(sr * 0.02));
      const nch = ch.length;
      const levels = [];
      for (let i = 0; i < total; i += frameN) {
        const end = Math.min(total, i + frameN);
        let sum = 0, cnt = 0;
        for (let j = i; j < end; j++) {
          let v = 0;
          for (let c = 0; c < nch; c++) v += ch[c][j];
          v /= nch;
          sum += v * v; cnt++;
        }
        const rms = Math.sqrt(sum / Math.max(1, cnt));
        levels.push(rms > 0 ? 20 * Math.log10(rms) : -120);
      }
      if (!levels.length) return null;

      // 阈值自适应：录音整体偏小时，固定 -38dB 会把整段判成静音
      const srt = levels.slice().sort((a, b) => a - b);
      const peak = srt[Math.min(srt.length - 1, Math.floor(srt.length * 0.98))];
      const quiet = srt[Math.floor(srt.length * 0.10)];
      let thr = Number($('as-t-thr').value) || -38;
      if (peak > -45) thr = Math.min(Math.max(thr, Math.max(quiet + 9, peak - 32)), peak - 6);
      thr = Math.max(thr, -60);

      const minGap = Number($('as-t-gap').value) || 0.35;
      const pad = Number($('as-t-pad').value) || 0.12;
      const mode = $('as-t-mode').value;
      const rate = 20 / 1000;

      const voiced = levels.map((v) => v > thr);
      let hits = 0;
      const segs = [];
      for (let i = 0; i < voiced.length; i++) {
        if (!voiced[i]) continue;
        hits++;
        let j = i;
        while (j + 1 < voiced.length && voiced[j + 1]) j++;
        segs.push([i * rate, (j + 1) * rate]);
        i = j;
      }
      if (!hits) return { ok: false, error: '整段都没有超过阈值的音量（可能录的是静音）', threshold: thr };
      const merged = [];
      for (const s of segs) {
        if (merged.length && s[0] - merged[merged.length - 1][1] < minGap) {
          merged[merged.length - 1][1] = s[1];
        } else merged.push([s[0], s[1]]);
      }
      const keep = merged.filter((s) => s[1] - s[0] >= 0.25);
      if (!keep.length) return { ok: false, error: '有声片段都太短，判定为噪声', threshold: thr };

      let a, b;
      if (mode === 'span') {
        a = keep[0][0]; b = keep[keep.length - 1][1];
      } else {
        const best = keep.reduce((m, s) => (s[1] - s[0] > m[1] - m[0] ? s : m), keep[0]);
        a = best[0]; b = best[1];
      }
      a = Math.max(0, a - pad);
      b = Math.min(state.durationSec, b + pad);
      return {
        ok: true, start: a, end: b, length: b - a,
        threshold: thr, segments: keep.length,
        silenceRatio: 1 - hits / levels.length,
      };
    }

    function autoTrim(verbose = true) {
      if (!state.channels) { if (verbose) Admin.toast('先录制或打开一段音频', 'error'); return; }
      const r = detectVoice();
      if (!r) return;
      if (!r.ok) {
        $('as-t-info').textContent = '';
        status.textContent = '识别裁剪：' + r.error;
        if (verbose) Admin.toast(r.error, 'error');
        return;
      }
      const sr = state.sampleRate;
      const a = Math.floor(r.start * sr);
      const b = Math.max(a + 1, Math.floor(r.end * sr));
      state.sel = { start: r.start, end: r.end };
      pushHistory();
      const next = state.channels.map((c) => c.slice(a, b));
      applyChannels(next, `识别裁剪：${r.start.toFixed(2)}s → ${r.end.toFixed(2)}s，`
        + `保留 ${r.length.toFixed(2)}s（丢掉前后静音 ${Math.max(0, state.durationSec - r.length).toFixed(2)}s）`);
      $('as-t-info').textContent = `阈值 ${r.threshold.toFixed(0)}dB · 静音占 ${Math.round(r.silenceRatio * 100)}%`;
      if (verbose) Admin.toast('已裁到有声部分 ' + r.length.toFixed(2) + 's', 'success');
    }

    $('as-autotrim').addEventListener('click', () => autoTrim(true));

    // ---- 编辑操作 ----
    function clipRange() {
      if (!state.sel) { Admin.toast('请先在波形上拖选一段区域', 'error'); return null; }
      const sr = state.sampleRate;
      return { a: Math.floor(state.sel.start * sr), b: Math.floor(state.sel.end * sr) };
    }
    $('as-trim').addEventListener('click', () => {
      const r = clipRange(); if (!r) return;
      pushHistory();
      const next = state.channels.map(c => c.slice(r.a, r.b));
      state.sel = null;
      applyChannels(next, '已截取选中片段（其余丢弃）');
    });
    $('as-del').addEventListener('click', () => {
      const r = clipRange(); if (!r) return;
      pushHistory();
      const next = state.channels.map(c => { const out = new Float32Array(c.length - (r.b - r.a)); out.set(c.subarray(0, r.a), 0); out.set(c.subarray(r.b), r.a); return out; });
      state.sel = null;
      applyChannels(next, '已删除选中片段（前后拼接）');
    });
    function fade(kind) {
      const r = clipRange(); if (!r) return;
      pushHistory();
      const sr = state.sampleRate;
      const len = r.b - r.a;
      const next = state.channels.map(c => c.slice(0));
      for (let c = 0; c < next.length; c++) {
        for (let i = r.a; i < r.b; i++) {
          const p = (i - r.a) / len;
          const g = kind === 'in' ? p : (1 - p);
          next[c][i] *= g;
        }
      }
      applyChannels(next, kind === 'in' ? '已淡入' : '已淡出');
    }
    $('as-fadein').addEventListener('click', () => fade('in'));
    $('as-fadeout').addEventListener('click', () => fade('out'));
    function gain(factor) {
      if (!state.channels) return;
      pushHistory();
      const next = state.channels.map(c => { const out = new Float32Array(c.length); for (let i = 0; i < c.length; i++) out[i] = Math.max(-1, Math.min(1, c[i] * factor)); return out; });
      applyChannels(next, '音量 ×' + factor);
    }
    $('as-gain-up').addEventListener('click', () => gain(1.25));
    $('as-gain-down').addEventListener('click', () => gain(0.8));

    // ---- 缩放滑块联动滚动条 ----
    // ---- 导出 + 保存 ----
    $('as-save').addEventListener('click', async () => {
      if (!state.decodeOk) {
        // 无法解码：直接保存原始录音文件
        if (!state.rawBlob) { Admin.toast('没有可保存的音频', 'error'); return; }
        await doSave(state.rawBlob, 'webm');
        return;
      }
      if (!state.channels) { Admin.toast('请先录制或打开音频', 'error'); return; }
      const buf = bufferFromChannels(state.channels, state.sampleRate);
      const wav = encodeWAV(buf);
      await doSave(wav, 'wav');
    });
    async function doSave(blob, format) {
      const name = ($('as-save').closest('.as-save').querySelector('[name=as-name]').value || '').trim()
        || ('录音_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
      const cat = $('as-save').closest('.as-save').querySelector('[name=as-cat]').value;
      const ss = $('as-save-status');
      ss.textContent = '上传中…';
      try {
        const fd = new FormData();
        fd.append('file', blob, name + '.' + format);
        fd.append('name', name);
        const res = await fetch('/api/upload/audio', { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || ('HTTP ' + res.status)); }
        const up = await res.json();
        await Admin.post('/sounds/', {
          name, category: cat, file_path: up.url, file_url: up.url,
          file_format: up.format, duration: state.durationSec, description: '',
        });
        ss.textContent = '✅ 已保存到声音库';
        Admin.toast('声音已保存', 'success');
        if (onSaved) onSaved();
      } catch (e) {
        ss.textContent = '❌ ' + e.message;
        Admin.toast('保存失败：' + e.message, 'error');
      }
    }

    // 录制来源：记住上次选的（默认「系统声音」= 后端直录，不弹任何面板）
    try {
      const s = await Admin.get('/audio/record/settings');
      if (s && s.source) $('as-src').value = s.source;
      if (s && s.trim) {
        if (s.trim.silence_db != null) $('as-t-thr').value = s.trim.silence_db;
        if (s.trim.min_gap != null) $('as-t-gap').value = s.trim.min_gap;
        if (s.trim.pad_head != null) $('as-t-pad').value = s.trim.pad_head;
        if (s.trim.mode) $('as-t-mode').value = s.trim.mode;
      }
    } catch (_) { /* 拿不到设置就用默认值 */ }
    syncSrcHint();

    // 若传入已有声音，自动载入
    if (opts.url) {
      status.textContent = '正在载入已有声音…';
      try {
        const resp = await fetch(opts.url);
        const ab = await resp.arrayBuffer();
        state.rawBlob = new Blob([ab]);
        state.srcUrl = opts.url;
        await loadArrayBuffer(ab, opts.name || '声音');
      } catch (e) { status.textContent = '载入失败：' + e.message; }
    }

    window.addEventListener('resize', () => { if (state && state.channels) { fitCanvas(); draw(); } });
  }

  return { open };
})();
