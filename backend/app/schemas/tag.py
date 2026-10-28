from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional


class TagCreate(BaseModel):
    name: str = Field(..., max_length=100)
    category: str = Field(default="character")  # character / item / scene / plot
    description: Optional[str] = None
    category_path: Optional[str] = None


class TagUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    category_path: Optional[str] = None


class TagResponse(BaseModel):
    id: int
    name: str
    category: str
    description: Optional[str] = None
    is_auto: int
    source_type: Optional[str] = None
    source_id: Optional[int] = None
    category_path: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


class ImageTagAssign(BaseModel):
    """给图片批量打标签"""
    image_filenames: list[str] = Field(..., min_length=1)
    tag_ids: list[int] = Field(..., min_length=1)


class ImageTagRemove(BaseModel):
    """从图片移除标签"""
    image_filenames: list[str] = Field(..., min_length=1)
    tag_ids: list[int] = Field(..., min_length=1)
