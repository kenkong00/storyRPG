# -*- coding: utf-8 -*-
"""
外观维度种子数据 —— 穿着打扮（大幅扩充：每件衣服都带具体材质 / 形制 / 纹样描述）

旧版只有「T恤 / 卫衣 / 连衣裙」这类通用名词，模型只能瞎猜。这里每个条目都给
一段可读的中文形制描述，同时带 tags（风格）与 culture（文化圈），供定向随机使用。
"""

from .seed_core import O

CLOTH_COLORS = ["white", "cream", "lGray", "gray", "dGray", "black", "navy", "skyBlue", "lakeBlue", "teal",
                "green", "olive", "khaki", "brown", "maroon", "red", "orange", "gold", "pink", "purple",
                "violet", "magenta", "jade", "indigo", "crimson", "beige"]

TOP_OPTIONS = [
    # ---- 现代日常 ----
    O("tshirt", "T恤", "纯棉圆领短袖衫", "cotton crew-neck t-shirt", ["casual", "sport", "street"]),
    O("vtshirt", "V领T恤", "V领修身针织衫", "v-neck fitted t-shirt", ["casual"]),
    O("cropTop", "短款上衣", "露出腰腹的短款紧身上衣", "cropped fitted top", ["cute", "street"]),
    O("tank", "背心", "细肩带背心", "thin-strap tank top", ["sport", "beach", "casual"]),
    O("turtleneck", "高领衫", "贴身薄款高领衫", "slim turtleneck top", ["formal", "elegant"]),
    O("shirt", "衬衫", "白色棉质翻领衬衫", "white cotton button-up shirt", ["formal", "school", "casual"]),
    O("blouse", "女式衬衫", "带荷叶边的雪纺女式衬衫", "ruffled chiffon blouse", ["formal", "elegant"]),
    O("knit", "针织衫", "细针织圆领衫", "fine-knit sweater", ["casual", "vintage"]),
    O("sweater", "粗针织毛衣", "厚实粗针织毛衣", "chunky knit sweater", ["casual", "vintage"]),
    O("hoodie", "卫衣", "宽松连帽卫衣，前胸口袋", "loose hoodie with kangaroo pocket", ["casual", "street"]),
    O("polo", "Polo衫", "翻领Polo衫", "polo shirt", ["casual", "sport", "formal"]),
    O("suit", "西装套装", "剪裁合体的西装上衣", "tailored suit jacket", ["formal"]),
    O("jersey", "球衣", "带号码的球队球衣", "numbered sports jersey", ["sport"]),
    O("sportswear", "运动服", "速干拼接运动上衣", "technical sports top", ["sport"]),
    O("compression", "紧身衣", "贴身压缩运动衣", "tight compression top", ["sport", "cyberpunk"]),
    O("tracksuit", "运动套装", "带条纹的运动外套", "striped tracksuit jacket", ["sport", "street"]),
    O("cardiganTop", "开襟衫", "慵懒宽松开襟毛衫", "loose open cardigan", ["casual", "vintage"]),
    O("vest", "马甲", "多口袋机能马甲", "utility vest with pockets", ["outdoor", "street"]),
    O("denimShirt", "牛仔衬衫", "水洗牛仔衬衫", "washed denim shirt", ["casual", "street", "western"]),
    O("flannel", "格纹衬衫", "红黑格纹法兰绒衬衫", "red-and-black plaid flannel shirt", ["western", "outdoor", "casual"]),
    O("baseballJersey", "棒球服", "棒球夹克式上衣", "varsity baseball jacket", ["street", "sport"]),
    O("leatherTop", "皮质上衣", "贴身黑色皮衣", "tight black leather top", ["punk", "street"]),
    O("corsetTop", "束腰上衣", "带鱼骨的束腰胸衣", "boned corset top", ["gothic", "elegant"]),
    O("bodysuit", "连体紧身衣", "一体式贴身高领连体衣", "form-fitting bodysuit", ["scifi", "cyberpunk"]),

    # ---- 中式 / 国风 ----
    O("ruqun", "交领襦裙", "交领右衽窄袖短襦配齐腰褶裙，系绸带", "crossed-collar ruqun with pleated skirt",
      ["china", "hanfu"]),
    O("qixiong", "齐胸襦裙", "齐胸系带的薄纱襦裙，披帛垂落", "chest-high ruqun with flowing silk scarf",
      ["china", "hanfu", "elegant"]),
    O("beizi", "宋制褙子", "直领对襟褙子，两侧开衩，内衬抹胸", "Song-style beizi jacket with side slits",
      ["china", "hanfu", "elegant"]),
    O("roundCollar", "圆领袍", "圆领窄袖长袍，腰间革带", "round-collar robe with leather belt",
      ["china", "hanfu"]),
    O("quju", "曲裾深衣", "绕襟曲裾深衣，衣缘织锦", "curved-hem shenyi robe with brocade trim",
      ["china", "hanfu"]),
    O("daopao", "道袍", "宽袖道袍，交领系带，飘逸出尘", "wide-sleeved taoist robe", ["china", "hanfu", "fantasy"]),
    O("zhiduo", "直裰", "素色直裰长衫，交领大袖", "plain straight-hem long robe", ["china", "hanfu"]),
    O("xianxiaRobe", "仙侠长袍", "月白广袖仙袍，衣袂飘飞，隐有云纹", "flowing pale immortal robe with cloud patterns",
      ["china", "wuxia", "fantasy"]),
    O("qipao", "旗袍", "立领盘扣修身旗袍，侧开衩", "high-collar qipao with side slit", ["china", "elegant"]),
    O("cheongsamMod", "改良旗袍", "改良短款旗袍，蕾丝拼接", "modern short qipao with lace panel", ["china", "elegant", "cute"]),
    O("zhongshan", "中山装", "立领四袋中山装", "mandarin-collar zhongshan suit", ["china", "formal"]),
    O("magua", "马褂", "对襟盘扣短马褂", "frog-button short magua jacket", ["china", "vintage"]),
    O("hanfuTop", "汉服袄", "夹棉交领短袄，袖口镶边", "padded crossed-collar hanfu jacket", ["china", "hanfu"]),
    O("wuxiaWrap", "劲装", "紧身束袖劲装，便于行动", "tight wrapped martial-arts outfit", ["china", "wuxia", "outdoor"]),

    # ---- 日式 ----
    O("kimono", "和服", "振袖和服，腰系宽幅带", "furisode kimono with wide obi sash", ["japan", "elegant"]),
    O("yukata", "浴衣", "薄棉浴衣，夏日纹样", "cotton yukata with summer patterns", ["japan", "casual"]),
    O("haori", "羽织", "羽织外套，内衬纹样", "haori jacket over inner robe", ["japan", "elegant"]),
    O("sailor", "水手服", "水手领短上衣，深色领巾", "sailor-collar uniform top with neckerchief", ["japan", "school", "cute"]),
    O("jkBlazer", "JK西装", "格纹学院制服西装配蝴蝶结", "plaid JK blazer with ribbon tie", ["japan", "school", "elegant"]),
    O("mikoTop", "巫女服", "白色小袖上衣，红色绯袴", "white miko kosode with red hakama", ["japan", "fantasy"]),
    O("samuraiRobe", "武士羽织袴", "深色武士羽织配宽袴，家纹点缀", "dark samurai haori with hakama and family crest",
      ["japan", "fantasy"]),

    # ---- 韩式 ----
    O("hanbokTop", "韩服赤古里", "短款赤古里上衣，胸系长飘带", "short jeogori top with long goreum ribbon",
      ["korea", "elegant"]),
    O("koreanSuit", "韩式修身西装", "收腰修身西装外套", "slim-fit Korean blazer", ["korea", "formal", "elegant"]),

    # ---- 印度 / 中东 ----
    O("sari", "纱丽", "六米纱丽绕身，配短款露脐上衣", "draped sari with cropped choli blouse",
      ["india", "elegant"]),
    O("kurta", "库尔塔", "长款库尔塔长衫，侧开衩", "long side-slit kurta tunic", ["india", "casual"]),
    O("sherwani", "谢尔瓦尼", "镶金刺绣的谢尔瓦尼礼服", "gold-embroidered sherwani coat", ["india", "formal"]),
    O("lehenga", "蕾哈", "绣花蕾哈长裙配短上衣", "embroidered lehenga with choli", ["india", "elegant"]),
    O("abaya", "阿巴雅", "黑色长袍，宽袖垂地", "black abaya robe with wide sleeves", ["arabia", "elegant"]),
    O("thobe", "阿拉伯长袍", "白色及踝长袍", "white ankle-length thobe", ["arabia", "formal"]),
    O("kaftan", "卡夫坦", "印花宽松卡夫坦长袍", "patterned loose kaftan", ["arabia", "casual"]),
    O("hijabTop", "头巾长衣", "及膝长衣配同色头巾", "knee-length tunic with matching hijab", ["arabia", "elegant"]),

    # ---- 西方历史 / 奇幻 ----
    O("victorian", "维多利亚礼服", "高领蕾丝维多利亚长裙，束腰", "high-neck lace victorian gown", ["gothic", "vintage", "elegant"]),
    O("rococo", "洛可可裙", "蓬松洛可可裙，繁复蕾丝褶边", "voluminous rococo gown with lace frills",
      ["vintage", "elegant", "fantasy"]),
    O("peasantBlouse", "农家衬衣", "亚麻束口袖衬衣配紧身胸衣", "linen peasant blouse with bodice", ["vintage", "western"]),
    O("chainmail", "锁甲", "环环相扣的金属锁甲", "interlocking metal chainmail", ["fantasy", "military", "warcraft"]),
    O("plate", "板甲", "全身板甲，肩甲与护颈完整", "full plate armor with pauldrons and gorget",
      ["fantasy", "military", "warcraft"]),
    O("leatherArmor", "皮甲", "层叠硬皮甲，铆钉加固", "studded layered leather armor", ["fantasy", "warcraft", "outdoor"]),
    O("mageRobe", "法师长袍", "深色法师长袍，绣满星象符文", "dark mage robe embroidered with arcane runes",
      ["fantasy", "warcraft"]),
    O("shamanVest", "萨满披挂", "兽骨与羽毛编织的萨满披挂", "shamanic vest of bone and feather", ["warcraft", "norse"]),
    O("monkRobe", "僧袍", "灰褐粗布僧袍", "coarse grey-brown monk robe", ["china", "fantasy"]),
    O("tabard", "罩袍", "绣有家徽的骑士罩袍", "heraldic knight's tabard", ["fantasy", "military"]),

    # ---- 科幻 / 赛博 / 军装 ----
    O("spacesuit", "宇航服", "厚重宇航服，胸前控制面板", "bulky spacesuit with chest control panel", ["scifi"]),
    O("mechSuit", "机甲驾驶服", "贴身机甲驾驶服，关节处机械外骨骼", "form-fitting mech pilot suit with exoskeleton joints",
      ["scifi", "cyberpunk"]),
    O("techwear", "机能服", "多层绑带机能外套，防水材质", "multi-strap technical shell jacket", ["cyberpunk", "street"]),
    O("tacticalVest", "战术背心", "挂满弹匣袋的战术背心", "tactical vest with magazine pouches", ["military", "outdoor"]),
    O("camoJacket", "迷彩服", "丛林迷彩作战服", "jungle camouflage combat shirt", ["military", "outdoor"]),
    O("dressUniform", "军礼服", "缀满勋章的军礼服", "medal-decorated dress uniform", ["military", "formal"]),
    O("labCoat", "白大褂", "及膝白大褂，内搭衬衫领带", "knee-length lab coat over shirt and tie", ["modern", "formal"]),
    O("nurseDress", "护士服", "浅粉色护士服配围裙", "pale pink nurse dress with apron", ["modern", "cute"]),
    O("maidDress", "女仆装", "荷叶边女仆装，白色围裙", "ruffled maid dress with white apron", ["cute"]),
    O("uniform", "制服", "制式短上衣，肩章袖章", "uniform jacket with epaulettes", ["formal", "school"]),
    O("steampunkCoat", "蒸汽朋克马甲", "黄铜齿轮装饰的马甲与背带", "brass-gear ornamented vest with suspenders",
      ["steampunk", "vintage"]),

    # ---- 裙装 / 礼服 ----
    O("dress", "连衣裙", "收腰伞摆连衣裙", "A-line dress", ["cute", "elegant"]),
    O("sundress", "吊带裙", "细肩带碎花吊带裙", "floral slip sundress", ["beach", "cute"]),
    O("gown", "晚礼服", "曳地长礼服，露背设计", "floor-length evening gown with open back", ["elegant", "formal"]),
    O("sweaterDress", "针织连衣裙", "宽松针织连衣裙", "loose knit sweater dress", ["casual", "cute"]),
    O("cheerUniform", "啦啦队服", "短款啦啦队套装", "cropped cheerleader uniform", ["sport", "cute"]),
    O("toga", "托加长袍", "单肩缠绕的托加长袍", "draped one-shoulder toga", ["vintage", "fantasy"]),
    O("aztecWrap", "中美洲披挂", "几何纹样披挂，羽饰镶边", "geometric-patterned wrap with feather trim", ["aztec"]),
    O("tribalWrap", "部落裹布", "赭红布条裹身，兽牙缀饰", "ochre cloth wrap with animal-tooth ornaments", ["africa"]),
]

