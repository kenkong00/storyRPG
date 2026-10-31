# -*- coding: utf-8 -*-
"""
ComfyUI 配置存储（完整移植自「windows轻量AI桌面助手 5.0」的 config.py comfyui 段
+ model_presets.json + prompt_presets.json）。

配置文件：backend/data/comfyui_config.json

包含：
- comfyui 基础连接设置（含 install_dir / python_dir / launch_args / open_browser）
- providers：多套 ComfyUI 服务商（本地 + 远程）
- model_presets：模型配置方案（ModelPreset 全字段，含 LoRA 列表）—— 决定用哪套模型出图
- workflow_presets：ComfyUI 工作流方案（param_presets，加载 API 工作流 + 覆盖参数）
- prompt_presets：提示词词库
- include_sensitive：成人向维度开关
"""

import json
import os
import uuid

from ..config import DATA_DIR

CONFIG_PATH = os.path.join(DATA_DIR, "comfyui_config.json")
LOCAL_ID = "local"

# ----------------------------------------------------------------- 种子数据
# 首次运行时从参考项目「windows轻量AI桌面助手 5.0」抄入的全部模型配置方案
SEED_MODEL_PRESETS = [
    {
        "name": "Qwen2.1编辑",
        "recipe": "qwen_edit", "comfy": "local",
        "load_mode": "unet",
        "diffusion_model": "qwen image 2.1\\qwen_image_2.1_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "qwen image 2.1\\qwen3vl_8b_w4a8_heretic.safetensors",
        "clip_type": "qwen_image",
        "vae_name": "qwen image 2.1\\qwen_image_2.1_vae_bf16.safetensors",
        "latent": "sd3", "skip_single_layers": "", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [{"name": "[qwen image 2.1]\\加速\\qwen21-turbo-r128-comfy.safetensors", "strength": 1.0, "enabled": True}],
        "use_ref_latent": True, "sampler": "euler", "scheduler": "simple", "steps": 8,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "qwen_edit",
        "system_prompt": "isolated on a transparent background,真人风格,",
    },
    {
        "name": "Moss_int8_10步-写实",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "moss image\\Moss-dirtyMoss_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "moss\\qwen3.5_9b_w4a8_gptq.safetensors",
        "clip_type": "moss_image",
        "vae_name": "flux2-vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "[moss image]\\8步lora\\lora_latest.safetensors", "strength": 1.0, "enabled": False},
            {"name": "[moss image]\\4步加速\\moss_image_sft_4step_v2.0.safetensors", "strength": 1.0, "enabled": True},
            {"name": "[moss image]\\影视\\white_balance_slider-moss-v1.safetensors", "strength": -0.25, "enabled": False},
            {"name": "[moss image]\\风格写实\\l3n0v0_lenovo_moss.safetensors", "strength": 0.8, "enabled": True},
            {"name": "[moss image]\\nsfw\\moss_pussy_lora_v2.0.safetensors", "strength": 0.6, "enabled": True},
            {"name": "[moss image]\\影视\\KOOK-MOSS-SFT-观澜.safetensors", "strength": 0.8, "enabled": False},
            {"name": "[moss image]\\nsfw\\MysticXXX-Moss-V1.safetensors", "strength": 0.85, "enabled": False},
            {"name": "[moss image]\\控制\\PhotoSlider_MOSS-sft_v1.safetensors", "strength": 1.8, "enabled": False},
            {"name": "[moss image]\\控制\\PornMaster_Moss_Detail_Slider_V1.safetensors", "strength": 6.0, "enabled": True},
            {"name": "[moss image]\\光影\\Moss-Afterlight-V1.safetensors", "strength": 0.5, "enabled": False},
            {"name": "[moss image]\\风格写实\\l3n0v0_lenovo_moss.safetensors", "strength": 0.6, "enabled": True},
        ],
        "use_ref_latent": True, "sampler": "er_sde", "scheduler": "simple", "steps": 10,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_",
        "system_prompt": "这是一张电影剧照，呈现出35毫米伊士曼彩色胶片的颗粒质感,明亮的人物主体，轮廓边缘呈现出镜头特有的柔和光晕；浓重的胶片颗粒感与褪色却又饱和的色彩，赋予了画面现代影院的胶片质感。",
    },
    {
        "name": "Moss_8步_透明底",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "moss image\\moss_image_sft_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "moss\\qwen3.5_9b_w4a8_gptq.safetensors",
        "clip_type": "moss_image",
        "vae_name": "flux2_klein_alpha_rgba_vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "[moss image]\\8步lora\\lora_latest.safetensors", "strength": 1.0, "enabled": False},
            {"name": "[moss image]\\4步加速\\moss_image_sft_4_steps_lora_v2_600_avg_rank_72_bf16.safetensors", "strength": 1.0, "enabled": True},
            {"name": "[moss image]\\二次元\\keenbiscuit_keenbiscuit-moss.safetensors", "strength": 1.0, "enabled": False},
            {"name": "[moss image]\\图片去背景\\moss_manga_alpha_image_lora.safetensors", "strength": 1.0, "enabled": True},
            {"name": "[moss image]\\控制\\PhotoSlider_MOSS-sft_v1.safetensors", "strength": 2.0, "enabled": True},
            {"name": "[moss image]\\风格写实\\l3n0v0_lenovo_moss.safetensors", "strength": 0.65, "enabled": False},
            {"name": "[moss image]\\nsfw\\moss_pussy_lora_v2.0.safetensors", "strength": 0.55, "enabled": True},
            {"name": "[moss image]\\风格写实\\directflashfilmconcept.safetensors", "strength": 0.8, "enabled": False},
            {"name": "[moss image]\\影视\\white_balance_slider-moss-v1.safetensors", "strength": -1.0, "enabled": False},
            {"name": "[moss image]\\风格写实\\MOSSRealisticSnapshotV1.safetensors", "strength": 1.0, "enabled": False},
        ],
        "use_ref_latent": True, "sampler": "er_sde", "scheduler": "sgm_uniform", "steps": 10,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_",
        "system_prompt": "isolated on a transparent background,",
    },
    {
        "name": "krea2_by_8步",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "krea2\\binyuanKrea2V10_v20_3238227.safetensors",
        "weight_dtype": "default",
        "clip_name": "krea2\\qwen3vl_4b_fp8_scaled.safetensors",
        "clip_type": "krea2",
        "vae_name": "qwen_image_vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "【krea2】\\风格 影视\\BAEL-KREA-V1.safetensors", "strength": 0.5, "enabled": True},
            {"name": "【krea2】\\服装\\neo_tangzhuang-KreaRaw-V2.safetensors", "strength": 0.5, "enabled": True},
        ],
        "use_ref_latent": True, "sampler": "euler", "scheduler": "simple", "steps": 10,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_",
        "system_prompt": "BA3LPR1M3,这是一张电影剧照，呈现出35毫米伊士曼彩色胶片的颗粒质感,明亮的人物主体，轮廓边缘呈现出镜头特有的柔和光晕；浓重的胶片颗粒感与褪色却又饱和的色彩，赋予了画面现代影院的胶片质感。",
    },
    {
        "name": "Qwen2.1生图",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "qwen image 2.1\\qwen_image_2.1_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "qwen image 2.1\\qwen3vl_8b_int8_convrot.safetensors",
        "clip_type": "qwen_image",
        "vae_name": "qwen image 2.1\\qwen_image_2.1_vae_bf16.safetensors",
        "latent": "sd3", "skip_single_layers": "", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [{"name": "[qwen image 2.1]\\加速\\qwen21-turbo-r128-comfy.safetensors", "strength": 1.0, "enabled": True}],
        "use_ref_latent": True, "sampler": "er_sde", "scheduler": "simple", "steps": 8,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "aiassist_edit", "system_prompt": "",
    },
    {
        "name": "Moss_pornMaster_12步",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "moss image\\Moss-大师pornmasterMoss_v1_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "moss\\qwen3.5_9b_w4a8_gptq.safetensors",
        "clip_type": "moss_image",
        "vae_name": "flux2-vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "[moss image]\\8步lora\\lora_latest.safetensors", "strength": 0.9, "enabled": False},
            {"name": "[moss image]\\4步加速\\moss_image_sft_4step_v2.0.safetensors", "strength": 1.0, "enabled": True},
            {"name": "[moss image]\\影视\\cinematic photo style-moss-image-sft-epoch-10.safetensors", "strength": 0.6, "enabled": False},
            {"name": "[moss image]\\影视\\KOOK-MOSS-SFT-观澜.safetensors", "strength": 0.85, "enabled": False},
            {"name": "[moss image]\\4步加速\\moss_image_sft_4_steps_lora_v2_600_avg_rank_72_bf16.safetensors", "strength": 1.0, "enabled": False},
            {"name": "[moss image]\\控制\\PhotoSlider_MOSS-sft_v1.safetensors", "strength": 1.5, "enabled": False},
            {"name": "[moss image]\\光影\\luna_style_moss_v1.safetensors", "strength": 0.9, "enabled": False},
        ],
        "use_ref_latent": True, "sampler": "euler", "scheduler": "sgm_uniform", "steps": 8,
        "cfg": 1.0, "denoise": 0.56, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_", "system_prompt": "clarity,",
    },
    {
        "name": "Moss_dirtyMoss_13步",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "moss image\\Moss-dirtyMoss_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "moss\\qwen3.5_9b_w4a8_gptq.safetensors",
        "clip_type": "moss_image",
        "vae_name": "flux2-vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "[moss image]\\8步lora\\lora_latest.safetensors", "strength": 1.0, "enabled": False},
            {"name": "[moss image]\\4步加速\\moss_image_sft_4step_v2.0.safetensors", "strength": 1.0, "enabled": True},
            {"name": "[moss image]\\影视\\white_balance_slider-moss-v1.safetensors", "strength": -0.5, "enabled": True},
            {"name": "[moss image]\\光影\\Moss-Afterlight-V1.safetensors", "strength": 0.7, "enabled": True},
            {"name": "[moss image]\\影视\\KOOK-MOSS-SFT-观澜.safetensors", "strength": 0.8, "enabled": True},
            {"name": "[moss image]\\nsfw\\MysticXXX-Moss-V1.safetensors", "strength": 0.85, "enabled": False},
            {"name": "[moss image]\\控制\\PhotoSlider_MOSS-sft_v1.safetensors", "strength": 1.8, "enabled": False},
            {"name": "[moss image]\\nsfw\\moss_pussy_lora_v2.0.safetensors", "strength": 0.6, "enabled": False},
            {"name": "[moss image]\\控制\\PornMaster_Moss_Detail_Slider_V1.safetensors", "strength": 6.0, "enabled": False},
            {"name": "[moss image]\\图片去背景\\moss_manga_alpha_image_lora.safetensors", "strength": 1.0, "enabled": True},
        ],
        "use_ref_latent": True, "sampler": "er_sde", "scheduler": "simple", "steps": 10,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_",
        "system_prompt": "这是一张电影剧照，呈现出35毫米伊士曼彩色胶片的颗粒质感,明亮的人物主体，轮廓边缘呈现出镜头特有的柔和光晕；浓重的胶片颗粒感与褪色却又饱和的色彩，赋予了画面现代影院的胶片质感。",
    },
    {
        "name": "krea2_int4_4步",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "krea2\\krea2_turbo_int4_tensorwise_mixed.safetensors",
        "weight_dtype": "default",
        "clip_name": "krea2\\qwen3vl_4b_fp8_scaled.safetensors",
        "clip_type": "krea2",
        "vae_name": "qwen_image_vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "【krea2】\\风格 影视\\BAEL-KREA-V1.safetensors", "strength": 0.35, "enabled": True},
            {"name": "【krea2】\\服装\\neo_tangzhuang-KreaRaw-V2.safetensors", "strength": 0.35, "enabled": True},
            {"name": "【krea2】\\[加速]\\krea2_turbo_4step_rank_64_lora_latest.safetensors", "strength": 1.0, "enabled": True},
            {"name": "【krea2】\\nsfw\\PornMaster_Uncensored_Krea2_V1.safetensors", "strength": 0.8, "enabled": True},
            {"name": "【krea2】\\nsfw\\Krea2_TextFusion_Refusal_Reduction.safetensors", "strength": 1.0, "enabled": True},
            {"name": "【krea2】\\风格 真实\\Ray Versatile Face v1.safetensors", "strength": 0.7, "enabled": False},
        ],
        "use_ref_latent": True, "sampler": "euler", "scheduler": "simple", "steps": 6,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_",
        "system_prompt": "BA3LPR1M3,这是一张电影剧照，呈现出35毫米伊士曼彩色胶片的颗粒质感,明亮的人物主体，轮廓边缘呈现出镜头特有的柔和光晕；浓重的胶片颗粒感与褪色却又饱和的色彩，赋予了画面现代影院的胶片质感。",
    },
    {
        "name": "Moss-去背景",
        "recipe": "standard", "comfy": "",
        "load_mode": "unet",
        "diffusion_model": "moss image\\moss_image_sft_int8_convrot.safetensors",
        "weight_dtype": "default",
        "clip_name": "moss\\qwen3.5_9b_w4a8_gptq.safetensors",
        "clip_type": "moss_image",
        "vae_name": "flux2_klein_alpha_rgba_vae.safetensors",
        "latent": "flux2", "skip_single_layers": "22", "skip_double_layers": "",
        "skip_end_percent": 0.5,
        "loras": [
            {"name": "[moss image]\\8步lora\\lora_latest.safetensors", "strength": 1.0, "enabled": False},
            {"name": "[moss image]\\4步加速\\moss_image_sft_4step_v2.0.safetensors", "strength": 1.0, "enabled": True},
            {"name": "[moss image]\\图片去背景\\moss_manga_alpha_image_lora.safetensors", "strength": 1.0, "enabled": True},
        ],
        "use_ref_latent": True, "sampler": "er_sde", "scheduler": "sgm_uniform", "steps": 6,
        "cfg": 1.0, "denoise": 1.0, "long_edge": 1024.0, "seed": -1, "negative": "",
        "prefix": "Moss_",
        "system_prompt": "keenbiscuit, Digital cartoon of a chibi-style of",
    },
]

