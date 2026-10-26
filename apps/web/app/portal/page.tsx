'use client';
import type { Schemas } from '@kejasha/api-client';
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
import { FileText, Smartphone, Wrench } from 'lucide-react';
import { useState } from 'react';
import { LinkButton } from '@/components/link-button';
import { PortalPayDialog, PortalTicketDialog } from '@/components/portal-dialogs';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';
import { TICKET_STATUS_LABEL } from '@/lib/labels';

type Lease = Schemas['PortalLease'];

export default function PortalPage() {
  const [paying, setPaying] = useState<Lease | null>(null);
  const [reporting, setReporting] = useState<Lease | null>(null);
  const me = useQuery({
    queryKey: ['portal', 'me'],
    queryFn: async () => unwrap(await api.GET('/v1/portal/me')),
  });
  const tickets = useQuery({
    queryKey: ['portal', 'tickets'],
    queryFn: async () => unwrap(await api.GET('/v1/portal/tickets')).items,
  });
  if (me.isPending) return <Skeleton className="h-64" />;
  if (me.error) return <p className="text-sm text-destructive">{errorMessage(me.error)}</p>;
  const m = me.data!;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My home</h1>
        <p className="text-sm text-muted-foreground">Your rent, statements and repairs.</p>
      </div>
      {m.tenancies.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No tenancy found</CardTitle>
            <CardDescription>
              {m.phoneVerified
                ? `No landlord using Kejasha has ${m.phone} on a lease. Ask them to add this number to your tenant record.`
                : 'Sign in with your phone number so we can find your lease.'}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {m.tenancies.map((t) => (
        <section key={t.orgId} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t.landlordName}</h2>
          {t.leases.map((l) => (
            <Card key={l.leaseId}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {l.unitCode} · {l.propertyName}
                  {l.status === 'terminated' && <Badge variant="secondary">Ended</Badge>}
                </CardTitle>
                <CardDescription>
                  Rent {formatKes(l.currentRentCents)} a month · since {formatDate(l.startDate)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {l.balanceCents < 0 ? 'In credit' : 'You owe'}
                  </p>
                  <p
                    className={`text-3xl font-semibold tabular-nums ${l.balanceCents > 0 ? 'text-destructive' : ''}`}
                  >
                    {formatKes(Math.abs(l.balanceCents))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {l.status === 'active' && l.balanceCents > 0 && (
                    <Button onClick={() => setPaying(l)}>
                      <Smartphone /> Pay with M-Pesa
                    </Button>
                  )}
                  <LinkButton variant="outline" href={`/portal/leases/${l.leaseId}`}>
                    <FileText /> Statement
                  </LinkButton>
                  {l.status === 'active' && (
                    <Button variant="outline" onClick={() => setReporting(l)}>
                      <Wrench /> Report a problem
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
      {(tickets.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My repair requests</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {tickets.data!.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.number} · {t.unitCode} · {formatDate(t.createdAt.slice(0, 10))}
                  </p>
                </div>
                <Badge
                  variant={
                    t.status === 'resolved' || t.status === 'closed' ? 'default' : 'secondary'
                  }
                >
                  {TICKET_STATUS_LABEL[t.status]}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <PortalPayDialog lease={paying} onOpenChange={(o) => !o && setPaying(null)} />
      <PortalTicketDialog lease={reporting} onOpenChange={(o) => !o && setReporting(null)} />
    </div>
  );
}
