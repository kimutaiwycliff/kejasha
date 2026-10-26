'use client';
import { PortalPayBody, PortalTicketBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { MoneyField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, ApiError, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { useWrite } from '@/lib/hooks';
import { options, TICKET_CATEGORY_LABEL } from '@/lib/labels';

type Lease = { leaseId: string; unitCode: string; balanceCents: number };
const portalKeys = [['portal']];

/** Sends an M-Pesa prompt to the tenant's own phone, paying into the landlord's Paybill/Till. */
export function PortalPayDialog({
  lease,
  onOpenChange,
}: {
  lease: Lease | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [sent, setSent] = useState(false);
  const form = useForm<z.input<typeof PortalPayBody>, unknown, z.output<typeof PortalPayBody>>({
    resolver: zodResolver(PortalPayBody),
  });
  useEffect(() => {
    if (lease) {
      form.reset({});
      setSent(false);
    }
  }, [lease, form]);
  const pay = useWrite(
    async (body: z.output<typeof PortalPayBody>, headers) =>
      unwrap(
        await api.POST('/v1/portal/leases/{leaseId}/pay', {
          params: { path: { leaseId: lease!.leaseId } },
          body,
          headers,
        }),
      ),
    { invalidate: portalKeys },
  );
  const submit = form.handleSubmit(async (v) => {
    if (sent) return onOpenChange(false);
    try {
      await pay.run(v);
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_channel')
        form.setError('amountCents', {
          message: 'Your landlord has not connected M-Pesa yet. Pay them the usual way.',
        });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={lease !== null}
      onOpenChange={onOpenChange}
      title={sent ? 'Check your phone' : `Pay rent for ${lease?.unitCode ?? ''}`}
      description={
        sent
          ? 'Enter your M-Pesa PIN on the prompt. Your balance updates a minute after you pay, and you get an SMS receipt.'
          : `You owe ${formatKes(Math.max(0, lease?.balanceCents ?? 0))}. The money goes straight to your landlord.`
      }
      form={form}
      onSubmit={submit}
      submitLabel={sent ? 'Done' : 'Send M-Pesa prompt'}
    >
      {!sent && (
        <MoneyField
          form={form}
          name="amountCents"
          label="Amount (optional)"
          description="Leave blank to pay the full balance."
        />
      )}
    </FormDialog>
  );
}

const CATEGORIES = options(TICKET_CATEGORY_LABEL);

export function PortalTicketDialog({
  lease,
  onOpenChange,
}: {
  lease: Lease | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<
    z.input<typeof PortalTicketBody>,
    unknown,
    z.output<typeof PortalTicketBody>
  >({
    resolver: zodResolver(PortalTicketBody),
  });
  useEffect(() => {
    if (lease) form.reset({ leaseId: lease.leaseId, title: '', category: 'plumbing' });
  }, [lease, form]);
  const save = useWrite(
    async (body: z.output<typeof PortalTicketBody>, headers) =>
      unwrap(await api.POST('/v1/portal/tickets', { body, headers })),
    { invalidate: portalKeys, success: 'Sent to your landlord' },
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
      open={lease !== null}
      onOpenChange={onOpenChange}
      title="Report a problem"
      form={form}
      onSubmit={submit}
      submitLabel="Send"
    >
      <TextField
        form={form}
        name="title"
        label="What is wrong"
        placeholder="e.g. No water in the kitchen"
      />
      <SelectField form={form} name="category" label="Type" options={CATEGORIES} />
      <TextareaField form={form} name="description" label="Details" />
    </FormDialog>
  );
}
