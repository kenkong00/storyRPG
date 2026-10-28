"""
人物业务逻辑：升级、属性变化、经验获取
"""
from sqlalchemy.orm import Session

from ..models.character import Character
from ..models.skill import LevelUpTable


def gain_exp(character: Character, amount: int, db: Session) -> dict:
    """给予经验并检查升级"""
    character.exp += amount
    level_ups = 0
    new_level = character.level

    while True:
        next_level = db.query(LevelUpTable).filter(LevelUpTable.level == new_level + 1).first()
        if not next_level:
            break
        if character.exp >= next_level.exp_required:
            character.exp -= next_level.exp_required
            new_level += 1
            level_ups += 1
            # 应用成长
            character.max_hp += next_level.hp_growth
            character.hp += next_level.hp_growth  # 升级时回满HP差值
            character.max_mp += next_level.mp_growth
            character.mp += next_level.mp_growth
            character.attack += next_level.attack_growth
            character.defense += next_level.defense_growth
            character.speed += next_level.speed_growth
        else:
            break

    if level_ups > 0:
        character.level = new_level
        character.hp = character.max_hp  # 升级时回满HP
        character.mp = character.max_mp  # 升级时回满MP

    db.commit()
    db.refresh(character)
    return {
        "level_ups": level_ups,
        "new_level": character.level,
        "remaining_exp": character.exp,
        "stats": {
            "hp": character.hp, "max_hp": character.max_hp,
            "mp": character.mp, "max_mp": character.max_mp,
            "attack": character.attack, "defense": character.defense,
            "speed": character.speed, "luck": character.luck,
        },
    }


def apply_item_effect(character: Character, effect_json: str) -> dict:
    """应用物品效果"""
    import json
    effect = json.loads(effect_json) if effect_json else {}
    changes = {}

    if "heal" in effect:
        heal_amount = effect["heal"]
        character.hp = min(character.max_hp, character.hp + heal_amount)
        changes["hp_restored"] = heal_amount
    if "restore_mp" in effect:
        mp_amount = effect["restore_mp"]
        character.mp = min(character.max_mp, character.mp + mp_amount)
        changes["mp_restored"] = mp_amount
    if "attack" in effect:
        changes["attack_bonus"] = effect["attack"]
    if "defense" in effect:
        changes["defense_bonus"] = effect["defense"]
    if "max_mp" in effect:
        character.max_mp += effect["max_mp"]
        changes["max_mp_bonus"] = effect["max_mp"]
    if "critical_rate" in effect:
        changes["critical_rate_bonus"] = effect["critical_rate"]

    return changes


def check_level_up(character: Character, db: Session) -> int | None:
    """检查是否需要升级，返回下一级所需经验或None"""
    next_level = db.query(LevelUpTable).filter(LevelUpTable.level == character.level + 1).first()
    if not next_level:
        return None
    return next_level.exp_required - character.exp