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

    return {
        // Cursor move beep — short high square blip.
        beep: function () {
            tone({ type: 'square', freq: 660, freqEnd: 990, duration: 0.07, gain: 0.12 });
        },

        // Sword slash hit — descending saw bite plus a noise burst.
        slash: function () {
            tone({ type: 'sawtooth', freq: 420, freqEnd: 70, duration: 0.16, gain: 0.16 });
            noise({ duration: 0.14, gain: 0.18, filterHz: 1500 });
        },

        // Magic sparkle — quick ascending chime arpeggio.
        sparkle: function () {
            tone({ type: 'triangle', freq: 784, duration: 0.09, gain: 0.14, start: 0.00 });
            tone({ type: 'triangle', freq: 1175, duration: 0.09, gain: 0.14, start: 0.07 });
            tone({ type: 'sine', freq: 1568, duration: 0.14, gain: 0.12, start: 0.14 });
        },

        // Potion / crystal heal chime — warm ascending major triad.
        heal: function () {
            tone({ type: 'triangle', freq: 523, duration: 0.12, gain: 0.16, start: 0.00 });
            tone({ type: 'triangle', freq: 659, duration: 0.12, gain: 0.16, start: 0.10 });
            tone({ type: 'triangle', freq: 784, duration: 0.22, gain: 0.16, start: 0.20 });
        },

        // Victory fanfare — triumphant square-wave arpeggio.
        fanfare: function () {
            var notes = [
                { freq: 523, start: 0.00, dur: 0.14 },
                { freq: 659, start: 0.14, dur: 0.14 },
                { freq: 784, start: 0.28, dur: 0.14 },
                { freq: 1046, start: 0.42, dur: 0.40 }
            ];
            for (var i = 0; i < notes.length; i++) {
                var n = notes[i];
                tone({ type: 'square', freq: n.freq, duration: n.dur, gain: 0.14, start: n.start });
                tone({ type: 'triangle', freq: n.freq / 2, duration: n.dur, gain: 0.08, start: n.start });
            }
        },

        // Defeat sting — low descending sawtooth moan.
        gameOver: function () {
            tone({ type: 'sawtooth', freq: 220, freqEnd: 55, duration: 0.9, gain: 0.14 });
            tone({ type: 'square', freq: 110, freqEnd: 41, duration: 0.9, gain: 0.08, start: 0.05 });
        }
    };
})();
