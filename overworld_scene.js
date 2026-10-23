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

    var U = null;   // scene state (grid, hero marker, player, loop)
    var wired = false;

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
    // Input
    // ------------------------------------------------------------------

    function wireInput() {
        if (wired) {
            return;
        }
        wired = true;
        document.addEventListener('keydown', function (event) {
            if (!U) {
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
        if (!window.requestAnimationFrame) {
            return; // headless/test environments: logic still advances via attemptMove
        }
        var lastTs = null;
        var step = function (ts) {
            if (U && U.player && U.player.moving.active) {
                var dt = lastTs === null ? 0 : ts - lastTs;
                // Direction is ignored while a step is active (input lock);
                // this tick only advances the step by delta-time.
                U.player = window.Overworld.attemptMove(U.player, U.player.facing, dt);
                refreshOverworld();
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

        container.innerHTML = '';
        container.classList.add('overworld-container');

        var board = document.createElement('div');
        board.className = 'overworld-board';

        var grid = buildGrid(map);
        var hero = buildHero();

        board.appendChild(grid);
        board.appendChild(hero);
        container.appendChild(board);

        U = {
            container: container,
            board: board,
            grid: grid,
            hero: hero,
            map: map,
            player: player
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
