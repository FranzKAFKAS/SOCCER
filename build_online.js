const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

// 1. Add Lobby UI right after <body>
const lobbyUI = `
    <div id="lobby" style="position:absolute; inset:0; background:#0a0a1a; z-index:100; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:28px;">
        <div class="logo" style="font-family:'Orbitron'; font-size:3rem; font-weight:900; color:#00d4ff;">⚡ GRID RUSH</div>
        <div style="color:rgba(255,255,255,0.5)">ONLINE MULTIPLAYER</div>
        <div style="display:flex; gap: 20px;">
            <button onclick="createRoom()" style="padding:16px 32px; font-size:1.2rem; font-family:'Orbitron'; font-weight:700; cursor:pointer; background:linear-gradient(135deg, #7b2fff, #00d4ff); color:#fff; border:none; border-radius:12px; box-shadow:0 0 30px rgba(123,47,255,0.4);">ODA KUR (P1)</button>
        </div>
        <div style="color:rgba(255,255,255,0.3)">veya</div>
        <div style="display:flex; gap:10px;">
            <input id="room-code-input" type="text" placeholder="KOD GİR" style="padding:12px; font-size:1.2rem; font-family:'Orbitron'; text-align:center; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.15); color:#fff; border-radius:10px;">
            <button onclick="joinRoom()" style="padding:12px 24px; font-size:1.2rem; font-family:'Orbitron'; font-weight:700; cursor:pointer; background:linear-gradient(135deg, #ff4d6d, #7b2fff); color:#fff; border:none; border-radius:10px;">KATIL</button>
        </div>
        <div id="error-msg" style="color:#ff4d6d;"></div>
    </div>
    
    <div id="waiting-room" style="display:none; position:absolute; inset:0; background:#0a0a1a; z-index:100; flex-direction:column; align-items:center; justify-content:center; gap:24px;">
        <div class="logo" style="font-family:'Orbitron'; font-size:3rem; font-weight:900; color:#00d4ff;">⚡ GRID RUSH</div>
        <div id="display-room-code" style="font-family:'Orbitron'; font-size:4rem; font-weight:900; color:#00d4ff; letter-spacing:10px;"></div>
        <div style="color:rgba(255,255,255,0.5)">Arkadaşın bekleniyor...</div>
    </div>
`;

let result = html.replace('<body>', '<body>\n' + lobbyUI);
result = result.replace('<div id="game-wrapper">', '<div id="game-wrapper" style="display:none;">');
result = result.replace('<div id="overlay">', '<div id="overlay" class="hidden">'); // hide overlay

