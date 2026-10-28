from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.equipment import Equipment, EquipmentAffix, CharacterEquipment
from ..schemas.equipment import (
    EquipmentCreate, EquipmentUpdate, EquipmentResponse,
    EquipmentAffixCreate, EquipmentAffixUpdate, EquipmentAffixResponse,
    CharacterEquipmentCreate, CharacterEquipmentResponse,
)

router = APIRouter(prefix="/api/equipments", tags=["装备系统"])


# ===== 装备词条 =====

DEFAULT_AFFIXES = [
    ("不灭之躯", "佩戴者无法被杀死，生命值最低降至1", "immune_death", '{"min_hp":1}', 1),
    ("经验加成", "增加经验获取50%", "exp_boost", '{"exp_rate":1.5}', 0),
    ("隐匿修为", "隐藏真实修为境界，他人无法探查", "hide_realm", '{}', 1),
    ("神速", "速度+30", "stat_bonus", '{"speed":30}', 0),
    ("铁壁", "防御+50", "stat_bonus", '{"defense":50}', 0),
    ("嗜血", "攻击时吸取造成伤害的20%为生命值", "lifesteal", '{"rate":0.2}', 1),
    ("灵气亲和", "MP恢复+100%", "mp_regen", '{"rate":2.0}', 0),
    ("暴击精通", "暴击率+20%", "stat_bonus", '{"crit_rate":20}', 0),
    ("闪避大师", "闪避率+15%", "dodge", '{"rate":0.15}', 0),
    ("反伤护盾", "反弹30%受到的伤害", "reflect", '{"rate":0.3}', 1),
    ("破甲", "无视目标50%防御", "armor_pierce", '{"rate":0.5}', 1),
    ("连击", "30%概率追加一次攻击", "extra_attack", '{"rate":0.3}', 1),
    ("复活", "战斗失败后复活一次，恢复50%生命", "revive", '{"hp_rate":0.5}', 1),
    ("灵魂锁链", "免疫位移技能击退效果", "immune_displacement", '{}', 1),
    ("天道庇护", "免疫所有负面状态", "immune_debuff", '{}', 1),
]


@router.get("/affixes", response_model=list[EquipmentAffixResponse])
def list_affixes(
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    """列出所有装备词条，首次访问自动初始化默认词条"""
    affixes = db.query(EquipmentAffix).all()
    if not affixes:
        for name, desc, etype, eval_, special in DEFAULT_AFFIXES:
            db.add(EquipmentAffix(
                name=name, description=desc, effect_type=etype,
                effect_value=eval_, is_special=special,
            ))
        db.commit()
        affixes = db.query(EquipmentAffix).all()
    if category_path:
        affixes = [a for a in affixes if (a.category_path == category_path) or (a.category_path and a.category_path.startswith(f"{category_path}/"))]
    return affixes


@router.post("/affixes", response_model=EquipmentAffixResponse, status_code=201)
def create_affix(data: EquipmentAffixCreate, db: Session = Depends(get_db)):
    affix = EquipmentAffix(**data.model_dump())
    db.add(affix)
    db.commit()
    db.refresh(affix)
    return affix


@router.put("/affixes/{affix_id}", response_model=EquipmentAffixResponse)
def update_affix(affix_id: int, data: EquipmentAffixUpdate, db: Session = Depends(get_db)):
    affix = db.query(EquipmentAffix).filter(EquipmentAffix.id == affix_id).first()
    if not affix:
        raise HTTPException(status_code=404, detail="词条不存在")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(affix, k, v)
    db.commit()
    db.refresh(affix)
    return affix


@router.delete("/affixes/{affix_id}", status_code=204)
def delete_affix(affix_id: int, db: Session = Depends(get_db)):
    affix = db.query(EquipmentAffix).filter(EquipmentAffix.id == affix_id).first()
    if not affix:
        raise HTTPException(status_code=404, detail="词条不存在")
    db.delete(affix)
    db.commit()


# ===== 装备 CRUD =====

@router.get("/", response_model=list[EquipmentResponse])
def list_equipments(
    equipment_type: Optional[str] = Query(None, description="set/accessory/artifact"),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Equipment)
    if equipment_type:
        query = query.filter(Equipment.equipment_type == equipment_type)
    if category_path:
        query = query.filter(
            (Equipment.category_path == category_path) |
            (Equipment.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(Equipment.equipment_type, Equipment.id).all()


@router.get("/{equipment_id}", response_model=EquipmentResponse)
def get_equipment(equipment_id: int, db: Session = Depends(get_db)):
    eq = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="装备不存在")
    return eq


@router.post("/", response_model=EquipmentResponse, status_code=201)
def create_equipment(data: EquipmentCreate, db: Session = Depends(get_db)):
    eq = Equipment(**data.model_dump())
    db.add(eq)
    db.commit()
    db.refresh(eq)
    return eq


@router.put("/{equipment_id}", response_model=EquipmentResponse)
def update_equipment(equipment_id: int, data: EquipmentUpdate, db: Session = Depends(get_db)):
    eq = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="装备不存在")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(eq, k, v)
    db.commit()
    db.refresh(eq)
    return eq


@router.delete("/{equipment_id}", status_code=204)
def delete_equipment(equipment_id: int, db: Session = Depends(get_db)):
    eq = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="装备不存在")
    db.delete(eq)
    db.commit()


# ===== 人物装备 =====

