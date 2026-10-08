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

    let score = 0;
    let dx = 0, dy = 0;
    let snake = [];
    let food = {x: 5, y: 5};
    let gameInterval = null;
    let isGameOver = false;

    function drawGame() {
        if (isGameOver) return;

        if (dx === 0 && dy === 0) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'lime';
            snake.forEach(segment => ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2));
            ctx.fillStyle = 'red';
            ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);
            return;
        }

        const head = {x: snake[0].x + dx, y: snake[0].y + dy};

        if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
            gameOver();
            return;
        }

        if (snake.some(segment => segment.x === head.x && segment.y === head.y)) {
            gameOver();
            return;
        }

        snake.unshift(head);

        if (head.x === food.x && head.y === food.y) {
            score += 10;
            scoreDisplay.textContent = `Score: ${score}`;
            playSound(600, 'sine', 0.1); // Eat sound
            generateFood();
        } else {
            snake.pop();
        }

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'lime';
        snake.forEach(segment => ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2));

        ctx.fillStyle = 'red';
        ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);
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
        setBlur(false);
        generateFood();
        if (gameInterval) clearInterval(gameInterval);
        gameInterval = setInterval(drawGame, 150);
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
            clearInterval(gameInterval);
            window.removeEventListener('keydown', keyDownHandler);
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchend', touchEndHandler);
            document.removeEventListener('touchmove', pageTouchMoveHandler);
        }
    };
}
