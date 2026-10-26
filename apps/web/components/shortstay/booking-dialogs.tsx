'use client';
import type { Schemas } from '@kejasha/api-client';
import { UpdateBookingBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import {
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  TextareaField,
} from '@/components/fields';
import { applyProblem } from '@/components/form';
import { api, ApiError, unwrap } from '@/lib/api';
import { useWrite } from '@/lib/hooks';

export const bookingKeys = [
  ['bookings'],
  ['booking'],
  ['calendar'],
  ['guests'],
  ['guest'],
  ['short-stay-report'],
];

type Values = z.input<typeof UpdateBookingBody>;
export function EditBookingDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: Schemas['Booking'];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<Values, unknown, z.output<typeof UpdateBookingBody>>({
    resolver: zodResolver(UpdateBookingBody),
  });
  useEffect(() => {
    if (open)
      form.reset({
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        guestsCount: booking.guestsCount,
        grossCents: booking.grossCents,
        cleaningFeeCents: booking.cleaningFeeCents,
        commissionBps: booking.commissionBps,
        notes: booking.notes ?? undefined,
      });
  }, [open, booking, form]);
  const save = useWrite(
    async (body: z.output<typeof UpdateBookingBody>, headers) =>
      unwrap(
        await api.PATCH('/v1/bookings/{id}', {
          params: { path: { id: booking.id } },
          body,
          headers,
        }),
      ),
    { invalidate: bookingKeys, success: 'Booking updated' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'dates_unavailable')
        form.setError('checkOut', { message: 'These dates overlap another booking or a block.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit booking"
      form={form}
      onSubmit={submit}
    >
      <div className="grid grid-cols-2 gap-4">
        <DateField form={form} name="checkIn" label="Check-in" />
        <DateField form={form} name="checkOut" label="Check-out" />
        <MoneyField form={form} name="grossCents" label="Price" />
        <MoneyField form={form} name="cleaningFeeCents" label="Cleaning fee" />
        <PercentField form={form} name="commissionBps" label="Commission" />
        <NumberField form={form} name="guestsCount" label="Guests" min={1} max={100} />
      </div>
      <TextareaField form={form} name="notes" label="Notes" empty={null} />
    </FormDialog>
  );
}
