import { formatAmount } from '@/lib/format/amount';

/**
 * Renders a reward amount as `display symbol` (utwlt -> TWLT via BigInt), with the raw base-denom
 * value preserved in the title (string-safety invariant: no Number()). A null/undefined raw renders
 * the em-dash placeholder. An unknown/empty denom returns the raw verbatim (formatAmount never
 * guesses a conversion).
 */
export function RewardAmount({
  raw,
  denom,
}: {
  raw: string | null | undefined;
  denom: string | null | undefined;
}) {
  if (raw === null || raw === undefined) return <span className="text-text-muted">—</span>;
  const a = formatAmount(raw, denom ?? '');
  // An unknown/empty denom yields an empty symbol+rawDenom; render the bare value without a
  // trailing space in either the visible text or the title.
  const display = a.symbol ? `${a.display} ${a.symbol}` : a.display;
  const title = a.rawDenom ? `${a.raw} ${a.rawDenom}` : a.raw;
  return <span title={title}>{display}</span>;
}
