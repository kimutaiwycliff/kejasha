import { KejashaLogo } from '@kejasha/ui/components/logo';
import { Banknote, CalendarRange, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';

const POINTS = [
  { icon: Banknote, text: 'M-Pesa rent that matches itself to the right tenant' },
  { icon: CalendarRange, text: 'Long-term homes and short stays in one portfolio' },
  { icon: WifiOff, text: 'Caretakers keep working without signal' },
];

/** Sign-in, sign-up and recovery: the form beside a brand panel (the panel hides on phones). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <section
        aria-label="About Kejasha"
        className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between"
      >
        {/* Rooflines: the mark's chevron, repeated faintly. */}
        <svg aria-hidden className="absolute inset-0 size-full opacity-[0.07]">
          <defs>
            <pattern id="roofs" width="72" height="44" patternUnits="userSpaceOnUse">
              <path
                d="M6 34 L36 10 L66 34"
                fill="none"
                stroke="#fff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#roofs)" />
        </svg>
        <div className="absolute -right-24 -bottom-24 size-96 rounded-full bg-[#E8875F] opacity-10 blur-3xl" />
        <KejashaLogo inverse className="relative" />
        <div className="relative max-w-md space-y-8">
          <h2 className="text-4xl leading-tight font-extrabold text-white">
            Every keja you run, in one calm place.
          </h2>
          <ul className="space-y-4">
            {POINTS.map(({ icon: Icon, text }, i) => (
              <li
                key={text}
                className="animate-rise flex items-center gap-3"
                style={{ '--i': i + 1 } as React.CSSProperties}
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4 text-[#E8875F]" aria-hidden />
                </span>
                <span className="text-sidebar-foreground">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-sidebar-muted">
          For landlords, agencies and hosts in Kenya.
        </p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="animate-rise w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-1 text-center lg:hidden">
            <KejashaLogo />
            <p className="text-sm text-muted-foreground">
              Rentals, rent collection and short stays
            </p>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
