from pydantic import BaseModel, Field
from typing import Optional


class RelationshipEventCreate(BaseModel):
    event_type: str = Field(...)
    change_value: int = Field(default=0)
    description: Optional[str] = None
    story_node_id: Optional[int] = None


class RelationshipEventResponse(BaseModel):
    id: int
    relationship_id: int
    event_type: str
    change_value: int
    description: Optional[str] = None
    story_node_id: Optional[int] = None
    created_at: str

    model_config = {"from_attributes": True}


class RelationshipCreate(BaseModel):
    character_id: int
    related_character_id: int
    relationship_type: str = Field(default="neutral")
    favorability: int = Field(default=0, ge=-100, le=100)
    trust: int = Field(default=0, ge=0, le=100)
    respect: int = Field(default=0, ge=0, le=100)
    fear: int = Field(default=0, ge=0, le=100)
    history_summary: Optional[str] = None


class RelationshipUpdate(BaseModel):
    relationship_type: Optional[str] = None
    favorability: Optional[int] = None
    trust: Optional[int] = None
    respect: Optional[int] = None
    fear: Optional[int] = None
    history_summary: Optional[str] = None


class RelationshipResponse(BaseModel):
    id: int
    character_id: int
    related_character_id: int
    relationship_type: str
    favorability: int
    trust: int
    respect: int
    fear: int
    history_summary: Optional[str] = None
    updated_at: str
    events: list[RelationshipEventResponse] = []

    model_config = {"from_attributes": True}