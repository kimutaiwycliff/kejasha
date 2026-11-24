'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Plus, Receipt, Wallet, Wrench } from 'lucide-react';
import { PairedBars, Ring } from '@/components/charts';
import { LinkButton } from '@/components/link-button';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { api, unwrap } from '@/lib/api';
import { formatKes, todayNairobi } from '@/lib/format';
import { activeRole, atLeast, useMe } from '@/lib/session';

const month = new Intl.DateTimeFormat('en-KE', { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('en-KE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthOf = (period: string, f = month) => f.format(new Date(`${period}-01T12:00:00Z`));
const count = (n: number) => n.toLocaleString('en-KE');

export default function DashboardPage() {
  const { data: me } = useMe();
  const role = activeRole(me);
  const sees = role === 'viewer' || atLeast(role, 'manager');
  const period = todayNairobi().slice(0, 7);
  const first = me?.user.name.split(' ')[0] ?? '';
  const { data, isPending } = useQuery({
    queryKey: ['owner-dashboard', period],
    queryFn: async () =>
      unwrap(await api.GET('/v1/reports/owner-dashboard', { params: { query: { period } } })),
    enabled: sees,
  });
  if (!sees)
    return (
      <PageHeader title={`Habari, ${first}`} description="Your work for today is in the menu." />
    );
  const canWrite = atLeast(role, 'manager');
  return (
    <>
      <PageHeader
        title={`Habari, ${first}`}
        description={
          data?.landlordName
            ? `${data.landlordName} · ${monthOf(period, monthLong)}`
            : monthOf(period, monthLong)
        }
        actions={
          canWrite && (
            <>
              <LinkButton href="/payments" variant="outline">
                <Receipt /> Payments
              </LinkButton>
              <LinkButton href="/leases/new">
                <Plus /> New lease
              </LinkButton>
            </>
          )
        }
      />
      {isPending || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
          <Skeleton className="h-80 rounded-xl sm:col-span-2 xl:col-span-3" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            index={0}
            label="Collected this month"
            value={data.collectedCents}
            format={formatKes}
            icon={Banknote}
            tone="success"
            href="/payments"
          />
          <StatCard
            index={1}
            label="Arrears now"
            value={data.arrearsCents}
            format={formatKes}
            icon={AlertTriangle}
            tone={data.arrearsCents > 0 ? 'danger' : 'success'}
            hint={data.arrearsCents > 0 ? 'Tenants owing rent today' : 'Nobody owes rent'}
            href="/arrears"
          />
          <StatCard
            index={2}
            label="Net to owner"
            value={data.netCents}
            format={formatKes}
            icon={Wallet}
            tone="primary"
            hint={`After ${formatKes(data.expensesCents)} expenses${data.managementFeeCents ? ` and ${formatKes(data.managementFeeCents)} fees` : ''}`}
          />
          <StatCard
            index={3}
            label="Open repairs"
            value={data.activeTickets}
            format={count}
            icon={Wrench}
            tone={data.activeTickets > 0 ? 'murram' : 'success'}
            href="/maintenance"
          />
          <Card
            className="animate-rise sm:col-span-2 xl:col-span-3"
            style={{ '--i': 4 } as React.CSSProperties}
          >
            <CardHeader>
              <CardTitle>Last six months</CardTitle>
            </CardHeader>
            <CardContent>
              <PairedBars
                caption="Collected and expenses for the last six months"
                aLabel="Collected"
                bLabel="Expenses"
                format={formatKes}
                data={data.trend.map((t) => ({
                  label: monthOf(t.period),
                  a: t.collectedCents,
                  b: t.expensesCents,
                }))}
              />
            </CardContent>
          </Card>
          <Card className="animate-rise" style={{ '--i': 5 } as React.CSSProperties}>
            <CardHeader>
              <CardTitle>Occupancy</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-around gap-6 py-2">
              <Ring bps={data.longTermOccupancyBps} label="Long-term" />
              <Ring bps={data.shortStayOccupancyBps} label="Short stays" className="stroke-info" />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
