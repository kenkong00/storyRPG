"""TTS Provider 抽象层 —— 所有语音引擎的统一接口。

设计目标（为了让「本机 TTS」「语音大模型 API」都能即插即用）：

1. 任何引擎只要实现 TTSProvider 四个方法，注册进 registry 就能在后台被选中，
   业务代码与前端完全不需要改动。
2. Provider 只负责「文本 -> 音频文件」，不关心缓存、降级、并发这些事，
   那些统一放在 service.py 里。职责单一，新增引擎只需关心自己的 API。
3. list_voices() 必须返回带 gender 的 Voice，后台据此做男女筛选。
   这是特意从原方案补齐的：原信息聚合网站的音色列表没有显式男女标注。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from typing import Any

# 性别常量。之所以用英文而非中文，是为了避免和前端/配置文件的编码问题纠缠。
GENDER_MALE = "male"
GENDER_FEMALE = "female"
GENDER_UNKNOWN = "unknown"

GENDER_LABELS = {
    GENDER_MALE: "男",
    GENDER_FEMALE: "女",
    GENDER_UNKNOWN: "未知",
}


# 年龄分层。官方音色其实不标注年龄，但对 RPG 来说「这个声音像不像老人/小孩」
# 是选角的第一直觉，所以把它做成一等字段，后台才能按年龄筛。
AGE_CHILD = "child"
AGE_ADULT = "adult"
AGE_ELDER = "elder"

AGE_LABELS = {
    AGE_CHILD: "童声",
    AGE_ADULT: "青壮",
    AGE_ELDER: "老年",
}

# 音色分组。后台下拉按这个分组渲染，避免 26 个音色挤在一个扁平列表里。
GROUP_STANDARD = "standard"   # 普通话通用
GROUP_DIALECT = "dialect"     # 方言乡音
GROUP_REGIONAL = "regional"   # 粤语 / 台普等地区口音
GROUP_MULTILINGUAL = "multilingual"  # 多语言音色（英文母语，可读中文）
GROUP_ROLE = "role"           # 派生角色声线

GROUP_LABELS = {
    GROUP_STANDARD: "普通话通用",
    GROUP_DIALECT: "方言乡音",
    GROUP_REGIONAL: "地区口音",
    GROUP_MULTILINGUAL: "多语言（读中文）",
    GROUP_ROLE: "角色声线（派生）",
}


@dataclass
class Voice:
    """一个可选音色（语音主播）。"""

    voice_id: str                      # 引擎内唯一 ID，例如 zh-CN-XiaoxiaoNeural
    name: str                          # 中文显示名，例如「晓伊」
    gender: str = GENDER_UNKNOWN       # male / female / unknown
    lang: str = "zh-CN"
    style: str = ""                    # 风格标签，例如「活泼」「温柔」「专业」
    note: str = ""                     # 备注，例如「适合少女」「旁白」
    engine: str = ""                   # 所属引擎 ID
    age: str = AGE_ADULT               # child / adult / elder，用于按年龄筛
    group: str = GROUP_STANDARD        # standard / dialect / regional / role
    derived: bool = False              # True 表示这是由基础音色派生出来的声线
    rate: int = 0                      # 派生声线的语速偏移（仅派生声线有意义）
    pitch: int = 0                     # 派生声线的音调偏移（仅派生声线有意义）

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def age_label(self) -> str:
        return AGE_LABELS.get(self.age, "")

    @property
    def group_label(self) -> str:
        return GROUP_LABELS.get(self.group, self.group)

    @property
    def gender_label(self) -> str:
        return GENDER_LABELS.get(self.gender, self.gender)


@dataclass
class SynthRequest:
    """一次合成请求。所有数值型参数的合法区间都是 -100 ~ +100。"""

    text: str
    voice_id: str = ""
    rate: int = 0        # 语速
    pitch: int = 0       # 音调
    volume: int = 0      # 音量
    out_path: str = ""   # 输出音频绝对路径（MP3）
    out_format: str = "mp3"


@dataclass
class AudioResult:
    """合成结果。engine 字段记录真正发声的引擎（可能与请求的不同，因为可能经过了降级）。"""

    path: str = ""            # 本地绝对路径
    url: str = ""             # 前端可直接播放的静态 URL（/tts-cache/...）
    bytes: int = 0
    duration_ms: int = 0     # 音频时长（毫秒），前端用于对齐打字机速度
    synth_ms: int = 0        # 本次真实合成耗时（毫秒），0 表示命中缓存
    engine: str = ""
    voice_id: str = ""
    cached: bool = False
    degraded: bool = False   # True 表示这次结果来自降级链上的备用引擎
    error: str = ""


class TTSException(Exception):
    """引擎内部错误。携带 engine 便于上层判断降级路径。"""

    def __init__(self, message: str, engine: str = ""):
        super().__init__(message)
        self.engine = engine


class TTSProvider(ABC):
    """语音引擎基类。

    子类必须定义三个类属性，并实现 is_available / list_voices / _do_synthesize。
    """

    engine_id: str = ""            # 引擎唯一标识，存进 characters.tts_engine
    display_name: str = ""         # 后台显示名
    requires_network: bool = False  # 是否需要联网（用于 UI 提示与降级顺序判断）

    @abstractmethod
    def is_available(self) -> bool:
        """当前环境下该引擎是否可用（缺依赖、缺配置都返回 False）。"""

    @abstractmethod
    def list_voices(self, refresh: bool = False) -> list[Voice]:
        """返回该引擎的音色清单。内部自行缓存，refresh=True 强制刷新。"""

    @abstractmethod
    def _do_synthesize(self, req: SynthRequest) -> None:
        """同步执行一次合成，把音频写到 req.out_path。失败抛 TTSException。

        这是同步方法：有些引擎（edge-tts）内部是 asyncio 的，
        由子类自己处理事件循环；onecore 是子进程阻塞，也是同步的。
        统一同步签名可以让 service 层用统一的线程池去并发跑，不必区分。
        """

    def validate(self, req: SynthRequest) -> None:
        """合成前的参数校验。默认只校验文本非空，子类可覆盖。"""
        if not (req.text or "").strip():
            raise TTSException("合成文本为空", self.engine_id)

    def describe(self) -> dict[str, Any]:
        """给后台/接口用的引擎元信息。"""
        return {
            "id": self.engine_id,
            "name": self.display_name,
            "requires_network": self.requires_network,
            "available": self.is_available(),
        }
