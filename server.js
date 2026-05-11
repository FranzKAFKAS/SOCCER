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
const TICK_RATE = 30;
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
  constructor(id, teamSize = 1) {
    this.id = id;
    this.teamSize = Math.max(1, Math.min(3, Number(teamSize) || 1));
    this.maxPlayers = this.teamSize * 2;
    this.players = {};
    this.selectedSkills = {};
    this.gs = null;
    this.ticker = null;
    this.started = false;
    this.lastTick = 0;
    this.timeLeft = GAME_DURATION;
    this.timerTick = 0;
    this.flashes = [];
  }

  getAllPids() {
    return Object.keys(this.players);
  }

  pidByIndex(index) {
    return `p${index + 1}`;
  }

  teamOfPid(pid) {
    const n = Number(pid.replace('p', ''));
    return n <= this.teamSize ? 'p1' : 'p2';
  }

  teamDirection(team) {
    return team === 'p1' ? 1 : -1;
  }

  addPlayer(ws) {
    for (let i = 0; i < this.maxPlayers; i++) {
      const pid = this.pidByIndex(i);
      if (!this.players[pid]) {
        this.players[pid] = ws;
        this.selectedSkills[pid] = [];
        ws.roomId = this.id;
        ws.pid = pid;
        return pid;
      }
    }
    return null;
  }

  removePlayer(pid) {
    delete this.players[pid];
    delete this.selectedSkills[pid];
  }

  isFull() {
    return this.getAllPids().length >= this.maxPlayers;
  }

  broadcast(data) {
    const str = JSON.stringify(data);
    this.getAllPids().forEach(pid => {
      const ws = this.players[pid];
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(str);
    });
  }

  send(pid, data) {
    const ws = this.players[pid];
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  connectedCount() {
    return this.getAllPids().length;
  }

  createPlayerData(pid, offsetIndex) {
    const team = this.teamOfPid(pid);
    const isP1 = team === 'p1';
    const yOffsets = this.teamSize === 1 ? [0] : (this.teamSize === 2 ? [-75, 75] : [-120, 0, 120]);
    const y = H / 2 + (yOffsets[offsetIndex] || 0);
    const color = isP1 ? '#00d4ff' : '#ff4d6d';
    return {
      x: isP1 ? PLAY_LEFT + 60 : PLAY_RIGHT - 60, y, r: PLAYER_R,
      color,
      team,
      facing: isP1 ? 1 : -1,
      frozenTimer: 0, poweredTimer: 0, slideTimer: 0, slideVx: 0, slideVy: 0,
      clones: [], controlsReversedTimer: 0, lastDirX: isP1 ? 1 : -1, lastDirY: 0,
      growTimer: 0, shrinkTimer: 0, pullingTimer: 0, pulledBy: null,
      lobCharging: false, lobChargeTimer: 0, slowOrbCharging: false, slowOrbChargeTimer: 0, smokeCharging: false, smokeChargeTimer: 0,
      abilities: (this.selectedSkills[pid] || []).map(sk => ({ ...sk, cdLeft: 0, active: false })),
      inputDX: 0, inputDY: 0,
    };
  }

  initState() {
    const oldScore = this.gs ? this.gs.score : [0, 0];
    const oldFouls = this.gs ? this.gs.foulAttempts : {};
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
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, holder: null, inAir: false, lobMode: false, lobProgress: 0, lobFrom: null, lobTo: null },
      players: {},
    };
    const teamCounters = { p1: 0, p2: 0 };
    this.getAllPids().forEach(pid => {
      const team = this.teamOfPid(pid);
      this.gs.players[pid] = this.createPlayerData(pid, teamCounters[team]++);
      this.gs.foulAttempts[pid] = this.gs.foulAttempts[pid] || 0;
      if (!this.selectedSkills[pid] || this.selectedSkills[pid].length < 3) {
        this.selectedSkills[pid] = ALL_SKILLS.slice(0, 3);
      }
      this.gs.players[pid].abilities = this.selectedSkills[pid].map(sk => ({ ...sk, cdLeft: 0, active: false }));
    });
  }

  getOpposingPids(pid) {
    const team = this.teamOfPid(pid);
    return Object.keys(this.gs.players).filter(other => this.teamOfPid(other) !== team);
  }

  getNearestOpponent(pid) {
    const p = this.gs.players[pid];
    let winner = null;
    let best = Infinity;
    this.getOpposingPids(pid).forEach(oppPid => {
      const o = this.gs.players[oppPid];
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < best) {
        best = d;
        winner = { pid: oppPid, player: o, dist: d };
      }
    });
    return winner;
  }

  useAbility(pid, idx) {
    const p = this.gs.players[pid];
    const ab = p?.abilities?.[idx];
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0 || this.gs.penaltyMode) return;
    const nearest = this.getNearestOpponent(pid);
    const opp = nearest ? nearest.player : null;

    switch (ab.id) {
      case 'clone': {
        ab.cdLeft = ab.cd;
        const realDY = Math.random() < 0.5 ? -72 : 72;
        const cloneY = p.y - realDY;
        p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, p.y + realDY));
        p.clones.push({ x: p.x, y: Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, cloneY)), life: ab.duration });
        this.addFlash('🧬 KLON!', p.color);
        break;
      }
      case 'slide': {
        ab.cdLeft = ab.cd;
        const s_dx = p.inputDX || p.lastDirX;
        const s_dy = p.inputDY || p.lastDirY;
        const s_len = Math.sqrt(s_dx * s_dx + s_dy * s_dy) || 1;
        p.slideVx = (s_dx / s_len) * 14; p.slideVy = (s_dy / s_len) * 14;
        p.slideTimer = ab.duration;
        this.addFlash('⚡ KAYMA!', '#aa00ff');
        break;
      }
      case 'power': ab.cdLeft = ab.cd; p.poweredTimer = ab.duration; this.addFlash('💥 GÜÇ MODU!', '#ffd700'); break;
      case 'freeze':
        if (!opp) return;
        ab.cdLeft = ab.cd;
        {
          const angle = Math.atan2(opp.y - p.y, opp.x - p.x);
          this.gs.freezeProjectile = { x: p.x, y: p.y, vx: Math.cos(angle) * 9, vy: Math.sin(angle) * 9, life: 120, owner: pid };
        }
        this.addFlash('❄️ DONDUR!', '#88eeff');
        break;
      case 'reverse':
        if (!opp) return;
        ab.cdLeft = ab.cd; opp.controlsReversedTimer = ab.duration; this.addFlash('🔀 TERSLE!', '#ff88bb');
        break;
      case 'lob': if (this.gs.ball.holder === pid) { p.lobCharging = true; p.lobChargeTimer = 0; } break;
      case 'sloworb': p.slowOrbCharging = true; p.slowOrbChargeTimer = 0; break;
      case 'grow': ab.cdLeft = ab.cd; p.growTimer = ab.duration; p.shrinkTimer = 0; this.addFlash('🛡️ DEVLEŞTİ!', p.color); break;
      case 'shrink': ab.cdLeft = ab.cd; p.shrinkTimer = ab.duration; p.growTimer = 0; this.addFlash('💨 KÜÇÜLDÜ!', p.color); break;
      case 'smoke': p.smokeCharging = true; p.smokeChargeTimer = 0; break;
      case 'hook':
        if (!opp) return;
        ab.cdLeft = ab.cd;
        {
          const angle = Math.atan2(opp.y - p.y, opp.x - p.x);
          this.gs.hookProjectile = { x: p.x, y: p.y, vx: Math.cos(angle) * 11, vy: Math.sin(angle) * 11, life: 100, owner: pid };
        }
        this.addFlash('🪝 KANCA!', '#ffaa33');
        break;
      default:
        break;
    }
  }

  startPenaltyMode(kicker, keeper) {
    const keeperTeam = this.teamOfPid(keeper);
    this.gs.penaltyMode = { active: true, kicker, keeper, barPos: 0, barDir: 1, barSpeed: 0.015, greenStart: 0.35 + Math.random() * 0.3, greenWidth: 0.15, shot: false, goalX: keeperTeam === 'p1' ? PLAY_LEFT : PLAY_RIGHT, goalY: H / 2, goalH: 160 };
    this.gs.ball.holder = null;
    this.gs.ball.x = this.teamOfPid(kicker) === 'p1' ? W / 2 - 100 : W / 2 + 100;
    this.gs.ball.y = H / 2;
    this.gs.ball.vx = 0;
    this.gs.ball.vy = 0;
    this.addFlash('🚨 PENALTI!', '#ffaa00');
  }

  executeLobPass(pid) {
    const p = this.gs.players[pid];
    const b = this.gs.ball;
    if (!p || !p.lobCharging || b.holder !== pid) { if (p) p.lobCharging = false; return; }
    p.lobCharging = false;
    const ab = p.abilities.find(a => a.id === 'lob');
    if (ab) ab.cdLeft = ab.cd;
    const dist = (p.lobChargeTimer / 1500) * (W * 0.85);
    b.holder = null; b.lobMode = true; b.lobProgress = 0;
    b.lobFrom = { x: p.x, y: p.y };
    b.lobTo = { x: p.x + p.lastDirX * dist, y: p.y + p.lastDirY * dist };
    b.inAir = true;
    this.addFlash('🚀 AŞIRTMA!', p.color);
  }

  executeSlowOrb(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.slowOrbCharging) return;
    p.slowOrbCharging = false;
    const ab = p.abilities.find(a => a.id === 'sloworb');
    if (ab) ab.cdLeft = ab.cd;
    const dist = (p.slowOrbChargeTimer / 1200) * (W * 0.85);
    this.gs.slowOrbProjectiles.push({ startX: p.x, startY: p.y, x: p.x, y: p.y, targetX: p.x + p.lastDirX * dist, targetY: p.y + p.lastDirY * dist, progress: 0, duration: 4000, owner: pid });
  }

  executeSmoke(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.smokeCharging) return;
    p.smokeCharging = false;
    const ab = p.abilities.find(a => a.id === 'smoke');
    if (ab) ab.cdLeft = ab.cd;
    const dist = (p.smokeChargeTimer / 1200) * (W * 0.85);
    this.gs.smokeProjectiles.push({ startX: p.x, startY: p.y, x: p.x, y: p.y, targetX: p.x + p.lastDirX * dist, targetY: p.y + p.lastDirY * dist, progress: 0, duration: 4500, owner: pid });
  }

  addFlash(msg, color) { this.flashes.push({ msg, color, ttl: 3 }); }

  actionThrowOrTackle(pid) {
    const b = this.gs.ball;
    const p = this.gs.players[pid];
    const nearest = this.getNearestOpponent(pid);
    if (!p || !nearest || p.frozenTimer > 0 || this.gs.penaltyMode) return;
    const oppPid = nearest.pid;
    const opp = nearest.player;
    const distToOpp = nearest.dist;
    const distToBall = Math.hypot(b.x - p.x, b.y - p.y);

    if (b.holder === pid) {
      b.holder = null; b.inAir = true;
      const dx = opp.x - p.x, dy = opp.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      b.vx = (dx / len) * THROW_SPEED;
      b.vy = (dy / len) * THROW_SPEED;
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
          this.gs.foulAttempts[pid] = (this.gs.foulAttempts[pid] || 0) + 1;
          if (this.gs.foulAttempts[pid] >= 2) {
            this.gs.foulAttempts[pid] = 0;
            this.startPenaltyMode(oppPid, pid);
          } else {
            this.addFlash(`🚨 VÜCUT FAULÜ! (${this.gs.foulAttempts[pid]}/2)`, '#ff4444');
          }
        } else {
          b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false; this.gs.foulAttempts[pid] = 0; this.gs.tackleCooldown = 600; this.addFlash('🏈 KAPTIRDI!', '#fff');
        }
      } else {
        this.gs.foulAttempts[pid] = (this.gs.foulAttempts[pid] || 0) + 1;
        if (this.gs.foulAttempts[pid] >= 2) {
          this.gs.foulAttempts[pid] = 0;
          this.startPenaltyMode(oppPid, pid);
        } else {
          this.addFlash(`🚨 TOPSUZ ALAN FAULÜ! (${this.gs.foulAttempts[pid]}/2)`, '#ff4444');
        }
      }
      return;
    }

    if (b.holder === null && !b.lobMode && distToBall <= p.r + BALL_R + 10) {
      b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
    }
  }

  directionalPass(pid) {
    const b = this.gs.ball;
    const p = this.gs.players[pid];
    if (!p || b.holder !== pid || p.frozenTimer > 0) return;
    if (this.gs.penaltyMode) { if (pid === this.gs.penaltyMode.kicker && !this.gs.penaltyMode.shot) this.shootPenalty(); return; }
    b.holder = null; b.inAir = true;
    b.vx = p.lastDirX * 15; b.vy = p.lastDirY * 15;
    b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
    b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
    this.addFlash('🏈 PAS!', p.color);
  }

  shootPenalty() {
    const pm = this.gs.penaltyMode;
    if (!pm) return;
    pm.shot = true;
    const b = this.gs.ball;
    const inGreen = pm.barPos >= pm.greenStart && pm.barPos <= pm.greenStart + pm.greenWidth;
    const angle = inGreen ? 0 : (Math.random() - 0.5) * 0.6;
    b.vx = this.teamDirection(this.teamOfPid(pm.kicker)) * Math.cos(angle) * 12;
    b.vy = Math.sin(angle) * 12;
    this.addFlash(inGreen ? '🎯 MÜKEMMEL ŞUT!' : '⚡ SERT ŞUT!', '#fff');
  }

  tick(dt) {
    if (!this.gs) return;
    const tickFrameScale = Math.max(0.5, Math.min(3, dt / (1000 / TICK_RATE)));
    const pids = Object.keys(this.gs.players);
    pids.forEach(pid => this.updatePlayer(pid, dt));
    this.updateBall(tickFrameScale);
    this.updatePenaltyBar(tickFrameScale);
    this.checkCollisions(dt, tickFrameScale);
    pids.forEach(pid => {
      this.gs.players[pid].abilities.forEach(ab => {
        if (ab.cdLeft > 0) {
          ab.cdLeft -= dt;
          if (ab.cdLeft <= 0) { ab.cdLeft = 0; ab.active = false; }
        }
      });
    });
    this.checkGoal();
    this.timerTick += dt;
    if (this.timerTick >= 1000) {
      this.timerTick -= 1000;
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        const winnerTeam = this.gs.score[0] > this.gs.score[1] ? 'p1' : (this.gs.score[1] > this.gs.score[0] ? 'p2' : 'draw');
        this.endGame(winnerTeam);
        return;
      }
    }
    const flashes = [...this.flashes];
    this.flashes = [];
    const playersPayload = {};
    pids.forEach(pid => { playersPayload[pid] = this.serializePlayer(this.gs.players[pid]); });
    this.broadcast({ type: 'state', gs: { score: this.gs.score, timeLeft: this.timeLeft, tackleCooldown: this.gs.tackleCooldown, freezeProjectile: this.gs.freezeProjectile, hookProjectile: this.gs.hookProjectile, slowOrbProjectiles: this.gs.slowOrbProjectiles, slowZones: this.gs.slowZones, smokeProjectiles: this.gs.smokeProjectiles, smokeZones: this.gs.smokeZones, penaltyMode: this.gs.penaltyMode, ball: this.gs.ball, players: playersPayload }, flashes });
  }

  serializePlayer(p) {
    return {
      x: p.x, y: p.y, r: p.r, color: p.color, team: p.team,
      facing: p.facing, frozenTimer: p.frozenTimer, poweredTimer: p.poweredTimer,
      slideTimer: p.slideTimer, slideVx: p.slideVx, slideVy: p.slideVy,
      clones: p.clones, controlsReversedTimer: p.controlsReversedTimer,
      lastDirX: p.lastDirX, lastDirY: p.lastDirY, growTimer: p.growTimer, shrinkTimer: p.shrinkTimer,
      pullingTimer: p.pullingTimer, pulledBy: p.pulledBy, lobCharging: p.lobCharging,
      slowOrbCharging: p.slowOrbCharging, smokeCharging: p.smokeCharging,
      abilities: p.abilities.map(a => ({ id: a.id, cdLeft: a.cdLeft, active: a.active, cd: a.cd }))
    };
  }

  updatePlayer(pid, dt) {
    const p = this.gs.players[pid];
    if (!p) return;
    if (this.gs.penaltyMode && this.gs.penaltyMode.active) {
      if (pid === this.gs.penaltyMode.keeper) return;
      if (pid === this.gs.penaltyMode.kicker && this.gs.penaltyMode.shot) return;
    }
    const frameScale = Math.max(0.5, Math.min(3, dt / (1000 / TICK_RATE)));
    if (p.frozenTimer > 0) { p.frozenTimer -= dt; return; }
    if (p.growTimer > 0) { p.r = PLAYER_R * 1.5; p.growTimer -= dt; } else if (p.shrinkTimer > 0) { p.r = PLAYER_R * 0.65; p.shrinkTimer -= dt; } else { p.r = PLAYER_R; }
    if (p.pullingTimer > 0) {
      p.pullingTimer -= dt;
      const owner = this.gs.players[p.pulledBy];
      if (owner) {
        const pdx = owner.x - p.x, pdy = owner.y - p.y;
        const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pdist > 40) { p.x += (pdx / pdist) * 8 * frameScale; p.y += (pdy / pdist) * 8 * frameScale; }
      }
      clampPlayer(p);
      return;
    }
    if (p.slideTimer > 0) {
      p.slideTimer -= dt;
      p.x += p.slideVx * frameScale; p.y += p.slideVy * frameScale;
      p.slideVx *= 0.9; p.slideVy *= 0.9;
      clampPlayer(p);
      if (this.gs.ball.holder === pid) { this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7); this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7); }
      return;
    }
    let dx = p.inputDX || 0, dy = p.inputDY || 0;
    if (p.controlsReversedTimer > 0) { dx = -dx; dy = -dy; p.controlsReversedTimer -= dt; }
    let slowFactor = 1;
    this.gs.slowZones.forEach(z => { if (Math.sqrt((p.x - z.x) ** 2 + (p.y - z.y) ** 2) < z.radius) slowFactor = 0.45; });
    const speed = PLAYER_SPEED * slowFactor * (this.gs.ball.holder === pid ? 0.8 : 1) * (p.poweredTimer > 0 ? 1.4 : 1) * (p.growTimer > 0 ? 0.7 : 1) * (p.shrinkTimer > 0 ? 1.35 : 1);
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dx !== 0 || dy !== 0) {
      const moveStep = speed * frameScale;
      p.x += (dx / len) * moveStep; p.y += (dy / len) * moveStep;
      p.lastDirX = dx / len; p.lastDirY = dy / len;
      if (this.teamOfPid(pid) === 'p1') {
        p.clones.forEach(c => {
          c.x += (dx / len) * moveStep; c.y += (dy / len) * moveStep;
          c.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, c.x));
          c.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, c.y));
        });
      }
    }
    if (this.teamOfPid(pid) === 'p1') p.clones = p.clones.filter(c => { c.life -= dt; return c.life > 0; });
    if (p.poweredTimer > 0) p.poweredTimer -= dt;
    if (p.lobCharging) p.lobChargeTimer += dt;
    if (p.slowOrbCharging) p.slowOrbChargeTimer += dt;
    if (p.smokeCharging) p.smokeChargeTimer += dt;
    clampPlayer(p);
    if (this.gs.ball.holder === pid) { this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7); this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7); }
  }

  updateBall(frameScale) {
    const b = this.gs.ball;
    if (b.holder !== null) return;
    if (b.lobMode) {
      b.lobProgress += 0.018 * frameScale;
      if (b.lobProgress >= 1) {
        b.lobProgress = 1; b.lobMode = false; b.x = b.lobTo.x; b.y = b.lobTo.y; b.vx = 0; b.vy = 0; b.inAir = false;
      } else {
        const t = b.lobProgress;
        const mx = (b.lobFrom.x + b.lobTo.x) / 2, my = Math.min(b.lobFrom.y, b.lobTo.y) - 120;
        b.x = (1 - t) * (1 - t) * b.lobFrom.x + 2 * (1 - t) * t * mx + t * t * b.lobTo.x;
        b.y = (1 - t) * (1 - t) * b.lobFrom.y + 2 * (1 - t) * t * my + t * t * b.lobTo.y;
      }
      return;
    }
    b.x += b.vx * frameScale; b.y += b.vy * frameScale;
    if (!(this.gs.penaltyMode && this.gs.penaltyMode.shot)) {
      const f = Math.pow(BALL_FRICTION, frameScale);
      b.vx *= f; b.vy *= f;
      if (b.x - BALL_R < FIELD_LEFT) { b.x = FIELD_LEFT + BALL_R; b.vx *= -0.82; }
      if (b.x + BALL_R > FIELD_RIGHT) { b.x = FIELD_RIGHT - BALL_R; b.vx *= -0.82; }
      if (b.y - BALL_R < FIELD_TOP) { b.y = FIELD_TOP + BALL_R; b.vy *= -0.82; }
      if (b.y + BALL_R > FIELD_BOTTOM) { b.y = FIELD_BOTTOM - BALL_R; b.vy *= -0.82; }
    }
    if (Math.abs(b.vx) < 0.1) b.vx = 0;
    if (Math.abs(b.vy) < 0.1) b.vy = 0;
  }

  updatePenaltyBar(frameScale) {
    const pm = this.gs.penaltyMode;
    if (!pm || !pm.active || pm.shot) return;
    pm.barPos += pm.barDir * pm.barSpeed * frameScale;
    if (pm.barPos > 1) { pm.barPos = 1; pm.barDir = -1; }
    if (pm.barPos < 0) { pm.barPos = 0; pm.barDir = 1; }
  }

  checkCollisions(dt, frameScale) {
    const b = this.gs.ball;
    const pids = Object.keys(this.gs.players);
    if (this.gs.tackleCooldown > 0) this.gs.tackleCooldown -= dt;

    for (let i = 0; i < pids.length; i++) {
      for (let j = i + 1; j < pids.length; j++) {
        const aPid = pids[i], cPid = pids[j];
        const a = this.gs.players[aPid], c = this.gs.players[cPid];
        const dx = c.x - a.x, dy = c.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy), minDist = a.r + c.r;
        if (dist < minDist && dist > 0) {
          const nx = dx / dist, ny = dy / dist, overlap = minDist - dist;
          a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
          c.x += nx * overlap * 0.5; c.y += ny * overlap * 0.5;
          if (this.gs.tackleCooldown <= 0 && this.teamOfPid(aPid) !== this.teamOfPid(cPid)) {
            if (a.poweredTimer > 0 && b.holder === cPid) { b.holder = null; b.vx = nx * 6; b.vy = ny * 6; this.gs.tackleCooldown = 800; }
            else if (c.poweredTimer > 0 && b.holder === aPid) { b.holder = null; b.vx = -nx * 6; b.vy = -ny * 6; this.gs.tackleCooldown = 800; }
          }
        }
      }
    }

    if (Math.sqrt(b.vx ** 2 + b.vy ** 2) < 2) {
      pids.forEach(pid => {
        const p = this.gs.players[pid];
        if (b.holder === null && !b.lobMode && p.frozenTimer <= 0 && !this.gs.penaltyMode) {
          if (Math.sqrt((b.x - p.x) ** 2 + (b.y - p.y) ** 2) < p.r + BALL_R) { b.holder = pid; b.vx = 0; b.vy = 0; }
        }
      });
    }

    if (this.gs.freezeProjectile) {
      const fp = this.gs.freezeProjectile;
      fp.x += fp.vx * frameScale; fp.y += fp.vy * frameScale; fp.life -= frameScale;
      const ownerTeam = this.teamOfPid(fp.owner);
      const targetPid = pids.find(pid => this.teamOfPid(pid) !== ownerTeam && Math.sqrt((fp.x - this.gs.players[pid].x) ** 2 + (fp.y - this.gs.players[pid].y) ** 2) < this.gs.players[pid].r + 6);
      if (targetPid) { this.gs.players[targetPid].frozenTimer = 2000; this.gs.freezeProjectile = null; }
      else if (fp.life <= 0 || fp.x < 0 || fp.x > W || fp.y < 0 || fp.y > H) this.gs.freezeProjectile = null;
    }

    if (this.gs.hookProjectile) {
      const hp = this.gs.hookProjectile;
      hp.x += hp.vx * frameScale; hp.y += hp.vy * frameScale; hp.life -= frameScale;
      const ownerTeam = this.teamOfPid(hp.owner);
      const targetPid = pids.find(pid => this.teamOfPid(pid) !== ownerTeam && Math.sqrt((hp.x - this.gs.players[pid].x) ** 2 + (hp.y - this.gs.players[pid].y) ** 2) < this.gs.players[pid].r + 6);
      if (targetPid) { this.gs.players[targetPid].pullingTimer = 800; this.gs.players[targetPid].pulledBy = hp.owner; this.gs.hookProjectile = null; }
      else if (hp.life <= 0 || hp.x < 0 || hp.x > W || hp.y < 0 || hp.y > H) this.gs.hookProjectile = null;
    }

    this.gs.slowOrbProjectiles.forEach((orb, i) => {
      orb.progress += 0.025 * frameScale;
      if (orb.progress >= 1) { this.gs.slowZones.push({ x: orb.targetX, y: orb.targetY, radius: 110, life: orb.duration }); this.gs.slowOrbProjectiles.splice(i, 1); }
      else {
        const t = orb.progress, mx = (orb.startX + orb.targetX) / 2, my = Math.min(orb.startY, orb.targetY) - 150;
        orb.x = (1 - t) * (1 - t) * orb.startX + 2 * (1 - t) * t * mx + t * t * orb.targetX;
        orb.y = (1 - t) * (1 - t) * orb.startY + 2 * (1 - t) * t * my + t * t * orb.targetY;
      }
    });
    this.gs.slowZones = this.gs.slowZones.filter(z => { z.life -= dt; return z.life > 0; });

    this.gs.smokeProjectiles.forEach((orb, i) => {
      orb.progress += 0.022 * frameScale;
      if (orb.progress >= 1) { this.gs.smokeZones.push({ x: orb.targetX, y: orb.targetY, radius: 145, life: orb.duration }); this.gs.smokeProjectiles.splice(i, 1); }
      else { orb.x = orb.startX + (orb.targetX - orb.startX) * orb.progress; orb.y = orb.startY + (orb.targetY - orb.startY) * orb.progress; }
    });
    this.gs.smokeZones = this.gs.smokeZones.filter(z => { z.life -= dt; return z.life > 0; });

    pids.forEach(pid => {
      const p = this.gs.players[pid];
      if (b.holder === null && !b.lobMode && p.clones.length > 0 && p.frozenTimer <= 0) {
        p.clones.forEach(c => {
          if (Math.sqrt((b.x - c.x) ** 2 + (b.y - c.y) ** 2) < p.r + BALL_R + 8) {
            const oldX = p.x, oldY = p.y;
            p.x = c.x; p.y = c.y; c.x = oldX; c.y = oldY;
            b.holder = pid;
          }
        });
      }
    });
  }

  checkGoal() {
    const b = this.gs.ball;
    if (this.gs.penaltyMode && this.gs.penaltyMode.shot) {
      const pm = this.gs.penaltyMode;
      const crossed = this.teamOfPid(pm.keeper) === 'p1' ? (b.x < pm.goalX) : (b.x > pm.goalX);
      if (crossed) {
        if (Math.abs(b.y - pm.goalY) < pm.goalH / 2) this.scorePoint(this.teamOfPid(pm.kicker));
        else this.endPenaltyMode();
        return true;
      }
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H || (Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5)) { this.endPenaltyMode(); return true; }
      return false;
    }
    let scorerTeam = null;
    if (b.holder && this.gs.players[b.holder]) {
      const p = this.gs.players[b.holder];
      if (p.team === 'p1' && p.x > PLAY_RIGHT) scorerTeam = 'p1';
      if (p.team === 'p2' && p.x < PLAY_LEFT) scorerTeam = 'p2';
    }
    if (b.holder === null && !b.lobMode) {
      if (b.x - BALL_R < PLAY_LEFT) { b.x = PLAY_LEFT + BALL_R; b.vx = Math.abs(b.vx) * 0.75; }
      if (b.x + BALL_R > PLAY_RIGHT) { b.x = PLAY_RIGHT - BALL_R; b.vx = -Math.abs(b.vx) * 0.75; }
    }
    if (scorerTeam) { this.scorePoint(scorerTeam); return true; }
    return false;
  }

  scorePoint(team) { const idx = team === 'p1' ? 0 : 1; this.gs.score[idx]++; this.gs.penaltyMode = null; if (this.gs.score[idx] >= WIN_SCORE) this.endGame(team); else this.resetRound(); }
  endPenaltyMode() { this.gs.penaltyMode = null; this.resetRound(); }
  resetRound() { this.initState(); }
  endGame(winnerTeam) { this.started = false; if (this.ticker) clearInterval(this.ticker); this.broadcast({ type: 'gameover', winnerTeam, score: this.gs.score }); }

  startGame() {
    if (this.started) return;
    this.initState();
    this.started = true;
    this.timeLeft = GAME_DURATION;
    this.timerTick = 0;
    this.lastTick = Date.now();
    this.broadcast({ type: 'start' });
    this.ticker = setInterval(() => {
      const now = Date.now();
      const dt = now - this.lastTick;
      this.lastTick = now;
      this.tick(dt);
    }, TICK_MS);
  }
}

