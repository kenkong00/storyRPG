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
    "facialHair", "hat", "glasses", "earring",
    "bust", "bustShape", "bustCleavage", "chestMuscle", "penis", "tattoo",
    "marks", "bodyMark", "bodyHair",
    "top", "topPattern", "sleeve", "outer", "bottom", "shoes", "socks",
    "belt", "neckwear", "gloves", "backpack", "prop",
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
        if dim_id in ("style", "role", "trait", "gender", "age", "nationality",
                      "pose", "poseCategory", "expression", "framing") or d.get("is_color"):
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

    # ---- 动作分类 / 动作表情 ----
    # 注意：外观拼装不再生成「动作表情」（pose / poseCategory）。
    # 动作表情改由专门的「动作表情」出图路径负责（把 pose 单独注入外观再出图），
    # 这样人物外观只描述「长什么样」，动作表达在另一处生成，互不污染。
    # pose_category 参数保留仅为向后兼容，这里不再使用。

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


def build_prompt_blocks(c, include_sensitive=True, framing=None, free_text=None):
    """拼装中文提示词：posCn（正向，用于出图）+ negCn（负面，参考用）。

    framing: full（默认，全身立绘）/ half（半身立绘，只画到腰部以上）。
    半身像不描写下半身穿着 —— 画面上根本看不到裙/裤/鞋袜，
    写进去反而会把模型往「全身」上带，导致构图变成缩小版全身。
    """
    name = (c.get("name") or "").strip()
    mode = c.get("mode", "default")
    framing = (framing or c.get("framing") or "full")
    # 自定义追加词：优先用显式参数，否则从外观字典（前端自定义文字框）里取。
    # 后端路由大多直接传 appearance 而不单独传 free_text，所以这里兜底读取。
    if free_text is None:
        free_text = c.get("free_text")
    is_half = framing == "half"
    mode_obj = next((m for m in defs.MODES if m["id"] == mode), None)
    nudity = c.get("nudity") or "none"

    lines = []

    # 动作表情本身就带表情描述，若再叠一个独立的「表情」维度，
    # 会拼出「张大嘴笑，眉头紧锁、面带愠怒」这种自相矛盾的脸，所以有动作时表情让位。
    pose_txt = _opt_cn("pose", c.get("pose"))
    expr_txt = "" if pose_txt else _opt_cn("expression", c.get("expression"))

    # ---- 人物概述 ----
    # 这些维度允许「无 / 默认」：没选就不写，避免出现「女性 22 岁」这种噪声。
    # 全部都没选时，【人物】这一行整行省略（配合下面的「全默认=空提示词」逻辑）。
    head = []
    if name:
        head.append(name)
    g_txt = _opt_cn("gender", c.get("gender"))
    if g_txt:
        head.append(g_txt + "性")
    if c.get("age"):
        head.append(age_text(c.get("age")))
    nat_txt = _nationality_text(c.get("nationality"))
    if nat_txt:
        head.append(nat_txt)
    # 身份 / 性格都不再写进提示词：两者在界面上已不可选（由题材收敛），
    # 写进外貌描述只会变成没人控制的噪声（「学生，性格开朗的气质」这种）。
    if head:
        lines.append("【人物】" + _join(head))

    # 题材只用来约束下面各维度的候选范围（在 random_appearance / opts_of 中通过 pools 生效），
    # 其描述文本（如「韩式审美，赤古里短上衣…」）不再写进提示词，避免干扰外貌拼装。
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

    # ---- 动作表情（仅当外观里真的带了 pose 维度时才出现；外观拼装不生成它） ----
    if pose_txt:
        lines.append("【动作表情】" + pose_txt)

    # ---- 画面（人物一律纯色底、无背景） ----
    # 这一段是「出图渲染指令」，只有在外观真的有内容时才附带；
    # 全部维度都没选（全默认）时整段都不给，提示词就是空的。
    scene_lines = []
    if is_half:
        scene_lines.append("【画面】" + "、".join([
            "半身像", "腰部以上", "上半身构图", "画面下缘止于腰部",
        ] + [t for t in defs.SCENE_TAGS_CN if t not in ("全身像",)]))
        scene_lines.append("【取景】只表现腰部以上的上半身，不画裙摆、裤腿与鞋袜")
    else:
        scene_lines.append("【画面】" + "、".join(defs.SCENE_TAGS_CN))

    # 全默认：没有任何外观维度被选中 → 提示词为空（不再冒出「女性 22 岁」/「纯色背景」等噪声）
    content_lines = [x for x in lines if x and not x.endswith("】")]
    if not content_lines:
        # 外观全为「无 / 填空」时，【画面】这类渲染指令也不该单独出现；
        # 此时只有用户自己写的追加词才算内容。
        pos = free_text.strip() if (free_text and free_text.strip()) else ""
    else:
        pos = "\n".join(content_lines + scene_lines)
        # 自定义追加词：接在提示词最末尾，属于拼装提示词的一部分
        if free_text and free_text.strip():
            pos = pos + "\n" + free_text.strip()

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


