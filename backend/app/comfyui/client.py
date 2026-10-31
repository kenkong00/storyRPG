# -*- coding: utf-8 -*-
"""
ComfyUI 客户端（移植自「windows轻量AI桌面助手 5.0」comfyui_client.py，纯标准库 urllib 实现，无第三方依赖）。

对接端点：
    POST /prompt               提交工作流，返回 prompt_id
    GET  /history/{id}        轮询输出图片
    GET  /view?filename=..    下载图片二进制
    GET  /queue               队列状态
    GET  /system_stats        连通性探测
    POST /interrupt           中断
    DELETE /queue             取消排队
    POST /upload/image        上传图片（multipart）
"""

import json
import os
import time
import urllib.request
import urllib.error
import urllib.parse

DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188"
DEFAULT_TIMEOUT = 600
DEFAULT_POLL_MS = 500
_SEED_MAX = 0xFFFFFFFFFFFFFFFF

# 优先反查 KSampler 的 positive/negative 连线来定位 CLIPTextEncode 文本节点
TEXT_NODE_CANDIDATES = ("109", "6", "4")

# ComfyUI /models 接口返回的模型子目录（与参考项目的 MODEL_FOLDERS 对应）
# 模型文件扩展名（过滤掉目录名/说明文件这类脏数据）
MODEL_FILE_EXTS = (".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx", ".pkl", ".engine")

MODEL_FOLDERS = {
    "unet": "unet",
    "checkpoints": "checkpoints",
    "diffusion_models": "diffusion_models",
    "unet_gguf": "unet_gguf",
    "text_encoders": "text_encoders",
    "clip": "clip",
    "vae": "vae",
    "loras": "loras",
}


