# -*- coding: utf-8 -*-
"""场景拼装定义库 —— JSON 落盘，支持后台增删改。"""

import copy
import json
import os
import threading

from ..config import DATA_DIR

DEFS_PATH = os.path.join(DATA_DIR, "scene_defs.json")
VERSION = 1

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


def load(force=False):
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
        if not data or data.get("version", 0) < VERSION:
            data = _seed()
            os.makedirs(os.path.dirname(DEFS_PATH), exist_ok=True)
            _atomic_write(DEFS_PATH, json.dumps(data, ensure_ascii=False, indent=1))
        # 版本未变但种子里新加了维度 / 分组时，把新内容并进来。
        # 不能直接重新播种：用户在「定义管理」里改过的选项会被冲掉。
        if _migrate(data):
            os.makedirs(os.path.dirname(DEFS_PATH), exist_ok=True)
            _atomic_write(DEFS_PATH, json.dumps(data, ensure_ascii=False, indent=1))
        _cache = data
        return _cache


def _migrate(data):
    """把种子里新增的分组 / 维度补进已有定义，返回是否有改动。

    只补「id 不存在」的条目，已有的一律不动 —— 用户自定义的维度、选项、题材都保留。
    题材（themes）的随机池也同步补上新维度的键，但已有的键不覆盖。
    """
    seed = _seed()
    changed = False
    # 已经补过的 id 记下来：用户在「定义管理」里删掉的维度不该在下次启动时又冒出来
    done_g = set(data.get("_mergedGroups") or [])
    done_d = set(data.get("_mergedDims") or [])
    done_t = set(data.get("_mergedThemes") or [])

    # 1) 分组：按种子里的顺序插入缺失的分组
    seed_gids = [g["id"] for g in seed["groups"]]
    have_gids = {g["id"] for g in data.get("groups") or []}
    for idx, gid in enumerate(seed_gids):
        if gid in have_gids or gid in done_g:
            continue
        src = seed["groups"][idx]
        data.setdefault("groups", [])
        # 插到种子顺序里前一个已存在的分组之后，尽量保持分组顺序一致
        pos = len(data["groups"])
        for prev in reversed(seed_gids[:idx]):
            if prev in have_gids:
                pos = next((i + 1 for i, g in enumerate(data["groups"]) if g["id"] == prev), pos)
                break
        data["groups"].insert(pos, copy.deepcopy(src))
        have_gids.add(gid)
        done_g.add(gid)
        changed = True

    # 2) 维度：缺哪个补哪个
    have_dids = {d["id"] for d in data.get("dims") or []}
    for d in seed["dims"]:
        if d["id"] in have_dids or d["id"] in done_d:
            continue
        data.setdefault("dims", []).append(copy.deepcopy(d))
        have_dids.add(d["id"])
        done_d.add(d["id"])
        changed = True

    # 3) 题材：把种子里新增的 cat / 收敛池键同步给已有题材，并把种子新增的题材并入
    seed_themes = {t["id"]: t for t in seed.get("themes") or []}
    have_tids = {t["id"] for t in data.get("themes") or []}
    for t in data.get("themes") or []:
        s = seed_themes.get(t.get("id"))
        if not s:
            continue
        # cat 默认归类（genre=风格类 / plan=具体场景方案）
        if not t.get("cat") and s.get("cat"):
            t["cat"] = s["cat"]
            changed = True
        # 收敛池：只补种子里新增的维度键，已有键不动（用户在「定义管理」改过的池不覆盖）
        pools = t.setdefault("pools", {})
        for k, v in (s.get("pools") or {}).items():
            if k not in pools:
                pools[k] = copy.deepcopy(v)
                changed = True
    # 种子里新增、已有定义里没有的题材也加进来（用户删过的不再冒出来）
    for t in seed.get("themes") or []:
        if t["id"] in have_tids or t["id"] in done_t:
            continue
        data.setdefault("themes", []).append(copy.deepcopy(t))
        have_tids.add(t["id"])
        done_t.add(t["id"])
        changed = True

    # 记下「已经补过」的清单：既包含这次补进去的，也包含本来就有的，
    # 这样下次启动时用户删掉的维度 / 题材不会被当成"缺失"又补回来。
    merged_g = sorted(done_g | {g["id"] for g in seed["groups"] if g["id"] in have_gids})
    merged_d = sorted(done_d | {d["id"] for d in seed["dims"] if d["id"] in have_dids})
    merged_t = sorted(done_t | {t["id"] for t in seed.get("themes") or [] if t["id"] in have_tids})
    if merged_g != (data.get("_mergedGroups") or []):
        data["_mergedGroups"] = merged_g
        changed = True
    if merged_d != (data.get("_mergedDims") or []):
        data["_mergedDims"] = merged_d
        changed = True
    if merged_t != (data.get("_mergedThemes") or []):
        data["_mergedThemes"] = merged_t
        changed = True
    if data.get("version", 0) < VERSION:
        data["version"] = VERSION
        changed = True
    return changed


def save(new_data):
    global _cache
    with _lock:
        os.makedirs(os.path.dirname(DEFS_PATH), exist_ok=True)
        _atomic_write(DEFS_PATH, json.dumps(new_data, ensure_ascii=False, indent=1))
        _cache = new_data
    return _cache


def reset():
    global _cache
    with _lock:
        d = _seed()
        save(d)
        return d


def data():
    return load()


def groups():
    return load()["groups"]


def dims():
    return load()["dims"]


def themes():
    return load().get("themes") or []


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


def theme_by_id(theme_id):
    for t in themes():
        if t["id"] == theme_id:
            return t
    return None


# ===================== 写操作 =====================
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
            "group": dim.get("group", "meta"), "cond": None,
            "sensitive": False, "is_color": False,
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


def snapshot():
    return copy.deepcopy(load())
