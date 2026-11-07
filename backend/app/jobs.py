# -*- coding: utf-8 -*-
"""
后台任务登记表（内存级）。

用途：ComfyUI 出图动辄 40~90 秒一张、批量更是十几分钟。如果照旧用「同步请求」
一路 await 到底，用户切到别的页面就完全不知道后台在跑什么，回来还得刷新才看见结果。

做法：请求只负责「校验 + 建任务 + 起线程」，立刻返回 job_id；前端统一轮询
`/api/jobs` 在左侧栏显示进度，任务页自己轮询 `job/:id` 拿结果。

暂停 / 取消（照搬「windows轻量AI桌面助手」任务中心那套语义）：
    · 取消 = 这条任务不要了。当前那张图当场中断（ComfyUI /interrupt），
      已经出好的图保留，状态置 canceled。
    · 暂停 = 先停下，任务还留在列表里。执行中被暂停时当前那张图会被强行打断
      （图是跑不出半张的），「继续」会重新生成这一张。
      等待中/队列中的任务暂停就是纯标记，不占机器。
    · 暂停一条不影响其它任务 —— 每条任务各自一个线程，互不等待。

任务只活在进程内（重启即清空）——出图本来就是一次性的，没必要落库。
"""

from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime
from typing import Any, Callable

_lock = threading.RLock()
_jobs: dict[str, dict] = {}

#: 已结束的任务保留多久（秒），够用户切回来点「查看结果」
KEEP_FINISHED_SEC = 1800

# ---------------------------------------------------------------------------
# 任务分类
# ---------------------------------------------------------------------------
# 出图（ComfyUI）和出声（TTS）都是几十秒起步的后台活，混在一张列表里时
# 用户没法一眼分清「哪些是我的图、哪些是我点的语音」——所以每条任务带一个
# category，面板上方按分类过滤（全部 / 音频 / 图像 / 其他）。
#
# 分类由 kind 自动推导，新增任务类型时只补这张表即可，不用去改前端。
KIND_CATEGORY = {
    # ---- 图像（ComfyUI）----
    "pose_batch": "image",
    "appearance_render": "image",
    "scene_render": "image",
    "compose_render": "image",
    "comic_cell": "image",
    "card_art": "image",
    "card_emotion": "image",
    "story_cast": "image",
    # ---- 音频（TTS / 静音裁剪）----
    "voice_pack": "audio",
    "voice_dialogue": "audio",
    "tts_chapter": "audio",
    # ---- 文本（解析 / 导入这类秒级活）----
    "story_import": "text",
}
CATEGORY_LABEL = {"image": "图像", "audio": "音频", "text": "文本", "other": "其他"}
#: 面板里的排列顺序
CATEGORY_ORDER = ("audio", "image", "text", "other")

#: 这些状态代表「还在机器上占着」，暂停也算活着（还要能点继续）
LIVE = ("queued", "running", "paused")
#: 已结束的状态
DEAD = ("done", "partial", "error", "canceled")


class JobCanceled(Exception):
    """工作线程收到取消请求：一路往上抛，由线程入口统一收尾。"""


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def create(kind: str, title: str, *, page: str = "", total: int = 1,
           focus: dict | None = None, message: str = "",
           category: str = "") -> dict:
    """建一个 running 状态的任务。

    category 不传就按 kind 自动归类（见 KIND_CATEGORY）。
    started_ts 是浮点秒，用来算「已用多久 / 还剩多久」——面板要给出等待预期，
    光有进度条是不够的（用户的原话：不知道要等多长时间）。
    """
    prune()
    jid = uuid.uuid4().hex[:12]
    job = {
        "id": jid,
        "kind": kind,                 # pose_batch / appearance_render / voice_pack ...
        "category": (category or KIND_CATEGORY.get(kind) or "other"),
        "title": title,
        "page": page,                 # 点击跳转的后台栏目
        "focus": focus or {},         # 页面用来定位（人物 id、tab 等）
        "total": max(1, int(total)),
        "done": 0,
        "failed": 0,
        "status": "running",          # queued/running/paused/done/partial/error/canceled
        "message": message,
        "results": [],
        "images": [],
        "audio": [],
        "started_at": _now_iso(),
        "started_ts": time.time(),
        "finished_at": "",
        "finished_ts": 0.0,
        "updated_ts": time.time(),
        # ---- 控制位（对外暴露给面板画按钮，内部以下划线字段为准）----
        "paused": False,
        "canceling": False,
        "_cancel": False,
        "_pause": False,
    }
    with _lock:
        _jobs[jid] = job
    return _public(dict(job))


