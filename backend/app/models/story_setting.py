from datetime import datetime

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class StorySetting(Base):
    """剧情演出的全局设置（单行表，id 固定为 1）。

    刻意用一列 JSON 存整包，而不是一个参数一列：
    剧情演出这类参数以后会长，加一项不用改表结构（migrate 走 defaults 合并即可）。
    后台「设置 → 剧情管理」和前台「设置 → 剧情演出」都读写这一份。

    当前 bin 里的键（缺的键由 DEFAULT_STORY_SETTINGS 兜底）：
      stage_focus_mode        off / subtle / normal / strong / custom
      dim_brightness          非说话者亮度（0.3~1.2）
      dim_saturate            非说话者饱和度（0~1.5）
      speak_brightness        说话者亮度（0.8~1.5）
      speak_saturate          说话者饱和度（0~2）
      speak_glow              说话者辉光强度（0~100，0 = 无辉光）
      focus_transition_ms     明暗过渡时长（毫秒）
      auto_play_default       进游戏是否默认开启自动播放
      auto_play_delay_ms      每句说完后的停顿（毫秒）
      auto_play_stop_on_choice 遇到选项时是否自动停下（默认停）
    """

    __tablename__ = "story_setting"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    data: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[str] = mapped_column(
        String(30), default=lambda: datetime.now().isoformat(),
        onupdate=lambda: datetime.now().isoformat())
