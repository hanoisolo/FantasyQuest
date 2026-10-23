'use strict';
/*
 * FantasyQuest Pass 1 - headless battle-engine test harness (Node.js).
 * Stubs the DOM + Web Audio, loads audio.js and battle.js, and drives
 * the turn-based combat state machine through every phase.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = require('path').resolve(__dirname, '..');

// ---- Minimal DOM stub --------------------------------------------------
class ClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
    return want;
  }
  contains(c) { return this.set.has(c); }
}
class El {
  constructor(tag, id) {
    this.tagName = tag || 'div';
    this.id = id || '';
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList();
    this.style = {};
    this.attrs = {};
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.listeners = {};
    this.offsetWidth = 100;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter(f => f !== fn);
  }
  click() { (this.listeners.click || []).forEach(f => f.call(this, { preventDefault() {} })); }
  querySelector() { return new El(); }
  querySelectorAll(sel) {
    // battle.js calls enemyRow.querySelectorAll('.enemy-unit') to update bars.
    return this.children.filter(c => c.classList.contains('enemy-unit'));
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
}

const ids = [
  'battle-arena', 'scene-battle', 'enemy-row', 'hero-unit', 'hero-hp-fill',
  'hero-mp-fill', 'hero-hp-text', 'hero-mp-text', 'turn-indicator',
  'battle-message', 'victory-screen', 'defeat-screen', 'item-panel',
  'item-use', 'cmd-attack', 'cmd-magic', 'cmd-item', 'cmd-defend',
  'item-cancel', 'victory-again', 'defeat-retry', 'screen-flash',
  'scene-title', 'game-shell', 'crt-toggle', 'game-canvas'
];
const registry = {};
ids.forEach(id => {
  const el = new El('div', id);
  if (id.startsWith('scene-') || id === 'item-panel' || id === 'victory-screen' || id === 'defeat-screen') {
    el.classList.add('hidden'); // mirror index.html initial states for overlays
  }
  if (id.startsWith('scene-')) el.classList.remove('active');
  registry[id] = el;
});
registry['scene-title'].classList.add('active');

const documentStub = {
  getElementById: id => registry[id] || null,
  createElement: tag => new El(tag),
  querySelectorAll: sel => {
    if (sel === '.scene') return [registry['scene-title'], registry['scene-battle']];
    return [];
  },
  addEventListener() {}
};

const windowStub = {
  setTimeout: (fn) => { pending.push(fn); return pending.length; },
  AudioContext: undefined, // force silent audio path
  webkitAudioContext: undefined
};

// Flush the timer queue until empty (simulates the passage of battle time).
let pending = [];
function flush(maxIters) {
  let n = 0;
  while (pending.length && n < (maxIters || 5000)) {
    const fn = pending.shift();
    fn();
    n++;
  }
  return n;
}

const sandbox = {
  window: windowStub,
  document: documentStub,
  console,
  setTimeout: windowStub.setTimeout,
  Math,
  Date
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}
load('audio.js');
load('battle.js');

const Battle = sandbox.window.Battle || sandbox.Battle;
const RetroAudio = sandbox.window.RetroAudio || sandbox.RetroAudio;

// ---- Tiny assertion kit ------------------------------------------------
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '  (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// ---- Tests -------------------------------------------------------------
console.log('\n== Pass 1: Battle engine ==');

ok(typeof RetroAudio === 'object' && RetroAudio !== null, 'RetroAudio global is defined');
['beep', 'slash', 'sparkle', 'heal', 'fanfare', 'gameOver'].forEach(fn => {
  ok(typeof RetroAudio[fn] === 'function', 'RetroAudio.' + fn + '() exists');
});
['beep', 'slash', 'sparkle', 'heal', 'fanfare', 'gameOver'].forEach(fn => {
  let threw = false;
  try { RetroAudio[fn](); } catch (e) { threw = true; }
  ok(!threw, 'RetroAudio.' + fn + '() runs without throwing (silent path)');
});

ok(typeof Battle === 'object' && Battle !== null, 'Battle global is defined');
['init', 'command', 'state', 'playAgain'].forEach(fn => {
  ok(typeof Battle[fn] === 'function', 'Battle.' + fn + '() exists');
});

const initResult = Battle.init();
eq(initResult, true, 'Battle.init() returns true');

let s = Battle.state();
ok(s !== null, 'Battle.state() returns a snapshot after init');
eq(s.phase, 'player', 'initial phase is "player"');
eq(s.heroHp, 120, 'hero starts at full HP (120)');
eq(s.heroMaxHp, 120, 'hero max HP is 120');
eq(s.heroMp, 45, 'hero starts at full MP (45)');
eq(s.itemUsed, false, 'item not yet used');
eq(s.enemies.length, 2, 'two enemies on the field');
eq(s.enemies[0].hp, 55, 'Forest Goblin starts at 55 HP');
eq(s.enemies[1].hp, 45, 'Shadow Wolf starts at 45 HP');

// --- Attack flow: enter targeting, then strike enemy 0 ---
Battle.command('attack');
s = Battle.state();
eq(s.phase, 'target', 'choosing ATTACK enters "target" phase');

Battle.command('attack', 0); // programmatic target strike
const goblinHpAfterHit = Battle.state().enemies[0].hp;
eq(goblinHpAfterHit, 55 - 28, 'hero attack deals 28 damage to Goblin (55 -> 27)');

// Let the enemy turn resolve fully.
flush();
s = Battle.state();
eq(s.phase, 'player', 'after enemy turn resolves, phase returns to "player"');
eq(s.turnCount, 1, 'turn counter incremented to 1');
const heroHpAfterEnemyTurn = s.heroHp;
ok(heroHpAfterEnemyTurn < 120, 'hero took damage during the enemy turn (HP ' + heroHpAfterEnemyTurn + ' < 120)');
ok(heroHpAfterEnemyTurn > 0, 'hero survived the first enemy turn');

// --- Magic flow: AoE, costs 10 MP ---
const mpBefore = Battle.state().heroMp;
Battle.command('magic');
flush();
s = Battle.state();
eq(s.heroMp, mpBefore - 10, 'magic costs 10 MP');
const goblinAfterMagic = s.enemies[0].hp;
const wolfAfterMagic = s.enemies[1].hp;
ok(goblinAfterMagic <= 27 - 20, 'magic dealt 20 AoE damage to Goblin (' + goblinAfterMagic + ' <= 7)');
ok(wolfAfterMagic <= 45 - 20, 'magic dealt 20 AoE damage to Wolf (' + wolfAfterMagic + ' <= 25)');
eq(s.phase, 'player', 'phase returns to player after magic + enemy turn');

// --- Defend flow ---
Battle.command('defend');
s = Battle.state();
eq(s.defending, true, 'defend sets the defending flag');
flush();
s = Battle.state();
eq(s.defending, false, 'defending flag clears after the enemy turn');
eq(s.phase, 'player', 'phase returns to player after defend + enemy turn');

// --- Item flow ---
const hpBeforeItem = Battle.state().heroHp;
Battle.command('item'); // opens the panel
const panelHidden = registry['item-panel'].classList.contains('hidden');
eq(panelHidden, false, 'ITEM command opens the item panel');
registry['item-use'].click(); // USE the crystal
flush();
s = Battle.state();
ok(s.heroHp > hpBeforeItem, 'using the Arcane Crystal heals the hero (' + hpBeforeItem + ' -> ' + s.heroHp + ')');
eq(s.itemUsed, true, 'itemUsed flag set after use');

// --- Grind the fight to victory ---
let guard = 0;
while (Battle.state().phase !== 'victory' && guard < 200) {
  guard++;
  const st = Battle.state();
  if (st.phase === 'target') {
    // strike the first living enemy
    const idx = st.enemies.findIndex(e => e.alive);
    Battle.command('attack', idx);
  } else if (st.phase === 'player') {
    Battle.command('attack');
  }
  flush();
}
s = Battle.state();
eq(s.phase, 'victory', 'repeated attacks eventually win the battle (guard=' + guard + ')');
ok(s.enemies.every(e => !e.alive), 'all enemies defeated at victory');
eq(registry['victory-screen'].classList.contains('hidden'), false, 'victory overlay is shown');

// --- Commands are inert after victory ---
const hpAtVictory = Battle.state().heroHp;
Battle.command('magic');
eq(Battle.state().heroHp, hpAtVictory, 'commands are ignored once the battle is over');

// --- playAgain resets everything ---
Battle.playAgain();
s = Battle.state();
eq(s.phase, 'player', 'playAgain() resets phase to "player"');
eq(s.heroHp, 120, 'playAgain() restores hero HP to full');
eq(s.heroMp, 45, 'playAgain() restores hero MP to full');
eq(s.enemies[0].hp, 55, 'playAgain() restores Goblin HP');
eq(s.enemies[1].hp, 45, 'playAgain() restores Wolf HP');
eq(s.itemUsed, false, 'playAgain() resets the itemUsed flag');
eq(registry['victory-screen'].classList.contains('hidden'), true, 'playAgain() hides the victory overlay');

// --- Defeat path: fresh battle, then verify guard via direct state manipulation is not
//     possible through the public API, so we simulate by checking the defeat overlay wiring. ---
registry['defeat-retry'].click();
s = Battle.state();
eq(s.phase, 'player', 'defeat RETRY button also resets the battle');

console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
