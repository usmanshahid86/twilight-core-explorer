import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

const PLACEHOLDER = '—';

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return PLACEHOLDER;
  try {
    return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
  } catch {
    return iso;
  }
}

export function formatAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return PLACEHOLDER;
  try {
    return format(parseISO(iso), 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return iso;
  }
}
