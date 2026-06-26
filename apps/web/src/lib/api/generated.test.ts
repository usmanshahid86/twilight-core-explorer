import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The committed generated client must exist and cover the API surface. The authoritative drift gate
// is `npm run openapi:check` (regenerates + diffs); this is a fast committed-artifact sanity check.
const SCHEMA = join(process.cwd(), 'src', 'lib', 'api', 'generated', 'schema.d.ts');

describe('generated OpenAPI client', () => {
  it('is committed', () => {
    expect(existsSync(SCHEMA)).toBe(true);
  });

  it('covers key Phase 9 paths', () => {
    const src = readFileSync(SCHEMA, 'utf8');
    expect(src).toContain('"/api/v1/status"');
    expect(src).toContain('"/api/v1/search"');
    expect(src).toContain('"/api/v1/supply"');
    expect(src).toContain('"/api/v1/network/liveness-risk"');
  });
});
