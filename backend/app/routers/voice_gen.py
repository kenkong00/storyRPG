"""对话语音生成接口：剧情节点的对话行 → 直接合成音频 → 写入统一声音库。

与「语音任务」的区别：
    语音任务 = 一个带参数配置的「语音包」，批量、可重跑、进度可轮询；
    这里     = 剧情节点对话列表里随手挑一句/几句，立刻变成声音文件，
               用该句说话者（人物角色）的语音配置来合成，产物进声音库
               分类路径 category_path（默认「剧情语音/…」），
               前端把返回的 url 回写到这条对话的 voice 字段即可播报。

两种调用方式：
    · /dialogue      同步，1 句（弹窗里点「生成此句语音」，1~3 秒，等得住）
    · /dialogue/job  异步任务，1~N 句（列表上方的「批量生成语音」）

为什么要任务版：
    三十句就是一分多钟。以前走同步请求，用户把节点弹窗一关，浏览器就把连接掐了，
    前端弹「批量生成失败」，后台其实还在跑、结果也没人收 —— 白等一场。
    现在提交完立刻返回 job_id：关窗口、切栏目、去干别的都不影响，
    合成结果直接写回数据库里的对话行（voice 字段），回来就能播。
"""
from __future__ import annotations

import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import jobs
from ..database import SessionLocal, get_db
from ..models.character import Character
from ..models.sound import Sound
from ..models.story import StoryNode, StoryNodeDialogue
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


class DialogueJobRow(VoiceGenRow):
    # 这一句对应数据库里的哪一行对话：有了它，结果才能直接写回 voice 字段，
    # 用户关掉窗口也不会丢。
    dialogue_id: Optional[int] = None


class DialogueJobPayload(VoiceGenPayload):
    rows: list[DialogueJobRow] = []
    node_id: Optional[int] = None
    title: Optional[str] = None


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
    else:
        # 旁白（没有说话人）：用「声音管理 → 角色语音配置 → 旁白」那一套，
        # 语义和剧情观看时的旁白朗读完全一致，产物听起来才对得上。
        from .tts import _narration_cfg
        narr = _narration_cfg(db)
        if not cfg["engine"]:
            cfg["engine"] = narr["engine_id"]
        if not cfg["voice_id"]:
            cfg["voice_id"] = narr["voice_id"]
        if not cfg["rate"]:
            cfg["rate"] = narr["rate"]
        if not cfg["pitch"]:
            cfg["pitch"] = narr["pitch"]
        if not cfg["volume"]:
            cfg["volume"] = narr["volume"]
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


def _synth_one(db: Session, text: str, cfg: dict, pack_path: str,
               name_len: int, trim_opts: dict) -> dict:
    """合成一句 → 裁剪 → 落盘 → 建 Sound 记录。失败直接抛异常，由调用方记错。"""
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
    dst, url = runner._unique_path(runner.sound_name(text, name_len), pack_path)
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
    return {"id": sound.id, "name": sound.name, "url": url, "duration": round(dur, 2)}


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
            sound = _synth_one(db, text, cfg, pack_path, name_len, trim_opts)
            results.append({"index": i, "ok": True, "sound": sound})
        except Exception as exc:  # noqa: BLE001
            results.append({"index": i, "ok": False, "error": f"{exc}"[:300]})
    db.commit()
    return {"items": results}


# ===================== 批量：提交成任务（关窗口也不中断） =====================
def _node_title(db: Session, node_id: int | None) -> str:
    if not node_id:
        return ""
    node = db.query(StoryNode).filter(StoryNode.id == int(node_id)).first()
    return (node.title if node else "") or ""


@router.post("/dialogue/job", status_code=201)
def gen_dialogue_job(payload: DialogueJobPayload, db: Session = Depends(get_db)):
    rows = payload.rows or []
    if not rows:
        raise HTTPException(status_code=400, detail="没有要合成的对话")
    node_title = (payload.title or "").strip() or _node_title(db, payload.node_id)
    speaker_n = len({r.speaker_id for r in rows if r.speaker_id})
    title = f"剧情语音 · {node_title or '对话'} · {len(rows)} 句"
    if speaker_n:
        title += f"（{speaker_n} 人）"

    job = jobs.create("voice_dialogue", title, page="story", total=len(rows),
                      focus={"node_id": payload.node_id},
                      message="排队中，逐句合成…")
    jobs.spawn(jobs.guard, job["id"], _run_dialogue_job, job["id"], payload.model_dump())
    return {"ok": True, "job_id": job["id"], "total": len(rows), "title": title}


def _run_dialogue_job(job_id: str, p: dict) -> None:
    """后台线程：逐句合成，边做边把结果写回数据库里的对话行。"""
    db = SessionLocal()
    pack_path = (p.get("pack_path") or "").strip() or "剧情语音"
    name_len = int(p.get("name_len") or 8)
    trim_opts = p.get("trim_opts") or {}
    rows = p.get("rows") or []
    base = VoiceGenPayload(**{k: p.get(k) for k in
                              ("engine", "voice_id", "rate", "pitch", "volume")})
    done = fail = 0
    try:
        for i, raw in enumerate(rows):
            jobs.gate(job_id)          # 暂停原地等；取消抛 JobCanceled
            row = DialogueJobRow(**raw)
            text = (row.content or "").strip()
            dlg = None
            if row.dialogue_id:
                dlg = (db.query(StoryNodeDialogue)
                       .filter(StoryNodeDialogue.id == int(row.dialogue_id)).first())
            label = (text[:12] + "…") if len(text) > 12 else text
            if not text:
                fail += 1
                jobs.step(job_id, ok=False,
                          result={"index": i, "dialogue_id": row.dialogue_id,
                                  "ok": False, "error": "内容为空"})
                continue
            try:
                cfg = _resolve_cfg(db, row, base)
                sound = _synth_one(db, text, cfg, pack_path, name_len, trim_opts)
                if dlg is not None:
                    dlg.voice = sound["url"]
                db.commit()
                done += 1
                jobs.step(job_id, ok=True, audio=sound["url"],
                          result={"index": i, "dialogue_id": row.dialogue_id, "ok": True,
                                  "speaker_id": row.speaker_id, "text": text,
                                  "sound": sound},
                          message=f"{i + 1}/{len(rows)} · {label}")
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                fail += 1
                msg = f"{exc}"[:300]
                # 失败也写回这一行（前端把 ERR: 前缀标红），别让用户第二天
                # 打开发现某几句依旧没声音却没有任何痕迹。
                if dlg is not None:
                    try:
                        dlg.voice = "ERR:" + msg
                        db.commit()
                    except Exception:  # noqa: BLE001
                        db.rollback()
                jobs.step(job_id, ok=False,
                          result={"index": i, "dialogue_id": row.dialogue_id,
                                  "ok": False, "speaker_id": row.speaker_id,
                                  "text": text, "error": msg},
                          message=f"{i + 1}/{len(rows)} · 失败：{label}")
        status = "done" if not fail else ("partial" if done else "error")
        jobs.finish(job_id, status=status,
                    message=(f"全部完成：{done} 句" if not fail
                             else f"完成 {done} 句，失败 {fail} 句"))
    finally:
        db.close()
