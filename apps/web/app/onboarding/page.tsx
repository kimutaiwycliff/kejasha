'use client';
import { County, CreateOrgBody, OrgKind } from '@kejasha/contracts';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@kejasha/ui/components/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kejasha/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { api, unwrap, writeHeaders } from '@/lib/api';
import { useMe } from '@/lib/session';

const KIND_LABEL: Record<z.infer<typeof OrgKind>, string> = {
  landlord: 'Landlord — I own the properties',
  agency: 'Agency — I manage properties for landlords',
  host: 'Host — short-stay units (Airbnb-style)',
};

export default function OnboardingPage() {
  const { data: me, isPending } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    if (!isPending && me === null) router.replace('/sign-in?next=/onboarding');
  }, [isPending, me, router]);

  const invitations = useQuery({
    queryKey: ['my-invitations'],
    queryFn: async () => unwrap(await api.GET('/v1/identity/me/invitations')).items,
    enabled: Boolean(me),
  });

  const form = useForm<z.input<typeof CreateOrgBody>, unknown, z.output<typeof CreateOrgBody>>({
    resolver: zodResolver(CreateOrgBody),
    defaultValues: { name: '', kind: 'landlord', county: 'Nairobi' },
  });
  const create = form.handleSubmit(async (body) => {
    try {
      unwrap(await api.POST('/v1/orgs', { body, headers: writeHeaders() }));
      await qc.resetQueries();
      router.replace('/dashboard');
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const accept = async (id: string) => {
    try {
      unwrap(
        await api.POST('/v1/invitations/{id}/accept', {
          params: { path: { id } },
          headers: writeHeaders(),
        }),
      );
      await qc.resetQueries();
      router.replace('/dashboard');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept the invitation.');
    }
  };

  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{me ? `, ${me.user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Join a team you were invited to, or set up your own.
        </p>
      </div>
      {(invitations.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {invitations.data!.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{i.orgName}</p>
                  <p className="text-sm capitalize text-muted-foreground">as {i.role}</p>
                </div>
                <Button onClick={() => void accept(i.id)}>Join</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>New organization</CardTitle>
          <CardDescription>You can add more later and switch between them.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} noValidate>
            <FieldGroup>
              <TextField form={form} name="name" label="Name" placeholder="e.g. Wanjiku Homes" />
              <Controller
                control={form.control}
                name="kind"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>What do you run?</FieldLabel>
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                      <SelectTrigger aria-label="What do you run?">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OrgKind.options.map((k) => (
                          <SelectItem key={k} value={k}>
                            {KIND_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="county"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>County</FieldLabel>
                    <Select
                      value={field.value ?? undefined}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <SelectTrigger aria-label="County">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {County.options.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <SubmitButton form={form}>Create organization</SubmitButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
