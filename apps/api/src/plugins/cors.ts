// CORS. Enabled in 9a (rate-limiting is deferred to hardening). Origin policy comes from config:
// allow-all in non-prod by default, explicit allow-list otherwise.

import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';

export async function registerCors(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(cors, { origin: config.corsOrigins });
}
