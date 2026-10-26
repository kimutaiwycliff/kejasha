'use client';
import type { Schemas } from '@kejasha/api-client';
import { columnsFor, DataTable } from '@/components/data-table';
import { api, unwrap } from '@/lib/api';
import { usePaged } from '@/lib/hooks';
import { PROPERTY_KIND_LABEL } from '@/lib/labels';

type Property = Schemas['Property'];
const col = columnsFor<Property>();
const base = [
  col.accessor('name', {
    header: 'Property',
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="text-xs text-muted-foreground">
          {[c.row.original.area, c.row.original.county].filter(Boolean).join(', ')}
        </p>
      </div>
    ),
  }),
  col.accessor('kind', {
    header: 'Type',
    meta: { hideOnMobile: true },
    cell: (c) => PROPERTY_KIND_LABEL[c.getValue()],
  }),
  col.accessor((p) => p.unitCounts.total, {
    id: 'units',
    header: 'Units',
    meta: { align: 'right' },
    cell: (c) => {
      const u = c.row.original.unitCounts;
      return u.shortStay > 0 && u.longTerm > 0 ? `${u.total} (${u.shortStay} short-stay)` : u.total;
    },
  }),
];
const landlordCol = col.accessor('clientLandlordName', {
  header: 'Landlord',
  meta: { hideOnMobile: true },
});

export function PropertyTable({
  q,
  clientLandlordId,
  showLandlord,
}: {
  q?: string;
  clientLandlordId?: string;
  showLandlord?: boolean;
}) {
  const list = usePaged(['properties', { q, clientLandlordId }], async (cursor) =>
    unwrap(
      await api.GET('/v1/properties', {
        params: {
          query: {
            cursor,
            limit: 50,
            ...(q ? { q } : {}),
            ...(clientLandlordId ? { clientLandlordId } : {}),
          },
        },
      }),
    ),
  );
  const columns = showLandlord ? [base[0]!, landlordCol, ...base.slice(1)] : base;
  return (
    <DataTable
      columns={columns}
      data={list.items}
      isPending={list.isPending}
      empty={q ? 'No properties match.' : 'No properties yet.'}
      rowHref={(p) => `/properties/${p.id}`}
      hasMore={list.hasMore}
      loadMore={list.loadMore}
      loadingMore={list.loadingMore}
      error={list.error}
    />
  );
}