TOP_PATTERN_OPTIONS = [
    O("plain", "纯色", "纯色无纹"), O("stripe", "横条", "横条纹"), O("vstripe", "竖条", "竖条纹"),
    O("check", "格纹", "格纹", tags=["western", "school", "casual", "vintage"]),
    O("dot", "波点", "波点", tags=["cute", "casual", "vintage"]),
    O("print", "印花", "印花图案", tags=["casual", "street", "beach"]),
    O("logo", "字母", "字母标语", tags=["street", "sport", "casual"]),
    O("camo", "迷彩", "迷彩", tags=["military"]),
    O("gradient", "渐变", "渐变色", tags=["cyberpunk", "scifi", "sport"]),
    O("floral", "碎花", "碎花", tags=["casual", "cute", "vintage"]),
    O("cloud", "云纹", "祥云暗纹", tags=["china", "hanfu"]),
    O("dragon", "龙纹", "盘龙纹样", tags=["china", "hanfu"]),
    O("phoenix", "凤纹", "凤羽纹样", tags=["china", "hanfu"]),
    O("bamboo", "竹纹", "墨竹纹", tags=["china", "hanfu", "japan"]),
    O("plum", "梅纹", "寒梅纹", tags=["china", "hanfu", "japan"]),
    O("paisley", "佩斯利", "佩斯利涡纹", tags=["india", "arabia", "vintage"]),
    O("geo", "几何", "几何拼色", tags=["modern", "scifi", "cyberpunk"]),
    O("leopard", "豹纹", "豹纹", tags=["street"]),
    O("tieDye", "扎染", "扎染晕色", tags=["casual", "street", "beach"]),
    O("embroidery", "刺绣", "重工刺绣", tags=["elegant", "china"]),
]

