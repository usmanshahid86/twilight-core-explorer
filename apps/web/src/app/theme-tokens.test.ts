import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression guard (Copilot PR #17): page/background colors must flow through the CSS-variable theme
// tokens (e.g. bg-background / bg-page), never a hardcoded hex like bg-[#050505] that would pin the
// page to the auction palette and stop the `legacy` theme from switching.
const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

describe('theme tokens are not bypassed', () => {
  it('no component hardcodes an arbitrary background hex (theme must remain switchable)', () => {
    const offenders = files.filter((f) => /bg-\[#/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
