# -*- coding: utf-8 -*-
"""
人物外观维度定义 —— 门面层。

真正的数据在 backend/data/appearance_defs.json（由 defs_store 读写，可在后台增删改）。
这里只做「对外暴露」：常量、查询函数、条件判定。

迁移说明：
旧版把 7 大分组 / 70 个维度 / 全部枚举硬编码在本文件里，无法在线编辑；
v3 起改为 JSON 数据源，本文件保留同名查询接口，避免上层大改。
"""

from . import defs_store
from .defs_store import (  # noqa: F401  向外转发查询/写入接口
    DEFS_PATH, load, data, save, reset, snapshot,
    groups, dims, themes, pose_categories,
    dim_by_id, option_of, option_name, theme_by_id,
    upsert_group, delete_group, upsert_dim, delete_dim,
    upsert_option, delete_option, move_option,
    upsert_pose_category, delete_pose_category,
    upsert_theme, delete_theme,
    age_band, cond_met,
)
from .seed_core import (  # noqa: F401
    HAIR_COLORS, EYE_COLORS, SKIN_COLORS, CLOTH_COLORS, SHOE_COLORS,
    NEUTRAL, SHOE_NEUTRAL, WARM, COOL,
    COLOR_EN, COLOR_CN, SCENE_TAGS_CN, SCENE_TAGS_EN,
)
from .seed_defs import MODES  # noqa: F401

# 兼容旧引用
MAT_MODES = MODES

__all__ = [
    "DEFS_PATH", "load", "data", "save", "reset", "snapshot",
    "groups", "dims", "themes", "pose_categories",
    "dim_by_id", "option_of", "option_name", "theme_by_id",
    "upsert_group", "delete_group", "upsert_dim", "delete_dim",
    "upsert_option", "delete_option", "move_option",
    "upsert_pose_category", "delete_pose_category",
    "upsert_theme", "delete_theme",
    "age_band", "cond_met",
    "HAIR_COLORS", "EYE_COLORS", "SKIN_COLORS", "CLOTH_COLORS", "SHOE_COLORS",
    "NEUTRAL", "SHOE_NEUTRAL", "WARM", "COOL",
    "COLOR_EN", "COLOR_CN", "SCENE_TAGS_CN", "SCENE_TAGS_EN",
    "MODES", "MAT_MODES",
]
