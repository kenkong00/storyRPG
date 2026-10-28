"""导出一场真实战斗的状态与事件流，作为前端 UI 测试的夹具。

前端（js/ui/combat.js）不写任何战斗数值，它消费的就是这里的 state + events。
用真实引擎产出夹具，可以同时验证"服务端事件契约"和"前端演出"。

用法：.venv/Scripts/python.exe backend/dump_battle_fixture.py
输出：test_fixtures/battle_fixture.json
"""
from __future__ import annotations

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services import battle_engine as E  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test_fixtures")
OUT_FILE = os.path.join(OUT_DIR, "battle_fixture.json")


def sk(sid, name, effect_kind="damage", power=150, target="single_enemy",
       mp=8, element="none", ult=False, extra=None, desc="", cd=0, accuracy=100):
    effects = []
    if effect_kind == "damage":
        effects.append({"kind": "damage", "power": power})
    elif effect_kind == "heal":
        effects.append({"kind": "heal", "power": power, "target": "single_ally"})
    elif effect_kind == "support":
        pass
    if extra:
        effects.extend(extra)
    return {
        "id": sid, "name": name, "skill_type": "attack" if effect_kind == "damage" else "support",
        "power": power, "mp_cost": mp, "hp_cost": 0, "accuracy": accuracy, "critical_rate": 12,
        "target_type": target, "element": element, "effects": effects,
        "status_effect": None, "rage_cost": 100 if ult else 0, "is_ultimate": ult,
        "hits": 1, "cooldown": cd, "image": "", "description": desc,
        "visual_effect": "burst" if ult else "",
    }


def art_of(cid: int) -> dict:
    """从数据库取该角色的美术资源包（立绘 / 损血档位 / 动作图）。

    走的是和真实战斗同一条路径（router._char_art），所以夹具里的立绘数据
    和线上完全一致：前端换立绘的逻辑也就能被这夹具真实覆盖。
    """
    try:
        from app.database import SessionLocal
        from app.routers.battle import _char_art
        db = SessionLocal()
        try:
            return _char_art(db, cid) or {}
        finally:
            db.close()
    except Exception as e:  # noqa: BLE001
        print(f"  （取角色 {cid} 的美术资源失败：{e}）")
        return {}


