console.log('Script iniciado!');

window.onload = () => {
    console.log('Window loaded!');
    
    // Verifica se o Firebase está disponível
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
    
    // Elementos do DOM
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
    let enemyPlayerObjects = {}; // instâncias Player persistentes dos inimigos (mantém animação)
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
    const SYNC_INTERVAL = 50; // Sincroniza a cada 50ms para movimento suave

    const gridWidth = canvas.width / 15;
    const gridHeigth = 550 / 11;
    const offset = 50;




    // ============ FUNÇÕES FIREBASE ============

    function generatePlayerId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    }

    function registerPlayer(playerName = 'Player') {
        localPlayerId = generatePlayerId();
        console.log('Registrando jogador:', localPlayerId);
        
        // VERIFICA SE É O PRIMEIRO JOGADOR (HOST)
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
                        // Atualiza ou cria jogador inimigo com interpolação suave
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
                            // Atualiza posição alvo para interpolação
                            enemyPlayers[id].targetX = data[id].x || enemyPlayers[id].x;
                            enemyPlayers[id].targetY = data[id].y || enemyPlayers[id].y;
                            enemyPlayers[id].lastUpdate = Date.now();
                            // Atualiza outros atributos
                            enemyPlayers[id].health = data[id].health || 100;
                            enemyPlayers[id].name = data[id].name || 'Player';
                            enemyPlayers[id].gridX = data[id].gridX;
                            enemyPlayers[id].gridY = data[id].gridY;
                            // Atualiza a direção real do jogador remoto (mesma lógica do jogador local)
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
                
                // Remove jogadores desconectados
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
            
            // Se não há dados ou mapa não carregado, retorna
            if (!data || currentMap.length === 0) return;
            
            // Limpa bombas antigas do mapa (valores 3 e 4)
            for (let j = 0; j < currentMap.length; j++) {
                for (let i = 0; i < currentMap[0].length; i++) {
                    if (currentMap[j][i] === 3 || currentMap[j][i] === 4) {
                        currentMap[j][i] = 0;
                    }
                }
            }
            
            // Renderiza novas bombas/explosões
            Object.keys(data).forEach(key => {
                const bomb = data[key];
                // Verifica se a bomba é recente (menos de 10 segundos)
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
                    // Remove bombas antigas do Firebase
                    bombsRef.child(key).remove();
                    console.log('Bomba antiga removida:', key);
                }
            });
        });
    }

    function syncPlayerDirection() {
        // Envia a direção (left/right/up/down) do jogador local assim que ela muda,
        // sem esperar o throttle de posição — é isso que faz o outro lado "ver" a
        // mesma animação de andar em tempo real.
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

    // ============ FUNÇÃO DE BOMBA ============

    function placeBombOnline(gridX, gridY, bombPower) {
        const bombId = 'bomb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        const bombData = {
            x: gridX * gridWidth,
            y: gridY * gridHeigth + offset,
            gridX: gridX,
            gridY: gridY,
            power: bombPower,
            active: true,
            isExplosion: false,
            timestamp: Date.now()
        };

        bombsRef.child(bombId).set(bombData);
        
        if (currentMap[gridY] && currentMap[gridY][gridX] === 0) {
            currentMap[gridY][gridX] = 3;
        }
        
        activeBombs.push({
            id: bombId,
            gridX: gridX,
            gridY: gridY,
            power: bombPower,
            timer: setTimeout(() => {
                explodeBomb(bombId, gridX, gridY, bombPower);
            }, 2300)
        });

        console.log('Bomba colocada em:', gridX, gridY);
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

    // ============ FUNÇÃO PARA VERIFICAR DANO DO FOGO ============
    
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
            }
            
            if (newPlayer.health <= 0) {
                newPlayer.health = 0;
                if (localPlayerId) {
                    playersRef.child(localPlayerId).update({ health: 0 });
                }
                gameOver(newPlayer);
            }
        }
    }

    // ============ CLASS PLAYER ============

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
            this.bombs = 1;
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
        }

        update() {
            context.fillStyle = this.color;
            this.sprites();
            if (this.img) {
                context.drawImage(this.img, this.srcx, this.srcy, this.width, this.height, this.x, this.y - 20 + offset, this.width * 2.1, this.height * 2.1);
            } else {
                context.fillRect(this.x, this.y - 20 + offset, this.size, this.size);
            }
            
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

            // Sincroniza posição com Firebase em intervalos regulares
            const now = Date.now();
            if (now - lastSyncTime > SYNC_INTERVAL) {
                // Verifica se houve movimento significativo
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
            if (this.invincible > 0) return;
            
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
                }
            }
            
            this.health -= damage;
            if (this.health < 0) {
                this.health = 0;
                if (localPlayerId) {
                    playersRef.child(localPlayerId).update({ health: 0 });
                }
                gameOver(this);
            }
            this.health = Math.round(this.health);
        }

        randomMove() {
            // Mantido apenas para compatibilidade
        }
    }

    // ============ FUNÇÕES DO JOGO ============

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
            if (isHost) {
                context.fillText('You are the HOST! Press ENTER to start', canvas.width / 2 - 180, canvas.height / 1.25);
            } else {
                context.fillText('Waiting for host to start...', canvas.width / 2 - 130, canvas.height / 1.25);
            }
            
            requestId2 = window.requestAnimationFrame(menu);
        }
    }

    const startGame = () => {
        console.log('Iniciando jogo...');
        window.cancelAnimationFrame(requestId2);
        
        if (typeof startSound !== 'undefined') {
            startSound.play();
        }
        
        // SÓ GERA O MAPA SE FOR O HOST E O MAPA AINDA NÃO FOI GERADO
        if (isHost && !mapGenerated) {
            console.log('Host gerando mapa...');
            switch (Math.floor(Math.random() * 2)) {
                case 0:
                    currentMap = makeRandMap(map1);
                    break;
                case 1:
                    currentMap = makeRandMap(map2);
                    break;
            }
            mapRef.set(currentMap);
            mapGenerated = true;
            console.log('Mapa gerado e salvo no Firebase');
        } else if (!isHost && !mapGenerated) {
            // SE NÃO É HOST, ESPERA O MAPA CARREGAR
            console.log('Aguardando mapa do host...');
            mapRef.once('value', (snapshot) => {
                const data = snapshot.val();
                if (data && data.length > 0) {
                    currentMap = data;
                    mapGenerated = true;
                    console.log('Mapa recebido do host');
                }
            });
            // ESPERA ATÉ 3 SEGUNDOS PELO MAPA
            setTimeout(() => {
                if (!mapGenerated) {
                    console.warn('Mapa não recebido, usando mapa padrão');
                    currentMap = map1;
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
                            context.drawImage(bomb, 0, 0, 19, 20, i * gridWidth, j * gridHeigth + offset, 50, 50);
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
        
        if (newPlayer) {
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

    // Função para interpolação suave dos jogadores inimigos
    function interpolateEnemyPlayers() {
        const now = Date.now();
        Object.keys(enemyPlayers).forEach(id => {
            const player = enemyPlayers[id];
            // Interpolação linear para movimento suave
            const timeSinceUpdate = now - player.lastUpdate;
            if (timeSinceUpdate < 100) { // Atualiza apenas se for recente
                const lerpFactor = Math.min(1, timeSinceUpdate / 100);
                player.currentX = player.currentX + (player.targetX - player.currentX) * lerpFactor * 0.5;
                player.currentY = player.currentY + (player.targetY - player.currentY) * lerpFactor * 0.5;
            } else {
                // Se estiver parado, vai direto para o alvo
                player.currentX = player.targetX;
                player.currentY = player.targetY;
            }
        });
    }

    const updateGameArea = () => {
        frameCount += 1;
        clear();
        
        // Interpolação suave dos inimigos
        interpolateEnemyPlayers();
        
        if (currentMap.length > 0) {
            renderMap(currentMap);
        }
        statusBar();
        
        if (newPlayer) {
            newPlayer.newPos();
            newPlayer.update();
            newPlayer.checkDamage(0);
        }
        
        // Renderiza jogadores inimigos com posição interpolada.
        // Reaproveita a MESMA instância Player entre frames (igual ao newPlayer),
        // senão a animação de andar nunca acumula frames e ele fica "parado".
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
            }

            const enemy = enemyPlayerObjects[id];
            enemy.x = data.currentX || data.x || 60;
            enemy.y = data.currentY || data.y || 60;
            enemy.health = data.health || 100;
            enemy.name = data.name || 'Player';

            // Usa a direção real que o outro jogador está usando (não inventada),
            // exatamente como o sprites() do jogador local já faz.
            enemy.left = data.left || false;
            enemy.right = data.right || false;
            enemy.up = data.up || false;
            enemy.down = data.down || false;

            enemy.update();
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

    // ============ EVENT LISTENERS ============

    document.onkeydown = function (e) {
        if (e.keyCode === 32) {
            e.preventDefault();
        }
        
        if (!newPlayer) return;
        
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
                    }, 2300);
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
                break;
            case 38:
                e.preventDefault();
                newPlayer.speedY = newPlayer.speed * -1;
                newPlayer.left = false;
                newPlayer.right = false;
                newPlayer.up = true;
                newPlayer.down = false;
                syncPlayerDirection();
                break;
            case 39:
                e.preventDefault();
                newPlayer.speedX = newPlayer.speed;
                newPlayer.left = false;
                newPlayer.right = true;
                newPlayer.up = false;
                newPlayer.down = false;
                syncPlayerDirection();
                break;
            case 40:
                e.preventDefault();
                newPlayer.speedY = newPlayer.speed;
                newPlayer.left = false;
                newPlayer.right = false;
                newPlayer.up = false;
                newPlayer.down = true;
                syncPlayerDirection();
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

    // ============ INICIALIZAÇÃO ============

    console.log('Inicializando jogo...');
    
    const playerName = prompt('Digite seu nome:', 'Player') || 'Player';
    console.log('Nome do jogador:', playerName);
    
    newPlayer = new Player(60, 60, 'white', 135, 100, playerName, bomberman);
    console.log('Jogador criado:', newPlayer);
    
    registerPlayer(playerName);
    
    console.log('Iniciando listeners...');
    listenPlayers();
    listenGameState();
    listenMap();
    listenBombs();
    
    // Limpa bombas antigas do Firebase ao iniciar
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
    
    window.addEventListener('beforeunload', () => {
        if (localPlayerId) {
            playersRef.child(localPlayerId).update({ connected: false });
        }
    });
    
    console.log('Jogo inicializado com sucesso!');
};