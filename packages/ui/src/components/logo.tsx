import { cn } from 'cn';

/**
 * The Kejasha mark: a home — roof over a terracotta doorway — on an acacia tile.
 * "Keja" is Sheng for home. Decorative by default; pass a title when it stands alone.
 */
export function KejashaMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <rect width="64" height="64" rx="16" fill="#0F6B52" />
      <path
        d="M13 32 L32 15 L51 32"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 30 V49 H45 V30"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      />
      <path d="M26 49 V41 a6 6 0 0 1 12 0 V49 Z" fill="#E8875F" />
    </svg>
  );
}

/** Mark + wordmark: "keja" (home) and "sha" in the brand accent. */
export function KejashaLogo({ className, inverse }: { className?: string; inverse?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <KejashaMark />
      <span
        aria-hidden
        className={cn(
          'text-xl font-extrabold tracking-tight',
          inverse ? 'text-white' : 'text-foreground',
        )}
      >
        keja<span className={inverse ? 'text-[#E8875F]' : 'text-murram'}>sha</span>
      </span>
      <span className="sr-only">Kejasha</span>
    </span>
  );
}
