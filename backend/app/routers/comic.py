# -*- coding: utf-8 -*-
"""漫画制作：工程 / 分册 / 页面 / 格子 / 版本 + 出图队列 + 前台阅读接口。

接口分两组：
- /api/comic/*         后台制作（含所有写操作）
- /api/comic/public/*  前台阅读（只读，且只返回已发布工程）
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..database import get_db
from ..models.comic import (ComicBook, ComicCell, ComicCellVersion, ComicPage,
                            ComicProject)
from ..models.character import Character
from ..models.character_appearance import CharacterAppearance
from ..services import comic_gen
from ..services import comic_layout

router = APIRouter(prefix="/api/comic", tags=["漫画制作"])
public_router = APIRouter(prefix="/api/comic/public", tags=["漫画阅读"])

COMIC_DIR = comic_gen.COMIC_DIR



def _spec(spec: dict) -> dict:
    """把排版预设里的 points（Python 列表）转成 TEXT 列能存的 JSON。"""
    d = dict(spec)
    pts = d.get("points")
    if pts is not None and not isinstance(pts, str):
        d["points"] = json.dumps(pts)
    return d


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _json(raw, fallback):
    try:
        v = json.loads(raw) if raw else None
        return fallback if v is None else v
    except Exception:  # noqa: BLE001
        return fallback


# ======================================================================
# 序列化
# ======================================================================
def project_out(p: ComicProject, stats: dict | None = None) -> dict:
    d = {
        "id": p.id, "title": p.title, "mode": p.mode,
        "page_w": p.page_w, "page_h": p.page_h,
        "page_margin": p.page_margin, "gap": p.gap, "bg_color": p.bg_color,
        "reading_direction": p.reading_direction,
        "style_prefix": p.style_prefix or "", "negative_prompt": p.negative_prompt or "",
        "workflow_preset": p.workflow_preset or "", "model_preset": p.model_preset or "",
        "steps": p.steps, "cfg": p.cfg, "seed_mode": p.seed_mode or "random",
        "cover": p.cover or "", "description": p.description or "",
        "author": p.author or "", "status": p.status,
        "is_published": int(p.is_published or 0),
        "created_at": p.created_at, "updated_at": p.updated_at,
    }
    if stats is not None:
        d["stats"] = stats
    return d


def cell_out(c: ComicCell, with_versions: bool = False) -> dict:
    d = {
        "id": c.id, "project_id": c.project_id, "page_id": c.page_id,
        "read_order": c.read_order,
        "x": c.x, "y": c.y, "w": c.w, "h": c.h,
        "rotation": c.rotation or 0,
        "points": _json(c.points, None),
        "border_color": c.border_color, "border_width": c.border_width,
        "border_style": c.border_style, "border_radius": c.border_radius or 0,
        "opacity": c.opacity if c.opacity is not None else 1,
        "z_index": c.z_index or 0, "is_locked": int(c.is_locked or 0),
        "fit": c.fit or "cover", "img_scale": c.img_scale or 1,
        "img_offset_x": c.img_offset_x or 0, "img_offset_y": c.img_offset_y or 0,
        "flip_h": int(c.flip_h or 0),
        "bg_enabled": int(c.bg_enabled) if c.bg_enabled is not None else 0,
        "bg_color": c.bg_color or "#ffffff",
        "prompt_positive": c.prompt_positive or "",
        "prompt_negative": c.prompt_negative or "",
        "prompt_override": c.prompt_override or "",
        "prompt_locked": int(c.prompt_locked or 0),
        "characters": _json(c.characters, []),
        "workflow_preset": c.workflow_preset or "",
        "model_preset": c.model_preset or "",
        "steps": c.steps, "cfg": c.cfg,
        "seed": c.seed if c.seed is not None else -1,
        "seed_mode": c.seed_mode or "",
        "bubbles": _json(c.bubbles, []),
        "effects": _json(c.effects, []),
        "current_image": c.current_image or "",
        "current_version_id": c.current_version_id,
        "gen_status": c.gen_status or "empty",
        "last_error": c.last_error or "",
        "progress": c.progress or 0,
    }
    if with_versions:
        d["versions"] = [version_out(v) for v in
                         sorted(c.versions, key=lambda x: -x.id)]
    return d


def version_out(v: ComicCellVersion) -> dict:
    # 老版本（三个配方列全 NULL）只有 prompt_positive 这份历史成品；新版本按配方拼
    legacy = (getattr(v, "prompt_prefix", None) is None
              and getattr(v, "prompt_suffix", None) is None
              and getattr(v, "prompt_override", None) is None)
    return {
        "id": v.id, "cell_id": v.cell_id, "image_url": v.image_url or "",
        "width": v.width, "height": v.height,
        "prompt_positive": v.prompt_positive or "",
        "prompt_negative": v.prompt_negative or "",
        "prompt_prefix": ("" if legacy else (v.prompt_prefix or "")),
        "prompt_suffix": ("" if legacy else (v.prompt_suffix or "")),
        "prompt_override": ("" if legacy else (v.prompt_override or "")),
        "characters": _json(v.characters, []),
        "params": _json(v.params, {}),
        "seed": v.seed, "status": v.status,
        "is_draft": (not (v.image_url or "").strip()) or v.status == "draft",
        "legacy": legacy,
        "is_selected": int(v.is_selected or 0),
        "note": v.note or "", "name": v.name or "", "elapsed": v.elapsed,
        "created_at": v.created_at,
    }


def page_out(pg: ComicPage, cells: list[ComicCell] | None = None) -> dict:
    d = {
        "id": pg.id, "project_id": pg.project_id, "book_id": pg.book_id,
        "title": pg.title or "", "page_no": pg.page_no,
        "width": pg.width, "height": pg.height, "bg_color": pg.bg_color,
        "sort": pg.sort, "note": pg.note or "",
    }
    if cells is not None:
        d["cells"] = [cell_out(c) for c in sorted(cells, key=lambda x: (x.read_order, x.id))]
    return d


def book_out(b: ComicBook, pages: list[ComicPage] | None = None) -> dict:
    d = {"id": b.id, "project_id": b.project_id, "title": b.title,
         "book_no": b.book_no, "sort": b.sort, "note": b.note or ""}
    if pages is not None:
        d["pages"] = [page_out(p) for p in sorted(pages, key=lambda x: (x.page_no, x.id))]
    return d


# ======================================================================
# 小工具
# ======================================================================
def _project(db: Session, pid: int) -> ComicProject:
    p = db.get(ComicProject, int(pid))
    if not p:
        raise HTTPException(404, "工程不存在")
    return p


def _page(db: Session, pid: int) -> ComicPage:
    p = db.get(ComicPage, int(pid))
    if not p:
        raise HTTPException(404, "页面不存在")
    return p


def _cell(db: Session, cid: int) -> ComicCell:
    c = db.get(ComicCell, int(cid))
    if not c:
        raise HTTPException(404, "格子不存在")
    return c


def _touch_project(db: Session, pid: int):
    p = db.get(ComicProject, int(pid))
    if p:
        p.updated_at = _now()
        db.commit()


def _project_tree(db: Session, project: ComicProject) -> dict:
    books = (db.query(ComicBook).filter(ComicBook.project_id == project.id)
             .order_by(ComicBook.sort, ComicBook.id).all())
    pages = (db.query(ComicPage).filter(ComicPage.project_id == project.id)
             .order_by(ComicPage.page_no, ComicPage.id).all())
    cells = (db.query(ComicCell).filter(ComicCell.project_id == project.id)
             .order_by(ComicCell.read_order, ComicCell.id).all())

    by_page: dict[int, list[ComicCell]] = {}
    for c in cells:
        by_page.setdefault(c.page_id, []).append(c)
    by_book: dict[int, list[ComicPage]] = {}
    for pg in pages:
        by_book.setdefault(pg.book_id, []).append(pg)

    out_books = []
    total_cells = len(cells)
    # 「完成」按有没有成品图来算，而不是按状态字符串：
    # 改过提示词的格子会被标成 stale（图还在、但已经对不上新词），
    # 这种格子算「有图」，否则统计里会凭空少掉一页的进度。
    done = sum(1 for c in cells if c.current_image)
    pending = sum(1 for c in cells if not c.current_image
                  and c.gen_status in ("pending", "queued", "rendering", "empty", "stale"))
    failed = sum(1 for c in cells if c.gen_status == "failed")
    for b in books:
        bp = by_book.get(b.id, [])
        out_books.append({
            **book_out(b),
            "pages": [page_out(pg, by_page.get(pg.id, [])) for pg in bp],
        })
    return {
        "project": project_out(project, {
            "cells": total_cells, "pages": len(pages), "books": len(books),
            "done": done, "pending": pending, "failed": failed,
        }),
        "books": out_books,
    }


# ======================================================================
# 工程
# ======================================================================
@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    rows = db.query(ComicProject).order_by(ComicProject.sort, -ComicProject.id).all()
    out = []
    for p in rows:
        cnt = db.query(ComicCell).filter(ComicCell.project_id == p.id).count()
        done = db.query(ComicCell).filter(ComicCell.project_id == p.id,
                                          ComicCell.gen_status == "done").count()
        out.append(project_out(p, {"cells": cnt, "done": done}))
    return out


@router.post("/projects", status_code=201)
def create_project(payload: dict = Body(...), db: Session = Depends(get_db)):
    mode = payload.get("mode") or "manga"
    title = (payload.get("title") or "未命名漫画").strip()

    page_w = int(payload.get("page_w") or (1240 if mode != "scroll" else 900))
    page_h = int(payload.get("page_h") or (1754 if mode != "scroll" else 2600))

    p = ComicProject(
        title=title, mode=mode, page_w=page_w, page_h=page_h,
        page_margin=int(payload.get("page_margin") or (48 if mode != "scroll" else 0)),
        gap=int(payload.get("gap") or 16),
        bg_color=payload.get("bg_color") or "#ffffff",
        reading_direction=payload.get("reading_direction")
        or ("top_to_bottom" if mode == "scroll" else "right_to_left"),
        style_prefix=payload.get("style_prefix") or "",
        negative_prompt=payload.get("negative_prompt") or "",
        model_preset=payload.get("model_preset") or "",
        workflow_preset=payload.get("workflow_preset") or "",
        steps=payload.get("steps"), cfg=payload.get("cfg"),
        seed_mode=payload.get("seed_mode") or "random",
        author=payload.get("author") or "",
        description=payload.get("description") or "",
        cover=payload.get("cover") or "",
        category_path=payload.get("category_path"),
        created_at=_now(), updated_at=_now(),
    )
    db.add(p)
    db.flush()

    book = ComicBook(project_id=p.id, title="第一话", book_no=1, sort=0)
    db.add(book)
    db.flush()

    pg = ComicPage(project_id=p.id, book_id=book.id, title="第 1 页", page_no=1,
                   width=page_w, height=page_h, bg_color=p.bg_color, sort=0)
    db.add(pg)
    db.flush()

    # 立即按形态铺好第一页，避免新建工程看到一张全白的空画布
    layout = payload.get("layout")
    if layout == "blank":
        specs = []
    else:
        if layout in (None, "", "auto"):
            layout = {"lianhuanhua": "splash", "scroll": "scroll-3"}.get(mode, "manga-classic")
        specs = comic_layout.build(layout, pg.width, pg.height, p.page_margin, p.gap)
    for i, spec in enumerate(specs, start=1):
        db.add(ComicCell(project_id=p.id, page_id=pg.id, read_order=i,
                         created_at=_now(), updated_at=_now(), **_spec(spec)))

    db.commit()
    db.refresh(p)
    return _project_tree(db, p)


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db)):
    return _project_tree(db, _project(db, pid))


@router.put("/projects/{pid}")
def update_project(pid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = _project(db, pid)
    fields = ["title", "mode", "page_w", "page_h", "page_margin", "gap", "bg_color",
              "reading_direction", "style_prefix", "negative_prompt", "workflow_preset",
              "model_preset", "steps", "cfg", "seed_mode", "cover", "description",
              "author", "status", "category_path"]
    for k in fields:
        if k in payload:
            setattr(p, k, payload[k])
    p.updated_at = _now()
    db.commit()

    # 页面尺寸跟随工程（未单独改过尺寸的页面）
    if "page_w" in payload or "page_h" in payload:
        for pg in db.query(ComicPage).filter(ComicPage.project_id == p.id).all():
            pg.width = p.page_w
            pg.height = p.page_h
        db.commit()
    return project_out(p)


@router.delete("/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    db.delete(p)
    db.commit()
    d = os.path.join(COMIC_DIR, f"p{pid}")
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}


@router.post("/projects/{pid}/publish")
def publish_project(pid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    p = _project(db, pid)
    p.is_published = 1 if payload.get("published", True) else 0
    p.status = "published" if p.is_published else "draft"
    p.updated_at = _now()
    db.commit()
    return {"ok": True, "is_published": p.is_published}


# ======================================================================
# 分册 / 页面
# ======================================================================
@router.post("/projects/{pid}/books", status_code=201)
def create_book(pid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    _project(db, pid)
    n = db.query(ComicBook).filter(ComicBook.project_id == pid).count()
    b = ComicBook(project_id=pid, title=payload.get("title") or f"第 {n + 1} 话",
                  book_no=n + 1, sort=n, note=payload.get("note") or "")
    db.add(b)
    db.commit()
    return book_out(b, [])


@router.put("/books/{bid}")
def update_book(bid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    b = db.get(ComicBook, int(bid))
    if not b:
        raise HTTPException(404, "分册不存在")
    for k in ("title", "book_no", "sort", "note"):
        if k in payload:
            setattr(b, k, payload[k])
    db.commit()
    return book_out(b)


@router.delete("/books/{bid}")
def delete_book(bid: int, db: Session = Depends(get_db)):
    b = db.get(ComicBook, int(bid))
    if not b:
        raise HTTPException(404, "分册不存在")
    if db.query(ComicBook).filter(ComicBook.project_id == b.project_id).count() <= 1:
        raise HTTPException(400, "至少保留一册")
    db.delete(b)
    db.commit()
    return {"ok": True}


@router.post("/books/{bid}/pages", status_code=201)
def create_page(bid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    b = db.get(ComicBook, int(bid))
    if not b:
        raise HTTPException(404, "分册不存在")
    project = _project(db, b.project_id)
    n = db.query(ComicPage).filter(ComicPage.book_id == bid).count()
    w = int(payload.get("width") or project.page_w)
    h = int(payload.get("height") or project.page_h)
    pg = ComicPage(project_id=b.project_id, book_id=bid,
                   title=payload.get("title") or f"第 {n + 1} 页",
                   page_no=n + 1, width=w, height=h,
                   bg_color=payload.get("bg_color") or project.bg_color, sort=n)
    db.add(pg)
    db.flush()

    layout = payload.get("layout")
    if layout == "blank":
        layout = None
        specs = []
    elif layout in (None, "", "auto"):
        layout = {"lianhuanhua": "splash", "scroll": "scroll-3"}.get(project.mode, "manga-classic")
        specs = comic_layout.build(layout, w, h, project.page_margin, project.gap)
    else:
        specs = comic_layout.build(layout, w, h, project.page_margin, project.gap)
    for i, spec in enumerate(specs, start=1):
        db.add(ComicCell(project_id=b.project_id, page_id=pg.id, read_order=i,
                         created_at=_now(), updated_at=_now(), **_spec(spec)))
    db.commit()
    db.refresh(pg)
    cells = db.query(ComicCell).filter(ComicCell.page_id == pg.id).all()
    return page_out(pg, cells)


@router.put("/pages/{pgid}")
def update_page(pgid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    pg = _page(db, pgid)
    for k in ("title", "page_no", "width", "height", "bg_color", "sort", "note"):
        if k in payload:
            setattr(pg, k, payload[k])
    pg.updated_at = _now()
    db.commit()
    cells = db.query(ComicCell).filter(ComicCell.page_id == pg.id).all()
    return page_out(pg, cells)


@router.delete("/pages/{pgid}")
def delete_page(pgid: int, db: Session = Depends(get_db)):
    pg = _page(db, pgid)
    book_id = pg.book_id
    if db.query(ComicPage).filter(ComicPage.book_id == book_id).count() <= 1:
        raise HTTPException(400, "每册至少保留一页")
    db.delete(pg)
    db.commit()
    return {"ok": True}


@router.post("/pages/{pgid}/duplicate", status_code=201)
def duplicate_page(pgid: int, db: Session = Depends(get_db)):
    src = _page(db, pgid)
    n = db.query(ComicPage).filter(ComicPage.book_id == src.book_id).count()
    pg = ComicPage(project_id=src.project_id, book_id=src.book_id,
                   title=f"{src.title or '页面'} 副本", page_no=n + 1,
                   width=src.width, height=src.height, bg_color=src.bg_color, sort=n)
    db.add(pg)
    db.flush()
    cells = db.query(ComicCell).filter(ComicCell.page_id == src.id).all()
    for c in cells:
        db.add(ComicCell(
            project_id=c.project_id, page_id=pg.id, read_order=c.read_order,
            x=c.x, y=c.y, w=c.w, h=c.h, rotation=c.rotation, points=c.points,
            border_color=c.border_color, border_width=c.border_width,
            border_style=c.border_style, border_radius=c.border_radius,
            opacity=c.opacity, z_index=c.z_index, is_locked=0,
            fit=c.fit, img_scale=c.img_scale, img_offset_x=c.img_offset_x,
            img_offset_y=c.img_offset_y, flip_h=c.flip_h,
            bg_enabled=c.bg_enabled, bg_color=c.bg_color,
            prompt_positive=c.prompt_positive, prompt_negative=c.prompt_negative,
            prompt_override=c.prompt_override, characters=c.characters,
            workflow_preset=c.workflow_preset, model_preset=c.model_preset,
            steps=c.steps, cfg=c.cfg, seed=c.seed, seed_mode=c.seed_mode,
            bubbles=c.bubbles, effects=c.effects, gen_status="empty",
        ))
    db.commit()
    db.refresh(pg)
    return page_out(pg, db.query(ComicCell).filter(ComicCell.page_id == pg.id).all())


@router.post("/pages/{pgid}/reorder")
def reorder_cells(pgid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    ids = payload.get("ids") or []
    for i, cid in enumerate(ids, start=1):
        c = db.get(ComicCell, int(cid))
        if c and c.page_id == pgid:
            c.read_order = i
    db.commit()
    return {"ok": True}


@router.post("/pages/{pgid}/relayout")
def relayout_page(pgid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    """套用版式：清空本页格子，按模板重新铺一遍（页面本身与页序不动）。"""
    pg = _page(db, pgid)
    project = _project(db, pg.project_id)
    layout = payload.get("layout") or "manga-classic"
    for c in db.query(ComicCell).filter(ComicCell.page_id == pg.id).all():
        d = os.path.join(COMIC_DIR, f"p{pg.project_id}", f"cell_{c.id}")
        if os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)
        db.delete(c)
    db.flush()
    specs = comic_layout.build(layout, pg.width, pg.height,
                              project.page_margin, project.gap) if layout != "blank" else []
    for i, spec in enumerate(specs, start=1):
        db.add(ComicCell(project_id=pg.project_id, page_id=pg.id, read_order=i,
                         created_at=_now(), updated_at=_now(), **_spec(spec)))
    pg.updated_at = _now()
    db.commit()
    cells = db.query(ComicCell).filter(ComicCell.page_id == pg.id).all()
    return page_out(pg, cells)


@router.post("/pages/{pgid}/cells", status_code=201)
def create_cell(pgid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """新建格子。带 `restore=true` 时按整份快照回填（撤销「删除格子」用）。"""
    pg = _page(db, pgid)
    n = db.query(ComicCell).filter(ComicCell.page_id == pgid).count()
    x = int(payload.get("x", pg.width * 0.1))
    y = int(payload.get("y", pg.height * 0.1))
    w = int(payload.get("w", pg.width * 0.35))
    h = int(payload.get("h", pg.height * 0.25))
    c = ComicCell(
        project_id=pg.project_id, page_id=pgid, read_order=n + 1,
        x=x, y=y, w=w, h=h,
        rotation=float(payload.get("rotation") or 0),
        points=json.dumps(payload["points"]) if payload.get("points") else None,
        border_color=payload.get("border_color") or "#111111",
        border_width=int(payload.get("border_width", 3)),
        border_style=payload.get("border_style") or "solid",
        created_at=_now(), updated_at=_now(),
    )
    if payload.get("restore"):
        for k in CELL_FIELDS:
            if k not in payload:
                continue
            v = payload[k]
            if k == "seed" and v is None:
                v = -1
            setattr(c, k, v)
        for k in ("bubbles", "effects", "characters"):
            if k in payload:
                setattr(c, k, json.dumps(payload[k] or [], ensure_ascii=False))
        if payload.get("current_image"):
            c.current_image = payload["current_image"]
        c.gen_status = payload.get("gen_status") or "empty"
    db.add(c)
    db.commit()
    db.refresh(c)
    return cell_out(c, with_versions=True)


# ======================================================================
# 格子
# ======================================================================
CELL_FIELDS = [
    "read_order", "x", "y", "w", "h", "rotation", "border_color", "border_width",
    "border_style", "border_radius", "opacity", "z_index", "is_locked", "fit",
    "img_scale", "img_offset_x", "img_offset_y", "flip_h",
    "bg_enabled", "bg_color",
    "prompt_positive", "prompt_negative", "prompt_override", "prompt_locked",
    "workflow_preset", "model_preset", "steps", "cfg", "seed", "seed_mode",
]


@router.get("/cells/{cid}")
def get_cell(cid: int, db: Session = Depends(get_db)):
    c = _cell(db, cid)
    return cell_out(c, with_versions=True)


@router.put("/cells/{cid}")
def update_cell(cid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    c = _cell(db, cid)
    for k in CELL_FIELDS:
        if k in payload:
            setattr(c, k, payload[k])
    if "points" in payload:
        pts = payload["points"]
        c.points = json.dumps(pts) if pts else None
    if "characters" in payload:
        c.characters = json.dumps(payload["characters"] or [], ensure_ascii=False)
    if "bubbles" in payload:
        c.bubbles = json.dumps(payload["bubbles"] or [], ensure_ascii=False)
    if "effects" in payload:
        c.effects = json.dumps(payload["effects"] or [], ensure_ascii=False)
    # 提示词/人物改了，图就跟新词对不上了 → 标成 stale（图保留，状态提示「词已改」），
    # 不要直接退回 pending：那样「完成 N 格」会突然掉下去，看起来像图丢了。
    if any(k in payload for k in ("prompt_positive", "prompt_override", "characters")):
        if c.gen_status == "done":
            c.gen_status = "stale"
    c.updated_at = _now()
    db.commit()
    db.refresh(c)
    return cell_out(c, with_versions=True)


@router.delete("/cells/{cid}")
def delete_cell(cid: int, db: Session = Depends(get_db)):
    c = _cell(db, cid)
    pid = c.project_id
    db.delete(c)
    db.commit()
    d = os.path.join(COMIC_DIR, f"p{pid}", f"cell_{cid}")
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}


@router.post("/cells/{cid}/duplicate", status_code=201)
def duplicate_cell(cid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """整格复制：排版、提示词、气泡、特效、生图参数、当前图、以及全部版本一起带走。

    复制出来的格子是新 id（和原格脱钩，之后各改各的），但内容与版本历史是完整的一份。
    payload.with_image=False 时只复制版本记录、不带当前图（用于「只要配方」的场景）。
    """
    src = _cell(db, cid)
    target_page = int(payload.get("page_id") or src.page_id)
    pg = _page(db, target_page)
    n = db.query(ComicCell).filter(ComicCell.page_id == target_page).count()
    off = int(payload.get("offset", 24))
    with_image = payload.get("with_image", True)
    new = ComicCell(
        project_id=pg.project_id, page_id=target_page, read_order=n + 1,
        x=min(pg.width - 40, src.x + off), y=min(pg.height - 40, src.y + off),
        w=src.w, h=src.h, rotation=src.rotation, points=src.points,
        border_color=src.border_color, border_width=src.border_width,
        border_style=src.border_style, border_radius=src.border_radius,
        opacity=src.opacity, z_index=src.z_index, is_locked=0,
        fit=src.fit, img_scale=src.img_scale, img_offset_x=src.img_offset_x,
        img_offset_y=src.img_offset_y, flip_h=src.flip_h,
        bg_enabled=src.bg_enabled, bg_color=src.bg_color,
        prompt_positive=src.prompt_positive, prompt_negative=src.prompt_negative,
        prompt_override=src.prompt_override, prompt_locked=src.prompt_locked,
        characters=src.characters,
        workflow_preset=src.workflow_preset, model_preset=src.model_preset,
        steps=src.steps, cfg=src.cfg, seed=src.seed, seed_mode=src.seed_mode,
        bubbles=src.bubbles, effects=src.effects,
        gen_status="empty",
        created_at=_now(), updated_at=_now(),
    )
    if with_image and src.current_image:
        new.current_image = src.current_image
        new.gen_status = src.gen_status if src.gen_status in ("done", "stale") else "done"
    db.add(new)
    db.flush()          # 先拿到新格 id，版本要挂上去

    # 版本全量复制（含草稿与配方），并把「当前版本」指到对应的新版
    vmap: dict[int, int] = {}
    src_versions = (db.query(ComicCellVersion)
                    .filter(ComicCellVersion.cell_id == src.id)
                    .order_by(ComicCellVersion.id).all())
    for v in src_versions:
        nv = ComicCellVersion(
            cell_id=new.id, image_url=v.image_url, width=v.width, height=v.height,
            prompt_positive=v.prompt_positive, prompt_negative=v.prompt_negative,
            params=v.params, seed=v.seed, status=v.status,
            is_selected=v.is_selected, note=v.note, name=v.name,
            characters=v.characters, prompt_prefix=v.prompt_prefix,
            prompt_suffix=v.prompt_suffix, prompt_override=v.prompt_override,
            elapsed=v.elapsed, created_at=v.created_at,
        )
        db.add(nv)
        db.flush()
        vmap[v.id] = nv.id
    if src.current_version_id and vmap.get(src.current_version_id):
        new.current_version_id = vmap[src.current_version_id]
    elif with_image and src.current_image and vmap:
        new.current_version_id = list(vmap.values())[-1]

    # 版本里的图和新格同在一个工程目录下，路径直接复用即可（文件是共享的，不重复占盘）
    db.commit()
    db.refresh(new)
    return cell_out(new, with_versions=True)


@router.post("/cells/{cid}/split", status_code=201)
def split_cell(cid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """把一格切成多格（横切 / 竖切 / 田字格）。漫画分镜最常用的动作。"""
    c = _cell(db, cid)
    mode = payload.get("mode") or "v"     # v 竖着切 / h 横着切 / grid 田字
    gap = int(payload.get("gap") or 10)
    pieces = comic_layout.split_rect(c.x, c.y, c.w, c.h, mode, gap)
    n0 = db.query(ComicCell).filter(ComicCell.page_id == c.page_id).count()
    created = []
    for i, (x, y, w, h) in enumerate(pieces):
        new = ComicCell(
            project_id=c.project_id, page_id=c.page_id, read_order=n0 + i + 1,
            x=x, y=y, w=w, h=h,
            border_color=c.border_color, border_width=c.border_width,
            border_style=c.border_style,
            prompt_positive=c.prompt_positive if i == 0 else "",
            prompt_negative=c.prompt_negative,
            characters=c.characters if i == 0 else "[]",
            model_preset=c.model_preset, workflow_preset=c.workflow_preset,
            steps=c.steps, cfg=c.cfg, seed_mode=c.seed_mode,
            current_image=c.current_image if i == 0 else None,
            gen_status=c.gen_status if i == 0 else "empty",
        )
        db.add(new)
        created.append(new)
    db.delete(c)
    db.commit()
    for n in created:
        db.refresh(n)
    return [cell_out(n) for n in created]


@router.post("/cells/{cid}/image")
def set_cell_image(cid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    """从素材库挑一张图直接作为这一格的当前版本（不经过 AI）。"""
    c = _cell(db, cid)
    url = (payload.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "缺少图片地址")
    ver = ComicCellVersion(cell_id=c.id, image_url=url, status="success",
                           is_selected=1, note=payload.get("note") or "手动选图",
                           characters=c.characters)
    db.add(ver)
    db.flush()
    db.query(ComicCellVersion).filter(
        ComicCellVersion.cell_id == c.id,
        ComicCellVersion.id != ver.id,
    ).update({ComicCellVersion.is_selected: 0}, synchronize_session=False)
    c.current_image = url
    c.current_version_id = ver.id
    c.gen_status = "done"
    c.updated_at = _now()
    db.commit()
    db.refresh(c)
    return cell_out(c, with_versions=True)


@router.post("/cells/{cid}/clear-image")
def clear_cell_image(cid: int, db: Session = Depends(get_db)):
    """清空当前图（版本历史保留，随时可以再从版本里选回来）。"""
    c = _cell(db, cid)
    c.current_image = None
    c.current_version_id = None
    c.gen_status = "empty"
    c.progress = 0
    c.updated_at = _now()
    db.commit()
    return cell_out(c, with_versions=True)


@router.post("/cells/{cid}/versions/{vid}/select")
def select_version(cid: int, vid: int, db: Session = Depends(get_db)):
    c = _cell(db, cid)
    v = db.get(ComicCellVersion, int(vid))
    if not v or v.cell_id != c.id:
        raise HTTPException(404, "版本不存在")
    db.query(ComicCellVersion).filter(ComicCellVersion.cell_id == c.id).update(
        {ComicCellVersion.is_selected: 0}, synchronize_session=False)
    v.is_selected = 1
    c.current_image = v.image_url
    c.current_version_id = v.id
    c.gen_status = "done"
    # 联动：把该版本的提示词与人物绑定还原到格子，
    # 这样在右侧面板点不同版本时，下方提示词 / 人物会切换到对应版本的内容
    # 版本现在是自包含配方（前置/人物/后置各自存一份），选中它只负责「哪张图上屏」+ 带上人物，
    # 不再把成品提示词写回 cell.prompt_positive —— 否则格子级再生成时会把人物描述拼两遍。
    if getattr(v, "characters", None):
        c.characters = v.characters
    c.updated_at = _now()
    db.commit()
    return cell_out(c, with_versions=True)


@router.delete("/cells/{cid}/versions/{vid}")
def delete_version(cid: int, vid: int, db: Session = Depends(get_db)):
    c = _cell(db, cid)
    v = db.get(ComicCellVersion, int(vid))
    if not v or v.cell_id != c.id:
        raise HTTPException(404, "版本不存在")
    if v.is_selected:
        raise HTTPException(400, "当前版本受保护，先切换别的版本再删")
    db.delete(v)
    db.commit()
    return {"ok": True}


@router.post("/cells/{cid}/versions/{vid}/rename")
def rename_version(cid: int, vid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """给版本重新起名字（留空则回退成 #id 显示）。"""
    c = _cell(db, cid)
    v = db.get(ComicCellVersion, int(vid))
    if not v or v.cell_id != c.id:
        raise HTTPException(404, "版本不存在")
    v.name = (payload.get("name") or "").strip()
    c.updated_at = _now()
    db.commit()
    return cell_out(c, with_versions=True)


