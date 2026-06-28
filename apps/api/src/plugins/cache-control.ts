// ETag validators + a fail-safe Cache-Control policy (13c). Posture: "validators are useful, freshness
// remains authoritative." Every response is either `no-store`, or `no-cache` — cached but ALWAYS
// revalidated via If-None-Match → 304. No response is served without the server confirming it is
// current, so cached explorer data can never go stale. Deliberately NO `max-age` in this phase, even
// for detail endpoints: their bodies carry rebuildable semantic-projection fields (proposer
// attribution, decoded messages) that a re-projection can change, so revalidation — not a TTL — is the
// only safe optimization. ETag is header-only; response envelopes are unchanged.

import etag from '@fastify/etag';
import type { FastifyInstance } from 'fastify';

/** Route opt-in. A route sets `config: { cacheControl: 'revalidate' }` to become cacheable-with-
 *  revalidation; anything without it defaults to `no-store` (fail-safe — forgetting to opt in is safe). */
export type CachePolicy = 'revalidate';

interface CacheRouteConfig {
  cacheControl?: CachePolicy;
}

export async function registerCacheControl(app: FastifyInstance): Promise<void> {
  // Adds an ETag header and short-circuits matching If-None-Match requests to 304. Body unchanged.
  await app.register(etag);

  app.addHook('onSend', async (request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) {
      const policy = (request.routeOptions?.config as CacheRouteConfig | undefined)?.cacheControl;
      reply.header('cache-control', policy === 'revalidate' ? 'no-cache' : 'no-store');
    }
    return payload;
  });
}
