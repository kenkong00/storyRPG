"""
回合制战斗引擎 v2 —— 数据驱动、服务端权威、可扩展。

设计要点
--------
1. **行动条（ATB / 行动值）驱动**：每个单位根据 speed 获得"下次行动所需的行动值"，
   行动值归零者出手；速度越快出手越频繁。前端可预览接下来的行动顺序。
2. **状态机 + 事件流**：引擎只操作一个可 JSON 序列化的 `state`，
   每次推进返回一组 `events`（技能/伤害/治疗/状态/倒下/台词/结算…），
   前端按事件流播放动画，因此表现层与规则层完全解耦。
3. **技能即数据**：技能用 `effects` 列表描述（多段伤害、治疗、增益、减益、
   持续伤害、护盾、控制、吸血、清debuff、复活…）。加新技能不需要改代码。
4. **战斗中也能讲故事**：banter（战前/血量阈值/队友倒下/Boss阶段/胜负）台词
   由 config 驱动；Boss 支持分阶段（换技能、换属性、插台词）。
5. **成长闭环**：胜利结算经验、掉落、升级、境界突破、自动学技能。

本模块不依赖数据库，方便单测；DB 读写由 router 负责。
"""
from __future__ import annotations

import json
import math
import random
from typing import Any, Iterable

# ======================================================================
# 常量
# ======================================================================

BASE_AV = 10000.0          # 行动值基准：av = BASE_AV / speed
RAGE_MAX = 100             # 怒气上限

RAGE_ON_HIT_DEALT = 12     # 造成伤害获得怒气
RAGE_ON_TAKEN = 8          # 受到伤害获得怒气
RAGE_ON_DEFEND = 25        # 防御获得怒气
RAGE_ON_TURN = 6           # 每到自己回合获得怒气
RAGE_ON_ALLY_DOWN = 15     # 队友倒下获得怒气

DEFEND_REDUCTION = 0.45    # 防御减伤
CRIT_MULT = 1.6            # 暴击倍率
ULTIMATE_RAGE_COST = 100   # 绝招怒气消耗

VARIANCE = (0.92, 1.08)    # 伤害浮动

ELEMENTS = ["none", "fire", "water", "wind", "earth", "light", "dark"]
ELEMENT_NAMES = {
    "none": "无", "fire": "火", "water": "水", "wind": "风",
    "earth": "土", "light": "光", "dark": "暗",
}
# 火→风→土→水→火；光↔暗互克
ELEMENT_CHART = {
    "fire": {"wind": 1.5, "water": 0.75},
    "wind": {"earth": 1.5, "fire": 0.75},
    "earth": {"water": 1.5, "wind": 0.75},
    "water": {"fire": 1.5, "earth": 0.75},
    "light": {"dark": 1.5},
    "dark": {"light": 1.5},
}

STAT_NAMES = {
    "attack": "攻击", "defense": "防御", "speed": "速度",
    "luck": "幸运", "crit": "暴击",
}

# 状态图标/配色（前端直接用，避免前端再维护一份）
STATUS_STYLE = {
    "poison": ("☠", "#8ef58e"), "burn": ("🔥", "#ff9b52"), "bleed": ("🩸", "#ff6b6b"),
    "regen": ("✚", "#7ee7a5"), "shield": ("🛡", "#6cc8ff"),
    "stun": ("💫", "#ffd76b"), "freeze": ("❄", "#8fd7ff"), "silence": ("🔇", "#c9b3ff"),
    "atk_up": ("▲", "#ff8f6b"), "atk_down": ("▼", "#8fa9c9"),
    "def_up": ("▲", "#6cb6ff"), "def_down": ("▼", "#b09a8f"),
    "spd_up": ("▲", "#9ef0b0"), "spd_down": ("▼", "#b9a0d8"),
    "taunt": ("😠", "#ffcf6b"), "curse": ("👁", "#c58fff"),
}

TARGET_ALLIES = ("self", "single_ally", "all_allies")
TARGET_ENEMIES = ("single_enemy", "all_enemies")


