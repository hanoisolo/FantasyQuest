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

// ---- Random encounters (Phase 11 Segment 3) -------------------------------
console.log('\n== Phase 11: Random encounters ==');

// Injectable rng: returns values from a fixed sequence in order.
function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

eq(Overworld.ENCOUNTER_RATE, 0.15, 'ENCOUNTER_RATE is 0.15');
eq(Overworld.ENCOUNTER_GRACE_STEPS, 3, 'ENCOUNTER_GRACE_STEPS is 3');

// Encounter state is initialized with every fresh player state
const enc0 = Overworld.createPlayerState(map, 8, 12);
eq(enc0.encounter.stepsSinceReset, 0, 'encounter counter starts at 0');
eq(enc0.encounter.triggered, false, 'encounter starts not triggered');

// First 3 steps never trigger, even with a guaranteed "hit" roll
let grace = enc0;
grace = Overworld.registerStep(grace, seq([0.0]));
eq(grace.encounter.triggered, false, 'step 1 in grace period: no encounter');
eq(grace.encounter.stepsSinceReset, 1, 'step 1 increments the counter');
grace = Overworld.registerStep(grace, seq([0.0]));
eq(grace.encounter.triggered, false, 'step 2 in grace period: no encounter');
grace = Overworld.registerStep(grace, seq([0.0]));
eq(grace.encounter.triggered, false, 'step 3 in grace period: no encounter');
eq(grace.encounter.stepsSinceReset, 3, 'counter reads 3 after the grace steps');

// Step 4 with a roll under the rate triggers
// roll sequence: [trigger roll 0.1, enemy pick roll 0.9] -> 0.1 < 0.15, 0.9 >= 0.5 -> wolf
const trig = Overworld.registerStep(grace, seq([0.1, 0.9]));
eq(trig.encounter.triggered, true, 'roll 0.1 under rate on step 4 triggers');
eq(trig.encounter.lastEnemyId, 'wolf', 'enemy pick roll 0.9 selects wolf');
eq(trig.encounter.stepsSinceReset, 0, 'counter resets to 0 when an encounter triggers');

// Step 4 with a roll at/above the rate does not trigger
const noTrig = Overworld.registerStep(grace, seq([0.9, 0.9]));
eq(noTrig.encounter.triggered, false, 'roll 0.9 above rate does not trigger');
eq(noTrig.encounter.stepsSinceReset, 4, 'counter keeps counting when no trigger');

// Enemy pick lower half selects goblin: pick roll 0.3 -> 0.3 < 0.5
const trigGoblin = Overworld.registerStep(grace, seq([0.0, 0.3]));
eq(trigGoblin.encounter.lastEnemyId, 'goblin', 'enemy pick roll 0.3 selects goblin');
eq(trigGoblin.encounter.triggered, true, 'roll 0.0 under rate triggers');

// pickEncounterEnemy 50/50 split
eq(Overworld.pickEncounterEnemy(seq([0.49])), 'goblin', 'pick roll just under 0.5 -> goblin');
eq(Overworld.pickEncounterEnemy(seq([0.5])), 'wolf', 'pick roll at 0.5 -> wolf');

// Counter resets after a battle: next 3 steps safe, 4th can trigger again
let post = Overworld.resetEncounterCounter(trig);
eq(post.encounter.stepsSinceReset, 0, 'resetEncounterCounter zeroes the counter');
eq(post.encounter.triggered, false, 'resetEncounterCounter clears the trigger flag');
post = Overworld.registerStep(post, seq([0.0]));
post = Overworld.registerStep(post, seq([0.0]));
post = Overworld.registerStep(post, seq([0.0]));
eq(post.encounter.triggered, false, 'after battle reset: grace steps do not trigger');
post = Overworld.registerStep(post, seq([0.05, 0.2]));
eq(post.encounter.triggered, true, 'after battle reset: 4th step can trigger again');

// Blocked moves do not register steps: the movement state machine leaves the
// encounter counter untouched when a move is blocked or in flight.
const blockedState = Overworld.attemptMove(
  Overworld.createPlayerState(map, 8, 13), 'down', 16); // tree border below
eq(blockedState.encounter.stepsSinceReset, 0, 'blocked move does not register a step');
const steppedState = Overworld.attemptMove(enc0, 'down', 60); // step in flight
eq(steppedState.encounter.stepsSinceReset, 0, 'mid-step (not landed) does not register a step');

// registerStep is pure: input state is never mutated
const beforeEnc = JSON.stringify(trig);
Overworld.registerStep(trig, seq([0.0, 0.0]));
Overworld.resetEncounterCounter(trig);
eq(JSON.stringify(trig), beforeEnc, 'registerStep/resetEncounterCounter never mutate input');

// registerStep works without an injected rng (defaults to Math.random)
let threw = false;
try { Overworld.registerStep(enc0); } catch (e) { threw = true; }
ok(!threw, 'registerStep runs without an injected rng');

