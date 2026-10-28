from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Game(Base):
    """游戏设置：一个独立的可玩游戏（开始画面）

    is_published=1 时出现在前台作为独立游戏；
    is_carousel=1 时出现在前台首页轮播图（必须有 image）；
    is_coming_soon=1 时前台仅展示宣传描述，按钮置为不可用。
    category_path 即前台页面的游戏分类。
    """
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)  # 宣传描述
    image: Mapped[str | None] = mapped_column(String(500))  # 必须有图片
    category_path: Mapped[str | None] = mapped_column(String(300))  # 前台分类
    is_published: Mapped[int] = mapped_column(Integer, default=0)
    is_carousel: Mapped[int] = mapped_column(Integer, default=0)
    is_coming_soon: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    buttons: Mapped[list["GameButton"]] = relationship(back_populates="game", cascade="all, delete-orphan")
    player_options: Mapped[list["GamePlayerOption"]] = relationship(back_populates="game", cascade="all, delete-orphan")


class GameButton(Base):
    """游戏开始画面上的按钮：位置/图片/点击进入的故事章节/是否可用"""
    __tablename__ = "game_buttons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    image: Mapped[str | None] = mapped_column(String(500))  # 按钮图片替换
    # 按钮摆放位置（百分比 0-100，相对于开始画面）
    position_x: Mapped[float] = mapped_column(Integer, default=50)
    position_y: Mapped[float] = mapped_column(Integer, default=50)
    # 动作类型: start(开始游戏)/load(读取存档)/save(保存)/new_char(新建人物)/exit(退出)/custom(自定义跳转)
    action_type: Mapped[str] = mapped_column(String(30), default="start")
    target_story_chapter_id: Mapped[int | None] = mapped_column(Integer)  # 点击进入的故事章节
    is_enabled: Mapped[int] = mapped_column(Integer, default=1)  # 是否可用
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    game: Mapped["Game"] = relationship(back_populates="buttons")


class GamePlayerOption(Base):
    """游戏可指定的玩家角色组合：某游戏可选哪些已激活的 player 角色供用户选择"""
    __tablename__ = "game_player_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), nullable=False)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    game: Mapped["Game"] = relationship(back_populates="player_options")