# ======================================================================
# 小工具
# ======================================================================

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _num(v, default=0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _loads(v, default=None):
    if isinstance(v, (list, dict)):
        return v
    if not v:
        return default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def _uid_for(side: str, index: int) -> str:
    return f"{'p' if side == 'player' else 'e'}{index}"


# ======================================================================
# 单位构建
# ======================================================================

def normalize_skill(raw: dict) -> dict:
    """把 DB / 配置里的技能规范化成引擎技能。

    `power` 语义：百分比倍率，100 = 1.0 倍攻击力。
    旧数据没有 `effects` 时，用老的 power(小整数) 换算成倍率，保证向后兼容。
    """
    effects = _loads(raw.get("effects"))
    legacy = not effects
    if legacy:
        p = _num(raw.get("power"), 10)
        # 旧数据 power 常见 5~50，视作"额外固定加成"；换算为 100 + power*5 的倍率
        pct = 100 + p * 5
        effects = [{
            "kind": "damage",
            "power": pct,
            "element": raw.get("element") or "none",
            "hits": int(_num(raw.get("hits"), 1) or 1),
            "scale": raw.get("scale") or "attack",
        }]
        se = _loads(raw.get("status_effect"))
        if isinstance(se, list):
            effects.extend(se)

    return {
        "id": raw.get("id"),
        "name": raw.get("name") or "攻击",
        "skill_type": raw.get("skill_type") or "physical",
        "element": raw.get("element") or "none",
        "mp_cost": int(_num(raw.get("mp_cost"))),
        "hp_cost": int(_num(raw.get("hp_cost"))),
        "rage_cost": int(_num(raw.get("rage_cost"))),
        "accuracy": _num(raw.get("accuracy"), 100),
        "critical_rate": _num(raw.get("critical_rate"), 5),
        "target_type": raw.get("target_type") or "single_enemy",
        "is_ultimate": int(_num(raw.get("is_ultimate"))),
        "cooldown": int(_num(raw.get("cooldown"))),
        "hits": int(_num(raw.get("hits"), 1) or 1),
        "image": raw.get("image") or "",
        "description": raw.get("description") or "",
        "visual_effect": raw.get("visual_effect") or "",
        "effects": effects,
        "legacy": legacy,
    }


def make_unit(
    *,
    uid: str,
    side: str,
    name: str,
    character_id: int | None = None,
    user_character_id: int | None = None,
    level: int = 1,
    realm_name: str = "",
    hp: float = 100,
    max_hp: float = 100,
    mp: float = 50,
    max_mp: float = 50,
    attack: float = 10,
    defense: float = 5,
    speed: float = 5,
    luck: float = 5,
    element: str = "none",
    portrait: str = "",
    states: dict | None = None,
    art: dict | None = None,
    skills: list | None = None,
    items: list | None = None,
    ai: dict | None = None,
    drops: list | None = None,
    phases: list | None = None,
    exp_reward: float | None = None,
    is_boss: bool = False,
    is_ally: bool = False,
) -> dict:
    spd = max(1.0, _num(speed, 5))
    return {
        "uid": uid,
        "side": side,
        "name": name,
        "character_id": character_id,
        "user_character_id": user_character_id,
        "level": int(_num(level, 1)),
        "realm_name": realm_name or "",
        "element": element or "none",
        "portrait": portrait or "",
        "states": states or {},
        # 美术资源包（立绘 / 损血档位 / 动作图），由路由层从 character_states 与
        # expressions 归一化后传入；前端只按 mode + 血量取图，不需要懂后台结构。
        "art": art or {},
        "is_boss": bool(is_boss),
        "is_ally": bool(is_ally),
        # 基础属性
        "base": {
            "max_hp": _num(max_hp, 100), "max_mp": _num(max_mp, 50),
            "attack": _num(attack, 10), "defense": _num(defense, 5),
            "speed": spd, "luck": _num(luck, 5),
        },
        # 当前值
        "hp": _num(hp, _num(max_hp, 100)),
        "mp": _num(mp, _num(max_mp, 50)),
        "rage": 0,
        "shield": 0,
        "statuses": [],
        "defending": False,
        "alive": True,
        "av": BASE_AV / spd,
        "actions": 0,
        "skills": [normalize_skill(s) for s in (skills or [])],
        "items": items or [],
        "cooldowns": {},
        "ai": ai or {},
        "drops": drops or [],
        "exp_reward": _num(exp_reward, 0) or None,
        "phases": phases or [],
        "phase": 0,
        "phase_name": "",
        "_fired_banter": [],
    }


# ======================================================================
# 属性计算（含增益/减益）
# ======================================================================

def _status_bonus(unit: dict, stat: str, mode: str) -> float:
    total = 0.0
    for st in unit.get("statuses", []):
        if st.get("kind") != mode:
            continue
        if st.get("stat") != stat:
            continue
        total += _num(st.get("value")) * int(_num(st.get("stacks"), 1) or 1)
    return total


def eff_stat(unit: dict, stat: str, base: bool = False) -> float:
    """有效属性 = 基础 × (1 + 百分比修正)。base=True 时只取基础值。"""
    raw = _num(unit.get("base", {}).get(stat, 0))
    if base:
        return raw
    up = _status_bonus(unit, stat, "buff")
    down = _status_bonus(unit, stat, "debuff")
    return max(1.0, raw * (1.0 + (up + down) / 100.0))


def has_status(unit: dict, key: str) -> bool:
    return any(s.get("key") == key for s in unit.get("statuses", []))


def max_hp(unit: dict) -> float:
    return eff_stat(unit, "max_hp")


def max_mp(unit: dict) -> float:
    return eff_stat(unit, "max_mp")


def add_status(unit: dict, st: dict) -> dict | None:
    """添加状态；同名状态叠加层数并刷新回合（控制类不叠加）。"""
    key = st.get("key")
    if not key:
        return None
    kind = st.get("kind", "debuff")
    icon, color = STATUS_STYLE.get(key, ("◆", "#dddddd"))
    st = {
        "key": key,
        "name": st.get("name") or key,
        "kind": kind,
        "stat": st.get("stat"),
        "value": _num(st.get("value")),
        "turns": int(_num(st.get("turns"), 3) or 3),
        "stacks": int(_num(st.get("stacks"), 1) or 1),
        "source_uid": st.get("source_uid"),
        "icon": st.get("icon") or icon,
        "color": st.get("color") or color,
        "note": st.get("note") or "",
    }
    if st["kind"] in ("control",):
        # 控制类：不可叠加，取更长回合
        for old in unit["statuses"]:
            if old.get("key") == key:
                old["turns"] = max(old["turns"], st["turns"])
                return old
        unit["statuses"].append(st)
        return st
    for old in unit["statuses"]:
        if old.get("key") == key and old.get("stat") == st.get("stat"):
            old["stacks"] = min(9, int(old["stacks"]) + st["stacks"])
            old["turns"] = max(old["turns"], st["turns"])
            old["value"] = st["value"] if st["value"] else old["value"]
            return old
    unit["statuses"].append(st)
    return st


def remove_status(unit: dict, key: str, count: int = 99) -> int:
    removed = 0
    kept = []
    for st in unit.get("statuses", []):
        if st.get("key") == key and removed < count and st.get("kind") in ("debuff", "dot", "control"):
            removed += 1
            continue
        kept.append(st)
    unit["statuses"] = kept
    return removed


# ======================================================================
# 状态（state）构建与查询
# ======================================================================

def create_state(
    units: list[dict],
    config: dict | None = None,
    meta: dict | None = None,
) -> dict:
    cfg = {
        "difficulty": 1.0,
        "allow_flee": True,
        "auto_banter": True,
        "exp_multiplier": 1.0,
        "background": "",
        "bgm": "",
        "victory_node_id": None,
        "defeat_node_id": None,
        "flee_node_id": None,
        "defeat_penalty": "half_hp",
    }
    cfg.update(config or {})
    # 开战快照：前端播放事件流时需要知道"从多少血开始演"
    for u in units:
        u.setdefault("start_hp", u.get("hp"))
        u.setdefault("start_mp", u.get("mp"))
        u.setdefault("start_rage", u.get("rage", 0))
    return {
        "v": 2,
        "status": "active",           # active / player_won / enemy_won / fled
        "round": 1,
        "turn_no": 0,
        "turn_uid": None,             # 等待哪个单位输入
        "units": units,
        "log": [],
        "banter": [],
        "rewards": None,
        "order": [],
        "config": cfg,
        "meta": meta or {},
        "finished": False,
    }


def unit_by_uid(state: dict, uid: str) -> dict | None:
    for u in state["units"]:
        if u["uid"] == uid:
            return u
    return None


def alive_units(state: dict, side: str | None = None) -> list[dict]:
    out = [u for u in state["units"] if u.get("alive")]
    if side:
        out = [u for u in out if u["side"] == side]
    return out


def _enemies_of(state: dict, unit: dict) -> list[dict]:
    other = "enemy" if unit["side"] == "player" else "player"
    return alive_units(state, other)


def _allies_of(state: dict, unit: dict) -> list[dict]:
    return alive_units(state, unit["side"])


def is_player_controlled(state: dict, unit: dict) -> bool:
    """该单位本回合是否需要玩家手动下令。

    三种情况交给 AI：
      - 敌方单位；
      - 整场开启了自动战斗（config.auto_battle）；
      - 单位自身带 ai.auto 标记（例如跟随的同伴，玩家不必逐个操作）。
    """
    if unit["side"] != "player":
        return False
    if state["config"].get("auto_battle"):
        return False
    if (unit.get("ai") or {}).get("auto"):
        return False
    return True


# ======================================================================
# 行动顺序
# ======================================================================

def _next_av(unit: dict) -> float:
    return BASE_AV / max(1.0, eff_stat(unit, "speed"))


def _tick_av(state: dict, amount: float) -> None:
    for u in alive_units(state):
        u["av"] -= amount


def pick_actor(state: dict) -> dict | None:
    pool = alive_units(state)
    if not pool:
        return None
    actor = min(pool, key=lambda u: (u["av"], -eff_stat(u, "speed")))
    _tick_av(state, actor["av"])
    actor["av"] = _next_av(actor)
    return actor


def preview_order(state: dict, count: int = 8) -> list[dict]:
    """模拟接下来的行动顺序（不改变真实状态）。"""
    sim = [(u["uid"], u["av"], eff_stat(u, "speed"), u["name"], u["side"]) for u in alive_units(state)]
    out = []
    for _ in range(count):
        if not sim:
            break
        idx = min(range(len(sim)), key=lambda i: (sim[i][1], -sim[i][2]))
        uid, av, spd, name, side = sim[idx]
        cost = av
        sim = [(a, b - cost, c, d, e) for (a, b, c, d, e) in sim]
        out.append({"uid": uid, "name": name, "side": side})
        sim[idx] = (uid, BASE_AV / max(1.0, spd), spd, name, side)
    return out


# ======================================================================
# 事件辅助
# ======================================================================

def _log(state: dict, text: str, kind: str = "info") -> None:
    state["log"].append({"kind": kind, "text": text})
    if len(state["log"]) > 200:
        del state["log"][: len(state["log"]) - 200]


def _ev(events: list, kind: str, **kw) -> dict:
    ev = {"t": kind}
    ev.update(kw)
    events.append(ev)
    return ev


def _line(state: dict, events: list, speaker: str, text: str,
          expression: str = "", speaker_id: int | None = None) -> None:
    _log(state, f"{speaker}：「{text}」", "banter")
    _ev(events, "banter", speaker=speaker, speaker_id=speaker_id,
        line=text, expression=expression)


# ======================================================================
# 伤害 / 治疗
# ======================================================================

def _element_mult(attack_element: str, defender_element: str) -> float:
    row = ELEMENT_CHART.get(attack_element or "none", {})
    return float(row.get(defender_element or "none", 1.0))


def _crit_chance(attacker: dict, defender: dict, extra: float = 0) -> float:
    base = 5 + eff_stat(attacker, "luck") * 0.6 - eff_stat(defender, "luck") * 0.25 + _num(extra)
    return _clamp(base, 2.0, 60.0)


def _scale_value(unit: dict, scale: str) -> float:
    if scale == "max_hp":
        return eff_stat(unit, "max_hp")
    if scale == "max_mp":
        return eff_stat(unit, "max_mp")
    if scale == "defense":
        return eff_stat(unit, "defense")
    if scale == "speed":
        return eff_stat(unit, "speed")
    return eff_stat(unit, "attack")


def compute_damage(
    attacker: dict,
    defender: dict,
    power_pct: float,
    *,
    element: str = "none",
    scale: str = "attack",
    crit_bonus: float = 0,
    rng: random.Random | None = None,
) -> dict:
    rng = rng or random
    atk = _scale_value(attacker, scale)
    dfn = eff_stat(defender, "defense")
    level = max(1, int(_num(attacker.get("level"), 1)))

    raw = atk * (_num(power_pct, 100) / 100.0)
    mitigation = dfn / (dfn + 50.0 + 10.0 * level)
    dmg = raw * (1.0 - mitigation)

    em = _element_mult(element, defender.get("element", "none"))
    dmg *= em

    crit_rate = _crit_chance(attacker, defender, crit_bonus)
    is_crit = rng.randint(1, 1000) <= int(crit_rate * 10)
    if is_crit:
        dmg *= CRIT_MULT

    if defender.get("defending"):
        dmg *= (1.0 - DEFEND_REDUCTION)
    if has_status(defender, "freeze"):
        dmg *= 1.1

    dmg *= rng.uniform(*VARIANCE)
    dmg = max(1.0, dmg)
    return {
        "damage": dmg,
        "crit": is_crit,
        "element_mult": em,
        "weak": em > 1.0,
        "resist": em < 1.0,
    }


def compute_heal(caster: dict, power_pct: float, scale: str = "attack") -> float:
    base = _scale_value(caster, scale)
    return max(1.0, base * (_num(power_pct, 100) / 100.0))


def _apply_damage(state: dict, events: list, target: dict, amount: float,
                  *, crit: bool = False, weak: bool = False, resist: bool = False,
                  source: dict | None = None, element: str = "none") -> float:
    """扣血（先吃护盾）。返回真正扣掉的血量。"""
    amount = max(0.0, amount)
    absorbed = 0.0
    if target.get("shield", 0) > 0:
        absorbed = min(target["shield"], amount)
        target["shield"] -= absorbed
        amount -= absorbed
        if absorbed:
            _ev(events, "shield", uid=target["uid"], absorbed=round(absorbed),
                shield=round(target["shield"]))
    amount = max(0.0, amount)
    target["hp"] = max(0.0, target["hp"] - amount)
    _ev(events, "damage", uid=target["uid"], value=round(amount), crit=bool(crit),
        weak=weak, resist=resist, element=element, hp=round(target["hp"]),
        shield_absorbed=round(absorbed))
    if source is not None:
        source["rage"] = min(RAGE_MAX, source["rage"] + RAGE_ON_HIT_DEALT)
    target["rage"] = min(RAGE_MAX, target["rage"] + RAGE_ON_TAKEN)
    return amount


def _apply_heal(state: dict, events: list, target: dict, amount: float) -> float:
    if not target.get("alive"):
        return 0.0
    before = target["hp"]
    target["hp"] = min(max_hp(target), target["hp"] + max(0.0, amount))
    healed = target["hp"] - before
    _ev(events, "heal", uid=target["uid"], value=round(healed), hp=round(target["hp"]))
    return healed


# ======================================================================
# 目标选择
# ======================================================================

def resolve_targets(state: dict, actor: dict, target_type: str,
                    target_uid: str | None = None) -> list[dict]:
    if target_type in ("self",):
        return [actor]
    if target_type == "all_enemies":
        return _enemies_of(state, actor)
    if target_type == "all_allies":
        return _allies_of(state, actor)
    if target_type == "single_ally":
        if target_uid:
            t = unit_by_uid(state, target_uid)
            if t and t.get("alive"):
                return [t]
        # 默认治愈血量比例最低的队友
        pool = _allies_of(state, actor)
        return [min(pool, key=lambda u: u["hp"] / max(1.0, max_hp(u)))] if pool else []
    # single_enemy
    if target_uid:
        t = unit_by_uid(state, target_uid)
        if t and t.get("alive") and t["side"] != actor["side"]:
            return [t]
    pool = _enemies_of(state, actor)
    return [pool[0]] if pool else []


# ======================================================================
# 技能 / 效果执行
# ======================================================================

def _skill_usable(actor: dict, skill: dict) -> tuple[bool, str]:
    if skill.get("is_ultimate") and actor["rage"] < ULTIMATE_RAGE_COST:
        return False, f"怒气不足（需要 {ULTIMATE_RAGE_COST}）"
    if _num(skill.get("mp_cost")) > actor["mp"]:
        return False, "MP 不足"
    if _num(skill.get("hp_cost")) > actor["hp"] - 1:
        return False, "生命不足"
    cd = actor.get("cooldowns", {}).get(str(skill.get("id")))
    if cd:
        return False, f"冷却中（{cd}）"
    if skill.get("is_ultimate") and has_status(actor, "silence"):
        return False, "被沉默，无法使用绝招"
    return True, ""


def _apply_effect(state: dict, events: list, actor: dict, effect: dict,
                  target_type: str, target_uid: str | None, skill: dict,
                  rng: random.Random | None = None) -> None:
    kind = effect.get("kind")
    eff_target_type = effect.get("target") or target_type

    if kind == "damage":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        hits = max(1, int(_num(effect.get("hits"), skill.get("hits") or 1) or 1))
        element = effect.get("element") or skill.get("element") or "none"
        scale = effect.get("scale") or "attack"
        total = 0.0
        last: dict | None = None
        for _ in range(hits):
            for t in targets:
                if not t.get("alive"):
                    continue
                res = compute_damage(actor, t, _num(effect.get("power"), 100),
                                     element=element, scale=scale,
                                     crit_bonus=_num(skill.get("critical_rate"), 5) - 5,
                                     rng=rng)
                dealt = _apply_damage(state, events, t, res["damage"],
                                      crit=res["crit"], weak=res["weak"],
                                      resist=res["resist"], source=actor, element=element)
                total += dealt
                last = res
        if targets:
            names = "、".join(t["name"] for t in targets)
            extra = ""
            if last and last["crit"]:
                extra = "（暴击！）"
            elif last and last["weak"]:
                extra = "（克制！）"
            elif last and last["resist"]:
                extra = "（被抵抗）"
            _log(state, f"{actor['name']} 使用【{skill['name']}】对 {names} 造成 {round(total)} 点伤害{extra}", "damage")
        # 吸血
        drain = _num(effect.get("drain"))
        if drain > 0 and total > 0:
            _apply_heal(state, events, actor, total * drain / 100.0)

    elif kind == "heal":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        amount = effect.get("value")
        for t in targets:
            if amount is None:
                heal = compute_heal(actor, _num(effect.get("power"), 100),
                                    effect.get("scale") or "attack")
            else:
                heal = _num(amount)
            healed = _apply_heal(state, events, t, heal)
            if healed:
                _log(state, f"{actor['name']} 为 {t['name']} 恢复 {round(healed)} 点生命", "heal")

    elif kind == "restore_mp":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        for t in targets:
            before = t["mp"]
            t["mp"] = min(max_mp(t), t["mp"] + _num(effect.get("value")))
            _ev(events, "mp", uid=t["uid"], delta=round(t["mp"] - before), mp=round(t["mp"]))
            _log(state, f"{t['name']} 恢复 {round(t['mp'] - before)} 点灵力", "heal")

    elif kind in ("buff", "debuff"):
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        stat = effect.get("stat") or "attack"
        chance = effect.get("chance")
        for t in targets:
            if not t.get("alive"):
                continue
            if chance is not None and (rng or random).randint(1, 100) > _num(chance):
                _ev(events, "resist_status", uid=t["uid"], name=effect.get("name") or "")
                continue
            key = effect.get("key") or f"{stat}_{'up' if kind == 'buff' else 'down'}"
            st = add_status(t, {
                "key": key, "name": effect.get("name") or STAT_NAMES.get(stat, stat) + ("提升" if kind == "buff" else "降低"),
                "kind": kind, "stat": stat, "value": _num(effect.get("value"), 20),
                "turns": int(_num(effect.get("turns"), 3)), "stacks": 1,
                "source_uid": actor["uid"],
            })
            if st:
                _ev(events, "status_add", uid=t["uid"], status=st)
                _log(state, f"{t['name']} 获得状态【{st['name']}】（{st['turns']} 回合）", "status")

    elif kind == "dot":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        key = effect.get("key") or "poison"
        for t in targets:
            if not t.get("alive"):
                continue
            mode = effect.get("mode") or "caster_attack_pct"
            value = _num(effect.get("value"), 15)
            st = add_status(t, {
                "key": key, "name": effect.get("name") or {"poison": "中毒", "burn": "灼烧", "bleed": "流血", "curse": "诅咒"}.get(key, key),
                "kind": "dot", "value": value, "turns": int(_num(effect.get("turns"), 3)),
                "mode": mode, "source_uid": actor["uid"],
            })
            if st:
                _ev(events, "status_add", uid=t["uid"], status=st)
                _log(state, f"{t['name']} 陷入【{st['name']}】", "status")

    elif kind == "hot":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        for t in targets:
            st = add_status(t, {
                "key": effect.get("key") or "regen",
                "name": effect.get("name") or "回复",
                "kind": "hot", "value": _num(effect.get("value"), 10),
                "turns": int(_num(effect.get("turns"), 3)), "mode": effect.get("mode") or "flat",
                "source_uid": actor["uid"],
            })
            if st:
                _ev(events, "status_add", uid=t["uid"], status=st)

    elif kind == "shield":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        for t in targets:
            amount = effect.get("value")
            if amount is None:
                amount = _num(effect.get("power"), 50) / 100.0 * eff_stat(actor, "max_hp")
            t["shield"] = t.get("shield", 0) + _num(amount)
            st = add_status(t, {
                "key": "shield", "name": effect.get("name") or "护盾", "kind": "shield",
                "turns": int(_num(effect.get("turns"), 3)), "value": 0,
            })
            _ev(events, "shield_add", uid=t["uid"], shield=round(t["shield"]))
            _log(state, f"{t['name']} 获得 {round(_num(amount))} 点护盾", "status")

    elif kind == "control":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        ctrl = effect.get("control") or "stun"
        for t in targets:
            chance = _num(effect.get("chance"), 70)
            if (rng or random).randint(1, 100) > chance:
                _ev(events, "resist_status", uid=t["uid"], name=ctrl)
                continue
            st = add_status(t, {
                "key": ctrl, "name": effect.get("name") or {"stun": "眩晕", "freeze": "冰冻", "silence": "沉默"}.get(ctrl, ctrl),
                "kind": "control", "turns": int(_num(effect.get("turns"), 1)),
                "source_uid": actor["uid"],
            })
            if st:
                _ev(events, "status_add", uid=t["uid"], status=st)
                _log(state, f"{t['name']} 被【{st['name']}】", "status")

    elif kind == "cleanse":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        count = int(_num(effect.get("count"), 1) or 1)
        for t in targets:
            removed = 0
            for key in ("poison", "burn", "bleed", "curse", "stun", "freeze", "silence",
                        "atk_down", "def_down", "spd_down"):
                if removed >= count:
                    break
                removed += remove_status(t, key, count - removed)
            if removed:
                _ev(events, "cleanse", uid=t["uid"], count=removed)
                _log(state, f"{t['name']} 清除了 {removed} 个负面状态", "status")

    elif kind == "rage":
        targets = resolve_targets(state, actor, eff_target_type, target_uid)
        for t in targets:
            t["rage"] = _clamp(t["rage"] + _num(effect.get("value")), 0, RAGE_MAX)
            _ev(events, "rage", uid=t["uid"], value=round(t["rage"]))

    elif kind == "revive":
        targets = [u for u in state["units"] if u["side"] == actor["side"] and not u.get("alive")]
        for t in targets[:1]:
            t["alive"] = True
            t["hp"] = max(1.0, max_hp(t) * _num(effect.get("power"), 30) / 100.0)
            t["statuses"] = [s for s in t["statuses"] if s.get("kind") != "dot"]
            _ev(events, "revive", uid=t["uid"], hp=round(t["hp"]))
            _log(state, f"{t['name']} 重新站了起来！", "heal")


def use_skill(state: dict, events: list, actor: dict, skill: dict,
              target_uid: str | None = None, rng: random.Random | None = None) -> None:
    # 消耗
    if skill.get("mp_cost"):
        actor["mp"] = max(0.0, actor["mp"] - _num(skill["mp_cost"]))
        _ev(events, "mp", uid=actor["uid"], delta=-int(_num(skill["mp_cost"])), mp=round(actor["mp"]))
    if skill.get("hp_cost"):
        actor["hp"] = max(1.0, actor["hp"] - _num(skill["hp_cost"]))
        _ev(events, "damage", uid=actor["uid"], value=int(_num(skill["hp_cost"])), self_cost=True, hp=round(actor["hp"]))
    if skill.get("is_ultimate"):
        actor["rage"] = 0
        _ev(events, "rage", uid=actor["uid"], value=0)
    if skill.get("cooldown"):
        actor.setdefault("cooldowns", {})[str(skill.get("id"))] = int(_num(skill["cooldown"]))
        _ev(events, "cooldown", uid=actor["uid"], skill_id=skill.get("id"), turns=skill.get("cooldown"))

    targets_preview = resolve_targets(state, actor, skill.get("target_type", "single_enemy"), target_uid)
    _ev(events, "cast", uid=actor["uid"], skill_id=skill.get("id"), skill=skill["name"],
        visual=skill.get("visual_effect") or "", element=skill.get("element") or "none",
        targets=[t["uid"] for t in targets_preview], ultimate=bool(skill.get("is_ultimate")))

    did_damage = False
    for eff in skill.get("effects", []):
        _apply_effect(state, events, actor, eff, skill.get("target_type", "single_enemy"),
                      target_uid, skill, rng=rng)
        if eff.get("kind") == "damage":
            did_damage = True

    # 命中判定（未命中的提示，简化：命中率只影响伤害类技能）
    if did_damage and _num(skill.get("accuracy"), 100) < 100:
        miss_chance = 100 - _num(skill.get("accuracy"), 100)
        if (rng or random).randint(1, 100) <= miss_chance:
            _ev(events, "miss", uid=actor["uid"], skill=skill["name"])
            _log(state, f"{actor['name']} 的【{skill['name']}】落空了！", "miss")


def use_item(state: dict, events: list, actor: dict, item: dict,
             target_uid: str | None = None) -> None:
    effects = _loads(item.get("effects")) or _loads(item.get("effect")) or []
    if isinstance(effects, dict):
        effects = [effects]
    if not effects:
        effects = [{"kind": "heal", "value": 50, "target": "self"}]
    _ev(events, "item", uid=actor["uid"], item_id=item.get("id"), item=item.get("name"))
    _log(state, f"{actor['name']} 使用了【{item.get('name')}】", "item")
    for eff in effects:
        _apply_effect(state, events, actor, eff, eff.get("target") or "self", target_uid,
                      {"name": item.get("name"), "element": "none", "critical_rate": 0, "id": None})


# ======================================================================
# 状态结算（回合开始/结束）
# ======================================================================

def _tick_statuses(state: dict, events: list, unit: dict, phase: str,
                   rng: random.Random | None = None) -> None:
    """phase: 'start' 处理 dot/hot 与控制；'end' 递减回合。"""
    if not unit.get("alive"):
        return
    if phase == "start":
        for st in list(unit.get("statuses", [])):
            if st.get("kind") == "dot":
                mode = st.get("mode") or "caster_attack_pct"
                value = _num(st.get("value"), 10) * int(_num(st.get("stacks"), 1) or 1)
                if mode == "caster_attack_pct":
                    src = unit_by_uid(state, st.get("source_uid") or "")
                    amount = (eff_stat(src, "attack") if src else 10) * value / 100.0
                elif mode == "max_hp_pct":
                    amount = max_hp(unit) * value / 100.0
                else:
                    amount = value
                amount = max(1.0, amount)
                unit["hp"] = max(0.0, unit["hp"] - amount)
                _ev(events, "damage", uid=unit["uid"], value=round(amount), dot=True,
                    status=st.get("key"), hp=round(unit["hp"]))
                _log(state, f"{unit['name']} 受到【{st['name']}】{round(amount)} 点伤害", "dot")
            elif st.get("kind") == "hot":
                amount = _num(st.get("value"), 10) * int(_num(st.get("stacks"), 1) or 1)
                _apply_heal(state, events, unit, amount)
    else:
        kept = []
        for st in unit.get("statuses", []):
            st["turns"] = int(_num(st.get("turns"), 1)) - 1
            if st["turns"] > 0:
                kept.append(st)
            else:
                _ev(events, "status_remove", uid=unit["uid"], key=st.get("key"))
        unit["statuses"] = kept
        if not any(s.get("key") == "shield" for s in unit["statuses"]):
            if unit.get("shield"):
                unit["shield"] = 0
                _ev(events, "shield_add", uid=unit["uid"], shield=0)


def _check_banter(state: dict, events: list, trigger: str, **ctx) -> None:
    cfg = state.get("config", {})
    if not cfg.get("auto_banter", True):
        return
    for idx, b in enumerate(cfg.get("banter") or []):
        if b.get("trigger") != trigger:
            continue
        key = f"{trigger}:{idx}"
        if key in state.setdefault("_fired", []):
            continue
        # 条件判断
        if "value" in b and trigger in ("hp_below", "round"):
            if trigger == "hp_below":
                uid = b.get("uid") or ctx.get("uid")
                u = unit_by_uid(state, uid) if uid else None
                if not u:
                    continue
                if u["hp"] / max(1.0, max_hp(u)) * 100 > _num(b["value"]):
                    continue
            else:
                if state["round"] < _num(b["value"]):
                    continue
        if b.get("uid") and ctx.get("uid") and b["uid"] != ctx.get("uid"):
            continue
        state["_fired"].append(key)
        _line(state, events, b.get("speaker") or "", b.get("line") or "",
              b.get("expression") or "", b.get("speaker_id"))


def _check_phase(state: dict, events: list, unit: dict) -> None:
    if not unit.get("phases"):
        return
    ratio = unit["hp"] / max(1.0, max_hp(unit)) * 100
    nxt = unit.get("phase", 0)
    for i, ph in enumerate(unit["phases"]):
        if ratio <= _num(ph.get("hp_below"), 0) and i + 1 > nxt:
            nxt = i + 1
    if nxt > unit.get("phase", 0):
        unit["phase"] = nxt
        ph = unit["phases"][nxt - 1]
        unit["phase_name"] = ph.get("name") or f"第{nxt}阶段"
        if ph.get("skills"):
            unit["skills"] = [normalize_skill(s) for s in ph["skills"]]
        if ph.get("buff"):
            st = add_status(unit, {
                "key": ph["buff"].get("key") or "atk_up",
                "name": ph["buff"].get("name") or "狂暴",
                "kind": "buff", "stat": ph["buff"].get("stat") or "attack",
                "value": _num(ph["buff"].get("value"), 50),
                "turns": int(_num(ph["buff"].get("turns"), 99)),
            })
            if st:
                _ev(events, "status_add", uid=unit["uid"], status=st)
        _ev(events, "phase", uid=unit["uid"], phase=nxt, name=unit["phase_name"])
        _log(state, f"{unit['name']} 进入【{unit['phase_name']}】！", "phase")
        if ph.get("line"):
            _line(state, events, unit["name"], ph["line"], ph.get("expression") or "",
                  unit.get("character_id"))


def _after_action(state: dict, events: list, actor: dict) -> None:
    """行动后：倒下判定、阶段切换、boss 台词。"""
    for u in state["units"]:
        if u.get("alive") and u["hp"] <= 0:
            u["alive"] = False
            u["statuses"] = []
            u["shield"] = 0
            _ev(events, "down", uid=u["uid"], name=u["name"], side=u["side"])
            _log(state, f"{u['name']} 倒下了！", "down")
            if u["side"] == actor["side"]:
                actor["rage"] = min(RAGE_MAX, actor["rage"] + RAGE_ON_ALLY_DOWN)
            _check_banter(state, events, "ally_down", uid=u["uid"])
        elif u.get("alive"):
            _check_phase(state, events, u)
            _check_banter(state, events, "hp_below", uid=u["uid"])


def _check_end(state: dict, events: list) -> bool:
    if state["status"] != "active":
        return True
    players = alive_units(state, "player")
    enemies = alive_units(state, "enemy")
    if not enemies:
        state["status"] = "player_won"
        state["finished"] = True
        _ev(events, "victory")
        _log(state, "战斗胜利！", "system")
        _check_banter(state, events, "victory")
        return True
    if not players:
        state["status"] = "enemy_won"
        state["finished"] = True
        _ev(events, "defeat")
        _log(state, "战斗失败…", "system")
        _check_banter(state, events, "defeat")
        return True
    return False


# ======================================================================
# 敌人 AI
# ======================================================================

def _ai_choose(state: dict, actor: dict, rng: random.Random | None = None) -> dict:
    rng = rng or random
    profile = actor.get("ai") or {}
    kind = profile.get("type") or "aggressive"
    if kind in ("player", "manual"):  # 玩家单位被自动接管时按均衡型处理
        kind = "balanced"
    skills = [s for s in actor.get("skills", []) if _skill_usable(actor, s)[0]]
    foes = _enemies_of(state, actor)
    allies = _allies_of(state, actor)

    # 治疗/辅助型：有人血量低时优先治疗
    heal_below = _num(profile.get("heal_below"), 45)
    if kind in ("support", "healer") and allies:
        worst = min(allies, key=lambda u: u["hp"] / max(1.0, max_hp(u)))
        if worst["hp"] / max(1.0, max_hp(worst)) * 100 < heal_below:
            heals = [s for s in skills if any(e.get("kind") == "heal" for e in s.get("effects", []))]
            if heals:
                return {"type": "skill", "skill_id": heals[0]["id"], "target_uid": worst["uid"]}
        buffs = [s for s in skills if any(e.get("kind") in ("buff", "shield") for e in s.get("effects", []))]
        if buffs and rng.random() < 0.5:
            return {"type": "skill", "skill_id": buffs[0]["id"], "target_uid": actor["uid"]}

    # 绝招：血量低/怒气满时倾泻
    ult = [s for s in skills if s.get("is_ultimate")]
    if ult and actor["rage"] >= ULTIMATE_RAGE_COST:
        threshold = _num(profile.get("ultimate_below_hp"), 100)
        if actor["hp"] / max(1.0, max_hp(actor)) * 100 <= max(threshold, 60):
            return {"type": "skill", "skill_id": ult[0]["id"], "target_uid": _pick_target(state, actor, ult[0], foes, rng)}

    # 按权重挑技能
    weights = profile.get("skill_weights") or {}
    pool = []
    for s in skills:
        if s.get("is_ultimate"):
            continue
        if any(e.get("kind") in ("heal",) for e in s.get("effects", [])) and kind not in ("support", "healer"):
            if any(u["hp"] / max(1.0, max_hp(u)) > 0.5 for u in allies):
                continue
        w = _num(weights.get(str(s.get("id"))), _num(profile.get("default_weight"), 1.0))
        if w > 0:
            pool.append((s, w))
    if pool and rng.random() <= _num(profile.get("skill_chance"), 0.75):
        total = sum(w for _, w in pool)
        r = rng.random() * total
        acc = 0.0
        for s, w in pool:
            acc += w
            if r <= acc:
                return {"type": "skill", "skill_id": s["id"],
                        "target_uid": _pick_target(state, actor, s, foes, rng)}

    # 血少时防御（非 boss）
    if not actor.get("is_boss") and actor["hp"] / max(1.0, max_hp(actor)) < 0.18 and rng.random() < 0.4:
        return {"type": "defend"}

    return {"type": "attack", "target_uid": _pick_target(state, actor, None, foes, rng)}


def _pick_target(state: dict, actor: dict, skill: dict | None,
                 foes: list[dict], rng: random.Random | None = None) -> str | None:
    if not foes:
        return None
    rng = rng or random
    profile = actor.get("ai") or {}
    ttype = (skill or {}).get("target_type", "single_enemy")
    if ttype in TARGET_ALLIES:
        allies = _allies_of(state, actor)
        if ttype == "self":
            return actor["uid"]
        if ttype == "single_ally":
            return min(allies, key=lambda u: u["hp"] / max(1.0, max_hp(u)))["uid"]
        return None
    if ttype == "all_enemies":
        return None
    if profile.get("prefer_lowest_hp", True):
        return min(foes, key=lambda u: u["hp"])["uid"]
    return rng.choice(foes)["uid"]


# ======================================================================
# 行动执行 & 主循环
# ======================================================================

def _begin_turn(state: dict, events: list, unit: dict, rng: random.Random | None = None) -> bool:
    """回合开始处理。返回 False 表示该单位本回合无法行动（眩晕等）。"""
    unit["actions"] = unit.get("actions", 0) + 1
    unit["defending"] = False
    state["turn_no"] += 1
    _ev(events, "turn_start", uid=unit["uid"], round=state["round"], no=state["turn_no"])
    _tick_statuses(state, events, unit, "start", rng)

    # 冷却递减
    cds = unit.get("cooldowns") or {}
    for k in list(cds.keys()):
        cds[k] = int(cds[k]) - 1
        if cds[k] <= 0:
            cds.pop(k, None)

    if not unit.get("alive"):
        return False
    unit["rage"] = min(RAGE_MAX, unit["rage"] + RAGE_ON_TURN)
    block = None
    for key in ("stun", "freeze"):
        if has_status(unit, key):
            block = key
            break
    if block:
        _ev(events, "skip", uid=unit["uid"], reason=block)
        _log(state, f"{unit['name']} 因【{'眩晕' if block == 'stun' else '冰冻'}】无法行动", "status")
        _tick_statuses(state, events, unit, "end", rng)
        return False
    return True


def _end_turn(state: dict, events: list, unit: dict, rng: random.Random | None = None) -> None:
    _tick_statuses(state, events, unit, "end", rng)


def perform_action(state: dict, events: list, actor: dict, action: dict,
                   rng: random.Random | None = None) -> None:
    if not _begin_turn(state, events, actor, rng):
        return

    atype = (action or {}).get("type") or "attack"
    target_uid = (action or {}).get("target_uid")

    if atype == "flee":
        if state["config"].get("allow_flee", True):
            flee_chance = 60 + eff_stat(actor, "speed") - _num((state.get("units") or [{}])[0].get("base", {}).get("speed"), 0)
            if (rng or random).randint(1, 100) <= _clamp(flee_chance, 25, 95):
                state["status"] = "fled"
                state["finished"] = True
                _ev(events, "flee_ok")
                _log(state, "成功逃离战斗", "system")
                _check_banter(state, events, "flee")
            else:
                _ev(events, "flee_fail")
                _log(state, "逃跑失败！", "system")
        else:
            _ev(events, "flee_fail")
            _log(state, "这场战斗无法逃跑", "system")

    elif atype == "defend":
        actor["defending"] = True
        actor["rage"] = min(RAGE_MAX, actor["rage"] + RAGE_ON_DEFEND)
        _ev(events, "defend", uid=actor["uid"], rage=round(actor["rage"]))
        _log(state, f"{actor['name']} 摆出防御姿态", "action")

    elif atype == "item":
        item = None
        for it in actor.get("items", []):
            if str(it.get("id")) == str(action.get("item_id")):
                item = it
                break
        if item:
            if _num(item.get("quantity"), 1) > 0:
                item["quantity"] = _num(item.get("quantity"), 1) - 1
            use_item(state, events, actor, item, target_uid)
        else:
            _log(state, f"{actor['name']} 想用道具，但背包是空的", "system")

    elif atype == "skill":
        skill = None
        for s in actor.get("skills", []):
            if str(s.get("id")) == str(action.get("skill_id")):
                skill = s
                break
        ok, reason = _skill_usable(actor, skill) if skill else (False, "技能不存在")
        if not ok:
            _log(state, f"{actor['name']} 无法施展（{reason}），改为普通攻击", "system")
            skill = None
        if skill:
            use_skill(state, events, actor, skill, target_uid, rng)
        else:
            _basic_attack(state, events, actor, target_uid, rng)

    else:  # attack
        _basic_attack(state, events, actor, target_uid, rng)

    _after_action(state, events, actor)
    _end_turn(state, events, actor, rng)
    _check_end(state, events)


def _basic_attack(state: dict, events: list, actor: dict, target_uid: str | None,
                  rng: random.Random | None = None) -> None:
    targets = resolve_targets(state, actor, "single_enemy", target_uid)
    if not targets:
        return
    t = targets[0]
    res = compute_damage(actor, t, 100, scale="attack", rng=rng)
    _ev(events, "cast", uid=actor["uid"], skill="普通攻击",
        skill_id=None, visual="", element="none", targets=[t["uid"]], ultimate=False)
    dealt = _apply_damage(state, events, t, res["damage"], crit=res["crit"],
                          weak=res["weak"], resist=res["resist"], source=actor)
    extra = "（暴击！）" if res["crit"] else ("（克制！" + "）" if res["weak"] else ("（被抵抗）" if res["resist"] else ""))
    _log(state, f"{actor['name']} 攻击 {t['name']}，造成 {round(dealt)} 点伤害{extra}", "damage")


def submit_action(state: dict, uid: str, action: dict,
                  rng: random.Random | None = None) -> list[dict]:
    """玩家对一个待输入单位下达指令，然后自动推进到下一个待输入单位。"""
    events: list[dict] = []
    actor = unit_by_uid(state, uid)
    if not actor or not actor.get("alive"):
        return advance(state, rng=rng)
    if state.get("turn_uid") not in (None, uid):
        # 不是它行动
        return []
    state["turn_uid"] = None
    perform_action(state, events, actor, action, rng)
    if state["status"] == "active":
        # 玩家单位行动后算作过了一轮（用于"回合数"展示）
        if actor["side"] == "player":
            state["round"] = state.get("round", 1) + 1
            _check_banter(state, events, "round")
        events.extend(advance(state, rng=rng))
    return events


def advance(state: dict, rng: random.Random | None = None, max_steps: int = 300) -> list[dict]:
    """自动推进战斗，直到需要玩家输入或战斗结束。"""
    events: list[dict] = []
    if state["status"] != "active":
        return events
    if not state.get("_started"):
        state["_started"] = True
        _check_banter(state, events, "battle_start")
    steps = 0
    while state["status"] == "active" and steps < max_steps:
        steps += 1
        actor = pick_actor(state)
        if not actor:
            _check_end(state, events)
            break
        if is_player_controlled(state, actor):
            state["turn_uid"] = actor["uid"]
            state["order"] = preview_order(state, 8)
            _ev(events, "await_input", uid=actor["uid"])
            break
        ai_action = _ai_choose(state, actor, rng)
        perform_action(state, events, actor, ai_action, rng)
    else:
        if steps >= max_steps:
            _log(state, "（战斗推演步数达到上限，自动结束）", "system")
    state["order"] = preview_order(state, 8) if state["status"] == "active" else []
    return events


def set_auto(state: dict, auto: bool) -> None:
    state["config"]["auto_battle"] = bool(auto)


def auto_run(state: dict, rng: random.Random | None = None) -> list[dict]:
    """全自动模式：玩家单位交给 AI 决策。"""
    events: list[dict] = []
    prev = state["config"].get("auto_battle")
    state["config"]["auto_battle"] = True
    # 如果当前有待输入单位，先让它行动
    guard = 0
    while state["status"] == "active" and guard < 60:
        guard += 1
        if state.get("turn_uid"):
            uid = state["turn_uid"]
            unit = unit_by_uid(state, uid)
            if unit and unit.get("alive"):
                state["turn_uid"] = None
                act = _ai_choose(state, unit, rng)
                perform_action(state, events, unit, act, rng)
        events.extend(advance(state, rng=rng))
        if state["status"] != "active" or not state.get("turn_uid"):
            break
    state["config"]["auto_battle"] = prev
    return events


# ======================================================================
# 结算
# ======================================================================

def _exp_table(level: int) -> int:
    """默认升级所需经验（无 level_up_table 时使用）。"""
    return int(40 * (level ** 1.6) + 60)


def settle_rewards(state: dict, level_table: dict | None = None) -> dict:
    """战斗结束时算出奖励（不落库，交给 router 持久化）。

    level_table: {level: exp_required}，来自 level_up_table 表。
    """
    if state.get("rewards") is not None:
        return state["rewards"]

    player_units = [u for u in state["units"] if u["side"] == "player"]
    main = player_units[0] if player_units else None

    rewards = {
        "result": state["status"],
        "exp": 0,
        "drops": [],
        "level_up": [],
        "realm_up": None,
        "learned_skills": [],
        "coin": 0,
    }

    if state["status"] == "player_won" and main:
        base_exp = 0.0
        for u in state["units"]:
            if u["side"] != "enemy":
                continue
            if u.get("exp_reward"):
                base_exp += _num(u["exp_reward"])
            else:
                base_exp += 12 * max(1, int(_num(u.get("level"), 1))) + 30
        mult = _num(state["config"].get("exp_multiplier"), 1.0)
        rewards["exp"] = int(base_exp * mult)
        rewards["coin"] = int(base_exp * mult * 0.6)
        for u in state["units"]:
            if u["side"] == "enemy":
                for d in u.get("drops") or []:
                    chance = _num(d.get("chance"), 100)
                    if random.randint(1, 100) <= chance:
                        rewards["drops"].append({
                            "item_id": d.get("item_id"),
                            "name": d.get("name") or "",
                            "image": d.get("image") or "",
                            "quantity": int(_num(d.get("quantity"), 1) or 1),
                        })
        # 升级推演（用当前等级/经验）
        cur_level = int(_num(main.get("level"), 1))
        cur_exp = int(_num(main.get("exp"), 0)) + rewards["exp"]
        guard = 0
        while guard < 200:
            guard += 1
            need = level_table.get(cur_level + 1) if level_table else _exp_table(cur_level)
            if need is None:
                need = _exp_table(cur_level)
            if cur_exp < need:
                break
            cur_exp -= need
            cur_level += 1
            rewards["level_up"].append({
                "level": cur_level,
                "exp_left": cur_exp,
                "realm_up": cur_level % 5 == 0,
            })
        rewards["final_exp"] = cur_exp
        rewards["final_level"] = cur_level

    state["rewards"] = rewards
    return rewards


def to_client_state(state: dict) -> dict:
    """给前端的精简状态（去掉内部字段）。"""
    out = {k: v for k, v in state.items() if not k.startswith("_")}
    out["order"] = preview_order(state, 8) if state["status"] == "active" else []
    out["units"] = []
    for u in state["units"]:
        cu = {k: v for k, v in u.items() if not k.startswith("_")}
        cu["eff"] = {
            "max_hp": round(eff_stat(u, "max_hp")),
            "max_mp": round(eff_stat(u, "max_mp")),
            "attack": round(eff_stat(u, "attack")),
            "defense": round(eff_stat(u, "defense")),
            "speed": round(eff_stat(u, "speed")),
        }
        cu["skills"] = [{
            "id": s.get("id"), "name": s["name"], "mp_cost": s["mp_cost"],
            "hp_cost": s["hp_cost"], "rage_cost": s["rage_cost"],
            "element": s["element"], "target_type": s["target_type"],
            "power": next((_num(e.get("power"), 0) for e in s["effects"] if e.get("kind") == "damage"), 0),
            "heal": next((_num(e.get("value") or e.get("power"), 0) for e in s["effects"] if e.get("kind") == "heal"), 0),
            "is_ultimate": s["is_ultimate"], "cooldown": s["cooldown"],
            "description": s["description"], "image": s["image"],
            "visual_effect": s["visual_effect"],
            "kinds": sorted({e.get("kind") for e in s["effects"]}),
            "usable": _skill_usable(u, s)[0],
            "reason": _skill_usable(u, s)[1],
        } for s in u.get("skills", [])]
        out["units"].append(cu)
    return out
