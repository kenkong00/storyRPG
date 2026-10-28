from pydantic import BaseModel, Field
from typing import Optional


class AnimationEffectCreate(BaseModel):
    name: str = Field(..., max_length=100)
    category: str = Field(default="character_transition")
    effect_type: str = Field(...)
    description: Optional[str] = None
    preview_image: Optional[str] = None
    duration: int = Field(default=1000, ge=100)
    params: Optional[str] = None
    tags: Optional[str] = None
    category_path: Optional[str] = None


class AnimationEffectUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    effect_type: Optional[str] = None
    description: Optional[str] = None
    preview_image: Optional[str] = None
    duration: Optional[int] = None
    params: Optional[str] = None
    tags: Optional[str] = None
    category_path: Optional[str] = None


class AnimationEffectResponse(BaseModel):
    id: int
    name: str
    category: str
    effect_type: str
    description: Optional[str] = None
    preview_image: Optional[str] = None
    duration: int
    params: Optional[str] = None
    tags: Optional[str] = None
    category_path: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}