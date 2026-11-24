'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type RentRollItem = {
  unitId: string;
  unitCode: string;
  propertyName: string;
  status: 'occupied' | 'vacant';
  tenantName: string | null;
  rentCents: number;
  balanceCents: number;
  leaseEnd: string | null;
};

/**
 * Today's rent roll (long-term units: occupied or vacant, tenant, balance). Roles that may not
 * read it (caretakers) get an empty list rather than an error: the map still shows properties.
 */
export function useRentRoll(propertyId?: string) {
  return useQuery({
    queryKey: ['rent-roll', 'today', propertyId ?? 'all'],
    queryFn: async (): Promise<RentRollItem[]> => {
      const r = await api.GET('/v1/reports/rent-roll', {
        params: { query: propertyId ? { propertyId } : {} },
      });
      return r.data?.items ?? [];
    },
    staleTime: 30_000,
  });
}
