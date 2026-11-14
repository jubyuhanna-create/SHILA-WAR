const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');
const leaderboard = require('./leaderboard');
const { C } = require('./world');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const rooms = new Map(); // code -> Room

function newCode() {
  for (let i = 0; i < 1000; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  return String(Date.now()).slice(-6);
}

function createRoom(isPublic) {
  const code = newCode();
  const room = new Room(code, isPublic, r => rooms.delete(r.code));
  rooms.set(code, room);
  return room;
}

function quickRoom() {
  let best = null;
  for (const r of rooms.values()) {
    if (!r.isPublic || r.isFull()) continue;
    if (!best || r.humanCount > best.humanCount) best = r;
  }
  return best || createRoom(true);
}

// ---------- names ----------
const BAD = ['fuck', 'shit', 'bitch', 'nigg', 'كس', 'شرموط', 'عرص', 'منيك', 'زب', 'قحب', 'خول'];
function cleanName(n) {
  let s = String(n || '').replace(/[\u0000-\u001f​-‏‪-‮<>]/g, '').trim().slice(0, 14);
  const low = s.toLowerCase();
  if (!s || BAD.some(b => low.includes(b))) s = 'لاعب' + Math.floor(Math.random() * 1000);
  return s;
}
function cleanColor(c) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#4dabff'; }

// ---------- http ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/health') { res.end('ok'); return; }
  if (url.pathname === '/api/leaderboard') {
    const top = await leaderboard.top();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ top, online: [...rooms.values()].reduce((n, r) => n + r.humanCount, 0), rooms: rooms.size }));
    return;
  }
  let file = path.normalize(path.join(CLIENT_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(CLIENT_DIR)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', ws => {
  let room = null, player = null;
  let msgs = 0, windowStart = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    // rate limit: inputs come ~20/s; allow bursts, drop abusers
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; msgs = 0; }
    if (++msgs > 80) { if (msgs > 300) ws.terminate(); return; }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'p') { try { ws.send(JSON.stringify({ t: 'p', c: m.c })); } catch {} return; }

    if (m.t === 'join') {
      if (player) return;
      if (m.mode === 'code') {
        const r = rooms.get(String(m.code || ''));
        if (!r) { ws.send(JSON.stringify({ t: 'err', m: 'ما في غرفة بهالرقم' })); return; }
        if (r.isFull()) { ws.send(JSON.stringify({ t: 'err', m: 'الغرفة مليانة (' + C.MAXP + ' لاعب)' })); return; }
        room = r;
      } else if (m.mode === 'create') room = createRoom(false);
      else room = quickRoom();
      player = room.addHuman(ws, cleanName(m.name), cleanColor(m.color));
      return;
    }
    if (room && player) room.onInput(player, m);
  });

  ws.on('close', () => { if (room && player) room.remove(player); room = null; player = null; });
  ws.on('error', () => {});
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15000);

server.listen(PORT, () => {
  console.log('Shilla War server on :' + PORT + (leaderboard.useDb ? ' (Supabase leaderboard)' : ' (memory leaderboard)'));
});
