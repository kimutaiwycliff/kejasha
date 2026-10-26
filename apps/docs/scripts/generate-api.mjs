// API reference pages from the contract (ADR-020): one page per operation, grouped by tag.
// Runs before every build, so the reference can never drift from apps/api/openapi.json.
import { rm } from 'node:fs/promises';
import { createOpenAPI } from 'fumadocs-openapi/server';
import { generateFiles } from 'fumadocs-openapi';

const out = './content/docs/api';
await rm(out, { recursive: true, force: true });
await generateFiles({
  input: createOpenAPI({ input: ['../api/openapi.json'] }),
  output: out,
  per: 'operation',
  groupBy: 'tag',
  includeDescription: true,
  meta: true,
});
console.log(`API reference generated in ${out}`);
