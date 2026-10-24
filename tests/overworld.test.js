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
// Phase 12: the shop routes purchases through Progression.buyPotion,
// so progression.js must be loaded before overworld.js.
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'progression.js'), 'utf8'),
  sandbox,
  { filename: 'progression.js' }
);
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

// UPDATED for Phase 12: was 2 ("two NPCs are defined on the map"); the
// Merchant NPC was added to the map, superseding the two-NPC design.
eq(Overworld.NPCS.length, 3, 'three NPCs are defined on the map (villager, guard, merchant)');
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
// UPDATED for Phase 12: was 2; the default NPC list now includes the Merchant.
eq(Overworld.createPlayerState(map, 8, 12).npcs.length, 3,
  'player state carries the default NPC list');
const npcCarry = Overworld.attemptMove(Overworld.createPlayerState(map, 8, 12), 'down', 16);
// UPDATED for Phase 12: was 2; the NPC list now includes the Merchant.
eq(npcCarry.npcs.length, 3, 'NPC list is preserved across attemptMove');

// ---- Merchant NPC and shop (Phase 12 Segment 3) -----------------------------
console.log('\n== Phase 12: Merchant NPC and shop ==');

const merchant = Overworld.NPCS.find(n => n.id === 'merchant');
ok(merchant !== undefined, 'merchant NPC is defined');
eq(merchant.x, 6, 'merchant stands at tile x=6');
eq(merchant.y, 9, 'merchant stands at tile y=9');
eq(Overworld.isWalkableTile(map, merchant.x, merchant.y), true,
  'merchant tile is free terrain (grass), not a blocked tile');
eq(merchant.shop, true, 'merchant carries the shop flag');
ok(Overworld.NPCS.every((n, i, all) => all.findIndex(m => m.x === n.x && m.y === n.y) === i),
  'no two NPCs occupy the same tile');
ok(merchant.dialogue.length >= 2, 'merchant has a multi-line dialogue before the shop');

// Merchant tile blocks movement, like every NPC
const merchantBlockLeft = Overworld.attemptMove(
  Overworld.createPlayerState(map, 5, 9), 'right', 16);
eq(merchantBlockLeft.x, 5, 'walking right into the merchant is blocked (x stays)');
eq(merchantBlockLeft.moving.active, false, 'blocked merchant move starts no step');
const merchantBlockRight = Overworld.attemptMove(
  Overworld.createPlayerState(map, 7, 9), 'left', 16);
eq(merchantBlockRight.x, 7, 'walking left into the merchant is blocked (x stays)');
eq(merchantBlockRight.facing, 'left', 'facing updates even when the merchant blocks the move');

// Facing the merchant returns them for interaction
const facingMerchant = Overworld.createPlayerState(map, 5, 9, 'right');
eq(Overworld.getFacingNpc(map, Overworld.NPCS, facingMerchant).id, 'merchant',
  'getFacingNpc returns the merchant when facing them');

// Shop state machine
ok(typeof Overworld.openShop === 'function', 'Overworld.openShop() exists');
ok(typeof Overworld.shopBuy === 'function', 'Overworld.shopBuy() exists');
ok(typeof Overworld.shopLeave === 'function', 'Overworld.shopLeave() exists');

const shop0 = Overworld.openShop(merchant);
eq(shop0.open, true, 'openShop opens the shop');
eq(shop0.merchantId, 'merchant', 'shop tracks the merchant id');
ok(shop0.lastMessage.indexOf('15') !== -1, 'shop greeting quotes the potion price');

// Successful buy: gold spent, potion gained, shop stays open
const richProfile = { gold: 15, potions: 1 };
const shop1 = Overworld.shopBuy(shop0, richProfile);
eq(shop1.open, true, 'shop stays open after a successful purchase');
eq(richProfile.gold, 0, 'successful buy spends 15 gold');
eq(richProfile.potions, 2, 'successful buy adds one potion');
ok(shop1.lastMessage.indexOf('Potion purchased') !== -1,
  'successful buy shows a confirmation line');

// Insufficient gold: state untouched, shop stays open
const poorProfile = { gold: 14, potions: 2 };
const shop2 = Overworld.shopBuy(shop0, poorProfile);
eq(shop2.open, true, 'shop stays open after a failed purchase');
eq(poorProfile.gold, 14, 'failed buy leaves gold untouched');
eq(poorProfile.potions, 2, 'failed buy leaves potions untouched');
eq(shop2.lastMessage, 'Not enough gold!', 'failed buy shows the Not enough gold! message');

// Repeat purchases while the shop is open
const bulkProfile = { gold: 45, potions: 0 };
let bulkShop = Overworld.openShop(merchant);
bulkShop = Overworld.shopBuy(bulkShop, bulkProfile);
bulkShop = Overworld.shopBuy(bulkShop, bulkProfile);
bulkShop = Overworld.shopBuy(bulkShop, bulkProfile);
eq(bulkProfile.gold, 0, 'three purchases cost 45 gold total');
eq(bulkProfile.potions, 3, 'three purchases add three potions');
eq(bulkShop.open, true, 'shop remains open across repeated purchases');

// Leave closes the shop (the scene layer restores exploration control)
const shop3 = Overworld.shopLeave(shop0);
eq(shop3.open, false, 'Leave closes the shop');
eq(shop3.lastMessage, '', 'closing clears the shop message');

// Buying from a closed shop is a no-op
const closedProfile = { gold: 30, potions: 0 };
const closedShop = Overworld.shopBuy(shop3, closedProfile);
eq(closedShop.open, false, 'buying from a closed shop keeps it closed');
eq(closedProfile.gold, 30, 'buying from a closed shop spends no gold');
eq(closedProfile.potions, 0, 'buying from a closed shop adds no potions');

