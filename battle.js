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
 *   init(enemyId)               wire the battle scene (idempotent);
 *                              enemyId ('goblin' | 'wolf') spawns exactly
 *                              that one enemy; no argument spawns the
 *                              default two Forest Goblins
 *   command(name, targetIndex) 'attack' | 'magic' | 'item' | 'defend'
 *   state()                    snapshot for UI and tests
 *   playAgain()                reset and restart the battle
 *   getProfile()               persistent hero profile (overworld HUD)
 *   applyProfile(saveProfile)  Phase 15 Continue: write a save's profile
 *                              fields into the live hero profile -> true;
 *                              malformed input changes nothing -> false
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
            critRate: 0,
            rewards: { exp: 25, gold: 18 }
        },
        wolf: {
            id: 'wolf',
            name: 'SHADOW WOLF',
            maxHp: 38,
            power: 10,
            weaponAttack: 3,
            defense: 5,
            magicDefense: 3,
            critRate: 0,
            speed: 16,
            rewards: { exp: 20, gold: 12 }
        },
        enemyCount: 2,
        magic: { name: 'Arcane Spark', cost: 10, power: 8 },
        victoryRewards: { exp: 45, gold: 30 }, // Pass 1 fixed reward, default two-goblin battle
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
    // and the overworld). Phase 12: HP and potions persist across battles
    // (MP still refills at every battle start).
    var profile = null;

    // Active encounter roster: null = the default two-goblin battle,
    // otherwise the enemyId passed to init() ('goblin' | 'wolf').
    var encounterId = null;

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

    function wolfAttackStats() {
        return {
            power: CONFIG.wolf.power,
            weapon_attack: CONFIG.wolf.weaponAttack,
            crit_rate: CONFIG.wolf.critRate
        };
    }

    function wolfDefenseStats() {
        return {
            defense: CONFIG.wolf.defense,
            magic_defense: CONFIG.wolf.magicDefense
        };
    }

    // Per-enemy dispatch: pick the adapter matching the unit on the field.
    function enemyAttackStats(enemy) {
        return enemy && enemy.id === 'wolf' ? wolfAttackStats() : goblinAttackStats();
    }

    function enemyDefenseStats(enemy) {
        return enemy && enemy.id === 'wolf' ? wolfDefenseStats() : goblinDefenseStats();
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    function freshState() {
        if (!profile) {
            profile = freshProfile();
        }
        var roster = [];
        if (encounterId) {
            roster.push(CONFIG[encounterId] || CONFIG.goblin);
        } else {
            for (var r = 0; r < CONFIG.enemyCount; r++) {
                roster.push(CONFIG.goblin);
            }
        }
        var enemies = [];
        for (var i = 0; i < roster.length; i++) {
            enemies.push({
                id: roster[i].id,
                name: roster[i].name,
                hp: roster[i].maxHp,
                maxHp: roster[i].maxHp
            });
        }
        return {
            phase: 'charge', // charge | player | target | resolving | enemy | victory | defeat
            hero: {
                name: CONFIG.hero.name,
                hp: (typeof profile.hp === 'number') ? profile.hp : profile.maxHp,
                maxHp: profile.maxHp,
                mp: CONFIG.hero.maxMp,     // MP refills every battle
                maxMp: CONFIG.hero.maxMp,
                atb: 0,
                defending: false,
                level: profile.level,
                experience: profile.experience,
                gold: profile.gold,
                attackDamage: profile.attackDamage,
                potions: (typeof profile.potions === 'number') ? profile.potions : 0
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
            heroPotions: S.hero.potions,
            lastExpGained: S.lastExpGained,
            lastGoldGained: S.lastGoldGained,
            leveledUp: S.leveledUp,
            enemies: S.enemies.map(function (e) {
                var cfg = CONFIG[e.id] || CONFIG.goblin;
                return {
                    id: e.id,
                    name: e.name,
                    hp: e.hp,
                    maxHp: e.maxHp,
                    alive: e.hp > 0,
                    stats: {
                        power: cfg.power,
                        weaponAttack: cfg.weaponAttack,
                        defense: cfg.defense,
                        magicDefense: cfg.magicDefense,
                        critRate: cfg.critRate,
                        speed: cfg.speed || 0
                    }
                };
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
        var damage = Chrono.calculatePhysicalDamage(atk, enemyDefenseStats(enemy),
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
                heroAttackStats(), enemyDefenseStats(enemy), CONFIG.magic.power);
            enemy.hp = Math.max(0, enemy.hp - damage);
            var unit = el.enemyRow.querySelector('[data-index="' + i + '"]');
            floatNumber(unit, '-' + damage, 'magic');
        }
        say('HERO casts ' + CONFIG.magic.name + '!');
        render();
        window.setTimeout(checkAfterPlayerAction, CONFIG.actionDelayMs);
    }

    // ITEM: a potion from the hero's inventory. Progression.usePotion heals
    // 30 HP clamped to maxHp; using one consumes the turn so the enemy acts.
    // An empty inventory (or full HP) refuses without consuming the turn.
    function doItem() {
        if (!S || S.phase !== 'player') {
            return;
        }
        var hpBefore = S.hero.hp;
        var used = window.Progression ? window.Progression.usePotion(S.hero) : false;
        if (!used) {
            if (S.hero.hp >= S.hero.maxHp) {
                say('HP is already full!');
            } else {
                say('No potions!');
            }
            RetroAudio.playCursor();
            return;
        }
        if (profile) {
            profile.potions = S.hero.potions;
        }
        S.phase = 'resolving';
        RetroAudio.playHeal();
        var healed = S.hero.hp - hpBefore;
        floatNumber(el.heroUnit, '+' + healed, 'heal');
        say('HERO uses a potion! Restores ' + healed + ' HP.');
        render();
        window.setTimeout(checkAfterPlayerAction, CONFIG.actionDelayMs);
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
                enemyAttackStats(enemy), heroDefenseStats());
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

    // Encounter battles (init with an enemyId) pay each defeated enemy's
    // own reward; the default two-goblin battle keeps the fixed Pass 1 reward.
    function encounterRewards() {
        if (!encounterId) {
            return CONFIG.victoryRewards;
        }
        var exp = 0;
        var gold = 0;
        for (var i = 0; i < S.enemies.length; i++) {
            var cfg = CONFIG[S.enemies[i].id] || CONFIG.goblin;
            exp += cfg.rewards.exp;
            gold += cfg.rewards.gold;
        }
        return { exp: exp, gold: gold };
    }

    function showVictory() {
        S.phase = 'victory';

        var rewards = encounterRewards();
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

        if (el.victoryScreen) {
            var overlayLine = el.victoryScreen.querySelector('.result-line');
            if (overlayLine) {
                var line = '+' + rewards.exp + ' EXP and +' +
                    rewards.gold + ' Gold';
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
        // Phase 11 loop: a victory won from an overworld encounter returns
        // to the map (the overworld scene owns the return), so the battle
        // does not restart itself. The standalone default battle keeps its
        // replay loop; defeat retries always restart the same encounter.
        if (S && S.phase === 'victory' && encounterId) {
            if (el.victoryScreen) {
                el.victoryScreen.classList.add('hidden');
            }
            return;
        }
        if (el.victoryScreen) {
            el.victoryScreen.classList.add('hidden');
        }
        if (el.defeatScreen) {
            el.defeatScreen.classList.add('hidden');
        }
        start();
    }

    function getProfile() {
        if (!profile) {
            profile = freshProfile();
        }
        return profile;
    }

    // Phase 15 Continue: write a save's profile fields into the live hero
    // profile (and any active battle state) instead of callers mutating
    // private state. Attack power follows the level curve the level-up
    // math applies, derived from the base power.
    function applyProfile(saved) {
        if (saved === null || typeof saved !== 'object') {
            return false;
        }
        var fields = ['level', 'exp', 'gold', 'hp', 'maxHp', 'potions'];
        for (var i = 0; i < fields.length; i++) {
            if (typeof saved[fields[i]] !== 'number' || !isFinite(saved[fields[i]])) {
                return false;
            }
        }
        if (saved.hp > saved.maxHp) {
            return false;
        }
        var p = getProfile();
        p.level = saved.level;
        p.experience = saved.exp;
        p.gold = saved.gold;
        p.maxHp = saved.maxHp;
        p.hp = saved.hp;
        p.potions = saved.potions;
        var attackPerLevel = (window.Progression && window.Progression.ATTACK_PER_LEVEL) || 2;
        p.attackDamage = CONFIG.hero.power + (p.level - 1) * attackPerLevel;
        if (S) {
            S.hero.level = p.level;
            S.hero.experience = p.experience;
            S.hero.gold = p.gold;
            S.hero.maxHp = p.maxHp;
            S.hero.hp = p.hp;
            S.hero.attackDamage = p.attackDamage;
            S.hero.potions = p.potions;
        }
        return true;
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
        for (var i = 0; i < S.enemies.length; i++) {
            el.enemyRow.appendChild(buildEnemyUnit(S.enemies[i], i));
        }
        if (el.victoryScreen) {
            el.victoryScreen.classList.add('hidden');
        }
        if (el.defeatScreen) {
            el.defeatScreen.classList.add('hidden');
        }
        say('Two Forest Goblins block the path!');
        render();
        startCharge();
    }

    function init(enemyId) {
        cacheDom();
        if (!el.arena || !Chrono) {
            return false;
        }
        encounterId = (typeof enemyId === 'string' && CONFIG[enemyId])
            ? enemyId
            : null;
        wire();
        start();
        return true;
    }

    return {
        init: init,
        command: command,
        state: state,
        playAgain: playAgain,
        getProfile: getProfile,
        applyProfile: applyProfile
    };
})();
