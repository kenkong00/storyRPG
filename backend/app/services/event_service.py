"""
事件业务逻辑：事件检测、触发、NPC介入
"""
import json
from sqlalchemy.orm import Session

from ..models.event import Event, EventLog
from ..models.character import Character
from ..models.relationship import CharacterRelationship


def detect_events(
    trigger_type: str,
    context: dict,
    db: Session,
) -> list[dict]:
    """检测可触发的事件"""
    events = db.query(Event).filter(
        Event.trigger_type == trigger_type,
        (Event.is_one_time == 0) | (Event.has_triggered == 0),
    ).order_by(Event.priority.desc()).all()

    available = []
    for event in events:
        if _check_event_condition(event, context, db):
            available.append({
                "id": event.id,
                "name": event.name,
                "event_type": event.event_type,
                "priority": event.priority,
                "effects": json.loads(event.effects) if event.effects else {},
            })

    return available


def _check_event_condition(event: Event, context: dict, db: Session) -> bool:
    """检查事件触发条件"""
    if not event.trigger_condition:
        return True

    try:
        conditions = json.loads(event.trigger_condition)
    except json.JSONDecodeError:
        return True

    if "battle_type" in conditions and context.get("battle_type") != conditions["battle_type"]:
        return False
    if "player_hp_below" in conditions and context.get("player_hp_percent", 100) >= conditions["player_hp_below"]:
        return False
    if "flag" in conditions:
        from ..models.story import StoryFlag
        flag = db.query(StoryFlag).filter(StoryFlag.flag_key == conditions["flag"]).first()
        if not flag or flag.flag_value != "1":
            return False
    if "scene_id" in conditions and context.get("scene_id") != conditions["scene_id"]:
        return False
    if "npc_id" in conditions:
        npc = db.query(Character).filter(Character.name == conditions["npc_id"]).first()
        if npc:
            if "favorability" in conditions:
                player = db.query(Character).filter(Character.character_type == "player").first()
                if player:
                    rel = db.query(CharacterRelationship).filter(
                        (CharacterRelationship.character_id == player.id) & (CharacterRelationship.related_character_id == npc.id)
                    ).first()
                    if not rel or rel.favorability < conditions["favorability"]:
                        return False

    return True


def trigger_event(event_id: int, context: dict, db: Session) -> dict:
    """触发事件并执行效果"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        return {"error": "事件不存在"}
    if event.is_one_time and event.has_triggered:
        return {"error": "一次性事件已触发过"}

    # 记录事件
    log = EventLog(event_id=event_id, context=json.dumps(context))
    db.add(log)
    event.has_triggered = 1

    # 执行效果
    results = _apply_event_effects(event, db)

    db.commit()
    return {
        "triggered": True,
        "event_id": event.id,
        "event_name": event.name,
        "event_type": event.event_type,
        "results": results,
        "has_story_node": event.story_node_id is not None,
        "story_node_id": event.story_node_id,
    }


def _apply_event_effects(event: Event, db: Session) -> list[dict]:
    """应用事件效果"""
    results = []
    if not event.effects:
        return results

    try:
        effects = json.loads(event.effects)
    except json.JSONDecodeError:
        return results

    if "set_party_member" in effects:
        npc_name = effects["set_party_member"]
        npc = db.query(Character).filter(Character.name == npc_name).first()
        if npc:
            npc.is_party_member = 1
            if "set_character_type" in effects:
                npc.character_type = effects["set_character_type"]
            results.append({"action": "npc_join", "npc": npc_name})

    if "npc_join_battle" in effects:
        npc_name = effects["npc_join_battle"]
        npc = db.query(Character).filter(Character.name == npc_name).first()
        if npc:
            results.append({"action": "npc_intervention", "npc": npc_name, "npc_id": npc.id})

    if "start_battle" in effects:
        boss_name = effects["start_battle"]
        boss = db.query(Character).filter(Character.name == boss_name).first()
        if boss:
            results.append({"action": "start_battle", "enemy": boss_name, "enemy_id": boss.id})

    return results