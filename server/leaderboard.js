// All-time leaderboard.
// Without Supabase it lives in memory (resets when the server restarts or sleeps).
// With SUPABASE_URL + SUPABASE_SERVICE_KEY set, it is saved permanently.
const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const useDb = !!(URL && KEY);

const mem = new Map(); // name -> {name, kills, wins, games}
let cache = null, cacheAt = 0;

function headers() {
  // new Supabase secret keys (sb_secret_...) go only in the apikey header; legacy service_role JWTs also as Bearer
  const h = { apikey: KEY, 'Content-Type': 'application/json' };
  if (!KEY.startsWith('sb_')) h.Authorization = 'Bearer ' + KEY;
  return h;
}

async function record(list) {
  // list: [{name, kills, win}]
  for (const r of list) {
    const m = mem.get(r.name) || { name: r.name, kills: 0, wins: 0, games: 0 };
    m.kills += r.kills; m.wins += r.win ? 1 : 0; m.games += 1;
    mem.set(r.name, m);
  }
  if (useDb) {
    await Promise.all(list.map(r =>
      fetch(URL + '/rest/v1/rpc/add_score', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ p_name: r.name, p_kills: r.kills, p_win: !!r.win }),
      }).catch(e => console.error('supabase record failed', e.message))
    ));
  }
  cache = null;
}

async function top(n = 10) {
  if (cache && Date.now() - cacheAt < 15000) return cache;
  let rows = null;
  if (useDb) {
    try {
      const r = await fetch(URL + '/rest/v1/scores?select=name,kills,wins,games&order=kills.desc&limit=' + n, { headers: headers() });
      if (r.ok) rows = await r.json();
    } catch (e) { console.error('supabase top failed', e.message); }
  }
  if (!rows) rows = [...mem.values()].sort((a, b) => b.kills - a.kills || b.wins - a.wins).slice(0, n);
  cache = rows; cacheAt = Date.now();
  return rows;
}

module.exports = { record, top, useDb };
