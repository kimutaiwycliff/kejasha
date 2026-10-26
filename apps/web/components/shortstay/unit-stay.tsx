'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateIcalFeedBody, CreateSeasonBody, UpsertRatePlanBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { Switch } from '@kejasha/ui/components/switch';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Details } from '@/components/detail';
import { ConfirmButton, FormDialog } from '@/components/dialogs';
import {
  DateField,
  MoneyField,
  NumberField,
  SelectField,
  TextareaField,
} from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { LinkButton } from '@/components/link-button';
import { api, ApiError, unwrap } from '@/lib/api';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { errorMessage, toastError, useCan, useWrite } from '@/lib/hooks';
import { BookingTable } from './booking-table';

type Plan = Schemas['RatePlan'];
const planKeys = (unitId: string) => [['rate-plan', unitId], ['quote'], ['calendar']];

type PlanValues = z.input<typeof UpsertRatePlanBody>;
function RatePlanDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<PlanValues, unknown, z.output<typeof UpsertRatePlanBody>>({
    resolver: zodResolver(UpsertRatePlanBody),
  });
  useEffect(() => {
    if (open)
      form.reset({
        baseNightlyCents: plan.baseNightlyCents,
        weekendNightlyCents: plan.weekendNightlyCents,
        minStayNights: plan.minStayNights,
        bufferDays: plan.bufferDays,
        cleaningFeeCents: plan.cleaningFeeCents,
        checkinInstructions: plan.checkinInstructions ?? undefined,
      });
  }, [open, plan, form]);
  const save = useWrite(
    async (body: z.output<typeof UpsertRatePlanBody>, headers) =>
      unwrap(
        await api.PUT('/v1/units/{unitId}/rate-plan', {
          params: { path: { unitId: plan.unitId } },
          body,
          headers,
        }),
      ),
    { invalidate: planKeys(plan.unitId), success: 'Rates saved' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rates and rules"
      form={form}
      onSubmit={submit}
    >
      <div className="grid grid-cols-2 gap-4">
        <MoneyField form={form} name="baseNightlyCents" label="Nightly rate" />
        <MoneyField
          form={form}
          name="weekendNightlyCents"
          label="Fri & Sat nights"
          empty={null}
          description="Blank = same as nightly"
        />
        <NumberField form={form} name="minStayNights" label="Minimum nights" min={1} max={365} />
        <NumberField
          form={form}
          name="bufferDays"
          label="Turnover days"
          min={0}
          max={14}
          description="Kept free after each stay"
        />
        <MoneyField form={form} name="cleaningFeeCents" label="Cleaning fee" />
      </div>
      <TextareaField
        form={form}
        name="checkinInstructions"
        label="Check-in instructions"
        empty={null}
        description="Sent to guests with their confirmation."
      />
    </FormDialog>
  );
}

