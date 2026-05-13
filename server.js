const express = require('express');
const compression = require('compression');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Gzip/Deflate: 200 KB inline HTML'i ~30 KB'a indirir, TTFB transfer süresini ciddi düşürür.
app.use(compression({ threshold: 1024 }));

// HTML için cache yok (canlı düzenleme); statik varlıklar (woff2/png/js) için kısa cache izni veriyoruz.
app.use((req, res, next) => {
  if (req.path === '/' || /\.html?$/i.test(req.path)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'indextoonline.html'));
});
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname), { etag: true, lastModified: true, maxAge: '1h' }));
// 404 yerine bilinmeyen yolları ana online sayfaya yönlendir (kullanıcı SPA gibi gezsin)
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) {
    res.sendFile(path.join(__dirname, 'indextoonline.html'));
  } else {
    res.status(404).send('Not found');
  }
});

// ─────────────── GAME CONSTANTS (index.html ile birebir) ───────────────
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
const SHOT_GOAL_H = 100;
const PASS_SPEED = 15;
const NON_TEKNIK_PASS_MULT = 0.72;
const TEKNIK_PASS_MAX_CHARGE_MS = 900;
const LOB_MAX_CHARGE_MS = 800;
const LONG_PASS_MAX_CHARGE_MS = 1200;
const TACKLE_RANGE = 52;
const POWER_STUN_MS = 1000;
const SHOT_STUN_MS = 700;

const TICK_RATE = 60;          // Fizik simülasyonu 60Hz
const TICK_MS = 1000 / TICK_RATE;
// Broadcast 30Hz: 60Hz simülasyon korunur ama state senkronu yarıya iner.
// → JSON.stringify maliyeti %50 düşer, ağ paket sayısı yarıya iner (shared CPU dostu).
// → Client interpolation snapshot başına ~33ms; INTERP_DELAY ~70ms olmalı (client tarafı).
const BROADCAST_RATE = 30;
const BROADCAST_INTERVAL_MS = 1000 / BROADCAST_RATE;
// Tek bir client'ın WS send buffer'ı bu eşiği aştıysa o client için broadcast atla
// (sloppy network → memory bloat'u engelle). Snapshot tabanlı sistem; drop OK.
const WS_BUFFER_DROP_THRESHOLD = 256 * 1024;
const WIN_SCORE = 5;
const GAME_DURATION = 180;

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
function clampPlayer(p) {
  p.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, p.x));
  p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, p.y));
}

