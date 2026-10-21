import type { StkRequest, StkRequestBody } from '@kejasha/contracts';
import { money, phone as phoneLib, uuidv7 } from '@kejasha/core';
import { and, eq, lt, schema, sql, withTenant, type Tx } from '@kejasha/db';
import { parseC2B, parseStkCallback } from '@kejasha/integrations-daraja';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, systemCtx, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import type { ChannelService } from './channels';
import { allocate, recordPayment } from './service';

const { paymentChannel: ch, paymentCallback: cb, stkRequest: stk } = schema;
const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

/**
 * Daraja callbacks and STK Push (ADR-008). Callbacks resolve their channel by the opaque token,
 * are stored raw first, then processed in the channel's org; Safaricom always gets an ACK because
 * the money has already moved — processing errors are recorded on the stored callback.
 */
export function createDarajaFlows(deps: AppDeps, channels: ChannelService) {
  const { db, config, daraja, clock } = deps;

  async function resolveChannel(req: FastifyRequest, token: string) {
    const allow = config.daraja.callbackIps;
    if (allow.length && !allow.includes(req.ip)) {
      throw new AppError(
        403,
        'callback_source_not_allowed',
        'Forbidden',
        'Callback source IP is not allowed.',
      );
    }
    // Platform routing lookup: the token is the only thing a callback carries.
    const [row] = await db.owner
      .select({ id: ch.id, orgId: ch.orgId, status: ch.status })
      .from(ch)
      .where(eq(ch.channelToken, token));
    if (!row) throw AppError.notFound('Channel');
    return row;
  }

  async function store(
    ctx: Ctx,
    channelId: string,
    kind: (typeof cb.$inferInsert)['kind'],
    body: unknown,
    ip: string,
  ) {
    const id = uuidv7();
    await withTenant(db, ctx, (tx) =>
      tx
        .insert(cb)
        .values({ id, orgId: ctx.orgId, channelId, kind, body: body as object, sourceIp: ip }),
    );
    return id;
  }

  async function settle(ctx: Ctx, callbackId: string, outcome: string, paymentId?: string) {
    await withTenant(db, ctx, (tx) =>
      tx
        .update(cb)
        .set({ outcome: outcome.slice(0, 500), paymentId: paymentId ?? null })
        .where(eq(cb.id, callbackId)),
    );
  }

  function toStkDto(r: typeof stk.$inferSelect): z.infer<typeof StkRequest> {
    return {
      id: r.id,
      status: r.status,
      leaseId: r.leaseId,
      amountCents: money.toApiInt(r.amountCents),
      msisdn: r.msisdn,
      accountRef: r.accountRef,
      resultDesc: r.resultDesc,
      paymentId: r.paymentId,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** A confirmed STK success: record the payment and make sure it lands on the requested lease. */
  async function recordStkPayment(
    tx: Tx,
    ctx: Ctx,
    request: typeof stk.$inferSelect,
    receipt: string,
    amount: bigint,
    paidAt: Date,
    phone: string | null,
  ) {
    const { payment } = await recordPayment(tx, ctx, {
      channelId: request.channelId,
      source: 'stk',
      providerRef: receipt,
      amountCents: amount,
      paidAt,
      msisdn: phone,
      accountRef: request.accountRef,
    });
    const final =
      payment.matchStatus === 'unmatched' && request.leaseId
        ? await allocate(tx, ctx, payment, request.leaseId, 'auto_account')
        : payment;
    await tx
      .update(stk)
      .set({ status: 'succeeded', paymentId: final.id, resultCode: '0' })
      .where(eq(stk.id, request.id));
    return final;
  }

  return {
    async c2bValidation(req: FastifyRequest, token: string, body: Record<string, unknown>) {
      const channel = await resolveChannel(req, token);
      const ctx = systemCtx(channel.orgId);
      const id = await store(ctx, channel.id, 'c2b_validation', body, req.ip);
      await settle(ctx, id, 'accepted');
      return ACK; // never bounce a tenant's money; unknown account numbers go to the unmatched queue
    },

    async c2bConfirmation(req: FastifyRequest, token: string, body: Record<string, unknown>) {
      const channel = await resolveChannel(req, token);
      const ctx = systemCtx(channel.orgId);
      const id = await store(ctx, channel.id, 'c2b_confirmation', body, req.ip);
      try {
        const c2b = parseC2B(body);
        const { payment, created } = await withTenant(db, ctx, (tx) =>
          recordPayment(tx, ctx, {
            channelId: channel.id,
            source: 'c2b',
            providerRef: c2b.transId,
            amountCents: c2b.amountCents,
            paidAt: c2b.paidAt,
            msisdn: c2b.msisdn,
            payerName: c2b.payerName,
            accountRef: c2b.billRef,
            raw: body,
          }),
        );
        await settle(
          ctx,
          id,
          created ? `recorded:${payment.matchStatus}` : 'duplicate',
          payment.id,
        );
      } catch (err) {
        req.log.error({ err, callbackId: id }, 'C2B confirmation could not be processed');
        await settle(ctx, id, `error: ${(err as Error).message}`);
      }
      return ACK;
    },

    async stkResult(req: FastifyRequest, token: string, body: Record<string, unknown>) {
      const channel = await resolveChannel(req, token);
      const ctx = systemCtx(channel.orgId);
      const id = await store(ctx, channel.id, 'stk_result', body, req.ip);
      try {
        const result = parseStkCallback(body);
        const outcome = await withTenant(db, ctx, async (tx) => {
          const [request] = await tx
            .select()
            .from(stk)
            .where(eq(stk.checkoutRequestId, result.checkoutRequestId))
            .for('update');
          if (!request) return 'unknown_request';
          if (request.status !== 'pending') return `already_${request.status}`;
          if (result.resultCode !== '0') {
            await tx
              .update(stk)
              .set({
                status: result.resultCode === '1032' ? 'cancelled' : 'failed',
                resultCode: result.resultCode,
                resultDesc: result.resultDesc,
              })
              .where(eq(stk.id, request.id));
            return `failed:${result.resultCode}`;
          }
          // Never trust the callback alone: confirm with Safaricom before booking money (ADR-008).
          const [row] = await tx.select().from(ch).where(eq(ch.id, request.channelId));
          const confirm = await daraja.stkQuery(row!.darajaEnv, channels.credentialsOf(row!), {
            shortcode: row!.shortcode,
            checkoutRequestId: result.checkoutRequestId,
          });
          if (confirm.resultCode !== '0')
            return `unconfirmed:${confirm.resultCode ?? 'processing'}`;
          if (!result.receipt || result.amountCents === null) return 'missing_receipt';
          const payment = await recordStkPayment(
            tx,
            ctx,
            request,
            result.receipt,
            result.amountCents,
            result.paidAt ?? clock.now(),
            result.phone,
          );
          return `recorded:${payment.matchStatus}`;
        });
        await settle(ctx, id, outcome);
      } catch (err) {
        req.log.error({ err, callbackId: id }, 'STK result could not be processed');
        await settle(ctx, id, `error: ${(err as Error).message}`);
      }
      return ACK;
    },

    /** Ask the tenant's phone to pay (STK Push) against the landlord's shortcode. */
    async createStk(ctx: Ctx, body: z.infer<typeof StkRequestBody>) {
      return inTenant(db, ctx, async (tx) => {
        const [lease] = await leasing.leasesForMatching(tx, [body.leaseId]);
        if (!lease) throw AppError.notFound('Lease');
        const unit = (await accounts.unitsById(tx, [lease.unitId])).get(lease.unitId)!;
        const wanted =
          body.amountCents !== undefined
            ? BigInt(body.amountCents)
            : lease.balanceCents > 0n
              ? ((lease.balanceCents + 99n) / 100n) * 100n
              : 0n;
        if (wanted <= 0n)
          throw AppError.unprocessable(
            'nothing_owed',
            'This lease has nothing outstanding; send an amount.',
          );
        if (wanted % 100n !== 0n)
          throw AppError.unprocessable(
            'whole_shillings_only',
            'M-Pesa payment requests are in whole shillings.',
          );
        const phone = body.phone ?? lease.tenantPhone;
        if (!phone || !phoneLib.normalizeKenyanPhone(phone))
          throw AppError.unprocessable('no_phone', 'The tenant has no phone number; send one.');
        const candidates = body.channelId
          ? await tx.select().from(ch).where(eq(ch.id, body.channelId))
          : await tx
              .select()
              .from(ch)
              .where(
                and(
                  eq(ch.status, 'active'),
                  sql`${ch.kind} IN ('paybill', 'till')`,
                  sql`${ch.credentialsCiphertext} IS NOT NULL`,
                ),
              )
              .orderBy(ch.createdAt);
        const channel = candidates.find(
          (c) => !c.clientLandlordId || c.clientLandlordId === unit.clientLandlordId,
        );
        if (!channel || channel.kind === 'phone')
          throw AppError.unprocessable(
            'no_channel',
            'Set up a Paybill or Till with Daraja credentials first.',
          );

        const id = uuidv7();
        const [created] = await tx
          .insert(stk)
          .values({
            id,
            orgId: ctx.orgId,
            channelId: channel.id,
            leaseId: lease.leaseId,
            msisdn: phone,
            amountCents: wanted,
            accountRef: unit.code,
            requestedBy: ctx.userId ?? null,
          })
          .returning();
        let row = created!;
        try {
          const res = await daraja.stkPush(channel.darajaEnv, channels.credentialsOf(channel), {
            shortcode: channel.shortcode,
            kind: channel.kind,
            amountKes: Number(wanted / 100n),
            phone: phone.replace(/^\+/, ''),
            accountRef: unit.code,
            description: `Rent ${unit.code}`,
            callbackUrl: channels.callbackUrls(channel.channelToken).stkResult,
          });
          [row] = (await tx
            .update(stk)
            .set({
              merchantRequestId: res.merchantRequestId,
              checkoutRequestId: res.checkoutRequestId,
              resultDesc: res.customerMessage,
            })
            .where(eq(stk.id, id))
            .returning()) as [typeof row];
        } catch (err) {
          if (err instanceof AppError) throw err;
          [row] = (await tx
            .update(stk)
            .set({ status: 'failed', resultDesc: (err as Error).message.slice(0, 300) })
            .where(eq(stk.id, id))
            .returning()) as [typeof row];
        }
        await record(tx, ctx, {
          action: 'stk.requested',
          entityType: 'stk_request',
          entityId: id,
          diff: { leaseId: lease.leaseId, amountCents: wanted.toString() },
        });
        return toStkDto(row);
      });
    },

    async getStk(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(stk).where(eq(stk.id, id));
        if (!row) throw AppError.notFound('Payment request');
        return toStkDto(row);
      });
    },

    /**
     * Worker job: requests still pending after 2 minutes are checked with Safaricom; after 30
     * minutes they time out. A query success without a callback marks the request succeeded but
     * books nothing — the money arrives through C2B or a statement import with its M-Pesa code.
     */
    async reconcilePending(ctx: Ctx) {
      const now = clock.now();
      return inTenant(db, ctx, async (tx) => {
        const pending = await tx
          .select()
          .from(stk)
          .where(
            and(eq(stk.status, 'pending'), lt(stk.createdAt, new Date(now.getTime() - 120_000))),
          );
        let updated = 0;
        for (const r of pending) {
          if (now.getTime() - r.createdAt.getTime() > 30 * 60_000) {
            await tx
              .update(stk)
              .set({ status: 'timeout', resultDesc: 'No answer from the phone in time' })
              .where(eq(stk.id, r.id));
            updated++;
            continue;
          }
          if (!r.checkoutRequestId) continue;
          const [channel] = await tx.select().from(ch).where(eq(ch.id, r.channelId));
          const q = await daraja.stkQuery(channel!.darajaEnv, channels.credentialsOf(channel!), {
            shortcode: channel!.shortcode,
            checkoutRequestId: r.checkoutRequestId,
          });
          if (q.resultCode === null) continue;
          await tx
            .update(stk)
            .set({
              status:
                q.resultCode === '0'
                  ? 'succeeded'
                  : q.resultCode === '1032'
                    ? 'cancelled'
                    : 'failed',
              resultCode: q.resultCode,
              resultDesc: q.resultDesc,
            })
            .where(eq(stk.id, r.id));
          updated++;
        }
        return updated;
      });
    },
  };
}

export type DarajaFlows = ReturnType<typeof createDarajaFlows>;
