# -*- coding: utf-8 -*-
"""
人物外观拼装路由。

提供：
- 维度定义（供前端渲染；可在后台增删改，落盘 appearance_defs.json）
- 定向随机（按题材 / 国族 / 动作分类收敛候选）
- 单人单项重摇（只换一个参数，其余保留）
- 中文提示词拼装
- 外观保存到人物 / 从人物读取
- 批量创建人物（一次生成一批同题材人物）
- 定义库管理（分组 / 维度 / 选项 / 题材 的增删改）
"""

import json
from typing import Optional

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.character_appearance import CharacterAppearance
from ..appearance import generator, defs

router = APIRouter(prefix="/api/appearance", tags=["人物外观拼装"])
char_router = APIRouter(prefix="/api/characters", tags=["人物外观拼装-人物"])
admin_router = APIRouter(prefix="/api/appearance/manage", tags=["外观定义管理"])


# ===================== 请求体 =====================
class RandomReq(BaseModel):
    gender: Optional[str] = None
    age: Optional[str] = None
    style: Optional[str] = None
    theme: Optional[str] = None
    nationality: Optional[str] = None
    pose_category: Optional[str] = None
    mode: str = "default"
    seed: Optional[int] = None
    include_sensitive: bool = False


class PromptReq(BaseModel):
    appearance: Optional[dict] = None      # 不传则用人物已保存的外观
    include_sensitive: bool = False


class SaveAppearanceReq(BaseModel):
    appearance: dict


class RerollReq(BaseModel):
    appearance: dict
    dim: str
    include_sensitive: bool = False
    seed: Optional[int] = None


class BatchCreateReq(BaseModel):
    count: int = 10
    name_prefix: str = "角色"
    character_type: str = "npc"
    category_path: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[str] = None
    style: Optional[str] = None
    theme: Optional[str] = None
    nationality: Optional[str] = None
    mode: str = "default"
    include_sensitive: bool = False


class GroupReq(BaseModel):
    id: Optional[str] = None
    name: str
    icon: Optional[str] = ""


class DimReq(BaseModel):
    id: Optional[str] = None
    name: str
    group: str = "meta"
    sensitive: bool = False
    is_color: bool = False
    cond: Optional[dict] = None


class OptionReq(BaseModel):
    id: Optional[str] = None
    name: str
    cn: Optional[str] = ""
    tags: Optional[list[str]] = None
    cat: Optional[str] = ""


class MoveReq(BaseModel):
    delta: int = 1


class ThemeReq(BaseModel):
    id: Optional[str] = None
    name: str
    desc: Optional[str] = ""
    cn: Optional[str] = ""
    nationality: Optional[str] = ""
    tags: Optional[list[str]] = None
    pools: Optional[dict] = None
    colors: Optional[list[str]] = None


# ===================== 定义读取 =====================
@router.get("/defs")
def get_defs(include_sensitive: bool = False):
    return generator.get_defs(include_sensitive=include_sensitive)


@router.get("/themes")
def get_themes():
    return [
        {"id": t["id"], "name": t["name"], "desc": t.get("desc", ""),
         "nationality": t.get("nationality", ""), "cn": t.get("cn", ""),
         "colors": t.get("colors") or [],
         "pool_dims": sorted((t.get("pools") or {}).keys())}
        for t in defs.themes()
    ]


# ===================== 随机生成 =====================
@router.post("/random")
def random_appearance(req: RandomReq):
    appearance = generator.random_appearance(
        gender=req.gender, age=req.age, style=req.style, theme=req.theme,
        nationality=req.nationality, pose_category=req.pose_category,
        mode=req.mode, seed=req.seed, include_sensitive=req.include_sensitive,
    )
    prompt = generator.to_prompt_parts(appearance, include_sensitive=req.include_sensitive)
    return {"appearance": appearance, "prompt": prompt}


@router.post("/prompt")
def build_prompt(req: PromptReq):
    prompt = generator.to_prompt_parts(req.appearance, include_sensitive=req.include_sensitive)
    return {"prompt": prompt}


