'use client';
import type { Schemas } from '@kejasha/api-client';
import { FileMriBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { columnsFor, DataTable } from '@/components/data-table';
import { BackLink } from '@/components/detail';
import { ConfirmButton, FormDialog } from '@/components/dialogs';
import { DateField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { api, ApiError, unwrap } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { useWrite } from '@/lib/hooks';
import { MRI_BAND_LABEL } from '@/lib/labels';
import { lastMonth, periodLabel } from '@/lib/period';

type Line = Schemas['MriLine'];
const col = columnsFor<Line>();
const columns = [
  col.accessor('tenantName', {
    header: 'Tenant',
    meta: { className: 'whitespace-normal' },
    cell: (c) => (
      <div>
        <p className="font-medium">{c.getValue()}</p>
        <p className="text-xs text-muted-foreground">
          {c.row.original.unitCode} · {c.row.original.propertyName}
          {c.row.original.propertyKind === 'mixed' && ' · mixed use'}
        </p>
      </div>
    ),
  }),
  col.accessor('tenantKraPin', {
    header: 'PIN',
    meta: { hideOnMobile: true },
    cell: (c) =>
      c.getValue() ? (
        <span className="font-mono text-xs">{c.getValue()}</span>
      ) : (
        <Badge variant="destructive">Missing</Badge>
      ),
  }),
  col.accessor('receivedCents', {
    header: 'Received',
    meta: { align: 'right', hideOnMobile: true },
    cell: (c) => formatKes(c.getValue()),
  }),
  col.accessor('rentCents', {
    header: 'Rent part',
    meta: { align: 'right' },
    cell: (c) => formatKes(c.getValue()),
  }),
  col.accessor('taxCents', {
    header: 'MRI',
    meta: { align: 'right' },
    cell: (c) => formatKes(c.getValue()),
  }),
];

function FileDialog({
  landlordId,
  period,
  open,
  onOpenChange,
}: {
  landlordId: string;
  period: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<z.input<typeof FileMriBody>, unknown, z.output<typeof FileMriBody>>({
    resolver: zodResolver(FileMriBody),
  });
  useEffect(() => {
    if (open) form.reset({ period, filedOn: todayNairobi() });
  }, [open, period, form]);
  const save = useWrite(
    async (body: z.output<typeof FileMriBody>, headers) =>
      unwrap(
        await api.POST('/v1/compliance/mri/{clientLandlordId}/filings', {
          params: { path: { clientLandlordId: landlordId } },
          body,
          headers,
        }),
      ),
    { invalidate: [['mri']], success: 'Filing recorded' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_filed')
        form.setError('filedOn', { message: 'This month is already filed.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record the filing"
      description="After you file and pay on iTax. The figures are saved as filed, so later changes show as a difference."
      form={form}
      onSubmit={submit}
      submitLabel="Record filing"
    >
      <DateField form={form} name="filedOn" label="Filed on" />
      <TextField
        form={form}
        name="kraReference"
        label="KRA payment reference (PRN)"
        empty={undefined}
      />
    </FormDialog>
  );
}

function MriDetail() {
  const { landlordId } = useParams<{ landlordId: string }>();
  const period = useSearchParams().get('period') ?? lastMonth();
  const [filing, setFiling] = useState(false);
  const q = useQuery({
    queryKey: ['mri', period, landlordId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/compliance/mri/{clientLandlordId}', {
          params: { path: { clientLandlordId: landlordId }, query: { period } },
        }),
      ),
  });
  const undo = useWrite(
    async (id: string, headers) =>
      unwrap(
        await api.DELETE('/v1/compliance/mri-filings/{id}', { params: { path: { id } }, headers }),
      ),
    { invalidate: [['mri']], success: 'Filing removed' },
  );
  const d = q.data;
  if (!d) return <QueryFallback query={q} className="h-96" />;
  const cards: [string, string, boolean?][] = [
    ['Rent received', formatKes(d.rentCents)],
    ['MRI due (7.5%)', formatKes(d.taxCents), true],
    ['Due on', formatDate(d.dueOn)],
    ['Rent this year', `${formatKes(d.yearToDateRentCents)} · ${MRI_BAND_LABEL[d.band]}`],
  ];
  return (
    <>
      <BackLink href="/compliance" label="Compliance" />
      <PageHeader
        title={`${d.name} · ${periodLabel(d.period)}`}
        description={
          d.kraPin
            ? `KRA PIN ${d.kraPin}`
            : 'No KRA PIN on record — add it to the landlord before filing.'
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                void downloadFile(
                  `/v1/compliance/mri/${landlordId}/erits.csv?period=${period}`,
                  `mri-${period}-${d.name.replace(/\W+/g, '-').toLowerCase()}.csv`,
                )
              }
            >
              <Download /> eRITS CSV
            </Button>
            {d.filing ? (
              <ConfirmButton
                label="Undo filing"
                title="Remove the recorded filing?"
                description="Only if it was recorded by mistake. Nothing changes on iTax."
                confirmLabel="Remove"
                onConfirm={() => undo.run(d.filing!.id)}
              />
            ) : (
              <Button onClick={() => setFiling(true)}>Record filing</Button>
            )}
          </>
        }
      />
      {d.filing && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge>Filed {formatDate(d.filing.filedOn)}</Badge>
          {d.filing.kraReference && (
            <span className="font-mono text-xs">{d.filing.kraReference}</span>
          )}
          {d.filing.differenceCents !== 0 && (
            <span className="text-destructive">
              Receipts changed after filing: {formatKes(d.filing.differenceCents)} more tax.
              Consider an amended return.
            </span>
          )}
        </div>
      )}
      {(d.hasMixedProperties || d.tenantsMissingPin > 0) && (
        <ul className="mb-4 list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
          {d.hasMixedProperties && (
            <li>Includes mixed-use properties: check only residential rent is counted.</li>
          )}
          {d.tenantsMissingPin > 0 && (
            <li>{d.tenantsMissingPin} tenant(s) have no KRA PIN on record.</li>
          )}
        </ul>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value, strong]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className={`tabular-nums ${strong ? 'text-xl' : ''}`}>{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={d.lines}
        empty="No rent received from residential tenants this month."
      />
      <FileDialog
        landlordId={landlordId}
        period={d.period}
        open={filing}
        onOpenChange={setFiling}
      />
    </>
  );
}

export default function MriDetailPage() {
  return (
    <Suspense>
      <MriDetail />
    </Suspense>
  );
}
