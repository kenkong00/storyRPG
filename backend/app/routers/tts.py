"""剧情角色语音（TTS）接口。

设计上有一条主线：**让前端尽量少干活**。
最典型的就是 POST /api/tts/nodes —— 前端只要抛一个剧情节点 ID 过来，
后端负责查出该节点下所有对话、每个人的音色/性别/语速配置，一次性合成好再连同
说话人信息一起返回。前端拿到就是一份「按顺序排好的音频清单」，
照着播就行，不必自己拼配置、也不用知道角色用的是哪个引擎。
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.character import Character
from ..models.story import StoryChapter, StoryNode, StoryNodeDialogue
from ..services.tts import service as tts
from ..services.tts.base import SynthRequest
from .. import jobs

# 整章预载的并发数与句子数上限：别和玩家正在听的实时合成抢带宽，
# 也别在极端情况下把整章预载拖成几个小时的任务。
TTS_CHAPTER_WORKERS = 2
TTS_CHAPTER_PRELOAD_CAP = 2000

router = APIRouter(prefix="/api/tts", tags=["人物语音"])


# ---------------------------------------------------------------- 请求模型
class SynthIn(BaseModel):
    text: str
    engine_id: Optional[str] = None
    voice_id: Optional[str] = None
    rate: int = Field(default=0, ge=-100, le=100)
    pitch: int = Field(default=0, ge=-100, le=100)
    volume: int = Field(default=0, ge=-100, le=100)
    gender: str = "unknown"
    character_id: Optional[int] = None   # 给了就用该角色的语音配置
    allow_degrade: bool = True


class BatchItem(BaseModel):
    key: Optional[str] = None
    text: str
    engine_id: Optional[str] = None
    voice_id: Optional[str] = None
    rate: int = 0
    pitch: int = 0
    gender: str = "unknown"
    character_id: Optional[int] = None


class BatchIn(BaseModel):
    items: list[BatchItem]


class NodesIn(BaseModel):
    node_ids: list[int]
    include_single_line_nodes: bool = True  # 兼容没有 dialogues 的旧单句节点


# ---------------------------------------------------------------- 辅助
def _apply_character(cfg: dict[str, Any], ch: Character | None) -> dict[str, Any]:
    """角色存在且前端没显式覆盖时，用角色身上配好的语音参数。"""
    if ch is None:
        return cfg
    # 注意：这里不能用 dict.setdefault —— 它对「键已存在但值为空字符串」不会做任何覆盖，
    # 而下面构造的 cfg 恰恰是先把 voice_id/engine_id 初始化成了 ''。
    # 结果就是角色的音色配置一个也传不下去，全部落回默认音色——
    # 男女音色分不开就是这个原因。必须显式判空再填。
    if not cfg.get("voice_id"):
        cfg["voice_id"] = ch.tts_voice or ""
    if not cfg.get("engine_id"):
        cfg["engine_id"] = ch.tts_engine or ""
    cfg["gender"] = ch.gender or "unknown"
    if not cfg.get("rate") and ch.tts_rate:
        cfg["rate"] = ch.tts_rate
    if not cfg.get("pitch") and ch.tts_pitch:
        cfg["pitch"] = ch.tts_pitch
    if not cfg.get("volume") and ch.tts_volume:
        cfg["volume"] = ch.tts_volume
    return cfg


def _apply_card_voice(db: Session, cfg: dict[str, Any], ch_id: int | None) -> dict[str, Any]:
    """卡牌系统里给「这个角色当卡牌角色时」单独绑的音色，优先级高于人物默认配置。

    后台「卡牌系统 → 战斗情感 → 情感与表现 → 绑定音色」存的是
    CardCharacterProfile.tts_*，而 /tts/synth 以前只读 Character.tts_*，
    两边各存各的 —— 于是不管在卡牌页给角色挑了多好的嗓子，
    战斗里永远还是同一个默认音（玩家口中的「老旧喇叭音」）。
    """
    if not ch_id:
        return cfg
    try:
        from ..models.cardgame import CardCharacterProfile
        prof = db.query(CardCharacterProfile).filter(
            CardCharacterProfile.character_id == int(ch_id)).first()
    except Exception:  # noqa: BLE001  卡牌模块缺席时不影响剧情语音
        return cfg
    if not prof:
        return cfg
    if (prof.tts_engine or "").strip():
        cfg["engine_id"] = prof.tts_engine.strip()
    if (prof.tts_voice_id or "").strip():
        cfg["voice_id"] = prof.tts_voice_id.strip()
    for key, col in (("rate", prof.tts_rate), ("pitch", prof.tts_pitch),
                     ("volume", prof.tts_volume)):
        v = str(col or "").strip()
        if v:
            try:
                cfg[key] = int(v)
            except ValueError:
                pass
    return cfg


def _char_map(db: Session, ids: set[int]) -> dict[int, Character]:
    if not ids:
        return {}
    rows = db.query(Character).filter(Character.id.in_(ids)).all()
    return {c.id: c for c in rows}


def _build_node_items(db: Session, node_ids: list[int],
                      include_single: bool) -> list[dict[str, Any]]:
    """把一个/多个剧情节点展开成「句」的清单，附带每句该用什么音色。"""
    items: list[dict[str, Any]] = []
    nodes = db.query(StoryNode).filter(StoryNode.id.in_(node_ids)).all()
    node_map = {n.id: n for n in nodes}
    dlgs = (db.query(StoryNodeDialogue)
            .filter(StoryNodeDialogue.node_id.in_(node_ids))
            .order_by(StoryNodeDialogue.node_id,
                      StoryNodeDialogue.order_index,
                      StoryNodeDialogue.id)
            .all())
    char_ids = {(d.speaker_id or 0) for d in dlgs} | {(n.speaker_id or 0) for n in nodes}
    char_ids.discard(0)
    chars = _char_map(db, char_ids)

    covered_nodes: set[int] = set()
    for d in dlgs:
        covered_nodes.add(d.node_id)
        text = (d.content or "").strip()
        if not text:
            continue
        ch = chars.get(d.speaker_id or 0)
        cfg = _apply_character({
            "voice_id": "", "engine_id": "", "rate": 0, "pitch": 0, "volume": 0,
        }, ch)
        items.append({
            "key": f"dialogue-{d.id}",
            "node_id": d.node_id,
            "dialogue_id": d.id,
            "order_index": d.order_index,
            "speaker_id": d.speaker_id,
            "speaker_name": ch.name if ch else "旁白",
            "text": text,
            "manual_voice": (d.voice or "").strip(),  # 后台手工指定的音频优先
            **cfg,
        })

    if include_single:
        # 没有 dialogues 子表的旧式节点：节点自身的 speaker_id + content 就是一句话
        for nid in node_ids:
            if nid in covered_nodes:
                continue
            n = node_map.get(nid)
            if not n or not (n.content or "").strip():
                continue
            ch = chars.get(n.speaker_id or 0)
            cfg = _apply_character({
                "voice_id": "", "engine_id": "", "rate": 0, "pitch": 0, "volume": 0,
            }, ch)
            items.append({
                "key": f"node-{nid}",
                "node_id": nid,
                "dialogue_id": None,
                "order_index": 0,
                "speaker_id": n.speaker_id,
                "speaker_name": ch.name if ch else "旁白",
                "text": n.content.strip(),
                "manual_voice": "",
                **cfg,
            })
    return items


# ---------------------------------------------------------------- 接口
@router.get("/engines")
def get_engines(db: Session = Depends(get_db)):
    """所有语音引擎及其可用状态。"""
    return {"engines": tts.list_engines(), "default": tts.registry.default_engine()}


@router.get("/voices")
def get_voices(
    engine_id: Optional[str] = Query(None),
    grouped: bool = Query(True, description="按引擎+性别分组返回，便于后台下拉"),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    if grouped:
        return {"groups": tts.list_all_voices_grouped()}
    return {"voices": [v.to_dict() for v in tts.list_voices(engine_id, refresh=refresh)]}


@router.post("/synth")
async def synth_one(body: SynthIn, db: Session = Depends(get_db)):
    """合成单句。前端用来给当前正在显示的那句话兜底补音频。"""
    ch = None
    if body.character_id:
        ch = db.query(Character).filter(Character.id == body.character_id).first()
    cfg = _apply_character({
        "voice_id": body.voice_id or "", "engine_id": body.engine_id or "",
        "rate": body.rate, "pitch": body.pitch, "volume": body.volume,
        "gender": body.gender,
    }, ch)
    cfg = _apply_card_voice(db, cfg, body.character_id)

    from ..services.tts.base import SynthRequest
    req = SynthRequest(text=body.text, voice_id=cfg["voice_id"],
                       rate=cfg["rate"], pitch=cfg["pitch"],
                       volume=cfg.get("volume", 0), out_format="mp3")
    r = await tts.synth_async(req, cfg.get("engine_id") or None,
                              allow_degrade=body.allow_degrade,
                              gender=cfg.get("gender", "unknown"))
    return {
        "url": r.url, "duration_ms": r.duration_ms, "engine": r.engine,
        "voice_id": r.voice_id, "cached": r.cached, "degraded": r.degraded,
        "error": r.error, "bytes": r.bytes,
    }


@router.post("/batch")
async def synth_many(body: BatchIn, db: Session = Depends(get_db)):
    """批量合成。前端在显示第 N 句时预先把后面的句子提交到这里。"""
    if not body.items:
        return {"items": []}
    payload: list[dict[str, Any]] = []
    for it in body.items:
        ch = None
        if it.character_id:
            ch = db.query(Character).filter(Character.id == it.character_id).first()
        cfg = _apply_character({
            "voice_id": it.voice_id or "", "engine_id": it.engine_id or "",
            "rate": it.rate, "pitch": it.pitch,
        }, ch)
        payload.append({
            "key": it.key, "text": it.text, **cfg,
        })
    return {"items": await tts.synth_batch(payload)}


@router.post("/nodes")
async def synth_nodes(body: NodesIn, db: Session = Depends(get_db)):
    """按剧情节点批量预合成 —— 「第三层预取」的入口。

    返回按 (node_id, order_index) 排好序的清单，每项都带上 speaker 信息，
    前端直接按 key 索引播放即可。手工指定过音频的句子直接返回原 URL，不再合成。
    """
    if not body.node_ids:
        return {"items": []}
    prepared = _build_node_items(db, body.node_ids, body.include_single_line_nodes)
    if not prepared:
        return {"items": []}

    todo: list[dict[str, Any]] = []
    results: dict[str, dict[str, Any]] = {}
    for p in prepared:
        if p.get("manual_voice"):
            # 后台为该句手工指定了音频文件，直接用，不必走合成
            results[p["key"]] = {
                "key": p["key"], "url": p["manual_voice"], "bytes": 0,
                "duration_ms": 0, "engine": "manual", "cached": True,
                "degraded": False, "error": "", "manual": True,
            }
        else:
            todo.append(p)

    if todo:
        batch = await tts.synth_batch(todo)
        for row, src in zip(batch, todo):
            results[src["key"]] = row

    out: list[dict[str, Any]] = []
    for p in prepared:
        row = dict(results.get(p["key"], {}))
        row.update({
            "key": p["key"], "node_id": p["node_id"],
            "dialogue_id": p.get("dialogue_id"), "order_index": p.get("order_index", 0),
            "speaker_id": p.get("speaker_id"), "speaker_name": p.get("speaker_name", "旁白"),
            "text": p["text"],
        })
        out.append(row)
    out.sort(key=lambda r: (r["node_id"], r["order_index"]))
    return {"items": out, "count": len(out)}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return {
        "engines": tts.list_engines(),
        "default_engine": tts.registry.default_engine(),
        "ffmpeg": tts.ffmpeg_available(),
        "cache": tts.cache_info(),
        "breaker": tts.breaker_state(),
    }


@router.post("/reset")
def reset(db: Session = Depends(get_db)):
    """一键复位语音子系统。

    什么时候用：语音卡住过、或者换了音色/引擎之后还是不生效。
    做的事：清熔断 → 重建线程池与信号量 → 重启本机语音子进程。
    不会影响正在播放的音频，也不会中断剧情。
    """
    info = tts.reset()
    return {**info, "engines": tts.list_engines(), "breaker": tts.breaker_state()}


@router.post("/warmup")
def warmup(db: Session = Depends(get_db)):
    """预热：提前把在线连接、本机 daemon 的冷启动成本付掉。

    建议在玩家点开某段剧情之前调用一次，把这笔开销挪到他还没开口的时候。
    （实测本机 daemon 冷启动 2.6s、在线首次握手 1.4s，不预热的话
      玩家会把这两秒算到第一句台词的账上，观感就是「卡了一下」。）
    """
    return tts.warmup()


@router.get("/cache")
def cache_info(db: Session = Depends(get_db)):
    return tts.cache_info()


@router.post("/cache/clear")
def cache_clear(older_than_hours: Optional[float] = None, db: Session = Depends(get_db)):
    return tts.clear_cache(older_than_hours)


@router.post("/reload")
def reload_config(db: Session = Depends(get_db)):
    """重新读取 data/tts_config.json —— 新增语音大模型引擎后不必重启后端。"""
    added = tts.reload_http_config()
    return {"ok": True, "engines": added, "all": tts.list_engines()}


# ---------------------------------------------------------------- 整章预载
@router.post("/chapter/{chapter_id}")
def preload_chapter(chapter_id: int, db: Session = Depends(get_db)):
    """整章语音预载 —— 「进入章节就事前装载」方案的核心。

    把整章所有对话句子（含旧式单句节点）后台合成进磁盘缓存。
    玩家游玩时按节点取用即缓存命中（0ms 合成），不再每翻一节点就现场合成 1~3 秒。
    接口本身不阻塞：立即返回总数与任务号，合成在后台线程跑。

    缓存键与 /tts/synth、/tts/nodes 完全一致（engine+voice+rate+pitch+volume+text），
    所以预载写进去的文件，后面节点播放时直接命中，前端甚至不需要改播放逻辑。
    """
    chapter = db.query(StoryChapter).filter(StoryChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(404, "章节不存在")

    nodes = (db.query(StoryNode)
             .filter(StoryNode.chapter_id == chapter_id)
             .order_by(StoryNode.order_index, StoryNode.id)
             .all())
    node_ids = [n.id for n in nodes]
    if not node_ids:
        return {"ok": True, "total": 0, "job_id": None, "message": "该章节没有节点"}

    prepared = _build_node_items(db, node_ids, include_single=True)
    # 手工指定过音频的句子直接命中，不需要合成
    todo = [p for p in prepared if not p.get("manual_voice")]
    total = len(todo)
    if not total:
        return {"ok": True, "total": 0, "job_id": None,
                "message": "该章节没有需要合成的台词"}

    capped = False
    if total > TTS_CHAPTER_PRELOAD_CAP:
        todo = todo[:TTS_CHAPTER_PRELOAD_CAP]
        total = len(todo)
        capped = True

    job = jobs.create("tts_chapter", f"整章语音预载 · {chapter.title}",
                      page="story", total=total,
                      message="后台合成中，完成后按节点取用即秒出")
    jobs.spawn(jobs.guard, job["id"], _run_chapter_preload, job["id"], todo,
               chapter.title + ("（已封顶）" if capped else ""))
    return {"ok": True, "total": total, "job_id": job["id"],
            "chapter_title": chapter.title, "capped": capped}


def _run_chapter_preload(job_id: str, items: list[dict[str, Any]], _title: str) -> None:
    """后台线程：逐句合成进缓存。已缓存的句子 synth_sync 会直接跳过（0 成本）。"""
    done = 0
    try:
        with ThreadPoolExecutor(max_workers=TTS_CHAPTER_WORKERS,
                                thread_name_prefix="tts-ch") as pool:
            futs = [pool.submit(_preload_one, it) for it in items]
            for f in as_completed(futs):
                try:
                    f.result()
                except Exception:  # noqa: BLE001
                    pass
                done += 1
                if done % 10 == 0 or done == len(items):
                    jobs.update(job_id, done=done,
                                message=f"整章语音预载 {done}/{len(items)} 句")
        jobs.finish(job_id, message="整章语音预载完成")
    except Exception as exc:  # noqa: BLE001
        jobs.fail(job_id, f"预载中断：{exc}"[:200])


def _preload_one(it: dict[str, Any]) -> None:
    """合成单句进缓存。任何异常都吞掉——单句失败不影响整章，前端会静默跳过。"""
    try:
        text = (it.get("text") or "").strip()
        if not text:
            return
        req = SynthRequest(
            text=text,
            voice_id=it.get("voice_id") or "",
            rate=int(it.get("rate") or 0),
            pitch=int(it.get("pitch") or 0),
            volume=int(it.get("volume") or 0),
            out_format="mp3",
        )
        # synth_sync 自带缓存命中判断：命中即跳过，未命中才真正合成
        tts.synth_sync(req, it.get("engine_id") or None,
                       allow_degrade=True, gender=it.get("gender") or "unknown")
    except Exception:  # noqa: BLE001
        pass
