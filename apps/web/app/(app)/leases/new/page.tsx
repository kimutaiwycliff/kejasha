'use client';
import { CreateLeaseBody } from '@kejasha/contracts';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { FieldGroup } from '@kejasha/ui/components/field';
import { Label } from '@kejasha/ui/components/label';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { Switch } from '@kejasha/ui/components/switch';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ComboField } from '@/components/combo-field';
import { BackLink } from '@/components/detail';
import {
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  TextareaField,
} from '@/components/fields';
import { applyProblem, SubmitButton } from '@/components/form';
import {
  tenantOption,
  unitOption,
  useTenantOptions,
  useUnitOptions,
} from '@/components/leasing/pickers';
import { TenantDialog } from '@/components/leasing/tenant-dialog';
import { PageHeader } from '@/components/page-header';
import { api, ApiError, unwrap } from '@/lib/api';
import { todayNairobi } from '@/lib/format';
import { useWrite } from '@/lib/hooks';
import { CHARGE_KIND_LABEL, options } from '@/lib/labels';

type Values = z.input<typeof CreateLeaseBody>;
type Body = z.output<typeof CreateLeaseBody>;

const LATE_FEE = [
  { value: 'none', label: 'No late fee' },
  { value: 'flat', label: 'Flat amount' },
  { value: 'percent', label: 'Percent of the overdue amount' },
];

function NewLease() {
  const params = useSearchParams();
  const unitId = params.get('unitId');
  const tenantId = params.get('tenantId');
  // Prefill pickers when arriving from a unit's or tenant's page.
  const unit = useQuery({
    queryKey: ['unit', unitId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/units/{id}', { params: { path: { id: unitId! } } })),
    enabled: Boolean(unitId),
  });
  const tenant = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/tenants/{id}', { params: { path: { id: tenantId! } } })),
    enabled: Boolean(tenantId),
  });
  if ((unitId && !unit.data) || (tenantId && !tenant.data)) return <Skeleton className="h-96" />;
  return <LeaseForm unit={unit.data ?? null} tenant={tenant.data ?? null} />;
}

