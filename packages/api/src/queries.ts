/**
 * Every derived metric the dashboard needs, as SQL against the chain-agnostic
 * core schema. Nothing here is Mezo-specific.
 *
 * Two windows are used throughout: SHORT (1,000 blocks) and LONG (10,000).
 * Counts are returned alongside percentages so the caller can tell a genuine
 * 100% from a window that isn't backfilled yet — a partially-filled long
 * window must render as "3,412 / 10k", never as a percentage.
 */
import type pg from "pg";

export const SHORT_WINDOW = 1_000;
export const LONG_WINDOW = 10_000;

export type ChainRow = {
  id: number;
  slug: string;
  name: string;
  chain_id: string;
  family: string;
  rpc_url: string;
  ws_url: string | null;
  blockscout_url: string | null;
  capabilities: { delegations: boolean; governance: boolean; slashing: boolean; poa: boolean };
  latest_indexed_height: number | null;
};

/** The configured chain. Defaults to the lowest id when no slug is given. */
export async function getChain(pool: pg.Pool, slug?: string): Promise<ChainRow | null> {
  const r = slug
    ? await pool.query<ChainRow>("select * from chains where slug = $1", [slug])
    : await pool.query<ChainRow>("select * from chains order by id limit 1");
  return r.rows[0] ?? null;
}

export type NetworkRow = {
  latest_indexed_height: number | null;
  earliest_indexed_height: number | null;
  blocks_indexed: number;
  last_block_time: Date | null;
  avg_block_time_ms: number | null;
  active_validators: number;
  total_validators: number;
  blocks_indexed_24h: number;
  signing_rate_100: number | null;
  /**
   * Blocks present *within the trailing long window*, not the total row count.
   * A gap-filling backfill has plenty of rows overall while the recent window
   * is still sparse — counting all rows would report a complete window and
   * suppress the backfill banner.
   */
  blocks_in_long_window: number;
};

export async function networkSummary(pool: pg.Pool, chainId: number): Promise<NetworkRow> {
  const r = await pool.query<NetworkRow>(
    `
    with b as (
      select max(height) as latest, min(height) as earliest,
             count(*)::int as total, max(time) as last_time
      from blocks where chain_id = $1
    ),
    recent as (
      select time, signature_count, validator_count
      from blocks where chain_id = $1 order by height desc limit 100
    ),
    bt as (
      select extract(epoch from (max(time) - min(time)))::float8 * 1000
             / nullif(count(*) - 1, 0) as avg_ms,
             sum(signature_count)::float8 / nullif(sum(validator_count), 0) * 100 as rate
      from recent
    ),
    v as (
      select count(*)::int as total,
             count(*) filter (where is_active)::int as active
      from validators where chain_id = $1
    ),
    d as (
      select count(*)::int as n from blocks
      where chain_id = $1 and time > now() - interval '24 hours'
    ),
    lw as (
      select count(*)::int as n from blocks
      where chain_id = $1 and height > (select latest from b) - $2
    )
    select b.latest as latest_indexed_height,
           b.earliest as earliest_indexed_height,
           b.total as blocks_indexed,
           b.last_time as last_block_time,
           bt.avg_ms as avg_block_time_ms,
           v.active as active_validators,
           v.total as total_validators,
           d.n as blocks_indexed_24h,
           bt.rate as signing_rate_100,
           lw.n as blocks_in_long_window
    from b, bt, v, d, lw
    `,
    [chainId, LONG_WINDOW],
  );
  return r.rows[0];
}

export type ValidatorRow = {
  address: string;
  moniker: string | null;
  pub_key: string | null;
  voting_power: number | null;
  is_active: boolean;
  first_seen_height: number | null;
  last_seen_height: number | null;
  slots_short: number;
  signed_short: number;
  slots_long: number;
  signed_long: number;
  last_signed_height: number | null;
  missed_streak: number;
  proposed_short: number;
};

/**
 * Per-validator signing metrics over both windows in one pass.
 *
 * `missed_streak` counts consecutive misses since the validator's most recent
 * signed block — a validator that has never signed inside the window counts
 * every slot in it, which is the intended "hard down" reading.
 */
