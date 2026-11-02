# -*- coding: utf-8 -*-
"""卡牌系统种子数据。

卡牌规则文本 / 世界观 / 引言直接来自原版 30 张卡牌对决（card_data.json，脚本从游戏
源码原样导出，未做删改）；这里额外补三样原版没有、但本项目需要的东西：

1. 每张卡的「卡面动作 / 卡面表情」——卡面生图靠它拼提示词；
2. 每张卡的「引擎脚本标识」——把 41 张卡的效果收敛到十几个可复用分支；
3. 每个职业的「画风 / 男女衣着」——同职业所有卡共用，改一处全职业生效。

幂等：已存在的记录不会被覆盖（后台改过的参数不会被重启重置）。
"""

from __future__ import annotations

import json
import os

from sqlalchemy.orm import Session

from ..models.cardgame import (
    CardClass, CardDef, CardEmotion, CardDialogue, CardLoadout, CardSetting,
)

DATA_PATH = os.path.join(os.path.dirname(__file__), "card_data.json")

with open(DATA_PATH, "r", encoding="utf-8") as _f:
    _RAW = json.load(_f)


# ==========================================================================
# 引擎脚本：把 41 张卡的效果映射到可复用分支
#   ""                     普通攻击 / 按数值结算
#   buff_def               只加 DEF（value）
#   buff_def_draw          加 DEF + 抽 1
#   def_heal               加 DEF（value）+ 回血（heal_val）
#   heal                   回血（value）
#   heal_def               回血（value）+ 加 DEF（extra_def）
#   draw2                  抽 2 张
#   clear_guards           清空对方守卫（每回合限 1）
#   pierce_hero            无视守卫打英雄
#   attack_heal_if_def     攻击后若自身有效 DEF >= 3，回 2 血
#   cleanse                清除自身持续负面 + 抽 1
#   mana_penalty           对手下回合法力 -1
#   def_down               对手 DEF -2（到其下回合结束）
#   spd_down               对手 SPD -2（到其下回合结束）
#   steal_copy             复制对手随机 1 张手牌（每回合 1 次）
#   mind_take              夺走对手随机 1 张手牌（本回合锁定）
#   dodge                  本回合受击 -3
# ==========================================================================
CARD_SCRIPTS = {
    "spc_draw": "draw2",
    "spc_pierce": "pierce_hero",
    "spc_clear": "clear_guards",
    "war_taunt": "buff_def",
    "war_bash": "",                      # 攻击 + extra_def 2
    "war_cry": "buff_def_draw",
    "war_sunder": "",                    # 攻击 + half_def_pierce
    "war_fortify": "def_heal",
    "pal_bless": "buff_def",
    "pal_slash": "attack_heal_if_def",
    "pal_purify": "cleanse",
    "pal_shield": "buff_def",
    "pal_judge": "",
    "pal_revive": "heal_def",
    "mag_missile": "",
    "mag_shield": "buff_def",
    "mag_heal": "heal",
    "mag_fireball": "",
    "mag_inferno": "",
    "mes_spike": "",                     # 攻击 + atk_debuff 1
    "mes_whisper": "mana_penalty",
    "mes_weaken": "def_down",
    "mes_steal_copy": "steal_copy",
    "mes_slow": "spd_down",
    "mes_mindtake": "mind_take",
    "rng_quick": "",
    "rng_aim": "",
    "rng_trip": "spd_down",
    "rng_double": "",
    "rng_pierce": "",
    "asn_stab": "",
    "asn_dodge": "dodge",
    "asn_ambush": "",
    "asn_combo": "",
    "asn_execute": "",
}