SLEEVE_OPTIONS = [
    O("none", "无袖", "无袖"), O("cap", "盖肩", "盖肩短袖"), O("short", "短袖", "短袖"),
    O("half", "中袖", "七分袖"), O("long", "长袖", "长袖"),
    O("wide", "广袖", "宽大广袖"), O("bell", "喇叭袖", "喇叭袖"), O("detached", "露肩袖", "露肩分体袖"),
]

OUTER_OPTIONS = [
    O("none", "无", "", ""),
    O("coat2", "长风衣", "长及小腿的风衣", "long trench coat", ["elegant", "vintage"]),
    O("trench", "战壕大衣", "双排扣战壕大衣", "double-breasted trench coat", ["formal", "military"]),
    O("denimJ", "牛仔外套", "水洗做旧牛仔外套", "washed denim jacket", ["casual", "street", "western"]),
    O("cardigan", "开衫", "宽松针织开衫", "loose knit cardigan", ["casual", "vintage"]),
    O("blazer", "西装外套", "修身西装外套", "slim blazer", ["formal"]),
    O("bomber", "飞行夹克", "军绿色飞行夹克", "olive bomber jacket", ["street", "military"]),
    O("puffer", "羽绒服", "厚重羽绒服", "puffy down jacket", ["outdoor", "casual"]),
    O("cape", "披风", "随风翻卷的披风", "billowing cape", ["fantasy", "warcraft"]),
    O("cloak", "斗篷", "带兜帽的长斗篷", "long hooded cloak", ["fantasy", "outdoor"]),
    O("furCoat", "毛领大衣", "带皮草领的大衣", "fur-collared coat", ["elegant", "outdoor"]),
    O("hanfuCoat", "大袖衫", "薄纱大袖外衫", "sheer wide-sleeve outer robe", ["china", "hanfu"]),
    O("pibo", "披帛", "缠绕臂间的长披帛", "long draped silk scarf", ["china", "hanfu", "elegant"]),
    O("haoriCoat", "羽织外套", "纹样羽织外套", "patterned haori", ["japan", "elegant"]),
    O("shawl", "披肩", "刺绣流苏披肩", "embroidered fringed shawl", ["india", "elegant"]),
    O("poncho", "斗篷衫", "厚重斗篷衫", "heavy poncho", ["western", "outdoor"]),
    O("duster", "牛仔长外套", "防尘长外套", "long duster coat", ["western"]),
    O("lab", "白大褂", "及膝白大褂", "knee-length lab coat", ["modern", "formal"]),
    O("apron", "围裙", "棉质工装围裙", "cotton work apron", ["casual", "modern"]),
    O("tacticalCoat", "战术外套", "多袋战术软壳", "multi-pocket tactical softshell", ["military", "cyberpunk"]),
    O("steampunkCoat2", "蒸汽朋克大衣", "高领皮质长大衣，黄铜扣件", "high-collar leather greatcoat with brass clasps",
      ["steampunk", "gothic"]),
]

