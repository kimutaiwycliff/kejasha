'use client';
import type { Schemas } from '@kejasha/api-client';
import { AddTicketUpdateBody, CreateTicketBody, UpdateTicketBody } from '@kejasha/contracts';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { FormDialog } from '@/components/dialogs';
import { MoneyField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { usePropertyOptions } from '@/components/portfolio/property-picker';
import { api, unwrap } from '@/lib/api';
import { useWrite } from '@/lib/hooks';
import { options, TICKET_CATEGORY_LABEL, TICKET_PRIORITY_LABEL } from '@/lib/labels';
import { PhotoPicker } from './photo-picker';

type Ticket = Schemas['TicketDetail'];
export const PRIORITY_TONE = {
  low: 'outline',
  normal: 'secondary',
  high: 'default',
  urgent: 'destructive',
} as const;
export const STATUS_TONE = {
  open: 'destructive',
  in_progress: 'default',
  resolved: 'secondary',
  closed: 'outline',
  cancelled: 'outline',
} as const;
export const ticketKeys = [
  ['tickets'],
  ['ticket'],
  ['expenses'],
  ['short-stay-report'],
  ['owner-dashboard'],
];

/** Any unit the member can see (caretakers: their properties), for reporting a problem. */
function useAnyUnitOptions(q: string) {
  return useQuery({
    queryKey: ['units', 'options', 'any', q],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/units', { params: { query: { limit: 20, ...(q ? { q } : {}) } } }),
      ).items.map((u) => ({
        value: u.id,
        label: `${u.code} · ${u.propertyName}`,
      })),
  });
}

type NewValues = z.input<typeof CreateTicketBody>;
export function NewTicketDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: (id: string) => void;
}) {
  const [scope, setScope] = useState<'unit' | 'property'>('unit');
  const props = usePropertyOptions();
  const form = useForm<NewValues, unknown, z.output<typeof CreateTicketBody>>({
    resolver: zodResolver(CreateTicketBody),
  });
  useEffect(() => {
    if (open) form.reset({ title: '', category: 'plumbing', priority: 'normal', photoKeys: [] });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateTicketBody>, headers) =>
      unwrap(await api.POST('/v1/tickets', { body, headers })),
    { invalidate: ticketKeys, success: (t) => `Ticket ${t.number} opened` },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      const t = await save.run(
        scope === 'unit' ? { ...v, propertyId: undefined } : { ...v, unitId: undefined },
      );
      onOpenChange(false);
      onSaved?.(t.id);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Report a problem"
      form={form}
      onSubmit={submit}
      submitLabel="Open ticket"
    >
      <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
        <TabsList>
          <TabsTrigger value="unit">In a unit</TabsTrigger>
          <TabsTrigger value="property">Common area</TabsTrigger>
        </TabsList>
      </Tabs>
      {scope === 'unit' ? (
        <ComboField
          form={form}
          name="unitId"
          label="Unit"
          placeholder="Search unit code"
          useOptions={useAnyUnitOptions}
        />
      ) : (
        <SelectField form={form} name="propertyId" label="Property" options={props.data ?? []} />
      )}
      <TextField
        form={form}
        name="title"
        label="What is wrong"
        placeholder="e.g. Kitchen sink leaking"
      />
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          form={form}
          name="category"
          label="Type"
          options={options(TICKET_CATEGORY_LABEL)}
        />
        <SelectField
          form={form}
          name="priority"
          label="Priority"
          options={options(TICKET_PRIORITY_LABEL)}
        />
      </div>
      <TextareaField form={form} name="description" label="Details" />
      <Controller
        control={form.control}
        name="photoKeys"
        render={({ field }) => <PhotoPicker keys={field.value ?? []} onChange={field.onChange} />}
      />
    </FormDialog>
  );
}

