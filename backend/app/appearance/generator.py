# -*- coding: utf-8 -*-
"""
人物外观随机生成 + 提示词拼装。

相对旧版的关键变化：
1. 定向随机：支持 theme（中式仙侠 / 西部牛仔 / 印度宗教 / 魔兽 …）把各维度收敛到
   指定候选池，不再纯均匀抽样；未列入池的维度走 tags 风格匹配。
2. 年龄是精确岁数，年龄段由 defs.age_band() 推导。
3. 裸露状态联动：全裸/上半裸/下半裸 时自动剔除不该出现的衣物键与提示词片段。
4. 提示词只产出中文（Moss 的文本编码器是 Qwen，中文效果更好，也符合「不许出现英文」）。
   生成时只取正向；负面留作参考，可不用。
5. 提示词优先使用条目自带的 cn 描述（后台可编辑），没有才回退到 name。
"""

import random

from . import defs

pick = lambda arr: arr[random.randint(0, len(arr) - 1)] if arr else None
chance = lambda p: random.random() < p

# 需要剔除衣物的裸露状态 → 受影响维度
NUDE_CLEAR = {
    "full": ("top", "topColor", "topPattern", "sleeve", "outer", "outerColor",
             "bottom", "bottomColor", "shoes", "shoeColor", "socks", "belt",
             "neckwear", "gloves", "backpack", "prop"),
    "upper": ("top", "topColor", "topPattern", "sleeve", "outer", "outerColor"),
    "lower": ("bottom", "bottomColor", "socks"),
}

# 「无 / 无此物」类选项：不写进提示词
_NONE_NAMES = {"无", "无此物", "（默认）", "none", "-"}

# 随机流程顺序（gender/age/style/role/trait/nationality/theme 单独处理）
FLOW = [
    "height", "build", "shoulder", "legLen", "skin", "posture",
    "faceShape", "hairstyle", "hairColor", "eyebrow", "eyeShape", "eyeColor", "nose", "mouth",
    "facialHair", "expression", "hat", "glasses", "earring",
    "bust", "bustShape", "bustCleavage", "chestMuscle", "penis", "tattoo",
    "marks", "bodyMark", "bodyHair",
    "top", "topPattern", "sleeve", "outer", "bottom", "shoes", "socks",
    "belt", "neckwear", "gloves", "backpack", "prop",
    "poseCategory", "pose",
]

# 配饰留白概率（越高越容易设为「无」）
ACCESSORY_NONE_PROB = {
    "hat": 0.62, "glasses": 0.70, "earring": 0.88, "tattoo": 0.88, "socks": 0.70,
    "neckwear": 0.72, "backpack": 0.62, "gloves": 0.78, "belt": 0.60,
    "outer": 0.55, "prop": 0.45, "bodyMark": 0.72, "marks": 0.45,
    "pose": 0.0,
}

# 职业与年龄段的亲和（防止 8 岁小孩当骑士、80 岁老人当偶像）
ROLE_AGE_POOL = {
    "toddler": ["student"], "child": ["student"], "teen": ["student", "idol", "athlete"],
    "young": None, "adult": None, "middle": None,
    "elder": ["teacher", "merchant", "farmer", "noble", "mage", "monk", "priest", "detective"],
    "senior": ["teacher", "merchant", "farmer", "noble", "monk", "priest"],
}

# 身份与年龄的合理区间（闭区间，岁）。
# ROLE_AGE_POOL 只管「这个年龄段能当什么」，反过来还得管「这个身份能是几岁」——
# 否则题材把身份钉成萨满之后，会冒出「6 岁萨满」「8 岁赛博改造人」。
ROLE_AGE_RANGE = {
    "student": (8, 24), "idol": (16, 32), "athlete": (16, 38), "dancer": (16, 40),
    "soldier": (18, 45), "guard": (18, 50), "knight": (18, 45), "swordsman": (16, 55),
    "samurai": (16, 55), "ninja": (14, 50), "assassin": (16, 55), "hunter": (16, 60),
    "cowboy": (18, 60), "pirate": (18, 60), "explorer": (18, 55), "cyber": (16, 55),
    "pilot": (20, 50), "mage": (18, 80), "monk": (16, 80), "immortal": (22, 90),
    "priest": (18, 75), "shaman": (20, 75), "geisha": (16, 35), "teacher": (22, 70),
    "doctor": (24, 70), "merchant": (18, 75), "farmer": (16, 75), "noble": (16, 75),
    "office": (20, 65), "detective": (24, 65), "chef": (18, 65), "artist": (16, 70),
    "maid": (16, 45), "nurse": (20, 60),
}


