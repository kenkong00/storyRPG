from pydantic import BaseModel, Field
from typing import Optional


# ===== 用户 =====

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=50)
    nickname: Optional[str] = None
    avatar: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserUpdate(BaseModel):
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    password: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    created_at: str
    last_login: Optional[str] = None

    model_config = {"from_attributes": True}


# ===== 用户角色实例 =====

class UserCharacterCreate(BaseModel):
    game_id: int
    base_character_id: int  # 后台 Character 模板
    # 留空则直接用模板人物的名字（用户"直接扮演这个角色"，不起新名）
    custom_name: Optional[str] = Field(None, max_length=100)


class UserCharacterUpdate(BaseModel):
    custom_name: Optional[str] = None
    level: Optional[int] = None
    realm_level: Optional[int] = None
    exp: Optional[int] = None
    hp: Optional[int] = None
    max_hp: Optional[int] = None
    mp: Optional[int] = None
    max_mp: Optional[int] = None
    attack: Optional[int] = None
    defense: Optional[int] = None
    speed: Optional[int] = None
    luck: Optional[int] = None
    recovery: Optional[int] = None
    spirit: Optional[int] = None
    crit_rate: Optional[int] = None
    last_story_node_id: Optional[int] = None
    last_chapter_id: Optional[int] = None
    save_data: Optional[str] = None


class UserCharacterResponse(BaseModel):
    id: int
    user_id: int
    game_id: int
    base_character_id: int
    custom_name: str
    level: int
    realm_level: int
    exp: int
    hp: int
    max_hp: int
    mp: int
    max_mp: int
    attack: int
    defense: int
    speed: int
    luck: int
    recovery: int
    spirit: int
    crit_rate: int
    last_story_node_id: Optional[int] = None
    last_chapter_id: Optional[int] = None
    save_data: Optional[str] = None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


# ===== 用户角色装备/背包 =====

class UserCharEquipCreate(BaseModel):
    equipment_id: int
    slot: str  # set / accessory / artifact
    slot_index: Optional[int] = None


class UserCharEquipResponse(BaseModel):
    id: int
    user_character_id: int
    equipment_id: int
    slot: str
    slot_index: int = 1

    model_config = {"from_attributes": True}


class UserCharInventoryCreate(BaseModel):
    item_id: int
    item_kind: str = Field(default="item")  # item / equipment
    quantity: int = Field(default=1)


class UserCharInventoryUpdate(BaseModel):
    quantity: Optional[int] = None


class UserCharInventoryResponse(BaseModel):
    id: int
    user_character_id: int
    item_id: int
    item_kind: str
    quantity: int

    model_config = {"from_attributes": True}
