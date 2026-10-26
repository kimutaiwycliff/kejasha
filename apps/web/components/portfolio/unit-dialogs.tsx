'use client';
import type { Schemas } from '@kejasha/api-client';
import { BulkCreateUnitsBody, CreateUnitBody, UpdateUnitBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { MoneyField, NumberField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { useWrite } from '@/lib/hooks';
import { MODE_LABEL, options } from '@/lib/labels';

type Unit = Schemas['Unit'];
type Values = z.input<typeof UpdateUnitBody>;
type BulkValues = z.input<typeof BulkCreateUnitsBody>;

/** Size, rooms and price fields shared by single and bulk creation (price depends on mode). */
function UnitDetailFields({
  form,
  mode,
  empty,
}: {
  form: UseFormReturn<Values>;
  mode: string | undefined;
  empty: null | undefined;
}) {
  return (
    <>
      {mode === 'short_stay' ? (
        <>
          <MoneyField form={form} name="baseNightlyCents" label="Base nightly rate" empty={empty} />
          <NumberField form={form} name="maxGuests" label="Max guests" min={1} empty={empty} />
        </>
      ) : (
        <>
          <MoneyField form={form} name="rentCents" label="Monthly rent" empty={empty} />
          <MoneyField
            form={form}
            name="depositCents"
            label="Deposit"
            empty={empty}
            description="The usual deposit for this unit; each lease can differ."
          />
        </>
      )}
      <div className="grid grid-cols-2 gap-4">
        <NumberField form={form} name="bedrooms" label="Bedrooms" min={0} empty={empty} />
        <NumberField form={form} name="bathrooms" label="Bathrooms" min={0} empty={empty} />
        <TextField form={form} name="floor" label="Floor" empty={empty} />
        <NumberField form={form} name="sizeSqm" label="Size (m²)" min={1} empty={empty} />
      </div>
    </>
  );
}

export function UnitDialog({
  open,
  onOpenChange,
  propertyId,
  unit,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Required when creating. */
  propertyId?: string;
  unit?: Unit;
  onSaved?: (u: Unit) => void;
}) {
  const editing = Boolean(unit);
  const form = useForm<Values>({
    resolver: zodResolver(editing ? UpdateUnitBody : CreateUnitBody) as Resolver<Values>,
  });
  useEffect(() => {
    if (open)
      form.reset({
        code: unit?.code ?? '',
        mode: unit?.mode ?? 'long_term',
        label: unit?.label ?? undefined,
        bedrooms: unit?.bedrooms ?? undefined,
        bathrooms: unit?.bathrooms ?? undefined,
        floor: unit?.floor ?? undefined,
        sizeSqm: unit?.sizeSqm ?? undefined,
        rentCents: unit?.rentCents ?? undefined,
        depositCents: unit?.depositCents ?? undefined,
        baseNightlyCents: unit?.baseNightlyCents ?? undefined,
        maxGuests: unit?.maxGuests ?? undefined,
        notes: unit?.notes ?? undefined,
      });
  }, [open, unit, form]);
  const mode = form.watch('mode');
  const save = useWrite(
    async (body: Values, headers) =>
      unit
        ? unwrap(
            await api.PATCH('/v1/units/{id}', {
              params: { path: { id: unit.id } },
              body: body as z.output<typeof UpdateUnitBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/properties/{propertyId}/units', {
              params: { path: { propertyId: propertyId! } },
              body: body as z.output<typeof CreateUnitBody>,
              headers,
            }),
          ),
    {
      invalidate: [['units'], ['unit'], ['property'], ['properties']],
      success: editing ? 'Unit updated' : 'Unit added',
    },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.run(v);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const empty = editing ? null : undefined;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit unit ${unit!.code}` : 'New unit'}
      form={form}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Add unit'}
    >
      <TextField
        form={form}
        name="code"
        label="Unit code"
        placeholder="A101"
        description="Tenants pay with this as the Paybill account number."
      />
      <SelectField form={form} name="mode" label="Letting" options={options(MODE_LABEL)} />
      <TextField
        form={form}
        name="label"
        label="Name (optional)"
        placeholder="e.g. Penthouse"
        empty={empty}
      />
      <UnitDetailFields form={form} mode={mode} empty={empty} />
      <TextareaField form={form} name="notes" label="Notes" empty={empty} />
    </FormDialog>
  );
}

const codeFor = (prefix: string, n: number, padding: number) =>
  `${prefix.toUpperCase()}${String(n).padStart(padding, '0')}`;

export function BulkUnitsDialog({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
}) {
  const form = useForm<BulkValues>({ resolver: zodResolver(BulkCreateUnitsBody) });
  useEffect(() => {
    if (open) form.reset({ prefix: 'A', start: 1, count: 10, padding: 2, mode: 'long_term' });
  }, [open, form]);
  const [prefix, start, count, padding, mode] = form.watch([
    'prefix',
    'start',
    'count',
    'padding',
    'mode',
  ]);
  const ok = Number.isInteger(start) && Number.isInteger(count) && count! > 0;
  const preview = ok
    ? `${codeFor(prefix ?? '', start!, padding ?? 0)} … ${codeFor(prefix ?? '', start! + count! - 1, padding ?? 0)}`
    : '';
  const save = useWrite(
    async (body: z.output<typeof BulkCreateUnitsBody>, headers) =>
      unwrap(
        await api.POST('/v1/properties/{propertyId}/units/bulk', {
          params: { path: { propertyId } },
          body,
          headers,
        }),
      ),
    {
      invalidate: [['units'], ['property'], ['properties']],
      success: (r) => `${r.items.length} units added`,
    },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v as z.output<typeof BulkCreateUnitsBody>);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const details = form as unknown as UseFormReturn<Values>;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add many units"
      description="Numbered units with the same details. Edit any unit afterwards."
      form={form}
      onSubmit={submit}
      submitLabel={ok ? `Add ${count} units` : 'Add units'}
      wide
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TextField form={form} name="prefix" label="Prefix" placeholder="A" />
        <NumberField form={form} name="start" label="First number" min={0} />
        <NumberField form={form} name="count" label="How many" min={1} max={500} />
        <NumberField form={form} name="padding" label="Digits" min={0} max={6} />
      </div>
      {preview && <p className="text-sm text-muted-foreground">Codes: {preview}</p>}
      <SelectField form={form} name="mode" label="Letting" options={options(MODE_LABEL)} />
      <UnitDetailFields form={details} mode={mode} empty={undefined} />
    </FormDialog>
  );
}
