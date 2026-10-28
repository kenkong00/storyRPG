"""最终验收：冷缓存 -> 热缓存 -> 性别音色 -> 降级链，全部用实测数字说话。"""
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://127.0.0.1:8000"

# 男女对照用的中文音色表（与 catalog.py 保持一致）
VOICE_META = {
    "zh-CN-XiaoxiaoNeural": ("女", "晓晓·温柔"),
    "zh-CN-XiaoyiNeural": ("女", "晓伊·活泼"),
    "zh-CN-YunjianNeural": ("男", "云健·激情"),
    "zh-CN-YunxiNeural": ("男", "云希·活泼"),
    "zh-CN-YunyangNeural": ("男", "云扬·专业"),
    "zh-CN-YunxiaNeural": ("男", "云夏·可爱"),
    "Microsoft Huihui": ("女", "慧慧·本机"),
    "Microsoft Yaoyao": ("女", "瑶瑶·本机"),
    "Microsoft Kangkang": ("男", "康康·本机"),
}


def api(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ms(t0):
    return int((time.time() - t0) * 1000)


print("=" * 78)
print("验收 0：角色当前的语音配置（从库里现场读回来，不信任之前的结果）")
for cid in (1, 2, 3, 4, 5):
    try:
        c = api("GET", f"/api/characters/{cid}")
        print(f"    {c['name']:8s} gender={c.get('gender'):8s} engine={c.get('tts_engine'):8s} "
              f"voice={c.get('tts_voice')}")
    except Exception as e:
        print("    FAIL", e)

print("\n验收 1：进入剧情节点 node 1（9 句）—— 逐句合成")
t0 = time.time()
cold = api("POST", "/api/tts/nodes", {"node_ids": [1]})
cold_ms = ms(t0)
items = cold["items"]
print(f"  耗时 {cold_ms}ms，{len(items)} 句，平均 {cold_ms // max(1,len(items))}ms/句")

print("\n验收 2：每个角色是否真的拿到了「符合自己性别」的音色")
gender_of_char = {"黄蓉": "female", "kong": "male", "牛头人": "male"}
bad = 0
seen = {}
for it in items:
    sp, vid = it["speaker_name"], it.get("voice_id") or "-"
    g = VOICE_META.get(vid, ("?", "?"))
    seen.setdefault(sp, set()).add((vid, g[0]))
    key = (sp, vid, g[0], it["duration_ms"])
    print(f"    {sp:8s} {vid:22s} {g[0]}声 {g[1]:10s} 时长{it['duration_ms']:5d}ms  {it['text'][:22]}")
    want = gender_of_char.get(sp)
    if want and g[0] != ("男" if want == "male" else "女"):
        bad += 1
print(f"\n  角色 -> 音色一致性：{'全部正确' if bad == 0 else str(bad) + ' 处不匹配'}")
for sp, s in seen.items():
    print(f"    {sp:8s} 使用 {len(s)} 个音色：{sorted(s)}")

print("\n验收 3：热缓存 —— 再次进入同一节点")
t0 = time.time()
hot = api("POST", "/api/tts/nodes", {"node_ids": [1]})
hot_ms = ms(t0)
n_cached = sum(1 for i in hot["items"] if i.get("cached"))
print(f"  耗时 {hot_ms}ms，命中缓存 {n_cached}/{len(hot['items'])}")
print(f"  提速：{cold_ms}ms -> {hot_ms}ms  ({cold_ms // max(1, hot_ms)}x)")

print("\n验收 4：跨节点批量预载 node 6,7,8,9（模拟连续剧情）")
t0 = time.time()
multi = api("POST", "/api/tts/nodes", {"node_ids": [6, 7, 8, 9]})
m_ms = ms(t0)
for it in multi["items"]:
    g = VOICE_META.get(it.get("voice_id") or "-", ("?", "?"))
    print(f"    node{it['node_id']} {it['speaker_name']:8s} {g[0]}声 {it.get('voice_id')}")
print(f"  耗时 {m_ms}ms，{len(multi['items'])} 句")

print("\n验收 5：音频文件真实可下载（抽查 3 条 URL 的 HTTP 状态与体积）")
import urllib.error
for it in items[:3]:
    url = BASE + it["url"]
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=20) as r:
            size = int(r.headers.get("Content-Length") or 0)
            ctype = r.headers.get("Content-Type")
            cache = r.headers.get("Cache-Control")
            print(f"    {r.status}  {size/1024:6.1f}KB  {ctype}  Cache-Control={cache}")
    except Exception as e:
        print("    FAIL", e)

print("\n验收 6：缓存统计")
for k, v in api("GET", "/api/tts/cache").items():
    print(f"  {k}: {v}")

print("\n验收 7：降级链 —— 强制用不存在的引擎请求，应自动落到可用引擎且仍有音频")
r = api("POST", "/api/tts/synth", {
    "text": "这是降级测试，应当仍然有声音。",
    "engine_id": "this_engine_does_not_exist",
    "gender": "male",
})
print(f"  实际使用引擎={r.get('engine')}  有音频={bool(r.get('url'))}  error={r.get('error')!r}")

print("\n验收 8：异常输入 —— 空文本不应让接口崩掉")
r2 = api("POST", "/api/tts/synth", {"text": "   ", "gender": "female"})
print(f"  url={bool(r2.get('url'))}  error={r2.get('error')!r}")
print("\n完成。")
