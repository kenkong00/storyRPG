"""战斗界面 v2 浏览器实机验证（playwright）。

真实打开页面 → 注册临时账号 → 建人物 → 唤起战斗层 → 操作指令 → 截图。
用于检查布局、可点击性、控制台报错等只有浏览器才能发现的问题。

用法：
  cd backend && ../.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
  .venv/Scripts/python.exe test_combat_ui_browser.py [http://127.0.0.1:8000]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_screenshots")

PASS = 0
FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [OK] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {str(extra)[:260]}")


def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    errors = []
    shots = []

    def shot(page, name):
        path = os.path.join(SHOT_DIR, name)
        page.screenshot(path=path)
        shots.append(path)
        return path

    # 优先用本机已安装的 Edge / Chrome，免去下载 playwright 自带浏览器
    launch_kwargs = {}
    for cand in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                 r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
        if os.path.exists(cand):
            launch_kwargs["executable_path"] = cand
            print(f"使用浏览器：{cand}")
            break

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        page = browser.new_page(viewport={"width": 1512, "height": 945})
        page.on("console", lambda m: errors.append(f"console[{m.type}] {m.text}")
                if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror {e}"))
        page.on("response", lambda r: errors.append(f"http404 {r.url}")
                if r.status >= 400 else None)

        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        check("页面打开", bool(page.title()), page.title())

        print("\n【1】准备临时账号与人物")
        uc = page.evaluate("""async () => {
            const post = (url, body, tok) => fetch(url, {
                method: 'POST',
                headers: Object.assign({'Content-Type': 'application/json'},
                                        tok ? {'X-User-Token': tok} : {}),
                body: JSON.stringify(body || {}),
            }).then(r => r.json());
            const uname = 'uib_' + Math.floor(Math.random() * 1e7);
            await post('/api/users/register', {username: uname, password: 'test1234', nickname: '战斗UI测试'});
            const login = await post('/api/users/login', {username: uname, password: 'test1234'});
            Auth.setSession(login.token, login.user);
            await post('/api/users/me/library/1', {}, login.token);
            return await post('/api/users/me/characters',
                {game_id: 1, base_character_id: 1, custom_name: '战斗UI测试'}, login.token);
        }""")
        check("注册 / 登录 / 建人物", bool(uc and uc.get("id")), uc)

        print("\n【2】注入玩家数据并唤起战斗层")
        page.evaluate("""(uc) => {
            App._currentUC = uc;
            GameState.userCharacter = uc;
            const base = uc.base_character || {};
            GameState.player = Object.assign({}, GameState.player || {}, {
                id: uc.id, uc_id: uc.id, base_id: uc.base_character_id,
                name: uc.custom_name || base.name || '玩家',
                level: uc.level, realm_level: uc.realm_level, exp: uc.exp,
                hp: uc.hp, max_hp: uc.max_hp, mp: uc.mp, max_mp: uc.max_mp,
                attack: uc.attack, defense: uc.defense, speed: uc.speed, luck: uc.luck,
                portrait_image: base.portrait_image || '',
            });
            GameState.updatePlayerUI();
            // 正常流程里这段由 Platform._enterGame 完成
            const gc = document.querySelector('#game-container');
            if (gc) gc.style.display = 'block';
            const pf = document.querySelector('#platform-layer');
            if (pf) pf.classList.add('hidden');
            document.querySelector('#ui-layer').classList.add('hidden');
        }""", uc)

        # 走真实入口：App.handleBattleNode(战斗节点) —— 覆盖节点解析 / 战后抉择链路
        entered = page.evaluate("""async () => {
            const nodes = await fetch('/api/story/nodes?node_type=battle').then(r => r.json());
            const node = (nodes || [])[0];
            if (!node) return null;
            await App.handleBattleNode(node);
            return {id: node.id, title: node.title};
        }""")
        if not entered:
            # 兜底：数据库里没有战斗节点时，直接指定敌人开打
            enemy_ids = page.evaluate("""async () => {
                const chars = await fetch('/api/characters').then(r => r.json());
                return (chars || []).filter(c => ['enemy', 'npc'].includes(c.character_type))
                    .slice(0, 2).map(c => c.id);
            }""")
            page.evaluate("""(ids) => CombatUI.start({
                enemies: ids.map(id => ({character_id: id, level_mode: 'match'})),
                postChoices: [],
            })""", enemy_ids)
        page.wait_for_timeout(600)
        check("从剧情战斗节点进入战斗", bool(entered), entered)
        enemy_ids = page.evaluate(
            "() => CombatUI.state.units.filter(u => u.side === 'enemy').map(u => u.uid)")

        layer = page.locator("#battle-layer")
        check("战斗层可见", layer.is_visible())
        shot(page, "battle_01_enter.png")

        print("\n【3】布局检查")
        n_enemy = page.locator("#battle-enemies .unit-card.enemy").count()
        n_party = page.locator("#battle-party .unit-card.party").count()
        check("敌人卡片数量正确", n_enemy == len(enemy_ids), f"{n_enemy} vs {len(enemy_ids)}")
        check("我方卡片已渲染", n_party >= 1, n_party)
        check("指令区可见", page.locator("#battle-command").is_visible())
        check("行动顺序栏可见", page.locator("#turn-order").is_visible())
        check("回合数已显示", "回合" in page.locator("#battle-round").inner_text(),
              page.locator("#battle-round").inner_text())
        check("战斗日志有内容", page.locator("#battle-log .log-line").count() > 0,
              page.locator("#battle-log .log-line").count())

        overflow = page.evaluate("""() => {
            const bad = [];
            const vw = window.innerWidth, vh = window.innerHeight;
            ['#battle-command', '#battle-party', '#turn-order', '#battle-tools'].forEach(sel => {
                const el = document.querySelector(sel);
                if (!el) { bad.push(sel + ':missing'); return; }
                const r = el.getBoundingClientRect();
                if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
                    bad.push(`${sel} 越界 ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
                }
                if (r.width < 2 || r.height < 2) bad.push(sel + ' 尺寸异常');
            });
            return bad;
        }""")
        check("关键区块未溢出视口", not overflow, overflow)

        enemy_box = page.evaluate("""() => {
            const el = document.querySelector('#battle-enemies .unit-card.enemy');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top)};
        }""")
        check("敌人卡片有实际尺寸", bool(enemy_box and enemy_box["w"] > 40 and enemy_box["h"] > 40),
              enemy_box)

        command_overlap = page.evaluate("""() => {
            const a = document.querySelector('#battle-command').getBoundingClientRect();
            const b = document.querySelector('#battle-party').getBoundingClientRect();
            const overlap = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
            return overlap;
        }""")
        check("指令区与队伍卡片不重叠", not command_overlap)

        print("\n【4】指令交互")
        waiting = page.evaluate("() => CombatUI.awaitUid")
        check("正在等待玩家指令", bool(waiting), waiting)

        page.click('#cmd-main .cmd-btn[data-cmd="skill"]')
        page.wait_for_timeout(320)
        sub_visible = page.locator("#cmd-sub").is_visible()
        n_sub = page.locator("#cmd-sub .sub-btn.skill").count()
        check("技能面板弹出", sub_visible, sub_visible)
        check("技能按钮已生成", n_sub > 0, n_sub)
        shot(page, "battle_02_skills.png")

        page.click("#cmd-sub .sub-btn.back")
        page.wait_for_timeout(240)

        page.click('#cmd-main .cmd-btn[data-cmd="attack"]')
        page.wait_for_timeout(320)
        n_targets = page.locator("#battle-enemies .unit-card.targetable").count()
        if n_targets:
            check("进入目标选择模式", n_targets > 0, n_targets)
            shot(page, "battle_03_targets.png")
            page.locator("#battle-enemies .unit-card.targetable").first.click()
        else:
            check("目标唯一，直接出手", True)
        page.wait_for_timeout(1600)
        shot(page, "battle_04_after_action.png")

        print("\n【5】自动战斗跑到结算")
        page.evaluate("() => CombatUI.setAuto(true)")
        # 注意：服务端状态会先于演出结束（state 在播放前就已更新），
        # 所以要等"演出播完 + 结算面板弹出"才算真正完成。
        for _ in range(80):
            page.wait_for_timeout(400)
            done = page.evaluate("""() => {
                const box = document.querySelector('#battle-result');
                return !CombatUI.busy
                    && !document.querySelector('#battle-layer').classList.contains('hidden')
                    && !box.classList.contains('hidden');
            }""")
            if done:
                break
        page.wait_for_timeout(400)

        diag = page.evaluate("""() => {
            const box = document.querySelector('#battle-result');
            return {
                status: CombatUI.state && CombatUI.state.status,
                auto: CombatUI.auto,
                busy: CombatUI.busy,
                rewardsReady: CombatUI.rewards !== null,
                settleCalls: (CombatUI.rewards && Object.keys(CombatUI.rewards).length) || 0,
                boxClass: box.className,
                boxDisplay: getComputedStyle(box).display,
                boxHtmlLen: box.innerHTML.length,
                layerOpacity: getComputedStyle(document.querySelector('#battle-layer')).opacity,
            };
        }""")
        print("  诊断：" + json.dumps(diag, ensure_ascii=False))

        status = diag.get("status")
        check("战斗已结束", status in ("player_won", "enemy_won", "fled"), status)
        result_visible = page.locator("#battle-result").is_visible()
        check("结算面板显示", result_visible, diag)
        if result_visible:
            txt = page.locator("#battle-result").inner_text()
            check("结算含标题", ("胜利" in txt or "失败" in txt or "脱离" in txt), txt[:60])
            shot(page, "battle_05_result.png")
            # 不管胜负，都点"继续/放弃"那个按钮（"再战一次"会重开一局）
            page.locator('#battle-result .br-btn[data-act="continue"]').click()
            page.wait_for_timeout(1200)
            check("结算后可退出战斗层", not page.locator("#battle-layer").is_visible())

        shot(page, "battle_06_back_to_story.png")

        # ===== 【6】多敌人目标选择（本地开一场双敌战斗，不依赖剧情节点配置）=====
        # 剧情节点目前只配了 1 个敌人，此时 UI 会自动锁定目标、不进目标选择模式；
        # 想覆盖「敌方 > 1」这条分支，就自己指定两个敌人开一场。
        print("\n【6】多敌人目标选择（黄蓉 + 丽莎）")
        old_bid = page.evaluate("() => CombatUI.battleId")
        page.evaluate("""() => CombatUI.start({
            storyNodeId: null,
            node: null,
            postChoices: [],
            enemies: [{character_id: 2}, {character_id: 4}],
            config: {difficulty: 0.3},
        })""")
        ready = False
        for _ in range(40):
            page.wait_for_timeout(400)
            ready = page.evaluate(
                "(ob) => !CombatUI.busy && !!CombatUI.awaitUid && CombatUI.battleId !== ob", old_bid)
            if ready:
                break
        check("双敌战斗进入等待输入", ready)
        if ready:
            n_e2 = page.locator("#battle-enemies .unit-card.enemy").count()
            check("双敌卡片已渲染", n_e2 == 2, n_e2)

            page.click('#cmd-main .cmd-btn[data-cmd="attack"]')
            page.wait_for_timeout(360)
            n_t = page.locator("#battle-enemies .unit-card.targetable").count()
            check("多敌时进入目标选择模式", n_t == 2, n_t)
            hint = page.evaluate("() => (document.querySelector('#battle-hint') || {}).textContent || ''")
            check("目标选择提示已显示", "选择目标" in hint, hint)
            shot(page, "battle_03_targets.png")

            page.locator("#battle-enemies .unit-card.targetable").last.click()
            page.wait_for_timeout(1500)
            check("点选目标后已出手", page.evaluate("() => CombatUI.pool.length === 0"),
                  page.evaluate("() => CombatUI.pool.length"))

            # 收尾：自动打完并退出，别留下进行中的战斗
            page.evaluate("() => CombatUI.setAuto(true)")
            for _ in range(80):
                page.wait_for_timeout(400)
                if page.evaluate("""() => !CombatUI.busy
                    && !document.querySelector('#battle-result').classList.contains('hidden')"""):
                    break
            if page.locator("#battle-result").is_visible():
                page.locator('#battle-result .br-btn[data-act="continue"]').click()
                page.wait_for_timeout(1000)
            check("双敌战斗已收尾退出", not page.locator("#battle-layer").is_visible())

        # ===== 【7】卡牌式版面尺寸 + 立绘随掉血切换 =====
        print("\n【7】卡牌式版面与立绘检查")
        old_bid = page.evaluate("() => CombatUI.battleId")
        page.evaluate("""() => CombatUI.start({
            storyNodeId: null,
            node: null,
            postChoices: [],
            enemies: [{character_id: 2}],
            config: {difficulty: 0.3},
        })""")
        ready = False
        for _ in range(40):
            page.wait_for_timeout(400)
            ready = page.evaluate(
                "(ob) => !CombatUI.busy && !!CombatUI.awaitUid && CombatUI.battleId !== ob", old_bid)
            if ready:
                break
        check("卡牌版面战斗就绪", ready)
        if ready:
            page.wait_for_timeout(600)

            metrics = page.evaluate("""() => {
                const q = (s) => document.querySelector(s);
                const cs = (s, p) => getComputedStyle(q(s))[p];
                const log = q('#battle-log');
                return {
                    logFont: parseFloat(cs('#battle-log', 'fontSize')),
                    logLine: parseFloat(cs('#battle-log', 'lineHeight')),
                    logH: q('#battle-log-panel').getBoundingClientRect().height,
                    logTop: q('#battle-log-panel').getBoundingClientRect().top,
                    orderW: q('#turn-order').getBoundingClientRect().width,
                    orderBottom: q('#turn-order').getBoundingClientRect().bottom,
                    partyBottom: q('#battle-party').getBoundingClientRect().bottom,
                    vh: window.innerHeight,
                    enemyImgs: document.querySelectorAll('#battle-enemies .unit-card .uc-portrait img').length,
                    partyImgs: document.querySelectorAll('#battle-party .unit-card .uc-portrait img').length,
                    partyImgLoaded: [...document.querySelectorAll('#battle-party .uc-portrait img')]
                        .map(i => i.complete && i.naturalWidth > 0),
                    enemyImgLoaded: [...document.querySelectorAll('#battle-enemies .uc-portrait img')]
                        .map(i => i.complete && i.naturalWidth > 0),
                    frames: document.querySelectorAll('.unit-card .uc-frame').length,
                    idxCount: document.querySelectorAll('#turn-order .to-idx').length,
                    idxText: (document.querySelector('#turn-order .to-item .to-idx') || {}).textContent || '',
                    markText: (document.querySelector('#turn-order .to-item .to-mark') || {}).textContent || '',
                    itemCount: document.querySelectorAll('#turn-order .to-item').length,
                    party: (() => {
                        const c = document.querySelector('#battle-party .unit-card');
                        if (!c) return null;
                        const r = c.getBoundingClientRect();
                        return {w: Math.round(r.width), h: Math.round(r.height)};
                    })(),
                    partyLayout: (() => {
                        const p = document.querySelector('#battle-party .uc-portrait');
                        const pl = document.querySelector('#battle-party .uc-plate');
                        if (!p || !pl) return null;
                        const a = p.getBoundingClientRect();
                        const b = pl.getBoundingClientRect();
                        return {pw: Math.round(a.width), ph: Math.round(a.height),
                                pr: Math.round(a.right), pl: Math.round(b.left)};
                    })(),
                };
            }""")
            check("日志字号已放大（≥14px）", metrics["logFont"] >= 14, metrics["logFont"])
            check("日志行高宽松（≥1.6）", metrics["logLine"] / metrics["logFont"] >= 1.6,
                  round(metrics["logLine"] / metrics["logFont"], 2))
            check("日志区域已加高（≥340px）", metrics["logH"] >= 340, round(metrics["logH"]))
            check("行动顺序栏已加宽（≥100px）", metrics["orderW"] >= 100, metrics["orderW"])
            check("行动顺序栏未超出视口", metrics["orderBottom"] < metrics["vh"],
                  (round(metrics["orderBottom"]), metrics["vh"]))
            check("行动顺序带序号徽章", metrics["idxCount"] >= 2, metrics["idxCount"])
            check("首位序号是 1", metrics["idxText"].strip() == "1", metrics["idxText"])
            check("首位标注「当前」", "当前" in metrics["markText"], metrics["markText"])
            check("我方卡牌带立绘", metrics["partyImgs"] >= 1, metrics["partyImgs"])
            check("敌方卡牌带立绘", metrics["enemyImgs"] >= 1, metrics["enemyImgs"])
            check("卡牌外框已渲染", metrics["frames"] >= 2, metrics["frames"])
            check("我方手牌是横版卡（宽 > 高）",
                  bool(metrics["party"]) and metrics["party"]["w"] > metrics["party"]["h"],
                  metrics["party"])
            check("手牌立绘在名牌左侧",
                  bool(metrics["partyLayout"]) and metrics["partyLayout"]["pr"] <= metrics["partyLayout"]["pl"] + 2,
                  metrics["partyLayout"])
            check("手牌立绘窗接近方形",
                  bool(metrics["partyLayout"])
                  and abs(metrics["partyLayout"]["pw"] - metrics["partyLayout"]["ph"]) <= 6,
                  metrics["partyLayout"])
            print(f"  我方立绘加载：{metrics['partyImgLoaded']}；敌方立绘加载：{metrics['enemyImgLoaded']}")
            check("我方立绘实际加载成功", any(metrics["partyImgLoaded"]), metrics["partyImgLoaded"])
            check("敌方立绘实际加载成功", any(metrics["enemyImgLoaded"]), metrics["enemyImgLoaded"])

            # 掉血换立绘：把显示血量压到 15%，立绘应当换成残血表情
            swap = page.evaluate("""() => {
                const u = CombatUI.state.units.find(x => x.side === 'player');
                const el = CombatUI.els[u.uid].portraitImg;
                const before = el.getAttribute('src');
                const maxHp = CombatUI._unit(u.uid).eff.max_hp;
                CombatUI.view[u.uid].hp = maxHp * 0.15;
                CombatUI._syncBars(u.uid);
                return {before, after: el.getAttribute('src'), tiers: (u.art && u.art.hurt || []).length};
            }""")
            check("玩家单位有损血档位配置", swap["tiers"] >= 1, swap["tiers"])
            if swap["tiers"] >= 2:
                check("掉血后立绘已切换", swap["before"] != swap["after"],
                      (swap["before"], swap["after"]))
            page.wait_for_timeout(500)
            shot(page, "battle_07_expression.png")

            # 复原并退出
            page.evaluate("() => CombatUI._syncAll()")
            page.evaluate("() => CombatUI.state.status = 'fled'")
            page.evaluate("() => CombatUI._finish()")
            page.wait_for_timeout(900)
            if page.locator("#battle-result").is_visible():
                page.locator('#battle-result .br-btn[data-act="continue"]').click()
                page.wait_for_timeout(900)
            check("卡牌版面检查后已退出战斗", not page.locator("#battle-layer").is_visible())

        # 只关心脚本异常；静态资源 404（如缺立绘）不算本次战斗逻辑问题
        js_errors = [e for e in errors
                     if "pageerror" in e
                     or ("console[error]" in e and "Failed to load resource" not in e)]
        check("无 JS 异常", not js_errors, js_errors[:3])
        static404 = [e for e in errors if "http404" in e or "Failed to load resource" in e]
        if static404:
            print(f"  （提示：{len(static404)} 个静态资源 404，与战斗逻辑无关）")

        browser.close()

    print("\n截图：")
    for s in shots:
        print("  " + s)
    print(f"\n===== 浏览器验证：{PASS} 通过 / {FAIL} 失败 =====")
    if errors:
        print("控制台输出：")
        for e in errors[:10]:
            print("  " + e)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
