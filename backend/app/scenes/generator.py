# -*- coding: utf-8 -*-
"""场景拼装生成器：限定项（手选）× 细节元素（按地点随机）→ 中文提示词；人物 × 场景合成。

2026-11 重构后的两层：
  1) **限定项 LIMIT_DIMS**：地点类型 / 时代 / 景深层次 / 镜头构图 / 光线 / 主色调 / 画风。
     这些是用户手选的，随机永远不会覆盖（只有「换地点」或「题材预设」才会动它们）。
  2) **细节元素**：由地点类型决定。地下洞窟 → 水体 / 岩石与沉积物 / 遗迹 / 生物 /
     矿脉；校园教室 → 课桌 / 学习用品 / 墙面 / 环境痕迹 / 室外。这一层才是随机区。
"""

import random

from . import defs_store as defs

# 限定项：顺序即页面上的排列顺序 + 提示词里的叙述顺序
LIMIT_DIMS = ["sceneType", "era", "depthOfField", "camera", "light", "color", "style"]

# 兼容旧调用方（场景合成那边还 import 过 DIM_ORDER）
DIM_ORDER = list(LIMIT_DIMS)

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


def _opts(dim_id):
    d = defs.dim_by_id(dim_id)
    return (d or {}).get("options") or []


def _pool(dim_id, theme):
    """返回该维度的候选选项；题材给了 pools 就按 pools 收敛。"""
    opts = _opts(dim_id)
    if not theme:
        return opts
    pools = (theme.get("pools") or {}).get(dim_id)
    if not pools:
        return opts
    keep = set(pools)
    picked = [o for o in opts if o["id"] in keep]
    return picked or opts


def scene_packs(scene_type):
    """该地点类型挂了哪些细节元素包。"""
    o = defs.option_of("sceneType", scene_type) or {}
    return list(o.get("packs") or [])


def element_dims(scene_type):
    """地点类型对应的元素维度（按种子里的展开顺序）。"""
    packs = set(scene_packs(scene_type))
    if not packs:
        return []
    return [d for d in defs.dims() if d.get("pack") in packs]


def limit_dims():
    """7 个限定维度（保持 LIMIT_DIMS 的顺序）。"""
    out = []
    for did in LIMIT_DIMS:
        d = defs.dim_by_id(did)
        if d:
            out.append(d)
    return out


def _clean(c):
    """丢掉已不存在的维度值（老场景存着 time / weather / mood 这些）。"""
    known = {d["id"] for d in defs.dims()}
    return {k: v for k, v in (c or {}).items() if k in known or k == "theme"}


def _theme_obj(theme):
    return theme if isinstance(theme, dict) else (
        defs.theme_by_id(theme) if theme else None)


def apply_theme(c, theme_obj):
    """把题材的限定项预设套上去（只在用户没选时填，不覆盖手选）。"""
    if not theme_obj:
        return c
    for dim_id in LIMIT_DIMS:
        if c.get(dim_id):
            continue
        pool = _pool(dim_id, theme_obj)
        if pool:
            c[dim_id] = pool[0]["id"]
    return c


def theme_for_scene_type(scene_type):
    """反查跟这个地点最搭的题材（用来给限定项一个协调的默认值）。

    不指定题材时，随机出来的「现代 + 温暖酒馆」这种组合很难看，
    所以默认值优先跟随第一个把该地点收进 pools 的题材。
    """
    if not scene_type:
        return None
    for t in defs.themes():
        if scene_type in ((t.get("pools") or {}).get("sceneType") or []):
            return t
    return None


def random_scene(theme=None, seed=None, base=None, fill_limits=None):
    """随机一套场景。

    - fill_limits=True：限定项缺哪补哪（首次进拼装页用，让下拉有默认值）
    - fill_limits=False / 传了 base：限定项一律不动，只重随机细节元素
    """
    if seed is not None:
        random.seed(seed)
    theme_obj = _theme_obj(theme)
    c = _clean(base)
    if theme_obj:
        c["theme"] = theme_obj["id"]
    if fill_limits is None:
        fill_limits = True   # 默认只补空位，绝不覆盖已有手选值

    # 1) 限定项：缺省才填，已有的一律保留（用户手选优先）
    if fill_limits:
        if not c.get("sceneType"):
            pool = _pool("sceneType", theme_obj) or _opts("sceneType")
            if pool:
                c["sceneType"] = random.choice(pool)["id"]
        # 其余限定项跟随「与这个地点最搭的题材」，组合更协调
        hint = theme_obj or theme_for_scene_type(c.get("sceneType"))
        for dim_id in LIMIT_DIMS:
            if dim_id == "sceneType" or c.get(dim_id):
                continue
            pool = _pool(dim_id, hint) or _opts(dim_id)
            if pool:
                c[dim_id] = random.choice(pool)["id"]

    # 2) 细节元素：整块重随机。地点换了元素包也跟着换，旧值必须清掉
    keep = {d["id"] for d in element_dims(c.get("sceneType"))}
    for k in list(c.keys()):
        d = defs.dim_by_id(k)
        if d and d.get("pack") and k not in keep:
            c.pop(k, None)
    for d in element_dims(c.get("sceneType")):
        pool = d.get("options") or []
        if pool:
            c[d["id"]] = random.choice(pool)["id"]
    return c