// Purity: shop functions never mutate the input shop object
const shopBefore = JSON.stringify(shop0);
Overworld.shopBuy(shop0, { gold: 100, potions: 0 });
Overworld.shopLeave(shop0);
eq(JSON.stringify(shop0), shopBefore, 'shopBuy/shopLeave never mutate the input shop');

// ---- Battle-to-overworld round trip (scene layer, Phase 11) -----------------
// A second sandbox with a DOM stub loads the full scene stack
// (chrono engine, audio, progression, overworld, battle, overworld_scene)
// and drives the real encounter flow: startEncounter -> victory ->
// return to the map -> HUD -> merchant shop -> defeat retry.
console.log('\n== Phase 11: battle-to-overworld round trip ==');

class SceneClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
    return want;
  }
  contains(c) { return this.set.has(c); }
}
class SceneEl {
  constructor(tag, id) {
    this.tagName = tag || 'div';
    this.id = id || '';
    this.children = [];
    this.parentNode = null;
    this.classList = new SceneClassList();
    this.style = {};
    this.attrs = {};
    this.textContent = '';
    this.disabled = false;
    this.listeners = {};
  }
  set innerHTML(v) { this.children = []; this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML || ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  // Phase 13: rebuildMapDom swaps the grid in place via insertBefore.
  insertBefore(c, ref) {
    c.parentNode = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, c);
    return c;
  }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter(f => f !== fn);
  }
  click() { (this.listeners.click || []).forEach(f => f.call(this, { preventDefault() {} })); }
  querySelector(sel) {
    if (sel === '.result-line') {
      if (!this._resultLine) {
        this._resultLine = new SceneEl('p');
        this._resultLine.classList.add('result-line');
      }
      return this._resultLine;
    }
    const di = /^\[data-index="(\d+)"\]$/.exec(sel);
    if (di) {
      return this.children.find(c => c.getAttribute('data-index') === di[1]) || null;
    }
    if (sel.charAt(0) === '.') {
      const cls = sel.slice(1);
      let node = this.children.find(c => c.classList.contains(cls));
      if (!node) {
        // Lazily materialize class-scoped children (dialogue lines, bar
        // fills) so repeated queries return the same node.
        node = new SceneEl('div');
        node.classList.add(cls);
        this.appendChild(node);
      }
      return node;
    }
    return new SceneEl();
  }
  querySelectorAll(sel) {
    return this.children.filter(c => c.classList.contains(sel.slice(1)));
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
}

const sceneIds = [
  'battle-arena', 'scene-battle', 'enemy-row', 'hero-unit', 'hero-hp-fill',
  'hero-mp-fill', 'hero-atb-fill', 'hero-atb-text', 'hero-hp-text',
  'hero-mp-text', 'hero-level-text', 'hero-gold-text', 'turn-indicator',
  'battle-message', 'victory-screen', 'defeat-screen', 'cmd-attack',
  'cmd-magic', 'cmd-item', 'cmd-defend', 'victory-again', 'defeat-retry',
  'scene-title', 'scene-overworld', 'overworld-shop', 'shop-buy',
  'shop-leave', 'shop-message', 'hud-hp', 'hud-potions', 'hud-gold', 'hud-map'
];
const sceneRegistry = {};
sceneIds.forEach(id => {
  const el = new SceneEl('div', id);
  if (id === 'victory-screen' || id === 'defeat-screen') {
    el.classList.add('hidden');
  }
  if (id === 'scene-title' || id === 'scene-battle' || id === 'scene-overworld') {
    el.classList.add('scene');
  }
  sceneRegistry[id] = el;
});

const sceneDocListeners = {};
const sceneDoc = {
  getElementById: id => sceneRegistry[id] || null,
  createElement: tag => new SceneEl(tag),
  querySelectorAll: sel => sel === '.scene' ? [
    sceneRegistry['scene-title'],
    sceneRegistry['scene-battle'],
    sceneRegistry['scene-overworld']
  ] : [],
  addEventListener: (type, fn) => {
    (sceneDocListeners[type] = sceneDocListeners[type] || []).push(fn);
  }
};
function pressKey(key) {
  (sceneDocListeners.keydown || []).forEach(fn => fn({ key, preventDefault() {} }));
}

const scenePending = [];
const sceneWindow = {
  setTimeout: (fn) => { scenePending.push(fn); return scenePending.length; },
  addEventListener() {},
  AudioContext: undefined,       // force silent audio path
  webkitAudioContext: undefined
};

const sceneSandbox = {
  window: sceneWindow,
  document: sceneDoc,
  console,
  setTimeout: sceneWindow.setTimeout,
  Math,
  Date
};
sceneSandbox.globalThis = sceneSandbox;
vm.createContext(sceneSandbox);
[
  'chrono_battle_engine.js', 'audio.js', 'progression.js', 'overworld.js',
  'battle.js', 'overworld_scene.js'
].forEach(file => {
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, file), 'utf8'),
    sceneSandbox,
    { filename: file }
  );
});
// Plain top-level `var` modules become context globals; bridge them onto
// the window stub so the scene layer's window.X references resolve.
['Overworld', 'RetroAudio', 'Battle', 'OverworldScene'].forEach(name => {
  sceneWindow[name] = sceneSandbox[name];
});
const SceneOverworld = sceneSandbox.OverworldScene;
const SceneBattle = sceneSandbox.Battle;

