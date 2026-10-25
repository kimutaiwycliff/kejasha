import type { AppDeps } from '../../deps';
import { createCashCollections } from './cash';
import { createChannelService } from './channels';
import { createDarajaFlows } from './daraja-flows';
import { createImports } from './imports';
import { createReceipts } from './receipts';
import { paymentsRoutes, type PaymentsParts } from './routes';
import { createPaymentsService } from './service';

export function createPayments(deps: AppDeps): PaymentsParts {
  const payments = createPaymentsService(deps);
  const channels = createChannelService(deps);
  return {
    payments,
    channels,
    daraja: createDarajaFlows(deps, channels),
    imports: createImports(deps, payments),
    receipts: createReceipts(deps),
    cash: createCashCollections(deps),
  };
}

export { paymentsRoutes, type PaymentsParts };

export { leasePaymentCredits } from './service';
