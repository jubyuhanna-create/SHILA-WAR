// Shared game constants and helpers (the server sends WORLD to clients on join)
const W = 2000, H = 2000;
const WALLS = [
  [1500, 500, 200, 40], [300, 1500, 200, 40], [1500, 1500, 40, 200], [1700, 1000, 40, 200],
  [1000, 1700, 200, 40], [1300, 1250, 120, 120], [1650, 300, 40, 120], [150, 1200, 120, 40],
  [300, 300, 180, 40], [920, 300, 180, 40], [300, 1060, 180, 40], [920, 1060, 180, 40],
  [640, 640, 120, 120], [200, 620, 40, 160], [1160, 620, 40, 160], [620, 180, 160, 40],
  [620, 1180, 160, 40], [450, 450, 40, 140], [910, 810, 40, 140],
];

const C = {
  PR: 18,            // player radius
  SPD: 230,          // px / s
  BSPD: 720,         // bullet px / s
  BLIFE: 1.3,        // bullet life seconds
  FIRE: 0.22,        // seconds between shots
  BOT_FIRE: 0.5,
  MAXHP: 5,
  RESPAWN: 2.5,
  SPAWN_SHIELD: 2,
  MATCH: +process.env.MATCH_SECONDS || 180, // match length seconds
  BREAK: 12,         // seconds between matches
  MAXP: 20,          // max humans per room
  MIN_FILL: 4,       // bots fill rooms up to this many players
  MAX_ITEMS: 8,
};

const ITEM_TYPES = ['hp', 'spd', 'tri', 'shd', 'bmb'];

function hitWall(x, y, r) {
  for (const w of WALLS) {
    const cx = Math.max(w[0], Math.min(x, w[0] + w[2]));
    const cy = Math.max(w[1], Math.min(y, w[1] + w[3]));
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

function freeSpot(r) {
  for (let i = 0; i < 80; i++) {
    const x = 80 + Math.random() * (W - 160), y = 80 + Math.random() * (H - 160);
    if (!hitWall(x, y, r + 10)) return [x, y];
  }
  return [100, 100];
}

module.exports = { W, H, WALLS, C, ITEM_TYPES, hitWall, freeSpot };
