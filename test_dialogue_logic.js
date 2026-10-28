// 对话列表 + 立绘坐标化 逻辑冒烟测试（无浏览器，桩件模拟 DOM / API）
const fs = require('fs');
const path = require('path');
const FRONTEND = path.join(__dirname, 'frontend');

// ---------- DOM 桩件 ----------
class ClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach(x => this.s.add(x)); }
  remove(...c) { c.forEach(x => this.s.delete(x)); }
  contains(c) { return this.s.has(c); }
  toggle(c, on) { if (on === undefined) { this.s.has(c) ? this.s.delete(c) : this.s.add(c); } else { on ? this.s.add(c) : this.s.delete(c); } }
}
class El {
  constructor(tag = 'div') {
    this.tag = tag; this.style = {}; this.dataset = {}; this.children = [];
    this.classList = new ClassList(); this.textContent = ''; this._html = '';
    this.clientHeight = 800; this.clientWidth = 1400;
    this.naturalWidth = 600; this.naturalHeight = 1000; this.complete = true;
    this._handlers = {};
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  set className(v) { this.classList = new ClassList(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
  get className() { return [...this.classList.s].join(' '); }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  querySelector(sel) {
    if (sel === 'img') return this.children.find(c => c.tag === 'img') || null;
    const m = sel.match(/\.stage-char\[data-char-id="(\d+)"\]/);
    if (m) return this.children.find(c => c.classList.contains('stage-char') && String(c.dataset.charId) === m[1]) || null;
    if (sel.startsWith('.stage-char')) return this.children.find(c => c.classList.contains('stage-char')) || null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === '.stage-char') return this.children.filter(c => c.classList.contains('stage-char'));
    return [];
  }
  addEventListener() {}
  remove() {}
  get offsetHeight() { return 0; }
}
const roots = {};
function $(sel) { if (!roots[sel]) roots[sel] = new El(); return roots[sel]; }
global.document = {
  querySelector: $,
  querySelectorAll: () => [],
  createElement: (tag) => new El(tag),
  addEventListener() {},
  head: new El('head'),
};
global.window = { innerHeight: 800, innerWidth: 1400, addEventListener() {} };
global.requestAnimationFrame = (fn) => fn();

const layer = $('#expression-layer');

// ---------- 数据桩件 ----------
const CHARS = {
  1: { id: 1, name: 'kong', portrait_image: '/img/kong.png', expressions: JSON.stringify({ angry: '/img/kong_angry.png' }) },
  2: { id: 2, name: '黄蓉', portrait_image: '/img/hr.png', expressions: JSON.stringify({ happy: '/img/hr_happy.png' }) },
};
const NODES = {
  8: { id: 8, node_type: 'battle', speaker_id: 2, content: '我要吃了你！！', scene_id: null, position: 'right-1' },
  9: { id: 9, node_type: 'dialogue', speaker_id: null, content: '快脱吧，我的圆圆！', scene_id: null, multi_characters: JSON.stringify([
    { speaker_id: 2, expression: 'happy', position: 'left-1' },
  ]) },
  10: { id: 10, node_type: 'dialogue', speaker_id: 2, content: '', scene_id: null },
};
const DIALOGUES = {
  8: [
    { id: 1, order_index: 0, speaker_id: 2, content: '我要吃了你！！臭娘们', expression: 'happy', pos_x: 70, pos_y: 0, scale: 1.2, crop_top: 0, crop_bottom: 45, flip: 0, z_index: 2, animation_effect_id: null },
    { id: 2, order_index: 1, speaker_id: 1, content: '女侠饶命！', expression: 'angry', pos_x: 25, pos_y: 0, scale: 1, crop_top: 0, crop_bottom: 60, flip: 0, z_index: 1, animation_effect_id: null },
  ],
  10: [
    { id: 11, order_index: 0, speaker_id: 2, content: '我先走了', expression: 'happy', pos_x: 60, pos_y: 0, scale: 1, crop_top: 0, crop_bottom: 100, flip: 0, z_index: 1, disappear_after: 1, animation_effect_id: null },
    { id: 12, order_index: 1, speaker_id: 1, content: '好走不送', expression: 'angry', pos_x: 40, pos_y: 0, scale: 1, crop_top: 0, crop_bottom: 100, flip: 0, z_index: 1, disappear_after: 0, animation_effect_id: null },
  ],
};
const API = {
  characters: { get: async (id) => CHARS[id] },
  scenes: { get: async () => ({ scene_type: 'town', background_image: '' }) },
  story: {
    getNodeFull: async (id) => ({ node: NODES[id], choices: [], dialogues: DIALOGUES[id] || [] }),
    getNode: async (id) => NODES[id],
  },
};
const GameState = {
  player: { id: 999, base_id: 1, name: '测试侠', hp: 100, max_hp: 100 },
  party: [], currentScene: null, isInCombat: false, isInDialogue: false, currentNode: null,
  updatePlayerUI() {},
  async loadNode(id) { return { node: NODES[id], choices: [], dialogues: DIALOGUES[id] || [] }; },
};
const App = {
  async handleBattleNode(node) { App.__battleStarted = node.id; },
  async handleStoryChoice(r) { App.__continued = r && r.nextAfter; },
};

// ---------- 载入真实源码 ----------
const utilsSrc = fs.readFileSync(path.join(FRONTEND, 'js', 'utils.js'), 'utf8');
const dialogueSrc = fs.readFileSync(path.join(FRONTEND, 'js', 'ui', 'dialogue.js'), 'utf8');
const factory = new Function('GameState', 'API', 'App', utilsSrc + '\n' + dialogueSrc + '\nreturn DialogueUI;');
const DialogueUI = factory(GameState, API, App);

const assert = (cond, msg) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg);
  if (!cond) process.exitCode = 1;
};

