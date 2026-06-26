// Generate (or drift-check) the committed OpenAPI artifact at docs/reference/openapi.json.
//   node dist/scripts/generate-openapi.js          -> write the spec
//   node dist/scripts/generate-openapi.js --check  -> exit non-zero if the committed file is stale
// Builds the app with a stub Prisma so it never needs a database.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@twilight-explorer/db';
import { buildServer } from '../server.js';
import type { ApiConfig } from '../config.js';

const SPEC_PATH = fileURLToPath(new URL('../../../../docs/reference/openapi.json', import.meta.url));

const stubConfig: ApiConfig = {
  databaseUrl: 'postgresql://unused',
  port: 0,
  host: '127.0.0.1',
  env: 'development',
  isProduction: false,
  corsOrigins: false,
};

const stubPrisma = { $disconnect: async () => {} } as unknown as PrismaClient;

async function generate(): Promise<string> {
  const app = await buildServer({ config: stubConfig, prisma: stubPrisma });
  await app.ready();
  const spec = app.swagger();
  await app.close();
  return `${JSON.stringify(spec, null, 2)}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const spec = await generate();

  if (check) {
    const committed = existsSync(SPEC_PATH) ? readFileSync(SPEC_PATH, 'utf8') : '';
    if (committed !== spec) {
      console.error(
        'OpenAPI drift: docs/reference/openapi.json is out of date. Run `npm --prefix apps/api run openapi:generate`.',
      );
      process.exit(1);
    }
    console.log('OpenAPI spec is up to date.');
    return;
  }

  writeFileSync(SPEC_PATH, spec);
  console.log(`Wrote ${SPEC_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
