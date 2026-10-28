# -*- coding: utf-8 -*-
"""
外观维度种子数据 —— 核心分组（基础体型 / 头部五官 / 身体特征 / 个体特征 / 身份风格）

设计要点（相对旧版的改动）：
1. 年龄改为「确定岁数」，不再用 18-25 这种区间；年龄段由 age_band() 推导。
2. 每个选项可带 cn / en 提示词文本 —— 提示词不再靠通用名词拼，而是直接用条目自带的
   细节描述（例如「宋制褙子，交领右衽，两侧开衩」）。后台可直接改这段文字。
3. 新增 nationality（国族）维度，选项在 seed_themes.py 里。
4. cond 条件同时支持 not_band（年龄段）与 not_age（精确岁数 id）。
"""


def O(oid, name, cn=None, en=None, tags=None, cat=None):
    """构造一个选项。cn/en 缺省时提示词回退到 name。"""
    o = {"id": oid, "name": name}
    if cn:
        o["cn"] = cn
    if en:
        o["en"] = en
    if tags:
        o["tags"] = list(tags)
    if cat:
        o["cat"] = cat
    return o


GROUPS = [
    {"id": "basic", "name": "基础体型", "icon": "🧍"},
    {"id": "head", "name": "头部五官", "icon": "💇"},
    {"id": "body", "name": "身体特征", "icon": "🫀"},
    {"id": "feat", "name": "个体特征", "icon": "✨"},
    {"id": "cloth", "name": "穿着打扮", "icon": "👘"},
    {"id": "pose", "name": "动作表情", "icon": "🤺"},
    {"id": "meta", "name": "身份风格", "icon": "🎭"},
]

# 精确岁数：id 就是岁数本身，name 带单位。band 由 generator.age_band() 推导。
AGE_OPTIONS = [
    O("6", "6 岁"), O("8", "8 岁"), O("10", "10 岁"), O("12", "12 岁"),
    O("13", "13 岁"), O("15", "15 岁"), O("16", "16 岁"), O("17", "17 岁"),
    O("18", "18 岁"), O("19", "19 岁"), O("20", "20 岁"), O("22", "22 岁"),
    O("24", "24 岁"), O("26", "26 岁"), O("28", "28 岁"), O("30", "30 岁"),
    O("33", "33 岁"), O("36", "36 岁"), O("40", "40 岁"), O("45", "45 岁"),
    O("50", "50 岁"), O("55", "55 岁"), O("60", "60 岁"), O("66", "66 岁"),
    O("72", "72 岁"), O("78", "78 岁"), O("85", "85 岁"),
]

