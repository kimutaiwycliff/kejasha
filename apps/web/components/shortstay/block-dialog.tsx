'use client';
import { CreateBlockBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { FormDialog } from '@/components/dialogs';
import { DateField, SelectField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, ApiError, unwrap } from '@/lib/api';
import { todayNairobi } from '@/lib/format';
import { useWrite } from '@/lib/hooks';
import { useShortStayUnitOptions } from './pickers';

type Values = z.input<typeof CreateBlockBody>;
const REASONS = [
  { value: 'owner_use', label: 'Owner use' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Other' },
];

/** Close dates on a unit (owner stays, repairs); they count as unavailable like bookings. */
export function BlockDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<Values, unknown, z.output<typeof CreateBlockBody>>({
    resolver: zodResolver(CreateBlockBody),
  });
  useEffect(() => {
    if (open) form.reset({ startsOn: todayNairobi(), reason: 'owner_use' });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateBlockBody>, headers) =>
      unwrap(await api.POST('/v1/calendar-blocks', { body, headers })),
    { invalidate: [['calendar']], success: 'Dates blocked' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'dates_unavailable')
        form.setError('endsOn', { message: 'These dates overlap a booking or another block.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Block dates"
      form={form}
      onSubmit={submit}
      submitLabel="Block"
    >
      <ComboField
        form={form}
        name="unitId"
        label="Unit"
        placeholder="Search unit code"
        useOptions={useShortStayUnitOptions}
      />
      <div className="grid grid-cols-2 gap-4">
        <DateField form={form} name="startsOn" label="From" />
        <DateField form={form} name="endsOn" label="Until (free again on)" />
      </div>
      <SelectField form={form} name="reason" label="Why" options={REASONS} />
      <TextField form={form} name="note" label="Note" empty={undefined} />
    </FormDialog>
  );
}