BOTTOM_OPTIONS = [
    O("jeans", "牛仔裤", "直筒牛仔裤", "straight-leg jeans", ["casual", "street", "western"]),
    O("slimJean", "小脚牛仔", "修身小脚牛仔裤", "slim jeans", ["street", "casual"]),
    O("wideLeg", "阔腿裤", "垂坠阔腿裤", "wide-leg trousers", ["casual", "elegant"]),
    O("suitP", "西裤", "笔挺西裤", "tailored dress pants", ["formal"]),
    O("sweatp", "运动裤", "松紧运动裤", "sweatpants", ["sport", "casual"]),
    O("jogger", "束脚裤", "束脚工装裤", "jogger pants", ["sport", "street"]),
    O("cargo", "工装裤", "多袋工装裤", "cargo pants", ["outdoor", "street", "military"]),
    O("shorts", "短裤", "及膝短裤", "knee-length shorts", ["beach", "sport", "casual"]),
    O("hotPants", "超短裤", "极短的紧身热裤", "tight hot pants", ["cute", "street"]),
    O("baggySh", "垮裤", "低裆垮裤", "baggy low-crotch pants", ["street", "punk"]),
    O("capri", "七分裤", "七分休闲裤", "capri pants", ["casual"]),
    O("leggings", "打底裤", "紧身打底裤", "tight leggings", ["sport", "casual"]),
    O("leatherPants", "皮裤", "光亮紧身皮裤", "shiny tight leather pants", ["punk", "cyberpunk"]),
    O("miniSk", "迷你裙", "极短的百褶迷你裙", "short pleated mini skirt", ["cute", "punk"]),
    O("kneeSk", "及膝裙", "及膝伞摆裙", "knee-length A-line skirt", ["cute", "school"]),
    O("longSk", "长裙", "垂地长裙", "floor-length skirt", ["elegant", "fantasy"]),
    O("pleatSk", "百褶裙", "细密百褶裙", "fine pleated skirt", ["school", "cute"]),
    O("aSk", "A字裙", "散摆伞裙", "flared A-line skirt", ["cute", "elegant"]),
    O("fishSk", "鱼尾裙", "收膝鱼尾裙", "fishtail skirt", ["elegant", "fantasy"]),
    O("skort", "裙裤", "运动裙裤", "sports skort", ["sport", "casual"]),
    O("overall", "背带裤", "牛仔背带裤", "denim overalls", ["casual", "cute"]),
    O("hakama", "袴", "宽大褶袴", "wide pleated hakama", ["japan", "fantasy"]),
    O("mamian", "马面裙", "织金马面裙，前后裙门", "gold-woven mamian skirt", ["china", "hanfu", "elegant"]),
    O("ruqunSkirt", "褶裙", "细褶襦裙下裙", "finely pleated ruqun skirt", ["china", "hanfu"]),
    O("dhoti", "托蒂", "缠绕式托蒂下装", "draped dhoti", ["india"]),
    O("haremPants", "灯笼裤", "宽松收口灯笼裤", "loose harem pants", ["arabia", "india", "casual"]),
    O("chaps", "皮护腿", "牛仔皮护腿套在裤外", "leather chaps over pants", ["western"]),
    O("kilt", "苏格兰裙", "格纹苏格兰裙", "tartan kilt", ["vintage", "outdoor"]),
    O("loincloth", "裹腰布", "简单裹腰布", "simple loincloth", ["africa", "aztec"]),
    O("none", "无", "", ""),
]

