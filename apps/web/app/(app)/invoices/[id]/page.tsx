'use client';
import { VoidInvoiceBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent } from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@kejasha/ui/components/table';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { BackLink, Details } from '@/components/detail';
import { FormDialog } from '@/components/dialogs';
import { TextareaField } from '@/components/fields';
import { applyProblem } from '@/components/form';
import { leaseKeys } from '@/components/leasing/lease-dialogs';
import { PageHeader } from '@/components/page-header';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes } from '@/lib/format';
import { useCan, useWrite } from '@/lib/hooks';
import { INVOICE_KIND_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/labels';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const manager = useCan('manager');
  const [voiding, setVoiding] = useState(false);
  const { data: inv } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => unwrap(await api.GET('/v1/invoices/{id}', { params: { path: { id } } })),
  });
  const form = useForm<z.input<typeof VoidInvoiceBody>, unknown, z.output<typeof VoidInvoiceBody>>({
    resolver: zodResolver(VoidInvoiceBody),
    defaultValues: { reason: '' },
  });
  const voidIt = useWrite(
    async (body: z.output<typeof VoidInvoiceBody>, headers) =>
      unwrap(await api.POST('/v1/invoices/{id}/void', { params: { path: { id } }, body, headers })),
    { invalidate: inv ? leaseKeys(inv.leaseId) : [['invoice']], success: 'Invoice voided' },
  );
  if (!inv) return <Skeleton className="h-96" />;
  const isVoid = inv.paymentStatus === 'void';
  return (
    <>
      <BackLink href={`/leases/${inv.leaseId}`} label={`${inv.tenantName} · ${inv.unitCode}`} />
      <PageHeader
        title={`Invoice ${inv.number}`}
        description={`${INVOICE_KIND_LABEL[inv.kind]}${inv.period ? ` · ${inv.period}` : ''}`}
        actions={
          manager &&
          !isVoid && (
            <Button variant="outline" onClick={() => setVoiding(true)}>
              Void
            </Button>
          )
        }
      />
      <div className="mb-4 flex gap-2">
        <Badge
          variant={inv.paymentStatus === 'paid' ? 'default' : isVoid ? 'outline' : 'destructive'}
        >
          {PAYMENT_STATUS_LABEL[inv.paymentStatus]}
        </Badge>
      </div>
      <Card className="mb-4">
        <CardContent>
          <Details
            items={[
              [
                'Tenant',
                <Link
                  key="l"
                  href={`/leases/${inv.leaseId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {inv.tenantName} · {inv.unitCode}
                </Link>,
              ],
              ['Issued', formatDate(inv.issuedOn)],
              ['Due', formatDate(inv.dueOn)],
              ['Still due', formatKes(inv.outstandingCents)],
              ...(inv.voidReason
                ? ([['Voided because', inv.voidReason]] as [string, string][])
                : []),
            ]}
          />
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inv.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  {line.description}
                  {line.periodStart && (
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(line.periodStart)} – {formatDate(line.periodEnd)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.unitPriceCents !== null ? formatKes(line.unitPriceCents) : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatKes(line.amountCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Total</TableCell>
              <TableCell className="text-right tabular-nums">{formatKes(inv.totalCents)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <FormDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={`Void ${inv.number}?`}
        description="The tenant no longer owes it. Any payments already applied become credit."
        form={form}
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await voidIt.run(v);
            setVoiding(false);
          } catch (e) {
            applyProblem(form, e);
          }
        })}
        submitLabel="Void invoice"
      >
        <TextareaField form={form} name="reason" label="Reason" />
      </FormDialog>
    </>
  );
}
