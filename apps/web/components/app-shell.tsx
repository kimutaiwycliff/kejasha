'use client';
import { LinkButton } from '@/components/link-button';
import { Alert, AlertDescription, AlertTitle } from '@kejasha/ui/components/alert';
import { Avatar, AvatarFallback } from '@kejasha/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@kejasha/ui/components/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@kejasha/ui/components/dialog';
import { Input } from '@kejasha/ui/components/input';
import { KejashaLogo } from '@kejasha/ui/components/logo';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, LogOut, Moon, Plus, Search, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
      if (me.memberships.length === 0) {
        // Tenants have no org: they belong in the portal. Everyone else sets one up.
        void api
          .GET('/v1/portal/me')
          .then((r) =>
            router.replace((r.data?.tenancies.length ?? 0) > 0 ? '/portal' : '/onboarding'),
          )
          .catch(() => router.replace('/onboarding'));
        return;
      }
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
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger aria-label="Toggle navigation" />
          <span className="truncate font-medium">{me.activeOrg.orgName}</span>
        </header>
        <BillingBanner role={activeRole(me)} />
        {/* Each page rises in gently (off under reduced motion). */}
        <main key={pathname} className="animate-rise flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const role = activeRole(me);
  const kind = me.activeOrg?.kind;
  const sections = NAV.map((sec) => ({
    ...sec,
    items: sec.items.filter(
      (i) =>
        (role === 'viewer' ? i.viewer : atLeast(role, i.minRole)) &&
        (!i.kinds || (kind !== undefined && i.kinds.includes(kind))),
    ),
  })).filter((sec) => sec.items.length > 0);
  return (
    <Sidebar>
      <SidebarHeader className="gap-3 pt-4">
        <Link href="/dashboard" aria-label="Kejasha home" className="px-2">
          <KejashaLogo inverse />
        </Link>
        <OrgSwitcher me={me} />
      </SidebarHeader>
      <SidebarContent>
        {sections.map((sec) => (
          <SidebarGroup key={sec.label ?? 'main'}>
            {sec.label && <SidebarGroupLabel>{sec.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {sec.items.map((i) => (
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
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu me={me} />
      </SidebarFooter>
    </Sidebar>
  );
}

/** Shown in the menu before "All organizations…" opens a searchable list. */
const MENU_ORGS = 6;

function OrgSwitcher({ me }: { me: Me }) {
  const switchOrg = useSwitchOrg();
  const router = useRouter();
  const [browsing, setBrowsing] = useState(false);
  const active = me.activeOrg?.orgId;
  // The active org first, then the rest; long lists move to the searchable dialog.
  const ordered = [
    ...me.memberships.filter((m) => m.orgId === active),
    ...me.memberships.filter((m) => m.orgId !== active),
  ];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              aria-label="Switch organization"
              className="bg-sidebar-accent/60 hover:bg-sidebar-accent"
            />
          }
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#E8875F] text-sm font-bold text-[#1c1917]">
            {initialsOf(me.activeOrg?.orgName ?? '?')}
          </span>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">{me.activeOrg?.orgName}</span>
            <span className="truncate text-xs capitalize text-sidebar-muted">
              {me.activeOrg?.kind} · {me.activeOrg?.role}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-60" align="start">
          {/* Base UI requires a label to sit inside its group. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {ordered.slice(0, MENU_ORGS).map((m) => (
              <DropdownMenuItem key={m.orgId} onClick={() => void switchOrg(m.orgId)}>
                <span className="flex-1 truncate">{m.orgName}</span>
                {m.orgId === active && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            {ordered.length > MENU_ORGS && (
              <DropdownMenuItem onClick={() => setBrowsing(true)}>
                <Search className="size-4" /> All organizations ({ordered.length})…
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push('/onboarding?new=1')}>
            <Plus className="size-4" /> New organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <OrgPicker
        open={browsing}
        onOpenChange={setBrowsing}
        orgs={ordered}
        active={active}
        onPick={(id) => {
          setBrowsing(false);
          void switchOrg(id);
        }}
      />
    </>
  );
}

function initialsOf(name: string) {
  const letters = name
    .split(/\s+/)
    .map((w) => w.match(/[A-Za-z0-9]/)?.[0] ?? '')
    .join('');
  return (letters.slice(0, 2) || '·').toUpperCase();
}

/** Every organization, searchable by name (agencies and staff can belong to many). */
function OrgPicker({
  open,
  onOpenChange,
  orgs,
  active,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgs: Me['memberships'];
  active: string | undefined;
  onPick: (orgId: string) => void;
}) {
  const [q, setQ] = useState('');
  const shown = orgs
    .filter((m) => m.orgName.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 50);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch organization</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          type="search"
          placeholder="Search by name"
          aria-label="Search organizations"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {shown.map((m) => (
            <li key={m.orgId}>
              <button
                type="button"
                onClick={() => onPick(m.orgId)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="flex-1 truncate">{m.orgName}</span>
                <span className="text-xs capitalize text-muted-foreground">{m.role}</span>
                {m.orgId === active && <Check className="size-4 text-primary" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">No match.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
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
          <span className="truncate text-xs text-sidebar-muted">
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
          <LinkButton size="sm" href="/billing">
            Go to billing
          </LinkButton>
        </AlertDescription>
      </Alert>
    </div>
  );
}
