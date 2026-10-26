'use client';
import type { Schemas } from '@kejasha/api-client';
import { Button } from '@kejasha/ui/components/button';
import { Checkbox } from '@kejasha/ui/components/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kejasha/ui/components/dialog';
import { Label } from '@kejasha/ui/components/label';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { toastError, useWrite } from '@/lib/hooks';

/** Choose which agents and caretakers work at a property (they only see assigned properties). */
export function StaffDialog({
  open,
  onOpenChange,
  propertyId,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
  current: Schemas['StaffAssignment'][];
}) {
  const members = useQuery({
    queryKey: ['members'],
    queryFn: async () => unwrap(await api.GET('/v1/members')).items,
    enabled: open,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setPicked(new Set(current.map((s) => s.userId)));
  }, [open, current]);
  const save = useWrite(
    async (userIds: string[], headers) =>
      unwrap(
        await api.PUT('/v1/properties/{id}/staff', {
          params: { path: { id: propertyId } },
          body: { userIds },
          headers,
        }),
      ),
    { invalidate: [['property', propertyId]], success: 'Staff updated' },
  );
  const staff = (members.data ?? []).filter((m) => m.role === 'agent' || m.role === 'caretaker');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Staff at this property</DialogTitle>
          <DialogDescription>
            Agents and caretakers see only the properties they are assigned to.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
          {members.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!members.isPending && staff.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No agents or caretakers yet. Invite them from Members.
            </p>
          )}
          {staff.map((m) => (
            <Label key={m.userId} className="flex items-center gap-3 font-normal">
              <Checkbox
                checked={picked.has(m.userId)}
                onCheckedChange={(on) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (on) n.add(m.userId);
                    else n.delete(m.userId);
                    return n;
                  })
                }
              />
              <span className="flex-1">{m.name}</span>
              <span className="text-xs capitalize text-muted-foreground">{m.role}</span>
            </Label>
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={save.pending}
            onClick={async () => {
              try {
                await save.run([...picked]);
                onOpenChange(false);
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
