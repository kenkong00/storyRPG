"""语音服务端到端验证：合成 / 缓存命中 / 降级 / 批量预取。

输出的是实测毫秒数与字节数，不是"应该能行"。
"""
import asyncio
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

from app.services.tts import service as svc  # noqa: E402
from app.services.tts.base import SynthRequest  # noqa: E402

LINES = [
    ("male",   "云健·男·激情", "放开那个女孩！否则今日这断魂崖，便是你的葬身之地！"),
    ("female", "晓晓·女·温柔", "你这人倒是奇怪，明明受了伤，还笑得出来呢。"),
    ("male",   "云希·男·活泼", "哈哈，原来传闻中的暗影堂主，也不过如此嘛！"),
    ("female", "晓伊·女·活泼", "小心前面！那雾里有东西在动，我感觉到杀气了。"),
]


def ms(t0: float) -> int:
    return int((time.time() - t0) * 1000)


def main() -> int:
    print("=" * 72)
    print("ffmpeg:", svc.ffmpeg_available())
    for e in svc.list_engines():
        print(f"  引擎 {e['id']:18s} available={e['available']}  {e['name']}")

    print("\n--- 1. Edge TTS 按性别自适应挑音色（首次合成，均冷缓存）---")
    for gender, label, text in LINES:
        t0 = time.time()
        req = SynthRequest(text=text, out_format="mp3")
        r = svc.synth_sync(req, engine_id="edge", gender=gender)
        if r.url:
            print(f"  [{gender:6s}] {label:12s} {ms(t0):5d}ms  {r.bytes/1024:6.1f}KB  "
                  f"时长{r.duration_ms:5d}ms  音色={r.voice_id}  cached={r.cached}  {r.url[:28]}")
        else:
            print(f"  [{gender:6s}] {label:12s} FAIL {r.error}")

    print("\n--- 2. 缓存命中（同样四句再来一遍，应当是 0ms 级别）---")
    tot = 0
    for gender, label, text in LINES:
        t0 = time.time()
        req = SynthRequest(text=text, out_format="mp3")
        r = svc.synth_sync(req, engine_id="edge", gender=gender)
        spent = ms(t0)
        tot += spent
        print(f"  [{gender:6s}] {label:12s} {spent:5d}ms  cached={r.cached}  "
              f"engine={r.engine}  dur={r.duration_ms}ms")
    print(f"  二次访问合计 {tot}ms（首轮是数千毫秒量级）")

    print("\n--- 3. 本机离线兜底（OneCore 产 WAV -> 转 MP3）---")
    for gender, label, text in LINES[:2]:
        t0 = time.time()
        req = SynthRequest(text=text, out_format="mp3")
        r = svc.synth_sync(req, engine_id="onecore", gender=gender,
                           allow_degrade=False)
        if r.url:
            print(f"  [{gender:6s}] {label:12s} {ms(t0):5d}ms  {r.bytes/1024:6.1f}KB  "
                  f"音色={r.voice_id}  {r.url[:30]}")
        else:
            print(f"  [{gender:6s}] {label:12s} FAIL {r.error}")

    print("\n--- 4. 降级链：请求一个不存在的引擎，应自动落到可用引擎 ---")
    req = SynthRequest(text="这是降级测试，应当仍然有声音出来。", out_format="mp3")
    r = svc.synth_sync(req, engine_id="bogus_engine", gender="female")
    print(f"  -> engine={r.engine}  degraded={r.degraded}  url={bool(r.url)}  err={r.error[:60]!r}")

    print("\n--- 5. 批量预合成（模拟进入剧情节点时一次性把 8 句排队合成）---")
    items = []
    for i in range(8):
        gender = "male" if i % 2 else "female"
        items.append({
            "key": f"line-{i}",
            "text": f"这是批量预合成测试的第 {i + 1} 句台词，用于测量并发流水线的吞吐。",
            "gender": gender,
            "engine_id": "edge",
        })
    t0 = time.time()
    out = asyncio.run(svc.synth_batch(items))
    spent = ms(t0)
    ok = [c for c in out if c.get("url")]
    cached_cnt = sum(1 for c in out if c.get("cached"))
    print(f"  8 句并发共 {spent}ms  成功 {len(ok)}/8  命中缓存 {cached_cnt}  "
          f"平均 {spent // 8}ms/句")
    total_kb = sum(c.get("bytes", 0) for c in out) / 1024
    print(f"  音频总体积 {total_kb:.1f}KB")

    print("\n--- 6. 性能对照：单句串行 vs 并发 ---")
    serial = []
    for i in range(4):
        t0 = time.time()
        svc.synth_sync(SynthRequest(text=f"串行对照测试句子{i}，每隔一句话就重新算一次。",
                                    out_format="mp3"),
                       engine_id="edge", gender="female")
        serial.append(ms(t0))
    print(f"  串行 4 句：{[s for s in serial]}ms  合计 {sum(serial)}ms")

    print("\n--- 7. 缓存统计 ---")
    info = svc.cache_info()
    for k, v in info.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
