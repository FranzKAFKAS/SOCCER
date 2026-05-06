// ─────────────── CANVAS & CONTEXT ───────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = 900, H = 520;

// ─────────────── CONSTANTS ───────────────
const FIELD_MARGIN = 40;
const END_ZONE_W = 80;
let FIELD_LEFT, FIELD_RIGHT, FIELD_TOP, FIELD_BOTTOM, PLAY_LEFT, PLAY_RIGHT;

function updateFieldBounds() {
    FIELD_LEFT = FIELD_MARGIN;
    FIELD_RIGHT = W - FIELD_MARGIN;
    FIELD_TOP = FIELD_MARGIN;
    FIELD_BOTTOM = H - FIELD_MARGIN;
    PLAY_LEFT = FIELD_LEFT + END_ZONE_W;
    PLAY_RIGHT = FIELD_RIGHT - END_ZONE_W;
}
updateFieldBounds();

function resizeGame() {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();
    W = Math.floor(rect.width) || window.innerWidth;
    H = Math.floor(rect.height) || (window.innerHeight - 120);
    canvas.width = W;
    canvas.height = H;
    updateFieldBounds();
    if (!gameRunning) {
        drawField();
    }
}

const PLAYER_R = 18;
const BALL_R = 10;
const PLAYER_SPEED = 3.2;
const BALL_FRICTION = 0.93;
const THROW_SPEED = 7;
const THROW_SPEED_LOB = 5;

// ─────────────── ABILITY DEFS ───────────────
const ALL_SKILLS = [
    { id: 'clone', icon: '🧬', name: 'Klon', cd: 9000, duration: 5000, color: '#00d4ff' },
    { id: 'slide', icon: '⚡', name: 'Kayma', cd: 5000, duration: 400, color: '#aa00ff' },
    { id: 'power', icon: '💥', name: 'Güç', cd: 9000, duration: 2000, color: '#ffd700' },
    { id: 'selfpass', icon: '🏃‍♂️', name: 'At-Kaçırt', cd: 8000, duration: 1200, color: '#00ffcc' },
    { id: 'freeze', icon: '❄️', name: 'Dondur', cd: 7000, duration: 2000, color: '#88eeff' },
    { id: 'reverse', icon: '🔀', name: 'Yön Tersle', cd: 8000, duration: 4000, color: '#ff88bb' },
    { id: 'lob', icon: '🚀', name: 'Aşırtma', cd: 7000, duration: 0, color: '#ffaa00' },
];

let p1SelectedSkills = [];
let p2SelectedSkills = [];

// ─────────────── GAME STATE ───────────────
let gs = {};
let keys = {};
let particles = [];
let flashTimeout = null;
let animId = null;
let gameRunning = false;
let gameOver = false;

function initState() {
    gs = {
        score: [0, 0],
        seconds: 0,
        timerInterval: null,
        tackleCooldown: 0,   // ms cooldown after a tackle to prevent instant re-steal

        ball: {
            x: W / 2, y: H / 2,
            vx: 0, vy: 0,
            holder: null,         // null | 'p1' | 'p2'
            inAir: false,
            lobMode: false,
            lobProgress: 0,
            lobFrom: null, lobTo: null,
            frozenTimer: 0,
            shadow: 0,            // for lob arc
        },

        players: {
            p1: {
                x: PLAY_LEFT + 60, y: H / 2,
                vx: 0, vy: 0,
                r: PLAYER_R,
                color: '#00d4ff',
                glow: '#00d4ff',
                facing: 1,
                frozenTimer: 0,
                poweredTimer: 0,
                slideTimer: 0,
                slideVx: 0, slideVy: 0,
                clones: [],
                controlsReversedTimer: 0,
                lobPending: false,
                lobCharging: false,
                lobChargeTimer: 0,
                lastDirX: 1, lastDirY: 0,
                abilities: [],
            },
            p2: {
                x: PLAY_RIGHT - 60, y: H / 2,
                vx: 0, vy: 0,
                r: PLAYER_R,
                color: '#ff4d6d',
                glow: '#ff4d6d',
                facing: -1,
                frozenTimer: 0,
                poweredTimer: 0,
                slideTimer: 0,
                slideVx: 0, slideVy: 0,
                clones: [],
                controlsReversedTimer: 0,
                lobPending: false,
                lobCharging: false,
                lobChargeTimer: 0,
                lastDirX: -1, lastDirY: 0,
                abilities: [],
            },
        },
    };
}

// ─────────────── HUD BUILD ───────────────
function buildHUD() {
    ['p1', 'p2'].forEach(pid => {
        const el = document.getElementById(`${pid}-abilities`);
        el.innerHTML = '';
        gs.players[pid].abilities.forEach((ab, i) => {
            const pip = document.createElement('div');
            pip.className = 'ability-pip';
            pip.innerHTML = `
        <div class="ability-icon" id="${pid}-ab-${i}">
          <span style="position:relative;z-index:1">${ab.icon}</span>
          <div class="cooldown-fill" id="${pid}-ab-cd-${i}"></div>
        </div>
        <div class="ability-label">[${ab.key}]</div>
      `;
            el.appendChild(pip);
        });
    });
}

function updateHUD(dt) {
    ['p1', 'p2'].forEach(pid => {
        gs.players[pid].abilities.forEach((ab, i) => {
            const fill = document.getElementById(`${pid}-ab-cd-${i}`);
            const icon = document.getElementById(`${pid}-ab-${i}`);
            if (!fill || !icon) return;
            const pct = ab.cdLeft > 0 ? (ab.cdLeft / ab.cd) * 100 : 0;
            fill.style.height = pct + '%';
            icon.className = 'ability-icon' + (ab.cdLeft <= 0 ? ' ready' : '') + (ab.active ? ' active' : '');
        });
    });

    document.getElementById('score-p1').textContent = gs.score[0];
    document.getElementById('score-p2').textContent = gs.score[1];
}

// ─────────────── PARTICLE SYSTEM ───────────────
function spawnParticles(x, y, color, count = 12, speed = 3) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const s = speed * (0.5 + Math.random());
        particles.push({
            x, y,
            vx: Math.cos(angle) * s,
            vy: Math.sin(angle) * s,
            life: 1,
            decay: 0.025 + Math.random() * 0.02,
            r: 3 + Math.random() * 3,
            color,
        });
    }
}

function updateParticles(dt) {
    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= p.decay;
        return p.life > 0;
    });
}

