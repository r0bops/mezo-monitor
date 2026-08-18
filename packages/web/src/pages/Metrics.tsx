/** Metrics: consensus charts over a selectable horizon (24h / 7d / 30d). */
import { useMemo } from "react";
import type { Dashboard } from "../useDashboard";
import { BRAND, Label, LineChart, OK, TX, TX2, TX3, WARN, mono, panel, sans } from "../components/ui";
import { area, fill, fmt, pct, pts, secs, short } from "../lib";

const RANGES: { hours: number; label: string; axis: [string, string | undefined, string] }[] = [
  { hours: 24, label: "24h", axis: ["−24h", "−12h", "now"] },
  { hours: 168, label: "7d", axis: ["−7d", undefined, "now"] },
  { hours: 720, label: "30d", axis: ["−30d", undefined, "now"] },
];

export function Metrics({
  d,
  hours,
  onHours,
}: {
  d: Dashboard;
  hours: number;
  onHours: (h: number) => void;
}) {
  const m = d.metrics;
  const range = RANGES.find((r) => r.hours === hours) ?? RANGES[0];
  // The server may still be answering the previous horizon; label what we got.
  const shown = RANGES.find((r) => r.hours === (m?.hours ?? hours)) ?? RANGES[0];

  const bt = useMemo(() => fill((m?.series ?? []).map((p) => p.block_time_s)), [m]);
  const sr = useMemo(() => fill((m?.series ?? []).map((p) => p.signing_rate)), [m]);

  const stats = [
    { label: `Avg block time · ${shown.label}`, value: secs(m?.stats.avg_block_time_s ?? null), c: OK },
    { label: `p95 block time · ${shown.label}`, value: secs(m?.stats.p95_block_time_s ?? null), c: TX },
    { label: `Blocks indexed · ${shown.label}`, value: fmt(m?.stats.blocks ?? null), c: TX },
    {
      label: `Signing rate · ${shown.label}`,
      value: pct(m?.stats.signing_rate ?? null, 2),
      // An unmeasured rate is unknown, not healthy — don't tint it green.
      c:
        m?.stats.signing_rate === null || m?.stats.signing_rate === undefined
          ? TX3
          : m.stats.signing_rate < 99.5
            ? WARN
            : OK,
    },
  ];

  const volume = m?.volume.points ?? [];
  const maxVol = Math.max(1, ...volume.map((h) => h.n));
  const unitLabel = m?.volume.unit === "day" ? "day" : "hour";
  // Derived from the measured block time; null when there isn't one yet.
  const expectedPerBucket = m?.stats.avg_block_time_s
    ? Math.round(
        (3600 / m.stats.avg_block_time_s) * (m?.volume.unit === "day" ? 24 : 1),
      )
    : null;

  /**
   * A calendar bucket at either edge of the window is structurally partial
   * (the oldest starts mid-bucket at the window edge; the newest is still in
   * progress) — comparing it against a FULL bucket's expected count would dim
   * it as if indexing underperformed when it did not. Completeness is judged
   * by timestamp, never by array position: during a real outage the last
   * bucket is a complete one and dimming it is a true positive.
   */
  const unitMs = m?.volume.unit === "day" ? 86_400_000 : 3_600_000;
  const windowStart = Date.now() - (m?.hours ?? hours) * 3_600_000;
  const isCompleteBucket = (t: string): boolean => {
    const ms = new Date(t).getTime();
    return ms >= windowStart && ms + unitMs <= Date.now();
  };

  const dist = m?.proposer_distribution ?? [];
  const maxShare = Math.max(0.01, ...dist.map((p) => p.share ?? 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <span style={{ font: `400 11px/1 ${sans}`, color: TX3 }}>
          a 24h window empties after any long outage — wider horizons keep history visible
        </span>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              onClick={() => onHours(r.hours)}
              style={{
                padding: "6px 11px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                font: `600 11.5px/1 ${sans}`,
                background: hours === r.hours ? "var(--brandSoft)" : "transparent",
                color: hours === r.hours ? "var(--brand)" : TX2,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ ...panel, padding: "15px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <Label>{s.label}</Label>
            <span style={{ font: `600 24px/1 ${mono}`, color: s.c }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <ChartCard
          title="Block time"
          note={`last ${shown.label} · y-axis 2–6s`}
          labels={["6s", "4s", "2s"]}
          series={bt}
          min={2}
          max={6}
          stroke={OK}
          fillColor="var(--okSoft)"
          axis={shown.axis}
        />
        <ChartCard
          title="Signing rate"
          note={`last ${shown.label} · y-axis 90–100%`}
          labels={["100%", "", "90%"]}
          series={sr}
          min={90}
          max={100}
          stroke={BRAND}
          fillColor="var(--brandSoft)"
          axis={shown.axis}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <section style={{ ...panel, padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>
              Blocks indexed per {unitLabel}
            </h3>
            <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3 }}>
              {expectedPerBucket === null
                ? `expected — · needs block time`
                : `expected ~${fmt(expectedPerBucket)}/${unitLabel}`}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110 }}>
            {volume.length === 0 && <EmptyBars />}
            {volume.map((h) => {
              const pctH = (h.n / maxVol) * 100;
              // Only complete buckets are judged against the expected count.
              const complete = isCompleteBucket(h.t);
              return (
                <span
                  key={h.t}
                  title={`${fmt(h.n)} blocks${complete ? "" : " · partial bucket"}`}
                  style={{
                    flex: 1,
                    borderRadius: "3px 3px 0 0",
                    height: `${Math.max(2, pctH).toFixed(0)}%`,
                    background:
                      expectedPerBucket === null || !complete
                        ? "color-mix(in srgb, var(--ok) 55%, transparent)"
                        : h.n >= expectedPerBucket * 0.9
                          ? OK
                          : "color-mix(in srgb, var(--ok) 55%, transparent)",
                    display: "block",
                  }}
                />
              );
            })}
          </div>
          <Axis left={shown.axis[0]} mid={shown.axis[1]} right={shown.axis[2]} />
        </section>

        <section style={{ ...panel, padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Proposer distribution</h3>
            <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3 }}>
              last 1,000 blocks · even = healthy
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110 }}>
            {dist.length === 0 && <EmptyBars />}
            {dist.map((p) => (
              <span
                key={p.address}
                title={`${short(p.address)} · ${pct(p.share, 2)}`}
                style={{
                  flex: 1,
                  borderRadius: "3px 3px 0 0",
                  height: `${Math.max(2, ((p.share ?? 0) / maxShare) * 100).toFixed(0)}%`,
                  background: p.status === "degraded" ? WARN : BRAND,
                  display: "block",
                }}
              />
            ))}
          </div>
          <Axis left="rank 1" right={`rank ${dist.length || "—"}`} />
        </section>
      </div>

      {range.hours !== shown.hours && (
        <span style={{ font: `400 11px/1 ${sans}`, color: TX3 }}>
          showing {shown.label} — {range.label} is loading
        </span>
      )}
    </div>
  );
}