def _public(j: dict) -> dict:
    """去掉下划线开头的内部控制位再给前端，并补上「已用 / 预计剩余」。"""
    d = {k: v for k, v in j.items() if not k.startswith("_")}
    cat = d.get("category") or "other"
    d["category"] = cat
    d["category_label"] = CATEGORY_LABEL.get(cat, "其他")

    t0 = float(j.get("started_ts") or 0)
    now = float(j.get("finished_ts") or 0) or time.time()
    elapsed = max(0.0, now - t0) if t0 else 0.0
    processed = int(d.get("done") or 0) + int(d.get("failed") or 0)
    total = int(d.get("total") or 0)
    # 已处理过的条数才有「单条约耗时」可算；一条都没完成时不给数字，
    # 前端显示「计算中…」——瞎猜一个剩余时间比不显示更让人焦虑。
    d["elapsed_sec"] = round(elapsed, 1)
    d["per_item_sec"] = round(elapsed / processed, 2) if processed else None
    if d.get("status") in ("running", "paused", "queued") and processed and total > processed:
        d["eta_sec"] = round(elapsed / processed * (total - processed), 1)
    elif d.get("status") in ("running", "paused", "queued") and processed >= total:
        d["eta_sec"] = 0.0
    else:
        d["eta_sec"] = None
    return d



def get(job_id: str) -> dict | None:
    with _lock:
        j = _jobs.get(job_id)
        return _public(dict(j)) if j else None


def list_jobs() -> list[dict]:
    prune()
    with _lock:
        items = [_public(dict(j)) for j in _jobs.values()]
    items.sort(key=lambda j: j["updated_ts"], reverse=True)
    return items


def active() -> list[dict]:
    return [j for j in list_jobs() if j["status"] == "running"]


def counts() -> dict:
    """各状态数量（顶栏图标 / 面板统计用）。"""
    with _lock:
        c: dict[str, int] = {}
        for j in _jobs.values():
            c[j["status"]] = c.get(j["status"], 0) + 1
    return c


def category_counts() -> dict:
    """按「在跑 / 等待 / 暂停」统计各分类数量（面板分类标签上的小数字）。"""
    out: dict[str, dict] = {}
    with _lock:
        for j in _jobs.values():
            if j["status"] not in LIVE:
                continue
            cat = j.get("category") or "other"
            slot = out.setdefault(cat, {"live": 0, "running": 0, "paused": 0})
            slot["live"] += 1
            if j["status"] == "paused":
                slot["paused"] += 1
            elif j["status"] == "running":
                slot["running"] += 1
    return out


def update(job_id: str, **kw) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return
        j.update({k: v for k, v in kw.items()})
        j["updated_ts"] = time.time()


def step(job_id: str, *, ok: bool, result: dict | None = None,
         image: str = "", audio: str = "", message: str = "") -> None:
    """记一步结果（成功/失败都会推进 done 计数）。

    image / audio 分别收进各自的产物列表：面板要按分类给不同的「查看」动作
    （图 → 图片浏览，音 → 直接试听最后一条）。
    """
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return
        if ok:
            j["done"] += 1
            if image:
                j["images"].append(image)
            if audio:
                j["audio"].append(audio)
        else:
            j["failed"] += 1
        if result:
            j["results"].append(result)
            if len(j["results"]) > 200:
                j["results"] = j["results"][-200:]
        if message:
            j["message"] = message
        j["updated_ts"] = time.time()


def finish(job_id: str, *, status: str | None = None, message: str = "") -> None:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return
        if status is None:
            status = "done" if j["done"] and not j["failed"] else (
                "partial" if j["done"] else "error")
        j["status"] = status
        j["paused"] = False
        j["_pause"] = False
        j["finished_at"] = _now_iso()
        j["finished_ts"] = time.time()
        if message:
            j["message"] = message
        j["updated_ts"] = time.time()



def fail(job_id: str, message: str) -> None:
    finish(job_id, status="error", message=message)


# ===================== 暂停 / 继续 / 取消 =====================

def request_pause(job_id: str) -> bool:
    """暂停一条任务。执行中的当前那张图会被打断，继续后重跑这一张。"""
    with _lock:
        j = _jobs.get(job_id)
        if not j or j["status"] not in ("queued", "running"):
            return False
        if j.get("nopause"):        # 漫画队列是整队暂停，单条不支持
            return False
        j["_pause"] = True
        j["paused"] = True
        j["status"] = "paused"
        j["message"] = "已暂停，继续后重新生成这一张" if j["done"] or j["status"] == "running" else "已暂停"
        j["updated_ts"] = time.time()
    return True


def request_resume(job_id: str) -> bool:
    with _lock:
        j = _jobs.get(job_id)
        if not j or j["status"] != "paused":
            return False
        j["_pause"] = False
        j["paused"] = False
        j["status"] = "running"
        j["message"] = "继续中…"
        j["updated_ts"] = time.time()
    return True


