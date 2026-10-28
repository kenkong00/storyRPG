# -*- coding: utf-8 -*-
"""场景拼装生成器：随机组合维度 → 中文场景提示词；人物 × 场景合成提示词。"""

import random

from . import defs_store as defs

# 拼装顺序（与 UI 分组顺序一致，提示词读起来才顺）
# 2026-10-28：加入地区 / 时代 / 景深层次（远中近 + 天空 + 规模）等新维度，
# 场景不再是"一句话地点"，而是能分出前中后景的完整画面。
DIM_ORDER = ["sceneType", "region", "era", "architecture", "density", "material",
             "terrain", "vegetation", "water", "season", "time", "weather", "sky",
             "light", "scale", "far", "mid", "near", "depth",
             "mood", "camera", "style", "color", "detail", "crowd"]

SCENE_NEG = ["低分辨率", "模糊", "畸变", "透视错误", "文字", "水印", "签名",
             "界面元素", "人物", "人体", "角色", "多人", "多余结构", "拼接痕迹",
             "过曝", "欠曝"]

# 合成时不能把「人物」写进负面，否则人物会被抹掉
COMPOSE_NEG = ["低分辨率", "模糊", "畸形", "比例失调", "多余肢体", "断肢",
               "脸部扭曲", "文字", "水印", "签名", "界面元素",
               "人物与背景割裂", "贴纸感", "过曝", "欠曝"]


def _opt_cn(dim_id, opt_id):
    if not opt_id:
        return ""
    o = defs.option_of(dim_id, opt_id)
    if o:
        return o.get("cn") or o.get("name") or opt_id
    return ""


def _pool(dim_id, theme):
    """返回该维度的候选选项；题材给了 pools 就按 pools 收敛。"""
    d = defs.dim_by_id(dim_id)
    opts = (d or {}).get("options") or []
    if not theme:
        return opts
    pools = (theme.get("pools") or {}).get(dim_id)
    if not pools:
        return opts
    keep = set(pools)
    picked = [o for o in opts if o["id"] in keep]
    return picked or opts


def random_scene(theme=None, seed=None, base=None):
    """随机一套场景。theme 可以是 id 字符串或主题字典；base 里已有的维度保留。"""
    if seed is not None:
        random.seed(seed)
    theme_obj = theme if isinstance(theme, dict) else (
        defs.theme_by_id(theme) if theme else None)
    c = dict(base or {})
    if theme_obj:
        c["theme"] = theme_obj["id"]
    for dim_id in DIM_ORDER:
        pool = _pool(dim_id, theme_obj)
        if not pool:
            continue
        # 色彩通过色板收敛：主题有 colors 时优先在其中挑
        if dim_id == "color" and theme_obj and theme_obj.get("colors"):
            allowed = [o for o in pool if o["id"] in set(theme_obj["colors"])]
            if allowed:
                pool = allowed
        c[dim_id] = random.choice(pool)["id"]
    return c


def reroll_dim(c, dim_id, theme=None):
    theme_obj = theme if isinstance(theme, dict) else (
        defs.theme_by_id(theme) if theme else (defs.theme_by_id(c.get("theme")) if c.get("theme") else None))
    pool = _pool(dim_id, theme_obj)
    if not pool:
        return None
    cur = c.get(dim_id)
    rest = [o for o in pool if o["id"] != cur] or pool
    return random.choice(rest)["id"]


def build_prompt_blocks(c, free_prompt=None):
    """返回 {posCn, negCn}。free_prompt 作为【补充】追加在最后。"""
    theme_obj = defs.theme_by_id(c.get("theme")) if c.get("theme") else None
    lines = []
    if theme_obj:
        lines.append("【题材】" + (theme_obj.get("cn") or theme_obj.get("name") or ""))

    def line(title, dims):
        parts = [_opt_cn(d, c.get(d)) for d in dims]
        parts = [p for p in parts if p]
        if parts:
            lines.append(f"【{title}】" + "，".join(parts))

    line("题材", ["region"])
    line("场景", ["sceneType", "era", "architecture", "density", "material"])
    line("地面与植被", ["terrain", "vegetation", "water"])
    line("时令", ["season", "time"])
    line("天候", ["weather", "sky"])
    line("光线", ["light"])
    # 景深单独成段：远景 → 中景 → 近景，模型才知道各层放什么
    line("景深", ["scale", "far", "mid", "near", "depth"])
    line("氛围", ["mood"])
    line("构图", ["camera"])
    line("风格", ["style"])
    line("色调", ["color"])
    line("细节", ["detail", "crowd"])
    extra = (free_prompt or "").strip()
    if extra:
        lines.append("【补充】" + extra)
    lines.append("【画面】纯场景，无人物，无角色，场景概念设定图，高清细节，电影级光影，宽幅构图")

    pos = "\n".join([x for x in lines if x and not x.endswith("】")])
    return {"posCn": pos, "negCn": "，".join(SCENE_NEG)}


