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
import { LandlordDialog } from '@/components/portfolio/landlord-dialog';
import { api, unwrap } from '@/lib/api';
import { useCan, useDebounced, usePaged } from '@/lib/hooks';
import { feeLabel } from '@/lib/labels';

type Landlord = Schemas['ClientLandlord'];
const col = columnsFor<Landlord>();
const columns = [
  col.accessor('name', {
    header: 'Name',
    cell: (c) => (
      <span className="font-medium">
        {c.getValue()} {c.row.original.isSelf && <Badge variant="secondary">Your agency</Badge>}
      </span>
    ),
  }),
  col.accessor('phone', {
    header: 'Phone',
    meta: { hideOnMobile: true },
    cell: (c) => c.getValue() ?? '—',
    enableSorting: false,
  }),
  col.display({ id: 'fee', header: 'Management fee', cell: (c) => feeLabel(c.row.original) }),
  col.accessor('propertyCount', { header: 'Properties', meta: { align: 'right' } }),
];

export default function LandlordsPage() {
  const router = useRouter();
  const canEdit = useCan('manager');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const list = usePaged(['client-landlords', query], async (cursor) =>
    unwrap(
      await api.GET('/v1/client-landlords', {
        params: { query: { cursor, limit: 50, ...(query ? { q: query } : {}) } },
      }),
    ),
  );
  return (
    <>
      <PageHeader
        title="Landlords"
        description="Owners whose properties you manage, with their management fee."
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New landlord
            </Button>
          )
        }
      />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search landlords" />
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        isPending={list.isPending}
        empty={query ? 'No landlords match.' : 'No landlords yet.'}
        rowHref={(l) => `/landlords/${l.id}`}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        loadingMore={list.loadingMore}
        error={list.error}
      />
      <LandlordDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(l) => router.push(`/landlords/${l.id}`)}
      />
    </>
  );
}
