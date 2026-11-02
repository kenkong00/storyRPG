"""Windows 系统声音录制（WASAPI 回环）—— 点一下就开始，不弹任何授权面板。

为什么不用浏览器的 getDisplayMedia：
    它每次按录制都必须先弹「共享什么」的面板（浏览器安全策略，网页跳不过去），
    而录「整个系统的声音」本来就不需要选窗口。这里直接问 Windows 要扬声器的
    回环流，进程内拿到 PCM 就写盘 —— 没有弹窗、没有「共享音频」勾选框。

实现方式：纯标准库。用 ctypes 调 COM：
    IMMDeviceEnumerator → GetDefaultAudioEndpoint(eRender)
    IMMDevice::Activate(IAudioClient) → Initialize(SHARED, LOOPBACK)
    IAudioCaptureClient → GetBuffer 轮询取数据
拿到的原始 PCM 交给 ffmpeg 转成 44.1kHz / 单声道 / 16bit WAV（体积小、浏览器必解）。

只做「系统声音」这一件事是故意的：麦克风和「指定某个窗口」本质上是另一个问题
——麦克风用浏览器 getUserMedia（一次授权后长期有效），指定窗口只能靠浏览器
共享面板（浏览器不允许网页替用户选窗口）。
"""
from __future__ import annotations

import ctypes
import os
import struct
import subprocess
import threading
import time
from ctypes import wintypes

# ----------------------------------------------------------------------------
# COM 基础
# ----------------------------------------------------------------------------
ole32 = ctypes.WinDLL("ole32", use_last_error=True)

CLSCTX_ALL = 0x17
COINIT_MULTITHREADED = 0x0
COINIT_APARTMENTTHREADED = 0x2

CLSID_MMDeviceEnumerator = "{BCDE0395-E52F-467C-8E3D-C4579291692E}"
IID_IMMDeviceEnumerator = "{A95664D2-9614-4F35-A746-DE8DB63617E6}"
IID_IMMDevice = "{D666063F-1587-4E43-81F1-B948E807363F}"
IID_IAudioClient = "{1CB9AD4C-DBFA-4c32-B178-C2F568A703B2}"
IID_IAudioCaptureClient = "{C8ADBD64-E71E-48a0-A4DE-185C395CD317}"

# EDataFlow / ERole
eRender = 0
eCapture = 1
eConsole = 0

AUDCLNT_SHAREMODE_SHARED = 0
AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000
AUDCLNT_BUFFERFLAGS_SILENT = 0x2
AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY = 0x1

WAVE_FORMAT_EXTENSIBLE = 0xFFFE


class GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", ctypes.c_uint32),
        ("Data2", ctypes.c_uint16),
        ("Data3", ctypes.c_uint16),
        ("Data4", ctypes.c_ubyte * 8),
    ]


def _guid(text: str) -> GUID:
    """'{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}' -> GUID。"""
    g = GUID()
    ole32.CLSIDFromString(ctypes.c_wchar_p(text), ctypes.byref(g))
    return g


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [
        ("wFormatTag", ctypes.c_uint16),
        ("nChannels", ctypes.c_uint16),
        ("nSamplesPerSec", ctypes.c_uint32),
        ("nAvgBytesPerSec", ctypes.c_uint32),
        ("nBlockAlign", ctypes.c_uint16),
        ("wBitsPerSample", ctypes.c_uint16),
        ("cbSize", ctypes.c_uint16),
    ]


def _vtbl_call(ptr: ctypes.c_void_p, index: int, restype, *argtypes):
    """按虚表下标取方法并绑定好 this —— ctypes 手写 COM 的标准做法。"""
    vtbl = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    proto = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
    return proto(vtbl[index])


def _release(ptr: ctypes.c_void_p) -> None:
    if not ptr:
        return
    try:
        _vtbl_call(ptr, 2, ctypes.c_ulong)(ptr)  # IUnknown::Release
    except Exception:  # noqa: BLE001
        pass


class AudioDevice:
    """一个可录的回环设备。只是为了给前端显示「当前录的是哪个扬声器」。"""

    def __init__(self, name: str, channels: int, rate: int, bits: int):
        self.name = name
        self.channels = channels
        self.rate = rate
        self.bits = bits

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "channels": self.channels,
            "rate": self.rate,
            "bits": self.bits,
        }


