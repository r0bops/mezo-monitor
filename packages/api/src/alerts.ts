/**
 * Alert rules and their evaluator.
 *
 * Rules are stored so they can be toggled, but they are deliberately not a
 * separate ingestion path: every rule reads the same derived metrics the API
 * already serves. Evaluation is edge-triggered — an event is opened when a
 * condition starts holding and resolved when it stops, so the event feed reads
 * as a history rather than a re-firing every tick.
 */
import type pg from "pg";
import { LONG_WINDOW, SHORT_WINDOW, type ValidatorRow } from "./queries.js";

export type Severity = "critical" | "warning" | "info";

export type DefaultRule = {
  name: string;
  metric: string;
  comparator: "gt" | "lt" | "gte" | "lte";
  threshold: number;
  severity: Severity;
  channel: string;
  enabled: boolean;
};

export const DEFAULT_RULES: DefaultRule[] = [
  {
    name: "Missed streak",
    metric: "missed_streak",
    comparator: "gte",
    threshold: 5,
    severity: "critical",
    channel: "Webhook · PagerDuty",
    enabled: true,
  },
  {
    name: "Validator uptime",
    metric: "uptime_1000",
    comparator: "lt",
    threshold: 99,
    severity: "warning",
    channel: "Webhook · Slack",
    enabled: true,
  },
  {
    name: "Indexer lag",
    metric: "indexer_lag",
    comparator: "gt",
    threshold: 50,
    severity: "critical",
    channel: "Webhook · PagerDuty",
    enabled: true,
  },
  {
    name: "Block time",
    metric: "block_time",
    comparator: "gt",
    threshold: 6,
    severity: "warning",
    channel: "Webhook · Slack",
    enabled: true,
  },
  {
    name: "Validator set change",
    metric: "vset_change",
    comparator: "gt",
    threshold: 0,
    severity: "info",
    channel: "Email digest",
    enabled: false,
  },
];

export type RuleRow = {
  id: number;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  severity: string;
  channel: string | null;
  webhook_url: string | null;
  enabled: boolean;
};

/** Insert the default rule set once per chain; existing rules are left alone. */
export async function seedRules(pool: pg.Pool, chainId: number): Promise<void> {
  for (const r of DEFAULT_RULES) {
    await pool.query(
      `insert into alert_rules (chain_id, name, metric, comparator, threshold, severity, channel, enabled)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (chain_id, name) do nothing`,
      [chainId, r.name, r.metric, r.comparator, r.threshold, r.severity, r.channel, r.enabled],
    );
  }
}

export async function listRules(pool: pg.Pool, chainId: number): Promise<RuleRow[]> {
  const r = await pool.query<RuleRow>(
    `select id, name, metric, comparator, threshold, severity, channel, webhook_url, enabled
     from alert_rules where chain_id = $1 order by id`,
    [chainId],
  );
  return r.rows;
}

/** Set (or clear, with null) a rule's webhook endpoint. */
export async function setRuleWebhook(
  pool: pg.Pool,
  chainId: number,
  id: number,
  webhookUrl: string | null,
): Promise<RuleRow | null> {
  const r = await pool.query<RuleRow>(
    `update alert_rules set webhook_url = $3, updated_at = now()
     where chain_id = $1 and id = $2
     returning id, name, metric, comparator, threshold, severity, channel, webhook_url, enabled`,
    [chainId, id, webhookUrl],
  );
  return r.rows[0] ?? null;
}

export async function setRuleEnabled(
  pool: pg.Pool,
  chainId: number,
  id: number,
  enabled: boolean,
): Promise<RuleRow | null> {
  const r = await pool.query<RuleRow>(
    `update alert_rules set enabled = $3, updated_at = now()
     where chain_id = $1 and id = $2
     returning id, name, metric, comparator, threshold, severity, channel, webhook_url, enabled`,
    [chainId, id, enabled],
  );
  return r.rows[0] ?? null;
}

export type EventRow = {
  id: number;
  rule_id: number | null;
  severity: string;
  title: string;
  body: string;
  subject: string | null;
  height: number | null;
  fired_at: Date;
  resolved_at: Date | null;
  delivered_at: Date | null;
  resolved_delivered_at: Date | null;
  delivery_attempts: number;
  delivery_error: string | null;
};

export async function listEvents(
  pool: pg.Pool,
  chainId: number,
  limit: number,
): Promise<EventRow[]> {
  const r = await pool.query<EventRow>(
    `select id, rule_id, severity, title, body, subject, height, fired_at, resolved_at,
            delivered_at, resolved_delivered_at, delivery_attempts, delivery_error
     from alert_events where chain_id = $1
     order by coalesce(resolved_at, fired_at) desc, id desc limit $2`,
    [chainId, limit],
  );
  return r.rows;
}

