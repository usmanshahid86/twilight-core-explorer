export const COMET_RPC_ROUTES = {
  status: '/status',
  block: '/block',
  blockResults: '/block_results',
  tx: '/tx',
} as const;

export const COSMOS_REST_ROUTES = {
  latestBlock: '/cosmos/base/tendermint/v1beta1/blocks/latest',
  block: '/cosmos/base/tendermint/v1beta1/blocks/{height}',
  nodeInfo: '/cosmos/base/tendermint/v1beta1/node_info',
  config: '/cosmos/base/node/v1beta1/config',
  supply: '/cosmos/bank/v1beta1/supply',
  balances: '/cosmos/bank/v1beta1/balances/{address}',
  tx: '/cosmos/tx/v1beta1/txs/{hash}',
  txs: '/cosmos/tx/v1beta1/txs',
} as const;

export const CORE_SLOT_REST_ROUTES = {
  params: '/twilight/coreslot/v1/params',
  slot: '/twilight/coreslot/v1/slots/{slot_id}',
  slots: '/twilight/coreslot/v1/slots',
  activeSlots: '/twilight/coreslot/v1/active-slots',
  byOperator: '/twilight/coreslot/v1/operators/{operator_address}',
  byConsensusAddress: '/twilight/coreslot/v1/consensus/{consensus_address}',
  pendingKeyRotations: '/twilight/coreslot/v1/pending-key-rotations',
  lastAppliedValidators: '/twilight/coreslot/v1/last-applied-validators',
  reservedConsensusAddress:
    '/twilight/coreslot/v1/reserved-consensus-address/{consensus_address}',
  rewardWeight: '/twilight/coreslot/v1/slots/{slot_id}/reward-weight',
} as const;

export const REWARDS_REST_ROUTES = {
  params: '/twilight/rewards/v1/params',
  epochInfo: '/twilight/rewards/v1/epoch-info',
  nextHalving: '/twilight/rewards/v1/next-halving',
  epochReward: '/twilight/rewards/v1/epochs/{epoch_number}',
  slotRewards: '/twilight/rewards/v1/slots/{slot_id}/rewards',
  claimableRewards: '/twilight/rewards/v1/slots/{slot_id}/claimable',
  cumulativeEmitted: '/twilight/rewards/v1/cumulative-emitted',
  supplySchedule: '/twilight/rewards/v1/supply-schedule',
  currentEpochActiveBlocks: '/twilight/rewards/v1/current-epoch/active-blocks',
  moduleBalances: '/twilight/rewards/v1/module-balances',
} as const;

export const REQUIRED_TWILIGHT_REST_ROUTES = [
  ...Object.values(CORE_SLOT_REST_ROUTES),
  ...Object.values(REWARDS_REST_ROUTES),
] as const;

export function buildPath(
  template: string,
  params: Record<string, string | number | bigint>,
): string {
  return Object.entries(params).reduce((path, [key, value]) => {
    return path.replace(`{${key}}`, encodeURIComponent(value.toString()));
  }, template);
}
