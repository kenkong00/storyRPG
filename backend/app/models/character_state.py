from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class CharacterState(Base):
    """人物状态：可绑定到指定人物。

    state_type:
      expression - 表情状态（用于对话），content 为 JSON: {"normal":"url","happy":"url",...}
      battle     - 战斗状态，content 为 JSON:
        {
          "standing": {"100": "url"},
          "attack":   {"100": "url"},
          "defend":   {"100": "url"},
          "cast":     {"100": "url"},
          "ultimate": {"100": "url"},
          "hurt":     {"80": "url","60": "url","40": "url","20": "url","5": "url"},
          "defeated": {"0": "url"}
        }
    battle 状态中按损血百分比选择不同状态图：80%/60%/40%/20%/5% 等。
    """
    __tablename__ = "character_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    state_type: Mapped[str] = mapped_column(String(20), nullable=False, default="expression")  # expression / battle
    content: Mapped[str | None] = mapped_column(Text)  # JSON
    description: Mapped[str | None] = mapped_column(Text)
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    bindings: Mapped[list["CharacterStateBinding"]] = relationship(back_populates="state", cascade="all, delete-orphan")


class CharacterStateBinding(Base):
    """状态绑定到人物：一套状态可指定给角色A或角色B使用"""
    __tablename__ = "character_state_bindings"
    __table_args__ = (
        UniqueConstraint("state_id", "character_id", name="uq_state_character"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    state_id: Mapped[int] = mapped_column(Integer, ForeignKey("character_states.id"), nullable=False)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)

    state: Mapped["CharacterState"] = relationship(back_populates="bindings")
