'use client';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import { Switch } from '@kejasha/ui/components/switch';
import { useState } from 'react';
import { FilterSelect } from '@/components/filter-select';
import { InvoiceTable, type InvoiceFilter } from '@/components/leasing/invoice-table';
import { PageHeader } from '@/components/page-header';
import { INVOICE_KIND_LABEL, options } from '@/lib/labels';

const KINDS = [{ value: '', label: 'All types' }, ...options(INVOICE_KIND_LABEL)];

export default function InvoicesPage() {
  const [kind, setKind] = useState<InvoiceFilter['kind']>();
  const [period, setPeriod] = useState('');
  const [includeVoid, setIncludeVoid] = useState(false);
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Everything billed to tenants. Monthly invoices are issued automatically."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <FilterSelect label="Type" options={KINDS} value={kind} onChange={setKind} />
        <Input
          type="month"
          aria-label="Month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="sm:w-44"
        />
        <Label className="flex items-center gap-2 font-normal">
          <Switch checked={includeVoid} onCheckedChange={setIncludeVoid} /> Show voided
        </Label>
      </div>
      <InvoiceTable
        filter={{
          ...(kind ? { kind } : {}),
          ...(period ? { period } : {}),
          ...(includeVoid ? { includeVoid: 'true' as const } : {}),
        }}
      />
    </>
  );
}
