'use client';
import { ForgotPasswordBody } from '@kejasha/contracts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { FieldGroup } from '@kejasha/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<
    z.input<typeof ForgotPasswordBody>,
    unknown,
    z.output<typeof ForgotPasswordBody>
  >({
    resolver: zodResolver(ForgotPasswordBody),
    defaultValues: { email: '' },
  });
  const submit = form.handleSubmit(async (body) => {
    try {
      unwrap(await api.POST('/v1/identity/password/forgot', { body }));
      setSent(true);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          {sent
            ? 'If that email has an account, a reset link is on its way.'
            : "We'll email you a link."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!sent && (
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
              <SubmitButton form={form} className="w-full">
                Send reset link
              </SubmitButton>
            </FieldGroup>
          </form>
        )}
        <p className="mt-6 text-center text-sm">
          <Link href="/sign-in" className="underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
