'use client';
import { Card } from '@kejasha/ui/components/card';
import { cn } from '@kejasha/ui/lib/utils';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { useCountUp } from '@/lib/use-count-up';

/** Icon chip colours per meaning (docs/plans/phase-d.md). */
const TONE = {
  primary: 'bg-secondary text-primary',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  info: 'bg-info-soft text-info-ink',
  murram: 'bg-murram-soft text-murram',
  danger: 'bg-danger-soft text-destructive',
} as const;
export type StatTone = keyof typeof TONE;

/**
 * A headline figure: icon chip, label, a value that counts up, and an optional hint.
 * With `href` the whole card opens the page that deals with it.
 */
export function StatCard({
  label,
  value,
  format,
  icon: Icon,
  tone = 'primary',
  hint,
  href,
  index = 0,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: ReactNode;
  href?: string;
  index?: number;
}) {
  const shown = useCountUp(value);
  const body = (
    <Card
      className={cn(
        'animate-rise gap-3 px-5 transition-shadow',
        href && 'hover:shadow-lg hover:ring-primary/20',
      )}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('flex size-9 items-center justify-center rounded-lg', TONE[tone])}>
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
      {/* Screen readers get the final figure, not every frame of the count. */}
      <p className="text-2xl font-bold tracking-tight tabular-nums">
        <span className="sr-only">{format(value)}</span>
        <span aria-hidden>{format(shown)}</span>
      </p>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
