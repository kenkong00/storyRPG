# -*- coding: utf-8 -*-
"""素材引用反查：这张图现在被谁用着。

不建「引用表」，改成实时反查各业务表的图片字段。原因：
  引用表一旦存在，就得每个保存接口都记得写它，漏一次就永久错位；
  而反查永远和业务表一致，多一个模块只要在 OWNERS 里加一行。

代价是一次全表扫（每张表行数都是几十到几百），所以调用方按批调用
`usage_index()` 拿到一次扫描的索引，别在循环里一张一张查。
"""

from __future__ import annotations

import importlib

# (owner_type, 中文, 模块, 类名, 图片字段, 名称字段候选, 后台页面)
OWNERS = [
    ("character", "人物", "character", "Character", "portrait_image", ("name",), "characters"),
    ("scene", "场景", "scene", "Scene", "background_image", ("name", "title"), "scenes"),
    ("item", "物品", "item", "Item", "image", ("name", "title"), "items"),
    ("equipment", "装备", "equipment", "Equipment", "image", ("name",), "equipments"),
    ("skill", "技能", "skill", "Skill", "image", ("name",), "skills"),
    ("animation", "动效", "animation", "AnimationEffect", "preview_image",
     ("name", "title"), "animations"),
    ("story_node", "剧情节点", "story", "StoryNode", "image", ("title", "name"), "story"),
    ("game", "游戏", "game", "Game", "image", ("name", "title"), "games"),
    ("game_button", "界面按钮", "game", "GameButton", "image", ("label", "name", "text"), "games"),
]


def _load(module: str, cls: str):
    try:
        mod = importlib.import_module(f"..models.{module}", package=__package__)
        return getattr(mod, cls)
    except Exception:  # noqa: BLE001
        return None


def usage_index(db) -> dict[str, list[dict]]:
    """一次扫描，返回 {图片url: [引用信息, ...]}。"""
    idx: dict[str, list[dict]] = {}
    for owner_type, label, module, cls_name, field, name_fields, page in OWNERS:
        model = _load(module, cls_name)
        if model is None or not hasattr(model, field):
            continue
        try:
            rows = db.query(model).all()
        except Exception:  # noqa: BLE001
            continue
        for row in rows:
            url = getattr(row, field, None)
            if not url:
                continue
            name = ""
            for nf in name_fields:
                v = getattr(row, nf, None)
                if v:
                    name = str(v)
                    break
            idx.setdefault(url, []).append({
                "owner_type": owner_type,
                "label": label,
                "owner_id": getattr(row, "id", None),
                "name": name,
                "slot": field,
                "page": page,
            })
    return idx


def usages_of(db, url: str) -> list[dict]:
    return usage_index(db).get(url, [])
