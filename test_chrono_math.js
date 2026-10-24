'use strict';
/*
 * FantasyQuest Chrono Trigger math engine tests.
 * Run: node test_chrono_math.js
 */
const engine = require('./chrono_battle_engine.js');

let passed = 0;
let failed = 0;
function assert(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('PASS: ' + name);
  } else {
    failed++;
    console.log('FAIL: ' + name + (detail ? ' -- ' + detail : ''));
  }
}

const hero = { power: 12, weapon_attack: 4, magic: 12, crit_rate: 0.15 };
const goblin = { defense: 6, magic_defense: 4 };

// 1. Level 1 Hero vs Forest Goblin: non-crit hits land in the 14-22 band.
//    (Crits are exercised separately in assertions 3-4.)
(function () {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const d = engine.calculatePhysicalDamage(hero, goblin, { forceCrit: false });
    if (d < min) min = d;
    if (d > max) max = d;
  }
  assert('Hero vs Forest Goblin damage in 14-22 range',
    min >= 14 && max <= 22, 'min=' + min + ' max=' + max);
})();

// 2. Variance stays inside the 0.94-1.06 band (base 15.5 -> 14.57-16.43 -> 14-16 floored).
(function () {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const d = engine.calculatePhysicalDamage(hero, goblin, { forceCrit: false });
    if (d < min) min = d;
    if (d > max) max = d;
  }
  assert('Variance band never leaves 14-16 (0.94x-1.06x of base 15.5)',
    min >= 14 && max <= 16, 'min=' + min + ' max=' + max);
})();

// 3. Critical hit exactly doubles base damage (no variance, forced crit).
(function () {
  const normal = engine.calculatePhysicalDamage(hero, goblin, { forceCrit: false, noVariance: true });
  const crit = engine.calculatePhysicalDamage(hero, goblin, { forceCrit: true, noVariance: true });
  assert('Critical hit doubles base damage (2.0x)', crit === normal * 2,
    'normal=' + normal + ' crit=' + crit);
})();

// 4. Default crit rate is 15% when attacker has no crit_rate field.
(function () {
  const noCritHero = { power: 30, weapon_attack: 10 };
  let crits = 0;
  const trials = 20000;
  for (let i = 0; i < trials; i++) {
    const crit = engine.calculatePhysicalDamage(noCritHero, goblin) >
      Math.floor((30 * 4 / 3 + 10 * 5 / 8 - 3) * 1.06 * 1.5);
    if (crit) crits++;
  }
  const rate = crits / trials;
  assert('Default crit rate ~15% (observed ' + (rate * 100).toFixed(1) + '%)',
    rate > 0.12 && rate < 0.18, 'rate=' + rate);
})();

// 5. Magic damage formula: (12*4/3) + (8*2.5) - (4*0.4) = 16 + 20 - 1.6 = 34 (floored).
(function () {
  const d = engine.calculateMagicDamage(hero, goblin, 8);
  assert('Magic damage matches formula (34 for magic 12, power 8, mdef 4)', d === 34, 'd=' + d);
})();

// 6. High enemy magic defense cannot push magic damage below 1.
(function () {
  const ironGolem = { defense: 500, magic_defense: 500 };
  const d = engine.calculateMagicDamage(hero, ironGolem, 1);
  assert('Magic damage floors at 1 against huge magic defense', d >= 1, 'd=' + d);
})();

// 7. High enemy defense cannot push physical damage below 1.
(function () {
  const ironGolem = { defense: 500, magic_defense: 500 };
  let min = Infinity;
  for (let i = 0; i < 1000; i++) {
    const d = engine.calculatePhysicalDamage(hero, ironGolem);
    if (d < min) min = d;
  }
  assert('Physical damage floors at 1 against huge defense', min === 1, 'min=' + min);
})();

// 8. FIRE_WHIRL Dual Tech beats two solo attacks by the combo multipliers.
(function () {
  const crono = { power: 20, weapon_attack: 8, crit_rate: 0 };
  const lucca = { magic: 18, spell_power: 9 };
  let soloTotal = 0, dualTotal = 0;
  for (let i = 0; i < 500; i++) {
    soloTotal += engine.calculatePhysicalDamage(crono, goblin) +
      engine.calculateMagicDamage(lucca, goblin, 9);
    dualTotal += engine.calculateDualTechDamage(crono, lucca, goblin, 'FIRE_WHIRL');
  }
  const soloAvg = soloTotal / 500;
  const dualAvg = dualTotal / 500;
  assert('FIRE_WHIRL avg (' + dualAvg.toFixed(1) + ') significantly beats two solos (' + soloAvg.toFixed(1) + ')',
    dualAvg > soloAvg * 1.35, 'solo=' + soloAvg + ' dual=' + dualAvg);
})();

// 9. ATB: speed 16 fills the 100-point gauge in exactly one tick.
(function () {
  const tick = engine.calculateATBTick(16);
  assert('Speed 16 fills ATB gauge (100 pts) in one tick', tick === 100, 'tick=' + tick);
})();

// 10. ATB fills proportionally: speed 16 is twice speed 8, and faster is always ahead.
(function () {
  const t16 = engine.calculateATBTick(16);
  const t8 = engine.calculateATBTick(8);
  const t4 = engine.calculateATBTick(4);
  const t1 = engine.calculateATBTick(1);
  assert('ATB fill scales proportionally with speed (16 = 2x 8 = 4x 4 = 16x 1)',
    t16 === 2 * t8 && t8 === 2 * t4 && t16 === 16 * t1 &&
      t16 > t8 && t8 > t4 && t4 > t1,
    't16=' + t16 + ' t8=' + t8 + ' t4=' + t4 + ' t1=' + t1);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed, out of 10');
if (failed > 0) process.exit(1);
