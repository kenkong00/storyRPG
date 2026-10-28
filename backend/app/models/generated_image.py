# -*- coding: utf-8 -*-
"""AI 生成图片登记表。

每出一张图就记一条，带上「谁 / 哪个动作 / 什么提示词 / 什么方案 / 什么尺寸」，
这样「图片管理」才能按人物把图串起来，而不是一堆没有来源的 png。
"""

from datetime import datetime

from sqlalchemy import Integer, String, Text, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class GeneratedImage(Base):
    __tablename__ = "generated_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    url: Mapped[str] = mapped_column(String(500), nullable=False, unique=True, index=True)
    filename: Mapped[str | None] = mapped_column(String(300))

    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)

    # 出处：pose_batch（动作表情批量） / appearance_render（立绘） / manual / imported
    source: Mapped[str] = mapped_column(String(40), default="manual", index=True)

    character_id: Mapped[int | None] = mapped_column(Integer, index=True)
    character_name: Mapped[str | None] = mapped_column(String(100))
    pose_id: Mapped[str | None] = mapped_column(String(64), index=True)
    pose_name: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(64))

    prompt: Mapped[str | None] = mapped_column(Text)
    negative: Mapped[str | None] = mapped_column(Text)
    model_preset: Mapped[str | None] = mapped_column(String(100))
    job_id: Mapped[str | None] = mapped_column(String(40))
    seed: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[str] = mapped_column(
        String(30), default=lambda: datetime.now().isoformat(), index=True)


Index("ix_generated_char_source", GeneratedImage.character_id, GeneratedImage.source)
