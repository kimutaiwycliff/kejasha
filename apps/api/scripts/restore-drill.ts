/**
 * Restore drill: restore the newest backup into a scratch database, check invariants, drop it.
 * Exits non-zero if anything is off. `make restore-drill`
 */
import { restoreDrill } from '../src/ops/backup';
import { closeDeps, createDeps } from '../src/runtime';

const deps = createDeps();
try {
  const r = await restoreDrill(deps);
  console.log(JSON.stringify(r, null, 2));
  console.log(r.ok ? 'Restore drill PASSED' : 'Restore drill FAILED');
  process.exitCode = r.ok ? 0 : 1;
} finally {
  await closeDeps(deps);
}
