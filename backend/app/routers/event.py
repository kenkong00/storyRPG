from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.event import Event, EventLog
from ..schemas.event import (
    EventCreate, EventUpdate, EventResponse,
    EventLogCreate, EventLogResponse,
)

router = APIRouter(prefix="/api/events", tags=["事件系统"])


@router.get("/", response_model=list[EventResponse])
def list_events(
    event_type: Optional[str] = Query(None),
    trigger_type: Optional[str] = Query(None),
    is_one_time: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Event)
    if event_type:
        query = query.filter(Event.event_type == event_type)
    if trigger_type:
        query = query.filter(Event.trigger_type == trigger_type)
    if is_one_time is not None:
        query = query.filter(Event.is_one_time == is_one_time)
    return query.all()


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="事件不存在")
    return event


@router.post("/", response_model=EventResponse, status_code=201)
def create_event(data: EventCreate, db: Session = Depends(get_db)):
    event = Event(**data.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="事件不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="事件不存在")
    db.delete(event)
    db.commit()


# --- 事件日志 ---

@router.get("/{event_id}/logs", response_model=list[EventLogResponse])
def get_event_logs(event_id: int, db: Session = Depends(get_db)):
    return db.query(EventLog).filter(EventLog.event_id == event_id).all()


@router.post("/{event_id}/trigger", response_model=EventLogResponse, status_code=201)
def trigger_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="事件不存在")
    if event.is_one_time and event.has_triggered:
        raise HTTPException(status_code=400, detail="一次性事件已触发过")
    log = EventLog(event_id=event_id)
    db.add(log)
    event.has_triggered = 1
    db.commit()
    db.refresh(log)
    return log


@router.post("/check")
def check_events(
    trigger_type: str = Query(...),
    db: Session = Depends(get_db),
):
    """检查可触发的事件"""
    events = db.query(Event).filter(
        Event.trigger_type == trigger_type,
        (Event.is_one_time == 0) | (Event.has_triggered == 0),
    ).order_by(Event.priority.desc()).all()
    return {
        "count": len(events),
        "events": [
            {
                "id": e.id, "name": e.name, "event_type": e.event_type,
                "trigger_condition": e.trigger_condition, "priority": e.priority,
                "effects": e.effects,
            }
            for e in events
        ],
    }