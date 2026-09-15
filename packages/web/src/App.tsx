/**
 * Shell: sidebar, header, state banner, page routing and footer.
 * Layout is the mockup's fixed 1440px desktop frame.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboard } from "./useDashboard";
import { Overview, verdictFor } from "./pages/Overview";
import { Validators } from "./pages/Validators";
import { ValidatorSet } from "./pages/ValidatorSet";
import { Metrics } from "./pages/Metrics";
import { ApiDocs } from "./pages/ApiDocs";
import { Settings } from "./pages/Settings";
import { DirectRpc } from "./pages/DirectRpc";
import { RpcDirectory } from "./pages/RpcDirectory";
import { OK, TX, TX2, TX3, WARN, mono, sans } from "./components/ui";
import { EndpointSwitcher } from "./components/EndpointSwitcher";
import { agoText, copyText, fmt } from "./lib";

export type Theme = "dark" | "light";

type PageId =
  | "overview"
  | "validators"
  | "vset"
  | "metrics"
  | "endpoints"
  | "rpc"
  | "api"
  | "settings"

const NAV: { id: PageId; label: string; d: string }[] = [
  { id: "overview", label: "Overview", d: "M4 4h5v5H4zM11 4h5v3h-5zM4 12h5v4H4zM11 10h5v6h-5z" },
  { id: "validators", label: "Validators", d: "M4 6h12M4 10h12M4 14h12" },
  { id: "vset", label: "Validator Set", d: "M10 3l6 3.5v7L10 17l-6-3.5v-7z" },
  { id: "metrics", label: "Metrics", d: "M4 15l4-5 3 3 5-7" },
  { id: "endpoints", label: "RPC Endpoints", d: "M4 10l6-6M4 10l6 6M4 10h12" },
  { id: "rpc", label: "Direct RPC", d: "M7 4C4.8 9 4.8 11 7 16M13 4c2.2 5 2.2 7 0 12M4 10h12" },
  { id: "api", label: "API & Docs", d: "M7 6l-3 4 3 4M13 6l3 4-3 4" },
  {
    id: "settings",
    label: "Settings",
    d: "M10 7.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8zM10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.4 5.4l1.1 1.1M13.5 13.5l1.1 1.1M14.6 5.4l-1.1 1.1M6.5 13.5l-1.1 1.1",
  },
];

const TITLES: Record<PageId, string> = {
  overview: "Network Overview",
  validators: "Validators",
  vset: "Validator Set",
  metrics: "Metrics",
  endpoints: "RPC Endpoints",
  rpc: "Direct RPC",
  api: "API & Docs",
  settings: "Settings",
};

const SUBTITLES: Record<PageId, string> = {
  overview: "Real-time insights into the Mezo network, secured by Pathrock Network.",
  validators: "Validator performance, identity, uptime, and network status.",
  vset: "Track voting power and changes to the active validator set.",
  metrics: "Network health and consensus performance over time.",
  endpoints: "Usable Mezo RPC endpoints — verified and community-discovered.",
  rpc: "Inspect the connected Mezo RPC endpoint directly.",
  api: "Build with indexed Mezo network data.",
  settings: "Personalize the monitor and its data display.",
};

const VALID_PAGES = new Set<string>(NAV.map((n) => n.id));

function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (VALID_PAGES.has(h) ? h : "overview") as PageId;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("mezo-theme") as Theme) ?? "dark",
  );
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [win, setWin] = useState(500);
  const [metricsHours, setMetricsHours] = useState(24);
  const [copied, setCopied] = useState<string | null>(null);
  /** True when the deployed bundle differs from the one this tab runs. */
  const [stale, setStale] = useState(false);

  // A long-lived tab keeps executing the JS it loaded — no cache header can
  // fix that (it bit us repeatedly: removed UI "still there", ticking). Poll
  // the deployed bundle name and offer a reload when they diverge.
  useEffect(() => {
    const mine = document.querySelector('script[src*="assets/index-"]')?.getAttribute("src") ?? "";
    const check = () =>
      fetch("/api/v1/version")
        .then((r) => r.json())
        .then((v: { web: string | null }) => {
          if (v.web && !mine.includes(v.web)) setStale(true);
        })
        .catch(() => {});
    void check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem("mezo-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback((id: PageId) => {
    window.location.hash = `/${id}`;
    setPage(id);
  }, []);

  const d = useDashboard({ live, selected, window: win, metricsHours });

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
  const verdict = verdictFor(d);

  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--canvas)",
        color: TX,
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
        paddingBottom: 24,
      }}
    >
      <div className="shell">
        <Sidebar page={page} go={go} d={d} />

        <main className="main-content" style={{ flex: 1, minWidth: 0, padding: "0 28px 30px", display: "flex", flexDirection: "column" }}>
          <header
            className="topbar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              padding: "20px 0 18px",
            }}
          >
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = search.trim().toLowerCase();
                if (!q) return;
                const match = d.validators.find((v) =>
                  v.address.toLowerCase().includes(q) ||
                  v.moniker?.toLowerCase().includes(q) ||
                  v.label?.toLowerCase().includes(q),
                );
                if (match) setSelected(match.address);
                go("validators");
              }}
            >
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
              <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search blocks, transactions, validators, addresses…" aria-label="Search the network" />
              <kbd>⌘ K</kbd>
            </form>
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
              <span className="user-avatar" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="6.5" r="3.5"/><path d="M3.5 17c.5-4 2.7-6 6.5-6s6 2 6.5 6z"/></svg>
              </span>
            </div>
          </header>

          <div className="page-heading">
            <div>
              <h1>{TITLES[page]}</h1>
              <span className="page-subtitle">{SUBTITLES[page]}</span>
            </div>
            <span className="slogan">Decentralized today. Brighter tomorrow.</span>
          </div>

          {page === "overview" && (
            <Overview
              d={d}
              live={live}
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
          {page === "endpoints" && <RpcDirectory d={d} />}
          {page === "rpc" && <DirectRpc d={d} />}
          {page === "api" && <ApiDocs d={d} />}
          {page === "settings" && <Settings d={d} theme={theme} onTheme={setTheme} />}

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

      {/* Floating feedback (monadvision reference): the only channel a public
          visitor has to report wrong data. mailto keeps it zero-infrastructure;
          swap for a tailnet-only form if the address ever draws spam. */}
      <a
        href="mailto:nwrobj@gmail.com?subject=mezo-monitor%20feedback&body=(what%20looks%20wrong%2C%20on%20which%20page)%3A%20"
        title="Report wrong data or suggest something"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 34,
          padding: "0 13px",
          borderRadius: 17,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          color: TX2,
          font: `600 11px/1 ${sans}`,
          textDecoration: "none",
          boxShadow: "var(--shadow)",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 6.5v7a2 2 0 01-2 2H8l-4 3v-3H5a2 2 0 01-2-2v-7a2 2 0 012-2h10a2 2 0 012 2z" />
          <path d="M8 9h4M8 11.5h2.5" />
        </svg>
        Feedback
      </a>

      {stale && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            position: "fixed",
            right: 18,
            bottom: 62,
            zIndex: 41,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 34,
            padding: "0 13px",
            borderRadius: 17,
            border: "1px solid var(--brand)",
            background: "var(--brandSoft)",
            color: "var(--brand)",
            font: `600 11px/1 ${sans}`,
            cursor: "pointer",
            boxShadow: "var(--shadow)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }} />
          Update available — reload
        </button>
      )}
    </div>
  );
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
  return (
    <aside className="side">
      <div className="brand-lockup">
        <img className="mezo-wave" src="/mezo-icon.png" alt="" aria-hidden="true" />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ font: `750 20px/1 ${sans}`, color: TX }}>Mezo</span>
          <span style={{ font: `600 9px/1 ${sans}`, letterSpacing: ".24em", color: TX3 }}>MONITOR</span>
        </div>
      </div>
      <div className="brand-by">by Pathrock Network</div>

      <nav>
        {NAV.flatMap((n) => {
          const item = (
          <a
            key={n.id}
            className={page === n.id ? "active" : undefined}
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
          );
          if (n.id !== "vset") return [item];
          return [item,
            <span className="nav-disabled" key="blocks"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m10 3 6 3.5v7L10 17l-6-3.5v-7zM4 6.5l6 3.5 6-3.5M10 10v7"/></svg>Blocks</span>,
            <span className="nav-disabled" key="transactions"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h12m0 0-3-3m3 3-3 3M16 13H4m0 0 3-3m-3 3 3 3"/></svg>Transactions</span>,
          ];
        })}
      </nav>
      <div className="pathrock-card">
        <img className="pathrock-orbit" src="/pathrock-mark.svg" alt="" aria-hidden="true" />
        <div><strong>PATHROCK<br />NETWORK</strong><small>Open infrastructure for a more decentralized tomorrow.</small></div>
      </div>
    </aside>
  );
}
