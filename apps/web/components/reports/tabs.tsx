'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { columnsFor, DataTable } from '@/components/data-table';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { api, unwrap } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';
import { bpsLabel, PAYMENT_METHOD_LABEL, PAYMENT_SOURCE_LABEL } from '@/lib/labels';
import { lastMonth, thisMonth } from '@/lib/period';

type Dataset = Schemas['ExportDatasetInput'];

export function CsvButton({ dataset, query = '' }: { dataset: Dataset; query?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void downloadFile(`/v1/exports/${dataset}${query}`, `${dataset}-${todayNairobi()}.csv`)
      }
    >
      <Download /> CSV
    </Button>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

// ── Owner statements ─────────────────────────────────────────────────────────────────────────
type Summary = Schemas['OwnerStatementSummary'];
export function StatementsTab() {
  const [period, setPeriod] = useState(lastMonth);
  const list = useQuery({
    queryKey: ['owner-statements', period],
    queryFn: async () =>
      unwrap(await api.GET('/v1/owner-statements', { params: { query: { period } } })),
  });
  const col = columnsFor<Summary>();
  const columns = [
    col.accessor('landlordName', {
      header: 'Landlord',
      cell: (c) => <span className="font-medium">{c.getValue()}</span>,
    }),
    col.accessor('incomeCents', {
      header: 'Collected',
      meta: { align: 'right' },
      cell: (c) => formatKes(c.getValue()),
    }),
    col.accessor('expensesCents', {
      header: 'Expenses',
      meta: { align: 'right', hideOnMobile: true },
      cell: (c) => formatKes(c.getValue()),
    }),
    col.accessor('managementFeeCents', {
      header: 'Mgmt fee',
      meta: { align: 'right', hideOnMobile: true },
      cell: (c) => formatKes(c.getValue()),
    }),
    col.accessor('netCents', {
      header: 'Net to owner',
      meta: { align: 'right' },
      cell: (c) => <strong>{formatKes(c.getValue())}</strong>,
    }),
  ];
  return (
    <div className="flex flex-col gap-4">
      <Field id="st-period" label="Month">
        <Input
          id="st-period"
          type="month"
          value={period}
          onChange={(e) => e.target.value && setPeriod(e.target.value)}
          className="sm:w-44"
        />
      </Field>
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        isPending={list.isPending}
        error={list.error}
        empty="No landlords."
        rowHref={(s) => `/reports/statements/${s.clientLandlordId}?period=${period}`}
      />
    </div>
  );
}

// ── Rent roll ────────────────────────────────────────────────────────────────────────────────
type RollItem = Schemas['RentRoll']['items'][number];
export function RentRollTab() {
  const [asOf, setAsOf] = useState(todayNairobi);
  const [propertyId, setPropertyId] = useState<string>();
  const roll = useQuery({
    queryKey: ['rent-roll', asOf, propertyId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/reports/rent-roll', {
          params: { query: { asOf, ...(propertyId ? { propertyId } : {}) } },
        }),
      ),
  });
  const col = columnsFor<RollItem>();
  const columns = [
    col.accessor('unitCode', {
      header: 'Unit',
      cell: (c) => (
        <div>
          <p className="font-medium">{c.getValue()}</p>
          <p className="text-xs text-muted-foreground">{c.row.original.propertyName}</p>
        </div>
      ),
    }),
    col.accessor('tenantName', {
      header: 'Tenant',
      meta: { className: 'whitespace-normal' },
      cell: (c) => c.getValue() ?? <Badge variant="outline">Vacant</Badge>,
    }),
    col.accessor('leaseEnd', {
      header: 'Lease',
      meta: { hideOnMobile: true },
      cell: (c) =>
        c.row.original.leaseStart
          ? `${formatDate(c.row.original.leaseStart)} – ${c.getValue() ? formatDate(c.getValue()) : 'open'}`
          : '—',
    }),
    col.accessor('rentCents', {
      header: 'Rent',
      meta: { align: 'right' },
      cell: (c) => formatKes(c.getValue()),
    }),
    col.accessor('balanceCents', {
      header: 'Balance',
      meta: { align: 'right' },
      cell: (c) =>
        c.getValue() > 0 ? (
          <span className="text-destructive">{formatKes(c.getValue())}</span>
        ) : (
          formatKes(c.getValue())
        ),
    }),
  ];
  const t = roll.data?.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field id="rr-asof" label="As of">
          <Input
            id="rr-asof"
            type="date"
            value={asOf}
            onChange={(e) => e.target.value && setAsOf(e.target.value)}
            className="sm:w-44"
          />
        </Field>
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="sm:ml-auto">
          <CsvButton dataset="rent-roll" />
        </div>
      </div>
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Units" value={`${t.occupied} of ${t.units} let`} />
          <Stat label="Occupancy" value={bpsLabel(t.occupancyBps)} />
          <Stat label="Monthly rent (let units)" value={formatKes(t.rentCents)} />
          <Stat
            label="Owed by tenants"
            value={formatKes(t.balanceCents)}
            tone={t.balanceCents > 0 ? 'bad' : undefined}
          />
        </div>
      )}
      <DataTable
        columns={columns}
        data={roll.data?.items ?? []}
        isPending={roll.isPending}
        error={roll.error}
        empty="No long-term units."
      />
    </div>
  );
}

