# -*- coding: utf-8 -*-
"""把分散的种子模块组装成一份完整的定义字典。"""

from . import seed_core, seed_cloth, seed_poses, seed_themes, theme_class


# ===================== 出图模式（风格基调） =====================
# 不放进可编辑 JSON：这是渲染器行为，不是素材内容。
# 出图模式不再自带负面词（用户要求：负面提示词一律留空，需要时自己在出图参数里填）
MODES = [
    {"id": "default", "name": "默认", "cn": "", "neg": ""},
    {"id": "realistic", "name": "写实摄影",
     "cn": "写实摄影风格，真实皮肤质感与自然光影，像一张高质量人像摄影",
     "neg": ""},
    {"id": "anime", "name": "日系动漫",
     "cn": "日系动漫插画风格，干净线稿，平涂上色，通透的高光",
     "neg": ""},
    {"id": "painterly", "name": "厚涂插画",
     "cn": "厚涂数字插画风格，笔触明显，体积感强，戏剧化光影",
     "neg": ""},
    {"id": "ink", "name": "国风水墨",
     "cn": "国风水墨风格，墨色浓淡晕染，留白意境",
     "neg": ""},
    {"id": "dark", "name": "暗黑史诗",
     "cn": "暗黑史诗风格，低明度打光，强对比阴影，压迫感构图",
     "neg": ""},
    {"id": "3d", "name": "3D 渲染",
     "cn": "3D 渲染风格，材质细腻，次表面散射，柔和棚拍光",
     "neg": ""},
]


# ===================== 画面 / 取景 / 负面词模板（可编辑） =====================
# 红线：所有提示词不准写死在程序里 —— 【画面】【取景】【负面词】全部数据化，
# 存进 appearance_defs.json 的 renderTemplates / negativeWords，后台「定义管理」可改/删/增。
# 这里只是首次种子；之后以 JSON 为准，改这里的常量不会覆盖用户已有的编辑。
_RENDER_BASE_TAGS = ["正面站立", "居中构图", "纯色背景", "无背景元素", "角色设定图",
                     "服装细节清晰", "五官清晰", "柔和均匀的光线", "高清细节"]
RENDER_TEMPLATES_SEED = {
    "full": {
        "name": "全身",
        "tags": ["全身像"] + _RENDER_BASE_TAGS,
        "sceneLine": "",
    },
    "half": {
        "name": "半身",
        "tags": ["半身像", "腰部以上", "上半身构图", "画面下缘止于腰部"] + _RENDER_BASE_TAGS,
        "sceneLine": "只表现腰部以上的上半身，不画裙摆、裤腿与鞋袜",
    },
    "head": {
        "name": "头部特写",
        "tags": ["头部特写", "面部特写", "肩部以上构图", "聚焦面部"] + _RENDER_BASE_TAGS,
        "sceneLine": "只画头部与肩颈的面部特写，不画身体、四肢与衣物",
    },
}
NEGATIVE_WORDS_SEED = {
    "base": [],
    "half": [],
    "head": [],
}


def build():
    dims = []
    for d in seed_core.DIMS:
        if d["id"] == "nationality":
            d = {**d, "options": list(seed_themes.NATIONALITIES)}
        dims.append(d)
    dims.extend(seed_cloth.DIMS_CLOTH)
    dims.extend(seed_poses.build_pose_dim())
    # 立绘取景选项补 behavior 字段：决定半身/头部裁剪逻辑（新增选项默认 full）
    for d in dims:
        if d.get("id") == "framing":
            for o in d.setdefault("options", []):
                if o.get("id") in ("full", "half", "head") and not o.get("behavior"):
                    o["behavior"] = o["id"]
    return {
        "version": 5,
        "groups": [dict(g) for g in seed_core.GROUPS],
        "dims": dims,
        # 题材只有 4 个，且只做参数约束（不带提示词）—— 见 theme_class.py
        "themes": theme_class.theme_seed(),
        "poseCategories": [dict(c) for c in seed_poses.POSE_CATEGORIES],
        # 画面/取景模板 + 负面词：全部可编辑（定义管理），不再写死在 generator.py
        "renderTemplates": {k: {**v} for k, v in RENDER_TEMPLATES_SEED.items()},
        "negativeWords": {k: list(v) for k, v in NEGATIVE_WORDS_SEED.items()},
    }
