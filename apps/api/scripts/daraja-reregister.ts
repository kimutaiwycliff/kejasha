/**
 * Re-register C2B URLs for every active channel with credentials (after a domain move, ADR-016).
 *   make daraja-reregister
 */
import { schema } from '@kejasha/db';
import { systemCtx } from '../src/lib/ctx';
import { createPayments } from '../src/modules/payments';
import { closeDeps, createDeps } from '../src/runtime';

const deps = createDeps();
const orgs = await deps.db.owner.select({ id: schema.organization.id }).from(schema.organization);
const results = await createPayments(deps).channels.reregisterAll(orgs.map((o) => systemCtx(o.id)));
for (const r of results)
  console.log(
    `${r.ok ? 'ok    ' : 'FAILED'} org=${r.orgId} channel=${r.channelId}${r.error ? ` — ${r.error}` : ''}`,
  );
console.log(
  `${results.filter((r) => r.ok).length}/${results.length} channels registered against ${deps.config.domain.apiUrl}`,
);
await closeDeps(deps);
if (results.some((r) => !r.ok)) process.exit(1);