(async () => {
  console.log('【1】节点 8（战斗节点，2 句对话列表）');
  await DialogueUI.showNode(8, App.handleStoryChoice.bind(App));
  assert(DialogueUI._lines.length === 2, '识别出 2 句对话');
  assert(DialogueUI._lineIndex === 0, '正在播第 1 句');
  assert($('#speaker-name').textContent === '黄蓉', '说话者: ' + $('#speaker-name').textContent);
  assert($('#dialogue-text').textContent === '我要吃了你！！臭娘们', '台词: ' + $('#dialogue-text').textContent);

  const c2 = layer.querySelector('.stage-char[data-char-id="2"]');
  assert(!!c2, '黄蓉已上台');
  console.log('    视窗样式:', JSON.stringify({ left: c2.style.left, bottom: c2.style.bottom, w: c2.style.width, h: c2.style.height }));
  assert(c2.style.left === '70%', 'X 坐标 70%');
  // 立绘高 = 800*0.85*1.2 = 816 → 宽 = 816*0.6 = 489.6（未超上限）→ 视窗高 = 816*45% = 367.2
  assert(Math.abs(parseFloat(c2.style.height) - 367.2) < 0.5, `裁剪后只显示 45%（视窗高 ${c2.style.height}）`);
  assert(c2.querySelector('img').style.top === '0px', '从立绘顶部开始裁（top=0）');
  assert(!c2.classList.contains('dimmed'), '当前说话者未淡化');

  console.log('【2】点击 → 第 2 句');
  await DialogueUI.handleClick();
  assert(DialogueUI._lineIndex === 1, '进入第 2 句');
  assert($('#speaker-name').textContent === 'kong', '说话者切换成: ' + $('#speaker-name').textContent);
  const c1 = layer.querySelector('.stage-char[data-char-id="1"]');
  assert(!!c1, 'kong 上台');
  assert(c1.style.left === '25%', 'X 坐标 25%');
  assert(c2.classList.contains('dimmed'), '上一句说话者已淡化');
  assert(!c1.classList.contains('dimmed'), '当前说话者高亮');

  console.log('【3】最后一句播完 → 不自动跳，需玩家点击才挂起战斗');
  assert(!DialogueUI.pendingBattleNode, '最后一句播完时没有自动收尾');
  assert(DialogueUI._nodeFinished === true, '已标记为读完，等待点击');
  await DialogueUI.handleClick();
  assert(!!DialogueUI.pendingBattleNode, '点击后战斗节点挂起');
  await DialogueUI.handleClick();
  assert(App.__battleStarted === 8, '战斗已开始（节点 8）');
  assert(!DialogueUI.pendingBattleNode, '挂起状态已清除');

  console.log('【4】旧节点（无对话列表）兼容回退');
  layer.innerHTML = '';
  await DialogueUI.showNode(9, App.handleStoryChoice.bind(App));
  assert(DialogueUI._lines.length === 0, '走旧单句模式');
  assert($('#dialogue-text').textContent === '快脱吧，我的圆圆！', '旧台词正常显示');
  const legacy = layer.querySelector('.stage-char[data-char-id="2"]');
  assert(!!legacy, '旧 multi_characters 人物仍上台');
  assert(legacy.style.left === '12%', '旧站位 left-1 → 12%（实际 ' + legacy.style.left + '）');
  assert(Math.abs(parseFloat(legacy.style.height) - 340) < 0.5, '旧模式高度 = 800*0.85*0.5 = 340（实际 ' + legacy.style.height + '）');

  console.log('【5】说完即消失（disappear_after）');
  layer.innerHTML = '';
  await DialogueUI.showNode(10, App.handleStoryChoice.bind(App));
  const gone = layer.querySelector('.stage-char[data-char-id="2"]');
  assert(!!gone, '第 1 句：黄蓉上台');
  assert(DialogueUI._removeQueue.includes(2), '黄蓉已排进退场队列');
  await DialogueUI.handleClick();
  assert(DialogueUI._lineIndex === 1, '点击后进入第 2 句');
  assert(gone.classList.contains('leaving'), '第 2 句开始时黄蓉淡出退场');
  assert(DialogueUI._removeQueue.length === 0, '退场队列已清空');
  const stay = layer.querySelector('.stage-char[data-char-id="1"]');
  assert(!!stay && !stay.classList.contains('leaving'), '第 2 句说话者仍在场');
  assert(stay.classList.contains('speaking'), '第 2 句说话者被标记为突出');
  assert(gone.classList.contains('dimmed'), '退场者已淡化');

  console.log('\n全部检查完成');
})().catch(e => { console.error('测试异常:', e); process.exitCode = 1; });