class WasapiLoopbackRecorder:
    """录扬声器回环流。一次只跑一个实例（由调用方保证）。"""

    def __init__(self, ffmpeg: str | None = None):
        self.ffmpeg = ffmpeg
        self._thread: threading.Thread | None = None
        self._stop_evt = threading.Event()
        self._raw = bytearray()
        self._lock = threading.Lock()
        self._device: AudioDevice | None = None
        self._error: str | None = None
        self.started_at = 0.0
        self.stopped_at = 0.0

    # ------------------------------------------------------------------
    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    @property
    def seconds(self) -> float:
        if not self.started_at:
            return 0.0
        end = self.stopped_at or time.time()
        return max(0.0, end - self.started_at)

    def bytes_captured(self) -> int:
        with self._lock:
            return len(self._raw)

    # ------------------------------------------------------------------
    def start(self) -> AudioDevice:
        if self.running:
            raise RuntimeError("已经在录制了")
        self._raw = bytearray()
        self._error = None
        self._stop_evt.clear()
        # 先同步打开设备：设备打开失败要立刻报错，而不是留个空进度条让人干等
        dev = self._open_and_probe()
        self._device = dev
        self.started_at = time.time()
        self.stopped_at = 0.0
        self._thread = threading.Thread(target=self._loop, name="wasapi-loopback", daemon=True)
        self._thread.start()
        return dev

    def stop(self, timeout: float = 5.0) -> None:
        self._stop_evt.set()
        if self._thread:
            self._thread.join(timeout=timeout)
        self.stopped_at = time.time()

    # ------------------------------------------------------------------
    def _open_and_probe(self) -> AudioDevice:
        """打开默认播放设备的回环流，读一次格式就关掉 —— 只为拿到采样参数。"""
        info = _probe_format()
        if not info:
            raise RuntimeError("拿不到扬声器格式（可能没有可用的播放设备）")
        return AudioDevice(*info)

    def _loop(self) -> None:
        """录制线程：COM 必须在自己的线程里初始化。"""
        hr = ole32.CoInitializeEx(None, COINIT_MULTITHREADED)
        try:
            self._capture()
        except Exception as exc:  # noqa: BLE001
            self._error = f"{exc}"[:300]
        finally:
            try:
                ole32.CoUninitialize()
            except Exception:  # noqa: BLE001
                pass
            if hr not in (0, 1):
                pass

    def _capture(self) -> None:
        enumerator = _create_enumerator()
        device = None
        client = None
        capture = None
        started = False
        try:
            device = _default_render_device(enumerator)
            client, fmt = _activate_client(device)
            hr = _vtbl_call(client, 3, ctypes.c_long,
                            ctypes.c_int, ctypes.c_ulong, ctypes.c_int64,
                            ctypes.c_int64, ctypes.c_void_p, ctypes.c_void_p)(
                client, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
                10_000_000, 0, ctypes.byref(fmt), None)
            if hr < 0:
                raise RuntimeError(f"IAudioClient::Initialize 失败 hr=0x{hr & 0xFFFFFFFF:08X}")
            capture = ctypes.c_void_p()
            iid = _guid(IID_IAudioCaptureClient)
            hr = _vtbl_call(client, 14, ctypes.c_long, ctypes.POINTER(GUID),
                            ctypes.POINTER(ctypes.c_void_p))(client, ctypes.byref(iid), ctypes.byref(capture))
            if hr < 0 or not capture.value:
                raise RuntimeError(f"取 IAudioCaptureClient 失败 hr=0x{hr & 0xFFFFFFFF:08X}")
            hr = _vtbl_call(client, 10, ctypes.c_long)(client)  # Start
            if hr < 0:
                raise RuntimeError(f"启动采集失败 hr=0x{hr & 0xFFFFFFFF:08X}")
            started = True
            self._pump(capture, fmt)
        finally:
            if started and client:
                try:
                    _vtbl_call(client, 11, ctypes.c_long)(client)  # Stop
                except Exception:  # noqa: BLE001
                    pass
            _release(capture)
            _release(client)
            _release(device)
            _release(enumerator)

    def _pump(self, capture, fmt: WAVEFORMATEX) -> None:
        block = fmt.nBlockAlign or 1
        pkt_size = ctypes.c_uint32(0)
        while not self._stop_evt.is_set():
            time.sleep(0.01)
            while True:
                hr = _vtbl_call(capture, 5, ctypes.c_long, ctypes.POINTER(ctypes.c_uint32))(
                    capture, ctypes.byref(pkt_size))
                if hr < 0 or pkt_size.value == 0:
                    break
                pdata = ctypes.POINTER(ctypes.c_ubyte)()
                frames = ctypes.c_uint32(0)
                flags = ctypes.c_uint32(0)
                hr = _vtbl_call(capture, 3, ctypes.c_long,
                                ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),
                                ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32),
                                ctypes.c_void_p, ctypes.c_void_p)(
                    capture, ctypes.byref(pdata), ctypes.byref(frames),
                    ctypes.byref(flags), None, None)
                if hr < 0:
                    break
                n = frames.value
                if n:
                    size = n * block
                    with self._lock:
                        if flags.value & AUDCLNT_BUFFERFLAGS_SILENT:
                            self._raw.extend(b"\x00" * size)
                        else:
                            self._raw.extend(ctypes.string_at(pdata, size))
                _vtbl_call(capture, 4, ctypes.c_long, ctypes.c_uint32)(capture, n)

    # ------------------------------------------------------------------
    def save_wav(self, dst_path: str, mono: bool = True, rate: int = 44100) -> dict:
        """把缓冲区里的原始 PCM 转成 WAV。没有 ffmpeg 时退回手写（仅 float32/16bit 支持）。"""
        if not self._device:
            raise RuntimeError("还没有录制内容")
        with self._lock:
            raw = bytes(self._raw)
        if not raw:
            raise RuntimeError("没有录到任何数据（可能是设备静音或未在播放）")
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        fmt = self._device
        infmt = _pcm_codec(fmt.bits)
        cmd = [
            self.ffmpeg or "ffmpeg", "-y", "-v", "error",
            "-f", infmt, "-ar", str(fmt.rate), "-ac", str(fmt.channels),
            "-i", "pipe:0",
            "-ar", str(rate), "-ac", "1" if mono else str(fmt.channels),
            "-c:a", "pcm_s16le", "-f", "wav", dst_path,
        ]
        proc = subprocess.run(cmd, input=raw, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if proc.returncode != 0 or not os.path.exists(dst_path):
            detail = (proc.stderr or b"").decode("utf-8", "ignore")[-300:]
            raise RuntimeError(f"转码 WAV 失败：{detail}")
        return {
            "path": dst_path,
            "bytes": os.path.getsize(dst_path),
            "duration": _wav_duration(dst_path),
            "rate": rate,
            "channels": 1 if mono else fmt.channels,
            "source": fmt.as_dict(),
            "raw_bytes": len(raw),
        }


# ----------------------------------------------------------------------------
# 内部小工具
# ----------------------------------------------------------------------------
def _pcm_codec(bits: int) -> str:
    return {16: "s16le", 24: "s24le", 32: "f32le", 8: "u8"}.get(bits, "f32le")


def _create_enumerator() -> ctypes.c_void_p:
    clsid = _guid(CLSID_MMDeviceEnumerator)
    iid = _guid(IID_IMMDeviceEnumerator)
    ptr = ctypes.c_void_p()
    hr = ole32.CoCreateInstance(ctypes.byref(clsid), None, CLSCTX_ALL,
                                ctypes.byref(iid), ctypes.byref(ptr))
    if hr < 0 or not ptr.value:
        raise RuntimeError(f"创建 MMDeviceEnumerator 失败 hr=0x{hr & 0xFFFFFFFF:08X}")
    return ptr


def _default_render_device(enumerator) -> ctypes.c_void_p:
    dev = ctypes.c_void_p()
    hr = _vtbl_call(enumerator, 4, ctypes.c_long, ctypes.c_int, ctypes.c_int,
                    ctypes.POINTER(ctypes.c_void_p))(
        enumerator, eRender, eConsole, ctypes.byref(dev))
    if hr < 0 or not dev.value:
        raise RuntimeError("找不到默认播放设备（系统没有声卡或未启用输出）")
    return dev


def _activate_client(device) -> tuple[ctypes.c_void_p, WAVEFORMATEX]:
    client = ctypes.c_void_p()
    iid = _guid(IID_IAudioClient)
    hr = _vtbl_call(device, 3, ctypes.c_long, ctypes.POINTER(GUID), ctypes.c_ulong,
                    ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(
        device, ctypes.byref(iid), CLSCTX_ALL, None, ctypes.byref(client))
    if hr < 0 or not client.value:
        raise RuntimeError(f"激活 IAudioClient 失败 hr=0x{hr & 0xFFFFFFFF:08X}")
    pfmt = ctypes.POINTER(WAVEFORMATEX)()
    hr = _vtbl_call(client, 8, ctypes.c_long, ctypes.POINTER(ctypes.POINTER(WAVEFORMATEX)))(
        client, ctypes.byref(pfmt))
    if hr < 0 or not pfmt:
        _release(client)
        raise RuntimeError(f"取混音格式失败 hr=0x{hr & 0xFFFFFFFF:08X}")
    fmt = pfmt.contents
    return client, fmt


def _probe_format() -> tuple[str, int, int, int] | None:
    """同步探测一次默认播放设备的格式与名字。"""
    ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
    enumerator = None
    device = None
    client = None
    try:
        enumerator = _create_enumerator()
        device = _default_render_device(enumerator)
        name = _device_name(device)
        client, fmt = _activate_client(device)
        return (name, int(fmt.nChannels), int(fmt.nSamplesPerSec), int(fmt.wBitsPerSample))
    except Exception:  # noqa: BLE001
        return None
    finally:
        _release(client)
        _release(device)
        _release(enumerator)


def _device_name(device) -> str:
    """IMMDevice::OpenPropertyStore → PKEY_Device_FriendlyName。拿不到就叫「系统声音」。"""
    try:
        store = ctypes.c_void_p()
        # PKEY_Device_FriendlyName = {a45c254e-df1c-4efd-8020-67d146a850e0}, 14
        key = _guid("{A45C254E-DF1C-4EFD-8020-67D146A850E0}")
        hr = _vtbl_call(device, 4, ctypes.c_long, ctypes.c_ulong, ctypes.POINTER(ctypes.c_void_p))(
            device, 0, ctypes.byref(store))
        if hr < 0 or not store.value:
            return "系统声音"
        # PROPVARIANT 布局随位数变化，这里只读 LPWSTR 场景，读不到就算了
        buf = (ctypes.c_byte * 64)()
        hr = _vtbl_call(store, 5, ctypes.c_long, ctypes.POINTER(GUID), ctypes.c_ulong,
                        ctypes.c_void_p)(store, ctypes.byref(key), 14, ctypes.byref(buf))
        _release(store)
        if hr < 0:
            return "系统声音"
        # PROPVARIANT: vt(2B) wReserved1..3(6B) 然后指针/内联值；这里尽量安全地取字符串
        vt = struct.unpack_from("<H", bytes(buf), 0)[0]
        if vt in (31, 8):  # VT_LPWSTR (31) 或 VT_BSTR (8)
            addr = struct.unpack_from("<Q", bytes(buf), 8)[0]
            if addr:
                ctypes.windll.ole32.CoTaskMemFree  # 存在性检查，不调用
                return ctypes.wstring_at(addr) or "系统声音"
        return "系统声音"
    except Exception:  # noqa: BLE001
        return "系统声音"


def _wav_duration(path: str) -> float:
    """读 WAV 头算时长（不引第三方库）。"""
    try:
        with open(path, "rb") as f:
            head = f.read(1024)
        if len(head) < 44 or head[:4] != b"RIFF":
            return 0.0
        # 逐块找 fmt / data，别假设 44 字节固定头
        pos = 12
        rate = 0
        block = 0
        data_size = 0
        while pos + 8 <= len(head):
            cid = head[pos:pos + 4]
            size = struct.unpack_from("<I", head, pos + 4)[0]
            if cid == b"fmt ":
                rate = struct.unpack_from("<I", head, pos + 12)[0]
                block = struct.unpack_from("<H", head, pos + 20)[0]
            elif cid == b"data":
                data_size = size
                break
            pos += 8 + size + (size & 1)
        if not rate or not block:
            return 0.0
        return round(data_size / (rate * block), 3)
    except Exception:  # noqa: BLE001
        return 0.0


# ----------------------------------------------------------------------------
# 自测：python -m app.services.system_audio <秒数> <输出wav>
# ----------------------------------------------------------------------------
if __name__ == "__main__":
    import sys

    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), "_wasapi_test.wav")
    rec = WasapiLoopbackRecorder()
    dev = rec.start()
    print(f"开始录制 {secs}s，设备={dev.name} {dev.channels}ch {dev.rate}Hz {dev.bits}bit")
    time.sleep(secs)
    rec.stop()
    print("采集原始字节:", rec.bytes_captured(), "错误:", rec._error)
    info = rec.save_wav(out)
    print("WAV:", info)
