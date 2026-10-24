'use strict';
/*
 * FantasyQuest Phase 15 - SaveSystem tests (Node.js).
 * Loads save.js into a sandbox with a stubbed localStorage and covers
 * save/load round-trips, corrupt/invalid/mismatched data rejection,
 * exists(), clear(), and private-mode (throwing storage) safety.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ---- Minimal localStorage stub ----------------------------------------
function makeStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
}

// ---- Load save.js into a bare sandbox (no DOM, no real storage) --------
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'save.js'), 'utf8'),
  sandbox,
  { filename: 'save.js' }
);
const Save = sandbox.window.SaveSystem || sandbox.SaveSystem;

// ---- Tiny test kit with beforeEach support ------------------------------
let hook = function () {};
function beforeEach(fn) { hook = fn; }

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + '  (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}
function it(name, fn) {
  hook();
  console.log(name);
  try {
    fn();
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name + ' threw: ' + (e && e.message));
  }
}

// ---- Fixture -------------------------------------------------------------
function validPayload(overrides) {
  const p = {
    version: 1,
    profile: { level: 3, exp: 42, gold: 77, hp: 18, maxHp: 30, potions: 2 },
    mapId: 'forest',
    x: 8,
    y: 12,
    savedAt: 1700000000000,
  };
  if (overrides) {
    Object.keys(overrides).forEach(function (k) {
      if (k === 'profile') {
        Object.keys(overrides.profile).forEach(function (pk) {
          p.profile[pk] = overrides.profile[pk];
        });
      } else {
        p[k] = overrides[k];
      }
    });
  }
  return p;
}

// ---- beforeEach: reset localStorage state --------------------------------
beforeEach(function () {
  const store = makeStorage();
  sandbox.localStorage = store;
  sandbox.window.localStorage = store;
});

console.log('\n== Phase 15: SaveSystem ==');

// ---- Module shape --------------------------------------------------------
it('\n-- module shape --', function () {
  ok(typeof Save === 'object' && Save !== null, 'SaveSystem global is defined');
  eq(Save.SAVE_KEY, 'fantasyquest_save_v1', 'SAVE_KEY is fantasyquest_save_v1');
  ok(typeof Save.save === 'function', 'save() is exposed');
  ok(typeof Save.load === 'function', 'load() is exposed');
  ok(typeof Save.exists === 'function', 'exists() is exposed');
  ok(typeof Save.clear === 'function', 'clear() is exposed');
});

// ---- Round-trip save/load ------------------------------------------------
it('\n-- save/load round-trip --', function () {
  const payload = validPayload();
  eq(Save.save(payload), true, 'save() returns true on success');
  eq(sandbox.localStorage.getItem(Save.SAVE_KEY), JSON.stringify(payload),
    'payload is written under SAVE_KEY, serialized with JSON.stringify');

  const loaded = Save.load();
  ok(loaded !== null, 'load() returns the saved object');
  eq(loaded.version, 1, 'loaded version is 1');
  eq(loaded.profile.level, 3, 'loaded profile.level round-trips');
  eq(loaded.profile.exp, 42, 'loaded profile.exp round-trips');
  eq(loaded.profile.gold, 77, 'loaded profile.gold round-trips');
  eq(loaded.profile.hp, 18, 'loaded profile.hp round-trips');
  eq(loaded.profile.maxHp, 30, 'loaded profile.maxHp round-trips');
  eq(loaded.profile.potions, 2, 'loaded profile.potions round-trips');
  eq(loaded.mapId, 'forest', 'loaded mapId round-trips');
  eq(loaded.x, 8, 'loaded x round-trips');
  eq(loaded.y, 12, 'loaded y round-trips');
  eq(loaded.savedAt, 1700000000000, 'loaded savedAt round-trips');
});

// ---- exists() ------------------------------------------------------------
it('\n-- exists() --', function () {
  eq(Save.exists(), false, 'exists() is false with no save present');
  eq(Save.save(validPayload()), true, 'save() succeeds');
  eq(Save.exists(), true, 'exists() is true after a successful save');
});

// ---- Corrupt / invalid stored data ---------------------------------------
it('\n-- corrupt and invalid data --', function () {
  sandbox.localStorage.setItem(Save.SAVE_KEY, '{this is not json');
  eq(Save.load(), null, 'corrupt JSON returns null');
  eq(Save.exists(), false, 'exists() is false for corrupt JSON');

  sandbox.localStorage.setItem(Save.SAVE_KEY, '"just a string"');
  eq(Save.load(), null, 'valid JSON that is not an object returns null');

  sandbox.localStorage.setItem(Save.SAVE_KEY, 'null');
  eq(Save.load(), null, 'JSON null payload returns null');
});

// ---- Version checks -------------------------------------------------------
it('\n-- version handling --', function () {
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(validPayload({ version: 2 })));
  eq(Save.load(), null, 'wrong version (2) returns null');

  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(validPayload({ version: '1' })));
  eq(Save.load(), null, 'string version "1" returns null');

  const noVersion = validPayload();
  delete noVersion.version;
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(noVersion));
  eq(Save.load(), null, 'missing version returns null');
});

// ---- Missing / invalid fields ---------------------------------------------
it('\n-- missing and invalid fields --', function () {
  ['level', 'exp', 'gold', 'hp', 'maxHp', 'potions'].forEach(function (field) {
    const missing = validPayload();
    delete missing.profile[field];
    sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(missing));
    ok(Save.load() === null, 'missing profile.' + field + ' returns null');

    const nonNumeric = validPayload();
    nonNumeric.profile[field] = 'x';
    sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(nonNumeric));
    ok(Save.load() === null, 'non-numeric profile.' + field + ' returns null');
  });

  const noProfile = validPayload();
  delete noProfile.profile;
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(noProfile));
  eq(Save.load(), null, 'missing profile object returns null');

  const badProfile = validPayload();
  badProfile.profile = { level: 3 };
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(badProfile));
  eq(Save.load(), null, 'partially filled profile returns null');

  const noMapId = validPayload();
  delete noMapId.mapId;
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(noMapId));
  eq(Save.load(), null, 'missing mapId returns null');

  const emptyMapId = validPayload({ mapId: '' });
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(emptyMapId));
  eq(Save.load(), null, 'empty mapId returns null');

  const noX = validPayload();
  delete noX.x;
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(noX));
  eq(Save.load(), null, 'missing x returns null');

  const noY = validPayload();
  delete noY.y;
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(noY));
  eq(Save.load(), null, 'missing y returns null');

  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(validPayload({ x: 8.5 })));
  eq(Save.load(), null, 'non-integer x returns null');

  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(validPayload({ y: '12' })));
  eq(Save.load(), null, 'non-numeric y returns null');

  const noSavedAt = validPayload();
  delete noSavedAt.savedAt;
  sandbox.localStorage.setItem(Save.SAVE_KEY, JSON.stringify(noSavedAt));
  eq(Save.load(), null, 'missing savedAt returns null');
});

// ---- clear() ---------------------------------------------------------------
it('\n-- clear() --', function () {
  eq(Save.save(validPayload()), true, 'save() succeeds before clear');
  ok(sandbox.localStorage.getItem(Save.SAVE_KEY) !== null, 'save key present before clear()');
  Save.clear();
  eq(sandbox.localStorage.getItem(Save.SAVE_KEY), null, 'clear() removes the key');
  eq(Save.load(), null, 'load() returns null after clear()');
  eq(Save.exists(), false, 'exists() is false after clear()');
  Save.clear();
  ok(true, 'clear() on an already-empty store does not throw');
});

// ---- Private-mode safety (throwing storage) --------------------------------
it('\n-- private-mode safety --', function () {
  const throwingSet = {
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded / private mode'); },
    removeItem() {},
  };
  sandbox.localStorage = throwingSet;
  sandbox.window.localStorage = throwingSet;
  eq(Save.save(validPayload()), false, 'save() returns false when localStorage.setItem throws');
  eq(Save.exists(), false, 'exists() is false when nothing could be written');

  const throwingGet = {
    getItem() { throw new Error('private mode'); },
    setItem() {},
    removeItem() {},
  };
  sandbox.localStorage = throwingGet;
  sandbox.window.localStorage = throwingGet;
  eq(Save.load(), null, 'load() returns null (never throws) when getItem throws');
  eq(Save.exists(), false, 'exists() is false when getItem throws');

  const throwingRemove = {
    getItem() { return null; },
    setItem() {},
    removeItem() { throw new Error('private mode'); },
  };
  sandbox.localStorage = throwingRemove;
  sandbox.window.localStorage = throwingRemove;
  Save.clear();
  ok(true, 'clear() never throws even if removeItem throws');
});

// ---- Result ----------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
