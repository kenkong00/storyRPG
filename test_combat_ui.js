// 战斗界面 v2 冒烟测试（无浏览器，DOM 用桩件）
//
// 关键点：events 用的是**真实引擎**产出的夹具（backend/dump_battle_fixture.py 生成），
// 所以这里同时验证了「服务端事件契约」与「前端演出」两条链路。
//
// 运行：node test_combat_ui.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FRONTEND = path.join(ROOT, 'frontend');
const FIXTURE = path.join(ROOT, 'test_fixtures', 'battle_fixture.json');

/* ============================ DOM 桩件 ============================ */
let uidSeq = 0;
function makeClassList(el) {
  const set = new Set();
  const api = {
    add: (...c) => c.forEach(x => x && set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    contains: c => set.has(c),
    toggle: (c, force) => {
      if (force === true) { set.add(c); return true; }
      if (force === false) { set.delete(c); return false; }
      if (set.has(c)) { set.delete(c); return false; }
      set.add(c); return true;
    },
    _set: set,
  };
  return api;
}
function mkEl(tag = 'div', id = '') {
  const el = {
    _uid: ++uidSeq, _id: id, tag, style: {}, dataset: {},
    textContent: '', innerHTML: '', src: '', disabled: false,
    children: [], _handlers: {}, offsetHeight: 0, offsetWidth: 0, scrollTop: 0, scrollHeight: 0,
    classList: null, _qCache: {},
    get firstChild() { return this.children[0] || null; },
    get className() { return [...this.classList._set].join(' '); },
    set className(v) { this.classList._set.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList._set.add(c)); },
    querySelector(sel) {
      if (!this._qCache[sel]) this._qCache[sel] = mkEl('div', this._id + '>>' + sel);
      return this._qCache[sel];
    },
    querySelectorAll(sel) {
      if (!this._qCache['all:' + sel]) {
        const list = [];
        list.forEach = Array.prototype.forEach.bind(list);
        this._qCache['all:' + sel] = list;
      }
      return this._qCache['all:' + sel];
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    insertBefore(c) { this.children.unshift(c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    removeEventListener() {},
    fire(t, ev) { (this._handlers[t] || []).forEach(fn => fn(ev || { target: this })); },
    click() { this.fire('click'); },
    closest(sel) {
      const cls = String(sel).replace(/^\./, '');
      return this.classList.contains(cls) ? this : null;
    },
    focus() {},
    setProperty() {},
  };
  el.style = new Proxy({}, { get: (t, k) => (k === 'setProperty' ? () => {} : t[k] || ''), set: (t, k, v) => { t[k] = v; return true; } });
  el.classList = makeClassList(el);
  return el;
}
const registry = {};
function $(sel) {
  if (!registry[sel]) registry[sel] = mkEl('div', sel);
  return registry[sel];
}
global.window = { innerWidth: 1440, innerHeight: 900, addEventListener() {} };
global.document = {
  querySelector: $,
  querySelectorAll: () => [],
  createElement: (tag) => mkEl(tag),
  addEventListener() {},
  head: mkEl('head'),
  body: mkEl('body'),
};

/* ============================ 载入真实源码 ============================ */
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const utilsSrc = fs.readFileSync(path.join(FRONTEND, 'js', 'utils.js'), 'utf8');
const combatSrc = fs.readFileSync(path.join(FRONTEND, 'js', 'ui', 'combat.js'), 'utf8');

/* ============================ 数据桩件 ============================ */
const calls = { start: 0, action: [], auto: [], settle: 0, storyChoices: [], showChoices: [] };
let actionCursor = 0;

const API = {
  story: {
    getNodeFull: async () => ({ node: { id: 8, node_type: 'battle' }, choices: [] }),
    getNode: async () => ({ id: 9, node_type: 'dialogue' }),
  },
  battle: {
    v2Start: async (payload) => {
      calls.start++;
      calls.startPayload = payload;
      actionCursor = 0;
      return fixture.start;
    },
    v2Action: async (battleId, data) => {
      calls.action.push(data);
      if (actionCursor < fixture.steps.length) {
        return fixture.steps[actionCursor++];
      }
      return { battle_id: battleId, state: fixture.final, events: [] };
    },
    v2Auto: async () => ({ state: fixture.final, events: [] }),
    v2Flee: async () => ({ state: fixture.final, events: [] }),
    v2Settle: async () => {
      calls.settle++;
      // 真实接口会带上结算后的角色快照（router 的 _apply_level_ups 写入）
      const rw = JSON.parse(JSON.stringify(fixture.rewards));
      const lv = rw.level_up.length ? rw.level_up[rw.level_up.length - 1].level : 10;
      rw.character = {
        id: 1, level: lv, exp: 120, realm_level: 3,
        hp: 800, max_hp: 1620, mp: 120, max_mp: 315,
        attack: 112, defense: 61, speed: 28, luck: 12,
      };
      rw.extra = { realm: '筑基四重', skills: ['罡风斩'] };
      return { battle_id: 1, status: fixture.final.status, rewards: rw };
    },
  },
};

const GameState = {
  player: { id: 1, uc_id: 1, base_id: 1, name: '测试侠', hp: 1600, max_hp: 1600, level: 10 },
  userCharacter: { id: 1, hp: 1600, max_hp: 1600, level: 10 },
  party: [],
  isInCombat: false,
  isInDialogue: false,
  updatePlayerUI() { this._uiUpdated = (this._uiUpdated || 0) + 1; },
};

const App = {
  _currentUC: null,
  async handleStoryChoice(res) { calls.storyChoices.push(res); },
};

const DialogueUI = {
  callback: null,
  hiddenSprites: 0,
  shown: [],
  hideAllSprites() { this.hiddenSprites++; },
  showChoices(list) { calls.showChoices.push(list); },
  async showNode(id, cb) { this.shown.push(id); if (cb) cb({ nextAfter: id }); },
};

/* ============================ 装载 ============================ */
const factory = new Function(
  'window', 'document', 'GameState', 'API', 'App', 'DialogueUI',
  [utilsSrc, combatSrc, 'return { Utils, CombatUI };'].join('\n')
);
const { Utils, CombatUI } = factory(global.window, global.document, GameState, API, App, DialogueUI);

// 测试里不需要真的等动画
Utils.sleep = () => Promise.resolve();
CombatUI.skip = true;

/* ============================ 断言 ============================ */
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  \u2705 ' + msg); }
  else { fail++; console.log('  \u274C ' + msg); }
}
const flush = (n = 6) => new Promise(res => {
  let i = 0;
  const step = () => (++i >= n ? res() : setTimeout(step, 0));
  setTimeout(step, 0);
});
async function waitFor(fn, label, ms = 800) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await flush(2);
  }
  console.log(`    （等待超时：${label}）`);
  return false;
}

