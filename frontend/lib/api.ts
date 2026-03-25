const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

export function formatPkr(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)} PKR`;
}

/** Normalize API error JSON into a single user-facing string. */
export function formatApiErrorMessage(body: Record<string, unknown>, fallbackStatus?: number): string {
  if (body.error === 'Over budget' || (body.available_budget != null && body.requested_amount != null)) {
    const req = Number(body.requested_amount);
    const av = Number(body.available_budget);
    if (Number.isFinite(req) && Number.isFinite(av)) {
      return `Requested amount (${formatPkr(req)}) exceeds available budget (${formatPkr(av)})`;
    }
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (fallbackStatus != null) return `Request failed (${fallbackStatus})`;
  return 'Request failed';
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(formatApiErrorMessage(body, status));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function authedFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${backendBase}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      const json = await res.json();
      if (json && typeof json === 'object' && !Array.isArray(json)) body = json as Record<string, unknown>;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}
