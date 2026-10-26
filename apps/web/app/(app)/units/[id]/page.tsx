'use client';
import { LinkButton } from '@/components/link-button';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink, Details } from '@/components/detail';
import { ConfirmButton } from '@/components/dialogs';
import { LeaseTable } from '@/components/leasing/lease-table';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { MetersCard } from '@/components/portfolio/meters';
import { UnitDialog } from '@/components/portfolio/unit-dialogs';
import { UnitStaySection } from '@/components/shortstay/unit-stay';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { toastError, useCan, useWrite } from '@/lib/hooks';
import { MODE_LABEL } from '@/lib/labels';

export default function UnitPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canEdit = useCan('manager');
  const seesLeases = useCan('agent');
  const [editing, setEditing] = useState(false);
  const uQuery = useQuery({
    queryKey: ['unit', id],
    queryFn: async () => unwrap(await api.GET('/v1/units/{id}', { params: { path: { id } } })),
  });
  const u = uQuery.data;
  const invalidate = [['units'], ['unit'], ['property'], ['properties']];
  const archive = useWrite(
    async (_: void, headers) =>
      unwrap(await api.POST('/v1/units/{id}/archive', { params: { path: { id } }, headers })),
    { invalidate, success: 'Unit archived' },
  );
  const setStatus = useWrite(
    async (status: 'active' | 'inactive', headers) =>
      unwrap(
        await api.PATCH('/v1/units/{id}', { params: { path: { id } }, body: { status }, headers }),
      ),
    { invalidate, success: (r) => (r.status === 'active' ? 'Unit is active' : 'Unit is inactive') },
  );
  if (!u) return <QueryFallback query={uQuery} className="h-64" />;
  const live = !u.archivedAt;
  const shortStay = u.mode === 'short_stay';
  return (
    <>
      <BackLink href={`/properties/${u.propertyId}`} label={u.propertyName} />
      <PageHeader
        title={`Unit ${u.code}`}
        description={u.label ?? undefined}
        actions={
          canEdit &&
          live && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button
                variant="outline"
                disabled={setStatus.pending}
                onClick={() =>
                  setStatus.run(u.status === 'active' ? 'inactive' : 'active').catch(toastError)
                }
              >
                {u.status === 'active' ? 'Mark inactive' : 'Mark active'}
              </Button>
              <ConfirmButton
                label="Archive"
                title={`Archive unit ${u.code}?`}
                description="Its code can then be reused. History is kept. A unit with an active lease or upcoming bookings cannot be archived."
                onConfirm={async () => {
                  await archive.run();
                  router.push(`/properties/${u.propertyId}`);
                }}
              />
            </>
          )
        }
      />
      <div className="mb-4 flex gap-2">
        <Badge variant="outline">{MODE_LABEL[u.mode]}</Badge>
        {u.status === 'inactive' && <Badge variant="secondary">Inactive</Badge>}
        {!live && <Badge variant="secondary">Archived</Badge>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <Details
              items={[
                [
                  'Property',
                  <Link
                    key="p"
                    href={`/properties/${u.propertyId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {u.propertyName}
                  </Link>,
                ],
                [
                  'Paybill account number',
                  <span key="c" className="font-mono">
                    {u.code}
                  </span>,
                ],
                ...((shortStay
                  ? [
                      ['Base nightly rate', formatKes(u.baseNightlyCents)],
                      ['Max guests', u.maxGuests],
                    ]
                  : [
                      ['Monthly rent', formatKes(u.rentCents)],
                      ['Deposit', formatKes(u.depositCents)],
                    ]) as [string, string | number | null][]),
                ['Bedrooms', u.bedrooms],
                ['Bathrooms', u.bathrooms],
                ['Floor', u.floor],
                ['Size', u.sizeSqm ? `${u.sizeSqm} m²` : null],
                ['Notes', u.notes],
              ]}
            />
          </CardContent>
        </Card>
        <MetersCard unitId={u.id} live={live} />
      </div>
      {!shortStay && seesLeases && (
        <Card className="mt-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Leases</CardTitle>
            {canEdit && live && u.status === 'active' && (
              <LinkButton size="sm" href={`/leases/new?unitId=${u.id}`}>
                <Plus /> New lease
              </LinkButton>
            )}
          </CardHeader>
          <CardContent>
            <LeaseTable filter={{ unitId: u.id }} hide={['unit']} />
          </CardContent>
        </Card>
      )}
      {shortStay && seesLeases && <UnitStaySection unitId={u.id} live={live} />}
      <UnitDialog open={editing} onOpenChange={setEditing} unit={u} />
    </>
  );
}