@router.get("/character/{character_id}", response_model=list[dict])
def get_character_equipments(character_id: int, db: Session = Depends(get_db)):
    """获取人物已装备的装备列表（含装备详情）"""
    rows = db.query(CharacterEquipment).filter(
        CharacterEquipment.character_id == character_id
    ).all()
    result = []
    for r in rows:
        eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
        result.append({
            "id": r.id,
            "character_id": r.character_id,
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


# 各槽位容量：7 个身体部位各 1 / 法宝 4 / 技能书 4（set/accessory 为兼容旧数据保留）
SLOT_CAPACITY = {
    "weapon": 1, "head": 1, "shoulders": 1, "chest": 1,
    "gloves": 1, "pants": 1, "boots": 1,
    "artifact": 4, "skill": 4,
    "set": 1, "accessory": 2,
}


@router.post("/character/{character_id}", response_model=CharacterEquipmentResponse, status_code=201)
def equip_to_character(character_id: int, data: CharacterEquipmentCreate, db: Session = Depends(get_db)):
    """给人物装备装备（支持多槽位：套装1/配饰2/法器3）"""
    eq = db.query(Equipment).filter(Equipment.id == data.equipment_id).first()
    if not eq:
        raise HTTPException(status_code=404, detail="装备不存在")

    # 检查槽位与装备类型匹配
    if data.slot != eq.equipment_type:
        raise HTTPException(status_code=400, detail=f"装备类型({eq.equipment_type})与槽位({data.slot})不匹配")

    cap = SLOT_CAPACITY.get(data.slot, 1)
    # 已存在的同槽位记录
    existing = db.query(CharacterEquipment).filter(
        CharacterEquipment.character_id == character_id,
        CharacterEquipment.slot == data.slot,
    ).all()

    # 同一装备已存在于该槽位则直接返回现有记录（不重复添加）
    for ce in existing:
        if ce.equipment_id == data.equipment_id:
            return ce

    # 确定 slot_index
    if data.slot_index is not None:
        idx = data.slot_index
        # 指定槽位已被占用则替换
        occ = next((ce for ce in existing if (ce.slot_index or 1) == idx), None)
        if occ:
            db.delete(occ)
            db.flush()
    else:
        # 自动找空位
        used = {ce.slot_index or 1 for ce in existing}
        idx = next((i for i in range(1, cap + 1) if i not in used), None)
        if idx is None:
            raise HTTPException(status_code=400, detail=f"{data.slot}槽位已满（容量{cap}）")

    ce = CharacterEquipment(character_id=character_id, equipment_id=data.equipment_id, slot=data.slot, slot_index=idx)
    db.add(ce)
    db.commit()
    db.refresh(ce)
    return ce


@router.post("/character/{character_id}/bulk", response_model=list[CharacterEquipmentResponse], status_code=201)
def bulk_equip_to_character(character_id: int, data: dict, db: Session = Depends(get_db)):
    """批量给人物装备多件装备。
    请求体: { slot: "set"/"accessory"/"artifact", equipment_ids: [int, ...] }
    会跳过已存在同槽位同装备的记录。
    """
    slot = data.get("slot")
    equipment_ids = data.get("equipment_ids", [])
    if not slot or slot not in SLOT_CAPACITY:
        raise HTTPException(status_code=400, detail="slot 必须为 weapon/head/shoulders/chest/gloves/pants/boots/artifact/skill")
    if not equipment_ids:
        raise HTTPException(status_code=400, detail="equipment_ids 不能为空")

    cap = SLOT_CAPACITY.get(slot, 1)
    result = []
    for eq_id in equipment_ids:
        eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
        if not eq:
            continue
        if eq.equipment_type != slot:
            continue
        existing = db.query(CharacterEquipment).filter(
            CharacterEquipment.character_id == character_id,
            CharacterEquipment.slot == slot,
        ).all()
        # 已存在则跳过
        dup = next((ce for ce in existing if ce.equipment_id == eq_id), None)
        if dup:
            result.append(dup)
            continue
        # 找空位
        used = {ce.slot_index or 1 for ce in existing}
        idx = next((i for i in range(1, cap + 1) if i not in used), None)
        if idx is None:
            continue  # 槽位已满，跳过
        ce = CharacterEquipment(character_id=character_id, equipment_id=eq_id, slot=slot, slot_index=idx)
        db.add(ce)
        result.append(ce)
    db.commit()
    for ce in result:
        db.refresh(ce)
    return result


@router.delete("/character/{character_id}/slot/{slot}", status_code=204)
def unequip_from_character(character_id: int, slot: str, equipment_id: Optional[int] = None, slot_index: Optional[int] = None, db: Session = Depends(get_db)):
    """卸下人物指定槽位的装备。
    - 不传 equipment_id/slot_index：卸下该槽位所有装备（兼容旧接口）
    - 传 equipment_id：只卸下该槽位中指定的那件装备
    - 传 slot_index：只卸下该槽位指定位置的装备
    """
    query = db.query(CharacterEquipment).filter(
        CharacterEquipment.character_id == character_id,
        CharacterEquipment.slot == slot,
    )
    if equipment_id is not None:
        query = query.filter(CharacterEquipment.equipment_id == equipment_id)
    if slot_index is not None:
        query = query.filter(CharacterEquipment.slot_index == slot_index)
    rows = query.all()
    if not rows:
        raise HTTPException(status_code=404, detail="该槽位未装备")
    for r in rows:
        db.delete(r)
    db.commit()
