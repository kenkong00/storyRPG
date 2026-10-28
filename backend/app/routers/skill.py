from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.skill import Skill, CharacterSkill, LevelUpTable
from ..schemas.skill import (
    SkillCreate, SkillUpdate, SkillResponse,
    CharacterSkillCreate, CharacterSkillResponse,
    LevelUpTableResponse,
)

router = APIRouter(prefix="/api/skills", tags=["技能系统"])


# --- 技能 CRUD ---

@router.get("/", response_model=list[SkillResponse])
def list_skills(
    skill_type: Optional[str] = Query(None),
    element: Optional[str] = Query(None),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Skill)
    if skill_type:
        query = query.filter(Skill.skill_type == skill_type)
    if element:
        query = query.filter(Skill.element == element)
    if category_path:
        query = query.filter(
            (Skill.category_path == category_path) |
            (Skill.category_path.like(f"{category_path}/%"))
        )
    return query.all()


@router.get("/{skill_id}", response_model=SkillResponse)
def get_skill(skill_id: int, db: Session = Depends(get_db)):
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    return skill


@router.post("/", response_model=SkillResponse, status_code=201)
def create_skill(data: SkillCreate, db: Session = Depends(get_db)):
    skill = Skill(**data.model_dump())
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill


@router.put("/{skill_id}", response_model=SkillResponse)
def update_skill(skill_id: int, data: SkillUpdate, db: Session = Depends(get_db)):
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(skill, key, value)
    db.commit()
    db.refresh(skill)
    return skill


@router.delete("/{skill_id}", status_code=204)
def delete_skill(skill_id: int, db: Session = Depends(get_db)):
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="技能不存在")
    db.delete(skill)
    db.commit()


# --- 人物技能 ---

@router.get("/character/{character_id}", response_model=list[CharacterSkillResponse])
def get_character_skills(character_id: int, db: Session = Depends(get_db)):
    return db.query(CharacterSkill).filter(CharacterSkill.character_id == character_id).all()


@router.post("/character/{character_id}/learn", response_model=CharacterSkillResponse, status_code=201)
def learn_skill(character_id: int, data: CharacterSkillCreate, db: Session = Depends(get_db)):
    existing = db.query(CharacterSkill).filter(
        CharacterSkill.character_id == character_id,
        CharacterSkill.skill_id == data.skill_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="已经学会该技能")
    cs = CharacterSkill(character_id=character_id, skill_id=data.skill_id, skill_level=data.skill_level)
    db.add(cs)
    db.commit()
    db.refresh(cs)
    return cs


# --- 升级表 ---

@router.get("/levels", response_model=list[LevelUpTableResponse])
def get_level_up_table(db: Session = Depends(get_db)):
    return db.query(LevelUpTable).order_by(LevelUpTable.level).all()


@router.get("/levels/{level}", response_model=LevelUpTableResponse)
def get_level_info(level: int, db: Session = Depends(get_db)):
    info = db.query(LevelUpTable).filter(LevelUpTable.level == level).first()
    if not info:
        raise HTTPException(status_code=404, detail="等级数据不存在")
    return info