function flushScene(maxIters) {
  let n = 0;
  while (scenePending.length && n < (maxIters || 5000)) {
    scenePending.shift()();
    n++;
  }
  return n;
}

ok(typeof SceneOverworld === 'object' && SceneOverworld !== null,
  'OverworldScene global is defined');
ok(typeof SceneOverworld.startEncounter === 'function',
  'OverworldScene.startEncounter() is exposed for the encounter flow');

const sceneContainer = new SceneEl('div', 'ow-container');
const rt = SceneOverworld.initOverworld(sceneContainer);
ok(rt !== null && typeof rt === 'object', 'initOverworld returns the scene state');
eq(rt.player.x, 8, 'scene hero starts at tile x=8');
eq(rt.player.y, 12, 'scene hero starts at tile y=12');
eq(rt.hero.style.left, '256px', 'hero marker renders on the start tile');

// --- Encounter: startEncounter('goblin') hands control to the battle ---
const rtGoldBefore = SceneBattle.getProfile().gold;
const rtExpBefore = SceneBattle.getProfile().experience;

SceneOverworld.startEncounter('goblin');
ok(sceneRegistry['scene-battle'].classList.contains('active'),
  'encounter switches to the battle scene');
ok(!sceneRegistry['scene-overworld'].classList.contains('active'),
  'overworld scene deactivates during the battle');
eq(rt.inEncounter, true, 'scene tracks the active encounter');
eq(rt.paused, true, 'overworld input pauses during the battle');
flushScene();
let bs = SceneBattle.state();
eq(bs.enemies.length, 1, 'encounter battle spawns one enemy');
eq(bs.enemies[0].id, 'goblin', 'encounter battle spawns the goblin');

// --- Win the encounter battle ---
let rtGuard = 0;
while (SceneBattle.state().phase !== 'victory' && rtGuard < 200) {
  rtGuard++;
  const st = SceneBattle.state();
  if (st.phase === 'target') {
    SceneBattle.command('attack', st.enemies.findIndex(e => e.alive));
  } else if (st.phase === 'player') {
    SceneBattle.command('attack');
  }
  flushScene();
}
bs = SceneBattle.state();
eq(bs.phase, 'victory', 'encounter battle is won by attacking');
eq(SceneBattle.getProfile().gold, rtGoldBefore + 18,
  'victory gold carries into the profile');
eq(SceneBattle.getProfile().experience, rtExpBefore + 25,
  'victory EXP carries into the profile');
eq(SceneBattle.getProfile().level, 2, 'level-up carries into the profile');
eq(SceneBattle.getProfile().hp, SceneBattle.getProfile().maxHp,
  'end-of-battle HP carries into the profile');
ok(!sceneRegistry['victory-screen'].classList.contains('hidden'),
  'victory overlay is shown');

// --- Victory returns to the overworld at the originating tile ---
sceneRegistry['victory-again'].click();
bs = SceneBattle.state();
eq(bs.phase, 'victory',
  'victory does not loop another battle (battle state untouched)');
ok(sceneRegistry['scene-overworld'].classList.contains('active'),
  'victory returns control to the overworld scene');
ok(!sceneRegistry['scene-battle'].classList.contains('active'),
  'battle scene deactivates on return');
ok(sceneRegistry['victory-screen'].classList.contains('hidden'),
  'victory overlay hides on return');
eq(rt.inEncounter, false, 'scene clears the encounter flag');
eq(rt.paused, false, 'overworld input resumes after the battle');
eq(rt.player.x, 8, 'hero returns at the originating tile x=8');
eq(rt.player.y, 12, 'hero returns at the originating tile y=12');
eq(rt.hero.style.left, '256px', 'hero marker is restored to the originating tile');
eq(rt.player.encounter.stepsSinceReset, 0,
  'encounter grace counter resets after the battle');

// --- HUD reflects post-battle HP/gold/potions ---
const rtProfile = SceneBattle.getProfile();
eq(sceneRegistry['hud-hp'].textContent, 'HP ' + rtProfile.hp + '/' + rtProfile.maxHp,
  'HUD shows post-battle HP');
eq(sceneRegistry['hud-gold'].textContent, '18 G', 'HUD shows post-battle gold');
eq(sceneRegistry['hud-potions'].textContent, 'POT ' + rtProfile.potions,
  'HUD shows post-battle potions');

// --- Merchant shop still transacts after the battle round trip ---
console.log('\n== Phase 12: shop after a battle round trip ==');
// Walk-in shortcut: place the hero beside the merchant facing them, then
// drive the real keydown path (dialogue -> shop -> buy).
rt.player = Overworld.createPlayerState(rt.map, 5, 9, 'right');
SceneOverworld.refreshOverworld();
pressKey('e');
ok(rt.dialogue !== null && rt.dialogue.open, 'interaction opens the merchant dialogue');
let shopGuard = 0;
while (!rt.shop && shopGuard < 10) {
  shopGuard++;
  pressKey('e');
}
ok(rt.shop !== null && rt.shop.open, 'finishing the dialogue opens the shop');
ok(!sceneRegistry['overworld-shop'].classList.contains('hidden'),
  'shop overlay is visible after the round trip');
eq(sceneRegistry['shop-buy'].textContent, 'BUY POTION - 15 G',
  'shop quotes the potion price');

const shopGoldBefore = SceneBattle.getProfile().gold;
const shopPotionsBefore = SceneBattle.getProfile().potions;
sceneRegistry['shop-buy'].click();
eq(SceneBattle.getProfile().gold, shopGoldBefore - 15,
  'shop spends gold from the battle-won purse');
