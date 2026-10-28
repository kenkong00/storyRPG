from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), default="consumable")  # weapon / armor / accessory / consumable / key_item / material
    rarity: Mapped[str] = mapped_column(String(20), default="common")  # common / uncommon / rare / epic / legendary
    effect: Mapped[str | None] = mapped_column(Text)  # JSON
    effects: Mapped[str | None] = mapped_column(Text)  # JSON 数组：战斗中使用时的效果（同技能 effects DSL）
    description: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str | None] = mapped_column(String(500))
    price: Mapped[int] = mapped_column(Integer, default=0)
    is_usable: Mapped[int] = mapped_column(Integer, default=1)
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径


class CharacterInventory(Base):
    """模板人物背包。

    item_kind = 'item'      时 item_id 指向 items 表（消耗品/材料等）
    item_kind = 'equipment' 时 item_id 指向 equipments 表（武器/防具/法宝）
    与 UserCharacterInventory 保持同样的结构，保证后台配置与前台显示一致。
    """
    __tablename__ = "character_inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("items.id"), nullable=False)
    item_kind: Mapped[str | None] = mapped_column(String(20), default="item")  # item / equipment
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    is_equipped: Mapped[int] = mapped_column(Integer, default=0)

    character: Mapped["Character"] = relationship(back_populates="inventory")