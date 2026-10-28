"""给现有角色配置性别与语音主播，并验证 /api/tts/nodes 批量预合成。

这一步同时是对 CharacterUpdate schema 新字段的验证——
如果 gender/tts_voice 没能写进库，后台页面再好看也没用。
"""
import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8000"


def req(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


# 依据角色人设挑音色：这里刻意让男女各占一半，验证性别区分是否真的生效
PLAN = [
    (1, "kong",   "male",   "zh-CN-YunxiNeural",     0,   0, "玩家·清朗少年"),
    (2, "黄蓉",   "female", "zh-CN-XiaoyiNeural",    5,   0, "活泼少女"),
    (3, "牛头人", "male",   "zh-CN-YunjianNeural",  -10, -5, "浑厚怪物/反派"),
    (4, "丽莎",   "female", "zh-CN-XiaoxiaoNeural",   0,   5, "温柔御姐"),
    (5, "韩秋雪", "female", "zh-CN-XiaoxiaoNeural",  -5,  10, "清冷女侠"),
]

print("=" * 74)
print("步骤 1：把性别 / 语音主播写进角色档案")
for cid, name, gender, voice, rate, pitch, note in PLAN:
    t0 = time.time()
    got = req("PUT", f"/api/characters/{cid}", {
        "gender": gender,
        "tts_engine": "edge",
        "tts_voice": voice,
        "tts_rate": rate,
        "tts_pitch": pitch,
    })
    ms = int((time.time() - t0) * 1000)
    print(f"  {name:6s} gender={got.get('gender'):6s} voice={got.get('tts_voice'):22s} "
          f"rate={got.get('tts_rate'):>4} pitch={got.get('tts_pitch'):>4}  {ms:4d}ms  {note}")

print("\n步骤 2：校验字段真的落库了（重新读一遍，不是信任写入返回值）")
for cid, name, *_ in PLAN:
    got = req("GET", f"/api/characters/{cid}")
    ok = got.get("gender") not in (None, "unknown") and got.get("tts_voice")
    print(f"  {name:6s} gender={got.get('gender'):6s} voice={got.get('tts_voice'):22s} -> {'OK' if ok else 'FAIL'}")

print("\n步骤 3：调用 /api/tts/nodes 批量预合成 node 1（9 句对话）")
t0 = time.time()
res = req("POST", "/api/tts/nodes", {"node_ids": [1]})
spent = int((time.time() - t0) * 1000)
items = res.get("items", [])
print(f"  返回 {len(items)} 句，耗时 {spent}ms，平均 {spent // max(1, len(items))}ms/句")
total_kb = 0
for it in items:
    dur = it.get("duration_ms", 0)
    total_kb += it.get("bytes", 0) / 1024
    print(f"    [{it.get('speaker_name','?'):6s}] {str(it.get('engine')):8s} "
          f"{it.get('bytes',0)/1024:6.1f}KB 时长{dur:5d}ms  cached={it.get('cached')} "
          f"{(it.get('text') or '')[:26]}")
print(f"  音频总体积 {total_kb:.1f}KB")

print("\n步骤 4：二次请求同一节点（应当全部命中缓存）")
t0 = time.time()
res2 = req("POST", "/api/tts/nodes", {"node_ids": [1]})
spent2 = int((time.time() - t0) * 1000)
cached_n = sum(1 for i in res2.get("items", []) if i.get("cached"))
print(f"  耗时 {spent2}ms，命中缓存 {cached_n}/{len(res2.get('items', []))}")
print(f"  提速 {spent}ms -> {spent2}ms")

print("\n步骤 5：连自己的下一批节点也能一次打包（node 6,7,8,9）")
t0 = time.time()
res3 = req("POST", "/api/tts/nodes", {"node_ids": [6, 7, 8, 9]})
spent3 = int((time.time() - t0) * 1000)
print(f"  返回 {len(res3.get('items', []))} 句，耗时 {spent3}ms")
for it in res3.get("items", [])[:6]:
    print(f"    node{it.get('node_id')} [{it.get('speaker_name','?'):6s}] "
          f"{it.get('engine')} {(it.get('text') or '')[:24]}")

print("\n步骤 6：缓存状态")
info = req("GET", "/api/tts/cache")
for k, v in info.items():
    print(f"  {k}: {v}")
