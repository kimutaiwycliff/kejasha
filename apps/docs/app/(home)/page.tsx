import Link from 'next/link';

const sections = [
  { href: '/docs/getting-started', title: 'Getting started', text: 'Sign in, choose an organization, set up a portfolio.' },
  { href: '/docs/concepts/conventions', title: 'Conventions', text: 'Money in cents, Nairobi dates, idempotency, errors.' },
  { href: '/docs/guides/payments', title: 'M-Pesa payments', text: 'Paybill/Till reconciliation, STK Push, statements, SMS.' },
  { href: '/docs/guides/offline-sync', title: 'Offline sync', text: 'Pull and push for the Android app.' },
  { href: '/docs/operations/deployment', title: 'Operations', text: 'Deploy, back up, restore, change domain.' },
  { href: '/docs/api', title: 'API reference', text: 'Every endpoint, generated from the contract.' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-16">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight">Kejasha documentation</h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          Long-term rentals, M-Pesa rent collection and short-stay units for Kenya — through one
          contract-first API used by the web dashboard, the Android app and your integrations.
        </p>
        <div className="flex gap-3">
          <Link href="/docs/getting-started" className="rounded-lg bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground">
            Get started
          </Link>
          <Link href="/docs/api" className="rounded-lg border px-4 py-2 font-medium">
            API reference
          </Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-xl border p-5 transition-colors hover:bg-fd-accent">
            <h2 className="mb-1 font-semibold">{s.title}</h2>
            <p className="text-sm text-fd-muted-foreground">{s.text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
