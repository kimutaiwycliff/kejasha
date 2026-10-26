'use client';
import { useQuery } from '@tanstack/react-query';
import type { ComboOption } from '@/components/combo-field';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';

export const shortStayUnitOption = (u: {
  id: string;
  code: string;
  propertyName: string;
  baseNightlyCents: number | null;
}): ComboOption => ({
  value: u.id,
  label: `${u.code} · ${u.propertyName}`,
  hint: u.baseNightlyCents != null ? `${formatKes(u.baseNightlyCents)} / night` : undefined,
});

export function useShortStayUnitOptions(q: string) {
  return useQuery({
    queryKey: ['units', 'options', 'short_stay', q],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/units', {
          params: {
            query: { mode: 'short_stay', status: 'active', limit: 20, ...(q ? { q } : {}) },
          },
        }),
      ).items.map(shortStayUnitOption),
  });
}

export const guestOption = (g: {
  id: string;
  fullName: string;
  phone: string | null;
  stays: number;
}): ComboOption => ({
  value: g.id,
  label: g.fullName,
  hint: [g.phone, g.stays > 0 ? `${g.stays} stay${g.stays === 1 ? '' : 's'}` : null]
    .filter(Boolean)
    .join(' · '),
});

export function useGuestOptions(q: string) {
  return useQuery({
    queryKey: ['guests', 'options', q],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/guests', { params: { query: { limit: 20, ...(q ? { q } : {}) } } }),
      ).items.map(guestOption),
  });
}
