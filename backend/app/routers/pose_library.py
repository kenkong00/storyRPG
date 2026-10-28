# -*- coding: utf-8 -*-
"""
动作表情库路由。

两层能力：
1) 库管理（增删改分类与动作条目）—— 直接改写 appearance_defs.json 的 pose / poseCategory 维度；
2) 人物动作表情图（按人物 × 动作存图，供对话与战斗按场景取图）。

批量生成逻辑：同一份外观 + 逐个替换动作 → 出「穿着相同、动作不同」的一组图。
"""

import json
import random
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.character_appearance import CharacterAppearance
from ..models.character_pose import CharacterPoseImage
from ..appearance import defs, generator
from .. import jobs

router = APIRouter(prefix="/api/poses", tags=["动作表情库"])
char_router = APIRouter(prefix="/api/characters", tags=["动作表情-人物"])

# 动作 → 游戏引擎读取的旧表情键（战斗 / 对话立绘用 characters.expressions）。
# 出图后自动回写，这样「表情」被合并进「动作表情」后，战斗与对话仍然拿得到图。
POSE_EXPR_KEY = {
    "idle_stand": "normal",
    "emo_smile": "happy", "emo_laugh": "happy", "emo_gentle": "happy",
    "emo_angry": "angry",
    "emo_sad": "sad", "emo_cry": "crying",
    "emo_surprise": "surprised",
    "emo_fear": "shocked",
    "emo_determined": "determined",
    "emo_smug": "arrogant",
    "emo_cold": "confident",
    "emo_pain": "desperate",
    "emo_tired": "defeated",
    "battle_afterHit": "defeated",
    "battle_roar": "confident",
    "love_confess": "shy",
}


def _sync_expression(ch: Character, pose_id, url, db: Session):
    key = POSE_EXPR_KEY.get(pose_id)
    if not url:
        return
    try:
        faces = json.loads(ch.expressions) if ch.expressions else {}
        if not isinstance(faces, dict):
            faces = {}
    except Exception:
        faces = {}
    # 动作 id 也直接作为键写一份 —— 对话/战报里存的是动作 id 时，
    # 前端按 expressions[pose_id] 就能拿到同一张图，不再只认旧的表情键。
    faces[pose_id] = url
    if key:
        faces[key] = url
    ch.expressions = json.dumps(faces, ensure_ascii=False)
    db.commit()


# ===================== 请求体 =====================
class CategoryReq(BaseModel):
    id: Optional[str] = None
    name: str
    desc: Optional[str] = ""


class PoseReq(BaseModel):
    id: Optional[str] = None
    name: str
    cat: str
    cn: str = ""          # 动作表情描述（生成提示词时直接使用）
    tags: Optional[list[str]] = None


class MoveReq(BaseModel):
    delta: int = 1


class AttachReq(BaseModel):
    pose_id: Optional[str] = None
    pose_name: Optional[str] = None
    category: Optional[str] = None
    image_url: str


class PoseGenReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    pose_ids: Optional[list[str]] = None   # 指定动作（精确出图）
    category: Optional[str] = None         # 或按分类随机抽
    count: int = 1                         # 配合 category 使用
    model_preset: Optional[str] = None
    use_active_model_preset: bool = True
    width: Optional[int] = None            # 留空 = 全局出图参数
    height: Optional[int] = None
    include_sensitive: bool = False
    timeout_sec: Optional[int] = None
    extra_negative: Optional[str] = None
    # 用角色的哪一套外观配置；不传 = 默认外观
    appearance_id: Optional[int] = None
    # full 全身 / half 半身（腰部以上）
    framing: Optional[str] = None
    page: str = "characters"
    title: str = ""


# ===================== 库读取 =====================
def _pose_dim():
    d = defs.dim_by_id("pose")
    if not d:
        raise HTTPException(status_code=500, detail="动作维度缺失，请先恢复默认定义")
    return d


@router.get("/library")
def get_library():
    cats = defs.pose_categories()
    poses = _pose_dim().get("options") or []
    counts = {}
    for p in poses:
        counts[p.get("cat") or ""] = counts.get(p.get("cat") or "", 0) + 1
    return {
        "categories": [{**c, "count": counts.get(c["id"], 0)} for c in cats],
        "poses": [{"id": p["id"], "name": p.get("name", p["id"]),
                   "cat": p.get("cat") or "", "cn": p.get("cn") or "",
                   "duo": "duo" in (p.get("tags") or [])} for p in poses],
        "total": len(poses),
    }


