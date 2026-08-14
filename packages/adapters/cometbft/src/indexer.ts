import { and, eq, sql } from "drizzle-orm";
import {
  blockSignatures,
  blocks,
  chainEndpoints,
  chains,
  validatorSetChanges,
  validators,
  createDb,
  loadEnv,
} from "@mezo/core";
import { resolveEndpoints, type ChainConfig } from "./config";
import { chooseActive, probe, type EndpointRow } from "./endpoints";
import { parseBlock } from "./parsers";
import { CometbftRpc } from "./rpc";

const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60000);
const BACKFILL_DEPTH = Number(process.env.BACKFILL_DEPTH ?? 50000);
/** Max blocks one live drain will ingest before yielding to the next tick. */
const LIVE_DRAIN_BATCH = 500;
/** How often to sweep the indexed range for holes and refetch them. */
const GAP_SCAN_MS = Number(process.env.GAP_SCAN_INTERVAL_MS ?? 300_000);
/** Cap on repairs per sweep, so a large hole is closed gradually. */
const GAP_REPAIR_LIMIT = 2_000;
/** How often to probe every endpoint and re-run selection. */
const ENDPOINT_PROBE_MS = Number(process.env.ENDPOINT_PROBE_INTERVAL_MS ?? 30_000);
/** Live-ingest failures in a row before forcing an early reselect. */
const INGEST_FAILURES_BEFORE_RESELECT = 3;

loadEnv();
const { db } = createDb();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function upsertChain(cfg: ChainConfig): Promise<number> {
  const [row] = await db
    .insert(chains)
    .values({
      slug: cfg.slug,
      name: cfg.name,
      chainId: cfg.chain_id,
      family: cfg.family,
      rpcUrl: cfg.rpc_url,
      wsUrl: cfg.ws_url ?? null,
      blockscoutUrl: cfg.blockscout_url ?? null,
      capabilities: cfg.capabilities,
    })
    .onConflictDoUpdate({
      target: chains.slug,
      set: {
        name: cfg.name,
        rpcUrl: cfg.rpc_url,
        wsUrl: cfg.ws_url ?? null,
        blockscoutUrl: cfg.blockscout_url ?? null,
        capabilities: cfg.capabilities,
        updatedAt: new Date(),
      },
    })
    .returning({ id: chains.id });
  if (!row) throw new Error(`failed to upsert chain ${cfg.slug}`);
  return row.id;
}

/** Persist a /block response (idempotent): the block row + per-validator commit signatures. */
async function persistBlock(chainId: number, raw: unknown): Promise<{ height: number; signed: number; total: number }> {
  const p = parseBlock(raw);
  await db
    .insert(blocks)
    .values({
      chainId,
      height: p.height,
      hash: p.hash,
      time: new Date(p.time),
      proposerAddress: p.proposerAddress,
      txCount: p.txCount,
      validatorCount: p.validatorCount,
      signatureCount: p.signatureCount,
    })
    .onConflictDoNothing({ target: [blocks.chainId, blocks.height] });

  if (p.signatures.length) {
    await db
      .insert(blockSignatures)
      .values(
        p.signatures.map((s) => ({
          chainId,
          height: p.commitHeight,
          validatorAddress: s.validator_address,
          signed: s.signed,
          time: new Date(p.time),
        })),
      )
      .onConflictDoNothing({
        target: [blockSignatures.chainId, blockSignatures.height, blockSignatures.validatorAddress],
      });
  }

  await db
    .update(chains)
    .set({ latestIndexedHeight: p.height, updatedAt: new Date() })
    .where(eq(chains.id, chainId));

  return { height: p.height, signed: p.signatureCount, total: p.validatorCount };
}

