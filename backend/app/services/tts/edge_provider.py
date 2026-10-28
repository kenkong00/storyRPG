"""Edge TTS 在线引擎 —— 默认主引擎。

选用理由（实测数据，2026-09-30 本机）：
  - zh-CN 有 8 个音色、4 男 4 女，还带性格标签，足够给每个角色配辨识度
  - 单句 1.4~2.6s、输出 MP3 27~35KB（本机 OneCore 是未压缩 WAV，107KB，大 3 倍）
代价是需要联网，且单句延迟明显高于本机，所以必须靠 service 层的预取来掩盖。

实现要点：
  edge_tts 是 asyncio 库，而这里的 _do_synthesize 是同步签名。
  每次调用都在独立线程里起一个临时事件循环跑完再关掉 ——
  不能用 asyncio.run() 套全局 loop 的原因是：service 层会用线程池并发跑多个合成，
  asyncio.run() 在同一线程里嵌套会产生 loop 冲突，独立线程 + 独立 loop 最稳。
"""
from __future__ import annotations

import asyncio
import os
import time

from .base import (
    TTSException,
    SynthRequest,
    TTSProvider,
    Voice,
    GENDER_MALE,
    GENDER_UNKNOWN,
    AGE_ADULT,
    GROUP_DIALECT,
    GROUP_MULTILINGUAL,
    GROUP_REGIONAL,
    GROUP_STANDARD,
)
from . import catalog

# 后台下拉里的分组顺序：普通话最常用排最前，地区口音最后
_GROUP_ORDER = {
    GROUP_STANDARD: 0,
    GROUP_DIALECT: 1,
    GROUP_REGIONAL: 2,
    GROUP_MULTILINGUAL: 3,
}


def _group_for_locale(locale: str) -> str:
    """目录里没登记的音色，按 Locale 猜一个分组，别让它掉进「普通话」里误导用户。"""
    if locale.startswith("zh-CN-"):
        return GROUP_DIALECT      # zh-CN-liaoning 这类是方言
    if locale.startswith("zh-"):
        return GROUP_REGIONAL     # zh-HK / zh-TW
    if not locale.startswith("zh"):
        return GROUP_MULTILINGUAL  # 非中文 Locale 只可能是白名单里的多语言音色
    return GROUP_STANDARD

try:  # 依赖缺失时不能让整个应用崩，降级由 registry 处理
    import edge_tts
    EDGE_AVAILABLE = True
except Exception:  # noqa: BLE001
    edge_tts = None
    EDGE_AVAILABLE = False


