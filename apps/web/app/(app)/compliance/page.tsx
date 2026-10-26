'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LicencesTab } from '@/components/compliance/licences';
import { columnsFor, DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { MRI_BAND_LABEL } from '@/lib/labels';
import { lastMonth, periodLabel } from '@/lib/period';

type Row = Schemas['MriLandlord'];

function MriTab() {
  const [period, setPeriod] = useState(lastMonth);
  const mri = useQuery({
    queryKey: ['mri', period],
    queryFn: async () =>
      unwrap(await api.GET('/v1/compliance/mri', { params: { query: { period } } })),
  });
  const col = columnsFor<Row>();
  const columns = [
    col.accessor('name', {
      header: 'Landlord',
      meta: { className: 'whitespace-normal' },
      cell: (c) => (
        <div>
          <p className="font-medium">{c.getValue()}</p>
          <p className="text-xs text-muted-foreground">
            {c.row.original.kraPin ?? <span className="text-destructive">No KRA PIN</span>}
          </p>
        </div>
      ),
    }),
    col.accessor('rentCents', {
      header: 'Rent received',
      meta: { align: 'right' },
      cell: (c) => formatKes(c.getValue()),
    }),
    col.accessor('taxCents', {
      header: 'MRI (7.5%)',
      meta: { align: 'right' },
      cell: (c) => <strong>{formatKes(c.getValue())}</strong>,
    }),
    col.accessor('band', {
      header: 'This year',
      meta: { hideOnMobile: true },
      cell: (c) => (
        <div className="flex flex-col gap-1">
          <span className="tabular-nums">{formatKes(c.row.original.yearToDateRentCents)}</span>
          <Badge variant={c.getValue() === 'eligible' ? 'secondary' : 'outline'}>
            {MRI_BAND_LABEL[c.getValue()]}
          </Badge>
        </div>
      ),
    }),
    col.accessor('filing', {
      header: 'Filed',
      cell: (c) => {
        const f = c.getValue();
        if (!f) return <Badge variant="destructive">Not filed</Badge>;
        return (
          <div className="flex flex-col gap-1">
            <Badge>Filed {formatDate(f.filedOn)}</Badge>
            {f.differenceCents !== 0 && (
              <span className="text-xs text-destructive">
                Changed by {formatKes(f.differenceCents)} since
              </span>
            )}
          </div>
        );
      },
    }),
  ];
  const data = mri.data;
  const total = (data?.landlords ?? []).reduce((t, l) => t + l.taxCents, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mri-period">Month</Label>
          <Input
            id="mri-period"
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="sm:w-44"
          />
        </div>
        {data && (
          <p className="text-sm text-muted-foreground sm:ml-auto">
            {periodLabel(data.period)} is due on{' '}
            <strong className="text-foreground">{formatDate(data.dueOn)}</strong> · total{' '}
            <strong className="text-foreground tabular-nums">{formatKes(total)}</strong>
          </p>
        )}
      </div>
      <DataTable
        columns={columns}
        data={data?.landlords ?? []}
        isPending={mri.isPending}
        error={mri.error}
        empty="No residential rent received this month."
        rowHref={(l) => `/compliance/mri/${l.clientLandlordId}?period=${period}`}
      />
      <p className="text-xs text-muted-foreground">
        Monthly Rental Income tax is 7.5% of gross residential rent received, for landlords earning
        KES 288,000 to 15 million a year. File and pay on iTax by the 20th of the next month.
      </p>
    </div>
  );
}

function PinsTab() {
  const pins = useQuery({
    queryKey: ['tenant-pins'],
    queryFn: async () => unwrap(await api.GET('/v1/compliance/tenant-pins')),
  });
  type Item = Schemas['TenantPinRegister']['items'][number];
  const col = columnsFor<Item>();
  const columns = [
    col.accessor('fullName', {
      header: 'Tenant',
      cell: (c) => (
        <Link
          href={`/tenants/${c.row.original.tenantId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {c.getValue()}
        </Link>
      ),
    }),
    col.accessor((r) => r.unitCodes.join(', '), { id: 'units', header: 'Units' }),
    col.accessor('kraPin', {
      header: 'KRA PIN',
      cell: (c) =>
        c.getValue() ? (
          <span className="font-mono">{c.getValue()}</span>
        ) : (
          <Badge variant="destructive">Missing</Badge>
        ),
    }),
  ];
  return (
    <div className="flex flex-col gap-4">
      {pins.data && (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Tenants</CardDescription>
              <CardTitle>{pins.data.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Missing a PIN</CardDescription>
              <CardTitle className={pins.data.missing ? 'text-destructive' : ''}>
                {pins.data.missing}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}
      <DataTable
        columns={columns}
        data={pins.data?.items ?? []}
        isPending={pins.isPending}
        error={pins.error}
        empty="No tenants with an active lease."
      />
    </div>
  );
}

export default function CompliancePage() {
  return (
    <>
      <PageHeader
        title="Compliance"
        description="KRA rental income tax, tenant PINs and licences."
      />
      <Tabs defaultValue="mri">
        <TabsList className="mb-4">
          <TabsTrigger value="mri">Rental income tax</TabsTrigger>
          <TabsTrigger value="pins">Tenant PINs</TabsTrigger>
          <TabsTrigger value="licences">Licences</TabsTrigger>
        </TabsList>
        <TabsContent value="mri">
          <MriTab />
        </TabsContent>
        <TabsContent value="pins">
          <PinsTab />
        </TabsContent>
        <TabsContent value="licences">
          <LicencesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
