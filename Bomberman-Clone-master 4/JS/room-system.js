const ROOM_CONFIG = {
    MAX_PLAYERS: 4,
    MIN_PLAYERS: 2,
    COUNTDOWN_TIME: 15,
    WAITING_TIME: 15,
    ROUND_DELAY: 5
};

let roomState = {
    roomId: null,
    players: {},
    maxPlayers: 4,
    isHost: false,
    gameMode: 'waiting',
    countdown: 0,
    roundNumber: 0,
    playersAlive: [],
    playersDead: [],
    currentMap: null,
    gameStartTime: null
};

let playerName = 'Player';

function createRoom(roomName = 'Sala do Bomberman') {
    roomState.roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const maxPlayersInput = prompt('Quantos jogadores na sala? (2-4)', '4');
    const maxPlayers = parseInt(maxPlayersInput) || 4;
    roomState.maxPlayers = Math.min(Math.max(maxPlayers, 2), 4);
    roomState.isHost = true;
    
    const roomData = {
        name: roomName,
        host: localPlayerId,
        maxPlayers: roomState.maxPlayers,
        players: {
            [localPlayerId]: {
                name: playerName,
                ready: true,
                connected: true,
                isAlive: true,
                score: 0,
                health: 100,
                joinTime: Date.now(),
                position: { x: 70, y: 70 }
            }
        },
        gameState: 'waiting',
        createdAt: Date.now(),
        roundNumber: 0,
        countdown: 0,
        waitingQueue: {}
    };
    
    roomsRef.child(roomState.roomId).set(roomData);
    console.log('Sala criada:', roomState.roomId);
    
    listenRoom(roomState.roomId);
    showRoomUI();
    updateRoomStatus();
    
    return roomState.roomId;
}

function joinRoom(roomId) {
    roomState.roomId = roomId;
    
    roomsRef.child(roomId).once('value', (snapshot) => {
        const roomData = snapshot.val();
        if (!roomData) {
            alert('Sala não encontrada!');
            return;
        }
        
        const playerCount = Object.keys(roomData.players || {}).length;
        if (playerCount >= roomData.maxPlayers) {
            alert('Sala está cheia!');
            return;
        }
        
        if (roomData.gameState === 'playing' || roomData.gameState === 'gameover') {
            alert('A partida já começou! Aguarde a próxima.');
            addToWaitingQueue(roomId);
            return;
        }
        
        const playerData = {
            name: playerName,
            ready: true,
            connected: true,
            isAlive: true,
            score: 0,
            health: 100,
            joinTime: Date.now(),
            position: { x: 70, y: 70 }
        };
        
        roomsRef.child(roomId).child('players').child(localPlayerId).set(playerData);
        roomState.isHost = false;
        
        listenRoom(roomId);
        showRoomUI();
        updateRoomStatus();
        
        console.log('Entrou na sala:', roomId);
    });
}

function addToWaitingQueue(roomId) {
    const queueRef = roomsRef.child(roomId).child('waitingQueue');
    queueRef.child(localPlayerId).set({
        name: playerName,
        joinTime: Date.now()
    });
    console.log('Adicionado à fila de espera');
}

