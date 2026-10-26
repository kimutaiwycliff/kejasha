'use client';
import type { Schemas } from '@kejasha/api-client';
import {
  CreateChargeBody,
  CreateCreditNoteBody,
  DepositSettlementBody,
  ManualInvoiceBody,
  UpdateChargeBody,
} from '@kejasha/contracts';
import { Button } from '@kejasha/ui/components/button';
import { Label } from '@kejasha/ui/components/label';
import { Switch } from '@kejasha/ui/components/switch';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Details } from '@/components/detail';
import { FormDialog } from '@/components/dialogs';
import { DateField, MoneyField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { formatKes, todayNairobi } from '@/lib/format';
import { useWrite } from '@/lib/hooks';
import { CHARGE_KIND_LABEL, METER_KIND_LABEL, options } from '@/lib/labels';
import { leaseKeys, type LeaseDetail } from './lease-dialogs';

interface DialogProps {
  lease: LeaseDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const LINE_KINDS = options(CHARGE_KIND_LABEL);

type InvoiceValues = z.input<typeof ManualInvoiceBody>;
export function ManualInvoiceDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useForm<InvoiceValues, unknown, z.output<typeof ManualInvoiceBody>>({
    resolver: zodResolver(ManualInvoiceBody),
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  useEffect(() => {
    if (open)
      form.reset({
        dueOn: todayNairobi(),
        lines: [{ kind: 'other', description: '', amountCents: undefined as unknown as number }],
      });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof ManualInvoiceBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{leaseId}/invoices', {
          params: { path: { leaseId: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: (i) => `Invoice ${i.number} issued` },
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
      title="One-off invoice"
      description="For something outside the monthly bill, e.g. a repair the tenant caused."
      form={form}
      onSubmit={submit}
      submitLabel="Issue invoice"
      wide
    >
      <DateField form={form} name="dueOn" label="Due on" />
      {lines.fields.map((f, i) => (
        <div
          key={f.id}
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[10rem_1fr_9rem_auto]"
        >
          <SelectField form={form} name={`lines.${i}.kind`} label="Type" options={LINE_KINDS} />
          <TextField form={form} name={`lines.${i}.description`} label="Description" />
          <MoneyField form={form} name={`lines.${i}.amountCents`} label="Amount" />
          <Button
            type="button"
            variant="ghost"
            aria-label="Remove line"
            disabled={lines.fields.length === 1}
            onClick={() => lines.remove(i)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() =>
          lines.append({
            kind: 'other',
            description: '',
            amountCents: undefined as unknown as number,
          })
        }
      >
        <Plus /> Add line
      </Button>
    </FormDialog>
  );
}

type CreditValues = z.input<typeof CreateCreditNoteBody>;
export function CreditNoteDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useForm<CreditValues, unknown, z.output<typeof CreateCreditNoteBody>>({
    resolver: zodResolver(CreateCreditNoteBody),
  });
  useEffect(() => {
    if (open) form.reset({ reason: '' });
  }, [open, form]);
  const open_ = useQuery({
    queryKey: ['invoices', { leaseId: lease.id, open: true }],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/invoices', { params: { query: { leaseId: lease.id, limit: 100 } } }),
      ).items.filter((i) => i.outstandingCents > 0),
    enabled: open,
  });
  const save = useWrite(
    async (body: z.output<typeof CreateCreditNoteBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{leaseId}/credit-notes', {
          params: { path: { leaseId: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: (c) => `Credit note ${c.number} issued` },
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
      title="Credit note"
      description="Reduces what the tenant owes, e.g. a discount or a correction."
      form={form}
      onSubmit={submit}
      submitLabel="Issue credit note"
    >
      <MoneyField form={form} name="amountCents" label="Amount" />
      <SelectField
        form={form}
        name="invoiceId"
        label="Against invoice (optional)"
        placeholder="Oldest unpaid first"
        options={(open_.data ?? []).map((i) => ({
          value: i.id,
          label: `${i.number} · ${formatKes(i.outstandingCents)} due`,
        }))}
      />
      <TextareaField form={form} name="reason" label="Reason" />
    </FormDialog>
  );
}

type DepositValues = z.input<typeof DepositSettlementBody>;
export function DepositDialog({ lease, open, onOpenChange }: DialogProps) {
  const form = useForm<DepositValues, unknown, z.output<typeof DepositSettlementBody>>({
    resolver: zodResolver(DepositSettlementBody),
  });
  const deductions = useFieldArray({ control: form.control, name: 'deductions' });
  const [result, setResult] = useState<Schemas['DepositSettlement'] | null>(null);
  useEffect(() => {
    if (open) {
      form.reset({ deductions: [], applyToArrears: true });
      setResult(null);
    }
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof DepositSettlementBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{leaseId}/deposit-settlement', {
          params: { path: { leaseId: lease.id } },
          body,
          headers,
        }),
      ),
    { invalidate: leaseKeys(lease.id), success: 'Deposit settled' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      setResult(await save.run(v));
    } catch (e) {
      applyProblem(form, e);
    }
  });
  if (result)
    return (
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Deposit settled"
        form={form}
        onSubmit={(e) => {
          e.preventDefault();
          onOpenChange(false);
        }}
        submitLabel="Done"
      >
        <Details
          items={[
            ['Deposit held', formatKes(result.depositHeldCents)],
            ['Deductions', formatKes(result.deductionsCents)],
            ['Applied to arrears', formatKes(result.appliedToArrearsCents)],
            ['Refund due to tenant', <strong key="r">{formatKes(result.refundDueCents)}</strong>],
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Pay the refund from your own account; Kejasha never holds tenant money.
        </p>
      </FormDialog>
    );
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settle deposit"
      description={`Held: ${formatKes(lease.depositHeldCents)}. Deductions become income, then arrears are cleared, and the rest is a refund due.`}
      form={form}
      onSubmit={submit}
      submitLabel="Settle"
      wide
    >
      {deductions.fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-[1fr_9rem_auto] items-end gap-3">
          <TextField
            form={form}
            name={`deductions.${i}.description`}
            label="Deduction"
            placeholder="e.g. Broken window"
          />
          <MoneyField form={form} name={`deductions.${i}.amountCents`} label="Amount" />
          <Button
            type="button"
            variant="ghost"
            aria-label="Remove deduction"
            onClick={() => deductions.remove(i)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() =>
          deductions.append({ description: '', amountCents: undefined as unknown as number })
        }
      >
        <Plus /> Add deduction
      </Button>
      <Controller
        control={form.control}
        name="applyToArrears"
        render={({ field }) => (
          <Label className="flex items-center gap-3 font-normal">
            <Switch checked={field.value ?? true} onCheckedChange={field.onChange} /> Use the
            deposit to clear unpaid rent
          </Label>
        )}
      />
    </FormDialog>
  );
}

type ChargeValues = z.input<typeof CreateChargeBody>;
/** Add a recurring charge, or (with `charge`) change its amount, label or end date. */
export function ChargeDialog({
  lease,
  charge,
  open,
  onOpenChange,
}: DialogProps & { charge?: Schemas['ChargeRule'] }) {
  const editing = Boolean(charge);
  const form = useForm<ChargeValues>({
    resolver: zodResolver(editing ? UpdateChargeBody : CreateChargeBody) as never,
  });
  useEffect(() => {
    if (open)
      form.reset(
        charge
          ? {
              kind: charge.kind,
              method: charge.method,
              label: charge.label,
              amountCents: charge.amountCents ?? undefined,
              unitPriceCents: charge.unitPriceCents ?? undefined,
              endsOn: charge.endsOn ?? undefined,
            }
          : { kind: 'service_charge', method: 'flat' },
      );
  }, [open, charge, form]);
  const method = form.watch('method');
  const meters = useQuery({
    queryKey: ['meters', lease.unitId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/units/{unitId}/meters', { params: { path: { unitId: lease.unitId } } }),
      ).items,
    enabled: open && !editing,
  });
  const save = useWrite(
    async (v: ChargeValues, headers) =>
      charge
        ? unwrap(
            await api.PATCH('/v1/charges/{id}', {
              params: { path: { id: charge.id } },
              body: {
                label: v.label,
                ...(charge.method === 'flat'
                  ? { amountCents: v.amountCents }
                  : { unitPriceCents: v.unitPriceCents }),
                endsOn: v.endsOn ?? null,
              } as z.output<typeof UpdateChargeBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/leases/{leaseId}/charges', {
              params: { path: { leaseId: lease.id } },
              body: {
                ...v,
                ...(v.method === 'flat'
                  ? { unitPriceCents: undefined, meterId: undefined }
                  : { amountCents: undefined }),
              } as z.output<typeof CreateChargeBody>,
              headers,
            }),
          ),
    { invalidate: leaseKeys(lease.id), success: editing ? 'Charge updated' : 'Charge added' },
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
      title={editing ? 'Edit charge' : 'New charge'}
      description="Billed with the rent each month from its start date."
      form={form}
      onSubmit={submit}
    >
      {!editing && (
        <>
          <SelectField form={form} name="kind" label="Charge" options={LINE_KINDS} />
          <SelectField
            form={form}
            name="method"
            label="How it is billed"
            options={[
              { value: 'flat', label: 'Same amount every month' },
              { value: 'metered', label: 'By meter reading' },
            ]}
          />
        </>
      )}
      <TextField form={form} name="label" label="Label on invoices" empty={undefined} />
      {method === 'metered' ? (
        <>
          {!editing && (
            <SelectField
              form={form}
              name="meterId"
              label="Meter"
              placeholder={meters.data?.length === 0 ? 'This unit has no meters' : 'Choose a meter'}
              options={(meters.data ?? []).map((m) => ({
                value: m.id,
                label: `${METER_KIND_LABEL[m.kind]}${m.serial ? ` · ${m.serial}` : ''}`,
              }))}
            />
          )}
          <MoneyField form={form} name="unitPriceCents" label="Price per unit (m³ / kWh)" />
        </>
      ) : (
        <MoneyField form={form} name="amountCents" label="Per month" />
      )}
      {!editing && <DateField form={form} name="startsOn" label="Starts (default: lease start)" />}
      <DateField form={form} name="endsOn" label="Ends (optional)" />
    </FormDialog>
  );
}
