/*
 * FantasyQuest - progression module (Phase 9: EXP & Leveling).
 * Owns all character-growth math so battle.js only needs to call
 * Progression.gainExperience() and read back level-up results.
 *
 * Public API (window.Progression):
 *   LEVEL_THRESHOLDS                 EXP required to REACH each level (index = level - 1)
 *   calculateLevel(experience)       level a total EXP value maps to
 *   experienceToNextLevel(experience) EXP needed for next level, or null at max
 *   gainExperience(hero, amount)     add EXP to a hero object, apply level-ups, return { leveledUp, levelsGained }
 *   POTION_HEAL / POTION_PRICE       potion restore amount and shop price
 *   STARTING_POTIONS                 potions a new profile begins with
 *   initProfileVitals(profile)       add persistent hp (starts at maxHp) and potions
 *                                    (starts at STARTING_POTIONS) if missing; idempotent
 *   buyPotion(profile)               gold >= POTION_PRICE: pay and gain a potion -> true
 *   usePotion(profile)               has potions and missing HP: heal (clamped) -> true
 */
(function (root) {
    'use strict';

    var Progression = (function () {

    var LEVEL_THRESHOLDS = [0, 20, 50, 100, 180, 300, 480];
    var HP_PER_LEVEL = 5;
    var ATTACK_PER_LEVEL = 2;

    // Phase 12: shop potions and persistent hero vitals.
    var POTION_HEAL = 30;
    var POTION_PRICE = 15;
    var STARTING_POTIONS = 1;

    function calculateLevel(experience) {
        var level = 1;
        for (var i = 0; i < LEVEL_THRESHOLDS.length; i++) {
            if (experience >= LEVEL_THRESHOLDS[i]) {
                level = i + 1;
            }
        }
        return level;
    }

    function experienceToNextLevel(experience) {
        var level = calculateLevel(experience);
        if (level >= LEVEL_THRESHOLDS.length) {
            return null;
        }
        return LEVEL_THRESHOLDS[level] - experience;
    }

    function gainExperience(hero, amount) {
        hero.experience += amount;

        var levelsGained = 0;
        while (calculateLevel(hero.experience) > hero.level) {
            hero.level += 1;
            hero.maxHp += HP_PER_LEVEL;
            hero.attackDamage += ATTACK_PER_LEVEL;
            hero.hp = hero.maxHp;
            levelsGained += 1;
        }

        return {
            leveledUp: levelsGained > 0,
            levelsGained: levelsGained
        };
    }

    /*
     * initProfileVitals(profile) -> profile.
     * Extends a hero profile with the Phase 12 persistent vitals:
     * current hp (starts at maxHp) and a potion count (starts at
     * STARTING_POTIONS). Idempotent: existing values are never reset,
     * so hp and potions persist across battles.
     */
    function initProfileVitals(profile) {
        if (typeof profile.hp !== 'number') {
            profile.hp = profile.maxHp;
        }
        if (typeof profile.potions !== 'number') {
            profile.potions = STARTING_POTIONS;
        }
        return profile;
    }

    /*
     * buyPotion(profile) -> true | false.
     * On success (gold >= POTION_PRICE): pays the price, adds one potion.
     * On failure: returns false and leaves the profile untouched.
     */
    function buyPotion(profile) {
        if (typeof profile.gold !== 'number' || profile.gold < POTION_PRICE) {
            return false;
        }
        profile.gold -= POTION_PRICE;
        profile.potions = (profile.potions || 0) + 1;
        return true;
    }

    /*
     * usePotion(profile) -> true | false.
     * On success (has at least one potion and missing HP): consumes a
     * potion and restores POTION_HEAL hp, clamped to maxHp.
     * On failure (no potions, or already at full HP): returns false and
     * leaves the profile untouched.
     */
    function usePotion(profile) {
        if (!profile.potions || profile.hp >= profile.maxHp) {
            return false;
        }
        profile.potions -= 1;
        profile.hp = Math.min(profile.maxHp, profile.hp + POTION_HEAL);
        return true;
    }

    return {
        LEVEL_THRESHOLDS: LEVEL_THRESHOLDS,
        HP_PER_LEVEL: HP_PER_LEVEL,
        ATTACK_PER_LEVEL: ATTACK_PER_LEVEL,
        POTION_HEAL: POTION_HEAL,
        POTION_PRICE: POTION_PRICE,
        STARTING_POTIONS: STARTING_POTIONS,
        calculateLevel: calculateLevel,
        experienceToNextLevel: experienceToNextLevel,
        gainExperience: gainExperience,
        initProfileVitals: initProfileVitals,
        buyPotion: buyPotion,
        usePotion: usePotion
    };
    })();

    root.Progression = Progression;
    if (typeof window !== 'undefined') {
        window.Progression = Progression;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
