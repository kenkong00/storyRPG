# -*- coding: utf-8 -*-
"""
外观定义库 —— JSON 落盘的单一数据源（支持后台增删改）。

为什么从 Python 常量改成 JSON：
用户要求「这个人物拼装系统要有后台管理，可以让我删除、增加或修改里面的内容」。
硬编码在 .py 里的枚举没法在线改。这里首次启动把 seed_defs 写成
backend/data/appearance_defs.json，之后以 JSON 为准，Python 只负责读取与读写。

写入策略：整体写 + 原子替换（tmp → os.replace），并加进程内 RLock，
避免后台连续点保存时出现半截文件。
"""

import copy
import json
import os
import threading

from ..config import DATA_DIR

DEFS_PATH = os.path.join(DATA_DIR, "appearance_defs.json")
DEFS_VERSION = 5

# v5：美国这个国籍要带足外貌参数（旧版只有「多元混合面孔」一句，信息量不够）
_US_FEATURES = "多元族裔混合面孔，肤色从象牙白到深棕不等，眼窝较深，鼻梁高挺，骨架偏大，发色多为棕金或深棕"
_US_TAGS = ["western", "modern", "street", "sport"]
# v5：与中国重复的特别行政区/地区条目
_DROP_NATIONS = ("tw", "hk", "mo")
# v5：整体移除的维度（风格由题材收敛；气质不属于外貌，写进提示词只会干扰笔触）
_DROP_DIMS = ("style", "trait")

_lock = threading.RLock()
_cache = None


def _atomic_write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _seed():
    from . import seed_defs
    return seed_defs.build()


def _migrate(data):
    """把旧版定义就地升级到当前版本，保留用户在后台改过的其它内容。

    返回 (data, changed)。只做「删掉明确不要的」和「补齐新增的」，
    绝不整份重建 —— 重建会把用户手工编辑的素材全部冲掉。
    """
    changed = False
    dims = data.get("dims") or []

    # 1) 删除已废弃维度
    keep = [d for d in dims if d.get("id") not in _DROP_DIMS]
    if len(keep) != len(dims):
        data["dims"] = dims = keep
        changed = True

    # 2) 国籍：去掉与中国重复的条目，补齐美国的描述与标签
    for d in dims:
        if d.get("id") != "nationality":
            continue
        opts = list(d.get("options") or [])
        pruned = [o for o in opts if o.get("id") not in _DROP_NATIONS]
        if len(pruned) != len(opts):
            d["options"] = pruned
            changed = True
        for o in d["options"]:
            if o.get("id") == "us" and o.get("cn") != _US_FEATURES:
                o["cn"] = _US_FEATURES
                o["en"] = "American"
                o["tags"] = list(_US_TAGS)
                changed = True

    # 3) 题材：补齐新增的「美式都市」，并清掉指向已删维度的 style 候选池
    themes = data.get("themes") or []
    have = {t.get("id") for t in themes}
    if "usa_modern" not in have:
        from . import seed_themes
        new_t = next((dict(t) for t in seed_themes.THEMES if t.get("id") == "usa_modern"), None)
        if new_t:
            themes.append(new_t)
            data["themes"] = themes
            changed = True
    for t in themes:
        pools = t.get("pools") or {}
        if "style" in pools:
            pools.pop("style", None)
            changed = True

    if changed:
        data["version"] = DEFS_VERSION
    return data, changed


