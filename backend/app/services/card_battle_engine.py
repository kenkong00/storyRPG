# -*- coding: utf-8 -*-
"""卡牌对决引擎（服务端权威）。

规则逐条对齐《六职业扩展版 · 30 张回合卡牌对决规则说明书》与原生 JS 实现：

  · 回合开始比 SPD 定先后（同速由服务端随机判定并写战报，原版是猜拳弹窗）
  · 法力 2 → 3 → 4 → 5 封顶，回合开始回满、不累计，被降费保底 1
  · 起手 5 张、每回合抽 1、手牌上限 7（超出直接爆牌弃置）、牌库空抽牌掉 3 血
  · 伤害四步：降攻修正 → 暴击判定 → 守卫层（含溢出） → DEF 层
  · 暴击爽点：单次暴击最终伤害 ≥5，本回合额外抽 1 张（每回合最多 1 次）
  · 负面：降攻一次性、降防 / 降速到目标下回合结束（不叠加，只刷新）、降费作用下回合
  · 偷牌：复制每回合 1 次；夺心本回合锁定、下回合可用

对外只做三件事：new_state / play_card / end_turn / ai_step，全部返回「事件流」，
前端按事件演出，不写任何数值逻辑。
"""

from __future__ import annotations

import json
import random
import uuid
from typing import Any

from . import card_dialogue as DLG

# 手牌上限 / 疲劳伤害 / 法力封顶
HAND_LIMIT = 7
FATIGUE_DAMAGE = 3
MANA_CAP = 5
OPENING_HAND = 5


def _uid() -> str:
    return "c" + uuid.uuid4().hex[:10]


def _eff_def(p: dict) -> int:
    return max(0, int(p.get("defense", 0)) - int(p.get("debuffs", {}).get("def", 0)))


def _eff_spd(p: dict) -> int:
    return max(0, int(p.get("base_spd", 0)) - int(p.get("debuffs", {}).get("spd", 0)))


# 卡牌「飞到哪儿」——只给前端演出用，规则仍然是引擎说了算。
#   self        飞向出牌方英雄面板（加 DEF / 回血 / 净化 / 闪身这类对自己生效的牌）
#   foe         飞向对方英雄面板（无视守卫的直击、降费之类的对脸效果）
#   guard_self  落在出牌方的前线守卫区（守卫牌：像扑克一样摆到自己这半张桌上）
#   guard_foe   落在对方的前线守卫区（攻击 / 清场：先把对方的守卫牌打掉）
_IMPACT_SELF_SCRIPTS = {
    "buff_def", "buff_def_draw", "def_heal", "heal", "heal_def",
    "cleanse", "dodge", "draw2",
}


def impact_target(card: dict, foe_guards: list | None = None) -> str:
    """返回这张牌打出后的视觉落点（前端 cardImpact 用）。"""
    cat = (card.get("category") or "").strip()
    script = (card.get("script") or "").strip()
    if cat == "guard":
        return "guard_self"
    if script in _IMPACT_SELF_SCRIPTS:
        return "self"
    if script == "clear_guards":
        return "guard_foe"
    if script == "pierce_hero":
        return "foe"          # 无视守卫，直接砸脸
    # 攻击 / 功能类：对方有守卫就先打守卫，没有就砸英雄
    return "guard_foe" if (foe_guards or []) else "foe"


def card_instance(card: dict) -> dict:
    """把数据库卡牌转成对局内实例：只带引擎与 UI 需要的字段，状态自包含。"""
    return {
        "uid": _uid(),
        "code": card["code"],
        "name": card["name"],
        "cost": int(card.get("cost") or 0),
        "category": card.get("category") or "skill",
        "category_label": card.get("category_label") or "",
        "class_label": card.get("class_label") or "",
        "value": int(card.get("value") or 0),
        "hits": max(1, int(card.get("hits") or 1)),
        "bonus_crit": int(card.get("bonus_crit") or 0),
        "crit_bonus_flat": int(card.get("crit_bonus_flat") or 0),
        "extra_def": int(card.get("extra_def") or 0),
        "heal_val": int(card.get("heal_val") or 0),
        "half_def_pierce": int(card.get("half_def_pierce") or 0),
        "atk_debuff": int(card.get("atk_debuff") or 0),
        "needs_target": int(card.get("needs_target") or 0),
        "script": card.get("script") or "",
        "desc": card.get("desc") or "",
        "art": card.get("image_url") or "",
        "locked": False,
    }


