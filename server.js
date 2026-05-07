const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve the dynamically generated online version by default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'indextoonline.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// ─── GAME CONSTANTS ───
const W = 900, H = 520;
const FIELD_MARGIN = 40;
const END_ZONE_W = 80;
const FIELD_LEFT = FIELD_MARGIN;
const FIELD_RIGHT = W - FIELD_MARGIN;
const FIELD_TOP = FIELD_MARGIN;
const FIELD_BOTTOM = H - FIELD_MARGIN;
const PLAY_LEFT = FIELD_LEFT + END_ZONE_W;
const PLAY_RIGHT = FIELD_RIGHT - END_ZONE_W;
const PLAYER_R = 18;
const BALL_R = 10;
const PLAYER_SPEED = 3.2;
const BALL_FRICTION = 0.93;
const THROW_SPEED = 7;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const WIN_SCORE = 5;
const GAME_DURATION = 180;

const ALL_SKILLS = [
  { id: 'clone', icon: '🧬', name: 'Klon', color: '#00d4ff', cd: 9000, duration: 5000, desc: 'Bastığın yerde hayalet kopya bırakır. Top değerse yer değiştirirsin.' },
  { id: 'slide', icon: '⚡', name: 'Kayma', color: '#aa00ff', cd: 5000, duration: 400, desc: 'Hızlıca ileri atılırsın. Rakibe çarparsan topu düşürebilir.' },
  { id: 'power', icon: '💥', name: 'Güç', color: '#ffd700', cd: 10000, duration: 2500, desc: 'Geçici hız ve güç artışı. Dokunduğun rakibi yere yıkar.' },
  { id: 'freeze', icon: '❄️', name: 'Dondur', color: '#88eeff', cd: 8500, duration: 2000, desc: 'Rakibi donduran bir buz mermisi fırlatır.' },
  { id: 'reverse', icon: '🔀', name: 'Tersle', color: '#ff88bb', cd: 9000, duration: 4000, desc: 'Rakibin yön kontrollerini tersine çevirir.' },
  { id: 'lob', icon: '🚀', name: 'Aşırtma', color: '#ffaa00', cd: 7500, duration: 0, desc: 'Topu havadan ileri fırlatır. Tutarak mesafeyi ayarla.' },
  { id: 'sloworb', icon: '🔮', name: 'Yavaşlat', color: '#33ffaa', cd: 9500, duration: 4000, desc: 'Yavaşlatma alanı oluşturan bir küre fırlatır.' },
  { id: 'grow', icon: '🛡️', name: 'Büyü', color: '#ff5500', cd: 11000, duration: 5000, desc: 'Boyutun büyür, alanı kapatırsın ama yavaşlarsın.' },
  { id: 'shrink', icon: '💨', name: 'Küçül', color: '#00ffaa', cd: 11000, duration: 5000, desc: 'Küçülürsün ve çok hızlanırsın.' },
  { id: 'smoke', icon: '🌫️', name: 'Sis', color: '#ffffff', cd: 10000, duration: 4500, desc: 'Görüşü engelleyen yoğun bir sis bulutu fırlatır.' },
  { id: 'hook', icon: '🪝', name: 'Kanca', color: '#ffaa33', cd: 9000, duration: 1000, desc: 'Rakibi kendine çeken bir kanca fırlatır.' },
  { id: 'foul', icon: '🟥', name: 'Faul', color: '#ff0000', cd: 3000, duration: 0, desc: 'Rakibi kasten itersin. 3 faul penaltıya sebep olur!' }
];

