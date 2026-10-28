from pydantic import BaseModel, Field
from typing import Optional


# ===== 装备 =====

class EquipmentCreate(BaseModel):
    name: str = Field(..., max_length=100)
    equipment_type: str = Field(default="set")  # set / accessory / artifact
    rarity: str = Field(default="common")
    description: Optional[str] = None
    image: Optional[str] = None
    stat_bonuses: Optional[str] = None  # JSON
    affix_ids: Optional[str] = None  # JSON array
    skill_ids: Optional[str] = None  # JSON array
    required_realm_level: int = Field(default=1)
    price: int = Field(default=0)
    category_path: Optional[str] = None


class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    equipment_type: Optional[str] = None
    rarity: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    stat_bonuses: Optional[str] = None
    affix_ids: Optional[str] = None
    skill_ids: Optional[str] = None
    required_realm_level: Optional[int] = None
    price: Optional[int] = None
    category_path: Optional[str] = None


class EquipmentResponse(BaseModel):
    id: int
    name: str
    equipment_type: str
    rarity: str
    description: Optional[str] = None
    image: Optional[str] = None
    stat_bonuses: Optional[str] = None
    affix_ids: Optional[str] = None
    skill_ids: Optional[str] = None
    required_realm_level: int
    price: int
    category_path: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


# ===== 装备词条 =====

class EquipmentAffixCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    effect_type: str = Field(default="custom")
    effect_value: Optional[str] = None  # JSON
    is_special: int = Field(default=0)
    category_path: Optional[str] = None


class EquipmentAffixUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    effect_type: Optional[str] = None
    effect_value: Optional[str] = None
    is_special: Optional[int] = None
    category_path: Optional[str] = None


class EquipmentAffixResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    effect_type: str
    effect_value: Optional[str] = None
    is_special: int
    category_path: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


# ===== 人物装备 =====

class CharacterEquipmentCreate(BaseModel):
    equipment_id: int
    slot: str  # set / accessory / artifact
    slot_index: Optional[int] = None  # 套装固定1，配饰1-2，法器1-3；不传则自动找空位


class CharacterEquipmentResponse(BaseModel):
    id: int
    character_id: int
    equipment_id: int
    slot: str
    slot_index: int = 1

    model_config = {"from_attributes": True}
