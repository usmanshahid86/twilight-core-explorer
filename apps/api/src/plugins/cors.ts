// CORS. Origin policy comes from config: reflect-any in non-prod for convenience, and in production
// DENY cross-origin by default (CORS_ORIGINS unset → `false`) — safe-by-default for a public read-only
// API; the explorer web origin(s) must be added explicitly via CORS_ORIGINS. Reviewed in 13c: the
// policy is sound as-is; the concrete production allow-list is a Phase-14 deployment concern.

import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';

export async function registerCors(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(cors, { origin: config.corsOrigins });
}
