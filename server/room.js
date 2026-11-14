const { W, H, WALLS, C, ITEM_TYPES, hitWall, freeSpot } = require('./world');
const leaderboard = require('./leaderboard');

const TICK = 30;              // simulation ticks per second
const SEND_EVERY = 2;         // broadcast state every N ticks (15/s)
const BOT_NAMES = ['بوت سامي', 'بوت ريم', 'بوت خالد', 'بوت لينا', 'بوت عمر', 'بوت نور', 'بوت زيد', 'بوت هلا'];
const BOT_COLORS = ['#868e96', '#a9a9a9', '#adb5bd', '#9e9e9e'];

let nextRoomSeq = 1;

class Room {
  constructor(code, isPublic, onEmpty) {
    this.code = code;
    this.isPublic = isPublic;
    this.onEmpty = onEmpty;
    this.seq = nextRoomSeq++;
    this.players = new Map();   // id -> player
    this.nextId = 1;
    this.bullets = [];
    this.newShots = [];
    this.events = [];
    this.items = [];
    this.itemSeq = 1;
    this.itemTimer = 0;
    this.tickN = 0;
    this.phase = 'play';
    this.endAt = 0;
    this.nextAt = 0;
    this.lastResults = null;
    this.rosterDirty = true;
    this.timer = setInterval(() => this.safeTick(), 1000 / TICK);
    this.startMatch();
  }

  get humans() { return [...this.players.values()].filter(p => !p.bot); }
  get humanCount() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  isFull() { return this.humanCount >= C.MAXP; }

  // ---------- players ----------
  makePlayer(name, color, ws, bot) {
    const p = {
      id: this.nextId++, name, color, ws, bot,
      x: 0, y: 0, a: 0, hp: C.MAXHP, dead: false, respawnAt: 0,
      shieldUntil: 0, spdUntil: 0, triUntil: 0, bombs: 0,
      kills: 0, deaths: 0, streak: 0, best: 0,
      input: { mx: 0, my: 0, a: 0, f: false }, lastFire: 0, bombReq: false,
      ai: bot ? { tx: 0, ty: 0, retarget: 0, wobble: Math.random() * 6 } : null,
    };
    this.spawn(p, this.now());
    return p;
  }

  addHuman(ws, name, color) {
    const p = this.makePlayer(name, color, ws, false);
    this.players.set(p.id, p);
    this.balanceBots();
    this.rosterDirty = true;
    this.send(p, {
      t: 'welcome', id: p.id, code: this.code, pub: this.isPublic,
      world: { w: W, h: H, walls: WALLS, pr: C.PR, spd: C.SPD, bspd: C.BSPD, blife: C.BLIFE, fire: C.FIRE, maxhp: C.MAXHP },
    });
    if (this.phase === 'end' && this.lastResults) this.send(p, this.lastResults);
    return p;
  }

  remove(p) {
    this.players.delete(p.id);
    this.rosterDirty = true;
    if (this.humanCount === 0) { this.destroy(); return; }
    this.balanceBots();
  }

  balanceBots() {
    const humans = this.humanCount;
    const want = Math.max(0, C.MIN_FILL - humans);
    const bots = [...this.players.values()].filter(p => p.bot);
    while (bots.length < want) {
      const used = new Set(bots.map(b => b.name));
      const name = BOT_NAMES.find(n => !used.has(n)) || 'بوت';
      const b = this.makePlayer(name, BOT_COLORS[bots.length % BOT_COLORS.length], null, true);
      this.players.set(b.id, b); bots.push(b);
    }
    while (bots.length > want) { const b = bots.pop(); this.players.delete(b.id); }
    this.rosterDirty = true;
  }

  spawn(p, now) {
    const [x, y] = freeSpot(C.PR);
    p.x = x; p.y = y; p.hp = C.MAXHP; p.dead = false;
    p.shieldUntil = now + C.SPAWN_SHIELD;
    p.spdUntil = 0; p.triUntil = 0; p.bombs = 0;
  }

  // ---------- input from clients ----------
  onInput(p, m) {
    if (m.t === 'in') {
      let mx = Number(m.mx) || 0, my = Number(m.my) || 0;
      const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
      const a = Number(m.a);
      p.input = { mx, my, a: Number.isFinite(a) ? a : p.input.a, f: !!m.f };
    } else if (m.t === 'bomb') {
      p.bombReq = true;
    }
  }

  // ---------- simulation ----------
  now() { return process.hrtime.bigint ? Number(process.hrtime.bigint() / 1000000n) / 1000 : Date.now() / 1000; }

