/**
 * Direct browser → CometBFT node requests, the way polkadot.js talks to
 * substrate nodes: no monitor in the middle, so the answer is independent of
 * our indexer and API. Works only when the node sends CORS headers — a node
 * that doesn't (or an http node loaded from the https dashboard) is blocked by
 * the browser, which is reported honestly rather than as "down".
 */

export type NodeProbe = {
  state: "ok" | "blocked" | "error";
  latencyMs: number;
  network?: string;
  moniker?: string;
  version?: string;
  latest?: string;
  earliest?: string;
  catchingUp?: boolean;
  error?: string;
};

export async function probeNode(rpcUrl: string): Promise<NodeProbe> {
  const started = performance.now();
  const url = rpcUrl.replace(/\/+$/, "") + "/status";
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!r.ok) return { state: "error", latencyMs, error: `HTTP ${r.status}` };
    const j: any = await r.json();
    const n = j?.result?.node_info;
    const s = j?.result?.sync_info;
    if (!n?.network || !s?.latest_block_height) {
      return { state: "error", latencyMs, error: "not a CometBFT /status response" };
    }
    return {
      state: "ok",
      latencyMs,
      network: n.network,
      moniker: n.moniker,
      version: n.version,
      latest: s.latest_block_height,
      earliest: s.earliest_block_height,
      catchingUp: Boolean(s.catching_up),
    };
  } catch {
    // Fetch throws the same TypeError for CORS blocks, mixed-content blocks
    // and unreachable hosts — the browser deliberately doesn't distinguish.
    return {
      state: "blocked",
      latencyMs: Math.round(performance.now() - started),
      error: "browser blocked (no CORS headers, or http node on the https site)",
    };
  }
}
