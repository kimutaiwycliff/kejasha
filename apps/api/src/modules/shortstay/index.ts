import type { AppDeps } from '../../deps';
import { createIcalSync } from './ical';
import { shortStayRoutes, type ShortStayParts } from './routes';
import { createShortStayService } from './service';

export function createShortStay(deps: AppDeps): ShortStayParts {
  const service = createShortStayService(deps);
  return { service, ical: createIcalSync(deps, service) };
}

export {
  bookingForPayment,
  bookingsForPayments,
  COLLECTED_SOURCES,
  owingBookingIdsByGuestPhone,
  type BookingForPayment,
} from './lookups';
export {
  expenseIdsByTicket,
  recordUnitExpense,
  setTicketExpense,
  type UnitExpenseInput,
} from './service';
export { shortStayRoutes, type ShortStayParts };
