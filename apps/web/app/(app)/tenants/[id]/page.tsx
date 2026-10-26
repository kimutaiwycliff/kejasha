'use client';
import { LinkButton } from '@/components/link-button';
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
import { LeaseTable } from '@/components/leasing/lease-table';
import { TenantDialog } from '@/components/leasing/tenant-dialog';
import { PageHeader } from '@/components/page-header';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { useCan, useWrite } from '@/lib/hooks';

export default function TenantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canEdit = useCan('agent');
  const canArchive = useCan('manager');
  const canLease = useCan('manager');
  const [editing, setEditing] = useState(false);
  const { data: t } = useQuery({
    queryKey: ['tenant', id],
    queryFn: async () => unwrap(await api.GET('/v1/tenants/{id}', { params: { path: { id } } })),
  });
  const archive = useWrite(
    async (_: void, headers) =>
      unwrap(await api.POST('/v1/tenants/{id}/archive', { params: { path: { id } }, headers })),
    { invalidate: [['tenants'], ['tenant']], success: 'Tenant archived' },
  );
  if (!t) return <Skeleton className="h-64" />;
  const live = !t.archivedAt;
  return (
    <>
      <BackLink href="/tenants" label="Tenants" />
      <PageHeader
        title={t.fullName}
        description={
          t.balanceCents > 0
            ? `Owes ${formatKes(t.balanceCents)}`
            : t.balanceCents < 0
              ? `In credit ${formatKes(-t.balanceCents)}`
              : 'Nothing owed'
        }
        actions={
          live && (
            <>
              {canEdit && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              )}
              {canArchive && (
                <ConfirmButton
                  label="Archive"
                  title={`Archive ${t.fullName}?`}
                  description="They disappear from lists. History is kept. A tenant with an active lease cannot be archived."
                  onConfirm={async () => {
                    await archive.run();
                    router.push('/tenants');
                  }}
                />
              )}
            </>
          )
        }
      />
      {!live && (
        <Badge variant="secondary" className="mb-4">
          Archived
        </Badge>
      )}
      <Card className="mb-6">
        <CardContent>
          <Details
            items={[
              ['Phone', t.phone],
              ['Email', t.email],
              ['ID / passport', t.nationalId],
              ['KRA PIN', t.kraPin],
              ['Next of kin', [t.nextOfKinName, t.nextOfKinPhone].filter(Boolean).join(' · ')],
              ['Notes', t.notes],
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Leases</CardTitle>
          {canLease && live && (
            <LinkButton size="sm" href={`/leases/new?tenantId=${t.id}`}>
              <Plus /> New lease
            </LinkButton>
          )}
        </CardHeader>
        <CardContent>
          <LeaseTable filter={{ tenantId: t.id }} hide={['tenant']} />
        </CardContent>
      </Card>
      <TenantDialog open={editing} onOpenChange={setEditing} tenant={t} />
    </>
  );
}
