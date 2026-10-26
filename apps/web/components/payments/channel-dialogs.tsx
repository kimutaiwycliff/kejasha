'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateChannelBody, SetCredentialsBody, UpdateChannelBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kejasha/ui/components/dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { SelectField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { useLandlordOptions } from '@/components/portfolio/property-dialog';
import { api, unwrap } from '@/lib/api';
import { errorMessage, useOrgKind, useWrite } from '@/lib/hooks';
import { CHANNEL_KIND_LABEL, options } from '@/lib/labels';

type Channel = Schemas['PaymentChannel'];
const ENV = [
  { value: 'sandbox', label: 'Sandbox (testing)' },
  { value: 'production', label: 'Production (live money)' },
];

type CreateValues = z.input<typeof CreateChannelBody>;
export function NewChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const agency = useOrgKind() === 'agency';
  const landlords = useLandlordOptions(agency && open);
  const form = useForm<CreateValues, unknown, z.output<typeof CreateChannelBody>>({
    resolver: zodResolver(CreateChannelBody),
  });
  useEffect(() => {
    if (open)
      form.reset({ kind: 'paybill', shortcode: '', displayName: '', darajaEnv: 'production' });
  }, [open, form]);
  const kind = form.watch('kind');
  const save = useWrite(
    async (body: z.output<typeof CreateChannelBody>, headers) =>
      unwrap(await api.POST('/v1/payment-channels', { body, headers })),
    { invalidate: [['payment-channels']], success: 'Channel added' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v.kind === 'phone' ? { ...v, darajaEnv: undefined } : v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add where tenants pay"
      description="Money always goes straight to you. Kejasha never holds it."
      form={form}
      onSubmit={submit}
      submitLabel="Add"
    >
      <SelectField form={form} name="kind" label="Type" options={options(CHANNEL_KIND_LABEL)} />
      <TextField
        form={form}
        name="shortcode"
        label={
          kind === 'phone'
            ? 'M-Pesa phone number'
            : `${kind === 'till' ? 'Till' : 'Paybill'} number`
        }
        inputMode="numeric"
      />
      <TextField
        form={form}
        name="displayName"
        label="Name"
        placeholder="e.g. Wanjiku Homes Paybill"
      />
      {agency && (
        <SelectField
          form={form}
          name="clientLandlordId"
          label="Landlord (optional)"
          options={landlords.data ?? []}
        />
      )}
      {kind !== 'phone' && (
        <SelectField form={form} name="darajaEnv" label="Daraja environment" options={ENV} />
      )}
    </FormDialog>
  );
}

type UpdateValues = z.input<typeof UpdateChannelBody>;
export function EditChannelDialog({
  channel,
  onOpenChange,
}: {
  channel: Channel | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<UpdateValues, unknown, z.output<typeof UpdateChannelBody>>({
    resolver: zodResolver(UpdateChannelBody),
  });
  useEffect(() => {
    if (channel)
      form.reset({
        displayName: channel.displayName,
        status: channel.status,
        darajaEnv: channel.darajaEnv,
      });
  }, [channel, form]);
  const save = useWrite(
    async (body: z.output<typeof UpdateChannelBody>, headers) =>
      unwrap(
        await api.PATCH('/v1/payment-channels/{id}', {
          params: { path: { id: channel!.id } },
          body,
          headers,
        }),
      ),
    { invalidate: [['payment-channels']], success: 'Saved' },
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
      open={channel !== null}
      onOpenChange={onOpenChange}
      title="Edit channel"
      form={form}
      onSubmit={submit}
    >
      <TextField form={form} name="displayName" label="Name" />
      <SelectField
        form={form}
        name="status"
        label="Status"
        options={[
          { value: 'active', label: 'Active' },
          { value: 'disabled', label: 'Disabled' },
        ]}
      />
      {channel?.kind !== 'phone' && (
        <SelectField form={form} name="darajaEnv" label="Daraja environment" options={ENV} />
      )}
    </FormDialog>
  );
}

type CredValues = z.input<typeof SetCredentialsBody>;
/** Write-only: the API stores the keys encrypted and never returns them (ADR-008). */
export function CredentialsDialog({
  channel,
  onOpenChange,
}: {
  channel: Channel | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<CredValues, unknown, z.output<typeof SetCredentialsBody>>({
    resolver: zodResolver(SetCredentialsBody),
  });
  useEffect(() => {
    if (channel) form.reset({ consumerKey: '', consumerSecret: '' });
  }, [channel, form]);
  const save = useWrite(
    async (body: z.output<typeof SetCredentialsBody>, headers) =>
      unwrap(
        await api.PUT('/v1/payment-channels/{id}/credentials', {
          params: { path: { id: channel!.id } },
          body,
          headers,
        }),
      ),
    { invalidate: [['payment-channels']], success: 'Credentials saved' },
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
      open={channel !== null}
      onOpenChange={onOpenChange}
      title="Daraja credentials"
      description={`From your app on the Safaricom developer portal (developer.safaricom.co.ke). Stored encrypted and never shown again${channel?.hasCredentials ? '; saving replaces the current keys' : ''}.`}
      form={form}
      onSubmit={submit}
      submitLabel="Save credentials"
    >
      <TextField form={form} name="consumerKey" label="Consumer key" autoComplete="off" />
      <TextField
        form={form}
        name="consumerSecret"
        label="Consumer secret"
        type="password"
        autoComplete="new-password"
      />
      <TextField
        form={form}
        name="passkey"
        label="Lipa na M-Pesa passkey (optional)"
        type="password"
        autoComplete="new-password"
        empty={undefined}
        description="Needed to send payment requests to tenants' phones."
      />
    </FormDialog>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-xs">{value}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => toast.success('Copied'))
        }
      >
        <Copy />
      </Button>
    </div>
  );
}

/** What is left before a shortcode can take real money, and the documents Safaricom asks for. */
export function GoLiveDialog({
  channel,
  onOpenChange,
}: {
  channel: Channel | null;
  onOpenChange: (o: boolean) => void;
}) {
  const list = useQuery({
    queryKey: ['payment-channels', channel?.id, 'go-live'],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/payment-channels/{id}/go-live', {
          params: { path: { id: channel!.id } },
        }),
      ),
    enabled: channel !== null,
  });
  const g = list.data;
  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Go live with {channel?.displayName}</DialogTitle>
          <DialogDescription>
            {g?.ready
              ? 'Everything is in place.'
              : 'Finish these steps so payments match themselves.'}
          </DialogDescription>
        </DialogHeader>
        {list.error && <p className="text-sm text-destructive">{errorMessage(list.error)}</p>}
        <div className="flex max-h-[60svh] flex-col gap-4 overflow-y-auto text-sm">
          <ul className="flex flex-col gap-3">
            {g?.items.map((i) => (
              <li key={i.key} className="flex gap-3">
                <span className={i.done ? 'text-primary' : 'text-muted-foreground'}>
                  {i.done ? <Check className="size-4" /> : '○'}
                </span>
                <span>
                  <span className="font-medium">{i.label}</span>
                  {!i.done && <span className="block text-muted-foreground">{i.help}</span>}
                </span>
              </li>
            ))}
          </ul>
          {channel?.callbackUrls && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="font-medium">Callback URLs</p>
              <CopyRow label="Confirmation" value={channel.callbackUrls.confirmation} />
              <CopyRow label="Validation" value={channel.callbackUrls.validation} />
              <CopyRow label="STK result" value={channel.callbackUrls.stkResult} />
            </div>
          )}
          {g && g.documents.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Documents Safaricom asks for</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {g.documents.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {g?.ready && <Badge>Ready for live payments</Badge>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
