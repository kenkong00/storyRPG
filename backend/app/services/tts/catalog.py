"""音色中文目录 + 角色声线派生表。

为什么需要这个文件：
1. Edge TTS 返回的音色 ID 是 zh-CN-XiaoxiaoNeural 这类英文串，后台下拉直接显示会看不懂。
2. 最关键的是——原信息聚合网站的 VOICE_LABELS 里只有一个简短备注，没有把性别当作
   一等公民。这里把性别、风格、适用角色类型都显式标注出来，后台才能按男女筛选、
   也才能在角色性别配错时给出提示。
3. 官方音色里**没有老人**。实测（2026-09-30）中文一共只有 14 个音色，年龄维度
   只有一个童声（云夏）。要给「村口老丈门房大爷」配音，只能靠 rate/pitch 派生，
   这就是 ROLE_VOICES 存在的原因 —— 见文件下半部分的实测说明。

新增引擎时，如果这个引擎的音色 ID 不稳定（比如本地大模型可以随时换参考音色），
可以让 Provider 自己返回完整 Voice，不必登记到这里。
"""
from __future__ import annotations

from .base import (
    Voice,
    GENDER_FEMALE,
    GENDER_MALE,
    AGE_ADULT,
    AGE_CHILD,
    AGE_ELDER,
    GROUP_DIALECT,
    GROUP_MULTILINGUAL,
    GROUP_REGIONAL,
    GROUP_ROLE,
    GROUP_STANDARD,
)

# Edge TTS（微软 Edge 的在线合成服务）全部中文音色。
# 实测拉取于 2026-09-30：中文共 14 个（普通话 6 + 方言 2 + 粤语 3 + 台普 3），全部可正常合成。
EDGE_VOICES: dict[str, dict[str, object]] = {
    # ---------- 普通话通用 ----------
    "zh-CN-XiaoxiaoNeural": {
        "name": "晓晓", "gender": GENDER_FEMALE, "style": "温柔",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "沉稳知性，适合御姐、师父、旁白，最百搭的女声",
    },
    "zh-CN-XiaoyiNeural": {
        "name": "晓伊", "gender": GENDER_FEMALE, "style": "活泼",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "灵动明快，适合少女、活泼型角色",
    },
    "zh-CN-YunjianNeural": {
        "name": "云健", "gender": GENDER_MALE, "style": "激情",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "浑厚有力，适合武将、反派BOSS，压低音调后很像老者",
    },
    "zh-CN-YunxiNeural": {
        "name": "云希", "gender": GENDER_MALE, "style": "阳光",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "清朗少年感，适合男主、同伴",
    },
    "zh-CN-YunxiaNeural": {
        "name": "云夏", "gender": GENDER_MALE, "style": "稚气",
        "age": AGE_CHILD, "group": GROUP_STANDARD,
        "note": "官方唯一的童声（男童），适合小男孩、小妖、吉祥物",
    },
    "zh-CN-YunyangNeural": {
        "name": "云扬", "gender": GENDER_MALE, "style": "专业",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "新闻播报腔，适合旁白、长老、说书人",
    },
    # ---------- 方言乡音（Locale 仍是 zh-CN-xxx） ----------
    "zh-CN-liaoning-XiaobeiNeural": {
        "name": "晓北", "gender": GENDER_FEMALE, "style": "幽默",
        "age": AGE_ADULT, "group": GROUP_DIALECT,
        "note": "东北话，适合市井老板娘、憨直喜剧角色",
    },
    "zh-CN-shaanxi-XiaoniNeural": {
        "name": "晓妮", "gender": GENDER_FEMALE, "style": "明亮",
        "age": AGE_ADULT, "group": GROUP_DIALECT,
        "note": "陕西话，适合西北乡土、豪爽角色",
    },
    # ---------- 地区口音 ----------
    "zh-HK-WanLungNeural": {
        "name": "云龙", "gender": GENDER_MALE, "style": "亲和",
        "age": AGE_ADULT, "group": GROUP_REGIONAL,
        "note": "粤语男声，适合港埠商人、南洋角色",
    },
    "zh-HK-HiuGaaiNeural": {
        "name": "晓佳", "gender": GENDER_FEMALE, "style": "亲和",
        "age": AGE_ADULT, "group": GROUP_REGIONAL,
        "note": "粤语女声，适合岭南、港风角色",
    },
    "zh-HK-HiuMaanNeural": {
        "name": "晓曼", "gender": GENDER_FEMALE, "style": "亲和",
        "age": AGE_ADULT, "group": GROUP_REGIONAL,
        "note": "粤语女声，音色较晓佳更柔",
    },
    "zh-TW-YunJheNeural": {
        "name": "云哲", "gender": GENDER_MALE, "style": "亲和",
        "age": AGE_ADULT, "group": GROUP_REGIONAL,
        "note": "台普男声，适合海岛、南洋角色",
    },
    "zh-TW-HsiaoChenNeural": {
        "name": "晓臻", "gender": GENDER_FEMALE, "style": "亲和",
        "age": AGE_ADULT, "group": GROUP_REGIONAL,
        "note": "台普女声，语气偏软",
    },
    "zh-TW-HsiaoYuNeural": {
        "name": "晓雨", "gender": GENDER_FEMALE, "style": "亲和",
        "age": AGE_ADULT, "group": GROUP_REGIONAL,
        "note": "台普女声，音色较明快",
    },
}