@router.post("/reroll")
def reroll_one(req: RerollReq):
    """只重摇一个维度，返回新值与新提示词。"""
    import random as _r
    if req.seed is not None:
        _r.seed(req.seed)
    c = dict(req.appearance or {})
    new_val = generator.reroll_dim(c, req.dim, req.include_sensitive)
    if new_val is None:
        raise HTTPException(status_code=400, detail=f"维度 {req.dim} 当前没有可选项")
    c[req.dim] = new_val
    if req.dim == "nudity":
        generator.apply_nudity(c)
    c = generator.normalize(c, req.include_sensitive)
    prompt = generator.to_prompt_parts(c, include_sensitive=req.include_sensitive)
    return {"appearance": c, "value": new_val, "prompt": prompt}


# ===================== 绑定到具体人物 =====================
def _get_char(db: Session, character_id: int) -> Character:
    char = db.query(Character).filter(Character.id == character_id).first()
    if not char:
        raise HTTPException(status_code=404, detail="人物不存在")
    return char


def _load_appearance(char: Character) -> dict:
    if not char.appearance_json:
        return {}
    try:
        data = json.loads(char.appearance_json)
    except Exception:
        return {}
    # 旧版本存的是年龄段（young/middle…），读出来先升级成确定的岁数，
    # 否则年龄下拉对不上、提示词会拼出「middle 岁」。
    age = data.get("age")
    if age and not str(age).isdigit():
        data["age"] = generator.AGE_BAND_AGE.get(str(age), "22")
    # 旧数据没有裸露状态时默认「完整着装」，否则上装/下装的条件判定不成立，
    # 编辑器里整块「穿着打扮」会一行都不显示。
    data.setdefault("nudity", "none")
    return data


def _with_name(appearance: dict, name: str) -> dict:
    if not appearance:
        return appearance
    return {**appearance, "name": name}