class CardBattle:
    """一局对决。构造后调用 start()。"""

    def __init__(self, state: dict | None = None, *, cards: dict | None = None,
                 rules: list | None = None, emotions: dict | None = None):
        # cards: {code: 卡牌dict}；rules/emotions 来自后台可编辑表
        self.cards = cards or {}
        self.rules = rules or []
        self.emotions = emotions or {}
        self.state = state or {}
        if state is not None:
            self.state.setdefault("log", [])

    # ==================================================================
    # 建局
    # ==================================================================
    @classmethod
    def create(cls, player_meta: dict, player_class: dict, player_deck: dict,
               enemy_meta: dict, enemy_class: dict, enemy_deck: dict,
               cards: dict, rules: list, emotions: dict) -> "CardBattle":
        g = cls(cards=cards, rules=rules, emotions=emotions)
        g.state = {
            "version": 1,
            "round": 1,
            "active": 0,
            "turn_order": [0, 1],
            "order_step": 0,
            "phase": "active",           # active / over
            "winner": None,
            "await_ai": False,
            "ai_done": False,
            "total_cards_played": 0,
            "log": [],
            "dialogue_used": {},
            "players": [
                g._make_player(0, player_class, player_deck, player_meta, is_ai=False),
                g._make_player(1, enemy_class, enemy_deck, enemy_meta, is_ai=True),
            ],
        }
        return g

    def _make_player(self, side: int, cls: dict, deck_counts: dict,
                     meta: dict, is_ai: bool) -> dict:
        deck: list[dict] = []
        for code, count in (deck_counts or {}).items():
            card = self.cards.get(code)
            if not card:
                continue
            for _ in range(max(0, int(count))):
                deck.append(card_instance(card))
        random.shuffle(deck)
        return {
            "side": side,
            "name": meta.get("name") or cls.get("hero_name") or cls.get("name"),
            "class_code": cls.get("code"),
            "class_name": cls.get("name"),
            "hero_name": cls.get("hero_name") or "",
            "portrait": meta.get("portrait") or "",
            "character_id": meta.get("character_id"),
            "is_ai": is_ai,
            "hp": int(cls.get("hp") or 25),
            "max_hp": int(cls.get("hp") or 25),
            "defense": int(cls.get("defense") or 0),
            "base_defense": int(cls.get("defense") or 0),
            "base_spd": int(cls.get("spd") or 3),
            "cri": int(cls.get("cri") or 0),
            "mana": 2,
            "max_mana": 2,
            "deck": deck,
            "hand": [],
            "guards": [],
            "flags": {
                "clear_played": False,
                "steal_copy_used": False,
                "crit_draw_used": False,
            },
            "debuffs": {
                "atk": 0, "def": 0, "def_turns": 0,
                "spd": 0, "spd_turns": 0,
                "mana_penalty": 0, "dodge": 0,
            },
        }

    # ==================================================================
    # 基础
    # ==================================================================
    @property
    def p(self) -> list[dict]:
        return self.state["players"]

    def me(self, side: int) -> dict:
        return self.state["players"][side]

    def foe(self, side: int) -> dict:
        return self.state["players"][1 - side]

    def _ev(self, events: list, **kw) -> None:
        events.append(kw)

    def _log(self, events: list, text: str, kind: str = "info") -> None:
        entry = {"round": self.state.get("round", 1), "text": text, "kind": kind}
        log = self.state.setdefault("log", [])
        log.append(entry)
        if len(log) > 240:
            del log[:60]
        events.append({"type": "log", "text": text, "kind": kind, "round": entry["round"]})

    def _say(self, events: list, trigger: str, side: int, **ctx) -> None:
        """按后台规则挑一句台词 + 情感，附带给前端播全屏情感卡。"""
        ev = DLG.pick(self.state, self.rules, self.emotions, trigger, side, ctx)
        if ev:
            events.append(ev)

    # ==================================================================
    # 开局
    # ==================================================================
    def start(self) -> list[dict]:
        events: list[dict] = []
        p0, p1 = self.p
        self._log(events,
                  f"=== 裂界对决开始：{p0['name']}（{p0['class_name']}） VS "
                  f"{p1['name']}（{p1['class_name']}） ===", "info")
        self._log(events, "双方各备 30 张牌组，起手抽 5 张。", "info")
        for _ in range(OPENING_HAND):
            self._draw(0, events, silent=True)
            self._draw(1, events, silent=True)
        events.append({"type": "deal", "hands": [len(p0["hand"]), len(p1["hand"])]})
        self._say(events, "battle_start", 0)
        self._say(events, "battle_start", 1)
        self._start_round(events)
        return events

    def _start_round(self, events: list) -> None:
        st = self.state
        st["order_step"] = 0
        p0, p1 = self.p
        s0, s1 = _eff_spd(p0), _eff_spd(p1)
        tie = False
        if s0 > s1:
            first = 0
        elif s1 > s0:
            first = 1
        else:
            first = random.randint(0, 1)
            tie = True
        st["turn_order"] = [first, 1 - first]
        # 每回合开始重置闪身（只在本方回合内有效）
        for p in self.p:
            p["debuffs"]["dodge"] = 0
        msg = (f"⚡ 第 {st['round']} 回合速度比拼：{p0['class_name']} SPD {s0} vs "
               f"{p1['class_name']} SPD {s1} → {'同速猜拳，' if tie else ''}"
               f"{self.p[first]['name']} 先手")
        self._log(events, msg, "info")
        events.append({"type": "round_start", "round": st["round"], "first": first,
                       "spd": [s0, s1], "tie": tie})
        self._say(events, "round_start", first)
        self._begin_turn(first, events)

    def _begin_turn(self, side: int, events: list) -> None:
        st = self.state
        st["active"] = side
        st["ai_done"] = False
        p = self.p[side]
        p["flags"]["clear_played"] = False
        p["flags"]["steal_copy_used"] = False
        p["flags"]["crit_draw_used"] = False
        for c in p["hand"]:
            c["locked"] = False          # 夺心偷来的牌下回合解锁
        base = min(MANA_CAP, int(st["round"]) + 1)
        penalty = int(p["debuffs"].get("mana_penalty") or 0)
        p["debuffs"]["mana_penalty"] = 0
        p["max_mana"] = max(1, base - penalty)
        p["mana"] = p["max_mana"]
        if penalty:
            self._log(events, f"💧 {p['name']} 受到降费影响，本回合法力上限 -{penalty}，实得 {p['mana']} 费", "warn")
            self._say(events, "mana_denied", side)
        else:
            self._log(events, f"— {p['name']} 回合开始，法力回满 {p['mana']} 费 —", "info")
        events.append({"type": "turn_start", "side": side, "round": st["round"],
                       "mana": p["mana"], "max_mana": p["max_mana"]})
        self._draw(side, events)
        st["await_ai"] = bool(p["is_ai"]) and st["phase"] == "active"
        if st["await_ai"]:
            events.append({"type": "await_ai", "side": side})

    # ==================================================================
    # 抽牌
    # ==================================================================
    def _draw(self, side: int, events: list, silent: bool = False) -> None:
        p = self.p[side]
        if self.state["phase"] != "active":
            return
        if not p["deck"]:
            p["hp"] = max(0, p["hp"] - FATIGUE_DAMAGE)
            self._log(events, f"⚠️ {p['name']} 牌库已空，疲劳扣除 {FATIGUE_DAMAGE} 点生命（剩 {p['hp']}）", "warn")
            events.append({"type": "fatigue", "side": side, "amount": FATIGUE_DAMAGE, "hp": p["hp"]})
            self._say(events, "deck_empty", side)
            self._check_over(events)
            return
        card = p["deck"].pop()
        if len(p["hand"]) >= HAND_LIMIT:
            self._log(events, f"⚠️ {p['name']} 手牌已满 7 张，抽到的「{card['name']}」直接弃置", "warn")
            events.append({"type": "burn", "side": side, "card": {"name": card["name"], "art": card.get("art")}})
            return
        p["hand"].append(card)
        events.append({"type": "draw", "side": side, "count": 1,
                       "deck": len(p["deck"]), "hand": len(p["hand"]),
                       "card": {"name": card["name"], "cost": card["cost"], "art": card.get("art")}})
        if not silent:
            self._log(events, f"{p['name']} 抽了 1 张牌（牌库剩 {len(p['deck'])} 张）", "info")

    # ==================================================================
    # 出牌
    # ==================================================================
    def play_card(self, side: int, uid: str, target_guard: str | None = None) -> list[dict]:
        events: list[dict] = []
        st = self.state
        if st["phase"] != "active" or st["active"] != side:
            return [{"type": "error", "text": "现在不是你的回合"}]
        p, foe = self.p[side], self.foe(side)

        idx = next((i for i, c in enumerate(p["hand"]) if c["uid"] == uid), -1)
        if idx < 0:
            return [{"type": "error", "text": "手牌里没有这张卡"}]
        card = p["hand"][idx]

        if card.get("locked"):
            return [{"type": "error", "text": "夺心偷来的牌要下回合才能打出"}]
        if card["cost"] > p["mana"]:
            return [{"type": "error", "text": f"法力不足（需要 {card['cost']}，剩 {p['mana']}）"}]

        script = card.get("script") or ""
        if script == "clear_guards":
            if p["flags"]["clear_played"]:
                return [{"type": "error", "text": "禁令：一回合最多打出 1 张清场"}]
            if not foe["guards"]:
                return [{"type": "error", "text": "对方场上没有守卫"}]
        if script == "steal_copy" and p["flags"]["steal_copy_used"]:
            return [{"type": "error", "text": "心智窃取每回合只能发动 1 次"}]

        # 扣费 + 离手
        p["mana"] -= card["cost"]
        p["hand"].pop(idx)
        if side == 0:
            st["total_cards_played"] += 1

        events.append({"type": "play", "side": side, "card": {
            "uid": card["uid"], "code": card["code"], "name": card["name"],
            "cost": card["cost"], "desc": card["desc"], "category": card["category"],
            "script": card.get("script") or "",
            "art": card.get("art") or "",
        }, "mana": p["mana"],
            # 前端按这个把卡从「出牌方」飞向正确落点（别再一律从玩家手牌飞）
            "target": impact_target(card, foe["guards"])})

        # ---------- 分支 ----------
        if card["category"] == "guard":
            guard = {
                "uid": _uid(), "card_code": card["code"], "name": card["name"],
                "hp": card["value"], "max_hp": card["value"],
                "art": card.get("art") or "",
            }
            p["guards"].append(guard)
            self._log(events, f"🛡️ {p['name']} 打出「{card['name']}」，召唤 {card['value']} 血守卫", "guard")
            events.append({"type": "guard_spawn", "side": side, "guard": guard})
            self._say(events, "guard_spawn", side)

        elif script == "draw2":
            self._log(events, f"💠 {p['name']} 打出「{card['name']}」，连抽 2 张", "special")
            self._draw(side, events)
            self._draw(side, events)

        elif script == "clear_guards":
            p["flags"]["clear_played"] = True
            n = len(foe["guards"])
            foe["guards"] = []
            self._log(events, f"💥 {p['name']} 打出「清场」，消灭对方全部 {n} 名守卫", "special")
            events.append({"type": "guard_clear", "side": 1 - side, "count": n})

        elif script == "pierce_hero":
            res = self._roll(p, card["value"], 0, 0)
            self._log(events, f"⚡ {p['name']}「{card['name']}」（掷骰 {res['roll']}/{res['chance']}%"
                              f"{' 暴击' if res['crit'] else ''}）无视守卫直击英雄", "crit" if res["crit"] else "special")
            self._hit_hero(side, res["final"], card["name"], False, res["crit"], events)
            self._crit_perk(side, res["crit"], res["final"], events)

        elif script in ("buff_def",):
            p["defense"] += card["value"]
            self._log(events, f"🛡️ {p['name']}「{card['name']}」获得 +{card['value']} DEF（有效 {_eff_def(p)}）", "guard")
            events.append({"type": "buff", "side": side, "defense": _eff_def(p), "delta": card["value"]})

        elif script == "buff_def_draw":
            p["defense"] += card["value"]
            self._log(events, f"📯 {p['name']}「{card['name']}」获得 +{card['value']} DEF 并抽 1 张", "guard")
            events.append({"type": "buff", "side": side, "defense": _eff_def(p), "delta": card["value"]})
            self._draw(side, events)

        elif script == "def_heal":
            p["defense"] += card["value"]
            healed = min(p["max_hp"] - p["hp"], card["heal_val"])
            p["hp"] += healed
            self._log(events, f"🏔️ {p['name']}「{card['name']}」+{card['value']} DEF，回复 {healed} HP", "guard")
            events.append({"type": "buff", "side": side, "defense": _eff_def(p)})
            events.append({"type": "heal", "side": side, "amount": healed, "hp": p["hp"]})
            if healed:
                self._say(events, "heal", side)

        elif script == "heal":
            healed = min(p["max_hp"] - p["hp"], card["value"])
            p["hp"] += healed
            self._log(events, f"💚 {p['name']}「{card['name']}」回复 {healed} HP（{p['hp']}/{p['max_hp']}）", "special")
            events.append({"type": "heal", "side": side, "amount": healed, "hp": p["hp"]})
            if healed:
                self._say(events, "heal", side)

        elif script == "heal_def":
            healed = min(p["max_hp"] - p["hp"], card["value"])
            p["hp"] += healed
            p["defense"] += card["extra_def"]
            self._log(events, f"👼 {p['name']}「{card['name']}」回复 {healed} HP、+{card['extra_def']} DEF", "special")
            events.append({"type": "heal", "side": side, "amount": healed, "hp": p["hp"]})
            events.append({"type": "buff", "side": side, "defense": _eff_def(p)})
            if healed:
                self._say(events, "heal", side)

        elif script == "cleanse":
            d = p["debuffs"]
            d["def"] = 0
            d["def_turns"] = 0
            d["spd"] = 0
            d["spd_turns"] = 0
            d["mana_penalty"] = 0
            self._log(events, f"🕊️ {p['name']}「净化」解除全部持续负面，并抽 1 张", "special")
            events.append({"type": "cleanse", "side": side})
            self._draw(side, events)

        elif script == "mana_penalty":
            foe["debuffs"]["mana_penalty"] = int(foe["debuffs"].get("mana_penalty") or 0) + 1
            self._log(events, f"🗣️ {p['name']}「{card['name']}」使 {foe['name']} 下回合法力 -1", "special")
            events.append({"type": "status", "side": 1 - side, "key": "mana_penalty", "value": 1})

        elif script == "def_down":
            foe["debuffs"]["def"] = 2
            foe["debuffs"]["def_turns"] = 1
            self._log(events, f"💔 {p['name']}「{card['name']}」使 {foe['name']} DEF -2（至其下回合结束）", "special")
            events.append({"type": "status", "side": 1 - side, "key": "def", "value": -2,
                           "defense": _eff_def(foe)})

        elif script == "spd_down":
            foe["debuffs"]["spd"] = 2
            foe["debuffs"]["spd_turns"] = 1
            self._log(events, f"⛓️ {p['name']}「{card['name']}」使 {foe['name']} SPD -2（至其下回合结束）", "special")
            events.append({"type": "status", "side": 1 - side, "key": "spd", "value": -2,
                           "spd": _eff_spd(foe)})

        elif script == "steal_copy":
            p["flags"]["steal_copy_used"] = True
            if not foe["hand"]:
                self._log(events, f"🪞 {p['name']}「心智窃取」发动，但对方手牌为空，效果空发", "warn")
            elif len(p["hand"]) >= HAND_LIMIT:
                self._log(events, f"⚠️ {p['name']} 手牌已满，复制的卡牌直接消散", "warn")
            else:
                src = random.choice(foe["hand"])
                copy = card_instance(self.cards.get(src["code"], src))
                copy["locked"] = False
                p["hand"].append(copy)
                self._log(events, f"🪞 {p['name']} 复制了对手的「{src['name']}」", "special")
                events.append({"type": "steal", "side": side, "mode": "copy",
                               "card": {"name": src["name"], "art": src.get("art") or ""}})
                self._say(events, "steal_success", side)
                self._say(events, "card_stolen", 1 - side)

        elif script == "mind_take":
            if not foe["hand"]:
                self._log(events, f"🖐️ {p['name']}「夺心」发动，但对方手牌为空，效果空发", "warn")
            else:
                stolen = foe["hand"].pop(random.randrange(len(foe["hand"])))
                stolen["locked"] = True
                if len(p["hand"]) < HAND_LIMIT:
                    p["hand"].append(stolen)
                self._log(events, f"🖐️ {p['name']}「夺心」偷走 {foe['name']} 的「{stolen['name']}」（本回合锁定）", "special")
                events.append({"type": "steal", "side": side, "mode": "take",
                               "card": {"name": stolen["name"], "art": stolen.get("art") or ""}})
                self._say(events, "steal_success", side)
                self._say(events, "card_stolen", 1 - side)

        elif script == "dodge":
            p["debuffs"]["dodge"] = 3
            self._log(events, f"💨 {p['name']}「{card['name']}」，本回合受击伤害 -3", "special")
            events.append({"type": "status", "side": side, "key": "dodge", "value": 3})

        else:
            # ---------- 攻击类 ----------
            for h in range(card["hits"]):
                if self.state["phase"] != "active":
                    break
                res = self._roll(p, card["value"], card["bonus_crit"], card["crit_bonus_flat"])
                label = f"{card['name']}·第{h + 1}击" if card["hits"] > 1 else card["name"]
                self._log(events,
                          f"🎲「{label}」掷骰 {res['roll']}（暴击率 {res['chance']}%）→ "
                          f"{'💥暴击 ' + str(res['final']) + ' 伤' if res['crit'] else '命中 ' + str(res['final']) + ' 伤'}",
                          "crit" if res["crit"] else "attack")
                self._strike(side, res["final"], label, target_guard,
                             bool(card["half_def_pierce"]), res["crit"], events)
                self._crit_perk(side, res["crit"], res["final"], events)

            if card["extra_def"]:
                p["defense"] += card["extra_def"]
                self._log(events, f"🔨「{card['name']}」附加：+{card['extra_def']} DEF", "guard")
                events.append({"type": "buff", "side": side, "defense": _eff_def(p)})

            if script == "attack_heal_if_def" and _eff_def(p) >= 3:
                healed = min(p["max_hp"] - p["hp"], 2)
                p["hp"] += healed
                self._log(events, f"✨「{card['name']}」因 DEF≥3，额外回复 {healed} HP", "special")
                events.append({"type": "heal", "side": side, "amount": healed, "hp": p["hp"]})
                if healed:
                    self._say(events, "heal", side)

            if card["atk_debuff"]:
                foe["debuffs"]["atk"] = int(foe["debuffs"].get("atk") or 0) + card["atk_debuff"]
                self._log(events, f"🧠「{card['name']}」附加：{foe['name']} 下一张攻击牌伤害 -{card['atk_debuff']}", "special")
                events.append({"type": "status", "side": 1 - side, "key": "atk", "value": -card["atk_debuff"]})

        events.append({"type": "state", "state": self.public_state()})
        self._check_over(events)
        return events

    # ==================================================================
    # 伤害
    # ==================================================================
    def _roll(self, attacker: dict, base: int, bonus_crit: int = 0, crit_flat: int = 0) -> dict:
        dmg = base
        if attacker["debuffs"].get("atk"):
            cut = int(attacker["debuffs"]["atk"])
            dmg = max(0, dmg - cut)
            attacker["debuffs"]["atk"] = 0
        chance = min(100, int(attacker["cri"]) + int(bonus_crit))
        roll = random.randint(1, 100)
        crit = roll <= chance and dmg > 0
        final = dmg * 2 + crit_flat if crit else dmg
        return {"final": final, "crit": crit, "roll": roll, "chance": chance, "base": dmg}

    def _strike(self, side: int, dmg: int, source: str, target_guard: str | None,
                half_pierce: bool, crit: bool, events: list) -> None:
        foe = self.foe(side)
        if foe["guards"]:
            gi = next((i for i, g in enumerate(foe["guards"]) if g["uid"] == target_guard), 0)
            guard = foe["guards"][gi]
            prev = guard["hp"]
            guard["hp"] = max(0, guard["hp"] - dmg)
            excess = max(0, dmg - prev)
            events.append({"type": "guard_hit", "side": 1 - side, "guard_uid": guard["uid"],
                           "amount": dmg, "hp": guard["hp"], "max_hp": guard["max_hp"],
                           "crit": crit, "destroyed": guard["hp"] <= 0})
            if guard["hp"] <= 0:
                foe["guards"].pop(gi)
                self._log(events, f"⚔️「{source}」击碎 {foe['name']} 的守卫「{guard['name']}」（{prev} 血）", "attack")
                self._say(events, "guard_broken", 1 - side)
                if excess > 0:
                    self._strike(side, excess, source + "·溢出", None, half_pierce, False, events)
            else:
                self._log(events, f"⚔️「{source}」对守卫「{guard['name']}」造成 {dmg} 伤（剩 {guard['hp']}）", "attack")
            return
        self._hit_hero(side, dmg, source, half_pierce, crit, events)

    def _hit_hero(self, side: int, dmg: int, source: str, half_pierce: bool,
                  crit: bool, events: list) -> None:
        attacker, defender = self.p[side], self.foe(side)
        d = dmg
        reduced = 0
        if defender["debuffs"].get("dodge") and d > 0:
            reduced = min(d, int(defender["debuffs"]["dodge"]))
            d -= reduced
            self._log(events, f"💨 {defender['name']} 的闪身减免 {reduced} 点伤害", "guard")
        eff = _eff_def(defender)
        usable = eff // 2 if half_pierce else eff
        absorbed = min(usable, d)
        hp_dmg = d - absorbed
        defender["defense"] = max(0, defender["defense"] - absorbed)
        defender["hp"] = max(0, defender["hp"] - hp_dmg)

        self._log(events,
                  f"🔥「{source}」命中 {defender['name']}{'（无视一半 DEF）' if half_pierce else ''}："
                  f"扣 {absorbed} DEF / {hp_dmg} HP（剩 DEF {_eff_def(defender)} / HP {defender['hp']}）",
                  "crit" if crit else "attack")
        events.append({"type": "hero_hit", "side": 1 - side, "amount": d, "absorbed": absorbed,
                       "hp_damage": hp_dmg, "crit": crit, "dodge": reduced,
                       "hp": defender["hp"], "max_hp": defender["max_hp"],
                       "defense": _eff_def(defender)})

        if hp_dmg > 0 and absorbed == 0 and eff > 0:
            self._say(events, "guard_block", 1 - side)
        if hp_dmg >= 8:
            self._say(events, "big_damage_dealt", side)
            self._say(events, "big_damage_taken", 1 - side)
        if crit:
            self._say(events, "crit_dealt", side)
            self._say(events, "crit_taken", 1 - side)
        if defender["hp"] > 0:
            if defender["hp"] <= 5:
                self._say(events, "lethal_near", 1 - side)
            elif defender["hp"] <= defender["max_hp"] * 0.3:
                self._say(events, "low_hp", 1 - side)

    def _crit_perk(self, side: int, crit: bool, final: int, events: list) -> None:
        if not crit or final < 5 or self.state["phase"] != "active":
            return
        p = self.p[side]
        if p["flags"]["crit_draw_used"]:
            return
        p["flags"]["crit_draw_used"] = True
        self._log(events, f"🔥 暴击爽点：单次暴击 {final} 伤（≥5），{p['name']} 额外抽 1 张", "crit")
        events.append({"type": "crit_perk", "side": side})
        self._draw(side, events)

    # ==================================================================
    # 回合结束
    # ==================================================================
    def end_turn(self) -> list[dict]:
        events: list[dict] = []
        st = self.state
        if st["phase"] != "active":
            return events
        side = st["active"]
        p = self.p[side]

        # 手牌超限：从最低费开始弃（原版是弹窗让玩家选，服务端自动弃最低费）
        while len(p["hand"]) > HAND_LIMIT:
            p["hand"].sort(key=lambda c: c["cost"])
            dropped = p["hand"].pop(0)
            self._log(events, f"🗑️ {p['name']} 手牌超限，弃掉「{dropped['name']}」", "warn")
            events.append({"type": "discard", "side": side, "card": {"name": dropped["name"]}})

        # 持续负面计时：到自己回合结束才解除
        d = p["debuffs"]
        if d.get("def_turns", 0) > 0:
            d["def_turns"] -= 1
            if d["def_turns"] <= 0 and d.get("def"):
                d["def"] = 0
                self._log(events, f"✨ {p['name']} 的降防效果结束，DEF 恢复", "info")
                events.append({"type": "status_clear", "side": side, "key": "def"})
        if d.get("spd_turns", 0) > 0:
            d["spd_turns"] -= 1
            if d["spd_turns"] <= 0 and d.get("spd"):
                d["spd"] = 0
                self._log(events, f"✨ {p['name']} 的减速效果结束，SPD 恢复", "info")
                events.append({"type": "status_clear", "side": side, "key": "spd"})

        events.append({"type": "turn_end", "side": side})

        if st["order_step"] == 0:
            st["order_step"] = 1
            nxt = st["turn_order"][1]
            self._begin_turn(nxt, events)
        else:
            st["round"] += 1
            self._start_round(events)

        events.append({"type": "state", "state": self.public_state()})
        return events

    # ==================================================================
    # AI
    # ==================================================================
    def ai_step(self) -> list[dict]:
        """执行 AI 的一个动作；AI 无牌可出则结束回合。前端循环调用直到收到 ai_done。"""
        st = self.state
        events: list[dict] = []
        if st["phase"] != "active":
            return [{"type": "ai_done", "side": 1, "over": True}]
        if st["active"] != 1:
            return [{"type": "ai_done", "side": 1}]
        # 自愈：万一状态里 await_ai 标记丢了（旧存档 / 上一版前端），这里补上
        if not st["await_ai"]:
            st["await_ai"] = True

        pick = self._ai_choose(self.p[1], self.p[0])
        if not pick:
            events.extend(self.end_turn())
        else:
            events.extend(self.play_card(1, pick[0], pick[1]))
            # 出牌后若已无牌可出，直接收尾（原版 AI 也是这样一气打完）
            if st["phase"] == "active" and not self._ai_choose(self.p[1], self.p[0]):
                events.extend(self.end_turn())

        # 关键：end_turn 可能把新回合的先手又给了 AI（同速），此时不能谎报 ai_done
        if st["phase"] == "over" or st["active"] == 0:
            st["await_ai"] = False
            st["ai_done"] = True
            events.append({"type": "ai_done", "side": 1})
        events.append({"type": "state", "state": self.public_state()})
        return events

    def _ai_choose(self, ai: dict, human: dict):
        playable = []
        for c in ai["hand"]:
            if c.get("locked") or c["cost"] > ai["mana"]:
                continue
            sc = c.get("script") or ""
            if sc == "clear_guards" and (ai["flags"]["clear_played"] or not human["guards"]):
                continue
            if sc == "steal_copy" and (ai["flags"]["steal_copy_used"] or not human["hand"]):
                continue
            if sc == "mind_take" and not human["hand"]:
                continue
            if sc == "cleanse" and not (ai["debuffs"].get("def") or ai["debuffs"].get("spd")
                                        or ai["debuffs"].get("mana_penalty")):
                continue
            if sc == "heal" and ai["hp"] >= ai["max_hp"] - 1:
                continue
            if sc in ("buff_def", "buff_def_draw") and _eff_def(ai) >= 14:
                continue
            playable.append(c)
        if not playable:
            return None

        # 1) 有负面先净化
        for c in playable:
            if c.get("script") == "cleanse":
                return c["uid"], None
        # 2) 对方守卫多则清场
        total_guard_hp = sum(g["hp"] for g in human["guards"])
        for c in playable:
            if c.get("script") == "clear_guards" and (len(human["guards"]) >= 2 or total_guard_hp >= 4):
                return c["uid"], None
        # 3) 血量吃紧先续命
        if ai["hp"] <= ai["max_hp"] * 0.65:
            for c in playable:
                if c.get("script") in ("heal", "heal_def", "def_heal"):
                    return c["uid"], None
        # 4) 干扰 / 偷牌优先
        for c in playable:
            if c.get("script") in ("mind_take", "steal_copy", "mana_penalty", "def_down", "spd_down"):
                return c["uid"], None
        # 5) 否则打费用最高、数值最大的
        playable.sort(key=lambda c: (c["cost"], c["value"] * c["hits"]), reverse=True)
        chosen = playable[0]
        target = human["guards"][0]["uid"] if human["guards"] else None
        return chosen["uid"], target

    # ==================================================================
    # 结束判定
    # ==================================================================
    def _check_over(self, events: list) -> bool:
        st = self.state
        if st["phase"] != "active":
            return True
        p0, p1 = self.p
        if p0["hp"] > 0 and p1["hp"] > 0:
            return False
        st["phase"] = "over"
        st["await_ai"] = False
        winner = 1 if p0["hp"] <= 0 else 0
        st["winner"] = winner
        self._log(events, f"=== 对决结束：{self.p[winner]['name']} 获胜 ===", "info")
        events.append({"type": "game_over", "winner": winner,
                       "winner_name": self.p[winner]["name"],
                       "round": st["round"]})
        self._say(events, "victory", winner)
        self._say(events, "defeat", 1 - winner)
        events.append({"type": "state", "state": self.public_state()})
        return True

    # ==================================================================
    # 手动情感
    # ==================================================================
    def emote(self, side: int, code: str) -> list[dict]:
        events: list[dict] = []
        emo = self.emotions.get(code)
        if not emo:
            return [{"type": "error", "text": "情感不存在"}]
        line = emo.get("player_line") if side == 0 else emo.get("ai_line")
        events.append({
            "type": "emotion", "side": side, "code": code,
            "name": emo.get("name"), "tag": emo.get("tag"),
            "color": emo.get("color"), "line": line or "",
            "speaker": self.p[side]["name"], "flash": True,
        })
        # AI 用 reply_codes 回敬一句（随机）
        if side == 0 and self.state["phase"] == "active":
            replies = emo.get("reply_codes") or []
            if replies:
                rid = random.choice(replies)
                r = self.emotions.get(rid)
                if r:
                    events.append({
                        "type": "emotion", "side": 1, "code": rid,
                        "name": r.get("name"), "tag": r.get("tag"),
                        "color": r.get("color"), "line": r.get("ai_line") or "",
                        "speaker": self.p[1]["name"], "flash": True, "reply": True,
                    })
        return events

    # ==================================================================
    # 对前端暴露的状态（不含双方牌库顺序等隐藏信息）
    # ==================================================================
    def public_state(self) -> dict:
        st = self.state
        out = {k: v for k, v in st.items() if k not in ("players", "log", "dialogue_used")}
        players = []
        for p in st["players"]:
            players.append({
                "side": p["side"], "name": p["name"], "class_code": p["class_code"],
                "class_name": p["class_name"], "hero_name": p["hero_name"],
                "portrait": p["portrait"], "character_id": p["character_id"],
                "is_ai": p["is_ai"],
                "hp": p["hp"], "max_hp": p["max_hp"],
                "defense": _eff_def(p), "defense_raw": p["defense"],
                "spd": _eff_spd(p), "base_spd": p["base_spd"], "cri": p["cri"],
                "mana": p["mana"], "max_mana": p["max_mana"],
                "hand": [self._card_view(c) for c in p["hand"]],
                "hand_count": len(p["hand"]),
                "deck_count": len(p["deck"]),
                "guards": p["guards"],
                "flags": p["flags"],
                "debuffs": p["debuffs"],
            })
        out["players"] = players
        out["enemy_hand_count"] = len(st["players"][1]["hand"])
        return out

    @staticmethod
    def _card_view(c: dict) -> dict:
        return {k: c.get(k) for k in (
            "uid", "code", "name", "cost", "category", "category_label", "class_label",
            "value", "hits", "desc", "art", "locked", "needs_target", "script",
        )}

    def to_json(self) -> str:
        return json.dumps(self.state, ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: str, *, cards, rules, emotions) -> "CardBattle":
        return cls(json.loads(raw), cards=cards, rules=rules, emotions=emotions)