# ---------------------------------------------------------------------------
# 多语言音色（英文母语，可读中文）
#
# 为什么把它们算进来：官方中文音色只有 14 个，男女气质各 4 种，选角很快就没得挑。
# 微软的 Multilingual 系列是刻意做成跨语种朗读的，实测读中文能正常成句
# （33 字文本 7.7~9.2 秒，节奏与中文基准音色接近，见 backend/test_probe_multilingual.py）。
#
# 但要如实说明：它们的音色底色是美式英语，读中文可能带一点洋腔。
# 所以单独归到「多语言（读中文）」组，并在备注里提示先试听 ——
# 用不用由用户自己决定，比直接替他排除要好。
# ---------------------------------------------------------------------------
MULTILINGUAL_VOICES: dict[str, dict[str, object]] = {
    "en-US-AvaMultilingualNeural": {
        "name": "艾娃", "gender": GENDER_FEMALE, "style": "细腻",
        "age": AGE_ADULT, "group": GROUP_MULTILINGUAL,
        "note": "多语言音色，中文带洋腔（建议先试听）；情绪表达细腻，适合外族女角色",
    },
    "en-US-EmmaMultilingualNeural": {
        "name": "艾玛", "gender": GENDER_FEMALE, "style": "清脆",
        "age": AGE_ADULT, "group": GROUP_MULTILINGUAL,
        "note": "多语言音色，中文带洋腔（建议先试听）；语气轻快，适合活泼外族少女",
    },
    "en-US-AndrewMultilingualNeural": {
        "name": "安德鲁", "gender": GENDER_MALE, "style": "沉稳",
        "age": AGE_ADULT, "group": GROUP_MULTILINGUAL,
        "note": "多语言音色，中文带洋腔（建议先试听）；嗓音温暖可信，适合外族骑士、使节",
    },
    "en-US-BrianMultilingualNeural": {
        "name": "布莱恩", "gender": GENDER_MALE, "style": "随和",
        "age": AGE_ADULT, "group": GROUP_MULTILINGUAL,
        "note": "多语言音色，中文带洋腔（建议先试听）；语气随意，适合旅人、商贩",
    },
}

# 这些 ID 是「允许进入音色列表」的例外白名单：
# 音色列表默认只收 Locale 以 zh 开头的，英文 Locale 的多语言音色必须显式列出，
# 否则会把 322 个非中文音色全放进来。
MULTILINGUAL_IDS = frozenset(MULTILINGUAL_VOICES)


def edge_meta(voice_id: str) -> dict[str, object]:
    """取 Edge 音色的中文元数据（含多语言音色）。"""
    return EDGE_VOICES.get(voice_id) or MULTILINGUAL_VOICES.get(voice_id) or {}


