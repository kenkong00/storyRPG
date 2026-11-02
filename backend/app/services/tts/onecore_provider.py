"""Windows 本机 OneCore / WinRT 语音引擎 —— 离线兜底。

必须保留它的理由：
  Edge TTS 再好也要联网。一旦断网、或者微软接口抽风，游戏对话不该就此哑掉。
本机实测：冷启动约 2.6s（WinRT 类型加载），之后每句仅 0.37s —— 比在线还快。
所以策略是：**常驻一个后台进程把冷启动成本一次性付掉**，之后每句都很便宜。

三个已知的坑，都在这里处理掉了：
  1. 只能合成 WAV，未压缩，一句 11 字就要 107KB —— 所以产出后交给 service 转 MP3。
  2. .ps1 必须是纯 ASCII（PowerShell 5.1 按系统 ANSI 解析），中文走 UTF-8 临时文件 + base64。
  3. 进程可能崩或卡死 —— 每次合成前探活，超时就杀掉重启。
"""
from __future__ import annotations

import base64
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time

from .base import (
    TTSException,
    SynthRequest,
    TTSProvider,
    Voice,
    GENDER_UNKNOWN,
    AGE_ADULT,
    GROUP_STANDARD,
)
from . import catalog

DAEMON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "one_core.ps1")

# 冷启动实测 2.6s，给 30s 保险；单句合成给 30s（本机合成很快，超时基本等于卡死）
STARTUP_TIMEOUT = 30.0
SYNTH_TIMEOUT = 30.0


def _b64(s: str) -> str:
    return base64.b64encode(str(s).encode("utf-8")).decode("ascii")


