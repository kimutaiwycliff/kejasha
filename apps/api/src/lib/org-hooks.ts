import type { Tx } from '@kejasha/db';

/**
 * Runs inside the tenant transaction that creates an org, so modules can bootstrap their own rows
 * (e.g. accounts creates the `self` client landlord) without identity importing them (ADR-001).
 * Wired in modules/index.ts — the composition root.
 */
export interface OrgCreatedContext {
  orgId: string;
  name: string;
  kind: 'landlord' | 'agency' | 'host';
  userId: string;
}

export type OrgCreatedHook = (tx: Tx, ctx: OrgCreatedContext) => Promise<void>;
