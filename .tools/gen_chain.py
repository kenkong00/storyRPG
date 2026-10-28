import json, time, urllib.request

def post(path, body, timeout=600):
    req = urllib.request.Request("http://127.0.0.1:8000" + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

# 1) 随机一个风格一致的外观
t0 = time.time()
ap = post("/api/appearance/random", {
    "gender": "female", "age": "young", "style": "fantasy",
    "mode": "neutral", "include_sensitive": False, "seed": 20261027,
})
print("random elapsed %.2fs" % (time.time() - t0))
print("appearance keys:", len(ap.get("appearance", {})))

# 2) 预览提示词（前端四段预览走的同一个接口）
pt = post("/api/appearance/prompt", {"appearance": ap["appearance"], "include_sensitive": False})
print("posEn:", pt["prompt"]["posEn"][:220])
print("negEn:", pt["prompt"]["negEn"][:160])

# 3) 用 Moss_8步_透明底 出图
t0 = time.time()
res = post("/api/comfyui/generate", {
    "appearance": ap["appearance"],
    "mode": "t2i",
    "include_sensitive": False,
    "prompt_lang": "en",
    "batch_size": 1,
    "filename_prefix": "RPG_Char",
    "model_preset": "Moss_8步_透明底",
    "use_active_model_preset": False,
    "width": 832, "height": 1216,
    "timeout_sec": 420,
    "random_seed": True,
})
print("generate elapsed %.1fs" % (time.time() - t0))
print("ok:", res.get("ok"), "images:", res.get("images"))