# 卡面动作 / 表情（中文提示词片段，Moss 的文本编码器是 Qwen，中文更准）
CARD_ART = {
    "atk_1": ("单手直剑向前平刺，重心压低，衣角被风带起", "眼神冷静，嘴唇微抿"),
    "atk_2": ("双手握剑高举过顶向下猛劈，肩背绷紧", "眉头压低，咬牙发狠"),
    "atk_3": ("长剑横扫出巨大弧线，身体随剑势旋转", "怒目圆睁，张口怒吼"),
    "grd_1": ("单膝跪地举盾护住身前，盾面朝外", "神情坚毅，沉默"),
    "grd_2": ("双臂把巨型塔盾砸进地面，尘土飞扬", "面无表情，眼神沉稳"),
    "grd_3": ("双手撑起一面巨大的符文石盾，盾前光纹流转", "神色庄重，目光坚定"),
    "spc_draw": ("侧身抬手，指间夹着展开的卷轴与卡牌", "眼含笑意，神情从容"),
    "spc_pierce": ("抬手射出一道穿透光刃，指尖残留光屑", "眼神锐利，嘴角上扬"),
    "spc_clear": ("双手合拢引爆一团震荡光球，冲击波扩散", "神情疯狂，仰头大笑"),

    "war_taunt": ("以剑脊重拍胸甲，另一手持盾前压", "张口咆哮，眉骨压出阴影"),
    "war_bash": ("盾牌边缘裹着铁刺向前猛撞，身体前冲", "咬紧牙关，双目怒视"),
    "war_cry": ("举起号角仰头长鸣，周身战纹亮起", "闭眼嘶吼，颈侧青筋暴起"),
    "war_sunder": ("阔剑顺着铠甲缝隙自上而下劈落", "眼神冰冷，嘴角紧绷"),
    "war_fortify": ("重剑插入地面双膝微沉，身后浮起岩壁虚影", "神情沉静，目光如铁"),

    "pal_bless": ("单手按在胸前圣徽上，肩甲浮出光羽", "垂眸微笑，神情温柔"),
    "pal_slash": ("长剑划出金色弧光向前斩出，光屑回流", "目光坚定，神情肃穆"),
    "pal_purify": ("双手交叠胸前，白金色钟形光波向外扩散", "闭目吟诵，神色宁静"),
    "pal_shield": ("抬手召唤四面光盾环绕身周", "眉眼舒展，目光明亮"),
    "pal_judge": ("举剑引下金色十字光柱，光柱自天而降", "仰头直视，眼神凌厉"),
    "pal_revive": ("单膝跪地张开双臂，背后浮出六翼光翼", "温柔含笑，眼含泪光"),

    "mag_missile": ("抬指轻弹，三枚紫晶飞弹绕指疾射", "挑眉冷笑，眼神轻蔑"),
    "mag_shield": ("双手在身前编织六棱力场，蓝紫电弧跳动", "神情专注，眼神平静"),
    "mag_heal": ("掌心托起翠绿生命光团贴近胸口", "闭眼微笑，神色放松"),
    "mag_fireball": ("单手托起炽白火球向前掷出，火星飞散", "眼神炽热，嘴角扬起"),
    "mag_inferno": ("双臂张开引动环形熔岩火柱在脚下炸裂", "仰头狂笑，瞳孔映着火光"),

    "mes_spike": ("抬起指尖对准对手眉心，无形波纹刺出", "单眼微眯，笑意冰凉"),
    "mes_whisper": ("手指抵在唇边轻轻吐出一缕紫雾", "垂眼低笑，神情暧昧"),
    "mes_weaken": ("指尖牵引暗紫符文缠向对手铠甲", "嘴角勾起，眼神轻慢"),
    "mes_steal_copy": ("伸手探入虚空的紫水晶镜面取出一张卡牌", "睁大双眼，露出好奇的笑"),
    "mes_slow": ("手掌向下虚按，脚下时间涟漪凝滞", "慵懒微笑，眼皮半垂"),
    "mes_mindtake": ("虚影手掌探入对手胸口抽出一张发光的牌", "眼神贪婪，笑意张扬"),

    "rng_quick": ("反手抽箭搭弦，弓弦仍在震颤", "眼神专注，呼吸平稳"),
    "rng_aim": ("侧身满弓瞄准，箭尖凝出一点青光", "单眼瞄准，眉头微皱"),
    "rng_trip": ("跪姿低射，箭矢钉入地面炸开荆棘藤蔓", "嘴角轻扬，眼神狡黠"),
    "rng_double": ("双指夹两支白羽箭同时开弓", "目光锐利，神情冷静"),
    "rng_pierce": ("拉满巨弓射出螺旋飓风长箭，气旋炸开", "咬牙发力，眼神凶狠"),

    "asn_stab": ("贴身反手短匕刺出，斗篷翻卷", "面无表情，眼神冷寂"),
    "asn_dodge": ("身体化作墨色残影向后错步闪避", "嘴角带笑，眼神轻挑"),
    "asn_ambush": ("从阴影中暴起双刃交叉突袭", "瞳孔收缩，杀意毕露"),
    "asn_combo": ("左手副匕顺着血口再刺，双刃交错", "咬唇冷笑，眼神发亮"),
    "asn_execute": ("妖刀横斩，黑红刀光贯穿画面", "半张脸隐在阴影里，眼神死寂"),
}

