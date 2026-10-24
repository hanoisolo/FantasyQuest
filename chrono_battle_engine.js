'use strict';
/*
 * Chrono Trigger combat math engine (reverse-engineered) for FantasyQuest.
 * Formulas model CT's Katana/Melee base damage, magic damage, and Dual Tech
 * combos, with 16-bit-style integer output and a 100-point ATB gauge.
 */

// Standard 16-bit variance band applied to physical hits.
const VARIANCE_MIN = 0.94;
const VARIANCE_MAX = 1.06;
const ATB_GAUGE_MAX = 100;

function rollVariance() {
  return VARIANCE_MIN + Math.random() * (VARIANCE_MAX - VARIANCE_MIN);
}

/**
 * Physical (Katana/Melee) damage.
 * Base = (power * 4/3) + (weapon_attack * 5/8), mitigated by
 * (defense * 0.5), with 0.94-1.06 variance and 2.0x critical hits.
 * opts.forceCrit and opts.noVariance exist for deterministic testing.
 */
function calculatePhysicalDamage(attacker, defender, opts) {
  opts = opts || {};
  const base =
    (attacker.power * 4 / 3) +
    (attacker.weapon_attack * 5 / 8) -
    (defender.defense * 0.5);

  const isCrit = opts.forceCrit === true ||
    (opts.forceCrit === undefined &&
      Math.random() < (attacker.crit_rate !== undefined ? attacker.crit_rate : 0.15));

  let damage = opts.noVariance ? base : base * rollVariance();
  damage = Math.floor(damage);
  if (isCrit) damage *= 2.0;

  return damage < 1 ? 1 : damage;
}

/**
 * Magic damage.
 * Base = (magic * 4/3) + (spellPower * 2.5) - (magic_defense * 0.4).
 */
function calculateMagicDamage(caster, defender, spellPower) {
  const base =
    (caster.magic * 4 / 3) +
    (spellPower * 2.5) -
    (defender.magic_defense * 0.4);

  const damage = Math.floor(base);
  return damage < 1 ? 1 : damage;
}

/**
 * Dual Tech combo damage.
 * FIRE_WHIRL: charA's physical attack (x1.2) plus charB's magic
 * attack (x1.4), with a 1.15x combo bonus on the total.
 * charB.spell_power (default 10) supplies the magic component's power.
 */
function calculateDualTechDamage(charA, charB, defender, techType, opts) {
  opts = opts || {};
  if (techType === 'FIRE_WHIRL') {
    const physicalPart = calculatePhysicalDamage(charA, defender, opts) * 1.2;
    const magicPart =
      calculateMagicDamage(charB, defender, charB.spell_power !== undefined ? charB.spell_power : 10) * 1.4;
    return Math.floor((physicalPart + magicPart) * 1.15);
  }
  throw new Error('Unknown tech type: ' + techType);
}

/**
 * ATB gauge fill per tick for a speed stat (1-16).
 * 100 gauge points = turn ready; speed 16 fills the whole gauge in one tick.
 */
function calculateATBTick(speedStat) {
  const speed = Math.max(1, Math.min(16, speedStat));
  return (speed / 16) * ATB_GAUGE_MAX;
}

// Dual export: CommonJS for Node (test_chrono_math.js), window global
// for the browser (battle.js reads window.ChronoEngine in a <script> tag).
const ChronoEngine = {
  calculatePhysicalDamage,
  calculateMagicDamage,
  calculateDualTechDamage,
  calculateATBTick,
  ATB_GAUGE_MAX,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChronoEngine;
} else if (typeof window !== 'undefined') {
  window.ChronoEngine = ChronoEngine;
} else if (typeof globalThis !== 'undefined') {
  globalThis.ChronoEngine = ChronoEngine;
}
