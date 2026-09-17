/**
 * Aggregate counts. Public, because there is nothing here but totals.
 *
 * Numbers are approximate: KV increments are read-modify-write, so simultaneous
 * events can overwrite each other. Treat these as a gauge, not an audit trail.
 */
const EVENTS = ['upload', 'demo', 'export'];
const SHARDS = 4;
const DAYS = 14;

export async function onRequestGet({ env }) {
  if (!env.COUNTERS) {
    return json({ error: 'counter storage not bound' }, 503);
  }

  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const keys = [];
  for (const e of EVENTS) {
    for (let s = 0; s < SHARDS; s++) {
      keys.push({ kind: 'total', event: e, key: `t:${e}:${s}` });
      for (const day of days) {
        keys.push({ kind: 'day', event: e, day, key: `d:${day}:${e}:${s}` });
      }
    }
  }

  const values = await Promise.all(keys.map((k) => env.COUNTERS.get(k.key)));

  const total = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  const byDay = {};
  for (const day of days) {
    byDay[day] = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  }

  keys.forEach((k, i) => {
    const n = parseInt(values[i] || '0', 10) || 0;
    if (!n) return;
    if (k.kind === 'total') total[k.event] += n;
    else byDay[k.day][k.event] += n;
  });

  return json({ total, byDay, note: 'approximate; see stats.js' });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
