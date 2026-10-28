# -*- coding: utf-8 -*-
"""
动作表情库种子数据 —— 「动作 + 表情」合为一条，带可自定义分类。

为什么合并：单独给「动作」和「表情」两个下拉，实际出图时必须成对描述才有意义
（双手抱头 + 平静脸 = 说不通）。这里一条就是一句完整的动作表情描述，可直接喂模型。

分类用于：
1. 后台按分类筛选 / 批量生成（例如「给我出 10 个战斗动作」）；
2. 角色出场时按场景挑动作（战斗 / 日常对话 / 恋爱 / 成人互动…）；
3. 定向随机（随机时只在该分类内抽）。

每条格式：O(id, 中文名, 动作表情描述, 英文描述, cat=分类)
"""

from .seed_core import O

# 分类：可后台增删改
POSE_CATEGORIES = [
    {"id": "idle", "name": "待机姿态", "desc": "站/坐/蹲等静态基础姿态，用于立绘与设定图"},
    {"id": "battle", "name": "战斗动作", "desc": "持械、蓄力、出击、受击、格挡等战斗演出"},
    {"id": "magic", "name": "施法动作", "desc": "念咒、结印、召唤、法阵展开"},
    {"id": "daily", "name": "日常动作", "desc": "行走、吃喝、阅读、梳妆等生活片段"},
    {"id": "sport", "name": "运动动作", "desc": "跑跳、球类、泳姿、攀爬"},
    {"id": "emotion", "name": "情绪特写", "desc": "半身/胸像的情绪刻画，适合对话立绘"},
    {"id": "funny", "name": "搞笑动作", "desc": "夸张变形、滑稽反应、吐槽"},
    {"id": "love", "name": "恋爱互动", "desc": "害羞、牵手、拥抱、献吻等亲昵镜头"},
    {"id": "adult", "name": "成人互动", "desc": "成人向亲密演出（默认在后台开关控制显隐）"},
]


def P(pid, name, cn, en, cat, tags=None):
    return O(pid, name, cn, en, (tags or [cat]), cat=cat)


# 需要「第二个人」才能成立的动作（拥抱 / 牵手 / 跨坐…）。
# 单人立绘出图时如果抽到这类动作，画面会变成抱着空气，所以随机时一律跳过；
# 后台动作库仍可手动选中（比如以后做双人同框的剧情图）。
DUO = {
    "love_handHold", "love_hug", "love_backHug", "love_kissForehead",
    "love_leanShoulder", "love_piggyback", "love_dance",
    "adult_straddle", "adult_embraceBed", "adult_kissDeep", "adult_teaseUndress",
}


