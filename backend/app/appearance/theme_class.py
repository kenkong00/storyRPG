# -*- coding: utf-8 -*-
"""
题材 × 职业 —— 只做「参数池约束」，不写任何提示词。

口径（按用户要求）：
1. 题材只有 4 个：中国武侠风 / 日本武士道 / 魔兽世界 / 欧洲中世纪。
   题材本身**不往提示词里加一句风格描述**，唯一作用是约束各维度的候选款式。
2. 职业 6 个（与卡牌系统同一套代码）：战士 / 圣骑士 / 法师 / 迷魂者 / 游侠 / 刺客。
   同一个职业名在 4 个题材下款式完全不同 —— 四个题材的款式 id 互不重叠。
3. 取值优先级：职业池 > 题材池 > 全量。职业池没写某维度就落到题材池，题材也没写就全量。
4. 每个职业在每个维度都有 3~5 个款式可选，保证「款式多样」。

pools[dim] = [option_id, ...]；option_id 必须在 appearance defs 里真实存在
（本文件 NEW_OPTIONS 里的新款式由 defs 迁移自动补进对应维度）。
"""

# 职业（与 backend/app/models/cardgame.py 的 CardClass.code 一致）
CLASSES = [
    {"code": "warrior", "name": "战士", "icon": "🛡️"},
    {"code": "paladin", "name": "圣骑士", "icon": "✨"},
    {"code": "mage", "name": "法师", "icon": "🔥"},
    {"code": "mesmer", "name": "迷魂者", "icon": "👁️"},
    {"code": "ranger", "name": "游侠", "icon": "🏹"},
    {"code": "assassin", "name": "刺客", "icon": "🗡️"},
]

CLASS_NAME = {c["code"]: c["name"] for c in CLASSES}


