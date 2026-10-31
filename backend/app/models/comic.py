# -*- coding: utf-8 -*-
"""漫画制作数据模型。

层级：工程 Project → 分册 Book → 页面 Page → 格子 Cell → 版本 CellVersion

几个关键决定（后面写代码不要改）：

1. **格子是独立单元**。提示词、人物绑定、生图参数、图片、版本历史全在格子自己身上。
   复制出来的格子是新 id、版本为空，和原格彻底脱钩。
2. **格子不一定是矩形**。x/y/w/h 只是外接框，points 是相对外框的归一化多边形
   （[[0,0],[1,0],[1,1],[0,1]] = 矩形）。斜构图 / 梯形分格靠改 points，
   整体旋转靠 rotation，两者可以叠加。
3. **图片只存路径**。文件在 data/comic/ 下按 工程/格子 分目录，数据库只记 url。
   多版本一起保留，current_version_id 决定画布与导出让哪张上屏。
"""

from datetime import datetime

from sqlalchemy import (Float, ForeignKey, Integer, String, Text)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ComicProject(Base):
    __tablename__ = "comic_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="未命名漫画")

    # manga 页漫 / scroll 条漫 / lianhuanhua 小人书（一页一格）
    mode: Mapped[str] = mapped_column(String(20), default="manga")

    # 页面尺寸（像素）。条漫只用到 page_w，高度由格子堆叠决定
    page_w: Mapped[int] = mapped_column(Integer, default=1240)
    page_h: Mapped[int] = mapped_column(Integer, default=1754)
    page_margin: Mapped[int] = mapped_column(Integer, default=40)
    gap: Mapped[int] = mapped_column(Integer, default=16)
    bg_color: Mapped[str] = mapped_column(String(20), default="#ffffff")

    # right_to_left / left_to_right / top_to_bottom
    reading_direction: Mapped[str] = mapped_column(String(20), default="right_to_left")

    # 全局提示词
    style_prefix: Mapped[str | None] = mapped_column(Text, default="")
    negative_prompt: Mapped[str | None] = mapped_column(Text, default="")

    # 默认出图（格子留空时继承）
    workflow_preset: Mapped[str | None] = mapped_column(String(120))
    model_preset: Mapped[str | None] = mapped_column(String(120))
    steps: Mapped[int | None] = mapped_column(Integer)
    cfg: Mapped[float | None] = mapped_column(Float)
    seed_mode: Mapped[str] = mapped_column(String(10), default="random")

    # 素材 / 展示
    cover: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, default="")
    author: Mapped[str | None] = mapped_column(String(60), default="")

    status: Mapped[str] = mapped_column(String(20), default="draft")
    is_published: Mapped[int] = mapped_column(Integer, default=0, index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    category_path: Mapped[str | None] = mapped_column(String(300))

    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)

    books: Mapped[list["ComicBook"]] = relationship(
        back_populates="project", cascade="all, delete-orphan",
        order_by="ComicBook.sort")


class ComicBook(Base):
    """分册 / 合集：一卷、一话、一个合集。一个工程可以有很多册。"""

    __tablename__ = "comic_books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("comic_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), default="第一话")
    book_no: Mapped[int] = mapped_column(Integer, default=1)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(30), default=_now)

    project: Mapped["ComicProject"] = relationship(back_populates="books")
    pages: Mapped[list["ComicPage"]] = relationship(
        back_populates="book", cascade="all, delete-orphan",
        order_by="ComicPage.page_no")


class ComicPage(Base):
    """页面。页漫多格；小人书一页一格；条漫是一段纵向画布。"""

    __tablename__ = "comic_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("comic_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("comic_books.id", ondelete="CASCADE"), nullable=False, index=True)

    title: Mapped[str | None] = mapped_column(String(120), default="")
    page_no: Mapped[int] = mapped_column(Integer, default=1)
    width: Mapped[int] = mapped_column(Integer, default=1240)
    height: Mapped[int] = mapped_column(Integer, default=1754)
    bg_color: Mapped[str] = mapped_column(String(20), default="#ffffff")
    sort: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)

    book: Mapped["ComicBook"] = relationship(back_populates="pages")
    cells: Mapped[list["ComicCell"]] = relationship(
        back_populates="page", cascade="all, delete-orphan",
        order_by="ComicCell.read_order")


