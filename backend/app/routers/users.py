import hashlib
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.user import (
    User, UserGameLibrary, UserCharacter,
    UserCharacterEquipment, UserCharacterInventory,
)
from ..models.game import Game
from ..models.character import Character
from ..models.equipment import Equipment, CharacterEquipment
from ..models.item import Item, CharacterInventory
from .skill_book import copy_character_books_to_uc
from ..schemas.user import (
    UserRegister, UserLogin, UserUpdate, UserResponse,
    UserCharacterCreate, UserCharacterUpdate, UserCharacterResponse,
    UserCharEquipCreate, UserCharEquipResponse,
    UserCharInventoryCreate, UserCharInventoryUpdate, UserCharInventoryResponse,
)

router = APIRouter(prefix="/api/users", tags=["用户系统"])


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _gen_token() -> str:
    return secrets.token_hex(24)


def _get_user_by_token(token: str, db: Session) -> Optional[User]:
    if not token:
        return None
    return db.query(User).filter(User.session_token == token).first()


def require_user(x_user_token: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    user = _get_user_by_token(x_user_token, db)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或登录已失效")
    return user


# ===== 注册 / 登录 / 当前用户 =====

@router.post("/register", response_model=UserResponse)
def register(data: UserRegister, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = User(
        username=data.username,
        password_hash=_hash_password(data.password),
        nickname=data.nickname or data.username,
        avatar=data.avatar,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=dict)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or user.password_hash != _hash_password(data.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = _gen_token()
    user.session_token = token
    user.last_login = datetime.now().isoformat()
    db.commit()
    return {
        "token": token,
        "user": UserResponse.model_validate(user).model_dump(),
    }


@router.post("/logout")
def logout(user: User = Depends(require_user), db: Session = Depends(get_db)):
    user.session_token = None
    db.commit()
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
def get_current_user(user: User = Depends(require_user)):
    return user


@router.put("/me", response_model=UserResponse)
def update_current_user(data: UserUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if data.nickname is not None:
        user.nickname = data.nickname
    if data.avatar is not None:
        user.avatar = data.avatar
    if data.password:
        user.password_hash = _hash_password(data.password)
    db.commit()
    db.refresh(user)
    return user


# ===== 后台管理：用户列表 / 详情 =====

@router.get("/", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.id).all()


@router.get("/{user_id}/detail", response_model=dict)
def get_user_detail(user_id: int, db: Session = Depends(get_db)):
    """后台查看用户详情：游戏清单 + 每游戏角色（含装备/背包）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    library = db.query(UserGameLibrary).filter(UserGameLibrary.user_id == user_id).all()
    games_info = []
    for lib in library:
        game = db.query(Game).filter(Game.id == lib.game_id).first()
        chars = db.query(UserCharacter).filter(
            UserCharacter.user_id == user_id,
            UserCharacter.game_id == lib.game_id,
        ).all()
        chars_info = []
        for c in chars:
            base = db.query(Character).filter(Character.id == c.base_character_id).first()
            equips = db.query(UserCharacterEquipment).filter(UserCharacterEquipment.user_character_id == c.id).all()
            equip_details = []
            for ce in equips:
                eq = db.query(Equipment).filter(Equipment.id == ce.equipment_id).first()
                equip_details.append({
                    "slot": ce.slot, "slot_index": ce.slot_index or 1,
                    "equipment_id": ce.equipment_id,
                    "name": eq.name if eq else None, "image": eq.image if eq else None,
                })
            invs = db.query(UserCharacterInventory).filter(UserCharacterInventory.user_character_id == c.id).all()
            inv_details = []
            for inv in invs:
                name = f"#{inv.item_id}"
                image = None
                if inv.item_kind == "equipment":
                    eq = db.query(Equipment).filter(Equipment.id == inv.item_id).first()
                    if eq:
                        name = eq.name; image = eq.image
                else:
                    it = db.query(Item).filter(Item.id == inv.item_id).first()
                    if it:
                        name = it.name; image = it.image
                inv_details.append({
                    "item_id": inv.item_id, "item_kind": inv.item_kind,
                    "quantity": inv.quantity, "name": name, "image": image,
                })
            chars_info.append({
                "id": c.id, "custom_name": c.custom_name,
                "base_character_name": base.name if base else None,
                "level": c.level, "realm_level": c.realm_level,
                "hp": c.hp, "max_hp": c.max_hp, "mp": c.mp, "max_mp": c.max_mp,
                "attack": c.attack, "defense": c.defense, "speed": c.speed, "luck": c.luck,
                "recovery": c.recovery, "spirit": c.spirit, "crit_rate": c.crit_rate,
                "last_story_node_id": c.last_story_node_id,
                "equipments": equip_details, "inventory": inv_details,
                "updated_at": c.updated_at,
            })
        games_info.append({
            "game_id": lib.game_id, "game_name": game.name if game else None,
            "added_at": lib.added_at, "characters": chars_info,
        })
    return {
        "user": UserResponse.model_validate(user).model_dump(),
        "games": games_info,
    }


# ===== 用户游戏清单 =====

@router.get("/me/library", response_model=list[dict])
def get_my_library(user: User = Depends(require_user), db: Session = Depends(get_db)):
    libs = db.query(UserGameLibrary).filter(UserGameLibrary.user_id == user.id).all()
    result = []
    for lib in libs:
        game = db.query(Game).filter(Game.id == lib.game_id).first()
        if game:
            result.append({
                "library_id": lib.id, "game_id": game.id, "name": game.name,
                "image": game.image, "category_path": game.category_path,
                "is_coming_soon": game.is_coming_soon, "added_at": lib.added_at,
            })
    return result


@router.post("/me/library/{game_id}", status_code=201)
def add_to_library(game_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="游戏不存在")
    existing = db.query(UserGameLibrary).filter(
        UserGameLibrary.user_id == user.id, UserGameLibrary.game_id == game_id,
    ).first()
    if existing:
        return {"ok": True, "message": "已在清单中"}
    db.add(UserGameLibrary(user_id=user.id, game_id=game_id))
    db.commit()
    return {"ok": True}


@router.delete("/me/library/{game_id}", status_code=204)
def remove_from_library(game_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    lib = db.query(UserGameLibrary).filter(
        UserGameLibrary.user_id == user.id, UserGameLibrary.game_id == game_id,
    ).first()
    if not lib:
        raise HTTPException(status_code=404, detail="清单中无此游戏")
    db.delete(lib)
    db.commit()


# ===== 用户角色实例（新建人物） =====

@router.get("/me/characters", response_model=list[UserCharacterResponse])
def get_my_characters(
    game_id: Optional[int] = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    query = db.query(UserCharacter).filter(UserCharacter.user_id == user.id)
    if game_id is not None:
        query = query.filter(UserCharacter.game_id == game_id)
    return query.all()


@router.get("/me/characters/{uc_id}/full", response_model=dict)
def get_my_character_full(uc_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """获取用户角色详情（含基础人物模板信息：portrait/name/title/personality/background_story）"""
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    base = db.query(Character).filter(Character.id == uc.base_character_id).first()
    return {
        "id": uc.id, "user_id": uc.user_id, "game_id": uc.game_id,
        "base_character_id": uc.base_character_id, "custom_name": uc.custom_name,
        "level": uc.level, "realm_level": uc.realm_level, "exp": uc.exp,
        "hp": uc.hp, "max_hp": uc.max_hp, "mp": uc.mp, "max_mp": uc.max_mp,
        "attack": uc.attack, "defense": uc.defense, "speed": uc.speed, "luck": uc.luck,
        "recovery": uc.recovery, "spirit": uc.spirit, "crit_rate": uc.crit_rate,
        "last_story_node_id": uc.last_story_node_id, "last_chapter_id": uc.last_chapter_id,
        "save_data": uc.save_data, "created_at": uc.created_at, "updated_at": uc.updated_at,
        "base_character": {
            "id": base.id, "name": base.name, "title": base.title,
            "portrait_image": base.portrait_image, "character_type": base.character_type,
            "personality": base.personality, "background_story": base.background_story,
            "expressions": base.expressions,
        } if base else None,
    }


@router.post("/me/characters", response_model=UserCharacterResponse, status_code=201)
def create_my_character(data: UserCharacterCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    # 必须先把游戏加入清单才能新建人物
    lib = db.query(UserGameLibrary).filter(
        UserGameLibrary.user_id == user.id, UserGameLibrary.game_id == data.game_id,
    ).first()
    if not lib:
        raise HTTPException(status_code=400, detail="请先把游戏加入清单")
    base = db.query(Character).filter(Character.id == data.base_character_id).first()
    if not base:
        raise HTTPException(status_code=404, detail="人物模板不存在")
    # 不传自定义名称时，直接用模板人物的名字（"直接扮演这个角色"）
    custom_name = (data.custom_name or "").strip() or base.name or "玩家"

    uc = UserCharacter(
        user_id=user.id, game_id=data.game_id,
        base_character_id=data.base_character_id, custom_name=custom_name,
        level=base.level, realm_level=base.realm_level, exp=base.exp,
        hp=base.hp, max_hp=base.max_hp, mp=base.mp, max_mp=base.max_mp,
        attack=base.attack, defense=base.defense, speed=base.speed, luck=base.luck,
        recovery=base.recovery, spirit=base.spirit, crit_rate=base.crit_rate,
    )
    db.add(uc)
    db.commit()
    db.refresh(uc)

    # ===== 从模板人物复制初始装备 / 背包 / 技能书 =====
    # 后台在「人物管理」里配好什么，玩家新建的角色就拿到什么 —— 保证前后台一致
    for ce in db.query(CharacterEquipment).filter(CharacterEquipment.character_id == base.id).all():
        if not db.query(Equipment).filter(Equipment.id == ce.equipment_id).first():
            continue
        db.add(UserCharacterEquipment(
            user_character_id=uc.id, equipment_id=ce.equipment_id,
            slot=ce.slot, slot_index=ce.slot_index or 1,
        ))
    for ci in db.query(CharacterInventory).filter(CharacterInventory.character_id == base.id).all():
        db.add(UserCharacterInventory(
            user_character_id=uc.id, item_id=ci.item_id,
            item_kind=ci.item_kind or "item", quantity=ci.quantity or 1,
        ))
    db.commit()
    copy_character_books_to_uc(db, base.id, uc.id)

    db.refresh(uc)
    return uc


@router.put("/me/characters/{uc_id}", response_model=UserCharacterResponse)
def update_my_character(uc_id: int, data: UserCharacterUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(uc, k, v)
    uc.updated_at = datetime.now().isoformat()
    db.commit()
    db.refresh(uc)
    return uc


@router.delete("/me/characters/{uc_id}", status_code=204)
def delete_my_character(uc_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    db.delete(uc)
    db.commit()


# 存档（保存进度）
@router.post("/me/characters/{uc_id}/save", response_model=UserCharacterResponse)
def save_progress(uc_id: int, data: dict, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    if "last_story_node_id" in data:
        uc.last_story_node_id = data["last_story_node_id"]
    if "last_chapter_id" in data:
        uc.last_chapter_id = data["last_chapter_id"]
    if "save_data" in data:
        uc.save_data = data["save_data"]
    # 可选：同步角色数值
    for k in ("hp", "mp", "exp", "level"):
        if k in data:
            setattr(uc, k, data[k])
    uc.updated_at = datetime.now().isoformat()
    db.commit()
    db.refresh(uc)
    return uc


# ===== 用户角色装备（多槽位） =====

# 各槽位容量：7 个身体部位各 1 / 法宝 4 / 神通 2（set/accessory 为兼容旧数据保留）
# 各槽位容量：7 个身体部位各 1 / 法宝 4 / 技能书 4（技能书=装备里的功法武诀，可装 4 本）
USER_SLOT_CAPACITY = {
    "weapon": 1, "head": 1, "shoulders": 1, "chest": 1,
    "gloves": 1, "pants": 1, "boots": 1,
    "artifact": 4, "skill": 4,
    "set": 1, "accessory": 2,
}


@router.get("/me/characters/{uc_id}/equipments", response_model=list[dict])
def get_my_char_equipments(uc_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    rows = db.query(UserCharacterEquipment).filter(UserCharacterEquipment.user_character_id == uc_id).all()
    result = []
    for r in rows:
        eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
        result.append({
            "id": r.id, "user_character_id": r.user_character_id,
            "equipment_id": r.equipment_id, "slot": r.slot, "slot_index": r.slot_index or 1,
            "equipment": {
                "id": eq.id, "name": eq.name, "equipment_type": eq.equipment_type,
                "rarity": eq.rarity, "description": eq.description, "image": eq.image,
                "stat_bonuses": eq.stat_bonuses, "affix_ids": eq.affix_ids,
                "skill_ids": eq.skill_ids, "required_realm_level": eq.required_realm_level,
            } if eq else None,
        })
    return result


@router.post("/me/characters/{uc_id}/equipments", response_model=UserCharEquipResponse, status_code=201)
def equip_my_char(uc_id: int, data: UserCharEquipCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    eq = db.query(Equipment).filter(Equipment.id == data.equipment_id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="装备不存在")
    if data.slot != eq.equipment_type:
        raise HTTPException(status_code=400, detail="装备类型与槽位不匹配")
    cap = USER_SLOT_CAPACITY.get(data.slot, 1)
    existing = db.query(UserCharacterEquipment).filter(
        UserCharacterEquipment.user_character_id == uc_id,
        UserCharacterEquipment.slot == data.slot,
    ).all()
    for ce in existing:
        if ce.equipment_id == data.equipment_id:
            return ce
    if data.slot_index is not None:
        idx = data.slot_index
        occ = next((ce for ce in existing if (ce.slot_index or 1) == idx), None)
        if occ:
            db.delete(occ); db.flush()
    else:
        used = {ce.slot_index or 1 for ce in existing}
        idx = next((i for i in range(1, cap + 1) if i not in used), None)
        if idx is None:
            raise HTTPException(status_code=400, detail=f"{data.slot}槽位已满")
    ce = UserCharacterEquipment(user_character_id=uc_id, equipment_id=data.equipment_id, slot=data.slot, slot_index=idx)
    db.add(ce)
    db.commit()
    db.refresh(ce)
    return ce


@router.delete("/me/characters/{uc_id}/equipments", status_code=204)
def unequip_my_char(
    uc_id: int,
    slot: str,
    equipment_id: Optional[int] = None,
    slot_index: Optional[int] = None,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    query = db.query(UserCharacterEquipment).filter(
        UserCharacterEquipment.user_character_id == uc_id,
        UserCharacterEquipment.slot == slot,
    )
    if equipment_id is not None:
        query = query.filter(UserCharacterEquipment.equipment_id == equipment_id)
    if slot_index is not None:
        query = query.filter(UserCharacterEquipment.slot_index == slot_index)
    rows = query.all()
    if not rows:
        raise HTTPException(status_code=404, detail="该槽位未装备")
    for r in rows:
        db.delete(r)
    db.commit()


# ===== 用户角色背包 =====

@router.get("/me/characters/{uc_id}/inventory", response_model=list[dict])
def get_my_char_inventory(uc_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    rows = db.query(UserCharacterInventory).filter(UserCharacterInventory.user_character_id == uc_id).all()
    result = []
    for r in rows:
        name = f"#{r.item_id}"; image = None; rarity = None; item_type = None; desc = None
        stat_bonuses = None; affix_ids = None
        if r.item_kind == "equipment":
            eq = db.query(Equipment).filter(Equipment.id == r.item_id).first()
            if eq:
                name = eq.name; image = eq.image; rarity = eq.rarity
                item_type = eq.equipment_type; desc = eq.description
                stat_bonuses = eq.stat_bonuses; affix_ids = eq.affix_ids
        else:
            it = db.query(Item).filter(Item.id == r.item_id).first()
            if it:
                name = it.name; image = it.image; rarity = it.rarity
                item_type = it.item_type; desc = it.description
        result.append({
            "id": r.id, "user_character_id": r.user_character_id,
            "item_id": r.item_id, "item_kind": r.item_kind, "quantity": r.quantity,
            "name": name, "image": image, "rarity": rarity,
            "item_type": item_type, "description": desc,
            "stat_bonuses": stat_bonuses, "affix_ids": affix_ids,
        })
    return result


@router.post("/me/characters/{uc_id}/inventory", response_model=UserCharInventoryResponse, status_code=201)
def add_my_char_inventory(uc_id: int, data: UserCharInventoryCreate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    existing = db.query(UserCharacterInventory).filter(
        UserCharacterInventory.user_character_id == uc_id,
        UserCharacterInventory.item_id == data.item_id,
        UserCharacterInventory.item_kind == data.item_kind,
    ).first()
    if existing:
        existing.quantity += data.quantity
        db.commit()
        db.refresh(existing)
        return existing
    inv = UserCharacterInventory(user_character_id=uc_id, **data.model_dump())
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


@router.delete("/me/characters/{uc_id}/inventory/{inv_id}", status_code=204)
def remove_my_char_inventory(uc_id: int, inv_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    inv = db.query(UserCharacterInventory).filter(
        UserCharacterInventory.id == inv_id,
        UserCharacterInventory.user_character_id == uc_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="背包物品不存在")
    db.delete(inv)
    db.commit()


@router.put("/me/characters/{uc_id}/inventory/{inv_id}", response_model=UserCharInventoryResponse)
def update_my_char_inventory(uc_id: int, inv_id: int, data: UserCharInventoryUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """更新背包物品数量。quantity <= 0 则删除该背包物品。"""
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id, UserCharacter.user_id == user.id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="角色不存在")
    inv = db.query(UserCharacterInventory).filter(
        UserCharacterInventory.id == inv_id,
        UserCharacterInventory.user_character_id == uc_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="背包物品不存在")
    if data.quantity is not None:
        if data.quantity <= 0:
            db.delete(inv)
            db.commit()
            return {"id": inv_id, "user_character_id": uc_id, "item_id": inv.item_id,
                    "item_kind": inv.item_kind, "quantity": 0}
        inv.quantity = data.quantity
    db.commit()
    db.refresh(inv)
    return inv