SHOES_OPTIONS = [
    O("sneaker", "运动鞋", "厚底运动鞋", "chunky sneakers", ["sport", "casual", "street"]),
    O("canvas", "帆布鞋", "低帮帆布鞋", "low-top canvas shoes", ["casual", "cute"]),
    O("leatherS", "皮鞋", "系带皮鞋", "lace-up leather shoes", ["formal"]),
    O("loafer", "乐福鞋", "流苏乐福鞋", "tassel loafers", ["formal", "elegant"]),
    O("boots", "短靴", "系带短靴", "lace-up ankle boots", ["outdoor", "punk", "street"]),
    O("cowboyBoot", "牛仔靴", "尖头皮面牛仔靴", "pointed-toe leather cowboy boots", ["western"]),
    O("longBoot", "长靴", "过膝长靴", "over-knee boots", ["fantasy", "elegant", "punk"]),
    O("heel", "高跟", "细跟高跟鞋", "high heels", ["elegant", "formal"]),
    O("stiletto", "细高跟", "极细的恨天高", "stiletto heels", ["elegant"]),
    O("sandal", "凉鞋", "细带凉鞋", "strappy sandals", ["beach", "casual"]),
    O("gladiator", "罗马鞋", "绑带罗马凉鞋", "strappy gladiator sandals", ["vintage", "fantasy"]),
    O("slipper", "拖鞋", "棉质拖鞋", "slippers", ["casual"]),
    O("clog", "木屐", "素面木屐", "wooden geta clogs", ["japan", "casual"]),
    O("brogue", "布洛克", "雕花布洛克鞋", "brogues", ["formal", "vintage"]),
    O("spaceB", "战靴", "重型战靴", "heavy combat boots", ["scifi", "military", "outdoor"]),
    O("mechBoot", "机甲靴", "带金属护片的机甲靴", "armored mech boots", ["scifi", "cyberpunk"]),
    O("barefoot", "赤脚", "赤足", "barefoot", ["fantasy", "beach"]),
    O("clothBoots", "布靴", "素布软靴", "cloth boots", ["china", "hanfu"]),
    O("cloudBoot", "云头靴", "翘头云纹靴", "cloud-patterned upturned boots", ["china", "hanfu"]),
    O("warBoots", "战靴", "皮革战靴裹腿", "leather war boots with leg wraps", ["fantasy", "warcraft"]),
    O("geta", "高齿木屐", "高齿木屐", "tall geta", ["japan"]),
    O("mojari", "尖头鞋", "印度尖头绣花鞋", "embroidered pointed mojari", ["india"]),
]

