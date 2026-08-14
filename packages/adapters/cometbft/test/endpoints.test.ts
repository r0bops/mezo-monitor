/**
 * Endpoint selection policy. This decides which node the indexer talks to, so
 * the failure modes matter: honouring a pin onto a dead node, or flapping
 * between dead nodes, both stop ingestion.
 */
import { describe, expect, it } from "vitest";
import {
  FAILURE_THRESHOLD,
  STALL_THRESHOLD_BLOCKS,
  chooseActive,
  isHealthy,
  type EndpointRow,
} from "../src/endpoints";

function ep(over: Partial<EndpointRow> = {}): EndpointRow {
  return {
    id: 1,
    label: "primary",
    rpc_url: "http://a:26657",
    ws_url: null,
    priority: 10,
    is_active: false,
    pinned: false,
    healthy: true,
    last_height: 1_000,
    latency_ms: 50,
    consecutive_failures: 0,
    last_error: null,
    ...over,
  };
}

describe("rate-limit-aware selection", () => {
  it("prefers an unthrottled endpoint over a higher-priority throttled one", () => {
    const throttled = ep({ id: 1, label: "primary", priority: 10, last_error: "rate limited (HTTP 429)" });
    const slow = ep({ id: 2, label: "backup", priority: 30, latency_ms: 500 });
    const choice = chooseActive([throttled, slow]);
    expect(choice.endpoint?.id).toBe(2);
  });

  it("a throttled endpoint is still healthy — it is not an outage", () => {
    const throttled = ep({ last_error: "rate limited (HTTP 429)" });
    expect(isHealthy(throttled, [throttled])).toBe(true);
  });

  it("falls back to the throttled endpoint when it is all there is", () => {
    const throttled = ep({ id: 1, last_error: "rate limited (HTTP 429)" });
    const dead = ep({ id: 2, label: "backup", priority: 20, healthy: false });
    const choice = chooseActive([throttled, dead]);
    expect(choice.endpoint?.id).toBe(1);
    expect(choice.reason).toContain("rate-limited");
  });

  it("returns to priority order once the throttle marker clears", () => {
    const recovered = ep({ id: 1, label: "primary", priority: 10, last_error: null });
    const slow = ep({ id: 2, label: "backup", priority: 30, latency_ms: 500 });
    expect(chooseActive([recovered, slow]).endpoint?.id).toBe(1);
  });
});

describe("isHealthy", () => {
  it("rejects an endpoint past the failure threshold", () => {
    const e = ep({ consecutive_failures: FAILURE_THRESHOLD });
    expect(isHealthy(e, [e])).toBe(false);
  });

  it("rejects a node that answers but has fallen behind", () => {
    // The dangerous case: it responds, so a naive check calls it healthy.
    const good = ep({ id: 1, last_height: 1_000 });
    const stalled = ep({ id: 2, last_height: 1_000 - STALL_THRESHOLD_BLOCKS - 1 });
    expect(isHealthy(stalled, [good, stalled])).toBe(false);
    expect(isHealthy(good, [good, stalled])).toBe(true);
  });

  it("tolerates a small lag", () => {
    const good = ep({ id: 1, last_height: 1_000 });
    const slightly = ep({ id: 2, last_height: 995 });
    expect(isHealthy(slightly, [good, slightly])).toBe(true);
  });
});

describe("chooseActive", () => {
  it("prefers the lowest priority number", () => {
    const a = ep({ id: 1, label: "primary", priority: 10 });
    const b = ep({ id: 2, label: "backup", priority: 20 });
    expect(chooseActive([b, a]).endpoint?.label).toBe("primary");
  });

  it("breaks priority ties on latency", () => {
    const slow = ep({ id: 1, label: "slow", priority: 10, latency_ms: 400 });
    const fast = ep({ id: 2, label: "fast", priority: 10, latency_ms: 40 });
    expect(chooseActive([slow, fast]).endpoint?.label).toBe("fast");
  });

  it("honours a healthy pin over a better-priority endpoint", () => {
    const primary = ep({ id: 1, label: "primary", priority: 10 });
    const pinned = ep({ id: 2, label: "backup", priority: 20, pinned: true });
    const choice = chooseActive([primary, pinned]);
    expect(choice.endpoint?.label).toBe("backup");
    expect(choice.reason).toContain("pinned");
  });

  it("overrides a pin that is unhealthy", () => {
    // Staying on a dead node because someone pinned it is worse than the
    // surprise of moving off it.
    const primary = ep({ id: 1, label: "primary", priority: 10 });
    const deadPin = ep({ id: 2, label: "backup", priority: 20, pinned: true, healthy: false });
    const choice = chooseActive([primary, deadPin]);
    expect(choice.endpoint?.label).toBe("primary");
    expect(choice.reason).toContain("unhealthy");
  });

  it("fails over when the active endpoint dies", () => {
    const dead = ep({ id: 1, label: "primary", priority: 10, healthy: false, is_active: true });
    const alive = ep({ id: 2, label: "backup", priority: 20 });
    expect(chooseActive([dead, alive]).endpoint?.label).toBe("backup");
  });

  it("holds position when nothing is healthy", () => {
    // Flapping between dead nodes achieves nothing; the drain retries and
    // recovers on its own once one returns.
    const a = ep({ id: 1, label: "primary", healthy: false, is_active: true });
    const b = ep({ id: 2, label: "backup", healthy: false });
    const choice = chooseActive([a, b]);
    expect(choice.endpoint?.label).toBe("primary");
    expect(choice.reason).toContain("no healthy endpoint");
  });

  it("returns null when no endpoints are configured", () => {
    expect(chooseActive([]).endpoint).toBeNull();
  });
});
