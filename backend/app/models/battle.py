from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Battle(Base):
    """一场战斗的实例记录。

    v2 起战斗状态由服务端权威持有（state 字段保存完整 JSON 快照），
    前端只负责播放事件流，因此中途刷新也能接着打。
    """
    __tablename__ = "battles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    story_node_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_nodes.id"))
    scene_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("scenes.id"))
    user_character_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user_characters.id"))
    battle_type: Mapped[str] = mapped_column(String(20), default="story")  # story / random / boss / event
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending / active / player_won / enemy_won / fled
    player_party: Mapped[str | None] = mapped_column(Text)  # JSON: [character_id, ...]
    enemy_party: Mapped[str | None] = mapped_column(Text)  # JSON: [character_id, ...]
    battle_log: Mapped[str | None] = mapped_column(Text)  # JSON
    # ---- v2 ----
    state: Mapped[str | None] = mapped_column(Text)        # JSON：完整战斗状态
    config: Mapped[str | None] = mapped_column(Text)       # JSON：本场战斗配置
    round: Mapped[int] = mapped_column(Integer, default=1)
    exp_gained: Mapped[int] = mapped_column(Integer, default=0)
    coin_gained: Mapped[int] = mapped_column(Integer, default=0)
    drops: Mapped[str | None] = mapped_column(Text)        # JSON 掉落
    rewards: Mapped[str | None] = mapped_column(Text)      # JSON 结算（含升级/学技能）
    started_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    ended_at: Mapped[str | None] = mapped_column(String(30))

    turns: Mapped[list["BattleTurn"]] = relationship(back_populates="battle", cascade="all, delete-orphan")


class BattleTurn(Base):
    __tablename__ = "battle_turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    battle_id: Mapped[int] = mapped_column(Integer, ForeignKey("battles.id"), nullable=False)
    turn_number: Mapped[int] = mapped_column(Integer, default=1)
    actor_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    action_type: Mapped[str] = mapped_column(String(20), nullable=False)  # attack / skill / defend / item / flee
    skill_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("skills.id"))
    target_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    damage: Mapped[int] = mapped_column(Integer, default=0)
    is_critical: Mapped[int] = mapped_column(Integer, default=0)
    target_expression: Mapped[str | None] = mapped_column(String(30))
    actor_expression: Mapped[str | None] = mapped_column(String(30))
    visual_description: Mapped[str | None] = mapped_column(Text)
    # ---- v2 ----
    actor_uid: Mapped[str | None] = mapped_column(String(20))
    target_uids: Mapped[str | None] = mapped_column(Text)   # JSON 数组
    skill_name: Mapped[str | None] = mapped_column(String(100))
    result: Mapped[str | None] = mapped_column(Text)        # JSON：本次行动产生的完整事件
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    battle: Mapped["Battle"] = relationship(back_populates="turns")


class CombatExpression(Base):
    __tablename__ = "combat_expressions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    expression_type: Mapped[str] = mapped_column(String(30), nullable=False)  # arrogant / defeated / jealous / regretful / crying / begging / angry / desperate / confident / shocked
    trigger_condition: Mapped[str] = mapped_column(String(50), nullable=False)  # hp_below_30 / critical_hit / ally_defeated / victory_near / defeat_near
    image_prompt: Mapped[str | None] = mapped_column(Text)  # AI图片生成提示词
    pose_description: Mapped[str | None] = mapped_column(Text)
    dialogue_line: Mapped[str | None] = mapped_column(Text)
