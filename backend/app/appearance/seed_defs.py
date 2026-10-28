# -*- coding: utf-8 -*-
"""把分散的种子模块组装成一份完整的定义字典。"""

from . import seed_core, seed_cloth, seed_poses, seed_themes


# ===================== 出图模式（风格基调） =====================
# 不放进可编辑 JSON：这是渲染器行为，不是素材内容。
MODES = [
    {"id": "default", "name": "默认", "cn": "", "neg": ""},
    {"id": "realistic", "name": "写实摄影",
     "cn": "写实摄影风格，真实皮肤质感与自然光影，像一张高质量人像摄影",
     "neg": "卡通描边，低分辨率，畸形肢体，多余手指"},
    {"id": "anime", "name": "日系动漫",
     "cn": "日系动漫插画风格，干净线稿，平涂上色，通透的高光",
     "neg": "写实照片，粗糙笔触，浑浊色彩"},
    {"id": "painterly", "name": "厚涂插画",
     "cn": "厚涂数字插画风格，笔触明显，体积感强，戏剧化光影",
     "neg": "平涂，简笔线条"},
    {"id": "ink", "name": "国风水墨",
     "cn": "国风水墨风格，墨色浓淡晕染，留白意境",
     "neg": "鲜艳饱和色，写实摄影"},
    {"id": "dark", "name": "暗黑史诗",
     "cn": "暗黑史诗风格，低明度打光，强对比阴影，压迫感构图",
     "neg": "明亮阳光，可爱萌系"},
    {"id": "3d", "name": "3D 渲染",
     "cn": "3D 渲染风格，材质细腻，次表面散射，柔和棚拍光",
     "neg": "手绘线条，二维平涂"},
]


def build():
    dims = []
    for d in seed_core.DIMS:
        if d["id"] == "nationality":
            d = {**d, "options": list(seed_themes.NATIONALITIES)}
        dims.append(d)
    dims.extend(seed_cloth.DIMS_CLOTH)
    dims.extend(seed_poses.build_pose_dim())
    return {
        "version": 5,
        "groups": [dict(g) for g in seed_core.GROUPS],
        "dims": dims,
        "themes": seed_themes.apply_rules([dict(t) for t in seed_themes.THEMES]),
        "poseCategories": [dict(c) for c in seed_poses.POSE_CATEGORIES],
    }
