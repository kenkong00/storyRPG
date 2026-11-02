# -*- coding: utf-8 -*-
"""卡牌对决系统 API。

分三块：
  1) 卡牌系统（职业 / 卡牌 / 情感 / 对话规则 / 角色卡组 / 设置）—— 后台管理用；
  2) 卡面对局 —— 前端演出用，服务端权威、事件流驱动；
  3) 卡面生图 —— 拼提示词 + 起 ComfyUI 任务。

所有读接口不要求登录（本机单机游戏），写接口直接落库。
"""

from __future__ import annotations

import json
import random
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.cardgame import (
    CardArt, CardBattle, CardClass, CardDef, CardDialogue, CardEmotion,
    CardLoadout, CardSetting, CardCharacterEmotion,
)
from ..models.story import StoryNode
from ..services import card_art, card_dialogue, card_seed
from ..services.card_battle_engine import CardBattle as Engine

router = APIRouter(prefix="/api/cardgame", tags=["卡牌对决"])

CARD_FIELDS = {
    "code", "name", "class_code", "class_label", "category", "category_label", "cost",
    "value", "hits", "bonus_crit", "crit_bonus_flat", "extra_def", "heal_val",
    "half_def_pierce", "atk_debuff", "draw_count", "needs_target", "max_copies", "script",
    "desc", "rules_detail", "lore", "quote", "art_action", "art_expression", "art_extra",
    "image_url", "art_status", "sort", "enabled",
}
CLASS_FIELDS = {
    "code", "name", "icon", "hp", "defense", "spd", "cri", "role",
    "counters", "nemesis", "lore", "quote", "art_style", "outfit_male", "outfit_female",
    "outfit_other", "default_deck", "sort", "enabled",
}
EMOTION_FIELDS = {
    "code", "name", "tag", "emoji", "color", "accent", "player_line", "ai_line",
    "reply_codes", "image_url", "sort", "enabled",
}
DIALOGUE_FIELDS = {
    "trigger", "side", "emotion_code", "text", "weight", "cooldown_rounds",
    "once_per_battle", "priority", "enabled", "note", "sort",
}


# ======================================================================
# 序列化
# ======================================================================
def _card_dict(c: CardDef) -> dict:
    try:
        rules = json.loads(c.rules_detail or "[]")
    except Exception:
        rules = []
    return {
        "id": c.id, "code": c.code, "name": c.name,
        "class_code": c.class_code, "class_label": c.class_label,
        "category": c.category, "category_label": c.category_label,
        "cost": c.cost, "value": c.value, "hits": c.hits,
        "bonus_crit": c.bonus_crit, "crit_bonus_flat": c.crit_bonus_flat,
        "extra_def": c.extra_def, "heal_val": c.heal_val,
        "half_def_pierce": c.half_def_pierce, "atk_debuff": c.atk_debuff,
        "draw_count": c.draw_count, "needs_target": c.needs_target,
        "max_copies": c.max_copies, "script": c.script,
        "desc": c.desc, "rules_detail": rules,
        "lore": c.lore, "quote": c.quote,
        "art_action": c.art_action, "art_expression": c.art_expression,
        "art_extra": c.art_extra, "image_url": c.image_url, "art_status": c.art_status,
        "sort": c.sort, "enabled": c.enabled,
    }


def _class_dict(c: CardClass) -> dict:
    try:
        deck = json.loads(c.default_deck or "{}")
    except Exception:
        deck = {}
    return {
        "id": c.id, "code": c.code, "name": c.name, "hero_name": c.hero_name,
        "icon": c.icon, "hp": c.hp, "defense": c.defense, "spd": c.spd, "cri": c.cri,
        "role": c.role, "counters": c.counters, "nemesis": c.nemesis,
        "lore": c.lore, "quote": c.quote,
        "art_style": c.art_style, "outfit_male": c.outfit_male,
        "outfit_female": c.outfit_female, "outfit_other": c.outfit_other,
        "default_deck": deck, "deck_size": sum(int(v) for v in deck.values() if str(v).isdigit()),
        "sort": c.sort, "enabled": c.enabled,
    }


def _emo_dict(e: CardEmotion) -> dict:
    try:
        replies = json.loads(e.reply_codes or "[]")
    except Exception:
        replies = []
    return {
        "id": e.id, "code": e.code, "name": e.name, "tag": e.tag, "emoji": e.emoji,
        "color": e.color, "accent": e.accent,
        "player_line": e.player_line, "ai_line": e.ai_line,
        "reply_codes": replies, "image_url": e.image_url,
        "sort": e.sort, "enabled": e.enabled,
    }


def _dlg_dict(d: CardDialogue) -> dict:
    return {
        "id": d.id, "trigger": d.trigger, "side": d.side,
        "emotion_code": d.emotion_code, "text": d.text, "weight": d.weight,
        "cooldown_rounds": d.cooldown_rounds, "once_per_battle": d.once_per_battle,
        "priority": d.priority, "enabled": d.enabled, "note": d.note, "sort": d.sort,
        "trigger_label": card_dialogue.TRIGGER_LABELS.get(d.trigger, d.trigger),
    }


def _loadout_dict(l: CardLoadout, db: Session) -> dict:
    from ..models.character import Character
    ch = db.query(Character).filter(Character.id == l.character_id).first()
    try:
        deck = json.loads(l.deck or "{}")
    except Exception:
        deck = {}
    cls = db.query(CardClass).filter(CardClass.code == l.class_code).first()
    return {
        "id": l.id, "character_id": l.character_id,
        "character_name": ch.name if ch else f"#{l.character_id}",
        "portrait": ch.portrait_image if ch else "",
        "character_type": ch.character_type if ch else "",
        "gender": ch.gender if ch else "unknown",
        "class_code": l.class_code,
        "class_name": cls.name if cls else l.class_code,
        "deck": deck, "deck_size": sum(int(v) for v in deck.values() if str(v).isdigit()),
        "is_active": l.is_active, "note": l.note,
    }


# ======================================================================
# 目录
# ======================================================================
@router.get("/catalog")
def catalog(db: Session = Depends(get_db)):
    classes = db.query(CardClass).order_by(CardClass.sort).all()
    cards = db.query(CardDef).order_by(CardDef.sort, CardDef.id).all()
    emotions = db.query(CardEmotion).order_by(CardEmotion.sort).all()
    dialogues = db.query(CardDialogue).order_by(CardDialogue.sort, CardDialogue.id).all()
    settings = card_art.get_settings(db)

    # 分类统计：通用 / 各职业
    counts: dict[str, int] = {}
    for c in cards:
        counts[c.class_code] = counts.get(c.class_code, 0) + 1
        counts[f"cat:{c.category}"] = counts.get(f"cat:{c.category}", 0) + 1

    return {
        "classes": [_class_dict(c) for c in classes],
        "cards": [_card_dict(c) for c in cards],
        "emotions": [_emo_dict(e) for e in emotions],
        "dialogues": [_dlg_dict(d) for d in dialogues],
        "triggers": card_dialogue.TRIGGERS,
        "settings": settings,
        "stats": {
            "class_count": len(classes),
            "card_count": len(cards),
            "emotion_count": len(emotions),
            "dialogue_count": len(dialogues),
            "counts": counts,
            "art_done": sum(1 for c in cards if c.image_url),
        },
    }


@router.post("/seed")
def reseed(db: Session = Depends(get_db)):
    """补齐缺失的种子数据（不会覆盖后台改过的内容）。"""
    return card_seed.seed_card_data(db)


# ======================================================================
# 职业
# ======================================================================
@router.get("/classes")
def list_classes(db: Session = Depends(get_db)):
    return [_class_dict(c) for c in db.query(CardClass).order_by(CardClass.sort).all()]