const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.players = { p1: null, p2: null };
    this.selectedSkills = { p1: [], p2: [] };
    this.gs = null;
    this.ticker = null;
    this.started = false;
    this.lastTick = 0;
    this.timeLeft = GAME_DURATION;
    this.timerTick = 0;
    this.flashes = [];
  }

  broadcast(data) {
    const str = JSON.stringify(data);
    ['p1', 'p2'].forEach(pid => {
      const ws = this.players[pid];
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(str);
    });
  }

  send(pid, data) {
    const ws = this.players[pid];
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  initState() {
    const oldScore = this.gs ? this.gs.score : [0, 0];
    const oldFouls = this.gs ? this.gs.foulAttempts : { p1: 0, p2: 0 };
    this.gs = {
      score: oldScore,
      tackleCooldown: 0,
      freezeProjectile: null,
      hookProjectile: null,
      slowOrbProjectiles: [],
      slowZones: [],
      smokeProjectiles: [],
      smokeZones: [],
      foulAttempts: oldFouls,
      penaltyMode: null,
      ball: {
        x: W / 2, y: H / 2, vx: 0, vy: 0, holder: null, inAir: false,
        lobMode: false, lobProgress: 0, lobFrom: null, lobTo: null,
      },
      players: {
        p1: this.createPlayerData('p1'),
        p2: this.createPlayerData('p2'),
      },
    };
  }

  createPlayerData(pid) {
    const isP1 = pid === 'p1';
    return {
      x: isP1 ? PLAY_LEFT + 60 : PLAY_RIGHT - 60, y: H / 2, r: PLAYER_R,
      color: isP1 ? '#00d4ff' : '#ff4d6d',
      facing: isP1 ? 1 : -1,
      frozenTimer: 0, poweredTimer: 0, slideTimer: 0, slideVx: 0, slideVy: 0,
      clones: [], controlsReversedTimer: 0, lastDirX: isP1 ? 1 : -1, lastDirY: 0,
      growTimer: 0, shrinkTimer: 0, pullingTimer: 0, pulledBy: null,
      lobCharging: false, lobChargeTimer: 0, slowOrbCharging: false, slowOrbChargeTimer: 0, smokeCharging: false, smokeChargeTimer: 0,
      abilities: (this.selectedSkills[pid] || []).map(sk => ({ ...sk, cdLeft: 0, active: false })),
      inputDX: 0, inputDY: 0,
    };
  }

  useAbility(pid, idx) {
    const p = this.gs.players[pid];
    const ab = p.abilities[idx];
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0 || this.gs.penaltyMode) return;
    const oppPid = pid === 'p1' ? 'p2' : 'p1';
    const opp = this.gs.players[oppPid];

    switch (ab.id) {
      case 'clone':
        ab.cdLeft = ab.cd;
        const realDY = Math.random() < 0.5 ? -72 : 72;
        const cloneY = p.y - realDY;
        p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, p.y + realDY));
        p.clones.push({ x: p.x, y: Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, cloneY)), life: ab.duration });
        this.addFlash('🧬 KLON!', p.color);
        break;
      case 'slide':
        ab.cdLeft = ab.cd;
        let s_dx = p.inputDX || p.lastDirX, s_dy = p.inputDY || p.lastDirY;
        const s_len = Math.sqrt(s_dx * s_dx + s_dy * s_dy) || 1;
        p.slideVx = (s_dx / s_len) * 14; p.slideVy = (s_dy / s_len) * 14;
        p.slideTimer = ab.duration;
        this.addFlash('⚡ KAYMA!', '#aa00ff');
        break;
      case 'power': ab.cdLeft = ab.cd; p.poweredTimer = ab.duration; this.addFlash('💥 GÜÇ MODU!', '#ffd700'); break;
      case 'freeze':
        ab.cdLeft = ab.cd;
        const f_angle = Math.atan2(opp.y - p.y, opp.x - p.x);
        this.gs.freezeProjectile = { x: p.x, y: p.y, vx: Math.cos(f_angle) * 9, vy: Math.sin(f_angle) * 9, life: 120, owner: pid };
        this.addFlash('❄️ DONDUR!', '#88eeff');
        break;
      case 'reverse': ab.cdLeft = ab.cd; opp.controlsReversedTimer = ab.duration; this.addFlash('🔀 TERSLE!', '#ff88bb'); break;
      case 'lob': if (this.gs.ball.holder === pid) { p.lobCharging = true; p.lobChargeTimer = 0; } break;
      case 'sloworb': p.slowOrbCharging = true; p.slowOrbChargeTimer = 0; break;
      case 'grow': ab.cdLeft = ab.cd; p.growTimer = ab.duration; p.shrinkTimer = 0; this.addFlash('🛡️ DEVLEŞTİ!', p.color); break;
      case 'shrink': ab.cdLeft = ab.cd; p.shrinkTimer = ab.duration; p.growTimer = 0; this.addFlash('💨 KÜÇÜLDÜ!', p.color); break;
      case 'smoke': p.smokeCharging = true; p.smokeChargeTimer = 0; break;
      case 'hook':
        ab.cdLeft = ab.cd;
        const h_angle = Math.atan2(opp.y - p.y, opp.x - p.x);
        this.gs.hookProjectile = { x: p.x, y: p.y, vx: Math.cos(h_angle) * 11, vy: Math.sin(h_angle) * 11, life: 100, owner: pid };
        this.addFlash('🪝 KANCA!', '#ffaa33');
        break;
      case 'foul': this.triggerFoul(pid); break;
    }
  }



  startPenaltyMode(kicker, keeper) {
    this.gs.penaltyMode = { active: true, kicker, keeper, barPos: 0, barDir: 1, barSpeed: 0.015, greenStart: 0.35 + Math.random() * 0.3, greenWidth: 0.15, shot: false, goalX: keeper === 'p1' ? PLAY_LEFT : PLAY_RIGHT, goalY: H / 2, goalH: 160 };
    this.gs.ball.holder = null; this.gs.ball.x = kicker === 'p1' ? W / 2 - 100 : W / 2 + 100; this.gs.ball.y = H / 2; this.gs.ball.vx = 0; this.gs.ball.vy = 0;
    this.addFlash('🚨 PENALTI!', '#ffaa00');
  }

  executeLobPass(pid) {
    const p = this.gs.players[pid]; const b = this.gs.ball;
    if (!p.lobCharging || b.holder !== pid) { p.lobCharging = false; return; }
    p.lobCharging = false; const ab = p.abilities.find(a => a.id === 'lob'); if (ab) ab.cdLeft = ab.cd;
    const dist = (p.lobChargeTimer / 1500) * (W * 0.85);
    b.holder = null; b.lobMode = true; b.lobProgress = 0; b.lobFrom = { x: p.x, y: p.y }; b.lobTo = { x: p.x + p.lastDirX * dist, y: p.y + p.lastDirY * dist }; b.inAir = true;
    this.addFlash('🚀 AŞIRTMA!', p.color);
  }

  executeSlowOrb(pid) {
    const p = this.gs.players[pid]; if (!p.slowOrbCharging) return;
    p.slowOrbCharging = false; const ab = p.abilities.find(a => a.id === 'sloworb'); if (ab) ab.cdLeft = ab.cd;
    const dist = (p.slowOrbChargeTimer / 1200) * (W * 0.85);
    this.gs.slowOrbProjectiles.push({ startX: p.x, startY: p.y, x: p.x, y: p.y, targetX: p.x + p.lastDirX * dist, targetY: p.y + p.lastDirY * dist, progress: 0, duration: 4000, owner: pid });
  }

  executeSmoke(pid) {
    const p = this.gs.players[pid]; if (!p.smokeCharging) return;
    p.smokeCharging = false; const ab = p.abilities.find(a => a.id === 'smoke'); if (ab) ab.cdLeft = ab.cd;
    const dist = (p.smokeChargeTimer / 1200) * (W * 0.85);
    this.gs.smokeProjectiles.push({ startX: p.x, startY: p.y, x: p.x, y: p.y, targetX: p.x + p.lastDirX * dist, targetY: p.y + p.lastDirY * dist, progress: 0, duration: 4500, owner: pid });
  }

  addFlash(msg, color) { this.flashes.push({ msg, color, ttl: 3 }); }

  actionThrowOrTackle(pid) {
    const b = this.gs.ball; const p = this.gs.players[pid]; const oppPid = pid === 'p1' ? 'p2' : 'p1'; const opp = this.gs.players[oppPid];
    if (p.frozenTimer > 0 || this.gs.penaltyMode) return;
    const distToOpp = Math.hypot(opp.x - p.x, opp.y - p.y);
    const distToBall = Math.hypot(b.x - p.x, b.y - p.y);

    if (b.holder === pid) {
      b.holder = null; b.inAir = true; const dx = opp.x - p.x, dy = opp.y - p.y; const len = Math.sqrt(dx * dx + dy * dy) || 1;
      b.vx = (dx / len) * THROW_SPEED; b.vy = (dy / len) * THROW_SPEED;
      return;
    }

    if (distToOpp <= 52) {
      if (b.holder === oppPid) {
        const dBallX = b.x - p.x; const dBallY = b.y - p.y; const dBall = Math.sqrt(dBallX * dBallX + dBallY * dBallY);
        let carrierBlocking = false;
        if (dBall > 1) {
          const rayX = dBallX / dBall, rayY = dBallY / dBall, proj = (opp.x - p.x) * rayX + (opp.y - p.y) * rayY;
          if (proj > 0 && proj < dBall) {
            const cx = p.x + rayX * proj, cy = p.y + rayY * proj;
            if (Math.hypot(cx - opp.x, cy - opp.y) < opp.r * 0.85) carrierBlocking = true;
          }
        }
        if (carrierBlocking) {
          this.gs.foulAttempts[pid]++;
          if (this.gs.foulAttempts[pid] >= 2) {
            this.gs.foulAttempts[pid] = 0;
            this.startPenaltyMode(oppPid, pid);
          } else { this.addFlash(`🚨 VÜCUT FAULÜ! (${this.gs.foulAttempts[pid]}/2)`, '#ff4444'); }
        } else {
          b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false; this.gs.foulAttempts[pid] = 0; this.gs.tackleCooldown = 600; this.addFlash('🏈 KAPTIRDI!', '#fff');
        }
      } else {
        this.gs.foulAttempts[pid]++;
        if (this.gs.foulAttempts[pid] >= 2) {
          this.gs.foulAttempts[pid] = 0;
          this.startPenaltyMode(oppPid, pid);
        } else { this.addFlash(`🚨 TOPSUZ ALAN FAULÜ! (${this.gs.foulAttempts[pid]}/2)`, '#ff4444'); }
      }
      return;
    }

    if (b.holder === null && !b.lobMode && distToBall <= p.r + BALL_R + 10) {
      b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
    }
  }

  directionalPass(pid) {
    const b = this.gs.ball; const p = this.gs.players[pid]; if (b.holder !== pid || p.frozenTimer > 0) return;
    if (this.gs.penaltyMode) { if (pid === this.gs.penaltyMode.kicker && !this.gs.penaltyMode.shot) this.shootPenalty(); return; }
    b.holder = null; b.inAir = true; b.vx = p.lastDirX * 15; b.vy = p.lastDirY * 15; b.x = p.x + p.lastDirX * (p.r + BALL_R + 2); b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
    this.addFlash('🏈 PAS!', p.color);
  }

  shootPenalty() {
    const pm = this.gs.penaltyMode; pm.shot = true; const b = this.gs.ball;
    const inGreen = pm.barPos >= pm.greenStart && pm.barPos <= pm.greenStart + pm.greenWidth;
    const angle = inGreen ? 0 : (Math.random() - 0.5) * 0.6;
    b.vx = (pm.kicker === 'p1' ? 1 : -1) * Math.cos(angle) * 12; b.vy = Math.sin(angle) * 12;
    this.addFlash(inGreen ? '🎯 MÜKEMMEL ŞUT!' : '⚡ SERT ŞUT!', '#fff');
  }

  pickupBall(pid) {
    const b = this.gs.ball; const p = this.gs.players[pid]; if (b.holder !== null || b.lobMode || this.gs.penaltyMode) return;
    if (Math.sqrt((p.x - b.x) ** 2 + (p.y - b.y) ** 2) < p.r + BALL_R + 4) { b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false; }
  }

  tick(dt) {
    if (!this.gs) return;
    this.updatePlayer('p1', dt); this.updatePlayer('p2', dt); this.updateBall(dt); this.updatePenaltyBar(dt); this.checkCollisions(dt);
    ['p1', 'p2'].forEach(pid => { this.gs.players[pid].abilities.forEach(ab => { if (ab.cdLeft > 0) { ab.cdLeft -= dt; if (ab.cdLeft <= 0) { ab.cdLeft = 0; ab.active = false; } } }); });
    this.checkGoal(); this.timerTick += dt;
    if (this.timerTick >= 1000) { this.timerTick -= 1000; this.timeLeft--; if (this.timeLeft <= 0) { const winner = this.gs.score[0] > this.gs.score[1] ? 'p1' : (this.gs.score[1] > this.gs.score[0] ? 'p2' : 'draw'); this.endGame(winner); return; } }
    const flashes = [...this.flashes]; this.flashes = [];
    this.broadcast({ type: 'state', gs: { score: this.gs.score, timeLeft: this.timeLeft, tackleCooldown: this.gs.tackleCooldown, freezeProjectile: this.gs.freezeProjectile, hookProjectile: this.gs.hookProjectile, slowOrbProjectiles: this.gs.slowOrbProjectiles, slowZones: this.gs.slowZones, smokeProjectiles: this.gs.smokeProjectiles, smokeZones: this.gs.smokeZones, penaltyMode: this.gs.penaltyMode, ball: this.gs.ball, players: { p1: this.serializePlayer(this.gs.players.p1), p2: this.serializePlayer(this.gs.players.p2) } }, flashes });
  }

  serializePlayer(p) { return { x: p.x, y: p.y, r: p.r, facing: p.facing, frozenTimer: p.frozenTimer, poweredTimer: p.poweredTimer, slideTimer: p.slideTimer, slideVx: p.slideVx, slideVy: p.slideVy, clones: p.clones, controlsReversedTimer: p.controlsReversedTimer, lastDirX: p.lastDirX, lastDirY: p.lastDirY, growTimer: p.growTimer, shrinkTimer: p.shrinkTimer, pullingTimer: p.pullingTimer, pulledBy: p.pulledBy, lobCharging: p.lobCharging, slowOrbCharging: p.slowOrbCharging, smokeCharging: p.smokeCharging, abilities: p.abilities.map(a => ({ id: a.id, cdLeft: a.cdLeft, active: a.active, cd: a.cd })) }; }

  updatePlayer(pid, dt) {
    const p = this.gs.players[pid]; if (this.gs.penaltyMode && this.gs.penaltyMode.active) { if (pid === this.gs.penaltyMode.keeper) return; if (pid === this.gs.penaltyMode.kicker && this.gs.penaltyMode.shot) return; }
    if (p.frozenTimer > 0) { p.frozenTimer -= dt; return; }
    if (p.growTimer > 0) { p.r = PLAYER_R * 1.5; p.growTimer -= dt; } else if (p.shrinkTimer > 0) { p.r = PLAYER_R * 0.65; p.shrinkTimer -= dt; } else { p.r = PLAYER_R; }
    if (p.pullingTimer > 0) { p.pullingTimer -= dt; const owner = this.gs.players[p.pulledBy]; if (owner) { const pdx = owner.x - p.x, pdy = owner.y - p.y; const pdist = Math.sqrt(pdx * pdx + pdy * pdy); if (pdist > 40) { p.x += (pdx / pdist) * 8; p.y += (pdy / pdist) * 8; } } clampPlayer(p); return; }
    if (p.slideTimer > 0) { p.slideTimer -= dt; p.x += p.slideVx; p.y += p.slideVy; p.slideVx *= 0.9; p.slideVy *= 0.9; clampPlayer(p); if (this.gs.ball.holder === pid) { this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7); this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7); } return; }
    let dx = p.inputDX || 0, dy = p.inputDY || 0; if (p.controlsReversedTimer > 0) { dx = -dx; dy = -dy; p.controlsReversedTimer -= dt; }
    let slowFactor = 1; this.gs.slowZones.forEach(z => { if (Math.sqrt((p.x - z.x) ** 2 + (p.y - z.y) ** 2) < z.radius) slowFactor = 0.45; });
    const speed = PLAYER_SPEED * slowFactor * (this.gs.ball.holder === pid ? 0.8 : 1) * (p.poweredTimer > 0 ? 1.4 : 1) * (p.growTimer > 0 ? 0.7 : 1) * (p.shrinkTimer > 0 ? 1.35 : 1);
    const len = Math.sqrt(dx * dx + dy * dy) || 1; if (dx !== 0 || dy !== 0) { p.x += (dx / len) * speed; p.y += (dy / len) * speed; p.lastDirX = dx / len; p.lastDirY = dy / len; if (pid === 'p1') { p.clones.forEach(c => { c.x += (dx / len) * speed; c.y += (dy / len) * speed; c.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, c.x)); c.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, c.y)); }); } }
    if (pid === 'p1') p.clones = p.clones.filter(c => { c.life -= dt; return c.life > 0; });
    if (p.poweredTimer > 0) p.poweredTimer -= dt; if (p.lobCharging) p.lobChargeTimer += dt; if (p.slowOrbCharging) p.slowOrbChargeTimer += dt; if (p.smokeCharging) p.smokeChargeTimer += dt;
    clampPlayer(p); if (this.gs.ball.holder === pid) { this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7); this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7); }
  }

  updateBall(dt) {
    const b = this.gs.ball; if (b.holder !== null) return;
    if (b.lobMode) { b.lobProgress += 0.018; if (b.lobProgress >= 1) { b.lobProgress = 1; b.lobMode = false; b.x = b.lobTo.x; b.y = b.lobTo.y; b.vx = 0; b.vy = 0; b.inAir = false; } else { const t = b.lobProgress; const mx = (b.lobFrom.x + b.lobTo.x) / 2, my = Math.min(b.lobFrom.y, b.lobTo.y) - 120; b.x = (1 - t) * (1 - t) * b.lobFrom.x + 2 * (1 - t) * t * mx + t * t * b.lobTo.x; b.y = (1 - t) * (1 - t) * b.lobFrom.y + 2 * (1 - t) * t * my + t * t * b.lobTo.y; } return; }
    b.x += b.vx; b.y += b.vy; if (!(this.gs.penaltyMode && this.gs.penaltyMode.shot)) { b.vx *= BALL_FRICTION; b.vy *= BALL_FRICTION; if (b.x - BALL_R < FIELD_LEFT) { b.x = FIELD_LEFT + BALL_R; b.vx *= -0.82; } if (b.x + BALL_R > FIELD_RIGHT) { b.x = FIELD_RIGHT - BALL_R; b.vx *= -0.82; } if (b.y - BALL_R < FIELD_TOP) { b.y = FIELD_TOP + BALL_R; b.vy *= -0.82; } if (b.y + BALL_R > FIELD_BOTTOM) { b.y = FIELD_BOTTOM - BALL_R; b.vy *= -0.82; } }
    if (Math.abs(b.vx) < 0.1) b.vx = 0; if (Math.abs(b.vy) < 0.1) b.vy = 0;
  }

  updatePenaltyBar(dt) { const pm = this.gs.penaltyMode; if (!pm || !pm.active || pm.shot) return; pm.barPos += pm.barDir * pm.barSpeed; if (pm.barPos > 1) { pm.barPos = 1; pm.barDir = -1; } if (pm.barPos < 0) { pm.barPos = 0; pm.barDir = 1; } }

  checkCollisions(dt) {
    const { p1, p2 } = this.gs.players; const b = this.gs.ball; if (this.gs.tackleCooldown > 0) this.gs.tackleCooldown -= dt;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, dist = Math.sqrt(dx * dx + dy * dy), minDist = p1.r + p2.r;
    if (dist < minDist && dist > 0) { const nx = dx / dist, ny = dy / dist, overlap = minDist - dist; p1.x -= nx * overlap * 0.5; p1.y -= ny * overlap * 0.5; p2.x += nx * overlap * 0.5; p2.y += ny * overlap * 0.5; if (this.gs.tackleCooldown <= 0) { if (p1.poweredTimer > 0 && b.holder === 'p2') { b.holder = null; b.vx = nx * 6; b.vy = ny * 6; this.gs.tackleCooldown = 800; } else if (p2.poweredTimer > 0 && b.holder === 'p1') { b.holder = null; b.vx = -nx * 6; b.vy = -ny * 6; this.gs.tackleCooldown = 800; } } }
    if (Math.sqrt(b.vx ** 2 + b.vy ** 2) < 2) { ['p1', 'p2'].forEach(pid => { const p = this.gs.players[pid]; if (b.holder === null && !b.lobMode && p.frozenTimer <= 0 && !this.gs.penaltyMode) { if (Math.sqrt((b.x - p.x) ** 2 + (b.y - p.y) ** 2) < p.r + BALL_R) { b.holder = pid; b.vx = 0; b.vy = 0; } } }); }
    if (this.gs.freezeProjectile) { const fp = this.gs.freezeProjectile; fp.x += fp.vx; fp.y += fp.vy; fp.life--; const target = this.gs.players[fp.owner === 'p1' ? 'p2' : 'p1']; if (Math.sqrt((fp.x - target.x) ** 2 + (fp.y - target.y) ** 2) < target.r + 6) { target.frozenTimer = 2000; this.gs.freezeProjectile = null; } else if (fp.life <= 0 || fp.x < 0 || fp.x > W || fp.y < 0 || fp.y > H) this.gs.freezeProjectile = null; }
    if (this.gs.hookProjectile) { const hp = this.gs.hookProjectile; hp.x += hp.vx; hp.y += hp.vy; hp.life--; const target = this.gs.players[hp.owner === 'p1' ? 'p2' : 'p1']; if (Math.sqrt((hp.x - target.x) ** 2 + (hp.y - target.y) ** 2) < target.r + 6) { target.pullingTimer = 800; target.pulledBy = hp.owner; this.gs.hookProjectile = null; } else if (hp.life <= 0 || hp.x < 0 || hp.x > W || hp.y < 0 || hp.y > H) this.gs.hookProjectile = null; }
    this.gs.slowOrbProjectiles.forEach((orb, i) => { orb.progress += 0.025; if (orb.progress >= 1) { this.gs.slowZones.push({ x: orb.targetX, y: orb.targetY, radius: 110, life: orb.duration }); this.gs.slowOrbProjectiles.splice(i, 1); } else { const t = orb.progress, mx = (orb.startX + orb.targetX) / 2, my = Math.min(orb.startY, orb.targetY) - 150; orb.x = (1 - t) * (1 - t) * orb.startX + 2 * (1 - t) * t * mx + t * t * orb.targetX; orb.y = (1 - t) * (1 - t) * orb.startY + 2 * (1 - t) * t * my + t * t * orb.targetY; } });
    this.gs.slowZones = this.gs.slowZones.filter(z => { z.life -= dt; return z.life > 0; });
    this.gs.smokeProjectiles.forEach((orb, i) => { orb.progress += 0.022; if (orb.progress >= 1) { this.gs.smokeZones.push({ x: orb.targetX, y: orb.targetY, radius: 145, life: orb.duration }); this.gs.smokeProjectiles.splice(i, 1); } else { orb.x = orb.startX + (orb.targetX - orb.startX) * orb.progress; orb.y = orb.startY + (orb.targetY - orb.startY) * orb.progress; } });
    this.gs.smokeZones = this.gs.smokeZones.filter(z => { z.life -= dt; return z.life > 0; });
    ['p1', 'p2'].forEach(pid => { const p = this.gs.players[pid]; if (b.holder === null && !b.lobMode && p.clones.length > 0 && p.frozenTimer <= 0) { p.clones.forEach(c => { if (Math.sqrt((b.x - c.x) ** 2 + (b.y - c.y) ** 2) < p.r + BALL_R + 8) { const oldX = p.x, oldY = p.y; p.x = c.x; p.y = c.y; c.x = oldX; c.y = oldY; b.holder = pid; } }); } });
  }

  checkGoal() {
    const b = this.gs.ball; if (this.gs.penaltyMode && this.gs.penaltyMode.shot) { const pm = this.gs.penaltyMode; const crossed = pm.keeper === 'p1' ? (b.x < pm.goalX) : (b.x > pm.goalX); if (crossed) { if (Math.abs(b.y - pm.goalY) < pm.goalH / 2) this.scorePoint(pm.kicker); else this.endPenaltyMode(); return true; } if (b.x < 0 || b.x > W || b.y < 0 || b.y > H || (Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5)) { this.endPenaltyMode(); return true; } return false; }
    let scorer = null;['p1', 'p2'].forEach(pid => { const p = this.gs.players[pid]; if (b.holder === pid) { if (pid === 'p1' && p.x > PLAY_RIGHT) scorer = 'p1'; if (pid === 'p2' && p.x < PLAY_LEFT) scorer = 'p2'; } });
    if (b.holder === null && !b.lobMode) { if (b.x - BALL_R < PLAY_LEFT) { b.x = PLAY_LEFT + BALL_R; b.vx = Math.abs(b.vx) * 0.75; } if (b.x + BALL_R > PLAY_RIGHT) { b.x = PLAY_RIGHT - BALL_R; b.vx = -Math.abs(b.vx) * 0.75; } }
    if (scorer) { this.scorePoint(scorer); return true; } return false;
  }

  scorePoint(pid) { const idx = pid === 'p1' ? 0 : 1; this.gs.score[idx]++; this.gs.penaltyMode = null; if (this.gs.score[idx] >= WIN_SCORE) this.endGame(pid); else this.resetRound(); }
  endPenaltyMode() { this.gs.penaltyMode = null; this.resetRound(); }
  resetRound() { this.initState(); }
  endGame(winner) { this.started = false; if (this.ticker) clearInterval(this.ticker); this.broadcast({ type: 'gameover', winner, score: this.gs.score }); }

  startGame() { if (this.started) return; this.initState(); this.started = true; this.timeLeft = GAME_DURATION; this.timerTick = 0; this.lastTick = Date.now(); this.broadcast({ type: 'start' }); this.ticker = setInterval(() => { const now = Date.now(); const dt = now - this.lastTick; this.lastTick = now; this.tick(dt); }, TICK_MS); }
}

