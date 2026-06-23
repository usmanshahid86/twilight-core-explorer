import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../dist/index.js';

describe('loadConfig', () => {
  it('loads safe local defaults without devnet IP assumptions', () => {
    assert.deepEqual(loadConfig({}), {
      chainId: 'twilight-localnet-1',
      cometRpcUrl: 'http://localhost:26657',
      restUrl: 'http://localhost:1317',
      requestTimeoutMs: 10000,
    });
  });

  it('loads explicit chain URLs and timeout values', () => {
    assert.deepEqual(
      loadConfig({
        CHAIN_ID: 'twilight-core-devnet',
        COMET_RPC_URL: 'https://rpc.example.test/',
        REST_URL: 'https://rest.example.test/',
        REQUEST_TIMEOUT_MS: '2500',
      }),
      {
        chainId: 'twilight-core-devnet',
        cometRpcUrl: 'https://rpc.example.test',
        restUrl: 'https://rest.example.test',
        requestTimeoutMs: 2500,
      },
    );
  });

  it('rejects malformed URLs', () => {
    assert.throws(() => loadConfig({ COMET_RPC_URL: 'localhost:26657' }), /COMET_RPC_URL/);
    assert.throws(() => loadConfig({ REST_URL: 'ftp://example.test' }), /REST_URL/);
  });

  it('rejects invalid timeout values', () => {
    assert.throws(() => loadConfig({ REQUEST_TIMEOUT_MS: '0' }), /REQUEST_TIMEOUT_MS/);
    assert.throws(() => loadConfig({ REQUEST_TIMEOUT_MS: '1.5' }), /REQUEST_TIMEOUT_MS/);
  });
});
