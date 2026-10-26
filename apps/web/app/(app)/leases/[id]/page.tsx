'use client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kejasha/ui/components/dropdown-menu';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Pencil, Plus, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink, Details } from '@/components/detail';
import { InspectionsCard } from '@/components/leasing/inspections';
import { InvoiceTable } from '@/components/leasing/invoice-table';
import {
  CancelDialog,
  EditTermsDialog,
  RenewDialog,
  RentChangeDialog,
  TerminateDialog,
} from '@/components/leasing/lease-dialogs';
import {
  ChargeDialog,
  CreditNoteDialog,
  DepositDialog,
  ManualInvoiceDialog,
} from '@/components/leasing/money-dialogs';
import { Statement } from '@/components/leasing/statement';
import { PageHeader } from '@/components/page-header';
import { ManualPaymentDialog, StkDialog } from '@/components/payments/dialogs';
import { PaymentTable } from '@/components/payments/payment-table';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { useCan } from '@/lib/hooks';
import { bpsLabel, CHARGE_KIND_LABEL, LEASE_STATUS_LABEL } from '@/lib/labels';

type Dialog =
  | 'stk'
  | 'pay'
  | 'terms'
  | 'rent'
  | 'renew'
  | 'end'
  | 'cancel'
  | 'invoice'
  | 'credit'
  | 'deposit'
  | 'charge'
  | null;

const period = (p: string) => {
  const [y, m] = p.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-KE', {
    month: 'short',
    year: 'numeric',
  });
};

