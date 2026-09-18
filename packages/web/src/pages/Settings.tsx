/** Settings: chain identity, endpoint management, capability flags, indexer
 *  config and security posture — laid out like the reference mockup. */
import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Theme } from "../App";
import type { Endpoint } from "../api";
import { setEndpointPinned } from "../api";
import { probeNode, type NodeProbe } from "../nodeRpc";
import { get } from "../api";
import {
  BAD,
  BRAND,
  CopyButton,
  OK,
  TX,
  TX2,
  TX3,
  WARN,
  mono,
  panel,
  sans,
} from "../components/ui";
import { copyText, fmt } from "../lib";

export function Settings({
  d,
  theme,
  onTheme,
}: {
  d: Dashboard;
  theme: Theme;
  onTheme: (t: Theme) => void;
}) {
  const cfg = d.config;
  const caps = cfg?.capabilities ?? d.net?.chain.capabilities;
  const [probes, setProbes] = useState<Record<number, NodeProbe | "loading">>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [pinning, setPinning] = useState<number | null>(null);
  /** The build this page runs, vs the build the server has deployed — the
   *  at-a-glance answer to "is it deployed?" without trusting anyone's
   *  cache. Both shown under Indexer Settings → builds. */
  const [deployed, setDeployed] = useState<string | null>(null);
  useEffect(() => {
    get<{ web: string | null }>("/api/v1/version")
      .then((v: { web: string | null }) => setDeployed(v.web))
      .catch(() => {});
  }, []);

  const onCopy = (value: string) => {
    void copyText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 2600);
  };

  const runProbe = (id: number, url: string | null) => {
    if (!url) return;
    setProbes((p) => ({ ...p, [id]: "loading" }));
    probeNode(url).then((r) => setProbes((p) => ({ ...p, [id]: r })));
  };

  /** Pinning an endpoint makes it active and unpins the rest — same
   *  reconciliation the header switcher does. */
  const makeActive = async (e: Endpoint) => {
    if (!d.endpoints || e.is_active) return;
    setPinning(e.id);
    try {
      const saved = await setEndpointPinned(e.id, true);
      d.setEndpoints({
        count: d.endpoints.count,
        endpoints: (d.endpoints.endpoints ?? []).map((x) =>
          x.id === saved.id
            ? saved
            : { ...x, pinned: false, is_active: saved.pinned ? false : x.is_active },
        ),
      });
    } catch {
      /* the next poll re-syncs */
    } finally {
      setPinning(null);
    }
  };

  // Which bundle THIS page is executing — same extraction the version check
  // uses, so "yours" vs "deployed" below are directly comparable.
  const running =
    document.querySelector('script[src*="assets/index-"]')?.getAttribute("src")?.match(/index-([^.]+)\.js/)?.[1] ??
    "?";
  const deployedShort = deployed?.match(/index-([^.]+)\.js/)?.[1] ?? null;

  const chainRows: [string, string][] = cfg
    ? [
        ["Slug", cfg.chain.slug],
        ["Name", cfg.chain.name],
        ["Chain ID", cfg.chain.chain_id],
        ["Consensus", `${cfg.chain.family === "cometbft" ? "CometBFT" : cfg.chain.family}${caps?.poa ? " PoA" : ""}`],
        ["Node version", d.net?.node_version ? `v${d.net.node_version}` : "—"],
        ["EVM chain ID", cfg.chain.chain_id.match(/_(\d+)-/)?.[1] ?? "—"],
        ["RPC URL", cfg.chain.rpc_url ?? "—"],
        ["WebSocket URL", cfg.chain.ws_url ?? "—"],
        ["Blockscout URL", cfg.chain.blockscout_url ?? "—"],
      ]
    : [];

  const indexerRows: [string, string, string?][] = cfg
    ? [
        ["Backfill depth", `${fmt(cfg.indexer.backfill_depth)} blocks`, "Number of blocks to backfill on initial sync."],
        ["Poll interval", `${Math.round(cfg.indexer.poll_interval_ms / 1000)} seconds`, "How often to check for new blocks."],
        ["Database engine", cfg.indexer.database, "Database used for indexed data."],
        ["Uptime windows", `${fmt(cfg.windows.short)} / ${fmt(cfg.windows.long)} blocks`, "Window for uptime and availability metrics."],
        ["Monitor build", `mezo-monitor v0.1.0 · ${running}`, "The bundle this page is executing."],
        [
          "Deployed build",
          deployedShort ?? "—",
          deployedShort === running ? "The server serves the bundle you are running." : "The server serves a different bundle — reload to update.",
        ],
      ]
    : [];

  const publicConfig = cfg
    ? JSON.stringify(
        {
          chain: cfg.chain.chain_id,
          rpc: cfg.chain.rpc_url,
          ws: cfg.chain.ws_url,
          explorer: cfg.chain.blockscout_url,
        },
        null,
        2,
      )
    : "";

  const capRows: { name: string; status: string; on: boolean }[] = caps
    ? [
        { name: "Proof-of-Authority", status: caps.poa ? "Enabled" : "Not supported", on: caps.poa },
        { name: "Delegations", status: caps.delegations ? "Enabled" : "Not supported", on: caps.delegations },
        { name: "Governance", status: caps.governance ? "Enabled" : "Not supported", on: caps.governance },
        { name: "Slashing", status: caps.slashing ? "Enabled" : "Not supported", on: caps.slashing },
        {
          name: "Archived data",
          status: d.net?.earliest_indexed_height === 1 ? "Available" : "Not available",
          on: d.net?.earliest_indexed_height === 1,
        },
        { name: "WebSocket support", status: cfg?.chain.ws_url ? "Available" : "Not configured", on: !!cfg?.chain.ws_url },
      ]
    : [];

  return (
    <div className="settings-page" style={{ maxWidth: 1180 }}>
      <section className="settings-card settings-chain-card" style={{ ...panel, overflow: "hidden" }}>
        <PanelHead
          icon="M8.5 11.5L11.5 8.5M7 12l-2.2 2.2a2.6 2.6 0 01-3.7-3.7L5.4 6.2a2.6 2.6 0 013.7 0M13 8l2.2-2.2a2.6 2.6 0 00-3.7-3.7L7.2 6.4"
          title="Chain Configuration"
          subtitle="Core information about the connected chain."
          aside={<Badge text="Read only" lock />}
        />
        {chainRows.length === 0 && <Loading />}
        {chainRows.map(([k, v]) => (
          <div className="settings-row" key={k} style={rowStyle}>
            <span className="settings-key" style={{ font: `500 11.5px/1 ${mono}`, color: TX3, flex: "none", width: 118 }}>{k}</span>
            <span
              className="settings-value"
              style={{
                font: `500 11.5px/1 ${mono}`,
                color: TX,
                flex: 1,
                textAlign: "right",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={v}
            >
              {v}
            </span>
            <CopyButton value={v} copied={copied === v} onCopy={onCopy} />
          </div>
        ))}
      </section>

      <div className="settings-card-grid">
        <section className="settings-card settings-rpc-card" style={{ ...panel, overflow: "hidden" }}>
          <PanelHead
            icon="M10 3.2v3.2M10 13.6v3.2M3.2 10h3.2M13.6 10h3.2M10 7.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"
            title="RPC Endpoints"
            subtitle="Failover order for the nodes feeding the indexer."
            aside={<Badge text="failover order" />}
          />
          <div className="settings-endpoint-head" aria-hidden="true">
            <span>#</span><span>Endpoint</span><span>Status</span><span>Priority</span><span>Latency</span><span>Actions</span>
          </div>
          {(d.endpoints?.endpoints ?? []).length === 0 && <Loading text="Waiting for the endpoint list…" />}
          {(d.endpoints?.endpoints ?? []).map((e, i) => (
            <div className={`settings-endpoint-row${e.is_active ? " active" : ""}`} key={e.id}>
              <span className="settings-endpoint-rank">{i + 1}</span>
              <div className="settings-endpoint-identity" title={e.rpc_url ?? ""}>
                <span className="settings-endpoint-dot" style={{ background: e.healthy ? OK : e.consecutive_failures > 0 ? BAD : WARN }} />
                <span className="settings-endpoint-copy">
                  <strong>{e.label}</strong>
                  <small style={{ color: e.last_error ? BAD : TX3 }}>
                    {e.last_error
                      ? `${e.consecutive_failures} failed check${e.consecutive_failures === 1 ? "" : "s"}`
                      : `Height ${e.last_height != null ? fmt(e.last_height) : "—"}`}
                  </small>
                  {probes[e.id] !== undefined && <ProbeResult p={probes[e.id]} />}
                </span>
              </div>
              <span>{e.is_active ? <Chip text="ACTIVE" color={OK} soft /> : e.pinned ? <Chip text="PINNED" color={BRAND} soft /> : <span className="settings-muted">Standby</span>}</span>
              <span className="settings-priority">{e.priority}</span>
              <span className="settings-latency">{e.latency_ms ?? "—"}{e.latency_ms != null ? "ms" : ""}</span>
              <div className="settings-endpoint-actions">
                <ActionBtn
                  onClick={() => runProbe(e.id, e.rpc_url)}
                  disabled={probes[e.id] === "loading"}
                  title="Ask the node directly from this browser, independent of the monitor"
                >
                  {probes[e.id] === "loading" ? "…" : "Probe"}
                </ActionBtn>
                {!e.is_active && (
                  <ActionBtn brand onClick={() => void makeActive(e)} disabled={pinning === e.id} title="Pin this endpoint — it becomes the active indexer source">
                    {pinning === e.id ? "…" : "Make Active"}
                  </ActionBtn>
                )}
              </div>
            </div>
          ))}
          <div className="settings-endpoint-note">
            <span className="settings-info-icon" aria-hidden="true">i</span>
            <span>
              Endpoints are declared in <code>chains/*.yaml</code>; health and the active choice
              live in the database. Switching changes where new blocks are read from, not the
              history already indexed. Probe asks the node directly from your browser and needs
              the node's CORS permission.
            </span>
          </div>
        </section>

        <section className="settings-card settings-capabilities-card" style={{ ...panel, overflow: "hidden" }}>
          <PanelHead
            icon="M10 2.8l6 2.2v4.4c0 3.5-2.4 6.2-6 7.8-3.6-1.6-6-4.3-6-7.8V5zM7 10l2 2 4-4"
            title="Capabilities"
            subtitle="Chain features detected from the network."
            aside={<Badge text="read-only" />}
          />
          <div style={{ padding: "12px 16px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {capRows.length === 0 && <Loading />}
            {capRows.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "10px 12px",
                  borderRadius: 9,
                  border: "1px solid var(--line)",
                  background: c.on ? "var(--okSoft)" : "var(--panel2)",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 6,
                    background: c.on ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "var(--panel)",
                    color: c.on ? OK : TX3,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {c.on
                      ? <path d="M10 2.8l6 2.2v4.4c0 3.5-2.4 6.2-6 7.8-3.6-1.6-6-4.3-6-7.8V5zM7 10l2 2 4-4" />
                      : <path d="M10 3l7 13H3zM10 8v3.5M10 13.8v.2" />}
                  </svg>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ font: `600 11px/1 ${sans}`, color: TX }}>{c.name}</span>
                  <span style={{ font: `500 10px/1 ${sans}`, color: c.on ? OK : TX3 }}>{c.status}</span>
                </span>
              </div>
            ))}
          </div>
          {caps?.poa && (
            <div style={{ padding: "0 16px 14px" }}>
              <span style={{ font: `400 11px/1.5 ${sans}`, color: TX3 }}>
                This chain is Proof-of-Authority: delegations, governance and slashing are not
                modelled by the indexer.
              </span>
            </div>
          )}
        </section>

        <section className="settings-card settings-indexer-card" style={{ ...panel, overflow: "hidden" }}>
          <PanelHead
            icon="M4 5.5A1.5 1.5 0 015.5 4h9A1.5 1.5 0 0116 5.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 14.5zM4 8h12M8 8v8"
            title="Indexer Settings"
            subtitle="Configuration for the block indexer and data pipeline."
            aside={<Badge text="read-only" />}
          />
          {indexerRows.length === 0 && <Loading />}
          {indexerRows.map(([k, v, hint]) => (
            <div className="settings-row" key={k} style={{ ...rowStyle, alignItems: "flex-start", display: "flex", gap: 16 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: "none", width: 132, paddingTop: 1 }}>
                <span style={{ font: `500 11.5px/1 ${sans}`, color: TX }}>{k}</span>
                {hint && <span style={{ font: `400 9.5px/1.35 ${sans}`, color: TX3 }}>{hint}</span>}
              </span>
              <span
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  font: `500 11.5px/1 ${mono}`,
                  color: TX,
                  textAlign: "right",
                  overflow: "hidden",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                {k === "Deployed build" && deployedShort != null && (
                  <span
                    style={{
                      flex: "none",
                      padding: "3px 7px",
                      borderRadius: 6,
                      font: `600 9px/1 ${sans}`,
                      color: deployedShort === running ? OK : WARN,
                      background: deployedShort === running ? "var(--okSoft)" : "var(--warnSoft)",
                    }}
                  >
                    {deployedShort === running ? "✓ current" : "≠ reload"}
                  </span>
                )}
              </span>
            </div>
          ))}
        </section>

        <section className="settings-card settings-security-card" style={{ ...panel, overflow: "hidden" }}>
          <PanelHead
            icon="M10 2.5l5.5 2v4c0 3.4-2.3 6-5.5 7.5C6.8 14.5 4.5 11.9 4.5 8.5v-4zM10 8v3M10 12.6v.2"
            title="Security / Access"
            subtitle="Access and security information."
          />
          <SecurityRow label="API mode" chip={{ text: "Read-only", color: OK }} note="No write operations from the public site; operator mutations are tailnet-only." />
          <SecurityRow label="CORS" chip={{ text: "Restricted", color: WARN }} note="The API serves no cross-origin headers; browser access is same-origin only." />
          <SecurityRow label="Browser probe" chip={{ text: "Direct", color: OK }} note="The Probe button asks nodes from your browser — the node sees your IP. Monitor health checks run server-side." />
          <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ font: `500 11.5px/1 ${sans}`, color: TX }}>Public configuration</span>
                <span style={{ font: `400 9.5px/1.35 ${sans}`, color: TX3 }}>Share this with your team or embed it in other tools.</span>
              </span>
              <button
                type="button"
                onClick={() => onCopy(publicConfig)}
                style={{
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  color: copied === publicConfig ? OK : TX2,
                  font: `600 10px/1 ${sans}`,
                  cursor: "pointer",
                }}
              >
                <span aria-hidden="true">▣</span>
                {copied === publicConfig ? "Copied" : "Copy JSON"}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel2)",
                color: TX2,
                font: `400 10.5px/1.5 ${mono}`,
                overflow: "auto",
              }}
            >
              {publicConfig || "// waiting for /api/v1/config"}
            </pre>
          </div>
        </section>

        <section className="settings-card settings-appearance-card" style={{ ...panel, overflow: "hidden" }}>
          <PanelHead
            icon="M10 3.4a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4zM4.5 16c.6-2.6 2.9-4 5.5-4s4.9 1.4 5.5 4"
            title="Appearance"
            subtitle="Customize how the monitor looks and feels."
          />
          <div className="settings-theme-picker">
            <span className="settings-theme-label">Theme</span>
            <div className="settings-theme-options">
            {(["dark", "light"] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTheme(t)}
                aria-pressed={theme === t}
                className={theme === t ? "active" : ""}
              >
                {t}
              </button>
            ))}
            </div>
            <small>Choose your preferred theme for the interface.</small>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Reference-style panel head: icon chip, title, subtitle, right-side slot. */
function PanelHead({
  icon,
  title,
  subtitle,
  aside,
}: {
  icon: string;
  title: string;
  subtitle: string;
  aside?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 14,
        padding: "15px 16px 13px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11, minWidth: 0 }}>
        <span
          style={{
            width: 30,
            height: 30,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 9,
            border: "1px solid var(--line2)",
            background: "var(--brandSoft)",
            color: BRAND,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <h2 style={{ margin: 0, font: `650 13.5px/1.1 ${sans}`, color: TX }}>{title}</h2>
          <span style={{ font: `400 10.5px/1.35 ${sans}`, color: TX3 }}>{subtitle}</span>
        </span>
      </div>
      {aside}
    </div>
  );
}

function Badge({ text, lock }: { text: string; lock?: boolean }) {
  return (
    <span
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 9px",
        borderRadius: 7,
        border: "1px solid var(--line)",
        background: "var(--panel2)",
        color: TX2,
        font: `500 10px/1 ${sans}`,
      }}
    >
      {lock && (
        <svg width="9" height="9" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6.5 9V7a3.5 3.5 0 017 0v2M5 9h10v7H5z" />
        </svg>
      )}
      {text}
    </span>
  );
}

function Chip({ text, color, soft }: { text: string; color: string; soft?: boolean }) {
  return (
    <span
      style={{
        padding: "3px 7px",
        borderRadius: 6,
        font: `600 9px/1 ${sans}`,
        color,
        background: soft ? `color-mix(in srgb, ${color} 14%, transparent)` : "transparent",
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      {text}
    </span>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  title,
  brand,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  brand?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "6px 10px",
        borderRadius: 7,
        border: `1px solid ${brand ? "color-mix(in srgb, var(--brand) 45%, transparent)" : "var(--line)"}`,
        background: brand ? "var(--brandSoft)" : "transparent",
        color: brand ? BRAND : TX2,
        font: `600 10px/1 ${sans}`,
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function SecurityRow({ label, chip, note }: { label: string; chip: { text: string; color: string }; note: string }) {
  return (
    <div style={{ ...rowStyle, alignItems: "flex-start" }}>
      <span style={{ font: `500 11.5px/1.4 ${sans}`, color: TX, flex: "none", width: 132 }}>{label}</span>
      <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, minWidth: 0, justifyContent: "flex-end", textAlign: "right" }}>
        <span style={{ font: `400 10px/1.4 ${sans}`, color: TX3 }}>{note}</span>
        <Chip text={chip.text} color={chip.color} soft />
      </span>
    </div>
  );
}

/** One direct-probe outcome, rendered under the endpoint it belongs to. */
function ProbeResult({ p }: { p: NodeProbe | "loading" }) {
  if (p === "loading") {
    return <span style={{ font: `400 10px/1.4 ${mono}`, color: TX3 }}>probing…</span>;
  }
  if (p.state === "ok") {
    return (
      <span style={{ font: `400 10px/1.4 ${mono}`, color: p.catchingUp ? WARN : OK }}>
        direct: {p.network} · head {p.latest} · {p.catchingUp ? "catching up" : "in sync"} ·{" "}
        {p.latencyMs}ms{p.version ? ` · v${p.version}` : ""}
      </span>
    );
  }
  return (
    <span style={{ font: `400 10px/1.4 ${mono}`, color: p.state === "blocked" ? WARN : BAD }}>
      direct: {p.error}
    </span>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "11px 16px",
  borderBottom: "1px solid var(--line)",
};

function Loading({ text = "Waiting for /api/v1/config…" }: { text?: string }) {
  return (
    <div style={{ padding: "24px 16px", font: `400 12px/1 ${sans}`, color: TX3 }}>
      {text}
    </div>
  );
}
