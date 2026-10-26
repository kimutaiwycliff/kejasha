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
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LogIn, LogOut, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink, Details } from '@/components/detail';
import { ReasonDialog } from '@/components/dialogs';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { ManualPaymentDialog, StkDialog } from '@/components/payments/dialogs';
import { bookingKeys, EditBookingDialog } from '@/components/shortstay/booking-dialogs';
import { BOOKING_TONE } from '@/components/shortstay/booking-table';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { toastError, useCan, useWrite } from '@/lib/hooks';
import { bpsLabel, BOOKING_SOURCE_LABEL, BOOKING_STATUS_LABEL } from '@/lib/labels';

type Dialog = 'edit' | 'cancel' | 'stk' | 'pay' | null;
const OTA = new Set(['airbnb', 'booking']);

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const manager = useCan('manager');
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (o: boolean) => !o && setDialog(null);
  const bQuery = useQuery({
    queryKey: ['booking', id],
    queryFn: async () => unwrap(await api.GET('/v1/bookings/{id}', { params: { path: { id } } })),
  });
  const b = bQuery.data;
  const step = useWrite(
    async (action: 'check-in' | 'check-out' | 'no-show', headers) => {
      const path = { params: { path: { id } }, headers };
      if (action === 'check-in') return unwrap(await api.POST('/v1/bookings/{id}/check-in', path));
      if (action === 'check-out')
        return unwrap(await api.POST('/v1/bookings/{id}/check-out', path));
      return unwrap(await api.POST('/v1/bookings/{id}/no-show', path));
    },
    { invalidate: bookingKeys, success: (r) => BOOKING_STATUS_LABEL[r.status] },
  );
  const cancel = useWrite(
    async (reason: string, headers) =>
      unwrap(
        await api.POST('/v1/bookings/{id}/cancel', {
          params: { path: { id } },
          body: { reason },
          headers,
        }),
      ),
    { invalidate: bookingKeys, success: 'Booking cancelled; the dates are free again' },
  );
  if (!b) return <QueryFallback query={bQuery} className="h-96" />;
  const today = todayNairobi();
  const open = b.status === 'confirmed' || b.status === 'checked_in';
  // OTA guests pay the platform; only direct bookings are collected through your own M-Pesa.
  const collect = open && !OTA.has(b.source) && b.balanceCents > 0;
  return (
    <>
      <BackLink href="/bookings" label="Bookings" />
      <PageHeader
        title={`${b.guestName ?? 'Guest'} · ${b.unitCode}`}
        description={`${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${b.nights} night${b.nights === 1 ? '' : 's'}`}
        actions={
          <>
            {b.status === 'confirmed' && b.checkIn <= today && (
              <Button
                onClick={() => step.run('check-in').catch(toastError)}
                disabled={step.pending}
              >
                <LogIn /> Check in
              </Button>
            )}
            {b.status === 'checked_in' && (
              <Button
                onClick={() => step.run('check-out').catch(toastError)}
                disabled={step.pending}
              >
                <LogOut /> Check out
              </Button>
            )}
            {collect && (
              <Button variant="outline" onClick={() => setDialog('stk')}>
                <Smartphone /> Request payment
              </Button>
            )}
            {open && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>
                  More <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onClick={() => setDialog('edit')}>Edit</DropdownMenuItem>
                  {manager && !OTA.has(b.source) && (
                    <DropdownMenuItem onClick={() => setDialog('pay')}>
                      Record payment
                    </DropdownMenuItem>
                  )}
                  {b.status === 'confirmed' && (
                    <>
                      <DropdownMenuSeparator />
                      {b.checkIn <= today && (
                        <DropdownMenuItem onClick={() => step.run('no-show').catch(toastError)}>
                          Mark no-show
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem variant="destructive" onClick={() => setDialog('cancel')}>
                        Cancel booking
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
        <Badge variant={BOOKING_TONE[b.status]}>{BOOKING_STATUS_LABEL[b.status]}</Badge>
        <Badge variant="outline">{BOOKING_SOURCE_LABEL[b.source]}</Badge>
        {b.isRepeatGuest && <Badge variant="secondary">Returning guest</Badge>}
        {b.fromIcal && <Badge variant="secondary">Imported from calendar feed</Badge>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <Details
              items={[
                [
                  'Guest',
                  b.guestId ? (
                    <Link
                      key="g"
                      href={`/guests/${b.guestId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {b.guestName}
                    </Link>
                  ) : (
                    b.guestName
                  ),
                ],
                [
                  'Unit',
                  <Link
                    key="u"
                    href={`/units/${b.unitId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {b.unitCode} · {b.propertyName}
                  </Link>,
                ],
                ['Guests', b.guestsCount],
                ['Notes', b.notes],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Money</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm tabular-nums">
            {(
              [
                ['Price', formatKes(b.grossCents)],
                ['incl. cleaning', formatKes(b.cleaningFeeCents)],
                [`Commission (${bpsLabel(b.commissionBps)})`, `− ${formatKes(b.commissionCents)}`],
                ['Net to you', formatKes(b.netCents)],
                ...(OTA.has(b.source)
                  ? []
                  : [
                      ['Paid', formatKes(b.paidCents)],
                      ['Balance', formatKes(b.balanceCents)],
                    ]),
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <EditBookingDialog booking={b} open={dialog === 'edit'} onOpenChange={close} />
      <StkDialog open={dialog === 'stk'} onOpenChange={close} bookingId={b.id} />
      <ManualPaymentDialog open={dialog === 'pay'} onOpenChange={close} bookingId={b.id} />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={close}
        title="Cancel this booking?"
        description="The dates become free again. Payments already received stay on record."
        submitLabel="Cancel booking"
        onSubmit={(r) => cancel.run(r)}
      />
    </>
  );
}