SEED_PROMPT_PRESETS = [
    {"name": "三视图", "text": "生成这个角色的三视图，包含正面，侧面，背面，灰色背景", "folder": "角色", "builtin": True},
    {"name": "四视图", "text": "生成这个角色的四视图，从左到右分别为：面部特写，全身正面，全身侧面，全身背面，灰色背景", "folder": "角色", "builtin": True},
    {"name": "表情九宫格", "text": "根据图中人物制作九宫格表情包，表情依次为：开心，吐舌，愤怒，悲伤，生气，恐惧，哭泣，微笑，害羞。最终输出包含9个表情的九宫格图片", "folder": "角色", "builtin": True},
    {"name": "姿势九宫格", "text": "基于提供的 IP 形象，设计 9 种风格各异的姿势，涵盖站立、坐姿、动态动作（如跳跃、挥手）、静态姿态（如托腮、叉腰）等不同类型，每种姿势需贴合该 IP 的核心特征与性格特质，清晰呈现 IP 在各姿势下的整体形态与细节，最终输出包含9个姿势的九宫格图片。", "folder": "角色", "builtin": True},
    {"name": "手办模型", "text": "按照图中人物的1/7比例，在写实的风格和环境下，制作一个商业化的全身逼真人物模型。保持人物姿势不变，将人物模型放置在电脑桌上，使用圆形透明亚克力底座，底座上不带任何文字。在电脑屏幕上，展示人物模型的ZBrush建模过程。在电脑屏幕旁边，放置一个印有原画的BANDAI风格玩具包装盒。", "folder": "角色", "builtin": True},
    {"name": "人物抠图", "text": "提取图中完整人物，仅保留人物，去除背景，透明背景", "folder": "修图", "builtin": True},
    {"name": "老照片修复", "text": "对这张老照片进行完整修复与上色：彻底去除画面中所有划痕、缺损、污渍与霉点，将模糊的面部五官、衣物与背景重建为清晰锐利的高清细节，恢复自然的皮肤纹理、皱纹层次、头发丝与布料质感；随后为整张照片上自然真实的色彩，还原为干净通透的彩色人像，肤色红润真实、衣物呈现可信的固有色，整体色彩明亮干净、清晰通透，如同清晰彩色照片；完整保留人物的脸型、五官比例与相对位置、表情与神态、姿态以及衣物的款式结构，保持构图、取景与画面缩放完全不变，人物始终为同一可辨认的本人。", "folder": "修图", "builtin": True},
    {"name": "产品精修", "text": "对图中的产品进行精修，去除产品所有划痕、缺损、污渍、锈迹与杂质，恢复产品崭新的状态，清晰呈现产品原有的材质与结构细节，精细的光照效果与质感，表面干净。构图保持原图产品摆放与视角不变。\n同时对产品进行抠图，将产品从场景中提取出来，输出仅保留产品，透明背景。保留产品完整主体，边缘干净利落、无残留背景色边或锯齿。", "folder": "修图", "builtin": True},
    {"name": "双人海报", "text": "参考图二的风格，生成一张电影海报，包含图二和图一两个人物背靠背，主题文字为：新的征程，暗金色书法大字", "folder": "合成", "builtin": True},
    {"name": "人物换装", "text": "让图一的人物穿上图二的衣服", "folder": "合成", "builtin": True},
    {"name": "替换头部", "text": "把图2的人物头部和发型替换到图1，肤色，比例，和图1保持一致", "folder": "合成", "builtin": True},
    {"name": "双人拥抱", "text": "让图一的人物和图二的人物，拥抱在一起，在城市街道", "folder": "合成", "builtin": True},
    {"name": "人持产品", "text": "图1的人物手里拿着图2的产品进行展示，专业影棚，光线和色调符合所在场景环境", "folder": "合成", "builtin": True},
    {"name": "九格漫画", "text": "根据图片内容生成漫画故事，九格漫画，文本气泡中带有中文剧情，有特写与大场景切换，分镜之间避免雷同，Q版风格", "folder": "漫画", "builtin": True},
    {"name": "四格分镜", "text": "生成四格电影分镜，全程人物形象保持统一：\n第1格：少女单膝跪在粗糙黑岩石上，拉满弓弦，目光锁定远处目标，蓄势待发，神情严肃，风吹长发。\n第2格：松开弓弦，弓身震动，箭矢向前射出，长发猛烈飞扬。\n第3格：特写镜头，发光箭矢带着淡青色光尾破空飞行，背景里少女虚化，箭矢带动态速度模糊。\n第4格：少女望向远方，远处目标迸发出橙色小型爆炸，神情放松平静。", "folder": "漫画", "builtin": True},
    {"name": "抠图", "text": "提取图中完整人物，仅保留人物，去除背景，透明背景", "folder": "修图", "builtin": True},
]


