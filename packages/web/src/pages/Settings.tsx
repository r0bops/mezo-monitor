/** Settings: chain identity, capability flags, indexer config and theme. */
import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Theme } from "../App";
import { probeNode, type NodeProbe } from "../nodeRpc";
import { get } from "../api";
import { BAD, BRAND, OK, TX, TX2, TX3, WARN, mono, panel, sans } from "../components/ui";
import { fmt } from "../lib";

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
  /** The build this page runs, vs the build the server has deployed — the
   *  at-a-glance answer to "is it deployed?" without trusting anyone's
   *  cache. Both shown in Indexer → Monitor. */
  const [deployed, setDeployed] = useState<string | null>(null);
  useEffect(() => {
    get<{ web: string | null }>("/api/v1/version")
      .then((v: { web: string | null }) => setDeployed(v.web))
      .catch(() => {});
  }, []);

  const runProbe = (id: number, url: string | null) => {
    if (!url) return;
    setProbes((p) => ({ ...p, [id]: "loading" }));
    probeNode(url).then((r) => setProbes((p) => ({ ...p, [id]: r })));
  };

  const chainRows: [string, string][] = cfg
    ? [
        ["slug", cfg.chain.slug],
        ["name", cfg.chain.name],
        ["chain_id", cfg.chain.chain_id],
        ["consensus", `${cfg.chain.family === "cometbft" ? "CometBFT" : cfg.chain.family}${caps?.poa ? " PoA" : ""}`],
        ["node_version", d.net?.node_version ? `v${d.net.node_version}` : "—"],
        ["evm_chain_id", cfg.chain.chain_id.match(/_(\d+)-/)?.[1] ?? "—"],
        ["rpc_url", cfg.chain.rpc_url ?? "—"],
        ["ws_url", cfg.chain.ws_url ?? "—"],
        ["blockscout_url", cfg.chain.blockscout_url ?? "—"],
      ]
    : [];

  // Which bundle THIS page is executing — same extraction the version check
  // uses, so "yours" vs "deployed" below are directly comparable.
  const running =
    document.querySelector('script[src*="assets/index-"]')?.getAttribute("src")?.match(/index-([^.]+)\.js/)?.[1] ??
    "?";
  const deployedShort = deployed?.match(/index-([^.]+)\.js/)?.[1] ?? null;
  const indexerRows: [string, string][] = cfg
    ? [
        ["BACKFILL_DEPTH", `${fmt(cfg.indexer.backfill_depth)} blocks`],
        ["Ingestion", cfg.indexer.ingestion],
        ["Set poll interval", `${Math.round(cfg.indexer.poll_interval_ms / 1000)}s`],
        ["Database", cfg.indexer.database],
        ["Uptime windows", `${fmt(cfg.windows.short)} / ${fmt(cfg.windows.long)} blocks`],
        ["Monitor", `mezo-monitor v0.1.0 · build ${running}`],
        ["Deployed build", deployedShort ? `${deployedShort}${deployedShort === running ? " ✓ current" : " ≠ reload to update"}` : "—"],
      ]
    : [];

  return (
    <div className="settings-page g2" style={{ alignItems: "start", maxWidth: 1000 }}>
      <section style={{ ...panel, overflow: "hidden" }}>
        <Head title="Chain configuration" aside="chains/*.yaml" mono />
        {chainRows.length === 0 && <Loading />}
        {chainRows.map(([k, v]) => (
          <div className="settings-row" key={k} style={rowStyle}>
            <span className="settings-key" style={{ font: `500 11.5px/1 ${mono}`, color: TX3 }}>{k}</span>
            <span
              className="settings-value"
              style={{
                font: `500 11.5px/1 ${mono}`,
                color: TX,
                textAlign: "right",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={v}
            >
              {v}
            </span>
          </div>
        ))}
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section style={{ ...panel, overflow: "hidden" }}>
          <Head title="RPC endpoints" aside="failover order" />
          {(d.endpoints?.endpoints ?? []).length === 0 && <Loading />}
          {(d.endpoints?.endpoints ?? []).map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "11px 16px",
                borderBottom: "1px solid var(--line)",
                background: e.is_active ? "var(--brandSoft)" : "transparent",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  marginTop: 4,
                  flex: "none",
                  background: e.healthy ? OK : e.consecutive_failures > 0 ? BAD : WARN,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ font: `600 11.5px/1 ${sans}`, color: TX }}>{e.label}</span>
                  {e.is_active && (
                    <span style={{ font: `600 9px/1 ${sans}`, color: BRAND }}>ACTIVE</span>
                  )}
                  {e.pinned && <span style={{ font: `600 9px/1 ${sans}`, color: BRAND }}>PINNED</span>}
                  <span style={{ font: `400 10px/1 ${mono}`, color: TX3 }}>priority {e.priority}</span>
                </div>
                <span
                  style={{
                    font: `400 10.5px/1 ${mono}`,
                    color: TX2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={e.rpc_url ?? ""}
                >
                  {e.rpc_url ?? "—"}
                </span>
                <span style={{ font: `400 10px/1.4 ${mono}`, color: e.last_error ? BAD : TX3 }}>
                  {e.last_error
                    ? `${e.last_error} · ${e.consecutive_failures} consecutive failure${e.consecutive_failures === 1 ? "" : "s"}`
                    : `height ${e.last_height ?? "—"} · ${e.latency_ms ?? "—"}ms`}
                </span>
                {probes[e.id] !== undefined && (
                  <ProbeResult p={probes[e.id]} />
                )}
              </div>
              <button
                type="button"
                onClick={() => runProbe(e.id, e.rpc_url)}
                disabled={probes[e.id] === "loading"}
                title="Ask the node directly from this browser, independent of the monitor"
                style={{
                  flex: "none",
                  marginTop: 2,
                  padding: "5px 9px",
                  borderRadius: 7,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  color: TX2,
                  font: `600 10px/1 ${sans}`,
                  cursor: probes[e.id] === "loading" ? "default" : "pointer",
                }}
              >
                {probes[e.id] === "loading" ? "…" : "Probe"}
              </button>
            </div>
          ))}
          <div style={{ padding: "10px 16px" }}>
            <span style={{ font: `400 11px/1.5 ${sans}`, color: TX3 }}>
              Endpoints are declared in <code>chains/*.yaml</code>; health and the active choice
              live in the database. The active node feeds the indexer — switching changes where new
              blocks are read from, not the history already indexed. <strong>Probe</strong> asks
              the node directly from your browser (polkadot.js-style, no monitor in the middle) —
              it needs the node's CORS permission, and http nodes are blocked on the https site.
            </span>
          </div>
        </section>

        <section style={{ ...panel, overflow: "hidden" }}>
          <Head title="Capabilities" aside="read-only" />
          <div style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {caps ? (
              Object.entries(caps).map(([k, on]) => (
                <span
                  key={k}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: on ? "var(--okSoft)" : "var(--panel2)",
                  }}
                >
                  <span style={{ font: `500 11px/1 ${mono}`, color: TX2 }}>{k}</span>
                  <span style={{ font: `600 11px/1 ${mono}`, color: on ? OK : TX3 }}>
                    {String(on)}
                  </span>
                </span>
              ))
            ) : (
              <Loading />
            )}
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

        <section style={{ ...panel, overflow: "hidden" }}>
          <Head title="Indexer" />
          {indexerRows.length === 0 && <Loading />}
          {indexerRows.map(([k, v]) => (
            <div className="settings-row" key={k} style={rowStyle}>
            <span className="settings-key" style={{ font: `500 11.5px/1 ${mono}`, color: TX3 }}>{k}</span>
            <span className="settings-value" style={{ font: `500 11.5px/1 ${mono}`, color: TX }}>{v}</span>
            </div>
          ))}
        </section>

        <section style={{ ...panel, overflow: "hidden" }}>
          <Head title="Appearance" />
          <div style={{ padding: "14px 16px", display: "flex", gap: 8 }}>
            {(["dark", "light"] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTheme(t)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  font: `600 11.5px/1 ${sans}`,
                  border: `1px solid ${theme === t ? "var(--brand)" : "var(--line)"}`,
                  background: theme === t ? "var(--brandSoft)" : "transparent",
                  color: theme === t ? BRAND : TX2,
                  textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </section>
      </div>
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

function Head({ title, aside, mono: isMono }: { title: string; aside?: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px 12px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>{title}</h2>
      {aside && (
        <span style={{ font: `400 10.5px/1 ${isMono ? mono : sans}`, color: TX3 }}>{aside}</span>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div style={{ padding: "24px 16px", font: `400 12px/1 ${sans}`, color: TX3 }}>
      Waiting for /api/v1/config…
    </div>
  );
}
