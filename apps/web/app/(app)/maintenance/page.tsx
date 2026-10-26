'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { FilterSelect } from '@/components/filter-select';
import {
  NewTicketDialog,
  PRIORITY_TONE,
  STATUS_TONE,
} from '@/components/maintenance/ticket-dialogs';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { options, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from '@/lib/labels';

type Ticket = Schemas['Ticket'];
const age = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};
const col = columnsFor<Ticket>();
const columns = [
  col.accessor('title', {
    header: 'Problem',
    meta: { className: 'whitespace-normal' },
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="text-xs text-muted-foreground">
          {c.row.original.number} · {c.row.original.unitCode ?? 'Common area'} ·{' '}
          {c.row.original.propertyName}
        </p>
      </div>
    ),
  }),
  col.accessor('priority', {
    header: 'Priority',
    cell: (c) => (
      <Badge variant={PRIORITY_TONE[c.getValue()]}>{TICKET_PRIORITY_LABEL[c.getValue()]}</Badge>
    ),
  }),
  col.accessor('status', {
    header: 'Status',
    meta: { hideOnMobile: true },
    cell: (c) => (
      <Badge variant={STATUS_TONE[c.getValue()]}>{TICKET_STATUS_LABEL[c.getValue()]}</Badge>
    ),
  }),
  col.accessor((t) => t.assigneeName ?? '—', {
    id: 'who',
    header: 'Assigned',
    meta: { hideOnMobile: true },
  }),
  col.accessor('createdAt', {
    header: 'Reported',
    meta: { hideOnMobile: true },
    cell: (c) => age(c.getValue()),
  }),
  col.accessor('costCents', {
    header: 'Cost',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => (c.getValue() == null ? '—' : formatKes(c.getValue())),
  }),
];
const PRIORITIES = [{ value: '', label: 'Any priority' }, ...options(TICKET_PRIORITY_LABEL)];

export default function MaintenancePage() {
  const router = useRouter();
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const [priority, setPriority] = useState<Ticket['priority']>();
  const [propertyId, setPropertyId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const filter = {
    ...(tab === 'active' ? { active: 'true' as const } : {}),
    ...(priority ? { priority } : {}),
    ...(propertyId ? { propertyId } : {}),
  };
  const list = usePaged(['tickets', filter], async (cursor) =>
    unwrap(await api.GET('/v1/tickets', { params: { query: { cursor, limit: 50, ...filter } } })),
  );
  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Repairs reported by tenants, caretakers and staff."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Report a problem
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <FilterSelect
          label="Priority"
          options={PRIORITIES}
          value={priority}
          onChange={setPriority}
        />
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        isPending={list.isPending}
        error={list.error}
        empty={tab === 'active' ? 'Nothing needs fixing right now.' : 'No tickets yet.'}
        rowHref={(t) => `/maintenance/${t.id}`}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
      <NewTicketDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => router.push(`/maintenance/${id}`)}
      />
    </>
  );
}