function drawParticles() {
    particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

// ─────────────── FLASH MESSAGE ───────────────
function showFlash(msg, color = '#fff') {
    const el = document.getElementById('flash-msg');
    el.textContent = msg;
    el.style.color = color;
    el.style.textShadow = `0 0 40px ${color}`;
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
    if (flashTimeout) clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => {
        el.style.transition = 'opacity 0.5s, transform 0.5s';
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -50%) scale(1.3)';
    }, 800);
}

// ─────────────── ABILITY USAGE ───────────────
function useAbility(pid, idx) {
    const p = gs.players[pid];
    const ab = p.abilities[idx];
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;

    if (ab.id === 'clone') {
        ab.active = true;
        ab.cdLeft = ab.cd;
        const goUp = Math.random() < 0.5;
        const realDY = goUp ? -72 : 72;
        const cloneY = p.y + (goUp ? 72 : -72);
        const oldY = p.y;
        p.y = Math.max(FIELD_TOP + 15, Math.min(FIELD_BOTTOM - 15, p.y + realDY));
        p.clones = [{ x: p.x, y: Math.max(FIELD_TOP + 15, Math.min(FIELD_BOTTOM - 15, cloneY)), life: ab.duration }];
        spawnParticles(p.x, oldY, p.color, 20, 4);
        spawnParticles(p.x, p.y, p.color, 10, 3);
        spawnParticles(p.x, p.clones[0].y, p.color, 10, 3);
        showFlash('🧬 KLON!', p.color);
    }
    else if (ab.id === 'slide') {
        ab.active = true;
        ab.cdLeft = ab.cd;
        const speed = 14;
        let dx = 0, dy = 0;
        if (pid === 'p1') {
            if (keys['KeyW']) dy = -1;
            if (keys['KeyS']) dy = 1;
            if (keys['KeyA']) dx = -1;
            if (keys['KeyD']) dx = 1;
        } else {
            if (keys['ArrowUp']) dy = -1;
            if (keys['ArrowDown']) dy = 1;
            if (keys['ArrowLeft']) dx = -1;
            if (keys['ArrowRight']) dx = 1;
        }
        if (dx === 0 && dy === 0) { dx = p.lastDirX; dy = p.lastDirY; }
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        p.slideVx = (dx / len) * speed;
        p.slideVy = (dy / len) * speed;
        p.slideTimer = ab.duration;
        spawnParticles(p.x, p.y, ab.color, 15, 5);
        showFlash('⚡ KAYMA!', ab.color);
    }
    else if (ab.id === 'power') {
        ab.active = true;
        ab.cdLeft = ab.cd;
        p.poweredTimer = ab.duration;
        spawnParticles(p.x, p.y, ab.color, 25, 6);
        showFlash('💥 GÜÇ MODU!', ab.color);
    }
    else if (ab.id === 'selfpass') {
        if (gs.ball.holder !== pid) { showFlash('Önce topu al!', '#888'); return; }
        ab.active = true;
        ab.cdLeft = ab.cd;
        executeSelfPass(pid);
    }
    else if (ab.id === 'freeze') {
        ab.active = true;
        ab.cdLeft = ab.cd;
        gs.freezeProjectile = {
            x: p.x, y: p.y,
            vx: p.lastDirX * 9,
            vy: p.lastDirY * 9,
            life: 120,
            owner: pid
        };
        spawnParticles(p.x, p.y, ab.color, 15, 4);
        showFlash('❄️ DONDUR!', ab.color);
    }
    else if (ab.id === 'reverse') {
        ab.active = true;
        ab.cdLeft = ab.cd;
        const opp = gs.players[pid === 'p1' ? 'p2' : 'p1'];
        opp.controlsReversedTimer = ab.duration;
        spawnParticles(p.x, p.y, ab.color, 18, 5);
        showFlash('🔀 TERSLE!', ab.color);
    }
}

function executeSelfPass(pid) {
    const p = gs.players[pid];
    gs.ball.holder = null;
    gs.ball.inAir = true;
    const angle = 0.35;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const kickX = p.lastDirX * cos - p.lastDirY * sin;
    const kickY = p.lastDirX * sin + p.lastDirY * cos;
    const SELF_PASS_SPEED = 9.5;
    gs.ball.vx = kickX * SELF_PASS_SPEED;
    gs.ball.vy = kickY * SELF_PASS_SPEED;
    p.poweredTimer = Math.max(p.poweredTimer, 1200);
    spawnParticles(p.x, p.y, '#00ffcc', 25, 6);
    showFlash('🏃‍♂️ AT-KAÇIRT!', '#00ffcc');
}

// ─────────────── LOB PASS CHARGE ───────────────
function startLobCharge(pid) {
    const p = gs.players[pid];
    const ab = p.abilities.find(a => a.id === 'lob');
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
    if (gs.ball.holder !== pid) { showFlash('Önce topu al!', '#888'); return; }
    p.lobCharging = true;
    p.lobChargeTimer = 0;
}

function executeLobPass(pid) {
    const p = gs.players[pid];
    if (!p.lobCharging) return;
    p.lobCharging = false;
    const ab = p.abilities.find(a => a.id === 'lob');

    ab.active = true;
    ab.cdLeft = ab.cd;

    if (gs.ball.holder === pid) {
        gs.ball.holder = null;
        gs.ball.lobMode = true;
        gs.ball.lobProgress = 0;
        gs.ball.lobFrom = { x: p.x, y: p.y };

        const ratio = Math.min(1, p.lobChargeTimer / 1500);
        const maxDist = W * 0.85;
        const dist = 50 + ratio * maxDist;

        gs.ball.lobTo = {
            x: Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, p.x + p.lastDirX * dist)),
            y: Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, p.y + p.lastDirY * dist)),
        };
        gs.ball.inAir = true;
        spawnParticles(p.x, p.y, '#ffaa00', 20, 5);
        showFlash('🚀 AŞIRTMA!', '#ffaa00');
    }
    p.lobChargeTimer = 0;
}

// ─────────────── THROW BALL ───────────────
function throwBall(pid) {
    const p = gs.players[pid];
    const opp = gs.players[pid === 'p1' ? 'p2' : 'p1'];
    if (gs.ball.holder !== pid) return;
    gs.ball.holder = null;
    gs.ball.inAir = true;
    // throw toward opponent
    const dx = opp.x - p.x;
    const dy = opp.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    gs.ball.vx = (dx / len) * THROW_SPEED;
    gs.ball.vy = (dy / len) * THROW_SPEED;
    spawnParticles(gs.ball.x, gs.ball.y, '#ffee00', 10, 4);
}

