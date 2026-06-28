// Server-safe (no 'use client') home for the list-filter status enums + ingress coercion. Kept out of
// StatusFilter.tsx so the server route pages can import the valid-value lists + coerceStatus without
// pulling in a client component.

export type StatusOption = { value: string; label: string };

// Option `value`s MUST equal the stored enum exactly — the API status filter is a case-sensitive exact
// match (Postgres `WHERE status = $1`). CoreSlot status is written UPPERCASE by the indexer
// (`statusFromEventType` / genesis `normalizeStatus`); tx status is lowercase (`mapper.ts`).
export const CORESLOT_STATUS_OPTIONS: StatusOption[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REMOVED', label: 'Removed' },
];

export const TX_STATUS_OPTIONS: StatusOption[] = [
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];

// Coerce a raw URL `?status=` value (untrusted — bookmarks, hand-edited URLs, stale links) to the
// canonical stored enum value, matched case-insensitively. Unknown values become `undefined` (= no
// filter / "All"). This is the trust boundary: only canonical values ever reach the API exact-match,
// so a lowercase `?status=active` is normalized to `ACTIVE` rather than silently returning zero rows.
export function coerceStatus(
  raw: string | undefined,
  options: StatusOption[],
): string | undefined {
  if (!raw) return undefined;
  const match = options.find((o) => o.value.toLowerCase() === raw.toLowerCase());
  return match?.value;
}
