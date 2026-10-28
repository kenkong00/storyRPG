# -*- coding: utf-8 -*-
"""场景拼装 · 场景出图 · 人物 × 场景合成。

流程和人物外观一致：后台拼维度 → 中文提示词 → ComfyUI → 图片记录。
多出来的「合成」是给剧情/立绘用的：把人物提示词和场景提示词拼在一起，
去掉两边互相冲突的「纯色背景 / 无人物」画面词，再补一段构图指令。
"""

import json
import time
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.character_appearance import CharacterAppearance
from ..models.scene import Scene
from ..models.scene_appearance import SceneAppearance
from ..models.scene_image import SceneImage
from ..models.compose_config import ComposeConfig
from ..scenes import defs_store as sdefs
from ..scenes import generator as sgen
from ..scenes import layout as slayout
from ..appearance import generator as agen
from .. import jobs

router = APIRouter(prefix="/api/scene-gen", tags=["场景拼装"])


# ===================== 请求体 =====================
class RandomReq(BaseModel):
    theme: Optional[str] = None
    seed: Optional[int] = None
    base: Optional[dict] = None


class PromptReq(BaseModel):
    scene: Optional[dict] = None
    free_prompt: Optional[str] = None


class SceneGenReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    scene_id: Optional[int] = None
    appearance: dict
    free_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    model_preset: Optional[str] = None
    use_active_model_preset: bool = True
    title: str = ""
    save_to_scene: bool = True
    seed: Optional[int] = None
    appearance_id: Optional[int] = None   # 用的是哪套外观配置（晴天 / 雨天…）
    # 用户手改过的整段正向提示词：传了就直接用它出图
    prompt_override: Optional[str] = None


class ComposeCharacterReq(BaseModel):
    """合成画面里的一个人物（一幕可以有多个）。"""
    model_config = ConfigDict(protected_namespaces=())
    character_id: int
    appearance_id: Optional[int] = None
    pose_id: Optional[str] = None
    framing: Optional[str] = None    # full / half（空 = 用外观配置自带的）
    shot: Optional[str] = None       # 这个人在画面里的大小（空 = 用全局）
    placement: Optional[str] = None  # left / center / right / foreground / background
    note: Optional[str] = None       # 这一幕里该人物的具体状态


class ComposeReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    # 单人写法（旧接口兼容）：character_id
    character_id: Optional[int] = None
    appearance_id: Optional[int] = None
    # 多人写法：characters 优先
    characters: Optional[list[ComposeCharacterReq]] = None
    scene_id: Optional[int] = None
    scene_appearance: Optional[dict] = None
    scene_prompt: Optional[str] = None
    framing: str = "full"          # full / half（多人时作为各人物默认取景）
    shot: str = "medium"           # full / medium / half / close
    placement: str = "center"      # left / center / right / foreground
    pose_id: Optional[str] = None  # 人物动作（可选，套用到外观提示词）
    extra: Optional[str] = None
    include_sensitive: bool = False
    width: Optional[int] = None
    height: Optional[int] = None
    model_preset: Optional[str] = None
    # 步数 / CFG 显式覆盖（0 或空 = 用模型方案自带 / 全局参数）
    steps: Optional[int] = None
    cfg: Optional[float] = None
    title: str = ""
    # 用户在提示词框里手改过的整段正向提示词：传了就直接用它出图（不再自动拼）
    prompt_override: Optional[str] = None
    # 边界框布局：有画框时整段取代自动拼装（见 scenes/layout.py）
    layout: Optional[dict] = None


# ===================== 定义 / 提示词 =====================
@router.get("/defs")
def get_defs():
    return sgen.get_defs()


@router.get("/themes")
def get_themes():
    return [{"id": t["id"], "name": t["name"], "desc": t.get("desc", ""),
             "cn": t.get("cn", ""), "colors": t.get("colors") or [],
             "cat": t.get("cat", "genre")}
            for t in sdefs.themes()]


@router.post("/random")
def random_scene(req: RandomReq):
    scene = sgen.random_scene(theme=req.theme, seed=req.seed, base=req.base)
    return {"scene": scene, "prompt": sgen.to_prompt_parts(scene)}


@router.post("/reroll")
def reroll_dim(req: dict):
    scene = dict(req.get("scene") or {})
    dim = req.get("dim")
    if not dim:
        raise HTTPException(status_code=400, detail="缺少 dim")
    val = sgen.reroll_dim(scene, dim, req.get("theme"))
    if val is None:
        raise HTTPException(status_code=400, detail=f"维度 {dim} 没有可选项")
    scene[dim] = val
    return {"scene": scene, "value": val, "prompt": sgen.to_prompt_parts(scene)}


@router.post("/prompt")
def build_prompt(req: PromptReq):
    return {"prompt": sgen.to_prompt_parts(req.scene or {}, req.free_prompt)}


# ===================== 场景外观配置（晴天 / 雨天 / 夜晚… 多套并存） =====================
class SceneAppReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    name: Optional[str] = None
    appearance: Optional[dict] = None
    prompt_text: Optional[str] = None
    negative_prompt: Optional[str] = None


