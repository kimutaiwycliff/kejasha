import {
  Booking,
  BookingPage,
  BookingQuery,
  Calendar,
  CalendarBlock,
  CalendarQuery,
  CancelBookingBody,
  CreateBlockBody,
  CreateBookingBody,
  CreateExpenseBody,
  CreateGuestBody,
  CreateIcalFeedBody,
  CreateSeasonBody,
  ExpenseQuery,
  Guest,
  GuestPage,
  GuestQuery,
  IcalFeed,
  IcalFeedList,
  IcalFeedQuery,
  IcalSyncResult,
  IdParam,
  ProfitQuery,
  problemResponses,
  Quote,
  RatePlan,
  ShortStayReport,
  StayQuery,
  UnitExpense,
  UnitExpenseList,
  UnitIdParam,
  UpdateBookingBody,
  UpdateGuestBody,
  UpdateIcalFeedBody,
  UpsertRatePlanBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { ctxOf } from '../../lib/ctx';
import type { IcalSync } from './ical';
import type { ShortStayService } from './service';

const NoContent = z.undefined();

export interface ShortStayParts {
  service: ShortStayService;
  ical: IcalSync;
}

export function shortStayRoutes({ service, ical }: ShortStayParts): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['short-stay'];
    const agent = { minRole: 'agent' as const };
    const manager = { minRole: 'manager' as const };

    // ── Rates ─────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/units/:unitId/rate-plan',
      {
        config: agent,
        schema: {
          operationId: 'getRatePlan',
          tags,
          summary: 'Nightly rates, minimum stay, buffer and seasons of a short-stay unit',
          params: UnitIdParam,
          response: { 200: RatePlan, ...problemResponses(404, 422) },
        },
      },
      async (req) => service.getRatePlan(ctxOf(req), req.params.unitId),
    );
    app.put(
      '/v1/units/:unitId/rate-plan',
      {
        config: manager,
        schema: {
          operationId: 'upsertRatePlan',
          tags,
          summary: 'Set nightly rates, minimum stay, buffer days and cleaning fee',
          params: UnitIdParam,
          body: UpsertRatePlanBody,
          response: { 200: RatePlan, ...problemResponses(404, 422) },
        },
      },
      async (req) => service.upsertRatePlan(ctxOf(req), req.params.unitId, req.body),
    );
    app.post(
      '/v1/units/:unitId/seasons',
      {
        config: manager,
        schema: {
          operationId: 'createSeason',
          tags,
          summary: 'Add a seasonal nightly rate (seasons on a unit cannot overlap)',
          params: UnitIdParam,
          body: CreateSeasonBody,
          response: { 201: RatePlan, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await service.addSeason(ctxOf(req), req.params.unitId, req.body)),
    );
    app.delete(
      '/v1/seasons/:id',
      {
        config: manager,
        schema: {
          operationId: 'deleteSeason',
          tags,
          summary: 'Remove a seasonal rate',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404) },
        },
      },
      async (req, reply) => {
        await service.removeSeason(ctxOf(req), req.params.id);
        return reply.status(204).send();
      },
    );
    app.get(
      '/v1/units/:unitId/quote',
      {
        config: agent,
        schema: {
          operationId: 'quoteStay',
          tags,
          summary: 'Price a stay night by night and check availability',
          params: UnitIdParam,
          querystring: StayQuery,
          response: { 200: Quote, ...problemResponses(404, 422) },
        },
      },
      async (req) =>
        service.quote(ctxOf(req), req.params.unitId, req.query.checkIn, req.query.checkOut),
    );

    // ── Guests ────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/guests',
      {
        config: agent,
        schema: {
          operationId: 'listGuests',
          tags,
          summary: 'Guests with stay counts (search by name or phone)',
          querystring: GuestQuery,
          response: { 200: GuestPage, ...problemResponses() },
        },
      },
      async (req) => service.listGuests(ctxOf(req), req.query),
    );
    app.post(
      '/v1/guests',
      {
        config: agent,
        schema: {
          operationId: 'createGuest',
          tags,
          summary: 'Add a guest (one per phone number)',
          body: CreateGuestBody,
          response: { 201: Guest, ...problemResponses(409) },
        },
      },
      async (req, reply) => reply.status(201).send(await service.createGuest(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/guests/:id',
      {
        config: agent,
        schema: {
          operationId: 'getGuest',
          tags,
          summary: 'A guest',
          params: IdParam,
          response: { 200: Guest, ...problemResponses(404) },
        },
      },
      async (req) => service.getGuest(ctxOf(req), req.params.id),
    );
    app.patch(
      '/v1/guests/:id',
      {
        config: agent,
        schema: {
          operationId: 'updateGuest',
          tags,
          summary: 'Edit a guest',
          params: IdParam,
          body: UpdateGuestBody,
          response: { 200: Guest, ...problemResponses(404, 409) },
        },
      },
      async (req) => service.updateGuest(ctxOf(req), req.params.id, req.body),
    );

    // ── Bookings ──────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/bookings',
      {
        config: agent,
        schema: {
          operationId: 'listBookings',
          tags,
          summary: 'Bookings by arrival date (filter by unit, dates, status, source)',
          querystring: BookingQuery,
          response: { 200: BookingPage, ...problemResponses() },
        },
      },
      async (req) => service.listBookings(ctxOf(req), req.query),
    );
    app.post(
      '/v1/bookings',
      {
        config: agent,
        schema: {
          operationId: 'createBooking',
          tags,
          summary: 'Book a short-stay unit (409 dates_unavailable when booked or blocked)',
          body: CreateBookingBody,
          response: { 201: Booking, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await service.createBooking(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/bookings/:id',
      {
        config: agent,
        schema: {
          operationId: 'getBooking',
          tags,
          summary: 'A booking with what is paid and owed',
          params: IdParam,
          response: { 200: Booking, ...problemResponses(404) },
        },
      },
      async (req) => service.getBooking(ctxOf(req), req.params.id),
    );
    app.patch(
      '/v1/bookings/:id',
      {
        config: agent,
        schema: {
          operationId: 'updateBooking',
          tags,
          summary: 'Change dates, price, commission or guest',
          params: IdParam,
          body: UpdateBookingBody,
          response: { 200: Booking, ...problemResponses(404, 409, 422) },
        },
      },
      async (req) => service.updateBooking(ctxOf(req), req.params.id, req.body),
    );
    const transitions = [
      [
        'check-in',
        'checkInBooking',
        'Mark the guest as arrived',
        (ctx: ReturnType<typeof ctxOf>, id: string) => service.checkIn(ctx, id),
      ],
      [
        'check-out',
        'checkOutBooking',
        'Mark the guest as departed',
        (ctx: ReturnType<typeof ctxOf>, id: string) => service.checkOut(ctx, id),
      ],
      [
        'no-show',
        'markBookingNoShow',
        'The guest never arrived (frees the dates)',
        (ctx: ReturnType<typeof ctxOf>, id: string) => service.noShow(ctx, id),
      ],
    ] as const;
    for (const [path, operationId, summary, run] of transitions) {
      app.post(
        `/v1/bookings/:id/${path}`,
        {
          config: agent,
          schema: {
            operationId,
            tags,
            summary,
            params: IdParam,
            response: { 200: Booking, ...problemResponses(404, 409) },
          },
        },
        async (req) => run(ctxOf(req), req.params.id),
      );
    }
    app.post(
      '/v1/bookings/:id/cancel',
      {
        config: agent,
        schema: {
          operationId: 'cancelBooking',
          tags,
          summary: 'Cancel a booking (frees the dates; billed amounts are reversed)',
          params: IdParam,
          body: CancelBookingBody,
          response: { 200: Booking, ...problemResponses(404, 409) },
        },
      },
      async (req) => service.cancel(ctxOf(req), req.params.id, req.body.reason),
    );

    // ── Calendar & blocks ─────────────────────────────────────────────────────────────────
    app.get(
      '/v1/calendar',
      {
        config: agent,
        schema: {
          operationId: 'getCalendar',
          tags,
          summary: 'Bookings and blocks per short-stay unit for up to 92 days',
          querystring: CalendarQuery,
          response: { 200: Calendar, ...problemResponses(422) },
        },
      },
      async (req) =>
        service.calendar(ctxOf(req), req.query.from, req.query.to, req.query.propertyId),
    );
    app.post(
      '/v1/calendar-blocks',
      {
        config: agent,
        schema: {
          operationId: 'createCalendarBlock',
          tags,
          summary: 'Block dates for owner use or maintenance',
          body: CreateBlockBody,
          response: { 201: CalendarBlock, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await service.createBlock(ctxOf(req), req.body)),
    );
    app.delete(
      '/v1/calendar-blocks/:id',
      {
        config: agent,
        schema: {
          operationId: 'deleteCalendarBlock',
          tags,
          summary: 'Remove a block (iCal blocks are managed by their feed)',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404, 409) },
        },
      },
      async (req, reply) => {
        await service.removeBlock(ctxOf(req), req.params.id);
        return reply.status(204).send();
      },
    );

    // ── iCal feeds ────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/ical-feeds',
      {
        config: manager,
        schema: {
          operationId: 'listIcalFeeds',
          tags,
          summary: 'Connected Airbnb/Booking.com calendars (read-only import)',
          querystring: IcalFeedQuery,
          response: { 200: IcalFeedList, ...problemResponses() },
        },
      },
      async (req) => ({ items: await ical.list(ctxOf(req), req.query.unitId) }),
    );
    app.post(
      '/v1/ical-feeds',
      {
        config: manager,
        schema: {
          operationId: 'createIcalFeed',
          tags,
          summary: 'Connect an iCal export URL to a unit',
          body: CreateIcalFeedBody,
          response: { 201: IcalFeed, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await ical.create(ctxOf(req), req.body)),
    );
    app.patch(
      '/v1/ical-feeds/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateIcalFeed',
          tags,
          summary: 'Pause or resume a feed',
          params: IdParam,
          body: UpdateIcalFeedBody,
          response: { 200: IcalFeed, ...problemResponses(404) },
        },
      },
      async (req) => ical.setEnabled(ctxOf(req), req.params.id, req.body.enabled),
    );
    app.delete(
      '/v1/ical-feeds/:id',
      {
        config: manager,
        schema: {
          operationId: 'deleteIcalFeed',
          tags,
          summary: 'Disconnect a feed (its blocks go; imported bookings stay)',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404) },
        },
      },
      async (req, reply) => {
        await ical.remove(ctxOf(req), req.params.id);
        return reply.status(204).send();
      },
    );
    app.post(
      '/v1/ical-feeds/:id/sync',
      {
        config: manager,
        schema: {
          operationId: 'syncIcalFeed',
          tags,
          summary: 'Fetch the feed now (also runs every 20 minutes)',
          params: IdParam,
          response: { 200: IcalSyncResult, ...problemResponses(404) },
        },
      },
      async (req) => ical.sync(ctxOf(req), req.params.id),
    );

    // ── Expenses & profit ─────────────────────────────────────────────────────────────────
    app.get(
      '/v1/unit-expenses',
      {
        config: manager,
        schema: {
          operationId: 'listUnitExpenses',
          tags,
          summary: 'Unit running costs in a date range',
          querystring: ExpenseQuery,
          response: { 200: UnitExpenseList, ...problemResponses(422) },
        },
      },
      async (req) => ({ items: await service.listExpenses(ctxOf(req), req.query) }),
    );
    app.post(
      '/v1/unit-expenses',
      {
        config: manager,
        schema: {
          operationId: 'createUnitExpense',
          tags,
          summary: 'Record a unit cost (tokens, wifi, cleaning, supplies, repairs…)',
          body: CreateExpenseBody,
          response: { 201: UnitExpense, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await service.addExpense(ctxOf(req), req.body)),
    );
    app.delete(
      '/v1/unit-expenses/:id',
      {
        config: manager,
        schema: {
          operationId: 'deleteUnitExpense',
          tags,
          summary: 'Remove an expense',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404) },
        },
      },
      async (req, reply) => {
        await service.removeExpense(ctxOf(req), req.params.id);
        return reply.status(204).send();
      },
    );
    app.get(
      '/v1/reports/short-stay',
      {
        config: manager,
        schema: {
          operationId: 'getShortStayReport',
          tags,
          summary:
            'Monthly profit per unit (occupancy, ADR, RevPAR) and what each channel really costs',
          querystring: ProfitQuery,
          response: { 200: ShortStayReport, ...problemResponses() },
        },
      },
      async (req) => service.report(ctxOf(req), req.query.period, req.query.propertyId),
    );
  };
}
