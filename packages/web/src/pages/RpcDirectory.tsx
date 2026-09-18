/**
 * RPC Endpoints directory — chainlist-style: every usable Mezo RPC we know,
 * with its evidence. Two sources, honestly labelled:
 *
 * - CONFIGURED: the verified endpoints this monitor itself runs on
 *   (health-probed continuously).
 * - DISCOVERED: community endpoints found on the chain's P2P network —
 *   what the node itself reported at last probe (sync state, archive
 *   depth). Evidence, not endorsement: they never join the indexer's
 *   failover automatically, and the "vet it yourself" path is one click
 *   into the Direct RPC console.
 */
import { useEffect, useState } from "react";
import type { Dashboard } from "../useDashboard";
import { get } from "../api";
import { BAD, OK, TX, TX2, TX3, WARN, mono, panel, sans } from "../components/ui";
import { agoFrom, fmt } from "../lib";

type DirectoryEntry = {
  url: string;
  source: "configured" | "discovered";
  label: string | null;
  healthy: boolean;
  latency_ms: number | null;
  last_height: number | null;
  catching_up: boolean | null;
  earliest_height: number | null;
  first_seen: string | null;
  last_seen: string | null;
};

type EvmProvider = {
  label: string;
  rpc_url: string | null;
  ws_url: string | null;
  healthy: boolean | null;
  latency_ms: number | null;
  last_height: number | null;
};

export function RpcDirectory({ d }: { d: Dashboard }) {
  const [rows, setRows] = useState<DirectoryEntry[] | null>(null);
  const [evm, setEvm] = useState<EvmProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    get<{ endpoints: DirectoryEntry[]; evm: EvmProvider[] }>("/api/v1/rpc-directory")
      .then((r: { endpoints: DirectoryEntry[]; evm: EvmProvider[] }) => {
        setRows(r.endpoints);
        setEvm(r.evm);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [d.net?.updated_at]);

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 2600);
  };

  const configured = (rows ?? []).filter((r) => r.source === "configured");
  const discovered = (rows ?? []).filter((r) => r.source === "discovered");

  return (
    <div className="rpc-directory-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980 }}>
      <section style={{ ...panel, overflow: "hidden" }}>
        <Head
          title="EVM endpoints"
          aside={`${evm?.length ?? 0} providers · Mezo's official list · probed server-side`}
        />
        <div className="rpc-directory-grid" style={gridStyle}>
          {(evm ?? []).map((p) => (
            <EvmCard key={p.label} p={p} copied={copied} onCopy={copy} />
          ))}
        </div>
        {evm?.length === 0 && <LoadingOrError error={error} />}
        <div style={{ padding: "0 18px 14px", font: `400 10.5px/1.5 ${sans}`, color: TX3 }}>
          JSON-RPC (EVM side of Mezo) — what wallets and dapps connect to. Health is probed from
          our server via <code>eth_blockNumber</code>; WebSocket URLs cannot be fetch-probed, so
          their health is simply not claimed.
        </div>
      </section>

      <section style={{ ...panel, overflow: "hidden" }}>
        <Head
          title="Verified endpoints"
          aside={`${configured.length} · the rotation this monitor runs on`}
        />
        <div className="rpc-directory-grid" style={gridStyle}>
          {configured.map((e) => (
            <Card key={e.url} e={e} copied={copied === e.url} onCopy={() => copy(e.url)} />
          ))}
        </div>
        {configured.length === 0 && <LoadingOrError error={error} />}
      </section>

      <section style={{ ...panel, overflow: "hidden" }}>
        <Head
          title="Community endpoints"
          aside={`${discovered.filter((x) => x.healthy).length} discovered on the P2P network`}
        />
        <div className="rpc-directory-grid" style={gridStyle}>
          {discovered.map((e) => (
            <Card key={e.url} e={e} copied={copied === e.url} onCopy={() => copy(e.url)} />
          ))}
        </div>
        {discovered.length === 0 && !error && (
          <div style={{ padding: "20px 18px", font: `400 12px/1.5 ${sans}`, color: TX3 }}>
            No community endpoints discovered yet — the sweep probes the chain's peers hourly.
          </div>
        )}
        {discovered.length === 0 && error && <LoadingOrError error={error} />}
        <div style={{ padding: "10px 18px 14px", font: `400 10.5px/1.5 ${sans}`, color: TX3 }}>
          Discovered endpoints are what the nodes themselves reported at the last probe —
          evidence, not endorsement. Vet one yourself in the{" "}
          <a href="#/rpc" style={{ color: "var(--brand)" }}>
            RPC Console
          </a>{" "}
          before pointing anything important at it.
        </div>
      </section>
    </div>
  );
}