# ---------------------------------------------------------------------------
# 角色声线（派生音色）
#
# 背景：用户要「老人、小孩」这类角色音，但 Edge 官方中文音色里根本没有老人，
# 童声也只有一个男童。硬凑是凑不出来的。
#
# 实测结论（2026-09-30，脚本 backend/test_probe_pitch.py，自相关法估基频）：
#     pitch=-50Hz -> F0 124.0Hz      过零率 0.0481
#     pitch=  0Hz -> F0 153.1Hz      过零率 0.0718
#     pitch=+50Hz -> F0 216.8Hz      过零率 0.0906
#   也就是说 pitch 在 ±50Hz 内确实连续生效（最高/最低相差 1.75 倍），
#   配合 rate 的快慢，足以把同一个基础音色塑造成老者或稚童。
#
# 所以这里的做法不是「新增音色」，而是「在已有音色上叠加语气参数」，
# 得到一批可以直接选的角色声线。它们不额外消耗网络请求，缓存逻辑完全复用。
# ---------------------------------------------------------------------------
ROLE_VOICES: dict[str, dict[str, object]] = {
    # ---------- 老年 ----------
    "elder_m": {
        "name": "苍老长者", "gender": GENDER_MALE, "age": AGE_ELDER,
        "base": "zh-CN-YunjianNeural", "rate": -20, "pitch": -32,
        "style": "沧桑", "note": "语速慢、嗓音沉，适合村中老丈、门房大爷、隐世高人",
    },
    "elder_m_wise": {
        "name": "老学究", "gender": GENDER_MALE, "age": AGE_ELDER,
        "base": "zh-CN-YunyangNeural", "rate": -14, "pitch": -22,
        "style": "迂缓", "note": "播报腔压低，适合宗门长老、藏书阁管理者",
    },
    "elder_f": {
        "name": "慈祥老妪", "gender": GENDER_FEMALE, "age": AGE_ELDER,
        "base": "zh-CN-XiaoxiaoNeural", "rate": -18, "pitch": -26,
        "style": "慈祥", "note": "语速慢、嗓音低，适合外婆、巫婆、药店老板娘",
    },
    # ---------- 儿童 ----------
    "child_m": {
        "name": "稚气男童", "gender": GENDER_MALE, "age": AGE_CHILD,
        "base": "zh-CN-YunxiaNeural", "rate": 8, "pitch": 38,
        "style": "稚嫩", "note": "在官方童声上再提亮，适合五到十岁小男孩",
    },
    "child_f": {
        "name": "稚气女童", "gender": GENDER_FEMALE, "age": AGE_CHILD,
        "base": "zh-CN-XiaoyiNeural", "rate": 10, "pitch": 42,
        "style": "稚嫩", "note": "活泼女声提亮，适合小女孩、小妖精",
    },
    # ---------- 气质原型 ----------
    "solemn_m": {
        "name": "威严君王", "gender": GENDER_MALE, "age": AGE_ADULT,
        "base": "zh-CN-YunjianNeural", "rate": -12, "pitch": -12,
        "style": "威严", "note": "厚重压迫，适合帝王、城主、军队统领",
    },
    "grim_m": {
        "name": "阴沉邪佞", "gender": GENDER_MALE, "age": AGE_ADULT,
        "base": "zh-CN-YunxiNeural", "rate": -8, "pitch": -18,
        "style": "阴冷", "note": "少年声压暗，适合反派谋士、妖异角色",
    },
    "brisk_m": {
        "name": "急报密探", "gender": GENDER_MALE, "age": AGE_ADULT,
        "base": "zh-CN-YunxiNeural", "rate": 30, "pitch": 10,
        "style": "急促", "note": "语速快，适合报信、慌张、市井小贩",
    },
    "narrator_m": {
        "name": "说书先生", "gender": GENDER_MALE, "age": AGE_ADULT,
        "base": "zh-CN-YunyangNeural", "rate": -6, "pitch": -6,
        "style": "沉稳", "note": "旁白专用，讲故事、任务描述、系统提示",
    },
    "cold_f": {
        "name": "冷艳高傲", "gender": GENDER_FEMALE, "age": AGE_ADULT,
        "base": "zh-CN-XiaoxiaoNeural", "rate": -6, "pitch": -6,
        "style": "冷峻", "note": "知性压低，适合冰山美人、女将军、掌门",
    },
    "gentle_f": {
        "name": "温婉淑女", "gender": GENDER_FEMALE, "age": AGE_ADULT,
        "base": "zh-CN-XiaoxiaoNeural", "rate": -8, "pitch": 8,
        "style": "温婉", "note": "柔声慢语，适合大家闺秀、医者、温柔型女主",
    },
    "brisk_f": {
        "name": "俏皮少女", "gender": GENDER_FEMALE, "age": AGE_ADULT,
        "base": "zh-CN-XiaoyiNeural", "rate": 20, "pitch": 16,
        "style": "俏皮", "note": "又快又亮，适合刁蛮千金、活泼同伴",
    },
    "narrator_f": {
        "name": "沉稳女旁白", "gender": GENDER_FEMALE, "age": AGE_ADULT,
        "base": "zh-CN-XiaoxiaoNeural", "rate": -3, "pitch": -4,
        "style": "沉稳", "note": "女声旁白，适合绘本式叙事、回忆段落",
    },
}

