"""统一语音服务 —— 业务层唯一需要打交道的入口。

这一层负责 Provider 不管的四件事，它们共同决定玩家会不会觉得「磕绊」：

1. 缓存：命中就直接返回静态 URL，零延迟。
2. 并发：前台句子的请求插队到最前，后台批量预合成限流排队，两者互不抢资源。
3. 降级：主引擎失败时自动换备用引擎；全失败也不抛给前端，返回空 URL 让剧情静默继续。
4. 格式：本机 OneCore 只能出 WAV（未压缩，一句 107KB），统一转 MP3 再落盘。

一句话：**任何情况下都不能因为语音出错而卡住剧情推进。**
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterable

from ...config import TTS_CACHE_DIR
from . import cache as tts_cache
from .base import AudioResult, SynthRequest, TTSException, Voice
from .registry import registry

# 同时并发合成的上限。Edge TTS 并发过高会触发限流，反而更慢。
MAX_CONCURRENCY = 4
_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY, thread_name_prefix="tts")
_sem = asyncio.Semaphore(MAX_CONCURRENCY)

_FFMPEG = shutil.which("ffmpeg")


def set_ffmpeg(path: str | None) -> None:
    """允许外部指定 ffmpeg 路径（例如本机 ComfyUI 目录里就有现成的）。"""
    global _FFMPEG
    if path and os.path.exists(path):
        _FFMPEG = path


def ffmpeg_available() -> bool:
    return bool(_FFMPEG)


def set_ffmpeg_search(paths: Iterable[str]) -> None:
    """依次探测候选路径，命中第一个可用的 ffmpeg。"""
    for p in paths:
        if p and os.path.exists(p):
            set_ffmpeg(p)
            return


# 候选 ffmpeg 位置。只要缺了它，本机 OneCore 引擎就只能出未压缩 WAV（体积大 3 倍多），
# 所以多探几个常见位置。Edge TTS 直出 MP3，主路径其实不依赖 ffmpeg。
_DEFAULT_FFMPEG_DIRS = [
    r"I:\TREA work\window操作界面\信息聚合网站\node_modules\ffmpeg-static\ffmpeg.exe",
    r"I:\TREA work\window操作界面\SliceLab\ffmpeg\bin\ffmpeg.exe",
    r"H:\COMFYUI_dapao\python_embeded\ffmpeg.exe",
    r"H:\COMFYUI_dapao\ffmpeg.exe",
    r"C:\ffmpeg\bin\ffmpeg.exe",
]


def _detect_ffmpeg_once() -> None:
    global _FFMPEG
    if _FFMPEG:
        return
    found = shutil.which("ffmpeg")
    if found:
        _FFMPEG = found
        return
    for p in _DEFAULT_FFMPEG_DIRS:
        if os.path.exists(p):
            _FFMPEG = p
            return


_detect_ffmpeg_once()


def url_for(path: str) -> str:
    """把本地绝对路径转成前端可访问的 URL。"""
    rel = os.path.relpath(path, TTS_CACHE_DIR).replace("\\", "/")
    return "/tts-cache/" + rel


# ---------------------------------------------------------------- 音色/引擎查询
def list_engines() -> list[dict[str, Any]]:
    registry.ensure_loaded()
    return registry.list_engines()


def list_voices(engine_id: str | None = None, refresh: bool = False) -> list[Voice]:
    return registry.list_voices(engine_id, refresh=refresh)


def list_all_voices_grouped() -> list[dict[str, Any]]:
    """给后台用的聚合清单：按引擎分组，每组内按性别分组。

    后台下拉要显示「性别 + 音色名 + 风格」，并且要能在选了男性角色时
    把女声置灰，所以必须把 gender 作为一等字段透出。
    """
    rows: list[dict[str, Any]] = []
    for pid in registry._engine_display_order():  # noqa: SLF001
        provider = registry.get(pid)
        if not provider:
            continue
        try:
            available = provider.is_available()
        except Exception:  # noqa: BLE001
            available = False
        try:
            voices = provider.list_voices() if available else []
        except Exception:  # noqa: BLE001
            voices = []
        rows.append({
            "id": pid,
            "name": provider.display_name,
            "requires_network": provider.requires_network,
            "available": available,
            "voices": [v.to_dict() for v in voices],
        })
    return rows


def reload_http_config() -> list[str]:
    """重新读取外部语音大模型配置（不重启服务即可新增引擎）。"""
    return registry.load_http_providers(force=True)


# ---------------------------------------------------------------- 核心合成
def synth_sync(req: SynthRequest, engine_id: str | None = None,
               allow_degrade: bool = True, gender: str = "unknown") -> AudioResult:
    """同步合成一句。返回 AudioResult，失败不抛异常（error 字段说明原因）。"""
    registry.ensure_loaded()
    text = (req.text or "").strip()
    if not text:
        return AudioResult(error="文本为空")

    engine_id = engine_id or registry.default_engine()
    provider = registry.get(engine_id)
    if provider is None or not provider.is_available():
        # 首选引擎不可用时也别急着报错，先看看降级链
        cands = registry.fallback_candidates()
        provider = cands[0] if cands else None
        if provider is None:
            return AudioResult(error=f"没有可用的语音引擎（{engine_id} 不可用且无备选）")
        engine_id = provider.engine_id

    # 音色为空时按性别/引擎给个默认值，避免后端到处写兜底逻辑
    voice_id = req.voice_id or _pick_default_voice(provider, gender)
    req.voice_id = voice_id

    key = tts_cache.cache_key(req, engine_id)
    mp3_path = tts_cache.cache_path(key, "mp3")

    if os.path.exists(mp3_path) and tts_cache.hit_size(mp3_path):
        tts_cache.touch(mp3_path)
        tts_cache.add_hit()
        size = os.path.getsize(mp3_path)
        return AudioResult(
            path=mp3_path, url=url_for(mp3_path), bytes=size,
            duration_ms=duration_of(mp3_path), synth_ms=0,
            engine=engine_id, voice_id=voice_id, cached=True,
        )

    tts_cache.add_miss()
    try:
        result = _produce(provider, req, mp3_path, engine_id, voice_id)
    except Exception as exc:  # noqa: BLE001
        result = AudioResult(engine=engine_id, voice_id=voice_id,
                             error=f"{exc}"[:300])

    if result.bytes:
        return result

    # ---- 降级链：主引擎失败，换备用引擎再试一次 ----
    if allow_degrade:
        for alt in registry.fallback_candidates(exclude={engine_id}):
            alt_path = tts_cache.cache_path(tts_cache.cache_key(req, alt.engine_id), "mp3")
            # 降级时照原样把音色传下去，不要换成备用引擎的默认值。
            # Provider 自己会把不认识的 ID 映射到本引擎能用的音色（并保留声线的
            # 语速/音调偏移）；在这里换成默认值，等于把「苍老长者」变回普通男声。
            alt_voice = req.voice_id or _pick_default_voice(alt, gender)
            alt_req = SynthRequest(
                text=req.text, voice_id=alt_voice, rate=req.rate,
                pitch=req.pitch, volume=req.volume, out_path=alt_path,
            )
            try:
                alt_result = _produce(alt, alt_req, alt_path, alt.engine_id, alt_voice)
            except Exception:  # noqa: BLE001, S110
                continue
            if alt_result.bytes:
                alt_result.degraded = True
                return alt_result
    # 全部失败：返回空 URL，前端会静默跳过，剧情继续走
    return result if result.error else AudioResult(error="语音合成失败且降级未成功")


def _produce(provider, req: SynthRequest, mp3_path: str,
             engine_id: str, voice_id: str) -> AudioResult:
    """执行一次真实的合成，并把结果规整成 MP3 落到 mp3_path。"""
    started = time.time()
    # 本机 OneCore 只能出 WAV：先让他写 WAV，再由我们转 MP3
    if engine_id == "onecore":
        wav_path = mp3_path.rsplit(".", 1)[0] + ".wav"
        wav_req = SynthRequest(text=req.text, voice_id=req.voice_id, rate=req.rate,
                               pitch=req.pitch, volume=req.volume, out_path=wav_path,
                               out_format="wav")
        provider._do_synthesize(wav_req)  # noqa: SLF001
        if not os.path.exists(wav_path) or os.path.getsize(wav_path) < 1024:
            raise TTSException("本机语音未产出有效音频", engine_id)
        _to_mp3(wav_path, mp3_path)
        _silent_unlink(wav_path)   # WAV 只是中间产物，清不掉也不影响结果
    else:
        tmp = mp3_path + ".part"
        direct = SynthRequest(text=req.text, voice_id=req.voice_id, rate=req.rate,
                              pitch=req.pitch, volume=req.volume, out_path=tmp,
                              out_format=req.out_format)
        provider._do_synthesize(direct)  # noqa: SLF001
        if not os.path.exists(tmp) or os.path.getsize(tmp) < 512:
            raise TTSException("引擎未产出有效音频", engine_id)
        # os.replace 本身就是原子覆盖，不需要先 unlink——
        # 先删反而多一次文件操作，还可能因为删不掉而失败。
        os.replace(tmp, mp3_path)

    size = os.path.getsize(mp3_path)
    tts_cache.prune_if_needed()
    return AudioResult(
        path=mp3_path, url=url_for(mp3_path), bytes=size,
        duration_ms=duration_of(mp3_path),
        synth_ms=int((time.time() - started) * 1000),
        engine=engine_id, voice_id=voice_id, cached=False,
    )


def _to_mp3(src: str, dst: str) -> None:
    """WAV -> MP3。没有 ffmpeg 就直接把 WAV 当结果用（体积大但能用）。"""
    if not _FFMPEG:
        # 没有 ffmpeg 就把 WAV 直接当结果（体积大 3 倍多，但至少能出声）
        os.replace(src, dst)
        return
    tmp = dst + ".part"
    # 必须显式写 -f mp3：ffmpeg 按扩展名猜输出格式，而临时文件叫 xxx.mp3.part，
    # 扩展名是 .part，不指定就会被当成无效格式直接报 Invalid argument。
    cmd = [_FFMPEG, "-y", "-v", "error", "-i", src,
           "-codec:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", tmp]
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL,
                          stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if proc.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) < 512:
        detail = (proc.stderr or b"").decode("utf-8", "ignore")[-300:]
        raise TTSException(f"MP3 转码失败：{detail}", "ffmpeg")
    os.replace(tmp, dst)


def duration_of(path: str) -> int:
    """获取音频时长，结果写进同名 .dur 文件持久化。

    为什么必须缓存这个数字：起一次 ffmpeg 子进程就要 ~200ms。
    缓存命中本该是 1ms 级的事，如果每次还得为拿时长去跑一遍 ffmpeg，
    「多周目重刷同一段剧情」就还是会一卡一顿 —— 那预热带来的收益就白给了。
    """
    dur_file = path + ".dur"
    if os.path.exists(dur_file):
        try:
            with open(dur_file, "r", encoding="utf-8") as f:
                v = int(f.read().strip())
            if v > 0:
                return v
        except Exception:  # noqa: BLE001, S110
            pass
    d = _probe_duration(path)
    if d > 0:
        try:
            with open(dur_file, "w", encoding="utf-8") as f:
                f.write(str(d))
        except OSError:
            pass
    return d


def _probe_duration(path: str) -> int:
    """真正读一次音频时长（毫秒）。给不出就返回 0，前端退回按字数估算，
    绝不让拿不到时长成为阻塞剧情的理由。"""
    if not _FFMPEG:
        return 0
    try:
        proc = subprocess.run(
            [_FFMPEG, "-hide_banner", "-i", path],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        err = (proc.stderr or b"").decode("utf-8", "ignore")
        # 优先读输入文件的 Duration 行，格式固定为 Duration: HH:MM:SS.ss
        import re
        m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", err)
        if m:
            h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
            return int((h * 3600 + mi * 60 + s) * 1000)
    except Exception:  # noqa: BLE001, S110
        pass
    return 0


def _silent_unlink(path: str) -> None:
    """删掉一个临时文件，失败就失败——中间产物清不掉不值得让整句合成失败。

    常见失败原因：文件还被别的进程握着、没有写权限、运行环境加了删除钩子。
    任何情况下都不该把「清理失败」升级成用户能感知的错误。
    """
    try:
        os.unlink(path)
    except BaseException:
        pass


def _pick_default_voice(provider, gender: str = "unknown") -> str:
    """某个引擎下没配音色时的兜底选择。

    按角色性别挑，避免给男性角色套上女声——这是后台最容易出错的一步，
    所以默认值这里再兜一次底。性别未知时，用该引擎最好听的那个。
    """
    if hasattr(provider, "engine_id"):
        try:
            from . import catalog
            return catalog.default_voice_for(gender, provider.engine_id)
        except Exception:  # noqa: BLE001
            pass
    try:
        voices = provider.list_voices()
    except Exception:  # noqa: BLE001
        voices = []
    if not voices:
        return ""
    want = "male" if gender == "male" else ("female" if gender == "female" else "")
    if want:
        for v in voices:
            if v.gender == want:
                return v.voice_id
    return voices[0].voice_id


# ---------------------------------------------------------------- 异步包装
async def synth_async(req: SynthRequest, engine_id: str | None = None,
                      allow_degrade: bool = True, gender: str = "unknown") -> AudioResult:
    """异步合成：把阻塞的合成放进线程池，避免拖死 uvicorn 的事件循环。"""
    loop = asyncio.get_running_loop()
    async with _sem:
        return await loop.run_in_executor(
            _executor, lambda: synth_sync(req, engine_id, allow_degrade, gender))


async def synth_batch(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """批量预合成（「第三层预取」的后台任务）。

    并发跑但不放任塞爆：信号量控到 MAX_CONCURRENCY，
    某一句失败不影响其它句——吐出空 url，前端会静默跳过。
    """
    async def one(it: dict[str, Any]) -> dict[str, Any]:
        key = it.get("key")
        try:
            req = SynthRequest(
                text=(it.get("text") or "").strip(),
                voice_id=it.get("voice_id") or "",
                rate=int(it.get("rate") or 0),
                pitch=int(it.get("pitch") or 0),
                volume=int(it.get("volume") or 0),
                out_format="mp3",
            )
            r = await synth_async(req, it.get("engine_id"),
                                  gender=it.get("gender") or "unknown")
            return {
                "key": key, "url": r.url, "bytes": r.bytes,
                "duration_ms": r.duration_ms, "engine": r.engine,
                "voice_id": r.voice_id, "cached": r.cached,
                "degraded": r.degraded, "error": r.error,
            }
        except Exception as exc:  # noqa: BLE001
            return {"key": key, "url": "", "bytes": 0, "duration_ms": 0,
                    "cached": False, "degraded": False, "error": str(exc)[:200]}

    tasks = [one(it) for it in items]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[dict[str, Any]] = []
    for idx, r in enumerate(results):
        if isinstance(r, BaseException):
            out.append({"key": items[idx].get("key"), "url": "", "bytes": 0,
                        "duration_ms": 0, "cached": False, "degraded": False,
                        "voice_id": "", "error": str(r)[:200]})
        else:
            out.append(r)
    return out


def cache_info() -> dict:
    return tts_cache.info()


def clear_cache(older_than_hours: float | None = None) -> dict:
    return tts_cache.clear(older_than_hours * 3600 if older_than_hours else None)


def warmup() -> dict:
    """预热：拉音色列表会把 Edge 的连接、本机 daemon 的冷启动都提前付掉，
    让第一句对话不至于卡在最贵的一次初始化上。"""
    t0 = time.time()
    engines: list[dict[str, Any]] = []
    for pid in registry._engine_display_order():  # noqa: SLF001
        p = registry.get(pid)
        if not p:
            continue
        info = {"id": pid, "name": p.display_name}
        try:
            info["available"] = p.is_available()
            if info["available"]:
                vs = p.list_voices(refresh=False)
                info["voices"] = len(vs)
        except Exception as exc:  # noqa: BLE001
            info["available"] = False
            info["error"] = str(exc)[:200]
        engines.append(info)
    return {
        "engines": engines,
        "elapsed_ms": int((time.time() - t0) * 1000),
        "ffmpeg": bool(_FFMPEG),
        "ffmpeg_path": _FFMPEG or "",
        "cache": tts_cache.info(),
    }
