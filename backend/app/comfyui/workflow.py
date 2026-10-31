# -*- coding: utf-8 -*-
"""
把「模型配置方案（ModelPreset）」翻译成 ComfyUI 的 API 工作流（prompt 字典）。

移植自「windows轻量AI桌面助手 5.0」model_gen.py 的 build_workflow，
只依赖标准库，dict 化以便 Web 前端直接传 JSON。

支持两条生成链：
    standard   通用链：UNETLoader|CheckpointLoader → (SkipLayerGuidance) → LoRA
                      → CLIPTextEncode 正/负 → 潜空间 → KSampler → VAEDecode → SaveImage
    qwen_edit  Qwen-Image-Edit 指令编辑链

三种意图：
    t2i    文生图
    i2i    图生图（源图 VAEEncode 进潜空间，强度 = denoise）
    edit   指令编辑
"""

import random

# ------------------------------------------------------------------ 常量
RECIPES = {
    "standard": "通用（UNET / Checkpoint 直出）",
    "qwen_edit": "Qwen-Image-Edit（指令编辑）",
}

LATENTS = {
    "sd": ("EmptyLatentImage", "SD / SDXL（8 的倍数）"),
    "sd3": ("EmptySD3LatentImage", "SD3 / Flux（16 的倍数）"),
    "flux2": ("EmptyFlux2LatentImage", "Flux2 / MOSS（16 的倍数）"),
}

#: VAE 空间压缩比：latent 边长 = 像素 ÷ 比值。默认 16。
VAE_SPATIAL_SCALE = {
    "qwen_image_vae": 8,   # Wan2.1 VAE：krea2 官方工作流指定
}

# 文件名子串 -> 专用 VAE 加载节点（先具体后宽泛）。
# 4 通道（RGBA）透明底 VAE 必须走官方的 RGBAVAELoader。
VAE_LOADER_OVERRIDES = [
    ("flux2_klein_alpha_rgba", "RGBAVAELoader"),
    ("rgba_vae", "RGBAVAELoader"),
    ("rgba", "RGBAVAELoader"),
]


def vae_spatial_scale(vae_name: str) -> int:
    n = (vae_name or "").lower().replace("\\", "/").rsplit("/", 1)[-1]
    for key, scale in VAE_SPATIAL_SCALE.items():
        if key in n:
            return scale
    return 16


def vae_loader_type(vae_name: str) -> str:
    """按 VAE 文件名挑加载节点类名（默认 VAELoader）。"""
    n = (vae_name or "").lower().replace("\\", "/").rsplit("/", 1)[-1]
    for key, node in VAE_LOADER_OVERRIDES:
        if key in n:
            return node
    return "VAELoader"


def recipe_label(key: str) -> str:
    return RECIPES.get(key, key)


def latent_label(key: str) -> str:
    return LATENTS.get(key, LATENTS["sd"])[1]


# ------------------------------------------------------------------ 节点图构造
class _Graph:
    """极简节点图构造器：自动分配节点 id。"""

    def __init__(self):
        self.nodes = {}
        self._n = 0

    def add(self, class_type: str, inputs: dict) -> str:
        self._n += 1
        nid = str(self._n)
        self.nodes[nid] = {"class_type": class_type, "inputs": inputs}
        return nid

    @staticmethod
    def link(nid: str, slot: int = 0):
        return [nid, slot]


