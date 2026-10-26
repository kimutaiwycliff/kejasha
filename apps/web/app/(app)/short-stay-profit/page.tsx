'use client';
import type { Schemas } from '@kejasha/api-client';
import { Card, CardDescription, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { api, unwrap } from '@/lib/api';
import { formatKes, todayNairobi } from '@/lib/format';
import { bpsLabel, BOOKING_SOURCE_LABEL } from '@/lib/labels';

type Report = Schemas['ShortStayReport'];
type UnitRow = Report['units'][number];
type Channel = Report['channels'][number];

const uc = columnsFor<UnitRow>();
const unitColumns = [
  uc.accessor('unitCode', {
    header: 'Unit',
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="text-xs text-muted-foreground">{c.row.original.propertyName}</p>
      </div>
    ),
  }),
  uc.accessor('occupancyBps', {
    header: 'Occupancy',
    meta: { align: 'right' },
    cell: (c) =>
      `${bpsLabel(c.getValue())} (${c.row.original.nightsSold}/${c.row.original.availableNights})`,
  }),
  uc.accessor('adrCents', {
    header: 'ADR',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  uc.accessor('grossCents', {
    header: 'Gross',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  uc.accessor('commissionCents', {
    header: 'Commission',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  uc.accessor('expensesCents', {
    header: 'Expenses',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  uc.accessor('netCents', {
    header: 'Net',
    meta: { align: 'right' },
    cell: (c) => (
      <span className={c.getValue() < 0 ? 'text-destructive' : 'font-medium'}>
        {formatKes(c.getValue())}
      </span>
    ),
  }),
];

const cc = columnsFor<Channel>();
const channelColumns = [
  cc.accessor('source', { header: 'Channel', cell: (c) => BOOKING_SOURCE_LABEL[c.getValue()] }),
  cc.accessor('bookings', { header: 'Bookings', meta: { align: 'right', hideOnMobile: true } }),
  cc.accessor('nights', { header: 'Nights', meta: { align: 'right' } }),
  cc.accessor('grossCents', {
    header: 'Gross',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  cc.accessor('effectiveCommissionBps', {
    header: 'It costs you',
    meta: { align: 'right' },
    cell: (c) => `${bpsLabel(c.getValue())} · ${formatKes(c.row.original.commissionCents)}`,
  }),
  cc.accessor((r) => (r.nights ? Math.round(r.netCents / r.nights) : 0), {
    id: 'perNight',
    header: 'Net per night',
    meta: { align: 'right' },
    cell: (c) => formatKes(c.getValue()),
  }),
];

export default function ShortStayProfitPage() {
  const [period, setPeriod] = useState(todayNairobi().slice(0, 7));
  const [propertyId, setPropertyId] = useState<string>();
  const report = useQuery({
    queryKey: ['short-stay-report', period, propertyId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/reports/short-stay', {
          params: { query: { period, ...(propertyId ? { propertyId } : {}) } },
        }),
      ),
  });
  const t = report.data?.totals;
  const cards = t
    ? [
        ['Net profit', formatKes(t.netCents), t.netCents < 0],
        ['Gross', formatKes(t.grossCents), false],
        ['Commission paid', formatKes(t.commissionCents), false],
        ['Expenses', formatKes(t.expensesCents), false],
        ['Occupancy', bpsLabel(t.occupancyBps), false],
        ['ADR / RevPAR', `${formatKes(t.adrCents)} / ${formatKes(t.revparCents)}`, false],
      ]
    : [];
  return (
    <>
      <PageHeader
        title="Short-stay profit"
        description="What each unit really earned after platform commission and running costs."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="period">Month</Label>
          <Input
            id="period"
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="sm:w-44"
          />
        </div>
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {(cards.length ? cards : Array.from({ length: 6 }, () => ['…', '…', false])).map(
          ([label, value, bad], i) => (
            <Card key={i} size="sm">
              <CardHeader>
                <CardDescription>{label as string}</CardDescription>
                <CardTitle className={`tabular-nums ${bad ? 'text-destructive' : ''}`}>
                  {value as string}
                </CardTitle>
              </CardHeader>
            </Card>
          ),
        )}
      </div>
      <h2 className="mb-2 text-lg font-semibold">By unit</h2>
      <DataTable
        columns={unitColumns}
        data={report.data?.units ?? []}
        isPending={report.isPending}
        error={report.error}
        empty="No short-stay units."
        rowHref={(u) => `/units/${u.unitId}`}
      />
      <h2 className="mt-8 mb-1 text-lg font-semibold">By channel</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        What each platform really costs compared with direct bookings.
      </p>
      <DataTable
        columns={channelColumns}
        data={report.data?.channels ?? []}
        isPending={report.isPending}
        empty="No stays this month."
      />
    </>
  );
}
