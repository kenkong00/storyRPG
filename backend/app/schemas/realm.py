from pydantic import BaseModel, Field
from typing import Optional


class CharacterRealmCreate(BaseModel):
    level: int = Field(..., ge=1)
    realm_name: str = Field(..., max_length=30)
    sub_level: str = Field(..., max_length=20)
    full_name: str = Field(..., max_length=50)
    realm_index: int = Field(default=0, ge=0, le=9)
    sub_index: int = Field(default=0, ge=0, le=3)
    max_hp: int = Field(default=100)
    max_mp: int = Field(default=50)
    attack: int = Field(default=10)
    defense: int = Field(default=5)
    speed: int = Field(default=5)
    luck: int = Field(default=5)
    lifespan: int = Field(default=100)
    description: Optional[str] = None


class CharacterRealmUpdate(BaseModel):
    realm_name: Optional[str] = None
    sub_level: Optional[str] = None
    full_name: Optional[str] = None
    realm_index: Optional[int] = None
    sub_index: Optional[int] = None
    max_hp: Optional[int] = None
    max_mp: Optional[int] = None
    attack: Optional[int] = None
    defense: Optional[int] = None
    speed: Optional[int] = None
    luck: Optional[int] = None
    lifespan: Optional[int] = None
    description: Optional[str] = None


class CharacterRealmResponse(BaseModel):
    id: int
    level: int
    realm_name: str
    sub_level: str
    full_name: str
    realm_index: int
    sub_index: int
    max_hp: int
    max_mp: int
    attack: int
    defense: int
    speed: int
    luck: int
    lifespan: int
    description: Optional[str] = None

    model_config = {"from_attributes": True}