function pickupBall(pid) {
    const p = gs.players[pid];
    const b = gs.ball;
    if (b.holder !== null || b.lobMode) return;
    const dx = p.x - b.x, dy = p.y - b.y;
    if (Math.sqrt(dx * dx + dy * dy) < PLAYER_R + BALL_R + 4) {
        b.holder = pid;
        b.vx = 0; b.vy = 0;
        b.inAir = false;
        spawnParticles(p.x, p.y, p.color, 8, 2);
    }
}



function dropBall(pid) {
    const p = gs.players[pid];
    if (gs.ball.holder !== pid) return;
    gs.ball.holder = null;
    gs.ball.vx = p.lastDirX * 1.5;
    gs.ball.vy = p.lastDirY * 1.5;
}

// ─────────────── INPUT ───────────────
const PASS_SPEED = 15; // px/frame for directional pass

function directionalPass(pid) {
    const p = gs.players[pid];
    const b = gs.ball;
    if (b.holder !== pid || p.frozenTimer > 0) return;

    b.holder = null;
    b.inAir = true;
    b.vx = p.lastDirX * PASS_SPEED;
    b.vy = p.lastDirY * PASS_SPEED;
    // Spawn ball just outside the player's radius so auto-pickup can't immediately re-catch it
    b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
    b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
    spawnParticles(b.x, b.y, pid === 'p1' ? '#00d4ff' : '#ff4d6d', 12, 4);
    showFlash('🏈 PAS!', pid === 'p1' ? '#00d4ff' : '#ff4d6d');
}

const actionMap = {
    Space: () => {
        if (gs.ball.holder === 'p1') directionalPass('p1');
        else if (gs.ball.holder === 'p2') directionalPass('p2');
    },
    KeyF: () => {
        if (gs.ball.holder === 'p1') throwBall('p1');
        else pickupBall('p1');
    },
    KeyL: () => {
        if (gs.ball.holder === 'p2') throwBall('p2');
        else pickupBall('p2');
    }
};

document.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
    }
    if (keys[e.code]) return;
    keys[e.code] = true;
    if (gameRunning && !gameOver) {
        if (actionMap[e.code]) {
            actionMap[e.code]();
        } else {
            const p1AbIdx = gs.players.p1.abilities.findIndex(a => a.key === e.code);
            if (p1AbIdx !== -1) {
                if (gs.players.p1.abilities[p1AbIdx].id === 'lob') startLobCharge('p1');
                else useAbility('p1', p1AbIdx);
            }
            const p2AbIdx = gs.players.p2.abilities.findIndex(a => a.key === e.code);
            if (p2AbIdx !== -1) {
                if (gs.players.p2.abilities[p2AbIdx].id === 'lob') startLobCharge('p2');
                else useAbility('p2', p2AbIdx);
            }
        }
    }
});
document.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (gameRunning && !gameOver) {
        const p1Ab = gs.players.p1.abilities.find(a => a.key === e.code);
        if (p1Ab && p1Ab.id === 'lob' && gs.players.p1.lobCharging) executeLobPass('p1');
        const p2Ab = gs.players.p2.abilities.find(a => a.key === e.code);
        if (p2Ab && p2Ab.id === 'lob' && gs.players.p2.lobCharging) executeLobPass('p2');
    }
});

// ─────────────── GAMEPAD INPUT ───────────────
const gpPrevButtons = { p1: [], p2: [] };

function pollGamepadActions() {
    if (!gameRunning || gameOver) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    ['p1', 'p2'].forEach((pid, index) => {
        const gp = gamepads[index];
        if (!gp || !gp.connected) return;

        const prev = gpPrevButtons[pid];
        const pressed = (btnIdx) => gp.buttons[btnIdx] && gp.buttons[btnIdx].pressed;
        const justPressed = (btnIdx) => pressed(btnIdx) && !prev[btnIdx];
        const justReleased = (btnIdx) => !pressed(btnIdx) && prev[btnIdx];

        // Button 0 (A/Cross): Pass
        if (justPressed(0)) {
            if (gs.ball.holder === pid) directionalPass(pid);
        }

        // Button 2 (X/Square): Throw/Pickup
        if (justPressed(2)) {
            if (gs.ball.holder === pid) throwBall(pid);
            else pickupBall(pid);
        }

        // Button 4 (L1/LB): Ability 1
        if (justPressed(4)) {
            const ab = gs.players[pid].abilities[0];
            if (ab && ab.id === 'lob') startLobCharge(pid);
            else useAbility(pid, 0);
        }
        if (justReleased(4)) {
            const ab = gs.players[pid].abilities[0];
            if (ab && ab.id === 'lob' && gs.players[pid].lobCharging) executeLobPass(pid);
        }

        // Button 5 (R1/RB): Ability 2
        if (justPressed(5)) {
            const ab = gs.players[pid].abilities[1];
            if (ab && ab.id === 'lob') startLobCharge(pid);
            else useAbility(pid, 1);
        }
        if (justReleased(5)) {
            const ab = gs.players[pid].abilities[1];
            if (ab && ab.id === 'lob' && gs.players[pid].lobCharging) executeLobPass(pid);
        }

        // Button 3 (Y/Triangle): Ability 3
        if (justPressed(3)) {
            const ab = gs.players[pid].abilities[2];
            if (ab && ab.id === 'lob') startLobCharge(pid);
            else useAbility(pid, 2);
        }
        if (justReleased(3)) {
            const ab = gs.players[pid].abilities[2];
            if (ab && ab.id === 'lob' && gs.players[pid].lobCharging) executeLobPass(pid);
        }

        // Update prev states
        for (let i = 0; i < gp.buttons.length; i++) {
            prev[i] = pressed(i);
        }
    });
}

