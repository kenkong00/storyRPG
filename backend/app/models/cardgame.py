# -*- coding: utf-8 -*-
"""卡牌对决系统 · 数据模型

设计取舍
--------
1. 卡牌的所有可调参数都落成独立列（费用 / 伤害 / 段数 / 额外暴击 / 破甲 / 回血 …），
   而不是塞一个 effects JSON：后台要能按列筛选、排序、批量改，也方便以后加新参数。
   真正「一次性特例」（例如某张新卡的特殊脚本）走 extra_json。
2. 职业把「面板 + 衣着提示词」放在一起：卡面生图按 职业 → 性别 → 衣着 → 动作/表情 拼，
   所以衣着模板必须和职业同表，改一处立刻影响这个职业全部卡面。
3. 情感、对话规则都是可编辑表：规则命中后由服务端决定说哪句，前端只负责演。
4. 卡面图单独一张表（card_arts）：同一张卡可以按职业/性别/角色生成多版，选一版启用。
"""

from datetime import datetime

from sqlalchemy import Integer, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class CardClass(Base):
    """职业：面板数值 + 卡面画风 / 男女衣着模板。"""

    __tablename__ = "card_classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    hero_name: Mapped[str] = mapped_column(String(60), default="")
    icon: Mapped[str] = mapped_column(String(16), default="")
    hp: Mapped[int] = mapped_column(Integer, default=25)
    defense: Mapped[int] = mapped_column(Integer, default=2)
    spd: Mapped[int] = mapped_column(Integer, default=3)
    cri: Mapped[int] = mapped_column(Integer, default=15)
    role: Mapped[str] = mapped_column(Text, default="")
    counters: Mapped[str] = mapped_column(Text, default="")
    nemesis: Mapped[str] = mapped_column(Text, default="")
    lore: Mapped[str] = mapped_column(Text, default="")
    quote: Mapped[str] = mapped_column(Text, default="")

    # ---- 卡面生图 ----
    # art_style：这个职业的整体画风（会拼在提示词最前面）
    art_style: Mapped[str] = mapped_column(Text, default="")
    # outfit_male / outfit_female：按性别给衣着，用户要求「根据职业 + 男女生成衣着」
    outfit_male: Mapped[str] = mapped_column(Text, default="")
    outfit_female: Mapped[str] = mapped_column(Text, default="")
    # 兜底衣着（性别未知时）
    outfit_other: Mapped[str] = mapped_column(Text, default="")
    # 职业英雄的完整外观（与「人物外观拼装」同一套维度定义）：
    # 发型 / 发色 / 瞳色 / 肤色 / 体型 / 衣着 / 取景 / 自定义追加词，全部可自由增删改。
    # 非空时卡面拼装走「外观维度」路线；留空回落 outfit_* 等旧字段。
    appearance_json: Mapped[str] = mapped_column(Text, default="")

    # 默认卡组（30 张 = 通用 18 + 专属 12），JSON: {"card_code": count}
    default_deck: Mapped[str] = mapped_column(Text, default="{}")

    sort: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardDef(Base):
    """卡牌定义：规则参数一个不少。"""

    __tablename__ = "card_defs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    class_code: Mapped[str] = mapped_column(String(32), default="universal", index=True)
    class_label: Mapped[str] = mapped_column(String(40), default="通用")
    category: Mapped[str] = mapped_column(String(20), default="attack")  # attack / guard / special / skill
    category_label: Mapped[str] = mapped_column(String(40), default="")
    cost: Mapped[int] = mapped_column(Integer, default=1)

    # ---- 数值参数 ----
    value: Mapped[int] = mapped_column(Integer, default=0)          # 伤害 / 护甲 / 守卫血量 / 回血量
    hits: Mapped[int] = mapped_column(Integer, default=1)           # 分几段（连射 = 2）
    bonus_crit: Mapped[int] = mapped_column(Integer, default=0)     # 本次额外暴击率
    crit_bonus_flat: Mapped[int] = mapped_column(Integer, default=0)  # 暴击后追加伤害
    extra_def: Mapped[int] = mapped_column(Integer, default=0)      # 攻击后附加护甲
    heal_val: Mapped[int] = mapped_column(Integer, default=0)       # 额外回血
    half_def_pierce: Mapped[int] = mapped_column(Integer, default=0)  # 1 = 无视一半 DEF
    atk_debuff: Mapped[int] = mapped_column(Integer, default=0)     # 给对手挂「下一张攻击 -N」
    draw_count: Mapped[int] = mapped_column(Integer, default=0)     # 打出后抽牌
    needs_target: Mapped[int] = mapped_column(Integer, default=0)
    max_copies: Mapped[int] = mapped_column(Integer, default=3)     # 同名最多带几张
    # 一次性/特殊卡：交给引擎里的专用分支识别（clear / steal_copy / mind_take / mana_penalty / def_down / spd_down / dodge / cleanse）
    script: Mapped[str] = mapped_column(String(40), default="")

    desc: Mapped[str] = mapped_column(Text, default="")
    rules_detail: Mapped[str] = mapped_column(Text, default="[]")   # JSON 数组：逐条规则解释
    lore: Mapped[str] = mapped_column(Text, default="")
    quote: Mapped[str] = mapped_column(Text, default="")

    # ---- 卡面生图 ----
    art_action: Mapped[str] = mapped_column(Text, default="")       # 卡面动作（如「挥盾猛撞」）
    art_expression: Mapped[str] = mapped_column(Text, default="")   # 卡面表情
    art_extra: Mapped[str] = mapped_column(Text, default="")        # 额外提示词
    image_url: Mapped[str] = mapped_column(String(500), default="")  # 启用的卡面
    art_status: Mapped[str] = mapped_column(String(20), default="none")  # none / running / done / failed

    sort: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardEmotion(Base):
    """战斗情感（表情）：名称 / 台词 / 互斥的回应情感。"""

    __tablename__ = "card_emotions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    tag: Mapped[str] = mapped_column(String(40), default="")
    # 兼容旧字段：不再作为 UI 主体，只在后台标注里可见
    emoji: Mapped[str] = mapped_column(String(16), default="")
    # 颜色：CSS 颜色值（边框 + 主色），UI 用渐变与描边，不再用 emoji 卡
    color: Mapped[str] = mapped_column(String(20), default="#d4af37")
    accent: Mapped[str] = mapped_column(String(20), default="#f5f0e8")
    player_line: Mapped[str] = mapped_column(Text, default="")
    ai_line: Mapped[str] = mapped_column(Text, default="")
    reply_codes: Mapped[str] = mapped_column(Text, default="[]")   # JSON 数组：被回应时可选的情感
    image_url: Mapped[str] = mapped_column(String(500), default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[int] = mapped_column(Integer, default=1)


class CardDialogue(Base):
    """战斗对话规则：什么时候、谁说、说什么。

    trigger 取值见 services/card_dialogue.py 的 TRIGGERS。
    side: self（触发方自己说）/ enemy（对手说）/ any
    text 为空 = 用该情感在当前阵营的默认台词（CardEmotion.player_line / ai_line）。
    """

    __tablename__ = "card_dialogues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trigger: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(10), default="enemy")
    emotion_code: Mapped[str] = mapped_column(String(40), default="emo_confident")
    text: Mapped[str] = mapped_column(Text, default="")
    weight: Mapped[int] = mapped_column(Integer, default=10)
    cooldown_rounds: Mapped[int] = mapped_column(Integer, default=2)  # 同一规则几回合内不重复
    once_per_battle: Mapped[int] = mapped_column(Integer, default=0)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[str] = mapped_column(Text, default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)


class CardLoadout(Base):
    """角色卡组：把「人物管理」里的角色绑定职业 + 30 张卡组。"""

    __tablename__ = "card_loadouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, ForeignKey("characters.id"), index=True, nullable=False)
    class_code: Mapped[str] = mapped_column(String(32), default="warrior")
    deck: Mapped[str] = mapped_column(Text, default="{}")   # JSON: {"card_code": count}
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardBattle(Base):
    """一局卡牌对决（服务端权威，state 存完整快照，刷新可续）。"""

    __tablename__ = "card_battles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    story_node_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("story_nodes.id"))
    user_character_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user_characters.id"))
    player_character_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"))
    enemy_character_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active / player_won / enemy_won / fled
    round: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(Text, default="{}")
    log: Mapped[str] = mapped_column(Text, default="[]")
    source: Mapped[str] = mapped_column(String(20), default="story")  # story / demo
    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    ended_at: Mapped[str | None] = mapped_column(String(30))


class CardArtSet(Base):
    """卡面套装：一套衣服 / 一套画风 = 一整套卡面。

    为什么必须有这张表
    ------------------
    原来的机制是「同卡多版本，is_active 那版写回 card_defs.image_url」。
    这等于：新图一出来就把旧图顶掉，想换回来只能一张张点，30 张卡根本没法整副换。
    用户要的是「A 套装玩腻了换 B 套装，随时切回来，还能再生成 C 套装」。

    所以套装做成一层「分组」：
      · card_arts.set_code 标明这张图属于哪一套；
      · 激活某套时，把该套在每张卡上的最新有图版本一次性写回 card_defs.image_url；
      · 别的套装的图原样留在库里，切回去就是原样那 30 张，互不覆盖。

    出图还能覆盖画风与衣着：B 套装想换一身白衣，只改这张表的字段就行，
    不用去动职业（职业衣着是 A 套装也在用的）。
    """

    __tablename__ = "card_art_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="")

    # 出图覆盖（留空 = 沿用职业上的设定）
    art_style: Mapped[str] = mapped_column(Text, default="")
    outfit_male: Mapped[str] = mapped_column(Text, default="")
    outfit_female: Mapped[str] = mapped_column(Text, default="")
    outfit_other: Mapped[str] = mapped_column(Text, default="")

    is_active: Mapped[int] = mapped_column(Integer, default=0)  # 全局只该有一套为 1
    sort: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(30), default=_now)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardArt(Base):
    """卡面图版本：同卡可多版并存，is_active 的那版写回 card_defs.image_url。"""

    __tablename__ = "card_arts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_code: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    class_code: Mapped[str] = mapped_column(String(32), default="universal")
    # 属于哪一套卡面（CardArtSet.code）。老数据一律归到 default。
    set_code: Mapped[str] = mapped_column(String(48), default="default", index=True)
    gender: Mapped[str] = mapped_column(String(10), default="female")
    character_id: Mapped[int | None] = mapped_column(Integer)
    prompt: Mapped[str] = mapped_column(Text, default="")
    negative: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    width: Mapped[int] = mapped_column(Integer, default=512)
    height: Mapped[int] = mapped_column(Integer, default=768)
    model_preset: Mapped[str] = mapped_column(String(80), default="")
    job_id: Mapped[str] = mapped_column(String(40), default="")
    is_active: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardSetting(Base):
    """卡牌系统键值设置（卡面生图全局模板 / 默认模型 / 尺寸 …）。"""

    __tablename__ = "card_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardCharacterEmotion(Base):
    """某个角色的「情感表现」：同一个「怒火」，黄蓉和牛头人的图与台词不该一样。

    一行 = 一个角色 × 一种情感。没配的角色就走卡牌情感表里的通用台词，
    所以这张表只存「个性化覆盖」，不需要给 20 种情感 × N 个角色全部铺满。
    """

    __tablename__ = "card_character_emotions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    emotion_code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), default="")
    line: Mapped[str] = mapped_column(Text, default="")            # 覆盖通用台词
    action_prompt: Mapped[str] = mapped_column(Text, default="")    # 出图用：动作
    expression_prompt: Mapped[str] = mapped_column(Text, default="")  # 出图用：神情
    prefix_prompt: Mapped[str] = mapped_column(Text, default="")      # 拼在整段提示词最前面
    suffix_prompt: Mapped[str] = mapped_column(Text, default="")      # 拼在整段提示词最后面
    # 独立提示词：非空 = 出图就用这段原文，不再走「卡牌模板 / 提示词与设置」那一套拼装。
    # 情感与表现页的提示词框写的就是这里（选哪套外观配置，就把那套外观的提示词填进来）。
    prompt_text: Mapped[str] = mapped_column(Text, default="")
    appearance_id: Mapped[int] = mapped_column(Integer, default=0)    # 用哪套角色外观配置出图（0=默认）
    note: Mapped[str] = mapped_column(Text, default="")             # 给策划看的备注
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    job_id: Mapped[str] = mapped_column(String(40), default="")
    voice_url: Mapped[str] = mapped_column(String(500), default="")   # 这条情感台词生成好的语音（空=未生成）
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class CardCharacterProfile(Base):
    """「卡牌角色」：某个人物在卡面里长什么样、穿什么、旁边加什么话。

    和「外观配置」的分工：
      外观配置 = 人物的发型/发色/瞳色/肤色/体型/取景（立绘、动作表情、场景都用它）
      卡牌角色 = 卡面专用的那层覆盖（画风、衣着、前置/后置），只影响卡牌生图

    一行 = 一个人物。不填的字段一律回落职业/套装/外观配置，所以「不配也能出图」。
    """

    __tablename__ = "card_character_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(Integer, index=True, unique=True, nullable=False)
    appearance_id: Mapped[int] = mapped_column(Integer, default=0)   # 卡面用哪套外观配置（0=默认外观）
    # 卡牌角色自己的完整外观（与「人物外观拼装」同一套维度定义）。
    # 优先级：卡牌角色外观 > 外观配置（appearance_id）> 人物默认外观 > 职业英雄外观。
    # 空串 = 不单独配，直接回落下面的旧链路。
    appearance_json: Mapped[str] = mapped_column(Text, default="")
    style_override: Mapped[str] = mapped_column(Text, default="")     # 覆盖职业画风
    outfit_male: Mapped[str] = mapped_column(Text, default="")        # 覆盖男装
    outfit_female: Mapped[str] = mapped_column(Text, default="")      # 覆盖女装
    outfit_other: Mapped[str] = mapped_column(Text, default="")       # 覆盖未知性别着装
    prefix_prompt: Mapped[str] = mapped_column(Text, default="")      # 拼在卡面提示词最前面
    suffix_prompt: Mapped[str] = mapped_column(Text, default="")      # 拼在卡面提示词最后面
    note: Mapped[str] = mapped_column(Text, default="")
    # 卡牌语音：卡牌角色可单独绑定音色（覆盖「声音管理 > 角色语音配置」的人物默认配置）。
    tts_engine: Mapped[str] = mapped_column(String(30), default="")     # 空 = 用人物默认
    tts_voice_id: Mapped[str] = mapped_column(String(100), default="")  # 音色 id（空 = 用人物默认）
    tts_rate: Mapped[str] = mapped_column(String(10), default="")
    tts_pitch: Mapped[str] = mapped_column(String(10), default="")
    tts_volume: Mapped[str] = mapped_column(String(10), default="")
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[str] = mapped_column(String(30), default=_now)


