// Basis points are small bounded integers from the API (NOT heights/amounts/ids), so Number math
// is safe here. 10000 bps = 100%.
const PLACEHOLDER = '—';

export function bpsToPercent(bps: number | null | undefined, fractionDigits = 2): string {
  if (bps === null || bps === undefined) return PLACEHOLDER;
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}
