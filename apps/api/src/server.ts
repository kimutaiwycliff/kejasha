import { buildApp } from './app';
import { closeDeps, createDeps } from './runtime';

const deps = createDeps();
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDeps(deps);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: deps.config.api.port });
