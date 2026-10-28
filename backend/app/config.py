import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATABASE_URL = f"sqlite:///{os.path.join(DATA_DIR, 'rpg_game.db')}"

# ===== 语音（TTS）相关配置 =====
# 合成好的音频统一落盘缓存，按 md5(text+engine+voice+rate+pitch) 命名。
# 同一句话第二次播放就是本地静态文件，零延迟——这是「不磕绊」的地基。
TTS_CACHE_DIR = os.path.join(DATA_DIR, "tts-cache")
# 外部 HTTP 语音引擎（语音大模型 API / 本地 TTS 服务）的配置文件
TTS_CONFIG_PATH = os.path.join(DATA_DIR, "tts_config.json")

# 缓存上限：超出后按最久未访问淘汰，防止磁盘被吃满
TTS_MAX_CACHE_FILES = 6000
TTS_MAX_CACHE_BYTES = 1024 * 1024 * 1024  # 1GB

# 确保 data 目录存在
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(TTS_CACHE_DIR, exist_ok=True)
