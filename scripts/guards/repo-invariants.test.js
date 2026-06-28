// Phase 13c-1 — automated repo invariant guards. These replace the MANUAL static greps that the
// CLAUDE.md validation ritual previously required a human to run + eyeball, making them hard-fail in
// the standard `npm test` path: an unsupported-route implementation or a stale `gated_by_phase_7_2`
// active literal now fails CI instead of silently passing review. Scans hand-written runtime source
// only (no docs / generated / dist / tests), and ignores comment lines so a historical reference in a
// comment (e.g. the read-only-posture correction note) does not trip the guard — the invariant is
// about runtime CODE, not documentation. (ESM: the repo root is "type": "module".)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const SRC_ROOTS = [
  'apps/api/src',
  'apps/indexer/src',
  'apps/web/src',
  'packages/chain-client/src',
  'packages/config/src',
  'packages/db/src',
  'packages/decoder/src',
  'packages/proto/src',
];
const EXTRA_FILES = ['prisma/schema.prisma'];
const SCAN_EXT = /\.(ts|tsx|prisma)$/;
const SKIP = /(^|\/)(generated|dist|node_modules)\/|\.test\.(ts|tsx)$|\.d\.ts$/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = [
  ...SRC_ROOTS.flatMap((r) => walk(join(ROOT, r))),
  ...EXTRA_FILES.map((f) => join(ROOT, f)).filter(existsSync),
].filter((f) => SCAN_EXT.test(f) && !SKIP.test(f));

const sources = files.map((f) => ({ rel: relative(ROOT, f), lines: readFileSync(f, 'utf8').split('\n') }));

// A "comment line" if (trimmed) it starts a // or block comment — a coarse but URL-safe check (full
// regex comment-stripping mis-handles `https://` inside string literals and would weaken the guard).
// NOTE: a banned-route mention in a *trailing* comment (`code(); // /cosmos/x`) is still flagged — by
// design, err strict — so historical/banned-route references must live on FULL-LINE comments.
const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

// Does one line contain a runtime-code violation of `pattern`? Skips full comment lines, and strips a
// LEADING inline block comment (`/* x */ code`) so a forbidden token can't hide behind one (review N1).
// Exported so the non-tautology is self-tested below (a planted violation must be caught).
export function lineViolates(line, pattern) {
  // Strip ALL leading inline block comments (`/*a*/ /*b*/ code`) in a loop FIRST so none can shield a
  // violation (review N1 + PR #39 — a single strip let a second `/*..*/` re-classify the line as a
  // comment), THEN decide if what remains is a full-line // or block comment (docs, not runtime code).
  let code = line;
  for (let prev = null; prev !== code; ) {
    prev = code;
    code = code.replace(/^\s*\/\*.*?\*\//, '');
  }
  if (isComment(code)) return false;
  // Test non-statefully: a `g`/`y` RegExp makes `.test()` advance `lastIndex`, yielding false negatives
  // on repeated calls (PR #39). Use a flag-stripped copy so the test is pure regardless of the caller.
  const safe =
    pattern.global || pattern.sticky
      ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
      : pattern;
  return safe.test(code);
}

// Offending `file:line` occurrences: the pattern on a non-comment (runtime-code) line.
function offenders(pattern) {
  const hits = [];
  for (const { rel, lines } of sources) {
    lines.forEach((line, i) => {
      if (lineViolates(line, pattern)) hits.push(`${rel}:${i + 1}`);
    });
  }
  return hits;
}

describe('repo invariants (automated static guards — replace the manual CLAUDE.md greps)', () => {
  it('scans a meaningful number of source files', () => {
    assert.ok(files.length > 100, `expected to scan >100 source files, scanned ${files.length}`);
  });

  it('no stale active-slots route implementation', () => {
    assert.deepEqual(offenders(/\/twilight\/coreslot\/v1\/slots\/active/), []);
  });

  it('no unsupported standard-module route implementations (staking/gov/mint/distribution)', () => {
    assert.deepEqual(offenders(/\/cosmos\/(staking|gov|mint|distribution)/), []);
  });

  it('no stale gated_by_phase_7_2 in runtime code (read-only posture flipped to read_only_no_claim_action)', () => {
    assert.deepEqual(offenders(/gated_by_phase_7_2/), []);
  });
});

// The guard must have teeth: prove it CATCHES a real violation and only ignores genuine comments,
// without over-stripping URLs. Keeps the "is this a tautology?" question answered in-repo (regression-proof).
describe('repo invariant guard — line classification (non-tautology proof)', () => {
  const COSMOS = /\/cosmos\/(staking|gov|mint|distribution)/;
  // Assemble the forbidden module path at runtime so the literal `/cosmos/<module>/` never appears in
  // THIS file — other repo-wide guards (e.g. chain-client's route-contract test) scan every file for it.
  const cosmos = (m) => `/cosmos/${m}`;
  it('flags a forbidden route in real runtime code', () => {
    assert.equal(lineViolates(`    return apiGet('${cosmos('staking')}');`, COSMOS), true);
  });
  it('flags a forbidden route even behind a leading inline block comment (N1)', () => {
    assert.equal(lineViolates(`/* tmp */ apiGet('${cosmos('distribution')}')`, COSMOS), true);
  });
  it('flags a forbidden route behind MULTIPLE leading block comments (PR #39)', () => {
    assert.equal(lineViolates(`/*a*/ /*b*/ apiGet('${cosmos('staking')}')`, COSMOS), true);
  });
  it('is non-stateful with a global/sticky RegExp — same input twice stays true (PR #39)', () => {
    const g = /\/cosmos\/(staking|gov|mint|distribution)/g;
    const line = `  return apiGet('${cosmos('mint')}');`;
    assert.equal(lineViolates(line, g), true);
    assert.equal(lineViolates(line, g), true); // a stateful .test() would return false here
  });
  it('does NOT over-strip a URL string literal (https:// is not treated as a comment)', () => {
    assert.equal(lineViolates(`const u = 'https://node${cosmos('gov')}';`, COSMOS), true);
  });
  it('ignores a full-line comment (historical references are allowed)', () => {
    assert.equal(lineViolates(`  // was gated_by_phase_7_2, now read_only`, /gated_by_phase_7_2/), false);
    assert.equal(lineViolates(`   * see ${cosmos('staking')} notes`, COSMOS), false);
  });
});
