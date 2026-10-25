import { z } from 'zod';
import {
  Cents,
  CursorQuery,
  FileLink,
  IdInput,
  pageOf,
  RequiredTextInput,
  SafeString,
  TextInput,
  Timestamp,
} from './common';

export const TicketCategory = z
  .enum([
    'plumbing',
    'electrical',
    'structural',
    'appliance',
    'pest',
    'cleaning',
    'security',
    'other',
  ])
  .meta({ id: 'TicketCategory' });
export const TicketPriority = z
  .enum(['low', 'normal', 'high', 'urgent'])
  .meta({ id: 'TicketPriority' });
export const TicketStatus = z
  .enum(['open', 'in_progress', 'resolved', 'closed', 'cancelled'])
  .meta({ id: 'TicketStatus' });

const PhotoKeys = z
  .array(SafeString(300))
  .max(10)
  .meta({ description: 'Keys from POST /v1/uploads with purpose maintenance_photo' });

export const Ticket = z
  .object({
    id: z.uuid(),
    number: z.string(),
    propertyId: z.uuid(),
    propertyName: z.string(),
    unitId: z.uuid().nullable(),
    unitCode: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    category: TicketCategory,
    priority: TicketPriority,
    status: TicketStatus,
    reporterKind: z.enum(['staff', 'caretaker', 'tenant']),
    reportedBy: z.uuid().nullable(),
    tenantId: z.uuid().nullable(),
    assigneeUserId: z.uuid().nullable(),
    assigneeName: z.string().nullable(),
    costCents: Cents.nullable(),
    expenseId: z
      .uuid()
      .nullable()
      .meta({ description: 'Expense recorded when resolved with a cost' }),
    resolvedAt: Timestamp.nullable(),
    closedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Ticket' });
export const TicketPage = pageOf(Ticket, 'Ticket');

export const TicketUpdate = z
  .object({
    id: z.uuid(),
    authorId: z.uuid().nullable(),
    note: z.string().nullable(),
    statusFrom: TicketStatus.nullable(),
    statusTo: TicketStatus.nullable(),
    photos: z.array(FileLink),
    createdAt: Timestamp,
  })
  .meta({ id: 'TicketUpdate' });
export const TicketDetail = Ticket.extend({ updates: z.array(TicketUpdate) }).meta({
  id: 'TicketDetail',
});

export const CreateTicketBody = z
  .object({
    propertyId: IdInput.optional(),
    unitId: IdInput.optional().meta({ description: 'Implies the property' }),
    title: RequiredTextInput(160),
    description: TextInput(4000).optional(),
    category: TicketCategory,
    priority: TicketPriority.optional(),
    reporterKind: z.enum(['staff', 'caretaker', 'tenant']).optional().meta({
      description:
        "Defaults to caretaker for caretakers, staff otherwise; 'tenant' when entering a tenant's report",
    }),
    tenantId: IdInput.optional(),
    photoKeys: PhotoKeys.optional(),
  })
  .meta({ id: 'CreateTicketBody', description: 'unitId or propertyId (422 target_required)' });

export const UpdateTicketBody = z
  .object({
    title: RequiredTextInput(160).optional(),
    description: TextInput(4000).nullable().optional(),
    category: TicketCategory.optional(),
    priority: TicketPriority.optional(),
    assigneeUserId: IdInput.nullable().optional().meta({ description: 'A member of the org' }),
    assigneeName: TextInput(120).nullable().optional().meta({ description: 'An outside fundi' }),
    costCents: Cents.min(0).nullable().optional(),
  })
  .meta({ id: 'UpdateTicketBody' });

export const AddTicketUpdateBody = z
  .object({
    note: TextInput(4000).optional(),
    status: TicketStatus.optional().meta({
      description:
        'open ↔ in_progress → resolved → closed; resolved can reopen; open/in_progress can be cancelled (409 invalid_ticket_transition). Caretakers cannot close or cancel.',
    }),
    costCents: Cents.min(0)
      .optional()
      .meta({ description: 'Final cost, usually sent when resolving' }),
    photoKeys: PhotoKeys.optional(),
  })
  .meta({
    id: 'AddTicketUpdateBody',
    description: 'At least one of note, status, costCents or photoKeys',
  });

export const TicketQuery = CursorQuery.extend({
  status: TicketStatus.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .meta({ description: 'true = open, in progress or resolved (not closed/cancelled)' }),
  propertyId: IdInput.optional(),
  unitId: IdInput.optional(),
  priority: TicketPriority.optional(),
});
