# -*- coding: utf-8 -*-
"""漫画页排版预设。

只做「几何」——给格子算外接框和多边形，不碰提示词。
三种形态各有一套默认排版：
    页漫   manga-classic（上下满幅 + 中间分栏，最像日本漫画的起手式）
    小人书 splash（一页一格满幅）
    条漫   scroll-3（三条纵向堆叠，宽度占满）

斜构图不是「摆一个旋转的矩形」，而是真的改多边形：
    points 里存的是相对外接框的归一化顶点，梯形 / 平行四边形都能表达。
"""

from __future__ import annotations


def _rect(x, y, w, h):
    return {"x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "points": None, "rotation": 0}


def build(name: str, W: int, H: int, margin: int = 0, gap: int = 12) -> list[dict]:
    W, H, margin, gap = int(W), int(H), int(margin or 0), int(gap or 0)
    iw = max(120, W - margin * 2)
    ih = max(120, H - margin * 2)
    L, T = margin, margin

    if name == "splash":
        return [_rect(L, T, iw, ih)]

    if name == "scroll-3":
        hh = (ih - gap * 2) / 3
        return [_rect(L, T + i * (hh + gap), iw, hh) for i in range(3)]

    if name == "scroll-4":
        hh = (ih - gap * 3) / 4
        return [_rect(L, T + i * (hh + gap), iw, hh) for i in range(4)]

    if name == "grid-2x2":
        cw = (iw - gap) / 2
        ch = (ih - gap) / 2
        cells = [_rect(L, T, cw, ch)]
        cells.append(_rect(L + cw + gap, T, cw, ch))
        cells.append(_rect(L, T + ch + gap, cw, ch))
        cells.append(_rect(L + cw + gap, T + ch + gap, cw, ch))
        return cells

    if name == "grid-3rows":
        ch = (ih - gap * 2) / 3
        return [_rect(L, T + i * (ch + gap), iw, ch) for i in range(3)]

    if name == "grid-6":
        cw = (iw - gap) / 2
        ch = (ih - gap * 2) / 3
        cells = []
        for r in range(3):
            for c in range(2):
                cells.append(_rect(L + c * (cw + gap), T + r * (ch + gap), cw, ch))
        return cells

    if name == "manga-classic":
        # 上：满幅开场；中：右大左小（右先读）；下：满幅收尾
        h1 = ih * 0.40
        h2 = ih * 0.30 - gap
        h3 = ih - h1 - h2 - gap * 2
        y1 = T
        y2 = y1 + h1 + gap
        y3 = y2 + h2 + gap
        big_w = iw * 0.58
        small_w = iw - big_w - gap
        cells = [
            _rect(L, y1, iw, h1),
            _rect(L + small_w + gap, y2, big_w, h2),   # 右侧大格（先读）
            _rect(L, y2, small_w, h2),                  # 左侧小格
            _rect(L, y3, iw, h3),
        ]
        return cells

    if name == "manga-action":
        # 左侧大格压场，右侧两条窄格（适合动作 + 反应镜头）
        big_w = iw * 0.62
        small_w = iw - big_w - gap
        hh = (ih - gap) / 2
        return [
            _rect(L, T, big_w, ih),
            _rect(L + big_w + gap, T, small_w, hh),
            _rect(L + big_w + gap, T + hh + gap, small_w, hh),
        ]

    if name == "manga-diagonal":
        # 斜构图：两格共享**同一条**斜线（上格底边 == 下格顶边），
        # 外接框上下各占 70% 相互重叠，靠 points 把各自裁成梯形。
        # 关键：两条裁切线必须落在同一条直线上，否则会交叉出一个白色楔形缺口。
        span = 0.70                      # 每格外接框占页高的比例
        h_up = ih * span
        h_dn = ih * span
        y_up = T
        y_dn = T + ih - h_dn
        c0 = T + ih * 0.70               # 裁切线在左边的高度（页面绝对坐标）
        c1 = T + ih * 0.30               # 裁切线在右边的高度
        hg = gap / 2.0                   # 分镜缝各让一半
        up = _rect(L, y_up, iw, h_up)
        up["points"] = [
            [0.0, 0.0], [1.0, 0.0],
            [1.0, round((c1 - hg - y_up) / h_up, 4)],
            [0.0, round((c0 - hg - y_up) / h_up, 4)],
        ]
        dn = _rect(L, y_dn, iw, h_dn)
        dn["points"] = [
            [0.0, round((c0 + hg - y_dn) / h_dn, 4)],
            [1.0, round((c1 + hg - y_dn) / h_dn, 4)],
            [1.0, 1.0], [0.0, 1.0],
        ]
        return [up, dn]

    if name == "manga-3slash":
        # 三段斜切：三条同向倾斜的带子，像格斗漫的连续动作条
        hh = (ih - gap * 2) / 3
        cells = []
        for i in range(3):
            c = _rect(L, T + i * (hh + gap), iw, hh)
            c["points"] = [[0.0, 0.07], [1.0, 0.0], [1.0, 0.93], [0.0, 1.0]]
            cells.append(c)
        return cells

    if name == "manga-rotated":
        # 两格带旋转：斜着摆，中间留白
        cw = iw * 0.55
        ch = ih * 0.36
        a = _rect(L + iw * 0.05, T + ih * 0.06, cw, ch)
        a["rotation"] = -4
        b = _rect(L + iw * 0.40, T + ih * 0.52, cw, ch)
        b["rotation"] = 3
        return [a, b]

    if name == "lianhuanhua-2":
        # 小人书偶尔也用上下两格
        h1 = ih * 0.55
        return [_rect(L, T, iw, h1), _rect(L, T + h1 + gap, iw, ih - h1 - gap)]

    # 兜底：一格满幅
    return [_rect(L, T, iw, ih)]


def split_rect(x, y, w, h, mode="v", gap=10):
    x, y, w, h = int(x), int(y), int(w), int(h)
    gap = int(gap or 0)
    if mode == "h":            # 横着切（上下两格）
        hh = (h - gap) / 2
        return [(x, y, w, hh), (x, y + hh + gap, w, h)]
    if mode == "grid":
        cw = (w - gap) / 2
        ch = (h - gap) / 2
        return [(x, y, cw, ch), (x + cw + gap, y, cw, ch),
                (x, y + ch + gap, cw, ch), (x + cw + gap, y + ch + gap, cw, ch)]
    if mode == "3":            # 竖着切成三条
        cw = (w - gap * 2) / 3
        return [(x + i * (cw + gap), y, cw, h) for i in range(3)]
    cw = (w - gap) / 2         # 默认竖着切（左右两格）
    return [(x, y, cw, h), (x + cw + gap, y, cw, h)]


def catalog() -> list[dict]:
    """给前端「套用版式」弹窗用的清单。"""
    return [
        {"id": "manga-classic", "name": "页漫 · 经典三行", "modes": ["manga"],
         "desc": "上满幅 + 中分栏 + 下满幅"},
        {"id": "manga-action", "name": "页漫 · 大格压场", "modes": ["manga"],
         "desc": "左侧大格 + 右侧两条窄格"},
        {"id": "manga-diagonal", "name": "页漫 · 斜切两格", "modes": ["manga"],
         "desc": "两格共享一条斜线，斜构图"},
        {"id": "manga-3slash", "name": "页漫 · 三段斜切", "modes": ["manga"],
         "desc": "三条斜向分格，适合连续动作"},
        {"id": "manga-rotated", "name": "页漫 · 旋转双格", "modes": ["manga"],
         "desc": "两格倾斜摆放，中间留白"},
        {"id": "grid-2x2", "name": "页漫 · 四格", "modes": ["manga"],
         "desc": "标准 2×2"},
        {"id": "grid-3rows", "name": "页漫 · 三行", "modes": ["manga"],
         "desc": "上中下三等分"},
        {"id": "grid-6", "name": "页漫 · 六格", "modes": ["manga"],
         "desc": "2×3"},
        {"id": "splash", "name": "整页满幅", "modes": ["manga", "lianhuanhua"],
         "desc": "一页一格（小人书标准）"},
        {"id": "lianhuanhua-2", "name": "上下两格", "modes": ["lianhuanhua", "manga"],
         "desc": "上下两格"},
        {"id": "scroll-3", "name": "条漫 · 三格", "modes": ["scroll"],
         "desc": "纵向三格"},
        {"id": "scroll-4", "name": "条漫 · 四格", "modes": ["scroll"],
         "desc": "纵向四格"},
        {"id": "blank", "name": "空白页", "modes": ["manga", "scroll", "lianhuanhua"],
         "desc": "不铺格子，自己拉框"},
    ]
