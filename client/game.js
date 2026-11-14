(() => {
'use strict';
// ================= setup =================
const COLORS = ['#ff4d6d', '#4dabff', '#ffd43b', '#51cf66', '#cc5de8', '#ff922b', '#20c997', '#f783ac'];
const ITEMS = { hp: '❤️', spd: '⚡', tri: '🔱', shd: '🛡️', bmb: '💣' };
const ITEM_MSG = { hp: '❤️ صحة كاملة', spd: '⚡ سرعة!', tri: '🔱 طخ تلاتي!', shd: '🛡️ درع!', bmb: '💣 قنبلة! كبس الزر البرتقالي' };
const STREAK = { 2: '💥 دبل!', 3: '🔥 تريبل!', 4: '😈 مش طبيعي!', 5: '👑 ملك الساحة!' };
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const SERVER = (window.SERVER_URL || location.origin).replace(/\/$/, '');
const WS_URL = SERVER.replace(/^http/, 'ws') + '/ws';

const cv = $('cv'), ctx = cv.getContext('2d');
let dpr = 1, cw = 0, ch = 0, scale = 1;
function resize() { dpr = Math.min(2, window.devicePixelRatio || 1); cw = innerWidth; ch = innerHeight; cv.width = cw * dpr; cv.height = ch * dpr; scale = Math.min(cw, ch) / 520; }
addEventListener('resize', resize); resize();

let myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
try { const s = localStorage.getItem('shl_name'); if (s) $('nm').value = s; const c = localStorage.getItem('shl_col'); if (COLORS.includes(c)) myColor = c; } catch (e) {}
function drawCols() { $('cols').innerHTML = COLORS.map(c => `<div style="background:${c}" class="${c === myColor ? 'on' : ''}" data-c="${c}"></div>`).join(''); }
drawCols();
$('cols').onclick = e => { if (e.target.dataset.c) { myColor = e.target.dataset.c; drawCols(); } };
if (/^#\d{4,6}$/.test(location.hash)) $('code').value = location.hash.slice(1);

// ================= sound =================
let actx = null, muted = false;
try { muted = localStorage.getItem('shl_mute') === '1'; } catch (e) {}
$('mute').textContent = muted ? '🔇' : '🔊';
$('mute').onclick = () => { muted = !muted; $('mute').textContent = muted ? '🔇' : '🔊'; try { localStorage.setItem('shl_mute', muted ? '1' : '0'); } catch (e) {} };
function beep(f, d, type, vol, delay) {
  try {
    if (muted || !actx) return;
    const t = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
  } catch (e) {}
}
const SND = {
  shoot: () => beep(900, 0.05, 'square', 0.015), hit: () => beep(150, 0.18, 'sawtooth', 0.08),
  kill: () => { beep(660, 0.1, 'square', 0.06); beep(990, 0.18, 'square', 0.06, 0.1); },
  pick: () => { beep(800, 0.08, 'sine', 0.07); beep(1300, 0.12, 'sine', 0.07, 0.08); },
  die: () => beep(90, 0.5, 'sawtooth', 0.1), boom: () => beep(60, 0.5, 'sawtooth', 0.12),
  win: () => { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.2, 'square', 0.05, i * 0.12)); },
};

// ================= state =================
let world = null, myId = 0, roomCode = '', roomPublic = true;
let roster = new Map();        // id -> {name,color,bot}
let players = new Map();       // id -> {x,y,tx,ty,a,hp,flags,kills,deaths,bombs}
let items = [], bullets = [], booms = [];
let phase = 0, timeLeft = 0, timeAt = 0, ping = 0;
const me = { x: 0, y: 0, a: 0, lastFire: 0, deadShown: false };
let playing = false;
const feed = [];
function nameOf(id) { const r = roster.get(id); return r ? r.name : '؟'; }
function colorOf(id) { const r = roster.get(id); return r ? r.color : '#aaa'; }
function addFeed(t) { feed.push({ t, at: performance.now() }); if (feed.length > 5) feed.shift(); }
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2000); }
function showStreak(t) { const s = $('streak'); s.textContent = t; s.style.opacity = 1; clearTimeout(showStreak.t); showStreak.t = setTimeout(() => s.style.opacity = 0, 1600); }
function banner(t) { $('banner').classList.toggle('hidden', !t); $('bannerT').textContent = t || ''; }
function setNet(t) { $('net').textContent = t || ''; }
function myP() { return players.get(myId); }

