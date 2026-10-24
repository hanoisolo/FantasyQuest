/*
 * FantasyQuest — Phase 11 overworld rendering and input layer (DOM).
 *
 * Consumes the pure overworld.js module: this file only builds DOM,
 * routes keyboard input through Overworld.attemptMove (walkability rules
 * stay in overworld.js), and syncs the hero marker position from the
 * logical player state. No game logic lives here.
 *
 * Public API (window.OverworldScene):
 *   initOverworld(container, entry?)
 *                              build the tile grid + hero marker and wire
 *                              input; entry (a Phase 15 save payload, or
 *                              null) starts the hero at the saved map and
 *                              tile through the warp rebuild path
 *   refreshOverworld()        re-sync the hero marker from overworld state
 *   startEncounter(enemyId)   pause input and hand control to the battle
 *                             scene for an overworld encounter (the rAF loop
 *                             calls this on an encounter roll; exposed so the
 *                             headless tests can drive the same flow)
 *   stepLand()                warp-or-encounter logic for a landed step; the
 *                             rAF loop calls this after each completed step
 *                             (exposed for the same headless reason)
 */
var OverworldScene = (function () {
    'use strict';

    var TILE_PX = 32;                       // rendered tile size
    var HERO_SRC = 'assets/sprites/hero_map.png';

    // Simple SVG silhouette shown when the hero sprite fails to load
    // (same fallback pattern as the battle enemy sprites).
    var HERO_FALLBACK_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet">' +
        '<rect x="10" y="4" width="12" height="9" fill="#e8e0c8"/>' +
        '<rect x="8" y="14" width="16" height="14" fill="#2a5ecc"/>' +
        '</svg>';

    var FACING_CLASSES = ['facing-up', 'facing-down', 'facing-left', 'facing-right'];
    var MAP_W = 20;
    var MAP_H = 15;
    var BOARD_W = MAP_W * TILE_PX;          // 640px
    var BOARD_H = MAP_H * TILE_PX;          // 480px

    var KEY_TO_DIRECTION = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        W: 'up',
        S: 'down',
        A: 'left',
        D: 'right'
    };
    var ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    var INTERACT_KEYS = ['e', 'E', ' ', 'Enter'];

    var U = null;   // scene state (grid, hero marker, player, loop)
    var wired = false;
    var loopStarted = false;
    var victoryReturnWired = false;
    var saveFlashTimer = null;              // Phase 15: HUD save-flash hide timer

    // ------------------------------------------------------------------
    // DOM construction
    // ------------------------------------------------------------------

    function tileClass(tile) {
        var TILE = window.Overworld.TILE;
        if (tile === TILE.TREE) {
            return 'tile-tree';
        }
        if (tile === TILE.WATER) {
            return 'tile-water';
        }
        if (tile === TILE.PATH) {
            return 'tile-path';
        }
        if (tile === TILE.WARP) {
            return 'tile-warp';
        }
        if (tile === TILE.WALL) {
            return 'tile-wall';
        }
        if (tile === TILE.FLOOR) {
            return 'tile-floor';
        }
        return 'tile-grass';
    }

    function buildGrid(map) {
        var grid = document.createElement('div');
        grid.className = 'overworld-grid';
        for (var y = 0; y < map.length; y++) {
            for (var x = 0; x < map[y].length; x++) {
                var tile = document.createElement('div');
                tile.className = 'tile ' + tileClass(map[y][x]);
                tile.setAttribute('data-x', String(x));
                tile.setAttribute('data-y', String(y));
                grid.appendChild(tile);
            }
        }
        return grid;
    }

    function buildHero() {
        // Wrapper marker holds the sprite img plus a hidden silhouette
        // fallback layer; on load failure the sprite is swapped out.
        var marker = document.createElement('div');
        marker.className = 'hero-map-sprite facing-down';

        var fallback = document.createElement('div');
        fallback.className = 'hero-fallback';
        fallback.innerHTML = HERO_FALLBACK_SVG;

        var hero = document.createElement('img');
        hero.src = HERO_SRC;
        hero.alt = 'Hero';
        hero.addEventListener('error', function () {
            marker.classList.add('sprite-failed');
        });

        marker.appendChild(fallback);
        marker.appendChild(hero);
        return marker;
    }

    // NPC markers: flat-color stand-ins, one per NPC, class named by id
    // (npc-<id>) so sprite art can slot in at assets/sprites/<id>_map.png.
    function buildNpcMarkers(npcs) {
        var markers = [];
        for (var i = 0; i < npcs.length; i++) {
            var npc = npcs[i];
            var marker = document.createElement('div');
            marker.className = 'npc-marker npc-' + npc.id;
            marker.setAttribute('data-npc-id', npc.id);
            marker.style.left = (npc.x * TILE_PX) + 'px';
            marker.style.top = (npc.y * TILE_PX) + 'px';
            marker.setAttribute('title', npc.name);
            markers.push(marker);
        }
        return markers;
    }

    // Retro dialogue box shown at the bottom of the overworld.
    function buildDialogueBox() {
        var box = document.createElement('div');
        box.className = 'overworld-dialogue hidden';
        box.innerHTML =
            '<p class="npc-name" id="dialogue-npc-name"></p>' +
            '<p class="npc-line" id="dialogue-line"></p>';
        return box;
    }

    function fitBoard() {
        if (!U || !U.container || !U.board) {
            return;
        }
        var cw = U.container.clientWidth || BOARD_W;
        var ch = U.container.clientHeight || BOARD_H;
        var scale = Math.min(cw / BOARD_W, ch / BOARD_H, 1);
        U.board.style.transform = 'scale(' + scale + ')';
    }

    // ------------------------------------------------------------------
    // Hero marker sync
    // ------------------------------------------------------------------

    // Re-sync the hero marker from overworld.js state. While a step is in
    // flight the marker is placed on the destination tile so the CSS
    // transition slides it there in step time; otherwise it sits on the
    // player's exact tile.
    function refreshOverworld() {
        if (!U || !U.hero) {
            return;
        }
        var p = U.player;
        var tx = p.moving.active ? p.moving.toX : p.x;
        var ty = p.moving.active ? p.moving.toY : p.y;
        U.hero.style.left = (tx * TILE_PX) + 'px';
        U.hero.style.top = (ty * TILE_PX) + 'px';
        // Swap the facing class without clobbering other marker classes
        // (e.g. sprite-failed) so the fallback stays active.
        for (var i = 0; i < FACING_CLASSES.length; i++) {
            U.hero.classList.remove(FACING_CLASSES[i]);
        }
        U.hero.classList.add('facing-' + p.facing);
        updateHud(); // keeps persistent HP/potions/gold visible while exploring
    }

    // ------------------------------------------------------------------
    // Scene flow: encounters and returning to the map
    // ------------------------------------------------------------------

    function showScene(name) {
        var scenes = document.querySelectorAll('.scene');
        for (var i = 0; i < scenes.length; i++) {
            scenes[i].classList.toggle('active', scenes[i].id === 'scene-' + name);
        }
    }

    function startEncounter(enemyId) {
        if (!U) {
            return;
        }
        U.paused = true;       // overworld input pauses for the battle
        U.inEncounter = true;
        showScene('battle');
        wireVictoryReturn();
        // The battle engine keeps the in-memory hero profile, so level,
        // EXP, and gold carry across overworld encounters.
        if (window.Battle) {
            window.Battle.init(enemyId);
        }
    }

    function wireVictoryReturn() {
        if (victoryReturnWired) {
            return;
        }
        victoryReturnWired = true;
        var btn = document.getElementById('victory-again');
        if (btn) {
            btn.addEventListener('click', function () {
                if (U && U.inEncounter) {
                    returnToOverworld();
                }
            });
        }
    }

    function returnToOverworld() {
        if (!U) {
            return;
        }
        // Fresh grace period so the player is not ambushed right after winning.
        U.player = window.Overworld.resetEncounterCounter(U.player);
        U.inEncounter = false;
        U.paused = false;
        showScene('overworld');
        refreshOverworld(); // hero is restored to the tile he was standing on
        autosave(); // Phase 15: victory rewards are already in the profile
    }

    // Swap the board's grid and NPC markers for the current map's. The
    // hero marker stays in place; refreshOverworld re-syncs it. The
    // scene's map/npcs follow the player state so interactions (shop,
    // dialogue) hit the new map's NPCs.
    function rebuildMapDom() {
        if (!U || !U.board || !U.player) {
            return;
        }
        var newGrid = buildGrid(U.player.map);
        U.board.insertBefore(newGrid, U.grid);
        U.board.removeChild(U.grid);
        U.grid = newGrid;
        U.map = U.player.map;
        U.npcs = U.player.npcs;
        for (var i = 0; i < U.npcMarkers.length; i++) {
            if (U.npcMarkers[i].parentNode) {
                U.npcMarkers[i].parentNode.removeChild(U.npcMarkers[i]);
            }
        }
        U.npcMarkers = buildNpcMarkers(U.player.npcs);
        for (var m = 0; m < U.npcMarkers.length; m++) {
            U.board.appendChild(U.npcMarkers[m]);
        }
    }

    /*
     * The step just landed on walkable terrain. Warp exits take priority
     * over the encounter roll: landing on a warp transitions to the
     * target map (rebuilt grid and NPC markers, refreshed hero marker,
     * updated HUD map name) and skips the encounter roll entirely for
     * that landing. Otherwise the step registers for the random
     * encounter roll, which may start a battle.
     */
    function onStepLand() {
        if (!U || !U.player) {
            return;
        }
        var player = U.player;
        if (window.Overworld.warpAt(player.mapId, player.x, player.y)) {
            U.player = window.Overworld.applyWarp(player);
            rebuildMapDom();
            refreshOverworld();
            updateHud();
            autosave(); // Phase 15: persist the new map and position
            if (window.RetroAudio && typeof window.RetroAudio.playWarp === 'function') {
                window.RetroAudio.playWarp();
            }
            return; // warps never roll an encounter for this landing
        }
        U.player = window.Overworld.registerStep(player, Math.random);
        if (U.player.encounter.triggered) {
            startEncounter(U.player.encounter.lastEnemyId);
        }
    }

    // ------------------------------------------------------------------
    // Interaction and dialogue
    // ------------------------------------------------------------------

    function findNpc(id) {
        if (!U) {
            return null;
        }
        for (var i = 0; i < U.npcs.length; i++) {
            if (U.npcs[i].id === id) {
                return U.npcs[i];
            }
        }
        return null;
    }

    // The live hero profile (gold, potions, hp) shared with the battle engine.
    function getHeroProfile() {
        if (window.Battle && window.Battle.getProfile) {
            return window.Battle.getProfile();
        }
        return null;
    }

    function updateHud() {
        if (!U || !U.hudHp) {
            return;
        }
        var p = getHeroProfile();
        if (!p) {
            return;
        }
        U.hudHp.textContent = 'HP ' + p.hp + '/' + p.maxHp;
        U.hudPotions.textContent = 'POT ' + p.potions;
        U.hudGold.textContent = p.gold + ' G';
        if (U.hudMap) {
            var cfg = window.Overworld.getMapConfig(U.player.mapId);
            U.hudMap.textContent = cfg ? cfg.name : 'FOREST CLEARING';
        }
    }

    // ------------------------------------------------------------------
    // Phase 15: autosave (SaveSystem) and the HUD save flash
    // ------------------------------------------------------------------

    /*
     * Best-effort autosave at key beats: battle-victory return, map
     * warp, shop purchase. Storage failures (private mode) never
     * interrupt gameplay; the defeat-retry fairness path (free HP
     * restore) deliberately never passes through here, so that state
     * is never persisted.
     */
    function autosave() {
        try {
            if (!U || !U.player || !window.SaveSystem || !window.SaveSystem.save) {
                return;
            }
            var profile = getHeroProfile();
            if (!profile) {
                return;
            }
            var payload = {
                version: 1,
                profile: {
                    level: profile.level,
                    exp: profile.experience,
                    gold: profile.gold,
                    hp: profile.hp,
                    maxHp: profile.maxHp,
                    potions: profile.potions
                },
                mapId: U.player.mapId,
                x: U.player.x,
                y: U.player.y,
                savedAt: Date.now()
            };
            if (window.SaveSystem.save(payload)) {
                showSaveFlash();
            }
        } catch (e) {
            // Storage is best-effort; gameplay continues regardless.
        }
    }

    // Small "GAME SAVED" flash appended to the HUD, visible ~1 second.
    // The element is built lazily (and styled inline) so no markup or
    // stylesheet change is needed for this feature.
    function showSaveFlash() {
        if (!U) {
            return;
        }
        if (!U.saveFlash) {
            var host = U.hudMap ? U.hudMap.parentNode : null;
            if (!host && U.hudHp) {
                host = U.hudHp.parentNode;
            }
            if (!host) {
                return; // headless environments without a rendered HUD
            }
            var flash = document.createElement('span');
            flash.id = 'hud-save-flash';
            flash.className = 'hud-save-flash hidden';
            flash.textContent = 'GAME SAVED';
            flash.style.marginLeft = '8px';
            flash.style.padding = '1px 6px';
            flash.style.fontSize = '12px';
            flash.style.color = '#8ee06e';
            flash.style.background = 'rgba(0, 0, 0, 0.55)';
            flash.style.border = '1px solid #8ee06e';
            flash.style.borderRadius = '4px';
            host.appendChild(flash);
            U.saveFlash = flash;
        }
        U.saveFlash.classList.remove('hidden');
        if (saveFlashTimer !== null && window.clearTimeout) {
            window.clearTimeout(saveFlashTimer);
        }
        if (window.setTimeout) {
            saveFlashTimer = window.setTimeout(function () {
                saveFlashTimer = null;
                if (U && U.saveFlash) {
                    U.saveFlash.classList.add('hidden');
                }
            }, 1000);
        }
    }

    function renderDialogue() {
        if (!U || !U.dialogue || !U.dialogueBox) {
            return;
        }
        U.dialogueBox.querySelector('.npc-name').textContent = U.dialogue.name;
        U.dialogueBox.querySelector('.npc-line').textContent = U.dialogue.lines[U.dialogue.index];
    }

    function showDialogue() {
        if (U.dialogueBox) {
            U.dialogueBox.classList.remove('hidden');
        }
    }

    function hideDialogue() {
        if (U.dialogueBox) {
            U.dialogueBox.classList.add('hidden');
        }
    }

    // --- Shop menu (Phase 12) ---

    function showShop() {
        if (U.shopBox) {
            U.shopBox.classList.remove('hidden');
        }
    }

    function hideShop() {
        if (U.shopBox) {
            U.shopBox.classList.add('hidden');
        }
    }

    function renderShop() {
        if (!U || !U.shop || !U.shopBox) {
            return;
        }
        var P = window.Progression;
        var price = P && typeof P.POTION_PRICE === 'number' ? P.POTION_PRICE : 15;
        U.shopBuyBtn.textContent = 'BUY POTION - ' + price + ' G';
        U.shopMessage.textContent = U.shop.lastMessage;
    }

    function openShopMenu(npc) {
        U.shop = window.Overworld.openShop(npc);
        renderShop();
        showShop();
        if (window.RetroAudio) {
            RetroAudio.beep();
        }
    }

    function buyFromShop() {
        if (!U || !U.shop || !U.shop.open) {
            return;
        }
        var profile = getHeroProfile();
        if (!profile) {
            return;
        }
        var goldBefore = profile.gold;
        U.shop = window.Overworld.shopBuy(U.shop, profile);
        if (profile.gold < goldBefore) {
            if (window.RetroAudio) {
                RetroAudio.buy(); // shop purchase chime
            }
            autosave(); // Phase 15: persist the new gold/potion counts
        } else if (window.RetroAudio) {
            RetroAudio.beep(); // failed purchase
        }
        renderShop();
        updateHud(); // gold and potion count change on every purchase
    }

    function closeShop() {
        if (!U || !U.shop) {
            return;
        }
        U.shop = window.Overworld.shopLeave(U.shop);
        U.shop = null;
        hideShop();
        if (window.RetroAudio) {
            RetroAudio.beep();
        }
    }

    // E / Space / Enter: open a dialogue with the faced NPC, advance the
    // current line, or close the box after the last line. Shop NPCs open
    // their shop menu after the last dialogue line.
    function handleInteraction() {
        if (!U || U.paused) {
            return;
        }
        if (U.shop) {
            closeShop(); // interaction key acts as LEAVE while shopping
            return;
        }
        if (U.dialogue) {
            U.dialogue = window.Overworld.advanceDialogue(U.dialogue);
            if (U.dialogue.open) {
                renderDialogue();
            } else {
                var npcId = U.dialogue.npcId;
                U.dialogue = window.Overworld.endDialogue(U.dialogue);
                U.dialogue = null;
                hideDialogue(); // movement input resumes
                var npc = findNpc(npcId);
                if (npc && npc.shop) {
                    openShopMenu(npc); // dialogue done -> shop menu
                }
            }
            return;
        }
        var npc = window.Overworld.getFacingNpc(U.map, U.npcs, U.player);
        if (npc) {
            U.dialogue = window.Overworld.startDialogue(npc);
            renderDialogue();
            showDialogue();
        }
    }

    // ------------------------------------------------------------------
    // Input
    // ------------------------------------------------------------------

    function wireInput() {
        if (wired) {
            return;
        }
        wired = true;
        var shopBuyBtn = document.getElementById('shop-buy');
        var shopLeaveBtn = document.getElementById('shop-leave');
        if (shopBuyBtn) {
            shopBuyBtn.addEventListener('click', buyFromShop);
        }
        if (shopLeaveBtn) {
            shopLeaveBtn.addEventListener('click', closeShop);
        }
        document.addEventListener('keydown', function (event) {
            if (!U || U.paused) {
                return; // no input before init or while a battle is running
            }
            // Interaction keys: open / advance / close NPC dialogue.
            if (INTERACT_KEYS.indexOf(event.key) !== -1) {
                if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault(); // stop the page from scrolling
                }
                handleInteraction();
                return;
            }
            var direction = KEY_TO_DIRECTION[event.key];
            if (!direction) {
                return;
            }
            // Stop arrow keys from scrolling the page.
            if (ARROW_KEYS.indexOf(event.key) !== -1) {
                event.preventDefault();
            }
            // Movement input is locked while dialogue or the shop is open.
            if (U.dialogue || U.shop) {
                return;
            }
            // Input is ignored while a step animation is in progress.
            if (U.player.moving.active) {
                return;
            }
            // All walkability and grid rules stay in overworld.js.
            U.player = window.Overworld.attemptMove(U.player, direction, 0);
            refreshOverworld();
        });
    }

    // ------------------------------------------------------------------
    // Animation loop
    // ------------------------------------------------------------------

    function startLoop() {
        if (loopStarted || !window.requestAnimationFrame) {
            return; // one loop per page; headless envs drive logic directly
        }
        loopStarted = true;
        var lastTs = null;
        var step = function (ts) {
            if (U && !U.paused && U.player && U.player.moving.active) {
                var dt = lastTs === null ? 0 : ts - lastTs;
                // Direction is ignored while a step is active (input lock);
                // this tick only advances the step by delta-time.
                U.player = window.Overworld.attemptMove(U.player, U.player.facing, dt);
                refreshOverworld();
                if (!U.player.moving.active) {
                    onStepLand();
                }
            }
            lastTs = ts;
            window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    function initOverworld(container, entry) {
        if (!container || !window.Overworld) {
            return null;
        }

        var map = window.Overworld.buildFirstMap();
        var player = window.Overworld.createPlayerState(map, 8, 12);
        var npcs = player.npcs;

        container.innerHTML = '';
        container.classList.add('overworld-container');

        var board = document.createElement('div');
        board.className = 'overworld-board';

        var grid = buildGrid(map);
        var hero = buildHero();
        var npcMarkers = buildNpcMarkers(npcs);

        board.appendChild(grid);
        for (var n = 0; n < npcMarkers.length; n++) {
            board.appendChild(npcMarkers[n]);
        }
        board.appendChild(hero);
        container.appendChild(board);

        var dialogueBox = buildDialogueBox();
        container.appendChild(dialogueBox);

        U = {
            container: container,
            board: board,
            grid: grid,
            hero: hero,
            map: map,
            npcs: npcs,
            player: player,
            dialogue: null,
            dialogueBox: dialogueBox,
            shop: null,
            shopBox: document.getElementById('overworld-shop'),
            shopBuyBtn: document.getElementById('shop-buy'),
            shopMessage: document.getElementById('shop-message'),
            hudHp: document.getElementById('hud-hp'),
            hudPotions: document.getElementById('hud-potions'),
            hudGold: document.getElementById('hud-gold'),
            hudMap: document.getElementById('hud-map'),
            npcMarkers: npcMarkers,
            paused: false,
            inEncounter: false
        };

        wireInput();
        // Phase 15 Continue: a saved entry swaps the hero onto the saved
        // map and tile through the same rebuild a warp uses (fresh grace
        // period included), never a parallel bootstrap. Unknown maps keep
        // the default forest start.
        if (entry && window.Overworld.getMapConfig(entry.mapId)) {
            var cfg = window.Overworld.getMapConfig(entry.mapId);
            U.player = window.Overworld.createPlayerState(
                window.Overworld.buildMap(entry.mapId),
                entry.x,
                entry.y,
                U.player.facing,
                cfg.npcs,
                entry.mapId
            );
            rebuildMapDom();
        }
        refreshOverworld();
        fitBoard();
        if (window.addEventListener) {
            window.addEventListener('resize', fitBoard);
        }
        startLoop();
        return U;
    }

    return {
        initOverworld: initOverworld,
        refreshOverworld: refreshOverworld,
        startEncounter: startEncounter,
        // Headless entry point to the rAF loop's step-landing logic
        // (warp transition first, then the encounter roll).
        stepLand: onStepLand
    };
})();
