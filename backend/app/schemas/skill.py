from pydantic import BaseModel, Field
from typing import Optional


class SkillCreate(BaseModel):
    name: str = Field(..., max_length=100)
    skill_type: str = Field(default="physical")
    power: int = Field(default=10)
    mp_cost: int = Field(default=0)
    hp_cost: int = Field(default=0)
    accuracy: int = Field(default=100)
    critical_rate: int = Field(default=5)
    target_type: str = Field(default="single_enemy")
    element: str = Field(default="none")
    status_effect: Optional[str] = None
    effects: Optional[str] = None  # JSON 数组：v2 效果列表
    rage_cost: int = Field(default=0)
    is_ultimate: int = Field(default=0)
    hits: int = Field(default=1)
    cooldown: int = Field(default=0)
    auto_learn: int = Field(default=0)
    visual_effect: Optional[str] = None
    battle_animation_desc: Optional[str] = None
    image: Optional[str] = None
    description: Optional[str] = None
    required_level: int = Field(default=1)
    category_path: Optional[str] = None


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    skill_type: Optional[str] = None
    power: Optional[int] = None
    mp_cost: Optional[int] = None
    hp_cost: Optional[int] = None
    accuracy: Optional[int] = None
    critical_rate: Optional[int] = None
    target_type: Optional[str] = None
    element: Optional[str] = None
    status_effect: Optional[str] = None
    effects: Optional[str] = None
    rage_cost: Optional[int] = None
    is_ultimate: Optional[int] = None
    hits: Optional[int] = None
    cooldown: Optional[int] = None
    auto_learn: Optional[int] = None
    visual_effect: Optional[str] = None
    battle_animation_desc: Optional[str] = None
    image: Optional[str] = None
    description: Optional[str] = None
    required_level: Optional[int] = None
    category_path: Optional[str] = None


class SkillResponse(BaseModel):
    id: int
    name: str
    skill_type: str
    power: int
    mp_cost: int
    hp_cost: int
    accuracy: int
    critical_rate: int
    target_type: str
    element: str
    status_effect: Optional[str] = None
    effects: Optional[str] = None
    rage_cost: int = 0
    is_ultimate: int = 0
    hits: int = 1
    cooldown: int = 0
    auto_learn: int = 0
    visual_effect: Optional[str] = None
    battle_animation_desc: Optional[str] = None
    image: Optional[str] = None
    description: Optional[str] = None
    required_level: int
    category_path: Optional[str] = None

    model_config = {"from_attributes": True}


class CharacterSkillCreate(BaseModel):
    character_id: int
    skill_id: int
    skill_level: int = Field(default=1)


class CharacterSkillResponse(BaseModel):
    id: int
    character_id: int
    skill_id: int
    skill_level: int
    acquired_at: str

    model_config = {"from_attributes": True}


class LevelUpTableResponse(BaseModel):
    level: int
    exp_required: int
    hp_growth: int
    mp_growth: int
    attack_growth: int
    defense_growth: int
    speed_growth: int

    model_config = {"from_attributes": True}