/** Sync the validator set; record membership changes. Idempotent across restarts. */
async function syncValidators(chainId: number, rpc: CometbftRpc, height: number): Promise<void> {
  const vals = await rpc.allValidators(height);
  const incoming = new Map(vals.map((v) => [String(v.address).toLowerCase(), v] as const));
  const known = await db
    .select({ address: validators.address, isActive: validators.isActive, votingPower: validators.votingPower })
    .from(validators)
    .where(eq(validators.chainId, chainId));
  const knownActive = new Set(known.filter((k) => k.isActive).map((k) => k.address));

  for (const [addr, v] of incoming) {
    await db
      .insert(validators)
      .values({
        chainId,
        address: addr,
        pubKey: JSON.stringify(v.pub_key),
        votingPower: Number(v.voting_power),
        isActive: true,
        firstSeenHeight: height,
        lastSeenHeight: height,
      })
      .onConflictDoUpdate({
        target: [validators.chainId, validators.address],
        set: { votingPower: Number(v.voting_power), isActive: true, lastSeenHeight: height, updatedAt: new Date() },
      });
  }

  for (const k of known) {
    if (!incoming.has(k.address) && k.isActive) {
      await db
        .update(validators)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(validators.chainId, chainId), eq(validators.address, k.address)));
      await db.insert(validatorSetChanges).values({
        chainId,
        height,
        validatorAddress: k.address,
        changeType: "removed",
        votingPowerBefore: k.votingPower ?? 0,
        votingPowerAfter: 0,
        time: new Date(),
      });
    }
  }
  for (const addr of incoming.keys()) {
    if (!knownActive.has(addr)) {
      const v = incoming.get(addr)!;
      await db.insert(validatorSetChanges).values({
        chainId,
        height,
        validatorAddress: addr,
        changeType: "added",
        votingPowerBefore: 0,
        votingPowerAfter: Number(v.voting_power),
        time: new Date(),
      });
    }
  }
  console.log(`validators @${height}: ${incoming.size} active`);
}

/**
 * Find heights missing from the indexed range. Bounded to the trailing
 * `BACKFILL_DEPTH` so the sweep stays cheap as history grows — older holes are
 * the backfill's job, not the live scanner's.
 */
async function findGaps(chainId: number, limit: number): Promise<number[]> {
  const r = await db.execute(sql`
    with bounds as (
      select max(height) as hi,
             greatest(min(height), max(height) - ${BACKFILL_DEPTH}) as lo
      from blocks where chain_id = ${chainId}
    )
    select g as height
    from bounds, generate_series(bounds.lo, bounds.hi) g
    where not exists (
      select 1 from blocks b where b.chain_id = ${chainId} and b.height = g
    )
    order by g desc
    limit ${limit}
  `);
  const rows = (r as unknown as { rows?: { height: number | string }[] }).rows ?? [];
  return rows.map((x) => Number(x.height));
}

/**
 * Periodically repair holes left by RPC failures or downtime. Repairs are
 * logged rather than silent — a scanner that quietly fixes the same range every
 * sweep is reporting a broken ingest path, and that should be visible.
 */
async function runGapScanner(chainId: number, rpc: CometbftRpc): Promise<void> {
  try {
    const gaps = await findGaps(chainId, GAP_REPAIR_LIMIT);
    if (gaps.length === 0) return;
    console.log(`gap scan: ${gaps.length} missing height(s), repairing from ${gaps[0]}`);
    let fixed = 0;
    for (const h of gaps) {
      try {
        await persistBlock(chainId, await rpc.block(h));
        fixed++;
        await sleep(50); // gentle on the node, same cadence as backfill
      } catch (e) {
        console.error(`gap repair ${h} failed:`, (e as Error).message);
      }
    }
    console.log(`gap scan: repaired ${fixed}/${gaps.length}`);
  } catch (e) {
    console.error("gap scan failed:", (e as Error).message);
  }
}

/**
 * Register the YAML endpoint list without disturbing runtime state: `pinned`,
 * `is_active` and health columns are deliberately absent from the update set,
 * so a restart re-reads the config but keeps whatever the operator chose.
 */
async function upsertEndpoints(chainId: number, cfg: ChainConfig): Promise<void> {
  for (const e of resolveEndpoints(cfg)) {
    await db
      .insert(chainEndpoints)
      .values({
        chainId,
        label: e.label,
        rpcUrl: e.rpc_url,
        wsUrl: e.ws_url || null,
        priority: e.priority,
      })
      .onConflictDoUpdate({
        target: [chainEndpoints.chainId, chainEndpoints.rpcUrl],
        set: { label: e.label, wsUrl: e.ws_url || null, priority: e.priority, updatedAt: new Date() },
      });
  }
}

