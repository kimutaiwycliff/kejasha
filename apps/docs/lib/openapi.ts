import { createOpenAPI } from 'fumadocs-openapi/server';

/** The API contract (ADR-002). The id must match scripts/generate-api.mjs's input. */
export const openapi = createOpenAPI({ input: ['../api/openapi.json'] });
