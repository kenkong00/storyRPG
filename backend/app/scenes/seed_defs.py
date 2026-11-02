# -*- coding: utf-8 -*-
"""场景拼装定义种子（第一次启动时写入 backend/data/scene_defs.json）。

2026-11 重构：从「一股脑随机」改成两层结构。

  第一层 **限定选项（limit）**：地点类型 / 时代 / 景深层次 / 镜头构图 / 光线 /
  主色调 / 画风 —— 全部由用户手选，随机永远不会覆盖它们。
  第二层 **细节元素（packs）**：跟着「地点类型」走。选了地下洞窟就出现
  水体 / 岩石与沉积物 / 遗迹 / 生物 / 矿脉；选了校园教室就变成课桌 / 黑板 /
  学习用品……。这一层才是随机的部分，也是最容易出细节的部分。

一个地点类型可以挂多个元素包（比如「港湾码头」= 城镇街区 + 自然野外），
拼装页会把这些包的维度并起来显示。
"""

D = lambda i, n, cn=None, tags=None: {
    "id": i, "name": n, "cn": cn or n, "tags": tags or [], "cat": "",
}


def E(i, n, cn, packs):
    """地点类型专用：带上它的细节元素包。"""
    return {"id": i, "name": n, "cn": cn, "tags": [], "cat": "", "packs": packs}


def P(items):
    """元素选项三元组 (id, 名称, 中文描述) → 选项列表。"""
    return [{"id": i, "name": n, "cn": c, "tags": [], "cat": ""} for i, n, c in items if i]


