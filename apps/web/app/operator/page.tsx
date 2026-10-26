'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { useState } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { SearchBox } from '@/components/detail';
import { FilterSelect } from '@/components/filter-select';
import { api, unwrap } from '@/lib/api';
import { SUB_STATUS } from '@/lib/billing-labels';
import { formatDate } from '@/lib/format';
import { useDebounced, usePaged } from '@/lib/hooks';

type Org = Schemas['OperatorOrg'];
const STATUSES = [
  { value: '', label: 'Any status' },
  ...Object.entries(SUB_STATUS).map(([value, s]) => ({ value, label: s.label })),
];
const col = columnsFor<Org>();
const columns = [
  col.accessor('name', {
    header: 'Organization',
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="text-xs capitalize text-muted-foreground">
          {c.row.original.kind} · since {formatDate(c.row.original.createdAt.slice(0, 10))}
        </p>
      </div>
    ),
  }),
  col.accessor('status', {
    header: 'Subscription',
    cell: (c) => {
      const s = c.getValue();
      return s ? <Badge variant={SUB_STATUS[s].tone}>{SUB_STATUS[s].label}</Badge> : '—';
    },
  }),
  col.accessor('currentPeriodEnd', {
    header: 'Paid until',
    meta: { hideOnMobile: true },
    cell: (c) => formatDate(c.getValue() ?? c.row.original.trialEndsOn),
  }),
  col.accessor('units', { header: 'Units', meta: { align: 'right' } }),
  col.accessor('members', { header: 'Members', meta: { align: 'right', hideOnMobile: true } }),
];

export default function OperatorOrgsPage() {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [status, setStatus] = useState<Org['status'] & string>();
  const list = usePaged(['operator', 'orgs', query, status], async (cursor) =>
    unwrap(
      await api.GET('/v1/operator/orgs', {
        params: {
          query: {
            cursor,
            limit: 50,
            ...(query ? { q: query } : {}),
            ...(status ? { status } : {}),
          },
        },
      }),
    ),
  );
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Organizations</h1>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name" />
        <FilterSelect label="Status" options={STATUSES} value={status} onChange={setStatus} />
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        isPending={list.isPending}
        error={list.error}
        empty="No organizations."
        rowHref={(o) => `/operator/orgs/${o.id}`}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
    </>
  );
}
