from datetime import datetime

from sqlalchemy import Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class CharacterSkillBook(Base):
    """模板人物装备的「技能书」（character_skill_books）

    技能书 = skills 表里的一条记录（一本技能书授予一个功法）。
    后台在「人物管理」里给模板人物装书，用户新建角色时会被复制为初始技能书。
    槽位 slot_index 取值 1..4（上限 4 本）。
    """
    __tablename__ = "character_skill_books"
    __table_args__ = (
        UniqueConstraint("character_id", "slot_index", name="uq_char_skillbook_slot"),
        UniqueConstraint("character_id", "skill_id", name="uq_char_skillbook_skill"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    skill_id: Mapped[int] = mapped_column(Integer, ForeignKey("skills.id"), nullable=False)
    slot_index: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    skill: Mapped["Skill"] = relationship()


class UserCharacterSkillBook(Base):
    """玩家运行时角色装备的「技能书」（user_character_skill_books）

    与 CharacterSkillBook 结构一致，只是绑定到 user_characters。
    前台人物面板中间的 4 个技能书槽、战斗可用技能，都以这里为准。
    """
    __tablename__ = "user_character_skill_books"
    __table_args__ = (
        UniqueConstraint("user_character_id", "slot_index", name="uq_uc_skillbook_slot"),
        UniqueConstraint("user_character_id", "skill_id", name="uq_uc_skillbook_skill"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_character_id: Mapped[int] = mapped_column(Integer, ForeignKey("user_characters.id"), nullable=False)
    skill_id: Mapped[int] = mapped_column(Integer, ForeignKey("skills.id"), nullable=False)
    slot_index: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    skill: Mapped["Skill"] = relationship()