// ─────────────── PHYSICS UPDATE ───────────────
function updatePlayer(pid, dt) {
    const p = gs.players[pid];

    // cooldowns
    p.abilities.forEach(ab => {
        if (ab.cdLeft > 0) ab.cdLeft -= dt;
        else { ab.cdLeft = 0; ab.active = false; }
    });

    if (p.frozenTimer > 0) {
        p.frozenTimer -= dt;
        return;
    }

    // slide
    if (p.slideTimer > 0) {
        p.slideTimer -= dt;
        p.x += p.slideVx;
        p.y += p.slideVy;
        p.slideVx *= 0.9;
        p.slideVy *= 0.9;
        clampPlayer(p);
        if (gs.ball.holder === pid) {
            gs.ball.x = p.x + p.lastDirX * (p.r * 0.7);
            gs.ball.y = p.y + p.lastDirY * (p.r * 0.7);
        }
        return;
    }

    // normal movement
    let dx = 0, dy = 0;
    const speed = PLAYER_SPEED * (gs.ball.holder === pid ? 0.8 : 1) * (p.poweredTimer > 0 ? 1.4 : 1);

    // Gamepad input mapping
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[pid === 'p1' ? 0 : 1];
    let gpX = 0, gpY = 0;
    let usingAnalog = false;

    if (gp && gp.connected) {
        if (Math.abs(gp.axes[0]) > 0.2) { gpX = gp.axes[0]; usingAnalog = true; }
        if (Math.abs(gp.axes[1]) > 0.2) { gpY = gp.axes[1]; usingAnalog = true; }
        if (gp.buttons[12] && gp.buttons[12].pressed) { gpY -= 1; usingAnalog = false; } // DPad Up
        if (gp.buttons[13] && gp.buttons[13].pressed) { gpY += 1; usingAnalog = false; } // DPad Down
        if (gp.buttons[14] && gp.buttons[14].pressed) { gpX -= 1; usingAnalog = false; } // DPad Left
        if (gp.buttons[15] && gp.buttons[15].pressed) { gpX += 1; usingAnalog = false; } // DPad Right
    }

    if (pid === 'p1') {
        if (keys['KeyW']) dy -= 1;
        if (keys['KeyS']) dy += 1;
        if (keys['KeyA']) dx -= 1;
        if (keys['KeyD']) dx += 1;
    } else {
        if (keys['ArrowUp']) dy -= 1;
        if (keys['ArrowDown']) dy += 1;
        if (keys['ArrowLeft']) dx -= 1;
        if (keys['ArrowRight']) dx += 1;
    }

    // Analog çubukla tam 360 derece hassasiyet, aksi halde D-Pad / Klavye toplanır
    if (usingAnalog && dx === 0 && dy === 0) {
        dx = gpX;
        dy = gpY;
    } else {
        dx += gpX;
        dy += gpY;
    }

    // Ters kontrol yeteneği etki ediyorsa P1'in yönlerini tersle
    if (pid === 'p1' && p.controlsReversedTimer > 0) {
        dx = -dx;
        dy = -dy;
        p.controlsReversedTimer -= dt;
    }

    // (p.facing kaldırıldı, yerine lastDirX/Y kullanılıyor)

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dx !== 0 || dy !== 0) {
        p.x += (dx / len) * speed;
        p.y += (dy / len) * speed;
        p.lastDirX = dx / len;
        p.lastDirY = dy / len;
        // Move clones in perfect sync with real player
        if (pid === 'p1') {
            p.clones.forEach(c => {
                c.x += (dx / len) * speed;
                c.y += (dy / len) * speed;
                c.x = Math.max(FIELD_LEFT + PLAYER_R, Math.min(FIELD_RIGHT - PLAYER_R, c.x));
                c.y = Math.max(FIELD_TOP + PLAYER_R, Math.min(FIELD_BOTTOM - PLAYER_R, c.y));
            });
        }
    }

    // Clone lifetime decay
    if (pid === 'p1') {
        p.clones = p.clones.filter(c => { c.life -= dt; return c.life > 0; });
    }

    // power decay
    if (p.poweredTimer > 0) p.poweredTimer -= dt;

    // lob charging logic
    if (p.lobCharging) {
        p.lobChargeTimer += dt;
        let tx = 99999, ty = 99999;
        if (p.lastDirX < 0) tx = (p.x - FIELD_LEFT) / -p.lastDirX;
        else if (p.lastDirX > 0) tx = (FIELD_RIGHT - p.x) / p.lastDirX;
        if (p.lastDirY < 0) ty = (p.y - FIELD_TOP) / -p.lastDirY;
        else if (p.lastDirY > 0) ty = (FIELD_BOTTOM - p.y) / p.lastDirY;
        const distToEdge = Math.max(0, Math.min(tx, ty));
        const rate = (W * 0.85) / 1500;
        let dynamicMaxTime = (distToEdge - 30) / rate;
        dynamicMaxTime = Math.max(350, Math.min(1500, dynamicMaxTime));

        if (p.lobChargeTimer > dynamicMaxTime) {
            p.lobCharging = false;
            p.lobChargeTimer = 0;
            const lobAb = p.abilities.find(a => a.id === 'lob');
            if (lobAb) lobAb.cdLeft = lobAb.cd;
            spawnParticles(p.x, p.y, '#555', 15, 3);
            showFlash('❌ ALAN BİTTİ!', '#888');
        }
    }

    clampPlayer(p);

    if (gs.ball.holder === pid) {
        gs.ball.x = p.x + p.lastDirX * (p.r * 0.7);
        gs.ball.y = p.y + p.lastDirY * (p.r * 0.7);
    }
}

function clampPlayer(p) {
    p.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, p.x));
    p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, p.y));
}

function updateBall(dt) {
    const b = gs.ball;

    if (b.holder !== null) return;

    if (b.lobMode) {
        b.lobProgress += 0.018;
        if (b.lobProgress >= 1) {
            b.lobProgress = 1;
            b.lobMode = false;
            b.x = b.lobTo.x;
            b.y = b.lobTo.y;
            b.vx = 0; b.vy = 0;
            b.inAir = false;
            spawnParticles(b.x, b.y, '#ffaa00', 15, 4);
        } else {
            // Bezier arc
            const t = b.lobProgress;
            const mx = (b.lobFrom.x + b.lobTo.x) / 2;
            const my = Math.min(b.lobFrom.y, b.lobTo.y) - 120;
            b.x = (1 - t) * (1 - t) * b.lobFrom.x + 2 * (1 - t) * t * mx + t * t * b.lobTo.x;
            b.y = (1 - t) * (1 - t) * b.lobFrom.y + 2 * (1 - t) * t * my + t * t * b.lobTo.y;
        }
        return;
    }

    b.x += b.vx;
    b.y += b.vy;
    b.vx *= BALL_FRICTION;
    b.vy *= BALL_FRICTION;

    // wall bounce — elastic with 0.82 restitution for satisfying feel
    if (b.x - BALL_R < FIELD_LEFT) { b.x = FIELD_LEFT + BALL_R; b.vx *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); }
    if (b.x + BALL_R > FIELD_RIGHT) { b.x = FIELD_RIGHT - BALL_R; b.vx *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); }
    if (b.y - BALL_R < FIELD_TOP) { b.y = FIELD_TOP + BALL_R; b.vy *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); }
    if (b.y + BALL_R > FIELD_BOTTOM) { b.y = FIELD_BOTTOM - BALL_R; b.vy *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); }

    if (Math.abs(b.vx) < 0.1) b.vx = 0;
    if (Math.abs(b.vy) < 0.1) b.vy = 0;
}