# ===================== 库管理：分类 =====================
@router.post("/categories", status_code=201)
def create_category(req: CategoryReq):
    cid = req.id or ("c" + datetime.now().strftime("%y%m%d%H%M%S"))
    if any(c["id"] == cid for c in defs.pose_categories()):
        raise HTTPException(status_code=400, detail="分类 id 已存在")
    defs.upsert_pose_category({"id": cid, "name": req.name, "desc": req.desc or ""})
    # 同步到 poseCategory 维度的选项，前端下拉才拿得到
    defs.upsert_option("poseCategory", {"id": cid, "name": req.name, "cat": cid})
    return {"id": cid, "ok": True}


@router.put("/categories/{cat_id}")
def update_category(cat_id: str, req: CategoryReq):
    cur = next((c for c in defs.pose_categories() if c["id"] == cat_id), None)
    if not cur:
        raise HTTPException(status_code=404, detail="分类不存在")
    defs.upsert_pose_category({"id": cat_id, "name": req.name, "desc": req.desc or ""})
    defs.upsert_option("poseCategory", {"id": cat_id, "name": req.name, "cat": cat_id})
    return {"ok": True}


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: str):
    if not defs.delete_pose_category(cat_id):
        raise HTTPException(status_code=404, detail="分类不存在")
    return {"ok": True}


# ===================== 库管理：动作条目 =====================
@router.post("/items", status_code=201)
def create_pose(req: PoseReq):
    pid = req.id or ("p" + datetime.now().strftime("%y%m%d%H%M%S%f")[:18])
    if defs.option_of("pose", pid):
        raise HTTPException(status_code=400, detail="动作 id 已存在")
    defs.upsert_option("pose", {
        "id": pid, "name": req.name, "cat": req.cat,
        "cn": req.cn, "tags": req.tags or [req.cat],
    })
    return {"id": pid, "ok": True}


@router.put("/items/{pose_id}")
def update_pose(pose_id: str, req: PoseReq):
    cur = defs.option_of("pose", pose_id)
    if not cur:
        raise HTTPException(status_code=404, detail="动作不存在")
    defs.upsert_option("pose", {
        **cur, "name": req.name, "cat": req.cat, "cn": req.cn,
    })
    return {"ok": True}


@router.delete("/items/{pose_id}")
def delete_pose(pose_id: str):
    if not defs.delete_option("pose", pose_id):
        raise HTTPException(status_code=404, detail="动作不存在")
    return {"ok": True}


@router.post("/items/{pose_id}/move")
def move_pose(pose_id: str, req: MoveReq):
    return {"ok": defs.move_option("pose", pose_id, req.delta)}


# ===================== 人物动作表情图 =====================
def _get_char(db: Session, cid: int) -> Character:
    ch = db.query(Character).filter(Character.id == cid).first()
    if not ch:
        raise HTTPException(status_code=404, detail="人物不存在")
    return ch


def _load_appearance(ch: Character) -> dict:
    if not ch.appearance_json:
        return {}
    try:
        return json.loads(ch.appearance_json)
    except Exception:
        return {}


def _img_dict(img: CharacterPoseImage):
    return {
        "id": img.id, "character_id": img.character_id,
        "pose_id": img.pose_id, "pose_name": img.pose_name,
        "category": img.category, "image_url": img.image_url,
        "appearance_id": img.appearance_id,
        "appearance_name": img.appearance_name,
        "framing": img.framing or "full",
        "model_preset": img.model_preset, "seed": img.seed,
        "width": img.width, "height": img.height,
        "prompt": img.prompt,
        "created_at": img.created_at,
    }


@char_router.get("/{cid}/poses")
def list_pose_images(cid: int, category: Optional[str] = Query(None),
                     appearance_id: Optional[int] = Query(None),
                     db: Session = Depends(get_db)):
    _get_char(db, cid)
    q = db.query(CharacterPoseImage).filter(CharacterPoseImage.character_id == cid)
    if category:
        q = q.filter(CharacterPoseImage.category == category)
    if appearance_id:
        q = q.filter(CharacterPoseImage.appearance_id == appearance_id)
    imgs = q.order_by(CharacterPoseImage.id.desc()).all()
    # 覆盖率：哪些动作已经出过图
    covered = {}
    for i in imgs:
        if i.pose_id:
            covered.setdefault(i.pose_id, 0)
            covered[i.pose_id] += 1
    return {"images": [_img_dict(i) for i in imgs], "covered": covered}


