'use strict';
/*
 * FantasyQuest Phase 11 - overworld logic test harness (Node.js).
 * Loads the pure overworld.js module (no DOM) and covers tile
 * walkability, the map, and the grid-to-grid movement state machine.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ---- Load the module into a bare sandbox (no DOM available) ------------
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'overworld.js'), 'utf8'),
  sandbox,
  { filename: 'overworld.js' }
);
const Overworld = sandbox.window.Overworld || sandbox.Overworld;

// ---- Tiny assertion kit ------------------------------------------------
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '  (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// ---- Module shape -------------------------------------------------------
console.log('\n== Phase 11: Overworld logic ==');

ok(typeof Overworld === 'object' && Overworld !== null, 'Overworld global is defined');
eq(Overworld.TILE.GRASS, 0, 'TILE.GRASS constant');
eq(Overworld.TILE.TREE, 1, 'TILE.TREE constant');
eq(Overworld.TILE.WATER, 2, 'TILE.WATER constant');
eq(Overworld.TILE.PATH, 3, 'TILE.PATH constant');

const map = Overworld.buildFirstMap();
eq(map.length, 15, 'map has 15 rows (~20x15 map)');
ok(map.every(row => row.length === 20), 'every row is 20 tiles wide');

// Border ring must be all trees
let borderAllTrees = true;
for (let x = 0; x < 20; x++) {
  if (map[0][x] !== Overworld.TILE.TREE) borderAllTrees = false;
  if (map[14][x] !== Overworld.TILE.TREE) borderAllTrees = false;
}
for (let y = 0; y < 15; y++) {
  if (map[y][0] !== Overworld.TILE.TREE) borderAllTrees = false;
  if (map[y][19] !== Overworld.TILE.TREE) borderAllTrees = false;
}
ok(borderAllTrees, 'map border is a solid TREE ring');

const flat = [].concat(...map);
ok(flat.includes(Overworld.TILE.WATER), 'map contains a WATER pond');
ok(flat.includes(Overworld.TILE.PATH), 'map contains PATH tiles');
ok(flat.includes(Overworld.TILE.GRASS), 'map contains GRASS tiles');
ok(map[12][8] === Overworld.TILE.PATH, 'player start tile (8,12) is PATH');

// ---- isWalkableTile ------------------------------------------------------
eq(Overworld.isWalkableTile(map, 2, 2), true, 'GRASS is walkable');
eq(Overworld.isWalkableTile(map, 8, 12), true, 'PATH is walkable');
eq(Overworld.isWalkableTile(map, 1, 0), false, 'TREE is not walkable');
eq(Overworld.isWalkableTile(map, 13, 2), false, 'WATER is not walkable');
eq(Overworld.isWalkableTile(map, -1, 2), false, 'out-of-bounds x=-1 rejected');
eq(Overworld.isWalkableTile(map, 20, 2), false, 'out-of-bounds x=20 rejected');
eq(Overworld.isWalkableTile(map, 2, -1), false, 'out-of-bounds y=-1 rejected');
eq(Overworld.isWalkableTile(map, 2, 15), false, 'out-of-bounds y=15 rejected');
eq(Overworld.isWalkableTile(null, 2, 2), false, 'null map rejected');

// ---- Player state --------------------------------------------------------
const start = Overworld.createPlayerState(map, 8, 12);
eq(start.x, 8, 'player starts at x=8');
eq(start.y, 12, 'player starts at y=12');
eq(start.facing, 'down', 'default facing is down');
eq(start.moving.active, false, 'player starts idle');
eq(start.moving.progress, 0, 'step progress starts at 0');

// ---- attemptMove: walkable step ------------------------------------------
const s1 = Overworld.attemptMove(start, 'down', 0);
eq(s1.moving.active, true, 'walkable move starts a step');
eq(s1.facing, 'down', 'facing updates to the walkable move direction');
eq(s1.moving.toX, 8, 'step destination x is one tile down');
eq(s1.moving.toY, 13, 'step destination y is one tile down');
eq(s1.x, 8, 'position stays on the origin tile while the step is in flight');
eq(s1.y, 12, 'position stays on the origin tile while the step is in flight');

const s2 = Overworld.attemptMove(s1, 'down', Overworld.MOVE_DURATION_MS);
eq(s2.x, 8, 'completed step lands on destination x exactly');
eq(s2.y, 13, 'completed step lands on destination y exactly');
eq(s2.moving.active, false, 'input unlocks after the step completes');
eq(s2.moving.progress, 0, 'progress resets after the step completes');

// ---- attemptMove: blocked moves ------------------------------------------
const blockedTree = Overworld.attemptMove(
  Overworld.createPlayerState(map, 8, 13), 'down', 16);
eq(blockedTree.x, 8, 'blocked move (TREE) keeps x position');
eq(blockedTree.y, 13, 'blocked move (TREE) keeps y position');
eq(blockedTree.moving.active, false, 'blocked move (TREE) starts no step');
eq(blockedTree.facing, 'down', 'facing updates even when blocked by TREE');

const blockedWater = Overworld.attemptMove(
  Overworld.createPlayerState(map, 11, 4), 'right', 16);
eq(blockedWater.x, 11, 'blocked move (WATER) keeps x position');
eq(blockedWater.y, 4, 'blocked move (WATER) keeps y position');
eq(blockedWater.moving.active, false, 'blocked move (WATER) starts no step');
eq(blockedWater.facing, 'right', 'facing updates even when blocked by WATER');

// Boundary corners: interior tile (1,1) hemmed in by the TREE ring
const corner = Overworld.createPlayerState(map, 1, 1);
const cornerUp = Overworld.attemptMove(corner, 'up', 16);
eq(cornerUp.x, 1, 'corner: up blocked, x unchanged');
eq(cornerUp.y, 1, 'corner: up blocked, y unchanged');
eq(cornerUp.facing, 'up', 'corner: facing follows blocked up attempt');
const cornerLeft = Overworld.attemptMove(cornerUp, 'left', 16);
eq(cornerLeft.x, 1, 'corner: left blocked, x unchanged');
eq(cornerLeft.facing, 'left', 'corner: facing follows blocked left attempt');

// ---- Input lock during a step ---------------------------------------------
let locked = Overworld.attemptMove(start, 'down', 60); // mid-step, 60/200ms
locked = Overworld.attemptMove(locked, 'up', 40);      // opposite input arrives
eq(locked.facing, 'down', 'input locked mid-step: facing does not change');
eq(locked.moving.toY, 13, 'input locked mid-step: destination does not change');
eq(locked.moving.active, true, 'input locked mid-step: still stepping');
eq(locked.moving.progress, 100, 'mid-step dt accumulates (60 + 40 = 100)');

// Step completion unlocks input
let done = Overworld.attemptMove(locked, 'down', 100); // 100 + 100 >= 200
eq(done.x, 8, 'locked accumulation completes the step (x)');
eq(done.y, 13, 'locked accumulation completes the step (y)');
eq(done.moving.active, false, 'step completion unlocks input');
const nextStep = Overworld.attemptMove(done, 'up', 0);
eq(nextStep.moving.active, true, 'new step can start after unlock');
eq(nextStep.moving.toY, 12, 'new step targets the attempted tile');

// ---- Delta-time accumulation and exact landing -----------------------------
let acc = Overworld.attemptMove(start, 'down', 80);
acc = Overworld.attemptMove(acc, 'down', 80);   // 160/200, still moving
eq(acc.moving.active, true, 'dt below duration does not complete the step');
acc = Overworld.attemptMove(acc, 'down', 80);   // 240/200 -> land exactly
eq(acc.x, 8, 'accumulated dt lands exactly (x)');
eq(acc.y, 13, 'accumulated dt lands exactly (y)');
eq(acc.moving.active, false, 'accumulated dt completes the step');
eq(acc.moving.progress, 0, 'landing resets progress to 0');

// Huge dt: lands exactly one tile, never overshoots
const jump = Overworld.attemptMove(start, 'down', 5000);
eq(jump.x, 8, 'huge dt lands exactly one tile (x)');
eq(jump.y, 13, 'huge dt lands exactly one tile (y)');
eq(jump.moving.active, false, 'huge dt completes the step');
eq(jump.y - start.y, 1, 'huge dt never overshoots past the destination');

// ---- No mutation of input state ---------------------------------------------
const before = JSON.stringify(start);
Overworld.attemptMove(start, 'down', 0);          // walkable
Overworld.attemptMove(start, 'down', 5000);       // instant completion
Overworld.attemptMove(start, 'up', 0);            // walkable other direction
Overworld.attemptMove(start, 'down', 60);        // mid-step
Overworld.attemptMove(start, 'north-east', 60);   // unknown direction
const after = JSON.stringify(start);
ok(before === after, 'attemptMove never mutates the input state');

// Unknown direction is a no-op
const noop = Overworld.attemptMove(start, 'sideways', 60);
eq(noop.x, start.x, 'unknown direction: x unchanged');
eq(noop.facing, start.facing, 'unknown direction: facing unchanged');
eq(noop.moving.active, false, 'unknown direction: no step starts');

// ---- Result ------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