# Windows 本机 OneCore / WinRT 语音（完全离线，无需联网）
ONECORE_VOICES: dict[str, dict[str, object]] = {
    "Microsoft Huihui": {
        "name": "慧慧", "gender": GENDER_FEMALE, "style": "沉稳",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "本机默认女声，稳定可靠",
    },
    "Microsoft Yaoyao": {
        "name": "瑶瑶", "gender": GENDER_FEMALE, "style": "清亮",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "音色较年轻的本机女声",
    },
    "Microsoft Kangkang": {
        "name": "康康", "gender": GENDER_MALE, "style": "浑厚",
        "age": AGE_ADULT, "group": GROUP_STANDARD,
        "note": "本机唯一的中文男声，断网兜底全靠它",
    },
}


def build_voice(voice_id: str, meta: dict[str, object], lang: str, engine: str) -> Voice:
    return Voice(
        voice_id=voice_id,
        name=str(meta.get("name", voice_id)),
        gender=str(meta.get("gender", "unknown")),
        lang=lang,
        style=str(meta.get("style", "")),
        note=str(meta.get("note", "")),
        engine=engine,
        age=str(meta.get("age", AGE_ADULT)),
        group=str(meta.get("group", GROUP_STANDARD)),
    )


def annotate(voice_id: str, meta: dict[str, object], lang: str, engine: str) -> Voice:
    """用目录里的元信息包装一个音色；目录里没有的按原名返回。"""
    known = (edge_meta(voice_id) if engine == "edge" else None)
    known = known or ONECORE_VOICES.get(voice_id) or meta
    return build_voice(voice_id, known, lang, engine)


# ---------------------------------------------------------------------------
# 派生声线的解析
# ---------------------------------------------------------------------------

DERIVED_SEP = "#"


def split_voice_id(voice_id: str) -> tuple[str, str]:
    """拆成 (基础音色ID, 声线key)。原生音色返回 (自身, "")。

    编码形式是 "zh-CN-YunjianNeural#elder_m" —— 前半段保留真实基础音色，
    好处是：就算将来 ROLE_VOICES 里删了某个声线，旧数据里存的 ID 前半段
    依然是一个合法音色，不会合成失败，最坏只是退回原声。
    """
    if not voice_id or DERIVED_SEP not in voice_id:
        return voice_id or "", ""
    base, _, key = voice_id.partition(DERIVED_SEP)
    return base, key


def make_derived_id(base_voice: str, role_key: str) -> str:
    return f"{base_voice}{DERIVED_SEP}{role_key}"