const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.players = {};                  // pid -> ws
    this.selectedSkills = { p1: [], p2: [] };
    this.profiles = { p1: null, p2: null };
    this.gs = null;
    this.ticker = null;
    this.started = false;
    this.gameOver = false;
    this.lastTick = 0;
    this.timeLeft = GAME_DURATION;
    this.timerTick = 0;
    this.flashes = [];
    this._penaltyDelayTimer = null;
    this._penaltyEndTimer = null;
  }

  // ─── Player slot / odaya katılım ───
  addPlayer(ws) {
    for (const pid of ['p1', 'p2']) {
      if (!this.players[pid]) {
        this.players[pid] = ws;
        ws.roomId = this.id;
        ws.pid = pid;
        return pid;
      }
    }
    return null;
  }
  removePlayer(pid) {
    delete this.players[pid];
  }
  isFull() {
    return !!(this.players.p1 && this.players.p2);
  }
  connectedCount() {
    return Object.keys(this.players).length;
  }
  broadcast(data) {
    const str = JSON.stringify(data);
    Object.values(this.players).forEach(ws => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Yavaş bağlantıda backlog büyüyorsa state mesajını atla — sonraki snapshot zaten gelir.
      // Sadece state-tipli mesajlarda drop yap; start/gameover/error gibi tek seferlikler garanti gitsin.
      if (data && data.type === 'state' && ws.bufferedAmount > WS_BUFFER_DROP_THRESHOLD) return;
      ws.send(str);
    });
  }
  addFlash(msg, color) { this.flashes.push({ msg, color }); }

  // ─── State init ───
  createPlayerData(pid) {
    const isP1 = pid === 'p1';
    return {
      x: isP1 ? PLAY_LEFT + 60 : PLAY_RIGHT - 60,
      y: H / 2,
      vx: 0, vy: 0,
      r: PLAYER_R,
      color: isP1 ? '#00d4ff' : '#ff4d6d',
      team: pid,
      facing: isP1 ? 1 : -1,
      lastDirX: isP1 ? 1 : -1,
      lastDirY: 0,
      frozenTimer: 0,
      poweredTimer: 0,
      slideTimer: 0, slideVx: 0, slideVy: 0,
      clones: [],
      controlsReversedTimer: 0,
      lobCharging: false, lobChargeTimer: 0,
      slowOrbCharging: false, slowOrbChargeTimer: 0,
      smokeCharging: false, smokeChargeTimer: 0,
      growTimer: 0, shrinkTimer: 0,
      pullingTimer: 0, pulledBy: null,
      speedBoostTimer: 0,
      geopasActive: false, geopasTimer: 0,
      shotActiveTimer: 0,
      passCharging: false, passChargeMs: 0,
      longPassCharging: false, longPassChargeMs: 0,
      abilities: [],
      profile: this.profiles[pid] || null,
      wallPreview: null,
      // Input flags
      inputDX: 0, inputDY: 0,
      inputPenaltyBoost: false,
      inputWallHeld: false,
    };
  }

  initState() {
    const oldScore = this.gs ? this.gs.score : [0, 0];
    this.gs = {
      score: oldScore,
      tackleCooldown: 0,
      slowOrbProjectiles: [],
      slowZones: [],
      smokeProjectiles: [],
      smokeZones: [],
      freezeProjectile: null,
      hookProjectile: null,
      foulAttempts: { p1: 0, p2: 0 },
      penaltyMode: null,
      walls: [],
      blindTimer: 0, blindOwner: null,
      invisBallTimer: 0,
      ball: {
        x: W / 2, y: H / 2, vx: 0, vy: 0,
        holder: null, inAir: false,
        lobMode: false, lobProgress: 0, lobFrom: null, lobTo: null,
        longPassMode: false, longPassOwner: null,
        shotMode: false, shotOwner: null,
        teknikPassMode: false,
      },
      players: {},
    };
    ['p1', 'p2'].forEach(pid => {
      if (!this.players[pid]) return;
      this.gs.players[pid] = this.createPlayerData(pid);
      const skills = (this.selectedSkills[pid] || []).slice(0, 4);
      this.gs.players[pid].abilities = skills.map(sk => {
        const full = ALL_SKILLS.find(s => s.id === sk.id) || sk;
        return { ...full, cdLeft: 0, active: false };
      });
    });
  }

  // ─── Helpers ───
  getOpponentPid(pid) { return pid === 'p1' ? 'p2' : 'p1'; }
  playerIsTeknik(pid) { const p = this.gs.players[pid]; return p && p.profile && p.profile.id === 'teknik'; }
  playerIsWarrior(pid) { const p = this.gs.players[pid]; return p && p.profile && p.profile.id === 'savasci'; }

  // ─────────────── ABILITY USAGE ───────────────
  useAbility(pid, idx) {
    const p = this.gs.players[pid];
    if (!p) return;
    const ab = p.abilities[idx];
    if (!ab) return;

    // Penaltıda duvar yeteneği yok
    if (ab.id === 'wall' && this.gs.penaltyMode) {
      if (p.wallPreview) p.wallPreview.active = false;
      return;
    }
    // Wall: ön izleme aktifken her tuş 1/3'ü değiştirir (cooldown bypass)
    if (ab.id === 'wall' && p.wallPreview && p.wallPreview.active) {
      p.wallPreview.pos = (p.wallPreview.pos + 1) % 3;
      p.wallPreview.holdMs = 0;
      p.wallPreview.timeoutMs = 5000;
      const labels = ['ÜST 1/3', 'ORTA 1/3', 'ALT 1/3'];
      this.addFlash('🧱 ' + labels[p.wallPreview.pos], ab.color);
      return;
    }
    // Geopas: ikinci tuş yönlendirme (cooldown bypass)
    if (ab.id === 'geopas' && p.geopasActive) {
      p.geopasActive = false;
      ab.active = false;
      ab.cdLeft = ab.cd;
      const b = this.gs.ball;
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
          const geoSpeed = PASS_SPEED * 0.85;
          b.vx = (nvx / nlen) * geoSpeed;
          b.vy = (nvy / nlen) * geoSpeed;
          b.inAir = true;
          b.longPassMode = true;
          b.longPassOwner = pid;
          b.shotMode = false; b.shotOwner = null;
        }
      }
      this.addFlash('📐 SAPTIRILDI!', ab.color);
      return;
    }

    if (ab.cdLeft > 0 || p.frozenTimer > 0) return;

    switch (ab.id) {
      case 'clone': {
        ab.active = true; ab.cdLeft = ab.cd;
        const goUp = Math.random() < 0.5;
        const realDY = goUp ? -72 : 72;
        const cloneY = p.y + (goUp ? 72 : -72);
        p.y = Math.max(FIELD_TOP + 15, Math.min(FIELD_BOTTOM - 15, p.y + realDY));
        p.clones = [{
          x: p.x,
          y: Math.max(FIELD_TOP + 15, Math.min(FIELD_BOTTOM - 15, cloneY)),
          life: ab.duration,
        }];
        this.addFlash('🧬 KLON!', p.color);
        break;
      }
      case 'slide': {
        ab.active = true; ab.cdLeft = ab.cd;
        const speed = 14;
        let dx = p.inputDX || 0, dy = p.inputDY || 0;
        if (dx === 0 && dy === 0) { dx = p.lastDirX; dy = p.lastDirY; }
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        p.slideVx = (dx / len) * speed;
        p.slideVy = (dy / len) * speed;
        p.slideTimer = ab.duration;
        this.addFlash('⚡ KAYMA!', ab.color);
        break;
      }
      case 'power': {
        ab.active = true; ab.cdLeft = ab.cd;
        p.poweredTimer = ab.duration;
        this.addFlash('💥 GÜÇ MODU!', ab.color);
        break;
      }
      case 'selfpass': {
        if (this.gs.ball.holder !== pid) { this.addFlash('Önce topu al!', '#888'); return; }
        ab.active = true; ab.cdLeft = ab.cd;
        this.executeSelfPass(pid);
        break;
      }
      case 'freeze': {
        ab.active = true; ab.cdLeft = ab.cd;
        this.gs.freezeProjectile = { x: p.x, y: p.y, vx: p.lastDirX * 9, vy: p.lastDirY * 9, life: 120, owner: pid };
        this.addFlash('❄️ DONDUR!', ab.color);
        break;
      }
      case 'reverse': {
        ab.active = true; ab.cdLeft = ab.cd;
        const opp = this.gs.players[this.getOpponentPid(pid)];
        if (opp) opp.controlsReversedTimer = ab.duration;
        this.addFlash('🔀 TERSLE!', ab.color);
        break;
      }
      case 'hook': {
        ab.active = true; ab.cdLeft = ab.cd;
        this.gs.hookProjectile = {
          x: p.x, y: p.y,
          vx: p.lastDirX * 20 + p.vx * 0.5,
          vy: p.lastDirY * 20 + p.vy * 0.5,
          owner: pid, life: 60,
        };
        this.addFlash('🪝 HALAT!', ab.color);
        break;
      }
      case 'geopas': {
        if (this.gs.ball.holder !== pid) { this.addFlash('Önce topu al!', '#888'); return; }
        ab.active = true;
        p.geopasActive = true;
        p.geopasTimer = ab.duration;
        const b = this.gs.ball;
        b.holder = null; b.inAir = true;
        b.vx = p.lastDirX * PASS_SPEED;
        b.vy = p.lastDirY * PASS_SPEED;
        b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
        b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
        this.addFlash('📐 GEOMETRİK PAS!', ab.color);
        break;
      }
      case 'speedboost': {
        ab.active = true; ab.cdLeft = ab.cd;
        p.speedBoostTimer = ab.duration;
        this.addFlash('🏎️ HIZ BOOST!', ab.color);
        break;
      }
      case 'invisball': {
        ab.active = true; ab.cdLeft = ab.cd;
        this.gs.invisBallTimer = ab.duration;
        this.addFlash('👻 GÖRÜNMEZ TOP!', '#aaa');
        break;
      }
      case 'blind': {
        ab.active = true; ab.cdLeft = ab.cd;
        this.gs.blindTimer = ab.duration;
        this.gs.blindOwner = pid;
        this.addFlash('🌑 KÖR ETME!', '#ffffff');
        break;
      }
      case 'shot': {
        if (this.gs.ball.holder !== pid) { this.addFlash('Önce topu al!', '#888'); return; }
        ab.active = true; ab.cdLeft = ab.cd;
        const b = this.gs.ball;
        b.holder = null; b.inAir = true;
        const shotSpeed = PASS_SPEED * 1.6;
        b.vx = p.lastDirX * shotSpeed;
        b.vy = p.lastDirY * shotSpeed;
        b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
        b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
        b.shotMode = true; b.shotOwner = pid;
        this.addFlash('🎯 ŞUT!', ab.color);
        break;
      }
      case 'wall': {
        p.wallPreview = { active: true, pos: 0, holdMs: 0, timeoutMs: 5000 };
        ab.active = true;
        this.addFlash('🧱 ÜST 1/3', ab.color);
        break;
      }
      // lob, sloworb, smoke, longpass start via separate start_ability
      default:
        break;
    }
  }

  placeWall(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.wallPreview || !p.wallPreview.active) return;
    const ab = p.abilities.find(a => a.id === 'wall');
    if (!ab) return;
    const side = pid === 'p1' ? 'left' : 'right';
    this.gs.walls = (this.gs.walls || []).filter(w => w.owner !== pid);
    this.gs.walls.push({ side, pos: p.wallPreview.pos, owner: pid, life: ab.duration });
    ab.cdLeft = ab.cd;
    ab.active = false;
    p.wallPreview.active = false;
    this.addFlash('🧱 DUVAR YERLEŞTİ!', ab.color);
  }

  executeSelfPass(pid) {
    const p = this.gs.players[pid];
    const b = this.gs.ball;
    b.holder = null; b.inAir = true;
    const angle = 0.35;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const kickX = p.lastDirX * cos - p.lastDirY * sin;
    const kickY = p.lastDirX * sin + p.lastDirY * cos;
    const SELF_PASS_SPEED = 9.5;
    b.vx = kickX * SELF_PASS_SPEED;
    b.vy = kickY * SELF_PASS_SPEED;
    p.poweredTimer = Math.max(p.poweredTimer, 1200);
    this.addFlash('🏃‍♂️ AT-KAÇIRT!', '#00ffcc');
  }

  // ─────────────── CHARGE FLOWS ───────────────
  startLobCharge(pid) {
    const p = this.gs.players[pid];
    const ab = p && p.abilities.find(a => a.id === 'lob');
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
    if (this.gs.ball.holder !== pid) { this.addFlash('Önce topu al!', '#888'); return; }
    p.passCharging = false; p.passChargeMs = 0;
    p.lobCharging = true; p.lobChargeTimer = 0;
  }
  executeLobPass(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.lobCharging) return;
    p.lobCharging = false;
    const ab = p.abilities.find(a => a.id === 'lob');
    if (!ab) return;
    ab.active = true; ab.cdLeft = ab.cd;
    const b = this.gs.ball;
    if (b.holder === pid) {
      b.holder = null;
      b.lobMode = true; b.lobProgress = 0;
      b.lobFrom = { x: p.x, y: p.y };
      const ratio = Math.min(1, p.lobChargeTimer / LOB_MAX_CHARGE_MS);
      const maxDist = W * 0.85;
      const dist = 80 + ratio * maxDist;
      b.lobTo = {
        x: Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, p.x + p.lastDirX * dist)),
        y: Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, p.y + p.lastDirY * dist)),
      };
      b.inAir = true;
      this.addFlash('🚀 AŞIRTMA!', ab.color);
    }
    p.lobChargeTimer = 0;
  }

  startSlowOrbCharge(pid) {
    const p = this.gs.players[pid];
    const ab = p && p.abilities.find(a => a.id === 'sloworb');
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
    p.slowOrbCharging = true; p.slowOrbChargeTimer = 0;
  }
  executeSlowOrb(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.slowOrbCharging) return;
    p.slowOrbCharging = false;
    const ab = p.abilities.find(a => a.id === 'sloworb');
    if (!ab) return;
    ab.cdLeft = ab.cd; ab.active = true;
    const ratio = Math.min(1, p.slowOrbChargeTimer / 1200);
    const throwDist = 120 + ratio * 600;
    const tx = Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, p.x + p.lastDirX * throwDist));
    const ty = Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, p.y + p.lastDirY * throwDist));
    this.gs.slowOrbProjectiles.push({
      x: p.x, y: p.y, startX: p.x, startY: p.y,
      targetX: tx, targetY: ty, progress: 0,
      owner: pid, duration: ab.duration,
    });
    this.addFlash('🔮 KÜRE FIRLATILDI!', ab.color);
    p.slowOrbChargeTimer = 0;
  }

  startSmokeCharge(pid) {
    const p = this.gs.players[pid];
    const ab = p && p.abilities.find(a => a.id === 'smoke');
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
    p.smokeCharging = true; p.smokeChargeTimer = 0;
  }
  executeSmoke(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.smokeCharging) return;
    p.smokeCharging = false;
    const ab = p.abilities.find(a => a.id === 'smoke');
    if (!ab) return;
    ab.cdLeft = ab.cd; ab.active = true;
    const ratio = Math.min(1, p.smokeChargeTimer / 1200);
    const throwDist = 120 + ratio * 600;
    const tx = Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, p.x + p.lastDirX * throwDist));
    const ty = Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, p.y + p.lastDirY * throwDist));
    this.gs.smokeProjectiles.push({
      x: p.x, y: p.y, startX: p.x, startY: p.y,
      targetX: tx, targetY: ty, progress: 0,
      owner: pid, duration: ab.duration,
    });
    this.addFlash('💨 SİS BOMBASI!', ab.color);
    p.smokeChargeTimer = 0;
  }

  startLongPassCharge(pid) {
    const p = this.gs.players[pid];
    const ab = p && p.abilities.find(a => a.id === 'longpass');
    if (!ab || ab.cdLeft > 0 || p.frozenTimer > 0) return;
    if (this.gs.ball.holder !== pid) { this.addFlash('Önce topu al!', '#888'); return; }
    p.passCharging = false; p.passChargeMs = 0;
    p.lobCharging = false; p.lobChargeTimer = 0;
    p.longPassCharging = true; p.longPassChargeMs = 0;
    ab.active = true;
  }
  executeLongPass(pid) {
    const p = this.gs.players[pid];
    if (!p || !p.longPassCharging) return;
    p.longPassCharging = false;
    const ab = p.abilities.find(a => a.id === 'longpass');
    if (!ab) return;
    if (this.gs.ball.holder !== pid) {
      ab.active = false;
      p.longPassChargeMs = 0;
      return;
    }
    const ratio = Math.min(1, p.longPassChargeMs / LONG_PASS_MAX_CHARGE_MS);
    p.longPassChargeMs = 0;
    ab.cdLeft = ab.cd; ab.active = true;
    const b = this.gs.ball;
    b.holder = null; b.inAir = true;
    b.longPassMode = true; b.longPassOwner = pid;
    const lpSpeed = PASS_SPEED * (1.0 + ratio * 1.5);
    b.vx = p.lastDirX * lpSpeed;
    b.vy = p.lastDirY * lpSpeed;
    b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
    b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
    this.addFlash(ratio > 0.7 ? '🏹 GÜÇLÜ UZUN PAS!' : '🏹 UZUN PAS!', ab.color);
  }

  startAbilityByIdx(pid, idx) {
    const p = this.gs.players[pid];
    if (!p) return;
    const ab = p.abilities[idx];
    if (!ab) return;
    if (ab.id === 'lob') this.startLobCharge(pid);
    else if (ab.id === 'sloworb') this.startSlowOrbCharge(pid);
    else if (ab.id === 'smoke') this.startSmokeCharge(pid);
    else if (ab.id === 'longpass') this.startLongPassCharge(pid);
    else this.useAbility(pid, idx);
  }
  releaseAbilityByIdx(pid, idx) {
    const p = this.gs.players[pid];
    if (!p) return;
    const ab = p.abilities[idx];
    if (!ab) return;
    if (ab.id === 'lob' && p.lobCharging) this.executeLobPass(pid);
    else if (ab.id === 'sloworb' && p.slowOrbCharging) this.executeSlowOrb(pid);
    else if (ab.id === 'smoke' && p.smokeCharging) this.executeSmoke(pid);
    else if (ab.id === 'longpass' && p.longPassCharging) this.executeLongPass(pid);
  }

  // ─────────────── PASS / TEKNIK PASS / THROW ───────────────
  spacePress(pid) {
    if (this.gs.penaltyMode) {
      if (this.gs.penaltyMode.kicker === pid) this.shootPenalty(pid);
      return;
    }
    const h = this.gs.ball.holder;
    if (h === pid && this.playerIsTeknik(pid)) {
      const hp = this.gs.players[pid];
      hp.passCharging = true;
      hp.passChargeMs = 0;
      return;
    }
    if (h === pid) this.directionalPass(pid);
  }
  spaceRelease(pid) {
    const p = this.gs.players[pid];
    if (!p || this.gs.penaltyMode) return;
    if (p.passCharging && this.gs.ball.holder === pid && this.playerIsTeknik(pid)) {
      this.executeTeknikChargedPass(pid);
    }
  }
  directionalPass(pid) {
    const p = this.gs.players[pid];
    const b = this.gs.ball;
    if (!p || b.holder !== pid || p.frozenTimer > 0) return;
    p.passCharging = false; p.passChargeMs = 0;
    b.holder = null; b.inAir = true;
    b.teknikPassMode = false;
    const passMult = this.playerIsTeknik(pid) ? 1 : NON_TEKNIK_PASS_MULT;
    b.vx = p.lastDirX * PASS_SPEED * passMult;
    b.vy = p.lastDirY * PASS_SPEED * passMult;
    b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
    b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
    this.addFlash('🏈 PAS!', p.color);
  }
  executeTeknikChargedPass(pid) {
    const p = this.gs.players[pid];
    const b = this.gs.ball;
    if (!p || !p.passCharging || b.holder !== pid || p.frozenTimer > 0) {
      if (p) { p.passCharging = false; p.passChargeMs = 0; }
      return;
    }
    p.passCharging = false;
    const charge = Math.min(TEKNIK_PASS_MAX_CHARGE_MS, p.passChargeMs);
    p.passChargeMs = 0;
    const t = charge / TEKNIK_PASS_MAX_CHARGE_MS;
    const speedMult = 1 + t * 1.45;
    b.holder = null; b.inAir = true;
    b.teknikPassMode = true;
    b.longPassMode = false; b.longPassOwner = null;
    b.shotMode = false; b.shotOwner = null;
    b.vx = p.lastDirX * PASS_SPEED * speedMult;
    b.vy = p.lastDirY * PASS_SPEED * speedMult;
    b.x = p.x + p.lastDirX * (p.r + BALL_R + 2);
    b.y = p.y + p.lastDirY * (p.r + BALL_R + 2);
    this.addFlash(t > 0.55 ? '🎯 GÜÇLÜ PAS!' : '🎯 TEKNİK PAS!', '#00e5ff');
  }

  throwBall(pid) {
    const p = this.gs.players[pid];
    const opp = this.gs.players[this.getOpponentPid(pid)];
    const b = this.gs.ball;
    if (!p || !opp || b.holder !== pid) return;
    p.passCharging = false; p.passChargeMs = 0;
    p.longPassCharging = false; p.longPassChargeMs = 0;
    b.holder = null; b.inAir = true;
    const dx = opp.x - p.x;
    const dy = opp.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    b.vx = (dx / len) * THROW_SPEED;
    b.vy = (dy / len) * THROW_SPEED;
  }

  // ─────────────── TACKLE / FOUL ───────────────
  attemptTackle(pid) {
    const b = this.gs.ball;
    const p = this.gs.players[pid];
    const oppPid = this.getOpponentPid(pid);
    const opp = this.gs.players[oppPid];
    if (!p || !opp) return;
    if (p.frozenTimer > 0 || this.gs.penaltyMode) return;
    // Top sende ise hiçbir şey yapma (yerel ile aynı)
    if (b.holder === pid) return;

    const distToOpp = Math.hypot(opp.x - p.x, opp.y - p.y);
    const distToBall = Math.hypot(b.x - p.x, b.y - p.y);
    const isWarrior = this.playerIsWarrior(pid);

    if (distToOpp <= TACKLE_RANGE) {
      if (b.holder === oppPid) {
        if (isWarrior) {
          b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
          this.gs.foulAttempts[pid] = 0; this.gs.tackleCooldown = 600;
          this.addFlash('⚔️ SAVAŞÇI ÇALDI!', '#aa00ff');
          return;
        }
        // Shielding/steal logic
        const dBallX = b.x - p.x, dBallY = b.y - p.y;
        const dBall = Math.sqrt(dBallX * dBallX + dBallY * dBallY);
        let carrierBlocking = false;
        if (dBall > 1) {
          const rayX = dBallX / dBall, rayY = dBallY / dBall;
          const proj = (opp.x - p.x) * rayX + (opp.y - p.y) * rayY;
          if (proj > 0 && proj < dBall) {
            const cx = p.x + rayX * proj, cy = p.y + rayY * proj;
            if (Math.hypot(cx - opp.x, cy - opp.y) < opp.r * 0.85) carrierBlocking = true;
          }
        }
        if (carrierBlocking) {
          this.gs.foulAttempts[pid]++;
          if (this.gs.foulAttempts[pid] >= 2) {
            this.gs.foulAttempts[pid] = 0;
            this.triggerFoul(pid, oppPid);
          } else {
            this.addFlash(`🚨 VÜCUT FAULÜ! (${this.gs.foulAttempts[pid]}/2)`, '#ff4444');
          }
        } else {
          b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
          this.gs.foulAttempts[pid] = 0; this.gs.tackleCooldown = 600;
          this.addFlash('🏈 KAPTIRDI!', p.color);
        }
      } else if (isWarrior) {
        // savaşçı topsuz alanda faul yapmaz
      } else {
        this.gs.foulAttempts[pid]++;
        if (this.gs.foulAttempts[pid] >= 2) {
          this.gs.foulAttempts[pid] = 0;
          this.triggerFoul(pid, oppPid);
        } else {
          this.addFlash(`🚨 TOPSUZ ALAN FAULÜ! (${this.gs.foulAttempts[pid]}/2)`, '#ff4444');
        }
      }
      return;
    }
    // Top serbestse pickup
    if (b.holder === null && !b.lobMode && distToBall <= p.r + BALL_R + 10) {
      b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
      b.shotMode = false; b.shotOwner = null;
      b.longPassMode = false; b.longPassOwner = null;
      b.teknikPassMode = false;
    }
  }

  // ─────────────── PENALTY ───────────────
  triggerFoul(foulerPid, victimPid) {
    this.addFlash('🚨 FAUL!', '#ff4444');
    this.gs.foulAttempts = { p1: 0, p2: 0 };
    this.gs.penaltyMode = { pending: true, kicker: victimPid, keeper: foulerPid, active: false, shot: false };
    const b = this.gs.ball;
    if (b.holder === null) { b.vx = 0; b.vy = 0; b.inAir = false; }
    b.longPassMode = false; b.longPassOwner = null;
    b.shotMode = false; b.shotOwner = null;
    b.teknikPassMode = false;
    b.lobMode = false;
    ['p1', 'p2'].forEach(pp => {
      const pl = this.gs.players[pp];
      if (!pl) return;
      pl.passCharging = false; pl.passChargeMs = 0;
      pl.lobCharging = false;
      pl.longPassCharging = false;
      pl.slowOrbCharging = false;
      pl.smokeCharging = false;
      if (pl.wallPreview) pl.wallPreview.active = false;
    });
    if (this._penaltyDelayTimer) clearTimeout(this._penaltyDelayTimer);
    this._penaltyDelayTimer = setTimeout(() => {
      this._penaltyDelayTimer = null;
      this.startPenaltyMode(victimPid, foulerPid);
    }, 1200);
  }
  startPenaltyMode(kickerPid, keeperPid) {
    if (!this.started || this.gameOver) return;
    const kicker = this.gs.players[kickerPid];
    if (!kicker) return;
    kicker.x = W / 2;
    kicker.y = H / 2;
    kicker.lastDirX = keeperPid === 'p1' ? -1 : 1;
    kicker.lastDirY = 0;
    const b = this.gs.ball;
    b.holder = kickerPid;
    b.x = kicker.x + kicker.lastDirX * (kicker.r + BALL_R + 2);
    b.y = kicker.y;
    b.vx = 0; b.vy = 0; b.inAir = false;
    const greenStart = 0.12 + Math.random() * 0.65;
    const goalX = keeperPid === 'p1' ? PLAY_LEFT : PLAY_RIGHT;
    this.gs.penaltyMode = {
      pending: false,
      active: true,
      kicker: kickerPid, keeper: keeperPid,
      goalX, goalY: H / 2, goalH: SHOT_GOAL_H,
      barPos: 0, barDir: 1,
      baseSpeed: 0.0012, currentSpeed: 0.0012,
      greenStart, greenWidth: 0.13,
      shot: false,
    };
    // Penaltıda mevcut duvarlar silinsin
    if (this.gs.walls && this.gs.walls.length) this.gs.walls = [];
    ['p1', 'p2'].forEach(pp => {
      const pl = this.gs.players[pp];
      if (pl && pl.wallPreview) pl.wallPreview.active = false;
    });
    this.addFlash('🏈 PENALTİ BAR!', '#ffaa00');
  }
  updatePenaltyBar(dt) {
    const pm = this.gs.penaltyMode;
    if (!pm || !pm.active || pm.shot) return;
    const keeper = this.gs.players[pm.keeper];
    const isHolding = keeper && keeper.inputPenaltyBoost;
    const targetSpeed = isHolding ? pm.baseSpeed * 4 : pm.baseSpeed;
    pm.currentSpeed += (targetSpeed - pm.currentSpeed) * 0.1;
    pm.barPos += pm.barDir * pm.currentSpeed * dt;
    if (pm.barPos >= 1) { pm.barPos = 1; pm.barDir = -1; }
    if (pm.barPos <= 0) { pm.barPos = 0; pm.barDir = 1; }
  }
  shootPenalty(pid) {
    const pm = this.gs.penaltyMode;
    if (!pm || !pm.active || pm.shot || pid !== pm.kicker) return;
    pm.shot = true;
    const b = this.gs.ball;
    const inGreen = pm.barPos >= pm.greenStart && pm.barPos <= pm.greenStart + pm.greenWidth;
    b.holder = null; b.inAir = true;
    const dx = pm.goalX - b.x;
    const dy = (inGreen ? pm.goalY : pm.goalY + (Math.random() > 0.5 ? 1 : -1) * (pm.goalH + 40)) - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const shotSpeed = 18;
    b.vx = (dx / dist) * shotSpeed;
    b.vy = (dy / dist) * shotSpeed;
    this.addFlash(inGreen ? '🎯 MÜKEMMEL VURUŞ!' : '💨 ISKALADI!', inGreen ? '#00ff88' : '#ff4444');
  }
  endPenaltyMode(scorerPid) {
    if (!this.gs.penaltyMode) return;
    this.gs.penaltyMode.active = false;
    if (scorerPid) {
      const idx = scorerPid === 'p1' ? 0 : 1;
      this.gs.score[idx]++;
      this.addFlash(scorerPid === 'p1' ? '🔵 PENALTİ GOL! +1' : '🔴 PENALTİ GOL! +1', scorerPid === 'p1' ? '#00d4ff' : '#ff4d6d');
      if (this.gs.score[idx] >= WIN_SCORE) { this.endGame(scorerPid); return; }
    } else {
      this.addFlash('❌ PENALTİ ISKALANDI!', '#888');
    }
    if (this._penaltyEndTimer) clearTimeout(this._penaltyEndTimer);
    this._penaltyEndTimer = setTimeout(() => {
      this._penaltyEndTimer = null;
      this.gs.penaltyMode = null;
      this.resetRound();
    }, 1200);
  }

  // ─────────────── UPDATE PLAYER ───────────────
  updatePlayer(pid, dt) {
    const p = this.gs.players[pid];
    if (!p) return;
    const frameScale = Math.max(0.5, Math.min(3, dt / (1000 / 60)));

    // Cooldowns
    p.abilities.forEach(ab => {
      if (ab.cdLeft > 0) ab.cdLeft -= dt;
      else { ab.cdLeft = 0; ab.active = false; }
    });

    if (p.frozenTimer > 0) {
      p.frozenTimer -= dt;
      return;
    }

    // Penaltıda hareket yok
    if (this.gs.penaltyMode && (this.gs.penaltyMode.active || this.gs.penaltyMode.pending)) return;

    // Pulling
    if (p.pullingTimer > 0) {
      p.pullingTimer -= dt;
      const owner = this.gs.players[p.pulledBy];
      if (owner) {
        const dx = owner.x - p.x, dy = owner.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 30) {
          const pullSpeed = 0.35 * dt;
          p.vx = (dx / dist) * pullSpeed;
          p.vy = (dy / dist) * pullSpeed;
          p.x += p.vx; p.y += p.vy;
          clampPlayer(p);
          if (this.gs.ball.holder === pid) {
            this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7);
            this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7);
          }
        }
      }
      if (p.pullingTimer <= 0) p.pulledBy = null;
      return;
    }

    p.r = PLAYER_R;

    if (p.speedBoostTimer > 0) p.speedBoostTimer -= dt;
    if (p.shotActiveTimer > 0) p.shotActiveTimer -= dt;

    // Geopas ikinci tuş penceresi
    if (p.geopasActive && p.geopasTimer > 0) {
      p.geopasTimer -= dt;
      if (p.geopasTimer <= 0) {
        p.geopasActive = false;
        const gab = p.abilities.find(a => a.id === 'geopas');
        if (gab && gab.active) { gab.active = false; gab.cdLeft = gab.cd; }
      }
    }

    // Wall hold-to-place
    if (p.wallPreview && p.wallPreview.active) {
      const wAb = p.abilities.find(a => a.id === 'wall');
      if (wAb) {
        p.wallPreview.timeoutMs -= dt;
        if (p.inputWallHeld) {
          p.wallPreview.holdMs += dt;
          if (p.wallPreview.holdMs >= 380) this.placeWall(pid);
        } else {
          p.wallPreview.holdMs = 0;
        }
        if (p.wallPreview && p.wallPreview.active && p.wallPreview.timeoutMs <= 0) {
          p.wallPreview.active = false;
          wAb.active = false;
        }
      }
    }

    // Teknik pass charge ilerlemesi (Space tutulduğunda istemci event'leri ile yönetilir;
    // burada sadece şarjı sayıyoruz)
    if (p.passCharging) {
      if (this.gs.ball.holder !== pid || this.gs.penaltyMode || !this.playerIsTeknik(pid)) {
        p.passCharging = false; p.passChargeMs = 0;
      } else {
        p.passChargeMs = Math.min(TEKNIK_PASS_MAX_CHARGE_MS, p.passChargeMs + dt);
      }
    }

    // Slide
    if (p.slideTimer > 0) {
      p.slideTimer -= dt;
      p.x += p.slideVx * frameScale;
      p.y += p.slideVy * frameScale;
      p.slideVx *= 0.9; p.slideVy *= 0.9;
      clampPlayer(p);
      if (this.gs.ball.holder === pid) {
        this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7);
        this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7);
      }
      return;
    }

    // Hareket
    let dx = p.inputDX || 0, dy = p.inputDY || 0;
    let inSlowZone = false;
    this.gs.slowZones.forEach(z => {
      if (Math.hypot(p.x - z.x, p.y - z.y) < z.radius) inSlowZone = true;
    });
    const zoneSlow = inSlowZone ? 0.35 : 1.0;
    const speedBoostMod = p.speedBoostTimer > 0 ? 1.9 : 1.0;
    const isOfansif = p.profile && p.profile.id === 'ofansif';
    const profileSpeedMod = isOfansif ? 1.1 : 1.0;
    const ballHoldMod = (this.gs.ball.holder === pid && !isOfansif) ? 0.8 : 1;
    const speed = PLAYER_SPEED * ballHoldMod * (p.poweredTimer > 0 ? 1.4 : 1) * zoneSlow * speedBoostMod * profileSpeedMod;

    if (p.controlsReversedTimer > 0) {
      dx = -dx; dy = -dy;
      p.controlsReversedTimer -= dt;
    }

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dx !== 0 || dy !== 0) {
      const moveStep = speed * frameScale;
      p.x += (dx / len) * moveStep;
      p.y += (dy / len) * moveStep;
      p.lastDirX = dx / len;
      p.lastDirY = dy / len;
      p.clones.forEach(c => {
        c.x += (dx / len) * moveStep;
        c.y += (dy / len) * moveStep;
        c.x = Math.max(FIELD_LEFT + PLAYER_R, Math.min(FIELD_RIGHT - PLAYER_R, c.x));
        c.y = Math.max(FIELD_TOP + PLAYER_R, Math.min(FIELD_BOTTOM - PLAYER_R, c.y));
      });
    }

    p.clones = p.clones.filter(c => { c.life -= dt; return c.life > 0; });
    if (p.poweredTimer > 0) p.poweredTimer -= dt;

    // Lob charging — alan biterse cancel
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
        p.lobCharging = false; p.lobChargeTimer = 0;
        const lobAb = p.abilities.find(a => a.id === 'lob');
        if (lobAb) lobAb.cdLeft = lobAb.cd;
        this.addFlash('❌ ALAN BİTTİ!', '#888');
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
        p.slowOrbCharging = false; p.slowOrbChargeTimer = 0;
        const orbAb = p.abilities.find(a => a.id === 'sloworb');
        if (orbAb) orbAb.cdLeft = orbAb.cd;
        this.addFlash('❌ KÜRE BİTTİ!', '#888');
      }
    }

    if (p.longPassCharging) {
      if (this.gs.ball.holder !== pid || this.gs.penaltyMode) {
        p.longPassCharging = false; p.longPassChargeMs = 0;
        const lpAb = p.abilities.find(a => a.id === 'longpass');
        if (lpAb) lpAb.active = false;
      } else {
        p.longPassChargeMs = Math.min(LONG_PASS_MAX_CHARGE_MS, p.longPassChargeMs + dt);
        if (p.longPassChargeMs >= LONG_PASS_MAX_CHARGE_MS) {
          this.executeLongPass(pid);
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
        p.smokeCharging = false; p.smokeChargeTimer = 0;
        const smokeAb = p.abilities.find(a => a.id === 'smoke');
        if (smokeAb) smokeAb.cdLeft = smokeAb.cd;
        this.addFlash('❌ SİS BİTTİ!', '#888');
      }
    }

    clampPlayer(p);
    if (this.gs.ball.holder === pid) {
      this.gs.ball.x = p.x + p.lastDirX * (p.r * 0.7);
      this.gs.ball.y = p.y + p.lastDirY * (p.r * 0.7);
    }
  }

  // ─────────────── UPDATE BALL ───────────────
  updateBall(dt) {
    const b = this.gs.ball;
    if (this.gs.penaltyMode && this.gs.penaltyMode.pending) return;
    if (b.holder !== null) return;
    if (b.lobMode) {
      b.lobProgress += 0.018;
      if (b.lobProgress >= 1) {
        b.lobProgress = 1; b.lobMode = false;
        b.x = b.lobTo.x; b.y = b.lobTo.y;
        b.vx = 0; b.vy = 0; b.inAir = false;
      } else {
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
    if (!(this.gs.penaltyMode && this.gs.penaltyMode.shot) && !b.longPassMode && !b.shotMode) {
      b.vx *= BALL_FRICTION;
      b.vy *= BALL_FRICTION;
    }
    if (!(this.gs.penaltyMode && this.gs.penaltyMode.shot)) {
      const clearFastModes = () => {
        if (b.longPassMode) { b.longPassMode = false; b.longPassOwner = null; }
        if (b.shotMode) { b.shotMode = false; b.shotOwner = null; }
        if (b.teknikPassMode) b.teknikPassMode = false;
      };
      if (b.x - BALL_R < FIELD_LEFT) { b.x = FIELD_LEFT + BALL_R; b.vx *= -0.82; clearFastModes(); }
      if (b.x + BALL_R > FIELD_RIGHT) { b.x = FIELD_RIGHT - BALL_R; b.vx *= -0.82; clearFastModes(); }
      if (b.y - BALL_R < FIELD_TOP) { b.y = FIELD_TOP + BALL_R; b.vy *= -0.82; clearFastModes(); }
      if (b.y + BALL_R > FIELD_BOTTOM) { b.y = FIELD_BOTTOM - BALL_R; b.vy *= -0.82; clearFastModes(); }
    }
    if (Math.abs(b.vx) < 0.1) b.vx = 0;
    if (Math.abs(b.vy) < 0.1) b.vy = 0;
  }

  // ─────────────── COLLISIONS ───────────────
  checkCollisions(dt) {
    const pKeys = Object.keys(this.gs.players);
    const b = this.gs.ball;
    if (this.gs.tackleCooldown > 0) this.gs.tackleCooldown -= dt;

    // Player-player collision
    for (let i = 0; i < pKeys.length; i++) {
      for (let j = i + 1; j < pKeys.length; j++) {
        const p1 = this.gs.players[pKeys[i]];
        const p2 = this.gs.players[pKeys[j]];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = p1.r + p2.r;
        if (dist < minDist && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          const overlap = minDist - dist;
          p1.x -= nx * overlap * 0.5; p1.y -= ny * overlap * 0.5;
          p2.x += nx * overlap * 0.5; p2.y += ny * overlap * 0.5;
          if (this.gs.tackleCooldown <= 0 && p1.team !== p2.team) {
            if (p1.poweredTimer > 0 && b.holder === pKeys[j]) {
              b.holder = null; b.vx = nx * 6; b.vy = ny * 6; b.inAir = true;
              this.gs.tackleCooldown = 800;
              this.addFlash('🔥 YIKILDI!', '#ffd700');
            } else if (p2.poweredTimer > 0 && b.holder === pKeys[i]) {
              b.holder = null; b.vx = -nx * 6; b.vy = -ny * 6; b.inAir = true;
              this.gs.tackleCooldown = 800;
              this.addFlash('🔥 YIKILDI!', '#ffd700');
            }
            // Güç temas — sersem
            if (p1.poweredTimer > 0 && p2.frozenTimer <= 0) {
              p2.frozenTimer = POWER_STUN_MS;
              if (b.holder === pKeys[j]) { b.holder = null; b.shotMode = false; b.shotOwner = null; b.vx = nx * 3; b.vy = ny * 3; b.inAir = true; }
              this.gs.tackleCooldown = 700;
              this.addFlash('🥴 SERSEM!', '#ffd700');
            } else if (p2.poweredTimer > 0 && p1.frozenTimer <= 0) {
              p1.frozenTimer = POWER_STUN_MS;
              if (b.holder === pKeys[i]) { b.holder = null; b.shotMode = false; b.shotOwner = null; b.vx = -nx * 3; b.vy = -ny * 3; b.inAir = true; }
              this.gs.tackleCooldown = 700;
              this.addFlash('🥴 SERSEM!', '#ffd700');
            }
          }
        }
      }
    }

    // Shot mode ball-player hit
    if (b.shotMode && b.holder === null && !b.lobMode) {
      const ownerTeam = this.gs.players[b.shotOwner] ? this.gs.players[b.shotOwner].team : null;
      for (const pid of pKeys) {
        const p = this.gs.players[pid];
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
          this.addFlash('💥 ŞUT ÇARPTI! SERSEM!', '#ff6600');
          break;
        }
      }
    }

    // Teknik pass catch
    if (b.teknikPassMode && b.holder === null && !b.lobMode) {
      for (const pid of pKeys) {
        const pl = this.gs.players[pid];
        if (pl.frozenTimer > 0) continue;
        const pdx = b.x - pl.x, pdy = b.y - pl.y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < pl.r + BALL_R + 4) {
          b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
          b.teknikPassMode = false;
          b.shotMode = false; b.shotOwner = null;
          b.longPassMode = false; b.longPassOwner = null;
          this.addFlash('🎯 KONTROLLÜ PAS!', '#00e5ff');
          break;
        }
      }
    }

    // Long pass catch
    if (b.longPassMode) {
      for (const pid of pKeys) {
        if (pid === b.longPassOwner) continue;
        const p = this.gs.players[pid];
        const ldx = b.x - p.x, ldy = b.y - p.y;
        const ldist = Math.sqrt(ldx * ldx + ldy * ldy);
        if (ldist < p.r + BALL_R + 4) {
          const ownerPlayer = this.gs.players[b.longPassOwner];
          if (ownerPlayer && ownerPlayer.team === p.team) {
            b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
            b.longPassMode = false; b.longPassOwner = null;
            b.shotMode = false; b.shotOwner = null;
            this.addFlash('🏹 YAKALADIM!', p.color);
          } else {
            const lnx = ldist > 0 ? ldx / ldist : 1;
            const lny = ldist > 0 ? ldy / ldist : 0;
            const bspd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            b.vx = lnx * bspd * 0.75; b.vy = lny * bspd * 0.75;
            b.longPassMode = false; b.longPassOwner = null;
            this.addFlash('🏹 ENGELLENDİ!', '#ff66ff');
          }
          break;
        }
      }
    }

    // Auto-pickup
    const ballSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (ballSpeed < 2) {
      pKeys.forEach(pid => {
        const p = this.gs.players[pid];
        if (b.holder === null && !b.lobMode && p.frozenTimer <= 0) {
          const bx = b.x - p.x, by = b.y - p.y;
          if (Math.sqrt(bx * bx + by * by) < p.r + BALL_R) {
            b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
            b.shotMode = false; b.shotOwner = null;
            b.longPassMode = false; b.longPassOwner = null;
            b.teknikPassMode = false;
          }
        }
      });
    }

    // Freeze projectile
    if (this.gs.freezeProjectile) {
      const fp = this.gs.freezeProjectile;
      fp.x += fp.vx; fp.y += fp.vy; fp.life--;
      const ownerTeam = this.gs.players[fp.owner] ? this.gs.players[fp.owner].team : null;
      let hitTarget = null;
      for (const pid of pKeys) {
        const t = this.gs.players[pid];
        if (t.team !== ownerTeam) {
          const fdx = fp.x - t.x, fdy = fp.y - t.y;
          if (Math.sqrt(fdx * fdx + fdy * fdy) < t.r + 6) { hitTarget = pid; break; }
        }
      }
      if (hitTarget) {
        const t = this.gs.players[hitTarget];
        t.frozenTimer = 2000;
        if (b.holder === hitTarget) {
          b.holder = null;
          b.vx = t.team === 'p1' ? -2 : 2; b.vy = 0;
        }
        this.addFlash('🧊 DONDU!', '#88eeff');
        this.gs.freezeProjectile = null;
      } else if (fp.life <= 0 || fp.x < FIELD_LEFT || fp.x > FIELD_RIGHT || fp.y < FIELD_TOP || fp.y > FIELD_BOTTOM) {
        this.gs.freezeProjectile = null;
      }
    }

    // Hook projectile
    if (this.gs.hookProjectile) {
      const hp = this.gs.hookProjectile;
      hp.x += hp.vx; hp.y += hp.vy; hp.life--;
      const ownerTeam = this.gs.players[hp.owner] ? this.gs.players[hp.owner].team : null;
      let hitTarget = null;
      for (const pid of pKeys) {
        const t = this.gs.players[pid];
        if (t.team !== ownerTeam) {
          const hdx = hp.x - t.x, hdy = hp.y - t.y;
          if (Math.sqrt(hdx * hdx + hdy * hdy) < t.r + 6) { hitTarget = pid; break; }
        }
      }
      if (hitTarget) {
        const t = this.gs.players[hitTarget];
        const owner = this.gs.players[hp.owner];
        t.pullingTimer = 800;
        t.pulledBy = hp.owner;
        if (b.holder === hitTarget) {
          b.holder = null;
          b.vx = (owner.x - t.x) * 0.05;
          b.vy = (owner.y - t.y) * 0.05;
        }
        this.addFlash('🪝 YAKALANDI!', '#ffaa33');
        this.gs.hookProjectile = null;
      } else if (hp.life <= 0 || hp.x < FIELD_LEFT || hp.x > FIELD_RIGHT || hp.y < FIELD_TOP || hp.y > FIELD_BOTTOM) {
        this.gs.hookProjectile = null;
      }
    }

    // Slow orbs
    for (let i = this.gs.slowOrbProjectiles.length - 1; i >= 0; i--) {
      const orb = this.gs.slowOrbProjectiles[i];
      orb.progress += 0.025;
      if (orb.progress >= 1) {
        this.gs.slowZones.push({ x: orb.targetX, y: orb.targetY, radius: 110, life: orb.duration, owner: orb.owner });
        this.addFlash('🔮 ALAN OLUŞTU!', '#33ffaa');
        this.gs.slowOrbProjectiles.splice(i, 1);
      } else {
        const t = orb.progress;
        const mx = (orb.startX + orb.targetX) / 2;
        const my = Math.min(orb.startY, orb.targetY) - 150;
        orb.x = (1 - t) * (1 - t) * orb.startX + 2 * (1 - t) * t * mx + t * t * orb.targetX;
        orb.y = (1 - t) * (1 - t) * orb.startY + 2 * (1 - t) * t * my + t * t * orb.targetY;
      }
    }
    this.gs.slowZones = this.gs.slowZones.filter(z => { z.life -= dt; return z.life > 0; });

    // Smoke
    for (let i = this.gs.smokeProjectiles.length - 1; i >= 0; i--) {
      const orb = this.gs.smokeProjectiles[i];
      orb.progress += 0.022;
      if (orb.progress >= 1) {
        this.gs.smokeZones.push({ x: orb.targetX, y: orb.targetY, radius: 145, life: orb.duration, owner: orb.owner });
        this.gs.smokeProjectiles.splice(i, 1);
      } else {
        orb.x = orb.startX + (orb.targetX - orb.startX) * orb.progress;
        orb.y = orb.startY + (orb.targetY - orb.startY) * orb.progress;
      }
    }
    this.gs.smokeZones = this.gs.smokeZones.filter(z => { z.life -= dt; return z.life > 0; });

    // Clone teleport / clone destroy
    ['p1', 'p2'].forEach(pid => {
      const p = this.gs.players[pid];
      if (!p) return;
      const opp = this.gs.players[this.getOpponentPid(pid)];
      if (b.holder === null && !b.lobMode && p.clones.length > 0 && p.frozenTimer <= 0) {
        for (let i = 0; i < p.clones.length; i++) {
          const c = p.clones[i];
          const dxc = b.x - c.x, dyc = b.y - c.y;
          if (Math.sqrt(dxc * dxc + dyc * dyc) < p.r + BALL_R + 8) {
            const oldX = p.x, oldY = p.y;
            p.x = c.x; p.y = c.y;
            c.x = oldX; c.y = oldY;
            b.holder = pid; b.vx = 0; b.vy = 0; b.inAir = false;
            this.addFlash('💫 YER DEĞİŞTİRME!', p.color);
            break;
          }
        }
      }
      if (opp) {
        p.clones = p.clones.filter(c => {
          const cdx = opp.x - c.x, cdy = opp.y - c.y;
          if (Math.sqrt(cdx * cdx + cdy * cdy) < p.r + opp.r + 2) {
            this.addFlash('👻 HAYALET!', p.color);
            return false;
          }
          return true;
        });
      }
    });
  }

  // ─────────────── GOAL ───────────────
  checkGoal() {
    const b = this.gs.ball;
    // Penalty shot
    if (this.gs.penaltyMode && this.gs.penaltyMode.shot && this.gs.penaltyMode.active) {
      const pm = this.gs.penaltyMode;
      const crossed = pm.keeper === 'p1' ? (b.x < pm.goalX) : (b.x > pm.goalX);
      if (crossed) {
        const hit = Math.abs(b.y - pm.goalY) < pm.goalH / 2;
        if (hit) this.endPenaltyMode(pm.kicker);
        else this.endPenaltyMode(null);
        return;
      }
      if (b.x < FIELD_LEFT || b.x > FIELD_RIGHT || b.y < FIELD_TOP || b.y > FIELD_BOTTOM || (Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5)) {
        this.endPenaltyMode(null);
        return;
      }
      return;
    }
    if (this.gs.penaltyMode) return;

    let scorer = null;
    ['p1', 'p2'].forEach(pid => {
      const p = this.gs.players[pid];
      if (!p) return;
      if (b.holder === pid) {
        if (pid === 'p1' && p.x > PLAY_RIGHT) {
          const wblock = (this.gs.walls || []).find(w => w.side === 'right' && yInWallSegment(p.y, w.pos));
          if (wblock) {
            p.x = PLAY_RIGHT - p.r - 2;
            wblock.life = Math.max(0, wblock.life - 500);
          } else scorer = 'p1';
        }
        if (pid === 'p2' && p.x < PLAY_LEFT) {
          const wblock = (this.gs.walls || []).find(w => w.side === 'left' && yInWallSegment(p.y, w.pos));
          if (wblock) {
            p.x = PLAY_LEFT + p.r + 2;
            wblock.life = Math.max(0, wblock.life - 500);
          } else scorer = 'p2';
        }
      }
    });

    // Shot mode → küçük kale
    if (b.shotMode && b.shotOwner && b.holder === null && !b.lobMode) {
      const goalTopY = H / 2 - SHOT_GOAL_H / 2;
      const goalBotY = H / 2 + SHOT_GOAL_H / 2;
      const inGoalY = b.y > goalTopY && b.y < goalBotY;
      if (b.shotOwner === 'p1' && b.x + BALL_R > PLAY_RIGHT) {
        if (inGoalY) {
          const blocker = (this.gs.walls || []).find(w => w.side === 'right' && yInWallSegment(b.y, w.pos));
          if (blocker) {
            b.x = PLAY_RIGHT - BALL_R - 4; b.vx = -Math.abs(b.vx) * 0.85;
            b.shotMode = false; b.shotOwner = null;
            blocker.life = Math.max(0, blocker.life - 1500);
            this.addFlash('🛡️ DUVAR ENGELLEDİ!', '#ff8800');
          } else scorer = 'p1';
        } else {
          b.x = PLAY_RIGHT - BALL_R; b.vx = -Math.abs(b.vx) * 0.75;
          b.shotMode = false; b.shotOwner = null;
          this.addFlash('💨 ISKA!', '#ff4444');
        }
      } else if (b.shotOwner === 'p2' && b.x - BALL_R < PLAY_LEFT) {
        if (inGoalY) {
          const blocker = (this.gs.walls || []).find(w => w.side === 'left' && yInWallSegment(b.y, w.pos));
          if (blocker) {
            b.x = PLAY_LEFT + BALL_R + 4; b.vx = Math.abs(b.vx) * 0.85;
            b.shotMode = false; b.shotOwner = null;
            blocker.life = Math.max(0, blocker.life - 1500);
            this.addFlash('🛡️ DUVAR ENGELLEDİ!', '#ff8800');
          } else scorer = 'p2';
        } else {
          b.x = PLAY_LEFT + BALL_R; b.vx = Math.abs(b.vx) * 0.75;
          b.shotMode = false; b.shotOwner = null;
          this.addFlash('💨 ISKA!', '#ff4444');
        }
      }
    }

    // Free ball end zone → sek
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
      this.gs.score[idx]++;
      this.addFlash(scorer === 'p1' ? '🔵 GOL! +1' : '🔴 GOL! +1', scorer === 'p1' ? '#00d4ff' : '#ff4d6d');
      if (this.gs.score[idx] >= WIN_SCORE) { this.endGame(scorer); return; }
      this.resetRound();
    }
  }

  // ─────────────── EFFECTS ───────────────
  updateEffects(dt) {
    if (this.gs.blindTimer > 0) this.gs.blindTimer -= dt;
    if (this.gs.invisBallTimer > 0) this.gs.invisBallTimer -= dt;
    if (this.gs.walls && this.gs.walls.length) {
      this.gs.walls.forEach(w => { w.life -= dt; });
      this.gs.walls = this.gs.walls.filter(w => w.life > 0);
    }
  }

  // ─────────────── RESET / END ───────────────
  resetRound() {
    const oldScore = this.gs ? this.gs.score : [0, 0];
    const oldPlayers = this.gs ? this.gs.players : {};
    this.gs.ball = {
      x: W / 2, y: H / 2, vx: 0, vy: 0,
      holder: null, inAir: false,
      lobMode: false, lobProgress: 0, lobFrom: null, lobTo: null,
      longPassMode: false, longPassOwner: null,
      shotMode: false, shotOwner: null,
      teknikPassMode: false,
    };
    ['p1', 'p2'].forEach(pid => {
      const p = this.gs.players[pid];
      if (!p) return;
      p.x = pid === 'p1' ? PLAY_LEFT + 60 : PLAY_RIGHT - 60;
      p.y = H / 2;
      p.frozenTimer = 0;
      p.poweredTimer = 0;
      p.slideTimer = 0;
      p.lobCharging = false; p.lobChargeTimer = 0;
      p.slowOrbCharging = false; p.slowOrbChargeTimer = 0;
      p.smokeCharging = false; p.smokeChargeTimer = 0;
      p.growTimer = 0; p.shrinkTimer = 0;
      p.pullingTimer = 0; p.pulledBy = null;
      p.r = PLAYER_R;
      p.clones = [];
      p.controlsReversedTimer = 0;
      p.speedBoostTimer = 0;
      p.geopasActive = false; p.geopasTimer = 0;
      p.shotActiveTimer = 0;
      p.passCharging = false; p.passChargeMs = 0;
      p.longPassCharging = false; p.longPassChargeMs = 0;
      if (p.wallPreview) p.wallPreview.active = false;
    });
    this.gs.freezeProjectile = null;
    this.gs.hookProjectile = null;
    this.gs.slowOrbProjectiles = [];
    this.gs.slowZones = [];
    this.gs.smokeProjectiles = [];
    this.gs.smokeZones = [];
    this.gs.foulAttempts = { p1: 0, p2: 0 };
    this.gs.penaltyMode = null;
    this.gs.blindTimer = 0; this.gs.blindOwner = null;
    this.gs.invisBallTimer = 0;
    this.gs.walls = [];
  }

  endGame(winner) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.started = false;
    if (this.ticker) { clearTimeout(this.ticker); this.ticker = null; }
    this.broadcast({ type: 'gameover', winner, score: this.gs.score });
  }

  // ─────────────── TICK ───────────────
  tick(dt) {
    if (!this.gs) return;
    ['p1', 'p2'].forEach(pid => this.updatePlayer(pid, dt));
    this.updateBall(dt);
    this.updatePenaltyBar(dt);
    this.checkCollisions(dt);
    this.checkGoal();
    this.updateEffects(dt);

    this.timerTick += dt;
    if (this.timerTick >= 1000) {
      this.timerTick -= 1000;
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        const winner = this.gs.score[0] > this.gs.score[1] ? 'p1' : (this.gs.score[1] > this.gs.score[0] ? 'p2' : 'draw');
        this.endGame(winner);
        return;
      }
    }

    // Broadcast'i ayrı throttle et — 30Hz network, 60Hz simülasyon
    this._broadcastAcc += dt;
    if (this._broadcastAcc >= BROADCAST_INTERVAL_MS) {
      this._broadcastAcc = 0;
      this.broadcastState();
    }
  }

  broadcastState() {
    const flashes = this.flashes;
    this.flashes = [];
    const playersPayload = {};
    Object.keys(this.gs.players).forEach(pid => {
      playersPayload[pid] = this.serializePlayer(this.gs.players[pid]);
    });
    const ball = this.gs.ball;
    // Sayı yuvarlama: r1 = 1 ondalık (pos), r0 = tam sayı (timer)
    const r1 = (n) => Math.round(n * 10) / 10;
    const slim = {
      score: this.gs.score,
      timeLeft: this.timeLeft,
      ball: {
        x: r1(ball.x), y: r1(ball.y),
        vx: r1(ball.vx), vy: r1(ball.vy),
        holder: ball.holder,
        inAir: ball.inAir || undefined,
        lobMode: ball.lobMode || undefined,
        lobProgress: ball.lobMode ? r1(ball.lobProgress) : undefined,
        lobFrom: ball.lobMode ? ball.lobFrom : undefined,
        lobTo: ball.lobMode ? ball.lobTo : undefined,
        longPassMode: ball.longPassMode || undefined,
        longPassOwner: ball.longPassOwner || undefined,
        shotMode: ball.shotMode || undefined,
        shotOwner: ball.shotOwner || undefined,
        teknikPassMode: ball.teknikPassMode || undefined,
      },
      players: playersPayload,
    };
    // Boş array/0 değerleri sadece dolu ise gönder
    if (this.gs.tackleCooldown > 0) slim.tackleCooldown = Math.round(this.gs.tackleCooldown);
    if (this.gs.freezeProjectile) slim.freezeProjectile = this.gs.freezeProjectile;
    if (this.gs.hookProjectile) slim.hookProjectile = this.gs.hookProjectile;
    if (this.gs.slowOrbProjectiles.length) slim.slowOrbProjectiles = this.gs.slowOrbProjectiles;
    if (this.gs.slowZones.length) slim.slowZones = this.gs.slowZones;
    if (this.gs.smokeProjectiles.length) slim.smokeProjectiles = this.gs.smokeProjectiles;
    if (this.gs.smokeZones.length) slim.smokeZones = this.gs.smokeZones;
    if (this.gs.walls && this.gs.walls.length) slim.walls = this.gs.walls;
    if (this.gs.penaltyMode) slim.penaltyMode = this.gs.penaltyMode;
    if (this.gs.blindTimer > 0) { slim.blindTimer = Math.round(this.gs.blindTimer); slim.blindOwner = this.gs.blindOwner; }
    if (this.gs.invisBallTimer > 0) slim.invisBallTimer = Math.round(this.gs.invisBallTimer);
    const payload = { type: 'state', gs: slim };
    if (flashes.length) payload.flashes = flashes;
    this.broadcast(payload);
  }

  serializePlayer(p) {
    // Sadece dinamik alanlar gidiyor — color/team/r/profile/abilities tanımı `game_init`'te bir kez yollandı
    const r1 = (n) => Math.round(n * 10) / 10;
    const out = {
      x: r1(p.x), y: r1(p.y),
      lastDirX: r1(p.lastDirX), lastDirY: r1(p.lastDirY),
      abilities: p.abilities.map(a => {
        const ab = {};
        if (a.cdLeft > 0) ab.c = Math.round(a.cdLeft);
        if (a.active) ab.a = 1;
        return ab;
      }),
    };
    if (p.frozenTimer > 0) out.frozenTimer = Math.round(p.frozenTimer);
    if (p.poweredTimer > 0) out.poweredTimer = Math.round(p.poweredTimer);
    if (p.slideTimer > 0) { out.slideTimer = Math.round(p.slideTimer); out.slideVx = r1(p.slideVx); out.slideVy = r1(p.slideVy); }
    if (p.clones && p.clones.length) out.clones = p.clones.map(c => ({ x: r1(c.x), y: r1(c.y), life: Math.round(c.life) }));
    if (p.controlsReversedTimer > 0) out.controlsReversedTimer = Math.round(p.controlsReversedTimer);
    if (p.growTimer > 0) out.growTimer = Math.round(p.growTimer);
    if (p.shrinkTimer > 0) out.shrinkTimer = Math.round(p.shrinkTimer);
    if (p.pullingTimer > 0) { out.pullingTimer = Math.round(p.pullingTimer); out.pulledBy = p.pulledBy; }
    if (p.lobCharging) { out.lobCharging = 1; out.lobChargeTimer = Math.round(p.lobChargeTimer); }
    if (p.slowOrbCharging) { out.slowOrbCharging = 1; out.slowOrbChargeTimer = Math.round(p.slowOrbChargeTimer); }
    if (p.smokeCharging) { out.smokeCharging = 1; out.smokeChargeTimer = Math.round(p.smokeChargeTimer); }
    if (p.speedBoostTimer > 0) out.speedBoostTimer = Math.round(p.speedBoostTimer);
    if (p.geopasActive) { out.geopasActive = 1; out.geopasTimer = Math.round(p.geopasTimer); }
    if (p.shotActiveTimer > 0) out.shotActiveTimer = Math.round(p.shotActiveTimer);
    if (p.passCharging) { out.passCharging = 1; out.passChargeMs = Math.round(p.passChargeMs); }
    if (p.longPassCharging) { out.longPassCharging = 1; out.longPassChargeMs = Math.round(p.longPassChargeMs); }
    if (p.wallPreview && p.wallPreview.active) out.wallPreview = { active: 1, pos: p.wallPreview.pos };
    return out;
  }

  // Statik (oyun boyu değişmeyen) oyuncu verisi — sadece bir kez yollanır
  buildGameInit() {
    const players = {};
    Object.keys(this.gs.players).forEach(pid => {
      const p = this.gs.players[pid];
      players[pid] = {
        color: p.color,
        team: p.team,
        r: p.r,
        profile: p.profile,
        abilities: p.abilities.map(a => ({ id: a.id, cd: a.cd, icon: a.icon, color: a.color, name: a.name })),
      };
    });
    return { type: 'game_init', players, timeLeft: this.timeLeft };
  }

  // ─────────────── START ───────────────
  startGame() {
    if (this.started) return;
    this.initState();
    this.started = true;
    this.gameOver = false;
    this.timeLeft = GAME_DURATION;
    this.timerTick = 0;
    this._broadcastAcc = 0;
    this.lastTick = Date.now();
    this.broadcast({ type: 'start' });
    // Statik veri (color/team/profile/abilities) tek seferde gönderilir; state mesajları yalın olur
    this.broadcast(this.buildGameInit());
    this._perfSamples = [];
    this._perfDrops = 0;
    this._perfReportAt = Date.now() + 5000;
    // Fixed-step tick loop with catch-up + cap (shared CPU dostu, setInterval drift'i yok).
    // Eğer host bir loop iterasyonunu kaçırırsa accumulator dolar; max 3 tick'i catch-up'la
    // koşturup geri kalanı atıyoruz ("spiral of death" önlemi).
    this._tickAcc = 0;
    const MAX_CATCHUP_TICKS = 3;
    const loop = () => {
      if (!this.started) return;
      const now = Date.now();
      const elapsed = now - this.lastTick;
      this.lastTick = now;
      this._tickAcc += elapsed;
      // Loop iterasyonu uzun süre bloklanmışsa accumulator'ı toparla
      if (this._tickAcc > TICK_MS * 8) {
        this._perfDrops += Math.floor(this._tickAcc / TICK_MS) - MAX_CATCHUP_TICKS;
        this._tickAcc = TICK_MS * MAX_CATCHUP_TICKS;
      }
      let ticks = 0;
      const t0 = process.hrtime.bigint();
      while (this._tickAcc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
        this.tick(TICK_MS);
        this._tickAcc -= TICK_MS;
        ticks++;
        if (!this.started) return;
      }
      const tickMs = Number(process.hrtime.bigint() - t0) / 1e6;
      this._perfSamples.push(tickMs / Math.max(1, ticks));
      if (now > this._perfReportAt) {
        const arr = this._perfSamples;
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const max = Math.max(...arr);
        const bufP1 = (this.players.p1 && this.players.p1.bufferedAmount) || 0;
        const bufP2 = (this.players.p2 && this.players.p2.bufferedAmount) || 0;
        const drops = this._perfDrops;
        console.log(`[perf] tick avg=${avg.toFixed(2)}ms max=${max.toFixed(1)}ms samples=${arr.length} drops=${drops} | ws buf p1=${bufP1}B p2=${bufP2}B`);
        this._perfSamples = [];
        this._perfDrops = 0;
        this._perfReportAt = now + 5000;
      }
      // Bir sonraki tick'e kalan süre (accumulator dolu değilse bekle)
      const wait = Math.max(1, TICK_MS - this._tickAcc);
      this.ticker = setTimeout(loop, wait);
    };
    this.ticker = setTimeout(loop, TICK_MS);
  }
}

