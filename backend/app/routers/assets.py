# -*- coding: utf-8 -*-
"""统一素材库 API。

  GET    /api/assets                列表（按类型 / 来源 / 关键词 / 主体 / 状态）
  GET    /api/assets/facets         左侧栏计数（跟当前搜索条件联动）
  GET    /api/assets/{id}           详情（含「被谁引用」）
  PATCH  /api/assets/{id}           改类型 / 名称 / 标签 / 状态
  DELETE /api/assets/{id}           删除（有引用时先拦一次，force=true 才硬删）
  POST   /api/assets/sync           扫磁盘补漏（历史文件 / 手动拷进来的）

前端入口：js/modules/asset_picker.js —— 全站所有「选图片」都走它。
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.asset import Asset
from ..models.character import Character
from ..services import asset_store
from ..services.asset_usages import usage_index, usages_of

router = APIRouter(prefix="/api/assets", tags=["素材库"])

IMMUTABLE_ORIGINS = {"ai": "AI 生成", "upload": "本地上传", "import": "外部导入"}


def _d(a: Asset, char_map: dict | None = None) -> dict:
    subject_name = a.subject_name
    if a.subject_type == "character" and a.subject_id and char_map:
        subject_name = char_map.get(a.subject_id) or subject_name
    return {
        "id": a.id,
        "url": a.url,
        "filename": a.filename,
        "kind": a.kind or "other",
        "kind_label": asset_store.KINDS.get(a.kind or "other", "其他"),
        "origin": a.origin or "upload",
        "origin_label": IMMUTABLE_ORIGINS.get(a.origin or "upload", "外部导入"),
        "source": a.source,
        "subject_type": a.subject_type,
        "subject_id": a.subject_id,
        "subject_name": subject_name,
        "name": a.name,
        "category": a.category,
        "tags": a.tags,
        "variant": a.variant,
        "variant_name": a.variant_name,
        "width": a.width,
        "height": a.height,
        "bytes": a.bytes,
        "status": a.status or "draft",
        "prompt": a.prompt,
        "negative": a.negative,
        "model_preset": a.model_preset,
        "job_id": a.job_id,
        "seed": a.seed,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


def _base_query(db: Session, kind: Optional[str], origin: Optional[str],
                subject_type: Optional[str], subject_id: Optional[int],
                q: Optional[str], status: Optional[str], url: Optional[str] = None):
    query = db.query(Asset)
    if url:
        query = query.filter(Asset.url == url)
    if status and status != "all":
        if status == "usable":
            query = query.filter(Asset.status != "archived")
        else:
            query = query.filter(Asset.status == status)
    else:
        query = query.filter(Asset.status != "archived")
    if kind and kind != "all":
        kinds = [k for k in kind.split(",") if k]
        if kinds:
            query = query.filter(Asset.kind.in_(kinds))
    if origin and origin != "all":
        origins = [o for o in origin.split(",") if o]
        if origins:
            query = query.filter(Asset.origin.in_(origins))
    if subject_type:
        query = query.filter(Asset.subject_type == subject_type)
    if subject_id:
        query = query.filter(Asset.subject_id == subject_id)
    if q:
        like = f"%{q.strip()}%"
        conds = [
            Asset.filename.like(like),
            Asset.name.like(like),
            Asset.subject_name.like(like),
            Asset.tags.like(like),
            Asset.prompt.like(like),
            Asset.category.like(like),
        ]
        # 素材表里的 subject_name 可能是空的（老图只存了 id），
        # 所以搜「小小」时还得去业务表里把同名主体的 id 捞出来一起匹配。
        for stype, model in _subject_models().items():
            try:
                ids = [r.id for r in db.query(model).filter(model.name.like(like)).all()]
            except Exception:  # noqa: BLE001
                ids = []
            if ids:
                conds.append(and_(Asset.subject_type == stype, Asset.subject_id.in_(ids)))
        query = query.filter(or_(*conds))
    return query


def _subject_models():
    """主体类型 → 模型（用于按名字反查主体 id）。"""
    from ..models.scene import Scene
    from ..models.item import Item
    return {"character": Character, "scene": Scene, "item": Item}


@router.get("")
def list_assets(
    kind: Optional[str] = Query(None, description="portrait/pose/scene/item/monster/ui/icon/other，逗号分隔"),
    origin: Optional[str] = Query(None, description="ai/upload/import，逗号分隔"),
    subject_type: Optional[str] = Query(None),
    subject_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    url: Optional[str] = Query(None, description="按访问路径精确查（槽位控件补尺寸用）"),
    status: str = Query("usable", description="usable（默认，隐藏已弃用）/draft/final/archived/all"),
    sort: str = Query("new", description="new/old/name"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    char_map = {c.id: c.name for c in db.query(Character).all()}
    query = _base_query(db, kind, origin, subject_type, subject_id, q, status, url)
    total = query.count()

    if sort == "old":
        query = query.order_by(Asset.created_at.asc(), Asset.id.asc())
    elif sort == "name":
        query = query.order_by(Asset.subject_name.asc(), Asset.id.desc())
    else:
        query = query.order_by(Asset.id.desc())

    items = query.offset(offset).limit(limit).all()
    return {"items": [_d(a, char_map) for a in items], "total": total,
            "offset": offset, "limit": limit}


@router.get("/facets")
def facets(
    kind: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    subject_type: Optional[str] = Query(None),
    subject_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    status: str = Query("usable"),
    db: Session = Depends(get_db),
):
    """左侧栏计数。与列表用同一套筛选条件，只是把 kind / origin 自身排除，
    这样点「人物动作」时其它类型的数量还在，不会全变 0。"""
    kind_rows = (_base_query(db, None, origin, subject_type, subject_id, q, status)
                 .with_entities(Asset.kind, func.count(Asset.id))
                 .group_by(Asset.kind).all())
    origin_rows = (_base_query(db, kind, None, subject_type, subject_id, q, status)
                   .with_entities(Asset.origin, func.count(Asset.id))
                   .group_by(Asset.origin).all())

    kinds = [{"key": k or "other", "label": asset_store.KINDS.get(k or "other", "其他"),
              "count": n} for k, n in kind_rows]
    kinds.sort(key=lambda x: -x["count"])
    origins = [{"key": o or "upload", "label": IMMUTABLE_ORIGINS.get(o or "upload", "外部导入"),
                "count": n} for o, n in origin_rows]
    origins.sort(key=lambda x: -x["count"])
    return {
        "kinds": kinds,
        "origins": origins,
        "total": sum(k["count"] for k in kinds),
        "subjects": _subjects(db, kind),
    }


def _subjects(db: Session, kind: Optional[str]):
    """「画的是谁」的归拢，供选择器左栏二级展开（人物 / 场景 …）。"""
    query = db.query(Asset).filter(Asset.status != "archived", Asset.subject_type.isnot(None))
    if kind and kind != "all":
        ks = [k for k in kind.split(",") if k]
        if ks:
            query = query.filter(Asset.kind.in_(ks))
    rows = (query.with_entities(Asset.subject_type, Asset.subject_id,
                                Asset.subject_name, func.count(Asset.id))
            .group_by(Asset.subject_type, Asset.subject_id, Asset.subject_name).all())
    char_map = {c.id: c.name for c in db.query(Character).all()}
    out = []
    for st, sid, sname, n in rows:
        if st == "character" and sid:
            sname = char_map.get(sid) or sname or f"人物#{sid}"
        out.append({"subject_type": st, "subject_id": sid,
                    "subject_name": sname or "未命名", "count": n})
    out.sort(key=lambda x: -x["count"])
    return out[:40]


@router.get("/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_db)):
    a = db.query(Asset).filter(Asset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="素材不存在")
    char_map = {c.id: c.name for c in db.query(Character).all()}
    d = _d(a, char_map)
    d["usages"] = usages_of(db, a.url)
    return d


@router.get("/{asset_id}/usages")
def get_usages(asset_id: int, db: Session = Depends(get_db)):
    a = db.query(Asset).filter(Asset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="素材不存在")
    return {"url": a.url, "usages": usages_of(db, a.url)}


class AssetPatch(BaseModel):
    kind: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    status: Optional[str] = None
    subject_type: Optional[str] = None
    subject_id: Optional[int] = None
    subject_name: Optional[str] = None


@router.patch("/{asset_id}")
def patch_asset(asset_id: int, payload: AssetPatch, db: Session = Depends(get_db)):
    a = db.query(Asset).filter(Asset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="素材不存在")
    for field in ("kind", "name", "category", "tags", "status",
                  "subject_type", "subject_id", "subject_name"):
        value = getattr(payload, field)
        if value is not None:
            setattr(a, field, value)
    db.commit()
    return {"ok": True, "asset": _d(a)}


@router.delete("/{asset_id}")
def delete_asset(asset_id: int, remove_file: bool = Query(True),
                 force: bool = Query(False), db: Session = Depends(get_db)):
    a = db.query(Asset).filter(Asset.id == asset_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="素材不存在")
    refs = usages_of(db, a.url)
    if refs and not force:
        raise HTTPException(status_code=409, detail={
            "message": f"这张图正在被 {len(refs)} 处使用，先换掉再删，或强制删除。",
            "usages": refs,
        })
    url = a.url
    db.delete(a)
    db.commit()
    if remove_file:
        path = asset_store.url_to_path(url)
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True}


@router.post("/sync")
def sync_disk(db: Session = Depends(get_db)):
    """扫磁盘补漏：把还没登记的图片收进素材库。"""
    report = asset_store.sync_from_disk(db)
    moved = asset_store.backfill_from_generated_images(db)
    report["merged_legacy"] = moved
    return {"ok": True, **report}


@router.get("/usage-index/all")
def full_usage_index(db: Session = Depends(get_db)):
    """整库引用索引（素材管理页用它在卡片上标「被 N 处使用」）。"""
    idx = usage_index(db)
    return {"index": {url: len(v) for url, v in idx.items()}}