def build():
    rng = random.Random(20260925)

    player_skills = [
        sk(101, "烈火掌", "damage", 160, element="fire", mp=8, desc="造成火属性伤害"),
        sk(102, "破甲击", "damage", 110, mp=10, extra=[
            {"kind": "debuff", "stat": "defense", "value": -25, "turns": 3, "name": "破甲"},
        ], desc="降低目标防御"),
        sk(104, "护体真气", "support", 0, target="self", mp=12, desc="获得护盾与防御提升",
           extra=[{"kind": "shield", "power": 18, "turns": 3},
                  {"kind": "buff", "stat": "defense", "value": 30, "turns": 3, "name": "铁壁"}]),
        sk(105, "定身咒", "support", 0, mp=14, accuracy=100, desc="定住目标一回合",
           extra=[{"kind": "control", "control": "stun", "turns": 1, "chance": 90}]),
        sk(103, "万剑归宗", "damage", 320, target="all_enemies", mp=0, ult=True,
           desc="对全体敌人造成大量伤害"),
    ]
    player_items = [{
        "id": 1, "name": "回春丹", "image": "", "quantity": 5, "rarity": 2,
        "description": "恢复生命", "effects": json.dumps([{"kind": "heal", "value": 220, "target": "self"}]),
    }]
    enemy_skills = [
        sk(201, "撕咬", "damage", 130, mp=0, element="dark", accuracy=88),
        sk(202, "腐蚀吐息", "damage", 100, element="dark", mp=6, extra=[
            {"kind": "dot", "key": "poison", "value": 16, "turns": 3, "name": "中毒"},
        ]),
    ]

    player = E.make_unit(
        uid="p1", side="player", name="测试侠", character_id=1, user_character_id=1,
        level=10, realm_name="筑基三重", hp=1600, max_hp=1600, mp=300, max_mp=300,
        attack=110, defense=60, speed=28, luck=12, element="fire",
        skills=player_skills, items=player_items,
        ai={"type": "player", "skill_chance": 0.9},
    )
    player["exp"] = 180
    player["art"] = art_of(1)          # 玩家立绘 / 损血表情

    enemies = [
        E.make_unit(
            uid="e1", side="enemy", name="暗影狼王", character_id=2, level=11,
            hp=620, max_hp=620, mp=90, max_mp=90, attack=60, defense=30, speed=24, luck=8,
            element="dark", skills=enemy_skills, is_boss=True,
            phases=[{"hp_below": 60, "name": "狂暴", "line": "狼王发出低沉的咆哮！",
                     "buff": {"key": "atk_up", "name": "狂暴", "stat": "attack",
                              "value": 40, "turns": 99}}],
            ai={"type": "aggressive", "skill_chance": 0.7},
            drops=[{"item_id": 1, "name": "回春丹", "quantity": 1, "chance": 100},
                   {"item_id": 2, "name": "暗影结晶", "quantity": 1, "chance": 60}],
            exp_reward=420,
        ),
        E.make_unit(
            uid="e2", side="enemy", name="腐尸术士", character_id=3, level=10,
            hp=300, max_hp=300, mp=140, max_mp=140, attack=48, defense=22, speed=31, luck=10,
            element="dark", skills=[enemy_skills[1]],
            ai={"type": "aggressive", "skill_chance": 0.8},
            drops=[{"item_id": 2, "name": "暗影结晶", "quantity": 2, "chance": 100}],
            exp_reward=300,
        ),
    ]
    for u in enemies:
        u["art"] = art_of(u.get("character_id"))   # 敌人立绘 / 损血表情

    config = {
        "difficulty": 1.0, "allow_flee": True, "exp_multiplier": 1.0,
        "background": "", "defeat_penalty": "half_hp",
        "banter": [
            {"trigger": "battle_start", "speaker": "暗影狼王", "line": "又来了一个送死的。"},
            {"trigger": "hp_below", "uid": "e1", "value": 45, "speaker": "暗影狼王",
             "line": "你……居然能伤到我？"},
            {"trigger": "victory", "speaker": "测试侠", "line": "结束了。"},
        ],
    }

    state = E.create_state([player] + enemies, config,
                           meta={"story_node_id": 8, "user_character_id": 1,
                                 "player_name": "测试侠"})

    steps = []
    events = E.advance(state, rng)
    start = {"battle_id": 1, "state": E.to_client_state(state), "events": events}

    # 出招脚本：尽量覆盖各类事件（普攻 / 减益 / 护盾 / 控制 / 道具 / 防御 / 大招）
    PLAN = [
        ("attack", None), ("skill", 102), ("skill", 104), ("skill", 105),
        ("item", None), ("defend", None), ("attack", None), ("skill", 101),
    ]

    def pick_action(unit, target, idx, plain=False):
        ult = next((s for s in unit.get("skills", []) if s.get("is_ultimate")), None)
        if not plain and ult and unit["rage"] >= E.ULTIMATE_RAGE_COST:
            return {"type": "skill", "skill_id": ult["id"]}
        if plain:
            return {"type": "attack", "target_uid": target}
        kind, sid = PLAN[idx % len(PLAN)]
        if kind == "attack":
            return {"type": "attack", "target_uid": target}
        if kind == "skill":
            act = {"type": "skill", "skill_id": sid}
            meta = next((s for s in unit.get("skills", []) if s.get("id") == sid), None)
            if (meta or {}).get("target_type", "single_enemy") in ("single_enemy", "all_enemies"):
                act["target_uid"] = target
            return act
        if kind == "item":
            it = next((i for i in (unit.get("items") or []) if (i.get("quantity") or 0) > 0), None)
            if it:
                return {"type": "item", "item_id": it["id"]}
            return {"type": "attack", "target_uid": target}
        return {"type": "defend"}

    guard = 0
    while state["status"] == "active" and guard < 40:
        uid = state.get("turn_uid")
        if not uid:
            break
        unit = E.unit_by_uid(state, uid)
        foes = [u for u in state["units"] if u["side"] == "enemy" and u.get("alive")]
        if not foes:
            break
        target = min(foes, key=lambda u: u["hp"])["uid"]
        action = pick_action(unit, target, guard)
        guard += 1
        steps.append({
            "action": dict(action, uid=uid),
            "state": E.to_client_state(state),
            "events": E.submit_action(state, uid, action, rng),
        })

    # 收尾：确保夹具以"玩家胜利"结束，便于前端测结算面板
    guard2 = 0
    while state["status"] == "active" and guard2 < 40:
        uid = state.get("turn_uid")
        if not uid:
            break
        unit = E.unit_by_uid(state, uid)
        foes = [u for u in state["units"] if u["side"] == "enemy" and u.get("alive")]
        if not foes:
            break
        target = min(foes, key=lambda u: u["hp"])["uid"]
        action = pick_action(unit, target, 0, plain=True)
        guard2 += 1
        steps.append({
            "action": dict(action, uid=uid),
            "state": E.to_client_state(state),
            "events": E.submit_action(state, uid, action, rng),
        })

    # 夹具里用一张"好升级"的表，便于前端测结算面板的升级展示
    table = {lv: 200 for lv in range(1, 61)}
    rewards = E.settle_rewards(state, level_table=table)

    return {
        "start": start,
        "steps": steps,
        "final": E.to_client_state(state),
        "rewards": rewards,
        "meta": {
            "event_types": sorted({ev["t"] for ev in
                                   start["events"] + [e for s in steps for e in s["events"]]}),
            "total_commands": len(steps),
            "result": state["status"],
        },
    }


def main():
    data = build()
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"已写出 {os.path.abspath(OUT_FILE)}")
    print("  结果:", data["meta"]["result"])
    print("  指令数:", data["meta"]["total_commands"])
    print("  事件类型:", ", ".join(data["meta"]["event_types"]))
    print("  奖励:", json.dumps({k: v for k, v in data["rewards"].items()
                                if k in ("exp", "coin", "level_up", "drops")}, ensure_ascii=False)[:220])


if __name__ == "__main__":
    main()