SOCKS_OPTIONS = [
    O("none", "无", "", ""), O("ankle", "船袜", "船袜"), O("crew", "中筒袜", "中筒袜"),
    O("kneeS", "过膝袜", "过膝长袜"), O("thigh", "长筒袜", "大腿袜"),
    O("pantyhose", "连裤袜", "半透明连裤袜"), O("legwrap", "绑腿", "布条绑腿"),
    O("tabi", "足袋", "白色足袋", "white tabi socks", ["japan"]),
    O("fishnet", "网袜", "黑色网袜", "black fishnet stockings", ["punk", "street"]),
    O("stripeSock", "条纹袜", "彩色条纹袜", "striped socks", ["cute", "school"]),
]

BELT_OPTIONS = [
    O("none", "无", "", ""), O("leather", "皮革腰带", "金属扣皮革腰带"),
    O("chain", "链条腰带", "垂坠链条腰带", "chain belt", ["punk", "street"]),
    O("sash", "绸带", "系结绸带", "tied silk sash", ["china", "hanfu"]),
    O("obi", "宽腰封", "宽幅腰封", "wide obi sash", ["japan", "fantasy"]),
    O("buckle", "大扣腰带", "夸张大扣腰带", "big-buckle belt", ["punk", "western"]),
    O("ropeBelt", "绳结腰带", "粗糙绳结腰带", "rope belt", ["africa", "outdoor"]),
    O("doubleStrap", "双排扣带", "双排金属扣带", "double-buckle strap harness", ["gothic", "cyberpunk"]),
    O("waistChain", "腰链", "垂挂腰链", "draped waist chain", ["india", "elegant"]),
]

NECKWEAR_OPTIONS = [
    O("none", "无", "", ""), O("tie", "领带", "真丝领带", "silk tie", ["formal"]),
    O("bowtie", "领结", "小巧领结", "bow tie", ["formal", "cute"]),
    O("scarf", "围巾", "厚实围巾", "thick scarf", ["outdoor", "vintage"]),
    O("neckerchief", "领巾", "系在颈间的小方巾", "neckerchief", ["casual", "western"]),
    O("necklace", "项链", "细链坠饰", "pendant necklace", ["elegant", "cute"]),
    O("choker", "颈圈", "黑色皮革颈圈", "black leather choker", ["punk", "elegant"]),
    O("beads", "珠串", "骨质珠串", "bone bead necklace", ["africa", "warcraft", "outdoor"]),
    O("stole", "毛领", "蓬松毛领", "fur stole", ["elegant", "vintage"]),
    O("cravat", "领结巾", "维多利亚式领结巾", "victorian cravat", ["vintage", "gothic"]),
    O("jade", "玉牌", "玉佩垂绦", "jade pendant with tassel", ["china", "hanfu"]),
    O("bibNecklace", "重工项圈", "镶嵌宝石的重工项圈", "gem-encrusted bib necklace", ["india", "elegant"]),
    O("dogTag", "军牌", "金属军牌", "military dog tags", ["military", "street"]),
    O("bell", "铃铛项圈", "系铃的皮项圈", "leather collar with bell", ["cute"]),
    O("amulet", "护身符", "皮绳护身符", "leather-cord amulet", ["fantasy", "outdoor"]),
]

