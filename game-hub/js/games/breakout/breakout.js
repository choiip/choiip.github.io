export function init(container) {
    const STORAGE_KEY = 'breakout_highscores';

    // Create Game Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    canvas.className = 'game-canvas';

    // Create UI Elements
    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Drag across the court to move the paddle.';

    container.append(scoreDisplay, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Audio Context for sound effects
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playSound(freq, type, duration) {
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

    // ---------------- Game state ----------------
    let score = 0;
    let isGameOver = false;
    let destroyed = false;
    let rafId = null;
    let lastFrame = 0;
    let accumulator = 0;

    // Paddle
    let paddleX = (canvas.width - paddleWidth) / 2;

    // Ball
    let x = canvas.width / 2;
    let y = canvas.height - 30;
    let dx = 2;
    let dy = -2;

    // Juice state
    let trail = [];
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

    // ---------------- Controls ----------------
    let rightPressed = false;
    let leftPressed = false;

    function keyDownHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') rightPressed = true;
        else if (e.key === 'Left' || e.key === 'ArrowLeft') leftPressed = true;
    }

    function keyUpHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') rightPressed = false;
        else if (e.key === 'Left' || e.key === 'ArrowLeft') leftPressed = false;
    }
    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);

    // Touch controls: paddle follows the finger horizontally
    function updatePaddleFromTouch(e) {
        if (isGameOver) return;
        const touch = e.touches[0];
        if (!touch) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width; // canvas may be scaled down on small screens
        const x = (touch.clientX - rect.left) * scaleX;
        paddleX = x - paddleWidth / 2;
        paddleX = Math.max(0, Math.min(paddleX, canvas.width - paddleWidth));
    }

    function touchStartHandler(e) {
        e.preventDefault();
        updatePaddleFromTouch(e);
    }

    function touchMoveHandler(e) {
        e.preventDefault();
        updatePaddleFromTouch(e);
    }
    canvas.addEventListener('touchstart', touchStartHandler, { passive: false });
    canvas.addEventListener('touchmove', touchMoveHandler, { passive: false });

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
        // Paddle: keyboard
        if (rightPressed && paddleX < canvas.width - paddleWidth) paddleX += 7;
        else if (leftPressed && paddleX > 0) paddleX -= 7;

        // Ball
        x += dx;
        y += dy;

        // Motion trail (recorded per physics step so it is frame-rate independent)
        if (!reducedMotion) {
            trail.push({ x, y });
            if (trail.length > 12) trail.shift();
        }

        // Walls
        if (x - ballRadius < 0) { x = ballRadius; dx = -dx; triggerSquash('x'); }
        else if (x + ballRadius > canvas.width) { x = canvas.width - ballRadius; dx = -dx; triggerSquash('x'); }
        if (y - ballRadius < 0) { y = ballRadius; dy = -dy; triggerSquash('y'); }

        // Bricks — bounce on the axis of least penetration, break the first hit brick
        outer:
        for (let c = 0; c < brickColumnCount; c++) {
            for (let r = 0; r < brickRowCount; r++) {
                const b = bricks[c][r];
                if (b.status !== 1) continue;
                if (x + ballRadius > b.x && x - ballRadius < b.x + brickWidth &&
                    y + ballRadius > b.y && y - ballRadius < b.y + brickHeight) {
                    const overlapX = Math.min(x + ballRadius - b.x, b.x + brickWidth - (x - ballRadius));
                    const overlapY = Math.min(y + ballRadius - b.y, b.y + brickHeight - (y - ballRadius));
                    if (overlapX < overlapY) dx = -dx; else dy = -dy;

                    b.status = 0;
                    score += 10;
                    scoreDisplay.textContent = `Score: ${score}`;
                    playSound(340 + (brickRowCount - 1 - r) * 90, 'sine', 0.1); // Higher rows ring higher
                    spawnShards(b.x, b.y, rowColors[r]);
                    flashes.push({ x: b.x, y: b.y, age: 0 });
                    if (!reducedMotion) floaters.push({ x: b.x + brickWidth / 2, y: b.y, age: 0 });
                    triggerShake(3, 0.15);
                    triggerSquash(overlapX < overlapY ? 'x' : 'y');

                    if (score === brickRowCount * brickColumnCount * 10) {
                        winGame();
                    }
                    break outer;
                }
            }
        }
        if (isGameOver) return;

        // Bottom: paddle catch or miss
        if (y + ballRadius >= canvas.height) {
            if (dy > 0 && x > paddleX && x < paddleX + paddleWidth) {
                y = canvas.height - ballRadius;
                // Angle bounce: where the ball hits the paddle shapes the return arc
                const rel = Math.max(-1, Math.min(1, (x - (paddleX + paddleWidth / 2)) / (paddleWidth / 2)));
                const speed = Math.hypot(dx, dy);
                const angle = rel * (Math.PI / 3); // up to 60 degrees off vertical
                dx = speed * Math.sin(angle);
                dy = -speed * Math.cos(angle);
                playSound(500, 'sine', 0.1); // Paddle hit sound
                triggerShake(2, 0.12);
                triggerSquash('y');
            } else {
                gameOver();
            }
        }
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
            ctx.fillStyle = '#fdba74';
            ctx.font = '600 13px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('+10', f.x, f.y - 8 - t * 18);
        }
        ctx.globalAlpha = 1;
    }

    function drawPaddle() {
        const px = paddleX;
        const py = canvas.height - paddleHeight;

        ctx.shadowColor = 'rgba(251, 146, 60, 0.75)';
        ctx.shadowBlur = 14;
        const g = ctx.createLinearGradient(0, py, 0, py + paddleHeight);
        g.addColorStop(0, '#fdba74');
        g.addColorStop(0.55, '#fb923c');
        g.addColorStop(1, '#c2410c');
        ctx.fillStyle = g;
        roundRectPath(ctx, px, py, paddleWidth, paddleHeight, paddleHeight / 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Glossy top shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        roundRectPath(ctx, px + 5, py + 1.5, paddleWidth - 10, 2.5, 1.25);
        ctx.fill();
    }

    function drawBall() {
        // Comet trail behind the ball
        if (!reducedMotion && trail.length > 1) {
            for (let i = 0; i < trail.length; i++) {
                const t = (i + 1) / trail.length;
                ctx.globalAlpha = t * t * 0.28;
                ctx.fillStyle = '#fb923c';
                ctx.beginPath();
                ctx.arc(trail[i].x, trail[i].y, ballRadius * (0.3 + 0.6 * t), 0, Math.PI * 2);
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
        ctx.translate(x, y);
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
        drawBall();
        drawPaddle();
        drawParticles(dt);
        drawFloaters(dt);
    }

    function frame(now) {
        if (destroyed) return;
        const dt = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;

        if (!isGameOver) {
            accumulator += dt * 1000;
            while (accumulator >= PHYS_MS && !isGameOver) {
                physicsStep();
                accumulator -= PHYS_MS;
            }
            if (isGameOver) accumulator = 0;
        }
        squash.age += dt;

        render(dt, now);
        rafId = requestAnimationFrame(frame);
    }

    // ---------------- Game flow ----------------
    function winGame() {
        isGameOver = true;
        trail = [];
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
        isGameOver = true;
        trail = [];
        playSound(200, 'sawtooth', 0.5);
        setBlur(true);
        showGameOverModal('Game Over');
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
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="breakout-modal-title">
                <h2 id="breakout-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${score}</strong></p>
                <ol class="leaderboard" id="breakout-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="breakout-initials-form" class="initials-form" autocomplete="off">
                    <label for="breakout-initials">Your Initials</label>
                    <input id="breakout-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="breakout-initials-form" id="breakout-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="breakout-again" class="btn btn-ghost">Play Again</button>
                </div>
            </div>`;
        container.appendChild(overlay);

        const form = overlay.querySelector('#breakout-initials-form');
        const input = overlay.querySelector('#breakout-initials');
        const saveBtn = overlay.querySelector('#breakout-save');
        let saved = false;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (saved) return;
            saved = true;
            const initials = (input.value.trim().toUpperCase() || '???').slice(0, 3);
            saveHighScore(initials, score);
            overlay.querySelector('#breakout-leaderboard').innerHTML = renderLeaderboard();
            saveBtn.textContent = 'Saved ✓';
            saveBtn.disabled = true;
            input.disabled = true;
        });

        overlay.querySelector('#breakout-again').addEventListener('click', () => {
            overlay.remove();
            resetGame();
        });

        input.focus();
    }

    function resetGame() {
        score = 0;
        scoreDisplay.textContent = 'Score: 0';
        x = canvas.width / 2;
        y = canvas.height - 30;
        dx = 2;
        dy = -2;
        paddleX = (canvas.width - paddleWidth) / 2;
        rightPressed = false;
        leftPressed = false;
        isGameOver = false;
        setBlur(false);

        trail = [];
        particles = [];
        flashes = [];
        floaters = [];
        squash = { age: 1, dur: 0.12, axis: 'y' };
        shake = { mag: 0, start: 0, dur: 0 };
        buildBricks();

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
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchmove', touchMoveHandler);
        }
    };
}
