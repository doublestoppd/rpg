/** Minimal typed fetch wrapper for the /api/v1 REST API. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiGet<T>(path: string, parse: (data: unknown) => T): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(response.status, `Request failed with status ${response.status}`);
  }
  return parse(data);
}