DEFAULT_CONFIG = {
    "comfyui": {
        "url": "http://127.0.0.1:8188",
        "workflow_path": "",
        "prompt_node_id": "",
        "negative_node_id": "",
        "negative_prompt": "",
        "batch_node_id": "",
        "batch_size": 1,
        "filename_prefix": "RPG",
        "output_dir": "",
        "timeout_sec": 600,
        "poll_interval_ms": 500,
        "random_seed": True,
        "install_dir": "H:\\COMFYUI_dapao\\ComfyUI",
        "python_dir": "H:\\COMFYUI_dapao\\python_dapao312\\python.exe",
        "launch_args": '--enable-cors-header "*" --disable-xformers --lowvram --async-offload',
        "open_browser": True,
        "quit_with_comfy": False,
    },
    "providers": [],
    "active_provider": LOCAL_ID,
    "model_presets": [],
    "active_model_preset": "Moss_8步_透明底",
    "workflow_presets": [],
    "active_workflow_preset": "",
    "prompt_presets": [],
    "include_sensitive": False,
    "launch_comfyui": False,
    # ---- 全局出图参数（按作用域隔离） ----
    # 不同出图场景用不同的配置，彼此互不串扰：
    #   global     —— ComfyUI 设置面板（全局默认）
    #   scenes     —— 场景出图（场景管理 / 场景合成）
    #   characters —— 人物动作表情 / 人物外观出图
    # 顶层 gen_params 即 global 作用域；scenes / characters 各自存于 gen_params_by_scope。
    # 0 表示「不覆盖，用模型方案自带的值」。
    "gen_params": {
        "width": 832,
        "height": 1216,
        "size_preset": "portrait",   # portrait / landscape / square / custom
        "model_preset": "",           # 空 = 用激活方案
        "steps": 0,
        "cfg": 0.0,
        "seed": -1,
        "seed_mode": "random",        # random / fixed
        "batch_size": 1,
        "count": 10,                  # 批量出图默认张数
        "extra_negative": "",
    },
    "_seeded": False,
}

