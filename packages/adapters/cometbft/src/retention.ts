/**
 * Retention for block_signatures: keep raw per-block rows for as long as the
 * live queries read them, roll anything older into per-validator daily counts.
 *
 * At the current block rate the raw table grows ~480k rows/day (~175M rows and
 * 60+ GB in a year) while every query scans only the trailing window — so this
 * is storage, not latency. The trailing readers are:
 *
 *   - validatorMetrics (packages/api): height > head - LONG_WINDOW (10,000)
 *   - signingSlots / validator detail: the newest ≤ 5,000 blocks
 *
 * The default retain depth is the long window plus a margin; anything older
 * than that can no longer be reached by a percentage and is folded into
 * validator_signing_daily.
 */
import { sql } from "drizzle-orm";
import type { Database } from "@mezo/core";

/**
 * Raw signatures to keep, counting back from head. Must stay ≥ the long
 * window (10,000) plus room for the per-validator detail view (5,000).
 */
export const DEFAULT_RETAIN_BLOCKS = 12_000;

export type SweepResult = {
  /** Newest height rolled up (head - retain). Zero when there was nothing to do. */
  cutoff: number;
  /** Raw rows deleted. */
  deleted: number;
};

/**
 * One idempotent sweep. Aggregation, deletion and the watermark advance share
 * a transaction, so a crash mid-sweep leaves the state exactly as it was.
 *
 * The watermark (signature_retention.last_height) only ever moves forward and
 * each sweep aggregates exactly (watermark, cutoff], so no height range is
 * ever counted twice. A gap repair that re-inserts signatures below the
 * watermark after they were rolled up is deleted un-counted: re-counting it
 * would double-add, and the affected day is already past every live window.
 */
export async function runRetentionSweep(
  db: Database,
  chainId: number,
  retainBlocks: number = DEFAULT_RETAIN_BLOCKS,
): Promise<SweepResult> {
  const head = await db.execute<{ h: number }>(
    sql`select coalesce(max(height), 0)::int as h from blocks where chain_id = ${chainId}`,
  );
  const headHeight = Number(head.rows[0]?.h ?? 0);
  const cutoff = headHeight - retainBlocks;
  if (cutoff < 1) return { cutoff: 0, deleted: 0 };

  return db.transaction(async (tx) => {
    const wm = await tx.execute<{ last_height: number }>(
      sql`select last_height::int as last_height from signature_retention
          where chain_id = ${chainId} for update`,
    );
    const watermark = Number(wm.rows[0]?.last_height ?? 0);

    /**
     * One statement for the whole sweep, so the rows counted into the daily
     * aggregate are exactly the rows the DELETE removes — an aggregate SELECT
     * and a separate DELETE could see different snapshots, and a gap repair
     * inserting into that window would have its signatures deleted uncounted.
     *
     * `counted` deletes (watermark, cutoff] and feeds the aggregate insert
     * from its own RETURNING. `swept` deletes rows at or below the watermark
     * un-counted: they were already rolled up on an earlier sweep (or were
     * re-inserted by a gap repair, where re-counting would double-add). The
     * two ranges are disjoint, and the whole statement (like the watermark
     * update after it) shares the transaction's snapshot.
     */
    const r = await tx.execute<{ counted_n: number; swept_n: number }>(sql`
      with counted as (
        delete from block_signatures
        where chain_id = ${chainId} and height > ${watermark} and height <= ${cutoff}
        returning date_trunc('day', time) as day, validator_address, signed
      ),
      ins as (
        insert into validator_signing_daily (chain_id, day, validator_address, slots, signed)
        select ${chainId}, day, validator_address,
               count(*)::int, count(*) filter (where signed)::int
        from counted
        group by day, validator_address
        on conflict (chain_id, day, validator_address) do update
          set slots = validator_signing_daily.slots + excluded.slots,
              signed = validator_signing_daily.signed + excluded.signed
      ),
      swept as (
        delete from block_signatures where chain_id = ${chainId} and height <= ${watermark}
        returning 1
      )
      select (select count(*)::int from counted) as counted_n,
             (select count(*)::int from swept) as swept_n
    `);

    await tx.execute(sql`
      insert into signature_retention (chain_id, last_height)
      values (${chainId}, ${cutoff})
      on conflict (chain_id) do update
        set last_height = excluded.last_height, updated_at = now()
    `);

    const n = r.rows[0];
    return { cutoff, deleted: Number(n?.counted_n ?? 0) + Number(n?.swept_n ?? 0) };
  });
}
