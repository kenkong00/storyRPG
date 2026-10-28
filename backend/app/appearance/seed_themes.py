# -*- coding: utf-8 -*-
"""
国籍（64 个）与「定向随机主题」（20 套）。

解决的核心问题：旧版随机是「纯均匀抽样」，想出一批「中国修仙角色」或「美国西部牛仔」完全做不到，
只能一次次重摇。现在：
- nationality 维度把国族/人种/传统服饰特征钉住；
- theme 把各维度收敛到指定候选池（pools），并附一段题材描述；
- 两者叠加 = 「中国 + 仙侠」这种精确的批量出图需求。

主题的 pools 是硬约束（只在该池内抽），tags 用于未列入 pools 的维度走风格匹配。
"""

from .seed_core import O

# ===================== 64 个国籍 =====================
# tags 用于和 theme 关联：临时选国籍时也会把对应文化带进提示词
NATIONALITIES = [
    # ---- 东亚 ----
    O("cn", "中国", "东方面孔，黑发杏眼，肤质细腻", "Chinese", ["china", "hanfu", "wuxia"]),
    O("jp", "日本", "东亚面孔，黑发，五官清秀", "Japanese", ["japan"]),
    O("kr", "韩国", "东亚面孔，白净肤色，五官柔和", "Korean", ["korea"]),
    O("kp", "朝鲜", "东亚面孔，气质朴素", "North Korean", ["korea"]),
    O("mn", "蒙古", "蒙古利亚面孔，颧骨略高，肤色偏深", "Mongolian", ["norse", "outdoor"]),

    # ---- 东南亚 / 南亚 ----
    O("vn", "越南", "东南亚面孔，肤色偏浅，身量纤细", "Vietnamese", ["india"]),
    O("th", "泰国", "东南亚面孔，肤色偏金，五官柔和", "Thai", ["india"]),
    O("id", "印度尼西亚", "南岛面孔，肤色棕褐", "Indonesian", ["india"]),
    O("my", "马来西亚", "混合面孔，肤色棕褐", "Malaysian", ["india"]),
    O("ph", "菲律宾", "南岛面孔，肤色蜜色", "Filipino", ["india"]),
    O("sg", "新加坡", "多元混合面孔，都市气质", "Singaporean", ["modern"]),
    O("mm", "缅甸", "东南亚面孔，肤色棕褐，五官清瘦", "Burmese", ["india"]),
    O("kh", "柬埔寨", "东南亚面孔，颧骨明显", "Cambodian", ["india"]),
    O("la", "老挝", "东南亚面孔，肤色偏黄", "Laotian", ["india"]),
    O("in", "印度", "南亚面孔，肤色深浅不一，眼窝深陷，眉目浓重", "Indian", ["india"]),
    O("pk", "巴基斯坦", "南亚面孔，眼窝深陷，五官立体", "Pakistani", ["india", "arabia"]),
    O("bd", "孟加拉", "南亚面孔，肤色深棕", "Bangladeshi", ["india"]),
    O("lk", "斯里兰卡", "南亚面孔，肤色偏棕，发色乌黑", "Sri Lankan", ["india"]),
    O("np", "尼泊尔", "南亚与东亚混合面孔，眉眼温和", "Nepalese", ["india"]),

    # ---- 中亚 / 西亚 ----
    O("kz", "哈萨克斯坦", "中亚面孔，颧骨偏高，轮廓硬朗", "Kazakh", ["norse", "outdoor"]),
    O("uz", "乌兹别克斯坦", "中亚面孔，浓眉深目", "Uzbek", ["arabia"]),
    O("ir", "伊朗", "波斯面孔，浓眉深目，鼻梁高挺", "Iranian", ["arabia"]),
    O("iq", "伊拉克", "阿拉伯面孔，深目高鼻", "Iraqi", ["arabia"]),
    O("ar", "沙特阿拉伯", "阿拉伯面孔，肤色小麦，深目", "Saudi", ["arabia"]),
    O("ae", "阿联酋", "阿拉伯面孔，眉眼深邃", "Emirati", ["arabia"]),
    O("il", "以色列", "地中海面孔，轮廓分明", "Israeli", ["arabia"]),
    O("tr", "土耳其", "地中海与突厥混合面孔，轮廓深邃", "Turkish", ["arabia", "greek"]),

    # ---- 非洲 ----
    O("eg", "埃及", "北非面孔，肤色橄榄，眼型修长", "Egyptian", ["arabia", "aztec"]),
    O("ma", "摩洛哥", "北非面孔，卷发深目", "Moroccan", ["arabia"]),
    O("ng", "尼日利亚", "西非面孔，肤色深黑，五官厚实", "Nigerian", ["africa"]),
    O("ke", "肯尼亚", "东非面孔，肤色深棕，身量高挑", "Kenyan", ["africa"]),
    O("et", "埃塞俄比亚", "东非面孔，肤色深棕，五官精致", "Ethiopian", ["africa"]),
    O("za", "南非", "多种族混合面孔", "South African", ["africa"]),

    # ---- 欧洲 ----
    O("gb", "英国", "盎格鲁面孔，肤色浅，轮廓清瘦", "British", ["gothic", "steampunk"]),
    O("ie", "爱尔兰", "凯尔特面孔，红发或浅发，雀斑常见", "Irish", ["norse"]),
    O("fr", "法国", "高卢面孔，五官精致，气质优雅", "French", ["gothic", "elegant"]),
    O("de", "德国", "日耳曼面孔，轮廓硬朗，浅色眼眸", "German", ["military", "steampunk"]),
    O("at", "奥地利", "日耳曼面孔，气质古典", "Austrian", ["gothic", "elegant"]),
    O("ch", "瑞士", "阿尔卑斯面孔，五官端正", "Swiss", ["modern"]),
    O("it", "意大利", "地中海面孔，深发深目，轮廓柔和", "Italian", ["greek", "elegant"]),
    O("es", "西班牙", "伊比利亚面孔，肤色橄榄，深发", "Spanish", ["western", "greek"]),
    O("pt", "葡萄牙", "伊比利亚面孔，肤色偏深", "Portuguese", ["western"]),
    O("nl", "荷兰", "日耳曼面孔，身量高挑，金发常见", "Dutch", ["modern", "norse"]),
    O("be", "比利时", "混合欧洲面孔，五官柔和", "Belgian", ["modern"]),
    O("se", "瑞典", "北欧面孔，金发碧眼，肤白", "Swedish", ["norse"]),
    O("no", "挪威", "北欧面孔，轮廓硬朗，金发", "Norwegian", ["norse"]),
    O("dk", "丹麦", "北欧面孔，气质沉稳", "Danish", ["norse"]),
    O("fi", "芬兰", "北欧面孔，浅色眼眸，轮廓清冷", "Finnish", ["norse"]),
    O("pl", "波兰", "斯拉夫面孔，五官立体", "Polish", ["norse"]),
    O("cz", "捷克", "斯拉夫面孔，气质文雅", "Czech", ["steampunk"]),
    O("hu", "匈牙利", "马扎尔面孔，轮廓分明", "Hungarian", ["norse"]),
    O("gr", "希腊", "地中海面孔，深目高鼻，轮廓古典", "Greek", ["greek"]),
    O("ru", "俄罗斯", "斯拉夫面孔，肤色白皙，轮廓清冷", "Russian", ["military"]),
    O("ua", "乌克兰", "斯拉夫面孔，五官精致", "Ukrainian", ["military"]),

    # ---- 美洲 ----
    O("us", "美国", "多元族裔混合面孔，肤色从象牙白到深棕不等，眼窝较深，鼻梁高挺，骨架偏大，发色多为棕金或深棕", "American", ["western", "modern", "street", "sport"]),
    O("ca", "加拿大", "多元混合面孔，气质温和", "Canadian", ["modern", "norse"]),
    O("mx", "墨西哥", "梅斯蒂索混合面孔，肤色棕褐", "Mexican", ["western", "aztec"]),
    O("br", "巴西", "多元混合面孔，肤色深浅不一", "Brazilian", ["modern"]),
    O("ar2", "阿根廷", "南欧裔面孔，轮廓分明", "Argentine", ["western"]),
    O("pe", "秘鲁", "安第斯面孔，肤色棕褐，颧骨高", "Peruvian", ["aztec"]),
    O("cl", "智利", "混合南美面孔", "Chilean", ["modern"]),
    O("co", "哥伦比亚", "混合南美面孔，肤色蜜色", "Colombian", ["modern"]),

    # ---- 大洋洲 ----
    O("au", "澳大利亚", "盎格鲁面孔，气质随性", "Australian", ["outdoor"]),
    O("nz", "新西兰", "混合太平洋面孔", "New Zealander", ["outdoor"]),
]

