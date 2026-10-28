"""
战斗业务逻辑：回合计算、伤害计算、战斗状态管理
"""
import random
from sqlalchemy.orm import Session

from ..models.battle import Battle, BattleTurn, CombatExpression
from ..models.character import Character
from ..models.skill import Skill


def calculate_damage(
    attacker: Character,
    defender: Character,
    skill: Skill | None = None,
) -> dict:
    """计算伤害"""
    if skill and skill.skill_type == "magic":
        base_damage = attacker.attack * 0.5 + skill.power * 1.5
    elif skill:
        base_damage = attacker.attack * 0.8 + skill.power * 1.2
    else:
        base_damage = attacker.attack * 1.0

    # 防御减免
    damage = max(1, int(base_damage - defender.defense * 0.3))

    # 随机波动 (±15%)
    damage = int(damage * random.uniform(0.85, 1.15))

    # 暴击判定
    crit_rate = skill.critical_rate if skill else 5
    is_critical = random.randint(1, 100) <= crit_rate
    if is_critical:
        damage = int(damage * 1.5)

    return {
        "damage": damage,
        "is_critical": is_critical,
        "base_damage": base_damage,
    }


def get_expression(character_id: int, trigger: str, db: Session) -> dict | None:
    """获取战斗表情"""
    expr = db.query(CombatExpression).filter(
        CombatExpression.character_id == character_id,
        CombatExpression.trigger_condition == trigger,
    ).first()
    if not expr:
        return None
    return {
        "expression_type": expr.expression_type,
        "image_prompt": expr.image_prompt,
        "pose_description": expr.pose_description,
        "dialogue_line": expr.dialogue_line,
    }


def execute_turn(
    battle: Battle,
    actor_id: int,
    target_id: int,
    action_type: str,
    skill_id: int | None,
    db: Session,
) -> dict:
    """执行一个战斗回合"""
    actor = db.query(Character).filter(Character.id == actor_id).first()
    target = db.query(Character).filter(Character.id == target_id).first()
    if not actor or not target:
        return {"error": "角色不存在"}

    skill = None
    if skill_id:
        skill = db.query(Skill).filter(Skill.id == skill_id).first()

    turn_number = db.query(BattleTurn).filter(
        BattleTurn.battle_id == battle.id
    ).count() + 1

    result = calculate_damage(actor, target, skill)

    if action_type in ("attack", "skill"):
        target.hp = max(0, target.hp - result["damage"])

    # 获取表情
    hp_percent = target.hp / target.max_hp * 100 if target.max_hp > 0 else 0
    if hp_percent <= 30:
        expr = get_expression(target_id, "hp_below_30", db) or get_expression(target_id, "defeat_near", db)
    elif result["is_critical"]:
        expr = get_expression(target_id, "critical_hit", db)
    elif hp_percent >= 70:
        expr = get_expression(actor_id, "hp_above_70", db)
    else:
        expr = None

    turn = BattleTurn(
        battle_id=battle.id,
        turn_number=turn_number,
        actor_id=actor_id,
        action_type=action_type,
        skill_id=skill_id,
        target_id=target_id,
        damage=result["damage"],
        is_critical=1 if result["is_critical"] else 0,
        target_expression=expr["expression_type"] if expr else None,
        actor_expression=None,
        visual_description=skill.battle_animation_desc if skill else "普通攻击",
    )
    db.add(turn)

    # 检查战斗结束
    if target.hp <= 0:
        battle.status = "player_won" if target.character_type == "enemy" else "enemy_won"
        from datetime import datetime
        battle.ended_at = datetime.now().isoformat()

    db.commit()
    db.refresh(turn)

    return {
        "turn": {
            "turn_number": turn_number,
            "actor_id": actor_id,
            "action_type": action_type,
            "damage": result["damage"],
            "is_critical": result["is_critical"],
            "target_hp_remaining": target.hp,
            "target_max_hp": target.max_hp,
        },
        "expression": expr,
        "battle_status": battle.status,
        "target_defeated": target.hp <= 0,
    }