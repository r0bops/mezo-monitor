/**
 * Shell: sidebar, header, state banner, page routing and footer.
 * Layout is the mockup's fixed 1440px desktop frame.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard, DEV_STATES, type DevState } from "./useDashboard";
import { Overview, verdictFor } from "./pages/Overview";
import { Validators } from "./pages/Validators";
import { ValidatorSet } from "./pages/ValidatorSet";
import { Metrics } from "./pages/Metrics";
import { ApiDocs } from "./pages/ApiDocs";
import { Settings } from "./pages/Settings";
import { Components } from "./pages/Components";
import { BAD, OK, TX, TX2, TX3, WARN, mono, sans } from "./components/ui";
import { EndpointSwitcher } from "./components/EndpointSwitcher";
import { agoText, copyText, fmt } from "./lib";

export type Theme = "dark" | "light";

type PageId =
  | "overview"
  | "validators"
  | "vset"
  | "metrics"
  | "api"
  | "settings"
  | "components";

const NAV: { id: PageId; label: string; d: string }[] = [
  { id: "overview", label: "Overview", d: "M4 4h5v5H4zM11 4h5v3h-5zM4 12h5v4H4zM11 10h5v6h-5z" },
  { id: "validators", label: "Validators", d: "M4 6h12M4 10h12M4 14h12" },
  { id: "vset", label: "Validator Set", d: "M10 3l6 3.5v7L10 17l-6-3.5v-7z" },
  { id: "metrics", label: "Metrics", d: "M4 15l4-5 3 3 5-7" },
  { id: "api", label: "API & Docs", d: "M7 6l-3 4 3 4M13 6l3 4-3 4" },
  {
    id: "settings",
    label: "Settings",
    d: "M10 7.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8zM10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.4 5.4l1.1 1.1M13.5 13.5l1.1 1.1M14.6 5.4l-1.1 1.1M6.5 13.5l-1.1 1.1",
  },
];

const TITLES: Record<PageId, string> = {
  overview: "Overview",
  validators: "Validators",
  vset: "Validator Set",
  metrics: "Metrics",
  api: "API & Docs",
  settings: "Settings",
  components: "Components",
};

const VALID_PAGES = new Set<string>([...NAV.map((n) => n.id), "components"]);

function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (VALID_PAGES.has(h) ? h : "overview") as PageId;
}

/** The state switcher is a prototyping aid, not a production control. */
function devToolsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  return new URLSearchParams(window.location.search).has("debug");
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("mezo-theme") as Theme) ?? "dark",
  );
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [live, setLive] = useState(true);
  const [override, setOverride] = useState<DevState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [win, setWin] = useState(500);
  const [metricsHours, setMetricsHours] = useState(24);
  const [copied, setCopied] = useState<string | null>(null);

  const showDevTools = useMemo(devToolsEnabled, []);

  useEffect(() => {
    localStorage.setItem("mezo-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((id: PageId) => {
    window.location.hash = `/${id}`;
    setPage(id);
  }, []);

  const d = useDashboard({ live, override, selected, window: win, metricsHours });

  // Default the detail panel to the first validator once data arrives.
  useEffect(() => {
    if (!selected && d.validators.length > 0) setSelected(d.validators[0].address);
  }, [d.validators, selected]);

  const onCopy = useCallback((value: string) => {
    void copyText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1400);
  }, []);

  const net = d.net;
  const evmId = net?.chain.chain_id.match(/_(\d+)-/)?.[1] ?? null;
  const verdict = verdictFor(d);
  const banner = bannerFor(d);

  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--canvas)",
        color: TX,
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
        paddingBottom: showDevTools ? 64 : 24,
      }}
    >
      <div style={{ width: 1440, margin: "0 auto", display: "flex", alignItems: "stretch", minHeight: "100vh" }}>
        <Sidebar page={page} go={go} d={d} />

        <main style={{ flex: 1, minWidth: 0, padding: "0 28px 30px", display: "flex", flexDirection: "column" }}>
          <header
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 24,
              padding: "22px 0 18px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
              <h1 style={{ margin: 0, font: `600 21px/1.15 ${sans}`, letterSpacing: "-.01em", color: TX }}>
                {TITLES[page]}
              </h1>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  whiteSpace: "nowrap",
                  font: `400 11.5px/1 ${mono}`,
                  color: TX2,
                }}
              >
                <span>{net?.chain.chain_id ?? "—"}</span>
                <Dot />
                <span>
                  {net?.chain.family === "cometbft" ? "CometBFT" : (net?.chain.family ?? "—")}
                  {net?.chain.capabilities.poa ? " PoA" : ""}
                </span>
                {net?.node_version && (
                  <>
                    <Dot />
                    <span>v{net.node_version}</span>
                  </>
                )}
                {evmId && (
                  <>
                    <Dot />
                    <span>EVM {evmId}</span>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              <EndpointSwitcher d={d} />
              <button
                type="button"
                onClick={() => setLive((l) => !l)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 32,
                  padding: "0 11px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: live ? "var(--okSoft)" : "var(--panel)",
                  color: live ? OK : TX2,
                  font: `600 11.5px/1 ${sans}`,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "currentColor",
                    animation: live ? "bp 2.4s ease-in-out infinite" : "none",
                  }}
                />
                {live ? "Live" : "Paused"}
              </button>
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: TX2,
                  cursor: "pointer",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path
                    d={
                      theme === "dark"
                        ? "M14.5 11.5A5.5 5.5 0 018.5 5.5a5.5 5.5 0 00.8 10.9 5.5 5.5 0 005.2-4.9z"
                        : "M10 3.5v1.6M10 14.9v1.6M3.5 10h1.6M14.9 10h1.6M5.6 5.6l1.1 1.1M13.3 13.3l1.1 1.1M14.4 5.6l-1.1 1.1M6.7 13.3l-1.1 1.1M13 10a3 3 0 11-6 0 3 3 0 016 0z"
                    }
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onCopy(window.location.href)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: TX,
                  font: `600 11.5px/1 ${sans}`,
                  cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 11l6-3M7 9l6 3M15 5.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0zM8.6 10a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0zM15 14.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z" />
                </svg>
                {copied === window.location.href ? "Copied" : "Share"}
              </button>
            </div>
          </header>

          {banner && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 11,
                padding: "12px 14px",
                borderRadius: 10,
                marginBottom: 16,
                border: "1px solid var(--line)",
                background: banner.bg,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={banner.fg} strokeWidth="1.6" strokeLinecap="round" style={{ flex: "none", marginTop: 1 }}>
                <path d={banner.icon} />
              </svg>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ font: `600 12.5px/1.3 ${sans}`, color: banner.fg }}>{banner.title}</span>
                <span style={{ font: `400 12px/1.45 ${sans}`, color: TX2 }}>{banner.text}</span>
              </div>
            </div>
          )}

          {page === "overview" && (
            <Overview
              d={d}
              selected={selected}
              onSelect={setSelected}
              win={win}
              onWindow={setWin}
              copied={copied}
              onCopy={onCopy}
            />
          )}
          {page === "validators" && <Validators d={d} selected={selected} onSelect={setSelected} />}
          {page === "vset" && <ValidatorSet d={d} />}
          {page === "metrics" && <Metrics d={d} hours={metricsHours} onHours={setMetricsHours} />}
          {page === "api" && <ApiDocs d={d} />}
          {page === "settings" && <Settings d={d} theme={theme} onTheme={setTheme} />}
          {page === "components" && <Components />}

          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 20,
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              boxShadow: "var(--shadow)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  font: `600 11.5px/1 ${sans}`,
                  color: verdict.color,
                  flex: "none",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                {verdict.text}
              </span>
              <Divider />
              <span style={{ font: `400 11.5px/1 ${sans}`, color: TX2, flex: "none" }}>
                {net
                  ? `${fmt(net.active_validators)} / ${fmt(net.total_validators)} validators active`
                  : "Validator set unavailable"}
              </span>
              <Divider />
              <span style={{ font: `400 11.5px/1.4 ${sans}`, color: TX3, minWidth: 0 }}>
                One-block commit lag is inherent to CometBFT — signatures for block H arrive with
                block H+1.
              </span>
            </div>
            <span
              style={{
                font: `400 11.5px/1 ${mono}`,
                color: d.state === "stopped" || d.state === "dberror" ? WARN : TX3,
                flex: "none",
              }}
            >
              Updated {agoText(d.agoSeconds)} ago
            </span>
          </div>
        </main>
      </div>

      {showDevTools && <DevBar state={override} onState={setOverride} page={page} go={go} />}
    </div>
  );
}

