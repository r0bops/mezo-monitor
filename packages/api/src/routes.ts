/**
 * REST surface consumed by the dashboard. Every response is derived from the
 * indexed data — where a number genuinely cannot be known (no RPC reachable,
 * window not backfilled) the field is null and the UI renders an em-dash or a
 * partial-window badge rather than a misleading zero.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import type pg from "pg";
import type { ChainHead } from "./chain-head.js";
import {
  LONG_WINDOW,
  SHORT_WINDOW,
  blocksPerBucket,
  getChain,
  indexerStall,
  isBootstrapSet,
  listEndpoints,
  metricStats,
  networkSummary,
  proposedTotal,
  recentBlockSigning,
  seriesBuckets,
  setChanges,
  setEndpointPinned,
  setValidatorIdentity,
  signingSlots,
  validatorMetrics,
  type ChainRow,
  type ValidatorRow,
} from "./queries.js";
import { CacheMap } from "./cache.js";
import { createAvatarResolver, withAvatars } from "./avatars.js";

/** Lag beyond which the indexer is considered stalled rather than merely behind. */
const STALL_LAG_BLOCKS = 50;
/** Just under block cadence: a cached read is at most one block stale. */
const DERIVED_TTL_MS = 3_000;

export type Deps = {
  pool: pg.Pool;
  /**
   * A thunk, deliberately: the chain row (and with it the polled RPC URL)
   * changes whenever the indexer fails over or an endpoint is pinned, and the
   * server replaces the ChainHead then. Capturing the object by value at boot
   * would freeze every route on a stopped tracker — head/lag null forever
   * until process restart.
   */
  head: () => ChainHead;
  /** Resolved once at boot; null when the indexer has never seeded a chain row. */
  chain: () => ChainRow | null;
};

type ValidatorView = {
  address: string;
  moniker: string | null;
  identity: string | null;
  /** Keybase avatar for the identity, or null when there is none to fetch. */
  avatar_url: string | null;
  label: string | null;
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
  status: "active" | "degraded" | "inactive";
  /**
   * Where a node with this validator's moniker was last seen peering on the
   * P2P network. All fields null when never observed — that is a fact about
   * our observation, not a claim the validator is nowhere. This is the node's
   * location (possibly a sentry), not the operator's registered address.
   */
  location: {
    ip: string | null;
    country_code: string | null;
    country: string | null;
    city: string | null;
    isp: string | null;
    /** Equirectangular degrees for the map view. */
    lat: number | null;
    lon: number | null;
    last_seen: string | null;
    /** "peer" = seen in an RPC's peer list; "direct" = the node's own RPC
     *  answered after it fell out of the peer view. */
    source: string | null;
    /** Distinct IPs ever observed for this validator. */
    ips_seen: number;
  } | null;
};

