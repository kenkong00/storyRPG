# -*- coding: utf-8 -*-
"""人物外观配置（一个角色可以有多套外观拼装：日常 / 战斗 / 童年 ...）。

以前人物只有一份 appearance_json —— 想出「战斗装」「便装」「小时候」就得反复
覆盖同一份配置，覆盖完就找不回来了。现在把外观拆成角色下的多条配置：
  · 每条配置有名字、是否默认、独立的外观 JSON；
  · 出立绘 / 出动作表情时可以指定用哪一套，产物也记下用的是哪一套；
  · characters.appearance_json 保留为「默认配置」的镜像，兼容旧接口。
"""

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class CharacterAppearance(Base):
    __tablename__ = "character_appearances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(60), nullable=False, default="默认外观")
    # 外观维度取值（JSON）。framing = full / half，决定立绘是全身还是半身。
    appearance_json: Mapped[str | None] = mapped_column(Text)
    is_default: Mapped[int] = mapped_column(Integer, default=0)
    sort: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    character: Mapped["Character"] = relationship(back_populates="appearances")
