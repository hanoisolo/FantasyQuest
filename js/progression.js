// progression.js
// Handles everything related to character growth: experience points
// and leveling up. Kept in its own file so combat code does not need
// to know HOW levels are calculated, only THAT experience was gained.
//
// This file is loaded before main.js (see index.html), so the global
// object below exists by the time the game loop runs.
window.Progression = (function() {
    'use strict';

    // EXP required to REACH each level. Index = level - 1.
    // Level 1 needs 0 EXP (you start there), level 2 at 20 EXP, etc.
    const LEVEL_THRESHOLDS = [0, 20, 50, 100, 180, 300, 480];

    // How much the hero grows per level-up. Classic NES-style gains.
    const HP_PER_LEVEL = 5;
    const ATTACK_PER_LEVEL = 2;

    // Returns the level a player should be, given their total experience.
    function calculateLevel(experience) {
        let level = 1;
        for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
            if (experience >= LEVEL_THRESHOLDS[i]) {
                level = i + 1;
            }
        }
        return level;
    }

    // Returns EXP needed for the NEXT level, or null if max level.
    function experienceToNextLevel(experience) {
        const level = calculateLevel(experience);
        if (level >= LEVEL_THRESHOLDS.length) {
            return null;
        }
        return LEVEL_THRESHOLDS[level] - experience;
    }

    // Adds experience and applies any resulting level-ups directly to
    // the player object. Returns true if the player leveled up.
    function gainExperience(player, amount) {
        player.experience += amount;

        let leveledUp = false;
        while (calculateLevel(player.experience) > player.level) {
            player.level++;
            player.maxHP += HP_PER_LEVEL;
            player.attackPower += ATTACK_PER_LEVEL;
            // Full heal on level-up, a classic Dragon Warrior touch.
            player.currentHP = player.maxHP;
            leveledUp = true;
        }

        return leveledUp;
    }

    return {
        LEVEL_THRESHOLDS: LEVEL_THRESHOLDS,
        calculateLevel: calculateLevel,
        experienceToNextLevel: experienceToNextLevel,
        gainExperience: gainExperience
    };
})();
