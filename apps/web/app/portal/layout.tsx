'use client';
import { Button } from '@kejasha/ui/components/button';
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useMe, useSignOut } from '@/lib/session';

/** The tenant portal: no org, no sidebar — the tenant's own leases across landlords. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const signOut = useSignOut();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!isPending && me === null) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [isPending, me, pathname, router]);
  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/portal" className="font-semibold">
            Kejasha <span className="font-normal text-muted-foreground">· My home</span>
          </Link>
          {me && (
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4">{me ? children : <Skeleton className="h-64" />}</main>
    </div>
  );
}
