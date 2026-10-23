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
 */
(function (root) {
    'use strict';

    var Progression = (function () {

    var LEVEL_THRESHOLDS = [0, 20, 50, 100, 180, 300, 480];
    var HP_PER_LEVEL = 5;
    var ATTACK_PER_LEVEL = 2;

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

    return {
        LEVEL_THRESHOLDS: LEVEL_THRESHOLDS,
        HP_PER_LEVEL: HP_PER_LEVEL,
        ATTACK_PER_LEVEL: ATTACK_PER_LEVEL,
        calculateLevel: calculateLevel,
        experienceToNextLevel: experienceToNextLevel,
        gainExperience: gainExperience
    };
    })();

    root.Progression = Progression;
    if (typeof window !== 'undefined') {
        window.Progression = Progression;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