#: 尺寸预设 → (宽, 高)，前后端共用这一套定义
SIZE_PRESETS = {
    "portrait": (832, 1216),
    "landscape": (1216, 832),
    "square": (1024, 1024),
    "portrait_2k": (1024, 1536),
    "story": (1280, 720),
}


class ComfyUIConfigStore:
    def __init__(self, path=CONFIG_PATH):
        self.path = path
        self._data = self._load()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:  # noqa: BLE001
                data = {}
        else:
            data = {}
        # 合并：默认兜底所有缺失键
        merged = json.loads(json.dumps(DEFAULT_CONFIG))
        for k, v in (data or {}).items():
            if k == "comfyui" and isinstance(v, dict):
                merged["comfyui"] = {**DEFAULT_CONFIG["comfyui"], **v}
            else:
                merged[k] = v
        # 首次播种：把参考项目的模型方案 + 提示词词库抄入
        if not merged.get("_seeded"):
            if not merged.get("model_presets"):
                merged["model_presets"] = json.loads(json.dumps(SEED_MODEL_PRESETS))
            if not merged.get("prompt_presets"):
                merged["prompt_presets"] = json.loads(json.dumps(SEED_PROMPT_PRESETS))
            if not merged.get("active_model_preset"):
                merged["active_model_preset"] = "Moss_8步_透明底"
            merged["_seeded"] = True
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump(merged, f, ensure_ascii=False, indent=2)
            except Exception:  # noqa: BLE001
                pass
        # install_dir 等连接信息为空时回退到种子默认（用户已知 ComfyUI 安装位置）
        c = merged["comfyui"]
        if not c.get("install_dir"):
            c["install_dir"] = DEFAULT_CONFIG["comfyui"]["install_dir"]
        if not c.get("python_dir"):
            c["python_dir"] = DEFAULT_CONFIG["comfyui"]["python_dir"]
        if not c.get("launch_args"):
            c["launch_args"] = DEFAULT_CONFIG["comfyui"]["launch_args"]
        return merged

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)

    # ---------- comfyui 基础设置 ----------
    def get_comfyui(self):
        return self._data["comfyui"]

    def set_comfyui(self, patch: dict):
        self._data["comfyui"].update({k: v for k, v in patch.items() if k in DEFAULT_CONFIG["comfyui"]})
        self.save()
        return self._data["comfyui"]

    # ---------- 服务商（多套 ComfyUI） ----------
    def get_providers(self):
        out = [{
            "id": LOCAL_ID, "name": "本地 ComfyUI", "url": self._data["comfyui"]["url"],
            "desc": "本机 127.0.0.1:8188", "timeout_sec": self._data["comfyui"]["timeout_sec"],
            "api_key": self._data["comfyui"].get("api_key", ""), "local": True,
            "tested_ok": False,
        }]
        for p in self._data["providers"]:
            out.append({**p, "local": False})
        return out

    def add_provider(self, name, url, desc="", timeout_sec=600, api_key=""):
        pid = "p_" + uuid.uuid4().hex[:8]
        self._data["providers"].append({
            "id": pid, "name": name, "url": url, "desc": desc,
            "timeout_sec": timeout_sec, "api_key": api_key, "tested_ok": False,
        })
        self.save()
        return pid

    def update_provider(self, pid, patch):
        if pid == LOCAL_ID:
            if "url" in patch:
                self._data["comfyui"]["url"] = patch["url"]
            if "timeout_sec" in patch:
                self._data["comfyui"]["timeout_sec"] = patch["timeout_sec"]
            if "api_key" in patch:
                self._data["comfyui"]["api_key"] = patch["api_key"]
            self.save()
            return
        for p in self._data["providers"]:
            if p["id"] == pid:
                p.update({k: v for k, v in patch.items() if k in ("name", "url", "desc", "timeout_sec", "api_key")})
                break
        self.save()

    def delete_provider(self, pid):
        self._data["providers"] = [p for p in self._data["providers"] if p["id"] != pid]
        if self._data["active_provider"] == pid:
            self._data["active_provider"] = LOCAL_ID
        self.save()

    def set_active_provider(self, pid):
        self._data["active_provider"] = pid
        if pid != LOCAL_ID:
            p = next((x for x in self._data["providers"] if x["id"] == pid), None)
            if p:
                self._data["comfyui"]["url"] = p["url"]
                self._data["comfyui"]["timeout_sec"] = p.get("timeout_sec", 600)
        self.save()

    def get_active_provider(self):
        pid = self._data["active_provider"]
        if pid == LOCAL_ID:
            return {"id": LOCAL_ID, "name": "本地 ComfyUI", "url": self._data["comfyui"]["url"],
                    "api_key": self._data["comfyui"].get("api_key", ""), "timeout_sec": self._data["comfyui"]["timeout_sec"]}
        p = next((x for x in self._data["providers"] if x["id"] == pid), None)
        if p:
            return p
        return {"id": LOCAL_ID, "name": "本地 ComfyUI", "url": self._data["comfyui"]["url"],
                "api_key": "", "timeout_sec": self._data["comfyui"]["timeout_sec"]}

    def mark_tested(self, pid, ok):
        if pid == LOCAL_ID:
            return
        for p in self._data["providers"]:
            if p["id"] == pid:
                p["tested_ok"] = ok
        self.save()

    # ---------- 模型配置方案（ModelPreset 全字段） ----------
    def get_model_presets(self):
        return self._data["model_presets"]

    def get_model_preset_by_name(self, name):
        return next((p for p in self._data["model_presets"] if p["name"] == name), None)

    def add_model_preset(self, preset: dict):
        name = preset.get("name") or "新配置"
        # 去重命名
        names = {p["name"] for p in self._data["model_presets"]}
        base = name
        i = 2
        while name in names:
            name = f"{base} {i}"
            i += 1
        preset = dict(preset)
        preset["name"] = name
        self._data["model_presets"].append(preset)
        self.save()
        return name

    def update_model_preset(self, index, patch):
        if 0 <= index < len(self._data["model_presets"]):
            self._data["model_presets"][index].update(patch)
            self.save()

    def delete_model_preset(self, index):
        if 0 <= index < len(self._data["model_presets"]):
            del self._data["model_presets"][index]
            # 清掉失效的激活项
            active = self._data.get("active_model_preset")
            if active and not self.get_model_preset_by_name(active):
                self._data["active_model_preset"] = ""
            self.save()

    def set_active_model_preset(self, name):
        self._data["active_model_preset"] = name
        self.save()

    def get_active_model_preset(self):
        name = self._data["active_model_preset"]
        if name:
            return self.get_model_preset_by_name(name)
        return None

    # ---------- ComfyUI 工作流方案（param_presets） ----------
    def get_workflow_presets(self):
        return self._data["workflow_presets"]

    def get_workflow_preset_by_name(self, name):
        return next((p for p in self._data["workflow_presets"] if p["name"] == name), None)

    def add_workflow_preset(self, name, workflow, overrides=None, note=""):
        self._data["workflow_presets"].append({
            "name": name or "新工作流", "workflow": workflow,
            "overrides": overrides or {}, "note": note,
        })
        self.save()

    def update_workflow_preset(self, index, patch):
        if 0 <= index < len(self._data["workflow_presets"]):
            self._data["workflow_presets"][index].update(patch)
            self.save()

    def delete_workflow_preset(self, index):
        if 0 <= index < len(self._data["workflow_presets"]):
            del self._data["workflow_presets"][index]
            self.save()

    def set_active_workflow_preset(self, name):
        self._data["active_workflow_preset"] = name
        self.save()

    def get_active_workflow_preset(self):
        name = self._data["active_workflow_preset"]
        if name:
            return self.get_workflow_preset_by_name(name)
        return None

    # ---------- 提示词词库 ----------
    def get_prompt_presets(self):
        # 老数据没有 id：补一次并落盘，之后所有增删改都以 id 定位，
        # 避免「按下标删 / 下标在删除后错位」把别的条目误删。
        dirty = False
        for p in self._data["prompt_presets"]:
            if not p.get("id"):
                p["id"] = uuid.uuid4().hex[:12]
                dirty = True
        if dirty:
            self.save()
        return self._data["prompt_presets"]

    def add_prompt_preset(self, name, text, folder="未分类"):
        self._data["prompt_presets"].append({
            "id": uuid.uuid4().hex[:12],
            "name": name or "新提示词", "text": text,
            "folder": folder, "builtin": False,
        })
        self.save()

    def update_prompt_preset(self, index, patch):
        if 0 <= index < len(self._data["prompt_presets"]):
            self._data["prompt_presets"][index].update(patch)
            self.save()

    def delete_prompt_preset(self, index):
        if 0 <= index < len(self._data["prompt_presets"]):
            del self._data["prompt_presets"][index]
            self.save()

    def delete_prompt_presets(self, ids=None, names=None, indices=None):
        """批量删除：id / name / index 任一命中即删，返回删掉几条。"""
        id_set = {str(x) for x in (ids or []) if x}
        name_set = {str(x) for x in (names or []) if x}
        idx_set = set()
        for i in (indices or []):
            try:
                idx_set.add(int(i))
            except (TypeError, ValueError):
                continue
        if not (id_set or name_set or idx_set):
            return 0
        keep = []
        removed = 0
        for i, p in enumerate(self._data["prompt_presets"]):
            if (str(p.get("id") or "") in id_set
                    or str(p.get("name") or "") in name_set
                    or i in idx_set):
                removed += 1
            else:
                keep.append(p)
        if removed:
            self._data["prompt_presets"] = keep
            self.save()
        return removed

    def restore_builtin_prompts(self):
        """把被删掉的内置提示词按名称补回来（不覆盖用户改过的同名条目）。

        和参考项目 prompt_lib.merge_defaults 一个套路：文件存在就以文件为准，
        只有「名字没了」才补，用户改过的内容不会被冲掉。
        返回 (补了几条, 补完后的总数)。
        """
        have = {p.get("name") for p in self._data["prompt_presets"]}
        added = 0
        for seed in SEED_PROMPT_PRESETS:
            if seed["name"] not in have:
                item = json.loads(json.dumps(seed))
                item["id"] = uuid.uuid4().hex[:12]
                self._data["prompt_presets"].append(item)
                added += 1
        if added:
            self.save()
        return added, len(self._data["prompt_presets"])

    # ---------- 成人维度开关 ----------
    def get_include_sensitive(self):
        return bool(self._data.get("include_sensitive"))

    def set_include_sensitive(self, val: bool):
        self._data["include_sensitive"] = bool(val)
        self.save()

    # ---------- 全局出图参数（按作用域隔离） ----------
    # 作用域取值：global / scenes / characters。
    # global 复用顶层 gen_params（向后兼容历史数据）；其余作用域各自独立存放在
    # gen_params_by_scope 下，互不继承 live 全局，避免「在场景改了配置串到人物」。
    VALID_SCOPES = ("global", "scenes", "characters")

    def _scope_slot(self, scope):
        """返回 (当前存储字典, 写入目标容器, 写入键)。"""
        if scope not in self.VALID_SCOPES or scope == "global":
            return (self._data.get("gen_params") or {}), self._data, "gen_params"
        by_scope = self._data.setdefault("gen_params_by_scope", {})
        return (by_scope.get(scope) or {}), by_scope, scope

    def get_gen_params(self, scope: str = "global") -> dict:
        base, _, _ = self._scope_slot(scope)
        gp = dict(DEFAULT_CONFIG["gen_params"])
        gp.update(base)
        # 尺寸预设与宽高保持自洽：选了预设但宽高没手改过时，按预设回填
        preset = gp.get("size_preset") or "custom"
        if preset in SIZE_PRESETS and preset != "custom":
            # 只有当宽高恰好等于某个预设或为 0 时才跟随预设，避免覆盖手填值
            w, h = SIZE_PRESETS[preset]
            if not gp.get("width") or not gp.get("height"):
                gp["width"], gp["height"] = w, h
        return gp

    def set_gen_params(self, patch: dict, scope: str = "global"):
        base, slot, key = self._scope_slot(scope)
        cur = dict(DEFAULT_CONFIG["gen_params"])
        cur.update(base)
        for k, v in (patch or {}).items():
            if k not in DEFAULT_CONFIG["gen_params"]:
                continue
            cur[k] = v
        # 选了预设尺寸 → 同步宽高，前端不用两处都写
        preset = cur.get("size_preset")
        if preset in SIZE_PRESETS:
            w, h = SIZE_PRESETS[preset]
            cur["width"], cur["height"] = w, h
        # 宽高被手改 → 反推是否为某个预设，否则标成自定义
        elif preset == "custom" and not cur.get("width"):
            cur["width"], cur["height"] = 832, 1216
        slot[key] = cur
        self.save()
        return cur

    # ---------- 整体 ----------
    def get_all(self):
        self._data["gen_params"] = self.get_gen_params("global")
        # 刷新各作用域缓存，确保配置面板拿到最新的全部分域参数
        by_scope = self._data.setdefault("gen_params_by_scope", {})
        for sc in self.VALID_SCOPES:
            if sc == "global":
                continue
            by_scope[sc] = self.get_gen_params(sc)
        return self._data
