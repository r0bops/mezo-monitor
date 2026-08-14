import { and, eq, sql } from "drizzle-orm";
import {
  blockSignatures,
  blocks,
  chains,
  validatorSetChanges,
  validators,
  createDb,
  loadEnv,
} from "@mezo/core";
import { loadChainConfigs, type ChainConfig } from "./config";
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

export async function runIndexer(cfg: ChainConfig): Promise<void> {
  console.log(`starting indexer for ${cfg.chain_id} (${cfg.rpc_url})`);
  const chainId = await upsertChain(cfg);
  const rpc = new CometbftRpc(cfg.rpc_url, cfg.ws_url);

  const status: any = await rpc.status();
  const latest = Number(status.result.sync_info.latest_block_height);
  console.log(
    `${cfg.chain_id}: head=${latest} earliest=${status.result.sync_info.earliest_block_height} catching_up=${status.result.sync_info.catching_up}`,
  );

  await syncValidators(chainId, rpc, latest);
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

  const ingestHeight = async (h: number): Promise<boolean> => {
    if (h < 1) return false;
    try {
      const r = await persistBlock(chainId, await rpc.block(h));
      console.log(`block ${r.height}: ${r.signed}/${r.total} signed (live)`);
      return true;
    } catch (e) {
      console.error(`ingest ${h} failed:`, (e as Error).message);
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
