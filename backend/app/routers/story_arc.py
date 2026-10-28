from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.story import StoryArc
from ..schemas.story import StoryArcCreate, StoryArcUpdate, StoryArcResponse

router = APIRouter(prefix="/api/story-arcs", tags=["故事剧情"])


@router.get("/", response_model=list[StoryArcResponse])
def list_story_arcs(
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    query = db.query(StoryArc)
    if category_path:
        query = query.filter(
            (StoryArc.category_path == category_path) |
            (StoryArc.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(StoryArc.order_index).all()


@router.get("/{arc_id}", response_model=StoryArcResponse)
def get_story_arc(arc_id: int, db: Session = Depends(get_db)):
    arc = db.query(StoryArc).filter(StoryArc.id == arc_id).first()
    if not arc:
        raise HTTPException(status_code=404, detail="故事不存在")
    return arc


@router.post("/", response_model=StoryArcResponse, status_code=201)
def create_story_arc(data: StoryArcCreate, db: Session = Depends(get_db)):
    arc = StoryArc(**data.model_dump())
    db.add(arc)
    db.commit()
    db.refresh(arc)
    return arc


@router.put("/{arc_id}", response_model=StoryArcResponse)
def update_story_arc(arc_id: int, data: StoryArcUpdate, db: Session = Depends(get_db)):
    arc = db.query(StoryArc).filter(StoryArc.id == arc_id).first()
    if not arc:
        raise HTTPException(status_code=404, detail="故事不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(arc, key, value)
    db.commit()
    db.refresh(arc)
    return arc


@router.delete("/{arc_id}", status_code=204)
def delete_story_arc(arc_id: int, db: Session = Depends(get_db)):
    arc = db.query(StoryArc).filter(StoryArc.id == arc_id).first()
    if not arc:
        raise HTTPException(status_code=404, detail="故事不存在")
    db.delete(arc)
    db.commit()