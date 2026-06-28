// Build/env metadata surfaced on /api/v1/status (13c). HARD CONSTRAINT: build-time + env values ONLY,
// never a chain/RPC call — this service is DB-only and version truthfulness must not smuggle in
// transport. `version`/`gitSha`/`builtAt` are injected by the build/deploy (Phase 14); absent locally,
// hence nullable. Decorated onto the instance (like `prisma`) so the status route reads it directly.

import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../config.js';

export interface BuildInfo {
  version: string;
  gitSha: string | null;
  builtAt: string | null;
  environment: ApiEnv;
}

declare module 'fastify' {
  interface FastifyInstance {
    buildInfo: BuildInfo;
  }
}

export function buildInfoFrom(env: ApiEnv): BuildInfo {
  return {
    version: process.env.APP_VERSION?.trim() || '0.0.0-dev',
    gitSha: process.env.GIT_SHA?.trim() || null,
    builtAt: process.env.BUILT_AT?.trim() || null,
    environment: env,
  };
}

export function attachBuildInfo(app: FastifyInstance, env: ApiEnv): void {
  app.decorate('buildInfo', buildInfoFrom(env));
}
