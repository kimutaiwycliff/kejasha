'use client';
import type { Schemas } from '@kejasha/api-client';
import { ManualPaymentBody, SmsPaymentBody, StkRequestBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Field, FieldDescription, FieldError, FieldLabel } from '@kejasha/ui/components/field';
import { Input } from '@kejasha/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { Details } from '@/components/detail';
import { FormDialog } from '@/components/dialogs';
import { DateField, MoneyField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, ApiError, unwrap } from '@/lib/api';
import { formatKes, todayNairobi } from '@/lib/format';
import { errorMessage, useWrite } from '@/lib/hooks';
import { options, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { uploadFile } from '@/lib/upload';
import { useActiveLeaseOptions } from './lease-picker';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/** Everything a payment write can change on screen. */
export const paymentKeys = [
  ['payments'],
  ['payment'],
  ['leases'],
  ['lease'],
  ['invoices'],
  ['invoice'],
  ['arrears'],
  ['tenants'],
  ['tenant'],
  ['statement'],
];

type ManualValues = z.input<typeof ManualPaymentBody>;
export function ManualPaymentDialog({ open, onOpenChange, leaseId }: Props & { leaseId?: string }) {
  const form = useForm<ManualValues, unknown, z.output<typeof ManualPaymentBody>>({
    resolver: zodResolver(ManualPaymentBody),
  });
  useEffect(() => {
    if (open) form.reset({ method: 'cash', paidOn: todayNairobi(), leaseId });
  }, [open, form, leaseId]);
  const save = useWrite(
    async (body: z.output<typeof ManualPaymentBody>, headers) =>
      unwrap(await api.POST('/v1/payments', { body, headers })),
    { invalidate: paymentKeys, success: (p) => `${formatKes(p.amountCents)} recorded` },
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
      title="Record a payment"
      description="Money received outside your Paybill, e.g. a bank transfer or cash you took yourself."
      form={form}
      onSubmit={submit}
      submitLabel="Record payment"
    >
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          form={form}
          name="method"
          label="Method"
          options={options(PAYMENT_METHOD_LABEL)}
        />
        <MoneyField form={form} name="amountCents" label="Amount" />
        <DateField form={form} name="paidOn" label="Received on" />
        <TextField
          form={form}
          name="reference"
          label="Reference"
          empty={undefined}
          description="Generated if blank"
        />
      </div>
      {!leaseId && (
        <ComboField
          form={form}
          name="leaseId"
          label="Lease (optional)"
          placeholder="Tenant or unit"
          description="Leave blank to match it later from the queue."
          useOptions={useActiveLeaseOptions}
        />
      )}
      <TextField form={form} name="payerName" label="Paid by" empty={undefined} />
      <TextareaField form={form} name="notes" label="Notes" />
    </FormDialog>
  );
}

type Import = Schemas['StatementImport'];
const FORMAT_FOR = (f: File) =>
  f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    ? ({ format: 'mpesa_statement_pdf', type: 'application/pdf' } as const)
    : ({ format: 'mpesa_business_csv', type: 'text/csv' } as const);

/** Upload an M-Pesa statement (business CSV or personal PDF); new credits join the payments list. */
export function StatementImportDialog({ open, onOpenChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Import | null>(null);
  const form = useForm();
  useEffect(() => {
    if (open) {
      setFile(null);
      setPassword('');
      setError(null);
      setResult(null);
    }
  }, [open]);
  const save = useWrite(
    async (body: Schemas['StatementImportBodyInput'], headers) =>
      unwrap(await api.POST('/v1/statement-imports', { body, headers })),
    { invalidate: paymentKeys },
  );
  const pdf = file ? FORMAT_FOR(file).format === 'mpesa_statement_pdf' : false;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (result) return onOpenChange(false);
    if (!file) return setError('Choose a statement file.');
    setBusy(true);
    setError(null);
    try {
      const { format, type } = FORMAT_FOR(file);
      const fileKey = await uploadFile(file, 'statement', type);
      const r = await save.run({ fileKey, format, ...(pdf && password ? { password } : {}) });
      if (r.status === 'failed') setError(r.error ?? 'The statement could not be read.');
      else setResult(r);
    } catch (err) {
      setError(
        err instanceof ApiError ? errorMessage(err) : 'Upload failed. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import an M-Pesa statement"
      description="For payments that did not come through a connected Paybill. Payments already imported are skipped."
      form={form}
      onSubmit={submit}
      submitLabel={result ? 'Done' : busy ? 'Importing…' : 'Import'}
    >
      {result ? (
        <Details
          items={[
            [
              'Period',
              result.periodFrom && result.periodTo
                ? `${result.periodFrom} – ${result.periodTo}`
                : null,
            ],
            ['Money in', `${result.rowsCredits} of ${result.rowsTotal} rows`],
            ['New payments', result.rowsNew],
            ['Already imported', result.rowsDuplicate],
            ['Matched to a tenant', result.rowsMatched],
            ['Left to match', result.rowsNew - result.rowsMatched],
          ]}
        />
      ) : (
        <>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="statement-file">Statement file</FieldLabel>
            <Input
              id="statement-file"
              type="file"
              accept=".csv,.pdf,text/csv,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <FieldDescription>
              Business statement (CSV) or a personal M-Pesa statement (PDF).
            </FieldDescription>
            <FieldError errors={[error ? { message: error } : undefined]} />
          </Field>
          {pdf && (
            <Field>
              <FieldLabel htmlFor="statement-password">PDF password</FieldLabel>
              <Input
                id="statement-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldDescription>
                Usually your ID number, as in the Safaricom email.
              </FieldDescription>
            </Field>
          )}
        </>
      )}
    </FormDialog>
  );
}

type SmsValues = z.input<typeof SmsPaymentBody>;
/** Paste an M-Pesa confirmation SMS (for landlords paid to a personal number). */
export function SmsPaymentDialog({ open, onOpenChange }: Props) {
  const form = useForm<SmsValues, unknown, z.output<typeof SmsPaymentBody>>({
    resolver: zodResolver(SmsPaymentBody),
  });
  useEffect(() => {
    if (open) form.reset({ text: '' });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof SmsPaymentBody>, headers) =>
      unwrap(await api.POST('/v1/sms-payments', { body, headers })),
    {
      invalidate: paymentKeys,
      success: (p) =>
        p.matchStatus === 'matched'
          ? `${formatKes(p.amountCents)} matched to ${p.tenantName}`
          : `${formatKes(p.amountCents)} added to the unmatched queue`,
    },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sms_not_recognised')
        form.setError('text', {
          message: 'That does not look like an M-Pesa payment received SMS.',
        });
      else if (e instanceof ApiError && e.status === 409)
        form.setError('text', { message: 'This payment is already recorded.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a payment from SMS"
      description="Paste the M-Pesa message you received, e.g. “QK12AB34CD Confirmed. You have received Ksh 15,000.00 from …”."
      form={form}
      onSubmit={submit}
      submitLabel="Add payment"
    >
      <TextareaField form={form} name="text" label="M-Pesa message" />
    </FormDialog>
  );
}

const STK_STATUS = {
  pending: { label: 'Waiting for the tenant to enter their PIN…', tone: 'secondary' },
  succeeded: { label: 'Paid', tone: 'default' },
  failed: { label: 'Failed', tone: 'destructive' },
  cancelled: { label: 'Cancelled by the tenant', tone: 'destructive' },
  timeout: { label: 'No response from the phone', tone: 'destructive' },
} as const;

type StkValues = z.input<typeof StkRequestBody>;
/** Send an M-Pesa payment prompt (STK Push) to the tenant's phone via your own Paybill/Till. */
export function StkDialog({ open, onOpenChange, leaseId }: Props & { leaseId?: string }) {
  const form = useForm<StkValues, unknown, z.output<typeof StkRequestBody>>({
    resolver: zodResolver(StkRequestBody),
  });
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      form.reset({ leaseId });
      setRequestId(null);
    }
  }, [open, form, leaseId]);
  const req = useQuery({
    queryKey: ['stk', requestId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/stk-requests/{id}', { params: { path: { id: requestId! } } })),
    enabled: Boolean(requestId),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 3000 : false),
  });
  const save = useWrite(
    async (body: z.output<typeof StkRequestBody>, headers) =>
      unwrap(await api.POST('/v1/stk-requests', { body, headers })),
    { invalidate: [] },
  );
  const submit = form.handleSubmit(async (v) => {
    if (requestId) return onOpenChange(false);
    try {
      setRequestId((await save.run(v)).id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_channel')
        form.setError('leaseId', {
          message: 'Connect a Paybill or Till with Daraja credentials first (M-Pesa setup).',
        });
      else applyProblem(form, e);
    }
  });
  const s = req.data;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request M-Pesa payment"
      description="The tenant gets a prompt on their phone to pay into your Paybill or Till."
      form={form}
      onSubmit={submit}
      submitLabel={requestId ? 'Close' : 'Send request'}
    >
      {requestId ? (
        <div className="flex flex-col gap-3 text-sm">
          <Badge variant={STK_STATUS[s?.status ?? 'pending'].tone}>
            {STK_STATUS[s?.status ?? 'pending'].label}
          </Badge>
          {s && (
            <Details
              items={[
                ['Amount', formatKes(s.amountCents)],
                ['Phone', s.msisdn],
                ['Account', s.accountRef],
                ...(s.resultDesc ? ([['M-Pesa says', s.resultDesc]] as [string, string][]) : []),
              ]}
            />
          )}
        </div>
      ) : (
        <>
          {!leaseId && (
            <ComboField
              form={form}
              name="leaseId"
              label="Lease"
              placeholder="Tenant or unit"
              useOptions={useActiveLeaseOptions}
            />
          )}
          <MoneyField
            form={form}
            name="amountCents"
            label="Amount (optional)"
            description="Defaults to the balance owed."
          />
          <TextField
            form={form}
            name="phone"
            label="Phone (optional)"
            type="tel"
            empty={undefined}
            description="Defaults to the tenant's phone."
          />
        </>
      )}
    </FormDialog>
  );
}
