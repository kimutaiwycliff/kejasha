'use client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kejasha/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';

/** Up to 100 properties for filters and pickers (larger portfolios search instead). */
export function usePropertyOptions() {
  return useQuery({
    queryKey: ['properties', 'options'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/properties', { params: { query: { limit: 100 } } })).items.map(
        (p) => ({
          value: p.id,
          label: p.name,
        }),
      ),
    staleTime: 60_000,
  });
}

/** A standalone select (not in a form) for filtering by property. */
export function PropertyPicker({
  value,
  onChange,
  allLabel = 'All properties',
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  /** Omit the "all" choice by passing null. */
  allLabel?: string | null;
}) {
  const props = usePropertyOptions();
  const items = [...(allLabel ? [{ value: '', label: allLabel }] : []), ...(props.data ?? [])];
  return (
    <Select items={items} value={value ?? ''} onValueChange={(v) => onChange(v || undefined)}>
      <SelectTrigger aria-label="Property" className="w-full sm:w-56">
        <SelectValue placeholder={props.isPending ? 'Loading…' : 'Choose a property'} />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value || 'all'} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
