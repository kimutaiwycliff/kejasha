'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const qc = useQueryClient();
  const [state, setState] = useState<'checking' | 'ok' | 'failed'>('checking');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) return setState('failed');
    api
      .POST('/v1/identity/email/verify', { body: { token } })
      .then((r) => {
        unwrap(r);
        setState('ok');
        return qc.invalidateQueries({ queryKey: ['me'] });
      })
      .catch(() => setState('failed'));
  }, [token, qc]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {state === 'checking'
            ? 'Confirming your email…'
            : state === 'ok'
              ? 'Email confirmed'
              : 'This link has expired'}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {state === 'ok' && 'You can now accept invitations sent to this address.'}
        {state === 'failed' && 'Sign in and ask for a new link from your account.'}{' '}
        <Link
          href="/dashboard"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Continue
        </Link>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
