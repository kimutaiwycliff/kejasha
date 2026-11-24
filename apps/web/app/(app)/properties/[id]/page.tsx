'use client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { LayoutGrid, ListPlus, MapPin, Pencil, Plus, Table2, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BackLink, Details } from '@/components/detail';
import { ConfirmButton } from '@/components/dialogs';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { PropertyDialog } from '@/components/portfolio/property-dialog';
import { StaffDialog } from '@/components/portfolio/staff-dialog';
import { BulkUnitsDialog, UnitDialog } from '@/components/portfolio/unit-dialogs';
import { UnitBoard } from '@/components/portfolio/unit-board';
import { UnitTable } from '@/components/portfolio/unit-table';
import { api, unwrap } from '@/lib/api';
import { useCan, useOrgKind, useWrite } from '@/lib/hooks';
import { PROPERTY_KIND_LABEL } from '@/lib/labels';

// MapLibre loads only on pages that show a map.
const PropertyMap = dynamic(
  () => import('@/components/portfolio/property-map').then((m) => m.PropertyMap),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-lg bg-muted" />,
  },
);
const LocationDialog = dynamic(
  () => import('@/components/portfolio/location-dialog').then((m) => m.LocationDialog),
  { ssr: false },
);

export default function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canEdit = useCan('manager');
  const agency = useOrgKind() === 'agency';
  const [dialog, setDialog] = useState<'edit' | 'unit' | 'bulk' | 'staff' | 'location' | null>(
    null,
  );
  const [unitView, setUnitView] = useState<'board' | 'table'>('board');
  const close = (o: boolean) => !o && setDialog(null);
  const pQuery = useQuery({
    queryKey: ['property', id],
    queryFn: async () => unwrap(await api.GET('/v1/properties/{id}', { params: { path: { id } } })),
  });
  const p = pQuery.data;
  const archive = useWrite(
    async (_: void, headers) =>
      unwrap(await api.POST('/v1/properties/{id}/archive', { params: { path: { id } }, headers })),
    { invalidate: [['properties'], ['property']], success: 'Property archived' },
  );
  if (!p) return <QueryFallback query={pQuery} className="h-64" />;
  const live = !p.archivedAt;
  return (
    <>
      <BackLink href="/properties" label="Properties" />
      <PageHeader
        title={p.name}
        description={[p.area, p.county].filter(Boolean).join(', ')}
        actions={
          canEdit &&
          live && (
            <>
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil /> Edit
              </Button>
              <ConfirmButton
                label="Archive"
                title={`Archive ${p.name}?`}
                description="It disappears from lists. History is kept. A property with active leases or upcoming bookings cannot be archived."
                onConfirm={async () => {
                  await archive.run();
                  router.push('/properties');
                }}
              />
            </>
          )
        }
      />
      {!live && (
        <Badge variant="secondary" className="mb-4">
          Archived
        </Badge>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent>
            <Details
              items={[
                ...(agency
                  ? ([
                      [
                        'Landlord',
                        <Link
                          key="l"
                          href={`/landlords/${p.clientLandlordId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {p.clientLandlordName}
                        </Link>,
                      ],
                    ] as [string, ReactNode][])
                  : []),
                ['Type', PROPERTY_KIND_LABEL[p.kind]],
                [
                  'Units',
                  `${p.unitCounts.total} (${p.unitCounts.longTerm} long-term, ${p.unitCounts.shortStay} short-stay)`,
                ],
                ['Address', p.address],
                ['Notes', p.notes],
              ]}
            />
          </CardContent>
        </Card>
        <Card id="location" className="gap-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Location</CardTitle>
            {canEdit && live && (
              <Button size="sm" variant="outline" onClick={() => setDialog('location')}>
                <MapPin /> {p.latitude !== null ? 'Move pin' : 'Set location'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {p.latitude !== null && p.longitude !== null ? (
              <PropertyMap name={p.name} at={[p.longitude, p.latitude]} />
            ) : (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg bg-muted text-center text-sm text-muted-foreground">
                <MapPin className="size-6 text-murram" aria-hidden />
                Not on the map yet.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Staff</CardTitle>
            {canEdit && live && (
              <Button size="sm" variant="outline" onClick={() => setDialog('staff')}>
                <Users /> Assign
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {p.staff.length === 0 && <p className="text-muted-foreground">No one assigned.</p>}
            {p.staff.map((s) => (
              <div key={s.userId} className="flex justify-between">
                <span>{s.name}</span>
                <span className="capitalize text-muted-foreground">{s.role}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Units</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Tabs value={unitView} onValueChange={(v) => setUnitView(v as typeof unitView)}>
              <TabsList>
                <TabsTrigger value="board">
                  <LayoutGrid /> Board
                </TabsTrigger>
                <TabsTrigger value="table">
                  <Table2 /> Table
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {canEdit && live && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog('bulk')}>
                  <ListPlus /> Add many
                </Button>
                <Button size="sm" onClick={() => setDialog('unit')}>
                  <Plus /> Add unit
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {unitView === 'board' ? (
            <UnitBoard propertyId={p.id} />
          ) : (
            <UnitTable filter={{ propertyId: p.id }} hideProperty />
          )}
        </CardContent>
      </Card>
      <PropertyDialog open={dialog === 'edit'} onOpenChange={close} property={p} />
      {dialog === 'location' && <LocationDialog open onOpenChange={close} property={p} />}
      <UnitDialog
        open={dialog === 'unit'}
        onOpenChange={close}
        propertyId={p.id}
        onSaved={(u) => router.push(`/units/${u.id}`)}
      />
      <BulkUnitsDialog open={dialog === 'bulk'} onOpenChange={close} propertyId={p.id} />
      <StaffDialog
        open={dialog === 'staff'}
        onOpenChange={close}
        propertyId={p.id}
        current={p.staff}
      />
    </>
  );
}
