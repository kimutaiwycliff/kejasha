'use client';
import type { Schemas } from '@kejasha/api-client';
import { Card, CardDescription, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { ConfirmButton } from '@/components/dialogs';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { useCan, useWrite } from '@/lib/hooks';

type Item = Schemas['ArrearsItem'];
const col = columnsFor<Item>();
const money = (
  key: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus' | 'total',
  header: string,
  hide = true,
) =>
  col.accessor((i) => i.aging[key], {
    id: key,
    header,
    meta: { align: 'right', hideOnMobile: hide },
    cell: (c) => (c.getValue() ? formatKes(c.getValue()) : '—'),
  });
const columns = [
  col.accessor('tenantName', {
    header: 'Tenant',
    meta: { className: 'whitespace-normal' },
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="text-xs text-muted-foreground">
          {c.row.original.unitCode} · {c.row.original.propertyName}
          {c.row.original.tenantPhone && (
            <>
              {' · '}
              <a
                href={`tel:${c.row.original.tenantPhone}`}
                className="underline-offset-4 hover:underline"
              >
                {c.row.original.tenantPhone}
              </a>
            </>
          )}
        </p>
      </div>
    ),
  }),
  col.accessor('oldestDueOn', {
    header: 'Oldest due',
    meta: { hideOnMobile: true },
    cell: (c) => formatDate(c.getValue()),
  }),
  money('d1_30', '1–30 days'),
  money('d31_60', '31–60'),
  money('d61_90', '61–90'),
  money('d90_plus', '90+'),
  money('total', 'Total', false),
];

const BUCKETS = [
  ['Not yet late', 'current'],
  ['1–30 days', 'd1_30'],
  ['31–60 days', 'd31_60'],
  ['61–90 days', 'd61_90'],
  ['Over 90 days', 'd90_plus'],
] as const;

export default function ArrearsPage() {
  const manager = useCan('manager');
  const [propertyId, setPropertyId] = useState<string>();
  const report = useQuery({
    queryKey: ['arrears', propertyId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/arrears', { params: { query: propertyId ? { propertyId } : {} } })),
  });
  const run = useWrite(
    async (_: void, headers) => unwrap(await api.POST('/v1/billing/run', { headers })),
    {
      invalidate: [['arrears'], ['invoices'], ['leases'], ['lease'], ['tenants']],
      success: (r) => `${r.invoicesCreated} invoices and ${r.lateFeesCreated} late fees issued`,
    },
  );
  const t = report.data?.totals;
  return (
    <>
      <PageHeader
        title="Arrears"
        description={
          report.data
            ? `Unpaid amounts by age, as of ${formatDate(report.data.asOf)}.`
            : 'Unpaid amounts by age.'
        }
        actions={
          manager && (
            <ConfirmButton
              label={
                <>
                  <RefreshCw /> Run billing now
                </>
              }
              title="Run billing now?"
              description="Issues any monthly invoices and late fees that are due today. This also runs automatically every morning; running it twice never double-bills."
              confirmLabel="Run billing"
              destructive={false}
              onConfirm={() => run.run()}
            />
          )
        }
      />
      <div className="mb-4">
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        {BUCKETS.map(([label, key]) => (
          <Card key={key} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="tabular-nums">{t ? formatKes(t[key]) : '…'}</CardTitle>
            </CardHeader>
          </Card>
        ))}
        <Card size="sm" className="col-span-2 md:col-span-1">
          <CardHeader>
            <CardDescription>Total owed</CardDescription>
            <CardTitle className="tabular-nums text-destructive">
              {t ? formatKes(t.total) : '…'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <DataTable
        columns={columns}
        data={report.data?.items ?? []}
        isPending={report.isPending}
        error={report.error}
        empty="Nobody is behind on rent."
        rowHref={(i) => `/leases/${i.leaseId}`}
      />
    </>
  );
}
