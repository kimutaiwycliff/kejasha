'use client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { MessageSquarePlus, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink, Details } from '@/components/detail';
import {
  EditTicketDialog,
  PRIORITY_TONE,
  STATUS_TONE,
  TicketStepDialog,
  type TicketStep,
} from '@/components/maintenance/ticket-dialogs';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { api, unwrap } from '@/lib/api';
import { formatKes } from '@/lib/format';
import { useCan } from '@/lib/hooks';
import { TICKET_CATEGORY_LABEL, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from '@/lib/labels';

const when = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi',
});
const REPORTER = { staff: 'Staff', caretaker: 'Caretaker', tenant: 'Tenant' } as const;

/** Status moves the API allows (caretakers cannot close or cancel). */
function nextSteps(
  status: string,
  caretaker: boolean,
): { step: TicketStep; label: string; primary?: boolean }[] {
  const all: Record<string, { step: TicketStep; label: string; primary?: boolean }[]> = {
    open: [
      { step: 'in_progress', label: 'Start work', primary: true },
      { step: 'resolved', label: 'Mark resolved' },
      { step: 'cancelled', label: 'Cancel' },
    ],
    in_progress: [
      { step: 'resolved', label: 'Mark resolved', primary: true },
      { step: 'open', label: 'Back to open' },
      { step: 'cancelled', label: 'Cancel' },
    ],
    resolved: [
      { step: 'closed', label: 'Close ticket', primary: true },
      { step: 'open', label: 'Reopen' },
    ],
  };
  return (all[status] ?? []).filter(
    (s) => !caretaker || (s.step !== 'closed' && s.step !== 'cancelled'),
  );
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const agent = useCan('agent');
  const [step, setStep] = useState<TicketStep | null>(null);
  const [editing, setEditing] = useState(false);
  const tQuery = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => unwrap(await api.GET('/v1/tickets/{id}', { params: { path: { id } } })),
  });
  const t = tQuery.data;
  if (!t) return <QueryFallback query={tQuery} className="h-96" />;
  const live = t.status !== 'closed' && t.status !== 'cancelled';
  return (
    <>
      <BackLink href="/maintenance" label="Maintenance" />
      <PageHeader
        title={t.title}
        description={`${t.number} · ${t.unitCode ? `Unit ${t.unitCode}` : 'Common area'} · ${t.propertyName}`}
        actions={
          <>
            {nextSteps(t.status, !agent).map((s) => (
              <Button
                key={s.step}
                variant={s.primary ? 'default' : 'outline'}
                onClick={() => setStep(s.step)}
              >
                {s.label}
              </Button>
            ))}
            {live && (
              <Button variant="outline" onClick={() => setStep('note')}>
                <MessageSquarePlus /> Update
              </Button>
            )}
            {agent && live && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant={STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
        <Badge variant={PRIORITY_TONE[t.priority]}>
          {TICKET_PRIORITY_LABEL[t.priority]} priority
        </Badge>
        <Badge variant="outline">{TICKET_CATEGORY_LABEL[t.category]}</Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">
                {when.format(new Date(t.createdAt))} · reported by{' '}
                {REPORTER[t.reporterKind].toLowerCase()}
              </p>
              {t.description && <p className="mt-1 whitespace-pre-line">{t.description}</p>}
            </div>
            {t.updates.map((u) => (
              <div key={u.id} className="border-l-2 pl-3">
                <p className="text-xs text-muted-foreground">
                  {when.format(new Date(u.createdAt))}
                  {u.statusTo && (
                    <>
                      {' · '}
                      <span className="font-medium text-foreground">
                        {TICKET_STATUS_LABEL[u.statusTo]}
                      </span>
                    </>
                  )}
                </p>
                {u.note && <p className="mt-1 whitespace-pre-line">{u.note}</p>}
                {u.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {u.photos.map((p) => (
                      <a key={p.key} href={p.url} target="_blank" rel="noreferrer">
                        <img
                          src={p.url}
                          alt="Ticket photo"
                          className="size-20 rounded-md object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {t.updates.length === 0 && <p className="text-muted-foreground">No updates yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Details
              items={[
                ['Assigned to', t.assigneeName],
                ['Cost', t.costCents == null ? null : formatKes(t.costCents)],
                [
                  'Where',
                  t.unitId ? (
                    <Link
                      key="u"
                      href={`/units/${t.unitId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {t.unitCode} · {t.propertyName}
                    </Link>
                  ) : (
                    <Link
                      key="p"
                      href={`/properties/${t.propertyId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {t.propertyName}
                    </Link>
                  ),
                ],
                ['Expense recorded', t.expenseId ? 'Yes' : null],
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <TicketStepDialog ticket={t} step={step} onOpenChange={(o) => !o && setStep(null)} />
      <EditTicketDialog ticket={t} open={editing} onOpenChange={setEditing} />
    </>
  );
}
