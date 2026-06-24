import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChainClientError, RestRpcChainClient } from '../dist/index.js';

function createJsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function createRecordingFetch(responses = {}) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = input.toString();
    calls.push(url);

    if (responses[url]) return responses[url];

    const parsed = new URL(url);
    if (parsed.pathname === '/status') {
      return createJsonResponse({
        result: {
          node_info: { network: 'twilight-localnet-1' },
          sync_info: { latest_block_height: '17', catching_up: false },
        },
      });
    }
    if (parsed.pathname === '/block') {
      return createJsonResponse({
        result: {
          block_id: { hash: 'ABC123' },
          block: { header: { time: '2026-06-24T00:00:00Z' } },
        },
      });
    }
    if (parsed.pathname === '/block_results') {
      return createJsonResponse({
        result: {
          begin_block_events: [{ type: 'begin' }],
          end_block_events: [{ type: 'end' }],
          txs_results: [{ code: 0 }],
        },
      });
    }
    if (parsed.pathname === '/tx') {
      return createJsonResponse({
        result: { height: '17', tx_result: { code: 0 } },
      });
    }
    if (parsed.pathname === '/cosmos/tx/v1beta1/txs') {
      return createJsonResponse({
        tx_responses: [{ txhash: 'HASH17', height: '17', code: 0 }],
      });
    }
    if (parsed.pathname === '/cosmos/bank/v1beta1/supply') {
      return createJsonResponse({
        supply: [{ denom: 'utwlt', amount: '1000' }],
      });
    }

    return createJsonResponse({ path: parsed.pathname });
  };

  return { calls, fetchImpl };
}

