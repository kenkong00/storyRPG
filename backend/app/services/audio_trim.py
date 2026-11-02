"""识别裁剪：自动找出音频里「真正有声」的那一段并裁出来。

录一段角色台词，前后常常各挂着一大截静音（点了录制才开口、说完忘了停）。
手动拖波形很烦，所以这里按帧算音量，找出连续的语音段：
    1. 切成 frame_ms 一帧，逐帧算 RMS，换算成 dBFS；
    2. 高于阈值的帧算「有声」，低于的算静音；
    3. 相邻有声帧之间的空隙小于 min_gap 就并成一段（避免一句话被切成七八截）；
    4. 丢掉短于 min_len 的碎片（咳嗽、鼠标声）；
    5. 按 mode 挑结果：longest = 最长的一段（默认，最符合「一段人物台词」），
       span = 第一段到末段整段（保留中间所有停顿），all = 全部片段分别导出。

纯标准库实现：audioop（C 实现，够快）+ wave，不引 numpy。
需要 mp3/m4a 之类的输入时先用 ffmpeg 转成 wav（复用 TTS 那套 ffmpeg 探测）。
"""
from __future__ import annotations

import audioop
import math
import os
import subprocess
import wave

FRAME_MS = 20          # 分析粒度
ABS_FLOOR_DB = -60.0   # 绝对下限：比这更安静的肯定不是人声
DEFAULT_OPTS = {
    "silence_db": -38.0,   # 低于这个音量当静音
    "min_gap": 0.35,       # 段间空隙小于它就不切（一句话里的换气）
    "min_len": 0.25,       # 短于它的碎片丢掉
    "pad_head": 0.12,      # 前面留一点，别切掉起音
    "pad_tail": 0.20,      # 后面留一点，别切掉尾音
    "mode": "longest",     # longest / span / all
    "normalize": True,     # 峰值归一到 -1dB 附近，声音包音量才一致
    "fade_ms": 8,          # 首尾淡入淡出，去掉「啪」的爆音
}

# TTS 产物专用：和录音只差一个 mode，但差了这一个就是「整句」和「半句」的区别。
#
# 录音为什么要 longest：用户按了录制才开始说话，说完又忘了停，
# 音频前后各挂着一大截静音；中间如果还有咳嗽/挪椅子，切出来的段数不止一个，
# 挑最长的那段最接近"我想留的那句台词"。
#
# TTS 为什么必须 span：合成出来的音频本身就是一句完整台词，首尾几乎没有静音。
# 句子里的逗号/句号会带来 0.3~0.8s 的停顿，longest 会把它当成"段间空隙"，
# 只留下最长的那一段 —— 表现就是「长句子只念前面一小段，后面的没了」；
# 而哪一段最长取决于各分句的长短，所以有时留前半、有时留后半，
# 看起来就像"随机只生成一部分"。span = 首段到末段整段保留，
# 既剪掉首尾多余的空白，又一句不落。
TTS_OPTS = {
    **DEFAULT_OPTS,
    "mode": "span",
    # 句内换气大多在 0.6s 以内，抬到 0.9s 能让「一句话被切成几段」的报告更贴近直觉，
    # span 模式下这个值不影响最终裁剪范围，只影响分析结果的可读性。
    "min_gap": 0.9,
}


# ----------------------------------------------------------------------------
# 基础：读音频 → 统一成 单声道 16bit
# ----------------------------------------------------------------------------
def ffmpeg_path() -> str | None:
    """复用 TTS 那套 ffmpeg 探测，避免两处各写一份候选路径。"""
    try:
        from .tts.service import ffmpeg_path as _p
        return _p()
    except Exception:  # noqa: BLE001
        import shutil
        return shutil.which("ffmpeg")


def to_wav(src: str, dst: str | None = None, rate: int = 44100) -> str:
    """任意音频 → 44.1kHz / 单声道 / 16bit WAV。已经是这个格式就原样返回。"""
    if _is_target_wav(src, rate):
        return src
    ff = ffmpeg_path()
    if not ff:
        raise RuntimeError("没有可用的 ffmpeg，无法解码这个格式")
    dst = dst or (os.path.splitext(src)[0] + "_norm.wav")
    cmd = [ff, "-y", "-v", "error", "-i", src, "-ar", str(rate), "-ac", "1",
           "-c:a", "pcm_s16le", "-f", "wav", dst]
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if proc.returncode != 0 or not os.path.exists(dst):
        detail = (proc.stderr or b"").decode("utf-8", "ignore")[-300:]
        raise RuntimeError(f"音频解码失败：{detail}")
    return dst


