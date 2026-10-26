'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateExpenseBody } from '@kejasha/contracts';
import { Button } from '@kejasha/ui/components/button';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { columnsFor, DataTable } from '@/components/data-table';
import { ConfirmButton, FormDialog } from '@/components/dialogs';
import { DateField, MoneyField, SelectField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker, usePropertyOptions } from '@/components/portfolio/property-picker';
import { useShortStayUnitOptions } from '@/components/shortstay/pickers';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatKes, todayNairobi } from '@/lib/format';
import { fetchAll, useWrite } from '@/lib/hooks';
import { EXPENSE_CATEGORY_LABEL, options } from '@/lib/labels';

type Expense = Schemas['UnitExpense'];
type Values = z.input<typeof CreateExpenseBody>;

/** First and last day of a YYYY-MM month (to is inclusive). */
const monthRange = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
};

function ExpenseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [scope, setScope] = useState<'unit' | 'property'>('unit');
  const props = usePropertyOptions();
  const form = useForm<Values, unknown, z.output<typeof CreateExpenseBody>>({
    resolver: zodResolver(CreateExpenseBody),
  });
  useEffect(() => {
    if (open) form.reset({ incurredOn: todayNairobi(), category: 'cleaning' });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateExpenseBody>, headers) =>
      unwrap(await api.POST('/v1/unit-expenses', { body, headers })),
    { invalidate: [['expenses'], ['short-stay-report']], success: 'Expense added' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(
        scope === 'unit' ? { ...v, propertyId: undefined } : { ...v, unitId: undefined },
      );
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add an expense"
      form={form}
      onSubmit={submit}
      submitLabel="Add"
    >
      <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
        <TabsList>
          <TabsTrigger value="unit">One unit</TabsTrigger>
          <TabsTrigger value="property">Whole property</TabsTrigger>
        </TabsList>
      </Tabs>
      {scope === 'unit' ? (
        <ComboField
          form={form}
          name="unitId"
          label="Unit"
          placeholder="Search unit code"
          useOptions={useShortStayUnitOptions}
        />
      ) : (
        <SelectField form={form} name="propertyId" label="Property" options={props.data ?? []} />
      )}
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          form={form}
          name="category"
          label="Category"
          options={options(EXPENSE_CATEGORY_LABEL)}
        />
        <MoneyField form={form} name="amountCents" label="Amount" />
        <DateField form={form} name="incurredOn" label="Date" />
      </div>
      <TextField form={form} name="description" label="Description" empty={undefined} />
    </FormDialog>
  );
}

export default function ExpensesPage() {
  const [month, setMonth] = useState(todayNairobi().slice(0, 7));
  const [propertyId, setPropertyId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const { from, to } = monthRange(month);
  const list = useQuery({
    queryKey: ['expenses', from, to, propertyId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/unit-expenses', {
          params: { query: { from, to, ...(propertyId ? { propertyId } : {}) } },
        }),
      ).items,
  });
  // Names for the ids in each row (small lists: properties and short-stay units).
  const props = usePropertyOptions();
  const units = useQuery({
    queryKey: ['units', 'short_stay', 'all'],
    queryFn: () =>
      fetchAll(async (cursor) =>
        unwrap(
          await api.GET('/v1/units', {
            params: { query: { mode: 'short_stay', cursor, limit: 100 } },
          }),
        ),
      ),
    staleTime: 60_000,
  });
  const propName = new Map((props.data ?? []).map((p) => [p.value, p.label]));
  const unitCode = new Map((units.data ?? []).map((u) => [u.id, u.code]));
  const remove = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/unit-expenses/{id}', { params: { path: { id } }, headers })),
    { invalidate: [['expenses'], ['short-stay-report']], success: 'Expense removed' },
  );
  const col = columnsFor<Expense>();
  const columns = [
    col.accessor('incurredOn', { header: 'Date', cell: (c) => formatDate(c.getValue()) }),
    col.accessor((e) => (e.unitId ? (unitCode.get(e.unitId) ?? 'Unit') : 'Whole property'), {
      id: 'where',
      header: 'For',
      meta: { className: 'whitespace-normal' },
      cell: (c) => (
        <div>
          <p className="font-medium">{c.getValue()}</p>
          <p className="text-xs text-muted-foreground">{propName.get(c.row.original.propertyId)}</p>
        </div>
      ),
    }),
    col.accessor('category', {
      header: 'Category',
      cell: (c) => (
        <div>
          <p>{EXPENSE_CATEGORY_LABEL[c.getValue()]}</p>
          {c.row.original.description && (
            <p className="text-xs text-muted-foreground">{c.row.original.description}</p>
          )}
        </div>
      ),
    }),
    col.accessor('amountCents', {
      header: 'Amount',
      meta: { align: 'right' },
      cell: (c) => formatKes(c.getValue()),
    }),
    col.display({
      id: 'remove',
      header: '',
      cell: (c) =>
        c.row.original.maintenanceTicketId ? null : (
          <ConfirmButton
            size="sm"
            variant="ghost"
            label={<Trash2 />}
            title="Remove this expense?"
            description="It no longer counts against the unit's profit."
            confirmLabel="Remove"
            onConfirm={() => remove.run(c.row.original.id)}
          />
        ),
    }),
  ];
  const total = (list.data ?? []).reduce((t, e) => t + e.amountCents, 0);
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Running costs of your short-stay units. They come off profit in the report."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add expense
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="month">Month</Label>
          <Input
            id="month"
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="sm:w-44"
          />
        </div>
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
        <p className="text-sm text-muted-foreground sm:ml-auto">
          Total <span className="font-medium text-foreground tabular-nums">{formatKes(total)}</span>
        </p>
      </div>
      <DataTable
        columns={columns}
        data={list.data ?? []}
        isPending={list.isPending}
        error={list.error}
        empty="No expenses this month."
      />
      <ExpenseDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
