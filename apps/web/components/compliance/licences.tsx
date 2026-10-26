'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateLicenceBody, UpdateLicenceBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { columnsFor, DataTable } from '@/components/data-table';
import { ConfirmButton, FormDialog } from '@/components/dialogs';
import { DateField, MoneyField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { FilterSelect } from '@/components/filter-select';
import { usePropertyOptions } from '@/components/portfolio/property-picker';
import { useShortStayUnitOptions } from '@/components/shortstay/pickers';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { toastError, useCan, useWrite } from '@/lib/hooks';
import { LICENCE_KIND_LABEL, options } from '@/lib/labels';
import { uploadFile } from '@/lib/upload';

type Licence = Schemas['Licence'];
type Values = z.input<typeof UpdateLicenceBody> & z.input<typeof CreateLicenceBody>;
const TONE = { valid: 'default', expiring: 'secondary', expired: 'destructive' } as const;
const STATUS_LABEL = { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired' } as const;

function DocumentField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (k: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      disabled={busy}
      render={<label />}
      nativeButton={false}
    >
      <FileUp />{' '}
      {busy ? 'Uploading…' : value ? 'Document attached' : 'Attach the licence (photo or PDF)'}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            onChange(await uploadFile(f, 'licence_document'));
          } catch (err) {
            toastError(err);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Button>
  );
}

/** Add a licence (licence = undefined) or renew/edit one. */
function LicenceDialog({
  licence,
  open,
  onOpenChange,
}: {
  licence?: Licence;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const editing = Boolean(licence);
  const [scope, setScope] = useState<'unit' | 'property'>('unit');
  const props = usePropertyOptions();
  const form = useForm<Values>({
    resolver: zodResolver(
      editing ? UpdateLicenceBody : CreateLicenceBody,
    ) as unknown as Resolver<Values>,
  });
  useEffect(() => {
    if (open)
      form.reset(
        licence
          ? {
              number: licence.number ?? undefined,
              issuer: licence.issuer ?? undefined,
              issuedOn: licence.issuedOn ?? undefined,
              expiresOn: licence.expiresOn,
              feeCents: licence.feeCents ?? undefined,
              notes: licence.notes ?? undefined,
            }
          : { kind: 'tra_short_stay' },
      );
  }, [open, licence, form]);
  const save = useWrite(
    async (v: Values, headers) =>
      licence
        ? unwrap(
            await api.PATCH('/v1/licences/{id}', {
              params: { path: { id: licence.id } },
              body: v as z.output<typeof UpdateLicenceBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/licences', {
              body: v as z.output<typeof CreateLicenceBody>,
              headers,
            }),
          ),
    { invalidate: [['licences']], success: editing ? 'Licence updated' : 'Licence added' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(
        editing
          ? v
          : scope === 'unit'
            ? { ...v, propertyId: undefined }
            : { ...v, unitId: undefined },
      );
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const empty = editing ? null : undefined;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Renew or edit licence' : 'Add a licence'}
      description={
        editing
          ? 'For a renewal, set the new expiry date and attach the new document.'
          : 'You are reminded before it expires.'
      }
      form={form}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Add licence'}
    >
      {!editing && (
        <>
          <SelectField form={form} name="kind" label="Type" options={options(LICENCE_KIND_LABEL)} />
          <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <TabsList>
              <TabsTrigger value="unit">One unit</TabsTrigger>
              <TabsTrigger value="property">Whole property</TabsTrigger>
            </TabsList>
          </Tabs>
          {scope === 'unit' ? (
            <ComboField
              form={form}
              name="unitId"
              label="Unit"
              placeholder="Search unit code"
              useOptions={useShortStayUnitOptions}
            />
          ) : (
            <SelectField
              form={form}
              name="propertyId"
              label="Property"
              options={props.data ?? []}
            />
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-4">
        <TextField form={form} name="number" label="Licence number" empty={empty} />
        <TextField form={form} name="issuer" label="Issued by" empty={empty} />
        <DateField form={form} name="issuedOn" label="Issued on" empty={empty} />
        <DateField form={form} name="expiresOn" label="Expires on" />
        <MoneyField form={form} name="feeCents" label="Fee paid" empty={empty} />
      </div>
      <Controller
        control={form.control}
        name="documentKey"
        render={({ field }) => <DocumentField value={field.value} onChange={field.onChange} />}
      />
      <TextareaField form={form} name="notes" label="Notes" empty={empty} />
    </FormDialog>
  );
}

const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
];

export function LicencesTab() {
  const manager = useCan('manager');
  const [status, setStatus] = useState<Licence['status']>();
  const [dialog, setDialog] = useState<Licence | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['licences', status],
    queryFn: async () =>
      unwrap(await api.GET('/v1/licences', { params: { query: status ? { status } : {} } })).items,
  });
  const archive = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/licences/{id}', { params: { path: { id } }, headers })),
    { invalidate: [['licences']], success: 'Licence archived' },
  );
  const col = columnsFor<Licence>();
  const columns = [
    col.accessor('kind', {
      header: 'Licence',
      meta: { className: 'whitespace-normal' },
      cell: (c) => (
        <div>
          <p className="font-medium">{LICENCE_KIND_LABEL[c.getValue()]}</p>
          <p className="text-xs text-muted-foreground">
            {c.row.original.unitCode ? `${c.row.original.unitCode} · ` : ''}
            {c.row.original.propertyName}
            {c.row.original.number ? ` · ${c.row.original.number}` : ''}
          </p>
        </div>
      ),
    }),
    col.accessor('expiresOn', {
      header: 'Expires',
      cell: (c) => (
        <div className="flex flex-col gap-1">
          <span>{formatDate(c.getValue())}</span>
          <Badge variant={TONE[c.row.original.status]}>
            {STATUS_LABEL[c.row.original.status]}
            {c.row.original.status === 'expiring' ? ` · ${c.row.original.daysToExpiry} days` : ''}
          </Badge>
        </div>
      ),
    }),
    col.accessor('feeCents', {
      header: 'Fee',
      meta: { align: 'right', hideOnMobile: true },
      cell: (c) => (c.getValue() == null ? '—' : formatKes(c.getValue())),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          {c.row.original.document && (
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<a href={c.row.original.document.url} target="_blank" rel="noreferrer" />}
            >
              View
            </Button>
          )}
          {manager && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Renew or edit"
                onClick={() => setDialog(c.row.original)}
              >
                <Pencil />
              </Button>
              <ConfirmButton
                size="sm"
                variant="ghost"
                label={<Trash2 />}
                title="Archive this licence?"
                description="Reminders stop. Use this when the unit no longer needs it."
                confirmLabel="Archive"
                onConfirm={() => archive.run(c.row.original.id)}
              />
            </>
          )}
        </div>
      ),
    }),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterSelect label="Status" options={STATUSES} value={status} onChange={setStatus} />
        {manager && (
          <Button onClick={() => setDialog('new')}>
            <Plus /> Add licence
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        data={list.data ?? []}
        isPending={list.isPending}
        error={list.error}
        empty="No licences recorded. Short-stay units need a TRA licence."
      />
      <LicenceDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        licence={dialog && dialog !== 'new' ? dialog : undefined}
      />
    </div>
  );
}
