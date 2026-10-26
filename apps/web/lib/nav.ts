import {
  Building2,
  CreditCard,
  DoorOpen,
  Gauge,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Me } from './session';
import type { Role } from './session';

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

/** Sections appear here as their slices land (docs/plans/phase-w.md). */
export const NAV: NavItem[] = [
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
  { href: '/meter-readings', label: 'Meter readings', icon: Gauge, minRole: 'caretaker' },
  { href: '/billing', label: 'Billing', icon: CreditCard, minRole: 'manager' },
];
