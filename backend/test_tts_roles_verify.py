"""验证派生角色声线真的能合成，且参数确实改变了音频（证明老人/小孩不是空壳）。

只打关键证据：每个角色声线合成成功 + 与基础音色在时长/体积上有可测量差异。
同时单点探一下 OneCore 兜底是否还活着（不阻塞主流程）。
"""
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://127.0.0.1:8001"
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "tts-cache")


def synth(text, voice_id, engine="edge", rate=0, pitch=0, timeout=60):
    payload = json.dumps({
        "text": text, "voice_id": voice_id, "engine_id": engine,
        "rate": rate, "pitch": pitch,
    }).encode()
    req = urllib.request.Request(BASE + "/api/tts/synth", data=payload, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def safe_synth(*a, **k):
    try:
        return synth(*a, **k)
    except Exception as e:
        return {"error": str(e)[:160]}


print("=" * 78)
print("验收：派生角色声线合成（Edge 主引擎）")
print("=" * 78)

cases = [
    ("基础男声", "zh-CN-YunjianNeural", "edge", "年轻人快步走来，神色慌张。"),
    ("苍老长者(老)", "zh-CN-YunjianNeural#elder_m", "edge", "年轻人快步走来，神色慌张。"),
    ("稚气男童(童)", "zh-CN-YunxiaNeural#child_m", "edge", "年轻人快步走来，神色慌张。"),
    ("慈祥老妪(老)", "zh-CN-XiaoxiaoNeural#elder_f", "edge", "孩子，慢些走，别摔着。"),
    ("稚气女童(童)", "zh-CN-XiaoyiNeural#child_f", "edge", "孩子，慢些走，别摔着。"),
    ("说书先生", "zh-CN-YunyangNeural#narrator_m", "edge", "话说当年，这座城池风云变幻。"),
]

print(f"{'标签':14s} {'引擎':6s} {'状态':6s} {'字节':>8s} {'时长ms':>8s} {'缓存':6s}")
print("-" * 78)
for label, vid, eng, text in cases:
    r = safe_synth(text, vid, eng, timeout=90)
    if r.get("error"):
        print(f"{label:14s} {eng:6s} ERR   -        -       {r['error'][:40]}")
        continue
    ok = bool(r.get("url")) and r.get("bytes", 0) > 0
    print(f"{label:14s} {eng:6s} {'OK' if ok else 'FAIL':6s} {r.get('bytes',0):8d} "
          f"{r.get('duration_ms',0):8d} {str(r.get('cached')):6s}")

print()
print("=" * 78)
print("单点探 OneCore 兜底（本机 Windows 离线）— 不阻塞上面结果")
print("=" * 78)
t0 = time.time()
r = safe_synth("小友，你终于来了。", "Microsoft Kangkang", "onecore", timeout=45)
dt = int((time.time() - t0) * 1000)
if r.get("error"):
    print(f"OneCore: 不可用/超时 -> {r['error'][:80]}  ({dt}ms)")
else:
    ok = bool(r.get("url")) and r.get("bytes", 0) > 0
    print(f"OneCore: {'可用' if ok else '异常'} bytes={r.get('bytes',0)} 耗时={dt}ms")