# 职业画风 + 男女衣着
CLASS_ART = {
    "warrior": {
        "style": "暗黑奇幻战场插画，厚重钢铁质感，冷灰与铁锈色调，低角度仰拍，尘土与火星飘散",
        "m": "厚重深灰钢制板甲，肩甲带铆钉与划痕，皮革束带斜跨胸口，破损的赭红披风，铁护手与战靴",
        "f": "贴身的深灰鳞甲配护肩，腰侧挂短战裙与皮质束带，赭红短披风，铁护手与及膝战靴",
        "o": "深灰钢制板甲配皮质束带与赭红披风",
    },
    "paladin": {
        "style": "神圣奇幻插画，白金与暖金配色，柔和体积光，圣洁辉光粒子，庄严构图",
        "m": "白金镶边的全身板甲，胸前银色圣徽，白色长披风，金线纹章，护手内侧泛暖光",
        "f": "白银胸甲配长裙摆战裙，肩甲刻羽翼纹，白色披风与金色纹章，腰封收束，及踝战靴",
        "o": "白金镶边板甲配白色披风与圣徽",
    },
    "mage": {
        "style": "奥术奇幻插画，深蓝与紫罗兰色调，星尘与符文漂浮，强对比神秘光，半身特写",
        "m": "深蓝星纹长袍配高领与宽袖，肩披星图披帛，腰间束带挂水晶瓶，指尖有符文微光",
        "f": "深蓝星纹长裙配宽袖与高领，腰间缎带束出腰线，肩披半透星图披帛，长裙曳地",
        "o": "深蓝星纹长袍配披帛与水晶饰物",
    },
    "mesmer": {
        "style": "梦魇奇幻插画，紫黑与品红配色，薄纱与烟雾，扭曲空间感，暧昧逆光",
        "m": "紫黑修身长衣配高立领，肩披薄纱披巾，腰间垂坠珠链，手指缠着紫色丝线",
        "f": "紫黑薄纱长裙配层叠裙摆，面纱半遮，肩颈露出细密银链，腰侧镂空，指尖缠紫线",
        "o": "紫黑薄纱长衣配披巾与银链",
    },
    "ranger": {
        "style": "森林奇幻插画，墨绿与苔藓色调，林间丁达尔光，飘落叶片，动态构图",
        "m": "墨绿轻型皮甲配绑带护臂，斜挎箭袋与短弓，短披肩，深褐长靴与皮质护腿",
        "f": "墨绿皮甲配短披肩与束腰皮带，箭袋斜挎腰后，紧身皮裤与长靴，发间别着羽毛",
        "o": "墨绿轻型皮甲配短披肩与箭袋",
    },
    "assassin": {
        "style": "暗影奇幻插画，黑灰与暗红配色，硬边逆光，烟雾与飞溅血珠，极简背景",
        "m": "黑灰贴身夜行衣配蒙面巾，多层短披，腰间缠着锁链与数把短匕，绑腿与软底靴",
        "f": "黑灰紧身夜行衣配短披与绑腿，面巾遮住下半脸，腰侧皮扣插满细刃，软底短靴",
        "o": "黑灰贴身夜行衣配面巾与短匕",
    },
}

