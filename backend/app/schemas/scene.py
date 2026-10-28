from pydantic import BaseModel, Field
from typing import Optional


class SceneCreate(BaseModel):
    name: str = Field(..., max_length=100)
    scene_type: str = Field(default="wilderness")
    description: Optional[str] = None
    background_image: Optional[str] = None
    ambient_sound: Optional[str] = None
    is_safe_zone: int = Field(default=0)
    entry_condition: Optional[str] = None
    parent_region: Optional[str] = None
    coordinates: Optional[str] = None
    category_path: Optional[str] = None
    appearance_json: Optional[str] = None
    prompt_text: Optional[str] = None
    negative_prompt: Optional[str] = None


class SceneUpdate(BaseModel):
    name: Optional[str] = None
    scene_type: Optional[str] = None
    description: Optional[str] = None
    background_image: Optional[str] = None
    ambient_sound: Optional[str] = None
    is_safe_zone: Optional[int] = None
    entry_condition: Optional[str] = None
    parent_region: Optional[str] = None
    coordinates: Optional[str] = None
    category_path: Optional[str] = None
    appearance_json: Optional[str] = None
    prompt_text: Optional[str] = None
    negative_prompt: Optional[str] = None


class SceneResponse(BaseModel):
    id: int
    name: str
    scene_type: str
    description: Optional[str] = None
    background_image: Optional[str] = None
    ambient_sound: Optional[str] = None
    is_safe_zone: int
    entry_condition: Optional[str] = None
    parent_region: Optional[str] = None
    coordinates: Optional[str] = None
    category_path: Optional[str] = None
    appearance_json: Optional[str] = None
    prompt_text: Optional[str] = None
    negative_prompt: Optional[str] = None

    model_config = {"from_attributes": True}


class SceneConnectionCreate(BaseModel):
    from_scene_id: int
    to_scene_id: int
    travel_text: Optional[str] = None
    travel_time: int = Field(default=0)
    is_locked: int = Field(default=0)
    unlock_condition: Optional[str] = None


class SceneConnectionResponse(BaseModel):
    id: int
    from_scene_id: int
    to_scene_id: int
    travel_text: Optional[str] = None
    travel_time: int
    is_locked: int
    unlock_condition: Optional[str] = None

    model_config = {"from_attributes": True}


class SceneNPCCreate(BaseModel):
    scene_id: int
    character_id: int
    position: Optional[str] = None
    appearance_condition: Optional[str] = None
    default_dialogue: Optional[str] = None


class SceneNPCResponse(BaseModel):
    id: int
    scene_id: int
    character_id: int
    position: Optional[str] = None
    appearance_condition: Optional[str] = None
    default_dialogue: Optional[str] = None

    model_config = {"from_attributes": True}