def to_prompt_parts(c, free_prompt=None):
    b = build_prompt_blocks(c, free_prompt)
    return {"posCn": b["posCn"], "negCn": b["negCn"],
            "cn": b["posCn"], "en": "", "posEn": "", "negEn": ""}


def _strip_lines(text, prefixes):
    out = []
    for ln in (text or "").split("\n"):
        s = ln.strip()
        if not s:
            continue
        if any(s.startswith(p) for p in prefixes):
            continue
        out.append(s)
    return out


def compose_prompt(char_appearance, scene_appearance, free_prompt=None,
                   character_name=None, framing="full", shot="medium",
                   placement="center", extra="", include_sensitive=True):
    """人物 × 场景 合成提示词。

    人物那一段去掉「纯色背景 / 全身像 / 取景」这些立绘专用画面词，
    场景那一段去掉「无人物」；最后补一段构图指令，让模型知道人放在哪里、
    是全身还是半身、环境光要怎么包住人物。
    """
    from ..appearance import generator as char_gen

    char_parts = char_gen.to_prompt_parts(char_appearance or {},
                                          include_sensitive=include_sensitive, framing=framing)
    scene_parts = build_prompt_blocks(scene_appearance or {}, None)

    char_lines = _strip_lines(char_parts.get("posCn"), ("【画面】", "【取景】"))
    scene_lines = _strip_lines(scene_parts.get("posCn"), ("【画面】",))

    shot_txt = {
        "full": "全身入镜，从头到脚完整显示",
        "medium": "七分身构图，膝盖以上",
        "half": "半身构图，腰部以上",
        "close": "近景特写，胸部以上",
    }.get(shot or "medium", "七分身构图")
    place_txt = {
        "left": "人物位于画面左侧三分之一处",
        "right": "人物位于画面右侧三分之一处",
        "center": "人物位于画面中央",
        "foreground": "人物位于画面前景，背景纵深展开",
    }.get(placement or "center", "人物位于画面中央")

    lines = list(char_lines)
    lines += scene_lines
    lines.append("【合成构图】" + "，".join([
        shot_txt, place_txt,
        "人物与场景比例协调，透视一致",
        "环境光包裹人物，人物受场景光线影响",
        "人物与背景自然融合，有接触阴影",
        "电影级画面，景深自然",
    ]))
    extra = (extra or "").strip()
    if extra:
        lines.append("【补充】" + extra)
    if free_prompt and free_prompt.strip():
        lines.append("【场景补充】" + free_prompt.strip())
    lines.append("【画面】电影感构图，高清细节，人物与场景融为一体，非贴图合成")

    neg = list(COMPOSE_NEG)
    if shot in ("half", "close"):
        neg += ["全身照", "腿部", "脚"]
    return {"posCn": "\n".join(lines), "negCn": "，".join(neg)}


# 单个/多个人物的站位说法（合成用，措辞比场景描述更强调「相对位置」）
_PLACE_TXT = {
    "left": "位于画面左侧三分之一处",
    "center": "位于画面中央",
    "right": "位于画面右侧三分之一处",
    "foreground": "位于画面前景、靠近镜头",
    "background": "位于画面后景、稍远一些",
}

_SHOT_TXT = {
    "full": "全身入镜，从头到脚完整显示",
    "medium": "七分身构图，膝盖以上",
    "half": "半身构图，腰部以上",
    "close": "近景特写，胸部以上",
}


