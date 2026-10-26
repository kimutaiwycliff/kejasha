'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateCashCollectionBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { columnsFor, DataTable } from '@/components/data-table';
import { ConfirmButton, FormDialog, ReasonDialog } from '@/components/dialogs';
import { DateField, MoneyField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { useUnitOptions } from '@/components/leasing/pickers';
import { PageHeader } from '@/components/page-header';
import { paymentKeys } from '@/components/payments/dialogs';
import { api, ApiError, unwrap } from '@/lib/api';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { toastError, useCan, usePaged, useWrite } from '@/lib/hooks';
import { uploadFile } from '@/lib/upload';

type Cash = Schemas['CashCollection'];
type Values = z.input<typeof CreateCashCollectionBody>;

function LogCashDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<Values, unknown, z.output<typeof CreateCashCollectionBody>>({
    resolver: zodResolver(CreateCashCollectionBody),
  });
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (open) form.reset({ receivedOn: todayNairobi() });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateCashCollectionBody>, headers) =>
      unwrap(await api.POST('/v1/cash-collections', { body, headers })),
    { invalidate: [['cash']], success: 'Cash logged; waiting for the owner to confirm' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_lease_on_unit')
        form.setError('unitId', { message: 'No lease on this unit on that date.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Log cash received"
      description="It is added to the tenant's account only when the owner or manager confirms it."
      form={form}
      onSubmit={submit}
      submitLabel="Log cash"
    >
      <ComboField
        form={form}
        name="unitId"
        label="Unit"
        placeholder="Search unit code"
        useOptions={useUnitOptions}
      />
      <div className="grid grid-cols-2 gap-4">
        <MoneyField form={form} name="amountCents" label="Amount" />
        <DateField form={form} name="receivedOn" label="Received on" />
      </div>
      <TextField form={form} name="payerName" label="Paid by (optional)" empty={undefined} />
      <TextareaField form={form} name="note" label="Note" />
      <Controller
        control={form.control}
        name="receiptKey"
        render={({ field }) => (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            render={<label />}
            nativeButton={false}
            disabled={uploading}
          >
            <Camera />{' '}
            {uploading
              ? 'Uploading…'
              : field.value
                ? 'Receipt photo attached'
                : 'Add receipt photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setUploading(true);
                try {
                  field.onChange(await uploadFile(f, 'cash_receipt'));
                } catch (err) {
                  toastError(err);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </Button>
        )}
      />
    </FormDialog>
  );
}

const TONE = { pending: 'secondary', confirmed: 'default', rejected: 'destructive' } as const;
const STATUS_LABEL = { pending: 'Waiting', confirmed: 'Confirmed', rejected: 'Rejected' } as const;

export default function CashPage() {
  const manager = useCan('manager');
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [logging, setLogging] = useState(false);
  const [rejecting, setRejecting] = useState<Cash | null>(null);
  const list = usePaged(['cash', tab], async (cursor) =>
    unwrap(
      await api.GET('/v1/cash-collections', {
        params: {
          query: {
            cursor,
            limit: 50,
            ...(tab === 'pending' ? { status: 'pending' as const } : {}),
          },
        },
      }),
    ),
  );
  const confirm = useWrite(
    async (id: string, headers) =>
      unwrap(
        await api.POST('/v1/cash-collections/{id}/confirm', { params: { path: { id } }, headers }),
      ),
    { invalidate: [['cash'], ...paymentKeys], success: 'Confirmed and receipted' },
  );
  const reject = useWrite(
    async ({ id, reason }: { id: string; reason: string }, headers) =>
      unwrap(
        await api.POST('/v1/cash-collections/{id}/reject', {
          params: { path: { id } },
          body: { reason },
          headers,
        }),
      ),
    { invalidate: [['cash']], success: 'Rejected' },
  );
  const col = columnsFor<Cash>();
  const columns = [
    col.accessor('receivedOn', { header: 'Received', cell: (c) => formatDate(c.getValue()) }),
    col.accessor((r) => `${r.unitCode ?? '—'}${r.payerName ? ` · ${r.payerName}` : ''}`, {
      id: 'from',
      header: 'From',
      meta: { className: 'whitespace-normal' },
      cell: (c) => (
        <div>
          <p className="font-medium">{c.getValue()}</p>
          {c.row.original.note && (
            <p className="text-xs text-muted-foreground">{c.row.original.note}</p>
          )}
          {c.row.original.rejectReason && (
            <p className="text-xs text-destructive">Rejected: {c.row.original.rejectReason}</p>
          )}
        </div>
      ),
    }),
    col.accessor('receipt', {
      header: 'Receipt',
      enableSorting: false,
      meta: { hideOnMobile: true },
      cell: (c) =>
        c.getValue() ? (
          <a
            href={c.getValue()!.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            Photo
          </a>
        ) : (
          '—'
        ),
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (c) => <Badge variant={TONE[c.getValue()]}>{STATUS_LABEL[c.getValue()]}</Badge>,
    }),
    col.accessor('amountCents', {
      header: 'Amount',
      meta: { align: 'right' },
      cell: (c) => formatKes(c.getValue()),
    }),
    ...(manager
      ? [
          col.display({
            id: 'actions',
            header: '',
            cell: (c) =>
              c.row.original.status === 'pending' && (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(c.row.original)}>
                    Reject
                  </Button>
                  <ConfirmButton
                    size="sm"
                    variant="default"
                    destructive={false}
                    label="Confirm"
                    title={`Confirm ${formatKes(c.row.original.amountCents)}?`}
                    description="Only if you have the cash. It is added to the tenant's account and a receipt is sent."
                    onConfirm={() => confirm.run(c.row.original.id)}
                  />
                </div>
              ),
          }),
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        title="Cash"
        description="Cash collected on site. It counts only once the owner or a manager confirms it."
        actions={
          <Button onClick={() => setLogging(true)}>
            <Plus /> Log cash
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending">Waiting</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={list.items}
        isPending={list.isPending}
        error={list.error}
        empty={tab === 'pending' ? 'Nothing waiting for confirmation.' : 'No cash logged yet.'}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
      <LogCashDialog open={logging} onOpenChange={setLogging} />
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject this cash?"
        description="Nothing is added to the tenant's account."
        submitLabel="Reject"
        onSubmit={(reason) => reject.run({ id: rejecting!.id, reason })}
      />
    </>
  );
}
