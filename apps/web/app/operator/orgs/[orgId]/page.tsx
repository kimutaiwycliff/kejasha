'use client';
import { SubscriptionAction } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { BackLink, Details } from '@/components/detail';
import { FormDialog } from '@/components/dialogs';
import { NumberField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem } from '@/components/form';
import { QueryFallback } from '@/components/query-fallback';
import { api, unwrap } from '@/lib/api';
import { SUB_STATUS } from '@/lib/billing-labels';
import { formatDate, formatKes } from '@/lib/format';
import { useWrite } from '@/lib/hooks';

type Action = z.output<typeof SubscriptionAction>['action'];
const ACTIONS: { action: Action; label: string; destructive?: boolean }[] = [
  { action: 'grant_trial', label: 'Grant trial' },
  { action: 'extend_period', label: 'Extend period' },
  { action: 'change_plan', label: 'Change plan' },
  { action: 'reactivate', label: 'Reactivate' },
  { action: 'suspend', label: 'Suspend', destructive: true },
  { action: 'cancel', label: 'Cancel', destructive: true },
];
const when = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi',
});

function ActionDialog({
  orgId,
  action,
  onOpenChange,
}: {
  orgId: string;
  action: Action | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<
    z.input<typeof SubscriptionAction>,
    unknown,
    z.output<typeof SubscriptionAction>
  >({
    resolver: zodResolver(SubscriptionAction),
  });
  useEffect(() => {
    if (action)
      form.reset({
        action,
        note: '',
        ...(action === 'grant_trial' || action === 'extend_period' ? { days: 14 } : {}),
      });
  }, [action, form]);
  const run = useWrite(
    async (body: z.output<typeof SubscriptionAction>, headers) =>
      unwrap(
        await api.POST('/v1/operator/orgs/{orgId}/subscription', {
          params: { path: { orgId } },
          body,
          headers,
        }),
      ),
    { invalidate: [['operator']], success: 'Done' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await run.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const label = ACTIONS.find((a) => a.action === action)?.label ?? '';
  return (
    <FormDialog
      open={action !== null}
      onOpenChange={onOpenChange}
      title={label}
      description="Recorded in the org's audit log with your name."
      form={form}
      onSubmit={submit}
      submitLabel={label}
    >
      {(action === 'grant_trial' || action === 'extend_period') && (
        <NumberField form={form} name="days" label="Days" min={1} max={365} />
      )}
      {action === 'change_plan' && (
        <SelectField
          form={form}
          name="planCode"
          label="Plan"
          options={[
            { value: 'landlord', label: 'Landlord' },
            { value: 'host', label: 'Host' },
            { value: 'agency', label: 'Agency' },
          ]}
        />
      )}
      <TextareaField form={form} name="note" label="Why" />
    </FormDialog>
  );
}

export default function OperatorOrgPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [action, setAction] = useState<Action | null>(null);
  const q = useQuery({
    queryKey: ['operator', 'org', orgId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/operator/orgs/{orgId}', { params: { path: { orgId } } })),
  });
  const audit = useQuery({
    queryKey: ['operator', 'audit', orgId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/operator/orgs/{orgId}/audit', { params: { path: { orgId } } }))
        .items,
  });
  const o = q.data;
  if (!o) return <QueryFallback query={q} />;
  return (
    <>
      <BackLink href="/operator" label="Organizations" />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{o.name}</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {o.kind} · {o.units} units · {o.members} members
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <Button
              key={a.action}
              size="sm"
              variant={a.destructive ? 'destructive' : 'outline'}
              onClick={() => setAction(a.action)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <Details
              items={[
                [
                  'Status',
                  o.status ? (
                    <Badge key="s" variant={SUB_STATUS[o.status].tone}>
                      {SUB_STATUS[o.status].label}
                    </Badge>
                  ) : null,
                ],
                ['Plan', o.planCode],
                ['Paid until', formatDate(o.currentPeriodEnd)],
                ['Trial ends', formatDate(o.trialEndsOn)],
                ['Billing email', o.billingEmail],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Owners</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {o.owners.map((w, i) => (
              <div key={i}>
                <p className="font-medium">{w.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[w.email, w.phone].filter(Boolean).join(' · ')}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {o.invoices.length === 0 && <p className="text-muted-foreground">None yet.</p>}
            {o.invoices.map((i) => (
              <div key={i.id} className="flex justify-between gap-2 tabular-nums">
                <span>
                  {i.number} · {formatDate(i.periodStart)}
                </span>
                <span>
                  {formatKes(i.amountCents)}{' '}
                  <Badge variant={i.status === 'paid' ? 'default' : 'secondary'}>{i.status}</Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y text-sm">
          {audit.data?.length === 0 && <p className="text-muted-foreground">Nothing recorded.</p>}
          {audit.data?.map((a) => (
            <div key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <span className="font-mono text-xs">{a.action}</span>{' '}
                <span className="text-muted-foreground">
                  {a.entityType}
                  {a.actorKind !== 'user' ? ` · by ${a.actorKind}` : ''}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {when.format(new Date(a.occurredAt))}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <ActionDialog
        orgId={orgId}
        action={action}
        onOpenChange={(open) => !open && setAction(null)}
      />
    </>
  );
}
