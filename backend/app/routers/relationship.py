from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.relationship import CharacterRelationship, RelationshipEvent
from ..schemas.relationship import (
    RelationshipCreate, RelationshipUpdate, RelationshipResponse,
    RelationshipEventCreate, RelationshipEventResponse,
)

router = APIRouter(prefix="/api/relationships", tags=["关系系统"])


@router.get("/", response_model=list[RelationshipResponse])
def list_relationships(
    character_id: Optional[int] = Query(None, description="按人物A筛选"),
    related_character_id: Optional[int] = Query(None, description="按人物B筛选"),
    relationship_type: Optional[str] = Query(None, description="按关系类型筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(CharacterRelationship)
    if character_id:
        query = query.filter(CharacterRelationship.character_id == character_id)
    if related_character_id:
        query = query.filter(CharacterRelationship.related_character_id == related_character_id)
    if relationship_type:
        query = query.filter(CharacterRelationship.relationship_type == relationship_type)
    return query.all()


@router.get("/{relationship_id}", response_model=RelationshipResponse)
def get_relationship(relationship_id: int, db: Session = Depends(get_db)):
    rel = db.query(CharacterRelationship).filter(CharacterRelationship.id == relationship_id).first()
    if not rel:
        raise HTTPException(status_code=404, detail="关系不存在")
    return rel


@router.get("/between/{char_a}/{char_b}", response_model=RelationshipResponse)
def get_relationship_between(char_a: int, char_b: int, db: Session = Depends(get_db)):
    """获取两个人物之间的关系（双向查找）"""
    rel = db.query(CharacterRelationship).filter(
        (CharacterRelationship.character_id == char_a) & (CharacterRelationship.related_character_id == char_b)
    ).first()
    if not rel:
        rel = db.query(CharacterRelationship).filter(
            (CharacterRelationship.character_id == char_b) & (CharacterRelationship.related_character_id == char_a)
        ).first()
    if not rel:
        raise HTTPException(status_code=404, detail="关系不存在")
    return rel


@router.post("/", response_model=RelationshipResponse, status_code=201)
def create_relationship(data: RelationshipCreate, db: Session = Depends(get_db)):
    if data.character_id == data.related_character_id:
        raise HTTPException(status_code=400, detail="不能与自己建立关系")
    rel = CharacterRelationship(**data.model_dump())
    db.add(rel)
    db.commit()
    db.refresh(rel)
    return rel


@router.put("/{relationship_id}", response_model=RelationshipResponse)
def update_relationship(relationship_id: int, data: RelationshipUpdate, db: Session = Depends(get_db)):
    rel = db.query(CharacterRelationship).filter(CharacterRelationship.id == relationship_id).first()
    if not rel:
        raise HTTPException(status_code=404, detail="关系不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(rel, key, value)
    db.commit()
    db.refresh(rel)
    return rel


@router.delete("/{relationship_id}", status_code=204)
def delete_relationship(relationship_id: int, db: Session = Depends(get_db)):
    rel = db.query(CharacterRelationship).filter(CharacterRelationship.id == relationship_id).first()
    if not rel:
        raise HTTPException(status_code=404, detail="关系不存在")
    db.delete(rel)
    db.commit()


# --- 关系事件 ---

@router.get("/{relationship_id}/events", response_model=list[RelationshipEventResponse])
def get_relationship_events(relationship_id: int, db: Session = Depends(get_db)):
    return db.query(RelationshipEvent).filter(RelationshipEvent.relationship_id == relationship_id).all()


@router.post("/{relationship_id}/events", response_model=RelationshipEventResponse, status_code=201)
def add_relationship_event(relationship_id: int, data: RelationshipEventCreate, db: Session = Depends(get_db)):
    event = RelationshipEvent(relationship_id=relationship_id, **data.model_dump())
    db.add(event)
    # 同时更新好感度
    rel = db.query(CharacterRelationship).filter(CharacterRelationship.id == relationship_id).first()
    if rel:
        rel.favorability = max(-100, min(100, rel.favorability + data.change_value))
    db.commit()
    db.refresh(event)
    return event