# ======================================================================
# 四个题材专属的新款式（迁移时补进外观定义库，之后可在「定义管理」里再改）
# ======================================================================
NEW_OPTIONS = {
    # ---------------- 中国武侠风 ----------------
    "wuxiaRobe": ("top", "剑客长袍", "素色剑客长袍，交领右衽，腰束革带，下摆开衩"),
    "wuxiaSoftArmor": ("top", "玄铁软甲", "玄铁片缀成的软甲，外罩青色外衫"),
    "wuxiaNightSuit": ("top", "夜行衣", "鸦青夜行衣，紧身束袖，蒙面巾遮口鼻"),
    "wuxiaCloak": ("outer", "大氅", "玄色大氅，肩披狐裘领，下摆压着暗纹"),
    "wuxiaBoots": ("shoes", "快靴", "薄底快靴，靴筒缠布绑腿"),
    "wuxiaHeadband": ("hat", "束发带", "额前一条束发带，末端随风飘动"),
    "wuxiaShortJacket": ("top", "短打劲装", "短打短褐，布带束腰，袖口紧扎"),
    "wuxiaBrightArmor": ("top", "明光铠", "明光铠，胸前双圆护，光可鉴人"),
    "wuxiaScholarRobe": ("top", "月白襕衫", "月白襕衫，圆领大袖，腰束青丝绦"),
    "wuxiaHunterCoat": ("top", "猎户皮袄", "粗皮短袄，前襟斜系，肩上搭着兽皮"),
    "wuxiaGauzeTop": ("top", "绯纱罗衫", "绯色薄纱罗衫，广袖透光，隐约见里衣"),
    "wuxiaWrapPants": ("bottom", "绑腿裤", "紧口绑腿长裤，布条一直缠到小腿"),
    # ---------------- 日本武士道 ----------------
    "do": ("top", "胴甲", "涂漆胴甲，缀绯红丝绦，肩甲层层叠压"),
    "jinbaori": ("top", "阵羽织", "阵羽织外套，背后一方家纹，袖口束起"),
    "kosode": ("top", "小袖", "素色小袖，交领窄腰，下摆塞进袴里"),
    "shinobiGarb": ("top", "忍装", "深蓝忍装，缠臂绑腿，腰间缠巾"),
    "uchikake": ("outer", "打挂", "华丽打挂外套，下摆与袖口缀金线"),
    "waraji": ("shoes", "草鞋", "编草鞋踏地，足袋外露"),
    "hachimaki": ("hat", "钵卷", "额上缠一条钵卷头带"),
    "tatamiGusoku": ("top", "畳甲", "可折叠的畳甲，黑漆小札缀成，轻便贴身"),
    "kikko": ("top", "龟甲纹上衣", "龟甲纹缝制的护身上衣，内衬锁子"),
    "kariginu": ("top", "狩衣", "狩衣，圆领宽袖，袖口系着括绪"),
    "hitatare": ("top", "直垂", "直垂，武家礼服，胸系菊缀，下摆塞进袴里"),
    "samue": ("top", "作务衣", "靛蓝作务衣，窄袖束腰，便于劳作"),
    "tattsuke": ("bottom", "裁付袴", "裁付袴，膝下束口绑腿"),
    "kobakama": ("bottom", "小袴", "小袴，及踝短袴，行步轻便"),
    # ---------------- 魔兽世界 ----------------
    "bonePlate": ("top", "骨甲", "兽骨与黑铁拼成的骨甲，肩头立着两根獠牙"),
    "beastHide": ("top", "兽皮披挂", "粗制兽皮披挂，毛边翻卷，肩部厚实"),
    "runeRobe": ("top", "符文长袍", "暗紫符文长袍，衣摆绣着会发光的符文"),
    "totemWrap": ("top", "图腾裹布", "粗布裹身，胸前挂一串兽骨图腾牌"),
    "shadowLeather": ("top", "暗影皮甲", "缝合暗影布片的皮甲，缝线泛着紫光"),
    "tuskMantle": ("outer", "獠牙披肩", "獠牙与兽骨串成的披肩，压在肩头"),
    "ironGreaser": ("shoes", "铁头战靴", "铁头厚底战靴，绑带一直缠到小腿"),
    "warHorn": ("hat", "战角盔", "额前生出一对弯角，角根缠着皮绳"),
    "tribalHarness": ("top", "兽筋束甲", "兽筋皮条编成的束甲，露出肩背与臂肌"),
    "scaleMail": ("top", "巨兽鳞甲", "巨兽鳞片缝成的鳞甲，泛着暗青光"),
    "felRobe": ("top", "邪能织袍", "邪能浸染的织袍，裂缝里透出幽绿"),
    "bristleFur": ("top", "鬃毛皮衣", "粗鬃毛压制的皮衣，领口翻出一圈长毛"),
    "hideSkirt": ("bottom", "兽皮围腰", "兽皮围腰垂到膝盖，边缘毛糙不修边幅"),
    # ---------------- 欧洲中世纪 ----------------
    "hauberk": ("top", "锁子甲罩衣", "环环相扣的锁子甲罩衣，肘部加厚"),
    "surcoat": ("top", "骑士罩袍", "亚麻罩袍，胸前绣家徽，下摆过膝"),
    "kirtle": ("top", "柯特外衫", "及踝柯特外衫，腰系布带，袖口收紧"),
    "doublet": ("top", "紧身短上衣", "紧身缝线短上衣，下摆开衩，铜扣一排"),
    "gambeson": ("top", "棉甲", "厚棉绗缝甲，菱格走线，颈口高立"),
    "friarRobe": ("top", "修士袍", "粗呢修士袍，兜帽垂在背后，腰系麻绳"),
    "mantle": ("outer", "披风斗篷", "羊毛短披风，铜扣系在颈前"),
    "sabatons": ("shoes", "铁靴", "铁片护足铁靴，踩地有声"),
    "coif": ("hat", "锁甲头巾", "锁甲头巾包住头部与脖颈"),
    "brigandine": ("top", "板钉甲", "布面里缀满铁片的板钉甲，铆钉成行"),
    "houppelande": ("top", "豪普兰长袍", "豪普兰长袍，高领宽袖，下摆及地"),
    "cotehardie": ("top", "科特哈迪紧身衣", "科特哈迪紧身衣，前襟一排小纽扣"),
    "chemise": ("top", "亚麻内衬衣", "亚麻内衬衣，抽绳领口，肩线宽松"),
    "hose": ("bottom", "羊毛紧身裤", "羊毛紧身裤，两腿异色拼接"),
    "braies": ("bottom", "亚麻短裤", "亚麻宽松短裤，腰间系带"),
}