# ===================== 20 套定向随机主题 =====================
THEMES = [
    {
        "id": "wuxia", "name": "中式仙侠", "nationality": "cn",
        "desc": "东方修真世界：道袍广袖、灵剑法宝、云纹仙气",
        "cn": "东方仙侠修真世界，衣袂飘飞，云纹流苏，仙气缭绕，正统东方玄幻风格",
        "tags": ["china", "wuxia", "hanfu", "fantasy"],
        "pools": {
            "style": ["wuxia"], "role": ["immortal", "swordsman", "mage", "monk"],
            "top": ["xianxiaRobe", "daopao", "beizhi", "ruqun", "qixiong", "roundCollar", "wuxiaWrap", "hanfuTop"],
            "outer": ["pibo", "hanfuCoat", "cape", "none"],
            "bottom": ["ruqunSkirt", "mamian", "longSk", "wideLeg"],
            "shoes": ["cloudBoot", "clothBoots", "barefoot"],
            "hairstyle": ["flyingFairy", "hanfuBun", "doubleLoop", "topknotW", "implike", "longStr", "longWave"],
            "hat": ["guan", "buyao", "zan", "douli", "none"],
            "prop": ["jian", "sword", "fan", "parasol", "scroll", "lantern", "teacup", "none"],
            "marks": ["glowMark", "mkNone", "beauty"],
            "neckwear": ["jade", "none", "necklace"],
            "belt": ["sash", "none"],
        },
        "colors": ["white", "cream", "jade", "indigo", "crimson", "gold", "black", "lGray"],
    },
    {
        "id": "hanfu", "name": "中式古风", "nationality": "cn",
        "desc": "汉唐宋明各朝形制，襦裙袄衫、发簪步摇",
        "cn": "华夏古风，交领右衽，衣缘织锦，含蓄端庄的东方古典美",
        "tags": ["china", "hanfu", "elegant"],
        "pools": {
            "style": ["hanfu"], "role": ["noble", "swordsman", "teacher", "artist", "monk"],
            "top": ["ruqun", "qixiong", "beizhi", "roundCollar", "quju", "zhiduo", "magua", "hanfuTop"],
            "outer": ["hanfuCoat", "pibo", "cape", "none"],
            "bottom": ["mamian", "ruqunSkirt", "longSk"],
            "shoes": ["clothBoots", "cloudBoot"],
            "hairstyle": ["hanfuBun", "doubleLoop", "flyingFairy", "longStr", "implike", "topBun"],
            "hat": ["buyao", "zan", "guan", "douli", "none"],
            "prop": ["fan", "pipa", "teacup", "scroll", "parasol", "jian", "none"],
            "neckwear": ["jade", "none"],
            "belt": ["sash", "none"],
        },
        "colors": ["white", "cream", "crimson", "jade", "gold", "navy", "pink", "black"],
    },
    {
        "id": "japan", "name": "日式和风", "nationality": "jp",
        "desc": "和服浴衣、羽织袴、武士与巫女",
        "cn": "日式传统和风，和服纹样，腰封层叠，侘寂素雅",
        "tags": ["japan"],
        "pools": {
            "style": ["japan"], "role": ["samurai", "geisha", "ninja", "monk", "noble"],
            "top": ["kimono", "yukata", "haori", "samuraiRobe", "mikoTop", "sailor"],
            "outer": ["haoriCoat", "none", "cape"],
            "bottom": ["hakama", "longSk", "kneeSk"],
            "shoes": ["geta", "clog", "clothBoots", "barefoot"],
            "socks": ["tabi", "none"],
            "hairstyle": ["hime", "hanfuBun", "topBun", "longStr", "lowPony", "bunSamurai"],
            "hat": ["kanzashi", "douli", "none"],
            "prop": ["sword", "fan", "parasol", "teacup", "none"],
            "belt": ["obi", "none"],
            "marks": ["oniMask", "mkNone", "blushMark"],
        },
        "colors": ["black", "white", "crimson", "indigo", "gold", "purple", "pink"],
    },
    {
        "id": "korea", "name": "韩式", "nationality": "kr",
        "desc": "韩服赤古里裙与都市韩系穿搭",
        "cn": "韩式审美，赤古里短上衣配高腰长裙，或都市韩系简约穿搭",
        "tags": ["korea"],
        "pools": {
            "style": ["elegant", "korea"], "role": ["noble", "idol", "student", "office"],
            "top": ["hanbokTop", "koreanSuit", "blouse", "knit", "dress"],
            "outer": ["cardigan", "blazer", "furCoat", "none"],
            "bottom": ["longSk", "aSk", "wideLeg", "suitP"],
            "shoes": ["heel", "loafer", "sneaker"],
            "hairstyle": ["lowPony", "longWave", "bob", "topBun", "wavyLob"],
            "hat": ["none", "beret"],
            "prop": ["none", "phone", "flowerP", "handbag"],
        },
        "colors": ["white", "cream", "pink", "beige", "black", "navy"],
    },
    {
        "id": "india", "name": "印度宗教", "nationality": "in",
        "desc": "纱丽、库尔塔、谢尔瓦尼，金饰与图腾，宗教感浓重",
        "cn": "印度次大陆风情，纱丽绕身，金饰繁复，色彩浓烈，宗教与神话气息",
        "tags": ["india"],
        "pools": {
            "style": ["india"], "role": ["priest", "noble", "dancer", "merchant"],
            "top": ["sari", "kurta", "sherwani", "lehenga"],
            "outer": ["shawl", "none"],
            "bottom": ["dhoti", "longSk", "haremPants"],
            "shoes": ["mojari", "barefoot", "sandal"],
            "hairstyle": ["longStr", "braid", "turbanWrap", "longWave", "topBun"],
            "hat": ["turban", "veil", "none", "circlet"],
            "neckwear": ["bibNecklace", "beads", "necklace"],
            "earring": ["hoop", "noseRing", "drop"],
            "belt": ["waistChain", "none"],
            "tattoo": ["sacred", "none", "arm"],
            "marks": ["beauty", "mkNone", "blushMark"],
        },
        "colors": ["orange", "gold", "crimson", "magenta", "jade", "purple", "red"],
    },
    {
        "id": "arabia", "name": "中东风情", "nationality": "ar",
        "desc": "阿巴雅长袍、缠头巾、面纱，沙漠与香料",
        "cn": "中东阿拉伯风情，长袍垂地，头巾缠绕，面纱半掩，金色与沙色为主",
        "tags": ["arabia"],
        "pools": {
            "style": ["arabia"], "role": ["merchant", "noble", "priest", "assassin"],
            "top": ["abaya", "thobe", "kaftan", "hijabTop"],
            "outer": ["shawl", "cape", "none"],
            "bottom": ["haremPants", "longSk", "wideLeg"],
            "shoes": ["mojari", "sandal", "barefoot"],
            "hairstyle": ["turbanWrap", "longStr", "braid", "longWave"],
            "hat": ["turban", "veil", "none"],
            "neckwear": ["bibNecklace", "necklace", "beads"],
            "earring": ["hoop", "drop"],
            "belt": ["waistChain", "sash", "none"],
            "prop": ["lantern", "none", "fan", "dagger"],
        },
        "colors": ["white", "cream", "gold", "beige", "brown", "navy", "black"],
    },
    {
        "id": "western", "name": "美国西部", "nationality": "us",
        "desc": "牛仔帽、格纹衬衫、皮护腿、左轮与套索",
        "cn": "美国西部拓荒时代，牛仔装扮，皮革与风沙，粗粝硬派",
        "tags": ["western", "outdoor"],
        "pools": {
            "style": ["western"], "role": ["cowboy", "hunter", "pirate", "detective"],
            "top": ["flannel", "denimShirt", "peasantBlouse", "denimShirt"],
            "outer": ["duster", "denimJ", "poncho", "none"],
            "bottom": ["jeans", "chaps", "cargo"],
            "shoes": ["cowboyBoot", "boots"],
            "socks": ["crew", "none"],
            "hairstyle": ["messy", "mullet", "longStr", "braid", "crop", "lowPony"],
            "hat": ["cowboy", "sombrero", "bandana", "none"],
            "belt": ["buckle", "leather"],
            "neckwear": ["neckerchief", "none", "dogTag"],
            "prop": ["revolver", "whip", "bow", "none"],
            "skin": ["wheat", "tan", "bronze", "fair"],
        },
        "colors": ["brown", "khaki", "navy", "maroon", "black", "cream", "olive"],
    },
    {
        "id": "usa_modern", "name": "美式都市", "nationality": "us",
        "desc": "棒球夹克、连帽卫衣、牛仔裤与球鞋，街头与校园",
        "cn": "美国现代都市街头，棒球夹克与连帽卫衣，牛仔裤配球鞋，随性利落",
        "tags": ["modern", "street", "sport"],
        "pools": {
            "role": ["student", "athlete", "office", "artist", "detective", "idol"],
            "top": ["tshirt", "hoodie", "denimShirt", "baseballJersey", "jersey", "tracksuit",
                    "flannel", "polo", "sportswear", "shirt", "cropTop"],
            "outer": ["denimJ", "bomber", "puffer", "cardigan", "blazer", "none"],
            "bottom": ["jeans", "slimJean", "cargo", "jogger", "sweatp", "shorts", "leggings"],
            "shoes": ["sneaker", "canvas", "boots", "loafer"],
            "socks": ["crew", "ankle", "none"],
            "hairstyle": ["midPart", "sidePart", "buzz", "messy", "ponytail", "wavyLob",
                          "bob", "undercut", "curtain", "mullet"],
            "hat": ["cap", "beanie", "bucket", "bandana", "none"],
            "neckwear": ["dogTag", "necklace", "choker", "scarf", "none"],
            "gloves": ["wrist", "fingerless", "none"],
            "prop": ["phone", "coffee", "ball", "guitar", "none"],
            "skin": ["fair", "wheat", "tan", "bronze", "brown", "ebony"],
            "build": ["slim", "fit", "athletic", "muscular", "soft", "chubby"],
        },
        "colors": ["navy", "dGray", "white", "red", "skyBlue", "olive", "khaki", "black", "beige"],
    },
    {
        "id": "warcraft", "name": "魔兽魔幻", "nationality": "gb",
        "desc": "板甲锁甲、兽人战纹、法袍与萨满披挂",
        "cn": "欧美魔幻史诗风格，厚重板甲与兽皮，战纹与图腾，史诗感强烈",
        "tags": ["warcraft", "fantasy", "military"],
        "pools": {
            "style": ["warcraft"], "role": ["knight", "shaman", "mage", "guard", "soldier"],
            "top": ["plate", "chainmail", "leatherArmor", "mageRobe", "shamanVest", "tabard"],
            "outer": ["cape", "cloak", "furCoat", "none"],
            "bottom": ["cargo", "wideLeg", "leatherPants"],
            "shoes": ["warBoots", "spaceB", "boots"],
            "gloves": ["gauntlet", "glove", "none"],
            "hairstyle": ["dreads", "mohawk", "bald", "braid", "longStr", "buzz", "mullet"],
            "hat": ["horned", "helmet", "hood", "none"],
            "tattoo": ["warPaint", "tribal", "rune", "none"],
            "neckwear": ["beads", "amulet", "none"],
            "belt": ["leather", "ropeBelt", "buckle"],
            "prop": ["axe", "sword", "staff", "trident", "spear", "none"],
            "build": ["muscular", "heavy", "athletic"],
        },
        "colors": ["brown", "dGray", "maroon", "olive", "gold", "black", "red"],
    },
    {
        "id": "gothic", "name": "哥特吸血鬼", "nationality": "gb",
        "desc": "维多利亚礼服、蕾丝束腰、苍白与血色",
        "cn": "哥特维多利亚风格，蕾丝与束腰，苍白肤色，暗红与纯黑，阴郁华丽",
        "tags": ["gothic", "vintage", "elegant"],
        "pools": {
            "style": ["gothic"], "role": ["noble", "artist", "assassin", "detective"],
            "top": ["victorian", "corsetTop", "rococo", "suit"],
            "outer": ["steampunkCoat2", "furCoat", "cape", "none"],
            "bottom": ["longSk", "fishSk", "suitP"],
            "shoes": ["stiletto", "longBoot", "brogue", "heel"],
            "gloves": ["laceGlove", "glove", "none"],
            "hairstyle": ["longWave", "hime", "wavyLob", "bunNy", "longStr"],
            "hat": ["topHat", "veil", "none", "circlet"],
            "marks": ["tearMark", "maskHalf", "mkNone", "beauty"],
            "neckwear": ["cravat", "choker", "stole", "none"],
            "belt": ["doubleStrap", "leather", "none"],
            "prop": ["scythe", "umbrella", "cane", "none"],
            "skin": ["porcelain", "ivory", "fair"],
        },
        "colors": ["black", "crimson", "purple", "maroon", "white", "dGray"],
    },
    {
        "id": "cyberpunk", "name": "赛博朋克", "nationality": "jp",
        "desc": "义体改造、机能服、霓虹发光纹路",
        "cn": "赛博朋克未来都市，义体改造，机能绑带，霓虹发光纹路，冷硬科技感",
        "tags": ["cyberpunk", "scifi", "street"],
        "pools": {
            "style": ["cyberpunk"], "role": ["cyber", "assassin", "pilot", "cyber"],
            "top": ["techwear", "bodysuit", "compression", "leatherTop", "mechSuit"],
            "outer": ["tacticalCoat", "bomber", "leather", "none"],
            "bottom": ["leatherPants", "cargo", "jogger"],
            "shoes": ["mechBoot", "spaceB", "sneaker"],
            "gloves": ["fingerless", "glove", "none"],
            "hairstyle": ["undercut", "mohawk", "shavedSide", "buzz", "bob", "wolfCut"],
            "hat": ["visor", "helmet", "none", "headband"],
            "glasses": ["visor", "goggles", "shades", "none"],
            "tattoo": ["rune", "arm", "sleeve", "none"],
            "bodyMark": ["mechArm", "bmNone", "scarBody"],
            "neckwear": ["choker", "dogTag", "none"],
            "prop": ["blaster", "phone", "none"],
        },
        "colors": ["black", "indigo", "magenta", "teal", "dGray", "violet", "skyBlue"],
    },
    {
        "id": "steampunk", "name": "蒸汽朋克", "nationality": "gb",
        "desc": "黄铜齿轮、高领大衣、护目镜与皮质束具",
        "cn": "蒸汽朋克维多利亚工业风，黄铜齿轮，皮革高领，护目镜，蒸汽与齿轮",
        "tags": ["steampunk", "vintage"],
        "pools": {
            "style": ["steampunk"], "role": ["explorer", "artist", "detective", "doctor"],
            "top": ["steampunkCoat", "shirt", "leatherTop", "corsetTop"],
            "outer": ["steampunkCoat2", "trench", "furCoat"],
            "bottom": ["suitP", "wideLeg", "leatherPants"],
            "shoes": ["brogue", "longBoot", "leatherS"],
            "glasses": ["goggles", "monocle", "none"],
            "hat": ["topHat", "beret", "none"],
            "gloves": ["glove", "laceGlove"],
            "belt": ["doubleStrap", "leather", "buckle"],
            "prop": ["cane", "umbrella", "none"],
        },
        "colors": ["brown", "khaki", "gold", "maroon", "dGray", "cream", "black"],
    },
    {
        "id": "military", "name": "军事战术", "nationality": "de",
        "desc": "迷彩作战服、战术背心、军牌与长枪",
        "cn": "现代军事战术风格，迷彩作战服，战术挂具，硬朗利落",
        "tags": ["military", "outdoor"],
        "pools": {
            "style": ["military"], "role": ["soldier", "guard", "pilot", "hunter"],
            "top": ["camoJacket", "tacticalVest", "dressUniform", "compression"],
            "outer": ["tacticalCoat", "bomber", "none"],
            "bottom": ["cargo", "jogger", "sweatp"],
            "shoes": ["spaceB", "boots"],
            "hairstyle": ["buzz", "crop", "undercut", "lowPony", "bald"],
            "hat": ["militaryCap", "helmet", "bandana", "none"],
            "gloves": ["fingerless", "glove", "wrist"],
            "neckwear": ["dogTag", "none"],
            "belt": ["leather", "buckle"],
            "prop": ["rifle", "dagger", "none"],
        },
        "colors": ["olive", "khaki", "dGray", "black", "brown"],
    },
    {
        "id": "school", "name": "校园", "nationality": "jp",
        "desc": "水手服、学院制服、运动校服与书包",
        "cn": "校园青春风格，制服与书包，阳光清爽",
        "tags": ["school", "cute", "casual"],
        "pools": {
            "style": ["school"], "role": ["student", "teacher"],
            "top": ["sailor", "jkBlazer", "shirt", "uniform", "jersey"],
            "outer": ["cardigan", "blazer", "bomber", "none"],
            "bottom": ["pleatSk", "kneeSk", "suitP", "shorts", "jogger"],
            "shoes": ["sneaker", "canvas", "loafer"],
            "socks": ["crew", "kneeS", "stripeSock"],
            "hairstyle": ["twintail", "ponytail", "bob", "sidePony", "longStr", "curtain"],
            "hat": ["none", "cap", "headband"],
            "backpack": ["school", "daypack", "messenger"],
            "prop": ["book", "phone", "none"],
            "age": ["12", "13", "15", "16", "17", "18"],
        },
        "colors": ["white", "navy", "black", "skyBlue", "cream", "red"],
    },
    {
        "id": "office", "name": "都市职场", "nationality": "cn",
        "desc": "西装、衬衫、包臀裙，干练都市感",
        "cn": "都市职场风格，剪裁合体的西装与衬衫，干练利落",
        "tags": ["formal", "modern", "elegant"],
        "pools": {
            "style": ["formal"], "role": ["office", "doctor", "teacher", "detective"],
            "top": ["suit", "shirt", "blouse", "knit", "turtleneck"],
            "outer": ["blazer", "trench", "coat2", "none"],
            "bottom": ["suitP", "wideLeg", "kneeSk", "longSk"],
            "shoes": ["heel", "loafer", "leatherS", "stiletto"],
            "hairstyle": ["lowPony", "bob", "wavyLob", "topBun", "wetslick", "longStr"],
            "hat": ["none"],
            "glasses": ["square", "half", "round", "none"],
            "neckwear": ["tie", "necklace", "none"],
            "belt": ["leather", "none"],
            "backpack": ["handbag", "messenger", "none"],
            "prop": ["phone", "coffee", "book", "none"],
            "age": ["22", "24", "26", "28", "30", "33", "36"],
        },
        "colors": ["black", "dGray", "navy", "white", "cream", "beige"],
    },
    {
        "id": "modern", "name": "现代日常", "nationality": "cn",
        "desc": "T恤、牛仔、卫衣、运动鞋，最普通的日常",
        "cn": "现代都市日常风格，休闲随性，生活气息",
        "tags": ["casual", "modern"],
        "pools": {
            "style": ["casual"], "role": ["student", "office", "artist", "chef", "nurse", "maid"],
            "top": ["tshirt", "hoodie", "knit", "polo", "cropTop", "shirt", "sweater", "tank"],
            "outer": ["denimJ", "cardigan", "bomber", "puffer", "none"],
            "bottom": ["jeans", "wideLeg", "shorts", "jogger", "leggings", "sweatp"],
            "shoes": ["sneaker", "canvas", "sandal", "slipper"],
            "socks": ["ankle", "crew", "none"],
            "hairstyle": ["ponytail", "bob", "messy", "crop", "longStr", "curly", "topBun"],
            "hat": ["cap", "beanie", "none"],
            "backpack": ["daypack", "messenger", "school", "none"],
            "prop": ["phone", "coffee", "none", "book"],
        },
        "colors": ["white", "black", "dGray", "skyBlue", "beige", "navy", "pink"],
    },
    {
        "id": "beach", "name": "海滩度假", "nationality": "br",
        "desc": "吊带裙、短裤、凉鞋、草帽，阳光与海",
        "cn": "海滩度假风格，轻薄面料，阳光感，清爽明亮",
        "tags": ["beach", "casual", "cute"],
        "pools": {
            "style": ["beach"], "role": ["idol", "athlete", "artist", "student"],
            "top": ["sundress", "tank", "cropTop", "dress"],
            "outer": ["none", "cardigan", "poncho"],
            "bottom": ["shorts", "hotPants", "longSk", "aSk"],
            "shoes": ["sandal", "barefoot", "canvas"],
            "hairstyle": ["longWave", "ponytail", "braid", "longStr", "buns"],
            "hat": ["straw", "none", "flower"],
            "neckwear": ["necklace", "none"],
            "prop": ["none", "flowerP", "ball"],
            "skin": ["wheat", "tan", "bronze", "fair"],
        },
        "colors": ["white", "skyBlue", "cream", "pink", "orange", "lakeBlue"],
    },
    {
        "id": "norse", "name": "北欧维京", "nationality": "se",
        "desc": "皮毛、锁甲、战斧与符文，寒带硬派",
        "cn": "北欧维京风格，粗糙皮毛与皮革，符文与战斧，寒冷粗粝",
        "tags": ["norse", "fantasy", "outdoor"],
        "pools": {
            "style": ["norse"], "role": ["shaman", "knight", "hunter", "pirate"],
            "top": ["leatherArmor", "chainmail", "peasantBlouse", "shamanVest"],
            "outer": ["furCoat", "cloak", "cape", "none"],
            "bottom": ["cargo", "wideLeg", "leatherPants"],
            "shoes": ["warBoots", "boots"],
            "gloves": ["gauntlet", "glove", "none"],
            "hairstyle": ["braid", "dreads", "longStr", "buzz", "mohawk", "receding"],
            "facialHair": ["full", "long", "mustache", "none"],
            "hat": ["horned", "helmet", "hood", "none"],
            "tattoo": ["tribal", "warPaint", "rune", "none"],
            "neckwear": ["amulet", "beads", "none"],
            "prop": ["axe", "trident", "spear", "none"],
            "build": ["muscular", "athletic", "heavy"],
            "skin": ["fair", "ivory", "wheat", "porcelain"],
        },
        "colors": ["brown", "dGray", "olive", "maroon", "black", "cream"],
    },
    {
        "id": "greek", "name": "古希腊", "nationality": "gr",
        "desc": "托加长袍、绑带罗马鞋、桂冠与竖琴",
        "cn": "古希腊古典风格，垂坠长袍，绑带鞋履，大理石与橄榄枝",
        "tags": ["greek", "vintage", "fantasy"],
        "pools": {
            "style": ["vintage"], "role": ["noble", "priest", "artist", "guard"],
            "top": ["toga", "dress", "gown", "ruqun"],
            "outer": ["cape", "shawl", "none"],
            "bottom": ["longSk", "wideLeg"],
            "shoes": ["gladiator", "sandal", "barefoot"],
            "hairstyle": ["longWave", "braid", "bunNy", "longStr", "topBun"],
            "hat": ["circlet", "flower", "none"],
            "neckwear": ["necklace", "none"],
            "prop": ["spear", "none", "flowerP", "scroll"],
        },
        "colors": ["white", "cream", "gold", "skyBlue", "beige"],
    },
    {
        "id": "africa", "name": "非洲部落", "nationality": "ng",
        "desc": "赭红裹布、骨牙珠串、战纹与图腾",
        "cn": "非洲部落风格，赭红裹布，骨牙珠串，图腾战纹，原始粗犷",
        "tags": ["africa", "outdoor"],
        "pools": {
            "style": ["outdoor"], "role": ["shaman", "hunter", "guard", "dancer"],
            "top": ["tribalWrap", "shamanVest", "leatherArmor"],
            "outer": ["none", "cloak"],
            "bottom": ["loincloth", "haremPants", "shorts"],
            "shoes": ["barefoot", "sandal"],
            "hairstyle": ["afro", "dreads", "boxerBraid", "buzz", "bald", "twintail"],
            "hat": ["feather", "bandana", "none"],
            "tattoo": ["tribal", "warPaint", "sacred", "none"],
            "neckwear": ["beads", "amulet", "none"],
            "earring": ["hoop", "noseRing", "none"],
            "belt": ["ropeBelt", "none"],
            "prop": ["spear", "dagger", "none"],
            "skin": ["brown", "ebony", "bronze", "tan"],
        },
        "colors": ["orange", "red", "brown", "maroon", "gold", "khaki"],
    },
    {
        "id": "aztec", "name": "中美洲古文明", "nationality": "mx",
        "desc": "几何披挂、羽饰头冠、金饰与石雕感",
        "cn": "中美洲古文明风格，几何纹样披挂，羽毛头冠，黄金饰件，神秘祭祀感",
        "tags": ["aztec", "vintage", "fantasy"],
        "pools": {
            "style": ["vintage"], "role": ["priest", "guard", "noble", "shaman"],
            "top": ["aztecWrap", "tribalWrap", "leatherArmor"],
            "outer": ["cape", "none"],
            "bottom": ["loincloth", "longSk"],
            "shoes": ["barefoot", "sandal"],
            "hairstyle": ["longStr", "braid", "topBun", "buzz"],
            "hat": ["feather", "circlet", "none"],
            "tattoo": ["tribal", "warPaint", "none"],
            "neckwear": ["beads", "bibNecklace", "none"],
            "earring": ["hoop", "drop", "none"],
            "prop": ["spear", "dagger", "none"],
            "skin": ["bronze", "tan", "brown", "wheat"],
        },
        "colors": ["orange", "jade", "gold", "red", "brown", "black"],
    },
]


