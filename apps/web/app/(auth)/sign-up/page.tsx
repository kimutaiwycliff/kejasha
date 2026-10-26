'use client';
import { SignUpEmailBody } from '@kejasha/contracts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { FieldGroup } from '@kejasha/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';

export default function SignUpPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const form = useForm<z.input<typeof SignUpEmailBody>, unknown, z.output<typeof SignUpEmailBody>>({
    resolver: zodResolver(SignUpEmailBody),
    defaultValues: { name: '', email: '', password: '' },
  });
  const submit = form.handleSubmit(async (body) => {
    try {
      unwrap(await api.POST('/v1/identity/sign-up/email', { body }));
      toast.success('Account created. We emailed you a link to confirm your address.');
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/onboarding');
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>For landlords, agencies and hosts.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <TextField form={form} name="name" label="Your name" autoComplete="name" />
            <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
            <TextField
              form={form}
              name="password"
              label="Password (10+ characters)"
              type="password"
              autoComplete="new-password"
            />
            <SubmitButton form={form} className="w-full">
              Create account
            </SubmitButton>
          </FieldGroup>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