# ------------------------------------------------------------------ 方案适配
class Preset:
    """只读适配层：把前端/配置里的 dict 包成 build_workflow 需要的字段访问。"""

    def __init__(self, d: dict):
        self.d = d or {}

    def get(self, k, default=None):
        return self.d.get(k, default)

    @property
    def name(self):
        return str(self.d.get("name") or "未命名配置")

    @property
    def recipe(self):
        return self.d.get("recipe") or "standard"

    @property
    def load_mode(self):
        return self.d.get("load_mode") or "unet"

    @property
    def diffusion_model(self):
        return self.d.get("diffusion_model") or ""

    @property
    def weight_dtype(self):
        return self.d.get("weight_dtype") or "default"

    @property
    def clip_name(self):
        return self.d.get("clip_name") or ""

    @property
    def clip_type(self):
        return self.d.get("clip_type") or "stable_diffusion"

    @property
    def vae_name(self):
        return self.d.get("vae_name") or ""

    @property
    def latent(self):
        return self.d.get("latent") or "sd"

    @property
    def skip_single_layers(self):
        return self.d.get("skip_single_layers") or ""

    @property
    def skip_double_layers(self):
        return self.d.get("skip_double_layers") or ""

    @property
    def skip_end_percent(self):
        try:
            return float(self.d.get("skip_end_percent", 0.5))
        except (TypeError, ValueError):
            return 0.5

    @property
    def loras(self):
        return [dict(x) for x in (self.d.get("loras") or []) if isinstance(x, dict)]

    @property
    def use_ref_latent(self):
        return bool(self.d.get("use_ref_latent", True))

    @property
    def sampler(self):
        return self.d.get("sampler") or "euler"

    @property
    def scheduler(self):
        return self.d.get("scheduler") or "simple"

    @property
    def steps(self):
        try:
            return int(self.d.get("steps", 20))
        except (TypeError, ValueError):
            return 20

    @property
    def cfg(self):
        try:
            return float(self.d.get("cfg", 4.0))
        except (TypeError, ValueError):
            return 4.0

    @property
    def denoise(self):
        try:
            return float(self.d.get("denoise", 0.75))
        except (TypeError, ValueError):
            return 0.75

    @property
    def long_edge(self):
        try:
            return int(self.d.get("long_edge", 1024))
        except (TypeError, ValueError):
            return 1024

    @property
    def seed(self):
        try:
            return int(self.d.get("seed", -1))
        except (TypeError, ValueError):
            return -1

    @property
    def negative(self):
        return self.d.get("negative") or ""

    @property
    def prefix(self):
        return self.d.get("prefix") or "aiassist"

    @property
    def system_prompt(self):
        return self.d.get("system_prompt") or ""

    @property
    def loras_active(self) -> list:
        out = []
        for l in self.loras:
            name = str(l.get("name") or "").strip()
            if not name or l.get("enabled") is False:
                continue
            try:
                s = float(l.get("strength", 1.0))
            except (TypeError, ValueError):
                s = 1.0
            out.append({"name": name, "strength": s})
        return out

    def resolve_seed(self) -> int:
        s = self.seed
        if s is None or int(s) < 0:
            return random.randint(0, 0xFFFFFFFF)
        return int(s)

    def summary(self) -> str:
        m = (self.diffusion_model or "").replace("\\", "/").rsplit("/", 1)[-1] or "未选模型"
        return f"{m} ｜ {self.sampler}/{self.scheduler} ｜ {self.steps} 步 ｜ CFG {self.cfg:g}"


def effective_prompt(preset: Preset, prompt: str = "") -> str:
    """把方案里的「系统提示词」拼到正向提示词最前面（唯一拼接口，只拼正向）。"""
    sysp = str(preset.system_prompt or "").strip()
    text = str(prompt or "")
    if not sysp:
        return text
    return f"{sysp}\n{text}" if text else sysp


# ------------------------------------------------------------------ 节点构建
def _add_model_loaders(g: _Graph, p: Preset) -> tuple:
    """返回 (model_ref, clip_ref, vae_ref)。"""
    if p.load_mode == "checkpoint" and p.diffusion_model:
        ck = g.add("CheckpointLoaderSimple", {"ckpt_name": p.diffusion_model})
        model_ref = g.link(ck, 0)
        clip_ref = g.link(ck, 1)
        vae_ref = g.link(ck, 2)
        if p.vae_name:
            vae_ref = g.link(g.add(vae_loader_type(p.vae_name),
                                    {"vae_name": p.vae_name}), 0)
    else:
        if not p.diffusion_model:
            raise ValueError("没有选择扩散模型（UNET）")
        if p.diffusion_model.lower().endswith(".gguf"):
            model_ref = g.link(g.add("UnetLoaderGGUF",
                                     {"unet_name": p.diffusion_model}), 0)
        else:
            model_ref = g.link(g.add("UNETLoader", {
                "unet_name": p.diffusion_model,
                "weight_dtype": p.weight_dtype or "default",
            }), 0)
        if not p.clip_name:
            raise ValueError("没有选择文本编码器（CLIP）")
        clip_ref = g.link(g.add("CLIPLoader", {
            "clip_name": p.clip_name,
            "type": p.clip_type or "stable_diffusion",
            "device": "default",
        }), 0)
        if not p.vae_name:
            raise ValueError("没有选择 VAE")
        vae_ref = g.link(g.add(vae_loader_type(p.vae_name),
                               {"vae_name": p.vae_name}), 0)
    return model_ref, clip_ref, vae_ref


