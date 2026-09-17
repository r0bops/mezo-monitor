/**
 * Direct RPC: the browser talks straight to a user-chosen CometBFT node —
 * polkadot.js-style, no monitor in the middle. The page works even when the
 * API is unreachable; the dashboard data (`d`) is only used to pre-fill the
 * endpoint picker, never for the panel's own answers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dashboard } from "../useDashboard";
import {
  fetchBlock,
  fetchNetInfo,
  fetchValidators,
  probeNode,
  rpcCallRaw,
  type BlockInfo,
  type NetInfo,
  type NodeProbe,
  type RpcResult,
  type ValidatorsPage,
} from "../nodeRpc";
import {
  BAD,
  OK,
  Section,
  StatusPill,
  TX,
  TX2,
  TX3,
  WARN,
  mono,
  sans,
} from "../components/ui";
import { agoFrom, fmt, short } from "../lib";

const REFRESH_MS = 10_000;
const BLOCK_COUNT = 10;
const STORAGE_KEY = "mezo-rpc-url";

/** Public CometBFT endpoints that can be selected without exposing the
 * monitor's private/archive node URLs. These are intentionally kept here as
 * browser-facing presets: the endpoint directory redacts configured URLs for
 * public clients, which previously left the picker with only “Add Endpoint”. */
const PUBLIC_ENDPOINTS = [
  {
    key: "lavender-five",
    label: "Lavender.Five",
    url: "https://rpc.lavenderfive.com:443/mezo",
    detail: "Public Mezo RPC",
  },
  {
    key: "nodeshub",
    label: "NodesHub",
    url: "https://mezo.rpc.nodeshub.online",
    detail: "Public failover RPC",
  },
] as const;

