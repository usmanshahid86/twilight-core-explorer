// Regenerate the typed OpenAPI client to a temp file and diff it against the committed copy.
// Mirrors apps/api's `openapi:check` pattern: fail (non-zero) on drift so CI catches a stale client.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SPEC = '../../docs/reference/openapi.json';
const COMMITTED = 'src/lib/api/generated/schema.d.ts';

const dir = mkdtempSync(join(tmpdir(), 'twilight-oapi-'));
const tmp = join(dir, 'schema.d.ts');

try {
  execFileSync('npx', ['openapi-typescript', SPEC, '-o', tmp], { stdio: 'inherit' });
  const committed = readFileSync(COMMITTED, 'utf8');
  const fresh = readFileSync(tmp, 'utf8');
  if (committed !== fresh) {
    console.error(
      '\nOpenAPI types are out of date. Run `npm run openapi:gen` and commit src/lib/api/generated/schema.d.ts.',
    );
    process.exit(1);
  }
  console.log('OpenAPI generated types are up to date.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