function clampPlayer(p) { p.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, p.x)); p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, p.y)); }

wss.on('connection', (ws) => {
  ws.roomId = null; ws.pid = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'create_room') { const roomId = crypto.randomBytes(3).toString('hex').toUpperCase(); const room = new Room(roomId); rooms.set(roomId, room); room.players.p1 = ws; ws.roomId = roomId; ws.pid = 'p1'; ws.send(JSON.stringify({ type: 'room_created', roomId, pid: 'p1', allSkills: ALL_SKILLS })); }
    else if (msg.type === 'join_room') { const roomId = (msg.roomId || '').toUpperCase().trim(); const room = rooms.get(roomId); if (!room || room.players.p2) { ws.send(JSON.stringify({ type: 'error', msg: 'Hata!' })); return; } room.players.p2 = ws; ws.roomId = roomId; ws.pid = 'p2'; ws.send(JSON.stringify({ type: 'room_joined', roomId, pid: 'p2', allSkills: ALL_SKILLS })); room.send('p1', { type: 'opponent_joined' }); }
    else if (msg.type === 'select_skills') { const room = rooms.get(ws.roomId); if (!room) return; room.selectedSkills[ws.pid] = msg.skills; if (room.selectedSkills.p1.length >= 3 && room.selectedSkills.p2.length >= 3) room.startGame(); }
    else if (msg.type === 'input') { const room = rooms.get(ws.roomId); if (!room || !room.started) return; const p = room.gs.players[ws.pid]; if (p) { p.inputDX = msg.dx || 0; p.inputDY = msg.dy || 0; } }
    else if (msg.type === 'action') { const room = rooms.get(ws.roomId); if (!room || !room.started) return; if (msg.action === 'throw') room.actionThrowOrTackle(ws.pid); else if (msg.action === 'pass') room.directionalPass(ws.pid); else if (msg.action === 'ability') room.useAbility(ws.pid, msg.idx); else if (msg.action === 'foul_boost' && room.gs.penaltyMode && room.gs.penaltyMode.keeper === ws.pid) room.gs.penaltyMode.barSpeed += 0.005; }
    else if (msg.type === 'release_ability') { const room = rooms.get(ws.roomId); if (!room || !room.started) return; if (msg.id === 'lob') room.executeLobPass(ws.pid); else if (msg.id === 'sloworb') room.executeSlowOrb(ws.pid); else if (msg.id === 'smoke') room.executeSmoke(ws.pid); }
    else if (msg.type === 'restart') { const room = rooms.get(ws.roomId); if (room) room.restartGame(); }
    else if (msg.type === 'chat') { const room = rooms.get(ws.roomId); if (room) room.broadcast({ type: 'chat', from: ws.pid, text: String(msg.text).slice(0, 80) }); }
  });
  ws.on('close', () => { const room = rooms.get(ws.roomId); if (room) { room.send(ws.pid === 'p1' ? 'p2' : 'p1', { type: 'opponent_left' }); rooms.delete(ws.roomId); } });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🎮 Sunucu ${PORT} portunda aktif!`); });