eq(SceneBattle.getProfile().potions, shopPotionsBefore + 1,
  'shop adds a potion after the round trip');
eq(rt.shop.open, true, 'shop stays open for further purchases');
ok(rt.shop.lastMessage.indexOf('Potion purchased') !== -1,
  'shop confirms the purchase');
eq(sceneRegistry['hud-gold'].textContent, (shopGoldBefore - 15) + ' G',
  'HUD gold updates on purchase');
eq(sceneRegistry['hud-potions'].textContent, 'POT ' + (shopPotionsBefore + 1),
  'HUD potion count updates on purchase');
sceneRegistry['shop-leave'].click();
eq(rt.shop, null, 'LEAVE closes the shop');
ok(sceneRegistry['overworld-shop'].classList.contains('hidden'),
  'shop overlay hides on leave');

// --- Defeat from an encounter keeps the retry fairness rule ---
console.log('\n== Phase 11: encounter defeat retry ==');
SceneOverworld.startEncounter('wolf');
flushScene();
let wolfGuard = 0;
while (SceneBattle.state().phase !== 'defeat' && wolfGuard < 500) {
  wolfGuard++;
  SceneBattle.command('defend');
  flushScene();
}
bs = SceneBattle.state();
eq(bs.phase, 'defeat', 'defend-only grind reaches defeat against the wolf');
ok(!sceneRegistry['defeat-screen'].classList.contains('hidden'),
  'defeat overlay is shown');
eq(SceneBattle.getProfile().hp, SceneBattle.getProfile().maxHp,
  'defeat resets the profile to full HP (fairness rule)');

sceneRegistry['defeat-retry'].click();
flushScene();
bs = SceneBattle.state();
eq(bs.enemies.length, 1, 'RETRY restarts a single-enemy encounter');
eq(bs.enemies[0].id, 'wolf', 'RETRY retries the same enemy (wolf)');
eq(bs.heroHp, bs.heroMaxHp, 'retried encounter starts at full HP');
ok(sceneRegistry['scene-battle'].classList.contains('active'),
  'retry stays in the battle scene');

// ---- Phase 13 Segment 1: multiple maps and warp tiles ------------------------
console.log('\n== Phase 13: Maps and warps ==');

// Tile constants extended
eq(Overworld.TILE.WARP, 4, 'TILE.WARP constant is 4');
eq(Overworld.TILE.WALL, 5, 'TILE.WALL constant is 5');
eq(Overworld.TILE.FLOOR, 6, 'TILE.FLOOR constant is 6');

// Registry shape
ok(typeof Overworld.MAPS === 'object' && Overworld.MAPS !== null, 'MAPS registry is exported');
eq(Overworld.MAPS.forest.name, 'FOREST CLEARING', 'forest registry entry name');
eq(Overworld.MAPS.town.name, 'ELDERBROOK', 'town registry entry name');
eq(Overworld.MAPS.cave.name, 'ECHO HOLLOW', 'cave registry entry name');
eq(Overworld.getMapConfig('forest').id, 'forest', 'getMapConfig returns the registry entry');
eq(Overworld.getMapConfig('bogus'), null, 'getMapConfig with unknown id returns null');

// buildMap: all three maps are 20x15; unknown id returns null
const forestMap = Overworld.buildMap('forest');
const townMap = Overworld.buildMap('town');
const caveMap = Overworld.buildMap('cave');
eq(forestMap.length, 15, 'forest map has 15 rows');
ok(forestMap.every(r => r.length === 20), 'every forest row is 20 tiles wide');
eq(townMap.length, 15, 'town map has 15 rows');
ok(townMap.every(r => r.length === 20), 'every town row is 20 tiles wide');
eq(caveMap.length, 15, 'cave map has 15 rows');
ok(caveMap.every(r => r.length === 20), 'every cave row is 20 tiles wide');
eq(Overworld.buildMap('bogus'), null, 'buildMap with unknown id returns null');

// buildFirstMap still returns the forest map (now with its two warp tiles)
eq(forestMap[13][8], Overworld.TILE.WARP, 'forest (8,13) is a WARP tile');
eq(forestMap[2][1], Overworld.TILE.WARP, 'forest (1,2) is a WARP tile');
eq(Overworld.buildFirstMap()[12][8], Overworld.TILE.PATH, 'player start tile (8,12) is still PATH');
ok(JSON.stringify(Overworld.buildFirstMap()) === JSON.stringify(forestMap),
  'buildFirstMap is an alias of buildMap(\'forest\')');

// Town layout: border, PATH cross streets, four building blocks
eq(townMap[7][8], Overworld.TILE.PATH, 'town crossing (8,7) is PATH');
eq(townMap[1][8], Overworld.TILE.PATH, 'town column street starts at y=1');
eq(townMap[13][8], Overworld.TILE.WARP, 'town return warp (8,13) is a WARP tile');
eq(townMap[12][8], Overworld.TILE.PATH, 'town column street PATH ends at y=12');
eq(Overworld.isWalkableTile(townMap, 8, 13), true, 'town return warp (8,13) stays walkable');
eq(townMap[7][1], Overworld.TILE.PATH, 'town row street starts at x=1');
eq(townMap[7][18], Overworld.TILE.PATH, 'town row street ends at x=18');
eq(townMap[3][4], Overworld.TILE.TREE, 'north-west building block tile');
eq(townMap[3][15], Overworld.TILE.TREE, 'north-east building block tile');
eq(townMap[11][4], Overworld.TILE.TREE, 'south-west building block tile');
eq(townMap[11][15], Overworld.TILE.TREE, 'south-east building block tile');
eq(townMap[8][10], Overworld.TILE.GRASS, 'town merchant tile is grass');
eq(townMap[6][6], Overworld.TILE.GRASS, 'town elder tile is grass');

