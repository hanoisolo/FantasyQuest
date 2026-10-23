/*
 * FantasyQuest — Pass 1 turn-based battle engine.
 * Renders the battle arena as DOM (arena backdrop, hero bust, enemy
 * silhouettes, bars, command menu, floating damage numbers) so the whole
 * flow can be driven programmatically.
 *
 * Public API (window.Battle):
 *   init()                     wire the battle scene (idempotent)
 *   command(name, targetIndex) 'attack' | 'magic' | 'item' | 'defend' | ...
 *   state()                    snapshot for UI and tests
 *   playAgain()                reset and restart the battle
 */
var Battle = (function () {
    'use strict';

    var CONFIG = {
        hero: { name: 'HERO', maxHp: 120, maxMp: 45, attackDamage: 28 },
        enemies: [
            { id: 'goblin', name: 'FOREST GOBLIN', maxHp: 55, atkMin: 8, atkMax: 13, art: 'goblin', expReward: 25, goldReward: 18 },
            { id: 'wolf', name: 'SHADOW WOLF', maxHp: 45, atkMin: 10, atkMax: 15, art: 'wolf', expReward: 20, goldReward: 12 }
        ],
        magic: { name: 'Arcane Spark', cost: 10, damage: 20 },
        enemyTurnDelayMs: 800,
        enemyStrikeGapMs: 600
    };

    var S = null; // battle state
    var el = {};  // cached DOM nodes
    var wired = false;

    // Optional encounter filter (Phase 11): when set, only enemies with a
    // matching id spawn. null spawns the full roster (default behavior).
    var activeEnemyIds = null;

    // Persistent hero profile across battles (Phase 9/10 progression).
    // HP/MP are refilled at the start of each battle; level, EXP, gold,
    // maxHp and attackDamage carry over and grow via level-ups.
    var profile = null;

    function freshProfile() {
        var p = {
            level: 1,
            experience: 0,
            gold: 0,
            maxHp: CONFIG.hero.maxHp,
            maxMp: CONFIG.hero.maxMp,
            attackDamage: CONFIG.hero.attackDamage
        };
        // Phase 12: persistent vitals. A brand-new profile starts at full
        // HP with 1 potion; afterwards hp/potions carry across battles.
        if (window.Progression && window.Progression.initProfileVitals) {
            window.Progression.initProfileVitals(p);
        } else {
            p.hp = p.maxHp;
            p.potions = 0;
        }
        return p;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    function freshState() {
        if (!profile) {
            profile = freshProfile();
        }
        return {
            phase: 'player', // player | target | enemy | victory | defeat
            hero: {
                name: CONFIG.hero.name,
                // Phase 12: battles start from the profile's persistent HP
                // (no full heal at battle start); MP still refills.
                hp: profile.hp !== undefined ? profile.hp : profile.maxHp,
                maxHp: profile.maxHp,
                mp: profile.maxMp,
                maxMp: profile.maxMp,
                attackDamage: profile.attackDamage,
                potions: profile.potions !== undefined ? profile.potions : 0,
                defending: false,
                // Phase 9/10 progression (persists across battles via profile)
                level: profile.level,
                experience: profile.experience,
                gold: profile.gold
            },
            enemies: CONFIG.enemies.filter(function (e) {
                return !activeEnemyIds || activeEnemyIds.indexOf(e.id) !== -1;
            }).map(function (e) {
                return { id: e.id, name: e.name, hp: e.maxHp, maxHp: e.maxHp };
            }),
            turnCount: 0,
            // Rewards granted on victory (computed in showVictory)
            lastExpGained: 0,
            lastGoldGained: 0,
            leveledUp: false
        };
    }

    function syncProfileFromHero() {
        if (!profile || !S) {
            return;
        }
        profile.level = S.hero.level;
        profile.experience = S.hero.experience;
        profile.gold = S.hero.gold;
        profile.maxHp = S.hero.maxHp;
        profile.attackDamage = S.hero.attackDamage;
        // Phase 12: persistent vitals written back on victory so the next
        // battle (and the overworld) resume from the hero's current state.
        profile.hp = S.hero.hp;
        profile.potions = S.hero.potions;
    }

    function state() {
        if (!S) {
            return null;
        }
        return {
            phase: S.phase,
            heroHp: S.hero.hp,
            heroMaxHp: S.hero.maxHp,
            heroMp: S.hero.mp,
            heroMaxMp: S.hero.maxMp,
            heroAttackDamage: S.hero.attackDamage,
            defending: S.hero.defending,
            heroPotions: S.hero.potions,
            turnCount: S.turnCount,
            heroLevel: S.hero.level,
            heroExperience: S.hero.experience,
            heroGold: S.hero.gold,
            lastExpGained: S.lastExpGained,
            lastGoldGained: S.lastGoldGained,
            leveledUp: S.leveledUp,
            enemies: S.enemies.map(function (e) {
                return { id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, alive: e.hp > 0 };
            })
        };
    }

    // ------------------------------------------------------------------
    // DOM helpers
    // ------------------------------------------------------------------

    function $(id) {
        return document.getElementById(id);
    }

    function floatNumber(anchor, text, kind) {
        var num = document.createElement('div');
        num.className = 'float-number ' + (kind || 'damage');
        num.textContent = text;
        anchor.appendChild(num);
        window.setTimeout(function () {
            if (num.parentNode) {
                num.parentNode.removeChild(num);
            }
        }, 1000);
    }

    function say(text) {
        if (el.message) {
            el.message.textContent = text;
        }
    }

    function pct(value, max) {
        return Math.max(0, Math.min(100, (value / max) * 100)) + '%';
    }

    // Pixel-art SVG silhouettes with glowing red eyes.
    // Served as fallback art when an enemy sprite image fails to load.
    function silhouetteSVG(kind) {
        var eyes = '<circle class="eye" cx="16" cy="18" r="2.2"/><circle class="eye" cx="24" cy="18" r="2.2"/>';
        var body = '';
        if (kind === 'goblin') {
            body =
                '<path d="M8 30 L4 18 L10 14 L8 8 L14 10 L16 4 L18 10 L24 8 L22 14 L28 18 L24 30 Z" class="sil-body"/>' +
                '<path d="M10 30 L12 34 L22 34 L24 30 Z" class="sil-body"/>';
        } else {
            body =
                '<path d="M6 26 L10 14 L16 10 L22 12 L28 8 L30 14 L26 16 L28 26 L24 26 L22 18 L16 20 L12 26 Z" class="sil-body"/>' +
                '<path d="M8 30 L10 33 L14 33 L15 30 Z" class="sil-body"/>';
            eyes = '<circle class="eye" cx="13" cy="14" r="1.8"/><circle class="eye" cx="19" cy="14" r="1.8"/>';
        }
        return (
            '<svg viewBox="0 0 32 36" class="sil" preserveAspectRatio="xMidYMid meet">' +
            '<g class="sil-group">' + body + eyes + '</g></svg>'
        );
    }

    function buildEnemyUnit(cfg, index) {
        var unit = document.createElement('div');
        unit.className = 'enemy-unit';
        unit.setAttribute('data-index', String(index));
        unit.setAttribute('data-enemy-id', cfg.id);

        // Sprite layer: shows assets/sprites/<id>_battle.png, and falls back
        // to the styled silhouette if the image fails to load.
        var art = document.createElement('div');
        art.className = 'enemy-art';
        art.innerHTML = silhouetteSVG(cfg.art);

        var sprite = document.createElement('img');
        sprite.className = 'enemy-sprite';
        sprite.alt = cfg.name;
        sprite.src = 'assets/sprites/' + cfg.id + '_battle.png';
        sprite.addEventListener('error', function () {
            art.classList.add('sprite-failed');
        });
        art.appendChild(sprite);
        unit.appendChild(art);

        var nameEl = document.createElement('div');
        nameEl.className = 'enemy-name';
        nameEl.textContent = cfg.name;
        unit.appendChild(nameEl);

        var bar = document.createElement('div');
        bar.className = 'bar hp';
        var fill = document.createElement('div');
        fill.className = 'bar-fill';
        bar.appendChild(fill);
        unit.appendChild(bar);

        var label = document.createElement('div');
        label.className = 'bar-label';
        unit.appendChild(label);

        unit.addEventListener('click', function () {
            onEnemyClicked(index);
        });
        return unit;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    function render() {
        if (!S) {
            return;
        }

        // Hero bars
        el.heroHpFill.style.width = pct(S.hero.hp, S.hero.maxHp);
        el.heroMpFill.style.width = pct(S.hero.mp, S.hero.maxMp);
        el.heroHpText.textContent = S.hero.hp + '/' + S.hero.maxHp;
        el.heroMpText.textContent = S.hero.mp + '/' + S.hero.maxMp;
        el.heroUnit.classList.toggle('defending', S.hero.defending);
        el.turnIndicator.classList.toggle('active', S.phase === 'player');

        if (el.heroLevelText) {
            var expToNext = window.Progression
                ? window.Progression.experienceToNextLevel(S.hero.experience)
                : null;
            el.heroLevelText.textContent = 'LV ' + S.hero.level +
                (expToNext !== null ? '  EXP ' + S.hero.experience + ' (next ' + expToNext + ')' : '  MAX');
        }
        if (el.heroGoldText) {
            el.heroGoldText.textContent = S.hero.gold + ' G';
        }

        // Enemy units
        var units = el.enemyRow.querySelectorAll('.enemy-unit');
        for (var i = 0; i < units.length; i++) {
            var unit = units[i];
            var idx = Number(unit.getAttribute('data-index'));
            var enemy = S.enemies[idx];
            unit.querySelector('.bar-fill').style.width = pct(enemy.hp, enemy.maxHp);
            unit.querySelector('.bar-label').textContent = Math.max(0, enemy.hp) + '/' + enemy.maxHp;
            unit.classList.toggle('defeated', enemy.hp <= 0);
            unit.classList.toggle('targetable', S.phase === 'target' && enemy.hp > 0);
        }

        // Command menu availability
        var commands = ['attack', 'magic', 'item', 'defend'];
        for (var c = 0; c < commands.length; c++) {
            var btn = el.commands[commands[c]];
            if (btn) {
                btn.disabled = S.phase !== 'player';
            }
        }
    }

    // ------------------------------------------------------------------
    // Turn flow
    // ------------------------------------------------------------------

    function command(name, targetIndex) {
        if (!S || S.phase === 'victory' || S.phase === 'defeat') {
            return;
        }
        if (name === 'attack') {
            if (S.phase === 'target') {
                // A target index was passed programmatically; otherwise wait for click.
                if (typeof targetIndex === 'number') {
                    doAttack(targetIndex);
                }
                return;
            }
            if (S.phase !== 'player') {
                return;
            }
            enterTargeting();
        } else if (name === 'magic') {
            if (S.phase !== 'player') {
                return;
            }
            doMagic();
        } else if (name === 'item') {
            if (S.phase !== 'player') {
                return;
            }
            doItem();
        } else if (name === 'defend') {
            if (S.phase !== 'player') {
                return;
            }
            doDefend();
        }
    }

    function enterTargeting() {
        if (aliveEnemies() === 0) {
            return;
        }
        S.phase = 'target';
        say('Choose a target!');
        RetroAudio.beep();
        render();
    }

    function onEnemyClicked(index) {
        if (S.phase !== 'target') {
            return;
        }
        var enemy = S.enemies[index];
        if (!enemy || enemy.hp <= 0) {
            return;
        }
        doAttack(index);
    }

    function doAttack(index) {
        var enemy = S.enemies[index];
        if (!enemy || enemy.hp <= 0) {
            return;
        }
        S.phase = 'resolving';
        var damage = S.hero.attackDamage;
        enemy.hp = Math.max(0, enemy.hp - damage);

        var unit = el.enemyRow.querySelector('[data-index="' + index + '"]');
        unit.classList.add('slash-hit');
        window.setTimeout(function () {
            unit.classList.remove('slash-hit');
        }, 450);

        RetroAudio.slash();
        floatNumber(unit, '-' + damage, 'damage');
        say('HERO attacks ' + enemy.name + '!');
        render();
        window.setTimeout(checkAfterPlayerAction, 350);
    }

    function doMagic() {
        if (S.hero.mp < CONFIG.magic.cost) {
            say('Not enough MP!');
            RetroAudio.beep();
            return;
        }
        S.phase = 'resolving';
        S.hero.mp -= CONFIG.magic.cost;

        el.arena.classList.add('magic-flash');
        window.setTimeout(function () {
            el.arena.classList.remove('magic-flash');
        }, 450);

        RetroAudio.sparkle();
        for (var i = 0; i < S.enemies.length; i++) {
            var enemy = S.enemies[i];
            if (enemy.hp <= 0) {
                continue;
            }
            enemy.hp = Math.max(0, enemy.hp - CONFIG.magic.damage);
            var unit = el.enemyRow.querySelector('[data-index="' + i + '"]');
            floatNumber(unit, '-' + CONFIG.magic.damage, 'magic');
        }
        say('HERO casts ' + CONFIG.magic.name + '!');
        render();
        window.setTimeout(checkAfterPlayerAction, 350);
    }

    function doDefend() {
        S.phase = 'resolving';
        S.hero.defending = true;
        say('HERO braces for impact! (damage halved this turn)');
        RetroAudio.beep();
        render();
        window.setTimeout(endPlayerTurn, 350);
    }

    /*
     * ITEM command (Phase 12): uses a potion from the persistent inventory,
     * same immediate-effect pattern as MAGIC. With no potions (or no
     * progression module) it only shows a message and consumes no turn.
     */
    function doItem() {
        if (!S.hero.potions || S.hero.potions <= 0) {
            say('No potions!');
            RetroAudio.beep();
            return;
        }
        if (!window.Progression || !window.Progression.usePotion) {
            say('No potions!');
            RetroAudio.beep();
            return;
        }
        var before = S.hero.hp;
        if (!window.Progression.usePotion(S.hero)) {
            say('HP is already full!');
            RetroAudio.beep();
            return;
        }
        var healed = S.hero.hp - before;
        S.phase = 'resolving';
        RetroAudio.drink(); // Phase 12 potion drink tone
        floatNumber(el.heroUnit, '+' + healed, 'heal');
        say('HERO drinks a potion! Restores ' + healed + ' HP.');
        render();
        window.setTimeout(checkAfterPlayerAction, 350); // consumes the turn
    }

    function checkAfterPlayerAction() {
        if (aliveEnemies() === 0) {
            showVictory();
            return;
        }
        endPlayerTurn();
    }

    function endPlayerTurn() {
        if (S.phase === 'victory' || S.phase === 'defeat') {
            return;
        }
        S.phase = 'enemy';
        S.turnCount += 1;
        say('The enemies prepare to strike...');
        render();

        window.setTimeout(function () {
            enemyTurn(0);
        }, CONFIG.enemyTurnDelayMs);
    }

    function enemyTurn(index) {
        if (S.phase !== 'enemy') {
            return;
        }
        var alive = S.enemies.filter(function (e) {
            return e.hp > 0;
        });
        if (index >= S.enemies.length) {
            finishEnemyTurn();
            return;
        }
        var enemy = S.enemies[index];
        if (enemy.hp > 0) {
            // Look up stats by id so filtered encounter rosters stay correct.
            var cfg = null;
            for (var c = 0; c < CONFIG.enemies.length; c++) {
                if (CONFIG.enemies[c].id === enemy.id) {
                    cfg = CONFIG.enemies[c];
                    break;
                }
            }
            var dmg = cfg.atkMin +
                Math.floor(Math.random() * (cfg.atkMax - cfg.atkMin + 1));
            if (S.hero.defending) {
                dmg = Math.max(1, Math.floor(dmg / 2));
            }
            S.hero.hp = Math.max(0, S.hero.hp - dmg);

            el.frame.classList.add('screen-shake');
            window.setTimeout(function () {
                el.frame.classList.remove('screen-shake');
            }, 350);

            floatNumber(el.heroUnit, '-' + dmg, 'damage');
            say(enemy.name + ' attacks HERO for ' + dmg + '!');
            render();

            if (S.hero.hp <= 0) {
                window.setTimeout(showDefeat, 500);
                return;
            }
        }
        window.setTimeout(function () {
            enemyTurn(index + 1);
        }, CONFIG.enemyStrikeGapMs);
    }

    function finishEnemyTurn() {
        if (S.phase !== 'enemy') {
            return;
        }
        S.hero.defending = false;
        S.phase = 'player';
        say('HERO\'s turn!');
        render();
    }

    // ------------------------------------------------------------------
    // Victory / defeat
    // ------------------------------------------------------------------

    function aliveEnemies() {
        return S.enemies.filter(function (e) {
            return e.hp > 0;
        }).length;
    }

    function computeRewards() {
        var exp = 0;
        var gold = 0;
        for (var i = 0; i < S.enemies.length; i++) {
            var cfg = null;
            for (var c = 0; c < CONFIG.enemies.length; c++) {
                if (CONFIG.enemies[c].id === S.enemies[i].id) {
                    cfg = CONFIG.enemies[c];
                    break;
                }
            }
            if (cfg) {
                exp += cfg.expReward || 0;
                gold += cfg.goldReward || 0;
            }
        }
        return { exp: exp, gold: gold };
    }

    function showVictory() {
        S.phase = 'victory';

        var rewards = computeRewards();
        S.lastExpGained = rewards.exp;
        S.lastGoldGained = rewards.gold;

        S.hero.gold += rewards.gold;

        var result = { leveledUp: false, levelsGained: 0 };
        if (window.Progression) {
            result = window.Progression.gainExperience(S.hero, rewards.exp);
        } else {
            S.hero.experience += rewards.exp;
        }
        S.leveledUp = result.leveledUp;

        syncProfileFromHero();

        var overlayLine = el.victoryScreen.querySelector('.result-line');
        if (overlayLine) {
            var line = '+' + rewards.exp + ' EXP and +' + rewards.gold + ' Gold';
            if (result.leveledUp) {
                line += ' - LEVEL UP! Now Lv ' + S.hero.level + '!';
            }
            overlayLine.textContent = line;
        }

        el.victoryScreen.classList.remove('hidden');
        RetroAudio.fanfare();
        say(result.leveledUp
            ? 'VICTORY! You reached Lv ' + S.hero.level + '! (+' + rewards.exp + ' EXP, +' + rewards.gold + 'G)'
            : 'The forest falls silent... VICTORY! (+' + rewards.exp + ' EXP, +' + rewards.gold + 'G)');
        render();
    }

    function showDefeat() {
        S.phase = 'defeat';
        el.defeatScreen.classList.remove('hidden');
        RetroAudio.gameOver();
        say('HERO has fallen...');
        render();
    }

    function playAgain() {
        el.victoryScreen.classList.add('hidden');
        el.defeatScreen.classList.add('hidden');
        start();
    }

    /*
     * Phase 12: the live hero profile (gold, potions, hp, progression) so
     * the overworld HUD and shop can transact against the same object the
     * battle engine uses. Lazily creates the profile.
     */
    function getProfile() {
        if (!profile) {
            profile = freshProfile();
        }
        return profile;
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    function cacheDom() {
        el.arena = $('battle-arena');
        el.frame = $('scene-battle');
        el.enemyRow = $('enemy-row');
        el.heroUnit = $('hero-unit');
        el.heroHpFill = $('hero-hp-fill');
        el.heroMpFill = $('hero-mp-fill');
        el.heroHpText = $('hero-hp-text');
        el.heroMpText = $('hero-mp-text');
        el.heroLevelText = $('hero-level-text');
        el.heroGoldText = $('hero-gold-text');
        el.turnIndicator = $('turn-indicator');
        el.message = $('battle-message');
        el.victoryScreen = $('victory-screen');
        el.defeatScreen = $('defeat-screen');
        el.commands = {
            attack: $('cmd-attack'),
            magic: $('cmd-magic'),
            item: $('cmd-item'),
            defend: $('cmd-defend')
        };
    }

    function wire() {
        if (wired) {
            return;
        }
        wired = true;
        el.commands.attack.addEventListener('click', function () {
            command('attack');
        });
        el.commands.magic.addEventListener('click', function () {
            command('magic');
        });
        el.commands.item.addEventListener('click', function () {
            command('item');
        });
        el.commands.defend.addEventListener('click', function () {
            command('defend');
        });
        $('victory-again').addEventListener('click', playAgain);
        $('defeat-retry').addEventListener('click', playAgain);
    }

    function start() {
        S = freshState();
        el.enemyRow.innerHTML = '';
        CONFIG.enemies
            .filter(function (e) {
                return !activeEnemyIds || activeEnemyIds.indexOf(e.id) !== -1;
            })
            .forEach(function (cfg, i) {
                el.enemyRow.appendChild(buildEnemyUnit(cfg, i));
            });
        el.victoryScreen.classList.add('hidden');
        el.defeatScreen.classList.add('hidden');
        if (activeEnemyIds && S.enemies.length === 1) {
            say('A wild ' + S.enemies[0].name + ' blocks the path!');
        } else {
            say('A Forest Goblin and a Shadow Wolf block the path!');
        }
        render();
    }

    function init(enemyId) {
        activeEnemyIds = enemyId ? [enemyId] : null;
        cacheDom();
        if (!el.arena) {
            return false;
        }
        wire();
        start();
        return true;
    }

    return {
        init: init,
        command: command,
        state: state,
        playAgain: playAgain,
        getProfile: getProfile
    };
})();
