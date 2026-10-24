/*
 * FantasyQuest - save/load module (Phase 15: Save and Load System).
 * Owns all persistence concerns so game code only needs to build a
 * payload and call SaveSystem.save() / load().
 *
 * Public API (window.SaveSystem):
 *   SAVE_KEY               localStorage key the save lives under
 *   save(payload)          JSON.stringify + localStorage write -> true on
 *                          success, false if serialization or the storage
 *                          write throws (private-mode safe)
 *   load()                 parse + fully validate the stored save.
 *                          Returns the payload object, or null for a
 *                          missing key, invalid JSON, wrong/missing
 *                          version, invalid profile fields, or non-integer
 *                          x/y. Never throws.
 *   exists()               true only if load() would return a save
 *   clear()                remove the stored save (never throws)
 *
 * Payload shape (version 1):
 *   { version: 1,
 *     profile: { level, exp, gold, hp, maxHp, potions },
 *     mapId, x, y, savedAt }
 */
(function (root) {
    'use strict';

    var SaveSystem = (function () {

    var SAVE_KEY = 'fantasyquest_save_v1';
    var SAVE_VERSION = 1;

    var PROFILE_NUMBER_FIELDS = ['level', 'exp', 'gold', 'hp', 'maxHp', 'potions'];

    // Resolve localStorage per call so environments without it (or with a
    // storage that throws, e.g. private browsing) never break the callers.
    function getStorage() {
        var store = null;
        try {
            if (root.localStorage) {
                store = root.localStorage;
            } else if (root.window && root.window.localStorage) {
                store = root.window.localStorage;
            }
        } catch (e) {
            store = null;
        }
        return store;
    }

    function save(payload) {
        if (payload === null || typeof payload !== 'object') {
            return false;
        }
        try {
            var store = getStorage();
            if (!store) {
                return false;
            }
            store.setItem(SAVE_KEY, JSON.stringify(payload));
            return true;
        } catch (e) {
            return false;
        }
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isValidProfile(profile) {
        if (profile === null || typeof profile !== 'object') {
            return false;
        }
        for (var i = 0; i < PROFILE_NUMBER_FIELDS.length; i++) {
            if (!isFiniteNumber(profile[PROFILE_NUMBER_FIELDS[i]])) {
                return false;
            }
        }
        return true;
    }

    function load() {
        try {
            var store = getStorage();
            if (!store) {
                return null;
            }
            var raw = store.getItem(SAVE_KEY);
            if (raw === null || typeof raw === 'undefined') {
                return null;
            }
            var data = JSON.parse(raw);
            if (data === null || typeof data !== 'object') {
                return null;
            }
            if (data.version !== SAVE_VERSION) {
                return null;
            }
            if (!isValidProfile(data.profile)) {
                return null;
            }
            if (typeof data.mapId !== 'string' || data.mapId.length === 0) {
                return null;
            }
            if (!isFiniteNumber(data.x) || !isFiniteNumber(data.y) ||
                Math.floor(data.x) !== data.x || Math.floor(data.y) !== data.y) {
                return null;
            }
            if (!isFiniteNumber(data.savedAt)) {
                return null;
            }
            return data;
        } catch (e) {
            return null;
        }
    }

    function exists() {
        return load() !== null;
    }

    function clear() {
        try {
            var store = getStorage();
            if (store) {
                store.removeItem(SAVE_KEY);
            }
        } catch (e) {
            // Private-mode removeItem can throw; clearing is best-effort.
        }
    }

    return {
        SAVE_KEY: SAVE_KEY,
        save: save,
        load: load,
        exists: exists,
        clear: clear
    };
    })();

    root.SaveSystem = SaveSystem;
    if (typeof window !== 'undefined') {
        window.SaveSystem = SaveSystem;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
