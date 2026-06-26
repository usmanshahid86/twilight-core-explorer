// Keyset pagination helpers. Cursors are OPAQUE strings produced by the API; the web never
// parses or synthesizes them. `nextCursor: null` means end-of-list.
export type Page = { limit: number; nextCursor: string | null };
export type ListEnvelope<T> = { data: T[]; page: Page };

/** For TanStack `useInfiniteQuery`: undefined stops fetching, otherwise pass the opaque cursor. */
export function nextPageParam<T>(last: ListEnvelope<T>): string | undefined {
  return last.page.nextCursor ?? undefined;
}

/** Whether another page exists. */
export function hasMore(page: Page): boolean {
  return page.nextCursor !== null;
}