# 情感配色（替代原版 Tailwind 边框色）
EMOTION_COLORS = {
    "emo_anger": "#f43f5e", "emo_laugh": "#fbbf24", "emo_scorn": "#38bdf8",
    "emo_crazy": "#a855f7", "emo_fear": "#22d3ee", "emo_beg": "#34d399",
    "emo_confident": "#fcd34d", "emo_scheming": "#818cf8", "emo_provoke": "#fb923c",
    "emo_shock": "#facc15", "emo_cry": "#60a5fa", "emo_despair": "#94a3b8",
    "emo_lucky": "#fde047", "emo_unlucky": "#64748b", "emo_cold": "#ef4444",
    "emo_salute": "#2dd4bf", "emo_impatient": "#f97316", "emo_innocent": "#f472b6",
    "emo_laststand": "#e11d48", "emo_king": "#fbbf24",
}

# 战斗对话规则（开箱即用；后台可增删改）
# (trigger, side, emotion, text, weight, cooldown_rounds, once_per_battle, note)
DIALOGUE_RULES = [
    ("battle_start", "enemy", "emo_provoke", "「{player_class}？正好，我早就想拆一副新牌了。」", 30, 99, 1, "开局挑衅"),
    ("battle_start", "self", "emo_confident", "「这一局，我算得比你远三步。」", 20, 99, 1, "开局自信"),
    ("battle_start", "enemy", "emo_cold", "「三十张牌，一张都不会浪费在你身上。」", 20, 99, 1, "开局冷酷"),

    ("round_start", "enemy", "emo_impatient", "「第 {round} 回合了，别磨磨蹭蹭。」", 12, 3, 0, "回合开始催促"),
    ("round_start", "self", "emo_scheming", "「节奏在我手里，慢慢来。」", 10, 3, 0, "回合开始算计"),

    ("turn_start", "self", "emo_confident", "「法力回满了，该我了。」", 8, 2, 0, "自己回合开始"),
    ("turn_start", "enemy", "emo_scorn", "「就这点法力，也想翻盘？」", 8, 2, 0, "对手回合开始"),

    ("crit_dealt", "self", "emo_lucky", "「暴击！这就是我等的破绽。」", 26, 1, 0, "自己打出暴击"),
    ("crit_dealt", "enemy", "emo_shock", "「怎么可能…这一击直接打穿了护甲！」", 26, 1, 0, "对手被打出暴击"),
    ("crit_taken", "self", "emo_fear", "「手、手在抖…那一下太重了。」", 22, 1, 0, "自己挨了暴击"),
    ("crit_taken", "enemy", "emo_laugh", "「哈哈，正中要害！」", 22, 1, 0, "对手挨了暴击"),

    ("low_hp", "self", "emo_laststand", "「还剩这点血，就还没到认输的时候。」", 28, 2, 0, "自己血量低于 30%"),
    ("low_hp", "enemy", "emo_beg", "「慢着慢着！这局算你赢一半行不行？」", 24, 2, 0, "对手血量低于 30%"),
    ("lethal_near", "enemy", "emo_fear", "「别、别过来…我手里还有牌！」", 26, 2, 0, "对手血量 <= 5"),
    ("lethal_near", "self", "emo_cold", "「只差最后一击了。屏住呼吸。」", 26, 2, 0, "自己血量 <= 5"),

    ("guard_broken", "enemy", "emo_cry", "「我的守卫！你赔我一面墙！」", 20, 1, 0, "自己守卫被打碎"),
    ("guard_block", "self", "emo_scorn", "「连我的守卫都过不去。」", 18, 2, 0, "护甲全额挡下伤害"),
    ("guard_spawn", "self", "emo_impatient", "「再立一面墙。看你砍到什么时候。」", 10, 3, 0, "召唤守卫"),

    ("heal", "self", "emo_confident", "「伤口愈合了，我们继续。」", 16, 2, 0, "自己回血"),
    ("heal", "enemy", "emo_innocent", "「哎呀，血又回来了，白打了呢。」", 16, 2, 0, "对手回血"),

    ("big_damage_dealt", "self", "emo_crazy", "「看到了吗？这才叫伤害！」", 24, 2, 0, "自己单次伤害 >= 8"),
    ("big_damage_taken", "enemy", "emo_fear", "「这一下…有点超出预算了。」", 24, 2, 0, "自己单次承伤 >= 8"),

    ("mana_denied", "enemy", "emo_anger", "「我的法力呢？谁动了我的法力！」", 26, 2, 0, "自己中降费"),
    ("card_stolen", "enemy", "emo_anger", "「把那张牌还给我！」", 26, 2, 0, "自己被偷牌"),
    ("steal_success", "self", "emo_scheming", "「你藏得最深的那张，现在归我了。」", 24, 2, 0, "自己偷到牌"),

    ("deck_empty", "self", "emo_despair", "「牌库见底了…只能硬撑。」", 20, 99, 1, "自己牌库抽空"),

    ("victory", "self", "emo_king", "「这一局，从头到尾都在我的算路里。」", 40, 99, 1, "获胜"),
    ("defeat", "self", "emo_despair", "「牌面已尽，我认输。」", 40, 99, 1, "落败"),
    ("taunt", "self", "emo_provoke", "「来啊，别光看着。」", 30, 1, 0, "手动挑衅"),
]

