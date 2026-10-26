import { type Button, buttonVariants } from '@kejasha/ui/components/button';
import { cn } from '@kejasha/ui/lib/utils';
import Link from 'next/link';
import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps<typeof Button>;

/** Navigation that looks like a button but stays a link (keeps link semantics for assistive tech). */
export function LinkButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonProps['variant']; size?: ButtonProps['size'] }) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
