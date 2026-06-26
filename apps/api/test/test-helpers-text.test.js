// Guard: test helper files must stay plain text (no NUL bytes), so Git treats them as text and PR
// review shows their diffs. A literal NUL separator in mock-prisma.js previously made Git see it as
// binary.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const NUL = String.fromCharCode(0);

describe('test helpers are plain text', () => {
  it('no test .js file contains NUL bytes', () => {
    for (const name of readdirSync(TEST_DIR)) {
      if (!name.endsWith('.js')) continue;
      const text = readFileSync(join(TEST_DIR, name), 'utf8');
      assert.ok(!text.includes(NUL), `${name} contains a NUL byte`);
    }
  });
});
