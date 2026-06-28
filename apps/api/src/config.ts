// API-specific configuration. Deliberately DB-oriented: this service is a read-only projection of
// Postgres and must never load chain RPC/REST URLs. It does NOT use packages/config (loadConfig),
// which is chain-oriented — importing that would smuggle chain transport into a DB-only service.

export type ApiEnv = 'production' | 'development' | 'test';

/** Per-IP rate limit. Disabled by default outside production so local dev + the test suite are never
 *  throttled or made flaky; opt in anywhere via RATE_LIMIT_ENABLED. */
export interface RateLimitConfig {
  enabled: boolean;
  /** Max requests per IP per window. */
  max: number;
  /** Window length in milliseconds. */
  timeWindowMs: number;
}

export interface ApiConfig {
  /** Postgres connection string. API_DATABASE_URL is authoritative; DATABASE_URL is a documented
   *  local/test-only fallback (never in production). A read-only DB role is recommended. */
  databaseUrl: string;
  port: number;
  host: string;
  env: ApiEnv;
  isProduction: boolean;
  /** CORS allow-list. `true` = reflect any origin (non-prod default); `false` = no cross-origin;
   *  string[] = explicit allow-list. */
  corsOrigins: boolean | string[];
  rateLimit: RateLimitConfig;
}

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = '0.0.0.0';

export function loadApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const apiEnv = normalizeEnv(env.API_ENV ?? env.NODE_ENV);
  const isProduction = apiEnv === 'production';

  const databaseUrl = resolveDatabaseUrl(env, isProduction);
  const port = readPort(env, 'PORT', DEFAULT_PORT);
  const host = readString(env, 'HOST', DEFAULT_HOST);
  const corsOrigins = readCors(env.CORS_ORIGINS, isProduction);
  const rateLimit = readRateLimit(env, isProduction);

  return { databaseUrl, port, host, env: apiEnv, isProduction, corsOrigins, rateLimit };
}

/** Rate limit: enabled in production by default (override with RATE_LIMIT_ENABLED=true/false), 100
 *  req/IP/min. Off in dev/test unless explicitly enabled, so the suite is never throttled. */
function readRateLimit(
  env: Record<string, string | undefined>,
  isProduction: boolean,
): RateLimitConfig {
  // Strict parse (mirrors readPositiveInt): an unrecognized value throws rather than silently
  // disabling the limiter on a typo (e.g. RATE_LIMIT_ENABLED=yes). Unset → production default.
  const raw = env.RATE_LIMIT_ENABLED?.trim().toLowerCase();
  let enabled: boolean;
  if (raw === undefined) enabled = isProduction;
  else if (raw === 'true' || raw === '1') enabled = true;
  else if (raw === 'false' || raw === '0') enabled = false;
  else throw new Error('RATE_LIMIT_ENABLED must be one of true/false/1/0');
  const max = readPositiveInt(env, 'RATE_LIMIT_MAX', 100);
  const timeWindowMs = readPositiveInt(env, 'RATE_LIMIT_WINDOW_MS', 60_000);
  return { enabled, max, timeWindowMs };
}

function readPositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function normalizeEnv(raw: string | undefined): ApiEnv {
  const value = raw?.trim().toLowerCase();
  if (value === 'production') return 'production';
  if (value === 'test') return 'test';
  return 'development';
}

function resolveDatabaseUrl(env: Record<string, string | undefined>, isProduction: boolean): string {
  const apiUrl = env.API_DATABASE_URL?.trim();
  if (apiUrl) return apiUrl;

  const fallback = env.DATABASE_URL?.trim();
  if (fallback) {
    if (isProduction) {
      throw new Error(
        'API_DATABASE_URL is required in production; the DATABASE_URL fallback is local/test only',
      );
    }
    return fallback;
  }

  throw new Error('API_DATABASE_URL (or DATABASE_URL for local/test) must be set');
}

function readString(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function readPort(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${key} must be a valid TCP port`);
  }
  return value;
}

/** Parse CORS_ORIGINS. Unset: allow-all in non-prod, none in prod. Comma-separated → explicit list. */
function readCors(raw: string | undefined, isProduction: boolean): boolean | string[] {
  const value = raw?.trim();
  if (!value) return isProduction ? false : true;
  if (value === '*') return true; // explicit bare '*' = allow-all
  // A '*' mixed into a comma list is almost certainly a mistake — @fastify/cors would silently treat
  // the WHOLE list as allow-all. Drop the stray '*' so an explicit allow-list stays deny-by-default.
  return value
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o !== '*');
}