function Dot() {
  return <span style={{ color: TX3 }}>·</span>;
}

function Divider() {
  return <span style={{ width: 1, height: 12, background: "var(--line)", flex: "none" }} />;
}

function Sidebar({
  page,
  go,
  d,
}: {
  page: PageId;
  go: (p: PageId) => void;
  d: ReturnType<typeof useDashboard>;
}) {
  const ix = indexerBadge(d);
  return (
    <aside
      style={{
        width: 180,
        flex: "none",
        borderRight: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 4px 22px" }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ flex: "none" }}>
          <rect x="1" y="8" width="2.6" height="6" rx="1.3" fill="var(--brand)" opacity=".45" />
          <rect x="5" y="5" width="2.6" height="12" rx="1.3" fill="var(--brand)" opacity=".7" />
          <rect x="9" y="1.5" width="2.6" height="19" rx="1.3" fill="var(--brand)" />
          <rect x="13" y="6" width="2.6" height="10" rx="1.3" fill="var(--brand)" opacity=".7" />
          <rect x="17" y="9" width="2.6" height="4" rx="1.3" fill="var(--brand)" opacity=".45" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ font: `700 11.5px/1 ${sans}`, letterSpacing: ".15em", color: TX }}>MEZO</span>
          <span style={{ font: `500 9.5px/1 ${sans}`, letterSpacing: ".22em", color: TX3 }}>MONITOR</span>
        </div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((n) => (
          <a
            key={n.id}
            href={`#/${n.id}`}
            onClick={(e) => {
              e.preventDefault();
              go(n.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "7px 9px",
              borderRadius: 7,
              font: `500 12.5px/1 ${sans}`,
              textDecoration: "none",
              background: page === n.id ? "var(--brandSoft)" : "transparent",
              color: page === n.id ? "var(--brand)" : TX2,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", opacity: 0.85 }}>
              <path d={n.d} />
            </svg>
            <span>{n.label}</span>
          </a>
        ))}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, paddingTop: 18 }}>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          {d.net?.chain.capabilities.poa && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                padding: "4px 8px",
                borderRadius: 6,
                background: "var(--brandSoft)",
                border: "1px solid var(--line)",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M10 2.5l6 3v5c0 4-2.8 6.5-6 7.5-3.2-1-6-3.5-6-7.5v-5z" />
              </svg>
              <span style={{ font: `600 9.5px/1 ${sans}`, letterSpacing: ".06em", color: "var(--brand)" }}>
                PROOF-OF-AUTHORITY
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  flex: "none",
                  background: ix.color,
                  animation: ix.pulse ? "bp 2.4s ease-in-out infinite" : "none",
                }}
              />
              <span style={{ font: `600 10.5px/1 ${sans}`, color: ix.color }}>{ix.label}</span>
            </div>
            <span style={{ font: `400 10px/1.4 ${mono}`, color: TX3 }}>{ix.sub}</span>
            <span style={{ font: `400 10px/1.4 ${mono}`, color: TX3 }}>mezo-monitor v0.1.0</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function indexerBadge(d: ReturnType<typeof useDashboard>) {
  switch (d.state) {
    case "dberror":
      return { color: BAD, label: "No database", sub: d.error ?? "API unreachable", pulse: false };
    case "stopped":
      return {
        color: BAD,
        label: "Stopped",
        sub: `${fmt(d.net?.indexer_lag_blocks ?? null)} blocks behind`,
        pulse: false,
      };
    case "empty":
      return { color: WARN, label: "Connecting", sub: "awaiting first block", pulse: false };
    case "loading":
      return { color: WARN, label: "Starting", sub: "loading…", pulse: false };
    case "backfill":
      return { color: OK, label: "Live", sub: "backfilling window", pulse: true };
    default:
      return { color: OK, label: "Live", sub: "polling · block stream", pulse: true };
  }
}

function bannerFor(d: ReturnType<typeof useDashboard>) {
  const w = d.net?.long_window;
  switch (d.state) {
    case "stopped":
      return {
        title: "Indexer stopped",
        text: `Last block ingested at height ${fmt(d.net?.latest_indexed_height ?? null)}. Data on this page is ${fmt(d.net?.indexer_lag_blocks ?? null)} blocks behind chain head and is no longer updating.`,
        fg: WARN,
        bg: "var(--warnSoft)",
        icon: "M10 6v5M10 14h.01M10 3l7.5 13h-15z",
      };
    case "dberror":
      return {
        title: "API unreachable",
        text: `The dashboard cannot reach the API${d.error ? ` (${d.error})` : ""}. Metrics are unavailable until the connection is restored; values are shown as em-dashes rather than zeros.`,
        fg: BAD,
        bg: "var(--badSoft)",
        icon: "M10 6v5M10 14h.01M17 10a7 7 0 11-14 0 7 7 0 0114 0z",
      };
    case "backfill":
      return {
        title: "Backfill in progress",
        text: `${fmt(w?.filled ?? 0)} of ${fmt(w?.target ?? 10_000)} blocks indexed for the long window. Uptime (${fmt(w?.target ?? 10_000)}) is reported as a partial window rather than a percentage until the backfill completes.`,
        fg: "var(--brand)",
        bg: "var(--brandSoft)",
        icon: "M10 5v5l3 2M17 10a7 7 0 11-14 0 7 7 0 0114 0z",
      };
    case "empty":
      return {
        title: "Awaiting RPC",
        text: "No blocks indexed yet. The indexer is connecting to the configured RPC endpoint and will begin ingesting from chain head.",
        fg: TX2,
        bg: "var(--panel2)",
        icon: "M10 5v5l3 2M17 10a7 7 0 11-14 0 7 7 0 0114 0z",
      };
    default:
      return null;
  }
}

function DevBar({
  state,
  onState,
  page,
  go,
}: {
  state: DevState | null;
  onState: (s: DevState | null) => void;
  page: PageId;
  go: (p: PageId) => void;
}) {
  const btn = (active: boolean) => ({
    padding: "6px 9px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    font: `600 10.5px/1 ${sans}`,
    whiteSpace: "nowrap" as const,
    background: active ? "#7C5CFF" : "rgba(255,255,255,.07)",
    color: active ? "#fff" : "rgba(255,255,255,.62)",
  });

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 12,
        background: "rgba(16,18,24,.94)",
        border: "1px solid rgba(255,255,255,.1)",
        boxShadow: "0 12px 34px -12px rgba(0,0,0,.7)",
        backdropFilter: "blur(8px)",
      }}
    >
      <span style={{ font: `600 8.5px/1 ${mono}`, letterSpacing: ".1em", color: "rgba(255,255,255,.4)", paddingLeft: 4 }}>
        STATE
      </span>
      <div style={{ display: "flex", gap: 3 }}>
        <button type="button" onClick={() => onState(null)} style={btn(state === null)}>
          Live
        </button>
        {DEV_STATES.map((s) => (
          <button key={s.id} type="button" onClick={() => onState(s.id)} style={btn(state === s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <span style={{ width: 1, height: 18, background: "rgba(255,255,255,.14)" }} />
      <button type="button" onClick={() => go("components")} style={btn(page === "components")}>
        Components
      </button>
    </div>
  );
}
