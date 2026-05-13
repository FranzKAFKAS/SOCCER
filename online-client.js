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

        // ── Offscreen field cache ────────────────────────────────────────────────
        // drawField() statik zemin+çizgiler+kale kısmı her frame sıfırdan çiziliyor:
        //   1 LinearGradient + ~10 stroke + arc + 2 text + border = pahalı.
        // Çözüm: statik parçaları offscreen canvas'a bir kere çiz, her frame drawImage ile kopyala.
        let __fieldCanvas = null;
        let __fieldCtx = null;
        let __fieldDirty = true;   // resize veya alan değişince true → yeniden çiz

        function invalidateFieldCache() { __fieldDirty = true; }

        function ensureFieldCache() {
            if (!__fieldCanvas || __fieldCanvas.width !== W || __fieldCanvas.height !== H) {
                __fieldCanvas = document.createElement('canvas');
                __fieldCanvas.width = W;
                __fieldCanvas.height = H;
                __fieldCtx = __fieldCanvas.getContext('2d');
                __fieldDirty = true;
            }
            if (!__fieldDirty) return;
            __fieldDirty = false;
            const fctx = __fieldCtx;
            fctx.clearRect(0, 0, W, H);

            // Background
            fctx.fillStyle = '#0d1f12';
            fctx.fillRect(0, 0, W, H);

            // Field gradient
            const grad = fctx.createLinearGradient(FIELD_LEFT, 0, FIELD_RIGHT, 0);
            grad.addColorStop(0, '#0d2818');
            grad.addColorStop(0.5, '#0f3318');
            grad.addColorStop(1, '#0d2818');
            fctx.fillStyle = grad;
            fctx.beginPath();
            fctx.roundRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP, 12);
            fctx.fill();

            // Yard lines
            fctx.strokeStyle = 'rgba(255,255,255,0.07)';
            fctx.lineWidth = 1;
            for (let x = PLAY_LEFT + 60; x < PLAY_RIGHT; x += 60) {
                fctx.beginPath(); fctx.moveTo(x, FIELD_TOP); fctx.lineTo(x, FIELD_BOTTOM); fctx.stroke();
            }

            // Center line
            fctx.strokeStyle = 'rgba(255,255,255,0.18)';
            fctx.lineWidth = 2;
            fctx.setLineDash([8, 8]);
            fctx.beginPath(); fctx.moveTo(W / 2, FIELD_TOP); fctx.lineTo(W / 2, FIELD_BOTTOM); fctx.stroke();
            fctx.setLineDash([]);

            // Center circle
            fctx.strokeStyle = 'rgba(255,255,255,0.1)';
            fctx.lineWidth = 1.5;
            fctx.beginPath(); fctx.arc(W / 2, H / 2, 50, 0, Math.PI * 2); fctx.stroke();

            // P1 End Zone (Left)
            fctx.fillStyle = 'rgba(0, 212, 255, 0.08)';
            fctx.fillRect(FIELD_LEFT, FIELD_TOP, END_ZONE_W, FIELD_BOTTOM - FIELD_TOP);
            fctx.strokeStyle = 'rgba(0,212,255,0.35)';
            fctx.lineWidth = 2;
            fctx.beginPath(); fctx.moveTo(PLAY_LEFT, FIELD_TOP); fctx.lineTo(PLAY_LEFT, FIELD_BOTTOM); fctx.stroke();

            // P2 End Zone (Right)
            fctx.fillStyle = 'rgba(255, 77, 109, 0.08)';
            fctx.fillRect(PLAY_RIGHT, FIELD_TOP, END_ZONE_W, FIELD_BOTTOM - FIELD_TOP);
            fctx.strokeStyle = 'rgba(255,77,109,0.35)';
            fctx.lineWidth = 2;
            fctx.beginPath(); fctx.moveTo(PLAY_RIGHT, FIELD_TOP); fctx.lineTo(PLAY_RIGHT, FIELD_BOTTOM); fctx.stroke();

            // End zone labels
            fctx.save();
            fctx.translate(FIELD_LEFT + END_ZONE_W / 2, H / 2);
            fctx.rotate(-Math.PI / 2);
            fctx.fillStyle = 'rgba(0,212,255,0.35)';
            fctx.font = 'bold 12px Orbitron, monospace';
            fctx.textAlign = 'center';
            fctx.fillText('P1 GÖL', 0, 0);
            fctx.restore();

            fctx.save();
            fctx.translate(PLAY_RIGHT + END_ZONE_W / 2, H / 2);
            fctx.rotate(Math.PI / 2);
            fctx.fillStyle = 'rgba(255,77,109,0.35)';
            fctx.font = 'bold 12px Orbitron, monospace';
            fctx.textAlign = 'center';
            fctx.fillText('P2 GÖL', 0, 0);
            fctx.restore();

            // Shot goals (static part — no shadow in offscreen ctx)
            _drawShotGoalStatic(fctx, PLAY_LEFT, H / 2, SHOT_GOAL_H, '#00d4ff', -1);
            _drawShotGoalStatic(fctx, PLAY_RIGHT, H / 2, SHOT_GOAL_H, '#ff4d6d', 1);

            // Field border
            fctx.strokeStyle = 'rgba(255,255,255,0.15)';
            fctx.lineWidth = 2;
            fctx.beginPath();
            fctx.roundRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP, 12);
            fctx.stroke();
        }

        // Kale statik çizimi (shadow olmadan offscreen'e)
        function _drawShotGoalStatic(fctx, x, cy, h, color, dir) {
            const goalTop = cy - h / 2;
            const goalBot = cy + h / 2;
            const endZoneStart = dir === -1 ? FIELD_LEFT : x;
            const endZoneWidth = dir === -1 ? (x - FIELD_LEFT) : (FIELD_RIGHT - x);
            const fillGrad = fctx.createLinearGradient(
                dir === -1 ? endZoneStart : endZoneStart + endZoneWidth, 0,
                dir === -1 ? endZoneStart + endZoneWidth : endZoneStart, 0
            );
            fillGrad.addColorStop(0, color + '00');
            fillGrad.addColorStop(1, color + '33');
            fctx.fillStyle = fillGrad;
            fctx.fillRect(endZoneStart, goalTop, endZoneWidth, h);
            const postLen = 24;
            fctx.strokeStyle = color;
            fctx.lineWidth = 3;
            // Top post
            fctx.beginPath();
            fctx.moveTo(x, goalTop);
            fctx.lineTo(x + dir * postLen, goalTop);
            fctx.stroke();
            // Bottom post
            fctx.beginPath();
            fctx.moveTo(x, goalBot);
            fctx.lineTo(x + dir * postLen, goalBot);
            fctx.stroke();
            // Side line
            fctx.beginPath();
            fctx.moveTo(x, goalTop);
            fctx.lineTo(x, goalBot);
            fctx.stroke();
        }
        // ────────────────────────────────────────────────────────────────────────

        function resizeGame() {
            // Keep internal resolution strictly 900x520 to match the server!
            W = 900;
            H = 520;
            canvas.width = W;
            canvas.height = H;
            updateFieldBounds();
            invalidateFieldCache();
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
        const SHOT_GOAL_H = 100;

        // ─────────────── ABILITY DEFS ───────────────
        const ALL_SKILLS = [
            { id: 'clone', icon: '🧬', name: 'Klon', cd: 9000, duration: 5000, color: '#00d4ff' },
            { id: 'slide', icon: '⚡', name: 'Kayma', cd: 5000, duration: 400, color: '#aa00ff' },
            { id: 'power', icon: '💥', name: 'Güç', cd: 9000, duration: 2000, color: '#ffd700' },
            { id: 'selfpass', icon: '🏃‍♂️', name: 'At-Kaçırt', cd: 8000, duration: 1200, color: '#00ffcc' },
            { id: 'freeze', icon: '❄️', name: 'Dondur', cd: 7000, duration: 2000, color: '#88eeff' },
            { id: 'reverse', icon: '🔀', name: 'Yön Tersle', cd: 8000, duration: 4000, color: '#ff88bb' },
            { id: 'lob', icon: '🚀', name: 'Aşırtma', cd: 7000, duration: 0, color: '#ffaa00' },
            { id: 'sloworb', icon: '🔮', name: 'Buz Küresi', cd: 9000, duration: 5000, color: '#33ffaa' },
            { id: 'geopas', icon: '📐', name: 'Geom. Pas', cd: 7000, duration: 3000, color: '#ff9900' },
            { id: 'speedboost', icon: '🏎️', name: 'Hız Boost', cd: 8000, duration: 1000, color: '#00ffff' },
            { id: 'longpass', icon: '🏹', name: 'Uzun Pas', cd: 6000, duration: 0, color: '#ff66ff' },
            { id: 'invisball', icon: '👻', name: 'Görünmez Top', cd: 10000, duration: 4000, color: '#aaa' },
            { id: 'blind', icon: '🌑', name: 'Kör Etme', cd: 12000, duration: 3000, color: '#555' },
            { id: 'shot', icon: '🎯', name: 'Şut', cd: 8000, duration: 5000, color: '#ff4400' },
            { id: 'wall', icon: '🧱', name: 'Duvar', cd: 12000, duration: 7000, color: '#ff8800' },
            { id: 'smoke', icon: '💨', name: 'Sis', cd: 11000, duration: 6000, color: '#ffffff' },
            { id: 'hook', icon: '🪝', name: 'Halat', cd: 12000, duration: 800, color: '#ffaa33' },
        ];

        const PROFILES = [
            { id: 'teknik', name: 'Teknik', icon: '🎯', color: '#00d4ff', skills: ['lob', 'geopas', 'speedboost'], slots: 3 },
            { id: 'savasci', name: 'Savaşçı', icon: '⚔️', color: '#aa00ff', skills: ['slide', 'power', 'longpass'], slots: 3 },
            { id: 'destek', name: 'Destek', icon: '🛡️', color: '#33ffaa', skills: ['reverse', 'sloworb', 'hook', 'freeze', 'invisball', 'wall', 'blind'], slots: 4 },
            { id: 'ofansif', name: 'Ofansif', icon: '🔥', color: '#ff4400', skills: ['selfpass', 'smoke', 'clone', 'shot'], slots: 3 },
        ];

        let p1Profile = null, p2Profile = null;
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
                slowOrbProjectiles: [],
                slowZones: [],
                smokeProjectiles: [],
                smokeZones: [],
                freezeProjectile: null,
                hookProjectile: null,
                foulAttempts: { p1: 0, p2: 0 },  // failed tackle attempts per player
                penaltyMode: null,  // null | { kicker: 'p1'|'p2', keeper: ..., goalX, goalY, active }
                walls: [],          // [{ side, pos, owner, life }]

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
                    longPassMode: false, longPassOwner: null,
                    shotMode: false, shotOwner: null,
                    teknikPassMode: false,
                    invisTimer: 0,
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
                        slowOrbCharging: false,
                        slowOrbChargeTimer: 0,
                        smokeCharging: false,
                        smokeChargeTimer: 0,
                        growTimer: 0,
                        shrinkTimer: 0,
                        pullingTimer: 0,
                        pulledBy: null,
                        lastDirX: 1, lastDirY: 0,
                        abilities: [],
                        speedBoostTimer: 0, geopasActive: false, geopasTimer: 0, shotActiveTimer: 0,
                        passCharging: false, passChargeMs: 0,
                        longPassCharging: false, longPassChargeMs: 0,
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
                        slowOrbCharging: false,
                        slowOrbChargeTimer: 0,
                        smokeCharging: false,
                        smokeChargeTimer: 0,
                        growTimer: 0,
                        shrinkTimer: 0,
                        pullingTimer: 0,
                        pulledBy: null,
                        lastDirX: -1, lastDirY: 0,
                        abilities: [],
                        speedBoostTimer: 0, geopasActive: false, geopasTimer: 0, shotActiveTimer: 0,
                        passCharging: false, passChargeMs: 0,
                        longPassCharging: false, longPassChargeMs: 0,
                    },
                },
            };
            gs.blindTimer = 0;
            gs.blindOwner = null;
            gs.invisBallTimer = 0;
            gs.walls = [];
        }

        // ─────────────── HUD BUILD ───────────────
        // HUD DOM referansları + son durumları cache'le — her frame getElementById ve className yazımını kes
        let __hudRefs = null;
        let __hudLast = null;
        function buildHUD() {
            __hudRefs = { p1: [], p2: [], score: [null, null], timer: null };
            __hudLast = { p1: [], p2: [], score: ['', ''], timer: '' };
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
                    __hudRefs[pid].push({
                        icon: pip.querySelector('.ability-icon'),
                        fill: pip.querySelector('.cooldown-fill'),
                    });
                    __hudLast[pid].push({ pct: -1, cls: '' });
                });
            });
            __hudRefs.score[0] = document.getElementById('score-p1');
            __hudRefs.score[1] = document.getElementById('score-p2');
            __hudRefs.timer = document.getElementById('timer-display');
        }

        function updateHUD(dt) {
            if (!__hudRefs) return;
            for (const pid of ['p1', 'p2']) {
                const abs = gs.players[pid].abilities;
                const refs = __hudRefs[pid];
                const last = __hudLast[pid];
                for (let i = 0; i < abs.length; i++) {
                    const ab = abs[i];
                    const ref = refs[i];
                    if (!ref) continue;
                    // Cooldown bar height — 1% deadband ile yaz, gereksiz reflow yapma
                    const pct = ab.cdLeft > 0 ? (ab.cdLeft / ab.cd) * 100 : 0;
                    const pctRounded = Math.round(pct);
                    if (pctRounded !== last[i].pct) {
                        ref.fill.style.height = pctRounded + '%';
                        last[i].pct = pctRounded;
                    }
                    // className — sadece DEĞİŞİNCE yaz (bu en pahalı kısımdı)
                    const cls = 'ability-icon' + (ab.cdLeft <= 0 ? ' ready' : '') + (ab.active ? ' active' : '');
                    if (cls !== last[i].cls) {
                        ref.icon.className = cls;
                        last[i].cls = cls;
                    }
                }
            }
            const s0 = String(gs.score[0]);
            const s1 = String(gs.score[1]);
            if (s0 !== __hudLast.score[0]) { __hudRefs.score[0].textContent = s0; __hudLast.score[0] = s0; }
            if (s1 !== __hudLast.score[1]) { __hudRefs.score[1].textContent = s1; __hudLast.score[1] = s1; }
            if (typeof gs.timeLeft === 'number' && __hudRefs.timer) {
                const m = Math.floor(gs.timeLeft / 60).toString().padStart(2, '0');
                const s = (gs.timeLeft % 60).toString().padStart(2, '0');
                const t = m + ':' + s;
                if (t !== __hudLast.timer) { __hudRefs.timer.textContent = t; __hudLast.timer = t; }
            }
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
            if (!particles.length) return;
            // Renk gruplarına böl: her grup için save/restore/shadowBlur bir kez
            // (her parçacık için ayrı yapınca ~20 GPU blur/frame = pahalı)
            const byColor = {};
            particles.forEach(p => {
                if (!byColor[p.color]) byColor[p.color] = [];
                byColor[p.color].push(p);
            });
            ctx.save();
            ctx.shadowBlur = 5;
            for (const color in byColor) {
                ctx.shadowColor = color;
                ctx.fillStyle = color;
                byColor[color].forEach(p => {
                    ctx.globalAlpha = p.life;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ─────────────── DEBUG EVENT LOGGER ───────────────
        const gameEventDebug = {
            enabled: true,
            logger: null
        };
        window.gameEventDebug = gameEventDebug;
        window.setGameEventLogger = function (fn) {
            gameEventDebug.logger = typeof fn === 'function' ? fn : null;
            console.log('[GAME_EVENT] custom logger', gameEventDebug.logger ? 'aktif' : 'kapali');
        };
        window.toggleGameEventLogs = function (enabled) {
            gameEventDebug.enabled = !!enabled;
            console.log('[GAME_EVENT] console logs', gameEventDebug.enabled ? 'aktif' : 'kapali');
        };

        function emitGameEvent(type, payload = {}) {
            const evt = { type, ts: Date.now(), ...payload };
            if (gameEventDebug.enabled) console.log('[GAME_EVENT]', evt);
            if (typeof gameEventDebug.logger === 'function') {
                try { gameEventDebug.logger(evt); }
                catch (err) { console.warn('[GAME_EVENT] custom logger hata:', err); }
            }
        }

        // ─────────────── FLASH MESSAGE ───────────────
        function showFlash(msg, color = '#fff') {
            const msgText = typeof msg === 'string' ? msg : String(msg ?? '');
            emitGameEvent('flash', { msg: msgText, color });
            if (msgText.includes('KAPTIRDI') || msgText.includes('ÇALDI')) {
                emitGameEvent('ball_steal', { msg: msgText, color });
            }
            if (msgText.includes('FAUL')) {
                emitGameEvent('foul', { msg: msgText, color });
            }
            const el = document.getElementById('flash-msg');
            el.textContent = msgText;
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
            if (!ab) return;

            // Wall: ön izleme aktifken her tuş 1/3'ü değiştirir (cooldown bypass)
            if (ab.id === 'wall' && p.wallPreview && p.wallPreview.active) {
                p.wallPreview.pos = (p.wallPreview.pos + 1) % 3;
                p.wallPreview.holdMs = 0;
                p.wallPreview.timeoutMs = 5000;
                const labels = ['ÜST 1/3', 'ORTA 1/3', 'ALT 1/3'];
                showFlash('🧱 ' + labels[p.wallPreview.pos], ab.color);
                spawnParticles(p.x, p.y, ab.color, 6, 2);
                return;
            }

            // Geopas: ikinci tuş yönlendirme (cooldown bypass)
            if (ab.id === 'geopas' && p.geopasActive) {
                p.geopasActive = false;
                ab.active = false;
                ab.cdLeft = ab.cd;
                const b = gs.ball;
                if (b.holder === null && !b.lobMode) {
                    const bspeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                    if (bspeed > 0.5) {
                        const goalDir = pid === 'p1' ? 1 : -1;
                        const r1vx = b.vy, r1vy = -b.vx;
                        const r2vx = -b.vy, r2vy = b.vx;
                        const useR1 = (r1vx * goalDir >= r2vx * goalDir);
                        const nvx = useR1 ? r1vx : r2vx;
                        const nvy = useR1 ? r1vy : r2vy;
                        const nlen = Math.sqrt(nvx * nvx + nvy * nvy) || 1;
                        // Yumuşak hız, bouncy (longPassMode)
                        const geoSpeed = PASS_SPEED * 0.85;
                        b.vx = (nvx / nlen) * geoSpeed;
                        b.vy = (nvy / nlen) * geoSpeed;
                        b.inAir = true;
                        b.longPassMode = true;
                        b.longPassOwner = pid;
                        b.shotMode = false; b.shotOwner = null;
                    }
                }
                spawnParticles(gs.ball.x, gs.ball.y, ab.color, 25, 7);
                showFlash('📐 SAPTIRILDI!', ab.color);
                return;
            }

            if (ab.cdLeft > 0 || p.frozenTimer > 0) return;

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
            else if (ab.id === 'hook') {
                ab.active = true;
                ab.cdLeft = ab.cd;
                gs.hookProjectile = {
                    x: p.x, y: p.y,
                    vx: p.lastDirX * 20 + p.vx * 0.5,
                    vy: p.lastDirY * 20 + p.vy * 0.5,
                    owner: pid,
                    life: 60
                };
                spawnParticles(p.x, p.y, ab.color, 15, 4);
                showFlash('🪝 HALAT!', ab.color);
            }
            else if (ab.id === 'geopas') {
                if (gs.ball.holder !== pid) { showFlash('Önce topu al!', '#888'); return; }
                ab.active = true;
                p.geopasActive = true;
                p.geopasTimer = ab.duration;
                const b = gs.ball;
                b.holder = null; b.inAir = true;
                b.vx = p.lastDirX * PASS_SPEED; b.vy = p.lastDirY * PASS_SPEED;
                b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
                b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
                spawnParticles(b.x, b.y, ab.color, 15, 4);
                showFlash('📐 GEOMETRİK PAS!', ab.color);
            }
            else if (ab.id === 'speedboost') {
                ab.active = true; ab.cdLeft = ab.cd;
                p.speedBoostTimer = ab.duration;
                spawnParticles(p.x, p.y, ab.color, 20, 6);
                showFlash('🏎️ HIZ BOOST!', ab.color);
            }
            else if (ab.id === 'longpass') {
                // Şarj akışı keydown'da startLongPassCharge ile başlatılır
                startLongPassCharge(pid);
            }
            else if (ab.id === 'invisball') {
                ab.active = true; ab.cdLeft = ab.cd;
                gs.invisBallTimer = ab.duration;
                spawnParticles(p.x, p.y, '#aaa', 15, 3);
                showFlash('👻 GÖRÜNMEZ TOP!', '#aaa');
            }
            else if (ab.id === 'blind') {
                ab.active = true; ab.cdLeft = ab.cd;
                gs.blindTimer = ab.duration; gs.blindOwner = pid;
                spawnParticles(p.x, p.y, '#555', 20, 4);
                showFlash('🌑 KÖR ETME!', '#ffffff');
            }
            else if (ab.id === 'shot') {
                if (gs.ball.holder !== pid) { showFlash('Önce topu al!', '#888'); return; }
                ab.active = true; ab.cdLeft = ab.cd;
                const b = gs.ball;
                b.holder = null;
                b.inAir = true;
                const shotSpeed = PASS_SPEED * 1.6;
                b.vx = p.lastDirX * shotSpeed;
                b.vy = p.lastDirY * shotSpeed;
                b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
                b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
                b.shotMode = true;
                b.shotOwner = pid;
                spawnParticles(b.x, b.y, ab.color, 25, 7);
                showFlash('🎯 ŞUT!', ab.color);
            }
            else if (ab.id === 'wall') {
                p.wallPreview = { active: true, pos: 0, holdMs: 0, timeoutMs: 5000 };
                ab.active = true;
                spawnParticles(p.x, p.y, ab.color, 10, 3);
                showFlash('🧱 ÜST 1/3', ab.color);
            }
        }

        function placeWall(pid) {
            const p = gs.players[pid];
            if (!p || !p.wallPreview || !p.wallPreview.active) return;
            const ab = p.abilities.find(a => a.id === 'wall');
            if (!ab) return;
            const side = (p.team || pid) === 'p1' ? 'left' : 'right';
            gs.walls = (gs.walls || []).filter(w => w.owner !== pid);
            gs.walls.push({ side, pos: p.wallPreview.pos, owner: pid, life: ab.duration });
            const wx = side === 'left' ? PLAY_LEFT : PLAY_RIGHT;
            spawnParticles(wx, H / 2, ab.color, 28, 6);
            showFlash('🧱 DUVAR YERLEŞTİ!', ab.color);
            ab.cdLeft = ab.cd;
            ab.active = false;
            p.wallPreview.active = false;
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
            p.passCharging = false;
            p.passChargeMs = 0;
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

                const ratio = Math.min(1, p.lobChargeTimer / LOB_MAX_CHARGE_MS);
                const maxDist = W * 0.85;
                const dist = 80 + ratio * maxDist;

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

        function startSlowOrbCharge(pid) {
            const p = gs.players[pid];
            const ab = p.abilities.find(a => a.id === 'sloworb');
            if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
            p.slowOrbCharging = true;
            p.slowOrbChargeTimer = 0;
        }

        function executeSlowOrb(pid) {
            const p = gs.players[pid];
            if (!p.slowOrbCharging) return;
            p.slowOrbCharging = false;
            const ab = p.abilities.find(a => a.id === 'sloworb');
            if (ab) {
                ab.cdLeft = ab.cd;
                ab.active = true;
                const ratio = Math.min(1, p.slowOrbChargeTimer / 1200);
                const throwDist = 120 + ratio * 600;
                const tx = Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, p.x + p.lastDirX * throwDist));
                const ty = Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, p.y + p.lastDirY * throwDist));

                gs.slowOrbProjectiles.push({
                    x: p.x, y: p.y,
                    startX: p.x, startY: p.y,
                    targetX: tx, targetY: ty,
                    progress: 0,
                    owner: pid,
                    duration: ab.duration
                });
                spawnParticles(p.x, p.y, ab.color, 15, 4);
                showFlash('🔮 KÜRE FIRLATILDI!', ab.color);
            }
            p.slowOrbChargeTimer = 0;
        }

        function startSmokeCharge(pid) {
            const p = gs.players[pid];
            const ab = p.abilities.find(a => a.id === 'smoke');
            if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
            p.smokeCharging = true;
            p.smokeChargeTimer = 0;
        }

        const LONG_PASS_MAX_CHARGE_MS = 1200;
        function startLongPassCharge(pid) {
            const p = gs.players[pid];
            const ab = p.abilities.find(a => a.id === 'longpass');
            if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
            if (gs.ball.holder !== pid) { showFlash('Önce topu al!', '#888'); return; }
            p.passCharging = false; p.passChargeMs = 0;
            p.lobCharging = false; p.lobChargeTimer = 0;
            p.longPassCharging = true;
            p.longPassChargeMs = 0;
            ab.active = true;
            spawnParticles(p.x, p.y, ab.color, 6, 2);
        }

        function executeLongPass(pid) {
            const p = gs.players[pid];
            if (!p.longPassCharging) return;
            p.longPassCharging = false;
            const ab = p.abilities.find(a => a.id === 'longpass');
            if (!ab) return;
            if (gs.ball.holder !== pid) {
                ab.active = false;
                p.longPassChargeMs = 0;
                return;
            }
            const ratio = Math.min(1, p.longPassChargeMs / LONG_PASS_MAX_CHARGE_MS);
            p.longPassChargeMs = 0;
            ab.cdLeft = ab.cd;
            ab.active = true;
            const b = gs.ball;
            b.holder = null;
            b.inAir = true;
            b.longPassMode = true;
            b.longPassOwner = pid;
            const lpSpeed = PASS_SPEED * (1.0 + ratio * 1.5); // 1.0x → 2.5x
            b.vx = p.lastDirX * lpSpeed;
            b.vy = p.lastDirY * lpSpeed;
            b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
            b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
            spawnParticles(b.x, b.y, ab.color, 20, 5);
            showFlash(ratio > 0.7 ? '🏹 GÜÇLÜ UZUN PAS!' : '🏹 UZUN PAS!', ab.color);
        }

        function executeSmoke(pid) {
            const p = gs.players[pid];
            if (!p.smokeCharging) return;
            p.smokeCharging = false;
            const ab = p.abilities.find(a => a.id === 'smoke');
            if (ab) {
                ab.cdLeft = ab.cd;
                ab.active = true;
                const ratio = Math.min(1, p.smokeChargeTimer / 1200);
                const throwDist = 120 + ratio * 600;
                const tx = Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, p.x + p.lastDirX * throwDist));
                const ty = Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, p.y + p.lastDirY * throwDist));

                gs.smokeProjectiles.push({
                    x: p.x, y: p.y,
                    startX: p.x, startY: p.y,
                    targetX: tx, targetY: ty,
                    progress: 0,
                    owner: pid,
                    duration: ab.duration
                });
                spawnParticles(p.x, p.y, ab.color, 15, 4);
                showFlash('💨 SİS BOMBASI!', ab.color);
            }
            p.smokeChargeTimer = 0;
        }

        // ─────────────── THROW BALL ───────────────
        function throwBall(pid) {
            const p = gs.players[pid];
            const opp = gs.players[pid === 'p1' ? 'p2' : 'p1'];
            if (gs.ball.holder !== pid) return;
            p.passCharging = false;
            p.passChargeMs = 0;
            p.longPassCharging = false;
            p.longPassChargeMs = 0;
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
            if (b.holder !== null || b.lobMode || p.frozenTimer > 0) return;
            const dx = p.x - b.x, dy = p.y - b.y;
            if (Math.sqrt(dx * dx + dy * dy) < p.r + BALL_R + 4) {
                b.holder = pid;
                b.vx = 0; b.vy = 0;
                b.inAir = false;
                b.shotMode = false; b.shotOwner = null;
                b.longPassMode = false; b.longPassOwner = null;
                b.teknikPassMode = false;
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

        // ─────────────── TACKLE / FOUL SYSTEM ───────────────
        const TACKLE_RANGE = 52;   // must be this close to attempt

        function attemptTackle(pid) {
            const b = gs.ball;
            const p = gs.players[pid];
            const oppPid = pid === 'p1' ? 'p2' : 'p1';
            const opp = gs.players[oppPid];

            if (p.frozenTimer > 0 || gs.penaltyMode) return;

            // Distance to opponent and ball
            const distToOpp = Math.hypot(opp.x - p.x, opp.y - p.y);
            const distToBall = Math.hypot(b.x - p.x, b.y - p.y);

            const isWarrior = p.profile && p.profile.id === 'savasci';

            // PRIORITY 1: Interaction with Opponent (FOUL or STEAL)
            if (distToOpp <= TACKLE_RANGE) {
                if (b.holder === oppPid) {
                    if (isWarrior) {
                        b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
                        gs.foulAttempts[pid] = 0;
                        gs.tackleCooldown = 600;
                        spawnParticles(p.x, p.y, '#aa00ff', 22, 6);
                        showFlash('⚔️ SAVAŞÇI ÇALDI!', '#aa00ff');
                        return;
                    }
                    // Ball IS held by opponent — shielding/steal logic
                    const dBallX = b.x - p.x;
                    const dBallY = b.y - p.y;
                    const dBall = Math.sqrt(dBallX * dBallX + dBallY * dBallY);

                    let carrierBlocking = false;
                    if (dBall > 1) {
                        const rayX = dBallX / dBall;
                        const rayY = dBallY / dBall;
                        const dOppX = opp.x - p.x;
                        const dOppY = opp.y - p.y;
                        const proj = dOppX * rayX + dOppY * rayY;
                        if (proj > 0 && proj < dBall) {
                            const cx = p.x + rayX * proj;
                            const cy = p.y + rayY * proj;
                            const perp = Math.hypot(cx - opp.x, cy - opp.y);
                            if (perp < opp.r * 0.85) carrierBlocking = true;
                        }
                    }

                    if (carrierBlocking) {
                        gs.foulAttempts[pid]++;
                        spawnParticles(p.x, p.y, '#ff4444', 10, 3);
                        if (gs.foulAttempts[pid] >= 2) {
                            gs.foulAttempts[pid] = 0;
                            triggerFoul(pid, oppPid);
                        } else {
                            showFlash('🚨 VÜCUT FAULÜ! (' + gs.foulAttempts[pid] + '/2)', '#ff4444');
                        }
                    } else {
                        // Success!
                        b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
                        gs.foulAttempts[pid] = 0;
                        gs.tackleCooldown = 600;
                        spawnParticles(p.x, p.y, p.color, 18, 5);
                        showFlash('🏈 KAPTIRDI!', p.color);
                    }
                } else if (isWarrior) {
                    spawnParticles(p.x, p.y, '#aa00ff', 6, 2);
                } else {
                    // Ball NOT held by opponent but you're tackling them — FOUL!
                    gs.foulAttempts[pid]++;
                    spawnParticles(p.x, p.y, '#ff4444', 10, 3);
                    if (gs.foulAttempts[pid] >= 2) {
                        gs.foulAttempts[pid] = 0;
                        triggerFoul(pid, oppPid);
                    } else {
                        showFlash('🚨 TOPSUZ ALAN FAULÜ! (' + gs.foulAttempts[pid] + '/2)', '#ff4444');
                    }
                }
                return;
            }

            // PRIORITY 2: Interaction with Free Ball (PICKUP)
            if (b.holder === null && !b.lobMode && distToBall <= p.r + BALL_R + 10) {
                pickupBall(pid);
            }
        }

        function triggerFoul(foulerPid, victimPid) {
            showFlash('🚨 FAUL! ' + (foulerPid === 'p1' ? 'Mavi' : 'Kırmızı') + ' faul yaptı!', '#ff4444');
            gs.foulAttempts = { p1: 0, p2: 0 };
            // Start penalty mode after short delay
            setTimeout(() => startPenaltyMode(victimPid, foulerPid), 1200);
        }

        function startPenaltyMode(kickerPid, keeperPid) {
            if (!gameRunning || gameOver) return;
            const kicker = gs.players[kickerPid];

            // Kicker stands in center, facing the fouler's end zone
            kicker.x = W / 2;
            kicker.y = H / 2;
            kicker.lastDirX = keeperPid === 'p1' ? -1 : 1;
            kicker.lastDirY = 0;

            // Ball held by kicker
            gs.ball.holder = kickerPid;
            gs.ball.x = kicker.x + kicker.lastDirX * (kicker.r + BALL_R + 2);
            gs.ball.y = kicker.y;
            gs.ball.vx = 0; gs.ball.vy = 0;
            gs.ball.inAir = false;

            // Green zone: random position, ~13% wide
            const greenStart = 0.12 + Math.random() * 0.65;

            const goalX = keeperPid === 'p1' ? PLAY_LEFT : PLAY_RIGHT;
            const goalY = H / 2;
            const GOAL_H = SHOT_GOAL_H;

            gs.penaltyMode = {
                kicker: kickerPid,
                keeper: keeperPid,       // fouler — speeds up the bar
                goalX, goalY, goalH: GOAL_H,
                barPos: 0,               // 0..1
                barDir: 1,
                baseSpeed: 0.0012,       // base speed
                currentSpeed: 0.0012,
                greenStart,
                greenWidth: 0.13,
                active: true,
                shot: false,
            };

            spawnParticles(W / 2, H / 2, '#ffaa00', 40, 8);
            showFlash('🏈 PENALTİ BAR!', '#ffaa00');
        }

        function updatePenaltyBar(dt) {
            const pm = gs.penaltyMode;
            if (!pm || !pm.active || pm.shot) return;

            // Opponent's tackle key speeds up the bar
            const oppKey = pm.keeper === 'p1' ? 'KeyF' : 'KeyL';
            const isHolding = keys[oppKey];

            const targetSpeed = isHolding ? pm.baseSpeed * 4 : pm.baseSpeed;
            // Smoothly interpolate speed
            pm.currentSpeed += (targetSpeed - pm.currentSpeed) * 0.1;

            pm.barPos += pm.barDir * pm.currentSpeed * dt;
            if (pm.barPos >= 1) { pm.barPos = 1; pm.barDir = -1; }
            if (pm.barPos <= 0) { pm.barPos = 0; pm.barDir = 1; }
        }

        function shootPenalty(pid) {
            const pm = gs.penaltyMode;
            if (!pm || !pm.active || pm.shot) return;
            if (pid !== pm.kicker) return;

            pm.shot = true;
            const inGreen = pm.barPos >= pm.greenStart && pm.barPos <= pm.greenStart + pm.greenWidth;

            const b = gs.ball;
            b.holder = null;
            b.inAir = true;

            // Direction towards goal
            const dx = pm.goalX - b.x;
            const dy = (inGreen ? pm.goalY : pm.goalY + (Math.random() > 0.5 ? 1 : -1) * (pm.goalH + 40)) - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const shotSpeed = 18;
            b.vx = (dx / dist) * shotSpeed;
            b.vy = (dy / dist) * shotSpeed;

            if (inGreen) {
                showFlash('🎯 MÜKEMMEL VURUŞ!', '#00ff88');
                spawnParticles(b.x, b.y, '#00ff88', 20, 5);
            } else {
                showFlash('💨 ISKALADI!', '#ff4444');
                spawnParticles(b.x, b.y, '#ff4444', 15, 3);
            }
        }

        function endPenaltyMode(scorerPid) {
            if (!gs.penaltyMode) return;
            const pm = gs.penaltyMode;
            pm.active = false; // Stop bar updates and HUD

            if (scorerPid) {
                const idx = scorerPid === 'p1' ? 0 : 1;
                gs.score[idx]++;
                spawnParticles(W / 2, H / 2, scorerPid === 'p1' ? '#00d4ff' : '#ff4d6d', 60, 8);
                showFlash(scorerPid === 'p1' ? '🔵 PENALTİ GOL! +1' : '🔴 PENALTİ GOL! +1', scorerPid === 'p1' ? '#00d4ff' : '#ff4d6d');
                document.getElementById(`score-${scorerPid}`).textContent = gs.score[idx];
                if (gs.score[idx] >= 5) { endGame(scorerPid); return; }
            } else {
                showFlash('❌ PENALTİ ISKALANDI!', '#888');
            }

            setTimeout(() => {
                gs.penaltyMode = null;
                resetRound();
            }, 1200);
        }

        // ─────────────── INPUT ───────────────
        const PASS_SPEED = 15; // px/frame for directional pass
        const NON_TEKNIK_PASS_MULT = 0.72; // teknik olmayan sınıflar için kısaltılmış menzil
        const TEKNIK_PASS_MAX_CHARGE_MS = 900;
        const LOB_MAX_CHARGE_MS = 800; // aşırtma pas: kısa basışta daha fazla menzil

        function playerIsTeknik(pid) {
            const prof = gs.players[pid] && gs.players[pid].profile;
            return prof && prof.id === 'teknik';
        }

        function directionalPass(pid) {
            const p = gs.players[pid];
            const b = gs.ball;
            if (b.holder !== pid || p.frozenTimer > 0) return;

            p.passCharging = false;
            p.passChargeMs = 0;
            b.holder = null;
            b.inAir = true;
            b.teknikPassMode = false;
            const passMult = playerIsTeknik(pid) ? 1 : NON_TEKNIK_PASS_MULT;
            b.vx = p.lastDirX * PASS_SPEED * passMult;
            b.vy = p.lastDirY * PASS_SPEED * passMult;
            // Spawn ball just outside the player's radius so auto-pickup can't immediately re-catch it
            b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
            b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
            spawnParticles(b.x, b.y, pid === 'p1' ? '#00d4ff' : '#ff4d6d', 12, 4);
            showFlash('🏈 PAS!', pid === 'p1' ? '#00d4ff' : '#ff4d6d');
        }

        function executeTeknikChargedPass(pid) {
            const p = gs.players[pid];
            const b = gs.ball;
            if (!p.passCharging || b.holder !== pid || p.frozenTimer > 0) {
                p.passCharging = false;
                p.passChargeMs = 0;
                return;
            }
            p.passCharging = false;
            const charge = Math.min(TEKNIK_PASS_MAX_CHARGE_MS, p.passChargeMs);
            p.passChargeMs = 0;
            const t = charge / TEKNIK_PASS_MAX_CHARGE_MS;
            const speedMult = 1 + t * 1.45;

            b.holder = null;
            b.inAir = true;
            b.teknikPassMode = true;
            b.longPassMode = false;
            b.longPassOwner = null;
            b.shotMode = false;
            b.shotOwner = null;
            b.vx = p.lastDirX * PASS_SPEED * speedMult;
            b.vy = p.lastDirY * PASS_SPEED * speedMult;
            b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
            b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
            spawnParticles(b.x, b.y, '#00e5ff', 18, 5);
            showFlash(t > 0.55 ? '🎯 GÜÇLÜ PAS!' : '🎯 TEKNİK PAS!', '#00e5ff');
        }

        const actionMap = {
            Space: () => {
                if (gs.penaltyMode) {
                    if (gs.penaltyMode.kicker === 'p1') shootPenalty('p1');
                    else if (gs.penaltyMode.kicker === 'p2') shootPenalty('p2');
                    return;
                }
                const h = gs.ball.holder;
                if (h && playerIsTeknik(h)) {
                    const hp = gs.players[h];
                    hp.passCharging = true;
                    hp.passChargeMs = 0;
                    return;
                }
                if (gs.ball.holder === 'p1') directionalPass('p1');
                else if (gs.ball.holder === 'p2') directionalPass('p2');
            },
            KeyF: () => {
                if (gs.penaltyMode) return; // Speed boost handled by holding key
                if (gs.ball.holder === 'p1') throwBall('p1');
                else attemptTackle('p1');
            },
            KeyL: () => {
                if (gs.penaltyMode) return; // Speed boost handled by holding key
                if (gs.ball.holder === 'p2') throwBall('p2');
                else attemptTackle('p2');
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
                    if (p1AbIdx !== -1) startAbilityByIdx('p1', p1AbIdx);
                    const p2AbIdx = gs.players.p2.abilities.findIndex(a => a.key === e.code);
                    if (p2AbIdx !== -1) startAbilityByIdx('p2', p2AbIdx);
                }
            }
        });
        document.addEventListener('keyup', e => {
            keys[e.code] = false;
            if (gameRunning && !gameOver && e.code === 'Space' && !gs.penaltyMode) {
                if (gs.players.p1.passCharging && gs.ball.holder === 'p1') executeTeknikChargedPass('p1');
                else if (gs.players.p2.passCharging && gs.ball.holder === 'p2') executeTeknikChargedPass('p2');
            }
            if (gameRunning && !gameOver) {
                const p1Idx = gs.players.p1.abilities.findIndex(a => a.key === e.code);
                if (p1Idx !== -1) releaseAbilityByIdx('p1', p1Idx);
                const p2Idx = gs.players.p2.abilities.findIndex(a => a.key === e.code);
                if (p2Idx !== -1) releaseAbilityByIdx('p2', p2Idx);
            }
        });

        // ─────────────── HELPER: ABILITY PRESS/RELEASE ───────────────
        function startAbilityByIdx(pid, idx) {
            const ab = gs.players[pid] && gs.players[pid].abilities[idx];
            if (!ab) return;
            if (ab.id === 'lob') startLobCharge(pid);
            else if (ab.id === 'sloworb') startSlowOrbCharge(pid);
            else if (ab.id === 'smoke') startSmokeCharge(pid);
            else if (ab.id === 'longpass') startLongPassCharge(pid);
            else useAbility(pid, idx);
        }
        function releaseAbilityByIdx(pid, idx) {
            const ab = gs.players[pid] && gs.players[pid].abilities[idx];
            if (!ab) return;
            const p = gs.players[pid];
            if (ab.id === 'lob' && p.lobCharging) executeLobPass(pid);
            if (ab.id === 'sloworb' && p.slowOrbCharging) executeSlowOrb(pid);
            if (ab.id === 'smoke' && p.smokeCharging) executeSmoke(pid);
            if (ab.id === 'longpass' && p.longPassCharging) executeLongPass(pid);
        }

        // ─────────────── GAMEPAD INPUT ───────────────
        const gpPrevButtons = { p1: [], p2: [] };

        function pollGamepadActions() {
            if (!gameRunning || gameOver) return;
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

            ['p1', 'p2'].forEach((pid, index) => {
                const gp = gamepads[index];
                if (!gp || !gp.connected) return;
                const p = gs.players[pid];
                if (!p) return;

                const prev = gpPrevButtons[pid];
                const pressed = (btnIdx) => gp.buttons[btnIdx] && gp.buttons[btnIdx].pressed;
                const justPressed = (btnIdx) => pressed(btnIdx) && !prev[btnIdx];
                const justReleased = (btnIdx) => !pressed(btnIdx) && prev[btnIdx];

                // Button 0 (A/Cross): Pass / Shoot Penalty
                if (justPressed(0)) {
                    if (gs.penaltyMode) {
                        if (gs.penaltyMode.kicker === pid) shootPenalty(pid);
                    } else if (gs.ball.holder === pid) {
                        if (playerIsTeknik(pid)) {
                            p.passCharging = true;
                            p.passChargeMs = 0;
                        } else {
                            directionalPass(pid);
                        }
                    }
                }
                if (justReleased(0)) {
                    if (!gs.penaltyMode && gs.ball.holder === pid && p.passCharging && playerIsTeknik(pid)) {
                        executeTeknikChargedPass(pid);
                    }
                }

                // Button 2 (X/Square): Throw/Pickup
                if (justPressed(2)) {
                    if (gs.ball.holder === pid) throwBall(pid);
                    else attemptTackle(pid);
                }

                // Button 4 (L1/LB): Ability 1
                if (justPressed(4)) startAbilityByIdx(pid, 0);
                if (justReleased(4)) releaseAbilityByIdx(pid, 0);

                // Button 5 (R1/RB): Ability 2
                if (justPressed(5)) startAbilityByIdx(pid, 1);
                if (justReleased(5)) releaseAbilityByIdx(pid, 1);

                // Button 3 (Y/Triangle): Ability 3
                if (justPressed(3)) startAbilityByIdx(pid, 2);
                if (justReleased(3)) releaseAbilityByIdx(pid, 2);

                // Button 1 (B/Circle): Ability 4 (Destek 4. skill için)
                if (justPressed(1) && gs.players[pid].abilities[3]) startAbilityByIdx(pid, 3);
                if (justReleased(1) && gs.players[pid].abilities[3]) releaseAbilityByIdx(pid, 3);

                // Update prev states
                for (let i = 0; i < gp.buttons.length; i++) {
                    prev[i] = pressed(i);
                }
            });
        }

        // ─────────────── PHYSICS UPDATE ───────────────
        function updatePlayer(pid, dt) {
            const p = gs.players[pid];
            const frameScale = Math.max(0.5, Math.min(3, dt / (1000 / 60)));

            // cooldowns
            p.abilities.forEach(ab => {
                if (ab.cdLeft > 0) ab.cdLeft -= dt;
                else { ab.cdLeft = 0; ab.active = false; }
            });

            if (p.frozenTimer > 0) {
                p.frozenTimer -= dt;
                return;
            }

            // No movement during penalty mode
            if (gs.penaltyMode && gs.penaltyMode.active) return;
            if (p.pullingTimer > 0) {
                p.pullingTimer -= dt;
                const owner = gs.players[p.pulledBy];
                if (owner) {
                    const dx = owner.x - p.x;
                    const dy = owner.y - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 30) {
                        const pullSpeed = 0.35 * dt;
                        p.vx = (dx / dist) * pullSpeed;
                        p.vy = (dy / dist) * pullSpeed;
                        p.x += p.vx;
                        p.y += p.vy;
                        clampPlayer(p);
                        // Also update ball if held
                        if (gs.ball.holder === pid) {
                            gs.ball.x = p.x + p.lastDirX * (p.r * 0.7);
                            gs.ball.y = p.y + p.lastDirY * (p.r * 0.7);
                        }
                    }
                }
                if (p.pullingTimer <= 0) p.pulledBy = null;
                return;
            }

            // Reset radius to base
            p.r = PLAYER_R;

            // Speed boost decay
            if (p.speedBoostTimer > 0) p.speedBoostTimer -= dt;

            // Shot active decay
            if (p.shotActiveTimer > 0) p.shotActiveTimer -= dt;

            // Geopas second-press window
            if (p.geopasActive && p.geopasTimer > 0) {
                p.geopasTimer -= dt;
                if (p.geopasTimer <= 0) {
                    p.geopasActive = false;
                    const gab = p.abilities.find(a => a.id === 'geopas');
                    if (gab && gab.active) { gab.active = false; gab.cdLeft = gab.cd; }
                }
            }

            // Wall: hold-to-place detection
            if (p.wallPreview && p.wallPreview.active) {
                const wAb = p.abilities.find(a => a.id === 'wall');
                if (wAb) {
                    p.wallPreview.timeoutMs -= dt;
                    if (keys[wAb.key]) {
                        p.wallPreview.holdMs += dt;
                        if (p.wallPreview.holdMs >= 380) {
                            placeWall(pid);
                        }
                    } else {
                        p.wallPreview.holdMs = 0;
                    }
                    if (p.wallPreview && p.wallPreview.active && p.wallPreview.timeoutMs <= 0) {
                        p.wallPreview.active = false;
                        wAb.active = false;
                    }
                }
            }

            // Teknik pas şarjı (Space veya gamepad A basılı kaldıkça menzil artar)
            if (p.passCharging) {
                if (gs.ball.holder !== pid || gs.penaltyMode || !playerIsTeknik(pid)) {
                    p.passCharging = false;
                    p.passChargeMs = 0;
                } else {
                    const gpIdx = pid === 'p1' ? 0 : 1;
                    const gp = navigator.getGamepads ? navigator.getGamepads()[gpIdx] : null;
                    const btnHeld = !!(gp && gp.buttons && gp.buttons[0] && gp.buttons[0].pressed);
                    if (keys['Space'] || btnHeld) {
                        p.passChargeMs = Math.min(TEKNIK_PASS_MAX_CHARGE_MS, p.passChargeMs + dt);
                    }
                }
            }

            // slide
            if (p.slideTimer > 0) {
                p.slideTimer -= dt;
                p.x += p.slideVx * frameScale;
                p.y += p.slideVy * frameScale;
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

            let inSlowZone = false;
            gs.slowZones.forEach(z => {
                if (Math.hypot(p.x - z.x, p.y - z.y) < z.radius) {
                    inSlowZone = true;
                    if (Math.random() < 0.1) spawnParticles(p.x, p.y + Math.random() * 20 - 10, '#33ffaa', 1, 2);
                }
            });
            const zoneSlow = inSlowZone ? 0.35 : 1.0;

            // Scale speed: bigger = slower, smaller = faster
            const speedBoostMod = p.speedBoostTimer > 0 ? 1.9 : 1.0;
            const isOfansif = p.profile && p.profile.id === 'ofansif';
            const profileSpeedMod = isOfansif ? 1.1 : 1.0;
            // Ofansif: top tutarken yavaşlamaz
            const ballHoldMod = (gs.ball.holder === pid && !isOfansif) ? 0.8 : 1;
            const speed = PLAYER_SPEED * ballHoldMod * (p.poweredTimer > 0 ? 1.4 : 1) * zoneSlow * speedBoostMod * profileSpeedMod;

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

            // Ters kontrol yeteneği etki ediyorsa yönleri tersle
            if (p.controlsReversedTimer > 0) {
                dx = -dx;
                dy = -dy;
                p.controlsReversedTimer -= dt;
            }

            // (p.facing kaldırıldı, yerine lastDirX/Y kullanılıyor)

            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dx !== 0 || dy !== 0) {
                const moveStep = speed * frameScale;
                p.x += (dx / len) * moveStep;
                p.y += (dy / len) * moveStep;
                p.lastDirX = dx / len;
                p.lastDirY = dy / len;
                // Move clones in perfect sync with real player
                p.clones.forEach(c => {
                    c.x += (dx / len) * moveStep;
                    c.y += (dy / len) * moveStep;
                    c.x = Math.max(FIELD_LEFT + PLAYER_R, Math.min(FIELD_RIGHT - PLAYER_R, c.x));
                    c.y = Math.max(FIELD_TOP + PLAYER_R, Math.min(FIELD_BOTTOM - PLAYER_R, c.y));
                });
            }

            // Clone lifetime decay
            p.clones = p.clones.filter(c => { c.life -= dt; return c.life > 0; });

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
                const rate = (W * 0.85) / LOB_MAX_CHARGE_MS;
                let dynamicMaxTime = (distToEdge - 30) / rate;
                dynamicMaxTime = Math.max(200, Math.min(LOB_MAX_CHARGE_MS, dynamicMaxTime));

                if (p.lobChargeTimer > dynamicMaxTime) {
                    p.lobCharging = false;
                    p.lobChargeTimer = 0;
                    const lobAb = p.abilities.find(a => a.id === 'lob');
                    if (lobAb) lobAb.cdLeft = lobAb.cd;
                    spawnParticles(p.x, p.y, '#555', 15, 3);
                    showFlash('❌ ALAN BİTTİ!', '#888');
                }
            }

            if (p.slowOrbCharging) {
                p.slowOrbChargeTimer += dt;
                let tx = 99999, ty = 99999;
                if (p.lastDirX < 0) tx = (p.x - FIELD_LEFT) / -p.lastDirX;
                else if (p.lastDirX > 0) tx = (FIELD_RIGHT - p.x) / p.lastDirX;
                if (p.lastDirY < 0) ty = (p.y - FIELD_TOP) / -p.lastDirY;
                else if (p.lastDirY > 0) ty = (FIELD_BOTTOM - p.y) / p.lastDirY;
                const distToEdge = Math.max(0, Math.min(tx, ty));
                const rate = (W * 0.85) / 1200;
                let dynamicMaxTime = (distToEdge - 30) / rate;
                dynamicMaxTime = Math.max(350, Math.min(1200, dynamicMaxTime));

                if (p.slowOrbChargeTimer > dynamicMaxTime) {
                    p.slowOrbCharging = false;
                    p.slowOrbChargeTimer = 0;
                    const orbAb = p.abilities.find(a => a.id === 'sloworb');
                    if (orbAb) orbAb.cdLeft = orbAb.cd;
                    spawnParticles(p.x, p.y, '#555', 15, 3);
                    showFlash('❌ KÜRE BİTTİ!', '#888');
                }
            }

            // Long pass charging
            if (p.longPassCharging) {
                if (gs.ball.holder !== pid || gs.penaltyMode) {
                    p.longPassCharging = false;
                    p.longPassChargeMs = 0;
                    const lpAb = p.abilities.find(a => a.id === 'longpass');
                    if (lpAb) lpAb.active = false;
                } else {
                    p.longPassChargeMs = Math.min(LONG_PASS_MAX_CHARGE_MS, p.longPassChargeMs + dt);
                    if (p.longPassChargeMs >= LONG_PASS_MAX_CHARGE_MS) {
                        executeLongPass(pid);
                    }
                }
            }

            if (p.smokeCharging) {
                p.smokeChargeTimer += dt;
                let tx = 99999, ty = 99999;
                if (p.lastDirX < 0) tx = (p.x - FIELD_LEFT) / -p.lastDirX;
                else if (p.lastDirX > 0) tx = (FIELD_RIGHT - p.x) / p.lastDirX;
                if (p.lastDirY < 0) ty = (p.y - FIELD_TOP) / -p.lastDirY;
                else if (p.lastDirY > 0) ty = (FIELD_BOTTOM - p.y) / p.lastDirY;
                const distToEdge = Math.max(0, Math.min(tx, ty));
                const rate = (W * 0.85) / 1200;
                let dynamicMaxTime = (distToEdge - 30) / rate;
                dynamicMaxTime = Math.max(350, Math.min(1200, dynamicMaxTime));

                if (p.smokeChargeTimer > dynamicMaxTime) {
                    p.smokeCharging = false;
                    p.smokeChargeTimer = 0;
                    const smokeAb = p.abilities.find(a => a.id === 'smoke');
                    if (smokeAb) smokeAb.cdLeft = smokeAb.cd;
                    spawnParticles(p.x, p.y, '#555', 15, 3);
                    showFlash('❌ SİS BİTTİ!', '#888');
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

            // No friction during penalty shot, long pass mode, or shot mode
            if (!(gs.penaltyMode && gs.penaltyMode.shot) && !b.longPassMode && !b.shotMode) {
                b.vx *= BALL_FRICTION;
                b.vy *= BALL_FRICTION;
            }

            // wall bounce — elastic with 0.82 restitution for satisfying feel
            // Skip bounce during penalty shot so ball can enter net area properly
            if (!(gs.penaltyMode && gs.penaltyMode.shot)) {
                const clearFastModes = () => {
                    if (b.longPassMode) { b.longPassMode = false; b.longPassOwner = null; }
                    if (b.shotMode) { b.shotMode = false; b.shotOwner = null; }
                    if (b.teknikPassMode) b.teknikPassMode = false;
                };
                if (b.x - BALL_R < FIELD_LEFT) { b.x = FIELD_LEFT + BALL_R; b.vx *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); clearFastModes(); }
                if (b.x + BALL_R > FIELD_RIGHT) { b.x = FIELD_RIGHT - BALL_R; b.vx *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); clearFastModes(); }
                if (b.y - BALL_R < FIELD_TOP) { b.y = FIELD_TOP + BALL_R; b.vy *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); clearFastModes(); }
                if (b.y + BALL_R > FIELD_BOTTOM) { b.y = FIELD_BOTTOM - BALL_R; b.vy *= -0.82; spawnParticles(b.x, b.y, '#ffee00', 5, 2); clearFastModes(); }
            }

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

                // Powered player knocks ball loose on contact + stuns opponent
                if (gs.tackleCooldown <= 0) {
                    if (p1.poweredTimer > 0 && b.holder === 'p2') {
                        b.holder = null; b.vx = nx * 6; b.vy = ny * 6; b.inAir = true;
                        gs.tackleCooldown = 800;
                        spawnParticles(p2.x, p2.y, '#ffd700', 20, 6);
                        showFlash('🔥 YIKILDI!', '#ffd700');
                    } else if (p2.poweredTimer > 0 && b.holder === 'p1') {
                        b.holder = null; b.vx = -nx * 6; b.vy = -ny * 6; b.inAir = true;
                        gs.tackleCooldown = 800;
                        spawnParticles(p1.x, p1.y, '#ffd700', 20, 6);
                        showFlash('🔥 YIKILDI!', '#ffd700');
                    }
                    // Güç skilli: temasa sersemletme (donma'dan kısa süreli)
                    const POWER_STUN_MS = 1000;
                    if (p1.poweredTimer > 0 && p2.frozenTimer <= 0) {
                        p2.frozenTimer = POWER_STUN_MS;
                        if (b.holder === 'p2') { b.holder = null; b.shotMode = false; b.shotOwner = null; b.vx = nx * 3; b.vy = ny * 3; b.inAir = true; }
                        gs.tackleCooldown = 700;
                        spawnParticles(p2.x, p2.y, '#ffd700', 12, 4);
                        showFlash('🥴 SERSEM!', '#ffd700');
                    } else if (p2.poweredTimer > 0 && p1.frozenTimer <= 0) {
                        p1.frozenTimer = POWER_STUN_MS;
                        if (b.holder === 'p1') { b.holder = null; b.shotMode = false; b.shotOwner = null; b.vx = -nx * 3; b.vy = -ny * 3; b.inAir = true; }
                        gs.tackleCooldown = 700;
                        spawnParticles(p1.x, p1.y, '#ffd700', 12, 4);
                        showFlash('🥴 SERSEM!', '#ffd700');
                    }
                }
            }

            // Shot skill: ball must collide with players and briefly stun on hit.
            if (b.shotMode && b.holder === null && !b.lobMode) {
                const SHOT_STUN_MS = 700;
                const ownerTeam = gs.players[b.shotOwner] ? gs.players[b.shotOwner].team : null;
                const shotPlayers = Object.keys(gs.players);
                for (const pid of shotPlayers) {
                    const p = gs.players[pid];
                    if (!p || p.frozenTimer > 0) continue;
                    if (ownerTeam && p.team === ownerTeam) continue;
                    const sx = b.x - p.x, sy = b.y - p.y;
                    const hitDist = p.r + BALL_R;
                    if (Math.sqrt(sx * sx + sy * sy) < hitDist) {
                        p.frozenTimer = SHOT_STUN_MS;
                        let nx = sx, ny = sy;
                        const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
                        nx /= nlen; ny /= nlen;
                        const dot = b.vx * nx + b.vy * ny;
                        b.vx = (b.vx - 2 * dot * nx) * 0.75;
                        b.vy = (b.vy - 2 * dot * ny) * 0.75;
                        b.x = p.x + nx * (hitDist + 1);
                        b.y = p.y + ny * (hitDist + 1);
                        b.shotMode = false; b.shotOwner = null;
                        b.longPassMode = false; b.longPassOwner = null;
                        b.teknikPassMode = false;
                        b.inAir = true;
                        spawnParticles(p.x, p.y, '#ff6600', 22, 5);
                        showFlash('💥 ŞUT ÇARPTI! SERSEM!', '#ff6600');
                        break;
                    }
                }
            }

            // Teknik şarjlı pas: ilk temas eden (donmamış) oyuncu topu yakalar
            if (b.teknikPassMode && b.holder === null && !b.lobMode) {
                const pKeys = Object.keys(gs.players);
                for (const pid of pKeys) {
                    const pl = gs.players[pid];
                    if (pl.frozenTimer > 0) continue;
                    const pdx = b.x - pl.x, pdy = b.y - pl.y;
                    if (Math.sqrt(pdx * pdx + pdy * pdy) < pl.r + BALL_R + 4) {
                        b.holder = pid;
                        b.vx = 0; b.vy = 0;
                        b.inAir = false;
                        b.teknikPassMode = false;
                        b.shotMode = false; b.shotOwner = null;
                        b.longPassMode = false; b.longPassOwner = null;
                        spawnParticles(pl.x, pl.y, pl.color, 16, 4);
                        showFlash('🎯 KONTROLLÜ PAS!', '#00e5ff');
                        break;
                    }
                }
            }

            // Long pass ball-player collision
            if (b.longPassMode) {
                const lpPlayers = ['p1', 'p2'];
                for (const pid of lpPlayers) {
                    if (pid === b.longPassOwner) continue;
                    const p = gs.players[pid];
                    const ldx = b.x - p.x, ldy = b.y - p.y;
                    const ldist = Math.sqrt(ldx * ldx + ldy * ldy);
                    if (ldist < p.r + BALL_R + 4) {
                        const ownerPlayer = gs.players[b.longPassOwner];
                        if (ownerPlayer && ownerPlayer.team === p.team) {
                            b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
                            b.longPassMode = false; b.longPassOwner = null;
                            b.shotMode = false; b.shotOwner = null;
                            spawnParticles(p.x, p.y, p.color, 15, 4);
                            showFlash('🏹 YAKALADIM!', p.color);
                        } else {
                            const lnx = ldist > 0 ? ldx / ldist : 1;
                            const lny = ldist > 0 ? ldy / ldist : 0;
                            const bspd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                            b.vx = lnx * bspd * 0.75; b.vy = lny * bspd * 0.75;
                            b.longPassMode = false; b.longPassOwner = null;
                            spawnParticles(p.x, p.y, '#ff66ff', 15, 5);
                            showFlash('🏹 ENGELLENDİ!', '#ff66ff');
                        }
                        break;
                    }
                }
            }

            // Auto-pickup: only when ball is free AND nearly stationary (prevents catching a thrown/passed ball)
            const ballSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (ballSpeed < 2) {
                ['p1', 'p2'].forEach(pid => {
                    const p = gs.players[pid];
                    if (b.holder === null && !b.lobMode && p.frozenTimer <= 0) {
                        const bx = b.x - p.x, by = b.y - p.y;
                        if (Math.sqrt(bx * bx + by * by) < p.r + BALL_R) {
                            b.holder = pid;
                            b.vx = 0; b.vy = 0;
                            b.inAir = false;
                            b.shotMode = false; b.shotOwner = null;
                            b.longPassMode = false; b.longPassOwner = null;
                            b.teknikPassMode = false;
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
                if (Math.sqrt(fdx * fdx + fdy * fdy) < target.r + 6) {
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

            // Hook projectile
            if (gs.hookProjectile) {
                const hp = gs.hookProjectile;
                hp.x += hp.vx;
                hp.y += hp.vy;
                hp.life--;

                const targetPid = hp.owner === 'p1' ? 'p2' : 'p1';
                const target = gs.players[targetPid];
                const owner = gs.players[hp.owner];
                const hdx = hp.x - target.x, hdy = hp.y - target.y;
                if (Math.sqrt(hdx * hdx + hdy * hdy) < target.r + 6) {
                    target.pullingTimer = 800; // Skill duration
                    target.pulledBy = hp.owner;
                    // If target was holding the ball, they might lose it
                    if (gs.ball.holder === targetPid) {
                        gs.ball.holder = null;
                        gs.ball.vx = (owner.x - target.x) * 0.05;
                        gs.ball.vy = (owner.y - target.y) * 0.05;
                    }
                    spawnParticles(target.x, target.y, '#ffaa33', 20, 5);
                    showFlash('🪝 YAKALANDI!', '#ffaa33');
                    gs.hookProjectile = null;
                }

                if (hp && (hp.life <= 0 || hp.x < FIELD_LEFT || hp.x > FIELD_RIGHT || hp.y < FIELD_TOP || hp.y > FIELD_BOTTOM)) {
                    gs.hookProjectile = null;
                }
            }

            // Update slow orbs
            for (let i = gs.slowOrbProjectiles.length - 1; i >= 0; i--) {
                const orb = gs.slowOrbProjectiles[i];
                orb.progress += 0.025;
                if (orb.progress >= 1) {
                    gs.slowZones.push({
                        x: orb.targetX, y: orb.targetY,
                        radius: 110, life: orb.duration, owner: orb.owner
                    });
                    spawnParticles(orb.targetX, orb.targetY, '#33ffaa', 30, 6);
                    showFlash('🔮 ALAN OLUŞTU!', '#33ffaa');
                    gs.slowOrbProjectiles.splice(i, 1);
                } else {
                    const t = orb.progress;
                    const mx = (orb.startX + orb.targetX) / 2;
                    const my = Math.min(orb.startY, orb.targetY) - 150;
                    orb.x = (1 - t) * (1 - t) * orb.startX + 2 * (1 - t) * t * mx + t * t * orb.targetX;
                    orb.y = (1 - t) * (1 - t) * orb.startY + 2 * (1 - t) * t * my + t * t * orb.targetY;
                }
            }

            // Update slow zones
            gs.slowZones = gs.slowZones.filter(z => { z.life -= dt; return z.life > 0; });

            // Update smoke orbs
            for (let i = gs.smokeProjectiles.length - 1; i >= 0; i--) {
                const orb = gs.smokeProjectiles[i];
                orb.progress += 0.022; // slightly different speed
                if (orb.progress >= 1) {
                    gs.smokeZones.push({
                        x: orb.targetX, y: orb.targetY,
                        radius: 145, life: orb.duration, owner: orb.owner
                    });
                    spawnParticles(orb.targetX, orb.targetY, '#fff', 30, 8);
                    gs.smokeProjectiles.splice(i, 1);
                } else {
                    const t = orb.progress;
                    orb.x = orb.startX + (orb.targetX - orb.startX) * t;
                    orb.y = orb.startY + (orb.targetY - orb.startY) * t;
                }
            }
            // Update smoke zones
            gs.smokeZones = gs.smokeZones.filter(z => { z.life -= dt; return z.life > 0; });

            // Ball hits clone -> Teleportation (Substitution Jutsu)
            ['p1', 'p2'].forEach(pid => {
                const p = gs.players[pid];
                const opp = gs.players[pid === 'p1' ? 'p2' : 'p1'];
                if (b.holder === null && !b.lobMode && p.clones.length > 0 && p.frozenTimer <= 0) {
                    for (let i = 0; i < p.clones.length; i++) {
                        const c = p.clones[i];
                        const distX = b.x - c.x;
                        const distY = b.y - c.y;
                        if (Math.sqrt(distX * distX + distY * distY) < p.r + BALL_R + 8) {
                            // Swap Player and the Clone
                            const oldX = p.x;
                            const oldY = p.y;
                            p.x = c.x;
                            p.y = c.y;
                            c.x = oldX;
                            c.y = oldY;

                            // Player catches the ball
                            b.holder = pid;
                            b.vx = 0;
                            b.vy = 0;
                            b.inAir = false;

                            spawnParticles(p.x, p.y, '#ffffff', 40, 8);
                            showFlash('💫 YER DEĞİŞTİRME!', p.color);
                            break;
                        }
                    }
                }

                // Clone vs Opponent collision — pop fake clone on touch
                p.clones = p.clones.filter(c => {
                    const cdx = opp.x - c.x, cdy = opp.y - c.y;
                    if (Math.sqrt(cdx * cdx + cdy * cdy) < p.r + opp.r + 2) {
                        spawnParticles(c.x, c.y, p.color, 18, 5);
                        showFlash('👻 HAYALET!', p.color);
                        return false;
                    }
                    return true;
                });
            });
        }

        function checkGoal() {
            const b = gs.ball;

            // Penalty mode: detect if shot entered the goal
            if (gs.penaltyMode && gs.penaltyMode.shot && gs.penaltyMode.active) {
                const pm = gs.penaltyMode;
                // If ball crossed the goal line
                const crossed = pm.keeper === 'p1' ? (b.x < pm.goalX) : (b.x > pm.goalX);
                if (crossed) {
                    const hit = Math.abs(b.y - pm.goalY) < pm.goalH / 2;
                    if (hit) {
                        endPenaltyMode(pm.kicker);
                    } else {
                        endPenaltyMode(null);
                    }
                    return;
                }
                // If ball went out of bounds or stopped
                if (b.x < FIELD_LEFT || b.x > FIELD_RIGHT || b.y < FIELD_TOP || b.y > FIELD_BOTTOM || (Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5)) {
                    endPenaltyMode(null);
                    return;
                }
                return;
            }
            if (gs.penaltyMode) return;

            // SAYIM KURALI: sadece topla birlikte end zone'a giren oyuncu sayı yapabilir
            let scorer = null;

            ['p1', 'p2'].forEach(pid => {
                const p = gs.players[pid];
                if (b.holder === pid) {
                    if (pid === 'p1' && p.x > PLAY_RIGHT) {
                        const wblock = (gs.walls || []).find(w => w.side === 'right' && yInWallSegment(p.y, w.pos));
                        if (wblock) {
                            p.x = PLAY_RIGHT - p.r - 2;
                            wblock.life = Math.max(0, wblock.life - 500);
                            spawnParticles(p.x, p.y, '#ff8800', 12, 4);
                        } else {
                            scorer = 'p1';
                        }
                    }
                    if (pid === 'p2' && p.x < PLAY_LEFT) {
                        const wblock = (gs.walls || []).find(w => w.side === 'left' && yInWallSegment(p.y, w.pos));
                        if (wblock) {
                            p.x = PLAY_LEFT + p.r + 2;
                            wblock.life = Math.max(0, wblock.life - 500);
                            spawnParticles(p.x, p.y, '#ff8800', 12, 4);
                        } else {
                            scorer = 'p2';
                        }
                    }
                }
            });

            // Şut modu: küçük kaleye girerse gol, ıskalarsa gol çizgisinden seker
            if (b.shotMode && b.shotOwner && b.holder === null && !b.lobMode) {
                const goalTopY = H / 2 - SHOT_GOAL_H / 2;
                const goalBotY = H / 2 + SHOT_GOAL_H / 2;
                const inGoalY = b.y > goalTopY && b.y < goalBotY;
                if (b.shotOwner === 'p1' && b.x + BALL_R > PLAY_RIGHT) {
                    if (inGoalY) {
                        const blocker = (gs.walls || []).find(w => w.side === 'right' && yInWallSegment(b.y, w.pos));
                        if (blocker) {
                            b.x = PLAY_RIGHT - BALL_R - 4; b.vx = -Math.abs(b.vx) * 0.85;
                            b.shotMode = false; b.shotOwner = null;
                            blocker.life = Math.max(0, blocker.life - 1500);
                            spawnParticles(b.x, b.y, '#ff8800', 22, 6);
                            showFlash('🛡️ DUVAR ENGELLEDİ!', '#ff8800');
                        } else {
                            scorer = 'p1';
                        }
                    } else {
                        b.x = PLAY_RIGHT - BALL_R; b.vx = -Math.abs(b.vx) * 0.75;
                        b.shotMode = false; b.shotOwner = null;
                        spawnParticles(b.x, b.y, '#ff4444', 14, 4);
                        showFlash('💨 ISKA!', '#ff4444');
                    }
                } else if (b.shotOwner === 'p2' && b.x - BALL_R < PLAY_LEFT) {
                    if (inGoalY) {
                        const blocker = (gs.walls || []).find(w => w.side === 'left' && yInWallSegment(b.y, w.pos));
                        if (blocker) {
                            b.x = PLAY_LEFT + BALL_R + 4; b.vx = Math.abs(b.vx) * 0.85;
                            b.shotMode = false; b.shotOwner = null;
                            blocker.life = Math.max(0, blocker.life - 1500);
                            spawnParticles(b.x, b.y, '#ff8800', 22, 6);
                            showFlash('🛡️ DUVAR ENGELLEDİ!', '#ff8800');
                        } else {
                            scorer = 'p2';
                        }
                    } else {
                        b.x = PLAY_LEFT + BALL_R; b.vx = Math.abs(b.vx) * 0.75;
                        b.shotMode = false; b.shotOwner = null;
                        spawnParticles(b.x, b.y, '#ff4444', 14, 4);
                        showFlash('💨 ISKA!', '#ff4444');
                    }
                }
            }

            // Serbest top end zone çizgisine girerse geri sektirilir (şut modu yoksa)
            if (b.holder === null && !b.lobMode && !b.shotMode) {
                if (b.x - BALL_R < PLAY_LEFT) {
                    b.x = PLAY_LEFT + BALL_R; b.vx = Math.abs(b.vx) * 0.75;
                    if (b.longPassMode) { b.longPassMode = false; b.longPassOwner = null; }
                }
                if (b.x + BALL_R > PLAY_RIGHT) {
                    b.x = PLAY_RIGHT - BALL_R; b.vx = -Math.abs(b.vx) * 0.75;
                    if (b.longPassMode) { b.longPassMode = false; b.longPassOwner = null; }
                }
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
            b.longPassMode = false; b.longPassOwner = null;
            b.shotMode = false; b.shotOwner = null;
            b.teknikPassMode = false;
            b.invisTimer = 0;

            ['p1', 'p2'].forEach(pid => {
                const p = gs.players[pid];
                p.x = pid === 'p1' ? PLAY_LEFT + 60 : PLAY_RIGHT - 60;
                p.y = H / 2;
                p.frozenTimer = 0;
                p.poweredTimer = 0;
                p.slideTimer = 0;
                p.selfPassCdLeft = 0;
                p.lobCharging = false;
                p.lobChargeTimer = 0;
                p.slowOrbCharging = false;
                p.slowOrbChargeTimer = 0;
                p.smokeCharging = false;
                p.smokeChargeTimer = 0;
                p.growTimer = 0;
                p.shrinkTimer = 0;
                p.pullingTimer = 0;
                p.pulledBy = null;
                p.r = PLAYER_R;
                p.clones = [];
                p.controlsReversedTimer = 0;
                p.speedBoostTimer = 0;
                p.geopasActive = false;
                p.geopasTimer = 0;
                p.shotActiveTimer = 0;
                p.passCharging = false;
                p.passChargeMs = 0;
                p.longPassCharging = false;
                p.longPassChargeMs = 0;
                if (p.wallPreview) p.wallPreview.active = false;
            });

            gs.freezeProjectile = null;
            gs.hookProjectile = null;
            gs.slowOrbProjectiles = [];
            gs.slowZones = [];
            gs.smokeProjectiles = [];
            gs.smokeZones = [];
            gs.foulAttempts = { p1: 0, p2: 0 };
            gs.penaltyMode = null;
            gs.blindTimer = 0;
            gs.blindOwner = null;
            gs.invisBallTimer = 0;
            gs.walls = [];
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
            // Statik saha: offscreen cache'den tek drawImage — gradient/stroke loop yok
            ensureFieldCache();
            ctx.drawImage(__fieldCanvas, 0, 0);

            // ── PENALTY GOAL (dinamik — pulse efekti var, cache'lenemez) ──
            if (gs.penaltyMode && gs.penaltyMode.active) {
                const pm = gs.penaltyMode;
                const gx = pm.goalX;
                const gy = pm.goalY;
                const gh = pm.goalH;
                const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);

                ctx.save();
                // Glow
                ctx.shadowColor = '#ffaa00';
                ctx.shadowBlur = 30 * pulse;
                // Goal posts (American football style)
                ctx.strokeStyle = `rgba(255,170,0,${0.8 + 0.2 * pulse})`;
                ctx.lineWidth = 5;
                // Crossbar
                ctx.beginPath();
                ctx.moveTo(pm.keeper === 'p1' ? gx - 20 : gx + 20, gy - gh / 2);
                ctx.lineTo(pm.keeper === 'p1' ? gx - 20 : gx + 20, gy + gh / 2);
                ctx.stroke();
                // Top post
                ctx.beginPath();
                ctx.moveTo(pm.keeper === 'p1' ? gx - 20 : gx + 20, gy - gh / 2);
                ctx.lineTo(pm.keeper === 'p1' ? gx - 40 : gx + 40, gy - gh / 2 - 30);
                ctx.stroke();
                // Bottom post
                ctx.beginPath();
                ctx.moveTo(pm.keeper === 'p1' ? gx - 20 : gx + 20, gy + gh / 2);
                ctx.lineTo(pm.keeper === 'p1' ? gx - 40 : gx + 40, gy + gh / 2 + 30);
                ctx.stroke();
                // Fill zone
                ctx.globalAlpha = 0.15 * pulse;
                ctx.fillStyle = '#ffaa00';
                ctx.fillRect(
                    pm.keeper === 'p1' ? FIELD_LEFT : gx,
                    gy - gh / 2,
                    pm.keeper === 'p1' ? gx - FIELD_LEFT : FIELD_RIGHT - gx,
                    gh
                );
                ctx.globalAlpha = 1;
                // Label
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#ffaa00';
                ctx.font = 'bold 14px Orbitron, monospace';
                ctx.textAlign = 'center';
                ctx.fillText('PENALTİ KALE', gx, gy - gh / 2 - 40);
                ctx.restore();
            }

            // Field border
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP, 12);
            ctx.stroke();
        }

        // Helper: draw the always-visible shot goal at the end zone line
        // dir: -1 = sol kale (postlar end zone'a doğru sola uzanır)
        //      +1 = sağ kale (postlar end zone'a doğru sağa uzanır)
        // drawShotGoal artık offscreen cache'de (_drawShotGoalStatic). Bu fonksiyon
        // sadece penaltı akışında dinamik shadow gerektiren özel durumlar için kalıyor.
        function drawShotGoal(x, cy, h, color, dir) {
            const goalTop = cy - h / 2;
            const goalBot = cy + h / 2;
            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            const postLen = 24;
            ctx.beginPath();
            ctx.moveTo(x, goalTop); ctx.lineTo(x + dir * postLen, goalTop);
            ctx.moveTo(x, goalBot); ctx.lineTo(x + dir * postLen, goalBot);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(x, goalTop); ctx.lineTo(x, goalBot);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineCap = 'butt';
            ctx.restore();
        }

        // ─────────────── WALL HELPERS & DRAWING ───────────────
        // Duvar tüm gol çizgisi yüksekliğinin 1/3'ünü kaplar
        function wallSegmentBounds(pos) {
            const fullH = FIELD_BOTTOM - FIELD_TOP;
            const segH = fullH / 3;
            const top = FIELD_TOP + pos * segH;
            return { top, bot: top + segH, segH };
        }

        function yInWallSegment(y, pos) {
            const seg = wallSegmentBounds(pos);
            return y >= seg.top && y <= seg.bot;
        }

        function drawWalls() {
            (gs.walls || []).forEach(w => {
                const x = w.side === 'left' ? PLAY_LEFT : PLAY_RIGHT;
                const seg = wallSegmentBounds(w.pos);
                const color = w.owner === 'p1' ? '#00d4ff' : '#ff4d6d';
                const lifeAlpha = Math.min(1, w.life / 1500);
                const wW = 14;
                ctx.save();
                ctx.globalAlpha = lifeAlpha;
                ctx.shadowColor = color;
                ctx.shadowBlur = 16;
                ctx.fillStyle = color;
                ctx.fillRect(x - wW / 2, seg.top, wW, seg.segH);
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'rgba(255,255,255,0.28)';
                ctx.fillRect(x - wW / 2, seg.top, wW, 4);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fillRect(x - wW / 2, seg.bot - 4, wW, 4);
                ctx.strokeStyle = 'rgba(0,0,0,0.45)';
                ctx.lineWidth = 1.2;
                const brickH = 14;
                ctx.beginPath();
                let row = 0;
                for (let yy = seg.top + brickH; yy < seg.bot; yy += brickH) {
                    ctx.moveTo(x - wW / 2, yy);
                    ctx.lineTo(x + wW / 2, yy);
                    const offX = (row % 2 === 0) ? -wW / 4 : wW / 4;
                    ctx.moveTo(x + offX, yy);
                    ctx.lineTo(x + offX, Math.min(seg.bot, yy + brickH));
                    row++;
                }
                ctx.stroke();
                ctx.restore();
            });
            ['p1', 'p2'].forEach(pid => {
                const p = gs.players[pid];
                if (!p || !p.wallPreview || !p.wallPreview.active) return;
                const side = (p.team || pid) === 'p1' ? 'left' : 'right';
                const x = side === 'left' ? PLAY_LEFT : PLAY_RIGHT;
                const seg = wallSegmentBounds(p.wallPreview.pos);
                const color = pid === 'p1' ? '#00d4ff' : '#ff4d6d';
                const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180);
                const wW = 18;
                ctx.save();
                ctx.globalAlpha = 0.18 + 0.32 * pulse;
                ctx.fillStyle = color;
                ctx.fillRect(x - wW / 2, seg.top, wW, seg.segH);
                ctx.globalAlpha = 0.9;
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.setLineDash([8, 6]);
                ctx.strokeRect(x - wW / 2, seg.top, wW, seg.segH);
                ctx.setLineDash([]);
                const prog = Math.min(1, p.wallPreview.holdMs / 380);
                if (prog > 0) {
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#ffd700';
                    const barH = seg.segH * prog;
                    const barX = side === 'left' ? x + wW / 2 + 4 : x - wW / 2 - 8;
                    ctx.fillRect(barX, seg.top + (seg.segH - barH) / 2, 4, barH);
                }
                ctx.restore();
            });
        }

        // Helper: draw a single player body at position (x,y) with given style
        function drawPlayerBody(x, y, r, color, frozenTimer, poweredTimer, label, slideTimer, slideVx, slideVy, pid) {
            const speedBoostTimer = (gs.players[pid] && gs.players[pid].speedBoostTimer) || 0;
            ctx.save();
            let glowColor = color;
            let glowSize = 20;
            if (poweredTimer > 0) { glowColor = '#ffd700'; glowSize = 35; }
            if (frozenTimer > 0) { glowColor = '#88eeff'; glowSize = 25; }
            if (speedBoostTimer > 0) { glowColor = '#00ffff'; glowSize = 28; }
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = glowSize;

            if (frozenTimer > 0) ctx.fillStyle = '#88eeff';
            else if (poweredTimer > 0) ctx.fillStyle = '#ffd700';
            else ctx.fillStyle = color;

            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, Math.max(0, r - 4), 0, Math.PI * 2); ctx.stroke();

            // Slide trail
            if (slideTimer > 0) {
                ctx.globalAlpha = 0.4;
                ctx.fillStyle = pid === 'p1' ? '#aa00ff' : '#ff88bb';
                ctx.beginPath(); ctx.arc(x - slideVx * 3, y - slideVy * 3, r * 0.7, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 0.2;
                ctx.beginPath(); ctx.arc(x - slideVx * 6, y - slideVy * 6, r * 0.5, 0, Math.PI * 2); ctx.fill();
            }

            ctx.globalAlpha = 1; ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Orbitron, monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, x, y);

            if (frozenTimer > 0) {
                ctx.globalAlpha = 0.5; ctx.fillStyle = '#88eeff';
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = '14px serif';
                ctx.fillText('❄', x, y - (r + 10));
            }
            if (poweredTimer > 0) {
                const pulse = 0.3 + 0.3 * Math.sin(Date.now() / 80);
                ctx.globalAlpha = pulse; ctx.fillStyle = '#ffd700';
                ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20;
                ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            if (speedBoostTimer > 0) {
                const pulse = 0.4 + 0.4 * Math.sin(Date.now() / 70);
                ctx.globalAlpha = pulse;
                ctx.strokeStyle = '#00ffff';
                ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 18;
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke();
                ctx.globalAlpha = 1; ctx.shadowBlur = 0;
            }
            ctx.restore();
        }

        function drawPlayer(pid) {
            const p = gs.players[pid];
            const label = String(pid || '').toUpperCase();

            // Hide keeper during penalty
            if (gs.penaltyMode && gs.penaltyMode.active && pid === gs.penaltyMode.keeper) return;

            if (p.clones.length > 0) {
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
                    drawPlayerBody(b.x, b.y, p.r, p.color, p.frozenTimer, p.poweredTimer, label, p.slideTimer, p.slideVx, p.slideVy, pid);
                });
                // Controls-reversed indicator (only on real)
                if (p.controlsReversedTimer > 0) {
                    ctx.save(); ctx.fillStyle = '#ff88bb'; ctx.font = '13px serif';
                    ctx.textAlign = 'center'; ctx.fillText('🔀', p.x, p.y - 28); ctx.restore();
                }
                return; // skip standard draw below
            }

            // Standard draw for non-clone mode
            drawPlayerBody(p.x, p.y, p.r, p.color, p.frozenTimer, p.poweredTimer, label, p.slideTimer, p.slideVx, p.slideVy, pid);

            // Controls-reversed indicator
            if (p.controlsReversedTimer > 0) {
                ctx.save(); ctx.fillStyle = '#ff88bb'; ctx.font = '13px serif';
                ctx.textAlign = 'center'; ctx.fillText('🔀', p.x, p.y - 28); ctx.restore();
            }
        }

        function drawBall() {
            const b = gs.ball;

            // Görünmez top: çizimi atla
            if (gs.invisBallTimer > 0) return;

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
            ctx.shadowColor = b.longPassMode ? '#ff66ff' : '#ffee00';
            ctx.shadowBlur = b.longPassMode ? 35 : (b.holder ? 12 : 25);

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

            // Decoy balls on clones: if player holds the ball and has clones,
            // draw identical-looking balls at each clone position
            ['p1', 'p2'].forEach(pid => {
                const p = gs.players[pid];
                // Online: klonu atan oyuncu sahte topları görmez; rakip gerçek+klonlarda top görür
                if (gameStarted && pid === myPid) return;
                if (b.holder === pid && p.clones && p.clones.length > 0) {
                    p.clones.forEach(c => {
                        const cx = c.x + p.lastDirX * (PLAYER_R * 0.7);
                        const cy = c.y + p.lastDirY * (PLAYER_R * 0.7);
                        ctx.save();
                        // Same pulsing ownership ring as real ball
                        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 120);
                        ctx.shadowColor = p.color; ctx.shadowBlur = 18 * pulse;
                        ctx.strokeStyle = p.color; ctx.lineWidth = 3;
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
            });
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

        function drawHook() {
            // Flying hook
            if (gs.hookProjectile) {
                const hp = gs.hookProjectile;
                const owner = gs.players[hp.owner];
                ctx.save();
                // Rope
                ctx.strokeStyle = '#ffaa33';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(owner.x, owner.y);
                ctx.lineTo(hp.x, hp.y);
                ctx.stroke();
                // Hook head
                ctx.setLineDash([]);
                ctx.shadowColor = '#ffaa33';
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#ffaa33';
                ctx.beginPath();
                ctx.arc(hp.x, hp.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            // Active pulling rope
            ['p1', 'p2'].forEach(pid => {
                const p = gs.players[pid];
                if (p.pullingTimer > 0 && p.pulledBy) {
                    const owner = gs.players[p.pulledBy];
                    ctx.save();
                    ctx.strokeStyle = '#ffaa33';
                    ctx.lineWidth = 4;
                    ctx.setLineDash([10, 5]);
                    ctx.lineDashOffset = -Date.now() * 0.02;
                    ctx.beginPath();
                    ctx.moveTo(owner.x, owner.y);
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                    ctx.restore();
                }
            });
        }

        function drawSlowZones() {
            gs.slowZones.forEach(z => {
                ctx.save();
                ctx.globalAlpha = Math.min(1, z.life / 500) * 0.4;
                ctx.beginPath();
                ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
                ctx.fillStyle = '#33ffaa';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#fff';
                ctx.stroke();

                ctx.globalAlpha *= 0.5;
                ctx.clip();
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.lineWidth = 1;
                for (let i = z.x - z.radius; i < z.x + z.radius; i += 20) {
                    ctx.beginPath(); ctx.moveTo(i, z.y - z.radius); ctx.lineTo(i + 20, z.y + z.radius); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(i, z.y + z.radius); ctx.lineTo(i + 20, z.y - z.radius); ctx.stroke();
                }
                ctx.restore();
            });

            gs.slowOrbProjectiles.forEach(orb => {
                ctx.save();
                const t = orb.progress;
                const size = 8 + Math.sin(t * Math.PI) * 8; // pulse
                ctx.shadowColor = '#33ffaa';
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#33ffaa';
                ctx.beginPath();
                ctx.arc(orb.x, orb.y, size, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(orb.x, orb.y, size * 0.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
        }

        /** Online maçta takım eşleşmesi (sis / kör). Yerelde gameStarted=false → sadece pid eşitliği. */
        function onlineSameTeam(pidA, pidB) {
            if (!gameStarted || !gs || !gs.players || !pidA || !pidB) return pidA === pidB;
            const pa = gs.players[pidA], pb = gs.players[pidB];
            if (!pa || !pb) return pidA === pidB;
            return (pa.team || pidA) === (pb.team || pidB);
        }

        function drawSmokeZones() {
            gs.smokeZones.forEach(z => {
                ctx.save();
                const lifeAlpha = Math.min(1, z.life / 800);
                // Online: sis atan takım alanı içini görebilir; rakip yoğun sis görür
                const allySmokeView = gameStarted && z.owner && onlineSameTeam(z.owner, myPid);
                if (allySmokeView) {
                    ctx.globalAlpha = Math.min(0.22, 0.08 + lifeAlpha * 0.12);
                    ctx.fillStyle = 'rgba(240, 240, 255, 0.35)';
                    ctx.beginPath();
                    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = Math.min(0.5, 0.25 + lifeAlpha * 0.2);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                    return;
                }
                for (let i = 0; i < 6; i++) {
                    const angle = (i / 6) * Math.PI * 2 + Date.now() * 0.001 + i;
                    const ox = Math.cos(angle) * (z.radius * 0.25);
                    const oy = Math.sin(angle) * (z.radius * 0.25);
                    const grad = ctx.createRadialGradient(z.x + ox, z.y + oy, 0, z.x + ox, z.y + oy, z.radius);
                    grad.addColorStop(0, `rgba(220, 220, 220, ${0.98 * lifeAlpha})`);
                    grad.addColorStop(0.5, `rgba(180, 180, 180, ${0.85 * lifeAlpha})`);
                    grad.addColorStop(1, 'rgba(120, 120, 120, 0)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(z.x + ox, z.y + oy, z.radius, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            });
            gs.smokeProjectiles.forEach(orb => {
                ctx.save();
                const t = orb.progress;
                const size = 12 + Math.sin(t * Math.PI) * 12;
                ctx.shadowColor = '#fff'; ctx.shadowBlur = 20;
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(orb.x, orb.y, size, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            });
        }

        function drawPenaltyBar() {
            const pm = gs.penaltyMode;
            if (!pm || !pm.active) return;

            const BAR_W = Math.min(W * 0.6, 500);
            const BAR_H = 28;
            const BAR_X = (W - BAR_W) / 2;
            const BAR_Y = H - 80;
            const CORNER = 8;

            ctx.save();

            // Background panel
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.beginPath();
            ctx.roundRect(BAR_X - 20, BAR_Y - 38, BAR_W + 40, BAR_H + 58, 12);
            ctx.fill();

            // Title
            const kickerColor = pm.kicker === 'p1' ? '#00d4ff' : '#ff4d6d';
            ctx.fillStyle = kickerColor;
            ctx.font = 'bold 13px Orbitron, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(
                (pm.kicker === 'p1' ? '🔵 P1' : '🔴 P2') + ' PENALTİ — Vurmak için [SPACE] bas!',
                W / 2, BAR_Y - 14
            );

            // Red bar background
            ctx.fillStyle = '#cc2222';
            ctx.beginPath();
            ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, CORNER);
            ctx.fill();

            // Green zone
            const gx = BAR_X + pm.greenStart * BAR_W;
            const gw = pm.greenWidth * BAR_W;
            ctx.fillStyle = '#00cc55';
            ctx.beginPath();
            ctx.roundRect(gx, BAR_Y, gw, BAR_H, 4);
            ctx.fill();

            // Green zone glow
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 12;
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(gx, BAR_Y, gw, BAR_H, 4);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Indicator (needle)
            const needleX = BAR_X + pm.barPos * BAR_W;
            const inGreen = pm.barPos >= pm.greenStart && pm.barPos <= pm.greenStart + pm.greenWidth;
            ctx.fillStyle = pm.shot ? (inGreen ? '#00ff88' : '#ffffff') : '#ffffff';
            ctx.shadowColor = pm.shot && inGreen ? '#00ff88' : '#fff';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.moveTo(needleX, BAR_Y - 6);
            ctx.lineTo(needleX + 7, BAR_Y + BAR_H + 6);
            ctx.lineTo(needleX - 7, BAR_Y + BAR_H + 6);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;

            // Bar border
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, CORNER);
            ctx.stroke();

            // Fouler hint
            const foulerKey = pm.keeper === 'p1' ? 'F' : 'L';
            ctx.fillStyle = 'rgba(255,100,100,0.8)';
            ctx.font = '11px Orbitron, monospace';
            ctx.fillText(
                '⚡ ' + (pm.keeper === 'p1' ? 'P1' : 'P2') + ': [' + foulerKey + '] bas → hızı artır!',
                W / 2, BAR_Y + BAR_H + 18
            );

            ctx.restore();
        }

        // ─────────────── GLOBAL EFFECTS ───────────────
        function updateEffects(dt) {
            if (gs.blindTimer > 0) gs.blindTimer -= dt;
            if (gs.invisBallTimer > 0) gs.invisBallTimer -= dt;
            if (gs.walls && gs.walls.length) {
                gs.walls.forEach(w => { w.life -= dt; });
                gs.walls = gs.walls.filter(w => w.life > 0);
            }
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
            updatePenaltyBar(dt);
            checkCollisions(dt);
            checkGoal();
            updateParticles(dt);
            updateHUD(dt);
            updateEffects(dt);

            // Draw — players first, ball on top so it's always visible
            drawField();
            drawSlowZones();
            drawFreezeProjectile();
            drawHook();
            drawWalls();
            drawPlayer('p1');
            drawPlayer('p2');
            drawBall();
            drawSmokeZones();
            drawParticles();
            drawPenaltyBar();

            // Kör etme etkisi: sahayı siyaha bürü
            if (gs.blindTimer > 0) {
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.96)';
                ctx.fillRect(0, 0, W, H);
                ctx.restore();
            }

            animId = requestAnimationFrame(gameLoop);
        }

        // ─────────────── START/RESTART ───────────────
        function startGame() {
            document.getElementById('overlay').classList.add('hidden');
            initSkillSelection();
        }

        function initSkillSelection() {
            document.getElementById('skill-selection-overlay').classList.remove('hidden');
            p1Profile = null; p2Profile = null;
            p1SelectedSkills = [];
            p2SelectedSkills = [];

            ['p1', 'p2'].forEach(pid => {
                const profileRow = document.getElementById(`${pid}-profile-row`);
                profileRow.innerHTML = '';
                PROFILES.forEach(prof => {
                    const card = document.createElement('div');
                    card.className = 'profile-card';
                    card.style.color = prof.color;
                    card.innerHTML = `<div class="profile-icon">${prof.icon}</div><div class="profile-name">${prof.name}</div>`;
                    card.onclick = () => selectProfile(pid, prof);
                    profileRow.appendChild(card);
                });
                document.getElementById(`${pid}-skill-pool`).innerHTML = '';
                document.getElementById(`${pid}-pick-hint`).textContent = 'Sınıf seçin';
            });
            updateSkillSelectionUI();
        }

        function selectProfile(pid, prof) {
            if (pid === 'p1') { p1Profile = prof; p1SelectedSkills = []; }
            else { p2Profile = prof; p2SelectedSkills = []; }

            const profileRow = document.getElementById(`${pid}-profile-row`);
            Array.from(profileRow.children).forEach((c, i) => {
                c.classList.toggle('selected', PROFILES[i].id === prof.id);
            });

            renderSkillSlots(pid, prof.slots);

            const pool = document.getElementById(`${pid}-skill-pool`);
            pool.innerHTML = '';
            const skills = prof.skills.map(id => ALL_SKILLS.find(s => s.id === id)).filter(Boolean);
            const hint = document.getElementById(`${pid}-pick-hint`);
            const pickCount = prof.slots;

            if (skills.length <= pickCount) {
                if (pid === 'p1') p1SelectedSkills = skills.slice();
                else p2SelectedSkills = skills.slice();
                hint.textContent = 'Sınıf skilleri otomatik atandı';
                skills.forEach(sk => {
                    const card = createSkillCard(sk);
                    card.classList.add('selected', 'locked');
                    pool.appendChild(card);
                });
            } else {
                hint.textContent = `${skills.length} skilden ${pickCount} tane seç`;
                skills.forEach(sk => {
                    const card = createSkillCard(sk);
                    card.onclick = () => toggleSkill(pid, sk, card, pickCount);
                    pool.appendChild(card);
                });
            }
            updateSkillSelectionUI();
        }

        function renderSkillSlots(pid, count) {
            const cont = document.getElementById(`${pid}-selected-skills`);
            cont.innerHTML = '';
            for (let i = 0; i < count; i++) {
                const slot = document.createElement('div');
                slot.className = 'selected-slot';
                slot.id = `${pid}-slot-${i}`;
                cont.appendChild(slot);
            }
        }

        function createSkillCard(sk) {
            const card = document.createElement('div');
            card.className = 'skill-card';
            card.style.color = sk.color;
            card.dataset.skillId = sk.id;
            card.innerHTML = `<div class="skill-icon">${sk.icon}</div><div class="skill-name">${sk.name}</div>`;
            return card;
        }

        function toggleSkill(pid, sk, cardEl, maxPick) {
            const arr = pid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
            const limit = maxPick || ((pid === 'p1' ? p1Profile : p2Profile)?.slots) || 3;
            const idx = arr.findIndex(s => s.id === sk.id);
            if (idx !== -1) {
                arr.splice(idx, 1);
                cardEl.classList.remove('selected');
            } else {
                if (arr.length >= limit) return;
                arr.push(sk);
                cardEl.classList.add('selected');
            }
            updateSkillSelectionUI();
        }

        function updateSkillSelectionUI() {
            ['p1', 'p2'].forEach(pid => {
                const prof = pid === 'p1' ? p1Profile : p2Profile;
                const arr = pid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
                const slots = prof ? prof.slots : 0;
                for (let i = 0; i < slots; i++) {
                    const slotEl = document.getElementById(`${pid}-slot-${i}`);
                    if (!slotEl) continue;
                    const s = arr[i];
                    slotEl.innerHTML = s ? s.icon : '';
                    slotEl.style.borderColor = s ? s.color : 'rgba(255,255,255,0.3)';
                }
            });

            const btn = document.getElementById('confirm-skills-btn');
            const p1Need = p1Profile ? p1Profile.slots : 99;
            const p2Need = p2Profile ? p2Profile.slots : 99;
            btn.disabled = (!p1Profile || !p2Profile || p1SelectedSkills.length < p1Need || p2SelectedSkills.length < p2Need);
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

            // Assign selected abilities and keys (4. slot için T/Y eklendi)
            const p1Keys = ['KeyQ', 'KeyE', 'KeyR', 'KeyT'];
            const p2Keys = ['KeyU', 'KeyI', 'KeyO', 'KeyP'];
            gs.players.p1.abilities = p1SelectedSkills.map((sk, i) => ({ ...sk, key: p1Keys[i], cdLeft: 0, active: false }));
            gs.players.p2.abilities = p2SelectedSkills.map((sk, i) => ({ ...sk, key: p2Keys[i], cdLeft: 0, active: false }));
            gs.players.p1.profile = p1Profile;
            gs.players.p2.profile = p2Profile;

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

        // --- MENU NAVIGATION ---
        function goLocalMode() {
            // Local 2-player mode: simply redirect to index.html
            window.location.href = 'index.html';
        }

        function goOnlineMode() {
            document.getElementById('main-menu').style.display = 'none';
            const lobby = document.getElementById('lobby');
            lobby.style.display = 'flex';
            // Initialize socket connection when entering online mode
            if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
                initSocket();
            }
        }

        function backToMenu() {
            // Close socket if open
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
            document.getElementById('lobby').style.display = 'none';
            document.getElementById('waiting-room').style.display = 'none';
            document.getElementById('main-menu').style.display = 'flex';
            document.getElementById('error-msg').textContent = '';
        }

        // --- ONLINE LOGIC ---
        const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
        let socket, myPid, myRoomId, allSkills = [], gameStarted = false;
        let myTeam = 'p1', onlineMaxPlayers = 2;
        let onlineTeamSize = 1;
        let __playerStatic = null;          // game_init ile gelen statik oyuncu verisi (color/abilities tanımı/profile)
        let __initialTimeLeft = 180;
        // Client-side prediction: kendi karakterin için lokal pozisyon — input lag'i öldürür
        let __pred = { x: null, y: null, lastDirX: 1, lastDirY: 0, lastInputAt: 0 };
        const __PRED_SPEED = 3.2; // PLAYER_SPEED ile aynı
        // Interpolation: rakip + top için son 2 sunucu snapshot'ı arasında lerp
        // Sunucu 60Hz state yolluyor; ufak tampon paket gecikmelerini absorbe eder
        // Network stddev=0.7ms olduğundan minimum buffer yeter.
        // 30Hz broadcast → interval=33ms. Jitter çok düşük olduğu için 33ms+küçük pay yeterli.
        // Bu, rakip ve top'un görsel gecikmesini ~105ms → ~95ms'e düşürür.
        // (Eski 45ms RTT/2~60ms + 45ms = 105ms; yeni: 60+38 = 98ms görsel gecikme)
        const __INTERP_DELAY_MS = 38;
        let __snapshots = []; // [{t, players: {pid: {x,y,lastDirX,lastDirY}}, ball: {x,y,holder}}]
        // Ball client-side prediction: pas/şut sonrası top'u server snapshot'larından bağımsız
        // olarak client physics ile ilerlet. RTT yüksek olduğunda topun "lastikli" görünmesini engeller.
        // until = 0 ise pasif (interpolation kullanılır)
        const __ballPredict = { active: false, until: 0, x: 0, y: 0, vx: 0, vy: 0, lastIntegrated: 0 };
        let __ballHandoffUntil = 0;
        // Interpolation: rakip + top için son 2 sunucu snapshot'ı arasında lerp
        let __ballVisX = NaN, __ballVisY = NaN;
        // Input WS: her frame JSON atmak tamponu doldurup bufferedAmount ile drop edilince takılma yapıyordu
        let __inputSendSig = '';
        let __lastInputPacketSentAt = 0;

        function setOnlineTeamSize(size) {
            onlineTeamSize = size;
            document.querySelectorAll('.online-team-btn').forEach(btn => btn.classList.remove('active'));
            const selectedBtn = document.getElementById(`online-team-${size}`);
            if (selectedBtn) selectedBtn.classList.add('active');
        }

        function createRoom() {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                initSocket();
                socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'create_room', teamSize: onlineTeamSize })), { once: true });
                return;
            }
            socket.send(JSON.stringify({ type: 'create_room', teamSize: onlineTeamSize }));
        }
        function joinRoom() {
            const code = document.getElementById('room-code-input').value.toUpperCase();
            if (!code) return;
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                initSocket();
                socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join_room', roomId: code, teamSize: onlineTeamSize })), { once: true });
                return;
            }
            socket.send(JSON.stringify({ type: 'join_room', roomId: code, teamSize: onlineTeamSize }));
        }

        let __onlineSkillSelectionShown = false;
        function showOnlineSkillSelection() {
            if (__onlineSkillSelectionShown) return;
            __onlineSkillSelectionShown = true;
            document.getElementById('waiting-room').style.display = 'none';
            document.getElementById('lobby').style.display = 'none';
            // skill-selection-overlay game-wrapper'ın içinde — parent'ı görünür yap ki overlay çizilebilsin
            document.getElementById('game-wrapper').style.display = 'flex';
            document.getElementById('skill-selection-overlay').classList.remove('hidden');
            initSkillSelection();
            // Rakibin tarafını devre dışı bırak — sadece kendi profilini seç
            const otherPid = myPid === 'p1' ? 'p2' : 'p1';
            const otherPanel = document.querySelector('.' + otherPid + '-selection');
            if (otherPanel) {
                otherPanel.style.pointerEvents = 'none';
                otherPanel.style.opacity = '0.55';
                const h3 = otherPanel.querySelector('h3');
                if (h3 && !h3.textContent.includes('RAKİP')) h3.textContent += ' (RAKİP SEÇİYOR)';
            }
            const btn = document.getElementById('confirm-skills-btn');
            let __mySkillsSent = false;
            btn.onclick = () => {
                if (__mySkillsSent) return;
                const myProfile = myPid === 'p1' ? p1Profile : p2Profile;
                const mySkills = myPid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
                if (!myProfile || !mySkills.length) return;
                socket.send(JSON.stringify({ type: 'select_skills', skills: mySkills, profile: myProfile }));
                __mySkillsSent = true;
                btn.textContent = 'RAKİP BEKLENİYOR...';
                btn.disabled = true;
                // Kendi tarafını da düzenlemeyi engelle
                const myPanel = document.querySelector('.' + myPid + '-selection');
                if (myPanel) myPanel.style.pointerEvents = 'none';
            };
            updateSkillSelectionUI = (function (orig) {
                return function () {
                    orig();
                    if (__mySkillsSent) { btn.disabled = true; return; }
                    const myProfile = myPid === 'p1' ? p1Profile : p2Profile;
                    const mySkills = myPid === 'p1' ? p1SelectedSkills : p2SelectedSkills;
                    const need = myProfile ? myProfile.slots : 99;
                    btn.disabled = (!myProfile || mySkills.length < need);
                };
            })(updateSkillSelectionUI);
            updateSkillSelectionUI();
        }

        function initSocket() {
            socket = new WebSocket(WS_URL);
            socket.onopen = () => {
                const em = document.getElementById('error-msg');
                if (em) em.textContent = '';
                console.log('[WS] bağlandı');
                if (window.__pingInterval) clearInterval(window.__pingInterval);
                window.__pingInterval = setInterval(() => {
                    if (socket && socket.readyState === 1) {
                        try { socket.send(JSON.stringify({ type: 'ping', t: performance.now() })); } catch (_) {}
                    }
                }, 1000);
            };
            socket.onerror = (e) => {
                console.error('[WS] hata', e);
                const em = document.getElementById('error-msg');
                if (em) em.textContent = 'Sunucuya bağlanılamadı. node server.js çalışıyor mu?';
            };
            socket.onclose = () => {
                console.warn('[WS] kapandı');
                if (!gameStarted) {
                    const em = document.getElementById('error-msg');
                    if (em && !em.textContent) em.textContent = 'Bağlantı koptu. Sayfayı yenileyin.';
                }
            };
            socket.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                emitGameEvent('socket_message', { msgType: msg.type });
                if (msg.type === 'room_created') {
                    myPid = msg.pid; myRoomId = msg.roomId; allSkills = msg.allSkills;
                    myTeam = myPid;
                    document.getElementById('lobby').style.display = 'none';
                    const wr = document.getElementById('waiting-room');
                    wr.style.display = 'flex';
                    document.getElementById('display-room-code').textContent = myRoomId;
                    document.getElementById('waiting-status').textContent = 'Rakip bekleniyor... (1/2)';
                } else if (msg.type === 'room_joined') {
                    myPid = msg.pid; myRoomId = msg.roomId; allSkills = msg.allSkills;
                    myTeam = myPid;
                    // İkinci oyuncu odaya girdiğinde her iki tarafa skill seçimini aç
                    showOnlineSkillSelection();
                } else if (msg.type === 'opponent_joined') {
                    // Birinci oyuncu için skill seçim ekranı
                    showOnlineSkillSelection();
                } else if (msg.type === 'start') {
                    document.getElementById('skill-selection-overlay').classList.add('hidden');
                    document.getElementById('waiting-room').style.display = 'none';
                    document.getElementById('game-wrapper').style.display = 'flex';
                    gameStarted = true;
                    __inputSendSig = '';
                    __lastInputPacketSentAt = 0;
                    resizeGame();
                    requestAnimationFrame(gameLoop);
                } else if (msg.type === 'game_init') {
                    // Statik veriyi sakla (color/team/profile/abilities tanımı) — her tick'te tekrar gelmiyor
                    __playerStatic = msg.players || {};
                    if (typeof msg.timeLeft === 'number') __initialTimeLeft = msg.timeLeft;
                } else if (msg.type === 'pong') {
                    const rtt = performance.now() - msg.t;
                    if (!window.__rttDiag) window.__rttDiag = { samples: [], lastSpikeAt: 0 };
                    const rd = window.__rttDiag;
                    rd.samples.push(rtt);
                    if (rd.samples.length > 30) rd.samples.shift();
                    // Spike anında detaylı log: ne zaman, ne kadar gecikme, sayfa visible mı
                    if (rtt > 250) {
                        const visible = document.visibilityState === 'visible';
                        console.warn(
                            `[rtt-spike] ${rtt.toFixed(0)}ms` +
                            ` visible=${visible}` +
                            ` at=${(performance.now() / 1000).toFixed(1)}s`
                        );
                    }
                } else if (msg.type === 'state') {
                    // Sunucudan zayıf state geldi; eksik alanları statik veriyle doldur
                    const slim = msg.gs;
                    const players = {};
                    Object.keys(slim.players || {}).forEach(pid => {
                        const sp = slim.players[pid];
                        const stat = (__playerStatic && __playerStatic[pid]) || {};
                        const keyCodes = pid === 'p1' ? ['KeyQ', 'KeyE', 'KeyR', 'KeyT'] : ['KeyU', 'KeyI', 'KeyO', 'KeyP'];
                        // Yetenekleri statik tanım + dinamik c/a ile birleştir
                        const abFull = (sp.abilities || []).map((ab, i) => {
                            const statAb = (stat.abilities && stat.abilities[i]) || {};
                            return {
                                id: statAb.id,
                                icon: statAb.icon,
                                cd: statAb.cd,
                                color: statAb.color,
                                name: statAb.name,
                                key: keyCodes[i] || '',
                                cdLeft: ab.c || 0,
                                active: !!ab.a,
                            };
                        });
                        players[pid] = Object.assign({}, sp, {
                            color: stat.color || '#fff',
                            team: stat.team || pid,
                            r: stat.r || 18,
                            profile: stat.profile || null,
                            abilities: abFull,
                            // Eksik dinamik alanlar varsayılan değerlerle
                            frozenTimer: sp.frozenTimer || 0,
                            poweredTimer: sp.poweredTimer || 0,
                            slideTimer: sp.slideTimer || 0,
                            slideVx: sp.slideVx || 0,
                            slideVy: sp.slideVy || 0,
                            clones: sp.clones || [],
                            controlsReversedTimer: sp.controlsReversedTimer || 0,
                            growTimer: sp.growTimer || 0,
                            shrinkTimer: sp.shrinkTimer || 0,
                            pullingTimer: sp.pullingTimer || 0,
                            pulledBy: sp.pulledBy || null,
                            speedBoostTimer: sp.speedBoostTimer || 0,
                            geopasActive: !!sp.geopasActive,
                            geopasTimer: sp.geopasTimer || 0,
                            shotActiveTimer: sp.shotActiveTimer || 0,
                            passCharging: !!sp.passCharging,
                            passChargeMs: sp.passChargeMs || 0,
                            longPassCharging: !!sp.longPassCharging,
                            longPassChargeMs: sp.longPassChargeMs || 0,
                            lobCharging: !!sp.lobCharging,
                            lobChargeTimer: sp.lobChargeTimer || 0,
                            slowOrbCharging: !!sp.slowOrbCharging,
                            slowOrbChargeTimer: sp.slowOrbChargeTimer || 0,
                            smokeCharging: !!sp.smokeCharging,
                            smokeChargeTimer: sp.smokeChargeTimer || 0,
                            wallPreview: sp.wallPreview ? { active: !!sp.wallPreview.active, pos: sp.wallPreview.pos || 0 } : null,
                        });
                    });
                    gs = Object.assign({}, slim, {
                        players,
                        walls: slim.walls || [],
                        slowZones: slim.slowZones || [],
                        smokeZones: slim.smokeZones || [],
                        slowOrbProjectiles: slim.slowOrbProjectiles || [],
                        smokeProjectiles: slim.smokeProjectiles || [],
                        tackleCooldown: slim.tackleCooldown || 0,
                        blindTimer: slim.blindTimer || 0,
                        blindOwner: slim.blindOwner != null ? slim.blindOwner : null,
                        invisBallTimer: slim.invisBallTimer || 0,
                    });
                    // Snapshot timestamp olarak performance.now() kullan.
                    // Server-time mapping deneyleri (min-offset tracking) snapshot buffer'ında
                    // tutarsız t değerlerine yol açıp authX'i bozuyordu.
                    // Nagle kapalı + network stddev=0.7ms ile arrival timing zaten ~33ms aralıklı.
                    const snap = {
                        t: performance.now(),
                        players: {},
                        ball: { x: gs.ball.x, y: gs.ball.y, holder: gs.ball.holder },
                    };
                    Object.keys(gs.players).forEach(pid => {
                        snap.players[pid] = {
                            x: gs.players[pid].x,
                            y: gs.players[pid].y,
                            lastDirX: gs.players[pid].lastDirX,
                            lastDirY: gs.players[pid].lastDirY,
                        };
                    });
                    __snapshots.push(snap);
                    // Buffer'ı biraz büyüt: 30Hz × 250ms = 7-8 snapshot uygun
                    if (__snapshots.length > 10) __snapshots.shift();

                    // ─── NETWORK JITTER TEŞHİSİ (ilk 30 sn) ───
                    // Console'da ortalama snapshot aralığını ve sapmayı görürüz.
                    // İdeal: avg ≈ 33ms (30Hz), stddev küçük. Stddev büyükse Railway jitter'ı var.
                    if (!window.__netDiag) window.__netDiag = { samples: [], reportAt: snap.t + 5000, count: 0 };
                    const nd = window.__netDiag;
                    if (nd.lastT) nd.samples.push(snap.t - nd.lastT);
                    nd.lastT = snap.t;
                    if (snap.t > nd.reportAt && nd.samples.length > 5 && nd.count < 6) {
                        const arr = nd.samples;
                        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
                        const max = Math.max(...arr);
                        const min = Math.min(...arr);
                        const variance = arr.reduce((s, v) => s + (v - avg) * (v - avg), 0) / arr.length;
                        const stddev = Math.sqrt(variance);
                        console.log(`[net] snap interval avg=${avg.toFixed(1)}ms min=${min.toFixed(0)} max=${max.toFixed(0)} stddev=${stddev.toFixed(1)}ms n=${arr.length}`);
                        nd.samples = [];
                        nd.reportAt = snap.t + 5000;
                        nd.count++;
                    }
                    if (!document.getElementById('p1-ab-0')) buildHUD();
                    updateHUD(16);
                    if (msg.flashes) msg.flashes.forEach(f => showFlash(f.msg, f.color));
                } else if (msg.type === 'gameover') {
                    document.getElementById('overlay').classList.remove('hidden');
                    const w = msg.winner;
                    document.getElementById('overlay').querySelector('h2').textContent = w === myPid ? 'KAZANDIN!' : (w === 'draw' ? 'BERABERE!' : 'KAYBETTİN');
                    if (msg.score) {
                        const sub = document.getElementById('overlay').querySelector('.subtitle');
                        if (sub) sub.textContent = 'Skor: ' + msg.score[0] + ' — ' + msg.score[1];
                    }
                } else if (msg.type === 'opponent_left') {
                    document.getElementById('overlay').classList.remove('hidden');
                    const h2 = document.getElementById('overlay').querySelector('h2');
                    if (h2) h2.textContent = 'RAKİP AYRILDI';
                } else if (msg.type === 'error') {
                    document.getElementById('error-msg').textContent = msg.msg;
                }
            };
        }

        // Send inputs over socket instead of processing locally
        function sendSocketInput() {
            if (!gameStarted) return;
            let dx = 0, dy = 0;
            if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
            if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
            if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
            if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

            let penaltyBarBoost = false;
            const pm = gs.penaltyMode;
            if (pm && pm.active && !pm.shot && pm.keeper === myPid) {
                penaltyBarBoost = !!(myPid === 'p1' ? keys['KeyF'] : keys['KeyL']);
                if (!penaltyBarBoost && navigator.getGamepads) {
                    const gpIdx = myPid === 'p1' ? 0 : 1;
                    const gp = navigator.getGamepads()[gpIdx];
                    if (gp && gp.connected && gp.buttons[2] && gp.buttons[2].pressed) penaltyBarBoost = true;
                }
            }

            let wallHeld = false;
            const me = gs.players && gs.players[myPid];
            if (me && me.wallPreview && me.wallPreview.active) {
                const wallAb = me.abilities && me.abilities.find(a => a.id === 'wall');
                if (wallAb && wallAb.key && keys[wallAb.key]) wallHeld = true;
                if (!wallHeld && navigator.getGamepads) {
                    const gpIdx = myPid === 'p1' ? 0 : 1;
                    const gp = navigator.getGamepads()[gpIdx];
                    const ABILITY_GAMEPAD_BUTTONS = [4, 5, 3, 1];
                    if (gp && gp.connected && wallAb) {
                        const abIdx = me.abilities.indexOf(wallAb);
                        const btnIdx = ABILITY_GAMEPAD_BUTTONS[abIdx];
                        if (btnIdx != null && gp.buttons[btnIdx] && gp.buttons[btnIdx].pressed) wallHeld = true;
                    }
                }
            }

            socket.send(JSON.stringify({ type: 'input', dx, dy, penaltyBarBoost, wallHeld }));
        }

        // ── Teşhis: FPS / frame-time ve prediction drift ────────────────────────
        // [fps]  → gerçek frame süreleri; spike'lar frame drop = rendering sorunu
        // [pred] → errLen dağılımı; yüksek median = reconcile hâlâ aktif demektir
        const __diag = {
            ft: [],          // frame times
            err: [],         // errLen per frame (prediction vs server)
            drawMs: [],      // drawField+players+ball süresi
            snaps: 0,        // ani sıçrama snap sayısı (skill/pas)
            reportAt: 0,
            count: 0,
        };

        let __lastFrameAt = 0;
        // Override local gameLoop with prediction
        gameLoop = function (timestamp) {
            const now = performance.now();
            // Client dt'yi server tick clamp'ı (0.5x–3x = 8–50ms) ile aynı tut.
            // Sekme arka plana atılınca veya RAF spike olursa pred'in fırlamaması için kritik.
            let dt = __lastFrameAt ? (now - __lastFrameAt) : 16;
            if (!isFinite(dt) || dt <= 0) dt = 16;
            if (dt > 50) dt = 50;
            __lastFrameAt = now;
            if (__lastFrameAt && __diag.count < 12) __diag.ft.push(dt);
            if (gameStarted && gs && gs.ball && gs.players) {
                // ─── BALL CLIENT-SIDE PREDICTION ───
                // Pas/şut sonrası top'u local physics ile ilerlet (RTT yüksek olsa bile lag yok)
                // Server fiziği: BALL_FRICTION=0.93 her tick (60Hz), ball.x += vx
                // Client da AYNI katsayıyı kullanmalı yoksa predict bitince ışınlanma olur.
                if (__ballPredict.active) {
                    if (now >= __ballPredict.until) {
                        __ballPredict.active = false;
                        // Predict bitince kısa exp-smooth handoff (pas ve skill aynı; eski pas-only uzun handoff lag hissi veriyordu)
                        __ballHandoffUntil = now + 185;
                        __ballVisX = __ballPredict.x;
                        __ballVisY = __ballPredict.y;
                    } else {
                        const dtBall = now - __ballPredict.lastIntegrated;
                        __ballPredict.lastIntegrated = now;
                        const scale = dtBall / (1000 / 60);
                        __ballPredict.x += __ballPredict.vx * scale;
                        __ballPredict.y += __ballPredict.vy * scale;
                        // Server ile birebir aynı friction (shotMode/longPassMode hariç ama pas için 0.93 doğru)
                        __ballPredict.vx *= Math.pow(0.93, scale);
                        __ballPredict.vy *= Math.pow(0.93, scale);
                    }
                }
                // Sunucu top interp hedefi (predict/handoff sırasında da hesapla — sert kesmeyi önler)
                let ballIx = NaN, ballIy = NaN;
                if (gs.ball.holder !== myPid && __snapshots.length >= 1) {
                    if (__snapshots.length === 1) {
                        const s = __snapshots[0];
                        ballIx = s.ball.x;
                        ballIy = s.ball.y;
                    } else {
                        // Top: diğer serbest toplarla aynı interp gecikmesi (uzun pas ile aynı yol)
                        const ballDelay = __INTERP_DELAY_MS;
                        const renderTimeBall = now - ballDelay;
                        let s0 = __snapshots[0], s1 = __snapshots[1];
                        for (let i = 0; i < __snapshots.length - 1; i++) {
                            if (__snapshots[i].t <= renderTimeBall && __snapshots[i + 1].t >= renderTimeBall) {
                                s0 = __snapshots[i]; s1 = __snapshots[i + 1]; break;
                            }
                        }
                        if (renderTimeBall > __snapshots[__snapshots.length - 1].t) {
                            s0 = __snapshots[__snapshots.length - 2];
                            s1 = __snapshots[__snapshots.length - 1];
                        }
                        const span = s1.t - s0.t;
                        const frac = span > 0 ? Math.max(0, Math.min(1.2, (renderTimeBall - s0.t) / span)) : 1;
                        ballIx = s0.ball.x + (s1.ball.x - s0.ball.x) * frac;
                        ballIy = s0.ball.y + (s1.ball.y - s0.ball.y) * frac;
                    }
                }
                // ─── INTERPOLATION: rakip için pürüzsüz hareket (top ayrı, yukarıdaki ballIx/y) ───
                if (__snapshots.length === 1) {
                    const s = __snapshots[0];
                    Object.keys(gs.players).forEach(pid => {
                        if (pid === myPid) return;
                        const sp = s.players[pid];
                        if (sp) {
                            gs.players[pid].x = sp.x;
                            gs.players[pid].y = sp.y;
                            gs.players[pid].lastDirX = sp.lastDirX;
                            gs.players[pid].lastDirY = sp.lastDirY;
                        }
                    });
                } else if (__snapshots.length >= 2) {
                    const renderTime = now - __INTERP_DELAY_MS;
                    let s0 = __snapshots[0], s1 = __snapshots[1];
                    for (let i = 0; i < __snapshots.length - 1; i++) {
                        if (__snapshots[i].t <= renderTime && __snapshots[i + 1].t >= renderTime) {
                            s0 = __snapshots[i]; s1 = __snapshots[i + 1]; break;
                        }
                    }
                    if (renderTime > __snapshots[__snapshots.length - 1].t) {
                        s0 = __snapshots[__snapshots.length - 2];
                        s1 = __snapshots[__snapshots.length - 1];
                    }
                    const span = s1.t - s0.t;
                    const frac = span > 0 ? Math.max(0, Math.min(1.2, (renderTime - s0.t) / span)) : 1;
                    Object.keys(gs.players).forEach(pid => {
                        if (pid === myPid) return;
                        const a = s0.players[pid], b = s1.players[pid];
                        if (a && b) {
                            gs.players[pid].x = a.x + (b.x - a.x) * frac;
                            gs.players[pid].y = a.y + (b.y - a.y) * frac;
                            gs.players[pid].lastDirX = a.lastDirX + (b.lastDirX - a.lastDirX) * frac;
                            gs.players[pid].lastDirY = a.lastDirY + (b.lastDirY - a.lastDirY) * frac;
                        }
                    });
                }
                // Top görseli: predict → handoff (exp smooth) → doğrudan interp
                if (gs.ball.holder !== myPid && isFinite(ballIx) && isFinite(ballIy)) {
                    if (__ballPredict.active) {
                        gs.ball.x = __ballPredict.x;
                        gs.ball.y = __ballPredict.y;
                    } else if (now < __ballHandoffUntil) {
                        const tau = 70;
                        const k = 1 - Math.exp(-dt / tau);
                        __ballVisX += (ballIx - __ballVisX) * k;
                        __ballVisY += (ballIy - __ballVisY) * k;
                        gs.ball.x = __ballVisX;
                        gs.ball.y = __ballVisY;
                    } else {
                        gs.ball.x = ballIx;
                        gs.ball.y = ballIy;
                        __ballVisX = ballIx;
                        __ballVisY = ballIy;
                    }
                }

                // CLIENT-SIDE PREDICTION: kendi karakter için input'a göre lokal hareket et
                const me = gs.players[myPid];
                if (me) {
                    if (__pred.x === null) { __pred.x = me.x; __pred.y = me.y; }

                    // ── RECONCILE ──────────────────────────────────────────────────────
                    // authX = me.x: son snapshot'taki server pozisyonu (no self-interp).
                    // Self-interp kaldırıldı: min-offset clock mapping snapshot t'lerini
                    // karıştırıyordu → errLen şişiyordu → reconcile her frame'de geri çekiyordu.
                    //
                    // Beklenen steady-state error = speed × (RTT/2 + broadcast_interval/2) / tick_ms
                    // Sürekli yumuşak düzeltme: hiçbir eşik yok, "rubber band" yok.
                    // Her frame errLen × (dt/TC) kadar pred → auth'a yaklaşır.
                    // TC=220ms: 18px steady-state error'da düzeltme 18×(16.67/220)=1.36px/frame
                    // → görünmez. Skill/pas spike'larında smooth yaklaşma.
                    // >150px: gerçek desync (respawn, freeze bitişi) → hard snap.
                    const authX = me.x, authY = me.y;
                    const errX = authX - __pred.x;
                    const errY = authY - __pred.y;
                    const errLen = Math.hypot(errX, errY);
                    if (errLen > 150) {
                        __pred.x = authX; __pred.y = authY;
                        __diag.snaps++;
                    } else {
                        const factor = Math.min(1, dt / 220);
                        __pred.x += errX * factor;
                        __pred.y += errY * factor;
                    }
                    if (__diag.count < 12) __diag.err.push(errLen);

                    // Slide aktifse pred pos'u slide velocity ile ilerlet
                    if (me.slideTimer > 0) {
                        const scale = dt / (1000 / 60);
                        __pred.x += (me.slideVx || 0) * scale;
                        __pred.y += (me.slideVy || 0) * scale;
                        me.slideVx = (me.slideVx || 0) * 0.9;
                        me.slideVy = (me.slideVy || 0) * 0.9;
                        me.slideTimer -= dt;
                        if (me.slideTimer <= 0) { me.slideTimer = 0; me.slideVx = 0; me.slideVy = 0; }
                    }

                    // Teknik pas şarjı sayacı
                    if (me.passCharging && gs.ball.holder === myPid && me.profile && me.profile.id === 'teknik') {
                        me.passChargeMs = Math.min(900, (me.passChargeMs || 0) + dt);
                    } else if (me.passCharging && gs.ball.holder !== myPid) {
                        me.passCharging = false; me.passChargeMs = 0;
                    }

                    // Yerel input ile öne taşı (sadece donmuş/penaltı/slide değilse)
                    const blocked = (me.frozenTimer > 0) || (me.slideTimer > 0) ||
                        (gs.penaltyMode && (gs.penaltyMode.active || gs.penaltyMode.pending));
                    if (!blocked) {
                        let dx = 0, dy = 0;
                        if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
                        if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
                        if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
                        if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
                        if (navigator.getGamepads) {
                            const gpIdx = myPid === 'p1' ? 0 : 1;
                            const gp = navigator.getGamepads()[gpIdx];
                            if (gp && gp.connected) {
                                if (Math.abs(gp.axes[0]) > 0.2) dx += gp.axes[0];
                                if (Math.abs(gp.axes[1]) > 0.2) dy += gp.axes[1];
                                if (gp.buttons[12] && gp.buttons[12].pressed) dy -= 1;
                                if (gp.buttons[13] && gp.buttons[13].pressed) dy += 1;
                                if (gp.buttons[14] && gp.buttons[14].pressed) dx -= 1;
                                if (gp.buttons[15] && gp.buttons[15].pressed) dx += 1;
                            }
                        }
                        if (dx || dy) {
                            const len = Math.sqrt(dx * dx + dy * dy) || 1;
                            const isOfansif = me.profile && me.profile.id === 'ofansif';
                            const boost = (me.speedBoostTimer > 0) ? 1.9 : 1.0;
                            const profileMod = isOfansif ? 1.1 : 1.0;
                            const ballHold = (gs.ball && gs.ball.holder === myPid && !isOfansif) ? 0.8 : 1;
                            const powered = (me.poweredTimer > 0) ? 1.4 : 1.0;
                            const speed = __PRED_SPEED * boost * profileMod * ballHold * powered;
                            const step = speed * (dt / (1000 / 60));
                            __pred.x += (dx / len) * step;
                            __pred.y += (dy / len) * step;
                            __pred.lastDirX = dx / len;
                            __pred.lastDirY = dy / len;
                        }
                        // Saha sınırları
                        __pred.x = Math.max(FIELD_LEFT + me.r, Math.min(FIELD_RIGHT - me.r, __pred.x));
                        __pred.y = Math.max(FIELD_TOP + me.r, Math.min(FIELD_BOTTOM - me.r, __pred.y));
                    }
                    // Predicted pozisyonu render için player objesine yansıt
                    me.x = __pred.x;
                    me.y = __pred.y;
                    if (__pred.lastDirX || __pred.lastDirY) {
                        me.lastDirX = __pred.lastDirX;
                        me.lastDirY = __pred.lastDirY;
                    }
                    // Top sahibimizse top da bizimle gelsin (sunucu zaten yapacak ama gecikmesin)
                    if (gs.ball && gs.ball.holder === myPid) {
                        gs.ball.x = me.x + (me.lastDirX || 0) * (me.r * 0.7);
                        gs.ball.y = me.y + (me.lastDirY || 0) * (me.r * 0.7);
                    }
                }

                const _t0draw = performance.now();
                drawField();
                drawSlowZones();
                drawFreezeProjectile();
                drawHook();
                drawWalls();
                Object.keys(gs.players).forEach(pid => drawPlayer(pid));
                drawBall();
                drawSmokeZones();
                updateParticles();
                drawParticles();
                drawPenaltyBar();
                // Online: kör etme sadece rakip takıma; atan takım normal görüş
                if (gs.blindTimer > 0 && gs.blindOwner && !onlineSameTeam(myPid, gs.blindOwner)) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(0,0,0,0.96)';
                    ctx.fillRect(0, 0, W, H);
                    ctx.restore();
                }
                if (__diag.count < 12) __diag.drawMs.push(performance.now() - _t0draw);
                sendSocketInput();

                // ── Teşhis raporu (5sn'de bir, ilk 60sn) ──────────────────────
                if (__diag.count < 12 && now > __diag.reportAt && __diag.ft.length > 30) {
                    const ftArr = __diag.ft;
                    const ftAvg = ftArr.reduce((a, b) => a + b, 0) / ftArr.length;
                    const ftMax = Math.max(...ftArr);
                    const drops = ftArr.filter(v => v > 20).length;
                    const hardDrops = ftArr.filter(v => v > 33).length;

                    const errArr = __diag.err;
                    const errAvg = errArr.length ? errArr.reduce((a, b) => a + b, 0) / errArr.length : 0;
                    const errMax = errArr.length ? Math.max(...errArr) : 0;
                    const errOver28 = errArr.filter(v => v > 28).length;
                    const snapCount = __diag.snaps;

                    const dArr = __diag.drawMs;
                    const dAvg = dArr.length ? dArr.reduce((a, b) => a + b, 0) / dArr.length : 0;
                    const dMax = dArr.length ? Math.max(...dArr) : 0;

                    console.log(
                        `[fps] avg=${ftAvg.toFixed(1)}ms max=${ftMax.toFixed(0)}ms` +
                        ` drops>20ms=${drops}/${ftArr.length} drops>33ms=${hardDrops}`
                    );
                    console.log(
                        `[pred] errAvg=${errAvg.toFixed(1)}px errMax=${errMax.toFixed(0)}px` +
                        ` reconcile>28px=${errOver28}/${errArr.length} snaps=${snapCount}`
                    );
                    console.log(
                        `[draw] avg=${dAvg.toFixed(2)}ms max=${dMax.toFixed(1)}ms`
                    );
                    const rd = window.__rttDiag;
                    if (rd && rd.samples.length) {
                        const arr = rd.samples.slice().sort((a, b) => a - b);
                        const n = arr.length;
                        const rMin = arr[0];
                        const rMax = arr[n - 1];
                        const rMed = arr[Math.floor(n / 2)];
                        const rP95 = arr[Math.min(n - 1, Math.floor(n * 0.95))];
                        const spikes = arr.filter(v => v > 200).length;
                        console.log(
                            `[rtt] median=${rMed.toFixed(0)}ms p95=${rP95.toFixed(0)}ms` +
                            ` min=${rMin.toFixed(0)}ms max=${rMax.toFixed(0)}ms spikes>200ms=${spikes}/${n}`
                        );
                        // Ekrana RTT göstergesi (median bazlı, avg değil — spike etkilenmez)
                        let pingEl = document.getElementById('ping-indicator');
                        if (!pingEl) {
                            pingEl = document.createElement('div');
                            pingEl.id = 'ping-indicator';
                            pingEl.style.cssText = 'position:fixed;top:8px;right:8px;padding:6px 10px;font:600 12px Inter,sans-serif;border-radius:6px;z-index:9999;pointer-events:none;backdrop-filter:blur(6px);';
                            document.body.appendChild(pingEl);
                        }
                        let color, bg;
                        if (rMed < 80) { color = '#7fffa0'; bg = 'rgba(0,40,0,0.55)'; }
                        else if (rMed < 150) { color = '#ffdf6b'; bg = 'rgba(60,40,0,0.55)'; }
                        else { color = '#ff6b6b'; bg = 'rgba(60,0,0,0.65)'; }
                        pingEl.style.color = color;
                        pingEl.style.background = bg;
                        pingEl.textContent = `${Math.round(rMed)}ms${spikes > 0 ? ` (${spikes} spike)` : ''}`;
                    }
                    __diag.ft = []; __diag.err = []; __diag.drawMs = []; __diag.snaps = 0;
                    __diag.reportAt = now + 5000;
                    __diag.count++;
                }
                if (__diag.reportAt === 0) __diag.reportAt = now + 5000;
            }
            requestAnimationFrame(gameLoop);
        };

        // Do NOT auto-init socket - only init when user picks online mode
        // initSocket(); // removed

        // Tuş haritaları (yerel oyun ile aynı: P1 = Q/E/R/T + Space + F, P2 = U/I/O/P + Enter/Space + L)
        const ABILITY_KEYS_P1 = ['KeyQ', 'KeyE', 'KeyR', 'KeyT'];
        const ABILITY_KEYS_P2 = ['KeyU', 'KeyI', 'KeyO', 'KeyP'];

        // Action mesajlarına anlık predicted pozisyon + yön ekle — pas/skill/tackle gecikmesiz tetiklenir
        function sendAction(extra) {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            const me = gs && gs.players && gs.players[myPid];
            const payload = { type: 'action', ...extra };
            if (me) {
                payload.x = Math.round(me.x * 10) / 10;
                payload.y = Math.round(me.y * 10) / 10;
                payload.dirX = Math.round(me.lastDirX * 100) / 100;
                payload.dirY = Math.round(me.lastDirY * 100) / 100;
            }
            socket.send(JSON.stringify(payload));
            predictAction(extra);
        }

        // CLIENT-SIDE ACTION PREDICTION: pas/tackle/skill tetiklendiğinde anında lokal etki
        // Sunucu sonraki state'te aynı sonucu yollar; uyuşmazlık olursa interpolation düzeltir.
        function predictAction(extra) {
            if (!gs || !gs.players) return;
            const me = gs.players[myPid];
            if (!me || me.frozenTimer > 0) return;
            const oppPid = myPid === 'p1' ? 'p2' : 'p1';
            const opp = gs.players[oppPid];
            const b = gs.ball;
            if (!b) return;

            // Son snapshot'ı güncelle yardımcısı (top pozisyonu lokal değişince interp eski pozisyona dönmesin)
            const syncBallSnapshot = () => {
                if (__snapshots.length) {
                    const last = __snapshots[__snapshots.length - 1];
                    last.ball = { x: b.x, y: b.y, holder: b.holder };
                }
            };
            // Ball'u client-side predict modda başlat: süre RTT'ye göre dinamik
            // Hedef: server snapshot'larının "pas işlendi" state'i client'a ulaşana kadar predict
            // = RTT (input→server→broadcast→client) + küçük güvenlik payı
            const startBallPredict = (defaultDuration) => {
                const rd = window.__rttDiag;
                let rttEst = 150;
                if (rd && rd.samples.length) {
                    const sorted = rd.samples.slice().sort((a, b) => a - b);
                    rttEst = sorted[Math.floor(sorted.length / 2)]; // median (spike'lardan korunaklı)
                }
                const dur = Math.max(defaultDuration, Math.min(400, rttEst * 1.25 + 60));
                __ballHandoffUntil = 0;
                __ballPredict.active = true;
                __ballPredict.until = performance.now() + dur;
                __ballPredict.x = b.x;
                __ballPredict.y = b.y;
                __ballPredict.vx = b.vx || 0;
                __ballPredict.vy = b.vy || 0;
                __ballPredict.lastIntegrated = performance.now();
            };

            if (extra.action === 'pass_press') {
                if (gs.penaltyMode && gs.penaltyMode.active) return;
                const isTeknik = me.profile && me.profile.id === 'teknik';
                // Teknik: pas şarjı başlat (visualization için passCharging set et)
                if (b.holder === myPid && isTeknik) {
                    me.passCharging = true;
                    me.passChargeMs = 0;
                    return;
                }
                // Non-teknik: anında fırlat
                if (b.holder === myPid && !isTeknik) {
                    const PASS_SPEED = 15;
                    const dir = Math.hypot(me.lastDirX, me.lastDirY) || 1;
                    const dx = me.lastDirX / dir, dy = me.lastDirY / dir;
                    // Lob / tutuş çizimi gibi: topu tam ekranda gördüğümüz yerden bırak (__pred + r*0.7), sunucu spawn'ından zıplama olmasın
                    const px = (__pred.x != null && Number.isFinite(__pred.x)) ? __pred.x : me.x;
                    const py = (__pred.y != null && Number.isFinite(__pred.y)) ? __pred.y : me.y;
                    b.holder = null;
                    b.inAir = true;
                    b.vx = dx * PASS_SPEED * 0.72;
                    b.vy = dy * PASS_SPEED * 0.72;
                    b.x = px + dx * (me.r * 0.7);
                    b.y = py + dy * (me.r * 0.7);
                    __ballVisX = b.x;
                    __ballVisY = b.y;
                    syncBallSnapshot();
                    // Uzun pas / şut gibi: client-side ball predict yok — top sadece sunucu snapshot interp (daha tutarlı)
                }
            } else if (extra.action === 'pass_release') {
                // Teknik şarjlı pas serbest bırakıldığında lokal fırlat
                const isTeknik = me.profile && me.profile.id === 'teknik';
                if (isTeknik && me.passCharging && b.holder === myPid) {
                    const PASS_SPEED = 15, MAX_MS = 900;
                    const t = Math.min(1, (me.passChargeMs || 0) / MAX_MS);
                    const speedMult = 1 + t * 1.45;
                    const dir = Math.hypot(me.lastDirX, me.lastDirY) || 1;
                    const dx = me.lastDirX / dir, dy = me.lastDirY / dir;
                    const px = (__pred.x != null && Number.isFinite(__pred.x)) ? __pred.x : me.x;
                    const py = (__pred.y != null && Number.isFinite(__pred.y)) ? __pred.y : me.y;
                    b.holder = null;
                    b.inAir = true;
                    b.vx = dx * PASS_SPEED * speedMult;
                    b.vy = dy * PASS_SPEED * speedMult;
                    b.x = px + dx * (me.r * 0.7);
                    b.y = py + dy * (me.r * 0.7);
                    __ballVisX = b.x;
                    __ballVisY = b.y;
                    me.passCharging = false;
                    me.passChargeMs = 0;
                    syncBallSnapshot();
                }
            } else if (extra.action === 'tackle') {
                if (gs.penaltyMode || me.slideTimer > 0) return;
                const distOpp = opp ? Math.hypot(opp.x - me.x, opp.y - me.y) : 9999;
                const distBall = Math.hypot(b.x - me.x, b.y - me.y);
                const TACKLE_RANGE = 52, BALL_R = 10;
                if (distOpp <= TACKLE_RANGE && b.holder === oppPid) {
                    b.holder = myPid; b.vx = 0; b.vy = 0; b.inAir = false;
                    b.shotMode = false; b.shotOwner = null;
                    b.longPassMode = false; b.longPassOwner = null;
                    b.teknikPassMode = false;
                    syncBallSnapshot();
                } else if (b.holder === null && !b.lobMode && distBall <= me.r + BALL_R + 10) {
                    b.holder = myPid; b.vx = 0; b.vy = 0; b.inAir = false;
                    b.shotMode = false; b.shotOwner = null;
                    b.longPassMode = false; b.longPassOwner = null;
                    b.teknikPassMode = false;
                    syncBallSnapshot();
                }
            } else if (extra.action === 'ability_press' && typeof extra.idx === 'number') {
                const ab = me.abilities && me.abilities[extra.idx];
                if (!ab || (ab.cdLeft && ab.cdLeft > 0) || !ab.cd) return;

                // Slide skill — kayma hareketini lokal başlat
                if (ab.id === 'slide') {
                    const dir = Math.hypot(me.lastDirX, me.lastDirY) || 1;
                    me.slideVx = (me.lastDirX / dir) * 14;
                    me.slideVy = (me.lastDirY / dir) * 14;
                    me.slideTimer = 400;
                    ab.cdLeft = ab.cd; ab.active = true;
                    return;
                }
                // Power — anında glow
                if (ab.id === 'power') {
                    me.poweredTimer = 2000;
                    ab.cdLeft = ab.cd; ab.active = true;
                    return;
                }
                // SelfPass — anında ileri lobla
                if (ab.id === 'selfpass' && b.holder === myPid) {
                    const angle = 0.35;
                    const cos = Math.cos(angle), sin = Math.sin(angle);
                    const kx = me.lastDirX * cos - me.lastDirY * sin;
                    const ky = me.lastDirX * sin + me.lastDirY * cos;
                    b.holder = null; b.inAir = true;
                    b.vx = kx * 9.5; b.vy = ky * 9.5;
                    me.poweredTimer = Math.max(me.poweredTimer || 0, 1200);
                    ab.cdLeft = ab.cd; ab.active = true;
                    syncBallSnapshot();
                    startBallPredict(250);
                    return;
                }
                // Speedboost — anında boost
                if (ab.id === 'speedboost') {
                    me.speedBoostTimer = ab.duration || 1000;
                    ab.cdLeft = ab.cd; ab.active = true;
                    return;
                }
                // Diğer instant skill'ler için sadece HUD cooldown
                const instantHud = ['freeze', 'reverse', 'hook', 'invisball', 'blind', 'shot', 'clone', 'geopas'];
                if (instantHud.includes(ab.id)) {
                    ab.cdLeft = ab.cd; ab.active = true;
                }
            }
        }

        window.addEventListener('keydown', e => {
            if (!gameStarted) return;
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
            if (e.repeat) return;
            const list = myPid === 'p1' ? ABILITY_KEYS_P1 : ABILITY_KEYS_P2;
            const idx = list.indexOf(e.code);
            if (idx >= 0) {
                sendAction({ action: 'ability_press', idx });
                return;
            }
            if ((myPid === 'p1' && e.code === 'Space') || (myPid === 'p2' && (e.code === 'Space' || e.code === 'Enter'))) {
                sendAction({ action: 'pass_press' });
            }
            if ((myPid === 'p1' && e.code === 'KeyF') || (myPid === 'p2' && e.code === 'KeyL')) {
                sendAction({ action: 'tackle' });
            }
        });

        window.addEventListener('keyup', e => {
            if (!gameStarted) return;
            const list = myPid === 'p1' ? ABILITY_KEYS_P1 : ABILITY_KEYS_P2;
            const idx = list.indexOf(e.code);
            if (idx >= 0) {
                sendAction({ action: 'ability_release', idx });
                return;
            }
            if ((myPid === 'p1' && e.code === 'Space') || (myPid === 'p2' && (e.code === 'Space' || e.code === 'Enter'))) {
                sendAction({ action: 'pass_release' });
            }
        });

        // ─────────── GAMEPAD INPUT (yerel oyunla aynı buton düzeni) ───────────
        const ABILITY_GAMEPAD_BUTTONS = [4, 5, 3, 1]; // LB, RB, Y/Triangle, B/Circle
        const __gpPrev = { p1: { a: [false, false, false, false], pass: false, tackle: false }, p2: { a: [false, false, false, false], pass: false, tackle: false } };
        function pollOnlineGamepad() {
            if (!gameStarted || !navigator.getGamepads) return;
            const gpIdx = myPid === 'p1' ? 0 : 1;
            const gps = navigator.getGamepads();
            const gp = gps && gps[gpIdx];
            if (!gp || !gp.connected) return;
            const prev = __gpPrev[myPid];
            for (let i = 0; i < ABILITY_GAMEPAD_BUTTONS.length; i++) {
                const btn = gp.buttons[ABILITY_GAMEPAD_BUTTONS[i]];
                const now = !!(btn && btn.pressed);
                if (now && !prev.a[i]) sendAction({ action: 'ability_press', idx: i });
                if (!now && prev.a[i]) sendAction({ action: 'ability_release', idx: i });
                prev.a[i] = now;
            }
            const passNow = !!(gp.buttons[0] && gp.buttons[0].pressed);
            if (passNow && !prev.pass) sendAction({ action: 'pass_press' });
            if (!passNow && prev.pass) sendAction({ action: 'pass_release' });
            prev.pass = passNow;
            const tackleNow = !!(gp.buttons[2] && gp.buttons[2].pressed);
            if (tackleNow && !prev.tackle) sendAction({ action: 'tackle' });
            prev.tackle = tackleNow;
        }
        setInterval(pollOnlineGamepad, 50);

        // Yerel input fonksiyonuna analog/dpad ekle + WS gönderimini seyrekleştir (tampon taşması / takılma)
        sendSocketInput = function () {
            if (!gameStarted || !socket || socket.readyState !== WebSocket.OPEN) return;
            let dx = 0, dy = 0;
            if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
            if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
            if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
            if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
            const gps = navigator.getGamepads ? navigator.getGamepads() : null;
            const gpIdx = myPid === 'p1' ? 0 : 1;
            const gp = gps && gps[gpIdx];
            if (gp && gp.connected) {
                let gpX = 0, gpY = 0, usingAnalog = false;
                if (Math.abs(gp.axes[0]) > 0.2) { gpX = gp.axes[0]; usingAnalog = true; }
                if (Math.abs(gp.axes[1]) > 0.2) { gpY = gp.axes[1]; usingAnalog = true; }
                if (gp.buttons[12] && gp.buttons[12].pressed) { gpY -= 1; usingAnalog = false; }
                if (gp.buttons[13] && gp.buttons[13].pressed) { gpY += 1; usingAnalog = false; }
                if (gp.buttons[14] && gp.buttons[14].pressed) { gpX -= 1; usingAnalog = false; }
                if (gp.buttons[15] && gp.buttons[15].pressed) { gpX += 1; usingAnalog = false; }
                if (usingAnalog && dx === 0 && dy === 0) { dx = gpX; dy = gpY; }
                else { dx += gpX; dy += gpY; }
            }
            let penaltyBarBoost = false;
            const pm = gs && gs.penaltyMode;
            if (pm && pm.active && !pm.shot && pm.keeper === myPid) {
                penaltyBarBoost = !!(myPid === 'p1' ? keys['KeyF'] : keys['KeyL']);
                if (!penaltyBarBoost && gp && gp.connected && gp.buttons[2] && gp.buttons[2].pressed) penaltyBarBoost = true;
            }
            let wallHeld = false;
            const me = gs && gs.players && gs.players[myPid];
            if (me && me.wallPreview && me.wallPreview.active) {
                const wallAb = me.abilities && me.abilities.find(a => a.id === 'wall');
                if (wallAb && wallAb.key && keys[wallAb.key]) wallHeld = true;
                if (!wallHeld && gp && gp.connected && wallAb) {
                    const abIdx = me.abilities.indexOf(wallAb);
                    const btnIdx = ABILITY_GAMEPAD_BUTTONS[abIdx];
                    if (btnIdx != null && gp.buttons[btnIdx] && gp.buttons[btnIdx].pressed) wallHeld = true;
                }
            }
            const now = performance.now();
            const qdx = Math.round(dx * 4) / 4;
            const qdy = Math.round(dy * 4) / 4;
            const sig = qdx + '\0' + qdy + '\0' + (penaltyBarBoost ? 1 : 0) + '\0' + (wallHeld ? 1 : 0);
            const active = qdx !== 0 || qdy !== 0 || penaltyBarBoost || wallHeld;
            const changed = sig !== __inputSendSig;
            const heartbeat = active && (now - __lastInputPacketSentAt >= 50);
            if (!changed && !heartbeat) return;
            // Aynı vektörü sürekli yollamayı kes; yön değişince anında yolla. Tampon şişerse yine de yön değişimini düşürme.
            if (socket.bufferedAmount > 16384 && !changed) return;
            __inputSendSig = sig;
            __lastInputPacketSentAt = now;
            socket.send(JSON.stringify({ type: 'input', dx, dy, penaltyBarBoost, wallHeld }));
        };

