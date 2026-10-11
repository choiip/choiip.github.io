export function init(container) {
    const STORAGE_KEY = 'snake_highscores';

    // Create Game Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    canvas.className = 'game-canvas';

    // Create UI Elements
    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Swipe to steer the snake.';

    container.append(scoreDisplay, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const gridSize = 20;
    const tileCount = canvas.width / gridSize;

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

    const TICK_MS = 150;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let score = 0;
    let dx = 0, dy = 0;
    let snake = [];
    let prevSnake = [];
    let food = {x: 5, y: 5};
    let gameInterval = null;
    let rafId = null;
    let particles = [];
    let eatTime = -Infinity;
    let lastTickTime = performance.now();
    let lastRenderTime = performance.now();
    let isGameOver = false;
    let destroyed = false;

    // ---------------- Game logic (fixed timestep) ----------------

    function tick() {
        if (isGameOver || destroyed) return;
        if (dx === 0 && dy === 0) return; // idle: waiting for the first swipe/key

        const head = {x: snake[0].x + dx, y: snake[0].y + dy};

        if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
            gameOver();
            return;
        }

        if (snake.some(segment => segment.x === head.x && segment.y === head.y)) {
            gameOver();
            return;
        }

        prevSnake = snake.map((s) => ({ ...s }));
        snake.unshift(head);
        lastTickTime = performance.now();

        if (head.x === food.x && head.y === food.y) {
            score += 10;
            scoreDisplay.textContent = `Score: ${score}`;
            playSound(600, 'sine', 0.1); // Eat sound
            eatTime = performance.now();
            spawnEatParticles((food.x + 0.5) * gridSize, (food.y + 0.5) * gridSize);
            generateFood();
        } else {
            snake.pop();
        }
    }

    // ---------------- Rendering (smooth 60fps on top of the fixed timestep) ----------------

    function drawBackground() {
        ctx.fillStyle = '#0b120a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Subtle checkerboard so the grid reads without dominating
        ctx.fillStyle = 'rgba(134, 239, 172, 0.035)';
        for (let y = 0; y < tileCount; y++) {
            for (let x = 0; x < tileCount; x++) {
                if ((x + y) % 2 === 0) {
                    ctx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
                }
            }
        }
    }

    function drawApple(now) {
        const pulse = reducedMotion ? 1 : 1 + 0.06 * Math.sin(now / 170);
        const cx = (food.x + 0.5) * gridSize;
        const cy = (food.y + 0.5) * gridSize;
        const r = gridSize * 0.4 * pulse;

        // Body with a soft 3D gradient
        const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r * 1.1);
        grad.addColorStop(0, '#f87171');
        grad.addColorStop(1, '#dc2626');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.08, r, 0, Math.PI * 2);
        ctx.fill();

        // Stem
        ctx.strokeStyle = '#854d0e';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.85);
        ctx.quadraticCurveTo(cx + 1.5, cy - r * 0.85 - 3, cx + 3.5, cy - r * 0.85 - 5);
        ctx.stroke();

        // Leaf
        ctx.fillStyle = '#22c55e';
        ctx.save();
        ctx.translate(cx + 5, cy - r * 0.85 - 2.5);
        ctx.rotate(-0.45);
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.5, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Glossy highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.35, cy - r * 0.25, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
    }

    function bodyColor(f) {
        // Bright green near the head -> deep green at the tail
        const r = Math.round(34 + (21 - 34) * f);
        const g = Math.round(197 + (128 - 197) * f);
        const b = Math.round(94 + (61 - 94) * f);
        return `rgb(${r}, ${g}, ${b})`;
    }

    function segmentWidth(i, n) {
        const f = n <= 1 ? 0 : i / (n - 1);
        return gridSize * (0.78 - 0.26 * f); // Tapers toward the tail
    }

    function roundRectPath(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    function drawSnake(now, t) {
        // Interpolate each segment between its previous and current cell
        const centers = snake.map((seg, i) => {
            const prev = prevSnake[Math.min(i, prevSnake.length - 1)] || seg;
            return {
                x: (prev.x + (seg.x - prev.x) * t + 0.5) * gridSize,
                y: (prev.y + (seg.y - prev.y) * t + 0.5) * gridSize
            };
        });
        const n = centers.length;

        // Body, tail -> head, so the wider head-side parts paint on top
        for (let i = n - 1; i >= 1; i--) {
            ctx.strokeStyle = bodyColor(i / (n - 1));
            ctx.lineWidth = segmentWidth(i, n);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(centers[i].x, centers[i].y);
            ctx.lineTo(centers[i - 1].x, centers[i - 1].y);
            ctx.stroke();
        }

        // Head, with a short "pop" when eating
        const pop = reducedMotion ? 1 : 1 + 0.22 * Math.max(0, 1 - (now - eatTime) / 180);
        const hw = gridSize * 0.95 * pop;
        const hx = centers[0].x;
        const hy = centers[0].y;
        const dir = (dx === 0 && dy === 0) ? { x: 0, y: -1 } : { x: dx, y: dy };

        roundRectPath(ctx, hx - hw / 2, hy - hw / 2, hw, hw, 6);
        ctx.fillStyle = '#4ade80';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Eyes face the direction of travel (look up while idle)
        const perp = { x: -dir.y, y: dir.x };
        const forward = gridSize * 0.17 * pop;
        const side = gridSize * 0.21 * pop;
        for (const s of [1, -1]) {
            const ex = hx + dir.x * forward + perp.x * side * s;
            const ey = hy + dir.y * forward + perp.y * side * s;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(ex, ey, gridSize * 0.13 * pop, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(ex + dir.x * 1.8, ey + dir.y * 1.8, gridSize * 0.065 * pop, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function spawnEatParticles(cx, cy) {
        if (reducedMotion) return;
        const colors = ['#f87171', '#ef4444', '#bbf7d0', '#22c55e'];
        for (let i = 0; i < 14; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 90;
            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 30,
                size: 1.5 + Math.random() * 2.5,
                life: 1,
                decay: 1.6 + Math.random() * 1.2,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }
    }

    function updateAndDrawParticles(dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= p.decay * dt;
            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 160 * dt; // A little gravity
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function render(now = performance.now()) {
        if (destroyed) return;
        const dt = Math.min(0.05, (now - lastRenderTime) / 1000);
        lastRenderTime = now;

        drawBackground();
        drawApple(now);
        const t = isGameOver ? 1 : Math.min(1, (now - lastTickTime) / TICK_MS);
        drawSnake(now, t);
        updateAndDrawParticles(dt);

        rafId = requestAnimationFrame(render);
    }

    function generateFood() {
        food = {
            x: Math.floor(Math.random() * tileCount),
            y: Math.floor(Math.random() * tileCount)
        };
        if (snake.some(segment => segment.x === food.x && segment.y === food.y)) {
            generateFood();
        }
    }

    function setBlur(on) {
        canvas.style.transition = on ? 'filter 0.3s ease' : 'none';
        canvas.style.filter = on ? 'blur(3px)' : 'none';
    }

    function gameOver() {
        isGameOver = true;
        clearInterval(gameInterval);

        playSound(200, 'sawtooth', 0.5); // Game over sound
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
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="snake-modal-title">
                <h2 id="snake-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${score}</strong></p>
                <ol class="leaderboard" id="snake-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="snake-initials-form" class="initials-form" autocomplete="off">
                    <label for="snake-initials">Your Initials</label>
                    <input id="snake-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="snake-initials-form" id="snake-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="snake-again" class="btn btn-ghost">Play Again</button>
                </div>
            </div>`;
        container.appendChild(overlay);

        const form = overlay.querySelector('#snake-initials-form');
        const input = overlay.querySelector('#snake-initials');
        const saveBtn = overlay.querySelector('#snake-save');
        let saved = false;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (saved) return;
            saved = true;
            const initials = (input.value.trim().toUpperCase() || '???').slice(0, 3);
            saveHighScore(initials, score);
            overlay.querySelector('#snake-leaderboard').innerHTML = renderLeaderboard();
            saveBtn.textContent = 'Saved ✓';
            saveBtn.disabled = true;
            input.disabled = true;
        });

        overlay.querySelector('#snake-again').addEventListener('click', () => {
            overlay.remove();
            resetGame();
        });

        input.focus();
    }

    function resetGame() {
        score = 0;
        scoreDisplay.textContent = 'Score: 0';

        // Center the snake (tileCount / 2)
        const centerX = Math.floor(tileCount / 2);
        const centerY = Math.floor(tileCount / 2);
        snake = [{x: centerX, y: centerY}];

        dx = 0; dy = 0;
        isGameOver = false;
        prevSnake = snake.map((s) => ({ ...s }));
        particles = [];
        eatTime = -Infinity;
        lastTickTime = performance.now();
        lastRenderTime = performance.now();
        setBlur(false);
        generateFood();
        if (gameInterval) clearInterval(gameInterval);
        gameInterval = setInterval(tick, TICK_MS);
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(render);
    }

    function setDirection(newDx, newDy) {
        if (isGameOver) return;
        if (newDx === -1 && dx === 1) return; // no reversing
        if (newDx === 1 && dx === -1) return;
        if (newDy === -1 && dy === 1) return;
        if (newDy === 1 && dy === -1) return;
        dx = newDx;
        dy = newDy;
    }

    function keyDownHandler(e) {
        switch(e.key) {
            case 'ArrowUp': setDirection(0, -1); break;
            case 'ArrowDown': setDirection(0, 1); break;
            case 'ArrowLeft': setDirection(-1, 0); break;
            case 'ArrowRight': setDirection(1, 0); break;
        }
    }
    window.addEventListener('keydown', keyDownHandler);

    // Touch controls: swipe in the new direction
    let touchStartX = 0;
    let touchStartY = 0;
    let touchActive = false;

    function touchStartHandler(e) {
        e.preventDefault();
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchActive = true;
    }

    function touchEndHandler(e) {
        e.preventDefault();
        if (!touchActive) return;
        touchActive = false;
        const touch = e.changedTouches[0];
        const swipeDx = touch.clientX - touchStartX;
        const swipeDy = touch.clientY - touchStartY;
        const absDx = Math.abs(swipeDx);
        const absDy = Math.abs(swipeDy);
        if (Math.max(absDx, absDy) < 24) return; // it was a tap, not a swipe
        if (absDx > absDy) {
            setDirection(swipeDx > 0 ? 1 : -1, 0);
        } else {
            setDirection(0, swipeDy > 0 ? 1 : -1);
        }
    }
    canvas.addEventListener('touchstart', touchStartHandler, { passive: false });
    canvas.addEventListener('touchend', touchEndHandler, { passive: false });

    // Block page scroll / pull-to-refresh while playing, even when the
    // gesture starts off the canvas or the finger drifts past its edge
    function pageTouchMoveHandler(e) {
        if (isGameOver) return;
        if (e.target instanceof Element && e.target.closest('#game-container')) {
            e.preventDefault();
        }
    }
    document.addEventListener('touchmove', pageTouchMoveHandler, { passive: false });

    resetGame();

    return {
        destroy: () => {
            destroyed = true;
            clearInterval(gameInterval);
            cancelAnimationFrame(rafId);
            window.removeEventListener('keydown', keyDownHandler);
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchend', touchEndHandler);
            document.removeEventListener('touchmove', pageTouchMoveHandler);
        }
    };
}
