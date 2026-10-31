# -*- coding: utf-8 -*-
"""素材入库与磁盘同步。

所有「新增一张图」的路径都走这里，保证素材表不缺东西：
  · AI 出图 → record_ai_image()
  · 本地上传 → record_upload()
  · 历史文件 → sync_from_disk()

磁盘同步只做「补漏」，从不删记录：文件被手动删了，记录还在（列表里显示失效），
由用户在素材库里决定清理，不会悄悄丢数据。
"""

from __future__ import annotations

import os
import re
from datetime import datetime

from ..config import DATA_DIR

GENERATED_DIR = os.path.join(DATA_DIR, "generated")
# frontend/images —— 与 routers/upload.py 里的 IMAGES_DIR 指向同一处
IMAGES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                         "frontend", "images"))

KINDS = {
    "portrait": "人物立绘",
    "pose": "人物动作",
    "scene": "场景",
    "illustration": "人物场景合成",
    "comic": "漫画",
    "item": "物品",
    "monster": "怪物",
    "ui": "界面",
    "icon": "图标",
    "other": "其他",
}
ORIGINS = {"ai": "AI 生成", "upload": "本地上传", "import": "外部导入"}

# url 前缀 → 磁盘目录
URL_ROOTS = (
    ("/generated/", GENERATED_DIR),
    ("/images/", IMAGES_DIR),
)

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")

# pose_12_magic_cast_0001.png → ("pose", "character", 12, "magic_cast")
_POSE_RE = re.compile(r"^pose_(\d+)_([A-Za-z0-9_]+?)_\d+\.(?:png|jpg|jpeg|webp)$", re.I)


def url_to_path(url: str | None) -> str | None:
    """把访问路径还原成磁盘绝对路径；认不出来返回 None。"""
    if not url:
        return None
    for prefix, root in URL_ROOTS:
        if url.startswith(prefix):
            rel = url[len(prefix):]
            p = os.path.abspath(os.path.join(root, *rel.split("/")))
            # 防目录穿越
            if not p.startswith(os.path.abspath(root)):
                return None
            return p
    return None


def file_size(url: str | None) -> int | None:
    p = url_to_path(url)
    if p and os.path.exists(p):
        return os.path.getsize(p)
    return None


def guess_meta(url: str, filename: str | None = None) -> dict:
    """从路径 / 文件名猜 kind 与主体。猜错也没关系，素材库里可以手动改。"""
    fn = filename or os.path.basename(url or "")
    low = (url or "").lower()

    m = _POSE_RE.match(fn)
    if m:
        return {"kind": "pose", "subject_type": "character",
                "subject_id": int(m.group(1)), "variant": m.group(2),
                "origin": "ai", "source": "pose_batch"}

    # ComfyUI 出图目录：默认当人物立绘（外观拼装出图就是立绘），origin 一律 ai
    if low.startswith("/generated/"):
        return {"kind": "portrait", "origin": "ai", "source": "appearance_render"}

    rules = (
        ("characters/portrait", "portrait", "character"),
        ("characters/avatar", "portrait", "character"),
        ("characters/expression", "portrait", "character"),
        ("characters/action", "pose", "character"),
        ("/poses", "pose", "character"),
        ("/scenes", "scene", "scene"),
        ("/items", "item", "item"),
        ("/monsters", "monster", "monster"),
        ("/enemies", "monster", "monster"),
        ("scenes/", "scene", "scene"),
        ("/cutscene", "scene", "scene"),
        ("/story", "scene", None),
        ("/ui", "ui", None),
        ("/button", "ui", None),
        ("/games", "ui", None),
        ("/icons", "icon", None),
        ("/skill", "icon", None),
    )
    for needle, kind, subject_type in rules:
        if needle in low:
            return {"kind": kind, "subject_type": subject_type,
                    "origin": "upload" if low.startswith("/images/") else "import"}
    return {"kind": "other", "origin": "upload" if low.startswith("/images/") else "import"}


