export function init(container) {
    // =====================================================================
    // BLOCADE — digital adaptation of Blockade / Cul-de-sac (1975).
    // Rules source of truth: design/blockade-prd.md
    //
    // Turn-based board game: all logic is event-driven; the rAF loop only
    // animates. Opponent (3 AI levels or pass-&-play) is picked on a start
    // overlay. No leaderboard by design — the end modal has no initials
    // form (see PRD §11).
    // =====================================================================

    const COLS = 11;
    const ROWS = 14;
    const CELL = 34;
    const PAD = 16;
    const W = COLS * CELL + PAD * 2;   // 406
    const H = ROWS * CELL + PAD * 2;   // 508
    const WALLS_PER_SIDE = 9;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    const HOME_CELLS = [
        [{ c: 3, r: 3 }, { c: 7, r: 3 }],      // Red homes (top)
        [{ c: 3, r: 10 }, { c: 7, r: 10 }]     // Cyan homes (bottom)
    ];
    const ALL_HOMES = HOME_CELLS[0].concat(HOME_CELLS[1]);
    const PLAYER_COLORS = ['#f87171', '#22d3ee'];
    const PLAYER_NAMES = ['Red', 'Cyan'];
    const WALL_COLORS = { v: '#4ade80', h: '#38bdf8' };
    const INVALID_COLOR = '#fb7185';

    const OPPONENTS = [
        { id: 'easy', name: 'ROOKIE', tag: 'Easy AI — wanders pawns, fumbles walls' },
        { id: 'medium', name: 'TACTICIAN', tag: 'Medium AI — shortest paths, smart walls' },
        { id: 'hard', name: 'GRANDMASTER', tag: 'Hard AI — reads two moves ahead' },
        { id: 'human', name: '2 PLAYERS', tag: 'Pass & play — rival on the same couch' }
    ];

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- lifecycle ----------
    let destroyed = false;
    let rafId = 0;
    let demoRaf = 0;
    const timers = new Set();

    function addTimeout(fn, ms) {
        const id = setTimeout(() => {
            timers.delete(id);
            if (!destroyed) fn();
        }, ms);
        timers.add(id);
        return id;
    }

    function clearTimers() {
        timers.forEach(clearTimeout);
        timers.clear();
    }

    // ---------- audio ----------
    let audioCtx = null;

    function ensureAudio() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function tone(freq, dur, type, vol, when, slideTo) {
        const ac = ensureAudio();
        if (!ac) return;
        const t0 = ac.currentTime + (when || 0);
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type || 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol || 0.06, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ac.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
    }

    function sfx(name) {
        switch (name) {
            case 'click': tone(660, 0.05, 'triangle', 0.05); break;
            case 'select': tone(520, 0.06, 'triangle', 0.06, 0, 720); break;
            case 'slide': tone(340, 0.12, 'sine', 0.06, 0, 520); break;
            case 'capture': tone(220, 0.2, 'sawtooth', 0.07, 0, 110); break;
            case 'wall': tone(150, 0.1, 'square', 0.07, 0, 90); break;
            case 'invalid': tone(120, 0.14, 'sawtooth', 0.07); tone(96, 0.16, 'sawtooth', 0.05, 0.08); break;
            case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.11)); break;
            case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.26, 'sine', 0.07, i * 0.13)); break;
        }
    }

    // ---------- rules engine ----------
    let game = null;

    function pkey(c, r) { return c + ',' + r; }

    function newGameState() {
        return {
            pawns: [
                { id: 0, player: 0, c: 3, r: 3, alive: true },
                { id: 1, player: 0, c: 7, r: 3, alive: true },
                { id: 2, player: 1, c: 3, r: 10, alive: true },
                { id: 3, player: 1, c: 7, r: 10, alive: true }
            ],
            wallV: new Set(),   // "c,r" — left-right passage (c,r)<->(c+1,r) blocked
            wallH: new Set(),   // "c,r" — up-down passage (c,r)<->(c,r+1) blocked
            pv: new Set(),      // intersection "x,y" of every placed vertical wall
            ph: new Set(),      // intersection "x,y" of every placed horizontal wall
            placed: [],         // { x, y, orient, t0 } draw list with pop-animation clock
            left: [
                { v: WALLS_PER_SIDE, h: WALLS_PER_SIDE },
                { v: WALLS_PER_SIDE, h: WALLS_PER_SIDE }
            ],
            turn: 0
        };
    }

    function pawnAt(g, c, r) {
        for (const p of g.pawns) {
            if (p.alive && p.c === c && p.r === r) return p;
        }
        return null;
    }

    function inBounds(c, r) { return c >= 0 && r >= 0 && c < COLS && r < ROWS; }

    // Is the passage between two orthogonally-adjacent cells wall-free?
    function openStep(g, c1, r1, c2, r2) {
        if (c2 === c1 + 1) return !g.wallV.has(pkey(c1, r1));
        if (c1 === c2 + 1) return !g.wallV.has(pkey(c2, r1));
        if (r2 === r1 + 1) return !g.wallH.has(pkey(c1, r1));
        if (r1 === r2 + 1) return !g.wallH.has(pkey(c1, r2));
        return false;
    }

    function isTargetHome(player, c, r) {
        return HOME_CELLS[1 - player].some((h) => h.c === c && h.r === r);
    }

    // All legal moves for a player. A move = { pawn, from:{c,r}, c, r, len, jump, captive }
    function genMoves(g, player) {
        const moves = [];
        const seen = new Set();
        const add = (pawn, tc, tr, len, jump) => {
            const k = pawn.id + ':' + tc + ',' + tr;
            if (seen.has(k)) return;
            seen.add(k);
            moves.push({ pawn, from: { c: pawn.c, r: pawn.r }, c: tc, r: tr, len, jump: !!jump });
        };
        for (const pawn of g.pawns) {
            if (!pawn.alive || pawn.player !== player) continue;
            for (const [dc, dr] of DIRS) {
                const c1 = pawn.c + dc;
                const r1 = pawn.r + dr;
                if (!inBounds(c1, r1) || !openStep(g, pawn.c, pawn.r, c1, r1)) continue;
                const occ = pawnAt(g, c1, r1);
                if (!occ) {
                    add(pawn, c1, r1, 1, false);
                    for (const [dc2, dr2] of DIRS) {
                        const c2 = c1 + dc2;
                        const r2 = r1 + dr2;
                        if (!inBounds(c2, r2)) continue;
                        if (c2 === pawn.c && r2 === pawn.r) continue; // don't reverse onto self
                        if (!openStep(g, c1, r1, c2, r2)) continue;
                        const occ2 = pawnAt(g, c2, r2);
                        if (!occ2) add(pawn, c2, r2, 2, false);
                        else if (occ2.player !== player && isTargetHome(player, c2, r2)) {
                            add(pawn, c2, r2, 2, false); // 2-step home capture
                        }
                    }
                } else if (occ.player !== player && isTargetHome(player, c1, r1)) {
                    add(pawn, c1, r1, 1, false); // home capture
                }
                // straight hop over any pawn sitting on the first step
                if (occ) {
                    const cj = c1 + dc;
                    const rj = r1 + dr;
                    if (inBounds(cj, rj) && openStep(g, c1, r1, cj, rj) && !pawnAt(g, cj, rj)) {
                        add(pawn, cj, rj, 2, true);
                    }
                }
            }
        }
        return moves;
    }

    // Applies a move; returns the captured pawn or null.
    function applyMove(g, m) {
        const occ = pawnAt(g, m.c, m.r);
        if (occ && occ.player !== m.pawn.player) occ.alive = false;
        m.pawn.c = m.c;
        m.pawn.r = m.r;
        return occ && occ.player !== m.pawn.player ? occ : null;
    }

    function revertMove(g, m) {
        m.pawn.c = m.from.c;
        m.pawn.r = m.from.r;
        // Undo any home capture: revive the dead enemy pawn that sat on the landing cell.
        for (const p of g.pawns) {
            if (!p.alive && p.player !== m.pawn.player && p.c === m.c && p.r === m.r) {
                p.alive = true;
                return;
            }
        }
    }

    // Grid intersection (x, y): x ∈ 1..COLS-1, y ∈ 1..ROWS-1.
    function wallStructuralOk(g, orient, x, y) {
        if (x < 1 || x > COLS - 1 || y < 1 || y > ROWS - 1) return false;
        if (orient === 'v') {
            if (g.wallV.has(pkey(x - 1, y - 1)) || g.wallV.has(pkey(x - 1, y))) return false;
            if (g.ph.has(pkey(x, y)) || g.ph.has(pkey(x - 1, y)) || g.ph.has(pkey(x + 1, y)) ||
                g.ph.has(pkey(x, y - 1)) || g.ph.has(pkey(x, y + 1))) return false;
        } else {
            if (g.wallH.has(pkey(x - 1, y - 1)) || g.wallH.has(pkey(x, y - 1))) return false;
            if (g.pv.has(pkey(x, y)) || g.pv.has(pkey(x - 1, y)) || g.pv.has(pkey(x + 1, y)) ||
                g.pv.has(pkey(x, y - 1)) || g.pv.has(pkey(x, y + 1))) return false;
        }
        return true;
    }

    function addWallTo(g, orient, x, y) {
        if (orient === 'v') {
            g.wallV.add(pkey(x - 1, y - 1));
            g.wallV.add(pkey(x - 1, y));
            g.pv.add(pkey(x, y));
        } else {
            g.wallH.add(pkey(x - 1, y - 1));
            g.wallH.add(pkey(x, y - 1));
            g.ph.add(pkey(x, y));
        }
    }

    function delWallFrom(g, orient, x, y) {
        if (orient === 'v') {
            g.wallV.delete(pkey(x - 1, y - 1));
            g.wallV.delete(pkey(x - 1, y));
            g.pv.delete(pkey(x, y));
        } else {
            g.wallH.delete(pkey(x - 1, y - 1));
            g.wallH.delete(pkey(x, y - 1));
            g.ph.delete(pkey(x, y));
        }
    }

    // BFS from (c, r) over wall-free passages. Other living pawns block cells,
    // but a pawn parked ON a home square still counts it reachable — landing
    // there is a legal home capture (PRD §4), so the path "ends" at that cell.
    // Returns Int16Array of distances (-1 = unreachable).
    function bfsFrom(g, c, r) {
        const dist = new Int16Array(COLS * ROWS).fill(-1);
        const start = r * COLS + c;
        dist[start] = 0;
        const q = [start];
        for (let qi = 0; qi < q.length; qi++) {
            const idx = q[qi];
            const cc = idx % COLS;
            const rr = (idx - cc) / COLS;
            const d = dist[idx] + 1;
            for (const [dc, dr] of DIRS) {
                const nc = cc + dc;
                const nr = rr + dr;
                if (!inBounds(nc, nr)) continue;
                const nidx = nr * COLS + nc;
                if (dist[nidx] !== -1) continue;
                if (!openStep(g, cc, rr, nc, nr)) continue;
                const occ = pawnAt(g, nc, nr);
                if (occ) {
                    const onHome = ALL_HOMES.some((h) => h.c === nc && h.r === nr);
                    if (onHome) dist[nidx] = d; // reachable-by-capture, not passable
                    continue;
                }
                dist[nidx] = d;
                q.push(nidx);
            }
        }
        return dist;
    }

    // Connectivity invariant: every living pawn must reach all four home squares.
    function openConnectivity(g) {
        for (const pawn of g.pawns) {
            if (!pawn.alive) continue;
            const dist = bfsFrom(g, pawn.c, pawn.r);
            for (const home of ALL_HOMES) {
                if (dist[home.r * COLS + home.c] === -1) return false;
            }
        }
        return true;
    }

    function wallFullyOk(g, player, orient, x, y) {
        if (g.left[player][orient] <= 0) return false;
        if (!wallStructuralOk(g, orient, x, y)) return false;
        addWallTo(g, orient, x, y);
        const ok = openConnectivity(g);
        delWallFrom(g, orient, x, y);
        return ok;
    }

    function anyValidWall(g, player) {
        if (g.left[player].v + g.left[player].h === 0) return false;
        for (let x = 1; x <= COLS - 1; x++) {
            for (let y = 1; y <= ROWS - 1; y++) {
                if (g.left[player].v > 0 && wallFullyOk(g, player, 'v', x, y)) return true;
                if (g.left[player].h > 0 && wallFullyOk(g, player, 'h', x, y)) return true;
            }
        }
        return false;
    }

    function distToTargets(g, pawn) {
        const targets = HOME_CELLS[1 - pawn.player];
        const dist = bfsFrom(g, pawn.c, pawn.r);
        let best = 999;
        for (const t of targets) {
            const d = dist[t.r * COLS + t.c];
            if (d !== -1 && d < best) best = d;
        }
        return best;
    }

    function distSum(g, player) {
        let sum = 0;
        for (const pawn of g.pawns) {
            if (pawn.alive && pawn.player === player) sum += distToTargets(g, pawn);
        }
        return sum;
    }

    function onHomes(g, player) {
        let n = 0;
        for (const h of HOME_CELLS[1 - player]) {
            const occ = pawnAt(g, h.c, h.r);
            if (occ && occ.player === player) n++;
        }
        return n;
    }

    // Returns the winning player or null.
    function winnerOf(g) {
        for (const p of [0, 1]) {
            const mine = g.pawns.filter((pw) => pw.alive && pw.player === p);
            const oppAlive = g.pawns.some((pw) => pw.alive && pw.player !== p);
            if (mine.length === 2 && onHomes(g, p) === 2) return p;
            if (!oppAlive) return p;
        }
        return null;
    }

    // ---------- AI ----------
    const HARD_ROOT_MOVES = 10;
    const HARD_REPLIES = 6;
    const HARD_MY_WALLS = 14;
    const HARD_OPP_WALLS = 8;

    function scoreSide(g, p) {
        let alive = 0;
        for (const pw of g.pawns) if (pw.alive && pw.player === p) alive++;
        return -distSum(g, p) * 10 + onHomes(g, p) * 260 - (2 - alive) * 400 +
            (g.left[p].v + g.left[p].h) * 0.6;
    }

    function evaluate(g, root) {
        return scoreSide(g, root) - 1.25 * scoreSide(g, 1 - root);
    }

    function shuffled(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    function structuralWallCands(g, player) {
        const cands = [];
        for (const orient of ['v', 'h']) {
            if (g.left[player][orient] <= 0) continue;
            for (let x = 1; x <= COLS - 1; x++) {
                for (let y = 1; y <= ROWS - 1; y++) {
                    if (wallStructuralOk(g, orient, x, y)) cands.push({ orient, x, y });
                }
            }
        }
        return cands;
    }

    // Greedy wall pick: maximize rival's distance increase − 0.4 × own distance loss.
    // Validates connectivity before returning. `scanLimit` bounds the BFS budget.
    function pickGreedyWall(g, player, scanLimit, allowSecondPick) {
        if (g.left[player].v + g.left[player].h === 0) return null;
        const opp = 1 - player;
        const oppBase = distSum(g, opp);
        const myBase = distSum(g, player);
        const cands = shuffled(structuralWallCands(g, player)).slice(0, scanLimit);
        const scored = [];
        for (const w of cands) {
            addWallTo(g, w.orient, w.x, w.y);
            const gain = (distSum(g, opp) - oppBase) - 0.4 * (distSum(g, player) - myBase);
            delWallFrom(g, w.orient, w.x, w.y);
            scored.push({ w, gain });
        }
        scored.sort((a, b) => b.gain - a.gain);
        if (allowSecondPick && scored.length > 1 && Math.random() < 0.25) {
            const alt = scored[1 + (Math.random() < 0.5 ? 0 : Math.min(1, scored.length - 2))];
            addWallTo(g, alt.w.orient, alt.w.x, alt.w.y);
            const ok = openConnectivity(g);
            delWallFrom(g, alt.w.orient, alt.w.x, alt.w.y);
            if (ok) return alt.w;
        }
        for (const s of scored) {
            addWallTo(g, s.w.orient, s.w.x, s.w.y);
            const ok = openConnectivity(g);
            delWallFrom(g, s.w.orient, s.w.x, s.w.y);
            if (ok) return s.w;
        }
        // Fallback: full scan for any connectivity-valid wall.
        for (const w of shuffled(structuralWallCands(g, player))) {
            addWallTo(g, w.orient, w.x, w.y);
            const ok = openConnectivity(g);
            delWallFrom(g, w.orient, w.x, w.y);
            if (ok) return w;
        }
        return null;
    }

    function pickRandomWall(g, player) {
        for (const w of shuffled(structuralWallCands(g, player))) {
            addWallTo(g, w.orient, w.x, w.y);
            const ok = openConnectivity(g);
            delWallFrom(g, w.orient, w.x, w.y);
            if (ok) return w;
        }
        return null;
    }

    function rankMoves(g, player, moves, cap) {
        const scored = moves.map((m) => {
            applyMove(g, m);
            const s = evaluate(g, player);
            revertMove(g, m);
            return { m, s };
        });
        scored.sort((a, b) => b.s - a.s);
        return scored.slice(0, cap).map((e) => e.m);
    }

    function chooseAiWall() {
        const g = game;
        const p = g.turn;
        if (opponent === 'easy') return pickRandomWall(g, p);
        if (opponent === 'medium') return pickGreedyWall(g, p, 40, true);
        return pickGreedyWall(g, p, HARD_MY_WALLS, false);
    }

    function chooseAiMove() {
        const g = game;
        const p = g.turn;
        const moves = genMoves(g, p);
        if (moves.length === 0) return null;
        if (opponent === 'easy') {
            if (Math.random() < 0.5) return moves[Math.floor(Math.random() * moves.length)];
            let best = null;
            let bestD = Infinity;
            for (const m of shuffled(moves)) {
                applyMove(g, m);
                const d = distSum(g, p);
                revertMove(g, m);
                if (d < bestD) { bestD = d; best = m; }
            }
            return best || moves[0];
        }
        if (opponent === 'medium') {
            let best = null;
            let bestD = Infinity;
            for (const m of shuffled(moves)) {
                applyMove(g, m);
                const won = winnerOf(g) === p;
                const d = won ? -1 : distSum(g, p) + onHomes(g, p) * -20;
                revertMove(g, m);
                if (d < bestD) { bestD = d; best = m; }
            }
            return best || moves[0];
        }
        // hard: 2-ply with greedy walls at both plies
        const rootMoves = rankMoves(g, p, moves, HARD_ROOT_MOVES);
        let best = null;
        let bestVal = -Infinity;
        for (const m of rootMoves) {
            applyMove(g, m);
            if (winnerOf(g) === p) { revertMove(g, m); return m; }
            const myWall = chooseAiWall();
            if (myWall) addWallTo(g, myWall.orient, myWall.x, myWall.y);
            const replies = rankMoves(g, 1 - p, genMoves(g, 1 - p), HARD_REPLIES);
            let worst = Infinity;
            for (const r of replies) {
                applyMove(g, r);
                if (winnerOf(g) === 1 - p) { worst = -1e7; revertMove(g, r); break; }
                const oppWall = pickGreedyWall(g, 1 - p, HARD_OPP_WALLS, false);
                if (oppWall) addWallTo(g, oppWall.orient, oppWall.x, oppWall.y);
                const val = evaluate(g, p) + Math.random() * 2.5;
                if (oppWall) delWallFrom(g, oppWall.orient, oppWall.x, oppWall.y);
                revertMove(g, r);
                if (val < worst) worst = val;
            }
            if (replies.length === 0) worst = evaluate(g, p);
            if (myWall) delWallFrom(g, myWall.orient, myWall.x, myWall.y);
            revertMove(g, m);
            if (worst > bestVal) { bestVal = worst; best = m; }
        }
        return best || rootMoves[0];
    }

    // ---------- DOM ----------
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.65rem;width:100%;';

    const hudRow = document.createElement('div');
    hudRow.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:0.7rem;';

    const turnBadge = document.createElement('span');
    turnBadge.style.cssText = 'display:inline-flex;align-items:center;gap:0.45rem;font-weight:700;font-size:1.05rem;';
    const turnDot = document.createElement('span');
    turnDot.setAttribute('aria-hidden', 'true');
    turnDot.style.cssText = 'width:12px;height:12px;border-radius:999px;display:inline-block;background:' + PLAYER_COLORS[0];
    const turnLabel = document.createElement('span');
    turnBadge.append(turnDot, turnLabel);

    const phaseText = document.createElement('span');
    phaseText.setAttribute('aria-live', 'polite');
    phaseText.style.cssText = 'color:var(--text-secondary);font-size:0.92rem;min-height:1.2em;';

    const rulesBtn = document.createElement('button');
    rulesBtn.type = 'button';
    rulesBtn.className = 'btn btn-ghost';
    rulesBtn.textContent = '❓ Rules';
    rulesBtn.setAttribute('aria-label', 'Show how to play');
    rulesBtn.style.padding = '0.4rem 1rem';
    rulesBtn.style.fontSize = '0.85rem';
    rulesBtn.addEventListener('click', () => { sfx('click'); showHowTo(); });

    hudRow.append(turnBadge, phaseText, rulesBtn);

    const wallsRow = document.createElement('div');
    wallsRow.style.cssText = 'display:flex;gap:1.4rem;font-size:0.9rem;font-variant-numeric:tabular-nums;color:var(--text-secondary);';
    function makeWallLabel(i) {
        const el = document.createElement('span');
        el.style.color = PLAYER_COLORS[i];
        wallsRow.appendChild(el);
        return el;
    }
    const wallLabels = [makeWallLabel(0), makeWallLabel(1)];

    const chipsRow = document.createElement('div');
    chipsRow.setAttribute('role', 'group');
    chipsRow.setAttribute('aria-label', 'Wall orientation');
    chipsRow.style.cssText = 'display:flex;gap:0.5rem;';
    chipsRow.hidden = true;
    function makeChip(orient) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost';
        b.style.padding = '0.45rem 1rem';
        b.style.fontSize = '0.85rem';
        b.style.color = WALL_COLORS[orient];
        b.addEventListener('click', () => {
            wallOrient = orient;
            sfx('click');
            updateHud();
        });
        chipsRow.appendChild(b);
        return b;
    }
    const chips = { v: makeChip('v'), h: makeChip('h') };

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.width = W;
    canvas.height = H;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Blocade board: 11 by 14 grid with pawns and walls.');

    const toastEl = document.createElement('p');
    toastEl.setAttribute('aria-live', 'polite');
    toastEl.style.cssText = 'margin:0;min-height:1.3em;font-size:0.9rem;color:var(--text-secondary);transition:opacity 0.3s ease;opacity:0;max-width:34rem;';
    let toastTimer = 0;

    wrap.append(hudRow, wallsRow, chipsRow, canvas, toastEl);
    container.appendChild(wrap);
    const ctx = canvas.getContext('2d');

    function toast(msg, ms) {
        toastEl.textContent = msg;
        toastEl.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            if (!destroyed) toastEl.style.opacity = '0';
        }, ms || 2800);
        timers.add(toastTimer);
    }

    // ---------- flow state ----------
    let opponent = null;      // OPPONENTS id
    let phase = 'select';     // select | move | wall | ai | over
    let busy = false;         // input lock during animations / AI
    let selected = null;      // pawn being moved (human)
    let dests = new Map();    // "c,r" -> move (human move phase)
    let ghost = null;         // { x, y, orient, valid }
    let wallOrient = 'v';
    let animMove = null;      // { pawnId, fc, fr, tc, tr, t0, dur }
    let captFx = [];          // { c, r, t0 }
    let rejectionCount = 0;
    let selectOverlay = null;
    let endOverlay = null;
    let howOverlay = null;

    function isHumanTurn() {
        return (phase === 'move' || phase === 'wall');
    }

    function levelName() {
        const o = OPPONENTS.find((x) => x.id === opponent);
        return o ? o.name : '';
    }

    function updateHud() {
        const p = game ? game.turn : 0;
        const humanNow = opponent === 'human' || p === 0;
        turnDot.style.background = PLAYER_COLORS[p];
        let who;
        if (!game || phase === 'select') {
            who = '';
        } else if (opponent !== 'human' && p === 1) {
            who = 'Rival · ' + levelName();
        } else {
            who = opponent === 'human' ? PLAYER_NAMES[p] + "'s turn" : 'Your turn';
        }
        turnLabel.textContent = who;
        let hint = '';
        if (phase === 'move' && selected) hint = 'Tap a highlighted space';
        else if (phase === 'move' && humanNow) hint = 'Tap one of your pawns';
        else if (phase === 'wall' && humanNow) hint = 'Pick orientation, then tap a grid corner';
        else if (phase === 'ai') hint = 'Rival is thinking…';
        else if (phase === 'over') hint = 'Game over';
        phaseText.textContent = hint;

        if (game) {
            for (let i = 0; i < 2; i++) {
                const nm = opponent === 'human' ? PLAYER_NAMES[i] : (i === 0 ? 'You' : 'Rival');
                wallLabels[i].textContent = nm + '  ▮ ' + game.left[i].v + '  ▬ ' + game.left[i].h;
            }
        } else {
            wallLabels[0].textContent = '';
            wallLabels[1].textContent = '';
        }

        const showChips = phase === 'wall' && isHumanTurn();
        chipsRow.hidden = !showChips;
        if (showChips && game) {
            const left = game.left[game.turn];
            if (wallOrient === 'v' && left.v === 0) wallOrient = 'h';
            if (wallOrient === 'h' && left.h === 0) wallOrient = 'v';
            for (const o of ['v', 'h']) {
                chips[o].textContent = (o === 'v' ? '▮ Vertical' : '▬ Horizontal') + ' · ' + left[o];
                chips[o].disabled = left[o] === 0;
                chips[o].setAttribute('aria-pressed', String(wallOrient === o));
                chips[o].style.borderColor = wallOrient === o ? WALL_COLORS[o] : '';
                chips[o].style.background = wallOrient === o ? 'rgba(255,255,255,0.08)' : '';
            }
        }
    }

    // ---------- turn machine ----------
    function newGame() {
        clearTimers();
        if (endOverlay) { endOverlay.remove(); endOverlay = null; }
        game = newGameState();
        selected = null;
        dests.clear();
        ghost = null;
        animMove = null;
        captFx = [];
        rejectionCount = 0;
        wallOrient = 'v';
        busy = false;
        beginTurn();
    }

    function beginTurn() {
        selected = null;
        dests.clear();
        ghost = null;
        const p = game.turn;
        const ai = p === 1 && opponent !== 'human';
        if (ai) {
            phase = 'ai';
            updateHud();
            addTimeout(aiStep, 380 + Math.random() * 300);
        } else {
            phase = 'move';
            updateHud();
        }
    }

    function aiStep() {
        if (destroyed || phase !== 'ai') return;
        const m = chooseAiMove();
        if (!m) { endTurn(); return; }
        startMoveAnim(m, () => {
            if (phase !== 'ai') return;
            afterMove();
        });
    }

    function startMoveAnim(m, done) {
        busy = true;
        selected = null;
        dests.clear();
        ghost = null;
        animMove = {
            pawnId: m.pawn.id,
            fc: m.pawn.c, fr: m.pawn.r, tc: m.c, tr: m.r,
            t0: performance.now(),
            dur: reduceMotion ? 90 : 200
        };
        sfx('slide');
        addTimeout(() => {
            animMove = null;
            const captured = applyMove(game, m);
            if (captured) {
                captFx.push({ c: captured.c, r: captured.r, t0: performance.now() });
                sfx('capture');
                toast(PLAYER_NAMES[m.pawn.player] + ' captured a pawn on its home square!');
            }
            busy = false;
            done();
        }, animMove.dur + 15);
    }

    function afterMove() {
        const w = winnerOf(game);
        if (w !== null) { endGame(w); return; }
        const p = game.turn;
        if (game.left[p].v + game.left[p].h > 0) {
            if (anyValidWall(game, p)) {
                startWallPhase();
            } else {
                toast('No legal wall placement left — placement skipped.');
                addTimeout(endTurn, 900);
            }
        } else {
            endTurn();
        }
    }

    function startWallPhase() {
        const p = game.turn;
        const ai = p === 1 && opponent !== 'human';
        if (ai) {
            phase = 'ai';
            updateHud();
            addTimeout(aiWallStep, 480 + Math.random() * 240);
        } else {
            phase = 'wall';
            ghost = null;
            updateHud();
        }
    }

    function aiWallStep() {
        if (destroyed || phase !== 'ai') return;
        const w = chooseAiWall();
        if (!w) { endTurn(); return; }
        placeWallRaw(game.turn, w.orient, w.x, w.y);
        addTimeout(endTurn, 200);
    }

    function placeWallRaw(player, orient, x, y) {
        addWallTo(game, orient, x, y);
        game.left[player][orient]--;
        game.placed.push({ x, y, orient, t0: performance.now() });
        ghost = null;
        sfx('wall');
        updateHud();
    }

    function endTurn() {
        if (destroyed || phase === 'over' || phase === 'select') return;
        game.turn = 1 - game.turn;
        beginTurn();
    }

    function endGame(winner) {
        phase = 'over';
        busy = true;
        updateHud();
        const humanLost = opponent !== 'human' && winner === 1;
        sfx(humanLost ? 'lose' : 'win');
        addTimeout(() => showEndModal(winner), 750);
    }

    // ---------- input ----------
    function canvasPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (W / rect.width),
            y: (e.clientY - rect.top) * (H / rect.height)
        };
    }

    function cellFromPoint(pt) {
        const c = Math.floor((pt.x - PAD) / CELL);
        const r = Math.floor((pt.y - PAD) / CELL);
        return inBounds(c, r) ? { c, r } : null;
    }

    function nearestIntersection(pt) {
        let x = Math.round((pt.x - PAD) / CELL);
        let y = Math.round((pt.y - PAD) / CELL);
        x = Math.max(1, Math.min(COLS - 1, x));
        y = Math.max(1, Math.min(ROWS - 1, y));
        const dx = Math.abs(pt.x - (PAD + x * CELL));
        const dy = Math.abs(pt.y - (PAD + y * CELL));
        if (dx > CELL * 0.52 || dy > CELL * 0.52) return null;
        return { x, y };
    }

    function computeDests() {
        dests.clear();
        if (!selected) return;
        for (const m of genMoves(game, game.turn)) {
            if (m.pawn !== selected) continue;
            dests.set(pkey(m.c, m.r), m);
        }
    }

    canvas.addEventListener('click', (e) => {
        ensureAudio();
        if (destroyed || busy || !isHumanTurn() || !game) return;
        const pt = canvasPoint(e);
        if (phase === 'move') {
            const cell = cellFromPoint(pt);
            if (!cell) { selected = null; computeDests(); return; }
            if (selected) {
                const m = dests.get(pkey(cell.c, cell.r));
                if (m) {
                    sfx('select');
                    startMoveAnim(m, afterMove);
                    updateHud();
                    return;
                }
            }
            const pawn = pawnAt(game, cell.c, cell.r);
            if (pawn && pawn.player === game.turn) {
                const has = genMoves(game, game.turn).some((m) => m.pawn === pawn);
                if (!has) { toast('That pawn has nowhere to go.'); return; }
                selected = pawn;
                sfx('select');
                computeDests();
                updateHud();
            } else {
                selected = null;
                computeDests();
            }
        } else if (phase === 'wall') {
            const hit = nearestIntersection(pt);
            if (!hit) return;
            const p = game.turn;
            if (game.left[p][wallOrient] <= 0) { toast('No ' + (wallOrient === 'v' ? 'vertical' : 'horizontal') + ' walls left — pick the other orientation.'); return; }
            if (!wallStructuralOk(game, wallOrient, hit.x, hit.y)) {
                rejectWall('Walls can\u2019t overlap, cross, or hit another wall\u2019s middle');
                return;
            }
            addWallTo(game, wallOrient, hit.x, hit.y);
            const connected = openConnectivity(game);
            delWallFrom(game, wallOrient, hit.x, hit.y);
            if (!connected) {
                rejectWall('You can\u2019t seal a pawn off from its homes \u2014 tap \u2753 Rules');
                return;
            }
            placeWallRaw(p, wallOrient, hit.x, hit.y);
            afterWall();
        }
    });

    function rejectWall(msg) {
        sfx('invalid');
        rejectionCount++;
        toast(rejectionCount === 1 ? msg : msg.replace(' \u2014 tap \u2753 Rules', ''), 2200);
    }

    canvas.addEventListener('mousemove', (e) => {
        if (destroyed || !game) return;
        let cur = 'default';
        ghost = null;
        if (!busy && isHumanTurn()) {
            const pt = canvasPoint(e);
            if (phase === 'move') {
                const cell = cellFromPoint(pt);
                if (cell) {
                    if (dests.has(pkey(cell.c, cell.r)) ||
                        (pawnAt(game, cell.c, cell.r) && pawnAt(game, cell.c, cell.r).player === game.turn)) {
                        cur = 'pointer';
                    }
                }
            } else if (phase === 'wall') {
                const hit = nearestIntersection(pt);
                if (hit) {
                    const p = game.turn;
                    const valid = game.left[p][wallOrient] > 0 &&
                        wallStructuralOk(game, wallOrient, hit.x, hit.y) &&
                        wallFullyOk(game, p, wallOrient, hit.x, hit.y);
                    ghost = { x: hit.x, y: hit.y, orient: wallOrient, valid };
                    cur = 'pointer';
                }
            }
        }
        canvas.style.cursor = cur;
    });

    canvas.addEventListener('mouseleave', () => { ghost = null; });

    function afterWall() {
        // Wall placement ends the turn; win can only happen on the move.
        addTimeout(endTurn, 180);
    }

    // ---------- rendering ----------
    function cellPx(c) { return PAD + c * CELL; }
    function cellCx(c) { return PAD + c * CELL + CELL / 2; }

    function roundRectPath(c2, x, y, w, h, r) {
        c2.beginPath();
        c2.moveTo(x + r, y);
        c2.arcTo(x + w, y, x + w, y + h, r);
        c2.arcTo(x + w, y + h, x, y + h, r);
        c2.arcTo(x, y + h, x, y, r);
        c2.arcTo(x, y, x + w, y, r);
        c2.closePath();
    }

    function drawPawnAt(g2, px, py, player, opts) {
        const o = opts || {};
        g2.save();
        if (o.ring) {
            g2.beginPath();
            g2.arc(px, py, 16, 0, Math.PI * 2);
            g2.strokeStyle = o.ringColor || '#ffffff';
            g2.lineWidth = 2;
            g2.globalAlpha = o.ringAlpha == null ? 1 : o.ringAlpha;
            g2.stroke();
        }
        const grad = g2.createRadialGradient(px - 4, py - 5, 2, px, py, 14);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.22, PLAYER_COLORS[player]);
        grad.addColorStop(1, player === 0 ? '#7f1d1d' : '#155e75');
        g2.beginPath();
        g2.arc(px, py, 13, 0, Math.PI * 2);
        g2.fillStyle = grad;
        g2.globalAlpha = o.alpha == null ? 1 : o.alpha;
        g2.fill();
        g2.lineWidth = 1.5;
        g2.strokeStyle = 'rgba(0,0,0,0.45)';
        g2.stroke();
        g2.restore();
    }

    function drawWall(g2, orient, x, y, color, alpha, scale) {
        g2.save();
        g2.globalAlpha = alpha;
        const th = 7;
        const half = CELL * scale;
        if (orient === 'h') {
            const cy = PAD + y * CELL;
            roundRectPath(g2, PAD + x * CELL - half, cy - th / 2, half * 2, th, 3);
        } else {
            const cx = PAD + x * CELL;
            roundRectPath(g2, cx - th / 2, PAD + y * CELL - half, th, half * 2, 3);
        }
        g2.fillStyle = color;
        g2.fill();
        g2.strokeStyle = 'rgba(0,0,0,0.4)';
        g2.lineWidth = 1;
        g2.stroke();
        g2.restore();
    }

    function pawnPixels(pawn) {
        if (animMove && animMove.pawnId === pawn.id) {
            const t = Math.min(1, (performance.now() - animMove.t0) / animMove.dur);
            const e = 1 - Math.pow(1 - t, 3);
            return {
                x: cellCx(animMove.fc) + (cellCx(animMove.tc) - cellCx(animMove.fc)) * e,
                y: cellCx(animMove.fr) + (cellCx(animMove.tr) - cellCx(animMove.fr)) * e
            };
        }
        return { x: cellCx(pawn.c), y: cellCx(pawn.r) };
    }

    function render(now) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#10162a';
        ctx.fillRect(0, 0, W, H);
        if (!game) return;

        // board + checker
        ctx.fillStyle = '#151d33';
        ctx.fillRect(PAD, PAD, COLS * CELL, ROWS * CELL);
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                if ((c + r) % 2 === 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.022)';
                    ctx.fillRect(cellPx(c), cellPx(r), CELL, CELL);
                }
            }
        }
        ctx.strokeStyle = 'rgba(148,163,184,0.13)';
        ctx.lineWidth = 1;
        ctx.strokeRect(PAD + 0.5, PAD + 0.5, COLS * CELL - 1, ROWS * CELL - 1);

        // home rings
        for (let p = 0; p < 2; p++) {
            ctx.save();
            ctx.strokeStyle = PLAYER_COLORS[p];
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            for (const h of HOME_CELLS[p]) {
                ctx.strokeRect(cellPx(h.c) + 4.5, cellPx(h.r) + 4.5, CELL - 9, CELL - 9);
            }
            ctx.restore();
        }

        // walls (with pop-in)
        for (const w of game.placed) {
            const age = now - w.t0;
            let scale = 1;
            if (!reduceMotion && age < 160) {
                const t = age / 160;
                scale = t < 0.6 ? (t / 0.6) * 1.12 : 1.12 - 0.12 * ((t - 0.6) / 0.4);
            }
            drawWall(ctx, w.orient, w.x, w.y, WALL_COLORS[w.orient], 1, Math.max(0.05, scale));
        }

        // move-phase highlights
        if (phase === 'move' && isHumanTurn()) {
            const movable = new Set();
            for (const m of genMoves(game, game.turn)) movable.add(m.pawn.id);
            const pulse = reduceMotion ? 0.85 : 0.55 + 0.3 * Math.sin(now / 180);
            for (const pawn of game.pawns) {
                if (!pawn.alive || pawn.player !== game.turn) continue;
                if (!movable.has(pawn.id)) continue;
                const pp = pawnPixels(pawn);
                ctx.save();
                ctx.globalAlpha = pulse;
                ctx.beginPath();
                ctx.arc(pp.x, pp.y, 16.5, 0, Math.PI * 2);
                ctx.strokeStyle = PLAYER_COLORS[game.turn];
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            }
            if (selected) {
                const pp = pawnPixels(selected);
                ctx.save();
                ctx.beginPath();
                ctx.arc(pp.x, pp.y, 17.5, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
                for (const m of dests.values()) {
                    const x = cellCx(m.c);
                    const y = cellCx(m.r);
                    ctx.save();
                    if (m.jump) {
                        ctx.globalAlpha = 0.5;
                        ctx.setLineDash([3, 3]);
                        ctx.beginPath();
                        ctx.arc(x, y, 11, 0, Math.PI * 2);
                        ctx.strokeStyle = PLAYER_COLORS[game.turn];
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    } else if (isTargetHome(game.turn, m.c, m.r) && pawnAt(game, m.c, m.r)) {
                        ctx.strokeStyle = INVALID_COLOR;
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        ctx.arc(x, y, 12.5, 0, Math.PI * 2);
                        ctx.stroke();
                    } else {
                        ctx.globalAlpha = 0.8;
                        ctx.fillStyle = PLAYER_COLORS[game.turn];
                        ctx.beginPath();
                        ctx.arc(x, y, 6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();
                }
            }
        }

        // ghost wall
        if (ghost && phase === 'wall' && isHumanTurn()) {
            const col = ghost.valid ? WALL_COLORS[ghost.orient] : INVALID_COLOR;
            if (ghost.valid || !reduceMotion) {
                drawWall(ctx, ghost.orient, ghost.x, ghost.y, col, 0.55, 1);
            }
        }

        // pawns
        for (const pawn of game.pawns) {
            if (!pawn.alive) continue;
            const pp = pawnPixels(pawn);
            drawPawnAt(ctx, pp.x, pp.y, pawn.player);
        }

        // capture fx
        captFx = captFx.filter((f) => now - f.t0 < 350);
        for (const f of captFx) {
            const t = (now - f.t0) / 350;
            ctx.save();
            ctx.globalAlpha = 1 - t;
            ctx.strokeStyle = INVALID_COLOR;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cellCx(f.c), cellCx(f.r), 13 + 14 * t, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    function frame(now) {
        if (destroyed) return;
        rafId = requestAnimationFrame(frame);
        render(now);
    }

    // ---------- opponent select ----------
    function showSelect() {
        phase = 'select';
        game = null;
        busy = false;
        updateHud();
        if (selectOverlay) selectOverlay.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'bd-sel-title');
        modal.style.width = 'min(100%, 24rem)';

        const h2 = document.createElement('h2');
        h2.id = 'bd-sel-title';
        h2.textContent = '🚧 BLOCADE';

        const sub = document.createElement('p');
        sub.textContent = 'Race your two pawns into the rival\u2019s home squares — and wall them in. Choose your opponent:';
        sub.style.cssText = 'margin:0 0 1rem;color:var(--text-secondary);font-size:0.9rem;';

        const list = document.createElement('div');
        list.setAttribute('role', 'group');
        list.setAttribute('aria-label', 'Choose opponent');
        list.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;';
        OPPONENTS.forEach((o) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-ghost';
            b.style.cssText = 'width:100%;display:flex;justify-content:space-between;align-items:center;gap:0.8rem;padding:0.7rem 1rem;';
            b.setAttribute('aria-label', 'Start game against ' + o.tag);
            const name = document.createElement('span');
            name.textContent = (o.id === 'human' ? '👥 ' : '🤖 ') + o.name;
            name.style.fontWeight = '700';
            const tag = document.createElement('span');
            tag.textContent = o.tag;
            tag.style.cssText = 'font-size:0.72rem;color:var(--text-secondary);text-align:right;';
            b.append(name, tag);
            b.addEventListener('click', () => {
                ensureAudio();
                sfx('click');
                opponent = o.id;
                overlay.remove();
                selectOverlay = null;
                newGame();
                toast('You are Red. Move a pawn, then place a wall — tap \u2753 Rules any time.');
            });
            list.appendChild(b);
        });

        const howBtn = document.createElement('button');
        howBtn.type = 'button';
        howBtn.className = 'btn btn-primary';
        howBtn.textContent = 'How to play';
        howBtn.style.marginTop = '0.9rem';
        howBtn.addEventListener('click', () => { sfx('click'); showHowTo(); });

        modal.append(h2, sub, list, howBtn);
        overlay.appendChild(modal);
        container.appendChild(overlay);
        selectOverlay = overlay;
        howBtn.focus();
    }

    // ---------- game over ----------
    function showEndModal(winner) {
        if (destroyed || endOverlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'bd-end-title');

        const h2 = document.createElement('h2');
        h2.id = 'bd-end-title';
        let sub;
        if (opponent === 'human') {
            h2.textContent = PLAYER_NAMES[winner].toUpperCase() + ' WINS!';
            sub = 'Both pawns on the rival\u2019s home squares.';
        } else if (winner === 0) {
            h2.textContent = 'YOU WIN! 🎉';
            sub = 'You out-raced the ' + levelName().toLowerCase() + '.';
        } else {
            h2.textContent = 'DEFEATED';
            sub = 'The ' + levelName().toLowerCase() + ' got both pawns home first.';
        }
        const p = document.createElement('p');
        p.className = 'final-score';
        p.textContent = sub;

        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        actions.style.marginTop = '1.4rem';

        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn btn-primary';
        again.textContent = 'Play Again';
        again.addEventListener('click', () => { sfx('click'); newGame(); });

        const change = document.createElement('button');
        change.type = 'button';
        change.className = 'btn btn-ghost';
        change.textContent = 'Change Opponent';
        change.addEventListener('click', () => {
            sfx('click');
            overlay.remove();
            endOverlay = null;
            showSelect();
        });

        const home = document.createElement('button');
        home.type = 'button';
        home.className = 'btn btn-ghost';
        home.textContent = 'Home';
        home.addEventListener('click', () => {
            window.dispatchEvent(new Event('hub:home'));
        });

        actions.append(again, change, home);
        modal.append(h2, p, actions);
        overlay.appendChild(modal);
        container.appendChild(overlay);
        endOverlay = overlay;
        again.focus();
    }

    // ---------- how to play (animated carousel) ----------
    const HOW_STEPS = [
        {
            loop: 5.8,
            text: 'The race — each player keeps two pawns on home squares at opposite ends of the board. Win by landing both of your pawns on the rival\u2019s two home squares.',
            draw: drawHow1
        },
        {
            loop: 6.6,
            text: 'Movement — on your turn, move one pawn one or two spaces in straight lines (an L-shaped path is fine). Pawns never cross walls, and every move is mandatory.',
            draw: drawHow2
        },
        {
            loop: 6.4,
            text: 'The jump — an adjacent pawn may be hopped straight over if the space behind it is free (that uses the whole 2-space move). Landing on an occupied space is forbidden — except capturing a rival parked on one of your target home squares.',
            draw: drawHow3
        },
        {
            loop: 7.6,
            text: 'Walls — then place one wall per turn: green walls stand vertical, blue lie horizontal; each covers exactly two spaces. Walls never overlap, cross, or butt into the middle of another wall.',
            draw: drawHow4
        },
        {
            loop: 7.4,
            text: 'Never seal — a wall may never cut a pawn (yours or the rival\u2019s) off from the home squares. If a placement breaks the last path, it\u2019s rejected. Out of walls? Then just move.',
            draw: drawHow5
        }
    ];
    let howStep = 0;
    let howClock = 0;
    let howCanvas = null;
    let howCanvasCtx = null;
    let howTextEl = null;
    let howDotsEl = null;
    let howBackBtn = null;
    let howNextBtn = null;
    let lastFrameTs = 0;

    const DEMO_W = 360;
    const DEMO_H = 200;

    function demoBoard(g2, ox, oy, cols, rows, cell) {
        g2.save();
        g2.fillStyle = '#131a2e';
        g2.strokeStyle = 'rgba(148,163,184,0.16)';
        g2.lineWidth = 1;
        g2.fillRect(ox, oy, cols * cell, rows * cell);
        for (let c = 0; c <= cols; c++) {
            g2.beginPath();
            g2.moveTo(ox + c * cell + 0.5, oy);
            g2.lineTo(ox + c * cell + 0.5, oy + rows * cell);
            g2.stroke();
        }
        for (let r = 0; r <= rows; r++) {
            g2.beginPath();
            g2.moveTo(ox, oy + r * cell + 0.5);
            g2.lineTo(ox + cols * cell, oy + r * cell + 0.5);
            g2.stroke();
        }
        g2.restore();
    }

    function demoPawn(g2, ox, oy, cell, c, r, player, opts) {
        drawPawnAt(g2, ox + (c + 0.5) * cell, oy + (r + 0.5) * cell, player, opts);
    }

    function demoHome(g2, ox, oy, cell, c, r, color) {
        g2.save();
        g2.strokeStyle = color;
        g2.globalAlpha = 0.6;
        g2.setLineDash([3, 3]);
        g2.lineWidth = 2;
        g2.strokeRect(ox + c * cell + 3, oy + r * cell + 3, cell - 6, cell - 6);
        g2.restore();
    }

    function demoBadge(g2, ok, x, y) {
        g2.save();
        g2.font = 'bold 22px sans-serif';
        g2.textAlign = 'center';
        g2.fillStyle = ok ? '#4ade80' : INVALID_COLOR;
        g2.fillText(ok ? '\u2713' : '\u2717', x, y);
        g2.restore();
    }

    function demoLabel(g2, txt, x, y) {
        g2.save();
        g2.font = '11px sans-serif';
        g2.textAlign = 'center';
        g2.fillStyle = '#9aa3b5';
        g2.fillText(txt, x, y);
        g2.restore();
    }

    function demoWall(g2, ox, oy, cell, orient, ix, iy, color, alpha, scale) {
        g2.save();
        g2.globalAlpha = alpha;
        const th = 6;
        const half = cell * scale;
        const cx = ox + ix * cell;
        const cy = oy + iy * cell;
        if (orient === 'h') {
            g2.fillStyle = color;
            g2.fillRect(cx - half, cy - th / 2, half * 2, th);
        } else {
            g2.fillStyle = color;
            g2.fillRect(cx - th / 2, cy - half, th, half * 2);
        }
        g2.restore();
    }

    function lerp(a, b, t) { return a + (b - a) * t; }
    function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3); }

    // Step 1 — pawns glide from their homes into the rival's homes.
    function drawHow1(g2, tt) {
        const cell = 20;
        const ox = (DEMO_W - 9 * cell) / 2;
        const oy = 12;
        demoBoard(g2, ox, oy, 9, 9, cell);
        for (const h of [{ c: 2, r: 1 }, { c: 6, r: 1 }]) demoHome(g2, ox, oy, cell, h.c, h.r, PLAYER_COLORS[0]);
        for (const h of [{ c: 2, r: 7 }, { c: 6, r: 7 }]) demoHome(g2, ox, oy, cell, h.c, h.r, PLAYER_COLORS[1]);
        const t1 = ease((tt - 0.4) / 1.8);
        const t2 = ease((tt - 2.6) / 1.8);
        const a1 = { c: 2, r: lerp(1, 7, t1) };
        const a2 = { c: 6, r: lerp(1, 7, t2) };
        g2.save();
        g2.strokeStyle = PLAYER_COLORS[0];
        g2.globalAlpha = 0.3;
        g2.setLineDash([3, 4]);
        g2.beginPath();
        g2.moveTo(ox + 2.5 * cell, oy + 1.5 * cell);
        g2.lineTo(ox + 2.5 * cell, oy + 7.5 * cell);
        g2.moveTo(ox + 6.5 * cell, oy + 1.5 * cell);
        g2.lineTo(ox + 6.5 * cell, oy + 7.5 * cell);
        g2.stroke();
        g2.restore();
        demoPawn(g2, ox, oy, cell, a1.c, a1.r, 0);
        demoPawn(g2, ox, oy, cell, a2.c, a2.r, 0);
        if (tt > 4.5) {
            const glow = 0.35 + 0.3 * Math.sin((tt - 4.5) * 5);
            g2.save();
            g2.fillStyle = PLAYER_COLORS[0];
            g2.globalAlpha = glow;
            g2.fillRect(ox + 2 * cell, oy + 7 * cell, cell, cell);
            g2.fillRect(ox + 6 * cell, oy + 7 * cell, cell, cell);
            g2.globalAlpha = 1;
            g2.font = 'bold 15px sans-serif';
            g2.textAlign = 'center';
            g2.fillStyle = '#4ade80';
            g2.fillText('BOTH HOMES = WIN', DEMO_W / 2, DEMO_H - 12);
            g2.restore();
        }
    }

    // Step 2 — three panels: one step / two steps / L path.
    function drawHow2(g2, tt) {
        const cell = 20;
        const pw = 5 * cell;
        const gap = 22;
        const ox0 = (DEMO_W - (pw * 3 + gap * 2)) / 2;
        const oy = 26;
        const labels = ['ONE STEP', 'TWO STEPS', 'L-SHAPE'];
        const phaseIdx = Math.min(2, Math.floor(tt / 2.2));
        for (let k = 0; k < 3; k++) {
            const ox = ox0 + k * (pw + gap);
            demoBoard(g2, ox, oy, 5, 5, cell);
            demoLabel(g2, labels[k], ox + pw / 2, 20);
            const local = Math.min(1, Math.max(0, (tt - k * 2.2 - 0.3) / 1.4));
            const e = ease(local);
            let path;
            if (k === 0) path = [[1, 2], [2, 2]];
            else if (k === 1) path = [[0, 2], [1, 2], [2, 2]];
            else path = [[0, 3], [2, 3], [2, 1]];
            // dashed route
            g2.save();
            g2.strokeStyle = '#9aa3b5';
            g2.globalAlpha = k === phaseIdx ? 0.8 : 0.25;
            g2.setLineDash([3, 3]);
            g2.beginPath();
            path.forEach((p, i) => {
                const x = ox + (p[0] + 0.5) * cell;
                const y = oy + (p[1] + 0.5) * cell;
                if (i === 0) g2.moveTo(x, y); else g2.lineTo(x, y);
            });
            g2.stroke();
            g2.restore();
            // pawn slides along route
            let cx;
            let cy;
            if (path.length === 3) {
                const first = local < 0.5 ? local * 2 : 1;
                const second = Math.max(0, (local - 0.5) * 2);
                const ax = lerp(path[0][0], path[1][0], ease(first));
                const ay = lerp(path[0][1], path[1][1], ease(first));
                cx = lerp(ax, path[2][0], ease(second));
                cy = lerp(ay, path[2][1], ease(second));
            } else {
                cx = lerp(path[0][0], path[1][0], e);
                cy = lerp(path[0][1], path[1][1], e);
            }
            demoPawn(g2, ox, oy, cell, cx, cy, 0, { alpha: k === phaseIdx ? 1 : 0.45 });
        }
    }

    // Step 3 — legal hop (red 1→3 over cyan at 2), then occupied-landing ✗.
    function drawHow3(g2, tt) {
        const cell = 22;
        const bw = 6 * cell;
        const ox0 = (DEMO_W - (bw * 2 + 30)) / 2;
        const oy = 40;
        demoBoard(g2, ox0, oy, 6, 3, cell);
        demoLabel(g2, 'HOP THE ADJACENT PAWN', ox0 + bw / 2, 30);
        demoPawn(g2, ox0, oy, cell, 2, 1, 1);
        const t1 = Math.min(1, Math.max(0, (tt - 0.5) / 1.5));
        const lift = (t1 > 0 && t1 < 1) ? Math.sin(t1 * Math.PI) * 0.55 : 0;
        demoPawn(g2, ox0, oy - lift * cell, cell, lerp(1, 3, t1), 1, 0);
        if (tt > 2.0 && tt < 2.6) demoBadge(g2, true, ox0 + bw / 2, oy + 3 * cell + 22);

        const ox = ox0 + bw + 30;
        demoBoard(g2, ox, oy, 6, 3, cell);
        demoLabel(g2, 'NO LANDING ON OCCUPIED', ox + bw / 2, 30);
        demoPawn(g2, ox, oy, cell, 2, 1, 1);
        demoPawn(g2, ox, oy, cell, 3, 1, 1);
        const t2 = Math.min(1, Math.max(0, (tt - 3.4) / 1.2));
        const hop = t2 < 0.5 ? ease(t2 * 2) : 1 - ease((t2 - 0.5) * 2);
        demoPawn(g2, ox, oy, cell, 1 + hop * 0.65, 1, 0);
        if (t2 > 0.35) demoBadge(g2, false, ox + bw / 2, oy + 3 * cell + 22);
    }

    // Step 4 — legal wall, crossing ✗, T-junction ✗, legal again.
    function drawHow4(g2, tt) {
        const cell = 20;
        const ox = (DEMO_W - 8 * cell) / 2;
        const oy = 16;
        demoBoard(g2, ox, oy, 8, 8, cell);
        if (tt < 1.8) {
            const e = ease(tt / 1.1);
            demoWall(g2, ox, oy, cell, 'v', 3, 4, WALL_COLORS.v, 1, e);
            if (tt > 1.1) demoBadge(g2, true, ox + 8 * cell + 14, oy + 4 * cell);
        } else if (tt < 3.6) {
            demoWall(g2, ox, oy, cell, 'h', 3, 4, WALL_COLORS.h, 1, 1);
            const flash = Math.sin(tt * 14) > 0;
            demoWall(g2, ox, oy, cell, 'v', 3, 4, flash ? INVALID_COLOR : WALL_COLORS.v, 0.7, 1);
            demoBadge(g2, false, ox + 8 * cell + 14, oy + 4 * cell);
            demoLabel(g2, 'NO CROSSING', DEMO_W / 2, DEMO_H - 8);
        } else if (tt < 5.4) {
            demoWall(g2, ox, oy, cell, 'h', 3, 4, WALL_COLORS.h, 1, 1);
            const flash = Math.sin(tt * 14) > 0;
            demoWall(g2, ox, oy, cell, 'v', 3, 5, flash ? INVALID_COLOR : WALL_COLORS.v, 0.7, 1);
            demoBadge(g2, false, ox + 8 * cell + 14, oy + 5 * cell);
            demoLabel(g2, 'NO T-JUNCTIONS', DEMO_W / 2, DEMO_H - 8);
        } else {
            const e = ease((tt - 5.4) / 1.0);
            demoWall(g2, ox, oy, cell, 'h', 3, 4, WALL_COLORS.h, 1, 1);
            demoWall(g2, ox, oy, cell, 'h', 6, 6, WALL_COLORS.h, 1, e);
            if (tt > 6.4) demoBadge(g2, true, ox + 8 * cell + 14, oy + 6 * cell);
        }
    }

    // Step 5 — walling the only doorway is rejected; beside it is fine.
    function drawHow5(g2, tt) {
        const cell = 20;
        const ox = (DEMO_W - 8 * cell) / 2;
        const oy = 16;
        demoBoard(g2, ox, oy, 8, 8, cell);
        // fixed barrier on column boundary 3, doorway left at rows 4-5
        for (const iy of [1, 3, 7]) demoWall(g2, ox, oy, cell, 'v', 3, iy, WALL_COLORS.v, 0.9, 1);
        demoHome(g2, ox, oy, cell, 6, 1, PLAYER_COLORS[1]);
        demoPawn(g2, ox, oy, cell, 1, 4, 1);
        // dashed path pawn -> doorway -> home
        if (!(tt > 2.2 && tt < 4.4)) {
            g2.save();
            g2.strokeStyle = PLAYER_COLORS[1];
            g2.globalAlpha = 0.4 + 0.25 * Math.sin(tt * 4);
            g2.setLineDash([4, 4]);
            g2.lineWidth = 2;
            g2.beginPath();
            g2.moveTo(ox + 1.5 * cell, oy + 4.5 * cell);
            g2.lineTo(ox + 3.5 * cell, oy + 4.5 * cell);
            g2.lineTo(ox + 6.5 * cell, oy + 4.5 * cell);
            g2.lineTo(ox + 6.5 * cell, oy + 1.5 * cell);
            g2.stroke();
            g2.restore();
        }
        if (tt >= 1.2 && tt < 4.4) {
            const inTime = tt < 2.2;
            let e;
            let shake = 0;
            if (inTime) e = ease((tt - 1.2));
            else if (tt < 3.6) { e = 1; shake = Math.sin((tt - 2.2) * 22) * 2 * Math.max(0, 1 - (tt - 2.2) / 1.2); }
            else e = 1 - ease((tt - 3.6) / 0.8);
            g2.save();
            g2.translate(shake, 0);
            demoWall(g2, ox, oy, cell, 'v', 3, 5, tt > 2.2 ? INVALID_COLOR : WALL_COLORS.v, 1, Math.max(0.05, e));
            g2.restore();
            if (tt > 2.2) {
                demoBadge(g2, false, ox + 3 * cell + 22, oy + 6.6 * cell);
                demoLabel(g2, 'THAT SEALS THE PATH', DEMO_W / 2, DEMO_H - 8);
            }
        }
        if (tt >= 4.9) {
            const e = ease((tt - 4.9) / 0.9);
            demoWall(g2, ox, oy, cell, 'h', 6, 3, WALL_COLORS.h, 1, e);
            if (tt > 5.9) {
                demoBadge(g2, true, ox + 7.4 * cell, oy + 2 * cell);
                demoLabel(g2, 'BLOCKING, NOT SEALING \u2713', DEMO_W / 2, DEMO_H - 8);
            }
        }
    }

    function renderHowDemo(tt) {
        if (!howCanvasCtx) return;
        howCanvasCtx.clearRect(0, 0, DEMO_W, DEMO_H);
        howCanvasCtx.fillStyle = '#0d1326';
        howCanvasCtx.fillRect(0, 0, DEMO_W, DEMO_H);
        HOW_STEPS[howStep].draw(howCanvasCtx, tt);
    }

    function stepLoop(ts) {
        if (destroyed || !howOverlay) return;
        if (!lastFrameTs) lastFrameTs = ts;
        howClock += (ts - lastFrameTs) / 1000;
        lastFrameTs = ts;
        const loop = HOW_STEPS[howStep].loop;
        renderHowDemo(howClock % loop);
        demoRaf = requestAnimationFrame(stepLoop);
    }

    function updateHowStepUI() {
        const loop = HOW_STEPS[howStep].loop;
        howTextEl.textContent = HOW_STEPS[howStep].text;
        howNextBtn.textContent = howStep === HOW_STEPS.length - 1 ? 'Got it!' : 'Next \u2192';
        howBackBtn.disabled = howStep === 0;
        Array.prototype.forEach.call(howDotsEl.children, (d, i) => {
            d.style.background = i === howStep ? 'var(--accent)' : 'rgba(255,255,255,0.2)';
        });
        howClock = 0;
        lastFrameTs = 0;
        if (demoRaf) { cancelAnimationFrame(demoRaf); demoRaf = 0; }
        if (reduceMotion) renderHowDemo(loop / 2);
        else demoRaf = requestAnimationFrame(stepLoop);
    }

    function showHowTo() {
        if (howOverlay) return;
        howStep = 0;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '150';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'bd-how-title');
        modal.style.width = 'min(100%, 26rem)';

        const h2 = document.createElement('h2');
        h2.id = 'bd-how-title';
        h2.textContent = 'HOW TO PLAY';
        h2.style.fontSize = '1.3rem';

        howCanvas = document.createElement('canvas');
        howCanvas.width = DEMO_W;
        howCanvas.height = DEMO_H;
        howCanvas.style.cssText = 'display:block;width:100%;height:auto;margin:0.6rem 0 0.8rem;background:#0d1326;border:1px solid var(--border);border-radius:var(--radius-md);';
        howCanvas.setAttribute('role', 'img');
        howCanvas.setAttribute('aria-label', 'Animated rule demonstration.');
        howCanvasCtx = howCanvas.getContext('2d');

        howTextEl = document.createElement('p');
        howTextEl.setAttribute('aria-live', 'polite');
        howTextEl.style.cssText = 'margin:0 0 0.9rem;font-size:0.92rem;color:var(--text-primary);min-height:4.2em;';

        howDotsEl = document.createElement('div');
        howDotsEl.setAttribute('aria-hidden', 'true');
        howDotsEl.style.cssText = 'display:flex;justify-content:center;gap:0.4rem;margin-bottom:1rem;';
        for (let i = 0; i < HOW_STEPS.length; i++) {
            const d = document.createElement('span');
            d.style.cssText = 'width:8px;height:8px;border-radius:999px;background:rgba(255,255,255,0.2);';
            howDotsEl.appendChild(d);
        }

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        howBackBtn = document.createElement('button');
        howBackBtn.type = 'button';
        howBackBtn.className = 'btn btn-ghost';
        howBackBtn.textContent = '\u2190 Back';
        howBackBtn.addEventListener('click', () => {
            sfx('click');
            howStep = Math.max(0, howStep - 1);
            updateHowStepUI();
        });

        howNextBtn = document.createElement('button');
        howNextBtn.type = 'button';
        howNextBtn.className = 'btn btn-primary';
        howNextBtn.addEventListener('click', () => {
            sfx('click');
            if (howStep === HOW_STEPS.length - 1) { closeHowTo(); return; }
            howStep++;
            updateHowStepUI();
        });

        actions.append(howBackBtn, howNextBtn);
        modal.append(h2, howCanvas, howTextEl, howDotsEl, actions);
        overlay.appendChild(modal);
        container.appendChild(overlay);
        howOverlay = overlay;
        updateHowStepUI();
        howNextBtn.focus();
    }

    function closeHowTo() {
        if (!howOverlay) return;
        if (demoRaf) { cancelAnimationFrame(demoRaf); demoRaf = 0; }
        howOverlay.remove();
        howOverlay = null;
        howCanvasCtx = null;
        if (selectOverlay) selectOverlay.querySelector('button.btn-primary').focus();
        else if (endOverlay) endOverlay.querySelector('button').focus();
        else rulesBtn.focus();
    }

    // keyboard: Escape closes the rules carousel
    function onKey(e) {
        if (destroyed) return;
        if (e.key === 'Escape' && howOverlay) {
            e.preventDefault();
            closeHowTo();
        }
    }
    window.addEventListener('keydown', onKey);

    // ---------- boot ----------
    rafId = requestAnimationFrame(frame);
    showSelect();

    return {
        destroy() {
            destroyed = true;
            cancelAnimationFrame(rafId);
            if (demoRaf) cancelAnimationFrame(demoRaf);
            clearTimers();
            clearTimeout(toastTimer);
            window.removeEventListener('keydown', onKey);
            if (audioCtx) {
                try { audioCtx.close(); } catch (e) { /* already closed */ }
            }
            wrap.remove();
        }
    };
}
