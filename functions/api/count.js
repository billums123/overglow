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

/* Only count requests that a browser actually made from this page.

   Sec-Fetch-Site is set by the browser and cannot be overridden from page
   JavaScript, and Origin is sent on any cross-site POST. Requiring one of them
   to say "same origin" rejects a bare `curl .../api/count` outright, which is
   what casual counter-pumping looks like.

   This raises the bar rather than being a wall: both headers can be forged with
   curl -H. A real ceiling needs a WAF rate-limiting rule on this path, which is
   zone-level configuration and cannot be set from inside the Function. Nothing
   here is stored, so it costs no privacy to apply. */
function sameOrigin(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';

  const origin = request.headers.get('origin');
  if (!origin) return false;              /* neither header: not a browser on this page */
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  // Always 204 — a counter must never surface errors to the page.
  const ok = new Response(null, { status: 204 });
  if (!env.COUNTERS) return ok;
  if (!sameOrigin(request)) return ok;

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