SETTINGS = {
    # 卡面提示词模板：{...} 由服务端填充
    "art_template": (
        "{style}\n"
        "【人物】{name}，{gender}{age}{head}\n"
        "【服装】{outfit}\n"
        "【动作】{action}\n"
        "【表情】{expression}\n"
        "【构图】半身像，竖版 2:3，人物居中，头部位于画面上三分之一，"
        "深色渐变背景，边缘金色描边辉光，卡牌插画规格\n"
        "【画质】厚涂笔触，电影级侧逆光，材质与金属高光清晰，细节锐利，"
        "无文字，无水印，无边框"
    ),
    "art_negative": "文字，水印，签名，多个人物，拼接，畸变手指，模糊，低分辨率，边框，UI",
    "art_model_preset": "Moss_int8_5步",
    "art_width": "512",
    "art_height": "768",
    "art_framing": "half",
    "art_auto_apply": "1",
    # 卡牌战斗总开关：出问题可一键退回旧的回合制战斗
    "battle_enabled": "1",
    "battle_demo_class": "assassin",
    "battle_demo_enemy_class": "mesmer",
    # ---- 战斗情感演出的节奏（毫秒）。以前是写死的，一闪而过看不清。 ----
    "emotion_fade_in_ms": "260",
    "emotion_hold_ms": "1600",
    "emotion_fade_out_ms": "320",
    "emotion_backdrop_blur": "3",      # 演出时战场虚化程度（px），0 = 不虚化
    "emotion_show_tag": "1",           # 是否显示情感标签（如「嘴硬」）
}

# 给「人物管理」里已有的角色预置卡组（只在该角色还没有卡组时创建）
DEFAULT_LOADOUTS = [
    (1, "assassin", "小小：高速先手，适合新手快速体验斩杀节奏"),
    (2, "mesmer", "黄蓉：心智控制，压制对手法力与护甲"),
    (3, "warrior", "牛头人：高血高防，站场磨血"),
    (5, "ranger", "韩秋雪：远程连射，减速牵制"),
]


# 机制字段：数值与引擎分支都归这里，改一次版本号即可按源码数据校准一次
SEED_VERSION = "2"
MECHANIC_FIELDS = (
    "cost", "value", "hits", "bonus_crit", "crit_bonus_flat", "extra_def",
    "heal_val", "half_def_pierce", "atk_debuff", "draw_count", "needs_target",
    "max_copies", "script",
)


