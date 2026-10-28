from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.battle import Battle, BattleTurn, CombatExpression
from ..models.character import Character
from ..models.item import Item
from ..models.equipment import Equipment
from ..models.skill import CharacterSkill, LevelUpTable, Skill
from ..models.skill_book import CharacterSkillBook, UserCharacterSkillBook
from ..models.story import StoryNode
from ..models.realm import CharacterRealm
from ..models.user import User, UserCharacter, UserCharacterInventory, UserCharacterEquipment
from ..schemas.battle import (
    BattleCreate, BattleResponse,
    BattleTurnCreate, BattleTurnResponse,
    CombatExpressionCreate, CombatExpressionResponse,
    BattleV2Start, BattleV2Action, BattleV2Auto,
)
from ..services import battle_engine as E
from .users import require_user

router = APIRouter(prefix="/api/battle", tags=["战斗系统"])


# ======================================================================
# 旧的战斗 CRUD（保留兼容）
# ======================================================================

@router.get("/", response_model=list[BattleResponse])
def list_battles(
    battle_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Battle)
    if battle_type:
        query = query.filter(Battle.battle_type == battle_type)
    if status:
        query = query.filter(Battle.status == status)
    return query.order_by(Battle.started_at.desc()).all()


# --- 回合记录 ---

@router.get("/{battle_id}/turns", response_model=list[BattleTurnResponse])
def get_battle_turns(battle_id: int, db: Session = Depends(get_db)):
    return db.query(BattleTurn).filter(
        BattleTurn.battle_id == battle_id
    ).order_by(BattleTurn.turn_number).all()


@router.post("/{battle_id}/turns", response_model=BattleTurnResponse, status_code=201)
def add_turn(battle_id: int, data: BattleTurnCreate, db: Session = Depends(get_db)):
    turn = BattleTurn(battle_id=battle_id, **data.model_dump(exclude={"battle_id"}))
    db.add(turn)
    db.commit()
    db.refresh(turn)
    return turn


# --- 战斗表情 ---

