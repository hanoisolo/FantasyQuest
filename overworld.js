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
 *   MAPS                      map registry (id, name, source, encounter, npcs, warps)
 *   buildMap(id)              2D tile array for a registry map; null if unknown
 *   buildFirstMap()           alias of buildMap('forest')
 *   getMapConfig(id)          the registry entry; null if unknown
 *   warpAt(mapId, x, y)       warp entry at those coords or null
 *   applyWarp(state)         new state on the warp's target map (no-op clone
 *                             when not standing on a warp)
 *   pickEncounterEnemyFor(mapId, rng)  weighted enemy pick for that map's pool
 *   isWalkableTile(map, x, y) false for out-of-bounds, TREE, WATER, WALL
 *   createPlayerState(map, x, y, facing?, npcs?, mapId?)
 *   attemptMove(state, direction, dt) -> new state (input never mutated)
 */
var Overworld = (function () {
    'use strict';

    var TILE = {
        GRASS: 0,
        TREE: 1,
        WATER: 2,
        PATH: 3,
        WARP: 4,   // Phase 13: warp exit to another map (walkable)
        WALL: 5,   // Phase 13: solid cave wall (unwalkable, like TREE)
        FLOOR: 6   // Phase 13: walkable cave floor
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
    // clearing up to the pond's edge. Phase 13 warps: the south path end
    // (8,13) warps to the town, and the west clearing (1,2) warps to the
    // cave.
    var FIRST_MAP_SOURCE = [
        'TTTTTTTTTTTTTTTTTTTT',
        'TGGGGGGGGGGGGGGGGGGT',
        'TXGGGGGGGGGGWWWWWGGT',
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
        'TGGGGGGGXGGGGGGGGGGT',
        'TTTTTTTTTTTTTTTTTTTT'
    ];

    // Town map (Phase 13): ELDERBROOK — TREE border, PATH cross streets
    // (column x=8 from y=1 to y=12, row y=7 from x=1 to x=18), four TREE
    // building blocks, and the rest grass. The visible X warp at (8,13)
    // is the exit back to the forest; the town is safe from encounters.
    var TOWN_MAP_SOURCE = [
        'TTTTTTTTTTTTTTTTTTTT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGTTTGGPGGGGGTTTGGT',
        'TGGTTTGGPGGGGGTTTGGT',
        'TGGTTTGGPGGGGGTTTGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TPPPPPPPPPPPPPPPPPPT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGGGGGGPGGGGGGGGGGT',
        'TGGTTTGGPGGGGGTTTGGT',
        'TGGTTTGGPGGGGGTTTGGT',
        'TGGTTTGGPGGGGGTTTGGT',
        'TGGGGGGGXGGGGGGGGGGT',
        'TTTTTTTTTTTTTTTTTTTT'
    ];

    // Cave map (Phase 13): ECHO HOLLOW — WALL border, FLOOR interior,
    // three WALL clusters placed off the central y=7 lane so every
    // region stays reachable. The visible X warp at (1,7) is the exit
    // back to the forest. Wolf-weighted encounters.
    var CAVE_MAP_SOURCE = [
        'RRRRRRRRRRRRRRRRRRRR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RFFFRRRFFFFFRRRFFFFR',
        'RFFFRRRFFFFFRRRFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RXFFFFFFFFFFFFFFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RFFFFFFFRRRRFFFFFFFR',
        'RFFFFFFFRRRRFFFFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RFFFFFFFFFFFFFFFFFFR',
        'RRRRRRRRRRRRRRRRRRRR'
    ];

    var CHAR_TO_TILE = {
        G: TILE.GRASS,
        T: TILE.TREE,
        W: TILE.WATER,
        P: TILE.PATH,
        X: TILE.WARP,
        R: TILE.WALL,
        F: TILE.FLOOR
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
        },
        {
            id: 'merchant',
            name: 'Merchant',
            x: 6,   // grass two tiles west of the path
            y: 9,
            shop: true, // opens the potion shop on interaction
            dialogue: [
                'Psst! Potions, fresh from the pond road...',
                'Only 15 gold each. Care to browse my wares?'
            ]
        }
    ];

    // ------------------------------------------------------------------
    // Maps registry (Phase 13): each entry owns its source art, encounter
    // tuning, NPCs, and warp exits. encounter.pool entries are
    // [enemyId, weight] pairs walked cumulatively by pickEncounterEnemyFor.
    // ------------------------------------------------------------------

    var TOWN_NPCS = [
        {
            id: 'merchant',
            name: 'Merchant',
            x: 10,  // grass just east of the crossing
            y: 8,
            shop: true, // opens the potion shop on interaction
            dialogue: [
                'Welcome to Elderbrook! Finest potions on the crossroads.',
                'Only 15 gold each — the elder buys them by the crate.',
                'Care to browse my wares?'
            ]
        },
        {
            id: 'elder',
            name: 'Town Elder',
            x: 6,   // grass west of the north street
            y: 6,
            dialogue: [
                'Welcome to Elderbrook, traveler.',
                'A dark cave lies west of the forest clearing.',
                'Wolves howl in Echo Hollow. Prepare well before you enter.'
            ]
        }
    ];

    var MAPS = {
        forest: {
            id: 'forest',
            name: 'FOREST CLEARING',
            source: FIRST_MAP_SOURCE,
            encounter: {
                rate: 0.15,
                pool: [['goblin', 0.5], ['wolf', 0.5]]
            },
            npcs: NPCS,
            warps: [
                { x: 8, y: 13, toMap: 'town', toX: 8, toY: 12 },
                { x: 1, y: 2, toMap: 'cave', toX: 2, toY: 7 }
            ]
        },
        town: {
            id: 'town',
            name: 'ELDERBROOK',
            source: TOWN_MAP_SOURCE,
            encounter: { rate: 0, pool: [] }, // town is safe
            npcs: TOWN_NPCS,
            warps: [
                { x: 8, y: 13, toMap: 'forest', toX: 8, toY: 12 }
            ]
        },
        cave: {
            id: 'cave',
            name: 'ECHO HOLLOW',
            source: CAVE_MAP_SOURCE,
            encounter: {
                rate: 0.20,
                pool: [['wolf', 0.7], ['goblin', 0.3]]
            },
            npcs: [],
            warps: [
                { x: 1, y: 7, toMap: 'forest', toX: 2, toY: 2 }
            ]
        }
    };

    // ------------------------------------------------------------------
    // Map
    // ------------------------------------------------------------------

    function getMapConfig(id) {
        return (id && MAPS[id]) || null;
    }

    function buildMap(id) {
        var cfg = getMapConfig(id);
        if (!cfg) {
            return null;
        }
        return cfg.source.map(function (row) {
            return row.split('').map(function (ch) {
                return CHAR_TO_TILE[ch];
            });
        });
    }

    /*
     * warpAt(mapId, x, y) -> warp entry or null.
     * Warp exits are registry data, independent of the tile grid.
     */
    function warpAt(mapId, x, y) {
        var cfg = getMapConfig(mapId);
        if (!cfg) {
            return null;
        }
        for (var i = 0; i < cfg.warps.length; i++) {
            var warp = cfg.warps[i];
            if (warp.x === x && warp.y === y) {
                return warp;
            }
        }
        return null;
    }

    /*
     * applyWarp(state) -> new state.
     * Standing on a warp exit: returns a fresh player state on the target
     * map (rebuilt grid, target NPCs and map id), facing preserved, step
     * movement reset to idle, and the encounter fully reset. Standing on
     * a normal tile: an unchanged clone. Pure — input never mutated.
     */
    function applyWarp(state) {
        var target = warpAt(state.mapId || 'forest', state.x, state.y);
        if (!target) {
            return cloneState(state);
        }
        return createPlayerState(
            buildMap(target.toMap),
            target.toX,
            target.toY,
            state.facing,
            getMapConfig(target.toMap).npcs,
            target.toMap
        );
    }

    // buildFirstMap stays the forest map entry point (Phase 11 callers).
    function buildFirstMap() {
        return buildMap('forest');
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
        return tile !== TILE.TREE && tile !== TILE.WATER && tile !== TILE.WALL;
    }

    // ------------------------------------------------------------------
    // Player state
    // ------------------------------------------------------------------

    function createPlayerState(map, x, y, facing, npcs, mapId) {
        return {
            x: x,
            y: y,
            facing: facing || 'down',
            map: map,
            mapId: mapId || 'forest',
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
            mapId: state.mapId,
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
     * Forest 50/50 pick, kept for backward compatibility.
     * rng is injectable; defaults to Math.random.
     */
    function pickEncounterEnemy(rng) {
        var roll = rng ? rng() : Math.random();
        return roll < 0.5 ? ENCOUNTER_ENEMY_POOL[0] : ENCOUNTER_ENEMY_POOL[1];
    }

    /*
     * pickEncounterEnemyFor(mapId, rng) -> enemy id or null.
     * Weighted pick from that map's encounter pool: a cumulative walk
     * over the [enemyId, weight] entries. Returns the last entry when the
     * roll lands past the total weight, and null for an empty pool.
     * rng is injectable; defaults to Math.random.
     */
    function pickEncounterEnemyFor(mapId, rng) {
        var cfg = getMapConfig(mapId) || MAPS.forest;
        var pool = cfg.encounter.pool;
        if (pool.length === 0) {
            return null;
        }
        var roll = rng ? rng() : Math.random();
        var cumulative = 0;
        for (var i = 0; i < pool.length; i++) {
            cumulative += pool[i][1];
            if (roll < cumulative) {
                return pool[i][0];
            }
        }
        return pool[pool.length - 1][0];
    }

    /*
     * registerStep(state, rng) -> new state (input never mutated).
     * Called by the scene layer after each successful move onto walkable
     * terrain. Rate, pool, and (optional) grace come from the current
     * map's registry entry; maps without an explicit grace keep the
     * ENCOUNTER_GRACE_STEPS default. The first grace steps after entering
     * the map or after the last battle never trigger, so the player is
     * never ambushed immediately. After the grace period each step rolls
     * rng(); a roll under the map's rate triggers an encounter and picks
     * the enemy with a second weighted roll.
     */
    function registerStep(state, rng) {
        var next = cloneState(state);
        var cfg = getMapConfig(state.mapId || 'forest') || MAPS.forest;
        var grace = (typeof cfg.encounter.grace === 'number')
            ? cfg.encounter.grace
            : ENCOUNTER_GRACE_STEPS;
        next.encounter.stepsSinceReset = state.encounter.stepsSinceReset + 1;
        next.encounter.triggered = false;

        if (next.encounter.stepsSinceReset <= grace) {
            return next; // grace period: no roll, no ambush
        }

        var roll = rng ? rng() : Math.random();
        if (roll < cfg.encounter.rate) {
            next.encounter.triggered = true;
            next.encounter.lastEnemyId =
                pickEncounterEnemyFor(state.mapId || 'forest', rng);
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

    // ------------------------------------------------------------------
    // Shop (Phase 12) — pure state machine for the Merchant
    // ------------------------------------------------------------------

    function cloneShop(shop) {
        return {
            open: shop.open,
            merchantId: shop.merchantId,
            lastMessage: shop.lastMessage
        };
    }

    /*
     * openShop(npc) -> shop state. The scene layer opens this after the
     * merchant's dialogue line; menu entries are "Buy Potion - <price> G"
     * and "Leave".
     */
    function openShop(npc) {
        var P = getProgression();
        var price = P && typeof P.POTION_PRICE === 'number' ? P.POTION_PRICE : 15;
        return {
            open: true,
            merchantId: npc ? npc.id : null,
            lastMessage: 'Welcome! Potions are ' + price + ' gold.'
        };
    }

    function getProgression() {
        if (typeof window !== 'undefined' && window.Progression) {
            return window.Progression;
        }
        if (typeof Progression !== 'undefined') {
            return Progression;
        }
        return null;
    }

    /*
     * shopBuy(shop, profile) -> new shop state; the shop stays open for
     * another purchase on both success and failure. Buying routes through
     * Progression.buyPotion, which updates profile.gold/potions in place
     * on success and leaves them untouched on failure.
     */
    function shopBuy(shop, profile) {
        var next = cloneShop(shop);
        if (!next.open) {
            return next; // nothing for sale once the shop is closed
        }
        var P = getProgression();
        if (!P || typeof P.buyPotion !== 'function') {
            next.lastMessage = 'The shelves are empty today...';
            return next;
        }
        if (P.buyPotion(profile)) {
            next.lastMessage = 'Potion purchased! Anything else?';
        } else {
            next.lastMessage = 'Not enough gold!';
        }
        return next;
    }

    /*
     * shopLeave(shop) -> closed shop state. The scene layer restores
     * exploration control (movement and encounters) when this returns.
     */
    function shopLeave(shop) {
        var next = cloneShop(shop);
        next.open = false;
        next.lastMessage = '';
        return next;
    }

    return {
        TILE: TILE,
        MOVE_DURATION_MS: MOVE_DURATION_MS,
        DIRECTION_DELTAS: DIRECTION_DELTAS,
        ENCOUNTER_RATE: ENCOUNTER_RATE,
        ENCOUNTER_GRACE_STEPS: ENCOUNTER_GRACE_STEPS,
        NPCS: NPCS,
        MAPS: MAPS,
        buildFirstMap: buildFirstMap,
        buildMap: buildMap,
        getMapConfig: getMapConfig,
        warpAt: warpAt,
        applyWarp: applyWarp,
        pickEncounterEnemyFor: pickEncounterEnemyFor,
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
        endDialogue: endDialogue,
        openShop: openShop,
        shopBuy: shopBuy,
        shopLeave: shopLeave
    };
})();