function EmptyBars() {
  return (
    <span style={{ flex: 1, alignSelf: "center", textAlign: "center", font: `400 12px/1 ${sans}`, color: TX3 }}>
      No data in this window yet.
    </span>
  );
}

function Axis({ left, mid, right }: { left: string; mid?: string; right: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", font: `400 9.5px/1 ${mono}`, color: TX3 }}>
      <span>{left}</span>
      {mid && <span>{mid}</span>}
      <span>{right}</span>
    </div>
  );
}

function ChartCard({
  title,
  note,
  labels,
  series,
  min,
  max,
  stroke,
  fillColor,
  axis,
}: {
  title: string;
  note: string;
  labels: [string, string, string];
  series: number[];
  min: number;
  max: number;
  stroke: string;
  fillColor: string;
  axis: [string, string | undefined, string];
}) {
  return (
    <section style={{ ...panel, padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>{title}</h3>
        <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3 }}>{note}</span>
      </div>
      <div style={{ position: "relative", height: 150 }}>
        <LineChart
          viewW={520}
          viewH={150}
          points={pts(series, 520, 150, min, max)}
          areaPath={area(series, 520, 150, min, max)}
          stroke={stroke}
          fill={fillColor}
        />
        <span style={{ position: "absolute", left: 0, top: -7, font: `400 9px/1 ${mono}`, color: TX3 }}>
          {labels[0]}
        </span>
        {labels[1] && (
          <span style={{ position: "absolute", left: 0, top: 69, font: `400 9px/1 ${mono}`, color: TX3 }}>
            {labels[1]}
          </span>
        )}
        <span style={{ position: "absolute", left: 0, bottom: -7, font: `400 9px/1 ${mono}`, color: TX3 }}>
          {labels[2]}
        </span>
      </div>
      <Axis left={axis[0]} mid={axis[1]} right={axis[2]} />
    </section>
  );
}