# 4 个题材的主色板（同时供上装 / 外套 / 下装 / 鞋 的配色随机）
_WUXIA_COLORS = ["white", "cream", "jade", "indigo", "crimson", "black", "lGray", "navy"]
_BUSHIDO_COLORS = ["black", "white", "crimson", "indigo", "gold", "purple", "dGray"]
_WARCRAFT_COLORS = ["dGray", "black", "brown", "maroon", "olive", "khaki", "purple", "green"]
_MEDIEVAL_COLORS = ["cream", "lGray", "gray", "dGray", "brown", "navy", "olive", "maroon"]


# ======================================================================
# 中国武侠风
# ======================================================================
_WUXIA_BASE = {
    "topColor": _WUXIA_COLORS,
    "outerColor": ["white", "jade", "indigo", "black", "lGray", "crimson"],
    "bottomColor": ["black", "white", "indigo", "dGray", "jade", "navy"],
    "shoeColor": ["black", "brown", "dGray", "cream"],
    "sleeve": ["long", "wide", "half"],
    "topPattern": ["plain", "cloud", "dragon", "phoenix", "bamboo", "plum", "embroidery"],
    "socks": ["legwrap", "none", "crew"],
    "belt": ["sash", "ropeBelt", "leather", "waistChain", "none"],
    "neckwear": ["jade", "beads", "amulet", "necklace", "none"],
    "gloves": ["wrist", "armWrap", "none"],
    "backpack": ["swordSheath", "basket", "satchel", "canteen", "none"],
    "hairstyle": ["hanfuBun", "flyingFairy", "doubleLoop", "topknotW", "implike", "longStr", "braid"],
    "hat": ["guan", "buyao", "zan", "douli", "wuxiaHeadband", "none"],
    "tattoo": ["none", "small", "arm", "sacred"],
    "marks": ["mkNone", "beauty", "scar", "blushMark", "glowMark"],
    "skin": ["porcelain", "ivory", "fair", "wheat", "tan"],
}

