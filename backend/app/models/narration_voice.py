from datetime import datetime

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class NarrationVoice(Base):
    """旁白（叙述）的语音配置。

    剧情里「没有说话人」的那些句子（旁白 / 环境描写）走这套配置，
    和 Character 上的 tts_* 字段是同一组语义。
    单行表：id 固定为 1，没有记录时用引擎默认音色。
    """

    __tablename__ = "narration_voice"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    engine: Mapped[str] = mapped_column(String(32), default="")      # 空 = 跟随默认
    voice_id: Mapped[str] = mapped_column(String(64), default="")
    rate: Mapped[int] = mapped_column(Integer, default=-6)           # 旁白通常稍慢一点更好听
    pitch: Mapped[int] = mapped_column(Integer, default=-4)          # 稍低一点，更像旁白
    volume: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[int] = mapped_column(Integer, default=1)         # 0 = 旁白不配音
    updated_at: Mapped[str] = mapped_column(
        String(30), default=lambda: datetime.now().isoformat(),
        onupdate=lambda: datetime.now().isoformat())