function clampPlayer(p) { p.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, p.x)); p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, p.y)); }

wss.on('connection', (ws) => {
  ws.roomId = null; ws.pid = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'create_room') {
      const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
      const room = new Room(roomId, msg.teamSize);
      rooms.set(roomId, room);
      const pid = room.addPlayer(ws);
      ws.send(JSON.stringify({ type: 'room_created', roomId, pid, allSkills: ALL_SKILLS, teamSize: room.teamSize, maxPlayers: room.maxPlayers, connectedPlayers: room.connectedCount() }));
    }
    else if (msg.type === 'join_room') {
      const roomId = (msg.roomId || '').toUpperCase().trim();
      const room = rooms.get(roomId);
      if (!room || room.started || room.isFull()) { ws.send(JSON.stringify({ type: 'error', msg: 'Oda dolu veya bulunamadı.' })); return; }
      const pid = room.addPlayer(ws);
      ws.send(JSON.stringify({ type: 'room_joined', roomId, pid, allSkills: ALL_SKILLS, teamSize: room.teamSize, maxPlayers: room.maxPlayers, connectedPlayers: room.connectedCount() }));
      room.broadcast({ type: 'player_joined', pid, connectedPlayers: room.connectedCount(), maxPlayers: room.maxPlayers });
      if (room.isFull()) room.startGame();
    }
    else if (msg.type === 'select_skills') {
      const room = rooms.get(ws.roomId); if (!room) return;
      room.selectedSkills[ws.pid] = (Array.isArray(msg.skills) ? msg.skills : []).slice(0, 4);
    }
    else if (msg.type === 'input') { const room = rooms.get(ws.roomId); if (!room || !room.started) return; const p = room.gs.players[ws.pid]; if (p) { p.inputDX = msg.dx || 0; p.inputDY = msg.dy || 0; } }
    else if (msg.type === 'action') { const room = rooms.get(ws.roomId); if (!room || !room.started) return; if (msg.action === 'throw') room.actionThrowOrTackle(ws.pid); else if (msg.action === 'pass') room.directionalPass(ws.pid); else if (msg.action === 'ability') room.useAbility(ws.pid, msg.idx); else if (msg.action === 'foul_boost' && room.gs.penaltyMode && room.gs.penaltyMode.keeper === ws.pid) room.gs.penaltyMode.barSpeed += 0.005; }
    else if (msg.type === 'release_ability') { const room = rooms.get(ws.roomId); if (!room || !room.started) return; if (msg.id === 'lob') room.executeLobPass(ws.pid); else if (msg.id === 'sloworb') room.executeSlowOrb(ws.pid); else if (msg.id === 'smoke') room.executeSmoke(ws.pid); }
    else if (msg.type === 'restart') { const room = rooms.get(ws.roomId); if (room) room.startGame(); }
    else if (msg.type === 'chat') { const room = rooms.get(ws.roomId); if (room) room.broadcast({ type: 'chat', from: ws.pid, text: String(msg.text).slice(0, 80) }); }
  });
  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room || !ws.pid) return;
    room.removePlayer(ws.pid);
    room.broadcast({ type: 'opponent_left', pid: ws.pid });
    if (room.ticker) clearInterval(room.ticker);
    rooms.delete(ws.roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🎮 Sunucu ${PORT} portunda aktif!`); });