_WUXIA = {
    # 战士：江湖刀客 / 镖师
    "warrior": {
        "top": ["wuxiaSoftArmor", "wuxiaBrightArmor", "wuxiaShortJacket", "hanfuTop", "wuxiaRobe", "wuxiaWrap"],
        "outer": ["wuxiaCloak", "hanfuCoat", "cape"],
        "bottom": ["wideLeg", "wuxiaWrapPants", "baggySh", "leatherPants"],
        "shoes": ["wuxiaBoots", "cloudBoot", "clothBoots"],
        "prop": ["jian", "sword", "spear", "none"],
        "build": ["athletic", "muscular", "heavy", "fit"],
        "shoulder": ["broad", "normal"],
    },
    # 圣骑士：名门正派护法
    "paladin": {
        "top": ["roundCollar", "beizi", "wuxiaBrightArmor", "wuxiaScholarRobe", "hanfuTop", "quju"],
        "outer": ["hanfuCoat", "pibo", "cape"],
        "bottom": ["longSk", "mamian", "wideLeg"],
        "shoes": ["cloudBoot", "wuxiaBoots"],
        "prop": ["jian", "scroll", "flag", "none"],
        "build": ["fit", "athletic", "muscular"],
        "shoulder": ["normal", "broad"],
    },
    # 法师：道门玄门
    "mage": {
        "top": ["daopao", "zhiduo", "wuxiaScholarRobe", "xianxiaRobe", "monkRobe"],
        "outer": ["hanfuCoat", "pibo", "wuxiaCloak"],
        "bottom": ["longSk", "ruqunSkirt", "wideLeg"],
        "shoes": ["cloudBoot", "clothBoots", "barefoot"],
        "prop": ["staff", "scroll", "fan", "lantern"],
        "build": ["thin", "slim", "fit", "skeletal"],
        "shoulder": ["narrow", "normal"],
    },
    # 迷魂者：花魁 / 妖女
    "mesmer": {
        "top": ["qixiong", "ruqun", "wuxiaGauzeTop", "qipao", "cheongsamMod"],
        "outer": ["pibo", "hanfuCoat", "wuxiaCloak"],
        "bottom": ["ruqunSkirt", "longSk", "mamian"],
        "shoes": ["clothBoots", "cloudBoot", "barefoot"],
        "prop": ["fan", "pipa", "parasol", "teacup"],
        "build": ["slim", "soft", "fit", "chubby"],
        "shoulder": ["narrow", "normal"],
    },
    # 游侠：轻装远行
    "ranger": {
        "top": ["magua", "wuxiaWrap", "wuxiaHunterCoat", "wuxiaShortJacket", "hanfuTop"],
        "outer": ["cape", "wuxiaCloak", "hanfuCoat"],
        "bottom": ["wideLeg", "wuxiaWrapPants", "baggySh", "kneeSk"],
        "shoes": ["wuxiaBoots", "clothBoots", "barefoot"],
        "prop": ["bow", "jian", "dagger", "lantern"],
        "build": ["thin", "slim", "athletic", "fit"],
        "shoulder": ["normal", "broad"],
    },
    # 刺客：夜行劲装
    "assassin": {
        "top": ["wuxiaNightSuit", "wuxiaWrap", "wuxiaShortJacket", "zhiduo", "leatherTop"],
        "outer": ["wuxiaCloak", "cape", "none"],
        "bottom": ["wideLeg", "wuxiaWrapPants", "leatherPants", "leggings"],
        "shoes": ["wuxiaBoots", "clothBoots", "barefoot"],
        "prop": ["dagger", "jian", "whip", "none"],
        "build": ["skeletal", "thin", "slim"],
        "shoulder": ["narrow", "normal"],
    },
}


# ======================================================================
# 日本武士道
# ======================================================================
_BUSHIDO_BASE = {
    "topColor": _BUSHIDO_COLORS,
    "outerColor": ["black", "indigo", "crimson", "dGray", "white"],
    "bottomColor": ["black", "indigo", "dGray", "gray", "crimson"],
    "shoeColor": ["black", "brown", "cream", "dGray"],
    "sleeve": ["long", "wide", "half"],
    "topPattern": ["plain", "floral", "geo", "print", "embroidery", "stripe"],
    "socks": ["tabi", "none", "legwrap"],
    "belt": ["obi", "sash", "ropeBelt", "none"],
    "neckwear": ["amulet", "beads", "necklace", "none"],
    "gloves": ["wrist", "armWrap", "fingerless", "none"],
    "backpack": ["swordSheath", "basket", "satchel", "canteen", "none"],
    "hairstyle": ["hime", "bunSamurai", "topBun", "hanfuBun", "lowPony", "braid"],
    "hat": ["kanzashi", "douli", "hachimaki", "hood", "none"],
    "tattoo": ["none", "small", "arm", "backFull"],
    "marks": ["mkNone", "scar", "scarEye", "oniMask", "blushMark"],
    "skin": ["porcelain", "ivory", "fair", "wheat"],
}

