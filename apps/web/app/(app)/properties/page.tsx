'use client';
import { Button } from '@kejasha/ui/components/button';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SearchBox } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { PropertyDialog } from '@/components/portfolio/property-dialog';
import { PropertyTable } from '@/components/portfolio/property-table';
import { useCan, useDebounced, useOrgKind } from '@/lib/hooks';

export default function PropertiesPage() {
  const router = useRouter();
  const canEdit = useCan('manager');
  const agency = useOrgKind() === 'agency';
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
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
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search properties" />
      </div>
      <PropertyTable q={query || undefined} showLandlord={agency} />
      <PropertyDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(p) => router.push(`/properties/${p.id}`)}
      />
    </>
  );
}
