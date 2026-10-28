from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class Tag(Base):
    """标签：人物标签 / 物品标签 / 场景标签 / 剧情标签"""
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("name", "category", name="uq_tag_name_category"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="character")
    # character(人物标签) / item(物品标签) / scene(场景标签) / plot(剧情标签)
    description: Mapped[str | None] = mapped_column(Text)
    is_auto: Mapped[int] = mapped_column(Integer, default=0)  # 1=系统自动生成（如人物名标签）
    source_type: Mapped[str | None] = mapped_column(String(30))  # character / item / scene ...
    source_id: Mapped[int | None] = mapped_column(Integer)  # 关联源ID（如人物ID）
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())


class ImageTag(Base):
    """图片与标签的多对多关联"""
    __tablename__ = "image_tags"
    __table_args__ = (UniqueConstraint("image_filename", "tag_id", name="uq_image_tag"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    image_filename: Mapped[str] = mapped_column(String(200), nullable=False)  # 图片文件名（不含路径）
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
