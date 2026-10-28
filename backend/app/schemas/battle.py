from pydantic import BaseModel, Field
from typing import Optional


class BattleCreate(BaseModel):
    story_node_id: Optional[int] = None
    scene_id: Optional[int] = None
    battle_type: str = Field(default="story")
    status: str = Field(default="pending")
    player_party: Optional[str] = None
    enemy_party: Optional[str] = None
    battle_log: Optional[str] = None


class BattleResponse(BaseModel):
    id: int
    story_node_id: Optional[int] = None
    scene_id: Optional[int] = None
    user_character_id: Optional[int] = None
    battle_type: str
    status: str
    player_party: Optional[str] = None
    enemy_party: Optional[str] = None
    battle_log: Optional[str] = None
    round: int = 1
    exp_gained: int = 0
    coin_gained: int = 0
    drops: Optional[str] = None
    rewards: Optional[str] = None
    started_at: str
    ended_at: Optional[str] = None

    model_config = {"from_attributes": True}


# ===== 战斗系统 v2 =====

class BattleV2Start(BaseModel):
    """开始战斗：可指定剧情节点（读节点的 battle_config），也可直接给敌人列表。"""
    story_node_id: Optional[int] = None
    user_character_id: Optional[int] = None
    battle_type: Optional[str] = None
    enemies: Optional[list] = None              # [{character_id, level_mode, ...}]
    ally_character_ids: Optional[list[int]] = None
    config_override: Optional[dict] = None


class BattleV2Action(BaseModel):
    uid: Optional[str] = None                   # 行动单位（默认取服务端等待中的单位）
    type: str = Field(default="attack")         # attack / skill / defend / item / flee
    skill_id: Optional[int] = None
    target_uid: Optional[str] = None
    item_id: Optional[int] = None


class BattleV2Auto(BaseModel):
    enabled: bool = True


class BattleTurnCreate(BaseModel):
    battle_id: int
    turn_number: int = Field(default=1)
    actor_id: int
    action_type: str = Field(...)
    skill_id: Optional[int] = None
    target_id: int
    damage: int = Field(default=0)
    is_critical: int = Field(default=0)
    target_expression: Optional[str] = None
    actor_expression: Optional[str] = None
    visual_description: Optional[str] = None


class BattleTurnResponse(BaseModel):
    id: int
    battle_id: int
    turn_number: int
    actor_id: int
    action_type: str
    skill_id: Optional[int] = None
    target_id: int
    damage: int
    is_critical: int
    target_expression: Optional[str] = None
    actor_expression: Optional[str] = None
    visual_description: Optional[str] = None
    created_at: str

    model_config = {"from_attributes": True}


class CombatExpressionCreate(BaseModel):
    character_id: int
    expression_type: str = Field(...)
    trigger_condition: str = Field(...)
    image_prompt: Optional[str] = None
    pose_description: Optional[str] = None
    dialogue_line: Optional[str] = None


class CombatExpressionResponse(BaseModel):
    id: int
    character_id: int
    expression_type: str
    trigger_condition: str
    image_prompt: Optional[str] = None
    pose_description: Optional[str] = None
    dialogue_line: Optional[str] = None

    model_config = {"from_attributes": True}