// 2. Inject Socket logic at the very end of the script
const socketLogic = `
        // --- ONLINE LOGIC ---
        const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
        let socket, myPid, myRoomId, allSkills = [], gameStarted = false;

        function createRoom() { 
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                initSocket();
                socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'create_room' })), { once: true });
                return;
            }
            socket.send(JSON.stringify({ type: 'create_room' })); 
        }
        function joinRoom() { 
            const code = document.getElementById('room-code-input').value.toUpperCase();
            if(!code) return;
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                initSocket();
                socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join_room', roomId: code })), { once: true });
                return;
            }
            socket.send(JSON.stringify({ type: 'join_room', roomId: code }));
        }

        function initSocket() {
            socket = new WebSocket(WS_URL);
            socket.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.type === 'room_created') {
                    myPid = 'p1'; myRoomId = msg.roomId; allSkills = msg.allSkills;
                    document.getElementById('lobby').style.display = 'none';
                    const wr = document.getElementById('waiting-room');
                    wr.style.display = 'flex';
                    document.getElementById('display-room-code').textContent = myRoomId;
                } else if (msg.type === 'room_joined') {
                    myPid = 'p2'; myRoomId = msg.roomId; allSkills = msg.allSkills;
                    showSkillSelectionOnline();
                } else if (msg.type === 'opponent_joined') {
                    showSkillSelectionOnline();
                } else if (msg.type === 'start') {
                    document.getElementById('skill-selection-overlay').classList.add('hidden');
                    document.getElementById('game-wrapper').style.display = 'flex';
                    gameStarted = true;
                    resizeGame();
                    requestAnimationFrame(gameLoop);
                } else if (msg.type === 'state') {
                    gs = msg.gs;
                    ['p1', 'p2'].forEach(pid => {
                        const keys = pid === 'p1' ? ['Q','E','R'] : ['U','I','O'];
                        if (gs.players[pid] && gs.players[pid].abilities) {
                            gs.players[pid].abilities.forEach((ab, i) => {
                                const fullSk = allSkills.find(s => s.id === ab.id);
                                if (fullSk) {
                                    ab.icon = fullSk.icon;
                                    ab.key = keys[i];
                                }
                            });
                        }
                    });
                    if (!document.getElementById('p1-ab-0')) buildHUD();
                    updateHUD(16);
                    if(msg.flashes) msg.flashes.forEach(f => showFlash(f.msg, f.color));
                } else if (msg.type === 'gameover') {
                    document.getElementById('overlay').classList.remove('hidden');
                    document.getElementById('overlay').querySelector('h2').textContent = msg.winner === myPid ? 'KAZANDIN!' : (msg.winner === 'draw' ? 'BERABERE!' : 'KAYBETTİN');
                } else if (msg.type === 'error') {
                    document.getElementById('error-msg').textContent = msg.msg;
                }
            };
        }

        function showSkillSelectionOnline() {
            document.getElementById('lobby').style.display = 'none';
            document.getElementById('waiting-room').style.display = 'none';
            document.getElementById('game-wrapper').style.display = 'flex';
            
            // Override the render function to only allow selecting for myPid
            const originalRender = initSkillSelection;
            initSkillSelection = function() {
                originalRender();
                // Disable clicking on the opponent's side
                const otherPid = myPid === 'p1' ? 'p2' : 'p1';
                const pool = document.getElementById(otherPid + '-skill-pool');
                if(pool) {
                    pool.style.pointerEvents = 'none';
                    pool.style.opacity = '0.5';
                }
                const sideLabel = document.querySelector('.' + otherPid + '-selection h3');
                if(sideLabel) sideLabel.textContent += ' (RAKİP SEÇİYOR)';
            };

            // Override update to only check my skills
            const originalUpdate = updateSkillSelectionUI;
            updateSkillSelectionUI = function() {
                originalUpdate();
                const btn = document.getElementById('confirm-skills-btn');
                const mySkills = myPid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
                btn.disabled = mySkills.length < 3;
            };

            document.getElementById('skill-selection-overlay').classList.remove('hidden');
            initSkillSelection();
            
            const btn = document.getElementById('confirm-skills-btn');
            btn.onclick = () => {
                const mySkills = myPid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
                if (mySkills.length < 3) return;
                socket.send(JSON.stringify({ type: 'select_skills', skills: mySkills }));
                btn.textContent = 'RAKİP BEKLENİYOR...';
                btn.disabled = true;
            };
        }

        // Send inputs over socket instead of processing locally
        function sendSocketInput() {
            if(!gameStarted) return;
            let dx = 0, dy = 0;
            if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
            if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
            if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
            if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
            socket.send(JSON.stringify({ type: 'input', dx, dy }));
        }

        // Override local gameLoop
        gameLoop = function(timestamp) {
            // we don't do physics locally anymore, just draw
            if(gameStarted && gs) {
                drawField();
                drawSlowZones();
                drawFreezeProjectile();
                drawHook();
                drawPlayer('p1');
                drawPlayer('p2');
                drawBall();
                drawSmokeZones();
                updateParticles();
                drawParticles();
                drawPenaltyBar();
                
                // Keep input sending active
                sendSocketInput();
            }
            requestAnimationFrame(gameLoop);
        };

        // Initialize socket
        initSocket();

        // Override local event listeners for actions
        window.addEventListener('keydown', e => {
            if(!gameStarted) return;
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
            if(myPid === 'p1') {
                if(e.code === 'KeyQ') socket.send(JSON.stringify({ type: 'action', action: 'ability', idx: 0 }));
                if(e.code === 'KeyE') socket.send(JSON.stringify({ type: 'action', action: 'ability', idx: 1 }));
                if(e.code === 'KeyR') socket.send(JSON.stringify({ type: 'action', action: 'ability', idx: 2 }));
                if(e.code === 'Space') socket.send(JSON.stringify({ type: 'action', action: 'pass' }));
                if(e.code === 'KeyF') socket.send(JSON.stringify({ type: 'action', action: 'throw' }));
                if(e.code === 'KeyG') socket.send(JSON.stringify({ type: 'action', action: 'foul_boost' })); // penalty boost
            } else if (myPid === 'p2') {
                if(e.code === 'KeyU') socket.send(JSON.stringify({ type: 'action', action: 'ability', idx: 0 }));
                if(e.code === 'KeyI') socket.send(JSON.stringify({ type: 'action', action: 'ability', idx: 1 }));
                if(e.code === 'KeyO') socket.send(JSON.stringify({ type: 'action', action: 'ability', idx: 2 }));
                if(e.code === 'Enter' || e.code === 'Space') socket.send(JSON.stringify({ type: 'action', action: 'pass' }));
                if(e.code === 'KeyL' || e.code === 'KeyF') socket.send(JSON.stringify({ type: 'action', action: 'throw' }));
                if(e.code === 'KeyK') socket.send(JSON.stringify({ type: 'action', action: 'foul_boost' }));
            }
        });
        
        window.addEventListener('keyup', e => {
            if(!gameStarted) return;
            let releasedId = null;
            if(myPid === 'p1') {
                if(e.code === 'KeyQ') releasedId = gs.players.p1.abilities[0]?.id;
                if(e.code === 'KeyE') releasedId = gs.players.p1.abilities[1]?.id;
                if(e.code === 'KeyR') releasedId = gs.players.p1.abilities[2]?.id;
            } else if (myPid === 'p2') {
                if(e.code === 'KeyU') releasedId = gs.players.p2.abilities[0]?.id;
                if(e.code === 'KeyI') releasedId = gs.players.p2.abilities[1]?.id;
                if(e.code === 'KeyO') releasedId = gs.players.p2.abilities[2]?.id;
            }
            if(releasedId) socket.send(JSON.stringify({ type: 'release_ability', id: releasedId }));
        });
`;

result = result.replace('</script>', socketLogic + '\n</script>');

// Write to indextoonline.html
fs.writeFileSync('indextoonline.html', result, 'utf8');
console.log('Successfully generated indextoonline.html with preserved visuals!');
