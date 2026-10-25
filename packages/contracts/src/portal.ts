import { z } from 'zod';
import { Cents, IdInput, IsoDate, RequiredTextInput, TextInput } from './common';
import { Ticket, TicketCategory } from './maintenance';

export const PortalLease = z
  .object({
    leaseId: z.uuid(),
    unitCode: z.string(),
    propertyName: z.string(),
    startDate: IsoDate,
    endDate: IsoDate.nullable(),
    status: z.enum(['active', 'terminated']),
    currentRentCents: Cents,
    balanceCents: Cents.meta({ description: 'What you owe now; negative = credit' }),
  })
  .meta({ id: 'PortalLease' });
export const PortalTenancy = z
  .object({ orgId: z.uuid(), landlordName: z.string(), leases: z.array(PortalLease) })
  .meta({ id: 'PortalTenancy' });
export const PortalMe = z
  .object({
    phone: z.string().nullable(),
    phoneVerified: z.boolean(),
    tenancies: z.array(PortalTenancy).meta({
      description:
        'Landlords holding your verified phone on a tenant record (sign in by phone OTP)',
    }),
  })
  .meta({ id: 'PortalMe' });

export const PortalLeaseParams = z.object({ leaseId: IdInput });
export const PortalPayBody = z
  .object({
    amountCents: Cents.min(100)
      .optional()
      .meta({ description: 'Whole shillings; defaults to your balance rounded up' }),
  })
  .meta({
    id: 'PortalPayBody',
    description: 'Sends an M-Pesa prompt to your phone (the landlord’s own Paybill/Till)',
  });
export const PortalTicketBody = z
  .object({
    leaseId: IdInput,
    title: RequiredTextInput(160),
    description: TextInput(4000).optional(),
    category: TicketCategory,
  })
  .meta({ id: 'PortalTicketBody' });
export const PortalTicketList = z
  .object({ items: z.array(Ticket) })
  .meta({ id: 'PortalTicketList' });
