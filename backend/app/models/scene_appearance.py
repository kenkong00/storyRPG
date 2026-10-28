# -*- coding: utf-8 -*-
"""场景外观配置（一个场景可以有多套拼装：晴天 / 雨天 / 夜晚 / 血月…）。

人物那边已经有 character_appearances（日常 / 战斗 / 童年），场景以前只有
scenes.appearance_json 一份 —— 想出「白天的教室」「下雨的教室」就得来回覆盖。
现在拆成场景下的多条配置：
  · 每条配置有名字、是否默认、独立的拼装 JSON + 自由提示词 / 负面；
  · 出图时可以指定用哪一套，产物也记下用的是哪一套；
  · scenes.appearance_json 保留为「默认配置」的镜像，兼容旧接口与旧数据。
"""

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class SceneAppearance(Base):
    __tablename__ = "scene_appearances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scene_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("scenes.id", ondelete="CASCADE"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(60), nullable=False, default="默认配置")
    # 拼装维度取值（JSON）
    appearance_json: Mapped[str | None] = mapped_column(Text)
    # 自由提示词 / 负面（与拼装叠加，留空则用场景级别的那份）
    prompt_text: Mapped[str | None] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text)
    is_default: Mapped[int] = mapped_column(Integer, default=0)
    sort: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    scene: Mapped["Scene"] = relationship(back_populates="appearances")
