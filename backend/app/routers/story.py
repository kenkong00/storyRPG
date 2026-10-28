from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
import json

from ..database import get_db
from ..models.story import StoryChapter, StoryNode, StoryNodeDialogue, StoryChoice, StoryCondition, StoryFlag
from ..models.character import Character
from ..schemas.story import (
    StoryChapterCreate, StoryChapterUpdate, StoryChapterResponse,
    StoryNodeCreate, StoryNodeResponse,
    StoryNodeDialogueCreate, StoryNodeDialogueUpdate, StoryNodeDialogueResponse,
    StoryChoiceCreate, StoryChoiceResponse,
    StoryConditionCreate, StoryConditionResponse,
    StoryFlagCreate, StoryFlagResponse,
)

router = APIRouter(prefix="/api/story", tags=["故事剧情"])


# --- 章节 ---

@router.get("/chapters", response_model=list[StoryChapterResponse])
def list_chapters(
    is_main_story: Optional[int] = Query(None),
    story_arc_id: Optional[int] = Query(None),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(StoryChapter)
    if is_main_story is not None:
        query = query.filter(StoryChapter.is_main_story == is_main_story)
    if story_arc_id is not None:
        query = query.filter(StoryChapter.story_arc_id == story_arc_id)
    if category_path:
        query = query.filter(
            (StoryChapter.category_path == category_path) |
            (StoryChapter.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(StoryChapter.chapter_order).all()


@router.get("/chapters/{chapter_id}", response_model=StoryChapterResponse)
def get_chapter(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.query(StoryChapter).filter(StoryChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return chapter


@router.post("/chapters", response_model=StoryChapterResponse, status_code=201)
def create_chapter(data: StoryChapterCreate, db: Session = Depends(get_db)):
    chapter = StoryChapter(**data.model_dump())
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.put("/chapters/{chapter_id}", response_model=StoryChapterResponse)
def update_chapter(chapter_id: int, data: StoryChapterUpdate, db: Session = Depends(get_db)):
    chapter = db.query(StoryChapter).filter(StoryChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(chapter, key, value)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.delete("/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.query(StoryChapter).filter(StoryChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    db.delete(chapter)
    db.commit()


# --- 故事节点 ---

@router.get("/nodes", response_model=list[StoryNodeResponse])
def list_nodes(
    chapter_id: Optional[int] = Query(None),
    node_type: Optional[str] = Query(None),
    scene_id: Optional[int] = Query(None),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(StoryNode)
    if chapter_id:
        query = query.filter(StoryNode.chapter_id == chapter_id)
    if node_type:
        query = query.filter(StoryNode.node_type == node_type)
    if scene_id:
        query = query.filter(StoryNode.scene_id == scene_id)
    if category_path:
        query = query.filter(
            (StoryNode.category_path == category_path) |
            (StoryNode.category_path.like(f"{category_path}/%"))
        )
    nodes = query.order_by(StoryNode.order_index).all()

    # 附加：每个节点「对话列表」里出现过的人物名（按首次发言顺序，去重）
    node_ids = [n.id for n in nodes]
    speak_map: dict[int, list[str]] = {n.id: [] for n in nodes}
    if node_ids:
        rows = (
            db.query(StoryNodeDialogue.node_id, Character.name)
            .join(Character, Character.id == StoryNodeDialogue.speaker_id)
            .filter(
                StoryNodeDialogue.node_id.in_(node_ids),
                StoryNodeDialogue.speaker_id.isnot(None),
            )
            .order_by(StoryNodeDialogue.node_id, StoryNodeDialogue.order_index, StoryNodeDialogue.id)
            .all()
        )
        for nid, cname in rows:
            if not cname:
                continue
            lst = speak_map.setdefault(nid, [])
            if cname not in lst:
                lst.append(cname)
    for n in nodes:
        n.speaker_names = speak_map.get(n.id, [])
    return nodes


@router.get("/nodes/{node_id}", response_model=StoryNodeResponse)
def get_node(node_id: int, db: Session = Depends(get_db)):
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    return node


@router.get("/nodes/{node_id}/full")
def get_node_full(node_id: int, db: Session = Depends(get_db)):
    """获取节点的完整信息（包含选项和条件）"""
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    def _dlg_to_dict(d: StoryNodeDialogue):
        return {
            "id": d.id, "node_id": d.node_id, "order_index": d.order_index,
            "speaker_id": d.speaker_id, "content": d.content, "expression": d.expression,
            "pos_x": d.pos_x, "pos_y": d.pos_y, "scale": d.scale,
            "crop_top": d.crop_top, "crop_bottom": d.crop_bottom,
            "flip": d.flip, "z_index": d.z_index,
            "disappear_after": d.disappear_after,
            "animation_effect_id": d.animation_effect_id,
            "voice": d.voice, "bg_change": d.bg_change, "bgm": d.bgm,
        }

    dialogues = db.query(StoryNodeDialogue).filter(
        StoryNodeDialogue.node_id == node_id
    ).order_by(StoryNodeDialogue.order_index, StoryNodeDialogue.id).all()

    choices = db.query(StoryChoice).filter(StoryChoice.node_id == node_id).all()
    return {
        "node": {
            "id": node.id, "chapter_id": node.chapter_id, "scene_id": node.scene_id,
            "node_type": node.node_type, "title": node.title, "speaker_id": node.speaker_id,
            "content": node.content, "content_image": node.content_image,
            "expression": node.expression, "position": node.position,
            "multi_characters": node.multi_characters,
            "bgm": node.bgm, "background_change": node.background_change,
            "bg_animation_effect_id": node.bg_animation_effect_id,
            "is_key_node": node.is_key_node, "order_index": node.order_index,
        },
        "dialogues": [_dlg_to_dict(d) for d in dialogues],
        "choices": [
            {
                "id": c.id, "choice_text": c.choice_text, "next_node_id": c.next_node_id,
                "condition_group": c.condition_group, "effects": c.effects, "is_hidden": c.is_hidden,
            }
            for c in choices
        ],
    }


@router.post("/nodes", response_model=StoryNodeResponse, status_code=201)
def create_node(data: StoryNodeCreate, db: Session = Depends(get_db)):
    node = StoryNode(**data.model_dump())
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


@router.put("/nodes/{node_id}", response_model=StoryNodeResponse)
def update_node(node_id: int, data: StoryNodeCreate, db: Session = Depends(get_db)):
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    for key, value in data.model_dump().items():
        setattr(node, key, value)
    db.commit()
    db.refresh(node)
    return node


@router.delete("/nodes/{node_id}", status_code=204)
def delete_node(node_id: int, db: Session = Depends(get_db)):
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    db.query(StoryNodeDialogue).filter(StoryNodeDialogue.node_id == node_id).delete(synchronize_session=False)
    db.delete(node)
    db.commit()


# --- 节点对话列表（一个节点可包含多句对白） ---

@router.get("/nodes/{node_id}/dialogues", response_model=list[StoryNodeDialogueResponse])
def list_node_dialogues(node_id: int, db: Session = Depends(get_db)):
    return db.query(StoryNodeDialogue).filter(
        StoryNodeDialogue.node_id == node_id
    ).order_by(StoryNodeDialogue.order_index, StoryNodeDialogue.id).all()


@router.post("/nodes/{node_id}/dialogues", response_model=StoryNodeDialogueResponse, status_code=201)
def create_node_dialogue(node_id: int, data: StoryNodeDialogueUpdate, db: Session = Depends(get_db)):
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    payload = data.model_dump(exclude_unset=True)
    payload.pop("node_id", None)
    if "order_index" not in payload:
        max_idx = db.query(StoryNodeDialogue).filter(StoryNodeDialogue.node_id == node_id).count()
        payload["order_index"] = max_idx
    dlg = StoryNodeDialogue(node_id=node_id, **payload)
    db.add(dlg)
    db.commit()
    db.refresh(dlg)
    return dlg


@router.put("/nodes/{node_id}/dialogues/{dlg_id}", response_model=StoryNodeDialogueResponse)
def update_node_dialogue(node_id: int, dlg_id: int, data: StoryNodeDialogueUpdate, db: Session = Depends(get_db)):
    dlg = db.query(StoryNodeDialogue).filter(
        StoryNodeDialogue.id == dlg_id, StoryNodeDialogue.node_id == node_id
    ).first()
    if not dlg:
        raise HTTPException(status_code=404, detail="对话不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(dlg, key, value)
    db.commit()
    db.refresh(dlg)
    return dlg


@router.delete("/nodes/{node_id}/dialogues/{dlg_id}", status_code=204)
def delete_node_dialogue(node_id: int, dlg_id: int, db: Session = Depends(get_db)):
    dlg = db.query(StoryNodeDialogue).filter(
        StoryNodeDialogue.id == dlg_id, StoryNodeDialogue.node_id == node_id
    ).first()
    if not dlg:
        raise HTTPException(status_code=404, detail="对话不存在")
    db.delete(dlg)
    db.commit()


@router.post("/nodes/{node_id}/dialogues/reorder", status_code=200)
def reorder_node_dialogues(node_id: int, data: dict, db: Session = Depends(get_db)):
    """排序：body = { ordered_ids: [3,1,2] }"""
    ordered_ids = data.get("ordered_ids", [])
    if not ordered_ids:
        raise HTTPException(status_code=400, detail="参数不完整")
    for index, did in enumerate(ordered_ids):
        dlg = db.query(StoryNodeDialogue).filter(
            StoryNodeDialogue.id == did, StoryNodeDialogue.node_id == node_id
        ).first()
        if dlg:
            dlg.order_index = index
    db.commit()
    return {"updated": len(ordered_ids)}


@router.post("/nodes/{node_id}/dialogues/from-node", response_model=list[StoryNodeDialogueResponse], status_code=201)
def build_dialogues_from_node(node_id: int, db: Session = Depends(get_db)):
    """把当前节点的「单句对白 + 在场人物」转换成对话列表（老数据一键升级）。
    若节点已有对话列表，则不重复生成（返回现有列表）。
    """
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    exists = db.query(StoryNodeDialogue).filter(StoryNodeDialogue.node_id == node_id).count()
    if exists:
        return db.query(StoryNodeDialogue).filter(
            StoryNodeDialogue.node_id == node_id
        ).order_by(StoryNodeDialogue.order_index, StoryNodeDialogue.id).all()

    # 旧站位枚举 → 默认百分比坐标
    POS_MAP = {
        "left-1": 12.0, "left-2": 25.0, "left-3": 38.0,
        "left": 25.0, "center": 50.0,
        "right-1": 88.0, "right-2": 75.0, "right-3": 62.0, "right": 75.0,
        "first_person": 50.0,
    }

    # 在场人物（用于补全没有台词的人物）
    on_stage = []
    if node.multi_characters:
        try:
            arr = json.loads(node.multi_characters)
            if isinstance(arr, list):
                on_stage = arr
        except Exception:
            on_stage = []

    created = []
    idx = 0

    # 1) 主台词（节点自身 content）
    if node.content:
        pos = POS_MAP.get(node.position or "center", 50.0)
        speaker_pos = pos
        for ch in on_stage:
            if node.speaker_id and ch.get("speaker_id") == node.speaker_id:
                speaker_pos = POS_MAP.get(ch.get("position") or "center", pos)
        dlg = StoryNodeDialogue(
            node_id=node_id, order_index=idx, speaker_id=node.speaker_id,
            content=node.content, expression=node.expression,
            pos_x=speaker_pos, pos_y=0.0, scale=1.0,
            crop_top=0.0, crop_bottom=100.0, flip=0, z_index=1,
        )
        db.add(dlg)
        created.append(dlg)
        idx += 1

    # 2) 其余在场人物（无台词，仅占位显示）
    for ch in on_stage:
        sid = ch.get("speaker_id")
        if not sid or (node.speaker_id and sid == node.speaker_id):
            continue
        dlg = StoryNodeDialogue(
            node_id=node_id, order_index=idx, speaker_id=sid,
            content='', expression=ch.get("expression"),
            pos_x=POS_MAP.get(ch.get("position") or "center", 50.0),
            pos_y=0.0, scale=1.0, crop_top=0.0, crop_bottom=100.0,
            flip=0, z_index=1, animation_effect_id=ch.get("animation_effect_id"),
        )
        db.add(dlg)
        created.append(dlg)
        idx += 1

    db.commit()
    for d in created:
        db.refresh(d)
    return created


@router.post("/nodes/batch-delete", status_code=204)
def batch_delete_nodes(data: dict, db: Session = Depends(get_db)):
    """批量删除节点"""
    ids = data.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="ID列表为空")
    db.query(StoryNodeDialogue).filter(StoryNodeDialogue.node_id.in_(ids)).delete(synchronize_session=False)
    db.query(StoryNode).filter(StoryNode.id.in_(ids)).delete(synchronize_session=False)
    db.commit()


@router.post("/nodes/batch-update-tags")
def batch_update_node_tags(data: dict, db: Session = Depends(get_db)):
    """批量更新节点标签"""
    ids = data.get("ids", [])
    tag_ids = data.get("tag_ids", [])
    mode = data.get("mode", "add")  # add / remove / replace
    if not ids or not tag_ids:
        raise HTTPException(status_code=400, detail="参数不完整")
    import json
    updated = 0
    for nid in ids:
        node = db.query(StoryNode).filter(StoryNode.id == nid).first()
        if not node:
            continue
        current = []
        if node.tags:
            try:
                current = json.loads(node.tags)
            except (json.JSONDecodeError, TypeError):
                current = []
        if mode == "add":
            for tid in tag_ids:
                if tid not in current:
                    current.append(tid)
        elif mode == "remove":
            current = [t for t in current if t not in tag_ids]
        elif mode == "replace":
            current = list(tag_ids)
        node.tags = json.dumps(current)
        updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/nodes/batch-update-bg-animation")
def batch_update_node_bg_animation(data: dict, db: Session = Depends(get_db)):
    """批量更新节点背景转场动效"""
    ids = data.get("ids", [])
    effect_id = data.get("effect_id")  # null = 清除动效
    if not ids:
        raise HTTPException(status_code=400, detail="ID列表为空")
    updated = 0
    for nid in ids:
        node = db.query(StoryNode).filter(StoryNode.id == nid).first()
        if not node:
            continue
        node.bg_animation_effect_id = effect_id
        updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/nodes/batch-update-background")
def batch_update_node_background(data: dict, db: Session = Depends(get_db)):
    """批量更新节点背景图片"""
    ids = data.get("ids", [])
    background = data.get("background")  # 图片URL，null/空字符串=清除
    if not ids:
        raise HTTPException(status_code=400, detail="ID列表为空")
    updated = 0
    for nid in ids:
        node = db.query(StoryNode).filter(StoryNode.id == nid).first()
        if not node:
            continue
        node.background_change = background or None
        updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/nodes/batch-update-type")
def batch_update_node_type(data: dict, db: Session = Depends(get_db)):
    """批量更新节点类型"""
    ids = data.get("ids", [])
    node_type = data.get("node_type")
    if not ids or not node_type:
        raise HTTPException(status_code=400, detail="参数不完整")
    if node_type not in ("dialogue", "choice", "battle", "cutscene"):
        raise HTTPException(status_code=400, detail=f"无效的节点类型: {node_type}")
    updated = 0
    for nid in ids:
        node = db.query(StoryNode).filter(StoryNode.id == nid).first()
        if not node:
            continue
        node.node_type = node_type
        updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/nodes/reorder")
def reorder_nodes(data: dict, db: Session = Depends(get_db)):
    """批量重排序节点（拖拽排序）。
    请求体: { chapter_id: int, ordered_ids: [int] }
    ordered_ids 为按新顺序排列的节点ID列表。
    会重新分配 order_index 从1开始，并同步更新 J编号。
    """
    chapter_id = data.get("chapter_id")
    ordered_ids = data.get("ordered_ids", [])
    if not chapter_id or not ordered_ids:
        raise HTTPException(status_code=400, detail="参数不完整")
    updated = 0
    for index, nid in enumerate(ordered_ids, start=1):
        node = db.query(StoryNode).filter(StoryNode.id == nid, StoryNode.chapter_id == chapter_id).first()
        if not node:
            continue
        node.order_index = index
        updated += 1
    db.commit()
    return {"updated": updated, "ordered_ids": ordered_ids}


@router.patch("/nodes/{node_id}/field")
def patch_node_field(node_id: int, data: dict, db: Session = Depends(get_db)):
    """快捷修改节点单个字段（立即保存到数据库）。
    请求体: { field: 字段名, value: 值 }
    支持的字段: node_type, speaker_id, content, background_change,
                bg_animation_effect_id, expression, position, bgm, title
    """
    ALLOWED_FIELDS = {
        "node_type", "speaker_id", "content", "background_change",
        "bg_animation_effect_id", "expression", "position", "bgm", "title",
        "category_path"
    }
    # 整型字段需要转换
    INT_FIELDS = {"speaker_id", "bg_animation_effect_id"}
    field = data.get("field")
    value = data.get("value")
    if not field or field not in ALLOWED_FIELDS:
        raise HTTPException(status_code=400, detail=f"不支持的字段: {field}")
    node = db.query(StoryNode).filter(StoryNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    # 处理空值
    if value == "" or value is None:
        value = None
    elif field in INT_FIELDS:
        try:
            value = int(value)
        except (ValueError, TypeError):
            value = None
    setattr(node, field, value)
    db.commit()
    db.refresh(node)
    return {"id": node.id, "field": field, "value": value}


# --- 故事选择 ---

@router.get("/nodes/{node_id}/choices", response_model=list[StoryChoiceResponse])
def get_node_choices(node_id: int, db: Session = Depends(get_db)):
    return db.query(StoryChoice).filter(StoryChoice.node_id == node_id).all()


@router.post("/choices", response_model=StoryChoiceResponse, status_code=201)
def create_choice(data: StoryChoiceCreate, db: Session = Depends(get_db)):
    choice = StoryChoice(**data.model_dump())
    db.add(choice)
    db.commit()
    db.refresh(choice)
    return choice


@router.put("/choices/{choice_id}", response_model=StoryChoiceResponse)
def update_choice(choice_id: int, data: StoryChoiceCreate, db: Session = Depends(get_db)):
    """更新选项"""
    choice = db.query(StoryChoice).filter(StoryChoice.id == choice_id).first()
    if not choice:
        raise HTTPException(status_code=404, detail="选项不存在")
    for key, value in data.model_dump().items():
        setattr(choice, key, value)
    db.commit()
    db.refresh(choice)
    return choice


@router.delete("/choices/{choice_id}", status_code=204)
def delete_choice(choice_id: int, db: Session = Depends(get_db)):
    """删除选项"""
    choice = db.query(StoryChoice).filter(StoryChoice.id == choice_id).first()
    if not choice:
        raise HTTPException(status_code=404, detail="选项不存在")
    db.delete(choice)
    db.commit()


# --- 故事条件 ---

@router.get("/conditions", response_model=list[StoryConditionResponse])
def list_conditions(
    condition_group: Optional[str] = Query(None),
    condition_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(StoryCondition)
    if condition_group:
        query = query.filter(StoryCondition.condition_group == condition_group)
    if condition_type:
        query = query.filter(StoryCondition.condition_type == condition_type)
    return query.all()


@router.post("/conditions", response_model=StoryConditionResponse, status_code=201)
def create_condition(data: StoryConditionCreate, db: Session = Depends(get_db)):
    condition = StoryCondition(**data.model_dump())
    db.add(condition)
    db.commit()
    db.refresh(condition)
    return condition


# --- 故事标记 ---

@router.get("/flags", response_model=list[StoryFlagResponse])
def list_flags(db: Session = Depends(get_db)):
    return db.query(StoryFlag).all()


@router.get("/flags/{flag_key}", response_model=StoryFlagResponse)
def get_flag(flag_key: str, db: Session = Depends(get_db)):
    flag = db.query(StoryFlag).filter(StoryFlag.flag_key == flag_key).first()
    if not flag:
        raise HTTPException(status_code=404, detail="标记不存在")
    return flag


@router.post("/flags", response_model=StoryFlagResponse, status_code=201)
def set_flag(data: StoryFlagCreate, db: Session = Depends(get_db)):
    existing = db.query(StoryFlag).filter(StoryFlag.flag_key == data.flag_key).first()
    if existing:
        existing.flag_value = data.flag_value
        existing.description = data.description
        db.commit()
        db.refresh(existing)
        return existing
    flag = StoryFlag(**data.model_dump())
    db.add(flag)
    db.commit()
    db.refresh(flag)
    return flag


@router.put("/flags/{flag_key}", response_model=StoryFlagResponse)
def update_flag(flag_key: str, value: str = "", description: Optional[str] = None, db: Session = Depends(get_db)):
    flag = db.query(StoryFlag).filter(StoryFlag.flag_key == flag_key).first()
    if not flag:
        raise HTTPException(status_code=404, detail="标记不存在")
    flag.flag_value = value
    if description is not None:
        flag.description = description
    db.commit()
    db.refresh(flag)
    return flag


# --- 条件检查 ---

@router.post("/check-conditions/{condition_group}")
def check_conditions(condition_group: str, db: Session = Depends(get_db)):
    """检查一组条件是否满足"""
    conditions = db.query(StoryCondition).filter(
        StoryCondition.condition_group == condition_group
    ).all()
    if not conditions:
        return {"result": False, "reason": "条件组不存在"}
    return {"result": True, "conditions": conditions, "message": "条件组存在，具体判断需在业务层实现"}