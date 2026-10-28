from pydantic import BaseModel, Field
from typing import Optional


class SoundCreate(BaseModel):
    name: str = Field(..., max_length=200)
    category: str = Field(default="voice")  # voice / bgm
    file_path: str = Field(...)
    file_url: str = Field(...)
    file_format: Optional[str] = None
    duration: Optional[float] = None
    description: Optional[str] = None
    category_path: Optional[str] = None


class SoundUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    file_path: Optional[str] = None
    file_url: Optional[str] = None
    file_format: Optional[str] = None
    duration: Optional[float] = None
    description: Optional[str] = None
    category_path: Optional[str] = None


class SoundResponse(BaseModel):
    id: int
    name: str
    category: str
    file_path: str
    file_url: str
    file_format: Optional[str] = None
    duration: Optional[float] = None
    description: Optional[str] = None
    category_path: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}