// Serialization helpers. The single hard rule for this API: a BigInt is NEVER emitted as a JSON
// number (precision loss + inconsistency). Heights/ids are converted to strings here, at the mapper
// boundary, BEFORE they reach the response schema (which declares them as strings).

export function bigToString(value: bigint | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

export function toIso(value: Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toISOString();
}

/** Whole seconds between `from` (default now) and a past timestamp; null if absent. */
export function ageSeconds(value: Date | null | undefined, from: number = Date.now()): number | null {
  if (value === null || value === undefined) return null;
  return Math.max(0, Math.floor((from - value.getTime()) / 1000));
}
