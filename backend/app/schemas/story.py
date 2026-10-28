from pydantic import BaseModel, Field
from typing import Optional


class StoryArcCreate(BaseModel):
    title: str = Field(..., max_length=200)
    description: Optional[str] = None
    image: Optional[str] = None
    order_index: int = Field(default=0)
    is_active: int = Field(default=1)
    trigger_condition: Optional[str] = None
    category_path: Optional[str] = None


class StoryArcUpdate(BaseModel):
    """更新故事时所有字段可选"""
    title: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None
    image: Optional[str] = None
    order_index: Optional[int] = None
    is_active: Optional[int] = None
    trigger_condition: Optional[str] = None
    category_path: Optional[str] = None


class StoryArcResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    image: Optional[str] = None
    order_index: int
    is_active: int
    trigger_condition: Optional[str] = None
    category_path: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


class StoryChapterCreate(BaseModel):
    title: str = Field(..., max_length=200)
    story_arc_id: Optional[int] = None  # 新增
    chapter_order: int = Field(default=0)
    description: Optional[str] = None
    image: Optional[str] = None  # 新增
    cover_animation_effect_id: Optional[int] = None
    is_main_story: int = Field(default=1)
    prerequisite_chapter_id: Optional[int] = None
    unlock_condition: Optional[str] = None
    category_path: Optional[str] = None


class StoryChapterUpdate(BaseModel):
    """更新章节时所有字段可选（支持批量移动等部分更新）"""
    title: Optional[str] = Field(default=None, max_length=200)
    story_arc_id: Optional[int] = None
    chapter_order: Optional[int] = None
    description: Optional[str] = None
    image: Optional[str] = None
    cover_animation_effect_id: Optional[int] = None
    is_main_story: Optional[int] = None
    prerequisite_chapter_id: Optional[int] = None
    unlock_condition: Optional[str] = None
    category_path: Optional[str] = None


class StoryChapterResponse(BaseModel):
    id: int
    title: str
    story_arc_id: Optional[int] = None  # 新增
    chapter_order: int
    description: Optional[str] = None
    image: Optional[str] = None  # 新增
    cover_animation_effect_id: Optional[int] = None
    is_main_story: int
    prerequisite_chapter_id: Optional[int] = None
    unlock_condition: Optional[str] = None
    category_path: Optional[str] = None

    model_config = {"from_attributes": True}


class StoryNodeCreate(BaseModel):
    chapter_id: int
    scene_id: Optional[int] = None
    node_type: str = Field(...)
    title: Optional[str] = None
    speaker_id: Optional[int] = None
    content: Optional[str] = None
    content_image: Optional[str] = None
    expression: Optional[str] = None
    position: Optional[str] = None
    multi_characters: Optional[str] = None  # JSON: 多人同场
    bgm: Optional[str] = None
    background_change: Optional[str] = None
    bg_animation_effect_id: Optional[int] = None
    is_key_node: int = Field(default=0)
    order_index: int = Field(default=0)
    tags: Optional[str] = None  # JSON: 标签ID数组
    category_path: Optional[str] = None
    battle_config: Optional[str] = None  # JSON: 战斗节点配置（敌人/台词/分支）


class StoryNodeResponse(BaseModel):
    id: int
    chapter_id: int
    scene_id: Optional[int] = None
    node_type: str
    title: Optional[str] = None
    speaker_id: Optional[int] = None
    content: Optional[str] = None
    content_image: Optional[str] = None
    expression: Optional[str] = None
    position: Optional[str] = None
    multi_characters: Optional[str] = None  # JSON: 多人同场
    bgm: Optional[str] = None
    background_change: Optional[str] = None
    bg_animation_effect_id: Optional[int] = None
    is_key_node: int
    order_index: int
    tags: Optional[str] = None  # JSON: 标签ID数组
    category_path: Optional[str] = None
    battle_config: Optional[str] = None  # JSON: 战斗节点配置（敌人/台词/分支）
    # 该节点「对话列表」里出现过的人物名（按首次发言顺序，仅列表接口填充）
    speaker_names: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


# ===== 节点对话列表 =====

class StoryNodeDialogueCreate(BaseModel):
    node_id: int
    order_index: int = Field(default=0)
    speaker_id: Optional[int] = None
    content: Optional[str] = None
    expression: Optional[str] = None
    pos_x: Optional[float] = 50.0
    pos_y: Optional[float] = 0.0
    scale: Optional[float] = 1.0
    crop_top: Optional[float] = 0.0
    crop_bottom: Optional[float] = 100.0
    flip: int = Field(default=0)
    z_index: int = Field(default=1)
    disappear_after: int = Field(default=0)
    animation_effect_id: Optional[int] = None
    voice: Optional[str] = None
    bg_change: Optional[str] = None
    bgm: Optional[str] = None


class StoryNodeDialogueUpdate(BaseModel):
    """部分更新：所有字段可选"""
    order_index: Optional[int] = None
    speaker_id: Optional[int] = None
    content: Optional[str] = None
    expression: Optional[str] = None
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None
    scale: Optional[float] = None
    crop_top: Optional[float] = None
    crop_bottom: Optional[float] = None
    flip: Optional[int] = None
    z_index: Optional[int] = None
    disappear_after: Optional[int] = None
    animation_effect_id: Optional[int] = None
    voice: Optional[str] = None
    bg_change: Optional[str] = None
    bgm: Optional[str] = None


class StoryNodeDialogueResponse(BaseModel):
    id: int
    node_id: int
    order_index: int
    speaker_id: Optional[int] = None
    content: Optional[str] = None
    expression: Optional[str] = None
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None
    scale: Optional[float] = None
    crop_top: Optional[float] = None
    crop_bottom: Optional[float] = None
    flip: int
    z_index: int
    disappear_after: int = 0
    animation_effect_id: Optional[int] = None
    voice: Optional[str] = None
    bg_change: Optional[str] = None
    bgm: Optional[str] = None

    model_config = {"from_attributes": True}


class StoryChoiceCreate(BaseModel):
    node_id: int
    choice_text: str = Field(..., max_length=500)
    next_node_id: Optional[int] = None
    condition_group: Optional[str] = None
    effects: Optional[str] = None
    is_hidden: int = Field(default=0)


class StoryChoiceResponse(BaseModel):
    id: int
    node_id: int
    choice_text: str
    next_node_id: Optional[int] = None
    condition_group: Optional[str] = None
    effects: Optional[str] = None
    is_hidden: int

    model_config = {"from_attributes": True}


class StoryConditionCreate(BaseModel):
    condition_group: str = Field(..., max_length=50)
    condition_type: str = Field(...)
    target_id: Optional[int] = None
    operator: str = Field(...)
    value: str = Field(..., max_length=200)


class StoryConditionResponse(BaseModel):
    id: int
    condition_group: str
    condition_type: str
    target_id: Optional[int] = None
    operator: str
    value: str

    model_config = {"from_attributes": True}


class StoryFlagCreate(BaseModel):
    flag_key: str = Field(..., max_length=100)
    flag_value: str = Field(default="")
    description: Optional[str] = None
    set_at_node_id: Optional[int] = None


class StoryFlagResponse(BaseModel):
    id: int
    flag_key: str
    flag_value: str
    description: Optional[str] = None
    set_at_node_id: Optional[int] = None
    created_at: str

    model_config = {"from_attributes": True}