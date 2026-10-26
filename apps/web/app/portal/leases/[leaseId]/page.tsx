'use client';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@kejasha/ui/components/table';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BackLink } from '@/components/detail';
import { QueryFallback } from '@/components/query-fallback';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';

export default function PortalStatementPage() {
  const { leaseId } = useParams<{ leaseId: string }>();
  const q = useQuery({
    queryKey: ['portal', 'statement', leaseId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/portal/leases/{leaseId}/statement', { params: { path: { leaseId } } }),
      ),
  });
  const s = q.data;
  if (!s) return <QueryFallback query={q} />;
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/portal" label="My home" />
      <h1 className="text-2xl font-semibold tracking-tight">Statement</h1>
      <p className="text-sm text-muted-foreground">
        {formatDate(s.from)} – {formatDate(s.to)}
      </p>
      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Charged</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                Opening balance
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKes(s.openingBalanceCents)}
              </TableCell>
            </TableRow>
            {s.items.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{formatDate(l.date)}</TableCell>
                <TableCell className="whitespace-normal">{l.description}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.debitCents ? formatKes(l.debitCents) : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.creditCents ? formatKes(l.creditCents) : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatKes(l.balanceCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>Balance now</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKes(s.closingBalanceCents)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
