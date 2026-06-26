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
  return decodeBigIntPart(parseSingle(raw));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function parseSingle(raw: string): string {
  // Buffer.from(_, 'base64url') is lenient (it silently ignores invalid chars and non-canonical
  // padding). Guard the charset, then require a canonical round-trip so garbage like "@@@" or a
  // non-canonical encoding is rejected as invalid_cursor rather than decoded to junk.
  if (!BASE64URL.test(raw)) {
    throw invalidCursor();
  }
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
    throw invalidCursor();
  }
  return decoded;
}

/** Encode an ordered list of key parts as one opaque composite cursor (e.g. height + tx index). */
export function encodeKeyset(parts: Array<string | bigint | number>): string {
  return Buffer.from(parts.map(String).join(':'), 'utf8').toString('base64url');
}

/** Decode a composite cursor into exactly `expectedParts` non-empty string parts, else invalid_cursor. */
export function decodeKeyset(raw: string, expectedParts: number): string[] {
  const parts = parseSingle(raw).split(':');
  if (parts.length !== expectedParts || parts.some((p) => p.length === 0)) {
    throw invalidCursor();
  }
  return parts;
}

/** Parse a single decimal-bigint cursor part, or throw invalid_cursor. */
export function decodeBigIntPart(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw invalidCursor();
  }
  try {
    return BigInt(value);
  } catch {
    throw invalidCursor();
  }
}
