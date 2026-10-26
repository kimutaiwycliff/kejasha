'use client';
import type { Schemas } from '@kejasha/api-client';
import { UpdatePlanBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Details } from '@/components/detail';
import { FormDialog } from '@/components/dialogs';
import { MoneyField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { useWrite } from '@/lib/hooks';

type Plan = Schemas['Plan'];

function PlanDialog({
  plan,
  onOpenChange,
}: {
  plan: Plan | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<z.input<typeof UpdatePlanBody>, unknown, z.output<typeof UpdatePlanBody>>({
    resolver: zodResolver(UpdatePlanBody),
  });
  useEffect(() => {
    if (plan)
      form.reset({
        name: plan.name,
        baseCents: plan.baseCents,
        unitPriceCents: plan.unitPriceCents,
        listingPriceCents: plan.listingPriceCents,
        minimumCents: plan.minimumCents,
      });
  }, [plan, form]);
  const save = useWrite(
    async (body: z.output<typeof UpdatePlanBody>, headers) =>
      unwrap(
        await api.PATCH('/v1/operator/plans/{code}', {
          params: { path: { code: plan!.code } },
          body,
          headers,
        }),
      ),
    {
      invalidate: [['operator', 'plans']],
      success: 'Prices saved; they apply from each org’s next invoice',
    },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={plan !== null}
      onOpenChange={onOpenChange}
      title={`Edit ${plan?.name ?? ''} plan`}
      form={form}
      onSubmit={submit}
    >
      <TextField form={form} name="name" label="Name" />
      <div className="grid grid-cols-2 gap-4">
        <MoneyField form={form} name="baseCents" label="Base per month" />
        <MoneyField form={form} name="unitPriceCents" label="Per occupied unit" />
        <MoneyField form={form} name="listingPriceCents" label="Per short-stay listing" />
        <MoneyField form={form} name="minimumCents" label="Minimum per month" />
      </div>
    </FormDialog>
  );
}

export default function OperatorPlansPage() {
  const [editing, setEditing] = useState<Plan | null>(null);
  const plans = useQuery({
    queryKey: ['operator', 'plans'],
    queryFn: async () => unwrap(await api.GET('/v1/operator/plans')).items,
  });
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Plans</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data?.map((p) => (
          <Card key={p.code}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {p.name} {p.whiteLabel && <Badge variant="secondary">White label</Badge>}
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Edit ${p.name}`}
                onClick={() => setEditing(p)}
              >
                <Pencil />
              </Button>
            </CardHeader>
            <CardContent>
              <Details
                items={[
                  ['Base', formatKes(p.baseCents)],
                  ['Per occupied unit', formatKes(p.unitPriceCents)],
                  ['Per listing', formatKes(p.listingPriceCents)],
                  ['Minimum', formatKes(p.minimumCents)],
                ]}
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <PlanDialog plan={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}