function compare(value: number, comparator: string, threshold: number): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    default:
      return false;
  }
}

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export type EvalInput = {
  chainId: number;
  validators: ValidatorRow[];
  indexerLag: number | null;
  avgBlockTimeS: number | null;
  height: number | null;
};

/** One violation currently holding: `subject` is null for network-wide rules. */
type Violation = { subject: string | null; body: string };

function violationsFor(rule: RuleRow, input: EvalInput): Violation[] {
  const out: Violation[] = [];
  switch (rule.metric) {
    case "missed_streak":
      for (const v of input.validators) {
        if (compare(v.missed_streak, rule.comparator, rule.threshold)) {
          out.push({
            subject: v.address,
            body: `${short(v.address)} · missed_streak = ${v.missed_streak}`,
          });
        }
      }
      break;
    case "uptime_1000":
      for (const v of input.validators) {
        // An empty window is not a violation — it's an unbackfilled window.
        if (v.slots_short === 0) continue;
        const pct = (v.signed_short / v.slots_short) * 100;
        if (compare(pct, rule.comparator, rule.threshold)) {
          out.push({
            subject: v.address,
            body: `${short(v.address)} · uptime_${SHORT_WINDOW} = ${pct.toFixed(1)}%`,
          });
        }
      }
      break;
    case "indexer_lag":
      if (input.indexerLag !== null && compare(input.indexerLag, rule.comparator, rule.threshold)) {
        out.push({ subject: null, body: `indexer is ${input.indexerLag} blocks behind chain head` });
      }
      break;
    case "block_time":
      if (
        input.avgBlockTimeS !== null &&
        compare(input.avgBlockTimeS, rule.comparator, rule.threshold)
      ) {
        out.push({
          subject: null,
          body: `avg_block_time_100 = ${input.avgBlockTimeS.toFixed(2)}s`,
        });
      }
      break;
    // vset_change is edge-driven off validator_set_changes, handled separately.
    default:
      break;
  }
  return out;
}

/**
 * Evaluate every enabled rule and reconcile open events against what is
 * currently violating. Returns the number of events opened and resolved.
 */
export async function evaluate(
  pool: pg.Pool,
  input: EvalInput,
): Promise<{ opened: number; resolved: number }> {
  const rules = await listRules(pool, input.chainId);
  let opened = 0;
  let resolved = 0;

  for (const rule of rules) {
    if (rule.metric === "vset_change") {
      if (rule.enabled) opened += await syncSetChangeEvents(pool, input.chainId, rule);
      continue;
    }

    const open = await pool.query<{ id: number; subject: string | null }>(
      `select id, subject from alert_events
       where chain_id = $1 and rule_id = $2 and resolved_at is null`,
      [input.chainId, rule.id],
    );
    const openBySubject = new Map(open.rows.map((r) => [r.subject ?? "", r.id]));

    const firing = rule.enabled ? violationsFor(rule, input) : [];
    const firingKeys = new Set(firing.map((v) => v.subject ?? ""));

    for (const v of firing) {
      const key = v.subject ?? "";
      if (openBySubject.has(key)) continue;
      await pool.query(
        `insert into alert_events (chain_id, rule_id, severity, title, body, subject, height)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [input.chainId, rule.id, rule.severity, rule.name, v.body, v.subject, input.height],
      );
      opened++;
    }

    for (const [key, id] of openBySubject) {
      if (firingKeys.has(key)) continue;
      await pool.query(`update alert_events set resolved_at = now() where id = $1`, [id]);
      resolved++;
    }
  }

  return { opened, resolved };
}

/**
 * Validator-set changes are discrete facts, not thresholds: emit one event per
 * recorded change, deduplicated on (rule, subject, height).
 */
async function syncSetChangeEvents(
  pool: pg.Pool,
  chainId: number,
  rule: RuleRow,
): Promise<number> {
  const r = await pool.query<{ inserted: number }>(
    `
    with recent as (
      select height, validator_address, change_type, time
      from validator_set_changes
      where chain_id = $1
      order by height desc limit 50
    ),
    ins as (
      insert into alert_events (chain_id, rule_id, severity, title, body, subject, height, fired_at)
      select $1, $2, $3,
             case when r.change_type = 'added'
                  then 'Validator added to set' else 'Validator removed from set' end,
             substring(r.validator_address for 6) || '…' ||
               right(r.validator_address, 4) || ' · height ' || r.height,
             r.validator_address, r.height, r.time
      from recent r
      where not exists (
        select 1 from alert_events e
        where e.chain_id = $1 and e.rule_id = $2
          and e.subject = r.validator_address and e.height = r.height
      )
      returning 1
    )
    select count(*)::int as inserted from ins
    `,
    [chainId, rule.id, rule.severity],
  );
  return r.rows[0]?.inserted ?? 0;
}

export { SHORT_WINDOW, LONG_WINDOW };
