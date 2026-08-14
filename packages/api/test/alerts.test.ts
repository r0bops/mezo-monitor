/**
 * Tests for the RPC-free alert rules (indexer_stale, healthy_endpoints).
 *
 * These are the rules that must fire when the data source itself disappears —
 * the outage class where every other metric goes null. Each test forces the
 * condition, shows the event open, then clears it and shows the event resolve.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb, dropTestDb, seed } from "./setup.js";
import { evaluate, seedRules, type EvalInput } from "../src/alerts.js";
import { networkSummary } from "../src/queries.js";

const A = "aaaa000000000000000000000000000000000001";
const B = "bbbb000000000000000000000000000000000002";

let pool: pg.Pool;
let chainId: number;

/** Events for one rule, newest first, mirroring the API's ordering. */
async function eventsFor(ruleId: number) {
  const r = await pool.query<{ id: number; resolved_at: Date | null; body: string }>(
    `select id, resolved_at, body from alert_events
     where chain_id = $1 and rule_id = $2
     order by id desc limit 10`,
    [chainId, ruleId],
  );
  return r.rows;
}

async function ruleByMetric(metric: string) {
  const r = await pool.query<{ id: number; threshold: number }>(
    `select id, threshold from alert_rules where chain_id = $1 and metric = $2`,
    [chainId, metric],
  );
  return r.rows[0];
}

/**
 * Build the evaluator input the way runEvaluation does: everything derived from
 * the database plus explicit endpoint health, so a test can force either side.
 */
async function evalInput(overrides: Partial<EvalInput> = {}): Promise<EvalInput> {
  const n = await networkSummary(pool, chainId);
  const blockTimeS = n.avg_block_time_ms !== null ? n.avg_block_time_ms / 1000 : null;
  // staleAfterS mirrors indexerStall(): measured cadence * STALL_BLOCK_MULTIPLE,
  // floored at 60s.
  const staleAfterS = Math.max(60, (blockTimeS ?? 5) * 20);
  return {
    chainId,
    validators: [],
    indexerLag: null,
    avgBlockTimeS: blockTimeS,
    indexerStaleS:
      n.last_block_time !== null
        ? (Date.now() - new Date(n.last_block_time).getTime()) / 1000
        : null,
    staleAfterS,
    healthyEndpoints: 1,
    height: n.latest_indexed_height,
    ...overrides,
  };
}

beforeAll(async () => {
  pool = await createTestDb();
  // Fixtures use a fixed historical base time, so every seeded chain starts
  // "stale" by months — which is the condition under test.
  chainId = await seed(pool, { head: 100_000, count: 100, validators: [A, B] });
  await seedRules(pool, chainId);
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

describe("indexer_stale", () => {
  it("fires when the newest indexed block is too old — no RPC needed", async () => {
    const rule = await ruleByMetric("indexer_stale");
    expect(rule).toBeDefined(); // seeding landed the new default

    const { opened } = await evaluate(pool, await evalInput());
    expect(opened).toBeGreaterThan(0);

    const events = await eventsFor(rule!.id);
    expect(events).toHaveLength(1);
    expect(events[0].resolved_at).toBeNull();
    // The body must state the actual staleness, not a bare threshold hit.
    expect(events[0].body).toMatch(/no block indexed for \d+(h \d+m|m|s)/);
  });

  it("resolves once blocks are current again", async () => {
    const rule = await ruleByMetric("indexer_stale");
    // Simulate recovery: the newest block is seconds old (and the measured
    // cadence is 3s, well under any sane stall threshold).
    await pool.query(`update blocks set time = now() - interval '2 seconds' where chain_id = $1`, [
      chainId,
    ]);

    const { resolved } = await evaluate(pool, await evalInput());
    expect(resolved).toBe(1);
    const events = await eventsFor(rule!.id);
    expect(events[0].resolved_at).not.toBeNull();
  });

  it("honours the block-time-derived floor over the stored threshold", async () => {
    // A chain with a 60s cadence is not stale after 6 minutes of silence —
    // staleAfterS is 1200s there, so 360s must NOT fire even though the stored
    // threshold is 300.
    const { opened } = await evaluate(
      pool,
      await evalInput({ indexerStaleS: 360, staleAfterS: 1200 }),
    );
    expect(opened).toBe(0);

    // Past the derived floor it does fire.
    const { opened: opened2 } = await evaluate(
      pool,
      await evalInput({ indexerStaleS: 1300, staleAfterS: 1200 }),
    );
    expect(opened2).toBe(1);
    // Clean up: clear the open event so later describes start from zero.
    await evaluate(pool, await evalInput({ indexerStaleS: 0, staleAfterS: 1200 }));
  });
});

describe("healthy_endpoints", () => {
  it("fires when no configured endpoint is healthy", async () => {
    const rule = await ruleByMetric("healthy_endpoints");
    // Neutralise the stale event left over from seeding times.
    await pool.query(`update blocks set time = now() - interval '2 seconds' where chain_id = $1`, [
      chainId,
    ]);

    const { opened } = await evaluate(pool, await evalInput({ healthyEndpoints: 0 }));
    expect(opened).toBe(1);
    const events = await eventsFor(rule!.id);
    expect(events[0].resolved_at).toBeNull();
    expect(events[0].body).toContain("0 healthy RPC endpoint(s)");
  });

  it("stays quiet when a healthy endpoint remains — clean failover is not an event", async () => {
    await evaluate(pool, await evalInput({ healthyEndpoints: 0 })); // ensure open
    const { resolved, opened } = await evaluate(pool, await evalInput({ healthyEndpoints: 1 }));
    expect(opened).toBe(0);
    expect(resolved).toBe(1);
    const events = await eventsFor((await ruleByMetric("healthy_endpoints"))!.id);
    expect(events[0].resolved_at).not.toBeNull();
  });
});

describe("indexer_lag stays null-safe", () => {
  it("does not fire when lag is unknown (the RPC-blind case)", async () => {
    const rule = await ruleByMetric("indexer_lag");
    const { opened } = await evaluate(pool, await evalInput({ indexerLag: null }));
    const events = await eventsFor(rule!.id);
    expect(opened).toBe(0);
    expect(events).toHaveLength(0);
  });
});