def _app_dict(a: "SceneAppearance") -> dict:
    try:
        app = json.loads(a.appearance_json) if a.appearance_json else {}
    except Exception:  # noqa: BLE001
        app = {}
    return {"id": a.id, "scene_id": a.scene_id, "name": a.name, "appearance": app,
            "prompt_text": a.prompt_text or "", "negative_prompt": a.negative_prompt or "",
            "is_default": bool(a.is_default), "sort": a.sort or 0,
            "created_at": a.created_at, "updated_at": a.updated_at}


def _mirror_default(db: Session, scene_id: int):
    """把默认配置的内容镜像回 scenes.appearance_json，旧接口 / 旧数据都能读到。"""
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if not sc:
        return
    d = (db.query(SceneAppearance)
         .filter(SceneAppearance.scene_id == scene_id)
         .order_by(SceneAppearance.is_default.desc(), SceneAppearance.sort,
                   SceneAppearance.id).first())
    if not d:
        return
    sc.appearance_json = d.appearance_json
    sc.prompt_text = d.prompt_text
    sc.negative_prompt = d.negative_prompt


@router.get("/{scene_id}/appearances")
def list_scene_appearances(scene_id: int, db: Session = Depends(get_db)):
    rows = (db.query(SceneAppearance).filter(SceneAppearance.scene_id == scene_id)
            .order_by(SceneAppearance.is_default.desc(), SceneAppearance.sort,
                      SceneAppearance.id).all())
    return {"scene_id": scene_id, "items": [_app_dict(r) for r in rows]}


@router.post("/{scene_id}/appearances", status_code=201)
def create_scene_appearance(scene_id: int, req: SceneAppReq,
                            db: Session = Depends(get_db)):
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="场景不存在")
    name = (req.name or "").strip() or "新配置"
    has = db.query(SceneAppearance).filter(SceneAppearance.scene_id == scene_id).count()
    row = SceneAppearance(
        scene_id=scene_id, name=name,
        appearance_json=json.dumps(req.appearance or {}, ensure_ascii=False),
        prompt_text=req.prompt_text or "", negative_prompt=req.negative_prompt or "",
        is_default=0 if has else 1, sort=has)
    db.add(row)
    db.commit()
    db.refresh(row)
    _mirror_default(db, scene_id)
    db.commit()
    return _app_dict(row)


@router.put("/{scene_id}/appearances/{app_id}")
def update_scene_appearance(scene_id: int, app_id: int, req: SceneAppReq,
                            db: Session = Depends(get_db)):
    row = db.query(SceneAppearance).filter(SceneAppearance.id == app_id,
                                           SceneAppearance.scene_id == scene_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="配置不存在")
    if req.name is not None:
        row.name = req.name.strip() or row.name
    if req.appearance is not None:
        row.appearance_json = json.dumps(req.appearance, ensure_ascii=False)
    if req.prompt_text is not None:
        row.prompt_text = req.prompt_text
    if req.negative_prompt is not None:
        row.negative_prompt = req.negative_prompt
    row.updated_at = datetime.now().isoformat()
    db.commit()
    _mirror_default(db, scene_id)
    db.commit()
    return _app_dict(row)


@router.post("/{scene_id}/appearances/{app_id}/default")
def set_default_scene_appearance(scene_id: int, app_id: int,
                                 db: Session = Depends(get_db)):
    row = db.query(SceneAppearance).filter(SceneAppearance.id == app_id,
                                           SceneAppearance.scene_id == scene_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="配置不存在")
    db.query(SceneAppearance).filter(SceneAppearance.scene_id == scene_id)\
        .update({SceneAppearance.is_default: 0}, synchronize_session=False)
    row.is_default = 1
    db.commit()
    _mirror_default(db, scene_id)
    db.commit()
    return {"ok": True}


