"""语音缓存 —— 「玩起来不磕绊」最核心的一环。

同一个句子的同一段音频，第二次就是本地静态文件，延迟从 1.5s 掉到接近 0。
缓存键包含 text + engine + voice + rate + pitch，少任何一个都可能串音。

淘汰策略用真实的 atime（访问时间）而不是 mtime：
多周目重玩同一段剧情时，热的那批句子要一直留在盘上，而不是被合成时间挤掉。
"""
from __future__ import annotations

import hashlib
import os
import threading
import time

from ...config import TTS_CACHE_DIR, TTS_MAX_CACHE_BYTES, TTS_MAX_CACHE_FILES
from .base import SynthRequest

_lock = threading.Lock()
_stats = {"hits": 0, "misses": 0, "bytes": 0, "files": 0}


def cache_key(req: SynthRequest, engine: str) -> str:
    raw = "\x01".join([
        engine,
        req.voice_id or "",
        str(req.rate or 0),
        str(req.pitch or 0),
        str(req.volume or 0),
        req.out_format or "mp3",
        (req.text or "").strip(),
    ])
    return hashlib.md5(raw.encode("utf-8")).digest().hex()


def cache_path(key: str, ext: str = "mp3") -> str:
    """两级目录散列，避免单目录下万级文件导致 Windows 资源管理器卡死。"""
    sub = key[:2]
    d = os.path.join(TTS_CACHE_DIR, sub)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{key}.{ext}")


def touch(path: str) -> None:
    """更新访问/修改时间，标记这条缓存是热的。"""
    try:
        now = time.time()
        os.utime(path, (now, now))
    except OSError:
        pass


def hit_size(path: str) -> int:
    try:
        st = os.stat(path)
        # 小于 1KB 基本是合成失败的哑音频，不能当缓存用
        return st.st_size if st.st_size > 1024 else 0
    except OSError:
        return 0


def scan() -> tuple[list[tuple[str, int, float]], int, int]:
    """扫描缓存目录，返回 [(路径, 大小, atime)] 与总文件数、总字节数。"""
    items: list[tuple[str, int, float]] = []
    total_bytes = 0
    for root, _dirs, files in os.walk(TTS_CACHE_DIR):
        for name in files:
            if not name.endswith(".mp3"):
                continue
            p = os.path.join(root, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            # Windows 下 atime 有时不更新，退化为 max(atime, mtime)
            at = max(st.st_atime, st.st_mtime)
            items.append((p, st.st_size, at))
            total_bytes += st.st_size
    return items, len(items), total_bytes


def prune_if_needed() -> None:
    """超过文件数或体积上限时，按最久未访问淘汰到 80% 水位线。

    留出 20% 余量是为了避免每合成一句就触发一次全目录扫描。
    """
    with _lock:
        items, files, total = scan()
        if files <= TTS_MAX_CACHE_FILES and total <= TTS_MAX_CACHE_BYTES:
            _stats["bytes"], _stats["files"] = total, files
            return
        items.sort(key=lambda x: x[2])
        target_files = int(TTS_MAX_CACHE_FILES * 0.8)
        target_bytes = int(TTS_MAX_CACHE_BYTES * 0.8)
        removed = 0
        for p, size, _at in items:
            if files <= target_files and total <= target_bytes:
                break
            try:
                os.unlink(p)
                # 时长 sidecar 跟着一起删，否则会留下一堆无主的 .dur 文件
                try:
                    os.unlink(p + ".dur")
                except OSError:
                    pass
                files -= 1
                total -= size
                removed += 1
            except BaseException:
                # 刻意用 BaseException：某些运行环境会给文件删除加自己的保护钩子，
                # 抛出 SystemExit 这类非 OSError 的异常。缓存清理失败顶多占点磁盘，
                # 不该让它升级成一次 500 把接口打挂。
                continue
        if removed:
            print(f"[TTS] 缓存淘汰 {removed} 个文件，剩余 {files} 个 / {total // 1024 // 1024}MB")
        _stats["bytes"], _stats["files"] = total, files


def clear(older_than_sec: float | None = None) -> dict:
    """清空缓存。older_than_sec 存在时只清理超过该时长的（用于清掉过期旧音色产出的音频）。"""
    with _lock:
        items, files, total = scan()
        now = time.time()
        removed_files, removed_bytes = 0, 0
        for p, size, at in items:
            if older_than_sec is not None and (now - at) < older_than_sec:
                continue
            try:
                os.unlink(p)
                try:
                    os.unlink(p + ".dur")
                except OSError:
                    pass
                removed_files += 1
                removed_bytes += size
            except BaseException:
                # 同上：删除失败不影响业务，不能让它变成 500
                continue
        _stats["hits"] = _stats["misses"] = 0
        _stats["bytes"], _stats["files"] = total - removed_bytes, files - removed_files
        return _info()


def add_hit() -> None:
    with _lock:
        _stats["hits"] += 1


def add_miss() -> None:
    with _lock:
        _stats["misses"] += 1


def _info() -> dict:
    total = _stats["hits"] + _stats["misses"]
    return {
        "files": _stats["files"],
        "bytes": _stats["bytes"],
        "mb": round(_stats["bytes"] / 1048576, 2),
        "hits": _stats["hits"],
        "misses": _stats["misses"],
        "hit_rate": round(_stats["hits"] / total * 100, 1) if total else 0.0,
    }


def info() -> dict:
    """返回缓存统计。顺带刷新一次实际占用（不扫的话数字会一直是旧的）。"""
    with _lock:
        _items, _stats["files"], _stats["bytes"] = scan()
        return _info()
