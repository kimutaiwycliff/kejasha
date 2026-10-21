import { randomUUID } from 'node:crypto';
import { eq, schema, sql, withTenant } from '@kejasha/db';
import { createTestDb, newOrgId } from '@kejasha/db/testing';
import { QueueEvents, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { enqueueInTx } from '../src/outbox';
import { relayOnce } from '../src/relay';
import { createQueues, createTopicWorker } from '../src/worker';

const db = createTestDb();
const redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
const connection = redis as unknown as ConnectionOptions;
afterAll(async () => {
  await db.close();
  redis.disconnect();
});

const countOutbox = async (orgId: string) =>
  (await db.pools.owner.query('SELECT count(*)::int AS n FROM outbox WHERE org_id = $1', [orgId]))
    .rows[0].n as number;

describe('transactional outbox', () => {
  it('commits the business row and the event together', async () => {
    const orgId = newOrgId();
    await withTenant(db, { orgId }, async (tx) => {
      await tx.insert(schema.rlsProbe).values({ orgId, label: 'created' });
      await enqueueInTx(tx, {
        orgId,
        topic: 'default.probe_created',
        payload: { label: 'created' },
      });
    });
    const probes = await db.owner
      .select()
      .from(schema.rlsProbe)
      .where(eq(schema.rlsProbe.orgId, orgId));
    expect(probes).toHaveLength(1);
    expect(await countOutbox(orgId)).toBe(1);
  });

  it('rolls back both when the transaction fails', async () => {
    const orgId = newOrgId();
    await expect(
      withTenant(db, { orgId }, async (tx) => {
        await tx.insert(schema.rlsProbe).values({ orgId, label: 'doomed' });
        await enqueueInTx(tx, { orgId, topic: 'default.probe_created', payload: {} });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const probes = await db.owner
      .select()
      .from(schema.rlsProbe)
      .where(eq(schema.rlsProbe.orgId, orgId));
    expect(probes).toHaveLength(0);
    expect(await countOutbox(orgId)).toBe(0);
  });

  it('ignores a duplicate dedupeKey', async () => {
    const orgId = newOrgId();
    const dedupeKey = `invoice.issued:${randomUUID()}`;
    for (let i = 0; i < 2; i++) {
      await withTenant(db, { orgId }, (tx) =>
        enqueueInTx(tx, { orgId, topic: 'notifications.invoice_issued', payload: {}, dedupeKey }),
      );
    }
    expect(await countOutbox(orgId)).toBe(1);
  });

  it("scopes dedupe per org and never exposes another org's keys", async () => {
    const [orgA, orgB] = [newOrgId(), newOrgId()];
    const dedupeKey = `shared:${randomUUID()}`;
    for (const orgId of [orgA, orgB]) {
      await withTenant(db, { orgId }, (tx) =>
        enqueueInTx(tx, { orgId, topic: 'default.x', payload: {}, dedupeKey }),
      );
    }
    expect(await countOutbox(orgA)).toBe(1);
    expect(await countOutbox(orgB)).toBe(1);

    const seenByB = await withTenant(db, { orgId: orgB }, (tx) =>
      tx.execute(sql`SELECT org_id FROM outbox WHERE dedupe_key = ${dedupeKey}`),
    );
    expect(seenByB.rows).toEqual([{ org_id: orgB }]);
  });

  it('cannot enqueue an event for another org', async () => {
    const [orgA, orgB] = [newOrgId(), newOrgId()];
    await expect(
      withTenant(db, { orgId: orgA }, (tx) =>
        enqueueInTx(tx, { orgId: orgB, topic: 'default.x', payload: {} }),
      ),
    ).rejects.toThrow();
  });
});

describe('relay', () => {
  it('delivers each committed event exactly once, even with concurrent relays', async () => {
    const prefix = `t-${randomUUID()}`;
    const queues = createQueues(connection, prefix);
    const orgId = newOrgId();
    await withTenant(db, { orgId }, async (tx) => {
      for (let i = 0; i < 25; i++)
        await enqueueInTx(tx, { orgId, topic: 'default.n', payload: { i } });
    });

    // Drain everything pending (other tests' rows included), with two relays racing.
    let total = 0;
    for (;;) {
      const [a, b] = await Promise.all([
        relayOnce(db, queues, { batchSize: 10 }),
        relayOnce(db, queues, { batchSize: 10 }),
      ]);
      total += a + b;
      if (a + b === 0) break;
    }
    expect(total).toBeGreaterThanOrEqual(25);

    const jobs = await queues.default.getJobs(['waiting', 'delayed', 'active', 'completed']);
    const mine = jobs.filter((j) => j.data.orgId === orgId);
    expect(mine).toHaveLength(25);
    expect(new Set(mine.map((j) => j.data.payload.i)).size).toBe(25);

    const { rows } = await db.pools.owner.query(
      'SELECT count(*)::int AS n FROM outbox WHERE org_id = $1 AND dispatched_at IS NULL',
      [orgId],
    );
    expect(rows[0].n).toBe(0);
    expect(await relayOnce(db, queues)).toBe(0);

    // Simulated crash after add but before marking: re-adding the same outbox id is a no-op.
    const first = mine[0]!;
    await db.owner.execute(
      sql`UPDATE outbox SET dispatched_at = NULL WHERE id = ${BigInt(first.data.outboxId)}`,
    );
    await relayOnce(db, queues);
    const again = (
      await queues.default.getJobs(['waiting', 'delayed', 'active', 'completed'])
    ).filter((j) => j.data.orgId === orgId);
    expect(again).toHaveLength(25);

    await Promise.all(Object.values(queues).map((q) => q.close()));
  });
});

describe('worker', () => {
  it('moves a job that exhausts its retries to the dead-letter queue', async () => {
    const prefix = `t-${randomUUID()}`;
    const queues = createQueues(connection, prefix);
    const { worker, deadLetter } = createTopicWorker(
      'default',
      { 'default.always_fails': async () => Promise.reject(new Error('handler exploded')) },
      connection,
      { prefix, concurrency: 1 },
    );
    const events = new QueueEvents('dead-letter', { connection, prefix });
    await events.waitUntilReady();
    const deadLettered = new Promise<void>((resolve) => events.once('waiting', () => resolve()));

    await queues.default.add(
      'default.always_fails',
      { outboxId: '0', orgId: null, topic: 'default.always_fails', payload: {} },
      { attempts: 2, backoff: { type: 'fixed', delay: 10 }, jobId: 'dlq-probe' },
    );
    await deadLettered;

    const [dead] = await deadLetter.getJobs(['waiting']);
    expect(dead?.data).toMatchObject({
      queue: 'default',
      jobId: 'dlq-probe',
      error: 'handler exploded',
    });

    await worker.close();
    await events.close();
    await deadLetter.close();
    await Promise.all(Object.values(queues).map((q) => q.close()));
  });

  it('fails loudly on an unknown topic', async () => {
    const prefix = `t-${randomUUID()}`;
    const queues = createQueues(connection, prefix);
    const { worker, deadLetter } = createTopicWorker('default', {}, connection, { prefix });
    const failed = new Promise<string>((resolve) =>
      worker.once('failed', (_job, err) => resolve(err.message)),
    );
    await queues.default.add(
      'default.nobody_listens',
      { outboxId: '0', orgId: null, topic: 'x', payload: {} },
      { attempts: 1 },
    );
    expect(await failed).toMatch(/No handler for topic/);
    await worker.close();
    await deadLetter.close();
    await Promise.all(Object.values(queues).map((q) => q.close()));
  });
});