# ===================== 多套外观配置 =====================
def _json_load(raw, fallback=None):
    if not raw:
        return fallback if fallback is not None else {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else (fallback if fallback is not None else {})
    except Exception:
        return fallback if fallback is not None else {}


def _ensure_presets(db: Session, char: Character) -> list[CharacterAppearance]:
    """保证每个角色至少有一张外观配置卡。

    老角色只有 characters.appearance_json，没有配置记录 —— 第一次打开时
    自动建一张「默认外观」，把旧数据搬进去，用户看不出迁移痕迹。
    """
    rows = (db.query(CharacterAppearance)
            .filter(CharacterAppearance.character_id == char.id)
            .order_by(CharacterAppearance.sort, CharacterAppearance.id).all())
    if rows:
        return rows
    app = _load_appearance(char)
    p = CharacterAppearance(
        character_id=char.id, name="默认外观",
        appearance_json=json.dumps(app or {}, ensure_ascii=False),
        is_default=1, sort=0)
    db.add(p)
    db.commit()
    db.refresh(p)
    return [p]


def _preset_dict(p: CharacterAppearance) -> dict:
    app = _json_load(p.appearance_json)
    return {
        "id": p.id,
        "character_id": p.character_id,
        "name": p.name,
        "is_default": bool(p.is_default),
        "sort": p.sort,
        "appearance": app,
        # 取景：full 全身 / half 半身（腰部以上）
        "framing": app.get("framing") or "full",
        "updated_at": p.updated_at,
    }


class AppearancePresetReq(BaseModel):
    name: Optional[str] = None
    appearance: Optional[dict] = None
    is_default: Optional[bool] = None


@char_router.get("/{character_id}/appearances")
def list_character_appearances(character_id: int, db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    rows = _ensure_presets(db, char)
    return {"character_id": character_id, "character_name": char.name,
            "items": [_preset_dict(p) for p in rows]}


@char_router.post("/{character_id}/appearances", status_code=201)
def create_character_appearance(character_id: int, req: AppearancePresetReq,
                                db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    rows = _ensure_presets(db, char)
    name = (req.name or "").strip() or f"外观 {len(rows) + 1}"
    app = dict(req.appearance or {})
    app.setdefault("name", char.name)
    app.setdefault("framing", "full")
    p = CharacterAppearance(
        character_id=char.id, name=name,
        appearance_json=json.dumps(app, ensure_ascii=False),
        is_default=1 if req.is_default and not any(r.is_default for r in rows) else 0,
        sort=(max([r.sort for r in rows]) + 1 if rows else 0))
    db.add(p)
    db.commit()
    db.refresh(p)
    return _preset_dict(p)


@char_router.put("/{character_id}/appearances/{appearance_id}")
def update_character_appearance(character_id: int, appearance_id: int,
                                req: AppearancePresetReq,
                                db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    p = db.query(CharacterAppearance).filter(
        CharacterAppearance.id == appearance_id,
        CharacterAppearance.character_id == character_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="外观配置不存在")
    if req.name is not None and req.name.strip():
        p.name = req.name.strip()
    if req.appearance is not None:
        app = {k: v for k, v in req.appearance.items() if v not in (None, "")}
        app.setdefault("name", char.name)
        p.appearance_json = json.dumps(app, ensure_ascii=False)
        if p.is_default:
            char.appearance_json = p.appearance_json
        if app.get("gender") in ("male", "female"):
            char.gender = app["gender"]
    if req.is_default:
        db.query(CharacterAppearance).filter(
            CharacterAppearance.character_id == character_id
        ).update({CharacterAppearance.is_default: 0}, synchronize_session=False)
        p.is_default = 1
        char.appearance_json = p.appearance_json
    p.updated_at = __import__("datetime").datetime.now().isoformat()
    db.commit()
    db.refresh(p)
    return _preset_dict(p)


@char_router.delete("/{character_id}/appearances/{appearance_id}", status_code=200)
def delete_character_appearance(character_id: int, appearance_id: int,
                                db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    rows = (db.query(CharacterAppearance)
            .filter(CharacterAppearance.character_id == character_id)
            .order_by(CharacterAppearance.sort, CharacterAppearance.id).all())
    p = next((x for x in rows if x.id == appearance_id), None)
    if not p:
        raise HTTPException(status_code=404, detail="外观配置不存在")
    if len(rows) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一套外观配置")
    was_default = bool(p.is_default)
    db.delete(p)
    db.flush()
    if was_default:
        nxt = (db.query(CharacterAppearance)
               .filter(CharacterAppearance.character_id == character_id)
               .order_by(CharacterAppearance.sort, CharacterAppearance.id).first())
        if nxt:
            nxt.is_default = 1
            char.appearance_json = nxt.appearance_json
    db.commit()
    default = (db.query(CharacterAppearance)
               .filter(CharacterAppearance.character_id == character_id,
                       CharacterAppearance.is_default == 1).first())
    return {"ok": True, "default_id": default.id if default else None}


@char_router.post("/{character_id}/appearances/{appearance_id}/default")
def set_default_character_appearance(character_id: int, appearance_id: int,
                                     db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    p = db.query(CharacterAppearance).filter(
        CharacterAppearance.id == appearance_id,
        CharacterAppearance.character_id == character_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="外观配置不存在")
    db.query(CharacterAppearance).filter(
        CharacterAppearance.character_id == character_id
    ).update({CharacterAppearance.is_default: 0}, synchronize_session=False)
    p.is_default = 1
    char.appearance_json = p.appearance_json
    db.commit()
    return {"ok": True, "id": p.id}


@char_router.get("/{character_id}/appearance")
def get_character_appearance(character_id: int, include_sensitive: bool = False,
                             db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    rows = _ensure_presets(db, char)
    default = next((p for p in rows if p.is_default), rows[0])
    appearance = _json_load(default.appearance_json)
    prompt = None
    if appearance:
        prompt = generator.to_prompt_parts(_with_name(appearance, char.name),
                                           include_sensitive=include_sensitive)
    return {
        "character_id": character_id,
        "character_name": char.name,
        "gender": char.gender,
        "appearance": appearance,
        "appearance_id": default.id,
        "appearance_name": default.name,
        "prompt": prompt,
    }


@char_router.put("/{character_id}/appearance", status_code=200)
def save_character_appearance(character_id: int, req: SaveAppearanceReq,
                              db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    app = {k: v for k, v in (req.appearance or {}).items() if v not in (None, "")}
    char.appearance_json = json.dumps(app, ensure_ascii=False)
    # 默认配置同步更新，避免「改完保存，换一套再换回来又变回旧值」
    rows = _ensure_presets(db, char)
    default = next((p for p in rows if p.is_default), rows[0])
    default.appearance_json = char.appearance_json
    default.updated_at = __import__("datetime").datetime.now().isoformat()
    # 顺带把性别同步到人物主表（语音选角依赖它）
    if app.get("gender") in ("male", "female"):
        char.gender = app["gender"]
    db.commit()
    db.refresh(char)
    return {
        "character_id": character_id,
        "character_name": char.name,
        "appearance": app,
        "appearance_id": default.id,
        "prompt": generator.to_prompt_parts(_with_name(app, char.name), False),
        "ok": True,
    }


@char_router.post("/{character_id}/appearance/random")
def random_character_appearance(character_id: int, req: RandomReq,
                                db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    gender = req.gender or (char.gender if char.gender in ("male", "female") else None)
    appearance = generator.random_appearance(
        gender=gender, age=req.age, style=req.style, theme=req.theme,
        nationality=req.nationality, pose_category=req.pose_category,
        mode=req.mode, seed=req.seed, include_sensitive=req.include_sensitive,
    )
    appearance["name"] = char.name
    char.appearance_json = json.dumps(appearance, ensure_ascii=False)
    if appearance.get("gender") in ("male", "female"):
        char.gender = appearance["gender"]
    db.commit()
    db.refresh(char)
    prompt = generator.to_prompt_parts(appearance, include_sensitive=req.include_sensitive)
    return {
        "character_id": character_id, "character_name": char.name,
        "appearance": appearance, "prompt": prompt,
    }


@char_router.post("/{character_id}/appearance/prompt")
def character_appearance_prompt(character_id: int, req: PromptReq,
                                db: Session = Depends(get_db)):
    char = _get_char(db, character_id)
    appearance = req.appearance if req.appearance else _load_appearance(char)
    if not appearance:
        raise HTTPException(status_code=400, detail="该人物尚无外观数据，且请求未提供 appearance")
    prompt = generator.to_prompt_parts(_with_name(appearance, char.name),
                                       include_sensitive=req.include_sensitive)
    return {"character_id": character_id, "character_name": char.name, "prompt": prompt}


# ===================== 批量创建人物 =====================
@router.post("/batch-characters")
def batch_create_characters(req: BatchCreateReq, db: Session = Depends(get_db)):
    """一次按同一题材生成多个人物（各自独立随机外观）。"""
    n = max(1, min(req.count, 100))
    created = []
    # 同批重复名会很烦，先算出该前缀下已用到的最大序号
    existing = [c.name for c in db.query(Character).filter(
        Character.name.like(f"{req.name_prefix}%")).all()]
    start = 1
    for name in existing:
        tail = name[len(req.name_prefix):]
        if tail.isdigit():
            start = max(start, int(tail) + 1)

    for i in range(n):
        appearance = generator.random_appearance(
            gender=req.gender, age=req.age, style=req.style, theme=req.theme,
            nationality=req.nationality, mode=req.mode,
            include_sensitive=req.include_sensitive,
        )
        name = f"{req.name_prefix}{start + i:02d}"
        appearance["name"] = name
        ch = Character(
            name=name,
            character_type=req.character_type or "npc",
            category_path=req.category_path or None,
            gender=appearance.get("gender") if appearance.get("gender") in ("male", "female") else "unknown",
            appearance_json=json.dumps(appearance, ensure_ascii=False),
        )
        db.add(ch)
        created.append(ch)
    db.commit()
    out = []
    for ch in created:
        db.refresh(ch)
        out.append({"id": ch.id, "name": ch.name})
        try:
            from .tag import ensure_character_name_tag
            ensure_character_name_tag(db, ch.id, ch.name)
        except Exception:
            pass
    return {"ok": True, "count": len(out), "characters": out}


# ===================== 定义库管理（后台增删改） =====================
@admin_router.get("/raw")
def get_raw_defs():
    return defs.data()


@admin_router.post("/reset")
def reset_defs():
    return {"ok": True, "version": defs.reset().get("version")}


# ---- 分组 ----
@admin_router.post("/groups", status_code=201)
def create_group(req: GroupReq):
    gid = req.id or ("g" + str(int(__import__("time").time())))
    if any(g["id"] == gid for g in defs.groups()):
        raise HTTPException(status_code=400, detail="分组 id 已存在")
    defs.upsert_group({"id": gid, "name": req.name, "icon": req.icon or ""})
    return {"id": gid, "ok": True}


@admin_router.put("/groups/{gid}")
def update_group(gid: str, req: GroupReq):
    if not any(g["id"] == gid for g in defs.groups()):
        raise HTTPException(status_code=404, detail="分组不存在")
    defs.upsert_group({"id": gid, "name": req.name, "icon": req.icon or ""})
    return {"ok": True}


@admin_router.delete("/groups/{gid}")
def delete_group(gid: str):
    if not defs.delete_group(gid):
        raise HTTPException(status_code=404, detail="分组不存在")
    return {"ok": True}


# ---- 维度 ----
@admin_router.post("/dims", status_code=201)
def create_dim(req: DimReq):
    did = req.id or ("d" + str(int(__import__("time").time())))
    if defs.dim_by_id(did):
        raise HTTPException(status_code=400, detail="维度 id 已存在")
    defs.upsert_dim({"id": did, "name": req.name, "group": req.group,
                     "sensitive": req.sensitive, "is_color": req.is_color,
                     "cond": req.cond, "options": []})
    return {"id": did, "ok": True}


@admin_router.put("/dims/{dim_id}")
def update_dim(dim_id: str, req: DimReq):
    cur = defs.dim_by_id(dim_id)
    if not cur:
        raise HTTPException(status_code=404, detail="维度不存在")
    defs.upsert_dim({**cur, "name": req.name, "group": req.group,
                     "sensitive": req.sensitive, "is_color": req.is_color,
                     "cond": req.cond})
    return {"ok": True}


@admin_router.delete("/dims/{dim_id}")
def delete_dim(dim_id: str):
    if not defs.delete_dim(dim_id):
        raise HTTPException(status_code=404, detail="维度不存在")
    return {"ok": True}


# ---- 选项 ----
@admin_router.post("/dims/{dim_id}/options", status_code=201)
def create_option(dim_id: str, req: OptionReq):
    if not defs.dim_by_id(dim_id):
        raise HTTPException(status_code=404, detail="维度不存在")
    oid = req.id or ("o" + str(int(__import__("time").time() * 1000)))
    if defs.option_of(dim_id, oid):
        raise HTTPException(status_code=400, detail="选项 id 已存在")
    defs.upsert_option(dim_id, {"id": oid, "name": req.name, "cn": req.cn or "",
                                "tags": req.tags or [], "cat": req.cat or ""})
    return {"id": oid, "ok": True}


@admin_router.put("/dims/{dim_id}/options/{opt_id}")
def update_option(dim_id: str, opt_id: str, req: OptionReq):
    cur = defs.option_of(dim_id, opt_id)
    if not cur:
        raise HTTPException(status_code=404, detail="选项不存在")
    defs.upsert_option(dim_id, {**cur, "name": req.name, "cn": req.cn or "",
                                "tags": req.tags if req.tags is not None else cur.get("tags") or [],
                                "cat": req.cat or cur.get("cat") or ""})
    return {"ok": True}


@admin_router.delete("/dims/{dim_id}/options/{opt_id}")
def delete_option(dim_id: str, opt_id: str):
    if not defs.delete_option(dim_id, opt_id):
        raise HTTPException(status_code=404, detail="选项不存在")
    return {"ok": True}


@admin_router.post("/dims/{dim_id}/options/{opt_id}/move")
def move_option(dim_id: str, opt_id: str, req: MoveReq):
    return {"ok": defs.move_option(dim_id, opt_id, req.delta)}


# ---- 题材 ----
@admin_router.post("/themes", status_code=201)
def create_theme(req: ThemeReq):
    tid = req.id or ("t" + str(int(__import__("time").time())))
    if defs.theme_by_id(tid):
        raise HTTPException(status_code=400, detail="题材 id 已存在")
    defs.upsert_theme({"id": tid, "name": req.name, "desc": req.desc or "",
                       "cn": req.cn or "", "nationality": req.nationality or "",
                       "tags": req.tags or [], "pools": req.pools or {},
                       "colors": req.colors or []})
    return {"id": tid, "ok": True}


@admin_router.put("/themes/{tid}")
def update_theme(tid: str, req: ThemeReq):
    cur = defs.theme_by_id(tid)
    if not cur:
        raise HTTPException(status_code=404, detail="题材不存在")
    defs.upsert_theme({**cur, "name": req.name, "desc": req.desc or "",
                       "cn": req.cn or "", "nationality": req.nationality or "",
                       "tags": req.tags if req.tags is not None else cur.get("tags") or [],
                       "pools": req.pools if req.pools is not None else cur.get("pools") or {},
                       "colors": req.colors if req.colors is not None else cur.get("colors") or []})
    return {"ok": True}


@admin_router.delete("/themes/{tid}")
def delete_theme(tid: str):
    if not defs.delete_theme(tid):
        raise HTTPException(status_code=404, detail="题材不存在")
    return {"ok": True}