def _sync_mechanics(db: Session) -> int:
    """按源码数据校准卡牌的机制字段；不动文案、卡面、启用状态。

    只在 SEED_VERSION 变化时跑一次 —— 否则会把后台手改的数值冲掉。
    """
    row = db.query(CardSetting).filter(CardSetting.key == "seed_version").first()
    if row and row.value == str(SEED_VERSION):
        return 0
    changed = 0
    for i, raw in enumerate(_RAW["cards"]):
        card = db.query(CardDef).filter(CardDef.code == raw["id"]).first()
        if not card:
            continue
        payload = _card_payload(raw, i)
        for key in MECHANIC_FIELDS:
            if getattr(card, key) != payload[key]:
                setattr(card, key, payload[key])
                changed += 1
    if row:
        row.value = str(SEED_VERSION)
    else:
        db.add(CardSetting(key="seed_version", value=str(SEED_VERSION)))
    db.commit()
    return changed


def _card_payload(raw: dict, sort: int) -> dict:
    code = raw["id"]
    action, expression = CARD_ART.get(code, ("", ""))
    return {
        "code": code,
        "name": raw["name"],
        "class_code": raw.get("classId") or "universal",
        "class_label": raw.get("classLabel") or "",
        "category": raw.get("category") or "skill",
        "category_label": raw.get("categoryLabel") or "",
        "cost": int(raw.get("cost") or 0),
        "value": int(raw.get("value") or 0),
        "hits": int(raw.get("hits") or 1),
        "bonus_crit": int(raw.get("bonusCrit") or 0),
        "crit_bonus_flat": int(raw.get("critBonusFlat") or 0),
        "extra_def": int(raw.get("extraDef") or 0),
        "heal_val": int(raw.get("healVal") or 0),
        "half_def_pierce": 1 if raw.get("halfDefPierce") else 0,
        "atk_debuff": int(raw.get("atkDebuff") or 0),
        "draw_count": 2 if code == "spc_draw" else (1 if code in ("war_cry", "pal_purify") else 0),
        "needs_target": 1 if raw.get("needsTarget") else 0,
        "max_copies": int(raw.get("maxCopies") or 3),
        "script": CARD_SCRIPTS.get(code, ""),
        "desc": raw.get("desc") or "",
        "rules_detail": json.dumps(raw.get("rulesDetail") or [], ensure_ascii=False),
        "lore": raw.get("story") or "",
        "quote": raw.get("quote") or "",
        "art_action": action,
        "art_expression": expression,
        "sort": sort,
    }


