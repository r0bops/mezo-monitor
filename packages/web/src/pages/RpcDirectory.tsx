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

export function RpcDirectory({ d }: { d: Dashboard }) {
  const [rows, setRows] = useState<DirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    get<{ endpoints: DirectoryEntry[] }>("/api/v1/rpc-directory")
      .then((r: { endpoints: DirectoryEntry[] }) => {
        setRows(r.endpoints);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [d.net?.updated_at]);

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 1400);
  };

  const configured = (rows ?? []).filter((r) => r.source === "configured");
  const discovered = (rows ?? []).filter((r) => r.source === "discovered");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980 }}>
      <section style={{ ...panel, overflow: "hidden" }}>
        <Head
          title="Verified endpoints"
          aside={`${configured.length} · the rotation this monitor runs on`}
        />
        {configured.map((e) => (
          <Card key={e.url} e={e} copied={copied === e.url} onCopy={() => copy(e.url)} />
        ))}
        {configured.length === 0 && <LoadingOrError error={error} />}
      </section>

      <section style={{ ...panel, overflow: "hidden" }}>
        <Head
          title="Community endpoints"
          aside={`${discovered.filter((x) => x.healthy).length} discovered on the P2P network`}
        />
        {discovered.map((e) => (
          <Card key={e.url} e={e} copied={copied === e.url} onCopy={() => copy(e.url)} />
        ))}
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
            Direct RPC console
          </a>{" "}
          before pointing anything important at it.
        </div>
      </section>
    </div>
  );
}

function Card({ e, copied, onCopy }: { e: DirectoryEntry; copied: boolean; onCopy: () => void }) {
  const archive =
    e.earliest_height !== null && e.earliest_height > 0 ? `archive from ${fmt(e.earliest_height)}` : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 18px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span
        title={e.healthy ? "answered the last probe" : "no answer at the last probe"}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flex: "none",
          background: e.healthy ? (e.catching_up ? WARN : OK) : BAD,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ font: `600 12px/1 ${sans}`, color: TX, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {e.label ?? "unnamed node"}
          </span>
          <span
            style={{
              font: `600 8.5px/1 ${sans}`,
              letterSpacing: ".06em",
              padding: "3px 6px",
              borderRadius: 5,
              flex: "none",
              background: e.source === "configured" ? "var(--brandSoft)" : "var(--panel2)",
              color: e.source === "configured" ? "var(--brand)" : TX3,
            }}
          >
            {e.source === "configured" ? "VERIFIED" : "DISCOVERED"}
          </span>
          {e.catching_up && (
            <span style={{ font: `600 9px/1 ${sans}`, color: WARN, flex: "none" }}>CATCHING UP</span>
          )}
        </div>
        <span
          title={e.url}
          style={{
            font: `500 11px/1 ${mono}`,
            color: TX2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {e.url}
        </span>
        <span style={{ font: `400 10px/1 ${sans}`, color: TX3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[
            e.latency_ms !== null ? `${e.latency_ms}ms` : null,
            e.last_height !== null ? `height ${fmt(e.last_height)}` : null,
            archive,
            e.last_seen ? `probed ${agoFrom(e.last_seen)} ago` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <button
        type="button"
        onClick={onCopy}
        style={{
          flex: "none",
          padding: "7px 13px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: copied ? "var(--okSoft)" : "var(--panel2)",
          color: copied ? OK : TX2,
          font: `600 10.5px/1 ${sans}`,
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
    </div>
  );
}

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