POSES = [
    # ===================== 待机姿态 =====================
    P("idle_stand", "标准站姿", "笔直站立，双手自然垂在身侧，平静地望向前方", "standing straight, arms at sides, calm gaze forward", "idle"),
    P("idle_contrapposto", "倚重站姿", "重心压在一侧腿上，另一侧脚尖轻点，姿态放松", "weight on one leg, contrapposto stance, relaxed", "idle"),
    P("idle_handsBack", "背手而立", "双手负在身后，微微抬着下巴，气度从容", "hands clasped behind back, chin slightly raised", "idle"),
    P("idle_armsCrossed", "抱臂而立", "双臂交叉抱在胸前，眼神淡淡的审视", "arms crossed over chest, appraising look", "idle"),
    P("idle_sit", "坐姿", "侧身坐在椅子边缘，一条腿叠在另一条上，双手放在膝上", "sitting on edge of chair, legs crossed, hands on knee", "idle"),
    P("idle_crouch", "蹲姿", "单膝蹲下，一手撑地，警觉地环视", "crouching on one knee, one hand on ground, alert", "idle"),
    P("idle_leanWall", "靠墙", "背靠墙壁，一条腿屈起，侧头看向镜头", "leaning against wall, one leg bent, head turned to camera", "idle"),
    P("idle_kneel", "单膝跪姿", "单膝跪地，一手按在膝上，垂眸", "kneeling on one knee, hand on thigh, eyes lowered", "idle"),
    P("idle_turnBack", "回眸", "背身而立，肩膀微转回头，只露出半张侧脸", "seen from behind, turning head over shoulder", "idle"),

    # ===================== 战斗动作 =====================
    P("battle_charge", "冲锋", "低身猛冲向前，一手护在身前，眉头紧锁咬牙前扑", "charging forward in a low sprint, arm guarding, teeth gritted", "battle"),
    P("battle_stance", "战斗架势", "双腿分开下沉成马步，双手握拳抬至胸前，眼神锐利", "wide low fighting stance, fists raised, sharp eyes", "battle"),
    P("battle_swordRaise", "举剑", "双手将武器高举过头，尖端朝天，气势凌厉", "both hands raising a weapon overhead, tip pointing up", "battle"),
    P("battle_slash", "横斩", "身体扭转，武器横扫出一道弧线，衣摆翻飞", "twisting body mid horizontal slash, clothes flaring", "battle"),
    P("battle_thrust", "突刺", "前腿蹬地，武器笔直刺出，全身绷紧", "lunging forward with a straight thrust, body taut", "battle"),
    P("battle_parry", "格挡", "双手横举武器格挡，被冲击力压得后仰", "blocking with weapon held horizontally, pushed back by impact", "battle"),
    P("battle_shield", "举盾防御", "举盾护住上身，肩部前顶，脸躲在盾沿后", "raising shield to guard upper body, face behind rim", "battle"),
    P("battle_dodge", "侧身闪避", "上身后仰侧闪，脚步错开，头发甩动", "leaning back to dodge sideways, feet staggered, hair swinging", "battle"),
    P("battle_jumpAttack", "跃击", "腾空跃起，双手举起武器向下劈落，衣袍鼓风", "leaping into the air, weapon raised for a downward strike", "battle"),
    P("battle_kick", "飞踢", "腾身高踢，支撑腿绷直，另一腿横扫", "mid-air high kick, support leg straight", "battle"),
    P("battle_punch", "出拳", "拧腰出直拳，拳锋向前，面部紧绷", "twisting into a straight punch, face tense", "battle"),
    P("battle_dualWield", "双持", "双手各持一把短刃，身体前倾呈交叉攻击姿态", "dual-wielding short blades in crossed attack stance", "battle"),
    P("battle_archery", "拉弓", "侧身拉满长弓，弦线贴颊，眼神锁定前方", "drawing a longbow to full draw, string to cheek", "battle"),
    P("battle_aim", "举枪瞄准", "双手端枪贴肩，侧头瞄准，一眼微眯", "aiming a rifle at shoulder, head tilted, one eye squinting", "battle"),
    P("battle_draw", "拔刀", "一手按住刀鞘，另一手握柄拔刀至半，冷冽抬眼", "half-drawn blade, hand on hilt, cold upward glance", "battle"),
    P("battle_afterHit", "受击后仰", "被击中后身体后仰，手臂甩开，嘴角溢出些许血", "knocked backward by a hit, arm flung, a trace of blood at lip", "battle"),
    P("battle_grounded", "倒地起身", "单手掌地撑起身体，一膝离地，抬头瞪向前方", "pushing up from the ground on one hand, one knee lifted, glaring up", "battle"),
    P("battle_roar", "怒吼", "抡起武器仰头怒吼，颈侧青筋暴起，气势外放", "roaring with weapon raised, head back, veins bulging", "battle"),
    P("battle_guardLow", "低姿戒备", "压低重心，武器斜指地面，随时准备暴起", "low guarded stance, weapon angled at ground, ready to spring", "battle"),
    P("battle_spin", "旋身回击", "原地旋身，武器随惯性划出圆弧，裙摆与长发飞散", "spinning in place, weapon sweeping an arc, skirt and hair flying", "battle"),
    P("battle_finisher", "终结一击", "凌空俯冲，武器带着光效劈落，瞳孔收缩", "diving down with a glowing finishing strike, pupils contracted", "battle"),

    # ===================== 施法动作 =====================
    P("magic_cast", "施法", "单手前伸张开五指，掌心浮起光团，眉梢微扬", "one hand extended with palm open, orb of light forming, brow raised", "magic"),
    P("magic_seal", "结印", "双手在胸前结成法印，指间缠绕光丝，双目微闭", "hands forming a seal at chest, threads of light between fingers, eyes half closed", "magic"),
    P("magic_summon", "召唤", "双臂张开向上托举，脚下法阵旋转亮起", "arms spread and lifted, glowing magic circle spinning underfoot", "magic"),
    P("magic_channel", "引导", "双手扶杖立于身前，杖顶晶石发出强光，衣袍被风灌满", "both hands on staff planted before, crystal blazing, robes billowing", "magic"),
    P("magic_chant", "咏唱", "仰头张唇低吟咒文，指尖浮起细密符文", "head tilted back chanting, runes rising around fingertips", "magic"),
    P("magic_hex", "诅咒", "一手前指，指尖渗出暗紫色雾气，笑容诡异", "pointing forward, dark violet mist seeping from fingertip, eerie smile", "magic"),
    P("magic_heal", "治愈", "双手合拢捧起柔和白光，垂眸温柔", "cupping gentle white light in both hands, eyes softly lowered", "magic"),
    P("magic_swordRain", "御剑", "并指一引，数柄飞剑绕身盘旋，衣袂猎猎", "fingers commanding flying swords circling the body, robes snapping", "magic"),

    # ===================== 日常动作 =====================
    P("daily_walk", "行走", "迈步前行，一手轻摆，目光平视", "walking forward mid-stride, one arm swinging, level gaze", "daily"),
    P("daily_stroll", "闲逛", "慢悠悠地走，双手插兜，神色松弛", "strolling slowly, hands in pockets, relaxed", "daily"),
    P("daily_run", "小跑", "轻快小跑，发丝向后飘，脸上带笑", "jogging lightly, hair streaming back, smiling", "daily"),
    P("daily_read", "阅读", "低头捧书细读，指尖压着书页，眉目专注", "reading a book held in both hands, fingertip on page, focused", "daily"),
    P("daily_drink", "喝水", "举杯到唇边浅啜，眼睛看向一旁", "sipping from a cup, eyes glancing aside", "daily"),
    P("daily_eat", "进食", "举筷夹起食物，腮边微鼓", "holding chopsticks with food, cheeks slightly puffed", "daily"),
    P("daily_cook", "烹饪", "系着围裙站在灶前翻炒，额头沾了一滴汗", "cooking at the stove in an apron, a bead of sweat on forehead", "daily"),
    P("daily_brushHair", "梳妆", "对镜梳理长发，一手扶起发丝", "brushing long hair before a mirror, one hand lifting strands", "daily"),
    P("daily_tea", "品茶", "双手捧着茶盏，吹了吹热气", "holding a teacup with both hands, blowing on the steam", "daily"),
    P("daily_write", "书写", "伏案执笔书写，身子微微前倾", "writing at a desk, leaning slightly forward", "daily"),
    P("daily_think", "沉思", "一手托着下巴，视线落向斜下方", "chin resting on one hand, gaze angled downward", "daily"),
    P("daily_lookBack", "回头", "行进中回头张望，表情带着疑问", "looking back over shoulder while walking, questioning look", "daily"),
    P("daily_wave", "挥手", "抬高手臂挥手打招呼，笑容明亮", "raising an arm to wave, bright smile", "daily"),
    P("daily_stretch", "伸懒腰", "双臂向上伸展，身体微微后仰，眼睛闭着", "stretching both arms overhead, leaning back, eyes closed", "daily"),
    P("daily_sleep", "小憩", "侧卧闭眼，头发散在枕上，呼吸平缓", "lying on one side asleep, hair spread on pillow", "daily"),
    P("daily_phone", "看手机", "低头盯着手机屏幕，拇指悬在屏上", "looking down at a phone, thumb hovering over screen", "daily"),
    P("daily_umbrella", "撑伞", "撑伞走在雨中，肩膀微微收紧", "walking in rain under an umbrella, shoulders drawn in", "daily"),
    P("daily_climb", "登高", "踩在石阶上向上攀行，一手扶着岩壁", "climbing stone steps, one hand on the rock face", "daily"),
    P("daily_carry", "搬运", "双手抱着堆叠的物件，身体微侧保持平衡", "carrying a stack of items in both arms, body tilted for balance", "daily"),
    P("daily_smoke", "点烟", "侧头就着火苗点烟，一手挡风", "lighting a cigarette, head tilted, one hand shielding the flame", "daily"),
    P("daily_tinker", "修理", "低头摆弄手里的机械零件，眉头微蹙", "tinkering with mechanical parts, brows faintly knit", "daily"),
    P("daily_music", "演奏", "低头拨动琴弦，指尖灵动", "plucking instrument strings, fingertips nimble", "daily"),

    # ===================== 运动动作 =====================
    P("sport_jump", "跳跃", "腾空跃起，双腿收拢，双臂上摆", "jumping into the air, legs tucked, arms swung up", "sport"),
    P("sport_sprint", "冲刺跑", "全力冲刺，身体前倾，手臂大幅摆动", "full sprint, body leaning forward, arms pumping", "sport"),
    P("sport_dunk", "扣篮", "单手高举篮球向篮筐砸下，身体拉成弧线", "one-handed dunk, body arched toward the hoop", "sport"),
    P("sport_kickBall", "踢球", "支撑腿稳固，另一腿抽射，上身拧转", "shooting a ball, plant leg firm, torso twisted", "sport"),
    P("sport_swing", "挥拍", "双手握拍挥出，重心前移，目光追球", "swinging a racket with both hands, weight forward, eyes on ball", "sport"),
    P("sport_swim", "游泳", "俯身划水，手臂前伸拨开水面", "mid-stroke swimming, arm extended through water", "sport"),
    P("sport_yoga", "瑜伽", "单腿站立，另一腿盘起，双手在头顶合十", "one-legged yoga balance, palms joined overhead", "sport"),
    P("sport_climb", "攀岩", "四肢撑在岩点上，身体紧贴岩壁", "climbing, limbs on holds, body close to the wall", "sport"),
    P("sport_skate", "滑板", "屈膝踩在滑板上，双臂张开保持平衡", "crouched on a skateboard, arms out for balance", "sport"),
    P("sport_boxing", "拳击", "双拳护脸，脚步轻点，身体左右晃动", "boxing guard, feet light, body weaving", "sport"),
    P("sport_ride", "骑马", "跨坐马背，手握缰绳，身体随马起伏", "riding a horse, hands on reins, body moving with the gait", "sport"),
    P("sport_stretch2", "压腿", "单腿架高拉伸，身体前倾压向膝盖", "stretching with one leg raised, torso folding forward", "sport"),

    # ===================== 情绪特写 =====================
    P("emo_smile", "微笑", "唇角轻扬的浅笑，眼睛弯起", "soft smile, eyes curved", "emotion"),
    P("emo_laugh", "大笑", "仰头大笑，眼睛眯成缝", "laughing with head tilted back, eyes squeezed shut", "emotion"),
    P("emo_angry", "愤怒", "眉头紧拧，牙关咬紧，眼中冒火", "brows knotted, jaw clenched, eyes blazing", "emotion"),
    P("emo_sad", "悲伤", "眼睫低垂，下唇微颤，泪水将落未落", "lashes lowered, lower lip trembling, tears about to fall", "emotion"),
    P("emo_cry", "哭泣", "泪水顺着脸颊滑落，肩膀轻颤", "tears running down cheeks, shoulders trembling", "emotion"),
    P("emo_shy", "害羞", "双颊泛红，视线躲闪，手背贴着唇", "cheeks flushed, gaze averted, back of hand at lips", "emotion"),
    P("emo_surprise", "惊讶", "眼睛睁大，嘴唇微张，肩膀一缩", "eyes wide, lips parted, shoulders shrinking", "emotion"),
    P("emo_fear", "恐惧", "瞳孔收缩，后退半步，手挡在身前", "pupils contracted, half a step back, hand raised defensively", "emotion"),
    P("emo_cold", "冷漠", "神情淡漠，眼皮半垂，毫无温度", "cold detached expression, eyelids half lowered", "emotion"),
    P("emo_smug", "得意", "挑高一侧眉毛，嘴角勾出笑意", "one brow arched, corner of mouth curled", "emotion"),
    P("emo_confused", "困惑", "歪着头，眉头拧成一团，嘴角下撇", "head tilted, brows knotted, mouth downturned", "emotion"),
    P("emo_thinking", "思索", "眼神上飘，手指轻敲太阳穴", "eyes drifting up, finger tapping temple", "emotion"),
    P("emo_determined", "坚定", "下颌微收，目光笔直坚定，唇线绷紧", "jaw set, gaze steady and determined, lips pressed", "emotion"),
    P("emo_tired", "疲惫", "眼下泛青，眼皮沉重，靠着支撑物", "dark circles under eyes, heavy lids, leaning on support", "emotion"),
    P("emo_pain", "痛楚", "紧咬牙关，额头渗汗，一手按住伤处", "teeth gritted, sweat on forehead, hand pressing a wound", "emotion"),
    P("emo_gentle", "温柔", "眼睫轻垂，唇角含着一丝暖意", "lashes lowered, a trace of warmth at the mouth", "emotion"),
    P("emo_tease", "挑逗", "眼角上挑，舌尖轻舔唇角", "eyes narrowed teasingly, tongue at the corner of the mouth", "emotion"),
    P("emo_blank", "失神", "目光空洞地望向远处，表情空白", "vacant distant stare, blank expression", "emotion"),
    P("emo_disgust", "嫌恶", "眉头一皱，头微微后倾", "brow wrinkling, head tilting back", "emotion"),
    P("emo_sleepyFace", "困倦", "打了个哈欠，眼角沁出泪花", "yawning, tears welling at eye corners", "emotion"),

    # ===================== 搞笑动作 =====================
    P("fun_faceplant", "扑街", "脸朝下扑倒在地，四肢摊平", "face-planting on the ground, limbs splayed", "funny"),
    P("fun_cryLoud", "嚎啕大哭", "张大嘴哭喊，眼泪像瀑布往下淌", "wailing with mouth wide open, tears streaming like a waterfall", "funny"),
    P("fun_shock", "震惊到变形", "下巴掉到胸口，眼睛凸出，全身僵直", "jaw dropped, eyes bulging, body rigid in shock", "funny"),
    P("fun_sneak", "偷偷摸摸", "弓着背踮脚潜行，手指竖在唇前", "sneaking on tiptoe, hunched, finger to lips", "funny"),
    P("fun_dizzy", "晕头转向", "眼睛打着圈圈，身体摇晃站不稳", "spiral eyes, swaying unsteadily", "funny"),
    P("fun_laughRoll", "笑到打滚", "捂着肚子弯下腰，笑得直不起身", "bent over clutching stomach, laughing helplessly", "funny"),
    P("fun_pose", "浮夸造型", "摆出夸张的姿势，一手叉腰一手指天", "exaggerated pose, one hand on hip, one pointing skyward", "funny"),
    P("fun_eatBig", "狼吞虎咽", "嘴塞得鼓鼓的，两手各抓一份食物", "cheeks stuffed, a snack in each hand", "funny"),
    P("fun_hide", "躲藏", "缩在箱子后面只露出半张脸", "hiding behind a box with half a face peeking out", "funny"),

    # ===================== 恋爱互动 =====================
    P("love_shyLook", "偷看", "站在一旁偷偷望过来，被发现后慌忙低头", "stealing a glance from the side, ducking head when noticed", "love"),
    P("love_handHold", "牵手", "伸出手与对方十指相扣，耳根发红", "interlocking fingers with partner, ears reddening", "love"),
    P("love_hug", "拥抱", "双臂环住对方脖颈，把脸埋进肩窝", "arms around partner's neck, face buried in their shoulder", "love"),
    P("love_backHug", "背后抱", "从背后环住对方腰，侧脸贴在背上", "hugging partner from behind, cheek against their back", "love"),
    P("love_kissForehead", "额吻", "低头在对方额头落下一吻，眼睛闭着", "kissing partner's forehead, eyes closed", "love"),
    P("love_offerFlower", "献花", "双手递出一束花，微微低头抬眼", "offering a bouquet with both hands, head lowered, glancing up", "love"),
    P("love_leanShoulder", "依偎", "把头靠在对方肩上，满足地闭眼", "head resting on partner's shoulder, eyes closed contentedly", "love"),
    P("love_confess", "告白", "涨红着脸大声说出心意，双手紧握在胸前", "confessing with a flushed face, hands clasped at chest", "love"),
    P("love_piggyback", "背着", "趴伏在对方背上，双腿环住腰", "riding piggyback, legs around partner's waist", "love"),
    P("love_dance", "共舞", "与对方相拥起舞，裙摆旋开", "dancing in partner's arms, skirt swirling open", "love"),
    P("love_weddingVeil", "披纱", "披上白色头纱，含羞垂眸", "wearing a white veil, shyly lowering eyes", "love"),

    # ===================== 成人互动（默认隐藏） =====================
    P("adult_undress", "宽衣", "肩头的衣物滑落一半，指尖勾着衣领，眼神勾人", "garment slipping off one shoulder, fingertip hooking the collar, inviting gaze", "adult"),
    P("adult_lying", "仰卧", "仰躺在床褥上，长发散开，手臂举过头顶", "lying on back on bedding, hair spread, arms above head", "adult"),
    P("adult_straddle", "跨坐", "跨坐在对方身上，俯身靠近，呼吸交缠", "straddling partner, leaning close, breaths mingling", "adult"),
    P("adult_embraceBed", "床榻相拥", "在床榻上紧紧相拥，肢体交缠", "tightly embracing on the bed, limbs entangled", "adult"),
    P("adult_kissDeep", "深吻", "捧住对方的脸深吻，气息紊乱", "cupping partner's face in a deep kiss, breath unsteady", "adult"),
    P("adult_bath", "共浴", "浸在热水中，水汽朦胧，肩膀露出水面", "soaking in hot water, steam hazy, shoulders above the surface", "adult"),
    P("adult_bondage", "束缚", "双手被缚于头顶，眼神半是抗拒半是期待", "wrists bound overhead, gaze half resisting, half expectant", "adult"),
    P("adult_teaseUndress", "撩拨", "半跪着替对方解开衣扣，抬眼观察反应", "kneeling to unbutton partner's clothes, glancing up for reaction", "adult"),
    P("adult_afterglow", "余韵", "侧躺着喘息，肌肤泛着薄汗", "lying on the side catching breath, skin sheened with sweat", "adult"),
]


# 需要特定武器才能成立的动作：题材里没有枪/弓时不该抽到
# （否则会拼出「仙侠修士双手端枪瞄准」）。
WEAPON_TAGS = {
    "battle_aim": "firearm",
    "battle_archery": "bow",
}


def build_pose_dim():
    """构造 pose / poseCategory 两个维度。"""
    cat_options = [O(c["id"], c["name"], cat=c["id"]) for c in POSE_CATEGORIES]
    poses = []
    for p in POSES:
        p = dict(p)
        tags = list(p.get("tags") or [])
        if p["id"] in DUO and "duo" not in tags:
            tags.append("duo")
        w = WEAPON_TAGS.get(p["id"])
        if w and w not in tags:
            tags.append(w)
        p["tags"] = tags
        poses.append(p)
    return [
        {"id": "poseCategory", "name": "动作分类", "group": "pose", "sensitive": False, "cond": None,
         "options": cat_options},
        {"id": "pose", "name": "动作表情", "group": "pose", "sensitive": False, "cond": None,
         "options": poses},
    ]