type EditValues = z.input<typeof UpdateTicketBody>;
export function EditTicketDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const members = useQuery({
    queryKey: ['members'],
    queryFn: async () => unwrap(await api.GET('/v1/members')).items,
    enabled: open,
  });
  const form = useForm<EditValues, unknown, z.output<typeof UpdateTicketBody>>({
    resolver: zodResolver(UpdateTicketBody),
  });
  useEffect(() => {
    if (open)
      form.reset({
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        assigneeUserId: ticket.assigneeUserId,
        assigneeName: ticket.assigneeUserId ? undefined : (ticket.assigneeName ?? undefined),
        costCents: ticket.costCents,
      });
  }, [open, ticket, form]);
  const save = useWrite(
    async (body: z.output<typeof UpdateTicketBody>, headers) =>
      unwrap(
        await api.PATCH('/v1/tickets/{id}', { params: { path: { id: ticket.id } }, body, headers }),
      ),
    { invalidate: ticketKeys, success: 'Ticket updated' },
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
      title={`Edit ${ticket.number}`}
      form={form}
      onSubmit={submit}
    >
      <TextField form={form} name="title" label="Title" />
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          form={form}
          name="category"
          label="Type"
          options={options(TICKET_CATEGORY_LABEL)}
        />
        <SelectField
          form={form}
          name="priority"
          label="Priority"
          options={options(TICKET_PRIORITY_LABEL)}
        />
      </div>
      <SelectField
        form={form}
        name="assigneeUserId"
        label="Assigned to (staff)"
        placeholder="Nobody on the team"
        options={(members.data ?? [])
          .filter((m) => m.role !== 'viewer')
          .map((m) => ({ value: m.userId, label: `${m.name} (${m.role})` }))}
      />
      <TextField form={form} name="assigneeName" label="Or an outside fundi" empty={null} />
      <MoneyField form={form} name="costCents" label="Cost so far" empty={null} />
    </FormDialog>
  );
}

type StepValues = z.input<typeof AddTicketUpdateBody>;
export type TicketStep = 'note' | 'in_progress' | 'resolved' | 'closed' | 'open' | 'cancelled';
const STEP_TITLE: Record<TicketStep, string> = {
  note: 'Add a note or photos',
  in_progress: 'Start work',
  resolved: 'Mark resolved',
  closed: 'Close ticket',
  open: 'Reopen',
  cancelled: 'Cancel ticket',
};

/** One update on a ticket: a note/photos, optionally moving its status (and the final cost). */
export function TicketStepDialog({
  ticket,
  step,
  onOpenChange,
}: {
  ticket: Ticket;
  step: TicketStep | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<StepValues, unknown, z.output<typeof AddTicketUpdateBody>>({
    resolver: zodResolver(AddTicketUpdateBody),
  });
  useEffect(() => {
    if (step) form.reset({ ...(step === 'note' ? {} : { status: step }), photoKeys: [] });
  }, [step, form]);
  const save = useWrite(
    async (body: z.output<typeof AddTicketUpdateBody>, headers) =>
      unwrap(
        await api.POST('/v1/tickets/{id}/updates', {
          params: { path: { id: ticket.id } },
          body,
          headers,
        }),
      ),
    {
      invalidate: ticketKeys,
      success: step === 'note' ? 'Update added' : `${STEP_TITLE[step ?? 'note']}: done`,
    },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run({ ...v, photoKeys: v.photoKeys?.length ? v.photoKeys : undefined });
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={step !== null}
      onOpenChange={onOpenChange}
      title={step ? STEP_TITLE[step] : ''}
      description={
        step === 'resolved'
          ? 'A final cost becomes an expense against the unit or property.'
          : undefined
      }
      form={form}
      onSubmit={submit}
      submitLabel={step === 'note' ? 'Add update' : step ? STEP_TITLE[step] : 'Save'}
    >
      <TextareaField form={form} name="note" label={step === 'note' ? 'Note' : 'Note (optional)'} />
      {step === 'resolved' && (
        <MoneyField form={form} name="costCents" label="Final cost (optional)" />
      )}
      <Controller
        control={form.control}
        name="photoKeys"
        render={({ field }) => <PhotoPicker keys={field.value ?? []} onChange={field.onChange} />}
      />
    </FormDialog>
  );
}
