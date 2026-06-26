// Standardized response envelopes. Every endpoint uses { data } so the web app has one mental model:
//   list   -> { data: [...], page: { limit, nextCursor } }
//   detail -> { data: {...} }
//   error  -> { error: { code, message, details? } }   (see lib/errors.ts)

export interface PageInfo {
  limit: number;
  nextCursor: string | null;
}

export function ok<T>(data: T): { data: T } {
  return { data };
}

export function paginated<T>(data: T[], page: PageInfo): { data: T[]; page: PageInfo } {
  return { data, page };
}
