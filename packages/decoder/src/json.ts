export function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonSafe(item))
      .filter((item) => item !== undefined);
  }
  if (isLongLike(value)) return value.toString();

  const object: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const safe = toJsonSafe(item);
    if (safe !== undefined) object[key] = safe;
  }
  return object;
}

function isLongLike(value: object): value is { toString(): string } {
  const record = value as Record<string, unknown>;
  return (
    typeof record.low === 'number' &&
    typeof record.high === 'number' &&
    typeof record.unsigned === 'boolean' &&
    typeof record.toString === 'function'
  );
}
