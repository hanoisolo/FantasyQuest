/*
 * FantasyQuest — Pass 1 Chrono Trigger battle loop.
 *
 * Turn-based combat driven by the reverse-engineered Chrono Trigger math
 * in chrono_battle_engine.js (loaded as window.ChronoEngine in the
 * browser): physical hits with 0.94-1.06 variance and 2.0x criticals,
 * spell damage, and a speed-14 ATB gauge that gates the hero's turn.
 *
 * Game flow: TITLE -> COMBAT -> VICTORY / DEFEAT (overlays), with a
 * full combat reset on PLAY AGAIN / RETRY BATTLE.
 *
 * Public API (window.Battle):
 *   init()                     wire the battle scene (idempotent)
 *   command(name, targetIndex) 'attack' | 'magic' | 'item' | 'defend'
 *   state()                    snapshot for UI and tests
 *   playAgain()                reset and restart the battle
 *   getProfile()               persistent hero profile (overworld HUD)
 */
var Battle = (function () {
    'use strict';

    var Chrono = (typeof window !== 'undefined' && window.ChronoEngine) || null;

    var CONFIG = {
        hero: {
            name: 'HERO',
            maxHp: 120,
            maxMp: 45,
            power: 14,        // calculatePhysicalDamage: (power*4/3) + ...
            weaponAttack: 4,  // ... + (weapon_attack*5/8) - (defense*0.5)
            magic: 12,        // calculateMagicDamage: (magic*4/3) + ...
            defense: 4,
            magicDefense: 4,
            critRate: 0.15,   // 2.0x critical hits
            speed: 14         // ATB gauge fill: calculateATBTick(14) = 87.5/tick
        },
        goblin: {
            id: 'goblin',
            name: 'FOREST GOBLIN',
            maxHp: 45,
            power: 6,
            weaponAttack: 3,
            defense: 6,
            magicDefense: 4,
            critRate: 0
        },
        enemyCount: 2,
        magic: { name: 'Arcane Spark', cost: 10, power: 8 },
        relic: { name: 'ARCANE CRYSTAL', heal: 50 },
        victoryRewards: { exp: 45, gold: 30 },
        atbTickMs: 400,
        actionDelayMs: 350,
        enemyPauseMs: 800,     // dramatic pause before the enemy strike
        enemyStrikeGapMs: 600,
        slashHitMs: 450,
        dashMs: 500,
        floatMs: 850            // nodes removed just after the 0.8s animation
    };

    var S = null; // battle state
    var el = {};  // cached DOM nodes
    var wired = false;

    // Persistent hero profile across battles (level/EXP/gold for the HUD
    // and the overworld). Pass 1 resets HP/MP to full at every battle start.
    var profile = null;

    function freshProfile() {
        var p = {
            level: 1,
            experience: 0,
            gold: 0,
            maxHp: CONFIG.hero.maxHp,
            maxMp: CONFIG.hero.maxMp,
            attackDamage: CONFIG.hero.power
        };
        if (window.Progression && window.Progression.initProfileVitals) {
            window.Progression.initProfileVitals(p);
        } else {
            p.hp = p.maxHp;
            p.potions = 0;
        }
        return p;
    }

    // ------------------------------------------------------------------
    // Chrono engine stat adapters
    // ------------------------------------------------------------------

    function heroAttackStats() {
        var perLevel = (window.Progression && window.Progression.ATTACK_PER_LEVEL) || 2;
        return {
            power: CONFIG.hero.power + (S.hero.level - 1) * perLevel,
            weapon_attack: CONFIG.hero.weaponAttack,
            magic: CONFIG.hero.magic,
            crit_rate: CONFIG.hero.critRate,
            defense: CONFIG.hero.defense,
            magic_defense: CONFIG.hero.magicDefense
        };
    }

    function heroDefenseStats() {
        return {
            power: CONFIG.hero.power,
            weapon_attack: CONFIG.hero.weaponAttack,
            magic: CONFIG.hero.magic,
            crit_rate: 0,
            defense: CONFIG.hero.defense,
            magic_defense: CONFIG.hero.magicDefense
        };
    }

    function goblinAttackStats() {
        return {
            power: CONFIG.goblin.power,
            weapon_attack: CONFIG.goblin.weaponAttack,
            crit_rate: CONFIG.goblin.critRate
        };
    }

    function goblinDefenseStats() {
        return {
            defense: CONFIG.goblin.defense,
            magic_defense: CONFIG.goblin.magicDefense
        };
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    function freshState() {
        if (!profile) {
            profile = freshProfile();
        }
        var enemies = [];
        for (var i = 0; i < CONFIG.enemyCount; i++) {
            enemies.push({
                id: CONFIG.goblin.id,
                name: CONFIG.goblin.name,
                hp: CONFIG.goblin.maxHp,
                maxHp: CONFIG.goblin.maxHp
            });
        }
        return {
            phase: 'charge', // charge | player | target | resolving | enemy | victory | defeat
            hero: {
                name: CONFIG.hero.name,
                hp: profile.maxHp,       // Pass 1: full HP/MP every battle
                maxHp: profile.maxHp,
                mp: CONFIG.hero.maxMp,
                maxMp: CONFIG.hero.maxMp,
                atb: 0,
                defending: false,
                level: profile.level,
                experience: profile.experience,
                gold: profile.gold,
                attackDamage: profile.attackDamage
            },
            enemies: enemies,
            turnCount: 0,
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
        profile.hp = S.hero.hp;
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
            heroAtb: S.hero.atb,
            atbMax: Chrono ? Chrono.ATB_GAUGE_MAX : 100,
            heroSpeed: CONFIG.hero.speed,
            heroPower: heroAttackStats().power,
            heroMagic: CONFIG.hero.magic,
            defending: S.hero.defending,
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

    // Floating damage/heal text: rises and fades out over 0.8s (styles.css
    // float-up animation); the node is removed right after the animation.
    function floatNumber(anchor, text, kind) {
        if (!anchor) {
            return;
        }
        var num = document.createElement('div');
        num.className = 'float-number ' + (kind || 'damage');
        num.textContent = text;
        anchor.appendChild(num);
        window.setTimeout(function () {
            if (num.parentNode) {
                num.parentNode.removeChild(num);
            }
        }, CONFIG.floatMs);
    }

    function say(text) {
        if (el.message) {
            el.message.textContent = text;
        }
    }

    function pct(value, max) {
        return Math.max(0, Math.min(100, (value / max) * 100)) + '%';
    }

    // Pixel-art goblin silhouette with glowing red eyes (Pass 1 enemy art).
    function silhouetteSVG() {
        return (
            '<svg viewBox="0 0 32 36" class="sil" preserveAspectRatio="xMidYMid meet">' +
            '<g class="sil-group">' +
            '<path d="M8 30 L4 18 L10 14 L8 8 L14 10 L16 4 L18 10 L24 8 L22 14 L28 18 L24 30 Z" class="sil-body"/>' +
            '<path d="M10 30 L12 34 L22 34 L24 30 Z" class="sil-body"/>' +
            '<circle class="eye" cx="16" cy="18" r="2.2"/>' +
            '<circle class="eye" cx="24" cy="18" r="2.2"/>' +
            '</g></svg>'
        );
    }

    function buildEnemyUnit(cfg, index) {
        var unit = document.createElement('div');
        unit.className = 'enemy-unit';
        unit.setAttribute('data-index', String(index));
        unit.setAttribute('data-enemy-id', cfg.id);

        var art = document.createElement('div');
        art.className = 'enemy-art sil-only';
        art.innerHTML = silhouetteSVG();
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
        if (el.heroHpFill) {
            el.heroHpFill.style.width = pct(S.hero.hp, S.hero.maxHp);
            el.heroHpText.textContent = S.hero.hp + '/' + S.hero.maxHp;
        }
        if (el.heroMpFill) {
            el.heroMpFill.style.width = pct(S.hero.mp, S.hero.maxMp);
            el.heroMpText.textContent = S.hero.mp + '/' + S.hero.maxMp;
        }
        if (el.heroAtbFill) {
            el.heroAtbFill.style.width = pct(S.hero.atb, Chrono ? Chrono.ATB_GAUGE_MAX : 100);
            el.heroAtbText.textContent = 'ATB ' + Math.floor(S.hero.atb) + '%';
        }
        if (el.heroUnit) {
            el.heroUnit.classList.toggle('defending', S.hero.defending);
        }
        if (el.turnIndicator) {
            el.turnIndicator.classList.toggle('active',
                S.phase === 'player' || S.phase === 'target');
        }

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
        if (el.enemyRow) {
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
    // ATB gauge (speed 14 -> 87.5 gauge points per tick)
    // ------------------------------------------------------------------

    function startCharge() {
        S.phase = 'charge';
        S.hero.atb = 0;
        render();
        window.setTimeout(atbTick, CONFIG.atbTickMs);
    }

    function atbTick() {
        if (!S || S.phase !== 'charge' || !Chrono) {
            return;
        }
        S.hero.atb = Math.min(Chrono.ATB_GAUGE_MAX,
            S.hero.atb + Chrono.calculateATBTick(CONFIG.hero.speed));
        if (S.hero.atb >= Chrono.ATB_GAUGE_MAX) {
            S.phase = 'player';
            RetroAudio.playCursor();
            say('HERO\'s turn!');
            render();
            return;
        }
        render();
        window.setTimeout(atbTick, CONFIG.atbTickMs);
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
            openItemPanel();
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
        RetroAudio.playCursor();
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

        var atk = heroAttackStats();
        // Roll the 15% crit decision here and pass it through the engine's
        // forceCrit hook: the engine doubles the variance-rolled damage, so
        // a crit cannot be recovered exactly by comparing against a
        // variance-free base roll.
        var isCrit = Math.random() < CONFIG.hero.critRate;
        var damage = Chrono.calculatePhysicalDamage(atk, goblinDefenseStats(),
            { forceCrit: isCrit });

        enemy.hp = Math.max(0, enemy.hp - damage);

        // Hero dashes forward, then returns.
        if (el.heroUnit) {
            el.heroUnit.classList.add('dashing');
            window.setTimeout(function () {
                el.heroUnit.classList.remove('dashing');
            }, CONFIG.dashMs);
        }

        var unit = el.enemyRow.querySelector('[data-index="' + index + '"]');
        if (unit) {
            unit.classList.add('slash-hit');
            window.setTimeout(function () {
                unit.classList.remove('slash-hit');
            }, CONFIG.slashHitMs);
        }

        RetroAudio.playSlash();
        floatNumber(unit, isCrit ? 'CRIT! -' + damage : '-' + damage,
            isCrit ? 'crit' : 'damage');
        say('HERO attacks ' + enemy.name + (isCrit ? ' — CRITICAL HIT!' : '!'));
        render();
        window.setTimeout(checkAfterPlayerAction, CONFIG.actionDelayMs);
    }

    function doMagic() {
        if (S.hero.mp < CONFIG.magic.cost) {
            say('Not enough MP!');
            RetroAudio.playCursor();
            return;
        }
        S.phase = 'resolving';
        S.hero.mp -= CONFIG.magic.cost;

        if (el.arena) {
            el.arena.classList.add('magic-flash');
            window.setTimeout(function () {
                el.arena.classList.remove('magic-flash');
            }, 450);
        }

        RetroAudio.playMagic();
        for (var i = 0; i < S.enemies.length; i++) {
            var enemy = S.enemies[i];
            if (enemy.hp <= 0) {
                continue;
            }
            var damage = Chrono.calculateMagicDamage(
                heroAttackStats(), goblinDefenseStats(), CONFIG.magic.power);
            enemy.hp = Math.max(0, enemy.hp - damage);
            var unit = el.enemyRow.querySelector('[data-index="' + i + '"]');
            floatNumber(unit, '-' + damage, 'magic');
        }
        say('HERO casts ' + CONFIG.magic.name + '!');
        render();
        window.setTimeout(checkAfterPlayerAction, CONFIG.actionDelayMs);
    }

    // ITEM: the Arcane Crystal relic restores 50 HP. The panel (with the
    // relic icon) confirms the use; CANCEL backs out without a turn.
    function openItemPanel() {
        if (S.hero.hp >= S.hero.maxHp) {
            say('HP is already full!');
            RetroAudio.playCursor();
            return;
        }
        if (el.itemPanel) {
            el.itemPanel.classList.remove('hidden');
            say('Use the ' + CONFIG.relic.name + '?');
            RetroAudio.playCursor();
            render();
        }
    }

    function doItemUse() {
        if (!S || S.phase !== 'player') {
            return;
        }
        if (S.hero.hp >= S.hero.maxHp) {
            say('HP is already full!');
            RetroAudio.playCursor();
            return;
        }
        var healed = Math.min(CONFIG.relic.heal, S.hero.maxHp - S.hero.hp);
        S.hero.hp += healed;
        S.phase = 'resolving';

        if (el.itemPanel) {
            el.itemPanel.classList.add('hidden');
        }
        RetroAudio.playHeal();
        floatNumber(el.heroUnit, '+' + healed, 'heal');
        say('HERO uses the ' + CONFIG.relic.name + '! Restores ' + healed + ' HP.');
        render();
        window.setTimeout(checkAfterPlayerAction, CONFIG.actionDelayMs);
    }

    function doItemCancel() {
        if (el.itemPanel) {
            el.itemPanel.classList.add('hidden');
        }
        if (S && S.phase === 'player') {
            say('HERO\'s turn!');
        }
    }

    function doDefend() {
        S.phase = 'resolving';
        S.hero.defending = true; // -50% incoming damage for 1 turn
        say('HERO braces for impact! (damage halved this turn)');
        RetroAudio.playCursor();
        render();
        window.setTimeout(endPlayerTurn, CONFIG.actionDelayMs);
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
        say('The goblins snarl and circle...');
        render();

        // Dramatic pause before the enemy strike (0.8s).
        window.setTimeout(function () {
            enemyTurn(0);
        }, CONFIG.enemyPauseMs);
    }

    function enemyTurn(index) {
        if (S.phase !== 'enemy') {
            return;
        }
        if (index >= S.enemies.length) {
            finishEnemyTurn();
            return;
        }
        var enemy = S.enemies[index];
        if (enemy.hp > 0) {
            var damage = Chrono.calculatePhysicalDamage(
                goblinAttackStats(), heroDefenseStats());
            if (S.hero.defending) {
                damage = Math.max(1, Math.floor(damage / 2));
            }
            S.hero.hp = Math.max(0, S.hero.hp - damage);

            if (el.frame) {
                el.frame.classList.add('screen-shake');
                window.setTimeout(function () {
                    el.frame.classList.remove('screen-shake');
                }, 350);
            }

            floatNumber(el.heroUnit, '-' + damage, 'damage');
            say(enemy.name + ' strikes HERO for ' + damage + '!');
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
        startCharge();
    }

    // ------------------------------------------------------------------
    // Victory / defeat
    // ------------------------------------------------------------------

    function aliveEnemies() {
        return S.enemies.filter(function (e) {
            return e.hp > 0;
        }).length;
    }

    function showVictory() {
        S.phase = 'victory';

        S.lastExpGained = CONFIG.victoryRewards.exp;
        S.lastGoldGained = CONFIG.victoryRewards.gold;
        S.hero.gold += CONFIG.victoryRewards.gold;

        var result = { leveledUp: false, levelsGained: 0 };
        if (window.Progression) {
            result = window.Progression.gainExperience(S.hero, CONFIG.victoryRewards.exp);
        } else {
            S.hero.experience += CONFIG.victoryRewards.exp;
        }
        S.leveledUp = result.leveledUp;

        syncProfileFromHero();

        if (el.victoryScreen) {
            var overlayLine = el.victoryScreen.querySelector('.result-line');
            if (overlayLine) {
                var line = '+' + CONFIG.victoryRewards.exp + ' EXP and +' +
                    CONFIG.victoryRewards.gold + ' Gold';
                if (result.leveledUp) {
                    line += ' — LEVEL UP! Now Lv ' + S.hero.level + '!';
                }
                overlayLine.textContent = line;
            }
            el.victoryScreen.classList.remove('hidden');
        }

        RetroAudio.playVictory();
        say(result.leveledUp
            ? 'VICTORY! You reached Lv ' + S.hero.level + '!'
            : 'The forest falls silent... VICTORY!');
        render();
    }

    function showDefeat() {
        S.phase = 'defeat';
        if (profile) {
            profile.hp = profile.maxHp;
        }
        if (el.defeatScreen) {
            el.defeatScreen.classList.remove('hidden');
        }
        RetroAudio.gameOver();
        say('HERO has fallen...');
        render();
    }

    function playAgain() {
        if (el.victoryScreen) {
            el.victoryScreen.classList.add('hidden');
        }
        if (el.defeatScreen) {
            el.defeatScreen.classList.add('hidden');
        }
        if (el.itemPanel) {
            el.itemPanel.classList.add('hidden');
        }
        start();
    }

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
        el.heroAtbFill = $('hero-atb-fill');
        el.heroAtbText = $('hero-atb-text');
        el.heroHpText = $('hero-hp-text');
        el.heroMpText = $('hero-mp-text');
        el.heroLevelText = $('hero-level-text');
        el.heroGoldText = $('hero-gold-text');
        el.turnIndicator = $('turn-indicator');
        el.message = $('battle-message');
        el.victoryScreen = $('victory-screen');
        el.defeatScreen = $('defeat-screen');
        el.itemPanel = $('item-panel');
        el.itemUse = $('item-use');
        el.itemCancel = $('item-cancel');
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
        if (el.itemUse) {
            el.itemUse.addEventListener('click', doItemUse);
        }
        if (el.itemCancel) {
            el.itemCancel.addEventListener('click', doItemCancel);
        }
        $('victory-again').addEventListener('click', playAgain);
        $('defeat-retry').addEventListener('click', playAgain);
    }

    function start() {
        S = freshState();
        el.enemyRow.innerHTML = '';
        for (var i = 0; i < CONFIG.enemyCount; i++) {
            el.enemyRow.appendChild(buildEnemyUnit(CONFIG.goblin, i));
        }
        if (el.victoryScreen) {
            el.victoryScreen.classList.add('hidden');
        }
        if (el.defeatScreen) {
            el.defeatScreen.classList.add('hidden');
        }
        if (el.itemPanel) {
            el.itemPanel.classList.add('hidden');
        }
        say('Two Forest Goblins block the path!');
        render();
        startCharge();
    }

    function init() {
        cacheDom();
        if (!el.arena || !Chrono) {
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
