from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.animation import AnimationEffect
from ..schemas.animation import AnimationEffectCreate, AnimationEffectUpdate, AnimationEffectResponse

router = APIRouter(prefix="/api/animation-effects", tags=["动效展示"])


@router.get("/", response_model=list[AnimationEffectResponse])
def list_effects(
    category: Optional[str] = Query(None, description="筛选分类"),
    effect_type: Optional[str] = Query(None, description="筛选效果类型"),
    tag_ids: Optional[str] = Query(None, description="逗号分隔的标签ID"),
    tag_match: Optional[str] = Query("any", description="any=任一匹配, all=全部匹配"),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(AnimationEffect)
    if category:
        query = query.filter(AnimationEffect.category == category)
    if effect_type:
        query = query.filter(AnimationEffect.effect_type == effect_type)
    if category_path:
        query = query.filter(
            (AnimationEffect.category_path == category_path) |
            (AnimationEffect.category_path.like(f"{category_path}/%"))
        )
    if tag_ids:
        ids = [int(x) for x in tag_ids.split(",") if x.strip()]
        if ids:
            results = []
            for effect in query.all():
                if not effect.tags:
                    continue
                try:
                    import json
                    effect_tag_ids = json.loads(effect.tags)
                except (json.JSONDecodeError, TypeError):
                    continue
                if tag_match == "all":
                    if all(tid in effect_tag_ids for tid in ids):
                        results.append(effect)
                else:
                    if any(tid in effect_tag_ids for tid in ids):
                        results.append(effect)
            return results
    return query.order_by(AnimationEffect.id.desc()).all()


@router.post("/batch-update-category")
def batch_update_category(data: dict, db: Session = Depends(get_db)):
    """批量更新动效分类"""
    ids = data.get("ids", [])
    category = data.get("category", "")
    if not ids or not category:
        raise HTTPException(status_code=400, detail="参数不完整")
    updated = 0
    for eid in ids:
        effect = db.query(AnimationEffect).filter(AnimationEffect.id == eid).first()
        if effect:
            effect.category = category
            updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/batch-update-tags")
def batch_update_tags(data: dict, db: Session = Depends(get_db)):
    """批量更新动效标签（追加模式）"""
    ids = data.get("ids", [])
    tag_ids = data.get("tag_ids", [])
    mode = data.get("mode", "add")  # add / remove / replace
    if not ids or not tag_ids:
        raise HTTPException(status_code=400, detail="参数不完整")
    import json
    updated = 0
    for eid in ids:
        effect = db.query(AnimationEffect).filter(AnimationEffect.id == eid).first()
        if not effect:
            continue
        current = []
        if effect.tags:
            try:
                current = json.loads(effect.tags)
            except (json.JSONDecodeError, TypeError):
                current = []
        if mode == "add":
            for tid in tag_ids:
                if tid not in current:
                    current.append(tid)
        elif mode == "remove":
            current = [t for t in current if t not in tag_ids]
        elif mode == "replace":
            current = list(tag_ids)
        effect.tags = json.dumps(current)
        updated += 1
    db.commit()
    return {"updated": updated}


@router.get("/{effect_id}", response_model=AnimationEffectResponse)
def get_effect(effect_id: int, db: Session = Depends(get_db)):
    effect = db.query(AnimationEffect).filter(AnimationEffect.id == effect_id).first()
    if not effect:
        raise HTTPException(status_code=404, detail="动效不存在")
    return effect


@router.post("/", response_model=AnimationEffectResponse, status_code=201)
def create_effect(data: AnimationEffectCreate, db: Session = Depends(get_db)):
    effect = AnimationEffect(**data.model_dump())
    db.add(effect)
    db.commit()
    db.refresh(effect)
    return effect


@router.put("/{effect_id}", response_model=AnimationEffectResponse)
def update_effect(effect_id: int, data: AnimationEffectUpdate, db: Session = Depends(get_db)):
    effect = db.query(AnimationEffect).filter(AnimationEffect.id == effect_id).first()
    if not effect:
        raise HTTPException(status_code=404, detail="动效不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(effect, key, value)
    db.commit()
    db.refresh(effect)
    return effect


@router.delete("/{effect_id}", status_code=204)
def delete_effect(effect_id: int, db: Session = Depends(get_db)):
    effect = db.query(AnimationEffect).filter(AnimationEffect.id == effect_id).first()
    if not effect:
        raise HTTPException(status_code=404, detail="动效不存在")
    db.delete(effect)
    db.commit()


@router.post("/batch-delete", status_code=204)
def batch_delete_effects(data: dict, db: Session = Depends(get_db)):
    """批量删除动效"""
    ids = data.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="ID列表为空")
    db.query(AnimationEffect).filter(AnimationEffect.id.in_(ids)).delete(synchronize_session=False)
    db.commit()