class ComicCell(Base):
    __tablename__ = "comic_cells"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("comic_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    page_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("comic_pages.id", ondelete="CASCADE"), nullable=False, index=True)
    read_order: Mapped[int] = mapped_column(Integer, default=1)

    # ---- 排版 ----
    x: Mapped[int] = mapped_column(Integer, default=0)
    y: Mapped[int] = mapped_column(Integer, default=0)
    w: Mapped[int] = mapped_column(Integer, default=400)
    h: Mapped[int] = mapped_column(Integer, default=300)
    rotation: Mapped[float] = mapped_column(Float, default=0.0)
    # 归一化多边形点（相对外接框，0~1）。空 = 矩形
    points: Mapped[str | None] = mapped_column(Text)
    border_color: Mapped[str] = mapped_column(String(20), default="#111111")
    border_width: Mapped[int] = mapped_column(Integer, default=3)
    border_style: Mapped[str] = mapped_column(String(20), default="solid")
    border_radius: Mapped[int] = mapped_column(Integer, default=0)
    opacity: Mapped[float] = mapped_column(Float, default=1.0)
    z_index: Mapped[int] = mapped_column(Integer, default=0)
    is_locked: Mapped[int] = mapped_column(Integer, default=0)
    # ---- 格子底色：bg_enabled=0 表示不要背景（透明，露出页面/画布底色）----
    # 格子底色：0 = 无背景（透明，默认），1 = 有背景
    bg_enabled: Mapped[int] = mapped_column(Integer, default=0)
    bg_color: Mapped[str] = mapped_column(String(20), default="#ffffff")

    # 图在格内的取景：cover/contain + 缩放 + 偏移
    fit: Mapped[str] = mapped_column(String(10), default="cover")
    img_scale: Mapped[float] = mapped_column(Float, default=1.0)
    img_offset_x: Mapped[float] = mapped_column(Float, default=0.0)
    img_offset_y: Mapped[float] = mapped_column(Float, default=0.0)
    flip_h: Mapped[int] = mapped_column(Integer, default=0)

    # ---- 提示词（人工维护） ----
    prompt_positive: Mapped[str | None] = mapped_column(Text, default="")
    prompt_negative: Mapped[str | None] = mapped_column(Text, default="")
    prompt_locked: Mapped[int] = mapped_column(Integer, default=0)
    # 整格手写覆盖：非空时直接用它出图，不再自动拼
    prompt_override: Mapped[str | None] = mapped_column(Text, default="")

    # 人物绑定：[{character_id, appearance_id, name, note, order}]
    characters: Mapped[str | None] = mapped_column(Text, default="[]")

    # ---- 生图参数（空 = 继承工程） ----
    workflow_preset: Mapped[str | None] = mapped_column(String(120))
    model_preset: Mapped[str | None] = mapped_column(String(120))
    steps: Mapped[int | None] = mapped_column(Integer)
    cfg: Mapped[float | None] = mapped_column(Float)
    seed: Mapped[int | None] = mapped_column(Integer, default=-1)
    seed_mode: Mapped[str | None] = mapped_column(String(10))

    # ---- 台词气泡：[{x,y,w,h,text,type,color,bg,border,border_width,size,rotation,direction}] ----
    bubbles: Mapped[str | None] = mapped_column(Text, default="[]")
    # ---- 漫画特效叠加层：[{type,x,y,w,h,rotation,color,opacity}]（符号/速度线/方向线等） ----
    effects: Mapped[str | None] = mapped_column(Text, default="[]")

    # ---- 生成状态 ----
    current_image: Mapped[str | None] = mapped_column(String(500))
    current_version_id: Mapped[int | None] = mapped_column(Integer)
    gen_status: Mapped[str] = mapped_column(String(20), default="empty")
    last_error: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)

    page: Mapped["ComicPage"] = relationship(back_populates="cells")
    versions: Mapped[list["ComicCellVersion"]] = relationship(
        back_populates="cell", cascade="all, delete-orphan",
        order_by="ComicCellVersion.id")


class ComicCellVersion(Base):
    """一个格子每生成一次 = 一个版本。旧版本永不覆盖，只能手动删。"""

    __tablename__ = "comic_cell_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cell_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("comic_cells.id", ondelete="CASCADE"), nullable=False, index=True)

    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)

    prompt_positive: Mapped[str | None] = mapped_column(Text)
    prompt_negative: Mapped[str | None] = mapped_column(Text)
    params: Mapped[str | None] = mapped_column(Text)   # JSON：seed/steps/cfg/模型方案/工作流
    seed: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="success")
    is_selected: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(String(200), default="")
    # 版本自定义名字（默认显示 #id，随时可改）
    name: Mapped[str | None] = mapped_column(String(120), default="")
    # 该版本对应的人物绑定快照（JSON 字符串）；选中版本时还原到格子，方便在此基础上继续改
    characters: Mapped[str | None] = mapped_column(Text, default="[]")
    # 版本配方：自定义内容分「前置 / 后置」两段，包住人物区块；override 非空时整段替换。
    # 老版本这三列为 NULL（历史成品，直接看 prompt_positive）；新版本为 ''（按配方拼装）。
    prompt_prefix: Mapped[str | None] = mapped_column(Text, default="")
    prompt_suffix: Mapped[str | None] = mapped_column(Text, default="")
    prompt_override: Mapped[str | None] = mapped_column(Text, default="")
    elapsed: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[str] = mapped_column(String(30), default=_now)

    cell: Mapped["ComicCell"] = relationship(back_populates="versions")
