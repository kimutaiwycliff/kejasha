'use client';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';

/** Live price for a stay: nightly breakdown, cleaning, availability and minimum stay. */
export function useQuote(
  unitId: string | undefined,
  checkIn: string | undefined,
  checkOut: string | undefined,
) {
  const ok = Boolean(unitId && checkIn && checkOut && checkOut > checkIn);
  return useQuery({
    queryKey: ['quote', unitId, checkIn, checkOut],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/units/{unitId}/quote', {
          params: { path: { unitId: unitId! }, query: { checkIn: checkIn!, checkOut: checkOut! } },
        }),
      ),
    enabled: ok,
  });
}

export function QuoteSummary({ quote }: { quote: ReturnType<typeof useQuote> }) {
  if (quote.isFetching && !quote.data)
    return <p className="text-sm text-muted-foreground">Pricing…</p>;
  if (quote.error) return <p className="text-sm text-destructive">{errorMessage(quote.error)}</p>;
  const q = quote.data;
  if (!q)
    return (
      <p className="text-sm text-muted-foreground">Choose a unit and dates to see the price.</p>
    );
  const byRate = q.nights.reduce<Record<string, { n: number; cents: number }>>((acc, n) => {
    const k = `${n.rate}:${n.nightlyCents}`;
    acc[k] = { n: (acc[k]?.n ?? 0) + 1, cents: n.nightlyCents };
    return acc;
  }, {});
  const RATE = { base: 'night', weekend: 'weekend night', season: 'season night' } as const;
  return (
    <div className="flex flex-col gap-1 text-sm tabular-nums">
      {Object.entries(byRate).map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-muted-foreground">
            {v.n} × {RATE[k.split(':')[0] as keyof typeof RATE]}
            {v.n === 1 ? '' : 's'} at {formatKes(v.cents)}
          </span>
          <span>{formatKes(v.n * v.cents)}</span>
        </div>
      ))}
      {q.cleaningFeeCents > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Cleaning</span>
          <span>{formatKes(q.cleaningFeeCents)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between border-t pt-1 font-medium">
        <span>Total</span>
        <span>{formatKes(q.totalCents)}</span>
      </div>
      {!q.available && (
        <p className="mt-1 text-destructive">These dates are already booked or blocked.</p>
      )}
      {q.available && !q.meetsMinStay && (
        <p className="mt-1 text-amber-600 dark:text-amber-400">
          Minimum stay is {q.minStayNights} nights.
        </p>
      )}
    </div>
  );
}