function listenRoom(roomId) {
    roomsRef.child(roomId).on('value', (snapshot) => {
        const roomData = snapshot.val();
        if (!roomData) return;
        
        roomState.maxPlayers = roomData.maxPlayers || 4;
        roomState.players = roomData.players || {};
        roomState.gameState = roomData.gameState || 'waiting';
        roomState.roundNumber = roomData.roundNumber || 0;
        roomState.countdown = roomData.countdown || 0;
        
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

function updatePlayersStatus(roomData) {
    const players = roomData.players || {};
    roomState.playersAlive = [];
    roomState.playersDead = [];
    
    Object.keys(players).forEach(id => {
        if (players[id].isAlive && players[id].connected) {
            roomState.playersAlive.push(id);
        } else if (!players[id].isAlive) {
            roomState.playersDead.push(id);
        }
    });
    
    if (roomData.gameState === 'playing' && roomState.playersAlive.length <= 1 && roomState.isHost) {
        const winnerId = roomState.playersAlive[0];
        if (winnerId) {
            finishRound(roomState.roomId, winnerId);
        }
    }
}

function startCountdown(roomId) {
    if (!roomState.isHost) return;
    
    roomState.gameMode = 'countdown';
    roomState.countdown = ROOM_CONFIG.COUNTDOWN_TIME;
    
    roomsRef.child(roomId).update({
        gameState: 'countdown',
        countdown: ROOM_CONFIG.COUNTDOWN_TIME
    });
    
    const countdownInterval = setInterval(() => {
        roomState.countdown--;
        roomsRef.child(roomId).update({ countdown: roomState.countdown });
        updateRoomUI(null);
        
        if (roomState.countdown <= 3 && roomState.countdown > 0) {
            if (typeof startSound !== 'undefined') {
                startSound.play();
            }
        }
        
        if (roomState.countdown <= 0) {
            clearInterval(countdownInterval);
            roomsRef.child(roomId).update({
                gameState: 'playing',
                startTime: Date.now()
            });
            prepareGame(roomId);
        }
    }, 1000);
}

function prepareGame(roomId) {
    roomsRef.child(roomId).child('players').once('value', (snapshot) => {
        const players = snapshot.val() || {};
        const playerIds = Object.keys(players);
        const totalPlayers = playerIds.length;
        
        playerIds.forEach((id, index) => {
            const position = getSpawnPosition(index, totalPlayers);
            players[id].isAlive = true;
            players[id].health = 100;
            players[id].position = position;
            players[id].ready = false;
        });
        
        roomsRef.child(roomId).update({ players });
        
        if (roomState.isHost) {
            const newMap = generateRandomMap();
            roomsRef.child(roomId).update({ currentMap: newMap });
        }
        
        if (newPlayer) {
            const pos = getSpawnPosition(0, totalPlayers);
            newPlayer.x = pos.x;
            newPlayer.y = pos.y;
            newPlayer.health = 100;
            newPlayer.gridX = Math.floor(pos.x / gridWidth);
            newPlayer.gridY = Math.floor(pos.y / gridHeigth);
        }
    });
}

function getSpawnPosition(index, totalPlayers) {
    const positions = [
        { x: 70, y: 70 },
        { x: 650, y: 70 },
        { x: 70, y: 470 },
        { x: 650, y: 470 }
    ];
    return positions[index % positions.length];
}

function generateRandomMap() {
    const baseMaps = [map1, map2];
    const selectedMap = baseMaps[Math.floor(Math.random() * baseMaps.length)];
    return makeRandMap(selectedMap);
}

function finishRound(roomId, winnerId) {
    if (!roomState.isHost) return;
    
    roomsRef.child(roomId).child('players').child(winnerId).update({
        score: firebase.database.ServerValue.increment(1)
    });
    
    roomsRef.child(roomId).update({
        gameState: 'gameover',
        winner: winnerId,
        endTime: Date.now()
    });
    
    roomsRef.child(roomId).child('players').child(winnerId).once('value', (snapshot) => {
        const winner = snapshot.val();
        if (winner) {
            showWinnerMessage(winner.name);
        }
    });
    
    setTimeout(() => {
        resetForNextRound(roomId);
    }, ROOM_CONFIG.ROUND_DELAY * 1000);
}

function resetForNextRound(roomId) {
    if (!roomState.isHost) return;
    
    roomsRef.child(roomId).child('players').once('value', (snapshot) => {
        let players = snapshot.val() || {};
        
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
            
            roomsRef.child(roomId).update({
                players: players,
                gameState: 'waiting',
                roundNumber: roomState.roundNumber + 1,
                winner: null,
                countdown: 0
            });
            
            roomState.gameMode = 'waiting';
            roomState.playersAlive = Object.keys(players);
            roomState.playersDead = [];
            
            updateRoomUI(null);
            updateRoomStatus();
        });
    });
}

function handleGameOver(roomData) {
    const players = roomData.players || {};
    let winner = null;
    let winnerName = 'Ninguém';
    
    if (roomData.winner && players[roomData.winner]) {
        winner = roomData.winner;
        winnerName = players[winner].name;
    } else {
        const alivePlayers = Object.keys(players).filter(id => players[id].isAlive);
        if (alivePlayers.length === 1) {
            winner = alivePlayers[0];
            winnerName = players[winner].name;
        }
    }
    
    showWinnerMessage(winnerName);
}

function showRoomUI() {
    let roomUI = document.getElementById('room-ui');
    if (!roomUI) {
        roomUI = document.createElement('div');
        roomUI.id = 'room-ui';
        document.body.appendChild(roomUI);
    }
    roomUI.style.display = 'flex';
}

function updateRoomUI(roomData) {
    const roomUI = document.getElementById('room-ui');
    if (!roomUI || !roomState.roomId) return;
    
    const data = roomData || {};
    const players = data.players || roomState.players || {};
    const gameState = data.gameState || roomState.gameState || 'waiting';
    const maxPlayers = data.maxPlayers || roomState.maxPlayers || 4;
    const countdown = data.countdown || roomState.countdown || 0;
    
    let html = `
        <div class="room-container">
            <h2 class="room-title">🎮 ${data.name || 'Sala do Bomberman'}</h2>
            <div class="room-code">Código: <span>${roomState.roomId}</span></div>
            <div class="round-info">Rodada: ${(data.roundNumber || roomState.roundNumber || 0) + 1}</div>
            
            <div class="player-list">
    `;
    
    Object.keys(players).forEach(id => {
        const player = players[id];
        const isAlive = player.isAlive !== false;
        const isCurrentPlayer = id === localPlayerId;
        const isHost = id === data.host;
        
        html += `
            <div class="player-item ${isCurrentPlayer ? 'local' : ''} ${isAlive ? 'alive' : 'dead'}">
                <div class="player-name">
                    ${isAlive ? '🟢' : '💀'} ${player.name || 'Player'}
                    ${isCurrentPlayer ? ' (Você)' : ''}
                    ${isHost ? ' 👑' : ''}
                </div>
                <div class="player-score">
                    ${player.score || 0} pts | ❤️ ${player.health || 0}
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    
    if (data.waitingQueue) {
        const waiting = Object.keys(data.waitingQueue);
        if (waiting.length > 0) {
            html += `
                <div class="waiting-queue">
                    ⏳ Na fila: ${waiting.map(id => data.waitingQueue[id].name).join(', ')}
                </div>
            `;
        }
    }
    
    html += `<div class="status-box">`;
    
    if (gameState === 'waiting') {
        const playerCount = Object.keys(players).length;
        html += `
            <div class="status-waiting">⏳ Aguardando jogadores... (${playerCount}/${maxPlayers})</div>
            ${roomState.isHost ? `
                <button class="btn-start" onclick="startGameRoom()">Iniciar Partida</button>
            ` : `
                <div style="color: #fbbf24; font-size: 12px; margin-top: 10px;">Aguardando o host iniciar...</div>
            `}
        `;
    } else if (gameState === 'countdown') {
        html += `
            <div class="status-countdown countdown-number" style="font-size: 48px;">${countdown}</div>
            <div style="color: #fff; font-size: 14px;">Preparando...</div>
        `;
    } else if (gameState === 'playing') {
        const alive = Object.keys(players).filter(id => players[id].isAlive).length;
        html += `
            <div class="status-playing" style="font-size: 20px;">⚔️ Em Andamento!</div>
            <div style="color: #fff; font-size: 14px;">Jogadores vivos: ${alive}</div>
        `;
    } else if (gameState === 'gameover') {
        html += `
            <div class="status-gameover" style="font-size: 20px;">🏆 Fim de Partida!</div>
            <div style="color: #fbbf24; font-size: 14px; margin-top: 10px;">
                Próxima rodada em ${ROOM_CONFIG.ROUND_DELAY} segundos...
            </div>
        `;
    }
    
    html += `</div>`;
    
    html += `
        <button class="btn-leave" onclick="leaveRoom()">Sair da Sala</button>
        </div>
    `;
    
    roomUI.innerHTML = html;
}

function startGameRoom() {
    if (!roomState.isHost) {
        alert('Apenas o host pode iniciar a partida!');
        return;
    }
    
    const players = roomState.players || {};
    const playerCount = Object.keys(players).length;
    
    if (playerCount < ROOM_CONFIG.MIN_PLAYERS) {
        alert(`São necessários ${ROOM_CONFIG.MIN_PLAYERS} jogadores para iniciar!`);
        return;
    }
    
    if (playerCount > roomState.maxPlayers) {
        alert(`Máximo de ${roomState.maxPlayers} jogadores!`);
        return;
    }
    
    startCountdown(roomState.roomId);
}

function leaveRoom() {
    if (roomState.roomId) {
        roomsRef.child(roomState.roomId).child('players').child(localPlayerId).remove();
        roomsRef.child(roomState.roomId).child('waitingQueue').child(localPlayerId).remove();
        roomsRef.child(roomState.roomId).off();
        
        roomState.roomId = null;
        roomState.gameMode = 'waiting';
        
        const roomUI = document.getElementById('room-ui');
        if (roomUI) roomUI.style.display = 'none';
        
        const deathOverlay = document.getElementById('death-overlay');
        if (deathOverlay) deathOverlay.style.display = 'none';
        
        updateRoomStatus();
    }
}

function updateRoomStatus() {
    const statusEl = document.getElementById('room-status');
    if (statusEl) {
        if (roomState.roomId) {
            const playerCount = Object.keys(roomState.players || {}).length;
            statusEl.textContent = `Sala: ${roomState.roomId} (${playerCount}/${roomState.maxPlayers}) - ${roomState.gameState}`;
        } else {
            statusEl.textContent = 'Sala: Nenhuma';
        }
    }
}

function drawPlayerInfo(player, isLocal = false) {
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');
    
    if (!player || player.health <= 0) return;
    
    // ========== POSIÇÕES AJUSTADAS ==========
    // O nome e a vida ficam MAIS ACIMA da cabeça do jogador
    const offsetY = 15; // Distância total da base do jogador
    
    // Nome do jogador (mais acima)
    context.font = "10px 'Press Start 2P', monospace";
    context.textAlign = 'center';
    context.fillStyle = isLocal ? '#4ade80' : '#60a5fa';
    context.fillText(player.name || 'Player', player.x + 25, player.y - offsetY + 10);
    
    // Barra de vida (abaixo do nome)
    const hpBarWidth = 40;
    const hpBarHeight = 5;
    const hpX = player.x + 5;
    const hpY = player.y - offsetY + 20;
    
    // Fundo da barra com sombra
    context.fillStyle = 'rgba(0,0,0,0.8)';
    context.fillRect(hpX - 1, hpY - 1, hpBarWidth + 2, hpBarHeight + 2);
    context.fillStyle = 'rgba(30,30,30,0.9)';
    context.fillRect(hpX, hpY, hpBarWidth, hpBarHeight);
    
    // Vida atual
    const healthPercent = Math.max(0, Math.min(1, (player.health || 0) / 100));
    const hpColor = healthPercent > 0.5 ? '#4ade80' : healthPercent > 0.25 ? '#fbbf24' : '#ef4444';
    context.fillStyle = hpColor;
    context.fillRect(hpX + 1, hpY + 1, (hpBarWidth - 2) * healthPercent, hpBarHeight - 2);
    
    // Texto da porcentagem de vida
    context.font = "8px 'Press Start 2P', monospace";
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.fillText(`${Math.round(player.health || 0)}%`, player.x + 25, hpY + 14);
}

function checkPlayerDeath(player) {
    if (!player || player.health > 0) return;
    
    console.log('Jogador morreu:', player.name);
    
    if (roomState.roomId && player.id) {
        roomsRef.child(roomState.roomId).child('players').child(player.id).update({
            isAlive: false,
            deathTime: Date.now()
        });
        
        if (player.id !== localPlayerId) {
            addToWaitingQueue(roomState.roomId);
        }
    }
    
    if (player.id !== localPlayerId) {
        delete enemyPlayers[player.id];
        delete enemyPlayerObjects[player.id];
    }
    
    if (player.id === localPlayerId) {
        showDeathScreen();
    }
}

function showDeathScreen() {
    const overlay = document.getElementById('death-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <h1>💀 MORREU!</h1>
        <p>Aguardando próxima rodada...</p>
        <div class="waiting-text">⏳ ${ROOM_CONFIG.ROUND_DELAY} segundos</div>
    `;
    
    setTimeout(() => {
        overlay.style.display = 'none';
    }, ROOM_CONFIG.ROUND_DELAY * 1000);
}

function showWinnerMessage(winnerName) {
    const overlay = document.getElementById('death-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <h1 style="color: #fbbf24;">🏆 VENCEDOR!</h1>
        <p style="color: #4ade80; font-size: 32px;">${winnerName || '???'}</p>
        <div class="waiting-text">Próxima rodada em ${ROOM_CONFIG.ROUND_DELAY} segundos...</div>
    `;
    
    setTimeout(() => {
        overlay.style.display = 'none';
    }, ROOM_CONFIG.ROUND_DELAY * 1000);
}

document.addEventListener('keydown', function(e) {
    if (!gameStarted && !roomState.roomId) {
        if (e.key === '1') {
            createRoom();
        } else if (e.key === '2') {
            const roomId = prompt('Digite o código da sala:');
            if (roomId) {
                joinRoom(roomId);
            }
        }
    } else if (e.key === 'Escape' && roomState.roomId) {
        leaveRoom();
    }
});

function initRoomSystem() {
    console.log('Sistema de salas inicializado!');
    
    setInterval(() => {
        if (roomState.roomId && roomState.gameState === 'playing' && roomState.isHost) {
            const aliveCount = Object.keys(roomState.players || {}).filter(id => 
                roomState.players[id] && roomState.players[id].isAlive
            ).length;
            
            if (aliveCount <= 1) {
                const winnerId = Object.keys(roomState.players || {}).find(id => 
                    roomState.players[id] && roomState.players[id].isAlive
                );
                if (winnerId) {
                    finishRound(roomState.roomId, winnerId);
                }
            }
        }
    }, 1000);
    
    setInterval(() => {
        if (roomState.roomId && newPlayer && roomState.gameState === 'playing') {
            roomsRef.child(roomState.roomId).child('players').child(localPlayerId).update({
                position: {
                    x: newPlayer.x,
                    y: newPlayer.y,
                    gridX: newPlayer.gridX,
                    gridY: newPlayer.gridY
                },
                health: newPlayer.health
                
            });
        }
    }, 100);
}

if (typeof firebase !== 'undefined') {
    initRoomSystem();
}

