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
// Heavy PDF libraries with runtime asset/subpath resolution: never bundled, always loaded lazily
// (dynamic import) by the code paths that render/parse PDFs. Apps that call those paths (the API)
// depend on them directly; apps that only bundle the code (the worker) never load them.
const lazyOnly = ['@react-pdf/renderer', 'react', 'pdfjs-dist'];

await build({
  entryPoints: [join(appDir, entry)],
  outdir: join(appDir, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...new Set([...direct, ...optional, ...lazyOnly])].flatMap((d) => [d, `${d}/*`]),
  // Aliased so bundled code may import createRequire itself without a duplicate declaration.
  banner: {
    js: "import { createRequire as __kjCreateRequire } from 'node:module'; const require = __kjCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log(`built ${pkg.name} → ${join(appDir, 'dist')}`);