// ---- NPCs and dialogue (Phase 11 Segment 4) --------------------------------
console.log('\n== Phase 11: NPCs and dialogue ==');

eq(Overworld.NPCS.length, 2, 'two NPCs are defined on the map');
eq(Overworld.NPCS[0].id, 'villager', 'first NPC is the villager');
eq(Overworld.NPCS[1].id, 'guard', 'second NPC is the guard');
ok(Overworld.NPCS[0].dialogue.length >= 2 && Overworld.NPCS[1].dialogue.length >= 2,
  'each NPC carries a multi-line dialogue');
eq(Overworld.isWalkableTile(map, Overworld.NPCS[0].x, Overworld.NPCS[0].y), true,
  'villager stands on walkable terrain');
eq(Overworld.isWalkableTile(map, Overworld.NPCS[1].x, Overworld.NPCS[1].y), true,
  'guard stands on walkable terrain');

// Walking into an NPC tile is blocked (villager at 9,9)
const npcBlocked = Overworld.attemptMove(
  Overworld.createPlayerState(map, 8, 9), 'right', 16);
eq(npcBlocked.x, 8, 'move into the villager tile is blocked (x stays)');
eq(npcBlocked.y, 9, 'move into the villager tile is blocked (y stays)');
eq(npcBlocked.moving.active, false, 'blocked NPC move starts no step');
eq(npcBlocked.facing, 'right', 'facing updates even when an NPC blocks the move');

const guardBlocked = Overworld.attemptMove(
  Overworld.createPlayerState(map, 11, 4), 'down', 16);
eq(guardBlocked.moving.active, false, 'move into the guard tile is blocked');

// getFacingNpc: correct NPC for each direction, null when none
const facingVillager = Overworld.createPlayerState(map, 8, 9, 'right');
eq(Overworld.getFacingNpc(map, Overworld.NPCS, facingVillager).id, 'villager',
  'facing right toward the villager returns the villager');
const facingLeftNothing = Overworld.createPlayerState(map, 8, 9, 'left');
eq(Overworld.getFacingNpc(map, Overworld.NPCS, facingLeftNothing), null,
  'facing left with no NPC there returns null');
const facingGuardFromPath = Overworld.createPlayerState(map, 11, 4, 'down');
eq(Overworld.getFacingNpc(map, Overworld.NPCS, facingGuardFromPath).id, 'guard',
  'facing down toward the guard returns the guard');
const facingGuardFromBelow = Overworld.createPlayerState(map, 11, 6, 'up');
eq(Overworld.getFacingNpc(map, Overworld.NPCS, facingGuardFromBelow).id, 'guard',
  'facing up toward the guard returns the guard');
const facingNothing = Overworld.createPlayerState(map, 3, 8, 'down');
eq(Overworld.getFacingNpc(map, Overworld.NPCS, facingNothing), null,
  'facing open grass returns null');

// Dialogue state machine: start, advance line by line, end after the last line
const villager = Overworld.NPCS[0];
const d0 = Overworld.startDialogue(villager);
eq(d0.npcId, 'villager', 'dialogue tracks the NPC id');
eq(d0.index, 0, 'dialogue starts at line 0');
eq(d0.open, true, 'dialogue starts open');
const d1 = Overworld.advanceDialogue(d0);
eq(d1.index, 1, 'first advance moves to line 1');
eq(d1.open, true, 'dialogue stays open mid-lines');
const dLast = Overworld.advanceDialogue(d1);
eq(dLast.index, 2, 'second advance reaches the last line');
eq(dLast.open, true, 'dialogue is still open on the last line');
const dEnd = Overworld.advanceDialogue(dLast);
eq(dEnd.open, false, 'advancing off the last line ends the dialogue');
const dPast = Overworld.advanceDialogue(dEnd);
eq(dPast.open, false, 'dialogue cannot advance past the end');
eq(dPast.index, dEnd.index, 'index does not change once the dialogue ended');
const dForced = Overworld.endDialogue(d0);
eq(dForced.open, false, 'endDialogue closes an open dialogue early');

// Purity: dialogue functions never mutate their input
const beforeDlg = JSON.stringify(dLast);
Overworld.advanceDialogue(dLast);
Overworld.endDialogue(dLast);
eq(JSON.stringify(dLast), beforeDlg, 'advanceDialogue/endDialogue never mutate input');

// Player state carries the NPC list and it survives movement cloning
eq(Overworld.createPlayerState(map, 8, 12).npcs.length, 2,
  'player state carries the default NPC list');
const npcCarry = Overworld.attemptMove(Overworld.createPlayerState(map, 8, 12), 'down', 16);
eq(npcCarry.npcs.length, 2, 'NPC list is preserved across attemptMove');

// ---- Result ------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
