'use client';
import { Badge } from '@kejasha/ui/components/badge';
import { Card, CardContent } from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { BackLink } from '@/components/detail';
import { FilterSelect } from '@/components/filter-select';
import { PageHeader } from '@/components/page-header';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';

const RANGES = [
  { value: '30', label: 'Next 30 days' },
  { value: '90', label: 'Next 90 days' },
  { value: '180', label: 'Next 6 months' },
  { value: '365', label: 'Next 12 months' },
];

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Lease ends and scheduled rent increases coming up. */
export default function LeaseCalendarPage() {
  const [range, setRange] = useState<string>('90');
  const from = todayNairobi();
  const to = addDays(from, Number(range));
  const cal = useQuery({
    queryKey: ['lease-calendar', from, to],
    queryFn: async () =>
      unwrap(await api.GET('/v1/lease-calendar', { params: { query: { from, to } } })).items,
  });
  return (
    <>
      <BackLink href="/leases" label="Leases" />
      <PageHeader
        title="Lease calendar"
        description="Leases ending and rent increases coming up."
      />
      <div className="mb-4">
        <FilterSelect
          label="Range"
          options={RANGES}
          value={range}
          onChange={(v) => setRange(v ?? '90')}
        />
      </div>
      {cal.isPending ? (
        <Skeleton className="h-40" />
      ) : cal.error ? (
        <p className="text-sm text-destructive">{errorMessage(cal.error)}</p>
      ) : cal.data!.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing coming up in this range.</p>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y text-sm">
            {cal.data!.map((e) => (
              <Link
                key={`${e.kind}-${e.leaseId}-${e.date}`}
                href={`/leases/${e.leaseId}`}
                className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-muted/50"
              >
                <span className="flex items-center gap-3">
                  <span className="w-28 tabular-nums text-muted-foreground">
                    {formatDate(e.date)}
                  </span>
                  <Badge variant={e.kind === 'lease_end' ? 'destructive' : 'secondary'}>
                    {e.kind === 'lease_end' ? 'Lease ends' : 'Rent increase'}
                  </Badge>
                  <span>
                    {e.tenantName} · {e.unitCode}
                  </span>
                </span>
                {e.rentCents !== null && (
                  <span className="tabular-nums">New rent {formatKes(e.rentCents)}</span>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
