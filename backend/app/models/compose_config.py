# -*- coding: utf-8 -*-
"""合成图配置（人物 × 场景 的一套「可复用出图方案」）。

以前的合成页是「选一个人 + 选一个场景 → 出图」，出完就散：
想画同一幕的五个角度，得来回重选五遍；想换个人重画，前面那套配置早丢了。

现在把「一幕画面」整体存成一条配置：
  · scene_id / scene_appearance_json / scene_prompt —— 用哪个场景、哪套拼装、补什么词
  · characters_json —— 这一幕里有谁（多条），每人带外观配置 / 动作 / 取景 / 站位 / 备注
  · shot / placement / extra / width / height / model_preset —— 构图与出图参数

配置只负责产出「一段提示词」，勾选任意几条点生成，就逐条丢给 ComfyUI 排队。
"""

from datetime import datetime

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class ComposeConfig(Base):
    __tablename__ = "compose_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    name: Mapped[str] = mapped_column(String(80), nullable=False, default="合成配置")

    # ---- 场景 ----
    scene_id: Mapped[int | None] = mapped_column(Integer)
    # 场景拼装快照：场景没保存过拼装时用这份；有 scene_id 时以场景当前拼装为准
    scene_appearance_json: Mapped[str | None] = mapped_column(Text)
    scene_prompt: Mapped[str | None] = mapped_column(Text)

    # ---- 人物（JSON 数组：character_id / appearance_id / pose_id / framing / placement / shot / note）----
    characters_json: Mapped[str | None] = mapped_column(Text)

    # ---- 边界框布局（画框版提示词）----
    # 结构：{"width":..,"height":..,"summary":"...","items":[{type,x,y,w,h,caption,text,charIndex}]}
    # 坐标是 0~1 的相对值：换出图分辨率时构图等比缩放，不用重画
    layout_json: Mapped[str | None] = mapped_column(Text)

    # ---- 构图与出图 ----
    shot: Mapped[str] = mapped_column(String(20), default="medium")
    placement: Mapped[str] = mapped_column(String(20), default="center")
    extra: Mapped[str | None] = mapped_column(Text)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    model_preset: Mapped[str | None] = mapped_column(String(120))

    sort: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
