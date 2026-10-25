import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, ownerAc } from 'better-auth/plugins/organization/access';

/**
 * Org roles, most to least privileged (ADR-004). `viewer` is a read-only owner (e.g. diaspora):
 * it may only call routes marked `allowViewer`. `tenant` is a separate portal identity (B6).
 */
export const ROLES = ['owner', 'manager', 'agent', 'caretaker', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { owner: 4, manager: 3, agent: 2, caretaker: 1, viewer: 0 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** True when `role` is at least `min` (owner ≥ manager ≥ agent ≥ caretaker ≥ viewer). */
export function hasRole(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** Roles a member with `role` may grant to others (invite or change to). */
export function grantableRoles(role: Role): Role[] {
  if (role === 'owner') return [...ROLES];
  if (role === 'manager') return ['manager', 'agent', 'caretaker', 'viewer'];
  return [];
}

// Better Auth's own permission checks for its organization endpoints mirror the rules above;
// finer rules (no inviting owners as a manager, last-owner protection) live in the identity module.
export const ac = createAccessControl(defaultStatements);
export const accessRoles = {
  owner: ac.newRole(ownerAc.statements),
  manager: ac.newRole({
    organization: ['update'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
  }),
  agent: ac.newRole({ organization: [], member: [], invitation: [] }),
  caretaker: ac.newRole({ organization: [], member: [], invitation: [] }),
  viewer: ac.newRole({ organization: [], member: [], invitation: [] }),
};