def request_cancel(job_id: str) -> bool:
    """取消一条任务：置旗标，工作线程会在最近的一个卡点退出。"""
    ctl = None
    with _lock:
        j = _jobs.get(job_id)
        if not j or j["status"] in DEAD:
            return False
        j["_cancel"] = True
        j["canceling"] = True
        j["_pause"] = False          # 取消要能穿过「暂停中」的等待
        j["paused"] = False
        j["message"] = "正在取消…"
        j["updated_ts"] = time.time()
        # 非 jobs 线程自己跑的任务（漫画队列）注册了 cancel 回调，交给它真去掐
        ctl = (j.get("_ctl") or {}).get("cancel")
    if ctl:
        try:
            ctl()
        except Exception:  # noqa: BLE001
            pass
    return True


def is_canceled(job_id: str) -> bool:
    with _lock:
        j = _jobs.get(job_id)
        return bool(j and j["_cancel"])


def abort_now(job_id: str) -> bool:
    """传给 ComfyUI 客户端的 should_cancel：返回 True 就打断当前这张图。

    暂停也算「打断当前」—— 图没法出半张，暂停执行中的任务本来就是强行打断。
    """
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            return True
        return bool(j["_cancel"] or j["_pause"])


def gate(job_id: str) -> None:
    """工作线程的卡点。

    · 已请求取消 → 抛 JobCanceled，让线程一层层退出去；
    · 已请求暂停 → 原地阻塞（每 0.15s 看一眼），继续后自动放行；
    · 任务被删掉（面板里删除记录）→ 也按取消处理。
    """
    while True:
        with _lock:
            j = _jobs.get(job_id)
            if j is None or j["_cancel"]:
                raise JobCanceled()
            paused = bool(j["_pause"])
        if not paused:
            return
        time.sleep(0.15)


def pause_all() -> int:
    n = 0
    for j in list_jobs():
        if j["status"] in ("queued", "running") and request_pause(j["id"]):
            n += 1
    return n


def resume_all() -> int:
    n = 0
    for j in list_jobs():
        if j["status"] == "paused" and request_resume(j["id"]):
            n += 1
    return n


def cancel_all() -> int:
    """取消并清空所有「未结束」的任务（运行中 / 等待中 / 已暂停）。

    和 pause_all 的区别：
      · pause_all 只是挂起，任务仍留在队列里，稍后还能被「全部开始」唤醒 ——
        这就是用户看到的「暂停后还在排队、有时又自己跑起来」。
      · cancel_all 先置取消旗标让工作线程在最近的卡点退出（ComfyUI 客户端的
        should_cancel 也会立刻打断当前这张图），随后把记录从队列里删掉，
        面板上不再残留，也不会被重新唤起。
    """
    n = 0
    with _lock:
        live = [k for k, v in _jobs.items() if v["status"] not in DEAD]
    for k in live:
        if request_cancel(k):
            n += 1
    # request_cancel 已同步触发了漫画队列等外部 cancel 回调；
    # 这里再把记录摘掉，工作线程下一次 gate() 看到 j is None 会抛 JobCanceled 退出。
    with _lock:
        for k in live:
            _jobs.pop(k, None)
    return n


def remove(job_id: str) -> bool:
    """从列表里彻底删掉（活着的话先取消）。"""
    request_cancel(job_id)
    with _lock:
        return _jobs.pop(job_id, None) is not None


def prune() -> None:
    cutoff = time.time() - KEEP_FINISHED_SEC
    with _lock:
        dead = [k for k, v in _jobs.items()
                if v["status"] in DEAD and v["updated_ts"] < cutoff]
        for k in dead:
            _jobs.pop(k, None)


def clear_finished() -> int:
    """清掉所有已结束的任务（面板「清空已完成」用）。"""
    with _lock:
        dead = [k for k, v in _jobs.items() if v["status"] in DEAD]
        for k in dead:
            _jobs.pop(k, None)
        return len(dead)


def spawn(fn: Callable[..., Any], *args, **kwargs) -> threading.Thread:
    t = threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True)
    t.start()
    return t


def guard(job_id: str, fn: Callable[..., Any], *args, **kwargs) -> None:
    """线程入口统一包一层：工作线程抛 JobCanceled 就直接收尾成「已取消」。

    用法：jobs.spawn(jobs.guard, job_id, _run_pose_batch, job_id, ...)
    """
    try:
        fn(*args, **kwargs)
    except JobCanceled:
        finish(job_id, status="canceled", message="已取消")
    except Exception as e:  # noqa: BLE001
        fail(job_id, str(e) or "未知错误")
