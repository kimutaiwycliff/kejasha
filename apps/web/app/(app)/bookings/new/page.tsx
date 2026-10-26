'use client';
import { CreateBookingBody } from '@kejasha/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { Checkbox } from '@kejasha/ui/components/checkbox';
import { FieldGroup } from '@kejasha/ui/components/field';
import { Label } from '@kejasha/ui/components/label';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { BackLink } from '@/components/detail';
import {
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  TextareaField,
} from '@/components/fields';
import { applyProblem, SubmitButton, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import {
  shortStayUnitOption,
  useGuestOptions,
  useShortStayUnitOptions,
} from '@/components/shortstay/pickers';
import { QuoteSummary, useQuote } from '@/components/shortstay/quote';
import { api, ApiError, unwrap } from '@/lib/api';
import { todayNairobi } from '@/lib/format';
import { useWrite } from '@/lib/hooks';
import { BOOKING_SOURCE_LABEL, options } from '@/lib/labels';

type Values = z.input<typeof CreateBookingBody>;
type Body = z.output<typeof CreateBookingBody>;

const plusDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

function NewBooking() {
  const params = useSearchParams();
  const unitId = params.get('unitId');
  const unit = useQuery({
    queryKey: ['unit', unitId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/units/{id}', { params: { path: { id: unitId! } } })),
    enabled: Boolean(unitId),
  });
  if (unitId && !unit.data) return <Skeleton className="h-96" />;
  return <BookingForm unit={unit.data ?? null} checkIn={params.get('checkIn') ?? todayNairobi()} />;
}

function BookingForm({
  unit,
  checkIn,
}: {
  unit: { id: string; code: string; propertyName: string; baseNightlyCents: number | null } | null;
  checkIn: string;
}) {
  const router = useRouter();
  const [guestMode, setGuestMode] = useState<'existing' | 'new'>('new');
  const form = useForm<Values, unknown, Body>({
    resolver: zodResolver(CreateBookingBody),
    defaultValues: {
      unitId: unit?.id,
      checkIn,
      checkOut: plusDays(checkIn, 2),
      source: 'direct',
      guestsCount: 2,
      guest: { fullName: '' },
    },
  });
  const [uId, inDate, outDate] = form.watch(['unitId', 'checkIn', 'checkOut']);
  const quote = useQuote(uId, inDate, outDate);
  const save = useWrite(
    async (body: Body, headers) => unwrap(await api.POST('/v1/bookings', { body, headers })),
    { invalidate: [['bookings'], ['calendar'], ['guests']], success: 'Booking saved' },
  );
  const submit = form.handleSubmit(async (v) => {
    const body: Body =
      guestMode === 'existing' ? { ...v, guest: undefined } : { ...v, guestId: undefined };
    try {
      const b = await save.run(body);
      router.push(`/bookings/${b.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'dates_unavailable')
        form.setError('checkOut', { message: 'These dates overlap another booking or a block.' });
      else if (e instanceof ApiError && e.code === 'min_stay')
        form.setError('checkOut', {
          message: e.problem.detail ?? 'Shorter than the minimum stay.',
        });
      else applyProblem(form, e);
    }
  });
  return (
    <>
      <BackLink href="/bookings" label="Bookings" />
      <PageHeader
        title="New booking"
        description="Double bookings are impossible: overlapping dates are refused."
      />
      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stay</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <ComboField
                form={form}
                name="unitId"
                label="Unit"
                placeholder="Search unit code"
                useOptions={useShortStayUnitOptions}
                initial={unit ? shortStayUnitOption(unit) : null}
              />
              <div className="grid grid-cols-2 gap-4">
                <DateField form={form} name="checkIn" label="Check-in" />
                <DateField form={form} name="checkOut" label="Check-out" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  form={form}
                  name="source"
                  label="Booked via"
                  options={options(BOOKING_SOURCE_LABEL)}
                />
                <NumberField form={form} name="guestsCount" label="Guests" min={1} max={100} />
              </div>
              <Tabs
                value={guestMode}
                onValueChange={(v) => {
                  // Only the chosen kind of guest is validated and sent.
                  if (v === 'existing') form.setValue('guest', undefined);
                  else form.setValue('guestId', undefined);
                  setGuestMode(v as typeof guestMode);
                }}
              >
                <TabsList>
                  <TabsTrigger value="new">New guest</TabsTrigger>
                  <TabsTrigger value="existing">Returning guest</TabsTrigger>
                </TabsList>
              </Tabs>
              {guestMode === 'existing' ? (
                <ComboField
                  form={form}
                  name="guestId"
                  label="Guest"
                  placeholder="Name or phone"
                  useOptions={useGuestOptions}
                />
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <TextField form={form} name="guest.fullName" label="Guest name" />
                  <TextField
                    form={form}
                    name="guest.phone"
                    label="Phone"
                    type="tel"
                    empty={undefined}
                    description="A known number links the stay to that guest."
                  />
                </div>
              )}
              <TextareaField form={form} name="notes" label="Notes" />
            </FieldGroup>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Price</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <QuoteSummary quote={quote} />
              <MoneyField
                form={form}
                name="grossCents"
                label="Agreed price (optional)"
                description="Leave blank to use the total above."
              />
              <PercentField
                form={form}
                name="commissionBps"
                label="Platform commission"
                description="What Airbnb or Booking.com keeps, e.g. 15."
              />
              {quote.data && !quote.data.meetsMinStay && (
                <Controller
                  control={form.control}
                  name="allowShortStay"
                  render={({ field }) => (
                    <Label className="flex items-center gap-2 font-normal">
                      <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />{' '}
                      Allow a shorter stay
                    </Label>
                  )}
                />
              )}
            </CardContent>
          </Card>
          <SubmitButton form={form} className="self-end">
            Save booking
          </SubmitButton>
        </div>
      </form>
    </>
  );
}

export default function NewBookingPage() {
  return (
    <Suspense>
      <NewBooking />
    </Suspense>
  );
}
