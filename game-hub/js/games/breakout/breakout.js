export function init(container) {
    const STORAGE_KEY = 'breakout_highscores';
    const MUTE_KEY = 'breakout_muted';

    // Create Game Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    canvas.className = 'game-canvas';

    // Create UI Elements (score + mute toggle on one row above the canvas)
    const hudRow = document.createElement('div');
    hudRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.style.marginBottom = '0';
    scoreDisplay.textContent = 'Score: 0';

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'btn btn-ghost';
    muteBtn.style.padding = '0.2rem 0.55rem';
    muteBtn.style.fontSize = '1rem';
    muteBtn.style.lineHeight = '1.3';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Drag across the court to move the paddle. Tap to launch and catch falling power-ups.';

    hudRow.append(scoreDisplay, muteBtn);
    container.append(hudRow, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Audio Context for sound effects and background music
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let muted = localStorage.getItem(MUTE_KEY) === '1';

    // Music has its own gain bus so muting never clips live SFX
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = muted ? 0 : 1;
    musicGain.connect(audioCtx.destination);

    function playSound(freq, type, duration) {
        if (muted) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }

    function refreshMuteButton() {
        muteBtn.textContent = muted ? '🔇' : '🔊';
        muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
        muteBtn.setAttribute('aria-pressed', String(muted));
    }
    refreshMuteButton();

    muteBtn.addEventListener('click', () => {
        muted = !muted;
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        musicGain.gain.value = muted ? 0 : 1;
        refreshMuteButton();
    });

    // ---------------- Background music (synth chiptune, no audio files) ----------------
    // 4-bar loop: triangle bass on the roots (Am–F–C–G) + square-wave arpeggio,
    // scheduled ahead of audioCtx.currentTime from the rAF loop (no extra timers).
    const MUSIC = {
        bpm: 112,
        bass: [110.0, 87.31, 130.81, 98.0], // A2 F2 C3 G2
        arps: [
            [440.0, 523.25, 659.25, 523.25, 440.0, 659.25, 523.25, 880.0], // Am
            [349.23, 440.0, 523.25, 440.0, 349.23, 523.25, 440.0, 698.46], // F
            [523.25, 659.25, 783.99, 659.25, 523.25, 783.99, 659.25, 1046.5], // C
            [392.0, 493.88, 587.33, 493.88, 392.0, 587.33, 493.88, 784.0], // G
        ]
    };
    const EIGHTH = 60 / MUSIC.bpm / 2;
    let musicStarted = false;
    let nextNoteTime = 0;
    let musicStep = 0;

    function startMusic() {
        if (musicStarted) return;
        musicStarted = true;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        nextNoteTime = audioCtx.currentTime + 0.1;
    }

    // Browser autoplay policy: only a real gesture may unlock audio. One-shot listeners.
    function gestureStartMusic() {
        startMusic();
        document.removeEventListener('pointerdown', gestureStartMusic);
        document.removeEventListener('keydown', gestureStartMusic);
    }
    document.addEventListener('pointerdown', gestureStartMusic);
    document.addEventListener('keydown', gestureStartMusic);

    function scheduleMusicNote(time, freq, type, dur, vol) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(vol, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(musicGain);
        osc.start(time);
        osc.stop(time + dur);
    }

    function scheduleMusic() {
        if (!musicStarted) return;
        if (audioCtx.state !== 'running') return;
        // Backgrounded tab: rAF stalled and the schedule fell behind — re-anchor instead of a note burst.
        if (nextNoteTime < audioCtx.currentTime) nextNoteTime = audioCtx.currentTime + 0.05;
        while (nextNoteTime < audioCtx.currentTime + 0.25) {
            const bar = Math.floor(musicStep / 8) % 4;
            const beat = musicStep % 8;
            if (beat % 4 === 0) scheduleMusicNote(nextNoteTime, MUSIC.bass[bar], 'triangle', EIGHTH * 3.6, 0.085);
            scheduleMusicNote(nextNoteTime, MUSIC.arps[bar][beat], 'square', EIGHTH * 0.9, 0.03);
            nextNoteTime += EIGHTH;
            musicStep += 1;
        }
    }

    // ---------------- Theme (warm neon, matches the card accent) ----------------
    const rowColors = ['#f43f5e', '#fbbf24', '#fb923c']; // top row -> bottom row

    function shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
        if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
        else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    function withAlpha(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    const rowPalette = rowColors.map((base) => ({
        base,
        light: shade(base, 0.4),
        dark: shade(base, -0.45)
    }));

    // ---------------- Layout ----------------
    const paddleHeight = 10;
    const paddleWidth = 75;
    const ballRadius = 6;
    const brickRowCount = 3;
    const brickColumnCount = 5;
    const brickWidth = 75;
    const brickHeight = 20;
    const brickPadding = 10;
    const brickOffsetTop = 30;
    const brickOffsetLeft = 30;
    const PHYS_MS = 1000 / 60; // fixed physics timestep
    const baseSpeed = Math.hypot(2, 2); // original ball pace
    const RAMP_PER_BRICK = 0.03; // +3% speed per destroyed brick
    const RAMP_CAP = 1.5; // ...capped at +50%
    const START_LIVES = 3;
    const MAX_LIVES = 5;
    const MAX_BALLS = 7;
    const CAPSULE_W = 26;
    const CAPSULE_H = 14;
    const CAPSULE_SPEED = 90; // px/s fall speed
    const DROP_CHANCE = 0.25;

    // ---------------- Power-ups ----------------
    const POWERUPS = {
        expand: { label: 'WIDE', glyph: 'W', color: '#4ade80', good: true, duration: 10, weight: 20 },
        slow: { label: 'SLOW', glyph: 'S', color: '#38bdf8', good: true, duration: 8, weight: 18 },
        sticky: { label: 'CATCH', glyph: 'C', color: '#fbbf24', good: true, duration: 8, weight: 15 },
        multi: { label: 'MULTI', glyph: 'M', color: '#a78bfa', good: true, duration: 0, weight: 15 },
        shrink: { label: 'SHRINK', glyph: 'N', color: '#f43f5e', good: false, duration: 6, weight: 15 },
        speed: { label: 'FAST', glyph: 'F', color: '#fb7185', good: false, duration: 6, weight: 10 },
        life: { label: '1UP', glyph: '+', color: '#34d399', good: true, duration: 0, weight: 5 }
    };
    const dropTypes = Object.keys(POWERUPS);
    const dropTotalWeight = dropTypes.reduce((sum, k) => sum + POWERUPS[k].weight, 0);

    // ---------------- Game state ----------------
    let score = 0;
    let lives = START_LIVES;
    let gameState = 'ready'; // 'ready' (ball parked for launch) | 'playing' | 'over'
    let destroyed = false;
    let rafId = null;
    let lastFrame = 0;
    let accumulator = 0;
    let bricksDestroyed = 0;

    // Paddle
    let paddleX = (canvas.width - paddleWidth) / 2;

    // Balls: { x, y, dx, dy (direction), stuck, stickRel, trail }
    let balls = [];

    // Timed effects: type -> remaining seconds
    let effects = {};

    // Falling capsules: { x, y, type, age }
    let capsules = [];

    // Juice state
    let particles = [];
    let flashes = [];
    let floaters = [];
    let squash = { age: 1, dur: 0.12, axis: 'y' };
    let shake = { mag: 0, start: 0, dur: 0 };

    const bricks = [];
    function buildBricks() {
        bricks.length = 0;
        for (let c = 0; c < brickColumnCount; c++) {
            bricks[c] = [];
            for (let r = 0; r < brickRowCount; r++) {
                bricks[c][r] = {
                    x: c * (brickWidth + brickPadding) + brickOffsetLeft,
                    y: r * (brickHeight + brickPadding) + brickOffsetTop,
                    status: 1
                };
            }
        }
    }
    buildBricks();

    // Static background gradient (created once)
    const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGradient.addColorStop(0, '#100c09');
    bgGradient.addColorStop(1, '#1a130c');

    // ---------------- Derived paddle/ball physics ----------------
    function paddleW() {
        if (effects.expand) return paddleWidth * 1.5;
        if (effects.shrink) return paddleWidth * 0.6;
        return paddleWidth;
    }

    function clampPaddle(px) {
        return Math.max(0, Math.min(px, canvas.width - paddleW()));
    }

    function speedMultiplier() {
        const ramp = Math.min(RAMP_CAP, 1 + bricksDestroyed * RAMP_PER_BRICK);
        return ramp * (effects.slow ? 0.6 : 1) * (effects.speed ? 1.35 : 1);
    }

    // ---------------- Controls ----------------
    let rightPressed = false;
    let leftPressed = false;

    function keyDownHandler(e) {
        switch (e.key) {
            case 'Right':
            case 'ArrowRight':
                rightPressed = true;
                break;
            case 'Left':
            case 'ArrowLeft':
                leftPressed = true;
                break;
            case ' ':
                if (gameState === 'ready' || hasStuckBall()) {
                    e.preventDefault(); // don't scroll the page or re-trigger a focused button
                    launchOrRelease();
                }
                break;
        }
    }

    function keyUpHandler(e) {
        switch (e.key) {
            case 'Right':
            case 'ArrowRight':
                rightPressed = false;
                break;
            case 'Left':
            case 'ArrowLeft':
                leftPressed = false;
                break;
        }
    }
    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);

    // Touch controls: paddle follows the finger horizontally
    function updatePaddleFromTouch(e) {
        if (gameState === 'over') return;
        const touch = e.touches[0];
        if (!touch) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width; // canvas may be scaled down on small screens
        const tx = (touch.clientX - rect.left) * scaleX;
        paddleX = clampPaddle(tx - paddleW() / 2);
    }

    function touchStartHandler(e) {
        e.preventDefault();
        updatePaddleFromTouch(e);
        if (gameState === 'ready' || hasStuckBall()) launchOrRelease();
    }

    function touchMoveHandler(e) {
        e.preventDefault();
        updatePaddleFromTouch(e);
    }
    canvas.addEventListener('touchstart', touchStartHandler, { passive: false });
    canvas.addEventListener('touchmove', touchMoveHandler, { passive: false });

    // ---------------- Launch / sticky release ----------------
    function parkY() {
        return canvas.height - paddleHeight - ballRadius - 1;
    }

    function hasStuckBall() {
        return balls.some((b) => b.stuck);
    }

    function stickNewBall() {
        balls = [{ x: paddleX + paddleW() / 2, y: parkY(), dx: 0, dy: 0, stuck: true, stickRel: 0, trail: [] }];
        gameState = 'ready';
        accumulator = 0;
    }

    function launchOrRelease() {
        if (gameState === 'ready') {
            const angle = (Math.random() * 30 - 15) * (Math.PI / 180); // ±15° off vertical
            const ball = balls[0];
            ball.dx = Math.sin(angle);
            ball.dy = -Math.cos(angle);
            ball.stuck = false;
            gameState = 'playing';
            playSound(620, 'triangle', 0.12);
            triggerShake(2, 0.1);
        } else {
            for (const ball of balls) {
                if (!ball.stuck) continue;
                const angle = ball.stickRel * (Math.PI / 3); // same angle-bounce mapping as a live hit
                ball.dx = Math.sin(angle);
                ball.dy = -Math.cos(angle);
                ball.stuck = false;
            }
            if (hasStuckBall()) return;
            playSound(620, 'triangle', 0.12);
        }
    }

    // ---------------- Power-up helpers ----------------
    function pickDropType() {
        let roll = Math.random() * dropTotalWeight;
        for (const type of dropTypes) {
            roll -= POWERUPS[type].weight;
            if (roll <= 0) return type;
        }
        return dropTypes[0];
    }

    function clearPowerUps() {
        effects = {};
        capsules = [];
    }

    function addScore(points) {
        score += points;
        scoreDisplay.textContent = `Score: ${score}`;
    }

    function spawnMulti() {
        const src = balls.find((b) => !b.stuck) || balls[0];
        if (!src) return;
        const m = Math.hypot(src.dx, src.dy) || 1;
        // If every ball is stuck (CATCH effect), fan the clones upward instead of sideways
        const base = src.stuck ? -Math.PI / 2 : Math.atan2(src.dy, src.dx);
        for (const offset of [-25, 25]) {
            if (balls.length >= MAX_BALLS) break;
            const a = base + offset * (Math.PI / 180);
            balls.push({ x: src.x, y: src.y, dx: Math.cos(a) * m, dy: Math.sin(a) * m, stuck: false, stickRel: 0, trail: [] });
        }
    }

    function applyPowerUp(type, cx, cy) {
        const def = POWERUPS[type];
        if (def.good) playSound(660, 'triangle', 0.15);
        else playSound(180, 'sawtooth', 0.25);

        let text;
        if (type === 'multi') {
            spawnMulti();
            addScore(25);
            text = 'MULTI +25';
        } else if (type === 'life') {
            lives = Math.min(MAX_LIVES, lives + 1);
            addScore(100);
            text = '+100 1UP';
        } else {
            if (type === 'expand') delete effects.shrink;
            if (type === 'shrink') delete effects.expand;
            effects[type] = def.duration; // re-catching simply refreshes the timer
            if (def.good) {
                addScore(25);
                text = `${def.label} +25`;
            } else {
                text = def.label;
            }
        }
        if (!reducedMotion) {
            floaters.push({ x: cx, y: cy, age: 0, text, color: def.color });
            for (let i = 0; i < 8; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 40 + Math.random() * 90;
                particles.push({
                    x: cx, y: cy,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 40,
                    size: 2 + Math.random() * 2,
                    life: 1,
                    decay: 2 + Math.random() * 1.5,
                    color: def.color
                });
            }
        }
    }

    // ---------------- Juice helpers ----------------
    function triggerShake(mag, dur) {
        if (reducedMotion) return;
        shake.mag = mag;
        shake.dur = dur;
        shake.start = performance.now();
    }

    function triggerSquash(axis) {
        if (reducedMotion) return;
        squash.axis = axis;
        squash.age = 0;
    }

    function spawnShards(bx, by, color) {
        if (reducedMotion) return;
        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 130;
            particles.push({
                x: bx + Math.random() * brickWidth,
                y: by + Math.random() * brickHeight,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 50,
                size: 2 + Math.random() * 3,
                life: 1,
                decay: 1.8 + Math.random() * 1.5,
                color
            });
        }
    }

    function spawnConfetti() {
        if (reducedMotion) return;
        for (let i = 0; i < 50; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: -10 - Math.random() * 40,
                vx: (Math.random() - 0.5) * 80,
                vy: 60 + Math.random() * 120,
                size: 2 + Math.random() * 3,
                life: 1,
                decay: 0.5 + Math.random() * 0.5,
                color: rowColors[i % rowColors.length]
            });
        }
    }

    // ---------------- Physics (fixed timestep, frame-rate independent) ----------------
    function physicsStep() {
        const pw = paddleW();

        // Paddle: keyboard
        if (rightPressed) paddleX += 7;
        else if (leftPressed) paddleX -= 7;
        paddleX = clampPaddle(paddleX);

        // Timed effect countdowns keep ticking in every live state
        for (const type of Object.keys(effects)) {
            effects[type] -= PHYS_MS / 1000;
            if (effects[type] <= 0) delete effects[type];
        }

        // Falling capsules
        for (let i = capsules.length - 1; i >= 0; i--) {
            const cap = capsules[i];
            cap.age += PHYS_MS / 1000;
            cap.y += CAPSULE_SPEED * (PHYS_MS / 1000);
            const caught = cap.y + CAPSULE_H / 2 >= canvas.height - paddleHeight &&
                cap.y - CAPSULE_H / 2 <= canvas.height &&
                cap.x + CAPSULE_W / 2 > paddleX && cap.x - CAPSULE_W / 2 < paddleX + pw;
            if (caught) {
                applyPowerUp(cap.type, cap.x, cap.y);
                capsules.splice(i, 1);
            } else if (cap.y - CAPSULE_H / 2 > canvas.height) {
                capsules.splice(i, 1);
            }
        }

        if (gameState !== 'playing') {
            // Ready state: the parked ball rides the paddle
            for (const ball of balls) {
                if (ball.stuck) ball.x = paddleX + pw / 2 + ball.stickRel * (pw / 2 - ballRadius);
            }
            return;
        }

        const sp = baseSpeed * speedMultiplier();

        for (let i = balls.length - 1; i >= 0; i--) {
            const ball = balls[i];

            if (ball.stuck) {
                // CATCH effect: ride the paddle until Space/tap releases it
                ball.x = paddleX + pw / 2 + ball.stickRel * (pw / 2 - ballRadius);
                ball.y = canvas.height - paddleHeight - ballRadius;
                ball.trail.length = 0;
                continue;
            }

            const m = Math.hypot(ball.dx, ball.dy) || 1;
            ball.x += (ball.dx / m) * sp;
            ball.y += (ball.dy / m) * sp;

            // Motion trail (recorded per physics step so it is frame-rate independent)
            if (!reducedMotion) {
                ball.trail.push({ x: ball.x, y: ball.y });
                if (ball.trail.length > 12) ball.trail.shift();
            }

            // Walls
            if (ball.x - ballRadius < 0) { ball.x = ballRadius; ball.dx = -ball.dx; triggerSquash('x'); }
            else if (ball.x + ballRadius > canvas.width) { ball.x = canvas.width - ballRadius; ball.dx = -ball.dx; triggerSquash('x'); }
            if (ball.y - ballRadius < 0) { ball.y = ballRadius; ball.dy = -ball.dy; triggerSquash('y'); }

            // Bricks — bounce on the axis of least penetration, break the first hit brick
            outer:
            for (let c = 0; c < brickColumnCount; c++) {
                for (let r = 0; r < brickRowCount; r++) {
                    const b = bricks[c][r];
                    if (b.status !== 1) continue;
                    if (ball.x + ballRadius > b.x && ball.x - ballRadius < b.x + brickWidth &&
                        ball.y + ballRadius > b.y && ball.y - ballRadius < b.y + brickHeight) {
                        const overlapX = Math.min(ball.x + ballRadius - b.x, b.x + brickWidth - (ball.x - ballRadius));
                        const overlapY = Math.min(ball.y + ballRadius - b.y, b.y + brickHeight - (ball.y - ballRadius));
                        if (overlapX < overlapY) ball.dx = -ball.dx; else ball.dy = -ball.dy;

                        b.status = 0;
                        bricksDestroyed += 1;
                        const pts = Math.round(10 * speedMultiplier()); // the speed ramp pays out
                        addScore(pts);
                        playSound(340 + (brickRowCount - 1 - r) * 90, 'sine', 0.1); // Higher rows ring higher
                        spawnShards(b.x, b.y, rowColors[r]);
                        flashes.push({ x: b.x, y: b.y, age: 0 });
                        if (!reducedMotion) {
                            floaters.push({ x: b.x + brickWidth / 2, y: b.y, age: 0, text: `+${pts}`, color: '#fdba74' });
                        }
                        if (Math.random() < DROP_CHANCE) {
                            capsules.push({ x: b.x + brickWidth / 2, y: b.y + brickHeight / 2, type: pickDropType(), age: 0 });
                        }
                        triggerShake(3, 0.15);
                        triggerSquash(overlapX < overlapY ? 'x' : 'y');

                        if (bricksDestroyed >= brickRowCount * brickColumnCount) {
                            winGame();
                            break outer;
                        }
                        break outer;
                    }
                }
            }
            if (gameState === 'over') return;

            // Bottom: paddle catch or miss
            if (ball.y + ballRadius >= canvas.height) {
                if (ball.dy > 0 && ball.x > paddleX && ball.x < paddleX + pw) {
                    ball.y = canvas.height - paddleHeight - ballRadius;
                    // Angle bounce: where the ball hits the paddle shapes the return arc
                    const rel = Math.max(-1, Math.min(1, (ball.x - (paddleX + pw / 2)) / (pw / 2)));
                    const angle = rel * (Math.PI / 3); // up to 60 degrees off vertical
                    if (effects.sticky) {
                        ball.stuck = true;
                        ball.stickRel = rel * 0.8; // keep the ball inside the paddle's grip
                        ball.dx = 0;
                        ball.dy = 0;
                        playSound(420, 'triangle', 0.12);
                    } else {
                        ball.dx = Math.sin(angle);
                        ball.dy = -Math.cos(angle);
                        playSound(500, 'sine', 0.1); // Paddle hit sound
                    }
                    triggerShake(2, 0.12);
                    triggerSquash('y');
                } else {
                    balls.splice(i, 1);
                }
            }
        }

        if (balls.length === 0) loseLife();
    }

    // ---------------- Rendering ----------------
    function roundRectPath(c, rx, ry, w, h, r) {
        c.beginPath();
        c.moveTo(rx + r, ry);
        c.arcTo(rx + w, ry, rx + w, ry + h, r);
        c.arcTo(rx + w, ry + h, rx, ry + h, r);
        c.arcTo(rx, ry + h, rx, ry, r);
        c.arcTo(rx, ry, rx + w, ry, r);
        c.closePath();
    }

    function drawBackground() {
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Faint court border
        ctx.strokeStyle = 'rgba(251, 146, 60, 0.16)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }

    function drawBricks() {
        for (let c = 0; c < brickColumnCount; c++) {
            for (let r = 0; r < brickRowCount; r++) {
                const b = bricks[c][r];
                if (b.status !== 1) continue;
                const pal = rowPalette[r];

                ctx.shadowColor = withAlpha(rowColors[r], 0.55);
                ctx.shadowBlur = 9;
                const g = ctx.createLinearGradient(0, b.y, 0, b.y + brickHeight);
                g.addColorStop(0, pal.light);
                g.addColorStop(1, pal.base);
                ctx.fillStyle = g;
                roundRectPath(ctx, b.x, b.y, brickWidth, brickHeight, 4);
                ctx.fill();
                ctx.shadowBlur = 0;

                // Darker bottom edge gives a raised 3D tile feel
                ctx.fillStyle = pal.dark;
                ctx.fillRect(b.x + 2, b.y + brickHeight - 3, brickWidth - 4, 3);
                // Inner top highlight
                ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
                ctx.fillRect(b.x + 3, b.y + 1.5, brickWidth - 6, 2);
            }
        }
    }

    function drawFlashes(dt) {
        for (let i = flashes.length - 1; i >= 0; i--) {
            const f = flashes[i];
            f.age += dt;
            const t = f.age / 0.18;
            if (t >= 1) { flashes.splice(i, 1); continue; }
            const grow = 1 + t * 0.25;
            const w = brickWidth * grow;
            const h = brickHeight * grow;
            ctx.globalAlpha = (1 - t) * 0.85;
            ctx.fillStyle = '#ffffff';
            roundRectPath(ctx, f.x + (brickWidth - w) / 2, f.y + (brickHeight - h) / 2, w, h, 4);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawParticles(dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= p.decay * dt;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 220 * dt; // a little gravity
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }

    function drawFloaters(dt) {
        for (let i = floaters.length - 1; i >= 0; i--) {
            const f = floaters[i];
            f.age += dt;
            const t = f.age / 0.7;
            if (t >= 1) { floaters.splice(i, 1); continue; }
            ctx.globalAlpha = 1 - t;
            ctx.fillStyle = f.color || '#fdba74';
            ctx.font = '600 13px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(f.text, f.x, f.y - 8 - t * 18);
        }
        ctx.globalAlpha = 1;
    }

    function drawPaddle() {
        const px = paddleX;
        const pw = paddleW();
        const py = canvas.height - paddleHeight;

        ctx.shadowColor = effects.sticky ? 'rgba(251, 191, 36, 0.85)' : 'rgba(251, 146, 60, 0.75)';
        ctx.shadowBlur = 14;
        const g = ctx.createLinearGradient(0, py, 0, py + paddleHeight);
        g.addColorStop(0, '#fdba74');
        g.addColorStop(0.55, '#fb923c');
        g.addColorStop(1, '#c2410c');
        ctx.fillStyle = g;
        roundRectPath(ctx, px, py, pw, paddleHeight, paddleHeight / 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Glossy top shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        roundRectPath(ctx, px + 5, py + 1.5, pw - 10, 2.5, 1.25);
        ctx.fill();
    }

    function drawBalls() {
        for (const ball of balls) {
            // Comet trail behind the ball
            if (!reducedMotion && ball.trail.length > 1) {
                for (let i = 0; i < ball.trail.length; i++) {
                    const t = (i + 1) / ball.trail.length;
                    ctx.globalAlpha = t * t * 0.28;
                    ctx.fillStyle = '#fb923c';
                    ctx.beginPath();
                    ctx.arc(ball.trail[i].x, ball.trail[i].y, ballRadius * (0.3 + 0.6 * t), 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }

            // Squash & stretch on impact
            let sx = 1, sy = 1;
            if (squash.age < squash.dur) {
                const k = 0.3 * (1 - squash.age / squash.dur);
                if (squash.axis === 'x') { sx = 1 - k; sy = 1 + k * 0.6; }
                else { sx = 1 + k * 0.6; sy = 1 - k; }
            }

            ctx.save();
            ctx.translate(ball.x, ball.y);
            ctx.scale(sx, sy);
            ctx.shadowColor = 'rgba(251, 146, 60, 0.9)';
            ctx.shadowBlur = 12;
            const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, ballRadius);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.55, '#fed7aa');
            g.addColorStop(1, '#fb923c');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, ballRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function drawCapsules() {
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const cap of capsules) {
            const def = POWERUPS[cap.type];
            // Gentle side-to-side bob so drops catch the eye
            const bob = reducedMotion ? 0 : Math.sin(cap.age * 6) * 4;
            const cx = cap.x + bob;
            const cy = cap.y;

            ctx.shadowColor = withAlpha(def.color, 0.8);
            ctx.shadowBlur = 10;
            const g = ctx.createLinearGradient(0, cy - CAPSULE_H / 2, 0, cy + CAPSULE_H / 2);
            g.addColorStop(0, shade(def.color, 0.35));
            g.addColorStop(1, def.color);
            ctx.fillStyle = g;
            roundRectPath(ctx, cx - CAPSULE_W / 2, cy - CAPSULE_H / 2, CAPSULE_W, CAPSULE_H, CAPSULE_H / 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = 'rgba(10, 8, 6, 0.85)';
            ctx.fillText(def.glyph, cx, cy + 0.5);
        }
        ctx.textBaseline = 'alphabetic';
    }

    function drawHud(now) {
        // Lives: glowing pips top-right
        for (let i = 0; i < lives; i++) {
            const px = canvas.width - 14 - i * 14;
            ctx.shadowColor = 'rgba(251, 146, 60, 0.9)';
            ctx.shadowBlur = 6;
            ctx.fillStyle = '#fb923c';
            ctx.beginPath();
            ctx.arc(px, 12, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Active effects: name + shrinking duration bar, top-left
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        let row = 0;
        for (const type of Object.keys(effects)) {
            const def = POWERUPS[type];
            const y = 12 + row * 14;
            ctx.fillStyle = def.color;
            ctx.beginPath();
            ctx.arc(10, y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(def.label, 18, y + 3);
            const frac = Math.max(0, Math.min(1, effects[type] / def.duration));
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(56, y - 2, 46, 4);
            ctx.fillStyle = def.color;
            ctx.fillRect(56, y - 2, 46 * frac, 4);
            row += 1;
        }

        // Ready-to-launch hint (also shown while CATCH holds a ball, even after the effect expires)
        if (gameState === 'ready' || hasStuckBall()) {
            const pulse = reducedMotion ? 0.85 : 0.65 + 0.3 * Math.sin(now / 260);
            ctx.globalAlpha = pulse;
            ctx.fillStyle = '#fdba74';
            ctx.font = '600 14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('PRESS SPACE / TAP TO LAUNCH', canvas.width / 2, canvas.height - 66);
            ctx.globalAlpha = 1;
        }
        ctx.textAlign = 'left';
    }

    function render(dt, now) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawBackground();

        // Screen shake
        const shakeT = (now - shake.start) / 1000;
        if (shake.mag > 0 && shakeT < shake.dur) {
            const f = 1 - shakeT / shake.dur;
            ctx.translate((Math.random() * 2 - 1) * shake.mag * f, (Math.random() * 2 - 1) * shake.mag * f);
        }

        drawBricks();
        drawFlashes(dt);
        drawCapsules();
        drawBalls();
        drawPaddle();
        drawParticles(dt);
        drawFloaters(dt);
        drawHud(now);
    }

    function frame(now) {
        if (destroyed) return;
        const dt = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;

        if (gameState !== 'over') {
            accumulator += dt * 1000;
            while (accumulator >= PHYS_MS && gameState !== 'over') {
                physicsStep();
                accumulator -= PHYS_MS;
            }
            if (gameState === 'over') accumulator = 0;
        }
        squash.age += dt;

        scheduleMusic();
        render(dt, now);
        rafId = requestAnimationFrame(frame);
    }

    // ---------------- Game flow ----------------
    function winGame() {
        gameState = 'over';
        clearPowerUps();
        // Little victory arpeggio
        playSound(523, 'sine', 0.15);
        setTimeout(() => playSound(659, 'sine', 0.15), 150);
        setTimeout(() => playSound(784, 'sine', 0.25), 300);
        spawnConfetti();
        showGameOverModal('You Win!');
    }

    function setBlur(on) {
        canvas.style.transition = on ? 'filter 0.3s ease' : 'none';
        canvas.style.filter = on ? 'blur(3px)' : 'none';
    }

    function gameOver() {
        gameState = 'over';
        clearPowerUps();
        playSound(200, 'sawtooth', 0.5);
        setBlur(true);
        showGameOverModal('Game Over');
    }

    function loseLife() {
        lives -= 1;
        clearPowerUps();
        if (lives <= 0) {
            gameOver();
            return;
        }
        playSound(240, 'sawtooth', 0.35);
        triggerShake(4, 0.25);
        stickNewBall();
    }

    function getScores() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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

    function showGameOverModal(headline) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const finalScore = score;
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="breakout-modal-title">
                <h2 id="breakout-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${finalScore}</strong></p>
                <ol class="leaderboard" id="breakout-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="breakout-initials-form" class="initials-form" autocomplete="off">
                    <label for="breakout-initials">Your Initials</label>
                    <input id="breakout-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off" autocapitalize="characters">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="breakout-initials-form" id="breakout-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="breakout-again" class="btn btn-ghost">Play Again</button>
                    <button type="button" id="breakout-home" class="btn btn-ghost">Home</button>
                </div>
            </div>`;
        container.appendChild(overlay);

        const form = overlay.querySelector('#breakout-initials-form');
        const input = overlay.querySelector('#breakout-initials');
        const saveBtn = overlay.querySelector('#breakout-save');
        const againBtn = overlay.querySelector('#breakout-again');
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
                overlay.querySelector('#breakout-leaderboard').innerHTML = renderLeaderboard();
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
            resetGame();
        });

        overlay.querySelector('#breakout-home').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('hub:home'));
        });
    }

    function resetGame() {
        score = 0;
        scoreDisplay.textContent = 'Score: 0';
        lives = START_LIVES;
        bricksDestroyed = 0;
        paddleX = clampPaddle((canvas.width - paddleWidth) / 2);
        rightPressed = false;
        leftPressed = false;
        setBlur(false);

        particles = [];
        flashes = [];
        floaters = [];
        squash = { age: 1, dur: 0.12, axis: 'y' };
        shake = { mag: 0, start: 0, dur: 0 };
        clearPowerUps();
        buildBricks();
        stickNewBall();

        accumulator = 0;
        lastFrame = performance.now();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(frame);
    }

    resetGame();

    return {
        destroy: () => {
            destroyed = true;
            cancelAnimationFrame(rafId);
            document.removeEventListener('keydown', keyDownHandler);
            document.removeEventListener('keyup', keyUpHandler);
            document.removeEventListener('pointerdown', gestureStartMusic);
            document.removeEventListener('keydown', gestureStartMusic);
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchmove', touchMoveHandler);
            audioCtx.close();
        }
    };
}
