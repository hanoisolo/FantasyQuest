/*
 * FantasyQuest — Phase 11 overworld exploration logic (pure module, no DOM).
 *
 * Tile-based map data, tile walkability, and a strictly grid-to-grid
 * movement state machine: a step starts only when the player is idle and
 * the destination tile is walkable; input stays locked until the tile-to-
 * tile step completes; step progress advances by delta-time. All exposed
 * functions are pure — they never mutate their arguments.
 *
 * Public API (window.Overworld):
 *   TILE                      tile type constants
 *   MOVE_DURATION_MS          time (ms) one tile-to-tile step takes
 *   buildFirstMap()           fresh 20x15 forest-clearing map (2D array)
 *   isWalkableTile(map, x, y) false for out-of-bounds, TREE, WATER
 *   createPlayerState(map, x, y, facing?)
 *   attemptMove(state, direction, dt) -> new state (input never mutated)
 */
var Overworld = (function () {
    'use strict';

    var TILE = {
        GRASS: 0,
        TREE: 1,
        WATER: 2,
        PATH: 3
        // NPC tile markers will be added with the NPC segment.
    };

    var MOVE_DURATION_MS = 200; // one grid step takes this long

    var DIRECTION_DELTAS = {
        up: { dx: 0, dy: -1 },
        down: { dx: 0, dy: 1 },
        left: { dx: -1, dy: 0 },
        right: { dx: 1, dy: 0 }
    };

    // First map: a 20x15 forest clearing. TREE ring borders the map, a
    // WATER pond sits in the north-east, and a PATH runs from the south
    // clearing up to the pond's edge.
    var FIRST_MAP_SOURCE = [
        'TTTTTTTTTTTTTTTTTTTT',
        'TGGGGGGGGGGGGGGGGGGT',
        'TGGGGGGGGGGGWWWWWGGT',
        'TGGGGGGGGGGGWWWWWGGT',
        'TGGGGGPPPPPPWWWWWGGT',
        'TGGGGGGGPGGGWWWWWGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TTTTTTTTTTTTTTTTTTTT'
    ];

    var CHAR_TO_TILE = {
        G: TILE.GRASS,
        T: TILE.TREE,
        W: TILE.WATER,
        P: TILE.PATH
    };

    // ------------------------------------------------------------------
    // Map
    // ------------------------------------------------------------------

    function buildFirstMap() {
        return FIRST_MAP_SOURCE.map(function (row) {
            return row.split('').map(function (ch) {
                return CHAR_TO_TILE[ch];
            });
        });
    }

    // ------------------------------------------------------------------
    // Walkability
    // ------------------------------------------------------------------

    function isWalkableTile(map, x, y) {
        if (!map || y < 0 || y >= map.length) {
            return false;
        }
        var row = map[y];
        if (x < 0 || x >= row.length) {
            return false;
        }
        var tile = row[x];
        return tile !== TILE.TREE && tile !== TILE.WATER;
    }

    // ------------------------------------------------------------------
    // Player state
    // ------------------------------------------------------------------

    function createPlayerState(map, x, y, facing) {
        return {
            x: x,
            y: y,
            facing: facing || 'down',
            map: map,
            moving: {
                active: false,
                progress: 0,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y
            }
        };
    }

    function cloneState(state) {
        return {
            x: state.x,
            y: state.y,
            facing: state.facing,
            map: state.map, // shared read-only reference, never mutated
            moving: {
                active: state.moving.active,
                progress: state.moving.progress,
                fromX: state.moving.fromX,
                fromY: state.moving.fromY,
                toX: state.moving.toX,
                toY: state.moving.toY
            }
        };
    }

    function landAt(next) {
        next.x = next.moving.toX;
        next.y = next.moving.toY;
        next.moving.active = false;
        next.moving.progress = 0;
    }

    // ------------------------------------------------------------------
    // Movement state machine
    // ------------------------------------------------------------------

    /*
     * attemptMove(state, direction, dt) -> new state.
     * Pure: returns a fresh state object, never mutates the input.
     *
     * - While a step is active, input is locked: the direction is ignored
     *   (facing and destination do not change) and dt only advances the
     *   current step. When progress reaches MOVE_DURATION_MS the player
     *   lands exactly on the destination tile and input unlocks.
     * - While idle, facing always updates to the attempted direction,
     *   even if the move is blocked. A step starts only when the target
     *   tile is walkable; a blocked move leaves the position unchanged.
     * - Overshoot dt lands exactly on the destination tile and never
     *   continues into a further tile (strictly grid-to-grid).
     */
    function attemptMove(state, direction, dt) {
        var next = cloneState(state);
        var step = dt || 0;

        // Input locked while a step is in flight.
        if (next.moving.active) {
            next.moving.progress += step;
            if (next.moving.progress >= MOVE_DURATION_MS) {
                landAt(next);
            }
            return next;
        }

        var delta = DIRECTION_DELTAS[direction];
        if (!delta) {
            return next; // unknown direction: no-op
        }

        // Facing updates even when the move is blocked.
        next.facing = direction;

        var toX = next.x + delta.dx;
        var toY = next.y + delta.dy;

        if (!isWalkableTile(next.map, toX, toY)) {
            return next; // blocked: position stays on the current tile
        }

        next.moving.active = true;
        next.moving.progress = 0;
        next.moving.fromX = next.x;
        next.moving.fromY = next.y;
        next.moving.toX = toX;
        next.moving.toY = toY;

        // Advance this step by the same tick's dt; a huge dt completes
        // the step immediately, landing exactly on the target tile.
        next.moving.progress += step;
        if (next.moving.progress >= MOVE_DURATION_MS) {
            landAt(next);
        }
        return next;
    }

    return {
        TILE: TILE,
        MOVE_DURATION_MS: MOVE_DURATION_MS,
        DIRECTION_DELTAS: DIRECTION_DELTAS,
        buildFirstMap: buildFirstMap,
        isWalkableTile: isWalkableTile,
        createPlayerState: createPlayerState,
        attemptMove: attemptMove
    };
})();
