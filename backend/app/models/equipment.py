from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Equipment(Base):
    """装备表：套装 / 配饰 / 法器"""
    __tablename__ = "equipments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    equipment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="set")  # set(套装) / accessory(配饰) / artifact(法器)
    rarity: Mapped[str] = mapped_column(String(20), default="common")  # common / uncommon / rare / epic / legendary
    description: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str | None] = mapped_column(String(500))

    # 套装属性加成（JSON: {"max_hp":100,"max_mp":50,"attack":10,"defense":5,"speed":5,"luck":5}）
    stat_bonuses: Mapped[str | None] = mapped_column(Text)
    # 配饰词条ID列表（JSON: [1,2,3]）
    affix_ids: Mapped[str | None] = mapped_column(Text)
    # 法器技能ID列表（JSON: [1,2]，1-10个技能）
    skill_ids: Mapped[str | None] = mapped_column(Text)

    required_realm_level: Mapped[int] = mapped_column(Integer, default=1)  # 需要的最低境界等级
    price: Mapped[int] = mapped_column(Integer, default=0)
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())


class EquipmentAffix(Base):
    """装备词条表"""
    __tablename__ = "equipment_affixes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # 效果类型: immune_death(无法被杀死) / exp_boost(经验加成) / hide_realm(隐藏修为) / stat_bonus(属性加成) / custom(自定义)
    effect_type: Mapped[str] = mapped_column(String(50), default="custom")
    effect_value: Mapped[str | None] = mapped_column(Text)  # JSON: 具体数值，如 {"exp_rate": 1.5} 或 {"speed": 30}
    is_special: Mapped[int] = mapped_column(Integer, default=0)  # 1=特殊词条(无法被杀死等)，0=普通属性词条
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())


class CharacterEquipment(Base):
    """人物装备关联表（支持每个槽位多件装备）"""
    __tablename__ = "character_equipments"
    __table_args__ = (
        UniqueConstraint("character_id", "slot", "equipment_id", name="uq_character_slot_equipment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    equipment_id: Mapped[int] = mapped_column(Integer, ForeignKey("equipments.id"), nullable=False)
    slot: Mapped[str] = mapped_column(String(20), nullable=False)  # set(套装槽) / accessory(配饰槽) / artifact(法器槽)
    slot_index: Mapped[int] = mapped_column(Integer, default=1)  # 套装固定1，配饰1-2，法器1-3

    equipment: Mapped["Equipment"] = relationship()
