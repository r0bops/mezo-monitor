/** Overview: stat tiles, validator table, signing heatmap and analytics row. */
import { useMemo, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Validator } from "../api";
import {
  BAD,
  BRAND,
  Bar,
  CopyButton,
  EmptyState,
  Identicon,
  Label,
  LineChart,
  Meter,
  OK,
  Section,
  Skeleton,
  StatusPill,
  TX,
  TX2,
  TX3,
  WARN,
  mono,
  panel,
  sans,
} from "../components/ui";
import { agoFrom, area, clampPct, fill, fmt, pct, pts, secs, short } from "../lib";

const WINDOWS = [100, 500, 1000];

export function Overview({
  d,
  selected,
  onSelect,
  win,
  onWindow,
  copied,
  onCopy,
}: {
  d: Dashboard;
  selected: string | null;
  onSelect: (a: string) => void;
  win: number;
  onWindow: (w: number) => void;
  copied: string | null;
  onCopy: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);

  const loading = d.state === "loading";
  const dash = d.state === "empty" || d.state === "dberror";
  const backfill = d.state === "backfill";
  const stopped = d.state === "stopped";
  const net = d.net;

  const blocksSeries = useMemo(
    () => (d.series?.points ?? []).slice(-24).map((p) => p.n),
    [d.series],
  );
  const btSeries = useMemo(
    () => fill((d.series?.points ?? []).map((p) => p.block_time_s)),
    [d.series],
  );
  const srSeries = useMemo(
    () => fill((d.series?.points ?? []).map((p) => p.signing_rate)),
    [d.series],
  );

  // "+N in last 10 min" — the trailing ten one-minute buckets.
  const last10 = useMemo(
    () => (d.series?.points ?? []).slice(-10).reduce((a, p) => a + p.n, 0),
    [d.series],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{ ...panel, padding: "15px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Skeleton h={9} w="64%" />
              <Skeleton h={26} w="78%" r={6} />
              <Skeleton h={22} w="100%" r={5} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
          <HeightTile
            dash={dash}
            stopped={stopped}
            height={net?.latest_indexed_height ?? null}
            last10={last10}
            spark={blocksSeries}
            lastBlock={net?.last_block_time ?? null}
          />
          <BlockTimeTile dash={dash} ms={net?.avg_block_time_ms ?? null} spark={btSeries} />
          <SigningTile dash={dash} net={net} />
          <ValidatorsTile dash={dash} d={d} />
          <LagTile dash={dash} d={d} />
        </div>
      )}

      <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
        <ValidatorTable
          d={d}
          selected={selected}
          onSelect={onSelect}
          expanded={expanded}
          setExpanded={setExpanded}
          copied={copied}
          onCopy={onCopy}
          backfill={backfill}
        />
        <DetailPanel
          d={d}
          win={win}
          onWindow={onWindow}
          copied={copied}
          onCopy={onCopy}
          tip={tip}
          setTip={setTip}
          backfill={backfill}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, alignItems: "stretch" }}>
        <NetworkHealth d={d} dash={dash} />
        <MiniChart
          title="Block Time"
          now={secs(btSeries.length ? btSeries[btSeries.length - 1] : null)}
          series={btSeries}
          min={2}
          max={6}
          stroke={OK}
          fillColor="var(--okSoft)"
          topLabel="6s"
          bottomLabel="2s"
          dash={dash}
        />
        <MiniChart
          title="Signing Rate"
          now={pct(srSeries.length ? srSeries[srSeries.length - 1] : null)}
          series={srSeries}
          min={0}
          max={100}
          stroke={BRAND}
          fillColor="var(--brandSoft)"
          topLabel="100%"
          bottomLabel="0%"
          dash={dash}
        />
        <SetChanges d={d} />
      </div>
    </div>
  );
}

/* ── stat tiles ─────────────────────────────────────────────────────────── */

const tile: React.CSSProperties = {
  ...panel,
  padding: "15px 16px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 9,
};

const bigValue: React.CSSProperties = {
  font: `600 25px/1 ${mono}`,
  letterSpacing: "-.02em",
};

