'use client';
import { Alert, AlertDescription, AlertTitle } from '@kejasha/ui/components/alert';
import { Avatar, AvatarFallback } from '@kejasha/ui/components/avatar';
import { Button } from '@kejasha/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kejasha/ui/components/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@kejasha/ui/components/sidebar';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, LogOut, Moon, Plus, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { NAV } from '@/lib/nav';
import { activeRole, atLeast, useMe, useSignOut, useSwitchOrg, type Me } from '@/lib/session';

/** The org last used in this browser (a convenience only; storage may be unavailable). */
const lastOrg = {
  get: () => {
    try {
      return localStorage.getItem('kj.lastOrg');
    } catch {
      return null;
    }
  },
  set: (orgId: string) => {
    try {
      localStorage.setItem('kj.lastOrg', orgId);
    } catch {
      /* private mode */
    }
  },
};

/** Signed-in, org-scoped area: redirects to sign-in or onboarding when needed. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const switchOrg = useSwitchOrg();
  const picking = useRef(false);
  useEffect(() => {
    if (isPending) return;
    if (me === null) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    else if (me && !me.activeOrg) {
      // A new session has no active org: resume the last one used here, else the first.
      if (me.memberships.length === 0) return router.replace('/onboarding');
      if (picking.current) return;
      picking.current = true;
      const last = lastOrg.get();
      const pick = me.memberships.find((m) => m.orgId === last) ?? me.memberships[0]!;
      void switchOrg(pick.orgId).finally(() => (picking.current = false));
    } else if (me?.activeOrg) lastOrg.set(me.activeOrg.orgId);
  }, [me, isPending, pathname, router, switchOrg]);
  if (!me?.activeOrg)
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  return (
    <SidebarProvider>
      <AppSidebar me={me} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="Toggle navigation" />
          <span className="truncate font-medium">{me.activeOrg.orgName}</span>
        </header>
        <BillingBanner role={activeRole(me)} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const role = activeRole(me);
  const items = NAV.filter((i) => (role === 'viewer' ? i.viewer : atLeast(role, i.minRole)));
  return (
    <Sidebar>
      <SidebarHeader>
        <OrgSwitcher me={me} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((i) => (
                <SidebarMenuItem key={i.href}>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(i.href)}
                    render={<Link href={i.href} />}
                  >
                    <i.icon />
                    <span>{i.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu me={me} />
      </SidebarFooter>
    </Sidebar>
  );
}

function OrgSwitcher({ me }: { me: Me }) {
  const switchOrg = useSwitchOrg();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" aria-label="Switch organization" />}
      >
        <div className="grid flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{me.activeOrg?.orgName}</span>
          <span className="truncate text-xs capitalize text-muted-foreground">
            {me.activeOrg?.kind} · {me.activeOrg?.role}
          </span>
        </div>
        <ChevronsUpDown className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {me.memberships.map((m) => (
          <DropdownMenuItem key={m.orgId} onClick={() => void switchOrg(m.orgId)}>
            <span className="flex-1 truncate">{m.orgName}</span>
            {m.orgId === me.activeOrg?.orgId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/onboarding?new=1')}>
          <Plus className="size-4" /> New organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ me }: { me: Me }) {
  const signOut = useSignOut();
  const { resolvedTheme, setTheme } = useTheme();
  const initials = me.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" aria-label="Account menu" />}>
        <Avatar className="size-8">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-left leading-tight">
          <span className="truncate text-sm font-medium">{me.user.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {me.user.email ?? me.user.phone}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="start" side="top">
        <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}{' '}
          Toggle theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Unpaid, overdue or suspended subscription: say so on every page (managers can act on it). */
function BillingBanner({ role }: { role: ReturnType<typeof activeRole> }) {
  const canPay = atLeast(role, 'manager');
  const { data } = useQuery({
    queryKey: ['billing'],
    queryFn: async () => unwrap(await api.GET('/v1/billing')),
    enabled: canPay,
    staleTime: 5 * 60_000,
  });
  if (!data || data.status === 'active' || data.status === 'trialing') return null;
  const text =
    data.status === 'incomplete'
      ? {
          title: 'Finish setting up',
          body: 'Pay for your first month to start collecting rent and taking bookings.',
        }
      : data.status === 'past_due'
        ? {
            title: 'Payment overdue',
            body: `Your subscription renewal is unpaid since ${formatDate(data.pastDueSince)}. Everything keeps working for 7 days.`,
          }
        : {
            title: 'Account is read-only',
            body: 'Your subscription is unpaid. Pay now to restore everything immediately.',
          };
  return (
    <div className="px-4 pt-4 md:px-6">
      <Alert variant={data.status === 'past_due' ? 'default' : 'destructive'}>
        <AlertTitle>{text.title}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{text.body}</span>
          <Button size="sm" nativeButton={false} render={<Link href="/billing" />}>
            Go to billing
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