# 旧版本存的是年龄段（middle/young…），提示词里会拼出「middle 岁」。
# 这里给它一个代表岁数，读取旧人物数据时自动转换。
AGE_BAND_AGE = {"toddler": "4", "child": "9", "teen": "16", "young": "24",
                "adult": "32", "middle": "45", "elder": "62", "senior": "75"}


def age_text(age):
    """把年龄值转成可读文本；旧数据里的年龄段映射成代表岁数。"""
    if age is None or age == "":
        return ""
    a = str(age).strip()
    if a.isdigit():
        return f"{a} 岁"
    return f"{AGE_BAND_AGE.get(a, '')} 岁" if a in AGE_BAND_AGE else ""


def clamp_age(role, age):
    """把岁数夹到该身份的合理区间里（只在随机生成时用，用户手填的岁数不动）。"""
    lo, hi = ROLE_AGE_RANGE.get(role or "", (10, 80))
    try:
        a = int(str(age))
    except Exception:
        return age
    if lo <= a <= hi:
        return str(a)
    pool = []
    for o in (defs.dim_by_id("age") or {}).get("options", []):
        try:
            v = int(o["id"])
        except Exception:
            continue
        if lo <= v <= hi:
            pool.append(str(v))
    if not pool:
        return str(max(lo, min(a, hi)))
    # 取离原值最近的三分之一区段，而不是一律压在最小合法年龄上，避免全是 18 岁
    pool.sort(key=lambda x: abs(int(x) - a))
    return pick(pool[:max(3, len(pool) // 3)])


# 随机人物时动作分类的权重：设定图多数是站/坐/日常，战斗其次，
# 恋爱与成人互动只是偶尔（否则每次随机都抽到「共浴」「仰卧」这种不适合设定的动作）。
POSE_CAT_WEIGHTS = {
    "idle": 30, "daily": 26, "battle": 18, "magic": 10, "sport": 8,
    "emotion": 6, "funny": 4, "love": 3, "adult": 1,
}


def weighted_pick(weights):
    keys = [k for k, w in weights.items() if w > 0]
    if not keys:
        return None
    total = sum(weights[k] for k in keys)
    r = random.uniform(0, total)
    acc = 0.0
    for k in keys:
        acc += weights[k]
        if r <= acc:
            return k
    return keys[-1]


# ===================== 选项过滤 =====================
# 「硬题材」标签：带这些标签的条目只能出现在同题材里。
# 之前印度教祭司会抽到「能量手枪」、仙侠道袍会抽到「豹纹」，
# 都是因为题材没给该维度写 pools 时就退回全量抽样。这里补一条通用规则：
# 条目带某种硬题材标签时，theme.tags 必须也命中其中至少一个。
GENRE_TAGS = {
    "china", "hanfu", "wuxia", "japan", "korea", "india", "arabia",
    "western", "warcraft", "norse", "greek", "gothic", "cyberpunk",
    "scifi", "steampunk", "military", "aztec", "africa", "sport", "beach",
}


def _genre_ok(opt, theme_tags):
    hard = set(opt.get("tags") or []) & GENRE_TAGS
    if not hard:
        return True
    return bool(hard & theme_tags)


# 动作依赖的武器 → 允许出现该动作的题材标签
POSE_NEEDS = {
    "firearm": {"military", "cyberpunk", "western", "scifi", "modern", "steampunk", "office"},
    "bow": {"western", "military", "norse", "aztec", "africa", "wuxia", "warcraft",
            "gothic", "fantasy", "outdoor", "india", "japan", "hanfu", "china"},
}


def opts_of(dim_id, c, mode="default", theme=None, allow_duo=False):
    """返回某维度在当前人物 / 模式 / 题材下的可用选项。"""
    d = defs.dim_by_id(dim_id)
    if not d:
        return []
    options = list(d.get("options") or [])
    if not options:
        return []
    if d.get("cond") and not defs.cond_met(d["cond"], c):
        return []
    # 动作：按分类收敛；单人立绘跳过「需要第二个人」的动作
    if dim_id == "pose":
        if c.get("poseCategory"):
            narrowed = [o for o in options if o.get("cat") == c["poseCategory"]]
            if narrowed:
                options = narrowed
        if not allow_duo:
            solo = [o for o in options if "duo" not in (o.get("tags") or [])]
            if solo:
                options = solo
        # 动作需要特定武器（枪/弓）时，题材里没有这类武器就排除
        if theme:
            tt = set(theme.get("tags") or [])
            kept = []
            for o in options:
                need = set(o.get("tags") or []) & set(POSE_NEEDS.keys())
                if need and not any(tt & POSE_NEEDS[n] for n in need):
                    continue
                kept.append(o)
            if kept:
                options = kept

    # 甲胄不能配长裙/袴（会拼出「全身板甲，垂地长裙」）
    if dim_id == "bottom" and c.get("top"):
        top_cn = _opt_cn("top", c["top"])
        if any(h in top_cn for h in _ARMOR_HINTS):
            kept = [o for o in options
                    if not any(k in (o.get("cn") or o.get("name") or "") for k in ("裙", "袴", "托蒂"))]
            if kept:
                options = kept
    # 题材候选池（硬约束）
    if theme:
        pools = theme.get("pools") or {}
        allowed = pools.get(dim_id)
        if allowed:
            ids = set(allowed)
            hit = [o for o in options if o["id"] in ids]
            if hit:
                options = hit
        else:
            # 没写 pools 的维度：按硬题材标签过滤，避免串味
            tt = set(theme.get("tags") or [])
            if tt and dim_id not in ("gender", "age", "height", "build", "shoulder",
                                     "legLen", "pose", "poseCategory"):
                kept = [o for o in options if _genre_ok(o, tt)]
                if len(kept) >= 2:
                    options = kept
        # 题材黑名单（软约束的反面：豹纹不该出现在道袍上）
        banned = (theme.get("avoid") or {}).get(dim_id)
        if banned:
            bad = set(banned)
            kept = [o for o in options if o["id"] not in bad]
            if kept:
                options = kept
    return options


def first_option_id(dim_id, prefer=None):
    d = defs.dim_by_id(dim_id)
    if not d:
        return None
    opts = d.get("options") or []
    if prefer:
        for o in opts:
            if o["id"] == prefer:
                return o["id"]
    return opts[0]["id"] if opts else None


# ===================== 配色 =====================
def harmony_colors(palette=None):
    """按暖/冷/中性分组做和谐配色；给了主题色盘就优先在盘内取。"""
    if palette:
        pool = [c for c in palette if c in defs.CLOTH_COLORS] or defs.CLOTH_COLORS
        top = pick(pool)
        bottom_pool = [c for c in pool if c != top] or pool
        outer_pool = [c for c in pool if c != top] or pool
        return {
            "topColor": top,
            "bottomColor": pick(bottom_pool),
            "outerColor": pick(outer_pool),
            "shoeColor": pick([c for c in defs.SHOE_COLORS if c in palette] or defs.SHOE_COLORS),
        }
    mode = pick(["warm", "cool", "neutral", "warm", "cool"])
    pool = defs.WARM if mode == "warm" else (defs.COOL if mode == "cool" else defs.NEUTRAL)
    top = pick(pool)
    if chance(0.66):
        bottom = pick(defs.NEUTRAL)
    else:
        rest = [c for c in pool if c != top]
        bottom = pick(rest) if rest else top
    rest = [c for c in pool if c != top]
    outer = pick(defs.NEUTRAL) if chance(0.5) else (pick(rest) if rest else top)
    return {"topColor": top, "bottomColor": bottom,
            "outerColor": outer, "shoeColor": pick(defs.SHOE_NEUTRAL)}


def wild_colors():
    return {
        "topColor": pick(defs.CLOTH_COLORS), "bottomColor": pick(defs.CLOTH_COLORS),
        "outerColor": pick(defs.CLOTH_COLORS), "shoeColor": pick(defs.SHOE_COLORS),
    }


# ===================== 收口 =====================
def apply_nudity(c):
    """按裸露状态剔除不该存在的衣物键 —— 全裸就不该还挂着「白色T恤」。"""
    nud = c.get("nudity") or "none"
    for k in NUDE_CLEAR.get(nud, ()):
        c.pop(k, None)


def post_fix(c):
    gender = c.get("gender")
    band = defs.age_band(c.get("age"))

    # 男性不穿裙 / 高跟
    if gender == "male":
        bottom = c.get("bottom")
        if bottom in ("miniSk", "kneeSk", "longSk", "pleatSk", "aSk", "fishSk",
                      "mamian", "ruqunSkirt", "lehengas", "lehenga", "hakama", "skort", "kilt"):
            c["bottom"] = "jeans"
        if c.get("shoes") in ("heel", "stiletto"):
            c["shoes"] = "leatherS"
        if c.get("top") in ("sari", "lehenga", "dress", "gown", "sundress", "cheerUniform",
                            "maidDress", "nurseDress", "sweaterDress"):
            c["top"] = "shirt"

    # 儿童：发型收敛 + 鞋子收敛
    if band in ("toddler", "child"):
        if c.get("hairstyle") in ("bunSamurai", "mohawk", "afro", "dreads", "longStr",
                                  "longWave", "longCurl", "flyingFairy", "hime", "wetslick"):
            c["hairstyle"] = pick(["buzz", "crop", "bowl", "twintail", "buns", "bob"])
        if c.get("shoes") in ("heel", "stiletto", "longBoot"):
            c["shoes"] = "sneaker"
        c.pop("facialHair", None)
        c.pop("bodyHair", None)

    # 老人：白发概率提高
    if band in ("elder", "senior"):
        if chance(0.55):
            c["hairColor"] = pick(["silverH", "saltPep", "snowWhite", "platinum"])

    # 裸露态与上下装的互斥（兜底）
    apply_nudity(c)


def normalize(c, include_sensitive=True):
    """保证每个满足条件的维度都有合法值；缺失则在该维度候选内补。"""
    theme = defs.theme_by_id(c.get("theme")) if c.get("theme") else None
    mode = c.get("mode", "default")

    # 裸露状态必须存在（上/下装的条件判定依赖它）
    if not c.get("nudity"):
        c["nudity"] = "none"

    for d in defs.dims():
        dim_id = d["id"]
        if dim_id in ("style", "role", "trait", "gender", "age", "nationality") or d.get("is_color"):
            continue
        if d.get("sensitive") and not include_sensitive:
            c.pop(dim_id, None)
            continue
        if not defs.cond_met(d.get("cond"), c):
            continue
        if dim_id in c and c[dim_id] is not None:
            # 值可能因为性别/条件变化而非法 —— 不在候选里就重抽
            if dim_id == "pose" and c.get("poseCategory"):
                cand = [o["id"] for o in opts_of("pose", c, mode, theme)]
                if c[dim_id] not in cand and cand:
                    c[dim_id] = pick(cand)
                continue
            continue
        opts = opts_of(dim_id, c, mode, theme)
        if opts:
            c[dim_id] = pick(opts)["id"]

    if "gender" not in c:
        c["gender"] = "female"
    if "age" not in c:
        c["age"] = "22"
    elif not str(c["age"]).isdigit():
        # 旧数据存的是年龄段（young/middle…），统一升级成确定的岁数
        c["age"] = AGE_BAND_AGE.get(str(c["age"]), "22")
    if "nationality" not in c:
        c["nationality"] = "cn"
    if "role" not in c:
        c["role"] = pick_role(c.get("age"), c.get("style"))
    c.pop("trait", None)
    apply_nudity(c)
    return c


# ===================== 身份 =====================
def pick_role(age, style=None, theme=None):
    band = defs.age_band(age)
    all_roles = [o["id"] for o in (defs.dim_by_id("role") or {}).get("options", [])]
    pool = list(all_roles)

    if theme:
        allowed = (theme.get("pools") or {}).get("role")
        if allowed:
            hit = [r for r in allowed if r in all_roles]
            if hit:
                pool = hit

    fixed = ROLE_AGE_POOL.get(band)
    if fixed:
        narrowed = [r for r in pool if r in fixed]
        if narrowed:
            return pick(narrowed)
        # 题材已经把身份收敛过了（例如仙侠只有修士/剑客）——
        # 这时年龄段的限制应该让位给题材，否则会出现「13 岁仙侠偶像」。
        if theme and (theme.get("pools") or {}).get("role"):
            return pick(pool)
        return pick([r for r in fixed if r in all_roles])

    if style:
        tagged = []
        d = defs.dim_by_id("role")
        for o in (d.get("options") if d else []) or []:
            if style in (o.get("tags") or []) and o["id"] in pool:
                tagged.append(o["id"])
        if tagged and chance(0.75):
            return pick(tagged)
    return pick(pool)


# ===================== 主生成 =====================
def random_appearance(gender=None, age=None, style=None, theme=None, mode="default",
                      seed=None, include_sensitive=True, nationality=None,
                      pose_category=None):
    """生成一份完整且风格一致的人物外观。"""
    if seed is not None:
        random.seed(seed)

    theme_obj = defs.theme_by_id(theme) if theme else None
    pools = (theme_obj or {}).get("pools") or {}
    tags = set((theme_obj or {}).get("tags") or [])
    palette = (theme_obj or {}).get("colors")

    c = {}
    c["mode"] = mode
    if theme_obj:
        c["theme"] = theme_obj["id"]

    # ---- 性别 ----
    c["gender"] = gender or pick(["male", "female"])

    # ---- 年龄 ----
    age_pool = [o["id"] for o in (defs.dim_by_id("age") or {}).get("options", [])]
    if age:
        c["age"] = str(age)
    elif pools.get("age"):
        allow = [a for a in pools["age"] if a in age_pool]
        c["age"] = pick(allow) if allow else pick(age_pool or ["22"])
    else:
        c["age"] = pick(age_pool or ["22"])

    # ---- 国族 ----
    nat_pool = [o["id"] for o in (defs.dim_by_id("nationality") or {}).get("options", [])]
    if nationality:
        c["nationality"] = nationality
    elif (theme_obj or {}).get("nationality") in nat_pool:
        c["nationality"] = theme_obj["nationality"]
    elif tags:
        matched = []
        nd = defs.dim_by_id("nationality")
        for o in (nd.get("options") if nd else []) or []:
            if tags & set(o.get("tags") or []):
                matched.append(o["id"])
        c["nationality"] = pick(matched) if matched else pick(nat_pool)
    else:
        c["nationality"] = pick(nat_pool)

    # ---- 风格 ----
    # 「风格定位」维度已移除（风格由题材收敛）。这里只在后台把这个维度加回来时才生成，
    # 否则 pick([]) 会直接报错。
    sd = defs.dim_by_id("style")
    style_ids = [o["id"] for o in (sd.get("options") if sd else []) or []]
    if style_ids:
        if style in style_ids:
            c["style"] = style
        elif pools.get("style"):
            sp = [s for s in pools["style"] if s in style_ids]
            c["style"] = pick(sp) if sp else pick(style_ids)
        elif tags:
            matched = [o["id"] for o in (sd.get("options") or [])
                       if o["id"] in tags or (tags & set(o.get("tags") or []))]
            c["style"] = pick(matched) if matched else pick(style_ids)
        else:
            c["style"] = pick(style_ids)

    # ---- 裸露状态：绝大多数情况是完整着装，只有开启成人维度才有小概率裸露 ----
    if include_sensitive and chance(0.14):
        c["nudity"] = pick(["upper", "lower", "full"])
    else:
        c["nudity"] = "none"

    # ---- 动作分类 ----
    if pose_category:
        c["poseCategory"] = pose_category
    else:
        cats = [o["id"] for o in (defs.dim_by_id("poseCategory") or {}).get("options", [])]
        w = {}
        for cid in cats:
            if cid == "adult" and not include_sensitive:
                continue
            w[cid] = POSE_CAT_WEIGHTS.get(cid, 4)
        c["poseCategory"] = weighted_pick(w) or (cats[0] if cats else "idle")

    # ---- 配色 ----
    c.update(harmony_colors(palette) if (palette or chance(0.7)) else wild_colors())
    c["hairColor"] = pick(defs.HAIR_COLORS)
    c["eyeColor"] = pick(defs.EYE_COLORS)

    use_tag = chance(0.80)

    for dim_id in FLOW:
        d = defs.dim_by_id(dim_id)
        if not d or not (d.get("options") or []):
            continue
        if d.get("sensitive") and not include_sensitive:
            continue
        if not defs.cond_met(d.get("cond"), c):
            continue
        # 动作分类先定，动作随后
        if dim_id == "poseCategory" and c.get("poseCategory"):
            continue

        # 配饰留白
        if dim_id in ACCESSORY_NONE_PROB and chance(ACCESSORY_NONE_PROB[dim_id]):
            none_id = first_option_id(dim_id, prefer="none")
            if none_id:
                c[dim_id] = none_id
                continue

        opts = opts_of(dim_id, c, mode, theme_obj)
        if not opts:
            continue

        chosen = None
        # 1) 题材/风格 tag 匹配
        if use_tag and (tags or c.get("style")):
            wanted = set(tags)
            if c.get("style"):
                wanted.add(c["style"])
            tagged = [o for o in opts if wanted & set(o.get("tags") or [])]
            if tagged:
                chosen = pick(tagged)
        # 2) 全量
        if not chosen:
            chosen = pick(opts)
        c[dim_id] = chosen["id"]

    c["role"] = pick_role(c["age"], c.get("style"), theme_obj)
    # 年龄与身份互校：题材把身份钉成萨满后，年龄不该还停在 6 岁
    if not age:
        c["age"] = clamp_age(c["role"], c["age"])
    # 性格/气质不属于外貌数据（维度已移除），旧调用方仍可能传 style，这里只做透传不再生成
    c.pop("trait", None)

    post_fix(c)
    return normalize(c, include_sensitive)


def reroll_dim(c, dim_id, include_sensitive=True):
    """只重摇某一个维度（保留其余取值），返回新的选项 id。"""
    d = defs.dim_by_id(dim_id)
    if not d:
        return None
    theme = defs.theme_by_id(c.get("theme")) if c.get("theme") else None
    opts = opts_of(dim_id, c, c.get("mode", "default"), theme)
    if not opts:
        return None
    if d.get("sensitive") and not include_sensitive:
        return None
    return pick(opts)["id"]


# ===================== 提示词拼装 =====================
def _opt_cn(dim_id, opt_id):
    """取选项的中文提示词文本：优先 cn，其次 name；「无」类选项返回空。"""
    if not opt_id:
        return ""
    o = defs.option_of(dim_id, opt_id)
    if not o:
        return ""
    cn = (o.get("cn") or "").strip()
    if cn:
        return cn
    name = (o.get("name") or "").strip()
    if not name or name in _NONE_NAMES:
        return ""
    return name


def _color_cn(val):
    return defs.COLOR_CN.get(val, "") or ""


# 文本里已经自带颜色的（「深色法师长袍」「黑色皮衣」）不再叠一层主色调
_COLOR_WORDS = ("黑色", "白色", "红色", "蓝色", "绿色", "金色", "银色", "灰色",
                "棕色", "紫色", "粉色", "橙色", "青色", "黄色", "米色",
                "深色", "浅色", "素色", "彩色", "墨色")


def _with_color(text, color_val, suffix="色"):
    """给衣物补颜色。

    两个坑：
    1. 没有衣物文本时不该单独冒出一个「白色」；
    2. 颜色不能挂在括号里贴在最后一个名词上——「圆领长袍，腰间革带（浅灰色）」
       会被读成革带是浅灰的，所以写成「…，主色调浅灰色」独立成句。
    """
    if not text:
        return ""
    c = _color_cn(color_val)
    if not c or any(w in text for w in _COLOR_WORDS):
        return text
    return f"{text}，主色调{c}{suffix}"


# 这些「衣物」本身没有颜色概念，不能拼出「赤足（黑色）」「无袖（品红色）」
_NO_COLOR_WORDS = ("赤足", "裸足", "无此物")


def _has_no_color(text):
    return (not text) or any(w in text for w in _NO_COLOR_WORDS)


# 甲胄类上装不能配喇叭袖/广袖（会拼出「层叠硬皮甲，喇叭袖」）
_ARMOR_HINTS = ("甲", "铠", "战甲")
_SLEEVE_BAD_WITH_ARMOR = ("喇叭袖", "宽大广袖", "露肩分体袖")

# 这些服装自带袖型（且描述里已经交代过），再追加袖长会打架
_FULL_DRESS_HINTS = ("浴衣", "和服", "道袍", "仙袍", "长袍", "纱丽", "库尔塔", "汉服", "骑士罩袍")


def _join(parts):
    return "，".join([p for p in parts if p])


def _nationality_text(opt_id):
    """国族要真正写进提示词：既交代「哪国人」，也带上对应的面孔特征。

    旧版只取了 cn（纯特征描述），「中国 / 美国」这种国籍名根本没进提示词。
    """
    if not opt_id:
        return ""
    o = defs.option_of("nationality", opt_id)
    if not o:
        return ""
    name = (o.get("name") or "").strip()
    feat = (o.get("cn") or "").strip()
    if name and feat:
        return f"{name}人（{feat}）"
    return feat or name


def build_prompt_blocks(c, include_sensitive=True, framing=None):
    """拼装中文提示词：posCn（正向，用于出图）+ negCn（负面，参考用）。

    framing: full（默认，全身立绘）/ half（半身立绘，只画到腰部以上）。
    半身像不描写下半身穿着 —— 画面上根本看不到裙/裤/鞋袜，
    写进去反而会把模型往「全身」上带，导致构图变成缩小版全身。
    """
    name = (c.get("name") or "").strip()
    mode = c.get("mode", "default")
    framing = (framing or c.get("framing") or "full")
    is_half = framing == "half"
    mode_obj = next((m for m in defs.MODES if m["id"] == mode), None)
    theme_obj = defs.theme_by_id(c.get("theme")) if c.get("theme") else None
    nudity = c.get("nudity") or "none"

    lines = []

    # 动作表情本身就带表情描述，若再叠一个独立的「表情」维度，
    # 会拼出「张大嘴笑，眉头紧锁、面带愠怒」这种自相矛盾的脸，所以有动作时表情让位。
    pose_txt = _opt_cn("pose", c.get("pose"))
    expr_txt = "" if pose_txt else _opt_cn("expression", c.get("expression"))

    # ---- 人物概述 ----
    head = []
    if name:
        head.append(name)
    head.append(f"{_opt_cn('gender', c.get('gender'))}性")
    head.append(age_text(c.get("age")))
    head.append(_nationality_text(c.get("nationality")))
    # 身份 / 性格都不再写进提示词：两者在界面上已不可选（由题材收敛），
    # 写进外貌描述只会变成没人控制的噪声（「学生，性格开朗的气质」这种）。
    lines.append("【人物】" + _join(head))

    if theme_obj:
        lines.append("【题材】" + theme_obj.get("cn", theme_obj.get("desc", "")))
    # 风格行 = 渲染风格 + 服装流派（服装流派原本混在人物行里，读起来像重复标签）
    style_txt = _opt_cn("style", c.get("style"))
    style_txt = f"服装流派：{style_txt}" if style_txt else ""
    style_line = _join([(mode_obj or {}).get("cn", ""), style_txt])
    if style_line:
        lines.append("【风格】" + style_line)

    # ---- 体型 ----
    body_shape = [
        _opt_cn("height", c.get("height")),
        _opt_cn("build", c.get("build")),
        _opt_cn("shoulder", c.get("shoulder")),
    ]
    if not is_half:
        body_shape.append(_opt_cn("legLen", c.get("legLen")))
    body_shape += [
        _opt_cn("skin", c.get("skin")),
        _opt_cn("posture", c.get("posture")),
    ]
    lines.append("【体型】" + _join(body_shape))

    # ---- 头部 ----
    hair = ""
    if c.get("hairstyle"):
        hc = _color_cn(c.get("hairColor"))
        hair_txt = _opt_cn("hairstyle", c.get("hairstyle"))
        if "光头" in hair_txt:
            hc = ""          # 「光头（栗）」是矛盾的
        hair = hair_txt + (f"（{hc}）" if hc else "")
    eyes = ""
    if c.get("eyeShape"):
        ec = _color_cn(c.get("eyeColor"))
        eyes = _opt_cn("eyeShape", c.get("eyeShape")) + (f"（{ec}瞳）" if ec else "")
    lines.append("【头部】" + _join([
        _opt_cn("faceShape", c.get("faceShape")),
        hair,
        _opt_cn("eyebrow", c.get("eyebrow")),
        eyes,
        _opt_cn("nose", c.get("nose")),
        _opt_cn("mouth", c.get("mouth")),
        _opt_cn("facialHair", c.get("facialHair")),
        expr_txt,
        _opt_cn("hat", c.get("hat")),
        _opt_cn("glasses", c.get("glasses")),
        _opt_cn("earring", c.get("earring")),
    ]))

    # ---- 身体特征 ----
    body = [_opt_cn("marks", c.get("marks")), _opt_cn("bodyMark", c.get("bodyMark"))]
    if include_sensitive:
        if c.get("gender") == "female":
            body += [_opt_cn("bust", c.get("bust")), _opt_cn("bustShape", c.get("bustShape")),
                     _opt_cn("bustCleavage", c.get("bustCleavage"))]
        else:
            body += [_opt_cn("chestMuscle", c.get("chestMuscle"))]
        if nudity in ("full", "lower"):
            body.append(_opt_cn("penis", c.get("penis")))
        body.append(_opt_cn("bodyHair", c.get("bodyHair")))
    body.append(_opt_cn("tattoo", c.get("tattoo")))
    lines.append("【身体】" + _join(body))

    # ---- 穿着 ----
    # 很多衣物描述本身已含袖型（「宽袖道袍」「广袖仙袍」），再叠一个袖长会自相矛盾，
    # 所以顶部描述里出现「袖」字时就不再追加 sleeve。
    top_core = _opt_cn("top", c.get("top"))
    pattern_cn = _opt_cn("topPattern", c.get("topPattern"))
    if pattern_cn in ("纯色无纹", "纯色"):
        pattern_cn = ""          # 「圆领长袍，纯色无纹（浅灰色）」是废话，颜色跟着衣服走就够了
    sleeve_cn = "" if ("袖" in top_core or any(h in top_core for h in _FULL_DRESS_HINTS)) \
        else _opt_cn("sleeve", c.get("sleeve"))
    if sleeve_cn and any(h in top_core for h in _ARMOR_HINTS) \
            and sleeve_cn in _SLEEVE_BAD_WITH_ARMOR:
        sleeve_cn = ""
    # 颜色只贴在上装本体上，别让「无袖（品红色）」这种把颜色挂到袖型/纹样上
    top_txt = _join([_with_color(top_core, c.get("topColor")), pattern_cn, sleeve_cn])
    outer_txt = _with_color(_opt_cn("outer", c.get("outer")), c.get("outerColor"))
    bottom_txt = _with_color(_opt_cn("bottom", c.get("bottom")), c.get("bottomColor"))
    shoes_raw = _opt_cn("shoes", c.get("shoes"))
    shoes_txt = shoes_raw if _has_no_color(shoes_raw) else _with_color(shoes_raw, c.get("shoeColor"))

    cloth = []
    if nudity == "full":
        cloth.append("半身赤裸，未着任何衣物" if is_half else "全身赤裸，未着任何衣物")
    elif nudity == "upper":
        cloth.append("上半身赤裸")
        cloth += ["" if is_half else bottom_txt,
                  "" if is_half else shoes_txt,
                  "" if is_half else _opt_cn("socks", c.get("socks")),
                  _opt_cn("belt", c.get("belt")),
                  _opt_cn("gloves", c.get("gloves")),
                  _opt_cn("backpack", c.get("backpack"))]
    elif nudity == "lower":
        if not is_half:
            cloth.append("下半身赤裸")
        cloth += [top_txt, outer_txt,
                  ("" if is_half else shoes_txt),
                  _opt_cn("neckwear", c.get("neckwear")),
                  _opt_cn("gloves", c.get("gloves")),
                  _opt_cn("backpack", c.get("backpack"))]
    else:
        cloth += [top_txt, outer_txt]
        if not is_half:
            cloth += [bottom_txt, shoes_txt, _opt_cn("socks", c.get("socks"))]
        cloth += [_opt_cn("belt", c.get("belt")),
                  _opt_cn("neckwear", c.get("neckwear")), _opt_cn("gloves", c.get("gloves")),
                  _opt_cn("backpack", c.get("backpack"))]
    if nudity != "full":
        cloth.append(_opt_cn("prop", c.get("prop")))
    lines.append("【穿着】" + _join(cloth))

    # ---- 动作表情 ----
    if pose_txt:
        lines.append("【动作表情】" + pose_txt)

    # ---- 画面（人物一律纯色底、无背景） ----
    if is_half:
        lines.append("【画面】" + "、".join([
            "半身像", "腰部以上", "上半身构图", "画面下缘止于腰部",
        ] + [t for t in defs.SCENE_TAGS_CN if t not in ("全身像",)]))
        lines.append("【取景】只表现腰部以上的上半身，不画裙摆、裤腿与鞋袜")
    else:
        lines.append("【画面】" + "、".join(defs.SCENE_TAGS_CN))

    pos = "\n".join([x for x in lines if x and not x.endswith("】")])

    # 负面词按「，」拆开去重（模型方案自带的 neg 和基础表有重叠，否则会重复两遍）
    neg_parts = ["低分辨率", "模糊", "多余肢体", "断肢", "畸变的手", "比例失调",
                 "脸部扭曲", "文字", "水印", "签名", "复杂背景", "场景背景", "英文文字"]
    if is_half:
        neg_parts += ["全身照", "腿部", "脚", "鞋子", "裙摆", "裤腿", "远景全身"]
    if mode_obj and mode_obj.get("neg"):
        neg_parts.append(mode_obj["neg"])
    seen, neg_uniq = set(), []
    for chunk in neg_parts:
        for t in str(chunk).replace("，", ",").split(","):
            t = t.strip()
            if t and t not in seen:
                seen.add(t)
                neg_uniq.append(t)

    return {
        "posCn": pos,
        "negCn": "，".join(neg_uniq),
        # 兼容旧前端字段：不再产出英文
        "posEn": "",
        "negEn": "",
    }


def to_prompt(appearance, include_sensitive=True, framing=None):
    b = build_prompt_blocks(appearance, include_sensitive, framing=framing)
    return b["posCn"]


def to_prompt_parts(appearance, include_sensitive=True, framing=None):
    b = build_prompt_blocks(appearance, include_sensitive, framing=framing)
    return {
        "cn": b["posCn"], "en": "",
        "posCn": b["posCn"], "negCn": b["negCn"],
        "posEn": "", "negEn": "",
    }


# ===================== 供前端渲染 =====================
def get_defs(include_sensitive=True):
    groups_out = []
    for g in defs.groups():
        group_dims = []
        for d in defs.dims():
            if d.get("group") != g["id"]:
                continue
            if d.get("sensitive") and not include_sensitive:
                continue
            is_color = bool(d.get("is_color"))
            opts = []
            for o in d.get("options") or []:
                name = o.get("name") or o["id"]
                if is_color:
                    name = defs.COLOR_CN.get(o["id"], name)
                opts.append({
                    "id": o["id"], "name": name,
                    "cn": o.get("cn") or "",
                    "tags": o.get("tags") or [],
                    "cat": o.get("cat") or "",
                })
            group_dims.append({
                "id": d["id"], "name": d["name"],
                "sensitive": bool(d.get("sensitive")),
                "is_color": is_color,
                "cond": d.get("cond"),
                "options": opts,
            })
        groups_out.append({"id": g["id"], "name": g["name"],
                           "icon": g.get("icon", ""), "dims": group_dims})

    return {
        "groups": groups_out,
        "themes": [{"id": t["id"], "name": t["name"], "desc": t.get("desc", ""),
                    "nationality": t.get("nationality", ""),
                    "cn": t.get("cn", "")} for t in defs.themes()],
        "poseCategories": [{"id": c["id"], "name": c["name"], "desc": c.get("desc", "")}
                           for c in defs.pose_categories()],
        "modes": [{"id": m["id"], "name": m["name"]} for m in defs.MODES],
    }
