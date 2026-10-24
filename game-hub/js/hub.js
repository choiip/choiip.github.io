document.addEventListener('DOMContentLoaded', () => {
    const hubScreen = document.getElementById('hub-screen');
    const gameScreen = document.getElementById('game-screen');
    const gameContainer = document.getElementById('game-container');
    const backBtn = document.getElementById('back-to-hub');
    const playButtons = document.querySelectorAll('.play-area');

    // ---- Trophy high-score popover ----
    const trophyPopover = document.getElementById('trophy-popover');
    const trophyName = document.getElementById('trophy-popover-name');
    const trophyList = document.getElementById('trophy-popover-list');
    const trophyEmpty = document.getElementById('trophy-popover-empty');
    const trophyButtons = document.querySelectorAll('.trophy-btn');

    const GAME_NAMES = { snake: 'Snake', tetris: 'Tetris', breakout: 'Breakout', flappy: 'Flappy Bird', racer: 'Neon Glide', pinball: 'Micro Pinball', 'neural-strike': 'Neural Strike', 'gravity-faller': 'Gravity Faller' };
    let activeTrophy = null;
    let hideTimer = null;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    function getScores(game) {
        return JSON.parse(localStorage.getItem(game + '_highscores') || '[]');
    }

    function populatePopover(game) {
        const scores = getScores(game);
        trophyName.textContent = `${GAME_NAMES[game] || game} High Scores`;
        if (scores.length === 0) {
            trophyList.innerHTML = '';
            trophyEmpty.hidden = false;
        } else {
            trophyEmpty.hidden = true;
            trophyList.innerHTML = scores
                .map((s, i) =>
                    `<li><span><span class="rank">${i + 1}.</span><span class="initials">${escapeHtml(s.initials)}</span></span><span class="entry-score">${s.score}</span></li>`
                )
                .join('');
        }
    }

    function positionPopover(trophyBtn) {
        const rect = trophyBtn.getBoundingClientRect();
        // Right-align to the trophy, drop below it (flip above if it would overflow)
        trophyPopover.style.right = `${window.innerWidth - rect.right}px`;
        let top = rect.bottom + 8;
        const popHeight = trophyPopover.offsetHeight;
        if (top + popHeight > window.innerHeight - 8) {
            top = rect.top - popHeight - 8;
        }
        trophyPopover.style.top = `${top}px`;
    }

    function showTrophy(trophyBtn) {
        clearTimeout(hideTimer);
        activeTrophy = trophyBtn;
        populatePopover(trophyBtn.dataset.trophy);
        trophyPopover.hidden = false;
        positionPopover(trophyBtn);
    }

    function hideTrophy() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            trophyPopover.hidden = true;
            activeTrophy = null;
        }, 120);
    }

    function closeTrophyNow() {
        clearTimeout(hideTimer);
        trophyPopover.hidden = true;
        activeTrophy = null;
    }

    trophyButtons.forEach((btn) => {
        btn.addEventListener('mouseenter', () => showTrophy(btn));
        btn.addEventListener('mouseleave', hideTrophy);
        btn.addEventListener('focus', () => showTrophy(btn));
        btn.addEventListener('blur', hideTrophy);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeTrophy === btn && !trophyPopover.hidden) {
                trophyPopover.hidden = true;
                activeTrophy = null;
            } else {
                showTrophy(btn);
            }
        });
    });

    // Keep the popover open while the cursor is over it
    trophyPopover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    trophyPopover.addEventListener('mouseleave', hideTrophy);

    // Close on outside click or Escape
    document.addEventListener('click', (e) => {
        if (!trophyPopover.hidden &&
            !e.target.closest('.trophy-popover') &&
            !e.target.closest('.trophy-btn')) {
            closeTrophyNow();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !trophyPopover.hidden) {
            closeTrophyNow();
        }
    });
    window.addEventListener('resize', () => {
        if (activeTrophy && !trophyPopover.hidden) {
            positionPopover(activeTrophy);
        }
    });
    // ---- End trophy popover ----

    let currentGame = null;

    function stopGame() {
        if (currentGame && typeof currentGame.destroy === 'function') {
            currentGame.destroy();
        }
        currentGame = null;
        gameContainer.innerHTML = '';
        gameScreen.hidden = true;
        hubScreen.hidden = false;
    }

    async function startGame(gameId) {
        closeTrophyNow();
        stopGame();
        hubScreen.hidden = true;
        gameScreen.hidden = false;

        try {
            // Dynamic import of the game module
            const module = await import(`./games/${gameId}/${gameId}.js`);
            currentGame = module.init(gameContainer);
        } catch (error) {
            console.error(`Failed to load game: ${gameId}`, error);
            gameContainer.innerHTML = `<p class="load-error">Couldn&rsquo;t load that game. Check the file exists, then refresh.</p>`;
        }
    }

    // Play area buttons start the game (works for pointer and keyboard)
    playButtons.forEach((btn) => {
        btn.addEventListener('click', () => startGame(btn.dataset.game));
    });

    // Back to hub
    backBtn.addEventListener('click', stopGame);
});
