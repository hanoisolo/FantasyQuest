(function() {
    'use strict';

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const TILE_SIZE = 16;
    const SCALE = 3;
    const MAP_WIDTH = 30;
    const MAP_HEIGHT = 30;
    const VIEWPORT_TILES_X = 16;
    const VIEWPORT_TILES_Y = 15;
    const CANVAS_WIDTH = VIEWPORT_TILES_X * TILE_SIZE;
    const CANVAS_HEIGHT = VIEWPORT_TILES_Y * TILE_SIZE;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.style.width = (CANVAS_WIDTH * SCALE) + 'px';
    canvas.style.height = (CANVAS_HEIGHT * SCALE) + 'px';

    const TILE_GROUND = 0;
    const TILE_WALL = 1;

    function generateMap() {
        const map = [];
        for (let y = 0; y < MAP_HEIGHT; y++) {
            const row = [];
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1) {
                    row.push(TILE_WALL);
                } else {
                    row.push(TILE_GROUND);
                }
            }
            map.push(row);
        }

        for (let i = 0; i < 80; i++) {
            const wx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
            const wy = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
            if (!(wx === 1 && wy === 1)) {
                map[wy][wx] = TILE_WALL;
            }
        }

        return map;
    }

    const map = generateMap();

    const TILE_COLORS = {
        [TILE_GROUND]: '#2d8a2d',
        [TILE_WALL]: '#334488'
    };

    const player = {
        x: 1,
        y: 1,
        pixelX: 1 * TILE_SIZE,
        pixelY: 1 * TILE_SIZE,
        isMoving: false,
        moveProgress: 0,
        moveDuration: 150,
        targetX: 1,
        targetY: 1,
        maxHP: 20,
        currentHP: 20,
        attackPower: 5,
        level: 1,
        experience: 0,
        gold: 0
    };

    const keys = {};

    const STATE_EXPLORATION = 'EXPLORATION';
    const STATE_MENU = 'MENU';
    const STATE_COMBAT = 'COMBAT';
    let gameState = STATE_EXPLORATION;

    const ENCOUNTER_CHANCE = 0.10;

    const combat = {
        menuSelection: 0,
        menuOptions: ['Attack', 'Run'],
        battleLog: 'A wild Monster appeared!',
        monster: {
            x: CANVAS_WIDTH / 2 - 16,
            y: CANVAS_HEIGHT / 2 - 32,
            size: 32,
            color: '#cc3333',
            maxHP: 10,
            currentHP: 10,
            attackPower: 3,
            expReward: 8,
            goldReward: 12
        },
        phase: 'MENU',
        gameOver: false,
        awaitingRelease: false
    };

    const camera = {
        x: 0,
        y: 0
    };

    function updateCamera() {
        camera.x = player.pixelX - Math.floor(CANVAS_WIDTH / (2 * TILE_SIZE)) * TILE_SIZE;
        camera.y = player.pixelY - Math.floor(CANVAS_HEIGHT / (2 * TILE_SIZE)) * TILE_SIZE;

        camera.x = Math.max(0, Math.min(camera.x, MAP_WIDTH * TILE_SIZE - CANVAS_WIDTH));
        camera.y = Math.max(0, Math.min(camera.y, MAP_HEIGHT * TILE_SIZE - CANVAS_HEIGHT));
    }

    function triggerEncounter() {
        if (Math.random() < ENCOUNTER_CHANCE) {
            combat.monster.currentHP = combat.monster.maxHP;
            combat.menuSelection = 0;
            combat.battleLog = 'A wild Monster appeared!';
            combat.phase = 'MENU';
            combat.gameOver = false;
            combat.awaitingRelease = false;
            gameState = STATE_COMBAT;
        }
    }

    function handleInputCombat() {
        if (combat.gameOver) {
            if (!keys['Enter'] && !keys['z'] && !keys['Z']) {
                combat.awaitingRelease = true;
            }
            if (combat.awaitingRelease) {
                if (keys['Enter'] || keys['z'] || keys['Z']) {
                    keys['Enter'] = false;
                    keys['z'] = false;
                    keys['Z'] = false;
                    combat.awaitingRelease = false;

                    if (combat.phase === 'DEFEAT') {
                        player.currentHP = player.maxHP;
                        player.x = 1;
                        player.y = 1;
                        player.pixelX = 1 * TILE_SIZE;
                        player.pixelY = 1 * TILE_SIZE;
                    }

                    gameState = STATE_EXPLORATION;
                }
            }
            return;
        }

        if (combat.phase !== 'MENU') return;

        if (keys['ArrowUp']) {
            keys['ArrowUp'] = false;
            combat.menuSelection = (combat.menuSelection - 1 + combat.menuOptions.length) % combat.menuOptions.length;
        } else if (keys['ArrowDown']) {
            keys['ArrowDown'] = false;
            combat.menuSelection = (combat.menuSelection + 1) % combat.menuOptions.length;
        } else if (keys['Enter'] || keys['z'] || keys['Z']) {
            keys['Enter'] = false;
            keys['z'] = false;
            keys['Z'] = false;
            combat.awaitingRelease = false;

            const selected = combat.menuOptions[combat.menuSelection];
            if (selected === 'Attack') {
                combat.monster.currentHP -= player.attackPower;
                combat.battleLog = 'You attack for ' + player.attackPower + ' damage!';

                if (combat.monster.currentHP <= 0) {
                    combat.monster.currentHP = 0;
                    combat.phase = 'VICTORY';
                    combat.gameOver = true;

                    // Hand the monster's EXP to the player via the
                    // progression module, which also handles level-ups.
                    const leveledUp = window.Progression.gainExperience(player, combat.monster.expReward);

                    // Loot: the monster's gold goes straight to the purse.
                    player.gold += combat.monster.goldReward;

                    combat.battleLog = leveledUp
                        ? 'Monster defeated! You reached Lv ' + player.level + '!'
                        : 'Monster defeated! Victory! + ' + combat.monster.expReward + ' EXP, + ' + combat.monster.goldReward + 'G.';
                } else {
                    player.currentHP -= combat.monster.attackPower;
                    combat.battleLog += ' Monster counters for ' + combat.monster.attackPower + '!';

                    if (player.currentHP <= 0) {
                        player.currentHP = 0;
                        combat.battleLog = 'You have been defeated... Game Over.';
                        combat.phase = 'DEFEAT';
                        combat.gameOver = true;
                    }
                }
            } else if (selected === 'Run') {
                combat.battleLog = 'You got away safely!';
                gameState = STATE_EXPLORATION;
            }
        }
    }

    let lastTime = 0;

    function gameLoop(timestamp) {
        const deltaTime = timestamp - lastTime;
        lastTime = timestamp;

        if (gameState === STATE_EXPLORATION) {
            handleInputExploration();
            update(deltaTime);
        } else if (gameState === STATE_MENU) {
            handleInputMenu();
        } else if (gameState === STATE_COMBAT) {
            handleInputCombat();
        }
        render();

        requestAnimationFrame(gameLoop);
    }

    function handleInputExploration() {
        if (player.isMoving) return;

        let dx = 0;
        let dy = 0;

        if (keys['ArrowUp']) dy = -1;
        else if (keys['ArrowDown']) dy = 1;
        else if (keys['ArrowLeft']) dx = -1;
        else if (keys['ArrowRight']) dx = 1;

        if (dx !== 0 || dy !== 0) {
            const newX = player.x + dx;
            const newY = player.y + dy;

            if (newX >= 0 && newX < MAP_WIDTH && newY >= 0 && newY < MAP_HEIGHT) {
                if (map[newY][newX] !== TILE_WALL) {
                    player.targetX = newX;
                    player.targetY = newY;
                    player.isMoving = true;
                    player.moveProgress = 0;
                }
            }
        }
    }

    function handleInputMenu() {
    }

    function update(deltaTime) {
        if (player.isMoving) {
            player.moveProgress += deltaTime;
            const t = Math.min(player.moveProgress / player.moveDuration, 1);

            const startX = player.x * TILE_SIZE;
            const startY = player.y * TILE_SIZE;
            const endX = player.targetX * TILE_SIZE;
            const endY = player.targetY * TILE_SIZE;

            player.pixelX = startX + (endX - startX) * t;
            player.pixelY = startY + (endY - startY) * t;

            if (t >= 1) {
                player.x = player.targetX;
                player.y = player.targetY;
                player.pixelX = player.x * TILE_SIZE;
                player.pixelY = player.y * TILE_SIZE;
                player.isMoving = false;
                triggerEncounter();
            }
        }

        updateCamera();
    }

    function render() {
        if (gameState === STATE_COMBAT) {
            renderCombat();
            return;
        }

        const startTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
        const startTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
        const endTileX = Math.min(MAP_WIDTH, Math.ceil((camera.x + CANVAS_WIDTH) / TILE_SIZE) + 1);
        const endTileY = Math.min(MAP_HEIGHT, Math.ceil((camera.y + CANVAS_HEIGHT) / TILE_SIZE) + 1);

        for (let y = startTileY; y < endTileY; y++) {
            for (let x = startTileX; x < endTileX; x++) {
                const tileType = map[y][x];
                const drawX = x * TILE_SIZE - camera.x;
                const drawY = y * TILE_SIZE - camera.y;
                ctx.fillStyle = TILE_COLORS[tileType];
                ctx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
            }
        }

        const playerDrawX = player.pixelX - camera.x;
        const playerDrawY = player.pixelY - camera.y;
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(playerDrawX, playerDrawY, TILE_SIZE, TILE_SIZE);

        if (gameState === STATE_MENU) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            ctx.fillStyle = '#ffffff';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Game Paused', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 4);
            ctx.fillText('/ Menu', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 6);
        }
    }

    function renderCombat() {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        ctx.fillStyle = combat.monster.color;
        ctx.fillRect(
            combat.monster.x,
            combat.monster.y,
            combat.monster.size,
            combat.monster.size
        );

        ctx.fillStyle = '#ffffff';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Monster', combat.monster.x + combat.monster.size / 2, combat.monster.y - 4);

        ctx.fillText(
            'HP: ' + combat.monster.currentHP + '/' + combat.monster.maxHP,
            combat.monster.x + combat.monster.size / 2,
            combat.monster.y + combat.monster.size + 12
        );

        ctx.fillText(
            'Player HP: ' + player.currentHP + '/' + player.maxHP,
            CANVAS_WIDTH / 2,
            16
        );

        const expToNext = window.Progression.experienceToNextLevel(player.experience);
        ctx.fillText(
            'Lv ' + player.level +
                (expToNext !== null ? '  EXP to next: ' + expToNext : '  MAX'),
            CANVAS_WIDTH / 2,
            26
        );

        ctx.fillText('Gold: ' + player.gold + 'G', CANVAS_WIDTH / 2, 36);

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, CANVAS_HEIGHT - 48, CANVAS_WIDTH, 48);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, CANVAS_HEIGHT - 48, CANVAS_WIDTH, 48);

        ctx.fillStyle = '#ffffff';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(combat.battleLog, 4, CANVAS_HEIGHT - 36);

        if (!combat.gameOver) {
            ctx.textAlign = 'right';
            for (let i = 0; i < combat.menuOptions.length; i++) {
                const option = combat.menuOptions[i];
                const prefix = combat.menuSelection === i ? '> ' : '  ';
                ctx.fillText(prefix + option, CANVAS_WIDTH - 4, CANVAS_HEIGHT - 36 + (i * 10));
            }
        } else {
            ctx.textAlign = 'center';
            if (combat.phase === 'VICTORY') {
                ctx.fillStyle = '#44ff44';
                ctx.fillText('VICTORY! Press ENTER to continue.', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 20);
            } else if (combat.phase === 'DEFEAT') {
                ctx.fillStyle = '#ff4444';
                ctx.fillText('GAME OVER. Press ENTER to respawn.', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 20);
            }
        }
    }

    document.addEventListener('keydown', function(e) {
        if (gameState === STATE_COMBAT) {
            if (['ArrowUp', 'ArrowDown', 'Enter', 'z', 'Z'].includes(e.key)) {
                e.preventDefault();
                keys[e.key] = true;
            }
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (gameState === STATE_EXPLORATION) {
                gameState = STATE_MENU;
            } else if (gameState === STATE_MENU) {
                gameState = STATE_EXPLORATION;
            }
            return;
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            keys[e.key] = true;
        }
    });

    document.addEventListener('keyup', function(e) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            keys[e.key] = false;
        }
    });

    function init() {
        requestAnimationFrame(function(timestamp) {
            lastTime = timestamp;
            requestAnimationFrame(gameLoop);
        });
    }

    init();
})();
