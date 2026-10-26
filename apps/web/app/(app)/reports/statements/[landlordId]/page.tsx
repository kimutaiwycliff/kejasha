'use client';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kejasha/ui/components/table';
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BackLink } from '@/components/detail';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { api, unwrap } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDate, formatKes } from '@/lib/format';
import { bpsLabel, EXPENSE_CATEGORY_LABEL } from '@/lib/labels';
import { lastMonth, periodLabel } from '@/lib/period';

function Statement() {
  const { landlordId } = useParams<{ landlordId: string }>();
  const period = useSearchParams().get('period') ?? lastMonth();
  const q = useQuery({
    queryKey: ['owner-statement', landlordId, period],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/owner-statements/{clientLandlordId}', {
          params: { path: { clientLandlordId: landlordId }, query: { period } },
        }),
      ),
  });
  const s = q.data;
  if (!s) return <QueryFallback query={q} className="h-96" />;
  const fee =
    s.managementFee.kind === 'percent'
      ? `Management fee (${bpsLabel(s.managementFee.bps)})`
      : s.managementFee.kind === 'flat'
        ? 'Management fee (flat)'
        : 'Management fee';
  return (
    <>
      <BackLink href="/reports" label="Reports" />
      <PageHeader
        title={`${s.landlordName} · ${periodLabel(s.period)}`}
        description={`${formatDate(s.from)} – ${formatDate(s.to)}${s.managedBy ? ` · managed by ${s.managedBy}` : ''}`}
        actions={
          <Button
            onClick={() =>
              void downloadFile(
                `/v1/owner-statements/${landlordId}/pdf?period=${period}`,
                `statement-${period}-${s.landlordName.replace(/\W+/g, '-').toLowerCase()}.pdf`,
              )
            }
          >
            <FileDown /> PDF
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['Collected', s.incomeCents],
            ['Expenses', -s.expensesCents],
            [fee, -s.managementFeeCents],
            ['Net to owner', s.netCents],
          ] as const
        ).map(([label, cents]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="tabular-nums">{formatKes(cents)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income by unit</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.income.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      Nothing received this month.
                    </TableCell>
                  </TableRow>
                )}
                {s.income.map((i) => (
                  <TableRow key={i.unitId}>
                    <TableCell>
                      {i.unitCode}{' '}
                      <span className="text-xs text-muted-foreground">· {i.propertyName}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.payments}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKes(i.receivedCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.expenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      No expenses this month.
                    </TableCell>
                  </TableRow>
                )}
                {s.expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.incurredOn)}</TableCell>
                    <TableCell className="whitespace-normal">
                      {EXPENSE_CATEGORY_LABEL[e.category]}
                      <span className="block text-xs text-muted-foreground">
                        {e.unitCode ?? e.propertyName}
                        {e.description ? ` · ${e.description}` : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKes(e.amountCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function OwnerStatementPage() {
  return (
    <Suspense>
      <Statement />
    </Suspense>
  );
}