@char_router.delete("/{cid}/poses/{image_id}", status_code=200)
def delete_pose_image(cid: int, image_id: int, db: Session = Depends(get_db)):
    img = db.query(CharacterPoseImage).filter(
        CharacterPoseImage.id == image_id,
        CharacterPoseImage.character_id == cid).first()
    if not img:
        raise HTTPException(status_code=404, detail="图片记录不存在")
    db.delete(img)
    db.commit()
    return {"ok": True}


@char_router.post("/{cid}/poses/attach", status_code=201)
def attach_pose_image(cid: int, req: AttachReq, db: Session = Depends(get_db)):
    """把已有图片（例如从图库挑的）挂到某个动作上。"""
    _get_char(db, cid)
    pose = defs.option_of("pose", req.pose_id) if req.pose_id else None
    img = CharacterPoseImage(
        character_id=cid,
        pose_id=req.pose_id,
        pose_name=req.pose_name or (pose or {}).get("name") or req.pose_id,
        category=req.category or (pose or {}).get("cat") or "",
        image_url=req.image_url,
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    return _img_dict(img)


@char_router.post("/{cid}/poses/generate")
def generate_pose_images(cid: int, req: PoseGenReq, db: Session = Depends(get_db)):
    """同一人物外观 + 逐个动作 → 批量出图（穿着一致、动作不同）。

    改成任务制：立刻返回 job_id，真正的出图在后台线程里一张一张做。
    这样切到别的栏目也能在左侧栏看到进度，回来时图片已经在了。
    """
    ch = _get_char(db, cid)
    preset = None
    if req.appearance_id:
        preset = db.query(CharacterAppearance).filter(
            CharacterAppearance.id == req.appearance_id,
            CharacterAppearance.character_id == cid).first()
        if not preset:
            raise HTTPException(status_code=404, detail="外观配置不存在")
    else:
        # 没指定就用默认配置，并把 id 记进出图记录 —— 这样「按外观配置筛图」不会把默认装漏掉
        preset = (db.query(CharacterAppearance)
                  .filter(CharacterAppearance.character_id == cid)
                  .order_by(CharacterAppearance.is_default.desc(),
                            CharacterAppearance.sort, CharacterAppearance.id).first())
    if preset:
        try:
            appearance = json.loads(preset.appearance_json or "{}")
        except Exception:
            appearance = {}
        if not appearance:
            appearance = _load_appearance(ch)
    else:
        appearance = _load_appearance(ch)
    if not appearance:
        raise HTTPException(status_code=400,
                            detail="该人物还没有外观数据，请先到「人物外观拼装」生成并保存")
    framing = req.framing or appearance.get("framing") or "full"
    appearance = {**appearance, "framing": framing}
    preset_name = preset.name if preset else "默认外观"
    if preset and not req.appearance_id:
        req = req.model_copy(update={"appearance_id": preset.id})

    pose_dim = _pose_dim()
    all_poses = {p["id"]: p for p in (pose_dim.get("options") or [])}

    # 目标动作集合
    target_ids = []
    if req.pose_ids:
        target_ids = [p for p in req.pose_ids if p in all_poses]
    elif req.category:
        # 双人动作（拥抱/跨坐…）单人出图会变成抱着空气，随机抽样时排除
        pool = [p["id"] for p in all_poses.values()
                if (p.get("cat") or "") == req.category
                and "duo" not in (p.get("tags") or [])]
        if not pool:
            raise HTTPException(status_code=400, detail=f"分类「{req.category}」下没有动作")
        n = max(1, min(req.count, len(pool)))
        target_ids = random.sample(pool, n)
    if not target_ids:
        raise HTTPException(status_code=400, detail="请指定 pose_ids 或 category + count")

    title = req.title or f"{ch.name} · {preset_name} · 动作表情 ×{len(target_ids)}"
    job = jobs.create("pose_batch", title, page=req.page or "characters",
                      total=len(target_ids),
                      focus={"character_id": cid, "tab": "pose", "character_name": ch.name,
                             "appearance_id": preset.id if preset else None,
                             "appearance_name": preset_name})
    jobs.spawn(jobs.guard, job["id"], _run_pose_batch, job["id"], cid,
               ch.name, appearance, target_ids, req, preset_name)
    return {"ok": True, "job": job, "job_id": job["id"], "total": len(target_ids),
            "appearance_id": preset.id if preset else None, "appearance_name": preset_name}


def _run_pose_batch(job_id: str, cid: int, char_name: str, appearance: dict,
                    target_ids: list[str], req: PoseGenReq, appearance_name: str = "默认外观"):
    """后台线程：逐张出图并落库，每完成一张就推进任务进度。"""
    from . import comfyui as comfyui_router
    from ..database import SessionLocal

    db = SessionLocal()
    ok_count = 0
    try:
        pose_dim = _pose_dim()
        all_poses = {p["id"]: p for p in (pose_dim.get("options") or [])}
        ch = db.query(Character).filter(Character.id == cid).first()
        for pid in target_ids:
            pose = all_poses.get(pid) or {"id": pid, "name": pid, "cat": ""}
            ap = {**appearance, "pose": pid, "poseCategory": pose.get("cat") or "",
                  "name": char_name}
            payload = comfyui_router.GenerateReq(
                appearance=ap,
                mode="t2i",
                include_sensitive=req.include_sensitive,
                prompt_lang="cn",
                width=req.width, height=req.height,
                batch_size=1,
                filename_prefix=f"pose_{cid}_{pid}",
                model_preset=req.model_preset,
                use_active_model_preset=req.use_active_model_preset,
                random_seed=True,
                timeout_sec=req.timeout_sec,
                ctx={"source": "pose_batch", "character_id": cid,
                     "character_name": char_name, "pose_id": pid,
                     "pose_name": pose.get("name"), "category": pose.get("cat") or "",
                     "job_id": job_id},
            )

            # ---- 出这一张：被暂停打断就等继续后重跑同一张，被取消就直接退出 ----
            resp = None
            while True:
                jobs.gate(job_id)          # 取消 → 抛 JobCanceled；暂停 → 原地等
                try:
                    resp = comfyui_router.generate(payload)
                    break
                except Exception as e:      # noqa: BLE001
                    db.rollback()
                    if jobs.abort_now(job_id):
                        # 是我们自己掐断的（暂停或取消），不算失败
                        if jobs.is_canceled(job_id):
                            raise jobs.JobCanceled()
                        continue            # 暂停中：gate 会拦住，继续后重跑这一张
                    detail = getattr(e, "detail", None) or str(e)
                    jobs.step(job_id, ok=False,
                              result={"pose_id": pid, "ok": False, "error": str(detail)},
                              message=f"{char_name}：{pose.get('name') or pid} 失败")
                    break

            if resp is None:
                continue

            try:
                url = (resp.get("images") or [None])[0]
                if not url:
                    jobs.step(job_id, ok=False,
                              result={"pose_id": pid, "ok": False, "error": "未返回图片"})
                    continue
                meta = (resp.get("meta") or [{}])[0]
                img = CharacterPoseImage(
                    character_id=cid, pose_id=pid,
                    pose_name=pose.get("name"), category=pose.get("cat") or "",
                    image_url=url, prompt=resp.get("positive"),
                    appearance_id=req.appearance_id,
                    appearance_name=appearance_name,
                    framing=appearance.get("framing") or "full",
                    model_preset=req.model_preset,
                    width=meta.get("width") or resp.get("width"),
                    height=meta.get("height") or resp.get("height"),
                )
                db.add(img)
                db.commit()
                db.refresh(img)
                if ch:
                    _sync_expression(ch, pid, url, db)
                ok_count += 1
                jobs.step(job_id, ok=True, image=url,
                          result={"pose_id": pid, "pose_name": pose.get("name"),
                                  "ok": True, "image": url,
                                  "width": img.width, "height": img.height,
                                  "prompt": img.prompt},
                          message=f"{char_name}：{pose.get('name') or pid}")
            except jobs.JobCanceled:
                raise
            except Exception as e:  # noqa: BLE001
                db.rollback()
                jobs.step(job_id, ok=False,
                          result={"pose_id": pid, "ok": False, "error": str(e)})
        if ok_count == len(target_ids):
            jobs.finish(job_id, status="done", message=f"完成 {ok_count} 张")
        elif ok_count:
            jobs.finish(job_id, status="partial", message=f"成功 {ok_count}/{len(target_ids)} 张")
        else:
            jobs.finish(job_id, status="error", message="全部失败")
    finally:
        db.close()
