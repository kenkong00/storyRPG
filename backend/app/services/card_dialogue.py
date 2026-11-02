# -*- coding: utf-8 -*-
"""战斗对话 / 战斗表情的规则引擎。

规则怎么生效（后台「战斗对话」页的说明也是这一份）
--------------------------------------------------
1. 引擎在关键时刻抛一个 trigger（例如「自己打出暴击」→ crit_dealt）。
2. 这里按 trigger + 阵营筛出启用的规则行，过冷却（cooldown_rounds）与「每局一次」
   （once_per_battle），再按 weight 加权随机挑一条。
3. 规则挑中后决定「用哪个情感 + 说什么」：
      · 行内有 text   → 用行内台词（支持占位符）
      · 行内 text 为空 → 用该情感的默认台词（玩家侧 player_line / 敌方 ai_line）
4. 最后返回一个 emotion 事件：前端在左下对话流里追加一条，并在需要时弹全屏情感卡。

占位符：{round} {name} {enemy} {player_class} {enemy_class} {dmg} {hp} {emotion}
"""

from __future__ import annotations

import random

# 触发点清单（后台下拉框 + 说明文档都读这里）
TRIGGERS = [
    {"key": "battle_start", "label": "对决开始", "desc": "开局先手确定后各说一句"},
    {"key": "round_start", "label": "回合开始", "desc": "每个大回合比完速度、先手方行动前"},
    {"key": "turn_start", "label": "行动回合开始", "desc": "某一方回合开始（含后手）"},
    {"key": "crit_dealt", "label": "打出暴击", "desc": "本次攻击触发暴击，伤害翻倍"},
    {"key": "crit_taken", "label": "被暴击", "desc": "本方英雄被暴击命中"},
    {"key": "big_damage_dealt", "label": "造成重伤", "desc": "单次对英雄造成 ≥8 点 HP 伤害"},
    {"key": "big_damage_taken", "label": "受到重伤", "desc": "本方单次承受 ≥8 点 HP 伤害"},
    {"key": "guard_block", "label": "护甲全挡", "desc": "伤害被 DEF 完全吸收、HP 未掉"},
    {"key": "guard_broken", "label": "守卫被击碎", "desc": "本方一名守卫被打碎"},
    {"key": "guard_spawn", "label": "召唤守卫", "desc": "打出守卫牌之后"},
    {"key": "heal", "label": "回复生命", "desc": "任一治疗效果生效（回血量 >0）"},
    {"key": "low_hp", "label": "血量危急", "desc": "本方 HP ≤ 上限 30%"},
    {"key": "lethal_near", "label": "濒死", "desc": "本方 HP ≤ 5"},
    {"key": "mana_denied", "label": "被降费", "desc": "本方回合开始吃到降费惩罚"},
    {"key": "card_stolen", "label": "被偷牌", "desc": "手牌被复制或被夺走"},
    {"key": "steal_success", "label": "偷牌得手", "desc": "自己成功复制 / 夺走对手手牌"},
    {"key": "deck_empty", "label": "牌库抽空", "desc": "牌库空后抽牌吃疲劳伤害"},
    {"key": "victory", "label": "获胜", "desc": "对局结束、本方胜利"},
    {"key": "defeat", "label": "落败", "desc": "对局结束、本方失败"},
    {"key": "taunt", "label": "手动挑衅", "desc": "玩家点击「挑衅」表情按钮"},
]

TRIGGER_LABELS = {t["key"]: t["label"] for t in TRIGGERS}

