'use client';
import { Button } from '@kejasha/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kejasha/ui/components/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { ChevronDown, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { FilterSelect } from '@/components/filter-select';
import { PageHeader } from '@/components/page-header';
import {
  ManualPaymentDialog,
  SmsPaymentDialog,
  StatementImportDialog,
  StkDialog,
} from '@/components/payments/dialogs';
import { PaymentTable, type PaymentFilter } from '@/components/payments/payment-table';
import { useCan } from '@/lib/hooks';
import { options, PAYMENT_SOURCE_LABEL } from '@/lib/labels';

const SOURCES = [{ value: '', label: 'Any source' }, ...options(PAYMENT_SOURCE_LABEL)];
type Dialog = 'stk' | 'manual' | 'statement' | 'sms' | null;

export default function PaymentsPage() {
  const manager = useCan('manager');
  const [tab, setTab] = useState<'unmatched' | 'all'>('unmatched');
  const [source, setSource] = useState<PaymentFilter['source']>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (o: boolean) => !o && setDialog(null);
  return (
    <>
      <PageHeader
        title="Payments"
        description="Money tenants paid into your own Paybill, Till or account. Kejasha only matches it."
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('stk')}>
              <Smartphone /> Request payment
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button />}>
                Add payments <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onClick={() => setDialog('sms')}>
                  Paste an M-Pesa SMS
                </DropdownMenuItem>
                {manager && (
                  <>
                    <DropdownMenuItem onClick={() => setDialog('statement')}>
                      Import a statement
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog('manual')}>
                      Record cash or bank
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="unmatched">To match</TabsTrigger>
            <TabsTrigger value="all">All payments</TabsTrigger>
          </TabsList>
        </Tabs>
        <FilterSelect label="Source" options={SOURCES} value={source} onChange={setSource} />
      </div>
      <PaymentTable
        filter={{
          ...(tab === 'unmatched' ? { status: 'unmatched' as const } : {}),
          ...(source ? { source } : {}),
        }}
      />
      <StkDialog open={dialog === 'stk'} onOpenChange={close} />
      <ManualPaymentDialog open={dialog === 'manual'} onOpenChange={close} />
      <StatementImportDialog open={dialog === 'statement'} onOpenChange={close} />
      <SmsPaymentDialog open={dialog === 'sms'} onOpenChange={close} />
    </>
  );
}