@router.delete("/{scene_id}/appearances/{app_id}")
def delete_scene_appearance(scene_id: int, app_id: int,
                            db: Session = Depends(get_db)):
    rows = (db.query(SceneAppearance).filter(SceneAppearance.scene_id == scene_id)
            .order_by(SceneAppearance.is_default.desc(), SceneAppearance.sort,
                      SceneAppearance.id).all())
    row = next((r for r in rows if r.id == app_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="配置不存在")
    if len(rows) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一套配置")
    db.delete(row)
    db.commit()
    # 删掉的是默认配置 → 让剩下第一条接上
    if row.is_default:
        first = (db.query(SceneAppearance)
                 .filter(SceneAppearance.scene_id == scene_id)
                 .order_by(SceneAppearance.sort, SceneAppearance.id).first())
        if first:
            first.is_default = 1
            db.commit()
    _mirror_default(db, scene_id)
    db.commit()
    return {"ok": True}


# ===================== 场景出图 =====================
def _scene_job(job_id, req: SceneGenReq):
    from . import comfyui as comfyui_router
    from ..database import SessionLocal

    jobs.gate(job_id)
    scene = None
    db = SessionLocal()
    try:
        if req.scene_id:
            scene = db.query(Scene).filter(Scene.id == req.scene_id).first()
        parts = sgen.to_prompt_parts(req.appearance or {}, req.free_prompt)
        positive = parts["posCn"]
        if (req.prompt_override or "").strip():
            positive = req.prompt_override.strip()   # 手改过的提示词优先
        negative = (req.negative_prompt or "").strip() or parts["negCn"]
        width = int(req.width or 1344)
        height = int(req.height or 768)
        payload = comfyui_router.GenerateReq(
            positive=positive,
            negative=negative,
            mode="t2i",
            prompt_lang="cn",
            width=width, height=height,
            batch_size=1,
            filename_prefix="scene",
            model_preset=req.model_preset,
            use_active_model_preset=req.use_active_model_preset,
            random_seed=req.seed is None,
            seed=req.seed,
            ctx={"source": "scene_render",
                 "asset_kind": "scene",
                 "subject_type": "scene",
                 "subject_id": req.scene_id,
                 "subject_name": scene.name if scene else None,
                 "category": "scene",
                 "scene_id": req.scene_id,
                 "job_id": job_id},
        )
        # 暂停/取消时掐掉当前这张；暂停后继续会重跑这一张
        resp = None
        while True:
            jobs.gate(job_id)
            try:
                resp = comfyui_router.generate(payload)
                break
            except Exception:
                if jobs.is_canceled(job_id):
                    raise jobs.JobCanceled()
                if jobs.abort_now(job_id):
                    continue
                raise
        url = (resp.get("images") or [None])[0]
        if not url:
            raise RuntimeError("ComfyUI 未返回图片")
        meta = (resp.get("meta") or [{}])[0]
        item = {
            "url": url,
            "width": meta.get("width") or resp.get("width") or width,
            "height": meta.get("height") or resp.get("height") or height,
            "prompt": resp.get("positive") or positive,
            "negative": resp.get("negative") or negative,
            "model_preset": req.model_preset or "",
        }
        if scene:
            app_name = ""
            if req.appearance_id:
                a = db.query(SceneAppearance).filter(
                    SceneAppearance.id == req.appearance_id).first()
                app_name = (a.name if a else "") or ""
            img = SceneImage(
                scene_id=scene.id, image_url=url, prompt=item["prompt"],
                negative=item["negative"], model_preset=item["model_preset"],
                width=item["width"], height=item["height"],
                appearance_json=json.dumps(req.appearance or {}, ensure_ascii=False),
                appearance_id=req.appearance_id, appearance_name=app_name,
            )
            db.add(img)
            if req.save_to_scene:
                scene.background_image = url
                scene.appearance_json = json.dumps(req.appearance or {}, ensure_ascii=False)
                if req.free_prompt is not None:
                    scene.prompt_text = req.free_prompt
                if req.negative_prompt is not None:
                    scene.negative_prompt = req.negative_prompt
            db.commit()
        jobs.step(job_id, ok=True, result=item, image=url, message="场景图已生成")
        jobs.update(job_id, render=item)
        jobs.finish(job_id, status="done", message="场景图已生成")
    except jobs.JobCanceled:
        raise
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise RuntimeError(getattr(e, "detail", None) or str(e) or "场景出图失败")
    finally:
        db.close()


@router.post("/generate", status_code=201)
def generate_scene(req: SceneGenReq):
    if not req.appearance and not (req.free_prompt or "").strip():
        raise HTTPException(status_code=400, detail="场景拼装为空，至少选几个维度或写一句自由提示词")
    scene_name = ""
    if req.scene_id:
        # 先确认场景存在，别等线程里才报错
        from ..database import SessionLocal
        db = SessionLocal()
        try:
            sc = db.query(Scene).filter(Scene.id == req.scene_id).first()
            if not sc:
                raise HTTPException(status_code=404, detail="场景不存在")
            scene_name = sc.name
        finally:
            db.close()
    title = req.title or (f"场景出图 · {scene_name}" if scene_name else "场景出图")
    job = jobs.create("scene_render", title, page="scenes", total=1,
                      focus={"scene_id": req.scene_id, "tab": "assembly"})
    jobs.spawn(jobs.guard, job["id"], _scene_job, job["id"], req)
    return {"ok": True, "job_id": job["id"], "job": job}


@router.get("/{scene_id}/images")
def list_scene_images(scene_id: int, db: Session = Depends(get_db)):
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="场景不存在")
    rows = (db.query(SceneImage).filter(SceneImage.scene_id == scene_id)
            .order_by(SceneImage.id.desc()).all())
    return {"scene_id": scene_id, "scene_name": sc.name,
            "images": [{"id": r.id, "url": r.image_url, "prompt": r.prompt,
                        "negative": r.negative, "model_preset": r.model_preset,
                        "width": r.width, "height": r.height,
                        "appearance_id": r.appearance_id,
                        "appearance_name": r.appearance_name or "",
                        "created_at": r.created_at,
                        "is_cover": r.image_url == sc.background_image} for r in rows]}


@router.delete("/{scene_id}/images/{image_id}", status_code=200)
def delete_scene_image(scene_id: int, image_id: int, db: Session = Depends(get_db)):
    r = db.query(SceneImage).filter(SceneImage.id == image_id,
                                    SceneImage.scene_id == scene_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="图片记录不存在")
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if sc and sc.background_image == r.image_url:
        sc.background_image = None
    db.delete(r)
    db.commit()
    return {"ok": True}


# ===================== 人物 × 场景 合成 =====================
MAX_COMPOSE_CHARS = 6


