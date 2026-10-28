"""通用 HTTP 语音引擎 —— 为「语音大模型 API / 本地 TTS 服务」预留的插槽。

这是本次设计里最重要的一处可扩展性安排：
以后接任何一种语音服务（OpenAI 兼容 TTS、CosyVoice、GPT-SoVITS、Fish-Speech、
Index-TTS、火山豆包、阿里百炼……都行），**不需要改任何业务代码**，
只要在 data/tts_config.json 里加一段配置，后台下拉就会多出一个引擎。

约定（为了覆盖绝大多数服务，统一抽象成这样一次 HTTP 调用）：
    POST <base_url><endpoint>
    headers: {Authorization: Bearer <api_key>, Content-Type: application/json}
    body: {model, voice, input, response_format, speed, extra_params...}
    响应：二进制音频（audio/mpeg 等）

不同服务的字段名千奇百怪，所以这里允许配置里写 field_map 做字段重命名，
以及 response_type 支持 binary / json_base64 / json_url 三种取音频的方式。
"""
from __future__ import annotations

import json
import os
from typing import Any

from .base import SynthRequest, TTSException, TTSProvider, Voice, GENDER_UNKNOWN
from . import catalog

try:
    import requests
    REQUESTS_AVAILABLE = True
except Exception:  # noqa: BLE001
    requests = None
    REQUESTS_AVAILABLE = False