export async function validatorMetrics(pool: pg.Pool, chainId: number): Promise<ValidatorRow[]> {
  const r = await pool.query<ValidatorRow>(
    `
    with head as (
      select coalesce(max(height), 0) as h from blocks where chain_id = $1
    ),
    sig as (
      select bs.validator_address as address, bs.height, bs.signed
      from block_signatures bs, head
      where bs.chain_id = $1 and bs.height > head.h - $3
    ),
    agg as (
      select s.address,
             count(*) filter (where s.height > (select h from head) - $2)::int as slots_short,
             count(*) filter (where s.height > (select h from head) - $2 and s.signed)::int as signed_short,
             count(*)::int as slots_long,
             count(*) filter (where s.signed)::int as signed_long,
             max(s.height) filter (where s.signed) as last_signed_height
      from sig s group by s.address
    ),
    streak as (
      select address, count(*)::int as missed_streak
      from (
        select address, height, signed,
               max(height) filter (where signed) over (partition by address) as last_signed
        from sig
      ) t
      where not signed and height > coalesce(last_signed, -1)
      group by address
    ),
    prop as (
      select b.proposer_address as address, count(*)::int as proposed
      from blocks b, head
      where b.chain_id = $1 and b.height > head.h - $2 and b.proposer_address is not null
      group by b.proposer_address
    )
    select v.address, v.moniker, v.pub_key, v.voting_power, v.is_active,
           v.first_seen_height, v.last_seen_height,
           coalesce(a.slots_short, 0) as slots_short,
           coalesce(a.signed_short, 0) as signed_short,
           coalesce(a.slots_long, 0) as slots_long,
           coalesce(a.signed_long, 0) as signed_long,
           a.last_signed_height,
           coalesce(s.missed_streak, 0) as missed_streak,
           coalesce(p.proposed, 0) as proposed_short
    from validators v
    left join agg a on a.address = v.address
    left join streak s on s.address = v.address
    left join prop p on p.address = v.address
    where v.chain_id = $1
    order by v.is_active desc, v.address
    `,
    [chainId, SHORT_WINDOW, LONG_WINDOW],
  );
  return r.rows;
}

/** Blocks proposed in the short window — denominator for proposer share. */
export async function proposedTotal(pool: pg.Pool, chainId: number): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `with head as (select coalesce(max(height), 0) as h from blocks where chain_id = $1)
     select count(*)::int as n from blocks b, head
     where b.chain_id = $1 and b.height > head.h - $2 and b.proposer_address is not null`,
    [chainId, SHORT_WINDOW],
  );
  return r.rows[0]?.n ?? 0;
}

export type SlotRow = { height: number; signed: boolean | null; time: Date };

/**
 * Signing slots for the heatmap, newest first. Left-joined against `blocks` so
 * heights where the validator was outside the set come back as `signed: null`
 * ("not in set") rather than silently vanishing.
 */
export async function signingSlots(
  pool: pg.Pool,
  chainId: number,
  address: string,
  limit: number,
): Promise<SlotRow[]> {
  const r = await pool.query<SlotRow>(
    `select b.height, bs.signed, b.time
     from blocks b
     left join block_signatures bs
       on bs.chain_id = b.chain_id and bs.height = b.height and bs.validator_address = $2
     where b.chain_id = $1
     order by b.height desc
     limit $3`,
    [chainId, address, limit],
  );
  return r.rows;
}

export type SetChangeRow = {
  height: number;
  validator_address: string;
  change_type: string;
  voting_power_before: number | null;
  voting_power_after: number | null;
  time: Date;
};

export async function setChanges(
  pool: pg.Pool,
  chainId: number,
  limit: number,
): Promise<SetChangeRow[]> {
  const r = await pool.query<SetChangeRow>(
    `select height, validator_address, change_type, voting_power_before, voting_power_after, time
     from validator_set_changes where chain_id = $1
     order by height desc, id desc limit $2`,
    [chainId, limit],
  );
  return r.rows;
}

