# -*- coding: utf-8 -*-
"""
ComfyUI 接入路由（完整移植自「windows轻量AI桌面助手 5.0」的 ComfyUI 配置 + 模型配置 + 生图）。

提供：
- 连接基础设置读写
- 多套服务商（本地 + 远程）增删改查与激活
- 模型配置方案（ModelPreset 全字段，含 LoRA）增删改查与激活 —— 决定用哪套模型出图
- ComfyUI 工作流方案（加载 API 工作流 + 覆盖参数）增删改查与激活
- 提示词词库增删改查
- 成人维度开关
- 连通性测试 / 模型清单
- 提交生图：模型方案走自带工作流引擎（build_workflow），工作流方案走 API-JSON 注入
"""

import os
import json
import uuid
from typing import List, Optional
from pydantic import BaseModel, ConfigDict

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..comfyui.config_store import ComfyUIConfigStore, LOCAL_ID
from ..comfyui import client as comfy_client
from ..comfyui import workflow as wf
from ..appearance import generator
from ..services.image_size import image_size_from_bytes as _image_size
from .. import jobs as _jobs

router = APIRouter(prefix="/api/comfyui", tags=["ComfyUI 生图"])

GENERATED_DIR = os.path.join(DATA_DIR, "generated")
os.makedirs(GENERATED_DIR, exist_ok=True)


# ===================== 请求体 =====================
class ComfyUIConnectionReq(BaseModel):
    url: Optional[str] = None
    workflow_path: Optional[str] = None
    prompt_node_id: Optional[str] = None
    negative_node_id: Optional[str] = None
    batch_node_id: Optional[str] = None
    batch_size: Optional[int] = None
    filename_prefix: Optional[str] = None
    output_dir: Optional[str] = None
    timeout_sec: Optional[int] = None
    poll_interval_ms: Optional[int] = None
    random_seed: Optional[bool] = None
    negative_prompt: Optional[str] = None
    install_dir: Optional[str] = None
    python_dir: Optional[str] = None
    launch_args: Optional[str] = None
    open_browser: Optional[bool] = None
    quit_with_comfy: Optional[bool] = None


class ProviderReq(BaseModel):
    name: str
    url: str
    desc: Optional[str] = ""
    timeout_sec: int = 600
    api_key: Optional[str] = ""


