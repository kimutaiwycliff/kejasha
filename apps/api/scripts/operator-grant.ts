/**
 * Grant (or revoke with --revoke) Kejasha platform-operator access to an existing user by email.
 * Usage: pnpm --filter @kejasha/api operator:grant someone@example.com [--revoke] [--note "why"]
 */
import { eq, schema } from '@kejasha/db';
import { closeDeps, createDeps } from '../src/runtime';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.toLowerCase();
const revoke = args.includes('--revoke');
const note = args.includes('--note') ? args[args.indexOf('--note') + 1] : undefined;
if (!email) {
  console.error('Usage: operator:grant <email> [--revoke] [--note "why"]');
  process.exit(2);
}
const deps = createDeps();
const { db } = deps;
try {
  const [user] = await db.owner.select().from(schema.user).where(eq(schema.user.email, email));
  if (!user) throw new Error(`No user with email ${email}; they must sign up first.`);
  if (revoke) {
    await db.owner
      .delete(schema.platformOperator)
      .where(eq(schema.platformOperator.userId, user.id));
    console.log(`Revoked operator access for ${email}`);
  } else {
    await db.owner
      .insert(schema.platformOperator)
      .values({ userId: user.id, note: note ?? null })
      .onConflictDoNothing();
    console.log(`Granted operator access to ${email}`);
  }
} finally {
  await closeDeps(deps);
}