_BUSHIDO = {
    # 武士：胴甲 + 羽织袴
    "warrior": {
        "top": ["do", "tatamiGusoku", "samuraiRobe", "hitatare", "kosode"],
        "outer": ["haoriCoat", "uchikake", "cloak"],
        "bottom": ["hakama", "tattsuke", "wideLeg"],
        "shoes": ["waraji", "clog", "boots"],
        "prop": ["sword", "spear", "none"],
        "build": ["athletic", "muscular", "fit"],
        "shoulder": ["broad", "normal"],
    },
    # 圣骑士：旗本 / 守护武士
    "paladin": {
        "top": ["samuraiRobe", "hitatare", "kariginu", "jinbaori", "kimono", "haori"],
        "outer": ["haoriCoat", "uchikake"],
        "bottom": ["hakama", "tattsuke", "longSk"],
        "shoes": ["geta", "clog", "waraji"],
        "prop": ["sword", "fan", "flag", "none"],
        "build": ["fit", "athletic", "muscular"],
        "shoulder": ["normal", "broad"],
    },
    # 法师：阴阳师 / 山伏
    "mage": {
        "top": ["kosode", "kariginu", "samue", "yukata", "haori", "samuraiRobe"],
        "outer": ["haoriCoat", "cloak"],
        "bottom": ["hakama", "kobakama", "longSk"],
        "shoes": ["geta", "clog", "barefoot"],
        "prop": ["staff", "scroll", "fan", "lantern"],
        "build": ["thin", "slim", "fit"],
        "shoulder": ["narrow", "normal"],
    },
    # 迷魂者：艺伎 / 巫女
    "mesmer": {
        "top": ["kimono", "yukata", "mikoTop", "kariginu", "haori"],
        "outer": ["uchikake", "haoriCoat"],
        "bottom": ["longSk", "kobakama", "kneeSk"],
        "shoes": ["geta", "clog", "barefoot"],
        "prop": ["fan", "parasol", "teacup", "pipa"],
        "build": ["slim", "soft", "fit"],
        "shoulder": ["narrow", "normal"],
    },
    # 游侠：山野猎人
    "ranger": {
        "top": ["yukata", "kosode", "samue", "kikko", "jinbaori"],
        "outer": ["haoriCoat", "cloak", "poncho"],
        "bottom": ["hakama", "tattsuke", "wideLeg"],
        "shoes": ["waraji", "boots", "barefoot"],
        "prop": ["bow", "dagger", "sword", "lantern"],
        "build": ["thin", "slim", "athletic"],
        "shoulder": ["normal"],
    },
    # 刺客：忍者
    "assassin": {
        "top": ["shinobiGarb", "samue", "kikko", "haori", "yukata", "kosode"],
        "outer": ["cloak", "none"],
        "bottom": ["hakama", "tattsuke", "wideLeg", "leggings"],
        "shoes": ["waraji", "boots", "barefoot"],
        "prop": ["dagger", "sword", "whip", "none"],
        "build": ["skeletal", "thin", "slim"],
        "shoulder": ["narrow", "normal"],
    },
}


# ======================================================================
# 魔兽世界
# ======================================================================
_WARCRAFT_BASE = {
    "topColor": _WARCRAFT_COLORS,
    "outerColor": ["brown", "dGray", "black", "maroon", "olive"],
    "bottomColor": ["brown", "dGray", "black", "olive", "khaki"],
    "shoeColor": ["brown", "black", "dGray", "maroon"],
    "sleeve": ["long", "short", "half", "none"],
    "topPattern": ["plain", "geo", "print", "embroidery", "gradient", "camo"],
    "socks": ["legwrap", "none", "crew"],
    "belt": ["buckle", "leather", "chain", "ropeBelt", "none"],
    "neckwear": ["amulet", "dogTag", "beads", "bibNecklace", "none"],
    "gloves": ["gauntlet", "wrist", "fingerless", "none"],
    "backpack": ["quiver", "swordSheath", "satchel", "canteen", "none"],
    "hairstyle": ["dreads", "mohawk", "messy", "bald", "buzz", "longStr", "topBun"],
    "hat": ["horned", "warHorn", "helmet", "headband", "none"],
    "tattoo": ["warPaint", "tribal", "rune", "arm", "backFull", "sleeve", "none"],
    "marks": ["mkNone", "scar", "scarEye", "teeth"],
    "bodyMark": ["bmNone", "dragonScale", "scarBody", "wings", "bandage"],
    "skin": ["wheat", "tan", "bronze", "brown", "ebony", "ivory"],
}

