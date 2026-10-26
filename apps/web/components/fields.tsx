'use client';
import { Field, FieldDescription, FieldError, FieldLabel } from '@kejasha/ui/components/field';
import { Input } from '@kejasha/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kejasha/ui/components/select';
import { Textarea } from '@kejasha/ui/components/textarea';
import { useEffect, useState } from 'react';
import { Controller, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { fieldError } from '@/components/form';
import { parseKes } from '@/lib/format';

interface Base<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  description?: string;
  /** What a blank input sends: `undefined` (omit, the default) or `null` (clear). */
  empty?: null | undefined;
}

export interface Option {
  value: string;
  label: string;
}

/** A select whose trigger shows the option label (Base UI shows the raw value without `items`). */
export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  options,
  placeholder = 'Choose…',
  disabled,
}: Base<T> & { options: Option[]; placeholder?: string; disabled?: boolean }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel>{label}</FieldLabel>
          <Select
            items={options}
            value={field.value ?? null}
            onValueChange={(v) => field.onChange(v ?? undefined)}
            disabled={disabled}
          >
            <SelectTrigger aria-label={label} onBlur={field.onBlur}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

const centsToText = (c: unknown) =>
  typeof c === 'number' && Number.isFinite(c) ? (c / 100).toFixed(c % 100 === 0 ? 0 : 2) : '';

/** Amount typed in shillings, held in the form as integer cents (ADR-006). */
export function MoneyField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  empty,
}: Base<T>) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <MoneyInput
          id={name}
          label={label}
          description={description}
          value={field.value}
          onBlur={field.onBlur}
          onChange={(text) => {
            const cents = parseKes(text);
            field.onChange(text.trim() === '' ? empty : (cents ?? Number.NaN));
          }}
          error={fieldState.error}
        />
      )}
    />
  );
}

function MoneyInput({
  id,
  label,
  description,
  value,
  onChange,
  onBlur,
  error,
}: {
  id: string;
  label: string;
  description?: string | undefined;
  value: unknown;
  onChange: (text: string) => void;
  onBlur: () => void;
  error: { message?: string } | undefined;
}) {
  const [text, setText] = useState(() => centsToText(value));
  // Follow values set from outside (a reset, or a default copied from the chosen unit).
  useEffect(() => {
    const typed = parseKes(text);
    if (typeof value === 'number' && Number.isFinite(value) && typed !== value)
      setText(centsToText(value));
    if ((value === undefined || value === null) && typed !== null) setText('');
    // Deliberately keyed on the form value only, not on the typed text.
  }, [value]);
  const invalid = text.trim() !== '' && parseKes(text) === null;
  return (
    <Field data-invalid={Boolean(error) || invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          Ksh
        </span>
        <Input
          id={id}
          inputMode="decimal"
          className="pl-12 tabular-nums"
          value={text}
          aria-invalid={Boolean(error) || invalid}
          onBlur={onBlur}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
        />
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError
        errors={[invalid ? { message: 'Enter an amount in shillings, e.g. 12,500' } : error]}
      />
    </Field>
  );
}

/** Whole numbers (bedrooms, counts); blank → `empty`. */
export function NumberField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  empty,
  min,
  max,
}: Base<T> & { min?: number; max?: number }) {
  const error = fieldError(form, name);
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        aria-invalid={Boolean(error)}
        {...form.register(name, {
          setValueAs: (v: string) => (v === '' ? empty : Number(v)),
        })}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  );
}

/** A business date (YYYY-MM-DD, Africa/Nairobi); blank → `empty`. */
export function DateField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  empty,
}: Base<T>) {
  const error = fieldError(form, name);
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        type="date"
        aria-invalid={Boolean(error)}
        {...form.register(name, { setValueAs: (v: string) => (v === '' ? empty : v) })}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  );
}

export function TextareaField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  empty,
}: Base<T>) {
  const error = fieldError(form, name);
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Textarea
        id={name}
        rows={3}
        aria-invalid={Boolean(error)}
        {...form.register(name, { setValueAs: (v: string) => (v === '' ? empty : v) })}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  );
}

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const bpsToText = (b: unknown) =>
  typeof b === 'number' && Number.isFinite(b) ? String(b / 100) : '';

/** A percentage typed as "7.5", held in the form as basis points (750). */
export function PercentField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  empty,
}: Base<T>) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <PercentInput
          id={name}
          label={label}
          description={description}
          value={field.value}
          onBlur={field.onBlur}
          onChange={(t) =>
            field.onChange(
              t === '' ? empty : PERCENT.test(t) ? Math.round(Number(t) * 100) : Number.NaN,
            )
          }
          error={fieldState.error}
        />
      )}
    />
  );
}

function PercentInput({
  id,
  label,
  description,
  value,
  onChange,
  onBlur,
  error,
}: {
  id: string;
  label: string;
  description?: string | undefined;
  value: unknown;
  onChange: (text: string) => void;
  onBlur: () => void;
  error: { message?: string } | undefined;
}) {
  const [text, setText] = useState(() => bpsToText(value));
  useEffect(() => {
    if (value === undefined || value === null) {
      if (text !== '') setText('');
    } else if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.round(Number(text) * 100) !== value
    )
      setText(bpsToText(value));
    // Deliberately keyed on the form value only, not on the typed text.
  }, [value]);
  const invalid = text.trim() !== '' && !PERCENT.test(text.trim());
  return (
    <Field data-invalid={Boolean(error) || invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          className="pr-8 tabular-nums"
          value={text}
          aria-invalid={Boolean(error) || invalid}
          onBlur={onBlur}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim());
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          %
        </span>
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[invalid ? { message: 'Enter a percent, e.g. 7.5' } : error]} />
    </Field>
  );
}
