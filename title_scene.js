/*
 * FantasyQuest — title screen start logic (Phase 15: Continue).
 *
 * Owns the NEW GAME / CONTINUE decisions on the title screen. The boot
 * script in index.html keeps the DOM and scene-manager wiring and injects
 * its handles through TitleScene.init(); this module decides what a start
 * means: a plain start (NEW GAME, default forest entry) or a continued
 * start (saved profile into the live hero, saved map and tile into the
 * overworld).
 *
 * Public API (window.TitleScene):
 *   init(config)     wire the buttons and set the CONTINUE enabled state.
 *                    config: { isTitle(), start(entrySave), newGameBtn,
 *                              continueBtn }
 *   refreshContinue()  SaveSystem.exists() -> CONTINUE disabled state
 *   newGame()        start a fresh run (default forest entry)
 *   continueGame()   load the save and start at it; a null load falls
 *                    back silently to the new-game path
 */
var TitleScene = (function () {
    'use strict';

    var ctx = null;     // handles injected by the boot script
    var handled = false;

    function hasSave() {
        return !!(window.SaveSystem &&
                  typeof window.SaveSystem.exists === 'function' &&
                  window.SaveSystem.exists());
    }

    function onTitle() {
        return !ctx || !ctx.isTitle || !!ctx.isTitle();
    }

    // Title render (and post-save changes): CONTINUE is enabled only when
    // a valid save can be loaded.
    function refreshContinue() {
        if (ctx && ctx.continueBtn) {
            ctx.continueBtn.disabled = !hasSave();
        }
    }

    // The untouched new-game path: default forest entry, save untouched.
    function newGame() {
        if (handled || !onTitle()) {
            return false;
        }
        handled = true;
        if (ctx && ctx.start) {
            ctx.start(null);
        }
        return true;
    }

    // Continue: restore the saved profile into the live hero and start
    // the overworld at the saved map and tile. Missing / invalid save:
    // silent fallback to the new-game path.
    function continueGame() {
        if (handled || !onTitle()) {
            return false;
        }
        var save = (window.SaveSystem &&
                    typeof window.SaveSystem.load === 'function')
            ? window.SaveSystem.load()
            : null;
        if (!save) {
            return newGame();
        }
        handled = true;
        if (window.Battle && typeof window.Battle.applyProfile === 'function') {
            window.Battle.applyProfile(save.profile);
        }
        if (ctx && ctx.start) {
            ctx.start(save);
        }
        return true;
    }

    function init(config) {
        ctx = config || null;
        if (ctx && ctx.newGameBtn && ctx.newGameBtn.addEventListener) {
            ctx.newGameBtn.addEventListener('click', function (event) {
                if (event && event.stopPropagation) {
                    event.stopPropagation(); // keep the title-click start silent
                }
                newGame();
            });
        }
        if (ctx && ctx.continueBtn && ctx.continueBtn.addEventListener) {
            ctx.continueBtn.addEventListener('click', function (event) {
                if (event && event.stopPropagation) {
                    event.stopPropagation();
                }
                if (ctx.continueBtn.disabled) {
                    return; // non-clickable while disabled
                }
                continueGame();
            });
        }
        refreshContinue();
    }

    return {
        init: init,
        refreshContinue: refreshContinue,
        newGame: newGame,
        continueGame: continueGame
    };
})();