// ─────────────── WS HANDLER ───────────────
wss.on('connection', (ws) => {
  ws.roomId = null; ws.pid = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'create_room') {
      const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
      const room = new Room(roomId);
      rooms.set(roomId, room);
      const pid = room.addPlayer(ws);
      ws.send(JSON.stringify({
        type: 'room_created',
        roomId, pid,
        allSkills: ALL_SKILLS,
        profiles: PROFILES,
      }));
    }
    else if (msg.type === 'join_room') {
      const roomId = (msg.roomId || '').toUpperCase().trim();
      const room = rooms.get(roomId);
      if (!room || room.started || room.isFull()) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Oda dolu veya bulunamadı.' }));
        return;
      }
      const pid = room.addPlayer(ws);
      ws.send(JSON.stringify({
        type: 'room_joined',
        roomId, pid,
        allSkills: ALL_SKILLS,
        profiles: PROFILES,
      }));
      room.broadcast({ type: 'opponent_joined', pid });
    }
    else if (msg.type === 'select_skills') {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      room.selectedSkills[ws.pid] = Array.isArray(msg.skills) ? msg.skills.slice(0, 4) : [];
      if (msg.profile && typeof msg.profile === 'object') {
        room.profiles[ws.pid] = msg.profile;
      }
      // Eğer iki oyuncu da seçimini gönderdiyse oyun başlasın
      const p1Ready = (room.selectedSkills.p1 || []).length > 0 && room.profiles.p1;
      const p2Ready = (room.selectedSkills.p2 || []).length > 0 && room.profiles.p2;
      if (p1Ready && p2Ready) room.startGame();
    }
    else if (msg.type === 'input') {
      const room = rooms.get(ws.roomId);
      if (!room || !room.started) return;
      const p = room.gs.players[ws.pid];
      if (p) {
        p.inputDX = msg.dx || 0;
        p.inputDY = msg.dy || 0;
        p.inputPenaltyBoost = !!msg.penaltyBarBoost;
        p.inputWallHeld = !!msg.wallHeld;
      }
    }
    else if (msg.type === 'action') {
      const room = rooms.get(ws.roomId);
      if (!room || !room.started) return;
      // Client predicted pozisyon/yön ile state'i action öncesi senkronize et
      // (pas yönü, skill yönü ve tackle menzili için kritik)
      const p = room.gs.players[ws.pid];
      if (p) {
        if (typeof msg.dirX === 'number' && typeof msg.dirY === 'number') {
          const l = Math.sqrt(msg.dirX * msg.dirX + msg.dirY * msg.dirY) || 1;
          p.lastDirX = msg.dirX / l;
          p.lastDirY = msg.dirY / l;
        }
        if (typeof msg.x === 'number' && typeof msg.y === 'number') {
          // Anti-cheat sınırı: client pozisyonu sunucu pozisyonundan en fazla 40px sapabilir
          const dx = msg.x - p.x, dy = msg.y - p.y;
          if (Math.sqrt(dx * dx + dy * dy) < 60) {
            p.x = Math.max(FIELD_LEFT + p.r, Math.min(FIELD_RIGHT - p.r, msg.x));
            p.y = Math.max(FIELD_TOP + p.r, Math.min(FIELD_BOTTOM - p.r, msg.y));
          }
        }
      }
      if (msg.action === 'pass_press') room.spacePress(ws.pid);
      else if (msg.action === 'pass_release') room.spaceRelease(ws.pid);
      else if (msg.action === 'tackle') {
        if (process.env.DEBUG_TACKLE) {
          const opp = room.gs.players[ws.pid === 'p1' ? 'p2' : 'p1'];
          const me = room.gs.players[ws.pid];
          const dist = me && opp ? Math.hypot(opp.x - me.x, opp.y - me.y).toFixed(1) : 'n/a';
          console.log(`[tackle] ${ws.pid} distOpp=${dist} ballHolder=${room.gs.ball.holder} cd=${room.gs.tackleCooldown}`);
        }
        room.attemptTackle(ws.pid);
      }
      else if (msg.action === 'throw') room.throwBall(ws.pid);
      else if (msg.action === 'ability_press' && typeof msg.idx === 'number') room.startAbilityByIdx(ws.pid, msg.idx);
      else if (msg.action === 'ability_release' && typeof msg.idx === 'number') room.releaseAbilityByIdx(ws.pid, msg.idx);
    }
    else if (msg.type === 'restart') {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      room.gameOver = false;
      room.startGame();
    }
  });
  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room || !ws.pid) return;
    if (room._penaltyDelayTimer) { clearTimeout(room._penaltyDelayTimer); room._penaltyDelayTimer = null; }
    if (room._penaltyEndTimer) { clearTimeout(room._penaltyEndTimer); room._penaltyEndTimer = null; }
    room.removePlayer(ws.pid);
    room.broadcast({ type: 'opponent_left', pid: ws.pid });
    if (room.ticker) { clearTimeout(room.ticker); room.ticker = null; }
    room.started = false;
    rooms.delete(ws.roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Sunucu ${PORT} portunda aktif!`);
});
