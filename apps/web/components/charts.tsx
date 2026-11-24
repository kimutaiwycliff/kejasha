'use client';
import type { CSSProperties } from 'react';
import { useCountUp } from '@/lib/use-count-up';

type Bar = { label: string; a: number; b: number };

/**
 * Paired monthly bars (e.g. collected vs expenses) in SVG — no chart library. Screen readers get
 * a table with the same numbers.
 */
export function PairedBars({
  data,
  aLabel,
  bLabel,
  format,
  caption,
}: {
  data: Bar[];
  aLabel: string;
  bLabel: string;
  format: (n: number) => string;
  caption: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const W = 600;
  const H = 200;
  const slot = W / Math.max(1, data.length);
  const bar = Math.min(28, slot / 3.2);
  return (
    <figure className="space-y-3">
      <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-1" /> {aLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-2" /> {bLabel}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="h-auto w-full" aria-hidden>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H - H * f}
            y2={H - H * f}
            className="stroke-border"
            strokeDasharray="4 6"
          />
        ))}
        {data.map((d, i) => {
          const x = i * slot + slot / 2;
          const ha = (d.a / max) * H;
          const hb = (d.b / max) * H;
          return (
            <g key={d.label}>
              <rect
                x={x - bar - 2}
                y={H - ha}
                width={bar}
                height={Math.max(ha, 1)}
                rx={5}
                className="animate-grow fill-chart-1"
                style={{ '--i': i } as CSSProperties}
              >
                <title>{`${d.label}: ${aLabel} ${format(d.a)}`}</title>
              </rect>
              <rect
                x={x + 2}
                y={H - hb}
                width={bar}
                height={Math.max(hb, 1)}
                rx={5}
                className="animate-grow fill-chart-2"
                style={{ '--i': i } as CSSProperties}
              >
                <title>{`${d.label}: ${bLabel} ${format(d.b)}`}</title>
              </rect>
              <text
                x={x}
                y={H + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[13px]"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">{aLabel}</th>
            <th scope="col">{bLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.a)}</td>
              <td>{format(d.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A percentage ring (basis points), drawn with a stroke that sweeps in. */
export function Ring({
  bps,
  label,
  className,
}: {
  bps: number;
  label: string;
  className?: string;
}) {
  // Sweeps in from zero (and jumps straight there under reduced motion).
  const shown = useCountUp(Math.max(0, Math.min(10_000, bps)));
  const pct = shown / 100;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative size-28">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            className={className ?? 'stroke-primary'}
          />
        </svg>
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums"
        >
          {pct.toFixed(0)}%
        </span>
      </div>
      <span className="text-sm text-muted-foreground">
        {label}
        <span className="sr-only">: {(bps / 100).toFixed(0)}%</span>
      </span>
    </div>
  );
}
