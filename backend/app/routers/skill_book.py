from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.equipment import Equipment
from ..models.skill import Skill
from ..models.skill_book import CharacterSkillBook, UserCharacterSkillBook
from ..models.user import UserCharacter
from ..models.character import Character

router = APIRouter(prefix="/api/skill-books", tags=["技能书"])

SKILL_BOOK_CAPACITY = 4  # 每人最多装备 4 本技能书


def _serialize_book(book, db, owner_key, owner_id):
    sk = db.query(Skill).filter(Skill.id == book.skill_id).first()
    return {
        "id": book.id,
        owner_key: owner_id,
        "skill_id": book.skill_id,
        "slot_index": book.slot_index or 1,
        "skill": {
            "id": sk.id, "name": sk.name, "skill_type": sk.skill_type,
            "element": sk.element, "power": sk.power, "mp_cost": sk.mp_cost,
            "rage_cost": sk.rage_cost or 0, "is_ultimate": sk.is_ultimate or 0,
            "target_type": sk.target_type, "effects": sk.effects,
            "image": sk.image, "description": sk.description,
            "required_level": sk.required_level,
        } if sk else None,
    }


def _equip_book(db, model, owner_field, owner_id, skill_id: int, slot_index: Optional[int]):
    if not db.query(Skill).filter(Skill.id == skill_id).first():
        raise HTTPException(status_code=404, detail="技能书不存在（请先在后台「技能书」中创建）")

    rows = db.query(model).filter(getattr(model, owner_field) == owner_id).all()

    # 同一本技能书不能重复装备
    dup = next((r for r in rows if r.skill_id == skill_id), None)
    if dup:
        return dup

    if slot_index is not None:
        idx = slot_index
        occ = next((r for r in rows if (r.slot_index or 1) == idx), None)
        if occ:
            db.delete(occ)
            db.flush()
    else:
        used = {r.slot_index or 1 for r in rows}
        idx = next((i for i in range(1, SKILL_BOOK_CAPACITY + 1) if i not in used), None)
        if idx is None:
            raise HTTPException(status_code=400, detail=f"技能书槽位已满（最多 {SKILL_BOOK_CAPACITY} 本）")

    book = model(**{owner_field: owner_id}, skill_id=skill_id, slot_index=idx)
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


# ===================== 模板人物技能书 =====================

@router.get("/character/{character_id}", response_model=list[dict])
def list_character_books(character_id: int, db: Session = Depends(get_db)):
    rows = db.query(CharacterSkillBook).filter(CharacterSkillBook.character_id == character_id).all()
    return [_serialize_book(r, db, "character_id", r.character_id) for r in sorted(rows, key=lambda x: x.slot_index or 1)]


@router.post("/character/{character_id}", response_model=dict, status_code=201)
def equip_character_book(character_id: int, data: dict, db: Session = Depends(get_db)):
    skill_id = data.get("skill_id")
    slot_index = data.get("slot_index")
    if not skill_id:
        raise HTTPException(status_code=400, detail="缺少 skill_id")
    book = _equip_book(db, CharacterSkillBook, "character_id", character_id, int(skill_id),
                       int(slot_index) if slot_index else None)
    return _serialize_book(book, db, "character_id", character_id)


@router.delete("/character/{character_id}/slot/{slot_index}", status_code=204)
def unequip_character_book(character_id: int, slot_index: int, db: Session = Depends(get_db)):
    rows = db.query(CharacterSkillBook).filter(
        CharacterSkillBook.character_id == character_id,
        CharacterSkillBook.slot_index == slot_index,
    ).all()
    if not rows:
        raise HTTPException(status_code=404, detail="该槽位未装备技能书")
    for r in rows:
        db.delete(r)
    db.commit()


# ===================== 运行时玩家角色技能书 =====================

@router.get("/user-character/{uc_id}", response_model=list[dict])
def list_uc_books(uc_id: int, db: Session = Depends(get_db)):
    rows = db.query(UserCharacterSkillBook).filter(UserCharacterSkillBook.user_character_id == uc_id).all()
    return [_serialize_book(r, db, "user_character_id", r.user_character_id) for r in sorted(rows, key=lambda x: x.slot_index or 1)]


@router.post("/user-character/{uc_id}", response_model=dict, status_code=201)
def equip_uc_book(uc_id: int, data: dict, db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    skill_id = data.get("skill_id")
    slot_index = data.get("slot_index")
    if not skill_id:
        raise HTTPException(status_code=400, detail="缺少 skill_id")
    book = _equip_book(db, UserCharacterSkillBook, "user_character_id", uc_id, int(skill_id),
                       int(slot_index) if slot_index else None)
    return _serialize_book(book, db, "user_character_id", uc_id)


@router.delete("/user-character/{uc_id}/slot/{slot_index}", status_code=204)
def unequip_uc_book(uc_id: int, slot_index: int, db: Session = Depends(get_db)):
    rows = db.query(UserCharacterSkillBook).filter(
        UserCharacterSkillBook.user_character_id == uc_id,
        UserCharacterSkillBook.slot_index == slot_index,
    ).all()
    if not rows:
        raise HTTPException(status_code=404, detail="该槽位未装备技能书")
    for r in rows:
        db.delete(r)
    db.commit()


# ===================== 模板 → 玩家角色 复制/同步 =====================

def copy_character_books_to_uc(db, character_id: int, uc_id: int) -> int:
    """新建玩家角色时，把模板人物配置的技能书复制过去（保证前后台一致）。"""
    rows = db.query(CharacterSkillBook).filter(CharacterSkillBook.character_id == character_id).all()
    n = 0
    for r in rows:
        exists = db.query(UserCharacterSkillBook).filter(
            UserCharacterSkillBook.user_character_id == uc_id,
            UserCharacterSkillBook.skill_id == r.skill_id,
        ).first()
        if exists:
            continue
        db.add(UserCharacterSkillBook(
            user_character_id=uc_id, skill_id=r.skill_id, slot_index=r.slot_index or 1,
        ))
        n += 1
    if n:
        db.commit()
    return n


@router.post("/sync/{uc_id}", response_model=dict)
def sync_uc_books_from_template(uc_id: int, db: Session = Depends(get_db)):
    """把某个玩家角色的技能书重置为模板人物的配置（后台一键同步）。"""
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    db.query(UserCharacterSkillBook).filter(UserCharacterSkillBook.user_character_id == uc_id).delete()
    db.commit()
    n = copy_character_books_to_uc(db, uc.base_character_id, uc_id)
    return {"synced": n}