/**
 * True when every recorded change is an "added" at one height — i.e. the
 * genesis set was captured and no churn has happened since. The UI says so
 * explicitly rather than implying the chain has been stable through churn.
 */
export async function isBootstrapSet(pool: pg.Pool, chainId: number): Promise<boolean> {
  const r = await pool.query<{ heights: number; removals: number; total: number }>(
    `select count(distinct height)::int as heights,
            count(*) filter (where change_type = 'removed')::int as removals,
            count(*)::int as total
     from validator_set_changes where chain_id = $1`,
    [chainId],
  );
  const row = r.rows[0];
  if (!row || row.total === 0) return false;
  return row.heights === 1 && row.removals === 0;
}

export type BucketRow = {
  bucket: Date;
  block_time_s: number | null;
  signing_rate: number | null;
  n: number;
};

/** Block-time and signing-rate series, bucketed across a trailing window. */
export async function seriesBuckets(
  pool: pg.Pool,
  chainId: number,
  windowMinutes: number,
  buckets: number,
): Promise<BucketRow[]> {
  const width = `${Math.max(1, Math.round((windowMinutes * 60) / buckets))} seconds`;
  const r = await pool.query<BucketRow>(
    `
    with b as (
      select time, signature_count, validator_count,
             extract(epoch from (time - lag(time) over (order by height)))::float8 as dt
      from blocks
      where chain_id = $1 and time > now() - ($2 || ' minutes')::interval
    )
    select date_bin($3::interval, time, now() - ($2 || ' minutes')::interval) as bucket,
           avg(dt) filter (where dt > 0 and dt < 600) as block_time_s,
           sum(signature_count)::float8 / nullif(sum(validator_count), 0) * 100 as signing_rate,
           count(*)::int as n
    from b
    group by bucket order by bucket
    `,
    [chainId, windowMinutes, width],
  );
  return r.rows;
}

export type RecentBlockRow = { height: number; signature_count: number | null; validator_count: number | null };

/**
 * Per-block signature counts for the newest N blocks, oldest first — backs the
 * 100-segment signing strip, which needs block granularity rather than an
 * average.
 */
export async function recentBlockSigning(
  pool: pg.Pool,
  chainId: number,
  limit: number,
): Promise<RecentBlockRow[]> {
  const r = await pool.query<RecentBlockRow>(
    `select height, signature_count, validator_count from (
       select height, signature_count, validator_count
       from blocks where chain_id = $1 order by height desc limit $2
     ) t order by height asc`,
    [chainId, limit],
  );
  return r.rows;
}

export type HourRow = { hour: Date; n: number };

export async function blocksPerHour(pool: pg.Pool, chainId: number): Promise<HourRow[]> {
  const r = await pool.query<HourRow>(
    `select date_trunc('hour', time) as hour, count(*)::int as n
     from blocks where chain_id = $1 and time > now() - interval '24 hours'
     group by hour order by hour`,
    [chainId],
  );
  return r.rows;
}

export type MetricStatsRow = {
  avg_block_time_s: number | null;
  p95_block_time_s: number | null;
  blocks_24h: number;
  signing_rate_24h: number | null;
};

export async function metricStats(pool: pg.Pool, chainId: number): Promise<MetricStatsRow> {
  const r = await pool.query<MetricStatsRow>(
    `
    with b as (
      select signature_count, validator_count,
             extract(epoch from (time - lag(time) over (order by height)))::float8 as dt
      from blocks
      where chain_id = $1 and time > now() - interval '24 hours'
    )
    select avg(dt) filter (where dt > 0 and dt < 600) as avg_block_time_s,
           percentile_cont(0.95) within group (order by dt)
             filter (where dt > 0 and dt < 600) as p95_block_time_s,
           count(*)::int as blocks_24h,
           sum(signature_count)::float8 / nullif(sum(validator_count), 0) * 100 as signing_rate_24h
    from b
    `,
    [chainId],
  );
  return r.rows[0];
}
