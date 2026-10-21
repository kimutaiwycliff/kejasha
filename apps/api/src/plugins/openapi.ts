import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createJsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

export const CONTRACT_VERSION = '0.1.0';

/** OpenAPI 3.1 generated from the Zod route schemas (ADR-002); Scalar UI at /docs. */
export const openapiPlugin = fp(async (app: FastifyInstance) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Kejasha API',
        version: CONTRACT_VERSION,
        description:
          'Property management, rent collection and short-stay management for Kenya. ' +
          'Money is integer cents (int64). Business dates are Africa/Nairobi. ' +
          'Every write accepts an Idempotency-Key header. Errors are RFC 9457 problem+json.',
      },
      // Relative: clients set their base URL from config (ADR-016); keeps the committed spec env-free.
      servers: [{ url: '/' }],
      tags: [
        { name: 'platform', description: 'Health, metadata and API documentation' },
        {
          name: 'identity',
          description: 'Sign-up, sign-in, sessions, organizations, members, invitations',
        },
        { name: 'accounts', description: 'Client landlords, properties and units' },
        {
          name: 'leasing',
          description: 'Tenants, leases, charges, meters, invoices, arrears and deposits',
        },
        {
          name: 'payments',
          description: 'Payment channels, payments, matching, receipts, STK Push, statement import',
        },
        {
          name: 'short-stay',
          description:
            'Rates, quotes, guests, bookings, calendar & blocks, read-only iCal import, unit expenses, profit',
        },
        {
          name: 'daraja',
          description: 'Safaricom callbacks (public, authenticated by the channel token)',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Session token from sign-in (`token` in the response). Used by Android.',
          },
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'kj.session_token',
            description: 'HTTP-only session cookie set on sign-in. Used by the web app.',
          },
        },
      },
    },
    transform: createJsonSchemaTransform({ skipList: ['/openapi.json', '/docs', '/docs/*'] }),
    transformObject: (doc) => pruneUnreferenced(jsonSchemaTransformObject(doc)),
  });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(scalar, { routePrefix: '/docs' });
});

type Spec = ReturnType<typeof jsonSchemaTransformObject>;

/**
 * The Zod registry emits every named schema (plus `*Input` twins) whether or not a route uses it.
 * Drop components no operation reaches so generated clients carry no dead models.
 */
function pruneUnreferenced(doc: Spec): Spec {
  const schemas = (doc as { components?: { schemas?: Record<string, unknown> } }).components
    ?.schemas;
  if (!schemas) return doc;
  const reachable = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/')) {
        const name = v.slice('#/components/schemas/'.length);
        if (!reachable.has(name)) {
          reachable.add(name);
          visit(schemas[name]);
        }
      } else visit(v);
    }
  };
  visit((doc as { paths?: unknown }).paths);
  for (const name of Object.keys(schemas)) if (!reachable.has(name)) delete schemas[name];
  return doc;
}
