"""后台管理：技能战斗效果 / 节点战斗配置 编辑器冒烟测试。

验证"策划不改代码就能配战斗"这条链路是否真的可用：
  技能管理 → 编辑 → effects 编辑器（模板 / 实时校验）
  剧情管理 → 章节 → 战斗节点 → 编辑 → battle_config 编辑器

用法：
  cd backend && ../.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
  .venv/Scripts/python.exe test_admin_battle_editor.py [http://127.0.0.1:8000]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_screenshots")

PASS = 0
FAIL = 0
SKIP = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {str(extra)[:240]}")


def skip(name, why=""):
    global SKIP
    SKIP += 1
    print(f"  [--] {name} 跳过 {why}")


def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    errors = []
    shots = []

    def shot(page, name):
        path = os.path.join(SHOT_DIR, name)
        page.screenshot(path=path)
        shots.append(path)

    launch_kwargs = {}
    for cand in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Google\Chrome\Application\chrome.exe"):
        if os.path.exists(cand):
            launch_kwargs["executable_path"] = cand
            break

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        page = browser.new_page(viewport={"width": 1512, "height": 945})
        page.on("pageerror", lambda e: errors.append(f"pageerror {e}"))
        page.on("console", lambda m: errors.append(f"console {m.text}") if m.type == "error" else None)

        page.goto(BASE + "/admin", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        check("后台页面打开", page.locator(".sidebar-nav").count() > 0)

        print("\n【1】技能管理 → 战斗效果编辑器")
        page.click('.nav-item[data-page="skills"]')
        page.wait_for_timeout(1500)
        n_edit = page.locator(".btn-edit").count()
        check("技能列表已渲染", n_edit > 0, n_edit)

        if n_edit:
            page.locator(".btn-edit").first.click()
            page.wait_for_timeout(900)
            has_fx = page.locator("#skill-effects").count() == 1
            check("弹窗含 effects 编辑器", has_fx)
            if has_fx:
                check("基础字段仍在", page.locator('.modal-body [name="mp_cost"]').count() == 1)
                check("绝招 / 怒气 / 冷却 字段齐全",
                      all(page.locator(f'.modal-body [name="{n}"]').count() == 1
                          for n in ("is_ultimate", "rage_cost", "cooldown", "hits", "auto_learn")))
                n_tpl = page.locator(".modal-body [data-tpl]").count()
                check("效果模板按钮", n_tpl >= 8, n_tpl)

                page.fill("#skill-effects", "")
                page.click('.modal-body [data-tpl="damage"]')
                page.wait_for_timeout(200)
                page.click('.modal-body [data-tpl="dot"]')
                page.wait_for_timeout(200)
                raw = page.input_value("#skill-effects")
                try:
                    arr = json.loads(raw)
                    check("模板生成合法 JSON 且可叠加",
                          isinstance(arr, list) and len(arr) == 2 and arr[0]["kind"] == "damage",
                          raw[:120])
                except Exception as e:  # noqa: BLE001
                    check("模板生成合法 JSON 且可叠加", False, f"{e} / {raw[:120]}")
                hint = page.locator("#skill-effects-hint").inner_text()
                check("实时校验给出通过提示", "\u2713" in hint, hint)

                page.fill("#skill-effects", '[{"kind":"damage",]')
                page.wait_for_timeout(250)
                hint2 = page.locator("#skill-effects-hint").inner_text()
                check("非法 JSON 有错误提示", "错误" in hint2, hint2)

                page.fill("#skill-effects", '[{"kind":"damage","power":150}]')
                page.wait_for_timeout(200)
                shot(page, "admin_01_skill_effects.png")
            page.evaluate("() => Admin.closeModal()")
            page.wait_for_timeout(400)

        print("\n【2】剧情管理 → 战斗节点的 battle_config 编辑器")
        page.click('.nav-item[data-page="story"]')
        page.wait_for_timeout(1800)
        # 层级是 故事 → 章节 → 节点，先点进第一个故事
        n_arc = page.locator("[data-arc-id]").count()
        check("故事列表已渲染", n_arc > 0, n_arc)
        if n_arc:
            page.locator("[data-arc-id]").first.click()
            page.wait_for_timeout(1600)
        n_ch = page.locator("[data-chapter-id]").count()
        check("章节列表已渲染", n_ch > 0, n_ch)

        if n_ch:
            page.locator("[data-chapter-id]").first.click()
            page.wait_for_timeout(1800)
            has_tbody = page.locator("#node-tbody").count() == 1
            check("已进入节点列表", has_tbody)

            if has_tbody:
                rows = page.locator("#node-tbody tr")
                n_rows = rows.count()
                battle_row = None
                for i in range(n_rows):
                    txt = rows.nth(i).inner_text()
                    if "战斗" in txt:
                        battle_row = rows.nth(i)
                        break
                if battle_row is None:
                    skip("战斗节点编辑弹窗", "该章节没有战斗类型节点")
                else:
                    battle_row.locator('.btn-edit[data-action="edit"]').first.click()
                    page.wait_for_timeout(1200)
                    has_cfg = page.locator("#battle-config-input").count() == 1
                    check("节点弹窗含战斗配置编辑器", has_cfg)
                    if has_cfg:
                        n_btpl = page.locator(".modal-body [data-btpl]").count()
                        check("战斗配置模板按钮", n_btpl >= 3, n_btpl)
                        check("可从登场人物生成敌人",
                              page.locator("#btn-battle-from-npc").count() == 1)

                        # battle_config 在折叠区里，先展开
                        page.evaluate("""() => {
                            const d = document.getElementById('battle-config-sec');
                            if (d) d.open = true;
                        }""")
                        page.wait_for_timeout(300)
                        page.fill("#battle-config-input", "")
                        page.click('.modal-body [data-btpl="boss"]')
                        page.wait_for_timeout(250)
                        raw = page.input_value("#battle-config-input")
                        try:
                            cfg = json.loads(raw)
                            check("BOSS 模板是合法对象且含分阶段",
                                  isinstance(cfg, dict)
                                  and cfg["enemies"][0].get("is_boss")
                                  and cfg["enemies"][0].get("phases"),
                                  raw[:140])
                        except Exception as e:  # noqa: BLE001
                            check("BOSS 模板是合法对象且含分阶段", False, f"{e} / {raw[:140]}")
                        hint = page.locator("#battle-config-hint").inner_text()
                        check("战斗配置校验提示", "\u2713" in hint, hint)

                        page.fill("#battle-config-input", '{"enemies": }')
                        page.wait_for_timeout(250)
                        check("战斗配置非法 JSON 有提示",
                              "错误" in page.locator("#battle-config-hint").inner_text())
                        shot(page, "admin_02_battle_config.png")
                    page.evaluate("() => Admin.closeModal()")
                    page.wait_for_timeout(400)

        js_errors = [e for e in errors if "Failed to load resource" not in e]
        check("无 JS 异常", not js_errors, js_errors[:3])

        browser.close()

    print("\n截图：")
    for s in shots:
        print("  " + s)
    print(f"\n===== 后台战斗编辑器：{PASS} 通过 / {FAIL} 失败 / {SKIP} 跳过 =====")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