function hitWall(x, y, r) {
  for (const w of world.walls) {
    const cx = Math.max(w[0], Math.min(x, w[0] + w[2])), cy = Math.max(w[1], Math.min(y, w[1] + w[3]));
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

// ================= menu leaderboard (also wakes the server up) =================
async function loadMenuTop() {
  try {
    const r = await fetch(SERVER + '/api/leaderboard'); const j = await r.json();
    const top = (j.top || []).slice(0, 5);
    $('menuTop').innerHTML = `<div style="text-align:center;margin-bottom:4px">🟢 ${j.online | 0} لاعب أونلاين هلأ</div>` +
      (top.length ? '<table>' + top.map((p, i) => `<tr><td>${['🥇', '🥈', '🥉', '4', '5'][i]}</td><td>${esc(p.name)}</td><td>${p.kills | 0} 🎯</td><td>${p.wins | 0} 🏆</td></tr>`).join('') + '</table>' : '');
  } catch (e) { $('menuTop').textContent = '⏳ السيرفر عم يصحى...'; setTimeout(loadMenuTop, 5000); }
}
loadMenuTop();

// ================= network =================
let ws = null, joinReq = null, intentionalClose = false, reconnectTries = 0, sendTimer = null, pingTimer = null;

function connect(req) {
  joinReq = req; intentionalClose = false;
  setButtons(false);
  const started = Date.now();
  const slow = setTimeout(() => setNet('⏳ بصحّي السيرفر... أول مرة ممكن تاخد لحد دقيقة'), 3000);
  let opened = false;
  try { ws = new WebSocket(WS_URL); } catch (e) { clearTimeout(slow); retry(); return; }
  ws.onopen = () => {
    opened = true; clearTimeout(slow); reconnectTries = 0;
    ws.send(JSON.stringify({ t: 'join', mode: req.mode, code: req.code, name: req.name, color: req.color }));
  };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } try { onMsg(m); } catch (e) { console.error(e); } };
  ws.onclose = () => {
    clearTimeout(slow); clearInterval(sendTimer); clearInterval(pingTimer);
    if (intentionalClose) return;
    if (playing) { banner('🔄 انقطع الاتصال، برجع بتصل...'); setTimeout(() => reconnect(), 1500); }
    else if (!opened && Date.now() - started < 100000) retry();
    else { setNet('🔴 ما قدرت أتصل بالسيرفر، جرب كمان مرة'); setButtons(true); }
  };
  ws.onerror = () => {};
  function retry() { if (++reconnectTries > 30) { setNet('🔴 السيرفر مش راد'); setButtons(true); return; } setTimeout(() => connect(req), 3000); }
}
function reconnect() {
  if (intentionalClose) return;
  if (++reconnectTries > 30) { banner(''); backToMenu('🔴 انقطع الاتصال'); return; }
  const req = roomPublic ? { ...joinReq, mode: 'quick' } : { ...joinReq, mode: 'code', code: roomCode };
  connect(req);
}
function send(m) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(m)); } catch (e) {} } }
function setButtons(on) { for (const id of ['quick', 'create', 'join']) $(id).disabled = !on; }

