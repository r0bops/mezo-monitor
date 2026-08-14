/** Alerts: rule list with live toggles, plus the event feed. */
import { useState } from "react";
import type { Dashboard } from "../useDashboard";
import { setAlertRuleEnabled, type AlertEvent, type AlertRule } from "../api";
import { BAD, OK, SeverityChip, TX, TX2, TX3, WARN, mono, panel, sans } from "../components/ui";
import { agoFrom, fmt } from "../lib";

export function Alerts({ d }: { d: Dashboard }) {
  const [pending, setPending] = useState<number | null>(null);
  const rules = d.alerts?.rules ?? [];
  const events = d.alerts?.events ?? [];

  const toggle = async (rule: AlertRule) => {
    if (!d.alerts) return;
    setPending(rule.id);
    // Optimistic: the toggle animates immediately, then reconciles.
    const next = { ...rule, enabled: !rule.enabled };
    d.setAlerts({ ...d.alerts, rules: rules.map((r) => (r.id === rule.id ? next : r)) });
    try {
      const saved = await setAlertRuleEnabled(rule.id, next.enabled);
      d.setAlerts({
        rules: rules.map((r) => (r.id === saved.id ? saved : r)),
        events: d.alerts.events,
      });
    } catch {
      d.setAlerts({ ...d.alerts, rules });
    } finally {
      setPending(null);
    }
  };

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <section style={{ ...panel, flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 12px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Alert rules</h2>
          <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
            evaluated every 30s
          </span>
        </div>

        {rules.length === 0 && (
          <div style={{ padding: "48px 16px", textAlign: "center", font: `400 12px/1.5 ${sans}`, color: TX3 }}>
            No rules configured. The API seeds a default set once the indexer registers a chain.
          </div>
        )}

        {rules.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
              borderBottom: "1px solid var(--line)",
              opacity: pending === a.id ? 0.6 : 1,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ font: `600 12.5px/1 ${sans}`, color: TX }}>{a.name}</span>
                <SeverityChip severity={a.severity} />
              </div>
              <span style={{ font: `400 11px/1 ${mono}`, color: TX2 }}>{condition(a)}</span>
              <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3 }}>
                {a.channel ?? "—"}
                {a.webhook_url ? (
                  <span style={{ color: OK }}> · webhook configured</span>
                ) : (
                  <span> · no webhook — dashboard only</span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void toggle(a)}
              aria-pressed={a.enabled}
              aria-label={`${a.enabled ? "Disable" : "Enable"} ${a.name}`}
              style={{
                position: "relative",
                width: 32,
                height: 18,
                borderRadius: 10,
                flex: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: a.enabled ? OK : "var(--line2)",
                transition: "background .15s ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: a.enabled ? 16 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,.3)",
                  display: "block",
                  transition: "left .15s ease",
                }}
              />
            </button>
          </div>
        ))}
      </section>

      <section style={{ ...panel, width: 440, flex: "none", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--line)" }}>
          <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Recent events</h2>
        </div>
        {events.length === 0 && (
          <div style={{ padding: "48px 16px", textAlign: "center", font: `400 12px/1.5 ${sans}`, color: TX3 }}>
            Nothing has fired yet.
          </div>
        )}
        {events.map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 11, padding: "13px 16px", borderBottom: "1px solid var(--line)" }}>
            <SeverityChip severity={e.resolved_at ? "Resolved" : e.severity} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
              <span style={{ font: `600 12px/1.3 ${sans}`, color: TX }}>{e.title}</span>
              <span style={{ font: `400 11px/1.3 ${mono}`, color: TX2 }}>{e.body}</span>
              <DeliveryNote event={e} />
            </div>
            <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3, flex: "none" }}>
              {agoFrom(e.resolved_at ?? e.fired_at)} ago
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Delivery state per event. A webhook that is silently failing is worse than no
 * webhook, so a failed send is shown in full rather than hidden.
 */
function DeliveryNote({ event }: { event: AlertEvent }) {
  const needsResolveSend = event.resolved_at !== null && event.resolved_delivered_at === null;
  const pending = event.delivered_at === null || needsResolveSend;

  if (event.delivery_error) {
    return (
      <span style={{ font: `400 10px/1.3 ${mono}`, color: BAD }}>
        delivery failed after {event.delivery_attempts} attempt
        {event.delivery_attempts === 1 ? "" : "s"} · {event.delivery_error}
      </span>
    );
  }
  if (event.delivered_at && !needsResolveSend) {
    return <span style={{ font: `400 10px/1.3 ${mono}`, color: TX3 }}>delivered</span>;
  }
  if (pending && event.delivery_attempts > 0) {
    return (
      <span style={{ font: `400 10px/1.3 ${mono}`, color: WARN }}>
        delivery pending · {event.delivery_attempts} attempt
        {event.delivery_attempts === 1 ? "" : "s"}
      </span>
    );
  }
  return null;
}

/** Render a stored rule back into the condition string the design shows. */
function condition(a: AlertRule): string {
  const op = { gt: ">", gte: "≥", lt: "<", lte: "≤" }[a.comparator] ?? a.comparator;
  switch (a.metric) {
    case "missed_streak":
      return `missed_streak ${op} ${fmt(a.threshold)} consecutive blocks`;
    case "uptime_1000":
      return `uptime_1000 ${op} ${a.threshold}%`;
    case "indexer_lag":
      return `latest_indexed_height behind head ${op} ${fmt(a.threshold)} blocks`;
    case "block_time":
      return `avg_block_time_100 ${op} ${a.threshold.toFixed(1)}s`;
    case "vset_change":
      return "any row in validator_set_changes";
    default:
      return `${a.metric} ${op} ${a.threshold}`;
  }
}