// Cave layout: WALL border, FLOOR interior, three clusters off the middle lane
eq(caveMap[0][10], Overworld.TILE.WALL, 'cave north border is WALL');
eq(caveMap[14][10], Overworld.TILE.WALL, 'cave south border is WALL');
eq(caveMap[7][2], Overworld.TILE.FLOOR, 'cave middle lane (y=7) stays walkable FLOOR');
eq(caveMap[7][1], Overworld.TILE.WARP, 'cave return warp (1,7) is a WARP tile');
eq(Overworld.isWalkableTile(caveMap, 1, 7), true, 'cave return warp (1,7) stays walkable');
eq(caveMap[3][5], Overworld.TILE.WALL, 'cave cluster A tile');
eq(caveMap[3][13], Overworld.TILE.WALL, 'cave cluster B tile');
eq(caveMap[10][9], Overworld.TILE.WALL, 'cave cluster C tile');

// Walkability: WARP is walkable, WALL is not
eq(Overworld.isWalkableTile(forestMap, 8, 13), true, 'WARP tile (8,13) is walkable');
eq(Overworld.isWalkableTile(forestMap, 1, 2), true, 'WARP tile (1,2) is walkable');
eq(Overworld.isWalkableTile(caveMap, 9, 7), true, 'FLOOR is walkable');
eq(Overworld.isWalkableTile(caveMap, 0, 0), false, 'WALL border is unwalkable');
eq(Overworld.isWalkableTile(caveMap, 5, 3), false, 'WALL cluster is unwalkable');

// warpAt returns the right targets and null elsewhere
const forestToTown = Overworld.warpAt('forest', 8, 13);
eq(forestToTown.toMap, 'town', 'warpAt forest (8,13) targets the town');
eq(forestToTown.toX, 8, 'warpAt forest (8,13) target x=8');
eq(forestToTown.toY, 12, 'warpAt forest (8,13) target y=12');
const forestToCave = Overworld.warpAt('forest', 1, 2);
eq(forestToCave.toMap, 'cave', 'warpAt forest (1,2) targets the cave');
eq(forestToCave.toX, 2, 'warpAt forest (1,2) target x=2');
eq(forestToCave.toY, 7, 'warpAt forest (1,2) target y=7');
const townToForest = Overworld.warpAt('town', 8, 13);
eq(townToForest.toMap, 'forest', 'warpAt town (8,13) targets the forest');
eq(townToForest.toX, 8, 'warpAt town (8,13) target x=8');
eq(townToForest.toY, 12, 'warpAt town (8,13) target y=12');
const caveToForest = Overworld.warpAt('cave', 1, 7);
eq(caveToForest.toMap, 'forest', 'warpAt cave (1,7) targets the forest');
eq(caveToForest.toX, 2, 'warpAt cave (1,7) target x=2');
eq(caveToForest.toY, 2, 'warpAt cave (1,7) target y=2');
eq(Overworld.warpAt('forest', 5, 5), null, 'warpAt returns null on a plain forest tile');
eq(Overworld.warpAt('town', 8, 12), null, 'warpAt returns null on a plain town tile');
eq(Overworld.warpAt('bogus', 0, 0), null, 'warpAt with unknown map returns null');

// applyWarp: forest -> town -> forest round trip
let warpState = Overworld.createPlayerState(forestMap, 8, 12, 'left');
warpState = Overworld.attemptMove(warpState, 'down', Overworld.MOVE_DURATION_MS);
eq(warpState.y, 13, 'hero steps down onto the south warp tile');
const inTown = Overworld.applyWarp(warpState);
eq(inTown.mapId, 'town', 'applyWarp moves the hero to the town map');
eq(inTown.x, 8, 'warp lands at town x=8');
eq(inTown.y, 12, 'warp lands at town y=12');
eq(inTown.map.length, 15, 'warp rebuilds the target map grid');
eq(inTown.npcs.length, 2, 'town NPC list loads (merchant + elder)');
ok(inTown.npcs.some(n => n.id === 'merchant'), 'town has the second merchant');
eq(Overworld.getMapConfig('town').npcs.find(n => n.id === 'merchant').x, 10,
  'town merchant stands at x=10');
eq(Overworld.getMapConfig('town').npcs.find(n => n.id === 'merchant').y, 8,
  'town merchant stands at y=8');
eq(Overworld.getMapConfig('town').npcs.find(n => n.id === 'merchant').shop, true,
  'town merchant carries the shop flag');
eq(Overworld.getMapConfig('town').npcs.find(n => n.id === 'merchant').dialogue.length, 3,
  'town merchant has three dialogue lines');
eq(Overworld.getMapConfig('town').npcs.find(n => n.id === 'elder').dialogue.length, 3,
  'elder has three dialogue lines');
eq(inTown.facing, 'down', 'facing is preserved across the warp');
eq(inTown.moving.active, false, 'warp resets the step movement to idle');

let backToForest = Overworld.attemptMove(inTown, 'down', Overworld.MOVE_DURATION_MS);
eq(backToForest.y, 13, 'town step lands on the return warp');
backToForest = Overworld.applyWarp(backToForest);
eq(backToForest.mapId, 'forest', 'town warp returns to the forest');
eq(backToForest.x, 8, 'return warp lands at forest x=8');
eq(backToForest.y, 12, 'return warp lands at forest y=12');
eq(backToForest.npcs.length, 3, 'forest NPC list is restored');

