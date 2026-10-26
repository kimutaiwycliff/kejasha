'use client';
import type { Schemas } from '@kejasha/api-client';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, ListChecks, Pencil, Plus, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import {
  CredentialsDialog,
  EditChannelDialog,
  GoLiveDialog,
  NewChannelDialog,
} from '@/components/payments/channel-dialogs';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { errorMessage, toastError, useWrite } from '@/lib/hooks';
import { CHANNEL_KIND_LABEL } from '@/lib/labels';

type Channel = Schemas['PaymentChannel'];

export default function PaymentChannelsPage() {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creds, setCreds] = useState<Channel | null>(null);
  const [goLive, setGoLive] = useState<Channel | null>(null);
  const list = useQuery({
    queryKey: ['payment-channels'],
    queryFn: async () => unwrap(await api.GET('/v1/payment-channels')).items,
  });
  const register = useWrite(
    async (id: string, headers) =>
      unwrap(
        await api.POST('/v1/payment-channels/{id}/register-c2b', {
          params: { path: { id } },
          headers,
        }),
      ),
    { invalidate: [['payment-channels']], success: 'Safaricom now sends payments to Kejasha' },
  );
  return (
    <>
      <PageHeader
        title="M-Pesa setup"
        description="Where tenants pay you. With a Paybill or Till connected, payments match themselves using the unit code as the account number."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        }
      />
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.error ? (
        <p className="text-sm text-destructive">{errorMessage(list.error)}</p>
      ) : list.data!.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing connected yet</CardTitle>
            <CardDescription>
              Add your Paybill or Till to match payments automatically. Paid to a personal number?
              Add it to import statements or paste M-Pesa messages instead.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data!.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {c.displayName}
                  {c.status === 'disabled' && <Badge variant="secondary">Disabled</Badge>}
                  {c.kind !== 'phone' && (
                    <Badge variant="outline">
                      {c.darajaEnv === 'sandbox' ? 'Sandbox' : 'Live'}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {CHANNEL_KIND_LABEL[c.kind]} · <span className="font-mono">{c.shortcode}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {c.kind !== 'phone' && (
                  <ul className="flex flex-col gap-1 text-muted-foreground">
                    <li>
                      Credentials:{' '}
                      {c.hasCredentials
                        ? `saved ${c.credentialsUpdatedAt ? formatDate(c.credentialsUpdatedAt.slice(0, 10)) : ''}`
                        : 'not set'}
                    </li>
                    <li>
                      Payment notifications:{' '}
                      {c.c2bRegisteredAt
                        ? `registered ${formatDate(c.c2bRegisteredAt.slice(0, 10))}`
                        : 'not registered'}
                    </li>
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    <Pencil /> Edit
                  </Button>
                  {c.kind !== 'phone' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setCreds(c)}>
                        <KeyRound /> {c.hasCredentials ? 'Replace keys' : 'Add keys'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!c.hasCredentials || register.pending}
                        onClick={() => register.run(c.id).catch(toastError)}
                      >
                        <PlugZap /> {c.c2bRegisteredAt ? 'Re-register' : 'Register'} URLs
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setGoLive(c)}>
                        <ListChecks /> Go-live checklist
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <NewChannelDialog open={adding} onOpenChange={setAdding} />
      <EditChannelDialog channel={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <CredentialsDialog channel={creds} onOpenChange={(o) => !o && setCreds(null)} />
      <GoLiveDialog channel={goLive} onOpenChange={(o) => !o && setGoLive(null)} />
    </>
  );
}
