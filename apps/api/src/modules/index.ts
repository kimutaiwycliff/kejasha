import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps';
import { platformRoutes } from './platform';

/** Module registry (ADR-001). Each module is a Fastify plugin receiving the shared deps. */
export async function registerModules(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(platformRoutes, deps);
}
