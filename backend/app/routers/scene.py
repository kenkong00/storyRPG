from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.scene import Scene, SceneConnection, SceneNPC
from ..schemas.scene import (
    SceneCreate, SceneUpdate, SceneResponse,
    SceneConnectionCreate, SceneConnectionResponse,
    SceneNPCCreate, SceneNPCResponse,
)

router = APIRouter(prefix="/api/scenes", tags=["场景系统"])


# --- 场景 CRUD ---

@router.get("/", response_model=list[SceneResponse])
def list_scenes(
    scene_type: Optional[str] = Query(None),
    parent_region: Optional[str] = Query(None),
    is_safe_zone: Optional[int] = Query(None),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(Scene)
    if scene_type:
        query = query.filter(Scene.scene_type == scene_type)
    if parent_region:
        query = query.filter(Scene.parent_region == parent_region)
    if is_safe_zone is not None:
        query = query.filter(Scene.is_safe_zone == is_safe_zone)
    if category_path:
        query = query.filter(
            (Scene.category_path == category_path) |
            (Scene.category_path.like(f"{category_path}/%"))
        )
    return query.all()


@router.get("/{scene_id}", response_model=SceneResponse)
def get_scene(scene_id: int, db: Session = Depends(get_db)):
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if not scene:
        raise HTTPException(status_code=404, detail="场景不存在")
    return scene


@router.post("/", response_model=SceneResponse, status_code=201)
def create_scene(data: SceneCreate, db: Session = Depends(get_db)):
    scene = Scene(**data.model_dump())
    db.add(scene)
    db.commit()
    db.refresh(scene)
    return scene


@router.put("/{scene_id}", response_model=SceneResponse)
def update_scene(scene_id: int, data: SceneUpdate, db: Session = Depends(get_db)):
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if not scene:
        raise HTTPException(status_code=404, detail="场景不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(scene, key, value)
    db.commit()
    db.refresh(scene)
    return scene


@router.delete("/{scene_id}", status_code=204)
def delete_scene(scene_id: int, db: Session = Depends(get_db)):
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if not scene:
        raise HTTPException(status_code=404, detail="场景不存在")
    # 清理关联（连接 / 场景 NPC / 出图记录），避免留下孤儿数据
    db.query(SceneConnection).filter(
        (SceneConnection.from_scene_id == scene_id) |
        (SceneConnection.to_scene_id == scene_id)
    ).delete(synchronize_session=False)
    db.query(SceneNPC).filter(SceneNPC.scene_id == scene_id).delete(synchronize_session=False)
    try:
        from ..models.scene_image import SceneImage
        db.query(SceneImage).filter(SceneImage.scene_id == scene_id).delete(synchronize_session=False)
    except Exception:
        pass
    db.delete(scene)
    db.commit()


# --- 场景连接 ---

@router.get("/{scene_id}/connections", response_model=list[SceneConnectionResponse])
def get_scene_connections(scene_id: int, db: Session = Depends(get_db)):
    return db.query(SceneConnection).filter(SceneConnection.from_scene_id == scene_id).all()


@router.get("/connections", response_model=list[SceneConnectionResponse])
def list_connections(
    from_scene_id: Optional[int] = Query(None),
    to_scene_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(SceneConnection)
    if from_scene_id:
        query = query.filter(SceneConnection.from_scene_id == from_scene_id)
    if to_scene_id:
        query = query.filter(SceneConnection.to_scene_id == to_scene_id)
    return query.all()


@router.post("/connections", response_model=SceneConnectionResponse, status_code=201)
def create_connection(data: SceneConnectionCreate, db: Session = Depends(get_db)):
    conn = SceneConnection(**data.model_dump())
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


# --- 场景NPC ---

@router.get("/{scene_id}/npcs", response_model=list[SceneNPCResponse])
def get_scene_npcs(scene_id: int, db: Session = Depends(get_db)):
    return db.query(SceneNPC).filter(SceneNPC.scene_id == scene_id).all()


@router.post("/{scene_id}/npcs", response_model=SceneNPCResponse, status_code=201)
def add_scene_npc(scene_id: int, data: SceneNPCCreate, db: Session = Depends(get_db)):
    npc = SceneNPC(scene_id=scene_id, **data.model_dump(exclude={"scene_id"}))
    db.add(npc)
    db.commit()
    db.refresh(npc)
    return npc