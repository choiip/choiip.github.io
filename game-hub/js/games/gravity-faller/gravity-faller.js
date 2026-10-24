export function init(container) {
    const STORAGE_KEY = 'gravity-faller_highscores';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- DOM ----
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 600;
    canvas.className = 'game-canvas';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Swipe ◀ / ▶ to aim gravity · tap to burst';

    container.append(scoreDisplay, canvas, touchHint);
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // ---- Audio (oscillators only, per hub convention) ----
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playNote(freq, type, dur, delay = 0, slideTo = null, vol = 0.09) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t0 = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.008, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    function sfx(name) {
        switch (name) {
            case 'rotate': playNote(340, 'sine', 0.07, 0, 480); break;
            case 'burst': playNote(170, 'sawtooth', 0.14, 0, 560, 0.08); break;
            case 'dry': playNote(120, 'square', 0.06, 0, 90, 0.05); break;
            case 'energy': playNote(660, 'sine', 0.08); playNote(990, 'sine', 0.1, 0.06); break;
            case 'slow': playNote(520, 'sine', 0.3, 0, 180); break;
            case 'shield': playNote(300, 'square', 0.08); playNote(460, 'square', 0.1, 0.07); break;
            case 'glass':
                playNote(1500, 'square', 0.05, 0, 900, 0.07);
                playNote(750, 'square', 0.06, 0.04, 400, 0.06);
                playNote(240, 'sawtooth', 0.12, 0.02, 120, 0.05);
                break;
            case 'slide': playNote(150, 'triangle', 0.04, 0, 120, 0.035); break;
            case 'shieldhit': playNote(520, 'square', 0.16, 0, 180, 0.08); break;
            case 'death': playNote(240, 'sawtooth', 0.7, 0, 40, 0.1); break;
            case 'void': playNote(320, 'sine', 0.5, 0, 50, 0.09); break;
            case 'milestone': playNote(880, 'sine', 0.1); playNote(1318, 'sine', 0.14, 0.09); break;
            case 'locked': playNote(140, 'square', 0.05, 0, 110, 0.05); break;
        }
    }

    // ---- World constants ----
    // DIRS is gravity directions: 0 down, 1 left, 2 up, 3 right (screen coords, y-down)
    const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    const IDX_ANGLE = [90, 180, 270, 0]; // compass angle per dir index
    const R = 10;            // player radius
    const GRAVITY_ACC = 0.3; // px/tick^2
    const DRAG = 0.988;
    const BURST = 7;         // burst impulse
    const ENERGY_MAX = 4;
    // Energy fields lock gravity shifting until the player exits — but the lock
    // also decays, so a player resting on a block face inside a field can
    // never be trapped forever.
    const FIELD_LOCK_TICKS = 240; // ~4s of game time

    // ---- State ----
    let segments = [];      // {x0,y0,dx,dy,len,s0,s1,w,nx,ny,rect,path}
    let obstacles = [];     // {type,s,latC,halfLat,halfS,nx,ny,bx,by,moving,amp,freq,phase,blink,cycle,onTicks,blinkPhase,active,x,y,w,h}
    let pickups = [];       // {s,lat,type,x,y,taken}
    let voids = [];         // {s,sw,holeH}
    let fields = [];        // {s,len}
    let particles = [];
    let trail = [];

    let pathLen = 0;        // total arc length of the centerline
    let endPt = { x: 0, y: 0 };
    let lastDir = 0;
    let segIdx = 0;         // segment index the player is near
    let lastPickupS = -400;

    let px = 0, py = 0, vx = 0, vy = 0;
    let gravIdx = 0;
    let gravAngle = 90;     // animated compass angle (degrees)
    let energy = 2;
    let shield = false;
    let slowTicks = 0;
    let boost = 0;
    let invuln = 0;
    let locked = false;
    let lockTicks = 0;
    let lockedFlash = 0;
    let energyFlash = 0;
    let mileFlash = 0;
    let mileValue = 0;
    let contact = null;     // {nx,ny} wall currently supporting the player

    let startS = 0;
    let bestS = 0;
    let bonus = 0;
    let scoreShown = 0;
    let bestRun = 0;
    let lastMilestone = 0;

    let state = 'ready';    // 'ready' | 'playing' | 'dying' | 'gameover'
    let dyingT = 0;
    let tick = 0;
    let lastSlideT = 0;
    let curS = 0;

    let camX = 0, camY = 0;
    let animationId = null;
    let lastT = performance.now();
    let destroyed = false;
    let modalOverlay = null;

    // Background stars (regenerated per run for variety)
    let stars = [];
    function makeStars() {
        stars = [];
        for (let i = 0; i < 26; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: 0.5 + Math.random(), par: 0.22, a: 0.25 + Math.random() * 0.3 });
        for (let i = 0; i < 16; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 1.2, par: 0.45, a: 0.35 + Math.random() * 0.35 });
    }

    // ---- Difficulty curves (m = depth in meters) ----
    function maxSpeed() { return 3 + 2.5 * Math.min(1, scoreShown / 300); }
    function crashSpeed() { return maxSpeed() * 0.55; }
    function glassSpeed() { return maxSpeed() * 0.85; }
    function widthAt(m) { return 300 - 110 * Math.min(1, m / 400); }

    // ---- Path construction ----
    function segEnd(seg) { return { x: seg.x0 + seg.dx * seg.len, y: seg.y0 + seg.dy * seg.len }; }

    function setObSize(ob) {
        ob.x = ob.bx + ob.nx * ob.latC;
        ob.y = ob.by + ob.ny * ob.latC;
        if (Math.abs(ob.nx) > 0.5) { ob.w = ob.halfLat * 2; ob.h = ob.halfS * 2; }
        else { ob.w = ob.halfS * 2; ob.h = ob.halfLat * 2; }
    }

    function tubeClear(dirIdx, len, m) {
        const dir = DIRS[dirIdx];
        const ex = endPt.x + dir[0] * len;
        const ey = endPt.y + dir[1] * len;
        let rx0, ry0, rx1, ry1;
        if (dir[1] !== 0) {
            rx0 = endPt.x - m; rx1 = endPt.x + m;
            ry0 = Math.min(endPt.y, ey) - m; ry1 = Math.max(endPt.y, ey) + m;
        } else {
            ry0 = endPt.y - m; ry1 = endPt.y + m;
            rx0 = Math.min(endPt.x, ex) - m; rx1 = Math.max(endPt.x, ex) + m;
        }
        for (let i = Math.max(0, segments.length - 31); i < segments.length - 1; i++) {
            const r = segments[i].rect;
            if (rx0 < r.x1 && rx1 > r.x0 && ry0 < r.y1 && ry1 > r.y0) return false;
        }
        return true;
    }

    function spawnSegmentEntities(seg) {
        const m = seg.s0 / 10;
        if (m >= 120) {
            const r = Math.min(1, m / 450);
            // Solid protrusions from the walls
            if (Math.random() < 0.18 + 0.4 * r) {
                const count = 1 + (r > 0.45 && Math.random() < 0.4 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                    const halfLat = 26 + Math.random() * 24;
                    if (seg.w - 2 * halfLat < 72) continue; // keep a passable gap
                    const s = seg.s0 + seg.len * (0.28 + 0.44 * Math.random()) + i * 160;
                    if (s > seg.s1 - 90) continue;
                    const side = Math.random() < 0.5 ? -1 : 1;
                    const ob = {
                        type: 'solid', s,
                        latC: side * (seg.w / 2 - halfLat),
                        halfLat, halfS: 22 + Math.random() * 14,
                        nx: seg.nx, ny: seg.ny,
                        bx: seg.x0 + seg.dx * (s - seg.s0),
                        by: seg.y0 + seg.dy * (s - seg.s0),
                        moving: m > 150 && Math.random() < 0.2 + 0.35 * r,
                        amp: 18 + Math.random() * Math.min(40, seg.w / 4 - 12),
                        freq: 0.018 + Math.random() * 0.016,
                        phase: Math.random() * Math.PI * 2,
                        blink: m > 260 && Math.random() < 0.25,
                        cycle: 110 + Math.random() * 40,
                        onTicks: 62,
                        blinkPhase: Math.floor(Math.random() * 110),
                        active: true, x: 0, y: 0, w: 0, h: 0
                    };
                    setObSize(ob);
                    obstacles.push(ob);
                }
            }
            // Shatter-glass: only breaks at speed
            if (Math.random() < 0.1 + 0.22 * r) {
                const s = seg.s0 + seg.len * (0.4 + Math.random() * 0.35);
                const ob = {
                    type: 'glass', s,
                    latC: (Math.random() * 2 - 1) * seg.w * 0.18,
                    halfLat: 24 + Math.random() * 10,
                    halfS: 18 + Math.random() * 8,
                    nx: seg.nx, ny: seg.ny,
                    bx: seg.x0 + seg.dx * (s - seg.s0),
                    by: seg.y0 + seg.dy * (s - seg.s0),
                    moving: false, amp: 0, freq: 0, phase: 0,
                    blink: false, cycle: 0, onTicks: 0, blinkPhase: 0,
                    active: true, x: 0, y: 0, w: 0, h: 0
                };
                setObSize(ob);
                obstacles.push(ob);
            }
            // Void gap: a rift across the shaft, safe bridge in the middle
            if (seg.len > 520 && Math.random() < 0.15 + 0.25 * r) {
                voids.push({ s: seg.s0 + seg.len * 0.6, sw: 26, holeH: Math.max(46, seg.w * 0.21) });
            }
            // Energy field: gravity shifting disabled while inside
            if (seg.len > 460 && Math.random() < 0.14 + 0.2 * r) {
                fields.push({ s: seg.s0 + seg.len * 0.45, len: Math.min(200, seg.len * 0.42) });
            }
        }
        // Power-ups on a roughly regular cadence
        if (pathLen - lastPickupS > 250 + Math.random() * 300) {
            const s = seg.s1 - 70;
            const rr = Math.random();
            const p = pointAt(s);
            pickups.push({
                s,
                lat: (Math.random() * 2 - 1) * seg.w * 0.2,
                type: rr < 0.5 ? 'energy' : rr < 0.78 ? 'slow' : 'shield',
                x: p.x + p.seg.nx * ((Math.random() * 2 - 1) * seg.w * 0.2),
                y: p.y + p.seg.ny * ((Math.random() * 2 - 1) * seg.w * 0.2),
                taken: false
            });
            lastPickupS = s;
        }
    }

    function addSegment(dirIdx, len) {
        const dir = DIRS[dirIdx];
        const s0 = pathLen;
        const s1 = s0 + len;
        const w = widthAt(s0 / 10);
        const seg = {
            x0: endPt.x, y0: endPt.y, dx: dir[0], dy: dir[1],
            len, s0, s1, w,
            nx: -dir[1], ny: dir[0]
        };
        seg.rect = null; // filled after push (needs consistent m)
        const m = w / 2 + 16;
        const ex = endPt.x + dir[0] * len;
        const ey = endPt.y + dir[1] * len;
        if (dir[1] !== 0) {
            seg.rect = { x0: endPt.x - m, x1: endPt.x + m, y0: Math.min(endPt.y, ey) - m, y1: Math.max(endPt.y, ey) + m };
        } else {
            seg.rect = { x0: Math.min(endPt.x, ex) - m, x1: Math.max(endPt.x, ex) + m, y0: endPt.y - m, y1: endPt.y + m };
        }
        const path = new Path2D();
        path.moveTo(seg.x0, seg.y0);
        path.lineTo(ex, ey);
        seg.path = path;
        segments.push(seg);
        endPt = { x: ex, y: ey };
        pathLen = s1;
        spawnSegmentEntities(seg);
    }

    function pickNext() {
        const scale = 1 - 0.45 * Math.min(1, (pathLen / 10) / 500);
        // The labyrinth always progresses downward: no upward segments, since
        // "gravity up" is not a player input and an up-stretch would soft-lock
        // a player arriving from below. This also makes self-intersection
        // impossible by construction (y is monotone along the path).
        let opts;
        if (lastDir !== 1 && lastDir !== 3) {
            // Coming down: keep falling or bank left / right
            opts = [
                { d: 0, w: 4.5 },
                { d: 1, w: 2.4 },
                { d: -1, w: 2.4 }
            ];
        } else {
            // Coming sideways: continue, or turn down (never up)
            opts = [
                { d: 0, w: 2.5 },
                { d: lastDir === 1 ? -1 : 1, w: 3.5 } // down
            ];
        }
        for (let attempt = 0; attempt < 6; attempt++) {
            let total = 0;
            for (const o of opts) total += o.w;
            let roll = Math.random() * total;
            let choice = opts[0].d;
            for (const o of opts) {
                roll -= o.w;
                if (roll <= 0) { choice = o.d; break; }
            }
            const nd = (lastDir + choice + 4) % 4;
            let len = DIRS[nd][1] !== 0 ? 550 + Math.random() * 350 : 380 + Math.random() * 260;
            len = Math.max(320, Math.round(len * scale));
            if (tubeClear(nd, len, widthAt(pathLen / 10) / 2 + 20)) return { nd, len };
        }
        // Fallback: keep the current direction
        let len = DIRS[lastDir][1] !== 0 ? 550 : 380;
        return { nd: lastDir, len: Math.max(320, Math.round(len * scale)) };
    }

    function generateAhead(s) {
        while (pathLen < s + 3400) {
            const next = pickNext();
            addSegment(next.nd, next.len);
            lastDir = next.nd;
        }
    }

    function pruneBehind(sMin) {
        let removed = 0;
        while (segments.length && segments[0].s1 < sMin) { segments.shift(); removed++; }
        if (removed) {
            segIdx = Math.max(0, Math.min(segments.length - 1, segIdx - removed));
            obstacles = obstacles.filter(o => o.s >= sMin);
            pickups = pickups.filter(p => !p.taken && p.s >= sMin);
            voids = voids.filter(v => v.s >= sMin);
            fields = fields.filter(f => f.s >= sMin);
        }
    }

    // ---- Path queries ----
    function pointAt(s) {
        let i = Math.max(0, Math.min(segIdx, segments.length - 1));
        while (i > 0 && s < segments[i].s0) i--;
        while (i < segments.length - 1 && s >= segments[i].s1) i++;
        const seg = segments[i];
        const t = Math.max(0, Math.min(seg.len, s - seg.s0));
        return { x: seg.x0 + seg.dx * t, y: seg.y0 + seg.dy * t, seg };
    }

    function P(s, lat) {
        const p = pointAt(s);
        return { x: p.x + p.seg.nx * lat, y: p.y + p.seg.ny * lat };
    }

    // Nearest point on the centerline to the player
    function project() {
        if (!segments.length) return null;
        let best = null;
        const lo = Math.max(0, segIdx - 4);
        const hi = Math.min(segments.length, segIdx + 6);
        for (let i = lo; i < hi; i++) {
            const seg = segments[i];
            const rx = px - seg.x0, ry = py - seg.y0;
            const t = Math.max(0, Math.min(seg.len, rx * seg.dx + ry * seg.dy));
            const cx = seg.x0 + seg.dx * t, cy = seg.y0 + seg.dy * t;
            const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            if (!best || d2 < best.d2) best = { d2, i, t, cx, cy };
        }
        segIdx = best.i;
        const seg = segments[best.i];
        const lat = (px - best.cx) * seg.nx + (py - best.cy) * seg.ny;
        return { s: seg.s0 + best.t, lat, seg, cx: best.cx, cy: best.cy };
    }

    // ---- Game actions ----
    function startPlay() {
        if (state !== 'ready') return;
        state = 'playing';
    }

    function setGravity(idx) {
        if (state !== 'playing') return;
        if (locked) { lockedFlash = 12; sfx('locked'); return; }
        if (gravIdx === idx) return;
        gravIdx = idx;
        sfx('rotate');
    }

    function burst() {
        if (state !== 'playing') return;
        if (energy <= 0) { energyFlash = 10; sfx('dry'); return; }
        energy--;
        const g = DIRS[gravIdx];
        vx -= g[0] * BURST;
        vy -= g[1] * BURST;
        boost = 14;
        sfx('burst');
        if (!reducedMotion) spawnBurst(px, py, 'rgba(103,232,249,0.9)', 8, 2.5);
    }

    function absorbShield(nx, ny) {
        if (!shield || invuln > 0) return false;
        shield = false;
        invuln = 28;
        sfx('shieldhit');
        if (!reducedMotion) spawnBurst(px, py, 'rgba(74,222,128,0.9)', 12, 3);
        return true;
    }

    function die(cause) {
        if (state !== 'playing') return true;
        state = 'dying';
        dyingT = 46;
        sfx(cause === 'void' ? 'void' : 'death');
        if (!reducedMotion) {
            spawnBurst(px, py, 'rgba(34,211,238,0.95)', 14, 4);
            spawnBurst(px, py, 'rgba(255,255,255,0.95)', 8, 3);
            spawnBurst(px, py, 'rgba(251,146,60,0.9)', 8, 3.5);
        } else {
            spawnBurst(px, py, 'rgba(34,211,238,0.95)', 6, 3);
        }
        return true;
    }

    // ---- Collision ----
    function collideWalls(pr) {
        const seg = pr.seg;
        const limit = seg.w / 2 - R;
        const a = Math.abs(pr.lat);
        if (a <= limit) { contact = null; return false; }
        const side = Math.sign(pr.lat) || 1;
        const nx = seg.nx * side, ny = seg.ny * side;
        const vOut = vx * nx + vy * ny;
        const gIn = DIRS[gravIdx][0] * nx + DIRS[gravIdx][1] * ny;
        if (gIn > 0) {
            // Gravity pushes us into this face: it is our floor. Always safe.
            px -= nx * (a - limit);
            py -= ny * (a - limit);
            if (vOut > 0) { vx -= nx * vOut; vy -= ny * vOut; }
            contact = { nx, ny };
            if (vOut > 1.2 && tick - lastSlideT > 12) {
                lastSlideT = tick;
                sfx('slide');
                if (!reducedMotion) spawnBurst(px, py, 'rgba(148,163,184,0.7)', 5, 1.8);
            }
            return false;
        }
        if (a > seg.w / 2 + R) return die('void'); // tunneled clear of the shaft
        if (vOut > crashSpeed()) {
            if (absorbShield(nx, ny)) {
                px -= nx * (a - limit);
                py -= ny * (a - limit);
                vx -= nx * vOut;
                vy -= ny * vOut;
                contact = { nx, ny };
                return false;
            }
            return die('wall');
        }
        px -= nx * (a - limit);
        py -= ny * (a - limit);
        if (vOut > 0) { vx -= nx * vOut; vy -= ny * vOut; }
        contact = { nx, ny };
        if (vOut > 0.4 && tick - lastSlideT > 12) {
            lastSlideT = tick;
            sfx('slide');
        }
        return false;
    }

    function collideObstacles(pr) {
        for (const ob of obstacles) {
            if (Math.abs(ob.s - pr.s) > 420) continue;
            if (ob.blink) {
                ob.active = ((tick + ob.blinkPhase) % ob.cycle) < ob.onTicks;
                if (!ob.active) continue;
            }
            if (ob.moving) {
                const latNow = ob.latC + ob.amp * Math.sin(tick * ob.freq + ob.phase);
                ob.x = ob.bx + ob.nx * latNow;
                ob.y = ob.by + ob.ny * latNow;
            }
            const dx = px - ob.x, dy = py - ob.y;
            const ox = ob.w / 2 + R - Math.abs(dx);
            const oy = ob.h / 2 + R - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;
            let nx = 0, ny = 0;
            if (ox < oy) nx = Math.sign(dx) || 1;
            else ny = Math.sign(dy) || 1;
            // (wx, wy) points from the player into the block face; vIn is the
            // speed at which we are closing onto that face (> 0 = approaching)
            const wx = -nx, wy = -ny;
            const vIn = vx * wx + vy * wy;
            if (ob.type === 'glass') {
                if (vIn >= glassSpeed()) {
                    obstacles.splice(obstacles.indexOf(ob), 1);
                    bonus += 25;
                    sfx('glass');
                    if (!reducedMotion) spawnBurst(ob.x, ob.y, 'rgba(103,232,249,0.9)', 16, 3.5);
                    continue;
                }
            } else if (vIn > crashSpeed()) {
                const gIn = DIRS[gravIdx][0] * wx + DIRS[gravIdx][1] * wy;
                if (gIn > 0) {
                    // gravity pushes us onto this face: a landing, always safe
                } else if (!absorbShield(nx, ny)) {
                    return die('wall');
                }
            }
            if (ox < oy) px += nx * ox; else py += ny * oy;
            if (vIn > 0) { vx -= wx * vIn; vy -= wy * vIn; }
        }
        return false;
    }

    function collideVoids(pr) {
        for (const v of voids) {
            if (Math.abs(v.s - pr.s) < v.sw / 2 && Math.abs(pr.lat) > v.holeH) {
                if (invuln > 0) continue;
                if (shield) {
                    shield = false;
                    invuln = 30;
                    sfx('shieldhit');
                    const c = pointAt(v.s);
                    px = c.x;
                    py = c.y;
                    vx = 0;
                    vy = 0;
                    return false;
                }
                return die('void');
            }
        }
        return false;
    }

    // ---- Particles ----
    function spawnBurst(x, y, color, n, speed) {
        for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            const sp = (0.3 + Math.random()) * speed;
            particles.push({
                x, y,
                vx: Math.cos(ang) * sp,
                vy: Math.sin(ang) * sp,
                g: 0.04,
                life: 18 + Math.random() * 18,
                maxLife: 36,
                color,
                size: 1.5 + Math.random() * 2.5
            });
        }
        if (particles.length > 140) particles.splice(0, particles.length - 140);
    }

    function updateParticles(dt60) {
        for (const p of particles) {
            p.x += p.vx * dt60;
            p.y += p.vy * dt60;
            p.vy += p.g * dt60;
            p.life -= dt60;
        }
        if (particles.some(p => p.life <= 0)) particles = particles.filter(p => p.life > 0);
    }

    // ---- Step ----
    function step(dt) {
        const ts = state === 'playing' && slowTicks > 0 ? 0.5 : 1;
        const dt60 = (dt / 16.667) * ts;
        tick += dt60;
        if (invuln > 0) invuln -= dt60;
        if (boost > 0) boost -= dt60;
        if (slowTicks > 0) slowTicks -= dt60;
        if (lockedFlash > 0) lockedFlash -= dt60;
        if (energyFlash > 0) energyFlash -= dt60;
        if (mileFlash > 0) mileFlash -= dt60;

        // Compass eases toward the current gravity direction
        const d = ((IDX_ANGLE[gravIdx] - gravAngle) % 360 + 540) % 360 - 180;
        gravAngle += d * (1 - Math.pow(0.7, dt60));

        if (state === 'ready') return;
        if (state === 'dying') {
            updateParticles(dt60);
            dyingT -= dt60;
            if (dyingT <= 0) endRun();
            return;
        }
        if (state !== 'playing') return;

        // Support from a wall we are resting on (gravity into the face)
        if (contact) {
            const dot = vx * contact.nx + vy * contact.ny;
            if (dot > 0) { vx -= contact.nx * dot; vy -= contact.ny * dot; }
        }

        // Gravity + drag + speed clamp
        const g = DIRS[gravIdx];
        vx += g[0] * GRAVITY_ACC * dt60;
        vy += g[1] * GRAVITY_ACC * dt60;
        const drag = Math.pow(DRAG, dt60);
        vx *= drag;
        vy *= drag;
        const lim = maxSpeed() + (boost > 0 ? 3.5 : 0);
        const sp = Math.hypot(vx, vy);
        if (sp > lim) {
            const k = lim / sp;
            vx *= k;
            vy *= k;
        }
        px += vx * dt60;
        py += vy * dt60;

        const pr = project();
        if (!pr) return;
        curS = pr.s;

        if (collideWalls(pr)) return;
        if (collideObstacles(pr)) return;
        if (collideVoids(pr)) return;

        // Energy field: gravity shifting locked while inside. The lock is
        // released when the player exits the zone or when it decays —
        // whichever comes first — so resting players can't be trapped.
        let inField = false;
        for (const f of fields) {
            if (Math.abs(f.s - pr.s) < f.len / 2) { inField = true; break; }
        }
        if (inField) {
            lockTicks += dt60;
            locked = lockTicks < FIELD_LOCK_TICKS;
        } else {
            lockTicks = 0;
            locked = false;
        }

        // Pickups
        for (const pk of pickups) {
            if (pk.taken || Math.abs(pk.s - pr.s) > 300) continue;
            const ddx = px - pk.x, ddy = py - pk.y;
            if (ddx * ddx + ddy * ddy < (R + 16) * (R + 16)) {
                pk.taken = true;
                if (pk.type === 'energy') {
                    energy = Math.min(ENERGY_MAX, energy + 1);
                    sfx('energy');
                    if (!reducedMotion) spawnBurst(pk.x, pk.y, 'rgba(34,211,238,0.9)', 8, 2.2);
                } else if (pk.type === 'slow') {
                    slowTicks = 170;
                    sfx('slow');
                    if (!reducedMotion) spawnBurst(pk.x, pk.y, 'rgba(168,85,249,0.9)', 8, 2.2);
                } else {
                    shield = true;
                    sfx('shield');
                    if (!reducedMotion) spawnBurst(pk.x, pk.y, 'rgba(74,222,128,0.9)', 8, 2.2);
                }
            }
        }

        // Score: distance along the labyrinth + glass bonus
        if (pr.s > bestS) bestS = pr.s;
        const m = Math.floor((bestS - startS) / 10) + bonus;
        if (m !== scoreShown) {
            scoreShown = m;
            if (m > bestRun) bestRun = m;
            scoreDisplay.textContent = `Score: ${m} · Best: ${bestRun}`;
            const mile = Math.floor(m / 100);
            if (mile > lastMilestone) {
                lastMilestone = mile;
                mileValue = mile * 100;
                mileFlash = 40;
                sfx('milestone');
            }
        }

        if (!reducedMotion) {
            trail.unshift({ x: px, y: py });
            if (trail.length > 14) trail.pop();
        }

        updateParticles(dt60);

        // Keep the world ahead of us, and trim the past
        generateAhead(pr.s);
        if (segments[0] && segments[0].s1 < pr.s - 1500) pruneBehind(pr.s - 1500);

        // Camera follows with a look-ahead along the velocity
        const k = 1 - Math.pow(0.9, dt60);
        camX += (px + vx * 9 - camX) * k;
        camY += (py + vy * 9 - camY) * k;
    }

    // ---- Rendering ----
    function mod(v, m) { return ((v % m) + m) % m; }

    function drawBackground() {
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#0a0d1c');
        grad.addColorStop(0.6, '#0d1226');
        grad.addColorStop(1, '#141b36');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Faint engineering grid
        const gs = 70;
        const ox = -mod(camX * 0.85, gs);
        const oy = -mod(camY * 0.85, gs);
        ctx.strokeStyle = 'rgba(108,140,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = ox; x < W; x += gs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
        for (let y = oy; y < H; y += gs) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
        ctx.stroke();

        // Parallax stars
        for (const s of stars) {
            const sx = mod(s.x - camX * s.par, W);
            const sy = mod(s.y - camY * s.par, H);
            ctx.fillStyle = `rgba(226,232,240,${s.a})`;
            ctx.beginPath();
            ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawCorridor() {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const passes = [
            [36, 'rgba(34,211,238,0.07)'],
            [10, '#1590ad'],
            [0, '#0d1526']
        ];
        for (const [add, style] of passes) {
            ctx.strokeStyle = style;
            for (const seg of segments) {
                if (seg.s1 < curS - 700 || seg.s0 > curS + 1000) continue;
                ctx.lineWidth = seg.w + add;
                ctx.stroke(seg.path);
            }
        }
        // Dashed centerline sells the direction of travel
        ctx.setLineDash([12, 30]);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1.5;
        for (const seg of segments) {
            if (seg.s1 < curS - 700 || seg.s0 > curS + 1000) continue;
            ctx.stroke(seg.path);
        }
        ctx.setLineDash([]);
    }

    function bandPath(s0, s1, lat0, lat1) {
        const a = P(s0, lat0), b = P(s1, lat0), c = P(s1, lat1), d = P(s0, lat1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
    }

    function drawVoids() {
        for (const v of voids) {
            if (Math.abs(v.s - curS) > 900) continue;
            const seg = pointAt(v.s).seg;
            const hw = seg.w / 2;
            // The rift
            bandPath(v.s - v.sw / 2, v.s + v.sw / 2, -hw, hw);
            ctx.fillStyle = 'rgba(4,6,14,0.92)';
            ctx.fill();
            // Warning edges along the rift ends
            ctx.strokeStyle = 'rgba(232,121,249,0.5)';
            ctx.lineWidth = 2;
            const a0 = P(v.s - v.sw / 2, -hw), a1 = P(v.s - v.sw / 2, hw);
            const b0 = P(v.s + v.sw / 2, -hw), b1 = P(v.s + v.sw / 2, hw);
            ctx.beginPath();
            ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y);
            ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y);
            ctx.stroke();
            // Safe bridge in the middle
            bandPath(v.s - v.sw / 2, v.s + v.sw / 2, -v.holeH, v.holeH);
            ctx.fillStyle = 'rgba(34,211,238,0.16)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(34,211,238,0.8)';
            ctx.lineWidth = 2;
            const c0 = P(v.s - v.sw / 2, -v.holeH), c1 = P(v.s + v.sw / 2, -v.holeH);
            const d0 = P(v.s - v.sw / 2, v.holeH), d1 = P(v.s + v.sw / 2, v.holeH);
            ctx.beginPath();
            ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
            ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y);
            ctx.stroke();
        }
    }

    function drawFields() {
        for (const f of fields) {
            if (Math.abs(f.s - curS) > 900) continue;
            const seg = pointAt(f.s).seg;
            const hw = seg.w / 2;
            bandPath(f.s - f.len / 2, f.s + f.len / 2, -hw, hw);
            ctx.fillStyle = 'rgba(168,85,249,0.13)';
            ctx.fill();
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = 'rgba(192,132,252,0.7)';
            ctx.lineWidth = 2;
            const a0 = P(f.s - f.len / 2, -hw), a1 = P(f.s - f.len / 2, hw);
            const b0 = P(f.s + f.len / 2, -hw), b1 = P(f.s + f.len / 2, hw);
            ctx.beginPath();
            ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y);
            ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y);
            ctx.stroke();
            ctx.setLineDash([]);
            // Lightning glyph in the middle
            const c = pointAt(f.s);
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(Math.atan2(seg.dy, seg.dx) - Math.PI / 2);
            ctx.fillStyle = `rgba(192,132,252,${0.6 + 0.3 * Math.sin(tick * 0.15)})`;
            ctx.beginPath();
            ctx.moveTo(2, -12);
            ctx.lineTo(-5, 2);
            ctx.lineTo(-1, 2);
            ctx.lineTo(-2, 12);
            ctx.lineTo(5, -2);
            ctx.lineTo(1, -2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    function drawObstacles() {
        for (const ob of obstacles) {
            if (Math.abs(ob.s - curS) > 900) continue;
            const x = ob.x, y = ob.y, w = ob.w, h = ob.h;
            if (ob.type === 'glass') {
                ctx.fillStyle = 'rgba(103,232,249,0.2)';
                ctx.fillRect(x - w / 2, y - h / 2, w, h);
                ctx.strokeStyle = 'rgba(103,232,249,0.85)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x - w / 2 + 1, y - h / 2 + 1, w - 2, h - 2);
                // Cracks
                ctx.strokeStyle = 'rgba(103,232,249,0.35)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - w * 0.3, y - h / 2);
                ctx.lineTo(x - w * 0.1, y + h * 0.2);
                ctx.lineTo(x - w * 0.35, y + h / 2);
                ctx.moveTo(x + w * 0.25, y - h / 2);
                ctx.lineTo(x + w * 0.1, y + h * 0.1);
                ctx.lineTo(x + w * 0.35, y + h / 2);
                ctx.stroke();
            } else if (ob.blink && !ob.active) {
                ctx.setLineDash([6, 6]);
                ctx.strokeStyle = 'rgba(251,146,60,0.28)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x - w / 2, y - h / 2, w, h);
                ctx.setLineDash([]);
            } else {
                ctx.fillStyle = '#f97316';
                ctx.fillRect(x - w / 2, y - h / 2, w, h);
                ctx.fillStyle = 'rgba(0,0,0,0.28)';
                ctx.fillRect(x + w / 2 - 8, y - h / 2, 8, h);
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.fillRect(x - w / 2, y - h / 2, w, 4);
                ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
                if (ob.moving) {
                    const dir = Math.cos(tick * ob.freq + ob.phase) >= 0 ? 1 : -1;
                    ctx.fillStyle = 'rgba(255,255,255,0.7)';
                    for (let i = -1; i <= 1; i += 2) {
                        ctx.beginPath();
                        ctx.moveTo(x + i * dir * 4 - 4 * dir, y - 4);
                        ctx.lineTo(x + i * dir * 4, y);
                        ctx.lineTo(x + i * dir * 4 - 4 * dir, y + 4);
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                        ctx.stroke();
                    }
                }
            }
        }
    }

    function drawPickups() {
        for (const pk of pickups) {
            if (pk.taken || Math.abs(pk.s - curS) > 900) continue;
            const bob = Math.sin(tick * 0.06 + pk.s * 0.05) * 3;
            const x = pk.x, y = pk.y + bob;
            ctx.save();
            ctx.shadowBlur = reducedMotion ? 0 : 12;
            if (pk.type === 'energy') {
                ctx.shadowColor = 'rgba(34,211,238,0.9)';
                ctx.translate(x, y);
                ctx.rotate(Math.PI / 4 + tick * 0.03);
                const s = 8 * (1 + 0.1 * Math.sin(tick * 0.1 + pk.s));
                ctx.fillStyle = '#22d3ee';
                ctx.fillRect(-s, -s, s * 2, s * 2);
                ctx.fillStyle = '#e8fbff';
                ctx.fillRect(-s / 2, -s / 2, s, s);
            } else if (pk.type === 'slow') {
                ctx.shadowColor = 'rgba(168,85,249,0.9)';
                ctx.fillStyle = 'rgba(168,85,249,0.9)';
                ctx.beginPath();
                ctx.arc(x, y, 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x, y - 5);
                ctx.moveTo(x, y);
                ctx.lineTo(x + 4, y + 1);
                ctx.stroke();
            } else {
                ctx.shadowColor = 'rgba(74,222,128,0.9)';
                ctx.strokeStyle = '#4ade80';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(x, y, 10 + Math.sin(tick * 0.1) * 1.5, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function drawTrail() {
        if (reducedMotion) return;
        for (let i = trail.length - 1; i >= 0; i--) {
            const t = trail[i];
            const a = (1 - i / trail.length) * 0.25;
            ctx.fillStyle = `rgba(34,211,238,${a})`;
            ctx.beginPath();
            ctx.arc(t.x, t.y, R * (1 - i / trail.length) * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawParticles() {
        for (const p of particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }

    function drawPlayer() {
        if (state === 'dying' || state === 'gameover') return;
        const g = DIRS[gravIdx];
        const velTangent = vx * -g[1] + vy * g[0]; // sideways speed
        const rot = Math.PI / 4 + Math.max(-0.4, Math.min(0.4, velTangent * 0.05));

        ctx.save();
        ctx.translate(px, py);
        if (invuln > 0 && Math.floor(tick / 3) % 2 === 0) ctx.globalAlpha = 0.35;
        ctx.rotate(rot);
        ctx.shadowColor = 'rgba(34,211,238,0.8)';
        ctx.shadowBlur = reducedMotion ? 0 : 14;
        ctx.fillStyle = '#e8fbff';
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(0, -9);
        ctx.lineTo(-12, 0);
        ctx.lineTo(0, 9);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(34,211,238,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // Gravity direction arrow (where "down" currently is)
        const ax0 = px + g[0] * 6, ay0 = py + g[1] * 6;
        const ax1 = px + g[0] * 19, ay1 = py + g[1] * 19;
        const perp = [-g[1], g[0]];
        ctx.strokeStyle = locked ? 'rgba(192,132,252,0.9)' : 'rgba(255,255,255,0.7)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ax0, ay0);
        ctx.lineTo(ax1, ay1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax1 + g[0] * 5, ay1 + g[1] * 5);
        ctx.lineTo(ax1 + perp[0] * 4, ay1 + perp[1] * 4);
        ctx.lineTo(ax1 - perp[0] * 4, ay1 - perp[1] * 4);
        ctx.closePath();
        ctx.fill();

        if (shield) {
            ctx.strokeStyle = `rgba(74,222,128,${0.6 + 0.3 * Math.sin(tick * 0.12)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, 17, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    function drawCompass() {
        const cx = W / 2, cy = 34;
        ctx.strokeStyle = locked ? 'rgba(192,132,252,0.9)' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI * 2);
        ctx.stroke();
        const a = gravAngle * Math.PI / 180;
        const tx = cx + Math.cos(a) * 11, ty = cy + Math.sin(a) * 11;
        const px2 = -Math.sin(a), py2 = Math.cos(a);
        ctx.strokeStyle = locked ? '#c084fc' : '#22d3ee';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tx + Math.cos(a) * 6, ty + Math.sin(a) * 6);
        ctx.lineTo(tx + px2 * 4, ty + py2 * 4);
        ctx.lineTo(tx - px2 * 4, ty - py2 * 4);
        ctx.closePath();
        ctx.fill();
    }

    function drawPips() {
        for (let i = 0; i < ENERGY_MAX; i++) {
            const x = W - 24 - i * 18, y = 34;
            const on = i < energy;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 4);
            if (on) {
                ctx.fillStyle = energyFlash > 0 ? '#f87171' : '#22d3ee';
                ctx.fillRect(-5, -5, 10, 10);
            } else {
                ctx.strokeStyle = 'rgba(255,255,255,0.25)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(-5, -5, 10, 10);
            }
            ctx.restore();
        }
    }

    function drawHUD() {
        drawCompass();
        drawPips();
        if (locked || lockedFlash > 0) {
            ctx.fillStyle = `rgba(192,132,252,${0.5 + 0.4 * Math.sin(tick * 0.25)})`;
            ctx.font = '700 11px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('GRAVITY LOCKED', W / 2, 66);
            if (locked) {
                // Lock decay bar: when it empties, shifting is free again
                const frac = 1 - lockTicks / FIELD_LOCK_TICKS;
                ctx.fillStyle = 'rgba(192,132,252,0.75)';
                ctx.fillRect(W / 2 - 30, 72, 60 * Math.max(0, frac), 3);
            }
        }
        if (slowTicks > 0) {
            const w = 60 * Math.min(1, slowTicks / 170);
            ctx.fillStyle = 'rgba(168,85,249,0.8)';
            ctx.fillRect(W / 2 - 30, 56, w, 3);
        }
        if (mileFlash > 0) {
            ctx.fillStyle = `rgba(34,211,238,${Math.min(1, mileFlash / 40)})`;
            ctx.font = '800 26px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${mileValue} m`, W / 2, H / 2 - 60);
        }
    }

    function drawVignette() {
        if (slowTicks <= 0) return;
        const a = 0.2 * Math.min(1, slowTicks / 40);
        const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
        grad.addColorStop(0, 'rgba(168,85,249,0)');
        grad.addColorStop(1, `rgba(168,85,249,${a})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    function drawReadyHint() {
        const bob = reducedMotion ? 0 : Math.sin(tick * 0.06) * 5;
        ctx.textAlign = 'center';
        ctx.save();
        ctx.shadowColor = 'rgba(34,211,238,0.7)';
        ctx.shadowBlur = reducedMotion ? 0 : 18;
        ctx.fillStyle = '#e8fbff';
        ctx.font = '800 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText('GRAVITY FALLER', W / 2, 120 + bob);
        ctx.restore();
        ctx.fillStyle = 'rgba(244,246,251,0.9)';
        ctx.font = '600 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText('◀ / ▶  aim gravity left / right', W / 2, 170 + bob);
        ctx.fillText('▲ / SPACE  burst against gravity', W / 2, 194 + bob);
        ctx.fillStyle = 'rgba(154,163,181,0.9)';
        ctx.font = '500 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText('Land soft on walls · break glass at speed', W / 2, 226 + bob);
        ctx.fillText('Cross the cyan bridge over void rifts', W / 2, 246 + bob);
        ctx.fillStyle = `rgba(34,211,238,${0.5 + 0.4 * Math.sin(tick * 0.1)})`;
        ctx.font = '700 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText('Any key or tap to start the fall', W / 2, 296 + bob);
    }

    function render() {
        drawBackground();
        ctx.save();
        ctx.translate(W / 2 - camX, H / 2 - camY);
        drawCorridor();
        drawVoids();
        drawFields();
        drawObstacles();
        drawPickups();
        drawTrail();
        drawParticles();
        drawPlayer();
        ctx.restore();
        drawHUD();
        drawVignette();
        if (state === 'ready') drawReadyHint();
    }

    // ---- High scores & modal ----
    function getScores() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    }

    function topScore() {
        const scores = getScores();
        return scores.length ? scores[0].score : 0;
    }

    function saveHighScore(initials, runScore) {
        const scores = getScores();
        scores.push({ initials, score: runScore, date: new Date().toLocaleDateString() });
        scores.sort((a, b) => b.score - a.score);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, 5)));
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    function renderLeaderboard() {
        const scores = getScores();
        if (scores.length === 0) {
            return '<li class="empty">No scores yet — be the first!</li>';
        }
        return scores
            .map((s, i) =>
                `<li><span><span class="rank">${i + 1}.</span><span class="initials">${escapeHtml(s.initials)}</span></span><span class="entry-score">${s.score}</span></li>`
            )
            .join('');
    }

    function setBlur(on) {
        canvas.style.transition = on ? 'filter 0.3s ease' : 'none';
        canvas.style.filter = on ? 'blur(3px)' : 'none';
    }

    function showGameOverModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="gf-modal-title">
                <h2 id="gf-modal-title">The Shaft Claims You</h2>
                <p class="final-score">Score: <strong>${scoreShown}</strong></p>
                <p class="final-detail">Depth ${Math.floor((bestS - startS) / 10)} m · glass bonus +${bonus}</p>
                <ol class="leaderboard" id="gf-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="gf-initials-form" class="initials-form" autocomplete="off">
                    <label for="gf-initials">Your Initials</label>
                    <input id="gf-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="gf-initials-form" id="gf-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="gf-again" class="btn btn-ghost">Play Again</button>
                </div>
            </div>`;
        container.appendChild(overlay);
        modalOverlay = overlay;

        const form = overlay.querySelector('#gf-initials-form');
        const input = overlay.querySelector('#gf-initials');
        const saveBtn = overlay.querySelector('#gf-save');
        let saved = false;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (saved) return;
            saved = true;
            const initials = (input.value.trim().toUpperCase() || '???').slice(0, 3);
            saveHighScore(initials, scoreShown);
            overlay.querySelector('#gf-leaderboard').innerHTML = renderLeaderboard();
            saveBtn.textContent = 'Saved ✓';
            saveBtn.disabled = true;
            input.disabled = true;
        });

        overlay.querySelector('#gf-again').addEventListener('click', () => {
            overlay.remove();
            modalOverlay = null;
            resetGame();
        });

        input.focus();
    }

    // ---- Input ----
    function keyDownHandler(e) {
        if (state === 'gameover') return; // Modal input handles keys now
        let handled = true;
        if (state === 'ready') startPlay();
        switch (e.key) {
            case 'ArrowLeft': case 'a': case 'A':
                if (!e.repeat) setGravity(1);
                break;
            case 'ArrowRight': case 'd': case 'D':
                if (!e.repeat) setGravity(3);
                break;
            case 'ArrowUp': case 'w': case 'W': case ' ':
                if (!e.repeat) burst();
                break;
            case 'ArrowDown': case 's': case 'S':
                if (!e.repeat) setGravity(0);
                break;
            default:
                handled = false;
        }
        if (handled) e.preventDefault();
    }
    window.addEventListener('keydown', keyDownHandler);

    let pStart = null;
    function onPointerDown(e) {
        pStart = { x: e.clientX, y: e.clientY };
        if (e.pointerType === 'touch') e.preventDefault();
    }
    function onPointerUp(e) {
        if (!pStart) return;
        const dx = e.clientX - pStart.x;
        const dy = e.clientY - pStart.y;
        pStart = null;
        if (state === 'gameover') return;
        if (state === 'ready') startPlay();
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
            burst();
            return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
            setGravity(dx > 0 ? 3 : 1);
        } else if (dy > 0) {
            setGravity(0); // swipe down = fall down
        } else {
            burst();       // swipe up = burst
        }
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    function onTouch(e) { e.preventDefault(); }
    canvas.addEventListener('touchstart', onTouch, { passive: false });

    // ---- Lifecycle ----
    function initWorld() {
        segments = [];
        obstacles = [];
        pickups = [];
        voids = [];
        fields = [];
        particles = [];
        trail = [];
        pathLen = 0;
        endPt = { x: 0, y: 0 };
        lastDir = 0;
        segIdx = 0;
        lastPickupS = -400;
        makeStars();

        px = 0; py = 80; vx = 0; vy = 0;
        gravIdx = 0;
        gravAngle = 90;
        energy = 2;
        shield = false;
        slowTicks = 0;
        boost = 0;
        invuln = 0;
        locked = false;
        lockTicks = 0;
        lockedFlash = 0;
        energyFlash = 0;
        mileFlash = 0;
        contact = null;
        startS = 80;
        bestS = 80;
        bonus = 0;
        scoreShown = 0;
        lastMilestone = 0;
        tick = 0;
        lastSlideT = 0;
        curS = 80;
        camX = px;
        camY = py;

        // Long safe intro stretch, then the labyrinth begins
        addSegment(0, 1000);
        lastDir = 0;
        generateAhead(80);
    }

    function frame(t) {
        if (destroyed) return;
        let dt = t - lastT;
        lastT = t;
        if (dt < 0) dt = 0;
        // Clamp keeps single-frame movement under the wall collision band (2R)
        if (dt > 33) dt = 33;
        step(dt);
        render();
        if (state !== 'gameover') animationId = requestAnimationFrame(frame);
    }

    function endRun() {
        state = 'gameover';
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        setBlur(true);
        showGameOverModal();
    }

    function resetGame() {
        setBlur(false);
        initWorld();
        state = 'ready';
        bestRun = topScore();
        scoreDisplay.textContent = `Score: 0 · Best: ${bestRun}`;
        lastT = performance.now();
        if (animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(frame);
    }

    resetGame();

    return {
        destroy: () => {
            destroyed = true;
            if (animationId) cancelAnimationFrame(animationId);
            window.removeEventListener('keydown', keyDownHandler);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('touchstart', onTouch);
            if (modalOverlay) {
                modalOverlay.remove();
                modalOverlay = null;
            }
            audioCtx.close().catch(() => {});
        }
    };
}
