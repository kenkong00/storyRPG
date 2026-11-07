"""剧情蓝图视图的后端支撑。

两件事：
1. `GET /api/story/blueprint` —— 一次把画布要用的东西全取回来（故事/章节/节点/选项/
   对白摘要/角色名/布局），避免前端 N+1 请求。节点只给摘要，完整对白由
   `/api/story/nodes/{id}/full` 在打开检查器时再取。
2. `GET/PUT /api/story/layout` —— 节点卡片在画布上的坐标。只存位置，剧情数据仍走
   /api/story 原接口，所以列表视图与蓝图视图永远是同一份数据。
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.story import (
    StoryArc,
    StoryChapter,
    StoryChoice,
    StoryNode,
    StoryNodeDialogue,
)
from ..models.story_layout import StoryLayout

router = APIRouter(prefix="/api/story", tags=["剧情蓝图"])

ALLOWED_KINDS = {"arc", "chapter", "node"}
MAX_LAYOUT_ITEMS = 5000


def _crop(text: Optional[str], n: int = 90) -> str:
    s = (text or "").strip().replace("\r", "").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


@router.get("/blueprint")
def get_blueprint(
    arc_id: Optional[int] = Query(None, description="只看某个故事下的内容"),
    db: Session = Depends(get_db),
):
    arcs = db.query(StoryArc).order_by(StoryArc.order_index, StoryArc.id).all()

    ch_q = db.query(StoryChapter)
    if arc_id:
        ch_q = ch_q.filter(StoryChapter.story_arc_id == arc_id)
    chapters = ch_q.order_by(
        StoryChapter.story_arc_id, StoryChapter.chapter_order, StoryChapter.id
    ).all()
    chapter_ids = [c.id for c in chapters]

    node_q = db.query(StoryNode)
    if arc_id:
        node_q = node_q.filter(StoryNode.chapter_id.in_(chapter_ids or [-1]))
    nodes = node_q.order_by(
        StoryNode.chapter_id, StoryNode.order_index, StoryNode.id
    ).all()
    node_ids = [n.id for n in nodes]

    choices = (
        db.query(StoryChoice)
        .filter(StoryChoice.node_id.in_(node_ids or [-1]))
        .order_by(StoryChoice.node_id, StoryChoice.id)
        .all()
    )

    dlg_map: dict[int, dict] = {}
    speaker_ids: set[int] = set()
    if node_ids:
        rows = (
            db.query(StoryNodeDialogue)
            .filter(StoryNodeDialogue.node_id.in_(node_ids))
            .order_by(
                StoryNodeDialogue.node_id,
                StoryNodeDialogue.order_index,
                StoryNodeDialogue.id,
            )
            .all()
        )
        for d in rows:
            item = dlg_map.setdefault(d.node_id, {"count": 0, "first": []})
            item["count"] += 1
            if len(item["first"]) < 2:
                item["first"].append(
                    {
                        "speaker_id": d.speaker_id,
                        "content": _crop(d.content, 70),
                        "expression": d.expression,
                    }
                )
            if d.speaker_id:
                speaker_ids.add(d.speaker_id)

    char_names: dict[int, str] = {}
    if speaker_ids:
        for c in db.query(Character).filter(Character.id.in_(speaker_ids)).all():
            char_names[c.id] = c.name

    existing = (
        {("arc", a.id) for a in arcs}
        | {("chapter", c.id) for c in chapters}
        | {("node", n.id) for n in nodes}
    )
    layouts = [
        {
            "kind": r.kind,
            "ref_id": r.ref_id,
            "x": r.x,
            "y": r.y,
            "collapsed": r.collapsed,
        }
        for r in db.query(StoryLayout).all()
        if (r.kind, r.ref_id) in existing
    ]

    def battle_links(raw: Optional[str]) -> dict:
        """战斗节点里的三个跳转，蓝图要把它们画成边。"""
        if not raw:
            return {}
        try:
            cfg = json.loads(raw)
        except Exception:  # noqa: BLE001
            return {}
        if not isinstance(cfg, dict):
            return {}
        out = {}
        for k in ("victory_node_id", "defeat_node_id", "flee_node_id"):
            v = cfg.get(k)
            if isinstance(v, int) and v > 0:
                out[k] = v
        return out

    node_out = []
    for n in nodes:
        d = dlg_map.get(n.id, {"count": 0, "first": []})
        node_out.append(
            {
                "id": n.id,
                "chapter_id": n.chapter_id,
                "scene_id": n.scene_id,
                "node_type": n.node_type,
                "title": n.title,
                "speaker_id": n.speaker_id,
                "content": _crop(n.content, 120),
                "content_image": n.content_image,
                "expression": n.expression,
                "position": n.position,
                "bgm": n.bgm,
                "background_change": n.background_change,
                "bg_animation_effect_id": n.bg_animation_effect_id,
                "is_key_node": n.is_key_node,
                "order_index": n.order_index,
                "tags": n.tags,
                "category_path": n.category_path,
                "battle_config": n.battle_config,
                "battle_links": battle_links(n.battle_config),
                "dialogue_count": d["count"],
                "dialogue_preview": d["first"],
            }
        )

    return {
        "arcs": [
            {
                "id": a.id,
                "title": a.title,
                "description": a.description,
                "image": a.image,
                "order_index": a.order_index,
                "is_active": a.is_active,
                "category_path": a.category_path,
            }
            for a in arcs
        ],
        "chapters": [
            {
                "id": c.id,
                "title": c.title,
                "story_arc_id": c.story_arc_id,
                "chapter_order": c.chapter_order,
                "description": c.description,
                "image": c.image,
                "is_main_story": c.is_main_story,
                "prerequisite_chapter_id": c.prerequisite_chapter_id,
                "category_path": c.category_path,
            }
            for c in chapters
        ],
        "nodes": node_out,
        "choices": [
            {
                "id": ch.id,
                "node_id": ch.node_id,
                "choice_text": ch.choice_text,
                "next_node_id": ch.next_node_id,
                "condition_group": ch.condition_group,
                "is_hidden": ch.is_hidden,
            }
            for ch in choices
        ],
        "characters": char_names,
        "layout": layouts,
        "stats": {
            "arcs": len(arcs),
            "chapters": len(chapters),
            "nodes": len(nodes),
            "choices": len(choices),
        },
    }


@router.get("/layout")
def get_layout(kind: Optional[str] = Query(None), db: Session = Depends(get_db)):
    q = db.query(StoryLayout)
    if kind:
        q = q.filter(StoryLayout.kind == kind)
    return {
        "items": [
            {
                "kind": r.kind,
                "ref_id": r.ref_id,
                "x": r.x,
                "y": r.y,
                "collapsed": r.collapsed,
            }
            for r in q.all()
        ]
    }


@router.put("/layout")
def put_layout(payload: dict, db: Session = Depends(get_db)):
    """批量 upsert。前端拖完节点 debounce 一次提交，不会一条一请求。"""
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items 必须是数组")
    if len(items) > MAX_LAYOUT_ITEMS:
        raise HTTPException(status_code=400, detail="一次提交的节点太多")

    now = datetime.now().isoformat()
    saved = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        kind = it.get("kind")
        ref_id = it.get("ref_id")
        if kind not in ALLOWED_KINDS or not isinstance(ref_id, int) or ref_id <= 0:
            continue
        try:
            x = float(it.get("x", 0))
            y = float(it.get("y", 0))
        except (TypeError, ValueError):
            continue
        collapsed = 1 if it.get("collapsed") else 0
        row = (
            db.query(StoryLayout)
            .filter(StoryLayout.kind == kind, StoryLayout.ref_id == ref_id)
            .first()
        )
        if row is None:
            db.add(
                StoryLayout(
                    kind=kind,
                    ref_id=ref_id,
                    x=x,
                    y=y,
                    collapsed=collapsed,
                    updated_at=now,
                )
            )
        else:
            row.x, row.y, row.collapsed, row.updated_at = x, y, collapsed, now
        saved += 1
    db.commit()
    return {"ok": True, "saved": saved}


@router.delete("/layout")
def clear_layout(
    kind: Optional[str] = Query(None, description="只清某一类，不传则全清"),
    db: Session = Depends(get_db),
):
    q = db.query(StoryLayout)
    if kind:
        q = q.filter(StoryLayout.kind == kind)
    n = q.delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": n}
