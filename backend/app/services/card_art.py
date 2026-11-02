# -*- coding: utf-8 -*-
"""卡面生图：把「卡牌 + 职业 + 性别 + 衣着 + 动作/表情」拼成一条中文提示词，交给 ComfyUI。

为什么单独一层：
  · 提示词要能在后台逐项改（模板、动作、表情、职业衣着），不能散落在调用处；
  · 同职业的卡面必须一眼看出是同一套衣服 → 衣着模板挂在职业上；
  · 卡面动作/表情跟着卡牌效果走（「盾击」就得是撞盾的动作），所以挂在卡牌上。

拼装顺序（模板可改）：
  职业画风 → 人物（姓名/性别/年龄/发型瞳色） → 服装（职业+性别） → 动作 → 表情 → 构图 → 画质
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from .. import jobs
from ..appearance import generator as appgen
from ..models.cardgame import CardArt, CardClass, CardDef, CardEmotion, CardSetting

# 一次只让一张卡面占着 ComfyUI。批量提交时其余任务在「排队中」，
# 既不会把显存打爆，任务面板也能如实显示「还有几张没跑」。
_RUN_GATE = threading.Semaphore(1)


def _global_gen_params() -> dict:
    """读取全局出图参数（所有出图入口共用的那一份），读取失败回退空字典。

    面板里「步数覆盖 / CFG 覆盖 / 种子 / 随机 / 批量张数」只有真正进到出图请求里才生效，
    否则只是存着好看——这里就是把这些覆盖值喂给出图引擎的地方。
    """
    try:
        from ..comfyui.config_store import ComfyUIConfigStore
        return ComfyUIConfigStore().get_gen_params("global")
    except Exception:  # noqa: BLE001
        return {}


# 旧版默认模板（花括号占位符那套）。库里若还存着出厂默认的这几份原文，说明用户没自定义过模板，
# 此时走新的「外观维度」拼装；只有手写过其它模板才继续按模板拼（旧兼容，不打扰）。
_OLD_DEFAULT_TEMPLATE = (
    "{style}\n"
    "【人物】{name}，{gender}{age}{head}\n"
    "【服装】{outfit}\n"
    "【动作】{action}\n"
    "【表情】{expression}\n"
    "【构图】半身像，竖版 2:3，人物居中，头部位于画面上三分之一，"
    "深色渐变背景，边缘金色描边辉光，卡牌插画规格\n"
    "【画质】厚涂笔触，电影级侧逆光，材质与金属高光清晰，细节锐利，无文字，无水印，无边框"
)

# 另一份出厂短模板（只到【表情】，结尾两个换行）
_OLD_SHORT_TEMPLATE = (
    "{style}\n"
    "【人物】{name}，{gender}{age}{head}\n"
    "【服装】{outfit}\n"
    "【动作】{action}\n"
    "【表情】{expression}\n\n"
)


def _is_legacy_template(t: str) -> bool:
    """判断是否出厂占位符模板（忽略首尾空白）。是 → 走外观维度拼装。"""
    t = (t or "").strip()
    if not t:
        return False
    return t == _OLD_DEFAULT_TEMPLATE.strip() or t == _OLD_SHORT_TEMPLATE.strip()

DEFAULTS = {
    # 模板留空 = 走「外观维度拼装」：画风 → 人物外观（发型/瞳色/衣着/体型…）→ 动作/表情/构图/画质。
    # 外观维度从哪来见 compose：卡牌角色外观 > 外观配置 > 人物默认外观 > 职业英雄外观。
    "art_template": "",
    "art_negative": "文字，水印，签名，多个人物，拼接，畸变手指，模糊，低分辨率，边框，UI",
    "art_model_preset": "Moss_int8_5步",
    "art_width": "512",
    "art_height": "768",
    "art_framing": "half",
    "art_auto_apply": "1",
    # 当前启用的「题材」（4 题材 × 6 职业 参数矩阵）。__none__ = 不用题材，回到手写画风。
}

GENDER_CN = {"male": "男", "female": "女", "unknown": ""}


# ===================== 设置 =====================
def get_settings(db: Session) -> dict:
    out = dict(DEFAULTS)
    for row in db.query(CardSetting).all():
        out[row.key] = row.value
    return out


def set_settings(db: Session, patch: dict) -> dict:
    for key, value in (patch or {}).items():
        if value is None:
            continue
        row = db.query(CardSetting).filter(CardSetting.key == key).first()
        if row:
            row.value = str(value)
        else:
            db.add(CardSetting(key=key, value=str(value)))
    db.commit()
    return get_settings(db)


# ===================== 卡面套装 =====================
def list_sets(db: Session) -> list:
    from ..models.cardgame import CardArtSet
    return (db.query(CardArtSet)
            .order_by(CardArtSet.sort, CardArtSet.id).all())


def get_set(db: Session, code: str):
    from ..models.cardgame import CardArtSet
    if code:
        row = db.query(CardArtSet).filter(CardArtSet.code == code).first()
        if row:
            return row
    # 没指定 / 找不到：退回当前激活的那套，再退回任意一套
    row = db.query(CardArtSet).filter(CardArtSet.is_active == 1).first()
    if row:
        return row
    return db.query(CardArtSet).order_by(CardArtSet.id).first()


def active_set_code(db: Session) -> str:
    row = get_set(db, "")
    return row.code if row else "default"


def ensure_default_set(db: Session):
    """没有默认套装就建一个（老库升级 / 手动清库后都要能自愈）。"""
    from ..models.cardgame import CardArtSet
    row = db.query(CardArtSet).filter(CardArtSet.code == "default").first()
    if row:
        return row
    row = CardArtSet(code="default", name="默认套装", note="系统自动创建",
                     is_active=1 if db.query(CardArtSet).count() == 0 else 0,
                     sort=0, enabled=1)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def set_stats(db: Session, set_code: str) -> dict:
    """这一套的完整度：多少张卡已经有图了。"""
    total = db.query(CardDef).filter(CardDef.enabled == 1).count()
    rows = (db.query(CardArt.card_code)
            .filter(CardArt.set_code == set_code, CardArt.image_url != "")
            .distinct().all())
    done = len({r[0] for r in rows if r[0]})
    return {"total": total, "done": done, "missing": max(0, total - done)}


def set_dict(db: Session, s) -> dict:
    st = set_stats(db, s.code)
    return {
        "id": s.id, "code": s.code, "name": s.name, "note": s.note,
        "art_style": s.art_style,
        "outfit_male": s.outfit_male, "outfit_female": s.outfit_female,
        "outfit_other": s.outfit_other,
        "is_active": s.is_active, "sort": s.sort, "enabled": s.enabled,
        "created_at": s.created_at, "updated_at": s.updated_at,
        **st,
    }


def missing_codes(db: Session, set_code: str) -> list:
    cards = db.query(CardDef).filter(CardDef.enabled == 1).order_by(CardDef.sort).all()
    have = {r[0] for r in (db.query(CardArt.card_code)
                           .filter(CardArt.set_code == set_code, CardArt.image_url != "")
                           .distinct().all()) if r[0]}
    return [c.code for c in cards if c.code not in have]


def apply_set(db: Session, set_code: str) -> dict:
    """激活一套卡面：把这套在每张卡上的最新有图版本写回 card_defs。

    这一步是「整套换」的核心。别的套装的图完全不删、不改，
    所以从 A 套装切到 B 套装再切回 A，A 套装还是原来那 30 张。
    """
    from ..models.cardgame import CardArtSet
    row = db.query(CardArtSet).filter(CardArtSet.code == set_code).first()
    if not row:
        raise ValueError("套装不存在")

    db.query(CardArtSet).update({CardArtSet.is_active: 0}, synchronize_session=False)
    row.is_active = 1

    applied = skipped = 0
    arts = (db.query(CardArt)
            .filter(CardArt.set_code == set_code, CardArt.image_url != "")
            .order_by(CardArt.id).all())
    # 同卡多版：取最新那版（id 最大）
    latest = {}
    for a in arts:
        latest[a.card_code] = a          # 已按 id 升序，最后写入的就是最新
    if latest:
        db.query(CardArt).filter(CardArt.card_code.in_(list(latest))).update(
            {CardArt.is_active: 0}, synchronize_session=False)
    for code, a in latest.items():
        card = db.query(CardDef).filter(CardDef.code == code).first()
        if not card:
            continue
        a.is_active = 1
        card.image_url = a.image_url
        card.art_status = "done"
        applied += 1

    all_cards = db.query(CardDef).filter(CardDef.enabled == 1).count()
    skipped = max(0, all_cards - applied)
    row.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.commit()
    return {"ok": True, "set_code": set_code, "set_name": row.name,
            "applied": applied, "kept": skipped, "total": all_cards}


def start_generate_set(db: Session, set_code: str, only_missing: bool = True,
                       class_code: str = "", gender: str = "") -> dict:
    """一次性把一整套里缺的卡面全部提交（不覆盖别的套装）。"""
    from ..models.cardgame import CardArtSet
    row = db.query(CardArtSet).filter(CardArtSet.code == set_code).first()
    if not row:
        raise ValueError("套装不存在")

    codes = missing_codes(db, set_code) if only_missing else [
        c.code for c in db.query(CardDef).filter(CardDef.enabled == 1)
        .order_by(CardDef.sort).all()]
    if not codes:
        return {"submitted": 0, "total": 0, "items": [], "message": "这一套已经齐了"}

    items = []
    submitted = 0
    for code in codes:
        try:
            one = start_generate(db, code, class_code=class_code,
                                 gender=gender or "female", set_code=set_code)
            submitted += 1
            items.append({"card_code": code, "ok": True,
                          "job_id": one["job_id"], "art_id": one["art_id"]})
        except Exception as exc:  # noqa: BLE001
            items.append({"card_code": code, "ok": False, "error": str(exc)[:200]})
    return {"submitted": submitted, "total": len(codes), "items": items,
            "set_code": set_code, "set_name": row.name}


# ===================== 提示词拼装 =====================
def _head_summary(appearance: dict) -> str:
    """从人物外观里抽头部特征，让卡面人物和立绘是同一个人。"""
    if not appearance:
        return ""
    parts = []
    for dim, suffix in (("hairstyle", ""), ("hairColor", "色"), ("eyeShape", ""),
                        ("eyeColor", "色瞳孔"), ("skin", "色皮肤")):
        val = appearance.get(dim)
        if not val:
            continue
        try:
            name = appgen._opt_cn(dim, val)  # noqa: SLF001 复用外观系统同一套中文名
        except Exception:
            name = ""
        if not name or name in ("无", "默认"):
            continue
        parts.append(name + suffix if suffix and not name.endswith(suffix) else name)
    return ("，" + "，".join(parts)) if parts else ""


class _AppSkin:
    """把「人物」换上一套外观 skin，但身份（id / 名字 / 性别）不变。

    只为了传给 compose 读 appearance_json，其它属性全部代理回原对象。
    """

    __slots__ = ("_src", "appearance_json")

    def __init__(self, src, appearance_json):
        object.__setattr__(self, "_src", src)
        object.__setattr__(self, "appearance_json", appearance_json)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_src"), name)


def get_card_profile(db: Session, character_id: int):
    """取「卡牌角色」覆盖配置（没有就是 None）。"""
    try:
        from ..models.cardgame import CardCharacterProfile
        if not character_id:
            return None
        return (db.query(CardCharacterProfile)
                .filter(CardCharacterProfile.character_id == int(character_id)).first())
    except Exception:  # noqa: BLE001
        return None


def _load_preset_appearance(db: Session, pid: int, character_id: int):
    """按外观配置 id 取一套外观 JSON（包成可直接读取的字符串）。"""
    try:
        from ..models.character import CharacterAppearance
        preset = db.query(CharacterAppearance).filter(
            CharacterAppearance.id == int(pid),
            CharacterAppearance.character_id == int(character_id)).first()
        if preset and preset.appearance_json:
            return preset.appearance_json
    except Exception:  # noqa: BLE001
        pass
    return None


def _card_framing_text(framing):
    """卡面构图文案：随外观取景（全身 / 半身 / 头部特写）变化。"""
    framing = (framing or "half")
    if framing == "full":
        return "全身像，竖版 2:3，人物全身居中，深色渐变背景，边缘金色描边辉光，卡牌插画规格"
    if framing == "head":
        return "头部特写，竖版 2:3，面部居中，深色渐变背景，边缘金色描边辉光，卡牌插画规格"
    return "半身像，竖版 2:3，人物居中，头部位于画面上三分之一，深色渐变背景，边缘金色描边辉光，卡牌插画规格"


_CARD_QUALITY_TEXT = "厚涂笔触，电影级侧逆光，材质与金属高光清晰，细节锐利，无文字，无水印，无边框"


def compose(db: Session, card: CardDef, cls: Optional[CardClass], gender: str = "female",
            character=None, settings: Optional[dict] = None,
            art_set=None, apply_profile_appearance: bool = True,
            appearance_override=None, style_override: str = "",
            outfit_override=None, prefix_override: str = "", suffix_override: str = "") -> dict:
    """返回 {positive, negative, width, height, model_preset, parts, ...}

    art_set：卡面套装。它带画风/衣着覆盖时优先用它 —— 这样「B 套装」可以是一身白衣，
    「A 套装」还是职业原本的铠甲，两套并存，谁也不会把谁改掉。

    画风/衣着优先级（高 → 低）：实时覆盖 > 卡牌角色 > 卡面套装 > 职业 > 兜底文案。

    外观来源优先级（取第一份非空）：
        实时覆盖 appearance_override > 卡牌角色完整外观 appearance_json
        > 外观配置 appearance_id > 人物默认外观 > 职业英雄外观

    模板：art_template 为空 / 仍是旧占位符默认 → 走「外观维度拼装」；
          手写过的自定义模板 → 尊重原模板 format()（旧兼容，不打扰）。
    """
    st = settings or get_settings(db)
    gender = (gender or "female").lower()
    if gender not in ("male", "female", "unknown"):
        gender = "unknown"

    # ---- 卡牌角色覆盖：卡面用哪套外观 / 画风 / 衣着 / 前后缀 ----
    prof = get_card_profile(db, getattr(character, "id", 0)) if character is not None else None
    if prof is not None and not int(getattr(prof, "enabled", 1) or 0):
        prof = None

    # ---- 外观：逐级取第一份非空 ----
    appearance = {}
    if isinstance(appearance_override, dict) and appearance_override:
        appearance = dict(appearance_override)  # 预览页没保存的实时值，优先级最高
    else:
        prof_app = ""
        if prof is not None and apply_profile_appearance:
            prof_app = (getattr(prof, "appearance_json", "") or "").strip()
        if prof_app:
            try:
                appearance = json.loads(prof_app) or {}
            except Exception:
                appearance = {}
        else:
            # 外观配置（appearance_id 指定的那套）：包一层“假人物”让下面的通用读取生效
            if prof is not None and apply_profile_appearance:
                pid = int(getattr(prof, "appearance_id", 0) or 0)
                if pid:
                    preset = _load_preset_appearance(db, pid, getattr(character, "id", 0))
                    if preset:
                        character = _AppSkin(character, preset)
            if character is not None and getattr(character, "appearance_json", None):
                try:
                    appearance = json.loads(character.appearance_json) or {}
                except Exception:
                    appearance = {}
                if not isinstance(appearance, dict):
                    appearance = {}
            # 职业英雄外观：没有具体人物 / 人物没配外观时兜底
            if not appearance and cls is not None:
                try:
                    appearance = (json.loads(cls.appearance_json)
                                  if (cls.appearance_json or "").strip() else {})
                except Exception:
                    appearance = {}

    # 性别以人物档案优先，其次才是外观里的性别，再其次参数
    g = (getattr(character, "gender", None) or appearance.get("gender") or gender)
    g = g if g in ("male", "female") else "unknown"

    # 套装的覆盖字段（空字符串 = 不覆盖，沿用职业）
    s_style = (getattr(art_set, "art_style", "") or "").strip()
    s_male = (getattr(art_set, "outfit_male", "") or "").strip()
    s_female = (getattr(art_set, "outfit_female", "") or "").strip()
    s_other = (getattr(art_set, "outfit_other", "") or "").strip()

    # 卡牌角色覆盖（其次优先）
    p_style = (getattr(prof, "style_override", "") or "").strip() if prof else ""
    p_male = (getattr(prof, "outfit_male", "") or "").strip() if prof else ""
    p_female = (getattr(prof, "outfit_female", "") or "").strip() if prof else ""
    p_other = (getattr(prof, "outfit_other", "") or "").strip() if prof else ""

    # 实时覆盖（预览页没保存的值）压在最上面
    o_ov = outfit_override if isinstance(outfit_override, dict) else {}
    p_male = str(o_ov.get("outfit_male") or "").strip() or p_male
    p_female = str(o_ov.get("outfit_female") or "").strip() or p_female
    p_other = str(o_ov.get("outfit_other") or "").strip() or p_other
    live_style = (style_override or "").strip()
    s_style = live_style or p_style or s_style
    s_male = p_male or s_male
    s_female = p_female or s_female
    s_other = p_other or s_other

    if cls is not None:
        if g == "male":
            outfit = s_male or cls.outfit_male or cls.outfit_other or ""
        elif g == "female":
            outfit = s_female or cls.outfit_female or cls.outfit_other or ""
        else:
            outfit = (s_other or cls.outfit_other
                      or s_female or cls.outfit_female or s_male or cls.outfit_male or "")
        style = s_style or cls.art_style or ""
        fallback_name = cls.name or ""
    else:
        outfit = s_other or s_male or s_female or "与该卡牌效果相称的奇幻服装"
        style = s_style or "暗黑奇幻卡牌插画，戏剧性侧光，厚涂质感，深色背景"
        fallback_name = ""

    name = (getattr(character, "name", None) or appearance.get("name") or fallback_name or card.name or "")
    age = appgen.age_text(appearance.get("age")) if appearance.get("age") else ""
    head = _head_summary(appearance)
    framing = appearance.get("framing") or (st.get("art_framing") or "half")

    # 动作 / 表情：留空就不写这一行（只要外观）。以前强制用卡牌效果文案兜底，
    # 想「只出外观」永远做不到 —— 用户要的是「动作有个『无』的默认值」。
    action = (card.art_action or "").strip()
    if action in ("无", "-", "none", "None", "不写", "无动作"):
        action = ""
    expression = (card.art_expression or "").strip()
    if expression in ("无", "-", "none", "None", "不写"):
        expression = ""
    extra = card.art_extra or ""

    # ---- 模板：空 / 出厂占位符模板 → 外观维度拼装；手写自定义模板 → 原 format ----
    raw_template = (st.get("art_template") or "").strip()
    use_default_assembly = (not raw_template or _is_legacy_template(raw_template))

    if use_default_assembly:
        # 外观维度拼装：画风 → 【人物】【风格】【体型】【头部】【身体】【穿着】 → 动作/表情/构图/画质。
        # 外观完全没有内容时，保持空 → 走下面的字段兜底（人物+服装），行为和旧版一致。
        p_app = dict(appearance)
        if p_app:
            if not p_app.get("name") and name:
                p_app["name"] = name
            if not p_app.get("gender") and g in ("male", "female"):
                p_app["gender"] = g
            # 外观状态（完整着装 / 上半裸 / 下半裸 / 全裸）由编辑器的下拉决定，
            # 和「人物外观拼装」走同一套拼装逻辑 —— 以前这里被强制写死成 none，
            # 于是卡牌页怎么改外观状态，提示词都不会变，玩家当然以为「没有这个变化」。
            # 「默认」= 不指定，此时按完整着装处理（与人物外观拼装一致）。
            if not p_app.get("nudity"):
                p_app["nudity"] = "none"
        portrait = appgen.to_prompt(
            p_app, include_sensitive=False, framing=framing,
            include_pose=False, include_scene=False)
        if portrait:
            # 外观没配衣物键时 portrait 里没有【穿着】段：用职业/套装着装文本兜底，
            # 别让卡面提示词连穿什么都没描述。
            p_lines = portrait.splitlines()
            has_cloth = any(l.startswith("【穿着】") for l in p_lines)
            if outfit and not has_cloth:
                p_lines.append(f"【穿着】{outfit}")
                portrait = "\n".join(p_lines)
                has_cloth = True
            lines = []
            if style:
                lines.append(style)
            lines.append(portrait)
            if action:
                lines.append(f"【动作】{action}")
            if expression:
                lines.append(f"【表情】{expression}")
            if extra:
                lines.append(f"【附加】{extra}")
            lines.append("【构图】" + _card_framing_text(framing))
            lines.append("【画质】" + _CARD_QUALITY_TEXT)
            positive = "\n".join(lines)
        else:
            # 外观一个维度都没配：回到字段拼装（人物+服装），行为与旧版一致
            g_cn = ('，' + GENDER_CN.get(g, '')) if g in ("male", "female") else ''
            cloth_text = outfit
            positive = "\n".join(filter(None, [
                style,
                f"【人物】{name}{g_cn}{('，' + age) if age else ''}{head}",
                f"【服装】{cloth_text}",
                (f"【动作】{action}" if action else ""),
                (f"【表情】{expression}" if expression else ""),
                (f"【附加】{extra}" if extra else ""),
                "【构图】" + _card_framing_text(framing),
                "【画质】" + _CARD_QUALITY_TEXT,
            ]))
    else:
        fields = {
            "style": style,
            "name": name,
            "gender": GENDER_CN.get(g, ""),
            "age": ("，" + age) if age else "",
            "head": head,
            "outfit": outfit,
            "action": action,
            "expression": expression,
            "extra": extra,
            "card": card.name,
            "class": (cls.name if cls else "通用"),
        }
        try:
            positive = raw_template.format(**fields)
        except Exception:
            positive = "\n".join(filter(None, [
                style, f"【人物】{name}{GENDER_CN.get(g, '')}{age}{head}",
                f"【服装】{outfit}", f"【动作】{fields['action']}",
                f"【表情】{fields['expression']}",
            ]))

    # ComfyUI 出图参数（模型方案 / 宽 / 高）统一读「全局出图参数」，
    # 卡牌设置里不再各存一份 —— 否则人物/场景/卡牌三处尺寸会互相打架。
    try:
        from ..comfyui.config_store import ComfyUIConfigStore
        _gp = ComfyUIConfigStore().get_gen_params("global")
    except Exception:  # noqa: BLE001
        _gp = {}
    width = int(_gp.get("width") or st.get("art_width") or 512)
    height = int(_gp.get("height") or st.get("art_height") or 768)
    model_preset = (_gp.get("model_preset")
                    or st.get("art_model_preset") or DEFAULTS["art_model_preset"])
    # 前/后置拼接：实时覆盖 > 卡牌角色，贴在整段最外面，留空不影响
    p_pre = (getattr(prof, "prefix_prompt", "") or "").strip() if prof else ""
    p_suf = (getattr(prof, "suffix_prompt", "") or "").strip() if prof else ""
    pre = (prefix_override or "").strip() or p_pre
    suf = (suffix_override or "").strip() or p_suf
    if pre:
        positive = pre + "\n" + positive
    if suf:
        positive = positive + "\n" + suf

    # 负面词：全局负面词 + 题材专属负面词（武侠别出板甲、魔兽别出和服）
    negative = st.get("art_negative") or DEFAULTS["art_negative"]

    return {
        "positive": positive.strip(),
        "negative": negative,
        "width": width,
        "height": height,
        "model_preset": model_preset,
        "gender": g,
        "parts": {
            "style": style,
            "name": name,
            "gender": GENDER_CN.get(g, ""),
            "age": ("，" + age) if age else "",
            "head": head,
            "outfit": outfit,
            "action": action,
            "expression": expression,
            "extra": extra,
            "card": card.name,
            "class": (cls.name if cls else "通用"),
        },
        "profile_applied": bool(prof),
        "appearance": appearance,
        "framing": framing,
        # 题材套装信息（后台预览要显示「这张卡吃的是哪一套」，免得又是「改了没反应」的误会）
    }


# ===================== 角色情感表现（战斗中的一张图 + 一句话） =====================
# 「情感与表现」里手写提示词时用的固定负面词。
# 刻意不读 settings：用户明确要求这一块和「提示词与设置」彻底解耦，
# 那边改模板 / 改负面词，不该把已经调好的情感提示词带跑。
EMOTION_NEGATIVE = ("文字，水印，签名，多个人物，拼接，畸变手指，模糊，低分辨率，边框，UI")


def _out_params(db: Session, settings: Optional[dict] = None) -> dict:
    """出图三件套（宽 / 高 / 模型方案）：全局出图参数优先，其次卡牌设置默认。"""
    st = settings or get_settings(db)
    try:
        from ..comfyui.config_store import ComfyUIConfigStore
        gp = ComfyUIConfigStore().get_gen_params("global")
    except Exception:  # noqa: BLE001
        gp = {}
    return {
        "width": int(gp.get("width") or st.get("art_width") or 512),
        "height": int(gp.get("height") or st.get("art_height") or 768),
        "model_preset": (gp.get("model_preset") or st.get("art_model_preset")
                         or DEFAULTS["art_model_preset"]),
    }


def compose_emotion(db: Session, character, emotion, ce=None,
                    settings: Optional[dict] = None) -> dict:
    """复用卡面那套拼装：同一个角色，只换动作与神情。

    这正是「每个角色的个性化情感」要的东西 —— 脸、发型、衣服不变，
    变的只有「做大哭/暴怒/冷笑时的那一瞬间」。

    例外：`prompt_text` 非空的行是「独立提示词」（情感与表现页里直接写的那段），
    这种行**完全不经过**卡牌模板，也不读「提示词与设置」里的模板与负面词 ——
    否则用户改个模板，之前手写好的情感提示词就被悄悄改掉了。
    """
    from types import SimpleNamespace

    own = (getattr(ce, "prompt_text", "") or "").strip() if ce is not None else ""
    if own:
        out = _out_params(db, settings)
        # 前后置拼接对独立提示词同样生效：前置贴最前、后置贴最后
        prefix = (getattr(ce, "prefix_prompt", "") or "").strip()
        suffix = (getattr(ce, "suffix_prompt", "") or "").strip()
        positive = "\n".join([x for x in (prefix, own, suffix) if x])
        return {
            "positive": positive,
            "negative": EMOTION_NEGATIVE,
            "width": out["width"],
            "height": out["height"],
            "model_preset": out["model_preset"],
            "gender": (getattr(character, "gender", "") or ""),
            "parts": {},
            "profile_applied": False,
            "standalone": True,
        }

    emo_name = getattr(emotion, "name", "情绪")
    action = (getattr(ce, "action_prompt", "") or "").strip() or f"做出「{emo_name}」时的肢体动作"
    expr = (getattr(ce, "expression_prompt", "") or "").strip() or f"「{emo_name}」的神情"

    fake = SimpleNamespace(name=emo_name, desc="", art_action=action,
                           art_expression=expr, art_extra="")

    cls = None
    try:
        from ..models.cardgame import CardLoadout
        lo = (db.query(CardLoadout)
              .filter(CardLoadout.character_id == getattr(character, "id", 0))
              .first())
        if lo and lo.class_code and lo.class_code != "universal":
            cls = db.query(CardClass).filter(CardClass.code == lo.class_code).first()
    except Exception:  # noqa: BLE001
        cls = None

    # 指定了外观配置 → 用那套外观（发型/发色/瞳色/肤色/衣着）参与拼装。
    # 只换一层「外观皮肤」，人物身份与职业不变，所以卡面仍是同一个人。
    # 优先级：这一条情感自己选的 > 卡牌角色完整外观 > 卡牌角色里选的 > 人物默认外观。
    prof = get_card_profile(db, getattr(character, "id", 0))
    char_for_compose = character
    aid = int(getattr(ce, "appearance_id", 0) or 0) if ce is not None else 0
    if not aid and prof is not None:
        aid = int(getattr(prof, "appearance_id", 0) or 0)
    if aid:
        try:
            from ..models.character import CharacterAppearance
            preset = db.query(CharacterAppearance).filter(
                CharacterAppearance.id == aid,
                CharacterAppearance.character_id == getattr(character, "id", 0)).first()
            if preset:
                char_for_compose = SimpleNamespace(
                    id=getattr(character, "id", 0),
                    name=getattr(character, "name", ""),
                    gender=getattr(character, "gender", ""),
                    appearance_json=preset.appearance_json
                    or getattr(character, "appearance_json", ""))
        except Exception:  # noqa: BLE001
            char_for_compose = character
    elif prof is not None and (getattr(prof, "appearance_json", "") or "").strip():
        # 卡牌角色自己配了完整外观 → 直接用这份（自由拼装维度）
        char_for_compose = SimpleNamespace(
            id=getattr(character, "id", 0),
            name=getattr(character, "name", ""),
            gender=getattr(character, "gender", ""),
            appearance_json=prof.appearance_json)

    composed = compose(db, fake, cls, gender="", character=char_for_compose,
                       settings=settings, apply_profile_appearance=False)

    # 两个自定义拼接框：前缀贴在整段最前、后缀贴在最后（留空不影响）。
    prefix = (getattr(ce, "prefix_prompt", "") or "").strip() if ce is not None else ""
    suffix = (getattr(ce, "suffix_prompt", "") or "").strip() if ce is not None else ""
    if prefix:
        composed["positive"] = prefix + "\n" + composed["positive"]
    if suffix:
        composed["positive"] = composed["positive"] + "\n" + suffix
    return composed


def _run_emotion_image(job_id: str, ce_id: int, positive: str, negative: str,
                       width: int, height: int, model_preset: str):
    """线程：出一张情感图，成功后写回 card_character_emotions.image_url。"""
    from ..database import SessionLocal
    from ..routers import comfyui as comfyui_router
    from ..models.cardgame import CardCharacterEmotion

    waited = not _RUN_GATE.acquire(blocking=False)
    if waited:
        try:
            jobs.update(job_id, status="queued", message="排队中：前面还有图在生成")
        except Exception:  # noqa: BLE001
            pass
        _RUN_GATE.acquire()
    try:
        jobs.update(job_id, status="running", message="正在生成")
    except Exception:  # noqa: BLE001
        pass

    db = SessionLocal()
    try:
        jobs.gate(job_id)
        ggp = _global_gen_params()
        _steps = int(ggp.get("steps") or 0) or None
        _cfg = float(ggp.get("cfg") or 0) or None
        _seed_mode = (ggp.get("seed_mode") or "random")
        _random = _seed_mode != "fixed"
        _seed = None if _random else int(ggp.get("seed") if ggp.get("seed") is not None else 0)
        _batch = max(1, int(ggp.get("count") or 1))
        payload = comfyui_router.GenerateReq(
            positive=positive, negative=negative or None, mode="t2i",
            prompt_lang="cn", width=width, height=height,
            steps=_steps, cfg=_cfg, seed=_seed, seed_mode=_seed_mode,
            batch_size=_batch,
            filename_prefix="card_emotion", model_preset=model_preset or None,
            use_active_model_preset=not bool(model_preset), random_seed=_random,
            ctx={"source": "card_emotion", "ce_id": ce_id, "job_id": job_id},
        )
        resp = comfyui_router.generate(payload)
        jobs.gate(job_id)
        images = resp.get("images") or []
        if not images:
            raise RuntimeError("ComfyUI 未返回图片")
        url = images[0]
        row = db.query(CardCharacterEmotion).filter(
            CardCharacterEmotion.id == ce_id).first()
        if row:
            row.image_url = url
            row.job_id = job_id
            db.commit()
        item = {"url": url, "width": width, "height": height}
        jobs.step(job_id, ok=True, result=item, image=url, message="情感图已生成")
        jobs.update(job_id, render=item)
        jobs.finish(job_id, status="done", message="情感图已生成")
    except jobs.JobCanceled:
        db.rollback()
        jobs.finish(job_id, status="canceled", message="已取消")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        jobs.fail(job_id, f"情感图生成失败：{exc}")
    finally:
        db.close()
        try:
            _RUN_GATE.release()
        except Exception:  # noqa: BLE001
            pass


def start_generate_emotion(db: Session, character_id: int, emotion_code: str,
                           action_prompt: str = "", expression_prompt: str = "",
                           prefix_prompt: Optional[str] = None,
                           suffix_prompt: Optional[str] = None,
                           appearance_id: Optional[int] = None,
                           prompt_text: Optional[str] = None) -> dict:
    """建/复用一行情感表现，拼提示词，起出图任务。"""
    from ..models.cardgame import CardCharacterEmotion
    from ..models.character import Character

    ch = db.query(Character).filter(Character.id == int(character_id)).first()
    if not ch:
        raise ValueError("角色不存在")
    emo = db.query(CardEmotion).filter(CardEmotion.code == emotion_code).first()
    if not emo:
        raise ValueError("情感不存在")

    ce = db.query(CardCharacterEmotion).filter(
        CardCharacterEmotion.character_id == int(character_id),
        CardCharacterEmotion.emotion_code == emotion_code).first()
    if not ce:
        ce = CardCharacterEmotion(character_id=int(character_id),
                                  emotion_code=emotion_code, enabled=1)
        db.add(ce)
    if action_prompt:
        ce.action_prompt = action_prompt
    if expression_prompt:
        ce.expression_prompt = expression_prompt
    if prefix_prompt is not None:
        ce.prefix_prompt = prefix_prompt
    if suffix_prompt is not None:
        ce.suffix_prompt = suffix_prompt
    if appearance_id is not None:
        ce.appearance_id = int(appearance_id or 0)
    if prompt_text is not None:
        # 独立提示词：写了就用它原文出图（空串 = 回到模板拼装）
        ce.prompt_text = prompt_text
    db.commit()
    db.refresh(ce)

    composed = compose_emotion(db, ch, emo, ce)
    job = jobs.create("card_emotion", f"情感表现 · {ch.name} · {emo.name}",
                      page="cards", total=1,
                      focus={"character_id": ch.id, "emotion_code": emotion_code,
                             "tab": "emotions"})
    jobs.spawn(jobs.guard, job["id"], _run_emotion_image, job["id"], ce.id,
               composed["positive"], composed["negative"],
               composed["width"], composed["height"], composed["model_preset"])
    return {"ok": True, "job_id": job["id"], "ce_id": ce.id,
            "prompt": composed["positive"],
            "width": composed["width"], "height": composed["height"]}


# ===================== 生成（后台任务） =====================
def _run_generate(job_id: str, art_id: int, card_code: str, positive: str,
                  negative: str, width: int, height: int, model_preset: str,
                  set_code: str = "default"):
    """线程里跑：自己开 DB 会话，避免与请求线程的 session 打架。"""
    from ..database import SessionLocal
    from ..routers import comfyui as comfyui_router

    # 一次只让 ComfyUI 跑一张。一次提交 5 张时，5 个任务会同时出现在任务面板里，
    # 但真正占 GPU 的只有一个，其余如实显示「排队中」——这才是队列该有的样子。
    waited = not _RUN_GATE.acquire(blocking=False)
    if waited:
        try:
            jobs.update(job_id, status="queued", message="排队中：前面还有卡面在生成")
        except Exception:  # noqa: BLE001
            pass
        _RUN_GATE.acquire()
    try:
        jobs.update(job_id, status="running", message="正在生成")
    except Exception:  # noqa: BLE001
        pass

    db = SessionLocal()
    try:
        jobs.gate(job_id)
        # 全局出图参数：步数 / CFG / 种子 / 随机 / 批量张数 全部从这里取，
        # 保证「设置页改一处、卡面出图同步生效」。
        ggp = _global_gen_params()
        _steps = int(ggp.get("steps") or 0) or None
        _cfg = float(ggp.get("cfg") or 0) or None
        _seed_mode = (ggp.get("seed_mode") or "random")
        _random = _seed_mode != "fixed"
        _seed = None if _random else int(ggp.get("seed") if ggp.get("seed") is not None else 0)
        _batch = max(1, int(ggp.get("count") or 1))
        payload = comfyui_router.GenerateReq(
            positive=positive,
            negative=negative or None,
            mode="t2i",
            prompt_lang="cn",
            width=width,
            height=height,
            steps=_steps,
            cfg=_cfg,
            seed=_seed,
            seed_mode=_seed_mode,
            batch_size=_batch,
            filename_prefix=f"card_{card_code}",
            model_preset=model_preset or None,
            use_active_model_preset=not bool(model_preset),
            random_seed=_random,
            ctx={"source": "card_art", "card_code": card_code, "job_id": job_id},
        )
        resp = comfyui_router.generate(payload)
        jobs.gate(job_id)

        images = resp.get("images") or []
        if not images:
            raise RuntimeError("ComfyUI 未返回图片")
        url = images[0]
        meta = (resp.get("meta") or [{}])[0]

        art = db.query(CardArt).filter(CardArt.id == art_id).first()
        if art:
            art.image_url = url
            art.width = int(meta.get("width") or width)
            art.height = int(meta.get("height") or height)
            art.prompt = positive
            art.negative = negative or ""
            art.job_id = job_id

        # 自动启用：但只在「这套就是当前激活套」时才顶上 card_defs.image_url。
        # 后台在 B 套装里点生成时，A 套装正在用的卡面绝不能被顺手改掉
        # —— 这正是用户说的「在现有卡牌上直接换装不太好」。
        st = get_settings(db)
        card = db.query(CardDef).filter(CardDef.code == card_code).first()
        if card:
            card.art_status = "done"
            if str(st.get("art_auto_apply", "1")) == "1" and set_code == active_set_code(db):
                card.image_url = url
                if art:
                    db.query(CardArt).filter(CardArt.card_code == card_code).update(
                        {CardArt.is_active: 0}, synchronize_session=False)
                    art.is_active = 1
        db.commit()

        item = {"url": url, "width": art.width if art else width,
                "height": art.height if art else height}
        jobs.step(job_id, ok=True, result=item, image=url, message="卡面已生成")
        jobs.update(job_id, render=item)
        jobs.finish(job_id, status="done", message="卡面已生成")
    except jobs.JobCanceled:
        db.rollback()
        _mark_failed(art_id, "已取消")
        jobs.finish(job_id, status="canceled", message="已取消")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _mark_failed(art_id, str(exc))
        jobs.fail(job_id, f"卡面生成失败：{exc}")
    finally:
        db.close()
        try:
            _RUN_GATE.release()
        except Exception:  # noqa: BLE001
            pass


def _mark_failed(art_id: int, msg: str) -> None:
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        art = db.query(CardArt).filter(CardArt.id == art_id).first()
        if art:
            art.job_id = ""
        card = db.query(CardDef).filter(CardDef.code == art.card_code).first() if art else None
        if card:
            card.art_status = "failed"
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def start_generate(db: Session, card_code: str, class_code: str = "",
                   gender: str = "", character_id: int | None = None,
                   prompt_override: str | None = None,
                   set_code: str = "") -> dict:
    """建任务 + 起线程，立即返回 job_id。

    set_code 指定这张图归到哪一套卡面；留空 = 当前激活的那套。
    """
    card = db.query(CardDef).filter(CardDef.code == card_code).first()
    if not card:
        raise ValueError("卡牌不存在")
    ensure_default_set(db)
    set_row = get_set(db, set_code)
    set_code = set_row.code if set_row else "default"

    cls = None
    if class_code:
        cls = db.query(CardClass).filter(CardClass.code == class_code).first()
    elif card.class_code != "universal":
        cls = db.query(CardClass).filter(CardClass.code == card.class_code).first()

    character = None
    if character_id:
        from ..models.character import Character
        character = db.query(Character).filter(Character.id == character_id).first()

    composed = compose(db, card, cls, gender or "female", character, art_set=set_row)
    positive = (prompt_override or "").strip() or composed["positive"]

    art = CardArt(
        card_code=card_code,
        class_code=(cls.code if cls else "universal"),
        set_code=set_code,
        gender=composed["gender"],
        character_id=character_id,
        prompt=positive,
        negative=composed["negative"],
        width=composed["width"],
        height=composed["height"],
        model_preset=composed["model_preset"],
    )
    db.add(art)
    card.art_status = "running"
    db.commit()
    db.refresh(art)

    job = jobs.create("card_art", f"卡面生成 · {card.name}" +
                      (f" · {set_row.name}" if set_row and set_row.code != "default" else ""),
                      page="cards", total=1,
                      focus={"card_code": card_code, "art_id": art.id,
                             "set_code": set_code, "tab": "sets"})
    jobs.spawn(jobs.guard, job["id"], _run_generate, job["id"], art.id, card_code,
               positive, composed["negative"], composed["width"], composed["height"],
               composed["model_preset"], set_code)
    return {"ok": True, "job_id": job["id"], "job": job, "art_id": art.id,
            "set_code": set_code, "set_name": (set_row.name if set_row else ""),
            "prompt": positive, "width": composed["width"], "height": composed["height"]}


def apply_art(db: Session, art_id: int) -> dict:
    """手动把某一版卡面设为「这张卡现在用的图」。

    只在同一个套装内部换版本：如果这一版属于 B 套装，而当前激活的是 A 套装，
    那它不该被直接顶上卡面 —— 否则套装就被单张操作打乱了。
    """
    art = db.query(CardArt).filter(CardArt.id == art_id).first()
    if not art:
        raise ValueError("卡面版本不存在")
    card = db.query(CardDef).filter(CardDef.code == art.card_code).first()
    if not card:
        raise ValueError("卡牌不存在")

    set_code = art.set_code or "default"
    active = active_set_code(db)
    if set_code != active:
        # 换到别的套装去：先把那套设为激活（整副换），再把用户点的这一版顶到这张卡上
        art_id_keep = art.id
        apply_set(db, set_code)
        db.query(CardArt).filter(CardArt.card_code == art.card_code,
                                CardArt.set_code == set_code).update(
            {CardArt.is_active: 0}, synchronize_session=False)
        picked = db.query(CardArt).filter(CardArt.id == art_id_keep).first()
        if picked and picked.image_url:
            picked.is_active = 1
            card.image_url = picked.image_url
            db.commit()
        return {"ok": True, "card_code": card.code, "image_url": card.image_url,
                "switched_set": set_code,
                "message": f"这一版属于「{set_code}」套装，已顺带把整套切过去"}

    db.query(CardArt).filter(CardArt.card_code == art.card_code,
                            CardArt.set_code == set_code).update(
        {CardArt.is_active: 0}, synchronize_session=False)
    art.is_active = 1
    card.image_url = art.image_url
    db.commit()
    return {"ok": True, "card_code": card.code, "image_url": art.image_url}

