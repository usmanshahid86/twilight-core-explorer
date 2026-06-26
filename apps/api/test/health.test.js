import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig } from './mock-prisma.js';

const build = (data) => buildServer({ config: testConfig, prisma: new MockPrisma(data) });

describe('health', () => {
  it('GET /health/live returns 200 without touching the DB', async () => {
    const app = await build({ dbDown: true }); // DB down, but liveness must not care
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { data: { status: 'live' } });
    await app.close();
  });

  it('GET /health/ready returns 200 when DB + migrations are healthy', async () => {
    const app = await build({});
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.status, 'ready');
    assert.deepEqual(res.json().data.checks, { database: 'ok', migrations: 'ok' });
    await app.close();
  });

  it('GET /health/ready returns 503 not_ready when the DB is down', async () => {
    const app = await build({ dbDown: true });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'not_ready');
    assert.equal(res.json().error.details.database, 'error');
    await app.close();
  });

  it('GET /health/ready returns 503 when a migration is failed', async () => {
    const app = await build({ failedMigrations: 1 });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.details.migrations, 'failed');
    await app.close();
  });
});