class EdgeTTSProvider(TTSProvider):
    """Edge TTS（微软 Edge 在线合成）。语速/音调/音量都是相对偏移。"""

    engine_id = "edge"
    display_name = "Edge TTS（在线 · 推荐）"
    requires_network = True

    def __init__(self, timeout_sec: float = 20.0, voice_ttl_sec: float = 3600.0):
        self.timeout_sec = timeout_sec
        self.voice_ttl_sec = voice_ttl_sec
        self._cache: list[Voice] | None = None
        self._cached_at = 0.0
        self._last_error = ""

    # ---------- 基类要求 ----------
    def is_available(self) -> bool:
        return EDGE_AVAILABLE

    def describe(self) -> dict:
        d = {
            "id": self.engine_id,
            "name": self.display_name,
            "requires_network": self.requires_network,
            "available": self.is_available(),
        }
        if self._last_error:
            d["last_error"] = self._last_error
        return d

    def list_voices(self, refresh: bool = False) -> list[Voice]:
        now = time.time()
        if self._cache and not refresh and (now - self._cached_at) < self.voice_ttl_sec:
            return self._cache
        voices = self._fetch_voices()
        self._cache = voices
        self._cached_at = now
        return voices

    def _fetch_voices(self) -> list[Voice]:
        if not EDGE_AVAILABLE:
            raise TTSException("未安装 edge-tts 依赖", self.engine_id)
        try:
            raw = self._run_async(edge_tts.list_voices())
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)[:300]
            raise TTSException(f"拉取在线音色列表失败：{exc}", self.engine_id)
        out: list[Voice] = []
        for v in raw:
            locale = v.get("Locale", "")
            gid = v.get("ShortName", "")
            # 保留全部中文音色。中文一共只有 14 个（普通话 6 + 方言 2 + 粤语 3 + 台普 3），
            # 资源本就稀缺，没必要再按地区砍掉 6 个 —— 粤语/台普在后台单独分组并标注，
            # 用户自己知道该不该用，比替他决定更好。
            # 另外放行一小撮 Multilingual 音色（英文 Locale，但能读中文），
            # 用白名单精确控制，避免 322 个非中文音色涌进来。
            if not locale.startswith("zh") and gid not in catalog.MULTILINGUAL_IDS:
                continue
            gender_raw = (v.get("Gender") or "").lower()
            gender = "male" if gender_raw == "male" else ("female" if gender_raw == "female" else GENDER_UNKNOWN)
            meta = catalog.edge_meta(gid)
            personalities = (v.get("VoiceTag") or {}).get("VoicePersonalities") or []
            out.append(Voice(
                voice_id=gid,
                name=str(meta.get("name") or self._friendly_name(v, gid)),
                gender=str(meta.get("gender") or gender),
                lang=locale,
                style=str(meta.get("style") or (personalities[0] if personalities else "")),
                note=str(meta.get("note", "")),
                engine=self.engine_id,
                age=str(meta.get("age") or AGE_ADULT),
                group=str(meta.get("group") or _group_for_locale(locale)),
            ))
        if not out:
            raise TTSException("未获取到任何中文音色", self.engine_id)
        # 基础音色按「普通话 -> 方言 -> 地区口音」排序，同一组内男声在前。
        # 这样做是因为 26 个音色挤在一个下拉里没法选，分组顺序要符合直觉。
        out.sort(key=lambda x: (
            _GROUP_ORDER.get(x.group, 9),
            x.gender != GENDER_MALE,
            x.voice_id,
        ))
        # 派生角色声线排在最后：它们是「调味品」，不是基础音色
        by_id = {v.voice_id: v for v in out}
        out.extend(catalog.build_role_voices(self.engine_id, by_id))
        return out

    def validate(self, req: SynthRequest) -> None:
        if not (req.text or "").strip():
            raise TTSException("合成文本为空", self.engine_id)
        for label, val in (("语速", req.rate), ("音调", req.pitch), ("音量", req.volume)):
            if val is not None and not (-100 <= int(val) <= 100):
                raise TTSException(f"{label}超出范围（-100~100）：{val}", self.engine_id)

    def _do_synthesize(self, req: SynthRequest) -> None:
        if not EDGE_AVAILABLE:
            raise TTSException("未安装 edge-tts 依赖", self.engine_id)
        self.validate(req)
        os.makedirs(os.path.dirname(req.out_path) or ".", exist_ok=True)
        # 关键一步：voice_id 可能是 "zh-CN-YunjianNeural#elder_m" 这种派生声线，
        # 必须拆出真正的基础音色，并把声线的语速/音调偏移叠加上去，
        # 否则「老人声线」只会念出原速原调，等于没配。
        voice, rate_val, pitch_val = catalog.effective_params(
            req.voice_id or catalog.default_voice_for("unknown", self.engine_id),
            req.rate, req.pitch,
        )
        rate = _signed_percent(rate_val)
        pitch = _signed_hz(pitch_val)
        volume = _signed_percent(req.volume)
        try:
            comm = edge_tts.Communicate(req.text, voice, rate=rate, pitch=pitch, volume=volume)
            self._run_async(asyncio.wait_for(comm.save(req.out_path), timeout=self.timeout_sec))
        except asyncio.TimeoutError:
            raise TTSException(f"Edge TTS 合成超时（>{self.timeout_sec}s）", self.engine_id)
        except Exception as exc:  # noqa: BLE001
            raise TTSException(str(exc)[:300], self.engine_id)

    # ---------- 内部工具 ----------
    @staticmethod
    def _friendly_name(item: dict, gid: str) -> str:
        """目录里没登记的音色，从 FriendlyName 里剥出一个能看的名字。

        官方格式是 "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)"，
        直接给用户看会一脸茫然，取括号前的音色名那一段最合适。
        """
        raw = str(item.get("FriendlyName") or gid)
        core = raw.split(" - ")[0]
        core = core.replace("Microsoft ", "").strip()
        for suffix in ("Online (Natural)", "Online"):
            if core.endswith(suffix):
                core = core[: -len(suffix)].strip()
        return core or gid

    @staticmethod
    def _run_async(coro):
        """在独立线程里用独立事件循环执行协程。线程之间互不干扰，可安全并发调用。"""
        import threading

        box: dict[str, object] = {}

        def runner():
            loop = asyncio.new_event_loop()
            try:
                asyncio.set_event_loop(loop)
                box["value"] = loop.run_until_complete(coro)
            except BaseException as exc:  # noqa: BLE001
                box["error"] = exc
            finally:
                try:
                    loop.close()
                except Exception:  # noqa: BLE001
                    pass

        t = threading.Thread(target=runner, daemon=True)
        t.start()
        t.join()
        if "error" in box:
            raise box["error"]  # type: ignore[misc]
        return box.get("value")


def _signed_percent(v: int) -> str:
    v = int(v or 0)
    return f"+{v}%" if v >= 0 else f"{v}%"


def _signed_hz(v: int) -> str:
    """Edge TTS 的 pitch 单位是 Hz，取 pitch 百分比映射到 ±50Hz 这个听感舒适区间。"""
    v = int(v or 0)
    hz = int(v * 50 / 100)
    return f"+{hz}Hz" if hz >= 0 else f"{hz}Hz"