def to_prompt(appearance, include_sensitive=True, framing=None, free_text=None):
    b = build_prompt_blocks(appearance, include_sensitive, framing=framing, free_text=free_text)
    return b["posCn"]


def to_prompt_parts(appearance, include_sensitive=True, framing=None, free_text=None):
    b = build_prompt_blocks(appearance, include_sensitive, framing=framing, free_text=free_text)
    return {
        "cn": b["posCn"], "en": "",
        "posCn": b["posCn"], "negCn": b["negCn"],
        "posEn": "", "negEn": "",
    }


# ===================== 角色姓名（批量生成用） =====================
# 不同国籍用不同的汉字命名习惯，但一律用汉字书写（符合「都要中文」的要求）。
# 西方/拉美等国籍采用「汉字音译」常见名，中东/南亚采用常见音译，东亚/东南亚采用当地汉字姓名习惯。
_NAME_POOLS = {
    "cn": {
        "surnames": ["李", "王", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴",
                     "徐", "孙", "胡", "朱", "高", "林", "何", "郭", "马", "罗"],
        "given": ["明", "华", "晓东", "婷", "雪", "若曦", "梓涵", "浩然", "梦琪",
                  "子轩", "雨欣", "佳怡", "俊杰", "思远", "婉清", "承运", "青瑶", "以辰", "念安", "景行"],
    },
    "jp": {
        "surnames": ["樱井", "佐藤", "铃木", "高桥", "小野", "宫本", "小林", "渡边", "山田", "斋藤"],
        "given": ["美雪", "遥", "莲", "阳菜", "真琴", "樱", "悠斗", "凛", "和也",
                  "千寻", "结衣", "直树", "葵", "凉", "奏", "诗织", "颯太", "萌"],
    },
    "kr": {
        "surnames": ["金", "李", "朴", "崔", "郑", "姜", "赵", "尹", "张", "林"],
        "given": ["敏俊", "智妍", "秀贤", "恩星", "俊昊", "幼真", "泰熙", "允儿",
                  "在熙", "诗妍", "民浩", "荷娜", "瑞允", "志勋"],
    },
    "kp": {
        "surnames": ["金", "李", "朴", "崔", "郑", "姜", "赵", "尹"],
        "given": ["成日", "永南", "正淑", "明吉", "春姬", "哲洙", "英爱", "光日", "顺实", "勇进"],
    },
    "mn": {
        "surnames": ["巴特尔", "其木格", "乌云", "额尔德尼", "朝格", "萨仁", "娜仁", "钢巴特尔", "都楞", "呼日"],
        "given": ["铁木真", "乌兰", "巴音", "格日勒", "诺敏", "阿古达", "苏和", "其其格", "恩和", "孟和"],
    },
    "vn": {
        "surnames": ["阮", "陈", "黎", "范", "黄", "武", "潘", "邓", "裴", "杜"],
        "given": ["文安", "氏芳", "明华", "德辉", "青玄", "玉英", "国栋", "秋河", "文雄", "红绒", "嘉欣", "俊英"],
    },
    "th": {
        "surnames": ["颂萨", "差瓦", "披猜", "巴色", "乍能", "素拉", "威拉", "甘乍", "塔尼", "蓬萨"],
        "given": ["巴育", "英拉", "素拉", "他那", "拉差", "披提", "甘蓬", "瓦栖", "乍都", "娜塔", "蓬通", "威蒙"],
    },
    "id": {
        "surnames": ["维贾亚", "萨帕", "哈迪", "普拉", "桑托", "努格", "维多多", "苏西", "哈桑", "古纳"],
        "given": ["阿迪", "布迪", "萨里", "德维", "因陀", "拉赫", "苏坎", "安唐", "梅加", "丽娜"],
    },
    "my": {
        "surnames": ["阿卜杜勒", "宾", "伊斯坎", "奥斯曼", "拉曼", "阿里", "哈桑", "塔哈", "尤索夫", "拉欣"],
        "given": ["艾哈迈德", "努尔", "法蒂玛", "阿米尔", "扎伊纳", "莎丽", "哈菲兹", "阿兹", "罗莎", "依布拉"],
    },
    "ph": {
        "surnames": ["桑托斯", "雷耶斯", "克鲁兹", "冈萨雷斯", "迪亚兹", "罗萨里奥", "托雷斯", "比利亚", "马卡", "阿基诺"],
        "given": ["玛丽亚", "胡安", "何塞", "安娜", "佩德罗", "罗莎", "卡洛斯", "艾琳", "保罗", "加布"],
    },
    "sg": {
        "surnames": ["陈", "林", "李", "黄", "王", "阿卜杜勒", "伊斯梅尔", "塔哈", "拉希德", "维贾"],
        "given": ["伟明", "俊杰", "美玲", "建辉", "莎丽", "努尔", "哈菲兹", "嘉欣", "志强", "丽娟"],
    },
    "mm": {
        "surnames": ["吴", "杜", "貌", "哥", "玛", "梭", "钦", "丹", "昂", "敏"],
        "given": ["昂山", "丹瑞", "钦纽", "梭温", "玛奈", "觉吞", "妙瓦", "昂莱", "丹敏", "凯敏"],
    },
    "kh": {
        "surnames": ["钦", "索", "陈", "李", "黄", "洪", "金", "翁", "波", "占"],
        "given": ["西哈", "诺罗敦", "洪森", "拉那", "索菲", "占", "披", "萨丽", "提", "威"],
    },
    "la": {
        "surnames": ["坎", "西", "丰", "通", "占", "宋", "维", "蓬", "苏", "本"],
        "given": ["坤", "西沙", "冯", "占塔", "苏里", "蓬", "维", "通", "赛", "蒙"],
    },
    "in": {
        "surnames": ["辛格", "夏尔马", "帕特尔", "古普塔", "拉奥", "梅塔", "卡普尔", "雷迪"],
        "given": ["阿尔温", "拉克希米", "阿尔琼", "普丽雅", "罗希特", "阿努",
                  "基兰", "萨娜", "维克拉姆", "德维", "阿卡什"],
    },
    "pk": {
        "surnames": ["汗", "阿里", "艾哈迈德", "马利克", "谢赫", "赛义德", "拉扎", "阿巴西", "古尔", "乔杜里"],
        "given": ["穆罕默德", "法蒂玛", "阿里", "阿伊莎", "奥马尔", "萨拉", "侯赛因", "阿米娜", "卡里姆", "扎伊纳布"],
    },
    "bd": {
        "surnames": ["拉赫曼", "阿克塔尔", "伊斯兰", "侯赛因", "艾哈迈德", "乔杜里", "卡里姆", "汗", "阿里", "谢赫"],
        "given": ["穆罕默德", "法蒂玛", "阿米尔", "萨丽法", "拉赫", "努尔", "塔斯尼姆", "卡里姆", "贾米尔", "鲁芭"],
    },
    "lk": {
        "surnames": ["佩雷拉", "费尔南多", "席尔瓦", "班达拉", "贾亚", "维克拉", "库马拉", "森纳", "迪萨", "拉特纳"],
        "given": ["桑吉瓦", "尼马尔", "卡马尔", "拉妮", "苏尼尔", "阿努拉", "普里扬", "迪帕", "维马尔", "萨曼"],
    },
    "np": {
        "surnames": ["夏尔马", "塔帕", "拉伊", "古隆", "马加尔", "尼瓦尔", "巴哈杜尔", "卡德加", "阿里", "拉姆"],
        "given": ["拉姆", "克里希纳", "比姆", "苏尼塔", "戈文达", "拉妮", "阿伦", "普里蒂", "迪帕克", "萨罗杰"],
    },
    "kz": {
        "surnames": ["努尔兰", "阿比", "萨特", "别克", "卡里", "达娜", "叶尔", "阿斯", "托列", "梅尔"],
        "given": ["阿依", "努尔", "达娜", "叶尔", "阿斯", "萨尔", "别克", "古丽", "铁木", "阿丽"],
    },
    "uz": {
        "surnames": ["阿利", "乌斯", "卡里", "拉希", "图拉", "阿卜", "萨伊", "别克", "霍贾", "米尔"],
        "given": ["阿齐兹", "迪尔", "古丽", "贾洪", "鲁斯塔", "莎赫", "努尔", "阿赫", "萨尔", "费鲁"],
    },
    "ir": {
        "surnames": ["穆罕默迪", "哈塞米", "礼萨", "阿巴斯", "卡里米", "贾法里", "侯赛因", "萨利", "塔赫", "扎德"],
        "given": ["阿里", "法蒂玛", "礼萨", "玛丽亚姆", "阿米尔", "扎赫拉", "侯赛因", "莱拉", "卡维", "妮鲁"],
    },
    "iq": {
        "surnames": ["阿卜杜勒", "哈桑", "阿里", "萨利赫", "易卜拉欣", "卡齐姆", "马吉德", "阿巴斯", "贾西姆", "塔哈"],
        "given": ["艾哈迈德", "法蒂玛", "奥马尔", "萨拉", "侯赛因", "莱拉", "卡里姆", "赞娜", "穆萨", "鲁芭"],
    },
    "ar": {
        "surnames": ["阿卜杜拉", "哈桑", "易卜拉欣", "赛义德", "马哈茂德", "卡拉姆", "法鲁克"],
        "given": ["莱拉", "奥马尔", "阿米娜", "卡里姆", "萨拉", "优素福",
                  "娜吉拉", "塔里克", "扎伊娜", "费萨尔", "拉扬"],
    },
    "ae": {
        "surnames": ["阿勒", "穆罕默德", "哈马德", "阿里", "阿卜杜拉", "赛义德", "扎耶德", "纳哈扬", "卡西米", "拉希德"],
        "given": ["穆罕默德", "法蒂玛", "哈利法", "萨拉", "阿伊莎", "赛义德", "努拉", "奥马尔", "拉蒂法", "阿扎"],
    },
    "il": {
        "surnames": ["科恩", "列维", "阿隆", "弗里德", "卡茨", "戈登", "罗森", "本", "梅尔", "沙洛"],
        "given": ["大卫", "萨拉", "以撒", "利亚", "摩西", "米里亚", "埃坦", "诺亚", "约拿", "塔玛"],
    },
    "tr": {
        "surnames": ["耶尔", "居尔", "德米尔", "科卡", "阿克", "厄兹", "沙欣", "切利", "卡亚", "约尔"],
        "given": ["穆罕默德", "艾谢", "埃姆雷", "泽伊", "阿里", "埃利夫", "梅尔特", "德尼", "布拉克", "塞林"],
    },
    "eg": {
        "surnames": ["穆罕默德", "阿里", "马哈茂德", "易卜拉欣", "哈桑", "赛义德", "阿卜杜勒", "艾哈迈德", "奥马尔", "扎基"],
        "given": ["法蒂玛", "艾哈迈德", "萨拉", "侯赛因", "玛丽亚姆", "优素福", "阿伊莎", "卡里姆", "莉娜", "塔里克"],
    },
    "ma": {
        "surnames": ["本", "阿姆", "拉赫", "塔齐", "布", "卡迪", "塞", "哈", "萨", "费"],
        "given": ["穆罕默德", "法蒂玛", "优素福", "萨拉", "阿卜杜勒", "阿米娜", "卡里姆", "娜兹", "拉希德", "伊曼"],
    },
    "ng": {
        "surnames": ["奥卡福", "阿迪奇", "埃泽", "乌切", "恩瓦楚库", "奥比", "伊格博"],
        "given": ["奇迪", "阿玛", "埃梅卡", "恩戈齐", "奥卢", "伊费", "阿达", "奥科耶"],
    },
    "ke": {
        "surnames": ["奥", "瓦", "卡", "穆", "基", "恩", "阿", "奥蒂", "万", "切"],
        "given": ["瓦", "卡", "穆", "基", "恩", "阿", "奥蒂", "万", "乔", "奥"],
    },
    "et": {
        "surnames": ["阿贝", "海尔", "特斯", "贝", "梅", "沃尔", "格", "塔", "阿莱", "门"],
        "given": ["阿贝", "海尔", "特斯", "贝", "梅", "沃尔", "格", "塔", "阿莱", "门"],
    },
    "za": {
        "surnames": ["范", "德", "博", "恩", "姆", "杜", "马", "恩", "佐", "恩"],
        "given": ["约翰", "玛丽", "皮特", "苏", "恩", "姆", "杜", "马", "佐", "恩"],
    },
    "gb": {
        "surnames": ["史密斯", "泰勒", "布朗", "戴维斯", "埃文斯", "威尔逊", "托马斯", "罗伯茨"],
        "given": ["奥利弗", "夏洛特", "乔治", "艾玛", "哈里", "索菲",
                  "杰克", "露西", "亚瑟", "格蕾丝", "亨利"],
    },
    "ie": {
        "surnames": ["奥", "墨", "菲", "伯", "瑞", "多", "凯", "林", "麦", "沃尔"],
        "given": ["康", "肖", "帕", "布", "艾", "罗", "塞", "菲", "布", "米"],
    },
    "fr": {
        "surnames": ["马丁", "贝尔纳", "杜邦", "托马斯", "罗伯特", "理查", "珀蒂", "西蒙", "米歇尔", "加西亚"],
        "given": ["皮埃尔", "玛丽", "让", "克莱尔", "路易", "艾玛", "吕克", "朱莉", "雨果", "卡米尔", "娜塔莉", "奥利维耶"],
    },
    "de": {
        "surnames": ["穆勒", "施密特", "施耐德", "费舍尔", "韦伯", "迈耶", "瓦格纳", "贝克尔"],
        "given": ["卢卡斯", "艾米莉", "马克斯", "汉娜", "保罗", "莱娜",
                  "菲利克斯", "克拉拉", "诺亚", "索菲", "扬"],
    },
    "at": {
        "surnames": ["胡贝尔", "格拉夫", "鲍尔", "霍费尔", "迈尔", "沃尔夫", "伯格", "菲舍尔", "克莱因", "里德"],
        "given": ["汉斯", "卡特琳", "安东", "玛丽亚", "马库斯", "约翰娜", "卢卡斯", "埃尔莎", "格奥尔格", "保拉"],
    },
    "ch": {
        "surnames": ["穆勒", "迈尔", "施密德", "胡贝尔", "弗勒里", "韦伯", "罗西", "布赫", "费舍尔", "鲁埃格"],
        "given": ["汉斯", "玛尔塔", "卢卡", "安娜", "埃利亚", "格蕾特", "保罗", "露易丝", "费利克斯", "安雅"],
    },
    "it": {
        "surnames": ["罗西", "埃斯波西托", "费拉里", "罗马诺", "科伦坡", "里奇", "马林", "康蒂", "布鲁诺", "加洛"],
        "given": ["马特奥", "索菲亚", "卢卡", "朱莉亚", "安德烈", "弗朗切斯卡", "洛伦佐", "基亚拉", "保罗", "马尔塔"],
    },
    "es": {
        "surnames": ["加西亚", "费尔南德斯", "冈萨雷斯", "罗德里格斯", "洛佩兹", "马丁内斯", "桑切斯", "佩雷斯", "戈麦斯", "鲁伊斯"],
        "given": ["马特奥", "索菲亚", "马特奥", "瓦伦蒂娜", "塞巴斯蒂安", "卡米拉", "莱昂纳多", "露西亚", "安德烈", "诺亚"],
    },
    "pt": {
        "surnames": ["席尔瓦", "桑托斯", "奥利维拉", "苏萨", "科斯塔", "费雷拉", "佩雷拉", "卡瓦略", "阿尔梅达", "戈麦斯"],
        "given": ["若昂", "玛丽亚", "佩德罗", "安娜", "路易斯", "卡洛斯", "比阿特丽斯", "拉斐尔", "玛蒂尔德", "爱德华"],
    },
    "nl": {
        "surnames": ["范", "德", "扬森", "弗利特", "布鲁因", "穆德", "斯密特", "巴克", "沃斯", "特维"],
        "given": ["扬", "皮特", "玛丽亚", "安娜", "卢克", "埃玛", "汉斯", "朱莉", "弗里斯", "萨丝琪"],
    },
    "be": {
        "surnames": ["范", "杜", "马", "勒", "叙", "德", "布", "卡", "勒", "莫"],
        "given": ["让", "玛丽", "安娜", "卢克", "埃玛", "格特", "保罗", "弗洛", "路", "维克"],
    },
    "no": {
        "surnames": ["汉森", "安徒生", "奥拉夫", "拉森", "埃里克森", "约翰森", "托尔森", "斯文", "佩德森", "哈根"],
        "given": ["埃里克", "英格丽", "拉尔斯", "约纳", "托尔", "斯韦", "佩尔", "海琳", "古德", "布里"],
    },
    "dk": {
        "surnames": ["延森", "尼尔森", "汉森", "佩德森", "安徒生", "索伦森", "拉森", "克里斯滕森", "莫滕森", "扬森"],
        "given": ["梅特", "安德斯", "拉尔斯", "索菲", "尼尔斯", "汉娜", "莫根", "卡伦", "埃米尔", "弗里"],
    },
    "fi": {
        "surnames": ["科维宁", "维塔宁", "海基宁", "莱蒂宁", "尼米宁", "萨尔米宁", "马基宁", "卡里奥", "许萨", "伦塔"],
        "given": ["安蒂", "玛丽亚", "尤哈", "卡里", "佩卡", "萨娜", "塔帕尼", "米娅", "亚科", "埃娃"],
    },
    "pl": {
        "surnames": ["诺瓦克", "科瓦尔斯基", "维什涅夫斯基", "扎耶茨", "斯汤科夫斯基", "扬科夫斯基", "奥莱赫", "库比亚克", "沃伊切赫", "马耶夫斯基"],
        "given": ["安娜", "雅各布", "玛丽亚", "皮奥特尔", "卡塔日娜", "托马斯", "埃娃", "米哈乌", "齐蒙", "尤利娅"],
    },
    "cz": {
        "surnames": ["诺瓦克", "斯沃博达", "恰佩克", "科瓦日", "贝内斯", "诺瓦科娃", "普罗哈兹卡", "库比什", "克莱恰", "马雷克"],
        "given": ["扬", "玛丽", "佩特尔", "托马什", "安娜", "露西", "埃娃", "卡雷尔", "米哈埃拉", "弗兰蒂谢克"],
    },
    "hu": {
        "surnames": ["纳吉", "科瓦奇", "绍洛伊", "陶卡奇", "瓦沙里", "豪瓦斯", "基什", "费伦茨", "奥拉", "拉科齐"],
        "given": ["伊什特万", "玛丽亚", "拉约什", "安娜", "佐尔坦", "伊洛娜", "费伦茨", "埃娃", "卡塔琳", "彼得"],
    },
    "gr": {
        "surnames": ["帕帕佐普洛斯", "乔治乌", "康斯坦丁努", "尼科拉乌", "瓦西利乌", "安东尼亚迪斯"],
        "given": ["索菲亚", "尼科斯", "埃琳娜", "迪米特里斯", "安娜",
                  "亚历山德罗斯", "卡特琳娜", "扬尼斯", "海伦"],
    },
    "ru": {
        "surnames": ["伊万诺夫", "彼得罗夫", "斯米尔诺夫", "库兹涅佐夫", "波波夫", "索科洛夫", "列别杰夫", "诺维科夫", "莫罗佐夫", "沃尔科夫"],
        "given": ["亚历山大", "安娜", "德米特里", "奥尔加", "伊万", "玛丽亚", "谢尔盖", "叶卡捷琳娜", "米哈伊尔", "塔季扬娜"],
    },
    "ua": {
        "surnames": ["舍甫琴科", "科瓦连科", "博伊科", "梅尔尼克", "谢甫丘克", "邦达尔", "特卡琴科", "库利克", "比洛泽尔", "扎伊采夫"],
        "given": ["安德烈", "奥尔加", "伊万", "尤利娅", "德米特罗", "奥克萨娜", "谢尔盖", "娜塔莉亚", "塔拉斯", "卡捷琳娜"],
    },
    "se": {
        "surnames": ["安德森", "约翰松", "卡尔松", "林德", "埃里克松", "尼尔松", "奥尔森", "佩特松", "斯文松", "古斯塔夫松"],
        "given": ["埃里克", "英格丽", "拉尔斯", "阿斯特丽德", "比约恩",
                  "芙蕾雅", "古斯塔夫", "希琳", "阿尔瓦", "诺亚"],
    },
    "us": {
        "surnames": ["史密斯", "约翰逊", "威廉姆斯", "布朗", "琼斯", "戴维斯", "米勒", "威尔逊"],
        "given": ["艾莉森", "詹姆斯", "艾蜜莉", "迈克尔", "杰西卡", "大卫",
                  "萨拉", "丹尼尔", "安娜", "克里斯", "梅根"],
    },
    "ca": {
        "surnames": ["史密斯", "麦克唐纳", "约翰逊", "布朗", "李", "王", "罗伊", "特鲁多", "坎贝尔", "安德森"],
        "given": ["詹姆斯", "玛丽", "迈克尔", "艾米丽", "丹尼尔", "索菲", "威廉", "奥利维亚", "卢卡斯", "克莱尔"],
    },
    "mx": {
        "surnames": ["埃尔南德斯", "加西亚", "马丁内斯", "洛佩兹", "冈萨雷斯", "佩雷斯", "桑切斯"],
        "given": ["迭戈", "索菲亚", "马特奥", "瓦伦蒂娜", "塞巴斯蒂安",
                  "卡米拉", "莱昂纳多", "卢西亚", "安德烈"],
    },
    "br": {
        "surnames": ["席尔瓦", "桑托斯", "奥利维拉", "苏萨", "利马", "科斯塔", "阿尔维斯"],
        "given": ["卢卡斯", "玛丽亚", "佩德罗", "茱莉亚", "加布里埃尔",
                  "拉菲尔", "比阿特丽斯", "恩里克", "拉拉"],
    },
    "ar2": {
        "surnames": ["冈萨雷斯", "罗德里格斯", "费尔南德斯", "洛佩兹", "马丁内斯", "加西亚", "迪亚兹", "佩雷斯"],
        "given": ["马蒂亚斯", "索菲亚", "本哈明", "瓦伦蒂娜", "蒂亚戈", "卡米拉", "卢西亚诺", "胡安娜", "托马斯", "埃米莉亚"],
    },
    "pe": {
        "surnames": ["加西亚", "罗哈斯", "奎斯佩", "弗洛雷斯", "阿尔瓦雷斯", "冈萨雷斯", "迪亚兹", "托雷斯"],
        "given": ["迭戈", "玛丽亚", "胡安", "露西亚", "卡洛斯", "安娜", "何塞", "瓦伦蒂娜", "米格尔", "罗莎"],
    },
    "cl": {
        "surnames": ["冈萨雷斯", "穆尼奥斯", "罗哈斯", "迪亚兹", "佩雷斯", "桑切斯", "席尔瓦", "马丁内斯"],
        "given": ["马蒂亚斯", "瓦伦蒂娜", "本哈明", "索菲亚", "卢卡斯", "卡米拉", "托马斯", "伊莎贝拉", "华金", "艾米莉亚"],
    },
    "co": {
        "surnames": ["戈麦斯", "罗德里格斯", "马丁内斯", "冈萨雷斯", "洛佩兹", "桑切斯", "拉米雷斯", "迪亚兹"],
        "given": ["圣地亚哥", "玛丽亚", "胡安", "瓦伦蒂娜", "塞巴斯蒂安", "卡米拉", "路易斯", "索菲亚", "安德烈斯", "伊莎贝拉"],
    },
    "au": {
        "surnames": ["史密斯", "阮", "王", "李", "琼斯", "布朗", "威尔逊", "泰勒", "李", "陈"],
        "given": ["杰克", "奥利维亚", "夏洛特", "詹姆斯", "艾娃", "托马斯", "威廉", "米娅", "亨利", "艾玛"],
    },
    "nz": {
        "surnames": ["史密斯", "阮", "王", "李", "琼斯", "布朗", "威尔逊", "泰勒", "卡梅伦", "麦肯齐"],
        "given": ["奥利维亚", "杰克", "伊莎贝拉", "詹姆斯", "夏洛特", "卢カ", "威廉", "艾娃", "托马斯", "米娅"],
    },
}


def random_name(nationality=None):
    """按国籍产出一段汉字姓名（不同国籍不同命名习惯，但都用汉字书写）。"""
    pool = _NAME_POOLS.get(nationality) or _NAME_POOLS["cn"]
    return random.choice(pool["surnames"]) + random.choice(pool["given"])



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
