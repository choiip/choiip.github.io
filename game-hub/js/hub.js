document.addEventListener('DOMContentLoaded', () => {
    const hubScreen = document.getElementById('hub-screen');
    const gameScreen = document.getElementById('game-screen');
    const gameContainer = document.getElementById('game-container');
    const backBtn = document.getElementById('back-to-hub');
    const gameCards = document.querySelectorAll('.game-card');

    let currentGame = null;

    // Start game logic
    gameCards.forEach(card => {
        const gameId = card.getAttribute('data-game');
        const startBtn = card.querySelector('.start-btn');

        const startGame = () => {
            hubScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            gameContainer.innerHTML = ''; // Clear previous game

            loadGame(gameId);
        };

        card.addEventListener('click', startGame);
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startGame();
        });
    });

    // Back to hub
    backBtn.addEventListener('click', () => {
        gameScreen.classList.add('hidden');
        hubScreen.classList.remove('hidden');
        gameContainer.innerHTML = ''; // Reset game
        currentGame = null;
    });

    async function loadGame(gameId) {
        try {
            // Dynamic import of the game module
            const module = await import(`./games/${gameId}/${gameId}.js`);
            currentGame = module.init(gameContainer);
        } catch (error) {
            console.error(`Failed to load game: ${gameId}`, error);
            gameContainer.innerHTML = `<p style="color:red">Error loading game ${gameId}. Please check if the file exists.</p>`;
        }
    }
});
