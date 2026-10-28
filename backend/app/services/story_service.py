"""
故事业务逻辑：剧情推进、条件检查、分支选择
"""
import json
from sqlalchemy.orm import Session

from ..models.story import StoryChapter, StoryNode, StoryChoice, StoryCondition, StoryFlag
from ..models.character import Character, CharacterAttribute
from ..models.relationship import CharacterRelationship


def get_next_node(node_id: int, choice_id: int, db: Session) -> dict:
    """根据选择获取下一个节点"""
    choice = db.query(StoryChoice).filter(
        StoryChoice.id == choice_id,
        StoryChoice.node_id == node_id,
    ).first()
    if not choice:
        return {"error": "选择不存在"}

    if choice.next_node_id:
        return {
            "next_node_id": choice.next_node_id,
            "effects": json.loads(choice.effects) if choice.effects else {},
        }

    # 没有直接下一节点，走条件判断
    if choice.condition_group:
        conditions = db.query(StoryCondition).filter(
            StoryCondition.condition_group == choice.condition_group
        ).all()
        return {
            "next_node_id": None,
            "condition_group": choice.condition_group,
            "conditions": conditions,
            "effects": json.loads(choice.effects) if choice.effects else {},
            "message": "需要根据条件判断下一节点",
        }

    return {"error": "没有配置下一节点或条件"}


def check_conditions(condition_group: str, db: Session) -> tuple[bool, str]:
    """检查条件组是否满足"""
    conditions = db.query(StoryCondition).filter(
        StoryCondition.condition_group == condition_group
    ).all()

    if not conditions:
        return False, f"条件组 '{condition_group}' 不存在"

    for cond in conditions:
        result = _check_single_condition(cond, db)
        if not result[0]:
            return False, f"条件不满足: {result[1]}"

    return True, "所有条件满足"


def _check_single_condition(cond: StoryCondition, db: Session) -> tuple[bool, str]:
    """检查单个条件"""
    operator = cond.operator
    value = cond.value

    if cond.condition_type == "level":
        char = db.query(Character).filter(Character.character_type == "player").first()
        if not char:
            return False, "玩家不存在"
        return _compare(char.level, operator, int(value)), f"等级 {char.level} {operator} {value}"

    elif cond.condition_type == "attribute":
        attr = db.query(CharacterAttribute).filter(
            CharacterAttribute.character_id == cond.target_id,
            CharacterAttribute.attr_key == "wisdom",
        ).first()
        if not attr:
            return False, "属性不存在"
        return _compare(attr.attr_value, operator, int(value)), f"属性值 {attr.attr_value} {operator} {value}"

    elif cond.condition_type == "relationship":
        player = db.query(Character).filter(Character.character_type == "player").first()
        rel = db.query(CharacterRelationship).filter(
            (CharacterRelationship.character_id == player.id) & (CharacterRelationship.related_character_id == cond.target_id)
        ).first()
        if not rel:
            return False, "关系不存在"
        return _compare(rel.favorability, operator, int(value)), f"好感度 {rel.favorability} {operator} {value}"

    elif cond.condition_type == "character_alive":
        char = db.query(Character).filter(Character.id == cond.target_id).first()
        if not char:
            return False, "角色不存在"
        return _compare(char.is_alive, operator, int(value)), f"角色存活状态 {char.is_alive} {operator} {value}"

    elif cond.condition_type == "character_in_party":
        char = db.query(Character).filter(Character.id == cond.target_id).first()
        if not char:
            return False, "角色不存在"
        return _compare(char.is_party_member, operator, int(value)), f"队伍状态 {char.is_party_member} {operator} {value}"

    elif cond.condition_type == "flag":
        flag = db.query(StoryFlag).filter(StoryFlag.flag_key == value).first()
        if operator == "has":
            return (flag is not None and flag.flag_value == "1"), f"标记 {value} 状态"
        elif operator == "not_has":
            return (flag is None or flag.flag_value != "1"), f"标记 {value} 状态"

    elif cond.condition_type == "item":
        from ..models.item import CharacterInventory
        inv = db.query(CharacterInventory).filter(
            CharacterInventory.character_id == cond.target_id,
            CharacterInventory.item_id == int(value),
        ).first()
        if operator == "has":
            return (inv is not None and inv.quantity > 0), f"物品 {value} 持有状态"
        elif operator == "not_has":
            return (inv is None or inv.quantity == 0), f"物品 {value} 持有状态"

    return False, f"未知条件类型: {cond.condition_type}"


def _compare(left: int, operator: str, right: int) -> bool:
    """数值比较"""
    if operator == ">=":
        return left >= right
    elif operator == "<=":
        return left <= right
    elif operator == ">":
        return left > right
    elif operator == "<":
        return left < right
    elif operator == "==":
        return left == right
    elif operator == "!=":
        return left != right
    return False


def apply_choice_effects(effects_json: str, player_id: int, db: Session) -> dict:
    """应用选择效果"""
    if not effects_json:
        return {"applied": False}

    effects = json.loads(effects_json)
    results = []

    if "favorability" in effects:
        for npc_name, delta in effects["favorability"].items():
            # 根据名字查找NPC
            npc = db.query(Character).filter(Character.name == npc_name).first()
            if npc:
                rel = db.query(CharacterRelationship).filter(
                    (CharacterRelationship.character_id == player_id) & (CharacterRelationship.related_character_id == npc.id)
                ).first()
                if not rel:
                    rel = db.query(CharacterRelationship).filter(
                        (CharacterRelationship.character_id == npc.id) & (CharacterRelationship.related_character_id == player_id)
                    ).first()
                if rel:
                    rel.favorability = max(-100, min(100, rel.favorability + delta))
                    results.append({"npc": npc_name, "favorability_change": delta})

    if "flag" in effects:
        flag_key = effects["flag"]
        flag = db.query(StoryFlag).filter(StoryFlag.flag_key == flag_key).first()
        if flag:
            flag.flag_value = "1"
        else:
            flag = StoryFlag(flag_key=flag_key, flag_value="1")
            db.add(flag)
        results.append({"flag_set": flag_key})

    db.commit()
    return {"applied": True, "results": results}