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
import { evaluate, listEvents, listRules, setRuleEnabled, setRuleWebhook } from "./alerts.js";
import { CacheMap } from "./cache.js";
import { deliverPending } from "./delivery.js";

/** Lag beyond which the indexer is considered stalled rather than merely behind. */
const STALL_LAG_BLOCKS = 50;
/** Just under block cadence: a cached read is at most one block stale. */
const DERIVED_TTL_MS = 3_000;

export type Deps = {
  pool: pg.Pool;
  head: ChainHead;
  /** Resolved once at boot; null when the indexer has never seeded a chain row. */
  chain: () => ChainRow | null;
  /** Populated by registerRoutes so the evaluator shares the route caches. */
  derived?: {
    metrics: CacheMap<ValidatorRow[]>;
    proposed: CacheMap<number>;
  };
};

type ValidatorView = {
  address: string;
  moniker: string | null;
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
};

function viewValidator(v: ValidatorRow, proposedTotalCount: number): ValidatorView {
  const uptime1 = v.slots_short > 0 ? (v.signed_short / v.slots_short) * 100 : null;
  const uptime10 = v.slots_long > 0 ? (v.signed_long / v.slots_long) * 100 : null;
  const degraded = v.missed_streak >= 3 || (uptime1 !== null && uptime1 < 99.5);
  return {
    address: v.address,
    moniker: v.moniker,
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
  };
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { pool, head } = deps;

  // Shared across routes and the evaluator so one refresh cycle costs a single
  // scan rather than five.
  const metricsCache = new CacheMap((chainId) => validatorMetrics(pool, chainId), DERIVED_TTL_MS);
  const proposedCache = new CacheMap((chainId) => proposedTotal(pool, chainId), DERIVED_TTL_MS);
  deps.derived = { metrics: metricsCache, proposed: proposedCache };

  /**
   * Any unhandled route failure is almost always the database being
   * unreachable. Report it in the shape the client already maps to its
   * `dberror` state, so every route degrades the same way `/network` does.
   */
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error({ err }, "request failed");
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 503;
    reply
      .code(status)
      .send(status >= 500 ? { status: "dberror", error: err.message } : { error: err.message });
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

      const headState = head.current;
      const headHeight = head.isFresh ? headState.height : null;
      const lag =
        headHeight !== null && n.latest_indexed_height !== null
          ? Math.max(0, headHeight - n.latest_indexed_height)
          : null;

      const longFilled = Math.min(n.blocks_in_long_window, LONG_WINDOW);
      const longComplete = longFilled >= LONG_WINDOW;

      /**
       * Staleness fallback for when the chain head is unknown — shared with the
       * indexer_stale alert rule (see indexerStall) so the status field and the
       * page can never disagree about whether the indexer is stalled.
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
      reply.code(503);
      return { status: "dberror", error: String(e) };
    }
  });

  app.get("/api/v1/validators", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const [rows, total] = await Promise.all([
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
    ]);
    const validators = rows.map((v) => viewValidator(v, total));
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
        signingSlots(pool, chain.id, address, win),
      ]);
      const row = rows.find((r) => r.address.toLowerCase() === address.toLowerCase());
      if (!row) {
        reply.code(404);
        return { error: "validator not found", address };
      }
      return {
        validator: viewValidator(row, total),
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
    const members = rows.map((v) => viewValidator(v, total));
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
    const [stats, day, volume, rows, total] = await Promise.all([
      metricStats(pool, chain.id, hours),
      seriesBuckets(pool, chain.id, hours * 60, hours <= 24 ? 60 : 120),
      blocksPerBucket(pool, chain.id, hours),
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
    ]);
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

  app.get("/api/v1/alerts", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const [rules, events] = await Promise.all([
      listRules(pool, chain.id),
      listEvents(pool, chain.id, 50),
    ]);
    return { rules, events };
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; webhook_url?: string | null } }>(
    "/api/v1/alerts/rules/:id",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        reply.code(400);
        return { error: "id must be an integer" };
      }

      const { enabled, webhook_url: webhookUrl } = req.body ?? {};
      if (enabled === undefined && webhookUrl === undefined) {
        reply.code(400);
        return { error: "body must include { enabled: boolean } and/or { webhook_url: string|null }" };
      }

      let rule = null;
      if (webhookUrl !== undefined) {
        if (webhookUrl !== null && !/^https?:\/\//i.test(webhookUrl)) {
          reply.code(400);
          return { error: "webhook_url must be an http(s) URL or null" };
        }
        rule = await setRuleWebhook(pool, chain.id, id, webhookUrl);
      }
      if (enabled !== undefined) {
        if (typeof enabled !== "boolean") {
          reply.code(400);
          return { error: "enabled must be a boolean" };
        }
        rule = await setRuleEnabled(pool, chain.id, id, enabled);
      }
      if (!rule) {
        reply.code(404);
        return { error: "rule not found", id };
      }
      return rule;
    },
  );

  app.get("/api/v1/endpoints", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const rows = await listEndpoints(pool, chain.id);
    return {
      count: rows.length,
      endpoints: rows.map((e) => ({
        ...e,
        // A node URL can carry credentials; never hand them back.
        rpc_url: redactUrl(e.rpc_url),
        ws_url: redactUrl(e.ws_url),
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

  app.get("/api/v1/config", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    return {
      chain: {
        slug: chain.slug,
        name: chain.name,
        chain_id: chain.chain_id,
        family: chain.family,
        // Never leak credentials that may be embedded in an RPC URL.
        rpc_url: redactUrl(chain.rpc_url),
        ws_url: redactUrl(chain.ws_url),
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

/** Strip userinfo and query strings; keep enough to identify the endpoint. */
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
    return raw;
  }
}

/** Periodic rule evaluation plus webhook delivery, driven from the bootstrap. */
export async function runEvaluation(deps: Deps): Promise<{ sent: number; failed: number } | void> {
  const chain = deps.chain();
  if (!chain) return;
  // Reuse the route caches when available so evaluation is free if a request
  // just populated them; fall back to a direct query when running standalone.
  const [rows, n] = await Promise.all([
    deps.derived?.metrics.get(chain.id) ?? validatorMetrics(deps.pool, chain.id),
    networkSummary(deps.pool, chain.id),
  ]);
  const headState = deps.head.current;
  const headHeight = deps.head.isFresh ? headState.height : null;
  const lag =
    headHeight !== null && n.latest_indexed_height !== null
      ? Math.max(0, headHeight - n.latest_indexed_height)
      : null;

  // The RPC-free signals: these stay knowable precisely when `lag` goes null,
  // which is what lets alerting survive the data source disappearing.
  const stall = indexerStall(n);
  const endpoints = await listEndpoints(deps.pool, chain.id);
  const healthyEndpoints = endpoints.filter((e) => e.healthy).length;

  await evaluate(deps.pool, {
    chainId: chain.id,
    validators: rows,
    indexerLag: lag,
    avgBlockTimeS: n.avg_block_time_ms !== null ? n.avg_block_time_ms / 1000 : null,
    indexerStaleS: stall.sinceLastBlockS,
    staleAfterS: stall.staleAfterS,
    healthyEndpoints,
    height: n.latest_indexed_height,
  });

  // Delivery is a separate pass: a dead webhook must never stall evaluation.
  return deliverPending(deps.pool, chain.id, chain.chain_id);
}

export { getChain };