DIMS = [
    # ===================== 基础体型 =====================
    {"id": "nationality", "name": "国族", "group": "basic", "sensitive": False, "cond": None,
     "options": []},  # 由 seed_themes.py 填充

    {"id": "gender", "name": "性别", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("male", "男"), O("female", "女")]},

    {"id": "age", "name": "年龄", "group": "basic", "sensitive": False, "cond": None,
     "options": AGE_OPTIONS},

    {"id": "height", "name": "身高", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("vshort", "娇小", "身材娇小", "petite"),
                 O("short", "偏矮", "身形偏矮", "short stature"),
                 O("avg", "中等", "中等身高", "average height"),
                 O("tall", "偏高", "身材高挑", "tall"),
                 O("vtall", "高大", "身材高大", "very tall")]},

    {"id": "build", "name": "体型", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("skeletal", "骨感", "骨感削瘦", "gaunt"), O("thin", "纤瘦", "纤瘦", "slim"),
                 O("slim", "苗条", "身形苗条", "slender"), O("fit", "匀称", "体型匀称", "well-proportioned"),
                 O("athletic", "健美", "健美结实", "athletic"), O("muscular", "肌肉发达", "肌肉发达、线条分明", "muscular"),
                 O("soft", "微胖", "体态柔软微胖", "slightly chubby"), O("chubby", "丰满", "体态丰满", "plump"),
                 O("heavy", "壮硕", "体格壮硕厚重", "heavyset")]},

    {"id": "shoulder", "name": "肩型", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("narrow", "窄肩"), O("normal", "适中"), O("broad", "宽肩")]},

    {"id": "legLen", "name": "腿长比例", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("shortL", "五五身", "五五身", "balanced proportions"),
                 O("normalL", "正常", "比例正常", "balanced proportions"),
                 O("longL", "大长腿", "腿长比例夸张的大长腿", "very long legs")]},

    {"id": "skin", "name": "肤色", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("porcelain", "瓷白", "瓷白细腻的肌肤", "porcelain skin"),
                 O("ivory", "象牙", "象牙白肌肤", "ivory skin"),
                 O("fair", "浅麦", "浅麦色肌肤", "fair skin"),
                 O("wheat", "金棕", "金棕色健康肌肤", "wheatish skin"),
                 O("tan", "棕褐", "晒成棕褐色的肌肤", "tanned skin"),
                 O("bronze", "古铜", "古铜色油亮肌肤", "bronze skin"),
                 O("brown", "深棕", "深棕色肌肤", "dark brown skin"),
                 O("ebony", "乌黑", "乌黑发亮的深色肌肤", "ebony skin")]},

    {"id": "posture", "name": "体态", "group": "basic", "sensitive": False, "cond": None,
     "options": [O("upright", "挺拔", "姿态挺拔", "upright posture"),
                 O("relaxed", "放松自然", "体态放松自然", "relaxed posture"),
                 O("stooped", "微驼背", "微微驼背", "slightly hunched"),
                 O("confident", "昂首自信", "昂首挺胸、自信舒展", "confident posture")]},

    # ===================== 头部五官 =====================
    {"id": "faceShape", "name": "脸型", "group": "head", "sensitive": False, "cond": None,
     "options": [O("oval", "鹅蛋", "鹅蛋脸", "oval face"), O("round", "圆", "圆润脸型", "round face"),
                 O("square", "方", "方正脸型", "square face"), O("heart", "心形", "心形脸", "heart-shaped face"),
                 O("long", "长", "长脸", "long face"), O("diamond", "菱形", "菱形脸", "diamond face"),
                 O("triangle", "三角", "三角形脸", "triangular face"),
                 O("baby", "婴儿肥", "带婴儿肥的圆脸", "chubby baby face")]},

    {"id": "hairstyle", "name": "发型", "group": "head", "sensitive": False, "cond": None,
     "options": [
         O("bald", "光头", "光头", "bald"),
         O("buzz", "寸头", "利落寸头", "buzz cut"),
         O("crop", "短碎", "短碎发", "short cropped hair"),
         O("midPart", "中分", "中分长发", "center-parted hair", ["elegant", "vintage"]),
         O("sidePart", "三七分", "三七分油头", "side-parted hair", ["formal", "casual"]),
         O("pompadour", "飞机头", "飞机头", "pompadour", ["punk", "street"]),
         O("undercut", "铲青", "两侧铲青的背头", "undercut", ["punk", "street"]),
         O("spiky", "刺猬", "刺猬状短发", "spiky hair", ["punk", "sport"]),
         O("messy", "乱发", "凌乱蓬松的头发", "messy hair", ["casual", "street"]),
         O("bowl", "蘑菇头", "蘑菇头", "bowl cut", ["cute"]),
         O("bob", "波波头", "齐下巴波波头", "bob cut", ["cute", "elegant"]),
         O("wavyLob", "及肩微卷", "及肩微卷发", "wavy shoulder-length hair", ["elegant", "vintage"]),
         O("longStr", "长直发", "垂至腰际的黑色长直发", "long straight hair", ["fantasy", "elegant"]),
         O("longWave", "大波浪", "蓬松的大波浪长发", "long wavy hair", ["elegant", "fantasy"]),
         O("longCurl", "长卷发", "细密长卷发", "long curly hair", ["cute", "fantasy"]),
         O("curly", "短卷", "短卷发", "short curly hair", ["cute", "street"]),
         O("afro", "爆炸头", "蓬松爆炸头", "afro", ["street", "outdoor"]),
         O("dreads", "雷鬼辫", "脏辫", "dreadlocks", ["street", "outdoor"]),
         O("mohawk", "莫西干", "莫西干发型", "mohawk", ["punk"]),
         O("ponytail", "高马尾", "高扎马尾", "high ponytail", ["sport", "casual"]),
         O("lowPony", "低马尾", "低垂马尾", "low ponytail", ["elegant", "casual"]),
         O("sidePony", "侧马尾", "侧边马尾", "side ponytail", ["cute"]),
         O("twintail", "双马尾", "双马尾", "twin tails", ["cute", "fantasy"]),
         O("buns", "双丸子", "双丸子头", "twin buns", ["cute"]),
         O("topBun", "丸子头", "头顶丸子头", "top bun", ["casual", "elegant"]),
         O("braid", "麻花辫", "单侧麻花辫", "braid", ["fantasy", "outdoor"]),
         O("twinBraid", "双麻花", "双麻花辫", "twin braids", ["cute", "fantasy"]),
         O("receding", "地中海", "地中海式脱发", "receding hairline"),
         O("baldTop", "秃顶", "头顶秃顶", "balding"),
         O("bunSamurai", "武士髻", "头顶武士髻", "samurai topknot", ["hanfu", "japan"]),
         O("helmetHair", "盔下短发", "头盔下压出的短发", "short hair under helmet", ["fantasy", "outdoor"]),
         O("spaceBuns", "双螺旋髻", "双螺旋髻", "space buns", ["cute", "scifi"]),
         O("hanfuBun", "古典发髻", "高盘古典发髻，插发簪", "traditional high bun with hairpin", ["hanfu", "china"]),
         O("flyingFairy", "飞仙髻", "高耸的飞仙髻，缀珠翠流苏", "soaring fairy bun with pearl tassels", ["hanfu", "china", "fantasy"]),
         O("doubleLoop", "双环髻", "少女双环髻", "double loop buns", ["hanfu", "china"]),
         O("topknotW", "道髻", "道士发髻", "taoist topknot", ["hanfu", "china", "fantasy"]),
         O("implike", "披肩半束", "半束半披的长发", "half-tied long hair", ["fantasy", "china"]),
         O("hime", "公主切", "公主切齐刘海长发", "hime cut", ["japan", "elegant"]),
         O("wolfCut", "狼尾", "狼尾碎发", "wolf cut", ["street", "punk"]),
         O("mullet", "鲻鱼头", "鲻鱼头", "mullet", ["street", "punk"]),
         O("boxerBraid", "拳击辫", "贴头皮的拳击辫", "cornrow braids", ["sport", "street"]),
         O("wetslick", "湿发背头", "湿发后梳背头", "slicked-back wet hair", ["formal", "elegant"]),
         O("curtain", "中分碎帘", "窗帘式中分刘海", "curtain bangs", ["casual", "elegant"]),
         O("bunNy", "低盘髻", "后颈低盘髻", "low chignon", ["elegant", "vintage"]),
         O("shavedSide", "单侧剃青", "单侧剃青、另一侧长发的叛逆造型", "side-shaved undercut", ["punk", "street"]),
     ]},

    {"id": "hairColor", "name": "发色", "group": "head", "sensitive": False, "cond": None, "is_color": True,
     "options": [O(c, n) for c, n in [
         ("inkBlack", "墨黑"), ("dkBrown", "深棕"), ("chestnut", "栗"), ("ltBrown", "浅棕"),
         ("auburn", "赭红"), ("copper", "铜"), ("flaxen", "亚麻"), ("gold", "金"),
         ("platinum", "铂金"), ("silverH", "银灰"), ("saltPep", "花白"), ("smokeBlue", "烟蓝"),
         ("sakura", "樱粉"), ("violetH", "紫"), ("mossH", "苔绿"), ("snowWhite", "雪白"),
         ("roseGold", "玫瑰金"), ("midnightBlue", "幽蓝"),
     ]]},

    {"id": "eyebrow", "name": "眉形", "group": "head", "sensitive": False, "cond": None,
     "options": [O("thick", "浓眉", "浓黑粗眉", "thick eyebrows"), O("thin", "细眉", "细长眉", "thin eyebrows"),
                 O("sword", "剑眉", "英气剑眉", "sword-shaped brows"), O("willow", "柳叶", "柳叶弯眉", "willow brows"),
                 O("flat", "平直", "平直眉", "flat brows"), O("sad", "八字", "八字眉", "sad slanted brows"),
                 O("angry", "上扬", "上扬怒眉", "angry slanted brows"), O("bushy", "乱眉", "杂乱浓眉", "bushy brows")]},

    {"id": "eyeShape", "name": "眼形", "group": "head", "sensitive": False, "cond": None,
     "options": [O("almond", "杏眼", "杏眼", "almond eyes"), O("phoenix", "丹凤", "上挑丹凤眼", "phoenix eyes"),
                 O("round", "圆", "圆眼", "round eyes"), O("big", "大眼", "大而明亮的眼睛", "big eyes"),
                 O("narrow", "细长", "细长眼", "narrow eyes"), O("droopy", "下垂", "下垂眼", "droopy eyes"),
                 O("half", "半眯", "半眯的眼", "half-closed eyes"), O("sleepy", "睡眼", "慵懒睡眼", "sleepy eyes")]},

    {"id": "eyeColor", "name": "瞳色", "group": "head", "sensitive": False, "cond": None, "is_color": True,
     "options": [O(c, n) for c, n in [
         ("eyesBlack", "黑"), ("eyesDBr", "深棕"), ("eyesLBr", "浅棕"), ("amber", "琥珀"),
         ("eyesGreen", "绿"), ("eyesBlue", "蓝"), ("eyesDBlue", "深蓝"), ("eyesGray", "灰"),
         ("eyesViolet", "紫"), ("eyesRed", "红"), ("eyesGold", "金"),
     ]]},

    {"id": "nose", "name": "鼻型", "group": "head", "sensitive": False, "cond": None,
     "options": [O("button", "小巧", "小巧鼻", "small nose"), O("straight", "挺直", "挺直鼻梁", "straight nose"),
                 O("aquiline", "鹰钩", "鹰钩鼻", "aquiline nose"), O("snub", "翘", "微翘鼻", "snub nose"),
                 O("wide", "宽", "宽鼻翼", "wide nose"), O("pointed", "尖", "尖鼻", "pointed nose"),
                 O("flat", "塌", "塌鼻梁", "flat nose")]},

    {"id": "mouth", "name": "唇形", "group": "head", "sensitive": False, "cond": None,
     "options": [O("smile", "微笑", "嘴角微扬", "gentle smile"), O("thin", "薄唇", "薄唇", "thin lips"),
                 O("full", "厚唇", "饱满厚唇", "full lips"), O("neutral", "自然", "自然的唇形", "neutral lips"),
                 O("pout", "嘟嘴", "微微嘟嘴", "pouting lips"), O("smirk", "歪嘴坏笑", "歪嘴坏笑", "smirk"),
                 O("open", "微张", "嘴唇微张", "slightly open mouth"), O("wide", "大笑", "张大嘴笑", "wide grin")]},

    {"id": "facialHair", "name": "胡须", "group": "head", "sensitive": False,
     "cond": {"gender": "male", "not_band": ["toddler", "child"]},
     "options": [O("none", "无", "", ""), O("stubble", "青胡茬", "淡淡的青胡茬", "stubble"),
                 O("mustache", "八字", "八字小胡", "mustache"), O("goatee", "山羊胡", "山羊胡", "goatee"),
                 O("anchor", "锚形", "锚形胡须", "anchor beard"), O("full", "络腮", "浓密络腮胡", "full beard"),
                 O("chinstrap", "环颊", "环颊胡", "chinstrap beard"), O("long", "长须及胸", "长须垂至胸前", "long flowing beard"),
                 O("fuManchu", "下垂长胡", "下垂的八字长胡", "fu manchu mustache")]},

    {"id": "expression", "name": "基础表情", "group": "head", "sensitive": False, "cond": None,
     "options": [O("calm", "平静", "神情平静", "calm expression"),
                 O("happy", "愉悦", "眉眼带笑、神情愉悦", "happy expression"),
                 O("serious", "严肃", "神情严肃", "serious expression"),
                 O("angry", "愠怒", "眉头紧锁、面带愠怒", "angry expression"),
                 O("surprise", "惊讶", "睁大眼睛、惊讶", "surprised expression"),
                 O("sleepy", "困倦", "眼神慵懒困倦", "sleepy expression"),
                 O("shy", "害羞", "脸颊微红、神情害羞", "shy expression"),
                 O("smug", "得意", "神情得意", "smug expression"),
                 O("sad", "哀伤", "眼神哀伤", "sad expression"),
                 O("gentle", "温柔", "目光温柔", "gentle expression")]},

    {"id": "hat", "name": "帽子头饰", "group": "head", "sensitive": False, "cond": None,
     "options": [
         O("none", "无", "", ""),
         O("cap", "棒球帽", "棒球帽", "baseball cap", ["casual", "sport", "street"]),
         O("beanie", "毛线帽", "毛线帽", "beanie", ["outdoor", "cute"]),
         O("bucket", "渔夫帽", "渔夫帽", "bucket hat", ["casual", "street"]),
         O("beret", "贝雷帽", "贝雷帽", "beret", ["elegant", "vintage"]),
         O("topHat", "礼帽", "高筒礼帽", "top hat", ["vintage", "formal"]),
         O("straw", "草帽", "宽檐草帽", "straw hat", ["beach", "outdoor"]),
         O("crown", "王冠", "镶嵌宝石的王冠", "jeweled crown", ["fantasy", "elegant"]),
         O("helmet", "头盔", "金属头盔", "metal helmet", ["outdoor", "fantasy"]),
         O("headband", "头带", "运动头带", "headband", ["sport"]),
         O("bandana", "头巾", "印花头巾", "bandana", ["street", "outdoor"]),
         O("veil", "面纱", "半透明薄纱遮面", "sheer veil", ["elegant", "arabia", "india"]),
         O("halo", "光环", "头顶金色光环", "golden halo", ["fantasy"]),
         O("hood", "兜帽", "深色兜帽", "hood", ["fantasy", "outdoor"]),
         O("flower", "花环", "花环头饰", "flower circlet", ["cute", "fantasy"]),
         O("douli", "斗笠", "竹编斗笠", "bamboo conical hat", ["china", "hanfu", "outdoor"]),
         O("guan", "束发冠", "玉质束发冠", "jade hair crown", ["china", "hanfu"]),
         O("buyao", "步摇", "垂珠步摇", "dangling buyao hairpin", ["china", "hanfu", "elegant"]),
         O("zan", "发簪", "素银发簪", "silver hairpin", ["china", "hanfu"]),
         O("kanzashi", "簪花", "日式簪花", "kanzashi hair ornament", ["japan", "elegant"]),
         O("turban", "缠头巾", "层叠缠绕的头巾", "layered turban", ["india", "arabia"]),
         O("feather", "羽饰", "插在发间的长羽毛", "feather hair ornament", ["fantasy", "outdoor"]),
         O("horned", "角盔", "带双角的战盔", "horned war helm", ["fantasy", "warcraft"]),
         O("circlet", "额饰", "镶嵌宝石的额饰", "jeweled circlet", ["fantasy", "elegant"]),
         O("cowboy", "牛仔帽", "宽檐牛仔帽", "cowboy hat", ["western"]),
         O("sombrero", "墨西哥宽帽", "墨西哥宽檐帽", "sombrero", ["western"]),
         O("nurseCap", "护士帽", "白色护士帽", "nurse cap", ["modern", "formal"]),
         O("chefHat", "厨师帽", "白色高筒厨师帽", "chef hat", ["modern"]),
         O("militaryCap", "军帽", "硬挺军帽", "military cap", ["military", "formal"]),
     ]},

    {"id": "glasses", "name": "眼镜", "group": "head", "sensitive": False, "cond": None,
     "options": [O("none", "无", "", ""), O("round", "圆框", "细边圆框眼镜", "round glasses", ["vintage", "elegant"]),
                 O("square", "方框", "黑框方眼镜", "square glasses", ["formal", "casual"]),
                 O("aviator", "飞行员", "飞行员墨镜", "aviator sunglasses", ["outdoor", "street"]),
                 O("cat", "猫眼", "猫眼镜框", "cat-eye glasses", ["cute", "elegant"]),
                 O("half", "半框", "半框眼镜", "half-rim glasses", ["formal"]),
                 O("goggles", "护目镜", "皮质护目镜", "goggles", ["scifi", "outdoor", "steampunk"]),
                 O("monocle", "单片镜", "单片眼镜", "monocle", ["vintage", "fantasy"]),
                 O("visor", "面罩", "全覆式面罩", "visor", ["scifi"]),
                 O("shades", "墨镜", "黑色墨镜", "sunglasses", ["street", "punk"])]},

    {"id": "earring", "name": "耳饰", "group": "head", "sensitive": False, "cond": None,
     "options": [O("none", "无", "", ""), O("stud", "耳钉", "耳钉", "ear studs"),
                 O("hoop", "圆环", "金属圆环耳环", "hoop earrings"),
                 O("drop", "垂坠", "垂坠式耳环", "drop earrings"),
                 O("cross", "十字", "十字架耳饰", "cross earrings"),
                 O("jade", "玉坠", "玉质耳坠", "jade earrings", ["china", "hanfu"]),
                 O("clip", "耳夹链", "耳夹链", "ear clip chain"),
                 O("tassel", "流苏", "垂穗流苏耳饰", "tassel earrings", ["china", "hanfu"]),
                 O("noseRing", "鼻环", "鼻环", "nose ring", ["india", "street"])]},

    # ===================== 身体特征 =====================
    {"id": "bust", "name": "胸部尺寸", "group": "body", "sensitive": True,
     "cond": {"gender": "female", "not_band": ["toddler", "child"]},
     "options": [O("flat", "平胸", "平胸"), O("cupA", "A 杯", "小巧的胸部"),
                 O("cupB", "B 杯", "挺翘的胸部"), O("cupC", "C 杯", "匀称饱满的胸部"),
                 O("cupD", "D 杯", "丰满的胸部"), O("cupE", "E 杯", "丰腴的胸部"),
                 O("cupF", "F 杯", "十分丰满的胸部"), O("cupG", "G 杯", "极为丰硕的胸部"),
                 O("cupH", "H 杯", "极为丰硕的胸部"), O("cupI", "I 杯", "极其夸张的胸部"),
                 O("cupJ", "J 杯", "极其夸张的胸部")]},

    {"id": "bustShape", "name": "胸型", "group": "body", "sensitive": True,
     "cond": {"gender": "female", "not_band": ["toddler", "child"],
              "requires": {"bust": ["cupA", "cupB", "cupC", "cupD", "cupE", "cupF", "cupG", "cupH", "cupI", "cupJ"]}},
     "options": [O("shRound", "圆润"), O("shDrop", "水滴"), O("shPerky", "上挺"), O("shSport", "运动"),
                 O("shWide", "外扩"), O("shSlim", "纤薄"), O("shSoft", "松软"), O("shNatural", "自然")]},

    {"id": "bustCleavage", "name": "乳沟", "group": "body", "sensitive": True,
     "cond": {"gender": "female", "not_band": ["toddler", "child"],
              "requires": {"bust": ["cupB", "cupC", "cupD", "cupE", "cupF", "cupG", "cupH", "cupI", "cupJ"]}},
     "options": [O("clNone", "无"), O("clSoft", "浅沟"), O("clMid", "中等"), O("clDeep", "深沟"), O("clGrave", "极深")]},

    {"id": "chestMuscle", "name": "胸肌", "group": "body", "sensitive": True,
     "cond": {"gender": "male", "not_band": ["toddler", "child"]},
     "options": [O("soft2", "平缓"), O("normal2", "正常"), O("toned", "结实"), O("huge2", "厚实")]},

    {"id": "penis", "name": "阴茎", "group": "body", "sensitive": True,
     "cond": {"gender": "male", "not_band": ["toddler", "child"]},
     "options": [O("pS", "小巧松弛"), O("pM", "适中松弛"), O("pL", "粗大勃起"),
                 O("pXL", "夸张勃起"), O("pXXL", "极端勃起")]},

    {"id": "tattoo", "name": "纹身", "group": "body", "sensitive": False,
     "cond": {"not_band": ["toddler", "child"]},
     "options": [O("none", "无", "", ""), O("arm", "手臂", "手臂纹身", "arm tattoo"),
                 O("neck", "颈", "颈部纹身", "neck tattoo"),
                 O("tribal", "图腾", "大面积图腾纹身", "tribal tattoo"),
                 O("rune", "符文", "发光符文纹身", "glowing rune tattoo", ["fantasy", "scifi"]),
                 O("small", "小图案", "小巧的纹身图案", "small tattoo"),
                 O("backFull", "满背", "覆满整个后背的纹身", "full back tattoo", ["street", "punk"]),
                 O("sleeve", "花臂", "整条手臂的花臂纹身", "full sleeve tattoo", ["street", "punk"]),
                 O("sacred", "经咒", "梵文经咒纹身", "sanskrit mantra tattoo", ["india"]),
                 O("warPaint", "战纹", "靛蓝色战纹", "blue war paint markings", ["warcraft", "norse"])]},

    # ===================== 个体特征 =====================
    {"id": "marks", "name": "面部记号", "group": "feat", "sensitive": False, "cond": None,
     "options": [O("mkNone", "无", "", ""), O("freckle", "雀斑", "鼻梁几点雀斑", "freckles"),
                 O("beauty", "美人痣", "眼角美人痣", "beauty mark"),
                 O("mole", "痣", "脸上小痣", "mole"),
                 O("scar", "疤痕", "脸侧一道旧疤", "facial scar"),
                 O("dimple", "酒窝", "笑起来有酒窝", "dimples"),
                 O("freckle2", "密集雀斑", "满面密集雀斑", "dense freckles"),
                 O("scarEye", "眼疤", "穿过眉眼的刀疤", "eye scar"),
                 O("teeth", "牙套", "金属牙套", "braces"),
                 O("wrinkle", "细纹", "眼角细纹", "fine wrinkles"),
                 O("birthmark", "胎记", "脸侧淡色胎记", "birthmark"),
                 O("acne", "痘痘", "颊边几颗痘", "acne"),
                 O("glowMark", "灵纹", "额间浮现的灵纹", "glowing spirit sigil on forehead", ["fantasy", "china"]),
                 O("blushMark", "腮红", "明显的腮红妆", "blush makeup", ["cute"]),
                 O("tearMark", "泪痕", "眼下泪痕妆", "tear-streak makeup", ["gothic", "elegant"]),
                 O("patch", "眼罩", "单眼皮革眼罩", "leather eyepatch", ["fantasy", "military"]),
                 O("maskHalf", "半面具", "只遮上半张脸的面具", "half-face mask", ["fantasy", "gothic"]),
                 O("oniMask", "鬼面", "狰狞鬼面", "oni demon mask", ["japan", "fantasy"])]},

    {"id": "bodyMark", "name": "身体特征", "group": "feat", "sensitive": False, "cond": None,
     "options": [O("bmNone", "无", "", ""), O("freckleArm", "手臂雀斑", "手臂零星雀斑", "arm freckles"),
                 O("scarBody", "身体疤痕", "身上多处旧疤", "body scars"),
                 O("bandage", "绷带", "缠着绷带", "bandages"),
                 O("tallP", "高大", "格外高大", "tall stature"),
                 O("liver", "老年斑", "手背老年斑", "age spots"),
                 O("leanRib", "肋骨", "消瘦见肋骨", "visible ribs"),
                 O("birthmarkB", "胎记", "肩背胎记", "body birthmark"),
                 O("wings", "羽翼", "背后展开的巨大羽翼", "large feathered wings", ["fantasy"]),
                 O("dragonScale", "龙鳞", "颈侧蔓延的龙鳞", "dragon scales", ["fantasy", "china"]),
                 O("mechArm", "义肢", "金属义肢手臂", "mechanical prosthetic arm", ["scifi", "cyberpunk"]),
                 O("scarsWhip", "鞭痕", "背部纵横鞭痕", "whip scars on back")]},

    {"id": "bodyHair", "name": "体毛", "group": "feat", "sensitive": True,
     "cond": {"gender": "male"},
     "options": [O("bhNone", "无"), O("bhLight", "汗毛"), O("bhArm", "臂毛"),
                 O("bhChest", "胸毛"), O("bhBelly", "腹毛"), O("bhFull", "全身")]},

    # ===================== 身份风格 =====================
    {"id": "role", "name": "身份", "group": "meta", "sensitive": False, "cond": None,
     "options": [
         O("student", "学生", "学生", "student", ["school", "casual"]),
         O("office", "上班族", "上班族", "office worker", ["formal"]),
         O("teacher", "教师", "教师", "teacher", ["formal", "elegant"]),
         O("athlete", "运动员", "运动员", "athlete", ["sport"]),
         O("artist", "艺术家", "艺术家", "artist", ["casual", "elegant"]),
         O("doctor", "医生", "医生", "doctor", ["formal"]),
         O("chef", "厨师", "厨师", "chef", ["casual"]),
         O("knight", "骑士", "骑士", "knight", ["fantasy", "western"]),
         O("mage", "法师", "法师", "mage", ["fantasy"]),
         O("monk", "修士", "修行者", "ascetic monk", ["china", "fantasy"]),
         O("ninja", "忍者", "忍者", "ninja", ["japan", "fantasy"]),
         O("swordsman", "剑客", "剑客", "swordsman", ["china", "hanfu"]),
         O("immortal", "仙人", "修仙者", "immortal cultivator", ["china", "wuxia"]),
         O("idol", "偶像", "偶像", "idol", ["cute", "elegant"]),
         O("explorer", "探险家", "探险家", "explorer", ["outdoor"]),
         O("cyber", "赛博客", "赛博改造人", "cyber-augmented operator", ["cyberpunk", "scifi"]),
         O("noble", "贵族", "贵族", "noble", ["elegant", "fantasy"]),
         O("merchant", "商人", "商人", "merchant", ["casual", "formal"]),
         O("guard", "守卫", "守卫", "guard", ["fantasy", "outdoor"]),
         O("farmer", "农人", "农人", "farmer", ["outdoor"]),
         O("pilot", "飞行员", "飞行员", "pilot", ["scifi", "military"]),
         O("soldier", "士兵", "士兵", "soldier", ["military"]),
         O("hunter", "猎人", "猎人", "hunter", ["outdoor", "western"]),
         O("cowboy", "牛仔", "西部牛仔", "cowboy", ["western"]),
         O("samurai", "武士", "武士", "samurai", ["japan"]),
         O("geisha", "艺伎", "艺伎", "geisha", ["japan", "elegant"]),
         O("priest", "祭司", "祭司", "priest", ["india", "fantasy"]),
         O("dancer", "舞者", "舞者", "dancer", ["elegant", "cute"]),
         O("assassin", "刺客", "刺客", "assassin", ["punk", "fantasy"]),
         O("shaman", "萨满", "萨满", "shaman", ["warcraft", "norse"]),
         O("pirate", "海盗", "海盗", "pirate", ["vintage", "outdoor"]),
         O("detective", "侦探", "侦探", "detective", ["vintage", "formal"]),
         O("maid", "女仆", "女仆", "maid", ["cute"]),
         O("nurse", "护士", "护士", "nurse", ["modern", "formal"]),
     ]},

    # 注：「风格定位」和「性格/气质」两个维度已整体移除。
    # 原因：风格由题材（theme）收敛，气质不属于外貌描述，写进提示词只会干扰笔触。
]