function viewValidator(
  v: ValidatorRow & { avatar_url?: string | null },
  proposedTotalCount: number,
): ValidatorView {
  const uptime1 = v.slots_short > 0 ? (v.signed_short / v.slots_short) * 100 : null;
  const uptime10 = v.slots_long > 0 ? (v.signed_long / v.slots_long) * 100 : null;
  const degraded = v.missed_streak >= 3 || (uptime1 !== null && uptime1 < 99.5);
  return {
    address: v.address,
    moniker: v.moniker,
    identity: v.identity,
    avatar_url: v.avatar_url ?? null,
    label: v.label,
    watched: v.watched,
    pub_key: v.pub_key,
    voting_power: v.voting_power,
    is_active: v.is_active,
    first_seen_height: v.first_seen_height,
    last_seen_height: v.last_seen_height,
    last_signed_height: v.last_signed_height,
    uptime_1000: uptime1,
    uptime_10000: uptime10,
    slots_1000: v.slots_short,
    slots_10000: v.slots_long,
    missed_streak: v.missed_streak,
    proposer_share_1000:
      proposedTotalCount > 0 ? (v.proposed_short / proposedTotalCount) * 100 : null,
    status: !v.is_active ? "inactive" : degraded ? "degraded" : "active",
    location: v.loc_ip
      ? {
          ip: v.loc_ip,
          country_code: v.loc_country_code,
          country: v.loc_country,
          city: v.loc_city,
          isp: v.loc_isp,
          lat: v.loc_lat,
          lon: v.loc_lon,
          last_seen: v.loc_last_seen ? v.loc_last_seen.toISOString() : null,
          source: v.loc_source,
          ips_seen: v.loc_ips_seen ?? 1,
        }
      : null,
  };
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { pool } = deps;
  /** Keybase avatar per validator identity; day-TTL, fail-soft to null. */
  const resolveAvatar = createAvatarResolver();

  // Shared across the validator, validator-set and metrics routes so one
  // refresh cycle costs a single scan rather than five.
  const metricsCache = new CacheMap(
    (chainId) => validatorMetrics(pool, Number(chainId)),
    DERIVED_TTL_MS,
  );
  const proposedCache = new CacheMap(
    (chainId) => proposedTotal(pool, Number(chainId)),
    DERIVED_TTL_MS,
  );
  /**
   * The metrics horizon scans (30-day series, per-day volume) and the
   * per-validator slot joins are uncached otherwise — an anonymous flood of
   * GETs through the public facade would hold every pool connection busy.
   * Same TTL + coalescing as the other caches: a burst costs one scan.
   */
  const statsCache = new CacheMap(
    (key: string) => {
      const [chainId, hours] = key.split(":").map(Number);
      return Promise.all([
        metricStats(pool, chainId, hours),
        seriesBuckets(pool, chainId, hours * 60, hours <= 24 ? 60 : 120),
        blocksPerBucket(pool, chainId, hours),
      ]);
    },
    10_000,
  );
  const slotsCache = new CacheMap(
    (key: string) => {
      const [chainId, address, win] = key.split(":");
      return signingSlots(pool, Number(chainId), address, Number(win));
    },
    5_000,
  );

  /**
   * Any unhandled route failure is almost always the database being
   * unreachable. Report it in the shape the client already maps to its
   * `dberror` state — but never echo the raw error to the client: pg messages
   * carry internal topology (DB host, role names, timeouts) and both surfaces
   * are anonymous. The full error is logged server-side.
   */
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error({ err }, "request failed");
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 503;
    reply.code(status).send(
      status >= 500
        ? { status: "dberror", error: "database unavailable" }
        : { error: err.message },
    );
  });

  /** Chain row or a 503 — every data route needs it. */
  const requireChain = (reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const chain = deps.chain();
    if (!chain) {
      reply.code(503).send({
        error: "no chain configured",
        hint: "start the indexer once so it seeds the chains table from chains/*.yaml",
      });
      return null;
    }
    return chain;
  };

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  app.get("/api/v1/network", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    try {
      const [n, bootstrap, changes, recent, endpoints] = await Promise.all([
        networkSummary(pool, chain.id),
        isBootstrapSet(pool, chain.id),
        setChanges(pool, chain.id, 1),
        recentBlockSigning(pool, chain.id, 100),
        listEndpoints(pool, chain.id),
      ]);
      const active = endpoints.find((e) => e.is_active) ?? null;

      const head = deps.head();
      const headState = head.current;
      const headHeight = head.isFresh ? headState.height : null;
      const lag =
        headHeight !== null && n.latest_indexed_height !== null
          ? Math.max(0, headHeight - n.latest_indexed_height)
          : null;

      const longFilled = Math.min(n.blocks_in_long_window, LONG_WINDOW);
      const longComplete = longFilled >= LONG_WINDOW;

      /**
       * Staleness fallback for when the chain head is unknown: lag needs a
       * reachable RPC, but an unreachable RPC is exactly when indexing has
       * stopped — relying on lag alone reports "normal" while nothing is being
       * ingested. Time since the last indexed block needs no RPC, so it catches
       * that case.
       */
      const stale = indexerStall(n).stale;

      const status =
        n.blocks_indexed === 0
          ? "empty"
          : (lag !== null && lag > STALL_LAG_BLOCKS) || stale
            ? "stopped"
            : !longComplete
              ? "backfill"
              : "normal";

      return {
        chain: {
          slug: chain.slug,
          name: chain.name,
          chain_id: chain.chain_id,
          family: chain.family,
          blockscout_url: chain.blockscout_url,
          capabilities: chain.capabilities,
        },
        status,
        latest_indexed_height: n.latest_indexed_height,
        earliest_indexed_height: n.earliest_indexed_height,
        blocks_indexed: n.blocks_indexed,
        blocks_indexed_24h: n.blocks_indexed_24h,
        last_block_time: n.last_block_time,
        avg_block_time_ms: n.avg_block_time_ms,
        signing_rate_100: n.signing_rate_100,
        active_validators: n.active_validators,
        total_validators: n.total_validators,
        chain_head_height: headHeight,
        indexer_lag_blocks: lag,
        node_version: headState.version,
        head_error: headState.error,
        long_window: { target: LONG_WINDOW, filled: longFilled, complete: longComplete },
        vset_bootstrap: bootstrap,
        active_endpoint: active
          ? {
              id: active.id,
              label: active.label,
              healthy: active.healthy,
              latency_ms: active.latency_ms,
              last_height: active.last_height,
              pinned: active.pinned,
            }
          : null,
        recent_signing: recent.map((b) => ({
          height: b.height,
          signed: b.signature_count,
          total: b.validator_count,
        })),
        last_set_change: changes[0]
          ? { height: changes[0].height, time: changes[0].time, type: changes[0].change_type }
          : null,
        updated_at: new Date().toISOString(),
      };
    } catch (e) {
      app.log.error({ err: e }, "network query failed");
      reply.code(503);
      return { status: "dberror", error: "database unavailable" };
    }
  });

  app.get("/api/v1/validators", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const [rows, total] = await Promise.all([
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
    ]);
    const withLogos = await withAvatars(rows, resolveAvatar);
    const validators = withLogos.map((v) => viewValidator(v, total));
    // Rank by proposer share so the list order matches the "rank" column.
    validators.sort((a, b) => (b.proposer_share_1000 ?? 0) - (a.proposer_share_1000 ?? 0));
    return {
      count: validators.length,
      windows: { short: SHORT_WINDOW, long: LONG_WINDOW },
      validators: validators.map((v, i) => ({ rank: i + 1, ...v })),
    };
  });

  app.get<{ Params: { address: string }; Querystring: { window?: string } }>(
    "/api/v1/validators/:address",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const address = req.params.address;
      const win = Math.min(5_000, Math.max(1, Number(req.query.window ?? 500) || 500));

      const [rows, total, slots] = await Promise.all([
        metricsCache.get(chain.id),
        proposedCache.get(chain.id),
        slotsCache.get(`${chain.id}:${address}:${win}`),
      ]);
      const row = rows.find((r) => r.address.toLowerCase() === address.toLowerCase());
      if (!row) {
        reply.code(404);
        return { error: "validator not found", address };
      }
      const [withLogo] = await withAvatars([row], resolveAvatar);
      return {
        validator: viewValidator(withLogo, total),
        window: win,
        slots: slots.map((s) => ({
          height: s.height,
          // null => the validator was not in the set at that height
          signed: s.signed,
          time: s.time,
        })),
      };
    },
  );

  app.patch<{
    Params: { address: string };
    Body: { label?: string | null; watched?: boolean };
  }>("/api/v1/validators/:address", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const { label, watched } = req.body ?? {};
    if (label === undefined && watched === undefined) {
      reply.code(400);
      return { error: "body must include { label: string|null } and/or { watched: boolean }" };
    }
    if (label !== undefined && label !== null && typeof label !== "string") {
      reply.code(400);
      return { error: "label must be a string or null" };
    }
    if (watched !== undefined && typeof watched !== "boolean") {
      reply.code(400);
      return { error: "watched must be a boolean" };
    }
    const row = await setValidatorIdentity(pool, chain.id, req.params.address, { label, watched });
    if (!row) {
      reply.code(404);
      return { error: "validator not found", address: req.params.address };
    }
    return row;
  });

  app.get("/api/v1/validator-set", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const [rows, total, changes, bootstrap] = await Promise.all([
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
      setChanges(pool, chain.id, 50),
      isBootstrapSet(pool, chain.id),
    ]);
    const members = (await withAvatars(rows, resolveAvatar)).map((v) => viewValidator(v, total));
    const active = members.filter((m) => m.is_active);
    return {
      set_size: active.length,
      total_voting_power: active.reduce((a, m) => a + (m.voting_power ?? 0), 0),
      bootstrap,
      members: members.map((m, i) => ({ rank: i + 1, ...m })),
      changes: changes.map((c) => ({
        height: c.height,
        address: c.validator_address,
        type: c.change_type,
        power_before: c.voting_power_before,
        power_after: c.voting_power_after,
        time: c.time,
      })),
    };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/v1/metrics", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    // Fixed horizons, not arbitrary numbers: a 17h outage empties a 24h
    // window, so 7d/30d exist to keep history visible through one.
    const hours = [24, 168, 720].includes(Number(req.query.hours))
      ? Number(req.query.hours)
      : 24;
    const [[stats, day, volume], rows, total] = await Promise.all([
      statsCache.get(`${chain.id}:${hours}`),
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
    ]);
    // The distribution carries no avatars, so it maps the raw rows through
    // viewValidator with the logo fields left unset.
    const dist = rows
      .map((v) => viewValidator(v, total))
      .sort((a, b) => (b.proposer_share_1000 ?? 0) - (a.proposer_share_1000 ?? 0))
      .map((v, i) => ({
        rank: i + 1,
        address: v.address,
        share: v.proposer_share_1000,
        status: v.status,
      }));
    return {
      hours,
      stats,
      series: day.map((b) => ({
        t: b.bucket,
        block_time_s: b.block_time_s,
        signing_rate: b.signing_rate,
        n: b.n,
      })),
      volume: {
        unit: volume.unit,
        points: volume.rows.map((r) => ({ t: r.t, n: r.n })),
      },
      proposer_distribution: dist,
    };
  });

  app.get<{ Querystring: { minutes?: string; buckets?: string } }>(
    "/api/v1/series",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const minutes = Math.min(1440, Math.max(1, Number(req.query.minutes ?? 60) || 60));
      const buckets = Math.min(240, Math.max(2, Number(req.query.buckets ?? 60) || 60));
      const rows = await seriesBuckets(pool, chain.id, minutes, buckets);
      return {
        minutes,
        points: rows.map((b) => ({
          t: b.bucket,
          block_time_s: b.block_time_s,
          signing_rate: b.signing_rate,
          n: b.n,
        })),
      };
    },
  );

  /**
   * True when the request arrived through the public facade (set PUBLIC_HOST
   * to its hostname). Endpoint URLs and failure telemetry name the operator's
   * infrastructure — anonymous visitors get health and latency, not topology.
   */
  const viaPublicFacade = (host: string | undefined): boolean => {
    const publicHost = process.env.PUBLIC_HOST;
    return Boolean(publicHost) && Boolean(host) && host!.split(":")[0] === publicHost;
  };

  app.get<{ Headers: { host?: string } }>("/api/v1/endpoints", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const rows = await listEndpoints(pool, chain.id);
    const publicView = viaPublicFacade(req.headers.host);
    return {
      count: rows.length,
      endpoints: rows.map((e) => ({
        ...e,
        // A node URL can carry credentials; never hand them back.
        rpc_url: redactUrl(e.rpc_url),
        ws_url: redactUrl(e.ws_url),
        // And through the public facade: no URLs, no failure text.
        ...(publicView ? { rpc_url: null, ws_url: null, last_error: null } : {}),
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { pinned?: boolean } }>(
    "/api/v1/endpoints/:id",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        reply.code(400);
        return { error: "id must be an integer" };
      }
      if (typeof req.body?.pinned !== "boolean") {
        reply.code(400);
        return { error: "body must be { pinned: boolean }" };
      }
      const row = await setEndpointPinned(pool, chain.id, id, req.body.pinned);
      if (!row) {
        reply.code(404);
        return { error: "endpoint not found for this chain", id };
      }
      return { ...row, rpc_url: redactUrl(row.rpc_url), ws_url: redactUrl(row.ws_url) };
    },
  );

  app.get<{ Headers: { host?: string } }>("/api/v1/config", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const publicView = viaPublicFacade(req.headers.host);
    return {
      chain: {
        slug: chain.slug,
        name: chain.name,
        chain_id: chain.chain_id,
        family: chain.family,
        // Never leak credentials that may be embedded in an RPC URL; through
        // the public facade, no URLs at all.
        rpc_url: publicView ? null : redactUrl(chain.rpc_url),
        ws_url: publicView ? null : redactUrl(chain.ws_url),
        blockscout_url: chain.blockscout_url,
      },
      capabilities: chain.capabilities,
      indexer: {
        backfill_depth: Number(process.env.BACKFILL_DEPTH ?? 50_000),
        poll_interval_ms: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
        ingestion: "idempotent · ON CONFLICT DO NOTHING",
        database: "postgres:16 · drizzle",
      },
      windows: { short: SHORT_WINDOW, long: LONG_WINDOW },
    };
  });
}

/**
 * Strip userinfo and query strings; keep enough to identify the endpoint.
 * The regex fallback matters: an unparseable URL returned verbatim could carry
 * credentials straight through the public facade.
 */
function redactUrl(raw: string | null): string | null {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    u.search = "";
    return u.toString();
  } catch {
    return raw.replace(/\/\/[^/@:]+:[^/@]+@/, "//").replace(/\/\/[^/@]+@/, "//");
  }
}

export { getChain };
