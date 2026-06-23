import { getJson, type FetchLike } from './http.js';
import {
  COMET_RPC_ROUTES,
  CORE_SLOT_REST_ROUTES,
  COSMOS_REST_ROUTES,
  REWARDS_REST_ROUTES,
  buildPath,
} from './routes.js';
import type {
  BlockResultsSource,
  BlockSource,
  ChainClient,
  ChainStatus,
  ModuleSnapshot,
  SupplySource,
  TxSource,
} from './types.js';

export interface RestRpcChainClientOptions {
  cometRpcUrl: string;
  restUrl: string;
  timeoutMs?: number | undefined;
  fetchImpl?: FetchLike | undefined;
}

export class RestRpcChainClient implements ChainClient {
  private readonly cometRpcUrl: string;
  private readonly restUrl: string;
  private readonly timeoutMs: number | undefined;
  private readonly fetchImpl: FetchLike | undefined;

  constructor(options: RestRpcChainClientOptions) {
    this.cometRpcUrl = options.cometRpcUrl;
    this.restUrl = options.restUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;
  }

  async getStatus(): Promise<ChainStatus> {
    const raw = await this.rpc(COMET_RPC_ROUTES.status);
    const result = getRecord(raw).result;
    const resultRecord = getRecord(result);
    const syncInfo = getRecord(resultRecord.sync_info);
    const nodeInfo = getRecord(resultRecord.node_info);

    return {
      chainId: readString(nodeInfo.network),
      latestBlockHeight: readString(syncInfo.latest_block_height),
      catchingUp: readBoolean(syncInfo.catching_up),
      raw,
    };
  }

  async getBlock(height: bigint): Promise<BlockSource> {
    const raw = await this.rpc(COMET_RPC_ROUTES.block, { height });
    const result = getRecord(raw).result;
    const resultRecord = getRecord(result);
    const block = getRecord(resultRecord.block);
    const blockId = getRecord(resultRecord.block_id);
    const header = getRecord(block.header);

    return {
      height: height.toString(),
      hash: readString(blockId.hash),
      time: readString(header.time),
      raw,
    };
  }

  async getBlockResults(height: bigint): Promise<BlockResultsSource> {
    const raw = await this.rpc(COMET_RPC_ROUTES.blockResults, { height });
    const result = getRecord(getRecord(raw).result);

    return {
      height: height.toString(),
      beginBlockEvents: readArray(result.begin_block_events),
      endBlockEvents: readArray(result.end_block_events),
      txResults: readArray(result.txs_results),
      raw,
    };
  }

  async getTx(hash: string): Promise<TxSource> {
    const raw = await this.rpc(COMET_RPC_ROUTES.tx, { hash });
    const result = getRecord(getRecord(raw).result);
    const txResult = getRecord(result.tx_result);

    return {
      hash,
      height: readString(result.height),
      code: readNumber(txResult.code),
      raw,
    };
  }

  async getTxsByHeight(height: bigint): Promise<TxSource[]> {
    const raw = await this.rest(COSMOS_REST_ROUTES.txs, {
      events: `tx.height=${height.toString()}`,
    });
    const txResponses = readArray(getRecord(raw).tx_responses);

    return txResponses.map((response) => {
      const record = getRecord(response);
      return {
        hash: readString(record.txhash) ?? '',
        height: readString(record.height),
        code: readNumber(record.code),
        raw: response,
      };
    });
  }

  async getSupply(): Promise<SupplySource[]> {
    const raw = await this.rest(COSMOS_REST_ROUTES.supply);
    const supply = readArray(getRecord(raw).supply);

    return supply.map((coin) => {
      const record = getRecord(coin);
      return {
        denom: readString(record.denom) ?? '',
        amount: readString(record.amount) ?? '0',
        raw: coin,
      };
    });
  }

  async getBalances(address: string): Promise<ModuleSnapshot> {
    return this.snapshot(buildPath(COSMOS_REST_ROUTES.balances, { address }));
  }

  async getCoreSlotParams(): Promise<ModuleSnapshot> {
    return this.snapshot(CORE_SLOT_REST_ROUTES.params);
  }

  async getCoreSlots(): Promise<ModuleSnapshot> {
    return this.snapshot(CORE_SLOT_REST_ROUTES.slots);
  }

  async getActiveCoreSlots(): Promise<ModuleSnapshot> {
    return this.snapshot(CORE_SLOT_REST_ROUTES.activeSlots);
  }

  async getCoreSlot(slotId: bigint): Promise<ModuleSnapshot> {
    return this.snapshot(buildPath(CORE_SLOT_REST_ROUTES.slot, { slot_id: slotId }));
  }

  async getCoreSlotByOperator(operatorAddress: string): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(CORE_SLOT_REST_ROUTES.byOperator, { operator_address: operatorAddress }),
    );
  }

  async getCoreSlotByConsensusAddress(consensusAddress: string): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(CORE_SLOT_REST_ROUTES.byConsensusAddress, {
        consensus_address: consensusAddress,
      }),
    );
  }

  async getPendingKeyRotations(): Promise<ModuleSnapshot> {
    return this.snapshot(CORE_SLOT_REST_ROUTES.pendingKeyRotations);
  }

  async getLastAppliedValidators(): Promise<ModuleSnapshot> {
    return this.snapshot(CORE_SLOT_REST_ROUTES.lastAppliedValidators);
  }

  async getReservedConsensusAddress(consensusAddress: string): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(CORE_SLOT_REST_ROUTES.reservedConsensusAddress, {
        consensus_address: consensusAddress,
      }),
    );
  }

  async getRewardWeight(slotId: bigint): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(CORE_SLOT_REST_ROUTES.rewardWeight, { slot_id: slotId }),
    );
  }

  async getRewardsParams(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.params);
  }

  async getEpochInfo(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.epochInfo);
  }

  async getNextHalving(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.nextHalving);
  }

  async getEpochReward(epoch: bigint): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(REWARDS_REST_ROUTES.epochReward, { epoch_number: epoch }),
    );
  }

  async getSlotRewards(slotId: bigint): Promise<ModuleSnapshot> {
    return this.snapshot(buildPath(REWARDS_REST_ROUTES.slotRewards, { slot_id: slotId }));
  }

  async getClaimableRewards(slotId: bigint): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(REWARDS_REST_ROUTES.claimableRewards, { slot_id: slotId }),
    );
  }

  async getCumulativeEmitted(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.cumulativeEmitted);
  }

  async getSupplySchedule(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.supplySchedule);
  }

  async getCurrentEpochActiveBlocks(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.currentEpochActiveBlocks);
  }

  async getModuleBalances(): Promise<ModuleSnapshot> {
    return this.snapshot(REWARDS_REST_ROUTES.moduleBalances);
  }

  private async rpc(
    path: string,
    query?: Record<string, string | number | bigint | boolean | undefined>,
  ): Promise<unknown> {
    return getJson(this.cometRpcUrl, path, {
      query,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  private async rest(
    path: string,
    query?: Record<string, string | number | bigint | boolean | undefined>,
  ): Promise<unknown> {
    return getJson(this.restUrl, path, {
      query,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  private async snapshot(path: string): Promise<ModuleSnapshot> {
    return { raw: await this.rest(path) };
  }
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
