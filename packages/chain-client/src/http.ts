export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface JsonRequestOptions {
  query?: Record<string, string | number | bigint | boolean | undefined> | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: FetchLike | undefined;
}

export class ChainClientError extends Error {
  readonly status: number | undefined;
  readonly path: string;
  readonly url: string;
  readonly bodySnippet: string | undefined;

  constructor(message: string, details: {
    status?: number | undefined;
    path: string;
    url: string;
    bodySnippet?: string | undefined;
  }) {
    super(message);
    this.name = 'ChainClientError';
    this.status = details.status;
    this.path = details.path;
    this.url = details.url;
    this.bodySnippet = details.bodySnippet;
  }
}

export class ChainClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainClientInputError';
  }
}

export async function getJson<T = unknown>(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const url = buildUrl(baseUrl, path, options.query);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      const bodySnippet = (await response.text()).slice(0, 500);
      throw new ChainClientError(
        `Chain request failed with HTTP ${response.status}: ${path}`,
        {
          status: response.status,
          path,
          url: url.toString(),
          bodySnippet,
        },
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ChainClientError) throw error;
    throw new ChainClientError(`Chain request failed: ${path}`, {
      path,
      url: url.toString(),
      bodySnippet: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: JsonRequestOptions['query'],
): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\//, '');
  const url = new URL(normalizedPath, normalizedBase);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value.toString());
  }

  return url;
}
