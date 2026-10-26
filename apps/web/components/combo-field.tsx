'use client';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@kejasha/ui/components/combobox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@kejasha/ui/components/field';
import { useState } from 'react';
import { Controller, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import type { Option } from '@/components/fields';
import { useDebounced } from '@/lib/hooks';

export interface ComboOption extends Option {
  hint?: string;
}

/**
 * A searchable picker over a server list. `useOptions(query)` runs the search (the API filters;
 * nothing is filtered client-side). The form holds the option's `value` (an id).
 */
export function ComboField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  placeholder = 'Search…',
  useOptions,
  initial,
  onPicked,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  description?: string;
  placeholder?: string;
  useOptions: (query: string) => { data: ComboOption[] | undefined; isPending: boolean };
  /** The already-chosen option, so its label shows before any search. */
  initial?: ComboOption | null;
  onPicked?: (o: ComboOption | null) => void;
}) {
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim());
  const [picked, setPicked] = useState<ComboOption | null>(initial ?? null);
  const opts = useOptions(query);
  // Keep the chosen option in the list so Base UI can show it even when a search excludes it.
  const items = [
    ...(picked ? [picked] : []),
    ...(opts.data ?? []).filter((o) => o.value !== picked?.value),
  ];
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Combobox
            items={items}
            filter={null}
            value={items.find((o) => o.value === field.value) ?? null}
            itemToStringLabel={(o: ComboOption) => o.label}
            isItemEqualToValue={(a: ComboOption, b: ComboOption) => a.value === b.value}
            onInputValueChange={(v) => setInput(v)}
            onValueChange={(o: ComboOption | null) => {
              setPicked(o);
              field.onChange(o?.value);
              onPicked?.(o);
            }}
          >
            <ComboboxInput
              id={name}
              placeholder={placeholder}
              aria-invalid={fieldState.invalid}
              onBlur={field.onBlur}
            />
            <ComboboxContent>
              <ComboboxEmpty>{opts.isPending ? 'Searching…' : 'Nothing found.'}</ComboboxEmpty>
              <ComboboxList>
                {(o: ComboOption) => (
                  <ComboboxItem key={o.value} value={o}>
                    <span className="flex flex-col">
                      <span>{o.label}</span>
                      {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