def _resolve_one_character(db: Session, spec: ComposeCharacterReq):
    """取人物 + 一套外观（指定 → 默认 → 旧字段），并把动作套进外观。"""
    ch = db.query(Character).filter(Character.id == spec.character_id).first()
    if not ch:
        raise RuntimeError(f"人物 #{spec.character_id} 不存在")
    preset = None
    if spec.appearance_id:
        preset = db.query(CharacterAppearance).filter(
            CharacterAppearance.id == spec.appearance_id,
            CharacterAppearance.character_id == ch.id).first()
    if not preset:
        preset = (db.query(CharacterAppearance)
                  .filter(CharacterAppearance.character_id == ch.id)
                  .order_by(CharacterAppearance.is_default.desc(),
                            CharacterAppearance.sort, CharacterAppearance.id).first())
    if preset:
        try:
            app = json.loads(preset.appearance_json or "{}")
        except Exception:
            app = {}
    else:
        try:
            app = json.loads(ch.appearance_json or "{}")
        except Exception:
            app = {}
    if not app:
        raise RuntimeError(f"「{ch.name}」还没有外观配置，请先在人物管理里生成外观")
    app = _apply_pose({**app, "name": ch.name}, spec.pose_id)
    return ch, preset, app


def _compose_cast(db: Session, req: ComposeReq):
    """把请求里的（多）人物统一成列表：[(Character, preset, 外观 dict, 画面参数 dict)]。"""
    specs = list(req.characters or [])
    if not specs and req.character_id:
        specs = [ComposeCharacterReq(
            character_id=req.character_id, appearance_id=req.appearance_id,
            pose_id=req.pose_id, framing=req.framing,
            shot=req.shot, placement=req.placement)]
    if not specs:
        raise RuntimeError("至少要指定一个人物")
    if len(specs) > MAX_COMPOSE_CHARS:
        raise RuntimeError(f"一幕最多 {MAX_COMPOSE_CHARS} 个人物，再多画面会糊")
    out = []
    for spec in specs:
        ch, preset, app = _resolve_one_character(db, spec)
        out.append((ch, preset, app, {
            "name": ch.name,
            # 取景以内置为准：人物自己指定 > 外观配置自带 > 请求默认
            "framing": spec.framing or app.get("framing") or req.framing or "full",
            "shot": spec.shot or req.shot or "medium",
            "placement": spec.placement or req.placement or "center",
            "note": spec.note or "",
        }))
    return out


def _resolve_scene(db: Session, req: ComposeReq):
    """返回 (场景名, 场景拼装 dict)。请求里带了拼装就用请求的，否则读场景当前拼装。"""
    scene_app = dict(req.scene_appearance or {})
    scene_name = ""
    if req.scene_id:
        scene = db.query(Scene).filter(Scene.id == req.scene_id).first()
        if scene:
            scene_name = scene.name
            if not scene_app:
                try:
                    scene_app = json.loads(scene.appearance_json or "{}")
                except Exception:
                    scene_app = {}
    if not scene_app:
        raise RuntimeError("场景拼装为空：请选择一个场景，或先给场景做拼装配置")
    return scene_name, scene_app


def _compose_parts(cast, scene_app: dict, req: ComposeReq):
    """按人物列表拼提示词（多人各自成段 + 多人关系约束）。"""
    chars = [{
        "appearance": app,
        "name": view["name"],
        "framing": view["framing"],
        "shot": view["shot"],
        "placement": view["placement"],
        "note": view["note"],
    } for _ch, _preset, app, view in cast]
    return sgen.compose_prompt_multi(
        chars, scene_app, free_prompt=req.scene_prompt,
        shot=req.shot or "medium", placement=req.placement or "center",
        extra=req.extra or "", include_sensitive=req.include_sensitive)


def _compose_job(job_id, req: ComposeReq):
    from . import comfyui as comfyui_router
    from ..database import SessionLocal

    jobs.gate(job_id)
    db = SessionLocal()
    try:
        has_layout = bool(req.layout
                          and (req.layout.get("items") or req.layout.get("boxes")))
        try:
            cast = _compose_cast(db, req)
        except RuntimeError:
            if not has_layout:
                raise
            cast = []  # 纯布局模式：画面内容都在画框里，人物行可以不配
        names = "、".join(view["name"] for _c, _p, _a, view in cast)
        try:
            scene_name, scene_app = _resolve_scene(db, req)
        except RuntimeError:
            if not has_layout:
                raise
            scene_name, scene_app = "", {}

        parts = _compose_parts(cast, scene_app, req)
        positive, negative = parts["posCn"], parts["negCn"]
        width = int(req.width or 1344)
        height = int(req.height or 768)
        if req.layout and (req.layout.get("items") or req.layout.get("boxes")):
            # 画框布局：整段取代自动拼装（画布尺寸 = 出图尺寸）
            built = slayout.compile_layout(req.layout, width, height)
            if built.get("prompt"):
                positive = built["prompt"]
                width, height = built["width"], built["height"]
        if (req.prompt_override or "").strip():
            # 手改过的提示词优先：整段替换，负面仍用自动拼的那条
            positive = req.prompt_override.strip()
        first_ch = cast[0][0] if cast else None
        payload = comfyui_router.GenerateReq(
            positive=positive, negative=negative, mode="t2i", prompt_lang="cn",
            width=width, height=height, batch_size=1,
            # 步数 / CFG 由合成页参数面板显式传入，否则会退回全局参数（那不是本页改的值）
            steps=req.steps or None, cfg=req.cfg or None,
            filename_prefix="compose", model_preset=req.model_preset,
            use_active_model_preset=not req.model_preset, random_seed=True,
            ctx={"source": "compose", "asset_kind": "illustration",
                 "character_id": (first_ch.id if first_ch else None),
                 "character_name": names or "画框布局",
                 "subject_type": "character",
                 "subject_id": (first_ch.id if first_ch else None),
                 "subject_name": names or "画框布局", "category": "compose",
                 "scene_id": req.scene_id, "scene_name": scene_name,
                 "characters": names, "job_id": job_id},
        )
        # 暂停/取消时掐掉当前这张；暂停后继续会重跑这一张
        resp = None
        while True:
            jobs.gate(job_id)
            try:
                resp = comfyui_router.generate(payload)
                break
            except Exception:
                if jobs.is_canceled(job_id):
                    raise jobs.JobCanceled()
                if jobs.abort_now(job_id):
                    continue
                raise
        url = (resp.get("images") or [None])[0]
        if not url:
            raise RuntimeError("ComfyUI 未返回图片")
        meta = (resp.get("meta") or [{}])[0]
        item = {
            "url": url,
            "width": meta.get("width") or resp.get("width") or width,
            "height": meta.get("height") or resp.get("height") or height,
            "prompt": resp.get("positive") or positive,
            "negative": resp.get("negative") or negative,
            "model_preset": req.model_preset or "",
            "character_name": names,
            "scene_name": scene_name,
        }
        jobs.step(job_id, ok=True, result=item, image=url, message="合成图已生成")
        jobs.update(job_id, render=item)
        jobs.finish(job_id, status="done", message="合成图已生成")
    except jobs.JobCanceled:
        raise
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise RuntimeError(getattr(e, "detail", None) or str(e) or "合成失败")
    finally:
        db.close()


