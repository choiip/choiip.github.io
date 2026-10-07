export function init(container) {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 400;
    canvas.style.border = '5px solid #fff';
    canvas.style.backgroundColor = '#000';
    canvas.style.display = 'block';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.id = 'tetris-score';
    scoreDisplay.style.fontSize = '24px';
    scoreDisplay.style.marginBottom = '10px';
    scoreDisplay.innerText = 'Score: 0';

    container.appendChild(scoreDisplay);
    container.appendChild(canvas);

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
            score += rowCount * 100;
            scoreDisplay.innerText = `Score: ${score}`;
            playSound(440, 'square', 0.2); // Line clear sound
            triggerLineAnimation();
        }
    }

    function triggerLineAnimation() {
        canvas.style.transition = 'transform 0.1s';
        canvas.style.transform = 'scale(1.02)';
        setTimeout(() => {
            canvas.style.transform = 'scale(1)';
        }, 100);
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
        clearInterval(gameInterval);
        
        // Sound effect
        playSound(220, 'sawtooth', 0.5);
        
        // Blur canvas
        canvas.style.filter = 'blur(3px)';
        canvas.style.transition = 'filter 0.3s';

        const initials = prompt(`Game Over! Your score: ${score}\nEnter your initials (3 chars):`);
        const finalInitials = initials ? initials.substring(0, 3).toUpperCase() : '???';
        
        saveHighScore(finalInitials, score);
        showLeaderboard();
    }

    function saveHighScore(initials, score) {
        const scores = JSON.parse(localStorage.getItem('tetris_highscores') || '[]');
        scores.push({ initials, score, date: new Date().toLocaleDateString() });
        scores.sort((a, b) => b.score - a.score);
        localStorage.setItem('tetris_highscores', JSON.stringify(scores.slice(0, 5)));
    }

    function showLeaderboard() {
        const scores = JSON.parse(localStorage.getItem('tetris_highscores') || '[]');
        let leaderboardHtml = `<div style="background: rgba(0,0,0,0.9); padding: 20px; border-radius: 10px; color: white; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; border: 2px solid white; box-shadow: 0 0 20px rgba(0,0,0,0.5); z-index: 10;">
            <h2 style="margin-top: 0;">High Scores</h2>
            <ul style="list-style: none; padding: 0; font-family: monospace; font-size: 1.2rem;">
                ${scores.map((s, i) => `<li style="margin-bottom: 5px;">${i+1}. ${s.initials} - ${s.score}</li>`).join('')}
            </ul>
            <button id="restart-tetris" style="margin-top: 15px; padding: 10px 20px; cursor: pointer; font-weight: bold; background: #fff; color: #000; border: none; border-radius: 5px;">Play Again</button>
        </div>`;
        
        const overlay = document.createElement('div');
        overlay.innerHTML = leaderboardHtml;
        container.appendChild(overlay);
        
        document.getElementById('restart-tetris').addEventListener('click', () => {
            overlay.remove();
            resetGame();
        });
    }

    let dropCounter = 0;
    let lastTime = 0;
    let isGameOver = false;
    let gameInterval;

    function update(time = 0) {
        if (isGameOver) return;
        const deltaTime = time - lastTime;
        lastTime = time;

        dropCounter += deltaTime;
        if (dropCounter > 1000) {
            playerDrop();
        }

        draw();
        requestAnimationFrame(update);
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

    window.addEventListener('keydown', (e) => {
        if (isGameOver) return;
        switch(e.key) {
            case 'ArrowLeft': playerMove(-1); break;
            case 'ArrowRight': playerMove(1); break;
            case 'ArrowDown': playerDrop(); break;
            case 'ArrowUp': playerRotate(); break;
        }
    });

    function resetGame() {
        arena = Array.from({ length: 20 }, () => Array(12).fill(0));
        score = 0;
        scoreDisplay.innerText = 'Score: 0';
        canvas.style.filter = 'none';
        playerReset();
        isGameOver = false;
        requestAnimationFrame(update);
    }

    resetGame();
    return {
        destroy: () => {
            // Cleanup logic
        }
    };
}
