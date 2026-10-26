'use client';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
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
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';

const yearAgo = () => {
  const [y, m, d] = todayNairobi().split('-');
  return `${Number(y) - 1}-${m}-${d}`;
};

/** Running account for one lease: invoices, payments, credits, deposit movements. */
export function Statement({ leaseId }: { leaseId: string }) {
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(todayNairobi);
  const s = useQuery({
    queryKey: ['statement', leaseId, from, to],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/leases/{id}/statement', {
          params: { path: { id: leaseId }, query: { from, to } },
        }),
      ),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="st-from">From</Label>
          <Input
            id="st-from"
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="st-to">To</Label>
          <Input
            id="st-to"
            type="date"
            value={to}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
      </div>
      {s.error ? (
        <p className="text-sm text-destructive">{errorMessage(s.error)}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Paid / credited</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Opening balance
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatKes(s.data?.openingBalanceCents)}
                </TableCell>
              </TableRow>
              {s.data?.items.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{formatDate(l.date)}</TableCell>
                  <TableCell>
                    {l.description}
                    {l.reference && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {l.reference}
                      </span>
                    )}
                  </TableCell>
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
                <TableCell colSpan={4}>Closing balance</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatKes(s.data?.closingBalanceCents)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
