'use client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { api, ApiError, unwrap, writeHeaders } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';

const STATUS: Record<string, { label: string; tone: 'default' | 'secondary' | 'destructive' }> = {
  incomplete: { label: 'Not paid yet', tone: 'destructive' },
  trialing: { label: 'Trial', tone: 'secondary' },
  active: { label: 'Active', tone: 'default' },
  past_due: { label: 'Payment overdue', tone: 'destructive' },
  suspended: { label: 'Read-only', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export default function BillingPage() {
  const [paying, setPaying] = useState(false);
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: async () => unwrap(await api.GET('/v1/billing')),
  });
  const invoices = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: async () => unwrap(await api.GET('/v1/billing/invoices')).items,
  });
  const pay = async () => {
    setPaying(true);
    try {
      const co = unwrap(
        await api.POST('/v1/billing/checkout', { body: {}, headers: writeHeaders() }),
      );
      window.location.assign(co.authorizationUrl); // Paystack (card or M-Pesa)
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not start the payment.',
      );
      setPaying(false);
    }
  };
  const b = billing.data;
  return (
    <>
      <PageHeader
        title="Billing"
        description="Your Kejasha subscription. Rent and booking money never passes through Kejasha."
      />
      {!b ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>{b.plan.name} plan</CardDescription>
              <CardTitle className="flex items-center gap-2">
                {formatKes(b.nextAmountCents)}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  / month at today’s usage
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={STATUS[b.status]?.tone ?? 'secondary'}>
                  {STATUS[b.status]?.label ?? b.status}
                </Badge>
                {b.currentPeriodEnd && (
                  <span className="text-muted-foreground">
                    Paid until {formatDate(b.currentPeriodEnd)}
                  </span>
                )}
                {b.trialEndsOn && (
                  <span className="text-muted-foreground">
                    Trial ends {formatDate(b.trialEndsOn)}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                {b.usage.units} occupied unit{b.usage.units === 1 ? '' : 's'} · {b.usage.listings}{' '}
                listing{b.usage.listings === 1 ? '' : 's'}
                {b.card ? ` · ${b.card.brand ?? 'Card'} •••• ${b.card.last4}` : ''}
              </p>
              {b.status !== 'active' || b.openInvoice ? (
                <Button onClick={() => void pay()} disabled={paying} className="w-fit">
                  {paying
                    ? 'Opening Paystack…'
                    : `Pay ${formatKes(b.openInvoice?.amountCents ?? b.nextAmountCents)}`}
                </Button>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {(invoices.data ?? []).length === 0 && (
                <p className="text-muted-foreground">No invoices yet.</p>
              )}
              {(invoices.data ?? []).map((i) => (
                <div key={i.id} className="flex justify-between tabular-nums">
                  <span>
                    {i.number} · {formatDate(i.periodStart)}
                  </span>
                  <span>
                    {formatKes(i.amountCents)}{' '}
                    <Badge variant={i.status === 'paid' ? 'default' : 'secondary'}>
                      {i.status}
                    </Badge>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
