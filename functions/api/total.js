/**
 * The single number shown in the page footer.
 *
 * Deliberately not /api/stats, which reads 180 keys (3 events x 4 shards x 15
 * buckets) and is no-store. Putting that on every page load would exhaust the
 * free KV read tier at roughly 555 visits a day and then break the counter in
 * public, which is the worst possible failure for a number meant to signal use.
 *
 * This reads 4 keys and is cached at the edge, so cost stays flat no matter how
 * much traffic arrives.
 *
 * Counts `upload`: someone brought a real image. Excludes demo button presses,
 * and does not require finishing the download. Note the page must never render
 * the word "uploaded" — nothing is uploaded, and the copy says so repeatedly.
 */
const SHARDS = 4;
const EDGE_TTL = 60;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });

  const hit = await cache.match(key);
  if (hit) return hit;

  let n = null;
  if (env.COUNTERS) {
    try {
      const parts = await Promise.all(
        Array.from({ length: SHARDS }, (_, s) => env.COUNTERS.get(`t:upload:${s}`))
      );
      n = parts.reduce((sum, v) => sum + (parseInt(v || '0', 10) || 0), 0);
    } catch {
      n = null;   /* the page hides the counter rather than showing something wrong */
    }
  }

  const res = new Response(JSON.stringify({ n }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${EDGE_TTL}`,
    },
  });
  if (n !== null) waitUntil(cache.put(key, res.clone()));
  return res;
}