function checkCollisions(dt) {
    const p1 = gs.players.p1;
    const p2 = gs.players.p2;
    const b = gs.ball;

    // Tackle cooldown
    if (gs.tackleCooldown > 0) gs.tackleCooldown -= dt;

    // Player-player collision
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = p1.r + p2.r;
    if (dist < minDist && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        const overlap = minDist - dist;

        // Always separate players
        p1.x -= nx * overlap * 0.5;
        p1.y -= ny * overlap * 0.5;
        p2.x += nx * overlap * 0.5;
        p2.y += ny * overlap * 0.5;

        if (gs.tackleCooldown <= 0) {
            // powered player knocks ball loose
            if (p1.poweredTimer > 0 && b.holder === 'p2') {
                b.holder = null;
                b.vx = nx * 6;
                b.vy = ny * 6;
                b.inAir = true;
                gs.tackleCooldown = 800;
                spawnParticles(p2.x, p2.y, '#ffd700', 20, 6);
                showFlash('🔥 YIKILDI!', '#ffd700');
            } else if (p2.poweredTimer > 0 && b.holder === 'p1') {
                b.holder = null;
                b.vx = -nx * 6;
                b.vy = -ny * 6;
                b.inAir = true;
                gs.tackleCooldown = 800;
                spawnParticles(p1.x, p1.y, '#ffd700', 20, 6);
                showFlash('🔥 YIKILDI!', '#ffd700');
            }
            // Normal tackle: contact transfers ball to the tackler
            else if (b.holder === 'p1' && p1.frozenTimer <= 0) {
                // p2 tackles p1 — ball goes to p2
                b.holder = 'p2';
                b.vx = 0; b.vy = 0;
                b.inAir = false;
                gs.tackleCooldown = 600;
                spawnParticles(p1.x, p1.y, '#ff4d6d', 14, 4);
                showFlash('🏈 KAPTIRDI!', '#ff4d6d');
            } else if (b.holder === 'p2' && p2.frozenTimer <= 0) {
                // p1 tackles p2 — ball goes to p1
                b.holder = 'p1';
                b.vx = 0; b.vy = 0;
                b.inAir = false;
                gs.tackleCooldown = 600;
                spawnParticles(p2.x, p2.y, '#00d4ff', 14, 4);
                showFlash('🏈 KAPTIRDI!', '#00d4ff');
            }
        }
    }

    // Auto-pickup: only when ball is free AND nearly stationary (prevents catching a thrown/passed ball)
    const ballSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (ballSpeed < 2) {
        ['p1', 'p2'].forEach(pid => {
            const p = gs.players[pid];
            if (b.holder === null && !b.lobMode) {
                const bx = b.x - p.x, by = b.y - p.y;
                if (Math.sqrt(bx * bx + by * by) < PLAYER_R + BALL_R) {
                    b.holder = pid;
                    b.vx = 0; b.vy = 0;
                    b.inAir = false;
                    spawnParticles(p.x, p.y, p.color, 6, 2);
                }
            }
        });
    }

    // Freeze projectile
    if (gs.freezeProjectile) {
        const fp = gs.freezeProjectile;
        fp.x += fp.vx;
        fp.y += fp.vy;
        fp.life--;

        const targetPid = fp.owner === 'p1' ? 'p2' : 'p1';
        const target = gs.players[targetPid];
        const fdx = fp.x - target.x, fdy = fp.y - target.y;
        if (Math.sqrt(fdx * fdx + fdy * fdy) < PLAYER_R + 6) {
            target.frozenTimer = 2000;
            if (gs.ball.holder === targetPid) {
                gs.ball.holder = null;
                gs.ball.vx = targetPid === 'p1' ? -2 : 2; gs.ball.vy = 0;
            }
            spawnParticles(target.x, target.y, '#88eeff', 25, 5);
            showFlash('🧊 DONDU!', '#88eeff');
            gs.freezeProjectile = null;
        }

        if (fp && (fp.life <= 0 || fp.x < FIELD_LEFT || fp.x > FIELD_RIGHT || fp.y < FIELD_TOP || fp.y > FIELD_BOTTOM)) {
            gs.freezeProjectile = null;
        }
    }

    // Ball hits clone -> P1 Teleportation (Substitution Jutsu)
    if (b.holder === null && !b.lobMode && p1.clones.length > 0 && p1.frozenTimer <= 0) {
        for (let i = 0; i < p1.clones.length; i++) {
            const c = p1.clones[i];
            const distX = b.x - c.x;
            const distY = b.y - c.y;
            if (Math.sqrt(distX * distX + distY * distY) < PLAYER_R + BALL_R + 8) {
                // Swap P1 and the Clone
                const oldX = p1.x;
                const oldY = p1.y;
                p1.x = c.x;
                p1.y = c.y;
                c.x = oldX;
                c.y = oldY;

                // P1 catches the ball
                b.holder = 'p1';
                b.vx = 0;
                b.vy = 0;
                b.inAir = false;

                spawnParticles(p1.x, p1.y, '#ffffff', 40, 8);
                showFlash('💫 YER DEĞİŞTİRME!', '#00d4ff');
                break;
            }
        }
    }

    // Clone vs P2 collision — pop fake clone on touch
    p1.clones = p1.clones.filter(c => {
        const cdx = p2.x - c.x, cdy = p2.y - c.y;
        if (Math.sqrt(cdx * cdx + cdy * cdy) < PLAYER_R * 2 + 2) {
            spawnParticles(c.x, c.y, '#00d4ff', 18, 5);
            showFlash('👻 HAYALET!', '#00d4ff');
            return false;
        }
        return true;
    });
}

