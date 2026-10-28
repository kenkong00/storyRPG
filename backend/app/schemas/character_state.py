from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional


class CharacterStateCreate(BaseModel):
    name: str = Field(..., max_length=100)
    state_type: str = Field(default="expression")  # expression / battle
    content: Optional[str] = None  # JSON
    description: Optional[str] = None
    category_path: Optional[str] = None


class CharacterStateUpdate(BaseModel):
    name: Optional[str] = None
    state_type: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None
    category_path: Optional[str] = None


class CharacterStateResponse(BaseModel):
    id: int
    name: str
    state_type: str
    content: Optional[str] = None
    description: Optional[str] = None
    category_path: Optional[str] = None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class CharacterStateBindingCreate(BaseModel):
    character_id: int


class CharacterStateBindingResponse(BaseModel):
    id: int
    state_id: int
    character_id: int

    model_config = {"from_attributes": True}
