// Entrypoint: load config, build the server, listen, and shut down gracefully.

import { buildServer } from './server.js';
import { loadApiConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const app = await buildServer({ config, logger: true });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
