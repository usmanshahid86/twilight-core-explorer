// Per-IP rate limiting (13c). In-process (single-instance) for now, registered behind this plugin so a
// shared store (Redis, Phase 14) can replace it without touching call sites. Disabled outside
// production by default (config) so local dev and the test suite are never throttled or made flaky.
// A 429 is returned in the standard { error } envelope, same as every other failure.

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';

export async function registerRateLimit(app: FastifyInstance, config: ApiConfig): Promise<void> {
  if (!config.rateLimit.enabled) return;

  // The over-limit 429 is thrown (statusCode 429) and shaped into the standard { error } envelope by
  // the central error handler (registerErrorHandling) — a custom errorResponseBuilder here would
  // bypass that envelope and mis-set the status, so we deliberately don't use one.
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  });
}
