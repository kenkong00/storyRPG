# -*- coding: utf-8 -*-
"""MOSS-Image 边界框布局提示词编译。

画框编辑器交给我们的是「相对坐标（0~1）+ 每个框一段描述」，
这里把它编译成 MOSS-Image 认的布局提示词 —— 一个 JSON 字符串：

    {"summary":{"caption":"..."},"items":[{"label":"character","caption":"...","bbox":[...]}],
     "bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}

口径与官方 compile_prompt.py 完全一致（这里不重新发明）：

  · 画布宽高必须是 16 的倍数，且等于最终出图尺寸
  · bbox 以画布中心为原点：[y1-H/2, x1-W/2, y2-H/2, x2-W/2]
  · 左/上边向下取整、右/下边向上取整（先贴像素边再平移）
  · items 顺序 = 绘制顺序（后画的压在上面）
  · label 只能取 character / object / text；text 项必须带 text 原文

为什么不在这里算负数坐标给前端：坐标永远由我们生成，前端只传相对框，
换分辨率（比如从 1344×768 换到 832×1216）时构图自动等比缩放。
"""

import json
import math

LABELS = ("character", "object", "text", "scene")
TYPE_TO_LABEL = {
    "character": "character",
    "person": "character",
    "object": "object",
    "scene": "scene",
    "bg": "object",
    "text": "text",
}


def normalize_size(width, height, step=16):
    """把出图尺寸规整到 16 的倍数（官方硬要求，非 16 倍会被模型判非法）。"""
    def _one(v, fallback):
        try:
            n = int(round(float(v)))
        except (TypeError, ValueError):
            n = fallback
        n = max(step, int(round(n / step)) * step)
        return n

    return _one(width, 1344), _one(height, 768)


