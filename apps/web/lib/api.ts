import { createApiClient, newIdempotencyKey, type Schemas } from '@kejasha/api-client';

/**
 * The API base URL comes from configuration, never a literal domain (ADR-016). In production the
 * web and API share the parent domain, so the session cookie travels with `credentials: include`.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const api = createApiClient(API_URL, { credentials: 'include' });

export type Problem = Schemas['ProblemDetails'];

/** A problem+json response, thrown so TanStack Query and forms can handle it uniformly. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get code() {
    return this.problem.code;
  }
}

/** Unwrap an openapi-fetch result: data on success, `ApiError` otherwise. */
export function unwrap<T>(r: { data?: T; error?: unknown; response: Response }): T {
  if (r.error !== undefined || !r.response.ok) {
    const p = (r.error ?? {}) as Partial<Problem>;
    throw new ApiError(r.response.status, {
      type: p.type ?? 'about:blank',
      title: p.title ?? (r.response.statusText || 'Request failed'),
      status: r.response.status,
      code: p.code ?? 'request_failed',
      ...(p.detail ? { detail: p.detail } : {}),
      ...(p.errors ? { errors: p.errors } : {}),
      ...(p.requestId ? { requestId: p.requestId } : {}),
    });
  }
  return r.data as T;
}

/** Headers for a write: one Idempotency-Key per user intent (retries reuse it). */
export function writeHeaders(key = newIdempotencyKey()) {
  return { 'Idempotency-Key': key };
}
