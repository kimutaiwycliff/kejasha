'use client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink, Details } from '@/components/detail';
import { ConfirmButton } from '@/components/dialogs';
import { PageHeader } from '@/components/page-header';
import { LandlordDialog } from '@/components/portfolio/landlord-dialog';
import { PropertyDialog } from '@/components/portfolio/property-dialog';
import { PropertyTable } from '@/components/portfolio/property-table';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCan, useWrite } from '@/lib/hooks';
import { feeLabel } from '@/lib/labels';

export default function LandlordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canEdit = useCan('manager');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const { data: l } = useQuery({
    queryKey: ['client-landlord', id],
    queryFn: async () =>
      unwrap(await api.GET('/v1/client-landlords/{id}', { params: { path: { id } } })),
  });
  const archive = useWrite(
    async (_: void, headers) =>
      unwrap(
        await api.POST('/v1/client-landlords/{id}/archive', { params: { path: { id } }, headers }),
      ),
    { invalidate: [['client-landlords'], ['client-landlord']], success: 'Landlord archived' },
  );
  if (!l) return <Skeleton className="h-64" />;
  return (
    <>
      <BackLink href="/landlords" label="Landlords" />
      <PageHeader
        title={l.name}
        description={l.isSelf ? 'Properties your agency owns itself.' : 'Client landlord'}
        actions={
          canEdit &&
          !l.archivedAt && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              {!l.isSelf && (
                <ConfirmButton
                  label="Archive"
                  title={`Archive ${l.name}?`}
                  description="They disappear from lists and pickers. Their history and statements are kept. A landlord with active properties cannot be archived."
                  onConfirm={async () => {
                    await archive.run();
                    router.push('/landlords');
                  }}
                />
              )}
            </>
          )
        }
      />
      {l.archivedAt && (
        <Badge variant="secondary" className="mb-4">
          Archived {formatDate(l.archivedAt.slice(0, 10))}
        </Badge>
      )}
      <Card className="mb-6">
        <CardContent>
          <Details
            items={[
              ['Phone', l.phone],
              ['Email', l.email],
              ['KRA PIN', l.kraPin],
              ['Management fee', feeLabel(l)],
              ['Notes', l.notes],
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Properties</CardTitle>
          {canEdit && !l.archivedAt && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add property
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <PropertyTable clientLandlordId={l.id} />
        </CardContent>
      </Card>
      <LandlordDialog open={editing} onOpenChange={setEditing} landlord={l} />
      <PropertyDialog
        open={adding}
        onOpenChange={setAdding}
        clientLandlordId={l.id}
        onSaved={(p) => router.push(`/properties/${p.id}`)}
      />
    </>
  );
}
