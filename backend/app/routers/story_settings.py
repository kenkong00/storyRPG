"""剧情演出设置（全局单份，前后台共用）。

存在 story_setting 单行表的 JSON 里，不做一参数一列 —— 这类参数以后会长
（演出、自动播放、以后可能还有转场 / 字幕 / 打字速度），加一项不用改表。
读的时候用 DEFAULT_STORY_SETTINGS 合并，旧数据缺键自动补默认值。
"""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.story_setting import StorySetting

router = APIRouter(prefix="/api/story/settings", tags=["剧情演出设置"])

# 默认值 = 「我调好的那一套」，改这里等于改全站默认。
DEFAULT_STORY_SETTINGS: dict[str, Any] = {
    # ---- 说话人高亮 ----
    # subtle：说话者微亮、其他人微暗 —— 足够区分，又不会让画面忽明忽暗
    "stage_focus_mode": "subtle",
    "dim_brightness": 0.84,
    "dim_saturate": 0.88,
    "speak_brightness": 1.07,
    "speak_saturate": 1.03,
    "speak_glow": 0,          # 0 = 不加辉光（辉光容易显脏，默认关）
    "focus_transition_ms": 260,
    # ---- 自动播放 ----
    "auto_play_default": False,
    "auto_play_delay_ms": 900,   # 每句说完停顿多久再自动下一句
    "auto_play_stop_on_choice": True,
}

# 参数合法区间：前端也会拦，这里是最后一道，防止手改请求把画面调成黑屏。
NUM_RANGES: dict[str, tuple[float, float]] = {
    "dim_brightness": (0.2, 1.2),
    "dim_saturate": (0.0, 1.6),
    "speak_brightness": (0.7, 1.6),
    "speak_saturate": (0.0, 2.2),
    "speak_glow": (0, 100),
    "focus_transition_ms": (0, 2000),
    "auto_play_delay_ms": (0, 8000),
}

MODES = ("off", "subtle", "normal", "strong", "custom")


def _row(db: Session) -> StorySetting | None:
    return db.query(StorySetting).filter(StorySetting.id == 1).first()


def merged_settings(db: Session) -> dict[str, Any]:
    """默认值 + 库里存的值，保证前端永远拿到一份完整的键。"""
    import json as _json

    out = dict(DEFAULT_STORY_SETTINGS)
    row = _row(db)
    if row and row.data:
        try:
            saved = _json.loads(row.data)
            if isinstance(saved, dict):
                for k, v in saved.items():
                    if k in out:
                        out[k] = v
        except Exception:  # noqa: BLE001
            pass
    return normalize(out)


def normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """把外部传进来的值收敛到合法范围 / 合法取值。"""
    out = dict(DEFAULT_STORY_SETTINGS)
    for k, v in (raw or {}).items():
        if k not in out:
            continue
        if k in NUM_RANGES:
            lo, hi = NUM_RANGES[k]
            try:
                n = float(v)
            except (TypeError, ValueError):
                continue
            n = max(lo, min(hi, n))
            # 毫秒类是整数，其余保留两位小数（0.84 这种取值要能存住）
            out[k] = int(round(n)) if k.endswith("_ms") else round(n, 2)
        elif k in ("auto_play_default", "auto_play_stop_on_choice"):
            out[k] = bool(v)
        elif k == "stage_focus_mode":
            out[k] = v if v in MODES else DEFAULT_STORY_SETTINGS[k]
    return out


@router.get("")
def get_story_settings(db: Session = Depends(get_db)):
    row = _row(db)
    return {
        "settings": merged_settings(db),
        "defaults": DEFAULT_STORY_SETTINGS,
        "modes": list(MODES),
        "updated_at": (row.updated_at if row else None),
    }


@router.put("")
def put_story_settings(payload: dict, db: Session = Depends(get_db)):
    """支持部分更新：只传要改的键，其余保持不变。"""
    import json as _json

    cur = merged_settings(db)
    patch = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
    cur.update({k: v for k, v in (patch or {}).items() if k in DEFAULT_STORY_SETTINGS})
    clean = normalize(cur)

    row = _row(db)
    if row is None:
        row = StorySetting(id=1, data=_json.dumps(clean, ensure_ascii=False))
        db.add(row)
    else:
        row.data = _json.dumps(clean, ensure_ascii=False)
    db.commit()
    return {"ok": True, "settings": clean}


@router.post("/reset")
def reset_story_settings(db: Session = Depends(get_db)):
    import json as _json

    clean = dict(DEFAULT_STORY_SETTINGS)
    row = _row(db)
    if row is None:
        row = StorySetting(id=1, data=_json.dumps(clean, ensure_ascii=False))
        db.add(row)
    else:
        row.data = _json.dumps(clean, ensure_ascii=False)
    db.commit()
    return {"ok": True, "settings": clean}
