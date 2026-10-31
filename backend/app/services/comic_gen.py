# -*- coding: utf-8 -*-
"""漫画格子出图：提示词装配 + ComfyUI 提交 + 队列调度。

设计取向和其它栏目的不同点：
- **一格一任务**。批次只是「一堆格子任务」的集合，所以任何一格都能单独取消 / 重试，
  完成一格立刻回填一格，不会因为同页别格失败就卡住。
- **单并发**（默认 1）。8GB 显存跑两张容易 OOM，而且漫画同页画风一致性更重要。
  并发数写在工程里，调度器按工程取最小值。
- **失败不写版本**，只把格子的 last_error 记下来，用户可以改词再跑。
- 图片落在 data/comic/ 下，按 工程/格子 分目录，数据库只存 url。
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime
from typing import Callable, Iterable

from ..config import DATA_DIR
from ..database import SessionLocal
from .. import jobs as job_book          # 统一任务登记表（顶栏任务中心读它）
from ..comfyui.config_store import ComfyUIConfigStore
from ..comfyui import client as comfy_client
from ..comfyui import workflow as wf

COMIC_DIR = os.path.join(DATA_DIR, "comic")
os.makedirs(COMIC_DIR, exist_ok=True)


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _json(raw, fallback):
    try:
        v = json.loads(raw) if raw else None
        return v if v is not None else fallback
    except Exception:  # noqa: BLE001
        return fallback


# ======================================================================
# 提示词装配
# ======================================================================
def _character_block(db, ref: dict, include_sensitive: bool = False) -> str:
    """把绑定的人物翻译成一段中文外观描述。

    优先用「人物外观拼装」那一套（几十个维度拼出来的具体描述），
    没配外观的老人物退化成 姓名 + 性格标签，至少不会空着。
    """
    from ..models.character import Character
    from ..models.character_appearance import CharacterAppearance
    from ..appearance import generator as agen

    cid = ref.get("character_id")
    if not cid:
        return ""
    ch = db.get(Character, int(cid))
    if not ch:
        return ""

    app_json = None
    aid = ref.get("appearance_id")
    if aid:
        ap = db.get(CharacterAppearance, int(aid))
        if ap and ap.appearance_json:
            app_json = ap.appearance_json
    if not app_json:
        ap = (db.query(CharacterAppearance)
              .filter(CharacterAppearance.character_id == ch.id)
              .order_by(CharacterAppearance.is_default.desc(), CharacterAppearance.sort)
              .first())
        if ap and ap.appearance_json:
            app_json = ap.appearance_json
    if not app_json:
        app_json = ch.appearance_json

    text = ""
    if app_json:
        try:
            data = json.loads(app_json) if isinstance(app_json, str) else app_json
            # 外观只描述「长什么样」：动作表情由专门的出图路径负责，这里剔除，
            # 避免人物外观里残留的旧 pose 数据污染漫画分镜提示词。
            for _k in ("pose", "poseCategory", "expression"):
                data.pop(_k, None)
            # 自定义追加词（外观拼装里的「自定义文字框」）随外观一起带入
            free_text = data.pop("free_text", None) or None
            parts = agen.to_prompt_parts(data, include_sensitive=include_sensitive,
                                        free_text=free_text)
            text = (parts.get("posCn") or "").strip()
        except Exception:  # noqa: BLE001
            text = ""
    # 【画面】/【取景】是「角色设定图」专用的：纯色背景、正面站立、居中构图…
    # 直接塞进漫画格会跟分镜场景打架（模型会把人物画成一张设定图），这里整段丢掉。
    if text:
        text = "\n".join(ln for ln in text.split("\n")
                         if not ln.strip().startswith(("【画面】", "【取景】")))
    if not text:
        bits = [ch.name]
        if ch.title:
            bits.append(ch.title)
        if ch.personality:
            bits.append(ch.personality)
        if ch.background_story:
            bits.append(ch.background_story[:60])
        text = "，".join([b for b in bits if b])

    note = (ref.get("note") or "").strip()
    if note:
        text = f"{text}，{note}" if text else note
    return text


def assemble_prompt(db, project, cell, include_sensitive: bool | None = None) -> dict:
    """返回 {positive, negative, parts:[{label,text}], override}。

    顺序固定：人物区块（按出场顺序）→ 本格自由词。
    整格手写覆盖（prompt_override）非空时直接用它，不做任何拼接。
    全局画风前缀已不再使用（不再提供填写入口）。
    """
    if include_sensitive is None:
        try:
            include_sensitive = bool(ComfyUIConfigStore().get_include_sensitive())
        except Exception:  # noqa: BLE001
            include_sensitive = False

    override = (cell.prompt_override or "").strip()
    parts: list[dict] = []

    for ref in _json(cell.characters, []) or []:
        txt = _character_block(db, ref, include_sensitive)
        if txt:
            name = ref.get("name") or f"人物{ref.get('character_id')}"
            parts.append({"label": f"人物·{name}", "text": txt})

    if (cell.prompt_positive or "").strip():
        parts.append({"label": "本格自由词", "text": cell.prompt_positive.strip()})

    positive = "，".join([p["text"] for p in parts if p.get("text")])
    if override:
        positive = override

    # 负面词一律不参与：现在用的模型 CFG=1，负面提示词不会生效，只会白白多跑一次 CLIP 编码。
    # 提示词也禁止在代码里写死任何默认内容 —— 这里只做拼接，内容全部来自用户填写。
    negative = ""

    return {
        "positive": positive,
        "negative": negative,
        "parts": parts,
        "override": bool(override),
        "include_sensitive": include_sensitive,
    }


def assemble_recipe(db, project, recipe: dict, include_sensitive: bool | None = None) -> dict:
    """按「版本配方」拼提示词：前置 → 人物区块（按出场顺序）→ 后置。

    recipe = {prompt_prefix, prompt_suffix, prompt_override, characters}。
    override 非空时整段替换，其它都不拼。
    """
    if include_sensitive is None:
        try:
            include_sensitive = bool(ComfyUIConfigStore().get_include_sensitive())
        except Exception:  # noqa: BLE001
            include_sensitive = False

    override = (recipe.get("prompt_override") or "").strip()
    if override:
        return {
            "positive": override, "negative": "",
            "parts": [{"label": "整段覆盖", "text": override}],
            "override": True, "include_sensitive": include_sensitive,
        }

    parts: list[dict] = []
    prefix = (recipe.get("prompt_prefix") or "").strip()
    if prefix:
        parts.append({"label": "前置", "text": prefix})
    for ref in (recipe.get("characters") or []):
        txt = _character_block(db, ref, include_sensitive)
        if txt:
            name = ref.get("name") or f"人物{ref.get('character_id')}"
            parts.append({"label": f"人物·{name}", "text": txt})
    suffix = (recipe.get("prompt_suffix") or "").strip()
    if suffix:
        parts.append({"label": "后置", "text": suffix})

    positive = "，".join([p["text"] for p in parts if p.get("text")])
    return {
        "positive": positive, "negative": "",
        "parts": parts, "override": False, "include_sensitive": include_sensitive,
    }


def version_to_recipe(version) -> dict:
    """把一个版本换算成配方。

    老版本（三个新列都是 NULL）没有配方，只有 prompt_positive（历史成品，已含人物描述），
    于是把它当「后置」原样保留、人物留空，避免拼出来重复一坨人物描述。
    新版本直接用 prefix / suffix / override / characters 四件套。
    """
    legacy = (getattr(version, "prompt_prefix", None) is None
              and getattr(version, "prompt_suffix", None) is None
              and getattr(version, "prompt_override", None) is None)
    if legacy:
        return {
            "prompt_prefix": "",
            "prompt_suffix": (version.prompt_positive or ""),
            "prompt_override": "",
            "characters": [],
        }
    return {
        "prompt_prefix": (version.prompt_prefix or ""),
        "prompt_suffix": (version.prompt_suffix or ""),
        "prompt_override": (version.prompt_override or ""),
        "characters": _json(version.characters, []) or [],
    }


def assemble_version_prompt(db, project, version, include_sensitive: bool | None = None) -> dict:
    return assemble_recipe(db, project, version_to_recipe(version), include_sensitive)


def resolve_params(db, project, cell) -> dict:
    """格子参数优先，其次工程默认，最后 ComfyUI 全局。"""
    store = ComfyUIConfigStore()
    gp = {}
    try:
        gp = store.get_gen_params()
    except Exception:  # noqa: BLE001
        gp = {}

    model_preset = (
        (cell.model_preset or "").strip()
        or (project.model_preset or "").strip()
    )
    if not model_preset:
        active = store.get_active_model_preset()
        model_preset = (active or {}).get("name") or gp.get("model_preset") or ""

    workflow_preset = (cell.workflow_preset or "").strip() or (project.workflow_preset or "").strip()

    steps = cell.steps or project.steps or gp.get("steps") or 0
    cfg = cell.cfg if cell.cfg is not None else (project.cfg if project.cfg is not None else gp.get("cfg") or 0)

    seed_mode = (cell.seed_mode or project.seed_mode or "random").lower()
    if seed_mode == "fixed":
        seed = int(cell.seed if cell.seed is not None else (gp.get("seed") or 0))
        if seed < 0:
            seed = 0
    else:
        seed = None  # None → 由模型方案自己随机

    w, h = calc_size(cell.w, cell.h)
    return {
        "model_preset": model_preset,
        "workflow_preset": workflow_preset,
        "steps": int(steps) if steps else None,
        "cfg": float(cfg) if cfg else None,
        "seed": seed,
        "seed_mode": seed_mode,
        "width": w,
        "height": h,
    }


def calc_size(w: int, h: int) -> tuple[int, int]:
    """按格子比例算出图尺寸：长边 1024，短边不低于 384，取 16 的倍数。

    漫画格子比例极端（细长条 / 横长条）很常见，所以不能固定长宽，
    只保证「同比例、可被 16 整除」——否则 latent 会对不齐。
    """
    w = max(64, int(w or 512))
    h = max(64, int(h or 512))
    aspect = w / h
    long_side = 1024
    if aspect >= 1:
        W, H = long_side, int(long_side / aspect)
    else:
        H, W = long_side, int(long_side * aspect)
    W = max(384, min(1280, W))
    H = max(384, min(1280, H))
    W = int(round(W / 16) * 16)
    H = int(round(H / 16) * 16)
    return W, H


# ======================================================================
# 单格生成
# ======================================================================
class Canceled(Exception):
    pass


def _client(store) -> comfy_client.ComfyUIClient:
    p = store.get_active_provider()
    return comfy_client.ComfyUIClient(
        url=p.get("url"), timeout_sec=int(p.get("timeout_sec") or 600),
        api_key=(p.get("api_key") or None))


def generate_cell_image(cell_id: int, *, version_id: int | None = None,
                        cancel_check: Callable[[], bool] | None = None,
                        on_progress: Callable[[int, str], None] | None = None,
                        on_client: Callable[[object], None] | None = None) -> dict:
    """跑一格图。返回 {url, path, width, height, prompt, negative, params, elapsed}。

    version_id 非空时按「该版本的配方」拼词（前置/人物/后置），否则按格子的实时内容。
    """
    db = SessionLocal()
    try:
        from ..models.comic import ComicCell, ComicProject

        cell = db.get(ComicCell, int(cell_id))
        if not cell:
            raise RuntimeError("格子不存在")
        project = db.get(ComicProject, cell.project_id)
        if not project:
            raise RuntimeError("工程不存在")

        if version_id:
            from ..models.comic import ComicCellVersion
            ver = db.get(ComicCellVersion, int(version_id))
            if not ver or ver.cell_id != cell.id:
                raise RuntimeError("目标版本不存在")
            prompt = assemble_version_prompt(db, project, ver)
        else:
            prompt = assemble_prompt(db, project, cell)
        if not prompt["positive"].strip():
            raise RuntimeError("这一格还没有提示词：先绑人物或写自由词")
        params = resolve_params(db, project, cell)

        store = ComfyUIConfigStore()
        c = _client(store)
        if on_client:
            on_client(c)

        tc = c.test_connection()
        if not tc.get("ok"):
            raise RuntimeError(f"ComfyUI 不可达：{tc.get('detail')}")

        preset = None
        if params["model_preset"]:
            preset = store.get_model_preset_by_name(params["model_preset"])
        if not preset:
            preset = store.get_active_model_preset()
        if not preset:
            raise RuntimeError("没有可用的模型配置方案，请先在「设置 → ComfyUI」里配一套")

        # 步数 / CFG 显式覆盖
        preset = dict(preset)
        if params["steps"]:
            preset["steps"] = int(params["steps"])
        if params["cfg"]:
            preset["cfg"] = float(params["cfg"])

        available = c._node_cache()
        flow = wf.build_workflow(
            preset, mode="t2i", prompt=prompt["positive"],
            negative="",
            width=params["width"], height=params["height"],
            seed=params["seed"], prefix=f"comic{cell.id}", available_nodes=available,
        )

        t0 = time.time()
        pid = c.submit(flow)

        # 把这次真正用的 seed 记下来（界面上「固定 seed 复现」要靠它）
        seed_used = None
        for node in (flow or {}).values():
            if not isinstance(node, dict):
                continue
            inp = node.get("inputs") or {}
            if isinstance(inp.get("seed"), int):
                seed_used = inp["seed"]
                break
            if isinstance(inp.get("noise_seed"), int):
                seed_used = inp["noise_seed"]
                break

        def _progress():
            if on_progress:
                el = time.time() - t0
                on_progress(min(92, int(el / 45 * 92)), "ComfyUI 生成中…")

        images = c.wait_for_images(
            pid, timeout_sec=int(c.timeout), on_progress=_progress,
            should_cancel=cancel_check)
        if not images:
            raise RuntimeError("ComfyUI 没有返回图片")

        im = images[0]
        raw = c.download_image(im)
        if not raw:
            raise RuntimeError("图片下载失败")

        from ..services.image_size import image_size_from_bytes
        size = image_size_from_bytes(raw) or (params["width"], params["height"])

        out_dir = os.path.join(COMIC_DIR, f"p{project.id}", f"cell_{cell.id}")
        os.makedirs(out_dir, exist_ok=True)
        fname = f"v{uuid.uuid4().hex[:10]}.png"
        fpath = os.path.join(out_dir, fname)
        with open(fpath, "wb") as f:
            f.write(raw)

        url = f"/comic-media/p{project.id}/cell_{cell.id}/{fname}"
        return {
            "url": url,
            "path": fpath,
            "width": size[0],
            "height": size[1],
            "prompt": prompt,
            "params": params,
            "seed": seed_used,
            "elapsed": round(time.time() - t0, 1),
        }
    finally:
        db.close()


# ======================================================================
# 队列
# ======================================================================
class ComicQueue:
    def __init__(self):
        self._lock = threading.RLock()
        self.tasks: list[dict] = []
        self._paused = False
        self._worker: threading.Thread | None = None
        self._current_client = None
        self._current_id: str | None = None
        self._seq = 0

    # ---------- 对外 ----------
    def submit(self, cell_ids: Iterable[int], project_id: int, batch_name: str = "",
               page_map: dict[int, int] | None = None,
               version_map: dict[int, int] | None = None) -> list[dict]:
        created = []
        page_map = page_map or {}
        version_map = version_map or {}
        with self._lock:
            running_same = {t["cell_id"] for t in self.tasks
                            if t["status"] in ("waiting", "running")}
            batch_id = uuid.uuid4().hex[:8]
            for cid in cell_ids:
                cid = int(cid)
                if cid in running_same:      # 同一格别重复排队
                    continue
                self._seq += 1
                # 同时登记进统一任务表：顶栏「任务中心」里能看到这一格在跑，
                # 双击能跳回漫画画布定位到这一格。
                job = job_book.create(
                    "comic_cell",
                    f"漫画 · 格 {cid}",
                    page="comic",
                    total=1,
                    focus={"project_id": int(project_id),
                           "page_id": page_map.get(cid),
                           "cell_id": cid},
                    message=(batch_name or "单格生成") + " · 排队中",
                )
                job_book.update(job["id"], nopause=True)   # 漫画队列是整队暂停，不支持单条暂停
                t = {
                    "id": f"ct{self._seq}",
                    "job_id": job["id"],
                    "cell_id": cid,
                    "version_id": version_map.get(cid),
                    "project_id": int(project_id),
                    "page_id": page_map.get(cid),
                    "batch_id": batch_id,
                    "batch_name": batch_name or "单格生成",
                    "status": "waiting",
                    "progress": 0,
                    "message": "排队中",
                    "image": "",
                    "error": "",
                    "created_at": now_iso(),
                    "started_at": "",
                    "finished_at": "",
                }
                self.tasks.append(t)
                created.append(t)
                job_book.update(job["id"], _ctl={"cancel": (lambda tid=t["id"]: self.cancel(tid))})
            if len(self.tasks) > 400:
                self.tasks = self.tasks[-400:]
        if created:
            self._ensure_worker()
        return created

    def snapshot(self, project_id: int | None = None) -> dict:
        with self._lock:
            items = [dict(t) for t in self.tasks
                     if project_id is None or t["project_id"] == int(project_id)]
        items = items[-120:]
        counts = {"waiting": 0, "running": 0, "success": 0, "failed": 0, "canceled": 0}
        for t in items:
            counts[t["status"]] = counts.get(t["status"], 0) + 1
        return {"paused": self._paused, "tasks": items, "counts": counts,
                "current": self._current_id}

    def pause(self):
        self._paused = True

    def resume(self):
        self._paused = False
        self._ensure_worker()

    def cancel(self, task_id: str):
        with self._lock:
            for t in self.tasks:
                if t["id"] != task_id:
                    continue
                if t["status"] == "waiting":
                    t["status"] = "canceled"
                    t["message"] = "已取消"
                    t["finished_at"] = now_iso()
                    self._sync_cell_status(t["cell_id"], "pending")
                    if t.get("job_id"):
                        job_book.finish(t["job_id"], status="canceled", message="已取消")
                    return True
                if t["status"] == "running":
                    t["status"] = "canceling"
                    t["message"] = "正在中断…"
                    c = self._current_client
                    if c is not None:
                        try:
                            c.interrupt()
                        except Exception:  # noqa: BLE001
                            pass
                    return True
        return False

    def abort_batch(self, batch_id: str | None = None):
        with self._lock:
            for t in self.tasks:
                if t["status"] == "waiting" and (batch_id is None or t["batch_id"] == batch_id):
                    t["status"] = "canceled"
                    t["message"] = "批次已中止"
                    t["finished_at"] = now_iso()
                    self._sync_cell_status(t["cell_id"], "pending")
                    if t.get("job_id"):
                        job_book.finish(t["job_id"], status="canceled", message="批次已中止")
        # 正在跑的也掐掉
        with self._lock:
            running = [t for t in self.tasks if t["status"] in ("running", "canceling")]
        for t in running:
            self.cancel(t["id"])

    def clear_finished(self):
        with self._lock:
            self.tasks = [t for t in self.tasks
                          if t["status"] in ("waiting", "running", "canceling")]

    # ---------- 内部 ----------
    def _sync_cell_status(self, cell_id: int, status: str):
        db = SessionLocal()
        try:
            from ..models.comic import ComicCell
            c = db.get(ComicCell, int(cell_id))
            if c:
                c.gen_status = status
                db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
        finally:
            db.close()

    def _ensure_worker(self):
        if self._worker and self._worker.is_alive():
            return
        self._worker = threading.Thread(target=self._loop, daemon=True,
                                        name="comic-queue")
        self._worker.start()

    def _next(self) -> dict | None:
        with self._lock:
            for t in self.tasks:
                if t["status"] == "waiting":
                    return t
        return None

    def _loop(self):
        while True:
            if self._paused:
                time.sleep(0.4)
                continue
            task = self._next()
            if not task:
                time.sleep(0.5)
                # 连续空闲后线程退出，下次 submit 再拉起
                with self._lock:
                    if not any(t["status"] == "waiting" for t in self.tasks):
                        self._worker = None
                        return
                continue
            self._run(task)

    def _run(self, task: dict):
        tid = task["id"]
        jid = task.get("job_id") or ""
        with self._lock:
            task["status"] = "running"
            task["started_at"] = now_iso()
            task["message"] = "准备提交…"
            self._current_id = tid
            self._current_client = None
        if jid:
            job_book.update(jid, message="准备提交…")

        def cancel_check() -> bool:
            with self._lock:
                return task["status"] in ("canceled", "canceling")

        def on_progress(p, msg):
            with self._lock:
                task["progress"] = int(p)
                task["message"] = msg
            if jid:
                job_book.update(jid, message=(f"{int(p)}% · {msg}" if msg else f"{int(p)}%"))

        def on_client(c):
            with self._lock:
                self._current_client = c

        self._sync_cell_status(task["cell_id"], "rendering")
        try:
            res = generate_cell_image(task["cell_id"], version_id=task.get("version_id"),
                                      cancel_check=cancel_check, on_progress=on_progress,
                                      on_client=on_client)
            self._save_version(task, res)
            with self._lock:
                task["status"] = "success"
                task["progress"] = 100
                task["message"] = f"完成 · {res['elapsed']}s"
                task["image"] = res["url"]
                task["finished_at"] = now_iso()
                self._current_client = None
            if jid:
                job_book.step(jid, ok=True, image=res["url"],
                              result={"image": res["url"], "width": res.get("width"),
                                      "height": res.get("height"),
                                      "prompt": (res.get("prompt") or {}).get("positive", "")},
                              message=f"完成 · {res['elapsed']}s")
                job_book.finish(jid, status="done", message=f"完成 · {res['elapsed']}s")
        except Exception as e:  # noqa: BLE001
            canceled = cancel_check() or "取消" in str(e) or "中断" in str(e)
            with self._lock:
                task["status"] = "canceled" if canceled else "failed"
                task["message"] = "已取消" if canceled else (str(e) or "生成失败")
                task["error"] = "" if canceled else (str(e) or "")
                task["finished_at"] = now_iso()
                task["progress"] = 0
                self._current_client = None
            if jid:
                job_book.step(jid, ok=False, message=task["message"])
                job_book.finish(jid, status="canceled" if canceled else "error",
                                message=task["message"])
            db = SessionLocal()
            try:
                from ..models.comic import ComicCell
                c = db.get(ComicCell, int(task["cell_id"]))
                if c:
                    c.gen_status = "pending" if canceled else "failed"
                    c.last_error = "" if canceled else (str(e) or "")
                    c.progress = 0
                    db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
            finally:
                db.close()
        finally:
            with self._lock:
                self._current_id = None

    def _save_version(self, task: dict, res: dict):
        db = SessionLocal()
        try:
            from ..models.comic import ComicCell, ComicCellVersion

            cell = db.get(ComicCell, int(task["cell_id"]))
            if not cell:
                return
            vid = task.get("version_id")
            ver = None
            if vid:
                ver = db.get(ComicCellVersion, int(vid))
                if ver and ver.cell_id == cell.id:
                    # 就地填充这张草稿版本：只更新图与成品提示词，配方（prefix/suffix/override/characters）不动
                    ver.image_url = res["url"]
                    ver.width = res["width"]; ver.height = res["height"]
                    ver.prompt_positive = res["prompt"]["positive"]
                    ver.prompt_negative = ""
                    ver.params = json.dumps(res["params"], ensure_ascii=False)
                    ver.seed = res["seed"]
                    ver.status = "success"
                    ver.elapsed = res["elapsed"]
                    ver.is_selected = 1
                else:
                    ver = None
            if ver is None:
                ver = ComicCellVersion(
                    cell_id=cell.id,
                    image_url=res["url"],
                    width=res["width"], height=res["height"],
                    prompt_positive=res["prompt"]["positive"],
                    prompt_negative="",
                    characters=cell.characters,
                    params=json.dumps(res["params"], ensure_ascii=False),
                    seed=res["seed"],
                    status="success",
                    is_selected=1,
                    elapsed=res["elapsed"],
                )
                db.add(ver)
                db.flush()
            # 旧版本取消选中
            db.query(ComicCellVersion).filter(
                ComicCellVersion.cell_id == cell.id,
                ComicCellVersion.id != ver.id,
            ).update({ComicCellVersion.is_selected: 0}, synchronize_session=False)
            cell.current_image = res["url"]
            cell.current_version_id = ver.id
            cell.gen_status = "done"
            cell.last_error = ""
            cell.progress = 100
            cell.updated_at = now_iso()
            db.commit()
            task["version_id"] = ver.id
        except Exception:  # noqa: BLE001
            db.rollback()
            raise
        else:
            # ---- 登记进统一图片库（图片管理 → AI 生成图）----
            # 漫画出的图也进素材表，这样「图片管理」里能按人物把漫画图串起来，
            # 而不是一堆没有来源的 png。失败不影响出图本身。
            try:
                from ..services import asset_store

                chars = []
                try:
                    chars = json.loads(cell.characters) if cell.characters else []
                except Exception:  # noqa: BLE001
                    chars = []
                subj_id = None
                subj_name = None
                if chars:
                    subj_id = (chars[0] or {}).get("character_id")
                    subj_name = (chars[0] or {}).get("name")
                asset_store.record_ai_image(
                    {"url": res["url"], "width": res["width"], "height": res["height"]},
                    source="comic",
                    prompt=res["prompt"].get("positive"),
                    negative="",
                    seed=res["seed"],
                    subject_type="character" if subj_id else None,
                    subject_id=subj_id,
                    subject_name=subj_name,
                    kind="comic",
                    category="漫画",
                )
            except Exception as e:  # noqa: BLE001
                print(f"[WARN] 漫画图片登记失败：{e}")
        finally:
            db.close()


queue = ComicQueue()


def recover_stuck_cells() -> int:
    """服务重启后，把上次进程里没跑完的格子状态复位。

    队列是进程内的内存对象，进程一退出任务就没了，但 cell.gen_status 已经
    被写成 queued/rendering 落盘了 —— 不处理的话前端会永远显示"渲染中"，
    用户也无法再次提交（按钮被禁用）。这里统一回退：
      有成品图 → done；没图 → pending（待生成，可以重跑）。
    """
    db = SessionLocal()
    try:
        from ..models.comic import ComicCell
        rows = db.query(ComicCell).filter(
            ComicCell.gen_status.in_(["queued", "rendering"])
        ).all()
        for c in rows:
            c.gen_status = "done" if c.current_image else "pending"
            c.progress = 100 if c.current_image else 0
            c.updated_at = now_iso()
        db.commit()
        return len(rows)
    except Exception:  # noqa: BLE001
        db.rollback()
        return 0
    finally:
        db.close()