def load(force=False):
    """读取定义；文件不存在则用种子重建，旧版本则就地迁移。"""
    global _cache
    with _lock:
        if _cache is not None and not force:
            return _cache
        data = None
        if os.path.exists(DEFS_PATH):
            try:
                with open(DEFS_PATH, encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = None
        if not data:
            data = _seed()
            os.makedirs(os.path.dirname(DEFS_PATH), exist_ok=True)
            _atomic_write(DEFS_PATH, json.dumps(data, ensure_ascii=False, indent=1))
        elif int(data.get("version") or 0) < DEFS_VERSION:
            data, changed = _migrate(data)
            if changed:
                _atomic_write(DEFS_PATH, json.dumps(data, ensure_ascii=False, indent=1))
        _cache = data
        return _cache


def data():
    return load()


def save(new_data):
    global _cache
    with _lock:
        os.makedirs(os.path.dirname(DEFS_PATH), exist_ok=True)
        _atomic_write(DEFS_PATH, json.dumps(new_data, ensure_ascii=False, indent=1))
        _cache = new_data
    return _cache


def reset():
    """恢复出厂设置（用种子重建 JSON）。"""
    global _cache
    with _lock:
        d = _seed()
        save(d)
        return d


def snapshot():
    return copy.deepcopy(load())


# ===================== 查询 =====================
def groups():
    return load()["groups"]


def dims():
    return load()["dims"]


def themes():
    return load().get("themes") or []


def pose_categories():
    return load().get("poseCategories") or []


def dim_by_id(dim_id):
    for d in dims():
        if d["id"] == dim_id:
            return d
    return None


def option_of(dim_id, opt_id):
    d = dim_by_id(dim_id)
    if not d:
        return None
    for o in d.get("options") or []:
        if o["id"] == opt_id:
            return o
    return None


def option_name(dim_id, opt_id):
    o = option_of(dim_id, opt_id)
    if o:
        return o.get("name") or opt_id
    d = dim_by_id(dim_id)
    if d is None:
        # 不是维度（例如 name / mode 之类的额外键）
        return opt_id
    return opt_id


def theme_by_id(theme_id):
    for t in themes():
        if t["id"] == theme_id:
            return t
    return None


# ===================== 写操作（后台管理用） =====================
def upsert_group(group):
    d = load()
    for i, g in enumerate(d["groups"]):
        if g["id"] == group["id"]:
            d["groups"][i] = {**g, **group}
            save(d)
            return d["groups"][i]
    d["groups"].append(group)
    save(d)
    return group


def delete_group(group_id):
    d = load()
    before = len(d["groups"])
    d["groups"] = [g for g in d["groups"] if g["id"] != group_id]
    if len(d["groups"]) == before:
        return False
    # 连带删除该分组下的维度
    d["dims"] = [x for x in d["dims"] if x.get("group") != group_id]
    save(d)
    return True


def upsert_dim(dim):
    d = load()
    for i, x in enumerate(d["dims"]):
        if x["id"] == dim["id"]:
            merged = {**x, **dim}
            if "options" in dim:
                merged["options"] = dim["options"]
            d["dims"][i] = merged
            save(d)
            return merged
    newd = {"id": dim["id"], "name": dim.get("name", dim["id"]),
            "group": dim.get("group", "meta"), "sensitive": bool(dim.get("sensitive")),
            "cond": dim.get("cond"), "is_color": bool(dim.get("is_color")),
            "options": dim.get("options") or []}
    d["dims"].append(newd)
    save(d)
    return newd


def delete_dim(dim_id):
    d = load()
    before = len(d["dims"])
    d["dims"] = [x for x in d["dims"] if x["id"] != dim_id]
    if len(d["dims"]) == before:
        return False
    save(d)
    return True


def upsert_option(dim_id, option):
    d = load()
    for x in d["dims"]:
        if x["id"] != dim_id:
            continue
        opts = x.setdefault("options", [])
        for i, o in enumerate(opts):
            if o["id"] == option["id"]:
                opts[i] = {**o, **option}
                save(d)
                return opts[i]
        opts.append(option)
        save(d)
        return option
    return None


def delete_option(dim_id, opt_id):
    d = load()
    for x in d["dims"]:
        if x["id"] != dim_id:
            continue
        before = len(x.get("options") or [])
        x["options"] = [o for o in (x.get("options") or []) if o["id"] != opt_id]
        if len(x["options"]) == before:
            return False
        save(d)
        return True
    return False


def move_option(dim_id, opt_id, delta):
    """调整选项顺序（delta = -1 上移 / +1 下移）。"""
    d = load()
    for x in d["dims"]:
        if x["id"] != dim_id:
            continue
        opts = x.get("options") or []
        idx = next((i for i, o in enumerate(opts) if o["id"] == opt_id), -1)
        if idx < 0:
            return False
        j = max(0, min(len(opts) - 1, idx + delta))
        if j == idx:
            return False
        opts.insert(j, opts.pop(idx))
        save(d)
        return True
    return False


def upsert_pose_category(cat):
    d = load()
    cats = d.setdefault("poseCategories", [])
    for i, c in enumerate(cats):
        if c["id"] == cat["id"]:
            cats[i] = {**c, **cat}
            save(d)
            return cats[i]
    cats.append(cat)
    save(d)
    return cat


def delete_pose_category(cat_id):
    """删除分类，并把该分类下的动作一并删除（避免留下孤儿条目）。"""
    d = load()
    cats = d.get("poseCategories") or []
    before = len(cats)
    d["poseCategories"] = [c for c in cats if c["id"] != cat_id]
    if len(d["poseCategories"]) == before:
        return False
    for x in d["dims"]:
        if x["id"] == "pose":
            x["options"] = [o for o in (x.get("options") or []) if o.get("cat") != cat_id]
        if x["id"] == "poseCategory":
            x["options"] = [o for o in (x.get("options") or []) if o["id"] != cat_id]
    save(d)
    return True


def upsert_theme(theme):
    d = load()
    ts = d.setdefault("themes", [])
    for i, t in enumerate(ts):
        if t["id"] == theme["id"]:
            ts[i] = {**t, **theme}
            save(d)
            return ts[i]
    ts.append(theme)
    save(d)
    return theme


def delete_theme(theme_id):
    d = load()
    ts = d.get("themes") or []
    before = len(ts)
    d["themes"] = [t for t in ts if t["id"] != theme_id]
    if len(d["themes"]) == before:
        return False
    save(d)
    return True


# ===================== 条件判定 =====================
def age_band(age_id):
    """把精确岁数映射到年龄段，供条件判定与英文提示词使用。"""
    try:
        n = int(str(age_id))
    except (TypeError, ValueError):
        # 兼容旧数据里 "young"/"teen" 这类 id
        return str(age_id) if age_id else "adult"
    if n <= 6:
        return "toddler"
    if n <= 12:
        return "child"
    if n <= 17:
        return "teen"
    if n <= 25:
        return "young"
    if n <= 40:
        return "adult"
    if n <= 55:
        return "middle"
    if n <= 70:
        return "elder"
    return "senior"


def _age_hit(values, age_id):
    """not_age 里的值既可能是精确岁数，也可能是年龄段，两者都算命中。"""
    if not values:
        return False
    a = str(age_id)
    return a in {str(v) for v in values} or age_band(a) in values


def cond_met(spec, c):
    """判定条件显示规格是否满足当前人物 c（dict）。UI 动态显隐与随机生成共用。"""
    if not spec:
        return True
    if "gender" in spec and c.get("gender") != spec["gender"]:
        return False
    if "not_band" in spec and age_band(c.get("age")) in spec["not_band"]:
        return False
    if "not_age" in spec and _age_hit(spec["not_age"], c.get("age")):
        return False
    if "requires" in spec:
        for dim, allowed in spec["requires"].items():
            if c.get(dim) not in allowed:
                return False
    return True