function onMsg(m) {
  switch (m.t) {
    case 'err':
      intentionalClose = true; try { ws.close(); } catch (e) {}
      if (playing) backToMenu('🔴 ' + m.m); else { setNet('🔴 ' + m.m); setButtons(true); }
      break;
    case 'welcome':
      world = m.world; myId = m.id; roomCode = m.code; roomPublic = !!m.pub;
      players = new Map(); bullets = []; items = []; me.deadShown = false;
      playing = true; banner(''); setNet('');
      $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
      $('share').classList.toggle('hidden', roomPublic);
      if (!roomPublic) { history.replaceState(null, '', '#' + roomCode); toast('🔑 رقم الغرفة ' + roomCode + '، كبس 🔗 لتبعت الرابط'); }
      clearInterval(sendTimer); sendTimer = setInterval(sendInput, 50);
      clearInterval(pingTimer); pingTimer = setInterval(() => send({ t: 'p', c: performance.now() }), 3000);
      keepAwake();
      break;
    case 'roster':
      roster = new Map(m.p.map(r => [r[0], { name: r[1], color: r[2], bot: !!r[3] }]));
      for (const id of [...players.keys()]) if (!roster.has(id)) players.delete(id);
      break;
    case 's': onState(m); break;
    case 'start': $('end').classList.add('hidden'); addFeed('🔔 جيم جديد!'); me.deadShown = false; break;
    case 'end': showEnd(m); break;
    case 'glb': fillGlobal(m.g); break;
    case 'p': ping = Math.round(performance.now() - m.c); break;
  }
}

function onState(m) {
  const now = performance.now();
  phase = m.ph; timeLeft = m.tl; timeAt = now;
  for (const r of m.p) {
    const [id, x, y, a, hp, flags, kills, deaths, bombs] = r;
    let p = players.get(id);
    if (!p) { p = { x, y }; players.set(id, p); }
    Object.assign(p, { tx: x, ty: y, a, hp, flags, kills, deaths, bombs });
    if (id === myId) {
      const dead = flags & 1;
      const err = Math.hypot(x - me.x, y - me.y);
      if (dead || err > 90 || !me.init) { me.x = x; me.y = y; me.init = true; }
      else if (err > 25) { me.x += (x - me.x) * 0.2; me.y += (y - me.y) * 0.2; }
    }
  }
  items = m.it;
  // bullets: own normal shots are drawn locally already; bombs (many at once) come from server
  const mine = m.b.filter(b => b[3] === myId).length;
  for (const b of m.b) {
    if (b[3] === myId && mine < 8) continue;
    bullets.push({ x: b[0], y: b[1], vx: Math.cos(b[2]) * world.bspd, vy: Math.sin(b[2]) * world.bspd, life: world.blife, owner: b[3] });
  }
  for (const e of m.e) onEvent(e, now);
}

function onEvent(e, now) {
  if (e[0] === 'hit') { if (e[1] === myId) { SND.hit(); try { navigator.vibrate && navigator.vibrate(40); } catch (x) {} } }
  else if (e[0] === 'kill') {
    const [, k, v, streak] = e;
    addFeed(nameOf(k) + ' 🔫 ' + nameOf(v));
    if (k === myId) { SND.kill(); showStreak(STREAK[Math.min(streak, 5)] || '🎯 طخيتو!'); }
    if (v === myId) { SND.die(); me.killer = nameOf(k); }
  }
  else if (e[0] === 'pick') { if (e[1] === myId) { SND.pick(); showStreak(ITEM_MSG[e[2]] || ''); } }
  else if (e[0] === 'boom') { booms.push({ x: e[1], y: e[2], t: now }); if (Math.hypot(e[1] - me.x, e[2] - me.y) < 700) SND.boom(); }
}

