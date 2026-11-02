"""声音：系统声音录制 + 识别裁剪。

录制放在后端（WASAPI 回环），不是浏览器 —— 因为浏览器每次按录制都得先弹
「共享什么」的面板，这跟「录整个系统的声音」这件事本身没关系，纯属打扰。
麦克风和「指定某个窗口」仍然走浏览器：
    · 麦克风 getUserMedia 只授权一次；
    · 指定窗口 / 标签页是浏览器的权限，网页无权替用户选。
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import audio_trim
from ..services.system_audio import WasapiLoopbackRecorder
from ..services.tts import service as tts_service

router = APIRouter(prefix="/api/audio", tags=["声音"])

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIO_DIR = os.path.normpath(os.path.join(_BACKEND_DIR, "..", "frontend", "audio"))
RECORD_SUBDIR = "record"
SETTINGS_PATH = os.path.normpath(os.path.join(_BACKEND_DIR, "data", "audio_settings.json"))

DEFAULT_SETTINGS = {
    "source": "system",       # system = 服务端录系统声音（无弹窗）；mic / window = 走浏览器
    "trim": dict(audio_trim.DEFAULT_OPTS),
}


# ----------------------------------------------------------------------------
# 设置读写（一个小 JSON，够用就好）
# ----------------------------------------------------------------------------
def load_settings() -> dict:
    out = {"source": DEFAULT_SETTINGS["source"], "trim": dict(audio_trim.DEFAULT_OPTS)}
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            if saved.get("source"):
                out["source"] = str(saved["source"])
            if isinstance(saved.get("trim"), dict):
                out["trim"].update(saved["trim"])
    except Exception:  # noqa: BLE001
        pass
    return out


def save_settings(patch: dict) -> dict:
    cur = load_settings()
    if isinstance(patch.get("source"), str) and patch["source"]:
        cur["source"] = patch["source"]
    if isinstance(patch.get("trim"), dict):
        cur["trim"].update({k: v for k, v in patch["trim"].items() if v is not None})
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return cur


# ----------------------------------------------------------------------------
# 录制器（全局单例：同时只允许一段录制）
# ----------------------------------------------------------------------------
_recorder: WasapiLoopbackRecorder | None = None
_rec_lock = threading.Lock()


def _get_recorder() -> WasapiLoopbackRecorder:
    global _recorder
    if _recorder is None:
        _recorder = WasapiLoopbackRecorder(ffmpeg=tts_service.ffmpeg_path())
    return _recorder


def _record_url(name: str) -> tuple[str, str]:
    d = os.path.join(AUDIO_DIR, RECORD_SUBDIR)
    os.makedirs(d, exist_ok=True)
    fn = f"{name}.wav"
    return os.path.join(d, fn), f"/audio/{RECORD_SUBDIR}/{fn}"


class RecordStartIn(BaseModel):
    source: str = "system"


@router.get("/record/settings")
def get_record_settings():
    s = load_settings()
    info = None
    try:
        from ..services.system_audio import _probe_format
        info = _probe_format()
    except Exception:  # noqa: BLE001
        info = None
    s["device"] = ({"name": info[0], "channels": info[1], "rate": info[2], "bits": info[3]}
                   if info else None)
    s["ffmpeg"] = tts_service.ffmpeg_available()
    return s


@router.put("/record/settings")
def put_record_settings(payload: dict):
    return save_settings(payload or {})


@router.post("/record/start")
def record_start(payload: RecordStartIn):
    """开始录系统声音。返回后前端直接轮询 /record/status 显示计时。"""
    if (payload.source or "system") != "system":
        # 麦克风 / 指定窗口必须走浏览器，这里只负责告诉前端「别指望后端」
        return {"ok": False, "mode": payload.source,
                "error": "这个录制来源要在浏览器里做（麦克风需一次授权，指定窗口需在共享面板里选）"}
    with _rec_lock:
        rec = _get_recorder()
        if rec.running:
            return {"ok": False, "error": "已经在录制了"}
        try:
            dev = rec.start()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"启动录制失败：{exc}")
        return {"ok": True, "mode": "system", "device": dev.as_dict(),
                "started_at": rec.started_at}


@router.get("/record/status")
def record_status():
    rec = _get_recorder()
    if not rec.running and not rec.started_at:
        return {"running": False, "seconds": 0.0, "bytes": 0, "device": None}
    return {
        "running": rec.running,
        "seconds": round(rec.seconds, 2),
        "bytes": rec.bytes_captured(),
        "device": rec._device.as_dict() if rec._device else None,
        "error": rec._error,
    }


class RecordStopIn(BaseModel):
    name: str = ""


@router.post("/record/stop")
def record_stop(payload: RecordStopIn | None = None):
    """停止并落盘。返回可播放的 url，前端直接拿去画波形。"""
    with _rec_lock:
        rec = _get_recorder()
        if not rec.running and not rec.started_at:
            raise HTTPException(status_code=400, detail="当前没有在录制")
        rec.stop()
        name = (payload.name if payload else "") or ("录音_" + time.strftime("%Y%m%d_%H%M%S"))
        name = "".join(c for c in name if c.isalnum() or c in "-_") or uuid.uuid4().hex[:8]
        path, url = _record_url(name)
        try:
            info = rec.save_wav(path)
        except Exception as exc:  # noqa: BLE001
            rec.started_at = 0.0
            raise HTTPException(status_code=500, detail=f"保存失败：{exc}")
        finally:
            rec.started_at = 0.0
            rec.stopped_at = 0.0
        return {"ok": True, "url": url, "filename": os.path.basename(path), **info}


# ----------------------------------------------------------------------------
# 识别裁剪
# ----------------------------------------------------------------------------
def _resolve(path_or_url: str) -> str:
    """把 /audio/xxx.wav 或磁盘路径统一成磁盘路径。"""
    p = (path_or_url or "").strip()
    if not p:
        raise HTTPException(status_code=400, detail="没有指定音频")
    if p.startswith("/audio/"):
        p = os.path.join(AUDIO_DIR, p[len("/audio/"):].replace("/", os.sep))
    elif p.startswith("http://") or p.startswith("https://"):
        p = p.split("?")[0]
        i = p.find("/audio/")
        if i >= 0:
            p = os.path.join(AUDIO_DIR, p[i + len("/audio/"):].replace("/", os.sep))
    p = os.path.normpath(p)
    if not os.path.exists(p):
        raise HTTPException(status_code=404, detail=f"音频不存在：{os.path.basename(p)}")
    return p


class TrimIn(BaseModel):
    path: str = ""
    opts: dict | None = None
    save: bool = False      # True = 裁剪结果另存为新文件，返回 url
    name: str = ""


@router.post("/analyze")
def analyze(payload: TrimIn):
    """只分析不落盘：前端可以先看「自动识别到哪一段」再决定要不要裁。"""
    src = _resolve(payload.path)
    opts = dict(load_settings().get("trim") or {})
    opts.update(payload.opts or {})
    try:
        return audio_trim.analyze(src, opts)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"分析失败：{exc}")


@router.post("/trim")
def do_trim(payload: TrimIn):
    """识别裁剪：留下有声的那一段。save=True 时另存，否则就地覆盖原文件。"""
    src = _resolve(payload.path)
    opts = dict(load_settings().get("trim") or {})
    opts.update(payload.opts or {})
    if payload.save:
        d = os.path.join(AUDIO_DIR, RECORD_SUBDIR)
        os.makedirs(d, exist_ok=True)
        stem = (payload.name or os.path.splitext(os.path.basename(src))[0] + "_trim")
        stem = "".join(c for c in stem if c.isalnum() or c in "-_")
        path = os.path.join(d, stem + ".wav")
        i = 2
        while os.path.exists(path):
            path = os.path.join(d, f"{stem}_{i}.wav")
            i += 1
        url = f"/audio/{RECORD_SUBDIR}/{os.path.basename(path)}"
    else:
        path, url = src, None
    try:
        out = audio_trim.trim(src, path, opts)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"裁剪失败：{exc}")
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("error") or "没找到可裁的有声段")
    out["url"] = url
    return out
