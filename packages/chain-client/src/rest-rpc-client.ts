import {
  ChainClientError,
  ChainClientInputError,
  getJson,
  type FetchLike,
} from './http.js';
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
  GenesisSource,
  ModuleSnapshot,
  PaginationRequest,
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

  async getGenesis(): Promise<GenesisSource> {
    let raw: unknown;
    try {
      raw = await this.rpc(COMET_RPC_ROUTES.genesis);
      if (isLargeGenesisRpcResponse(raw)) {
        raw = await this.getGenesisFromChunks();
      }
    } catch (error) {
      if (isLargeGenesisError(error)) {
        raw = await this.getGenesisFromChunks();
      } else {
        throw error;
      }
    }
    return mapGenesisSource(raw);
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

  private async getGenesisFromChunks(): Promise<unknown> {
    const chunks: string[] = [];
    let total = 1;

    for (let chunk = 0; chunk < total; chunk += 1) {
      const raw = await this.rpc(COMET_RPC_ROUTES.genesisChunked, { chunk });
      const result = getRecord(getRecord(raw).result);
      const data = readString(result.data);
      if (!data) {
        throw new ChainClientError(
          'CometBFT genesis_chunked response is missing result.data',
          {
            url: `${this.cometRpcUrl}${COMET_RPC_ROUTES.genesisChunked}`,
            path: COMET_RPC_ROUTES.genesisChunked,
            status: 200,
            bodySnippet: JSON.stringify(raw).slice(0, 500),
          },
        );
      }
      chunks.push(data);
      total = readNumber(result.total) ?? total;
    }

    const json = decodeBase64Utf8(chunks.join(''));
    return JSON.parse(json) as unknown;
  }

  async getBlockResults(height: bigint): Promise<BlockResultsSource> {
    const raw = await this.rpc(COMET_RPC_ROUTES.blockResults, { height });
    const result = getRecord(getRecord(raw).result);

    return {
      height: height.toString(),
      beginBlockEvents: readArray(result.begin_block_events),
      endBlockEvents: readArray(result.end_block_events),
      finalizeBlockEvents: readArray(result.finalize_block_events),
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
    let raw: unknown;
    try {
      raw = await this.rest(COSMOS_REST_ROUTES.txs, {
        query: `tx.height=${height.toString()}`,
      });
    } catch (error) {
      if (error instanceof ChainClientError) {
        return this.getTxsByHeightFromRpcBlock(height);
      }
      throw error;
    }
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

  private async getTxsByHeightFromRpcBlock(height: bigint): Promise<TxSource[]> {
    const blockRaw = await this.rpc(COMET_RPC_ROUTES.block, { height });
    const result = getRecord(getRecord(blockRaw).result);
    const block = getRecord(result.block);
    const data = getRecord(block.data);
    const rawTxs = readArray(data.txs).filter((tx): tx is string => typeof tx === 'string');
    const txs: TxSource[] = [];

    for (const rawTxBase64 of rawTxs) {
      const hash = await sha256Base64ToHex(rawTxBase64);
      const rawTxResult = await this.rpc(COMET_RPC_ROUTES.tx, { hash: `0x${hash}` });
      const txResult = getRecord(getRecord(rawTxResult).result);
      const deliverTx = getRecord(txResult.tx_result);

      txs.push({
        hash,
        height: readString(txResult.height) ?? height.toString(),
        code: readNumber(deliverTx.code),
        rawTxBase64,
        raw: {
          txhash: hash,
          height: readString(txResult.height) ?? height.toString(),
          code: readNumber(deliverTx.code) ?? 0,
          codespace: readString(deliverTx.codespace) ?? '',
          gas_wanted: readString(deliverTx.gas_wanted),
          gas_used: readString(deliverTx.gas_used),
          events: readArray(deliverTx.events),
          tx: { body: { messages: [] } },
          raw_tx_base64: rawTxBase64,
          rawTxBase64,
          rpc: rawTxResult,
        },
      });
    }

    return txs;
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
    const normalizedConsensusAddress = normalizeConsensusAddressHex(consensusAddress);

    return this.snapshot(
      buildPath(CORE_SLOT_REST_ROUTES.byConsensusAddress, {
        consensus_address: normalizedConsensusAddress,
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
    const normalizedConsensusAddress = normalizeConsensusAddressHex(consensusAddress);

    return this.snapshot(
      buildPath(CORE_SLOT_REST_ROUTES.reservedConsensusAddress, {
        consensus_address: normalizedConsensusAddress,
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

  async getSlotRewards(
    slotId: bigint,
    pagination: PaginationRequest = {},
  ): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(REWARDS_REST_ROUTES.slotRewards, { slot_id: slotId }),
      buildPaginationQuery(pagination),
    );
  }

  async getClaimableRewards(
    slotId: bigint,
    startEpoch: bigint,
    endEpoch: bigint,
  ): Promise<ModuleSnapshot> {
    return this.snapshot(
      buildPath(REWARDS_REST_ROUTES.claimableRewards, { slot_id: slotId }),
      {
        start_epoch: startEpoch,
        end_epoch: endEpoch,
      },
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

  private async snapshot(
    path: string,
    query?: Record<string, string | number | bigint | boolean | undefined>,
  ): Promise<ModuleSnapshot> {
    return { raw: await this.rest(path, query) };
  }
}

export function normalizeConsensusAddressHex(consensusAddress: string): string {
  const value = consensusAddress.trim();
  if (/^twilightvalcons1/i.test(value)) {
    throw new ChainClientInputError(
      'CoreSlot consensus routes require a 40-character CometBFT hex consensus address; twilightvalcons bech32 conversion is not implemented in this transport yet.',
    );
  }
  if (!/^[0-9a-fA-F]{40}$/.test(value)) {
    throw new ChainClientInputError(
      'CoreSlot consensus routes require a 40-character CometBFT hex consensus address.',
    );
  }
  return value.toLowerCase();
}

function buildPaginationQuery(
  pagination: PaginationRequest,
): Record<string, string | number | bigint | boolean | undefined> {
  return {
    'pagination.limit': pagination.limit,
    'pagination.offset': pagination.offset,
    'pagination.key': pagination.key,
    'pagination.reverse': pagination.reverse,
    'pagination.count_total': pagination.countTotal,
  };
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

function mapGenesisSource(raw: unknown): GenesisSource {
  const root = getRecord(raw);
  const result = getRecord(root.result);
  const genesis = getRecord(result.genesis ?? root.genesis);
  const appState = getRecord(genesis.app_state ?? genesis.appState);
  const coreSlot = appState.coreslot ?? appState.coreSlot ?? null;

  return {
    chainId: readString(genesis.chain_id ?? genesis.chainId),
    initialHeight: readString(genesis.initial_height ?? genesis.initialHeight) ?? '1',
    coreSlot,
    raw,
  };
}

function isLargeGenesisRpcResponse(raw: unknown): boolean {
  const error = getRecord(getRecord(raw).error);
  return isLargeGenesisMessage(readString(error.message) ?? readString(error.data));
}

function isLargeGenesisError(error: unknown): boolean {
  if (error instanceof ChainClientError) {
    return isLargeGenesisMessage(error.message) || isLargeGenesisMessage(error.bodySnippet);
  }
  return false;
}

function isLargeGenesisMessage(value: string | undefined): boolean {
  return value?.toLowerCase().includes('genesis response is large') === true
    || value?.toLowerCase().includes('genesis_chunked') === true;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha256Base64ToHex(value: string): Promise<string> {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