# ===================== 题材 × 图案冲突表 =====================
# 之前仙侠道袍会抽到「豹纹」、印度纱丽抽到「迷彩」，非常出戏。
# pools 是「只在这些里抽」，这里补的是「这些绝对不要」。
# 单独放在一张表里而不是逐条写进 20 段主题，是为了少改大 JSON；
# build() 会把它合并进每个 theme 的 avoid 字段，落盘后仍可在后台定义管理里改。
AVOID_PATTERN = {
    "wuxia":     ["leopard", "camo", "logo", "dot", "tieDye", "check", "geo"],
    "hanfu":     ["leopard", "camo", "logo", "dot", "tieDye", "check"],
    "japan":     ["leopard", "camo", "logo", "tieDye"],
    "korea":     ["leopard", "camo", "logo"],
    "india":     ["leopard", "camo", "logo", "check"],
    "arabia":    ["leopard", "camo", "logo", "dot"],
    "western":   ["cloud", "dragon", "phoenix", "bamboo", "plum", "paisley"],
    "warcraft":  ["leopard", "logo", "dot"],
    "gothic":    ["leopard", "camo", "dot", "tieDye"],
    "norse":     ["leopard", "camo", "logo", "dot"],
    "greek":     ["leopard", "camo", "logo", "dot"],
    "aztec":     ["leopard", "camo", "logo", "dot", "check"],
    "africa":    ["logo", "dot", "check"],
    "steampunk": ["leopard", "camo", "dot"],
    "cyberpunk": ["leopard", "floral", "paisley", "dot", "plum", "bamboo", "cloud",
                  "tieDye", "dragon", "phoenix", "embroidery", "check"],
    "military":  ["leopard", "dot", "floral", "tieDye"],
    "school":    ["leopard", "camo"],
    "office":    ["camo", "leopard"],
}


