// Operator identity resolver. There is NO /operator endpoint: an address is resolved to its CoreSlot
// via the /coreslots filters, in fixed fallback order operator -> consensus -> payout, STOPPING at the
// first non-empty result. One operator owns exactly one CoreSlot (chain rule), so the expected result
// is 0 or 1 slot; >1 is a surfaced anomaly upstream. Pure + dependency-injected for unit testing.
import { apiGet } from './api/client';
import type { CoreSlotsResponse } from './api/queries';

export type OperatorRole = 'operator' | 'consensus' | 'payout';
export type CoreSlotSummary = CoreSlotsResponse['data'][number];
export type OperatorResolution = { matchedRole: OperatorRole | null; slots: CoreSlotSummary[] };

// Only call the resolver makes; injectable so tests need no network/React.
type CoreSlotsGetter = (
  path: '/api/v1/coreslots',
  query: Record<string, string | number | boolean | undefined>,
) => Promise<CoreSlotsResponse>;

const ROLE_FILTERS: ReadonlyArray<readonly [OperatorRole, string]> = [
  ['operator', 'operatorAddress'],
  ['consensus', 'consensusAddress'],
  ['payout', 'payoutAddress'],
];

const RESOLVE_LIMIT = 100;

// Empty results are DATA (drive the 0-match state); a thrown ApiError propagates (caller branches on
// error.code). The two are never conflated.
export async function resolveOperator(
  address: string,
  get: CoreSlotsGetter = apiGet,
): Promise<OperatorResolution> {
  for (const [role, filterKey] of ROLE_FILTERS) {
    const res = await get('/api/v1/coreslots', { [filterKey]: address, limit: RESOLVE_LIMIT });
    if (res.data.length > 0) {
      return { matchedRole: role, slots: res.data };
    }
  }
  return { matchedRole: null, slots: [] };
}