def _apply_pose(char_app: dict, pose_id: Optional[str]) -> dict:
    """把选中的动作套进人物外观（对话里存的动作 id 与动作库共用一套 id）。

    pose_id 为空 = 没指定，沿用外观配置自带的姿态；
    pose_id == "__none__" = 用户明确选了「无动作」，必须把外观自带的 pose 清掉，
    否则「选了无动作，提示词里还是有动作」。
    """
    out = dict(char_app or {})
    if pose_id == "__none__":
        out["pose"] = ""
        out["poseCategory"] = ""
        return out
    if not pose_id:
        return out
    from ..appearance import defs as adefs
    out["pose"] = pose_id
    o = adefs.option_of("pose", pose_id)
    if o:
        out["poseCategory"] = o.get("cat") or out.get("poseCategory")
    return out


@router.post("/compose/prompt")
def compose_prompt_preview(req: ComposeReq, db: Session = Depends(get_db)):
    """只算提示词，不出图 —— 合成页实时预览用（支持多人物）。"""
    try:
        cast = _compose_cast(db, req)
        scene_name, scene_app = _resolve_scene(db, req)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    parts = _compose_parts(cast, scene_app, req)
    first_preset = cast[0][1]
    return {
        "prompt": parts,
        "character_name": "、".join(v["name"] for _c, _p, _a, v in cast),
        "characters": [{"name": v["name"], "framing": v["framing"],
                        "placement": v["placement"],
                        "appearance_name": (p.name if p else "默认外观")}
                       for _c, p, _a, v in cast],
        "scene_name": scene_name,
        "appearance_name": first_preset.name if first_preset else "默认外观",
    }


def _submit_compose(req: ComposeReq, title: str = "") -> dict:
    """校验 + 建任务 + 起线程，立刻返回（请求不等出图）。"""
    job = jobs.create("compose_render", title, page="compose", total=1,
                      focus={"scene_id": req.scene_id})
    jobs.spawn(jobs.guard, job["id"], _compose_job, job["id"], req)
    return job


@router.post("/compose", status_code=201)
def compose(req: ComposeReq):
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        has_layout = bool(req.layout
                          and (req.layout.get("items") or req.layout.get("boxes")))
        try:
            cast = _compose_cast(db, req)
        except RuntimeError as e:
            if not has_layout:
                raise HTTPException(status_code=400, detail=str(e))
            cast = []
        if (not req.scene_id and not req.scene_appearance and not has_layout):
            raise HTTPException(status_code=400, detail="请选择场景或提供场景拼装配置")
        names = "、".join(v["name"] for _c, _p, _a, v in cast) or "画框布局"
        title = req.title or f"人物×场景 · {names}"
        focus_char = cast[0][0].id if cast else None
    finally:
        db.close()
    job = _submit_compose(req, title)
    jobs.update(job["id"], focus={"character_id": focus_char, "scene_id": req.scene_id})
    return {"ok": True, "job_id": job["id"], "job": jobs.get(job["id"]) or job}


@router.get("/compose/recent")
def compose_recent(limit: int = Query(24, ge=1, le=100), db: Session = Depends(get_db)):
    from ..models.asset import Asset
    rows = (db.query(Asset)
            .filter(Asset.source == "compose")
            .order_by(Asset.id.desc()).limit(limit).all())
    return {"items": [{"id": a.id, "url": a.url, "prompt": a.prompt,
                       "width": a.width, "height": a.height,
                       "character_name": a.subject_name,
                       "created_at": a.created_at} for a in rows]}


class CaptionReq(BaseModel):
    """画框描述自动填写：按人物/场景拼装各出一句话。"""
    model_config = ConfigDict(protected_namespaces=())
    characters: Optional[list[ComposeCharacterReq]] = None
    scene_id: Optional[int] = None
    scene_appearance: Optional[dict] = None


