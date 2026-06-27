// Extensible operator-identity layer. CoreSlot `metadata` is open-ended `unknown` (live data shows
// `{moniker}` on some slots, null/scalar on others), so this adapter is DEFENSIVE about shape:
// it promotes the fields it knows and preserves everything else as `extras`, so future chain additions
// (website, details, security-contact, …) surface with no rewrite — promote one by adding to KNOWN_KEYS.
import { shortenMiddle } from './format/address';

export type OperatorMetadata = {
  moniker?: string;
  extras: Record<string, unknown>;
};

// Fields promoted to first-class. Add future keys here (one line) to give them dedicated rendering;
// until then they pass through `extras` and render via JsonView.
const KNOWN_KEYS: readonly string[] = ['moniker'];

export function parseOperatorMetadata(metadata: unknown): OperatorMetadata {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return { extras: {} };
  }
  const obj = metadata as Record<string, unknown>;
  const result: OperatorMetadata = { extras: {} };
  const moniker = obj['moniker'];
  if (typeof moniker === 'string' && moniker.length > 0) {
    result.moniker = moniker;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!KNOWN_KEYS.includes(key)) result.extras[key] = value;
  }
  return result;
}

// The operator's display identity: moniker when present, else the shortened operator address.
export function displayName(input: {
  moniker?: string | undefined;
  operatorAddress?: string | null | undefined;
}): string {
  if (input.moniker && input.moniker.length > 0) return input.moniker;
  if (input.operatorAddress) return shortenMiddle(input.operatorAddress, 10, 6);
  return '—';
}