class ComfyUIClient:
    def __init__(self, url=DEFAULT_COMFYUI_URL, timeout_sec=DEFAULT_TIMEOUT, poll_interval_ms=DEFAULT_POLL_MS, api_key=None):
        self.base = url.rstrip("/")
        self.timeout = timeout_sec
        self.poll = poll_interval_ms / 1000.0
        self.api_key = api_key

    # ---------- 底层 HTTP ----------
    def _request(self, method, path, body=None, as_json=True, extra_headers=None):
        url = self.base + path
        data = None
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if extra_headers:
            headers.update(extra_headers)
        if body is not None:
            data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "ignore")
            raise RuntimeError(f"ComfyUI {method} {path} 失败: HTTP {e.code} {raw[:300]}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"无法连接 ComfyUI（{self.base}）: {e.reason}")
        if not as_json:
            return raw
        if not raw:
            return None
        return json.loads(raw.decode("utf-8", "ignore"))

    # ---------- 连通性 / 队列 ----------
    def test_connection(self):
        try:
            info = self._request("GET", "/system_stats", as_json=True) or {}
            dev = info.get("devices") or []
            name = dev[0].get("name", "") if dev else ""
            vram = dev[0].get("vram_total", 0) if dev else 0
            detail = "已连接"
            if name:
                detail = f"已连接 {name}"
                if vram:
                    detail += f"（显存 {vram // (1024 ** 3)}GB）"
            return {"ok": True, "detail": detail}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "detail": str(e)}

    # ---------- 节点 / 模型清单 ----------
    def object_info(self, class_type: str | None = None):
        """GET /object_info[/class]。返回节点 class_type -> 定义 的字典。"""
        path = "/object_info" + (f"/{class_type}" if class_type else "")
        try:
            return self._request("GET", path, as_json=True) or {}
        except Exception:  # noqa: BLE001
            return {}

    def _node_cache(self):
        if not hasattr(self, "_nodes"):
            self._nodes = set((self.object_info() or {}).keys())
        return self._nodes

    def has_node(self, class_type: str) -> bool:
        return class_type in self._node_cache()

    @staticmethod
    def _only_model_files(items) -> list[str]:
        """只留下真正的模型文件。

        有些 ComfyUI 版本对 GET /models/{folder} 不认识目录名，会把**模型目录清单**
        （unet / clip / vae / loras 这些文件夹名）当成结果返回，于是「扩散模型」下拉里
        塞进 60 个文件夹名。真模型一定带扩展名，按扩展名过滤既能挡住这种脏数据，
        又不会误伤 `moss image\\xxx.safetensors` 这种带中文/子目录的路径。
        """
        out = []
        for x in items or []:
            v = str(x).strip()
            if not v:
                continue
            if v.lower().endswith(MODEL_FILE_EXTS):
                out.append(v)
        return out

    def _models_in_folder(self, folder: str) -> list[str]:
        """取单个模型目录下的文件列表。

        新版 ComfyUI（>=0.3）用 GET /models/{folder} 返回扁平列表，元素已带子目录前缀；
        旧版用 GET /models?folder=x 返回 {子目录: [文件]} 字典。两种都兼容。
        """
        # 新版：扁平列表
        try:
            data = self._request("GET", f"/models/{folder}", as_json=True)
            if isinstance(data, list):
                return self._only_model_files(str(x).replace("/", "\\") for x in data if x)
            if isinstance(data, dict):
                items = []
                for sub, files in data.items():
                    if isinstance(files, list):
                        for fn in files:
                            rel = f"{sub}\\{fn}" if sub else str(fn)
                            items.append(rel.replace("/", "\\"))
                return self._only_model_files(items)
        except Exception:  # noqa: BLE001
            pass
        # 旧版：查询参数
        try:
            data = self._request("GET", f"/models?folder={folder}", as_json=True)
            if isinstance(data, list):
                return self._only_model_files(str(x).replace("/", "\\") for x in data if x)
            if isinstance(data, dict):
                items = []
                for sub, files in data.items():
                    if isinstance(files, list):
                        for fn in files:
                            items.append(f"{sub}\\{fn}".replace("/", "\\") if sub else str(fn))
                return self._only_model_files(items)
        except Exception:  # noqa: BLE001
            pass
        return []

    def catalog(self):
        """列出 ComfyUI 当前可用的模型（按文件夹分类），用于模型/CLIP/VAE/LoRA 下拉。"""
        out: dict[str, list[str]] = {}
        for key, folder in MODEL_FOLDERS.items():
            out[key] = sorted(set(self._models_in_folder(folder)))
        return out

    def queue_size(self):
        try:
            return self._request("GET", "/queue", as_json=True)
        except Exception:  # noqa: BLE001
            return None

    # ---------- 工作流解析与提示词注入 ----------
    @staticmethod
    def load_workflow(path):
        """加载 API 格式工作流（{节点ID:{class_type,inputs}}）。"""
        with open(path, "r", encoding="utf-8") as f:
            wf = json.load(f)
        if "nodes" in wf and "links" in wf:
            raise ValueError("请使用 ComfyUI 导出的 API 格式工作流（不含 nodes/links 的纯节点字典）。")
        return wf

    def resolve_prompt_nodes(self, workflow):
        """沿采样器 positive/negative 反查文本节点 id（兼容多种结构）。"""
        sampler_ids = [nid for nid, n in workflow.items()
                       if n.get("class_type", "").startswith("KSampler")]
        if not sampler_ids:
            sampler_ids = list(workflow.keys())
        # 优先直接用候选节点
        for cid in TEXT_NODE_CANDIDATES:
            if cid in workflow and "text" in (workflow[cid].get("inputs") or {}):
                return cid, None
        for sid in sampler_ids:
            node = workflow.get(sid, {})
            for key in ("positive", "negative"):
                ref = node.get("inputs", {}).get(key)
                if isinstance(ref, list) and len(ref) >= 1 and ref[0] in workflow:
                    tnode = workflow[ref[0]]
                    if "text" in (tnode.get("inputs") or {}):
                        other = "positive" if key == "negative" else "negative"
                        oref = node.get("inputs", {}).get(other)
                        oid = oref[0] if isinstance(oref, list) and oref else None
                        return ref[0], (oid if oid in workflow and "text" in (workflow[oid].get("inputs") or {}) else None)
        # 退化：扫描所有含 text 的 CLIPTextEncode
        text_nodes = [nid for nid, n in workflow.items() if "text" in (n.get("inputs") or {})]
        if len(text_nodes) >= 1:
            return text_nodes[0], (text_nodes[1] if len(text_nodes) > 1 else None)
        raise RuntimeError("工作流中找不到可注入的提示词文本节点")

    def _set_text(self, workflow, node_id, text):
        if node_id and node_id in workflow:
            workflow[node_id]["inputs"]["text"] = text

    def build_prompt(self, workflow, positive, negative="", overrides=None,
                     batch_size=1, filename_prefix="RPG", random_seed=True):
        """注入提示词 + 覆盖参数 + 改种子 + 写文件名前缀。返回新的 workflow dict。"""
        wf = json.loads(json.dumps(workflow))  # 深拷贝
        pos_id, neg_id = self.resolve_prompt_nodes(wf)
        self._set_text(wf, pos_id, positive)
        if negative:
            if neg_id:
                self._set_text(wf, neg_id, negative)
            else:
                # 没有独立负面节点：拼到正面（少数工作流只有单文本节点）
                cur = wf[pos_id]["inputs"]["text"]
                wf[pos_id]["inputs"]["text"] = f"{cur}\nNegative prompt: {negative}"
        if overrides:
            for nid, kv in overrides.items():
                if nid in wf and isinstance(kv, dict):
                    wf[nid]["inputs"].update(kv)
        # 随机种子
        if random_seed:
            for nid, n in wf.items():
                for sk in ("seed", "noise_seed"):
                    if sk in (n.get("inputs") or {}):
                        n["inputs"][sk] = random.randint(0, _SEED_MAX)
        # 批大小
        for nid, n in wf.items():
            if n.get("class_type") == "EmptyLatentImage":
                n["inputs"]["batch_size"] = batch_size
        # 文件名前缀
        for nid, n in wf.items():
            if n.get("class_type") in ("SaveImage", "PreviewImage"):
                n["inputs"]["filename_prefix"] = filename_prefix
        return wf

    # ---------- 提交 / 轮询 / 下载 ----------
    def submit(self, workflow):
        resp = self._request("POST", "/prompt", body={"prompt": workflow, "client_id": "rpg-assistant"}, as_json=True)
        if "node_errors" in resp and resp["node_errors"]:
            raise RuntimeError(f"工作流节点错误: {resp['node_errors']}")
        pid = resp.get("prompt_id")
        if not pid:
            raise RuntimeError("未返回 prompt_id")
        return pid

    def wait_for_images(self, prompt_id, timeout_sec=None, on_progress=None, should_cancel=None):
        timeout = timeout_sec or self.timeout
        deadline = time.time() + timeout
        while True:
            if should_cancel and should_cancel():
                self.interrupt()
                raise RuntimeError("已取消生成")
            try:
                hist = self._request("GET", f"/history/{prompt_id}", as_json=True)
            except Exception:  # noqa: BLE001
                hist = None
            if hist and prompt_id in hist:
                outputs = hist[prompt_id].get("outputs", {})
                images = []
                for _nid, o in outputs.items():
                    for im in o.get("images", []):
                        images.append(im)
                if images:
                    return images
            if time.time() > deadline:
                raise RuntimeError(f"生成超时（>{timeout}s）")
            if on_progress:
                try:
                    on_progress()
                except Exception:  # noqa: BLE001
                    pass
            time.sleep(self.poll)

    def download_image(self, image):
        params = urllib.parse.urlencode({
            "filename": image["filename"],
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        })
        raw = self._request("GET", f"/view?{params}", as_json=False)
        return raw

    def interrupt(self):
        try:
            self._request("POST", "/interrupt", body={}, as_json=False)
        except Exception:  # noqa: BLE001
            pass

    def upload_image(self, file_path, subfolder="", image_type="input", overwrite=True):
        """上传参考图（multipart/form-data），用于图生图/换脸类工作流。"""
        boundary = "----rpgboundary"
        with open(file_path, "rb") as f:
            data = f.read()
        filename = os.path.basename(file_path)
        body = b""
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode()
        body += b"Content-Type: application/octet-stream\r\n\r\n"
        body += data + b"\r\n"
        for kv in (("overwrite", "true" if overwrite else "false"),
                   ("subfolder", subfolder), ("type", image_type)):
            body += f"--{boundary}\r\n".encode()
            body += f'Content-Disposition: form-data; name="{kv[0]}"\r\n\r\n'.encode()
            body += f"{kv[1]}\r\n".encode()
        body += f"--{boundary}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = self.base + "/upload/image"
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8", "ignore"))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"上传图片失败: HTTP {e.code}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"上传图片失败: {e.reason}")
