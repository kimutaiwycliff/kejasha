import { CreditCard, LayoutDashboard, type LucideIcon } from 'lucide-react';
import type { Role } from './session';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Lowest role that sees the item. */
  minRole: Role;
  /** Read-only owners (viewers) see it too. */
  viewer?: boolean;
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
  { href: '/billing', label: 'Billing', icon: CreditCard, minRole: 'manager' },
];
