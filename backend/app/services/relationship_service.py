"""
关系业务逻辑：好感度变化、关系类型更新、关系事件触发
"""
from sqlalchemy.orm import Session

from ..models.relationship import CharacterRelationship, RelationshipEvent
from ..models.character import Character


def change_favorability(
    rel: CharacterRelationship,
    delta: int,
    event_type: str,
    description: str,
    story_node_id: int | None,
    db: Session,
) -> dict:
    """修改好感度并记录事件"""
    old_favorability = rel.favorability
    rel.favorability = max(-100, min(100, rel.favorability + delta))
    db.flush()

    event = RelationshipEvent(
        relationship_id=rel.id,
        event_type=event_type,
        change_value=delta,
        description=description,
        story_node_id=story_node_id,
    )
    db.add(event)
    db.commit()
    db.refresh(rel)

    # 自动更新关系类型
    new_type = _auto_determine_relationship_type(rel)
    if new_type != rel.relationship_type:
        rel.relationship_type = new_type
        db.commit()
        db.refresh(rel)

    return {
        "old_favorability": old_favorability,
        "new_favorability": rel.favorability,
        "delta": delta,
        "relationship_type": rel.relationship_type,
    }


def _auto_determine_relationship_type(rel: CharacterRelationship) -> str:
    """根据四维关系值自动判定关系类型"""
    f = rel.favorability
    if f >= 70:
        return "lover"
    elif f >= 40:
        return "friend"
    elif f <= -70:
        return "enemy"
    elif f <= -40:
        return "rival"
    else:
        return "neutral"


def get_or_create_relationship(
    char_a: int, char_b: int, db: Session
) -> CharacterRelationship:
    """获取或创建两个人物之间的关系"""
    rel = db.query(CharacterRelationship).filter(
        (CharacterRelationship.character_id == char_a) & (CharacterRelationship.related_character_id == char_b)
    ).first()
    if not rel:
        rel = db.query(CharacterRelationship).filter(
            (CharacterRelationship.character_id == char_b) & (CharacterRelationship.related_character_id == char_a)
        ).first()
    if not rel:
        rel = CharacterRelationship(
            character_id=char_a,
            related_character_id=char_b,
            relationship_type="neutral",
        )
        db.add(rel)
        db.commit()
        db.refresh(rel)
    return rel


def can_join_party(character: Character, db: Session) -> tuple[bool, str]:
    """检查NPC是否满足加入队伍的条件"""
    if not character.can_join_party:
        return False, "该角色无法加入队伍"
    if character.is_party_member:
        return False, "该角色已在队伍中"

    import json
    condition = json.loads(character.join_condition) if character.join_condition else {}

    # 检查好感度条件
    if "favorability" in condition:
        player = db.query(Character).filter(Character.character_type == "player").first()
        if player:
            rel = db.query(CharacterRelationship).filter(
                (CharacterRelationship.character_id == player.id) & (CharacterRelationship.related_character_id == character.id)
            ).first()
            if not rel or rel.favorability < condition["favorability"]:
                return False, f"好感度不足（需要 {condition['favorability']}，当前 {rel.favorability if rel else 0}）"

    return True, "可以加入"


def join_party(character: Character, db: Session) -> dict:
    """NPC加入队伍"""
    can_join, reason = can_join_party(character, db)
    if not can_join:
        return {"success": False, "reason": reason}

    character.is_party_member = 1
    character.character_type = "ally"
    db.commit()
    db.refresh(character)
    return {"success": True, "character_id": character.id, "name": character.name}