# ===================== 配色板 =====================
HAIR_COLORS = ["inkBlack", "dkBrown", "chestnut", "ltBrown", "auburn", "copper", "flaxen", "gold",
               "platinum", "silverH", "saltPep", "smokeBlue", "sakura", "violetH", "mossH",
               "snowWhite", "roseGold", "midnightBlue"]
EYE_COLORS = ["eyesBlack", "eyesDBr", "eyesLBr", "amber", "eyesGreen", "eyesBlue", "eyesDBlue",
              "eyesGray", "eyesViolet", "eyesRed", "eyesGold"]
SKIN_COLORS = ["porcelain", "ivory", "fair", "wheat", "tan", "bronze", "brown", "ebony"]

CLOTH_COLORS = ["white", "cream", "lGray", "gray", "dGray", "black", "navy", "skyBlue", "lakeBlue", "teal",
                "green", "olive", "khaki", "brown", "maroon", "red", "orange", "gold", "pink", "purple",
                "violet", "magenta", "jade", "indigo", "crimson", "beige"]
SHOE_COLORS = ["white", "cream", "lGray", "gray", "dGray", "black", "navy", "skyBlue", "lakeBlue",
               "teal", "green", "olive", "brown", "maroon", "red", "orange", "gold", "pink",
               "purple", "beige"]