function LeaseForm({
  unit,
  tenant,
}: {
  unit: {
    id: string;
    code: string;
    propertyName: string;
    rentCents: number | null;
    depositCents: number | null;
  } | null;
  tenant: { id: string; fullName: string; phone: string | null } | null;
}) {
  const router = useRouter();
  const [newTenant, setNewTenant] = useState(false);
  const [tenantKey, setTenantKey] = useState(0);
  const [tenantInitial, setTenantInitial] = useState(tenant ? tenantOption(tenant) : null);
  const [escalates, setEscalates] = useState(false);
  const form = useForm<Values, unknown, Body>({
    resolver: zodResolver(CreateLeaseBody),
    defaultValues: {
      unitId: unit?.id,
      tenantId: tenant?.id,
      startDate: todayNairobi(),
      rentCents: unit?.rentCents ?? undefined,
      depositCents: unit?.depositCents ?? undefined,
      billingDay: 1,
      lateFeeKind: 'none',
      charges: [],
    },
  });
  const charges = useFieldArray({ control: form.control, name: 'charges' });
  const lateFeeKind = form.watch('lateFeeKind');
  const save = useWrite(
    async (body: Body, headers) => unwrap(await api.POST('/v1/leases', { body, headers })),
    {
      invalidate: [['leases'], ['tenants'], ['tenant'], ['unit'], ['units']],
      success: 'Lease created',
    },
  );
  const submit = form.handleSubmit(async (v) => {
    const body: Body = {
      ...v,
      ...(escalates ? {} : { escalationBps: undefined, escalationEveryMonths: undefined }),
      lateFeeFlatCents: v.lateFeeKind === 'flat' ? v.lateFeeFlatCents : undefined,
      lateFeeBps: v.lateFeeKind === 'percent' ? v.lateFeeBps : undefined,
      charges: v.charges?.length ? v.charges : undefined,
    };
    try {
      const lease = await save.run(body);
      router.push(`/leases/${lease.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'lease_overlap')
        form.setError('startDate', { message: 'This unit already has a lease for these dates.' });
      else applyProblem(form, e);
    }
  });
  return (
    <>
      <BackLink href="/leases" label="Leases" />
      <PageHeader
        title="New lease"
        description="The deposit is invoiced now, and every month already due is billed."
      />
      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Who and where</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <ComboField
                form={form}
                name="unitId"
                label="Unit"
                placeholder="Search unit code"
                useOptions={useUnitOptions}
                initial={unit ? unitOption(unit) : null}
                onPicked={async (o) => {
                  if (!o) return;
                  // Copy the unit's usual rent and deposit as a starting point.
                  const u = unwrap(
                    await api.GET('/v1/units/{id}', { params: { path: { id: o.value } } }),
                  );
                  if (u.rentCents != null) form.setValue('rentCents', u.rentCents);
                  if (u.depositCents != null) form.setValue('depositCents', u.depositCents);
                }}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <ComboField
                    key={tenantKey}
                    form={form}
                    name="tenantId"
                    label="Tenant"
                    placeholder="Search name or phone"
                    useOptions={useTenantOptions}
                    initial={tenantInitial}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewTenant(true)}
                  aria-label="New tenant"
                >
                  <UserPlus />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <DateField form={form} name="startDate" label="Starts" />
                <DateField
                  form={form}
                  name="endDate"
                  label="Ends (optional)"
                  description="Blank = open-ended"
                />
              </div>
              <TextareaField form={form} name="notes" label="Notes" />
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Money</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <MoneyField form={form} name="rentCents" label="Monthly rent" />
                <MoneyField form={form} name="depositCents" label="Deposit" />
              </div>
              <NumberField
                form={form}
                name="billingDay"
                label="Rent due on day"
                min={1}
                max={31}
                description="Day of the month (the last day in shorter months)."
              />
              <Label className="flex items-center gap-3 font-normal">
                <Switch checked={escalates} onCheckedChange={setEscalates} /> Rent increases on a
                schedule
              </Label>
              {escalates && (
                <div className="grid grid-cols-2 gap-4">
                  <PercentField form={form} name="escalationBps" label="Increase by" />
                  <NumberField
                    form={form}
                    name="escalationEveryMonths"
                    label="Every (months)"
                    min={1}
                    max={120}
                  />
                </div>
              )}
              <SelectField form={form} name="lateFeeKind" label="Late fee" options={LATE_FEE} />
              {lateFeeKind !== 'none' && (
                <div className="grid grid-cols-2 gap-4">
                  {lateFeeKind === 'flat' ? (
                    <MoneyField form={form} name="lateFeeFlatCents" label="Late fee" />
                  ) : (
                    <PercentField form={form} name="lateFeeBps" label="Late fee" />
                  )}
                  <NumberField
                    form={form}
                    name="lateFeeGraceDays"
                    label="Grace days"
                    min={0}
                    max={60}
                  />
                </div>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Other monthly charges</CardTitle>
            <CardDescription>
              Flat amounts billed with the rent. Add metered water or power from the lease page once
              the unit has a meter.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {charges.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <SelectField
                  form={form}
                  name={`charges.${i}.kind`}
                  label="Charge"
                  options={options(CHARGE_KIND_LABEL).filter(
                    (o) => o.value !== 'water' && o.value !== 'electricity',
                  )}
                />
                <MoneyField form={form} name={`charges.${i}.amountCents`} label="Per month" />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => charges.remove(i)}
                  aria-label="Remove charge"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => charges.append({ kind: 'service_charge', method: 'flat' })}
            >
              <Plus /> Add a charge
            </Button>
          </CardContent>
        </Card>
        <div className="flex justify-end lg:col-span-2">
          <SubmitButton form={form}>Create lease</SubmitButton>
        </div>
      </form>
      <TenantDialog
        open={newTenant}
        onOpenChange={setNewTenant}
        onSaved={(t) => {
          form.setValue('tenantId', t.id, { shouldValidate: true });
          setTenantInitial(tenantOption(t));
          setTenantKey((k) => k + 1); // remount the picker showing the new tenant
        }}
      />
    </>
  );
}

export default function NewLeasePage() {
  return (
    <Suspense>
      <NewLease />
    </Suspense>
  );
}
