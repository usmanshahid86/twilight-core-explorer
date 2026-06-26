const PLACEHOLDER = '—';

/** Shorten a long hash/address for display, keeping head and tail. Full value stays copyable. */
export function shortenMiddle(s: string | null | undefined, head = 10, tail = 6): string {
  if (s === null || s === undefined || s === '') return PLACEHOLDER;
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