def _add_skip_layer(g: _Graph, model_ref, p: Preset):
    """MOSS 这类模型必须先过 SkipLayerGuidanceDiTSimple 才还原官方画质。"""
    if not (p.skip_single_layers or p.skip_double_layers):
        return model_ref
    nid = g.add("SkipLayerGuidanceDiTSimple", {
        "model": model_ref,
        "double_layers": p.skip_double_layers or "",
        "single_layers": p.skip_single_layers or "",
        "start_percent": 0.0,
        "end_percent": float(p.skip_end_percent),
    })
    return g.link(nid, 0)


def _add_loras(g: _Graph, model_ref, clip_ref, p: Preset):
    for l in p.loras_active:
        nid = g.add("LoraLoader", {
            "model": model_ref,
            "clip": clip_ref,
            "lora_name": l["name"],
            "strength_model": l["strength"],
            "strength_clip": l["strength"],
        })
        model_ref = g.link(nid, 0)
        clip_ref = g.link(nid, 1)
    return model_ref, clip_ref


def _latent_node(p: Preset) -> str:
    return LATENTS.get(p.latent, LATENTS["sd"])[0]


def _empty_latent_dims(p: Preset, width: int, height: int) -> tuple:
    lw, lh = int(width), int(height)
    if (_latent_node(p) in ("EmptyFlux2LatentImage", "EmptySD3LatentImage")
            and vae_spatial_scale(p.vae_name) == 8):
        lw, lh = lw * 2, lh * 2
    return lw, lh


def _norm_image_names(image_name: str = "", image_names=None) -> list:
    names = [str(n) for n in (image_names or []) if str(n or "")]
    if names:
        return names
    return [str(image_name)] if image_name else []


def build_workflow(preset_dict: dict, *,
                   mode: str = "t2i",
                   prompt: str = "",
                   negative: str | None = None,
                   image_name: str = "",
                   image_names=None,
                   width: int = 1024,
                   height: int = 1024,
                   strength: float | None = None,
                   seed: int | None = None,
                   prefix: str = "",
                   force_size: bool = False,
                   available_nodes: set | None = None) -> dict:
    """把方案 + 意图翻译成 ComfyUI 的 API 工作流（prompt 字典）。

    available_nodes: ComfyUI 当前已安装的节点 class_type 集合（用来判断
        TextEncodeQwenImage21 / ImageScale 是否存在）。为空时默认全部存在。
    """
    p = Preset(preset_dict)
    mode = mode if mode in ("t2i", "i2i", "edit") else "t2i"
    names = _norm_image_names(image_name, image_names)
    use_image = mode in ("i2i", "edit") and bool(names)
    if not use_image:
        names = []
    neg = p.negative if negative is None else negative
    sd = p.resolve_seed() if seed is None else int(seed)
    den = float(p.denoise if strength is None else strength)
    den = min(1.0, max(0.0, den))
    out_prefix = prefix or p.prefix or "aiassist"

    def _node_exists(cls: str) -> bool:
        if available_nodes is None:
            return True
        return cls in available_nodes

    g = _Graph()
    model_ref, clip_ref, vae_ref = _add_model_loaders(g, p)
    model_ref = _add_skip_layer(g, model_ref, p)
    model_ref, clip_ref = _add_loras(g, model_ref, clip_ref, p)

    if p.recipe == "qwen_edit":
        return _build_qwen_edit(g, p, model_ref, clip_ref, vae_ref,
                                mode=mode, prompt=prompt, negative=neg,
                                image_name=(names[0] if names else ""),
                                image_names=names,
                                width=width, height=height, seed=sd,
                                prefix=out_prefix, force_size=force_size,
                                _node_exists=_node_exists)
    return _build_standard(g, p, model_ref, clip_ref, vae_ref,
                           mode=mode, prompt=prompt, negative=neg,
                           image_name=(names[0] if names else ""),
                           width=width, height=height, strength=den,
                           seed=sd, prefix=out_prefix, force_size=force_size,
                           _node_exists=_node_exists)