export default function LeasePage() {
  const { id } = useParams<{ id: string }>();
  const manager = useCan('manager');
  const agent = useCan('agent');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editCharge, setEditCharge] = useState<string | null>(null);
  const close = (o: boolean) => !o && setDialog(null);
  const { data: l } = useQuery({
    queryKey: ['lease', id],
    queryFn: async () => unwrap(await api.GET('/v1/leases/{id}', { params: { path: { id } } })),
  });
  if (!l) return <Skeleton className="h-96" />;
  const active = l.status === 'active';
  const lateFee =
    l.lateFeeKind === 'flat'
      ? `${formatKes(l.lateFeeFlatCents)} after ${l.lateFeeGraceDays} days`
      : l.lateFeeKind === 'percent'
        ? `${bpsLabel(l.lateFeeBps)} after ${l.lateFeeGraceDays} days`
        : 'None';
  const charge = l.charges.find((c) => c.id === editCharge);
  return (
    <>
      <BackLink href="/leases" label="Leases" />
      <PageHeader
        title={`${l.tenantName} · ${l.unitCode}`}
        description={`${formatDate(l.startDate)} – ${l.endDate ? formatDate(l.endDate) : 'open-ended'}`}
        actions={
          <>
            {agent && active && (
              <Button variant="outline" onClick={() => setDialog('stk')}>
                <Smartphone /> Request payment
              </Button>
            )}
            {manager && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>
                  Actions <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {active && (
                    <>
                      <DropdownMenuItem onClick={() => setDialog('terms')}>
                        Edit terms
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDialog('rent')}>
                        Change rent
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDialog('renew')}>Renew</DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setDialog('invoice')}>
                    One-off invoice
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog('credit')}>
                    Credit note
                  </DropdownMenuItem>
                  {!active && l.depositHeldCents > 0 && (
                    <DropdownMenuItem onClick={() => setDialog('deposit')}>
                      Settle deposit
                    </DropdownMenuItem>
                  )}
                  {active && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDialog('end')}>
                        End lease
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDialog('cancel')}>
                        Cancel lease
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant={active ? 'default' : 'secondary'}>{LEASE_STATUS_LABEL[l.status]}</Badge>
        {l.balanceCents > 0 && (
          <Badge variant="destructive">Owes {formatKes(l.balanceCents)}</Badge>
        )}
        {l.balanceCents < 0 && (
          <Badge variant="secondary">Credit {formatKes(-l.balanceCents)}</Badge>
        )}
      </div>
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="charges">Charges</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent>
              <Details
                items={[
                  [
                    'Tenant',
                    <Link
                      key="t"
                      href={`/tenants/${l.tenantId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {l.tenantName}
                    </Link>,
                  ],
                  [
                    'Unit',
                    <Link
                      key="u"
                      href={`/units/${l.unitId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {l.unitCode} · {l.propertyName}
                    </Link>,
                  ],
                  ['Rent now', formatKes(l.currentRentCents)],
                  ['Due on', `Day ${l.billingDay} of each month`],
                  [
                    'Deposit',
                    `${formatKes(l.depositCents)} (held ${formatKes(l.depositHeldCents)})`,
                  ],
                  [
                    'Increases',
                    l.escalationBps
                      ? `${bpsLabel(l.escalationBps)} every ${l.escalationEveryMonths} months${l.nextEscalationPeriod ? `, next ${period(l.nextEscalationPeriod)}` : ''}`
                      : 'None',
                  ],
                  ['Late fee', lateFee],
                  ...(l.terminationReason
                    ? ([['Ended because', l.terminationReason]] as [string, string][])
                    : []),
                  ['Notes', l.notes],
                ]}
              />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Arrears</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm tabular-nums">
                {(
                  [
                    ['Not yet late', l.arrears.current],
                    ['1–30 days', l.arrears.d1_30],
                    ['31–60 days', l.arrears.d31_60],
                    ['61–90 days', l.arrears.d61_90],
                    ['Over 90 days', l.arrears.d90_plus],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span>{formatKes(v)}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t pt-1 font-medium">
                  <span>Total</span>
                  <span>{formatKes(l.arrears.total)}</span>
                </div>
              </CardContent>
            </Card>
            {l.rentSteps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Rent changes</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 text-sm tabular-nums">
                  {l.rentSteps.map((s) => (
                    <div key={s.effectivePeriod} className="flex justify-between">
                      <span className="text-muted-foreground">
                        From {period(s.effectivePeriod)}
                      </span>
                      <span>{formatKes(s.rentCents)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        <TabsContent value="charges">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Monthly charges besides rent</CardTitle>
              {manager && active && (
                <Button size="sm" variant="outline" onClick={() => setDialog('charge')}>
                  <Plus /> Add charge
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {l.charges.length === 0 && (
                <p className="text-muted-foreground">Only rent is billed.</p>
              )}
              {l.charges.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{c.label || CHARGE_KIND_LABEL[c.kind]}</p>
                    <p className="text-muted-foreground">
                      {c.method === 'flat'
                        ? `${formatKes(c.amountCents)} / month`
                        : `${formatKes(c.unitPriceCents)} per unit used`}
                      {' · from '}
                      {formatDate(c.startsOn)}
                      {c.endsOn && ` to ${formatDate(c.endsOn)}`}
                    </p>
                  </div>
                  {manager && active && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${c.label}`}
                      onClick={() => setEditCharge(c.id)}
                    >
                      <Pencil />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="invoices">
          <InvoiceTable filter={{ leaseId: l.id, includeVoid: 'true' }} hideTenant />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentTable filter={{ leaseId: l.id }} />
        </TabsContent>
        <TabsContent value="statement">
          <Statement leaseId={l.id} />
        </TabsContent>
        <TabsContent value="inspections">
          <InspectionsCard leaseId={l.id} canAdd={l.status !== 'cancelled'} />
        </TabsContent>
      </Tabs>
      <StkDialog open={dialog === 'stk'} onOpenChange={close} leaseId={l.id} />
      <ManualPaymentDialog open={dialog === 'pay'} onOpenChange={close} leaseId={l.id} />
      <EditTermsDialog lease={l} open={dialog === 'terms'} onOpenChange={close} />
      <RentChangeDialog lease={l} open={dialog === 'rent'} onOpenChange={close} />
      <RenewDialog lease={l} open={dialog === 'renew'} onOpenChange={close} />
      <TerminateDialog lease={l} open={dialog === 'end'} onOpenChange={close} />
      <CancelDialog lease={l} open={dialog === 'cancel'} onOpenChange={close} />
      <ManualInvoiceDialog lease={l} open={dialog === 'invoice'} onOpenChange={close} />
      <CreditNoteDialog lease={l} open={dialog === 'credit'} onOpenChange={close} />
      <DepositDialog lease={l} open={dialog === 'deposit'} onOpenChange={close} />
      <ChargeDialog lease={l} open={dialog === 'charge'} onOpenChange={close} />
      <ChargeDialog
        lease={l}
        charge={charge}
        open={charge !== undefined}
        onOpenChange={(o) => !o && setEditCharge(null)}
      />
    </>
  );
}
