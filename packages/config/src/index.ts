declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<string, string | undefined> {}
  }
}

declare const process: { env: NodeJS.ProcessEnv };

export interface ExplorerConfig {
  chainId: string;
  cometRpcUrl: string;
  restUrl: string;
  requestTimeoutMs: number;
}

const DEFAULT_CHAIN_ID = 'twilight-localnet-1';
const DEFAULT_COMET_RPC_URL = 'http://localhost:26657';
const DEFAULT_REST_URL = 'http://localhost:1317';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExplorerConfig {
  const chainId = readString(env, 'CHAIN_ID', DEFAULT_CHAIN_ID);
  const cometRpcUrl = readUrl(env, 'COMET_RPC_URL', DEFAULT_COMET_RPC_URL);
  const restUrl = readUrl(env, 'REST_URL', DEFAULT_REST_URL);
  const requestTimeoutMs = readPositiveInteger(
    env,
    'REQUEST_TIMEOUT_MS',
    DEFAULT_REQUEST_TIMEOUT_MS,
  );

  return {
    chainId,
    cometRpcUrl,
    restUrl,
    requestTimeoutMs,
  };
}

function readString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function readUrl(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = readString(env, key, fallback);
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${key} must use http or https`);
  }

  return parsed.toString().replace(/\/$/, '');
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
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
