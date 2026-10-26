'use client';
import { CreateInspectionBody } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { DateField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { formatDate, todayNairobi } from '@/lib/format';
import { toastError, useCan, useWrite } from '@/lib/hooks';
import { CONDITION_LABEL, options } from '@/lib/labels';
import { uploadFile } from '@/lib/upload';

type Values = z.input<typeof CreateInspectionBody>;
const KIND_LABEL = { move_in: 'Move-in', move_out: 'Move-out' } as const;
const AREAS = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom'];

/** Photo picker for one checklist item: uploads each file and keeps the returned keys. */
function PhotoKeys({ form, index }: { form: UseFormReturn<Values>; index: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <Controller
      control={form.control}
      name={`items.${index}.photoKeys`}
      render={({ field }) => {
        const keys = field.value ?? [];
        return (
          <div className="flex items-center gap-2 text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || keys.length >= 10}
              render={<label />}
              nativeButton={false}
            >
              <ImagePlus /> {busy ? 'Uploading…' : 'Photos'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])].slice(0, 10 - keys.length);
                  e.target.value = '';
                  setBusy(true);
                  try {
                    const added: string[] = [];
                    for (const f of files) added.push(await uploadFile(f, 'inspection_photo'));
                    field.onChange([...keys, ...added]);
                  } catch (err) {
                    toastError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Button>
            {keys.length > 0 && (
              <span className="text-muted-foreground">{keys.length} attached</span>
            )}
          </div>
        );
      }}
    />
  );
}

function InspectionDialog({
  leaseId,
  open,
  onOpenChange,
}: {
  leaseId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<Values, unknown, z.output<typeof CreateInspectionBody>>({
    resolver: zodResolver(CreateInspectionBody),
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  useEffect(() => {
    if (open)
      form.reset({
        kind: 'move_in',
        inspectedOn: todayNairobi(),
        items: AREAS.map((area) => ({ area, condition: 'good' as const })),
      });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateInspectionBody>, headers) =>
      unwrap(
        await api.POST('/v1/leases/{leaseId}/inspections', {
          params: { path: { leaseId } },
          body,
          headers,
        }),
      ),
    { invalidate: [['inspections', leaseId]], success: 'Inspection saved' },
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
      open={open}
      onOpenChange={onOpenChange}
      title="Inspection"
      description="Record each area's condition with photos; move-out is compared against move-in."
      form={form}
      onSubmit={submit}
      submitLabel="Save inspection"
      wide
    >
      <div className="grid grid-cols-2 gap-4">
        <SelectField form={form} name="kind" label="Type" options={options(KIND_LABEL)} />
        <DateField form={form} name="inspectedOn" label="Date" />
      </div>
      {items.fields.map((f, i) => (
        <div key={f.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="grid grid-cols-[1fr_9rem_auto] items-end gap-3">
            <TextField form={form} name={`items.${i}.area`} label="Area" />
            <SelectField
              form={form}
              name={`items.${i}.condition`}
              label="Condition"
              options={options(CONDITION_LABEL)}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label="Remove area"
              disabled={items.fields.length === 1}
              onClick={() => items.remove(i)}
            >
              <Trash2 />
            </Button>
          </div>
          <TextField form={form} name={`items.${i}.note`} label="Note" empty={undefined} />
          <PhotoKeys form={form} index={i} />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => items.append({ area: '', condition: 'good' })}
      >
        <Plus /> Add area
      </Button>
      <TextareaField form={form} name="notes" label="Overall notes" />
    </FormDialog>
  );
}

const TONE = {
  good: 'default',
  fair: 'secondary',
  poor: 'destructive',
  damaged: 'destructive',
} as const;

export function InspectionsCard({ leaseId, canAdd }: { leaseId: string; canAdd: boolean }) {
  const canRecord = useCan('agent') && canAdd;
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['inspections', leaseId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/leases/{leaseId}/inspections', { params: { path: { leaseId } } }))
        .items,
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Inspections</CardTitle>
        {canRecord && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Record inspection
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        {list.data?.length === 0 && <p className="text-muted-foreground">No inspections yet.</p>}
        {list.data?.map((ins) => (
          <div key={ins.id} className="flex flex-col gap-3">
            <p className="font-medium">
              {KIND_LABEL[ins.kind]} · {formatDate(ins.inspectedOn)}
            </p>
            {ins.items.map((it, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span>{it.area}</span>
                  <Badge variant={TONE[it.condition]}>{CONDITION_LABEL[it.condition]}</Badge>
                  {it.note && <span className="text-muted-foreground">{it.note}</span>}
                </div>
                {it.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {it.photos.map((p) => (
                      <a key={p.key} href={p.url} target="_blank" rel="noreferrer">
                        <img
                          src={p.url}
                          alt={`${it.area} photo`}
                          className="size-20 rounded-md object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {ins.notes && <p className="text-muted-foreground">{ins.notes}</p>}
          </div>
        ))}
      </CardContent>
      <InspectionDialog leaseId={leaseId} open={adding} onOpenChange={setAdding} />
    </Card>
  );
}
