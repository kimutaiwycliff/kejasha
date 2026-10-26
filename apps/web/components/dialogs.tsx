'use client';
import { Button } from '@kejasha/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kejasha/ui/components/dialog';
import { FieldGroup } from '@kejasha/ui/components/field';
import { ReasonBody } from '@kejasha/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type FormEventHandler, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { TextareaField } from '@/components/fields';
import { applyProblem, SubmitButton } from '@/components/form';
import { toastError } from '@/lib/hooks';

/** A dialog holding one form; the caller owns `open` so it can close on success. */
export function FormDialog<T extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  submitLabel = 'Save',
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  form: UseFormReturn<T>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  submitLabel?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}>
        <form onSubmit={onSubmit} noValidate className="flex max-h-[85svh] flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="-mx-1 overflow-y-auto px-1">
            <FieldGroup>{children}</FieldGroup>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <SubmitButton form={form}>{submitLabel}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A button that asks before doing something hard to undo (archive, void, cancel…). */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = label,
  destructive = true,
  onConfirm,
  variant = 'outline',
  size,
  'aria-label': ariaLabel,
}: {
  label: ReactNode;
  /** Required when `label` is only an icon. */
  'aria-label'?: string;
  title: string;
  description: ReactNode;
  confirmLabel?: ReactNode;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
  variant?: 'outline' | 'ghost' | 'destructive' | 'default';
  size?: 'sm' | 'default';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch (e) {
                  toastError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Ask for a reason, then run the action with it (ignore, unallocate, reject…). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const form = useForm<z.input<typeof ReasonBody>, unknown, z.output<typeof ReasonBody>>({
    resolver: zodResolver(ReasonBody),
  });
  useEffect(() => {
    if (open) form.reset({ reason: '' });
  }, [open, form]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      form={form}
      onSubmit={form.handleSubmit(async ({ reason }) => {
        try {
          await onSubmit(reason);
          onOpenChange(false);
        } catch (e) {
          applyProblem(form, e);
        }
      })}
      submitLabel={submitLabel}
    >
      <TextareaField form={form} name="reason" label="Reason" />
    </FormDialog>
  );
}