function normalizeRpcUrl(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

type RpcIconName = "link" | "block" | "code" | "response" | "status" | "network" | "validators" | "cube" | "health" | "search";

function RpcIcon({ name, className = "" }: { name: RpcIconName; className?: string }) {
  return <img className={`rpc-icon-image ${className}`} src={`/icons/rpc-${name}.png`} alt="" aria-hidden="true" />;
}

function methodIcon(path: string): RpcIconName {
  if (path === "/health") return "health";
  if (path === "/net_info") return "network";
  if (path === "/block" || path === "/block_results" || path === "/blockchain") return "block";
  if (path === "/validators") return "validators";
  if (path === "/tx" || path === "/tx_search") return "search";
  if (path.includes("consensus")) return "cube";
  if (path === "/status") return "status";
  return "code";
}

/* ── RPC console ───────────────────────────────────────────────────────────
   polkadot.js-style: pick a call, fill the parameters, execute. Read-only by
   design — broadcast/send endpoints are deliberately not in the catalog. */

type ParamKind = "num" | "str" | "bool" | "numOrLatest";
type ParamSpec = { key: string; label: string; kind: ParamKind; placeholder?: string; hint?: string };
type MethodSpec = { group: string; path: string; params: ParamSpec[]; note?: string };

const METHODS: MethodSpec[] = [
  { group: "Node", path: "/status", params: [] },
  { group: "Node", path: "/health", params: [] },
  { group: "Node", path: "/net_info", params: [] },
  {
    group: "Node",
    path: "/genesis",
    params: [],
    note: "the full genesis document — the answer is very large",
  },
  { group: "Node", path: "/abci_info", params: [] },
  {
    group: "Blocks",
    path: "/block",
    params: [{ key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" }],
  },
  {
    group: "Blocks",
    path: "/block_results",
    params: [{ key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" }],
  },
  {
    group: "Blocks",
    path: "/commit",
    params: [{ key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" }],
  },
  {
    group: "Blocks",
    path: "/blockchain",
    params: [
      { key: "minHeight", label: "min height", kind: "num", placeholder: "1" },
      { key: "maxHeight", label: "max height", kind: "num", placeholder: "10" },
    ],
  },
  {
    group: "Validators",
    path: "/validators",
    params: [
      { key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" },
      { key: "page", label: "page", kind: "num", placeholder: "1" },
      { key: "per_page", label: "per page", kind: "num", placeholder: "30" },
    ],
  },
  {
    group: "Mempool",
    path: "/unconfirmed_txs",
    params: [{ key: "limit", label: "limit", kind: "num", placeholder: "30" }],
  },
  { group: "Mempool", path: "/num_unconfirmed_txs", params: [] },
  {
    group: "Transactions",
    path: "/tx",
    params: [
      { key: "hash", label: "hash", kind: "str", placeholder: "0x…", hint: "transaction hash" },
      { key: "prove", label: "prove", kind: "bool", placeholder: "false" },
    ],
  },
  {
    group: "Transactions",
    path: "/tx_search",
    params: [
      {
        key: "query",
        label: "query",
        kind: "str",
        placeholder: "tx.height=11695926",
        hint: "CometBFT query syntax",
      },
      { key: "prove", label: "prove", kind: "bool", placeholder: "false" },
      { key: "page", label: "page", kind: "num", placeholder: "1" },
      { key: "per_page", label: "per page", kind: "num", placeholder: "30" },
    ],
  },
  { group: "Consensus", path: "/consensus_state", params: [] },
  { group: "Consensus", path: "/dump_consensus_state", params: [] },
  {
    group: "Raw ABCI",
    path: "/abci_query",
    params: [
      { key: "path", label: "path", kind: "str", placeholder: "/cosmos.bank.v1beta1..." },
      { key: "data", label: "data", kind: "str", placeholder: "0x", hint: "hex-encoded request" },
      { key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" },
      { key: "prove", label: "prove", kind: "bool", placeholder: "false" },
    ],
    note: "raw module queries — Mezo's x/poa does not expose a plain ABCI path",
  },
];

/** Encode one parameter for CometBFT's GET convention: strings (and the
 *  literal "latest") are JSON-quoted, numbers and bools pass raw. */
function encodeParam(kind: ParamKind, value: string): string {
  if (kind === "str") return JSON.stringify(value);
  if (kind === "numOrLatest") return /^-?\d+$/.test(value) ? value : JSON.stringify(value);
  return value;
}

const CONSOLE_METHOD_KEY = "mezo-rpc-console-method";

function RpcConsole({ base }: { base: string }) {
  return <RpcConsoleReference base={base} />;

  // Legacy console implementation is retained below for compatibility with
  // persisted method state; the reference layout above is the active view.
  const [path, setPath] = useState<string>(() => {
    try {
      return localStorage.getItem(CONSOLE_METHOD_KEY) ?? "/status";
    } catch {
      return "/status";
    }
  });
  const spec = METHODS.find((m) => m.path === path) ?? METHODS[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<
    { state: "ok" | "error" | "blocked"; latencyMs: number; body?: unknown; error?: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<{ path: string; ok: boolean; ms: number }[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(CONSOLE_METHOD_KEY, path);
    } catch {
      /* storage unavailable — the console still works */
    }
    setValues({});
    setResult(null);
  }, [path]);

  /** Core runner shared by the Execute button and the quick-read buttons. */
  const run = async (path: string, rawValues: Record<string, string>) => {
    setBusy(true);
    const method = METHODS.find((m) => m.path === path);
    const params: Record<string, string> = {};
    for (const p of method?.params ?? []) {
      const v = (rawValues[p.key] ?? "").trim();
      if (v !== "") params[p.key] = encodeParam(p.kind, v);
    }
    const r = await rpcCallRaw(base, path, params);
    setHistory((h) => [{ path, ok: r.state === "ok", ms: r.latencyMs }, ...h].slice(0, 6));
    setResult(
      r.state === "ok"
        ? { state: "ok", latencyMs: r.latencyMs, body: r.data }
        : { state: r.state, latencyMs: r.latencyMs, error: r.error },
    );
    setBusy(false);
  };

  const execute = () => run(spec.path, values);

  /** One-click reads: the handful of calls that answer "how is the node". */
  const QUICK: { label: string; path: string; values?: Record<string, string> }[] = [
    { label: "Status", path: "/status" },
    { label: "Latest block", path: "/block" },
    { label: "Validators", path: "/validators", values: { page: "1", per_page: "30" } },
    { label: "Peers", path: "/net_info" },
    { label: "Mempool", path: "/unconfirmed_txs", values: { limit: "30" } },
    { label: "Consensus", path: "/consensus_state" },
    { label: "Health", path: "/health" },
  ];

  let pretty = "";
  let truncated = false;
  if (result?.state === "ok") {
    pretty = JSON.stringify(result!.body, null, 2) ?? "null";
    if (pretty.length > 200_000) {
      pretty = pretty.slice(0, 200_000);
      truncated = true;
    }
  }

  return (
    <Section
      title="RPC console"
      aside={
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
          read-only · browser → node, no monitor in the middle
        </span>
      }
    >
      <div style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ font: `600 9.5px/1 ${sans}`, letterSpacing: ".06em", color: TX3, marginRight: 2 }}>
            QUICK
          </span>
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={busy}
              onClick={() => {
                setPath(q.path);
                setValues(q.values ?? {});
                void run(q.path, q.values ?? {});
              }}
              style={{
                ...btn,
                padding: "6px 11px",
                font: `600 10.5px/1 ${sans}`,
                opacity: busy ? 0.5 : 1,
              }}
            >
              {q.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={spec.path}
            onChange={(e) => setPath(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--panel2)",
              font: `500 11.5px/1 ${mono}`,
              color: TX,
            }}
          >
            {[...new Set(METHODS.map((m) => m.group))].map((group) => (
              <optgroup key={group} label={group}>
                {METHODS.filter((x) => x.group === group).map((x) => (
                  <option key={x.path} value={x.path}>
                    {x.path}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {spec.params.map((p) => (
            <label
              key={p.key}
              title={p.hint ?? p.label}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ font: `500 10px/1 ${sans}`, color: TX3, whiteSpace: "nowrap" }}>
                {p.label}
              </span>
              <input
                value={values[p.key] ?? ""}
                placeholder={p.placeholder}
                spellCheck={false}
                onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && !busy && void execute()}
                style={{
                  width: p.kind === "str" ? 220 : 110,
                  padding: "7px 9px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--panel2)",
                  font: `400 11px/1 ${mono}`,
                  color: TX,
                }}
              />
            </label>
          ))}
          <button type="button" onClick={() => void execute()} disabled={busy} style={btn}>
            {busy ? "…" : "Execute"}
          </button>
        </div>

        {(spec.note || spec.params.some((p) => p.hint)) && (
          <span style={{ font: `400 10.5px/1.4 ${sans}`, color: TX3 }}>
            {spec.note ?? spec.params.find((p) => p.hint)?.hint}
          </span>
        )}

        {result && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                ...chip,
                background: result!.state === "ok" ? "var(--okSoft)" : "var(--badSoft)",
                color: result!.state === "ok" ? OK : BAD,
              }}
            >
              {result!.state === "ok" ? "200" : result!.state === "blocked" ? "blocked" : "error"} ·{" "}
              {result!.latencyMs}ms
            </span>
            {result!.state === "ok" && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(pretty);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }}
                style={{ ...btn, padding: "5px 10px" }}
              >
                {copied ? "Copied" : "Copy JSON"}
              </button>
            )}
            {history.length > 0 && (
              <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {history.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPath(h.path)}
                    style={{
                      ...btn,
                      padding: "4px 8px",
                      font: `500 9.5px/1 ${mono}`,
                      color: h.ok ? OK : BAD,
                      borderColor: "var(--line)",
                    }}
                  >
                    {h.path} · {h.ms}ms
                  </button>
                ))}
              </span>
            )}
          </div>
        )}

        {result?.state === "ok" ? (
          <pre
            style={{
              margin: 0,
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--panel2)",
              maxHeight: 420,
              overflow: "auto",
              font: `400 10.5px/1.55 ${mono}`,
              color: TX2,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {pretty}
            {truncated ? "\n\n… truncated — the full answer is larger than the display limit" : ""}
          </pre>
        ) : result ? (
          <div style={{ ...banner, border: "1px solid var(--line)", background: "var(--badSoft)" }}>
            <span style={{ font: `600 12px/1.3 ${sans}`, color: BAD }}>
              {result!.state === "blocked" ? "Browser blocked the request" : "Node answered with an error"}
            </span>
            <span style={{ font: `400 11px/1.5 ${sans}`, color: TX2 }}>{result!.error}</span>
          </div>
        ) : (
          <span style={{ font: `400 11px/1.5 ${sans}`, color: TX3 }}>
            Pick a call, fill the parameters (blank = the node's default) and execute — the request
            goes straight from this browser to {base || "the node"}. Broadcast/send endpoints are
            intentionally absent: this console is read-only, like the rest of the tool.
          </span>
        )}
      </div>
    </Section>
  );
}

function RpcConsoleReference({ base }: { base: string }) {
  const [path, setPath] = useState(() => {
    try { return localStorage.getItem(CONSOLE_METHOD_KEY) ?? "/health"; } catch { return "/health"; }
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ state: "ok" | "error" | "blocked"; latencyMs: number; body?: unknown; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [presetSaved, setPresetSaved] = useState(false);
  const [category, setCategory] = useState("Popular");
  const spec = METHODS.find((method) => method.path === path) ?? METHODS[0];
  const categories = ["Popular", "Blockchain", "Transactions", "Accounts", "Validators", "Mempool", "Network", "Debug", "Custom"];
  const popular = ["/status", "/health", "/net_info", "/block", "/validators", "/tx_search", "/consensus_state"];
  const groups: Record<string, string[]> = { Blockchain: ["Node", "Blocks"], Transactions: ["Transactions"], Accounts: ["Node"], Validators: ["Validators"], Mempool: ["Mempool"], Network: ["Node"], Debug: ["Consensus", "Raw ABCI"] };
  const visible = category === "Popular"
    ? popular.map((item) => METHODS.find((method) => method.path === item)).filter((method): method is MethodSpec => Boolean(method))
    : METHODS.filter((method) => category === "Custom" ? true : groups[category]?.includes(method.group));
  const descriptions: Record<string, string> = {
    "/status": "Get node status and sync info",
    "/health": "Get node health status",
    "/net_info": "Get network information",
    "/block": "Get block details",
    "/validators": "Get validator set information",
    "/tx_search": "Search for transactions",
    "/consensus_state": "Get consensus state",
  };

  useEffect(() => {
    try { localStorage.setItem(CONSOLE_METHOD_KEY, path); } catch { /* storage unavailable */ }
  }, [path]);

  const execute = async () => {
    setBusy(true);
    const params: Record<string, string> = {};
    for (const param of spec.params) {
      const value = (values[param.key] ?? "").trim();
      if (value) params[param.key] = encodeParam(param.kind, value);
    }
    const response = await rpcCallRaw(base, spec.path, params);
    setResult(response.state === "ok" ? { state: "ok", latencyMs: response.latencyMs, body: response.data } : { state: response.state, latencyMs: response.latencyMs, error: response.error });
    setBusy(false);
  };

  const pretty = result?.state === "ok" ? JSON.stringify(result.body, null, 2) ?? "null" : "";
  const choose = (next: string) => { setPath(next); setValues({}); setResult(null); };
  const clear = () => { setValues({}); setResult(null); };
  const copyResponse = () => {
    if (!pretty) return;
    void navigator.clipboard?.writeText(pretty);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="rpc-console-area">
      <section className="rpc-method-explorer">
        <div className="rpc-method-heading"><span className="rpc-panel-icon"><RpcIcon name="block" /></span><div><h2>Method Explorer</h2><p>Browse and execute RPC methods. Select a method to view its parameters and response.</p></div><a href="#/api">View API Docs ↗</a></div>
        <div className="rpc-category-tabs">{categories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="rpc-method-grid">
          {visible.slice(0, category === "Popular" ? 7 : 12).map((method) => <button type="button" key={method.path} className={`rpc-method-card ${method.path === spec.path ? "selected" : ""}`} onClick={() => choose(method.path)}><span className="rpc-method-icon"><RpcIcon name={methodIcon(method.path)} /></span><span><strong>{method.path.replace(/^\//, "")}</strong><small>{descriptions[method.path] ?? (method.params.length ? "Configure request parameters" : "Get node response")}</small></span></button>)}
          <button type="button" className="rpc-method-card view-all" onClick={() => setCategory("Custom")}><span className="rpc-method-icon"><RpcIcon name="response" /></span><span><strong>View all methods</strong><small>Browse complete list →</small></span></button>
        </div>
      </section>
      <div className="rpc-workbench">
        <section className="rpc-parameters-panel">
          <div className="rpc-workbench-heading"><span className="rpc-panel-icon"><RpcIcon name="code" /></span><div><h2>Parameters</h2><p>Configure method parameters.</p></div><span className="rpc-raw-toggle">Raw JSON <i /></span></div>
          <div className="rpc-parameter-fields">{spec.params.length === 0 ? <div className="rpc-no-params"><span>ⓘ</span><div><strong>This method does not require any parameters.</strong><small>Click Execute to run the method with an empty request.</small></div></div> : spec.params.map((param) => <label key={param.key}><span>{param.label}</span><input value={values[param.key] ?? ""} placeholder={param.placeholder} spellCheck={false} onChange={(event) => setValues((current) => ({ ...current, [param.key]: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && !busy && void execute()} /></label>)}</div>
          <span className="rpc-parameter-hint">{spec.note ?? spec.params.find((param) => param.hint)?.hint ?? `Selected method: ${spec.path}`}</span>
          <div className="rpc-parameter-actions"><div><button type="button" className="rpc-execute-button" onClick={() => void execute()} disabled={busy}>▷ {busy ? "Executing…" : "Execute"}<kbd>⌘↵</kbd></button><button type="button" className="rpc-clear-button" onClick={clear}>↻ Clear</button></div><button type="button" className="rpc-save-preset" onClick={() => { try { localStorage.setItem(CONSOLE_METHOD_KEY, path); } catch { /* storage unavailable */ } setPresetSaved(true); window.setTimeout(() => setPresetSaved(false), 1400); }}>▱ {presetSaved ? "Saved" : "Save as Preset"}</button></div>
        </section>
        <section className={`rpc-response-panel${expanded ? " expanded" : ""}`}>
          <div className="rpc-workbench-heading"><span className="rpc-panel-icon"><RpcIcon name="response" /></span><div><h2>Response</h2><p>RPC response from the node.</p></div><div className="rpc-response-toolbar">{result && <span className={`rpc-response-status ${result.state === "ok" ? "ok" : "error"}`}><i />{result.state === "ok" ? "200 OK" : result.state}</span>}{result && <small>◷ {result.latencyMs}ms</small>}<button type="button" onClick={copyResponse} disabled={!pretty}>{copied ? "✓ Copied" : "▣ Copy"}</button><button type="button" aria-label={expanded ? "Close expanded response" : "Expand response"} onClick={() => setExpanded((value) => !value)}>{expanded ? "×" : "⛶"}</button></div></div>
          <div className="rpc-response-code" role="region" aria-label="RPC JSON response" tabIndex={0}>{result?.state === "ok" ? <pre>{pretty}</pre> : result ? <span className="rpc-response-error">{result.error}</span> : <span className="rpc-response-empty">Execute a method to inspect the node response.</span>}<span className="rpc-response-format">JSON⌄</span></div>
        </section>
      </div>
    </div>
  );
}

type PanelState = {
  probe: NodeProbe | null;
  blocks: RpcResult<BlockInfo[]> | null;
  netInfo: RpcResult<NetInfo> | null;
  loading: boolean;
  lastUpdated: Date | null;
};

const EMPTY: PanelState = {
  probe: null,
  blocks: null,
  netInfo: null,
  loading: false,
  lastUpdated: null,
};

export function DirectRpc({ d }: { d: Dashboard }) {
  const endpoints = d.endpoints?.endpoints ?? [];
  const suggested = endpoints
    .map((e) => e.rpc_url)
    .filter((u): u is string => Boolean(u));
  const [url, setUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? PUBLIC_ENDPOINTS[0].url;
    } catch {
      return PUBLIC_ENDPOINTS[0].url;
    }
  });
  /** Name of the configured endpoint matching the entered URL, if any. Must
   *  sit after the url useState: it reads url, and reading it earlier throws
   *  (TDZ) — a crash that only fired once endpoint data had loaded. */
  const matched =
    endpoints.find((e) => e.rpc_url && e.rpc_url.replace(/\/+$/, "") === url.replace(/\/+$/, "")) ??
    null;
  const [live] = useState(true);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<PanelState>(EMPTY);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* private mode / disabled storage — the panel still works */
    }
  }, [url]);

  const refresh = useCallback(async () => {
    const base = urlRef.current;
    if (!base) {
      setState(EMPTY);
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const probe = await probeNode(base);
    if (probe.state !== "ok") {
      // One blocked/error verdict is enough — the banner explains why.
      setState({ ...EMPTY, probe, lastUpdated: new Date() });
      return;
    }
    const head = Number(probe.latest);
    const heights = Number.isFinite(head)
      ? Array.from({ length: BLOCK_COUNT }, (_, i) => head - i).filter((h) => h > 0)
      : [];
    const [netInfo, ...blockResults] = await Promise.all([
      fetchNetInfo(base),
      ...heights.map((h) => fetchBlock(base, h)),
    ]);
    const blocks: RpcResult<BlockInfo[]> = blockResults.every((b) => b.state === "ok")
      ? { state: "ok", latencyMs: 0, data: blockResults.map((b) => (b as { data: BlockInfo }).data) }
      : blockResults.find((b) => b.state !== "ok")!;
    setState({
      probe,
      netInfo,
      blocks,
      loading: false,
      lastUpdated: new Date(),
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, tick, url]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, [live]);

  const probe = state.probe;
  const blocked = probe !== null && probe.state !== "ok";

  return (
    <div className="direct-rpc-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <RpcEndpointPanel
        url={url}
        setUrl={setUrl}
        suggested={[...PUBLIC_ENDPOINTS.map((endpoint) => endpoint.url), ...suggested]}
        probe={probe}
        loading={state.loading}
        onConnect={() => void refresh()}
      />

      {blocked && probe && (
        <div style={{ ...banner, border: "1px solid var(--line)", background: "var(--badSoft)" }}>
          <span style={{ font: `600 12.5px/1.3 ${sans}`, color: BAD }}>
            {probe.state === "blocked" ? "Browser blocked the request" : "Node unreachable"}
          </span>
          <span style={{ font: `400 11.5px/1.5 ${sans}`, color: TX2 }}>
            {probe.error}. The node must send CORS headers, and an http node cannot be queried
            from the https dashboard.
          </span>
        </div>
      )}

      <RpcConsole base={url} />
      <RpcSummaryGrid probe={probe} netInfo={state.netInfo} blocks={state.blocks} endpoint={matched?.label ?? url} />
    </div>
  );
}

function RpcSummaryGrid({
  probe,
  netInfo,
  blocks,
  endpoint,
}: {
  probe: NodeProbe | null;
  netInfo: RpcResult<NetInfo> | null;
  blocks: RpcResult<BlockInfo[]> | null;
  endpoint: string;
}) {
  const network = netInfo?.state === "ok" ? netInfo.data : null;
  const recent = blocks?.state === "ok" ? blocks.data.slice(0, 5) : [];
  const synced = probe?.state === "ok" && !probe.catchingUp;
  return (
    <div className="rpc-summary-grid">
      <section className="rpc-summary-card">
        <div className="rpc-summary-head"><span className="rpc-summary-icon"><RpcIcon name="status" /></span><h2>Node Status</h2>{probe?.state === "ok" && <span className={`rpc-summary-state ${synced ? "ok" : "warn"}`}><i />{synced ? "Synced" : "Catching up"}</span>}</div>
        <div className="rpc-summary-body">
          <SummaryRow label="Network" value={probe?.state === "ok" ? probe.network ?? "—" : "—"} />
          <SummaryRow label="Latest Block" value={probe?.state === "ok" ? fmt(Number(probe.latest)) : "—"} />
          <SummaryRow label="Sync Status" value={probe?.state === "ok" ? (synced ? "100.00%" : "Syncing") : "—"} />
          <SummaryRow label="Node Version" value={probe?.state === "ok" ? probe.version ?? "—" : "—"} />
          <SummaryRow label="Moniker" value={probe?.state === "ok" ? probe.moniker ?? "—" : "—"} />
        </div>
      </section>
      <section className="rpc-summary-card">
        <div className="rpc-summary-head"><span className="rpc-summary-icon"><RpcIcon name="network" /></span><h2>Network Info</h2></div>
        <div className="rpc-summary-body">
          <SummaryRow label="Chain ID" value={probe?.state === "ok" ? probe.network ?? "—" : "—"} />
          <SummaryRow label="Peers" value={network ? fmt(network.nPeers) : "—"} />
          <SummaryRow label="Listening" value={network ? (network.listening ? "Yes" : "No") : "—"} />
          <SummaryRow label="RPC Endpoint" value={endpoint || "—"} title={endpoint} />
          <SummaryRow label="Earliest Block" value={probe?.state === "ok" ? fmt(Number(probe.earliest)) : "—"} />
        </div>
      </section>
      <section className="rpc-summary-card rpc-latest-blocks-card">
        <div className="rpc-summary-head"><span className="rpc-summary-icon"><RpcIcon name="block" /></span><h2>Latest Blocks</h2><a href="#/blocks">View all →</a></div>
        <div className="rpc-latest-block-list">
          {recent.length > 0 ? recent.map((block) => (
            <a key={block.height} href="#/blocks" className="rpc-latest-block-row">
              <span aria-hidden="true"><RpcIcon name="block" className="rpc-row-icon" /></span><strong>{fmt(Number(block.height))}</strong><small>{block.time ? `${agoFrom(block.time)} ago` : "—"}</small><em>{fmt(block.txCount)} txs</em>
            </a>
          )) : <span className="rpc-summary-empty">Waiting for a successful probe…</span>}
        </div>
      </section>
    </div>
  );
}

function SummaryRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="rpc-summary-row"><span>{label}</span><strong title={title}>{value}</strong></div>;
}

function RpcEndpointPanel({
  url,
  setUrl,
  suggested,
  probe,
  loading,
  onConnect,
}: {
  url: string;
  setUrl: (value: string) => void;
  suggested: string[];
  probe: NodeProbe | null;
  loading: boolean;
  onConnect: () => void;
}) {
  const cards = [
    { ...PUBLIC_ENDPOINTS[0], label: "Mainnet", badge: "Recommended" },
    { ...PUBLIC_ENDPOINTS[1], label: "Public RPC", badge: "Public" },
  ];
  return (
    <section className="rpc-endpoint-panel">
      <div className="rpc-panel-heading"><span className="rpc-panel-icon"><RpcIcon name="link" /></span><div><h2>RPC Endpoint</h2><p>Enter a Mezo RPC endpoint or choose a quick connection below.</p></div></div>
      <div className="rpc-endpoint-connect-row">
        <div className="rpc-endpoint-input-wrap"><RpcIcon name="link" className="rpc-input-icon" /><input list="mezo-rpc-suggestions" value={url} placeholder="https://rpc.mezo.your-node.example" onChange={(e) => setUrl(e.target.value)} spellCheck={false} /><button type="button" aria-label="Clear endpoint" onClick={() => setUrl("")}>×</button></div>
        <datalist id="mezo-rpc-suggestions">{suggested.map((u) => <option key={u} value={u} />)}</datalist>
        <span className={`rpc-connected-pill ${probe?.state === "ok" ? "connected" : ""}`}><i />{probe?.state === "ok" ? "Connected" : "Not connected"}<b>⌄</b></span>
        <span className="rpc-latency-pill"><i>▥</i><strong>{probe ? `${probe.latencyMs} ms` : "—"}</strong><small>Latency</small></span>
        <button type="button" className="rpc-connect-button" onClick={onConnect} disabled={loading}><RpcIcon name="link" />{loading ? "Connecting…" : "Connect"}</button>
      </div>
      <span className="rpc-quick-label">Quick endpoints</span>
      <div className="rpc-endpoint-cards">
        {cards.map((endpoint, index) => {
          const selected = normalizeRpcUrl(endpoint.url) === normalizeRpcUrl(url);
          return <button type="button" key={endpoint.key} className={`rpc-endpoint-card ${selected ? "selected" : ""}`} onClick={() => setUrl(endpoint.url)}><span className={`rpc-endpoint-card-icon icon-${index}`}>{index === 0 ? <img className="rpc-mezo-mark" src="/mezo-icon.png" alt="" aria-hidden="true" /> : <RpcIcon name="block" />}</span><span><strong>{endpoint.label}</strong><small>{endpoint.url}</small></span><em>{endpoint.badge}</em><b className="rpc-endpoint-radio">{selected ? "●" : "○"}</b></button>;
        })}
        <button type="button" className="rpc-endpoint-card add" onClick={() => setUrl("")}><span className="rpc-endpoint-card-icon">＋</span><span><strong>Add Custom Endpoint</strong><small>Save and connect to a custom RPC</small></span><b className="rpc-endpoint-radio">○</b></button>
      </div>
    </section>
  );
}

function NetInfoCard({ r }: { r: RpcResult<NetInfo> | null }) {
  const rows: [string, string][] | null =
    r?.state === "ok"
      ? [
          ["listening", r.data.listening ? "yes" : "no"],
          ["peers", fmt(r.data.nPeers)],
          ["listeners", r.data.listeners.length ? String(r.data.listeners.length) : "—"],
          ["moniker", r.data.moniker ?? "—"],
        ]
      : null;
  return (
    <KeyValue
      title="Network info"
      aside={r?.state === "error" ? "/net_info unavailable" : "/net_info"}
      rows={rows}
      footnote={r?.state === "error" ? "this node does not expose /net_info" : undefined}
    />
  );
}

function ValidatorsCard({
  base,
  r,
  names,
}: {
  base: string;
  r: RpcResult<ValidatorsPage> | null;
  names: Map<string, string>;
}) {
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState<RpcResult<ValidatorsPage> | null>(null);
  useEffect(() => {
    setPage(1);
    setExtra(null);
  }, [base, r]);

  if (!r) {
    return (
      <Section title="Validator set (direct)" aside="/validators">
        <Empty text="Waiting for a successful probe…" />
      </Section>
    );
  }
  if (r.state !== "ok") {
    return (
      <Section title="Validator set (direct)" aside="/validators">
        <Empty text={r.error} />
      </Section>
    );
  }
  const shown = extra?.state === "ok" ? extra.data : r.data;
  const totalPower = shown.validators.reduce((a, v) => a + v.votingPower, 0) || 1;
  const more = page * 30 < shown.total;
  return (
    <Section
      title="Validator set (direct)"
      aside={
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
          {fmt(shown.total)} validators · height {shown.blockHeight ?? "—"}
        </span>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["validator", "voting power", "share", "proposer priority"].map((h) => (
              <th key={h} style={{ ...th, textAlign: h === "validator" ? "left" : "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.validators.map((v) => (
            <tr key={v.address}>
              <td style={{ ...td, font: `400 11px/1 ${mono}`, color: TX }} title={v.address}>
                {names.get(v.address) ?? short(v.address)}
              </td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(v.votingPower)}</td>
              <td style={{ ...td, textAlign: "right", color: TX2 }}>
                {((v.votingPower / totalPower) * 100).toFixed(1)}%
              </td>
              <td style={{ ...td, textAlign: "right", color: TX3 }}>
                {v.proposerPriority !== undefined ? fmt(v.proposerPriority) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "10px 16px", display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          disabled={!more}
          onClick={() => {
            const next = page + 1;
            fetchValidators(base, "latest", next).then((res) => {
              setPage(next);
              setExtra(res);
            });
          }}
          style={{ ...btn, opacity: more ? 1 : 0.4, cursor: more ? "pointer" : "default" }}
        >
          {more ? `Next page (${Math.min(30, shown.total - page * 30)} more)` : "no more"}
        </button>
      </div>
    </Section>
  );
}

function BlocksCard({
  r,
  names,
}: {
  r: RpcResult<BlockInfo[]> | null;
  names: Map<string, string>;
}) {
  if (!r) {
    return (
      <Section title="Recent blocks (direct)" aside="/block">
        <Empty text="Waiting for a successful probe…" />
      </Section>
    );
  }
  if (r.state !== "ok") {
    return (
      <Section title="Recent blocks (direct)" aside="/block">
        <Empty text={r.error} />
      </Section>
    );
  }
  return (
    <Section
      title="Recent blocks (direct)"
      aside={
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
          latest {BLOCK_COUNT} · no commit signatures (direct view)
        </span>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["height", "time", "txs", "proposer"].map((h) => (
              <th key={h} style={{ ...th, textAlign: h === "height" ? "left" : "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.data.map((b) => (
            <tr key={b.height}>
              <td style={{ ...td, font: `400 11px/1 ${mono}`, color: TX }}>{fmt(Number(b.height))}</td>
              <td style={{ ...td, textAlign: "right", color: TX2 }}>
                {b.time ? `${agoFrom(b.time)} ago` : "—"}
              </td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(b.txCount)}</td>
              <td style={{ ...td, textAlign: "right", color: TX3 }} title={b.proposerAddress ?? ""}>
                {(b.proposerAddress && names.get(b.proposerAddress)) || short(b.proposerAddress)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function KeyValue({
  title,
  aside,
  rows,
  pill,
  footnote,
}: {
  title: string;
  aside?: string;
  rows: [string, string][] | null;
  pill?: string | null;
  footnote?: string;
}) {
  return (
    <Section
      title={title}
      aside={
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>{aside ?? ""}</span>
      }
    >
      {rows === null ? (
        <Empty text="—" />
      ) : (
        <>
          {rows.map(([k, v]) => (
            <div key={k} style={rowStyle}>
              <span style={{ font: `500 11.5px/1 ${mono}`, color: TX3 }}>{k}</span>
              <span
                style={{
                  font: `500 11.5px/1 ${mono}`,
                  color: v === "catching up" ? WARN : TX,
                }}
              >
                {k === "sync" && pill ? <StatusPill status={pill} /> : v}
              </span>
            </div>
          ))}
          {footnote && (
            <div style={{ padding: "8px 16px", font: `400 10.5px/1.4 ${sans}`, color: TX3 }}>
              {footnote}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: "24px 16px", font: `400 12px/1.4 ${sans}`, color: TX3 }}>{text}</div>
  );
}

/* Retained as non-rendered drill-down building blocks; the production page
 * now uses the compact three-card summary above instead of duplicating these
 * full tables in the main flow. */
void NetInfoCard;
void ValidatorsCard;
void BlocksCard;

const banner: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  padding: "12px 14px",
  borderRadius: 10,
};

const chip: React.CSSProperties = {
  flex: "none",
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "6px 10px",
  borderRadius: 8,
  font: `600 10.5px/1 ${sans}`,
};

const btn: React.CSSProperties = {
  flex: "none",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "transparent",
  color: TX2,
  font: `600 11px/1 ${sans}`,
  cursor: "pointer",
};

const th: React.CSSProperties = {
  padding: "9px 16px",
  borderBottom: "1px solid var(--line)",
  font: `600 9.5px/1 ${sans}`,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: TX3,
};

const td: React.CSSProperties = {
  padding: "9px 16px",
  borderBottom: "1px solid var(--line)",
  font: `400 11.5px/1 ${mono}`,
  color: TX,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "11px 16px",
  borderBottom: "1px solid var(--line)",
};
