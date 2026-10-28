from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.item import Item, CharacterInventory
from ..models.equipment import Equipment
from ..schemas.item import (
    ItemCreate, ItemUpdate, ItemResponse,
    CharacterInventoryCreate, CharacterInventoryResponse,
)

router = APIRouter(prefix="/api/items", tags=["物品系统"])


def serialize_inventory_row(row_id, owner_key, owner_id, item_id, item_kind, quantity, db):
    """把一条背包记录（物品 or 装备）序列化成前后台统一的结构。

    item_kind='equipment' 时 item_id 指向 equipments 表，否则指向 items 表。
    返回结构与 UserCharacterInventory 完全一致，保证后台配置 == 前台显示。
    """
    name = f"#{item_id}"
    image = rarity = item_type = desc = None
    stat_bonuses = affix_ids = None
    if item_kind == "equipment":
        eq = db.query(Equipment).filter(Equipment.id == item_id).first()
        if eq:
            name, image, rarity = eq.name, eq.image, eq.rarity
            item_type, desc = eq.equipment_type, eq.description
            stat_bonuses, affix_ids = eq.stat_bonuses, eq.affix_ids
    else:
        it = db.query(Item).filter(Item.id == item_id).first()
        if it:
            name, image, rarity = it.name, it.image, it.rarity
            item_type, desc = it.item_type, it.description
    return {
        "id": row_id, owner_key: owner_id,
        "item_id": item_id, "item_kind": item_kind or "item", "quantity": quantity,
        "name": name, "image": image, "rarity": rarity,
        "item_type": item_type, "description": desc,
        "stat_bonuses": stat_bonuses, "affix_ids": affix_ids,
    }


# --- 物品 CRUD ---

@router.get("/", response_model=list[ItemResponse])
def list_items(
    item_type: Optional[str] = Query(None),
    rarity: Optional[str] = Query(None),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Item)
    if item_type:
        query = query.filter(Item.item_type == item_type)
    if rarity:
        query = query.filter(Item.rarity == rarity)
    if category_path:
        query = query.filter(
            (Item.category_path == category_path) |
            (Item.category_path.like(f"{category_path}/%"))
        )
    return query.all()


@router.get("/{item_id}", response_model=ItemResponse)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="物品不存在")
    return item


@router.post("/", response_model=ItemResponse, status_code=201)
def create_item(data: ItemCreate, db: Session = Depends(get_db)):
    item = Item(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, data: ItemUpdate, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="物品不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="物品不存在")
    db.delete(item)
    db.commit()


# --- 背包 ---

@router.get("/character/{character_id}/inventory", response_model=list[dict])
def get_inventory(character_id: int, db: Session = Depends(get_db)):
    """模板人物统一背包：物品 + 装备（含详情），结构与前台运行时角色背包一致。"""
    rows = db.query(CharacterInventory).filter(CharacterInventory.character_id == character_id).all()
    return [
        serialize_inventory_row(r.id, "character_id", r.character_id, r.item_id,
                                r.item_kind or "item", r.quantity, db)
        for r in rows
    ]


@router.post("/character/{character_id}/inventory", response_model=CharacterInventoryResponse, status_code=201)
def add_item_to_inventory(character_id: int, data: CharacterInventoryCreate, db: Session = Depends(get_db)):
    kind = (data.item_kind or "item")
    existing = db.query(CharacterInventory).filter(
        CharacterInventory.character_id == character_id,
        CharacterInventory.item_id == data.item_id,
        CharacterInventory.item_kind == kind,
    ).first()
    if existing:
        existing.quantity += data.quantity
        db.commit()
        db.refresh(existing)
        return existing
    payload = data.model_dump(exclude={"character_id"})
    payload["item_kind"] = kind
    inv = CharacterInventory(character_id=character_id, **payload)
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


@router.put("/character/{character_id}/inventory/{inv_id}/equip")
def equip_item(character_id: int, inv_id: int, db: Session = Depends(get_db)):
    """装备/卸下物品"""
    inv = db.query(CharacterInventory).filter(
        CharacterInventory.id == inv_id,
        CharacterInventory.character_id == character_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="物品不存在")
    inv.is_equipped = 1 - inv.is_equipped  # 切换装备状态
    db.commit()
    db.refresh(inv)
    return {"message": "装备状态已切换", "is_equipped": inv.is_equipped}


@router.put("/character/{character_id}/inventory/{inv_id}/quantity")
def update_inventory_quantity(character_id: int, inv_id: int, quantity: int = 0, db: Session = Depends(get_db)):
    """更新背包物品数量（数量<=0则删除）"""
    inv = db.query(CharacterInventory).filter(
        CharacterInventory.id == inv_id,
        CharacterInventory.character_id == character_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="物品不存在")
    if quantity <= 0:
        db.delete(inv)
        db.commit()
        return {"message": "物品已移除"}
    inv.quantity = quantity
    db.commit()
    db.refresh(inv)
    return {"message": "数量已更新", "quantity": inv.quantity}


@router.delete("/character/{character_id}/inventory/{inv_id}", status_code=204)
def remove_inventory_item(character_id: int, inv_id: int, db: Session = Depends(get_db)):
    """从背包移除物品"""
    inv = db.query(CharacterInventory).filter(
        CharacterInventory.id == inv_id,
        CharacterInventory.character_id == character_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="物品不存在")
    db.delete(inv)
    db.commit()