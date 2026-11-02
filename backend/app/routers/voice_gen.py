"""对话语音生成接口：剧情节点的对话行 → 直接合成音频 → 写入统一声音库。

与「语音任务」的区别：
    语音任务 = 一个带参数配置的「语音包」，批量、可重跑、进度可轮询；
    这里     = 剧情节点对话列表里随手挑一句/几句，立刻变成声音文件，
               用该句说话者（人物角色）的语音配置来合成，产物进声音库
               分类路径 category_path（默认「剧情语音/…」），
               前端把返回的 url 回写到这条对话的 voice 字段即可播报。
"""
from __future__ import annotations

import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.sound import Sound
from ..services import audio_trim
from ..services import voice_task_runner as runner
from ..services.tts.base import SynthRequest
from ..services.tts import service as tts_service

router = APIRouter(prefix="/api/voice-gen", tags=["对话语音生成"])


class VoiceGenRow(BaseModel):
    speaker_id: Optional[int] = None
    content: str = ""
    engine: Optional[str] = None
    voice_id: Optional[str] = None
    rate: Optional[int] = None
    pitch: Optional[int] = None
    volume: Optional[int] = None


class VoiceGenPayload(BaseModel):
    rows: list[VoiceGenRow] = []
    pack_path: Optional[str] = None        # 声音库分类路径，默认「剧情语音」
    name_len: Optional[int] = 8
    trim_opts: Optional[dict] = None       # 静音裁剪参数（透传给 audio_trim.trim）
    # 全局兜底配置：行内没写、角色也没配的时候用这个
    engine: Optional[str] = None
    voice_id: Optional[str] = None
    rate: Optional[int] = None
    pitch: Optional[int] = None
    volume: Optional[int] = None


def _resolve_cfg(db: Session, row: VoiceGenRow, payload: VoiceGenPayload) -> dict:
    """行内覆盖 > 人物角色语音配置 > 全局兜底。"""
    cfg = {
        "engine": (payload.engine or ""),
        "voice_id": (payload.voice_id or ""),
        "rate": int(payload.rate or 0),
        "pitch": int(payload.pitch or 0),
        "volume": int(payload.volume or 0),
        "gender": "unknown",
    }
    if row.speaker_id:
        ch = db.query(Character).filter(Character.id == int(row.speaker_id)).first()
        if ch:
            cfg["gender"] = getattr(ch, "gender", "") or "unknown"
            if not cfg["engine"]:
                cfg["engine"] = getattr(ch, "tts_engine", "") or ""
            if not cfg["voice_id"]:
                cfg["voice_id"] = getattr(ch, "tts_voice", "") or ""
            if not cfg["rate"]:
                cfg["rate"] = int(getattr(ch, "tts_rate", 0) or 0)
            if not cfg["pitch"]:
                cfg["pitch"] = int(getattr(ch, "tts_pitch", 0) or 0)
            if not cfg["volume"]:
                cfg["volume"] = int(getattr(ch, "tts_volume", 0) or 0)
    # 行级覆盖（面板里手动改的）压到最后
    if row.engine is not None:
        cfg["engine"] = row.engine
    if row.voice_id is not None:
        cfg["voice_id"] = row.voice_id
    if row.rate is not None:
        cfg["rate"] = int(row.rate or 0)
    if row.pitch is not None:
        cfg["pitch"] = int(row.pitch or 0)
    if row.volume is not None:
        cfg["volume"] = int(row.volume or 0)
    return cfg


@router.post("/dialogue")
def gen_dialogue(payload: VoiceGenPayload, db: Session = Depends(get_db)):
    rows = payload.rows or []
    if not rows:
        raise HTTPException(status_code=400, detail="没有要合成的对话")
    pack_path = (payload.pack_path or "").strip() or "剧情语音"
    name_len = int(payload.name_len or 8)
    trim_opts = payload.trim_opts or {}
    results = []
    for i, row in enumerate(rows):
        text = (row.content or "").strip()
        try:
            if not text:
                results.append({"index": i, "ok": False, "error": "内容为空"})
                continue
            cfg = _resolve_cfg(db, row, payload)
            req = SynthRequest(
                text=text,
                voice_id=cfg.get("voice_id") or "",
                rate=cfg.get("rate") or 0,
                pitch=cfg.get("pitch") or 0,
                volume=cfg.get("volume") or 0,
            )
            res = tts_service.synth_sync(req, (cfg.get("engine") or "").strip() or None,
                                         allow_degrade=True,
                                         gender=cfg.get("gender") or "unknown")
            if res.error or not res.path or not os.path.exists(res.path):
                raise RuntimeError(res.error or "合成没有产出音频")

            wav = audio_trim.to_wav(res.path)
            dst, url = runner._unique_path(runner.sound_name(text, name_len))
            # 台词必须整句：用 TTS 专用裁剪（span），不能用录音那套 longest，
            # 否则逗号处的停顿会被当成段间空隙，长句只剩最长的那半句。
            out = audio_trim.trim_tts(wav, dst, trim_opts)
            if not out.get("ok"):
                shutil.copyfile(wav, dst)
                out = {"ok": True, "duration": audio_trim.wav_info(dst)["duration"], "fallback": True}
            dur = float(out.get("duration") or audio_trim.wav_info(dst)["duration"] or 0.0)

            sound = Sound(
                name=runner.sound_name(text, name_len),
                category="voice",
                category_path=pack_path,
                file_path=dst,
                file_url=url,
                file_format="wav",
                duration=round(dur, 2),
                description=text,
            )
            db.add(sound)
            db.flush()
            results.append({
                "index": i,
                "ok": True,
                "sound": {"id": sound.id, "name": sound.name, "url": url,
                          "duration": round(dur, 2)},
            })
        except Exception as exc:  # noqa: BLE001
            results.append({"index": i, "ok": False, "error": f"{exc}"[:300]})
    db.commit()
    return {"items": results}
