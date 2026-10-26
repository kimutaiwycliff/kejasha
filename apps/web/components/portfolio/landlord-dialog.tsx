'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateClientLandlordBody, UpdateClientLandlordBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { MoneyField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, fieldError, TextField } from '@/components/form';
import { Field, FieldError, FieldLabel } from '@kejasha/ui/components/field';
import { Input } from '@kejasha/ui/components/input';
import { api, unwrap } from '@/lib/api';
import { useWrite } from '@/lib/hooks';

type Landlord = Schemas['ClientLandlord'];
type Values = z.input<typeof UpdateClientLandlordBody>;

const FEE_OPTIONS = [
  { value: 'none', label: 'No management fee' },
  { value: 'percent', label: 'Percent of rent collected' },
  { value: 'flat', label: 'Flat amount per month' },
];

/** Create (no `landlord`) or edit a client landlord. */
export function LandlordDialog({
  open,
  onOpenChange,
  landlord,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  landlord?: Landlord;
  onSaved?: (l: Landlord) => void;
}) {
  const editing = Boolean(landlord);
  const form = useForm<Values>({
    resolver: zodResolver(
      editing ? UpdateClientLandlordBody : CreateClientLandlordBody,
    ) as Resolver<Values>,
  });
  useEffect(() => {
    if (open)
      form.reset({
        name: landlord?.name ?? '',
        phone: landlord?.phone ?? undefined,
        email: landlord?.email ?? undefined,
        kraPin: landlord?.kraPin ?? undefined,
        mgmtFeeKind: landlord?.mgmtFeeKind ?? 'none',
        mgmtFeeBps: landlord?.mgmtFeeBps ?? undefined,
        mgmtFeeFlatCents: landlord?.mgmtFeeFlatCents ?? undefined,
        notes: landlord?.notes ?? undefined,
      });
  }, [open, landlord, form]);
  const kind = form.watch('mgmtFeeKind');
  const save = useWrite(
    async (body: Values, headers) =>
      landlord
        ? unwrap(
            await api.PATCH('/v1/client-landlords/{id}', {
              params: { path: { id: landlord.id } },
              body: body as z.output<typeof UpdateClientLandlordBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/client-landlords', {
              body: body as z.output<typeof CreateClientLandlordBody>,
              headers,
            }),
          ),
    {
      invalidate: [['client-landlords'], ['client-landlord']],
      success: editing ? 'Landlord updated' : 'Landlord added',
    },
  );
  const submit = form.handleSubmit(async (v) => {
    // Send only the fee field that matches the kind (the API rejects a mix).
    const body = {
      ...v,
      mgmtFeeBps: v.mgmtFeeKind === 'percent' ? v.mgmtFeeBps : null,
      mgmtFeeFlatCents: v.mgmtFeeKind === 'flat' ? v.mgmtFeeFlatCents : null,
    };
    try {
      const saved = await save.run(body);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const empty = editing ? null : undefined;
  const bpsError = fieldError(form, 'mgmtFeeBps');
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit landlord' : 'New landlord'}
      description="A property owner whose units your agency manages."
      form={form}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Add landlord'}
    >
      <TextField form={form} name="name" label="Name" />
      <TextField
        form={form}
        name="phone"
        label="Phone"
        type="tel"
        placeholder="0712 345 678"
        empty={empty}
      />
      <TextField form={form} name="email" label="Email" type="email" empty={empty} />
      <TextField
        form={form}
        name="kraPin"
        label="KRA PIN"
        placeholder="A012345678Z"
        empty={empty}
        description="Needed for the Monthly Rental Income return."
      />
      <SelectField form={form} name="mgmtFeeKind" label="Management fee" options={FEE_OPTIONS} />
      {kind === 'percent' && (
        <Field data-invalid={Boolean(bpsError)}>
          <FieldLabel htmlFor="mgmtFeePercent">Fee (% of rent collected)</FieldLabel>
          <Input
            id="mgmtFeePercent"
            inputMode="decimal"
            placeholder="10"
            defaultValue={landlord?.mgmtFeeBps != null ? String(landlord.mgmtFeeBps / 100) : ''}
            onChange={(e) => {
              const t = e.target.value.trim();
              form.setValue(
                'mgmtFeeBps',
                t === ''
                  ? undefined
                  : /^\d{1,3}(\.\d{1,2})?$/.test(t)
                    ? Math.round(Number(t) * 100)
                    : Number.NaN,
              );
            }}
          />
          <FieldError
            errors={[
              bpsError?.message
                ? { message: 'Enter a percent between 0 and 100, e.g. 7.5' }
                : undefined,
            ]}
          />
        </Field>
      )}
      {kind === 'flat' && <MoneyField form={form} name="mgmtFeeFlatCents" label="Fee per month" />}
      <TextareaField form={form} name="notes" label="Notes" empty={empty} />
    </FormDialog>
  );
}
