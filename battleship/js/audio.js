/*
 * Music and sound effects, synthesized live with the Web Audio API (no audio files).
 *
 * Two looping tracks: "harbor" (a calm 6/8 shanty with waves and a ship's bell,
 * played while you deploy) and "battle" (a driving march for combat), plus
 * victory and defeat fanfares. Browsers only allow sound after the player
 * interacts with the page, so nothing plays until unlock() runs from a click.
 */
const Sound = (() => {
    const STORAGE_KEY = 'battleship.sound';
    const MUSIC_LEVEL = 0.5;
    const SFX_LEVEL = 0.6;
    const prefs = { music: true, sfx: true, volume: 0.8 };
    try {
        Object.assign(prefs, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
    } catch (e) { /* storage unavailable: keep defaults */ }

    let ctx = null;
    let master, musicBus, sfxBus, noiseBuffer;
    let wantedTrack = null;
    let player = null;

    function savePrefs() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
    }

    /* ---------- setup ---------- */

    function unlock() {
        if (!ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            ctx = new AudioCtx();
            buildGraph();
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) ctx.suspend().catch(() => {});
                else ctx.resume().catch(() => {});
            });
        }
        if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
        if (prefs.music && wantedTrack && !player) startTrack(wantedTrack);
    }

    function buildGraph() {
        const compressor = ctx.createDynamicsCompressor();
        // Gentle glue for the music, and enough grip to keep explosions from clipping.
        compressor.threshold.value = -9;
        compressor.knee.value = 6;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.2;
        master = ctx.createGain();
        master.gain.value = prefs.volume;
        master.connect(compressor).connect(ctx.destination);

        const reverb = ctx.createConvolver();
        reverb.buffer = impulse(2.4);
        reverb.connect(master);

        musicBus = ctx.createGain();
        musicBus.gain.value = prefs.music ? MUSIC_LEVEL : 0;
        musicBus.connect(master);
        const musicSend = ctx.createGain();
        musicSend.gain.value = 0.35;
        musicBus.connect(musicSend).connect(reverb);

        sfxBus = ctx.createGain();
        sfxBus.gain.value = prefs.sfx ? SFX_LEVEL : 0;
        sfxBus.connect(master);
        const sfxSend = ctx.createGain();
        sfxSend.gain.value = 0.22;
        sfxBus.connect(sfxSend).connect(reverb);

        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }

    // Decaying noise works as a small, cheap concert-hall reverb.
    function impulse(seconds) {
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
        }
        return buffer;
    }

    /* ---------- building blocks ---------- */

    const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function midi(name) {
        const m = /^([A-G])(#|b)?(\d)$/.exec(name);
        return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    }
    const hz = note => 440 * Math.pow(2, ((typeof note === 'number' ? note : midi(note)) - 69) / 12);
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);

    // One oscillator with an attack / decay-to-sustain / release envelope.
    function voice({
        dest, t, freq, dur, type = 'sine', vol = 0.2, attack = 0.01, decay = 0.2, sustain = 1,
        release = 0.12, detune = 0, glideTo = null, cutoff = null, cutoffFrom = null, q = 0.8, vibrato = 0
    }) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
        osc.detune.value = detune;
        let out = osc;
        if (cutoff) {
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.Q.value = q;
            filter.frequency.setValueAtTime(cutoffFrom || cutoff, t);
            if (cutoffFrom) filter.frequency.exponentialRampToValueAtTime(cutoff, t + Math.min(dur, 0.5));
            out = out.connect(filter);
        }
        if (vibrato) {
            const lfo = ctx.createOscillator();
            const depth = ctx.createGain();
            lfo.frequency.value = 5.2;
            depth.gain.setValueAtTime(0, t);
            depth.gain.linearRampToValueAtTime(vibrato, t + Math.min(dur, 0.4));
            lfo.connect(depth).connect(osc.detune);
            lfo.start(t);
            lfo.stop(t + dur + release + 0.1);
        }
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + attack);
        if (sustain < 1) gain.gain.setTargetAtTime(vol * sustain, t + attack, decay / 3);
        gain.gain.setTargetAtTime(0, t + Math.max(dur, attack), release / 4);
        out.connect(gain).connect(dest);
        osc.start(t);
        osc.stop(t + Math.max(dur, attack) + release + 0.1);
    }

    // Filtered white noise with a fast attack and exponential decay.
    function noise({ dest, t, dur, vol = 0.3, attack = 0.004, type = 'lowpass', freq = 1000, freqTo = null, q = 0.8 }) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.Q.value = q;
        filter.frequency.setValueAtTime(freq, t);
        if (freqTo) filter.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol, t + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(filter).connect(gain).connect(dest);
        src.start(t, Math.random() * 1.5);
        src.stop(t + dur + 0.05);
    }

    /* ---------- instruments ---------- */

    function pluck(dest, t, note, vol = 0.06, dur = 0.7) {
        voice({ dest, t, freq: hz(note), dur, type: 'triangle', vol, attack: 0.004, sustain: 0, decay: dur * 0.6, release: 0.2 });
        voice({ dest, t, freq: hz(note) * 2, dur: dur * 0.4, type: 'sine', vol: vol * 0.3, attack: 0.003, sustain: 0, decay: 0.15 });
    }

    function bass(dest, t, note, dur, vol = 0.2) {
        voice({ dest, t, freq: hz(note), dur, type: 'triangle', vol, attack: 0.01, sustain: 0.35, decay: 0.25, release: 0.2 });
        voice({ dest, t, freq: hz(note), dur, type: 'sine', vol: vol * 0.7, attack: 0.01, sustain: 0.5, decay: 0.3, release: 0.2 });
    }

    function pad(dest, t, notes, dur, vol = 0.03, attack = 0.35) {
        for (const n of notes) {
            for (const d of [-7, 7]) {
                voice({ dest, t, freq: hz(n), dur, type: 'sawtooth', vol, attack, release: 0.6, detune: d, cutoff: 900 });
            }
        }
    }

    // Two reedy oscillators, a little like a concertina.
    function squeezebox(dest, t, note, dur, vol = 0.04) {
        voice({ dest, t, freq: hz(note), dur, type: 'square', vol, attack: 0.03, sustain: 0.75, decay: 0.2, release: 0.12, cutoff: 1900, vibrato: 7 });
        voice({ dest, t, freq: hz(note), dur, type: 'sawtooth', vol: vol * 0.8, attack: 0.03, sustain: 0.75, decay: 0.2, release: 0.12, detune: 9, cutoff: 2200 });
    }

    function brass(dest, t, notes, dur, vol = 0.028, attack = 0.05) {
        for (const n of notes) {
            for (const d of [-6, 6]) {
                voice({ dest, t, freq: hz(n), dur, type: 'sawtooth', vol, attack, sustain: 0.7, decay: 0.25, release: 0.25, detune: d, cutoff: 1500, cutoffFrom: 3200 });
            }
        }
    }

    function horn(dest, t, note, dur, vol = 0.065) {
        voice({ dest, t, freq: hz(note), dur, type: 'sawtooth', vol, attack: 0.045, sustain: 0.8, decay: 0.2, release: 0.18, cutoff: 2300, cutoffFrom: 3600, vibrato: 10 });
        voice({ dest, t, freq: hz(note), dur, type: 'triangle', vol: vol * 0.9, attack: 0.03, sustain: 0.8, decay: 0.2, release: 0.18 });
    }

    function taiko(dest, t, vol = 0.55) {
        voice({ dest, t, freq: 120, glideTo: 44, dur: 0.38, vol, attack: 0.002, sustain: 0, decay: 0.16, release: 0.1 });
        noise({ dest, t, dur: 0.12, vol: vol * 0.45, freq: 320 });
    }

    function snare(dest, t, vol = 0.2) {
        noise({ dest, t, dur: 0.17, vol, type: 'bandpass', freq: 1900, q: 0.6 });
        voice({ dest, t, freq: 190, glideTo: 150, dur: 0.08, type: 'triangle', vol: vol * 0.6, attack: 0.002, sustain: 0, decay: 0.05 });
    }

    function hat(dest, t, vol = 0.05) {
        noise({ dest, t, dur: 0.035, vol, type: 'highpass', freq: 7000 });
    }

    function crash(dest, t, vol = 0.12) {
        noise({ dest, t, dur: 1.6, vol, type: 'highpass', freq: 4200, attack: 0.002 });
    }

    // A ship's bell: inharmonic partials with long, staggered decays.
    function bell(dest, t, vol = 0.05) {
        const base = hz('D5');
        [[1, 1, 2.6], [2.76, 0.5, 1.3], [5.4, 0.25, 0.7], [8.93, 0.12, 0.35]].forEach(([ratio, level, decay]) => {
            voice({ dest, t, freq: base * ratio, dur: decay, vol: vol * level, attack: 0.002, sustain: 0, decay, release: 0.3 });
        });
    }

    /* ---------- tracks ---------- */

    const notes = list => list.map(midi);

    // Harbor: 6/8 at a dotted quarter of 72 bpm, one step per eighth note.
    const HARBOR_CHORDS = [
        ['A3', 'D4', 'F4'], ['G3', 'C4', 'E4'], ['F3', 'Bb3', 'D4'], ['E3', 'A3', 'C#4'],
        ['A3', 'D4', 'F4'], ['G3', 'C4', 'E4'], ['G3', 'Bb3', 'D4'], ['E3', 'A3', 'C#4']
    ].map(notes);
    const HARBOR_BASS = [['D2', 'A2'], ['C2', 'G2'], ['Bb1', 'F2'], ['A1', 'E2'], ['D2', 'A2'], ['C2', 'G2'], ['G1', 'D2'], ['A1', 'E2']];
    const HARBOR_TUNE = [
        [[0, 'A4', 2], [2, 'D5', 1], [3, 'D5', 2], [5, 'E5', 1]],
        [[0, 'F5', 2], [2, 'E5', 1], [3, 'D5', 2], [5, 'C5', 1]],
        [[0, 'D5', 2], [2, 'Bb4', 1], [3, 'F4', 2], [5, 'Bb4', 1]],
        [[0, 'A4', 3], [3, 'C#5', 2], [5, 'E5', 1]],
        [[0, 'F5', 2], [2, 'E5', 1], [3, 'D5', 2], [5, 'A4', 1]],
        [[0, 'G4', 2], [2, 'E4', 1], [3, 'C5', 3]],
        [[0, 'Bb4', 2], [2, 'A4', 1], [3, 'G4', 2], [5, 'Bb4', 1]],
        [[0, 'E5', 2], [2, 'D5', 1], [3, 'C#5', 2], [5, 'A4', 1]]
    ];
    const ARP = [0, 1, 2, 3, 2, 1];

    const harbor = {
        stepDur: 60 / 72 / 3,
        steps: 6 * 16,
        start(bus, t) {
            // Waves: low noise swelling slowly in and out, with a little foam on top.
            const src = ctx.createBufferSource();
            src.buffer = noiseBuffer;
            src.loop = true;
            const low = ctx.createBiquadFilter();
            low.type = 'lowpass';
            low.frequency.value = 520;
            const foam = ctx.createBiquadFilter();
            foam.type = 'bandpass';
            foam.frequency.value = 2600;
            foam.Q.value = 0.5;
            const swell = ctx.createGain();
            swell.gain.value = 0.05;
            const foamGain = ctx.createGain();
            foamGain.gain.value = 0.012;
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 0.11;
            const depth = ctx.createGain();
            depth.gain.value = 0.04;
            const foamDepth = ctx.createGain();
            foamDepth.gain.value = 0.01;
            lfo.connect(depth).connect(swell.gain);
            lfo.connect(foamDepth).connect(foamGain.gain);
            src.connect(low).connect(swell).connect(bus);
            src.connect(foam).connect(foamGain).connect(bus);
            src.start(t);
            lfo.start(t);
            return { stop() { src.stop(); lfo.stop(); } };
        },
        play(step, t, bus) {
            const len = this.stepDur;
            const bar = Math.floor(step / 6);
            const beat = step % 6;
            const i = bar % 8;
            const verse = bar >= 8;
            const chord = HARBOR_CHORDS[i];
            if (beat === 0) {
                pad(bus, t, chord, len * 6, 0.022);
                bass(bus, t, HARBOR_BASS[i][0], len * 2.5, 0.16);
                // Two bells at the top of the tune, the way a ship marks the watch.
                if (bar === 0) {
                    bell(bus, t);
                    bell(bus, t + len * 1.5);
                }
            }
            if (beat === 3) bass(bus, t, HARBOR_BASS[i][1], len * 2.5, 0.12);
            const arpNote = ARP[beat] === 3 ? chord[0] + 24 : chord[ARP[beat]] + 12;
            if (!verse) pluck(bus, t, arpNote, 0.05);
            else if (beat === 0 || beat === 3) pluck(bus, t, arpNote, 0.035);
            if (verse) {
                for (const [at, note, steps] of HARBOR_TUNE[i]) {
                    if (at === beat) squeezebox(bus, t, note, len * steps * 0.92);
                }
            }
        }
    };

    // Battle: 4/4 at 126 bpm, one step per sixteenth note.
    const BATTLE_CHORDS = [
        ['D4', 'F4', 'A4'], ['D4', 'F4', 'Bb4'], ['E4', 'G4', 'C5'], ['E4', 'A4', 'C#5'],
        ['D4', 'F4', 'A4'], ['D4', 'F4', 'Bb4'], ['D4', 'G4', 'Bb4'], ['E4', 'A4', 'C#5']
    ].map(notes);
    const BATTLE_ROOTS = notes(['D2', 'Bb1', 'C2', 'A1', 'D2', 'Bb1', 'G1', 'A1']);
    const BATTLE_TUNE = [
        [[0, 'D5', 4], [4, 'A4', 4], [8, 'D5', 2], [10, 'E5', 2], [12, 'F5', 4]],
        [[0, 'F5', 6], [6, 'E5', 2], [8, 'D5', 4], [12, 'Bb4', 4]],
        [[0, 'E5', 4], [4, 'C5', 4], [8, 'G4', 4], [12, 'C5', 4]],
        [[0, 'C#5', 6], [6, 'D5', 2], [8, 'E5', 8]],
        [[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'A5', 8]],
        [[0, 'G5', 4], [4, 'F5', 4], [8, 'D5', 8]],
        [[0, 'G5', 4], [4, 'F5', 2], [6, 'E5', 2], [8, 'D5', 4], [12, 'Bb4', 4]],
        [[0, 'A4', 4], [4, 'C#5', 4], [8, 'E5', 4], [12, 'A5', 4]]
    ];

    const battle = {
        stepDur: 60 / 126 / 4,
        steps: 16 * 16,
        play(step, t, bus) {
            const len = this.stepDur;
            const bar = Math.floor(step / 16);
            const s = step % 16;
            const i = bar % 8;
            const full = bar >= 8;
            const lastBar = i === 7;

            // Galloping low strings: da-da-dum on every beat, octave up on the off-beats.
            if ([0, 2, 3].includes(s % 4)) {
                const note = BATTLE_ROOTS[i] + 12 + (Math.floor(s / 4) % 2 ? 12 : 0);
                voice({ dest: bus, t, freq: hz(note), dur: len * 0.9, type: 'sawtooth', vol: 0.085, attack: 0.004, sustain: 0.3, decay: 0.08, release: 0.05, cutoff: 650, cutoffFrom: 1700 });
            }
            if (s === 0 || s === 8 || (s === 10 && bar % 2) || (lastBar && s === 14)) taiko(bus, t, s === 0 ? 0.6 : 0.45);
            if (s === 4 || s === 12) snare(bus, t, 0.18);
            if (lastBar && s > 12) snare(bus, t, 0.08 + (s - 12) * 0.04);
            if (full && s % 2 === 0) hat(bus, t, s % 4 ? 0.03 : 0.05);
            if (s === 0 && (bar === 0 || bar === 8)) crash(bus, t, bar === 8 ? 0.13 : 0.07);

            if (full) {
                if (s === 0 || s === 8) brass(bus, t, BATTLE_CHORDS[i], len * 6, 0.024);
                for (const [at, note, steps] of BATTLE_TUNE[i]) {
                    if (at === s) horn(bus, t, note, len * steps * 0.9);
                }
            } else if (s === 0) {
                brass(bus, t, BATTLE_CHORDS[i], len * 15, 0.018, 0.3);
            }
        }
    };

    const TRACKS = { harbor, battle };

    /* ---------- sequencer ---------- */

    function startTrack(name) {
        stopTrack(0.8);
        const track = TRACKS[name];
        const now = ctx.currentTime;
        const bus = ctx.createGain();
        bus.gain.setValueAtTime(0.0001, now);
        bus.gain.exponentialRampToValueAtTime(1, now + 1.5);
        bus.connect(musicBus);
        player = { track, bus, step: 0, time: now + 0.1, extras: track.start ? track.start(bus, now) : null };
        player.timer = setInterval(schedule, 25);
        schedule();
    }

    // Schedules notes a little ahead of the audio clock so timing stays tight.
    function schedule() {
        const p = player;
        if (!p) return;
        const { track } = p;
        if (p.time < ctx.currentTime - 0.2) {
            // The tab was throttled; skip the missed steps instead of playing them all at once.
            const missed = Math.ceil((ctx.currentTime - p.time) / track.stepDur);
            p.step += missed;
            p.time += missed * track.stepDur;
        }
        while (p.time < ctx.currentTime + 0.12) {
            track.play(p.step % track.steps, p.time, p.bus);
            p.step++;
            p.time += track.stepDur;
        }
    }

    function stopTrack(fade = 0.6) {
        if (!player) return;
        const p = player;
        player = null;
        clearInterval(p.timer);
        const now = ctx.currentTime;
        p.bus.gain.cancelScheduledValues(now);
        p.bus.gain.setValueAtTime(p.bus.gain.value, now);
        p.bus.gain.linearRampToValueAtTime(0, now + fade);
        setTimeout(() => {
            if (p.extras) p.extras.stop();
            p.bus.disconnect();
        }, (fade + 3) * 1000);
    }

    function music(name) {
        if (wantedTrack === name && (player || !prefs.music || !ctx)) return;
        wantedTrack = name;
        if (!ctx) return;
        if (!name) stopTrack();
        else if (prefs.music) startTrack(name);
    }

    function stinger(kind) {
        wantedTrack = null;
        if (!ctx) return;
        stopTrack(0.4);
        if (!prefs.music) return;
        const bus = ctx.createGain();
        bus.connect(musicBus);
        const t = ctx.currentTime + 0.15;
        if (kind === 'victory') {
            const b = 0.15;
            ['D4', 'F#4', 'A4'].forEach((n, i) => {
                horn(bus, t + i * b, n, b * 0.85, 0.08);
                taiko(bus, t + i * b, 0.3);
            });
            horn(bus, t + 3 * b, 'D5', 0.8, 0.09);
            brass(bus, t + 3 * b, ['D4', 'F#4', 'A4'], 0.8, 0.03);
            taiko(bus, t + 3 * b, 0.7);
            crash(bus, t + 3 * b, 0.14);
            const t2 = t + 3 * b + 0.75;
            horn(bus, t2, 'B4', 0.13, 0.08);
            horn(bus, t2 + 0.15, 'C#5', 0.13, 0.08);
            horn(bus, t2 + 0.3, 'D5', 1.9, 0.1);
            brass(bus, t2 + 0.3, ['D4', 'F#4', 'A4', 'D5'], 1.9, 0.032);
            bass(bus, t2 + 0.3, 'D2', 1.9, 0.22);
            taiko(bus, t2 + 0.3, 0.8);
            crash(bus, t2 + 0.3, 0.16);
        } else {
            [['A4', 0], ['G4', 0.6], ['F4', 1.2], ['E4', 1.8]].forEach(([n, at]) => horn(bus, t + at, n, 0.5, 0.06));
            horn(bus, t + 2.3, 'D4', 2.2, 0.07);
            brass(bus, t, ['D3', 'F3', 'A3'], 1.2, 0.026, 0.2);
            brass(bus, t + 1.2, ['G2', 'Bb2', 'D3'], 1.1, 0.026, 0.2);
            brass(bus, t + 2.3, ['D2', 'A2', 'D3', 'F3'], 2.4, 0.03, 0.3);
            bass(bus, t + 2.3, 'D2', 2.4, 0.24);
            taiko(bus, t, 0.5);
            taiko(bus, t + 2.3, 0.7);
        }
        setTimeout(() => bus.disconnect(), 6000);
    }

    /* ---------- sound effects ---------- */

    function sfxStart() {
        if (!ctx || !prefs.sfx || ctx.state !== 'running') return null;
        return ctx.currentTime + 0.01;
    }

    const sfx = {
        // Our own gun is loud and sharp; the enemy's is a distant, muffled thud.
        cannon(distant = false) {
            const t = sfxStart();
            if (t === null) return;
            const v = distant ? 0.5 : 1;
            voice({ dest: sfxBus, t, freq: 150, glideTo: 36, dur: 0.5, vol: 0.9 * v, attack: 0.002, sustain: 0, decay: 0.18 });
            noise({ dest: sfxBus, t, dur: 0.7, vol: 0.7 * v, freq: distant ? 900 : 3200, freqTo: 140 });
            if (!distant) noise({ dest: sfxBus, t, dur: 0.07, vol: 0.4, type: 'bandpass', freq: 1600 });
        },
        whistle(incoming = false) {
            const t = sfxStart();
            if (t === null) return;
            voice({ dest: sfxBus, t: t + 0.08, freq: incoming ? 1500 : 2300, glideTo: incoming ? 520 : 800, dur: 0.38, vol: incoming ? 0.11 : 0.08, attack: 0.08, release: 0.05, vibrato: 12 });
        },
        splash() {
            const t = sfxStart();
            if (t === null) return;
            noise({ dest: sfxBus, t, dur: 0.75, vol: 0.5, type: 'bandpass', freq: 950, freqTo: 260, attack: 0.015 });
            noise({ dest: sfxBus, t: t + 0.03, dur: 0.4, vol: 0.13, type: 'highpass', freq: 3200 });
            voice({ dest: sfxBus, t, freq: 520, glideTo: 170, dur: 0.16, vol: 0.12, attack: 0.004, sustain: 0, decay: 0.12 });
        },
        explosion() {
            const t = sfxStart();
            if (t === null) return;
            noise({ dest: sfxBus, t, dur: 1.5, vol: 0.85, freq: 4200, freqTo: 110, attack: 0.003 });
            voice({ dest: sfxBus, t, freq: 95, glideTo: 28, dur: 0.9, vol: 0.85, attack: 0.002, sustain: 0, decay: 0.35 });
            for (let i = 0; i < 7; i++) {
                noise({ dest: sfxBus, t: t + rand(0.12, 0.95), dur: 0.05, vol: rand(0.06, 0.16), type: 'highpass', freq: 2200 });
            }
        },
        sink() {
            const t = sfxStart();
            if (t === null) return;
            const s = t + 0.35;
            voice({ dest: sfxBus, t: s, freq: 190, glideTo: 42, dur: 2.2, type: 'sawtooth', vol: 0.16, attack: 0.15, release: 0.5, cutoff: 480, vibrato: 25 });
            noise({ dest: sfxBus, t: s, dur: 2.6, vol: 0.35, freq: 420, freqTo: 70, attack: 0.3 });
            for (let i = 0; i < 12; i++) {
                const f = rand(260, 900);
                voice({ dest: sfxBus, t: s + rand(0.4, 2.4), freq: f, glideTo: f * 1.6, dur: 0.06, vol: 0.06, attack: 0.004, release: 0.03 });
            }
        },
        place() {
            const t = sfxStart();
            if (t === null) return;
            voice({ dest: sfxBus, t, freq: 230, glideTo: 130, dur: 0.1, type: 'triangle', vol: 0.4, attack: 0.002, sustain: 0, decay: 0.05 });
            noise({ dest: sfxBus, t, dur: 0.04, vol: 0.18, type: 'bandpass', freq: 2600 });
        },
        pickup() {
            const t = sfxStart();
            if (t === null) return;
            voice({ dest: sfxBus, t, freq: 300, glideTo: 520, dur: 0.08, type: 'triangle', vol: 0.18, attack: 0.004, release: 0.05 });
        },
        rotate() {
            const t = sfxStart();
            if (t === null) return;
            noise({ dest: sfxBus, t, dur: 0.18, vol: 0.5, type: 'bandpass', freq: 600, freqTo: 2400, q: 1.4, attack: 0.03 });
        },
        invalid() {
            const t = sfxStart();
            if (t === null) return;
            [0, 0.11].forEach(d => voice({ dest: sfxBus, t: t + d, freq: 140, dur: 0.07, type: 'square', vol: 0.09, attack: 0.004, release: 0.03, cutoff: 900 }));
        },
        tick() {
            const t = sfxStart();
            if (t === null) return;
            voice({ dest: sfxBus, t, freq: 1250, dur: 0.04, vol: 0.14, attack: 0.002, sustain: 0, decay: 0.03 });
        },
        // Sonar ping when the battle starts.
        ping() {
            const t = sfxStart();
            if (t === null) return;
            voice({ dest: sfxBus, t, freq: 1180, dur: 1.4, vol: 0.13, attack: 0.004, sustain: 0, decay: 1.1, release: 0.4 });
            voice({ dest: sfxBus, t: t + 0.9, freq: 1180, dur: 0.9, vol: 0.04, attack: 0.004, sustain: 0, decay: 0.7, release: 0.3 });
        }
    };

    /* ---------- preferences ---------- */

    function setMusic(on) {
        prefs.music = on;
        savePrefs();
        if (!ctx) return;
        musicBus.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, ctx.currentTime, 0.1);
        if (!on) stopTrack(0.3);
        else if (wantedTrack && !player) startTrack(wantedTrack);
    }

    function setSfx(on) {
        prefs.sfx = on;
        savePrefs();
        if (ctx) sfxBus.gain.setTargetAtTime(on ? SFX_LEVEL : 0, ctx.currentTime, 0.05);
    }

    function setVolume(value) {
        prefs.volume = value;
        savePrefs();
        if (ctx) master.gain.setTargetAtTime(value, ctx.currentTime, 0.05);
    }

    return {
        unlock,
        music,
        stinger,
        ...sfx,
        setMusic,
        setSfx,
        setVolume,
        get prefs() { return { ...prefs }; }
    };
})();
