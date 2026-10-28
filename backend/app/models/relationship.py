from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class CharacterRelationship(Base):
    __tablename__ = "character_relationships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    related_character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(20), default="neutral")  # friend / enemy / rival / lover / neutral / master / student / family
    favorability: Mapped[int] = mapped_column(Integer, default=0)  # -100 ~ 100
    trust: Mapped[int] = mapped_column(Integer, default=0)  # 0 ~ 100
    respect: Mapped[int] = mapped_column(Integer, default=0)  # 0 ~ 100
    fear: Mapped[int] = mapped_column(Integer, default=0)  # 0 ~ 100
    history_summary: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    events: Mapped[list["RelationshipEvent"]] = relationship(back_populates="relationship", cascade="all, delete-orphan")


class RelationshipEvent(Base):
    __tablename__ = "relationship_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relationship_id: Mapped[int] = mapped_column(Integer, ForeignKey("character_relationships.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)  # battle_mercy / gift / dialogue_choice / rescue / betray
    change_value: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    story_node_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_nodes.id"))
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    relationship: Mapped["CharacterRelationship"] = relationship(back_populates="events")