async function listEndpoints(chainId: number): Promise<EndpointRow[]> {
  const rows = await db
    .select()
    .from(chainEndpoints)
    .where(eq(chainEndpoints.chainId, chainId))
    .orderBy(chainEndpoints.priority);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    rpc_url: r.rpcUrl,
    ws_url: r.wsUrl,
    priority: r.priority,
    is_active: r.isActive,
    pinned: r.pinned,
    healthy: r.healthy,
    last_height: r.lastHeight,
    latency_ms: r.latencyMs,
    consecutive_failures: r.consecutiveFailures,
  }));
}

/** Probe every endpoint and persist the outcome. */
async function probeAll(chainId: number): Promise<EndpointRow[]> {
  const rows = await listEndpoints(chainId);
  await Promise.all(
    rows.map(async (e) => {
      const r = await probe(e.rpc_url);
      await db
        .update(chainEndpoints)
        .set(
          r.ok
            ? {
                healthy: !r.catchingUp,
                lastHeight: r.height,
                latencyMs: r.latencyMs,
                lastOkAt: new Date(),
                lastError: r.catchingUp ? "node is catching up" : null,
                consecutiveFailures: 0,
                updatedAt: new Date(),
              }
            : {
                healthy: false,
                lastError: r.error,
                consecutiveFailures: e.consecutive_failures + 1,
                updatedAt: new Date(),
              },
        )
        .where(eq(chainEndpoints.id, e.id));
    }),
  );
  return listEndpoints(chainId);
}

/** Persist the active flag so the API and a later restart agree on it. */
async function markActive(chainId: number, endpointId: number): Promise<void> {
  // Clear first: the partial unique index allows only one active row per chain.
  await db
    .update(chainEndpoints)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(chainEndpoints.chainId, chainId), eq(chainEndpoints.isActive, true)));
  await db
    .update(chainEndpoints)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(chainEndpoints.id, endpointId));
  const [row] = await db
    .select({ rpcUrl: chainEndpoints.rpcUrl, wsUrl: chainEndpoints.wsUrl })
    .from(chainEndpoints)
    .where(eq(chainEndpoints.id, endpointId));
  if (row) {
    await db
      .update(chains)
      .set({ rpcUrl: row.rpcUrl, wsUrl: row.wsUrl, updatedAt: new Date() })
      .where(eq(chains.id, chainId));
  }
}

