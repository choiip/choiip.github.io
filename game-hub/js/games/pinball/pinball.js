// Micro-World Pinball — a flat top-down pinball table set on a cluttered desk.
// Follows the shared hub contract: init(container) -> { destroy() }.
// Rendering is a hand-rolled orthographic (top-down) projection on a 2D canvas
// so the game stays dependency-free.

export function init(container) {
    const STORAGE_KEY = 'pinball_highscores';

    // ============================================================
    //  Canvas + projection constants
    // ============================================================
    const W = 440;
    const H = 560;
    const L = 31.2;           // table length  (y: 0 = back .. 31.2 = front)
    const HW = 8;             // table half width (x: -8 .. 8)

    // Flat top-down (orthographic) view: a long, narrow upright table seen
    // straight from above — dome top, tapering cheeks, flippers at the front.
    // Table space maps to screen space with one uniform scale.
    const SCALE = 15;                 // screen px per table unit
    const TABLE_LEFT = 100;           // screen x of the table's left edge
    const TABLE_TOP = 52;             // screen y of the dome's top
    const TABLE_W = HW * 2 * SCALE;   // 240
    const TABLE_H = L * SCALE;        // 468

    const sxOf = (x) => TABLE_LEFT + (x + HW) * SCALE;
    const syOf = (y) => TABLE_TOP + y * SCALE;
    const sclOf = () => SCALE;

    // ============================================================
    //  Physics tuning
    // ============================================================
    const BALL_R = 0.42;
    const GRAV = 14;          // table tilt: constant pull toward the front
    const DRAG = 0.08;        // mild air/rolling resistance
    const MAX_SPEED = 36;
    const WALL_REST = 0.6;    // wall restitution
    const SUBSTEPS = 6;       // physics sub-steps per logic step (anti-tunnel)

    // Table silhouette (table space)
    const DOME_CY = 8;        // dome centre y (dome radius = HW)
    const CHEEK_TOP = 20;     // where the sides start tapering in
    const CHEEK_BOT = 27.8;   // where the cheeks end (front-wall tops)
    const FRONT_HW = 4.8;     // front-wall x (drain gap is |x| < FRONT_HW)
    const DRAIN_Y = 30.9;     // drain line (below the flipper tips)

    // Launch lane (straight channel on the right, full height)
    const LANE_X = 5.4;       // inner wall x
    const LANE_CX = 6.7;      // lane centre x
    const LANE_SPLIT = 8.6;   // inner wall spans y in [LANE_SPLIT, L]
    const PLUNGER_Y = 29.6;   // plunger rest position (lane front)

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
    const bumpers = [
        { x: -3.8, y: 12.0, r: 0.85, color: '#e5484d', light: '#ff9a9d', cd: 0, flash: 0, pts: 100, rot: -0.16 }, // red eraser
        { x: 3.8, y: 12.0, r: 0.85, color: '#3b82f6', light: '#9ec5ff', cd: 0, flash: 0, pts: 100, rot: 0.12 },  // blue eraser
        { x: 0, y: 15.2, r: 0.85, color: '#f5b506', light: '#ffe39a', cd: 0, flash: 0, pts: 100, rot: 0.05 }     // yellow eraser
    ];

    const slings = [
        { ax: -4.6, ay: 21.0, bx: -2.4, by: 24.6, r: 0.35, kx: -0.5, ky: -0.86, kick: 13, cd: 0, flash: 0, pts: 50 }, // left magnet
        { ax: 4.6, ay: 21.0, bx: 2.4, by: 24.6, r: 0.35, kx: 0.5, ky: -0.86, kick: 13, cd: 0, flash: 0, pts: 50 }     // right magnet
    ];

    const mug = { x: 0, y: 7.8, r: 0.85, h: 1.1, cd: 0, flash: 0, pts: 1000 };

    const rollovers = [
        { x: -3.0, y: 3.4, r: 0.5, lit: false },
        { x: 0, y: 2.8, r: 0.5, lit: false },
        { x: 3.0, y: 3.4, r: 0.5, lit: false }
    ];

    const leftFlipper = { pivot: { x: -3.05, y: 28.6 }, rest: 42 * D2R, active: -18 * D2R, angle: 42 * D2R, omega: 0 };
    const rightFlipper = { pivot: { x: 3.05, y: 28.6 }, rest: 138 * D2R, active: 198 * D2R, angle: 138 * D2R, omega: 0 };
    const flippers = [leftFlipper, rightFlipper];

    // Static wall segments (cheeks) + fixed circulars
    const cheeks = [
        { ax: -HW, ay: CHEEK_TOP, bx: -FRONT_HW, by: CHEEK_BOT, r: 0.1 },
        { ax: LANE_X, ay: CHEEK_TOP, bx: FRONT_HW, by: CHEEK_BOT, r: 0.1 }
    ];
    const frontWalls = [
        { x: -FRONT_HW, y0: CHEEK_BOT, y1: L },
        { x: FRONT_HW, y0: CHEEK_BOT, y1: L }
    ];
    // Note: the inlanes (between flipper and front wall) are open drains,
    // like a real table's outlanes — a ball that misses the flippers there
    // falls off the desk.  No guide rails: rail + pivot-knob formed a wedge
    // pocket where the ball could rest with no way out.
    const laneCap = { x: LANE_X, y: LANE_SPLIT, r: 0.18 }; // rounded top of the lane wall

    // ============================================================
    //  DOM
    // ============================================================
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'game-canvas';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Micro-World Pinball: a marble lost on a cluttered desk. Hold Space to charge the plunger and release to launch. Use the left and right arrow keys (or A and D) for the flippers. On touch, hold to charge, then tap the left or right half for the flippers.');

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

    // ============================================================
    //  Audio (procedural, ASMR-leaning)
    // ============================================================
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function resumeAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }
    function blip(freq, type, dur, vol = 0.06, sweepTo = null) {
        resumeAudio();
        if (audioCtx.state !== 'running') return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        const t0 = audioCtx.currentTime;
        osc.frequency.setValueAtTime(freq, t0);
        if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    // A short filtered-noise burst reads as a real material "clack/thock".
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
        bumper: () => { blip(200, 'square', 0.09, 0.05, 95); thock(520, 0.06, 0.045); },
        sling: () => { blip(260, 'square', 0.08, 0.045, 130); },
        flip: () => thock(950, 0.045, 0.05, 1.6),
        mug: () => { blip(150, 'sine', 0.14, 0.08, 88); thock(720, 0.1, 0.05); },
        rollover: () => blip(880, 'sine', 0.11, 0.045, 1320),
        bonus: () => { blip(660, 'sine', 0.14, 0.05, 990); blip(990, 'sine', 0.18, 0.045, 1480); },
        launch: () => { blip(130, 'square', 0.12, 0.07, 60); thock(320, 0.08, 0.05); },
        charge: () => blip(420, 'square', 0.03, 0.02),
        drain: () => blip(220, 'sawtooth', 0.5, 0.08, 55),
        serve: () => blip(523, 'sine', 0.1, 0.045, 784),
        sneeze: () => { blip(500, 'sine', 0.28, 0.05, 180); thock(1400, 0.3, 0.03, 0.8); }
    };
    const gestureResume = () => resumeAudio();
    window.addEventListener('keydown', gestureResume, { once: true });
    window.addEventListener('pointerdown', gestureResume, { once: true });

    // ============================================================
    //  Pre-rendered backdrop: the desk
    // ============================================================
    const deskCanvas = document.createElement('canvas');
    deskCanvas.width = W; deskCanvas.height = H;
    (function buildDesk() {
        const g = deskCanvas.getContext('2d');
        const rnd = mulberry32(91);
        // Base wood
        const base = g.createLinearGradient(0, 0, 0, H);
        base.addColorStop(0, '#2a1c12');
        base.addColorStop(0.5, '#4a3320');
        base.addColorStop(1, '#3a2718');
        g.fillStyle = base;
        g.fillRect(0, 0, W, H);
        // Grain: soft horizontal streaks
        for (let i = 0; i < 90; i++) {
            const y = rnd() * H;
            const a = 0.03 + rnd() * 0.05;
            g.strokeStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,220,170,${a * 0.7})`;
            g.lineWidth = 1 + rnd() * 2;
            g.beginPath();
            g.moveTo(0, y);
            for (let x = 0; x <= W; x += 40) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
            g.stroke();
        }
        // Desk-lamp light pool (warm) over the table area
        const pool = g.createRadialGradient(W / 2, H * 0.62, 20, W / 2, H * 0.62, H * 0.62);
        pool.addColorStop(0, 'rgba(255, 214, 150, 0.28)');
        pool.addColorStop(0.55, 'rgba(255, 190, 120, 0.08)');
        pool.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = pool;
        g.fillRect(0, 0, W, H);
        // Flat desk props lying in the margins around the table (top-down)
        g.save();
        // a pencil (top-left margin)
        g.globalAlpha = 0.55;
        g.save();
        g.translate(20, 33); g.rotate(-0.05);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(2, 3, 146, 7);
        g.fillStyle = '#d9b45b'; g.fillRect(0, 0, 130, 7);
        g.fillStyle = '#e05a4e'; g.fillRect(0, 0, 14, 7);              // eraser end
        g.fillStyle = '#c9a24a'; g.fillRect(14, 0, 8, 7);              // ferrule
        g.fillStyle = '#e8d8b0';
        g.beginPath(); g.moveTo(130, 0); g.lineTo(146, 3.5); g.lineTo(130, 7); g.closePath(); g.fill(); // wood tip
        g.fillStyle = '#3a2c1c';
        g.beginPath(); g.moveTo(141, 1.9); g.lineTo(146, 3.5); g.lineTo(141, 5.1); g.closePath(); g.fill(); // graphite
        g.restore();
        // sticky notes (top-right margin, tucked under the table corner)
        g.save();
        g.translate(352, 14); g.rotate(0.07);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(3, 4, 52, 52);
        g.fillStyle = '#f4d35e'; g.fillRect(0, 0, 52, 52);
        g.fillStyle = '#f0c33f'; g.fillRect(6, 6, 52, 52);
        g.strokeStyle = 'rgba(90,70,20,0.35)'; g.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
            g.beginPath(); g.moveTo(13, 19 + i * 10); g.lineTo(48, 19 + i * 10); g.stroke();
        }
        g.restore();
        // coffee ring stain (bottom-right margin)
        g.globalAlpha = 0.3; g.strokeStyle = '#7a4a1e'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.arc(368, 508, 24, 0.3, Math.PI * 2 - 0.5); g.stroke();
        g.globalAlpha = 0.14; g.lineWidth = 2;
        g.beginPath(); g.arc(368, 508, 19, 0, Math.PI * 2); g.stroke();
        // a spare eraser (bottom-left margin)
        g.globalAlpha = 0.55;
        g.save();
        g.translate(52, 504); g.rotate(-0.12);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(2, 3, 40, 20);
        g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, 40, 20);
        g.fillStyle = '#e05a4e'; g.fillRect(0, 0, 15, 20);
        g.globalAlpha = 0.22; g.fillStyle = '#fff'; g.fillRect(0, 2, 40, 6);
        g.restore();
        g.restore();
        // Vignette
        const v = g.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 0.85);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = v;
        g.fillRect(0, 0, W, H);
    })();

    // ============================================================
    //  Pre-rendered table (static geometry + sockets + labels)
    // ============================================================
    const tableCanvas = document.createElement('canvas');
    tableCanvas.width = W; tableCanvas.height = H;
    // Rounded-rect path (shared by the pre-render and the draw loop)
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
    // The table silhouette: dome top, straight right edge (lane side),
    // left side tapering in to the front walls. `ins` insets in table units.
    function tablePath(c, ins) {
        const cxS = sxOf(0), cyD = syOf(DOME_CY), rD = (HW - ins) * SCALE;
        const xL = sxOf(-(HW - ins)), xR = sxOf(HW - ins);
        const yC = syOf(CHEEK_TOP);
        const fL = sxOf(-(FRONT_HW - ins));
        const yF = syOf(CHEEK_BOT);
        const yB = syOf(L - ins * 0.6);
        c.beginPath();
        c.moveTo(fL, yB);
        c.lineTo(fL, yF);
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
        // Drop shadow (flat, small offset — light from the top-left)
        g.save();
        g.translate(5, 7);
        tablePath(g, 0);
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.fill();
        g.restore();
        // Board (walnut)
        const bw = g.createLinearGradient(sxOf(-HW), 0, sxOf(HW), 0);
        bw.addColorStop(0, '#5a3c22'); bw.addColorStop(0.5, '#6f4d2d'); bw.addColorStop(1, '#5a3c22');
        tablePath(g, 0);
        g.fillStyle = bw; g.fill();
        g.lineWidth = 2; g.strokeStyle = '#1c120a'; g.stroke();
        // Metallic cabinet rim
        tablePath(g, 0.12);
        g.lineWidth = 3.5; g.strokeStyle = 'rgba(214,220,228,0.5)'; g.stroke();
        // Playfield inlay (lighter maple)
        tablePath(g, 0.45);
        const inlay = g.createRadialGradient(cxS, syOf(10), 10, cxS, syOf(16), TABLE_H * 0.62);
        inlay.addColorStop(0, '#d3a96f'); inlay.addColorStop(1, '#b18a52');
        g.fillStyle = inlay; g.fill();
        // faint grain on the inlay
        g.save(); g.globalAlpha = 0.05; g.strokeStyle = '#5a3d24'; g.lineWidth = 1;
        for (let i = 0; i < 26; i++) {
            const y = 1.5 + rnd() * (L - 3);
            g.beginPath(); g.moveTo(sxOf(-7.2), syOf(y)); g.lineTo(sxOf(7.2), syOf(y)); g.stroke();
        }
        g.restore();
        // brass border around the inlay
        tablePath(g, 0.45);
        g.lineWidth = 2; g.strokeStyle = '#c9a24a'; g.stroke();
        // Field decoration: faint dome arc + coffee-ring stain + title
        g.save();
        g.globalAlpha = 0.14; g.strokeStyle = '#fff2d8'; g.lineWidth = 2;
        g.beginPath(); g.arc(cxS, syOf(DOME_CY), (HW - 1.1) * SCALE, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
        g.globalAlpha = 0.1; g.strokeStyle = '#6b4423'; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.arc(sxOf(3.2), syOf(10.2), 30, 0.4, Math.PI * 2 - 0.3); g.stroke();
        g.globalAlpha = 0.05; g.lineWidth = 2;
        g.beginPath(); g.arc(sxOf(3.2), syOf(10.2), 25, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 0.42; g.fillStyle = '#fff2d8';
        g.font = '700 9px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('M I C R O   P I N B A L L', cxS, syOf(1.15));
        g.restore();
        // A pen lying in the upper-left field (faint)
        g.save();
        g.globalAlpha = 0.2;
        g.translate(sxOf(-5.2), syOf(19.4)); g.rotate(0.5);
        g.fillStyle = '#120b06';
        rrPath(g, -16, -3, 32, 6, 3); g.fill();
        g.restore();
        // Book-spine rim bands: left red book (side + cheek), right blue book (lane side)
        g.lineCap = 'round';
        g.strokeStyle = '#8f2b30'; g.lineWidth = 5;
        g.beginPath();
        g.moveTo(sxOf(-7.55), syOf(8.8)); g.lineTo(sxOf(-7.55), syOf(CHEEK_TOP - 0.4));
        g.lineTo(sxOf(-FRONT_HW - 0.35), syOf(CHEEK_BOT - 0.4));
        g.stroke();
        g.strokeStyle = '#2f5fa3';
        g.beginPath(); g.moveTo(sxOf(7.55), syOf(8.8)); g.lineTo(sxOf(7.55), syOf(L - 1)); g.stroke();
        // book "title" ticks
        g.lineWidth = 2; g.globalAlpha = 0.55;
        g.strokeStyle = '#e8c8b0';
        for (const yy of [11, 15, 19]) {
            g.beginPath(); g.moveTo(sxOf(-8) - 1, syOf(yy)); g.lineTo(sxOf(-8) + 4, syOf(yy)); g.stroke();
        }
        g.strokeStyle = '#cfe0ff';
        for (const yy of [12.5, 17, 21.5, 26, 30]) {
            g.beginPath(); g.moveTo(sxOf(HW) - 4, syOf(yy)); g.lineTo(sxOf(HW) + 1, syOf(yy)); g.stroke();
        }
        g.globalAlpha = 1;
        // Shooter lane corridor (subtle darker channel under the arch)
        g.save();
        g.globalAlpha = 0.09; g.fillStyle = '#000';
        g.beginPath();
        g.moveTo(sxOf(LANE_X), syOf(L));
        g.lineTo(sxOf(LANE_X), syOf(LANE_SPLIT));
        g.arc(sxOf(LANE_X), syOf(LANE_SPLIT), (HW - LANE_X) * SCALE, -Math.PI / 2, 0, false);
        g.lineTo(sxOf(HW), syOf(L));
        g.closePath(); g.fill();
        g.restore();
        // Inner launch-lane wall
        g.strokeStyle = '#2a2d33'; g.lineWidth = 5;
        g.beginPath(); g.moveTo(sxOf(LANE_X), syOf(LANE_SPLIT)); g.lineTo(sxOf(LANE_X), syOf(L - 0.1)); g.stroke();
        g.strokeStyle = 'rgba(123,130,140,0.5)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(sxOf(LANE_X) - 3.5, syOf(LANE_SPLIT) + 5); g.lineTo(sxOf(LANE_X) - 3.5, syOf(L - 0.2)); g.stroke();
        // Front walls flanking the drain
        for (const fw of frontWalls) {
            g.strokeStyle = '#3a2c1c'; g.lineWidth = 5;
            g.beginPath(); g.moveTo(sxOf(fw.x), syOf(fw.y0)); g.lineTo(sxOf(fw.x), syOf(L - 0.15)); g.stroke();
        }
        // Arch rail over the top of the launch lane (quarter arc rim -> field)
        g.strokeStyle = '#e0b45c'; g.lineWidth = 3.5; g.globalAlpha = 0.9;
        g.beginPath();
        g.arc(sxOf(LANE_X), syOf(LANE_SPLIT), (HW - LANE_X) * SCALE, 0, -Math.PI / 2, true);
        g.stroke();
        g.globalAlpha = 1;
        // Launch direction chevrons in the lane
        g.strokeStyle = 'rgba(255,227,154,0.4)'; g.lineWidth = 2.5;
        for (const yy of [14, 17.5, 21, 24.5]) {
            const cx2 = sxOf(LANE_CX), cy2 = syOf(yy);
            g.beginPath();
            g.moveTo(cx2 - 5, cy2 + 5); g.lineTo(cx2, cy2); g.lineTo(cx2 + 5, cy2 + 5);
            g.stroke();
        }
        // Inlane edge markers: small brass nubs where the drain channel begins
        for (const sx of [-FRONT_HW, FRONT_HW]) {
            g.fillStyle = '#c9a24a';
            g.beginPath(); g.arc(sxOf(sx), syOf(CHEEK_BOT + 0.15), 2.5, 0, Math.PI * 2); g.fill();
        }
        // Central drain slot at the front edge + "fall off the desk" shadow
        g.fillStyle = 'rgba(12,7,3,0.92)';
        rrPath(g, sxOf(-FRONT_HW) + 2, syOf(30.55), FRONT_HW * 2 * SCALE - 4, (L - 30.55) * SCALE + 5, 4);
        g.fill();
        const fg = g.createLinearGradient(0, syOf(L), 0, syOf(L) + 14);
        fg.addColorStop(0, 'rgba(0,0,0,0.5)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fg;
        g.fillRect(sxOf(-2.6), syOf(L), 5.2 * SCALE, 14);
        // Sockets / soft shadows + labels under the objects (flat offset, top-left light)
        function socket(x, y, r, label, labelAbove) {
            const cx = sxOf(x) + 2, cy = syOf(y) + 3;
            g.save();
            g.globalAlpha = 0.28; g.fillStyle = '#120b06';
            g.beginPath(); g.ellipse(cx, cy, (r + 0.18) * SCALE, (r + 0.14) * SCALE, 0, 0, Math.PI * 2); g.fill();
            g.globalAlpha = 1;
            if (label) {
                g.fillStyle = 'rgba(255,240,210,0.42)';
                g.font = '600 9px system-ui, sans-serif';
                g.textAlign = 'center';
                if (labelAbove) {
                    g.textBaseline = 'bottom';
                    g.fillText(label, sxOf(x), syOf(y) - (r + 0.25) * SCALE - 2);
                } else {
                    g.textBaseline = 'top';
                    g.fillText(label, sxOf(x), syOf(y) + (r + 0.2) * SCALE + 4);
                }
            }
            g.restore();
        }
        for (const b of bumpers) socket(b.x, b.y, b.r);
        socket(mug.x, mug.y, mug.r, 'JACKPOT', true);
        for (const s of slings) socket((s.ax + s.bx) / 2, (s.ay + s.by) / 2, 0.55);
        rollovers.forEach((r, i) => socket(r.x, r.y, r.r, i === 1 ? '\u00d72' : ''));
        socket(LANE_CX, PLUNGER_Y, 0.5); // plunger seat
    })();

    // ============================================================
    //  State
    // ============================================================
    const ball = { x: LANE_CX, y: PLUNGER_Y, vx: 0, vy: 0, inArc: false };
    let state = 'launch';            // launch | play | over
    let score = 0;
    let bestScore = 0;
    let ballsLeft = 3;
    let mult = 1, multTimer = 0;
    let charge = 0;
    let wasHolding = false;
    let chargeTick = 0;
    let banner = '', bannerT = 0;
    let scoreAcc = 0;
    let sneezeTimer = 10 + Math.random() * 6;
    let sneeze = { t: 0, dir: 0, mag: 0 };
    let stuckTimer = 0;
    let drained = false;
    let overlayOpen = false;
    let destroyed = false;
    let rafId = null;
    let lastNow = 0;
    let lastScoreShown = -1;
    let shakeMag = 0, shakeDur = 0.2, shakeT = 1;

    const input = { left: false, right: false, holdingPlunger: false };
    const trail = [];
    const sparks = [];
    const floaters = [];
    const windLines = [];

    // ============================================================
    //  Effects
    // ============================================================
    function startShake(mag, dur) { if (reduced()) return; shakeMag = mag; shakeDur = dur; shakeT = 0; }
    function spawnSparks(tx, ty, y, color, n, up = 0) {
        if (reduced()) return;
        const s = sclOf(y);
        const cx = sxOf(tx, y), cy = syOf(y);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = (40 + Math.random() * 220) * (s / 18);
            sparks.push({
                x: cx, y: cy,
                vx: Math.cos(a) * v, vy: Math.sin(a) * v - (60 + up) * (s / 18),
                g: 620 * (s / 18), life: 1, decay: 1 / (0.35 + Math.random() * 0.4),
                size: 1.5 + Math.random() * 2.5 * (s / 18), c: color
            });
        }
        if (sparks.length > 170) sparks.splice(0, sparks.length - 170);
    }
    function addFloater(x, y, text, color) {
        const s = sclOf(y);
        floaters.push({ x: sxOf(x, y), y: syOf(y) - 10 * s, text, t: 0, c: color || '#ffe39a' });
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
        for (let i = windLines.length - 1; i >= 0; i--) {
            const w = windLines[i];
            w.x += w.vx * dt; w.life -= dt;
            if (w.life <= 0 || w.x < -20 || w.x > W + 20) windLines.splice(i, 1);
        }
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
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pb-modal-title">
                <h2 id="pb-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${Math.floor(score)}</strong></p>
                <ol class="leaderboard" id="pb-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="pb-initials-form" class="initials-form" autocomplete="off">
                    <label for="pb-initials">Your Initials</label>
                    <input id="pb-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="pb-initials-form" id="pb-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="pb-again" class="btn btn-ghost">Play Again</button>
                </div>
            </div>`;
        container.appendChild(overlay);
        const form = overlay.querySelector('#pb-initials-form');
        const inp = overlay.querySelector('#pb-initials');
        const saveBtn = overlay.querySelector('#pb-save');
        let saved = false;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (saved) return;
            saved = true;
            const initials = (inp.value.trim().toUpperCase() || '???').slice(0, 3);
            saveHighScore(initials, Math.floor(score));
            overlay.querySelector('#pb-leaderboard').innerHTML = renderLeaderboard();
            saveBtn.textContent = 'Saved ✓';
            saveBtn.disabled = true;
            inp.disabled = true;
        });
        overlay.querySelector('#pb-again').addEventListener('click', () => {
            overlay.remove();
            overlayOpen = false;
            resetRun();
        });
        inp.focus();
    }

    // ============================================================
    //  Game flow
    // ============================================================
    function addScore(base, x, y) {
        const v = base * mult;
        score += v;
        if (v > 10) addFloater(x, y, `+${v}`, mult > 1 ? '#a5f3fc' : undefined);
    }
    function serveBall() {
        ball.x = LANE_CX; ball.y = PLUNGER_Y; ball.vx = 0; ball.vy = 0; ball.inArc = false;
        state = 'launch';
        charge = 0; wasHolding = false;
        input.left = input.right = false; input.holdingPlunger = false;
        trail.length = 0;
        drained = false;
        const no = 3 - ballsLeft + 1;
        banner = 'BALL ' + no;
        bannerT = 1.4;
        SFX.serve();
    }
    function doLaunch() {
        const power = 10 + charge * 30;
        ball.x = LANE_CX; ball.y = PLUNGER_Y;
        ball.vx = 0; ball.vy = -power;
        ball.inArc = true;          // this ball gets steered around the top-right arch
        state = 'play';
        charge = 0;
        SFX.launch();
        spawnSparks(LANE_CX, PLUNGER_Y, PLUNGER_Y, '#ffd27f', 8);
    }
    function handleDrain() {
        drained = false;
        SFX.drain();
        startShake(6, 0.3);
        ballsLeft--;
        if (ballsLeft > 0) serveBall();
        else { state = 'over'; gameOver(); }
    }
    function triggerSneeze() {
        if (reduced()) return;
        sneeze.t = 0.6;
        sneeze.dir = Math.random() < 0.5 ? -1 : 1;
        sneeze.mag = 26;
        SFX.sneeze();
        const fromLeft = sneeze.dir > 0;
        for (let i = 0; i < 14; i++) {
            windLines.push({
                x: fromLeft ? -10 : W + 10,
                y: TABLE_TOP + 40 + Math.random() * (syOf(L) - TABLE_TOP - 40),
                vx: (fromLeft ? 1 : -1) * (220 + Math.random() * 120),
                life: 0.5 + Math.random() * 0.3
            });
        }
    }
    function gameOver() {
        canvas.style.transition = 'filter 0.3s ease';
        canvas.style.filter = 'blur(3px)';
        showGameOverModal('Game Over');
    }

    // ============================================================
    //  Collisions
    // ============================================================
    function collideWalls() {
        const b = ball;
        // Dome (rounded back)
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
        // Outer walls (the right one doubles as the lane's outer edge)
        if (b.y > DOME_CY && b.x < -HW + BALL_R) { b.x = -HW + BALL_R; if (b.vx < 0) { b.vx = -b.vx * WALL_REST; SFX.wall(); } }
        if (b.y > DOME_CY && b.x > HW - BALL_R) { b.x = HW - BALL_R; if (b.vx > 0) { b.vx = -b.vx * WALL_REST; SFX.wall(); } }
        // Tapering cheeks (left big, right short — the right side keeps the lane)
        for (const ch of cheeks) resolveWallSeg(ch);
        // Front walls flanking the drain
        for (const fw of frontWalls) {
            if (b.y > fw.y0 && b.y < fw.y1 && Math.abs(b.x - fw.x) < BALL_R) {
                if (b.x < fw.x) { b.x = fw.x - BALL_R; if (b.vx > 0) b.vx = -b.vx * WALL_REST; }
                else { b.x = fw.x + BALL_R; if (b.vx < 0) b.vx = -b.vx * WALL_REST; }
            }
        }
        // Inner lane wall — each side is pushed back to ITS own side, so the
        // ball can never be teleported through the wall into the shooter lane.
        if (b.y > LANE_SPLIT && b.y < L && Math.abs(b.x - LANE_X) < BALL_R) {
            if (b.x < LANE_X) { b.x = LANE_X - BALL_R; if (b.vx > 0) { b.vx = -b.vx * WALL_REST; SFX.wall(); } }
            else { b.x = LANE_X + BALL_R; if (b.vx < 0) b.vx = -b.vx * WALL_REST; }
        }
        // Rounded cap on the lane wall's top (stops corner tunnelling)
        resolveCircle(laneCap, WALL_REST, 0, 0);
        // Front edge: the only openings are the flipper gap and the inlanes
        if (b.y > DRAIN_Y) {
            if (Math.abs(b.x) < FRONT_HW) {
                drained = true;
            } else {
                b.y = DRAIN_Y; if (b.vy > 0) b.vy *= -0.3;
            }
        }
    }
    function resolveWallSeg(s) {
        const b = ball;
        const c = closestPointOnSeg(b.x, b.y, s.ax, s.ay, s.bx, s.by);
        let dx = b.x - c.x, dy = b.y - c.y;
        let dist = Math.hypot(dx, dy);
        const minD = BALL_R + s.r;
        if (dist >= minD) return;
        if (dist < 1e-6) { dx = 0; dy = -1; dist = 1; }
        const nx = dx / dist, ny = dy / dist;
        b.x = c.x + nx * minD; b.y = c.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + WALL_REST) * vn * nx; b.vy -= (1 + WALL_REST) * vn * ny; }
    }
    function resolveCircle(o, rest, kick, cd) {
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
        // Surface velocity from the flipper's rotation at the contact point.
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
    function collideObjects() {
        const b = ball;
        // Bumpers
        for (const bp of bumpers) {
            if (bp.cd > 0) continue;
            if (resolveCircle(bp, 0.2, 8)) {
                bp.cd = 0.08; bp.flash = 1;
                addScore(bp.pts, bp.x, bp.y);
                spawnSparks(bp.x, bp.y, bp.y, bp.light, 7);
                SFX.bumper();
            }
        }
        // Slings
        for (const s of slings) {
            if (s.cd > 0) continue;
            if (resolveSling(s)) {
                s.cd = 0.12; s.flash = 1;
                addScore(s.pts, (s.ax + s.bx) / 2, (s.ay + s.by) / 2);
                spawnSparks((s.ax + s.bx) / 2, (s.ay + s.by) / 2, (s.ay + s.by) / 2, '#ffb3a0', 6);
                SFX.sling();
            }
        }
        // Mug (jackpot)
        if (mug.cd > 0) {
            if (resolveCircle(mug, 0.4, 4)) { /* contact while on cooldown */ }
        } else if (resolveCircle(mug, 0.4, 4)) {
            mug.cd = 0.5; mug.flash = 1;
            addScore(mug.pts, mug.x, mug.y);
            spawnSparks(mug.x, mug.y, mug.y + mug.h * 0.6, '#c7a15a', 12, 120);
            SFX.mug();
            startShake(3, 0.18);
        }
        // Flippers
        resolveFlipper(leftFlipper);
        resolveFlipper(rightFlipper);
        // Rollovers (non-blocking detection)
        let litCount = 0;
        for (const r of rollovers) {
            if (Math.hypot(b.x - r.x, b.y - r.y) < r.r + BALL_R * 0.5) r.lit = true;
            if (r.lit) litCount++;
        }
        if (litCount === rollovers.length) {
            addScore(500, 0, 2.2);
            mult = 2; multTimer = 8;
            rollovers.forEach((r) => { r.lit = false; });
            SFX.bonus();
            startShake(3, 0.2);
        }
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
        b.vy += GRAV * h;
        // Arch guide: steer a freshly-launched ball around the top-right corner
        // and into the playfield. Gated to the launched ball (inArc) so it
        // never fights the player during normal play.
        if (b.inArc) {
            if (b.x > 4.6 && b.y < 12) {
                b.vx -= 46 * h;     // carry it left, out of the lane
                b.vy += 10 * h;     // nudge it down into the field
            }
            if (b.x < 4.6) b.inArc = false;   // entered the field -> hand back to physics
        }
        // Sneeze gust
        if (sneeze.t > 0) b.vx += sneeze.dir * sneeze.mag * h;
        // Drag
        b.vx *= (1 - DRAG * h); b.vy *= (1 - DRAG * h);
        // Integrate
        b.x += b.vx * h; b.y += b.vy * h;
        // Collisions
        collideWalls();
        collideObjects();
        // Clamp speed
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
    }

    // ============================================================
    //  Update
    // ============================================================
    function update(dt) {
        if (destroyed) return;
        updateFx(dt);
        // decay timers
        for (const bp of bumpers) { bp.cd = Math.max(0, bp.cd - dt); bp.flash = Math.max(0, bp.flash - dt * 3); }
        for (const s of slings) { s.cd = Math.max(0, s.cd - dt); s.flash = Math.max(0, s.flash - dt * 3); }
        mug.cd = Math.max(0, mug.cd - dt); mug.flash = Math.max(0, mug.flash - dt * 3);
        if (multTimer > 0) { multTimer -= dt; if (multTimer <= 0) { mult = 1; multTimer = 0; } }
        if (sneeze.t > 0) sneeze.t = Math.max(0, sneeze.t - dt);
        if (bannerT > 0) bannerT = Math.max(0, bannerT - dt);

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
            // Pin the ball to the plunger only while we're still launching.
            // (doLaunch() above flips state to 'play' and sets the launch
            // velocity — re-checking avoids zeroing that velocity out.)
            if (state === 'launch') {
                ball.x = LANE_CX; ball.y = PLUNGER_Y; ball.vx = 0; ball.vy = 0;
            }
        } else if (state === 'play') {
            const h = dt / SUBSTEPS;
            for (let i = 0; i < SUBSTEPS; i++) {
                stepFlipper(h);
                physicsStep(h);
            }
            // trail
            if (!reduced()) {
                trail.push({ x: ball.x, y: ball.y });
                if (trail.length > 14) trail.shift();
            }
            // survival score
            scoreAcc += dt;
            if (scoreAcc >= 1) { score += Math.floor(scoreAcc); scoreAcc -= Math.floor(scoreAcc); }
            // sneeze scheduling
            sneezeTimer -= dt;
            if (sneezeTimer <= 0) { triggerSneeze(); sneezeTimer = 12 + Math.random() * 10; }
            // anti-stuck nudge
            if (Math.hypot(ball.vx, ball.vy) < 0.4) stuckTimer += dt; else stuckTimer = 0;
            if (stuckTimer > 1.2) { ball.vy += 7; ball.vx += (Math.random() - 0.5) * 7; stuckTimer = 0; }
            // lane re-seat (ball fell back into the shooter lane) -> re-plunge, no ball lost
            if (ball.x > LANE_X && ball.y > LANE_SPLIT - 2.5 && Math.hypot(ball.vx, ball.vy) < 2.5) {
                serveBall();
                return;
            }
            if (drained) handleDrain();
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
    function drawBumper(b) {
        // Flat eraser (rounded rect) with a colored sleeve, slightly rotated
        const cx = sxOf(b.x), cy = syOf(b.y);
        const r = b.r * SCALE;
        const sc = 1 + b.flash * 0.14;
        const w = r * 1.95 * sc, h = r * 1.45 * sc;
        if (b.flash > 0.01) {
            const gg = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.1);
            gg.addColorStop(0, `rgba(255,255,255,${0.35 * b.flash})`);
            gg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gg;
            ctx.beginPath(); ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2); ctx.fill();
        }
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(b.rot);
        const body = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
        body.addColorStop(0, shade(b.light, 0.3));
        body.addColorStop(1, shade(b.color, -0.12));
        rrPath(ctx, -w / 2, -h / 2, w, h, h * 0.26);
        ctx.fillStyle = body; ctx.fill();
        // sleeve, seam and sheen (clipped to the body)
        ctx.save();
        rrPath(ctx, -w / 2, -h / 2, w, h, h * 0.26); ctx.clip();
        const sw = w * 0.34;
        ctx.fillStyle = shade(b.color, -0.3);
        ctx.fillRect(w / 2 - sw, -h / 2, sw, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(w / 2 - sw, -h / 2 + 1); ctx.lineTo(w / 2 - sw, h / 2 - 1); ctx.stroke();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
        rrPath(ctx, -w / 2 + 2, -h / 2 + 1.5, w - 4, h * 0.3, h * 0.15); ctx.fill();
        ctx.restore();
        rrPath(ctx, -w / 2, -h / 2, w, h, h * 0.26);
        ctx.strokeStyle = shade(b.color, -0.42); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
    }
    function drawMug() {
        // Flat top-down coffee mug: ceramic ring + coffee + handle
        const cx = sxOf(mug.x), cy = syOf(mug.y);
        const r = mug.r * SCALE;
        if (mug.flash > 0.01) {
            const gg = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.4);
            gg.addColorStop(0, `rgba(255,220,150,${0.4 * mug.flash})`);
            gg.addColorStop(1, 'rgba(255,220,150,0)');
            ctx.fillStyle = gg;
            ctx.beginPath(); ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2); ctx.fill();
        }
        // handle (right side)
        ctx.strokeStyle = shade('#d8c29a', -0.08);
        ctx.lineWidth = Math.max(3, r * 0.4);
        ctx.beginPath();
        ctx.arc(cx + r * 0.95, cy, r * 0.6, -1.05, 1.05);
        ctx.stroke();
        // ceramic body
        const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r * 1.05);
        body.addColorStop(0, '#f8f1e2');
        body.addColorStop(1, '#d3bd93');
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = shade('#d8c29a', -0.35); ctx.lineWidth = 1.5; ctx.stroke();
        // coffee surface
        ctx.fillStyle = '#3a2412';
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.76, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,214,150,0.16)';
        ctx.beginPath(); ctx.arc(cx - r * 0.16, cy - r * 0.2, r * 0.4, 0, Math.PI * 2); ctx.fill();
        // steam curl (top-down spiral) when freshly bonked
        if (mug.flash > 0.05 && !reduced()) {
            ctx.strokeStyle = `rgba(255,255,255,${0.5 * mug.flash})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let t = 0; t <= Math.PI * 3; t += 0.2) {
                const rr2 = r * 0.52 * (t / (Math.PI * 3));
                const a = t - mug.flash * 3;
                const px = cx + Math.cos(a) * rr2, py = cy + Math.sin(a) * rr2;
                if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
    }
    function drawSling(sling) {
        // Flat magnet plate along the collision face
        const a = [sxOf(sling.ax), syOf(sling.ay)];
        const b = [sxOf(sling.bx), syOf(sling.by)];
        const w = Math.max(6, sling.r * SCALE * 1.9);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if (sling.flash > 0.05) {
            const gg = ctx.createRadialGradient(mx, my, 2, mx, my, w * 2.4);
            gg.addColorStop(0, `rgba(255,190,170,${0.55 * sling.flash})`);
            gg.addColorStop(1, 'rgba(255,190,170,0)');
            ctx.fillStyle = gg;
            ctx.beginPath(); ctx.arc(mx, my, w * 2.4, 0, Math.PI * 2); ctx.fill();
        }
        // shadow
        drawCapsule(a[0] + 1.5, a[1] + 2.5, b[0] + 1.5, b[1] + 2.5, w + 3, 'rgba(0,0,0,0.28)');
        // magnet body
        const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
        if (sling.flash > 0.4) { grad.addColorStop(0, '#fff2f0'); grad.addColorStop(1, '#ffb3aa'); }
        else { grad.addColorStop(0, '#e05a4e'); grad.addColorStop(1, '#9c2a22'); }
        drawCapsule(a[0], a[1], b[0], b[1], w, grad);
        // silver centre stripe
        drawCapsule(a[0], a[1], b[0], b[1], w * 0.3, 'rgba(255,255,255,0.5)');
        // end screws
        ctx.fillStyle = '#cfd6e0';
        for (const p of [a, b]) {
            ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2, w * 0.2), 0, Math.PI * 2); ctx.fill();
        }
    }
    function drawRollover(r, idx) {
        // Flat ring light
        const cx = sxOf(r.x), cy = syOf(r.y);
        const rr = Math.max(4, r.r * SCALE);
        if (r.lit) {
            const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 2);
            gg.addColorStop(0, 'rgba(255,227,154,0.5)'); gg.addColorStop(1, 'rgba(255,227,154,0)');
            ctx.fillStyle = gg;
            ctx.beginPath(); ctx.arc(cx, cy, rr * 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = r.lit ? '#ffe39a' : 'rgba(255,227,154,0.4)';
        ctx.lineWidth = Math.max(2.5, rr * 0.34);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        if (r.lit) {
            ctx.fillStyle = 'rgba(255,227,154,0.55)';
            ctx.beginPath(); ctx.arc(cx, cy, rr * 0.62, 0, Math.PI * 2); ctx.fill();
        }
    }
    function drawFlipper(f) {
        // Flat capsule flipper with hinge
        const pivot = f.pivot;
        const tip = flipTip(f);
        const p1 = [sxOf(pivot.x), syOf(pivot.y)];
        const p2 = [sxOf(tip.x), syOf(tip.y)];
        const w = Math.max(6, FLIP_R * 2 * SCALE);
        // shadow
        drawCapsule(p1[0] + 1.5, p1[1] + 2.5, p2[0] + 1.5, p2[1] + 2.5, w + 2, 'rgba(0,0,0,0.28)');
        // body
        const grad = ctx.createLinearGradient(p1[0], p1[1], p2[0], p2[1]);
        grad.addColorStop(0, '#e9d6ab');
        grad.addColorStop(1, '#b3955c');
        drawCapsule(p1[0], p1[1], p2[0], p2[1], w + 2, '#3a2414');
        drawCapsule(p1[0], p1[1], p2[0], p2[1], w, grad);
        // centre highlight
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = Math.max(1.5, w * 0.22);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        // hinge
        ctx.fillStyle = '#8a6f42';
        ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(3, w * 0.42), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(1.5, w * 0.16), 0, Math.PI * 2); ctx.fill();
    }
    function drawBall() {
        const cx = sxOf(ball.x);
        const cy = syOf(ball.y);
        const r = Math.max(2.5, BALL_R * SCALE);
        // trail
        if (!reduced()) {
            for (let i = 0; i < trail.length; i++) {
                const t = trail[i];
                const tx = sxOf(t.x), ty = syOf(t.y);
                const a = (i / trail.length) * 0.4;
                ctx.fillStyle = `rgba(120, 200, 255, ${a})`;
                ctx.beginPath(); ctx.arc(tx, ty, Math.max(1, BALL_R * SCALE * (i / trail.length)), 0, Math.PI * 2); ctx.fill();
            }
        }
        // shadow (flat offset)
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(cx + 2, cy + 3, r * 0.95, 0, Math.PI * 2); ctx.fill();
        // glassy marble
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
        g.addColorStop(0, '#eaffff');
        g.addColorStop(0.35, '#9fd8ff');
        g.addColorStop(0.75, '#3f9be0');
        g.addColorStop(1, '#1c5f9e');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        // swirl
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, -0.6, 1.1); ctx.stroke();
        // specular
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.38, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    function drawPlunger() {
        if (state === 'over') return;
        const cx = sxOf(LANE_CX);
        const yTop = syOf(PLUNGER_Y) + BALL_R * SCALE * 0.9; // just under the ball
        const yAnchor = syOf(L - 0.12);
        const span = (yAnchor - yTop - 5) * (1 - charge * 0.55); // spring compresses
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
        // rod + handle nub at the anchor
        ctx.strokeStyle = '#8a93a3';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, yBot); ctx.lineTo(cx, yAnchor - 2); ctx.stroke();
        ctx.fillStyle = '#9aa3b0';
        rrPath(ctx, cx - 6, yAnchor - 5, 12, 4, 2); ctx.fill();
        // charge meter (bottom margin)
        const mw = W * 0.28;
        const mx = W / 2 - mw / 2;
        const my = H - 16;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        rrPath(ctx, mx, my, mw, 6, 3); ctx.fill();
        if (charge > 0.01) {
            ctx.fillStyle = charge > 0.85 ? '#ff6b6b' : charge > 0.5 ? '#ffd27f' : '#7ee0a1';
            rrPath(ctx, mx, my, Math.max(6, mw * charge), 6, 3); ctx.fill();
        }
    }
    function drawWind() {
        if (!windLines.length) return;
        ctx.strokeStyle = 'rgba(200,230,255,0.35)';
        ctx.lineWidth = 1.5;
        for (const w of windLines) {
            const len = 26 * w.life;
            ctx.globalAlpha = Math.min(0.6, w.life);
            ctx.beginPath();
            ctx.moveTo(w.x, w.y);
            ctx.lineTo(w.x - (w.vx > 0 ? len : -len), w.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
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
        ctx.strokeStyle = 'rgba(20,12,6,0.8)';
        for (const f of floaters) {
            ctx.globalAlpha = Math.max(0, 1 - f.t / 0.7);
            ctx.strokeText(f.text, f.x, f.y - f.t * 40);
            ctx.fillStyle = f.c;
            ctx.fillText(f.text, f.x, f.y - f.t * 40);
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 0;
    }
    function drawMarbleIcon(x, y, on) {
        const r = 6;
        ctx.globalAlpha = on ? 1 : 0.2;
        const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r);
        g.addColorStop(0, '#eaffff'); g.addColorStop(1, '#1c5f9e');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
    function drawHUD() {
        // Score
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.font = '700 28px system-ui, sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(20,12,6,0.85)';
        const st = String(Math.floor(score));
        ctx.strokeText(st, 14, 10);
        ctx.fillStyle = '#fff';
        ctx.fillText(st, 14, 10);
        // Multiplier
        if (mult > 1) {
            ctx.font = '700 14px system-ui, sans-serif';
            ctx.fillStyle = '#7ee0a1';
            ctx.strokeStyle = 'rgba(20,12,6,0.85)';
            ctx.lineWidth = 3;
            const mt = `\u00d72  ${Math.ceil(multTimer)}s`;
            ctx.strokeText(mt, 14, 44);
            ctx.fillText(mt, 14, 44);
        }
        // Best
        ctx.textAlign = 'right';
        ctx.lineWidth = 0;
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(233,220,200,0.6)';
        ctx.fillText('B E S T', W - 14, 10);
        ctx.font = '700 18px system-ui, sans-serif';
        ctx.fillStyle = '#ffe39a';
        ctx.fillText(String(Math.max(bestScore, Math.floor(score))), W - 14, 24);
        // Balls remaining
        for (let i = 0; i < 3; i++) drawMarbleIcon(W - 22 - i * 18, 52, i < ballsLeft);
        // State hint
        ctx.textAlign = 'center';
        ctx.font = '600 12px system-ui, sans-serif';
        if (state === 'launch') {
            ctx.fillStyle = 'rgba(255,235,200,0.85)';
            ctx.fillText(reduced() ? '' : 'Hold SPACE / hold screen — release to launch', W / 2, H - 34);
        } else if (state === 'play') {
            ctx.fillStyle = 'rgba(255,235,200,0.5)';
            ctx.fillText('\u2190 / \u2192  flippers', W / 2, H - 34);
        }
    }
    function drawBanner() {
        if (bannerT <= 0) return;
        const a = Math.min(1, bannerT / 0.4);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 46px system-ui, sans-serif';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(40,20,8,0.85)';
        ctx.strokeText(banner, W / 2, H * 0.4);
        ctx.fillStyle = '#ffe39a';
        ctx.fillText(banner, W / 2, H * 0.4);
        ctx.restore();
    }

    function render() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        // screen shake
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
        for (let i = 0; i < rollovers.length; i++) drawRollover(rollovers[i], i);
        drawMug();
        for (const s of slings) drawSling(s);
        for (const b of bumpers) drawBumper(b);
        drawFlipper(leftFlipper);
        drawFlipper(rightFlipper);
        drawPlunger();
        drawBall();
        drawWind();
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

    // Touch: in launch = charge; in play = left/right halves are flippers.
    const touchIds = new Map();
    function recomputeTouch() {
        if (state !== 'play') return;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        let L = false, R = false;
        for (const x of touchIds.values()) { if (x < cx) L = true; else R = true; }
        input.left = L; input.right = R;
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
        mult = 1; multTimer = 0;
        ballsLeft = 3;
        scoreAcc = 0;
        sneezeTimer = 10 + Math.random() * 6;
        sneeze.t = 0;
        stuckTimer = 0;
        sparks.length = 0; floaters.length = 0; windLines.length = 0;
        for (const b of bumpers) { b.cd = 0; b.flash = 0; }
        for (const s of slings) { s.cd = 0; s.flash = 0; }
        mug.cd = 0; mug.flash = 0;
        rollovers.forEach((r) => { r.lit = false; });
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