// applyWarp: forest -> cave -> forest round trip
let caveWarpState = Overworld.createPlayerState(forestMap, 1, 2, 'down');
const inCave = Overworld.applyWarp(caveWarpState);
eq(inCave.mapId, 'cave', 'applyWarp moves the hero to the cave map');
eq(inCave.x, 2, 'warp lands at cave x=2');
eq(inCave.y, 7, 'warp lands at cave y=7');
eq(inCave.npcs.length, 0, 'cave has no NPCs');
eq(inCave.map[7][1], Overworld.TILE.WARP, 'cave warp exit tile is a visible WARP');

let caveBackState = Overworld.attemptMove(inCave, 'left', Overworld.MOVE_DURATION_MS);
eq(caveBackState.x, 1, 'cave step lands on the return warp');
caveBackState = Overworld.applyWarp(caveBackState);
eq(caveBackState.mapId, 'forest', 'cave warp returns to the forest');
eq(caveBackState.x, 2, 'cave return warp lands at forest x=2');
eq(caveBackState.y, 2, 'cave return warp lands at forest y=2');
const noRewarp = Overworld.applyWarp(caveBackState);
eq(noRewarp.mapId, 'forest', 'the cave landing tile is not itself a warp (no re-warp)');
eq(noRewarp.x, 2, 'the no-warp clone keeps the position');

// applyWarp without a warp: unchanged clone; never mutates the input
const plainState = Overworld.createPlayerState(forestMap, 5, 5, 'down');
const plainWarp = Overworld.applyWarp(plainState);
ok(plainWarp !== plainState, 'applyWarp returns a new object even without a warp');
eq(plainWarp.mapId, 'forest', 'no-warp applyWarp keeps the current map');
eq(plainWarp.x, 5, 'no-warp applyWarp keeps the position');
const warpStateBefore = JSON.stringify(warpState);
Overworld.applyWarp(warpState);
eq(JSON.stringify(warpState), warpStateBefore, 'applyWarp never mutates the input state');

// applyWarp resets the encounter grace counter
let gracedState = Overworld.createPlayerState(forestMap, 8, 13, 'down');
gracedState = Overworld.registerStep(gracedState, seq([0.9]));
gracedState = Overworld.registerStep(gracedState, seq([0.9]));
eq(gracedState.encounter.stepsSinceReset, 2, 'steps accumulate before the warp');
const warpedState = Overworld.applyWarp(gracedState);
eq(warpedState.encounter.stepsSinceReset, 0, 'applyWarp resets the encounter grace counter');
eq(warpedState.encounter.triggered, false, 'applyWarp clears the triggered flag');
eq(warpedState.encounter.lastEnemyId, null, 'applyWarp clears the last enemy id');

// Anti-loop rule: every warp target is walkable and not itself a warp
[
  { mapId: 'forest', x: 8, y: 13 },
  { mapId: 'forest', x: 1, y: 2 },
  { mapId: 'town', x: 8, y: 13 },
  { mapId: 'cave', x: 1, y: 7 }
].forEach(w => {
  const target = Overworld.warpAt(w.mapId, w.x, w.y);
  const targetMap = Overworld.buildMap(target.toMap);
  ok(Overworld.isWalkableTile(targetMap, target.toX, target.toY),
    'warp (' + w.mapId + ' ' + w.x + ',' + w.y + ') lands on a walkable tile');
  eq(Overworld.warpAt(target.toMap, target.toX, target.toY), null,
    'warp (' + w.mapId + ' ' + w.x + ',' + w.y + ') does not land on another warp');
});

// Per-map encounters: mapId on the player state, default forest
eq(Overworld.createPlayerState(forestMap, 8, 12).mapId, 'forest',
  'createPlayerState defaults mapId to forest');
const townPlayer = Overworld.createPlayerState(
  townMap, 8, 12, 'down', Overworld.getMapConfig('town').npcs, 'town');
eq(townPlayer.mapId, 'town', 'createPlayerState records the town map id');
const townStepState = Overworld.attemptMove(townPlayer, 'left', 0);
eq(townStepState.mapId, 'town', 'cloneState copies the map id across moves');

// Town (rate 0) never triggers, even with an rng that always rolls 0
let townSteps = townPlayer;
const alwaysZero = () => 0;
for (let i = 0; i < 10; i++) {
  townSteps = Overworld.registerStep(townSteps, alwaysZero);
}
eq(townSteps.encounter.triggered, false,
  'town (rate 0) never triggers even with rng() always returning 0');
eq(townSteps.encounter.stepsSinceReset, 10,
  'town keeps counting steps without triggering battles');

// Cave pool: wolf-weighted 70/30
eq(Overworld.pickEncounterEnemyFor('cave', () => 0.1), 'wolf',
  'cave pool: roll 0.1 selects wolf');
eq(Overworld.pickEncounterEnemyFor('cave', () => 0.9), 'goblin',
  'cave pool: roll 0.9 selects goblin');
eq(Overworld.pickEncounterEnemyFor('forest', () => 0.1), 'goblin',
  'forest pool: roll 0.1 selects goblin');
eq(Overworld.pickEncounterEnemyFor('forest', () => 0.5), 'wolf',
  'forest pool: roll at 0.5 selects wolf');

// Cave registerStep: grace then a wolf-weighted trigger
let caveSteps = Overworld.createPlayerState(
  caveMap, 2, 7, 'down', Overworld.getMapConfig('cave').npcs, 'cave');
