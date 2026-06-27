// Typed TanStack Query hooks. All data fetching is client-side (client-leaning posture):
// no RSC server-fetching, no route-segment caching, no server actions.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiGet, apiGetPath, type JsonOf } from './client';
import { nextPageParam } from './pagination';

const STATUS_REFETCH_MS = 15_000;
const LIST_REFETCH_MS = 30_000;

export type StatusResponse = JsonOf<'/api/v1/status'>;
export type ProjectionsResponse = JsonOf<'/api/v1/projections'>;
export type BlocksResponse = JsonOf<'/api/v1/blocks'>;
export type TxsResponse = JsonOf<'/api/v1/txs'>;
export type CoreSlotsResponse = JsonOf<'/api/v1/coreslots'>;
export type ValidatorSetResponse = JsonOf<'/api/v1/network/validator-set'>;
export type ProposersResponse = JsonOf<'/api/v1/network/proposers'>;
export type LivenessRiskResponse = JsonOf<'/api/v1/network/liveness-risk'>;
export type SupplyResponse = JsonOf<'/api/v1/supply'>;
export type SearchResponse = JsonOf<'/api/v1/search'>;

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => apiGet('/api/v1/status'),
    refetchInterval: STATUS_REFETCH_MS,
  });
}

export function useProjections() {
  return useQuery({
    queryKey: ['projections'],
    queryFn: () => apiGet('/api/v1/projections'),
    refetchInterval: STATUS_REFETCH_MS,
  });
}

export function useLatestBlocks(limit = 8) {
  return useQuery({
    queryKey: ['blocks', { limit }],
    queryFn: () => apiGet('/api/v1/blocks', { limit }),
    refetchInterval: LIST_REFETCH_MS,
  });
}

export function useRecentTxs(limit = 8) {
  return useQuery({
    queryKey: ['txs', { limit }],
    queryFn: () => apiGet('/api/v1/txs', { limit }),
    refetchInterval: LIST_REFETCH_MS,
  });
}

export function useCoreSlots() {
  return useQuery({
    queryKey: ['coreslots'],
    queryFn: () => apiGet('/api/v1/coreslots', { limit: 100 }),
    refetchInterval: LIST_REFETCH_MS,
  });
}

// /api/v1/network/validator-set requires a `height` (the active set AT a height). The caller derives
// it from /api/v1/status; the query stays disabled until a real height string is available, so we
// never issue the invalid (400) heightless call.
export function useValidatorSet(height: string | undefined) {
  return useQuery({
    queryKey: ['validator-set', height ?? null],
    queryFn: () => {
      if (height === undefined || height === '') {
        // Unreachable: `enabled` gates this. Guards against ever calling validator-set without height.
        throw new Error('validator-set requires a height');
      }
      return apiGet('/api/v1/network/validator-set', { height });
    },
    enabled: typeof height === 'string' && height.length > 0,
    refetchInterval: LIST_REFETCH_MS,
  });
}

export function useProposers() {
  return useQuery({
    queryKey: ['proposers'],
    queryFn: () => apiGet('/api/v1/network/proposers'),
    refetchInterval: LIST_REFETCH_MS,
  });
}

export function useLivenessRisk() {
  return useQuery({
    queryKey: ['liveness-risk'],
    queryFn: () => apiGet('/api/v1/network/liveness-risk'),
    refetchInterval: STATUS_REFETCH_MS,
  });
}

export function useSupply() {
  return useQuery({
    queryKey: ['supply'],
    queryFn: () => apiGet('/api/v1/supply'),
    refetchInterval: LIST_REFETCH_MS,
  });
}

/** Search is on-demand: only runs when there is a non-empty query. */
export function useSearch(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => apiGet('/api/v1/search', { q: trimmed }),
    enabled: trimmed.length > 0,
  });
}

// ---------- Phase 10b: generic explorer list + detail hooks ----------

const LIST_PAGE = 25;

