export function init(container) {
    const STORAGE_KEY = 'racer_highscores';

    // ---------- Constants ----------
    const W = 440;
    const H = 560;
    const HORIZON = H * 0.42;        // vanishing line
    const K = H * 0.47;              // px per world unit at z = 1
    const CAM_H = 7.5;               // camera height above the road
    const PLAYER_Z = 8;              // car distance from camera
    const CAR_HW = 1.3;              // car half-width (world units)
    const CAR_Z_NEAR = PLAYER_Z - 1.5; // car rear
    const CAR_Z_FAR = PLAYER_Z + 1.5;  // car front
    const ROAD_W = 6.2;              // road half-width
    const LANE_W = 4;                // lane spacing
    const LANE_X = [-LANE_W, 0, LANE_W];
    const DRAW_Z = 190;              // draw distance
    const Z_NEAR = 6.05;             // road surface meets the canvas bottom
    const BAND_LEN = 4;              // road band length
    const BASE_SPEED = 52;           // units/s
    const MAX_SPEED = 120;
    const RAMP = (MAX_SPEED - BASE_SPEED) / 2500;
    const SHIELDS_MAX = 3;
    const TWEEN_MS = 0.12;

    // ---------- DOM ----------
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'game-canvas';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Neon Glide: a 3D lane-dodging racer. Use the left and right arrow keys, or swipe left and right, to change lanes.');

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Swipe left/right to change lanes · Dodge the neon traffic.';

    container.append(scoreDisplay, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => prefersReducedMotion.matches;

    // ---------- Helpers ----------
    function shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
        if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
        else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function path4to(path, pts) {
        path.moveTo(pts[0][0], pts[0][1]);
        path.lineTo(pts[1][0], pts[1][1]);
        path.lineTo(pts[2][0], pts[2][1]);
        path.lineTo(pts[3][0], pts[3][1]);
        path.closePath();
    }

    // ---------- Audio ----------
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function resumeAudio() {
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }
    function blip(freq, type, dur, vol = 0.08, sweepTo = null) {
        resumeAudio();
        if (audioCtx.state !== 'running') return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        const t0 = audioCtx.currentTime;
        osc.frequency.setValueAtTime(freq, t0);
        if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    // Engine: one long-lived sawtooth through a low-pass, pitch follows speed
    const engineOsc = audioCtx.createOscillator();
    const engineFilter = audioCtx.createBiquadFilter();
    const engineGain = audioCtx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 300;
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOsc.start();
    const gestureResume = () => resumeAudio();
    window.addEventListener('keydown', gestureResume, { once: true });
    window.addEventListener('pointerdown', gestureResume, { once: true });

    // ---------- Backdrop (pre-rendered offscreen) ----------
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = W;
    skyCanvas.height = Math.ceil(HORIZON) + 2;
    (function buildSky() {
        const g = skyCanvas.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, skyCanvas.height);
        grad.addColorStop(0, '#0b0e1a');
        grad.addColorStop(0.55, '#170f2e');
        grad.addColorStop(0.82, '#31194e');
        grad.addColorStop(1, '#4b2168');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, skyCanvas.height);
        const rnd = mulberry32(1337);
        for (let i = 0; i < 70; i++) {
            const x = rnd() * W;
            const y = rnd() * HORIZON * 0.75;
            g.fillStyle = `rgba(255, 255, 255, ${(0.25 + rnd() * 0.5).toFixed(2)})`;
            const s = rnd() < 0.85 ? 1 : 2;
            g.fillRect(x, y, s, s);
        }
    })();

    const SUN_R = 78;
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 300;
    sunCanvas.height = 300;
    (function buildSun() {
        const g = sunCanvas.getContext('2d');
        const cx = 150, cy = 150;
        const halo = g.createRadialGradient(cx, cy, SUN_R * 0.6, cx, cy, SUN_R * 1.85);
        halo.addColorStop(0, 'rgba(244, 114, 182, 0.32)');
        halo.addColorStop(1, 'rgba(244, 114, 182, 0)');
        g.fillStyle = halo;
        g.fillRect(0, 0, 300, 300);
        const disc = g.createLinearGradient(0, cy - SUN_R, 0, cy + SUN_R);
        disc.addColorStop(0, '#fde047');
        disc.addColorStop(0.45, '#fb923c');
        disc.addColorStop(1, '#ec4899');
        g.fillStyle = disc;
        g.beginPath();
        g.arc(cx, cy, SUN_R, 0, Math.PI * 2);
        g.fill();
        // classic scanline notches across the lower half
        for (let i = 0; i < 5; i++) {
            const y = cy + 8 + i * 13;
            const h = 2 + i * 2.2;
            g.clearRect(cx - SUN_R - 4, y, SUN_R * 2 + 8, h);
        }
    })();

    const SKY_H = 64;
    const skylineCanvas = document.createElement('canvas');
    skylineCanvas.width = W * 2; // one pattern duplicated → seamless wrap
    skylineCanvas.height = SKY_H;
    (function buildSkyline() {
        const g = skylineCanvas.getContext('2d');
        const rnd = mulberry32(42);
        const buildings = [];
        let x = 0;
        while (x < W + 60) {
            const bw = 14 + rnd() * 30;
            const bh = 12 + rnd() * 46;
            const windows = [];
            for (let wy = 4; wy < bh - 4; wy += 7) {
                for (let wx = 3; wx < bw - 3; wx += 6) {
                    if (rnd() < 0.16) windows.push([wx, wy]);
                }
            }
            buildings.push({ x, bw, bh, windows });
            x += bw + (rnd() < 0.3 ? 4 : 0);
        }
        function drawAt(dx) {
            for (const b of buildings) {
                g.fillStyle = '#0d0a1c';
                g.fillRect(b.x + dx, SKY_H - b.bh, b.bw, b.bh);
                g.fillStyle = 'rgba(255, 190, 120, 0.75)';
                for (const [wx, wy] of b.windows) {
                    g.fillRect(b.x + dx + wx, SKY_H - b.bh + wy, 2, 3);
                }
            }
        }
        drawAt(0);
        drawAt(W);
    })();

    // Horizon fog (fades the far road into the sky)
    const fogGrad = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 36);
    fogGrad.addColorStop(0, 'rgba(75, 33, 104, 0.85)');
    fogGrad.addColorStop(1, 'rgba(75, 33, 104, 0)');

    // ---------- Obstacle palette ----------
    const OBS = [
        { base: '#fbbf24', light: shade('#fbbf24', 0.3), dark: shade('#fbbf24', -0.4), edge: 'rgba(253, 230, 138, 0.9)' },
        { base: '#fb7185', light: shade('#fb7185', 0.3), dark: shade('#fb7185', -0.4), edge: 'rgba(253, 164, 175, 0.9)' },
        { base: '#f472b6', light: shade('#f472b6', 0.3), dark: shade('#f472b6', -0.4), edge: 'rgba(251, 207, 232, 0.9)' }
    ];
    const PARTICLE_COLORS = ['#fbbf24', '#fb7185', '#f472b6', '#22d3ee', '#e2e8f0'];

    // ---------- State ----------
    let state = 'countdown'; // countdown | running | crashing | over
    let distance = 0;
    let speed = BASE_SPEED;
    let speedPenalty = 1;
    let shields = SHIELDS_MAX;
    let passed = 0;
    let nears = 0;
    let score = 0;
    let bestScore = 0;
    let carLane = 1;
    let carX = 0;
    let camX = 0;
    let bank = 0;
    let tween = null;
    let pendingLane = null;
    let obstacles = []; // { s, cx, hw, d, h, colorIdx, passed, hit } sorted by s (nearest first)
    let particles = [];
    let floaters = [];
    let nextSpawnS = 70;
    let countdownT = 3;
    let goT = 0;
    let crashT = 0;
    let invuln = 0;
    let flash = 0;
    let shakeMag = 0;
    let shakeDur = 0.2;
    let shakeT = 1;
    let warpIntensity = 0;
    let lastScoreShown = -1;
    let destroyed = false;
    let overlayOpen = false;
    let rafId = null;
    let lastNow = 0;

    // Warp streaks (radial lines from the vanishing point)
    const streaks = [];
    (function () {
        const rnd = mulberry32(7);
        for (let i = 0; i < 22; i++) {
            streaks.push({
                ang: Math.PI / 2 + (rnd() - 0.5) * 2.26,
                r: 40 + rnd() * 300,
                len: 30 + rnd() * 90
            });
        }
    })();

    // ---------- Projection ----------
    function px(wx, z) { return W / 2 + (wx - camX) * K / z; }
    function py(z) { return HORIZON + CAM_H * K / z; }
    function pyw(z, h) { return HORIZON + (CAM_H - h) * K / z; }

    // ---------- Particles ----------
    function spawnShards(x, y, colorIdx, n) {
        if (reduced()) return;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 60 + Math.random() * 340;
            particles.push({
                x, y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v - 120,
                g: 760,
                life: 1,
                decay: 1 / (0.4 + Math.random() * 0.45),
                size: 2 + Math.random() * 3.5,
                c: colorIdx
            });
        }
        if (particles.length > 160) particles.splice(0, particles.length - 160);
    }

    function spawnSparks(x, y) {
        if (reduced()) return;
        for (let i = 0; i < 7; i++) {
            particles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 160,
                vy: -60 - Math.random() * 140,
                g: 300,
                life: 1,
                decay: 1 / (0.25 + Math.random() * 0.2),
                size: 1.5 + Math.random() * 1.5,
                c: Math.random() < 0.5 ? 3 : 4
            });
        }
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

    function drawParticles() {
        for (const p of particles) {
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
            ctx.fillStyle = PARTICLE_COLORS[p.c];
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }

    // ---------- Spawning ----------
    function tierPool() {
        const d = distance;
        if (d < 300) return ['barrier', 'barrier', 'blocker'];
        if (d < 800) return ['barrier', 'blocker', 'pillar', 'slalom'];
        if (d < 1500) return ['barrier', 'blocker', 'pillar', 'slalom', 'stagger'];
        return ['blocker', 'pillar', 'slalom', 'slalom', 'stagger', 'stagger'];
    }

    function addBox(s, cx, hw, d, h, colorIdx) {
        obstacles.push({ s, cx, hw, d, h, colorIdx, passed: false, hit: false });
    }

    function nextLane(l, dir) {
        let nl = l + dir;
        if (nl < 0 || nl > 2) nl = l - dir;
        return nl;
    }

    function spawnPattern(s) {
        const pool = tierPool();
        const type = pool[(Math.random() * pool.length) | 0];
        if (type === 'barrier') {
            addBox(s, LANE_X[(Math.random() * 3) | 0], 1.7, 1.6, 1.5, 0);
            return 1.6;
        }
        if (type === 'blocker') {
            addBox(s, Math.random() < 0.5 ? -2 : 2, 4.0, 1.8, 2.2, 1);
            return 1.8;
        }
        if (type === 'pillar') {
            const free = (Math.random() * 3) | 0;
            for (let i = 0; i < 3; i++) {
                if (i !== free) addBox(s, LANE_X[i], 0.8, 1.2, 3.2, 2);
            }
            return 1.2;
        }
        // slalom / stagger: three single-lane barriers staggered in z
        const step = Math.max(12, speed * 0.5);
        const a = (Math.random() * 3) | 0;
        let lanes;
        if (type === 'stagger') {
            const b = (a + (Math.random() < 0.5 ? 1 : 2)) % 3;
            lanes = [a, b, a];
        } else {
            const dir = Math.random() < 0.5 ? 1 : -1;
            lanes = [a, nextLane(a, dir), nextLane(nextLane(a, dir), dir)];
        }
        for (let i = 0; i < 3; i++) {
            addBox(s + i * step, LANE_X[lanes[i]], 1.7, 1.6, 1.5, 0);
        }
        return 2 * step + 1.6;
    }

    // ---------- Game flow ----------
    function startShake(mag, dur) {
        if (reduced()) return;
        shakeMag = mag;
        shakeDur = dur;
        shakeT = 0;
    }

    function hitObstacle(ob) {
        ob.hit = true;
        const zc = ob.s - distance + ob.d / 2;
        spawnShards(px(ob.cx, zc), pyw(zc, ob.h / 2), ob.colorIdx, 16);
        shields--;
        if (shields <= 0) {
            state = 'crashing';
            crashT = 0;
            flash = 1;
            startShake(9, 0.5);
            spawnShards(px(carX, PLAYER_Z), pyw(PLAYER_Z, 0.8), 4, 26);
            blip(220, 'sawtooth', 0.6, 0.1, 45);
        } else {
            invuln = 1.2;
            speedPenalty = 0.72;
            flash = 1;
            startShake(6, 0.22);
            blip(110, 'sine', 0.25, 0.12, 55);
            blip(70, 'square', 0.3, 0.06, 40);
        }
    }

    function checkCollisions() {
        for (const ob of obstacles) {
            if (ob.hit) continue;
            const z = ob.s - distance;
            if (z < 2) continue;
            const zFar = z + ob.d;
            if (zFar > CAR_Z_NEAR && z < CAR_Z_FAR &&
                Math.abs(carX - ob.cx) < CAR_HW + ob.hw &&
                invuln <= 0) {
                hitObstacle(ob);
                if (state !== 'running') return;
                continue;
            }
            if (!ob.passed && zFar <= CAR_Z_NEAR) {
                ob.passed = true;
                passed++;
                const gap = Math.abs(carX - ob.cx) - (CAR_HW + ob.hw);
                if (gap >= 0 && gap < 1.0 && speed > MAX_SPEED * 0.55) {
                    nears++;
                    const zc = ob.s - distance;
                    const sx = px(ob.cx, zc);
                    const sy = pyw(zc, ob.h * 0.6);
                    spawnSparks(sx, sy);
                    floaters.push({ x: sx, y: sy - 12, text: '+5', t: 0 });
                    blip(880, 'triangle', 0.1, 0.05, 1560);
                }
            }
        }
    }

    function gameOver() {
        canvas.style.transition = 'filter 0.3s ease';
        canvas.style.filter = 'blur(3px)';
        showGameOverModal('Game Over');
    }

    // ---------- High scores & modal (shared pattern) ----------
    function getScores() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    }

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
        if (scores.length === 0) {
            return '<li class="empty">No scores yet — be the first!</li>';
        }
        return scores
            .map((s, i) =>
                `<li><span><span class="rank">${i + 1}.</span><span class="initials">${escapeHtml(s.initials)}</span></span><span class="entry-score">${s.score}</span></li>`
            )
            .join('');
    }

    function showGameOverModal(headline) {
        overlayOpen = true;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="racer-modal-title">
                <h2 id="racer-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${Math.floor(score)}</strong></p>
                <ol class="leaderboard" id="racer-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="racer-initials-form" class="initials-form" autocomplete="off">
                    <label for="racer-initials">Your Initials</label>
                    <input id="racer-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="racer-initials-form" id="racer-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="racer-again" class="btn btn-ghost">Play Again</button>
                </div>
            </div>`;
        container.appendChild(overlay);

        const form = overlay.querySelector('#racer-initials-form');
        const input = overlay.querySelector('#racer-initials');
        const saveBtn = overlay.querySelector('#racer-save');
        let saved = false;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (saved) return;
            saved = true;
            const initials = (input.value.trim().toUpperCase() || '???').slice(0, 3);
            saveHighScore(initials, Math.floor(score));
            overlay.querySelector('#racer-leaderboard').innerHTML = renderLeaderboard();
            saveBtn.textContent = 'Saved ✓';
            saveBtn.disabled = true;
            input.disabled = true;
        });

        overlay.querySelector('#racer-again').addEventListener('click', () => {
            overlay.remove();
            overlayOpen = false;
            resetRun();
        });

        input.focus();
    }

    // ---------- Lane control ----------
    function startTween(lane) {
        tween = { from: carX, to: LANE_X[lane], lane, t: 0, dur: reduced() ? 0.08 : TWEEN_MS };
        blip(300, 'triangle', 0.06, 0.03, 180);
    }

    function laneChange(dir) {
        if (destroyed || state === 'crashing' || state === 'over') return;
        const current = tween ? tween.lane : carLane;
        const want = current + dir;
        if (want < 0 || want > 2) return;
        if (tween) {
            pendingLane = want;
            return;
        }
        startTween(want);
    }

    // ---------- Update ----------
    function update(dt) {
        if (destroyed) return;

        if (state === 'countdown') {
            const prev = Math.ceil(countdownT);
            countdownT -= dt;
            const cur = Math.ceil(countdownT);
            if (cur !== prev && cur > 0) blip(440, 'square', 0.09);
            if (countdownT <= 0) {
                state = 'running';
                goT = 0.7;
                blip(880, 'square', 0.22);
            }
        } else if (state === 'running') {
            goT = Math.max(0, goT - dt);
            invuln = Math.max(0, invuln - dt);
            speedPenalty += (1 - speedPenalty) * Math.min(1, dt * 0.8);
            speed = Math.min(MAX_SPEED, BASE_SPEED + distance * RAMP) * speedPenalty;
            distance += speed * dt;
            score = distance + passed * 25 + nears * 5;

            while (nextSpawnS < distance + DRAW_Z - 10) {
                const span = spawnPattern(nextSpawnS);
                nextSpawnS += span + Math.max(30, speed * 0.8);
            }

            checkCollisions();
            while (obstacles.length && obstacles[0].s - distance < 2) obstacles.shift();
        } else if (state === 'crashing') {
            crashT += dt;
            const ts = crashT < 0.7 ? 0.35 : 0; // slow-mo, then freeze
            distance += speed * dt * ts;
            speed = Math.max(0, speed - speed * dt * ts * 0.4);
            if (crashT >= 0.95) {
                state = 'over';
                gameOver();
            }
        }

        // Lane tween (allowed during the countdown so you can pre-position)
        if (tween && (state === 'running' || state === 'countdown')) {
            tween.t += dt;
            if (tween.t >= tween.dur) {
                carLane = tween.lane;
                carX = LANE_X[carLane];
                tween = null;
                bank = 0;
                if (pendingLane !== null) {
                    const p = pendingLane;
                    pendingLane = null;
                    startTween(p);
                }
            } else {
                const e = easeOutCubic(tween.t / tween.dur);
                carX = tween.from + (tween.to - tween.from) * e;
                bank = (tween.to > tween.from ? 1 : -1) * (1 - e);
            }
        }

        // Camera lags behind the car (the road swings under a near-centre car)
        camX += (carX * 0.7 - camX) * Math.min(1, dt * 7);

        // Warp streaks
        warpIntensity = Math.max(0, Math.min(1, (speed - MAX_SPEED * 0.7) / (MAX_SPEED * 0.3)));
        if (warpIntensity > 0.02 && !reduced() && state === 'running') {
            for (const st of streaks) {
                st.r += (140 + speed * 2.6) * dt * (0.4 + warpIntensity);
                if (st.r > 900) {
                    st.r = 30 + Math.random() * 80;
                    st.ang = Math.PI / 2 + (Math.random() - 0.5) * 2.26;
                }
            }
        }

        // Effects decay
        shakeT += dt;
        flash = Math.max(0, flash - dt / 0.35);
        updateParticles(dt);
        for (let i = floaters.length - 1; i >= 0; i--) {
            floaters[i].t += dt;
            if (floaters[i].t >= 0.6) floaters.splice(i, 1);
        }

        // Engine follows speed
        const eg = state === 'running' ? 0.03 : state === 'crashing' ? 0.015 : state === 'countdown' ? 0.012 : 0;
        engineGain.gain.setTargetAtTime(eg, audioCtx.currentTime, 0.12);
        engineOsc.frequency.setTargetAtTime(55 + speed * 1.05, audioCtx.currentTime, 0.1);
        engineFilter.frequency.setTargetAtTime(240 + speed * 7, audioCtx.currentTime, 0.1);

        // Score readout (above the canvas)
        const s = Math.floor(score);
        if (s !== lastScoreShown) {
            lastScoreShown = s;
            scoreDisplay.textContent = `Score: ${s}`;
        }
    }

    // ---------- Rendering ----------
    function drawSky(t) {
        ctx.drawImage(skyCanvas, 0, 0);
        const sunX = W / 2 - camX * 8;
        const sunY = HORIZON - 60 + (reduced() ? 0 : Math.sin(t * 0.6) * 2.5);
        ctx.drawImage(sunCanvas, sunX - 150, sunY - 150);
        // Static skyline; only camera-x parallax (a straight road has no time scroll)
        const x0 = (((-camX * 5) % W) + W) % W - W;
        ctx.drawImage(skylineCanvas, x0, HORIZON - SKY_H);
    }

    function roadQuad(xL, xR, z1, z2) {
        path4to(ctx, [
            [px(xL, z1), py(z1)],
            [px(xR, z1), py(z1)],
            [px(xR, z2), py(z2)],
            [px(xL, z2), py(z2)]
        ]);
    }

    function drawRoad() {
        // Base
        ctx.fillStyle = '#0e0e1e';
        ctx.beginPath();
        roadQuad(-ROAD_W, ROAD_W, Z_NEAR, DRAW_Z);
        ctx.fill();
        // Bright bands scroll toward the camera
        ctx.fillStyle = '#171730';
        ctx.beginPath();
        let s = Math.ceil((distance + Z_NEAR) / BAND_LEN) * BAND_LEN;
        while (s < distance + DRAW_Z) {
            if (Math.floor(s / BAND_LEN) % 2 === 1) {
                const z1 = Math.max(s - distance, Z_NEAR);
                const z2 = Math.min(s + BAND_LEN - distance, DRAW_Z);
                if (z2 > z1) roadQuad(-ROAD_W, ROAD_W, z1, z2);
            }
            s += BAND_LEN;
        }
        ctx.fill();
        // Edge lines: soft glow + bright core
        ctx.fillStyle = 'rgba(34, 211, 238, 0.22)';
        ctx.beginPath();
        roadQuad(-ROAD_W - 0.6, -ROAD_W + 0.6, Z_NEAR, DRAW_Z);
        roadQuad(ROAD_W - 0.6, ROAD_W + 0.6, Z_NEAR, DRAW_Z);
        ctx.fill();
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        roadQuad(-ROAD_W - 0.2, -ROAD_W + 0.2, Z_NEAR, DRAW_Z);
        roadQuad(ROAD_W - 0.2, ROAD_W + 0.2, Z_NEAR, DRAW_Z);
        ctx.fill();
        // Lane dashes (magenta, 3 on / 3 off)
        ctx.fillStyle = 'rgba(244, 114, 182, 0.8)';
        ctx.beginPath();
        let d = Math.ceil((distance + Z_NEAR) / 6) * 6;
        while (d < distance + DRAW_Z) {
            if (Math.floor(d / 3) % 2 === 0) {
                const z1 = Math.max(d - distance, Z_NEAR);
                const z2 = Math.min(d + 3 - distance, DRAW_Z);
                if (z2 > z1) {
                    roadQuad(2 - 0.07, 2 + 0.07, z1, z2);
                    roadQuad(-2 - 0.07, -2 + 0.07, z1, z2);
                }
            }
            d += 6;
        }
        ctx.fill();
    }

    function drawProps() {
        // Neon pylons every 8 units, alternating side and colour
        let s = Math.ceil((distance + Z_NEAR) / 8) * 8;
        while (s < distance + DRAW_Z) {
            const z = s - distance;
            if (z > 3 && z < DRAW_Z) {
                const idx = Math.round(s / 8);
                const side = Math.floor(idx / 2) % 2 === 0 ? -1 : 1;
                const isCyan = idx % 2 === 0;
                const X = side * (ROAD_W + 2.6);
                const w = 0.16 * K / z;
                const yTop = pyw(z, 2.4);
                const yBot = py(z);
                const fade = Math.min(1, (DRAW_Z - z) / 60);
                ctx.globalAlpha = fade;
                ctx.fillStyle = isCyan ? '#22d3ee' : '#f472b6';
                ctx.fillRect(px(X, z) - w / 2, yTop, w, yBot - yTop);
                ctx.fillStyle = isCyan ? '#a5f3fc' : '#fbcfe8';
                ctx.fillRect(px(X, z) - w, pyw(z, 2.75), w * 2, pyw(z, 2.4) - pyw(z, 2.75));
                ctx.globalAlpha = 1;
            }
            s += 8;
        }
        // Landmark arch every 120 units
        const sArch = Math.ceil((distance + Z_NEAR) / 120) * 120;
        if (sArch < distance + DRAW_Z) {
            const z = sArch - distance;
            const fade = Math.min(1, (DRAW_Z - z) / 60);
            ctx.globalAlpha = fade;
            const yTop = pyw(z, 3.0);
            const yBot = py(z);
            ctx.fillStyle = '#a21caf';
            for (const side of [-1, 1]) {
                const X = side * 7.0;
                ctx.fillRect(px(X - 0.2, z), yTop, 0.4 * K / z, yBot - yTop);
            }
            const byTop = pyw(z, 3.32);
            const byBot = pyw(z, 3.0);
            const xL = px(-7.2, z);
            const xR = px(7.2, z);
            ctx.fillStyle = '#f472b6';
            ctx.fillRect(xL, byTop, xR - xL, byBot - byTop);
            const yM = pyw(z, 3.18);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.fillRect(xL, yM, xR - xL, Math.max(1, (byBot - byTop) * 0.3));
            ctx.globalAlpha = 1;
        }
    }

    function drawObstacles() {
        // Array is nearest-first; iterate far → near for correct layering
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const ob = obstacles[i];
            if (ob.hit) continue;
            const z = ob.s - distance;
            if (z < 2.5 || z > DRAW_Z) continue;
            const z1 = z;
            const z2 = z + ob.d;
            const nLx = px(ob.cx - ob.hw, z1);
            const nRx = px(ob.cx + ob.hw, z1);
            const fLx = px(ob.cx - ob.hw, z2);
            const fRx = px(ob.cx + ob.hw, z2);
            const yB1 = py(z1);
            const yT1 = pyw(z1, ob.h);
            const yB2 = py(z2);
            const yT2 = pyw(z2, ob.h);
            const pal = OBS[ob.colorIdx];
            ctx.globalAlpha = Math.min(1, (DRAW_Z - z) / 70);
            // Side face (the one facing the camera)
            if (camX < ob.cx) {
                ctx.fillStyle = pal.dark;
                ctx.beginPath();
                path4to(ctx, [[nRx, yT1], [fRx, yT2], [fRx, yB2], [nRx, yB1]]);
                ctx.fill();
            } else if (camX > ob.cx) {
                ctx.fillStyle = pal.dark;
                ctx.beginPath();
                path4to(ctx, [[nLx, yT1], [fLx, yT2], [fLx, yB2], [nLx, yB1]]);
                ctx.fill();
            }
            // Near face (axis-aligned at fixed z)
            ctx.fillStyle = pal.base;
            ctx.fillRect(nLx, yT1, nRx - nLx, yB1 - yT1);
            // Top face + neon edge
            ctx.fillStyle = pal.light;
            ctx.beginPath();
            path4to(ctx, [[nLx, yT1], [nRx, yT1], [fRx, yT2], [fLx, yT2]]);
            ctx.fill();
            ctx.strokeStyle = pal.edge;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    function drawFog() {
        ctx.fillStyle = fogGrad;
        ctx.fillRect(0, HORIZON, W, 36);
    }

    function drawCar(t) {
        const bob = reduced() ? 0 : Math.sin(t * 24) * 0.05;
        let bounce = 0;
        if (state === 'crashing' && !reduced()) {
            const c = Math.min(1, crashT / 0.7);
            bounce = Math.sin(c * 9) * 7 * (1 - c);
        }
        const spin = (state === 'crashing' || state === 'over') ? Math.min(1, crashT / 0.7) * 2.4 : 0;
        const roll = bank * 0.35 + (spin > 0 && !reduced() ? spin : 0);
        const x = carX;
        const zR = CAR_Z_NEAR;
        const zF = CAR_Z_FAR;
        const yR = py(zR);
        const flicker = (invuln > 0 && state === 'running' && Math.floor(invuln * 12) % 2 === 0) ? 0.35 : 1;

        ctx.save();
        ctx.globalAlpha = flicker;
        ctx.translate(0, -bounce);

        // Shadow + neon underglow
        const cxm = px(x, PLAYER_Z);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.ellipse(cxm, yR + 1.5, 1.75 * K / PLAYER_Z, 0.4 * K / PLAYER_Z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(34, 211, 238, 0.3)';
        ctx.beginPath();
        ctx.ellipse(cxm, yR - 1, 1.9 * K / PLAYER_Z, 0.3 * K / PLAYER_Z, 0, 0, Math.PI * 2);
        ctx.fill();

        const ts = roll * 0.55; // bank shifts the car's upper body

        // Body top (rear shoulder → front shoulder)
        ctx.fillStyle = '#8b9df6';
        ctx.beginPath();
        path4to(ctx, [
            [px(x - 1.3 + ts, zR), pyw(zR, 1.0 + bob)],
            [px(x + 1.3 + ts, zR), pyw(zR, 1.0 + bob)],
            [px(x + 0.95 + ts * 0.8, zF), pyw(zF, 1.0 + bob)],
            [px(x - 0.95 + ts * 0.8, zF), pyw(zF, 1.0 + bob)]
        ]);
        ctx.fill();

        // Cabin roof
        ctx.fillStyle = '#dbe4ff';
        ctx.beginPath();
        path4to(ctx, [
            [px(x - 0.8 + ts, zR + 0.8), pyw(zR + 0.8, 1.7 + bob)],
            [px(x + 0.8 + ts, zR + 0.8), pyw(zR + 0.8, 1.7 + bob)],
            [px(x + 0.62 + ts, zF - 0.7), pyw(zF - 0.7, 1.7 + bob)],
            [px(x - 0.62 + ts, zF - 0.7), pyw(zF - 0.7, 1.7 + bob)]
        ]);
        ctx.fill();

        // Windshield (cabin rear face)
        const wZ = zR + 0.8;
        const wx1 = px(x - 0.8 + ts, wZ);
        const wx2 = px(x + 0.8 + ts, wZ);
        const wyTop = pyw(wZ, 1.7 + bob);
        const wyBot = pyw(wZ, 1.0 + bob);
        ctx.fillStyle = '#0e1a38';
        ctx.fillRect(wx1, wyTop, wx2 - wx1, wyBot - wyTop);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.3)';
        ctx.fillRect(wx1, wyTop, wx2 - wx1, (wyBot - wyTop) * 0.4);

        // Body rear face
        const rx1 = px(x - 1.35, zR);
        const rx2 = px(x + 1.35, zR);
        const ryTop = pyw(zR, 1.0 + bob);
        const grad = ctx.createLinearGradient(0, ryTop, 0, yR);
        grad.addColorStop(0, '#b9c6ff');
        grad.addColorStop(1, '#6475ec');
        ctx.fillStyle = grad;
        ctx.fillRect(rx1, ryTop, rx2 - rx1, yR - ryTop);

        // Taillight bar + glow
        const tl1 = px(x - 1.15, zR);
        const tl2 = px(x + 1.15, zR);
        const ty1 = pyw(zR, 0.74 + bob);
        const ty2 = pyw(zR, 0.46 + bob);
        ctx.fillStyle = 'rgba(251, 113, 133, 0.35)';
        ctx.fillRect(tl1 - 2, ty1 - 2, tl2 - tl1 + 4, ty2 - ty1 + 4);
        ctx.fillStyle = '#fb7185';
        ctx.fillRect(tl1, ty1, tl2 - tl1, ty2 - ty1);

        ctx.restore();
    }

    function drawWarp() {
        if (warpIntensity <= 0.02 || reduced()) return;
        ctx.strokeStyle = `rgba(165, 243, 252, ${(0.05 + 0.22 * warpIntensity).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const vx = W / 2 - camX * K / PLAYER_Z;
        const vy = HORIZON;
        for (const st of streaks) {
            const x1 = vx + Math.cos(st.ang) * st.r;
            const y1 = vy + Math.sin(st.ang) * st.r;
            if (y1 < HORIZON + 6) continue;
            const r2 = st.r + st.len * (0.3 + warpIntensity);
            ctx.moveTo(x1, y1);
            ctx.lineTo(vx + Math.cos(st.ang) * r2, vy + Math.sin(st.ang) * r2);
        }
        ctx.stroke();
    }

    function drawHUD() {
        ctx.textBaseline = 'top';
        // Score
        ctx.font = '700 30px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(11, 14, 26, 0.85)';
        const scoreText = String(Math.floor(score));
        ctx.strokeText(scoreText, 14, 12);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(scoreText, 14, 12);
        ctx.font = '600 14px system-ui, -apple-system, sans-serif';
        ctx.lineWidth = 3;
        ctx.fillStyle = '#a5b4fc';
        ctx.strokeText(`${Math.round(speed * 2.2)} km/h`, 14, 48);
        ctx.fillText(`${Math.round(speed * 2.2)} km/h`, 14, 48);
        ctx.fillStyle = '#c4b5fd';
        ctx.strokeText(`${Math.floor(distance)} m`, 14, 68);
        ctx.fillText(`${Math.floor(distance)} m`, 14, 68);
        // Best
        ctx.textAlign = 'right';
        ctx.lineWidth = 0;
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(233, 213, 255, 0.65)';
        ctx.fillText('B E S T', W - 14, 12);
        ctx.font = '700 20px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#e9d5ff';
        ctx.fillText(String(bestScore), W - 14, 27);
        // Shields
        for (let i = 0; i < SHIELDS_MAX; i++) {
            const x = W - 26 - i * 24;
            const y = 58;
            ctx.globalAlpha = i < shields ? 1 : 0.15;
            ctx.fillStyle = '#22d3ee';
            ctx.beginPath();
            ctx.moveTo(x - 8, y + 10);
            ctx.lineTo(x, y);
            ctx.lineTo(x + 8, y + 10);
            ctx.lineTo(x + 4, y + 10);
            ctx.lineTo(x, y + 4.5);
            ctx.lineTo(x - 4, y + 10);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    function drawFloaters() {
        if (!floaters.length) return;
        ctx.font = '700 16px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(11, 14, 26, 0.8)';
        for (const f of floaters) {
            ctx.globalAlpha = Math.max(0, 1 - f.t / 0.6);
            ctx.strokeText(f.text, f.x, f.y - f.t * 44);
            ctx.fillStyle = '#a5f3fc';
            ctx.fillText(f.text, f.x, f.y - f.t * 44);
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 0;
    }

    function drawCountdown() {
        const n = Math.max(1, Math.ceil(countdownT));
        const frac = countdownT - Math.floor(countdownT);
        const progress = Math.min(1, 1 - frac);
        const scale = reduced() ? 1 : 1.35 - 0.35 * easeOutCubic(progress);
        ctx.save();
        ctx.translate(W / 2, H * 0.34);
        ctx.scale(scale, scale);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 84px system-ui, -apple-system, sans-serif';
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(244, 114, 182, 0.9)';
        ctx.strokeText(String(n), 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(n), 0, 0);
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '600 13px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(233, 213, 255, 0.75)';
        ctx.fillText('G E T   R E A D Y', W / 2, H * 0.34 - 78);
        ctx.font = '500 12px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(233, 213, 255, 0.5)';
        ctx.fillText('← → or swipe to steer', W / 2, H - 34);
    }

    function drawGo() {
        ctx.save();
        ctx.globalAlpha = Math.min(1, goT / 0.35);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 58px system-ui, -apple-system, sans-serif';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(20, 83, 45, 0.9)';
        ctx.strokeText('GO!', W / 2, H * 0.34);
        ctx.fillStyle = '#4ade80';
        ctx.fillText('GO!', W / 2, H * 0.34);
        ctx.restore();
    }

    function render(t) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0b0e1a';
        ctx.fillRect(0, 0, W, H);

        // Screen shake
        let ox = 0, oy = 0;
        if (!reduced() && shakeMag > 0 && shakeT < shakeDur) {
            const f = 1 - shakeT / shakeDur;
            ox = (Math.random() * 2 - 1) * shakeMag * f;
            oy = (Math.random() * 2 - 1) * shakeMag * f;
        }
        ctx.save();
        ctx.translate(ox, oy);
        drawSky(t);
        drawRoad();
        drawProps();
        drawObstacles();
        drawFog();
        drawCar(t);
        drawParticles();
        drawWarp();
        ctx.restore();

        // Hit flash (not shaken)
        if (flash > 0 && !reduced()) {
            ctx.fillStyle = `rgba(244, 63, 94, ${(flash * 0.26).toFixed(3)})`;
            ctx.fillRect(0, 0, W, H);
        }

        drawHUD();
        drawFloaters();
        if (state === 'countdown') drawCountdown();
        if (goT > 0 && state === 'running') drawGo();
    }

    // Fixed 60 Hz logic step decoupled from the render loop (PRD §4).
    // Frame-rate independent: a slow or backgrounded tab still simulates at
    // full speed in bounded chunks (max 15 catch-up steps), with no physics tunneling.
    const STEP = 1 / 60;
    let acc = 0;

    function frame(now) {
        if (destroyed) return;
        rafId = requestAnimationFrame(frame);
        let dt = (now - lastNow) / 1000;
        lastNow = now;
        if (!(dt > 0)) dt = 0;
        if (dt > 0.25) dt = 0.25; // clamp background-tab gaps
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 15) {
            update(STEP);
            acc -= STEP;
            steps++;
        }
        if (steps === 15) acc = 0; // drop the backlog if still behind
        render(now / 1000);
    }

    // ---------- Input ----------
    function keyDownHandler(e) {
        if (destroyed) return;
        if (state === 'over') {
            if (!overlayOpen && (e.code === 'Space' || e.code === 'Enter')) {
                e.preventDefault();
                resetRun();
            }
            return;
        }
        switch (e.key) {
            case 'ArrowLeft': case 'a': case 'A':
                e.preventDefault();
                laneChange(-1);
                break;
            case 'ArrowRight': case 'd': case 'D':
                e.preventDefault();
                laneChange(1);
                break;
        }
    }
    window.addEventListener('keydown', keyDownHandler);

    // Touch: swipe left/right (ratchets one lane per 26 px of horizontal drag)
    let touching = false;
    let lastTX = 0;
    function touchStartHandler(e) {
        if (destroyed || state === 'over' || state === 'crashing') return;
        e.preventDefault();
        resumeAudio();
        touching = true;
        lastTX = e.touches[0].clientX;
    }
    function touchMoveHandler(e) {
        if (!touching || destroyed || state === 'over' || state === 'crashing') return;
        e.preventDefault();
        const x = e.touches[0].clientX;
        const dx = x - lastTX;
        if (Math.abs(dx) >= 26) {
            laneChange(dx > 0 ? 1 : -1);
            lastTX = x;
        }
    }
    function touchEndHandler(e) {
        if (!touching) return;
        e.preventDefault();
        touching = false;
    }
    canvas.addEventListener('touchstart', touchStartHandler, { passive: false });
    canvas.addEventListener('touchmove', touchMoveHandler, { passive: false });
    canvas.addEventListener('touchend', touchEndHandler, { passive: false });

    // Block page scroll / pull-to-refresh while playing
    function pageTouchMoveHandler(e) {
        if (destroyed) return;
        if (e.target instanceof Element && e.target.closest('#game-container')) {
            e.preventDefault();
        }
    }
    document.addEventListener('touchmove', pageTouchMoveHandler, { passive: false });

    // ---------- Lifecycle ----------
    function resetRun() {
        distance = 0;
        speed = BASE_SPEED;
        speedPenalty = 1;
        shields = SHIELDS_MAX;
        passed = 0;
        nears = 0;
        score = 0;
        obstacles.length = 0;
        particles.length = 0;
        floaters.length = 0;
        nextSpawnS = 70;
        carLane = 1;
        carX = 0;
        camX = 0;
        bank = 0;
        tween = null;
        pendingLane = null;
        state = 'countdown';
        countdownT = 3;
        goT = 0;
        crashT = 0;
        invuln = 0;
        flash = 0;
        shakeMag = 0;
        shakeT = 1;
        warpIntensity = 0;
        lastScoreShown = -1;
        canvas.style.filter = 'none';
        scoreDisplay.textContent = 'Score: 0';
        resumeAudio();
    }

    bestScore = getScores()[0] ? getScores()[0].score : 0;
    resetRun();
    rafId = requestAnimationFrame(frame);

    return {
        destroy: () => {
            destroyed = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener('keydown', keyDownHandler);
            window.removeEventListener('keydown', gestureResume);
            window.removeEventListener('pointerdown', gestureResume);
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchmove', touchMoveHandler);
            canvas.removeEventListener('touchend', touchEndHandler);
            document.removeEventListener('touchmove', pageTouchMoveHandler);
            try { engineOsc.stop(); } catch (e) { /* already stopped */ }
            try { audioCtx.close(); } catch (e) { /* already closed */ }
        }
    };
}