class ProviderPatchReq(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    desc: Optional[str] = None
    timeout_sec: Optional[int] = None
    api_key: Optional[str] = None


class ModelPresetReq(BaseModel):
    preset: dict               # 完整 ModelPreset 字典（含 name / recipe / loras 等）


class PromptPresetReq(BaseModel):
    name: str
    text: str = ""
    folder: str = "未分类"


class PromptPresetDeleteManyReq(BaseModel):
    """批量删除：id / name / index 三种定位方式任一命中即删。"""
    ids: List[str] = []
    names: List[str] = []
    indices: List[int] = []


class WorkflowPresetReq(BaseModel):
    name: str
    workflow: str = ""         # API 工作流 JSON 文本 或 文件路径
    overrides: Optional[dict] = None
    note: Optional[str] = ""


# ===================== 全局出图参数 =====================
class GenParamsReq(BaseModel):
    """全局出图参数（只传要改的键）。"""
    model_config = ConfigDict(protected_namespaces=())
    width: Optional[int] = None
    height: Optional[int] = None
    size_preset: Optional[str] = None
    model_preset: Optional[str] = None
    steps: Optional[int] = None
    cfg: Optional[float] = None
    seed: Optional[int] = None
    seed_mode: Optional[str] = None
    batch_size: Optional[int] = None
    count: Optional[int] = None
    extra_negative: Optional[str] = None


class IncludeSensitiveReq(BaseModel):
    value: bool


class GenerateReq(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    positive: Optional[str] = None
    negative: Optional[str] = None
    appearance: Optional[dict] = None
    mode: str = "t2i"                       # t2i / i2i / edit
    include_sensitive: bool = False
    prompt_lang: str = "en"
    width: Optional[int] = None              # 留空 = 用全局出图参数
    height: Optional[int] = None
    # 步数 / CFG 显式覆盖：留空走全局参数；调用页自己有参数面板时一定要传，
    # 否则会出现「面板里改 10 步，实际还按 12 步跑」。
    steps: Optional[int] = None
    cfg: Optional[float] = None
    seed: Optional[int] = None
    batch_size: int = 1
    filename_prefix: str = "RPG"
    provider_id: Optional[str] = None
    model_preset: Optional[str] = None       # 按名称指定模型配置方案
    use_active_model_preset: bool = True     # 不指定 model_preset 时退用激活的
    workflow_preset: Optional[str] = None    # 按名称指定工作流方案
    workflow_path: Optional[str] = None      # 直接指定工作流（覆盖上面）
    overrides: Optional[dict] = None
    random_seed: bool = True
    timeout_sec: Optional[int] = None
    # 出处信息（谁出的图 / 哪个动作 / 哪个任务），用于「图片管理」串起脉络
    ctx: Optional[dict] = None


# ===================== 全局出图参数 =====================
# 所有需要「调 ComfyUI 出图」的地方都读这一份：动作表情批量、立绘生成、以后可能
# 加的场景图 / 剧情插图。前端用同一个面板组件渲染，改一处写回服务端，别处自动同步。
SIZE_PRESET_LIST = [
    {"id": "portrait", "name": "竖版 2:3", "width": 832, "height": 1216},
    {"id": "portrait_2k", "name": "竖版高清", "width": 1024, "height": 1536},
    {"id": "square", "name": "方图 1:1", "width": 1024, "height": 1024},
    {"id": "landscape", "name": "横版 3:2", "width": 1216, "height": 832},
    {"id": "story", "name": "剧情 16:9", "width": 1280, "height": 720},
    {"id": "custom", "name": "自定义", "width": 0, "height": 0},
]


@router.get("/gen-params")
def get_gen_params(scope: str = "global"):
    store = _store()
    return {"params": store.get_gen_params(scope), "size_presets": SIZE_PRESET_LIST}


@router.put("/gen-params")
def set_gen_params(req: GenParamsReq, scope: str = "global"):
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    return {"ok": True, "params": _store().set_gen_params(patch, scope)}


# ===================== 配置读写 =====================
def _store() -> ComfyUIConfigStore:
    return ComfyUIConfigStore()


@router.get("/config")
def get_config():
    return _store().get_all()


@router.put("/config")
def update_config(req: ComfyUIConnectionReq):
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    return _store().set_comfyui(patch)


# ===================== 服务商 =====================
@router.get("/providers")
def list_providers():
    return _store().get_providers()


@router.post("/providers", status_code=201)
def add_provider(req: ProviderReq):
    pid = _store().add_provider(req.name, req.url, req.desc or "", req.timeout_sec, req.api_key or "")
    return {"id": pid, "ok": True}


@router.put("/providers/{pid}")
def update_provider(pid: str, req: ProviderPatchReq):
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    _store().update_provider(pid, patch)
    return {"ok": True}


@router.delete("/providers/{pid}")
def delete_provider(pid: str):
    if pid == LOCAL_ID:
        raise HTTPException(status_code=400, detail="本地 ComfyUI 不可删除")
    _store().delete_provider(pid)
    return {"ok": True}


@router.post("/providers/{pid}/activate")
def activate_provider(pid: str):
    _store().set_active_provider(pid)
    return {"ok": True}


# ===================== 模型配置方案（ModelPreset） =====================
@router.get("/model-presets")
def list_model_presets():
    return _store().get_model_presets()


@router.post("/model-presets", status_code=201)
def add_model_preset(req: ModelPresetReq):
    name = _store().add_model_preset(req.preset)
    return {"name": name, "ok": True}


@router.put("/model-presets/{name}")
def update_model_preset(name: str, req: ModelPresetReq):
    store = _store()
    presets = store.get_model_presets()
    idx = next((i for i, p in enumerate(presets) if p["name"] == name), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="模型方案不存在")
    # 改名时保持 name 字段同步
    patch = dict(req.preset)
    patch["name"] = name
    store.update_model_preset(idx, patch)
    return {"ok": True}


@router.delete("/model-presets/{name}")
def delete_model_preset(name: str):
    store = _store()
    presets = store.get_model_presets()
    idx = next((i for i, p in enumerate(presets) if p["name"] == name), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="模型方案不存在")
    store.delete_model_preset(idx)
    return {"ok": True}


@router.post("/model-presets/{name}/activate")
def activate_model_preset(name: str):
    store = _store()
    if not store.get_model_preset_by_name(name):
        raise HTTPException(status_code=404, detail="模型方案不存在")
    store.set_active_model_preset(name)
    return {"ok": True}


# ===================== ComfyUI 工作流方案 =====================
@router.get("/workflow-presets")
def list_workflow_presets():
    return _store().get_workflow_presets()


@router.post("/workflow-presets", status_code=201)
def add_workflow_preset(req: WorkflowPresetReq):
    _store().add_workflow_preset(req.name, req.workflow, req.overrides, req.note or "")
    return {"ok": True}


@router.put("/workflow-presets/{name}")
def update_workflow_preset(name: str, req: WorkflowPresetReq):
    store = _store()
    presets = store.get_workflow_presets()
    idx = next((i for i, p in enumerate(presets) if p["name"] == name), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="工作流方案不存在")
    store.update_workflow_preset(idx, {
        "name": name, "workflow": req.workflow,
        "overrides": req.overrides or {}, "note": req.note or "",
    })
    return {"ok": True}


@router.delete("/workflow-presets/{name}")
def delete_workflow_preset(name: str):
    store = _store()
    presets = store.get_workflow_presets()
    idx = next((i for i, p in enumerate(presets) if p["name"] == name), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="工作流方案不存在")
    store.delete_workflow_preset(idx)
    return {"ok": True}


@router.post("/workflow-presets/{name}/activate")
def activate_workflow_preset(name: str):
    store = _store()
    if not store.get_workflow_preset_by_name(name):
        raise HTTPException(status_code=404, detail="工作流方案不存在")
    store.set_active_workflow_preset(name)
    return {"ok": True}


# ===================== 提示词词库 =====================
@router.get("/prompt-presets")
def list_prompt_presets():
    return _store().get_prompt_presets()


@router.post("/prompt-presets", status_code=201)
def add_prompt_preset(req: PromptPresetReq):
    _store().add_prompt_preset(req.name, req.text, req.folder or "未分类")
    return {"ok": True}


@router.put("/prompt-presets/{index}")
def update_prompt_preset(index: int, req: PromptPresetReq):
    try:
        _store().update_prompt_preset(int(index), {
            "name": req.name, "text": req.text, "folder": req.folder or "未分类"})
    except IndexError:
        raise HTTPException(status_code=404, detail="提示词不存在")
    return {"ok": True}


@router.delete("/prompt-presets/{index}")
def delete_prompt_preset(index: int):
    try:
        _store().delete_prompt_preset(int(index))
    except IndexError:
        raise HTTPException(status_code=404, detail="提示词不存在")
    return {"ok": True}


@router.post("/prompt-presets/delete-many")
def delete_many_prompt_presets(req: PromptPresetDeleteManyReq):
    """批量删除（支持按 id / 名称 / 下标混合指定）。"""
    removed = _store().delete_prompt_presets(req.ids, req.names, req.indices)
    return {"ok": True, "removed": removed}


@router.post("/prompt-presets/restore-builtin")
def restore_builtin_prompts():
    """把被删掉的内置提示词补回来（按名称判重，不覆盖已存在的同名条目）。"""
    added, total = _store().restore_builtin_prompts()
    return {"ok": True, "added": added, "total": total}


# ===================== 成人维度开关 =====================
@router.put("/include-sensitive")
def set_include_sensitive(req: IncludeSensitiveReq):
    _store().set_include_sensitive(bool(req.value))
    return {"ok": True, "include_sensitive": bool(req.value)}


# ===================== 连通性 / 模型清单 =====================
@router.post("/test")
def test_connection(provider_id: Optional[str] = None):
    store = _store()
    url, timeout, api_key = _resolve_provider(store, provider_id)
    c = comfy_client.ComfyUIClient(url=url, timeout_sec=int(timeout), api_key=api_key or None)
    res = c.test_connection()
    if provider_id and provider_id != LOCAL_ID:
        store.mark_tested(provider_id, res["ok"])
    return res


@router.get("/catalog")
def get_catalog(provider_id: Optional[str] = None):
    """列出 ComfyUI 当前可加载的模型（unet / checkpoints / clip / vae / loras）。"""
    store = _store()
    url, timeout, api_key = _resolve_provider(store, provider_id)
    c = comfy_client.ComfyUIClient(url=url, timeout_sec=int(timeout), api_key=api_key or None)
    try:
        return {"ok": True, "catalog": c.catalog()}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "detail": str(e), "catalog": {}}


def _resolve_provider(store, provider_id):
    pid = provider_id
    if pid and pid != LOCAL_ID:
        p = next((x for x in store.get_providers() if x["id"] == pid and not x.get("local")), None)
        if not p:
            raise HTTPException(status_code=404, detail="服务商不存在")
        return p["url"], p.get("timeout_sec", 600), p.get("api_key", "")
    base = store.get_comfyui()
    return base["url"], base["timeout_sec"], base.get("api_key", "")


# ===================== 生图 =====================
def _build_prompts(req: GenerateReq):
    """统一产出中文正向提示词。

    按需求：ComfyUI 出图**只用正面提示词**，且提示词里不出现英文
    （Moss 的文本编码器是 Qwen，中文理解优于英文翻译）。负面交给模型方案自带的那条。
    """
    if req.positive:
        return req.positive, (req.negative or "")
    if req.appearance:
        parts = generator.to_prompt_parts(req.appearance, include_sensitive=req.include_sensitive)
        return parts["posCn"], (req.negative or "")
    raise HTTPException(status_code=400, detail="需要提供 positive 提示词或 appearance 外观数据")


def _resolve_workflow(store, req: GenerateReq):
    """返回 (kind, payload)：
       ('model', preset_dict)        —— 自带引擎 build_workflow
       ('workflow', (wf_json_or_path, overrides))  —— API-JSON 注入
    """
    # 1) 模型配置方案优先
    preset = None
    if req.model_preset:
        preset = store.get_model_preset_by_name(req.model_preset)
        if not preset:
            raise HTTPException(status_code=404, detail=f"模型方案不存在：{req.model_preset}")
    elif req.use_active_model_preset:
        preset = store.get_active_model_preset()
    if preset:
        return ("model", preset)

    # 2) 工作流方案 / 直接路径
    wf_src = None
    overrides = req.overrides or {}
    if req.workflow_path:
        wf_src = req.workflow_path
    elif req.workflow_preset:
        wp = store.get_workflow_preset_by_name(req.workflow_preset)
        if not wp:
            raise HTTPException(status_code=404, detail=f"工作流方案不存在：{req.workflow_preset}")
        wf_src = wp.get("workflow") or ""
        overrides = {**(wp.get("overrides") or {}), **overrides}
    elif req.use_active_model_preset:
        wp = store.get_active_workflow_preset()
        if wp:
            wf_src = wp.get("workflow") or ""
            overrides = {**(wp.get("overrides") or {}), **overrides}
    if not wf_src:
        raise HTTPException(
            status_code=400,
            detail="未指定模型方案或工作流。请先在「模型配置」中选一套方案，或在「ComfyUI 工作流」中配置工作流。",
        )
    return ("workflow", (wf_src, overrides))


def _record_generated(meta: list, payload: "GenerateReq", positive: str, negative: str):
    """把这次出的图登记进统一素材库（assets）。

    以前只写 generated_images，导致「AI 图」和「本地上传图」是两个互不相干的世界。
    现在统一走 asset_store：出图即入素材库，选择器里能直接挑到刚出的图。
    """
    if not meta:
        return
    try:
        from ..services import asset_store

        ctx = payload.ctx or {}
        source = ctx.get("source") or "manual"
        kind = ctx.get("asset_kind") or ("pose" if ctx.get("pose_id") else
                                         ("portrait" if source == "appearance_render" else "other"))
        subject_type = ctx.get("subject_type") or ("character" if ctx.get("character_id") else None)
        subject_id = ctx.get("subject_id") or ctx.get("character_id")
        subject_name = ctx.get("subject_name") or ctx.get("character_name")
        for m in meta:
            asset_store.record_ai_image(
                m,
                source=source,
                prompt=positive,
                negative=negative,
                model_preset=payload.model_preset or ctx.get("model_preset"),
                job_id=ctx.get("job_id"),
                seed=None if payload.random_seed else payload.seed,
                kind=kind,
                subject_type=subject_type,
                subject_id=subject_id,
                subject_name=subject_name,
                category=ctx.get("category"),
                variant=ctx.get("pose_id"),
                variant_name=ctx.get("pose_name"),
            )
    except Exception as e:  # noqa: BLE001
        # 登记失败不能影响出图本身
        print(f"[WARN] 生成图片登记失败：{e}")


@router.post("/generate")
def generate(payload: GenerateReq):
    store = _store()
    url, timeout, api_key = _resolve_provider(store, payload.provider_id)
    c = comfy_client.ComfyUIClient(
        url=url, timeout_sec=int(payload.timeout_sec or timeout or 600),
        api_key=api_key or None,
    )

    # 连通性预检
    tc = c.test_connection()
    if not tc["ok"]:
        raise HTTPException(status_code=502, detail=f"ComfyUI 不可达：{tc['detail']}")

    positive, negative = _build_prompts(payload)
    # 尺寸 / 步数 / CFG 未显式指定时，一律取全局出图参数（保证「一处改、处处一致」）
    gp = store.get_gen_params()
    if not payload.model_preset and gp.get("model_preset"):
        payload = payload.model_copy(update={"model_preset": gp["model_preset"]})
    kind, data = _resolve_workflow(store, payload)

    width = int(payload.width or gp.get("width") or 832)
    height = int(payload.height or gp.get("height") or 1216)
    if gp.get("extra_negative"):
        negative = "，".join([x for x in [negative, gp["extra_negative"]] if x])

    # 这个任务对应的 job（任务面板可暂停/取消）；没有就 None
    _jid = (payload.ctx or {}).get("job_id")

    try:
        if kind == "model":
            preset = dict(data)
            # 调用页显式传的步数 / CFG 优先，其次才是全局参数里手填的（0 = 不覆盖）
            _steps = payload.steps if payload.steps else gp.get("steps")
            _cfg = payload.cfg if payload.cfg else gp.get("cfg")
            if _steps:
                preset["steps"] = int(_steps)
            if _cfg:
                preset["cfg"] = float(_cfg)
            available = c._node_cache()
            # seed=None 时由方案自身 resolve_seed() 决定（-1 = 随机）
            seed_val = None if payload.random_seed else (payload.seed if payload.seed is not None else 0)
            flow = wf.build_workflow(
                preset,
                mode=payload.mode,
                prompt=positive,
                negative=negative if negative else None,
                width=width,
                height=height,
                seed=seed_val,
                prefix=payload.filename_prefix or "RPG",
                available_nodes=available,
            )
        else:
            wf_src, overrides = data
            if os.path.exists(wf_src):
                raw = comfy_client.ComfyUIClient.load_workflow(wf_src)
            else:
                # 当作内联 JSON 文本
                try:
                    raw = json.loads(wf_src)
                except Exception:
                    raise HTTPException(status_code=400, detail="工作流既不是文件也不是合法 JSON")
            flow = c.build_prompt(
                raw, positive, negative=negative, overrides=overrides,
                batch_size=max(1, int(payload.batch_size)),
                filename_prefix=payload.filename_prefix or "RPG",
                random_seed=payload.random_seed,
            )
        # 任务面板点「暂停 / 取消」时，等待中就会被掐断（客户端会顺手 /interrupt）
        _should_cancel = (lambda: _jobs.abort_now(_jid)) if _jid else None
        prompt_id = c.submit(flow)
        images = c.wait_for_images(
            prompt_id,
            timeout_sec=int(payload.timeout_sec or timeout or 600),
            should_cancel=_should_cancel,
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        # 是用户自己掐断的：抛给上层（工作线程会区分「暂停重试」和「取消退出」）
        if _jid and _jobs.abort_now(_jid):
            raise RuntimeError(str(e) or "已中断生成")
        raise HTTPException(status_code=502, detail=f"ComfyUI 生图失败：{e}")

    urls = []
    meta = []
    for i, im in enumerate(images):
        raw = c.download_image(im)
        if not raw:
            continue
        ext = os.path.splitext(im.get("filename", "image.png"))[1] or ".png"
        safe = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in payload.filename_prefix or "RPG")
        fname = f"{safe}_{uuid.uuid4().hex[:8]}_{i}{ext}"
        fpath = os.path.join(GENERATED_DIR, fname)
        with open(fpath, "wb") as f:
            f.write(raw)
        w, h = _image_size(raw) or (width, height)
        urls.append(f"/generated/{fname}")
        meta.append({"url": f"/generated/{fname}", "width": w, "height": h})

    if not urls:
        raise HTTPException(status_code=502, detail="ComfyUI 未返回任何图片")

    _record_generated(meta, payload, positive, negative)

    return {
        "ok": True,
        "prompt_id": prompt_id,
        "kind": kind,
        "positive": positive,
        "negative": negative,
        "images": urls,
        "meta": meta,
        "width": width,
        "height": height,
    }
