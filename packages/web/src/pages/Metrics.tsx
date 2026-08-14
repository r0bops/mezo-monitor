/** Metrics: 24-hour consensus charts. */
import { useMemo } from "react";
import type { Dashboard } from "../useDashboard";
import { BRAND, Label, LineChart, OK, TX, TX3, WARN, mono, panel, sans } from "../components/ui";
import { area, fill, fmt, pct, pts, secs, short } from "../lib";

export function Metrics({ d }: { d: Dashboard }) {
  const m = d.metrics;

  const bt = useMemo(() => fill((m?.series ?? []).map((p) => p.block_time_s)), [m]);
  const sr = useMemo(() => fill((m?.series ?? []).map((p) => p.signing_rate)), [m]);

  const stats = [
    { label: "Avg block time · 24h", value: secs(m?.stats.avg_block_time_s ?? null), c: OK },
    { label: "p95 block time · 24h", value: secs(m?.stats.p95_block_time_s ?? null), c: TX },
    { label: "Blocks indexed · 24h", value: fmt(m?.stats.blocks_24h ?? null), c: TX },
    {
      label: "Signing rate · 24h",
      value: pct(m?.stats.signing_rate_24h ?? null, 2),
      // An unmeasured rate is unknown, not healthy — don't tint it green.
      c:
        m?.stats.signing_rate_24h === null || m?.stats.signing_rate_24h === undefined
          ? TX3
          : m.stats.signing_rate_24h < 99.5
            ? WARN
            : OK,
    },
  ];

  const hours = m?.blocks_per_hour ?? [];
  const maxHour = Math.max(1, ...hours.map((h) => h.n));
  // Derived from the measured block time; null when there isn't one yet.
  const expectedPerHour = m?.stats.avg_block_time_s
    ? Math.round(3600 / m.stats.avg_block_time_s)
    : null;

  const dist = m?.proposer_distribution ?? [];
  const maxShare = Math.max(0.01, ...dist.map((p) => p.share ?? 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          note="last 24 hours · y-axis 2–6s"
          labels={["6s", "4s", "2s"]}
          series={bt}
          min={2}
          max={6}
          stroke={OK}
          fillColor="var(--okSoft)"
        />
        <ChartCard
          title="Signing rate"
          note="last 24 hours · y-axis 90–100%"
          labels={["100%", "", "90%"]}
          series={sr}
          min={90}
          max={100}
          stroke={BRAND}
          fillColor="var(--brandSoft)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <section style={{ ...panel, padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>Blocks indexed per hour</h3>
            <span style={{ font: `400 10.5px/1 ${sans}`, color: TX3 }}>
              {expectedPerHour === null ? "expected — · needs block time" : `expected ~${fmt(expectedPerHour)}/h`}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110 }}>
            {hours.length === 0 && <EmptyBars />}
            {hours.map((h) => {
              const pctH = (h.n / maxHour) * 100;
              return (
                <span
                  key={h.t}
                  title={`${fmt(h.n)} blocks`}
                  style={{
                    flex: 1,
                    borderRadius: "3px 3px 0 0",
                    height: `${Math.max(2, pctH).toFixed(0)}%`,
                    background:
                      expectedPerHour === null
                        ? "color-mix(in srgb, var(--ok) 55%, transparent)"
                        : h.n >= expectedPerHour * 0.9
                          ? OK
                          : "color-mix(in srgb, var(--ok) 55%, transparent)",
                    display: "block",
                  }}
                />
              );
            })}
          </div>
          <Axis left="−24h" mid="−12h" right="now" />
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
}: {
  title: string;
  note: string;
  labels: [string, string, string];
  series: number[];
  min: number;
  max: number;
  stroke: string;
  fillColor: string;
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
      <Axis left="−24h" mid="−12h" right="now" />
    </section>
  );
}
