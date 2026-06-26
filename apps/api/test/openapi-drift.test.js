import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { buildServer } from '../dist/server.js';
import { MockPrisma, testConfig } from './mock-prisma.js';

const SPEC_PATH = fileURLToPath(new URL('../../../docs/reference/openapi.json', import.meta.url));

describe('openapi', () => {
  it('committed docs/reference/openapi.json matches the generated spec', async () => {
    const app = await buildServer({ config: testConfig, prisma: new MockPrisma({}) });
    await app.ready();
    const generated = `${JSON.stringify(app.swagger(), null, 2)}\n`;
    await app.close();

    const committed = readFileSync(SPEC_PATH, 'utf8');
    assert.equal(
      generated,
      committed,
      'OpenAPI drift: run `npm --prefix apps/api run openapi:generate`',
    );
  });
});