GLOVES_OPTIONS = [
    O("none", "无", "", ""), O("glove", "手套", "贴合手套", "fitted gloves"),
    O("mitt", "毛线手套", "毛线手套", "mittens", ["outdoor"]),
    O("gauntlet", "护腕甲", "金属护腕甲", "metal gauntlets", ["fantasy", "warcraft"]),
    O("wrist", "护腕", "运动护腕", "wrist guards", ["sport"]),
    O("bracelet", "手环", "环状手环", "bracelet", ["cute", "elegant"]),
    O("armWrap", "缠臂布", "缠绕小臂的布条", "arm wraps", ["china", "outdoor"]),
    O("laceGlove", "蕾丝手套", "及肘蕾丝手套", "elbow-length lace gloves", ["gothic", "elegant"]),
    O("fingerless", "露指手套", "露指战术手套", "fingerless tactical gloves", ["cyberpunk", "military"]),
]

BACKPACK_OPTIONS = [
    O("none", "无", "", ""), O("school", "书包", "双肩书包", "school backpack", ["school"]),
    O("daypack", "双肩包", "机能双肩包", "functional daypack", ["outdoor", "street"]),
    O("messenger", "斜挎包", "帆布斜挎包", "canvas messenger bag", ["casual", "street"]),
    O("handbag", "手提包", "皮质手提包", "leather handbag", ["elegant"]),
    O("quiver", "箭袋", "皮质箭袋", "leather quiver", ["fantasy", "western", "outdoor"]),
    O("jetpack", "喷射包", "背负式喷射装置", "back-mounted jetpack", ["scifi"]),
    O("basket", "竹篮", "竹编提篮", "bamboo basket", ["china", "cute"]),
    O("swordSheath", "剑鞘", "背负长剑剑鞘", "sword sheath on back", ["china", "fantasy"]),
    O("satchel", "药箱", "木质药箱", "wooden medicine case", ["china", "fantasy"]),
    O("canteen", "水壶", "军用水壶", "military canteen", ["military", "outdoor"]),
]

PROP_OPTIONS = [
    O("none", "无", "", ""),
    O("phone", "手机", "手里拿着手机", "holding a phone", ["casual"]),
    O("coffee", "咖啡", "端着咖啡杯", "holding a coffee cup", ["casual"]),
    O("book", "书", "捧着一本翻开的书", "holding an open book", ["formal", "elegant"]),
    O("umbrella", "伞", "撑着一把伞", "holding an umbrella", ["elegant", "vintage"]),
    O("sword", "长剑", "手握长剑", "holding a longsword", ["china", "fantasy", "wuxia"]),
    O("jian", "古剑", "持一柄古朴长剑", "holding an ancient jian sword", ["china", "hanfu", "wuxia"]),
    O("staff", "法杖", "拄着镶嵌宝石的法杖", "holding a gem-topped staff", ["fantasy", "warcraft"]),
    O("fan", "折扇", "轻摇折扇", "holding a folding fan", ["china", "hanfu"]),
    O("pipa", "琵琶", "怀抱琵琶", "holding a pipa lute", ["china", "hanfu", "elegant"]),
    O("guitar", "吉他", "背着吉他", "holding a guitar", ["street", "casual"]),
    O("ball", "球", "单手托着球", "holding a ball", ["sport"]),
    O("lantern", "灯笼", "提着一盏灯笼", "holding a paper lantern", ["china", "fantasy"]),
    O("blaster", "能量枪", "握着能量手枪", "holding an energy pistol", ["scifi", "cyberpunk"]),
    O("rifle", "长枪", "持步枪", "holding a rifle", ["military"]),
    O("bow", "长弓", "握着一把长弓", "holding a longbow", ["fantasy", "western", "outdoor"]),
    O("axe", "巨斧", "扛着巨大战斧", "carrying a huge battle axe", ["warcraft", "fantasy"]),
    O("dagger", "匕首", "反握匕首", "holding a dagger in reverse grip", ["street", "fantasy"]),
    O("flowerP", "花束", "捧着一束花", "holding a bouquet", ["cute", "elegant"]),
    O("cane", "手杖", "拄着手杖", "leaning on a cane", ["vintage", "elegant"]),
    O("flag", "旗帜", "举着一面旗帜", "holding a banner", ["fantasy", "military"]),
    O("whip", "长鞭", "卷着长鞭", "holding a coiled whip", ["western", "fantasy"]),
    O("revolver", "左轮枪", "手中握着一把左轮", "holding a revolver", ["western"]),
    O("scythe", "镰刀", "扛着死神镰刀", "carrying a scythe", ["gothic", "fantasy"]),
    O("parasol", "纸伞", "撑着一柄油纸伞", "holding an oil-paper parasol", ["china", "hanfu"]),
    O("teacup", "茶盏", "端着青瓷茶盏", "holding a porcelain teacup", ["china", "elegant"]),
    O("scroll", "卷轴", "展开一卷竹简", "unrolling a bamboo scroll", ["china", "hanfu"]),
    O("trident", "三叉戟", "握着三叉戟", "holding a trident", ["fantasy", "norse"]),
    O("spear", "长枪", "挑着一杆长枪", "holding a spear", ["fantasy", "military", "china"]),
]

