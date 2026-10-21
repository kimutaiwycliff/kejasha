import type { SmsPaymentBody, StatementImport, StatementImportBody } from '@kejasha/contracts';
import { time, uuidv7 } from '@kejasha/core';
import { eq, schema } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import {
  ParseError,
  parseBusinessCsv,
  parseMpesaSms,
  parseStatementPdf,
  type ParsedPayment,
} from './parsers';
import { recordPayment, type PaymentsService } from './service';

const { statementImport: si } = schema;

/** Reconciliation without a Paybill (ADR-009): statements and shared SMS → the same payments path. */
export function createImports(deps: AppDeps, payments: PaymentsService) {
  const { db, storage } = deps;

  function toDto(r: typeof si.$inferSelect): z.infer<typeof StatementImport> {
    return {
      id: r.id,
      status: r.status,
      format: r.format,
      rowsTotal: r.rowsTotal,
      rowsCredits: r.rowsCredits,
      rowsNew: r.rowsNew,
      rowsDuplicate: r.rowsDuplicate,
      rowsMatched: r.rowsMatched,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    };
  }

  return {
    async importStatement(ctx: Ctx, body: z.infer<typeof StatementImportBody>) {
      if (!body.fileKey.startsWith(`org/${ctx.orgId}/statement/`) || body.fileKey.includes('..')) {
        throw AppError.unprocessable(
          'invalid_file_key',
          'Upload the statement with POST /v1/uploads (purpose=statement) first.',
        );
      }
      const file = await storage.getObject(body.fileKey);
      if (!file)
        throw AppError.unprocessable(
          'file_not_found',
          'The uploaded statement was not found; upload it again.',
        );
      let parsed: { rows: ParsedPayment[]; total: number };
      try {
        parsed =
          body.format === 'mpesa_business_csv'
            ? parseBusinessCsv(new TextDecoder().decode(file))
            : await parseStatementPdf(file, body.password);
      } catch (err) {
        if (err instanceof ParseError) throw AppError.unprocessable(err.code, err.message);
        throw err;
      }
      return inTenant(db, ctx, async (tx) => {
        const id = uuidv7();
        const dates = parsed.rows.map((r) => time.nairobiDate(r.paidAt)).sort();
        await tx.insert(si).values({
          id,
          orgId: ctx.orgId,
          channelId: body.channelId ?? null,
          fileKey: body.fileKey,
          format: body.format,
          status: 'parsed',
          createdBy: ctx.userId ?? null,
        });
        let fresh = 0;
        let duplicate = 0;
        let matched = 0;
        for (const row of parsed.rows) {
          const { payment, created } = await recordPayment(tx, ctx, {
            ...row,
            channelId: body.channelId ?? null,
            source: 'statement_import',
            importId: id,
          });
          if (!created) duplicate++;
          else {
            fresh++;
            if (payment.matchStatus === 'matched') matched++;
          }
        }
        const [saved] = await tx
          .update(si)
          .set({
            rowsTotal: parsed.total,
            rowsCredits: parsed.rows.length,
            rowsNew: fresh,
            rowsDuplicate: duplicate,
            rowsMatched: matched,
            periodFrom: dates[0] ?? null,
            periodTo: dates.at(-1) ?? null,
          })
          .where(eq(si.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'statement.imported',
          entityType: 'statement_import',
          entityId: id,
          diff: { fresh, duplicate, matched },
        });
        return toDto(saved!);
      });
    },

    async getImport(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(si).where(eq(si.id, id));
        if (!row) throw AppError.notFound('Statement import');
        return toDto(row);
      });
    },

    async fromSms(ctx: Ctx, body: z.infer<typeof SmsPaymentBody>) {
      let parsed: ParsedPayment;
      try {
        parsed = parseMpesaSms(body.text);
      } catch (err) {
        if (err instanceof ParseError) throw AppError.unprocessable(err.code, err.message);
        throw err;
      }
      return inTenant(db, ctx, async (tx) => {
        const { payment } = await recordPayment(tx, ctx, {
          ...parsed,
          channelId: body.channelId ?? null,
          source: 'sms',
          raw: { text: body.text },
        });
        return (await payments.toDtos(tx, [payment]))[0]!;
      });
    },
  };
}

export type Imports = ReturnType<typeof createImports>;
