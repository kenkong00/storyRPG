from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional


class CharacterAttributeCreate(BaseModel):
    attr_key: str = Field(..., max_length=50)
    attr_value: int = Field(default=0, ge=0, le=100)


class CharacterAttributeResponse(BaseModel):
    id: int
    character_id: int
    attr_key: str
    attr_value: int
    updated_at: str

    model_config = {"from_attributes": True}


class CharacterCreate(BaseModel):
    name: str = Field(..., max_length=100)
    character_type: str = Field(default="npc")
    title: Optional[str] = None
    level: int = Field(default=1, ge=1)
    realm_level: int = Field(default=1, ge=1)
    exp: int = Field(default=0, ge=0)
    hp: int = Field(default=100)
    max_hp: int = Field(default=100)
    mp: int = Field(default=50)
    max_mp: int = Field(default=50)
    attack: int = Field(default=10)
    defense: int = Field(default=5)
    speed: int = Field(default=5)
    luck: int = Field(default=5)
    recovery: int = Field(default=60)
    spirit: int = Field(default=50)
    crit_rate: int = Field(default=8)
    personality: Optional[str] = None
    background_story: Optional[str] = None
    portrait_image: Optional[str] = None
    expressions: Optional[str] = None
    is_alive: int = Field(default=1)
    is_party_member: int = Field(default=0)
    can_join_party: int = Field(default=0)
    is_activated: int = Field(default=0)
    join_condition: Optional[str] = None
    category_path: Optional[str] = None

    # ===== 语音配置 =====
    gender: Optional[str] = Field(default="unknown")
    tts_engine: Optional[str] = Field(default="edge")
    tts_voice: Optional[str] = None
    tts_rate: Optional[int] = Field(default=0, ge=-100, le=100)
    tts_pitch: Optional[int] = Field(default=0, ge=-100, le=100)
    tts_volume: Optional[int] = Field(default=0, ge=-100, le=100)


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    character_type: Optional[str] = None
    title: Optional[str] = None
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
    personality: Optional[str] = None
    background_story: Optional[str] = None
    portrait_image: Optional[str] = None
    expressions: Optional[str] = None
    is_alive: Optional[int] = None
    is_party_member: Optional[int] = None
    can_join_party: Optional[int] = None
    is_activated: Optional[int] = None
    join_condition: Optional[str] = None
    category_path: Optional[str] = None

    # ===== 语音配置 =====
    gender: Optional[str] = None
    tts_engine: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_rate: Optional[int] = Field(default=None, ge=-100, le=100)
    tts_pitch: Optional[int] = Field(default=None, ge=-100, le=100)
    tts_volume: Optional[int] = Field(default=None, ge=-100, le=100)


class CharacterResponse(BaseModel):
    id: int
    name: str
    character_type: str
    title: Optional[str] = None
    level: int
    realm_level: int = 1
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
    personality: Optional[str] = None
    background_story: Optional[str] = None
    portrait_image: Optional[str] = None
    expressions: Optional[str] = None
    is_alive: int
    is_party_member: int
    can_join_party: int
    is_activated: int = 0
    join_condition: Optional[str] = None
    category_path: Optional[str] = None
    appearance_json: Optional[str] = None
    gender: Optional[str] = "unknown"
    tts_engine: Optional[str] = "edge"
    tts_voice: Optional[str] = None
    tts_rate: Optional[int] = 0
    tts_pitch: Optional[int] = 0
    tts_volume: Optional[int] = 0
    created_at: str
    updated_at: str
    attributes: list[CharacterAttributeResponse] = []

    model_config = {"from_attributes": True}