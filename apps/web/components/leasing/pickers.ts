'use client';
import { useQuery } from '@tanstack/react-query';
import type { ComboOption } from '@/components/combo-field';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';

/** Long-term units matching `q`, for lease creation. */
export function useUnitOptions(q: string) {
  return useQuery({
    queryKey: ['units', 'options', 'long_term', q],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/units', {
          params: {
            query: { mode: 'long_term', status: 'active', limit: 20, ...(q ? { q } : {}) },
          },
        }),
      ).items.map(unitOption),
  });
}

export const unitOption = (u: {
  id: string;
  code: string;
  propertyName: string;
  rentCents: number | null;
}): ComboOption => ({
  value: u.id,
  label: `${u.code} · ${u.propertyName}`,
  hint: u.rentCents != null ? `${formatKes(u.rentCents)} / month` : undefined,
});

export function useTenantOptions(q: string) {
  return useQuery({
    queryKey: ['tenants', 'options', q],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/tenants', { params: { query: { limit: 20, ...(q ? { q } : {}) } } }),
      ).items.map(tenantOption),
  });
}

export const tenantOption = (t: {
  id: string;
  fullName: string;
  phone: string | null;
}): ComboOption => ({
  value: t.id,
  label: t.fullName,
  hint: t.phone ?? undefined,
});
