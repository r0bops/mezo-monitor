/** Typed client for the Mezo Monitor REST API. Shapes mirror packages/api. */

export type Capabilities = {
  delegations: boolean;
  governance: boolean;
  slashing: boolean;
  poa: boolean;
};

/**
 * Drives which variant every panel renders. `dberror` is synthesised in the
 * client when the API itself is unreachable — the server can hardly report
 * that its own database is down if the request never lands.
 */
export type SystemState = "normal" | "loading" | "empty" | "stopped" | "dberror" | "backfill";

export type Network = {
  chain: {
    slug: string;
    name: string;
    chain_id: string;
    family: string;
    blockscout_url: string | null;
    capabilities: Capabilities;
  };
  status: Exclude<SystemState, "loading" | "dberror">;
  latest_indexed_height: number | null;
  earliest_indexed_height: number | null;
  blocks_indexed: number;
  blocks_indexed_24h: number;
  last_block_time: string | null;
  avg_block_time_ms: number | null;
  signing_rate_100: number | null;
  active_validators: number;
  total_validators: number;
  chain_head_height: number | null;
  indexer_lag_blocks: number | null;
  node_version: string | null;
  head_error: string | null;
  long_window: { target: number; filled: number; complete: boolean };
  vset_bootstrap: boolean;
  active_endpoint: {
    id: number;
    label: string;
    healthy: boolean;
    latency_ms: number | null;
    last_height: number | null;
    pinned: boolean;
  } | null;
  /** Newest 100 blocks, oldest first — backs the per-block signing strip. */
  recent_signing: { height: number; signed: number | null; total: number | null }[];
  last_set_change: { height: number; time: string; type: string } | null;
  updated_at: string;
};

export type ValidatorStatus = "active" | "degraded" | "inactive";

export type Validator = {
  rank: number;
  address: string;
  moniker: string | null;
  /** Keybase identity (64-hex) from the chain's x/poa description, if any. */
  identity: string | null;
  /** The operator's Keybase avatar, or null — rendered as an identicon. */
  avatar_url: string | null;
  /** Operator-assigned local identity; the chain itself exposes no monikers. */
  label: string | null;
  /** Marks validators this operator cares about. */
  watched: boolean;
  pub_key: string | null;
  voting_power: number | null;
  is_active: boolean;
  first_seen_height: number | null;
  last_seen_height: number | null;
  last_signed_height: number | null;
  uptime_1000: number | null;
  uptime_10000: number | null;
  slots_1000: number;
  slots_10000: number;
  missed_streak: number;
  proposer_share_1000: number | null;
  status: ValidatorStatus;
  /**
   * Where a node with this validator's moniker was last seen peering on the
   * P2P network (observed, not registered — possibly a sentry). null = never
   * observed, an honest unknown.
   */
  location: {
    ip: string | null;
    country_code: string | null;
    country: string | null;
    city: string | null;
    isp: string | null;
    last_seen: string | null;
  } | null;
};

export type ValidatorList = {
  count: number;
  windows: { short: number; long: number };
  validators: Validator[];
};

/** `signed: null` means the validator was outside the set at that height. */
export type Slot = { height: number; signed: boolean | null; time: string };

export type ValidatorDetail = { validator: Validator; window: number; slots: Slot[] };

export type SetChange = {
  height: number;
  address: string;
  type: string;
  power_before: number | null;
  power_after: number | null;
  time: string;
};

export type ValidatorSet = {
  set_size: number;
  total_voting_power: number;
  bootstrap: boolean;
  members: Validator[];
  changes: SetChange[];
};

export type SeriesPoint = {
  t: string;
  block_time_s: number | null;
  signing_rate: number | null;
  n: number;
};

export type Metrics = {
  /** Horizon the stats/series/volume cover: 24, 168 or 720 hours. */
  hours: number;
  stats: {
    avg_block_time_s: number | null;
    p95_block_time_s: number | null;
    blocks: number;
    signing_rate: number | null;
  };
  series: SeriesPoint[];
  volume: {
    unit: "hour" | "day";
    points: { t: string; n: number }[];
  };
  proposer_distribution: {
    rank: number;
    address: string;
    share: number | null;
    status: ValidatorStatus;
  }[];
};

export type Series = { minutes: number; points: SeriesPoint[] };

export type Endpoint = {
  id: number;
  label: string;
  rpc_url: string | null;
  ws_url: string | null;
  priority: number;
  is_active: boolean;
  pinned: boolean;
  healthy: boolean;
  last_height: number | null;
  latency_ms: number | null;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
};

export type EndpointList = { count: number; endpoints: Endpoint[] };

export type Config = {
  chain: {
    slug: string;
    name: string;
    chain_id: string;
    family: string;
    rpc_url: string | null;
    ws_url: string | null;
    blockscout_url: string | null;
  };
  capabilities: Capabilities;
  indexer: {
    backfill_depth: number;
    poll_interval_ms: number;
    ingestion: string;
    database: string;
  };
  windows: { short: number; long: number };
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, r.status);
  }
  return r.json() as Promise<T>;
}

export const getNetwork = () => get<Network>("/api/v1/network");
export const getValidators = () => get<ValidatorList>("/api/v1/validators");
export const getValidatorSet = () => get<ValidatorSet>("/api/v1/validator-set");
export const getMetrics = (hours: number = 24) => get<Metrics>(`/api/v1/metrics?hours=${hours}`);
export const getConfig = () => get<Config>("/api/v1/config");
export const getEndpoints = () => get<EndpointList>("/api/v1/endpoints");

/** Pin an endpoint (forcing it active) or release it back to auto-selection. */
export async function setEndpointPinned(id: number, pinned: boolean): Promise<Endpoint> {
  const r = await fetch(`/api/v1/endpoints/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!r.ok) throw new ApiError(`endpoint update failed (${r.status})`, r.status);
  return r.json() as Promise<Endpoint>;
}

export const getValidatorDetail = (address: string, window: number) =>
  get<ValidatorDetail>(`/api/v1/validators/${encodeURIComponent(address)}?window=${window}`);

/** Set (or clear) a validator's local label and/or watched flag. */
export async function updateValidatorIdentity(
  address: string,
  patch: { label?: string | null; watched?: boolean },
): Promise<{ address: string; moniker: string | null; label: string | null; watched: boolean }> {
  const r = await fetch(`/api/v1/validators/${encodeURIComponent(address)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new ApiError(`validator update failed (${r.status})`, r.status);
  return r.json();
}

export const getSeries = (minutes: number, buckets: number) =>
  get<Series>(`/api/v1/series?minutes=${minutes}&buckets=${buckets}`);