_WARCRAFT = {
    # 战士：重甲与兽骨
    "warrior": {
        "top": ["chainmail", "bonePlate", "scaleMail", "bristleFur", "beastHide", "leatherArmor"],
        "outer": ["tuskMantle", "furCoat", "poncho"],
        "bottom": ["leatherPants", "hideSkirt", "kilt", "wideLeg"],
        "shoes": ["ironGreaser", "warBoots", "longBoot"],
        "prop": ["axe", "sword", "spear", "none"],
        "build": ["muscular", "heavy", "athletic"],
        "shoulder": ["broad"],
    },
    # 圣骑士：圣光战甲
    "paladin": {
        "top": ["chainmail", "bonePlate", "scaleMail", "felRobe", "runeRobe"],
        "outer": ["tuskMantle", "cape", "furCoat"],
        "bottom": ["leatherPants", "hideSkirt", "kilt", "longSk"],
        "shoes": ["ironGreaser", "warBoots"],
        "prop": ["sword", "axe", "flag", "none"],
        "build": ["athletic", "muscular", "fit"],
        "shoulder": ["broad", "normal"],
    },
    # 法师：符文与萨满
    "mage": {
        "top": ["runeRobe", "felRobe", "shamanVest", "tribalWrap", "shadowLeather"],
        "outer": ["cloak", "shawl", "tuskMantle"],
        "bottom": ["longSk", "wideLeg", "loincloth"],
        "shoes": ["ironGreaser", "barefoot"],
        "prop": ["staff", "scroll", "lantern", "scythe"],
        "build": ["thin", "slim", "skeletal"],
        "shoulder": ["narrow", "normal"],
    },
    # 迷魂者：图腾与暗影
    "mesmer": {
        "top": ["totemWrap", "shadowLeather", "tribalWrap", "shamanVest", "felRobe"],
        "outer": ["tuskMantle", "shawl", "cape"],
        "bottom": ["longSk", "loincloth", "leatherPants"],
        "shoes": ["ironGreaser", "longBoot", "barefoot"],
        "prop": ["dagger", "staff", "whip", "lantern"],
        "build": ["slim", "soft", "fit"],
        "shoulder": ["narrow", "normal"],
    },
    # 游侠：荒野猎手
    "ranger": {
        "top": ["leatherArmor", "beastHide", "bristleFur", "tribalHarness", "shadowLeather"],
        "outer": ["furCoat", "poncho", "tuskMantle"],
        "bottom": ["leatherPants", "hideSkirt", "kilt", "cargo"],
        "shoes": ["warBoots", "ironGreaser", "barefoot"],
        "prop": ["bow", "dagger", "spear"],
        "build": ["thin", "athletic", "fit"],
        "shoulder": ["normal"],
    },
    # 刺客：暗影潜行
    "assassin": {
        "top": ["shadowLeather", "leatherArmor", "tribalHarness", "totemWrap"],
        "outer": ["tuskMantle", "cloak", "none"],
        "bottom": ["leatherPants", "leggings", "loincloth"],
        "shoes": ["ironGreaser", "barefoot"],
        "prop": ["dagger", "scythe", "whip", "none"],
        "build": ["skeletal", "thin", "slim"],
        "shoulder": ["narrow", "normal"],
    },
}


