import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error('TEST_DATABASE_URL is required');
  process.exit(1);
}

const parsed = new URL(testDatabaseUrl);
const databaseName = parsed.pathname.replace(/^\//, '');

if (!databaseName.includes('_test')) {
  console.error('Refusing to reset database because TEST_DATABASE_URL database name does not include "_test"');
  process.exit(1);
}

const adminUrl = new URL(testDatabaseUrl);
adminUrl.pathname = '/postgres';

const adminClient = new Client({ connectionString: adminUrl.toString() });

try {
  await adminClient.connect();
  await adminClient.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  await adminClient.end();
} catch (error) {
  await adminClient.end().catch(() => {});
  console.error(`Failed to reset test database: ${formatError(error)}`);
  process.exit(1);
}

const prismaBin = resolve('node_modules/.bin/prisma');
const migrate = spawnSync(prismaBin, ['migrate', 'deploy'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  },
});

if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

console.log(`Reset and migrated test database: ${databaseName}`);

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z0-9_-]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
