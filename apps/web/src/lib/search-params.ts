/**
 * A Next.js route `searchParams` value is `string | string[] | undefined` (a key can repeat in the
 * URL). Coerce to a single string for a filter — take the first if it repeated. (13b-filters.)
 */
export function oneParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