def ingest(db, *, url: str, kind: str | None = None, origin: str | None = None,
           source: str | None = None, subject_type: str | None = None,
           subject_id: int | None = None, subject_name: str | None = None,
           width: int | None = None, height: int | None = None,
           name: str | None = None, category: str | None = None,
           variant: str | None = None, variant_name: str | None = None,
           prompt: str | None = None, negative: str | None = None,
           model_preset: str | None = None, job_id: str | None = None,
           seed: int | None = None, status: str | None = None):
    """登记一张图。已存在就只补空字段（不覆盖用户改过的分类/名称）。"""
    from ..models.asset import Asset

    if not url:
        return None
    a = db.query(Asset).filter(Asset.url == url).first()
    if a is None:
        a = Asset(url=url, filename=os.path.basename(url.split("?")[0]))
        db.add(a)
        db.flush()

    guessed = guess_meta(url, a.filename)
    if not a.kind or a.kind == "other":
        a.kind = kind or guessed.get("kind") or "other"
    if not a.origin:
        a.origin = origin or guessed.get("origin") or "upload"
    if not a.source:
        a.source = source or guessed.get("source")

    if subject_type and not a.subject_type:
        a.subject_type = subject_type
    elif not a.subject_type and guessed.get("subject_type"):
        a.subject_type = guessed["subject_type"]
    if subject_id and not a.subject_id:
        a.subject_id = subject_id
    elif not a.subject_id and guessed.get("subject_id"):
        a.subject_id = guessed["subject_id"]
    if subject_name and not a.subject_name:
        a.subject_name = subject_name

    if width and not a.width:
        a.width = width
    if height and not a.height:
        a.height = height
    if not a.bytes:
        a.bytes = file_size(url)

    for field, value in (("name", name), ("category", category), ("prompt", prompt),
                         ("negative", negative), ("model_preset", model_preset),
                         ("job_id", job_id), ("seed", seed),
                         ("variant", variant), ("variant_name", variant_name)):
        if value and not getattr(a, field):
            setattr(a, field, value)
    if status:
        a.status = status
    a.updated_at = datetime.now().isoformat()
    return a


def record_ai_image(meta: dict, *, source: str | None = None, prompt: str | None = None,
                    negative: str | None = None, model_preset: str | None = None,
                    job_id: str | None = None, seed: int | None = None,
                    subject_type: str | None = None, subject_id: int | None = None,
                    subject_name: str | None = None, kind: str | None = None,
                    category: str | None = None, variant: str | None = None,
                    variant_name: str | None = None):
    """AI 出图落库（独立开 session，出图主流程不依赖调用方的事务）。"""
    from ..database import SessionLocal

    url = (meta or {}).get("url")
    if not url:
        return None
    db = SessionLocal()
    try:
        a = ingest(db, url=url, kind=kind, origin="ai", source=source or "manual",
                   subject_type=subject_type, subject_id=subject_id,
                   subject_name=subject_name, width=meta.get("width"),
                   height=meta.get("height"), prompt=prompt, negative=negative,
                   model_preset=model_preset, job_id=job_id, seed=seed,
                   category=category, variant=variant, variant_name=variant_name,
                   status="draft")
        if a:
            # 模型里 origin 的默认值是 upload，ingest 的「空才补」会把它当成已有值，
            # 结果 AI 图全被标成本地上传。这里显式改回 ai。
            a.origin = "ai"
            if source:
                a.source = source
        db.commit()
        return a.id if a else None
    finally:
        db.close()


