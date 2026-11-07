# -*- coding: utf-8 -*-
"""删除人物时的连带清理：图、记录、磁盘文件。

以前删人物只删 `characters` 这一行，动作表情图 / 立绘 / 素材登记 / 生成记录
全都留在库里 —— 人物没了，图却还占着素材库和图库，时间一长就是几百张
没有主人的 png。

这里的顺序是「先算、再问、后删」：
  1. 先把这个人名下的所有图片 url 收齐（动作图 / 立绘 / 表情 / 生成记录 / 素材登记）；
  2. 用 asset_usages 反查每张图是不是还被别处用着（比如被某段剧情当背景），
     被用着就只删记录、不删文件，免得剧情节点变成空图；
  3. 删数据库记录，最后删人物本身。
"""

from __future__ import annotations

import json
import os
from typing import Iterable

from sqlalchemy.orm import Session

from ..models.asset import Asset
from ..models.character import Character
from ..models.character_appearance import CharacterAppearance
from ..models.character_pose import CharacterPoseImage
from ..models.generated_image import GeneratedImage
from ..models.story import StoryNodeDialogue
from . import asset_store
from .asset_usages import usage_index


def _safe_json(text: str | None) -> dict:
    if not text:
        return {}
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def collect_character_images(db: Session, character_id: int) -> set[str]:
    """这个人名下的全部图片 url（不含去重后的判断）。"""
    urls: set[str] = set()

    for row in db.query(CharacterPoseImage).filter(
            CharacterPoseImage.character_id == character_id).all():
        if row.image_url:
            urls.add(row.image_url)

    for row in db.query(GeneratedImage).filter(
            GeneratedImage.character_id == character_id).all():
        if row.url:
            urls.add(row.url)

    for row in db.query(Asset).filter(
            Asset.subject_type == "character", Asset.subject_id == character_id).all():
        if row.url:
            urls.add(row.url)

    ch = db.query(Character).filter(Character.id == character_id).first()
    if ch:
        if ch.portrait_image:
            urls.add(ch.portrait_image)
        urls.update(v for v in _safe_json(ch.expressions).values() if isinstance(v, str))
        # 外观配置里也可能存了一张参考图（历史数据里有，字段不一定存在）
        for app in db.query(CharacterAppearance).filter(
                CharacterAppearance.character_id == character_id).all():
            for key in ("portrait_image", "image", "reference_image"):
                val = getattr(app, key, None)
                if isinstance(val, str) and val:
                    urls.add(val)
    return urls


def _still_used_by_others(idx: dict, url: str, character_id: int) -> bool:
    """除「本人」以外的引用。被别处用着就不删文件。"""
    for ref in idx.get(url, []):
        if ref.get("owner_type") == "character" and ref.get("owner_id") == character_id:
            continue
        return True
    return False


def _orphan_pose_files(character_id: int) -> Iterable[str]:
    """磁盘上 `pose_{id}_*` 的漏登记文件。登记表可能因为历史原因缺行。"""
    root = asset_store.GENERATED_DIR
    prefix = f"pose_{character_id}_"
    try:
        names = os.listdir(root)
    except Exception:  # noqa: BLE001
        return []
    return [os.path.join(root, n) for n in names if n.startswith(prefix)]


def delete_character_bundle(db: Session, character_id: int) -> dict:
    """删人物 + 名下图片。返回统计，供接口回给前端提示。"""
    ch = db.query(Character).filter(Character.id == character_id).first()
    if not ch:
        return {"ok": False, "error": "人物不存在"}

    urls = collect_character_images(db, character_id)
    idx = usage_index(db)

    files_removed = 0
    kept_because_used: list[str] = []

    # ---- 1) 先删「登记」：动作图 / 生成记录 / 素材 ----
    pose_rows = db.query(CharacterPoseImage).filter(
        CharacterPoseImage.character_id == character_id).all()
    for row in pose_rows:
        db.delete(row)

    gen_rows = db.query(GeneratedImage).filter(
        GeneratedImage.character_id == character_id).all()
    for row in gen_rows:
        db.delete(row)

    asset_rows = db.query(Asset).filter(
        Asset.subject_type == "character", Asset.subject_id == character_id).all()
    # 资产也可能只按 url 登记过（早期没写 subject_*），一并清掉；
    # 但明确属于别的主体（比如同一张图被当成场景素材）的记录要留着。
    if urls:
        asset_rows += db.query(Asset).filter(
            Asset.url.in_(list(urls)),
            (Asset.subject_type.is_(None)) | (Asset.subject_type == ""),
        ).all()
    seen_asset_ids: set[int] = set()
    for row in asset_rows:
        if row.id in seen_asset_ids:
            continue
        seen_asset_ids.add(row.id)
        db.delete(row)

    # ---- 2) 再删文件（跳过仍被别处引用的） ----
    for url in urls:
        if _still_used_by_others(idx, url, character_id):
            kept_because_used.append(url)
            continue
        path = asset_store.url_to_path(url)
        if not path or not os.path.exists(path):
            continue
        try:
            os.remove(path)
            files_removed += 1
        except Exception:  # noqa: BLE001
            pass

    # ---- 3) 漏登记的动作图文件 ----
    for path in _orphan_pose_files(character_id):
        try:
            os.remove(path)
            files_removed += 1
        except Exception:  # noqa: BLE001
            pass

    # ---- 4) 外观配置 / 标签 / 人物本体 ----
    for app in db.query(CharacterAppearance).filter(
            CharacterAppearance.character_id == character_id).all():
        db.delete(app)
    try:
        from ..routers.tag import delete_character_tag
        delete_character_tag(db, character_id)
    except Exception:  # noqa: BLE001
        pass

    # ---- 5) 剧情里还指着他说话的台词：转成旁白，文字保留 ----
    # 不清的话 speaker_id 指向一个已经不存在的人物，前台渲染出来是个空名字。
    # 把名字写回台词开头，读起来仍然知道是谁说的。
    dlg_rows = db.query(StoryNodeDialogue).filter(
        StoryNodeDialogue.speaker_id == character_id).all()
    for d in dlg_rows:
        d.speaker_id = None
        text = (d.content or "").strip()
        if text and not text.startswith(f"{ch.name}："):
            d.content = f"{ch.name}：{text}"
    detached = len(dlg_rows)

    db.delete(ch)
    db.commit()

    return {
        "ok": True,
        "character_id": character_id,
        "images_removed": len(urls) - len(kept_because_used),
        "files_removed": files_removed,
        "dialogues_detached": detached,
        "kept_in_use": kept_because_used,
    }