# ======================================================================
# 欧洲中世纪
# ======================================================================
_MEDIEVAL_BASE = {
    "topColor": _MEDIEVAL_COLORS,
    "outerColor": ["brown", "dGray", "gray", "maroon", "navy", "cream"],
    "bottomColor": ["brown", "dGray", "gray", "olive", "black", "navy"],
    "shoeColor": ["brown", "black", "dGray", "cream"],
    "sleeve": ["long", "half", "wide", "short"],
    "topPattern": ["plain", "embroidery", "geo", "check", "print"],
    "socks": ["none", "crew", "pantyhose", "legwrap"],
    "belt": ["leather", "buckle", "ropeBelt", "sash", "none"],
    "neckwear": ["necklace", "amulet", "cravat", "stole", "beads", "none"],
    "gloves": ["glove", "gauntlet", "mitt", "none"],
    "backpack": ["satchel", "quiver", "basket", "canteen", "none"],
    "hairstyle": ["longStr", "braid", "lowPony", "bob", "wavyLob", "longWave"],
    "hat": ["coif", "circlet", "crown", "veil", "hood", "none"],
    "tattoo": ["none", "small", "arm", "rune"],
    "marks": ["mkNone", "freckle", "scar", "birthmark", "beauty"],
    "skin": ["porcelain", "ivory", "fair", "wheat", "tan"],
}

_MEDIEVAL = {
    # 战士：罩袍重甲
    "warrior": {
        "top": ["plate", "hauberk", "brigandine", "gambeson", "surcoat", "cotehardie"],
        "outer": ["mantle", "cloak", "furCoat"],
        "bottom": ["leatherPants", "hose", "wideLeg", "kilt"],
        "shoes": ["sabatons", "longBoot", "boots"],
        "prop": ["sword", "axe", "spear", "none"],
        "build": ["athletic", "muscular", "heavy"],
        "shoulder": ["broad", "normal"],
    },
    # 圣骑士：骑士团
    "paladin": {
        "top": ["plate", "surcoat", "tabard", "brigandine", "hauberk"],
        "outer": ["mantle", "cape", "cloak"],
        "bottom": ["leatherPants", "hose", "longSk", "kilt"],
        "shoes": ["sabatons", "longBoot"],
        "prop": ["sword", "flag", "staff"],
        "build": ["fit", "athletic", "muscular"],
        "shoulder": ["normal", "broad"],
    },
    # 法师：修士与学者
    "mage": {
        "top": ["friarRobe", "mageRobe", "houppelande", "chemise", "kirtle", "peasantBlouse"],
        "outer": ["cloak", "mantle", "shawl"],
        "bottom": ["longSk", "hose", "wideLeg", "leggings"],
        "shoes": ["boots", "brogue", "barefoot"],
        "prop": ["staff", "scroll", "lantern", "book"],
        "build": ["thin", "slim", "skeletal"],
        "shoulder": ["narrow", "normal"],
    },
    # 迷魂者：贵妇与歌女
    "mesmer": {
        "top": ["victorian", "gown", "houppelande", "corsetTop", "chemise", "doublet", "kirtle"],
        "outer": ["shawl", "mantle", "cape"],
        "bottom": ["longSk", "pleatSk", "aSk"],
        "shoes": ["heel", "boots", "brogue"],
        "prop": ["fan", "parasol", "flowerP", "book"],
        "build": ["slim", "soft", "fit"],
        "shoulder": ["narrow", "normal"],
    },
    # 游侠：林地猎手
    "ranger": {
        "top": ["doublet", "cotehardie", "chemise", "gambeson", "peasantBlouse", "blouse"],
        "outer": ["cloak", "mantle", "poncho"],
        "bottom": ["leatherPants", "hose", "braies", "wideLeg", "leggings"],
        "shoes": ["boots", "longBoot", "brogue"],
        "prop": ["bow", "dagger", "spear", "none"],
        "build": ["thin", "slim", "athletic"],
        "shoulder": ["normal"],
    },
    # 刺客：盗贼与斥候
    "assassin": {
        "top": ["doublet", "brigandine", "chemise", "corsetTop", "kirtle", "peasantBlouse"],
        "outer": ["cloak", "mantle", "none"],
        "bottom": ["leatherPants", "hose", "leggings", "wideLeg"],
        "shoes": ["boots", "brogue", "barefoot"],
        "prop": ["dagger", "sword", "whip", "none"],
        "build": ["skeletal", "thin", "slim"],
        "shoulder": ["narrow", "normal"],
    },
}


