"""
战斗系统 v2 基础数据种子（幂等，可反复执行）。

内容：
1. 技能库（含 effects 效果列表）——普攻类/元素类/群攻/治疗/护盾/增益/减益/毒/吸血/绝招
2. 战斗消耗品（回春丹 / 清心散 / 灵液 / 复活符）+ 修正已有物品
3. 升级经验表（level_up_table 为空时按公式填充 1-40 级）
4. 给现有角色配技能（玩家模板 / NPC / 敌人）
5. 给用户角色发一点初始消耗品（背包为空时）
6. 给剧情里的战斗节点写一份示例 battle_config（为空时）

所有写入都先查重，不会覆盖用户已改过的数据。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..models.character import Character
from ..models.item import Item
from ..models.skill import CharacterSkill, Skill
from ..models.story import StoryNode
from ..models.user import UserCharacter, UserCharacterInventory

SEED_FLAG = "battle_v2_seed"

# ======================================================================
# 1. 技能库
# ======================================================================
# power = 攻击力倍率百分比（100 = 1.0 倍）
SKILLS = [
    dict(name="力劈华山", skill_type="physical", mp_cost=8, target_type="single_enemy",
         element="none", required_level=1, auto_learn=1, cooldown=0,
         description="倾力一击，稳定打出 140% 攻击伤害。",
         effects=[{"kind": "damage", "power": 140}]),
    dict(name="疾风连击", skill_type="physical", mp_cost=14, target_type="single_enemy",
         element="wind", required_level=3, auto_learn=1,
         description="三段连击，每段 60% 攻击伤害，爆发高但浮动大。",
         effects=[{"kind": "damage", "power": 60, "hits": 3}]),
    dict(name="烈火掌", skill_type="magic", mp_cost=18, target_type="single_enemy",
         element="fire", required_level=2, auto_learn=1,
         description="附加灼烧：3 回合内每回合受到施法者 25% 攻击的火焰伤害。",
         effects=[{"kind": "damage", "power": 160, "element": "fire"},
                  {"kind": "dot", "key": "burn", "value": 25, "turns": 3, "mode": "caster_attack_pct"}]),
    dict(name="玄冰锥", skill_type="magic", mp_cost=18, target_type="single_enemy",
         element="water", required_level=2,
         description="有 35% 概率冰冻目标 1 回合。",
         effects=[{"kind": "damage", "power": 150, "element": "water"},
                  {"kind": "control", "control": "freeze", "chance": 35, "turns": 1}]),
    dict(name="罡风斩", skill_type="physical", mp_cost=22, target_type="all_enemies",
         element="wind", required_level=5, cooldown=1,
         description="横向剑气，对全体敌人造成 110% 攻击伤害。",
         effects=[{"kind": "damage", "power": 110, "element": "wind"}]),
    dict(name="落石击", skill_type="earth", mp_cost=16, target_type="single_enemy",
         element="earth", required_level=1,
         description="厚重的一击，180% 攻击伤害。",
         effects=[{"kind": "damage", "power": 180, "element": "earth"}]),
    dict(name="圣光术", skill_type="magic", mp_cost=20, target_type="single_enemy",
         element="light", required_level=6,
         description="神圣光辉灼烧敌人，同时为自己恢复少量生命。",
         effects=[{"kind": "damage", "power": 150, "element": "light"},
                  {"kind": "heal", "power": 30, "target": "self"}]),
    dict(name="暗影突袭", skill_type="special", mp_cost=20, target_type="single_enemy",
         element="dark", required_level=6,
         description="170% 暗属性伤害，并吸取 35% 伤害转化为自身生命。",
         effects=[{"kind": "damage", "power": 170, "element": "dark", "drain": 35}]),
    dict(name="血魔吸星", skill_type="special", mp_cost=24, target_type="single_enemy",
         element="dark", required_level=8, cooldown=2,
         description="以魔功吞噬敌人，150% 伤害并吸取 60%。",
         effects=[{"kind": "damage", "power": 150, "element": "dark", "drain": 60}]),
    dict(name="回春术", skill_type="magic", mp_cost=15, target_type="single_ally",
         element="none", required_level=1, auto_learn=1,
         description="为一名队友恢复 130% 施法者攻击的生命。",
         effects=[{"kind": "heal", "power": 130}]),
    dict(name="群疗甘霖", skill_type="magic", mp_cost=26, target_type="all_allies",
         element="none", required_level=9,
         description="为全体队友恢复 90% 攻击的生命。",
         effects=[{"kind": "heal", "power": 90}]),
    dict(name="清心诀", skill_type="magic", mp_cost=12, target_type="self",
         element="none", required_level=4,
         description="清除自身 2 个负面状态并恢复少量生命。",
         effects=[{"kind": "cleanse", "count": 2, "target": "self"},
                  {"kind": "heal", "power": 40, "target": "self"}]),
    dict(name="护体真气", skill_type="special", mp_cost=14, target_type="self",
         element="none", required_level=3,
         description="获得相当于自身最大生命 60% 的护盾，持续 3 回合。",
         effects=[{"kind": "shield", "power": 60, "turns": 3, "target": "self"}]),
    dict(name="铁壁", skill_type="special", mp_cost=16, target_type="self",
         element="earth", required_level=5,
         description="防御提升 50% 并附加 40% 最大生命的护盾，持续 3 回合。",
         effects=[{"kind": "buff", "stat": "defense", "value": 50, "turns": 3,
                   "name": "铁壁", "key": "def_up", "target": "self"},
                  {"kind": "shield", "power": 40, "turns": 3, "target": "self"}]),
    dict(name="蓄势待发", skill_type="special", mp_cost=12, target_type="self",
         element="none", required_level=2,
         description="攻击提升 40%、速度提升 20%，持续 3 回合。",
         effects=[{"kind": "buff", "stat": "attack", "value": 40, "turns": 3,
                   "name": "蓄势", "key": "atk_up", "target": "self"},
                  {"kind": "buff", "stat": "speed", "value": 20, "turns": 3,
                   "name": "疾行", "key": "spd_up", "target": "self"}]),
    dict(name="破甲击", skill_type="physical", mp_cost=14, target_type="single_enemy",
         element="none", required_level=3,
         description="120% 伤害并降低目标 35% 防御，持续 2 回合。",
         effects=[{"kind": "damage", "power": 120},
                  {"kind": "debuff", "stat": "defense", "value": 35, "turns": 2,
                   "name": "破甲", "key": "def_down"}]),
    dict(name="蚀骨毒雾", skill_type="magic", mp_cost=20, target_type="all_enemies",
         element="dark", required_level=5,
         description="全体中毒：3 回合内每回合受到施法者 20% 攻击的毒伤。",
         effects=[{"kind": "dot", "key": "poison", "value": 20, "turns": 3,
                   "mode": "caster_attack_pct"}]),
    dict(name="定身咒", skill_type="magic", mp_cost=16, target_type="single_enemy",
         element="none", required_level=6,
         description="75% 概率眩晕目标 1 回合。",
         effects=[{"kind": "control", "control": "stun", "chance": 75, "turns": 1}]),
    # ---- 绝招（怒气满时可用） ----
    dict(name="万剑归宗", skill_type="physical", mp_cost=0, target_type="all_enemies",
         element="none", required_level=1, is_ultimate=1, auto_learn=1,
         description="【绝招】召唤万千剑影，对全体敌人造成 2 段 240% 伤害。",
         effects=[{"kind": "damage", "power": 240, "hits": 2}]),
    dict(name="天雷破", skill_type="magic", mp_cost=0, target_type="single_enemy",
         element="light", required_level=1, is_ultimate=1,
         description="【绝招】引天雷轰击单体，500% 光属性伤害并降低其防御。",
         effects=[{"kind": "damage", "power": 500, "element": "light"},
                  {"kind": "debuff", "stat": "defense", "value": 30, "turns": 2,
                   "name": "雷灼", "key": "def_down"}]),
    dict(name="血海无量", skill_type="special", mp_cost=0, target_type="all_enemies",
         element="dark", required_level=1, is_ultimate=1,
         description="【绝招】血海翻涌，对全体造成 260% 暗属性伤害并吸取 30%。",
         effects=[{"kind": "damage", "power": 260, "element": "dark", "drain": 30}]),
]

# 角色 → 技能名列表
CHARACTER_SKILLS = {
    "kong": ["力劈华山", "疾风连击", "烈火掌", "回春术", "万剑归宗"],
    "韩秋雪": ["玄冰锥", "罡风斩", "清心诀", "护体真气", "天雷破"],
    "黄蓉": ["落石击", "蚀骨毒雾", "破甲击", "蓄势待发"],
    "牛头人": ["力劈华山", "铁壁", "血魔吸星", "万剑归宗"],
    "丽莎": ["暗影突袭", "玄冰锥", "群疗甘霖", "天雷破"],
}

# ======================================================================
# 2. 战斗消耗品
# ======================================================================
ITEMS = [
    dict(name="回春丹", item_type="consumable", rarity="common", price=30,
         description="战斗中恢复 120 点生命。",
         effects=[{"kind": "heal", "value": 120, "target": "self"}]),
    dict(name="清心散", item_type="consumable", rarity="uncommon", price=45,
         description="清除自身全部负面状态并恢复 30 点生命。",
         effects=[{"kind": "cleanse", "count": 9, "target": "self"},
                  {"kind": "heal", "value": 30, "target": "self"}]),
    dict(name="灵液", item_type="consumable", rarity="common", price=35,
         description="恢复 60 点灵力（MP）。",
         effects=[{"kind": "restore_mp", "value": 60, "target": "self"}]),
    dict(name="复活符", item_type="consumable", rarity="rare", price=200,
         description="复活一名倒下的队友，并恢复其 40% 生命。",
         effects=[{"kind": "revive", "power": 40}]),
]

STARTER_ITEMS = {"回春丹": 3, "灵液": 2, "清心散": 1}


# ======================================================================
# 工具
# ======================================================================

def _ensure_skill(db: Session, data: dict) -> Skill:
    skill = db.query(Skill).filter(Skill.name == data["name"]).first()
    if skill:
        return skill
    skill = Skill(
        name=data["name"],
        skill_type=data.get("skill_type", "physical"),
        power=int(data.get("power", 0) or 0),
        mp_cost=data.get("mp_cost", 0),
        hp_cost=data.get("hp_cost", 0),
        accuracy=data.get("accuracy", 100),
        critical_rate=data.get("critical_rate", 5),
        target_type=data.get("target_type", "single_enemy"),
        element=data.get("element", "none"),
        effects=json.dumps(data.get("effects") or [], ensure_ascii=False),
        rage_cost=data.get("rage_cost", 0),
        is_ultimate=data.get("is_ultimate", 0),
        hits=data.get("hits", 1),
        cooldown=data.get("cooldown", 0),
        auto_learn=data.get("auto_learn", 0),
        description=data.get("description", ""),
        required_level=data.get("required_level", 1),
        visual_effect=data.get("visual_effect"),
    )
    db.add(skill)
    db.flush()
    return skill


def _ensure_item(db: Session, data: dict) -> Item:
    item = db.query(Item).filter(Item.name == data["name"]).first()
    if item:
        # 已有物品：只补 effects（用户可能自定义过其他字段，不动）
        if not item.effects:
            item.effects = json.dumps(data.get("effects") or [], ensure_ascii=False)
        return item
    item = Item(
        name=data["name"], item_type=data.get("item_type", "consumable"),
        rarity=data.get("rarity", "common"),
        effect="{}",
        effects=json.dumps(data.get("effects") or [], ensure_ascii=False),
        description=data.get("description", ""),
        price=data.get("price", 0), is_usable=1,
    )
    db.add(item)
    db.flush()
    return item


def _default_exp(level: int) -> int:
    """升级所需经验（40 级以内）。"""
    return int(45 * (level ** 1.75) + 40)


# ======================================================================
# 主流程
# ======================================================================

def seed_battle_data(db: Session) -> dict:
    from ..models.skill import LevelUpTable

    report = {"skills": 0, "items": 0, "levels": 0, "char_skills": 0,
              "inventory": 0, "battle_configs": 0}

    # ---- 技能 ----
    skill_map: dict[str, Skill] = {}
    for data in SKILLS:
        before = db.query(Skill).filter(Skill.name == data["name"]).count()
        skill = _ensure_skill(db, data)
        skill_map[data["name"]] = skill
        if not before:
            report["skills"] += 1

    # ---- 物品 ----
    item_map: dict[str, Item] = {}
    for data in ITEMS:
        before = db.query(Item).filter(Item.name == data["name"]).count()
        item = _ensure_item(db, data)
        item_map[data["name"]] = item
        if not before:
            report["items"] += 1
    db.flush()

    # ---- 升级经验表 ----
    if db.query(LevelUpTable).count() == 0:
        for lv in range(1, 41):
            db.add(LevelUpTable(
                level=lv,
                exp_required=0 if lv == 1 else _default_exp(lv - 1),
                hp_growth=12 + lv * 3,
                mp_growth=4 + lv,
                attack_growth=2 + lv // 3,
                defense_growth=1 + lv // 4,
                speed_growth=1 + lv // 6,
            ))
            report["levels"] += 1
        db.flush()

    # ---- 角色技能 ----
    for char_name, names in CHARACTER_SKILLS.items():
        chars = db.query(Character).filter(Character.name == char_name).all()
        for ch in chars:
            owned = {cs.skill_id for cs in db.query(CharacterSkill).filter(
                CharacterSkill.character_id == ch.id).all()}
            for nm in names:
                sk = skill_map.get(nm)
                if sk and sk.id not in owned:
                    db.add(CharacterSkill(character_id=ch.id, skill_id=sk.id, skill_level=1))
                    owned.add(sk.id)
                    report["char_skills"] += 1
    db.flush()

    # ---- 用户角色初始消耗品 ----
    heal = item_map.get("回春丹")
    mp_item = item_map.get("灵液")
    cleanse = item_map.get("清心散")
    for uc in db.query(UserCharacter).all():
        have = db.query(UserCharacterInventory).filter(
            UserCharacterInventory.user_character_id == uc.id).count()
        if have:
            continue
        for it, qty in ((heal, STARTER_ITEMS["回春丹"]),
                        (mp_item, STARTER_ITEMS["灵液"]),
                        (cleanse, STARTER_ITEMS["清心散"])):
            if it:
                db.add(UserCharacterInventory(user_character_id=uc.id, item_id=it.id,
                                              item_kind="item", quantity=qty))
                report["inventory"] += 1
    db.flush()

    # ---- 战斗节点示例配置 ----
    yan = db.query(Character).filter(Character.name == "黄蓉").first()
    herb = db.query(Item).filter(Item.name == "寒春草").first()
    for node in db.query(StoryNode).filter(StoryNode.node_type == "battle").all():
        if node.battle_config:
            continue
        enemy_id = yan.id if yan else 2
        cfg = {
            "enemies": [{
                "character_id": enemy_id,
                "level_mode": "match",     # match=跟随玩家水平自动配平 / scale=按模板等级缩放 / fixed=固定数值
                "power": 1.0,               # 强度系数：1.0 势均力敌，1.5 明显更强
                "level_offset": 0,
                "ai": {"type": "aggressive", "skill_chance": 0.7, "prefer_lowest_hp": True},
                "skills": [n for n in CHARACTER_SKILLS.get("黄蓉", [])],
                "drops": ([{"item_id": herb.id, "name": herb.name, "chance": 70, "quantity": 2}]
                          if herb else []),
                "phases": [{
                    "hp_below": 35, "name": "拼命", "line": "我还不能倒下！",
                    "buff": {"key": "atk_up", "name": "拼命", "stat": "attack", "value": 60, "turns": 99},
                }],
            }],
            "difficulty": 1.0,
            "exp_multiplier": 1.0,
            "allow_flee": True,
            "banter": [
                {"trigger": "battle_start", "speaker": "黄蓉", "speaker_id": enemy_id,
                 "line": "哼，看招！"},
                {"trigger": "hp_below", "value": 50, "speaker": "黄蓉", "speaker_id": enemy_id,
                 "line": "有点本事……但还不够！"},
                {"trigger": "victory", "speaker": "黄蓉", "speaker_id": enemy_id,
                 "line": "算你厉害，我认输。"},
            ],
        }
        node.battle_config = json.dumps(cfg, ensure_ascii=False)
        report["battle_configs"] += 1

    db.commit()
    return report