class LayoutCompileReq(BaseModel):
    """画框布局编译预览（不出图）。"""
    model_config = ConfigDict(protected_namespaces=())
    layout: Optional[dict] = None
    width: Optional[int] = None
    height: Optional[int] = None
    base_prompt: Optional[str] = None


@router.post("/compose/captions")
def compose_captions(req: CaptionReq, db: Session = Depends(get_db)):
    """画框描述自动填写：人物框用外观拼出一句话，场景框用场景拼装出一句话。"""
    from ..appearance import generator as char_gen
    out = {"characters": [], "scene_caption": "", "scene_name": ""}
    for spec in (req.characters or []):
        try:
            ch, _preset, app = _resolve_one_character(db, spec)
        except RuntimeError as e:
            out["characters"].append({"character_id": spec.character_id,
                                      "name": "", "caption": "", "error": str(e)})
            continue
        parts = char_gen.to_prompt_parts(app, include_sensitive=True, framing="full")
        out["characters"].append({
            "character_id": ch.id, "name": ch.name,
            "caption": slayout.merge_blocks(parts.get("posCn")),
        })
    scene_app = dict(req.scene_appearance or {})
    if req.scene_id:
        scene = db.query(Scene).filter(Scene.id == req.scene_id).first()
        if scene:
            out["scene_name"] = scene.name
            if not scene_app:
                try:
                    scene_app = json.loads(scene.appearance_json or "{}")
                except Exception:
                    scene_app = {}
    if scene_app:
        sp = sgen.build_prompt_blocks(scene_app, None)
        out["scene_caption"] = slayout.merge_blocks(
            sp.get("posCn"), drop_prefixes=("【画面】",))
    return out


@router.post("/compose/layout")
def compose_layout_preview(req: LayoutCompileReq):
    """画框布局 → MOSS 布局提示词（预览编译结果，不出图）。"""
    return slayout.compile_layout(req.layout or {}, req.width, req.height, req.base_prompt)


# ===================== 合成图配置（整套可复用方案） =====================
class ComposeConfigReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    name: Optional[str] = None
    scene_id: Optional[int] = None
    scene_appearance: Optional[dict] = None
    scene_prompt: Optional[str] = None
    characters: Optional[list[ComposeCharacterReq]] = None
    shot: Optional[str] = None
    placement: Optional[str] = None
    extra: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    model_preset: Optional[str] = None
    sort: Optional[int] = None
    # 边界框画布：相对坐标画框数组（画的时候用画布比例，编译时再乘出图尺寸）
    layout: Optional[dict] = None


def _cfg_chars(c: ComposeConfig) -> list[dict]:
    try:
        rows = json.loads(c.characters_json or "[]")
        return [r for r in rows if isinstance(r, dict)]
    except Exception:
        return []


def _cfg_scene_app(c: ComposeConfig) -> dict:
    try:
        v = json.loads(c.scene_appearance_json or "{}")
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _cfg_layout(c: ComposeConfig) -> dict:
    try:
        v = json.loads(c.layout_json or "{}")
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _cfg_dict(c: ComposeConfig) -> dict:
    chars = _cfg_chars(c)
    return {
        "id": c.id,
        "name": c.name,
        "scene_id": c.scene_id,
        "scene_appearance": _cfg_scene_app(c),
        "scene_prompt": c.scene_prompt or "",
        "characters": chars,
        "character_count": len(chars),
        "shot": c.shot or "medium",
        "placement": c.placement or "center",
        "extra": c.extra or "",
        "width": c.width,
        "height": c.height,
        "model_preset": c.model_preset or "",
        "sort": c.sort,
        "layout": _cfg_layout(c),
        "updated_at": c.updated_at,
    }


def _write_cfg(c: ComposeConfig, req: ComposeConfigReq, is_new: bool):
    if req.name is not None and req.name.strip():
        c.name = req.name.strip()[:80]
    elif is_new and not c.name:
        c.name = "合成配置"
    if req.scene_id is not None:
        c.scene_id = req.scene_id or None
    if req.scene_appearance is not None:
        c.scene_appearance_json = json.dumps(req.scene_appearance, ensure_ascii=False)
    if req.scene_prompt is not None:
        c.scene_prompt = req.scene_prompt
    if req.characters is not None:
        c.characters_json = json.dumps(
            [x.model_dump(exclude_none=True) for x in req.characters], ensure_ascii=False)
    for field in ("shot", "placement"):
        v = getattr(req, field)
        if v:
            setattr(c, field, v)
    if req.extra is not None:
        c.extra = req.extra
    if req.width is not None:
        c.width = req.width or None
    if req.height is not None:
        c.height = req.height or None
    if req.model_preset is not None:
        c.model_preset = req.model_preset or None
    if req.layout is not None:
        # 空布局也允许写入（用户把框全删了）
        c.layout_json = json.dumps(req.layout, ensure_ascii=False)
    if req.sort is not None:
        c.sort = req.sort
    c.updated_at = datetime.now().isoformat()