def seed_card_data(db: Session) -> dict:
    """播种（幂等）。返回本次新增数量，便于启动日志。"""
    report = {"classes": 0, "cards": 0, "emotions": 0, "dialogues": 0,
              "settings": 0, "loadouts": 0, "mechanics": 0}

    # ---------- 职业 ----------
    for i, cls in enumerate(_RAW["classes"]):
        code = cls["id"]
        if db.query(CardClass).filter(CardClass.code == code).first():
            continue
        art = CLASS_ART.get(code, {})
        deck = dict(_RAW["universal"])
        deck.update(cls.get("defaultDeck") or {})
        db.add(CardClass(
            code=code,
            name=cls["name"],
            hero_name=cls.get("heroName") or "",
            icon=cls.get("icon") or "",
            hp=int(cls.get("hp") or 25),
            defense=int(cls.get("def") or 2),
            spd=int(cls.get("spd") or 3),
            cri=int(cls.get("cri") or 15),
            role=cls.get("role") or "",
            counters=cls.get("counters") or "",
            nemesis=cls.get("nemesis") or "",
            lore=cls.get("story") or "",
            quote=cls.get("quote") or "",
            art_style=art.get("style") or "",
            outfit_male=art.get("m") or "",
            outfit_female=art.get("f") or "",
            outfit_other=art.get("o") or "",
            default_deck=json.dumps(deck, ensure_ascii=False),
            sort=i,
        ))
        report["classes"] += 1

    # ---------- 卡牌 ----------
    existing_cards = {c.code for c in db.query(CardDef.code).all()}
    for i, raw in enumerate(_RAW["cards"]):
        if raw["id"] in existing_cards:
            continue
        db.add(CardDef(**_card_payload(raw, i)))
        report["cards"] += 1

    # ---------- 情感 ----------
    existing_emo = {e.code for e in db.query(CardEmotion.code).all()}
    for i, emo in enumerate(_RAW["emotions"]):
        if emo["id"] in existing_emo:
            continue
        db.add(CardEmotion(
            code=emo["id"],
            name=emo.get("name") or "",
            tag=emo.get("tag") or "",
            emoji=emo.get("emoji") or "",
            color=EMOTION_COLORS.get(emo["id"], "#d4af37"),
            accent="#f5f0e8",
            player_line=emo.get("playerLine") or "",
            ai_line=emo.get("aiLine") or "",
            reply_codes=json.dumps(emo.get("aiReplyIds") or [], ensure_ascii=False),
            sort=i,
        ))
        report["emotions"] += 1

    # ---------- 对话规则 ----------
    if not db.query(CardDialogue).count():
        for i, (trg, side, emo, text, weight, cd, once, note) in enumerate(DIALOGUE_RULES):
            db.add(CardDialogue(
                trigger=trg, side=side, emotion_code=emo, text=text,
                weight=weight, cooldown_rounds=cd, once_per_battle=once,
                priority=100 - i, note=note, sort=i,
            ))
            report["dialogues"] += 1

    # ---------- 设置 ----------
    exist_keys = {s.key for s in db.query(CardSetting.key).all()}
    for key, value in SETTINGS.items():
        if key in exist_keys:
            continue
        db.add(CardSetting(key=key, value=value))
        report["settings"] += 1

    db.commit()

    # ---------- 角色卡组 ----------
    try:
        from ..models.character import Character
        for cid, class_code, note in DEFAULT_LOADOUTS:
            if not db.query(Character).filter(Character.id == cid).first():
                continue
            if db.query(CardLoadout).filter(CardLoadout.character_id == cid).first():
                continue
            cls = db.query(CardClass).filter(CardClass.code == class_code).first()
            if not cls:
                continue
            db.add(CardLoadout(
                character_id=cid, class_code=class_code,
                deck=cls.default_deck or "{}", note=note,
            ))
            report["loadouts"] += 1
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print("[WARN] 角色卡组播种失败：", exc)

    # ---------- 机制字段校准（按版本号跑一次） ----------
    try:
        report["mechanics"] = _sync_mechanics(db)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print("[WARN] 卡牌机制校准失败：", exc)

    return report


def default_deck_for(db: Session, class_code: str) -> dict:
    cls = db.query(CardClass).filter(CardClass.code == class_code).first()
    if cls and cls.default_deck:
        try:
            return json.loads(cls.default_deck)
        except Exception:
            pass
    return dict(_RAW["universal"])


# ==========================================================================
# 固定模板 / 完整性校验
# ==========================================================================
# 用户的原话：「每次游玩必须有多少张卡牌，应该是要个固定模板的，游戏完整性
# 应该是不能漏卡牌的对吧」。原版规则就是 30 张 = 通用 18 + 职业专属 12，
# 所以模板不让人随便定，只做「校验 + 一键补齐」：
#   少一张 → 牌库抽不满，中期会突然断手牌；
#   多一张 → 抽牌概率被稀释，强度曲线就歪了；
#   带了不存在/超出同名上限的卡 → 开局发牌直接炸。
DECK_SIZE = 30


def reference_deck(class_code: str) -> dict:
    """源码里的标准 30 张：通用 18 + 该职业 12。"""
    deck = {k: int(v) for k, v in _RAW["universal"].items()}
    for raw in _RAW["classes"]:
        if raw.get("id") == class_code:
            for code, cnt in (raw.get("defaultDeck") or {}).items():
                deck[code] = deck.get(code, 0) + int(cnt)
            break
    return deck