def _build_standard(g: _Graph, p: Preset, model_ref, clip_ref, vae_ref, *,
                    mode, prompt, negative, image_name, width, height,
                    strength, seed, prefix, force_size=False, _node_exists=None) -> dict:
    _node_exists = _node_exists or (lambda c: True)
    pos_text = effective_prompt(p, prompt)
    # 负面词为空时不再拿正向词兜底（会白白多跑一次 CLIP 编码）
    neg_text = negative or " "
    pos = g.add("CLIPTextEncode", {"clip": clip_ref, "text": pos_text})
    neg = g.add("CLIPTextEncode", {"clip": clip_ref, "text": neg_text})

    if image_name:
        img = g.add("LoadImage", {"image": image_name})
        pix = g.link(img, 0)
        if force_size and _node_exists("ImageScale"):
            sc = g.add("ImageScale", {
                "image": pix, "upscale_method": "lanczos",
                "width": int(width), "height": int(height), "crop": "disabled"})
            pix = g.link(sc, 0)
        latent = g.link(g.add("VAEEncode", {
            "pixels": pix, "vae": vae_ref}), 0)
        denoise = 1.0 if mode == "t2i" else strength
    else:
        lw, lh = _empty_latent_dims(p, width, height)
        latent = g.link(g.add(_latent_node(p), {
            "width": lw, "height": lh, "batch_size": 1}), 0)
        denoise = 1.0

    ks = g.add("KSampler", {
        "model": model_ref,
        "seed": int(seed),
        "steps": max(1, int(p.steps)),
        "cfg": float(p.cfg),
        "sampler_name": p.sampler or "euler",
        "scheduler": p.scheduler or "simple",
        "denoise": float(denoise),
        "positive": g.link(pos, 0),
        "negative": g.link(neg, 0),
        "latent_image": latent,
    })
    dec = g.add("VAEDecode", {"samples": g.link(ks, 0), "vae": vae_ref})
    g.add("SaveImage", {"images": g.link(dec, 0), "filename_prefix": prefix})
    return g.nodes


def _build_qwen_edit(g: _Graph, p: Preset, model_ref, clip_ref, vae_ref, *,
                     mode, prompt, negative, image_name, width, height,
                     seed, prefix, image_names=None, force_size=False,
                     _node_exists=None) -> dict:
    _node_exists = _node_exists or (lambda c: True)
    prompt = effective_prompt(p, prompt)
    names = _norm_image_names(image_name, image_names)
    imgs = [g.add("LoadImage", {"image": n}) for n in names]
    img = imgs[0] if imgs else None

    if _node_exists("TextEncodeQwenImage21"):
        resolution = int(max(width, height)) if force_size else (
            0 if max(int(width), int(height)) <= max(64, int(p.long_edge))
            else int(max(width, height)))
        inputs = {
            "clip": clip_ref,
            "prompt": prompt or " ",
            "negative_prompt": negative or "",
            "resolution": int(resolution),
        }
        for i, im in enumerate(imgs, 1):
            inputs[f"images.image_{i}"] = g.link(im, 0)
        if imgs:
            inputs["vae"] = vae_ref
        enc = g.add("TextEncodeQwenImage21", inputs)
        pos = g.link(enc, 0)
        neg = g.link(enc, 1)
        if imgs:
            latent = g.link(enc, 2)
        else:
            lw, lh = _empty_latent_dims(p, width, height)
            latent = g.link(g.add(_latent_node(p), {
                "width": lw, "height": lh, "batch_size": 1}), 0)
    else:
        src_latent = None
        if img is not None:
            src_latent = g.link(g.add("VAEEncode", {
                "pixels": g.link(img, 0), "vae": vae_ref}), 0)

        def encode(text: str):
            ins = {"clip": clip_ref, "prompt": text or " "}
            if imgs:
                ins["vae"] = vae_ref
                for i, im in enumerate(imgs[:3], 1):
                    ins[f"image{i}"] = g.link(im, 0)
            return g.link(g.add("TextEncodeQwenImageEditPlus", ins), 0)

        pos = encode(prompt or "")
        neg = encode(negative or "")
        if src_latent and p.use_ref_latent:
            pos = g.link(g.add("ReferenceLatent", {
                "conditioning": pos, "latent": src_latent}), 0)
            neg = g.link(g.add("ReferenceLatent", {
                "conditioning": neg, "latent": src_latent}), 0)
        latent = g.link(g.add(_latent_node(p), {
            "width": int(width), "height": int(height), "batch_size": 1}), 0)

    ks = g.add("KSampler", {
        "model": model_ref,
        "seed": int(seed),
        "steps": max(1, int(p.steps)),
        "cfg": float(p.cfg),
        "sampler_name": p.sampler or "euler",
        "scheduler": p.scheduler or "simple",
        "denoise": 1.0,
        "positive": pos,
        "negative": neg,
        "latent_image": latent,
    })
    dec = g.add("VAEDecode", {"samples": g.link(ks, 0), "vae": vae_ref})
    g.add("SaveImage", {"images": g.link(dec, 0), "filename_prefix": prefix})
    return g.nodes
