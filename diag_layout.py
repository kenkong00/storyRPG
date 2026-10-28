"""一次性诊断：量一遍战斗层各区块的实际位置，看看有没有越界 / 被裁掉。"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = __import__("os").environ.get("RPG_BASE", "http://127.0.0.1:8000")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

JS = """() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null;
    const b = e.getBoundingClientRect();
    return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
            right: Math.round(b.right), bottom: Math.round(b.bottom)}; };
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    body: r('body'), game: r('#game-container'), layer: r('#battle-layer'),
    top: r('#battle-top'), enemies: r('#battle-enemies'), party: r('#battle-party'),
    logPanel: r('#battle-log-panel'), log: r('#battle-log'),
    order: r('#turn-order'), cmd: r('#battle-command'), cmdb: r('#cmd-main'),
    card0: r('#battle-party .unit-card'), enemy0: r('#battle-enemies .unit-card'),
    nOrder: document.querySelectorAll('#turn-order-list .to-item').length,
    toItem: r('#turn-order-list .to-item'),
    scrollY: window.scrollY, docH: document.documentElement.scrollHeight,
  };
}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=EDGE)
        page = browser.new_page(viewport={"width": 1512, "height": 945})
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        uc = page.evaluate("""async () => {
            const post = (url, body, tok) => fetch(url, {method: 'POST',
                headers: Object.assign({'Content-Type': 'application/json'}, tok ? {'X-User-Token': tok} : {}),
                body: JSON.stringify(body || {})}).then(r => r.json());
            const uname = 'diag_' + Math.floor(Math.random() * 1e7);
            await post('/api/users/register', {username: uname, password: 'test1234', nickname: '诊断'});
            const login = await post('/api/users/login', {username: uname, password: 'test1234'});
            Auth.setSession(login.token, login.user);
            await post('/api/users/me/library/1', {}, login.token);
            const c = await post('/api/users/me/characters',
                {game_id: 1, base_character_id: 1, custom_name: '诊断角色'}, login.token);
            App._currentUC = c; GameState.userCharacter = c;
            const base = c.base_character || {};
            GameState.player = Object.assign({}, GameState.player || {}, {
                id: c.id, uc_id: c.id, base_id: c.base_character_id, name: c.custom_name,
                level: c.level, realm_level: c.realm_level, exp: c.exp,
                hp: c.hp, max_hp: c.max_hp, mp: c.mp, max_mp: c.max_mp,
                attack: c.attack, defense: c.defense, speed: c.speed, luck: c.luck,
                portrait_image: base.portrait_image || ''});
            document.querySelector('#game-container').style.display = 'block';
            document.querySelector('#platform-layer').classList.add('hidden');
            document.querySelector('#ui-layer').classList.add('hidden');
            return c;
        }""")
        page.evaluate("""async (uc) => {
            const nodes = await fetch('/api/story/nodes?node_type=battle').then(r => r.json());
            if (nodes && nodes[0]) await App.handleBattleNode(nodes[0]);
            else await CombatUI.start({storyNodeId: null, postChoices: [],
                enemies: [{character_id: 2}], config: {difficulty: 0.3}});
        }""", uc)
        page.wait_for_timeout(2500)
        info = page.evaluate(JS)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        page.screenshot(path="test_screenshots/diag_layout.png")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
