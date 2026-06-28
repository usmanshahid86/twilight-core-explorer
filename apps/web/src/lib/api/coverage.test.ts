import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Durable guard (Phase 13a / J-001): every public OpenAPI path must be consumed by the web app
// (its exact literal — including any {param} template — appears in a typed-client consumer) OR be
// explicitly allowlisted as internal/diagnostic. This fails CI the next time an endpoint ships
// without a UI consumer (the gap that left /api/v1/decode-failures unsurfaced). Spec path mirrors
// scripts/check-openapi-drift.mjs (cwd = apps/web).
const SPEC = '../../docs/reference/openapi.json';
const CONSUMERS = ['src/lib/api/queries.ts', 'src/lib/operator-resolver.ts'];

// Paths intentionally NOT surfaced in the UI (ops/health probes only).
const INTERNAL_PATHS = new Set(['/health/live', '/health/ready']);

const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as { paths: Record<string, unknown> };
const source = CONSUMERS.map((p) => readFileSync(p, 'utf8')).join('\n');
const paths = Object.keys(spec.paths);

describe('OpenAPI path coverage (every path consumed or allowlisted)', () => {
  it('the spec has the expected breadth', () => {
    expect(paths.length).toBeGreaterThan(25);
  });

  for (const path of paths) {
    it(`"${path}" is consumed by the web app or allowlisted as internal`, () => {
      const consumed = source.includes(`'${path}'`);
      expect(consumed || INTERNAL_PATHS.has(path)).toBe(true);
    });
  }
});
