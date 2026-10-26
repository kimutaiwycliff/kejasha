'use client';
import { useQuery } from '@tanstack/react-query';
import type { ComboOption } from '@/components/combo-field';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { fetchAll } from '@/lib/hooks';

/**
 * Active leases for allocation and payment requests. The API has no text search on leases, so
 * the list is loaded once (a page of 100 at a time) and filtered by tenant or unit here.
 */
export function useActiveLeaseOptions(q: string) {
  const all = useQuery({
    queryKey: ['leases', 'options', 'active'],
    queryFn: () =>
      fetchAll(async (cursor) =>
        unwrap(
          await api.GET('/v1/leases', {
            params: { query: { status: 'active', cursor, limit: 100 } },
          }),
        ),
      ),
    staleTime: 60_000,
  });
  const needle = q.toLowerCase();
  const data = all.data
    ?.filter(
      (l) =>
        !needle || `${l.tenantName} ${l.unitCode} ${l.propertyName}`.toLowerCase().includes(needle),
    )
    .slice(0, 30)
    .map((l): ComboOption => ({
      value: l.id,
      label: `${l.tenantName} · ${l.unitCode}`,
      hint: `${l.propertyName} · balance ${formatKes(l.balanceCents)}`,
    }));
  return { data, isPending: all.isPending };
}