# ==================== 细节元素包 ====================
# 每个包：(包 id, 包名, 图标, [(维度 id, 维度名, 选项)])
# 维度 id 统一 el_<包>_<槽位>，不会与别处冲突。
PACKS = [
    # ---------- 地下洞窟 ----------
    ("cave", "洞窟元素", "🕳", [
        ("el_cave_water", "水体", P([
            ("poison", "毒潭", "一汪泛着幽绿毒光的死水潭"),
            ("still_lake", "静水湖", "漆黑如镜的地下静水湖"),
            ("hotspring", "冒泡热泉", "不断冒泡的硫磺热泉，热气蒸腾"),
            ("groundwater", "幽蓝反光地下水", "地下水泛着幽蓝的反光"),
            ("drip_pool", "滴水凹坑", "被滴水凿出的凹坑，积着清水"),
            ("underriver", "暗河", "暗河在身边低语般流淌"),
            ("none", "没有水", "洞窟干燥，看不到水"),
        ])),
        ("el_cave_rock", "岩石与沉积物", P([
            ("rubble", "碎石堆", "地面堆着崩落的碎石"),
            ("rockfall", "落石", "几块刚落下的巨石卡在通道口"),
            ("silt", "泥沙淤积", "水流带下的泥沙淤成缓坡"),
            ("clay", "黏土", "潮湿的灰白黏土层"),
            ("gypsum", "石膏结晶", "岩壁上长出纤维状的石膏晶"),
            ("calcite", "方解石晶簇", "方解石晶簇从裂缝里撑开"),
            ("stalactite", "钟乳石", "钟乳石与石笋上下相接"),
            ("strata", "层理岩壁", "岩壁层层叠压，纹理清晰"),
        ])),
        ("el_cave_relic", "遗迹痕迹", P([
            ("campfire", "用火遗迹", "熄灭的篝火，灰烬与焦木尚存"),
            ("fossil", "骨头化石", "岩层里嵌着巨大的骨头化石"),
            ("mining", "开采痕迹", "石壁上是整齐的凿痕与旧木架"),
            ("petroglyph", "古代岩画", "岩壁上刻着褪色的古老岩画"),
            ("stairs", "坍塌石阶", "一段被掩埋大半的石阶"),
            ("altar", "祭祀残台", "低矮的祭祀石台，摆着腐朽的供品"),
            ("none", "没有人为痕迹", "纯天然洞窟，不见任何人迹"),
        ])),
        ("el_cave_creature", "洞穴生物", P([
            ("bats", "蝙蝠群", "洞顶倒挂着成片蝙蝠"),
            ("millipede", "马陆", "岩缝里爬出长串马陆"),
            ("woodlouse", "潮虫", "潮湿角落堆着潮虫"),
            ("shrimp", "洞穴虾", "水洼里有半透明的洞穴虾"),
            ("blindfish", "盲鱼", "暗河里游着无眼的盲鱼"),
            ("snail", "洞穴蜗牛", "岩壁上黏着细小的洞穴蜗牛"),
            ("cricket", "洞穴蟋蟀", "暗处传来蟋蟀的鸣声"),
            ("web", "蛛网", "通道口结着厚重的蛛网"),
            ("none", "没有生物", "死寂一片，看不到任何活物"),
        ])),
        ("el_cave_fungus", "真菌与苔藓", P([
            ("glow_mold", "发光菌膜", "岩壁上覆着幽幽发光的菌膜"),
            ("mycelium", "悬垂菌丝", "洞顶垂下细密的菌丝"),
            ("blue_moss", "蓝色苔藓", "潮湿岩面爬满蓝色苔藓"),
            ("mushroom", "蘑菇丛", "腐木上长着一簇簇苍白蘑菇"),
            ("mildew", "霉斑", "石缝里渗出黑色霉斑"),
            ("none", "没有菌苔", "岩面干净，没有菌苔"),
        ])),
        ("el_cave_ore", "矿脉", P([
            ("crystal", "水晶", "晶洞里的六棱水晶折射微光"),
            ("gold", "金矿脉", "岩壁间夹着细碎金砂的矿脉"),
            ("silver", "银矿脉", "冷白的银矿脉在石中延展"),
            ("magic", "魔矿", "散发微光的异色魔矿结晶"),
            ("gem", "宝石矿脉", "嵌着深红宝石的矿脉"),
            ("sulfur", "硫磺脉", "渗着黄色硫磺的岩层"),
            ("none", "没有矿脉", "普通岩层，不见矿脉"),
        ])),
    ]),

    # ---------- 自然野外 ----------
    ("nature", "自然元素", "🌿", [
        ("el_nature_ground", "地貌肌理", P([
            ("leaf_litter", "落叶腐殖层", "地面铺着厚厚的落叶腐殖层"),
            ("rock_face", "裸露岩盘", "大片裸露的岩盘被雨水打磨光滑"),
            ("gravel", "风化沙砾", "风化碎裂的沙砾散落一地"),
            ("moss_carpet", "苔藓地毯", "苔藓像地毯一样覆盖地表"),
            ("cracked_mud", "龟裂泥地", "干涸龟裂的泥地"),
            ("snow_crust", "雪壳冰晶", "一层薄雪壳，踩上去簌簌作响"),
            ("scree", "碎石坡", "松动的碎石坡从坡顶铺下来"),
            ("grass_terrace", "浅草台地", "低矮的草被铺成一片台地"),
        ])),
        ("el_nature_plant", "植被细节", P([
            ("fallen_log", "倒木与树桩", "倒伏的巨木与断掉的树桩"),
            ("thicket", "灌木荆棘", "低矮灌木与带刺荆棘"),
            ("wildflower", "野花丛", "野花成丛，细碎地开着"),
            ("vine", "藤蔓垂挂", "藤蔓从高处垂挂下来"),
            ("aerial_root", "老树气根", "老树垂下密密的气根"),
            ("fern", "蕨类菌菇", "蕨叶舒展，其间点缀菌菇"),
            ("dry_grass", "枯草伏地", "枯草被风压得伏在地上"),
            ("dead_stump", "干枝残桩", "几截干枯的残桩露出地面"),
        ])),
        ("el_nature_water", "水与湿气", P([
            ("dew", "露水挂叶", "叶尖挂满将落未落的露水"),
            ("seep", "细流渗涌", "岩缝里细细地渗出水来"),
            ("ground_fog", "贴地雾气", "低雾贴着地面缓缓流动"),
            ("puddle", "泥潭水洼", "泥潭与水洼反射着天光"),
            ("small_fall", "跌水小瀑", "一道小瀑布跌进石潭"),
            ("frost", "结霜水痕", "水痕边结着薄霜"),
            ("none", "干燥无水", "干燥，看不见任何水汽"),
        ])),
        ("el_nature_wild", "野生动静", P([
            ("startled_birds", "惊鸟掠过", "惊起的鸟群掠过林梢"),
            ("insects", "蜂虫盘旋", "细小的蜂虫在光里盘旋"),
            ("tracks", "兽径足迹", "泥地上留着新鲜的兽类足迹"),
            ("howl", "远处兽嚎", "远处传来悠长的兽嚎"),
            ("fireflies", "萤火点点", "萤火在暗处明灭"),
            ("swarm", "飞虫成团", "一团飞虫悬在半空"),
            ("none", "一片死寂", "没有鸟兽虫鸣，静得出奇"),
        ])),
    ]),

    # ---------- 乡野村落 ----------
    ("village", "村舍元素", "🏘", [
        ("el_village_house", "农舍构件", P([
            ("thatched", "茅草屋顶", "茅草屋顶压着石块"),
            ("mud_wall", "土坯墙", "土坯墙斑驳开裂"),
            ("fence", "木栅栏", "歪斜的木栅栏围出院子"),
            ("chimney_smoke", "烟囱炊烟", "烟囱里正升起炊烟"),
            ("gate", "院门", "半掩的竹木院门"),
            ("well", "水井", "院角一口辘轳水井"),
        ])),
        ("el_village_farm", "农事陈设", P([
            ("tools", "农具靠墙", "锄头镰刀靠在墙根"),
            ("haystack", "稻草堆", "院子里堆着金黄稻草"),
            ("drying_mat", "晒谷席", "晒席上摊着谷物"),
            ("vegetable", "菜畦", "一小片齐整的菜畦"),
            ("chicken_coop", "鸡笼", "竹编鸡笼里扑腾着鸡"),
            ("waterwheel", "水车", "溪边一架缓慢的水车"),
        ])),
        ("el_village_field", "田埂", P([
            ("ridges", "田垄", "田垄一道道推向远处"),
            ("canal", "灌溉渠", "灌溉渠里清水缓流"),
            ("scarecrow", "稻草人", "田中立着破衣稻草人"),
            ("path", "泥土小径", "一条被踩实的泥土小径"),
            ("none", "没有农田", "周围没有耕地"),
        ])),
        ("el_village_life", "生活痕迹", P([
            ("laundry", "晾晒衣物", "竹竿上晾着粗布衣裳"),
            ("firewood", "柴垛", "整齐码放的柴垛"),
            ("jar", "陶缸", "檐下摆着几口陶缸"),
            ("basket", "竹篮", "门口放着竹篮与草鞋"),
            ("none", "空无一人", "看不到生活痕迹，像被遗弃"),
        ])),
    ]),

    # ---------- 城镇街区 ----------
    ("urban", "城镇元素", "🏙", [
        ("el_urban_pave", "街面铺装", P([
            ("cobble", "鹅卵石", "鹅卵石路面被磨得发亮"),
            ("flagstone", "青石板", "青石板缝隙里冒出草"),
            ("boardwalk", "木板栈道", "吱呀作响的木板栈道"),
            ("dirt_road", "夯土路", "被车辙压实的夯土路"),
            ("rut", "车辙泥路", "两道深车辙积着雨水"),
            ("steps", "石阶", "一段窄石阶向上延伸"),
        ])),
        ("el_urban_facade", "建筑细部", P([
            ("lattice", "木格窗", "木格窗后透出暗黄灯光"),
            ("eave", "挑檐与檐铃", "挑檐下挂着檐铃"),
            ("door_knocker", "门环门钉", "厚重的木门镶着铜钉门环"),
            ("peeling", "斑驳墙皮", "墙皮剥落，露出里面砖层"),
            ("gargoyle", "排水兽首", "檐角伸出石雕排水兽首"),
            ("signboard", "铁艺招牌", "铁艺招牌在风里轻晃"),
            ("awning", "布篷雨棚", "褪色的布篷撑在店前"),
        ])),
        ("el_urban_street", "街道陈设", P([
            ("lamp", "街边路灯", "铸铁路灯投下一圈暖光"),
            ("notice", "告示牌", "木牌上贴着层层告示"),
            ("bench", "长椅", "一张磨损的长椅"),
            ("barrow", "货担推车", "靠墙停着一辆货担车"),
            ("barrel", "木桶木箱", "门口堆着木桶与木箱"),
            ("clothesline", "晾衣绳", "两楼之间拉着晾衣绳"),
            ("none", "街面空旷", "街上什么都没有，空荡得很"),
        ])),
        ("el_urban_trace", "人的痕迹", P([
            ("flowerpot", "窗台花盆", "窗台上摆着几盆花"),
            ("worn_threshold", "门槛磨痕", "门槛被踩出深深的凹痕"),
            ("chalk", "粉笔字迹", "墙上留着歪扭的粉笔字"),
            ("cloth_scrap", "摊布残片", "地上散着褪色布片"),
            ("straw_sandal", "遗落草鞋", "角落有一只遗落的草鞋"),
            ("none", "没有生活痕迹", "干净得像布景"),
        ])),
        ("el_urban_air", "光与气", P([
            ("cooking_smoke", "炊烟", "屋顶飘起淡淡炊烟"),
            ("forge_glow", "炉火红光", "铁匠铺透出橘红火光"),
            ("window_light", "窗口暖灯", "一排窗口亮着暖黄"),
            ("steam", "街面蒸汽", "下水口冒出白色蒸汽"),
            ("dust", "浮尘", "斜光里浮着细尘"),
        ])),
    ]),

    # ---------- 集市 ----------
    ("market", "集市元素", "🏮", [
        ("el_market_stall", "摊位结构", P([
            ("cloth_awning", "布棚", "条纹布棚一顶接一顶"),
            ("wood_rack", "木架摊", "木架上层层摆满货"),
            ("cart", "推车摊", "推车上堆着成筐货物"),
            ("ground_mat", "席地摊布", "摊布直接铺在地上"),
            ("carrying_pole", "挑担", "一副挑担横在路边"),
        ])),
        ("el_market_goods", "货物", P([
            ("chili", "成串干辣椒", "梁上挂着成串干辣椒"),
            ("cloth_roll", "布匹卷", "一摞摞布匹卷码得整齐"),
            ("pottery", "陶罐瓷器", "陶罐瓷碗堆成小丘"),
            ("fruit", "鲜果筐", "竹筐里堆着带露鲜果"),
            ("fish_ice", "鱼摊碎冰", "鱼摊下铺着碎冰与鳞片"),
            ("spice", "香料堆", "香料堆成彩色小丘"),
            ("herb", "药材束", "成束药材倒挂在架下"),
            ("ironware", "铁器工具", "铁器工具碰撞作响"),
        ])),
        ("el_market_hang", "悬挂物", P([
            ("lantern_string", "灯笼串", "成串红灯笼罩下暖光"),
            ("banner", "招牌幡旗", "布幡招牌层层垂挂"),
            ("hanging_meat", "挂肉", "铁钩上挂着腌肉"),
            ("sausage", "风干肠", "风干肠一串串垂着"),
            ("straw_craft", "草编挂饰", "草编小挂饰随风摇"),
            ("none", "没有悬挂物", "头顶空旷"),
        ])),
        ("el_market_ground", "地面痕迹", P([
            ("vegetable_scrap", "菜叶果皮", "地上散着菜叶果皮"),
            ("wet_trace", "泼洒水痕", "地面泼出的水痕尚未干"),
            ("wheel_rut", "车辙", "车辙里积着浊水"),
            ("sawdust", "木屑", "木屑与草屑混在泥里"),
        ])),
        ("el_market_air", "气与声", P([
            ("steamer", "蒸笼白汽", "蒸笼掀起一片白汽"),
            ("oven_smoke", "烤炉烟", "烤炉腾起呛人的烟"),
            ("flies", "飞虫绕果", "飞虫绕着果摊打转"),
            ("paper_scrap", "纸屑旋飞", "纸屑被风卷着打旋"),
        ])),
    ]),

    # ---------- 室内居所 ----------
    ("interior", "室内元素", "🪑", [
        ("el_interior_furniture", "家具", P([
            ("long_table", "长条木桌", "长条木桌被磨出包浆"),
            ("high_chair", "高背椅", "几把高背椅围在桌边"),
            ("fireplace", "壁炉柴堆", "壁炉里柴火将熄"),
            ("counter", "柜台", "厚重柜台隔开内外"),
            ("wine_rack", "酒架", "整墙酒架上摆满陶瓶"),
            ("coat_rack", "衣帽架", "门边立着衣帽架"),
            ("screen", "屏风", "一架绢面屏风挡出里间"),
        ])),
        ("el_interior_object", "器物", P([
            ("cup", "陶杯酒壶", "桌上散着陶杯与酒壶"),
            ("candlestick", "烛台", "烛台上蜡泪层层"),
            ("basin", "铜盆", "铜盆里盛着清水"),
            ("ledger", "账本", "摊开的账本压着算筹"),
            ("scale", "秤与砝码", "柜台上一杆旧秤"),
            ("coin_box", "铜钱匣", "半开的铜钱匣露出铜钱"),
        ])),
        ("el_interior_textile", "织物", P([
            ("rug", "地毯", "磨损的地毯铺在中央"),
            ("tablecloth", "桌布", "桌布带着洗不掉的酒渍"),
            ("drapery", "垂幔", "厚重垂幔半掩窗户"),
            ("cushion", "靠垫", "靠垫塌陷变形"),
            ("tapestry", "挂毯", "墙上挂毯绘着旧日战事"),
        ])),
        ("el_interior_structure", "墙与结构", P([
            ("beam", "木梁", "粗木梁横过头顶"),
            ("plaster", "灰泥墙", "灰泥墙面凹凸不平"),
            ("flue", "砖砌烟道", "砖砌烟道占了半面墙"),
            ("niche", "壁龛", "墙里挖出拱形壁龛"),
            ("stairs", "木楼梯", "木楼梯通往上层的暗处"),
        ])),
        ("el_interior_trace", "生活痕迹", P([
            ("soot", "烟熏痕", "天花板被烟熏得发黑"),
            ("wine_stain", "酒渍", "地面留着深色酒渍"),
            ("crumbs", "面包屑", "桌角散着面包屑"),
            ("coat_hung", "挂外套", "椅背上搭着外套"),
            ("footprint", "鞋印", "泥鞋印一路延伸进屋"),
        ])),
    ]),

    # ---------- 园林庭院 ----------
    ("garden", "园林元素", "🌷", [
        ("el_garden_plant", "花木", P([
            ("hedge", "修剪绿篱", "绿篱被剪出笔直的边"),
            ("rose", "攀援蔷薇", "蔷薇爬满拱架与墙头"),
            ("flowerbed", "花境花坛", "花坛里高低错落开着花"),
            ("wisteria", "藤架紫藤", "藤架上垂着一串串紫藤"),
            ("potted", "盆栽列", "一排盆栽沿阶摆开"),
            ("petal_ground", "落花铺地", "花瓣铺了一地"),
            ("lawn", "草坪", "草坪被修得平整"),
            ("old_tree", "庭荫老树", "一株老树撑起整片荫"),
        ])),
        ("el_garden_build", "园林构筑", P([
            ("fountain", "喷泉", "喷泉细流不断落下"),
            ("stone_path", "石径", "石径在花木间转折"),
            ("flower_arch", "拱形花门", "花门把视线引向深处"),
            ("pavilion", "凉亭", "凉亭半掩在枝叶里"),
            ("bench", "石长椅", "石长椅背靠着绿篱"),
            ("sundial", "日晷", "日晷的指针正指着某个时辰"),
            ("low_wall", "矮墙", "矮墙把园子分成几进"),
        ])),
        ("el_garden_water", "水景", P([
            ("mirror_pool", "镜面水池", "水面静得像一面镜子"),
            ("stream", "溪渠", "一条细渠穿过园子"),
            ("basin_drip", "石钵滴水", "石钵里的水一滴一滴落下"),
            ("lily_jar", "睡莲缸", "大水缸里浮着睡莲"),
            ("none", "没有水景", "园中无水，只见花木与石"),
        ])),
        ("el_garden_detail", "细节", P([
            ("floating_petal", "落花浮水", "落花漂在水面上打转"),
            ("butterfly", "蜂蝶", "蜂蝶在花间起落"),
            ("clipped_edge", "修剪剪痕", "绿篱新剪的口子还没长齐"),
            ("tools", "园艺工具", "园艺剪与竹耙搁在石边"),
            ("moss_trace", "苔痕", "石缝与阶边爬着苔痕"),
        ])),
    ]),

    # ---------- 校园教室 ----------
    ("school", "教室元素", "🏫", [
        ("el_school_desk", "课桌陈设", P([
            ("rows", "成排课桌", "课桌一排排整齐码到窗边"),
            ("podium", "讲台", "讲台高出地面一级"),
            ("blackboard", "黑板粉笔槽", "黑板上还留着半行板书"),
            ("duty_roster", "值日表", "墙角贴着值日表"),
            ("clock", "挂钟", "挂钟指针停在某一刻"),
            ("projector", "投影幕", "投影幕半卷着垂下来"),
        ])),
        ("el_school_supply", "学习用品", P([
            ("textbook", "课本堆", "桌角堆着卷边的课本"),
            ("pencil_case", "文具盒", "文具盒敞开，笔散了一桌"),
            ("notebook", "练习本", "练习本摊开写着算式"),
            ("chalk", "粉笔头", "粉笔槽里躺着半截粉笔"),
            ("globe", "地球仪", "地球仪上蒙着薄灰"),
            ("apparatus", "实验器材", "讲台旁摆着一套实验器材"),
        ])),
        ("el_school_wall", "墙面", P([
            ("learning_board", "学习园地", "后墙学习园地贴满作品"),
            ("certificate", "奖状", "墙上一排泛黄奖状"),
            ("class_photo", "班级合照", "班级合照边角卷起"),
            ("handwritten_paper", "手抄报", "手抄报贴得歪歪斜斜"),
            ("plant", "窗台绿植", "窗台上摆着几盆绿植"),
        ])),
        ("el_school_trace", "环境痕迹", P([
            ("chalk_ghost", "擦痕板书", "黑板上留着擦不净的白痕"),
            ("desk_graffiti", "课桌涂鸦", "桌面刻满涂鸦与小字"),
            ("paper_scrap", "纸屑", "地上散着碎纸屑"),
            ("chalk_dust", "粉笔灰", "空气里浮着粉笔灰"),
            ("sunbeam", "阳光斜切", "阳光斜着切进教室，照亮粉尘"),
        ])),
        ("el_school_outside", "室外透入", P([
            ("corridor_echo", "走廊回声", "走廊传来空旷回声"),
            ("playground", "操场口令", "窗外传来操场口令声"),
            ("tree_shadow", "树影投窗", "树影在窗帘上轻晃"),
            ("none", "与外界隔绝", "门窗紧闭，听不见外面"),
        ])),
    ]),

    # ---------- 寺庙神社 ----------
    ("temple", "寺庙元素", "⛩", [
        ("el_temple_part", "建筑构件", P([
            ("torii", "鸟居", "朱红鸟居立在参道入口"),
            ("stone_lantern", "石灯笼", "参道两侧石灯笼长满青苔"),
            ("eave_beast", "飞檐脊兽", "飞檐上蹲着脊兽"),
            ("red_pillar", "朱柱", "朱漆巨柱排成回廊"),
            ("stone_steps", "石阶", "被踩得发亮的石阶"),
            ("bell_tower", "钟楼", "钟楼悬着一口古钟"),
        ])),
        ("el_temple_offering", "供奉物", P([
            ("censer", "香炉", "铜香炉里插着成把残香"),
            ("fruit_offering", "供果", "供盘里摆着几枚干瘪果子"),
            ("fortune_sticks", "签筒", "签筒里的竹签磨得光滑"),
            ("eternal_lamp", "长明灯", "长明灯的火苗轻轻晃"),
            ("prayer_flag", "经幡", "经幡被风吹得猎猎作响"),
            ("altar", "供桌", "供桌上落着薄薄香灰"),
        ])),
        ("el_temple_court", "庭院", P([
            ("raked_sand", "铺砂", "白砂被耙出波纹"),
            ("moss_stone", "苔石", "苔石半埋在白砂里"),
            ("old_pine", "老松", "老松虬枝横斜"),
            ("dry_landscape", "枯山水", "枯山水以石为山、以砂为水"),
            ("water_basin", "石水钵", "石水钵里漂着落叶"),
        ])),
        ("el_temple_trace", "香火痕迹", P([
            ("ash", "香灰", "香灰在风里轻轻翻卷"),
            ("candle_wax", "烛泪", "烛泪在铜座上凝成硬块"),
            ("cushion", "蒲团压痕", "蒲团上留着久跪的凹陷"),
            ("prayer_plaque", "祈福木牌", "木架上挂满祈福木牌"),
            ("red_thread", "红绳", "栏杆上系着成片红绳"),
        ])),
        ("el_temple_air", "气与声", P([
            ("incense", "香烟缭绕", "香烟缭绕，光线被切成细缕"),
            ("bronze_bell", "铜铃", "风过铜铃，余音很长"),
            ("chant", "梵音", "远处传来低沉的梵音"),
            ("none", "万籁俱寂", "静得只剩风声"),
        ])),
    ]),

    # ---------- 废墟 ----------
    ("ruins", "废墟元素", "🏚", [
        ("el_ruins_structure", "坍塌结构", P([
            ("broken_wall", "断墙", "断墙只剩半截轮廓"),
            ("collapsed_roof", "塌陷屋顶", "屋顶塌出一个大洞"),
            ("tilting_column", "倾斜立柱", "立柱倾斜，勉强立着"),
            ("broken_arch", "断裂拱门", "拱门断在最高处"),
            ("rebar", "裸露钢筋", "断口露出扭曲的钢筋"),
            ("debris", "砖石瓦砾", "砖石瓦砾堆到齐腰"),
        ])),
        ("el_ruins_erosion", "侵蚀", P([
            ("vine_cover", "藤蔓吞墙", "藤蔓几乎吞掉整面墙"),
            ("rust", "锈迹", "金属构件锈成暗红"),
            ("worn_relief", "风化浮雕", "浮雕被风蚀得只剩轮廓"),
            ("moss_cover", "苔藓覆盖", "苔藓覆盖了大半石面"),
            ("water_stain", "水渍", "墙面留着层层水渍"),
        ])),
        ("el_ruins_left", "遗留物", P([
            ("pot", "破陶罐", "半埋的破陶罐"),
            ("armor", "锈甲片", "锈蚀甲片散在碎石里"),
            ("brick_pile", "散落砖石", "砖石散落得到处都是"),
            ("rotten_beam", "朽木梁", "朽木梁横在门口"),
            ("bones", "白骨", "角落里散着白骨"),
            ("none", "空无一物", "除了碎石什么都没有"),
        ])),
        ("el_ruins_nature", "自然回收", P([
            ("grass_crack", "野草穿缝", "野草从砖缝里钻出来"),
            ("nest", "鸟巢", "断梁上搭着鸟巢"),
            ("root_split", "树根撑裂", "树根把石墙撑裂"),
            ("reflection", "积水倒影", "积水映出残缺的屋顶"),
        ])),
    ]),

    # ---------- 战场 ----------
    ("battle", "战场元素", "⚔", [
        ("el_battle_wreck", "战争残骸", P([
            ("broken_banner", "断旗", "断旗半插在泥里"),
            ("broken_spear", "折戟", "折断的长戟斜插着"),
            ("shattered_shield", "破碎盾牌", "盾牌裂成几块"),
            ("overturned_cart", "翻倒战车", "战车翻倒，轮子还在转"),
            ("arrows", "箭矢插地", "箭矢密密地插在地上"),
            ("burnt_post", "焦黑木桩", "木桩被烧成焦黑"),
        ])),
        ("el_battle_ground", "地面", P([
            ("churned_mud", "翻起泥土", "泥土被踩踏翻起"),
            ("wheel_trench", "车辙沟", "车辙压出深深沟壑"),
            ("blood_soak", "暗红浸染", "泥土被暗红浸透"),
            ("crater", "坑洞", "地上有炸开的坑洞"),
            ("armor_scrap", "散落甲片", "甲片与断兵散落一地"),
        ])),
        ("el_battle_smoke", "烟与火", P([
            ("embers", "余烬升烟", "余烬里升起细烟"),
            ("distant_fire", "远处火光", "远处还有火光在烧"),
            ("ash", "焦味灰烬", "空气里飘着灰烬"),
            ("smoke_low", "低垂烟尘", "烟尘低低地压在地面"),
        ])),
        ("el_battle_life", "生灵", P([
            ("crows", "盘旋乌鸦", "乌鸦在头顶盘旋"),
            ("horses", "惊马", "几匹惊马在远处徘徊"),
            ("dogs", "野狗", "野狗在废墟间嗅探"),
            ("none", "没有活物", "只有死寂"),
        ])),
    ]),

    # ---------- 城堡宫殿 ----------
    ("castle", "城堡元素", "🏰", [
        ("el_castle_arch", "建筑", P([
            ("giant_pillar", "巨柱", "巨柱撑起高耸穹顶"),
            ("vault", "拱顶", "拱顶在头顶收拢"),
            ("grand_stairs", "石阶", "宽阔石阶通向高台"),
            ("stained_glass", "彩色玻璃窗", "彩色玻璃把光染成碎片"),
            ("portcullis", "铁闸门", "铁闸门悬在半空"),
            ("arrow_slit", "弩箭孔", "墙上开着一排弩箭孔"),
        ])),
        ("el_castle_furnish", "陈设", P([
            ("throne", "王座", "高台上的王座空着"),
            ("carpet", "长地毯", "长地毯一路铺到阶前"),
            ("banners", "挂旗", "家族旗帜从高处垂落"),
            ("candelabra", "烛台列", "烛台沿墙列成一排"),
            ("armor_stand", "盔甲架", "盔甲架立得笔直"),
            ("chest", "宝箱", "角落里一只上锁宝箱"),
        ])),
        ("el_castle_heraldry", "纹章", P([
            ("family_flag", "家族旗帜", "旗帜上绣着家族纹章"),
            ("stone_crest", "石雕徽记", "门楣上刻着石雕徽记"),
            ("metal_crest", "金属纹章", "金属纹章嵌在门板中央"),
            ("inscription", "铭文刻字", "墙上刻着密密麻麻的铭文"),
        ])),
        ("el_castle_mood", "氛围细节", P([
            ("brazier", "火盆", "火盆里的炭烧得正旺"),
            ("dust_mote", "落地尘埃", "光柱里尘埃缓缓下落"),
            ("echo", "回声", "脚步声在厅里荡开回声"),
            ("draft", "冷风穿堂", "冷风从门缝里穿堂而过"),
        ])),
    ]),

    # ---------- 地牢 ----------
    ("prison", "地牢元素", "⛓", [
        ("el_prison_iron", "牢具", P([
            ("bars", "铁栏", "锈迹斑斑的铁栏"),
            ("shackles", "手铐脚镣", "墙上垂着手铐脚镣"),
            ("chain", "铁链", "铁链从墙里拉出来"),
            ("stock", "枷锁", "木枷与铁锁并排"),
            ("keyhole", "锁孔", "门上一只沉重的锁孔"),
        ])),
        ("el_prison_struct", "结构", P([
            ("cell", "石砌牢房", "石砌牢房低矮逼仄"),
            ("drain", "排水沟", "中央一条排水沟"),
            ("hatch", "铁门小窗", "铁门上开着送饭小窗"),
            ("corridor", "甬道", "甬道延伸进黑暗"),
            ("rack", "刑架", "角落里立着刑架"),
        ])),
        ("el_prison_trace", "痕迹", P([
            ("tally", "刻痕计数", "墙上刻着一道道计日痕"),
            ("blood", "干涸血渍", "地面有干涸的暗色"),
            ("straw", "稻草", "湿稻草铺在角落"),
            ("mildew", "霉斑", "墙面爬满霉斑"),
            ("seep", "水渍", "墙缝渗着水"),
        ])),
        ("el_prison_air", "气与光", P([
            ("torch", "火把光", "火把把影子拉得很长"),
            ("drip", "滴水声", "滴水声在甬道里回响"),
            ("damp", "阴冷湿气", "湿气冷得刺骨"),
            ("rat", "鼠影", "鼠影一闪而过"),
        ])),
    ]),

    # ---------- 藏书阁 ----------
    ("library", "藏书阁元素", "📚", [
        ("el_library_shelf", "书架", P([
            ("tall_shelf", "直抵穹顶的书架", "书架直抵穹顶，看不到尽头"),
            ("ladder", "滑动梯", "梯子架在书轨上"),
            ("scroll_grid", "卷轴格", "卷轴格一只只排开"),
            ("brass_plate", "分类铜牌", "每排书架钉着分类铜牌"),
        ])),
        ("el_library_book", "书籍", P([
            ("leather_tome", "皮面古籍", "皮面古籍的烫金已残"),
            ("scroll", "卷轴", "卷轴堆在格子深处"),
            ("loose_page", "散落书页", "书页散落在地"),
            ("book_stack", "书堆", "书堆歪斜地码着"),
            ("index_card", "索引卡", "索引卡插得满满当当"),
        ])),
        ("el_library_light", "光与尘", P([
            ("skylight", "天窗光柱", "天窗投下一道白亮光柱"),
            ("dust", "浮尘", "光柱里浮尘缓慢旋转"),
            ("candle", "烛台", "阅览桌上点着蜡烛"),
            ("desk_lamp", "阅览台灯", "台灯罩着绿色灯罩"),
        ])),
        ("el_library_detail", "细节", P([
            ("seal", "印章墨迹", "印章与墨迹蹭在桌角"),
            ("bookmark", "书签", "一条丝质书签垂在书外"),
            ("bookplate", "藏书票", "扉页贴着旧藏书票"),
            ("cobweb", "蛛网", "高处结着薄薄蛛网"),
        ])),
    ]),

    # ---------- 矿洞 ----------
    ("mine", "矿洞元素", "⛏", [
        ("el_mine_support", "支撑", P([
            ("wood_frame", "木支架", "木支架撑着低矮巷道"),
            ("cart", "矿车轨道", "矿车停在生锈轨道上"),
            ("pickaxe", "铁镐", "铁镐靠在矿壁"),
            ("rope", "缆绳", "缆绳垂进竖井"),
            ("pulley", "滑轮", "头顶滑轮吱呀转动"),
        ])),
        ("el_mine_ore", "矿脉", P([
            ("gold_dust", "金砂", "岩缝里闪着金砂"),
            ("coal", "煤层", "煤层乌黑发亮"),
            ("iron", "铁矿", "铁矿呈暗红色块状"),
            ("crystal", "水晶", "水晶从岩壁里探出"),
            ("slag", "矿渣堆", "矿渣堆成小山"),
        ])),
        ("el_mine_trace", "痕迹", P([
            ("blast_hole", "爆破孔", "岩壁上留着爆破孔"),
            ("chisel", "凿痕", "凿痕密布如鳞"),
            ("rut", "车辙", "矿车压出两道深辙"),
            ("oil_lamp", "油灯", "矿灯挂在支架上"),
        ])),
        ("el_mine_air", "气与光", P([
            ("lamp_light", "矿灯光", "矿灯只照亮一小片"),
            ("dust", "粉尘", "空气里全是岩粉"),
            ("seepage", "渗水", "岩壁渗水成帘"),
            ("dark", "浓重黑暗", "灯光之外是彻底的黑暗"),
        ])),
    ]),

    # ---------- 星舰 / 实验室 ----------
    ("scifi", "科幻舱体元素", "🚀", [
        ("el_scifi_struct", "结构", P([
            ("bulkhead", "金属舱壁", "金属舱壁泛着冷光"),
            ("pipes", "管线束", "管线成束地贴在顶棚"),
            ("airlock", "气密门", "气密门边缘亮着黄灯"),
            ("grating", "格栅地板", "格栅地板下是深深管线层"),
            ("viewport", "观察窗", "观察窗外是星海"),
        ])),
        ("el_scifi_device", "设备", P([
            ("console", "控制台", "控制台上按钮密布"),
            ("holo", "全息投影", "全息投影虚浮在台面"),
            ("pod", "培养舱", "培养舱里的液体泛着微光"),
            ("arm", "机械臂", "机械臂停在半空"),
            ("leds", "指示灯阵", "指示灯一排排闪烁"),
        ])),
        ("el_scifi_left", "遗留", P([
            ("instruments", "散落仪器", "仪器被掀翻在地"),
            ("cable", "断裂线缆", "断裂线缆垂着火花"),
            ("emergency", "应急灯", "应急灯投下红色旋转光"),
            ("terminal", "数据终端", "终端屏幕停在报错页"),
        ])),
        ("el_scifi_air", "气与光", P([
            ("cold_light", "冷白灯", "冷白灯光没有一丝温度"),
            ("vent", "蒸汽泄放", "管道泄出一阵白汽"),
            ("spark", "电火花", "裸露接点噼啪爆出火花"),
            ("scan", "蓝光扫描线", "蓝光扫描线缓缓扫过"),
        ])),
    ]),

    # ---------- 墓园 ----------
    ("graveyard", "墓园元素", "🪦", [
        ("el_grave_stone", "墓碑", P([
            ("tilting", "歪斜墓碑", "墓碑歪斜地插在土里"),
            ("broken_cross", "断裂十字", "十字架断了一只臂"),
            ("sarcophagus", "石棺", "石棺盖错开一道缝"),
            ("tomb", "家族墓室", "家族墓室的门半开"),
            ("nameless", "无名碑", "一块字迹磨平的无名碑"),
        ])),
        ("el_grave_plant", "植物", P([
            ("dry_grass", "枯草", "枯草长过膝盖"),
            ("dead_branch", "枯枝", "枯枝像手指一样伸着"),
            ("vine", "爬藤", "爬藤缠住碑身"),
            ("crow", "乌鸦栖息", "乌鸦停在十字架上"),
        ])),
        ("el_grave_left", "遗留物", P([
            ("withered_flower", "枯萎花束", "碑前放着枯萎花束"),
            ("candle", "残烛", "残烛被风吹熄"),
            ("offering", "供品", "供品已经腐坏"),
            ("doll", "破旧玩偶", "泥里躺着一只破旧玩偶"),
        ])),
        ("el_grave_air", "气与光", P([
            ("mist", "薄雾", "薄雾贴着墓碑流动"),
            ("ghost_light", "幽绿鬼火", "远处浮起幽绿光点"),
            ("moonlight", "月光斜照", "月光斜照在碑面上"),
            ("leaves", "落叶", "落叶被风卷过墓地"),
        ])),
    ]),
]


