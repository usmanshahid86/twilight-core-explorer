// Height/id formatting that NEVER converts to Number (int64-safe). Inputs are decimal strings.
const PLACEHOLDER = '—';

export function isDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

/** Group a decimal digit-string with thousands separators using string ops only. */
export function groupDigits(s: string, sep = ','): string {
  if (!isDigits(s)) return s;
  const trimmed = s.replace(/^0+(?=\d)/, '');
  const chars = [...trimmed];
  let out = '';
  chars.forEach((ch, i) => {
    if (i > 0 && (chars.length - i) % 3 === 0) out += sep;
    out += ch;
  });
  return out;
}

export function formatHeight(h: string | null | undefined): string {
  if (h === null || h === undefined || h === '') return PLACEHOLDER;
  return groupDigits(h);
}
