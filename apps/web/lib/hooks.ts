'use client';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, writeHeaders } from './api';
import { activeRole, atLeast, useMe, type Role } from './session';

/** A cursor-paginated list (`{ items, nextCursor }`), loaded page by page. */
export function usePaged<T>(
  key: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  enabled = true,
) {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  return {
    items: q.data?.pages.flatMap((p) => p.items) ?? [],
    isPending: q.isPending && enabled,
    hasMore: q.hasNextPage,
    loadMore: () => void q.fetchNextPage(),
    loadingMore: q.isFetchingNextPage,
    error: q.error,
  };
}

/** Every page of a cursor list (for small sets such as one property's units). */
export async function fetchAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

/** The message to show for a failed query. */
export function errorMessage(e: unknown) {
  return e instanceof ApiError
    ? (e.problem.detail ?? e.problem.title)
    : 'Something went wrong. Check your connection and try again.';
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Whether the signed-in member's role allows an action (the API enforces it regardless). */
export function useCan(min: Role) {
  const { data: me } = useMe();
  return atLeast(activeRole(me), min);
}

export function useOrgKind() {
  const { data: me } = useMe();
  return me?.activeOrg?.kind ?? null;
}

/**
 * A write with one Idempotency-Key per user intent. Refreshes the given query keys (by prefix)
 * and toasts on success. Errors are rethrown so forms can map them onto fields.
 */
export function useWrite<A, R>(
  fn: (args: A, headers: { 'Idempotency-Key': string }) => Promise<R>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: R) => string) } = {},
) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (args: A) => fn(args, writeHeaders()),
    onSuccess: async (r) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
    },
  });
  return { run: m.mutateAsync, pending: m.isPending };
}

/** Toast an action's failure (for buttons; forms use `applyProblem`). */
export function toastError(e: unknown) {
  if (e instanceof ApiError && e.status === 402) return; // announced by the query client
  toast.error(errorMessage(e));
}
