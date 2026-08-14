/**
 * RPC endpoint health probing and selection.
 *
 * The indexer owns this rather than the API, because it is the component that
 * must stay connected: if the API drove failover, an API outage would strand
 * indexing on a dead node.
 *
 * Selection is pure (`chooseActive`) so the policy can be tested without a
 * database or a network.
 */

/** A node that answers but has stopped advancing is worse than one that is
 * plainly down — it looks fine while producing nothing. Treat it as unhealthy
 * once it trails the best-known head by more than this. */
export const STALL_THRESHOLD_BLOCKS = 100;
/** Consecutive probe failures before an endpoint is considered unhealthy. */
export const FAILURE_THRESHOLD = 2;

const PROBE_TIMEOUT_MS = 6_000;

export type EndpointRow = {
  id: number;
  label: string;
  rpc_url: string;
  ws_url: string | null;
  priority: number;
  is_active: boolean;
  pinned: boolean;
  healthy: boolean;
  last_height: number | null;
  latency_ms: number | null;
  consecutive_failures: number;
};

export type ProbeResult = {
  ok: boolean;
  height: number | null;
  latencyMs: number | null;
  version: string | null;
  catchingUp: boolean;
  error: string | null;
};

/** Time a /status call. Never throws — a failure is a result, not an exception. */
export async function probe(rpcUrl: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const url = rpcUrl.replace(/\/+$/, "") + "/status";
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const sync = json?.result?.sync_info;
    const height = Number(sync?.latest_block_height);
    if (!Number.isFinite(height)) throw new Error("no sync_info.latest_block_height");
    return {
      ok: true,
      height,
      latencyMs: Date.now() - started,
      version: json?.result?.node_info?.version ?? null,
      catchingUp: Boolean(sync?.catching_up),
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      height: null,
      latencyMs: null,
      version: null,
      catchingUp: false,
      error: (e as Error).message,
    };
  }
}

export type Choice = {
  endpoint: EndpointRow | null;
  /** Why this endpoint won — logged on every switch so failover is never silent. */
  reason: string;
};

/**
 * Pick the endpoint to use.
 *
 * A healthy pin always wins: an operator choosing a node should not be
 * second-guessed. An unhealthy pin is overridden — staying on a dead node
 * because someone pinned it is worse than honouring the pin — but the pin flag
 * is left set so control returns to it once it recovers.
 */
export function chooseActive(endpoints: EndpointRow[]): Choice {
  if (endpoints.length === 0) return { endpoint: null, reason: "no endpoints configured" };

  const pinned = endpoints.find((e) => e.pinned);
  if (pinned && isHealthy(pinned, endpoints)) {
    return { endpoint: pinned, reason: `pinned to "${pinned.label}"` };
  }

  const healthy = endpoints
    .filter((e) => isHealthy(e, endpoints))
    .sort((a, b) => a.priority - b.priority || (a.latency_ms ?? 1e9) - (b.latency_ms ?? 1e9));

  if (healthy.length > 0) {
    const best = healthy[0];
    const reason = pinned
      ? `pinned "${pinned.label}" is unhealthy — using "${best.label}"`
      : `healthiest by priority: "${best.label}"`;
    return { endpoint: best, reason };
  }

  // Nothing is healthy. Stay where we are rather than flapping between dead
  // nodes; the drain retries and recovers on its own once one comes back.
  const current = endpoints.find((e) => e.is_active) ?? endpoints[0];
  return { endpoint: current, reason: `no healthy endpoint — holding "${current.label}"` };
}

/** Healthy means reachable, not stalled, and not far behind the best head seen. */
export function isHealthy(e: EndpointRow, all: EndpointRow[]): boolean {
  if (!e.healthy) return false;
  if (e.consecutive_failures >= FAILURE_THRESHOLD) return false;
  const bestHeight = Math.max(0, ...all.map((x) => x.last_height ?? 0));
  if (bestHeight > 0 && e.last_height !== null) {
    if (bestHeight - e.last_height > STALL_THRESHOLD_BLOCKS) return false;
  }
  return true;
}
