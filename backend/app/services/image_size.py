"""极轻量的图片尺寸探测（不依赖 Pillow）。

支持 PNG / JPEG / WEBP / GIF，读文件头即可，几十字节就够。
所有出图入口与磁盘回扫共用这一份实现，保证「宽高」口径一致。
"""
from __future__ import annotations

import os
from typing import Optional, Tuple


def image_size_from_bytes(raw: bytes) -> Optional[Tuple[int, int]]:
    """从图片字节里读出真实像素尺寸，识别失败返回 None。"""
    if not raw:
        return None
    try:
        # PNG: \x89PNG\r\n\x1a\n + IHDR
        if raw[:8] == b"\x89PNG\r\n\x1a\n" and raw[12:16] == b"IHDR":
            return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")

        # GIF
        if raw[:6] in (b"GIF87a", b"GIF89a"):
            return int.from_bytes(raw[6:8], "little"), int.from_bytes(raw[8:10], "little")

        # JPEG: 扫 SOFn 段
        if raw[:2] == b"\xff\xd8":
            i, n = 2, len(raw)
            while i < n - 9:
                if raw[i] != 0xFF:
                    i += 1
                    continue
                marker = raw[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB):
                    h = int.from_bytes(raw[i + 5:i + 7], "big")
                    w = int.from_bytes(raw[i + 7:i + 9], "big")
                    return w, h
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg = int.from_bytes(raw[i + 2:i + 4], "big")
                i += 2 + seg
            return None

        # WEBP
        if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
            chunk = raw[12:16]
            if chunk == b"VP8X":
                w = 1 + int.from_bytes(raw[24:27], "little")
                h = 1 + int.from_bytes(raw[27:30], "little")
                return w, h
            if chunk == b"VP8 ":
                # 关键帧头后面 4 字节是 14bit 宽高
                w = int.from_bytes(raw[26:28], "little") & 0x3FFF
                h = int.from_bytes(raw[28:30], "little") & 0x3FFF
                return w, h
            if chunk == b"VP8L":
                bits = int.from_bytes(raw[21:25], "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    except Exception:  # noqa: BLE001
        return None
    return None


def image_size(path: str, head_bytes: int = 262144) -> Optional[Tuple[int, int]]:
    """读磁盘文件的头部字节并解析尺寸；文件不存在或无法识别返回 None。"""
    try:
        if not os.path.isfile(path):
            return None
        with open(path, "rb") as fh:
            raw = fh.read(head_bytes)
        size = image_size_from_bytes(raw)
        if size:
            return size
        # 极端情况（EXIF 超长）整份读一次兜底
        with open(path, "rb") as fh:
            return image_size_from_bytes(fh.read())
    except Exception:  # noqa: BLE001
        return None