def get_role(role_key: str) -> dict[str, object] | None:
    return ROLE_VOICES.get(role_key) if role_key else None


def resolve_voice(voice_id: str, engine: str = "edge") -> tuple[str, dict[str, object] | None]:
    """把 voice_id 解析成 (真正的基础音色ID, 声线定义或None)。

    声线表里自带 base，理论上与 ID 前半段一致；若不一致（比如用户手改过配置），
    以声线表为准，保证听感符合声线名。
    """
    base, key = split_voice_id(voice_id)
    role = get_role(key)
    if role:
        return str(role.get("base") or base or ""), role
    return base, None


def effective_params(voice_id: str, rate: int, pitch: int) -> tuple[str, int, int]:
    """把角色自己设的 rate/pitch 与声线的偏移叠加，得到最终参数。

    叠加而非覆盖：角色页的滑杆仍然可用来微调「这位老者再慢一点」。
    clamp 到合法区间，避免叠加后越界导致引擎报错。
    """
    base, role = resolve_voice(voice_id)
    if not role:
        return base, _clamp(rate, -90, 100), _clamp(pitch, -100, 100)
    return (
        base,
        _clamp(int(rate or 0) + int(role.get("rate") or 0), -90, 100),
        _clamp(int(pitch or 0) + int(role.get("pitch") or 0), -100, 100),
    )


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(v or 0)))


def build_role_voices(engine: str = "edge",
                      base_voices: dict[str, Voice] | None = None,
                      base_by_gender: dict[str, str] | None = None) -> list[Voice]:
    """生成派生声线列表。两种指定基础音色的方式，二选一：

    - base_voices：按 ID 校验。声线自带的基础音色在这个引擎里不存在就跳过
      （比如 Edge 的「云健」在只有 3 个音色的本机引擎里就没有）。
    - base_by_gender：按性别重映射。本机引擎用这个 —— 它没有 Edge 的音色，
      但只要「男声用康康、女声用慧慧」，同一批老人/小孩声线照样能派生出来。
      断网兜底时角色不至于从「苍老长者」退回普通男声。
    """
    out: list[Voice] = []
    for key, meta in ROLE_VOICES.items():
        base = str(meta.get("base") or "")
        if base_by_gender is not None:
            remapped = base_by_gender.get(str(meta.get("gender", "")))
            if not remapped:
                continue      # 本引擎没有这个性别的音色，派生不出
            base = remapped
        elif base_voices is not None and base and base not in base_voices:
            continue          # 该引擎没有这个基础音色，就不展示这条派生声线
        known = base_voices.get(base) if base_voices else None
        out.append(Voice(
            voice_id=make_derived_id(base, key),
            name=str(meta.get("name", key)),
            gender=str(meta.get("gender", "unknown")),
            lang=known.lang if known else "zh-CN",
            style=str(meta.get("style", "")),
            note=str(meta.get("note", "")),
            engine=engine,
            age=str(meta.get("age", AGE_ADULT)),
            group=GROUP_ROLE,
            derived=True,
            rate=int(meta.get("rate") or 0),
            pitch=int(meta.get("pitch") or 0),
        ))
    return out


def default_voice_for(gender: str, engine: str = "edge", age: str = "") -> str:
    """给一个性别（可选年龄）推荐默认音色。后台新建角色时可以据此预填。

    选默认的原则：优先听感最中性、最不容易出戏的那一个。
    指定了年龄时优先命中同龄声线，因为「老人用少年音」比「男女不分」更出戏。
    """
    if engine == "onecore":
        return "Microsoft Kangkang" if gender == GENDER_MALE else "Microsoft Huihui"
    # 先按年龄找派生声线
    if age:
        for key, meta in ROLE_VOICES.items():
            if meta.get("age") == age and meta.get("gender") == gender:
                return make_derived_id(str(meta.get("base") or ""), key)
    if gender == GENDER_MALE:
        return "zh-CN-YunxiNeural"     # 云希：男主型的清朗少年声
    return "zh-CN-XiaoxiaoNeural"       # 晓晓：沉稳知性，最百搭
