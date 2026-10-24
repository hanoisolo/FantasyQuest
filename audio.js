/*
 * FantasyQuest — 16-bit audio synthesizer.
 * All sound effects are generated with the native Web Audio API;
 * no external audio files are used.
 */
var RetroAudio = (function () {
    'use strict';

    var ctx = null;

    function context() {
        if (ctx) {
            return ctx;
        }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
            return null; // No Web Audio support (or headless test) — stay silent.
        }
        ctx = new AC();
        return ctx;
    }

    /*
     * Play a single oscillator note.
     * opts: { type, freq, freqEnd, start, duration, gain }
     */
    function tone(opts) {
        var ac = context();
        if (!ac) {
            return;
        }
        var t0 = ac.currentTime + (opts.start || 0);
        var dur = opts.duration || 0.1;
        var osc = ac.createOscillator();
        var amp = ac.createGain();

        osc.type = opts.type || 'square';
        osc.frequency.setValueAtTime(opts.freq, t0);
        if (opts.freqEnd) {
            osc.frequency.exponentialRampToValueAtTime(
                Math.max(opts.freqEnd, 1), t0 + dur
            );
        }

        var peak = opts.gain || 0.15;
        amp.gain.setValueAtTime(0.0001, t0);
        amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        osc.connect(amp);
        amp.connect(ac.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    /*
     * Play a filtered noise burst (used for the sword slash impact).
     * opts: { start, duration, gain, filterHz }
     */
    function noise(opts) {
        var ac = context();
        if (!ac) {
            return;
        }
        var t0 = ac.currentTime + (opts.start || 0);
        var dur = opts.duration || 0.15;

        var buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < data.length; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        var src = ac.createBufferSource();
        src.buffer = buffer;

        var filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(opts.filterHz || 1200, t0);
        filter.frequency.exponentialRampToValueAtTime(200, t0 + dur);

        var amp = ac.createGain();
        var peak = opts.gain || 0.2;
        amp.gain.setValueAtTime(peak, t0);
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        src.connect(filter);
        filter.connect(amp);
        amp.connect(ac.destination);
        src.start(t0);
        src.stop(t0 + dur);
    }

    /*
     * Pass 1 primary SFX API. Every effect is synthesized from native
     * Web Audio oscillators and filtered noise; no audio files exist.
     */

    // Crisp 800Hz menu beep (cursor / confirm).
    function playCursor() {
        tone({ type: 'square', freq: 800, duration: 0.06, gain: 0.12 });
    }

    // Noisy frequency-drop swoosh with an impact crunch on landing.
    function playSlash() {
        tone({ type: 'sawtooth', freq: 520, freqEnd: 70, duration: 0.2, gain: 0.15 });
        noise({ start: 0.06, duration: 0.12, gain: 0.22, filterHz: 1000 });
    }

    // Rising arpeggio sparkle sweep (Arcane Spark).
    function playMagic() {
        tone({ type: 'triangle', freq: 523, duration: 0.09, gain: 0.13, start: 0.00 });
        tone({ type: 'triangle', freq: 659, duration: 0.09, gain: 0.13, start: 0.055 });
        tone({ type: 'triangle', freq: 784, duration: 0.09, gain: 0.13, start: 0.11 });
        tone({ type: 'sine', freq: 1046, duration: 0.1, gain: 0.12, start: 0.165 });
        tone({ type: 'sine', freq: 1568, duration: 0.16, gain: 0.10, start: 0.22 });
    }

    // Gentle two-tone chime (relic crystal heal).
    function playHeal() {
        tone({ type: 'sine', freq: 523, duration: 0.16, gain: 0.15, start: 0.00 });
        tone({ type: 'sine', freq: 784, duration: 0.24, gain: 0.15, start: 0.14 });
    }

    // 5-note retro victory fanfare: C C E G C(held).
    function playVictory() {
        var notes = [
            { freq: 523, start: 0.00, dur: 0.12 },
            { freq: 523, start: 0.13, dur: 0.12 },
            { freq: 659, start: 0.26, dur: 0.12 },
            { freq: 784, start: 0.39, dur: 0.12 },
            { freq: 1046, start: 0.52, dur: 0.5 }
        ];
        for (var i = 0; i < notes.length; i++) {
            var n = notes[i];
            tone({ type: 'square', freq: n.freq, duration: n.dur, gain: 0.13, start: n.start });
            tone({ type: 'triangle', freq: n.freq / 2, duration: n.dur, gain: 0.07, start: n.start });
        }
    }

    // Short ascending two-tone chime (map warp transition).
    function playWarp() {
        tone({ type: 'sine', freq: 660, duration: 0.12, gain: 0.14, start: 0.00 });
        tone({ type: 'sine', freq: 990, duration: 0.18, gain: 0.14, start: 0.10 });
    }

    return {
        // Pass 1 primary API
        playCursor: playCursor,
        playSlash: playSlash,
        playMagic: playMagic,
        playHeal: playHeal,
        playVictory: playVictory,
        playWarp: playWarp,

        // Legacy aliases (overworld, shop, older callers)
        beep: playCursor,
        slash: playSlash,
        sparkle: playMagic,
        heal: playHeal,
        fanfare: playVictory,

        // Shop purchase chime — bright ascending coin jingle (Phase 12).
        buy: function () {
            tone({ type: 'square', freq: 880, duration: 0.08, gain: 0.14, start: 0.00 });
            tone({ type: 'triangle', freq: 1318, duration: 0.14, gain: 0.12, start: 0.08 });
        },

        // Potion drink tone — a low gulp followed by a refreshing chime
        // (Phase 12, used by the overworld shop flow).
        drink: function () {
            tone({ type: 'sine', freq: 300, freqEnd: 180, duration: 0.12, gain: 0.16, start: 0.00 });
            tone({ type: 'triangle', freq: 520, duration: 0.10, gain: 0.14, start: 0.12 });
            tone({ type: 'triangle', freq: 700, duration: 0.12, gain: 0.12, start: 0.20 });
        },

        // Defeat sting — low descending sawtooth moan.
        gameOver: function () {
            tone({ type: 'sawtooth', freq: 220, freqEnd: 55, duration: 0.9, gain: 0.14 });
            tone({ type: 'square', freq: 110, freqEnd: 41, duration: 0.9, gain: 0.08, start: 0.05 });
        }
    };
})();