/** One provider, two protocols: RPC and WS copy buttons side by side. */
function EvmCard({
  p,
  copied,
  onCopy,
}: {
  p: EvmProvider;
  copied: string | null;
  onCopy: (url: string) => void;
}) {
  const latencyColor =
    p.latency_ms === null ? TX3 : p.latency_ms <= 250 ? OK : p.latency_ms <= 700 ? WARN : BAD;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: "linear-gradient(145deg, var(--panel2), var(--panel))",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 14px 0" }}>
        {p.healthy !== null && (
          <span
            title={p.healthy ? "answered the last server-side probe" : "no answer at the last probe"}
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              flex: "none",
              boxShadow: p.healthy ? "0 0 7px var(--ok)" : "none",
              background: p.healthy ? OK : BAD,
            }}
          />
        )}
        <span
          style={{
            font: `600 13px/1 ${sans}`,
            color: TX,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
        >
          {p.label}
        </span>
        <span
          style={{
            font: `700 8.5px/1 ${sans}`,
            letterSpacing: ".07em",
            padding: "4px 8px",
            borderRadius: 6,
            flex: "none",
            background: "var(--panel2)",
            color: TX3,
            border: "1px solid var(--line)",
          }}
        >
          EVM
        </span>
      </div>

      <div style={{ padding: "10px 14px 12px" }}>
        <code
          title={p.rpc_url ?? ""}
          style={{
            display: "block",
            font: `500 11.5px/1.35 ${mono}`,
            color: TX2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--panel2)",
            border: "1px solid var(--line)",
          }}
        >
          {p.rpc_url ?? p.ws_url}
        </code>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 12px" }}>
        <Fact label="latency" value={p.latency_ms !== null ? `${p.latency_ms}ms` : "—"} color={latencyColor} />
        <Fact label="height" value={p.last_height !== null ? fmt(p.last_height) : "—"} />
      </div>

      <div style={{ display: "flex", gap: 8, margin: "0 14px 14px" }}>
        <button
          type="button"
          disabled={!p.rpc_url}
          className={p.rpc_url !== null && copied === p.rpc_url ? "copy-glow" : undefined}
          onClick={() => p.rpc_url && onCopy(p.rpc_url)}
          style={copyBtn(p.rpc_url !== null && copied === p.rpc_url)}
        >
          {p.rpc_url !== null && copied === p.rpc_url ? "✓ RPC copied" : "RPC"}
        </button>
        <button
          type="button"
          disabled={!p.ws_url}
          className={p.ws_url !== null && copied === p.ws_url ? "copy-glow" : undefined}
          onClick={() => p.ws_url && onCopy(p.ws_url)}
          style={copyBtn(p.ws_url !== null && copied === p.ws_url)}
        >
          {p.ws_url !== null && copied === p.ws_url ? "✓ WS copied" : "WS"}
        </button>
      </div>
    </div>
  );
}

function copyBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "9px 12px",
    borderRadius: 9,
    border: `1px solid ${active ? OK : "var(--line)"}`,
    background: active ? "var(--okSoft)" : "var(--panel2)",
    color: active ? OK : TX,
    font: `600 11px/1 ${sans}`,
    cursor: "pointer",
  };
}