def compose_prompt_multi(characters, scene_appearance, free_prompt=None,
                         shot="medium", placement="center", extra="",
                         include_sensitive=True):
    """多人物 × 场景 合成提示词。

    characters: [{
        "appearance": {外观维度…},   # 已套好动作的外观
        "name": "艾拉",              # 人物名（只用于提示词分段，可空）
        "framing": "full"|"half",   # 该人物的立绘取景
        "shot": "full"|"medium"…,   # 该人物在画面里的大小（空则用全局）
        "placement": "left"|…       # 该人物站位（空则用全局）
        "note": "手里握着断剑"      # 这一幕里人物的具体状态（可空）
    }]

    与单人版的关键差别：每个人物单独一段并带位置约束，段与段之间刻意不合并，
    末尾再补「多人关系」约束（谁前谁后、互不融合、遮挡成立），避免模型把两个人
    糊成一个人或凭空多画人。
    """
    from ..appearance import generator as char_gen

    chars = [c for c in (characters or []) if isinstance(c, dict)]
    scene_parts = build_prompt_blocks(scene_appearance or {}, None)
    scene_lines = _strip_lines(scene_parts.get("posCn"), ("【画面】",))

    n = len(chars)
    lines = []
    for i, c in enumerate(chars):
        framing = c.get("framing") or "full"
        char_parts = char_gen.to_prompt_parts(
            c.get("appearance") or {}, include_sensitive=include_sensitive,
            framing=framing)
        body = _strip_lines(char_parts.get("posCn"), ("【画面】", "【取景】"))
        if n > 1:
            # 多人时每段都自称「人物」会互相打架，改成「外貌」保持主谓清楚
            body = [(ln.replace("【人物】", "【外貌】", 1) if ln.startswith("【人物】") else ln)
                    for ln in body]
        name = (c.get("name") or "").strip()
        label = f"【人物{i + 1}】" if n > 1 else "【人物】"
        if n > 1 and name:
            label = f"【人物{i + 1}·{name}】"
        elif name:
            label = f"【人物·{name}】"
        # 每个人物先交代「是谁、在哪、多大」，再展开外貌细节
        where = _PLACE_TXT.get(c.get("placement") or placement, _PLACE_TXT["center"])
        size = _SHOT_TXT.get(c.get("shot") or shot, _SHOT_TXT["medium"])
        lines.append(label + "，".join([x for x in [size, where] if x]))
        lines += body
        note = (c.get("note") or "").strip()
        if note:
            lines.append("【人物细节】" + note)

    lines += scene_lines

    shot_txt = _SHOT_TXT.get(shot or "medium", _SHOT_TXT["medium"])
    if n <= 1:
        place_txt = _PLACE_TXT.get(placement or "center", _PLACE_TXT["center"]).replace(
            "位于", "人物位于")
        comp = [shot_txt, place_txt,
                "人物与场景比例协调，透视一致",
                "环境光包裹人物，人物受场景光线影响",
                "人物与背景自然融合，有接触阴影",
                "电影级画面，景深自然"]
    else:
        comp = [shot_txt,
                f"画面中恰好{n}个人，位置关系明确、互不重叠",
                "前排人物略大、后排人物略小，近大远小成立",
                "人物之间体积关系正确，相互遮挡自然，不粘连、不融合",
                "每个人物各自独立完整，五官与肢体不串到别人身上",
                "人物与场景比例协调，透视一致",
                "环境光同时包裹全部人物，人物受场景光线影响",
                "人物与背景自然融合，有接触阴影",
                "电影级画面，景深自然"]
    lines.append("【合成构图】" + "，".join(comp))

    extra = (extra or "").strip()
    if extra:
        lines.append("【补充】" + extra)
    if free_prompt and free_prompt.strip():
        lines.append("【场景补充】" + free_prompt.strip())
    lines.append("【画面】电影感构图，高清细节，人物与场景融为一体，非贴图合成")

    neg = list(COMPOSE_NEG)
    if shot in ("half", "close"):
        neg += ["全身照", "腿部", "脚"]
    if n > 1:
        neg += ["单人", "只有一个人", "人物融合", "多余的人", "多余的身体", "重复的脸"]
    else:
        neg += ["多人", "两个人", "重影"]
    return {"posCn": "\n".join(lines), "negCn": "，".join(neg),
            "character_count": n}


def get_defs():
    groups_out = []
    for g in defs.groups():
        group_dims = []
        for d in defs.dims():
            if d.get("group") != g["id"]:
                continue
            group_dims.append({
                "id": d["id"], "name": d["name"],
                "options": [{"id": o["id"], "name": o.get("name", o["id"]),
                             "cn": o.get("cn") or "", "tags": o.get("tags") or []}
                            for o in (d.get("options") or [])],
            })
        groups_out.append({"id": g["id"], "name": g["name"],
                           "icon": g.get("icon", ""), "dims": group_dims})
    return {
        "groups": groups_out,
        "themes": [{"id": t["id"], "name": t["name"], "desc": t.get("desc", ""),
                    "cn": t.get("cn", ""), "colors": t.get("colors") or []}
                   for t in defs.themes()],
        "dimOrder": DIM_ORDER,
    }