@router.post("/classes", status_code=201)
def create_class(payload: dict, db: Session = Depends(get_db)):
    data = {k: v for k, v in payload.items() if k in CLASS_FIELDS}
    if not data.get("code"):
        raise HTTPException(400, "缺少职业代码")
    if db.query(CardClass).filter(CardClass.code == data["code"]).first():
        raise HTTPException(400, "职业代码已存在")
    if isinstance(data.get("default_deck"), (dict, list)):
        data["default_deck"] = json.dumps(data["default_deck"], ensure_ascii=False)
    obj = CardClass(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _class_dict(obj)


@router.put("/classes/{code}")
def update_class(code: str, payload: dict, db: Session = Depends(get_db)):
    obj = db.query(CardClass).filter(CardClass.code == code).first()
    if not obj:
        raise HTTPException(404, "职业不存在")
    for k, v in payload.items():
        if k in CLASS_FIELDS and k != "code":
            if k == "default_deck" and isinstance(v, (dict, list)):
                v = json.dumps(v, ensure_ascii=False)
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _class_dict(obj)


@router.delete("/classes/{code}", status_code=204)
def delete_class(code: str, db: Session = Depends(get_db)):
    obj = db.query(CardClass).filter(CardClass.code == code).first()
    if not obj:
        raise HTTPException(404, "职业不存在")
    if db.query(CardDef).filter(CardDef.class_code == code).count():
        raise HTTPException(400, "该职业下还有卡牌，请先删除或转移卡牌")
    db.delete(obj)
    db.commit()


# ======================================================================
# 卡牌
# ======================================================================
@router.get("/cards")
def list_cards(class_code: Optional[str] = None, category: Optional[str] = None,
               q: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(CardDef)
    if class_code and class_code != "all":
        query = query.filter(CardDef.class_code == class_code)
    if category and category != "all":
        query = query.filter(CardDef.category == category)
    if q:
        query = query.filter(CardDef.name.like(f"%{q}%"))
    return [_card_dict(c) for c in query.order_by(CardDef.sort, CardDef.id).all()]


@router.get("/cards/{code}")
def get_card(code: str, db: Session = Depends(get_db)):
    c = db.query(CardDef).filter(CardDef.code == code).first()
    if not c:
        raise HTTPException(404, "卡牌不存在")
    return _card_dict(c)


@router.post("/cards", status_code=201)
def create_card(payload: dict, db: Session = Depends(get_db)):
    data = {k: v for k, v in payload.items() if k in CARD_FIELDS}
    if not data.get("code") or not data.get("name"):
        raise HTTPException(400, "缺少卡牌代码或名称")
    if db.query(CardDef).filter(CardDef.code == data["code"]).first():
        raise HTTPException(400, "卡牌代码已存在")
    if isinstance(data.get("rules_detail"), (list, dict)):
        data["rules_detail"] = json.dumps(data["rules_detail"], ensure_ascii=False)
    data.setdefault("sort", 999)
    obj = CardDef(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _card_dict(obj)


@router.put("/cards/{code}")
def update_card(code: str, payload: dict, db: Session = Depends(get_db)):
    obj = db.query(CardDef).filter(CardDef.code == code).first()
    if not obj:
        raise HTTPException(404, "卡牌不存在")
    for k, v in payload.items():
        if k in CARD_FIELDS and k != "code":
            if k == "rules_detail" and isinstance(v, (list, dict)):
                v = json.dumps(v, ensure_ascii=False)
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _card_dict(obj)


@router.delete("/cards/{code}", status_code=204)
def delete_card(code: str, db: Session = Depends(get_db)):
    obj = db.query(CardDef).filter(CardDef.code == code).first()
    if not obj:
        raise HTTPException(404, "卡牌不存在")
    db.query(CardArt).filter(CardArt.card_code == code).delete(synchronize_session=False)
    db.delete(obj)
    db.commit()


# ======================================================================
# 情感 / 对话规则
# ======================================================================
@router.get("/emotions")
def list_emotions(db: Session = Depends(get_db)):
    return [_emo_dict(e) for e in db.query(CardEmotion).order_by(CardEmotion.sort).all()]


@router.post("/emotions", status_code=201)
def create_emotion(payload: dict, db: Session = Depends(get_db)):
    data = {k: v for k, v in payload.items() if k in EMOTION_FIELDS}
    if not data.get("code"):
        raise HTTPException(400, "缺少情感代码")
    if db.query(CardEmotion).filter(CardEmotion.code == data["code"]).first():
        raise HTTPException(400, "情感代码已存在")
    if isinstance(data.get("reply_codes"), list):
        data["reply_codes"] = json.dumps(data["reply_codes"], ensure_ascii=False)
    obj = CardEmotion(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _emo_dict(obj)


@router.put("/emotions/{code}")
def update_emotion(code: str, payload: dict, db: Session = Depends(get_db)):
    obj = db.query(CardEmotion).filter(CardEmotion.code == code).first()
    if not obj:
        raise HTTPException(404, "情感不存在")
    for k, v in payload.items():
        if k in EMOTION_FIELDS and k != "code":
            if k == "reply_codes" and isinstance(v, list):
                v = json.dumps(v, ensure_ascii=False)
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _emo_dict(obj)


@router.delete("/emotions/{code}", status_code=204)
def delete_emotion(code: str, db: Session = Depends(get_db)):
    obj = db.query(CardEmotion).filter(CardEmotion.code == code).first()
    if not obj:
        raise HTTPException(404, "情感不存在")
    db.delete(obj)
    db.commit()


@router.get("/dialogues")
def list_dialogues(trigger: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(CardDialogue)
    if trigger:
        q = q.filter(CardDialogue.trigger == trigger)
    return [_dlg_dict(d) for d in q.order_by(CardDialogue.sort, CardDialogue.id).all()]


@router.post("/dialogues", status_code=201)
def create_dialogue(payload: dict, db: Session = Depends(get_db)):
    data = {k: v for k, v in payload.items() if k in DIALOGUE_FIELDS}
    if not data.get("trigger"):
        raise HTTPException(400, "缺少触发点")
    data.setdefault("sort", 999)
    obj = CardDialogue(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _dlg_dict(obj)


@router.put("/dialogues/{did}")
def update_dialogue(did: int, payload: dict, db: Session = Depends(get_db)):
    obj = db.query(CardDialogue).filter(CardDialogue.id == did).first()
    if not obj:
        raise HTTPException(404, "规则不存在")
    for k, v in payload.items():
        if k in DIALOGUE_FIELDS:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _dlg_dict(obj)


@router.delete("/dialogues/{did}", status_code=204)
def delete_dialogue(did: int, db: Session = Depends(get_db)):
    obj = db.query(CardDialogue).filter(CardDialogue.id == did).first()
    if not obj:
        raise HTTPException(404, "规则不存在")
    db.delete(obj)
    db.commit()


@router.get("/triggers")
def list_triggers():
    return card_dialogue.TRIGGERS


# ======================================================================
# 角色卡组
# ======================================================================
@router.get("/loadouts")
def list_loadouts(db: Session = Depends(get_db)):
    rows = db.query(CardLoadout).order_by(CardLoadout.id).all()
    return [_loadout_dict(l, db) for l in rows]


@router.get("/characters")
def list_characters_for_cards(db: Session = Depends(get_db)):
    """角色管理里的人物 + 当前卡组，后台选人配卡用。"""
    from ..models.character import Character
    chars = db.query(Character).order_by(Character.id).all()
    loads = {l.character_id: l for l in db.query(CardLoadout).all()}
    out = []
    for ch in chars:
        l = loads.get(ch.id)
        out.append({
            "id": ch.id, "name": ch.name, "character_type": ch.character_type,
            "gender": ch.gender, "level": ch.level, "portrait": ch.portrait_image,
            "class_code": l.class_code if l else "",
            "deck": json.loads(l.deck) if l and l.deck else {},
            "deck_size": (sum(int(v) for v in json.loads(l.deck).values() if str(v).isdigit())
                          if l and l.deck else 0),
            "has_loadout": bool(l),
            "note": l.note if l else "",
        })
    return out


# ----------------------------------------------------------------------
# 卡牌角色（卡面专用覆盖：画风 / 衣着 / 用哪套外观 / 前后缀 / 完整外观）
# ----------------------------------------------------------------------
CARD_PROFILE_FIELDS = ("appearance_id", "appearance_json", "style_override",
                       "outfit_male", "outfit_female", "outfit_other",
                       "prefix_prompt", "suffix_prompt", "note", "enabled")


def _profile_dict(p) -> dict:
    if p is None:
        return {"character_id": 0, "appearance_id": 0, "appearance_json": "",
                "style_override": "", "outfit_male": "", "outfit_female": "",
                "outfit_other": "", "prefix_prompt": "", "suffix_prompt": "",
                "note": "", "enabled": 1, "customized": False}
    out = {k: (getattr(p, k, "") if k != "appearance_id" else int(p.appearance_id or 0))
           for k in CARD_PROFILE_FIELDS}
    out["character_id"] = p.character_id
    out["updated_at"] = p.updated_at
    out["customized"] = any(str(p.__dict__.get(k) or "").strip() for k in
                            ("appearance_id", "appearance_json", "style_override",
                             "outfit_male", "outfit_female", "outfit_other",
                             "prefix_prompt", "suffix_prompt"))
    out["has_appearance"] = bool((getattr(p, "appearance_json", "") or "").strip())
    return out


@router.get("/characters/{cid}/profile")
def get_card_character_profile(cid: int, db: Session = Depends(get_db)):
    from ..models.character import Character
    ch = db.query(Character).filter(Character.id == cid).first()
    if not ch:
        raise HTTPException(404, "人物不存在")
    p = card_art.get_card_profile(db, cid)
    return {"character": {"id": ch.id, "name": ch.name, "gender": ch.gender},
            "profile": _profile_dict(p)}


@router.put("/characters/{cid}/profile")
def save_card_character_profile(cid: int, payload: dict, db: Session = Depends(get_db)):
    from ..models.character import Character
    from ..models.cardgame import CardCharacterProfile
    ch = db.query(Character).filter(Character.id == cid).first()
    if not ch:
        raise HTTPException(404, "人物不存在")
    p = card_art.get_card_profile(db, cid)
    if p is None:
        p = CardCharacterProfile(character_id=cid)
        db.add(p)
    for k in CARD_PROFILE_FIELDS:
        if k in payload and payload[k] is not None:
            if k in ("appearance_id", "enabled"):
                setattr(p, k, int(payload[k] or 0))
            else:
                setattr(p, k, str(payload[k]))
    p.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.commit()
    db.refresh(p)
    return {"ok": True, "profile": _profile_dict(p)}


@router.delete("/characters/{cid}/profile", status_code=200)
def reset_card_character_profile(cid: int, db: Session = Depends(get_db)):
    """整条清空：回到「只用职业 + 外观配置」的默认拼装。"""
    from ..models.cardgame import CardCharacterProfile
    p = card_art.get_card_profile(db, cid)
    if p is not None:
        db.delete(p)
        db.commit()
    return {"ok": True}


@router.get("/characters/{cid}/card-preview")
def preview_card_character(cid: int, card_code: str = Query(...),
                           class_code: str = "", db: Session = Depends(get_db)):
    """「卡牌角色」页的实时预览：用这个人 + 这张卡拼一遍卡面提示词。

    只读库里的配置（先保存再预览），因为要验证的正是「存下来的东西对不对」。
    """
    from ..models.character import Character
    ch = db.query(Character).filter(Character.id == cid).first()
    if not ch:
        raise HTTPException(404, "人物不存在")
    card = db.query(CardDef).filter(CardDef.code == card_code).first()
    if not card:
        raise HTTPException(404, "卡牌不存在")
    cls = None
    if class_code:
        cls = db.query(CardClass).filter(CardClass.code == class_code).first()
    elif card.class_code != "universal":
        cls = db.query(CardClass).filter(CardClass.code == card.class_code).first()
    return card_art.compose(db, card, cls, "", ch)


@router.post("/loadouts")
def upsert_loadout(payload: dict, db: Session = Depends(get_db)):
    cid = payload.get("character_id")
    class_code = payload.get("class_code") or "warrior"
    deck = payload.get("deck")
    if deck is None:
        deck = card_seed.default_deck_for(db, class_code)
    if isinstance(deck, str):
        try:
            deck = json.loads(deck)
        except Exception:
            raise HTTPException(400, "卡组格式错误")
    # 校验卡牌存在 + 同名上限
    total = 0
    for code, cnt in deck.items():
        card = db.query(CardDef).filter(CardDef.code == code).first()
        if not card:
            raise HTTPException(400, f"卡牌不存在：{code}")
        try:
            cnt = int(cnt)
        except Exception:
            raise HTTPException(400, f"张数不合法：{code}")
        if cnt < 0:
            raise HTTPException(400, f"张数不能为负：{code}")
        if card.max_copies and cnt > card.max_copies:
            raise HTTPException(400, f"「{card.name}」最多 {card.max_copies} 张：{code}")
        total += cnt
    if total <= 0:
        raise HTTPException(400, "卡组不能为空")

    obj = db.query(CardLoadout).filter(CardLoadout.character_id == int(cid)).first()
    if obj:
        obj.class_code = class_code
        obj.deck = json.dumps({k: int(v) for k, v in deck.items()}, ensure_ascii=False)
        obj.note = payload.get("note", obj.note)
        obj.is_active = int(payload.get("is_active", 1))
    else:
        obj = CardLoadout(
            character_id=int(cid), class_code=class_code,
            deck=json.dumps({k: int(v) for k, v in deck.items()}, ensure_ascii=False),
            note=payload.get("note", ""), is_active=int(payload.get("is_active", 1)),
        )
        db.add(obj)
    db.commit()
    db.refresh(obj)
    return {"ok": True, "loadout": _loadout_dict(obj, db), "deck_size": total}


@router.delete("/loadouts/{lid}", status_code=204)
def delete_loadout(lid: int, db: Session = Depends(get_db)):
    obj = db.query(CardLoadout).filter(CardLoadout.id == lid).first()
    if not obj:
        raise HTTPException(404, "卡组不存在")
    db.delete(obj)
    db.commit()


@router.post("/loadouts/auto")
def auto_loadouts(db: Session = Depends(get_db)):
    """给还没有卡组的人物按类型/性别自动配一套（省得一个个点）。"""
    from ..models.character import Character
    classes = db.query(CardClass).order_by(CardClass.sort).all()
    if not classes:
        raise HTTPException(400, "请先播种职业数据")
    by_code = {c.code: c for c in classes}
    prefer = {
        "player": ["assassin", "ranger", "warrior"],
        "enemy": ["mesmer", "warrior", "mage"],
        "npc": ["mesmer", "paladin", "mage"],
        "ally": ["warrior", "paladin", "ranger"],
    }
    created = 0
    for ch in db.query(Character).all():
        if db.query(CardLoadout).filter(CardLoadout.character_id == ch.id).first():
            continue
        pool = prefer.get(ch.character_type or "npc", ["warrior"])
        code = next((c for c in pool if c in by_code), classes[0].code)
        cls = by_code[code]
        db.add(CardLoadout(character_id=ch.id, class_code=code,
                           deck=cls.default_deck or "{}",
                           note=f"自动分配：{cls.name}"))
        created += 1
    db.commit()
    return {"ok": True, "created": created}


# ======================================================================
# 设置
# ======================================================================
@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return card_art.get_settings(db)


@router.put("/settings")
def put_settings(payload: dict, db: Session = Depends(get_db)):
    return card_art.set_settings(db, payload)


# ======================================================================
# 对局
# ======================================================================
def _load_refs(db: Session):
    cards = {c.code: _card_dict(c) for c in db.query(CardDef).filter(CardDef.enabled == 1).all()}
    rules = [_dlg_dict(d) for d in db.query(CardDialogue).order_by(CardDialogue.priority.desc()).all()]
    emotions = {e.code: _emo_dict(e) for e in db.query(CardEmotion).all()}
    classes = {c.code: _class_dict(c) for c in db.query(CardClass).all()}
    return cards, rules, emotions, classes


def _deck_of(db: Session, character_id: int | None, class_code: str) -> dict:
    if character_id:
        l = db.query(CardLoadout).filter(
            CardLoadout.character_id == int(character_id),
            CardLoadout.is_active == 1,
        ).order_by(CardLoadout.id.desc()).first()
        if l and l.deck:
            try:
                deck = json.loads(l.deck)
                if deck:
                    return deck
            except Exception:
                pass
    return card_seed.default_deck_for(db, class_code)


def _pick_enemy_from_node(db: Session, node: StoryNode | None) -> int | None:
    if not node or not node.battle_config:
        return None
    try:
        cfg = json.loads(node.battle_config)
    except Exception:
        return None
    enemies = cfg.get("enemies") or []
    for e in enemies:
        cid = e.get("character_id") if isinstance(e, dict) else None
        if cid:
            return int(cid)
    if cfg.get("card_enemy_character_id"):
        return int(cfg["card_enemy_character_id"])
    return None


# ==================== 角色情感表现（每个角色一套情绪演出） ====================
@router.get("/emotion-profiles")
def emotion_profiles(character_id: int = Query(...), db: Session = Depends(get_db)):
    """某角色的全部情感表现（20 种情感 × 是否已个性化）。"""
    emotions = (db.query(CardEmotion)
                .order_by(CardEmotion.sort, CardEmotion.id).all())
    rows = (db.query(CardCharacterEmotion)
            .filter(CardCharacterEmotion.character_id == int(character_id)).all())
    by_code = {r.emotion_code: r for r in rows}
    from ..models.cardgame import CardCharacterProfile
    prof = db.query(CardCharacterProfile).filter(
        CardCharacterProfile.character_id == int(character_id)).first()
    voice = {
        "engine": (prof.tts_engine if prof else "") or "",
        "voice_id": (prof.tts_voice_id if prof else "") or "",
        "rate": (prof.tts_rate if prof else "") or "",
        "pitch": (prof.tts_pitch if prof else "") or "",
        "volume": (prof.tts_volume if prof else "") or "",
    }
    out = []
    for e in emotions:
        r = by_code.get(e.code)
        out.append({
            "emotion_code": e.code, "name": e.name, "tag": e.tag,
            "emoji": e.emoji, "color": e.color,
            "default_line": e.player_line or "",
            "ai_line": e.ai_line or "",
            "id": r.id if r else None,
            "image_url": (r.image_url if r else "") or "",
            "line": (r.line if r else "") or "",
            "action_prompt": (r.action_prompt if r else "") or "",
            "expression_prompt": (r.expression_prompt if r else "") or "",
            "prefix_prompt": (r.prefix_prompt if r else "") or "",
            "suffix_prompt": (r.suffix_prompt if r else "") or "",
            "prompt_text": (r.prompt_text if r else "") or "",
            "appearance_id": (r.appearance_id if r else 0) or 0,
            "note": (r.note if r else "") or "",
            "enabled": (r.enabled if r else 1),
            "job_id": (r.job_id if r else "") or "",
            "voice_url": (r.voice_url if r else "") or "",
            "customized": bool(r and (r.image_url or (r.line or "").strip())),
        })
    return {"character_id": int(character_id), "items": out,
            "total": len(out),
            "customized": sum(1 for i in out if i["customized"]),
            "voice": voice}


@router.put("/emotion-profiles")
def emotion_profile_upsert(payload: dict, db: Session = Depends(get_db)):
    """新增/更新一条角色情感表现。按 (角色, 情感) 唯一。"""
    ch_id = payload.get("character_id")
    code = payload.get("emotion_code")
    if not ch_id or not code:
        raise HTTPException(400, "缺少 character_id 或 emotion_code")
    row = db.query(CardCharacterEmotion).filter(
        CardCharacterEmotion.character_id == int(ch_id),
        CardCharacterEmotion.emotion_code == code).first()
    if not row:
        row = CardCharacterEmotion(character_id=int(ch_id), emotion_code=code)
        db.add(row)
    for k in ("image_url", "line", "action_prompt", "expression_prompt",
              "prefix_prompt", "suffix_prompt", "prompt_text", "note",
              "voice_url"):
        if k in payload and payload[k] is not None:
            setattr(row, k, payload[k])
    if payload.get("appearance_id") is not None:
        row.appearance_id = int(payload.get("appearance_id") or 0)
    if "enabled" in payload and payload["enabled"] is not None:
        row.enabled = 1 if payload["enabled"] else 0
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": row.id, "image_url": row.image_url,
            "line": row.line, "enabled": row.enabled}


@router.put("/character-voice")
def character_voice_upsert(payload: dict, db: Session = Depends(get_db)):
    """卡牌角色音色绑定：情感与表现页选的音色存在卡牌角色档案上，
    覆盖「声音管理 > 角色语音配置」的人物默认配置；批量生成语音时优先用它。"""
    ch_id = payload.get("character_id")
    if not ch_id:
        raise HTTPException(400, "缺少 character_id")
    from ..models.cardgame import CardCharacterProfile
    prof = db.query(CardCharacterProfile).filter(
        CardCharacterProfile.character_id == int(ch_id)).first()
    if not prof:
        prof = CardCharacterProfile(character_id=int(ch_id))
        db.add(prof)
    for k in ("tts_engine", "tts_voice_id", "tts_rate", "tts_pitch", "tts_volume"):
        if k in payload and payload[k] is not None:
            setattr(prof, k, str(payload[k] or ""))
    db.commit()
    db.refresh(prof)
    return {"ok": True, "character_id": int(ch_id),
            "engine": prof.tts_engine or "",
            "voice_id": prof.tts_voice_id or "",
            "rate": prof.tts_rate or "",
            "pitch": prof.tts_pitch or "",
            "volume": prof.tts_volume or ""}


@router.delete("/emotion-profiles/{pid}", status_code=204)
def emotion_profile_delete(pid: int, db: Session = Depends(get_db)):
    row = db.query(CardCharacterEmotion).filter(CardCharacterEmotion.id == pid).first()
    if not row:
        raise HTTPException(404, "记录不存在")
    db.delete(row)
    db.commit()


@router.get("/emotion-profiles/preview")
def emotion_profile_preview(character_id: int = Query(...),
                            emotion_code: str = Query(...),
                            db: Session = Depends(get_db)):
    """只拼提示词，不出图。方便先看措辞再决定要不要排队。"""
    from ..models.character import Character
    ch = db.query(Character).filter(Character.id == int(character_id)).first()
    if not ch:
        raise HTTPException(404, "角色不存在")
    emo = db.query(CardEmotion).filter(CardEmotion.code == emotion_code).first()
    if not emo:
        raise HTTPException(404, "情感不存在")
    ce = db.query(CardCharacterEmotion).filter(
        CardCharacterEmotion.character_id == int(character_id),
        CardCharacterEmotion.emotion_code == emotion_code).first()
    return card_art.compose_emotion(db, ch, emo, ce)


@router.post("/emotion-profiles/preview")
def emotion_profile_preview_live(payload: dict, db: Session = Depends(get_db)):
    """实时预览：用「表单里还没保存的值」拼一遍提示词。

    编辑页每改一个字都要看到最终提示词，所以不能是 GET 读库 ——
    这里把 payload 里的前置/后置/动作/神情/外观配置套到一个临时对象上再拼。
    """
    from types import SimpleNamespace
    from ..models.character import Character

    ch_id = payload.get("character_id")
    code = payload.get("emotion_code")
    if not ch_id or not code:
        raise HTTPException(400, "缺少 character_id 或 emotion_code")
    ch = db.query(Character).filter(Character.id == int(ch_id)).first()
    if not ch:
        raise HTTPException(404, "角色不存在")
    emo = db.query(CardEmotion).filter(CardEmotion.code == code).first()
    if not emo:
        raise HTTPException(404, "情感不存在")

    # 先取库里的那行做底，再用表单值覆盖
    row = db.query(CardCharacterEmotion).filter(
        CardCharacterEmotion.character_id == int(ch_id),
        CardCharacterEmotion.emotion_code == code).first()
    base = {
        "action_prompt": getattr(row, "action_prompt", "") or "",
        "expression_prompt": getattr(row, "expression_prompt", "") or "",
        "prefix_prompt": getattr(row, "prefix_prompt", "") or "",
        "suffix_prompt": getattr(row, "suffix_prompt", "") or "",
        "prompt_text": getattr(row, "prompt_text", "") or "",
        "appearance_id": getattr(row, "appearance_id", 0) or 0,
    }
    for k in list(base.keys()):
        if k in payload and payload[k] is not None:
            base[k] = payload[k]
    ce = SimpleNamespace(**base)
    return card_art.compose_emotion(db, ch, emo, ce)


@router.post("/emotion-profiles/generate", status_code=201)
def emotion_profile_generate(payload: dict, db: Session = Depends(get_db)):
    ch_id = payload.get("character_id")
    code = payload.get("emotion_code")
    if not ch_id or not code:
        raise HTTPException(400, "缺少 character_id 或 emotion_code")
    try:
        return card_art.start_generate_emotion(
            db, int(ch_id), code,
            action_prompt=payload.get("action_prompt") or "",
            expression_prompt=payload.get("expression_prompt") or "",
            prefix_prompt=payload.get("prefix_prompt"),
            suffix_prompt=payload.get("suffix_prompt"),
            appearance_id=payload.get("appearance_id"),
            prompt_text=payload.get("prompt_text"))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/battle/start", status_code=201)
def battle_start(payload: dict, db: Session = Depends(get_db)):
    from ..models.character import Character

    node = None
    node_id = payload.get("story_node_id")
    if node_id:
        node = db.query(StoryNode).filter(StoryNode.id == int(node_id)).first()

    cfg = {}
    if node and node.battle_config:
        try:
            cfg = json.loads(node.battle_config) or {}
        except Exception:
            cfg = {}

    # ---- 玩家角色：显式 → user_character → 第一个 player 类型人物 ----
    player_char = None
    if payload.get("player_character_id"):
        player_char = db.query(Character).filter(
            Character.id == int(payload["player_character_id"])).first()
    if not player_char and payload.get("user_character_id"):
        from ..models.user import UserCharacter
        uc = db.query(UserCharacter).filter(
            UserCharacter.id == int(payload["user_character_id"])).first()
        if uc and getattr(uc, "character_id", None):
            player_char = db.query(Character).filter(Character.id == uc.character_id).first()
    if not player_char:
        player_char = db.query(Character).filter(Character.character_type == "player").order_by(Character.id).first()
    if not player_char:
        player_char = db.query(Character).order_by(Character.id).first()
    if not player_char:
        raise HTTPException(400, "人物库里还没有角色，请先在「人物管理」新建")

    # ---- 敌方角色 ----
    enemy_char = None
    eid = payload.get("enemy_character_id") or _pick_enemy_from_node(db, node) or cfg.get("card_enemy_character_id")
    if eid:
        enemy_char = db.query(Character).filter(Character.id == int(eid)).first()
    if not enemy_char:
        enemy_char = db.query(Character).filter(
            Character.id != player_char.id,
            Character.character_type.in_(("npc", "enemy", "ally")),
        ).order_by(Character.id).first()
    if not enemy_char:
        raise HTTPException(400, "找不到可对战的敌方角色")

    # ---- 职业 ----
    settings = card_art.get_settings(db)
    p_load = db.query(CardLoadout).filter(CardLoadout.character_id == player_char.id).first()
    e_load = db.query(CardLoadout).filter(CardLoadout.character_id == enemy_char.id).first()
    p_class = (payload.get("player_class") or (p_load.class_code if p_load else "")
               or cfg.get("card_player_class") or settings.get("battle_demo_class") or "warrior")
    e_class = (payload.get("enemy_class") or (e_load.class_code if e_load else "")
               or cfg.get("card_enemy_class") or settings.get("battle_demo_enemy_class") or "mesmer")

    cards, rules, emotions, classes = _load_refs(db)
    p_cls = classes.get(p_class)
    e_cls = classes.get(e_class)
    if not p_cls or not e_cls:
        raise HTTPException(400, f"职业不存在：{p_class} / {e_class}")

    p_deck = payload.get("player_deck") or _deck_of(db, player_char.id, p_class)
    e_deck = payload.get("enemy_deck") or _deck_of(db, enemy_char.id, e_class)
    if not p_deck:
        raise HTTPException(400, "玩家卡组为空")
    if not e_deck:
        raise HTTPException(400, "敌方卡组为空")

    engine = Engine.create(
        player_meta={"name": player_char.name, "portrait": player_char.portrait_image or "",
                     "character_id": player_char.id},
        player_class=p_cls, player_deck=p_deck,
        enemy_meta={"name": enemy_char.name, "portrait": enemy_char.portrait_image or "",
                    "character_id": enemy_char.id},
        enemy_class=e_cls, enemy_deck=e_deck,
        cards=cards, rules=rules, emotions=emotions,
    )
    events = engine.start()
    _public_start = engine.public_state()
    events = _decorate_emotions(db, _public_start, events)

    row = CardBattle(
        story_node_id=int(node_id) if node_id else None,
        user_character_id=int(payload["user_character_id"]) if payload.get("user_character_id") else None,
        player_character_id=player_char.id,
        enemy_character_id=enemy_char.id,
        status="active",
        round=engine.state["round"],
        state=engine.to_json(),
        log=json.dumps(engine.state.get("log", [])[-100:], ensure_ascii=False),
        source=payload.get("source") or ("story" if node_id else "demo"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {
        "battle_id": row.id,
        "state": engine.public_state(),
        "events": events,
        # 战斗节点的「赢 / 输 / 逃」分别去哪个剧情节点，就在这里带出去。
        # 以前只认旧战斗系统的 state.config，卡牌战斗接管后这三条分支被丢掉了，
        # 结果三种结局都会走同一个"下一节点"——玩家当然分不出来。
        "outcome_nodes": {
            "victory": cfg.get("victory_node_id"),
            "defeat": cfg.get("defeat_node_id"),
            "flee": cfg.get("flee_node_id"),
        },
        "battle_config": cfg,
        "player": {"character_id": player_char.id, "name": player_char.name,
                   "class_code": p_class, "class_name": p_cls["name"],
                   "deck_size": sum(int(v) for v in p_deck.values() if str(v).isdigit())},
        "enemy": {"character_id": enemy_char.id, "name": enemy_char.name,
                  "class_code": e_class, "class_name": e_cls["name"],
                  "deck_size": sum(int(v) for v in e_deck.values() if str(v).isdigit())},
        "story_node_id": int(node_id) if node_id else None,
    }


def _get_battle(db: Session, bid: int) -> tuple[CardBattle, Engine]:
    row = db.query(CardBattle).filter(CardBattle.id == bid).first()
    if not row:
        raise HTTPException(404, "对局不存在")
    cards, rules, emotions, _ = _load_refs(db)
    eng = Engine.from_json(row.state, cards=cards, rules=rules, emotions=emotions)
    return row, eng


def _line_is_dirty(text: str) -> bool:
    """台词里混进了「整段出图提示词」——后台「情感与表现」里误存的情况很常见。

    判断口径和后台预览完全一致（frontend/admin/js/modules/cardgame.js 的 epLineIsDirty）：
    含【】或者长度夸张。这种句子铺到全屏对话框里会直接撑爆版面，
    前台必须和后台预览一样退回到通用台词，否则「预览」和「游戏里」永远是两副样子。
    """
    s = (text or "").strip()
    return bool(s) and ("【" in s or len(s) > 120)


def _decorate_emotions(db: Session, state: dict, events: list) -> list:
    """给 emotion 事件补上「这个角色自己」的图片和台词。

    通用情感表只给一句话，所有角色说出来都一样；但玩家认的是「黄蓉的嗤笑」
    和「牛头人的暴怒」不是同一张脸。这里按 (角色, 情感) 查个性化覆盖，
    有就用它，没有就保留通用台词 —— 不必把 20 种情感 × N 个角色全填满。
    """
    if not events:
        return events
    players = {p.get("side"): p for p in (state or {}).get("players", []) or []}
    cache: dict = {}
    for ev in events:
        if ev.get("type") != "emotion":
            continue
        side = ev.get("side")
        ch_id = (players.get(side) or {}).get("character_id")
        if not ch_id:
            continue
        key = (int(ch_id), ev.get("code"))
        if key not in cache:
            cache[key] = db.query(CardCharacterEmotion).filter(
                CardCharacterEmotion.character_id == key[0],
                CardCharacterEmotion.emotion_code == key[1],
                CardCharacterEmotion.enabled == 1,
            ).first()
        row = cache[key]
        if row:
            if row.image_url:
                ev["image_url"] = row.image_url
            # 后台「情感与表现」里给这条情感生成/上传过语音，就把 URL 一起带给前台。
            # 以前只带了图和台词，前台永远走 TTS 现场合成 —— 于是不管后台配了多少套
            # 声音，战斗里听起来都是同一个默认音色（玩家说的「老旧喇叭音」）。
            if (getattr(row, "voice_url", "") or "").strip():
                ev["voice_url"] = row.voice_url.strip()
            if (row.line or "").strip():
                generic = ev.get("line") or ""
                custom = row.line.strip()
                # 通用台词永远带着，前端遇到脏台词可以退回它
                ev["default_line"] = generic
                if _line_is_dirty(custom):
                    ev["line"] = generic or "……"
                    ev["line_dirty"] = True
                else:
                    ev["line"] = custom
            ev["customized"] = True
    return events


def _save(db: Session, row: CardBattle, eng: Engine, events: list) -> dict:
    row.state = eng.to_json()
    row.round = int(eng.state.get("round") or 1)
    row.log = json.dumps(eng.state.get("log", [])[-120:], ensure_ascii=False)
    if eng.state.get("phase") == "over":
        w = eng.state.get("winner")
        row.status = "player_won" if w == 0 else "enemy_won"
        from datetime import datetime
        row.ended_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.commit()
    public = eng.public_state()
    return {
        "battle_id": row.id,
        "status": row.status,
        "state": public,
        "events": _decorate_emotions(db, public, events),
        "over": eng.state.get("phase") == "over",
        "winner": eng.state.get("winner"),
    }


@router.get("/battle/{bid}")
def battle_get(bid: int, db: Session = Depends(get_db)):
    row, eng = _get_battle(db, bid)
    return {"battle_id": row.id, "status": row.status, "state": eng.public_state(),
            "log": json.loads(row.log or "[]"), "over": eng.state.get("phase") == "over",
            "winner": eng.state.get("winner")}


@router.post("/battle/{bid}/play")
def battle_play(bid: int, payload: dict, db: Session = Depends(get_db)):
    row, eng = _get_battle(db, bid)
    if row.status != "active":
        raise HTTPException(400, "对局已结束")
    uid = payload.get("card_uid") or payload.get("uid")
    if not uid:
        raise HTTPException(400, "缺少 card_uid")
    events = eng.play_card(0, uid, payload.get("target_guard_uid"))
    return _save(db, row, eng, events)


@router.post("/battle/{bid}/end-turn")
def battle_end_turn(bid: int, db: Session = Depends(get_db)):
    row, eng = _get_battle(db, bid)
    if row.status != "active":
        raise HTTPException(400, "对局已结束")
    events = eng.end_turn()
    return _save(db, row, eng, events)


@router.post("/battle/{bid}/ai-step")
def battle_ai_step(bid: int, db: Session = Depends(get_db)):
    row, eng = _get_battle(db, bid)
    if row.status != "active":
        return {"battle_id": row.id, "status": row.status, "state": eng.public_state(),
                "events": [{"type": "ai_done", "side": 1}], "over": True,
                "winner": eng.state.get("winner")}
    events = eng.ai_step()
    return _save(db, row, eng, events)


@router.post("/battle/{bid}/emote")
def battle_emote(bid: int, payload: dict, db: Session = Depends(get_db)):
    row, eng = _get_battle(db, bid)
    code = payload.get("code") or payload.get("emotion_code")
    if not code:
        raise HTTPException(400, "缺少情感代码")
    events = eng.emote(0, code)
    return _save(db, row, eng, events)


@router.post("/battle/{bid}/surrender")
def battle_surrender(bid: int, db: Session = Depends(get_db)):
    row, eng = _get_battle(db, bid)
    if row.status != "active":
        return {"ok": True, "status": row.status}
    eng.state["phase"] = "over"
    eng.state["winner"] = 1
    row.status = "fled"
    from datetime import datetime
    row.ended_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    events = [{"type": "log", "text": "你选择了脱离战斗", "kind": "warn", "round": row.round},
              {"type": "game_over", "winner": 1, "winner_name": eng.p[1]["name"], "fled": True}]
    return _save(db, row, eng, events)


# ======================================================================
# 卡面生图
# ======================================================================
@router.get("/art/preview")
def art_preview(card_code: str, class_code: str = "", gender: str = "female",
                character_id: Optional[int] = None, db: Session = Depends(get_db)):
    card = db.query(CardDef).filter(CardDef.code == card_code).first()
    if not card:
        raise HTTPException(404, "卡牌不存在")
    cls = None
    if class_code:
        cls = db.query(CardClass).filter(CardClass.code == class_code).first()
    elif card.class_code != "universal":
        cls = db.query(CardClass).filter(CardClass.code == card.class_code).first()
    character = None
    if character_id:
        from ..models.character import Character
        character = db.query(Character).filter(Character.id == int(character_id)).first()
    composed = card_art.compose(db, card, cls, gender, character)
    return composed


@router.post("/art/preview-live")
def art_preview_live(payload: dict, db: Session = Depends(get_db)):
    """实时预览：用表单里还没保存的值拼一遍卡面提示词。

    和 /art/preview 的区别：那个只读库，这个接受覆盖值。
    这样「卡牌外观拼装」页改一个下拉 / 随机一次，右边提示词立刻跟着变。
    """
    from types import SimpleNamespace
    from ..models.character import Character

    code = payload.get("card_code")
    if not code:
        raise HTTPException(400, "缺少 card_code")
    card = db.query(CardDef).filter(CardDef.code == code).first()
    if not card:
        raise HTTPException(404, "卡牌不存在")

    def pick(key, fallback):
        v = payload.get(key)
        return fallback if v is None else str(v)

    card_view = SimpleNamespace(
        name=card.name, desc=card.desc,
        art_action=pick("art_action", card.art_action or ""),
        art_expression=pick("art_expression", card.art_expression or ""),
        art_extra=pick("art_extra", card.art_extra or ""),
    )

    cls_code = payload.get("class_code")
    if cls_code is None:
        cls_code = card.class_code if card.class_code != "universal" else ""
    cls = db.query(CardClass).filter(CardClass.code == cls_code).first() if cls_code else None
    cls_view = None
    if cls is not None:
        cls_view = SimpleNamespace(
            code=cls.code, name=cls.name,
            hero_name=pick("hero_name", cls.hero_name or ""),
            art_style=pick("art_style", cls.art_style or ""),
            outfit_male=pick("outfit_male", cls.outfit_male or ""),
            outfit_female=pick("outfit_female", cls.outfit_female or ""),
            outfit_other=pick("outfit_other", cls.outfit_other or ""),
        )

    settings = card_art.get_settings(db)
    if payload.get("art_template") is not None:
        settings["art_template"] = str(payload["art_template"])
    if payload.get("art_negative") is not None:
        settings["art_negative"] = str(payload["art_negative"])

    character = None
    if payload.get("character_id"):
        character = db.query(Character).filter(
            Character.id == int(payload["character_id"])).first()

    # 新「自由外观拼装」：编辑器里的实时外观 + 卡面参数面板的实时覆盖值
    appearance_override = payload.get("appearance")
    if appearance_override is not None and not isinstance(appearance_override, dict):
        appearance_override = None
    outfit_override = {
        k: payload.get(k)
        for k in ("outfit_male", "outfit_female", "outfit_other")
        if payload.get(k) is not None
    } or None
    return card_art.compose(db, card_view, cls_view,
                            payload.get("gender") or "female",
                            character, settings=settings,
                            appearance_override=appearance_override,
                            style_override=payload.get("style_override") or "",
                            outfit_override=outfit_override,
                            prefix_override=payload.get("prefix_prompt") or "",
                            suffix_override=payload.get("suffix_prompt") or "",
                            # 题材 × 职业：预览页可以指定「正在编辑哪一套」，
                            # 传 __none__ 可以对比「不用题材」时的老提示词。
)


# ======================================================================
# 卡牌角色自由外观（与「人物外观拼装」同一套维度定义，可增删改参数）
# ======================================================================
@router.get("/art/roles")
def art_roles(db: Session = Depends(get_db)):
    """「卡牌外观拼装」页的角色下拉：职业英雄 + 人物。"""
    from ..models.character import Character
    classes = db.query(CardClass).order_by(CardClass.id).all()
    chars = db.query(Character).order_by(Character.id).all()
    loads = {l.character_id: l for l in db.query(CardLoadout).all()}
    return {
        "classes": [
            {"kind": "class", "code": c.code, "name": c.name or "",
             "hero_name": c.hero_name or "",
             "class_name": (c.name or ""),
             "has_appearance": _cls_has_appearance(c)}
            for c in classes
        ],
        "characters": [
            {"kind": "character", "id": ch.id, "name": ch.name or "",
             "gender": ch.gender or "",
             "class_code": (loads.get(ch.id).class_code if loads.get(ch.id) else "")}
            for ch in chars
        ],
    }


def _cls_has_appearance(cls) -> bool:
    raw = (getattr(cls, "appearance_json", "") or "").strip()
    if not raw:
        return False
    try:
        return bool(json.loads(raw))
    except Exception:
        return False


@router.get("/art/roles/{kind}/{rid}")
def art_role_detail(kind: str, rid: str, db: Session = Depends(get_db)):
    """单个卡牌角色的详情：外观（编辑器的初始值）+ 卡面参数。"""
    from ..models.character import Character
    if kind == "class":
        cls = db.query(CardClass).filter(CardClass.code == rid).first()
        if not cls:
            raise HTTPException(404, "职业不存在")
        appearance = _cls_appearance(cls)
        return {
            "kind": "class", "id": rid, "name": cls.name or "",
            "hero_name": cls.hero_name or "", "gender": "",
            "appearance": appearance,
            "params": {
                "style_override": cls.art_style or "",
                "outfit_male": cls.outfit_male or "",
                "outfit_female": cls.outfit_female or "",
                "outfit_other": cls.outfit_other or "",
            },
            "has_appearance": bool(appearance),
        }
    if kind == "character":
        ch = db.query(Character).filter(Character.id == int(rid)).first()
        if not ch:
            raise HTTPException(404, "人物不存在")
        p = card_art.get_card_profile(db, ch.id)
        appearance = {}
        prof_app = (getattr(p, "appearance_json", "") or "").strip() if p else ""
        if prof_app:
            try:
                appearance = json.loads(prof_app) or {}
            except Exception:
                appearance = {}
        if not appearance and (ch.appearance_json or "").strip():
            # 没单独配过卡牌角色外观：拿人物默认外观当编辑起点
            try:
                appearance = json.loads(ch.appearance_json) or {}
            except Exception:
                appearance = {}
        return {
            "kind": "character", "id": ch.id, "name": ch.name or "",
            "gender": ch.gender or "",
            "appearance": appearance,
            "params": {
                "style_override": (getattr(p, "style_override", "") or "") if p else "",
                "outfit_male": (getattr(p, "outfit_male", "") or "") if p else "",
                "outfit_female": (getattr(p, "outfit_female", "") or "") if p else "",
                "outfit_other": (getattr(p, "outfit_other", "") or "") if p else "",
                "prefix_prompt": (getattr(p, "prefix_prompt", "") or "") if p else "",
                "suffix_prompt": (getattr(p, "suffix_prompt", "") or "") if p else "",
                "note": (getattr(p, "note", "") or "") if p else "",
                "enabled": int(getattr(p, "enabled", 1) or 1) if p else 1,
            },
            "has_appearance": bool(appearance),
        }
    raise HTTPException(400, "kind 只能是 class / character")


@router.put("/art/roles/{kind}/{rid}")
def art_role_save(kind: str, rid: str, payload: dict, db: Session = Depends(get_db)):
    """保存卡牌角色的完整外观 + 卡面参数（职业英雄写回职业，人物写回卡牌角色档案）。"""
    from ..models.character import Character
    from ..models.cardgame import CardCharacterProfile

    appearance = payload.get("appearance")
    if appearance is not None and not isinstance(appearance, dict):
        raise HTTPException(400, "appearance 必须是对象")
    app_json = json.dumps(appearance or {}, ensure_ascii=False) if appearance else ""

    if kind == "class":
        cls = db.query(CardClass).filter(CardClass.code == rid).first()
        if not cls:
            raise HTTPException(404, "职业不存在")
        if payload.get("style_override") is not None:
            cls.art_style = str(payload["style_override"])
        if payload.get("outfit_male") is not None:
            cls.outfit_male = str(payload["outfit_male"])
        if payload.get("outfit_female") is not None:
            cls.outfit_female = str(payload["outfit_female"])
        if payload.get("outfit_other") is not None:
            cls.outfit_other = str(payload["outfit_other"])
        cls.appearance_json = app_json
        db.commit()
        return {"ok": True, "has_appearance": bool(appearance)}

    if kind == "character":
        ch = db.query(Character).filter(Character.id == int(rid)).first()
        if not ch:
            raise HTTPException(404, "人物不存在")
        p = card_art.get_card_profile(db, ch.id)
        if p is None:
            p = CardCharacterProfile(character_id=ch.id)
            db.add(p)
        p.appearance_json = app_json
        for k in ("style_override", "outfit_male", "outfit_female",
                  "outfit_other", "prefix_prompt", "suffix_prompt", "note"):
            if payload.get(k) is not None:
                setattr(p, k, str(payload[k]))
        if payload.get("enabled") is not None:
            p.enabled = int(payload["enabled"])
        p.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db.commit()
        db.refresh(p)
        return {"ok": True, "profile": _profile_dict(p)}

    raise HTTPException(400, "kind 只能是 class / character")


def _cls_appearance(cls) -> dict:
    raw = (getattr(cls, "appearance_json", "") or "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw) or {}
    except Exception:
        return {}


@router.post("/art/generate", status_code=201)
def art_generate(payload: dict, db: Session = Depends(get_db)):
    card_code = payload.get("card_code")
    if not card_code:
        raise HTTPException(400, "缺少 card_code")
    try:
        return card_art.start_generate(
            db, card_code,
            class_code=payload.get("class_code") or "",
            gender=payload.get("gender") or "female",
            character_id=payload.get("character_id"),
            prompt_override=payload.get("prompt"),
            set_code=payload.get("set_code") or "",
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/art/generate-batch", status_code=201)
def art_generate_batch(payload: dict, db: Session = Depends(get_db)):
    """一次提交多张卡面。

    以前前端是「提交一张 → 等它出完 → 再提交下一张」，所以任务面板里
    永远只有 1 个任务。改成在这里一次性建好所有任务，
    ComfyUI 侧由 _RUN_GATE 串行排队，面板上能看到真实的任务总数。
    """
    codes = payload.get("card_codes") or []
    if not codes:
        raise HTTPException(400, "缺少 card_codes")
    set_code = payload.get("set_code") or ""
    items = []
    submitted = 0
    for code in codes:
        try:
            one = card_art.start_generate(
                db, code,
                class_code=payload.get("class_code") or "",
                gender=payload.get("gender") or "female",
                character_id=payload.get("character_id"),
                set_code=set_code,
            )
            submitted += 1
            items.append({"card_code": code, "ok": True,
                          "job_id": one["job_id"], "art_id": one["art_id"]})
        except Exception as exc:  # noqa: BLE001
            items.append({"card_code": code, "ok": False, "error": str(exc)[:200]})
    return {"submitted": submitted, "total": len(codes), "items": items,
            "set_code": set_code or card_art.active_set_code(db)}


# ======================================================================
# 卡面套装（换装：A 套 / B 套 / C 套，整副切换，互不覆盖）
# ======================================================================
SET_FIELDS = {"name", "note", "art_style", "outfit_male", "outfit_female",
              "outfit_other", "sort", "enabled"}


@router.get("/art/sets")
def art_sets(db: Session = Depends(get_db)):
    card_art.ensure_default_set(db)
    rows = card_art.list_sets(db)
    return {
        "active": card_art.active_set_code(db),
        "total": len(rows),
        "items": [card_art.set_dict(db, s) for s in rows],
    }


@router.post("/art/sets", status_code=201)
def art_set_create(payload: dict, db: Session = Depends(get_db)):
    from ..models.cardgame import CardArtSet
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "缺少套装名称")

    base = None
    if payload.get("copy_from"):
        base = db.query(CardArtSet).filter(
            CardArtSet.code == payload["copy_from"]).first()

    code = (payload.get("code") or "").strip()
    if not code:
        # 拼音不好生成，直接用递增序号：set2 / set3 …… 稳定又不重复
        n = db.query(CardArtSet).count() + 1
        while db.query(CardArtSet).filter(CardArtSet.code == f"set{n}").first():
            n += 1
        code = f"set{n}"
    if db.query(CardArtSet).filter(CardArtSet.code == code).first():
        raise HTTPException(400, f"套装标识已存在：{code}")

    row = CardArtSet(
        code=code, name=name,
        note=payload.get("note") or (f"复制自「{base.name}」" if base else ""),
        art_style=payload.get("art_style") or (base.art_style if base else ""),
        outfit_male=payload.get("outfit_male") or (base.outfit_male if base else ""),
        outfit_female=payload.get("outfit_female") or (base.outfit_female if base else ""),
        outfit_other=payload.get("outfit_other") or (base.outfit_other if base else ""),
        is_active=0, sort=int(payload.get("sort") or 0), enabled=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return card_art.set_dict(db, row)


@router.put("/art/sets/{code}")
def art_set_update(code: str, payload: dict, db: Session = Depends(get_db)):
    from ..models.cardgame import CardArtSet
    row = db.query(CardArtSet).filter(CardArtSet.code == code).first()
    if not row:
        raise HTTPException(404, "套装不存在")
    for key in SET_FIELDS:
        if key in payload and payload[key] is not None:
            setattr(row, key, payload[key])
    row.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.commit()
    return card_art.set_dict(db, row)


@router.delete("/art/sets/{code}", status_code=204)
def art_set_delete(code: str, db: Session = Depends(get_db)):
    """删套装只删「分组」，卡面图一起删掉，但它已经写进 card_defs 的那一版保留。

    这样即使误删，正在用的卡面不会突然变成空白。
    """
    from ..models.cardgame import CardArtSet
    row = db.query(CardArtSet).filter(CardArtSet.code == code).first()
    if not row:
        raise HTTPException(404, "套装不存在")
    if row.is_active:
        raise HTTPException(400, "不能删除正在使用的套装，请先切到别的套装")
    db.query(CardArt).filter(CardArt.set_code == code).delete(synchronize_session=False)
    db.delete(row)
    db.commit()


@router.post("/art/sets/{code}/activate")
def art_set_activate(code: str, db: Session = Depends(get_db)):
    """整副换装：把这套的图全部写回卡牌。"""
    try:
        return card_art.apply_set(db, code)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/art/sets/{code}/generate", status_code=201)
def art_set_generate(code: str, payload: dict | None = None, db: Session = Depends(get_db)):
    """把这一套里还缺图的卡，一次性全部提交生成。"""
    payload = payload or {}
    try:
        return card_art.start_generate_set(
            db, code,
            only_missing=bool(payload.get("only_missing", True)),
            class_code=payload.get("class_code") or "",
            gender=payload.get("gender") or "",
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ======================================================================
# 卡组固定模板（30 张完整性）
# ======================================================================
@router.get("/deck/report")
def deck_report(db: Session = Depends(get_db)):
    return card_seed.deck_report(db)


@router.post("/deck/repair")
def deck_repair(db: Session = Depends(get_db)):
    return card_seed.repair_decks(db)



@router.get("/art/list")
def art_list(card_code: Optional[str] = None, set_code: Optional[str] = None,
             db: Session = Depends(get_db)):
    q = db.query(CardArt)
    if card_code:
        q = q.filter(CardArt.card_code == card_code)
    if set_code:
        q = q.filter(CardArt.set_code == set_code)
    rows = q.order_by(CardArt.id.desc()).limit(200).all()
    return [{
        "id": a.id, "card_code": a.card_code, "class_code": a.class_code,
        "set_code": a.set_code,
        "gender": a.gender, "character_id": a.character_id,
        "prompt": a.prompt, "image_url": a.image_url,
        "width": a.width, "height": a.height, "model_preset": a.model_preset,
        "job_id": a.job_id, "is_active": a.is_active, "created_at": a.created_at,
    } for a in rows]


@router.post("/art/apply")
def art_apply(payload: dict, db: Session = Depends(get_db)):
    art_id = payload.get("art_id")
    if not art_id:
        raise HTTPException(400, "缺少 art_id")
    try:
        return card_art.apply_art(db, int(art_id))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/art/{art_id}", status_code=204)
def art_delete(art_id: int, db: Session = Depends(get_db)):
    obj = db.query(CardArt).filter(CardArt.id == art_id).first()
    if not obj:
        raise HTTPException(404, "卡面不存在")
    db.delete(obj)
    db.commit()
