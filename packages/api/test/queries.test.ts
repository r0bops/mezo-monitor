/**
 * Tests for the derived metrics. These are the calculations everything else
 * depends on and the ones that would go wrong silently — a miscounted window
 * still renders as a confident percentage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createTestDb, dropTestDb, seed } from "./setup.js";
import {
  LONG_WINDOW,
  SHORT_WINDOW,
  networkSummary,
  pipelineBlocks,
  proposedTotal,
  signingSlots,
  validatorMetrics,
} from "../src/queries.js";

const A = "aaaa000000000000000000000000000000000001";
const B = "bbbb000000000000000000000000000000000002";
const C = "cccc000000000000000000000000000000000003";

const HEAD = 100_000;

let pool: pg.Pool;
let chainId: number;

beforeAll(async () => {
  pool = await createTestDb();
  chainId = await seed(pool, {
    head: HEAD,
    count: 1_200, // > SHORT_WINDOW, < LONG_WINDOW: exercises the partial case
    validators: [A, B, C],
    monikers: { [A]: "Alpha Node", [B]: "Beta Node", [C]: "Gamma Node" },
    missed: {
      // B missed the four most recent blocks -> current streak of 4.
      [B]: [HEAD, HEAD - 1, HEAD - 2, HEAD - 3],
      // C missed some older blocks but signed since -> streak 0.
      [C]: [HEAD - 500, HEAD - 501],
    },
    absent: {
      // C was outside the set for a stretch beyond the short window.
      [C]: Array.from({ length: 100 }, (_, i) => HEAD - 1_100 + i),
    },
    // A proposes every block in the short window, so share is unambiguous.
    proposer: () => A,
  });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

describe("validatorMetrics", () => {
  it("counts slots only within each window", async () => {
    const rows = await validatorMetrics(pool, chainId);
    const a = rows.find((r) => r.address === A)!;

    expect(a.slots_short).toBe(SHORT_WINDOW);
    // Only 1,200 blocks exist, so the long window cannot be full.
    expect(a.slots_long).toBe(1_200);
    expect(a.slots_long).toBeLessThan(LONG_WINDOW);
  });

  it("computes uptime over slots actually present", async () => {
    const rows = await validatorMetrics(pool, chainId);
    const a = rows.find((r) => r.address === A)!;
    const b = rows.find((r) => r.address === B)!;

    // A signed everything.
    expect(a.signed_short).toBe(a.slots_short);

    // B missed exactly 4 of the last 1,000.
    expect(b.slots_short - b.signed_short).toBe(4);
    expect((b.signed_short / b.slots_short) * 100).toBeCloseTo(99.6, 5);
  });

  it("counts a missed streak only since the last signed block", async () => {
    const rows = await validatorMetrics(pool, chainId);
    const a = rows.find((r) => r.address === A)!;
    const b = rows.find((r) => r.address === B)!;
    const c = rows.find((r) => r.address === C)!;

    expect(b.missed_streak).toBe(4); // the four most recent
    expect(a.missed_streak).toBe(0);
    // C's misses are old and it has signed since, so the streak is clear.
    expect(c.missed_streak).toBe(0);
  });

  it("excludes heights where the validator was not in the set", async () => {
    const rows = await validatorMetrics(pool, chainId);
    const c = rows.find((r) => r.address === C)!;
    const a = rows.find((r) => r.address === A)!;

    // C has 100 fewer slots than A across the long window (the absent stretch).
    expect(a.slots_long - c.slots_long).toBe(100);
  });

  it("attributes proposer share to the actual proposer", async () => {
    const rows = await validatorMetrics(pool, chainId);
    const total = await proposedTotal(pool, chainId);
    const a = rows.find((r) => r.address === A)!;
    const b = rows.find((r) => r.address === B)!;

    expect(total).toBe(SHORT_WINDOW);
    expect(a.proposed_short).toBe(SHORT_WINDOW);
    expect((a.proposed_short / total) * 100).toBeCloseTo(100, 5);
    expect(b.proposed_short).toBe(0);
  });
});

describe("networkSummary", () => {
  it("reports long-window coverage, not total row count", async () => {
    const n = await networkSummary(pool, chainId);

    // 1,200 rows exist and all fall inside the trailing long window.
    expect(n.blocks_indexed).toBe(1_200);
    expect(n.blocks_in_long_window).toBe(1_200);
    // The window is not complete, which is what suppresses a false "normal".
    expect(n.blocks_in_long_window).toBeLessThan(LONG_WINDOW);
  });

  it("derives average block time from the trailing blocks", async () => {
    const n = await networkSummary(pool, chainId);
    // Fixtures are spaced exactly 3s apart.
    expect(n.avg_block_time_ms).toBeCloseTo(3_000, 0);
  });

  it("reports signing power online for the trailing 100 blocks", async () => {
    const n = await networkSummary(pool, chainId);
    expect(n.signing_power_online).not.toBeNull();
    expect(n.signing_power_online!).toBeGreaterThan(0);
    expect(n.signing_power_online!).toBeLessThanOrEqual(100);
  });
});

describe("pipelineBlocks", () => {
  it("returns the newest blocks oldest-first with proposer identity", async () => {
    const blocks = await pipelineBlocks(pool, chainId, 5);
    expect(blocks).toHaveLength(5);
    // oldest → newest
    expect(blocks[0].height).toBeLessThan(blocks[4].height);
    expect(blocks[4].height).toBe(HEAD);
    // the seeded round-robin proposer maps onto a validator moniker
    const withMoniker = blocks.find((b) => b.moniker !== null);
    expect(withMoniker).toBeDefined();
    // round is null for fixture blocks (never set) — rendered as unknown,
    // never defaulted to 0
    expect(blocks.every((b) => b.round === null)).toBe(true);
  });
});

describe("signingSlots", () => {
  it("returns null for heights outside the set, false for misses", async () => {
    const slots = await signingSlots(pool, chainId, C, 1_200);
    const absent = slots.filter((s) => s.signed === null);
    const missed = slots.filter((s) => s.signed === false);

    expect(absent).toHaveLength(100);
    expect(missed).toHaveLength(2);
    // Newest first, so the heatmap reads top-left as most recent.
    expect(slots[0].height).toBeGreaterThan(slots[1].height);
  });
});

describe("gap coverage", () => {
  it("does not fabricate blocks for holes in the range", async () => {
    // A second chain seeded with deliberate holes.
    const holed = await seed(pool, {
      head: 50_000,
      count: 100,
      validators: [A],
      holes: [49_990, 49_991, 49_950],
    });

    const n = await networkSummary(pool, holed);
    expect(n.blocks_indexed).toBe(97); // 100 minus 3 holes

    const missing = await pool.query<{ n: number }>(
      `select count(*)::int as n
       from generate_series($2::int, $3::int) g
       where not exists (select 1 from blocks b where b.chain_id = $1 and b.height = g)`,
      [holed, 49_901, 50_000],
    );
    expect(missing.rows[0].n).toBe(3);
  });
});
