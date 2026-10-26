'use client';
import { Input } from '@kejasha/ui/components/input';
import { Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Label/value pairs for a detail card; empty values show a dash. */
export function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium break-words">
            {v === null || v === undefined || v === '' ? '—' : v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** A small "← Properties" link above a detail page's header. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground"
    >
      ← {label}
    </Link>
  );
}
