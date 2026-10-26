'use client';
import type { Schemas } from '@kejasha/api-client';
import { CreateInvitationBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kejasha/ui/components/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kejasha/ui/components/select';
import { Tabs, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { columnsFor, DataTable } from '@/components/data-table';
import { ConfirmButton, FormDialog } from '@/components/dialogs';
import { SelectField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { useLandlordOptions } from '@/components/portfolio/property-dialog';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toastError, useCan, useOrgKind, useWrite } from '@/lib/hooks';
import { ROLE_HELP, ROLE_LABEL } from '@/lib/labels';
import { useMe } from '@/lib/session';

type Member = Schemas['Member'];
type Role = Member['role'];
const ROLES = (Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
  value: r,
  label: `${ROLE_LABEL[r]} — ${ROLE_HELP[r]}`,
}));
const keys = [['members'], ['invitations']];

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [by, setBy] = useState<'email' | 'phone'>('email');
  const form = useForm<
    z.input<typeof CreateInvitationBody>,
    unknown,
    z.output<typeof CreateInvitationBody>
  >({
    resolver: zodResolver(CreateInvitationBody),
  });
  useEffect(() => {
    if (open) form.reset({ role: 'agent' });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateInvitationBody>, headers) =>
      unwrap(await api.POST('/v1/invitations', { body, headers })),
    { invalidate: keys, success: (i) => `Invitation sent to ${i.email ?? i.phone}` },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(by === 'email' ? { ...v, phone: undefined } : { ...v, email: undefined });
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="They join after signing in with this email or phone (verified)."
      form={form}
      onSubmit={submit}
      submitLabel="Send invitation"
    >
      <Tabs value={by} onValueChange={(v) => setBy(v as typeof by)}>
        <TabsList>
          <TabsTrigger value="email">By email</TabsTrigger>
          <TabsTrigger value="phone">By phone (SMS)</TabsTrigger>
        </TabsList>
      </Tabs>
      {by === 'email' ? (
        <TextField form={form} name="email" label="Email" type="email" empty={undefined} />
      ) : (
        <TextField
          form={form}
          name="phone"
          label="Phone"
          type="tel"
          placeholder="0712 345 678"
          empty={undefined}
          description="Best for caretakers without email."
        />
      )}
      <SelectField form={form} name="role" label="Role" options={ROLES} />
    </FormDialog>
  );
}

/** Viewers in an agency see one landlord's figures; this picks which. */
function ScopePicker({ member }: { member: Member }) {
  const landlords = useLandlordOptions(true);
  const scope = useWrite(
    async (clientLandlordId: string | null, headers) =>
      unwrap(
        await api.PUT('/v1/members/{id}/scope', {
          params: { path: { id: member.id } },
          body: { clientLandlordId },
          headers,
        }),
      ),
    { invalidate: keys, success: 'Access updated' },
  );
  const items = [{ value: '__none', label: 'No landlord yet' }, ...(landlords.data ?? [])];
  return (
    <Select
      items={items}
      value={member.clientLandlordId ?? '__none'}
      onValueChange={(v) => scope.run(v && v !== '__none' ? v : null).catch(toastError)}
    >
      <SelectTrigger aria-label={`Landlord ${member.name} sees`} size="sm" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function TeamPage() {
  const { data: me } = useMe();
  const owner = useCan('owner');
  const agency = useOrgKind() === 'agency';
  const [inviting, setInviting] = useState(false);
  const members = useQuery({
    queryKey: ['members'],
    queryFn: async () => unwrap(await api.GET('/v1/members')).items,
  });
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/invitations')).items.filter((i) => i.status === 'pending'),
  });
  const setRole = useWrite(
    async ({ id, role }: { id: string; role: Role }, headers) =>
      unwrap(
        await api.PATCH('/v1/members/{id}', { params: { path: { id } }, body: { role }, headers }),
      ),
    { invalidate: keys, success: 'Role changed' },
  );
  const remove = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/members/{id}', { params: { path: { id } }, headers })),
    { invalidate: keys, success: 'Removed from the organization' },
  );
  const cancel = useWrite(
    async (id: string, headers) =>
      unwrap(await api.DELETE('/v1/invitations/{id}', { params: { path: { id } }, headers })),
    { invalidate: keys, success: 'Invitation cancelled' },
  );
  const col = columnsFor<Member>();
  const columns = [
    col.accessor('name', {
      header: 'Member',
      meta: { className: 'whitespace-normal' },
      cell: (c) => (
        <div>
          <p className="font-medium">
            {c.getValue()}{' '}
            {c.row.original.userId === me?.user.id && <Badge variant="secondary">You</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {c.row.original.email ?? c.row.original.phone}
          </p>
        </div>
      ),
    }),
    col.accessor('role', {
      header: 'Role',
      cell: (c) => {
        const m = c.row.original;
        if (!owner || m.userId === me?.user.id) return ROLE_LABEL[c.getValue()];
        const items = (Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
          value: r,
          label: ROLE_LABEL[r],
        }));
        return (
          <Select
            items={items}
            value={m.role}
            onValueChange={(v) => v && setRole.run({ id: m.id, role: v as Role }).catch(toastError)}
          >
            <SelectTrigger aria-label={`Role of ${m.name}`} size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    }),
    ...(agency
      ? [
          col.display({
            id: 'scope',
            header: 'Sees',
            meta: { hideOnMobile: true },
            cell: (c) =>
              c.row.original.role === 'viewer' ? (
                <ScopePicker member={c.row.original} />
              ) : (
                'Everything'
              ),
          }),
        ]
      : []),
    col.display({
      id: 'remove',
      header: '',
      cell: (c) =>
        c.row.original.userId === me?.user.id ||
        (c.row.original.role === 'owner' && !owner) ? null : (
          <ConfirmButton
            size="sm"
            variant="ghost"
            label="Remove"
            title={`Remove ${c.row.original.name}?`}
            description="They lose access to this organization at once. Their past work stays on record."
            confirmLabel="Remove"
            onConfirm={() => remove.run(c.row.original.id)}
          />
        ),
    }),
  ];
  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in to this organization, and what they can do."
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus /> Invite
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={members.data ?? []}
        isPending={members.isPending}
        error={members.error}
      />
      {(invitations.data?.length ?? 0) > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Waiting to join</CardTitle>
            <CardDescription>Invitations last 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {invitations.data!.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{i.email ?? i.phone}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABEL[i.role]} · expires {formatDate(i.expiresAt.slice(0, 10))}
                  </p>
                </div>
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  label="Cancel"
                  title="Cancel this invitation?"
                  description="The link stops working."
                  confirmLabel="Cancel invitation"
                  onConfirm={() => cancel.run(i.id)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </>
  );
}
