from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional


# ===== 游戏按钮 =====

class GameButtonCreate(BaseModel):
    label: str = Field(..., max_length=50)
    image: Optional[str] = None
    position_x: int = Field(default=50)
    position_y: int = Field(default=50)
    action_type: str = Field(default="start")
    target_story_chapter_id: Optional[int] = None
    is_enabled: int = Field(default=1)
    sort_order: int = Field(default=0)


class GameButtonUpdate(BaseModel):
    label: Optional[str] = None
    image: Optional[str] = None
    position_x: Optional[int] = None
    position_y: Optional[int] = None
    action_type: Optional[str] = None
    target_story_chapter_id: Optional[int] = None
    is_enabled: Optional[int] = None
    sort_order: Optional[int] = None


class GameButtonResponse(BaseModel):
    id: int
    game_id: int
    label: str
    image: Optional[str] = None
    position_x: int
    position_y: int
    action_type: str
    target_story_chapter_id: Optional[int] = None
    is_enabled: int
    sort_order: int

    model_config = {"from_attributes": True}


# ===== 游戏 =====

class GameCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    image: Optional[str] = None
    category_path: Optional[str] = None
    is_published: int = Field(default=0)
    is_carousel: int = Field(default=0)
    is_coming_soon: int = Field(default=0)
    sort_order: int = Field(default=0)


class GameUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    category_path: Optional[str] = None
    is_published: Optional[int] = None
    is_carousel: Optional[int] = None
    is_coming_soon: Optional[int] = None
    sort_order: Optional[int] = None


class GameResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    image: Optional[str] = None
    category_path: Optional[str] = None
    is_published: int
    is_carousel: int
    is_coming_soon: int
    sort_order: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class GameDetailResponse(GameResponse):
    buttons: list[GameButtonResponse] = []
    player_options: list[dict] = []  # [{character_id, sort_order, character:{...}}]


# ===== 游戏可选玩家 =====

class GamePlayerOptionCreate(BaseModel):
    character_id: int
    sort_order: int = Field(default=0)


class GamePlayerOptionResponse(BaseModel):
    id: int
    game_id: int
    character_id: int
    sort_order: int

    model_config = {"from_attributes": True}
