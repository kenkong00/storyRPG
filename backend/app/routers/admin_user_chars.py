"""后台管理员专用：玩家运行时角色(user_characters)的装备与背包读写。

前台玩家角色(kong 等)的数据存在 user_characters / user_character_equipments /
user_character_inventory 三张表，与后台"人物管理"编辑的模板人物(characters 表)
是两套互相隔离的系统。

后台管理前端(Admin.get/post/...)目前不携带任何鉴权 token，且本系统也没有
require_admin 机制，因此这些路由保持"开放"以与现有后台行为一致——它们复用了
users.py 中玩家自身端点完全相同的读写逻辑，只是去掉了 require_user 限制，
让后台管理员可以直接查看/编辑任意玩家角色的装备与背包。

槽位容量与 users.py 的 USER_SLOT_CAPACITY 保持一致（技能书=4）。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.user import UserCharacter, UserCharacterEquipment, UserCharacterInventory
from ..models.equipment import Equipment
from ..models.item import Item
from ..schemas.user import (
    UserCharEquipCreate, UserCharEquipResponse,
    UserCharInventoryCreate, UserCharInventoryUpdate, UserCharInventoryResponse,
)
# 复用玩家端定义的槽位容量，确保前后台一致
from .users import USER_SLOT_CAPACITY

router = APIRouter(prefix="/api/admin/user-characters", tags=["后台-玩家角色"])


# ===== 列表：所有玩家运行时角色 =====
@router.get("", response_model=list[dict])
def list_user_characters(db: Session = Depends(get_db)):
    rows = db.query(UserCharacter).order_by(UserCharacter.id).all()
    result = []
    for uc in rows:
        # 统计装备与背包数量，便于后台快速浏览
        eq_count = db.query(UserCharacterEquipment).filter(
            UserCharacterEquipment.user_character_id == uc.id
        ).count()
        inv_count = db.query(UserCharacterInventory).filter(
            UserCharacterInventory.user_character_id == uc.id
        ).count()
        result.append({
            "id": uc.id,
            "user_id": uc.user_id,
            "custom_name": uc.custom_name,
            "base_character_id": uc.base_character_id,
            "level": uc.level,
            "hp": uc.hp,
            "mp": uc.mp,
            "exp": uc.exp,
            "equip_count": eq_count,
            "inventory_count": inv_count,
        })
    return result


# ===== 装备（多槽位） =====
@router.get("/{uc_id}/equipments", response_model=list[dict])
def get_user_char_equipments(uc_id: int, db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
    rows = db.query(UserCharacterEquipment).filter(
        UserCharacterEquipment.user_character_id == uc_id
    ).all()
    result = []
    for r in rows:
        eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
        result.append({
            "id": r.id,
            "user_character_id": r.user_character_id,
            "equipment_id": r.equipment_id,
            "slot": r.slot,
            "slot_index": r.slot_index or 1,
            "equipment": {
                "id": eq.id, "name": eq.name, "equipment_type": eq.equipment_type,
                "rarity": eq.rarity, "description": eq.description, "image": eq.image,
                "stat_bonuses": eq.stat_bonuses, "affix_ids": eq.affix_ids,
                "skill_ids": eq.skill_ids, "required_realm_level": eq.required_realm_level,
            } if eq else None,
        })
    return result


@router.post("/{uc_id}/equipments", response_model=UserCharEquipResponse, status_code=201)
def equip_user_char(uc_id: int, data: UserCharEquipCreate, db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
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
            raise HTTPException(status_code=400, detail=f"{data.slot}槽位已满（容量{cap}）")
    ce = UserCharacterEquipment(
        user_character_id=uc_id, equipment_id=data.equipment_id,
        slot=data.slot, slot_index=idx,
    )
    db.add(ce)
    db.commit()
    db.refresh(ce)
    return ce


@router.delete("/{uc_id}/equipments", status_code=204)
def unequip_user_char(
    uc_id: int,
    slot: str,
    equipment_id: Optional[int] = None,
    slot_index: Optional[int] = None,
    db: Session = Depends(get_db),
):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
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


# ===== 背包（物品 + 装备 + 技能书） =====
@router.get("/{uc_id}/inventory", response_model=list[dict])
def get_user_char_inventory(uc_id: int, db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
    rows = db.query(UserCharacterInventory).filter(
        UserCharacterInventory.user_character_id == uc_id
    ).all()
    result = []
    for r in rows:
        name = f"#{r.item_id}"; image = None; rarity = None
        item_type = None; desc = None
        stat_bonuses = None; affix_ids = None; skill_ids = None
        if r.item_kind == "equipment":
            eq = db.query(Equipment).filter(Equipment.id == r.item_id).first()
            if eq:
                name = eq.name; image = eq.image; rarity = eq.rarity
                item_type = eq.equipment_type; desc = eq.description
                stat_bonuses = eq.stat_bonuses; affix_ids = eq.affix_ids
                skill_ids = eq.skill_ids
        else:
            it = db.query(Item).filter(Item.id == r.item_id).first()
            if it:
                name = it.name; image = it.image; rarity = it.rarity
                item_type = it.item_type; desc = it.description
        result.append({
            "id": r.id,
            "user_character_id": r.user_character_id,
            "item_id": r.item_id,
            "item_kind": r.item_kind,
            "quantity": r.quantity,
            "name": name,
            "image": image,
            "rarity": rarity,
            "item_type": item_type,
            "description": desc,
            "stat_bonuses": stat_bonuses,
            "affix_ids": affix_ids,
            "skill_ids": skill_ids,
        })
    return result


@router.post("/{uc_id}/inventory", response_model=UserCharInventoryResponse, status_code=201)
def add_user_char_inventory(
    uc_id: int, data: UserCharInventoryCreate, db: Session = Depends(get_db),
):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
    # 校验目标确实存在
    if data.item_kind == "equipment":
        eq = db.query(Equipment).filter(Equipment.id == data.item_id).first()
        if not eq:
            raise HTTPException(status_code=404, detail="装备不存在")
    else:
        it = db.query(Item).filter(Item.id == data.item_id).first()
        if not it:
            raise HTTPException(status_code=404, detail="物品不存在")
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


@router.delete("/{uc_id}/inventory/{inv_id}", status_code=204)
def remove_user_char_inventory(uc_id: int, inv_id: int, db: Session = Depends(get_db)):
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
    inv = db.query(UserCharacterInventory).filter(
        UserCharacterInventory.id == inv_id,
        UserCharacterInventory.user_character_id == uc_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="背包物品不存在")
    db.delete(inv)
    db.commit()


@router.put("/{uc_id}/inventory/{inv_id}", response_model=UserCharInventoryResponse)
def update_user_char_inventory(
    uc_id: int, inv_id: int, data: UserCharInventoryUpdate,
    db: Session = Depends(get_db),
):
    """更新背包物品数量。quantity <= 0 则删除该背包物品。"""
    uc = db.query(UserCharacter).filter(UserCharacter.id == uc_id).first()
    if not uc:
        raise HTTPException(status_code=404, detail="玩家角色不存在")
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
            return {"id": inv_id, "user_character_id": uc_id,
                    "item_id": inv.item_id, "item_kind": inv.item_kind, "quantity": 0}
        inv.quantity = data.quantity
    db.commit()
    db.refresh(inv)
    return inv
