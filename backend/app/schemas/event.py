from pydantic import BaseModel, Field
from typing import Optional


class EventCreate(BaseModel):
    name: str = Field(..., max_length=200)
    event_type: str = Field(...)
    trigger_type: str = Field(default="auto")
    trigger_condition: Optional[str] = None
    priority: int = Field(default=0)
    cooldown: int = Field(default=0)
    is_one_time: int = Field(default=1)
    has_triggered: int = Field(default=0)
    effects: Optional[str] = None
    story_node_id: Optional[int] = None


class EventUpdate(BaseModel):
    name: Optional[str] = None
    event_type: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_condition: Optional[str] = None
    priority: Optional[int] = None
    cooldown: Optional[int] = None
    is_one_time: Optional[int] = None
    has_triggered: Optional[int] = None
    effects: Optional[str] = None
    story_node_id: Optional[int] = None


class EventResponse(BaseModel):
    id: int
    name: str
    event_type: str
    trigger_type: str
    trigger_condition: Optional[str] = None
    priority: int
    cooldown: int
    is_one_time: int
    has_triggered: int
    effects: Optional[str] = None
    story_node_id: Optional[int] = None

    model_config = {"from_attributes": True}


class EventLogCreate(BaseModel):
    event_id: int
    context: Optional[str] = None


class EventLogResponse(BaseModel):
    id: int
    event_id: int
    triggered_at: str
    context: Optional[str] = None

    model_config = {"from_attributes": True}