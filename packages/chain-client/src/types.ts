export interface ChainClient {
  getStatus(): Promise<ChainStatus>;
  getBlock(height: bigint): Promise<BlockSource>;
  getBlockResults(height: bigint): Promise<BlockResultsSource>;
  getTx(hash: string): Promise<TxSource>;
  getTxsByHeight(height: bigint): Promise<TxSource[]>;
  getSupply(): Promise<SupplySource[]>;
  getBalances(address: string): Promise<ModuleSnapshot>;
  getCoreSlotParams(): Promise<ModuleSnapshot>;
  getCoreSlots(): Promise<ModuleSnapshot>;
  getActiveCoreSlots(): Promise<ModuleSnapshot>;
  getCoreSlot(slotId: bigint): Promise<ModuleSnapshot>;
  getCoreSlotByOperator(operatorAddress: string): Promise<ModuleSnapshot>;
  getCoreSlotByConsensusAddress(consensusAddress: string): Promise<ModuleSnapshot>;
  getPendingKeyRotations(): Promise<ModuleSnapshot>;
  getLastAppliedValidators(): Promise<ModuleSnapshot>;
  getReservedConsensusAddress(consensusAddress: string): Promise<ModuleSnapshot>;
  getRewardWeight(slotId: bigint): Promise<ModuleSnapshot>;
  getRewardsParams(): Promise<ModuleSnapshot>;
  getEpochInfo(): Promise<ModuleSnapshot>;
  getNextHalving(): Promise<ModuleSnapshot>;
  getEpochReward(epoch: bigint): Promise<ModuleSnapshot>;
  getSlotRewards(slotId: bigint): Promise<ModuleSnapshot>;
  getClaimableRewards(slotId: bigint): Promise<ModuleSnapshot>;
  getCumulativeEmitted(): Promise<ModuleSnapshot>;
  getSupplySchedule(): Promise<ModuleSnapshot>;
  getCurrentEpochActiveBlocks(): Promise<ModuleSnapshot>;
  getModuleBalances(): Promise<ModuleSnapshot>;
}

export interface ChainStatus {
  chainId: string | undefined;
  latestBlockHeight: string | undefined;
  catchingUp: boolean | undefined;
  raw: unknown;
}

export interface BlockSource {
  height: string;
  hash: string | undefined;
  time: string | undefined;
  raw: unknown;
}

export interface BlockResultsSource {
  height: string;
  beginBlockEvents: unknown[];
  endBlockEvents: unknown[];
  txResults: unknown[];
  raw: unknown;
}

export interface TxSource {
  hash: string;
  height: string | undefined;
  code: number | undefined;
  raw: unknown;
}

export interface SupplySource {
  denom: string;
  amount: string;
  raw: unknown;
}

export interface ModuleSnapshot<T = unknown> {
  raw: T;
}
