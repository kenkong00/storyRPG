from datetime import datetime
from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class AnimationEffect(Base):
    __tablename__ = "animation_effects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="character_transition")
    effect_type: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    preview_image: Mapped[str | None] = mapped_column(String(500))
    duration: Mapped[int] = mapped_column(Integer, default=1000)
    params: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[str | None] = mapped_column(Text)  # JSON: 标签ID数组
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())