  safeTick() {
    try { this.tick(); } catch (e) { console.error('room tick error', this.code, e); }
  }

  tick() {
    const now = this.now(), dt = 1 / TICK;
    this.tickN++;

    if (this.phase === 'play') {
      for (const p of this.players.values()) {
        if (p.bot) this.botThink(p, now);
        this.movePlayer(p, now, dt);
      }
      this.moveBullets(now, dt);
      this.updateItems(now, dt);
      if (now >= this.endAt) this.endMatch(now);
    } else if (now >= this.nextAt) {
      this.startMatch();
    }

    if (this.rosterDirty) { this.rosterDirty = false; this.broadcast({ t: 'roster', p: [...this.players.values()].map(p => [p.id, p.name, p.color, p.bot ? 1 : 0]) }); }
    if (this.tickN % SEND_EVERY === 0) this.sendState(now);
  }

  movePlayer(p, now, dt) {
    if (p.dead) {
      if (now >= p.respawnAt) this.spawn(p, now);
      return;
    }
    const sp = C.SPD * (now < p.spdUntil ? 1.6 : 1);
    const nx = p.x + p.input.mx * sp * dt, ny = p.y + p.input.my * sp * dt;
    if (!hitWall(nx, p.y, C.PR)) p.x = Math.max(C.PR, Math.min(W - C.PR, nx));
    if (!hitWall(p.x, ny, C.PR)) p.y = Math.max(C.PR, Math.min(H - C.PR, ny));
    p.a = p.input.a;

    const rate = p.bot ? C.BOT_FIRE : C.FIRE;
    if (p.input.f && now - p.lastFire >= rate - 0.001) {
      p.lastFire = now;
      const angs = now < p.triUntil ? [p.a - 0.16, p.a, p.a + 0.16] : [p.a];
      for (const a of angs) this.fireBullet(p, a);
    }
    if (p.bombReq) {
      p.bombReq = false;
      if (p.bombs > 0) {
        p.bombs--;
        for (let i = 0; i < 16; i++) this.fireBullet(p, i / 16 * Math.PI * 2);
        this.events.push(['boom', Math.round(p.x), Math.round(p.y)]);
      }
    }
    // pickups
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if ((p.x - it.x) ** 2 + (p.y - it.y) ** 2 < (C.PR + 18) ** 2) {
        this.items.splice(i, 1);
        this.applyItem(p, it.type, now);
        this.events.push(['pick', p.id, it.type]);
        break;
      }
    }
  }

  applyItem(p, type, now) {
    if (type === 'hp') p.hp = C.MAXHP;
    else if (type === 'spd') p.spdUntil = now + 8;
    else if (type === 'tri') p.triUntil = now + 10;
    else if (type === 'shd') p.shieldUntil = now + 7;
    else if (type === 'bmb') p.bombs = Math.min(3, p.bombs + 1);
  }

  fireBullet(p, a) {
    const x = p.x + Math.cos(a) * (C.PR + 4), y = p.y + Math.sin(a) * (C.PR + 4);
    this.bullets.push({ x, y, a, vx: Math.cos(a) * C.BSPD, vy: Math.sin(a) * C.BSPD, owner: p.id, life: C.BLIFE });
    this.newShots.push([Math.round(x), Math.round(y), +a.toFixed(3), p.id]);
  }

  moveBullets(now, dt) {
    const keep = [];
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.life <= 0) continue;
      let dead = false;
      // two sub-steps so fast bullets don't skip through players
      for (let s = 0; s < 2 && !dead; s++) {
        b.x += b.vx * dt / 2; b.y += b.vy * dt / 2;
        if (b.x < 0 || b.y < 0 || b.x > W || b.y > H || hitWall(b.x, b.y, 3)) { dead = true; break; }
        for (const p of this.players.values()) {
          if (p.id === b.owner || p.dead) continue;
          if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (C.PR + 4) ** 2) {
            dead = true;
            if (now < p.shieldUntil) break;
            p.hp--;
            this.events.push(['hit', p.id]);
            if (p.hp <= 0) this.kill(b.owner, p, now);
            break;
          }
        }
      }
      if (!dead) keep.push(b);
    }
    this.bullets = keep;
  }

  kill(killerId, victim, now) {
    victim.dead = true; victim.deaths++; victim.streak = 0; victim.respawnAt = now + C.RESPAWN;
    victim.bombs = 0; victim.spdUntil = 0; victim.triUntil = 0;
    const k = this.players.get(killerId);
    let streak = 0;
    if (k) { k.kills++; k.streak++; k.best = Math.max(k.best, k.streak); streak = k.streak; }
    this.events.push(['kill', killerId, victim.id, streak]);
  }

  updateItems(now, dt) {
    this.itemTimer += dt;
    if (this.itemTimer >= 3 && this.items.length < C.MAX_ITEMS) {
      this.itemTimer = 0;
      const [x, y] = freeSpot(16);
      this.items.push({ id: this.itemSeq++, type: ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)], x: Math.round(x), y: Math.round(y) });
    }
  }

  // ---------- bots ----------
  botThink(b, now) {
    const ai = b.ai;
    if (b.dead) { b.input = { mx: 0, my: 0, a: b.a, f: false }; return; }
    let target = null, best = 700 * 700;
    for (const p of this.players.values()) {
      if (p === b || p.dead) continue;
      const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
      if (d < best) { best = d; target = p; }
    }
    let mx = 0, my = 0, fire = false, a = b.a;
    if (target) {
      const dx = target.x - b.x, dy = target.y - b.y, dist = Math.sqrt(best);
      a = Math.atan2(dy, dx) + Math.sin(now * 2 + ai.wobble) * 0.22;
      if (dist > 260) { mx = dx / dist; my = dy / dist; }
      else { mx = -dy / dist * Math.sign(Math.sin(now * 0.7 + ai.wobble)); my = dx / dist * Math.sign(Math.sin(now * 0.7 + ai.wobble)); }
      fire = dist < 560;
    } else {
      if (now > ai.retarget || (Math.abs(ai.tx - b.x) < 30 && Math.abs(ai.ty - b.y) < 30)) {
        [ai.tx, ai.ty] = freeSpot(C.PR); ai.retarget = now + 6;
      }
      const dx = ai.tx - b.x, dy = ai.ty - b.y, d = Math.hypot(dx, dy) || 1;
      mx = dx / d; my = dy / d; a = Math.atan2(dy, dx);
    }
    // simple wall avoidance: if blocked, slide sideways
    if (hitWall(b.x + mx * 30, b.y + my * 30, C.PR)) { const t = mx; mx = -my; my = t; ai.retarget = now; }
    b.input = { mx, my, a, f: fire };
  }

  // ---------- matches ----------
  startMatch() {
    const now = this.now();
    this.phase = 'play';
    this.endAt = now + C.MATCH;
    this.bullets = []; this.items = []; this.itemTimer = 0; this.lastResults = null;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.streak = 0; p.best = 0; this.spawn(p, now); }
    this.broadcast({ t: 'start' });
  }

  endMatch(now) {
    this.phase = 'end';
    this.nextAt = now + C.BREAK;
    const all = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const results = all.map(p => [p.id, p.name, p.color, p.kills, p.deaths, p.best, p.bot ? 1 : 0]);
    const winner = all[0] && all[0].kills > 0 ? all[0] : null;
    const humans = all.filter(p => !p.bot);
    this.lastResults = { t: 'end', r: results, next: C.BREAK };
    this.broadcast(this.lastResults);
    leaderboard.record(humans.map(p => ({ name: p.name, kills: p.kills, win: p === winner })))
      .then(() => leaderboard.top())
      .then(top => { this.lastResults.g = top; this.broadcast({ t: 'glb', g: top }); })
      .catch(e => console.error('leaderboard', e));
  }

  // ---------- networking ----------
  sendState(now) {
    const ps = [];
    for (const p of this.players.values()) {
      const flags = (p.dead ? 1 : 0) | (now < p.shieldUntil ? 2 : 0) | (now < p.spdUntil ? 4 : 0) | (now < p.triUntil ? 8 : 0);
      ps.push([p.id, Math.round(p.x), Math.round(p.y), +p.a.toFixed(2), p.hp, flags, p.kills, p.deaths, p.bombs]);
    }
    const msg = {
      t: 's', p: ps, b: this.newShots, e: this.events,
      it: this.items.map(i => [i.id, i.type, i.x, i.y]),
      tl: Math.max(0, Math.round(((this.phase === 'play' ? this.endAt : this.nextAt) - now) * 1000)), ph: this.phase === 'play' ? 0 : 1,
    };
    this.newShots = []; this.events = [];
    this.broadcast(msg);
  }

  send(p, msg) {
    if (!p.ws || p.ws.readyState !== 1) return;
    try { p.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { /* ignore */ }
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (!p.bot) this.send(p, s);
  }

  destroy() {
    clearInterval(this.timer);
    this.onEmpty(this);
  }
}

module.exports = { Room };
