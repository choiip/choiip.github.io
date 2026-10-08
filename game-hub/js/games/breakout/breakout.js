export function init(container) {
    const STORAGE_KEY = 'breakout_highscores';

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    canvas.className = 'game-canvas';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Drag across the court to move the paddle.';

    container.append(scoreDisplay, canvas, touchHint);

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

    // Game State
    let score = 0;
    let isGameOver = false;
    let animationId = null;

    // Paddle
    const paddleHeight = 10;
    const paddleWidth = 75;
    let paddleX = (canvas.width - paddleWidth) / 2;

    // Ball
    let x = canvas.width / 2;
    let y = canvas.height - 30;
    let dx = 2;
    let dy = -2;
    const ballRadius = 6;

    // Bricks
    const brickRowCount = 3;
    const brickColumnCount = 5;
    const brickWidth = 75;
    const brickHeight = 20;
    const brickPadding = 10;
    const brickOffsetTop = 30;
    const brickOffsetLeft = 30;

    const brickColors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF'];
    const bricks = [];
    for (let c = 0; c < brickColumnCount; c++) {
        bricks[c] = [];
        for (let r = 0; r < brickRowCount; r++) {
            bricks[c][r] = { x: 0, y: 0, status: 1, color: brickColors[r % brickColors.length] };
        }
    }

    // Controls
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

    function collisionDetection() {
        for (let c = 0; c < brickColumnCount; c++) {
            for (let r = 0; r < brickRowCount; r++) {
                const b = bricks[c][r];
                if (b.status === 1) {
                    if (x > b.x && x < b.x + brickWidth && y > b.y && y < b.y + brickHeight) {
                        dy = -dy;
                        b.status = 0;
                        score += 10;
                        scoreDisplay.textContent = `Score: ${score}`;
                        playSound(400, 'sine', 0.1); // Brick break sound

                        if (score === brickRowCount * brickColumnCount * 10) {
                            winGame();
                        }
                    }
                }
            }
        }
    }

    function drawBall() {
        ctx.beginPath();
        ctx.arc(x, y, ballRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.closePath();
    }

    function drawPaddle() {
        ctx.beginPath();
        ctx.rect(paddleX, canvas.height - paddleHeight, paddleWidth, paddleHeight);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.closePath();
    }

    function drawBricks() {
        for (let c = 0; c < brickColumnCount; c++) {
            for (let r = 0; r < brickRowCount; r++) {
                if (bricks[c][r].status === 1) {
                    const brickX = (c * (brickWidth + brickPadding)) + brickOffsetLeft;
                    const brickY = (r * (brickHeight + brickPadding)) + brickOffsetTop;
                    bricks[c][r].x = brickX;
                    bricks[c][r].y = brickY;
                    ctx.beginPath();
                    ctx.rect(brickX, brickY, brickWidth, brickHeight);
                    ctx.fillStyle = bricks[c][r].color;
                    ctx.fill();
                    ctx.closePath();
                }
            }
        }
    }

    function winGame() {
        isGameOver = true;
        // Little victory arpeggio
        playSound(523, 'sine', 0.15);
        setTimeout(() => playSound(659, 'sine', 0.15), 150);
        setTimeout(() => playSound(784, 'sine', 0.25), 300);
        showGameOverModal('You Win!');
    }

    function setBlur(on) {
        canvas.style.transition = on ? 'filter 0.3s ease' : 'none';
        canvas.style.filter = on ? 'blur(3px)' : 'none';
    }

    function gameOver() {
        isGameOver = true;
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

        // Reset bricks
        for (let c = 0; c < brickColumnCount; c++) {
            for (let r = 0; r < brickRowCount; r++) {
                bricks[c][r].status = 1;
            }
        }

        if (animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(draw);
    }

    function draw() {
        if (isGameOver) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawBricks();
        drawBall();
        drawPaddle();
        collisionDetection();

        if (isGameOver) return; // Win/loss triggered during collision

        if (x + dx > canvas.width - ballRadius || x + dx < ballRadius) {
            dx = -dx;
        }
        if (y + dy < ballRadius) {
            dy = -dy;
        } else if (y + dy > canvas.height - ballRadius) {
            if (x > paddleX && x < paddleX + paddleWidth) {
                dy = -dy;
                playSound(500, 'sine', 0.1); // Paddle hit sound
            } else {
                gameOver();
                return;
            }
        }

        if (rightPressed && paddleX < canvas.width - paddleWidth) {
            paddleX += 7;
        } else if (leftPressed && paddleX > 0) {
            paddleX -= 7;
        }

        x += dx;
        y += dy;

        animationId = requestAnimationFrame(draw);
    }

    resetGame();

    return {
        destroy: () => {
            cancelAnimationFrame(animationId);
            document.removeEventListener('keydown', keyDownHandler);
            document.removeEventListener('keyup', keyUpHandler);
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchmove', touchMoveHandler);
        }
    };
}
