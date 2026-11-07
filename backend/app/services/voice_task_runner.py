"""语音任务执行器：一批人物台词 → 逐条合成 → 识别裁剪 → 写入角色声音包。

跑在后台线程里，前端只轮询进度，所以关掉页面也不影响正在跑的任务
（但进程重启会中断，重进任务点「继续」即可从没做完的那条接着来）。

2026-11 补充：整批任务同时登记进「任务中心」（jobs），分类 audio。
以前语音包只活在自己的弹窗里，一关窗口就彻底看不见后台在干什么，
批量跑起来也不知道还要等多久；现在右上角任务面板能看到进度、剩余时间和试听入口。

为什么不放进 API 请求里同步跑：
    一句合成 1~3 秒，三十句就是一分钟，HTTP 早超时了。
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import traceback

from .. import jobs
from ..database import SessionLocal
from ..models.sound import Sound
from ..models.voice_task import VoiceTask, VoiceTaskLine
from . import audio_trim
from .tts.base import SynthRequest
from .tts import service as tts_service

# 产物落地目录：frontend/audio 是 /audio 静态挂载点，写进去立刻能被播放
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIO_DIR = os.path.normpath(os.path.join(_BACKEND_DIR, "..", "frontend", "audio"))
VOICE_SUBDIR = "voice_pack"

_running: dict[int, dict] = {}
_lock = threading.Lock()


def is_running(task_id: int) -> bool:
    with _lock:
        st = _running.get(int(task_id))
        return bool(st and st["thread"].is_alive())


def job_id_of(task_id: int) -> str:
    """这条语音包当前挂着的任务中心记录（没有就返回空串）。"""
    with _lock:
        st = _running.get(int(task_id))
        return (st or {}).get("job_id") or ""


def running_ids() -> list[int]:
    with _lock:
        return [k for k, v in _running.items() if v["thread"].is_alive()]


def stop(task_id: int) -> bool:
    with _lock:
        st = _running.get(int(task_id))
        if not st:
            return False
        st["cancel"].set()
    return True


def _todo_of(db, task_id: int, rerun_failed: bool, only_ids: list[int] | None):
    """这条任务本轮要处理哪些行（和 _run 里同一套口径，建任务时先数一遍）。"""
    q = db.query(VoiceTaskLine).filter(VoiceTaskLine.task_id == int(task_id))
    if only_ids:
        q = q.filter(VoiceTaskLine.id.in_([int(x) for x in only_ids]))
    lines = q.order_by(VoiceTaskLine.sort.asc(), VoiceTaskLine.id.asc()).all()
    return [l for l in lines if l.status in ("pending", "")
            or (rerun_failed and l.status == "error")]


def start(task_id: int, rerun_failed: bool = False,
          only_ids: list[int] | None = None,
          make_job: bool = True) -> tuple[bool, str | None]:
    """起一个后台线程跑任务。返回 (是否启动, 任务中心 job_id)。

    同一任务已经在跑就直接拒绝，避免两条线程抢同一批行。
    """
    task_id = int(task_id)
    if is_running(task_id):
        return False, None

    job_id: str | None = None
    if make_job:
        db = SessionLocal()
        try:
            task = db.query(VoiceTask).filter(VoiceTask.id == task_id).first()
            if not task:
                return False, None
            todo_n = len(_todo_of(db, task_id, rerun_failed, only_ids))
            title = f"语音包 · {task.name}"
        finally:
            db.close()
        job = jobs.create("voice_pack", title, page="voice_tasks",
                          total=max(1, todo_n), focus={"task_id": task_id},
                          message="排队中，准备逐条合成…")
        job_id = job["id"]

    cancel = threading.Event()
    th = threading.Thread(target=_run, args=(task_id, cancel, rerun_failed, only_ids, job_id),
                          name=f"voice-task-{task_id}", daemon=True)
    with _lock:
        _running[task_id] = {"thread": th, "cancel": cancel, "job_id": job_id}
    if job_id:
        # 面板上点「取消」直接掐线程（不然只是把记录删了，音频还在继续生成）
        jobs.update(job_id, _ctl={"cancel": cancel.set})
    th.start()
    return True, job_id


# ----------------------------------------------------------------------------
# 命名与落盘
# ----------------------------------------------------------------------------
_PUNCT = "　 ，。、；：？！“”‘’（）【】《》…—·,.!?;:\"'()[]<>\n\r\t"


def sound_name(text: str, limit: int = 8) -> str:
    """声音名称 = 文本前面若干个中文字。取不到中文就退回字母数字。"""
    t = (text or "").strip()
    han = re.findall(r"[\u4e00-\u9fff]", t)
    if han:
        name = "".join(han[:limit])
    else:
        name = re.sub(r"[\s" + re.escape(_PUNCT) + "]+", "", t)[:limit]
    return name or "台词"


def _safe_seg(s: str, limit: int = 40) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff-]+", "_", (s or "").strip())[:limit]


def _unique_path(stem: str, subdir: str = "") -> tuple[str, str]:
    """给声音文件取一个不撞车的名字。返回 (绝对路径, 相对 /audio 的 url)。

    subdir 传分类路径（如「剧情语音/破庙雨夜」）时会落成同名子目录，
    避免几百上千条台词全平铺在 voice_pack 根下互相挤名字。
    """
    d = os.path.join(AUDIO_DIR, VOICE_SUBDIR)
    rel = ""
    segs = [_safe_seg(p) for p in re.split(r"[/\\]+", (subdir or "").strip()) if _safe_seg(p)]
    if segs:
        d = os.path.join(d, *segs)
        rel = "/" + "/".join(segs)
    os.makedirs(d, exist_ok=True)
    safe = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", stem)[:60] or "voice"
    fn = safe + ".wav"
    i = 2
    while os.path.exists(os.path.join(d, fn)):
        fn = f"{safe}_{i}.wav"
        i += 1
    return os.path.join(d, fn), f"/audio/{VOICE_SUBDIR}{rel}/{fn}"


# ----------------------------------------------------------------------------
# 主循环
# ----------------------------------------------------------------------------
def _run(task_id: int, cancel: threading.Event, rerun_failed: bool,
         only_ids: list[int] | None, job_id: str | None = None) -> None:
    db = SessionLocal()
    job_done = False
    try:
        task = db.query(VoiceTask).filter(VoiceTask.id == task_id).first()
        if not task:
            if job_id:
                jobs.fail(job_id, "语音任务已不存在")
            return
        q = db.query(VoiceTaskLine).filter(VoiceTaskLine.task_id == task_id)
        if only_ids:
            q = q.filter(VoiceTaskLine.id.in_([int(x) for x in only_ids]))
        lines = q.order_by(VoiceTaskLine.sort.asc(), VoiceTaskLine.id.asc()).all()

        # 只跑「还没做」的；要求重跑失败的就带上 error 的
        todo = [l for l in lines if l.status in ("pending", "")
                or (rerun_failed and l.status == "error")]
        # 进度口径永远按整个语音包算（total = 全部行），不能只看本次过滤出的子集
        all_lines = db.query(VoiceTaskLine).filter(VoiceTaskLine.task_id == task_id).all()
        task.total = len(all_lines)
        task.done = sum(1 for l in all_lines if l.status == "done")
        task.status = "running"
        task.message = "开始处理…"
        db.commit()
        # 任务中心的进度按「本轮真正要做的条数」算，否则只重跑 1 条也会显示 1/30
        if job_id:
            jobs.update(job_id, total=max(1, len(todo)),
                        message=f"开始处理 {len(todo)} 条台词…")

        opts = {}
        if task.trim_opts:
            try:
                opts = json.loads(task.trim_opts)
            except Exception:  # noqa: BLE001
                opts = {}

        gender = "unknown"
        cfg = {"engine": (task.engine or ""), "voice_id": (task.voice_id or ""),
               "rate": int(task.rate or 0), "pitch": int(task.pitch or 0),
               "volume": int(task.volume or 0), "gender": gender}
        if task.character_id:
            try:
                from ..models.character import Character
                ch = db.query(Character).filter(Character.id == task.character_id).first()
                if ch:
                    cfg["gender"] = (getattr(ch, "gender", "") or "unknown")
                    # 任务里没单独指定音色，就自动沿用「人物管理 → 语音」那一屏的配置，
                    # 这样「这个任务用的是这个人物的声音」不需要再配一遍。
                    if not cfg["voice_id"]:
                        cfg["voice_id"] = getattr(ch, "tts_voice", "") or ""
                    if not cfg["engine"]:
                        cfg["engine"] = getattr(ch, "tts_engine", "") or ""
                    if not cfg["rate"]:
                        cfg["rate"] = int(getattr(ch, "tts_rate", 0) or 0)
                    if not cfg["pitch"]:
                        cfg["pitch"] = int(getattr(ch, "tts_pitch", 0) or 0)
                    if not cfg["volume"]:
                        cfg["volume"] = int(getattr(ch, "tts_volume", 0) or 0)
            except Exception:  # noqa: BLE001
                pass

        fail = 0
        for idx, line in enumerate(todo):
            if cancel.is_set():
                task.status = "stopped"
                task.message = f"已停止（完成 {task.done}/{task.total}）"
                db.commit()
                if job_id:
                    jobs.finish(job_id, status="canceled",
                                message=f"已停止（完成 {task.done}/{task.total}）")
                    job_done = True
                return
            # 任务面板的「暂停 / 取消」卡点：暂停在这里原地等，取消抛 JobCanceled
            if job_id:
                try:
                    jobs.gate(job_id)
                except jobs.JobCanceled:
                    task.status = "stopped"
                    task.message = f"已取消（完成 {task.done}/{task.total}）"
                    db.commit()
                    jobs.finish(job_id, status="canceled",
                                message=f"已取消（完成 {task.done}/{task.total}）")
                    job_done = True
                    return
            line.status = "running"
            task.message = f"正在合成：{sound_name(line.text, 12)}…"
            db.commit()
            done_before = task.done or 0
            got: dict = {}
            try:
                got = _one_line(db, task, line, opts, cfg)
                line.status = "done"
                line.duration = got["duration"]
                line.error = ""
                task.done = done_before + 1
            except Exception as exc:  # noqa: BLE001
                fail += 1
                line.status = "error"
                line.error = f"{exc}"[:400]
                task.message = f"有一条失败：{sound_name(line.text, 10)}（{exc}）"[:200]
            db.commit()
            if job_id:
                if line.status == "done":
                    jobs.step(job_id, ok=True, audio=got.get("url") or "",
                              result={"line_id": line.id, "text": line.text,
                                      "sound_id": line.sound_id,
                                      "url": got.get("url") or "",
                                      "name": got.get("name") or "",
                                      "duration": line.duration},
                              message=f"{idx + 1}/{len(todo)} · {sound_name(line.text, 12)}")
                else:
                    jobs.step(job_id, ok=False,
                              result={"line_id": line.id, "text": line.text,
                                      "error": line.error},
                              message=f"{idx + 1}/{len(todo)} · 失败：{sound_name(line.text, 10)}")
            # 给前端一点喘息时间，也让「停止」按钮有响应机会
            time.sleep(0.05)

        task.status = "done"
        task.message = (f"全部完成：{task.done}/{task.total}" if not fail
                        else f"完成 {task.done}/{task.total}，失败 {fail} 条（可单独重跑）")
        db.commit()
        if job_id:
            jobs.finish(job_id, status=("partial" if fail else "done"),
                        message=task.message)
            job_done = True
    except Exception:  # noqa: BLE001
        err = traceback.format_exc()[-400:]
        try:
            task = db.query(VoiceTask).filter(VoiceTask.id == task_id).first()
            if task:
                task.status = "error"
                task.message = err
                db.commit()
        except Exception:  # noqa: BLE001
            pass
        if job_id and not job_done:
            jobs.fail(job_id, err[:200])
            job_done = True
    finally:
        db.close()
        with _lock:
            _running.pop(int(task_id), None)


def _one_line(db, task: VoiceTask, line: VoiceTaskLine, opts: dict, cfg: dict) -> dict:
    """合成一条 → 裁静音 → 存声音 → 回写 line。返回 {duration, url, name}。"""
    text = (line.text or "").strip()
    if not text:
        raise RuntimeError("内容为空")

    engine_id = (cfg.get("engine") or "").strip() or None
    req = SynthRequest(
        text=text,
        voice_id=cfg.get("voice_id") or "",
        rate=int(cfg.get("rate") or 0),
        pitch=int(cfg.get("pitch") or 0),
        volume=int(cfg.get("volume") or 0),
    )
    res = tts_service.synth_sync(req, engine_id, allow_degrade=True,
                                 gender=cfg.get("gender") or "unknown")
    if res.error or not res.path or not os.path.exists(res.path):
        raise RuntimeError(res.error or "合成没有产出音频")

    # 合成出来通常是 mp3，识别裁剪要 PCM，先统一成 44.1k 单声道 wav
    wav = audio_trim.to_wav(res.path)
    dst, url = _unique_path(f"{sound_name(text, task.name_len or 8)}",
                            getattr(task, "pack_path", "") or "")
    # 台词必须整句：用 trim_tts（span 语义），不能用录音那套 longest，
    # 否则一句话里的逗号停顿会被切成多段、只剩最长的那段，长句直接丢半句。
    out = audio_trim.trim_tts(wav, dst, opts)
    if not out.get("ok"):
        # 裁不出来（比如整段都没声）就退回未裁剪版本，至少别把这条丢掉
        import shutil
        shutil.copyfile(wav, dst)
        out = {"ok": True, "duration": audio_trim.wav_info(dst)["duration"], "fallback": True}

    dur = float(out.get("duration") or audio_trim.wav_info(dst)["duration"] or 0.0)
    name = sound_name(text, task.name_len or 8)

    sound = Sound(
        name=name,
        category="voice",
        category_path=(task.pack_path or "").strip(),
        file_path=dst,
        file_url=url,
        file_format="wav",
        duration=dur,
        description=text,
    )
    db.add(sound)
    db.flush()  # 拿到 id 再回写 line
    line.sound_id = sound.id
    return {"duration": dur, "url": url, "name": name, "sound_id": sound.id}


# ----------------------------------------------------------------------------
# 追加文本（按行拆）
# ----------------------------------------------------------------------------
def split_lines(raw: str) -> list[str]:
    """批量粘贴的文本 → 一条一行。空行丢掉，行首行尾的序号/项目符号顺手清掉。"""
    out = []
    for ln in (raw or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        t = ln.strip()
        if not t:
            continue
        t = re.sub(r"^[\s\-*•·、]+", "", t)
        t = re.sub(r"^\d+[.、)\]]\s*", "", t)
        t = t.strip()
        if t:
            out.append(t)
    return out
