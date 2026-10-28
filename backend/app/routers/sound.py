from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.sound import Sound
from ..schemas.sound import SoundCreate, SoundUpdate, SoundResponse

router = APIRouter(prefix="/api/sounds", tags=["声音管理"])


@router.get("/", response_model=list[SoundResponse])
def list_sounds(
    category: Optional[str] = Query(None, description="筛选分类: voice/bgm"),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Sound)
    if category:
        query = query.filter(Sound.category == category)
    if category_path:
        query = query.filter(
            (Sound.category_path == category_path) |
            (Sound.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(Sound.id.desc()).all()


@router.get("/{sound_id}", response_model=SoundResponse)
def get_sound(sound_id: int, db: Session = Depends(get_db)):
    sound = db.query(Sound).filter(Sound.id == sound_id).first()
    if not sound:
        raise HTTPException(status_code=404, detail="声音不存在")
    return sound


@router.post("/", response_model=SoundResponse, status_code=201)
def create_sound(data: SoundCreate, db: Session = Depends(get_db)):
    sound = Sound(**data.model_dump())
    db.add(sound)
    db.commit()
    db.refresh(sound)
    return sound


@router.put("/{sound_id}", response_model=SoundResponse)
def update_sound(sound_id: int, data: SoundUpdate, db: Session = Depends(get_db)):
    sound = db.query(Sound).filter(Sound.id == sound_id).first()
    if not sound:
        raise HTTPException(status_code=404, detail="声音不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(sound, key, value)
    db.commit()
    db.refresh(sound)
    return sound


@router.delete("/{sound_id}", status_code=204)
def delete_sound(sound_id: int, db: Session = Depends(get_db)):
    sound = db.query(Sound).filter(Sound.id == sound_id).first()
    if not sound:
        raise HTTPException(status_code=404, detail="声音不存在")
    db.delete(sound)
    db.commit()