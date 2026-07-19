/** Minimal typed fetch wrapper for the /api/v1 REST API. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Present on 429 responses: seconds to wait before retrying. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * CSRF token holder. The token comes from register/login/session responses
 * and must accompany every state-changing request as X-CSRF-Token.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function parseError(response: Response): Promise<ApiRequestError> {
  const data = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; retryAfterSeconds?: number };
  } | null;
  return new ApiRequestError(
    response.status,
    data?.error?.code ?? 'UNKNOWN',
    data?.error?.message ?? `Request failed with status ${response.status}`,
    data?.error?.retryAfterSeconds,
  );
}

export async function apiGet<T>(path: string, parse: (data: unknown) => T): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) throw await parseError(response);
  return parse(await response.json());
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  parse: (data: unknown) => T,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      Accept: 'application/json',
      // Content-Type only when a body is present: Fastify rejects an empty
      // JSON body outright.
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    credentials: 'same-origin',
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!response.ok) throw await parseError(response);
  return parse(await response.json());
}
