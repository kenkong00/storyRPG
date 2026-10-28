from datetime import datetime
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    character_type: Mapped[str] = mapped_column(String(20), nullable=False, default="npc")  # player / npc / enemy / ally
    title: Mapped[str | None] = mapped_column(String(100))
    level: Mapped[int] = mapped_column(Integer, default=1)
    realm_level: Mapped[int] = mapped_column(Integer, default=1)  # 境界等级 1-40，对应 CharacterRealm.level
    exp: Mapped[int] = mapped_column(Integer, default=0)
    hp: Mapped[int] = mapped_column(Integer, default=100)
    max_hp: Mapped[int] = mapped_column(Integer, default=100)
    mp: Mapped[int] = mapped_column(Integer, default=50)
    max_mp: Mapped[int] = mapped_column(Integer, default=50)
    attack: Mapped[int] = mapped_column(Integer, default=10)
    defense: Mapped[int] = mapped_column(Integer, default=5)
    speed: Mapped[int] = mapped_column(Integer, default=5)
    luck: Mapped[int] = mapped_column(Integer, default=5)
    recovery: Mapped[int] = mapped_column(Integer, default=60)  # 恢复 (REC)
    spirit: Mapped[int] = mapped_column(Integer, default=50)     # 精神 (SPR)
    crit_rate: Mapped[int] = mapped_column(Integer, default=8)  # 暴击率 (CRIT, %)
    personality: Mapped[str | None] = mapped_column(String(200))  # 逗号分隔的性格标签
    background_story: Mapped[str | None] = mapped_column(Text)
    portrait_image: Mapped[str | None] = mapped_column(String(500))
    expressions: Mapped[str | None] = mapped_column(Text)  # JSON: {"happy":"/images/happy.png","angry":"/images/angry.png"}
    is_alive: Mapped[int] = mapped_column(Integer, default=1)
    is_party_member: Mapped[int] = mapped_column(Integer, default=0)
    can_join_party: Mapped[int] = mapped_column(Integer, default=0)
    is_activated: Mapped[int] = mapped_column(Integer, default=0)  # player 类型激活后才可被用户选择
    join_condition: Mapped[str | None] = mapped_column(Text)  # JSON
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径

    # ===== 人物外观拼装（随机生成的多维外观 JSON，包含各维度取值与配色） =====
    appearance_json: Mapped[str | None] = mapped_column(Text)

    # ===== 语音配置（对话播报用） =====
    # gender: male / female / unknown —— 用于后台筛选语音主播，防止给男性角色配上女声
    gender: Mapped[str | None] = mapped_column(String(10), default="unknown")
    # tts_engine: 引擎标识（edge / onecore / custom_http ...），决定用哪个 Provider 合成
    tts_engine: Mapped[str | None] = mapped_column(String(32), default="edge")
    # tts_voice: 引擎内的音色 ID，例如 zh-CN-XiaoxiaoNeural / Microsoft Huihui
    tts_voice: Mapped[str | None] = mapped_column(String(64))
    # tts_rate / tts_pitch / tts_volume: 语速、音调、音量偏移（-100 ~ +100，0 为默认）
    tts_rate: Mapped[int] = mapped_column(Integer, default=0)
    tts_pitch: Mapped[int] = mapped_column(Integer, default=0)
    tts_volume: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    # 关系
    attributes: Mapped[list["CharacterAttribute"]] = relationship(back_populates="character", cascade="all, delete-orphan")
    skills: Mapped[list["CharacterSkill"]] = relationship(back_populates="character", cascade="all, delete-orphan")
    inventory: Mapped[list["CharacterInventory"]] = relationship(back_populates="character", cascade="all, delete-orphan")
    pose_images: Mapped[list["CharacterPoseImage"]] = relationship(
        back_populates="character", cascade="all, delete-orphan")
    appearances: Mapped[list["CharacterAppearance"]] = relationship(
        back_populates="character", cascade="all, delete-orphan",
        order_by="CharacterAppearance.sort")


class CharacterAttribute(Base):
    __tablename__ = "character_attributes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)
    attr_key: Mapped[str] = mapped_column(String(50), nullable=False)  # honor, cruelty, wisdom 等
    attr_value: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    character: Mapped["Character"] = relationship(back_populates="attributes")