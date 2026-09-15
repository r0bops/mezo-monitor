/** Overview: stat tiles, validator table, signing heatmap and analytics row. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Validator } from "../api";
import { WorldMap } from "../components/WorldMap";
import { Pipeline } from "../components/Pipeline";
import {
  BAD,
  BRAND,
  Bar,
  CopyButton,
  EmptyState,
  Label,
  Meter,
  TimeSeriesChart,
  OK,
  Section,
  ValidatorAvatar,
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


export function Overview({
  d,
  live,
  selected,
  onSelect,
  copied,
  onCopy,
}: {
  d: Dashboard;
  live: boolean;
  selected: string | null;
  onSelect: (a: string) => void;
  copied: string | null;
  onCopy: (v: string) => void;
}) {
  /**
   * The map panel's height drives the validator table's: the table scrolls
   * internally and both panels end level. The map's height is its own (svg
   * aspect ratio), so measuring it here avoids a circular stretch where the
   * taller table would instead drag the map panel down with dead space.
   */
  const mapRef = useRef<HTMLElement | null>(null);
  const [mapH, setMapH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    // Measure once before paint (the map panel is align-self: flex-start, so
    // its height is purely content-driven and never stretched by the table —
    // otherwise the measurement would feed on the table's own uncapped height).
    setMapH(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setMapH(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Fold cap: on short viewports the analytics row (.g4) must fit below the
   * tiles and the validators/map row without scrolling. The map svg is the
   * only flexible piece, so it shrinks by exactly the measured overhang —
   * no estimated budgets, which drifted from the real header heights. The
   * formula is viewport-invariant (shrinking the svg by N moves .g4 up by N),
   * so a couple of rAF passes settle it; a map floor of 200px keeps it usable,
   * below that the page simply scrolls as it always did.
   */
  const g4Ref = useRef<HTMLDivElement | null>(null);
  const [svgCap, setSvgCap] = useState<number | undefined>(undefined);
  useEffect(() => {
    let raf = 0;
    let runs = 0;
    const step = () => {
      const svg = mapRef.current?.querySelector("svg");
      const g4 = g4Ref.current;
      if (svg && g4) {
        const rect = svg.getBoundingClientRect();
        const currentH = rect.height;
        const natural = rect.width / 2;
        const overhang = g4.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
        // Symmetric: shrinking by the overhang fits exactly; a negative
        // overhang grows the map back toward its natural size (released at
        // natural). 140px floor — below that the page scrolls instead.
        const target = currentH - overhang;
        if (target >= natural - 1) {
          if (svgCap !== undefined) setSvgCap(undefined);
        } else if (target >= 140) {
          setSvgCap(Math.floor(target));
        }
      }
      if (++runs < 4) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const onResize = () => {
      runs = 0;
      raf = requestAnimationFrame(step);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [d.state, d.validators.length, svgCap]);

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
        <div className="g5 tiles-sticky">
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
        <div className="g5 tiles-sticky">
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

      <Pipeline live={live} />

      <div className="row">
        <ValidatorTable
          d={d}
          selected={selected}
          onSelect={onSelect}
          copied={copied}
          onCopy={onCopy}
          backfill={backfill}
          height={mapH}
        />
        <section
          ref={mapRef}
          className="map-panel"
          style={{ ...panel, overflow: "hidden", display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
        >
          <WorldMap validators={d.validators} maxSvgHeight={svgCap} />
        </section>
      </div>

      <div className="g4" ref={g4Ref} style={{ alignItems: "stretch" }}>
        <NetworkHealth d={d} dash={dash} />
        <MiniChart
          title="Block Time"
          now={secs(btSeries.length ? btSeries[btSeries.length - 1] : null)}
          series={btSeries}
          times={d.series?.points ?? []}
          min={2}
          max={6}
          stroke={BRAND}
          fillColor="var(--brandSoft)"
          topLabel="6s"
          bottomLabel="2s"
          dash={dash}
          formatValue={(v) => `${v.toFixed(2)}s`}
        />
        <MiniChart
          title="Signing Rate"
          now={pct(srSeries.length ? srSeries[srSeries.length - 1] : null)}
          series={srSeries}
          times={d.series?.points ?? []}
          min={0}
          max={100}
          stroke={BRAND}
          fillColor="var(--brandSoft)"
          topLabel="100%"
          bottomLabel="0%"
          dash={dash}
          formatValue={(v) => `${v.toFixed(1)}%`}
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
      <MetricHeading icon="block" label="Latest Indexed Height" />
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
      <MetricHeading icon="clock" label="Avg Block Time" />
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
      <MetricHeading icon="signing" label="Signing Rate" />
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
        {/* Power-weighted view of the same window: what fraction of the set's
            voting power actually committed (namada reference). */}
        <span
          title="share of the set's voting power that committed over the last 100 blocks"
          style={{ font: `500 10px/1 ${sans}`, color: TX3 }}
        >
          power online{" "}
          <strong style={{ color: net?.signing_power_online !== null && (net?.signing_power_online ?? 0) < 100 ? WARN : OK }}>
            {dash || !net || net.signing_power_online === null ? "—" : pct(net.signing_power_online)}
          </strong>
        </span>
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
      <MetricHeading icon="validators" label="Active Validators" />
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
      <MetricHeading icon="lag" label="Indexer Lag" />
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

type MetricIcon = "block" | "clock" | "signing" | "validators" | "lag" | "health" | "changes";

function MetricHeading({ icon, label }: { icon: MetricIcon; label: string }) {
  return (
    <div className="metric-heading">
      <MetricGlyph icon={icon} />
      <Label>{label}</Label>
    </div>
  );
}

function MetricGlyph({ icon }: { icon: MetricIcon }) {
  const paths: Record<MetricIcon, string> = {
    block: "M10 2.7 16.2 6v8L10 17.3 3.8 14V6L10 2.7ZM3.8 6 10 9.4 16.2 6M10 9.4v7.9",
    clock: "M10 3.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6ZM10 6.2v4l2.7 1.7",
    signing: "m4 15 1.2-3.8L13.8 2.6a1.7 1.7 0 0 1 2.4 2.4L7.6 13.7 4 15Zm2.2-2.2 2.2 2.2M11.5 15.8H17",
    validators: "M10 9a2.7 2.7 0 1 0 0-5.4A2.7 2.7 0 0 0 10 9Zm-5.3 7.2c.2-3 2-4.7 5.3-4.7s5.1 1.7 5.3 4.7M4.2 9a2.2 2.2 0 0 1 2-3.4M15.8 9a2.2 2.2 0 0 0-2-3.4",
    lag: "M4 6.2 10 3l6 3.2-6 3.3-6-3.3ZM4 10.1l6 3.2 6-3.2M4 14l6 3 6-3",
    health: "M10 16.8S3.2 13 3.2 8.5A3.4 3.4 0 0 1 10 7.1a3.4 3.4 0 0 1 6.8 1.4c0 4.5-6.8 8.3-6.8 8.3Z",
    changes: "M6.3 8.6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM13.8 9.2a2.2 2.2 0 1 0 0-4.4M2.8 16.5c.2-3 1.3-4.5 3.5-4.5s3.3 1.5 3.5 4.5M11.2 12.2c2.8-.9 4.7.5 5.2 3.8",
  };
  return <span className={`metric-glyph metric-glyph-${icon}`} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]} /></svg></span>;
}

/* ── validator table ────────────────────────────────────────────────────── */

// Address column fits avatar + moniker + short address + copy button.
const COLS = "28px 216px 80px 80px 48px 80px 64px 24px";

function ValidatorTable({
  d,
  selected,
  onSelect,
  copied,
  onCopy,
  backfill,
  height,
}: {
  d: Dashboard;
  selected: string | null;
  onSelect: (a: string) => void;
  copied: string | null;
  onCopy: (v: string) => void;
  backfill: boolean;
  /** Matched to the map panel so both columns end level (undefined while measuring). */
  height?: number;
}) {
  const loading = d.state === "loading";
  const empty = d.state === "empty" || d.state === "dberror";
  const dberr = d.state === "dberror";

  return (
    <Section
      style={{
        width: 652,
        flex: "none",
        maxWidth: "100%",
        overflowX: "auto",
        ...(height !== undefined ? { height } : {}),
      }}
      // Section wraps children in a body div; without this it is height:auto,
      // grows to the full list height and clips — the scroll chain below never
      // receives the section's fixed height.
      bodyStyle={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
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
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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

          {/* The list scrolls inside the panel so 21 rows never stretch the
              page; the footer stays pinned and the panel ends level with the
              map beside it (the .row flex stretches both to the same height). */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {d.validators.map((v) => (
            <Row
              key={v.address}
              v={v}
              selected={v.address === selected}
              onSelect={onSelect}
              copied={copied === v.address}
              onCopy={onCopy}
              backfill={backfill}
              longTarget={d.net?.long_window.target ?? 10_000}
            />
          ))}
          </div>

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
                : "consensus addresses · monikers synced from x/poa · labels are local"}
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
  copied,
  onCopy,
  backfill,
  longTarget,
}: {
  v: Validator;
  selected: boolean;
  onSelect: (a: string) => void;
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
          <ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} title={v.moniker ?? undefined} size={16} />
          {v.moniker && (
            <span
              title={`moniker (chain): ${v.moniker}`}
              style={{
                font: `500 11px/1 ${sans}`,
                color: selected ? TX : TX2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 118,
                flex: "none",
              }}
            >
              {v.moniker}
            </span>
          )}
          <span
            style={{ ...cell, fontSize: 10.5, color: TX3, letterSpacing: "-.01em", whiteSpace: "nowrap" }}
            title={v.address}
          >
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
        <span />
      </div>
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
      <MetricHeading icon="health" label="Network Health" />
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
  times,
  min,
  max,
  stroke,
  fillColor,
  topLabel,
  bottomLabel,
  dash,
  formatValue,
}: {
  title: string;
  now: string;
  series: number[];
  times: { t: string }[];
  min: number;
  max: number;
  stroke: string;
  fillColor: string;
  topLabel: string;
  bottomLabel: string;
  dash: boolean;
  formatValue: (v: number) => string;
}) {
  return (
    <section style={{ ...panel, padding: "15px 16px 12px", display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div className="analytics-heading">
          <MetricGlyph icon={title === "Block Time" ? "clock" : "signing"} />
          <h3 style={{ margin: 0, font: `600 12.5px/1 ${sans}`, color: TX }}>{title}</h3>
        </div>
        <span style={{ font: `400 10px/1 ${sans}`, color: TX3 }}>last 60 min</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ font: `600 20px/1 ${mono}`, color: dash ? TX3 : TX }}>{dash ? "—" : now}</span>
        <span style={{ font: `500 10.5px/1 ${sans}`, color: TX3 }}>current</span>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 144 }}>
        {!dash ? (
          <TimeSeriesChart
            values={series}
            times={times.map((p) => p.t)}
            min={min}
            max={max}
            stroke={stroke}
            fillColor={fillColor}
            height="fill"
            compact
            formatValue={formatValue}
            formatTime={(t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          />
        ) : (
          <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            {[2, 6, 10, 14, 18].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        <span style={{ position: "absolute", zIndex: 2, left: 0, top: 1, padding: "1px 3px", borderRadius: 3, background: "var(--panel)", font: `400 8.5px/1 ${mono}`, color: TX3 }}>
          {topLabel}
        </span>
        <span style={{ position: "absolute", zIndex: 2, left: 0, bottom: 1, padding: "1px 3px", borderRadius: 3, background: "var(--panel)", font: `400 8.5px/1 ${mono}`, color: TX3 }}>
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
      <div className="analytics-heading">
        <MetricGlyph icon="changes" />
        <h3 style={{ margin: 0, font: `600 12.5px/1 ${sans}`, color: TX }}>Recent Validator Set Changes</h3>
      </div>
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
