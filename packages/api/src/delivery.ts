/**
 * Webhook delivery for alert events.
 *
 * Delivery runs as a separate pass rather than inline with evaluation, so a
 * dead endpoint can never stall or abort alerting — a failed send simply stays
 * pending and is retried on a later tick with backoff.
 *
 * The payload is plain JSON with a `text` summary field, which is what Slack
 * and Discord incoming webhooks render, while the structured fields carry the
 * detail for anything else.
 */
import type pg from "pg";

/** Give up after this many attempts; the error is kept for display. */
const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 8_000;
/** Backoff schedule by attempt count, in seconds. */
const BACKOFF_S = [0, 30, 120, 600, 1_800];

type PendingRow = {
  id: number;
  severity: string;
  title: string;
  body: string;
  subject: string | null;
  height: number | null;
  fired_at: Date;
  resolved_at: Date | null;
  delivery_attempts: number;
  rule_name: string;
  rule_metric: string;
  rule_threshold: number;
  webhook_url: string;
  /** Which transition still needs sending. */
  phase: "firing" | "resolved";
};

/**
 * Events with a webhook configured whose firing or resolution has not yet been
 * delivered, and whose backoff has elapsed.
 */
async function pending(pool: pg.Pool, chainId: number): Promise<PendingRow[]> {
  const r = await pool.query<PendingRow>(
    `
    select e.id, e.severity, e.title, e.body, e.subject, e.height,
           e.fired_at, e.resolved_at, e.delivery_attempts,
           r.name as rule_name, r.metric as rule_metric, r.threshold as rule_threshold,
           r.webhook_url,
           case when e.resolved_at is not null and e.resolved_delivered_at is null
                then 'resolved' else 'firing' end as phase
    from alert_events e
    join alert_rules r on r.id = e.rule_id
    where e.chain_id = $1
      and r.webhook_url is not null
      and r.enabled
      and e.delivery_attempts < $2
      and (
        (e.resolved_at is null and e.delivered_at is null)
        or (e.resolved_at is not null and e.resolved_delivered_at is null)
      )
      -- Backoff: the wait grows with the attempt count, indexed out of the
      -- schedule below (Postgres arrays are 1-based, hence the +1).
      and (
        e.delivery_attempt_at is null
        or e.delivery_attempt_at < now() - make_interval(secs =>
             ($3::int[])[least(e.delivery_attempts, array_length($3::int[], 1) - 1) + 1])
      )
    order by e.fired_at
    limit 50
    `,
    [chainId, MAX_ATTEMPTS, BACKOFF_S],
  );
  return r.rows;
}

function summarise(row: PendingRow, chainId: string): string {
  const state = row.phase === "resolved" ? "RESOLVED" : row.severity.toUpperCase();
  return `[${state}] ${row.title} — ${row.body} (${chainId})`;
}

/**
 * Send every pending notification. Returns counts so the caller can log a
 * single line rather than one per event.
 */
export async function deliverPending(
  pool: pg.Pool,
  chainId: number,
  chainName: string,
): Promise<{ sent: number; failed: number }> {
  const rows = await pending(pool, chainId);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = {
      text: summarise(row, chainName),
      state: row.phase,
      severity: row.severity,
      chain: chainName,
      rule: { name: row.rule_name, metric: row.rule_metric, threshold: row.rule_threshold },
      event: {
        id: row.id,
        title: row.title,
        body: row.body,
        subject: row.subject,
        height: row.height,
        fired_at: row.fired_at,
        resolved_at: row.resolved_at,
      },
    };

    try {
      const res = await fetch(row.webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const column = row.phase === "resolved" ? "resolved_delivered_at" : "delivered_at";
      await pool.query(
        `update alert_events
         set ${column} = now(), delivery_attempt_at = now(), delivery_error = null
         where id = $1`,
        [row.id],
      );
      sent++;
    } catch (e) {
      await pool.query(
        `update alert_events
         set delivery_attempts = delivery_attempts + 1,
             delivery_attempt_at = now(),
             delivery_error = $2
         where id = $1`,
        [row.id, (e as Error).message.slice(0, 500)],
      );
      failed++;
    }
  }

  return { sent, failed };
}

export { MAX_ATTEMPTS };
