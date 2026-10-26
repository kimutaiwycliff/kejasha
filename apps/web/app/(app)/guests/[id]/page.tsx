'use client';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent } from '@kejasha/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink, Details } from '@/components/detail';
import { LinkButton } from '@/components/link-button';
import { PageHeader } from '@/components/page-header';
import { QueryFallback } from '@/components/query-fallback';
import { GuestDialog } from '@/components/shortstay/guest-dialog';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default function GuestPage() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const gQuery = useQuery({
    queryKey: ['guest', id],
    queryFn: async () => unwrap(await api.GET('/v1/guests/{id}', { params: { path: { id } } })),
  });
  const g = gQuery.data;
  if (!g) return <QueryFallback query={gQuery} className="h-64" />;
  return (
    <>
      <BackLink href="/guests" label="Guests" />
      <PageHeader
        title={g.fullName}
        description={
          g.stays > 0
            ? `${g.stays} stay${g.stays === 1 ? '' : 's'}, last on ${formatDate(g.lastStayOn)}`
            : 'No stays yet'
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <LinkButton href="/bookings/new">
              <Plus /> New booking
            </LinkButton>
          </>
        }
      />
      <Card>
        <CardContent>
          <Details
            items={[
              ['Phone', g.phone],
              ['Email', g.email],
              ['ID / passport', g.idNumber],
              ['Nationality', g.nationality],
              ['Notes', g.notes],
            ]}
          />
        </CardContent>
      </Card>
      <GuestDialog open={editing} onOpenChange={setEditing} guest={g} />
    </>
  );
}
