import {
  AlertTriangle,
  Banknote,
  BedDouble,
  Building2,
  CalendarDays,
  Contact,
  CreditCard,
  DoorOpen,
  FileText,
  Gauge,
  HandCoins,
  LayoutDashboard,
  Receipt,
  Smartphone,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Me, Role } from './session';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Lowest role that sees the item. */
  minRole: Role;
  /** Read-only owners (viewers) see it too. */
  viewer?: boolean;
  /** Only for these org kinds (default: all). */
  kinds?: NonNullable<Me['activeOrg']>['kind'][];
}

export interface NavSection {
  /** No label for the top section. */
  label?: string;
  items: NavItem[];
}

/** Sections appear here as their slices land (docs/plans/phase-w.md). */
export const NAV: NavSection[] = [
  {
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        minRole: 'caretaker',
        viewer: true,
      },
      { href: '/landlords', label: 'Landlords', icon: Users, minRole: 'agent', kinds: ['agency'] },
      { href: '/properties', label: 'Properties', icon: Building2, minRole: 'caretaker' },
      { href: '/units', label: 'Units', icon: DoorOpen, minRole: 'caretaker' },
    ],
  },
  {
    label: 'Long-term',
    items: [
      { href: '/tenants', label: 'Tenants', icon: Contact, minRole: 'agent' },
      { href: '/leases', label: 'Leases', icon: FileText, minRole: 'agent' },
      { href: '/invoices', label: 'Invoices', icon: Receipt, minRole: 'agent' },
      { href: '/arrears', label: 'Arrears', icon: AlertTriangle, minRole: 'agent' },
      { href: '/meter-readings', label: 'Meter readings', icon: Gauge, minRole: 'caretaker' },
    ],
  },
  {
    label: 'Short stays',
    items: [
      { href: '/calendar', label: 'Calendar', icon: CalendarDays, minRole: 'agent' },
      { href: '/bookings', label: 'Bookings', icon: BedDouble, minRole: 'agent' },
      { href: '/guests', label: 'Guests', icon: UserRound, minRole: 'agent' },
      { href: '/expenses', label: 'Expenses', icon: HandCoins, minRole: 'manager' },
      { href: '/short-stay-profit', label: 'Profit', icon: TrendingUp, minRole: 'manager' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/payments', label: 'Payments', icon: Wallet, minRole: 'agent' },
      { href: '/cash', label: 'Cash', icon: Banknote, minRole: 'caretaker' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/payment-channels', label: 'M-Pesa setup', icon: Smartphone, minRole: 'manager' },
      { href: '/billing', label: 'Billing', icon: CreditCard, minRole: 'manager' },
    ],
  },
];
