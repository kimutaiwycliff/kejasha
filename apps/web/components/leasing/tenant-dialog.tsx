'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateTenantBody, UpdateTenantBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { useWrite } from '@/lib/hooks';

type Tenant = Schemas['Tenant'];
type Values = z.input<typeof UpdateTenantBody>;

export function TenantDialog({
  open,
  onOpenChange,
  tenant,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenant?: Tenant;
  onSaved?: (t: Tenant) => void;
}) {
  const editing = Boolean(tenant);
  const form = useForm<Values>({
    resolver: zodResolver(editing ? UpdateTenantBody : CreateTenantBody) as Resolver<Values>,
  });
  useEffect(() => {
    if (open)
      form.reset({
        fullName: tenant?.fullName ?? '',
        phone: tenant?.phone ?? undefined,
        email: tenant?.email ?? undefined,
        nationalId: tenant?.nationalId ?? undefined,
        kraPin: tenant?.kraPin ?? undefined,
        nextOfKinName: tenant?.nextOfKinName ?? undefined,
        nextOfKinPhone: tenant?.nextOfKinPhone ?? undefined,
        notes: tenant?.notes ?? undefined,
      });
  }, [open, tenant, form]);
  const save = useWrite(
    async (body: Values, headers) =>
      tenant
        ? unwrap(
            await api.PATCH('/v1/tenants/{id}', {
              params: { path: { id: tenant.id } },
              body: body as z.output<typeof UpdateTenantBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/tenants', {
              body: body as z.output<typeof CreateTenantBody>,
              headers,
            }),
          ),
    { invalidate: [['tenants'], ['tenant']], success: editing ? 'Tenant updated' : 'Tenant added' },
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
      title={editing ? 'Edit tenant' : 'New tenant'}
      form={form}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Add tenant'}
    >
      <TextField form={form} name="fullName" label="Full name" />
      <TextField
        form={form}
        name="phone"
        label="Phone"
        type="tel"
        placeholder="0712 345 678"
        empty={empty}
        description="Reminders, receipts and portal sign-in use this number."
      />
      <TextField form={form} name="email" label="Email" type="email" empty={empty} />
      <div className="grid grid-cols-2 gap-4">
        <TextField form={form} name="nationalId" label="ID / passport" empty={empty} />
        <TextField form={form} name="kraPin" label="KRA PIN" empty={empty} />
        <TextField form={form} name="nextOfKinName" label="Next of kin" empty={empty} />
        <TextField
          form={form}
          name="nextOfKinPhone"
          label="Next of kin phone"
          type="tel"
          empty={empty}
        />
      </div>
      <TextareaField form={form} name="notes" label="Notes" empty={empty} />
    </FormDialog>
  );
}