def with_avoid(themes):
    """把图案冲突表合并进每个主题的 avoid 字段。"""
    out = []
    for t in themes:
        t = dict(t)
        avoid = {k: list(v) for k, v in (t.get("avoid") or {}).items()}
        extra = AVOID_PATTERN.get(t["id"])
        if extra:
            avoid["topPattern"] = sorted(set(avoid.get("topPattern", [])) | set(extra))
        if avoid:
            t["avoid"] = avoid
        out.append(t)
    return out


# ===================== 题材缺失的候选池补齐 =====================
# 有些题材没写 prop / backpack / bottom 的池，就会从全量里抽，
# 于是印度教祭司拎着「皮质手提包」、魔兽法师穿着「多袋工装裤」。
# 这里按题材补上合理的小池（patch 优先级高于原 pools）。
POOL_PATCH = {
    "wuxia": {
        "backpack": ["swordSheath", "satchel", "basket", "none"],
        "bottom": ["ruqunSkirt", "mamian", "longSk", "wideLeg", "haremPants"],
    },
    "hanfu": {
        "backpack": ["swordSheath", "satchel", "basket", "none"],
        "bottom": ["ruqunSkirt", "mamian", "longSk", "pleatSk", "wideLeg"],
    },
    "japan": {
        "backpack": ["satchel", "basket", "quiver", "none"],
        "bottom": ["hakama", "longSk", "kneeSk", "wideLeg"],
    },
    "korea": {
        "backpack": ["satchel", "basket", "none"],
        "bottom": ["longSk", "kneeSk", "wideLeg", "pleatSk"],
    },
    "india": {
        "backpack": ["satchel", "basket", "none"],
        "prop": ["teacup", "lantern", "fan", "none"],
        "bottom": ["dhoti", "longSk", "haremPants"],
    },
    "arabia": {
        "backpack": ["satchel", "basket", "none"],
        "prop": ["lantern", "fan", "scroll", "none"],
        "bottom": ["haremPants", "longSk", "wideLeg", "dhoti"],
    },
    "western": {
        "backpack": ["quiver", "canteen", "satchel", "none"],
        "bottom": ["jeans", "chaps", "leatherPants", "longSk"],
    },
    "warcraft": {
        "backpack": ["swordSheath", "quiver", "satchel", "none"],
        "bottom": ["leatherPants", "wideLeg", "loincloth", "longSk"],
    },
    "norse": {
        "backpack": ["quiver", "swordSheath", "canteen", "none"],
        "bottom": ["leatherPants", "wideLeg", "longSk", "kilt"],
    },
    "greek": {
        "backpack": ["satchel", "basket", "none"],
        "bottom": ["longSk", "loincloth", "wideLeg", "pleatSk"],
    },
    "gothic": {
        "backpack": ["satchel", "swordSheath", "none"],
        "bottom": ["longSk", "leatherPants", "fishSk", "pleatSk"],
    },
    "aztec": {
        "backpack": ["basket", "quiver", "none"],
        "bottom": ["loincloth", "longSk"],
    },
    "africa": {
        "backpack": ["basket", "quiver", "none"],
        "bottom": ["loincloth", "longSk", "wideLeg"],
    },
    "steampunk": {
        "backpack": ["satchel", "canteen", "messenger", "none"],
        "bottom": ["leatherPants", "cargo", "longSk", "wideLeg"],
    },
    "military": {
        "backpack": ["canteen", "daypack", "satchel", "none"],
        "bottom": ["cargo", "jogger", "leatherPants"],
    },
    "cyberpunk": {
        "backpack": ["jetpack", "messenger", "daypack", "none"],
        "bottom": ["leatherPants", "cargo", "jogger", "leggings"],
    },
    "school": {
        "backpack": ["school", "daypack", "none"],
        "bottom": ["pleatSk", "kneeSk", "jeans", "shorts"],
    },
    "office": {
        "backpack": ["handbag", "messenger", "satchel", "none"],
        "bottom": ["suitP", "kneeSk", "longSk", "aSk"],
    },
    "beach": {
        "backpack": ["basket", "satchel", "none"],
        "bottom": ["shorts", "hotPants", "longSk", "skort"],
    },
    "modern": {
        "backpack": ["daypack", "messenger", "handbag", "none"],
    },
}


def apply_rules(themes):
    """合并图案黑名单 + 补齐缺失候选池。"""
    base = with_avoid(themes)
    out = []
    for t in base:
        t = dict(t)
        patch = POOL_PATCH.get(t["id"]) or {}
        if patch:
            pools = dict(t.get("pools") or {})
            pools.update({k: list(v) for k, v in patch.items()})
            t["pools"] = pools
        out.append(t)
    return out
