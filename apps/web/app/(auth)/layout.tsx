import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-2xl font-semibold tracking-tight">Kejasha</p>
          <p className="text-sm text-muted-foreground">Rentals, rent collection and short stays</p>
        </div>
        {children}
      </div>
    </main>
  );
}
