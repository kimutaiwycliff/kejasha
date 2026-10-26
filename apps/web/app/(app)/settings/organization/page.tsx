'use client';
import { UpdateOrgBody } from '@kejasha/contracts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@kejasha/ui/components/field';
import { Input } from '@kejasha/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { SelectField } from '@/components/fields';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { api, unwrap } from '@/lib/api';
import { useCan, useWrite } from '@/lib/hooks';
import { COUNTY_OPTIONS } from '@/lib/labels';

type Values = z.input<typeof UpdateOrgBody>;
const KIND = { landlord: 'Landlord', agency: 'Agency', host: 'Short-stay host' } as const;

export default function OrganizationPage() {
  const canEdit = useCan('manager');
  const orgQuery = useQuery({
    queryKey: ['org'],
    queryFn: async () => unwrap(await api.GET('/v1/org')),
  });
  const org = orgQuery.data;
  const form = useForm<Values, unknown, z.output<typeof UpdateOrgBody>>({
    resolver: zodResolver(UpdateOrgBody),
  });
  useEffect(() => {
    if (org)
      form.reset({
        name: org.name,
        kraPin: org.kraPin,
        phone: org.phone,
        email: org.email,
        county: org.county,
        brandColor: org.brandColor,
      });
  }, [org, form]);
  const save = useWrite(
    async (body: z.output<typeof UpdateOrgBody>, headers) =>
      unwrap(await api.PATCH('/v1/org', { body, headers })),
    { invalidate: [['org'], ['me']], success: 'Saved' },
  );
  if (!org) return <QueryFallback query={orgQuery} />;
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <>
      <PageHeader title="Organization" description={`${KIND[org.kind]} account`} />
      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Shown on receipts, invoices and statements.</CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset disabled={!canEdit}>
              <FieldGroup>
                <TextField form={form} name="name" label="Name" />
                <TextField form={form} name="kraPin" label="KRA PIN" empty={null} />
                <TextField form={form} name="phone" label="Phone" type="tel" empty={null} />
                <TextField form={form} name="email" label="Email" type="email" empty={null} />
                <SelectField form={form} name="county" label="County" options={COUNTY_OPTIONS} />
              </FieldGroup>
            </fieldset>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Brand</CardTitle>
            <CardDescription>
              The accent colour on PDF statements and receipts
              {org.kind === 'agency' ? ' — your white label for client landlords' : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="brandColor"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="brandColor">Accent colour</FieldLabel>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label="Pick a colour"
                      disabled={!canEdit}
                      value={field.value ?? '#0f766e'}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="size-10 cursor-pointer rounded-md border bg-transparent"
                    />
                    <Input
                      id="brandColor"
                      className="w-32 font-mono"
                      disabled={!canEdit}
                      value={field.value ?? ''}
                      placeholder="#0F766E"
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? null : e.target.value)
                      }
                    />
                  </div>
                  <FieldDescription>Blank uses Kejasha’s default.</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </CardContent>
        </Card>
        {canEdit && (
          <div className="flex justify-end lg:col-span-2">
            <SubmitButton form={form}>Save</SubmitButton>
          </div>
        )}
      </form>
    </>
  );
}