NEUTRAL = ["white", "cream", "lGray", "gray", "dGray", "black", "navy", "brown", "khaki", "maroon", "beige"]
SHOE_NEUTRAL = ["white", "lGray", "gray", "dGray", "black", "brown", "navy", "maroon"]
WARM = ["cream", "gold", "orange", "red", "maroon", "brown", "khaki", "olive", "pink", "crimson", "beige"]
COOL = ["skyBlue", "lakeBlue", "teal", "green", "purple", "violet", "magenta", "navy", "indigo", "jade"]

COLOR_EN = {
    "white": "white", "cream": "cream", "lGray": "light gray", "gray": "gray", "dGray": "dark gray",
    "black": "black", "navy": "navy blue", "skyBlue": "sky blue", "lakeBlue": "lake blue", "teal": "teal",
    "green": "green", "olive": "olive", "khaki": "khaki", "brown": "brown", "maroon": "maroon",
    "red": "red", "orange": "orange", "gold": "gold", "pink": "pink", "purple": "purple",
    "violet": "violet", "magenta": "magenta", "jade": "jade green", "indigo": "indigo",
    "crimson": "crimson", "beige": "beige",
    "inkBlack": "jet black hair", "dkBrown": "dark brown hair", "chestnut": "chestnut hair",
    "ltBrown": "light brown hair", "auburn": "auburn hair", "copper": "copper hair",
    "flaxen": "flaxen hair", "platinum": "platinum blonde hair", "silverH": "silver hair",
    "saltPep": "salt and pepper hair", "smokeBlue": "smoky blue hair", "sakura": "sakura pink hair",
    "violetH": "violet hair", "mossH": "moss green hair", "snowWhite": "snow white hair",
    "roseGold": "rose gold hair", "midnightBlue": "midnight blue hair",
    "eyesBlack": "black eyes", "eyesDBr": "dark brown eyes", "eyesLBr": "light brown eyes",
    "amber": "amber eyes", "eyesGreen": "green eyes", "eyesBlue": "blue eyes",
    "eyesDBlue": "deep blue eyes", "eyesGray": "gray eyes", "eyesViolet": "violet eyes",
    "eyesRed": "red eyes", "eyesGold": "golden eyes",
    "porcelain": "porcelain skin", "ivory": "ivory skin", "fair": "fair skin",
    "wheat": "wheatish skin", "tan": "tanned skin", "bronze": "bronze skin",
    "brown": "dark brown skin", "ebony": "ebony skin",
}

