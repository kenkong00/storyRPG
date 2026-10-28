# -*- coding: utf-8 -*-
"""生成图片管理（图片管理 → AI 生成图）。

现在它只是**统一素材库的一个视图**：查询条件固定 origin='ai'。
数据本身存在 assets 表里（见 models/asset.py），所以这里不再自己写库，
避免「AI 图一套表、上传图一套表」。

  GET  /api/generated-images/summary      按人物汇总（含未归属）
  GET  /api/generated-images              按人物 / 来源 / 关键词取图
  POST /api/generated-images/scan         扫磁盘补漏（含合并旧 generated_images）
  DELETE /api/generated-images/{id}       删记录 + 删磁盘文件
"""

import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.asset import Asset
from ..models.character import Character
from ..models.character_pose import CharacterPoseImage
from ..services import asset_store
from ..appearance import defs

router = APIRouter(prefix="/api/generated-images", tags=["生成图片管理"])

GENERATED_DIR = asset_store.GENERATED_DIR


def _d(a: Asset) -> dict:
    return {
        "id": a.id, "url": a.url, "filename": a.filename,
        "width": a.width, "height": a.height,
        "source": a.source or "manual",
        "character_id": a.subject_id if a.subject_type == "character" else None,
        "character_name": a.subject_name,
        "pose_id": a.variant, "pose_name": a.variant_name, "category": a.category,
        "prompt": a.prompt, "model_preset": a.model_preset,
        "job_id": a.job_id, "seed": a.seed,
        "created_at": a.created_at,
    }


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    """按人物汇总：每个人物多少张、最新一张是什么时候。"""
    rows = (db.query(Asset.subject_id, Asset.subject_name,
                     func.count(Asset.id), func.max(Asset.created_at))
            .filter(Asset.origin == "ai", Asset.status != "archived")
            .group_by(Asset.subject_id, Asset.subject_name).all())

    char_map = {c.id: c.name for c in db.query(Character).all()}

    chars = []
    unattached = 0
    total = 0
    for cid, cname, cnt, latest in rows:
        total += cnt
        name = char_map.get(cid) or cname or (f"人物#{cid}" if cid else "")
        if not cid:
            unattached += cnt
            continue
        chars.append({"character_id": cid, "name": name, "count": cnt, "latest": latest,
                      "exists": cid in char_map})
    chars.sort(key=lambda x: (-x["count"], x["name"]))

    src_rows = (db.query(Asset.source, func.count(Asset.id))
                .filter(Asset.origin == "ai", Asset.status != "archived")
                .group_by(Asset.source).all())
    return {
        "total": total,
        "characters": chars,
        "unattached": unattached,
        "by_source": {s or "manual": n for s, n in src_rows},
    }


@router.get("")
def list_images(character_id: Optional[int] = Query(None),
                source: Optional[str] = Query(None),
                q: Optional[str] = Query(None),
                only_unattached: bool = Query(False),
                limit: int = Query(500, ge=1, le=3000),
                db: Session = Depends(get_db)):
    query = db.query(Asset).filter(Asset.origin == "ai", Asset.status != "archived")
    if only_unattached:
        query = query.filter(Asset.subject_id.is_(None))
    elif character_id is not None:
        query = query.filter(Asset.subject_type == "character",
                             Asset.subject_id == character_id)
    if source:
        query = query.filter(Asset.source == source)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (Asset.prompt.like(like)) |
            (Asset.variant_name.like(like)) |
            (Asset.subject_name.like(like)) |
            (Asset.filename.like(like))
        )
    total = query.count()
    items = query.order_by(Asset.id.desc()).limit(limit).all()

    char_map = {c.id: c.name for c in db.query(Character).all()}
    out = []
    for it in items:
        d = _d(it)
        if it.subject_type == "character" and it.subject_id and char_map.get(it.subject_id):
            d["character_name"] = char_map[it.subject_id]
        if it.variant:
            pose = defs.option_of("pose", it.variant)
            if pose:
                d["pose_name"] = pose.get("name") or d["pose_name"]
                d["category"] = pose.get("cat") or d["category"]
        out.append(d)
    return {"items": out, "total": total}


@router.get("/pose-library")
def pose_library_images(limit: int = Query(1000, ge=1, le=5000),
                        db: Session = Depends(get_db)):
    """人物动作表情图（来自 character_pose_images，用于按人物核对覆盖率）。"""
    imgs = db.query(CharacterPoseImage).order_by(CharacterPoseImage.id.desc()).limit(limit).all()
    char_map = {c.id: c.name for c in db.query(Character).all()}
    return {"items": [{
        **{k: getattr(i, k) for k in
           ("id", "character_id", "pose_id", "pose_name", "category", "image_url",
            "width", "height", "prompt", "model_preset", "created_at")},
        "character_name": char_map.get(i.character_id, ""),
    } for i in imgs]}


@router.delete("/{img_id}")
def delete_image(img_id: int, remove_file: bool = Query(True),
                 db: Session = Depends(get_db)):
    img = db.query(Asset).filter(Asset.id == img_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="记录不存在")
    url = img.url
    db.delete(img)
    db.commit()
    # 顺带清掉人物动作表情里指向同一张图的记录
    if url:
        for p in db.query(CharacterPoseImage).filter(CharacterPoseImage.image_url == url).all():
            db.delete(p)
        db.commit()
    if remove_file and url:
        path = asset_store.url_to_path(url)
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True}


@router.post("/scan")
def scan_disk(db: Session = Depends(get_db)):
    """扫磁盘补漏 + 合并旧 generated_images 表。"""
    rpt = asset_store.sync_from_disk(db)
    merged = asset_store.backfill_from_generated_images(db)
    return {"ok": True, "added": rpt["added"], "merged": merged}
