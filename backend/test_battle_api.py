"""战斗系统 v2 端到端冒烟测试（对真实 HTTP 服务发起请求）。

用法：
  cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 &
  .venv/Scripts/python.exe test_battle_api.py http://127.0.0.1:8010
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"

PASS = 0
FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {str(extra)[:300]}")


def req(method, path, data=None, token=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("X-User-Token", token)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return e.code, raw


def main():
    print(f"== 目标服务：{BASE} ==")
    st, health = req("GET", "/api/skills/")
    check("服务可用", st == 200, (st, health))

    uname = f"battle_tester_{int(time.time()) % 100000}"
    st, r = req("POST", "/api/users/register", {"username": uname, "password": "test1234", "nickname": "战斗测试"})
    check("注册测试用户", st in (200, 201), (st, r))
    st, r = req("POST", "/api/users/login", {"username": uname, "password": "test1234"})
    check("登录拿到令牌", st == 200 and r.get("token"), (st, r))
    token = (r or {}).get("token")

    req("POST", "/api/users/me/library/1", None, token)
    st, uc = req("POST", "/api/users/me/characters",
                 {"game_id": 1, "base_character_id": 1, "custom_name": "战斗测试侠"}, token)
    check("创建用户角色", st in (200, 201) and uc.get("id"), (st, uc))
    uc_id = (uc or {}).get("id")

    # --- 技能/物品种子是否就绪 ---
    st, skills = req("GET", "/api/skills/")
    check("技能库已填充", st == 200 and len(skills or []) >= 10, len(skills or []))
    keys = {s["name"] for s in (skills or [])}
    check("含绝招技能", "万剑归宗" in keys, sorted(keys)[:8])
    check("技能带 effects", any(s.get("effects") for s in (skills or [])))

    # --- 从剧情战斗节点开打 ---
    st, story = req("GET", "/api/story/nodes?node_type=battle")
    node_id = story[0]["id"] if story else 8
    st, start = req("POST", "/api/battle/v2/start",
                    {"story_node_id": node_id, "user_character_id": uc_id}, token)
    check("战斗开始成功", st == 200 and start.get("battle_id"), (st, start))
    if st != 200:
        print(json.dumps(start, ensure_ascii=False)[:800])
        return
    bid = start["battle_id"]
    state = start["state"]
    check("返回战斗状态", state.get("status") == "active", state.get("status"))
    units = state["units"]
    check("有玩家单位", any(u["side"] == "player" for u in units))
    check("有敌人单位", any(u["side"] == "enemy" for u in units))
    check("行动顺序可预览", len(state.get("order") or []) > 0)
    check("玩家单位带技能", len([u for u in units if u["side"] == "player"][0]["skills"]) >= 3)
    check("等待玩家输入", state.get("turn_uid"), state.get("turn_uid"))

    # --- 出招（用真实剧情节点配置打一场，胜负不限，只验流程与事件契约） ---
    def pick_action(me, foes, turn):
        """稍微聪明的打法：绝招满怒就放 → 低血吃药 → 高倍率技能 → 普攻。"""
        ratio = me["hp"] / max(1, me["eff"]["max_hp"])
        target = min(foes, key=lambda u: u["hp"])["uid"]
        ult = [s for s in me["skills"]
               if s.get("is_ultimate") and s.get("usable")
               and (me.get("rage") or 0) >= (s.get("rage_cost") or 100)]
        if ult:
            return {"type": "skill", "skill_id": ult[0]["id"], "target_uid": target}
        if ratio < 0.45:
            heal = next((i for i in me.get("items", []) if (i.get("heal") or 0) > 0 or "丹" in i["name"]), None)
            if heal:
                return {"type": "item", "item_id": heal["id"], "target_uid": me["uid"]}
        skills = [s for s in me["skills"] if s.get("usable") and s["id"] and not s.get("is_ultimate")]
        if skills and turn % 2 == 0:
            best = max(skills, key=lambda s: (s.get("power") or 0) + (s.get("heal") or 0))
            if best.get("power"):
                return {"type": "skill", "skill_id": best["id"], "target_uid": target}
        return {"type": "attack", "target_uid": target}

    def fight(b_id, st0, ev, first_defend=False, probe=None):
        turn = 0
        while st0.get("status") == "active" and turn < 60:
            turn += 1
            uid = st0.get("turn_uid")
            if not uid:
                _, r = req("POST", f"/api/battle/v2/{b_id}/auto", {"enabled": True}, token)
                st0 = r["state"]
                ev += r.get("events") or []
                break
            me = next(u for u in st0["units"] if u["uid"] == uid)
            foes = [u for u in st0["units"] if u["side"] == "enemy" and u["alive"]]
            if not foes:
                break
            if first_defend and turn == 1:
                action = {"type": "defend"}
                if probe is not None:
                    probe["before"] = me.get("rage") or 0
            else:
                action = pick_action(me, foes, turn)
            _st, r = req("POST", f"/api/battle/v2/{b_id}/action", action, token)
            if _st != 200:
                check("出招请求成功", False, (_st, r))
                break
            if probe is not None and probe.get("before") is not None and probe.get("after") is None:
                after = next(u for u in r["state"]["units"] if u["uid"] == uid)
                probe["after"] = after.get("rage") or 0
                probe["ev"] = [e for e in (r.get("events") or []) if e["t"] == "defend"]
            st0 = r["state"]
            ev += r.get("events") or []
        return st0, ev, turn

    ev_all = list(start.get("events") or [])
    state, ev_all, rounds = fight(bid, state, ev_all)

    kinds = {e["t"] for e in ev_all}
    check("产生伤害事件", "damage" in kinds, sorted(kinds))
    check("产生技能事件", "cast" in kinds, sorted(kinds))
    check("战斗结束（胜/负/逃）", state.get("status") in ("player_won", "enemy_won", "fled"), state.get("status"))
    check("有战斗日志", len(state.get("log") or []) > 0)

    st, settle = req("POST", f"/api/battle/v2/{bid}/settle", {}, token)
    check("结算接口成功", st == 200, (st, settle))
    rewards = (settle or {}).get("rewards") or {}
    check("结算返回 rewards", isinstance(rewards, dict) and "exp" in rewards, rewards)
    st, again = req("POST", f"/api/battle/v2/{bid}/settle", {}, token)
    check("结算幂等", st == 200 and (again.get("rewards", {}).get("exp") == rewards.get("exp")), None)

    # --- 第二场：把难度压到必胜档，专门验证「胜利 + 成长写回」这条确定性路径 ---
    st, full0 = req("GET", f"/api/users/me/characters/{uc_id}/full", None, token)
    exp0 = (full0 or {}).get("exp") or 0
    lv0 = (full0 or {}).get("level") or 1

    st, start2 = req("POST", "/api/battle/v2/start",
                     {"story_node_id": node_id, "user_character_id": uc_id,
                      "config_override": {"difficulty": 0.3}}, token)
    check("第二场开战成功", st == 200 and start2.get("battle_id"), (st, start2))
    if st != 200:
        print(json.dumps(start2, ensure_ascii=False)[:800])
        return
    bid2 = start2["battle_id"]
    state2 = start2["state"]
    check("第二场状态为 active", state2.get("status") == "active", state2.get("status"))

    ev2 = list(start2.get("events") or [])
    probe: dict = {}
    state2, ev2, rounds2 = fight(bid2, state2, ev2, first_defend=True, probe=probe)
    kinds2 = {e["t"] for e in ev2}
    check("第二场胜利", state2.get("status") == "player_won", state2.get("status"))
    check("防御指令产生 defend 事件", "defend" in kinds2, sorted(kinds2))
    # 防御的怒气走 defend 事件的 rage 字段（不单独发 rage 事件），另外每回合固定 +6
    d_ev = (probe.get("ev") or [{}])[0]
    check("防御事件带怒气值", (d_ev.get("rage") or 0) >= 25, d_ev)
    check("防御后怒气增长",
          (probe.get("after") or 0) > (probe.get("before") or 0),
          {"before": probe.get("before"), "after": probe.get("after")})

    st, settle2 = req("POST", f"/api/battle/v2/{bid2}/settle", {}, token)
    check("第二场结算成功", st == 200, (st, settle2))
    rw2 = (settle2 or {}).get("rewards") or {}
    check("胜利有经验", (rw2.get("exp") or 0) > 0, rw2)
    check("升级或经验入账",
          (rw2.get("final_level") or 1) > lv0 or (rw2.get("exp") or 0) > 0, rw2)
    ch2 = rw2.get("character") or {}
    check("角色数据写回", ch2.get("id") == uc_id, ch2)
    check("结算含掉落列表", isinstance(rw2.get("drops"), list), rw2.get("drops"))

    st, again2 = req("POST", f"/api/battle/v2/{bid2}/settle", {}, token)
    check("第二场结算幂等",
          st == 200 and (again2.get("rewards", {}).get("exp") == rw2.get("exp")), None)

    # --- 战斗后人物状态（经验/血量必须持久化回人物） ---
    st, full = req("GET", f"/api/users/me/characters/{uc_id}/full", None, token)
    check("人物详情可读", st == 200 and full.get("id") == uc_id, st)
    if st == 200:
        check("血量不为负", (full.get("hp") or 0) >= 0, full.get("hp"))
        check("经验已持久化", (full.get("exp") or 0) >= exp0, (exp0, full.get("exp")))
        check("等级不低于战前", (full.get("level") or 1) >= lv0, (lv0, full.get("level")))

    print(f"\n===== e2e：{PASS} 通过 / {FAIL} 失败"
          f"（第 1 场 {rounds} 次指令 {state.get('status')}；"
          f"第 2 场 {rounds2} 次指令 {state2.get('status')}，Lv.{lv0}→Lv.{full.get('level') if st == 200 else '?'}）=====")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
