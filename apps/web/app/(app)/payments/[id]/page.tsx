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
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ComboField } from '@/components/combo-field';
import { BackLink, Details } from '@/components/detail';
import { ReasonDialog } from '@/components/dialogs';
import { PageHeader } from '@/components/page-header';
import { paymentKeys } from '@/components/payments/dialogs';
import { useActiveLeaseOptions } from '@/components/payments/lease-picker';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { toastError, useCan, useWrite } from '@/lib/hooks';
import {
  MATCH_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_SOURCE_LABEL,
  SUGGESTION_REASON_LABEL,
} from '@/lib/labels';
import { openPdf } from '@/lib/pdf';

const when = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi',
});
const TONE = { unmatched: 'destructive', matched: 'default', ignored: 'outline' } as const;

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const manager = useCan('manager');
  const [reason, setReason] = useState<'ignore' | 'unallocate' | null>(null);
  const pick = useForm<{ leaseId?: string }>();
  const { data: p } = useQuery({
    queryKey: ['payment', id],
    queryFn: async () => unwrap(await api.GET('/v1/payments/{id}', { params: { path: { id } } })),
  });
  const unmatched = p?.matchStatus === 'unmatched';
  const suggestions = useQuery({
    queryKey: ['payment', id, 'suggestions'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/payments/{id}/suggestions', { params: { path: { id } } })).items,
    enabled: unmatched,
  });
  const allocate = useWrite(
    async (leaseId: string, headers) =>
      unwrap(
        await api.POST('/v1/payments/{id}/allocate', {
          params: { path: { id } },
          body: { leaseId },
          headers,
        }),
      ),
    { invalidate: paymentKeys, success: (r) => `Applied to ${r.tenantName}` },
  );
  const ignore = useWrite(
    async (why: string, headers) =>
      unwrap(
        await api.POST('/v1/payments/{id}/ignore', {
          params: { path: { id } },
          body: { reason: why },
          headers,
        }),
      ),
    { invalidate: paymentKeys, success: 'Payment ignored' },
  );
  const unallocate = useWrite(
    async (why: string, headers) =>
      unwrap(
        await api.POST('/v1/payments/{id}/unallocate', {
          params: { path: { id } },
          body: { reason: why },
          headers,
        }),
      ),
    { invalidate: paymentKeys, success: 'Payment moved back to the queue' },
  );
  if (!p) return <Skeleton className="h-96" />;
  return (
    <>
      <BackLink href="/payments" label="Payments" />
      <PageHeader
        title={formatKes(p.amountCents)}
        description={`${PAYMENT_METHOD_LABEL[p.method]} · ${when.format(new Date(p.paidAt))}`}
        actions={
          <>
            {p.receiptNumber && (
              <Button
                variant="outline"
                onClick={() => void openPdf(`/v1/payments/${p.id}/receipt`)}
              >
                <FileText /> Receipt
              </Button>
            )}
            {manager && p.matchStatus === 'matched' && (
              <Button variant="outline" onClick={() => setReason('unallocate')}>
                Unmatch
              </Button>
            )}
            {manager && unmatched && (
              <Button variant="outline" onClick={() => setReason('ignore')}>
                Ignore
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4">
        <Badge variant={TONE[p.matchStatus]}>{MATCH_STATUS_LABEL[p.matchStatus]}</Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <Details
              items={[
                [
                  'Reference',
                  <span key="r" className="font-mono">
                    {p.providerRef}
                  </span>,
                ],
                ['Via', PAYMENT_SOURCE_LABEL[p.source]],
                ['Paid by', p.payerName],
                ['Phone', p.msisdn],
                ['Account number used', p.accountRef],
                [
                  'Applied to',
                  p.leaseId ? (
                    <Link
                      key="l"
                      href={`/leases/${p.leaseId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {p.tenantName} · {p.unitCode}
                    </Link>
                  ) : null,
                ],
                [
                  'Matched by',
                  p.matchMethod === 'manual' ? 'Hand' : p.matchMethod ? 'Automatically' : null,
                ],
                ['Receipt', p.receiptNumber],
                ['Ignored because', p.ignoreReason],
                ['Notes', p.notes],
              ]}
            />
          </CardContent>
        </Card>
        {unmatched && manager && (
          <Card>
            <CardHeader>
              <CardTitle>Match to a tenant</CardTitle>
              <CardDescription>
                Best guesses first. The money is applied to their oldest unpaid invoices.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {suggestions.data?.length === 0 && (
                <p className="text-muted-foreground">No likely tenant found.</p>
              )}
              {suggestions.data?.map((s) => (
                <div key={s.leaseId} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {s.tenantName} · {s.unitCode}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      owes {formatKes(s.outstandingCents)} ·{' '}
                      {s.reasons.map((r) => SUGGESTION_REASON_LABEL[r]).join(', ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={allocate.pending}
                    onClick={() => allocate.run(s.leaseId).catch(toastError)}
                  >
                    Apply
                  </Button>
                </div>
              ))}
              <div className="border-t pt-3">
                <ComboField
                  form={pick}
                  name="leaseId"
                  label="Someone else"
                  placeholder="Tenant or unit"
                  useOptions={useActiveLeaseOptions}
                />
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  disabled={!pick.watch('leaseId') || allocate.pending}
                  onClick={() => allocate.run(pick.getValues('leaseId')!).catch(toastError)}
                >
                  Apply to this lease
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <ReasonDialog
        open={reason === 'ignore'}
        onOpenChange={(o) => !o && setReason(null)}
        title="Ignore this payment?"
        description="For money that is not rent, e.g. a personal transfer. It leaves the queue but stays on record."
        submitLabel="Ignore"
        onSubmit={(r) => ignore.run(r)}
      />
      <ReasonDialog
        open={reason === 'unallocate'}
        onOpenChange={(o) => !o && setReason(null)}
        title="Unmatch this payment?"
        description="It is taken off the tenant's account and goes back to the queue."
        submitLabel="Unmatch"
        onSubmit={(r) => unallocate.run(r)}
      />
    </>
  );
}
