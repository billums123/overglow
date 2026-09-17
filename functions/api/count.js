/**
 * Anonymous event counter.
 *
 * Stores nothing but integers. No IP, no user agent, no cookie, no identifier,
 * no per-event row — and never any image data, which does not leave the browser
 * at all. The entire request body is one allowlisted word.
 *
 * Counts are sharded because KV permits one write per second per key; without
 * sharding a burst of traffic would silently drop increments.
 */
const EVENTS = new Set(['upload', 'demo', 'export']);
const SHARDS = 4;
const DAY_TTL = 60 * 60 * 24 * 400; // day buckets self-expire after ~13 months

export async function onRequestPost({ request, env }) {
  // Always 204 — a counter must never surface errors to the page.
  const ok = new Response(null, { status: 204 });
  if (!env.COUNTERS) return ok;

  let event;
  try {
    ({ event } = await request.json());
  } catch {
    return ok;
  }
  if (!EVENTS.has(event)) return ok;

  const day = new Date().toISOString().slice(0, 10);
  const shard = (Math.random() * SHARDS) | 0;

  try {
    await Promise.all([
      bump(env, `t:${event}:${shard}`),
      bump(env, `d:${day}:${event}:${shard}`, DAY_TTL),
    ]);
  } catch {
    // Losing a count is fine; failing the request is not.
  }
  return ok;
}

async function bump(env, key, ttl) {
  const current = parseInt((await env.COUNTERS.get(key)) || '0', 10) || 0;
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await env.COUNTERS.put(key, String(current + 1), opts);
}