export type AccountsResponse = JsonOf<'/api/v1/accounts'>;

// Detail response types (templated paths), derived from the generated schema.
export type BlockDetailResponse = JsonOf<'/api/v1/blocks/{height}'>;
export type TxDetailResponse = JsonOf<'/api/v1/txs/{hash}'>;
export type AccountDetailResponse = JsonOf<'/api/v1/accounts/{address}'>;
export type AccountBalancesResponse = JsonOf<'/api/v1/accounts/{address}/balances'>;

// --- Blocks ---
export function useBlocksList() {
  return useInfiniteQuery({
    queryKey: ['blocks', 'list'],
    queryFn: ({ pageParam }) =>
      apiGet('/api/v1/blocks', { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
  });
}

export function useBlock(height: string) {
  return useQuery({
    queryKey: ['block', height],
    queryFn: () => apiGetPath('/api/v1/blocks/{height}', { height }),
    enabled: height.length > 0,
  });
}

export function useBlockRaw(height: string, enabled: boolean) {
  return useQuery({
    queryKey: ['block', height, 'raw'],
    queryFn: () => apiGetPath('/api/v1/blocks/{height}', { height }, { include: 'raw' }),
    enabled: enabled && height.length > 0,
  });
}

/** Transactions in a given block, via the /txs `height` filter (block -> txs). */
export function useTxsByHeight(height: string) {
  return useInfiniteQuery({
    queryKey: ['txs', 'byHeight', height],
    queryFn: ({ pageParam }) =>
      apiGet('/api/v1/txs', { limit: LIST_PAGE, cursor: pageParam, height }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    enabled: height.length > 0,
  });
}

// --- Transactions ---
export function useTxsList() {
  return useInfiniteQuery({
    queryKey: ['txs', 'list'],
    queryFn: ({ pageParam }) => apiGet('/api/v1/txs', { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
  });
}

export function useTx(hash: string) {
  return useQuery({
    queryKey: ['tx', hash],
    queryFn: () => apiGetPath('/api/v1/txs/{hash}', { hash }),
    enabled: hash.length > 0,
  });
}

export function useTxRaw(hash: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tx', hash, 'raw'],
    queryFn: () => apiGetPath('/api/v1/txs/{hash}', { hash }, { include: 'raw' }),
    enabled: enabled && hash.length > 0,
  });
}

// --- Accounts ---
export function useAccountsList() {
  return useInfiniteQuery({
    queryKey: ['accounts', 'list'],
    queryFn: ({ pageParam }) =>
      apiGet('/api/v1/accounts', { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
  });
}

export function useAccount(address: string) {
  return useQuery({
    queryKey: ['account', address],
    queryFn: () => apiGetPath('/api/v1/accounts/{address}', { address }),
    enabled: address.length > 0,
  });
}

export function useAccountRaw(address: string, enabled: boolean) {
  return useQuery({
    queryKey: ['account', address, 'raw'],
    queryFn: () => apiGetPath('/api/v1/accounts/{address}', { address }, { include: 'raw' }),
    enabled: enabled && address.length > 0,
  });
}

/** Sampled balances. Always 200 (unknown address -> sampled:false), so no not-found branch here. */
export function useAccountBalances(address: string) {
  return useQuery({
    queryKey: ['account', address, 'balances'],
    queryFn: () => apiGetPath('/api/v1/accounts/{address}/balances', { address }),
    enabled: address.length > 0,
  });
}

// ---------- Phase 11a: CoreSlot list + detail + sub-resources ----------

export type CoreSlotDetailResponse = JsonOf<'/api/v1/coreslots/{slotId}'>;
export type CoreSlotEventsResponse = JsonOf<'/api/v1/coreslots/{slotId}/events'>;
export type CoreSlotWindowsResponse = JsonOf<'/api/v1/coreslots/{slotId}/windows'>;
export type CoreSlotKeyRotationsResponse = JsonOf<'/api/v1/coreslots/{slotId}/key-rotations'>;
export type CoreSlotLivenessResponse = JsonOf<'/api/v1/coreslots/{slotId}/liveness'>;
export type CoreSlotHealthResponse = JsonOf<'/api/v1/coreslots/{slotId}/health'>;
export type CoreSlotProposedBlocksResponse = JsonOf<'/api/v1/coreslots/{slotId}/proposed-blocks'>;
export type CoreSlotRewardsResponse = JsonOf<'/api/v1/coreslots/{slotId}/rewards'>;

const enabledSlot = (slotId: string) => slotId.length > 0;

export function useCoreSlotsList() {
  return useInfiniteQuery({
    queryKey: ['coreslots', 'list'],
    queryFn: ({ pageParam }) => apiGet('/api/v1/coreslots', { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
  });
}

export function useCoreSlot(slotId: string) {
  return useQuery({
    queryKey: ['coreslot', slotId],
    queryFn: () => apiGetPath('/api/v1/coreslots/{slotId}', { slotId }),
    enabled: enabledSlot(slotId),
  });
}

export function useCoreSlotRaw(slotId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['coreslot', slotId, 'raw'],
    queryFn: () => apiGetPath('/api/v1/coreslots/{slotId}', { slotId }, { include: 'raw' }),
    enabled: enabled && enabledSlot(slotId),
  });
}

export function useCoreSlotEvents(slotId: string) {
  return useInfiniteQuery({
    queryKey: ['coreslot', slotId, 'events'],
    queryFn: ({ pageParam }) =>
      apiGetPath('/api/v1/coreslots/{slotId}/events', { slotId }, { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    enabled: enabledSlot(slotId),
  });
}

export function useCoreSlotWindows(slotId: string) {
  return useInfiniteQuery({
    queryKey: ['coreslot', slotId, 'windows'],
    queryFn: ({ pageParam }) =>
      apiGetPath('/api/v1/coreslots/{slotId}/windows', { slotId }, { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    enabled: enabledSlot(slotId),
  });
}

export function useCoreSlotKeyRotations(slotId: string) {
  return useInfiniteQuery({
    queryKey: ['coreslot', slotId, 'key-rotations'],
    queryFn: ({ pageParam }) =>
      apiGetPath('/api/v1/coreslots/{slotId}/key-rotations', { slotId }, { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    enabled: enabledSlot(slotId),
  });
}

/** Liveness is a plain array (per windowKind), NOT paginated — useQuery. */
export function useCoreSlotLiveness(slotId: string) {
  return useQuery({
    queryKey: ['coreslot', slotId, 'liveness'],
    queryFn: () => apiGetPath('/api/v1/coreslots/{slotId}/liveness', { slotId }),
    enabled: enabledSlot(slotId),
  });
}

/** Health is a single object — useQuery. */
export function useCoreSlotHealth(slotId: string) {
  return useQuery({
    queryKey: ['coreslot', slotId, 'health'],
    queryFn: () => apiGetPath('/api/v1/coreslots/{slotId}/health', { slotId }),
    enabled: enabledSlot(slotId),
  });
}

export function useCoreSlotProposedBlocks(slotId: string) {
  return useInfiniteQuery({
    queryKey: ['coreslot', slotId, 'proposed-blocks'],
    queryFn: ({ pageParam }) =>
      apiGetPath('/api/v1/coreslots/{slotId}/proposed-blocks', { slotId }, { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    enabled: enabledSlot(slotId),
  });
}

export function useCoreSlotRewards(slotId: string) {
  return useInfiniteQuery({
    queryKey: ['coreslot', slotId, 'rewards'],
    queryFn: ({ pageParam }) =>
      apiGetPath('/api/v1/coreslots/{slotId}/rewards', { slotId }, { limit: LIST_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPageParam,
    enabled: enabledSlot(slotId),
  });
}