# ======================================================================
# 汇总
# ======================================================================
THEME_DEFS = [
    {
        "id": "wuxia", "name": "中国武侠风",
        "desc": "汉服形制、束袖劲装、刀剑拳脚、江湖门派",
        "nationality": "cn", "tags": ["china", "hanfu", "wuxia", "fantasy"],
        "base": _WUXIA_BASE, "classes": _WUXIA,
    },
    {
        "id": "bushido", "name": "日本武士道",
        "desc": "和服羽织、袴与腰封、胴具足、忍者与艺伎",
        "nationality": "jp", "tags": ["japan"],
        "base": _BUSHIDO_BASE, "classes": _BUSHIDO,
    },
    {
        "id": "warcraft", "name": "魔兽世界",
        "desc": "兽骨与符文、皮革与图腾、萨满与法师长袍",
        "nationality": "", "tags": ["warcraft", "fantasy"],
        "base": _WARCRAFT_BASE, "classes": _WARCRAFT,
    },
    {
        "id": "medieval", "name": "欧洲中世纪",
        "desc": "锁子甲与罩袍、亚麻粗呢、兜帽与铁靴",
        "nationality": "gb", "tags": ["gothic", "fantasy"],
        "base": _MEDIEVAL_BASE, "classes": _MEDIEVAL,
    },
]

THEME_IDS = [t["id"] for t in THEME_DEFS]

# 参数池每次大改就把这个号 +1：defs 迁移发现号对不上就重装 4 套题材
THEME_REV = 3
THEME_NAME = {t["id"]: t["name"] for t in THEME_DEFS}

_COLORS_BY_THEME = {
    "wuxia": _WUXIA_COLORS,
    "bushido": _BUSHIDO_COLORS,
    "warcraft": _WARCRAFT_COLORS,
    "medieval": _MEDIEVAL_COLORS,
}


def merged_pools(theme_id, cls_code=None):
    """题材 + 职业 收敛后的可用 id 表：{dim: [id, ...]}。职业池覆盖题材池。"""
    t = next((x for x in THEME_DEFS if x["id"] == theme_id), None)
    if not t:
        return {}
    pools = {k: list(v) for k, v in (t.get("base") or {}).items()}
    if cls_code:
        for k, v in ((t.get("classes") or {}).get(cls_code) or {}).items():
            pools[k] = list(v)
    return pools


def all_pools(theme_id):
    """题材下「所有职业池的并集」——不选职业时用，保证 6 个职业的款式都还能选。"""
    t = next((x for x in THEME_DEFS if x["id"] == theme_id), None)
    if not t:
        return {}
    pools = {k: list(v) for k, v in (t.get("base") or {}).items()}
    for cls in (t.get("classes") or {}).values():
        for dim, ids in cls.items():
            cur = pools.setdefault(dim, [])
            for i in ids:
                if i not in cur:
                    cur.append(i)
    return pools


def theme_seed():
    """给 defs（落盘 JSON）用的题材条目：只有参数池，没有提示词。"""
    out = []
    for t in THEME_DEFS:
        out.append({
            "id": t["id"],
            "rev": THEME_REV,
            "name": t["name"],
            "desc": t["desc"],
            "cn": "",                     # 题材不允许往提示词里加字
            "nationality": t.get("nationality", ""),
            "tags": list(t.get("tags") or []),
            "pools": all_pools(t["id"]),
            "colors": list(_COLORS_BY_THEME.get(t["id"]) or []),
            "classes": [c["code"] for c in CLASSES],
        })
    return out


def class_pools(theme_id):
    """{职业代码: {dim: [id]}} —— 给前端做下拉收敛用。"""
    return {c["code"]: merged_pools(theme_id, c["code"]) for c in CLASSES}


def new_options_by_dim():
    """把 NEW_OPTIONS 按维度归类，供 defs 迁移补条目。"""
    out = {}
    for oid, (dim, name, cn) in NEW_OPTIONS.items():
        out.setdefault(dim, []).append({"id": oid, "name": name, "cn": cn, "tags": []})
    return out
