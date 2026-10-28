"""剧情角色语音服务。

对外只需 import service / registry 即可，内部按职责拆成：
    base       Provider 抽象接口与数据结构
    catalog    音色中文目录（含性别标注）
    edge       Edge TTS 在线引擎（默认主引擎，8 音色 4 男 4 女）
    onecore    Windows 本机离线引擎（兜底，3 音色）
    http       通用 HTTP 引擎（语音大模型 API / 本地 TTS 服务的插槽）
    registry   引擎注册与降级顺序
    cache      磁盘 MP3 缓存与 LRU 淘汰
    service    统一入口：缓存、并发、降级、批量预合成

新增一种语音服务只要两步：
    1. 写一个继承 TTSProvider 的类（实现 is_available / list_voices / _do_synthesize）
    2. 在 registry.ensure_loaded() 里 register 一行，
       或者在 data/tts_config.json 里配一个 http 类型的 provider
"""
from .service import (
    clear_cache, cache_info, ffmpeg_available, list_all_voices_grouped,
    list_engines, list_voices, reload_http_config, set_ffmpeg, set_ffmpeg_search,
    synth_async, synth_batch, synth_sync, warmup, url_for,
)
from .registry import registry

__all__ = [
    "synth_sync", "synth_async", "synth_batch", "list_engines", "list_voices",
    "list_all_voices_grouped", "reload_http_config", "cache_info", "clear_cache",
    "warmup", "url_for", "set_ffmpeg", "set_ffmpeg_search", "ffmpeg_available",
    "registry",
]
