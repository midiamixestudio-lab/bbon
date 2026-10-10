console.log('Script iniciado!');

window.onload = () => {
    console.log('Window loaded!');
    
    if (typeof firebase === 'undefined') {
        console.error('Firebase não está disponível!');
        alert('Erro: Firebase não carregado. Verifique sua conexão com a internet.');
        return;
    }
    
    if (typeof database === 'undefined') {
        console.error('Database não está disponível!');
        alert('Erro: Database não configurado.');
        return;
    }
    
    console.log('Firebase disponível!');
    
    const canvas = document.getElementById('canvas');
    if (!canvas) {
        console.error('Canvas não encontrado!');
        return;
    }
    
    const context = canvas.getContext('2d');
    let requestId, requestId2;
    let start = false;
    let players = {};
    let localPlayerId = null;
    let enemyPlayers = {};
    let enemyPlayerObjects = {};
    let gameStarted = false;
    let currentMap = [];
    let frameCount = 0;
    let newPlayer = null;
    let bombCooldown = false;
    let activeBombs = [];
    let explosionCells = [];
    let isHost = false;
    let mapGenerated = false;
    let lastSyncTime = 0;
    const SYNC_INTERVAL = 50;

    const gridWidth = 50;
    const gridHeigth = 50;
    const offset = 50;

    // ============ VARIÁVEIS PARA BOMBAS EMPURRÁVEIS ============
    let pushableBombs = {};
    
    // ============ VARIÁVEIS PARA DOUBLE TAP ============
    let lastKeyPress = {};
    let keyPressCount = {};
    let keyPressTimer = {};

    function generatePlayerId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    }

    function registerPlayer(playerName = 'Player') {
        localPlayerId = generatePlayerId();
        console.log('Registrando jogador:', localPlayerId);
        
        playersRef.once('value', (snapshot) => {
            const data = snapshot.val();
            const isFirstPlayer = !data || Object.keys(data).length === 0;
            
            const playerData = {
                id: localPlayerId,
                name: playerName,
                x: 60,
                y: 60,
                health: 100,
                bombs: 1,
                bombPower: 1,
                speed: 2,
                enemiesKilled: 0,
                isReady: false,
                connected: true,
                lastUpdate: Date.now(),
                isHost: isFirstPlayer
            };

            if (isFirstPlayer) {
                isHost = true;
                console.log('Você é o HOST!');
            }

            playersRef.child(localPlayerId).set(playerData)
                .then(() => {
                    console.log('Jogador registrado com sucesso!');
                })
                .catch((error) => {
                    console.error('Erro ao registrar jogador:', error);
                    alert('Erro ao conectar ao Firebase: ' + error.message);
                });
        });
            
        playersRef.child(localPlayerId).onDisconnect().update({ connected: false });
        return localPlayerId;
    }

    function listenPlayers() {
        playersRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(id => {
                    if (id !== localPlayerId && data[id].connected) {
                        if (!enemyPlayers[id]) {
                            enemyPlayers[id] = {
                                ...data[id],
                                targetX: data[id].x || 60,
                                targetY: data[id].y || 60,
                                currentX: data[id].x || 60,
                                currentY: data[id].y || 60,
                                left: data[id].left || false,
                                right: data[id].right || false,
                                up: data[id].up || false,
                                down: data[id].down || false,
                                lastUpdate: Date.now()
                            };
                        } else {
                            enemyPlayers[id].targetX = data[id].x || enemyPlayers[id].x;
                            enemyPlayers[id].targetY = data[id].y || enemyPlayers[id].y;
                            enemyPlayers[id].lastUpdate = Date.now();
                            enemyPlayers[id].health = data[id].health || 100;
                            enemyPlayers[id].name = data[id].name || 'Player';
                            enemyPlayers[id].gridX = data[id].gridX;
                            enemyPlayers[id].gridY = data[id].gridY;
                            enemyPlayers[id].left = data[id].left || false;
                            enemyPlayers[id].right = data[id].right || false;
                            enemyPlayers[id].up = data[id].up || false;
                            enemyPlayers[id].down = data[id].down || false;
                        }
                    } else if (id === localPlayerId) {
                        if (newPlayer) {
                            const localData = data[id];
                            newPlayer.health = localData.health || 100;
                            newPlayer.bombs = localData.bombs || 1;
                            newPlayer.bombPower = localData.bombPower || 1;
                            newPlayer.enemiesKilled = localData.enemiesKilled || 0;
                            if (localData.isHost) {
                                isHost = true;
                            }
                        }
                    }
                });
                
                Object.keys(enemyPlayers).forEach(id => {
                    if (!data[id] || !data[id].connected) {
                        delete enemyPlayers[id];
                        delete enemyPlayerObjects[id];
                    }
                });

                updatePlayerCount();
            }
        });
    }

    function listenGameState() {
        gameStateRef.on('value', (snapshot) => {
            const state = snapshot.val();
            if (state) {
                if (state.map && state.map.length > 0) {
                    currentMap = state.map;
                }
                if (state.started && !gameStarted) {
                    gameStarted = true;
                    startGame();
                }
            }
        });
    }

    function listenMap() {
        mapRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.length > 0) {
                const mapChanged = JSON.stringify(data) !== JSON.stringify(currentMap);
                if (mapChanged) {
                    console.log('Mapa atualizado do Firebase');
                    currentMap = data;
                    mapGenerated = true;
                }
            }
        });
    }

    function listenBombs() {
        bombsRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data || currentMap.length === 0) return;
            
            for (let j = 0; j < currentMap.length; j++) {
                for (let i = 0; i < currentMap[0].length; i++) {
                    if (currentMap[j][i] === 3 || currentMap[j][i] === 4) {
                        currentMap[j][i] = 0;
                    }
                }
            }
            
            Object.keys(data).forEach(key => {
                const bomb = data[key];
                const isRecent = (Date.now() - bomb.timestamp) < 10000;
                
                if (bomb.active && isRecent) {
                    const gridX = Math.floor(bomb.x / gridWidth);
                    const gridY = Math.floor((bomb.y - offset) / gridHeigth);
                    if (gridY >= 0 && gridY < currentMap.length && gridX >= 0 && gridX < currentMap[0].length) {
                        currentMap[gridY][gridX] = bomb.isExplosion ? 4 : 3;
                        if (bomb.isExplosion) {
                            explosionCells.push({x: gridX, y: gridY});
                        }
                    }
                } else if (bomb.active && !isRecent) {
                    bombsRef.child(key).remove();
                }
            });
        });
    }

    // ============ LISTENER PARA BOMBAS EMPURRÁVEIS ============
    function listenPushableBombs() {
        bombsRef.on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (data && data.isPushable && data.active) {
                const bombId = snapshot.key;
                if (!pushableBombs[bombId]) {
                    pushableBombs[bombId] = {
                        id: bombId,
                        gridX: data.gridX,
                        gridY: data.gridY,
                        power: data.power,
                        playerId: data.playerId,
                        active: true,
                        timestamp: data.timestamp || Date.now(),
                        isMoving: false,
                        moveX: 0,
                        moveY: 0,
                        startX: data.gridX,
                        startY: data.gridY,
                        targetX: data.gridX,
                        targetY: data.gridY,
                        progress: 0
                    };
                    
                    if (currentMap[data.gridY] && currentMap[data.gridY][data.gridX] === 0) {
                        currentMap[data.gridY][data.gridX] = 3;
                    }
                }
            }
        });
        
        bombsRef.on('child_changed', (snapshot) => {
            const data = snapshot.val();
            const bombId = snapshot.key;
            if (pushableBombs[bombId] && data) {
                const oldGridX = pushableBombs[bombId].gridX;
                const oldGridY = pushableBombs[bombId].gridY;
                if (currentMap[oldGridY] && currentMap[oldGridY][oldGridX] === 3) {
                    currentMap[oldGridY][oldGridX] = 0;
                }
                
                pushableBombs[bombId].gridX = data.gridX;
                pushableBombs[bombId].gridY = data.gridY;
                pushableBombs[bombId].targetX = data.gridX;
                pushableBombs[bombId].targetY = data.gridY;
                
                if (currentMap[data.gridY] && currentMap[data.gridY][data.gridX] === 0) {
                    currentMap[data.gridY][data.gridX] = 3;
                }
            }
        });
        
        bombsRef.on('child_removed', (snapshot) => {
            const bombId = snapshot.key;
            if (pushableBombs[bombId]) {
                const bomb = pushableBombs[bombId];
                if (currentMap[bomb.gridY] && currentMap[bomb.gridY][bomb.gridX] === 3) {
                    currentMap[bomb.gridY][bomb.gridX] = 0;
                }
                delete pushableBombs[bombId];
            }
        });
    }

    function syncPlayerDirection() {
        if (!localPlayerId || !newPlayer) return;
        playersRef.child(localPlayerId).update({
            left: newPlayer.left,
            right: newPlayer.right,
            up: newPlayer.up,
            down: newPlayer.down
        });
    }

    function updatePlayerCount() {
        const count = Object.keys(enemyPlayers).length + 1;
        const playerCountEl = document.getElementById('player-count');
        const playerIdEl = document.getElementById('player-id');
        if (playerCountEl) playerCountEl.textContent = 'Players online: ' + count;
        if (playerIdEl) playerIdEl.textContent = 'Player ID: ' + localPlayerId + (isHost ? ' (HOST)' : '');
    }

    // ============ FUNÇÃO PARA RESETAR O MAPA GLOBAL ============
    function resetGlobalMap() {
        console.log('Resetando mapa global...');
        
        // Gera um novo mapa aleatório
        const baseMaps = [map1, map2];
        const selectedMap = baseMaps[Math.floor(Math.random() * baseMaps.length)];
        const newMap = makeRandMap(selectedMap);
        
        // Atualiza o mapa atual
        currentMap = newMap;
        mapGenerated = true;
        
        // Salva no Firebase
        mapRef.set(newMap)
            .then(() => {
                console.log('Mapa resetado e salvo no Firebase!');
            })
            .catch((error) => {
                console.error('Erro ao resetar mapa:', error);
            });
        
        // Limpa todas as bombas do Firebase
        bombsRef.once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const keys = Object.keys(data);
                keys.forEach(key => {
                    bombsRef.child(key).remove()
                        .then(() => {
                            console.log('Bomba removida do Firebase:', key);
                        })
                        .catch((error) => {
                            console.error('Erro ao remover bomba:', error);
                        });
                });
            }
        });
        
        // Limpa bombas locais
        pushableBombs = {};
        activeBombs = [];
        explosionCells = [];
        
        // Reseta o estado do jogo
        gameStarted = false;
        
        console.log('Mapa resetado com sucesso!');
    }

    // ============ FUNÇÃO PARA LIMPAR BOMBAS ============
    function clearAllBombs() {
        console.log('Limpando todas as bombas...');
        
        // Limpa do Firebase
        bombsRef.once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const keys = Object.keys(data);
                keys.forEach(key => {
                    bombsRef.child(key).remove()
                        .then(() => {
                            console.log('Bomba removida do Firebase:', key);
                        })
                        .catch((error) => {
                            console.error('Erro ao remover bomba:', error);
                        });
                });
            }
        });
        
        // Limpa locais
        pushableBombs = {};
        activeBombs = [];
        explosionCells = [];
        
        // Limpa bombas do mapa
        if (currentMap && currentMap.length > 0) {
            for (let j = 0; j < currentMap.length; j++) {
                for (let i = 0; i < currentMap[0].length; i++) {
                    if (currentMap[j][i] === 3 || currentMap[j][i] === 4) {
                        currentMap[j][i] = 0;
                    }
                }
            }
            mapRef.set(currentMap);
        }
        
        console.log('Todas as bombas foram limpas!');
    }

    // ============ FUNÇÃO PARA VERIFICAR E RESETAR SALA VAZIA ============
    function checkAndResetRoom(roomId) {
        roomsRef.child(roomId).once('value', (snapshot) => {
            const roomData = snapshot.val();
            if (!roomData) {
                console.log('Sala já foi removida!');
                resetGlobalMap();
                return;
            }
            
            const players = roomData.players || {};
            const playerCount = Object.keys(players).length;
            
            // Se não tiver mais ninguém na sala
            if (playerCount === 0) {
                console.log('Sala vazia! Resetando mapa e estado...');
                
                // Primeiro reseta o mapa global
                resetGlobalMap();
                
                // Depois remove a sala
                setTimeout(() => {
                    roomsRef.child(roomId).remove()
                        .then(() => {
                            console.log('Sala removida:', roomId);
                        })
                        .catch((error) => {
                            console.error('Erro ao remover sala:', error);
                        });
                    
                    // Se o jogador ainda estiver na sala, sai automaticamente
                    if (roomState.roomId === roomId) {
                        roomState.roomId = null;
                        roomState.gameMode = 'waiting';
                        roomState.players = {};
                        
                        const roomUI = document.getElementById('room-ui');
                        if (roomUI) roomUI.style.display = 'none';
                        
                        const deathOverlay = document.getElementById('death-overlay');
                        if (deathOverlay) deathOverlay.style.display = 'none';
                        
                        updateRoomStatus();
                        
                        // Reseta o jogo para o menu
                        if (gameStarted) {
                            gameStarted = false;
                            if (typeof level1 !== 'undefined') {
                                level1.pause();
                            }
                            menu();
                        }
                    }
                }, 500);
            } else {
                console.log('Sala ainda tem jogadores:', playerCount);
            }
        });
    }

    // ============ MONITORAMENTO PERIÓDICO DE SALAS VAZIAS ============
    function startRoomMonitor() {
        setInterval(() => {
            if (roomState.roomId) {
                roomsRef.child(roomState.roomId).child('players').once('value', (snapshot) => {
                    const players = snapshot.val() || {};
                    const playerCount = Object.keys(players).length;
                    
                    if (playerCount === 0) {
                        console.log('Monitor detectou sala vazia!');
                        checkAndResetRoom(roomState.roomId);
                    }
                });
            }
        }, 5000); // Verifica a cada 5 segundos
    }

    // ============ FUNÇÃO PARA CRIAR BOMBA EMPURRÁVEL ============
    function createPushableBomb(gridX, gridY, bombPower, playerId) {
        const bombId = 'bomb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        
        pushableBombs[bombId] = {
            id: bombId,
            gridX: gridX,
            gridY: gridY,
            power: bombPower,
            playerId: playerId,
            active: true,
            timestamp: Date.now(),
            isMoving: false,
            moveX: 0,
            moveY: 0,
            startX: gridX,
            startY: gridY,
            targetX: gridX,
            targetY: gridY,
            progress: 0
        };
        
        const bombData = {
            x: gridX * gridWidth,
            y: gridY * gridHeigth + offset,
            gridX: gridX,
            gridY: gridY,
            power: bombPower,
            active: true,
            isExplosion: false,
            timestamp: Date.now(),
            isPushable: true,
            playerId: playerId
        };
        
        bombsRef.child(bombId).set(bombData);
        
        if (currentMap[gridY] && currentMap[gridY][gridX] === 0) {
            currentMap[gridY][gridX] = 3;
        }
        
        setTimeout(() => {
            if (pushableBombs[bombId] && pushableBombs[bombId].active) {
                explodePushableBomb(bombId);
            }
        }, 2500);
        
        return bombId;
    }

    // ============ FUNÇÃO PARA EMPURRAR BOMBA COM DOUBLE TAP ============
    function pushBombWithDoubleTap(bombId, direction) {
        const bomb = pushableBombs[bombId];
        if (!bomb || !bomb.active || bomb.isMoving) return;
        
        let dirX = 0, dirY = 0;
        if (direction === 'left') dirX = -1;
        else if (direction === 'right') dirX = 1;
        else if (direction === 'up') dirY = -1;
        else if (direction === 'down') dirY = 1;
        
        // Verifica a direção oposta
        const playerGridX = Math.floor(newPlayer.x / gridWidth);
        const playerGridY = Math.floor((newPlayer.y - offset) / gridHeigth);
        const dx = bomb.gridX - playerGridX;
        const dy = bomb.gridY - playerGridY;
        
        if ((dirX === -1 && dx > 0) || (dirX === 1 && dx < 0) ||
            (dirY === -1 && dy > 0) || (dirY === 1 && dy < 0)) {
            return;
        }
        
        // Calcula até onde a bomba pode ir
        let finalGridX = bomb.gridX;
        let finalGridY = bomb.gridY;
        let steps = 0;
        const MAX_PUSH = 10;
        
        for (let i = 1; i <= MAX_PUSH; i++) {
            const testX = bomb.gridX + (dirX * i);
            const testY = bomb.gridY + (dirY * i);
            
            if (testY < 0 || testY >= currentMap.length || testX < 0 || testX >= currentMap[0].length) {
                break;
            }
            
            if (currentMap[testY][testX] !== 0) {
                break;
            }
            
            // Verifica se tem outra bomba no caminho
            let hasBomb = false;
            Object.keys(pushableBombs).forEach(id => {
                if (id !== bombId && pushableBombs[id].active) {
                    if (pushableBombs[id].gridX === testX && pushableBombs[id].gridY === testY) {
                        hasBomb = true;
                    }
                }
            });
            
            if (hasBomb) break;
            
            finalGridX = testX;
            finalGridY = testY;
            steps = i;
        }
        
        if (steps === 0) return;
        
        // Remove a bomba da posição atual
        if (currentMap[bomb.gridY] && currentMap[bomb.gridY][bomb.gridX] === 3) {
            currentMap[bomb.gridY][bomb.gridX] = 0;
        }
        
        // Inicia o movimento
        bomb.isMoving = true;
        bomb.startX = bomb.gridX;
        bomb.startY = bomb.gridY;
        bomb.targetX = finalGridX;
        bomb.targetY = finalGridY;
        bomb.moveX = dirX;
        bomb.moveY = dirY;
        bomb.progress = 0;
        
        // Atualiza a posição da bomba
        const oldGridX = bomb.gridX;
        const oldGridY = bomb.gridY;
        bomb.gridX = finalGridX;
        bomb.gridY = finalGridY;
        
        if (currentMap[finalGridY] && currentMap[finalGridY][finalGridX] === 0) {
            currentMap[finalGridY][finalGridX] = 3;
        }
        
        bombsRef.child(bombId).update({
            x: finalGridX * gridWidth,
            y: finalGridY * gridHeigth + offset,
            gridX: finalGridX,
            gridY: finalGridY
        });
        
        console.log(`Bomba empurrada ${steps} blocos para ${direction} (Double Tap!)`);
        
        if (typeof stepsSound !== 'undefined') {
            stepsSound.play();
        }
    }

    // ============ FUNÇÃO PARA VERIFICAR DOUBLE TAP ============
    function handleDoubleTap(direction) {
        if (!newPlayer || !newPlayer.isAlive) return;
        
        const currentTime = Date.now();
        const key = direction;
        
        if (!lastKeyPress[key]) {
            lastKeyPress[key] = currentTime;
            keyPressCount[key] = 1;
            clearTimeout(keyPressTimer[key]);
            
            keyPressTimer[key] = setTimeout(() => {
                keyPressCount[key] = 0;
                lastKeyPress[key] = null;
            }, 300);
            return;
        }
        
        const timeDiff = currentTime - lastKeyPress[key];
        if (timeDiff < 300 && keyPressCount[key] >= 1) {
            keyPressCount[key] = 2;
            clearTimeout(keyPressTimer[key]);
            
            const playerGridX = newPlayer.gridX;
            const playerGridY = newPlayer.gridY;
            
            let dirX = 0, dirY = 0;
            if (direction === 'left') dirX = -1;
            else if (direction === 'right') dirX = 1;
            else if (direction === 'up') dirY = -1;
            else if (direction === 'down') dirY = 1;
            
            const checkX = playerGridX + dirX;
            const checkY = playerGridY + dirY;
            
            Object.keys(pushableBombs).forEach(bombId => {
                const bomb = pushableBombs[bombId];
                if (bomb && bomb.active && !bomb.isMoving) {
                    if (bomb.gridX === checkX && bomb.gridY === checkY) {
                        pushBombWithDoubleTap(bombId, direction);
                    }
                }
            });
            
            keyPressCount[key] = 0;
            lastKeyPress[key] = null;
        } else {
            lastKeyPress[key] = currentTime;
            keyPressCount[key] = 1;
            clearTimeout(keyPressTimer[key]);
            
            keyPressTimer[key] = setTimeout(() => {
                keyPressCount[key] = 0;
                lastKeyPress[key] = null;
            }, 300);
        }
    }

    // ============ FUNÇÃO PARA EXPLODIR BOMBA EMPURRÁVEL ============
    function explodePushableBomb(bombId) {
        const bomb = pushableBombs[bombId];
        if (!bomb || !bomb.active) return;
        
        bomb.active = false;
        const { gridX, gridY, power } = bomb;
        
        console.log('Explodindo bomba empurrável em:', gridX, gridY);
        
        explosionCells = [];
        
        const explosionData = {
            x: gridX * gridWidth,
            y: gridY * gridHeigth + offset,
            gridX: gridX,
            gridY: gridY,
            power: power,
            active: true,
            isExplosion: true,
            timestamp: Date.now()
        };
        bombsRef.child(bombId).update(explosionData);
        
        if (currentMap[gridY] && currentMap[gridY][gridX] === 3) {
            currentMap[gridY][gridX] = 4;
            explosionCells.push({x: gridX, y: gridY});
        }
        
        const directions = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0]
        ];
        
        directions.forEach(([dx, dy]) => {
            for (let i = 1; i <= power; i++) {
                const checkX = gridX + (dx * i);
                const checkY = gridY + (dy * i);
                
                if (checkY < 0 || checkY >= currentMap.length || checkX < 0 || checkX >= currentMap[0].length) {
                    break;
                }
                
                if (currentMap[checkY][checkX] === 1) {
                    break;
                }
                
                if (currentMap[checkY][checkX] === 2) {
                    currentMap[checkY][checkX] = 0;
                    if (Math.random() > 0.7) {
                        const powerUp = Math.floor(Math.random() * 3) + 5;
                        currentMap[checkY][checkX] = powerUp;
                    }
                    break;
                }
                
                if (currentMap[checkY][checkX] === 0 || currentMap[checkY][checkX] === 3) {
                    currentMap[checkY][checkX] = 4;
                    explosionCells.push({x: checkX, y: checkY});
                }
            }
        });
        
        checkPlayerDamageFromExplosion();
        
        mapRef.set(currentMap);
        
        setTimeout(() => {
            bombsRef.child(bombId).remove();
            delete pushableBombs[bombId];
            for (let j = 0; j < currentMap.length; j++) {
                for (let i = 0; i < currentMap[0].length; i++) {
                    if (currentMap[j][i] === 4) {
                        currentMap[j][i] = 0;
                    }
                }
            }
            explosionCells = [];
            mapRef.set(currentMap);
        }, 450);
    }

    // ============ SUBSTITUINDO A FUNÇÃO placeBombOnline ============
    function placeBombOnline(gridX, gridY, bombPower) {
        return createPushableBomb(gridX, gridY, bombPower, localPlayerId);
    }

    function explodeBomb(bombId, gridX, gridY, bombPower) {
        console.log('Explodindo bomba em:', gridX, gridY);
        
        explosionCells = [];
        
        const explosionData = {
            x: gridX * gridWidth,
            y: gridY * gridHeigth + offset,
            gridX: gridX,
            gridY: gridY,
            power: bombPower,
            active: true,
            isExplosion: true,
            timestamp: Date.now()
        };
        bombsRef.child(bombId).update(explosionData);
        
        if (currentMap[gridY] && currentMap[gridY][gridX] === 3) {
            currentMap[gridY][gridX] = 4;
            explosionCells.push({x: gridX, y: gridY});
        }
        
        const directions = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0]
        ];
        
        directions.forEach(([dx, dy]) => {
            for (let i = 1; i <= bombPower; i++) {
                const checkX = gridX + (dx * i);
                const checkY = gridY + (dy * i);
                
                if (checkY < 0 || checkY >= currentMap.length || checkX < 0 || checkX >= currentMap[0].length) {
                    break;
                }
                
                if (currentMap[checkY][checkX] === 1) {
                    break;
                }
                
                if (currentMap[checkY][checkX] === 2) {
                    currentMap[checkY][checkX] = 0;
                    if (Math.random() > 0.7) {
                        const powerUp = Math.floor(Math.random() * 3) + 5;
                        currentMap[checkY][checkX] = powerUp;
                    }
                    break;
                }
                
                if (currentMap[checkY][checkX] === 0 || currentMap[checkY][checkX] === 3) {
                    currentMap[checkY][checkX] = 4;
                    explosionCells.push({x: checkX, y: checkY});
                }
            }
        });
        
        checkPlayerDamageFromExplosion();
        
        mapRef.set(currentMap);
        
        setTimeout(() => {
            bombsRef.child(bombId).remove();
            for (let j = 0; j < currentMap.length; j++) {
                for (let i = 0; i < currentMap[0].length; i++) {
                    if (currentMap[j][i] === 4) {
                        currentMap[j][i] = 0;
                    }
                }
            }
            explosionCells = [];
            mapRef.set(currentMap);
        }, 450);
        
        activeBombs = activeBombs.filter(b => b.id !== bombId);
    }

    function checkPlayerDamageFromExplosion() {
        if (!newPlayer) return;
        
        const playerGridX = newPlayer.gridX;
        const playerGridY = newPlayer.gridY;
        
        let isInExplosion = false;
        for (let cell of explosionCells) {
            if (cell.x === playerGridX && cell.y === playerGridY) {
                isInExplosion = true;
                break;
            }
        }
        
        if (isInExplosion) {
            console.log('Jogador atingido pelo fogo!', playerGridX, playerGridY);
            newPlayer.health -= 1;
            console.log('Vida restante:', newPlayer.health);
            
            if (localPlayerId) {
                playersRef.child(localPlayerId).update({ health: newPlayer.health });
                if (roomState.roomId) {
                    roomsRef.child(roomState.roomId).child('players').child(localPlayerId).update({
                        health: newPlayer.health
                    });
                }
            }
            
            if (newPlayer.health <= 0) {
                newPlayer.health = 0;
                if (localPlayerId) {
                    playersRef.child(localPlayerId).update({ health: 0 });
                    if (roomState.roomId) {
                        roomsRef.child(roomState.roomId).child('players').child(localPlayerId).update({
                            health: 0,
                            isAlive: false,
                            deathTime: Date.now()
                        });
                    }
                }
                checkPlayerDeath(newPlayer);
            }
        }
    }

    // ============ FUNÇÃO leaveRoom ============
    function leaveRoom() {
        if (roomState.roomId) {
            const roomId = roomState.roomId;
            console.log('Saindo da sala:', roomId);
            
            // Remove o jogador da sala
            roomsRef.child(roomId).child('players').child(localPlayerId).remove()
                .then(() => {
                    console.log('Jogador removido da sala');
                })
                .catch((error) => {
                    console.error('Erro ao remover jogador:', error);
                });
            
            roomsRef.child(roomId).child('waitingQueue').child(localPlayerId).remove();
            roomsRef.child(roomId).off();
            
            // Verifica se a sala ficou vazia
            setTimeout(() => {
                checkAndResetRoom(roomId);
            }, 500);
            
            roomState.roomId = null;
            roomState.gameMode = 'waiting';
            roomState.players = {};
            
            const roomUI = document.getElementById('room-ui');
            if (roomUI) roomUI.style.display = 'none';
            
            const deathOverlay = document.getElementById('death-overlay');
            if (deathOverlay) deathOverlay.style.display = 'none';
            
            updateRoomStatus();
            
            // Reseta o jogo para o menu
            if (gameStarted) {
                gameStarted = false;
                mapGenerated = false;
                if (typeof level1 !== 'undefined') {
                    level1.pause();
                }
                menu();
            }
        }
    }

    // ============ FUNÇÃO resetForNextRound ============
    function resetForNextRound(roomId) {
        if (!roomState.isHost) return;
        
        roomsRef.child(roomId).child('players').once('value', (snapshot) => {
            let players = snapshot.val() || {};
            
            // Verifica se ainda tem jogadores
            const playerCount = Object.keys(players).length;
            if (playerCount === 0) {
                console.log('Sala vazia, removendo...');
                checkAndResetRoom(roomId);
                return;
            }
            
            Object.keys(players).forEach(id => {
                if (!players[id].connected) {
                    delete players[id];
                } else {
                    players[id].isAlive = true;
                    players[id].health = 100;
                    players[id].ready = false;
                    players[id].deathTime = null;
                }
            });
            
            const waitingQueueRef = roomsRef.child(roomId).child('waitingQueue');
            waitingQueueRef.once('value', (queueSnapshot) => {
                const waitingPlayers = queueSnapshot.val() || {};
                const waitingIds = Object.keys(waitingPlayers);
                const currentCount = Object.keys(players).length;
                
                waitingIds.forEach((id, index) => {
                    if (currentCount + index < roomState.maxPlayers) {
                        const position = getSpawnPosition(currentCount + index, roomState.maxPlayers);
                        players[id] = {
                            name: waitingPlayers[id].name,
                            ready: true,
                            connected: true,
                            isAlive: true,
                            health: 100,
                            score: 0,
                            joinTime: Date.now(),
                            position: position
                        };
                    }
                });
                
                waitingQueueRef.remove();
                
                // Gera um novo mapa para a próxima rodada
                const baseMaps = [map1, map2];
                const selectedMap = baseMaps[Math.floor(Math.random() * baseMaps.length)];
                const newMap = makeRandMap(selectedMap);
                
                roomsRef.child(roomId).update({
                    players: players,
                    gameState: 'waiting',
                    roundNumber: roomState.roundNumber + 1,
                    winner: null,
                    countdown: 0,
                    currentMap: newMap
                });
                
                // Atualiza o mapa local
                currentMap = newMap;
                mapGenerated = true;
                mapRef.set(newMap);
                
                // Limpa bombas
                clearAllBombs();
                
                roomState.gameMode = 'waiting';
                roomState.playersAlive = Object.keys(players);
                roomState.playersDead = [];
                
                updateRoomUI(null);
                updateRoomStatus();
            });
        });
    }

    // ============ FUNÇÃO listenRoom ============
    function listenRoom(roomId) {
        roomsRef.child(roomId).on('value', (snapshot) => {
            const roomData = snapshot.val();
            if (!roomData) {
                // Sala foi deletada
                console.log('Sala foi deletada!');
                if (roomState.roomId === roomId) {
                    // Reseta o mapa quando a sala é deletada
                    resetGlobalMap();
                    leaveRoom();
                }
                return;
            }
            
            roomState.maxPlayers = roomData.maxPlayers || 4;
            roomState.players = roomData.players || {};
            roomState.gameState = roomData.gameState || 'waiting';
            roomState.roundNumber = roomData.roundNumber || 0;
            roomState.countdown = roomData.countdown || 0;
            
            // Verifica se a sala está vazia
            const playerCount = Object.keys(roomState.players).length;
            if (playerCount === 0 && roomState.roomId) {
                console.log('Sala detectada como vazia!');
                checkAndResetRoom(roomId);
                return;
            }
            
            if (roomData.currentMap && JSON.stringify(roomData.currentMap) !== JSON.stringify(currentMap)) {
                currentMap = roomData.currentMap;
                mapGenerated = true;
            }
            
            if (roomData.gameState === 'countdown' && roomState.gameMode !== 'countdown') {
                roomState.gameMode = 'countdown';
                updateRoomUI(roomData);
            } else if (roomData.gameState === 'playing' && roomState.gameMode !== 'playing') {
                roomState.gameMode = 'playing';
                if (!gameStarted) {
                    startGame();
                }
                updateRoomUI(roomData);
            } else if (roomData.gameState === 'gameover' && roomState.gameMode !== 'gameover') {
                roomState.gameMode = 'gameover';
                handleGameOver(roomData);
            } else {
                updateRoomUI(roomData);
            }
            
            updatePlayersStatus(roomData);
            updateRoomStatus();
        });
    }

    class Player {
        constructor(x, y, color, healthPosition, health, name, img) {
            this.name = name;
            this.healthPosition = healthPosition;
            this.x = x;
            this.y = y;
            this.color = color;
            this.speed = 2;
            this.speedX = 0;
            this.speedY = 0;
            this.size = 30;
            this.gridY = Math.floor((this.y + this.size / 2) / gridHeigth);
            this.gridX = Math.floor((this.x + this.size / 2) / gridWidth);
            this.bombs = 3;
            this.bombPower = 1;
            this.health = health;
            this.right = false;
            this.up = false;
            this.down = false;
            this.left = false;
            this.srcx = 0;
            this.srcy = 0;
            this.width = 16;
            this.height = 24;
            this.img = img || bomberman;
            this.direction = Math.floor(Math.random() * 4);
            this.countAnim = 0;
            this.enemiesKilled = 0;
            this.id = null;
            this.invincible = 0;
            this.prevGridX = this.gridX;
            this.prevGridY = this.gridY;
            this.lastSyncX = this.x;
            this.lastSyncY = this.y;
            this.isAlive = true;
        }

        update() {
            if (!this.isAlive || this.health <= 0) return;
            
            context.fillStyle = this.color;
            this.sprites();
            if (this.img) {
                context.drawImage(this.img, this.srcx, this.srcy, this.width, this.height, this.x, this.y - 20 + offset, this.width * 2.1, this.height * 2.1);
            } else {
                context.fillRect(this.x, this.y - 20 + offset, this.size, this.size);
            }
            
            drawPlayerInfo(this, this.id === localPlayerId);
            
            if (this.invincible > 0) {
                this.invincible -= 1;
                if (this.invincible % 10 < 5) {
                    context.globalAlpha = 0.5;
                    context.drawImage(this.img, this.srcx, this.srcy, this.width, this.height, this.x, this.y - 20 + offset, this.width * 2.1, this.height * 2.1);
                    context.globalAlpha = 1;
                }
            }
        }

        newPos() {
            if (!this.isAlive || this.health <= 0) return;
            
            this.x += this.speedX;
            this.gridX = Math.floor((this.x + this.size / 2) / gridWidth);

            this.y += this.speedY;
            this.gridY = Math.floor((this.y + this.size / 2) / gridHeigth);

            if (currentMap.length === 0) return;

            if (currentMap[this.gridY - 1] && 
                currentMap[this.gridY - 1][this.gridX] !== 0 &&
                currentMap[this.gridY - 1][this.gridX] !== 4 &&
                currentMap[this.gridY - 1][this.gridX] !== 5 &&
                currentMap[this.gridY - 1][this.gridX] !== 6 &&
                currentMap[this.gridY - 1][this.gridX] !== 7 &&
                this.y < this.gridY * gridHeigth) {
                this.y = this.gridY * gridHeigth;
            }
            if (currentMap[this.gridY + 1] && 
                currentMap[this.gridY + 1][this.gridX] !== 0 &&
                currentMap[this.gridY + 1][this.gridX] !== 4 &&
                currentMap[this.gridY + 1][this.gridX] !== 5 &&
                currentMap[this.gridY + 1][this.gridX] !== 6 &&
                currentMap[this.gridY + 1][this.gridX] !== 7 &&
                this.y + this.size > (this.gridY + 1) * gridHeigth) {
                this.y = this.gridY * gridHeigth + gridHeigth - this.size;
            }
            if (currentMap[this.gridY] && 
                currentMap[this.gridY][this.gridX - 1] !== 0 &&
                currentMap[this.gridY][this.gridX - 1] !== 4 &&
                currentMap[this.gridY][this.gridX - 1] !== 5 &&
                currentMap[this.gridY][this.gridX - 1] !== 6 &&
                currentMap[this.gridY][this.gridX - 1] !== 7 &&
                this.x < this.gridX * gridWidth) {
                this.x = this.gridX * gridWidth;
            }
            if (currentMap[this.gridY] && 
                currentMap[this.gridY][this.gridX + 1] !== 0 &&
                currentMap[this.gridY][this.gridX + 1] !== 4 &&
                currentMap[this.gridY][this.gridX + 1] !== 5 &&
                currentMap[this.gridY][this.gridX + 1] !== 6 &&
                currentMap[this.gridY][this.gridX + 1] !== 7 &&
                this.x + this.size > (this.gridX + 1) * gridWidth) {
                this.x = this.gridX * gridWidth + gridWidth - this.size;
            }

            if (currentMap[this.gridY] && currentMap[this.gridY][this.gridX] === 5) {
                this.bombPower += 1;
                currentMap[this.gridY][this.gridX] = 0;
                mapRef.set(currentMap);
            }
            if (currentMap[this.gridY] && currentMap[this.gridY][this.gridX] === 6) {
                this.speed += 1;
                currentMap[this.gridY][this.gridX] = 0;
                mapRef.set(currentMap);
            }
            if (currentMap[this.gridY] && currentMap[this.gridY][this.gridX] === 7) {
                this.bombs += 1;
                currentMap[this.gridY][this.gridX] = 0;
                mapRef.set(currentMap);
            }

            const now = Date.now();
            if (now - lastSyncTime > SYNC_INTERVAL) {
                const dx = Math.abs(this.x - this.lastSyncX);
                const dy = Math.abs(this.y - this.lastSyncY);
                if (dx > 0.5 || dy > 0.5) {
                    if (localPlayerId) {
                        playersRef.child(localPlayerId).update({
                            x: this.x,
                            y: this.y,
                            gridX: this.gridX,
                            gridY: this.gridY
                        });
                        this.lastSyncX = this.x;
                        this.lastSyncY = this.y;
                        lastSyncTime = now;
                    }
                }
            }
        }

        sprites() {
            if (this.down) this.srcy = 0;
            if (this.right) this.srcy = 26;
            if (this.up) this.srcy = 51;
            if (this.left) this.srcy = 76;
            if (this.down || this.right || this.up || this.left) {
                this.countAnim += 1;
                if (this.countAnim > 25) this.countAnim = 0;
                this.srcx = Math.floor(this.countAnim / 5) * (this.width + 1);
            }
        }

        checkDamage(damage = 0) {
            if (this.invincible > 0 || !this.isAlive || this.health <= 0) return;
            
            let isInExplosion = false;
            for (let cell of explosionCells) {
                if (cell.x === this.gridX && cell.y === this.gridY) {
                    isInExplosion = true;
                    break;
                }
            }
            
            if (isInExplosion) {
                this.health -= 1;
                this.invincible = 30;
                console.log('Jogador tomou dano! Vida:', this.health);
                
                if (localPlayerId) {
                    playersRef.child(localPlayerId).update({ health: this.health });
                    if (roomState.roomId) {
                        roomsRef.child(roomState.roomId).child('players').child(localPlayerId).update({
                            health: this.health
                        });
                    }
                }
            }
            
            this.health -= damage;
            if (this.health < 0) {
                this.health = 0;
                if (localPlayerId) {
                    playersRef.child(localPlayerId).update({ health: 0 });
                    if (roomState.roomId) {
                        roomsRef.child(roomState.roomId).child('players').child(localPlayerId).update({
                            health: 0,
                            isAlive: false,
                            deathTime: Date.now()
                        });
                    }
                }
                checkPlayerDeath(this);
            }
            this.health = Math.round(this.health);
        }
    }

    const menu = () => {
        if (!gameStarted) {
            renderMap(mapMenu);
            for (let i = 0; i < mapMenu[0].length; i += 1) {
                if (typeof solidBlock !== 'undefined') {
                    context.drawImage(solidBlock, 50 * i, 0, 50, 50);
                }
            }
            if (typeof superBomberman !== 'undefined') {
                context.drawImage(superBomberman, 100, -50, 500, 500);
            }
            context.font = "26px silkscreenbold";
            context.fillStyle = 'white';
            context.fillText('Press ENTER to join', canvas.width / 2 - 120, canvas.height / 1.55);
            context.fillText('Players online: ' + Object.keys(enemyPlayers).length, canvas.width / 2 - 120, canvas.height / 1.35);
            
            if (roomState.roomId) {
                context.fillStyle = '#fbbf24';
                context.font = "16px silkscreenbold";
                context.fillText(`Sala: ${roomState.roomId}`, canvas.width / 2 - 100, canvas.height / 1.15);
                context.fillText(`Jogadores: ${Object.keys(roomState.players || {}).length}/${roomState.maxPlayers}`, canvas.width / 2 - 120, canvas.height / 1.08);
            }
            
            if (isHost) {
                context.fillStyle = '#4ade80';
                context.fillText('You are the HOST! Press ENTER to start', canvas.width / 2 - 180, canvas.height / 1.25);
            } else if (roomState.roomId) {
                context.fillStyle = '#60a5fa';
                context.fillText('Waiting for host to start...', canvas.width / 2 - 130, canvas.height / 1.25);
            }
            
            requestId2 = window.requestAnimationFrame(menu);
        }
    }

    const startGame = () => {
        console.log('Iniciando jogo...');
        window.cancelAnimationFrame(requestId2);
        
        // Verifica se ainda tem jogadores na sala
        if (roomState.roomId) {
            roomsRef.child(roomState.roomId).child('players').once('value', (snapshot) => {
                const players = snapshot.val() || {};
                const playerCount = Object.keys(players).length;
                
                if (playerCount === 0) {
                    console.log('Sala vazia, não pode iniciar!');
                    checkAndResetRoom(roomState.roomId);
                    return;
                }
                
                proceedWithStart();
            });
        } else {
            proceedWithStart();
        }
    };

    function proceedWithStart() {
        if (typeof startSound !== 'undefined') {
            startSound.play();
        }
        
        if (isHost && !mapGenerated) {
            console.log('Host gerando mapa...');
            const baseMaps = [map1, map2];
            const selectedMap = baseMaps[Math.floor(Math.random() * baseMaps.length)];
            currentMap = makeRandMap(selectedMap);
            mapRef.set(currentMap);
            mapGenerated = true;
            console.log('Mapa gerado e salvo no Firebase');
        } else if (!isHost && !mapGenerated) {
            console.log('Aguardando mapa do host...');
            mapRef.once('value', (snapshot) => {
                const data = snapshot.val();
                if (data && data.length > 0) {
                    currentMap = data;
                    mapGenerated = true;
                    console.log('Mapa recebido do host');
                }
            });
            setTimeout(() => {
                if (!mapGenerated) {
                    console.warn('Mapa não recebido, usando mapa padrão');
                    const baseMaps = [map1, map2];
                    const selectedMap = baseMaps[Math.floor(Math.random() * baseMaps.length)];
                    currentMap = makeRandMap(selectedMap);
                    mapGenerated = true;
                }
            }, 3000);
        }
        
        setTimeout(() => {
            if (typeof level1 !== 'undefined') {
                level1.play();
            }
            updateGameArea();
        }, 500);
    }

    const renderMap = (map) => {
        if (!map || map.length === 0) return;
        
        for (let j = 0; j < map.length; j += 1) {
            for (let i = 0; i < map[0].length; i += 1) {
                if (typeof field !== 'undefined') {
                    context.drawImage(field, i * gridWidth, j * gridHeigth + offset, 50, 50);
                }
                switch (map[j][i]) {
                    case 1:
                        if (typeof solidBlock !== 'undefined') {
                            context.drawImage(solidBlock, i * gridWidth, j * gridHeigth + offset, 50, 50);
                        }
                        break;
                    case 2:
                        if (typeof wall !== 'undefined') {
                            context.drawImage(wall, i * gridWidth, j * gridHeigth + offset, 50, 50);
                        }
                        break;
                    case 3:
                        if (typeof bomb !== 'undefined') {
                            let isPushable = false;
                            Object.keys(pushableBombs).forEach(id => {
                                if (pushableBombs[id].gridX === i && pushableBombs[id].gridY === j && pushableBombs[id].active) {
                                    isPushable = true;
                                }
                            });
                            
                            if (isPushable) {
                                const pulse = Math.sin(Date.now() / 300) * 2;
                                context.drawImage(bomb, 0, 0, 19, 20, i * gridWidth + pulse, j * gridHeigth + offset, 50, 50);
                            } else {
                                context.drawImage(bomb, 0, 0, 19, 20, i * gridWidth, j * gridHeigth + offset, 50, 50);
                            }
                        }
                        break;
                    case 4:
                        if (typeof explosion !== 'undefined') {
                            context.drawImage(explosion, 45, 0, 20, 20, i * gridWidth, j * gridHeigth + offset, 50, 50);
                        }
                        break;
                    case 5:
                        if (typeof items !== 'undefined') {
                            context.drawImage(items, 0, 0, 16, 16, i * gridWidth + 10, j * gridHeigth + offset + 10, 30, 30);
                        }
                        break;
                    case 6:
                        if (typeof items !== 'undefined') {
                            context.drawImage(items, 34, 0, 16, 16, i * gridWidth + 10, j * gridHeigth + offset + 10, 30, 30);
                        }
                        break;
                    case 7:
                        if (typeof items !== 'undefined') {
                            context.drawImage(items, 18, 0, 16, 16, i * gridWidth + 10, j * gridHeigth + offset + 10, 30, 30);
                        }
                        break;
                }
            }
        }
    }

    const clear = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    const statusBar = () => {
        if (typeof cleanStatusBar !== 'undefined') {
            context.drawImage(cleanStatusBar, 50, 0, 650, 50);
        }
        if (typeof solidBlock !== 'undefined') {
            context.drawImage(solidBlock, 0, 0, 50, 50);
            context.drawImage(solidBlock, 700, 0, 50, 50);
        }
        
        context.font = "16px silkscreenbold";
        context.fillStyle = 'white';
        
        if (newPlayer && newPlayer.isAlive) {
            context.fillText(`❤️ ${newPlayer.health}`, 135, 33);
            context.fillText(`💣 ${newPlayer.bombPower}`, 230, 40);
            context.fillText(`⚡ ${newPlayer.speed - 1}`, 275, 40);
            context.fillText(`🧨 ${newPlayer.bombs}`, 320, 40);
        }
        
        let i = 0;
        Object.keys(enemyPlayers).forEach(id => {
            const player = enemyPlayers[id];
            const xPos = 400 + (i * 60);
            context.fillText(`❤️ ${player.health || 100}`, xPos + 55, 33);
            i++;
        });
    }

    const gameOver = (player) => {
        console.log('Game Over!');
        if (typeof level1 !== 'undefined') {
            level1.pause();
        }
        
        setTimeout(() => {
            window.cancelAnimationFrame(requestId);
            clear();
            for (let i = 0; i < mapMenu[0].length; i += 1) {
                if (typeof solidBlock !== 'undefined') {
                    context.drawImage(solidBlock, 50 * i, 0, 50, 50);
                }
            }
            renderMap(mapMenu);
            
            context.font = "26px silkscreenbold";
            context.fillStyle = 'white';
            if (player.id === localPlayerId) {
                context.fillText(`GAME OVER!`, 280, canvas.height / 2 - 50);
                context.fillText(`YOUR FINAL SCORE IS ${newPlayer.enemiesKilled}`, 155, canvas.height / 2);
                context.fillText(`PRESS ENTER TO PLAY AGAIN`, 120, 350);
            } else {
                context.fillText(`${player.name} WON!`, 230, canvas.height / 2 - 50);
                context.fillText(`PRESS ENTER TO PLAY AGAIN`, 120, 350);
            }
            
            gameStarted = false;
            mapGenerated = false;
            gameStateRef.update({ started: false });
        }, 500);
    }

    function interpolateEnemyPlayers() {
        const now = Date.now();
        Object.keys(enemyPlayers).forEach(id => {
            const player = enemyPlayers[id];
            const timeSinceUpdate = now - player.lastUpdate;
            if (timeSinceUpdate < 100) {
                const lerpFactor = Math.min(1, timeSinceUpdate / 100);
                player.currentX = player.currentX + (player.targetX - player.currentX) * lerpFactor * 0.5;
                player.currentY = player.currentY + (player.targetY - player.currentY) * lerpFactor * 0.5;
            } else {
                player.currentX = player.targetX;
                player.currentY = player.targetY;
            }
        });
    }

    const updateGameArea = () => {
        frameCount += 1;
        clear();
        
        interpolateEnemyPlayers();
        
        if (currentMap.length > 0) {
            renderMap(currentMap);
        }
        statusBar();
        
        if (newPlayer && newPlayer.isAlive) {
            newPlayer.newPos();
            newPlayer.update();
            newPlayer.checkDamage(0);
        }
        
        Object.keys(enemyPlayers).forEach(id => {
            const data = enemyPlayers[id];
            if (!enemyPlayerObjects[id]) {
                enemyPlayerObjects[id] = new Player(
                    data.currentX || data.x || 60,
                    data.currentY || data.y || 60,
                    'black',
                    100,
                    data.health || 100,
                    data.name || 'Player',
                    bomberman2
                );
                enemyPlayerObjects[id].id = id;
            }
            const enemy = enemyPlayerObjects[id];
            enemy.x = data.currentX || data.x || 60;
            enemy.y = data.currentY || data.y || 60;
            enemy.health = data.health || 100;
            enemy.name = data.name || 'Player';
            enemy.left = data.left || false;
            enemy.right = data.right || false;
            enemy.up = data.up || false;
            enemy.down = data.down || false;
            
            if (enemy.health > 0) {
                enemy.update();
            }
        });
        
        requestId = window.requestAnimationFrame(updateGameArea);
    }

    function makeRandMap(map) {
        const newMap = map.map(row => [...row]);
        for (let j = 0; j < newMap.length; j += 1) {
            for (let i = 0; i < newMap[0].length; i += 1) {
                if (newMap[j][i] === 0 && Math.random() > 0.70) {
                    newMap[j][i] = 2;
                }
            }
        }
        newMap[1][1] = 0;
        newMap[1][2] = 0;
        newMap[2][1] = 0;
        newMap[9][13] = 0;
        newMap[8][13] = 0;
        newMap[9][12] = 0;
        return newMap;
    }

    document.onkeydown = function (e) {
        if (e.keyCode === 32) {
            e.preventDefault();
        }
        
        if (!newPlayer || !newPlayer.isAlive) return;
        
        switch (e.keyCode) {
            case 32:
                e.preventDefault();
                if (!bombCooldown && newPlayer.bombs > 0 && currentMap[newPlayer.gridY] && currentMap[newPlayer.gridY][newPlayer.gridX] === 0) {
                    console.log('Colocando bomba!');
                    bombCooldown = true;
                    
                    placeBombOnline(newPlayer.gridX, newPlayer.gridY, newPlayer.bombPower);
                    newPlayer.bombs -= 1;
                    
                    if (typeof placeBombSound !== 'undefined') {
                        placeBombSound.play();
                    }
                    
                    setTimeout(() => {
                        bombCooldown = false;
                        newPlayer.bombs += 1;
                        console.log('Bomba recarregada!');
                    }, 300);
                }
                break;
            case 37:
                e.preventDefault();
                newPlayer.speedX = newPlayer.speed * -1;
                newPlayer.left = true;
                newPlayer.right = false;
                newPlayer.up = false;
                newPlayer.down = false;
                syncPlayerDirection();
                handleDoubleTap('left');
                break;
            case 38:
                e.preventDefault();
                newPlayer.speedY = newPlayer.speed * -1;
                newPlayer.left = false;
                newPlayer.right = false;
                newPlayer.up = true;
                newPlayer.down = false;
                syncPlayerDirection();
                handleDoubleTap('up');
                break;
            case 39:
                e.preventDefault();
                newPlayer.speedX = newPlayer.speed;
                newPlayer.left = false;
                newPlayer.right = true;
                newPlayer.up = false;
                newPlayer.down = false;
                syncPlayerDirection();
                handleDoubleTap('right');
                break;
            case 40:
                e.preventDefault();
                newPlayer.speedY = newPlayer.speed;
                newPlayer.left = false;
                newPlayer.right = false;
                newPlayer.up = false;
                newPlayer.down = true;
                syncPlayerDirection();
                handleDoubleTap('down');
                break;
            case 13:
                e.preventDefault();
                if (!gameStarted && isHost) {
                    gameStateRef.once('value', (snapshot) => {
                        const state = snapshot.val();
                        if (!state || !state.started) {
                            console.log('Host iniciando jogo...');
                            gameStateRef.update({ started: true });
                            startGame();
                        }
                    });
                } else if (gameStarted) {
                    window.location.reload();
                }
                break;
        }
    }

    document.onkeyup = function (e) {
        if (!newPlayer) return;
        
        switch (e.keyCode) {
            case 37:
                newPlayer.speedX = 0;
                newPlayer.left = false;
                syncPlayerDirection();
                break;
            case 38:
                newPlayer.speedY = 0;
                newPlayer.up = false;
                syncPlayerDirection();
                break;
            case 39:
                newPlayer.speedX = 0;
                newPlayer.right = false;
                syncPlayerDirection();
                break;
            case 40:
                newPlayer.speedY = 0;
                newPlayer.down = false;
                syncPlayerDirection();
                break;
        }
    }

    console.log('Inicializando jogo...');
    
    playerName = prompt('Digite seu nome:', 'Player') || 'Player';
    console.log('Nome do jogador:', playerName);
    
    newPlayer = new Player(60, 60, 'white', 135, 100, playerName, bomberman);
    newPlayer.id = localPlayerId;
    console.log('Jogador criado:', newPlayer);
    
    registerPlayer(playerName);
    
    console.log('Iniciando listeners...');
    listenPlayers();
    listenGameState();
    listenMap();
    listenBombs();
    listenPushableBombs();
    
    bombsRef.once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                bombsRef.child(key).remove();
                console.log('Bomba antiga removida do Firebase:', key);
            });
        }
    });
    
    mapRef.once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            currentMap = data;
            mapGenerated = true;
            console.log('Mapa carregado do Firebase');
        }
    });
    
    console.log('Iniciando menu...');
    if (typeof title !== 'undefined') {
        title.play();
    }
    menu();
    
    // ============ INICIA O MONITORAMENTO DE SALAS VAZIAS ============
    startRoomMonitor();
    
    window.addEventListener('beforeunload', () => {
        if (localPlayerId) {
            playersRef.child(localPlayerId).update({ connected: false });
        }
    });
    
    console.log('Jogo inicializado com sucesso!');
};