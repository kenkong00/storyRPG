from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)  # npc_intervention / npc_join / npc_betray / ambush / rescue / reward / disaster / discovery
    trigger_type: Mapped[str] = mapped_column(String(30), default="auto")  # auto / story_node / battle / relationship_threshold / time
    trigger_condition: Mapped[str | None] = mapped_column(Text)  # JSON
    priority: Mapped[int] = mapped_column(Integer, default=0)
    cooldown: Mapped[int] = mapped_column(Integer, default=0)
    is_one_time: Mapped[int] = mapped_column(Integer, default=1)
    has_triggered: Mapped[int] = mapped_column(Integer, default=0)
    effects: Mapped[str | None] = mapped_column(Text)  # JSON
    story_node_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_nodes.id"))


class EventLog(Base):
    __tablename__ = "event_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(Integer, ForeignKey("events.id"), nullable=False)
    triggered_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    context: Mapped[str | None] = mapped_column(Text)  # JSON