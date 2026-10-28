from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class StoryArc(Base):
    __tablename__ = "story_arcs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str | None] = mapped_column(String(500))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    trigger_condition: Mapped[str | None] = mapped_column(Text)  # JSON 触发条件
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    chapters: Mapped[list["StoryChapter"]] = relationship(back_populates="story_arc", cascade="all, delete-orphan")


class StoryChapter(Base):
    __tablename__ = "story_chapters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    story_arc_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_arcs.id"))
    chapter_order: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str | None] = mapped_column(String(500))
    cover_animation_effect_id: Mapped[int | None] = mapped_column(Integer)
    is_main_story: Mapped[int] = mapped_column(Integer, default=1)
    prerequisite_chapter_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_chapters.id"))
    unlock_condition: Mapped[str | None] = mapped_column(Text)  # JSON
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径

    nodes: Mapped[list["StoryNode"]] = relationship(back_populates="chapter", cascade="all, delete-orphan")
    story_arc: Mapped["StoryArc"] = relationship(back_populates="chapters")


class StoryNode(Base):
    __tablename__ = "story_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(Integer, ForeignKey("story_chapters.id"), nullable=False)
    scene_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("scenes.id"))
    node_type: Mapped[str] = mapped_column(String(20), nullable=False)  # dialogue / choice / battle / event / cutscene
    title: Mapped[str | None] = mapped_column(String(200))
    speaker_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"))
    content: Mapped[str | None] = mapped_column(Text)
    content_image: Mapped[str | None] = mapped_column(String(500))
    expression: Mapped[str | None] = mapped_column(String(30))
    position: Mapped[str | None] = mapped_column(String(20))
    multi_characters: Mapped[str | None] = mapped_column(Text)
    bgm: Mapped[str | None] = mapped_column(String(500))
    background_change: Mapped[str | None] = mapped_column(String(500))
    bg_animation_effect_id: Mapped[int | None] = mapped_column(Integer)
    is_key_node: Mapped[int] = mapped_column(Integer, default=0)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[str | None] = mapped_column(Text)  # JSON: 标签ID数组
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    # 战斗节点配置（JSON，node_type='battle' 时生效）
    # {
    #   "enemies":[{"character_id":2,"level":5,"ai":"aggressive","skills":[11,12],
    #               "drops":[{"item_id":2,"chance":60,"quantity":1}],
    #               "phases":[{"hp_below":50,"name":"狂暴","line":"...","skills":[...]}]}],
    #   "level_mode":"scale|fixed", "level_offset":0, "difficulty":1.0,
    #   "allow_flee":true, "exp_multiplier":1.0, "background":"","bgm":"",
    #   "victory_node_id":null, "defeat_node_id":null, "flee_node_id":null,
    #   "banter":[{"trigger":"battle_start","speaker":"黄蓉","line":"...","expression":"angry"}]
    # }
    battle_config: Mapped[str | None] = mapped_column(Text)

    chapter: Mapped["StoryChapter"] = relationship(back_populates="nodes")
    choices: Mapped[list["StoryChoice"]] = relationship(back_populates="node", cascade="all, delete-orphan", foreign_keys="[StoryChoice.node_id]")
    dialogues: Mapped[list["StoryNodeDialogue"]] = relationship(back_populates="node", cascade="all, delete-orphan")


class StoryNodeDialogue(Base):
    """剧情节点内的对话列表：一个节点可包含多句对白。

    每句对白可单独指定：说话者、表情、立绘坐标/缩放/裁剪、动效、语音。
    坐标使用屏幕百分比（0~100），crop_top/crop_bottom 为相对立绘高度的百分比区间，
    用于实现"只显示上半身 / 胸部以上 / 膝盖以上"等局部显示。
    """
    __tablename__ = "story_node_dialogues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(Integer, ForeignKey("story_nodes.id"), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    speaker_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"))
    content: Mapped[str | None] = mapped_column(Text)
    expression: Mapped[str | None] = mapped_column(String(30))
    # 立绘坐标（屏幕百分比）
    pos_x: Mapped[float | None] = mapped_column(Float, default=50.0)     # 水平中心 0~100
    pos_y: Mapped[float | None] = mapped_column(Float, default=0.0)      # 底边离屏幕底部的百分比（可负：下沉）
    scale: Mapped[float | None] = mapped_column(Float, default=1.0)      # 立绘缩放
    crop_top: Mapped[float | None] = mapped_column(Float, default=0.0)   # 显示区间起点（立绘高度百分比）
    crop_bottom: Mapped[float | None] = mapped_column(Float, default=100.0)  # 显示区间终点
    flip: Mapped[int] = mapped_column(Integer, default=0)                # 1 = 左右镜像
    z_index: Mapped[int] = mapped_column(Integer, default=1)             # 层级
    disappear_after: Mapped[int] = mapped_column(Integer, default=0)     # 1 = 该角色说完这句后从舞台消失
    animation_effect_id: Mapped[int | None] = mapped_column(Integer)
    voice: Mapped[str | None] = mapped_column(String(500))
    bg_change: Mapped[str | None] = mapped_column(String(500))           # 该句切换背景（可选）
    bgm: Mapped[str | None] = mapped_column(String(500))                 # 该句切换音乐（可选）

    node: Mapped["StoryNode"] = relationship(back_populates="dialogues")


class StoryChoice(Base):
    __tablename__ = "story_choices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(Integer, ForeignKey("story_nodes.id"), nullable=False)
    choice_text: Mapped[str] = mapped_column(String(500), nullable=False)
    next_node_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_nodes.id"))
    condition_group: Mapped[str | None] = mapped_column(String(50))
    effects: Mapped[str | None] = mapped_column(Text)  # JSON
    is_hidden: Mapped[int] = mapped_column(Integer, default=0)

    node: Mapped["StoryNode"] = relationship(back_populates="choices", foreign_keys="[StoryChoice.node_id]")


class StoryCondition(Base):
    __tablename__ = "story_conditions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    condition_group: Mapped[str] = mapped_column(String(50), nullable=False)
    condition_type: Mapped[str] = mapped_column(String(30), nullable=False)  # level / attribute / relationship / item / quest / flag / character_alive / character_in_party
    target_id: Mapped[int | None] = mapped_column(Integer)
    operator: Mapped[str] = mapped_column(String(20), nullable=False)  # >= / <= / == / != / > / < / has / not_has
    value: Mapped[str] = mapped_column(String(200), nullable=False)


class StoryFlag(Base):
    __tablename__ = "story_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    flag_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    flag_value: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str | None] = mapped_column(Text)
    set_at_node_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_nodes.id"))
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())