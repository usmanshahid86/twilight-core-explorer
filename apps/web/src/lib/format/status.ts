// Map a verbatim status/risk string to a badge tone WITHOUT replacing the label. The raw API
// status string is always what gets displayed; the tone is purely presentational.
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const SUCCESS = ['healthy', 'active', 'ok', 'up', 'synced', 'live', 'available', 'none', 'low'];
const WARNING = ['degraded', 'warning', 'lagging', 'stale', 'incomplete', 'partial', 'medium'];
const DANGER = [
  'down',
  'failed',
  'failing',
  'unavailable',
  'critical',
  'error',
  'halt',
  'halted',
  'high',
];
const NEUTRAL = ['unknown', 'pending', 'inactive', 'removed', 'n/a'];

export function statusTone(status: string | null | undefined): BadgeTone {
  const s = (status ?? '').toLowerCase().trim();
  if (SUCCESS.includes(s)) return 'success';
  if (WARNING.includes(s)) return 'warning';
  if (DANGER.includes(s)) return 'danger';
  if (NEUTRAL.includes(s)) return 'neutral';
  return 'info';
}
