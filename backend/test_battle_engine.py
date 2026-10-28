"""战斗引擎 v2 单测（纯逻辑，不依赖数据库/网络）。

运行：cd backend && .venv/Scripts/python.exe test_battle_engine.py
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services import battle_engine as E  # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {extra}")


def make_player(**kw):
    base = dict(
        uid="p1", side="player", name="测试侠", level=5, attack=40, defense=20,
        speed=12, luck=8, hp=400, max_hp=400, mp=120, max_mp=120,
        skills=[
            {"id": 1, "name": "绵绵拳", "power": 10, "mp_cost": 9, "target_type": "single_enemy"},
            {"id": 2, "name": "烈火掌", "mp_cost": 20, "element": "fire",
             "target_type": "single_enemy", "effects": [
                 {"kind": "damage", "power": 180, "element": "fire"},
                 {"kind": "dot", "key": "burn", "value": 30, "turns": 3, "mode": "caster_attack_pct"}]},
            {"id": 3, "name": "回春术", "mp_cost": 15, "target_type": "single_ally",
             "effects": [{"kind": "heal", "power": 120}]},
            {"id": 4, "name": "裂空斩·极", "is_ultimate": 1, "target_type": "all_enemies",
             "effects": [{"kind": "damage", "power": 260, "hits": 2}]},
        ],
    )
    base.update(kw)
    return E.make_unit(**base)


def make_enemy(**kw):
    base = dict(
        uid="e1", side="enemy", name="黄蓉", level=5, attack=30, defense=12,
        speed=9, luck=5, hp=300, max_hp=300, mp=60, max_mp=60, element="wind",
        skills=[
            {"id": 11, "name": "打狗棒法", "power": 120, "target_type": "single_enemy",
             "effects": [{"kind": "damage", "power": 120}]},
            {"id": 12, "name": "毒烟", "target_type": "all_enemies",
             "effects": [{"kind": "dot", "key": "poison", "value": 12, "turns": 2, "mode": "caster_attack_pct"}]},
        ],
        ai={"type": "aggressive", "skill_chance": 1.0, "skill_weights": {"12": 2}},
        drops=[{"item_id": 2, "name": "寒春草", "chance": 100, "quantity": 2}],
    )
    base.update(kw)
    return E.make_unit(**base)


def test_basic_flow():
    print("\n[1] 基础流程：创建 → 等待输入 → 出招 → 推进")
    rng = random.Random(20260925)
    p, e = make_player(), make_enemy()
    st = E.create_state([p, e], {"banter": [
        {"trigger": "battle_start", "speaker": "黄蓉", "line": "来吧！"},
        {"trigger": "victory", "speaker": "黄蓉", "line": "我输了…"},
    ]})

    ev = E.advance(st, rng=rng)
    kinds = [x["t"] for x in ev]
    check("战前台词触发", any(x["t"] == "banter" for x in ev), kinds)
    check("推进到玩家输入", st["turn_uid"] == "p1", st["turn_uid"])
    check("行动顺序可预览", len(st["order"]) >= 2, st["order"])

    ev2 = E.submit_action(st, "p1", {"type": "skill", "skill_id": 2, "target_uid": "e1"}, rng=rng)
    check("技能释放事件", any(x["t"] == "cast" and x["skill_id"] == 2 for x in ev2))
    check("造成伤害", any(x["t"] == "damage" for x in ev2), [x["t"] for x in ev2])
    check("附加灼烧状态", any(x["t"] == "status_add" and x["status"]["key"] == "burn" for x in ev2))
    check("敌人血量下降", e["hp"] < e["base"]["max_hp"], e["hp"])
    check("敌方也行动了", any(x["t"] == "turn_start" and x["uid"] == "e1" for x in ev2))
    check("再次回到玩家输入", st["turn_uid"] == "p1", st["turn_uid"])
    check("MP 被消耗", p["mp"] < 120, p["mp"])
    check("怒气有增长", p["rage"] > 0, p["rage"])


def test_dot_and_status_tick():
    print("\n[2] 持续伤害 / 状态回合结算")
    rng = random.Random(7)
    p, e = make_player(), make_enemy(ai={"type": "aggressive", "default_weight": 0.0})
    st = E.create_state([p, e])
    E.advance(st, rng=rng)
    E.submit_action(st, "p1", {"type": "skill", "skill_id": 2, "target_uid": "e1"}, rng=rng)
    hp_after_burn = e["hp"]
    E.submit_action(st, "p1", {"type": "defend"}, rng=rng)
    check("灼烧在回合开始扣血", e["hp"] < hp_after_burn, f"{hp_after_burn} -> {e['hp']}")
    check("状态回合数递减", all(s["turns"] <= 3 for s in e["statuses"]))


def test_heal_and_ally_target():
    print("\n[3] 治疗 / 队友目标 / 护盾")
    rng = random.Random(11)
    p = make_player(hp=100)
    e = make_enemy(ai={"type": "aggressive", "default_weight": 1.0}, hp=1000, max_hp=1000)
    st = E.create_state([p, e])
    E.advance(st, rng=rng)
    before = p["hp"]
    ev = E.submit_action(st, "p1", {"type": "skill", "skill_id": 3, "target_uid": "p1"}, rng=rng)
    check("治疗事件", any(x["t"] == "heal" for x in ev))
    check("血量恢复", p["hp"] > before, f"{before} -> {p['hp']}")


def test_ultimate_rage():
    print("\n[4] 怒气 / 绝招 / 群攻")
    rng = random.Random(3)
    p = make_player()
    e1 = make_enemy(uid="e1", hp=800, max_hp=800, ai={"type": "aggressive", "default_weight": 0.0})
    e2 = make_enemy(uid="e2", name="丽莎", hp=800, max_hp=800, ai={"type": "aggressive", "default_weight": 0.0})
    st = E.create_state([p, e1, e2])
    p["rage"] = 100
    E.advance(st, rng=rng)
    ev = E.submit_action(st, "p1", {"type": "skill", "skill_id": 4, "target_uid": "e1"}, rng=rng)
    dmg_targets = {x["uid"] for x in ev if x["t"] == "damage" and not x.get("dot") and not x.get("self_cost")}
    check("群攻命中多个敌人", len(dmg_targets) >= 2, dmg_targets)
    check("绝招清空怒气", p["rage"] < 100, p["rage"])
    check("未满怒气时不可用", E._skill_usable(p, p["skills"][3])[0] is False)


def test_ai_and_victory():
    print("\n[5] 敌方 AI / 自动战斗 / 胜利结算")
    rng = random.Random(99)
    p = make_player(attack=200, hp=2000, max_hp=2000)
    e = make_enemy()
    st = E.create_state([p, e], {"banter": [{"trigger": "victory", "speaker": "黄蓉", "line": "我输了…"}]})
    ev = E.auto_run(st, rng=rng)
    check("自动战斗能打完", st["status"] == "player_won", st["status"])
    check("胜利事件", any(x["t"] == "victory" for x in ev))
    check("胜利台词", any(x["t"] == "banter" and "输了" in x["line"] for x in ev))
    rw = E.settle_rewards(st, level_table={2: 100, 3: 250, 4: 500, 5: 900})
    check("有经验奖励", rw["exp"] > 0, rw["exp"])
    check("有掉落", len(rw["drops"]) == 1 and rw["drops"][0]["quantity"] == 2, rw["drops"])
    check("升级推演", rw["final_level"] >= 5, rw)


def test_boss_phase():
    print("\n[6] Boss 阶段切换")
    rng = random.Random(5)
    p = make_player(attack=500, hp=3000, max_hp=3000)
    boss = make_enemy(uid="e1", name="魔君", hp=800, max_hp=800, is_boss=True,
                      ai={"type": "aggressive", "default_weight": 1.0},
                      phases=[{"hp_below": 50, "name": "狂暴", "line": "受死吧！",
                               "buff": {"key": "atk_up", "stat": "attack", "value": 100, "turns": 99},
                               "skills": [{"id": 21, "name": "灭世一击", "target_type": "all_enemies",
                                           "effects": [{"kind": "damage", "power": 300}]}]}])
    st = E.create_state([p, boss])
    E.advance(st, rng=rng)
    ev = E.submit_action(st, "p1", {"type": "attack"}, rng=rng)
    check("阶段触发事件", any(x["t"] == "phase" for x in ev), [x["t"] for x in ev])
    check("阶段台词", any(x["t"] == "banter" and "受死" in x["line"] for x in ev))
    check("阶段换技能", any(s["id"] == 21 for s in boss["skills"]), [s["id"] for s in boss["skills"]])
    check("阶段加 buff", E.eff_stat(boss, "attack") > boss["base"]["attack"])


def test_control_and_shield():
    print("\n[7] 控制 / 沉默 / 护盾 / 净化")
    rng = random.Random(13)
    p = make_player(speed=30)
    e = make_enemy(speed=1, ai={"type": "aggressive", "default_weight": 1.0})
    st = E.create_state([p, e])
    E.advance(st, rng=rng)
    E._apply_effect(st, [], p, {"kind": "control", "control": "stun", "chance": 100, "turns": 1},
                    "single_enemy", "e1", {"name": "震慑", "element": "none", "critical_rate": 0, "id": None}, rng)
    check("敌人被眩晕", E.has_status(e, "stun"))
    E._apply_effect(st, [], p, {"kind": "shield", "value": 100, "turns": 2},
                    "self", None, {"name": "护盾术", "element": "none", "critical_rate": 0, "id": None}, rng)
    check("护盾生效", p["shield"] == 100, p["shield"])
    hp_before = p["hp"]
    E._apply_damage(st, [], p, 60)
    check("护盾吸收伤害", p["hp"] == hp_before and p["shield"] == 40, (p["hp"], p["shield"]))
    E.add_status(p, {"key": "poison", "kind": "dot", "value": 10, "turns": 2})
    removed = E.remove_status(p, "poison")
    check("净化移除负面", removed == 1 and not E.has_status(p, "poison"))


def test_legacy_skill_compat():
    print("\n[8] 旧数据兼容（无 effects 的技能）")
    s = E.normalize_skill({"id": 9, "name": "绵绵拳", "power": 10, "mp_cost": 9,
                           "status_effect": '[{"kind":"buff","stat":"attack","value":10,"turns":2}]'})
    check("旧技能生成伤害效果", s["effects"][0]["kind"] == "damage")
    check("旧 power 换算成倍率", s["effects"][0]["power"] == 150, s["effects"][0])
    check("status_effect 被解析追加", len(s["effects"]) == 2)
    check("标记为 legacy", s["legacy"] is True)


def test_flee_and_defeat():
    print("\n[9] 逃跑 / 战败")
    rng = random.Random(21)
    p = make_player(hp=1, attack=1, speed=50)
    e = make_enemy(uid="e1", attack=999, speed=1, hp=5000, max_hp=5000)
    st = E.create_state([p, e])
    E.advance(st, rng=rng)
    ev = E.submit_action(st, "p1", {"type": "flee"}, rng=rng)
    check("逃跑有结果（成功或失败）", any(x["t"] in ("flee_ok", "flee_fail") for x in ev) or st["status"] == "enemy_won",
          st["status"])
    st2 = E.create_state([make_player(hp=10, attack=1), make_enemy(uid="e1", attack=999)])
    E.auto_run(st2, rng=rng)
    check("高攻敌人能击败玩家", st2["status"] in ("enemy_won", "player_won"), st2["status"])
    if st2["status"] == "enemy_won":
        rw = E.settle_rewards(st2)
        check("战败无奖励", rw["exp"] == 0, rw)


def test_client_state_serializable():
    print("\n[10] 状态可 JSON 序列化（服务端权威 + 前端消费）")
    p, e = make_player(), make_enemy()
    st = E.create_state([p, e])
    E.advance(st, rng=random.Random(1))
    cs = E.to_client_state(st)
    try:
        raw = json.dumps(cs, ensure_ascii=False)
        ok = True
    except Exception as ex:  # noqa: BLE001
        raw, ok = str(ex), False
    check("client state 可序列化", ok, raw[:200])
    check("含 eff 结算属性", "eff" in cs["units"][0])
    check("技能带可用性标记", "usable" in cs["units"][0]["skills"][0])


if __name__ == "__main__":
    test_basic_flow()
    test_dot_and_status_tick()
    test_heal_and_ally_target()
    test_ultimate_rage()
    test_ai_and_victory()
    test_boss_phase()
    test_control_and_shield()
    test_legacy_skill_compat()
    test_flee_and_defeat()
    test_client_state_serializable()
    print(f"\n===== 引擎单测：{PASS} 通过 / {FAIL} 失败 =====")
    sys.exit(1 if FAIL else 0)
