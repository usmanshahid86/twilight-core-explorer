import { Client } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maxAttempts = Number(process.env.POSTGRES_WAIT_ATTEMPTS ?? 30);
const delayMs = Number(process.env.POSTGRES_WAIT_DELAY_MS ?? 1000);

if (!connectionString) {
  console.error('DATABASE_URL or TEST_DATABASE_URL is required');
  process.exit(1);
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    console.log(`Postgres is ready after ${attempt} attempt(s)`);
    process.exit(0);
  } catch (error) {
    await client.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error(`Postgres did not become ready: ${formatError(error)}`);
      process.exit(1);
    }
    await sleep(delayMs);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