def reroll_dim(c, dim_id, theme=None):
    """换掉单个维度的值。元素维度直接就换；限定维度也允许（题材预设用）。"""
    theme_obj = _theme_obj(theme) if theme else (
        defs.theme_by_id(c.get("theme")) if c.get("theme") else None)
    d = defs.dim_by_id(dim_id)
    if not d:
        return None
    # 元素维度必须属于当前地点，否则不给换（防止把别的包的值塞进来）
    if d.get("pack") and d["pack"] not in scene_packs(c.get("sceneType")):
        return None
    pool = _pool(dim_id, theme_obj) or (d.get("options") or [])
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

    line("场景", ["sceneType"])
    line("时代", ["era"])
    line("镜头", ["camera", "depthOfField"])
    line("光线", ["light"])
    line("色调", ["color"])
    line("画风", ["style"])

    # 细节元素：只写当前地点包里被选中的项
    el_parts = []
    for d in element_dims(c.get("sceneType")):
        v = _opt_cn(d["id"], c.get(d["id"]))
        if v:
            el_parts.append(v)
    if el_parts:
        lines.append("【细节元素】" + "，".join(el_parts))

    extra = (free_prompt or "").strip()
    if extra:
        lines.append("【补充】" + extra)
    # 不写「纯场景 / 无人物 / 概念设定图」这类整图级套话：
    # 它跟画框布局、人物合成是冲突的（合成时反而会把人物压掉），
    # 而且用户明确要求提示词里不要这段。

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
    """给前端的完整定义。

    limits —— 7 个手选下拉（地点类型的每个选项带 packs，前端据此换元素块）
    packs  —— {包 id: {name, icon, dims}}，只在被地点类型选中时显示
    groups —— 「定义管理」用的原始分组结构，保持可增删改
    """
    groups_out = []
    for g in defs.groups():
        group_dims = []
        for d in defs.dims():
            if d.get("group") != g["id"]:
                continue
            group_dims.append({
                "id": d["id"], "name": d["name"],
                "options": [{"id": o["id"], "name": o.get("name", o["id"]),
                             "cn": o.get("cn") or "", "tags": o.get("tags") or [],
                             "packs": o.get("packs") or []}
                            for o in (d.get("options") or [])],
            })
        groups_out.append({"id": g["id"], "name": g["name"],
                           "icon": g.get("icon", ""), "dims": group_dims})

    limits = []
    for d in limit_dims():
        limits.append({
            "id": d["id"], "name": d["name"],
            "options": [{"id": o["id"], "name": o.get("name", o["id"]),
                         "cn": o.get("cn") or "", "packs": o.get("packs") or []}
                        for o in (d.get("options") or [])],
        })

    packs = {}
    for g in defs.groups():
        gid = g.get("id") or ""
        if not gid.startswith("el_"):
            continue
        pid = gid[3:]
        packs[pid] = {
            "id": pid, "name": g.get("name", pid), "icon": g.get("icon", ""),
            "dims": [{
                "id": d["id"], "name": d["name"],
                "options": [{"id": o["id"], "name": o.get("name", o["id"]),
                             "cn": o.get("cn") or ""}
                            for o in (d.get("options") or [])],
            } for d in defs.dims() if d.get("group") == gid],
        }

    return {
        "groups": groups_out,
        "limits": limits,
        "packs": packs,
        "packOrder": [g["id"][3:] for g in defs.groups()
                      if (g.get("id") or "").startswith("el_")],
        "themes": [{"id": t["id"], "name": t["name"], "desc": t.get("desc", ""),
                    "cn": t.get("cn", ""), "colors": t.get("colors") or [],
                    "cat": t.get("cat", "genre")}
                   for t in defs.themes()],
        "dimOrder": LIMIT_DIMS,
    }
