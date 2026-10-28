import json, time, urllib.request

body = {
    "model_preset": "Moss_8步_透明底",
    "use_active_model_preset": False,
    "positive": "1girl, long silver hair, blue eyes, wearing heavy full-body plate armor with helmet, no exposed skin, standing, full body, white background, masterpiece, best quality",
    "negative": "nsfw, nude, naked, lowres, bad anatomy, worst quality, blurry",
    "mode": "t2i",
    "width": 832, "height": 1216,
    "filename_prefix": "RPG_MossTest",
    "timeout_sec": 420,
    "seed": 12345,
    "random_seed": False,
}
req = urllib.request.Request(
    "http://127.0.0.1:8000/api/comfyui/generate",
    data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type": "application/json"}, method="POST")
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=500) as r:
        d = json.loads(r.read().decode("utf-8"))
    print("ELAPSED %.1fs" % (time.time() - t0))
    print("ok:", d.get("ok"))
    print("prompt_id:", d.get("prompt_id"))
    print("images:", json.dumps(d.get("images"), ensure_ascii=False))
    print("files:", json.dumps(d.get("files"), ensure_ascii=False))
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(e.read().decode("utf-8", "ignore")[:1500])
except Exception as e:
    print("ERR", type(e).__name__, e)
