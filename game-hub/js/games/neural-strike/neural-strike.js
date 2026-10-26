export function init(container) {
    // =====================================================================
    // NEURAL STRIKE — cyberpunk rhythm game.
    //
    // The Web Audio clock (audioCtx.currentTime) is the single source of
    // truth for all timing (PRD §4.1): note positions, hit judgments, the
    // count-in, and the look-ahead music scheduler all read it. Rendering
    // is driven by requestAnimationFrame, with a fixed 60 Hz logic step
    // accumulated from the audio clock so a slow or backgrounded tab never
    // desyncs notes from the music.
    // =====================================================================

    const STORAGE_KEY = 'neural-strike_highscores';

    // ---------- canvas & projection ----------
    const W = 440;
    const H = 640;
    const HORIZON = 165;         // vanishing line
    const K = 475;               // px per world unit at z = 1
    const CAM_H = 6.5;           // camera height
    const Z_HIT = 8;             // hit line depth
    const Z_NEAR = 5;            // road meets canvas bottom (just off-screen)
    const Z_FAR = 60;            // draw distance
    const SPEED = 29;            // world units/s → ~1.8 s approach time
    const LANE_SP = 1.6;         // lane spacing in world units
    const ROAD_EDGE = 3.2;       // road half-width
    const APPROACH_S = (Z_FAR - Z_HIT) / SPEED;

    const laneWX = (lane) => (lane - 1.5) * LANE_SP;
    const px = (wx, z) => W / 2 + (wx * K) / z;
    const py = (z) => HORIZON + (CAM_H * K) / z;
    const pyw = (z, h) => HORIZON + ((CAM_H - h) * K) / z;

    // ---------- timing windows (PRD §2.3) ----------
    const PERFECT_W = 0.015;
    const GREAT_W = 0.040;
    const GOOD_W = 0.080;
    const SLIDE_GOOD_W = 0.12;   // a touch of forgiveness for fluid swipes
    const OVER_W = 0.10;         // simultaneous-press window for overload gates
    const STEP = 1 / 60;
    const COUNTDOWN = 3.4;

    const LANE_COLORS = ['#22d3ee', '#c084fc', '#a3e635', '#f472b6'];
    const KEY_LABELS = ['D', 'F', 'J', 'K'];
    const KEY_LANES = { d: 0, f: 1, j: 2, k: 3, arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3 };
    const JUDGE = {
        perfect: { color: '#22d3ee', text: 'PERFECT' },
        great: { color: '#c084fc', text: 'GREAT' },
        good: { color: '#a3e635', text: 'GOOD' },
        miss: { color: '#fb7185', text: 'MISS' }
    };

    // ---------- beatmap content (PRD §4.1 JSON format) ----------
    // Tracks are defined as PRD-shaped beatmaps ({ song, bpm, notes }) and
    // run through parseBeatmap() before play. Note arrays are composed
    // deterministically (seeded RNG) so every player sees the same chart.
    const TRACKS = [
        {
            id: 'neon-vector',
            title: 'NEON VECTOR',
            bpm: 128,
            seed: 1337,
            root: 33,            // A1
            accent: '#22d3ee',
            chordProg: [0, -4, 3, -2],
            snareDecay: 0.2,
            bass16: false,
            cowbell: false,
            sections: [
                { bars: 4, density: 0.25 },
                { bars: 8, density: 0.45 },
                { bars: 8, density: 0.62 },
                { bars: 4, density: 0.34 },
                { bars: 8, density: 0.72 },
                { bars: 4, density: 0.30 }
            ]
        },
        {
            id: 'ghost-protocol',
            title: 'GHOST PROTOCOL',
            bpm: 140,
            seed: 8711,
            root: 31,            // G1
            accent: '#c084fc',
            chordProg: [0, -4, 3, -2],
            snareDecay: 0.34,    // long gated-industrial snare
            bass16: false,
            cowbell: false,
            sections: [
                { bars: 4, density: 0.28 },
                { bars: 8, density: 0.50 },
                { bars: 8, density: 0.66 },
                { bars: 4, density: 0.40 },
                { bars: 8, density: 0.78 },
                { bars: 4, density: 0.32 }
            ]
        },
        {
            id: 'overdrive-exe',
            title: 'OVERDRIVE.EXE',
            bpm: 152,
            seed: 4242,
            root: 38,            // D2
            accent: '#f472b6',
            chordProg: [0, -4, -2, 3],
            snareDecay: 0.16,
            bass16: true,        // redline 16th-note bass
            cowbell: true,       // phonk cowbell lead
            sections: [
                { bars: 4, density: 0.30 },
                { bars: 8, density: 0.50 },
                { bars: 8, density: 0.68 },
                { bars: 4, density: 0.36 },
                { bars: 8, density: 0.80 },
                { bars: 4, density: 0.32 }
            ]
        }
    ];

    const DIFFICULTIES = [
        { id: 'easy', name: 'EASY', tag: 'taps + data links', densityMul: 0.78, allow: ['tap', 'hold'], seedOffset: 11 },
        { id: 'hacker', name: 'HACKER', tag: '+ breach slides', densityMul: 1.0, allow: ['tap', 'hold', 'slide'], seedOffset: 29 },
        { id: 'elite', name: 'ELITE', tag: '+ overload gates', densityMul: 1.18, allow: ['tap', 'hold', 'slide', 'overload'], seedOffset: 47 }
    ];
    const NOTE_TYPES = ['tap', 'hold', 'slide', 'overload'];

    // ---------- DOM ----------
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'game-canvas';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Neural Strike: a cyberpunk rhythm game. Notes ride a 3D data stream toward the hit line; press D, F, J, K or the arrow keys as they arrive.');

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Tap a lane to hit · hold to keep a Data Link alive · swipe across lanes for System Breach · hit every glowing lane to clear an Overload gate.';

    container.append(scoreDisplay, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => prefersReducedMotion.matches;

    // ---------- helpers ----------
    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hexA(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function rr(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    // ---------- pre-rendered backdrops ----------
    // Sky: obsidian → purple gradient, stars, a distant corporate skyline
    // with lit windows, and a soft vignette. Drawn once.
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = W;
    bgCanvas.height = H;
    (function buildBg() {
        const g = bgCanvas.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, HORIZON);
        grad.addColorStop(0, '#04050c');
        grad.addColorStop(0.6, '#0b0e1e');
        grad.addColorStop(0.88, '#1d1038');
        grad.addColorStop(1, '#2c1450');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, HORIZON);
        g.fillStyle = '#05060d';
        g.fillRect(0, HORIZON, W, H - HORIZON);
        const rnd = mulberry32(99);
        for (let i = 0; i < 90; i++) {
            const x = rnd() * W;
            const y = rnd() * HORIZON * 0.8;
            g.fillStyle = `rgba(220, 235, 255, ${(0.2 + rnd() * 0.5).toFixed(2)})`;
            g.fillRect(x, y, rnd() < 0.85 ? 1 : 2, 1);
        }
        // skyline
        let x = 0;
        while (x < W + 40) {
            const bw = 16 + rnd() * 34;
            const bh = 14 + rnd() * 52;
            g.fillStyle = '#0a0918';
            g.fillRect(x, HORIZON - bh, bw, bh);
            g.fillStyle = 'rgba(192, 132, 252, 0.5)';
            for (let wy = 4; wy < bh - 3; wy += 6) {
                for (let wx = 3; wx < bw - 3; wx += 5) {
                    if (rnd() < 0.14) g.fillRect(x + wx, HORIZON - bh + wy, 2, 2);
                }
            }
            x += bw + (rnd() < 0.35 ? 5 : 0);
        }
        // vignette
        const vg = g.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 0.85);
        vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);
    })();

    // CRT scanline overlay
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = W;
    scanCanvas.height = H;
    (function buildScan() {
        const g = scanCanvas.getContext('2d');
        g.fillStyle = 'rgba(0, 0, 0, 0.9)';
        for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    })();

    // Effect canvases (scene buffer + RGB channel buffers for aberration)
    const scene = document.createElement('canvas');
    scene.width = W;
    scene.height = H;
    const sctx = scene.getContext('2d');
    const chR = document.createElement('canvas');
    chR.width = W; chR.height = H;
    const chG = document.createElement('canvas');
    chG.width = W; chG.height = H;
    const chB = document.createElement('canvas');
    chB.width = W; chB.height = H;

    // ---------- audio ----------
    let audioCtx = null;
    let master = null;      // master gain → compressor → destination
    let musicGain = null;   // music bus
    let sfxGain = null;     // sfx bus
    let noiseBuf = null;
    let delayNode = null;
    let leadIn = null;

    function getAudio() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC();
            master = audioCtx.createGain();
            master.gain.value = 0.55;
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -18;
            comp.knee.value = 20;
            comp.ratio.value = 6;
            master.connect(comp);
            comp.connect(audioCtx.destination);
            musicGain = audioCtx.createGain();
            musicGain.gain.value = 0.9;
            musicGain.connect(master);
            sfxGain = audioCtx.createGain();
            sfxGain.gain.value = 0.9;
            sfxGain.connect(master);
            const len = Math.floor(audioCtx.sampleRate * 1.2);
            noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
            const data = noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            delayNode = audioCtx.createDelay(1.0);
            const fb = audioCtx.createGain();
            fb.gain.value = 0.32;
            const wet = audioCtx.createGain();
            wet.gain.value = 0.22;
            leadIn = audioCtx.createGain();
            leadIn.connect(delayNode);
            delayNode.connect(fb);
            fb.connect(delayNode);
            delayNode.connect(wet);
            wet.connect(musicGain);
        }
        return audioCtx;
    }

    function midiToFreq(m) {
        return 440 * Math.pow(2, (m - 69) / 12);
    }

    function blip(freq, type, dur, vol, sweepTo, at) {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const t0 = at != null ? at : audioCtx.currentTime;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g);
        g.connect(sfxGain);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
    }

    // ----- music voices (all scheduled against the audio clock) -----
    function kick(t0, vol) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(160, t0);
        o.frequency.exponentialRampToValueAtTime(42, t0 + 0.11);
        g.gain.setValueAtTime(0.9 * vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
        o.connect(g);
        g.connect(musicGain);
        o.start(t0);
        o.stop(t0 + 0.3);
    }

    function hat(t0, open, vol) {
        const src = audioCtx.createBufferSource();
        src.buffer = noiseBuf;
        const f = audioCtx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7500;
        const g = audioCtx.createGain();
        const d = open ? 0.18 : 0.05;
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
        src.connect(f);
        f.connect(g);
        g.connect(musicGain);
        src.start(t0);
        src.stop(t0 + d + 0.02);
    }

    function snare(t0, vol, decay) {
        const src = audioCtx.createBufferSource();
        src.buffer = noiseBuf;
        const f = audioCtx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1900;
        f.Q.value = 0.9;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
        src.connect(f);
        f.connect(g);
        g.connect(musicGain);
        src.start(t0);
        src.stop(t0 + decay + 0.02);
        const o = audioCtx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(210, t0);
        o.frequency.exponentialRampToValueAtTime(120, t0 + 0.08);
        const g2 = audioCtx.createGain();
        g2.gain.setValueAtTime(vol * 0.5, t0);
        g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        o.connect(g2);
        g2.connect(musicGain);
        o.start(t0);
        o.stop(t0 + 0.12);
    }

    function bass(t0, midi, dur, vol) {
        const o = audioCtx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(midi);
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 6;
        f.frequency.setValueAtTime(900, t0);
        f.frequency.exponentialRampToValueAtTime(320, t0 + dur);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.setValueAtTime(vol, t0 + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(f);
        f.connect(g);
        g.connect(musicGain);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
    }

    function lead(t0, midi, dur, vol) {
        const o = audioCtx.createOscillator();
        o.type = 'square';
        o.frequency.value = midiToFreq(midi);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g);
        g.connect(musicGain);
        g.connect(leadIn); // into the dotted-8th feedback delay
        o.start(t0);
        o.stop(t0 + dur + 0.02);
    }

    function cowbell(t0, vol) {
        const f = audioCtx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 4;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
        f.connect(g);
        g.connect(musicGain);
        for (const fr of [540, 810]) {
            const o = audioCtx.createOscillator();
            o.type = 'square';
            o.frequency.value = fr;
            o.connect(f);
            o.start(t0);
            o.stop(t0 + 0.18);
        }
    }

    function pad(t0, midis, dur) {
        for (const m of midis) {
            for (const det of [-6, 6]) {
                const o = audioCtx.createOscillator();
                o.type = 'sawtooth';
                o.frequency.value = midiToFreq(m);
                o.detune.value = det;
                const f = audioCtx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.value = 1100;
                const g = audioCtx.createGain();
                const atk = Math.min(0.3, dur * 0.3);
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.03, t0 + atk);
                g.gain.setValueAtTime(0.03, t0 + dur - 0.05);
                g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.35);
                o.connect(f);
                f.connect(g);
                g.connect(musicGain);
                o.start(t0);
                o.stop(t0 + dur + 0.4);
            }
        }
    }

    // ----- look-ahead scheduler: everything is placed on the audio clock -----
    const music = { timer: null, track: null, beatIdx: 0, nextT: 0, until: 0 };

    function intensityOf(sec) {
        const d = sec.density;
        if (d < 0.35) return 1;
        if (d < 0.55) return 2;
        if (d < 0.7) return 3;
        return 4;
    }

    const ARP_TONES = [0, 3, 7, 12, 15];
    const ARP_PATTERN = [0, -1, 2, 1, 3, 2, 4, 3, 0, -1, 2, 3, 4, 3, 2, 1];
    const COW_PATTERN = [0, -1, -1, 0, -1, 2, -1, -1, 3, -1, 2, -1, 4, 3, 2, -1];

    function scheduleBeat(beatIdx, t, beat) {
        const trk = music.track;
        const bar = Math.floor(beatIdx / 4);
        const beatInBar = beatIdx % 4;
        const sec = trk.barMap[bar] || trk.sections[0];
        const I = intensityOf(sec);
        const root = trk.root + trk.chordProg[bar % trk.chordProg.length];

        // kick: four-on-the-floor once the drop hits, half-time before
        if (I >= 2 || beatInBar % 2 === 0) kick(t, I >= 2 ? 1 : 0.8);
        // hats: eighths, open on the offbeat of beat 4 when hot
        if (I >= 1) {
            hat(t, false, 0.12);
            hat(t + beat / 2, I >= 3 && beatInBar === 3, I >= 3 ? 0.1 : 0.06);
        }
        // snare on beats 2 & 4
        if (I >= 2 && (beatInBar === 1 || beatInBar === 3)) {
            snare(t, 0.5, trk.snareDecay);
        }
        // bass: eighths (16ths when the track demands redline)
        const bassN = trk.bass16 && I >= 3 ? 4 : 2;
        for (let i = 0; i < bassN; i++) {
            const bt = t + i * (beat / bassN);
            const m = (i % 2 === 1) ? root + 12 : root;
            bass(bt, m, (beat / bassN) * 0.9, 0.3);
        }
        // lead: 16th arps / cowbell in hot sections
        if (I >= 3) {
            const pattern = trk.cowbell ? COW_PATTERN : ARP_PATTERN;
            for (let i = 0; i < 4; i++) {
                const tone = pattern[(beatIdx * 4 + i) % pattern.length];
                if (tone < 0) continue;
                if (trk.cowbell) {
                    cowbell(t + i * (beat / 4), 0.14);
                } else {
                    lead(t + i * (beat / 4), root + 24 + ARP_TONES[tone], (beat / 4) * 0.85, 0.055);
                }
            }
        }
        // pad chord at the bar head
        if (beatInBar === 0) {
            pad(t, [root + 12, root + 15, root + 19], 4 * beat);
        }
    }

    function scheduleMusic() {
        if (destroyed || !music.track) return;
        const ahead = audioCtx.currentTime + 0.15;
        const beat = 60 / music.track.bpm;
        while (music.nextT < Math.min(ahead, music.until)) {
            scheduleBeat(music.beatIdx, music.nextT, beat);
            music.beatIdx++;
            music.nextT += beat;
        }
        if (music.nextT >= music.until) musicStop();
    }

    function musicStart(t0, trk, duration) {
        const ac = getAudio();
        musicGain.gain.cancelScheduledValues(ac.currentTime);
        musicGain.gain.setValueAtTime(0.9, ac.currentTime);
        delayNode.delayTime.setValueAtTime((60 / trk.bpm) * 0.75, t0);
        music.track = trk;
        music.beatIdx = 0;
        music.nextT = t0;
        music.until = t0 + duration + 0.6;
        clearInterval(music.timer);
        music.timer = setInterval(scheduleMusic, 30);
        scheduleMusic();
    }

    function musicStop() {
        if (music.timer) {
            clearInterval(music.timer);
            music.timer = null;
        }
        music.track = null;
        if (audioCtx) {
            const t = audioCtx.currentTime;
            musicGain.gain.cancelScheduledValues(t);
            musicGain.gain.setValueAtTime(musicGain.gain.value, t);
            musicGain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
        }
    }

    // ----- ambient drone for the select screen -----
    let droneNodes = null;
    let droneOn = false;

    function startDrone() {
        if (droneOn || !audioCtx || audioCtx.state !== 'running') return;
        const t = audioCtx.currentTime;
        const g = audioCtx.createGain();
        g.gain.value = 0;
        g.gain.linearRampToValueAtTime(0.05, t + 1.2);
        g.connect(master);
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 300;
        f.connect(g);
        const o1 = audioCtx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 55;
        const o2 = audioCtx.createOscillator();
        o2.type = 'triangle';
        o2.frequency.value = 110.3;
        o1.connect(f);
        o2.connect(f);
        o1.start(t);
        o2.start(t);
        droneNodes = [o1, o2, g];
        droneOn = true;
    }

    function stopDrone() {
        if (!droneOn || !audioCtx) return;
        const t = audioCtx.currentTime;
        const g = droneNodes[2];
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 0.4);
        for (const n of droneNodes) {
            try { if (typeof n.stop === 'function') n.stop(t + 0.45); } catch (e) { /* already stopped */ }
        }
        window.setTimeout(() => {
            if (!destroyed) { try { g.disconnect(); } catch (e) { /* noop */ } }
        }, 550);
        droneOn = false;
        droneNodes = null;
    }

    // ----- SFX (PRD §3.2) -----
    function sfxHit(judg) {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const t = audioCtx.currentTime;
        // metallic click
        const o = audioCtx.createOscillator();
        o.type = 'square';
        o.frequency.value = 3000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        o.connect(g);
        g.connect(sfxGain);
        o.start(t);
        o.stop(t + 0.03);
        if (judg === 'perfect') {
            blip(1568, 'triangle', 0.09, 0.12, 2093, t);
            blip(2093, 'sine', 0.12, 0.07, null, t + 0.03);
        } else if (judg === 'great') {
            blip(1175, 'triangle', 0.08, 0.1, 1568, t);
        } else {
            blip(880, 'triangle', 0.07, 0.09, 1175, t);
        }
    }

    function sfxMiss() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const t = audioCtx.currentTime;
        const o = audioCtx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(320, t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(2400, t);
        f.frequency.exponentialRampToValueAtTime(200, t + 0.25);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(f);
        f.connect(g);
        g.connect(sfxGain);
        o.start(t);
        o.stop(t + 0.32);
        const n = audioCtx.createBufferSource();
        n.buffer = noiseBuf;
        const nf = audioCtx.createBiquadFilter();
        nf.type = 'highpass';
        nf.frequency.value = 1500;
        const ng = audioCtx.createGain();
        ng.gain.setValueAtTime(0.12, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        n.connect(nf);
        nf.connect(ng);
        ng.connect(sfxGain);
        n.start(t);
        n.stop(t + 0.16);
    }

    function sfxUnlock() {
        if (!audioCtx || audioCtx.state !== 'running') return;
        const t = audioCtx.currentTime;
        [0, 4, 7, 12, 16].forEach((st, i) => {
            blip(midiToFreq(72 + st), 'triangle', 0.3, 0.09, null, t + i * 0.09);
        });
        const n = audioCtx.createBufferSource();
        n.buffer = noiseBuf;
        const f = audioCtx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 8;
        f.frequency.setValueAtTime(400, t);
        f.frequency.exponentialRampToValueAtTime(6000, t + 0.7);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.07, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        n.connect(f);
        f.connect(g);
        g.connect(sfxGain);
        n.start(t);
        n.stop(t + 1);
    }

    // ---------- beatmap composition & parsing ----------
    // Deterministic chart builder. Emits notes in the PRD §4.1 JSON shape:
    //   { time: <sec>, type: 'tap'|'hold'|'slide'|'overload', lane, ... }
    function composeTrack(trk, diff) {
        const rng = mulberry32(trk.seed ^ Math.imul(diff.seedOffset, 2654435761));
        const beat = 60 / trk.bpm;
        const totalBars = trk.sections.reduce((a, s) => a + s.bars, 0);
        const allowHold = diff.allow.includes('hold');
        const allowSlide = diff.allow.includes('slide');
        const allowGate = diff.allow.includes('overload');
        const isElite = diff.id === 'elite';
        const notes = [];
        const laneBusyUntil = [-9, -9, -9, -9]; // beats
        let walker = 1;
        let bar = 0;

        const reserve = (lane, until) => {
            laneBusyUntil[lane] = Math.max(laneBusyUntil[lane], until);
        };

        for (const sec of trk.sections) {
            for (let sb = 0; sb < sec.bars; sb++, bar++) {
                const isFinal = bar === totalBars - 1;
                const isOutro = bar >= totalBars - 2;
                const d = isOutro
                    ? Math.min(1, sec.density * diff.densityMul) * 0.45
                    : Math.min(1, sec.density * diff.densityMul);
                const barBeat = bar * 4;
                const slotUsed = new Array(16).fill(false);
                let barCount = 0;

                // OVERLOAD GATE — every 8th bar, lands on the downbeat
                if (allowGate && !isOutro && bar > 3 && bar % 8 === 7 && rng() < 0.55) {
                    let lanes;
                    if (isElite && rng() < 0.3) {
                        lanes = [0, 1, 2, 3];
                    } else {
                        const nLanes = rng() < (isElite ? 0.5 : 0.3) ? 3 : 2;
                        const start = Math.floor(rng() * (4 - nLanes));
                        lanes = [];
                        for (let i = 0; i < nLanes; i++) lanes.push(start + i);
                    }
                    if (lanes.every((l) => laneBusyUntil[l] < barBeat - 0.5)) {
                        notes.push({ time: barBeat * beat, type: 'overload', lanes });
                        for (const l of lanes) reserve(l, barBeat + 1);
                        slotUsed[0] = true;
                    }
                }

                for (let s = 0; s < 16; s++) {
                    if (isFinal) {
                        // one clean closing tap, dead center
                        if (s === 0) notes.push({ time: barBeat * beat, type: 'tap', lane: 1 });
                        continue;
                    }
                    if (bar === 0 || slotUsed[s]) continue;
                    const bBeat = barBeat + s / 4;
                    const isDown = s % 4 === 0;
                    const isEighth = s % 4 === 2;
                    const is16th = s % 2 === 1;
                    if (is16th && (d < 0.6 || s > 0 && slotUsed[s - 1])) continue;
                    if (isEighth && d < 0.32) continue;

                    // SYSTEM BREACH slide: three adjacent-lane arrows, 8th apart
                    if (allowSlide && isDown && !isOutro && s === 0 && rng() < 0.04 + 0.09 * d) {
                        const dir = rng() < 0.5 ? 1 : -1;
                        const l0 = Math.max(0, Math.min(3 - 2 * dir, walker + (rng() < 0.5 ? -1 : 1) * Math.abs(dir)));
                        const lanes = [l0, l0 + dir, l0 + 2 * dir];
                        const ok = lanes.every((l, i) => l >= 0 && l <= 3 && laneBusyUntil[l] < barBeat + i * 0.5);
                        if (ok && !slotUsed[2] && !slotUsed[4]) {
                            notes.push({ time: barBeat * beat, type: 'slide', lanes, stepDur: beat / 2 });
                            for (let i = 0; i < 3; i++) {
                                reserve(lanes[i], barBeat + i * 0.5 + 0.5);
                                slotUsed[i * 2] = true;
                            }
                            walker = lanes[2];
                            barCount += 3;
                            continue;
                        }
                    }

                    let p;
                    if (isDown) p = 0.5 + 0.45 * d;
                    else if (isEighth) p = 0.12 + 0.5 * d;
                    else p = 0.05 + 0.5 * d;
                    if (barCount > 11) p *= 0.4;
                    if (rng() >= p) continue;

                    // pick a free lane: sticky random walk
                    const free = [0, 1, 2, 3].filter((l) => laneBusyUntil[l] < bBeat);
                    if (free.length === 0) continue;
                    let lane;
                    if (free.includes(walker) && rng() < 0.55) {
                        lane = walker;
                    } else {
                        const neighbors = free.filter((l) => Math.abs(l - walker) === 1);
                        lane = (neighbors.length && rng() < 0.6)
                            ? neighbors[Math.floor(rng() * neighbors.length)]
                            : free[Math.floor(rng() * free.length)];
                    }
                    walker = lane;

                    // DATA LINK hold on downbeats
                    if (allowHold && !isOutro && (s === 0 || s === 8) && rng() < 0.1 + 0.28 * d) {
                        const durBeats = rng() < 0.5 ? 1 : 0.5;
                        if (laneBusyUntil[lane] < bBeat + durBeats) {
                            notes.push({
                                time: bBeat * beat,
                                type: 'hold',
                                lane,
                                duration: durBeats * beat
                            });
                            reserve(lane, bBeat + durBeats);
                            barCount++;
                            continue;
                        }
                    }
                    notes.push({ time: bBeat * beat, type: 'tap', lane });
                    reserve(lane, bBeat + 0.5);
                    slotUsed[s] = true;
                    barCount++;
                }
            }
        }
        return { song: trk.id, bpm: trk.bpm, notes };
    }

    // Validates a PRD §4.1 beatmap and prepares it for play.
    function parseBeatmap(raw) {
        if (!raw || typeof raw.song !== 'string') throw new Error('beatmap: missing song');
        if (!Number.isFinite(raw.bpm) || raw.bpm <= 0) throw new Error('beatmap: bad bpm');
        if (!Array.isArray(raw.notes)) throw new Error('beatmap: missing notes');
        const notes = raw.notes.map((n, i) => {
            if (!Number.isFinite(n.time) || n.time < 0) throw new Error(`beatmap: note[${i}].time`);
            if (NOTE_TYPES.indexOf(n.type) === -1) throw new Error(`beatmap: note[${i}].type`);
            const out = { time: n.time, type: n.type, resolved: false };
            if (n.type === 'tap' || n.type === 'hold') {
                if (n.lane < 0 || n.lane > 3) throw new Error(`beatmap: note[${i}].lane`);
                out.lane = n.lane;
                if (n.type === 'hold') {
                    if (!Number.isFinite(n.duration) || n.duration <= 0) throw new Error(`beatmap: note[${i}].duration`);
                    out.duration = n.duration;
                    out.holding = false;
                }
            } else if (n.type === 'slide') {
                if (!Array.isArray(n.lanes) || n.lanes.length !== 3) throw new Error(`beatmap: note[${i}].lanes`);
                out.lanes = n.lanes.slice();
                out.stepDur = Number.isFinite(n.stepDur) ? n.stepDur : 0.25;
                out.steps = n.lanes.map((l, k) => ({
                    lane: l,
                    time: n.time + k * out.stepDur,
                    dir: k === 0 ? 0 : Math.sign(l - n.lanes[k - 1]),
                    resolved: false
                }));
            } else if (n.type === 'overload') {
                if (!Array.isArray(n.lanes) || n.lanes.length < 2 || n.lanes.length > 4) throw new Error(`beatmap: note[${i}].lanes`);
                out.lanes = n.lanes.slice().sort((a, b) => a - b);
                out.pressedAt = {};
            }
            return out;
        }).sort((a, b) => a.time - b.time);
        const last = notes[notes.length - 1];
        const duration = (last ? last.time + (last.type === 'hold' ? last.duration : last.type === 'slide' ? (last.steps.length - 1) * last.stepDur : 0) : 0) + (2 * 60 / raw.bpm);
        return { song: raw.song, bpm: raw.bpm, notes, duration };
    }

    // ---------- high scores (shared hub pattern) ----------
    function getScores() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveHighScore(initials, runScore) {
        const scores = getScores();
        scores.push({ initials, score: runScore, date: new Date().toLocaleDateString() });
        scores.sort((a, b) => b.score - a.score);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, 5)));
        } catch (e) { /* storage unavailable */ }
        bestScore = scores[0].score;
    }

    function renderLeaderboard() {
        const scores = getScores();
        if (scores.length === 0) return '<li class="empty">No scores yet — be the first breach!</li>';
        return scores
            .map((s, i) =>
                `<li><span><span class="rank">${i + 1}.</span><span class="initials">${escapeHtml(s.initials)}</span></span><span class="entry-score">${s.score}</span></li>`
            )
            .join('');
    }

    // ---------- game state ----------
    let state = 'select';       // select | countdown | playing | over
    let activeTrack = null;
    let activeDiff = null;
    let beatmap = null;
    let notes = [];
    let startT = 0;
    let endT = 0;
    let noteIdx = 0;
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let sync = 100;             // sync integrity (PRD §Phase 2 health bar)
    let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    let judged = 0;
    let bestScore = 0;
    let holds = {};             // lane -> { n, startT, lastTick }
    let goT = 0;
    let glitchT = 0;
    let judgeText = '';
    let judgeSub = '';
    let judgeColor = '#fff';
    let judgeT = 0;
    let comboPop = 0;
    let laneFlash = [0, 0, 0, 0];
    let particles = [];
    let floaters = [];
    let lastScoreShown = -1;
    let destroyed = false;
    let rafId = null;
    let lastNow = 0;
    let nowSource = null;
    let acc = 0;
    let selectOverlay = null;
    let endOverlay = null;
    let selTrack = 0;
    let selDiff = 1;

    // ---------- particles & floaters ----------
    function spawnShards(x, y, color, n, spread) {
        if (reduced()) return;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 60 + Math.random() * (spread || 300);
            particles.push({
                x, y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v - 100,
                g: 720,
                life: 1,
                decay: 1 / (0.35 + Math.random() * 0.4),
                size: 2 + Math.random() * 3,
                color
            });
        }
        if (particles.length > 200) particles.splice(0, particles.length - 200);
    }

    function spawnHitFX(lane, judg) {
        spawnShards(px(laneWX(lane), Z_HIT), py(Z_HIT), JUDGE[judg].color, judg === 'perfect' ? 14 : 9);
    }

    function spawnShatter(gate) {
        if (reduced()) return;
        const z = Z_HIT;
        const xL = px(laneWX(gate.lanes[0]) - 0.8, z);
        const xR = px(laneWX(gate.lanes[gate.lanes.length - 1]) + 0.8, z);
        for (let i = 0; i < 36; i++) {
            particles.push({
                x: xL + Math.random() * (xR - xL),
                y: py(z) - Math.random() * 60,
                vx: (Math.random() - 0.5) * 460,
                vy: -60 - Math.random() * 260,
                g: 760,
                life: 1,
                decay: 1 / (0.4 + Math.random() * 0.4),
                size: 2 + Math.random() * 3.5,
                color: Math.random() < 0.5 ? '#c084fc' : '#a3e635'
            });
        }
        if (particles.length > 200) particles.splice(0, particles.length - 200);
    }

    function addFloater(x, y, text, color) {
        floaters.push({ x, y, text, color, t: 0 });
        if (floaters.length > 24) floaters.shift();
    }

    function updateParticles(dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= p.decay * dt;
            if (p.life <= 0) {
                particles[i] = particles[particles.length - 1];
                particles.pop();
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.g * dt;
        }
    }

    // ---------- run control ----------
    function beginRun() {
        if (destroyed || state !== 'select') return;
        const ac = getAudio();
        ac.resume();
        stopDrone();
        if (selectOverlay) {
            selectOverlay.remove();
            selectOverlay = null;
        }

        activeTrack = TRACKS[selTrack];
        activeDiff = DIFFICULTIES[selDiff];
        activeTrack.barMap = [];
        for (const sec of activeTrack.sections) {
            for (let i = 0; i < sec.bars; i++) activeTrack.barMap.push(sec);
        }

        const raw = composeTrack(activeTrack, activeDiff);
        beatmap = parseBeatmap(raw);
        notes = beatmap.notes;

        startT = ac.currentTime + COUNTDOWN;
        endT = startT + beatmap.duration;

        score = 0;
        combo = 0;
        maxCombo = 0;
        sync = 100;
        counts = { perfect: 0, great: 0, good: 0, miss: 0 };
        judged = 0;
        noteIdx = 0;
        holds = {};
        goT = 0;
        glitchT = 0;
        judgeT = 0;
        comboPop = 0;
        laneFlash = [0, 0, 0, 0];
        particles.length = 0;
        floaters.length = 0;
        lastScoreShown = -1;
        scoreDisplay.textContent = 'Score: 0';

        // stamp absolute audio-clock times onto every note
        for (const n of notes) {
            n.timeAbs = startT + n.time;
            if (n.type === 'hold') n.endAbs = n.timeAbs + n.duration;
            if (n.type === 'slide') {
                for (const st of n.steps) st.timeAbs = startT + st.time;
            }
        }

        // count-in, scheduled on the audio clock
        for (let i = 1; i <= 3; i++) blip(660, 'square', 0.09, 0.08, null, startT - i);
        blip(1046, 'square', 0.25, 0.1, null, startT);

        musicStart(startT, activeTrack, beatmap.duration);
        state = 'countdown';
    }

    function finishRun(success) {
        if (state !== 'playing') return;
        state = 'over';
        musicStop();
        if (success) {
            sfxUnlock();
        } else {
            glitchT = 0.6;
        }
        window.setTimeout(() => {
            if (!destroyed) showEndModal(success);
        }, success ? 900 : 700);
    }

    // ---------- judgment ----------
    function gradeOffset(off) {
        const a = Math.abs(off);
        if (a <= PERFECT_W) return 'perfect';
        if (a <= GREAT_W) return 'great';
        if (a <= GOOD_W) return 'good';
        return 'miss';
    }

    function showJudge(kind, lane, sub) {
        judgeText = JUDGE[kind].text;
        judgeColor = JUDGE[kind].color;
        judgeSub = sub || '';
        judgeT = 0.55;
        if (kind !== 'miss') {
            combo++;
            maxCombo = Math.max(maxCombo, combo);
            comboPop = 1;
        } else {
            combo = 0;
        }
        if (lane != null && lane >= 0) laneFlash[lane] = 1;
    }

    function registerHit(n, lane, off, kind) {
        const g = gradeOffset(off);
        let pts;
        if (kind === 'step') {
            pts = g === 'perfect' ? 150 : g === 'great' ? 100 : 50;
        } else if (kind === 'gate') {
            pts = 150 * n.lanes.length + (g === 'perfect' ? 50 : g === 'great' ? 25 : 0);
        } else {
            pts = g === 'perfect' ? 300 : g === 'great' ? 200 : 100;
        }
        score += pts;
        counts[g]++;
        judged++;
        sync = Math.min(100, sync + (g === 'perfect' ? 4 : g === 'great' ? 2 : 1));
        showJudge(g, lane, null);
        sfxHit(g);
        if (kind !== 'gate' && lane >= 0) {
            spawnHitFX(lane, g);
            addFloater(px(laneWX(lane), Z_HIT), py(Z_HIT) - 40, '+' + pts, JUDGE[g].color);
        }
    }

    function doMiss(n, lane, penalty) {
        counts.miss++;
        judged++;
        combo = 0;
        sync = Math.max(0, sync - (penalty != null ? penalty : 14));
        glitchT = 0.28;
        judgeText = 'MISS';
        judgeColor = JUDGE.miss.color;
        judgeSub = '';
        judgeT = 0.55;
        sfxMiss();
        if (lane != null && lane >= 0) {
            addFloater(px(laneWX(lane), Z_HIT), py(Z_HIT) - 40, 'MISS', JUDGE.miss.color);
        }
        if (n) n.resolved = true;
    }

    function failGate(gate) {
        counts.miss++;
        judged++;
        combo = 0;
        sync = Math.max(0, sync - 20);
        glitchT = 0.45;
        judgeText = 'MISS';
        judgeColor = JUDGE.miss.color;
        judgeSub = 'GATE BREACH FAILED';
        judgeT = 0.7;
        sfxMiss();
        gate.resolved = true;
        advanceIdx();
    }

    function fullyResolved(n) {
        if (n.type === 'slide') return n.steps.every((s) => s.resolved);
        return n.resolved;
    }

    function advanceIdx() {
        while (noteIdx < notes.length && fullyResolved(notes[noteIdx])) noteIdx++;
    }

    // ---------- input ----------
    function press(lane) {
        if (destroyed || state !== 'playing') return;
        const t = audioCtx.currentTime;
        laneFlash[lane] = 1;

        // 1) overload gate first (its lanes are reserved, so no ambiguity)
        const cur = notes[noteIdx];
        if (cur && cur.type === 'overload' && !cur.resolved &&
            cur.lanes.indexOf(lane) !== -1 && !(lane in cur.pressedAt) &&
            Math.abs(t - cur.timeAbs) <= OVER_W) {
            cur.pressedAt[lane] = t;
            sfxHit('good');
            spawnShards(px(laneWX(lane), Z_HIT), py(Z_HIT), LANE_COLORS[lane], 6, 180);
            if (cur.lanes.every((l) => l in cur.pressedAt)) {
                let worst = 0;
                for (const l of cur.lanes) {
                    worst = Math.max(worst, Math.abs(cur.pressedAt[l] - cur.timeAbs));
                }
                cur.resolved = true;
                registerHit(cur, -1, worst, 'gate');
                spawnShatter(cur);
                addFloater(W / 2, py(Z_HIT) - 70, 'BREACH CLEARED', '#a3e635');
                advanceIdx();
            }
            return;
        }

        // 2) nearest candidate note in the window
        let best = null;
        let bestA = Infinity;
        for (let i = noteIdx; i < notes.length; i++) {
            const n = notes[i];
            if (n.timeAbs - t > 0.25) break;
            if (n.type === 'tap' && !n.resolved && n.lane === lane) {
                const a = Math.abs(t - n.timeAbs);
                if (a <= GOOD_W && a < bestA) { best = { n, lane, off: t - n.timeAbs, kind: 'tap' }; bestA = a; }
            } else if (n.type === 'hold' && !n.resolved && !n.holding && n.lane === lane) {
                const a = Math.abs(t - n.timeAbs);
                if (a <= GOOD_W && a < bestA) { best = { n, lane, off: t - n.timeAbs, kind: 'hold' }; bestA = a; }
            } else if (n.type === 'slide') {
                for (const st of n.steps) {
                    if (st.resolved || st.lane !== lane) continue;
                    const a = Math.abs(t - st.timeAbs);
                    if (a <= SLIDE_GOOD_W && a < bestA) { best = { n, st, lane, off: t - st.timeAbs, kind: 'step' }; bestA = a; }
                }
            }
        }
        if (!best) return; // stray press: flash only, no penalty

        if (best.kind === 'tap') {
            best.n.resolved = true;
            registerHit(best.n, best.lane, best.off, 'tap');
        } else if (best.kind === 'step') {
            best.st.resolved = true;
            registerHit(best.n, best.lane, best.off, 'step');
        } else if (best.kind === 'hold') {
            best.n.holding = true;
            holds[best.lane] = { n: best.n, startT: t, lastTick: best.n.timeAbs };
            registerHit(best.n, best.lane, best.off, 'tap');
        }
        advanceIdx();
    }

    function release(lane) {
        if (destroyed || !holds[lane]) return;
        const h = holds[lane];
        delete holds[lane];
        const t = audioCtx.currentTime;
        const n = h.n;
        if (n.resolved) return;
        if (t >= n.endAbs - 0.02) {
            completeHold(n, true);
        } else {
            const frac = (t - n.timeAbs) / n.duration;
            if (frac >= 0.75) {
                n.resolved = true;
                const pts = Math.round(50 * frac);
                score += pts;
                sync = Math.max(0, sync - 2);
                addFloater(px(laneWX(lane), Z_HIT), py(Z_HIT) - 40, '+' + pts, '#9aa3b5');
                blip(700, 'triangle', 0.08, 0.06, 400);
            } else {
                doMiss(n, lane, 12);
            }
        }
        advanceIdx();
    }

    function completeHold(n, full) {
        n.resolved = true;
        if (full) {
            score += 50;
            sync = Math.min(100, sync + 2);
            addFloater(px(laneWX(n.lane), Z_HIT), py(Z_HIT) - 40, 'LINK +50', LANE_COLORS[n.lane]);
            blip(1320, 'sine', 0.12, 0.08, 1760);
        }
    }

    // ---------- logic update (fixed 60 Hz on the audio clock) ----------
    function update(dt) {
        if (destroyed) return;
        const t = audioCtx.currentTime;

        if (state === 'countdown' && t >= startT) {
            state = 'playing';
            goT = 0.7;
        }

        if (state === 'playing') {
            goT = Math.max(0, goT - dt);

            // holds: ticks + auto-complete at the tail
            for (const lane in holds) {
                const h = holds[lane];
                const n = h.n;
                if (n.resolved) { delete holds[lane]; continue; }
                if (t >= n.endAbs) {
                    completeHold(n, true);
                    delete holds[lane];
                    continue;
                }
                const halfBeat = (60 / beatmap.bpm) / 2;
                const nextTick = n.timeAbs + (Math.floor((t - n.timeAbs) / halfBeat) + 1) * halfBeat;
                if (t >= nextTick) {
                    score += 10;
                    h.lastTick = nextTick;
                    if (!reduced()) spawnShards(px(laneWX(lane), Z_HIT), py(Z_HIT), LANE_COLORS[lane], 3, 120);
                }
            }

            // miss detection on the earliest unresolved note
            const n = notes[noteIdx];
            if (n) {
                if (n.type === 'tap' && !n.resolved && t > n.timeAbs + GOOD_W) {
                    doMiss(n, n.lane, 14);
                } else if (n.type === 'hold' && !n.resolved) {
                    if (t > n.timeAbs + GOOD_W && !n.holding) {
                        doMiss(n, n.lane, 14);
                    }
                } else if (n.type === 'slide') {
                    for (const st of n.steps) {
                        if (!st.resolved && t > st.timeAbs + SLIDE_GOOD_W) {
                            st.resolved = true;
                            doMiss(n, st.lane, 14);
                            n.resolved = true; // one broken step kills the rest
                            for (const s2 of n.steps) s2.resolved = true;
                            break;
                        }
                    }
                } else if (n.type === 'overload' && !n.resolved && t > n.timeAbs + OVER_W + 0.02) {
                    failGate(n);
                }
                advanceIdx();
            }

            if (sync <= 0) {
                finishRun(false);
            } else if (t > endT) {
                finishRun(true);
            }
        }

        // decay FX
        for (let i = 0; i < 4; i++) laneFlash[i] = Math.max(0, laneFlash[i] - dt * 5);
        judgeT = Math.max(0, judgeT - dt);
        comboPop = Math.max(0, comboPop - dt * 4);
        glitchT = Math.max(0, glitchT - dt);
        updateParticles(dt);
        for (let i = floaters.length - 1; i >= 0; i--) {
            floaters[i].t += dt;
            if (floaters[i].t >= 0.7) floaters.splice(i, 1);
        }

        const s = Math.floor(score);
        if (s !== lastScoreShown) {
            lastScoreShown = s;
            scoreDisplay.textContent = 'Score: ' + s;
        }
    }

    // ---------- rendering ----------
    function beatInfo(t) {
        const bpm = activeTrack ? activeTrack.bpm : 120;
        const bps = bpm / 60;
        const beatT = t - startT;
        const phase = ((beatT * bps) % 1 + 1) % 1;
        const pulse = Math.pow(1 - phase, 3);
        return { phase, pulse };
    }

    function drawRoad(g, t, pulse, accent) {
        // base
        g.fillStyle = '#12152e';
        g.beginPath();
        g.moveTo(px(-ROAD_EDGE, Z_FAR), py(Z_FAR));
        g.lineTo(px(ROAD_EDGE, Z_FAR), py(Z_FAR));
        g.lineTo(px(ROAD_EDGE, Z_NEAR), py(Z_NEAR));
        g.lineTo(px(-ROAD_EDGE, Z_NEAR), py(Z_NEAR));
        g.closePath();
        g.fill();

        // horizontal beat grid lines (cross the hit line on every beat)
        const grid = (60 / (activeTrack ? activeTrack.bpm : 120));
        const pMin = t + (Z_NEAR - Z_HIT) / SPEED;
        const pMax = t + (Z_FAR - Z_HIT) / SPEED;
        for (let k = Math.floor(pMin / grid); k * grid <= pMax; k++) {
            const z = Z_HIT + (k * grid - t) * SPEED;
            if (z < Z_NEAR || z > Z_FAR) continue;
            const depth = 1 - (z - Z_HIT) / (Z_FAR - Z_HIT);
            const a = Math.min(0.6, (0.08 + 0.38 * depth) * (0.65 + 0.75 * pulse));
            g.strokeStyle = hexA(accent, a);
            g.lineWidth = z > 24 ? 1 : 2;
            g.beginPath();
            g.moveTo(px(-ROAD_EDGE, z), py(z));
            g.lineTo(px(ROAD_EDGE, z), py(z));
            g.stroke();
        }

        // lane lines
        for (let i = 0; i <= 4; i++) {
            const x = -ROAD_EDGE + i * LANE_SP;
            const edge = i === 0 || i === 4;
            const col = edge ? accent : '#c084fc';
            if (edge) {
                g.strokeStyle = hexA(col, 0.16 + 0.2 * pulse);
                g.lineWidth = 5;
                g.beginPath();
                g.moveTo(px(x, Z_FAR), py(Z_FAR));
                g.lineTo(px(x, Z_NEAR), py(Z_NEAR));
                g.stroke();
            }
            g.strokeStyle = hexA(col, edge ? 0.95 : 0.5);
            g.lineWidth = edge ? 2 : 1.5;
            g.beginPath();
            g.moveTo(px(x, Z_FAR), py(Z_FAR));
            g.lineTo(px(x, Z_NEAR), py(Z_NEAR));
            g.stroke();
        }
    }

    function drawSideTowers(g, t, pulse, accent) {
        const sp = (60 / (activeTrack ? activeTrack.bpm : 120)) * 4; // one tower per bar
        const pMin = t + (Z_NEAR - Z_HIT) / SPEED - 4;
        const pMax = t + (Z_FAR - Z_HIT) / SPEED;
        for (let k = Math.floor(pMin / sp); k * sp <= pMax; k++) {
            const z = Z_HIT + (k * sp - t) * SPEED;
            if (z < Z_NEAR + 1 || z > Z_FAR) continue;
            const side = (Math.abs(k) % 2 === 0) ? -1 : 1;
            const x = side * (ROAD_EDGE + 1.4);
            const h = 1.6 + ((Math.abs(k) * 37) % 10) * 0.22;
            const w = 0.9 * K / z;
            const yB = py(z);
            const yT = pyw(z, h);
            const fade = Math.min(1, (Z_FAR - z) / 50);
            g.globalAlpha = fade;
            g.fillStyle = '#0a0916';
            g.fillRect(px(x - 0.45, z), yT, w, yB - yT);
            g.fillStyle = hexA(k % 4 === 0 ? '#a3e635' : accent, 0.35 + 0.5 * pulse);
            g.fillRect(px(x - 0.45, z), yT, w, Math.max(1.5, (yB - yT) * 0.12));
            g.fillStyle = hexA('#c084fc', 0.25);
            for (let wy = 1; wy < 4; wy++) {
                g.fillRect(px(x - 0.25, z), yT + (yB - yT) * (wy / 4), w * 0.16, 1.5);
            }
            g.globalAlpha = 1;
        }
    }

    function drawNoteBlock(g, lane, z, color, alpha, active) {
        const xL = px(laneWX(lane) - 0.62, z);
        const xR = px(laneWX(lane) + 0.62, z);
        const yB = py(z);
        const yT = pyw(z, 0.5);
        g.globalAlpha = alpha;
        // glow
        g.fillStyle = hexA(color, active ? 0.4 : 0.22);
        g.fillRect(xL - 5, yT - 5, xR - xL + 10, yB - yT + 10);
        // body
        const grad = g.createLinearGradient(0, yT, 0, yB);
        grad.addColorStop(0, color);
        grad.addColorStop(1, hexA(color, 0.55));
        g.fillStyle = grad;
        g.fillRect(xL, yT, xR - xL, yB - yT);
        // top edge
        g.fillStyle = 'rgba(255, 255, 255, 0.85)';
        g.fillRect(xL, yT, xR - xL, 2);
        g.globalAlpha = 1;
    }

    function drawHold(g, n, t, pulse, alphaBase) {
        const color = LANE_COLORS[n.lane];
        const held = n.holding || holds[n.lane];
        const zHead = Z_HIT + (n.timeAbs - t) * SPEED;
        const zTail = Z_HIT + (n.endAbs - t) * SPEED;
        const zFrom = held ? Math.min(zTail, Z_HIT + 0.001) : zHead;
        const zTo = held ? Z_HIT + 0.001 : zTail;
        if (zTo > Z_FAR || zFrom < Z_NEAR - 2) return;
        const alpha = alphaBase * (held ? 0.95 : 0.8);
        const wF = 0.5 * LANE_SP * K / zFrom;
        const wT = 0.5 * LANE_SP * K / Math.max(zTo, 4);
        const xF = px(laneWX(n.lane), zFrom);
        const xT = px(laneWX(n.lane), zTo);
        const yF = py(zFrom);
        const yT = py(zTo);
        const grad = g.createLinearGradient(0, yT, 0, yF);
        grad.addColorStop(0, hexA(color, 0.12));
        grad.addColorStop(1, hexA(color, 0.55));
        g.globalAlpha = alpha;
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(xF - wF / 2, yF);
        g.lineTo(xT - wT / 2, yT);
        g.lineTo(xT + wT / 2, yT);
        g.lineTo(xF + wF / 2, yF);
        g.closePath();
        g.fill();
        // edges
        g.strokeStyle = hexA(color, 0.8);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(xF - wF / 2, yF);
        g.lineTo(xT - wT / 2, yT);
        g.moveTo(xF + wF / 2, yF);
        g.lineTo(xT + wT / 2, yT);
        g.stroke();
        // energy pulse riding the link
        if (held && !reduced()) {
            const f = ((t * 2.2) % 1 + 1) % 1;
            const zp = zTo + (zFrom - zTo) * f;
            const wp = 0.5 * LANE_SP * K / zp;
            g.fillStyle = 'rgba(255, 255, 255, ' + (0.5 * pulse + 0.2).toFixed(3) + ')';
            g.fillRect(px(laneWX(n.lane), zp) - wp / 2, py(zp) - 2, wp, 4);
        }
        g.globalAlpha = 1;
    }

    function drawSlide(g, n, t, alphaBase) {
        const color = '#a3e635';
        // ribbon connecting the steps
        g.globalAlpha = alphaBase * 0.3;
        g.strokeStyle = color;
        g.lineWidth = Math.max(3, 0.34 * LANE_SP * K / (Z_HIT + (n.timeAbs - t) * SPEED));
        g.lineJoin = 'round';
        g.beginPath();
        for (let i = 0; i < n.steps.length; i++) {
            const st = n.steps[i];
            const z = Z_HIT + (st.timeAbs - t) * SPEED;
            if (z < Z_NEAR || z > Z_FAR) continue;
            const x = px(laneWX(st.lane), z);
            const y = (py(z) + pyw(z, 0.5)) / 2;
            if (i === 0 || n.steps[i - 1].resolved) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.stroke();
        g.globalAlpha = 1;
        // chevrons
        for (const st of n.steps) {
            const z = Z_HIT + (st.timeAbs - t) * SPEED;
            if (z < Z_NEAR || z > Z_FAR) continue;
            const x = px(laneWX(st.lane), z);
            const y = (py(z) + pyw(z, 0.5)) / 2;
            const s = 0.42 * LANE_SP * K / z;
            const a = alphaBase * (st.resolved ? 0.35 : 1);
            g.globalAlpha = a;
            if (st.resolved) {
                g.fillStyle = color;
                g.beginPath();
                g.arc(x, y, s * 0.3, 0, Math.PI * 2);
                g.fill();
            } else {
                g.strokeStyle = color;
                g.lineWidth = Math.max(2, s * 0.22);
                g.lineCap = 'round';
                for (const off of [-1, 1]) {
                    g.beginPath();
                    g.moveTo(x + off * s * 0.16 - s * 0.3, y - s * 0.32);
                    g.lineTo(x + off * s * 0.16 + s * 0.3, y);
                    g.lineTo(x + off * s * 0.16 - s * 0.3, y + s * 0.32);
                    g.stroke();
                }
                g.fillStyle = 'rgba(255, 255, 255, 0.9)';
                g.fillRect(x - s * 0.5, y - 1, s, 2);
            }
            g.globalAlpha = 1;
        }
    }

    function drawGate(g, n, t, pulse) {
        const z = Z_HIT + (n.timeAbs - t) * SPEED;
        if (z < Z_NEAR || z > Z_FAR) return;
        const l0 = laneWX(n.lanes[0]) - 0.8;
        const l1 = laneWX(n.lanes[n.lanes.length - 1]) + 0.8;
        const xL = px(l0, z);
        const xR = px(l1, z);
        const yB = py(z);
        const yT = pyw(z, 1.15);
        const flash = 0.22 + 0.3 * pulse + (Math.floor(t * 8) % 2 === 0 ? 0.12 : 0);
        g.fillStyle = hexA('#a855f7', flash * 0.5);
        g.fillRect(xL, yT, xR - xL, yB - yT);
        // pressed lane segments glow green
        for (const l of n.lanes) {
            if (l in n.pressedAt) {
                const a = px(laneWX(l) - 0.7, z);
                const b = px(laneWX(l) + 0.7, z);
                g.fillStyle = hexA('#a3e635', 0.5);
                g.fillRect(a, yT, b - a, yB - yT);
            }
        }
        // hazard stripes
        g.save();
        g.beginPath();
        g.rect(xL, yT, xR - xL, yB - yT);
        g.clip();
        g.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        g.lineWidth = 4;
        for (let sx = xL - (yB - yT); sx < xR + (yB - yT); sx += 18) {
            g.beginPath();
            g.moveTo(sx, yB + 4);
            g.lineTo(sx + (yB - yT), yT - 4);
            g.stroke();
        }
        g.restore();
        // border
        g.strokeStyle = hexA('#c084fc', 0.9);
        g.lineWidth = 2;
        g.strokeRect(xL, yT, xR - xL, yB - yT);
        // warning glyph
        g.fillStyle = 'rgba(255, 255, 255, 0.9)';
        g.font = '700 ' + Math.max(10, Math.round(0.5 * K / z)) + 'px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', (xL + xR) / 2, (yT + yB) / 2);
        g.textBaseline = 'alphabetic';
    }

    function drawNotes(g, t, pulse) {
        if (state !== 'playing' && state !== 'countdown') return;
        const vis = [];
        for (let i = noteIdx; i < notes.length; i++) {
            const n = notes[i];
            const z = Z_HIT + (n.timeAbs - t) * SPEED;
            if (z > Z_FAR) break;
            vis.push(n);
        }
        vis.reverse(); // far → near
        for (const n of vis) {
            const z = Z_HIT + (n.timeAbs - t) * SPEED;
            if (z < Z_NEAR - 2) continue;
            let alpha = Math.min(1, (Z_FAR - z) / 12);
            if (z < Z_HIT) alpha *= Math.max(0, 1 - (Z_HIT - z) / 2.5);
            if (n.resolved && n.type !== 'overload') alpha *= 0.25;
            if (alpha <= 0.01) continue;

            if (n.type === 'tap') {
                if (!n.resolved || t - n.timeAbs < 0.15) {
                    drawNoteBlock(g, n.lane, z, LANE_COLORS[n.lane], alpha, laneFlash[n.lane] > 0.4);
                }
            } else if (n.type === 'hold') {
                drawHold(g, n, t, pulse, alpha);
                if (z >= Z_NEAR && (!n.resolved || n.holding)) {
                    drawNoteBlock(g, n.lane, z, LANE_COLORS[n.lane], alpha, n.holding);
                }
            } else if (n.type === 'slide') {
                drawSlide(g, n, t, alpha);
            } else if (n.type === 'overload') {
                if (!n.resolved) drawGate(g, n, t, pulse);
            }
        }
    }

    function drawHitZone(g, t, pulse) {
        const y = py(Z_HIT);
        const xL = px(-ROAD_EDGE, Z_HIT);
        const xR = px(ROAD_EDGE, Z_HIT);
        const accent = activeTrack ? activeTrack.accent : '#22d3ee';
        g.fillStyle = hexA(accent, 0.14 + 0.2 * pulse);
        g.fillRect(xL, y - 6, xR - xL, 12);
        g.strokeStyle = hexA(accent, 0.95);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(xL, y);
        g.lineTo(xR, y);
        g.stroke();

        // receptors
        for (let lane = 0; lane < 4; lane++) {
            const x = px(laneWX(lane), Z_HIT);
            const s = 0.42 * LANE_SP * K / Z_HIT;
            const hot = laneFlash[lane] > 0.35 || !!holds[lane];
            const col = LANE_COLORS[lane];
            g.save();
            g.translate(x, y);
            g.rotate(Math.PI / 4);
            const d = s * (hot ? 1.12 : 1);
            if (hot) {
                g.fillStyle = hexA(col, 0.45);
                g.fillRect(-d, -d, d * 2, d * 2);
            }
            g.strokeStyle = hexA(col, hot ? 1 : 0.55 + 0.3 * pulse);
            g.lineWidth = hot ? 3 : 2;
            g.strokeRect(-d, -d, d * 2, d * 2);
            g.restore();
            if (hot) {
                g.fillStyle = 'rgba(255, 255, 255, 0.9)';
                g.beginPath();
                g.arc(x, y, 3, 0, Math.PI * 2);
                g.fill();
            }
            // key label
            g.fillStyle = 'rgba(233, 213, 255, 0.55)';
            g.font = '600 12px system-ui, sans-serif';
            g.textAlign = 'center';
            g.fillText(KEY_LABELS[lane], x, y + 30);
        }
    }

    function drawParticles(g) {
        for (const p of particles) {
            g.globalAlpha = Math.max(0, Math.min(1, p.life));
            g.fillStyle = p.color;
            g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        g.globalAlpha = 1;
    }

    function drawFloaters(g) {
        if (!floaters.length) return;
        g.font = '700 15px system-ui, sans-serif';
        g.textAlign = 'center';
        for (const f of floaters) {
            const a = Math.max(0, 1 - f.t / 0.7);
            g.globalAlpha = a;
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(4, 5, 12, 0.8)';
            g.strokeText(f.text, f.x, f.y - f.t * 46);
            g.fillStyle = f.color;
            g.fillText(f.text, f.x, f.y - f.t * 46);
        }
        g.globalAlpha = 1;
    }

    function drawHUD(g, t) {
        // score
        g.textBaseline = 'alphabetic';
        g.textAlign = 'left';
        g.font = '600 10px system-ui, sans-serif';
        g.fillStyle = 'rgba(233, 213, 255, 0.6)';
        g.fillText('S C O R E', 14, 20);
        g.font = '700 22px system-ui, sans-serif';
        g.fillStyle = '#ffffff';
        g.fillText(String(Math.floor(score)), 14, 42);
        // best
        g.textAlign = 'right';
        g.font = '600 10px system-ui, sans-serif';
        g.fillStyle = 'rgba(233, 213, 255, 0.6)';
        g.fillText('B E S T', W - 14, 20);
        g.font = '700 22px system-ui, sans-serif';
        g.fillStyle = '#e9d5ff';
        g.fillText(String(bestScore), W - 14, 42);

        // sync integrity bar
        const bw = 190;
        const bx = W / 2 - bw / 2;
        const by = 24;
        g.textAlign = 'center';
        g.font = '600 9px system-ui, sans-serif';
        g.fillStyle = sync < 30 ? 'rgba(251, 113, 133, 0.9)' : 'rgba(233, 213, 255, 0.6)';
        g.fillText('S Y N C   I N T E G R I T Y', W / 2, 16);
        g.fillStyle = 'rgba(255, 255, 255, 0.08)';
        rr(g, bx, by, bw, 8, 4);
        g.fill();
        const frac = Math.max(0, Math.min(1, sync / 100));
        if (frac > 0) {
            const grad = g.createLinearGradient(bx, 0, bx + bw, 0);
            grad.addColorStop(0, '#22d3ee');
            grad.addColorStop(1, '#c084fc');
            g.fillStyle = sync < 30
                ? (Math.floor(t * 8) % 2 === 0 ? '#fb7185' : grad)
                : grad;
            rr(g, bx, by, bw * frac, 8, 4);
            g.fill();
        }

        // progress
        if (beatmap && state === 'playing') {
            const prog = Math.max(0, Math.min(1, (t - startT) / beatmap.duration));
            const accent = activeTrack.accent;
            g.fillStyle = hexA(accent, 0.25);
            g.fillRect(0, H - 4, W, 4);
            g.fillStyle = hexA(accent, 0.9);
            g.fillRect(0, H - 4, W * prog, 4);
            g.textAlign = 'right';
            g.font = '600 10px system-ui, sans-serif';
            g.fillStyle = 'rgba(233, 213, 255, 0.5)';
            g.fillText(activeTrack.title + ' · ' + activeTrack.bpm + ' BPM', W - 12, H - 12);
        }

        // judgment text
        if (judgeT > 0) {
            const a = Math.min(1, judgeT / 0.25);
            const pop = 1 + 0.25 * easeOutCubic(judgeT / 0.55);
            g.save();
            g.globalAlpha = a;
            g.translate(W / 2, 262);
            g.scale(pop, pop);
            g.textAlign = 'center';
            g.font = '800 26px system-ui, sans-serif';
            g.lineWidth = 5;
            g.strokeStyle = 'rgba(4, 5, 12, 0.85)';
            g.strokeText(judgeText, 0, 0);
            g.fillStyle = judgeColor;
            g.fillText(judgeText, 0, 0);
            if (judgeSub) {
                g.font = '700 12px system-ui, sans-serif';
                g.strokeText(judgeSub, 0, 20);
                g.fillText(judgeSub, 0, 20);
            }
            g.restore();
        }

        // combo — top-left under the score, keeping the track unobstructed
        if (combo >= 2) {
            const pop = 1 + 0.3 * comboPop;
            const hot = combo >= 16;
            g.save();
            g.translate(14, 82);
            g.scale(pop, pop);
            g.textAlign = 'left';
            g.font = '800 30px system-ui, sans-serif';
            g.lineWidth = 5;
            g.strokeStyle = 'rgba(4, 5, 12, 0.85)';
            g.strokeText(String(combo), 0, 0);
            g.fillStyle = hot ? '#a3e635' : '#f4f6fb';
            g.fillText(String(combo), 0, 0);
            g.font = '700 10px system-ui, sans-serif';
            g.fillStyle = 'rgba(233, 213, 255, 0.75)';
            g.fillText('C O M B O', 1, 15);
            g.restore();
        }
    }

    function drawCountdown(g, t) {
        g.fillStyle = 'rgba(4, 5, 12, 0.5)';
        g.fillRect(0, 0, W, H);
        const c = startT - t;
        const n = Math.ceil(c);
        if (n >= 1 && n <= 3) {
            const frac = c - Math.floor(c);
            const scale = reduced() ? 1 : 1.3 - 0.3 * easeOutCubic(1 - frac);
            g.save();
            g.translate(W / 2, H * 0.38);
            g.scale(scale, scale);
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.font = '800 84px system-ui, sans-serif';
            g.lineWidth = 10;
            g.strokeStyle = 'rgba(192, 132, 252, 0.9)';
            g.strokeText(String(n), 0, 0);
            g.fillStyle = '#ffffff';
            g.fillText(String(n), 0, 0);
            g.restore();
        }
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.font = '700 13px system-ui, sans-serif';
        g.fillStyle = 'rgba(233, 213, 255, 0.8)';
        g.fillText('E S T A B L I S H I N G   N E U R A L   L I N K', W / 2, H * 0.38 - 84);
        g.font = '600 12px system-ui, sans-serif';
        g.fillStyle = 'rgba(233, 213, 255, 0.5)';
        g.fillText(activeTrack.title + ' · ' + activeDiff.name, W / 2, H * 0.38 + 84);
    }

    function drawGo(g) {
        g.save();
        g.globalAlpha = Math.min(1, goT / 0.35);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '800 52px system-ui, sans-serif';
        g.lineWidth = 8;
        g.strokeStyle = 'rgba(11, 43, 22, 0.9)';
        g.strokeText('BREACH', W / 2, H * 0.38);
        g.fillStyle = '#a3e635';
        g.fillText('BREACH', W / 2, H * 0.38);
        g.restore();
    }

    function drawCore(g, t, pulse, accent) {
        const cx = W / 2;
        const cy = HORIZON;
        const r = 38 + pulse * 16;
        const rg = g.createRadialGradient(cx, cy, 3, cx, cy, r);
        rg.addColorStop(0, hexA(accent, 0.5 + 0.28 * pulse));
        rg.addColorStop(0.55, hexA(accent, 0.14));
        rg.addColorStop(1, hexA(accent, 0));
        g.fillStyle = rg;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
        g.strokeStyle = hexA(accent, 0.5 + 0.4 * pulse);
        g.lineWidth = 1.5;
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
            const a = (Math.PI / 3) * i + t * (reduced() ? 0 : 0.15);
            const rr2 = 14 + pulse * 6;
            const x = cx + Math.cos(a) * rr2;
            const y = cy + Math.sin(a) * rr2 * 0.5;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.stroke();
        // horizon line
        g.fillStyle = hexA(accent, 0.5 + 0.4 * pulse);
        g.fillRect(0, HORIZON - 1, W, 2);
    }

    function drawScene(t) {
        const g = sctx;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, W, H);
        const accent = activeTrack ? activeTrack.accent : '#22d3ee';
        const { pulse } = beatInfo(t);

        g.drawImage(bgCanvas, 0, 0);
        drawCore(g, t, pulse, accent);
        drawRoad(g, t, pulse, accent);
        drawSideTowers(g, t, pulse, accent);
        drawNotes(g, t, pulse);
        drawHitZone(g, t, pulse);
        drawParticles(g);
        drawFloaters(g);
        drawHUD(g, t);

        // low-sync warning border
        if (state === 'playing' && sync < 25 && !reduced()) {
            const a = 0.25 * (0.5 + 0.5 * Math.sin(t * 10));
            g.strokeStyle = hexA('#fb7185', a);
            g.lineWidth = 6;
            g.strokeRect(3, 3, W - 6, H - 6);
        }

        if (state === 'countdown') drawCountdown(g, t);
        if (state === 'playing' && goT > 0) drawGo(g);
    }

    // chromatic aberration: split the scene into R/G/B channels via canvas
    // compositing, then recombine additively with a horizontal offset
    function buildChannel(c, color) {
        const g = c.getContext('2d');
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = color;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'multiply';
        g.drawImage(scene, 0, 0);
    }

    function compositeToMain() {
        const glitch = glitchT > 0 && !reduced();
        const aberr = !reduced() && state === 'playing' && combo >= 16;
        if (glitch || aberr) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            buildChannel(chR, '#ff0000');
            buildChannel(chG, '#00ff00');
            buildChannel(chB, '#0000ff');
            const dx = glitch ? 4 + 5 * (glitchT / 0.3) : 1.5 + 2.5 * Math.min(1, (combo - 16) / 24);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(chR, dx, 0);
            ctx.drawImage(chG, 0, 0);
            ctx.drawImage(chB, -dx, 0);
            ctx.globalCompositeOperation = 'source-over';
        } else {
            ctx.drawImage(scene, 0, 0);
        }
        if (glitch) {
            // displaced horizontal slices + white tear
            for (let i = 0; i < 5; i++) {
                const y = Math.random() * H;
                const h = 3 + Math.random() * 18;
                const dx = (Math.random() - 0.5) * 46 * (glitchT / 0.3);
                ctx.drawImage(scene, 0, y, W, h, dx, y + (Math.random() - 0.5) * 4, W, h);
            }
            if (Math.random() < 0.5) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
                ctx.fillRect(0, Math.random() * H, W, 1 + Math.random() * 2);
            }
        }
        ctx.globalAlpha = 0.06;
        ctx.drawImage(scanCanvas, 0, 0);
        ctx.globalAlpha = 1;
    }

    // ---------- main loop ----------
    function frame() {
        if (destroyed) return;
        rafId = requestAnimationFrame(frame);
        const ac = getAudio();
        const running = ac.state === 'running';
        const now = running ? ac.currentTime : performance.now() / 1000;
        const src = running ? 'a' : 'w';
        if (src !== nowSource) {
            nowSource = src;
            lastNow = now;
            acc = 0;
        }
        let dt = now - lastNow;
        lastNow = now;
        if (!(dt > 0)) dt = 0;
        if (dt > 0.25) dt = 0.25; // clamp background-tab gaps
        if (state === 'countdown' || state === 'playing') {
            acc += dt;
            let steps = 0;
            while (acc >= STEP && steps < 15) {
                update(STEP);
                acc -= STEP;
                steps++;
            }
            if (steps === 15) acc = 0; // drop the backlog if still behind
        }
        drawScene(now);
        compositeToMain();
    }

    // ---------- select screen ----------
    function updateSelectUI() {
        const list = selectOverlay && selectOverlay.querySelector('#ns-tracks');
        if (list) {
            Array.prototype.forEach.call(list.children, (b, i) => {
                const on = i === selTrack;
                b.style.background = on ? 'rgba(192, 132, 252, 0.16)' : 'transparent';
                b.style.borderColor = on ? 'rgba(192, 132, 252, 0.8)' : '';
            });
        }
        const drow = selectOverlay && selectOverlay.querySelector('#ns-diffs');
        if (drow) {
            Array.prototype.forEach.call(drow.children, (b, i) => {
                const on = i === selDiff;
                b.style.background = on ? 'rgba(34, 211, 238, 0.18)' : 'transparent';
                b.style.borderColor = on ? 'rgba(34, 211, 238, 0.8)' : '';
            });
        }
    }

    function setTrack(i) {
        selTrack = i;
        updateSelectUI();
        blip(990, 'triangle', 0.05, 0.05);
    }

    function setDiff(i) {
        selDiff = i;
        updateSelectUI();
        blip(1240, 'triangle', 0.05, 0.05);
    }

    function showSelect() {
        state = 'select';
        if (selectOverlay) selectOverlay.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'ns-title');
        modal.style.width = 'min(100%, 24rem)';

        const h2 = document.createElement('h2');
        h2.id = 'ns-title';
        h2.textContent = '⚡ NEURAL STRIKE';

        const sub = document.createElement('p');
        sub.textContent = 'Jack in, sync to the data stream, breach the mainframe.';
        sub.style.margin = '0 0 1rem';
        sub.style.color = 'var(--text-secondary)';
        sub.style.fontSize = '0.9rem';

        const tracks = document.createElement('div');
        tracks.id = 'ns-tracks';
        tracks.style.display = 'flex';
        tracks.style.flexDirection = 'column';
        tracks.style.gap = '0.4rem';
        tracks.setAttribute('role', 'group');
        tracks.setAttribute('aria-label', 'Select track');
        TRACKS.forEach((trk, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-ghost';
            b.setAttribute('aria-label', 'Play ' + trk.title + ' at ' + trk.bpm + ' BPM');
            b.style.width = '100%';
            b.style.display = 'flex';
            b.style.justifyContent = 'space-between';
            b.style.alignItems = 'center';
            const left = document.createElement('span');
            left.textContent = trk.title;
            const right = document.createElement('span');
            right.textContent = trk.bpm + ' BPM';
            right.style.fontSize = '0.75rem';
            right.style.color = 'var(--text-secondary)';
            b.append(left, right);
            b.addEventListener('click', () => setTrack(i));
            tracks.appendChild(b);
        });

        const dLabel = document.createElement('p');
        dLabel.textContent = 'Difficulty';
        dLabel.style.margin = '0.9rem 0 0.4rem';
        dLabel.style.fontSize = '0.8rem';
        dLabel.style.fontWeight = '700';
        dLabel.style.letterSpacing = '0.08em';
        dLabel.style.textTransform = 'uppercase';
        dLabel.style.color = 'var(--text-secondary)';

        const drow = document.createElement('div');
        drow.id = 'ns-diffs';
        drow.style.display = 'flex';
        drow.style.gap = '0.4rem';
        drow.setAttribute('role', 'group');
        drow.setAttribute('aria-label', 'Select difficulty');
        DIFFICULTIES.forEach((d, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-ghost';
            b.setAttribute('aria-label', d.name + ': ' + d.tag);
            b.style.flex = '1';
            b.style.padding = '0.5rem 0.3rem';
            b.style.fontSize = '0.8rem';
            const top = document.createElement('span');
            top.textContent = d.name;
            top.style.display = 'block';
            const bot = document.createElement('span');
            bot.textContent = d.tag;
            bot.style.display = 'block';
            bot.style.fontSize = '0.62rem';
            bot.style.color = 'var(--text-secondary)';
            b.append(top, bot);
            b.addEventListener('click', () => setDiff(i));
            drow.appendChild(b);
        });

        const hint = document.createElement('p');
        hint.textContent = 'D F J K or ← ↓ ↑ → hit the four lanes · hold notes to ride a Data Link · System Breach slides cross lanes · clear every lane of an Overload gate.';
        hint.style.margin = '1rem 0';
        hint.style.fontSize = '0.78rem';
        hint.style.color = 'var(--text-secondary)';

        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'btn btn-primary';
        start.id = 'ns-start';
        start.textContent = 'INITIATE BREACH ▶';
        start.addEventListener('click', beginRun);

        modal.append(h2, sub, tracks, dLabel, drow, hint, start);
        overlay.appendChild(modal);
        container.appendChild(overlay);
        selectOverlay = overlay;
        updateSelectUI();
        start.focus();
    }

    // ---------- end modal (shared hub pattern) ----------
    function showEndModal(success) {
        if (destroyed || endOverlay) return;
        const acc = judged > 0
            ? (counts.perfect + 0.7 * counts.great + 0.4 * counts.good) / judged
            : 0;
        const grade = !success ? '—'
            : acc >= 0.97 ? 'S'
            : acc >= 0.9 ? 'A'
            : acc >= 0.8 ? 'B'
            : acc >= 0.65 ? 'C' : 'D';

        const finalScore = Math.floor(score);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'ns-end-title');
        modal.innerHTML = `
            <h2 id="ns-end-title">${success ? 'SYSTEM BREACHED' : 'CONNECTION LOST'}</h2>
            <p class="final-score">
                ${success
                    ? `Grade <strong style="font-size:2rem;color:${acc >= 0.9 ? '#a3e635' : acc >= 0.8 ? '#22d3ee' : '#c084fc'}">${grade}</strong> · ${(acc * 100).toFixed(1)}% sync · max combo ${maxCombo}`
                    : 'The mainframe severed your link.'}
            </p>
            <p class="final-score">Final score: <strong>${finalScore}</strong></p>
            <ol class="leaderboard" id="ns-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
            <form id="ns-initials-form" class="initials-form" autocomplete="off">
                <label for="ns-initials">Your Initials</label>
                <input id="ns-initials" name="initials" maxlength="3" placeholder="NSK" spellcheck="false" autocomplete="off" autocapitalize="characters">
            </form>
            <div class="modal-actions">
                <button type="submit" form="ns-initials-form" id="ns-save" class="btn btn-primary">Save Score</button>
                <button type="button" id="ns-again" class="btn btn-ghost">Play Again</button>
                <button type="button" id="ns-home" class="btn btn-ghost">Home</button>
            </div>`;
        overlay.appendChild(modal);
        container.appendChild(overlay);
        endOverlay = overlay;

        const form = overlay.querySelector('#ns-initials-form');
        const input = overlay.querySelector('#ns-initials');
        const saveBtn = overlay.querySelector('#ns-save');
        const againBtn = overlay.querySelector('#ns-again');
        let saved = false;

        // Restrict initials to 1–3 capital letters
        input.addEventListener('input', () => {
            const cleaned = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
            if (cleaned !== input.value) input.value = cleaned;
        });

        if (finalScore > 0) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (saved) return;
                saved = true;
                const initials = (input.value.trim().toUpperCase() || '???').slice(0, 3);
                saveHighScore(initials, finalScore);
                overlay.querySelector('#ns-leaderboard').innerHTML = renderLeaderboard();
                saveBtn.textContent = 'Saved ✓';
                saveBtn.disabled = true;
                input.disabled = true;
            });
            input.focus();
        } else {
            // Zero score: skip the record entry
            form.remove();
            saveBtn.remove();
            againBtn.focus();
        }

        againBtn.addEventListener('click', () => {
            overlay.remove();
            endOverlay = null;
            showSelect();
            startDrone();
        });

        overlay.querySelector('#ns-home').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('hub:home'));
        });
    }

    // ---------- input handlers ----------
    function onKeyDown(e) {
        if (destroyed) return;
        const k = e.key.toLowerCase();
        if (state === 'select') {
            if (k === 'arrowleft') { e.preventDefault(); setDiff((selDiff + 2) % 3); }
            else if (k === 'arrowright') { e.preventDefault(); setDiff((selDiff + 1) % 3); }
            else if (k === '1' || k === '2' || k === '3') { e.preventDefault(); setTrack(+k - 1); }
            else if (k === 'enter' || k === ' ') { e.preventDefault(); beginRun(); }
            return;
        }
        if (state === 'over' || state === 'countdown') return;
        if (e.repeat) return;
        const lane = KEY_LANES[k];
        if (lane != null) {
            e.preventDefault();
            press(lane);
        }
    }

    function onKeyUp(e) {
        if (destroyed) return;
        const lane = KEY_LANES[e.key.toLowerCase()];
        if (lane != null) release(lane);
    }

    function laneFromX(clientX) {
        const rect = canvas.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 4;
        return Math.max(0, Math.min(3, Math.floor(x)));
    }

    const pointers = new Map(); // pointerId -> lane

    function onPointerDown(e) {
        if (destroyed) return;
        e.preventDefault();
        getAudio().resume();
        if (state !== 'playing') return;
        const lane = laneFromX(e.clientX);
        pointers.set(e.pointerId, lane);
        press(lane);
    }

    function onPointerMove(e) {
        if (destroyed || state !== 'playing' || !pointers.has(e.pointerId)) return;
        e.preventDefault();
        const lane = laneFromX(e.clientX);
        const prev = pointers.get(e.pointerId);
        if (lane !== prev) {
            pointers.set(e.pointerId, lane);
            press(lane); // swipe across lanes (System Breach on touch)
        }
    }

    function onPointerUp(e) {
        if (destroyed) return;
        const lane = pointers.get(e.pointerId);
        if (lane == null) return;
        pointers.delete(e.pointerId);
        release(lane);
    }

    function onPointerCancel(e) {
        const lane = pointers.get(e.pointerId);
        if (lane == null) return;
        pointers.delete(e.pointerId);
        release(lane);
    }

    // block page scroll / pull-to-refresh while the game is up
    function pageTouchMoveHandler(e) {
        if (destroyed) return;
        if (e.target instanceof Element && e.target.closest('#game-container')) {
            e.preventDefault();
        }
    }

    const gestureResume = () => {
        if (destroyed) return;
        getAudio().resume();
        if (state === 'select') startDrone();
    };

    // ---------- lifecycle ----------
    bestScore = getScores()[0] ? getScores()[0].score : 0;
    showSelect();
    getAudio().resume().catch(() => { /* needs a gesture */ });
    rafId = requestAnimationFrame(frame);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', gestureResume, { once: true });
    window.addEventListener('pointerdown', gestureResume, { once: true });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('touchmove', pageTouchMoveHandler, { passive: false });

    return {
        destroy: () => {
            destroyed = true;
            cancelAnimationFrame(rafId);
            musicStop();
            stopDrone();
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('keydown', gestureResume);
            window.removeEventListener('pointerdown', gestureResume);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerCancel);
            document.removeEventListener('touchmove', pageTouchMoveHandler);
            try {
                if (audioCtx) audioCtx.close();
            } catch (e) { /* already closed */ }
            container.innerHTML = '';
        }
    };
}