# 规则表被清空时的兜底（保证任何时候都有反馈，不至于全程沉默）
DEFAULT_EMOTION = {
    "battle_start": ("emo_confident", "enemy"),
    "round_start": ("emo_cold", "enemy"),
    "turn_start": ("emo_impatient", "enemy"),
    "crit_dealt": ("emo_lucky", "self"),
    "crit_taken": ("emo_shock", "self"),
    "big_damage_dealt": ("emo_crazy", "self"),
    "big_damage_taken": ("emo_fear", "self"),
    "guard_block": ("emo_scorn", "self"),
    "guard_broken": ("emo_cry", "self"),
    "guard_spawn": ("emo_confident", "self"),
    "heal": ("emo_confident", "self"),
    "low_hp": ("emo_laststand", "self"),
    "lethal_near": ("emo_laststand", "self"),
    "mana_denied": ("emo_anger", "self"),
    "card_stolen": ("emo_anger", "self"),
    "steal_success": ("emo_scheming", "self"),
    "deck_empty": ("emo_despair", "self"),
    "victory": ("emo_king", "self"),
    "defeat": ("emo_despair", "self"),
    "taunt": ("emo_provoke", "self"),
}

# 值得弹全屏情感卡的触发点（其余只在对话流里显示）
FLASH_TRIGGERS = {
    "battle_start", "crit_dealt", "low_hp", "lethal_near",
    "victory", "defeat", "big_damage_dealt", "taunt", "guard_broken",
}


def side_name(side: int) -> str:
    return "self" if int(side) == 0 else "enemy"


def pick(state: dict, rules: list, emotions: dict, trigger: str, side: int,
         ctx: dict | None = None) -> dict | None:
    """返回一个 emotion 事件，或 None（没匹配到规则）。"""
    ctx = dict(ctx or {})
    side_s = side_name(side)
    me = state["players"][int(side)]
    foe = state["players"][1 - int(side)]
    ctx.setdefault("round", state.get("round", 1))
    ctx.setdefault("name", me.get("name") or "")
    ctx.setdefault("enemy", foe.get("name") or "")
    ctx.setdefault("player_class", state["players"][0].get("class_name") or "")
    ctx.setdefault("enemy_class", state["players"][1].get("class_name") or "")
    ctx.setdefault("hp", me.get("hp", 0))
    ctx.setdefault("dmg", 0)

    used = state.setdefault("dialogue_used", {})
    rnd = int(state.get("round", 1))

    candidates = []
    for r in rules:
        if not r.get("enabled", 1):
            continue
        if r.get("trigger") != trigger:
            continue
        if r.get("side") not in (side_s, "any"):
            continue
        key = str(r.get("id"))
        rec = used.get(key) or {}
        if r.get("once_per_battle") and rec.get("count", 0) >= 1:
            continue
        cd = int(r.get("cooldown_rounds") or 0)
        if cd and rec.get("round") is not None and rnd - int(rec["round"]) < cd:
            continue
        candidates.append(r)

    rule = None
    if candidates:
        total = sum(max(1, int(c.get("weight") or 1)) for c in candidates)
        roll = random.uniform(0, total)
        acc = 0.0
        for c in candidates:
            acc += max(1, int(c.get("weight") or 1))
            if roll <= acc:
                rule = c
                break
        rule = rule or candidates[-1]

    if rule:
        code = rule.get("emotion_code") or "emo_confident"
        text = (rule.get("text") or "").strip()
        flash = trigger in FLASH_TRIGGERS
        rid = str(rule.get("id"))
        rec = used.setdefault(rid, {"round": rnd, "count": 0})
        rec["round"] = rnd
        rec["count"] = int(rec.get("count", 0)) + 1
    else:
        fallback = DEFAULT_EMOTION.get(trigger)
        # 兜底也要跟阵营对上；只有默认阵营匹配时才说
        if not fallback or fallback[1] != side_s:
            return None
        code, _ = fallback
        text = ""
        flash = trigger in FLASH_TRIGGERS and random.random() < 0.65

    emo = emotions.get(code)
    if not emo:
        return None
    if not text:
        text = (emo.get("player_line") if int(side) == 0 else emo.get("ai_line")) or ""
    if not text:
        return None

    try:
        text = text.format(**ctx)
    except Exception:
        pass

    return {
        "type": "emotion",
        "side": int(side),
        "code": code,
        "name": emo.get("name") or "",
        "tag": emo.get("tag") or "",
        "color": emo.get("color") or "#d4af37",
        "line": text,
        "speaker": me.get("name") or "",
        "trigger": trigger,
        "flash": bool(flash),
    }
