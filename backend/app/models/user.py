from datetime import datetime
from sqlalchemy import Integer, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class User(Base):
    """前台用户（不能进入后台，只能玩游戏）"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    nickname: Mapped[str | None] = mapped_column(String(50))
    avatar: Mapped[str | None] = mapped_column(String(500))
    session_token: Mapped[str | None] = mapped_column(String(200))  # 登录令牌
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    last_login: Mapped[str | None] = mapped_column(String(30))

    game_library: Mapped[list["UserGameLibrary"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    characters: Mapped[list["UserCharacter"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserGameLibrary(Base):
    """用户游戏清单：用户必须先把游戏加入清单才能玩（为以后购买扩展做准备）"""
    __tablename__ = "user_game_library"
    __table_args__ = (
        UniqueConstraint("user_id", "game_id", name="uq_user_game"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), nullable=False)
    added_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    user: Mapped["User"] = relationship(back_populates="game_library")


class UserCharacter(Base):
    """用户在某游戏中的角色实例（基于后台 Character 模板新建，自带等级/装备/背包持久化）"""
    __tablename__ = "user_characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), nullable=False)
    base_character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), nullable=False)  # 模板来源
    custom_name: Mapped[str] = mapped_column(String(100), nullable=False)  # 用户自定义名称
    # 角色状态（持久化）
    level: Mapped[int] = mapped_column(Integer, default=1)
    realm_level: Mapped[int] = mapped_column(Integer, default=1)
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
    crit_rate: Mapped[int] = mapped_column(Integer, default=7)  # 暴击率 (CRIT, %)
    # 存档：上次故事节点 + 存档时间戳
    last_story_node_id: Mapped[int | None] = mapped_column(Integer)
    last_chapter_id: Mapped[int | None] = mapped_column(Integer)
    save_data: Mapped[str | None] = mapped_column(Text)  # JSON 扩展存档信息
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())

    user: Mapped["User"] = relationship(back_populates="characters")
    equipments: Mapped[list["UserCharacterEquipment"]] = relationship(back_populates="user_character", cascade="all, delete-orphan")
    inventory: Mapped[list["UserCharacterInventory"]] = relationship(back_populates="user_character", cascade="all, delete-orphan")


class UserCharacterEquipment(Base):
    """用户角色的已装备物品（多槽位：套装1/配饰2/法器3）"""
    __tablename__ = "user_character_equipments"
    __table_args__ = (
        UniqueConstraint("user_character_id", "slot", "slot_index", name="uq_user_char_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_character_id: Mapped[int] = mapped_column(Integer, ForeignKey("user_characters.id"), nullable=False)
    equipment_id: Mapped[int] = mapped_column(Integer, ForeignKey("equipments.id"), nullable=False)
    slot: Mapped[str] = mapped_column(String(20), nullable=False)  # set / accessory / artifact
    slot_index: Mapped[int] = mapped_column(Integer, default=1)  # 套装固定1，配饰1-2，法器1-3

    user_character: Mapped["UserCharacter"] = relationship(back_populates="equipments")


class UserCharacterInventory(Base):
    """用户角色背包物品"""
    __tablename__ = "user_character_inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_character_id: Mapped[int] = mapped_column(Integer, ForeignKey("user_characters.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, nullable=False)  # 可能是 items.id 或 equipments.id
    item_kind: Mapped[str] = mapped_column(String(20), default="item")  # item / equipment
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    user_character: Mapped["UserCharacter"] = relationship(back_populates="inventory")