function checkGoal() {
    const b = gs.ball;

    // SAYIM KURALI: sadece topla birlikte end zone'a giren oyuncu sayı yapabilir
    let scorer = null;

    ['p1', 'p2'].forEach(pid => {
        const p = gs.players[pid];
        if (b.holder === pid) {
            if (pid === 'p1' && p.x > PLAY_RIGHT) scorer = 'p1';
            if (pid === 'p2' && p.x < PLAY_LEFT) scorer = 'p2';
        }
    });

    // Serbest top end zone çizgisine girerse geri sektirilir (sayı olmaz)
    if (b.holder === null && !b.lobMode) {
        if (b.x - BALL_R < PLAY_LEFT) { b.x = PLAY_LEFT + BALL_R; b.vx = Math.abs(b.vx) * 0.75; }
        if (b.x + BALL_R > PLAY_RIGHT) { b.x = PLAY_RIGHT - BALL_R; b.vx = -Math.abs(b.vx) * 0.75; }
    }

    if (scorer) {
        const idx = scorer === 'p1' ? 0 : 1;
        gs.score[idx]++;
        spawnParticles(W / 2, H / 2, scorer === 'p1' ? '#00d4ff' : '#ff4d6d', 60, 8);
        showFlash(scorer === 'p1' ? '🔵 GOL! +1' : '🔴 GOL! +1', scorer === 'p1' ? '#00d4ff' : '#ff4d6d');
        document.getElementById(`score-${scorer}`).textContent = gs.score[idx];

        if (gs.score[idx] >= 5) {
            endGame(scorer);
            return;
        }
        resetRound();
    }
}

function resetRound() {
    const b = gs.ball;
    b.x = W / 2; b.y = H / 2;
    b.vx = 0; b.vy = 0;
    b.holder = null;
    b.inAir = false;
    b.lobMode = false;
    b.frozenTimer = 0;

    gs.players.p1.x = PLAY_LEFT + 60;
    gs.players.p1.y = H / 2;
    gs.players.p1.frozenTimer = 0;
    gs.players.p1.poweredTimer = 0;
    gs.players.p1.slideTimer = 0;
    gs.players.p1.selfPassCdLeft = 0;
    gs.players.p1.clone = null;

    gs.players.p2.x = PLAY_RIGHT - 60;
    gs.players.p2.y = H / 2;
    gs.players.p2.frozenTimer = 0;
    gs.players.p2.poweredTimer = 0;
    gs.players.p2.slideTimer = 0;
    gs.players.p2.selfPassCdLeft = 0;
    gs.players.p2.lobCharging = false;
    gs.players.p2.lobChargeTimer = 0;

    gs.freezeProjectile = null;
}

function endGame(winner) {
    gameOver = true;
    gameRunning = false;
    clearInterval(gs.timerInterval);

    setTimeout(() => {
        const overlay = document.getElementById('overlay');
        const h2 = overlay.querySelector('h2');
        const sub = overlay.querySelector('.subtitle');
        const btn = document.getElementById('start-btn');
        h2.textContent = winner === 'p1' ? '🔵 OYUNCU 1 KAZANDI!' : '🔴 OYUNCU 2 KAZANDI!';
        h2.style.color = winner === 'p1' ? '#00d4ff' : '#ff4d6d';
        sub.textContent = `Skor: ${gs.score[0]} — ${gs.score[1]}`;
        btn.textContent = 'YENİDEN OYNA';
        overlay.classList.remove('hidden');
    }, 1200);
}

// ─────────────── DRAW ───────────────
function drawField() {
    // Background
    ctx.fillStyle = '#0d1f12';
    ctx.fillRect(0, 0, W, H);

    // Field
    const grad = ctx.createLinearGradient(FIELD_LEFT, 0, FIELD_RIGHT, 0);
    grad.addColorStop(0, '#0d2818');
    grad.addColorStop(0.5, '#0f3318');
    grad.addColorStop(1, '#0d2818');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP, 12);
    ctx.fill();

    // Yard lines
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let x = PLAY_LEFT + 60; x < PLAY_RIGHT; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, FIELD_TOP);
        ctx.lineTo(x, FIELD_BOTTOM);
        ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(W / 2, FIELD_TOP);
    ctx.lineTo(W / 2, FIELD_BOTTOM);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 50, 0, Math.PI * 2);
    ctx.stroke();

    // P1 End Zone (Left)
    ctx.fillStyle = 'rgba(0, 212, 255, 0.08)';
    ctx.fillRect(FIELD_LEFT, FIELD_TOP, END_ZONE_W, FIELD_BOTTOM - FIELD_TOP);
    ctx.strokeStyle = 'rgba(0,212,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PLAY_LEFT, FIELD_TOP);
    ctx.lineTo(PLAY_LEFT, FIELD_BOTTOM);
    ctx.stroke();

    // P2 End Zone (Right)
    ctx.fillStyle = 'rgba(255, 77, 109, 0.08)';
    ctx.fillRect(PLAY_RIGHT, FIELD_TOP, END_ZONE_W, FIELD_BOTTOM - FIELD_TOP);
    ctx.strokeStyle = 'rgba(255,77,109,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PLAY_RIGHT, FIELD_TOP);
    ctx.lineTo(PLAY_RIGHT, FIELD_BOTTOM);
    ctx.stroke();

    // End zone labels
    ctx.save();
    ctx.translate(FIELD_LEFT + END_ZONE_W / 2, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(0,212,255,0.35)';
    ctx.font = 'bold 12px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('P1 GÖL', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(PLAY_RIGHT + END_ZONE_W / 2, H / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(255,77,109,0.35)';
    ctx.font = 'bold 12px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('P2 GÖL', 0, 0);
    ctx.restore();

    // Field border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP, 12);
    ctx.stroke();
}

