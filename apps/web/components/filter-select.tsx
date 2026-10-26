'use client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kejasha/ui/components/select';
import type { Option } from '@/components/fields';

/** Base UI shows the placeholder for an empty-string value, so '' is mapped to a real value. */
const ALL = '__all';

/** A standalone filter select; an option with value '' is the "all" choice. */
export function FilterSelect<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: V | undefined;
  onChange: (v: V | undefined) => void;
}) {
  return (
    <Select
      items={options.map((o) => ({ ...o, value: o.value || ALL }))}
      value={value || ALL}
      onValueChange={(v) => onChange((v && v !== ALL ? v : undefined) as V | undefined)}
    >
      <SelectTrigger aria-label={label} className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || ALL} value={o.value || ALL}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
