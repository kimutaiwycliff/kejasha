'use client';
import { Button } from '@kejasha/ui/components/button';
import { Field, FieldError, FieldLabel } from '@kejasha/ui/components/field';
import { Input } from '@kejasha/ui/components/input';
import { useSyncExternalStore, type ComponentProps } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';

/**
 * Map a problem+json error onto the form: field errors where the API names a field
 * (`errors[].path` like `body.email`), otherwise a toast with the API's human message.
 */
export function applyProblem<T extends FieldValues>(form: UseFormReturn<T>, err: unknown) {
  if (err instanceof ApiError) {
    const fields = err.problem.errors ?? [];
    let placed = false;
    for (const e of fields) {
      const name = e.path.replace(/^body\./, '') as Path<T>;
      if (name in form.getValues()) {
        form.setError(name, { message: e.message });
        placed = true;
      }
    }
    if (!placed) toast.error(err.problem.detail ?? err.problem.title);
    return;
  }
  toast.error('Something went wrong. Check your connection and try again.');
}

type TextFieldProps<T extends FieldValues> = {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
} & Omit<ComponentProps<typeof Input>, 'name' | 'form'>;

/** Label + input + error, wired to React Hook Form. */
export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  ...input
}: TextFieldProps<T>) {
  const error = form.formState.errors[name];
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} aria-invalid={Boolean(error)} {...input} {...form.register(name)} />
      <FieldError errors={[error as { message?: string } | undefined]} />
    </Field>
  );
}

const noop = () => () => {};
/** False during server render and hydration, true once React owns the page. */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * Disabled until hydrated: a click before React attaches would submit the form natively
 * (GET), putting its fields — passwords included — in the URL.
 */
export function SubmitButton<T extends FieldValues>({
  form,
  disabled,
  ...props
}: { form: UseFormReturn<T> } & Omit<ComponentProps<typeof Button>, 'type' | 'form'>) {
  const hydrated = useHydrated();
  return (
    <Button
      type="submit"
      disabled={!hydrated || disabled || form.formState.isSubmitting}
      {...props}
    />
  );
}
