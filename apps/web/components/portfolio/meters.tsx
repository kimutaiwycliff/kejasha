'use client';
import type { Schemas } from '@kejasha/api-client';
import {
  BusinessDateInput,
  CreateMeterBody,
  CreateReadingBody,
  ReadingValue,
} from '@kejasha/contracts';
import { Button } from '@kejasha/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kejasha/ui/components/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@kejasha/ui/components/dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Gauge, History, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/dialogs';
import { DateField, SelectField, TextareaField } from '@/components/fields';
import { applyProblem, TextField } from '@/components/form';
import { api, unwrap } from '@/lib/api';
import { formatDate, todayNairobi } from '@/lib/format';
import { useCan, useWrite } from '@/lib/hooks';
import { METER_KIND_LABEL, options } from '@/lib/labels';

type Meter = Schemas['Meter'];

// The first reading is optional as a whole, so the form holds it flat and nests it on submit.
const NewMeterForm = CreateMeterBody.omit({ initialReading: true }).extend({
  readOn: BusinessDateInput,
  reading: ReadingValue.optional(),
});
type NewMeterValues = z.input<typeof NewMeterForm>;

function NewMeterDialog({
  open,
  onOpenChange,
  unitId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  unitId: string;
}) {
  const form = useForm<NewMeterValues, unknown, z.output<typeof NewMeterForm>>({
    resolver: zodResolver(NewMeterForm),
  });
  useEffect(() => {
    if (open) form.reset({ kind: 'water', readOn: todayNairobi() });
  }, [open, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateMeterBody>, headers) =>
      unwrap(
        await api.POST('/v1/units/{unitId}/meters', {
          params: { path: { unitId } },
          body,
          headers,
        }),
      ),
    { invalidate: [['meters', unitId]], success: 'Meter added' },
  );
  const submit = form.handleSubmit(async ({ readOn, reading, ...meter }) => {
    try {
      await save.run({ ...meter, ...(reading ? { initialReading: { readOn, reading } } : {}) });
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New meter"
      form={form}
      onSubmit={submit}
      submitLabel="Add meter"
    >
      <SelectField form={form} name="kind" label="Type" options={options(METER_KIND_LABEL)} />
      <TextField form={form} name="serial" label="Serial number" empty={undefined} />
      <TextField
        form={form}
        name="unitLabel"
        label="Measured in"
        placeholder="m³ or kWh"
        empty={undefined}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          form={form}
          name="reading"
          label="Current reading"
          inputMode="decimal"
          empty={undefined}
        />
        <DateField form={form} name="readOn" label="Read on" />
      </div>
    </FormDialog>
  );
}

type ReadingValues = z.input<typeof CreateReadingBody>;

export function ReadingDialog({
  meter,
  onOpenChange,
}: {
  meter: Meter | null;
  onOpenChange: (o: boolean) => void;
}) {
  const form = useForm<ReadingValues, unknown, z.output<typeof CreateReadingBody>>({
    resolver: zodResolver(CreateReadingBody),
  });
  useEffect(() => {
    if (meter) form.reset({ readOn: todayNairobi(), reading: '' });
  }, [meter, form]);
  const save = useWrite(
    async (body: z.output<typeof CreateReadingBody>, headers) =>
      unwrap(
        await api.POST('/v1/meters/{meterId}/readings', {
          params: { path: { meterId: meter!.id } },
          body,
          headers,
        }),
      ),
    { invalidate: [['meters'], ['readings']], success: 'Reading saved' },
  );
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.run(v);
      onOpenChange(false);
    } catch (e) {
      applyProblem(form, e);
    }
  });
  const last = meter?.lastReading;
  return (
    <FormDialog
      open={meter !== null}
      onOpenChange={onOpenChange}
      title={meter ? `${METER_KIND_LABEL[meter.kind]} reading` : ''}
      description={
        last
          ? `Last: ${last.reading} ${meter?.unitLabel} on ${formatDate(last.readOn)}`
          : 'First reading for this meter.'
      }
      form={form}
      onSubmit={submit}
      submitLabel="Save reading"
    >
      <TextField
        form={form}
        name="reading"
        label={`Reading (${meter?.unitLabel ?? ''})`}
        inputMode="decimal"
      />
      <DateField form={form} name="readOn" label="Read on" />
      <TextareaField form={form} name="note" label="Note" empty={undefined} />
    </FormDialog>
  );
}

function HistoryDialog({
  meter,
  onOpenChange,
}: {
  meter: Meter | null;
  onOpenChange: (o: boolean) => void;
}) {
  const readings = useQuery({
    queryKey: ['readings', meter?.id],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/meters/{meterId}/readings', {
          params: { path: { meterId: meter!.id } },
        }),
      ).items,
    enabled: meter !== null,
  });
  return (
    <Dialog open={meter !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reading history</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto text-sm">
          {readings.data?.length === 0 && <p className="text-muted-foreground">No readings yet.</p>}
          {readings.data?.map((r) => (
            <div key={r.id} className="flex justify-between gap-4 tabular-nums">
              <span className="text-muted-foreground">{formatDate(r.readOn)}</span>
              <span>
                {r.reading} {meter?.unitLabel}
                {r.consumptionSincePrevious !== null && (
                  <span className="text-muted-foreground"> (+{r.consumptionSincePrevious})</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A unit's water/electricity meters: latest reading, record a reading, history. */
export function MetersCard({ unitId, live }: { unitId: string; live: boolean }) {
  const canAdd = useCan('manager');
  const [adding, setAdding] = useState(false);
  const [reading, setReading] = useState<Meter | null>(null);
  const [history, setHistory] = useState<Meter | null>(null);
  const meters = useQuery({
    queryKey: ['meters', unitId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/units/{unitId}/meters', { params: { path: { unitId } } })).items,
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Meters</CardTitle>
        {canAdd && live && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add meter
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {meters.data?.length === 0 && (
          <p className="text-muted-foreground">No meters. Add one to bill water or power by use.</p>
        )}
        {meters.data?.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">
                {METER_KIND_LABEL[m.kind]}{' '}
                {m.serial && <span className="text-muted-foreground">· {m.serial}</span>}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {m.lastReading
                  ? `${m.lastReading.reading} ${m.unitLabel} on ${formatDate(m.lastReading.readOn)}`
                  : 'No readings yet'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHistory(m)}
                aria-label={`${METER_KIND_LABEL[m.kind]} history`}
              >
                <History />
              </Button>
              {live && (
                <Button size="sm" variant="outline" onClick={() => setReading(m)}>
                  <Gauge /> Reading
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
      <NewMeterDialog open={adding} onOpenChange={setAdding} unitId={unitId} />
      <ReadingDialog meter={reading} onOpenChange={(o) => !o && setReading(null)} />
      <HistoryDialog meter={history} onOpenChange={(o) => !o && setHistory(null)} />
    </Card>
  );
}
