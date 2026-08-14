/**
 * Tests for the block_signatures retention sweep.
 *
 * The property that must hold: after a sweep, everything the live queries read
 * is still in the raw table, everything older is gone, and the daily
 * aggregates add up to exactly what was deleted — once, no matter how many
 * times the sweep re-runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@mezo/core";
// The API test harness owns the throwaway database; the adapter has no reason
// to duplicate it.
import { createTestDb, dropTestDb, seed } from "../../../api/test/setup.js";
import { runRetentionSweep } from "../src/retention.js";

const A = "aaaa000000000000000000000000000000000001";
const B = "bbbb000000000000000000000000000000000002";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let chainId: number;

const HEAD = 1_000;

beforeAll(async () => {
  pool = await createTestDb();
  db = drizzle(pool, { schema });
  chainId = await seed(pool, { head: HEAD, count: HEAD, validators: [A, B] });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

async function counts() {
  const raw = await pool.query<{ n: number; lo: number }>(
    `select count(*)::int as n, coalesce(min(height), 0)::int as lo from block_signatures where chain_id = $1`,
    [chainId],
  );
  const daily = await pool.query<{ slots: number; signed: number }>(
    `select coalesce(sum(slots), 0)::int as slots, coalesce(sum(signed), 0)::int as signed
     from validator_signing_daily where chain_id = $1`,
    [chainId],
  );
  return { rawN: raw.rows[0].n, rawMin: raw.rows[0].lo, ...daily.rows[0] };
}

describe("runRetentionSweep", () => {
  it("keeps the trailing window raw and rolls up the rest", async () => {
    const retain = 200;
    const r = await runRetentionSweep(db, chainId, retain);
    expect(r.cutoff).toBe(HEAD - retain);

    const c = await counts();
    // Every remaining raw row is above the cutoff.
    expect(c.rawMin).toBe(HEAD - retain + 1);
    // 2 validators * (retain - 1) signed slots below head (head+1 doesn't exist).
    expect(c.rawN).toBe(2 * retain);

    // What was deleted equals what the daily table now holds. B missed nothing
    // and A missed nothing (seed defaults), so signed == slots.
    expect(c.slots).toBe(2 * (HEAD - retain));
    expect(c.signed).toBe(c.slots);
  });

  it("is idempotent — a second sweep changes nothing", async () => {
    const before = await counts();
    const r = await runRetentionSweep(db, chainId, 200);
    expect(r.deleted).toBe(0);
    const after = await counts();
    expect(after).toEqual(before);
  });

  it("extends the aggregates when head advances", async () => {
    // Simulate 100 new blocks at head + 100, then sweep with the same depth.
    const base = Date.UTC(2026, 0, 1);
    for (let h = HEAD + 1; h <= HEAD + 100; h++) {
      const time = new Date(base + h * 3_000);
      await pool.query(
        `insert into blocks (chain_id, height, hash, time, proposer_address, validator_count, signature_count, tx_count)
         values ($1, $2, $3, $4, $5, 2, 1, 0)`,
        [chainId, h, `hash-${h}`, time, A],
      );
      // B misses every new block — so signed < slots in the new aggregate.
      for (const [v, signed] of [[A, true], [B, false]] as const) {
        await pool.query(
          `insert into block_signatures (chain_id, height, validator_address, signed, time)
           values ($1, $2, $3, $4, $5)`,
          [chainId, h, v, signed, time],
        );
      }
    }

    const before = await counts();
    const r = await runRetentionSweep(db, chainId, 200);
    expect(r.deleted).toBe(200); // 100 heights * 2 validators, from (800, 900]
    const after = await counts();
    expect(after.slots).toBe(before.slots + 200);
    expect(after.signed).toBe(before.signed + 200); // both signed in the rolled stretch
    expect(after.rawMin).toBe(HEAD + 100 - 200 + 1);

    // The new stretch (where B misses everything) is still raw — its misses
    // must stay queryable until it ages past the retain depth.
    const misses = await pool.query<{ n: number }>(
      `select count(*)::int as n from block_signatures
       where chain_id = $1 and signed = false`,
      [chainId],
    );
    expect(misses.rows[0].n).toBe(100);
  });

  it("drops gap-repaired rows below the watermark without re-counting", async () => {
    const pre = await counts();
    // A gap repair re-inserts signatures for a height that was already rolled
    // up (well below the cutoff/watermark).
    const base = Date.UTC(2026, 0, 1);
    await pool.query(
      `insert into block_signatures (chain_id, height, validator_address, signed, time)
       values ($1, $2, $3, true, $4)`,
      [chainId, 50, A, new Date(base + 50 * 3_000)],
    );
    const r = await runRetentionSweep(db, chainId, 200);
    expect(r.deleted).toBe(1);
    expect(await counts()).toEqual(pre); // deleted, not re-counted
  });
});
