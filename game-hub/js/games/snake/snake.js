export function init(container) {
    // Create Game Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    canvas.style.border = '5px solid #fff';
    canvas.style.backgroundColor = '#000';
    canvas.style.display = 'block';

    // Create UI Elements
    const scoreDisplay = document.createElement('div');
    scoreDisplay.id = 'snake-score';
    scoreDisplay.style.fontSize = '24px';
    scoreDisplay.style.marginBottom = '10px';
    scoreDisplay.innerText = 'Score: 0';

    container.appendChild(scoreDisplay);
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const gridSize = 20;
    const tileCount = canvas.width / gridSize;

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
            scoreDisplay.innerText = `Score: ${score}`;
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

    function gameOver() {
        isGameOver = true;
        clearInterval(gameInterval);
        
        playSound(200, 'sawtooth', 0.5); // Game over sound
        
        const initials = prompt(`Game Over! Your score: ${score}\nEnter your initials (3 chars):`);
        const finalInitials = initials ? initials.substring(0, 3).toUpperCase() : '???';
        
        saveHighScore(finalInitials, score);
        showLeaderboard();
    }

    function saveHighScore(initials, score) {
        const scores = JSON.parse(localStorage.getItem('snake_highscores') || '[]');
        scores.push({ initials, score, date: new Date().toLocaleDateString() });
        scores.sort((a, b) => b.score - a.score);
        localStorage.setItem('snake_highscores', JSON.stringify(scores.slice(0, 5)));
    }

    function showLeaderboard() {
        const scores = JSON.parse(localStorage.getItem('snake_highscores') || '[]');
        let leaderboardHtml = `<div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 10px; color: white; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; border: 2px solid white;">
            <h2>High Scores</h2>
            <ul style="list-style: none; padding: 0; font-family: monospace; font-size: 1.2rem;">
                ${scores.map((s, i) => `<li>${i+1}. ${s.initials} - ${s.score}</li>`).join('')}
            </ul>
            <button id="restart-snake" style="margin-top: 10px; padding: 10px 20px; cursor: pointer;">Play Again</button>
        </div>`;
        
        const overlay = document.createElement('div');
        overlay.innerHTML = leaderboardHtml;
        container.appendChild(overlay);
        
        document.getElementById('restart-snake').addEventListener('click', () => {
            overlay.remove();
            resetGame();
        });
    }

    function resetGame() {
        score = 0;
        scoreDisplay.innerText = 'Score: 0';
        
        // Center the snake (tileCount / 2)
        const centerX = Math.floor(tileCount / 2);
        const centerY = Math.floor(tileCount / 2);
        snake = [{x: centerX, y: centerY}];
        
        dx = 0; dy = 0;
        isGameOver = false;
        generateFood();
        if (gameInterval) clearInterval(gameInterval);
        gameInterval = setInterval(drawGame, 150);
    }

    window.addEventListener('keydown', (e) => {
        switch(e.key) {
            case 'ArrowUp': if (dy !== 1) { dx = 0; dy = -1; } break;
            case 'ArrowDown': if (dy !== -1) { dx = 0; dy = 1; } break;
            case 'ArrowLeft': if (dx !== 1) { dx = -1; dy = 0; } break;
            case 'ArrowRight': if (dx !== -1) { dx = 1; dy = 0; } break;
        }
    });

    resetGame();

    return {
        destroy: () => {
            clearInterval(gameInterval);
        }
    };
}
