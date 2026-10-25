import type { AppDeps } from '../../deps';
import { createInvoiceOps } from './invoice-ops';
import { createMeterService } from './meters';
import { createLeasingOperations } from './operations';
import { leasingRoutes, type LeasingParts } from './routes';
import { createLeasingService } from './service';
import { createLeasingViews } from './views';

export function createLeasing(deps: AppDeps): LeasingParts {
  return {
    service: createLeasingService(deps),
    meters: createMeterService(deps),
    views: createLeasingViews(deps),
    ops: createLeasingOperations(deps),
    invoices: createInvoiceOps(deps),
  };
}

export { leasingRoutes, type LeasingParts };
export {
  leaseIdsByTenantPhone,
  leaseOnUnitAt,
  leaseOwnerOf,
  leaseTaxInputs,
  rentRollLeases,
  tenantRecordsByPhone,
  leasesForMatching,
  sumOpen,
  tenantsById,
  type LeaseForMatching,
  type LeaseTaxInputs,
  type RentRollLease,
} from './lookups';
