// Keyset (cursor) pagination over block height, newest-first. The cursor is an opaque base64url
// encoding of the last height returned; the next page is `height < decode(cursor)`. Newest-first +
// keyset means new ingestion never shifts an existing cursor window.

import { invalidCursor } from './errors.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** Encode a height as an opaque cursor. */
export function encodeCursor(height: bigint): string {
  return Buffer.from(height.toString(), 'utf8').toString('base64url');
}

/** Decode an opaque cursor back to a non-negative height, or throw invalid_cursor. */
export function decodeCursor(raw: string): bigint {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw invalidCursor();
  }
  if (!/^\d+$/.test(decoded)) {
    throw invalidCursor();
  }
  try {
    return BigInt(decoded);
  } catch {
    throw invalidCursor();
  }
}
