from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.game import Game, GameButton, GamePlayerOption
from ..models.character import Character
from ..schemas.game import (
    GameCreate, GameUpdate, GameResponse, GameDetailResponse,
    GameButtonCreate, GameButtonUpdate, GameButtonResponse,
    GamePlayerOptionCreate, GamePlayerOptionResponse,
)

router = APIRouter(prefix="/api/games", tags=["游戏设置"])


# ===== 游戏 CRUD =====

@router.get("/", response_model=list[GameResponse])
def list_games(
    category_path: Optional[str] = Query(None),
    is_published: Optional[int] = Query(None),
    is_carousel: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Game)
    if category_path:
        query = query.filter(
            (Game.category_path == category_path) |
            (Game.category_path.like(f"{category_path}/%"))
        )
    if is_published is not None:
        query = query.filter(Game.is_published == is_published)
    if is_carousel is not None:
        query = query.filter(Game.is_carousel == 1)
    return query.order_by(Game.sort_order, Game.id).all()


@router.get("/carousel", response_model=list[GameResponse])
def list_carousel_games(db: Session = Depends(get_db)):
    """前台首页轮播：已发布且设为轮播（必须有图片）"""
    return db.query(Game).filter(
        Game.is_published == 1,
        Game.is_carousel == 1,
        Game.image.isnot(None),
    ).order_by(Game.sort_order, Game.id).all()


@router.get("/{game_id}", response_model=GameDetailResponse)
def get_game(game_id: int, db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="游戏不存在")
    # 填充按钮
    buttons = db.query(GameButton).filter(GameButton.game_id == game_id).order_by(GameButton.sort_order, GameButton.id).all()
    # 填充可选玩家（含角色详情）
    opts = db.query(GamePlayerOption).filter(GamePlayerOption.game_id == game_id).order_by(GamePlayerOption.sort_order).all()
    player_options = []
    for o in opts:
        c = db.query(Character).filter(Character.id == o.character_id).first()
        player_options.append({
            "id": o.id,
            "character_id": o.character_id,
            "sort_order": o.sort_order,
            "character": {
                "id": c.id, "name": c.name, "title": c.title,
                "portrait_image": c.portrait_image, "level": c.level,
                "max_hp": c.max_hp, "max_mp": c.max_mp, "attack": c.attack,
                "defense": c.defense, "speed": c.speed, "luck": c.luck,
                "background_story": c.background_story, "personality": c.personality,
            } if c else None,
        })
    # 注意：不能用 GameDetailResponse.model_validate(game) 直接校验，
    # 因为 game.player_options 是 ORM 关系对象列表，而 player_options 字段声明为 list[dict]，
    # 会触发 pydantic dict_type 校验错误导致 HTTP 500。这里改为先校验基础字段再组装。
    base = GameResponse.model_validate(game)
    return GameDetailResponse(
        **base.model_dump(),
        buttons=[GameButtonResponse.model_validate(b) for b in buttons],
        player_options=player_options,
    )


@router.post("/", response_model=GameResponse, status_code=201)
def create_game(data: GameCreate, db: Session = Depends(get_db)):
    if not data.image:
        raise HTTPException(status_code=400, detail="游戏开始画面必须有图片")
    if data.is_carousel == 1 and not data.image:
        raise HTTPException(status_code=400, detail="轮播游戏必须有图片")
    game = Game(**data.model_dump())
    db.add(game)
    db.commit()
    db.refresh(game)
    return game


@router.put("/{game_id}", response_model=GameResponse)
def update_game(game_id: int, data: GameUpdate, db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="游戏不存在")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(game, k, v)
    game.updated_at = datetime.now().isoformat()
    db.commit()
    db.refresh(game)
    return game


@router.delete("/{game_id}", status_code=204)
def delete_game(game_id: int, db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="游戏不存在")
    db.delete(game)
    db.commit()


# ===== 游戏按钮 =====

@router.post("/{game_id}/buttons", response_model=GameButtonResponse, status_code=201)
def create_button(game_id: int, data: GameButtonCreate, db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="游戏不存在")
    btn = GameButton(game_id=game_id, **data.model_dump())
    db.add(btn)
    db.commit()
    db.refresh(btn)
    return btn


@router.put("/buttons/{button_id}", response_model=GameButtonResponse)
def update_button(button_id: int, data: GameButtonUpdate, db: Session = Depends(get_db)):
    btn = db.query(GameButton).filter(GameButton.id == button_id).first()
    if not btn:
        raise HTTPException(status_code=404, detail="按钮不存在")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(btn, k, v)
    db.commit()
    db.refresh(btn)
    return btn


@router.delete("/buttons/{button_id}", status_code=204)
def delete_button(button_id: int, db: Session = Depends(get_db)):
    btn = db.query(GameButton).filter(GameButton.id == button_id).first()
    if not btn:
        raise HTTPException(status_code=404, detail="按钮不存在")
    db.delete(btn)
    db.commit()


# ===== 游戏可选玩家组合 =====

@router.get("/{game_id}/players", response_model=list[GamePlayerOptionResponse])
def list_game_players(game_id: int, db: Session = Depends(get_db)):
    return db.query(GamePlayerOption).filter(GamePlayerOption.game_id == game_id).order_by(GamePlayerOption.sort_order).all()


@router.post("/{game_id}/players", response_model=GamePlayerOptionResponse, status_code=201)
def add_game_player(game_id: int, data: GamePlayerOptionCreate, db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="游戏不存在")
    char = db.query(Character).filter(Character.id == data.character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    if char.character_type != "player" or char.is_activated != 1:
        raise HTTPException(status_code=400, detail="仅已激活的玩家角色可添加")
    existing = db.query(GamePlayerOption).filter(
        GamePlayerOption.game_id == game_id,
        GamePlayerOption.character_id == data.character_id,
    ).first()
    if existing:
        return existing
    opt = GamePlayerOption(game_id=game_id, **data.model_dump())
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return opt


@router.put("/players/{option_id}", response_model=GamePlayerOptionResponse)
def update_game_player(option_id: int, data: GamePlayerOptionCreate, db: Session = Depends(get_db)):
    opt = db.query(GamePlayerOption).filter(GamePlayerOption.id == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="选项不存在")
    opt.character_id = data.character_id
    opt.sort_order = data.sort_order
    db.commit()
    db.refresh(opt)
    return opt


@router.delete("/players/{option_id}", status_code=204)
def delete_game_player(option_id: int, db: Session = Depends(get_db)):
    opt = db.query(GamePlayerOption).filter(GamePlayerOption.id == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="选项不存在")
    db.delete(opt)
    db.commit()


# 批量设置某游戏的可选玩家
@router.post("/{game_id}/players/batch", response_model=list[GamePlayerOptionResponse])
def batch_set_game_players(game_id: int, data: dict, db: Session = Depends(get_db)):
    """批量设置游戏可选玩家。请求体: { character_ids: [int,...] } 会替换原有设置"""
    character_ids = data.get("character_ids", [])
    # 清空原有
    db.query(GamePlayerOption).filter(GamePlayerOption.game_id == game_id).delete()
    result = []
    for idx, cid in enumerate(character_ids):
        char = db.query(Character).filter(Character.id == cid).first()
        if not char or char.character_type != "player" or char.is_activated != 1:
            continue
        opt = GamePlayerOption(game_id=game_id, character_id=cid, sort_order=idx)
        db.add(opt)
        result.append(opt)
    db.commit()
    for o in result:
        db.refresh(o)
    return result
