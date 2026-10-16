export function init(container) {
    const STORAGE_KEY = 'tetris_highscores';

    const SCALE = 25; // px per grid cell in the backing store
    const COLS = 12;
    const ROWS = 20;
    const PANEL_COLS = 5; // side panel width, in cells
    const DROP_MS = 1000; // gravity: one cell per second
    const CLEAR_MS = 420; // line-clear animation: flash + collapse

    const canvas = document.createElement('canvas');
    canvas.width = (COLS + PANEL_COLS) * SCALE;
    canvas.height = ROWS * SCALE;
    canvas.className = 'game-canvas';

    const scoreDisplay = document.createElement('div');
    scoreDisplay.className = 'score-display';
    scoreDisplay.textContent = 'Score: 0';

    const touchHint = document.createElement('p');
    touchHint.className = 'touch-hint';
    touchHint.textContent = 'Tap to rotate · Drag to move or drop · Hold to fast-drop · Space hard-drops.';

    container.append(scoreDisplay, canvas, touchHint);

    const ctx = canvas.getContext('2d');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => prefersReducedMotion.matches;

    const COLORS = {
        'I': '#22d3ee', // Cyan
        'J': '#60a5fa', // Blue
        'L': '#fbbf24', // Amber
        'O': '#facc15', // Yellow
        'S': '#4ade80', // Green
        'T': '#c084fc', // Purple
        'Z': '#fb7185'  // Rose
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

    // ---------------- Small helpers ----------------
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

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function roundRectPath(c, rx, ry, w, h, r) {
        c.beginPath();
        c.moveTo(rx + r, ry);
        c.arcTo(rx + w, ry, rx + w, ry + h, r);
        c.arcTo(rx + w, ry + h, rx, ry + h, r);
        c.arcTo(rx, ry + h, rx, ry, r);
        c.arcTo(rx, ry, rx + w, ry, r);
        c.closePath();
    }

    // Pre-rendered block sprites (bevel + neon glow baked in, so the main
    // loop never pays for shadowBlur on up to 240 live cells)
    function makeSprite(color) {
        const size = SCALE * 2; // 2x2 cells: block + glow margin
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const g = c.getContext('2d');
        const m = SCALE * 0.5; // block origin inside the sprite
        const bs = SCALE * 0.92;
        g.shadowColor = color;
        g.shadowBlur = SCALE * 0.5;
        const grad = g.createLinearGradient(0, m, 0, m + bs);
        grad.addColorStop(0, shade(color, 0.45));
        grad.addColorStop(1, color);
        g.fillStyle = grad;
        roundRectPath(g, m, m, bs, bs, SCALE * 0.14);
        g.fill();
        g.shadowBlur = 0;
        // Darker bottom edge for a raised 3D tile feel
        g.fillStyle = shade(color, -0.45);
        g.fillRect(m + SCALE * 0.08, m + bs - SCALE * 0.13, bs - SCALE * 0.16, SCALE * 0.11);
        // Glossy top highlight
        g.fillStyle = 'rgba(255, 255, 255, 0.42)';
        roundRectPath(g, m + SCALE * 0.12, m + SCALE * 0.09, bs - SCALE * 0.24, SCALE * 0.09, SCALE * 0.045);
        g.fill();
        return c;
    }

    const spriteFor = {};
    for (const color of Object.values(COLORS)) spriteFor[color] = makeSprite(color);

    function drawBlockAt(x, y, color) {
        const spr = spriteFor[color];
        if (spr) {
            ctx.drawImage(spr, x - 0.5, y - 0.5, 2, 2);
        } else {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    // Static background gradient (device space, created once)
    const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGradient.addColorStop(0, '#0d0916');
    bgGradient.addColorStop(1, '#171126');

    // ---------------- Game state ----------------
    let arena = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    let score = 0;
    let lines = 0;
    let bestScore = 0;
    let player = {
        pos: {x: 0, y: 0},
        matrix: null,
        color: null
    };
    let nextPiece = null;
    let bag = [];
    let renderPos = { x: 0, y: 0 }; // smoothed position of the falling piece
    let dropCounter = 0;
    let lastTime = 0;
    let rafId = null;
    let isGameOver = false;
    let destroyed = false;

    // Juice state
    let lineClear = null; // { rows, start } — animation in progress
    let slam = null;      // { cells, start } — landing squash
    let particles = [];
    let floaters = [];
    let shake = { mag: 0, start: 0, dur: 0 };
    let previewStart = 0;

    // ---------------- Piece generation (7-bag) ----------------
    function createPiece() {
        if (bag.length === 0) {
            bag = 'IJLOSTZ'.split('');
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [bag[i], bag[j]] = [bag[j], bag[i]];
            }
        }
        const type = bag.pop();
        return {
            matrix: TETROMINOES[type].map(row => row.slice()),
            color: COLORS[type]
        };
    }

    function trimMatrix(m) {
        let minR = m.length, maxR = -1, minC = m.length, maxC = -1;
        m.forEach((row, y) => row.forEach((v, x) => {
            if (v) {
                if (y < minR) minR = y;
                if (y > maxR) maxR = y;
                if (x < minC) minC = x;
                if (x > maxC) maxC = x;
            }
        }));
        return m.slice(minR, maxR + 1).map(row => row.slice(minC, maxC + 1));
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

    function findFullRows() {
        const rows = [];
        for (let y = 0; y < ROWS; y++) {
            if (arena[y].every(v => v !== 0)) rows.push(y);
        }
        return rows;
    }

    function removeRows(rows) {
        // Bottom-up so earlier splices don't shift later indices
        for (let i = rows.length - 1; i >= 0; i--) {
            arena.splice(rows[i], 1);
        }
        while (arena.length < ROWS) {
            arena.unshift(Array(COLS).fill(0));
        }
    }

    // ---------------- Juice helpers ----------------
    function triggerShake(magPx, durMs) {
        if (reduced()) return;
        shake.mag = magPx;
        shake.dur = durMs;
        shake.start = performance.now();
    }

    function spawnLineShards(rows) {
        if (reduced()) return;
        for (const y of rows) {
            for (let x = 0; x < COLS; x++) {
                const color = arena[y][x];
                for (let i = 0; i < 2; i++) {
                    particles.push({
                        x: x + Math.random(),
                        y: y + Math.random(),
                        vx: (Math.random() - 0.5) * 5,
                        vy: -(0.5 + Math.random() * 3),
                        g: 9,
                        size: 0.06 + Math.random() * 0.09,
                        life: 1,
                        decay: 1 / (0.45 + Math.random() * 0.4),
                        color
                    });
                }
            }
        }
    }

    function spawnDust(cells) {
        if (reduced()) return;
        for (const c of cells) {
            for (let i = 0; i < 2; i++) {
                particles.push({
                    x: c.x + 0.15 + Math.random() * 0.7,
                    y: c.y + 0.95,
                    vx: (Math.random() - 0.5) * 2.4,
                    vy: -(0.4 + Math.random() * 1.2),
                    g: 7,
                    size: 0.04 + Math.random() * 0.04,
                    life: 1,
                    decay: 1 / (0.25 + Math.random() * 0.15),
                    color: shade(c.color, 0.55)
                });
            }
        }
    }

    function updateParticles(dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= p.decay * dt;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.g * dt;
        }
    }

    // ---------------- Game flow ----------------
    function resolveClearedRows(rows) {
        const points = rows.length * rows.length * 10; // 10 / 40 / 90 / 160
        score += points;
        lines += rows.length;
        scoreDisplay.textContent = `Score: ${score}`;
        // Line-clear arpeggio — one note per cleared line
        const notes = [440, 554, 659, 880];
        for (let i = 0; i < Math.min(rows.length, 4); i++) {
            setTimeout(() => playSound(notes[i], 'square', 0.12), i * 70);
        }
        if (reduced()) {
            removeRows(rows);
            playerReset();
            return;
        }
        lineClear = { rows, start: performance.now() };
        spawnLineShards(rows);
        triggerShake(4, 160);
        floaters.push({
            x: COLS / 2,
            y: rows[rows.length >> 1] + 0.4,
            text: `+${points}`,
            start: performance.now()
        });
    }

    function finishLineClear() {
        removeRows(lineClear.rows);
        lineClear = null;
        playerReset();
    }

    function lockPiece(hard) {
        merge(arena, player);

        const cells = [];
        player.matrix.forEach((row, y) => row.forEach((v, x) => {
            if (v !== 0) cells.push({ x: x + player.pos.x, y: y + player.pos.y, color: player.color });
        }));

        if (!reduced()) slam = { cells, start: performance.now() };
        if (hard) {
            triggerShake(5, 130);
            spawnDust(cells);
            playSound(130, 'sine', 0.09); // thump
        } else {
            playSound(190, 'sine', 0.05); // soft lock
        }

        const rows = findFullRows();
        if (rows.length > 0) {
            resolveClearedRows(rows);
        } else {
            playerReset();
        }
    }

    function playerDrop() {
        if (isGameOver || lineClear) return;
        player.pos.y++;
        if (collide(arena, player)) {
            player.pos.y--;
            lockPiece(false);
        }
        dropCounter = 0;
    }

    function playerHardDrop() {
        if (isGameOver || lineClear) return;
        const probe = { matrix: player.matrix, pos: { x: player.pos.x, y: player.pos.y } };
        let dist = 0;
        while (!collide(arena, probe)) {
            probe.pos.y++;
            dist++;
        }
        player.pos.y = probe.pos.y - 1;
        renderPos.y = player.pos.y; // snap — no interpolation for a hard drop
        dropCounter = 0;
        lockPiece(true);
    }

    function playerMove(dir) {
        if (isGameOver || lineClear) return;
        player.pos.x += dir;
        if (collide(arena, player)) {
            player.pos.x -= dir;
        }
    }

    function playerRotate() {
        if (isGameOver || lineClear) return;
        const oldMatrix = player.matrix;
        player.matrix = rotate(player.matrix);
        if (collide(arena, player)) {
            player.matrix = oldMatrix;
        }
    }

    function playerReset() {
        player.matrix = nextPiece.matrix;
        player.color = nextPiece.color;
        player.pos.y = 0;
        player.pos.x = (COLS / 2 | 0) - (player.matrix[0].length / 2 | 0);
        renderPos = { x: player.pos.x, y: player.pos.y };
        previewStart = performance.now();
        nextPiece = createPiece();
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
        bestScore = scores[0].score;
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

    // ---------------- Rendering ----------------
    function drawGrid() {
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.05)';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        for (let x = 0; x <= COLS; x++) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, ROWS);
        }
        for (let y = 0; y <= ROWS; y++) {
            ctx.moveTo(0, y);
            ctx.lineTo(COLS, y);
        }
        ctx.stroke();
        // Play field border
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.18)';
        ctx.lineWidth = 0.05;
        roundRectPath(ctx, 0.025, 0.025, COLS - 0.05, ROWS - 0.05, 0.15);
        ctx.stroke();
    }

    function drawArena(time) {
        // During a line clear, blocks above the cleared rows ease downward
        let collapse = 0;
        if (lineClear && !reduced()) {
            const t = Math.min(1, (time - lineClear.start) / CLEAR_MS);
            collapse = t < 0.35 ? 0 : easeOutCubic((t - 0.35) / 0.65);
        }
        const cleared = lineClear ? lineClear.rows : null;
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const v = arena[y][x];
                if (!v) continue;
                if (cleared && cleared.includes(y)) continue; // the flash bar covers it
                let dy = 0;
                if (collapse > 0) {
                    let below = 0;
                    for (const ry of cleared) if (ry > y) below++;
                    dy = below * collapse;
                }
                drawBlockAt(x, y + dy, v);
            }
        }
    }

    function drawClearFlash(time) {
        if (reduced()) return;
        const t = Math.min(1, (time - lineClear.start) / CLEAR_MS);
        const alpha = t < 0.35 ? 0.9 * (t / 0.35) : 0.9 * (1 - (t - 0.35) / 0.65);
        const grow = t * 0.12;
        for (const y of lineClear.rows) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            roundRectPath(ctx, -grow, y - grow * 0.5, COLS + grow * 2, 1 + grow, 0.12);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawSlam(time) {
        if (!slam) return;
        const t = (time - slam.start) / 130;
        if (t >= 1) {
            slam = null;
            return;
        }
        const k = 0.28 * (1 - t) * (1 - t);
        for (const c of slam.cells) {
            ctx.save();
            ctx.translate(c.x + 0.5, c.y + 1); // squash anchored on the cell's bottom edge
            ctx.scale(1 + k * 0.7, 1 - k);
            drawBlockAt(-0.5, -1, c.color);
            ctx.restore();
        }
    }

    function drawGhost() {
        // Project the current piece to its landing row
        const probe = { matrix: player.matrix, pos: { x: player.pos.x, y: player.pos.y } };
        while (!collide(arena, probe)) probe.pos.y++;
        const gy = probe.pos.y - 1;
        if (gy <= player.pos.y) return;
        ctx.lineWidth = 0.035;
        ctx.setLineDash([0.09, 0.07]);
        for (let y = 0; y < player.matrix.length; y++) {
            for (let x = 0; x < player.matrix[y].length; x++) {
                if (!player.matrix[y][x]) continue;
                const bx = x + player.pos.x;
                const by = y + gy;
                roundRectPath(ctx, bx + 0.07, by + 0.07, 0.86, 0.86, 0.12);
                ctx.fillStyle = withAlpha(player.color, 0.07);
                ctx.fill();
                ctx.strokeStyle = withAlpha(player.color, 0.45);
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);
    }

    function drawPlayer() {
        player.matrix.forEach((row, y) => row.forEach((v, x) => {
            if (v !== 0) drawBlockAt(renderPos.x + x, renderPos.y + y, player.color);
        }));
    }

    function drawParticles() {
        for (const p of particles) {
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }

    function drawFloaters(time) {
        for (let i = floaters.length - 1; i >= 0; i--) {
            const f = floaters[i];
            const t = (time - f.start) / 700;
            if (t >= 1) {
                floaters.splice(i, 1);
                continue;
            }
            ctx.globalAlpha = 1 - t;
            ctx.font = '700 0.55px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#e9d5ff';
            ctx.fillText(f.text, f.x, f.y - t * 1.4);
        }
        ctx.globalAlpha = 1;
    }

    function panelText(text, x, y, size, weight, alpha, color = '233, 213, 255') {
        ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fillText(text, x, y);
    }

    function drawPanel(time) {
        const PX0 = 12.35;
        const PX1 = 16.65;
        const PCX = (PX0 + PX1) / 2;

        // Panel box
        ctx.fillStyle = 'rgba(167, 139, 250, 0.06)';
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
        ctx.lineWidth = 0.04;
        roundRectPath(ctx, PX0, 0.35, PX1 - PX0, ROWS - 0.7, 0.4);
        ctx.fill();
        ctx.stroke();

        panelText('N E X T', PCX, 1.4, 0.5, 600, 0.55);

        // Preview box
        ctx.fillStyle = 'rgba(10, 7, 18, 0.5)';
        roundRectPath(ctx, PX0 + 0.25, 1.7, PX1 - PX0 - 0.5, 5, 0.25);
        ctx.fill();

        // Next piece, scaled down and popping in when it becomes known
        const pt = Math.min(1, (time - previewStart) / 160);
        const pop = reduced() ? 1 : 0.6 + 0.4 * easeOutCubic(pt);
        ctx.save();
        ctx.globalAlpha = reduced() ? 1 : Math.min(1, pt * 2.5);
        ctx.translate(PCX, 4.2);
        ctx.scale(pop * 0.8, pop * 0.8);
        ctx.translate(-PCX, -4.2);
        const pm = trimMatrix(nextPiece.matrix);
        const ox = PCX - pm[0].length / 2;
        const oy = 4.2 - pm.length / 2;
        pm.forEach((row, y) => row.forEach((v, x) => {
            if (v) drawBlockAt(ox + x, oy + y, nextPiece.color);
        }));
        ctx.restore();

        // Divider
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.15)';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.moveTo(PX0 + 0.3, 7.35);
        ctx.lineTo(PX1 - 0.3, 7.35);
        ctx.stroke();

        panelText('LINES', PCX, 8.4, 0.5, 600, 0.5);
        panelText(String(lines), PCX, 9.85, 0.95, 700, 0.95, '255, 255, 255');

        ctx.beginPath();
        ctx.moveTo(PX0 + 0.3, 10.6);
        ctx.lineTo(PX1 - 0.3, 10.6);
        ctx.stroke();

        panelText('BEST', PCX, 11.65, 0.5, 600, 0.5);
        panelText(String(bestScore), PCX, 13.1, 0.95, 700, 0.95, '255, 255, 255');

        panelText('SPACE · HARD DROP', PCX, 19.4, 0.5, 500, 0.3);
    }

    function draw(time) {
        // Background in device space (not affected by the shake)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Screen shake offset (device px)
        let ox = 0, oy = 0;
        if (!reduced() && shake.mag > 0) {
            const t = (performance.now() - shake.start) / shake.dur;
            if (t < 1) {
                const f = 1 - t;
                ox = (Math.random() * 2 - 1) * shake.mag * f;
                oy = (Math.random() * 2 - 1) * shake.mag * f;
            }
        }
        ctx.setTransform(SCALE, 0, 0, SCALE, ox, oy);

        drawGrid();
        drawArena(time);
        drawSlam(time);
        if (lineClear) drawClearFlash(time);
        if (!lineClear && !isGameOver) {
            drawGhost();
            drawPlayer();
        }
        drawParticles();
        drawFloaters(time);
        drawPanel(time);
    }

    function update(time = 0) {
        if (destroyed) return;
        let deltaTime = time - lastTime;
        lastTime = time;
        if (deltaTime < 0 || deltaTime > 100) deltaTime = 16;

        if (!isGameOver) {
            if (lineClear) {
                if (time - lineClear.start >= CLEAR_MS) finishLineClear();
            } else {
                dropCounter += deltaTime;
                if (dropCounter > DROP_MS) playerDrop();
            }
            // Ease the rendered position toward the grid position
            const k = reduced() ? 1 : Math.min(1, deltaTime / 80);
            renderPos.x += (player.pos.x - renderPos.x) * k;
            renderPos.y += (player.pos.y - renderPos.y) * k;
            if (Math.abs(player.pos.x - renderPos.x) < 0.002) renderPos.x = player.pos.x;
            if (Math.abs(player.pos.y - renderPos.y) < 0.002) renderPos.y = player.pos.y;

            updateParticles(deltaTime / 1000);
        }

        draw(time);
        rafId = requestAnimationFrame(update);
    }

    // ---------------- Controls ----------------
    function keyDownHandler(e) {
        if (isGameOver || lineClear) return;
        if (e.code === 'Space') {
            e.preventDefault();
            playerHardDrop();
            return;
        }
        switch(e.key) {
            case 'ArrowLeft': playerMove(-1); break;
            case 'ArrowRight': playerMove(1); break;
            case 'ArrowDown': playerDrop(); break;
            case 'ArrowUp': playerRotate(); break;
        }
    }
    window.addEventListener('keydown', keyDownHandler);

    // Touch controls: tap = rotate, drag = the piece follows the finger
    // (1 cell of drag = exactly 1 cell of movement/drop), hold still = fast drop
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let isTouching = false;
    let longPressTimer = null;
    let softDropTimer = null;
    let carryX = 0; // fractional drag not yet converted into a cell step
    let carryY = 0;

    function stopSoftDrop() {
        if (softDropTimer) {
            clearInterval(softDropTimer);
            softDropTimer = null;
        }
    }

    function clearLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function touchStartHandler(e) {
        if (isGameOver || lineClear) return;
        e.preventDefault();
        const touch = e.touches[0];
        touchStartX = lastTouchX = touch.clientX;
        touchStartY = lastTouchY = touch.clientY;
        touchStartTime = Date.now();
        carryX = 0;
        carryY = 0;
        isTouching = true;
        // Holding still = accelerate the piece
        longPressTimer = setTimeout(() => {
            if (!isTouching || isGameOver) return;
            softDropTimer = setInterval(() => {
                if (isGameOver) {
                    stopSoftDrop();
                    return;
                }
                playerDrop();
            }, 80);
        }, 280);
    }

    function touchMoveHandler(e) {
        if (!isTouching || isGameOver || lineClear) return;
        e.preventDefault();
        const touch = e.touches[0];
        // Finger moved: this is a drag, not a hold
        if (Math.abs(touch.clientX - touchStartX) > 10 || Math.abs(touch.clientY - touchStartY) > 10) {
            clearLongPress();
            stopSoftDrop();
        }

        // The piece follows the finger: 1 cell of drag = 1 cell of the game,
        // with the fractional remainder carried over for precise control.
        // The canvas now includes the side panel, so a cell is 1/17 of its width.
        const rect = canvas.getBoundingClientRect();
        const cellW = rect.width / (COLS + PANEL_COLS);
        const cellH = rect.height / ROWS;
        carryX += touch.clientX - lastTouchX;
        carryY += touch.clientY - lastTouchY;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;

        let steps = 0;
        while (Math.abs(carryX) >= cellW - 0.5 && steps < 6) {
            if (isGameOver) break;
            playerMove(carryX > 0 ? 1 : -1);
            carryX -= Math.sign(carryX) * cellW;
            steps++;
        }
        steps = 0;
        while (carryY >= cellH - 0.5 && steps < 6) {
            if (isGameOver) break;
            playerDrop();
            carryY -= cellH;
            steps++;
        }
    }

    function touchEndHandler(e) {
        if (!isTouching) return;
        e.preventDefault();
        isTouching = false;
        clearLongPress();
        stopSoftDrop();
        if (isGameOver || lineClear) return;

        // Tap (no movement, quick) = rotate
        const touch = e.changedTouches[0];
        const absDx = Math.abs(touch.clientX - touchStartX);
        const absDy = Math.abs(touch.clientY - touchStartY);
        const duration = Date.now() - touchStartTime;
        if (absDx < 12 && absDy < 12 && duration < 250) {
            playerRotate();
        }
    }
    canvas.addEventListener('touchstart', touchStartHandler, { passive: false });
    canvas.addEventListener('touchmove', touchMoveHandler, { passive: false });
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

    // ---------------- Lifecycle ----------------
    function resetGame() {
        arena = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        score = 0;
        lines = 0;
        scoreDisplay.textContent = 'Score: 0';
        bestScore = getScores()[0] ? getScores()[0].score : 0;
        canvas.style.filter = 'none';
        bag = [];
        nextPiece = createPiece();
        lineClear = null;
        slam = null;
        particles = [];
        floaters = [];
        shake = { mag: 0, start: 0, dur: 0 };
        dropCounter = 0;
        lastTime = 0;
        isGameOver = false;
        stopSoftDrop();
        clearLongPress();
        playerReset();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(update);
    }

    resetGame();

    return {
        destroy: () => {
            destroyed = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener('keydown', keyDownHandler);
            clearLongPress();
            stopSoftDrop();
            canvas.removeEventListener('touchstart', touchStartHandler);
            canvas.removeEventListener('touchmove', touchMoveHandler);
            canvas.removeEventListener('touchend', touchEndHandler);
            document.removeEventListener('touchmove', pageTouchMoveHandler);
        }
    };
}
