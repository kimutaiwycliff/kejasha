import { randomBytes } from 'node:crypto';
import { darajaCallbackBase } from '@kejasha/config';
import type {
  CreateChannelBody,
  GoLiveChecklist,
  PaymentChannel,
  SetCredentialsBody,
  UpdateChannelBody,
} from '@kejasha/contracts';
import { phone as phoneLib, uuidv7 } from '@kejasha/core';
import { and, eq, PG, pgError, schema, sql, type Tx } from '@kejasha/db';
import type { DarajaCredentials } from '@kejasha/integrations-daraja';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { openSecret, sealSecret } from '../../lib/credentials';
import { inTenant, type Ctx } from '../../lib/ctx';

const { paymentChannel: ch, payment: pm } = schema;
export type ChannelRow = typeof ch.$inferSelect;

export const GO_LIVE_DOCUMENTS = [
  'Certificate of registration / business permit (or national ID for sole proprietors)',
  'KRA PIN certificate',
  'Signed letter naming the M-Pesa business administrator',
  'Daraja production app request (developer portal "Go Live")',
  'Evidence of a successful sandbox test transaction',
];

export function createChannelService(deps: AppDeps) {
  const { db, config, daraja } = deps;

  function callbackUrls(token: string) {
    const base = darajaCallbackBase(config, token);
    return {
      confirmation: `${base}/c2b/confirmation`,
      validation: `${base}/c2b/validation`,
      stkResult: `${base}/stk`,
    };
  }

  function toDto(r: ChannelRow): z.infer<typeof PaymentChannel> {
    return {
      id: r.id,
      kind: r.kind,
      shortcode: r.shortcode,
      displayName: r.displayName,
      status: r.status,
      clientLandlordId: r.clientLandlordId,
      darajaEnv: r.darajaEnv,
      hasCredentials: r.credentialsCiphertext !== null,
      credentialsUpdatedAt: r.credentialsUpdatedAt?.toISOString() ?? null,
      c2bRegisteredAt: r.c2bRegisteredAt?.toISOString() ?? null,
      callbackUrls: r.kind === 'phone' ? null : callbackUrls(r.channelToken),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async function load(tx: Tx, id: string) {
    const [row] = await tx.select().from(ch).where(eq(ch.id, id));
    if (!row) throw AppError.notFound('Payment channel');
    return row;
  }

  /** Decrypted Daraja credentials (never leave the server; never logged). */
  function credentialsOf(row: ChannelRow): DarajaCredentials {
    if (!row.credentialsCiphertext || !row.credentialsWrappedKey) {
      throw AppError.unprocessable(
        'credentials_missing',
        'Add the Daraja credentials for this channel first.',
      );
    }
    return openSecret<DarajaCredentials>(config.credentialsMasterKey, {
      keyVersion: row.credentialsKeyVersion ?? 1,
      wrappedKey: row.credentialsWrappedKey,
      ciphertext: row.credentialsCiphertext,
    });
  }

  return {
    toDto,
    load,
    credentialsOf,
    callbackUrls,

    async list(ctx: Ctx) {
      return inTenant(db, ctx, async (tx) =>
        (await tx.select().from(ch).orderBy(ch.createdAt)).map(toDto),
      );
    },

    async create(ctx: Ctx, body: z.infer<typeof CreateChannelBody>) {
      let shortcode = body.shortcode.trim();
      if (body.kind === 'phone') {
        const e164 = phoneLib.normalizeKenyanPhone(shortcode);
        if (!e164)
          throw AppError.unprocessable(
            'invalid_shortcode',
            'Enter the Kenyan M-Pesa number for this line.',
          );
        shortcode = e164;
      } else if (!/^\d{5,8}$/.test(shortcode)) {
        throw AppError.unprocessable(
          'invalid_shortcode',
          'Paybill and Till numbers are 5–8 digits.',
        );
      }
      return inTenant(db, ctx, async (tx) => {
        const id = uuidv7();
        const [row] = await tx
          .insert(ch)
          .values({
            id,
            orgId: ctx.orgId,
            clientLandlordId: body.clientLandlordId ?? null,
            kind: body.kind,
            shortcode,
            displayName: body.displayName,
            darajaEnv: body.darajaEnv ?? config.daraja.env,
            channelToken: randomBytes(32).toString('base64url'),
          })
          .returning()
          .catch((err: unknown) => {
            if (pgError(err)?.code === PG.uniqueViolation)
              throw AppError.conflict('channel_exists', 'This number is already set up.');
            throw err;
          });
        await record(tx, ctx, {
          action: 'payment_channel.created',
          entityType: 'payment_channel',
          entityId: id,
          diff: { kind: body.kind, shortcode },
        });
        return toDto(row!);
      });
    },

    async update(ctx: Ctx, id: string, body: z.infer<typeof UpdateChannelBody>) {
      return inTenant(db, ctx, async (tx) => {
        await load(tx, id);
        const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
        const [row] = Object.keys(set).length
          ? await tx.update(ch).set(set).where(eq(ch.id, id)).returning()
          : [await load(tx, id)];
        await record(tx, ctx, {
          action: 'payment_channel.updated',
          entityType: 'payment_channel',
          entityId: id,
          diff: body,
        });
        return toDto(row!);
      });
    },

    /** Store Daraja credentials envelope-encrypted. Write-only: the API never returns them. */
    async setCredentials(ctx: Ctx, id: string, body: z.infer<typeof SetCredentialsBody>) {
      return inTenant(db, ctx, async (tx) => {
        const current = await load(tx, id);
        if (current.kind === 'phone')
          throw AppError.unprocessable(
            'credentials_not_applicable',
            'Personal numbers have no Daraja API access.',
          );
        const sealed = sealSecret(config.credentialsMasterKey, body);
        const [row] = await tx
          .update(ch)
          .set({
            credentialsKeyVersion: sealed.keyVersion,
            credentialsWrappedKey: sealed.wrappedKey,
            credentialsCiphertext: sealed.ciphertext,
            credentialsUpdatedAt: sql`now()`,
          })
          .where(eq(ch.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'payment_channel.credentials_set',
          entityType: 'payment_channel',
          entityId: id,
          diff: { passkey: Boolean(body.passkey) },
        });
        return toDto(row!);
      });
    },

    /** Point the shortcode's C2B confirmation/validation URLs at us (ADR-008, ADR-016). */
    async registerC2B(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, id);
        if (row.kind === 'phone')
          throw AppError.unprocessable(
            'credentials_not_applicable',
            'Personal numbers cannot register C2B URLs.',
          );
        const urls = callbackUrls(row.channelToken);
        try {
          await daraja.registerC2B(row.darajaEnv, credentialsOf(row), {
            shortcode: row.shortcode,
            confirmationUrl: urls.confirmation,
            validationUrl: urls.validation,
          });
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError(
            503,
            'daraja_unavailable',
            'Daraja unavailable',
            `Safaricom rejected or did not answer the registration: ${(err as Error).message}`,
          );
        }
        const [updated] = await tx
          .update(ch)
          .set({ c2bRegisteredAt: sql`now()` })
          .where(eq(ch.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'payment_channel.c2b_registered',
          entityType: 'payment_channel',
          entityId: id,
        });
        return toDto(updated!);
      });
    },

    async goLive(ctx: Ctx, id: string): Promise<z.infer<typeof GoLiveChecklist>> {
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, id);
        const [first] = await tx
          .select({ id: pm.id })
          .from(pm)
          .where(and(eq(pm.channelId, id), eq(pm.source, 'c2b')))
          .limit(1);
        const passkey = row.credentialsCiphertext ? Boolean(credentialsOf(row).passkey) : false;
        const items = [
          {
            key: 'api_channel',
            label: 'Paybill or Till (not a personal number)',
            done: row.kind !== 'phone',
            help: 'Personal numbers are reconciled from statements or SMS instead.',
          },
          {
            key: 'credentials',
            label: 'Daraja consumer key and secret saved',
            done: row.credentialsCiphertext !== null,
            help: 'From your Daraja app (developer.safaricom.co.ke).',
          },
          {
            key: 'passkey',
            label: 'Lipa na M-Pesa passkey saved (for payment requests)',
            done: passkey,
            help: 'Safaricom sends it after the shortcode is approved for STK Push.',
          },
          {
            key: 'production',
            label: 'Production environment selected',
            done: row.darajaEnv === 'production',
            help: 'Switch after Safaricom approves your go-live request.',
          },
          {
            key: 'c2b_registered',
            label: 'Payment notifications registered',
            done: row.c2bRegisteredAt !== null,
            help: 'Registers our confirmation and validation URLs for this shortcode.',
          },
          {
            key: 'first_payment',
            label: 'First payment received',
            done: Boolean(first),
            help: 'Send a small test payment using a unit code as the account number.',
          },
        ];
        return {
          channelId: id,
          ready: items.every((i) => i.done),
          items,
          documents: GO_LIVE_DOCUMENTS,
        };
      });
    },

    /** Owner-side re-registration for every channel with credentials (domain moves: `make daraja-reregister`). */
    async reregisterAll(ctxs: Ctx[]) {
      const results: { orgId: string; channelId: string; ok: boolean; error?: string }[] = [];
      for (const ctx of ctxs) {
        const rows = await inTenant(db, ctx, (tx) =>
          tx
            .select()
            .from(ch)
            .where(and(eq(ch.status, 'active'), sql`${ch.credentialsCiphertext} IS NOT NULL`)),
        );
        for (const r of rows) {
          try {
            await this.registerC2B(ctx, r.id);
            results.push({ orgId: ctx.orgId, channelId: r.id, ok: true });
          } catch (err) {
            results.push({
              orgId: ctx.orgId,
              channelId: r.id,
              ok: false,
              error: (err as Error).message,
            });
          }
        }
      }
      return results;
    },
  };
}

export type ChannelService = ReturnType<typeof createChannelService>;