def _is_target_wav(path: str, rate: int) -> bool:
    try:
        with wave.open(path, "rb") as w:
            return (w.getnchannels() == 1 and w.getframerate() == rate
                    and w.getsampwidth() == 2)
    except Exception:  # noqa: BLE001
        return False


def _load_mono(path: str) -> tuple[bytes, int]:
    """读成 (单声道16bit PCM, 采样率)。双声道就地混单。"""
    with wave.open(path, "rb") as w:
        ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        data = w.readframes(n)
    if width != 2:
        raise RuntimeError(f"只支持 16bit PCM，当前 {width * 8}bit")
    if ch > 1:
        data = audioop.tomono(data, 2, 0.5, 0.5)
    return data, rate


def _db(rms: int) -> float:
    if rms <= 0:
        return -120.0
    return 20.0 * math.log10(rms / 32768.0)


# ----------------------------------------------------------------------------
# 分析：找出有声段
# ----------------------------------------------------------------------------
def analyze(src: str, opts: dict | None = None) -> dict:
    o = dict(DEFAULT_OPTS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    wav = to_wav(src)
    data, rate = _load_mono(wav)
    total = len(data) / 2 / rate if rate else 0.0
    frame_n = max(1, int(rate * FRAME_MS / 1000))
    frame_bytes = frame_n * 2

    # 1) 逐帧音量
    levels = []
    pos = 0
    ln = len(data)
    while pos < ln:
        chunk = data[pos:pos + frame_bytes]
        if len(chunk) < 2:
            break
        levels.append(_db(audioop.rms(chunk, 2)))
        pos += frame_bytes
    if not levels:
        return {"ok": False, "error": "音频是空的", "duration": total,
                "segments": [], "chosen": None, "opts": o}

    # 2) 阈值：用「中位数 + 余量」自适应，纯靠固定值遇到小音量录音会全判静音
    srt = sorted(levels)
    median = srt[len(srt) // 2]
    peak = srt[int(len(srt) * 0.98)] if len(srt) > 20 else max(levels)
    quiet_ref = srt[int(len(srt) * 0.10)] if len(srt) > 20 else median
    thr = float(o["silence_db"])
    if peak > -45:  # 只有确实有声音时才做自适应
        auto = max(quiet_ref + 9.0, peak - 32.0)
        thr = min(max(thr, auto), peak - 6.0)
    thr = max(thr, ABS_FLOOR_DB)

    voiced = [lv > thr for lv in levels]
    if not any(voiced):
        return {"ok": False, "error": "整段都没有超过阈值的音量（可能录的是静音）",
                "duration": total, "segments": [], "chosen": None,
                "opts": o, "threshold_db": round(thr, 1), "peak_db": round(peak, 1)}

    # 3) 连成段
    segs = []
    i = 0
    while i < len(voiced):
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(voiced) and voiced[j + 1]:
            j += 1
        segs.append([i * FRAME_MS / 1000.0, (j + 1) * FRAME_MS / 1000.0])
        i = j + 1

    # 4) 合并小空隙 + 丢掉碎片
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < float(o["min_gap"]):
            merged[-1][1] = s[1]
        else:
            merged.append(list(s))
    merged = [s for s in merged if (s[1] - s[0]) >= float(o["min_len"])]
    if not merged:
        return {"ok": False, "error": "有声片段都太短，判定为噪声",
                "duration": total, "segments": [], "chosen": None,
                "opts": o, "threshold_db": round(thr, 1), "peak_db": round(peak, 1)}

    # 5) 选目标区间
    mode = str(o["mode"] or "longest")
    if mode == "all":
        chosen = [max(0.0, merged[0][0]), min(total, merged[-1][1])]
        keep = [{"start": round(a, 3), "end": round(b, 3)} for a, b in merged]
    elif mode == "span":
        chosen = [max(0.0, merged[0][0]), min(total, merged[-1][1])]
        keep = [{"start": round(chosen[0], 3), "end": round(chosen[1], 3)}]
    else:  # longest
        best = max(merged, key=lambda s: s[1] - s[0])
        chosen = [best[0], best[1]]
        keep = [{"start": round(best[0], 3), "end": round(best[1], 3)}]

    # 6) 前后留白
    a = max(0.0, chosen[0] - float(o["pad_head"]))
    b = min(total, chosen[1] + float(o["pad_tail"]))
    return {
        "ok": True,
        "duration": round(total, 3),
        "threshold_db": round(thr, 1),
        "peak_db": round(peak, 1),
        "silence_ratio": round(1.0 - sum(1 for v in voiced if v) / len(voiced), 3),
        "segments": keep,
        # 全部有声段都透出来。longest 模式下 segments 只含被选中的那一段，
        # 排查「为什么只念了半句」时看不到被丢掉的部分，这里补上便于定位。
        "all_segments": [{"start": round(s[0], 3), "end": round(s[1], 3)} for s in merged],
        "segment_count": len(merged),
        "chosen": {"start": round(a, 3), "end": round(b, 3),
                   "length": round(b - a, 3)},
        "opts": o,
        "wav": wav,
    }


# ----------------------------------------------------------------------------
# 裁剪：按分析结果切出来写盘
# ----------------------------------------------------------------------------
def trim(src: str, dst: str, opts: dict | None = None) -> dict:
    o = dict(DEFAULT_OPTS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    info = analyze(src, o)
    if not info.get("ok"):
        return {"ok": False, "error": info.get("error"), "analysis": info}

    data, rate = _load_mono(info["wav"])
    a = int(float(info["chosen"]["start"]) * rate)
    b = int(float(info["chosen"]["end"]) * rate)
    a = max(0, min(a, len(data) // 2))
    b = max(a + 1, min(b, len(data) // 2))
    piece = data[a * 2:b * 2]

    # 音量归一：不同台词录进来的响度差很远，声音包听着忽大忽小很出戏
    if o.get("normalize"):
        peak = audioop.max(piece, 2)
        if peak > 0:
            target = 0.89 * 32767
            factor = min(8.0, target / peak)
            if factor > 1.02 or factor < 0.98:
                piece = audioop.mul(piece, 2, factor)

    # 首尾淡入淡出，去掉爆音
    fade_ms = float(o.get("fade_ms") or 0)
    if fade_ms > 0 and len(piece) > 8:
        n = min(int(rate * fade_ms / 1000), len(piece) // 4)
        if n > 0:
            head_src = piece[:n * 2]
            ramp_in = bytearray()
            for i in range(n):
                g = i / n
                ramp_in += audioop.mul(head_src[i * 2:i * 2 + 2], 2, g)
            body_start = n * 2
            tail_src = piece[-(n * 2):]
            ramp_out = bytearray()
            for i in range(n):
                g = 1.0 - i / n
                ramp_out += audioop.mul(tail_src[i * 2:i * 2 + 2], 2, g)
            piece = bytes(ramp_in) + piece[body_start:-(n * 2)] + bytes(ramp_out)

    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with wave.open(dst, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(piece)

    return {
        "ok": True,
        "path": dst,
        "bytes": os.path.getsize(dst),
        "duration": round(len(piece) / 2 / rate, 3),
        "analysis": info,
    }


def trim_tts(src: str, dst: str, opts: dict | None = None) -> dict:
    """TTS 产物专用裁剪：只剪首尾多余的静音，绝不切掉句子中间的停顿。

    为什么不直接用 trim()：trim 的默认 mode 是 longest（为录音设计），
    一句话里的逗号停顿会被当成段间空隙，只剩最长的那一段，
    长句直接丢半句 —— 这就是「加了逗号就只念前面一小段」的真正原因。
    这里强制 span，并且不接受外部把 mode 改回 longest：
    台词就是要整句，没有哪种场景需要「只要最长的那半句」。
    """
    o = dict(TTS_OPTS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    o["mode"] = "span"

    info = analyze(src, o)
    if not info.get("ok"):
        return {"ok": False, "error": info.get("error"), "analysis": info}

    out = trim(src, dst, o)
    if not out.get("ok"):
        return out

    # 安全阀：span 理论上不会短这么多。真短了说明阈值/切段判定出了问题
    # （比如整句被误判成噪声），这种情况下宁可保留原始完整音频，也不能交付半句。
    total = float(info.get("duration") or 0)
    got = float(out.get("duration") or 0)
    if total > 1.2 and got < total * 0.6:
        try:
            import shutil
            shutil.copyfile(info["wav"], dst)
            return {
                "ok": True,
                "path": dst,
                "bytes": os.path.getsize(dst),
                "duration": round(wav_info(dst)["duration"], 3),
                "analysis": info,
                "guard": True,
                "guard_reason": f"裁剪后只剩 {got}s/{total}s，改用完整音频",
            }
        except Exception:  # noqa: BLE001
            pass
    return out


def wav_info(path: str) -> dict:
    try:
        with wave.open(path, "rb") as w:
            rate = w.getframerate()
            n = w.getnframes()
            return {"duration": round(n / rate, 3) if rate else 0.0,
                    "rate": rate, "channels": w.getnchannels(),
                    "bits": w.getsampwidth() * 8}
    except Exception:  # noqa: BLE001
        return {"duration": 0.0, "rate": 0, "channels": 0, "bits": 0}
