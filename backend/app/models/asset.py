# -*- coding: utf-8 -*-
"""统一素材表。

设计原则：**图是图，用是用**。

一张图 = 一条 Asset。不管它来自 AI 生成、本地上传、还是从老目录扫进来的，
都进这一张表。两个维度分开记，别混在一起：

  · kind          —— 这张图**是什么素材**（人物立绘 / 人物动作 / 场景 / 物品 / 怪物 / 界面 / 图标）
  · subject_*     —— 这张图**画的是谁/什么**（人物#1 小小 / 场景#3 黑森林 / 物品#12 长剑）

「谁在用它」**不存这里** —— 存了就会和业务表打架（改了立绘忘了改引用表是常态）。
改用 services/asset_usages.py 实时反查各业务表的图片字段，永远是准的。

所以：
  · 换立绘 = 改 characters.portrait_image 的 url，素材本身不动
  · 删素材 = 先问一句「被 3 个地方引用着，确定删？」（引用数实时算的）
  · 老图不想用又不敢删 = status 改成 archived，从选择器里隐藏，文件还在
"""

from datetime import datetime

from sqlalchemy import Integer, String, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 访问路径，如 /generated/pose_1_magic_cast_0001.png、/images/characters/portrait/a1b2c3.png
    url: Mapped[str] = mapped_column(String(500), nullable=False, unique=True, index=True)
    filename: Mapped[str | None] = mapped_column(String(300))

    # 素材类型（决定它在选择器里归到哪一栏）
    kind: Mapped[str] = mapped_column(String(32), default="other", index=True)

    # 画面主体：character / scene / item / monster / prop / ""
    subject_type: Mapped[str | None] = mapped_column(String(32), index=True)
    subject_id: Mapped[int | None] = mapped_column(Integer, index=True)
    subject_name: Mapped[str | None] = mapped_column(String(120))

    name: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(200))
    tags: Mapped[str | None] = mapped_column(String(400))

    # 同一主体的不同「变体」：人物动作 id、镜头角度、表情名 —— 人物动作图靠它分组
    variant: Mapped[str | None] = mapped_column(String(64), index=True)
    variant_name: Mapped[str | None] = mapped_column(String(100))

    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    bytes: Mapped[int | None] = mapped_column(Integer)

    # 从哪来：ai / upload / import
    origin: Mapped[str] = mapped_column(String(20), default="upload", index=True)
    # 具体场景：pose_batch / appearance_render / manual / upload / imported
    source: Mapped[str | None] = mapped_column(String(40), index=True)

    # draft（草稿）/ final（定稿）/ archived（弃用但保留文件）
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)

    # AI 血统
    prompt: Mapped[str | None] = mapped_column(Text)
    negative: Mapped[str | None] = mapped_column(Text)
    model_preset: Mapped[str | None] = mapped_column(String(100))
    job_id: Mapped[str | None] = mapped_column(String(40))
    seed: Mapped[int | None] = mapped_column(Integer)

    # 兜底扩展（宽高比、调色信息、来源人物动作等）
    meta: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(
        String(30), default=lambda: datetime.now().isoformat(), index=True)
    updated_at: Mapped[str | None] = mapped_column(String(30))


Index("ix_assets_kind_origin", Asset.kind, Asset.origin)
Index("ix_assets_subject", Asset.subject_type, Asset.subject_id)
