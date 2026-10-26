'use client';
import { Button } from '@kejasha/ui/components/button';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { useMe, useSignOut } from '@/lib/session';

/**
 * Kejasha staff console (platform operators, not an org role). Every request is logged by the API;
 * in production the operator API is also behind Cloudflare Access.
 */
export default function OperatorLayout({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const signOut = useSignOut();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!isPending && me === null) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [isPending, me, pathname, router]);
  // A cheap operator call decides access; non-operators get 403 not_an_operator.
  const access = useQuery({
    queryKey: ['operator', 'plans'],
    queryFn: async () => unwrap(await api.GET('/v1/operator/plans')).items,
    enabled: Boolean(me),
    retry: false,
  });
  const denied = access.error instanceof ApiError && access.error.status === 403;
  return (
    <div className="min-h-svh">
      <header className="border-b bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/operator" className="font-semibold">
            Kejasha operator
          </Link>
          {!denied && access.data && (
            <nav className="flex gap-3 text-sm opacity-90">
              <Link href="/operator" className="hover:underline">
                Organizations
              </Link>
              <Link href="/operator/plans" className="hover:underline">
                Plans
              </Link>
            </nav>
          )}
          {me && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-background hover:bg-background/10 hover:text-background"
              onClick={() => void signOut()}
            >
              <LogOut /> Sign out
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        {denied ? (
          <div className="rounded-lg border p-6">
            <h1 className="text-lg font-semibold">Kejasha staff only</h1>
            <p className="text-sm text-muted-foreground">
              This account is not a platform operator.
            </p>
          </div>
        ) : access.data ? (
          children
        ) : (
          <Skeleton className="h-64" />
        )}
      </main>
    </div>
  );
}
