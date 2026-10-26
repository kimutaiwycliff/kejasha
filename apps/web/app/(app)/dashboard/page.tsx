'use client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { api, unwrap } from '@/lib/api';
import { formatKes, todayNairobi } from '@/lib/format';
import { activeRole, atLeast, useMe } from '@/lib/session';

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default function DashboardPage() {
  const { data: me } = useMe();
  const role = activeRole(me);
  const sees = role === 'viewer' || atLeast(role, 'manager');
  const period = todayNairobi().slice(0, 7);
  const { data, isPending } = useQuery({
    queryKey: ['owner-dashboard', period],
    queryFn: async () =>
      unwrap(await api.GET('/v1/reports/owner-dashboard', { params: { query: { period } } })),
    enabled: sees,
  });
  if (!sees)
    return (
      <>
        <PageHeader
          title={`Hello, ${me?.user.name.split(' ')[0] ?? ''}`}
          description="Your work for today is in the menu."
        />
      </>
    );
  const cards = data
    ? [
        { label: 'Collected this month', value: formatKes(data.collectedCents) },
        { label: 'Expenses', value: formatKes(data.expensesCents) },
        { label: 'Net to owner', value: formatKes(data.netCents) },
        { label: 'Arrears now', value: formatKes(data.arrearsCents) },
        { label: 'Long-term occupancy', value: pct(data.longTermOccupancyBps) },
        { label: 'Open repairs', value: String(data.activeTickets) },
      ]
    : [];
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={data?.landlordName ? `For ${data.landlordName}` : `This month (${period})`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)
          : cards.map((c) => (
              <Card key={c.label}>
                <CardHeader>
                  <CardDescription>{c.label}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{c.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
      </div>
      {data && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Last six months</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {data.trend.map((t) => (
              <div key={t.period} className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">{t.period}</span>
                <span>
                  {formatKes(t.collectedCents)} collected · {formatKes(t.netCents)} net
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
