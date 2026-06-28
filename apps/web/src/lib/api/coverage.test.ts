import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Durable guard (Phase 13a / J-001): every public OpenAPI path must have a REAL runtime consumer in the
// web app — its literal (including any {param} template) passed as the FIRST ARGUMENT to a request
// function (`apiGet` / `apiGetPath` / the injected `get` in operator-resolver), in any quote style — OR
// be explicitly allowlisted as internal/diagnostic. Matching the call (not a bare substring) means a
// type-only `JsonOf<'/path'>` reference, a `path: '/path'` type annotation, or a comment does NOT count
// as a consumer, and the check is robust to quote-style / formatting changes (Copilot review, PR #38).
// This fails CI the next time an endpoint ships without a UI consumer (the gap that left
// /api/v1/decode-failures unsurfaced). Spec path mirrors scripts/check-openapi-drift.mjs (cwd = apps/web).
const SPEC = '../../docs/reference/openapi.json';
const CONSUMERS = ['src/lib/api/queries.ts', 'src/lib/operator-resolver.ts'];

// Paths intentionally NOT surfaced in the UI (ops/health probes only).
const INTERNAL_PATHS = new Set(['/health/live', '/health/ready']);

const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as { paths: Record<string, unknown> };
const source = CONSUMERS.map((p) => readFileSync(p, 'utf8')).join('\n');
const paths = Object.keys(spec.paths);

// True iff `path` is passed as the first arg to a request function (apiGet/apiGetPath/get) in `src`,
// in any quote style. The path is regex-escaped so `{param}` templates and other specials match
// literally. The leading `\b` keeps the `get` alternative from matching inside words like `widget(`.
export function isConsumed(path: string, src: string = source): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:apiGetPath|apiGet|get)\\s*\\(\\s*['"\`]${escaped}['"\`]`).test(src);
}

describe('OpenAPI path coverage (every path has a runtime consumer or is allowlisted)', () => {
  it('the spec has the expected breadth', () => {
    expect(paths.length).toBeGreaterThan(25);
  });

  for (const path of paths) {
    it(`"${path}" has a runtime consumer or is allowlisted as internal`, () => {
      expect(isConsumed(path) || INTERNAL_PATHS.has(path)).toBe(true);
    });
  }
});

describe('coverage guard correctness (real call vs. type-only reference)', () => {
  it('counts a real apiGet / apiGetPath / injected get call, in any quote style', () => {
    expect(isConsumed('/x', `apiGet('/x', {})`)).toBe(true);
    expect(isConsumed('/x', `apiGetPath("/x", { a: 1 })`)).toBe(true);
    expect(isConsumed('/x', 'await get(`/x`, query)')).toBe(true);
    // formatting / newlines between the paren and the path argument
    expect(isConsumed('/x', `apiGet(\n  '/x',\n  {},\n)`)).toBe(true);
  });

  it('does NOT count a type-only JsonOf<> reference, a type annotation, or a comment', () => {
    expect(isConsumed('/x', `export type R = JsonOf<'/x'>;`)).toBe(false);
    expect(isConsumed('/x', `type Getter = (path: '/x', q: unknown) => void;`)).toBe(false);
    expect(isConsumed('/x', `// the '/x' endpoint is internal`)).toBe(false);
  });

  it('matches a {param} template literally and does not false-pass on its type reference', () => {
    expect(isConsumed('/b/{h}', `apiGetPath('/b/{h}', { h })`)).toBe(true);
    expect(isConsumed('/b/{h}', `type R = JsonOf<'/b/{h}'>;`)).toBe(false);
  });

  it('does not let the `get` alternative match inside an unrelated identifier', () => {
    expect(isConsumed('/x', `widget('/x')`)).toBe(false);
    expect(isConsumed('/x', `target('/x')`)).toBe(false);
  });
});
