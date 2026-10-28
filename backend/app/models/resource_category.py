from datetime import datetime
from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class ResourceCategory(Base):
    """通用资源分类（支持子分类，覆盖人物/装备/物品/词条/场景/技能/动效/声音/故事/标签等）

    resource_type 取值：
      character / equipment / item / affix / scene / skill / animation / sound / story_arc / chapter / node / tag
    path 字段为完整路径，根分类为名称本身，子分类为 "父路径/子名称"。
    """
    __tablename__ = "resource_categories"
    __table_args__ = (
        UniqueConstraint("resource_type", "path", name="uq_resource_category_path"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resource_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    parent_path: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    is_system: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    system_key: Mapped[str | None] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
