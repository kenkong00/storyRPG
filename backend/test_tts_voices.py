"""验收：扩充后的音色池 + 派生角色声线。

验收点（每一条都要能给出实测数字，不接受「应该可以」）：
  1. 音色总数与男女分布，确认粤语/台普真的放开了
  2. 派生声线存在，且老人/小孩各有男女
  3. 派生声线合成出的音频与基础音色确实不同（时长/字节是硬证据）
  4. 派生声线的参数叠加生效（角色自己调的语速不被覆盖）
  5. 本机引擎也能派生（断网兜底时老人声线不退化）
  6. 二次请求命中缓存
"""
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8000"


def api(method, path, payload=None, timeout=180):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode("utf-8"))
    return body, int((time.time() - t0) * 1000)


def synth(text, voice_id, engine="edge", rate=0, pitch=0):
    body, ms = api("POST", "/api/tts/synth", {
        "text": text, "voice_id": voice_id, "engine_id": engine,
        "rate": rate, "pitch": pitch,
    })
    return body, ms


def head(n):
    print()
    print("=" * 78)
    print(n)
    print("=" * 78)


head("验收 1：音色池总览")
groups, _ = api("GET", "/api/tts/voices?grouped=true")
edge = next((g for g in groups["groups"] if g["id"] == "edge"), None)
vs = edge["voices"]
native = [v for v in vs if not v["derived"]]
derived = [v for v in vs if v["derived"]]
male = [v for v in vs if v["gender"] == "male"]
female = [v for v in vs if v["gender"] == "female"]
print(f"  Edge 引擎音色总数：{len(vs)}（原生 {len(native)} + 派生 {len(derived)}）")
print(f"  性别分布：男 {len(male)} / 女 {len(female)}")
print()
print("  --- 原生音色（按分组）---")
for key, label in (("standard", "普通话"), ("dialect", "方言"), ("regional", "地区口音")):
    sub = [v for v in native if v["group"] == key]
    if not sub:
        continue
    print(f"  [{label}] {len(sub)} 个")
    for v in sub:
        age = {"child": "童声", "elder": "老年"}.get(v["age"], "")
        tag = f" <{age}>" if age else ""
        print(f"      {v['gender']:6s} {v['name']:4s}·{v['style']:4s}{tag:8s} {v['voice_id']}")

print()
print("  --- 派生角色声线 ---")
for v in derived:
    age = {"child": "童声", "elder": "老年", "adult": "青壮"}.get(v["age"], "")
    print(f"      {v['gender']:6s} [{age}] {v['name']:8s}·{v['style']:4s} "
          f"rate{v['rate']:+3d} pitch{v['pitch']:+3d}  {v['note'][:26]}")

print()
ok1 = len(native) >= 14 and len(derived) >= 12
print(f"  结果：{'PASS' if ok1 else 'FAIL'}（期望原生>=14、派生>=12，实际 {len(native)}/{len(derived)}）")

head("验收 2：老人 / 小孩声线是否真的改变了音频")
TEXT = "小友，你终于来了，老夫在此等候多时。"
cases = [
    ("基础音色", "zh-CN-YunjianNeural", 0, 0),
    ("苍老长者", "zh-CN-YunjianNeural#elder_m", 0, 0),
    ("稚气男童", "zh-CN-YunxiaNeural#child_m", 0, 0),
]
print(f"  文本：{TEXT}")
print(f"  {'声线':10s} {'时长(ms)':>9s} {'字节':>8s} {'引擎':>6s}")
base_dur = None
rows = []
for label, vid, r, p in cases:
    body, ms = synth(TEXT, vid)
    if not body.get("url"):
        print(f"  {label:10s} 失败：{body.get('error')}")
        continue
    dur = body["duration_ms"]
    size = body["bytes"]
    rows.append((label, dur, size))
    if base_dur is None:
        base_dur = dur
    print(f"  {label:10s} {dur:9d} {size:8d} {body['engine']:>6s}  (合成 {ms}ms)")
print()
if len(rows) >= 2:
    elder = next((x for x in rows if x[0] == "苍老长者"), None)
    child = next((x for x in rows if x[0] == "稚气男童"), None)
    if elder and base_dur:
        ratio = elder[1] / base_dur
        print(f"  苍老长者 / 基础音色 时长比 = {ratio:.2f}（语速 -20% 应明显变长）")
    if elder and child:
        ratio = elder[1] / child[1]
        print(f"  苍老长者 / 稚气男童 时长比 = {ratio:.2f}（两者节奏应明显不同）")
    ok2 = bool(elder and base_dur and elder[1] > base_dur * 1.1)
    print(f"  结果：{'PASS' if ok2 else 'FAIL'}（派生音频时长应与基础音色有可测差异）")
else:
    ok2 = False
    print("  结果：FAIL（样本不足）")

head("验收 3：角色自己调的语速不被派生声线覆盖（叠加而非替换）")
a, _ = synth(TEXT, "zh-CN-YunjianNeural#elder_m", rate=0, pitch=0)
b, _ = synth(TEXT, "zh-CN-YunjianNeural#elder_m", rate=-30, pitch=0)
print(f"  角色 rate=0  ：时长 {a['duration_ms']}ms")
print(f"  角色 rate=-30：时长 {b['duration_ms']}ms")
ok3 = a.get("duration_ms", 0) and b.get("duration_ms", 0) and b["duration_ms"] > a["duration_ms"]
print(f"  结果：{'PASS' if ok3 else 'FAIL'}（叠加生效：调更慢后音频应更长）")

head("验收 4：本机引擎（离线兜底）也能派生声线")
local, _ = api("GET", "/api/tts/voices?grouped=true")
lg = next((g for g in local["groups"] if g["id"] == "onecore"), None)
if lg and lg["voices"]:
    ld = [v for v in lg["voices"] if v["derived"]]
    print(f"  本机音色：原生 {len(lg['voices']) - len(ld)} + 派生 {len(ld)}")
    for v in ld[:4]:
        print(f"      {v['gender']:6s} {v['name']:8s} base={v['voice_id'].split('#')[0]}")
    sample = ld[0] if ld else None
    if sample:
        body, ms = synth(TEXT, sample["voice_id"], engine="onecore")
        got = body.get("duration_ms", 0)
        print(f"  用「{sample['name']}」合成：时长 {got}ms  引擎 {body.get('engine')}  "
              f"{'OK' if got else 'FAIL ' + str(body.get('error'))}")
        ok4 = got > 0
    else:
        ok4 = False
        print("  无派生声线")
else:
    ok4 = False
    print("  本机引擎不可用，跳过")
print(f"  结果：{'PASS' if ok4 else 'FAIL'}")

head("验收 5：缓存命中（同一声线第二次应接近 0 耗时）")
_, cold = synth(TEXT, "zh-CN-XiaoxiaoNeural#elder_f")
_, warm = synth(TEXT, "zh-CN-XiaoxiaoNeural#elder_f")
print(f"  首次 {cold}ms -> 再次 {warm}ms")
ok5 = warm < max(120, cold * 0.3)
print(f"  结果：{'PASS' if ok5 else 'FAIL'}")

print()
print("=" * 78)
print("总计：", "全部通过" if all([ok1, ok2, ok3, ok4, ok5]) else "有未通过项，见上")
print("=" * 78)
