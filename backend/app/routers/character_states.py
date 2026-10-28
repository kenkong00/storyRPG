from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.character_state import CharacterState, CharacterStateBinding
from ..schemas.character_state import (
    CharacterStateCreate, CharacterStateUpdate, CharacterStateResponse,
    CharacterStateBindingCreate, CharacterStateBindingResponse,
)

router = APIRouter(prefix="/api/character-states", tags=["人物状态管理"])


@router.get("/", response_model=list[CharacterStateResponse])
def list_states(
    state_type: Optional[str] = Query(None, description="expression / battle"),
    category_path: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(CharacterState)
    if state_type:
        query = query.filter(CharacterState.state_type == state_type)
    if category_path:
        query = query.filter(
            (CharacterState.category_path == category_path) |
            (CharacterState.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(CharacterState.id).all()


@router.get("/{state_id}", response_model=CharacterStateResponse)
def get_state(state_id: int, db: Session = Depends(get_db)):
    s = db.query(CharacterState).filter(CharacterState.id == state_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="状态不存在")
    return s


@router.post("/", response_model=CharacterStateResponse, status_code=201)
def create_state(data: CharacterStateCreate, db: Session = Depends(get_db)):
    s = CharacterState(**data.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.put("/{state_id}", response_model=CharacterStateResponse)
def update_state(state_id: int, data: CharacterStateUpdate, db: Session = Depends(get_db)):
    s = db.query(CharacterState).filter(CharacterState.id == state_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="状态不存在")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(s, k, v)
    s.updated_at = datetime.now().isoformat()
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{state_id}", status_code=204)
def delete_state(state_id: int, db: Session = Depends(get_db)):
    s = db.query(CharacterState).filter(CharacterState.id == state_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="状态不存在")
    db.delete(s)
    db.commit()


# ===== 状态绑定人物 =====

@router.get("/{state_id}/bindings", response_model=list[CharacterStateBindingResponse])
def list_bindings(state_id: int, db: Session = Depends(get_db)):
    return db.query(CharacterStateBinding).filter(CharacterStateBinding.state_id == state_id).all()


@router.post("/{state_id}/bindings", response_model=CharacterStateBindingResponse, status_code=201)
def bind_state(state_id: int, data: CharacterStateBindingCreate, db: Session = Depends(get_db)):
    s = db.query(CharacterState).filter(CharacterState.id == state_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="状态不存在")
    existing = db.query(CharacterStateBinding).filter(
        CharacterStateBinding.state_id == state_id,
        CharacterStateBinding.character_id == data.character_id,
    ).first()
    if existing:
        return existing
    b = CharacterStateBinding(state_id=state_id, **data.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@router.delete("/bindings/{binding_id}", status_code=204)
def unbind_state(binding_id: int, db: Session = Depends(get_db)):
    b = db.query(CharacterStateBinding).filter(CharacterStateBinding.id == binding_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="绑定不存在")
    db.delete(b)
    db.commit()


# 批量设置某状态的绑定人物
@router.post("/{state_id}/bindings/batch")
def batch_set_bindings(state_id: int, data: dict, db: Session = Depends(get_db)):
    """批量设置状态绑定的人物。请求体: { character_ids: [int,...] } 替换原有绑定"""
    character_ids = data.get("character_ids", [])
    db.query(CharacterStateBinding).filter(CharacterStateBinding.state_id == state_id).delete()
    for cid in character_ids:
        db.add(CharacterStateBinding(state_id=state_id, character_id=cid))
    db.commit()
    return {"ok": True, "count": len(character_ids)}


# 查询某人物的所有绑定状态（前台/对话用）
@router.get("/by-character/{character_id}", response_model=list[CharacterStateResponse])
def get_states_by_character(character_id: int, db: Session = Depends(get_db)):
    bindings = db.query(CharacterStateBinding).filter(CharacterStateBinding.character_id == character_id).all()
    state_ids = [b.state_id for b in bindings]
    if not state_ids:
        return []
    return db.query(CharacterState).filter(CharacterState.id.in_(state_ids)).all()