// Helper: draw a single player body at position (x,y) with given style
function drawPlayerBody(x, y, color, frozenTimer, poweredTimer, label, slideTimer, slideVx, slideVy, pid) {
    ctx.save();
    let glowColor = color;
    let glowSize = 20;
    if (poweredTimer > 0) { glowColor = '#ffd700'; glowSize = 35; }
    if (frozenTimer > 0) { glowColor = '#88eeff'; glowSize = 25; }
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowSize;

    if (frozenTimer > 0) ctx.fillStyle = '#88eeff';
    else if (poweredTimer > 0) ctx.fillStyle = '#ffd700';
    else ctx.fillStyle = color;

    ctx.beginPath(); ctx.arc(x, y, PLAYER_R, 0, Math.PI * 2); ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, PLAYER_R - 4, 0, Math.PI * 2); ctx.stroke();

    // Slide trail
    if (slideTimer > 0) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = pid === 'p1' ? '#aa00ff' : '#ff88bb';
        ctx.beginPath(); ctx.arc(x - slideVx * 3, y - slideVy * 3, PLAYER_R * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.arc(x - slideVx * 6, y - slideVy * 6, PLAYER_R * 0.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Orbitron, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);

    if (frozenTimer > 0) {
        ctx.globalAlpha = 0.5; ctx.fillStyle = '#88eeff';
        ctx.beginPath(); ctx.arc(x, y, PLAYER_R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = '14px serif';
        ctx.fillText('❄', x, y - 26);
    }
    if (poweredTimer > 0) {
        const pulse = 0.3 + 0.3 * Math.sin(Date.now() / 80);
        ctx.globalAlpha = pulse; ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(x, y, PLAYER_R + 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

function drawPlayer(pid) {
    const p = gs.players[pid];

    if (pid === 'p1' && p.clones.length > 0) {
        // Build list of all 3 bodies (2 clones + real) and shuffle draw order
        // so Z-order doesn't give away which is real
        const bodies = [
            { x: p.x, y: p.y, real: true },
            ...p.clones.map(c => ({ x: c.x, y: c.y, real: false })),
        ];
        // Fisher-Yates shuffle using a stable per-frame seed
        const seed = Math.floor(Date.now() / 200); // changes every 200ms
        bodies.sort((a, b) => Math.sin(seed + (a.real ? 1 : 0)) - 0.5);

        bodies.forEach(b => {
            drawPlayerBody(b.x, b.y, p.color, p.frozenTimer, p.poweredTimer, 'P1', p.slideTimer, p.slideVx, p.slideVy, 'p1');
        });
        // Controls-reversed indicator (only on real)
        if (p.controlsReversedTimer > 0) {
            ctx.save(); ctx.fillStyle = '#ff88bb'; ctx.font = '13px serif';
            ctx.textAlign = 'center'; ctx.fillText('🔀', p.x, p.y - 28); ctx.restore();
        }
        return; // skip standard draw below
    }

    // Standard draw for non-clone mode
    drawPlayerBody(p.x, p.y, p.color, p.frozenTimer, p.poweredTimer,
        pid === 'p1' ? 'P1' : 'P2', p.slideTimer, p.slideVx, p.slideVy, pid);

    // Controls-reversed indicator
    if (pid === 'p1' && p.controlsReversedTimer > 0) {
        ctx.save(); ctx.fillStyle = '#ff88bb'; ctx.font = '13px serif';
        ctx.textAlign = 'center'; ctx.fillText('🔀', p.x, p.y - 28); ctx.restore();
    }
}

function drawBall() {
    const b = gs.ball;

    ctx.save();

    // Lob landing shadow
    if (b.lobMode) {
        const shadowScale = 0.4 + 0.6 * b.lobProgress;
        ctx.globalAlpha = 0.2 * (1 - Math.abs(b.lobProgress - 0.5) * 2);
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(b.lobTo.x, b.lobTo.y, BALL_R * 1.5 * shadowScale, BALL_R * 0.6 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Holder ring — colored outline around ball showing who owns it
    const lobScale = b.lobMode ? (1 + 0.5 * Math.sin(b.lobProgress * Math.PI)) : 1;
    const effectiveR = BALL_R * lobScale;

    if (b.holder === 'p1') {
        // Pulsing ownership ring
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 120);
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 18 * pulse;
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(b.x, b.y, effectiveR + 4, 0, Math.PI * 2);
        ctx.stroke();
    } else if (b.holder === 'p2') {
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 120);
        ctx.shadowColor = '#ff4d6d';
        ctx.shadowBlur = 18 * pulse;
        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(b.x, b.y, effectiveR + 4, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Ball glow
    ctx.shadowColor = '#ffee00';
    ctx.shadowBlur = b.holder ? 12 : 25;

    // Ball body
    const ballGrad = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, effectiveR);
    ballGrad.addColorStop(0, '#fff8cc');
    ballGrad.addColorStop(0.4, '#ffcc00');
    ballGrad.addColorStop(1, '#cc7700');
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, effectiveR, 0, Math.PI * 2);
    ctx.fill();

    // Ball outline
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,238,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, effectiveR, 0, Math.PI * 2);
    ctx.stroke();

    // Ball laces
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y - effectiveR * 0.5);
    ctx.lineTo(b.x, b.y + effectiveR * 0.5);
    ctx.stroke();
    // Horizontal lace lines
    [-0.2, 0, 0.2].forEach(offs => {
        ctx.beginPath();
        ctx.moveTo(b.x - effectiveR * 0.3, b.y + offs * effectiveR);
        ctx.lineTo(b.x + effectiveR * 0.3, b.y + offs * effectiveR);
        ctx.stroke();
    });

    ctx.restore();

    // Decoy balls on clones: if P1 holds the ball and has clones,
    // draw identical-looking balls at each clone position so P2 can't tell which is real
    const p1 = gs.players.p1;
    if (b.holder === 'p1' && p1.clones && p1.clones.length > 0) {
        p1.clones.forEach(c => {
            const cx = c.x + p1.lastDirX * (PLAYER_R * 0.7);
            const cy = c.y + p1.lastDirY * (PLAYER_R * 0.7);
            ctx.save();
            // Same pulsing ownership ring as real ball
            const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 120);
            ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 18 * pulse;
            ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy, BALL_R + 4, 0, Math.PI * 2); ctx.stroke();
            // Ball body
            ctx.shadowColor = '#ffee00'; ctx.shadowBlur = 12;
            const fg = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, BALL_R);
            fg.addColorStop(0, '#fff8cc'); fg.addColorStop(0.4, '#ffcc00'); fg.addColorStop(1, '#cc7700');
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,238,0,0.8)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(cx, cy - BALL_R * 0.5); ctx.lineTo(cx, cy + BALL_R * 0.5); ctx.stroke();
            [-0.2, 0, 0.2].forEach(o => {
                ctx.beginPath();
                ctx.moveTo(cx - BALL_R * 0.3, cy + o * BALL_R);
                ctx.lineTo(cx + BALL_R * 0.3, cy + o * BALL_R);
                ctx.stroke();
            });
            ctx.restore();
        });
    }
}

