"""语音任务接口：一批台词 → 合成 → 识别裁剪 → 存成角色声音包。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.sound import Sound
from ..models.voice_task import VoiceTask, VoiceTaskLine
from ..services import voice_task_runner as runner

router = APIRouter(prefix="/api/voice-tasks", tags=["语音任务"])

AUDIO_KEYS = ("engine", "voice_id", "rate", "pitch", "volume",
              "pack_path", "name_len", "trim_opts", "name", "character_id")


def _char_name(db: Session, cid: int) -> str:
    if not cid:
        return ""
    ch = db.query(Character).filter(Character.id == int(cid)).first()
    return (ch.name if ch else "") or ""


def _task_dict(db: Session, t: VoiceTask) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "character_id": t.character_id or 0,
        "character_name": _char_name(db, t.character_id or 0),
        "engine": t.engine or "",
        "voice_id": t.voice_id or "",
        "rate": t.rate or 0,
        "pitch": t.pitch or 0,
        "volume": t.volume or 0,
        "pack_path": t.pack_path or "",
        "name_len": t.name_len or 8,
        "trim_opts": t.trim_opts or "",
        "status": t.status or "idle",
        "total": t.total or 0,
        "done": t.done or 0,
        "message": t.message or "",
        "running": runner.is_running(t.id),
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def _line_dict(l: VoiceTaskLine) -> dict:
    return {
        "id": l.id,
        "task_id": l.task_id,
        "sort": l.sort or 0,
        "text": l.text or "",
        "status": l.status or "pending",
        "sound_id": l.sound_id or 0,
        "duration": round(float(l.duration or 0), 2),
        "error": l.error or "",
    }


def _get(db: Session, task_id: int) -> VoiceTask:
    t = db.query(VoiceTask).filter(VoiceTask.id == int(task_id)).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return t


# ----------------------------------------------------------------------------
@router.get("/")
def list_tasks(db: Session = Depends(get_db)):
    rows = db.query(VoiceTask).order_by(VoiceTask.id.desc()).all()
    return [_task_dict(db, t) for t in rows]


@router.post("/", status_code=201)
def create_task(payload: dict, db: Session = Depends(get_db)):
    t = VoiceTask()
    for k in AUDIO_KEYS:
        if payload.get(k) is not None:
            setattr(t, k, payload[k])
    if not t.name:
        t.name = "未命名语音任务"
    if not t.pack_path and t.character_id:
        nm = _char_name(db, t.character_id)
        t.pack_path = f"角色语音/{nm}" if nm else "角色语音"
    db.add(t)
    db.commit()
    db.refresh(t)
    # 顺手把一开始就贴进来的台词建好
    texts = runner.split_lines(payload.get("texts") or "")
    _add_lines(db, t.id, texts)
    db.refresh(t)
    return _task_dict(db, t)


@router.get("/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)):
    t = _get(db, task_id)
    lines = (db.query(VoiceTaskLine)
             .filter(VoiceTaskLine.task_id == t.id)
             .order_by(VoiceTaskLine.sort.asc(), VoiceTaskLine.id.asc()).all())
    out = _task_dict(db, t)
    out["lines"] = [_line_dict(l) for l in lines]
    # 产物顺带把 url 带上，前端可以直接试听
    sids = [l.sound_id for l in lines if l.sound_id]
    sounds = {}
    if sids:
        for s in db.query(Sound).filter(Sound.id.in_(sids)).all():
            sounds[s.id] = {"id": s.id, "name": s.name, "url": s.file_url,
                            "duration": s.duration, "description": s.description}
    for l in out["lines"]:
        l["sound"] = sounds.get(l["sound_id"])
    return out


@router.put("/{task_id}")
def update_task(task_id: int, payload: dict, db: Session = Depends(get_db)):
    t = _get(db, task_id)
    for k in AUDIO_KEYS:
        if payload.get(k) is not None:
            setattr(t, k, payload[k])
    db.commit()
    db.refresh(t)
    return _task_dict(db, t)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, with_sounds: bool = False, db: Session = Depends(get_db)):
    t = _get(db, task_id)
    runner.stop(t.id)
    lines = db.query(VoiceTaskLine).filter(VoiceTaskLine.task_id == t.id).all()
    if with_sounds:
        ids = [l.sound_id for l in lines if l.sound_id]
        if ids:
            for s in db.query(Sound).filter(Sound.id.in_(ids)).all():
                db.delete(s)
    for l in lines:
        db.delete(l)
    db.delete(t)
    db.commit()


# ---------------------------- 台词行 ----------------------------------------
def _add_lines(db: Session, task_id: int, texts: list[str]) -> int:
    base = (db.query(VoiceTaskLine)
            .filter(VoiceTaskLine.task_id == task_id)
            .count())
    n = 0
    for i, txt in enumerate(texts):
        db.add(VoiceTaskLine(task_id=task_id, sort=base + i, text=txt, status="pending"))
        n += 1
    if n:
        t = db.query(VoiceTask).filter(VoiceTask.id == task_id).first()
        if t:
            t.total = base + n
            if t.status in ("done", "stopped", "error"):
                t.status = "idle"
    db.commit()
    return n


@router.post("/{task_id}/lines")
def add_lines(task_id: int, payload: dict, db: Session = Depends(get_db)):
    _get(db, task_id)
    raw = payload.get("texts")
    if isinstance(raw, list):
        texts = [str(x).strip() for x in raw if str(x).strip()]
    else:
        texts = runner.split_lines(payload.get("text") or "")
    if not texts:
        raise HTTPException(status_code=400, detail="没有可添加的内容")
    n = _add_lines(db, task_id, texts)
    return {"added": n}


@router.put("/{task_id}/lines/{line_id}")
def update_line(task_id: int, line_id: int, payload: dict, db: Session = Depends(get_db)):
    l = (db.query(VoiceTaskLine)
         .filter(VoiceTaskLine.id == int(line_id), VoiceTaskLine.task_id == int(task_id)).first())
    if not l:
        raise HTTPException(status_code=404, detail="这一条不存在")
    txt = payload.get("text")
    if txt is not None and str(txt).strip() != (l.text or "").strip():
        l.text = str(txt).strip()
        # 内容改了，之前的结果就作废了 —— 留着旧音频只会让人误以为已是最新
        l.status = "pending"
        l.error = ""
        l.sound_id = 0
        l.duration = 0.0
    db.commit()
    return _line_dict(l)


@router.post("/{task_id}/lines/delete")
def delete_lines(task_id: int, payload: dict, db: Session = Depends(get_db)):
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="没有选中要删除的条目")
    n = (db.query(VoiceTaskLine)
         .filter(VoiceTaskLine.task_id == int(task_id),
                 VoiceTaskLine.id.in_([int(x) for x in ids]))
         .delete(synchronize_session=False))
    t = _get(db, task_id)
    left = db.query(VoiceTaskLine).filter(VoiceTaskLine.task_id == t.id).all()
    t.total = len(left)
    t.done = sum(1 for l in left if l.status == "done")
    db.commit()
    return {"deleted": n, "total": t.total}


# ---------------------------- 运行 ------------------------------------------
@router.post("/{task_id}/run")
def run_task(task_id: int, payload: Optional[dict] = None, db: Session = Depends(get_db)):
    t = _get(db, task_id)
    p = payload or {}
    only = p.get("only_ids")
    # 「全部重新生成」：把已 done 的行也重置回 pending，并清掉旧产物，
    # 这样新一轮会用最新配置把整包从头到尾重跑一遍。
    # 「重跑选中」（only_ids）：只重置并重跑勾选的那几条，其余行不动。
    if p.get("rerun_all") or only:
        if p.get("rerun_all"):
            lines = db.query(VoiceTaskLine).filter(VoiceTaskLine.task_id == t.id).all()
        else:
            ids = [int(x) for x in only]
            lines = (db.query(VoiceTaskLine)
                     .filter(VoiceTaskLine.task_id == t.id,
                             VoiceTaskLine.id.in_(ids)).all())
        old_ids = [l.sound_id for l in lines if l.sound_id]
        if old_ids:
            for s in db.query(Sound).filter(Sound.id.in_(old_ids)).all():
                db.delete(s)
        for l in lines:
            l.status = "pending"
            l.sound_id = 0
            l.duration = 0.0
            l.error = ""
        if p.get("rerun_all"):
            t.done = 0
            t.total = len(lines)
        db.commit()
    ok = runner.start(t.id, rerun_failed=bool(p.get("rerun_failed")),
                      only_ids=[int(x) for x in only] if only else None)
    if not ok:
        raise HTTPException(status_code=409, detail="这个任务正在跑，等它结束再点")
    db.refresh(t)
    t.status = "running"
    t.message = "已排队…"
    db.commit()
    return {"ok": True, "running": True}


@router.post("/batch-delete")
def batch_delete_tasks(payload: dict, db: Session = Depends(get_db)):
    """批量删除任务：停掉后台线程，删任务 + 台词行，可选连同产物声音一起删。"""
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="没有选中要删除的任务")
    ids = [int(x) for x in ids]
    tasks = db.query(VoiceTask).filter(VoiceTask.id.in_(ids)).all()
    for t in tasks:
        runner.stop(t.id)
    lines = (db.query(VoiceTaskLine)
             .filter(VoiceTaskLine.task_id.in_(ids)).all())
    if payload.get("with_sounds"):
        sids = [l.sound_id for l in lines if l.sound_id]
        if sids:
            for s in db.query(Sound).filter(Sound.id.in_(sids)).all():
                db.delete(s)
    for l in lines:
        db.delete(l)
    for t in tasks:
        db.delete(t)
    db.commit()
    return {"deleted": len(tasks)}


@router.post("/{task_id}/stop")
def stop_task(task_id: int, db: Session = Depends(get_db)):
    _get(db, task_id)
    return {"ok": runner.stop(int(task_id))}


@router.get("/{task_id}/progress")
def task_progress(task_id: int, db: Session = Depends(get_db)):
    """轮询用：只回进度和每行的状态，不带波形之类的重数据。"""
    t = _get(db, task_id)
    lines = (db.query(VoiceTaskLine)
             .filter(VoiceTaskLine.task_id == t.id)
             .order_by(VoiceTaskLine.sort.asc(), VoiceTaskLine.id.asc()).all())
    return {
        "id": t.id,
        "status": t.status or "idle",
        "done": t.done or 0,
        "total": t.total or 0,
        "message": t.message or "",
        "running": runner.is_running(t.id),
        "lines": [_line_dict(l) for l in lines],
    }
