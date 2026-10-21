// Bundles an app's TS entry into dist/. Workspace packages ship as TS source, so they and their
// own third-party deps are bundled; only the app's DIRECT third-party deps stay external, because
// those are guaranteed to be installed next to the app (locally and by `pnpm deploy` in Docker).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const [appDir, entry] = process.argv.slice(2);
if (!appDir || !entry) throw new Error('usage: build-app.mjs <appDir> <entry>');

const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
const direct = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@kejasha/'));
// Optional native bindings that libraries require lazily inside try/catch.
const optional = ['pg-native'];

await build({
  entryPoints: [join(appDir, entry)],
  outdir: join(appDir, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...direct, ...optional].flatMap((d) => [d, `${d}/*`]),
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log(`built ${pkg.name} → ${join(appDir, 'dist')}`);