export async function runIndexer(cfg: ChainConfig): Promise<void> {
  console.log(`starting indexer for ${cfg.chain_id}`);
  const chainId = await upsertChain(cfg);
  await upsertEndpoints(chainId, cfg);

  // Probe before choosing, so the first selection is informed rather than
  // defaulting to whatever happens to be first in the config.
  const initial = chooseActive(await probeAll(chainId));
  if (!initial.endpoint) throw new Error(`${cfg.chain_id}: no usable RPC endpoint`);
  await markActive(chainId, initial.endpoint.id);
  console.log(`${cfg.chain_id}: endpoint "${initial.endpoint.label}" — ${initial.reason}`);

  let activeId = initial.endpoint.id;
  const rpc = new CometbftRpc(initial.endpoint.rpc_url, initial.endpoint.ws_url ?? undefined);

  /**
   * Re-probe, re-select, and switch the live connection if the winner changed.
   * Also runs on demand when ingest starts failing, so a dead node is left
   * within seconds rather than at the next scheduled probe.
   */
  const reselect = async (trigger: string): Promise<void> => {
    try {
      const rows = await probeAll(chainId);
      const choice = chooseActive(rows);
      if (!choice.endpoint) return;

      // Reconcile against the database, not just our own memory: the API sets
      // is_active when an endpoint is pinned, so the two can diverge. Comparing
      // only the in-process cursor would leave the stored active row wrong
      // until the next restart.
      const storedActive = rows.find((r) => r.is_active) ?? null;
      if (storedActive?.id !== choice.endpoint.id) {
        await markActive(chainId, choice.endpoint.id);
      }
      if (choice.endpoint.id === activeId) return;

      rpc.setEndpoint(choice.endpoint.rpc_url, choice.endpoint.ws_url ?? undefined);
      activeId = choice.endpoint.id;
      console.log(
        `${cfg.chain_id}: switched endpoint -> "${choice.endpoint.label}" (${trigger}: ${choice.reason})`,
      );
    } catch (e) {
      console.error("endpoint reselect failed:", (e as Error).message);
    }
  };


  const status: any = await rpc.status();
  const latest = Number(status.result.sync_info.latest_block_height);
  console.log(
    `${cfg.chain_id}: head=${latest} earliest=${status.result.sync_info.earliest_block_height} catching_up=${status.result.sync_info.catching_up}`,
  );

  // Not fatal: a validator-set fetch that fails at boot (flaky or half-open
  // node) must not kill the indexer for this chain. The poll below retries, and
  // block ingest is independent of it.
  await syncValidators(chainId, rpc, latest).catch((e) =>
    console.error("initial validator sync failed:", (e as Error).message),
  );
  setInterval(() => {
    rpc
      .status()
      .then((s: any) => syncValidators(chainId, rpc, Number(s.result.sync_info.latest_block_height)))
      .catch((e) => console.error("validator poll failed:", (e as Error).message));
  }, POLL_MS);

  // `lastSeen` is the highest height known to be ingested. It advances one block
  // at a time inside drainTo() — never by assignment to a newly-observed head,
  // which is how blocks were previously lost whenever the chain moved more than
  // one block between observations.
  let lastSeen = latest - 1;
  let draining = false;

  // Consecutive live-ingest failures. Enough of them means the node is not
  // serving us, whatever /status claims, so trip a reselect rather than waiting
  // for the scheduled probe.
  let ingestFailures = 0;

  const ingestHeight = async (h: number): Promise<boolean> => {
    if (h < 1) return false;
    try {
      const r = await persistBlock(chainId, await rpc.block(h));
      console.log(`block ${r.height}: ${r.signed}/${r.total} signed (live)`);
      ingestFailures = 0;
      return true;
    } catch (e) {
      console.error(`ingest ${h} failed:`, (e as Error).message);
      if (++ingestFailures >= INGEST_FAILURES_BEFORE_RESELECT) {
        ingestFailures = 0;
        void reselect("repeated ingest failures");
      }
      return false;
    }
  };

  /**
   * Ingest every height in (lastSeen, target], in order. Both the WebSocket and
   * the poll funnel through here, guarded by `draining` so they cannot
   * interleave and double-advance the cursor. persistBlock is idempotent, so an
   * overlapping re-fetch is harmless.
   *
   * A failed height stops the drain rather than skipping it: leaving `lastSeen`
   * put means the next tick retries that block instead of stranding a hole.
   */
  const drainTo = async (target: number): Promise<void> => {
    if (draining || target <= lastSeen) return;
    draining = true;
    try {
      let budget = LIVE_DRAIN_BATCH;
      while (lastSeen < target && budget-- > 0) {
        const next = lastSeen + 1;
        if (!(await ingestHeight(next))) return; // retry on the next tick
        lastSeen = next;
      }
      if (lastSeen < target) {
        console.log(`live drain paused at ${lastSeen} (target ${target}); continuing next tick`);
      }
    } finally {
      draining = false;
    }
  };

  // primary: WebSocket NewBlock
  rpc.subscribeNewBlock((h) => {
    void drainTo(h);
  });

  // fallback: HTTP poll every 5s (catches missed WS events, and drives the
  // drain forward when the socket is down)
  setInterval(() => {
    rpc
      .status()
      .then((s: any) => drainTo(Number(s.result.sync_info.latest_block_height)))
      .catch((e) => console.error("poll failed:", (e as Error).message));
  }, 5000);

  setInterval(() => void reselect("scheduled probe"), ENDPOINT_PROBE_MS);

  // self-heal: sweep for holes left by RPC failures or downtime
  setInterval(() => void runGapScanner(chainId, rpc), GAP_SCAN_MS);

  // backfill: backward from head to depth (archive node ⇒ no pruning boundary)
  void (async () => {
    let h = latest - 1;
    const floor = Math.max(1, latest - BACKFILL_DEPTH);
    let count = 0;
    while (h >= floor) {
      try {
        await persistBlock(chainId, await rpc.block(h));
        h--;
        count++;
        if (count % 1000 === 0) console.log(`backfill at height ${h} (${count} done)`);
        await sleep(50); // gentle on the node
      } catch (e) {
        console.log(`backfill stopped at ${h} (pruning boundary?): ${(e as Error).message}`);
        break;
      }
    }
    console.log(`backfill done down to height ${h + 1} (${count} blocks)`);
  })();
}
