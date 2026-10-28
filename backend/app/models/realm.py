from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class CharacterRealm(Base):
    """人物境界等级表：10大境界 × 4小境界 = 40级"""
    __tablename__ = "character_realms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    level: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)  # 1-40，对应 Character.realm_level
    realm_name: Mapped[str] = mapped_column(String(30), nullable=False)  # 练气期 / 筑基期 ...
    sub_level: Mapped[str] = mapped_column(String(20), nullable=False)  # 初期 / 中期 / 后期 / 大圆满
    full_name: Mapped[str] = mapped_column(String(50), nullable=False)  # 练气期初期
    realm_index: Mapped[int] = mapped_column(Integer, default=0)  # 大境界序号 0-9
    sub_index: Mapped[int] = mapped_column(Integer, default=0)  # 小境界序号 0-3
    # 属性数值
    max_hp: Mapped[int] = mapped_column(Integer, default=100)
    max_mp: Mapped[int] = mapped_column(Integer, default=50)
    attack: Mapped[int] = mapped_column(Integer, default=10)
    defense: Mapped[int] = mapped_column(Integer, default=5)
    speed: Mapped[int] = mapped_column(Integer, default=5)
    luck: Mapped[int] = mapped_column(Integer, default=5)
    lifespan: Mapped[int] = mapped_column(Integer, default=100)  # 寿命（年）
    description: Mapped[str | None] = mapped_column(Text)  # 境界特点
