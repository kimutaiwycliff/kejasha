'use client';
import type { Schemas } from '@kejasha/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap, writeHeaders } from './api';

export type Me = Schemas['Me'];
export type Role = Schemas['Role'];

/** The signed-in user, their memberships and active org; `null` when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return unwrap(await api.GET('/v1/identity/me'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function activeRole(me: Me | null | undefined): Role | null {
  return me?.activeOrg?.role ?? null;
}

const RANK: Record<Role, number> = { owner: 4, manager: 3, agent: 2, caretaker: 1, viewer: 0 };
export function atLeast(role: Role | null, min: Role) {
  return role !== null && RANK[role] >= RANK[min];
}

/** Switch the active organization and refetch everything (all data is org-scoped). */
export function useSwitchOrg() {
  const qc = useQueryClient();
  return async (orgId: string) => {
    unwrap(await api.POST('/v1/identity/active-org', { body: { orgId }, headers: writeHeaders() }));
    await qc.resetQueries();
  };
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api.POST('/v1/identity/sign-out', { headers: writeHeaders() });
    qc.clear();
    window.location.assign('/sign-in');
  };
}
