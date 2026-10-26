'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateGuestBody, UpdateGuestBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { useWrite } from '@/lib/hooks';

type Guest = Schemas['Guest'];
type Values = z.input<typeof UpdateGuestBody>;

export function GuestDialog({
  open,
  onOpenChange,
  guest,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  guest?: Guest;
  onSaved?: (g: Guest) => void;
}) {
  const editing = Boolean(guest);
  const form = useForm<Values>({
    resolver: zodResolver(editing ? UpdateGuestBody : CreateGuestBody) as Resolver<Values>,
  });
  useEffect(() => {
    if (open)
      form.reset({
        fullName: guest?.fullName ?? '',
        phone: guest?.phone ?? undefined,
        email: guest?.email ?? undefined,
        idNumber: guest?.idNumber ?? undefined,
        nationality: guest?.nationality ?? undefined,
        notes: guest?.notes ?? undefined,
      });
  }, [open, guest, form]);
  const save = useWrite(
    async (body: Values, headers) =>
      guest
        ? unwrap(
            await api.PATCH('/v1/guests/{id}', {
              params: { path: { id: guest.id } },
              body: body as z.output<typeof UpdateGuestBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/guests', {
              body: body as z.output<typeof CreateGuestBody>,
              headers,
            }),
          ),
    { invalidate: [['guests'], ['guest']], success: editing ? 'Guest updated' : 'Guest added' },
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
      title={editing ? 'Edit guest' : 'New guest'}
      form={form}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Add guest'}
    >
      <TextField form={form} name="fullName" label="Full name" />
      <div className="grid grid-cols-2 gap-4">
        <TextField form={form} name="phone" label="Phone" type="tel" empty={empty} />
        <TextField form={form} name="email" label="Email" type="email" empty={empty} />
        <TextField form={form} name="idNumber" label="ID / passport" empty={empty} />
        <TextField form={form} name="nationality" label="Nationality" empty={empty} />
      </div>
      <TextareaField form={form} name="notes" label="Notes" empty={empty} />
    </FormDialog>
  );
}
