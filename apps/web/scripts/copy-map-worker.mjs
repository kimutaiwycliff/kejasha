// MapLibre GL 6 loads its tile worker from a URL; a bundler cannot follow that, so the worker is
// served as a static file (ADR-022). Runs before `next dev` and `next build`.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');
mkdirSync(out, { recursive: true });
// Versioned name: a new MapLibre never runs with an old cached worker.
copyFileSync(join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), join(out, `worker-${version}.mjs`));
console.log(`maplibre worker ${version} → public/maplibre`);