def _cfg_to_compose_req(c: ComposeConfig, width=None, height=None,
                        model_preset=None, steps=None, cfg=None) -> ComposeReq:
    """把一条配置翻译成出图请求（配置只负责产出提示词）。"""
    chars = []
    for x in _cfg_chars(c):
        try:
            chars.append(ComposeCharacterReq(**x))
        except Exception:
            continue
    return ComposeReq(
        characters=chars or None,
        scene_id=c.scene_id,
        scene_appearance=_cfg_scene_app(c) or None,
        scene_prompt=c.scene_prompt,
        shot=c.shot or "medium",
        placement=c.placement or "center",
        extra=c.extra,
        width=width or c.width,
        height=height or c.height,
        steps=steps, cfg=cfg,
        model_preset=model_preset or c.model_preset,
        layout=_cfg_layout(c) or None,
        title=f"合成 · {c.name}",
    )


@router.get("/compose/configs")
def list_compose_configs(db: Session = Depends(get_db)):
    rows = (db.query(ComposeConfig)
            .order_by(ComposeConfig.sort, ComposeConfig.id).all())
    return {"items": [_cfg_dict(c) for c in rows]}


@router.post("/compose/configs", status_code=201)
def create_compose_config(req: ComposeConfigReq, db: Session = Depends(get_db)):
    n = db.query(ComposeConfig).count()
    c = ComposeConfig(name=(req.name or "").strip() or f"合成配置 {n + 1}",
                      sort=n)
    _write_cfg(c, req, is_new=True)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _cfg_dict(c)


@router.put("/compose/configs/{cid}")
def update_compose_config(cid: int, req: ComposeConfigReq,
                          db: Session = Depends(get_db)):
    c = db.query(ComposeConfig).filter(ComposeConfig.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="合成配置不存在")
    _write_cfg(c, req, is_new=False)
    db.commit()
    db.refresh(c)
    return _cfg_dict(c)


@router.delete("/compose/configs/{cid}", status_code=200)
def delete_compose_config(cid: int, db: Session = Depends(get_db)):
    c = db.query(ComposeConfig).filter(ComposeConfig.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="合成配置不存在")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/compose/configs/{cid}/copy", status_code=201)
def copy_compose_config(cid: int, db: Session = Depends(get_db)):
    """复制一条配置：在它后面插一条同名 + 副本，方便「同一幕换个角度」。"""
    src = db.query(ComposeConfig).filter(ComposeConfig.id == cid).first()
    if not src:
        raise HTTPException(status_code=404, detail="合成配置不存在")
    dup = ComposeConfig(
        name=(src.name or "合成配置")[:66] + " 副本",
        scene_id=src.scene_id,
        scene_appearance_json=src.scene_appearance_json,
        scene_prompt=src.scene_prompt,
        characters_json=src.characters_json,
        shot=src.shot, placement=src.placement, extra=src.extra,
        width=src.width, height=src.height, model_preset=src.model_preset,
        layout_json=src.layout_json,
        sort=(src.sort or 0) + 1,
    )
    # 后面的往下挪一位，保证顺序稳定
    (db.query(ComposeConfig)
     .filter(ComposeConfig.sort > (src.sort or 0))
     .update({ComposeConfig.sort: ComposeConfig.sort + 1}, synchronize_session=False))
    db.add(dup)
    db.commit()
    db.refresh(dup)
    return _cfg_dict(dup)


class ComposeBatchReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    ids: list[int] = []
    width: Optional[int] = None
    height: Optional[int] = None
    model_preset: Optional[str] = None
    steps: Optional[int] = None
    cfg: Optional[float] = None
    # {配置 id: 手改后的提示词} —— 只对本次提交生效
    prompts: Optional[dict] = None


@router.post("/compose/batch", status_code=201)
def compose_batch(req: ComposeBatchReq, db: Session = Depends(get_db)):
    """勾选多条配置 → 逐条建任务，立刻返回；剩下的交给任务队列排队。"""
    if not req.ids:
        raise HTTPException(status_code=400, detail="先勾选要生成的合成配置")
    rows = db.query(ComposeConfig).filter(ComposeConfig.id.in_(req.ids)).all()
    by_id = {r.id: r for r in rows}
    submitted, skipped = [], []
    for cid in req.ids:
        c = by_id.get(cid)
        if not c:
            skipped.append({"id": cid, "name": "", "reason": "配置不存在"})
            continue
        creq = _cfg_to_compose_req(c, req.width, req.height, req.model_preset,
                                   req.steps, req.cfg)
        # 手改过的提示词（本次提交临时覆盖，不写库）
        ov = (req.prompts or {}).get(str(cid)) or (req.prompts or {}).get(cid)
        if isinstance(ov, str) and ov.strip():
            creq.prompt_override = ov.strip()
        reason = ""
        has_layout = bool(creq.layout
                          and (creq.layout.get("items") or creq.layout.get("boxes")))
        if not has_layout:
            # 纯画框布局时框里已经写清楚了画面内容，人物/场景可以缺省
            if not creq.characters:
                reason = "配置里还没有人物"
            elif not creq.scene_id and not creq.scene_appearance:
                reason = "配置里还没有场景"
        if reason:
            skipped.append({"id": cid, "name": c.name, "reason": reason})
            continue
        job = _submit_compose(creq, f"合成 · {c.name}")
        submitted.append({"id": cid, "name": c.name, "job_id": job["id"],
                          "title": job["title"]})
    return {"ok": True, "count": len(submitted),
            "submitted": submitted, "skipped": skipped}


