'use client';
import { Button } from '@kejasha/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { List, Map as MapIcon, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SearchBox } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { PropertyDialog } from '@/components/portfolio/property-dialog';
import { PropertyTable } from '@/components/portfolio/property-table';
import { useCan, useDebounced, useOrgKind } from '@/lib/hooks';

// The map (and MapLibre) loads only when someone opens the Map view.
const PortfolioMap = dynamic(
  () => import('@/components/portfolio/portfolio-map').then((m) => m.PortfolioMap),
  { ssr: false, loading: () => <div className="h-[32rem] animate-pulse rounded-xl bg-muted" /> },
);

export default function PropertiesPage() {
  const router = useRouter();
  const canEdit = useCan('manager');
  const agency = useOrgKind() === 'agency';
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  return (
    <>
      <PageHeader
        title="Properties"
        description="Buildings and compounds, each with its units."
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New property
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {view === 'list' ? (
          <SearchBox value={q} onChange={setQ} placeholder="Search properties" />
        ) : (
          <span />
        )}
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="list">
              <List /> List
            </TabsTrigger>
            <TabsTrigger value="map">
              <MapIcon /> Map
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {view === 'list' ? (
        <PropertyTable q={query || undefined} showLandlord={agency} />
      ) : (
        <PortfolioMap />
      )}
      <PropertyDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(p) => router.push(`/properties/${p.id}`)}
      />
    </>
  );
}
