from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.character import Character, CharacterAttribute
from ..schemas.character import (
    CharacterCreate, CharacterUpdate, CharacterResponse,
    CharacterAttributeCreate, CharacterAttributeResponse,
)
from .tag import ensure_character_name_tag, delete_character_tag

router = APIRouter(prefix="/api/characters", tags=["人物系统"])


@router.get("/", response_model=list[CharacterResponse])
def list_characters(
    character_type: Optional[str] = Query(None, description="筛选类型: player/npc/enemy/ally"),
    is_party_member: Optional[int] = Query(None, description="筛选是否在队伍中"),
    is_alive: Optional[int] = Query(None, description="筛选是否存活"),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Character)
    if character_type:
        query = query.filter(Character.character_type == character_type)
    if is_party_member is not None:
        query = query.filter(Character.is_party_member == is_party_member)
    if is_alive is not None:
        query = query.filter(Character.is_alive == is_alive)
    if category_path:
        query = query.filter(
            (Character.category_path == category_path) |
            (Character.category_path.like(f"{category_path}/%"))
        )
    return query.all()


@router.get("/player", response_model=CharacterResponse)
def get_player(db: Session = Depends(get_db)):
    """获取玩家角色"""
    char = db.query(Character).filter(Character.character_type == "player").first()
    if not char:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
    return char


@router.get("/party", response_model=list[CharacterResponse])
def get_party(db: Session = Depends(get_db)):
    """获取当前队伍成员"""
    return db.query(Character).filter(Character.is_party_member == 1, Character.is_alive == 1).all()


@router.get("/activated/players", response_model=list[CharacterResponse])
def list_activated_players(db: Session = Depends(get_db)):
    """获取所有已激活的玩家角色（供游戏设置选择可选玩家组合）"""
    return db.query(Character).filter(
        Character.character_type == "player",
        Character.is_activated == 1,
    ).all()


@router.get("/{character_id}", response_model=CharacterResponse)
def get_character(character_id: int, db: Session = Depends(get_db)):
    char = db.query(Character).filter(Character.id == character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    return char


@router.post("/", response_model=CharacterResponse, status_code=201)
def create_character(data: CharacterCreate, db: Session = Depends(get_db)):
    char = Character(**data.model_dump())
    db.add(char)
    db.commit()
    db.refresh(char)
    # 自动创建人物名称标签
    try:
        ensure_character_name_tag(db, char.id, char.name)
    except Exception:
        pass
    return char


@router.put("/{character_id}", response_model=CharacterResponse)
def update_character(character_id: int, data: CharacterUpdate, db: Session = Depends(get_db)):
    char = db.query(Character).filter(Character.id == character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    old_name = char.name
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(char, key, value)
    db.commit()
    db.refresh(char)
    # 若改名则同步更新人物名称标签
    if "name" in update_data and update_data["name"] and update_data["name"] != old_name:
        try:
            ensure_character_name_tag(db, char.id, char.name, old_name=old_name)
        except Exception:
            pass
    return char


@router.delete("/{character_id}", status_code=204)
def delete_character(character_id: int, db: Session = Depends(get_db)):
    char = db.query(Character).filter(Character.id == character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    # 删除对应的人物名称标签
    try:
        delete_character_tag(db, character_id)
    except Exception:
        pass
    db.delete(char)
    db.commit()


# --- 玩家激活（仅 player 类型，激活后才能被前台用户选择） ---

@router.post("/{character_id}/activate", response_model=CharacterResponse)
def activate_character(character_id: int, db: Session = Depends(get_db)):
    """激活玩家角色（is_activated=1）"""
    char = db.query(Character).filter(Character.id == character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    if char.character_type != "player":
        raise HTTPException(status_code=400, detail="仅 player 类型可激活")
    char.is_activated = 1
    db.commit()
    db.refresh(char)
    return char


@router.post("/{character_id}/deactivate", response_model=CharacterResponse)
def deactivate_character(character_id: int, db: Session = Depends(get_db)):
    """取消激活玩家角色（is_activated=0）"""
    char = db.query(Character).filter(Character.id == character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    char.is_activated = 0
    db.commit()
    db.refresh(char)
    return char


# --- 人物属性 ---

@router.get("/{character_id}/attributes", response_model=list[CharacterAttributeResponse])
def get_attributes(character_id: int, db: Session = Depends(get_db)):
    return db.query(CharacterAttribute).filter(CharacterAttribute.character_id == character_id).all()


@router.post("/{character_id}/attributes", response_model=CharacterAttributeResponse, status_code=201)
def set_attribute(character_id: int, data: CharacterAttributeCreate, db: Session = Depends(get_db)):
    existing = db.query(CharacterAttribute).filter(
        CharacterAttribute.character_id == character_id,
        CharacterAttribute.attr_key == data.attr_key,
    ).first()
    if existing:
        existing.attr_value = data.attr_value
        db.commit()
        db.refresh(existing)
        return existing
    attr = CharacterAttribute(character_id=character_id, **data.model_dump())
    db.add(attr)
    db.commit()
    db.refresh(attr)
    return attr