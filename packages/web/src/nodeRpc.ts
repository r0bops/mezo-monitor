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

/** Shared error model for every direct-RPC call. */
export type RpcResult<T> =
  | { state: "ok"; latencyMs: number; data: T }
  | { state: "blocked" | "error"; latencyMs: number; error: string };

/** Build a CometBFT RPC URL: strip trailing slashes, append path + params. */
export function rpcUrl(
  base: string,
  path: string,
  params?: Record<string, string | number>,
): string {
  let url = base.replace(/\/+$/, "") + path;
  if (params) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }
  return url;
}

/**
 * One GET against the node, with probeNode's timeout/CORS semantics: a
 * TimeoutError is a timeout, every other throw is the browser blocking the
 * request (CORS, mixed content and unreachable hosts all throw the same
 * TypeError by design). `validate` maps the JSON body to the typed payload,
 * or null if the response isn't the endpoint we asked for.
 */
async function rpcGet<T>(
  base: string,
  path: string,
  validate: (j: any) => T | null,
  params?: Record<string, string | number>,
): Promise<RpcResult<T>> {
  const started = performance.now();
  const fail = (state: "blocked" | "error", error: string): RpcResult<T> => ({
    state,
    latencyMs: Math.round(performance.now() - started),
    error,
  });
  try {
    const r = await fetch(rpcUrl(base, path, params), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return fail("error", `HTTP ${r.status}`);
    const j: any = await r.json();
    const data = validate(j);
    if (data === null) return fail("error", `not a CometBFT ${path} response`);
    return { state: "ok", latencyMs: Math.round(performance.now() - started), data };
  } catch (e) {
    // AbortSignal timeouts carry a name; everything else is a block.
    if ((e as DOMException)?.name === "TimeoutError") {
      const latencyMs = Math.round(performance.now() - started);
      return fail("error", `no answer in ${latencyMs}ms (timeout)`);
    }
    return fail("blocked", "browser blocked (no CORS headers, or http node on the https site)");
  }
}

export async function probeNode(base: string): Promise<NodeProbe> {
  const r = await rpcGet(base, "/status", (j) => {
    const n = j?.result?.node_info;
    const s = j?.result?.sync_info;
    if (!n?.network || !s?.latest_block_height) return null;
    return { n, s };
  });
  if (r.state !== "ok") {
    return { state: r.state, latencyMs: r.latencyMs, error: r.error };
  }
  const { n, s } = r.data;
  return {
    state: "ok",
    latencyMs: r.latencyMs,
    network: n.network,
    moniker: n.moniker,
    version: n.version,
    latest: s.latest_block_height,
    earliest: s.earliest_block_height,
    catchingUp: Boolean(s.catching_up),
  };
}

export type ValidatorInfo = {
  address: string;
  pubKeyType?: string;
  votingPower: number;
  proposerPriority?: number;
};

export type ValidatorsPage = {
  blockHeight?: string;
  total: number;
  validators: ValidatorInfo[];
};

export async function fetchValidators(
  base: string,
  height: "latest" | number,
  page: number,
  perPage = 30,
): Promise<RpcResult<ValidatorsPage>> {
  return rpcGet(
    base,
    "/validators",
    (j) => {
      const r = j?.result;
      if (!Array.isArray(r?.validators)) return null;
      return {
        blockHeight: r.block_height,
        total: Number(r.total) || r.validators.length,
        validators: r.validators.map((v: any) => ({
          address: String(v.address ?? ""),
          pubKeyType: v.pub_key?.type,
          votingPower: Number(v.voting_power) || 0,
          proposerPriority:
            v.proposer_priority != null && Number.isFinite(Number(v.proposer_priority))
              ? Number(v.proposer_priority)
              : undefined,
        })),
      };
    },
    { height: height === "latest" ? "latest" : String(height), page, per_page: perPage },
  );
}

export type BlockInfo = {
  height: string;
  time?: string;
  txCount: number;
  proposerAddress?: string;
  lastBlockIdHash?: string;
};

export async function fetchBlock(
  base: string,
  height: "latest" | number,
): Promise<RpcResult<BlockInfo>> {
  return rpcGet(
    base,
    "/block",
    (j) => {
      const b = j?.result?.block;
      const h = b?.header?.height;
      if (!h) return null;
      return {
        height: String(h),
        time: b.header.time,
        txCount: Array.isArray(b.data?.txs) ? b.data.txs.length : 0,
        proposerAddress: b.header.proposer_address,
        lastBlockIdHash: b.last_commit?.block_id?.hash,
      };
    },
    height === "latest" ? undefined : { height: String(height) },
  );
}

export type NetInfo = {
  listening: boolean;
  listeners: string[];
  nPeers: number;
  moniker?: string;
  network?: string;
};

export async function fetchNetInfo(base: string): Promise<RpcResult<NetInfo>> {
  return rpcGet(base, "/net_info", (j) => {
    const r = j?.result;
    if (typeof r?.listening !== "boolean") return null;
    return {
      listening: r.listening,
      listeners: Array.isArray(r.listeners) ? r.listeners : [],
      nPeers: Number(r.n_peers) || 0,
      moniker: r.node_info?.moniker,
      network: r.node_info?.network,
    };
  });
}
