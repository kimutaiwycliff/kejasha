'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { columnsFor, DataTable } from '@/components/data-table';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { BOOKING_SOURCE_LABEL, BOOKING_STATUS_LABEL } from '@/lib/labels';

type Booking = Schemas['Booking'];
export const BOOKING_TONE = {
  confirmed: 'default',
  checked_in: 'default',
  checked_out: 'secondary',
  cancelled: 'outline',
  no_show: 'destructive',
} as const;
const col = columnsFor<Booking>();
const columns = [
  col.accessor('checkIn', {
    header: 'Stay',
    cell: (c) => (
      <div className="whitespace-nowrap">
        <p>
          {formatDate(c.getValue())} → {formatDate(c.row.original.checkOut)}
        </p>
        <p className="text-xs text-muted-foreground">
          {c.row.original.nights} night{c.row.original.nights === 1 ? '' : 's'}
        </p>
      </div>
    ),
  }),
  col.accessor((b) => b.guestName ?? '—', {
    id: 'guest',
    header: 'Guest',
    meta: { className: 'whitespace-normal' },
    cell: (c) => (
      <div>
        <p className="font-medium">
          {c.getValue()}{' '}
          {c.row.original.isRepeatGuest && <Badge variant="secondary">Returning</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {c.row.original.unitCode} · {BOOKING_SOURCE_LABEL[c.row.original.source]}
        </p>
      </div>
    ),
  }),
  col.accessor('status', {
    header: 'Status',
    meta: { hideOnMobile: true },
    cell: (c) => (
      <Badge variant={BOOKING_TONE[c.getValue()]}>{BOOKING_STATUS_LABEL[c.getValue()]}</Badge>
    ),
  }),
  col.accessor('netCents', {
    header: 'Net',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  col.accessor('balanceCents', {
    header: 'Balance',
    meta: { align: 'right' },
    cell: (c) =>
      c.getValue() > 0 ? <span className="text-destructive">{formatKes(c.getValue())}</span> : '—',
  }),
];

export interface BookingFilter {
  unitId?: string;
  from?: string;
  to?: string;
  status?: Booking['status'];
  source?: Booking['source'];
}

export function BookingTable({ filter }: { filter: BookingFilter }) {
  const list = usePaged(['bookings', filter], async (cursor) =>
    unwrap(await api.GET('/v1/bookings', { params: { query: { cursor, limit: 50, ...filter } } })),
  );
  return (
    <DataTable
      columns={columns}
      data={list.items}
      isPending={list.isPending}
      error={list.error}
      empty="No bookings."
      rowHref={(b) => `/bookings/${b.id}`}
      hasMore={list.hasMore}
      loadMore={list.loadMore}
      loadingMore={list.loadingMore}
    />
  );
}