def _deck_issues(db: Session, deck: dict) -> list:
    """返回这一副牌的问题列表（空 = 合规）。"""
    issues = []
    total = 0
    for code, cnt in (deck or {}).items():
        card = db.query(CardDef).filter(CardDef.code == code).first()
        try:
            n = int(cnt)
        except Exception:
            issues.append(f"{code} 张数不是数字")
            continue
        if not card:
            issues.append(f"{code} 这张卡不存在")
            continue
        if n <= 0:
            continue
        if card.max_copies and n > card.max_copies:
            issues.append(f"「{card.name}」{n} 张，超过上限 {card.max_copies}")
        total += n
    if total != DECK_SIZE:
        issues.append(f"共 {total} 张，标准是 {DECK_SIZE} 张")
    return issues


def deck_report(db: Session) -> dict:
    """整站卡组体检：每个职业的标准模板 + 每个角色的实际卡组。"""
    classes = db.query(CardClass).order_by(CardClass.sort, CardClass.id).all()
    class_rows = []
    for cls in classes:
        try:
            deck = json.loads(cls.default_deck or "{}")
        except Exception:
            deck = {}
        total = sum(int(v) for v in deck.values() if str(v).lstrip("-").isdigit())
        class_rows.append({
            "code": cls.code, "name": cls.name, "total": total,
            "ok": total == DECK_SIZE and not _deck_issues(db, deck),
            "issues": _deck_issues(db, deck),
            "reference_total": sum(reference_deck(cls.code).values()),
        })

    from ..models.character import Character
    load_rows = []
    for lo in db.query(CardLoadout).order_by(CardLoadout.id).all():
        ch = db.query(Character).filter(Character.id == lo.character_id).first()
        try:
            deck = json.loads(lo.deck or "{}")
        except Exception:
            deck = {}
        total = sum(int(v) for v in deck.values() if str(v).lstrip("-").isdigit())
        load_rows.append({
            "id": lo.id, "character_id": lo.character_id,
            "character_name": (ch.name if ch else f"#{lo.character_id}"),
            "class_code": lo.class_code, "total": total,
            "ok": total == DECK_SIZE and not _deck_issues(db, deck),
            "issues": _deck_issues(db, deck),
        })

    bad_class = sum(1 for r in class_rows if not r["ok"])
    bad_load = sum(1 for r in load_rows if not r["ok"])
    return {
        "deck_size": DECK_SIZE,
        "classes": class_rows,
        "loadouts": load_rows,
        "bad_classes": bad_class,
        "bad_loadouts": bad_load,
        "ok": bad_class == 0 and bad_load == 0,
    }


def repair_decks(db: Session) -> dict:
    """一键把不合规的卡组按固定模板补齐。

    只动「不合规」的那些，合规的一副都不碰 —— 后台精心调过的牌不能被冲掉。
    """
    fixed_class = 0
    for cls in db.query(CardClass).all():
        try:
            deck = json.loads(cls.default_deck or "{}")
        except Exception:
            deck = {}
        if _deck_issues(db, deck):
            cls.default_deck = json.dumps(reference_deck(cls.code), ensure_ascii=False)
            fixed_class += 1

    fixed_load = 0
    for lo in db.query(CardLoadout).all():
        try:
            deck = json.loads(lo.deck or "{}")
        except Exception:
            deck = {}
        if _deck_issues(db, deck):
            cls = db.query(CardClass).filter(CardClass.code == lo.class_code).first()
            src = None
            if cls and cls.default_deck:
                try:
                    src = json.loads(cls.default_deck)
                except Exception:
                    src = None
            if not src or _deck_issues(db, src):
                src = reference_deck(lo.class_code)
            lo.deck = json.dumps(src, ensure_ascii=False)
            lo.note = ((lo.note or "") + " ｜ 已按固定模板补齐").strip(" ｜")
            fixed_load += 1

    db.commit()
    return {"ok": True, "fixed_classes": fixed_class, "fixed_loadouts": fixed_load}