# ===================== 定义管理 =====================
@router.get("/manage/raw")
def manage_raw():
    return sdefs.data()


@router.post("/manage/reset")
def manage_reset():
    return {"ok": True, "version": sdefs.reset().get("version")}


class GroupReq(BaseModel):
    id: Optional[str] = None
    name: str
    icon: Optional[str] = ""


class DimReq(BaseModel):
    id: Optional[str] = None
    name: str
    group: str = "place"


class OptionReq(BaseModel):
    id: Optional[str] = None
    name: str
    cn: Optional[str] = ""


class ThemeReq(BaseModel):
    id: Optional[str] = None
    name: str
    desc: Optional[str] = ""
    cn: Optional[str] = ""
    colors: Optional[list[str]] = None
    pools: Optional[dict] = None


@router.post("/manage/groups", status_code=201)
def create_group(req: GroupReq):
    gid = req.id or ("g" + str(int(time.time())))
    if any(g["id"] == gid for g in sdefs.groups()):
        raise HTTPException(status_code=400, detail="分组 id 已存在")
    sdefs.upsert_group({"id": gid, "name": req.name, "icon": req.icon or ""})
    return {"id": gid, "ok": True}


@router.put("/manage/groups/{gid}")
def update_group(gid: str, req: GroupReq):
    sdefs.upsert_group({"id": gid, "name": req.name, "icon": req.icon or ""})
    return {"ok": True}


@router.delete("/manage/groups/{gid}")
def delete_group(gid: str):
    if not sdefs.delete_group(gid):
        raise HTTPException(status_code=404, detail="分组不存在")
    return {"ok": True}


@router.post("/manage/dims", status_code=201)
def create_dim(req: DimReq):
    did = req.id or ("d" + str(int(time.time())))
    if sdefs.dim_by_id(did):
        raise HTTPException(status_code=400, detail="维度 id 已存在")
    sdefs.upsert_dim({"id": did, "name": req.name, "group": req.group, "options": []})
    return {"id": did, "ok": True}


@router.put("/manage/dims/{dim_id}")
def update_dim(dim_id: str, req: DimReq):
    cur = sdefs.dim_by_id(dim_id)
    if not cur:
        raise HTTPException(status_code=404, detail="维度不存在")
    sdefs.upsert_dim({**cur, "name": req.name, "group": req.group})
    return {"ok": True}


@router.delete("/manage/dims/{dim_id}")
def delete_dim(dim_id: str):
    if not sdefs.delete_dim(dim_id):
        raise HTTPException(status_code=404, detail="维度不存在")
    return {"ok": True}


@router.post("/manage/dims/{dim_id}/options", status_code=201)
def create_option(dim_id: str, req: OptionReq):
    if not sdefs.dim_by_id(dim_id):
        raise HTTPException(status_code=404, detail="维度不存在")
    oid = req.id or ("o" + str(int(time.time() * 1000)))
    if sdefs.option_of(dim_id, oid):
        raise HTTPException(status_code=400, detail="选项 id 已存在")
    sdefs.upsert_option(dim_id, {"id": oid, "name": req.name, "cn": req.cn or ""})
    return {"id": oid, "ok": True}


@router.put("/manage/dims/{dim_id}/options/{opt_id}")
def update_option(dim_id: str, opt_id: str, req: OptionReq):
    cur = sdefs.option_of(dim_id, opt_id)
    if not cur:
        raise HTTPException(status_code=404, detail="选项不存在")
    sdefs.upsert_option(dim_id, {**cur, "name": req.name, "cn": req.cn or ""})
    return {"ok": True}


@router.delete("/manage/dims/{dim_id}/options/{opt_id}")
def delete_option(dim_id: str, opt_id: str):
    if not sdefs.delete_option(dim_id, opt_id):
        raise HTTPException(status_code=404, detail="选项不存在")
    return {"ok": True}


@router.post("/manage/dims/{dim_id}/options/{opt_id}/move")
def move_option(dim_id: str, opt_id: str, req: dict):
    return {"ok": sdefs.move_option(dim_id, opt_id, int(req.get("delta") or 1))}


@router.post("/manage/themes", status_code=201)
def create_theme(req: ThemeReq):
    tid = req.id or ("t" + str(int(time.time())))
    if sdefs.theme_by_id(tid):
        raise HTTPException(status_code=400, detail="题材 id 已存在")
    sdefs.upsert_theme({"id": tid, "name": req.name, "desc": req.desc or "",
                        "cn": req.cn or "", "colors": req.colors or [],
                        "pools": req.pools or {}})
    return {"id": tid, "ok": True}


@router.put("/manage/themes/{tid}")
def update_theme(tid: str, req: ThemeReq):
    cur = sdefs.theme_by_id(tid)
    if not cur:
        raise HTTPException(status_code=404, detail="题材不存在")
    sdefs.upsert_theme({**cur, "name": req.name, "desc": req.desc or "",
                        "cn": req.cn or "",
                        "colors": req.colors if req.colors is not None else cur.get("colors") or [],
                        "pools": req.pools if req.pools is not None else cur.get("pools") or {}})
    return {"ok": True}


@router.delete("/manage/themes/{tid}")
def delete_theme(tid: str):
    if not sdefs.delete_theme(tid):
        raise HTTPException(status_code=404, detail="题材不存在")
    return {"ok": True}
