'use client';
import { OtpRequestBody, SignInEmailBody } from '@kejasha/contracts';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { FieldGroup } from '@kejasha/ui/components/field';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@kejasha/ui/components/input-otp';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';

function useAfterSignIn() {
  const qc = useQueryClient();
  const router = useRouter();
  const next = useSearchParams().get('next');
  return async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    // Only same-site paths: never redirect to another origin.
    router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  };
}

function EmailSignIn() {
  const done = useAfterSignIn();
  const form = useForm<z.input<typeof SignInEmailBody>, unknown, z.output<typeof SignInEmailBody>>({
    resolver: zodResolver(SignInEmailBody),
    defaultValues: { email: '', password: '' },
  });
  const submit = form.handleSubmit(async (body) => {
    try {
      unwrap(await api.POST('/v1/identity/sign-in/email', { body }));
      await done();
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          form={form}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <SubmitButton form={form} className="w-full">
          Sign in
        </SubmitButton>
        <Link
          href="/forgot-password"
          className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Forgot your password?
        </Link>
      </FieldGroup>
    </form>
  );
}

function PhoneSignIn() {
  const done = useAfterSignIn();
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<z.input<typeof OtpRequestBody>, unknown, z.output<typeof OtpRequestBody>>({
    resolver: zodResolver(OtpRequestBody),
    defaultValues: { phone: '' },
  });
  const request = form.handleSubmit(async (body) => {
    try {
      unwrap(await api.POST('/v1/identity/otp/request', { body }));
      setPhone(body.phone);
      toast.success('We sent you a 6-digit code by SMS.');
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const verify = async () => {
    if (!phone || code.length !== 6) return;
    setBusy(true);
    try {
      unwrap(await api.POST('/v1/identity/otp/verify', { body: { phone, code } }));
      await done();
    } catch (e) {
      applyProblem(form, e);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  if (!phone)
    return (
      <form onSubmit={request} noValidate>
        <FieldGroup>
          <TextField
            form={form}
            name="phone"
            label="Phone number"
            type="tel"
            placeholder="0712 345 678"
            autoComplete="tel"
          />
          <SubmitButton form={form} className="w-full">
            Send code
          </SubmitButton>
        </FieldGroup>
      </form>
    );
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground">Enter the code sent to {phone}</p>
      <InputOTP
        maxLength={6}
        value={code}
        onChange={setCode}
        onComplete={verify}
        aria-label="One-time code"
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <Button onClick={verify} disabled={busy || code.length !== 6} className="w-full">
        Verify
      </Button>
      <Button variant="link" onClick={() => setPhone(null)}>
        Use another number
      </Button>
    </div>
  );
}

function SignIn() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>With your email, or your phone and an SMS code.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="email">
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="phone">Phone</TabsTrigger>
          </TabsList>
          <TabsContent value="email">
            <EmailSignIn />
          </TabsContent>
          <TabsContent value="phone">
            <PhoneSignIn />
          </TabsContent>
        </Tabs>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to Kejasha?{' '}
          <Link
            href="/sign-up"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
