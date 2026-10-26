'use client';
import type { Schemas } from '@kejasha/api-client';
import { Button } from '@kejasha/ui/components/button';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { SearchBox } from '@/components/detail';
import { TenantDialog } from '@/components/leasing/tenant-dialog';
import { PageHeader } from '@/components/page-header';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { useCan, useDebounced, usePaged } from '@/lib/hooks';

type Tenant = Schemas['Tenant'];
const col = columnsFor<Tenant>();
const columns = [
  col.accessor('fullName', {
    header: 'Name',
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  col.accessor('phone', {
    header: 'Phone',
    enableSorting: false,
    cell: (c) => c.getValue() ?? '—',
  }),
  col.accessor('activeLeaseCount', {
    header: 'Leases',
    meta: { align: 'right', hideOnMobile: true },
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

export default function TenantsPage() {
  const router = useRouter();
  const canAdd = useCan('agent');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const list = usePaged(['tenants', query], async (cursor) =>
    unwrap(
      await api.GET('/v1/tenants', {
        params: { query: { cursor, limit: 50, ...(query ? { q: query } : {}) } },
      }),
    ),
  );
  return (
    <>
      <PageHeader
        title="Tenants"
        description="People renting your long-term units, with what they owe."
        actions={
          canAdd && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New tenant
            </Button>
          )
        }
      />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name, phone or ID" />
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        isPending={list.isPending}
        empty={query ? 'No tenants match.' : 'No tenants yet.'}
        rowHref={(t) => `/tenants/${t.id}`}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        loadingMore={list.loadingMore}
        error={list.error}
      />
      <TenantDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(t) => router.push(`/tenants/${t.id}`)}
      />
    </>
  );
}
