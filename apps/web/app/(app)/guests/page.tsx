'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { SearchBox } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { GuestDialog } from '@/components/shortstay/guest-dialog';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useDebounced, usePaged } from '@/lib/hooks';

type Guest = Schemas['Guest'];
const col = columnsFor<Guest>();
const columns = [
  col.accessor('fullName', {
    header: 'Guest',
    cell: (c) => (
      <span className="font-medium">
        {c.getValue()} {c.row.original.stays > 1 && <Badge variant="secondary">Returning</Badge>}
      </span>
    ),
  }),
  col.accessor('phone', {
    header: 'Phone',
    enableSorting: false,
    cell: (c) => c.getValue() ?? '—',
  }),
  col.accessor('stays', { header: 'Stays', meta: { align: 'right' } }),
  col.accessor('lastStayOn', {
    header: 'Last stay',
    meta: { hideOnMobile: true },
    cell: (c) => formatDate(c.getValue()),
  }),
];

export default function GuestsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const list = usePaged(['guests', query], async (cursor) =>
    unwrap(
      await api.GET('/v1/guests', {
        params: { query: { cursor, limit: 50, ...(query ? { q: query } : {}) } },
      }),
    ),
  );
  return (
    <>
      <PageHeader
        title="Guests"
        description="Everyone who has stayed, so returning guests are recognised."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New guest
          </Button>
        }
      />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or phone" />
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        isPending={list.isPending}
        error={list.error}
        empty={query ? 'No guests match.' : 'No guests yet.'}
        rowHref={(g) => `/guests/${g.id}`}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
      <GuestDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(g) => router.push(`/guests/${g.id}`)}
      />
    </>
  );
}
