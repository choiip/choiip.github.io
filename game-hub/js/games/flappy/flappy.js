export function init(container) {
    const STORAGE_KEY = 'flappy_highscores';

    // Create Game Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 500;
    canvas.className = 'game-canvas';

    // Create UI Elements
    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    container.append(scoreDisplay, canvas);

    const ctx = canvas.getContext('2d');

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

    // Layout
    const groundHeight = 60;
    const groundY = canvas.height - groundHeight;

    // Bird physics
    const birdX = 100;
    const birdRadius = 13;
    const gravity = 0.45;
    const flapVelocity = -7.2;
    const maxFall = 10;

    // Pipes
    const pipeWidth = 64;
    const pipeGap = 150;
    const pipeSpacing = 220;
    const pipeSpeedBase = 2.4;

    // Scenery (generated once, reused every frame)
    const stars = [];
    for (let i = 0; i < 24; i++) {
        stars.push({ x: Math.random() * canvas.width, y: Math.random() * groundY * 0.6, r: 0.4 + Math.random() * 1.1 });
    }
    const clouds = [];
    for (let i = 0; i < 4; i++) {
        clouds.push({ x: Math.random() * canvas.width, y: 40 + Math.random() * 170, w: 60 + Math.random() * 50, speed: 0.25 + Math.random() * 0.3 });
    }

    // Game State
    let score = 0;
    let state = 'ready'; // 'ready' | 'playing' | 'gameover'
    let animationId = null;
    let birdY = canvas.height / 2;
    let birdVy = 0;
    let pipes = []; // { x, gapY, passed }
    let distance = 0; // drives scrolling ground
    let frame = 0; // drives wing/blink animation

    function pipeSpeed() {
        // Gentle ramp-up: 2.4 -> 3.2 as the score climbs
        return pipeSpeedBase + Math.min(score, 40) * 0.02;
    }

    function flap() {
        if (state === 'gameover') return;
        if (state === 'ready') state = 'playing';
        birdVy = flapVelocity;
        playSound(480, 'sine', 0.07); // Flap sound
    }

    function keyDownHandler(e) {
        if (state === 'gameover') return; // Modal input field handles keys now
        if (e.key === ' ' || e.key === 'ArrowUp') {
            if (e.repeat) return;
            e.preventDefault();
            flap();
        }
    }
    window.addEventListener('keydown', keyDownHandler);

    function pointerHandler(e) {
        e.preventDefault();
        flap();
    }
    canvas.addEventListener('pointerdown', pointerHandler);

    function spawnPipes() {
        const lastX = pipes.length ? pipes[pipes.length - 1].x : -Infinity;
        if (lastX < canvas.width - pipeSpacing) {
            const margin = 70; // min pipe height above and below the gap
            const gapY = margin + Math.random() * (groundY - margin * 2 - pipeGap);
            pipes.push({ x: Math.max(canvas.width, lastX + pipeSpacing), gapY, passed: false });
        }
    }

    function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
        const nx = Math.max(rx, Math.min(cx, rx + rw));
        const ny = Math.max(ry, Math.min(cy, ry + rh));
        const dx = cx - nx;
        const dy = cy - ny;
        return dx * dx + dy * dy < r * r;
    }

    function update() {
        frame++;

        // Clouds drift in every state
        for (const c of clouds) {
            c.x -= c.speed;
            if (c.x + c.w < 0) {
                c.x = canvas.width + Math.random() * 60;
                c.y = 40 + Math.random() * 170;
            }
        }

        if (state === 'ready') {
            // Bird bobs gently while the world scrolls behind the hint
            birdY = canvas.height / 2 + Math.sin(frame * 0.08) * 10;
            distance += 1.5;
            return;
        }

        if (state !== 'playing') return;

        birdVy = Math.min(birdVy + gravity, maxFall);
        birdY += birdVy;

        // Ceiling clamps instead of killing
        if (birdY - birdRadius < 0) {
            birdY = birdRadius;
            birdVy = 0;
        }

        distance += pipeSpeed();
        spawnPipes();

        for (const pipe of pipes) {
            pipe.x -= pipeSpeed();
            if (!pipe.passed && pipe.x + pipeWidth < birdX - birdRadius) {
                pipe.passed = true;
                score += 1;
                scoreDisplay.textContent = `Score: ${score}`;
                playSound(600, 'sine', 0.1); // Point sound
            }
        }
        pipes = pipes.filter(pipe => pipe.x + pipeWidth > -10);

        // Ground collision
        if (birdY + birdRadius >= groundY) {
            birdY = groundY - birdRadius;
            gameOver();
            return;
        }

        // Pipe collision
        for (const pipe of pipes) {
            const botY = pipe.gapY + pipeGap;
            if (circleRectCollide(birdX, birdY, birdRadius, pipe.x, 0, pipeWidth, pipe.gapY) ||
                circleRectCollide(birdX, birdY, birdRadius, pipe.x, botY, pipeWidth, groundY - botY)) {
                gameOver();
                return;
            }
        }
    }

    function drawSky() {
        const grad = ctx.createLinearGradient(0, 0, 0, groundY);
        grad.addColorStop(0, '#0b1026');
        grad.addColorStop(1, '#243356');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, groundY);

        // Stars
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        for (const s of stars) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Moon with a soft glow
        ctx.save();
        ctx.shadowColor = 'rgba(226, 232, 240, 0.5)';
        ctx.shadowBlur = 24;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
        ctx.beginPath();
        ctx.arc(canvas.width - 64, 64, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawClouds() {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        for (const c of clouds) {
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, c.w, c.w * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(c.x + c.w * 0.4, c.y + 6, c.w * 0.6, c.w * 0.24, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawPipe(x, y, h, isTop) {
        if (h <= 0) return;
        const capH = 26;
        const overhang = 5;

        // Body with side shading
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x, y, pipeWidth, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(x + pipeWidth - 12, y, 12, h);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(x + 6, y, 8, h);

        // Lip/cap at the gap end
        const capY = isTop ? y + h - capH : y;
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(x - overhang, capY, pipeWidth + overhang * 2, capH);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(x + pipeWidth - 12, capY, 12, capH);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - overhang + 0.5, capY + 0.5, pipeWidth + overhang * 2 - 1, capH - 1);
    }

    function drawPipes() {
        for (const p of pipes) {
            drawPipe(p.x, 0, p.gapY, true);
            const botY = p.gapY + pipeGap;
            drawPipe(p.x, botY, groundY - botY, false);
        }
    }

    function drawGround() {
        ctx.fillStyle = '#1b2340';
        ctx.fillRect(0, groundY, canvas.width, groundHeight);
        ctx.fillStyle = '#3f6f52';
        ctx.fillRect(0, groundY, canvas.width, 8);

        // Scrolling ticks sell the motion
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        const offset = distance % 40;
        for (let x = -offset; x < canvas.width; x += 40) {
            ctx.fillRect(x, groundY + 18, 20, 4);
        }
    }

    function drawBird() {
        const rotation = state === 'ready'
            ? Math.sin(frame * 0.1) * 0.12
            : Math.max(-0.4, Math.min(1.3, birdVy / 9));

        ctx.save();
        ctx.translate(birdX, birdY);
        ctx.rotate(rotation);

        // Body
        ctx.fillStyle = '#fcd34d';
        ctx.beginPath();
        ctx.arc(0, 0, birdRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Wing (flaps faster while playing)
        const wing = state === 'ready' ? Math.sin(frame * 0.15) * 0.5 : Math.sin(frame * 0.6) * 0.7;
        ctx.save();
        ctx.translate(-3, 1);
        ctx.rotate(wing * 0.6);
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.ellipse(-4, 0, 7, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Eye
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(5, -4, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(6.5, -4, 2, 0, Math.PI * 2);
        ctx.fill();

        // Beak
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.moveTo(10, 1);
        ctx.lineTo(18, 3);
        ctx.lineTo(10, 6);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    function drawHint() {
        ctx.fillStyle = 'rgba(244, 246, 251, 0.9)';
        ctx.font = '600 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        const bob = Math.sin(frame * 0.08) * 6;
        ctx.fillText('Press Space or tap to flap', canvas.width / 2, 150 + bob);
    }

    function setBlur(on) {
        canvas.style.transition = on ? 'filter 0.3s ease' : 'none';
        canvas.style.filter = on ? 'blur(3px)' : 'none';
    }

    function gameOver() {
        state = 'gameover';
        cancelAnimationFrame(animationId);

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
        const finalScore = score;
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="flappy-modal-title">
                <h2 id="flappy-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${finalScore}</strong></p>
                <ol class="leaderboard" id="flappy-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="flappy-initials-form" class="initials-form" autocomplete="off">
                    <label for="flappy-initials">Your Initials</label>
                    <input id="flappy-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off" autocapitalize="characters">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="flappy-initials-form" id="flappy-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="flappy-again" class="btn btn-ghost">Play Again</button>
                    <button type="button" id="flappy-home" class="btn btn-ghost">Home</button>
                </div>
            </div>`;
        container.appendChild(overlay);

        const form = overlay.querySelector('#flappy-initials-form');
        const input = overlay.querySelector('#flappy-initials');
        const saveBtn = overlay.querySelector('#flappy-save');
        const againBtn = overlay.querySelector('#flappy-again');
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
                overlay.querySelector('#flappy-leaderboard').innerHTML = renderLeaderboard();
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

        overlay.querySelector('#flappy-home').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('hub:home'));
        });
    }

    function resetGame() {
        score = 0;
        scoreDisplay.textContent = 'Score: 0';
        birdY = canvas.height / 2;
        birdVy = 0;
        pipes = [];
        state = 'ready';
        setBlur(false);

        if (animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(draw);
    }

    function draw() {
        update();
        if (state === 'gameover') return; // Modal is up; stop the loop

        drawSky();
        drawClouds();
        drawPipes();
        drawGround();
        drawBird();
        if (state === 'ready') drawHint();

        animationId = requestAnimationFrame(draw);
    }

    resetGame();

    return {
        destroy: () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('keydown', keyDownHandler);
            canvas.removeEventListener('pointerdown', pointerHandler);
        }
    };
}
