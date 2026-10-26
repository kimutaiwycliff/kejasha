/** One backup now (same code as the nightly job). `make backup` */
import { runBackup } from '../src/ops/backup';
import { closeDeps, createDeps } from '../src/runtime';

const deps = createDeps();
try {
  const r = await runBackup(deps);
  console.log(
    `Backed up to ${r.key} (${(r.bytes / 1024).toFixed(1)} KiB); pruned ${r.pruned} old dump(s).`,
  );
} finally {
  await closeDeps(deps);
}
