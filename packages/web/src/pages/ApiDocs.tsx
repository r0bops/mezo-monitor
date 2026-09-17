/** API & Docs: the live endpoint surface; every sample is a real response. */
import { useCallback, useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { BRAND, Label, OK, TX, TX2, TX3, WARN, mono, panel, sans } from "../components/ui";

type Endpoint = {
  method: "GET" | "PATCH";
  path: string;
  desc: string;
  /** Query this to fill the sample with a REAL response. Absent for mutations. */
  fetchUrl?: string;
  /** For mutations: the request body shape (a request, not a faked response). */
  requestBody?: string[];
};

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/network",
    fetchUrl: "/api/v1/network",
    desc: "Latest height, avg block time (100-block window), signing rate, active validator count and indexer lag against chain head.",
  },
  {
    method: "GET",
    path: "/api/v1/validators",
    fetchUrl: "/api/v1/validators",
    desc: "List with moniker/local label, uptime % over both windows, missed streak and proposer share.",
  },
  {
    method: "PATCH",
    path: "/api/v1/validators/:address",
    requestBody: ["{", '  "label": "our-mainnet-node",', '  "watched": true', "}"],
    desc: "Set (or clear, with null) a validator's local label and watched flag. Labels are operator-local and never overwritten by ingestion. Mutations are refused on the public facade.",
  },
  {
    method: "GET",
    path: "/api/v1/validator-set",
    fetchUrl: "/api/v1/validator-set",
    desc: "Current set membership plus add/remove history. `signed: null` in slot data means the validator was outside the set at that height.",
  },
  {
    method: "GET",
    path: "/api/v1/validators/:address?window=500",
    fetchUrl: "/api/v1/validators/:address?window=100",
    desc: "Detail plus the signing slots that back the heatmap, over the requested window (capped at 5,000).",
  },
  {
    method: "GET",
    path: "/api/v1/metrics?hours=24|168|720",
    fetchUrl: "/api/v1/metrics?hours=24",
    desc: "Aggregates over a trailing 24h/7d/30d horizon (default 24): avg and p95 block time, blocks indexed, signing rate, bucketed series, per-hour or per-day volume and proposer distribution.",
  },
  {
    method: "GET",
    path: "/api/v1/series?minutes=60&buckets=60",
    fetchUrl: "/api/v1/series?minutes=60&buckets=12",
    desc: "Block time, signing rate and block count bucketed over a trailing window. Drives the sparklines and charts.",
  },
  {
    method: "GET",
    path: "/api/v1/endpoints",
    fetchUrl: "/api/v1/endpoints",
    desc: "Endpoint health: priority, active/pinned state, latency, last height and error. Node URLs are credential-redacted.",
  },
  {
    method: "PATCH",
    path: "/api/v1/endpoints/:id",
    requestBody: ["{", '  "pinned": true', "}"],
    desc: "Pin an endpoint (forcing it active) or release it back to automatic selection. Mutations are refused on the public facade.",
  },
  {
    method: "GET",
    path: "/api/v1/config",
    fetchUrl: "/api/v1/config",
    desc: "Chain identity, capability flags and indexer settings. RPC credentials are redacted.",
  },
];

/** Keep the sample readable: long arrays keep their first items and say how much was cut. */
function trimJson(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, 3).map((v) => trimJson(v, depth + 1));
    return value.length > 3 ? [...head, `… +${value.length - 3} more`] : head;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === "slots" || k === "points" || k === "series" || k === "changes" || k === "volume"
        ? trimJson(v, depth + 1)
        : v;
    }
    // volume/points objects shrink their inner arrays too
    for (const [k, v] of Object.entries(out)) {
      if (v && typeof v === "object" && !Array.isArray(v)) out[k] = trimJson(v, depth + 1);
    }
    return out;
  }
  return value;
}

type SampleState = { lines: string[]; error: string | null; at: Date } | null;

export function ApiDocs({ d }: { d: Dashboard }) {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const explorer = d.net?.chain.blockscout_url;
  const firstValidator = d.validators[0]?.address;
  const [samples, setSamples] = useState<Record<string, SampleState>>({});

  const load = useCallback(async () => {
    const next: Record<string, SampleState> = {};
    await Promise.all(
      ENDPOINTS.filter((e) => e.fetchUrl).map(async (e) => {
        const url = e.fetchUrl!.replace(":address", encodeURIComponent(firstValidator ?? ""));
        try {
          const r = await fetch(url, { headers: { accept: "application/json" } });
          const body = (await r.json()) as unknown;
          next[`${e.method} ${e.path}`] = {
            lines: JSON.stringify(trimJson(body), null, 2).split("\n"),
            error: null,
            at: new Date(),
          };
        } catch (err) {
          next[`${e.method} ${e.path}`] = { lines: [], error: (err as Error).message, at: new Date() };
        }
      }),
    );
    setSamples(next);
  }, [firstValidator]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="api-docs-page" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <section
        className="api-docs-intro"
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <span style={{ font: `400 11px/1.5 ${sans}`, color: TX3, maxWidth: 380, textAlign: "right" }}>
            Every sample below is a live response from this deployment — no canned payloads.
            Consensus-level analytics only; transaction detail is Blockscout
            {explorer ? ` (${new URL(explorer).host})` : ""}.
          </span>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--panel2)",
              color: TX2,
              font: `600 11px/1 ${sans}`,
              cursor: "pointer",
            }}
          >
            Refetch samples
          </button>
        </div>
      </section>

      {ENDPOINTS.map((e) => {
        const key = `${e.method} ${e.path}`;
        const sample = samples[key];
        return (
          <section key={key} style={{ ...panel, overflow: "hidden" }}>
            <div
              className="api-endpoint-head"
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
              <span className="api-endpoint-path" style={{ font: `500 13px/1 ${mono}`, color: TX }}>{e.path}</span>
              <span className="api-endpoint-status" style={{ marginLeft: "auto", font: `400 10px/1 ${sans}`, color: TX3 }}>
                {sample?.error
                  ? `live fetch failed: ${sample.error}`
                  : sample
                    ? `live · ${sample.at.toLocaleTimeString()}`
                    : e.requestBody
                      ? "request body"
                      : "fetching…"}
              </span>
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
                maxHeight: 340,
                overflow: "auto",
              }}
            >
              {(e.requestBody ?? sample?.lines ?? []).map((line, i) => (
                <JsonLine key={i} raw={line} />
              ))}
              {!e.requestBody && !sample && (
                <span style={{ font: `400 11.5px/1.5 ${mono}`, color: TX3 }}>…</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Minimal JSON colouriser — key in brand, string in ok, literal in warn. */
function JsonLine({ raw }: { raw: string }) {
  const m = raw.match(/^(\s*)("[^"]+"):\s*(.*)$/);
  const style = { font: `400 11.5px/1.5 ${mono}`, whiteSpace: "pre" as const };
  if (!m) {
    const indent = (raw.match(/^\s*/)?.[0] ?? "").replace(/ /g, " ");
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
      {m[1].replace(/ /g, " ")}
      <span style={{ color: BRAND }}>{m[2]}</span>
      <span style={{ color: TX3 }}>: </span>
      <span style={{ color }}>{value}</span>
    </span>
  );
}
