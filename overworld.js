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

    // Random encounter tuning (Phase 11 Segment 3).
    var ENCOUNTER_RATE = 0.15;          // chance per registered step
    var ENCOUNTER_GRACE_STEPS = 3;      // safe steps after entering / last battle
    var ENCOUNTER_ENEMY_POOL = ['goblin', 'wolf']; // 50/50 weight

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

    // Non-hostile NPCs on the first map (Phase 11 Segment 4).
    // Marker art later: assets/sprites/<id>_map.png — ids stay stable.
    var NPCS = [
        {
            id: 'villager',
            name: 'Old Villager',
            x: 9,   // grass beside the path
            y: 9,
            dialogue: [
                'Ah, a fresh face in the forest clearing...',
                'Beware the pond path, traveler. Goblins lurk beyond.',
                'Take the crystal relic with you. It may save your life.'
            ]
        },
        {
            id: 'guard',
            name: 'Pond Guard',
            x: 11,  // grass at the pond's edge, by the path end
            y: 5,
            dialogue: [
                'Halt! This pond feeds the whole clearing.',
                'Shadow wolves drink here at dusk. Stay sharp.',
                'Move along the path, and keep your blade ready.'
            ]
        }
    ];

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

    function createPlayerState(map, x, y, facing, npcs) {
        return {
            x: x,
            y: y,
            facing: facing || 'down',
            map: map,
            npcs: npcs || NPCS, // shared read-only reference, never mutated
            moving: {
                active: false,
                progress: 0,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y
            },
            encounter: {
                stepsSinceReset: 0, // steps counted toward the next encounter roll
                triggered: false,   // true when the last registerStep rolled an encounter
                lastEnemyId: null   // 'goblin' | 'wolf' when triggered
            }
        };
    }

    function cloneState(state) {
        return {
            x: state.x,
            y: state.y,
            facing: state.facing,
            map: state.map, // shared read-only reference, never mutated
            npcs: state.npcs, // shared read-only reference, never mutated
            moving: {
                active: state.moving.active,
                progress: state.moving.progress,
                fromX: state.moving.fromX,
                fromY: state.moving.fromY,
                toX: state.moving.toX,
                toY: state.moving.toY
            },
            encounter: {
                stepsSinceReset: state.encounter.stepsSinceReset,
                triggered: state.encounter.triggered,
                lastEnemyId: state.encounter.lastEnemyId
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

        // Blocked by terrain or by an NPC standing on the target tile.
        if (!isWalkableTile(next.map, toX, toY) || npcAt(next.npcs, toX, toY)) {
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

    // ------------------------------------------------------------------
    // Random encounters (pure logic)
    // ------------------------------------------------------------------

    /*
     * pickEncounterEnemy(rng) -> 'goblin' | 'wolf' (50/50 weight).
     * rng is injectable; defaults to Math.random.
     */
    function pickEncounterEnemy(rng) {
        var roll = rng ? rng() : Math.random();
        return roll < 0.5 ? ENCOUNTER_ENEMY_POOL[0] : ENCOUNTER_ENEMY_POOL[1];
    }

    /*
     * registerStep(state, rng) -> new state (input never mutated).
     * Called by the scene layer after each successful move onto walkable
     * terrain. The first ENCOUNTER_GRACE_STEPS steps after entering the map
     * or after the last battle never trigger, so the player is never
     * ambushed immediately. From step ENCOUNTER_GRACE_STEPS + 1 on, each
     * step rolls rng(); a roll under ENCOUNTER_RATE triggers an encounter
     * and picks the enemy with a second roll.
     */
    function registerStep(state, rng) {
        var next = cloneState(state);
        next.encounter.stepsSinceReset = state.encounter.stepsSinceReset + 1;
        next.encounter.triggered = false;

        if (next.encounter.stepsSinceReset <= ENCOUNTER_GRACE_STEPS) {
            return next; // grace period: no roll, no ambush
        }

        var roll = rng ? rng() : Math.random();
        if (roll < ENCOUNTER_RATE) {
            next.encounter.triggered = true;
            next.encounter.lastEnemyId = pickEncounterEnemy(rng);
            next.encounter.stepsSinceReset = 0; // fresh grace after this battle
        }
        return next;
    }

    /*
     * resetEncounterCounter(state) -> new state.
     * Called when returning to the map after a battle so the next
     * ENCOUNTER_GRACE_STEPS steps are safe again.
     */
    function resetEncounterCounter(state) {
        var next = cloneState(state);
        next.encounter.stepsSinceReset = 0;
        next.encounter.triggered = false;
        return next;
    }

    // ------------------------------------------------------------------
    // NPCs and dialogue (pure logic)
    // ------------------------------------------------------------------

    function npcAt(npcs, x, y) {
        for (var i = 0; i < npcs.length; i++) {
            if (npcs[i].x === x && npcs[i].y === y) {
                return npcs[i];
            }
        }
        return null;
    }

    /*
     * getFacingNpc(map, npcs, player) -> NPC or null.
     * Returns the NPC standing on the tile directly in front of the
     * player, based on the player's facing direction.
     */
    function getFacingNpc(map, npcs, player) {
        var delta = DIRECTION_DELTAS[player.facing];
        if (!delta) {
            return null;
        }
        return npcAt(npcs, player.x + delta.dx, player.y + delta.dy);
    }

    function cloneDialogue(d) {
        return {
            npcId: d.npcId,
            name: d.name,
            lines: d.lines, // shared read-only reference, never mutated
            index: d.index,
            open: d.open
        };
    }

    /*
     * Dialogue state machine — pure, one line per advance call:
     *   startDialogue(npc)  -> fresh open dialogue at line 0
     *   advanceDialogue(d)  -> next line; advancing off the last line
     *                          closes the dialogue; a closed dialogue
     *                          cannot advance further
     *   endDialogue(d)      -> closed dialogue (same line preserved)
     */
    function startDialogue(npc) {
        return {
            npcId: npc.id,
            name: npc.name,
            lines: npc.dialogue.slice(0),
            index: 0,
            open: true
        };
    }

    function advanceDialogue(dialogue) {
        var next = cloneDialogue(dialogue);
        if (!next.open) {
            return next; // cannot advance past the end
        }
        if (next.index < next.lines.length - 1) {
            next.index += 1;
            return next;
        }
        next.open = false; // advancing off the last line ends the dialogue
        return next;
    }

    function endDialogue(dialogue) {
        var next = cloneDialogue(dialogue);
        next.open = false;
        return next;
    }

    return {
        TILE: TILE,
        MOVE_DURATION_MS: MOVE_DURATION_MS,
        DIRECTION_DELTAS: DIRECTION_DELTAS,
        ENCOUNTER_RATE: ENCOUNTER_RATE,
        ENCOUNTER_GRACE_STEPS: ENCOUNTER_GRACE_STEPS,
        NPCS: NPCS,
        buildFirstMap: buildFirstMap,
        isWalkableTile: isWalkableTile,
        createPlayerState: createPlayerState,
        attemptMove: attemptMove,
        registerStep: registerStep,
        resetEncounterCounter: resetEncounterCounter,
        pickEncounterEnemy: pickEncounterEnemy,
        npcAt: npcAt,
        getFacingNpc: getFacingNpc,
        startDialogue: startDialogue,
        advanceDialogue: advanceDialogue,
        endDialogue: endDialogue
    };
})();
