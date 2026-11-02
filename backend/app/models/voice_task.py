"""语音任务：一批「人物声音内容」→ 逐条合成 → 识别裁剪 → 存成这个角色的声音包。

为什么要单独建表而不是复用声音表：
    声音表只记「一条已经存在的音频」。任务要记的是「这一批还没做完的事」——
    每条文本处理到哪一步、失败原因、产物是哪条声音。进度断了能接着跑，
    失败了能只重跑失败的那几条，这些都不是声音表该管的事。
"""
from datetime import datetime

from sqlalchemy import Integer, String, Text, Float
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class VoiceTask(Base):
    __tablename__ = "voice_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), default="未命名语音任务")

    # 声音属于谁 + 用哪个语音主播（这四项就是「人物管理 → 语音」那一屏的配置）
    character_id: Mapped[int] = mapped_column(Integer, default=0)
    engine: Mapped[str] = mapped_column(String(32), default="")   # 空 = 自动 / 全部引擎
    voice_id: Mapped[str] = mapped_column(String(64), default="")
    rate: Mapped[int] = mapped_column(Integer, default=0)          # 语速 -50~50
    pitch: Mapped[int] = mapped_column(Integer, default=0)         # 音调 -30~30
    volume: Mapped[int] = mapped_column(Integer, default=0)        # 音量 -50~50

    # 产物落到哪个声音分类（= 声音包），例如「角色语音/小小」
    pack_path: Mapped[str] = mapped_column(String(300), default="")
    name_len: Mapped[int] = mapped_column(Integer, default=8)      # 名称取文本前几个字
    trim_opts: Mapped[str] = mapped_column(Text, default="")       # 识别裁剪参数 JSON

    status: Mapped[str] = mapped_column(String(20), default="idle")  # idle/running/done/error/stopped
    total: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now, onupdate=_now)


class VoiceTaskLine(Base):
    __tablename__ = "voice_task_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")

    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/running/done/error
    sound_id: Mapped[int] = mapped_column(Integer, default=0)   # 产出后的声音 id
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[str] = mapped_column(String(30), default=_now, onupdate=_now)
