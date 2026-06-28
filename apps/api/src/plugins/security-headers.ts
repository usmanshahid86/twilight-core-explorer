// Security response headers via @fastify/helmet, tuned for a public read-only JSON API (13c).
// Defaults we keep: X-Content-Type-Options: nosniff, Referrer-Policy, Strict-Transport-Security
// (ignored by browsers over plain HTTP, so harmless in local dev), etc.

import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';

export async function registerSecurityHeaders(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(helmet, {
    // CSP governs HTML resource loading — irrelevant to JSON responses. In NON-prod it must be OFF
    // because the bundled `/docs` swagger-ui needs inline scripts/styles. In PRODUCTION `/docs` is
    // absent (no HTML surface at all), so a strict CSP is free defense-in-depth against any stray HTML.
    contentSecurityPolicy: config.isProduction
      ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
      : false,
    // An API is never framed — DENY (stronger than helmet's SAMEORIGIN default).
    frameguard: { action: 'deny' },
    // The API is consumed cross-origin (CORS) by the explorer web app; the default same-origin CORP
    // would block legitimate cross-origin reads, so allow cross-origin for this read-only API.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}
