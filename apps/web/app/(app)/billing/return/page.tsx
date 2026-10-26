'use client';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, unwrap, writeHeaders } from '@/lib/api';

/** Paystack sends the customer back here with `reference` (and `trxref`). */
function Return() {
  const params = useSearchParams();
  const reference = params.get('reference') ?? params.get('trxref');
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('checking');
  const once = useRef(false);
  useEffect(() => {
    if (once.current || !reference) return;
    once.current = true;
    api
      .POST('/v1/billing/verify', { body: { reference }, headers: writeHeaders() })
      .then((r) => {
        setStatus(unwrap(r).status);
        return qc.invalidateQueries({ queryKey: ['billing'] });
      })
      .catch(() => setStatus('unknown'));
  }, [reference, qc]);
  const paid = status === 'active';
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>
          {status === 'checking'
            ? 'Confirming your payment…'
            : paid
              ? 'Payment received — thank you'
              : 'Payment not confirmed yet'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
        {!paid &&
          status !== 'checking' &&
          'If you completed the payment, it will show up within a minute.'}
        <Button
          nativeButton={false}
          render={<Link href={paid ? '/dashboard' : '/billing'} />}
          className="w-fit"
        >
          {paid ? 'Go to dashboard' : 'Back to billing'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function BillingReturnPage() {
  return (
    <Suspense>
      <Return />
    </Suspense>
  );
}
