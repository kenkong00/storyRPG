# -*- coding: utf-8 -*-
"""
后台任务查询 + 控制（暂停 / 继续 / 取消 / 删除）+「按外观出立绘」。

为什么要有任务：
    ComfyUI 一张图 40~90 秒，批量十张就是十几分钟。同步请求一旦发出，用户切到
    别的栏目就看不到任何进展，回来还得刷新才见结果。改成任务制后：
      · 顶栏任务图标 + 左侧栏常驻进度（轮询 /api/jobs），切页也知道后台在跑
      · 任务面板里可以暂停 / 继续 / 取消 / 删除
      · 页面自己轮询 /api/jobs/{id}，出完一张就能立刻塞进画廊
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, HTTPException

from .. import jobs

router = APIRouter(prefix="/api", tags=["后台任务"])


class RenderAppearanceReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    appearance: dict = {}
    # 用户在提示词框里手改过的文本：传了就用它出图（不再走外观拼装）
    positive: Optional[str] = None
    negative: Optional[str] = None
    include_sensitive: bool = False
    width: Optional[int] = None
    height: Optional[int] = None
    model_preset: Optional[str] = None
    filename_prefix: str = "render"
    page: str = "character_appearance"
    title: str = "立绘生成"
    # 可选：把这次出图挂到某个人物名下（拼装页出立绘时传）
    character_id: Optional[int] = None
    character_name: Optional[str] = None


# ===================== 查询 =====================
@router.get("/jobs")
def list_jobs(only_active: bool = False, category: Optional[str] = None):
    items = jobs.active() if only_active else jobs.list_jobs()
    if category and category not in ("", "all"):
        items = [j for j in items if j.get("category") == category]
    c = jobs.counts()
    return {
        "jobs": items,
        # 转圈用：只有「真在跑」才算运行；暂停单独一个数，图标换成暂停样式
        "active": c.get("running", 0),
        "paused": c.get("paused", 0),
        "queued": c.get("queued", 0),
        "counts": c,
        # 分类标签上的小数字：{audio: {live:2, running:1, paused:1}, image: {...}}
        "by_category": jobs.category_counts(),
        "category_labels": jobs.CATEGORY_LABEL,
        "category_order": list(jobs.CATEGORY_ORDER),
    }


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return j


# ===================== 控制 =====================
@router.post("/jobs/clear")
def clear_jobs():
    return {"ok": True, "removed": jobs.clear_finished()}


@router.post("/jobs/pause-all")
def pause_all():
    return {"ok": True, "n": jobs.pause_all()}


@router.post("/jobs/resume-all")
def resume_all():
    return {"ok": True, "n": jobs.resume_all()}


@router.post("/jobs/cancel-all")
def cancel_all():
    """全部取消：停止并清空所有运行中 / 等待中 / 已暂停的任务。"""
    return {"ok": True, "n": jobs.cancel_all()}


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: str):
    if not jobs.get(job_id):
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    ok = jobs.request_pause(job_id)
    return {"ok": ok, "job": jobs.get(job_id)}


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: str):
    if not jobs.get(job_id):
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    ok = jobs.request_resume(job_id)
    return {"ok": ok, "job": jobs.get(job_id)}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    if not jobs.get(job_id):
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    ok = jobs.request_cancel(job_id)
    return {"ok": ok, "job": jobs.get(job_id)}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    if not jobs.get(job_id):
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return {"ok": jobs.remove(job_id)}


# ===================== 按外观出立绘 =====================
def _run_render(job_id: str, appearance: dict, req: RenderAppearanceReq):
    from . import comfyui as comfyui_router
    from ..appearance import generator as appearance_generator
    jobs.gate(job_id)
    # 立绘出图与「外观配置」面板保持所见即所得：提示词只取纯外观维度，
    # 不掺入【动作表情】与【画面/取景】（那两段属于动作表情模块与渲染指令）。
    positive = (req.positive or "").strip()
    if not positive and appearance:
        positive = appearance_generator.to_prompt(
            appearance, include_sensitive=req.include_sensitive,
            framing=appearance.get("framing"), include_pose=False, include_scene=False)
    # 全局出图参数（步数 / CFG / 种子 / 随机 / 批量张数）同样作用于立绘 / 场景出图，
    # 让「设置页改一处、所有出图入口同步生效」。
    try:
        from ..comfyui.config_store import ComfyUIConfigStore
        ggp = ComfyUIConfigStore().get_gen_params("global")
    except Exception:  # noqa: BLE001
        ggp = {}
    _seed_mode = (ggp.get("seed_mode") or "random")
    _random = _seed_mode != "fixed"
    _seed = None if _random else int(ggp.get("seed") if ggp.get("seed") is not None else 0)
    payload = comfyui_router.GenerateReq(
        appearance=appearance,
        positive=(positive or None),
        negative=req.negative or None,
        mode="t2i",
        include_sensitive=req.include_sensitive,
        prompt_lang="cn",
        width=req.width,
        height=req.height,
        steps=int(ggp.get("steps") or 0) or None,
        cfg=float(ggp.get("cfg") or 0) or None,
        seed=_seed,
        seed_mode=_seed_mode,
        batch_size=max(1, int(ggp.get("count") or 1)),
        filename_prefix=req.filename_prefix or "render",
        model_preset=req.model_preset,
        use_active_model_preset=not req.model_preset,
        random_seed=_random,
        ctx={"source": "appearance_render", "character_id": req.character_id,
             "character_name": req.character_name, "job_id": job_id},
    )
    resp = comfyui_router.generate(payload)
    jobs.gate(job_id)
    url = (resp.get("images") or [None])[0]
    if not url:
        raise RuntimeError("ComfyUI 未返回图片")
    meta = (resp.get("meta") or [{}])[0]
    item = {
        "url": url,
        "width": meta.get("width") or resp.get("width"),
        "height": meta.get("height") or resp.get("height"),
        "prompt": resp.get("positive"),
        "model_preset": req.model_preset or "",
    }
    jobs.step(job_id, ok=True, result=item, image=url, message="已生成立绘")
    jobs.update(job_id, render=item)
    jobs.finish(job_id, status="done", message="立绘已生成")


@router.post("/render/appearance", status_code=201)
def render_appearance(req: RenderAppearanceReq):
    if not req.appearance and not (req.positive or "").strip():
        raise HTTPException(status_code=400, detail="缺少外观数据或提示词")
    job = jobs.create("appearance_render", req.title or "立绘生成",
                      page=req.page or "character_appearance", total=1)
    jobs.spawn(jobs.guard, job["id"], _run_render, job["id"], req.appearance, req)
    return {"ok": True, "job_id": job["id"], "job": job}
