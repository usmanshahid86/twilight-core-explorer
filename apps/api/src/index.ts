// Entrypoint: load config, build the server, listen, and shut down gracefully.

import { buildServer } from './server.js';
import { loadApiConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  // The security posture (CORS deny, rate limiting, prod DB-url guard) all derive from isProduction,
  // and an unknown/unset API_ENV defaults to development (permissive). Make that LOUD at boot so a
  // typo'd/forgotten env in a production deploy can't silently run reflect-any CORS with no rate limit.
  if (!config.isProduction) {
    console.warn(
      `[api] NON-PRODUCTION posture (env=${config.env}): permissive CORS, rate-limiting ` +
        `${config.rateLimit.enabled ? 'on' : 'off'}. Set API_ENV=production for a prod deployment.`,
    );
  }
  // Structured (pino) request/error logging in production; off in dev/test so local output stays clean
  // and the suite isn't noisy (13c). The error handler already logs 500s via request.log.error.
  const app = await buildServer({ config, logger: config.isProduction });

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