caveSteps = Overworld.registerStep(caveSteps, seq([0.0]));
caveSteps = Overworld.registerStep(caveSteps, seq([0.0]));
caveSteps = Overworld.registerStep(caveSteps, seq([0.0]));
eq(caveSteps.encounter.triggered, false, 'cave grace steps never trigger');
caveSteps = Overworld.registerStep(caveSteps, seq([0.1, 0.9]));
eq(caveSteps.encounter.triggered, true, 'cave roll 0.1 under rate 0.20 triggers');
eq(caveSteps.encounter.lastEnemyId, 'goblin',
  'cave enemy pick roll 0.9 selects goblin (wolf-weighted pool)');

// Forest registerStep behaves exactly as before the per-map change
let forestSteps = Overworld.createPlayerState(forestMap, 8, 12, 'down');
forestSteps = Overworld.registerStep(forestSteps, seq([0.0]));
forestSteps = Overworld.registerStep(forestSteps, seq([0.0]));
forestSteps = Overworld.registerStep(forestSteps, seq([0.0]));
eq(forestSteps.encounter.triggered, false, 'forest grace steps never trigger');
forestSteps = Overworld.registerStep(forestSteps, seq([0.1, 0.9]));
eq(forestSteps.encounter.triggered, true, 'forest roll 0.1 under rate 0.15 triggers');
eq(forestSteps.encounter.lastEnemyId, 'wolf', 'forest enemy pick roll 0.9 selects wolf');

// ---- Phase 13 Segment 3: scene warps, HUD map name, map-aware handoff ---------
// Reuses the scene sandbox above: drives the exposed stepLand entry point
// (the same warp/encounter logic the rAF loop runs in the browser).
console.log('\n== Phase 13: Scene warps and map flow ==');

ok(typeof SceneOverworld.stepLand === 'function',
  'stepLand is exposed as the headless entry point');
ok(typeof SceneOverworld.startEncounter === 'function',
  'startEncounter is exposed for the battle handoff');

// Fresh scene state on a fresh container (the sandbox Battle profile
// carries over from the round-trip section above).
const rt13 = SceneOverworld.initOverworld(new SceneEl('div', 'ow-container'));
ok(rt13 !== null && typeof rt13 === 'object', 'initOverworld returns the scene state');
eq(rt13.player.mapId, 'forest', 'scene starts on the forest map');
eq(sceneRegistry['hud-map'].textContent, 'FOREST CLEARING',
  'HUD map name starts at the forest');

// Grid tile lookup: buildGrid appends tiles row-major (index = y*20 + x).
function sceneTileClass(state, x, y) {
  return state.grid.children[y * 20 + x].className;
}

// --- Forest -> town: land on the (8,13) warp ---
ok(sceneTileClass(rt13, 8, 13).indexOf('tile-warp') !== -1,
  'forest grid renders the warp portal at (8,13)');
rt13.player = Overworld.attemptMove(rt13.player, 'down', Overworld.MOVE_DURATION_MS);
eq(rt13.player.y, 13, 'attemptMove with full dt lands on the (8,13) warp');
SceneOverworld.stepLand();
eq(rt13.player.mapId, 'town', 'stepLand warps the hero to the town');
eq(rt13.player.x, 8, 'warp lands at town x=8');
eq(rt13.player.y, 12, 'warp lands at town y=12');
eq(rt13.hero.style.left, '256px', 'hero marker lands on the town target tile (left)');
eq(rt13.hero.style.top, '384px', 'hero marker lands on the town target tile (top)');
eq(sceneRegistry['hud-map'].textContent, 'ELDERBROOK', 'HUD map name reads ELDERBROOK');
eq(rt13.player.encounter.stepsSinceReset, 0, 'warp resets the encounter grace counter');
eq(rt13.paused, false, 'warp keeps overworld input active');
// The grid was rebuilt: the town's own visible warp portal renders at
// (8,13), not the forest tile the hero left behind.
ok(sceneTileClass(rt13, 8, 13).indexOf('tile-warp') !== -1,
  'grid was rebuilt for the town (warp portal rendered at (8,13))');
ok(sceneTileClass(rt13, 8, 7).indexOf('tile-path') !== -1,
  'rebuilt grid shows the town crossing');
eq(rt13.npcs.length, 2, 'scene follows the town NPC list (merchant + elder)');

// --- Town merchant: real keydown path into the shop ---
rt13.player = Overworld.createPlayerState(
  townMap, 9, 8, 'right', Overworld.getMapConfig('town').npcs, 'town');
SceneOverworld.refreshOverworld();
pressKey('e');
ok(rt13.dialogue !== null && rt13.dialogue.open,
  'interaction opens the town merchant dialogue');
let scShopGuard = 0;
while (!rt13.shop && scShopGuard < 10) {
  scShopGuard++;
  pressKey('e');
}
ok(rt13.shop !== null && rt13.shop.open, 'finishing the dialogue opens the town shop');
const scShopProfile = SceneBattle.getProfile();
scShopProfile.gold = 30; // battle purse shortcut for the purchase
const scGoldBefore = scShopProfile.gold;
const scPotionsBefore = scShopProfile.potions;
sceneRegistry['shop-buy'].click();
eq(scShopProfile.gold, scGoldBefore - 15,
  'town shop buy spends gold from the live profile');
eq(scShopProfile.potions, scPotionsBefore + 1,
  'town shop buy adds a potion to the live profile');
ok(rt13.shop.lastMessage.indexOf('Potion purchased') !== -1,
  'shop message confirms the purchase');
sceneRegistry['shop-leave'].click();
eq(rt13.shop, null, 'LEAVE closes the town shop');