// ── Collections ──────────────────────────────────────────────────────────────────────────────
function Buckets({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; amountCents: number; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.amountCents));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {rows.length === 0 && <p className="text-muted-foreground">Nothing collected.</p>}
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 tabular-nums">
              <span>
                {r.label} <span className="text-muted-foreground">({r.count})</span>
              </span>
              <span>{formatKes(r.amountCents)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${(r.amountCents / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CollectionsTab() {
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(todayNairobi);
  const rep = useQuery({
    queryKey: ['collections', from, to],
    queryFn: async () =>
      unwrap(await api.GET('/v1/reports/collections', { params: { query: { from, to } } })),
  });
  const r = rep.data;
  const label =
    (map: Record<string, string>) => (b: { key: string; amountCents: number; count: number }) => ({
      label: map[b.key] ?? b.key,
      amountCents: b.amountCents,
      count: b.count,
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field id="co-from" label="From">
          <Input
            id="co-from"
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="sm:w-44"
          />
        </Field>
        <Field id="co-to" label="To">
          <Input
            id="co-to"
            type="date"
            value={to}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="sm:w-44"
          />
        </Field>
        <div className="sm:ml-auto">
          <CsvButton dataset="collections" query={`?from=${from}&to=${to}`} />
        </div>
      </div>
      {rep.error && <p className="text-sm text-destructive">{errorMessage(rep.error)}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Stat label="Collected" value={formatKes(r.totalCents)} />
            <Stat label="Payments" value={String(r.count)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Buckets title="By method" rows={r.byMethod.map(label(PAYMENT_METHOD_LABEL))} />
            <Buckets title="By channel" rows={r.bySource.map(label(PAYMENT_SOURCE_LABEL))} />
            <Buckets
              title="By property"
              rows={r.byProperty.map((b) => ({
                label: b.propertyName,
                amountCents: b.amountCents,
                count: b.count,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Occupancy ────────────────────────────────────────────────────────────────────────────────
export function OccupancyTab() {
  const [period, setPeriod] = useState(thisMonth);
  const rep = useQuery({
    queryKey: ['occupancy', period],
    queryFn: async () =>
      unwrap(await api.GET('/v1/reports/occupancy', { params: { query: { period } } })),
  });
  const r = rep.data;
  return (
    <div className="flex flex-col gap-4">
      <Field id="oc-period" label="Month">
        <Input
          id="oc-period"
          type="month"
          value={period}
          onChange={(e) => e.target.value && setPeriod(e.target.value)}
          className="sm:w-44"
        />
      </Field>
      {rep.error && <p className="text-sm text-destructive">{errorMessage(rep.error)}</p>}
      {r && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Long-term (let at month end)</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {bpsLabel(r.longTerm.occupancyBps)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {r.longTerm.occupied} of {r.longTerm.units} units let
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Short-stay (nights sold)</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {bpsLabel(r.shortStay.occupancyBps)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {r.shortStay.nightsSold} of {r.shortStay.availableNights} nights across{' '}
              {r.shortStay.units} units
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