function Card({ e, copied, onCopy }: { e: DirectoryEntry; copied: boolean; onCopy: () => void }) {
  const verified = e.source === "configured";
  // Latency reads at a glance: fast green, middling amber, slow red.
  const latencyColor = e.latency_ms === null ? TX3 : e.latency_ms <= 150 ? OK : e.latency_ms <= 600 ? WARN : BAD;
  const archiveDepth =
    e.earliest_height !== null && e.earliest_height > 0
      ? `from ${fmt(e.earliest_height)}`
      : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        border: `1px solid ${e.healthy ? "var(--line)" : "color-mix(in srgb, var(--bad) 35%, var(--line))"}`,
        background: "linear-gradient(145deg, var(--panel2), var(--panel))",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
      }}
    >
      {/* header: identity + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 14px 0" }}>
        <span
          title={e.healthy ? "answered the last probe" : "no answer at the last probe"}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            flex: "none",
            boxShadow: e.healthy ? `0 0 7px ${e.catching_up ? WARN : OK}` : "none",
            background: e.healthy ? (e.catching_up ? WARN : OK) : BAD,
          }}
        />
        <span
          title={e.label ?? "the node announced no moniker"}
          style={{
            font: `600 13px/1 ${sans}`,
            color: TX,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
        >
          {e.label ?? "unnamed node"}
        </span>
        <span
          style={{
            font: `700 8.5px/1 ${sans}`,
            letterSpacing: ".07em",
            padding: "4px 8px",
            borderRadius: 6,
            flex: "none",
            background: verified ? "var(--brandSoft)" : "var(--panel2)",
            color: verified ? "var(--brand)" : TX3,
            border: "1px solid var(--line)",
          }}
        >
          {verified ? "VERIFIED" : "DISCOVERED"}
        </span>
      </div>

      {/* the URL, the thing people come for */}
      <div style={{ padding: "10px 14px 12px" }}>
        <code
          title={e.url}
          style={{
            display: "block",
            font: `500 11.5px/1.35 ${mono}`,
            color: TX2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--panel2)",
            border: "1px solid var(--line)",
          }}
        >
          {e.url}
        </code>
      </div>

      {/* facts, one element each so they scan independently */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 12px" }}>
        <Fact label="latency" value={e.latency_ms !== null ? `${e.latency_ms}ms` : "—"} color={latencyColor} />
        <Fact label="height" value={e.last_height !== null ? fmt(e.last_height) : "—"} />
        <Fact
          label="archive"
          value={archiveDepth ?? "pruned"}
          color={archiveDepth ? OK : TX3}
          title={archiveDepth ? `serves history back to block ${fmt(e.earliest_height!)}` : "history depth unknown or shallow"}
        />
        {e.catching_up && <Fact label="sync" value="catching up" color={WARN} />}
        {e.last_seen && <Fact label="probed" value={`${agoFrom(e.last_seen)} ago`} />}
      </div>

      <button
        type="button"
        onClick={onCopy}
        className={copied ? "copy-glow" : undefined}
        style={{
          margin: "0 14px 14px",
          padding: "9px 12px",
          borderRadius: 9,
          border: `1px solid ${copied ? OK : "var(--line)"}`,
          background: copied ? "var(--okSoft)" : "var(--panel2)",
          color: copied ? OK : TX,
          font: `600 11px/1 ${sans}`,
          cursor: "pointer",
        }}
      >
        {copied ? "✓ Copied to clipboard" : "Copy URL"}
      </button>
    </div>
  );
}

/** One fact as its own chip: label above value, so the grid of facts reads
 *  as separate elements instead of one dot-separated line. */
function Fact({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color?: string;
  title?: string;
}) {
  return (
    <span
      title={title ?? `${label}: ${value}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 3,
        padding: "6px 10px",
        borderRadius: 8,
        background: "var(--panel2)",
        border: "1px solid var(--line)",
        minWidth: 62,
      }}
    >
      <span style={{ font: `600 8px/1 ${sans}`, letterSpacing: ".08em", textTransform: "uppercase", color: TX3 }}>
        {label}
      </span>
      <span style={{ font: `600 11px/1 ${mono}`, color: color ?? TX2, whiteSpace: "nowrap" }}>{value}</span>
    </span>
  );
}

/** Responsive card grid: 3 across on wide screens, fewer as space shrinks. */
const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: 12,
  padding: "14px 16px 16px",
};

function Head({ title, aside }: { title: string; aside: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "14px 18px 12px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>{title}</h2>
      <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3, whiteSpace: "nowrap" }}>{aside}</span>
    </div>
  );
}

function LoadingOrError({ error }: { error: string | null }) {
  return (
    <div style={{ padding: "20px 18px", font: `400 12px/1.4 ${sans}`, color: TX3 }}>
      {error ? `Directory unavailable: ${error}` : "Loading…"}
    </div>
  );
}
