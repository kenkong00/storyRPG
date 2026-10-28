"""
测试数据填充脚本
包含一个完整的故事场景：玩家在废弃城堡遇到堕落骑士，可选择战斗或招降
"""
from datetime import datetime
from sqlalchemy.orm import Session

from .database import SessionLocal, init_db, engine
from .models import (
    Character, CharacterAttribute, CharacterRelationship, RelationshipEvent,
    Skill, CharacterSkill, LevelUpTable,
    Scene, SceneConnection, SceneNPC,
    StoryChapter, StoryNode, StoryChoice, StoryCondition, StoryFlag,
    Battle, BattleTurn, CombatExpression,
    Event, EventLog,
    Item, CharacterInventory,
)


def seed(db: Session):
    """填充所有测试数据"""

    # ========== 1. 升级经验表 ==========
    levels = [
        LevelUpTable(level=1, exp_required=0, hp_growth=0, mp_growth=0, attack_growth=0, defense_growth=0, speed_growth=0),
        LevelUpTable(level=2, exp_required=100, hp_growth=15, mp_growth=5, attack_growth=3, defense_growth=2, speed_growth=1),
        LevelUpTable(level=3, exp_required=250, hp_growth=15, mp_growth=5, attack_growth=3, defense_growth=2, speed_growth=1),
        LevelUpTable(level=4, exp_required=500, hp_growth=18, mp_growth=6, attack_growth=3, defense_growth=2, speed_growth=1),
        LevelUpTable(level=5, exp_required=900, hp_growth=18, mp_growth=6, attack_growth=4, defense_growth=3, speed_growth=1),
        LevelUpTable(level=6, exp_required=1500, hp_growth=20, mp_growth=7, attack_growth=4, defense_growth=3, speed_growth=2),
        LevelUpTable(level=7, exp_required=2300, hp_growth=20, mp_growth=7, attack_growth=4, defense_growth=3, speed_growth=2),
        LevelUpTable(level=8, exp_required=3500, hp_growth=22, mp_growth=8, attack_growth=5, defense_growth=3, speed_growth=2),
        LevelUpTable(level=9, exp_required=5000, hp_growth=22, mp_growth=8, attack_growth=5, defense_growth=4, speed_growth=2),
        LevelUpTable(level=10, exp_required=7000, hp_growth=25, mp_growth=10, attack_growth=5, defense_growth=4, speed_growth=3),
    ]
    db.add_all(levels)

    # ========== 2. 人物数据 ==========
    # 玩家
    player = Character(
        name="艾尔文", character_type="player", title="流浪剑士",
        level=3, exp=150, hp=120, max_hp=120, mp=40, max_mp=40,
        attack=18, defense=10, speed=8, luck=6,
        personality="勇敢,正义,谨慎",
        background_story="曾是王国骑士团见习骑士，因不满腐败而离开，独自流浪寻找正义之路。",
        portrait_image="/images/portraits/player.png",
        is_alive=1, is_party_member=1, can_join_party=0,
    )
    # 堕落骑士 - 可被击败后招降
    fallen_knight = Character(
        name="雷恩", character_type="enemy", title="堕落骑士",
        level=5, exp=0, hp=150, max_hp=150, mp=30, max_mp=30,
        attack=22, defense=15, speed=6, luck=3,
        personality="傲慢,悔恨,矛盾",
        background_story="曾是艾尔文的前辈骑士，因一次惨败而堕落，沦为黑暗势力的走狗，但内心深处仍渴望救赎。",
        portrait_image="/images/portraits/fallen_knight.png",
        is_alive=1, is_party_member=0, can_join_party=1,
        join_condition='{"favorability": 50, "flag": "knight_spared"}',
    )
    # 神秘女法师 - 可加入队伍的NPC
    mage = Character(
        name="莉娜", character_type="ally", title="星辉法师",
        level=4, exp=0, hp=80, max_hp=80, mp=100, max_mp=100,
        attack=8, defense=5, speed=10, luck=8,
        personality="聪慧,善良,神秘",
        background_story="来自遥远星辉塔的年轻法师，正在寻找失落的古代魔法典籍。",
        portrait_image="/images/portraits/mage.png",
        is_alive=1, is_party_member=1, can_join_party=1,
        join_condition='{"favorability": 30, "flag": "met_mage"}',
    )
    # 黑暗领主 - Boss
    dark_lord = Character(
        name="暗影领主", character_type="enemy", title="深渊之主",
        level=10, exp=0, hp=500, max_hp=500, mp=200, max_mp=200,
        attack=35, defense=25, speed=12, luck=5,
        personality="残酷,狂傲,狡诈",
        background_story="统治暗影城堡的邪恶存在，是腐化雷恩的元凶。",
        portrait_image="/images/portraits/dark_lord.png",
        is_alive=1, is_party_member=0, can_join_party=0,
    )
    # 酒馆老板
    innkeeper = Character(
        name="老汤姆", character_type="npc", title="酒馆老板",
        level=1, exp=0, hp=50, max_hp=50, mp=0, max_mp=0,
        attack=3, defense=2, speed=2, luck=10,
        personality="和善,健谈",
        background_story="边境小镇酒馆的老板，消息灵通，知道很多不为人知的秘密。",
        portrait_image="/images/portraits/innkeeper.png",
        is_alive=1, is_party_member=0, can_join_party=0,
    )
    db.add_all([player, fallen_knight, mage, dark_lord, innkeeper])
    db.flush()

    # ========== 3. 人物属性 ==========
    for char_id, attrs in [
        (player.id, [("honor", 80), ("cruelty", 10), ("wisdom", 60)]),
        (fallen_knight.id, [("honor", 30), ("cruelty", 60), ("wisdom", 40)]),
        (mage.id, [("honor", 70), ("cruelty", 5), ("wisdom", 85)]),
        (dark_lord.id, [("honor", 0), ("cruelty", 95), ("wisdom", 70)]),
    ]:
        for key, val in attrs:
            db.add(CharacterAttribute(character_id=char_id, attr_key=key, attr_value=val))

    # ========== 4. 人物关系 ==========
    rel_player_knight = CharacterRelationship(
        character_id=player.id, related_character_id=fallen_knight.id,
        relationship_type="rival", favorability=-20, trust=30, respect=60, fear=20,
        history_summary="曾经是战友，后因雷恩堕落而对立。",
    )
    rel_player_mage = CharacterRelationship(
        character_id=player.id, related_character_id=mage.id,
        relationship_type="friend", favorability=40, trust=50, respect=45, fear=0,
        history_summary="在旅途中结识的可靠伙伴。",
    )
    rel_player_dark = CharacterRelationship(
        character_id=player.id, related_character_id=dark_lord.id,
        relationship_type="enemy", favorability=-80, trust=0, respect=10, fear=40,
        history_summary="不共戴天的仇敌。",
    )
    db.add_all([rel_player_knight, rel_player_mage, rel_player_dark])
    db.flush()

    # 关系事件
    db.add(RelationshipEvent(
        relationship_id=rel_player_knight.id, event_type="battle_mercy",
        change_value=30, description="艾尔文在战斗中手下留情，雷恩内心受到触动。",
    ))

    # ========== 5. 技能 ==========
    skills = [
        Skill(name="普通攻击", skill_type="physical", power=10, mp_cost=0, hp_cost=0,
              accuracy=95, critical_rate=5, target_type="single_enemy", element="none",
              battle_animation_desc="剑光一闪，直刺敌人要害"),
        Skill(name="十字斩", skill_type="physical", power=25, mp_cost=10, hp_cost=0,
              accuracy=90, critical_rate=10, target_type="single_enemy", element="none",
              visual_effect="cross_slash",
              battle_animation_desc="双手握剑，画出一道十字剑光，剑气撕裂空气"),
        Skill(name="火球术", skill_type="magic", power=30, mp_cost=15, hp_cost=0,
              accuracy=85, critical_rate=8, target_type="single_enemy", element="fire",
              visual_effect="fire_explosion",
              battle_animation_desc="掌心凝聚烈焰，一颗巨大的火球呼啸而出，击中目标后爆炸"),
        Skill(name="治愈之光", skill_type="magic", power=0, mp_cost=20, hp_cost=0,
              accuracy=100, critical_rate=0, target_type="single_ally", element="light",
              status_effect='{"heal": 30}',
              battle_animation_desc="柔和的光芒笼罩队友，伤口逐渐愈合"),
        Skill(name="暗影突袭", skill_type="special", power=35, mp_cost=25, hp_cost=10,
              accuracy=80, critical_rate=20, target_type="single_enemy", element="dark",
              visual_effect="shadow_strike",
              battle_animation_desc="融入暗影之中，瞬间出现在敌人背后，给予致命一击"),
        Skill(name="坚盾防御", skill_type="special", power=0, mp_cost=5, hp_cost=0,
              accuracy=100, critical_rate=0, target_type="self", element="none",
              status_effect='{"defense_up": 50}',
              battle_animation_desc="摆出防御姿态，周身被淡金色光芒环绕"),
        Skill(name="冰霜风暴", skill_type="magic", power=28, mp_cost=18, hp_cost=0,
              accuracy=85, critical_rate=8, target_type="all_enemies", element="water",
              visual_effect="ice_storm",
              battle_animation_desc="召唤冰霜之力，战场上刮起刺骨的暴风雪"),
        Skill(name="暗黑冲击", skill_type="magic", power=40, mp_cost=30, hp_cost=0,
              accuracy=85, critical_rate=10, target_type="all_enemies", element="dark",
              visual_effect="dark_blast",
              battle_animation_desc="释放黑暗能量，一道巨大的暗影冲击波席卷全场"),
    ]
    db.add_all(skills)
    db.flush()

    # 人物技能关联
    char_skills = [
        CharacterSkill(character_id=player.id, skill_id=skills[0].id, skill_level=3),
        CharacterSkill(character_id=player.id, skill_id=skills[1].id, skill_level=2),
        CharacterSkill(character_id=player.id, skill_id=skills[5].id, skill_level=1),
        CharacterSkill(character_id=mage.id, skill_id=skills[0].id, skill_level=1),
        CharacterSkill(character_id=mage.id, skill_id=skills[2].id, skill_level=2),
        CharacterSkill(character_id=mage.id, skill_id=skills[3].id, skill_level=2),
        CharacterSkill(character_id=mage.id, skill_id=skills[6].id, skill_level=1),
        CharacterSkill(character_id=fallen_knight.id, skill_id=skills[0].id, skill_level=2),
        CharacterSkill(character_id=fallen_knight.id, skill_id=skills[4].id, skill_level=2),
        CharacterSkill(character_id=dark_lord.id, skill_id=skills[0].id, skill_level=3),
        CharacterSkill(character_id=dark_lord.id, skill_id=skills[7].id, skill_level=3),
    ]
    db.add_all(char_skills)

    # ========== 6. 场景 ==========
    scenes = [
        Scene(name="边境小镇", scene_type="town", description="一个宁静的边境小镇，酒馆里聚集着各路旅人。",
              background_image="/images/scenes/town.jpg", is_safe_zone=1, parent_region="边境地区", coordinates='{"x": 0, "y": 0}'),
        Scene(name="幽暗森林", scene_type="forest", description="古木参天的幽暗森林，偶尔能听到野兽的嚎叫。",
              background_image="/images/scenes/forest.jpg", is_safe_zone=0, parent_region="边境地区", coordinates='{"x": 1, "y": 0}'),
        Scene(name="废弃城堡", scene_type="castle", description="一座被遗忘的古老城堡，破碎的城墙诉说着曾经的辉煌。",
              background_image="/images/scenes/castle.jpg", is_safe_zone=0, parent_region="中部地区", coordinates='{"x": 2, "y": 1}'),
        Scene(name="暗影城堡", scene_type="castle", description="黑暗领主的老巢，阴森恐怖的气息笼罩着整个城堡。",
              background_image="/images/scenes/dark_castle.jpg", is_safe_zone=0, parent_region="暗影之地", coordinates='{"x": 3, "y": 2}'),
        Scene(name="星辉塔", scene_type="dungeon", description="高耸入云的魔法塔，散发着神秘的星光。",
              background_image="/images/scenes/tower.jpg", is_safe_zone=1, parent_region="中部地区", coordinates='{"x": 2, "y": 0}'),
    ]
    db.add_all(scenes)
    db.flush()

    # 场景连接
    scene_conns = [
        SceneConnection(from_scene_id=scenes[0].id, to_scene_id=scenes[1].id, travel_text="穿过小镇东门，进入幽暗森林...", travel_time=5),
        SceneConnection(from_scene_id=scenes[1].id, to_scene_id=scenes[0].id, travel_text="沿着小路返回边境小镇...", travel_time=5),
        SceneConnection(from_scene_id=scenes[1].id, to_scene_id=scenes[2].id, travel_text="深入森林，一座废弃城堡出现在眼前...", travel_time=10),
        SceneConnection(from_scene_id=scenes[2].id, to_scene_id=scenes[1].id, travel_text="离开废弃城堡，返回幽暗森林...", travel_time=10),
        SceneConnection(from_scene_id=scenes[2].id, to_scene_id=scenes[3].id, travel_text="穿过城堡地下的密道，前方是暗影城堡...", travel_time=15, is_locked=1, unlock_condition='{"flag": "defeated_knight"}'),
        SceneConnection(from_scene_id=scenes[0].id, to_scene_id=scenes[4].id, travel_text="沿着大道前行，远处便是星辉塔...", travel_time=8),
    ]
    db.add_all(scene_conns)

    # 场景NPC
    scene_npcs = [
        SceneNPC(scene_id=scenes[0].id, character_id=innkeeper.id, position="酒馆吧台后",
                 default_dialogue="欢迎光临！想打听什么消息吗？"),
        SceneNPC(scene_id=scenes[2].id, character_id=fallen_knight.id, position="城堡大厅",
                 appearance_condition='{"flag": "not_defeated_knight"}',
                 default_dialogue="你终于来了...艾尔文。我已等你很久了。"),
        SceneNPC(scene_id=scenes[3].id, character_id=dark_lord.id, position="王座之间",
                 appearance_condition='{"flag": "defeated_knight"}',
                 default_dialogue="愚蠢的蝼蚁！你以为击败了雷恩就能挑战我吗？"),
    ]
    db.add_all(scene_npcs)

    # ========== 7. 故事剧情 ==========
    chapter = StoryChapter(
        title="第一章：堕落骑士的救赎", chapter_order=1,
        description="玩家在废弃城堡遭遇曾经的战友——堕落骑士雷恩，面临战斗与救赎的抉择。",
        is_main_story=1,
    )
    db.add(chapter)
    db.flush()

    # 故事节点
    nodes = [
        # 1: 开场对话
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="城堡相遇", speaker_id=fallen_knight.id, order_index=1,
                  content="艾尔文...我就知道你会来的。看看这破败的城堡，就像我的内心一样——曾经辉煌，如今只剩废墟。",
                  expression="sad", position="center"),
        # 2: 玩家回应
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="玩家回应", speaker_id=player.id, order_index=2,
                  content="雷恩前辈！为什么？为什么你要投靠暗影领主？",
                  expression="surprised", position="left"),
        # 3: 骑士解释
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="骑士解释", speaker_id=fallen_knight.id, order_index=3,
                  content="你不明白...那场惨败之后，我失去了一切。暗影领主给了我力量，但也夺走了我的灵魂。",
                  expression="regretful", position="center"),
        # 4: 选择节点
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="choice",
                  title="命运抉择", order_index=4,
                  content="你如何回应？", speaker_id=player.id, position="left"),
        # 5: 战斗路线 - 战斗
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="battle",
                  title="与骑士交战", speaker_id=fallen_knight.id, order_index=5,
                  content="那就用剑来说话吧！", expression="angry", position="center"),
        # 6: 劝说路线 - 对话
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="劝说骑士", speaker_id=player.id, order_index=6,
                  content="雷恩前辈，你内心深处仍是那个荣耀的骑士！不要被黑暗吞噬！",
                  expression="determined", position="left"),
        # 7: 骑士动摇
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="骑士动摇", speaker_id=fallen_knight.id, order_index=7,
                  content="我...我还有救赎的可能吗？",
                  expression="crying", position="center"),
        # 8: 战斗胜利后 - 饶恕
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="choice",
                  title="战后抉择", order_index=8,
                  content="雷恩单膝跪地，剑已脱手。你如何处置他？", speaker_id=player.id, position="left"),
        # 9: 饶恕结局
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="饶恕骑士", speaker_id=fallen_knight.id, order_index=9,
                  content="你...不杀我？艾尔文，你的仁慈让我看到了光明。我愿追随你，赎清我的罪孽！",
                  expression="crying", position="center"),
        # 10: 处决结局
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="cutscene",
                  title="骑士之死", speaker_id=fallen_knight.id, order_index=10,
                  content="这样...也好...至少...我解脱了...（雷恩闭上了眼睛）",
                  expression="defeated", position="center"),
        # 11: 劝说成功 - 骑士加入
        StoryNode(chapter_id=chapter.id, scene_id=scenes[2].id, node_type="dialogue",
                  title="骑士回归", speaker_id=fallen_knight.id, order_index=11,
                  content="谢谢你，艾尔文。让我想起了曾经宣誓的骑士誓言。从今天起，我的剑为你而挥！",
                  expression="happy", position="center"),
        # 12: 莉娜加入剧情
        StoryNode(chapter_id=chapter.id, scene_id=scenes[0].id, node_type="dialogue",
                  title="法师相遇", speaker_id=mage.id, order_index=12,
                  content="你就是那个对抗暗影领主的剑士吗？我叫莉娜，也许我们可以互相帮助。",
                  expression="happy", position="right"),
    ]
    db.add_all(nodes)
    db.flush()

    # 故事选择
    choices = [
        # 节点4的选择
        StoryChoice(node_id=nodes[3].id, choice_text="【战斗】你已堕落太深，只能以剑来终结这一切！", next_node_id=nodes[4].id),
        StoryChoice(node_id=nodes[3].id, choice_text="【劝说】雷恩前辈，你不必继续沉沦，回头吧！", next_node_id=nodes[5].id),
        # 节点8的选择（战后）
        StoryChoice(node_id=nodes[7].id, choice_text="【饶恕】放下剑吧，雷恩。你值得第二次机会。", next_node_id=nodes[8].id,
                    effects='{"favorability": {"fallen_knight": 50}, "flag": "knight_spared"}'),
        StoryChoice(node_id=nodes[7].id, choice_text="【处决】你的罪行无法饶恕，以死谢罪吧。", next_node_id=nodes[9].id,
                    effects='{"favorability": {"fallen_knight": 0}, "flag": "knight_executed"}'),
    ]
    db.add_all(choices)

    # 故事条件
    conditions = [
        StoryCondition(condition_group="high_wisdom", condition_type="attribute", target_id=player.id, operator=">=", value="60"),
        StoryCondition(condition_group="knight_alive", condition_type="character_alive", target_id=fallen_knight.id, operator="==", value="1"),
        StoryCondition(condition_group="knight_spared", condition_type="flag", target_id=0, operator="has", value="knight_spared"),
    ]
    db.add_all(conditions)

    # 故事标记
    flags = [
        StoryFlag(flag_key="met_knight", flag_value="1", description="已与堕落骑士雷恩相遇"),
        StoryFlag(flag_key="knight_spared", flag_value="0", description="饶恕了雷恩"),
        StoryFlag(flag_key="knight_executed", flag_value="0", description="处决了雷恩"),
        StoryFlag(flag_key="defeated_knight", flag_value="0", description="击败了雷恩"),
        StoryFlag(flag_key="met_mage", flag_value="1", description="已遇到法师莉娜"),
    ]
    db.add_all(flags)

    # ========== 8. 战斗数据 ==========
    battle = Battle(
        story_node_id=nodes[4].id, scene_id=scenes[2].id, battle_type="story",
        status="player_won",
        player_party=f'[{player.id}, {mage.id}]',
        enemy_party=f'[{fallen_knight.id}]',
        battle_log='{"winner": "player"}',
    )
    db.add(battle)
    db.flush()

    # 回合记录
    turns = [
        BattleTurn(battle_id=battle.id, turn_number=1, actor_id=player.id, action_type="skill",
                   skill_id=skills[1].id, target_id=fallen_knight.id, damage=30, is_critical=0,
                   target_expression="arrogant", actor_expression="confident",
                   visual_description="十字剑光撕裂空气，雷恩勉强格挡"),
        BattleTurn(battle_id=battle.id, turn_number=2, actor_id=fallen_knight.id, action_type="skill",
                   skill_id=skills[4].id, target_id=player.id, damage=25, is_critical=1,
                   target_expression="shocked", actor_expression="confident",
                   visual_description="暗影突袭！雷恩瞬移至艾尔文身后，一击命中"),
        BattleTurn(battle_id=battle.id, turn_number=3, actor_id=mage.id, action_type="skill",
                   skill_id=skills[2].id, target_id=fallen_knight.id, damage=35, is_critical=0,
                   target_expression="desperate", actor_expression="confident",
                   visual_description="火球术命中了！雷恩的铠甲被火焰烧得通红"),
        BattleTurn(battle_id=battle.id, turn_number=4, actor_id=player.id, action_type="skill",
                   skill_id=skills[1].id, target_id=fallen_knight.id, damage=40, is_critical=1,
                   target_expression="defeated", actor_expression="confident",
                   visual_description="致命一击的十字斩！雷恩单膝跪地，剑已脱手"),
    ]
    db.add_all(turns)

    # 战斗表情预设
    combat_expressions = [
        CombatExpression(character_id=fallen_knight.id, expression_type="arrogant",
                         trigger_condition="hp_above_70", image_prompt="堕落骑士雷恩高傲地站立，嘴角带着不屑的冷笑，黑暗铠甲在月光下闪烁",
                         pose_description="单手叉腰，剑尖指向地面，下巴微扬", dialogue_line="就这点本事吗？太让我失望了！"),
        CombatExpression(character_id=fallen_knight.id, expression_type="desperate",
                         trigger_condition="hp_below_30", image_prompt="雷恩单膝跪地，铠甲破裂，眼中充满绝望与不甘，嘴角渗出血迹",
                         pose_description="单膝跪地，双手勉强支撑着剑", dialogue_line="不可能...我不可能输..."),
        CombatExpression(character_id=fallen_knight.id, expression_type="defeated",
                         trigger_condition="defeat_near", image_prompt="雷恩跪倒在地，双手颤抖，眼泪从眼眶滑落，黑暗能量正在消散",
                         pose_description="双膝跪地，剑已脱手", dialogue_line="我...输了..."),
        CombatExpression(character_id=fallen_knight.id, expression_type="crying",
                         trigger_condition="hp_below_30", image_prompt="雷恩泪流满面，但眼神中不再是绝望，而是一种解脱的光芒",
                         pose_description="跪坐着，双手掩面，肩膀颤抖", dialogue_line="谢谢你...让我重新找回了自己..."),
        CombatExpression(character_id=dark_lord.id, expression_type="arrogant",
                         trigger_condition="hp_above_70", image_prompt="暗影领主悬在半空，黑暗能量环绕，眼中闪烁着残忍的红光",
                         pose_description="悬浮在空中，双臂张开，暗影能量涌动", dialogue_line="蝼蚁！也敢挑战深渊之主？"),
        CombatExpression(character_id=dark_lord.id, expression_type="jealous",
                         trigger_condition="critical_hit", image_prompt="暗影领主被暴击击中，面部扭曲，眼中充满嫉妒与愤怒",
                         pose_description="后退半步，手捂伤口，面部扭曲", dialogue_line="你...你这该死的凡人！"),
        CombatExpression(character_id=dark_lord.id, expression_type="begging",
                         trigger_condition="defeat_near", image_prompt="暗影领主跪伏在地，黑暗能量消散，露出憔悴苍老的真面目，眼中满是求饶",
                         pose_description="趴伏在地，伸出手臂求饶", dialogue_line="饶...饶了我！我可以给你力量！"),
    ]
    db.add_all(combat_expressions)

    # ========== 9. 事件 ==========
    events = [
        Event(name="骑士战斗介入", event_type="npc_intervention", trigger_type="battle",
              trigger_condition='{"battle_type": "boss", "player_hp_below": 30, "flag": "knight_spared"}',
              priority=1, cooldown=0, is_one_time=1,
              effects='{"npc_join_battle": "fallen_knight"}',
              story_node_id=None),
        Event(name="骑士加入队伍", event_type="npc_join", trigger_type="relationship_threshold",
              trigger_condition='{"npc_id": "fallen_knight", "favorability": ">=50", "flag": "knight_spared"}',
              priority=1, cooldown=0, is_one_time=1,
              effects='{"set_party_member": "fallen_knight", "set_character_type": "ally"}',
              story_node_id=None),
        Event(name="法师加入队伍", event_type="npc_join", trigger_type="story_node",
              trigger_condition='{"node_id": "mage_join_node"}',
              priority=1, cooldown=0, is_one_time=1,
              effects='{"set_party_member": "mage"}',
              story_node_id=None),
        Event(name="暗影领主伏击", event_type="ambush", trigger_type="auto",
              trigger_condition='{"scene_id": "dark_castle", "flag": "defeated_knight"}',
              priority=2, cooldown=0, is_one_time=1,
              effects='{"start_battle": "dark_lord"}',
              story_node_id=None),
    ]
    db.add_all(events)

    # ========== 10. 物品 ==========
    items = [
        Item(name="治疗药水", item_type="consumable", rarity="common",
             effect='{"heal": 30}', description="恢复30点HP的普通药水。", price=50),
        Item(name="高级治疗药水", item_type="consumable", rarity="uncommon",
             effect='{"heal": 80}', description="恢复80点HP的高级药水。", price=150),
        Item(name="魔力药水", item_type="consumable", rarity="common",
             effect='{"restore_mp": 30}', description="恢复30点MP的魔力药水。", price=60),
        Item(name="铁剑", item_type="weapon", rarity="common",
             effect='{"attack": 5}', description="一把普通的铁剑。", price=100),
        Item(name="骑士长剑", item_type="weapon", rarity="rare",
             effect='{"attack": 12, "critical_rate": 5}', description="雷恩曾经的佩剑，蕴含着骑士的荣耀。", price=500),
        Item(name="法师长袍", item_type="armor", rarity="uncommon",
             effect='{"defense": 3, "max_mp": 20}', description="星辰布料制成的法师长袍。", price=200),
        Item(name="暗影城堡钥匙", item_type="key_item", rarity="rare",
             effect='{"unlock": "dark_castle_entrance"}', description="通往暗影城堡深处的钥匙。", price=0, is_usable=0),
        Item(name="星辉碎片", item_type="material", rarity="epic",
             effect='{}', description="星辉塔的魔法碎片，蕴含着强大的魔力。", price=1000),
    ]
    db.add_all(items)
    db.flush()

    # 人物物品
    inv_items = [
        CharacterInventory(character_id=player.id, item_id=items[0].id, quantity=3),
        CharacterInventory(character_id=player.id, item_id=items[2].id, quantity=2),
        CharacterInventory(character_id=player.id, item_id=items[3].id, quantity=1, is_equipped=1),
        CharacterInventory(character_id=mage.id, item_id=items[0].id, quantity=2),
        CharacterInventory(character_id=mage.id, item_id=items[5].id, quantity=1, is_equipped=1),
    ]
    db.add_all(inv_items)

    db.commit()
    print("✅ 测试数据填充完成！")


if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()