DIMS_CLOTH = [
    # 裸露状态是「状态开关」而不是内容维度：它必须在任何情况下都存在，
    # 否则上装/下装的条件判定（requires nudity）会失效，导致衣物全部消失。
    {"id": "nudity", "name": "裸露状态", "group": "cloth", "sensitive": False, "cond": None,
     "options": [O("none", "完整着装"), O("upper", "上半裸"), O("lower", "下半裸"), O("full", "全裸")]},

    {"id": "top", "name": "上装", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "lower"]}},  # 上半裸/全裸时不该有上衣
     "options": TOP_OPTIONS},

    {"id": "topColor", "name": "上装颜色", "group": "cloth", "sensitive": False, "is_color": True,
     "cond": {"requires": {"nudity": ["none", "lower"]}},
     "options": [O(c, c) for c in CLOTH_COLORS]},

    {"id": "topPattern", "name": "上装纹样", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "lower"]}},
     "options": TOP_PATTERN_OPTIONS},

    {"id": "sleeve", "name": "袖长", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "lower"]}},
     "options": SLEEVE_OPTIONS},

    {"id": "outer", "name": "外套", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "lower"]}},
     "options": OUTER_OPTIONS},

    {"id": "outerColor", "name": "外套颜色", "group": "cloth", "sensitive": False, "is_color": True,
     "cond": {"requires": {"nudity": ["none", "lower"]}},
     "options": [O(c, c) for c in CLOTH_COLORS]},

    {"id": "bottom", "name": "下装", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "upper"]}},  # 下半裸/全裸时不该有裤子
     "options": BOTTOM_OPTIONS},

    {"id": "bottomColor", "name": "下装颜色", "group": "cloth", "sensitive": False, "is_color": True,
     "cond": {"requires": {"nudity": ["none", "upper"]}},
     "options": [O(c, c) for c in CLOTH_COLORS]},

    {"id": "shoes", "name": "鞋子", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "upper", "lower"]}},
     "options": SHOES_OPTIONS},

    {"id": "shoeColor", "name": "鞋色", "group": "cloth", "sensitive": False, "is_color": True,
     "cond": {"requires": {"nudity": ["none", "upper", "lower"]}},
     "options": [O(c, c) for c in ["white", "cream", "lGray", "gray", "dGray", "black", "navy",
                                   "skyBlue", "lakeBlue", "teal", "green", "olive", "brown",
                                   "maroon", "red", "orange", "gold", "pink", "purple", "beige"]]},

    {"id": "socks", "name": "袜子", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none"]}},
     "options": SOCKS_OPTIONS},

    {"id": "belt", "name": "腰带", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "upper", "lower"]}},
     "options": BELT_OPTIONS},

    {"id": "neckwear", "name": "颈饰", "group": "cloth", "sensitive": False, "cond": None,
     "options": NECKWEAR_OPTIONS},

    {"id": "gloves", "name": "手部", "group": "cloth", "sensitive": False, "cond": None,
     "options": GLOVES_OPTIONS},

    {"id": "backpack", "name": "背负物", "group": "cloth", "sensitive": False,
     "cond": {"requires": {"nudity": ["none", "upper", "lower"]}},
     "options": BACKPACK_OPTIONS},

    {"id": "prop", "name": "手持道具", "group": "cloth", "sensitive": False, "cond": None,
     "options": PROP_OPTIONS},
]