function drawFreezeProjectile() {
    if (!gs.freezeProjectile) return;
    const fp = gs.freezeProjectile;
    ctx.save();
    ctx.shadowColor = '#88eeff';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#88eeff';
    ctx.beginPath();
    ctx.arc(fp.x, fp.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// ─────────────── MAIN LOOP ───────────────
let lastTime = 0;
function gameLoop(ts) {
    if (!gameRunning) return;
    const dt = Math.min(ts - lastTime, 50);
    lastTime = ts;

    pollGamepadActions();

    // Update
    updatePlayer('p1', dt);
    updatePlayer('p2', dt);
    updateBall(dt);
    checkCollisions(dt);
    checkGoal();
    updateParticles(dt);
    updateHUD(dt);

    // Draw — players first, ball on top so it's always visible
    drawField();
    drawFreezeProjectile();
    drawPlayer('p1');
    drawPlayer('p2');
    drawBall();
    drawParticles();

    animId = requestAnimationFrame(gameLoop);
}

// ─────────────── START/RESTART ───────────────
function startGame() {
    document.getElementById('overlay').classList.add('hidden');
    initSkillSelection();
}

function initSkillSelection() {
    document.getElementById('skill-selection-overlay').classList.remove('hidden');
    p1SelectedSkills = [];
    p2SelectedSkills = [];

    const p1Pool = document.getElementById('p1-skill-pool');
    const p2Pool = document.getElementById('p2-skill-pool');
    p1Pool.innerHTML = ''; p2Pool.innerHTML = '';

    ALL_SKILLS.forEach(sk => {
        const p1Card = document.createElement('div');
        p1Card.className = 'skill-card';
        p1Card.style.color = sk.color;
        p1Card.innerHTML = `<div class="skill-icon">${sk.icon}</div><div class="skill-name">${sk.name}</div>`;
        p1Card.onclick = () => toggleSkill('p1', sk, p1Card);
        p1Pool.appendChild(p1Card);

        const p2Card = document.createElement('div');
        p2Card.className = 'skill-card';
        p2Card.style.color = sk.color;
        p2Card.innerHTML = `<div class="skill-icon">${sk.icon}</div><div class="skill-name">${sk.name}</div>`;
        p2Card.onclick = () => toggleSkill('p2', sk, p2Card);
        p2Pool.appendChild(p2Card);
    });
    updateSkillSelectionUI();
}

function toggleSkill(pid, sk, cardEl) {
    const arr = pid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
    const idx = arr.findIndex(s => s.id === sk.id);
    if (idx !== -1) {
        arr.splice(idx, 1);
        cardEl.classList.remove('selected');
    } else {
        if (arr.length >= 3) return;
        arr.push(sk);
        cardEl.classList.add('selected');
    }
    updateSkillSelectionUI();
}

function updateSkillSelectionUI() {
    for (let i = 0; i < 3; i++) {
        const s1 = p1SelectedSkills[i];
        document.getElementById(`p1-slot-${i}`).innerHTML = s1 ? s1.icon : '';
        document.getElementById(`p1-slot-${i}`).style.borderColor = s1 ? s1.color : 'rgba(255,255,255,0.3)';

        const s2 = p2SelectedSkills[i];
        document.getElementById(`p2-slot-${i}`).innerHTML = s2 ? s2.icon : '';
        document.getElementById(`p2-slot-${i}`).style.borderColor = s2 ? s2.color : 'rgba(255,255,255,0.3)';
    }

    const btn = document.getElementById('confirm-skills-btn');
    btn.disabled = (p1SelectedSkills.length < 3 || p2SelectedSkills.length < 3);
}

function confirmSkills() {
    document.getElementById('skill-selection-overlay').classList.add('hidden');
    _doStartGame();
}

function _doStartGame() {
    if (animId) cancelAnimationFrame(animId);
    if (gs.timerInterval) clearInterval(gs.timerInterval);
    particles = [];
    keys = {};
    gameOver = false;
    gameRunning = true;

    initState();

    // Assign selected abilities and keys
    const p1Keys = ['KeyQ', 'KeyE', 'KeyR'];
    const p2Keys = ['KeyU', 'KeyI', 'KeyO'];
    gs.players.p1.abilities = p1SelectedSkills.map((sk, i) => ({ ...sk, key: p1Keys[i], cdLeft: 0, active: false }));
    gs.players.p2.abilities = p2SelectedSkills.map((sk, i) => ({ ...sk, key: p2Keys[i], cdLeft: 0, active: false }));

    buildHUD();

    // Restore overlay content in case of restart
    const overlay = document.getElementById('overlay');
    overlay.querySelector('h2').textContent = '⚡ GRID RUSH';
    overlay.querySelector('h2').style.color = '';
    document.getElementById('start-btn').textContent = 'YENİDEN OYNA';
    overlay.classList.add('hidden');
    // Blur start button so Space key doesn't re-trigger it
    document.getElementById('start-btn').blur();

    // Timer
    let timeLeft = 180;
    document.getElementById('timer-display').textContent = formatTime(timeLeft);
    gs.timerInterval = setInterval(() => {
        if (!gameRunning) return;
        timeLeft--;
        document.getElementById('timer-display').textContent = formatTime(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(gs.timerInterval);
            // Who has more score wins
            const winner = gs.score[0] > gs.score[1] ? 'p1' : gs.score[1] > gs.score[0] ? 'p2' : 'draw';
            if (winner === 'draw') {
                showFlash('⚖️ BERABERE!', '#fff');
                setTimeout(() => { endGame('p1'); }, 1500); // show overlay as P1 for draw
            } else {
                endGame(winner);
            }
        }
    }, 1000);

    lastTime = performance.now();
    animId = requestAnimationFrame(gameLoop);
    showFlash('🏈 BAŞLA!', '#ffffff');
} // end _doStartGame

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─────────────── RESIZE & INITIAL DRAW ───────────────
// Wait one frame so layout is complete before measuring
requestAnimationFrame(() => {
    resizeGame();
    initState();
    buildHUD();
    drawField();

    // Draw initial ball
    const b = gs.ball;
    ctx.save();
    ctx.shadowColor = '#ffee00';
    ctx.shadowBlur = 25;
    const bg = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, BALL_R);
    bg.addColorStop(0, '#fff8cc');
    bg.addColorStop(0.4, '#ffcc00');
    bg.addColorStop(1, '#cc7700');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
});

window.addEventListener('resize', () => {
    resizeGame();
    if (!gameRunning) { initState(); buildHUD(); drawField(); }
});
