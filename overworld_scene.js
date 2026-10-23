/*
 * FantasyQuest — Phase 11 overworld rendering and input layer (DOM).
 *
 * Consumes the pure overworld.js module: this file only builds DOM,
 * routes keyboard input through Overworld.attemptMove (walkability rules
 * stay in overworld.js), and syncs the hero marker position from the
 * logical player state. No game logic lives here.
 *
 * Public API (window.OverworldScene):
 *   initOverworld(container)  build the tile grid + hero marker and wire input
 *   refreshOverworld()        re-sync the hero marker from overworld state
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
    }

    // ------------------------------------------------------------------
    // Interaction and dialogue
    // ------------------------------------------------------------------

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

    // E / Space / Enter: open a dialogue with the faced NPC, advance the
    // current line, or close the box after the last line.
    function handleInteraction() {
        if (!U || U.paused) {
            return;
        }
        if (U.dialogue) {
            U.dialogue = window.Overworld.advanceDialogue(U.dialogue);
            if (U.dialogue.open) {
                renderDialogue();
            } else {
                U.dialogue = window.Overworld.endDialogue(U.dialogue);
                U.dialogue = null;
                hideDialogue(); // movement input resumes
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
            // Movement input is locked while dialogue is open.
            if (U.dialogue) {
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
                    // The step landed on walkable terrain: register it
                    // for the random encounter roll.
                    U.player = window.Overworld.registerStep(U.player, Math.random);
                    if (U.player.encounter.triggered) {
                        startEncounter(U.player.encounter.lastEnemyId);
                    }
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

    function initOverworld(container) {
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
            paused: false,
            inEncounter: false
        };

        wireInput();
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
        refreshOverworld: refreshOverworld
    };
})();
