'use strict';
/*
 * FantasyQuest Pass 1 - Chrono Trigger battle loop test harness (Node.js).
 * Stubs the DOM + Web Audio, loads chrono_battle_engine.js, audio.js,
 * progression.js and battle.js, then drives the TITLE -> COMBAT ->
 * VICTORY / DEFEAT state machine through every command.
 *
 * Expected damage bands are derived from the Chrono formulas at the hero's
 * CURRENT level (power grows +2 per level via Progression):
 *   base     = power*4/3 + (4*5/8) - (6*0.5)
 *   normal   = floor(base*0.94) .. floor(base*1.06)
 *   crit     = 2x normal (exactly doubles, per the engine)
 *   magic    = (12*4/3) + (8*2.5) - (4*0.4) = 34.4 -> 34
 *   goblin   = (6*4/3) + (3*5/8) - (4*0.5) = 7.875 -> 7-8, defended 3-4
 *   ATB      = calculateATBTick(14) = 87.5 -> gauge full after 2 ticks
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

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
    this.disabled = false;
    this.listeners = {};
    this.offsetWidth = 100;
  }
  set innerHTML(v) { this.children = []; this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML || ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter(f => f !== fn);
  }
  click() { (this.listeners.click || []).forEach(f => f.call(this, { preventDefault() {} })); }
  // battle.js looks up enemy units by data-index and overlay lines by class
  querySelector(sel) {
    if (sel === '.result-line') {
      if (!this._resultLine) {
        this._resultLine = new El('p');
        this._resultLine.classList.add('result-line');
      }
      return this._resultLine;
    }
    const m = /^\[data-index="(\d+)"\]$/.exec(sel);
    if (m) {
      return this.children.find(c => c.getAttribute('data-index') === m[1]) || null;
    }
    if (sel === '.bar-fill' || sel === '.bar-label') {
      return this.children.find(c => c.classList.contains(sel.slice(1))) || new El();
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
  'hero-mp-fill', 'hero-atb-fill', 'hero-atb-text', 'hero-hp-text',
  'hero-mp-text', 'hero-level-text', 'hero-gold-text', 'turn-indicator',
  'battle-message', 'victory-screen', 'defeat-screen', 'item-panel',
  'item-use', 'item-cancel', 'cmd-attack', 'cmd-magic', 'cmd-item',
  'cmd-defend', 'victory-again', 'defeat-retry', 'screen-flash',
  'scene-title', 'game-shell', 'crt-toggle', 'game-canvas'
];
const registry = {};
ids.forEach(id => {
  const el = new El('div', id);
  if (id === 'item-panel' || id === 'victory-screen' || id === 'defeat-screen') {
    el.classList.add('hidden'); // mirror index.html initial states for overlays
  }
  registry[id] = el;
});

// Battle-log history: the ATB recharge overwrites the current message, so
// log assertions check the full history instead of the final text.
const messageLog = [];
Object.defineProperty(registry['battle-message'], 'textContent', {
  get() { return this._text || ''; },
  set(v) { this._text = String(v); messageLog.push(this._text); }
});
function said(needle) {
  return messageLog.some(t => t.indexOf(needle) !== -1);
}

const documentStub = {
  getElementById: id => registry[id] || null,
  createElement: tag => new El(tag),
  querySelectorAll: sel => {
    if (sel === '.scene') return [registry['scene-title'], registry['scene-battle']];
    return [];
  },
  addEventListener() {}
};

// setTimeout is captured so the harness can (a) flush the timer queue and
// (b) assert the scheduled delays (0.8s enemy pause, 400ms ATB tick, ...).
const pending = [];
const delays = [];
const windowStub = {
  setTimeout: (fn, delay) => { pending.push(fn); delays.push(delay); return pending.length; },
  AudioContext: undefined, // force silent audio path
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
load('chrono_battle_engine.js');
load('audio.js');
load('progression.js');
load('battle.js');

const Chrono = sandbox.window.ChronoEngine || sandbox.ChronoEngine;
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

// Damage bands for the hero's physical hits at a given power stat.
// base = power*4/3 + weapon(4)*5/8 - defense(6)*0.5
function heroBands(power) {
  const base = power * 4 / 3 + 4 * 5 / 8 - 6 * 0.5;
  const lo = Math.floor(base * 0.94);
  const hi = Math.floor(base * 1.06);
  return { normal: [lo, hi], crit: [lo * 2, hi * 2] };
}
function inBand(dmg, band) {
  return dmg >= band[0] && dmg <= band[1];
}

// ---- Tests -------------------------------------------------------------
console.log('\n== Pass 1: Chrono Trigger battle loop ==');

// --- Chrono engine exposed to the browser global ---
ok(typeof Chrono === 'object' && Chrono !== null, 'window.ChronoEngine global is defined');
['calculatePhysicalDamage', 'calculateMagicDamage', 'calculateDualTechDamage', 'calculateATBTick']
  .forEach(fn => ok(typeof Chrono[fn] === 'function', 'ChronoEngine.' + fn + '() exists'));
eq(Chrono.ATB_GAUGE_MAX, 100, 'ATB gauge max is 100 points');
eq(Chrono.calculateATBTick(14), 87.5, 'Speed 14 fills 87.5 ATB points per tick');

// --- Web Audio synthesizer (Pass 1 primary API + legacy aliases) ---
ok(typeof RetroAudio === 'object' && RetroAudio !== null, 'RetroAudio global is defined');
['playCursor', 'playSlash', 'playMagic', 'playHeal', 'playVictory'].forEach(fn => {
  ok(typeof RetroAudio[fn] === 'function', 'RetroAudio.' + fn + '() exists');
});
['playCursor', 'playSlash', 'playMagic', 'playHeal', 'playVictory'].forEach(fn => {
  let threw = false;
  try { RetroAudio[fn](); } catch (e) { threw = true; }
  ok(!threw, 'RetroAudio.' + fn + '() runs without throwing (silent path)');
});
['beep', 'slash', 'sparkle', 'heal', 'fanfare', 'gameOver'].forEach(fn => {
  ok(typeof RetroAudio[fn] === 'function', 'legacy alias RetroAudio.' + fn + '() exists');
});

// --- Battle controller API ---
ok(typeof Battle === 'object' && Battle !== null, 'Battle global is defined');
['init', 'command', 'state', 'playAgain', 'getProfile'].forEach(fn => {
  ok(typeof Battle[fn] === 'function', 'Battle.' + fn + '() exists');
});
eq(Battle.init(), true, 'Battle.init() returns true');

// --- Initial state: two Forest Goblins, hero 120/45, ATB charges ---
flush();
let s = Battle.state();
ok(s !== null, 'Battle.state() returns a snapshot after init');
eq(s.phase, 'player', 'ATB charges to full and hands the turn to the player');
eq(s.heroAtb, 100, 'ATB gauge reads 100 after charging');
eq(s.atbMax, 100, 'snapshot exposes the 100-point ATB max');
eq(s.heroSpeed, 14, 'hero speed stat is 14');
eq(s.heroHp, 120, 'hero starts at full HP (120)');
eq(s.heroMaxHp, 120, 'hero max HP is 120');
eq(s.heroMp, 45, 'hero starts at full MP (45)');
eq(s.heroMaxMp, 45, 'hero max MP is 45');
eq(s.heroPower, 14, 'hero base power is 14 (chrono physical formula)');
eq(s.defending, false, 'hero does not start defending');
eq(s.heroLevel, 1, 'hero starts at level 1');
eq(s.heroExperience, 0, 'hero starts at 0 EXP');
eq(s.heroGold, 0, 'hero starts at 0 gold');
eq(s.enemies.length, 2, 'two enemies on the field');
eq(s.enemies[0].name, 'FOREST GOBLIN', 'enemy 0 is a Forest Goblin');
eq(s.enemies[1].name, 'FOREST GOBLIN', 'enemy 1 is a Forest Goblin');
eq(s.enemies[0].hp, 45, 'Forest Goblin 0 starts at 45 HP');
eq(s.enemies[1].hp, 45, 'Forest Goblin 1 starts at 45 HP');
eq(registry['hero-atb-fill'].style.width, '100%', 'ATB bar DOM fills to 100%');
ok(registry['hero-atb-text'].textContent.indexOf('100') !== -1, 'ATB bar text shows 100%');
ok(delays.indexOf(400) !== -1, 'ATB ticks are scheduled (400ms gauge ticks)');
eq(registry['enemy-row'].children.length, 2, 'enemy row renders two goblin units');

// --- ATTACK: targeting, chrono damage band, crit detection ---
Battle.command('attack');
s = Battle.state();
eq(s.phase, 'target', 'choosing ATTACK enters the "target" phase');
ok(registry['enemy-row'].children[0].classList.contains('targetable'),
  'living enemies are marked targetable during targeting');

let bands = heroBands(s.heroPower);
const goblinHpBefore = s.enemies[0].hp;
Battle.command('attack', 0); // programmatic target strike
const attackDamage = goblinHpBefore - Battle.state().enemies[0].hp;
ok(inBand(attackDamage, bands.normal) || inBand(attackDamage, bands.crit),
  'calculatePhysicalDamage lands in the 17-19 band at Lv1 (crit: 34-38; got ' + attackDamage + ')');
ok(said('HERO attacks FOREST GOBLIN'), 'battle log announces the hero attack');

flush();
s = Battle.state();
eq(s.phase, 'player', 'after the enemy counterattack the ATB recharges to player');
eq(s.turnCount, 1, 'turn counter incremented to 1');
ok(s.heroHp > 0 && s.heroHp < 120, 'hero took damage during the enemy turn (HP ' + s.heroHp + ')');
ok(said('strikes HERO'), 'battle log announces the goblin counterstrike');
ok(delays.indexOf(800) !== -1, 'enemies observe the 0.8s dramatic pause before striking');

// --- MAGIC: Arcane Spark, 10 MP, chrono magic damage on all enemies ---
Battle.playAgain();
flush();
const mpBefore = Battle.state().heroMp;
Battle.command('magic');
flush();
s = Battle.state();
eq(s.heroMp, mpBefore - 10, 'Arcane Spark costs 10 MP');
eq(s.enemies[0].hp, 45 - 34, 'calculateMagicDamage hits Goblin 0 for exactly 34');
eq(s.enemies[1].hp, 45 - 34, 'calculateMagicDamage hits Goblin 1 for exactly 34');
eq(s.phase, 'player', 'phase returns to the player after magic + enemy turn');
ok(said('Arcane Spark'), 'battle log names the spell Arcane Spark');

// --- ITEM: Arcane Crystal relic, +50 HP, green heal float ---
Battle.playAgain();
flush();

// Full HP: the relic is refused, no turn consumed
Battle.command('item');
s = Battle.state();
eq(registry['battle-message'].textContent, 'HP is already full!',
  'ITEM at full HP is refused with a message');
ok(registry['item-panel'].classList.contains('hidden'), 'item panel stays closed at full HP');
eq(s.turnCount, 0, 'refused ITEM consumes no turn');

// Take two enemy turns of damage, then heal with the relic
Battle.command('defend'); flush();
Battle.command('defend'); flush();
const hpBeforeItem = Battle.state().heroHp;
ok(hpBeforeItem < 120, 'hero is damaged before using the relic');

Battle.command('item');
ok(!registry['item-panel'].classList.contains('hidden'), 'ITEM opens the relic panel');
ok(said('ARCANE CRYSTAL'), 'panel prompt names the Arcane Crystal');

const expectedHeal = Math.min(50, 120 - hpBeforeItem);
registry['item-use'].click();
s = Battle.state();
eq(s.heroHp, Math.min(hpBeforeItem + 50, 120), 'relic restores 50 HP (clamped to maxHp)');
ok(registry['hero-unit'].children.some(c =>
  c.className.indexOf('float-number heal') !== -1 && c.textContent === '+' + expectedHeal),
  'green floating heal number (+' + expectedHeal + ') rises over the hero');
ok(registry['item-panel'].classList.contains('hidden'), 'relic panel hides after USE');
flush();
s = Battle.state();
eq(s.turnCount, 3, 'using the relic consumes the turn (enemy acted)');
eq(s.phase, 'player', 'phase returns to the player after relic + enemy turn');

// CANCEL closes the panel without healing or consuming a turn
Battle.playAgain();
flush();
Battle.command('defend'); flush();
const hpBeforeCancel = Battle.state().heroHp;
const turnsBeforeCancel = Battle.state().turnCount;
Battle.command('item');
registry['item-cancel'].click();
s = Battle.state();
ok(registry['item-panel'].classList.contains('hidden'), 'CANCEL closes the relic panel');
eq(s.heroHp, hpBeforeCancel, 'CANCEL does not heal');
eq(s.turnCount, turnsBeforeCancel, 'CANCEL consumes no turn');
eq(s.phase, 'player', 'CANCEL keeps the phase on player');

// --- DEFEND: 50% incoming damage reduction for one turn ---
Battle.playAgain();
flush();
const hpBeforeDefend = Battle.state().heroHp;
Battle.command('defend');
eq(Battle.state().defending, true, 'defend sets the defending flag');
flush();
s = Battle.state();
eq(s.defending, false, 'defending flag clears after the enemy turn');
eq(s.phase, 'player', 'phase returns to the player after defend + enemy turn');
const defendedDrop = hpBeforeDefend - s.heroHp;
ok(defendedDrop >= 6 && defendedDrop <= 8,
  'defended goblin strikes are halved to 3-4 each (drop ' + defendedDrop + ')');

// --- VICTORY (first win): fixed +45 EXP / +30 Gold banner, level-up ---
// No battle has been won yet, so the hero is still Lv1 with 0 EXP / 0 gold.
Battle.playAgain();
flush();
let guard = 0;
while (Battle.state().phase !== 'victory' && guard < 200) {
  guard++;
  const st = Battle.state();
  if (st.phase === 'target') {
    Battle.command('attack', st.enemies.findIndex(e => e.alive));
  } else if (st.phase === 'player') {
    Battle.command('attack');
  }
  flush();
}
s = Battle.state();
eq(s.phase, 'victory', 'repeated attacks eventually win the battle (guard=' + guard + ')');
ok(s.enemies.every(e => !e.alive), 'all goblins defeated at victory');
eq(s.lastExpGained, 45, 'victory awards 45 EXP');
eq(s.lastGoldGained, 30, 'victory awards 30 gold');
eq(s.heroGold, 30, 'hero gold updated to 30');
eq(s.heroExperience, 45, 'hero experience updated to 45');
eq(s.leveledUp, true, '45 EXP crosses the level threshold');
eq(s.heroLevel, 2, 'hero levels up to Lv2');
eq(s.heroMaxHp, 125, 'level-up raises maxHp 120 -> 125');
eq(s.heroPower, 16, 'level-up raises hero power 14 -> 16');
ok(!registry['victory-screen'].classList.contains('hidden'), 'victory overlay is shown');
const overlayLine = registry['victory-screen'].querySelector('.result-line');
ok(overlayLine.textContent.indexOf('+45 EXP and +30 Gold') !== -1,
  'victory banner displays "+45 EXP and +30 Gold"');
ok(overlayLine.textContent.indexOf('LEVEL UP') !== -1, 'victory banner announces LEVEL UP');
ok(registry['hero-level-text'].textContent.indexOf('LV 2') !== -1, 'HUD shows LV 2');
ok(registry['hero-gold-text'].textContent.indexOf('30 G') !== -1, 'HUD shows 30 G');

// Commands are inert after victory
const hpAtVictory = Battle.state().heroHp;
Battle.command('magic');
eq(Battle.state().heroHp, hpAtVictory, 'commands are ignored once the battle is over');

// --- playAgain: full combat reset, progression persists ---
Battle.playAgain();
flush();
s = Battle.state();
eq(s.phase, 'player', 'playAgain() recharges into a fresh player turn');
eq(s.heroHp, s.heroMaxHp, 'playAgain() restores hero HP to full (leveled maxHp)');
eq(s.heroMp, 45, 'playAgain() restores hero MP to full');
eq(s.enemies[0].hp, 45, 'playAgain() restores Goblin 0 to 45 HP');
eq(s.enemies[1].hp, 45, 'playAgain() restores Goblin 1 to 45 HP');
eq(s.heroLevel, 2, 'level progression persists across battles');
eq(s.heroPower, 16, 'leveled-up power persists into the next battle');
ok(registry['victory-screen'].classList.contains('hidden'), 'playAgain() hides the victory overlay');

// --- CRITICAL HITS: 2.0x chrono crits surface as golden CRIT! floats ---
// Crits are detected via the battle log (battle.js rolls the crit decision
// itself and passes it through the engine's forceCrit hook, so the
// announcement is exact). Bands are recomputed per strike from the CURRENT
// level (power grows +2 per level).
let critSeen = false;
let critBattles = 0;
while (!critSeen && critBattles < 60) {
  critBattles++;
  Battle.playAgain();
  flush();
  let g2 = 0;
  while (Battle.state().phase !== 'victory' && g2 < 200) {
    g2++;
    const st = Battle.state();
    if (st.phase === 'target') {
      const idx = st.enemies.findIndex(e => e.alive);
      const hpBefore = st.enemies[idx].hp;
      const b = heroBands(st.heroPower);
      Battle.command('attack', idx);
      const hpAfter = Battle.state().enemies[idx].hp;
      const dmg = hpBefore - hpAfter;
      const wasCrit = messageLog[messageLog.length - 1].indexOf('CRITICAL HIT') !== -1;
      if (wasCrit) {
        critSeen = true;
        if (hpAfter === 0) {
          // A crit that kills absorbs exactly the remaining HP.
          eq(dmg, hpBefore, 'critical killing blow absorbs the remaining HP (' + hpBefore + ')');
        } else {
          ok(inBand(dmg, b.crit),
            'critical hit doubles into the ' + b.crit[0] + '-' + b.crit[1] +
            ' band at power ' + st.heroPower + ' (got ' + dmg + ')');
        }
      } else if (hpAfter === 0) {
        // Killing blow: the hit absorbs exactly the remaining HP.
        eq(dmg, hpBefore, 'killing blow absorbs the remaining HP (' + hpBefore + ')');
      } else {
        ok(inBand(dmg, b.normal),
          'normal hit stays in the ' + b.normal[0] + '-' + b.normal[1] +
          ' band at power ' + st.heroPower + ' (got ' + dmg + ')');
      }
    } else if (st.phase === 'player') {
      Battle.command('attack');
    }
    flush();
  }
}
ok(critSeen, '2.0x critical hits occur across battles (15% crit rate)');

// --- DEFEAT: Hero Fallen + Retry Battle resets combat ---
Battle.playAgain(); // leave the crit-grind victory state before grinding
flush();
let defeatGuard = 0;
while (Battle.state().phase !== 'defeat' && defeatGuard < 500) {
  defeatGuard++;
  Battle.command('defend');
  flush();
}
s = Battle.state();
eq(s.phase, 'defeat', 'defend-only grind reaches defeat');
eq(s.heroHp, 0, 'hero HP reaches 0 at defeat');
ok(!registry['defeat-screen'].classList.contains('hidden'), 'defeat overlay is shown');
eq(registry['battle-message'].textContent, 'HERO has fallen...', 'defeat log reads "HERO has fallen..."');

registry['defeat-retry'].click();
flush();
s = Battle.state();
eq(s.phase, 'player', 'RETRY BATTLE resets into a fresh player turn');
eq(s.heroHp, s.heroMaxHp, 'retried battle starts at full HP');
eq(s.enemies[0].hp, 45, 'retried battle restores the goblins');

console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
