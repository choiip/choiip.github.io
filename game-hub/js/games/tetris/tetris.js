export function init(container) {
    const STORAGE_KEY = 'tetris_highscores';

    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 400;
    canvas.className = 'game-canvas';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    container.append(scoreDisplay, canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(20, 20);

    const COLORS = {
        'I': '#00f0f0', // Cyan
        'J': '#0000f0', // Blue
        'L': '#f0a000', // Orange
        'O': '#f0f000', // Yellow
        'S': '#00f000', // Green
        'T': '#a000f0', // Purple
        'Z': '#f00000'  // Red
    };

    const TETROMINOES = {
        'I': [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
        'J': [[1,0,0], [1,1,1], [0,0,0]],
        'L': [[0,0,1], [1,1,1], [0,0,0]],
        'O': [[1,1], [1,1]],
        'S': [[0,1,1], [1,1,0], [0,0,0]],
        'T': [[0,1,0], [1,1,1], [0,0,0]],
        'Z': [[1,1,0], [0,1,1], [0,0,0]]
    };

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Audio Context for sound effects
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playSound(freq, type, duration) {
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

    let arena = Array.from({ length: 20 }, () => Array(12).fill(0));
    let score = 0;
    let player = {
        pos: {x: 0, y: 0},
        matrix: null,
        color: null
    };
    let dropCounter = 0;
    let lastTime = 0;
    let rafId = null;
    let isGameOver = false;
    let destroyed = false;

    function createPiece() {
        const types = 'IJLOSTZ';
        const type = types[Math.floor(Math.random() * types.length)];
        return {
            matrix: TETROMINOES[type],
            color: COLORS[type]
        };
    }

    function collide(arena, player) {
        const [m, o] = [player.matrix, player.pos];
        for (let y = 0; y < m.length; ++y) {
            for (let x = 0; x < m[y].length; ++x) {
                if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
                    return true;
                }
            }
        }
        return false;
    }

    function merge(arena, player) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    arena[y + player.pos.y][x + player.pos.x] = player.color;
                }
            });
        });
    }

    function rotate(matrix) {
        const result = matrix[0].map((_, index) => matrix.map(row => row[index]).reverse());
        return result;
    }

    function arenaSweep() {
        let rowCount = 0;
        outer: for (let y = arena.length - 1; y >= 0; y--) {
            for (let x = 0; x < arena[y].length; x++) {
                if (arena[y][x] === 0) continue outer;
            }
            const row = arena.splice(y, 1)[0].fill(0);
            arena.unshift(row);
            ++y;
            rowCount++;
        }
        if (rowCount > 0) {
            score += rowCount * rowCount * 10; // 10 / 40 / 90 / 160
            scoreDisplay.textContent = `Score: ${score}`;
            playSound(440, 'square', 0.2); // Line clear sound
            if (!prefersReducedMotion.matches) {
                canvas.style.transition = 'transform 0.1s ease';
                canvas.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    canvas.style.transform = 'scale(1)';
                }, 100);
            }
        }
    }

    function playerDrop() {
        player.pos.y++;
        if (collide(arena, player)) {
            player.pos.y--;
            merge(arena, player);
            playerReset();
            arenaSweep();
        }
        dropCounter = 0;
    }

    function playerMove(dir) {
        player.pos.x += dir;
        if (collide(arena, player)) {
            player.pos.x -= dir;
        }
    }

    function playerRotate() {
        const oldMatrix = player.matrix;
        player.matrix = rotate(player.matrix);
        if (collide(arena, player)) {
            player.matrix = oldMatrix;
        }
    }

    function playerReset() {
        const piece = createPiece();
        player.matrix = piece.matrix;
        player.color = piece.color;
        player.pos.y = 0;
        player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
        if (collide(arena, player)) {
            gameOver();
        }
    }

    function gameOver() {
        isGameOver = true;

        playSound(220, 'sawtooth', 0.5);

        // Blur canvas
        canvas.style.transition = 'filter 0.3s ease';
        canvas.style.filter = 'blur(3px)';

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
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tetris-modal-title">
                <h2 id="tetris-modal-title">${headline}</h2>
                <p class="final-score">Final score: <strong>${score}</strong></p>
                <ol class="leaderboard" id="tetris-leaderboard" aria-live="polite">${renderLeaderboard()}</ol>
                <form id="tetris-initials-form" class="initials-form" autocomplete="off">
                    <label for="tetris-initials">Your Initials</label>
                    <input id="tetris-initials" name="initials" maxlength="3" placeholder="ALX" spellcheck="false" autocomplete="off">
                </form>
                <div class="modal-actions">
                    <button type="submit" form="tetris-initials-form" id="tetris-save" class="btn btn-primary">Save Score</button>
                    <button type="button" id="tetris-again" class="btn btn-ghost">Play Again</button>
                </div>
            </div>`;
        container.appendChild(overlay);

        const form = overlay.querySelector('#tetris-initials-form');
        const input = overlay.querySelector('#tetris-initials');
        const saveBtn = overlay.querySelector('#tetris-save');
        let saved = false;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (saved) return;
            saved = true;
            const initials = (input.value.trim().toUpperCase() || '???').slice(0, 3);
            saveHighScore(initials, score);
            overlay.querySelector('#tetris-leaderboard').innerHTML = renderLeaderboard();
            saveBtn.textContent = 'Saved ✓';
            saveBtn.disabled = true;
            input.disabled = true;
        });

        overlay.querySelector('#tetris-again').addEventListener('click', () => {
            overlay.remove();
            resetGame();
        });

        input.focus();
    }

    function update(time = 0) {
        if (isGameOver || destroyed) return;
        const deltaTime = time - lastTime;
        lastTime = time;

        dropCounter += deltaTime;
        if (dropCounter > 1000) {
            playerDrop();
        }

        draw();
        rafId = requestAnimationFrame(update);
    }

    function draw() {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawMatrix(arena, {x: 0, y: 0}, true);
        drawMatrix(player.matrix, player.pos, false, player.color);
    }

    function drawMatrix(matrix, offset, isArena = false, color = null) {
        matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    ctx.fillStyle = isArena ? value : color;
                    ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                    // Add border to blocks
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 0.05;
                    ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
                }
            });
        });
    }

    function keyDownHandler(e) {
        if (isGameOver) return;
        switch(e.key) {
            case 'ArrowLeft': playerMove(-1); break;
            case 'ArrowRight': playerMove(1); break;
            case 'ArrowDown': playerDrop(); break;
            case 'ArrowUp': playerRotate(); break;
        }
    }
    window.addEventListener('keydown', keyDownHandler);

    function resetGame() {
        arena = Array.from({ length: 20 }, () => Array(12).fill(0));
        score = 0;
        scoreDisplay.textContent = 'Score: 0';
        canvas.style.filter = 'none';
        dropCounter = 0;
        lastTime = 0;
        isGameOver = false;
        playerReset();
        rafId = requestAnimationFrame(update);
    }

    resetGame();

    return {
        destroy: () => {
            destroyed = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener('keydown', keyDownHandler);
        }
    };
}
