'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { columnsFor, DataTable } from '@/components/data-table';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { MODE_LABEL } from '@/lib/labels';

type Unit = Schemas['Unit'];
const col = columnsFor<Unit>();
const columns = [
  col.accessor('code', {
    header: 'Unit',
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        {c.row.original.label && (
          <p className="text-xs text-muted-foreground">{c.row.original.label}</p>
        )}
      </div>
    ),
  }),
  col.accessor('propertyName', {
    id: 'propertyName',
    header: 'Property',
    meta: { hideOnMobile: true },
  }),
  col.accessor('mode', {
    header: 'Letting',
    cell: (c) => (
      <span className="flex items-center gap-2">
        {MODE_LABEL[c.getValue()]}
        {c.row.original.status === 'inactive' && <Badge variant="secondary">Inactive</Badge>}
      </span>
    ),
  }),
  col.accessor('bedrooms', {
    header: 'Beds',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => c.getValue() ?? '—',
  }),
  col.accessor((u) => (u.mode === 'short_stay' ? u.baseNightlyCents : u.rentCents), {
    id: 'price',
    header: 'Price',
    meta: { align: 'right' },
    cell: (c) =>
      `${formatKes(c.getValue())}${c.row.original.mode === 'short_stay' ? ' / night' : ' / month'}`,
  }),
];

export interface UnitFilter {
  propertyId?: string;
  mode?: Unit['mode'];
  q?: string;
}

export function UnitTable({
  filter,
  hideProperty,
}: {
  filter: UnitFilter;
  hideProperty?: boolean;
}) {
  const list = usePaged(['units', filter], async (cursor) =>
    unwrap(
      await api.GET('/v1/units', {
        params: {
          query: {
            cursor,
            limit: 100,
            ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
            ...(filter.mode ? { mode: filter.mode } : {}),
            ...(filter.q ? { q: filter.q } : {}),
          },
        },
      }),
    ),
  );
  return (
    <DataTable
      columns={hideProperty ? columns.filter((c) => c.id !== 'propertyName') : columns}
      data={list.items}
      isPending={list.isPending}
      empty={filter.q || filter.mode ? 'No units match.' : 'No units yet.'}
      rowHref={(u) => `/units/${u.id}`}
      hasMore={list.hasMore}
      loadMore={list.loadMore}
      loadingMore={list.loadingMore}
      error={list.error}
    />
  );
}
