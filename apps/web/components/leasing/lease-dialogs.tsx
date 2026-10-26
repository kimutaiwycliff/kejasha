'use client';
import type { Schemas } from '@kejasha/api-client';
import {
  CancelLeaseBody,
  RenewLeaseBody,
  RentChangeBody,
  TerminateLeaseBody,
  UpdateLeaseBody,
} from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { z, ZodType } from 'zod';
import { FormDialog } from '@/components/dialogs';
import {
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  TextareaField,
} from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { todayNairobi } from '@/lib/format';
import { useWrite } from '@/lib/hooks';

export type LeaseDetail = Schemas['LeaseDetail'];

/** Everything a lease write can change on screen. */
export const leaseKeys = (id: string) => [
  ['lease', id],
  ['leases'],
  ['invoices'],
  ['invoice'],
  ['statement', id],
  ['charges', id],
  ['tenant'],
  ['tenants'],
  ['arrears'],
  ['lease-calendar'],
];

/** The next calendar month as YYYY-MM (rent changes apply to months not yet invoiced). */
export function nextMonth() {
  const [y, m] = todayNairobi().split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** A dialog form posting one lease action; resets each time it opens. */
function useLeaseActionForm<S extends ZodType<FieldValues, FieldValues>>(
  schema: S,
  open: boolean,
  defaults: () => DefaultValues<z.input<S>>,
) {
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never),
  });
  // Reset only when the dialog opens (`defaults` is a new function every render).
  useEffect(() => {
    if (open) form.reset(defaults());
  }, [open, form]);
  return form as unknown as UseFormReturn<z.input<S>, unknown, z.output<S>>;
}

interface DialogProps {
  lease: LeaseDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const LATE_FEE = [
  { value: 'none', label: 'No late fee' },
  { value: 'flat', label: 'Flat amount' },
  { value: 'percent', label: 'Percent of the overdue amount' },
];

export function EditTermsDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useLeaseActionForm(UpdateLeaseBody, open, () => ({
    billingDay: lease.billingDay,
    escalationBps: lease.escalationBps ?? undefined,
    escalationEveryMonths: lease.escalationEveryMonths ?? undefined,
    lateFeeKind: lease.lateFeeKind,
    lateFeeFlatCents: lease.lateFeeFlatCents ?? undefined,
    lateFeeBps: lease.lateFeeBps ?? undefined,
    lateFeeGraceDays: lease.lateFeeGraceDays,
    notes: lease.notes ?? undefined,
  }));
  const kind = form.watch('lateFeeKind');
  const save = useWrite(
    async (body: z.output<typeof UpdateLeaseBody>, headers) =>
      unwrap(
        await api.PATCH('/v1/leases/{id}', { params: { path: { id: lease.id } }, body, headers }),
      ),
    { invalidate: leaseKeys(lease.id), success: 'Terms updated' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run({
        ...v,
        lateFeeFlatCents: v.lateFeeKind === 'flat' ? v.lateFeeFlatCents : undefined,
        lateFeeBps: v.lateFeeKind === 'percent' ? v.lateFeeBps : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit terms"
      description="Applies to invoices not yet issued."
      form={form}
      onSubmit={submit}
    >
      <NumberField form={form} name="billingDay" label="Rent due on day" min={1} max={31} />
      <div className="grid grid-cols-2 gap-4">
        <PercentField form={form} name="escalationBps" label="Rent increase" />
        <NumberField
          form={form}
          name="escalationEveryMonths"
          label="Every (months)"
          min={1}
          max={120}
        />
      </div>
      <SelectField form={form} name="lateFeeKind" label="Late fee" options={LATE_FEE} />
      {kind !== 'none' && (
        <div className="grid grid-cols-2 gap-4">
          {kind === 'flat' ? (
            <MoneyField form={form} name="lateFeeFlatCents" label="Late fee" />
          ) : (
            <PercentField form={form} name="lateFeeBps" label="Late fee" />
          )}
          <NumberField form={form} name="lateFeeGraceDays" label="Grace days" min={0} max={60} />
        </div>
      )}
      <TextareaField form={form} name="notes" label="Notes" empty={null} />
    </FormDialog>
  );
}

export function RentChangeDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useLeaseActionForm(RentChangeBody, open, () => ({
    effectivePeriod: nextMonth(),
    rentCents: lease.currentRentCents,
  }));
  const save = useWrite(
    async (body: z.output<typeof RentChangeBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{id}/rent-change', {
          params: { path: { id: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: 'Rent change scheduled' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change rent"
      description="From a month that has not been invoiced yet. Any scheduled increase restarts from it."
      form={form}
      onSubmit={submit}
      submitLabel="Schedule change"
    >
      <TextField form={form} name="effectivePeriod" label="From month" type="month" />
      <MoneyField form={form} name="rentCents" label="New monthly rent" />
    </FormDialog>
  );
}

export function RenewDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useLeaseActionForm(RenewLeaseBody, open, () => ({ endDate: null }));
  const save = useWrite(
    async (body: z.output<typeof RenewLeaseBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{id}/renew', {
          params: { path: { id: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: 'Lease renewed' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run({
        ...v,
        ...(v.rentCents === undefined ? { rentEffectivePeriod: undefined } : {}),
      });
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Renew lease"
      description="Extend the term, optionally with new rent."
      form={form}
      onSubmit={submit}
      submitLabel="Renew"
    >
      <DateField
        form={form}
        name="endDate"
        label="New end date"
        empty={null}
        description="Blank = open-ended"
      />
      <div className="grid grid-cols-2 gap-4">
        <MoneyField form={form} name="rentCents" label="New rent (optional)" />
        <TextField
          form={form}
          name="rentEffectivePeriod"
          label="From month"
          type="month"
          empty={undefined}
        />
      </div>
    </FormDialog>
  );
}

export function TerminateDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useLeaseActionForm(TerminateLeaseBody, open, () => ({
    endDate: todayNairobi(),
    reason: '',
  }));
  const save = useWrite(
    async (body: z.output<typeof TerminateLeaseBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{id}/terminate', {
          params: { path: { id: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: 'Lease ended' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="End lease"
      description="The last month is prorated and later invoices are voided. Settle the deposit afterwards."
      form={form}
      onSubmit={submit}
      submitLabel="End lease"
    >
      <DateField form={form} name="endDate" label="Last day" />
      <TextareaField form={form} name="reason" label="Reason" />
    </FormDialog>
  );
}

export function CancelDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useLeaseActionForm(CancelLeaseBody, open, () => ({ reason: '' }));
  const save = useWrite(
    async (body: z.output<typeof CancelLeaseBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{id}/cancel', {
          params: { path: { id: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: 'Lease cancelled' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel lease"
      description="For a lease entered by mistake or a tenant who never moved in. Its invoices are voided; payments become credit."
      form={form}
      onSubmit={submit}
      submitLabel="Cancel lease"
    >
      <TextareaField form={form} name="reason" label="Reason" />
    </FormDialog>
  );
}