function HeightTile({
  dash,
  stopped,
  height,
  last10,
  spark,
  lastBlock,
}: {
  dash: boolean;
  stopped: boolean;
  height: number | null;
  last10: number;
  spark: number[];
  lastBlock: string | null;
}) {
  const max = Math.max(1, ...spark);
  return (
    <div style={tile}>
      <Label>Latest Indexed Height</Label>
      <span style={{ ...bigValue, color: dash ? TX3 : TX }}>{dash ? "—" : fmt(height)}</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={{ font: `500 11px/1.3 ${sans}`, color: TX2, whiteSpace: "nowrap" }}>
          {dash ? "no blocks" : stopped ? `stalled ${agoFrom(lastBlock)} ago` : `+${fmt(last10)} in last 10 min`}
        </span>
        {!dash && spark.length > 1 && (
          <svg width="76" height="26" viewBox="0 0 76 26" fill="none" style={{ flex: "none", overflow: "visible" }}>
            <path d={area(spark, 76, 26, 0, max)} fill="var(--brandSoft)" />
            <polyline
              points={pts(spark, 76, 26, 0, max)}
              fill="none"
              stroke={BRAND}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

function BlockTimeTile({ dash, ms, spark }: { dash: boolean; ms: number | null; spark: number[] }) {
  return (
    <div style={tile}>
      <Label>Avg Block Time</Label>
      <span style={{ ...bigValue, color: dash ? TX3 : TX }}>
        {dash || ms === null ? "—" : secs(ms / 1000)}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span style={{ font: `500 11px/1.3 ${sans}`, color: TX2 }}>last 100 blocks</span>
        <div style={{ position: "relative", flex: "none" }}>
          <svg width="76" height="26" viewBox="0 0 76 26" fill="none" style={{ display: "block", overflow: "visible" }}>
            <line x1="0" y1="0.5" x2="76" y2="0.5" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 3" />
            <line x1="0" y1="25.5" x2="76" y2="25.5" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 3" />
            {!dash && spark.length > 1 && (
              <polyline
                points={pts(spark.slice(-24), 76, 26, 2, 6)}
                fill="none"
                stroke={OK}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>
          <span style={{ position: "absolute", right: -2, top: -11, font: `400 8px/1 ${mono}`, color: TX3 }}>6s</span>
          <span style={{ position: "absolute", right: -2, bottom: -11, font: `400 8px/1 ${mono}`, color: TX3 }}>2s</span>
        </div>
      </div>
    </div>
  );
}

function SigningTile({ dash, net }: { dash: boolean; net: Dashboard["net"] }) {
  const rate = net?.signing_rate_100 ?? null;
  const degraded = rate !== null && rate < 99.5;
  const segs =
    dash || !net
      ? new Array(100).fill(null).map(() => "var(--line)")
      : padStart(
          net.recent_signing.map((b) =>
            b.total && b.signed !== null && b.signed < b.total
              ? BAD
              : "color-mix(in srgb, var(--ok) 78%, transparent)",
          ),
          100,
          "var(--line)",
        );
  const signedNow = net?.recent_signing.at(-1);
  return (
    <div style={tile}>
      <Label>Signing Rate</Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...bigValue, color: dash ? TX3 : degraded ? WARN : TX }}>
          {dash ? "—" : pct(rate)}
        </span>
        <span style={{ font: `500 11px/1 ${sans}`, color: TX2, whiteSpace: "nowrap" }}>
          {dash || !signedNow ? "" : `${signedNow.signed ?? 0} / ${signedNow.total ?? 0} signed`}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", gap: 1, height: 18, alignItems: "stretch" }}>
          {segs.map((g, i) => (
            <div key={i} style={{ flex: 1, borderRadius: 1, background: g }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", font: `400 8.5px/1 ${mono}`, color: TX3 }}>
          <span>−100</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}

function ValidatorsTile({ dash, d }: { dash: boolean; d: Dashboard }) {
  const net = d.net;
  const dots = d.validators.length
    ? d.validators.map((v) =>
        dash
          ? "var(--line)"
          : v.status === "degraded"
            ? WARN
            : v.status === "inactive"
              ? "var(--line2)"
              : "color-mix(in srgb, var(--ok) 70%, transparent)",
      )
    : new Array(20).fill("var(--line)");
  return (
    <div style={tile}>
      <Label>Active Validators</Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ ...bigValue, color: dash ? TX3 : TX }}>
          {dash ? "—" : fmt(net?.active_validators ?? 0)}
        </span>
        <span style={{ font: `500 15px/1 ${mono}`, color: TX3 }}>
          {dash ? "" : `/ ${net?.total_validators ?? 0}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {dots.map((c, i) => (
            <div key={i} style={{ flex: 1, height: 14, borderRadius: 2, background: c }} />
          ))}
        </div>
      </div>
      <span style={{ font: `500 11px/1.3 ${sans}`, color: TX2, whiteSpace: "nowrap" }}>
        {dash
          ? "set unknown"
          : net?.last_set_change
            ? `last change ${agoFrom(net.last_set_change.time)} ago`
            : "no membership change recorded"}
      </span>
    </div>
  );
}

function LagTile({ dash, d }: { dash: boolean; d: Dashboard }) {
  const lag = d.net?.indexer_lag_blocks ?? null;
  const unknown = lag === null;
  const warn = lag !== null && lag > 50;
  const fg = dash || unknown ? TX3 : warn ? WARN : OK;
  const icon = dash || unknown || warn ? "M10 6v5M10 14h.01" : "M4 10.5l4 4 8-9";
  return (
    <div
      style={{
        ...tile,
        border: `1px solid ${warn ? "var(--warn)" : "var(--line)"}`,
      }}
    >
      <Label>Indexer Lag</Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...bigValue, color: fg }}>{dash || unknown ? "—" : fmt(lag)}</span>
        <span style={{ font: `500 12px/1 ${sans}`, color: TX3 }}>
          {dash || unknown ? "" : "blocks"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: "auto" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            flex: "none",
            background: dash || unknown ? "var(--panel2)" : warn ? "var(--warnSoft)" : "var(--okSoft)",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke={fg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        </span>
        <span style={{ font: `600 11.5px/1.3 ${sans}`, whiteSpace: "nowrap", color: fg }}>
          {dash
            ? "Not started"
            : unknown
              ? "Chain head unavailable"
              : warn
                ? "Behind chain head"
                : "Up to date"}
        </span>
      </div>
    </div>
  );
}

function padStart<T>(arr: T[], n: number, filler: T): T[] {
  if (arr.length >= n) return arr.slice(-n);
  return new Array(n - arr.length).fill(filler).concat(arr);
}

/* ── validator table ────────────────────────────────────────────────────── */

const COLS = "28px 132px 80px 80px 48px 80px 64px 24px";

function ValidatorTable({
  d,
  selected,
  onSelect,
  expanded,
  setExpanded,
  copied,
  onCopy,
  backfill,
}: {
  d: Dashboard;
  selected: string | null;
  onSelect: (a: string) => void;
  expanded: string | null;
  setExpanded: (a: string | null) => void;
  copied: string | null;
  onCopy: (v: string) => void;
  backfill: boolean;
}) {
  const loading = d.state === "loading";
  const empty = d.state === "empty" || d.state === "dberror";
  const dberr = d.state === "dberror";

  return (
    <Section
      style={{ width: 574, flex: "none" }}
      title="Validators"
      aside={
        <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3, whiteSpace: "nowrap" }}>
          uptime meters scaled 98–100%
        </span>
      }
    >
      {loading && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
          {new Array(12).fill(0).map((_, i) => (
            <Skeleton key={i} h={14} w="100%" />
          ))}
        </div>
      )}

      {empty && (
        <EmptyState
          title={dberr ? "No data available" : "Awaiting RPC"}
          text={
            dberr
              ? "The validator set cannot be read while the database is unreachable."
              : "No blocks indexed yet. Validators appear once the first commit is ingested."
          }
        />
      )}

      {!loading && !empty && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              alignItems: "center",
              padding: "0 16px",
              height: 34,
              borderBottom: "1px solid var(--line)",
              background: "var(--panel2)",
            }}
          >
            <Label size={9}>#</Label>
            <Label size={9}>Consensus address</Label>
            <Label size={9}>Uptime 1k</Label>
            <Label size={9}>Uptime 10k</Label>
            <span style={{ textAlign: "right" }}>
              <Label size={9}>Miss</Label>
            </span>
            <span style={{ paddingLeft: 12 }}>
              <Label size={9}>Proposer 1k</Label>
            </span>
            <span style={{ textAlign: "right" }}>
              <Label size={9}>Status</Label>
            </span>
            <span />
          </div>

          {d.validators.map((v) => (
            <Row
              key={v.address}
              v={v}
              selected={v.address === selected}
              onSelect={onSelect}
              open={expanded === v.address}
              onToggle={() => setExpanded(expanded === v.address ? null : v.address)}
              copied={copied === v.address}
              onCopy={onCopy}
              backfill={backfill}
              longTarget={d.net?.long_window.target ?? 10_000}
            />
          ))}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "11px 16px",
              background: "var(--panel2)",
            }}
          >
            <span style={{ font: `400 11px/1 ${sans}`, color: TX3 }}>
              Showing 1 to {d.validators.length} of {d.validators.length}
            </span>
            <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
              {backfill
                ? `long window ${longPct(d)}% backfilled`
                : "consensus addresses · no monikers on this chain"}
            </span>
          </div>
        </div>
      )}
    </Section>
  );
}

function longPct(d: Dashboard): number {
  const w = d.net?.long_window;
  if (!w) return 0;
  return Math.round((w.filled / w.target) * 100);
}

function uptimeColor(v: number | null, degraded: boolean): string {
  if (v === null) return TX3;
  if (degraded) return WARN;
  return v >= 99.9 ? OK : TX;
}

function Row({
  v,
  selected,
  onSelect,
  open,
  onToggle,
  copied,
  onCopy,
  backfill,
  longTarget,
}: {
  v: Validator;
  selected: boolean;
  onSelect: (a: string) => void;
  open: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: (v: string) => void;
  backfill: boolean;
  longTarget: number;
}) {
  const deg = v.status === "degraded";
  const partial = v.slots_10000 < longTarget;
  const cell = { font: `500 11.5px/1 ${mono}` } as const;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--line)",
        background: selected ? "var(--brandSoft)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 0 var(--brand)" : "none",
      }}
    >
      <div
        onClick={() => onSelect(v.address)}
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          alignItems: "center",
          padding: "0 16px",
          height: 44,
          cursor: "pointer",
        }}
      >
        <span style={{ ...cell, fontSize: 11, color: TX3 }}>{v.rank}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <Identicon address={v.address} size={16} />
          <span style={{ ...cell, color: selected ? TX : TX2, letterSpacing: "-.01em", whiteSpace: "nowrap" }}>
            {short(v.address)}
          </span>
          <CopyButton value={v.address} copied={copied} onCopy={onCopy} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 12 }}>
          <span style={{ ...cell, color: uptimeColor(v.uptime_1000, deg) }}>{pct(v.uptime_1000)}</span>
          <Bar
            width={v.uptime_1000 === null ? "0%" : clampPct(v.uptime_1000, 98, 100)}
            color={uptimeColor(v.uptime_1000, deg)}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 12 }}>
          <span style={{ ...cell, color: partial ? WARN : uptimeColor(v.uptime_10000, deg) }}>
            {partial ? `${fmt(v.slots_10000)} / ${longTarget / 1000}k` : pct(v.uptime_10000, 2)}
          </span>
          <Bar
            width={
              partial
                ? `${Math.min(100, Math.round((v.slots_10000 / longTarget) * 100))}%`
                : v.uptime_10000 === null
                  ? "0%"
                  : clampPct(v.uptime_10000, 98, 100)
            }
            color={
              partial
                ? "repeating-linear-gradient(115deg,var(--warn) 0 3px,transparent 3px 6px)"
                : uptimeColor(v.uptime_10000, deg)
            }
          />
        </div>
        <span
          style={{
            ...cell,
            textAlign: "right",
            color: v.missed_streak >= 3 ? BAD : v.missed_streak > 0 ? WARN : TX3,
          }}
        >
          {v.missed_streak}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 12px" }}>
          <span style={{ ...cell, color: TX2 }}>{pct(v.proposer_share_1000)}</span>
          <Bar width={clampPct(v.proposer_share_1000 ?? 0, 0, 10)} color={BRAND} />
        </div>
        <span style={{ justifySelf: "end" }}>
          <StatusPill status={v.status} />
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          style={{
            justifySelf: "end",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            color: TX3,
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8l4 4 4-4" />
          </svg>
        </button>
      </div>

      {open && (
        <div style={{ display: "flex", gap: 26, padding: "0 16px 14px 46px", background: "var(--panel2)" }}>
          <Detail label="First seen" value={fmt(v.first_seen_height)} />
          <Detail label="Last seen" value={fmt(v.last_seen_height)} />
          <Detail label="Voting power" value={fmt(v.voting_power)} />
          <Detail label="Pub key" value={v.pub_key ?? "—"} truncate />
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <Label size={9}>{label}</Label>
      <span
        style={{
          font: `500 11px/1 ${mono}`,
          color: TX2,
          overflow: truncate ? "hidden" : undefined,
          textOverflow: truncate ? "ellipsis" : undefined,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── signing heatmap panel ──────────────────────────────────────────────── */

function DetailPanel({
  d,
  win,
  onWindow,
  copied,
  onCopy,
  tip,
  setTip,
  backfill,
}: {
  d: Dashboard;
  win: number;
  onWindow: (w: number) => void;
  copied: string | null;
  onCopy: (v: string) => void;
  tip: { i: number; x: number; y: number } | null;
  setTip: (t: { i: number; x: number; y: number } | null) => void;
  backfill: boolean;
}) {
  const loading = d.state === "loading";
  const empty = d.state === "empty" || d.state === "dberror";
  const dberr = d.state === "dberror";
  const sel = d.detail?.validator ?? null;
  const slots = d.detail?.slots ?? [];
  const blockscout = d.net?.chain.blockscout_url;

  // Rows fade with age so the newest activity reads first, as in the mockup.
  const rows = Math.max(1, Math.ceil(win / 50));
  const fadeMax = rows <= 2 ? 16 : 58;
  const cells = slots.map((s, i) => {
    const row = Math.floor(i / 50);
    const p = Math.round(100 - (rows > 1 ? (row / (rows - 1)) * fadeMax : 0));
    return {
      bg:
        s.signed === null
          ? "var(--line2)"
          : s.signed
            ? `color-mix(in srgb, var(--ok) ${p}%, transparent)`
            : BAD,
      slot: s,
    };
  });

  const missed = slots.filter((s) => s.signed === false).length;
  const na = slots.filter((s) => s.signed === null).length;
  const longTarget = d.net?.long_window.target ?? 10_000;
  const partial = sel !== null && sel.slots_10000 < longTarget;
  const tipCell = tip ? cells[tip.i] : null;

  return (
    <section style={{ ...panel, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          padding: "14px 18px 13px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {sel ? (
              <>
                <Identicon address={sel.address} size={20} />
                <span style={{ font: `600 14px/1 ${mono}`, color: TX, letterSpacing: "-.01em" }}>
                  {short(sel.address)}
                </span>
                <CopyButton value={sel.address} copied={copied === sel.address} onCopy={onCopy} size={20} />
                <StatusPill status={sel.status} />
              </>
            ) : (
              <span style={{ font: `600 14px/1 ${mono}`, color: TX3 }}>No validator selected</span>
            )}
          </div>
          {blockscout && (
            <a
              href={blockscout}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                font: `500 11.5px/1 ${sans}`,
                alignSelf: "flex-start",
              }}
            >
              View details
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4h9v9M16 4L5 15" />
              </svg>
            </a>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            borderRadius: 8,
            background: "var(--panel2)",
            border: "1px solid var(--line)",
            flex: "none",
          }}
        >
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWindow(w)}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                font: `600 11px/1 ${mono}`,
                background: win === w ? BRAND : "transparent",
                color: win === w ? "#fff" : TX2,
              }}
            >
              {fmt(w)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 18px 0", display: "flex", flexDirection: "column", gap: 11, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Label>Signing history · {fmt(win)} blocks</Label>
          <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>newest top-left</span>
        </div>

        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(50,1fr)", gap: 3 }}>
            {new Array(200).fill(0).map((_, i) => (
              <span
                key={i}
                style={{
                  aspectRatio: "1",
                  borderRadius: 2,
                  background: "linear-gradient(90deg,var(--skel) 25%,var(--line) 50%,var(--skel) 75%)",
                  backgroundSize: "400% 100%",
                  animation: "shim 1.6s linear infinite",
                }}
              />
            ))}
          </div>
        )}

        {empty && (
          <EmptyState
            dashed
            title={dberr ? "No data available" : "Awaiting RPC"}
            text={
              dberr
                ? "Signing history cannot be read while the database is unreachable."
                : "Signing slots appear once blocks are ingested from the RPC endpoint."
            }
          />
        )}

        {!loading && !empty && (
          <>
            <div
              onMouseOver={(e) => {
                const el = e.target as HTMLElement;
                const i = el.getAttribute?.("data-i");
                if (i == null) return;
                setTip({ i: +i, x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop - 6 });
              }}
              onMouseLeave={() => setTip(null)}
              style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(50,1fr)", gap: 3 }}
            >
              {cells.map((c, i) => (
                <span key={i} data-i={i} style={{ aspectRatio: "1", borderRadius: 2, background: c.bg }} />
              ))}
              {tip && tipCell && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 5,
                    pointerEvents: "none",
                    left: tip.x,
                    top: tip.y,
                    transform: "translate(-50%,-100%)",
                    padding: "7px 9px",
                    borderRadius: 8,
                    background: "var(--panel2)",
                    border: "1px solid var(--line2)",
                    boxShadow: "var(--shadow)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ font: `600 10.5px/1 ${mono}`, color: TX }}>
                    height {fmt(tipCell.slot.height)}
                  </span>
                  <span
                    style={{
                      font: `600 10px/1 ${sans}`,
                      color: tipCell.slot.signed === null ? TX3 : tipCell.slot.signed ? OK : BAD,
                    }}
                  >
                    {tipCell.slot.signed === null
                      ? "Not in validator set"
                      : tipCell.slot.signed
                        ? "Signed"
                        : "Missed"}
                  </span>
                  <span style={{ font: `400 10px/1 ${sans}`, color: TX3 }}>
                    {agoFrom(tipCell.slot.time)} ago
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16, paddingTop: 2 }}>
              <Legend color={OK} label="Signed" />
              <Legend color={BAD} label="Missed" />
              <Legend color="var(--line2)" label="Not in set" />
              <span style={{ marginLeft: "auto", font: `400 10.5px/1 ${mono}`, color: TX3 }}>
                {missed || na
                  ? `${missed} missed · ${na} not in set`
                  : `${slots.length} / ${slots.length} signed`}
              </span>
            </div>
          </>
        )}

        <div
          style={{
            marginTop: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 1,
            background: "var(--line)",
            borderTop: "1px solid var(--line)",
            marginLeft: -18,
            marginRight: -18,
          }}
        >
          <Summary label="Uptime (1,000)" value={pct(sel?.uptime_1000 ?? null, 2)} color={metricColor(sel?.uptime_1000 ?? null)} />
          <Summary
            label={`Uptime (${fmt(longTarget)})`}
            value={partial ? `${fmt(sel?.slots_10000 ?? 0)} / ${fmt(longTarget)}` : pct(sel?.uptime_10000 ?? null, 2)}
            color={partial ? WARN : metricColor(sel?.uptime_10000 ?? null)}
            badge={partial || backfill ? "PARTIAL WINDOW" : undefined}
          />
          <Summary
            label="Missed Streak"
            value={sel ? String(sel.missed_streak) : "—"}
            color={sel && sel.missed_streak >= 3 ? BAD : sel && sel.missed_streak > 0 ? WARN : TX}
          />
          <Summary label="Proposer Share" value={pct(sel?.proposer_share_1000 ?? null)} color={TX} />
        </div>
      </div>
    </section>
  );
}

function metricColor(v: number | null): string {
  if (v === null) return TX3;
  return v >= 99.9 ? OK : v >= 99 ? TX : WARN;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 10.5px/1 ${sans}`, color: TX2 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

function Summary({
  label,
  value,
  color,
  badge,
}: {
  label: string;
  value: string;
  color: string;
  badge?: string;
}) {
  return (
    <div style={{ background: "var(--panel)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <Label size={9}>{label}</Label>
      <span style={{ font: `600 17px/1 ${mono}`, color }}>{value}</span>
      {badge && (
        <span
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 5,
            background: "var(--warnSoft)",
            font: `600 9px/1.3 ${sans}`,
            color: WARN,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

/* ── analytics row ──────────────────────────────────────────────────────── */

function NetworkHealth({ d, dash }: { d: Dashboard; dash: boolean }) {
  const net = d.net;
  const rate = net?.signing_rate_100 ?? null;
  const bt = net?.avg_block_time_ms !== null && net?.avg_block_time_ms !== undefined ? net.avg_block_time_ms / 1000 : null;
  const blocks24 = net?.blocks_indexed_24h ?? 0;
  // Without a measured block time there is no honest daily expectation, so the
  // meter reports the count and says the target is unknown rather than
  // inventing one.
  const expected = bt ? Math.round(86_400 / bt) : null;
  const behind = expected !== null && blocks24 < expected * 0.9;

  const verdict = verdictFor(d);

  const meters = dash
    ? [
        { label: "Signing Rate", value: "—", w: "0%", bg: "var(--line)", c: TX3, scale: "target ≥ 99.5%" },
        { label: "Avg Block Time", value: "—", w: "0%", bg: "var(--line)", c: TX3, scale: "target 2–6s" },
        { label: "Blocks Indexed 24h", value: "—", w: "0%", bg: "var(--line)", c: TX3, scale: "expected — · needs block time" },
      ]
    : [
        {
          label: "Signing Rate",
          value: pct(rate),
          w: rate === null ? "0%" : clampPct(rate, 95, 100),
          bg: rate !== null && rate < 99.5 ? WARN : OK,
          c: rate !== null && rate < 99.5 ? WARN : OK,
          scale: "target ≥ 99.5% · scale 95–100%",
        },
        {
          label: "Avg Block Time",
          value: secs(bt),
          w: bt === null ? "0%" : clampPct(bt, 0, 9),
          bg: bt !== null && bt > 6 ? WARN : OK,
          c: bt !== null && bt > 6 ? WARN : OK,
          scale: "target 2–6s · scale 0–9s",
        },
        {
          label: "Blocks Indexed 24h",
          value: fmt(blocks24),
          w: expected === null ? "0%" : clampPct(blocks24, 0, expected),
          bg: expected === null ? "var(--line)" : behind ? WARN : OK,
          c: expected === null ? TX3 : behind ? WARN : OK,
          scale: expected === null ? "expected — · needs block time" : `expected ~${fmt(expected)}`,
        },
      ];

  return (
    <section style={{ ...panel, padding: "15px 16px 16px", display: "flex", flexDirection: "column", gap: 13 }}>
      <h3 style={{ margin: 0, font: `600 12.5px/1 ${sans}`, color: TX }}>Network Health</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: verdict.color }} />
        <span style={{ font: `600 13px/1.3 ${sans}`, color: verdict.color }}>{verdict.text}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {meters.map((m) => (
          <Meter key={m.label} label={m.label} value={m.value} width={m.w} color={m.bg} scale={m.scale} />
        ))}
      </div>
    </section>
  );
}

export function verdictFor(d: Dashboard): { text: string; color: string } {
  if (d.state === "dberror") return { text: "Unknown — no data", color: BAD };
  if (d.state === "stopped") return { text: "Stale — indexer stopped", color: WARN };
  if (d.state === "empty") return { text: "Bootstrapping", color: TX3 };
  if (d.state === "loading") return { text: "Loading", color: TX3 };
  const bad = d.validators.filter((v) => v.status === "degraded").length;
  if (bad > 0)
    return {
      text: `Degraded signing on ${bad} validator${bad === 1 ? "" : "s"}`,
      color: WARN,
    };
  return { text: "Healthy", color: OK };
}

function MiniChart({
  title,
  now,
  series,
  min,
  max,
  stroke,
  fillColor,
  topLabel,
  bottomLabel,
  dash,
}: {
  title: string;
  now: string;
  series: number[];
  min: number;
  max: number;
  stroke: string;
  fillColor: string;
  topLabel: string;
  bottomLabel: string;
  dash: boolean;
}) {
  return (
    <section style={{ ...panel, padding: "15px 16px 12px", display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0, font: `600 12.5px/1 ${sans}`, color: TX }}>{title}</h3>
        <span style={{ font: `400 10px/1 ${sans}`, color: TX3 }}>last 60 min</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ font: `600 20px/1 ${mono}`, color: dash ? TX3 : TX }}>{dash ? "—" : now}</span>
        <span style={{ font: `500 10.5px/1 ${sans}`, color: TX3 }}>current</span>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 96 }}>
        <LineChart
          viewW={254}
          viewH={96}
          points={dash ? "" : pts(series, 254, 96, min, max)}
          areaPath={dash ? "" : area(series, 254, 96, min, max)}
          stroke={stroke}
          fill={fillColor}
        />
        <span style={{ position: "absolute", left: 0, top: -6, font: `400 8.5px/1 ${mono}`, color: TX3 }}>
          {topLabel}
        </span>
        <span style={{ position: "absolute", left: 0, bottom: -6, font: `400 8.5px/1 ${mono}`, color: TX3 }}>
          {bottomLabel}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", font: `400 9.5px/1 ${mono}`, color: TX3 }}>
        <span>−60m</span>
        <span>now</span>
      </div>
    </section>
  );
}

function SetChanges({ d }: { d: Dashboard }) {
  const events = (d.set?.changes ?? []).slice(0, 5);
  return (
    <section style={{ ...panel, padding: "15px 16px 14px", display: "flex", flexDirection: "column", gap: 11 }}>
      <h3 style={{ margin: 0, font: `600 12.5px/1 ${sans}`, color: TX }}>Recent Validator Set Changes</h3>
      {d.bootstrap && (
        <span style={{ font: `400 11px/1.45 ${sans}`, color: TX3, paddingBottom: 2 }}>
          Genesis membership only. No churn recorded since bootstrap.
        </span>
      )}
      {events.length === 0 && !d.bootstrap && (
        <span style={{ font: `400 11px/1.45 ${sans}`, color: TX3 }}>
          No validator-set changes recorded yet.
        </span>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {events.map((e, i) => {
          const added = e.type === "added";
          return (
            <div key={`${e.height}-${e.address}-${i}`} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 19,
                  height: 19,
                  borderRadius: 6,
                  flex: "none",
                  font: `600 12px/1 ${mono}`,
                  background: added ? "var(--okSoft)" : "var(--badSoft)",
                  color: added ? OK : BAD,
                }}
              >
                {added ? "+" : "−"}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    font: `500 11px/1 ${mono}`,
                    color: TX2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {short(e.address)}
                </span>
                <span style={{ font: `400 10px/1 ${mono}`, color: TX3 }}>height {fmt(e.height)}</span>
              </div>
              <span style={{ font: `400 10px/1 ${sans}`, color: TX3, flex: "none" }}>
                {agoFrom(e.time)} ago
              </span>
            </div>
          );
        })}
      </div>
      {!d.bootstrap && (
        <span
          style={{
            marginTop: "auto",
            paddingTop: 6,
            font: `400 10px/1.4 ${sans}`,
            color: TX3,
            borderTop: "1px solid var(--line)",
          }}
        >
          Membership is fixed by governance off-chain; changes are rare.
        </span>
      )}
    </section>
  );
}
