from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Skill(Base):
    """技能：既支持旧的单字段描述，也支持 v2 的 effects 效果列表。

    effects（JSON 数组）中每一项形如：
      {"kind":"damage","power":180,"element":"fire","hits":2,"scale":"attack","target":"single_enemy","drain":30}
      {"kind":"heal","power":120,"target":"single_ally"}
      {"kind":"buff","stat":"attack","value":30,"turns":3,"target":"self"}
      {"kind":"debuff","stat":"defense","value":25,"turns":2,"chance":80}
      {"kind":"dot","key":"poison","value":15,"turns":3,"mode":"caster_attack_pct"}
      {"kind":"hot","value":20,"turns":3}
      {"kind":"shield","value":80,"turns":3}
      {"kind":"control","control":"stun","chance":70,"turns":1}
      {"kind":"cleanse","count":2}
      {"kind":"rage","value":30}
      {"kind":"revive","power":30}
    详见 services/battle_engine.py。
    """
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    skill_type: Mapped[str] = mapped_column(String(20), default="physical")  # physical / magic / special / passive
    power: Mapped[int] = mapped_column(Integer, default=10)
    mp_cost: Mapped[int] = mapped_column(Integer, default=0)
    hp_cost: Mapped[int] = mapped_column(Integer, default=0)
    accuracy: Mapped[int] = mapped_column(Integer, default=100)
    critical_rate: Mapped[int] = mapped_column(Integer, default=5)
    target_type: Mapped[str] = mapped_column(String(20), default="single_enemy")  # single_enemy / all_enemies / self / single_ally / all_allies
    element: Mapped[str] = mapped_column(String(20), default="none")  # fire / water / wind / earth / light / dark / none
    status_effect: Mapped[str | None] = mapped_column(Text)  # JSON（兼容旧数据）
    effects: Mapped[str | None] = mapped_column(Text)  # JSON 数组：v2 效果列表
    rage_cost: Mapped[int] = mapped_column(Integer, default=0)   # 怒气消耗（0 表示不需要怒气）
    is_ultimate: Mapped[int] = mapped_column(Integer, default=0)  # 1 = 绝招（怒气满可用）
    hits: Mapped[int] = mapped_column(Integer, default=1)         # 默认多段数
    cooldown: Mapped[int] = mapped_column(Integer, default=0)     # 冷却回合
    auto_learn: Mapped[int] = mapped_column(Integer, default=0)   # 1 = 等级达到 required_level 时自动学会
    visual_effect: Mapped[str | None] = mapped_column(String(50))  # 视觉表现类型
    battle_animation_desc: Mapped[str | None] = mapped_column(Text)  # AI图片生成描述
    image: Mapped[str | None] = mapped_column(String(500))  # 技能图标图片
    description: Mapped[str | None] = mapped_column(Text)
    required_level: Mapped[int] = mapped_column(Integer, default=1)
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径


class CharacterSkill(Base):
    __tablename__ = "character_skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    skill_id: Mapped[int] = mapped_column(Integer, ForeignKey("skills.id"), nullable=False)
    skill_level: Mapped[int] = mapped_column(Integer, default=1)
    acquired_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    character: Mapped["Character"] = relationship(back_populates="skills")
    skill: Mapped["Skill"] = relationship()


class LevelUpTable(Base):
    __tablename__ = "level_up_table"

    level: Mapped[int] = mapped_column(Integer, primary_key=True)
    exp_required: Mapped[int] = mapped_column(Integer, default=0)
    hp_growth: Mapped[int] = mapped_column(Integer, default=0)
    mp_growth: Mapped[int] = mapped_column(Integer, default=0)
    attack_growth: Mapped[int] = mapped_column(Integer, default=0)
    defense_growth: Mapped[int] = mapped_column(Integer, default=0)
    speed_growth: Mapped[int] = mapped_column(Integer, default=0)