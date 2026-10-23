'use strict';
/*
 * FantasyQuest Phase 9/10 - progression + reward tests (Node.js).
 * Tests progression.js math in isolation, then loads progression.js +
 * battle.js into a stubbed DOM and verifies the victory reward flow:
 * EXP/Gold awarded, level-ups applied, HUD state exposed, overlay text.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ---- Minimal DOM stub (shared shape with battle.test.js) ---------------
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
  querySelector(sel) {
    // battle.js calls victoryScreen.querySelector('.result-line')
    if (sel === '.result-line') {
      if (!this._resultLine) {
        this._resultLine = new El('p');
        this._resultLine.classList.add('result-line');
      }
      return this._resultLine;
    }
    return new El();
  }
  querySelectorAll(sel) {
    return this.children.filter(c => c.classList.contains('enemy-unit'));
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
}

const ids = [
  'battle-arena', 'scene-battle', 'enemy-row', 'hero-unit', 'hero-hp-fill',
  'hero-mp-fill', 'hero-hp-text', 'hero-mp-text', 'hero-level-text',
  'hero-gold-text', 'turn-indicator', 'battle-message', 'victory-screen',
  'defeat-screen', 'item-panel', 'item-use', 'cmd-attack', 'cmd-magic',
  'cmd-item', 'cmd-defend', 'item-cancel', 'victory-again', 'defeat-retry'
];
const registry = {};
ids.forEach(id => {
  const el = new El('div', id);
  if (id === 'item-panel' || id === 'victory-screen' || id === 'defeat-screen') {
    el.classList.add('hidden');
  }
  registry[id] = el;
});

const documentStub = {
  getElementById: id => registry[id] || null,
  createElement: tag => new El(tag),
  querySelectorAll: () => [],
  addEventListener() {}
};

let pending = [];
const windowStub = {
  setTimeout: (fn) => { pending.push(fn); return pending.length; },
  AudioContext: undefined,
  webkitAudioContext: undefined
};
function flush(maxIters) {
  let n = 0;
  while (pending.length && n < (maxIters || 5000)) {
    pending.shift()();
    n++;
  }
  return n;
}

const sandbox = {
  window: windowStub,
  document: documentStub,
  console, setTimeout: windowStub.setTimeout, Math, Date
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}
load('progression.js');
load('audio.js');
load('battle.js');

const Progression = sandbox.window.Progression || sandbox.Progression;
const Battle = sandbox.window.Battle || sandbox.Battle;

// ---- Assertion kit -----------------------------------------------------
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '  (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// =====================================================================
console.log('\n== Phase 9: Progression math ==');

ok(typeof Progression === 'object' && Progression !== null, 'Progression global is defined');
['calculateLevel', 'experienceToNextLevel', 'gainExperience'].forEach(fn => {
  ok(typeof Progression[fn] === 'function', 'Progression.' + fn + '() exists');
});

eq(Progression.calculateLevel(0), 1, '0 EXP -> level 1');
eq(Progression.calculateLevel(19), 1, '19 EXP -> still level 1');
eq(Progression.calculateLevel(20), 2, '20 EXP -> level 2 (threshold)');
eq(Progression.calculateLevel(49), 2, '49 EXP -> level 2');
eq(Progression.calculateLevel(50), 3, '50 EXP -> level 3');
eq(Progression.calculateLevel(100), 4, '100 EXP -> level 4');
eq(Progression.calculateLevel(480), 7, '480 EXP -> level 7 (max)');
eq(Progression.calculateLevel(9999), 7, '9999 EXP -> capped at level 7 (max)');

eq(Progression.experienceToNextLevel(0), 20, 'from 0 EXP, 20 needed for next');
eq(Progression.experienceToNextLevel(15), 5, 'from 15 EXP, 5 needed for next');
eq(Progression.experienceToNextLevel(20), 30, 'from 20 EXP (Lv2), 30 needed for Lv3');
eq(Progression.experienceToNextLevel(480), null, 'at max level, experienceToNextLevel is null');

// gainExperience: no level-up
{
  const hero = { level: 1, experience: 0, maxHp: 120, hp: 100, attackDamage: 28 };
  const res = Progression.gainExperience(hero, 10);
  eq(hero.experience, 10, 'gain 10 EXP -> total 10');
  eq(hero.level, 1, 'no level-up at 10 EXP');
  eq(res.leveledUp, false, 'leveledUp flag false');
  eq(res.levelsGained, 0, 'levelsGained 0');
  eq(hero.maxHp, 120, 'maxHp unchanged without level-up');
  eq(hero.hp, 100, 'hp unchanged without level-up (no heal)');
}

// gainExperience: single level-up (full heal + stat gains)
{
  const hero = { level: 1, experience: 15, maxHp: 120, hp: 30, attackDamage: 28 };
  const res = Progression.gainExperience(hero, 10); // 25 total -> Lv2
  eq(hero.experience, 25, 'gain 10 -> total 25');
  eq(hero.level, 2, 'leveled up to 2');
  eq(res.leveledUp, true, 'leveledUp flag true');
  eq(res.levelsGained, 1, 'levelsGained 1');
  eq(hero.maxHp, 125, '+5 maxHp on level-up (120 -> 125)');
  eq(hero.attackDamage, 30, '+2 attackDamage on level-up (28 -> 30)');
  eq(hero.hp, 125, 'full heal on level-up (hp = new maxHp)');
}

// gainExperience: multi level-up in one grant
{
  const hero = { level: 1, experience: 0, maxHp: 120, hp: 120, attackDamage: 28 };
  const res = Progression.gainExperience(hero, 55); // 55 total -> Lv3 (threshold 50)
  eq(hero.level, 3, '55 EXP -> level 3 (crossed 20 and 50)');
  eq(res.levelsGained, 2, 'levelsGained 2 (1->2->3)');
  eq(hero.maxHp, 130, 'two level-ups: +10 maxHp (120 -> 130)');
  eq(hero.attackDamage, 32, 'two level-ups: +4 attackDamage (28 -> 32)');
}

// gainExperience: capped at max level
{
  const hero = { level: 7, experience: 480, maxHp: 150, hp: 150, attackDamage: 40 };
  const res = Progression.gainExperience(hero, 1000);
  eq(hero.level, 7, 'stays at max level 7');
  eq(res.leveledUp, false, 'no level-up past max');
  eq(hero.experience, 1480, 'EXP still accumulates past max');
}

// =====================================================================
console.log('\n== Phase 9/10: Battle reward flow ==');

Battle.init();
let s = Battle.state();
eq(s.heroLevel, 1, 'battle hero starts at level 1');
eq(s.heroExperience, 0, 'battle hero starts at 0 EXP');
eq(s.heroGold, 0, 'battle hero starts at 0 gold');
eq(s.heroAttackDamage, 28, 'battle hero starts with base attackDamage 28');

// Win the battle by grinding attacks.
let guard = 0;
while (Battle.state().phase !== 'victory' && guard < 200) {
  guard++;
  const st = Battle.state();
  if (st.phase === 'target') {
    const idx = st.enemies.findIndex(e => e.alive);
    Battle.command('attack', idx);
  } else if (st.phase === 'player') {
    Battle.command('attack');
  }
  flush();
}
s = Battle.state();
eq(s.phase, 'victory', 'battle reaches victory');

// Goblin (25 EXP, 18G) + Wolf (20 EXP, 20G... wait wolf=12G) = 45 EXP, 30 G
eq(s.lastExpGained, 45, 'victory awards 45 EXP total (25 goblin + 20 wolf)');
eq(s.lastGoldGained, 30, 'victory awards 30 gold total (18 goblin + 12 wolf)');
eq(s.heroExperience, 45, 'hero experience updated to 45');
eq(s.heroGold, 30, 'hero gold updated to 30');

// 45 EXP crosses the 20 threshold -> level 2
eq(s.heroLevel, 2, '45 EXP triggers level-up to Lv2');
eq(s.leveledUp, true, 'leveledUp flag set on victory state');
eq(s.heroMaxHp, 125, 'level-up raised maxHp 120 -> 125');
eq(s.heroAttackDamage, 30, 'level-up raised attackDamage 28 -> 30 (for next battle)');

// Victory overlay line mentions EXP, Gold, and LEVEL UP
const overlayLine = registry['victory-screen'].querySelector('.result-line');
ok(overlayLine.textContent.indexOf('+45 EXP') !== -1, 'victory overlay shows +45 EXP');
ok(overlayLine.textContent.indexOf('+30 Gold') !== -1, 'victory overlay shows +30 Gold');
ok(overlayLine.textContent.indexOf('LEVEL UP') !== -1, 'victory overlay announces LEVEL UP');
ok(overlayLine.textContent.indexOf('Lv 2') !== -1, 'victory overlay shows new level Lv 2');

// HUD text elements updated by render()
ok(registry['hero-level-text'].textContent.indexOf('LV 2') !== -1, 'HUD level text shows LV 2');
ok(registry['hero-level-text'].textContent.indexOf('EXP 45') !== -1, 'HUD level text shows EXP 45');
ok(registry['hero-gold-text'].textContent.indexOf('30 G') !== -1, 'HUD gold text shows 30 G');

// playAgain resets the BATTLE but the hero keeps progression
Battle.playAgain();
s = Battle.state();
eq(s.phase, 'player', 'playAgain resets phase to player');
eq(s.heroLevel, 2, 'progression persists across battles: still Lv2');
eq(s.heroExperience, 45, 'progression persists: still 45 EXP');
eq(s.heroGold, 30, 'progression persists: still 30 gold');
eq(s.heroMaxHp, 125, 'progression persists: maxHp stays 125');
eq(s.heroAttackDamage, 30, 'leveled-up attackDamage persists (30) into the next battle');

// Win a second battle -> more EXP, eventually another level-up
let guard2 = 0;
while (Battle.state().phase !== 'victory' && guard2 < 200) {
  guard2++;
  const st = Battle.state();
  if (st.phase === 'target') {
    const idx = st.enemies.findIndex(e => e.alive);
    Battle.command('attack', idx);
  } else if (st.phase === 'player') {
    Battle.command('attack');
  }
  flush();
}
s = Battle.state();
eq(s.heroExperience, 90, 'second victory: 45 + 45 = 90 EXP total');
eq(s.heroGold, 60, 'second victory: 30 + 30 = 60 gold total');
// 90 EXP crosses the 50 threshold -> level 3
eq(s.heroLevel, 3, '90 EXP triggers level-up to Lv3');
eq(s.heroMaxHp, 130, 'Lv3 maxHp = 130 (125 + 5)');

console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