def build():
    dims = []

    def add(id_, name, group, options, desc=""):
        dims.append({"id": id_, "name": name, "group": group, "desc": desc,
                     "sensitive": False, "is_color": False, "cond": None,
                     "options": options})

    # ==================== 第一层：限定选项（用户手选，随机不动） ====================
    # 地点类型：每个选项挂上它的「细节元素包」，换了地点下方元素整块跟着换
    add("sceneType", "地点类型", "limit", [
        E("town", "城镇街区", "中世纪城镇街区，房屋沿街排开", ["urban"]),
        E("market", "喧闹集市", "人声鼎沸的集市，摊位与灯笼沿街铺开", ["market"]),
        E("village", "乡野村落", "宁静的乡野村落，茅屋与田埂相连", ["village", "nature"]),
        E("forest", "幽深森林", "幽深的原始森林，巨木参天", ["nature"]),
        E("cave", "地下洞窟", "地下洞窟，钟乳石与暗河交错", ["cave"]),
        E("castle", "宏伟城堡", "宏伟的城堡与高耸的塔楼", ["castle"]),
        E("ruins", "古代废墟", "坍塌的古代废墟，残垣断壁", ["ruins"]),
        E("battlefield", "荒芜战场", "尸横遍野的荒芜战场，残旗与断兵", ["battle"]),
        E("desert", "无垠沙漠", "一望无际的沙漠与连绵沙丘", ["nature"]),
        E("snowfield", "苍茫雪原", "风雪覆盖的苍茫雪原", ["nature"]),
        E("mountain", "险峻山巅", "云雾缭绕的险峻山巅", ["nature"]),
        E("beach", "荒凉海岸", "礁石嶙峋的荒凉海岸，浪涛拍岸", ["nature"]),
        E("shrine", "古老神社", "古老神社，鸟居与石灯并列", ["temple"]),
        E("temple", "庄严寺庙", "庄严的古寺，飞檐斗拱", ["temple"]),
        E("academy", "修行学院", "青石铺地的修行学院，演武场开阔", ["school"]),
        E("prison", "阴森地牢", "阴森潮湿的地牢，铁栏与锁链", ["prison"]),
        E("lab", "废弃实验室", "废弃实验室，培养舱与散落的仪器", ["scifi"]),
        E("spaceship", "星舰内部", "巨大星舰的金属走廊与舷窗", ["scifi"]),
        E("manor", "贵族庄园", "贵族庄园，回廊、喷泉与修剪整齐的庭院", ["interior", "garden"]),
        E("garden", "隐秘花园", "隐秘的庭院花园，花木掩映", ["garden"]),
        E("bridge", "跨河长桥", "横跨深谷的石桥，桥下云海翻涌", ["nature"]),
        E("swamp", "瘴气沼泽", "雾气弥漫的瘴气沼泽，枯木半沉", ["nature"]),
        E("graveyard", "荒废墓园", "荒废的墓园，倾斜的墓碑与枯草", ["graveyard"]),
        E("library", "古老藏书阁", "高耸的藏书阁，书架直抵穹顶", ["library"]),
        E("tavern", "温暖酒馆", "温暖的酒馆，木梁、壁炉与成排酒桶", ["interior"]),
        E("mine", "废弃矿洞", "废弃矿洞，矿车与支撑木架", ["mine", "cave"]),
        E("port", "港湾码头", "繁忙的港湾码头，桅杆林立", ["urban"]),
        E("cliff", "悬崖绝壁", "绝壁之上的观景处，脚下是万丈深渊", ["nature"]),
        E("sky", "云端浮岛", "漂浮在云海之上的浮岛", ["nature"]),
        E("throne", "王座大厅", "空旷的王座大厅，巨柱与垂落的旗帜", ["castle"]),
    ])

    add("era", "时代", "limit", [
        D("myth", "远古洪荒", "远古洪荒，巨兽与原始图腾"),
        D("ancient", "上古王朝", "上古王朝，夯土与青铜礼器"),
        D("medieval", "中古世纪", "中古世纪，石墙与骑士纹章"),
        D("renais", "文艺复兴", "文艺复兴，穹顶与繁复雕饰"),
        D("industry", "近代工业", "近代工业，砖烟囱与铁架桥"),
        D("modern", "现代", "现代，玻璃幕墙与柏油路"),
        D("near", "近未来", "近未来，轻轨与全息屏"),
        D("far", "远未来星际", "远未来，星际港与反重力结构"),
        D("post", "末世之后", "末世之后，锈蚀与藤蔓吞没一切"),
        D("timeless", "不指定", "时代特征弱化，只保留材质与形制"),
    ])

    add("depthOfField", "景深层次", "limit", [
        D("macro", "极浅景深（微距感）", "极浅景深，只有一小块细节清晰，其余全部化开"),
        D("shallow", "浅景深（主体突出）", "浅景深，主体一层清晰，前后柔和虚化"),
        D("medium", "中景纵深（前景虚·中景实·远景淡）", "中景纵深，前景压虚、中景结实、远景渐次淡入"),
        D("deep", "全景深（远中近都清晰）", "全景深，远景中景近景都清晰可辨"),
        D("epic", "超广深景（天地层叠）", "极大的景深，天地层层铺开，纵深感强烈"),
        D("flat", "平面化（压缩空间）", "刻意压缩空间，画面趋于平面，像立绘背景板"),
    ])

    add("camera", "镜头构图", "limit", [
        D("wide", "广角远景", "广角远景，强调空间纵深"),
        D("eye", "平视中景", "平视中景，视线自然"),
        D("high", "高角度俯瞰", "高角度俯瞰，地形一览无余"),
        D("low", "低角度仰视", "低角度仰视，建筑压迫感强"),
        D("panorama", "超宽全景", "超宽全景构图"),
        D("closeup", "局部特写", "局部特写，聚焦材质与细节"),
        D("dutch", "倾斜构图", "略微倾斜的构图，制造不安"),
        D("one_point", "一点透视", "一点透视，线条向深处汇聚"),
        D("aerial", "航拍视角", "航拍视角，俯瞰整片区域"),
        D("frame", "框中取景", "透过门洞 / 窗框 / 拱券取景"),
    ])

    add("light", "光线", "limit", [
        D("backlight", "逆光轮廓", "强烈的逆光勾出轮廓"),
        D("tyndall", "丁达尔光束", "光柱穿过尘埃与雾气"),
        D("neon", "霓虹光", "青紫霓虹把街面染亮"),
        D("candle", "烛光", "摇曳的暖黄烛光"),
        D("moonlight", "月光", "清冷月光洒落"),
        D("lantern", "灯笼光", "成串灯笼映出暖色光晕"),
        D("spotlight", "聚光", "一束聚光打在中央"),
        D("diffuse", "漫射天光", "柔和的阴天漫射光"),
        D("fire", "火光", "跳动的橙红火光"),
        D("glow", "幽蓝微光", "地面与缝隙透出幽蓝微光"),
        D("sunset", "落日金光", "落日熔金，长影拖曳"),
        D("overcast", "灰调平光", "厚重云层下的灰调平光，没有明显投影"),
    ])

    add("color", "主色调", "limit", [
        D("coldblue", "冷蓝", "以冷蓝为主色调"),
        D("warmgold", "暖金", "以暖金为主色调"),
        D("bloodred", "血红", "以暗红为主色调"),
        D("teal", "青碧", "以青碧为主色调"),
        D("violet", "幽紫", "以幽紫为主色调"),
        D("green", "苍绿", "以苍绿为主色调"),
        D("gray", "灰白", "以灰白为主色调"),
        D("amber", "琥珀", "以琥珀色为主色调"),
    ])

    add("style", "画风", "limit", [
        D("realistic", "写实电影感", "写实电影感，真实材质"),
        D("painterly", "厚涂插画", "厚涂数字插画，笔触明显"),
        D("chinese", "国风插画", "国风工笔重彩插画"),
        D("anime", "日系动画", "日系动画背景美术"),
        D("cinematic", "电影概念图", "电影概念设定图，电影级调色"),
        D("concept", "游戏概念场景", "游戏场景概念设计图"),
        D("dark", "暗黑奇幻", "暗黑奇幻风格"),
        D("watercolor", "水彩", "水彩晕染"),
        D("ink", "水墨", "水墨写意，留白"),
    ])

    # ==================== 第二层：细节元素（跟地点走，可随机） ====================
    groups = [
        {"id": "limit", "name": "限定选项", "icon": "🎯",
         "desc": "这些由你手选，随机不会覆盖"},
    ]
    for pack_id, pack_name, icon, pack_dims in PACKS:
        gid = "el_" + pack_id
        groups.append({"id": gid, "name": pack_name, "icon": icon})
        for dim_id, dim_name, opts in pack_dims:
            add(dim_id, dim_name, gid, opts)
    # 元素维度上记一下它属于哪个包，前端按地点类型过滤时直接用
    for d in dims:
        if d["group"].startswith("el_"):
            d["pack"] = d["group"][3:]

    # ==================== 题材预设（只收敛限定项，不参与随机） ====================
    themes = [
        {"id": "xianxia", "name": "仙侠", "desc": "云海仙山、古寺道观",
         "cn": "东方仙侠世界，云雾缭绕的仙山与古刹",
         "colors": ["teal", "coldblue", "warmgold"],
         "pools": {"sceneType": ["mountain", "temple", "forest", "cliff", "sky", "bridge", "garden"],
                   "era": ["myth", "ancient"], "style": ["chinese", "ink", "painterly"],
                   "light": ["tyndall", "sunset", "moonlight", "lantern"],
                   "depthOfField": ["epic", "deep", "medium"], "camera": ["wide", "panorama", "high"]}},
        {"id": "cyberpunk", "name": "赛博朋克", "desc": "霓虹雨夜、钢铁都市",
         "cn": "赛博朋克都市，霓虹、雨水与全息广告",
         "colors": ["violet", "coldblue", "teal"],
         "pools": {"sceneType": ["town", "market", "lab", "spaceship", "port", "throne"],
                   "era": ["near", "post"], "style": ["cinematic", "realistic", "concept"],
                   "light": ["neon", "glow", "spotlight"],
                   "depthOfField": ["shallow", "medium", "deep"], "camera": ["low", "eye", "dutch"]}},
        {"id": "medieval", "name": "中世纪", "desc": "石堡、村庄与战场",
         "cn": "中世纪奇幻世界，石堡、村庄与旷野",
         "colors": ["gray", "warmgold", "green"],
         "pools": {"sceneType": ["castle", "village", "tavern", "battlefield", "ruins", "graveyard", "port"],
                   "era": ["medieval"], "style": ["realistic", "painterly", "dark"],
                   "light": ["diffuse", "fire", "sunset", "candle"],
                   "depthOfField": ["medium", "deep"], "camera": ["wide", "eye", "low"]}},
        {"id": "wasteland", "name": "废土", "desc": "荒漠、废墟与残骸",
         "cn": "末日废土，荒漠、锈蚀废墟与残骸",
         "colors": ["amber", "gray", "bloodred"],
         "pools": {"sceneType": ["ruins", "desert", "battlefield", "mine", "town"],
                   "era": ["post"], "style": ["realistic", "cinematic", "dark"],
                   "light": ["overcast", "sunset", "fire"],
                   "depthOfField": ["epic", "deep"], "camera": ["wide", "panorama", "high"]}},
        {"id": "japanese", "name": "和风", "desc": "神社、樱花与竹林",
         "cn": "日式和风，神社、樱花与竹林",
         "colors": ["teal", "warmgold", "violet"],
         "pools": {"sceneType": ["shrine", "garden", "village", "castle", "forest"],
                   "era": ["ancient", "medieval"], "style": ["anime", "painterly", "chinese"],
                   "light": ["diffuse", "lantern", "sunset", "moonlight"],
                   "depthOfField": ["medium", "shallow"], "camera": ["eye", "wide", "frame"]}},
        {"id": "steampunk", "name": "蒸汽朋克", "desc": "铜管、齿轮与雾都",
         "cn": "蒸汽朋克世界，铜管齿轮、浓雾与煤气灯",
         "colors": ["amber", "gray", "warmgold"],
         "pools": {"sceneType": ["town", "lab", "port", "mine", "library", "throne"],
                   "era": ["industry"], "style": ["painterly", "realistic", "cinematic"],
                   "light": ["lantern", "candle", "diffuse", "glow"],
                   "depthOfField": ["medium", "shallow"], "camera": ["eye", "low", "wide"]}},
        {"id": "darkfantasy", "name": "暗黑奇幻", "desc": "墓园、血月与魔窟",
         "cn": "暗黑奇幻，墓园、血月与魔窟",
         "colors": ["bloodred", "violet", "gray"],
         "pools": {"sceneType": ["graveyard", "castle", "cave", "swamp", "ruins", "throne"],
                   "era": ["medieval", "myth"], "style": ["dark", "painterly", "cinematic"],
                   "light": ["moonlight", "fire", "glow", "candle"],
                   "depthOfField": ["shallow", "medium"], "camera": ["low", "dutch", "closeup"]}},
        {"id": "underwater", "name": "深海遗迹", "desc": "水下古城与沉船",
         "cn": "深海中的古代遗迹，光线幽微",
         "colors": ["coldblue", "teal", "violet"],
         "pools": {"sceneType": ["ruins", "cave", "beach", "spaceship"],
                   "era": ["myth"], "style": ["cinematic", "concept", "realistic"],
                   "light": ["glow", "tyndall"],
                   "depthOfField": ["epic", "deep"], "camera": ["wide", "low", "eye"]}},
        {"id": "modern", "name": "现代都市", "desc": "高楼、地铁与夜景",
         "cn": "现代都市，高楼、街道与夜景",
         "colors": ["coldblue", "gray", "amber"],
         "pools": {"sceneType": ["town", "market", "port", "library", "academy", "lab"],
                   "era": ["modern"], "style": ["realistic", "cinematic"],
                   "light": ["overcast", "neon", "sunset", "diffuse"],
                   "depthOfField": ["medium", "deep"], "camera": ["eye", "wide", "one_point"]}},
        {"id": "plan_classroom", "name": "学校教室", "desc": "教室、桌椅成排、窗明几净",
         "cn": "学校教室，桌椅成排，窗明几净",
         "cat": "plan", "colors": ["warmgold", "gray", "teal"],
         "pools": {"sceneType": ["academy"], "era": ["modern"], "style": ["anime", "realistic"],
                   "light": ["diffuse", "tyndall"], "depthOfField": ["medium", "shallow"],
                   "camera": ["eye", "one_point", "wide"]}},
        {"id": "plan_cave", "name": "地下洞窟", "desc": "钟乳石、暗河与矿脉",
         "cn": "地下洞窟，钟乳石、暗河与矿脉",
         "cat": "plan", "colors": ["coldblue", "violet", "teal"],
         "pools": {"sceneType": ["cave", "mine"], "era": ["timeless", "myth"],
                   "style": ["realistic", "cinematic", "dark"],
                   "light": ["glow", "tyndall", "candle"], "depthOfField": ["deep", "epic"],
                   "camera": ["wide", "low", "closeup"]}},
        {"id": "plan_mall", "name": "商场", "desc": "现代商场、店铺林立",
         "cn": "现代商场，店铺林立，人流如织",
         "cat": "plan", "colors": ["coldblue", "warmgold", "violet"],
         "pools": {"sceneType": ["market", "town"], "era": ["modern"], "style": ["realistic", "concept"],
                   "light": ["neon", "spotlight", "diffuse"], "depthOfField": ["medium", "deep"],
                   "camera": ["eye", "wide", "one_point"]}},
        {"id": "plan_castle", "name": "宏伟城郭", "desc": "城堡、城郭、巍峨塔楼",
         "cn": "宏伟城郭，高墙塔楼，旗帜猎猎",
         "cat": "plan", "colors": ["warmgold", "gray", "bloodred"],
         "pools": {"sceneType": ["castle", "town", "manor"], "era": ["medieval", "ancient"],
                   "style": ["realistic", "painterly", "cinematic"],
                   "light": ["sunset", "tyndall", "candle"], "depthOfField": ["epic", "deep"],
                   "camera": ["low", "wide", "high"]}},
        {"id": "plan_duskforest", "name": "暮色森林", "desc": "林间空地、暮色迷离",
         "cn": "暮色森林，林间空地，雾气与微光",
         "cat": "plan", "colors": ["teal", "green", "coldblue"],
         "pools": {"sceneType": ["forest", "village", "garden"], "era": ["timeless", "ancient"],
                   "style": ["painterly", "anime", "cinematic"],
                   "light": ["tyndall", "moonlight", "sunset"], "depthOfField": ["shallow", "medium"],
                   "camera": ["eye", "wide", "frame"]}},
        {"id": "plan_snowvalley", "name": "雪山幽谷", "desc": "雪峰、冰谷、极寒",
         "cn": "雪山幽谷，冰封千里，寒气逼人",
         "cat": "plan", "colors": ["coldblue", "gray", "teal"],
         "pools": {"sceneType": ["mountain", "snowfield", "cave"], "era": ["timeless"],
                   "style": ["realistic", "cinematic"], "light": ["backlight", "diffuse", "moonlight"],
                   "depthOfField": ["epic", "deep"], "camera": ["wide", "panorama", "high"]}},
        {"id": "plan_temple", "name": "古寺道观", "desc": "古刹、道观、飞檐",
         "cn": "古寺道观，飞檐斗拱，香火与暮钟",
         "cat": "plan", "colors": ["warmgold", "teal", "amber"],
         "pools": {"sceneType": ["temple", "shrine", "garden"], "era": ["ancient", "medieval"],
                   "style": ["chinese", "painterly", "cinematic"],
                   "light": ["candle", "lantern", "tyndall"], "depthOfField": ["medium", "shallow"],
                   "camera": ["eye", "frame", "wide"]}},
        {"id": "plan_seaside", "name": "海滨小镇", "desc": "海岸、码头、小镇",
         "cn": "海滨小镇，白墙蓝顶，海风轻拂",
         "cat": "plan", "colors": ["warmgold", "teal", "amber"],
         "pools": {"sceneType": ["beach", "port", "town", "village"], "era": ["modern", "medieval"],
                   "style": ["realistic", "painterly", "anime"],
                   "light": ["sunset", "diffuse", "backlight"], "depthOfField": ["deep", "epic"],
                   "camera": ["wide", "panorama", "eye"]}},
        {"id": "plan_spacestation", "name": "太空站", "desc": "星舰、舱体、舷窗",
         "cn": "太空站内部，金属舱体，舷窗外的星海",
         "cat": "plan", "colors": ["coldblue", "violet", "teal"],
         "pools": {"sceneType": ["spaceship", "lab", "port"], "era": ["near", "far"],
                   "style": ["realistic", "concept", "cinematic"],
                   "light": ["neon", "glow", "spotlight"], "depthOfField": ["medium", "deep"],
                   "camera": ["one_point", "eye", "wide"]}},
        {"id": "plan_tavern", "name": "温暖酒馆", "desc": "酒馆、壁炉、木梁",
         "cn": "温暖酒馆，木梁壁炉，酒香与炉火",
         "cat": "plan", "colors": ["warmgold", "amber", "gray"],
         "pools": {"sceneType": ["tavern", "manor"], "era": ["medieval", "ancient"],
                   "style": ["realistic", "painterly", "cinematic"],
                   "light": ["candle", "lantern", "fire"], "depthOfField": ["shallow", "medium"],
                   "camera": ["eye", "frame", "closeup"]}},
        {"id": "plan_dungeon", "name": "地牢牢房", "desc": "铁栏、锁链、火把",
         "cn": "地牢牢房，铁栏锁链，火把幽光",
         "cat": "plan", "colors": ["gray", "bloodred", "amber"],
         "pools": {"sceneType": ["prison", "cave"], "era": ["medieval", "ancient"],
                   "style": ["realistic", "dark", "cinematic"],
                   "light": ["fire", "glow", "candle"], "depthOfField": ["shallow", "medium"],
                   "camera": ["eye", "low", "closeup"]}},
    ]

    for t in themes:
        t.setdefault("cat", "genre")

    return {"version": 2, "groups": groups, "dims": dims, "themes": themes}
