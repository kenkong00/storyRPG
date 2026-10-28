# -*- coding: utf-8 -*-
"""人物动作表情图片（同一人物 × 不同动作，用于对话 / 战斗演出时按场景取图）。"""

from datetime import datetime
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class CharacterPoseImage(Base):
    __tablename__ = "character_pose_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)

    # 动作条目（指向外观定义库 dim=pose 的 option id）；自定义动作可能为空
    pose_id: Mapped[str | None] = mapped_column(String(64))
    pose_name: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(64), index=True)

    # 出这张图时用的是角色的哪一套外观配置（日常 / 战斗 / 童年 ...）
    appearance_id: Mapped[int | None] = mapped_column(Integer, index=True)
    appearance_name: Mapped[str | None] = mapped_column(String(60))
    # 全身 / 半身（half = 腰部以上）
    framing: Mapped[str | None] = mapped_column(String(10), default="full")

    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    # 生成时实际使用的提示词，便于后续复现 / 微调
    prompt: Mapped[str | None] = mapped_column(Text)
    # 出图用的模型方案名与随机种子
    model_preset: Mapped[str | None] = mapped_column(String(100))
    seed: Mapped[int | None] = mapped_column(Integer)
    # 实际像素尺寸（预览面板要显示「高 × 宽」，也用来判断比例是否被裁）
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    character: Mapped["Character"] = relationship(back_populates="pose_images")


Index("ix_pose_image_char_pose", CharacterPoseImage.character_id, CharacterPoseImage.pose_id)
