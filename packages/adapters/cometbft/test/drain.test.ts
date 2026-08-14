/**
 * Regression test for the block-loss bug.
 *
 * The original handlers assigned `lastSeen = h` and ingested only `h`, so any
 * multi-block jump — a WebSocket hiccup, or simply two blocks landing between
 * 5s polls — dropped the heights in between permanently. Block 11104145 was
 * lost this way in production.
 *
 * The drain logic is reproduced here rather than imported because `indexer.ts`
 * builds it inside `runIndexer` over live database and RPC handles. What is
 * under test is the cursor discipline: never advance past a height that has not
 * been ingested.
 */
import { describe, expect, it } from "vitest";

const LIVE_DRAIN_BATCH = 500;

/** Mirrors the drain in packages/adapters/cometbft/src/indexer.ts. */
function makeDrain(opts: { start: number; fail?: Set<number> }) {
  const ingested: number[] = [];
  let lastSeen = opts.start;
  let draining = false;

  const ingestHeight = async (h: number): Promise<boolean> => {
    if (h < 1) return false;
    if (opts.fail?.has(h)) return false;
    ingested.push(h);
    return true;
  };

  const drainTo = async (target: number): Promise<void> => {
    if (draining || target <= lastSeen) return;
    draining = true;
    try {
      let budget = LIVE_DRAIN_BATCH;
      while (lastSeen < target && budget-- > 0) {
        const next = lastSeen + 1;
        if (!(await ingestHeight(next))) return;
        lastSeen = next;
      }
    } finally {
      draining = false;
    }
  };

  return { drainTo, ingested, cursor: () => lastSeen };
}

describe("live drain", () => {
  it("ingests every height across a multi-block jump", async () => {
    const d = makeDrain({ start: 100 });
    await d.drainTo(105); // five blocks arrived between observations

    expect(d.ingested).toEqual([101, 102, 103, 104, 105]);
    expect(d.cursor()).toBe(105);
  });

  it("ingests the very first block after startup", async () => {
    // runIndexer starts the cursor at head-1 so head itself is ingested;
    // starting at head is what lost block 11104145.
    const head = 11_104_145;
    const d = makeDrain({ start: head - 1 });
    await d.drainTo(head);

    expect(d.ingested).toContain(head);
  });

  it("does not advance the cursor past a failed height", async () => {
    const d = makeDrain({ start: 200, fail: new Set([203]) });
    await d.drainTo(210);

    expect(d.ingested).toEqual([201, 202]);
    // 202 ingested, 203 failed: the cursor must stop so the next tick retries.
    expect(d.cursor()).toBe(202);
  });

  it("retries the failed height on a later tick", async () => {
    const fail = new Set([203]);
    const d = makeDrain({ start: 200, fail });
    await d.drainTo(205);
    expect(d.cursor()).toBe(202);

    fail.delete(203); // RPC recovers
    await d.drainTo(205);

    expect(d.ingested).toEqual([201, 202, 203, 204, 205]);
    expect(d.cursor()).toBe(205);
  });

  it("ignores targets at or behind the cursor", async () => {
    const d = makeDrain({ start: 300 });
    await d.drainTo(300);
    await d.drainTo(299);

    expect(d.ingested).toEqual([]);
    expect(d.cursor()).toBe(300);
  });

  it("yields after a batch instead of blocking on a long outage", async () => {
    const d = makeDrain({ start: 0 });
    await d.drainTo(LIVE_DRAIN_BATCH + 250);

    expect(d.ingested).toHaveLength(LIVE_DRAIN_BATCH);
    expect(d.cursor()).toBe(LIVE_DRAIN_BATCH);

    await d.drainTo(LIVE_DRAIN_BATCH + 250); // next tick continues
    expect(d.cursor()).toBe(LIVE_DRAIN_BATCH + 250);
  });

  it("leaves no gaps across many random jumps", async () => {
    const d = makeDrain({ start: 1_000 });
    let h = 1_000;
    for (const jump of [3, 1, 7, 2, 1, 12, 4, 1, 9]) {
      h += jump;
      await d.drainTo(h);
    }

    const expected = Array.from({ length: h - 1_000 }, (_, i) => 1_001 + i);
    expect(d.ingested).toEqual(expected);
  });
});
