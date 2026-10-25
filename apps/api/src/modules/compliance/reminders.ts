import { money, tax, time } from '@kejasha/core';
import { enqueueInTx } from '@kejasha/jobs';
import type { AppDeps } from '../../deps';
import { inTenant, type Ctx } from '../../lib/ctx';
import type { Licences } from './licences';
import type { Mri } from './mri';

export interface Contact {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
}
export interface ComplianceDeps {
  /** Owners and managers of the org who receive compliance reminders. */
  staffContacts(orgId: string, roles: ('owner' | 'manager')[]): Promise<Contact[]>;
}

/** Days before expiry when licence reminders go out (0 = expiry day). */
export const LICENCE_REMINDER_DAYS = [30, 7, 1, 0] as const;
/** Day of the month the MRI reminder goes out (filing is due on the 20th). */
export const MRI_REMINDER_DAY = 15;

const KIND = {
  tra_short_stay: 'TRA short-stay licence',
  county_business_permit: 'County business permit',
  other: 'Licence',
} as const;

/**
 * Daily compliance run (worker, 07:00 Nairobi): licence expiry reminders and the MRI reminder on
 * the 15th. Messages are queued through the outbox with per-recipient dedupe keys, so re-running
 * a day never sends twice.
 */
export function createReminders(
  deps: AppDeps,
  mri: Mri,
  licences: Licences,
  people: ComplianceDeps,
) {
  const { db } = deps;

  async function send(ctx: Ctx, contacts: Contact[], key: string, subject: string, text: string) {
    let queued = 0;
    await inTenant(db, ctx, async (tx) => {
      for (const c of contacts) {
        if (c.phone) {
          await enqueueInTx(tx, {
            orgId: ctx.orgId,
            topic: 'notifications.sms',
            payload: { to: c.phone, message: `Kejasha: ${text}`.slice(0, 900) },
            dedupeKey: `${key}:sms:${c.userId}`,
          });
          queued++;
        }
        if (c.email) {
          await enqueueInTx(tx, {
            orgId: ctx.orgId,
            topic: 'notifications.email',
            payload: { to: c.email, subject, text: `Hello ${c.name},\n\n${text}\n\n— Kejasha` },
            dedupeKey: `${key}:email:${c.userId}`,
          });
          queued++;
        }
      }
    });
    return queued;
  }

  return {
    async runDaily(ctx: Ctx, today: string) {
      const contacts = await people.staffContacts(ctx.orgId, ['owner', 'manager']);
      let licenceReminders = 0;
      let mriReminders = 0;
      if (!contacts.length) return { licenceReminders, mriReminders };
      for (const days of LICENCE_REMINDER_DAYS) {
        for (const l of await licences.expiringOn(ctx, today, days)) {
          const where = l.unitCode ? `${l.unitCode} (${l.propertyName})` : l.propertyName;
          const when =
            days === 0
              ? 'expires today'
              : `expires on ${l.expiresOn} (in ${days} day${days === 1 ? '' : 's'})`;
          licenceReminders += await send(
            ctx,
            contacts,
            `licence:${l.id}:${l.expiresOn}:${days}`,
            `${KIND[l.kind]} for ${where} ${days === 0 ? 'expires today' : 'is expiring'}`,
            `The ${KIND[l.kind]}${l.number ? ` ${l.number}` : ''} for ${where} ${when}. Renew it and update the record.`,
          );
        }
      }
      if (Number(today.slice(8, 10)) === MRI_REMINDER_DAY) {
        const period = time.addPeriods(time.periodOf(today), -1);
        for (const l of await mri.unfiled(ctx, period)) {
          const amount = money.formatKes(BigInt(l.taxCents));
          mriReminders += await send(
            ctx,
            contacts,
            `mri:${l.clientLandlordId}:${period}`,
            `Monthly Rental Income for ${period}: ${amount} due by ${tax.mriDueDate(period)}`,
            `Monthly Rental Income for ${period}${l.isSelf ? '' : ` (${l.name})`} is ${amount}, due by ${tax.mriDueDate(period)}. File it on iTax and mark it filed in Kejasha.`,
          );
        }
      }
      return { licenceReminders, mriReminders };
    },
  };
}

export type Reminders = ReturnType<typeof createReminders>;
