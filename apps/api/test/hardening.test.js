// Phase 13c transport hardening: security headers, Cache-Control policy, ETag revalidation, build/
// version surface, and rate limiting. All assert TRANSPORT behavior — response envelopes are unchanged
// (verified by the other suites still passing).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig, block } from './mock-prisma.js';

const build = (data = {}) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('security headers (helmet)', () => {
  it('sets nosniff + cross-origin resource policy on responses', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal(res.headers['x-frame-options'], 'DENY'); // frameguard deny — an API is never framed
    await app.close();
  });
});

describe('Cache-Control policy (fail-safe: no-store unless a route opts into revalidate)', () => {
  it('uses no-store on a non-opted-in endpoint (/status is sampled/live)', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    assert.equal(res.headers['cache-control'], 'no-store');
    await app.close();
  });

  it('uses no-cache (revalidate) on an opted-in cacheable endpoint (/blocks)', async () => {
    const app = await build({ blocks: [block(1)] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/blocks' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-cache');
    await app.close();
  });
});

describe('ETag revalidation (validators useful, freshness authoritative)', () => {
  it('returns an ETag and 304s a matching If-None-Match — never a max-age stale window', async () => {
    const app = await build({ blocks: [block(1)] });
    const first = await app.inject({ method: 'GET', url: '/api/v1/blocks' });
    assert.equal(first.statusCode, 200);
    const etag = first.headers.etag;
    assert.ok(etag, 'expected an ETag header');

    const revalidated = await app.inject({
      method: 'GET',
      url: '/api/v1/blocks',
      headers: { 'if-none-match': etag },
    });
    assert.equal(revalidated.statusCode, 304); // unchanged → revalidation short-circuits, no stale serve
    await app.close();
  });
});

describe('version / build info on /status (build+env only, no chain access)', () => {
  it('exposes data.build with version/gitSha/builtAt/environment', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    const info = res.json().data.build;
    assert.equal(typeof info.version, 'string');
    assert.equal(info.gitSha, null); // unset in tests
    assert.equal(info.builtAt, null);
    assert.equal(info.environment, 'development'); // testConfig.env
    await app.close();
  });
});

describe('rate limiting (disable-able; 429 uses the { error } envelope)', () => {
  it('does NOT throttle when disabled (the default test posture)', async () => {
    const app = await build();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
      assert.equal(res.statusCode, 200);
    }
    await app.close();
  });

  it('returns a 429 in the { error } envelope once the per-IP limit is exceeded', async () => {
    const config = { ...testConfig, rateLimit: { enabled: true, max: 2, timeWindowMs: 60_000 } };
    const app = await buildServer({ config, prisma: new MockPrisma({}) });
    await app.inject({ method: 'GET', url: '/api/v1/status' }); // 1
    await app.inject({ method: 'GET', url: '/api/v1/status' }); // 2
    const limited = await app.inject({ method: 'GET', url: '/api/v1/status' }); // 3 → over
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'rate_limited');
    await app.close();
  });
});