class HTTPTTSProvider(TTSProvider):
    """按外部 JSON 配置驱动，支持任意 HTTP 语音 API。可同时存在多个实例（不同 id）。"""

    requires_network = True

    def __init__(self, cfg: dict[str, Any]):
        self.engine_id = cfg.get("id", "custom")
        self.display_name = cfg.get("name", self.engine_id)
        self.enabled = bool(cfg.get("enabled", False))
        self.base_url = (cfg.get("base_url") or "").rstrip("/")
        self.endpoint = cfg.get("endpoint") or "/v1/audio/speech"
        self.api_key = cfg.get("api_key") or ""
        self.model = cfg.get("model") or ""
        # 请求体模板：{"model": "$model", "voice": "$voice", "input": "$text"}
        # 值里出现 $model / $voice / $text / $speed 会被替换
        self.body_template: dict[str, Any] = cfg.get("body_template") or {}
        self.headers: dict[str, str] = cfg.get("headers") or {}
        self.timeout = float(cfg.get("timeout_sec") or 30)
        # binary | json_base64 | json_url
        self.response_type = cfg.get("response_type") or "binary"
        self.audio_field = cfg.get("audio_field") or "audio"
        self.static_voices: list[dict] = cfg.get("voices") or []

    # ---------- 基类要求 ----------
    def is_available(self) -> bool:
        return self.enabled and REQUESTS_AVAILABLE and bool(self.base_url)

    def describe(self) -> dict:
        d = super().describe()
        d["model"] = self.model
        d["configured"] = bool(self.base_url)
        return d

    def list_voices(self, refresh: bool = False) -> list[Voice]:
        """优先用配置里静态声明的音色；没声明时给出「默认」占位，
        让 UI 不至于空着——语音大模型的音色往往是动态/可克隆的，没必要硬摘。"""
        out: list[Voice] = []
        for v in self.static_voices:
            out.append(Voice(
                voice_id=str(v.get("id") or v.get("name") or ""),
                name=str(v.get("name") or v.get("id") or ""),
                gender=str(v.get("gender") or GENDER_UNKNOWN).lower(),
                lang=str(v.get("lang") or "zh-CN"),
                style=str(v.get("style") or ""),
                note=str(v.get("note") or ""),
                engine=self.engine_id,
            ))
        if not out:
            out.append(Voice(
                voice_id=self.model or "default",
                name="默认音色",
                gender=GENDER_UNKNOWN,
                engine=self.engine_id,
                note="在配置文件的 voices 里声明后可在此列出更多音色",
            ))
        return out

    def validate(self, req: SynthRequest) -> None:
        if not (req.text or "").strip():
            raise TTSException("合成文本为空", self.engine_id)
        if not self.is_available():
            raise TTSException(
                f"引擎 {self.display_name} 未启用或未安装 requests：请在 data/tts_config.json 中配置",
                self.engine_id,
            )

    def _do_synthesize(self, req: SynthRequest) -> None:
        self.validate(req)
        url = self.base_url + self.endpoint
        body = self._build_body(req)
        headers = {"Content-Type": "application/json"}
        headers.update(self.headers)
        if self.api_key:
            headers.setdefault("Authorization", f"Bearer {self.api_key}")
        try:
            resp = requests.post(url, json=body, headers=headers, timeout=self.timeout)  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            raise TTSException(f"请求语音接口失败：{exc}"[:300], self.engine_id)
        if resp.status_code >= 400:
            raise TTSException(
                f"语音接口返回 {resp.status_code}：{resp.text[:300]}", self.engine_id)
        parent = os.path.dirname(req.out_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        data = self._extract_audio(resp, body)
        if not data:
            raise TTSException("语音接口未返回有效音频", self.engine_id)
        with open(req.out_path, "wb") as f:
            f.write(data)

    # ---------- 内部工具 ----------
    def _resolve(self, req: SynthRequest) -> tuple[str, int]:
        """拆出真实音色名与语速。

        派生声线的 ID 形如 "xxx#elder_m"，远程 API 不认识 "#" 后面那段，
        直接整串传过去只会报错。这里剥掉后缀，把声线的语速偏移叠加上去
        （音调只能靠 API 自己支持，这里不假装能做到）。
        """
        base, rate, _pitch = catalog.effective_params(req.voice_id or "", req.rate, req.pitch)
        return base, rate

    def _build_body(self, req: SynthRequest) -> dict[str, Any]:
        voice, rate = self._resolve(req)
        if not self.body_template:
            return {
                "model": self.model,
                "voice": voice,
                "input": req.text,
                "response_format": "mp3",
                "speed": 1.0 + rate / 100.0,
            }
        subs = {
            "$text": req.text,
            "$voice": voice,
            "$model": self.model,
            "$speed": 1.0 + rate / 100.0,
            "$format": os.path.splitext(req.out_path)[1].lstrip(".") or "mp3",
        }
        return _substitute(self.body_template, subs)

    def _extract_audio(self, resp, body: dict) -> bytes | None:
        if self.response_type in ("json_base64", "json_url"):
            payload = resp.json()
        else:
            return resp.content
        node: Any = payload
        for key in str(self.audio_field or "").split("."):
            if not isinstance(node, dict):
                return None
            node = node.get(key)
        if node is None:
            return None
        if self.response_type == "json_url":
            try:
                return requests.get(str(node), timeout=self.timeout).content  # type: ignore[union-attr]
            except Exception as exc:  # noqa: BLE001
                raise TTSException(f"下载音频失败：{exc}"[:300], self.engine_id)
        import base64
        try:
            return base64.b64decode(str(node))
        except Exception:  # noqa: BLE001
            return None


def _substitute(tpl: Any, subs: dict[str, Any]) -> Any:
    """递归替换模板里的 $xxx 占位符。

    模板里写成 {"model": "$model"} 就替换成实际值；
    写成 {"speed": "$speed"} 会替换成数字而非字符串——这点很重要，
    很多语音 API 对 speed 的类型敏感，传字符串会直接报错。
    """
    if isinstance(tpl, dict):
        return {k: _substitute(v, subs) for k, v in tpl.items()}
    if isinstance(tpl, list):
        return [_substitute(v, subs) for v in tpl]
    if isinstance(tpl, str) and tpl in subs:
        return subs[tpl]
    return tpl


def load_http_providers(cfg_path: str) -> list[HTTPTTSProvider]:
    """从 JSON 配置读取所有自定义 HTTP 引擎。文件不存在或格式错误时返回空列表，
    绝不让配置问题拖垮主流程。"""
    if not os.path.exists(cfg_path):
        return []
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return []
    providers: list[HTTPTTSProvider] = []
    for item in (data.get("providers") or []):
        try:
            providers.append(HTTPTTSProvider(item))
        except Exception:  # noqa: BLE001
            continue
    return providers
