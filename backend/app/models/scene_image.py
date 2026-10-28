# -*- coding: utf-8 -*-
"""场景图片（同一场景 × 多次出图，保留提示词 / 尺寸 / 方案）。"""

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class SceneImage(Base):
    __tablename__ = "scene_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scene_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("scenes.id", ondelete="CASCADE"), nullable=False, index=True)

    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    prompt: Mapped[str | None] = mapped_column(Text)
    negative: Mapped[str | None] = mapped_column(Text)
    model_preset: Mapped[str | None] = mapped_column(String(100))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    # 该图用的场景拼装配置（JSON），方便「用这张的配置再来一张」
    appearance_json: Mapped[str | None] = mapped_column(Text)
    # 用的是哪一套配置（晴天 / 雨天 / 夜晚…），出完图能按配置筛选
    appearance_id: Mapped[int | None] = mapped_column(Integer)
    appearance_name: Mapped[str | None] = mapped_column(String(60))

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    scene: Mapped["Scene"] = relationship(back_populates="images")
