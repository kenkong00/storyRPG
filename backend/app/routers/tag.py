from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.tag import Tag, ImageTag
from ..schemas.tag import (
    TagCreate, TagUpdate, TagResponse,
    ImageTagAssign, ImageTagRemove,
)

router = APIRouter(prefix="/api/tags", tags=["标签管理"])


# --- 标签 CRUD ---

@router.get("/", response_model=list[TagResponse])
def list_tags(
    category: Optional[str] = Query(None, description="按分类筛选: character/item/scene/plot"),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Tag)
    if category:
        query = query.filter(Tag.category == category)
    if category_path:
        query = query.filter(
            (Tag.category_path == category_path) |
            (Tag.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(Tag.category, Tag.name).all()


@router.get("/{tag_id}", response_model=TagResponse)
def get_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    return tag


@router.post("/", response_model=TagResponse, status_code=201)
def create_tag(data: TagCreate, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name == data.name, Tag.category == data.category).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"分类下已存在同名标签: {data.name}")
    tag = Tag(**data.model_dump())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagResponse)
def update_tag(tag_id: int, data: TagUpdate, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    for key, value in data.model_dump().items():
        if value is not None:
            setattr(tag, key, value)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    db.delete(tag)
    db.commit()


# --- 图片标签关联 ---

@router.get("/image/{image_filename}")
def get_image_tags(image_filename: str, db: Session = Depends(get_db)):
    """获取某张图片的所有标签"""
    rows = db.query(ImageTag).filter(ImageTag.image_filename == image_filename).all()
    tag_ids = [r.tag_id for r in rows]
    tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []
    return {"image_filename": image_filename, "tags": [
        {"id": t.id, "name": t.name, "category": t.category} for t in tags
    ]}


@router.post("/images/batch-tags")
def get_batch_image_tags(image_filenames: list[str], db: Session = Depends(get_db)):
    """批量获取多张图片的标签。请求体为文件名列表。
    返回 {filename: [{id, name, category}, ...]}
    """
    if not image_filenames:
        return {}
    rows = db.query(ImageTag).filter(ImageTag.image_filename.in_(image_filenames)).all()
    tag_ids = list({r.tag_id for r in rows})
    tags_map = {t.id: t for t in db.query(Tag).filter(Tag.id.in_(tag_ids)).all()} if tag_ids else {}
    result = {}
    for r in rows:
        t = tags_map.get(r.tag_id)
        if not t:
            continue
        result.setdefault(r.image_filename, []).append(
            {"id": t.id, "name": t.name, "category": t.category}
        )
    return result


@router.post("/image/assign")
def assign_tags_to_images(data: ImageTagAssign, db: Session = Depends(get_db)):
    """给多张图片批量打标签（已存在的会跳过）"""
    added = 0
    skipped = 0
    for filename in data.image_filenames:
        for tag_id in data.tag_ids:
            existing = db.query(ImageTag).filter(
                ImageTag.image_filename == filename,
                ImageTag.tag_id == tag_id,
            ).first()
            if existing:
                skipped += 1
                continue
            db.add(ImageTag(image_filename=filename, tag_id=tag_id))
            added += 1
    db.commit()
    return {"added": added, "skipped": skipped}


@router.post("/image/remove")
def remove_tags_from_images(data: ImageTagRemove, db: Session = Depends(get_db)):
    """从多张图片移除标签"""
    removed = 0
    for filename in data.image_filenames:
        for tag_id in data.tag_ids:
            row = db.query(ImageTag).filter(
                ImageTag.image_filename == filename,
                ImageTag.tag_id == tag_id,
            ).first()
            if row:
                db.delete(row)
                removed += 1
    db.commit()
    return {"removed": removed}


@router.get("/images/by-tag")
def get_images_by_tags(
    tag_ids: str = Query(..., description="逗号分隔的标签ID"),
    match: str = Query(default="any", description="any=任一匹配, all=全部匹配"),
    db: Session = Depends(get_db),
):
    """按标签筛选图片文件名列表"""
    ids = [int(x) for x in tag_ids.split(",") if x.strip()]
    if not ids:
        return {"image_filenames": [], "count": 0}

    query = db.query(ImageTag).filter(ImageTag.tag_id.in_(ids))
    if match == "all":
        # 全部匹配：每张图片需要拥有所有指定标签
        rows = query.all()
        from collections import Counter
        counter = Counter(r.image_filename for r in rows)
        result = [fn for fn, cnt in counter.items() if cnt == len(ids)]
    else:
        # 任一匹配
        result = list({r.image_filename for r in query.all()})

    return {"image_filenames": result, "count": len(result)}


# --- 内部工具方法（供其他 router 调用） ---

def ensure_character_name_tag(db: Session, character_id: int, name: str, old_name: Optional[str] = None):
    """确保人物名称作为标签存在；若改名则更新旧标签名。"""
    if old_name:
        # 改名：更新已有的人物名标签
        existing = db.query(Tag).filter(
            Tag.source_type == "character",
            Tag.source_id == character_id,
            Tag.category == "character",
        ).first()
        if existing:
            existing.name = name
            db.commit()
            db.refresh(existing)
            return existing
    # 新建
    existing = db.query(Tag).filter(
        Tag.source_type == "character",
        Tag.source_id == character_id,
        Tag.category == "character",
    ).first()
    if existing:
        existing.name = name
        db.commit()
        db.refresh(existing)
        return existing
    tag = Tag(
        name=name,
        category="character",
        is_auto=1,
        source_type="character",
        source_id=character_id,
        description=f"人物「{name}」的自动标签",
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def delete_character_tag(db: Session, character_id: int):
    """删除人物对应的自动标签"""
    tags = db.query(Tag).filter(
        Tag.source_type == "character",
        Tag.source_id == character_id,
    ).all()
    for t in tags:
        db.delete(t)
    db.commit()
