// Amount formatting via BigInt only — never Number() (amounts are int64-scale). The raw base-denom
// value is always preserved alongside the human display, so callers can show both.
import { groupDigits } from './height';

type DenomMeta = { symbol: string; decimals: bigint };

// Native denom is utwlt (micro-TWLT): 1 TWLT = 1_000_000 utwlt.
const DENOM_DISPLAY: Record<string, DenomMeta> = {
  utwlt: { symbol: 'TWLT', decimals: 6n },
};

export type FormattedAmount = {
  /** Human display in the display denom, e.g. "1,000,000". */
  display: string;
  /** Display denom symbol, e.g. "TWLT" (or the raw denom when unknown). */
  symbol: string;
  /** Untouched base-denom amount, e.g. "1000000000000". */
  raw: string;
  /** Untouched base denom, e.g. "utwlt". */
  rawDenom: string;
};

export function formatAmount(raw: string, denom: string): FormattedAmount {
  const meta = DENOM_DISPLAY[denom];
  // Unknown denom or non-numeric amount: present verbatim, never guess a conversion.
  if (meta === undefined || !/^\d+$/.test(raw)) {
    return { display: raw, symbol: denom, raw, rawDenom: denom };
  }
  const value = BigInt(raw);
  const base = 10n ** meta.decimals;
  const whole = (value / base).toString();
  const fracStr = (value % base).toString().padStart(Number(meta.decimals), '0').replace(/0+$/, '');
  const display = fracStr ? `${groupDigits(whole)}.${fracStr}` : groupDigits(whole);
  return { display, symbol: meta.symbol, raw, rawDenom: denom };
}
