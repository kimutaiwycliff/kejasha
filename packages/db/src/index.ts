export { createDb, pingDb, withAdmin, withTenant } from './client';
export type { Database, Db, DbOptions, Schema, TenantContext, Tx } from './client';
export * as schema from './schema';
// Single drizzle instance for the whole repo: other packages import query helpers from here.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
export { pgError, PG, type PgErrorInfo } from './errors';
