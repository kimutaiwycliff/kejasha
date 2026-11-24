'use client';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { cn } from '@kejasha/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { api, unwrap } from '@/lib/api';
import { formatKes, todayNairobi } from '@/lib/format';
import { fetchAll } from '@/lib/hooks';
import { useRentRoll } from './occupancy';

/** What a tile means (same colours as the status badges and the map pins). */
const STATE = {
  owing: { label: 'Owing', tile: 'bg-danger-soft text-destructive ring-destructive/30' },
  let: { label: 'Let', tile: 'bg-success-soft text-success-ink ring-success/30' },
  vacant: { label: 'Vacant', tile: 'bg-murram-soft text-murram ring-murram/30' },
  inHouse: { label: 'Guest in', tile: 'bg-info text-white ring-info dark:text-[#07243d]' },
  booked: { label: 'Booked', tile: 'bg-info-soft text-info-ink ring-info/30' },
  free: { label: 'Free tonight', tile: 'bg-card text-info-ink ring-info/40' },
  blocked: { label: 'Blocked', tile: 'bg-muted text-muted-foreground ring-border' },
  off: { label: 'Inactive', tile: 'bg-muted text-muted-foreground ring-border opacity-70' },
} as const;
type State = keyof typeof STATE;

const addDay = (iso: string) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** Floors top-down like a building: numbers high to low, then ground, then unnamed. */
function floorRank(f: string) {
  const n = Number.parseInt(f, 10);
  if (!Number.isNaN(n)) return -n;
  return /^(g|ground)/i.test(f) ? 0.5 : 1;
}

/**
 * Every unit of a property as a tile, arranged by floor: who is in it today and who owes.
 * Long-term status comes from the rent roll; short stays from today's calendar.
 */
export function UnitBoard({ propertyId }: { propertyId: string }) {
  const today = todayNairobi();
  const units = useQuery({
    queryKey: ['units', 'board', propertyId],
    queryFn: () =>
      fetchAll(async (cursor) =>
        unwrap(
          await api.GET('/v1/units', { params: { query: { propertyId, cursor, limit: 100 } } }),
        ),
      ),
  });
  const roll = useRentRoll(propertyId);
  const cal = useQuery({
    queryKey: ['calendar', 'board', propertyId, today],
    queryFn: async () =>
      (
        await api.GET('/v1/calendar', {
          params: { query: { from: today, to: addDay(today), propertyId } },
        })
      ).data?.units ?? [],
  });
  if (units.isPending) return <Skeleton className="h-48" />;
  const rollBy = new Map((roll.data ?? []).map((r) => [r.unitId, r]));
  const calBy = new Map((cal.data ?? []).map((u) => [u.unitId, u.entries]));
  const tiles = (units.data ?? []).map((u) => {
    let state: State;
    let who: string | null = null;
    let owes = 0;
    if (u.status !== 'active') state = 'off';
    else if (u.mode === 'long_term') {
      const r = rollBy.get(u.id);
      owes = r?.balanceCents ?? 0;
      who = r?.tenantName ?? null;
      state = r?.status === 'occupied' ? (owes > 0 ? 'owing' : 'let') : 'vacant';
    } else {
      const e = (calBy.get(u.id) ?? []).find((x) => x.start <= today && x.end > today);
      if (!e) state = 'free';
      else if (e.kind !== 'booking') state = 'blocked';
      else {
        who = e.label;
        state = e.status === 'checked_in' ? 'inHouse' : 'booked';
      }
    }
    return { u, state, who, owes };
  });
  if (tiles.length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No units yet. Add the first one.
      </p>
    );
  const floors = new Map<string, typeof tiles>();
  for (const t of tiles) {
    const f = t.u.floor?.trim() || '';
    floors.set(f, [...(floors.get(f) ?? []), t]);
  }
  const order = [...floors.keys()].sort((a, b) =>
    a && b ? floorRank(a) - floorRank(b) : a ? -1 : 1,
  );
  const counts = tiles.reduce<Partial<Record<State, number>>>(
    (c, t) => ({ ...c, [t.state]: (c[t.state] ?? 0) + 1 }),
    {},
  );
  let i = 0;
  return (
    <div className="space-y-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Legend">
        {(Object.keys(STATE) as State[])
          .filter((s) => counts[s])
          .map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn('size-3 rounded-sm ring-1', STATE[s].tile)} />
              {STATE[s].label} <span className="font-semibold tabular-nums">{counts[s]}</span>
            </li>
          ))}
      </ul>
      <div className="space-y-3">
        {order.map((f) => (
          <section key={f || 'none'} aria-label={f ? `Floor ${f}` : 'Units'} className="flex gap-3">
            <span className="w-14 shrink-0 pt-3 text-right text-xs font-medium text-muted-foreground">
              {f ? (/^\d+$/.test(f) ? `Floor ${f}` : f) : ''}
            </span>
            <ul className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
              {floors
                .get(f)!
                .sort((a, b) => a.u.code.localeCompare(b.u.code, undefined, { numeric: true }))
                .map((t) => (
                  <li key={t.u.id} className="animate-pop" style={{ '--i': i++ } as CSSProperties}>
                    <Link
                      href={`/units/${t.u.id}`}
                      className={cn(
                        'flex h-full flex-col gap-0.5 rounded-lg px-3 py-2 ring-1 transition-transform hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-3 focus-visible:outline-ring/60',
                        STATE[t.state].tile,
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-bold">{t.u.code}</span>
                        <span className="text-[11px] font-medium">{STATE[t.state].label}</span>
                      </span>
                      <span className="truncate text-xs">
                        {t.who ??
                          (t.state === 'vacant' && t.u.rentCents
                            ? `Asking ${formatKes(t.u.rentCents)}`
                            : t.u.bedrooms !== null
                              ? `${t.u.bedrooms} bed`
                              : '—')}
                      </span>
                      {t.owes > 0 && (
                        <span className="text-xs font-semibold tabular-nums">
                          Owes {formatKes(t.owes)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