// --- Town -> forest: step down onto the town warp ---
rt13.player = Overworld.createPlayerState(
  townMap, 8, 12, 'down', Overworld.getMapConfig('town').npcs, 'town');
rt13.player = Overworld.attemptMove(rt13.player, 'down', Overworld.MOVE_DURATION_MS);
eq(rt13.player.y, 13, 'town step lands on the (8,13) return warp');
SceneOverworld.stepLand();
eq(rt13.player.mapId, 'forest', 'town warp returns to the forest');
eq(rt13.player.x, 8, 'return warp lands at forest x=8');
eq(rt13.player.y, 12, 'return warp lands at forest y=12');
eq(sceneRegistry['hud-map'].textContent, 'FOREST CLEARING',
  'HUD map name is back to the forest');
eq(rt13.npcs.length, 3, 'scene follows the forest NPC list again');

// --- Forest -> cave via the (1,2) warp ---
rt13.player = Overworld.createPlayerState(forestMap, 2, 2, 'left');
rt13.player = Overworld.attemptMove(rt13.player, 'left', Overworld.MOVE_DURATION_MS);
eq(rt13.player.x, 1, 'forest step lands on the (1,2) warp');
SceneOverworld.stepLand();
eq(rt13.player.mapId, 'cave', 'stepLand warps the hero to the cave');
eq(rt13.player.x, 2, 'cave warp lands at x=2');
eq(rt13.player.y, 7, 'cave warp lands at y=7');
eq(rt13.hero.style.left, '64px', 'hero marker lands on the cave target tile (left)');
eq(rt13.hero.style.top, '224px', 'hero marker lands on the cave target tile (top)');
eq(sceneRegistry['hud-map'].textContent, 'ECHO HOLLOW', 'HUD map name reads ECHO HOLLOW');
eq(rt13.player.encounter.stepsSinceReset, 0, 'cave warp resets the encounter grace counter');
ok(sceneTileClass(rt13, 2, 7).indexOf('tile-floor') !== -1,
  'grid was rebuilt for the cave (FLOOR at the landing tile)');
ok(sceneTileClass(rt13, 1, 7).indexOf('tile-warp') !== -1,
  'cave grid renders the visible return warp at (1,7)');
ok(sceneTileClass(rt13, 0, 0).indexOf('tile-wall') !== -1,
  'rebuilt grid shows the cave WALL border');
eq(rt13.npcs.length, 0, 'cave carries no NPCs');

// --- Cave -> forest via the (1,7) warp ---
rt13.player = Overworld.attemptMove(rt13.player, 'left', Overworld.MOVE_DURATION_MS);
eq(rt13.player.x, 1, 'cave step lands on the (1,7) return warp');
SceneOverworld.stepLand();
eq(rt13.player.mapId, 'forest', 'cave warp returns to the forest');
eq(rt13.player.x, 2, 'cave return warp lands at forest x=2');
eq(rt13.player.y, 2, 'cave return warp lands at forest y=2');
eq(sceneRegistry['hud-map'].textContent, 'FOREST CLEARING',
  'HUD map name is back to the forest after the cave');

// --- Town safety: registered steps never trigger ---
rt13.player = Overworld.createPlayerState(
  townMap, 8, 12, 'down', Overworld.getMapConfig('town').npcs, 'town');
for (let i = 0; i < 12; i++) {
  SceneOverworld.stepLand();
}
eq(rt13.player.encounter.triggered, false,
  'twelve stepLand calls on the town map never trigger an encounter');
eq(rt13.player.encounter.stepsSinceReset, 12,
  'town keeps counting steps without battles');

// --- Map-aware battle handoff: encounter on the cave map ---
rt13.player = Overworld.createPlayerState(
  caveMap, 2, 7, 'down', Overworld.getMapConfig('cave').npcs, 'cave');
SceneOverworld.refreshOverworld();
eq(sceneRegistry['hud-map'].textContent, 'ECHO HOLLOW',
  'HUD names the cave before the encounter');
SceneOverworld.startEncounter('wolf');
ok(sceneRegistry['scene-battle'].classList.contains('active'),
  'encounter switches to the battle scene');
ok(!sceneRegistry['scene-overworld'].classList.contains('active'),
  'overworld scene deactivates during the battle');
eq(rt13.inEncounter, true, 'scene tracks the active encounter');
eq(rt13.paused, true, 'overworld input pauses during the battle');
flushScene();
let scBattleGuard = 0;
while (SceneBattle.state().phase !== 'victory' && scBattleGuard < 200) {
  scBattleGuard++;
  const st = SceneBattle.state();
  if (st.phase === 'target') {
    SceneBattle.command('attack', st.enemies.findIndex(e => e.alive));
  } else if (st.phase === 'player') {
    SceneBattle.command('attack');
  }
  flushScene();
}
eq(SceneBattle.state().phase, 'victory', 'encounter battle is won by attacking');
sceneRegistry['victory-again'].click();
eq(SceneBattle.state().phase, 'victory',
  'victory does not loop another battle (battle state untouched)');
ok(sceneRegistry['scene-overworld'].classList.contains('active'),
  'victory returns control to the overworld');
eq(rt13.inEncounter, false, 'scene clears the encounter flag');
eq(rt13.player.mapId, 'cave', 'the hero is still on the cave map after the battle');
eq(rt13.player.x, 2, 'the hero returns to the same cave tile (x=2)');
eq(rt13.player.y, 7, 'the hero returns to the same cave tile (y=7)');
eq(sceneRegistry['hud-map'].textContent, 'ECHO HOLLOW',
  'HUD still names the cave map after the battle round trip');

// ---- Result ------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
