/**
 * Tests for validator local identity (label / watched) and the multi-horizon
 * metrics. Identity must survive the indexer's validator-set sync untouched —
 * it lives in its own columns, never written by ingestion.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb, dropTestDb, seed } from "./setup.js";
import { blocksPerBucket, metricStats, setValidatorIdentity, validatorMetrics } from "../src/queries.js";

const A = "aaaa000000000000000000000000000000000001";
const B = "bbbb000000000000000000000000000000000002";

let pool: pg.Pool;
let chainId: number;

beforeAll(async () => {
  pool = await createTestDb();
  chainId = await seed(pool, { head: 100_000, count: 500, validators: [A, B] });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

describe("validator identity", () => {
  it("sets and clears a label", async () => {
    const row = await setValidatorIdentity(pool, chainId, A, { label: "Ours" });
    expect(row?.label).toBe("Ours");
    expect(row?.watched).toBe(false);

    // The metrics query surfaces it wherever validators are listed.
    const rows = await validatorMetrics(pool, chainId);
    expect(rows.find((r) => r.address === A)?.label).toBe("Ours");
    expect(rows.find((r) => r.address === B)?.label).toBeNull();

    // null clears; blank strings clear too (a whitespace-only label is empty).
    expect((await setValidatorIdentity(pool, chainId, A, { label: null }))?.label).toBeNull();
    expect((await setValidatorIdentity(pool, chainId, A, { label: "  " }))?.label).toBeNull();
  });

  it("flags a watched validator independently of the label", async () => {
    const row = await setValidatorIdentity(pool, chainId, B, { watched: true });
    expect(row?.watched).toBe(true);
    expect(row?.label).toBeNull();

    const rows = await validatorMetrics(pool, chainId);
    expect(rows.find((r) => r.address === B)?.watched).toBe(true);
  });

  it("404-equivalent: unknown address returns null, not an error", async () => {
    expect(await setValidatorIdentity(pool, chainId, "ffff00", { label: "x" })).toBeNull();
  });

  it("rejects an empty patch without touching the row", async () => {
    expect(await setValidatorIdentity(pool, chainId, A, {})).toBeNull();
    const rows = await validatorMetrics(pool, chainId);
    expect(rows.find((r) => r.address === A)?.watched).toBe(false);
  });
});

describe("metric horizons", () => {
  it("reports stats over the requested horizon", async () => {
    // Fixtures are historical (seeded at a fixed past time), so a 24h window
    // is empty and a 30d one also is — but the wider horizon must still
    // execute and report an honest zero, not an error.
    const day = await metricStats(pool, chainId, 24);
    expect(day.blocks).toBe(0);
    expect(day.avg_block_time_s).toBeNull();

    // A horizon long enough to contain the fixtures reports them.
    const wide = await metricStats(pool, chainId, 24 * 3650);
    expect(wide.blocks).toBe(500);
    expect(wide.avg_block_time_s).toBeCloseTo(3, 0);
  });

  it("buckets hourly for short horizons and daily for long ones", async () => {
    expect((await blocksPerBucket(pool, chainId, 24)).unit).toBe("hour");
    expect((await blocksPerBucket(pool, chainId, 48)).unit).toBe("hour");
    expect((await blocksPerBucket(pool, chainId, 168)).unit).toBe("day");
    expect((await blocksPerBucket(pool, chainId, 720)).unit).toBe("day");

    // All fixtures share a handful of hours, so the wide bucketing counts
    // them in one day bucket.
    const wide = await blocksPerBucket(pool, chainId, 24 * 3650);
    expect(wide.unit).toBe("day");
    expect(wide.rows.reduce((a, r) => a + r.n, 0)).toBe(500);
  });
});