describe('RestRpcChainClient', () => {
  it('routes CometBFT block history and block_results through RPC', async () => {
    const { calls, fetchImpl } = createRecordingFetch();
    const client = new RestRpcChainClient({
      cometRpcUrl: 'http://rpc.test',
      restUrl: 'http://rest.test',
      fetchImpl,
    });

    assert.equal((await client.getStatus()).latestBlockHeight, '17');
    assert.equal((await client.getBlock(17n)).hash, 'ABC123');
    assert.deepEqual((await client.getBlockResults(17n)).txResults, [{ code: 0 }]);
    assert.equal((await client.getTx('ABC123')).code, 0);

    assert.equal(calls[0], 'http://rpc.test/status');
    assert.equal(calls[1], 'http://rpc.test/block?height=17');
    assert.equal(calls[2], 'http://rpc.test/block_results?height=17');
    assert.equal(calls[3], 'http://rpc.test/tx?hash=ABC123');
  });

  it('routes generic Cosmos reads through REST', async () => {
    const { calls, fetchImpl } = createRecordingFetch();
    const client = new RestRpcChainClient({
      cometRpcUrl: 'http://rpc.test',
      restUrl: 'http://rest.test',
      fetchImpl,
    });

    assert.deepEqual(await client.getSupply(), [
      { denom: 'utwlt', amount: '1000', raw: { denom: 'utwlt', amount: '1000' } },
    ]);
    assert.equal((await client.getTxsByHeight(17n))[0].hash, 'HASH17');
    await client.getBalances('twilight1address');

    assert.equal(calls[0], 'http://rest.test/cosmos/bank/v1beta1/supply');
    assert.equal(new URL(calls[1]).pathname, '/cosmos/tx/v1beta1/txs');
    assert.equal(new URL(calls[1]).searchParams.get('query'), 'tx.height=17');
    assert.equal(
      calls[2],
      'http://rest.test/cosmos/bank/v1beta1/balances/twilight1address',
    );
  });

  it('falls back to CometBFT block txs when REST tx search cannot decode a tx', async () => {
    const failingTxSearchUrl = 'http://rest.test/cosmos/tx/v1beta1/txs?query=tx.height%3D17';
    const { calls, fetchImpl } = createRecordingFetch({
      [failingTxSearchUrl]: createJsonResponse(
        { code: 13, message: 'unable to resolve type URL' },
        { ok: false, status: 500 },
      ),
    });
    const client = new RestRpcChainClient({
      cometRpcUrl: 'http://rpc.test',
      restUrl: 'http://rest.test',
      fetchImpl: async (input, init) => {
        const url = input.toString();
        const parsed = new URL(url);
        if (url === failingTxSearchUrl) return fetchImpl(input, init);
        if (parsed.pathname === '/block') {
          return createJsonResponse({
            result: {
              block: { data: { txs: ['AQID'] } },
            },
          });
        }
        if (parsed.pathname === '/tx') {
          return createJsonResponse({
            result: {
              height: '17',
              tx_result: {
                code: 0,
                gas_wanted: '200000',
                gas_used: '53015',
                events: [{ type: 'message', attributes: [] }],
              },
            },
          });
        }
        return fetchImpl(input, init);
      },
    });

    const txs = await client.getTxsByHeight(17n);

    assert.equal(txs.length, 1);
    assert.match(txs[0].hash, /^[A-F0-9]{64}$/);
    assert.equal(txs[0].height, '17');
    assert.equal(txs[0].code, 0);
    assert.equal(calls[0], failingTxSearchUrl);
  });

  it('routes Twilight CoreSlot snapshots through REST contract paths', async () => {
    const { calls, fetchImpl } = createRecordingFetch();
    const client = new RestRpcChainClient({
      cometRpcUrl: 'http://rpc.test',
      restUrl: 'http://rest.test',
      fetchImpl,
    });

    await client.getCoreSlotParams();
    await client.getCoreSlots();
    await client.getActiveCoreSlots();
    await client.getCoreSlot(7n);
    await client.getCoreSlotByOperator('twilight1operator');
    await client.getCoreSlotByConsensusAddress('ABCDEF');
    await client.getPendingKeyRotations();
    await client.getLastAppliedValidators();
    await client.getReservedConsensusAddress('ABCDEF');
    await client.getRewardWeight(7n);

    assert.deepEqual(
      calls.map((call) => new URL(call).pathname),
      [
        '/twilight/coreslot/v1/params',
        '/twilight/coreslot/v1/slots',
        '/twilight/coreslot/v1/active-slots',
        '/twilight/coreslot/v1/slots/7',
        '/twilight/coreslot/v1/operators/twilight1operator',
        '/twilight/coreslot/v1/consensus/ABCDEF',
        '/twilight/coreslot/v1/pending-key-rotations',
        '/twilight/coreslot/v1/last-applied-validators',
        '/twilight/coreslot/v1/reserved-consensus-address/ABCDEF',
        '/twilight/coreslot/v1/slots/7/reward-weight',
      ],
    );
  });

  it('routes Twilight rewards snapshots through REST contract paths', async () => {
    const { calls, fetchImpl } = createRecordingFetch();
    const client = new RestRpcChainClient({
      cometRpcUrl: 'http://rpc.test',
      restUrl: 'http://rest.test',
      fetchImpl,
    });

    await client.getRewardsParams();
    await client.getEpochInfo();
    await client.getNextHalving();
    await client.getEpochReward(9n);
    await client.getSlotRewards(7n);
    await client.getClaimableRewards(7n);
    await client.getCumulativeEmitted();
    await client.getSupplySchedule();
    await client.getCurrentEpochActiveBlocks();
    await client.getModuleBalances();

    assert.deepEqual(
      calls.map((call) => new URL(call).pathname),
      [
        '/twilight/rewards/v1/params',
        '/twilight/rewards/v1/epoch-info',
        '/twilight/rewards/v1/next-halving',
        '/twilight/rewards/v1/epochs/9',
        '/twilight/rewards/v1/slots/7/rewards',
        '/twilight/rewards/v1/slots/7/claimable',
        '/twilight/rewards/v1/cumulative-emitted',
        '/twilight/rewards/v1/supply-schedule',
        '/twilight/rewards/v1/current-epoch/active-blocks',
        '/twilight/rewards/v1/module-balances',
      ],
    );
  });

  it('wraps HTTP failures with path, URL, status, and body details', async () => {
    const failingUrl = 'http://rest.test/twilight/rewards/v1/params';
    const { fetchImpl } = createRecordingFetch({
      [failingUrl]: createJsonResponse('upstream exploded', { ok: false, status: 500 }),
    });
    const client = new RestRpcChainClient({
      cometRpcUrl: 'http://rpc.test',
      restUrl: 'http://rest.test',
      fetchImpl,
    });

    await assert.rejects(
      () => client.getRewardsParams(),
      (error) => {
        assert.equal(error instanceof ChainClientError, true);
        assert.equal(error.status, 500);
        assert.equal(error.path, '/twilight/rewards/v1/params');
        assert.equal(error.url, failingUrl);
        assert.match(error.bodySnippet, /upstream exploded/);
        return true;
      },
    );
  });
});