type SeasonValues = z.input<typeof CreateSeasonBody>;
function SeasonDialog({
  unitId,
  open,
  onOpenChange,
}: {
  unitId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<SeasonValues, unknown, z.output<typeof CreateSeasonBody>>({
    resolver: zodResolver(CreateSeasonBody),
  });
  useEffect(() => {
    if (open) form.reset({ label: '', startsOn: todayNairobi() });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateSeasonBody>, headers) =>
      unwrap(
        await api.POST('/v1/units/{unitId}/seasons', {
          params: { path: { unitId } },
          body,
          headers,
        }),
      ),
    { invalidate: planKeys(unitId), success: 'Season added' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'season_overlap')
        form.setError('endsOn', { message: 'Overlaps another season on this unit.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New season"
      form={form}
      onSubmit={submit}
      submitLabel="Add season"
    >
      <TextField form={form} name="label" label="Name" placeholder="e.g. December holidays" />
      <div className="grid grid-cols-2 gap-4">
        <DateField form={form} name="startsOn" label="First night" />
        <DateField form={form} name="endsOn" label="Ends (first night after)" />
        <MoneyField form={form} name="nightlyCents" label="Nightly rate" />
        <NumberField form={form} name="minStayNights" label="Minimum nights" min={1} max={365} />
      </div>
    </FormDialog>
  );
}

type FeedValues = z.input<typeof CreateIcalFeedBody>;
function FeedDialog({
  unitId,
  open,
  onOpenChange,
}: {
  unitId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<FeedValues, unknown, z.output<typeof CreateIcalFeedBody>>({
    resolver: zodResolver(CreateIcalFeedBody),
  });
  useEffect(() => {
    if (open) form.reset({ unitId, source: 'airbnb', url: '' });
  }, [open, unitId, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateIcalFeedBody>, headers) =>
      unwrap(await api.POST('/v1/ical-feeds', { body, headers })),
    {
      invalidate: [['ical-feeds', unitId], ['calendar'], ['bookings']],
      success: 'Calendar feed added; it syncs every 30 minutes',
    },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_feed_url')
        form.setError('url', {
          message: 'Use the public https calendar link from Airbnb or Booking.com.',
        });
      else if (e instanceof ApiError && e.code === 'feed_exists')
        form.setError('url', { message: 'This feed is already connected.' });
      else applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import a calendar"
      description="Read-only: stays booked on Airbnb or Booking.com block these dates here, so you never double-book."
      form={form}
      onSubmit={submit}
      submitLabel="Connect"
    >
      <SelectField
        form={form}
        name="source"
        label="From"
        options={[
          { value: 'airbnb', label: 'Airbnb' },
          { value: 'booking', label: 'Booking.com' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <TextField
        form={form}
        name="url"
        label="Calendar (iCal) link"
        placeholder="https://…ics"
        description="Airbnb: Calendar → Availability → Export calendar. Booking.com: Calendar → Sync calendars → Export."
      />
    </FormDialog>
  );
}

const FEED_SOURCE = { airbnb: 'Airbnb', booking: 'Booking.com', other: 'Other' } as const;
const when = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi',
});

function FeedsCard({ unitId, manager }: { unitId: string; manager: boolean }) {
  const [adding, setAdding] = useState(false);
  const feeds = useQuery({
    queryKey: ['ical-feeds', unitId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/ical-feeds', { params: { query: { unitId } } })).items,
    enabled: manager,
  });
  const keys = [['ical-feeds', unitId], ['calendar'], ['bookings']];
  const sync = useWrite(
    async (id: string, headers) =>
      unwrap(await api.POST('/v1/ical-feeds/{id}/sync', { params: { path: { id } }, headers })),
    {
      invalidate: keys,
      success: (r) =>
        r.status === 'error'
          ? `Sync failed: ${r.error}`
          : r.status === 'not_modified'
            ? 'No changes since the last sync'
            : `${r.added} added, ${r.updated} updated, ${r.removed} removed`,
    },
  );
  const toggle = useWrite(
    async ({ id, enabled }: { id: string; enabled: boolean }, headers) =>
      unwrap(
        await api.PATCH('/v1/ical-feeds/{id}', {
          params: { path: { id } },
          body: { enabled },
          headers,
        }),
      ),
    { invalidate: keys },
  );
  const remove = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/ical-feeds/{id}', { params: { path: { id } }, headers })),
    { invalidate: keys, success: 'Feed removed; its imported stays are cleared' },
  );
  if (!manager) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Imported calendars</CardTitle>
          <CardDescription>Airbnb / Booking.com stays, read-only</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus /> Import
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {feeds.error && <p className="text-destructive">{errorMessage(feeds.error)}</p>}
        {feeds.data?.length === 0 && <p className="text-muted-foreground">None connected.</p>}
        {feeds.data?.map((f) => (
          <div key={f.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {FEED_SOURCE[f.source]}{' '}
                  <span className="font-mono text-xs text-muted-foreground">{f.urlHint}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.lastSyncedAt
                    ? `Synced ${when.format(new Date(f.lastSyncedAt))}`
                    : 'Not synced yet'}
                  {f.lastStatus === 'error' && (
                    <span className="text-destructive"> · {f.lastError}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  aria-label="Sync this feed"
                  checked={f.enabled}
                  onCheckedChange={(enabled) => toggle.run({ id: f.id, enabled }).catch(toastError)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Sync now"
                  disabled={sync.pending}
                  onClick={() => sync.run(f.id).catch(toastError)}
                >
                  <RefreshCw />
                </Button>
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  label={<Trash2 />}
                  title="Disconnect this calendar?"
                  description="Stays imported from it are removed from your calendar."
                  confirmLabel="Disconnect"
                  onConfirm={() => remove.run(f.id)}
                />
              </div>
            </div>
            {f.conflicts.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-2 text-xs">
                <p className="font-medium text-destructive">Clashes with stays you entered here:</p>
                {f.conflicts.map((c) => (
                  <p key={c.uid}>
                    {formatDate(c.start)} → {formatDate(c.end)} · {c.summary}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
      <FeedDialog unitId={unitId} open={adding} onOpenChange={setAdding} />
    </Card>
  );
}

/** The short-stay side of a unit's page: rates, seasons, imported calendars, upcoming stays. */
export function UnitStaySection({ unitId, live }: { unitId: string; live: boolean }) {
  const manager = useCan('manager');
  const [dialog, setDialog] = useState<'plan' | 'season' | null>(null);
  const plan = useQuery({
    queryKey: ['rate-plan', unitId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/units/{unitId}/rate-plan', { params: { path: { unitId } } })),
  });
  const removeSeason = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/seasons/{id}', { params: { path: { id } }, headers })),
    { invalidate: planKeys(unitId), success: 'Season removed' },
  );
  const p = plan.data;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rates</CardTitle>
          {manager && live && p && (
            <Button size="sm" variant="outline" onClick={() => setDialog('plan')}>
              <Pencil /> Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {plan.error ? (
            <p className="text-sm text-destructive">{errorMessage(plan.error)}</p>
          ) : (
            p && (
              <Details
                items={[
                  ['Nightly', formatKes(p.baseNightlyCents)],
                  [
                    'Fri & Sat',
                    p.weekendNightlyCents === null ? 'Same' : formatKes(p.weekendNightlyCents),
                  ],
                  ['Minimum stay', `${p.minStayNights} night${p.minStayNights === 1 ? '' : 's'}`],
                  [
                    'Turnover',
                    p.bufferDays ? `${p.bufferDays} day${p.bufferDays === 1 ? '' : 's'}` : 'None',
                  ],
                  ['Cleaning fee', formatKes(p.cleaningFeeCents)],
                ]}
              />
            )
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Seasons</CardTitle>
          {manager && live && (
            <Button size="sm" variant="outline" onClick={() => setDialog('season')}>
              <Plus /> Add
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {p?.seasons.length === 0 && <p className="text-muted-foreground">No seasonal prices.</p>}
          {p?.seasons.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {s.label} <Badge variant="outline">{formatKes(s.nightlyCents)}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(s.startsOn)} – {formatDate(s.endsOn)}
                  {s.minStayNights ? ` · min ${s.minStayNights} nights` : ''}
                </p>
              </div>
              {manager && (
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  label={<Trash2 />}
                  title={`Remove ${s.label}?`}
                  description="Nights in these dates go back to the normal rate. Existing bookings keep their price."
                  confirmLabel="Remove"
                  onConfirm={() => removeSeason.run(s.id)}
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <FeedsCard unitId={unitId} manager={manager} />
      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Upcoming stays</CardTitle>
          {live && (
            <LinkButton size="sm" href={`/bookings/new?unitId=${unitId}`}>
              <Plus /> New booking
            </LinkButton>
          )}
        </CardHeader>
        <CardContent>
          <BookingTable filter={{ unitId, from: todayNairobi() }} />
        </CardContent>
      </Card>
      {p && (
        <RatePlanDialog
          plan={p}
          open={dialog === 'plan'}
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      <SeasonDialog
        unitId={unitId}
        open={dialog === 'season'}
        onOpenChange={(o) => !o && setDialog(null)}
      />
    </div>
  );
}