def sync_from_disk(db) -> dict:
    """把 generated/ 与 frontend/images/ 里还没登记的图片补进素材表。"""
    from ..models.asset import Asset

    known = {u for (u,) in db.query(Asset.url).all()}
    added = 0
    scanned = 0

    # 上传目录有一份 _meta.json，里面有原始文件名和分类 —— 比一串 hash 名有用得多
    upload_meta = {}
    _mp = os.path.join(IMAGES_DIR, "_meta.json")
    if os.path.exists(_mp):
        try:
            import json
            with open(_mp, encoding="utf-8") as f:
                upload_meta = json.load(f) or {}
        except Exception:  # noqa: BLE001
            upload_meta = {}

    def walk(root: str, url_prefix: str):
        nonlocal added, scanned
        if not os.path.isdir(root):
            return
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames
                           if not d.startswith("_") and d not in ("__pycache__", "_recycle")]
            for fn in filenames:
                if not fn.lower().endswith(IMG_EXT):
                    continue
                scanned += 1
                rel = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                url = url_prefix + rel
                if url in known:
                    continue
                from ..services.image_size import image_size
                w, h = image_size(os.path.join(dirpath, fn)) or (None, None)
                guessed = guess_meta(url, fn)
                m = upload_meta.get(fn) or {}
                a = Asset(url=url, filename=fn,
                          name=(m.get("original_name") or None),
                          category=(m.get("category") or None),
                          kind=guessed.get("kind") or "other",
                          origin=guessed.get("origin") or "import",
                          source=guessed.get("source"),
                          subject_type=guessed.get("subject_type"),
                          subject_id=guessed.get("subject_id"),
                          variant=guessed.get("variant"),
                          width=w, height=h,
                          bytes=os.path.getsize(os.path.join(dirpath, fn)),
                          status="final" if guessed.get("origin") == "upload" else "draft",
                          created_at=datetime.fromtimestamp(
                              os.path.getmtime(os.path.join(dirpath, fn))).isoformat())
                db.add(a)
                known.add(url)
                added += 1

    walk(GENERATED_DIR, "/generated/")
    walk(IMAGES_DIR, "/images/")

    # 老记录补名字（第一次扫的时候还没读 meta）
    if upload_meta:
        for a in db.query(Asset).filter(Asset.name.is_(None)).all():
            m = upload_meta.get(a.filename or "")
            if m:
                a.name = m.get("original_name") or None
                a.category = a.category or m.get("category") or None

    linked = link_subjects(db)
    db.commit()
    return {"scanned": scanned, "added": added, "linked": linked}


def link_subjects(db) -> int:
    """把「这张图画的是谁/什么」补上。

    上传来的图文件名是 hash，光看文件猜不出主体；但业务表里写着「小小的立绘 = 这个 url」，
    所以用引用反查回填：谁在用它，它就是画给谁的。已经手填过的不动。
    """
    from ..models.asset import Asset
    from .asset_usages import usage_index

    try:
        idx = usage_index(db)
    except Exception:  # noqa: BLE001
        return 0
    SUBJECT_TYPES = {"character", "scene", "item"}
    linked = 0
    for a in db.query(Asset).filter(Asset.subject_id.is_(None)).all():
        for u in idx.get(a.url, []):
            if u["owner_type"] not in SUBJECT_TYPES:
                continue
            a.subject_type = u["owner_type"]
            a.subject_id = u["owner_id"]
            a.subject_name = u["name"] or None
            linked += 1
            break
    return linked


def backfill_from_generated_images(db) -> int:
    """把旧的 generated_images 记录合并进 assets（一次性）。"""
    from sqlalchemy import inspect as _inspect
    from ..database import engine
    from ..models.asset import Asset
    from ..models.character import Character
    from ..models.generated_image import GeneratedImage

    try:
        if "generated_images" not in _inspect(engine).get_table_names():
            return 0
    except Exception:  # noqa: BLE001
        return 0

    move = 0
    char_map = {c.id: c.name for c in db.query(Character).all()}
    for gi in db.query(GeneratedImage).all():
        exists = db.query(Asset).filter(Asset.url == gi.url).first()
        if exists:
            continue
        from ..services.image_size import image_size
        w, h = (gi.width, gi.height)
        if not (w and h):
            p = url_to_path(gi.url)
            if p and os.path.exists(p):
                w, h = image_size(p) or (None, None)
        db.add(Asset(
            url=gi.url, filename=gi.filename,
            kind="pose" if gi.pose_id else "portrait",
            subject_type="character" if gi.character_id else None,
            subject_id=gi.character_id,
            subject_name=char_map.get(gi.character_id) or gi.character_name,
            category=gi.category, variant=gi.pose_id, variant_name=gi.pose_name,
            width=w, height=h, bytes=file_size(gi.url),
            origin="ai", source=gi.source or "manual", status="draft",
            prompt=gi.prompt, negative=gi.negative, model_preset=gi.model_preset,
            job_id=gi.job_id, seed=gi.seed,
            created_at=gi.created_at,
        ))
        move += 1
    db.commit()
    return move
