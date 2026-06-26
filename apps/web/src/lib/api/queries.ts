// Typed TanStack Query hooks. All data fetching is client-side (client-leaning posture):
// no RSC server-fetching, no route-segment caching, no server actions.
import { useQuery } from '@tanstack/react-query';
import { apiGet, type JsonOf } from './client';

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

export function useValidatorSet() {
  return useQuery({
    queryKey: ['validator-set'],
    queryFn: () => apiGet('/api/v1/network/validator-set'),
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
