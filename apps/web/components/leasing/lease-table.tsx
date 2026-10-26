'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { columnsFor, DataTable } from '@/components/data-table';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { LEASE_STATUS_LABEL } from '@/lib/labels';

type Lease = Schemas['Lease'];
const col = columnsFor<Lease>();
const columns = [
  col.accessor('tenantName', {
    id: 'tenant',
    header: 'Tenant',
    meta: { className: 'whitespace-normal' },
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  col.accessor((l) => `${l.unitCode} · ${l.propertyName}`, { id: 'unit', header: 'Unit' }),
  col.accessor('startDate', {
    header: 'Term',
    meta: { hideOnMobile: true },
    cell: (c) =>
      `${formatDate(c.getValue())} – ${c.row.original.endDate ? formatDate(c.row.original.endDate) : 'open'}`,
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (c) => (
      <Badge variant={c.getValue() === 'active' ? 'default' : 'secondary'}>
        {LEASE_STATUS_LABEL[c.getValue()]}
      </Badge>
    ),
  }),
  col.accessor('currentRentCents', {
    header: 'Rent',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  col.accessor('balanceCents', {
    header: 'Balance',
    meta: { align: 'right' },
    cell: (c) => (
      <span className={c.getValue() > 0 ? 'text-destructive' : undefined}>
        {formatKes(c.getValue())}
      </span>
    ),
  }),
];

export interface LeaseFilter {
  status?: Lease['status'];
  propertyId?: string;
  tenantId?: string;
  unitId?: string;
}

export function LeaseTable({
  filter,
  hide = [],
}: {
  filter: LeaseFilter;
  hide?: ('tenant' | 'unit')[];
}) {
  const list = usePaged(['leases', filter], async (cursor) =>
    unwrap(await api.GET('/v1/leases', { params: { query: { cursor, limit: 50, ...filter } } })),
  );
  return (
    <DataTable
      columns={columns.filter((c) => !hide.includes(c.id as 'tenant' | 'unit'))}
      data={list.items}
      isPending={list.isPending}
      empty="No leases."
      rowHref={(l) => `/leases/${l.id}`}
      hasMore={list.hasMore}
      loadMore={list.loadMore}
      loadingMore={list.loadingMore}
      error={list.error}
    />
  );
}
