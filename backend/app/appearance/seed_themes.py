# -*- coding: utf-8 -*-
"""
国籍（64 个）；题材统一由 theme_class.py 提供（4 个，只做参数约束）。

解决的核心问题：旧版随机是「纯均匀抽样」，想出一批「中国修仙角色」或「美国西部牛仔」完全做不到，
只能一次次重摇。现在：
- nationality 维度把国族/人种/传统服饰特征钉住；
- theme 只把各维度收敛到指定候选池（pools），题材本身不往提示词里加任何描述；
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

# ===================== 题材（4 个） =====================
# 题材定义搬到 theme_class.py：题材 × 职业 → 各维度候选池。
# 这里只做导出，保持其它模块 `seed_themes.THEMES` 的调用方式不变。
from .theme_class import theme_seed

THEMES = theme_seed()
