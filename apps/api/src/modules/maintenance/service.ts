import type {
  AddTicketUpdateBody,
  CreateTicketBody,
  Ticket,
  TicketDetail,
  TicketQuery,
  UpdateTicketBody,
} from '@kejasha/contracts';
import { money, uuidv7 } from '@kejasha/core';
import { and, asc, desc, eq, inArray, schema, sql, type Tx } from '@kejasha/db';
import type { Role } from '@kejasha/auth';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import { nextNumber } from '../../lib/numbering';
import { decodeCursor, page } from '../../lib/pagination';
import { assertUploadKeys, fileLinks } from '../../lib/uploads';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import * as shortstay from '../shortstay';

const { maintenanceTicket: mt, maintenanceUpdate: mu } = schema;
type TicketRow = typeof mt.$inferSelect;
type Status = TicketRow['status'];
type TicketDto = z.infer<typeof Ticket>;

/** Allowed status moves. Caretakers may not close or cancel. */
const NEXT: Record<Status, Status[]> = {
  open: ['in_progress', 'resolved', 'cancelled'],
  in_progress: ['open', 'resolved', 'cancelled'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  cancelled: [],
};
const PHOTO = 'maintenance_photo';

/** Open/in-progress/resolved tickets per property (dashboards). */
export async function activeTicketCount(tx: Tx, propertyIds: string[]): Promise<number> {
  if (!propertyIds.length) return 0;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(mt)
    .where(
      and(
        inArray(mt.propertyId, propertyIds),
        sql`${mt.status} IN ('open', 'in_progress', 'resolved')`,
      ),
    );
  return row?.n ?? 0;
}

export interface MaintenanceDeps {
  memberRoles(orgId: string, userIds: string[]): Promise<Map<string, Role>>;
}

/**
 * Maintenance tickets (B5). A resolved ticket with a cost keeps exactly one `repair` expense in
 * the org's expense register (short-stay module), so repairs reach the P&L and owner statements.
 */
export function createMaintenanceService(deps: AppDeps, members: MaintenanceDeps) {
  const { db, clock, storage } = deps;

  async function caretakerProperties(tx: Tx, ctx: Ctx) {
    return ctx.role === 'caretaker' ? accounts.assignedPropertyIds(tx, ctx.userId!) : null;
  }

  async function load(tx: Tx, ctx: Ctx, id: string, lock = false) {
    const q = tx.select().from(mt).where(eq(mt.id, id));
    const [row] = lock ? await q.for('update') : await q;
    const allowed = await caretakerProperties(tx, ctx);
    if (!row || (allowed && !allowed.has(row.propertyId))) throw AppError.notFound('Ticket');
    return row;
  }

  async function toDtos(tx: Tx, rows: TicketRow[]): Promise<TicketDto[]> {
    if (!rows.length) return [];
    const props = await accounts.propertiesById(
      tx,
      rows.map((r) => r.propertyId),
    );
    const units = await accounts.unitsById(
      tx,
      rows.map((r) => r.unitId).filter((x): x is string => Boolean(x)),
    );
    const expenses = await shortstay.expenseIdsByTicket(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      propertyId: r.propertyId,
      propertyName: props.get(r.propertyId)?.name ?? '',
      unitId: r.unitId,
      unitCode: r.unitId ? (units.get(r.unitId)?.code ?? null) : null,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      reporterKind: r.reporterKind,
      reportedBy: r.reportedBy,
      tenantId: r.tenantId,
      assigneeUserId: r.assigneeUserId,
      assigneeName: r.assigneeName,
      costCents: r.costCents === null ? null : money.toApiInt(r.costCents),
      expenseId: expenses.get(r.id) ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** Resolved/closed tickets with a cost keep one expense; anything else has none. */
  async function syncExpense(tx: Tx, ctx: Ctx, t: TicketRow) {
    const counts = (t.status === 'resolved' || t.status === 'closed') && (t.costCents ?? 0n) > 0n;
    await shortstay.setTicketExpense(
      tx,
      ctx,
      t.id,
      counts
        ? {
            unitId: t.unitId,
            propertyId: t.propertyId,
            incurredOn: clock.today(),
            category: 'repair',
            amountCents: t.costCents!,
            description: `${t.number} ${t.title}`.slice(0, 500),
          }
        : null,
    );
  }

  async function detail(tx: Tx, row: TicketRow): Promise<z.infer<typeof TicketDetail>> {
    const [dto] = await toDtos(tx, [row]);
    const updates = await tx
      .select()
      .from(mu)
      .where(eq(mu.ticketId, row.id))
      .orderBy(asc(mu.createdAt), asc(mu.id));
    return {
      ...dto!,
      updates: await Promise.all(
        updates.map(async (u) => ({
          id: u.id,
          authorId: u.authorId,
          note: u.note,
          statusFrom: u.statusFrom as Status | null,
          statusTo: u.statusTo as Status | null,
          photos: await fileLinks(storage, u.photoKeys),
          createdAt: u.createdAt.toISOString(),
        })),
      ),
    };
  }

  async function assertMember(ctx: Ctx, userId: string) {
    const roles = await members.memberRoles(ctx.orgId, [userId]);
    if (!roles.has(userId))
      throw AppError.unprocessable(
        'not_a_member',
        'The assignee is not a member of this organization.',
      );
  }

  return {
    async list(ctx: Ctx, q: z.infer<typeof TicketQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const allowed = await caretakerProperties(tx, ctx);
        if (allowed && !allowed.size) return { items: [], nextCursor: null };
        const rows = await tx
          .select()
          .from(mt)
          .where(
            and(
              allowed ? inArray(mt.propertyId, [...allowed]) : undefined,
              q.status ? eq(mt.status, q.status) : undefined,
              q.active === 'true'
                ? sql`${mt.status} IN ('open', 'in_progress', 'resolved')`
                : q.active === 'false'
                  ? sql`${mt.status} IN ('closed', 'cancelled')`
                  : undefined,
              q.propertyId ? eq(mt.propertyId, q.propertyId) : undefined,
              q.unitId ? eq(mt.unitId, q.unitId) : undefined,
              q.priority ? eq(mt.priority, q.priority) : undefined,
              after
                ? sql`(${mt.createdAt}, ${mt.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(mt.createdAt), desc(mt.id))
          .limit(q.limit + 1);
        return page(await toDtos(tx, rows), q.limit, (t) => [t.createdAt, t.id]);
      });
    },

    /** Tickets a tenant reported or that concern them (tenant portal). */
    async forTenant(ctx: Ctx, tenantId: string) {
      return inTenant(db, ctx, async (tx) =>
        toDtos(
          tx,
          await tx
            .select()
            .from(mt)
            .where(eq(mt.tenantId, tenantId))
            .orderBy(desc(mt.createdAt), desc(mt.id))
            .limit(100),
        ),
      );
    },

    async get(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => detail(tx, await load(tx, ctx, id)));
    },

    /** `ticketId` lets offline clients (sync push) choose the record id. */
    async create(ctx: Ctx, body: z.infer<typeof CreateTicketBody>, ticketId?: string) {
      if (!body.unitId && !body.propertyId)
        throw AppError.unprocessable('target_required', 'Send a unitId or a propertyId.');
      if (body.photoKeys?.length) assertUploadKeys(ctx, PHOTO, body.photoKeys);
      return inTenant(db, ctx, async (tx) => {
        let propertyId = body.propertyId;
        if (body.unitId) {
          const unit = (await accounts.unitsById(tx, [body.unitId])).get(body.unitId);
          if (!unit) throw AppError.notFound('Unit');
          if (propertyId && propertyId !== unit.propertyId)
            throw AppError.unprocessable(
              'unit_property_mismatch',
              'The unit is in another property.',
            );
          propertyId = unit.propertyId;
        } else if (!(await accounts.propertiesById(tx, [propertyId!])).has(propertyId!)) {
          throw AppError.notFound('Property');
        }
        const allowed = await caretakerProperties(tx, ctx);
        if (allowed && !allowed.has(propertyId!)) throw AppError.notFound('Property');
        if (body.tenantId && !(await leasing.tenantsById(tx, [body.tenantId])).has(body.tenantId))
          throw AppError.notFound('Tenant');

        const id = ticketId ?? uuidv7();
        const [row] = await tx
          .insert(mt)
          .values({
            id,
            orgId: ctx.orgId,
            number: await nextNumber(tx, ctx, 'ticket', 'MT'),
            propertyId: propertyId!,
            unitId: body.unitId ?? null,
            title: body.title,
            description: body.description || null,
            category: body.category,
            priority: body.priority ?? 'normal',
            reporterKind: body.reporterKind ?? (ctx.role === 'caretaker' ? 'caretaker' : 'staff'),
            reportedBy: ctx.userId ?? null,
            tenantId: body.tenantId ?? null,
          })
          .returning();
        if (body.photoKeys?.length || body.description) {
          await tx.insert(mu).values({
            id: uuidv7(),
            orgId: ctx.orgId,
            ticketId: id,
            authorId: ctx.userId ?? null,
            note: null,
            statusTo: 'open',
            photoKeys: body.photoKeys ?? [],
          });
        }
        await record(tx, ctx, {
          action: 'ticket.created',
          entityType: 'maintenance_ticket',
          entityId: id,
          diff: { title: body.title, priority: row!.priority },
        });
        return detail(tx, row!);
      });
    },

    async update(ctx: Ctx, id: string, body: z.infer<typeof UpdateTicketBody>) {
      if (body.assigneeUserId) await assertMember(ctx, body.assigneeUserId);
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, ctx, id, true);
        if (row.status === 'closed' || row.status === 'cancelled')
          throw AppError.conflict('ticket_finished', `A ${row.status} ticket cannot be edited.`);
        const set: Partial<typeof mt.$inferInsert> = {};
        if (body.title !== undefined) set.title = body.title;
        if (body.description !== undefined) set.description = body.description || null;
        if (body.category !== undefined) set.category = body.category;
        if (body.priority !== undefined) set.priority = body.priority;
        if (body.assigneeUserId !== undefined) set.assigneeUserId = body.assigneeUserId;
        if (body.assigneeName !== undefined) set.assigneeName = body.assigneeName || null;
        if (body.costCents !== undefined)
          set.costCents = body.costCents === null ? null : BigInt(body.costCents);
        const [updated] = Object.keys(set).length
          ? await tx.update(mt).set(set).where(eq(mt.id, id)).returning()
          : [row];
        if (body.costCents !== undefined) await syncExpense(tx, ctx, updated!);
        await record(tx, ctx, {
          action: 'ticket.updated',
          entityType: 'maintenance_ticket',
          entityId: id,
          diff: body,
        });
        return detail(tx, updated!);
      });
    },

    /** Notes, photos, cost and status changes — the ticket's timeline. */
    async addUpdate(
      ctx: Ctx,
      id: string,
      body: z.infer<typeof AddTicketUpdateBody>,
      updateId?: string,
    ) {
      if (!body.note && !body.status && body.costCents === undefined && !body.photoKeys?.length)
        throw AppError.unprocessable('empty_update', 'Send a note, status, cost or photos.');
      if (body.photoKeys?.length) assertUploadKeys(ctx, PHOTO, body.photoKeys);
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, ctx, id, true);
        const to = body.status && body.status !== row.status ? body.status : undefined;
        if (to) {
          if (!NEXT[row.status].includes(to))
            throw AppError.conflict(
              'invalid_ticket_transition',
              `A ${row.status.replace('_', ' ')} ticket cannot become ${to.replace('_', ' ')}.`,
            );
          if (ctx.role === 'caretaker' && (to === 'closed' || to === 'cancelled'))
            throw new AppError(
              403,
              'forbidden',
              'Forbidden',
              'Caretakers cannot close or cancel tickets.',
            );
        } else if (row.status === 'closed' || row.status === 'cancelled') {
          throw AppError.conflict('ticket_finished', `A ${row.status} ticket cannot be changed.`);
        }
        const now = clock.now();
        const set: Partial<typeof mt.$inferInsert> = {};
        if (to) set.status = to;
        if (to === 'resolved') set.resolvedAt = now;
        if (to === 'closed') set.closedAt = now;
        if (to === 'in_progress' || to === 'open') set.resolvedAt = null;
        if (body.costCents !== undefined) set.costCents = BigInt(body.costCents);
        const [updated] = Object.keys(set).length
          ? await tx.update(mt).set(set).where(eq(mt.id, id)).returning()
          : [row];
        await tx.insert(mu).values({
          id: updateId ?? uuidv7(),
          orgId: ctx.orgId,
          ticketId: id,
          authorId: ctx.userId ?? null,
          note: body.note || null,
          statusFrom: to ? row.status : null,
          statusTo: to ?? null,
          photoKeys: body.photoKeys ?? [],
        });
        if (to || body.costCents !== undefined) await syncExpense(tx, ctx, updated!);
        await record(tx, ctx, {
          action: to ? `ticket.${to}` : 'ticket.noted',
          entityType: 'maintenance_ticket',
          entityId: id,
          diff: { status: to, costCents: body.costCents },
        });
        return detail(tx, updated!);
      });
    },
  };
}

export type MaintenanceService = ReturnType<typeof createMaintenanceService>;