@router.post("/cells/{cid}/versions/current/save-prompt")
def save_prompt_to_current_version(cid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """把当前提示词写进「当前版本」——只更新文字，不新增版本、不出图。"""
    c = _cell(db, cid)
    if not c.current_version_id:
        raise HTTPException(400, "还没有版本，先生成一张再保存")
    v = db.get(ComicCellVersion, int(c.current_version_id))
    if not v or v.cell_id != c.id:
        raise HTTPException(404, "当前版本不存在")
    p = _project(db, c.project_id)
    data = comic_gen.assemble_prompt(db, p, c)
    v.prompt_positive = data["positive"]
    v.prompt_negative = ""
    if payload.get("name") is not None:
        v.name = str(payload.get("name") or "").strip()
    c.updated_at = _now()
    db.commit()
    return cell_out(c, with_versions=True)


# ---- 版本：新建 / 修改 / 复制 / 预览 / 生成（自包含配方） ----

@router.post("/cells/{cid}/versions", status_code=201)
def create_version(cid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """新建一个草稿版本（还没出图）。

    默认复制当前格子的内容（人物 + 自由词）；也可用 from_version_id 从一个已有版本复制配方。
    """
    c = _cell(db, cid)
    src_vid = payload.get("from_version_id")
    if src_vid:
        src = db.get(ComicCellVersion, int(src_vid))
        if not src or src.cell_id != c.id:
            raise HTTPException(404, "源版本不存在")
        recipe = comic_gen.version_to_recipe(src)
        prefix = recipe["prompt_prefix"]
        suffix = recipe["prompt_suffix"]
        override = recipe["prompt_override"]
        characters = json.dumps(recipe["characters"], ensure_ascii=False)
        name = payload.get("name") or (f"{src.name or ('#' + str(src.id))} 副本")
    else:
        prefix = ""
        suffix = c.prompt_positive or ""
        override = c.prompt_override or ""
        characters = c.characters or "[]"
        name = payload.get("name") or ""

    v = ComicCellVersion(
        cell_id=c.id, image_url="", width=None, height=None,
        prompt_positive="", prompt_negative="",
        prompt_prefix=prefix or "", prompt_suffix=suffix or "",
        prompt_override=override or "", characters=characters or "[]",
        params="{}", status="draft", is_selected=0, name=name or "",
    )
    db.add(v)
    c.updated_at = _now()
    db.commit()
    db.refresh(v)
    return {"ok": True, "version": version_out(v), "cell": cell_out(c, with_versions=True)}


@router.put("/cells/{cid}/versions/{vid}")
def update_version(cid: int, vid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """改某个版本的内容：名称 / 前置 / 后置 / 人物 / 整段覆盖。只动这一版，不碰格子。"""
    c = _cell(db, cid)
    v = db.get(ComicCellVersion, int(vid))
    if not v or v.cell_id != c.id:
        raise HTTPException(404, "版本不存在")
    if "name" in payload:
        v.name = (payload.get("name") or "").strip()
    if "prompt_prefix" in payload:
        v.prompt_prefix = payload.get("prompt_prefix") or ""
    if "prompt_suffix" in payload:
        v.prompt_suffix = payload.get("prompt_suffix") or ""
    if "prompt_override" in payload:
        v.prompt_override = payload.get("prompt_override") or ""
    if "characters" in payload:
        v.characters = json.dumps(payload.get("characters") or [], ensure_ascii=False)
    # 顺便把成品提示词算一遍存进 prompt_positive（列表 / 历史展示用）
    data = comic_gen.assemble_version_prompt(db, _project(db, c.project_id), v)
    v.prompt_positive = data["positive"]
    c.updated_at = _now()
    db.commit()
    db.refresh(v)
    return {"ok": True, "version": version_out(v), "order": [p for p in data.get("parts", [])],
            "preview": data["positive"]}


@router.post("/cells/{cid}/versions/{vid}/duplicate", status_code=201)
def duplicate_version(cid: int, vid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """复制一个版本（只复制配方，不带图，得到一张新草稿）。"""
    return create_version(cid, {"from_version_id": vid, "name": payload.get("name")}, db)


@router.post("/cells/{cid}/versions/preview")
def version_preview(cid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """按「还没保存的配方」实时拼一遍提示词，给编辑弹窗做预览（不落库）。"""
    c = _cell(db, cid)
    p = _project(db, c.project_id)
    recipe = {
        "prompt_prefix": payload.get("prompt_prefix"),
        "prompt_suffix": payload.get("prompt_suffix"),
        "prompt_override": payload.get("prompt_override"),
        "characters": payload.get("characters"),
    }
    data = comic_gen.assemble_recipe(db, p, recipe)
    data["params"] = comic_gen.resolve_params(db, p, c)
    return data


@router.post("/cells/{cid}/versions/{vid}/generate")
def generate_version(cid: int, vid: int, db: Session = Depends(get_db)):
    """用这一版的配方出图；出完回填到这一版（草稿就地变成成品，不新增版本）。"""
    c = _cell(db, cid)
    v = db.get(ComicCellVersion, int(vid))
    if not v or v.cell_id != c.id:
        raise HTTPException(404, "版本不存在")
    data = comic_gen.assemble_version_prompt(db, _project(db, c.project_id), v)
    if not data["positive"].strip():
        raise HTTPException(400, "这个版本还没有内容：写点提示词或绑个人物再生成")
    tasks = comic_gen.queue.submit([c.id], c.project_id, "生成版本",
                                   {c.id: c.page_id}, version_map={c.id: v.id})
    if not tasks:
        raise HTTPException(400, "这一格已经在队列里了")
    c.gen_status = "queued"
    c.progress = 0
    db.commit()
    return {"ok": True, "tasks": tasks}


@router.post("/cells/{cid}/prompt-preview")
def prompt_preview(cid: int, db: Session = Depends(get_db)):
    c = _cell(db, cid)
    p = _project(db, c.project_id)
    data = comic_gen.assemble_prompt(db, p, c)
    data["params"] = comic_gen.resolve_params(db, p, c)
    return data


# ======================================================================
# 出图
# ======================================================================
@router.post("/cells/{cid}/generate")
def generate_cell(cid: int, db: Session = Depends(get_db)):
    c = _cell(db, cid)
    tasks = comic_gen.queue.submit([c.id], c.project_id, "单格生成",
                                   {c.id: c.page_id})
    if not tasks:
        raise HTTPException(400, "这一格已经在队列里了")
    c.gen_status = "queued"
    c.progress = 0
    db.commit()
    return {"ok": True, "tasks": tasks}


def _assert_generatable(cells) -> None:
    """批量出图前置检查：ComfyUI 必须已配置，且每一格的提示词都不能为空。"""
    try:
        from ..comfyui.config_store import ComfyUIConfigStore
        store = ComfyUIConfigStore()
        cfg = store.get_comfyui() or {}
        presets = store.get_model_presets() or []
    except Exception:  # noqa: BLE001
        cfg, presets = {}, []
    if not (cfg.get("url") or "").strip():
        raise HTTPException(400, "ComfyUI 还没配置服务地址：先到「设置 → ComfyUI → 连接」填上并保存")
    if not presets:
        raise HTTPException(400, "ComfyUI 还没有模型方案：先到「设置 → ComfyUI → 模型配置」建一套并激活")

    empty = [c for c in cells if not _cell_has_prompt(c)]
    if empty:
        ids = "、".join(f"第{x.read_order}格" for x in empty[:8])
        more = "…" if len(empty) > 8 else ""
        raise HTTPException(400, f"有 {len(empty)} 格还没有提示词（{ids}{more}）：先给每格写好提示词再批量生成")


def _cell_has_prompt(c: ComicCell) -> bool:
    return bool(
        (c.prompt_override or "").strip()
        or (c.prompt_positive or "").strip()
        or (_json(c.characters, []) or [])
    )


@router.post("/pages/{pgid}/generate")
def generate_page(pgid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    pg = _page(db, pgid)
    cells = (db.query(ComicCell).filter(ComicCell.page_id == pgid)
             .order_by(ComicCell.read_order).all())
    if not cells:
        raise HTTPException(400, "这一页还没有格子")
    _assert_generatable(cells)
    if payload.get("only_pending"):
        cells = [c for c in cells if c.gen_status != "done"]
    ids = [c.id for c in cells]
    tasks = comic_gen.queue.submit(ids, pg.project_id, f"{pg.title or '当前页'} · 整页",
                                   {c.id: pg.id for c in cells})
    db.query(ComicCell).filter(ComicCell.id.in_(ids)).update(
        {ComicCell.gen_status: "queued"}, synchronize_session=False) if ids else None
    db.commit()
    return {"ok": True, "count": len(tasks), "skipped": len(ids) - len(tasks)}


@router.post("/projects/{pid}/generate")
def generate_project(pid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    p = _project(db, pid)
    q = db.query(ComicCell).filter(ComicCell.project_id == pid)
    book_id = payload.get("book_id")
    page_ids = payload.get("page_ids")
    if book_id:
        pgs = db.query(ComicPage).filter(ComicPage.book_id == int(book_id)).all()
        q = q.filter(ComicCell.page_id.in_([x.id for x in pgs] or [0]))
    if page_ids:
        q = q.filter(ComicCell.page_id.in_([int(x) for x in page_ids]))
    all_cells = q.order_by(ComicCell.read_order).all()
    _assert_generatable(all_cells)
    if payload.get("only_pending", True):
        q = q.filter(ComicCell.gen_status != "done")
    cells = q.order_by(ComicCell.read_order).all()
    ids = [c.id for c in cells]
    tasks = comic_gen.queue.submit(ids, pid, payload.get("batch_name") or "整册生成",
                                   {c.id: c.page_id for c in cells})
    if ids:
        db.query(ComicCell).filter(ComicCell.id.in_(ids)).update(
            {ComicCell.gen_status: "queued"}, synchronize_session=False)
        db.commit()
    return {"ok": True, "count": len(tasks), "skipped": len(ids) - len(tasks)}


@router.get("/queue")
def queue_state(project_id: Optional[int] = Query(None)):
    return comic_gen.queue.snapshot(project_id)


@router.post("/queue/pause")
def queue_pause():
    comic_gen.queue.pause()
    return {"ok": True}


@router.post("/queue/resume")
def queue_resume():
    comic_gen.queue.resume()
    return {"ok": True}


@router.post("/queue/cancel")
def queue_cancel(payload: dict = Body(default={})):
    if payload.get("task_id"):
        return {"ok": comic_gen.queue.cancel(payload["task_id"])}
    comic_gen.queue.abort_batch(payload.get("batch_id"))
    return {"ok": True}


@router.post("/queue/clear")
def queue_clear():
    comic_gen.queue.clear_finished()
    return {"ok": True}


# ======================================================================
# 结构编辑：分册排序 / 页面跨册移动（左侧图层面板拖拽用）
# ======================================================================
@router.post("/books/{bid}/reorder")
def reorder_books(bid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    """把一个分册挪到工程内的第 index 位。"""
    b = db.get(ComicBook, int(bid))
    if not b:
        raise HTTPException(404, "分册不存在")
    books = (db.query(ComicBook).filter(ComicBook.project_id == b.project_id)
             .order_by(ComicBook.sort, ComicBook.id).all())
    books = [x for x in books if x.id != b.id]
    idx = max(0, min(int(payload.get("index", len(books))), len(books)))
    books.insert(idx, b)
    for i, x in enumerate(books):
        x.sort = i
        x.book_no = i + 1
    db.commit()
    return {"ok": True, "order": [x.id for x in books]}


@router.post("/pages/{pgid}/move")
def move_page(pgid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    """把页面移到别的分册（拖进/拖出文件夹），或在本册内改顺序。"""
    pg = _page(db, pgid)
    target_book = int(payload.get("book_id") or pg.book_id)
    b = db.get(ComicBook, target_book)
    if not b or b.project_id != pg.project_id:
        raise HTTPException(400, "目标分册无效")

    old_book = pg.book_id
    pg.book_id = target_book
    pg.updated_at = _now()
    db.flush()

    # 目标册重新编号；源册（如果变了）也重排，避免出现空洞页号
    target = (db.query(ComicPage).filter(ComicPage.book_id == target_book)
              .order_by(ComicPage.page_no, ComicPage.id).all())
    target = [x for x in target if x.id != pg.id]
    idx = payload.get("index")
    idx = len(target) if idx is None else max(0, min(int(idx), len(target)))
    target.insert(idx, pg)
    for i, x in enumerate(target, start=1):
        x.page_no = i
        x.sort = i - 1
    if old_book != target_book:
        rest = (db.query(ComicPage).filter(ComicPage.book_id == old_book)
                .order_by(ComicPage.page_no, ComicPage.id).all())
        for i, x in enumerate(rest, start=1):
            x.page_no = i
            x.sort = i - 1
    db.commit()
    return {"ok": True, "book_id": target_book, "index": idx}


# ======================================================================
# 工程复制（另存为）/ 批量管理 / 管理台概览
# ======================================================================
def _rewrite_url(url: str, src_pid: int, dst_pid: int) -> str:
    if not url:
        return url
    return url.replace(f"/comic-media/p{src_pid}/", f"/comic-media/p{dst_pid}/")


@router.post("/projects/{pid}/duplicate", status_code=201)
def duplicate_project(pid: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """另存为：连同图片文件一起复制成一份独立的新工程。"""
    src = _project(db, pid)
    n = db.query(ComicProject).count()
    dst = ComicProject(
        title=payload.get("title") or f"{src.title} 副本",
        mode=src.mode, page_w=src.page_w, page_h=src.page_h,
        page_margin=src.page_margin, gap=src.gap, bg_color=src.bg_color,
        reading_direction=src.reading_direction,
        style_prefix=src.style_prefix, negative_prompt=src.negative_prompt,
        workflow_preset=src.workflow_preset, model_preset=src.model_preset,
        steps=src.steps, cfg=src.cfg, seed_mode=src.seed_mode,
        cover=src.cover, description=src.description, author=src.author,
        status="draft", is_published=0, sort=n,
        category_path=payload.get("category_path", src.category_path),
    )
    db.add(dst)
    db.flush()
    new_pid = dst.id

    # 图片目录整体复制过去，再改写数据库里的路径
    s_dir = os.path.join(COMIC_DIR, f"p{src.id}")
    d_dir = os.path.join(COMIC_DIR, f"p{new_pid}")
    if os.path.isdir(s_dir):
        try:
            shutil.copytree(s_dir, d_dir, dirs_exist_ok=True)
        except Exception:  # noqa: BLE001
            pass

    books = (db.query(ComicBook).filter(ComicBook.project_id == src.id)
             .order_by(ComicBook.sort, ComicBook.id).all())
    for b in books:
        nb = ComicBook(project_id=new_pid, title=b.title, book_no=b.book_no,
                       sort=b.sort, note=b.note)
        db.add(nb)
        db.flush()
        pages = (db.query(ComicPage).filter(ComicPage.book_id == b.id)
                 .order_by(ComicPage.page_no, ComicPage.id).all())
        for pg in pages:
            npg = ComicPage(project_id=new_pid, book_id=nb.id, title=pg.title,
                            page_no=pg.page_no, width=pg.width, height=pg.height,
                            bg_color=pg.bg_color, sort=pg.sort, note=pg.note)
            db.add(npg)
            db.flush()
            cells = (db.query(ComicCell).filter(ComicCell.page_id == pg.id)
                     .order_by(ComicCell.read_order, ComicCell.id).all())
            for c in cells:
                nc = ComicCell(
                    project_id=new_pid, page_id=npg.id, read_order=c.read_order,
                    x=c.x, y=c.y, w=c.w, h=c.h, rotation=c.rotation,
                    points=c.points, border_color=c.border_color,
                    border_width=c.border_width, border_style=c.border_style,
                    border_radius=c.border_radius, opacity=c.opacity,
                    z_index=c.z_index, is_locked=c.is_locked, fit=c.fit,
                    img_scale=c.img_scale, img_offset_x=c.img_offset_x,
                    img_offset_y=c.img_offset_y, flip_h=c.flip_h,
                    bg_enabled=c.bg_enabled, bg_color=c.bg_color,
                    prompt_positive=c.prompt_positive,
                    prompt_negative=c.prompt_negative,
                    prompt_override=c.prompt_override,
                    prompt_locked=c.prompt_locked, characters=c.characters,
                    workflow_preset=c.workflow_preset, model_preset=c.model_preset,
                    steps=c.steps, cfg=c.cfg, seed=c.seed, seed_mode=c.seed_mode,
                    bubbles=c.bubbles, effects=c.effects,
                    current_image=_rewrite_url(c.current_image, src.id, new_pid),
                    gen_status=c.gen_status if c.current_image else "empty",
                )
                db.add(nc)
                db.flush()
                for v in (db.query(ComicCellVersion)
                          .filter(ComicCellVersion.cell_id == c.id).all()):
                    nv = ComicCellVersion(
                        cell_id=nc.id, image_url=_rewrite_url(v.image_url, src.id, new_pid),
                        width=v.width, height=v.height,
                        prompt_positive=v.prompt_positive,
                        prompt_negative=v.prompt_negative, params=v.params,
                        seed=v.seed, status=v.status, is_selected=v.is_selected,
                        note=v.note, elapsed=v.elapsed,
                    )
                    db.add(nv)
                    db.flush()
                    if v.is_selected or (c.current_version_id == v.id):
                        nc.current_version_id = nv.id
    dst.cover = _rewrite_url(dst.cover, src.id, new_pid) if dst.cover else None
    db.commit()
    db.refresh(dst)
    return _project_tree(db, dst)


@router.post("/projects/batch")
def batch_projects(payload: dict = Body(...), db: Session = Depends(get_db)):
    """管理台批量操作：删除 / 改分类 / 发布 / 取消发布 / 复制。"""
    action = payload.get("action") or "delete"
    ids = [int(x) for x in (payload.get("ids") or [])]
    if not ids:
        return {"ok": True, "count": 0}
    rows = db.query(ComicProject).filter(ComicProject.id.in_(ids)).all()
    n = 0
    for p in rows:
        if action == "delete":
            d = os.path.join(COMIC_DIR, f"p{p.id}")
            db.delete(p)
            if os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        elif action == "category":
            p.category_path = payload.get("category_path") or ""
            p.updated_at = _now()
        elif action == "publish":
            p.is_published = 1
            p.status = "published"
            p.updated_at = _now()
        elif action == "unpublish":
            p.is_published = 0
            p.status = "draft"
            p.updated_at = _now()
        else:
            continue
        n += 1
    db.commit()
    return {"ok": True, "count": n}


@router.get("/manage")
def manage_overview(db: Session = Depends(get_db)):
    """漫画管理台：所有工程的列表 + 分类聚合。"""
    rows = db.query(ComicProject).order_by(ComicProject.sort, -ComicProject.id).all()
    out = []
    cats: dict[str, int] = {}
    for p in rows:
        cells = db.query(ComicCell).filter(ComicCell.project_id == p.id).all()
        books = db.query(ComicBook).filter(ComicBook.project_id == p.id).count()
        pages = db.query(ComicPage).filter(ComicPage.project_id == p.id).count()
        cover = p.cover or ""
        if not cover:
            first = next((c for c in cells if c.current_image), None)
            cover = first.current_image if first else ""
        cat = p.category_path or ""
        if cat:
            for part in [cat]:
                cats[part] = cats.get(part, 0) + 1
        out.append({
            "id": p.id, "title": p.title, "mode": p.mode,
            "author": p.author or "", "description": p.description or "",
            "cover": cover, "category_path": cat,
            "is_published": int(p.is_published or 0),
            "books": books, "pages": pages,
            "cells": len(cells),
            "done": sum(1 for c in cells if c.current_image),
            "failed": sum(1 for c in cells if c.gen_status == "failed"),
            "updated_at": p.updated_at, "created_at": p.created_at,
        })
    return {"projects": out, "categories": sorted(cats.keys())}


# ======================================================================
# 人物 / 选项
# ======================================================================
@router.get("/characters")
def comic_characters(db: Session = Depends(get_db)):
    """漫画人物库：只读调用现有的人物系统（含多套外观）。"""
    rows = db.query(Character).order_by(Character.id).all()
    out = []
    for ch in rows:
        aps = (db.query(CharacterAppearance)
               .filter(CharacterAppearance.character_id == ch.id)
               .order_by(CharacterAppearance.is_default.desc(), CharacterAppearance.sort)
               .all())
        out.append({
            "id": ch.id, "name": ch.name, "title": ch.title or "",
            "type": ch.character_type, "portrait": ch.portrait_image or "",
            "personality": ch.personality or "",
            "appearances": [{"id": a.id, "name": a.name,
                             "is_default": int(a.is_default or 0)} for a in aps],
        })
    return out


@router.get("/options")
def comic_options():
    from ..comfyui.config_store import ComfyUIConfigStore
    store = ComfyUIConfigStore()
    presets = []
    try:
        presets = [{"name": m.get("name"), "note": m.get("note") or "",
                    "recipe": m.get("recipe") or "standard"}
                   for m in store.get_model_presets()]
    except Exception:  # noqa: BLE001
        presets = []
    workflows = []
    try:
        workflows = [{"name": w.get("name"), "note": w.get("note") or ""}
                     for w in store.get_workflow_presets()]
    except Exception:  # noqa: BLE001
        workflows = []
    snippets = []
    try:
        snippets = store.get_prompt_presets()
    except Exception:  # noqa: BLE001
        snippets = []
    gp = {}
    try:
        gp = store.get_gen_params()
    except Exception:  # noqa: BLE001
        gp = {}

    # ComfyUI 是否具备出图条件（服务地址已配 + 至少有一套模型方案）
    comfy = {"url": "", "has_preset": bool(presets), "ready": False}
    try:
        cfg = store.get_comfyui() or {}
        comfy["url"] = (cfg.get("url") or "").strip()
    except Exception:  # noqa: BLE001
        pass
    comfy["ready"] = bool(comfy["url"]) and bool(presets)

    return {
        "model_presets": presets,
        "workflow_presets": workflows,
        "snippets": snippets,
        "comfyui": comfy,
        "defaults": {
            "model_preset": (store.get_active_model_preset() or {}).get("name") or "",
            "steps": gp.get("steps") or 0,
            "cfg": gp.get("cfg") or 0,
        },
        "layouts": comic_layout.catalog(),
        "style_presets": [
            {"name": "黑白日漫", "text": "黑白网点日式漫画，干净线稿，高对比，分镜电影感"},
            {"name": "彩色日漫", "text": "彩色日式漫画，赛璐璐上色，明亮通透，细腻光影"},
            {"name": "韩漫条漫", "text": "韩式条漫风格，柔和渐变上色，干净人物，半写实"},
            {"name": "国风水墨", "text": "中国水墨风漫画，宣纸质感，洇染笔触，留白构图"},
            {"name": "美式硬派", "text": "美式漫画风格，粗壮墨线，强烈明暗对比，美漫分镜"},
            {"name": "厚涂写实", "text": "厚涂写实风格，电影级光照，细节丰富，暗调氛围"},
        ],
    }


# ======================================================================
# 前台阅读（只读，只给已发布）
# ======================================================================
@public_router.get("/projects")
def public_projects(db: Session = Depends(get_db)):
    rows = (db.query(ComicProject).filter(ComicProject.is_published == 1)
            .order_by(ComicProject.sort, -ComicProject.id).all())
    out = []
    for p in rows:
        pages = db.query(ComicPage).filter(ComicPage.project_id == p.id).count()
        cover = p.cover
        if not cover:
            first = (db.query(ComicCell).join(ComicPage, ComicCell.page_id == ComicPage.id)
                     .filter(ComicPage.project_id == p.id,
                             ComicCell.current_image.isnot(None))
                     .order_by(ComicCell.read_order).first())
            cover = (first.current_image if first else "") or ""
        d = project_out(p)
        d.update({"page_count": pages, "cover": cover})
        out.append(d)
    return out


@public_router.get("/projects/{pid}")
def public_project(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    if not p.is_published:
        raise HTTPException(404, "作品未发布")
    return _project_tree(db, p)
