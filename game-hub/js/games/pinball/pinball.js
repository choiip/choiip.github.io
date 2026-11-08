// Star Cadet Pinball — a full-size, sci-fi pinball table in the spirit of the
// classic Microsoft Pinball Arcade machines (original art, same arcade feel).
// Follows the shared hub contract: init(container) -> { destroy() }.
// Hand-rolled top-down 2D physics (no dependencies): wall-segment world,
// one-way gates, pop bumpers, slings, drop-target bank, spinner ramp ride,
// saucer, kickbacks, ball save.

export function init(container) {
    const STORAGE_KEY = 'pinball_highscores';

    // ============================================================
    //  Canvas + projection constants
    // ============================================================
    const W = 460;
    const H = 760;
    const L = 32;             // table length (y: 0 = back .. 32 = front)
    const HW = 8;             // table half width (x: -8 .. 8)

    // Straight top-down view, uniform scale.
    const SCALE = 21;                 // screen px per table unit
    const TABLE_LEFT = 62;            // screen x of the table's left edge
    const TABLE_TOP = 62;             // screen y of the dome's top

    const sxOf = (x) => TABLE_LEFT + (x + HW) * SCALE;
    const syOf = (y) => TABLE_TOP + y * SCALE;

    // ============================================================
    //  Physics tuning
    // ============================================================
    const BALL_R = 0.42;
    const GRAV = 14;          // table tilt: constant pull toward the front
    const DRAG = 0.08;        // mild rolling resistance
    const MAX_SPEED = 36;
    const WALL_REST = 0.6;    // wall restitution
    const SUBSTEPS = 6;       // physics sub-steps per logic step (anti-tunnel)

    // Table silhouette (table space)
    const DOME_CY = 8;        // dome centre y (dome radius = HW)
    const CHEEK_TOP = 19.5;   // where the sides start tapering in
    const CHEEK_BOT = 24.5;   // where the cheeks end (outlane walls begin)
    const OUT_HW = 5.6;       // outlane outer wall x (both sides)
    const DRAIN_Y = 31.5;     // drain line

    // Shooter lane (right side)
    const LANE_X = 6.6;       // inner wall x
    const LANE_CX = 7.3;      // lane centre x
    const PLUNGER_Y = 30.4;   // plunger rest position (lane front)
    const GATE_Y = 8.5;       // one-way gate plane at the lane mouth

    // Flippers
    const FL = 2.6;           // flipper length
    const FLIP_R = 0.30;      // flipper capsule radius
    const FLIP_UP = 26;       // easing rate when flicked (up)
    const FLIP_DOWN = 15;     // easing rate when returning (down)
    const FLIP_MAX_V = 16;    // cap on the surface-velocity "pop"
    const D2R = Math.PI / 180;

    // ============================================================
    //  Object layout (table space)
    // ============================================================
    const leftFlipper = { pivot: { x: -3.0, y: 29.0 }, rest: 34 * D2R, active: -20 * D2R, angle: 34 * D2R, omega: 0 };
    const rightFlipper = { pivot: { x: 3.0, y: 29.0 }, rest: 146 * D2R, active: 200 * D2R, angle: 146 * D2R, omega: 0 };
    const flippers = [leftFlipper, rightFlipper];

    // Pop bumpers + jet bumper
    const bumpers = [
        { x: -2.9, y: 11.6, r: 0.78, color: '#22d3ee', light: '#a5f3fc', cd: 0, flash: 0, pts: 100 },
        { x: 2.9, y: 11.6, r: 0.78, color: '#f472b6', light: '#fbcfe8', cd: 0, flash: 0, pts: 100 },
        { x: 0, y: 14.1, r: 0.78, color: '#fbbf24', light: '#fde68a', cd: 0, flash: 0, pts: 100 },
        { x: -4.6, y: 13.9, r: 0.55, color: '#a78bfa', light: '#ddd6fe', cd: 0, flash: 0, pts: 150, jet: true }
    ];

    const slings = [
        { ax: -4.6, ay: 21.0, bx: -2.4, by: 24.6, r: 0.35, kx: -0.5, ky: -0.86, kick: 13, cd: 0, flash: 0, pts: 50 },
        { ax: 4.6, ay: 21.0, bx: 2.4, by: 24.6, r: 0.35, kx: 0.5, ky: -0.86, kick: 13, cd: 0, flash: 0, pts: 50 }
    ];

    // Top rollover lanes (wire dividers are walls; bands detect crossings)
    const lanes = [
        { x: -3.0, band: [-3.6, -2.3], value: 100, lit: false, cd: 0, flash: 0 },
        { x: 0, band: [-1.8, 1.8], value: 100, lit: false, cd: 0, flash: 0 },
        { x: 3.0, band: [2.3, 3.6], value: 100, lit: false, cd: 0, flash: 0 }
    ];
    const LANE_PLANE_Y = 4.7;
    const LANE_VALUES = [100, 250, 500, 1000];

    // "Black hole" saucer (upper left)
    const saucer = { x: -5.3, y: 7.0, rimR: 0.78, holeR: 0.45, flash: 0, swirl: 0 };
    const SAUCER_HOLD = 0.9;
    const SAUCER_EJECT = { x: -3.7, y: 24.3 };
    // Gravity well: inside its radius the hole out-competes the table tilt, so
    // passing balls visibly curve in and slow balls get swallowed; fast shots
    // skim through and rebound off the rubber rim.
    const BH_R = 2.2;          // well radius (also the drawn "attraction zone")
    const BH_PULL = 42;        // peak pull strength near the centre
    const BH_SWIRL = 6;        // tangential component -> spiral, not straight drop
    const BH_DRAG = 1.6;       // accretion drag: bleeds orbit energy so spirals shrink inward
    const BH_EAT_SPEED = 19;   // slower than this at the mouth = swallowed
    const BH_MOUTH = 0.8;      // swallow radius (the rubber ring has a gap here)
    // Rubber rim: an open ring — the mouth window faces the field (down-right).
    const BH_MOUTH_A = -10 * D2R, BH_MOUTH_B = 100 * D2R;
    const saucerRim = [];
    {
        const steps = 13;
        for (let i = 0; i < steps; i++) {
            const t0 = BH_MOUTH_B + (Math.PI * 2 - (BH_MOUTH_B - BH_MOUTH_A)) * (i / steps);
            const t1 = BH_MOUTH_B + (Math.PI * 2 - (BH_MOUTH_B - BH_MOUTH_A)) * ((i + 1) / steps);
            saucerRim.push({
                ax: saucer.x + Math.cos(t0) * saucer.rimR, ay: saucer.y + Math.sin(t0) * saucer.rimR,
                bx: saucer.x + Math.cos(t1) * saucer.rimR, by: saucer.y + Math.sin(t1) * saucer.rimR,
                r: 0.1
            });
        }
    }

    // Drop-target bank (left flank, angled stack of 5)
    const dropBank = [];
    for (let i = 0; i < 5; i++) {
        const cx = -6.55 + i * 0.60;
        const cy = 10.2 + i * 0.35;
        dropBank.push({
            ax: cx - 0.5 * 0.42, ay: cy + 0.87 * 0.42,
            bx: cx + 0.5 * 0.42, by: cy - 0.87 * 0.42,
            cx, cy, r: 0.13, down: false, flash: 0, pop: 0
        });
    }
    let bankResetT = 0;   // >0: countdown to bank reset
    let bankDone = false; // all targets were just knocked down

    // Stand-up targets (right side) — light the kickbacks
    const standups = [
        { ax: 3.7, ay: 15.8, bx: 3.7, by: 17.2, r: 0.16, lit: false, flash: 0 },
        { ax: 3.35, ay: 18.0, bx: 3.35, by: 19.2, r: 0.16, lit: false, flash: 0 }
    ];

    // Inlane kickers (fire while the ball rolls down the inlane)
    const kickers = [
        { x: -3.85, y: 25.2, r: 0.30, kx: 0.22, ky: -0.975, power: 17, cd: 0, flash: 0 },
        { x: 3.85, y: 25.2, r: 0.30, kx: -0.22, ky: -0.975, power: 17, cd: 0, flash: 0 }
    ];

    // Outlane kickbacks (plunges at the outlane bottoms)
    const KICKBACK_CHANCE = 0.7;   // fire odds when the ball arrives; a miss keeps the charge
    const HOT_BUMPER_CHANCE = 0.3; // odds a bumper hit kicks 10-20% harder
    const kickbacks = [
        { x: -4.8, y: 30.7, side: -1, lit: false, flash: 0, cd: 0 },
        { x: 4.8, y: 30.7, side: 1, lit: false, flash: 0, cd: 0 }
    ];

    // Outlane / inlane rollovers
    const sensors = [
        { x: -4.9, y: 26.6, r: 0.42, kind: 'outL', lit: false, flash: 0, cd: 0 },
        { x: 4.9, y: 26.6, r: 0.42, kind: 'outR', lit: false, flash: 0, cd: 0 },
        { x: -3.7, y: 27.6, r: 0.40, kind: 'inL', lit: false, flash: 0, cd: 0 },
        { x: 3.7, y: 27.6, r: 0.40, kind: 'inR', lit: false, flash: 0, cd: 0 }
    ];

    // Static wall segments (everything except the dome arc + one-way planes)
    const walls = [
        { ax: -HW, ay: DOME_CY, bx: -HW, by: CHEEK_TOP, r: 0.1 },          // left outer wall
        { ax: HW, ay: DOME_CY, bx: HW, by: L, r: 0.1 },                    // right outer wall / lane outer
        { ax: -HW, ay: CHEEK_TOP, bx: -OUT_HW, by: CHEEK_BOT, r: 0.1 },    // left cheek
        { ax: LANE_X, ay: 20.7, bx: OUT_HW, by: CHEEK_BOT - 0.1, r: 0.1 }, // right outlane guide (starts at the lane wall — the shooter lane must stay open)
        { ax: -OUT_HW, ay: CHEEK_BOT, bx: -OUT_HW, by: L, r: 0.1 },        // left outlane wall
        { ax: OUT_HW, ay: CHEEK_BOT, bx: OUT_HW, by: L, r: 0.1 },          // right outlane wall
        { ax: LANE_X, ay: GATE_Y, bx: LANE_X, by: L, r: 0.15 },            // shooter lane inner wall
        { ax: -2.15, ay: 1.6, bx: -1.95, by: 4.9, r: 0.12 },               // top-lane wire dividers
        { ax: 2.15, ay: 1.6, bx: 1.95, by: 4.9, r: 0.12 },
        { ax: -4.3, ay: 24.6, bx: -3.95, by: 28.8, r: 0.15 },              // outlane guide rails
        { ax: 4.3, ay: 24.6, bx: 3.95, by: 28.8, r: 0.15 }
    ];
    // Rounded caps on wall ends (stops corner tunnelling)
    const wallCaps = [
        { x: LANE_X, y: GATE_Y, r: 0.22 },
        { x: -1.95, y: 4.9, r: 0.16 }, { x: 1.95, y: 4.9, r: 0.16 },
        { x: -3.95, y: 28.8, r: 0.2 }, { x: 3.95, y: 28.8, r: 0.2 }
    ];

    // ============================================================
    //  Right ramp — parameterized rail ride with a spinner
    // ============================================================
    function makePath(pts) {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        }
        return {
            pts, cum, total: cum[cum.length - 1],
            at(s) {
                s = Math.max(0, Math.min(this.total, s));
                let i = 1;
                while (i < this.cum.length - 1 && this.cum[i] < s) i++;
                const t = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1);
                const p = pts[i - 1], q = pts[i];
                return {
                    x: p[0] + (q[0] - p[0]) * t,
                    y: p[1] + (q[1] - p[1]) * t,
                    tx: (q[0] - p[0]), ty: (q[1] - p[1])
                };
            }
        };
    }
    const rampPts = [
        [4.5, 20.3], [5.35, 18.9], [5.75, 17.2], [5.7, 15.2], [5.2, 13.3],
        [4.2, 11.0], [2.9, 8.6], [1.9, 6.2], [1.4, 4.6]
    ];
    const ramp = makePath(rampPts);
    const RAMP_G = GRAV * 0.55;              // effective slope gravity on the rail
    const SPINNER_S = ramp.cum[2];           // spinner sits at rampPts[2]
    const SPINNER_POS = { x: rampPts[2][0], y: rampPts[2][1] };
    const railWalls = [
        { ax: 4.55, ay: 19.7, bx: 5.55, by: 15.4, r: 0.12, nx: -0.974, ny: -0.226 },
        { ax: 5.62, ay: 14.3, bx: 6.12, by: 10.9, r: 0.12, nx: -0.989, ny: -0.145 }
    ];
    const spinner = { ang: 0, v: 0, spinsThisRide: 0, acc: 0, flash: 0 };

    // ============================================================
    //  DOM
    // ============================================================
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'game-canvas';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Star Cadet Pinball: a full sci-fi pinball table. Hold Space to charge the plunger and release to launch. Use the left and right arrow keys (or A and D) for the flippers. On touch, hold to charge, then tap the left or right half for the flippers.');

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Hold to charge the plunger, release to launch · tap left / right halves for the flippers.';

    container.append(scoreDisplay, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => prefersReducedMotion.matches;

    // ============================================================
    //  Helpers
    // ============================================================
    function shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
        if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
        else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function closestPointOnSeg(px, py, ax, ay, bx, by) {
        const abx = bx - ax, aby = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1)));
        return { x: ax + abx * t, y: ay + aby * t };
    }
    const flipTip = (f) => ({ x: f.pivot.x + Math.cos(f.angle) * FL, y: f.pivot.y + Math.sin(f.angle) * FL });
    function rrPath(c, x, y, w, h, r) {
        const rr = Math.max(0, Math.min(r, w / 2, h / 2));
        c.beginPath();
        c.moveTo(x + rr, y);
        c.lineTo(x + w - rr, y);
        c.arcTo(x + w, y, x + w, y + rr, rr);
        c.lineTo(x + w, y + h - rr);
        c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        c.lineTo(x + rr, y + h);
        c.arcTo(x, y + h, x, y + h - rr, rr);
        c.lineTo(x, y + rr);
        c.arcTo(x, y, x + rr, y, rr);
        c.closePath();
    }

    // ============================================================
    //  Audio (procedural)
    // ============================================================
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function resumeAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }
    function blip(freq, type, dur, vol = 0.06, sweepTo = null, delay = 0) {
        resumeAudio();
        if (audioCtx.state !== 'running') return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        const t0 = audioCtx.currentTime + delay;
        osc.frequency.setValueAtTime(freq, t0);
        if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    const noiseBuf = (() => {
        const len = Math.floor(audioCtx.sampleRate * 0.25);
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    })();
    function thock(freq, dur, vol = 0.05, q = 1.2) {
        resumeAudio();
        if (audioCtx.state !== 'running') return;
        const src = audioCtx.createBufferSource();
        src.buffer = noiseBuf;
        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
        const gain = audioCtx.createGain();
        const t0 = audioCtx.currentTime;
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
        src.connect(bp); bp.connect(gain); gain.connect(audioCtx.destination);
        src.start(t0); src.stop(t0 + dur + 0.02);
    }
    const SFX = {
        wall: () => thock(230, 0.07, 0.045),
        bumper: (hot = false) => { blip(hot ? 270 : 200, 'square', 0.09, hot ? 0.06 : 0.05, hot ? 165 : 95); thock(520, 0.06, 0.045); },
        sling: () => { blip(260, 'square', 0.08, 0.045, 130); },
        flip: () => thock(950, 0.045, 0.05, 1.6),
        rollover: () => blip(880, 'sine', 0.11, 0.045, 1320),
        lanesDone: () => { blip(660, 'sine', 0.14, 0.05, 990); blip(990, 'sine', 0.18, 0.045, 1480, 0.08); },
        jackpot: () => {
            [660, 880, 1100, 1320].forEach((f, i) => blip(f, 'square', 0.16, 0.045, f * 1.5, i * 0.07));
            thock(700, 0.2, 0.04);
        },
        target: () => { thock(900, 0.05, 0.055, 2); blip(180, 'square', 0.05, 0.04, 90); },
        ratchet: (i) => blip(420 + i * 130, 'square', 0.045, 0.04, 300 + i * 130),
        spinnerTick: () => blip(1200 + Math.random() * 250, 'square', 0.03, 0.022),
        saucer: () => { blip(620, 'sine', 0.32, 0.05, 130); thock(1500, 0.3, 0.028, 0.7); },
        saucerOut: () => { blip(160, 'sine', 0.24, 0.06, 620); thock(420, 0.1, 0.04); },
        kicker: () => { thock(180, 0.09, 0.05); blip(240, 'square', 0.06, 0.04, 120); },
        kickback: () => { blip(90, 'square', 0.2, 0.07, 40); thock(240, 0.12, 0.05); },
        kbMiss: () => { blip(150, 'square', 0.16, 0.05, 75); },
        rampRoll: () => { blip(300, 'sawtooth', 0.5, 0.035, 900); },
        ballSave: () => { blip(700, 'sine', 0.16, 0.05, 1150); blip(700, 'sine', 0.16, 0.05, 1150, 0.18); },
        saveTick: () => blip(1500, 'square', 0.04, 0.03),
        extraBall: () => [523, 659, 784, 1047, 1319].forEach((f, i) => blip(f, 'square', 0.14, 0.05, null, i * 0.09)),
        launch: () => { blip(130, 'square', 0.12, 0.07, 60); thock(320, 0.08, 0.05); },
        charge: () => blip(420, 'square', 0.03, 0.02),
        skill: () => { blip(880, 'square', 0.1, 0.05, 1320); blip(1320, 'square', 0.14, 0.05, 1760, 0.1); },
        drain: () => blip(220, 'sawtooth', 0.5, 0.08, 55),
        serve: () => blip(523, 'sine', 0.1, 0.045, 784)
    };
    const gestureResume = () => resumeAudio();
    window.addEventListener('keydown', gestureResume, { once: true });
    window.addEventListener('pointerdown', gestureResume, { once: true });

    // ============================================================
    //  Pre-rendered backdrop: space + cabinet edges
    // ============================================================
    const deskCanvas = document.createElement('canvas');
    deskCanvas.width = W; deskCanvas.height = H;
    (function buildBackdrop() {
        const g = deskCanvas.getContext('2d');
        const rnd = mulberry32(91);
        const base = g.createLinearGradient(0, 0, 0, H);
        base.addColorStop(0, '#04050e');
        base.addColorStop(0.45, '#0a1030');
        base.addColorStop(1, '#04050e');
        g.fillStyle = base;
        g.fillRect(0, 0, W, H);
        // nebula glows
        for (const [nx, ny, nr, col] of [[0.2, 0.22, 170, 'rgba(99,64,190,0.16)'], [0.82, 0.7, 200, 'rgba(30,90,190,0.13)']]) {
            const neb = g.createRadialGradient(W * nx, H * ny, 10, W * nx, H * ny, nr);
            neb.addColorStop(0, col); neb.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = neb; g.fillRect(0, 0, W, H);
        }
        // starfield
        for (let i = 0; i < 170; i++) {
            const x = rnd() * W, y = rnd() * H;
            // thin out stars on the table itself (the playfield art covers them)
            const a = (0.15 + rnd() * 0.7) * (x > TABLE_LEFT - 4 && x < TABLE_LEFT + 16 * SCALE + 4 && y > TABLE_TOP - 4 ? 0.12 : 1);
            const r = rnd() * 1.2 + 0.3;
            g.fillStyle = `rgba(210,225,255,${a})`;
            g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
        // side cabinet art bands
        for (const side of [0, 1]) {
            const x0 = side === 0 ? 8 : W - 40;
            const band = g.createLinearGradient(x0, 0, x0 + 32, 0);
            band.addColorStop(0, 'rgba(60,80,160,0.10)');
            band.addColorStop(1, 'rgba(20,30,80,0.03)');
            g.fillStyle = band;
            g.fillRect(x0, TABLE_TOP - 10, 32, L * SCALE + 20);
            g.strokeStyle = 'rgba(120,150,255,0.12)';
            g.lineWidth = 1;
            for (let i = 0; i < 9; i++) {
                const yy = TABLE_TOP + 30 + i * ((L * SCALE - 60) / 8);
                g.beginPath(); g.moveTo(x0 + 5, yy); g.lineTo(x0 + 27, yy - 14); g.stroke();
            }
        }
        // vignette
        const v = g.createRadialGradient(W / 2, H * 0.52, H * 0.3, W / 2, H * 0.52, H * 0.72);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = v;
        g.fillRect(0, 0, W, H);
    })();

    // ============================================================
    //  Pre-rendered table (playfield art + chrome walls + sockets)
    // ============================================================
    const tableCanvas = document.createElement('canvas');
    tableCanvas.width = W; tableCanvas.height = H;
    // The table silhouette: dome top, straight sides (the shooter lane lives
    // inside the cabinet on the right), left cheek tapering to the outlane
    // wall, flat bottom. `ins` insets in table units.
    function tablePath(c, ins) {
        const cxS = sxOf(0), cyD = syOf(DOME_CY), rD = (HW - ins) * SCALE;
        const xL = sxOf(-(HW - ins)), xR = sxOf(HW - ins);
        const yC = syOf(CHEEK_TOP);
        const oL = sxOf(-(OUT_HW - ins * 0.6));
        const yF = syOf(CHEEK_BOT);
        const yB = syOf(L - ins * 0.6);
        c.beginPath();
        c.moveTo(oL, yB);
        c.lineTo(oL, yF);
        c.lineTo(xL, yC);
        c.lineTo(xL, cyD);
        c.arc(cxS, cyD, rD, Math.PI, Math.PI * 2);
        c.lineTo(xR, yB);
        c.closePath();
    }
    (function buildTable() {
        const g = tableCanvas.getContext('2d');
        const rnd = mulberry32(5);
        const cxS = sxOf(0);
        // Outer glow + drop shadow
        g.save();
        tablePath(g, 0);
        g.shadowColor = 'rgba(80,120,255,0.4)';
        g.shadowBlur = 22;
        g.fillStyle = 'rgba(10,16,40,1)'; g.fill();
        g.restore();
        g.save();
        g.translate(4, 6);
        tablePath(g, 0);
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill();
        g.restore();
        // Cabinet body
        const bw = g.createLinearGradient(sxOf(-HW), 0, sxOf(HW), 0);
        bw.addColorStop(0, '#141b38'); bw.addColorStop(0.5, '#1d2750'); bw.addColorStop(1, '#141b38');
        tablePath(g, 0);
        g.fillStyle = bw; g.fill();
        g.lineWidth = 2; g.strokeStyle = '#05070f'; g.stroke();
        // Chrome cabinet rim
        tablePath(g, 0.12);
        g.lineWidth = 3.5; g.strokeStyle = 'rgba(200,212,232,0.55)'; g.stroke();
        // Playfield inlay (deep indigo)
        tablePath(g, 0.45);
        const inlay = g.createRadialGradient(cxS, syOf(10), 10, cxS, syOf(16), L * SCALE * 0.62);
        inlay.addColorStop(0, '#1b2a5e'); inlay.addColorStop(0.6, '#131e48'); inlay.addColorStop(1, '#0c1433');
        g.fillStyle = inlay; g.fill();
        // clipped playfield art
        g.save();
        tablePath(g, 0.45); g.clip();
        // faint starfield texture on the field
        for (let i = 0; i < 130; i++) {
            const x = -7.5 + rnd() * 15, y = rnd() * L;
            g.fillStyle = `rgba(190,210,255,${0.05 + rnd() * 0.22})`;
            g.beginPath(); g.arc(sxOf(x), syOf(y), rnd() * 1.1 + 0.3, 0, Math.PI * 2); g.fill();
        }
        // ringed planet art in the dome
        const pcx = sxOf(0), pcy = syOf(3.0), pr = 2.15 * SCALE;
        const planet = g.createRadialGradient(pcx - pr * 0.3, pcy - pr * 0.35, pr * 0.15, pcx, pcy, pr);
        planet.addColorStop(0, '#3d6fd6'); planet.addColorStop(0.7, '#1c3d8f'); planet.addColorStop(1, '#101f4e');
        g.globalAlpha = 0.75;
        g.fillStyle = planet;
        g.beginPath(); g.arc(pcx, pcy, pr, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 0.5;
        g.strokeStyle = '#8fb4ff'; g.lineWidth = 3;
        g.beginPath(); g.ellipse(pcx, pcy + pr * 0.15, pr * 1.45, pr * 0.38, -0.22, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 0.28; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(pcx, pcy + pr * 0.15, pr * 1.62, pr * 0.44, -0.22, 0, Math.PI * 2); g.stroke();
        // latitude bands
        g.globalAlpha = 0.2; g.strokeStyle = '#cfe0ff'; g.lineWidth = 2;
        for (const off of [-0.4, 0.05, 0.5]) {
            g.beginPath();
            g.ellipse(pcx, pcy + pr * off, pr * Math.sqrt(Math.max(0.05, 1 - off * off)), pr * 0.16, 0, 0, Math.PI * 2);
            g.stroke();
        }
        g.globalAlpha = 1;
        // second small planet right side, behind the ramp
        const p2x = sxOf(6.3), p2y = syOf(21.6), p2r = 1.1 * SCALE;
        const pl2 = g.createRadialGradient(p2x - p2r * 0.3, p2y - p2r * 0.3, p2r * 0.2, p2x, p2y, p2r);
        pl2.addColorStop(0, '#b46adf'); pl2.addColorStop(1, '#3a1e63');
        g.globalAlpha = 0.5;
        g.fillStyle = pl2;
        g.beginPath(); g.arc(p2x, p2y, p2r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        // subtle concentric deco arcs around the dome
        g.globalAlpha = 0.12; g.strokeStyle = '#9db8ff'; g.lineWidth = 1.5;
        for (const rr of [5.6, 6.6]) {
            g.beginPath(); g.arc(cxS, syOf(DOME_CY), rr * SCALE, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
        }
        g.globalAlpha = 1;
        // shooter-lane corridor tint
        g.globalAlpha = 0.35;
        const laneT = g.createLinearGradient(sxOf(LANE_X), 0, sxOf(HW), 0);
        laneT.addColorStop(0, 'rgba(10,14,34,0.9)'); laneT.addColorStop(1, 'rgba(24,32,70,0.9)');
        g.fillStyle = laneT;
        g.fillRect(sxOf(LANE_X), syOf(GATE_Y), (HW - LANE_X) * SCALE, (L - GATE_Y) * SCALE);
        g.globalAlpha = 1;
        // ---- right ramp art band (dark form with neon rails) ----
        function strokeRamp(width, style) {
            g.strokeStyle = style; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
            g.beginPath();
            g.moveTo(sxOf(rampPts[0][0]), syOf(rampPts[0][1]));
            for (let i = 1; i < rampPts.length; i++) g.lineTo(sxOf(rampPts[i][0]), syOf(rampPts[i][1]));
            g.stroke();
        }
        strokeRamp(1.02 * SCALE, '#0a0f26');
        strokeRamp(0.92 * SCALE, '#182456');
        strokeRamp(1.06 * SCALE, 'rgba(140,170,255,0.28)');
        g.lineWidth = 2.2; g.strokeStyle = 'rgba(34,211,238,0.75)';
        g.beginPath();
        g.moveTo(sxOf(rampPts[0][0]), syOf(rampPts[0][1]));
        for (let i = 1; i < rampPts.length; i++) g.lineTo(sxOf(rampPts[i][0]), syOf(rampPts[i][1]));
        g.stroke();
        // ramp entry chevrons
        g.strokeStyle = 'rgba(255,227,154,0.5)'; g.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const p = ramp.at(0.25 + i * 0.55);
            const m = Math.hypot(p.tx, p.ty) || 1;
            const px = sxOf(p.x), py = syOf(p.y);
            const tx = p.tx / m, ty = p.ty / m;
            g.beginPath();
            g.moveTo(px - ty * 4 - tx * 4, py + tx * 4 - ty * 4);
            g.lineTo(px, py);
            g.lineTo(px + ty * 4 - tx * 4, py - tx * 4 - ty * 4);
            g.stroke();
        }
        // ---- chrome walls ----
        for (const w of walls) {
            const lw = Math.max(3, w.r * 2 * SCALE);
            g.strokeStyle = '#7e8aa2';
            g.lineCap = 'round'; g.lineWidth = lw;
            g.beginPath(); g.moveTo(sxOf(w.ax), syOf(w.ay)); g.lineTo(sxOf(w.bx), syOf(w.by)); g.stroke();
            g.strokeStyle = 'rgba(228,236,250,0.85)';
            g.lineWidth = Math.max(1, lw * 0.4);
            g.beginPath(); g.moveTo(sxOf(w.ax), syOf(w.ay)); g.lineTo(sxOf(w.bx), syOf(w.by)); g.stroke();
        }
        for (const c of wallCaps) {
            g.fillStyle = '#9aa7bd';
            g.beginPath(); g.arc(sxOf(c.x), syOf(c.y), Math.max(2.5, c.r * SCALE), 0, Math.PI * 2); g.fill();
            g.fillStyle = 'rgba(255,255,255,0.5)';
            g.beginPath(); g.arc(sxOf(c.x) - 1, syOf(c.y) - 1, Math.max(1, c.r * SCALE * 0.35), 0, Math.PI * 2); g.fill();
        }
        // one-way gate at the lane mouth (gold wire + up-chevron)
        g.strokeStyle = '#e0b45c'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(sxOf(LANE_X + 0.05), syOf(GATE_Y)); g.lineTo(sxOf(HW - 0.05), syOf(GATE_Y)); g.stroke();
        g.strokeStyle = 'rgba(255,227,154,0.65)'; g.lineWidth = 2;
        for (const gx of [6.95, 7.45]) {
            g.beginPath();
            g.moveTo(sxOf(gx) - 4, syOf(GATE_Y) + 6); g.lineTo(sxOf(gx), syOf(GATE_Y) + 1); g.lineTo(sxOf(gx) + 4, syOf(GATE_Y) + 6);
            g.stroke();
        }
        // launch direction chevrons in the lane
        g.strokeStyle = 'rgba(255,227,154,0.35)'; g.lineWidth = 2.5;
        for (const yy of [13, 17, 21, 25]) {
            const cx2 = sxOf(LANE_CX), cy2 = syOf(yy);
            g.beginPath();
            g.moveTo(cx2 - 5, cy2 + 5); g.lineTo(cx2, cy2); g.lineTo(cx2 + 5, cy2 + 5);
            g.stroke();
        }
        // ---- apron plate + drain slots ----
        g.fillStyle = '#0a0e1e';
        g.fillRect(sxOf(-OUT_HW), syOf(31.5), OUT_HW * 2 * SCALE, (L - 31.5) * SCALE);
        g.fillStyle = 'rgba(12,16,36,0.95)';
        rrPath(g, sxOf(-OUT_HW), syOf(31.5), OUT_HW * 2 * SCALE, (L - 31.5) * SCALE, 3); g.fill();
        // center + outlane drain voids
        g.fillStyle = 'rgba(2,3,8,1)';
        rrPath(g, sxOf(-1.15), syOf(31.45), 2.3 * SCALE, (L - 31.4) * SCALE + 3, 3); g.fill();
        for (const s of [-1, 1]) {
            rrPath(g, sxOf(s === -1 ? -5.45 : 3.1), syOf(31.45), 2.35 * SCALE, (L - 31.4) * SCALE + 3, 3); g.fill();
        }
        // kicker light streaks up the inlanes
        for (const s of [-1, 1]) {
            const kx = sxOf(3.85 * s), ky0 = syOf(25.4), ky1 = syOf(23.2);
            const kg = g.createLinearGradient(0, ky0, 0, ky1);
            kg.addColorStop(0, 'rgba(126,224,161,0.35)'); kg.addColorStop(1, 'rgba(126,224,161,0)');
            g.strokeStyle = kg; g.lineWidth = 5; g.lineCap = 'round';
            g.beginPath(); g.moveTo(kx, ky0); g.lineTo(kx + s * -0.6 * SCALE, ky1); g.stroke();
        }
        // ---- inserts / sockets + labels ----
        function socket(x, y, r, label, labelAbove) {
            g.save();
            g.globalAlpha = 0.3; g.fillStyle = '#02040c';
            g.beginPath(); g.ellipse(sxOf(x) + 2, syOf(y) + 2, (r + 0.15) * SCALE, (r + 0.12) * SCALE, 0, 0, Math.PI * 2); g.fill();
            g.globalAlpha = 0.55; g.strokeStyle = '#26345f'; g.lineWidth = 1.5;
            g.beginPath(); g.ellipse(sxOf(x), syOf(y), (r + 0.14) * SCALE, (r + 0.11) * SCALE, 0, 0, Math.PI * 2); g.stroke();
            g.globalAlpha = 1;
            if (label) {
                g.fillStyle = 'rgba(160,190,255,0.4)';
                g.font = '600 8px system-ui, sans-serif';
                g.textAlign = 'center';
                if (labelAbove) { g.textBaseline = 'bottom'; g.fillText(label, sxOf(x), syOf(y) - (r + 0.2) * SCALE - 2); }
                else { g.textBaseline = 'top'; g.fillText(label, sxOf(x), syOf(y) + (r + 0.18) * SCALE + 3); }
            }
            g.restore();
        }
        for (const ln of lanes) socket(ln.x, 3.4, 0.44, 'LANE', true);
        socket(saucer.x, saucer.y, 0.86, 'BLACK HOLE', true);
        socket(bumpers[0].x, bumpers[0].y, bumpers[0].r);
        socket(bumpers[1].x, bumpers[1].y, bumpers[1].r);
        socket(bumpers[2].x, bumpers[2].y, bumpers[2].r);
        socket(bumpers[3].x, bumpers[3].y, bumpers[3].r, 'JET');
        socket(kickers[0].x, kickers[0].y, 0.36, 'BALL SAVE');
        socket(kickers[1].x, kickers[1].y, 0.36, 'RAMP');
        socket(sensors[0].x, sensors[0].y, 0.4, 'K.B.');
        socket(sensors[1].x, sensors[1].y, 0.4, 'K.B.');
        socket(SPINNER_POS.x, SPINNER_POS.y, 0.5, 'SPINNER');
        // faint title watermark centre-field
        g.globalAlpha = 0.16; g.fillStyle = '#cfe0ff';
        g.font = '800 15px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('★ STAR CADET ★', cxS, syOf(27.9));
        g.restore();
        // apron logo below the table (outside the playfield)
        g.fillStyle = 'rgba(160,190,255,0.5)';
        g.font = '700 11px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('S T A R   C A D E T   P I N B A L L', 185, H - 14);
        // bottom drain void shadow
        const fg = g.createLinearGradient(0, syOf(L), 0, syOf(L) + 14);
        fg.addColorStop(0, 'rgba(0,0,0,0.5)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fg;
        g.fillRect(sxOf(-1.15), syOf(L), 2.3 * SCALE, 14);
    })();

    // ============================================================
    //  State
    // ============================================================
    const ball = { x: LANE_CX, y: PLUNGER_Y, vx: 0, vy: 0, rail: null, railU: 0, holdT: 0 };
    let state = 'launch';            // launch | play | over
    let score = 0;
    let bestScore = 0;
    let ballsLeft = 3;
    let ballNo = 1;
    let mult = 1;
    let charge = 0;
    let wasHolding = false;
    let chargeTick = 0;
    let banner = '', bannerT = 0, bannerColor = '#ffe39a';
    let stuckTimer = 0;
    let lastPokeX = 0, lastPokeY = 0, pokeRepeat = 0;   // escalating anti-stuck
    let drained = false;
    let overlayOpen = false;
    let destroyed = false;
    let rafId = null;
    let lastNow = 0;
    let lastScoreShown = -1;
    let shakeMag = 0, shakeDur = 0.2, shakeT = 1;
    // systems
    let saveT = 0;               // ball-save seconds left
    let saveTick = 0;
    let rampLit = false;         // right inlane lit the ramp
    let extraBallLit = false;    // drop bank lit "EXTRA BALL" once
    let extraBallGiven = false;
    let railCooldown = 0;
    let blackoutT = 0;           // LED blackout flash on big awards
    let firstServe = true;
    let inlSaveUsed = false;     // left-inlane ball save: once per ball

    const input = { left: false, right: false, holdingPlunger: false };
    const trail = [];
    const sparks = [];
    const floaters = [];

    // ============================================================
    //  Effects
    // ============================================================
    function startShake(mag, dur) { if (reduced()) return; shakeMag = mag; shakeDur = dur; shakeT = 0; }
    function spawnSparks(tx, ty, color, n, up = 0) {
        if (reduced()) return;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 40 + Math.random() * 220;
            sparks.push({
                x: sxOf(tx), y: syOf(ty),
                vx: Math.cos(a) * v, vy: Math.sin(a) * v - (60 + up),
                g: 620, life: 1, decay: 1 / (0.35 + Math.random() * 0.4),
                size: 1.5 + Math.random() * 2.5, c: color
            });
        }
        if (sparks.length > 170) sparks.splice(0, sparks.length - 170);
    }
    function addFloater(x, y, text, color) {
        floaters.push({ x: sxOf(x), y: syOf(y) - 10, text, t: 0, c: color || '#ffe39a' });
    }
    function showBanner(text, color = '#ffe39a', dur = 1.4) {
        banner = text; bannerT = dur; bannerColor = color;
    }
    function updateFx(dt) {
        shakeT += dt;
        for (let i = sparks.length - 1; i >= 0; i--) {
            const p = sparks[i];
            p.life -= p.decay * dt;
            if (p.life <= 0) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
        }
        for (let i = floaters.length - 1; i >= 0; i--) {
            floaters[i].t += dt;
            if (floaters[i].t >= 0.7) floaters.splice(i, 1);
        }
        if (blackoutT > 0) blackoutT = Math.max(0, blackoutT - dt);
    }

    // ============================================================
    //  High scores + game-over modal (shared pattern)
    // ============================================================
    function getScores() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    function saveHighScore(initials, runScore) {
        const scores = getScores();
        scores.push({ initials, score: runScore, date: new Date().toLocaleDateString() });
        scores.sort((a, b) => b.score - a.score);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, 5)));
        bestScore = scores[0].score;
    }
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }
    function renderLeaderboard() {
        const scores = getScores();
        if (scores.length === 0) return '<li class="empty">No scores yet — be the first!</li>';
        return scores.map((s, i) =>
            `<li><span><span class="rank">${i + 1}.</span><span class="initials">${escapeHtml(s.initials)}</span></span><span class="entry-score">${s.score}</span></li>`
        ).join('');
    }
    function showGameOverModal(headline) {
        overlayOpen = true;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const finalScore = Math.floor(score);
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pb-modal-title">
                <h2 id="pb-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${finalScore}</strong></p>
                <ol class="leaderboard" id="pb-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="pb-initials-form" class="initials-form" autocomplete="off">
                    <label for="pb-initials">Your Initials</label>
                    <input id="pb-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off" autocapitalize="characters">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="pb-initials-form" id="pb-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="pb-again" class="btn btn-ghost">Play Again</button>
                    <button type="button" id="pb-home" class="btn btn-ghost">Home</button>
                </div>
            </div>`;
        container.appendChild(overlay);
        const form = overlay.querySelector('#pb-initials-form');
        const inp = overlay.querySelector('#pb-initials');
        const saveBtn = overlay.querySelector('#pb-save');
        const againBtn = overlay.querySelector('#pb-again');
        let saved = false;
        inp.addEventListener('input', () => {
            const cleaned = inp.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
            if (cleaned !== inp.value) inp.value = cleaned;
        });
        if (finalScore > 0) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (saved) return;
                saved = true;
                const initials = (inp.value.trim().toUpperCase() || '???').slice(0, 3);
                saveHighScore(initials, finalScore);
                overlay.querySelector('#pb-leaderboard').innerHTML = renderLeaderboard();
                saveBtn.textContent = 'Saved ✓';
                saveBtn.disabled = true;
                inp.disabled = true;
            });
            inp.focus();
        } else {
            form.remove();
            saveBtn.remove();
            againBtn.focus();
        }
        againBtn.addEventListener('click', () => {
            overlay.remove();
            overlayOpen = false;
            resetRun();
        });
        overlay.querySelector('#pb-home').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('hub:home'));
        });
    }

    // ============================================================
    //  Game flow
    // ============================================================
    function addScore(base, x, y, quiet) {
        const v = base * mult;
        score += v;
        if (!quiet && v > 10) addFloater(x, y, `+${v}`, mult > 1 ? '#a5f3fc' : undefined);
        return v;
    }
    function armSave(sec, why) {
        if (saveT >= sec) return;
        saveT = sec;
        saveTick = 0;
        if (why) showBanner(why, '#7ee0a1', 1.1);
        SFX.ballSave();
    }
    function serveBall() {
        ball.x = LANE_CX; ball.y = PLUNGER_Y; ball.vx = 0; ball.vy = 0;
        ball.rail = null; ball.holdT = 0;
        state = 'launch';
        charge = 0; wasHolding = false;
        input.left = input.right = false; input.holdingPlunger = false;
        trail.length = 0;
        drained = false;
        railCooldown = 0;
        ballNo = 4 - ballsLeft > 0 ? 4 - ballsLeft : 1;
        inlSaveUsed = false;
        // Ball 1 gets a longer grace save; every ball starts with ball save.
        armSave(firstServe ? 22 : 16, 'BALL SAVE');
        firstServe = false;
        showBanner('BALL ' + ballNo, '#ffe39a', 1.4);
        SFX.serve();
    }
    function doLaunch() {
        const power = 12 + charge * 30;
        // Skill shot window on the charge meter
        if (charge >= 0.82 && charge <= 0.95) {
            addScore(1500, LANE_CX, PLUNGER_Y - 2);
            armSave(8, 'SKILL SHOT!');
            SFX.skill();
            blackoutT = 0.5;
        }
        ball.x = LANE_CX; ball.y = PLUNGER_Y;
        ball.vx = 0; ball.vy = -power;
        state = 'play';
        charge = 0;
        SFX.launch();
        spawnSparks(LANE_CX, PLUNGER_Y, '#ffd27f', 8);
    }
    function saveRescue() {
        // Return the ball via the left inlane (kicker feeds it back to the flipper)
        drained = false;
        saveT = 0;
        ball.x = SAUCER_EJECT.x; ball.y = SAUCER_EJECT.y; ball.vx = 0; ball.vy = 2;
        ball.rail = null;
        showBanner('BALL SAVED!', '#7ee0a1', 1.2);
        addFloater(SAUCER_EJECT.x, SAUCER_EJECT.y - 1, 'SAVED', '#7ee0a1');
        SFX.kicker();
        startShake(3, 0.2);
    }
    function handleDrain() {
        drained = false;
        SFX.drain();
        startShake(6, 0.3);
        ballsLeft--;
        if (ballsLeft > 0) serveBall();
        else { state = 'over'; gameOver(); }
    }
    function ejectSaucer() {
        ball.holdT = 0;
        ball.x = SAUCER_EJECT.x; ball.y = SAUCER_EJECT.y; ball.vx = 0.6; ball.vy = 2;
        ball.rail = null;
        saucer.flash = 1;
        SFX.saucerOut();
        spawnSparks(SAUCER_EJECT.x, SAUCER_EJECT.y, '#c4b5fd', 10);
    }
    function gameOver() {
        canvas.style.transition = 'filter 0.3s ease';
        canvas.style.filter = 'blur(3px)';
        showGameOverModal('Game Over');
    }

    // ============================================================
    //  Bank / targets helpers
    // ============================================================
    function knockTarget(t) {
        t.down = true; t.flash = 1;
        SFX.target();
        spawnSparks(t.cx, t.cy, '#a5b4fc', 6);
        addScore(250, t.cx, t.cy - 0.5);
        if (dropBank.every((d) => d.down) && !bankDone) {
            bankDone = true;
            bankResetT = 1.2;
            addScore(2500, -5.3, 11.5);
            blackoutT = 0.6;
            SFX.jackpot();
            startShake(4, 0.25);
            armSave(10, 'BANK! BALL SAVE');
            if (extraBallLit && !extraBallGiven) {
                extraBallGiven = true;
                ballsLeft++;
                showBanner('EXTRA BALL!', '#f472b6', 1.8);
                SFX.extraBall();
                blackoutT = 1.0;
            } else if (!extraBallLit && !extraBallGiven) {
                extraBallLit = true;
                showBanner('EXTRA BALL LIT', '#f472b6', 1.4);
            }
        }
    }
    function resetBank() {
        dropBank.forEach((t, i) => {
            // ratchet the targets back up, one by one (audio scheduled ahead)
            setTimeout(() => {
                if (destroyed) return;
                t.down = false; t.pop = 1;
                SFX.ratchet(i);
            }, i * 110);
        });
        bankDone = false;
    }

    // ============================================================
    //  Collisions
    // ============================================================
    function collideDome() {
        const b = ball;
        if (b.y < DOME_CY) {
            const dx = b.x, dy = b.y - DOME_CY;
            const d = Math.hypot(dx, dy);
            const maxD = HW - BALL_R;
            if (d > maxD) {
                const nx = dx / d, ny = dy / d;
                b.x = nx * maxD; b.y = DOME_CY + ny * maxD;
                const vn = b.vx * nx + b.vy * ny;
                if (vn > 0) { b.vx -= (1 + WALL_REST) * vn * nx; b.vy -= (1 + WALL_REST) * vn * ny; SFX.wall(); }
            }
        }
    }
    function resolveWallSeg(s) {
        const b = ball;
        const c = closestPointOnSeg(b.x, b.y, s.ax, s.ay, s.bx, s.by);
        let dx = b.x - c.x, dy = b.y - c.y;
        let dist = Math.hypot(dx, dy);
        const minD = BALL_R + s.r;
        if (dist >= minD) return false;
        if (dist < 1e-6) { dx = 0; dy = -1; dist = 1; }
        const nx = dx / dist, ny = dy / dist;
        b.x = c.x + nx * minD; b.y = c.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
            b.vx -= (1 + WALL_REST) * vn * nx; b.vy -= (1 + WALL_REST) * vn * ny;
            SFX.wall();
        }
        return true;
    }
    function resolveOneWaySeg(s) {
        // Solid only from the side its normal (nx,ny) points toward.
        const b = ball;
        const c = closestPointOnSeg(b.x, b.y, s.ax, s.ay, s.bx, s.by);
        const dx = b.x - c.x, dy = b.y - c.y;
        if (dx * s.nx + dy * s.ny <= 0) return;   // ball on the pass-through side
        const dist = Math.hypot(dx, dy);
        const minD = BALL_R + s.r;
        if (dist >= minD) return;
        const nx = dx / (dist || 1), ny = dy / (dist || 1);
        b.x = c.x + nx * minD; b.y = c.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
            b.vx -= (1 + WALL_REST) * vn * nx; b.vy -= (1 + WALL_REST) * vn * ny;
            SFX.wall();
        }
    }
    function resolveCircle(o, rest, kick, silent) {
        const b = ball;
        let dx = b.x - o.x, dy = b.y - o.y;
        let dist = Math.hypot(dx, dy);
        const minD = BALL_R + o.r;
        if (dist >= minD) return false;
        if (dist < 1e-6) { dx = 0; dy = 1; dist = 1; }
        const nx = dx / dist, ny = dy / dist;
        b.x = o.x + nx * minD; b.y = o.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; }
        if (kick) { b.vx += nx * kick; b.vy += ny * kick; }
        if (!silent && vn < 0) SFX.wall();
        return true;
    }
    function resolveSling(s) {
        const b = ball;
        const c = closestPointOnSeg(b.x, b.y, s.ax, s.ay, s.bx, s.by);
        let dx = b.x - c.x, dy = b.y - c.y;
        let dist = Math.hypot(dx, dy);
        const minD = BALL_R + s.r;
        if (dist >= minD) return false;
        if (dist < 1e-6) { dx = 0; dy = -1; dist = 1; }
        const nx = dx / dist, ny = dy / dist;
        b.x = c.x + nx * minD; b.y = c.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.3 * vn * nx; b.vy -= 1.3 * vn * ny; }
        b.vx += s.kx * s.kick; b.vy += s.ky * s.kick;
        return true;
    }
    function resolveFlipper(f) {
        const b = ball;
        const tip = flipTip(f);
        const c = closestPointOnSeg(b.x, b.y, f.pivot.x, f.pivot.y, tip.x, tip.y);
        let dx = b.x - c.x, dy = b.y - c.y;
        let dist = Math.hypot(dx, dy);
        const minD = BALL_R + FLIP_R;
        if (dist >= minD) return false;
        if (dist < 1e-6) { dx = 0; dy = 1; dist = 1; }
        const nx = dx / dist, ny = dy / dist;
        b.x = c.x + nx * minD; b.y = c.y + ny * minD;
        const rx = c.x - f.pivot.x, ry = c.y - f.pivot.y;
        let svx = -f.omega * ry, svy = f.omega * rx;
        const svm = Math.hypot(svx, svy);
        if (svm > FLIP_MAX_V) { svx *= FLIP_MAX_V / svm; svy *= FLIP_MAX_V / svm; }
        let rvx = b.vx - svx, rvy = b.vy - svy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
            rvx -= 1.35 * vn * nx; rvy -= 1.35 * vn * ny;
            b.vx = rvx + svx; b.vy = rvy + svy;
            SFX.flip();
            return true;
        }
        return false;
    }
    function checkLaneCrossing(prevY, newY) {
        const b = ball;
        for (const ln of lanes) {
            if (ln.cd > 0) continue;
            const cross = (prevY < LANE_PLANE_Y && newY >= LANE_PLANE_Y) || (prevY > LANE_PLANE_Y && newY <= LANE_PLANE_Y);
            if (!cross) continue;
            const cxNow = (b.x + prevX) / 2;
            if (cxNow < ln.band[0] || cxNow > ln.band[1]) continue;
            ln.cd = 0.35; ln.flash = 1;
            addScore(ln.value, ln.x, 4.2);
            SFX.rollover();
            // step the lane value up
            const vi = LANE_VALUES.indexOf(ln.value);
            if (vi >= 0 && vi < LANE_VALUES.length - 1) ln.value = LANE_VALUES[vi + 1];
            ln.lit = true;
            if (lanes.every((l2) => l2.lit)) {
                lanes.forEach((l2) => { l2.lit = false; l2.flash = 1; });
                if (mult < 5) {
                    mult++;
                    showBanner('MULTIPLIER ×' + mult, '#a5f3fc', 1.3);
                    SFX.lanesDone();
                    startShake(2, 0.15);
                } else {
                    addScore(2500, 0, 4.2);
                    blackoutT = 0.5;
                    SFX.jackpot();
                }
            }
        }
    }
    let prevX = 0;
    function collideWalls(prevY) {
        const b = ball;
        collideDome();
        for (const w of walls) resolveWallSeg(w);
        for (const c of wallCaps) resolveCircle(c, WALL_REST, 0, true);
        // one-way gate over the shooter lane mouth: blocks downward crossings
        if (prevY < GATE_Y && b.y >= GATE_Y && b.x > LANE_X && b.x < HW) {
            b.y = GATE_Y - 0.01; b.vy = 0;
        }
        // one-way ramp edge walls (field side only)
        for (const rw of railWalls) resolveOneWaySeg(rw);
        // kickback triggers (before the drain line)
        for (const kb of kickbacks) {
            if (!kb.lit || kb.cd > 0) continue;
            if (Math.abs(b.x - kb.x) < 0.75 && b.y > kb.y - 0.5 && b.vy > 0) {
                kb.flash = 1;
                if (Math.random() < KICKBACK_CHANCE) {
                    kb.lit = false;
                    b.vy = -23; b.vx = -kb.side * 1.4 + (Math.random() - 0.5);
                    SFX.kickback();
                    addFloater(kb.x, kb.y - 1, 'KICKBACK', '#7ee0a1');
                    spawnSparks(kb.x, kb.y, '#7ee0a1', 10, 90);
                    startShake(3, 0.18);
                } else {
                    // dud: thud — the charge stays lit for the next ball through
                    kb.cd = 1.2;
                    SFX.kbMiss();
                    addFloater(kb.x, kb.y - 1, 'MISS', '#94a3b8');
                }
            }
        }
        // shooter-lane floor: a ball sinking back down the lane settles on the
        // plunger area instead of "draining" (auto re-plunge handles it)
        if (b.x > LANE_X && b.y > 30.6) {
            b.y = 30.6;
            if (b.vy > 0) b.vy *= -0.2;
        } else if (b.y > DRAIN_Y) {
            drained = true;
        }
    }
    function collideObjects() {
        const b = ball;
        // pop bumpers
        for (const bp of bumpers) {
            if (bp.cd > 0) continue;
            if (resolveCircle(bp, 0.2, bp.jet ? 10 : 8, true)) {
                bp.cd = 0.08; bp.flash = 1;
                addScore(bp.pts, bp.x, bp.y);
                // hot bumper: sometimes kicks 10-20% harder
                const hot = Math.random() < HOT_BUMPER_CHANCE;
                if (hot) {
                    const boost = 1.1 + Math.random() * 0.1;
                    b.vx *= boost; b.vy *= boost;
                }
                spawnSparks(bp.x, bp.y, bp.light, hot ? 12 : 7);
                SFX.bumper(hot);
            }
        }
        // slings
        for (const s of slings) {
            if (s.cd > 0) continue;
            if (resolveSling(s)) {
                s.cd = 0.12; s.flash = 1;
                addScore(s.pts, (s.ax + s.bx) / 2, (s.ay + s.by) / 2);
                spawnSparks((s.ax + s.bx) / 2, (s.ay + s.by) / 2, '#fbcfe8', 6);
                SFX.sling();
            }
        }
        // stand-up targets
        for (const t of standups) {
            const c = closestPointOnSeg(b.x, b.y, t.ax, t.ay, t.bx, t.by);
            const dx = b.x - c.x, dy = b.y - c.y;
            const dist = Math.hypot(dx, dy);
            const minD = BALL_R + t.r;
            if (dist >= minD || dist < 1e-6) continue;
            const nx = dx / dist, ny = dy / dist;
            b.x = c.x + nx * minD; b.y = c.y + ny * minD;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 1.5 * vn * nx; b.vy -= 1.5 * vn * ny; }
            t.flash = 1;
            if (!t.lit) {
                t.lit = true;
                addScore(500, (t.ax + t.bx) / 2, (t.ay + t.by) / 2);
                spawnSparks(t.ax, (t.ay + t.by) / 2, '#fbbf24', 5);
                if (standups.every((s2) => s2.lit)) {
                    standups.forEach((s2) => { s2.lit = false; s2.flash = 1; });
                    kickbacks[0].lit = true; kickbacks[1].lit = true;
                    addScore(2000, 3.5, 17.8);
                    showBanner('KICKBACKS LIT', '#fbbf24', 1.2);
                    SFX.lanesDone();
                }
            }
            SFX.target();
        }
        // drop targets
        for (const t of dropBank) {
            if (t.down) continue;
            const c = closestPointOnSeg(b.x, b.y, t.ax, t.ay, t.bx, t.by);
            const dx = b.x - c.x, dy = b.y - c.y;
            const dist = Math.hypot(dx, dy);
            const minD = BALL_R + t.r;
            if (dist >= minD || dist < 1e-6) continue;
            const nx = dx / dist, ny = dy / dist;
            b.x = c.x + nx * minD; b.y = c.y + ny * minD;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 1.3 * vn * nx; b.vy -= 1.3 * vn * ny; }
            knockTarget(t);
        }
        // saucer: rubber ring (open mouth toward the field) + swallow
        {
            const d = Math.hypot(b.x - saucer.x, b.y - saucer.y);
            if (d < BH_MOUTH && Math.hypot(b.vx, b.vy) < BH_EAT_SPEED) {
                ball.holdT = SAUCER_HOLD;
                ball.vx = 0; ball.vy = 0;
                saucer.flash = 1; saucer.swirl = 0;
                addScore(4000, saucer.x, saucer.y);
                blackoutT = 0.6;
                showBanner('BLACK HOLE!', '#c4b5fd', 1.2);
                SFX.saucer();
                startShake(3, 0.22);
            }
            if (ball.holdT <= 0) {
                for (const s of saucerRim) {
                    const c = closestPointOnSeg(b.x, b.y, s.ax, s.ay, s.bx, s.by);
                    let dx = b.x - c.x, dy = b.y - c.y;
                    let dist = Math.hypot(dx, dy);
                    const minD = BALL_R + s.r;
                    if (dist >= minD) continue;
                    if (dist < 1e-6) { dx = 1; dy = 0; dist = 1; }
                    const nx = dx / dist, ny = dy / dist;
                    b.x = c.x + nx * minD; b.y = c.y + ny * minD;
                    const vn = b.vx * nx + b.vy * ny;
                    if (vn < 0) {
                        b.vx -= 1.5 * vn * nx; b.vy -= 1.5 * vn * ny;   // rubber (restitution 0.5)
                        saucer.flash = Math.max(saucer.flash, 0.6);
                        SFX.wall();
                    }
                }
            }
        }
        // inlane kickers (only when the ball is rolling down into them)
        for (const k of kickers) {
            if (k.cd > 0) continue;
            if (b.vy > 0.5 && d2(b, k) < (BALL_R + k.r) * (BALL_R + k.r)) {
                k.cd = 0.35; k.flash = 1;
                b.vx = k.kx * k.power; b.vy = k.ky * k.power;
                SFX.kicker();
                spawnSparks(k.x, k.y, '#7ee0a1', 6, 60);
            }
        }
        // inlane / outlane rollovers
        for (const s of sensors) {
            if (s.cd > 0) continue;
            if (d2(b, s) < (s.r + BALL_R * 0.4) * (s.r + BALL_R * 0.4)) {
                s.cd = 0.9; s.flash = 1;
                if (s.kind === 'outL' && !kickbacks[0].lit) {
                    kickbacks[0].lit = true; addScore(500, s.x, s.y);
                    showBanner('KICKBACK LIT', '#7ee0a1', 1);
                } else if (s.kind === 'outR' && !kickbacks[1].lit) {
                    kickbacks[1].lit = true; addScore(500, s.x, s.y);
                    showBanner('KICKBACK LIT', '#7ee0a1', 1);
                } else if (s.kind === 'inL') {
                    addScore(500, s.x, s.y);
                    if (!inlSaveUsed) {
                        inlSaveUsed = true;
                        armSave(6);
                    }
                    SFX.saveTick();
                } else if (s.kind === 'inR') {
                    addScore(500, s.x, s.y);
                    if (!rampLit) {
                        rampLit = true;
                        showBanner('RAMP LIT', '#22d3ee', 1);
                    }
                } else {
                    SFX.rollover();
                }
            }
        }
        // flippers
        resolveFlipper(leftFlipper);
        resolveFlipper(rightFlipper);
    }
    function d2(a, o) {
        const dx = a.x - o.x, dy = a.y - o.y;
        return dx * dx + dy * dy;
    }

    // ============================================================
    //  Ramp rail ride
    // ============================================================
    function tryRailAttach() {
        if (railCooldown > 0 || ball.rail !== null) return;
        const b = ball;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp < 14) return;
        const d = Math.hypot(b.x - rampPts[0][0], b.y - rampPts[0][1]);
        if (d > 0.95) return;
        const p = ramp.at(0);
        const m = Math.hypot(p.tx, p.ty) || 1;
        const tnx = p.tx / m, tny = p.ty / m;
        const vd = b.vx * tnx + b.vy * tny;
        if (vd < 0.8 * sp) return;
        ball.rail = 0; ball.railU = vd;
        spinner.spinsThisRide = 0; spinner.acc = 0;
        trail.length = 0;
        SFX.rampRoll();
    }
    function railStep(h) {
        const b = ball;
        let s = b.rail, u = b.railU;
        const p = ramp.at(s);
        const m = Math.hypot(p.tx, p.ty) || 1;
        const tny = p.ty / m;
        // slope gravity: climbing (ty<0) decelerates, rolling back accelerates
        u += RAMP_G * tny * h;
        s += u * h;
        // spinner
        spinner.v = Math.abs(u) * 2.4;
        spinner.acc += (Math.abs(u) * h) / (2 * Math.PI * 0.55);
        while (spinner.acc >= 1) {
            spinner.acc -= 1;
            spinner.spinsThisRide++;
            addScore(250, p.x, p.y, true);
            addFloater(p.x, p.y - 0.6, '+' + (250 * mult), '#22d3ee');
            SFX.spinnerTick();
        }
        if (s <= 0) {
            // backs out of the mouth
            b.x = rampPts[0][0]; b.y = rampPts[0][1];
            const q = ramp.at(0.01); const qm = Math.hypot(q.tx, q.ty) || 1;
            const uu = Math.min(u, -2);
            b.vx = (q.tx / qm) * uu; b.vy = (q.ty / qm) * uu;
            b.rail = null; railCooldown = 0.5;
            return;
        }
        if (s >= ramp.total) {
            const e = ramp.at(ramp.total); const em = Math.hypot(e.tx, e.ty) || 1;
            const uu = Math.max(u, 5);
            b.x = e.x; b.y = e.y;
            b.vx = (e.tx / em) * uu; b.vy = (e.ty / em) * uu - 2;
            b.rail = null; railCooldown = 0.6;
            // ramp completion
            addScore(1500, e.x, e.y + 1);
            SFX.rollover();
            if (rampLit) {
                rampLit = false;
                addScore(5000, e.x, e.y + 1);
                blackoutT = 0.6;
                armSave(8);
                showBanner('RAMP JACKPOT!', '#22d3ee', 1.3);
                SFX.jackpot();
                startShake(3, 0.2);
            }
            if (spinner.spinsThisRide >= 5) {
                addScore(5000, e.x, e.y + 1);
                blackoutT = 0.6;
                showBanner('SPINNER JACKPOT!', '#22d3ee', 1.3);
                SFX.jackpot();
            }
            return;
        }
        b.rail = s; b.railU = u;
        const np = ramp.at(s);
        b.x = np.x; b.y = np.y;
        b.vx = 0; b.vy = 0;
    }

    // ============================================================
    //  Physics step (one sub-step)
    // ============================================================
    function stepFlipper(h) {
        for (const f of flippers) {
            const pressed = (f === leftFlipper ? input.left : input.right) && state === 'play';
            const target = pressed ? f.active : f.rest;
            const prev = f.angle;
            f.angle += (target - f.angle) * Math.min(1, h * (pressed ? FLIP_UP : FLIP_DOWN));
            f.omega = (f.angle - prev) / h;
        }
    }
    function physicsStep(h) {
        const b = ball;
        if (b.holdT > 0) {
            b.holdT -= h;
            saucer.swirl += h * 6;
            if (b.holdT <= 0) ejectSaucer();
            return;
        }
        if (b.rail !== null) { railStep(h); return; }
        const prevY = b.y;
        prevX = b.x;
        // black-hole gravity well: inside its radius the pull replaces the table
        // tilt, so slow balls spiral in and fast ones only curve past it
        {
            const wx = saucer.x - b.x, wy = saucer.y - b.y;
            const wd = Math.hypot(wx, wy);
            if (wd < BH_R && wd > 1e-4) {
                const f = 1 - wd / BH_R;
                const nx = wx / wd, ny = wy / wd;
                // swirl chirality chosen so spirals wind CLOCKWISE on-screen,
                // i.e. toward the down-right mouth of the rubber ring
                b.vx += (nx * BH_PULL + ny * BH_SWIRL) * f * h;
                b.vy += (ny * BH_PULL - nx * BH_SWIRL) * f * h - GRAV * h;
                b.vx *= (1 - BH_DRAG * h); b.vy *= (1 - BH_DRAG * h);   // accretion drag
            } else {
                b.vy += GRAV * h;
            }
        }
        b.vx *= (1 - DRAG * h); b.vy *= (1 - DRAG * h);
        b.x += b.vx * h; b.y += b.vy * h;
        collideWalls(prevY);
        collideObjects();
        checkLaneCrossing(prevY, b.y);
        tryRailAttach();
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
    }

    // ============================================================
    //  Update
    // ============================================================
    function update(dt) {
        if (destroyed) return;
        updateFx(dt);
        for (const bp of bumpers) { bp.cd = Math.max(0, bp.cd - dt); bp.flash = Math.max(0, bp.flash - dt * 3); }
        for (const s of slings) { s.cd = Math.max(0, s.cd - dt); s.flash = Math.max(0, s.flash - dt * 3); }
        for (const ln of lanes) { ln.cd = Math.max(0, ln.cd - dt); ln.flash = Math.max(0, ln.flash - dt * 2.4); }
        for (const k of kickers) { k.cd = Math.max(0, k.cd - dt); k.flash = Math.max(0, k.flash - dt * 3); }
        for (const s of sensors) { s.flash = Math.max(0, s.flash - dt * 2.2); s.cd = Math.max(0, s.cd - dt); }
        for (const t of dropBank) { t.flash = Math.max(0, t.flash - dt * 3); t.pop = Math.max(0, t.pop - dt * 2.5); }
        for (const t of standups) t.flash = Math.max(0, t.flash - dt * 3);
        saucer.flash = Math.max(0, saucer.flash - dt * 1.2);
        for (const kb of kickbacks) { kb.flash = Math.max(0, kb.flash - dt * 3); kb.cd = Math.max(0, kb.cd - dt); }
        spinner.flash = Math.max(0, spinner.flash - dt * 3);
        spinner.v = Math.max(0, spinner.v - dt * 5);
        spinner.ang += spinner.v * dt;
        if (railCooldown > 0) railCooldown = Math.max(0, railCooldown - dt);
        if (bankResetT > 0) {
            bankResetT -= dt;
            if (bankResetT <= 0) resetBank();
        }
        if (bannerT > 0) bannerT = Math.max(0, bannerT - dt);
        if (saveT > 0 && state !== 'over') {
            saveT = Math.max(0, saveT - dt);
            if (saveT < 4.5) {
                saveTick -= dt;
                if (saveTick <= 0) { saveTick = 1; SFX.saveTick(); }
            }
            if (saveT === 0) showBanner('BALL SAVE OVER', '#94a3b8', 0.9);
        }

        if (state === 'launch') {
            if (input.holdingPlunger) {
                charge = Math.min(1, charge + dt / 1.05);
                chargeTick -= dt;
                if (chargeTick <= 0 && charge > 0.05) { SFX.charge(); chargeTick = 0.12; }
            } else {
                charge = Math.max(0, charge - dt * 3);
            }
            if (wasHolding && !input.holdingPlunger && charge > 0.12) doLaunch();
            wasHolding = input.holdingPlunger;
            if (state === 'launch') {
                ball.x = LANE_CX; ball.y = PLUNGER_Y; ball.vx = 0; ball.vy = 0;
            }
        } else if (state === 'play') {
            const h = dt / SUBSTEPS;
            for (let i = 0; i < SUBSTEPS; i++) {
                stepFlipper(h);
                physicsStep(h);
            }
            if (ball.rail === null && ball.holdT <= 0 && !reduced()) {
                trail.push({ x: ball.x, y: ball.y });
                if (trail.length > 14) trail.shift();
            }
            // anti-stuck nudge (threshold above the gate-pocket gravity jitter)
            const slow = Math.hypot(ball.vx, ball.vy) < 1.2 || ball.rail !== null || ball.holdT > 0;
            if (!slow) stuckTimer = 0;
            else if (ball.rail === null && ball.holdT <= 0) {
                stuckTimer += dt;
                if (stuckTimer > 1.3) {
                    stuckTimer = 0;
                    if (ball.x > LANE_X && ball.y < GATE_Y) { ball.vx -= 4; ball.vy = -9; }  // gate pocket: hop the cap into the field
                    else if (Math.hypot(ball.x - saucer.x, ball.y - saucer.y) < BH_R) {
                        // crawling inside the gravity well: feed it toward the throat.
                        // On top of the rubber the push is tangential (radial pushes
                        // bounce off the rim and trampoline forever)
                        const dx = saucer.x - ball.x, dy = saucer.y - ball.y;
                        const dd = Math.hypot(dx, dy) || 1;
                        let px, py;
                        if (dd > saucer.rimR + BALL_R) {
                            const th = Math.atan2(ball.y - saucer.y, ball.x - saucer.x);
                            const A = Math.PI / 4;                       // mouth centre angle
                            let cw = (A - th) % (Math.PI * 2); if (cw < 0) cw += Math.PI * 2;
                            if (cw <= Math.PI) { px = -Math.sin(th); py = Math.cos(th); }
                            else { px = Math.sin(th); py = -Math.cos(th); }
                        } else { px = dx / dd; py = dy / dd; }
                        ball.vx += px * 8; ball.vy += py * 8;
                    }
                    else {
                        // same spot twice in a row -> wedged (e.g. flipper-pivot /
                        // guide-rail corner): pulse harder until it breaks free
                        if (Math.hypot(ball.x - lastPokeX, ball.y - lastPokeY) < 0.35) pokeRepeat++;
                        else pokeRepeat = 0;
                        lastPokeX = ball.x; lastPokeY = ball.y;
                        const boost = Math.min(3, pokeRepeat);
                        ball.vy += 6 + boost * 5;
                        ball.vx += (Math.random() - 0.5) * 7 + (Math.random() - 0.5) * 4 * boost;
                    }
                }
            }
            // lane re-seat: ball settled back in the shooter lane -> auto re-plunge
            if (ball.x > LANE_X && ball.y > GATE_Y + 1 && Math.hypot(ball.vx, ball.vy) < 2.4) {
                ball.x = LANE_CX; ball.y = PLUNGER_Y; ball.vx = 0; ball.vy = 0;
                ball.rail = null;
                state = 'launch'; charge = 0; wasHolding = false;
                SFX.serve();
            }
            if (drained) {
                if (saveT > 0) saveRescue();
                else handleDrain();
            }
        }

        const s = Math.floor(score);
        if (s !== lastScoreShown) { lastScoreShown = s; scoreDisplay.textContent = `Score: ${s}`; }
    }

    // ============================================================
    //  Rendering
    // ============================================================
    function drawCapsule(x1, y1, x2, y2, w, style) {
        ctx.strokeStyle = style;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    function insertGlow(cx, cy, rr, color, amt) {
        const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 2.2);
        gg.addColorStop(0, color.replace('ALPHA', String(0.55 * amt)));
        gg.addColorStop(1, color.replace('ALPHA', '0'));
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(cx, cy, rr * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    function drawBumper(b) {
        const cx = sxOf(b.x), cy = syOf(b.y);
        const r = b.r * SCALE;
        const sc = 1 + b.flash * 0.13;
        if (b.flash > 0.01) insertGlow(cx, cy, r * 1.6, 'rgba(255,255,255,ALPHA)', b.flash);
        // skirt
        ctx.fillStyle = shade(b.color, -0.55);
        ctx.beginPath(); ctx.arc(cx + 1.5, cy + 2, r * 1.12 * sc, 0, Math.PI * 2); ctx.fill();
        // body ring
        const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
        body.addColorStop(0, b.light);
        body.addColorStop(0.75, b.color);
        body.addColorStop(1, shade(b.color, -0.45));
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, Math.PI * 2); ctx.fill();
        // cap
        const cap = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.05, cx, cy, r * 0.52);
        cap.addColorStop(0, '#f4f7fb'); cap.addColorStop(1, '#8b95a8');
        ctx.fillStyle = cap;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.5 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(10,14,30,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.5 * sc, 0, Math.PI * 2); ctx.stroke();
        // glowing band
        ctx.strokeStyle = b.flash > 0.15 ? '#ffffff' : shade(b.color, 0.15);
        ctx.globalAlpha = 0.7 + b.flash * 0.3;
        ctx.lineWidth = Math.max(2, r * 0.16);
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.78 * sc, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
    }
    function drawSling(sling) {
        const a = [sxOf(sling.ax), syOf(sling.ay)];
        const b = [sxOf(sling.bx), syOf(sling.by)];
        const w = Math.max(6, sling.r * SCALE * 1.9);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if (sling.flash > 0.05) insertGlow(mx, my, w, 'rgba(244,114,182,ALPHA)', sling.flash);
        drawCapsule(a[0] + 1.5, a[1] + 2.5, b[0] + 1.5, b[1] + 2.5, w + 3, 'rgba(0,0,0,0.28)');
        const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
        if (sling.flash > 0.4) { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#fbcfe8'); }
        else { grad.addColorStop(0, '#e05a8e'); grad.addColorStop(1, '#7c2350'); }
        drawCapsule(a[0], a[1], b[0], b[1], w, grad);
        drawCapsule(a[0], a[1], b[0], b[1], w * 0.28, 'rgba(255,255,255,0.5)');
        ctx.fillStyle = '#cfd6e0';
        for (const p of [a, b]) {
            ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2, w * 0.2), 0, Math.PI * 2); ctx.fill();
        }
    }
    function drawFlipper(f) {
        const pivot = f.pivot;
        const tip = flipTip(f);
        const p1 = [sxOf(pivot.x), syOf(pivot.y)];
        const p2 = [sxOf(tip.x), syOf(tip.y)];
        const w = Math.max(6, FLIP_R * 2 * SCALE);
        drawCapsule(p1[0] + 1.5, p1[1] + 2.5, p2[0] + 1.5, p2[1] + 2.5, w + 2, 'rgba(0,0,0,0.28)');
        const grad = ctx.createLinearGradient(p1[0], p1[1], p2[0], p2[1]);
        grad.addColorStop(0, '#e2e8f0');
        grad.addColorStop(1, '#64748b');
        drawCapsule(p1[0], p1[1], p2[0], p2[1], w + 2.5, '#1b2540');
        drawCapsule(p1[0], p1[1], p2[0], p2[1], w, grad);
        // rubber tip stripe
        drawCapsule(p1[0] + (p2[0] - p1[0]) * 0.72, p1[1] + (p2[1] - p1[1]) * 0.72, p2[0], p2[1], w, '#e11d48');
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = Math.max(1.5, w * 0.2);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        ctx.fillStyle = '#8b95a8';
        ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(3, w * 0.42), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(1.5, w * 0.16), 0, Math.PI * 2); ctx.fill();
    }
    function drawBall(cx, cy, r) {
        if (!reduced()) {
            for (let i = 0; i < trail.length; i++) {
                const t = trail[i];
                const tx = sxOf(t.x), ty = syOf(t.y);
                const a = (i / trail.length) * 0.35;
                ctx.fillStyle = `rgba(200,220,255,${a})`;
                ctx.beginPath(); ctx.arc(tx, ty, Math.max(1, BALL_R * SCALE * (i / trail.length)), 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(cx + 2, cy + 3, r * 0.95, 0, Math.PI * 2); ctx.fill();
        // chrome steel ball
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.12, cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.3, '#d4dde8');
        g.addColorStop(0.7, '#6b7a92');
        g.addColorStop(1, '#22304a');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        // reflected rim light
        ctx.strokeStyle = 'rgba(160,200,255,0.4)';
        ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0.4, 2.3); ctx.stroke();
        // specular
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.38, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    function drawBallMain() {
        const b = ball;
        if (b.holdT > 0) return;   // swallowed — drawn by the saucer
        let r = Math.max(2.5, BALL_R * SCALE);
        if (b.rail !== null) r *= 0.9;   // slightly "on the ramp"
        drawBall(sxOf(b.x), syOf(b.y), r);
    }
    function drawPlunger() {
        if (state === 'over') return;
        const cx = sxOf(LANE_CX);
        const yTop = syOf(PLUNGER_Y) + BALL_R * SCALE * 0.9;
        const yAnchor = syOf(L - 0.12);
        const span = (yAnchor - yTop - 5) * (1 - charge * 0.55);
        const yBot = yTop + span;
        ctx.strokeStyle = '#cfd6e0';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const coils = 5;
        for (let i = 0; i <= coils; i++) {
            const yy = yTop + ((yBot - yTop) * i) / coils;
            const xx = (i === 0 || i === coils) ? cx : cx + (i % 2 === 0 ? -5 : 5);
            if (i === 0) ctx.moveTo(cx, yTop); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.strokeStyle = '#8a93a3';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, yBot); ctx.lineTo(cx, yAnchor - 2); ctx.stroke();
        ctx.fillStyle = '#9aa3b0';
        rrPath(ctx, cx - 6, yAnchor - 5, 12, 4, 2); ctx.fill();
        // charge meter (bottom margin, right side) with skill-shot window
        const mw = 150, mx = W - 172, my = H - 24;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        rrPath(ctx, mx, my, mw, 7, 3.5); ctx.fill();
        // skill window bracket
        ctx.strokeStyle = 'rgba(126,224,161,0.9)';
        ctx.lineWidth = 1.5;
        rrPath(ctx, mx + mw * 0.82, my - 2, mw * 0.13, 11, 2); ctx.stroke();
        if (charge > 0.01) {
            ctx.fillStyle = charge > 0.95 ? '#f472b6' : charge > 0.82 ? '#7ee0a1' : charge > 0.5 ? '#ffd27f' : '#22d3ee';
            rrPath(ctx, mx, my, Math.max(6, mw * charge), 7, 3.5); ctx.fill();
        }
    }
    function drawRolloverInsert(x, y, rr, color, amt) {
        const cx = sxOf(x), cy = syOf(y);
        if (amt > 0.02) insertGlow(cx, cy, rr * SCALE, color, Math.min(1, amt));
        ctx.strokeStyle = color.replace('ALPHA', String(0.35 + 0.55 * Math.min(1, amt)));
        ctx.lineWidth = Math.max(2, rr * SCALE * 0.3);
        ctx.beginPath(); ctx.arc(cx, cy, rr * SCALE, 0, Math.PI * 2); ctx.stroke();
        if (amt > 0.05) {
            ctx.fillStyle = color.replace('ALPHA', String(0.5 * amt));
            ctx.beginPath(); ctx.arc(cx, cy, rr * SCALE * 0.6, 0, Math.PI * 2); ctx.fill();
        }
    }
    function drawDrops() {
        for (const t of dropBank) {
            const a = [sxOf(t.ax), syOf(t.ay)], b = [sxOf(t.bx), syOf(t.by)];
            const w = Math.max(4, t.r * 2 * SCALE);
            if (t.down) {
                drawCapsule(a[0], a[1], b[0], b[1], w * 0.7, 'rgba(30,41,70,0.9)');
                drawCapsule(a[0], a[1], b[0], b[1], w * 0.24, 'rgba(148,163,184,0.3)');
            } else {
                const pop = t.pop;
                const glow = t.flash;
                if (glow > 0.05) insertGlow((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, w, 'rgba(165,180,252,ALPHA)', glow);
                const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
                if (glow > 0.3) { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#c7d2fe'); }
                else { grad.addColorStop(0, '#818cf8'); grad.addColorStop(1, '#312e81'); }
                drawCapsule(a[0], a[1], b[0], b[1], w + pop * 2, grad);
                drawCapsule(a[0], a[1], b[0], b[1], w * 0.3, 'rgba(255,255,255,0.4)');
            }
        }
    }
    function drawStandups() {
        for (const t of standups) {
            const a = [sxOf(t.ax), syOf(t.ay)], b = [sxOf(t.bx), syOf(t.by)];
            const w = Math.max(5, t.r * 2 * SCALE);
            if (t.lit || t.flash > 0.3) insertGlow((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, w, 'rgba(251,191,36,ALPHA)', Math.max(t.flash, t.lit ? 0.5 : 0));
            const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
            if (t.lit) { grad.addColorStop(0, '#fde68a'); grad.addColorStop(1, '#b45309'); }
            else { grad.addColorStop(0, '#94a3b8'); grad.addColorStop(1, '#475569'); }
            drawCapsule(a[0], a[1], b[0], b[1], w, grad);
            drawCapsule(a[0], a[1], b[0], b[1], w * 0.26, 'rgba(255,255,255,0.45)');
        }
    }
    function drawKickers() {
        for (const k of kickers) {
            const cx = sxOf(k.x), cy = syOf(k.y);
            const r = k.r * SCALE;
            if (k.flash > 0.05) insertGlow(cx, cy, r * 1.6, 'rgba(126,224,161,ALPHA)', k.flash);
            ctx.fillStyle = k.flash > 0.2 ? '#d1fae5' : '#475569';
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = k.flash > 0.2 ? '#7ee0a1' : 'rgba(126,224,161,0.45)';
            ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#0b1020'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
    }
    function drawKickbacks() {
        for (const kb of kickbacks) {
            const cx = sxOf(kb.x), cy = syOf(kb.y);
            const w = 1.0 * SCALE, h = 0.36 * SCALE;
            if (kb.flash > 0.05) insertGlow(cx, cy, w * 0.7, 'rgba(126,224,161,ALPHA)', kb.flash);
            rrPath(ctx, cx - w / 2, cy - h / 2, w, h, 4);
            ctx.fillStyle = kb.lit ? '#134e3a' : '#1e293b';
            ctx.fill();
            ctx.strokeStyle = kb.lit ? '#7ee0a1' : '#334155';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = kb.lit ? (Math.floor(Date.now() / 160) % 2 ? '#7ee0a1' : 'rgba(126,224,161,0.35)') : 'rgba(148,163,184,0.25)';
            ctx.beginPath(); ctx.arc(cx, cy, h * 0.28, 0, Math.PI * 2); ctx.fill();
        }
    }
    function drawSaucer() {
        const cx = sxOf(saucer.x), cy = syOf(saucer.y);
        const rim = saucer.rimR * SCALE;
        if (saucer.flash > 0.02) insertGlow(cx, cy, rim * 1.5, 'rgba(196,181,253,ALPHA)', saucer.flash);
        // gravity-well hint ring (slowly rotating unless reduced motion)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(reduced() ? 0 : (Date.now() / 1800) % (Math.PI * 2));   // clockwise, matching the well swirl
        ctx.strokeStyle = 'rgba(167,139,250,0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 7]);
        ctx.beginPath(); ctx.arc(0, 0, BH_R * SCALE, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        // hole
        const hole = saucer.holeR * SCALE * 1.6;
        const hg = ctx.createRadialGradient(cx, cy, hole * 0.15, cx, cy, hole);
        hg.addColorStop(0, '#000004'); hg.addColorStop(0.75, '#150d33'); hg.addColorStop(1, '#241653');
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(cx, cy, hole, 0, Math.PI * 2); ctx.fill();
        // rubber rim: open ring with the mouth window facing the field
        const visIn = saucer.holeR * SCALE * 1.4;
        const midR = (visIn + rim) / 2, band = Math.max(3, rim - visIn);
        const rg2 = ctx.createLinearGradient(cx - rim, cy - rim, cx + rim, cy + rim);
        rg2.addColorStop(0, '#8f7ad4'); rg2.addColorStop(1, '#3b2f6e');
        ctx.strokeStyle = rg2; ctx.lineWidth = band; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy, midR, BH_MOUTH_B, BH_MOUTH_A + Math.PI * 2); ctx.stroke();
        // dark lips at the mouth ends
        ctx.fillStyle = '#0b1020';
        for (const a of [BH_MOUTH_A, BH_MOUTH_B]) {
            ctx.beginPath(); ctx.arc(cx + Math.cos(a) * midR, cy + Math.sin(a) * midR, Math.max(2, band * 0.3), 0, Math.PI * 2); ctx.fill();
        }
        // swirl when holding a ball
        const holdingAmt = ball.holdT > 0 ? 1 : saucer.flash;
        if (holdingAmt > 0.03 && !reduced()) {
            ctx.strokeStyle = `rgba(196,181,253,${0.55 * holdingAmt})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            const t0 = saucer.holdT > 0 ? saucer.swirl : (1 - saucer.flash) * 4;
            for (let t = 0; t <= Math.PI * 3.4; t += 0.22) {
                const rr2 = hole * 0.85 * (1 - t / (Math.PI * 4));
                const a = t + t0;
                const px = cx + Math.cos(a) * rr2, py = cy + Math.sin(a) * rr2;
                if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
    }
    function drawSpinner() {
        const s = ramp.at(SPINNER_S);
        const cx = sxOf(s.x), cy = syOf(s.y);
        const len = 0.62 * SCALE;
        if (spinner.v > 0.1 && !reduced()) insertGlow(cx, cy, len * 0.9, 'rgba(34,211,238,ALPHA)', Math.min(1, spinner.v / 20));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spinner.ang);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.92, 0); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#0b1020';
        ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    function drawSparks() {
        for (const p of sparks) {
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
            ctx.fillStyle = p.c;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }
    function drawFloaters() {
        if (!floaters.length) return;
        ctx.font = '700 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(6,10,26,0.85)';
        for (const f of floaters) {
            ctx.globalAlpha = Math.max(0, 1 - f.t / 0.7);
            ctx.strokeText(f.text, f.x, f.y - f.t * 40);
            ctx.fillStyle = f.c;
            ctx.fillText(f.text, f.x, f.y - f.t * 40);
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 0;
    }
    function drawBanner() {
        if (bannerT <= 0) return;
        const a = Math.min(1, bannerT / 0.4);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 34px system-ui, sans-serif';
        ctx.lineWidth = 7;
        ctx.strokeStyle = 'rgba(5,8,20,0.9)';
        ctx.strokeText(banner, W / 2, H * 0.38);
        ctx.fillStyle = bannerColor;
        ctx.fillText(banner, W / 2, H * 0.38);
        ctx.restore();
    }

    // LED scoreboard HUD
    function drawHUD() {
        // strip background
        ctx.fillStyle = '#04060d';
        rrPath(ctx, 8, 6, W - 16, 48, 8); ctx.fill();
        ctx.strokeStyle = '#1e2a4d'; ctx.lineWidth = 1.5;
        rrPath(ctx, 8, 6, W - 16, 48, 8); ctx.stroke();
        // LED score box
        ctx.fillStyle = '#0a0d16';
        rrPath(ctx, 16, 12, 160, 36, 5); ctx.fill();
        const blackout = blackoutT > 0;
        const blink = blackout && Math.floor(Date.now() / 90) % 2 === 0;
        let digits = String(Math.floor(score));
        if (blackout) digits = digits.padStart(8, '0');
        ctx.font = '700 22px "Courier New", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ffcf6e'; ctx.shadowBlur = 6;
        ctx.fillStyle = blackout ? (blink ? '#ffffff' : '#8a6b2f') : '#ffd27f';
        ctx.fillText(digits, 168, 31);
        ctx.shadowBlur = 0;
        // BALL + MULT
        ctx.textAlign = 'left';
        ctx.font = '700 15px "Courier New", monospace';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('BALL ' + Math.min(ballNo, 3 + (extraBallGiven ? 1 : 0)), 190, 22);
        ctx.fillStyle = mult > 1 ? '#a5f3fc' : '#475569';
        ctx.fillText('×' + mult, 262, 22);
        // small light row
        ctx.font = '600 10px system-ui, sans-serif';
        const litOn = Math.floor(Date.now() / 220) % 2 === 0;
        const chip = (x, label, active, col) => {
            ctx.fillStyle = active ? (litOn ? col : 'rgba(255,255,255,0.2)') : 'rgba(100,116,139,0.35)';
            ctx.fillText(label, x, 40);
        };
        chip(190, 'KB·L', kickbacks[0].lit, '#7ee0a1');
        chip(232, 'KB·R', kickbacks[1].lit, '#7ee0a1');
        if (saveT > 0) chip(274, 'SAVE ' + Math.ceil(saveT), true, saveT < 5 ? '#f472b6' : '#7ee0a1');
        else { ctx.fillStyle = 'rgba(100,116,139,0.35)'; ctx.fillText('SAVE', 274, 40); }
        chip(330, 'RAMP', rampLit, '#22d3ee');
        chip(374, 'X-BALL', extraBallLit && !extraBallGiven, '#f472b6');
        // BEST
        ctx.textAlign = 'right';
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.fillText('B E S T', W - 16, 15);
        ctx.font = '700 15px "Courier New", monospace';
        ctx.fillStyle = '#ffd27f';
        ctx.fillText(String(Math.max(bestScore, Math.floor(score))), W - 16, 31);
        // controls hint
        ctx.textAlign = 'left';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(148,163,184,0.55)';
        if (state === 'launch') ctx.fillText('SPACE — hold + release to launch', 16, H - 40);
        else if (state === 'play') ctx.fillText('← → flippers', 16, H - 40);
    }

    function render() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        let ox = 0, oy = 0;
        if (!reduced() && shakeMag > 0 && shakeT < shakeDur) {
            const f = 1 - shakeT / shakeDur;
            ox = (Math.random() * 2 - 1) * shakeMag * f;
            oy = (Math.random() * 2 - 1) * shakeMag * f;
        }
        ctx.save();
        ctx.translate(ox, oy);
        ctx.drawImage(deskCanvas, 0, 0);
        ctx.drawImage(tableCanvas, 0, 0);
        // dynamic, back-to-front
        for (const ln of lanes) {
            const amt = ln.lit ? 0.75 + ln.flash * 0.25 : ln.flash;
            drawRolloverInsert(ln.x, 3.4, 0.44, 'rgba(255,210,127,ALPHA)', amt);
        }
        for (const s of sensors) {
            const c = s.kind.startsWith('out') ? 'rgba(126,224,161,ALPHA)' : 'rgba(34,211,238,ALPHA)';
            drawRolloverInsert(s.x, s.y, s.r * 0.8, c, s.flash);
        }
        drawSaucer();
        drawDrops();
        drawSpinner();
        for (const s of slings) drawSling(s);
        for (const b of bumpers) drawBumper(b);
        drawStandups();
        drawKickers();
        drawKickbacks();
        drawFlipper(leftFlipper);
        drawFlipper(rightFlipper);
        drawPlunger();
        drawBallMain();
        drawSparks();
        ctx.restore();
        drawFloaters();
        drawHUD();
        drawBanner();
    }

    // ============================================================
    //  Loop (fixed 60 Hz logic, decoupled from render)
    // ============================================================
    const STEP = 1 / 60;
    let acc = 0;
    function frame(now) {
        if (destroyed) return;
        rafId = requestAnimationFrame(frame);
        let dt = (now - lastNow) / 1000;
        lastNow = now;
        if (!(dt > 0)) dt = 0;
        if (dt > 0.25) dt = 0.25;
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 15) {
            update(STEP);
            acc -= STEP;
            steps++;
        }
        if (steps === 15) acc = 0;
        render();
    }

    // ============================================================
    //  Input
    // ============================================================
    function keyDown(e) {
        if (destroyed) return;
        if (state === 'over') {
            if (!overlayOpen && (e.code === 'Space' || e.code === 'Enter')) {
                e.preventDefault();
                resetRun();
            }
            return;
        }
        const c = e.code;
        if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
            e.preventDefault();
            if (state === 'launch') input.holdingPlunger = true;
        } else if (c === 'ArrowLeft' || c === 'KeyA') {
            e.preventDefault();
            input.left = true;
        } else if (c === 'ArrowRight' || c === 'KeyD') {
            e.preventDefault();
            input.right = true;
        }
    }
    function keyUp(e) {
        if (destroyed) return;
        const c = e.code;
        if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') input.holdingPlunger = false;
        else if (c === 'ArrowLeft' || c === 'KeyA') input.left = false;
        else if (c === 'ArrowRight' || c === 'KeyD') input.right = false;
    }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);

    const touchIds = new Map();
    function recomputeTouch() {
        if (state !== 'play') return;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        let Lp = false, Rp = false;
        for (const x of touchIds.values()) { if (x < cx) Lp = true; else Rp = true; }
        input.left = Lp; input.right = Rp;
    }
    function touchStart(e) {
        if (destroyed || state === 'over') return;
        e.preventDefault();
        resumeAudio();
        if (state === 'launch') input.holdingPlunger = true;
        for (const t of e.changedTouches) touchIds.set(t.identifier, t.clientX);
        recomputeTouch();
    }
    function touchMove(e) {
        if (destroyed) return;
        e.preventDefault();
        for (const t of e.changedTouches) touchIds.set(t.identifier, t.clientX);
        recomputeTouch();
    }
    function touchEnd(e) {
        if (destroyed) return;
        e.preventDefault();
        if (state === 'launch') input.holdingPlunger = false;
        for (const t of e.changedTouches) touchIds.delete(t.identifier);
        recomputeTouch();
    }
    canvas.addEventListener('touchstart', touchStart, { passive: false });
    canvas.addEventListener('touchmove', touchMove, { passive: false });
    canvas.addEventListener('touchend', touchEnd, { passive: false });
    function pageTouchMove(e) {
        if (destroyed) return;
        if (e.target instanceof Element && e.target.closest('#game-container')) e.preventDefault();
    }
    document.addEventListener('touchmove', pageTouchMove, { passive: false });

    // ============================================================
    //  Lifecycle
    // ============================================================
    function resetRun() {
        score = 0;
        mult = 1;
        ballsLeft = 3;
        stuckTimer = 0;
        saveT = 0;
        rampLit = false;
        extraBallLit = false;
        extraBallGiven = false;
        bankResetT = 0; bankDone = false;
        blackoutT = 0;
        firstServe = true;
        railCooldown = 0;
        sparks.length = 0; floaters.length = 0;
        trail.length = 0;
        spinner.v = 0; spinner.ang = 0; spinner.spinsThisRide = 0; spinner.acc = 0;
        for (const b of bumpers) { b.cd = 0; b.flash = 0; }
        for (const s of slings) { s.cd = 0; s.flash = 0; }
        for (const ln of lanes) { ln.lit = false; ln.cd = 0; ln.flash = 0; ln.value = 100; }
        for (const k of kickers) { k.cd = 0; k.flash = 0; }
        for (const s of sensors) { s.lit = false; s.flash = 0; }
        for (const t of dropBank) { t.down = false; t.flash = 0; t.pop = 0; }
        for (const t of standups) { t.lit = false; t.flash = 0; }
        for (const kb of kickbacks) { kb.lit = false; kb.flash = 0; kb.cd = 0; }
        saucer.flash = 0; saucer.swirl = 0;
        ball.holdT = 0; ball.rail = null;
        leftFlipper.angle = leftFlipper.rest; rightFlipper.angle = rightFlipper.rest;
        canvas.style.filter = 'none';
        scoreDisplay.textContent = 'Score: 0';
        lastScoreShown = -1;
        serveBall();
    }

    bestScore = getScores()[0] ? getScores()[0].score : 0;
    resetRun();
    rafId = requestAnimationFrame(frame);

    return {
        destroy() {
            destroyed = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener('keydown', keyDown);
            window.removeEventListener('keyup', keyUp);
            window.removeEventListener('keydown', gestureResume);
            window.removeEventListener('pointerdown', gestureResume);
            canvas.removeEventListener('touchstart', touchStart);
            canvas.removeEventListener('touchmove', touchMove);
            canvas.removeEventListener('touchend', touchEnd);
            document.removeEventListener('touchmove', pageTouchMove);
            try { audioCtx.close(); } catch (e) { /* already closed */ }
        }
    };
}
