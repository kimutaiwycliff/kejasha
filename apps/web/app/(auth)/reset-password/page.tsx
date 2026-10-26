'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { FieldGroup } from '@kejasha/ui/components/field';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const form = useForm<{ newPassword: string }>({ defaultValues: { newPassword: '' } });
  const submit = form.handleSubmit(async ({ newPassword }) => {
    try {
      unwrap(await api.POST('/v1/identity/password/reset', { body: { token, newPassword } }));
      toast.success('Password changed. Sign in with your new password.');
      router.replace('/sign-in');
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <TextField
              form={form}
              name="newPassword"
              label="New password (10+ characters)"
              type="password"
              autoComplete="new-password"
            />
            <SubmitButton form={form} disabled={!token} className="w-full">
              Save password
            </SubmitButton>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