def _num(v, fallback=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return fallback
    return f if math.isfinite(f) else fallback


def _clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def _centered_box(x1, y1, x2, y2, width, height):
    """官方口径：先贴像素边（floor/ceil），再减去画布中心，输出 yxyx。"""
    x1 = max(0, min(width - 1, x1))
    y1 = max(0, min(height - 1, y1))
    x2 = max(x1 + 1, min(width, x2))
    y2 = max(y1 + 1, min(height, y2))
    box = [
        math.floor(y1) - height // 2,
        math.floor(x1) - width // 2,
        math.ceil(y2) - height // 2,
        math.ceil(x2) - width // 2,
    ]
    return box


def merge_blocks(pos_cn, drop_prefixes=("【画面】", "【取景】")):
    """把「【人物】…\\n【穿着】…」这类中文提示词块压成一句话，给画框当 caption。

    【画面】/【取景】是整图级别的构图指令（纯色背景、无人物、半身像…），
    放进某个画框的描述里会和画框定位打架，默认丢掉。
    """
    lines = []
    for raw in (pos_cn or "").split("\n"):
        s = (raw or "").strip()
        if not s:
            continue
        if any(s.startswith(p) for p in drop_prefixes):
            continue
        if s.startswith("【") and "】" in s:
            s = s[s.index("】") + 1:].strip()
        s = s.rstrip("，,。；; ")
        if s:
            lines.append(s)
    return "，".join(lines)


def _item_from_box(box, width, height):
    """相对框 → MOSS item；不合格（空描述 / 面积为零）返回 None。"""
    label = TYPE_TO_LABEL.get(str(box.get("type") or "object").lower(), "object")
    caption = str(box.get("caption") or "").strip()
    text = str(box.get("text") or "").strip()
    if label == "text":
        if not text:
            return None
        if not caption:
            caption = "画面中的排版文字，清晰可读"
    if not caption:
        return None

    x = _clamp01(_num(box.get("x"), 0))
    y = _clamp01(_num(box.get("y"), 0))
    w = _clamp01(_num(box.get("w"), 0))
    h = _clamp01(_num(box.get("h"), 0))
    # 允许 x+w 略微溢出（拖拽时手抖），编译前裁进画布
    x1, y1 = x * width, y * height
    x2, y2 = (x + w) * width, (y + h) * height
    if x2 - x1 < 1 or y2 - y1 < 1:
        return None

    item = {
        "label": label,
        "caption": caption,
        "bbox": _centered_box(x1, y1, x2, y2, width, height),
    }
    if label == "text":
        item["text"] = text
    # 把人物框关联的名字带进 item，编译提示词时直接标到段首，无需在 summary 里重复
    if box.get("character_name"):
        item["character_name"] = str(box["character_name"])
    return item


_LABEL_CN = {"character": "人物", "object": "景物", "text": "文字", "scene": "场景"}


def compile_layout(layout, width=None, height=None, base_prompt=None):
    """相对画框布局 → MOSS 布局提示词。

    返回 {"prompt": str, "layout_json": str, "width": int, "height": int,
          "count": int, "skipped": [{"caption": str, "reason": str}]}

    `prompt` 是一段**干净的文本**：每个画框的描述只出现一次（[整体] 行是场景级，
    不与任何画框重复；每个画框各占一行，带类型/人物名与 bbox 注解）。这样编辑框里
    看到的是什么、送进 ComfyUI 的就是什么，不再出现「summary 里一遍、items 里又一遍」。

    `layout_json` 保留结构化（bbox 坐标等）给 MOSS 节点消费。

    width / height 优先用调用方传入的（= 上方 ComfyUI 出图参数）。
    """
    layout = layout or {}
    w, h = normalize_size(
        width if width else layout.get("width"),
        height if height else layout.get("height"),
    )

    summary = str(layout.get("summary") or "").strip()
    boxes = layout.get("items") or layout.get("boxes") or []
    if not isinstance(boxes, list):
        boxes = []

    items, skipped = [], []
    seen_char = 0
    for box in boxes:
        if not isinstance(box, dict):
            continue
        it = _item_from_box(box, w, h)
        if it is None:
            why = "没有描述"
            if str(box.get("type") or "").lower() == "text" and not str(box.get("text") or "").strip():
                why = "文字框没有内容"
            skipped.append({"caption": str(box.get("caption") or "")[:40] or why, "reason": why})
            continue
        items.append(it)
        if it["label"] == "character":
            seen_char += 1

    if not items:
        return {"prompt": "", "layout_json": "", "width": w, "height": h, "count": 0,
                "skipped": skipped, "error": "还没有可用的画框：至少给一个框填上描述"}

    # 整体描述（summary.caption）：场景级 base_prompt 优先，再补上各人物描述，
    # 与 items 里每段描述各出现一次（MOSS 官方样例就是 summary 里一遍、items 里又一遍）。
    char_caps = [it["caption"] for it in items if it["label"] == "character"]
    parts = []
    if base_prompt and str(base_prompt).strip():
        parts.append(str(base_prompt).strip())
    if char_caps:
        parts.append("；".join(char_caps))
    summary_caption = "；".join(parts) if parts else "画面由以下区域组成（各区域按画框定位）"
    if summary:
        summary_caption = summary

    # 输出带 bbox 坐标的 MOSS 布局 JSON（abs_centralized / yxyx），与官方 compile_prompt 口径一致。
    # prompt 给编辑框/送 ComfyUI 看；layout_json 为紧凑版供节点消费。
    # character_name 只用于内部拼 summary，不进最终 items（对齐官方样例字段）。
    payload_items = []
    for it in items:
        pi = dict(it)
        pi.pop("character_name", None)
        payload_items.append(pi)
    payload = {
        "summary": {"canvas": "single", "caption": summary_caption},
        "items": payload_items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    layout_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    prompt_text = json.dumps(payload, ensure_ascii=False, indent=2)
    return {"prompt": prompt_text, "layout_json": layout_json, "width": w, "height": h,
            "count": len(items), "characters": seen_char, "skipped": skipped}
