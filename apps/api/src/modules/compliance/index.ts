import type { AppDeps } from '../../deps';
import { createLicences } from './licences';
import { createMri } from './mri';
import { createReminders, type ComplianceDeps } from './reminders';
import { complianceRoutes, type ComplianceParts } from './routes';

export function createCompliance(deps: AppDeps, people: ComplianceDeps) {
  const mri = createMri(deps);
  const licences = createLicences(deps);
  return { mri, licences, reminders: createReminders(deps, mri, licences, people) };
}

export { complianceRoutes, type ComplianceDeps, type ComplianceParts };
