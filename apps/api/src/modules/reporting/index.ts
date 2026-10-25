import type { AppDeps } from '../../deps';
import { createExports } from './exports';
import { reportingRoutes, type ReportingParts } from './routes';
import { createReporting } from './service';
import { createStatementPdf } from './statement-pdf';

export function createReportingModule(deps: AppDeps): ReportingParts {
  const reporting = createReporting(deps);
  return {
    reporting,
    statementPdf: createStatementPdf(deps, reporting),
    exportCsv: createExports(deps, reporting),
  };
}

export { reportingRoutes, type ReportingParts };