class OneCoreTTSProvider(TTSProvider):
    """本机离线语音。Windows 专属；非 Windows 或缺少中文语音时 is_available() 返回 False。"""

    engine_id = "onecore"
    display_name = "本机 Windows 语音（离线 · 兜底）"
    requires_network = False

    def __init__(self):
        self._proc: subprocess.Popen | None = None
        # 读线程把 stdout 按行推进队列，主线程只从队列里带超时地取。
        # 绝不能在主线程直接 read —— 管道没有输出时 read 会永久阻塞，
        # 超时形同虚设，线程卡死后再占着 _lock，整个语音子系统就一起停摆。
        self._q: queue.Queue[str | None] | None = None
        self._reader: threading.Thread | None = None
        self._lock = threading.RLock()     # OneCore 一次只能串行合成；可重入，防自我死锁
        self._ready = False
        self._last_error = ""
        self._voices: list[Voice] | None = None
        self._supported = sys.platform == "win32"
        self._backend = ""                 # winrt / sapi / com / none
        self._probed_at = 0.0
        self._probe_lock = threading.Lock()
        self._tmpdir = tempfile.mkdtemp(prefix="rpg_onecore_")
        self._seq = 0

    # ---------- 基类要求 ----------
    def is_available(self) -> bool:
        """本机语音是否真的能用。

        只判断「是不是 Windows」是不够的：Win10 精简镜像里 WinRT 语音类型
        可能整个不存在，SAPI 也可能因权限拿不到音色。以前这里恒返回 True，
        结果每一句都先白等一次失败、再走降级 —— 玩家体感就是「卡一下才出声」。
        现在起一次 daemon 问清后端，问不到就老实说不可用。
        """
        if not self._supported:
            return False
        return self.probe_backend() in ("winrt", "sapi", "com")

    def probe_backend(self) -> str:
        """返回 winrt / sapi / com / none。结果缓存，失败后 5 分钟内不重试。"""
        with self._probe_lock:
            if self._backend and time.time() - self._probed_at < 300:
                return self._backend
            try:
                self._ensure_started()
                self._send("::BACKEND::")
                deadline = time.time() + 5
                backend = "none"
                while time.time() < deadline:
                    line = self._readline(timeout=1.0)
                    if line is None:
                        if self._q is None:
                            break
                        continue
                    if line.startswith("::BACKEND::"):
                        backend = line[11:].strip() or "none"
                        break
                self._backend = backend
            except Exception:  # noqa: BLE001
                self._backend = "none"
            self._probed_at = time.time()
            return self._backend

    def describe(self) -> dict:
        d = {
            "id": self.engine_id,
            "name": self.display_name,
            "requires_network": self.requires_network,
            "available": self.is_available(),
            "backend": self._backend or "unknown",
            "daemon_running": self._proc is not None and self._proc.poll() is None,
        }
        if self._last_error:
            d["last_error"] = self._last_error[:300]
        return d

    def list_voices(self, refresh: bool = False) -> list[Voice]:
        if self._voices and not refresh:
            return self._voices
        if not self._supported:
            raise TTSException("本机语音仅支持 Windows", self.engine_id)
        self._ensure_started()
        raw = self._list_raw()
        out: list[Voice] = []
        for name, lang, gender_raw in raw:
            if not str(lang).lower().startswith("zh"):
                continue
            g = str(gender_raw).lower()
            gender = "male" if g == "male" else ("female" if g == "female" else GENDER_UNKNOWN)
            meta = catalog.ONECORE_VOICES.get(name, {})
            out.append(Voice(
                voice_id=name,
                name=str(meta.get("name", name)),
                gender=str(meta.get("gender", gender)),
                lang=lang,
                style=str(meta.get("style", "")),
                note=str(meta.get("note", "")),
                engine=self.engine_id,
                age=str(meta.get("age", AGE_ADULT)),
                group=str(meta.get("group", GROUP_STANDARD)),
            ))
        if not out:
            raise TTSException("本机未安装中文语音", self.engine_id)
        # 本机照样派生老人/小孩声线：基础音色换成同性别的本机音色即可。
        # 质感不如在线，但断网时「慢而低沉」这个角色特征至少还在。
        by_gender: dict[str, str] = {}
        for v in out:
            by_gender.setdefault(v.gender, v.voice_id)
        out.extend(catalog.build_role_voices(self.engine_id, base_by_gender=by_gender))
        self._voices = out
        return out

    def validate(self, req: SynthRequest) -> None:
        if not (req.text or "").strip():
            raise TTSException("合成文本为空", self.engine_id)

    def _known_ids(self) -> set[str]:
        try:
            return {v.voice_id for v in self.list_voices()}
        except Exception:  # noqa: BLE001
            return set()

    def _local_voice_for(self, gender: str) -> str:
        """本机只有 3 个中文音色，挑一个性别匹配的。"""
        try:
            voices = self.list_voices()
        except Exception:  # noqa: BLE001
            return ""
        for v in voices:
            if gender and v.gender == gender:
                return v.voice_id
        return voices[0].voice_id if voices else ""

    def _resolve_local(self, req: SynthRequest) -> tuple[str, int, int]:
        """把请求里的音色解析成本机能用的 (音色, 语速, 音调)。

        降级场景很常见：角色配的是 Edge 的「苍老长者」，断网后落到本机引擎。
        这时候如果直接丢掉声线，老人就变回普通男声，等于配置失效；
        所以这里保留声线的 rate/pitch 偏移，只把基础音色换成本机同性别的那个 ——
        音色质感变了，但「慢而低沉」这个角色特征还在。
        """
        base, rate_val, pitch_val = catalog.effective_params(
            req.voice_id or "", req.rate, req.pitch)
        if not req.voice_id or base in self._known_ids():
            return base, rate_val, pitch_val
        _, key = catalog.split_voice_id(req.voice_id)
        role = catalog.get_role(key)
        gender = str(role.get("gender", "")) if role else ""
        local = self._local_voice_for(gender)
        return (local or base), rate_val, pitch_val

    def _do_synthesize(self, req: SynthRequest) -> None:
        """把文本合成成 WAV 写到 out_path（注意：产出是 WAV，转码由上游负责）。

        上游 service 会先把 out_path 指向 .wav，合成完再转 MP3 并覆盖。
        这样设计是因为本机引擎没有 ffmpeg 之外的转码手段，
        与其让每个 Provider 自己处理格式，不如统一在上层做。
        """
        self.validate(req)
        # 音色解析要读音色表，而音色表本身也要拿锁 —— 之前解析写在锁里面，
        # 这把锁又不是可重入的，于是「持锁 → 要锁」自己等自己，永远不返回。
        # 所以把解析和启动都挪到加锁之前。
        voice, rate_val, pitch_val = self._resolve_local(req)
        self._ensure_started()

        # 必须整段加锁：daemon 走的是 stdin/stdout 单行协议，
        # 两个线程同时发命令会让响应错位，谁也拿不到自己那句音频。
        with self._lock:
            txt = self._write_text(req.text)
            out = req.out_path
            parent = os.path.dirname(out)
            if parent:
                os.makedirs(parent, exist_ok=True)
            # 原子写：先写 .part，完成后 rename，避免半截文件被当成有效缓存。
            # 注意：临时文件必须保留原来的扩展名（xxx.part.wav 而不是 xxx.wav.part）——
            # SAPI 的 SpFileStream 是按扩展名选输出格式的，认不出 .part 就只写一个
            # 46 字节的空 WAV 头，表现就是「本机语音未产出有效音频」。
            root, ext = os.path.splitext(out)
            part = root + ".part" + (ext or ".wav")
            try:
                # pitch 是第 5 段，老版脚本只认 4 段也能跑（pitch 视为 0）
                self._send(
                    f"::SYNTH::{_b64(part)}|{_b64(voice)}"
                    f"|{int(rate_val)}|{_b64(txt)}|{int(pitch_val)}"
                )
                size, _ms = self._expect_synth()
            finally:
                # 临时文件删不掉也不该影响合成结果
                try:
                    os.unlink(txt)
                except BaseException:
                    pass
        if not size:
            raise TTSException("本机语音未产出音频", self.engine_id)
        if os.path.exists(part):
            if os.path.exists(out):
                try:
                    os.unlink(out)
                except OSError:
                    pass
            os.replace(part, out)

    # ---------- 进程管理 ----------
    def _ensure_started(self) -> None:
        if self._proc is not None and self._proc.poll() is None and self._ready:
            return
        self._kill()
        try:
            self._proc = subprocess.Popen(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", DAEMON],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                # stderr 必须被消费掉。单独开一个 PIPE 而不读，PowerShell 报错一多
                # 就会把管道写满并阻塞在写操作上 —— 表现同样整句合成卡死。
                # 合并进 stdout 由读线程统一收走，不认识的行会被忽略。
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception as exc:  # noqa: BLE001
            self._last_error = f"无法启动本机语音进程：{exc}"
            raise TTSException(self._last_error, self.engine_id)

        self._q = queue.Queue()
        self._reader = threading.Thread(
            target=self._pump, args=(self._proc, self._q),
            name="onecore-reader", daemon=True,
        )
        self._reader.start()

        deadline = time.time() + STARTUP_TIMEOUT
        while time.time() < deadline:
            line = self._readline(timeout=1.0)
            if line is None:
                if self._q is None:
                    break
                continue
            if line == "::READY::":
                self._ready = True
                return
            if line.startswith("::ERROR::"):
                self._last_error = line[9:]
                self._kill()
                raise TTSException(self._last_error, self.engine_id)
        self._kill()
        self._last_error = "本机语音进程启动超时（可能未安装中文语音）"
        raise TTSException(self._last_error, self.engine_id)

    def _pump(self, proc: subprocess.Popen, q: "queue.Queue[str | None]") -> None:
        """专职读线程：阻塞读整行，读到就入队；进程结束放一个 None 收尾。

        真正的阻塞只发生在这一条线程里，且它不等任何人 —— 主线程永远是
        「带超时地从队列取」，因此不会再出现「读管道卡死」。
        """
        try:
            stdout = proc.stdout
            if stdout is None:
                return
            for raw in stdout:
                if raw is None:
                    break
                line = str(raw).strip()
                if line:
                    q.put(line)
        except Exception:  # noqa: BLE001
            pass
        finally:
            q.put(None)

    def _kill(self) -> None:
        p = self._proc
        self._proc = None
        self._ready = False
        q, self._q = self._q, None
        self._reader = None
        if p is None:
            return
        try:
            if p.poll() is None:
                try:
                    p.stdin.write("::QUIT::\n")
                    p.stdin.flush()
                except Exception:  # noqa: BLE001
                    pass
                p.wait(timeout=3)
        except Exception:  # noqa: BLE001
            pass
        try:
            if p.poll() is None:
                p.kill()
        except Exception:  # noqa: BLE001
            pass
        # 管道关了，读线程会自己退出；这里顺手把残留行清掉，免得下一次
        # 启动读到上一轮的 ::SYNTHED:: 而错配。
        if q is not None:
            while True:
                try:
                    q.get_nowait()
                except queue.Empty:
                    break

    def _readline(self, timeout: float = 5.0) -> str | None:
        """带真超时地读一行。超时返回 None，绝不阻塞调用方。"""
        q = self._q
        if q is None:
            return None
        try:
            line = q.get(timeout=max(0.05, timeout))
        except queue.Empty:
            return None
        if line is None:          # 进程已结束
            self._q = None
            return None
        return line

    def _send(self, cmd: str) -> None:
        if self._proc is None or self._proc.stdin is None:
            raise TTSException("本机语音进程未启动", self.engine_id)
        try:
            self._proc.stdin.write(cmd + "\n")
            self._proc.stdin.flush()
        except Exception as exc:  # noqa: BLE001
            raise TTSException(f"写入语音进程失败：{exc}", self.engine_id)

    def _expect_synth(self) -> tuple[int, int]:
        deadline = time.time() + SYNTH_TIMEOUT
        while time.time() < deadline:
            line = self._readline(timeout=1.0)
            if line is None:
                if self._q is None:      # 读线程已收尾 = 进程没了，不必空转到超时
                    break
                continue
            if line.startswith("::SYNTHED::"):
                parts = line[11:].split("::")
                return int(parts[0] or 0), int(parts[1] or 0)
            if line.startswith("::SYNTHERR::"):
                raise TTSException(line[12:][:300], self.engine_id)
        self._kill()
        raise TTSException("本机语音合成超时", self.engine_id)

    def _list_raw(self) -> list[tuple[str, str, str]]:
        with self._lock:
            self._send("::LIST::")
            rows: list[tuple[str, str, str]] = []
            deadline = time.time() + 15.0
            while time.time() < deadline:
                line = self._readline(timeout=1.0)
                if line is None:
                    if self._q is None:
                        break
                    continue
                if line.startswith("V|"):
                    parts = line[2:].split("|")
                    try:
                        name = base64.b64decode(parts[0]).decode("utf-8")
                    except Exception:  # noqa: BLE001
                        name = parts[0]
                    rows.append((name, parts[1] if len(parts) > 1 else "",
                                 parts[2] if len(parts) > 2 else ""))
                elif line == "::LISTEND::":
                    break
            return rows

    def _write_text(self, text: str) -> str:
        """中文不能直接走命令行参数（PowerShell 编码坑），写临时 UTF-8 文件传路径。"""
        self._seq += 1
        p = os.path.join(self._tmpdir, f"t{int(time.time())}_{self._seq}.txt")
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def shutdown(self) -> None:
        self._kill()
