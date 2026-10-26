'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { columnsFor, DataTable } from '@/components/data-table';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { MATCH_STATUS_LABEL, PAYMENT_SOURCE_LABEL } from '@/lib/labels';

type Payment = Schemas['Payment'];
const when = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi',
});
const TONE = { unmatched: 'destructive', matched: 'default', ignored: 'outline' } as const;
const col = columnsFor<Payment>();
const columns = [
  col.accessor('paidAt', {
    header: 'Received',
    cell: (c) => <span className="whitespace-nowrap">{when.format(new Date(c.getValue()))}</span>,
  }),
  col.accessor((p) => p.payerName ?? p.msisdn ?? '—', {
    id: 'payer',
    header: 'From',
    meta: { className: 'whitespace-normal' },
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {c.row.original.providerRef}
          {c.row.original.accountRef && ` · acc ${c.row.original.accountRef}`}
        </p>
      </div>
    ),
  }),
  col.accessor('source', {
    header: 'Via',
    meta: { hideOnMobile: true },
    cell: (c) => PAYMENT_SOURCE_LABEL[c.getValue()],
  }),
  col.accessor((p) => (p.tenantName ? `${p.tenantName} · ${p.unitCode}` : null), {
    id: 'to',
    header: 'Applied to',
    meta: { hideOnMobile: true },
    cell: (c) =>
      c.getValue() ?? (
        <Badge variant={TONE[c.row.original.matchStatus]}>
          {MATCH_STATUS_LABEL[c.row.original.matchStatus]}
        </Badge>
      ),
  }),
  col.accessor('amountCents', {
    header: 'Amount',
    meta: { align: 'right' },
    cell: (c) => formatKes(c.getValue()),
  }),
];

export interface PaymentFilter {
  status?: Payment['matchStatus'];
  source?: Payment['source'];
  leaseId?: string;
}

export function PaymentTable({ filter }: { filter: PaymentFilter }) {
  const list = usePaged(['payments', filter], async (cursor) =>
    unwrap(await api.GET('/v1/payments', { params: { query: { cursor, limit: 50, ...filter } } })),
  );
  return (
    <DataTable
      columns={columns}
      data={list.items}
      isPending={list.isPending}
      empty={filter.status === 'unmatched' ? 'Every payment is matched.' : 'No payments yet.'}
      rowHref={(p) => `/payments/${p.id}`}
      hasMore={list.hasMore}
      loadMore={list.loadMore}
      loadingMore={list.loadingMore}
      error={list.error}
    />
  );
}