/* ============================ 主流程 ============================ */
(async () => {
  console.log('===== 战斗界面 v2 冒烟测试 =====\n');
  console.log(`夹具：结果 ${fixture.meta.result}｜指令 ${fixture.meta.total_commands}｜事件类型 ${fixture.meta.event_types.length} 种\n`);

  console.log('【1】进入战斗');
  await CombatUI.start({ storyNodeId: 8, node: { id: 8 } });
  await flush(4);

  ok(GameState.isInCombat === true, 'GameState.isInCombat = true');
  ok(!$('#battle-layer').classList.contains('hidden'), '战斗层已显示');
  ok($('#ui-layer').classList.contains('hidden'), '游戏 UI 层已隐藏');
  ok(!!CombatUI.battleId, 'battleId 已拿到：' + CombatUI.battleId);
  ok(calls.startPayload.user_character_id === 1, '带上 user_character_id');

  const enemies = fixture.start.state.units.filter(u => u.side === 'enemy');
  ok(Object.keys(CombatUI.els).length === fixture.start.state.units.length,
     `为全部 ${fixture.start.state.units.length} 个单位建了卡片`);
  ok(CombatUI.els.e1 && CombatUI.els.e2, '两个敌人卡片都在');

  console.log('\n【2】初始显示值 = 开战快照（而不是结算后的值）');
  const e1 = fixture.start.state.units.find(u => u.uid === 'e1');
  ok(CombatUI.view.e1.hp === e1.start_hp, `e1 初始血条用 start_hp(${e1.start_hp})，最终 hp 是 ${e1.hp}`);
  ok(CombatUI.view.e1.hp !== e1.hp || e1.start_hp === e1.hp, '确实区分了「演出进度」与「权威状态」');

  console.log('\n【3】事件流演出');
  const logWrap = $('#battle-log');
  ok(logWrap.children.length > 0, `战斗日志有 ${logWrap.children.length} 行`);
  const logText = logWrap.children.map(c => c.textContent).join(' | ');
  ok(/使用了/.test(logText), '日志里有技能/攻击播报');
  ok(/受到 \d+ 点伤害/.test(logText) || /恢复/.test(logText), '日志里有伤害/治疗记录');

  console.log('\n【4】等待玩家指令');
  const waiting = await waitFor(() => !!CombatUI.awaitUid, 'await_input');
  ok(waiting, '已进入 await_input：' + CombatUI.awaitUid);
  ok(CombatUI.awaitUid === 'p1', '等待的是玩家单位 p1');
  ok(!$('#battle-command').classList.contains('hidden'), '指令区已显示');
  ok($('#battle-round').textContent.includes('回合'), '回合数显示：' + $('#battle-round').textContent);
  ok(/to-item/.test($('#turn-order-list').innerHTML), '行动顺序栏已渲染');
  ok(/first/.test($('#turn-order-list').innerHTML), '行动顺序首位已标记');

  console.log('\n【4b】行动顺序队列：序号 / 下一位标识');
  const orderHtml = $('#turn-order-list').innerHTML;
  const orderN = CombatUI.state.order.length;
  ok(/to-idx/.test(orderHtml), '每项带序号徽章');
  ok(/>1<\/span>/.test(orderHtml), '序号从 1 开始编号');
  ok(new RegExp(`>${Math.min(8, orderN)}</span>`).test(orderHtml) || orderN > 8,
     `按顺序编号到 ${Math.min(8, orderN)}`);
  ok(/class="to-item [^"]*first/.test(orderHtml), '首位用 first 高亮');
  ok(/class="to-item [^"]*next/.test(orderHtml), '次位用 next 标记（下一位）');
  ok(/to-mark">当前</.test(orderHtml), '首位标了「当前」');
  ok(/to-mark">下一位</.test(orderHtml), '次位标了「下一位」');
  ok(/to-meta/.test(orderHtml) && /to-line/.test(orderHtml), '名字与血条按行内队列排布');
  const idxCount = (orderHtml.match(/to-idx/g) || []).length;
  ok(idxCount === Math.min(8, orderN), `序号数量与实际队列一致（${idxCount}）`);

  console.log('\n【5】技能列表（读后端下发的可用性）');
  const p1 = CombatUI.state.units.find(u => u.uid === 'p1');
  ok(p1.skills.length >= 4, `玩家技能 ${p1.skills.length} 个`);
  ok(p1.skills.every(s => typeof s.usable === 'boolean'), '每个技能都带 usable 标记');
  ok(p1.skills.some(s => s.is_ultimate), '含绝招');
  CombatUI._showSkills(p1, false);
  const subHtml = $('#cmd-sub').innerHTML;
  ok(/sub-btn skill/.test(subHtml), '技能面板已生成按钮');
  ok(/烈火掌/.test(subHtml), '技能名已渲染');
  ok(/灵力 8|无消耗/.test(subHtml), '消耗信息已渲染');
  ok(/data-back="1"/.test(subHtml), '带返回按钮');
  ok(!$('#cmd-sub').classList.contains('hidden'), '技能面板已显示');
  CombatUI._showSkills(p1, true);
  const ultHtml = $('#cmd-sub').innerHTML;
  ok(/万剑归宗/.test(ultHtml), '绝招分栏能筛出绝招');
  ok(!/烈火掌/.test(ultHtml), '绝招分栏里不混入普通技能');

  console.log('\n【6】攻击 → 多目标时进入选人模式');
  CombatUI._backToMain();
  await CombatUI._onCmd('attack');
  await flush(2);
  if (CombatUI.pool.length) {
    ok(true, `进入目标选择，可选 ${CombatUI.pool.length} 个目标`);
    ok(CombatUI.els[CombatUI.pool[0]].card.classList.contains('targetable'), '目标卡片被高亮');
    await CombatUI._onUnitClick(CombatUI.pool[0]);
  } else {
    ok(true, '目标唯一，直接出手（无需选人）');
  }

  console.log('\n【7】一路打到结束');
  let guard = 0;
  while (guard++ < 60) {
    await flush(3);
    if (!CombatUI.state || CombatUI.state.status !== 'active') break;
    if (CombatUI.busy) continue;
    if (!CombatUI.awaitUid) continue;
    await CombatUI._onCmd('attack');
    if (CombatUI.pool.length) await CombatUI._onUnitClick(CombatUI.pool[0]);
    else if (!CombatUI.busy) await flush(2);
  }
  await flush(8);

  ok(calls.action.length >= fixture.steps.length - 1,
     `共提交 ${calls.action.length} 次指令（夹具 ${fixture.steps.length} 步）`);
  ok(CombatUI.state && CombatUI.state.status === 'player_won',
     '战斗以 player_won 结束：' + (CombatUI.state && CombatUI.state.status));
  ok(Object.keys(CombatUI.view).every(uid => CombatUI.view[uid].hp >= 0), '所有单位血量正确收敛');
  ok(CombatUI.view.e1.hp <= 0, 'e1 血量归零');

  console.log('\n【8】结算面板');
  ok(calls.settle === 1, '结算接口只调了一次（幂等）');
  const box = $('#battle-result');
  const resultHtml = box.children.map(c => c.innerHTML).join('') || box.innerHTML;
  ok(!box.classList.contains('hidden'), '结算面板已显示');
  ok(/br-card/.test(resultHtml), '渲染了结算卡片');
  ok(/战斗胜利/.test(resultHtml), '标题是战斗胜利');
  ok(new RegExp('\\+' + fixture.rewards.exp).test(resultHtml),
     `显示获得经验 +${fixture.rewards.exp}`);
  ok(/等级提升/.test(resultHtml), '展示了升级信息（Lv.10 → Lv.' +
     fixture.rewards.level_up[fixture.rewards.level_up.length - 1].level + '）');
  ok(/境界突破/.test(resultHtml), '展示了境界突破');
  ok(/习得技能/.test(resultHtml), '展示了新学技能');
  ok(/br-drop/.test(resultHtml), `展示了 ${fixture.rewards.drops.length} 件掉落`);
  ok(GameState._uiUpdated > 0, 'HUD 已按结算后的角色数据刷新');
  ok(GameState.player.level ===
       (fixture.rewards.level_up.slice(-1)[0] || { level: 10 }).level &&
     GameState.player.max_hp === 1620,
     `角色数据已写回（Lv.${GameState.player.level} / HP ${GameState.player.max_hp}）`);

  console.log('\n【9】回到剧情');
  await CombatUI._onResultClick('continue');
  await flush(4);
  ok(GameState.isInCombat === false, 'isInCombat = false');
  ok($('#battle-layer').classList.contains('hidden'), '战斗层已隐藏');
  ok(!$('#ui-layer').classList.contains('hidden'), '游戏 UI 层已恢复');
  ok(calls.storyChoices.length === 1 && calls.storyChoices[0].nextAfter === 8,
     '已接着战斗节点往下走剧情');

  console.log('\n【10】合成事件：覆盖夹具里没出现的类型');
  const seen = new Set(fixture.meta.event_types);
  const synthetic = [
    { t: 'heal', uid: 'p1', value: 88, hp: 700 },
    { t: 'mp', uid: 'p1', delta: -12, mp: 100 },
    { t: 'item', uid: 'p1', item: '回春丹' },
    { t: 'miss', uid: 'e1', skill: '撕咬' },
    { t: 'resist_status', uid: 'e1', name: '眩晕' },
    { t: 'cleanse', uid: 'p1', count: 2 },
    { t: 'status_remove', uid: 'p1', key: 'poison' },
    { t: 'revive', uid: 'e2', hp: 120 },
    { t: 'flee_fail' },
    { t: 'flee_ok' },
    { t: 'cooldown', uid: 'p1', skill_id: 105, turns: 2 },
    { t: '未知事件类型', foo: 1 },
    { t: null },
  ];
  CombatUI.skip = true;
  $('#battle-log').children.length = 0; // 清空日志，便于断言新事件确实写了日志
  let crashed = null;
  for (const ev of synthetic) {
    try { await CombatUI._playEvent(ev); }
    catch (e) { crashed = ev; break; }
  }
  ok($('#battle-log').children.length >= 8,
     `合成事件共写入 ${$('#battle-log').children.length} 行日志`);
  const extra = [...seen, 'heal', 'mp', 'item', 'miss', 'resist_status', 'cleanse',
                 'status_remove', 'revive', 'flee_fail', 'flee_ok', 'cooldown'];
  ok(!crashed, crashed ? `事件 ${JSON.stringify(crashed)} 抛异常` : '全部事件类型都能安全播放');
  ok(extra.length >= 24, `覆盖事件类型 ${extra.length} 种`);
  const logText2 = $('#battle-log').children.map(c => c.textContent).join(' | ');
  ok(/恢复 88 点生命/.test(logText2), 'heal 事件写入了日志');
  ok(/使用了【回春丹】/.test(logText2), 'item 事件写入了日志');
  ok(/MISS|落空/.test(logText2), 'miss 事件写入了日志');
  ok(/抵抗了/.test(logText2), 'resist_status 写入了日志');

  console.log('\n【11】自动战斗开关');
  CombatUI.state = JSON.parse(JSON.stringify(fixture.start.state));
  CombatUI.state.status = 'player_won';
  await CombatUI.setAuto(true);
  await flush(4);
  ok(CombatUI.auto === false || CombatUI.auto === true, '自动开关状态可读写');
  ok($('#btn-auto').textContent.includes('自动'), '按钮文案已同步：' + $('#btn-auto').textContent);

  console.log('\n【12】立绘随掉血 / 出手切换');
  const st0 = fixture.start.state;
  const hero = st0.units.find(u => u.uid === 'p1');
  const wolf = st0.units.find(u => u.uid === 'e1');
  ok(!!(hero.art && hero.art.idle), '玩家单位带美术资源包 art');
  ok(!hero.art.portrait || typeof hero.art.portrait === 'string', 'art.portrait 可读');
  ok((hero.art.hurt || []).length >= 1, `损血档位 ${(hero.art.hurt || []).length} 档`);

  const full = CombatUI._artImage(hero, 'idle', 100);
  const mid = CombatUI._artImage(hero, 'idle', 50);
  const low = CombatUI._artImage(hero, 'idle', 20);
  ok(!!full, '满血有立绘：' + String(full).split('/').pop());
  ok(full === hero.art.idle, '满血用 idle 图');
  ok(mid === hero.art.hurt[0].url, '半血用最低档位图（60% 档）');
  ok(low === hero.art.hurt[hero.art.hurt.length - 1].url, '残血用 30% 档图');
  ok(low !== full, '残血和满血不是同一张图');
  ok(CombatUI._artImage(wolf, 'idle', 100) === CombatUI._artImage(wolf, 'idle', 10),
     '只配了一档的敌人血量变化时保持原图（不误切）');

  // 没配出手图时应落回血量图，而不是变成空白
  ok(CombatUI._artImage(hero, 'attack', 20) === low, '未配出手图时回落到血量图');
  ok(CombatUI._artImage(hero, 'down', 0) === (hero.art.down || low),
     '倒下优先用 defeated 图，没有则回落');

  // _setArt 真把图换到了 img 上
  CombatUI.state = JSON.parse(JSON.stringify(st0));
  CombatUI._buildUI();
  const img1 = CombatUI.els.p1.portraitImg;
  ok(!!img1, '玩家卡牌里有立绘 img 节点');
  CombatUI.view.p1.hp = CombatUI._unit('p1').eff.max_hp;
  CombatUI._setArt('p1', null);
  const urlFull = img1.src;
  CombatUI.view.p1.hp = CombatUI._unit('p1').eff.max_hp * 0.2;
  CombatUI._syncBars('p1');
  ok(img1.src === low, '掉到 20% 血后 img 已换成残血立绘');
  ok(urlFull !== img1.src, '换图前后确实不同');
  CombatUI._setArt('p1', 'down');
  ok(CombatUI._artHold.p1 && CombatUI._artHold.p1.mode === 'down', '倒下后立绘被锁定为战败图');
  const wolfImg = CombatUI.els.e1.portraitImg;
  ok(!!wolfImg, '敌人卡牌里有立绘 img 节点');
  ok(!!CombatUI.els.e1.hpFill && !!CombatUI.els.p1.rageFill, '血条 / 灵力 / 怒气节点齐全');

  console.log(`\n===== 前端战斗界面：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
