export function init(container) {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    canvas.style.border = '5px solid #fff';
    canvas.style.backgroundColor = '#000';
    canvas.style.display = 'block';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.id = 'breakout-score';
    scoreDisplay.style.fontSize = '24px';
    scoreDisplay.style.marginBottom = '10px';
    scoreDisplay.innerText = 'Score: 0';

    container.appendChild(scoreDisplay);
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');

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

    // Game State
    let score = 0;
    let isGameOver = false;
    let isGameWon = false;
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

    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);

    function keyDownHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') rightPressed = true;
        else if (e.key === 'Left' || e.key === 'ArrowLeft') leftPressed = true;
    }

    function keyUpHandler(e) {
        if (e.key === 'Right' || e.key === 'ArrowRight') rightPressed = false;
        else if (e.key === 'Left' || e.key === 'ArrowLeft') leftPressed = false;
    }

    function collisionDetection() {
        for (let c = 0; c < brickColumnCount; c++) {
            for (let r = 0; r < brickRowCount; r++) {
                const b = bricks[c][r];
                if (b.status === 1) {
                    if (x > b.x && x < b.x + brickWidth && y > b.y && y < b.y + brickHeight) {
                        dy = -dy;
                        b.status = 0;
                        score += 10;
                        scoreDisplay.innerText = `Score: ${score}`;
                        playSound(400, 'sine', 0.1); // Brick break sound
                        
                        if (score === brickRowCount * brickColumnCount * 10) {
                            isGameWon = true;
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
        playSound(600, 'sine', 0.5);
        alert('CONGRATULATIONS! YOU WIN!');
        resetGame();
    }

    function gameOver() {
        isGameOver = true;
        playSound(200, 'sawtooth', 0.5);
        
        const initials = prompt(`Game Over! Your score: ${score}\nEnter your initials (3 chars):`);
        const finalInitials = initials ? initials.substring(0, 3).toUpperCase() : '???';
        
        saveHighScore(finalInitials, score);
        showLeaderboard();
    }

    function saveHighScore(initials, score) {
        const scores = JSON.parse(localStorage.getItem('breakout_highscores') || '[]');
        scores.push({ initials, score, date: new Date().toLocaleDateString() });
        scores.sort((a, b) => b.score - a.score);
        localStorage.setItem('breakout_highscores', JSON.stringify(scores.slice(0, 5)));
    }

    function showLeaderboard() {
        const scores = JSON.parse(localStorage.getItem('breakout_highscores') || '[]');
        let leaderboardHtml = `<div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 10px; color: white; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; border: 2px solid white;">
            <h2>High Scores</h2>
            <ul style="list-style: none; padding: 0; font-family: monospace; font-size: 1.2rem;">
                ${scores.map((s, i) => `<li>${i+1}. ${s.initials} - ${s.score}</li>`).join('')}
            </ul>
            <button id="restart-breakout" style="margin-top: 10px; padding: 10px 20px; cursor: pointer;">Play Again</button>
        </div>`;
        
        const overlay = document.createElement('div');
        overlay.innerHTML = leaderboardHtml;
        container.appendChild(overlay);
        
        document.getElementById('restart-breakout').addEventListener('click', () => {
            overlay.remove();
            resetGame();
        });
    }

    function resetGame() {
        score = 0;
        scoreDisplay.innerText = 'Score: 0';
        x = canvas.width / 2;
        y = canvas.height - 30;
        dx = 2;
        dy = -2;
        paddleX = (canvas.width - paddleWidth) / 2;
        rightPressed = false;
        leftPressed = false;
        isGameOver = false;
        isGameWon = false;
        
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
        }
    };
}
