/** API & Docs: the live endpoint surface with sample payloads. */
import type { Dashboard } from "../useDashboard";
import { BRAND, Label, OK, TX, TX2, TX3, WARN, mono, panel, sans } from "../components/ui";

type Endpoint = { method: "GET" | "PATCH"; path: string; desc: string; sample: string[] };

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/network",
    desc: "Latest height, avg block time (100-block window), signing rate, active validator count and indexer lag against chain head.",
    sample: [
      "{",
      '  "status": "normal",',
      '  "latest_indexed_height": 11058306,',
      '  "avg_block_time_ms": 3590,',
      '  "signing_rate_100": 100,',
      '  "active_validators": 20,',
      '  "chain_head_height": 11058306,',
      '  "indexer_lag_blocks": 0',
      "}",
    ],
  },
  {
    method: "GET",
    path: "/api/v1/validators",
    desc: "List with uptime % over both windows, missed streak and proposer share. Moniker is null on a PoA chain that exposes none.",
    sample: [
      "{",
      '  "count": 20,',
      '  "validators": [',
      "    {",
      '      "rank": 1,',
      '      "address": "4A287C1B…6844",',
      '      "moniker": null,',
      '      "uptime_1000": 99.8,',
      '      "uptime_10000": 99.68,',
      '      "missed_streak": 0,',
      '      "proposer_share_1000": 5.1',
      "    }",
      "  ]",
      "}",
    ],
  },
  {
    method: "GET",
    path: "/api/v1/validators/:address",
    desc: "Detail plus the signing slots that back the heatmap. `signed: null` means the validator was outside the set at that height.",
    sample: [
      "{",
      '  "window": 500,',
      '  "slots": [',
      '    { "height": 11058306, "signed": true },',
      '    { "height": 11058305, "signed": false },',
      '    { "height": 11058304, "signed": null }',
      "  ]",
      "}",
    ],
  },
  {
    method: "GET",
    path: "/api/v1/validator-set",
    desc: "Current membership with voting power and first/last seen heights, plus the recorded add/remove history.",
    sample: [
      "{",
      '  "set_size": 20,',
      '  "total_voting_power": 20000,',
      '  "bootstrap": false,',
      '  "changes": [',
      '    { "height": 11041882, "address": "A34F9C…21DB", "type": "added" }',
      "  ]",
      "}",
    ],
  },
  {
    method: "GET",
    path: "/api/v1/metrics",
    desc: "24-hour aggregates: avg and p95 block time, blocks indexed, signing rate, bucketed series and proposer distribution.",
    sample: [
      "{",
      '  "stats": {',
      '    "avg_block_time_s": 3.59,',
      '    "p95_block_time_s": 4.12,',
      '    "blocks_24h": 24061,',
      '    "signing_rate_24h": 99.98',
      "  }",
      "}",
    ],
  },
  {
    method: "GET",
    path: "/api/v1/series?minutes=60&buckets=60",
    desc: "Block time, signing rate and block count bucketed over a trailing window. Drives the sparklines and 60-minute charts.",
    sample: [
      "{",
      '  "minutes": 60,',
      '  "points": [',
      '    { "t": "2026-08-13T09:00:00Z", "block_time_s": 3.59, "signing_rate": 100, "n": 17 }',
      "  ]",
      "}",
    ],
  },
  {
    method: "GET",
    path: "/api/v1/alerts",
    desc: "Alert rules and the event feed. Events are edge-triggered: opened when a condition starts holding, resolved when it clears.",
    sample: [
      "{",
      '  "rules": [',
      '    { "id": 1, "name": "Missed streak", "metric": "missed_streak", "threshold": 5, "enabled": true }',
      "  ],",
      '  "events": [',
      '    { "severity": "warning", "title": "Validator uptime", "resolved_at": null }',
      "  ]",
      "}",
    ],
  },
  {
    method: "PATCH",
    path: "/api/v1/alerts/rules/:id",
    desc: "Enable or disable a rule. Body: { enabled: boolean }.",
    sample: ["{", '  "id": 1,', '  "name": "Missed streak",', '  "enabled": false', "}"],
  },
  {
    method: "GET",
    path: "/api/v1/config",
    desc: "Chain identity, capability flags and indexer settings. RPC credentials are redacted.",
    sample: [
      "{",
      '  "chain": { "chain_id": "mezo_31612-1", "family": "cometbft" },',
      '  "capabilities": { "poa": true, "delegations": false },',
      '  "windows": { "short": 1000, "long": 10000 }',
      "}",
    ],
  },
];

export function ApiDocs({ d }: { d: Dashboard }) {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const explorer = d.net?.chain.blockscout_url;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <section
        style={{
          ...panel,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>Base URL</Label>
          <span style={{ font: `500 14px/1 ${mono}`, color: TX }}>{base}</span>
        </div>
        <span style={{ font: `400 11px/1.5 ${sans}`, color: TX3, maxWidth: 420, textAlign: "right" }}>
          Consensus-level analytics only. Transaction detail is served by Blockscout
          {explorer ? ` at ${new URL(explorer).host}` : ""}.
        </span>
      </section>

      {ENDPOINTS.map((e) => (
        <section key={`${e.method} ${e.path}`} style={{ ...panel, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                font: `600 10px/1 ${mono}`,
                letterSpacing: ".06em",
                background: e.method === "GET" ? "var(--okSoft)" : "var(--warnSoft)",
                color: e.method === "GET" ? OK : WARN,
              }}
            >
              {e.method}
            </span>
            <span style={{ font: `500 13px/1 ${mono}`, color: TX }}>{e.path}</span>
          </div>
          <div style={{ padding: "13px 18px 0" }}>
            <span style={{ font: `400 12px/1.5 ${sans}`, color: TX2 }}>{e.desc}</span>
          </div>
          <div
            style={{
              margin: "13px 18px 18px",
              padding: "14px 16px",
              borderRadius: 9,
              background: "var(--panel2)",
              border: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {e.sample.map((line, i) => (
              <JsonLine key={i} raw={line} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Minimal JSON colouriser — key in brand, string in ok, literal in warn. */
function JsonLine({ raw }: { raw: string }) {
  const m = raw.match(/^(\s*)("[^"]+"):\s*(.*)$/);
  const style = { font: `400 11.5px/1.5 ${mono}`, whiteSpace: "pre" as const };
  if (!m) {
    const indent = (raw.match(/^\s*/)?.[0] ?? "").replace(/ /g, " ");
    return (
      <span style={style}>
        {indent}
        <span style={{ color: TX2 }}>{raw.trim()}</span>
      </span>
    );
  }
  const value = m[3];
  const color = /^"/.test(value)
    ? OK
    : /^(true|false|null)/.test(value)
      ? WARN
      : /^[[{]/.test(value)
        ? TX2
        : BRAND;
  return (
    <span style={style}>
      {m[1].replace(/ /g, " ")}
      <span style={{ color: BRAND }}>{m[2]}</span>
      <span style={{ color: TX3 }}>: </span>
      <span style={{ color }}>{value}</span>
    </span>
  );
}
