'use client';
import type { Schemas } from '@kejasha/api-client';
import { Button } from '@kejasha/ui/components/button';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Ban, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmButton } from '@/components/dialogs';
import { LinkButton } from '@/components/link-button';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { BlockDialog } from '@/components/shortstay/block-dialog';
import { api, unwrap } from '@/lib/api';
import { todayNairobi } from '@/lib/format';
import { errorMessage, useWrite } from '@/lib/hooks';

const DAYS = 21;
const addDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
/** Monday of the week containing `iso`. */
const weekStart = (iso: string) =>
  addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const dayLabel = new Intl.DateTimeFormat('en-KE', { weekday: 'narrow', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('en-KE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const HATCH = 'bg-[repeating-linear-gradient(45deg,var(--muted)_0_4px,var(--border)_4px_8px)]';

// 700 shades keep white text above 4.5:1 (WCAG AA).
const SOURCE_STYLE: Record<string, string> = {
  airbnb: 'bg-rose-700 text-white',
  booking: 'bg-sky-700 text-white',
  direct: 'bg-emerald-700 text-white',
  walk_in: 'bg-emerald-700 text-white',
  whatsapp: 'bg-emerald-700 text-white',
  other: 'bg-slate-700 text-white',
};
/** Past stays: neutral, still readable (no fading, which breaks contrast). */
const PAST_STYLE = 'bg-muted text-foreground';

type Entry = Schemas['CalendarEntry'];

export default function CalendarPage() {
  const router = useRouter();
  const today = todayNairobi();
  const [from, setFrom] = useState(() => weekStart(today));
  const [propertyId, setPropertyId] = useState<string>();
  const [blocking, setBlocking] = useState(false);
  const to = addDays(from, DAYS);
  const cal = useQuery({
    queryKey: ['calendar', from, to, propertyId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/calendar', {
          params: { query: { from, to, ...(propertyId ? { propertyId } : {}) } },
        }),
      ),
  });
  const reopen = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/calendar-blocks/{id}', { params: { path: { id } }, headers })),
    { invalidate: [['calendar']], success: 'Dates opened' },
  );
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const grid = { gridTemplateColumns: `7rem repeat(${DAYS}, minmax(2.25rem, 1fr))` };
  const span = (e: Entry) => {
    const start = Math.max(0, dayDiff(from, e.start));
    const end = Math.min(DAYS, dayDiff(from, e.end));
    return { gridColumn: `${start + 2} / ${end + 2}`, gridRow: 1 };
  };
  return (
    <>
      <PageHeader
        title="Calendar"
        description="Tap a free day to book it. Imported Airbnb and Booking.com stays appear here too."
        actions={
          <>
            <Button variant="outline" onClick={() => setBlocking(true)}>
              <Ban /> Block dates
            </Button>
            <LinkButton href="/bookings/new">
              <Plus /> New booking
            </LinkButton>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous weeks"
          onClick={() => setFrom(addDays(from, -14))}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => setFrom(weekStart(today))}>
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next weeks"
          onClick={() => setFrom(addDays(from, 14))}
        >
          <ChevronRight />
        </Button>
        <span className="mx-2 font-medium">{monthLabel.format(new Date(`${from}T12:00:00Z`))}</span>
        <div className="ml-auto w-full sm:w-auto">
          <PropertyPicker value={propertyId} onChange={setPropertyId} />
        </div>
      </div>
      {cal.isPending ? (
        <Skeleton className="h-64" />
      ) : cal.error ? (
        <p className="text-sm text-destructive">{errorMessage(cal.error)}</p>
      ) : cal.data!.units.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No short-stay units yet. Set a unit’s letting to short-stay to see it here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <div className="min-w-max text-xs">
            <div className="grid border-b bg-muted/40" style={grid}>
              <div className="sticky left-0 z-20 bg-muted p-2 font-medium">Unit</div>
              {days.map((d) => {
                const weekend = [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
                return (
                  <div
                    key={d}
                    className={`flex flex-col items-center py-1 ${weekend ? 'bg-muted text-foreground' : 'text-muted-foreground'} ${d === today ? 'font-bold text-primary' : ''}`}
                  >
                    <span>{dayLabel.format(new Date(`${d}T12:00:00Z`))}</span>
                    <span className="text-sm">{Number(d.slice(8))}</span>
                  </div>
                );
              })}
            </div>
            {cal.data!.units.map((u) => (
              <div key={u.unitId} className="grid border-b last:border-b-0" style={grid}>
                <Link
                  href={`/units/${u.unitId}`}
                  className="sticky left-0 z-20 flex flex-col justify-center border-r bg-background p-2 hover:bg-muted"
                  style={{ gridRow: 1, gridColumn: 1 }}
                >
                  <span className="font-medium">{u.unitCode}</span>
                  <span className="truncate text-muted-foreground">{u.propertyName}</span>
                </Link>
                {days.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-label={`Book ${u.unitCode} from ${d}`}
                    disabled={d < today}
                    className="h-12 border-r border-dashed last:border-r-0 enabled:hover:bg-primary/10 disabled:bg-muted/30"
                    style={{ gridRow: 1, gridColumn: i + 2 }}
                    onClick={() => router.push(`/bookings/new?unitId=${u.unitId}&checkIn=${d}`)}
                  />
                ))}
                {u.entries.map((e) =>
                  e.kind === 'booking' ? (
                    <Link
                      key={e.id}
                      href={`/bookings/${e.id}`}
                      style={span(e)}
                      title={`${e.label} · ${e.start} → ${e.end}`}
                      className={`z-10 mx-0.5 my-2 flex items-center truncate rounded-md px-2 font-medium ${e.status === 'checked_out' ? PAST_STYLE : SOURCE_STYLE[e.source ?? 'other']}`}
                    >
                      {e.label}
                    </Link>
                  ) : (
                    <div
                      key={e.id}
                      style={span(e)}
                      className={`z-10 mx-0.5 my-2 flex items-center rounded-md ${HATCH}`}
                    >
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        label={<span className="truncate">{e.label}</span>}
                        title="Open these dates?"
                        description={`${e.start} → ${e.end} become bookable again.`}
                        confirmLabel="Open dates"
                        destructive={false}
                        onConfirm={() => reopen.run(e.id)}
                      />
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-emerald-700" /> Direct
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-rose-700" /> Airbnb
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-sky-700" /> Booking.com
        </span>
        <span className="flex items-center gap-1">
          <span className={`size-3 rounded-sm ${HATCH}`} /> Blocked
        </span>
      </div>
      <BlockDialog open={blocking} onOpenChange={setBlocking} />
    </>
  );
}