@router.get("/expressions", response_model=list[CombatExpressionResponse])
def list_expressions(
    character_id: Optional[int] = Query(None),
    expression_type: Optional[str] = Query(None),
    trigger_condition: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(CombatExpression)
    if character_id:
        query = query.filter(CombatExpression.character_id == character_id)
    if expression_type:
        query = query.filter(CombatExpression.expression_type == expression_type)
    if trigger_condition:
        query = query.filter(CombatExpression.trigger_condition == trigger_condition)
    return query.all()


@router.post("/expressions", response_model=CombatExpressionResponse, status_code=201)
def create_expression(data: CombatExpressionCreate, db: Session = Depends(get_db)):
    expr = CombatExpression(**data.model_dump())
    db.add(expr)
    db.commit()
    db.refresh(expr)
    return expr


@router.get("/expressions/match/{character_id}")
def match_expression(
    character_id: int,
    trigger: str = Query(..., description="触发条件: hp_below_30 / critical_hit / ally_defeated / victory_near / defeat_near"),
    db: Session = Depends(get_db),
):
    """根据触发条件匹配战斗表情"""
    expr = db.query(CombatExpression).filter(
        CombatExpression.character_id == character_id,
        CombatExpression.trigger_condition == trigger,
    ).first()
    if not expr:
        return {"matched": False, "message": "没有匹配的表情"}
    return {
        "matched": True,
        "expression": {
            "id": expr.id, "character_id": expr.character_id,
            "expression_type": expr.expression_type,
            "trigger_condition": expr.trigger_condition,
            "image_prompt": expr.image_prompt,
            "pose_description": expr.pose_description,
            "dialogue_line": expr.dialogue_line,
        },
    }


# ======================================================================
# 战斗系统 v2：服务端权威的回合制战斗
# ======================================================================

def _json(v, default=None):
    if isinstance(v, (list, dict)):
        return v
    if not v:
        return default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def _char_battle_states(db: Session, character_id: int) -> dict:
    """取角色绑定的「战斗状态」图（character_states，state_type=battle）。

    约定结构见 models/character_state.py：
      standing/attack/defend/cast/ultimate/defeated 为单图（key 用 "100"）；
      hurt 按 HP 百分比分档：{"80": url, "60": url, "40": url, "20": url, "5": url}
    """
    from ..models.character_state import CharacterState, CharacterStateBinding
    states: dict = {}
    try:
        bindings = db.query(CharacterStateBinding).filter(
            CharacterStateBinding.character_id == character_id).all()
        for b in bindings:
            st = db.query(CharacterState).filter(CharacterState.id == b.state_id).first()
            if st and st.state_type == "battle":
                data = _json(st.content, {})
                if isinstance(data, dict):
                    states.update(data)
    except Exception:  # noqa: BLE001
        pass
    return states


def _pick_img(v) -> str:
    """从 {阈值: url} 或字符串里取一张图（阈值从高到低）。"""
    if not v:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        keys = sorted(v.keys(), key=lambda k: -(float(k) if _is_num(k) else 0))
        for k in keys:
            s = _pick_img(v[k])
            if s:
                return s
    return ""


def _is_num(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _char_art(db: Session, character_id: int) -> dict:
    """给战斗单位准备一份可直接用的美术资源包。

    前端不需要知道后台的存储结构，按 mode + 血量选图即可：
      art.portrait   全身立绘（背包 / 结算用）
      art.idle       站立待机（默认显示）
      art.attack / art.cast / art.defend / art.ultimate / art.down
      art.hurt       [{"min": 80, "url": ...}, ...]  按当前血量百分比从高到低档位
      art.faces      {normal/happy/angry/...}  原始表情图（兜底与扩展用）

    数据来源优先级：
      1) character_states(state_type=battle) 精细化配置（含损血分档）
      2) characters.expressions 表情图（normal/happy/angry）自动兜底：
         血量 >60% 用 normal，30%~60% 用 angry，≤30% 用 hurt/angry
    这样即使一次都没配过，玩家角色也会随掉血换表情，不会永远是同一张。
    """
    ch = db.query(Character).filter(Character.id == character_id).first()
    portrait = (ch.portrait_image if ch else "") or ""
    faces = _json(getattr(ch, "expressions", None), {}) if ch else {}
    if not isinstance(faces, dict):
        faces = {}
    faces = {k: v for k, v in faces.items() if isinstance(v, str) and v}

    states = _char_battle_states(db, character_id)

    def one(*names: str) -> str:
        for n in names:
            s = _pick_img(states.get(n))
            if s:
                return s
        return ""

    art = {
        "portrait": portrait,
        "faces": faces,
        "idle": one("standing", "idle", "battle") or faces.get("normal") or portrait or "",
        "attack": one("attack"),
        "cast": one("cast", "skill"),
        "defend": one("defend"),
        "ultimate": one("ultimate"),
        "down": one("defeated", "down"),
        "hurt": [],
    }

    # 损血分档：优先用后台配的 hurt（按 HP 百分比），没有就用表情图推导
    hurt_raw = states.get("hurt")
    ladder: list[dict] = []
    if isinstance(hurt_raw, dict):
        for k, v in hurt_raw.items():
            url = _pick_img(v)
            if url and _is_num(k):
                ladder.append({"min": float(k), "url": url})
    if not ladder:
        normal = faces.get("normal") or art["idle"]
        angry = faces.get("angry") or faces.get("sad") or faces.get("hurt")
        if normal and angry and angry != normal:
            ladder = [{"min": 60, "url": normal}, {"min": 30, "url": angry}]
        elif normal:
            ladder = [{"min": 60, "url": normal}]
    ladder.sort(key=lambda x: -x["min"])
    art["hurt"] = ladder

    # 受伤/行动图缺省时退回 idle，避免前端拿到空串反复判断
    for k in ("attack", "cast", "defend", "ultimate"):
        if not art[k]:
            art[k] = ""
    return art


def _char_portrait_states(db: Session, character_id: int) -> tuple[str, dict]:
    """旧接口：返回 (立绘, states)。states 保留后台原始结构，兼容既有前端与测试。"""
    ch = db.query(Character).filter(Character.id == character_id).first()
    portrait = (ch.portrait_image if ch else "") or ""
    states = _char_battle_states(db, character_id)
    if not states and ch and ch.expressions:
        data = _json(ch.expressions, {})
        if isinstance(data, dict) and data:
            states = {"standing": {"100": data.get("normal") or next(iter(data.values()), "")}}
    return portrait, states



def _skills_of(db: Session, character_id: int, level: int) -> list[dict]:
    """角色可用技能 = 已学技能 + 等级达标且标记 auto_learn 的技能。"""
    rows = db.query(CharacterSkill).filter(CharacterSkill.character_id == character_id).all()
    ids = {r.skill_id for r in rows}
    out = []
    for sk in db.query(Skill).all():
        if sk.id in ids or (sk.auto_learn and level >= (sk.required_level or 1)):
            out.append({
                "id": sk.id, "name": sk.name, "skill_type": sk.skill_type,
                "power": sk.power, "mp_cost": sk.mp_cost, "hp_cost": sk.hp_cost,
                "accuracy": sk.accuracy, "critical_rate": sk.critical_rate,
                "target_type": sk.target_type, "element": sk.element,
                "status_effect": sk.status_effect, "effects": sk.effects,
                "rage_cost": sk.rage_cost, "is_ultimate": sk.is_ultimate,
                "hits": sk.hits, "cooldown": sk.cooldown,
                "image": sk.image, "description": sk.description,
                "visual_effect": sk.visual_effect,
            })
    out.sort(key=lambda s: (s["is_ultimate"], s["mp_cost"]))
    return out


def _player_skills_from_books(db: Session, uc: UserCharacter) -> list[dict]:
    """玩家可用技能 = 已装备「技能书」所授予技能的合集。

    数据源优先级（保证与前台人物面板、后台「技能书」栏目完全一致）：
      1) user_character_skill_books —— 后台「技能书」库直接装备到 4 个槽位的书（权威源）
      2) user_character_equipments slot='skill' 且 equipment.skill_ids —— 历史数据兼容
      3) 都没有 → 回退模板人物的「已学 + auto_learn」技能，避免无技能可用导致战斗卡死
    """
    skill_ids: set = set()

    # 1) 新：技能书槽位（后台「技能书」栏目）
    for r in db.query(UserCharacterSkillBook).filter(
        UserCharacterSkillBook.user_character_id == uc.id,
    ).all():
        if r.skill_id:
            skill_ids.add(int(r.skill_id))

    # 2) 旧：equipment 型技能书（兼容历史数据）
    if not skill_ids:
        rows = db.query(UserCharacterEquipment).filter(
            UserCharacterEquipment.user_character_id == uc.id,
            UserCharacterEquipment.slot == "skill",
        ).all()
        for r in rows:
            eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
            if eq and eq.skill_ids:
                try:
                    for sid in json.loads(eq.skill_ids):
                        skill_ids.add(int(sid))
                except Exception:
                    pass

    if not skill_ids:
        # 未装备技能书 → 回退模板人物技能，保证战斗可玩
        return _skills_of(db, uc.base_character_id, uc.level or 1)
    out = []
    for sk in db.query(Skill).all():
        if sk.id in skill_ids:
            out.append({
                "id": sk.id, "name": sk.name, "skill_type": sk.skill_type,
                "power": sk.power, "mp_cost": sk.mp_cost, "hp_cost": sk.hp_cost,
                "accuracy": sk.accuracy, "critical_rate": sk.critical_rate,
                "target_type": sk.target_type, "element": sk.element,
                "status_effect": sk.status_effect, "effects": sk.effects,
                "rage_cost": sk.rage_cost, "is_ultimate": sk.is_ultimate,
                "hits": sk.hits, "cooldown": sk.cooldown,
                "image": sk.image, "description": sk.description,
                "visual_effect": sk.visual_effect,
            })
    out.sort(key=lambda s: (s["is_ultimate"], s["mp_cost"]))
    return out


def _items_of(db: Session, uc_id: int | None) -> list[dict]:
    if not uc_id:
        return []
    rows = db.query(UserCharacterInventory).filter(
        UserCharacterInventory.user_character_id == uc_id,
        UserCharacterInventory.item_kind == "item",
        UserCharacterInventory.quantity > 0,
    ).all()
    out = []
    for r in rows:
        item = db.query(Item).filter(Item.id == r.item_id).first()
        if not item:
            continue
        out.append({
            "id": item.id, "name": item.name, "image": item.image or "",
            "quantity": r.quantity, "rarity": item.rarity,
            "description": item.description or "",
            "effects": item.effects or item.effect or "[]",
        })
    return out


def _build_player_unit(db: Session, uc: UserCharacter, index: int, player_level: int) -> dict:
    base = db.query(Character).filter(Character.id == uc.base_character_id).first()
    portrait, states = _char_portrait_states(db, uc.base_character_id)
    art = _char_art(db, uc.base_character_id)
    realm = db.query(CharacterRealm).filter(CharacterRealm.level == max(1, min(40, uc.realm_level or 1))).first()
    return E.make_unit(
        uid=f"p{index}", side="player",
        name=uc.custom_name or (base.name if base else "玩家"),
        character_id=uc.base_character_id, user_character_id=uc.id,
        level=uc.level, realm_name=realm.full_name if realm else "",
        hp=uc.hp, max_hp=uc.max_hp, mp=uc.mp, max_mp=uc.max_mp,
        attack=uc.attack, defense=uc.defense, speed=uc.speed, luck=uc.luck,
        element=(getattr(base, "element", None) or "none") if base else "none",
        portrait=portrait, states=states, art=art,
        skills=_player_skills_from_books(db, uc),
        items=_items_of(db, uc.id),
        ai={"type": "player", "skill_chance": 0.9},
    )


def _resolve_skill_ref(db: Session, ref) -> dict | None:
    """技能引用可以是 skill_id(int/数字字符串)，也可以是技能名。"""
    sk = None
    if isinstance(ref, (int, float)):
        sk = db.query(Skill).filter(Skill.id == int(ref)).first()
    elif isinstance(ref, str):
        if ref.strip().isdigit():
            sk = db.query(Skill).filter(Skill.id == int(ref.strip())).first()
        else:
            sk = db.query(Skill).filter(Skill.name == ref.strip()).first()
    if not sk:
        return None
    return {
        "id": sk.id, "name": sk.name, "skill_type": sk.skill_type, "power": sk.power,
        "mp_cost": sk.mp_cost, "hp_cost": sk.hp_cost, "accuracy": sk.accuracy,
        "critical_rate": sk.critical_rate, "target_type": sk.target_type,
        "element": sk.element, "effects": sk.effects, "status_effect": sk.status_effect,
        "rage_cost": sk.rage_cost, "is_ultimate": sk.is_ultimate, "hits": sk.hits,
        "cooldown": sk.cooldown, "image": sk.image, "description": sk.description,
        "visual_effect": sk.visual_effect,
    }


def _build_enemy_unit(db: Session, cfg: dict, index: int, player_level: int,
                      difficulty: float = 1.0, player_unit: dict | None = None,
                      enemies_count: int = 1) -> dict | None:
    """按配置构建敌人单位。

    level_mode:
      - match（默认）：以玩家为基准生成"同水平对手"，属性 = 玩家属性 × 各项比例 × power，
        这样设计者不用为每场战斗手调数值，玩家升级后敌人也同步成长，难度稳定。
      - scale：以敌人模板等级为基准，按 (目标等级/模板等级)^0.9 缩放（适合强弱分明的手工设计）。
      - fixed：直接用模板原始数值。
    """
    cid = cfg.get("character_id") or cfg.get("id")
    ch = db.query(Character).filter(Character.id == cid).first()
    if not ch:
        return None

    mode = cfg.get("level_mode") or "match"
    base_level = max(1, int(ch.level or 1))
    power = float(cfg.get("power") or 1.0)
    target = max(1, int(player_level + int(cfg.get("level_offset") or 0)))

    if mode == "match" and player_unit:
        pb = player_unit.get("base", {})
        n = max(1, int(enemies_count))
        hp_share = 1.0 / (1 + 0.40 * (n - 1))     # 敌人越多，单体血量越低
        atk_share = 1.0 / (1 + 0.18 * (n - 1))
        max_hp = pb.get("max_hp", 100) * float(cfg.get("hp_ratio", 1.0)) * power * hp_share * difficulty
        atk = pb.get("attack", 10) * float(cfg.get("atk_ratio", 0.8)) * power * atk_share * difficulty
        dfn = pb.get("defense", 5) * float(cfg.get("def_ratio", 0.8)) * power
        spd = pb.get("speed", 5) * float(cfg.get("spd_ratio", 1.0)) * (0.95 + 0.1 * power)
        mp = pb.get("max_mp", 50) * 0.8
        luck = pb.get("luck", 5)
    elif mode == "fixed":
        max_hp = float(cfg.get("max_hp") or ch.max_hp)
        atk = float(cfg.get("attack") or ch.attack)
        dfn = float(cfg.get("defense") or ch.defense)
        spd = float(cfg.get("speed") or ch.speed)
        mp = float(cfg.get("max_mp") or ch.max_mp)
        luck = float(cfg.get("luck") or ch.luck)
    else:  # scale
        factor = 1.0
        if base_level > 0 and target != base_level:
            factor = max(0.25, min(2.5, (target / base_level) ** 0.9))
        factor *= float(cfg.get("stat_scale") or 1.0) * difficulty * power
        max_hp = float(cfg.get("max_hp") or ch.max_hp) * factor
        atk = float(cfg.get("attack") or ch.attack) * factor
        dfn = float(cfg.get("defense") or ch.defense) * factor
        spd = float(cfg.get("speed") or ch.speed) * factor
        mp = float(cfg.get("max_mp") or ch.max_mp) * factor
        luck = float(cfg.get("luck") or ch.luck)

    # 显式覆盖优先
    if cfg.get("max_hp"):
        max_hp = float(cfg["max_hp"])
    if cfg.get("attack"):
        atk = float(cfg["attack"])
    if cfg.get("defense"):
        dfn = float(cfg["defense"])
    if cfg.get("speed"):
        spd = float(cfg["speed"])

    portrait, states = _char_portrait_states(db, ch.id)
    art = _char_art(db, ch.id)
    raw_skills = cfg.get("skills")
    if raw_skills:
        skills = []
        for s in raw_skills:
            if isinstance(s, dict):
                skills.append(s)
            else:
                resolved = _resolve_skill_ref(db, s)
                if resolved:
                    skills.append(resolved)
    else:
        skills = _skills_of(db, ch.id, target)

    ai = cfg.get("ai") or {"type": "aggressive", "skill_chance": 0.7}
    if isinstance(ai, str):
        ai = {"type": ai}

    phases = []
    for ph in (cfg.get("phases") or []):
        ph = dict(ph)
        if ph.get("skills") and all(not isinstance(s, dict) for s in ph["skills"]):
            resolved = []
            for ref in ph["skills"]:
                r = _resolve_skill_ref(db, ref)
                if r:
                    resolved.append(r)
            ph["skills"] = resolved
        phases.append(ph)

    drops = []
    for d in (cfg.get("drops") or []):
        d = dict(d)
        if d.get("item_id") and not d.get("name"):
            it = db.query(Item).filter(Item.id == d["item_id"]).first()
            if it:
                d["name"] = it.name
                d["image"] = it.image or ""
        drops.append(d)

    exp_reward = cfg.get("exp_reward")
    if exp_reward is None:
        exp_reward = (12 * max(1, int(target)) + 30) * difficulty * (1 + 0.15 * (enemies_count - 1))

    return E.make_unit(
        uid=f"e{index}", side="enemy",
        name=cfg.get("name") or ch.name,
        character_id=ch.id, level=target,
        hp=max(1.0, max_hp), max_hp=max(1.0, max_hp),
        mp=max(0.0, mp), max_mp=max(0.0, mp),
        attack=max(1.0, atk), defense=max(0.0, dfn),
        speed=max(1.0, spd), luck=max(1.0, luck),
        element=cfg.get("element") or "none",
        portrait=portrait, states=states, art=art,
        skills=skills, ai=ai, drops=drops, phases=phases,
        exp_reward=exp_reward,
        is_boss=bool(cfg.get("is_boss") or phases),
    )


def _resolve_node_config(node: StoryNode | None) -> dict:
    cfg = _json(node.battle_config, {}) if node else {}
    return cfg if isinstance(cfg, dict) else {}


def _auto_enemy_configs(db: Session, node: StoryNode | None) -> list[dict]:
    """节点没写 battle_config 时，沿用旧的自动解析：场景NPC → 节点人物 → 说话者。"""
    ids: list[int] = []
    if node:
        scene_id = node.scene_id
        if scene_id:
            try:
                from ..models.scene import SceneNPC
                for npc in db.query(SceneNPC).filter(SceneNPC.scene_id == scene_id).all():
                    ch = db.query(Character).filter(Character.id == npc.character_id).first()
                    if ch and ch.character_type in ("enemy", "npc"):
                        ids.append(ch.id)
            except Exception:  # noqa: BLE001
                pass
        if not ids:
            arr = _json(node.multi_characters, []) or []
            for item in arr:
                if isinstance(item, dict) and item.get("speaker_id"):
                    ids.append(item["speaker_id"])
        if not ids and node.speaker_id:
            ids.append(node.speaker_id)
    if not ids:
        ids = [2]
    seen, out = set(), []
    for i in ids:
        if i in seen:
            continue
        seen.add(i)
        out.append({"character_id": i, "level_mode": "match"})
    return out


def _load_battle(db: Session, battle_id: int, user: User) -> Battle:
    battle = db.query(Battle).filter(Battle.id == battle_id).first()
    if not battle:
        raise HTTPException(status_code=404, detail="战斗不存在")
    uc = db.query(UserCharacter).filter(
        UserCharacter.id == battle.user_character_id, UserCharacter.user_id == user.id).first()
    if battle.user_character_id and not uc:
        raise HTTPException(status_code=403, detail="无权访问该战斗")
    return battle


def _save_state(db: Session, battle: Battle, state: dict) -> None:
    battle.state = json.dumps(state, ensure_ascii=False)
    battle.round = int(state.get("round") or 1)
    battle.status = state.get("status") or "active"
    if state.get("status") != "active" and not battle.ended_at:
        battle.ended_at = datetime.now().isoformat()
    db.commit()


def _record_turn(db: Session, battle: Battle, state: dict, uid: str,
                 action: dict, events: list[dict]) -> None:
    actor = E.unit_by_uid(state, uid)
    if not actor or not actor.get("character_id"):
        return
    damage = 0
    crit = 0
    targets: list[str] = []
    skill_name = None
    for ev in events:
        if ev["t"] == "cast":
            skill_name = ev.get("skill")
            targets = ev.get("targets") or []
        if ev["t"] == "damage" and ev.get("uid") in targets:
            damage += int(ev.get("value") or 0)
            crit = 1 if ev.get("crit") else crit
    target_uids = [u for u in targets if u != uid]
    turn = BattleTurn(
        battle_id=battle.id,
        turn_number=int(state.get("turn_no") or 1),
        actor_id=actor.get("character_id") or 0,
        action_type=action.get("type") or "attack",
        skill_id=action.get("skill_id"),
        target_id=(E.unit_by_uid(state, target_uids[0]).get("character_id")
                   if target_uids and E.unit_by_uid(state, target_uids[0]) else (actor.get("character_id") or 0)),
        damage=damage,
        is_critical=crit,
        actor_uid=uid,
        target_uids=json.dumps(target_uids, ensure_ascii=False),
        skill_name=skill_name,
        result=json.dumps(events, ensure_ascii=False)[:60000],
    )
    db.add(turn)
    db.commit()


# ---------------- 开始战斗 ----------------

@router.post("/v2/start")
def battle_v2_start(data: BattleV2Start, user: User = Depends(require_user),
                    db: Session = Depends(get_db)):
    uc = None
    if data.user_character_id:
        uc = db.query(UserCharacter).filter(
            UserCharacter.id == data.user_character_id,
            UserCharacter.user_id == user.id).first()
        if not uc:
            raise HTTPException(status_code=404, detail="角色不存在")
    if not uc:
        uc = db.query(UserCharacter).filter(UserCharacter.user_id == user.id).order_by(
            UserCharacter.id.desc()).first()
    if not uc:
        raise HTTPException(status_code=400, detail="请先创建人物再进入战斗")

    node = None
    if data.story_node_id:
        node = db.query(StoryNode).filter(StoryNode.id == data.story_node_id).first()

    cfg = _resolve_node_config(node)
    if data.config_override:
        cfg = {**cfg, **(data.config_override if isinstance(data.config_override, dict) else {})}
    difficulty = float(cfg.get("difficulty") or 1.0)
    player_level = max(1, int(uc.level or 1))

    units: list[dict] = [_build_player_unit(db, uc, 1, player_level)]
    # 友方（可选：传 ally_character_ids，跟随玩家等级生成同伴）
    for i, aid in enumerate(data.ally_character_ids or [], start=2):
        ally_cfg = {"character_id": aid, "level_mode": "match", "power": 0.9}
        u = _build_enemy_unit(db, ally_cfg, i, player_level, difficulty,
                              player_unit=units[0], enemies_count=1)
        if u:
            u["side"] = "player"
            u["uid"] = f"p{i}"
            u["is_ally"] = True
            # 同伴默认由 AI 接管（auto=True），玩家只需操作自己的角色；
            # 想全队手动，把 battle_config.ally_manual 打开即可。
            u["ai"] = {"type": "aggressive", "skill_chance": 0.8,
                       "auto": not bool(cfg.get("ally_manual"))}
            u["drops"] = []
            units.append(u)

    enemy_cfgs = data.enemies if data.enemies else (cfg.get("enemies") or _auto_enemy_configs(db, node))
    enemy_cfgs = [c if isinstance(c, dict) else {"character_id": c} for c in enemy_cfgs]
    idx = 1
    for ecfg in enemy_cfgs:
        u = _build_enemy_unit(db, ecfg, idx, player_level, difficulty,
                              player_unit=units[0], enemies_count=len(enemy_cfgs))
        if u:
            units.append(u)
            idx += 1
    if not any(u["side"] == "enemy" for u in units):
        raise HTTPException(status_code=400, detail="没有可用的敌人，请检查战斗节点配置")

    engine_config = {
        "difficulty": difficulty,
        "allow_flee": cfg.get("allow_flee", True),
        "exp_multiplier": cfg.get("exp_multiplier", 1.0),
        "background": cfg.get("background") or (node.background_change if node else "") or "",
        "bgm": cfg.get("bgm") or (node.bgm if node else "") or "",
        "victory_node_id": cfg.get("victory_node_id"),
        "defeat_node_id": cfg.get("defeat_node_id"),
        "flee_node_id": cfg.get("flee_node_id"),
        "defeat_penalty": cfg.get("defeat_penalty") or "half_hp",
        "banter": cfg.get("banter") or [],
    }
    state = E.create_state(units, engine_config, meta={
        "story_node_id": node.id if node else None,
        "user_character_id": uc.id,
        "player_name": uc.custom_name,
    })

    battle = Battle(
        story_node_id=node.id if node else None,
        scene_id=(node.scene_id if node else None),
        user_character_id=uc.id,
        battle_type=data.battle_type or ("boss" if any(u.get("is_boss") for u in units) else "story"),
        status="active",
        player_party=json.dumps([u.get("character_id") for u in units if u["side"] == "player"]),
        enemy_party=json.dumps([u.get("character_id") for u in units if u["side"] == "enemy"]),
        config=json.dumps(engine_config, ensure_ascii=False),
    )
    db.add(battle)
    db.commit()
    db.refresh(battle)

    events = E.advance(state)
    _save_state(db, battle, state)
    return {"battle_id": battle.id, "state": E.to_client_state(state), "events": events}


# ---------------- 查询 ----------------

@router.get("/v2/{battle_id}")
def battle_v2_state(battle_id: int, user: User = Depends(require_user),
                    db: Session = Depends(get_db)):
    battle = _load_battle(db, battle_id, user)
    state = _json(battle.state, {}) or {}
    if not state:
        raise HTTPException(status_code=404, detail="该战斗没有进行中的状态")
    return {"battle_id": battle.id, "state": E.to_client_state(state),
            "events": [], "rewards": _json(battle.rewards)}


@router.get("/{battle_id}", response_model=BattleResponse)
def get_battle(battle_id: int, db: Session = Depends(get_db)):
    battle = db.query(Battle).filter(Battle.id == battle_id).first()
    if not battle:
        raise HTTPException(status_code=404, detail="战斗不存在")
    return battle


# ---------------- 出招 ----------------

@router.post("/v2/{battle_id}/action")
def battle_v2_action(battle_id: int, data: BattleV2Action,
                     user: User = Depends(require_user), db: Session = Depends(get_db)):
    battle = _load_battle(db, battle_id, user)
    state = _json(battle.state, {}) or {}
    if not state:
        raise HTTPException(status_code=404, detail="战斗状态已失效")
    if state.get("status") != "active":
        return {"battle_id": battle.id, "state": E.to_client_state(state), "events": [],
                "rewards": _json(battle.rewards)}

    uid = data.uid or state.get("turn_uid")
    if not uid:
        # 没有待输入单位时，先推进
        events = E.advance(state)
        _save_state(db, battle, state)
        return {"battle_id": battle.id, "state": E.to_client_state(state), "events": events,
                "rewards": _json(battle.rewards)}

    action = {
        "type": data.type or "attack",
        "skill_id": data.skill_id,
        "target_uid": data.target_uid,
        "item_id": data.item_id,
    }
    events = E.submit_action(state, uid, action)
    _record_turn(db, battle, state, uid, action, events)
    _save_state(db, battle, state)
    return {"battle_id": battle.id, "state": E.to_client_state(state), "events": events,
            "rewards": _json(battle.rewards)}


@router.post("/v2/{battle_id}/auto")
def battle_v2_auto(battle_id: int, data: BattleV2Auto,
                   user: User = Depends(require_user), db: Session = Depends(get_db)):
    """切换自动战斗；enabled=true 时直接把当前待输入单位交给 AI 并推进。"""
    battle = _load_battle(db, battle_id, user)
    state = _json(battle.state, {}) or {}
    if not state:
        raise HTTPException(status_code=404, detail="战斗状态已失效")
    E.set_auto(state, bool(data.enabled))
    events = E.auto_run(state) if data.enabled else E.advance(state)
    _save_state(db, battle, state)
    return {"battle_id": battle.id, "state": E.to_client_state(state), "events": events,
            "rewards": _json(battle.rewards)}


@router.post("/v2/{battle_id}/flee")
def battle_v2_flee(battle_id: int, user: User = Depends(require_user),
                   db: Session = Depends(get_db)):
    battle = _load_battle(db, battle_id, user)
    state = _json(battle.state, {}) or {}
    if not state or state.get("status") != "active":
        return {"battle_id": battle.id, "state": E.to_client_state(state or {}), "events": []}
    uid = state.get("turn_uid") or next(
        (u["uid"] for u in state["units"] if u["side"] == "player" and u.get("alive")), None)
    events = E.submit_action(state, uid, {"type": "flee"}) if uid else E.advance(state)
    _save_state(db, battle, state)
    return {"battle_id": battle.id, "state": E.to_client_state(state), "events": events}


# ---------------- 结算 ----------------

def _apply_level_ups(db: Session, uc: UserCharacter, rewards: dict) -> dict:
    """把经验/升级/境界/掉落/学技能写回用户角色。返回补充说明。"""
    extra = {"skills": [], "realm": None, "attrs": {}}
    table = {r.level: r.exp_required for r in db.query(LevelUpTable).all()}

    gained_exp = int(rewards.get("exp") or 0)
    if gained_exp:
        uc.exp = int(uc.exp or 0) + gained_exp

    def need(level: int) -> int:
        if table.get(level) is not None:
            return max(1, int(table[level]))
        return int(45 * ((level + 1) ** 1.75) + 40)

    guard = 0
    while guard < 500:
        guard += 1
        lv = int(uc.level or 1)
        req = need(lv)
        if int(uc.exp or 0) < req or lv >= 60:
            break
        uc.exp = int(uc.exp or 0) - req
        uc.level = lv + 1
        row = db.query(LevelUpTable).filter(LevelUpTable.level == uc.level).first()
        hp_g = row.hp_growth if row else 12 + uc.level * 3
        mp_g = row.mp_growth if row else 4 + uc.level
        atk_g = row.attack_growth if row else 2 + uc.level // 3
        def_g = row.defense_growth if row else 1 + uc.level // 4
        spd_g = row.speed_growth if row else 1 + uc.level // 6
        uc.max_hp = int(uc.max_hp or 100) + int(hp_g)
        uc.max_mp = int(uc.max_mp or 50) + int(mp_g)
        uc.attack = int(uc.attack or 10) + int(atk_g)
        uc.defense = int(uc.defense or 5) + int(def_g)
        uc.speed = int(uc.speed or 5) + int(spd_g)
        extra["attrs"] = {
            "max_hp": int(hp_g), "max_mp": int(mp_g), "attack": int(atk_g),
            "defense": int(def_g), "speed": int(spd_g), "level": uc.level,
        }
        # 每 5 级一次境界突破
        if uc.level % 5 == 0:
            new_realm = min(40, int(uc.realm_level or 1) + 1)
            if new_realm != int(uc.realm_level or 1):
                uc.realm_level = new_realm
                realm_row = db.query(CharacterRealm).filter(
                    CharacterRealm.level == new_realm).first()
                if realm_row:
                    uc.max_hp = max(int(uc.max_hp or 0), int(realm_row.max_hp))
                    uc.max_mp = max(int(uc.max_mp or 0), int(realm_row.max_mp))
                    uc.attack = max(int(uc.attack or 0), int(realm_row.attack))
                    uc.defense = max(int(uc.defense or 0), int(realm_row.defense))
                    uc.speed = max(int(uc.speed or 0), int(realm_row.speed))
                    extra["realm"] = realm_row.full_name
                else:
                    extra["realm"] = f"境界 {new_realm}"

    # 等级达标自动学技能
    owned = {r.skill_id for r in db.query(CharacterSkill).filter(
        CharacterSkill.character_id == uc.base_character_id).all()}
    for sk in db.query(Skill).filter(Skill.auto_learn == 1).all():
        if sk.id not in owned and int(uc.level or 1) >= int(sk.required_level or 1):
            db.add(CharacterSkill(character_id=uc.base_character_id, skill_id=sk.id, skill_level=1))
            extra["skills"].append(sk.name)

    # 掉落进背包
    for d in rewards.get("drops") or []:
        if not d.get("item_id"):
            continue
        row = db.query(UserCharacterInventory).filter(
            UserCharacterInventory.user_character_id == uc.id,
            UserCharacterInventory.item_id == d["item_id"],
            UserCharacterInventory.item_kind == "item").first()
        if row:
            row.quantity = int(row.quantity or 0) + int(d.get("quantity") or 1)
        else:
            db.add(UserCharacterInventory(user_character_id=uc.id, item_id=d["item_id"],
                                          item_kind="item", quantity=int(d.get("quantity") or 1)))

    uc.hp = max(1, min(int(uc.max_hp), int(uc.hp or uc.max_hp)))
    uc.updated_at = datetime.now().isoformat()
    db.commit()
    return extra


@router.post("/v2/{battle_id}/settle")
def battle_v2_settle(battle_id: int, user: User = Depends(require_user),
                     db: Session = Depends(get_db)):
    """战斗结束后结算：经验、升级、掉落、学技能、写回血量。幂等。"""
    battle = _load_battle(db, battle_id, user)
    state = _json(battle.state, {}) or {}
    if not state:
        raise HTTPException(status_code=404, detail="战斗状态已失效")

    rewards = _json(battle.rewards)
    if rewards is None:
        table = {r.level: r.exp_required for r in db.query(LevelUpTable).all()}
        rewards = E.settle_rewards(state, level_table=table)
        rewards["status"] = state.get("status")

        uc = db.query(UserCharacter).filter(UserCharacter.id == battle.user_character_id).first()
        result = state.get("status")
        if uc:
            if result == "player_won":
                rewards["extra"] = _apply_level_ups(db, uc, rewards)
            elif result == "enemy_won":
                # 战败惩罚（默认半血复活，便于再战）
                penalty = (state.get("config") or {}).get("defeat_penalty", "half_hp")
                if penalty == "half_hp":
                    uc.hp = max(1, int(int(uc.max_hp or 100) * 0.5))
                elif penalty == "one":
                    uc.hp = 1
                uc.exp = int(uc.exp or 0)
                db.commit()
            elif result == "fled":
                uc.hp = max(1, int(uc.hp or 1))
                db.commit()
            rewards["character"] = {
                "id": uc.id, "level": uc.level, "exp": uc.exp, "realm_level": uc.realm_level,
                "hp": uc.hp, "max_hp": uc.max_hp, "mp": uc.mp, "max_mp": uc.max_mp,
                "attack": uc.attack, "defense": uc.defense, "speed": uc.speed, "luck": uc.luck,
            }
        battle.rewards = json.dumps(rewards, ensure_ascii=False)
        battle.exp_gained = int(rewards.get("exp") or 0)
        battle.coin_gained = int(rewards.get("coin") or 0)
        battle.drops = json.dumps(rewards.get("drops") or [], ensure_ascii=False)
        db.commit()

    return {"battle_id": battle.id, "status": state.get("status"), "rewards": rewards}