COLOR_CN = {
    "white": "白", "cream": "米白", "lGray": "浅灰", "gray": "灰", "dGray": "深灰", "black": "黑",
    "navy": "藏蓝", "skyBlue": "天蓝", "lakeBlue": "湖蓝", "teal": "青", "green": "绿", "olive": "橄榄绿",
    "khaki": "卡其", "brown": "棕", "maroon": "栗", "red": "红", "orange": "橙", "gold": "金",
    "pink": "粉", "purple": "紫", "violet": "紫罗兰", "magenta": "品红", "jade": "翡翠绿",
    "indigo": "靛青", "crimson": "绛红", "beige": "米色",
    "inkBlack": "墨黑", "dkBrown": "深棕", "chestnut": "栗", "ltBrown": "浅棕", "auburn": "赭红",
    "copper": "铜", "flaxen": "亚麻", "platinum": "铂金", "silverH": "银灰", "saltPep": "花白",
    "smokeBlue": "烟蓝", "sakura": "樱粉", "violetH": "紫", "mossH": "苔绿", "snowWhite": "雪白",
    "roseGold": "玫瑰金", "midnightBlue": "幽蓝",
    "eyesBlack": "黑", "eyesDBr": "深棕", "eyesLBr": "浅棕", "amber": "琥珀", "eyesGreen": "绿",
    "eyesBlue": "蓝", "eyesDBlue": "深蓝", "eyesGray": "灰", "eyesViolet": "紫",
    "eyesRed": "红", "eyesGold": "金",
    "porcelain": "瓷白", "ivory": "象牙白", "fair": "白皙", "wheat": "小麦", "tan": "晒黑",
    "bronze": "古铜", "brown": "深棕", "ebony": "黝黑",
}

# 画面通用（中文，固定附加在提示词末尾 —— 角色一律无背景、纯色底）
SCENE_TAGS_CN = ["全身像", "正面站立", "居中构图", "纯色背景", "无背景元素", "角色设定图",
                 "服装细节清晰", "五官清晰", "柔和均匀的光线", "高清细节"]
SCENE_TAGS_EN = ["full body shot", "centered composition", "character design sheet",
                 "plain solid background", "no background elements", "detailed clothing textures",
                 "consistent character design", "high detail", "soft even lighting"]
