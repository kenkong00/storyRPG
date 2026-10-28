import os, time, sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "test_screenshots")
os.makedirs(OUT, exist_ok=True)

USER, PASS = "kong", "123456"

def log(*a):
    print("[TEST]", *a, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path=r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium_headless_shell-1208\chrome-headless-shell-win64\chrome-headless-shell.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: log("console:", m.type, m.text[:180]))
    page.on("pageerror", lambda e: log("pageerror:", str(e)[:200]))

    # ============ FRONTEND CHARACTER PANEL ============
    log("goto frontend /")
    page.goto(BASE + "/", wait_until="networkidle")

    page.wait_for_selector("#btn-go-login", timeout=15000)
    page.click("#btn-go-login")
    page.wait_for_selector("#auth-username", timeout=5000)
    # ensure login tab active
    try:
        page.click('.auth-tab[data-mode="login"]', timeout=2000)
    except Exception:
        pass
    page.fill("#auth-username", USER)
    page.fill("#auth-password", PASS)
    page.click("#auth-submit")

    page.wait_for_function("typeof Auth!=='undefined' && Auth.isLoggedIn()", timeout=15000)
    log("frontend logged in as", USER)

    page.evaluate("""async () => {
        document.querySelector('#platform-layer')?.classList.add('hidden');
        const gc = document.querySelector('#game-container'); if (gc) gc.style.display = '';
        const uc = await API.games.myCharacterFull(3);
        window.__uc = uc;
        try { await App.enterGame(uc); } catch (e) { console.warn('enterGame warn', e && e.message); }
        if (typeof CharacterPanel !== 'undefined') CharacterPanel.show();
    }""")

    page.wait_for_selector(".cp2-root", timeout=15000)
    page.wait_for_function(
        "document.querySelectorAll('.cp2-inv-cell').length>0 && document.querySelectorAll('.cp2-slot').length>0",
        timeout=15000,
    )
    time.sleep(0.8)
    page.locator("#panel-overlay").screenshot(path=os.path.join(OUT, "frontend_panel.png"))
    log("saved frontend_panel.png")

    # simulate drag to capture contact highlight (drop-candidate + dragover + ghost)
    res = page.evaluate("""() => {
        const cell = document.querySelector('.cp2-inv-cell');
        if (!cell) return 'no-cell';
        const dt = new DataTransfer();
        cell.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:dt}));
        const cand = document.querySelector('.cp2-slot.drop-candidate');
        let target = cand;
        if (!target) target = document.querySelector('.cp2-slot[data-drop]');
        if (target) target.dispatchEvent(new DragEvent('dragover', {bubbles:true, dataTransfer:dt, clientX:360, clientY:360}));
        if (window.CharacterPanel && CharacterPanel._moveDragGhost) CharacterPanel._moveDragGhost(420, 380);
        const hasCand = document.querySelectorAll('.cp2-slot.drop-candidate').length;
        const hasOver = document.querySelectorAll('.cp2-slot.dragover').length;
        return {cand:hasCand, over:hasOver};
    }""")
    log("drag sim result:", res)
    time.sleep(0.4)
    page.locator("#panel-overlay").screenshot(path=os.path.join(OUT, "frontend_drag.png"))
    log("saved frontend_drag.png")

    # cleanup drag state
    page.evaluate("""() => {
        if (window.CharacterPanel && CharacterPanel._endDragFeedback) CharacterPanel._endDragFeedback();
        const ov = document.querySelector('#panel-overlay'); if (ov) ov.classList.add('hidden');
    }""")

    # ============ ADMIN EQUIPMENT FORM ============
    log("goto admin")
    page.goto(BASE + "/admin/index.html", wait_until="networkidle")
    page.wait_for_selector('.nav-item[data-page="equipments"]', timeout=15000)
    page.wait_for_timeout(800)  # let Admin.init() finish default navigate
    page.click('.nav-item[data-page="equipments"]')
    page.wait_for_selector("#btn-add", timeout=15000)  # appears only after list renders
    time.sleep(0.4)
    page.locator("#content-area").screenshot(path=os.path.join(OUT, "admin_equipments_list.png"))
    log("saved admin_equipments_list.png")

    page.click("#btn-add")
    page.wait_for_selector('.modal', timeout=10000)
    # wait for the type select + stat inputs
    page.wait_for_function(
        "document.querySelector('select[name=\"equipment_type\"]') && document.querySelectorAll('input[id^=\"stat-\"]').length>=9",
        timeout=10000,
    )
    time.sleep(0.5)
    # count the type options to assert 9 classes
    type_count = page.evaluate("document.querySelectorAll('select[name=\"equipment_type\"] option').length")
    stat_count = page.evaluate("document.querySelectorAll('input[id^=\"stat-\"]').length")
    log("equipment_type options:", type_count, "| stat inputs:", stat_count)
    page.screenshot(path=os.path.join(OUT, "admin_equipments_form.png"), full_page=True)
    log("saved admin_equipments_form.png")

    browser.close()
log("DONE")
