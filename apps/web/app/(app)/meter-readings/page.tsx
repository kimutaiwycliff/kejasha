'use client';
import type { Schemas } from '@kejasha/api-client';
import { ReadingValue } from '@kejasha/contracts';
import { Badge } from '@kejasha/ui/components/badge';
import { Button } from '@kejasha/ui/components/button';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kejasha/ui/components/table';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { api, unwrap } from '@/lib/api';
import { formatDate, todayNairobi } from '@/lib/format';
import { errorMessage, fetchAll, toastError, useWrite } from '@/lib/hooks';
import { METER_KIND_LABEL } from '@/lib/labels';

type Meter = Schemas['Meter'];
type Result = Schemas['BulkReadingsResult']['items'][number];

const ERRORS: Record<string, string> = {
  reading_decreased: 'Lower than the last reading',
  reading_exists: 'Already read on this date',
  meter_archived: 'Meter was removed',
};

/** A caretaker's round: one property, every meter, one date, one save. */
export default function MeterReadingsPage() {
  const [propertyId, setPropertyId] = useState<string>();
  const [readOn, setReadOn] = useState(todayNairobi());
  const [values, setValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const units = useQuery({
    queryKey: ['units', { propertyId, all: true }],
    queryFn: () =>
      fetchAll(async (cursor) =>
        unwrap(
          await api.GET('/v1/units', {
            params: { query: { propertyId: propertyId!, cursor, limit: 100 } },
          }),
        ),
      ),
    enabled: Boolean(propertyId),
  });
  const meterQueries = useQueries({
    queries: (units.data ?? []).map((u) => ({
      queryKey: ['meters', u.id],
      queryFn: async () =>
        unwrap(await api.GET('/v1/units/{unitId}/meters', { params: { path: { unitId: u.id } } }))
          .items,
    })),
  });
  const meters: Meter[] = meterQueries.flatMap((q) => q.data ?? []).filter((m) => !m.archivedAt);
  const loading = units.isFetching || meterQueries.some((q) => q.isPending);
  const failed = units.error ?? meterQueries.find((q) => q.error)?.error;
  const save = useWrite(
    async (items: { meterId: string; readOn: string; reading: string }[], headers) =>
      unwrap(await api.POST('/v1/meter-readings/bulk', { body: { items }, headers })),
    { invalidate: [['meters'], ['readings']] },
  );
  const entered = meters.filter((m) => (values[m.id] ?? '').trim() !== '');
  const invalid = entered.filter((m) => !ReadingValue.safeParse(values[m.id]!.trim()).success);
  const submit = async () => {
    try {
      const r = await save.run(
        entered.map((m) => ({ meterId: m.id, readOn, reading: values[m.id]!.trim() })),
      );
      setResults(Object.fromEntries(r.items.map((i) => [i.meterId, i])));
      const applied = r.items.filter((i) => i.status === 'applied');
      // Keep only the rejected values on screen so they can be corrected.
      setValues((v) => {
        const n = { ...v };
        for (const i of applied) delete n[i.meterId];
        return n;
      });
      const rejected = r.items.length - applied.length;
      if (rejected) toast.warning(`${applied.length} saved, ${rejected} need attention`);
      else toast.success(`${applied.length} readings saved`);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <PageHeader
        title="Meter readings"
        description="Record every meter at a property in one go."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label>Property</Label>
          <PropertyPicker
            value={propertyId}
            allLabel={null}
            onChange={(id) => {
              setPropertyId(id);
              setValues({});
              setResults({});
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="readOn">Read on</Label>
          <Input
            id="readOn"
            type="date"
            value={readOn}
            max={todayNairobi()}
            onChange={(e) => setReadOn(e.target.value)}
            className="sm:w-44"
          />
        </div>
      </div>
      {!propertyId ? (
        <p className="text-sm text-muted-foreground">Choose a property to see its meters.</p>
      ) : failed ? (
        <p className="text-sm text-destructive">{errorMessage(failed)}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading meters…</p>
      ) : meters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No meters at this property. Add meters from a unit’s page.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Meter</TableHead>
                  <TableHead className="text-right">Last reading</TableHead>
                  <TableHead className="w-40">New reading</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {meters.map((m) => {
                  const res = results[m.id];
                  const v = values[m.id] ?? '';
                  const bad = v.trim() !== '' && !ReadingValue.safeParse(v.trim()).success;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.unitCode}</TableCell>
                      <TableCell>{METER_KIND_LABEL[m.kind]}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {m.lastReading
                          ? `${m.lastReading.reading} · ${formatDate(m.lastReading.readOn)}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`${m.unitCode} ${METER_KIND_LABEL[m.kind]} reading`}
                          inputMode="decimal"
                          value={v}
                          aria-invalid={bad || res?.status === 'rejected'}
                          onChange={(e) => setValues((s) => ({ ...s, [m.id]: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell>
                        {res?.status === 'applied' && <Badge>Saved</Badge>}
                        {res?.status === 'rejected' && (
                          <Badge variant="destructive">
                            {ERRORS[res.errorCode ?? ''] ?? res.errorCode}
                          </Badge>
                        )}
                        {bad && (
                          <span className="text-xs text-destructive">
                            Numbers only, up to 3 decimals
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void submit()}
              disabled={entered.length === 0 || invalid.length > 0 || save.pending}
            >
              {save.pending
                ? 'Saving…'
                : `Save ${entered.length || ''} reading${entered.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
