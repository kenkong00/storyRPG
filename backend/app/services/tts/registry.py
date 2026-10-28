"""引擎注册表 —— 决定「用哪个引擎发声」，以及主力挂了之后往哪儿降级。

为什么单独抽一层：
    新增引擎时只需要在这里 register 一行，service / router / 前端都不用动。
    降级顺序也集中在这里，避免在业务逻辑里到处写 try/except 判断。
"""
from __future__ import annotations

import os
from typing import Any

from ...config import TTS_CONFIG_PATH
from .base import TTSProvider, Voice
from .edge_provider import EdgeTTSProvider
from .onecore_provider import OneCoreTTSProvider
from .http_provider import load_http_providers


class TTSRegistry:
    def __init__(self):
        self._providers: dict[str, TTSProvider] = {}
        self._fallback_order: list[str] = []
        self._config_path = TTS_CONFIG_PATH
        self._http_loaded = False

    def register(self, provider: TTSProvider, fallback_rank: int | None = None) -> None:
        self._providers[provider.engine_id] = provider
        if fallback_rank is not None:
            self._fallback_order.append((fallback_rank, provider.engine_id))
            self._fallback_order.sort(key=lambda x: x[0])

    def ensure_loaded(self) -> None:
        """首次访问时装载引擎。HTTP 引擎从 JSON 配置读，支持热更新重新装载。"""
        if self._providers:
            return
        # rank 越小越优先作为兜底候选
        self.register(EdgeTTSProvider(), fallback_rank=10)
        self.register(OneCoreTTSProvider(), fallback_rank=1)  # 离线、最快，兜底首选
        self.load_http_providers()

    def load_http_providers(self, force: bool = False) -> list[str]:
        """读取外部 HTTP 语音引擎配置，可重复调用以支持不重启就新增大模型引擎。"""
        if self._http_loaded and not force:
            return []
        self._http_loaded = True
        added: list[str] = []
        # 重新读取时先移除旧的自定义引擎，避免重复注册
        for pid in [p.engine_id for p in list(self._providers.values())]:
            if pid not in ("edge", "onecore") and isinstance(self._providers.get(pid), TTSProvider):
                self._providers.pop(pid, None)
                self._fallback_order = [(r, i) for r, i in self._fallback_order if i != pid]
        for p in load_http_providers(self._config_path):
            if p.engine_id in ("edge", "onecore"):
                continue  # 保留内置标识，不允许被配置覆盖
            self.register(p, fallback_rank=20)
            added.append(p.engine_id)
        return added

    def get(self, engine_id: str | None) -> TTSProvider | None:
        self.ensure_loaded()
        if not engine_id:
            return None
        return self._providers.get(engine_id)

    def default_engine(self) -> str:
        """选一个当前环境下真能用的默认引擎：优先 Edge（音色丰富），挂了退回本机。"""
        self.ensure_loaded()
        if self.is_usable("edge"):
            return "edge"
        if self.is_usable("onecore"):
            return "onecore"
        return "edge"

    def is_usable(self, engine_id: str) -> bool:
        p = self.get(engine_id)
        return bool(p and p.is_available())

    def fallback_candidates(self, exclude: set[str] | None = None) -> list[TTSProvider]:
        """返回降级候选，按兜底优先级排序（离线本机排最前）。"""
        self.ensure_loaded()
        exclude = exclude or set()
        out: list[TTSProvider] = []
        for _rank, pid in self._fallback_order:
            if pid in exclude:
                continue
            p = self._providers.get(pid)
            if p and p.is_available():
                out.append(p)
        return out

    def list_engines(self) -> list[dict[str, Any]]:
        self.ensure_loaded()
        rows: list[dict[str, Any]] = []
        for pid in self._engine_display_order():
            p = self._providers[pid]
            try:
                rows.append(p.describe())
            except Exception:  # noqa: BLE001
                rows.append({"id": pid, "name": pid, "available": False, "requires_network": True})
        return rows

    def _engine_display_order(self) -> list[str]:
        """后台下拉的展示顺序：内置的排前面，自定义大模型排后面。

        这里必须自己 ensure_loaded()：引擎是懒装载的，而音色列表接口第一个调用
        的可能就是本方法，不装载就会拿到空列表 —— 表现为「后台音色下拉是空的」，
        而且只在没先请求过 /engines 时才复现，很难查。
        """
        self.ensure_loaded()
        builtin = [p for p in ("edge", "onecore") if p in self._providers]
        custom = [p for p in self._providers if p not in ("edge", "onecore")]
        return builtin + sorted(custom)

    def list_voices(self, engine_id: str | None = None, refresh: bool = False) -> list[Voice]:
        """取音色清单。指定引擎失败时不影响其它引擎的展示。"""
        self.ensure_loaded()
        if engine_id:
            p = self.get(engine_id)
            if not p:
                return []
            try:
                return p.list_voices(refresh=refresh)
            except Exception:  # noqa: BLE001
                return []
        out: list[Voice] = []
        for pid in self._engine_display_order():
            p = self._providers[pid]
            try:
                out.extend(p.list_voices(refresh=refresh))
            except Exception:  # noqa: BLE001
                continue
        return out

    def shutdown(self) -> None:
        for p in self._providers.values():
            fn = getattr(p, "shutdown", None)
            if callable(fn):
                try:
                    fn()
                except Exception:  # noqa: BLE001
                    pass


registry = TTSRegistry()
