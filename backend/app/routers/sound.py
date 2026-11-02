from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.sound import Sound
from ..models.resource_category import ResourceCategory
from ..schemas.sound import SoundCreate, SoundUpdate, SoundResponse

router = APIRouter(prefix="/api/sounds", tags=["声音管理"])


def _sync_categories(db: Session) -> int:
    """把声音数据里出现过的 category_path 补进分类表。

    语音任务 / 剧情语音 / 卡牌语音都是直接写 Sound(category_path="剧情语音/黄蓉出现")，
    并不会去建 resource_categories。结果分类树里没有这些节点，而声音库默认只显示
    「未分类」，用户就完全看不到这些生成的音频（数据其实一直在库里）。
    这里按需补建（含各级父分类），只加不删，重复调用无副作用。
    """
    paths = {
        (row[0] or "").strip()
        for row in db.query(Sound.category_path).distinct().all()
        if (row[0] or "").strip()
    }
    if not paths:
        return 0
    exists = {
        row[0]
        for row in db.query(ResourceCategory.path)
        .filter(ResourceCategory.resource_type == "sound").all()
    }
    added = 0
    for path in sorted(paths):
        parent = ""
        for name in [x for x in path.split("/") if x]:
            cur = f"{parent}/{name}" if parent else name
            if cur not in exists:
                db.add(ResourceCategory(
                    resource_type="sound", name=name, path=cur,
                    parent_path=parent, is_system=0, sort_order=0,
                ))
                exists.add(cur)
                added += 1
            parent = cur
    if added:
        db.commit()
    return added


@router.get("/", response_model=list[SoundResponse])
def list_sounds(
    category: Optional[str] = Query(None, description="筛选分类: voice/bgm"),
    category_path: Optional[str] = Query(None, description="按自定义分类路径筛选"),
    db: Session = Depends(get_db),
):
    _sync_categories(db)   # 自动把语音包 / 剧情语音 / 卡牌语音的目录补进分类树
    query = db.query(Sound)
    if category:
        query = query.filter(Sound.category == category)
    if category_path:
        query = query.filter(
            (Sound.category_path == category_path) |
            (Sound.category_path.like(f"{category_path}/%"))
        )
    return query.order_by(Sound.id.desc()).all()


@router.get("/{sound_id}", response_model=SoundResponse)
def get_sound(sound_id: int, db: Session = Depends(get_db)):
    sound = db.query(Sound).filter(Sound.id == sound_id).first()
    if not sound:
        raise HTTPException(status_code=404, detail="声音不存在")
    return sound


@router.post("/", response_model=SoundResponse, status_code=201)
def create_sound(data: SoundCreate, db: Session = Depends(get_db)):
    sound = Sound(**data.model_dump())
    db.add(sound)
    db.commit()
    db.refresh(sound)
    return sound


@router.put("/{sound_id}", response_model=SoundResponse)
def update_sound(sound_id: int, data: SoundUpdate, db: Session = Depends(get_db)):
    sound = db.query(Sound).filter(Sound.id == sound_id).first()
    if not sound:
        raise HTTPException(status_code=404, detail="声音不存在")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(sound, key, value)
    db.commit()
    db.refresh(sound)
    return sound


@router.delete("/{sound_id}", status_code=204)
def delete_sound(sound_id: int, db: Session = Depends(get_db)):
    sound = db.query(Sound).filter(Sound.id == sound_id).first()
    if not sound:
        raise HTTPException(status_code=404, detail="声音不存在")
    db.delete(sound)
    db.commit()


@router.post("/batch-delete", status_code=200)
def batch_delete_sounds(payload: dict, db: Session = Depends(get_db)):
    """批量删除声音（声音库网格勾选后一次性删）。与单条删除一致：只删记录。"""
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="没有选中要删除的声音")
    ids = [int(x) for x in ids]
    n = (db.query(Sound)
         .filter(Sound.id.in_(ids))
         .delete(synchronize_session=False))
    db.commit()
    return {"deleted": n}