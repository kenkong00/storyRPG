from datetime import datetime
from sqlalchemy import Integer, String, Text, Float
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class Sound(Base):
    __tablename__ = "sounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="voice")
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_format: Mapped[str | None] = mapped_column(String(10))
    duration: Mapped[float | None] = mapped_column(Float)
    description: Mapped[str | None] = mapped_column(Text)
    category_path: Mapped[str | None] = mapped_column(String(300))  # 自定义分类路径
    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())