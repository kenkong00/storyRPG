from pydantic import BaseModel, Field
from typing import Optional


class ItemCreate(BaseModel):
    name: str = Field(..., max_length=100)
    item_type: str = Field(default="consumable")
    rarity: str = Field(default="common")
    effect: Optional[str] = None
    effects: Optional[str] = None  # JSON 数组：战斗中使用效果
    description: Optional[str] = None
    image: Optional[str] = None
    price: int = Field(default=0)
    is_usable: int = Field(default=1)
    category_path: Optional[str] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    item_type: Optional[str] = None
    rarity: Optional[str] = None
    effect: Optional[str] = None
    effects: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    price: Optional[int] = None
    is_usable: Optional[int] = None
    category_path: Optional[str] = None


class ItemResponse(BaseModel):
    id: int
    name: str
    item_type: str
    rarity: str
    effect: Optional[str] = None
    effects: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    price: int
    is_usable: int
    category_path: Optional[str] = None

    model_config = {"from_attributes": True}


class CharacterInventoryCreate(BaseModel):
    character_id: Optional[int] = None
    item_id: int
    item_kind: Optional[str] = "item"   # item=物品 / equipment=装备
    quantity: int = Field(default=1, ge=1)
    is_equipped: int = Field(default=0)


class CharacterInventoryResponse(BaseModel):
    id: int
    character_id: int
    item_id: int
    item_kind: Optional[str] = "item"
    quantity: int
    is_equipped: int

    model_config = {"from_attributes": True}