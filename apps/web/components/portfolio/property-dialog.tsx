'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreatePropertyBody, UpdatePropertyBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { useOrgKind, useWrite } from '@/lib/hooks';
import { COUNTY_OPTIONS, options, PROPERTY_KIND_LABEL } from '@/lib/labels';

type Property = Schemas['Property'];
type Values = z.input<typeof UpdatePropertyBody>;

/** Landlords to pick from (agencies only; a landlord org's properties belong to itself). */
export function useLandlordOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['client-landlords', 'options'],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/client-landlords', { params: { query: { limit: 100 } } }),
      ).items.map((l) => ({ value: l.id, label: l.isSelf ? `${l.name} (your agency)` : l.name })),
    enabled,
    staleTime: 60_000,
  });
}

export function PropertyDialog({
  open,
  onOpenChange,
  property,
  clientLandlordId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property?: Property;
  /** Preselects the owner when adding from a landlord's page. */
  clientLandlordId?: string;
  onSaved?: (p: Property) => void;
}) {
  const editing = Boolean(property);
  const agency = useOrgKind() === 'agency';
  const landlords = useLandlordOptions(agency && open);
  const form = useForm<Values>({
    resolver: zodResolver(editing ? UpdatePropertyBody : CreatePropertyBody) as Resolver<Values>,
  });
  useEffect(() => {
    if (open)
      form.reset({
        clientLandlordId: property?.clientLandlordId ?? clientLandlordId,
        name: property?.name ?? '',
        kind: property?.kind ?? 'residential',
        county: property?.county ?? 'Nairobi',
        area: property?.area ?? undefined,
        address: property?.address ?? undefined,
        notes: property?.notes ?? undefined,
      });
  }, [open, property, clientLandlordId, form]);
  const save = useWrite(
    async (body: Values, headers) =>
      property
        ? unwrap(
            await api.PATCH('/v1/properties/{id}', {
              params: { path: { id: property.id } },
              body: body as z.output<typeof UpdatePropertyBody>,
              headers,
            }),
          )
        : unwrap(
            await api.POST('/v1/properties', {
              body: body as z.output<typeof CreatePropertyBody>,
              headers,
            }),
          ),
    {
      invalidate: [['properties'], ['property'], ['client-landlord'], ['client-landlords']],
      success: editing ? 'Property updated' : 'Property added',
    },
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
      title={editing ? 'Edit property' : 'New property'}
      description="A building or compound. Units are added inside it."
      form={form}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Add property'}
    >
      {agency && (
        <SelectField
          form={form}
          name="clientLandlordId"
          label="Landlord"
          options={landlords.data ?? []}
          placeholder={landlords.isPending ? 'Loading…' : 'Choose the owner'}
        />
      )}
      <TextField form={form} name="name" label="Name" placeholder="e.g. Kilimani Court" />
      <SelectField form={form} name="kind" label="Type" options={options(PROPERTY_KIND_LABEL)} />
      <SelectField form={form} name="county" label="County" options={COUNTY_OPTIONS} />
      <TextField
        form={form}
        name="area"
        label="Area / estate"
        placeholder="e.g. Kilimani"
        empty={empty}
      />
      <TextField form={form} name="address" label="Address or directions" empty={empty} />
      <TextareaField form={form} name="notes" label="Notes" empty={empty} />
    </FormDialog>
  );
}
