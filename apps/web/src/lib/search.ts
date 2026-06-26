// Helpers for the typed /api/v1/search result union. The web invents NO search semantics — it only
// maps each typed reference the API returns to its route + label.
import type { SearchResponse } from './api/queries';

export type SearchResult = SearchResponse['data'][number];

export function searchResultHref(result: SearchResult): string {
  switch (result.type) {
    case 'block':
      return `/blocks/${encodeURIComponent(result.height)}`;
    case 'transaction':
      return `/txs/${encodeURIComponent(result.hash)}`;
    case 'account':
      return `/accounts/${encodeURIComponent(result.address)}`;
    case 'coreslot':
      return `/coreslots/${encodeURIComponent(result.slotId)}`;
  }
}

export function searchResultKindLabel(result: SearchResult): string {
  switch (result.type) {
    case 'block':
      return 'Block';
    case 'transaction':
      return 'Transaction';
    case 'account':
      return 'Account';
    case 'coreslot':
      return result.role ? `CoreSlot (${result.role})` : 'CoreSlot';
  }
}

export function searchResultPrimary(result: SearchResult): string {
  switch (result.type) {
    case 'block':
      return result.height;
    case 'transaction':
      return result.hash;
    case 'account':
      return result.address;
    case 'coreslot':
      return result.slotId;
  }
}