// ================= end of match =================
let endShownAt = 0, endNext = 0;
function showEnd(m) {
  endShownAt = performance.now(); endNext = m.next || 12;
  const rows = m.r || [];
  const medals = ['🥇', '🥈', '🥉'];
  const w = rows[0];
  $('winner').innerHTML = w && w[3] > 0 ? `👑 الفايز: <b style="color:${esc(w[2])}">${esc(w[1])}</b> بـ ${w[3]} طخات` : 'ما حدا طخ حدا 😅';
  if (w && w[0] === myId && w[3] > 0) SND.win();
  $('results').innerHTML = '<tr><th>#</th><th>اللاعب</th><th>🎯</th><th>💀</th><th>🔥</th></tr>' + rows.map((r, i) =>
    `<tr class="${r[0] === myId ? 'me' : ''}"><td>${medals[i] || i + 1}</td><td style="color:${esc(r[2])}">${esc(r[1])}${r[6] ? ' 🤖' : ''}${r[0] === myId ? ' (أنت)' : ''}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('');
  fillGlobal(m.g);
  $('end').classList.remove('hidden');
}
function fillGlobal(g) {
  if (!g) { $('global').innerHTML = '<tr><td>⏳</td></tr>'; return; }
  $('global').innerHTML = '<tr><th>#</th><th>اللاعب</th><th>🎯 طخات</th><th>🏆 فوز</th><th>🎮</th></tr>' + g.slice(0, 10).map((p, i) =>
    `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.kills | 0}</td><td>${p.wins | 0}</td><td>${p.games | 0}</td></tr>`).join('');
}

// ================= input =================
const keys = {}; const mouse = { x: 0, y: 0, down: false }; let useMouse = false;
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'e') bomb(); });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
cv.addEventListener('mousemove', e => { useMouse = true; mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', () => { useMouse = true; mouse.down = true; });
addEventListener('mouseup', () => { mouse.down = false; });
const sticks = { L: null, R: null };
function bombBtn() { return { x: cw - 60, y: ch - 190, r: 30 }; }
cv.addEventListener('touchstart', e => {
  e.preventDefault(); useMouse = false;
  for (const t of e.changedTouches) {
    const b = bombBtn(), p = myP();
    if (p && p.bombs > 0 && (t.clientX - b.x) ** 2 + (t.clientY - b.y) ** 2 < (b.r + 12) ** 2) { bomb(); continue; }
    const side = t.clientX < cw / 2 ? 'L' : 'R';
    if (!sticks[side]) sticks[side] = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
  }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) for (const s of ['L', 'R']) {
    const k = sticks[s];
    if (k && k.id === t.identifier) { let dx = t.clientX - k.ox, dy = t.clientY - k.oy; const m = Math.hypot(dx, dy); if (m > 55) { dx = dx / m * 55; dy = dy / m * 55; } k.dx = dx; k.dy = dy; }
  }
}, { passive: false });
function tend(e) { for (const t of e.changedTouches) for (const s of ['L', 'R']) if (sticks[s] && sticks[s].id === t.identifier) sticks[s] = null; }
cv.addEventListener('touchend', tend); cv.addEventListener('touchcancel', tend);

const input = { mx: 0, my: 0, a: 0, f: false };
function readInput() {
  let mx = 0, my = 0, f = false;
  if (keys.w || keys.arrowup) my--; if (keys.s || keys.arrowdown) my++;
  if (keys.a || keys.arrowleft) mx--; if (keys.d || keys.arrowright) mx++;
  if (sticks.L) { mx = sticks.L.dx / 55; my = sticks.L.dy / 55; }
  const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
  if (useMouse) { me.a = Math.atan2(mouse.y - ch / 2, mouse.x - cw / 2); f = mouse.down; }
  if (sticks.R && Math.hypot(sticks.R.dx, sticks.R.dy) > 12) { me.a = Math.atan2(sticks.R.dy, sticks.R.dx); f = true; }
  else if (sticks.L && !sticks.R && m > 0.2) me.a = Math.atan2(my, mx);
  if (keys[' ']) f = true;
  input.mx = mx; input.my = my; input.a = me.a; input.f = f;
}
function sendInput() { send({ t: 'in', mx: +input.mx.toFixed(2), my: +input.my.toFixed(2), a: +input.a.toFixed(3), f: input.f }); }
function bomb() { const p = myP(); if (p && p.bombs > 0 && phase === 0) send({ t: 'bomb' }); }

// ================= buttons =================
function startGame(mode) {
  const name = ($('nm').value.trim() || 'لاعب').slice(0, 14);
  try { localStorage.setItem('shl_name', name); localStorage.setItem('shl_col', myColor); } catch (e) {}
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume && actx.resume(); } catch (e) {}
  const code = $('code').value.trim();
  if (mode === 'code' && !/^\d{4,6}$/.test(code)) { setNet('اكتب رقم الغرفة'); return; }
  setNet('بتصل...'); reconnectTries = 0;
  connect({ mode, code, name, color: myColor });
  try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
}
$('quick').onclick = () => startGame('quick');
$('create').onclick = () => startGame('create');
$('join').onclick = () => startGame('code');
$('leave').onclick = () => backToMenu('');
$('share').onclick = async () => {
  const link = location.origin + location.pathname + '#' + roomCode;
  try { await navigator.clipboard.writeText('تعال نلعب حرب الشلة 🔫 ' + link); toast('✅ نسخت الرابط، ابعتو لصحابك'); }
  catch (e) { toast('رقم الغرفة: ' + roomCode); }
};
function backToMenu(msg) {
  intentionalClose = true; playing = false; try { ws && ws.close(); } catch (e) {}
  clearInterval(sendTimer); clearInterval(pingTimer);
  $('hud').classList.add('hidden'); $('end').classList.add('hidden'); $('dead').classList.add('hidden'); banner('');
  $('menu').classList.remove('hidden'); setButtons(true); setNet(msg); loadMenuTop();
}

let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing) keepAwake(); });

// ================= loop =================
let last = performance.now(), lastErr = 0;
function loop(now) {
  requestAnimationFrame(loop);
  try { step(now); } catch (e) { if (now - lastErr > 3000) { lastErr = now; console.error(e); } }
}
requestAnimationFrame(loop);

function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing && world) update(now, dt);
  draw(now);
}

function update(now, dt) {
  readInput();
  const p = myP();
  const alive = p && !(p.flags & 1);
  // local prediction for my own player
  if (alive && phase === 0) {
    const sp = world.spd * ((p.flags & 4) ? 1.6 : 1);
    const nx = me.x + input.mx * sp * dt, ny = me.y + input.my * sp * dt;
    if (!hitWall(nx, me.y, world.pr)) me.x = Math.max(world.pr, Math.min(world.w - world.pr, nx));
    if (!hitWall(me.x, ny, world.pr)) me.y = Math.max(world.pr, Math.min(world.h - world.pr, ny));
    if (input.f && now - me.lastFire >= world.fire * 1000) {
      me.lastFire = now; SND.shoot();
      const angs = (p.flags & 8) ? [me.a - 0.16, me.a, me.a + 0.16] : [me.a];
      for (const a of angs) bullets.push({ x: me.x + Math.cos(a) * (world.pr + 4), y: me.y + Math.sin(a) * (world.pr + 4), vx: Math.cos(a) * world.bspd, vy: Math.sin(a) * world.bspd, life: world.blife, owner: myId });
    }
  }
  // dead screen
  if (p && (p.flags & 1) && phase === 0) { if (!me.deadShown) { me.deadShown = true; $('dead').classList.remove('hidden'); } $('dead').textContent = '💀 ' + (me.killer || 'حدا') + ' طخك! برجع بعد لحظات'; }
  else if (me.deadShown) { me.deadShown = false; $('dead').classList.add('hidden'); }
  // others: smooth toward server position
  for (const [id, q] of players) {
    if (id === myId) continue;
    const f = Math.min(1, dt * 12);
    q.x += (q.tx - q.x) * f; q.y += (q.ty - q.y) * f;
    if (Math.abs(q.tx - q.x) > 300 || Math.abs(q.ty - q.y) > 300) { q.x = q.tx; q.y = q.ty; }
  }
  // bullets (visual)
  const keep = [];
  for (const b of bullets) {
    b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > world.w || b.y > world.h || hitWall(b.x, b.y, 3)) continue;
    let hit = false;
    for (const [id, q] of players) {
      if (id === b.owner || (q.flags & 1)) continue;
      const qx = id === myId ? me.x : q.x, qy = id === myId ? me.y : q.y;
      if ((qx - b.x) ** 2 + (qy - b.y) ** 2 < (world.pr + 4) ** 2) { hit = true; break; }
    }
    if (!hit) keep.push(b);
  }
  bullets = keep.length > 600 ? keep.slice(-600) : keep;
  // end countdown
  if (!$('end').classList.contains('hidden')) $('nextIn').textContent = 'الجيم الجاي بعد ' + Math.max(0, Math.ceil(endNext - (now - endShownAt) / 1000)) + ' ثواني';
  if (ws && ws.readyState === 1 && now - timeAt > 4000 && timeAt) banner('⏳ الاتصال بطيء...'); else if ($('bannerT').textContent === '⏳ الاتصال بطيء...') banner('');
}

// ================= draw =================
function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0f1a'; ctx.fillRect(0, 0, cw, ch);
  if (!world || !playing) { hud(now); return; }
  const camx = me.x, camy = me.y;
  ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.scale(scale, scale); ctx.translate(-camx, -camy);
  const vx0 = camx - cw / 2 / scale - 80, vx1 = camx + cw / 2 / scale + 80, vy0 = camy - ch / 2 / scale - 80, vy1 = camy + ch / 2 / scale + 80;
  ctx.fillStyle = '#151a2e'; ctx.fillRect(0, 0, world.w, world.h);
  ctx.strokeStyle = '#1f2540'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i <= Math.max(world.w, world.h); i += 80) {
    if (i > vx0 && i < vx1 && i <= world.w) { ctx.moveTo(i, Math.max(0, vy0)); ctx.lineTo(i, Math.min(world.h, vy1)); }
    if (i > vy0 && i < vy1 && i <= world.h) { ctx.moveTo(Math.max(0, vx0), i); ctx.lineTo(Math.min(world.w, vx1), i); }
  }
  ctx.stroke();
  ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 4; ctx.strokeRect(0, 0, world.w, world.h);
  ctx.fillStyle = '#3a4166'; for (const w of world.walls) ctx.fillRect(w[0], w[1], w[2], w[3]);
  ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const it of items) { const bob = Math.sin(now / 250 + it[0] % 7) * 4; ctx.fillStyle = '#ffffff18'; ctx.beginPath(); ctx.arc(it[2], it[3], 20, 0, 7); ctx.fill(); ctx.fillText(ITEMS[it[1]] || '?', it[2], it[3] + bob); }
  ctx.textBaseline = 'alphabetic';
  booms = booms.filter(b => now - b.t < 500);
  for (const b of booms) { const p = (now - b.t) / 500; ctx.strokeStyle = `rgba(255,180,60,${1 - p})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(b.x, b.y, 30 + p * 140, 0, 7); ctx.stroke(); }
  for (const b of bullets) { ctx.fillStyle = b.owner === myId ? '#fff' : colorOf(b.owner); ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, 7); ctx.fill(); }
  for (const [id, q] of players) {
    if (id === myId || (q.flags & 1)) continue;
    if (q.x < vx0 || q.x > vx1 || q.y < vy0 || q.y > vy1) continue;
    const r = roster.get(id);
    drawPlayer(q.x, q.y, q.a, r ? r.color : '#aaa', (r ? r.name : '') + (r && r.bot ? ' 🤖' : ''), q.hp, false, q.flags, now);
  }
  const p = myP();
  if (p && !(p.flags & 1)) drawPlayer(me.x, me.y, me.a, myColor, nameOf(myId), p.hp, true, p.flags, now);
  ctx.restore();
  drawMinimap();
  for (const s of ['L', 'R']) { const k = sticks[s]; if (!k) continue; ctx.globalAlpha = 0.3; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(k.ox, k.oy, 55, 0, 7); ctx.fill(); ctx.globalAlpha = 0.8; ctx.fillStyle = s === 'R' ? '#ff4d6d' : '#4dabff'; ctx.beginPath(); ctx.arc(k.ox + k.dx, k.oy + k.dy, 24, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  if (p && p.bombs > 0) { const b = bombBtn(); ctx.fillStyle = '#ff922bcc'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💣', b.x, b.y); ctx.font = '700 14px Cairo'; ctx.fillStyle = '#fff'; ctx.fillText('×' + p.bombs, b.x, b.y + b.r + 12); ctx.textBaseline = 'alphabetic'; }
  hud(now);
}
function drawPlayer(x, y, a, c, n, hp, isMe, flags, now) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = '#ddd'; ctx.fillRect(world.pr - 4, -5, 18, 10); ctx.restore();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, world.pr, 0, 7); ctx.fill();
  if (isMe) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
  if (flags & 2) { ctx.strokeStyle = `rgba(120,200,255,${0.5 + 0.3 * Math.sin(now / 120)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, world.pr + 8, 0, 7); ctx.stroke(); }
  if (flags & 4) { ctx.fillStyle = '#ffd43b88'; ctx.beginPath(); ctx.arc(x - Math.cos(a) * 24, y - Math.sin(a) * 24, 5, 0, 7); ctx.fill(); }
  const pr = world.pr, mh = world.maxhp;
  ctx.fillStyle = '#000a'; ctx.fillRect(x - 22, y - pr - 14, 44, 6);
  ctx.fillStyle = hp > 2 ? '#51cf66' : '#ff4d6d'; ctx.fillRect(x - 22, y - pr - 14, 44 * Math.max(0, Math.min(mh, hp)) / mh, 6);
  ctx.fillStyle = '#fff'; ctx.font = '700 14px Cairo'; ctx.textAlign = 'center'; ctx.fillText(n + (isMe ? ' (أنت)' : ''), x, y - pr - 20);
}
function drawMinimap() {
  const S = 86, x0 = cw / 2 - S / 2, y0 = 8, k = S / world.w;
  ctx.fillStyle = '#000a'; ctx.fillRect(x0, y0, S, S); ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, S, S);
  ctx.fillStyle = '#ffffff30'; for (const w of world.walls) ctx.fillRect(x0 + w[0] * k, y0 + w[1] * k, Math.max(1, w[2] * k), Math.max(1, w[3] * k));
  ctx.fillStyle = '#ffd43b'; for (const it of items) ctx.fillRect(x0 + it[2] * k - 1, y0 + it[3] * k - 1, 3, 3);
  for (const [id, q] of players) { if (id === myId || (q.flags & 1)) continue; ctx.fillStyle = colorOf(id); ctx.beginPath(); ctx.arc(x0 + q.x * k, y0 + q.y * k, 2.5, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + me.x * k, y0 + me.y * k, 3.5, 0, 7); ctx.fill();
}
let lastHud = 0;
function hud(now) {
  if (now - lastHud < 250) return; lastHud = now;
  while (feed.length && now - feed[0].at > 5000) feed.shift();
  $('feed').innerHTML = feed.map(x => '<div>' + esc(x.t) + '</div>').join('');
  if (!playing) return;
  const rows = [...players.entries()].map(([id, q]) => ({ id, k: q.kills | 0, d: q.deaths | 0 })).sort((a, b) => b.k - a.k || a.d - b.d);
  $('board').innerHTML = '<b>🏆 الترتيب</b><br>' + rows.filter((r, i) => i < 6 || r.id === myId).map(r =>
    `<span style="color:${esc(colorOf(r.id))}">●</span> ${esc(nameOf(r.id))}${r.id === myId ? ' (أنت)' : ''}: <b>${r.k}</b>🎯 ${r.d}💀`).join('<br>');
  const p = myP();
  const left = Math.max(0, timeLeft - (now - timeAt)), mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
  const humans = [...roster.values()].filter(r => !r.bot).length;
  const pw = [];
  if (p) { if (p.flags & 4) pw.push('⚡'); if (p.flags & 8) pw.push('🔱'); if (p.flags & 2) pw.push('🛡️'); }
  $('me').innerHTML = `${roomPublic ? '🌍 عامة' : '🔑 <b>' + roomCode + '</b>'} · 👥 ${humans} · 📶 ${ping}ms<br>⏱️ ${phase === 0 ? mm + ':' + String(ss).padStart(2, '0') : 'استراحة'}<br>${p ? '❤️'.repeat(Math.max(0, p.hp)) : ''} ${pw.join(' ')}`;
}
})();
