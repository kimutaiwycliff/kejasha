import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * ADR-016: the production domain may only appear in `.env*`, docs and deploy config.
 * The literal is assembled from parts so this guard does not trip itself.
 */
const PRODUCTION_DOMAIN = ['kejasha', 'co', 'ke'].join('.');
const ALLOWED = [/^\.env/, /^docs\//, /^CLAUDE\.md$/, /^README\.md$/, /^infra\/deploy\//];

it('production domain never appears in source', () => {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f && !ALLOWED.some((re) => re.test(f)));

  const offenders = files.filter((f) => {
    try {
      return readFileSync(join(root, f), 'utf8').includes(PRODUCTION_DOMAIN);
    } catch {
      return false;
    }
  });
  expect(offenders).toEqual([]);
});
