'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { columnsFor, DataTable } from '@/components/data-table';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { INVOICE_KIND_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/labels';

type Invoice = Schemas['Invoice'];
const TONE = {
  unpaid: 'destructive',
  partially_paid: 'secondary',
  paid: 'default',
  void: 'outline',
} as const;
const col = columnsFor<Invoice>();
const columns = [
  col.accessor('number', {
    header: 'Invoice',
    cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
  }),
  col.accessor((i) => `${i.tenantName} · ${i.unitCode}`, {
    id: 'tenant',
    header: 'Tenant',
    meta: { className: 'whitespace-normal' },
  }),
  col.accessor('kind', {
    header: 'Type',
    meta: { hideOnMobile: true },
    cell: (c) => INVOICE_KIND_LABEL[c.getValue()],
  }),
  col.accessor('dueOn', {
    header: 'Due',
    meta: { hideOnMobile: true },
    cell: (c) => formatDate(c.getValue()),
  }),
  col.accessor('totalCents', {
    header: 'Total',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  col.accessor('outstandingCents', {
    header: 'Due now',
    meta: { align: 'right' },
    cell: (c) => formatKes(c.getValue()),
  }),
  col.accessor('paymentStatus', {
    header: 'Status',
    cell: (c) => <Badge variant={TONE[c.getValue()]}>{PAYMENT_STATUS_LABEL[c.getValue()]}</Badge>,
  }),
];

export interface InvoiceFilter {
  leaseId?: string;
  kind?: Invoice['kind'];
  period?: string;
  includeVoid?: 'true' | 'false';
}

export function InvoiceTable({
  filter,
  hideTenant,
}: {
  filter: InvoiceFilter;
  hideTenant?: boolean;
}) {
  const list = usePaged(['invoices', filter], async (cursor) =>
    unwrap(await api.GET('/v1/invoices', { params: { query: { cursor, limit: 50, ...filter } } })),
  );
  return (
    <DataTable
      columns={hideTenant ? columns.filter((c) => c.id !== 'tenant') : columns}
      data={list.items}
      isPending={list.isPending}
      empty="No invoices."
      rowHref={(i) => `/invoices/${i.id}`}
      hasMore={list.hasMore}
      loadMore={list.loadMore}
      loadingMore={list.loadingMore}
      error={list.error}
    />
  );
}
