from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    scene_type: Mapped[str] = mapped_column(String(20), default="wilderness")  # town / dungeon / wilderness / castle / forest / cave / battlefield
    description: Mapped[str | None] = mapped_column(Text)
    background_image: Mapped[str | None] = mapped_column(String(500))
    ambient_sound: Mapped[str | None] = mapped_column(String(500))
    is_safe_zone: Mapped[int] = mapped_column(Integer, default=0)
    entry_condition: Mapped[str | None] = mapped_column(Text)  # JSON
    parent_region: Mapped[str | None] = mapped_column(String(100))
    coordinates: Mapped[str | None] = mapped_column(String(50))  # JSON: {x, y}
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径

    # ===== 场景拼装 / ComfyUI 出图 =====
    # 拼装维度取值（JSON）：地点 / 时间 / 天气 / 光线 / 氛围 / 构图 / 风格 ...
    appearance_json: Mapped[str | None] = mapped_column(Text)
    # 自由提示词（与拼装结果叠加；留空则只用拼装）
    prompt_text: Mapped[str | None] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text)

    npcs: Mapped[list["SceneNPC"]] = relationship(back_populates="scene", cascade="all, delete-orphan")
    images: Mapped[list["SceneImage"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan", order_by="SceneImage.id")
    # 多套外观配置（晴天 / 雨天 / 夜晚 …）；scene.appearance_json 是默认配置的一份镜像
    appearances: Mapped[list["SceneAppearance"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan", order_by="SceneAppearance.sort")


class SceneConnection(Base):
    __tablename__ = "scene_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id"), nullable=False)
    to_scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id"), nullable=False)
    travel_text: Mapped[str | None] = mapped_column(String(200))
    travel_time: Mapped[int] = mapped_column(Integer, default=0)
    is_locked: Mapped[int] = mapped_column(Integer, default=0)
    unlock_condition: Mapped[str | None] = mapped_column(Text)  # JSON


class SceneNPC(Base):
    __tablename__ = "scene_npcs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id"), nullable=False)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    position: Mapped[str | None] = mapped_column(String(100))
    appearance_condition: Mapped[str | None] = mapped_column(Text)  # JSON
    default_dialogue: Mapped[str | None] = mapped_column(Text)

    scene: Mapped["Scene"] = relationship(back_populates="npcs")