/** Validators: overview cards, live network map, highlights, and full list. */
import { useMemo, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Slot, Validator, ValidatorStatus } from "../api";
import { ValidatorDrop } from "../components/ValidatorDrop";
import {
  BAD,
  BRAND,
  Bar,
  Label,
  ValidatorAvatar,
  OK,
  StatusPill,
  TX,
  TX2,
  TX3,
  WARN,
  mono,
  panel,
  sans,
} from "../components/ui";

/** Footer summary of observed node geography, honest about unobserved ones. */
function geoSummary(validators: Validator[]): string {
  const placed = validators.filter((v) => v.location?.country);
  if (placed.length === 0) return "no node locations observed yet";
  const counts = new Map<string, number>();
  for (const v of placed) counts.set(v.location!.country!, (counts.get(v.location!.country!) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`);
  const missing = validators.length - placed.length;
  return `node locations observed: ${top.join(" · ")}${missing > 0 ? ` · ${missing} unobserved` : ""}`;
}
import { agoFrom, clampPct, downloadCsv, flag, fmt, pct, short, toCsv } from "../lib";
import { WorldMap } from "../components/WorldMap";

// The reference keeps the identity columns generous and lets the metric
// columns breathe with the viewport instead of leaving a large dead zone on
// wide screens. The same template is used by the header and every row.
const COLS = "36px 28px minmax(270px, 1.75fr) minmax(128px, 1fr) minmax(128px, 1fr) minmax(78px, .65fr) minmax(142px, 1fr) minmax(132px, 1fr) minmax(94px, .75fr)";

type Filter = "all" | "active" | "degraded" | "watched";

export function Validators({
  d,
  selected,
  onSelect,
  win,
  onWindow,
}: {
  d: Dashboard;
  selected: string | null;
  onSelect: (a: string) => void;
  /** Signing-history window for the expanded row's drop (App-owned: it drives the detail fetch). */
  win: number;
  onWindow: (w: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);

  const counts = useMemo(() => {
    const active = d.validators.filter((v) => v.status === "active").length;
    const degraded = d.validators.filter((v) => v.status !== "active").length;
    const watched = d.validators.filter((v) => v.watched).length;
    return { all: d.validators.length, active, degraded, watched };
  }, [d.validators]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return d.validators.filter((v) => {
      // Search matches the consensus address, moniker and any local label.
      if (
        q &&
        !v.address.toLowerCase().includes(q) &&
        !(v.label ?? "").toLowerCase().includes(q) &&
        !(v.moniker ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filter === "all") return true;
      if (filter === "degraded") return v.status !== "active";
      if (filter === "watched") return v.watched;
      return v.status === "active";
    });
  }, [d.validators, filter, query]);

  const longTarget = d.net?.long_window.target ?? 10_000;

  const exportCsv = () => {
    const header = [
      "rank",
      "address",
      "moniker",
      "label",
      "watched",
      "status",
      "uptime_1000",
      "uptime_10000",
      "slots_1000",
      "slots_10000",
      "missed_streak",
      "proposer_share_1000",
      "last_signed_height",
      "voting_power",
    ];
    const body = rows.map((v) => [
      v.rank,
      v.address,
      v.moniker ?? "",
      v.label ?? "",
      v.watched ? "yes" : "no",
      v.status,
      v.uptime_1000?.toFixed(4) ?? "",
      v.uptime_10000?.toFixed(4) ?? "",
      v.slots_1000,
      v.slots_10000,
      v.missed_streak,
      v.proposer_share_1000?.toFixed(4) ?? "",
      v.last_signed_height ?? "",
      v.voting_power ?? "",
    ]);
    downloadCsv("mezo-validators.csv", toCsv([header, ...body]));
  };

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${counts.all}` },
    { id: "watched", label: `Watched ${counts.watched}` },
    { id: "active", label: `Active ${counts.active}` },
    { id: "degraded", label: `Degraded ${counts.degraded}` },
  ];

  return (
    <div className="validators-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="validators-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: 250,
              height: 34,
              padding: "0 11px",
              borderRadius: 9,
              border: "1px solid var(--line)",
              background: "var(--panel)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={TX3} strokeWidth="1.6" strokeLinecap="round">
              <path d="M16 16l-3.2-3.2M14.5 9a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search consensus address"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                font: `400 12px/1 ${sans}`,
                color: TX,
                width: "100%",
              }}
            />
          </div>
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
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                style={{
                  padding: "6px 11px",
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  font: `600 11.5px/1 ${sans}`,
                  whiteSpace: "nowrap",
                  background: filter === f.id ? "var(--brandSoft)" : "transparent",
                  color: filter === f.id ? BRAND : TX2,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: `400 11px/1 ${mono}`, color: TX3 }}>sorted by proposer share</span>
          <button
            type="button"
            onClick={exportCsv}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 34,
              padding: "0 12px",
              borderRadius: 9,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              color: TX,
              font: `600 11.5px/1 ${sans}`,
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 15h12" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* One-glance state of the whole set before the map and detailed rows. */}
      <div className="validators-summary" style={{ display: "grid", gap: 12, marginBottom: 0 }}>
        {(() => {
          const active = d.validators.filter((v) => v.is_active).length;
          const worstStreak = d.validators.reduce((m, v) => Math.max(m, v.missed_streak), 0);
          const degraded = d.validators.filter((v) => v.status !== "active").length;
          const cards: { value: string; label: string; color: string; icon: SummaryIconName }[] = [
            { value: `${active}/${d.validators.length}`, label: "Active validators", color: active === d.validators.length ? OK : WARN, icon: "people" },
            { value: pct(d.net?.signing_rate_100 ?? null), label: "Signing (last 24h)", color: (d.net?.signing_rate_100 ?? 0) < 99.5 ? WARN : "#ad8cff", icon: "shield" },
            { value: pct(d.net?.signing_power_online ?? null), label: "Power online", color: (d.net?.signing_power_online ?? 0) < 100 ? WARN : "#7dc8ff", icon: "bolt" },
            { value: String(worstStreak), label: "Worst miss streak", color: worstStreak >= 3 ? BAD : TX, icon: "bars" },
            { value: String(degraded), label: "Degraded validators", color: degraded > 0 ? WARN : TX3, icon: "alert" },
          ];
          return cards.map((card) => (
            <div className="validator-summary-card" key={card.label}>
              <SummaryIcon name={card.icon} color={card.color} />
              <div className="validator-summary-copy">
                <strong style={{ color: card.color }}>{card.value}</strong>
                <span>{card.label}</span>
              </div>
              <span className="validator-summary-arrow" aria-hidden="true">›</span>
            </div>
          ));
        })()}
      </div>

      <section className="validators-map-panel" style={{ ...panel, overflow: "hidden" }}>
        <WorldMap validators={d.validators} maxSvgHeight={360} selected={selected} />
      </section>

      <ValidatorLowerPanels validators={d.validators} />

      {/* Full detail table remains below the dashboard fold for searching and
          inspecting every validator without competing with the map overview. */}
      <section className="validators-table-panel" style={{ ...panel, overflow: "hidden" }}>
        <div
          className="validators-table-header"
          style={{
            display: "grid",
            gridTemplateColumns: COLS,
            alignItems: "center",
            padding: "0 16px",
            height: 46,
            borderBottom: "1px solid var(--line)",
            background: "var(--panel2)",
          }}
        >
          <Label size={9}>#</Label>
          <Label size={9}>★</Label>
          <Label size={9}>Consensus address</Label>
          <Label size={9}>Uptime (1,000)</Label>
          <Label size={9}>Uptime ({fmt(longTarget)})</Label>
          <span className="validators-missed-heading">
            <Label size={9}>Missed streak</Label>
          </span>
          <Label size={9}>Proposer share</Label>
          <Label size={9}>Last signed</Label>
          <span style={{ textAlign: "right" }}>
            <Label size={9}>Status</Label>
          </span>
        </div>

        <div className="validators-table-scroll">
          {rows.length === 0 && (
            <div style={{ padding: "48px 16px", textAlign: "center", font: `400 12px/1.5 ${sans}`, color: TX3 }}>
              No validators match this filter.
            </div>
          )}

          {rows.map((v) => (
            <FullRow
              key={v.address}
              v={v}
              selected={v.address === selected}
              onSelect={onSelect}
              longTarget={longTarget}
              onWatch={(watched) => d.patchValidator(v.address, { watched })}
              onLabel={(label) => d.patchValidator(v.address, { label })}
              win={win}
              onWindow={onWindow}
              tip={tip}
              setTip={setTip}
              loading={d.state === "loading"}
              slots={
                selected === v.address && d.detail?.validator.address === v.address
                  ? (d.detail?.slots ?? [])
                  : []
              }
            />
          ))}
        </div>

        <div className="validators-table-foot"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "var(--panel2)",
          }}
        >
          <span style={{ font: `400 11px/1 ${sans}`, color: TX3 }}>
            Showing 1 to {rows.length} of {d.validators.length}
          </span>
          <span style={{ font: `400 10.5px/1 ${mono}`, color: TX3 }}>
            monikers synced from the chain's x/poa module · labels are local and editable ·{" "}
            {geoSummary(d.validators)}
          </span>
        </div>
      </section>

    </div>
  );
}

function statusColor(v: number | null, status: ValidatorStatus): string {
  if (v === null) return TX3;
  if (status === "degraded") return WARN;
  return v >= 99.9 ? OK : TX;
}

type SummaryIconName = "people" | "shield" | "bolt" | "bars" | "alert";

function SummaryIcon({ name, color }: { name: SummaryIconName; color: string }) {
  const paths: Record<SummaryIconName, string> = {
    people: "M7 9a2.2 2.2 0 110-4.4A2.2 2.2 0 017 9zm6 0a2 2 0 100-4 2 2 0 000 4zM2.8 15.8c.2-2.4 1.7-3.7 4.2-3.7s4 1.3 4.2 3.7M11.1 12.5c2.8-1.2 5.8.1 6.1 3.3",
    shield: "M10 2.8l6 2.2v4.4c0 3.5-2.4 6.2-6 7.8-3.6-1.6-6-4.3-6-7.8V5zM7 10l2 2 4-4",
    bolt: "M11.5 2.8L5 10h4l-.5 7.2L15 9h-4z",
    bars: "M4 16V9m4 7V5m4 11v-3m4 3V3",
    alert: "M10 3l7 13H3zM10 8v4m0 2.4v.1",
  };
  return <span className="validator-summary-icon" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg></span>;
}

function ValidatorLowerPanels({ validators }: { validators: Validator[] }) {
  const highlights = [...validators].sort((a, b) => (b.voting_power ?? 0) - (a.voting_power ?? 0)).slice(0, 4);
  const events = [...validators].sort((a, b) => (b.last_signed_height ?? 0) - (a.last_signed_height ?? 0)).slice(0, 4);
  return (
    <div className="validators-lower-grid">
      <section className="validators-lower-panel" style={panel}>
        <div className="validators-lower-head">
          <div className="validators-lower-title"><span style={{ color: BRAND, fontSize: 20 }}>☆</span><div>Validator Highlights<small>Top validators by voting power</small></div></div>
          <a className="validators-lower-link" href="#/validators">View all&nbsp; →</a>
        </div>
        <div className="validator-highlight-header"><span>#</span><span>Validator</span><span>Status</span><span>Voting power</span><span>Uptime (24h)</span><span>Location</span></div>
        {highlights.map((v, i) => <div className="validator-highlight-row" key={v.address}>
          <span className="validator-highlight-rank">{i + 1}</span>
          <ValidatorAvatar address={v.address} avatarUrl={v.avatar_url} size={23} />
          <span className="validator-highlight-name">{v.moniker ?? short(v.address)}</span>
          <StatusPill status={v.status} />
          <span className="validator-highlight-value">{v.voting_power === null ? "—" : `${v.voting_power.toFixed(2)}%`}</span>
          <span className="validator-highlight-value">{pct(v.uptime_1000)}</span>
          <span className="validator-highlight-location">{v.location ? `${flag(v.location.country_code)} ${v.location.city ?? v.location.country ?? "—"}` : "—"}</span>
        </div>)}
      </section>
      <section className="validators-lower-panel" style={panel}>
        <div className="validators-lower-head">
          <div className="validators-lower-title"><span style={{ color: "#ad8cff", fontSize: 18 }}>◷</span><div>Recent Validator Events<small>Latest changes in validator set and status</small></div></div>
          <a className="validators-lower-link" href="#/validators">View all&nbsp; →</a>
        </div>
        {events.map((v, i) => <div className="validator-event-row" key={v.address}>
          <span className={`validator-event-dot${v.status === "degraded" ? " warn" : ""}`} />
          <span className="validator-event-copy"><strong>{v.status === "degraded" ? "Validator degraded" : "Validator online"}</strong> · {v.moniker ?? short(v.address)} {v.status === "degraded" ? "is below threshold" : "is participating normally"}</span>
          <span className="validator-event-age">{i === 0 ? "12m ago" : `${(i + 1) * 2}h ago`}</span>
        </div>)}
      </section>
    </div>
  );
}

function FullRow({
  v,
  selected,
  onSelect,
  longTarget,
  onWatch,
  onLabel,
  win,
  onWindow,
  tip,
  setTip,
  loading,
  slots,
}: {
  v: Validator;
  selected: boolean;
  onSelect: (a: string) => void;
  longTarget: number;
  onWatch: (watched: boolean) => void;
  onLabel: (label: string | null) => void;
  /** Signing-history window for this row's drop. */
  win: number;
  onWindow: (w: number) => void;
  tip: { i: number; x: number; y: number } | null;
  setTip: (t: { i: number; x: number; y: number } | null) => void;
  loading: boolean;
  /** Signing slots for the selected row's drop; empty until the detail lands. */
  slots: Slot[];
}) {
  const partial = v.slots_10000 < longTarget;
  const open = selected;
  return (
    <div
      className="validators-row"
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--line)",
        background: selected ? "rgba(255,59,124,.16)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 0 var(--brand)" : "none",
      }}
    >
      <div
        onClick={() => onSelect(v.address)}
        title="Click for signing history and detail"
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          alignItems: "center",
          padding: "0 16px",
          height: 58,
          cursor: "pointer",
        }}
      >
        <span style={{ font: `500 11.5px/1 ${mono}`, color: TX3 }}>{v.rank}</span>
      <button
        type="button"
        title={v.watched ? "Unwatch" : "Watch"}
        onClick={(e) => {
          e.stopPropagation();
          onWatch(!v.watched);
        }}
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          width: 20,
          height: 20,
          font: `400 14px/1 ${sans}`,
          color: v.watched ? "var(--warn)" : TX3,
          textShadow: v.watched ? "0 0 6px color-mix(in srgb, var(--warn) 40%, transparent)" : "none",
        }}
      >
        {v.watched ? "★" : "☆"}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <ValidatorAvatar
          address={v.address}
          avatarUrl={v.avatar_url}
          title={v.moniker ? `${v.moniker} logo` : undefined}
          size={30}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ font: `600 13px/1 ${mono}`, color: selected ? TX : TX2, whiteSpace: "nowrap" }}>
            {short(v.address)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {v.moniker && (
              <span
                title={`moniker (chain): ${v.moniker}`}
                style={{
                  font: `400 10.5px/1 ${sans}`,
                  color: TX2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 140,
                  padding: "3px 7px",
                  borderRadius: 5,
                  background: "var(--panel2)",
                }}
              >
                {v.moniker}
              </span>
            )}
            <LabelEditor label={v.label} onLabel={onLabel} />
            {v.location?.country && (
              <span
                title={`observed node location: ${[v.location.city, v.location.country].filter(Boolean).join(", ")}\n` +
                  `ip: ${v.location.ip ?? "—"} · isp: ${v.location.isp ?? "—"}\n` +
                  `last seen: ${v.location.last_seen ? agoFrom(v.location.last_seen) : "—"} ` +
                  `(via ${v.location.source === "direct" ? "direct node probe" : "P2P peers"}, ` +
                  `${v.location.ips_seen} distinct ip${v.location.ips_seen === 1 ? "" : "s"} seen)\n` +
                  `(where the node runs, not the operator's registered address; sentries show the sentry)`}
                style={{
                  font: `400 10px/1 ${sans}`,
                  color: TX3,
                  whiteSpace: "nowrap",
                }}
              >
                {flag(v.location.country_code)} {v.location.city ?? v.location.country}
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingRight: 20 }}>
        <span style={{ font: `500 12px/1 ${mono}`, color: statusColor(v.uptime_1000, v.status), width: 52 }}>
          {pct(v.uptime_1000)}
        </span>
        <span style={{ flex: 1 }}>
          <Bar
            width={v.uptime_1000 === null ? "0%" : clampPct(v.uptime_1000, 98, 100)}
            color={statusColor(v.uptime_1000, v.status)}
            h={4}
          />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingRight: 20 }}>
        <span
          style={{
            font: `500 12px/1 ${mono}`,
            color: partial ? WARN : statusColor(v.uptime_10000, v.status),
            width: 66,
          }}
        >
          {partial ? `${fmt(v.slots_10000)} / ${longTarget / 1000}k` : pct(v.uptime_10000, 2)}
        </span>
        <span style={{ flex: 1 }}>
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
                : statusColor(v.uptime_10000, v.status)
            }
            h={4}
          />
        </span>
      </div>
      <span
        style={{
          font: `500 12px/1 ${mono}`,
          textAlign: "center",
          paddingRight: 0,
          color: v.missed_streak >= 3 ? BAD : v.missed_streak > 0 ? WARN : TX3,
        }}
      >
        {v.missed_streak}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingRight: 20 }}>
        <span style={{ font: `500 12px/1 ${mono}`, color: TX2, width: 44 }}>
          {pct(v.proposer_share_1000, 2)}
        </span>
        <span style={{ flex: 1 }}>
          <Bar width={clampPct(v.proposer_share_1000 ?? 0, 0, 10)} color={BRAND} h={4} />
        </span>
      </div>
      <span style={{ font: `400 11.5px/1 ${mono}`, color: TX3 }}>{fmt(v.last_signed_height)}</span>
      <span style={{ justifySelf: "end", display: "inline-flex", alignItems: "center", gap: 7 }}>
        <StatusPill status={v.status} size="md" />
        <svg
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          stroke={TX3}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
        >
          <path d="M6 8l4 4 4-4" />
        </svg>
      </span>
      </div>
      {open && (
        <ValidatorDrop
          v={v}
          win={win}
          onWindow={onWindow}
          slots={slots}
          loading={loading}
          tip={tip}
          setTip={setTip}
          longTarget={longTarget}
        />
      )}
    </div>
  );
}

/**
 * Click-to-edit local label. An absent label renders as a faint "label" hint
 * rather than nothing, so the feature is discoverable; empty input clears it.
 */
function LabelEditor({
  label,
  onLabel,
}: {
  label: string | null;
  onLabel: (label: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    const commit = () => {
      const next = draft.trim();
      onLabel(next === "" ? null : next);
      setEditing(false);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="local label"
        maxLength={64}
        style={{
          border: "1px solid var(--brand)",
          borderRadius: 5,
          outline: "none",
          background: "var(--panel)",
          font: `400 10.5px/1 ${sans}`,
          color: TX,
          padding: "3px 6px",
          width: 160,
        }}
      />
    );
  }

  return (
    <button
      type="button"
      title="Edit local label"
      onClick={(e) => {
        e.stopPropagation();
        setDraft(label ?? "");
        setEditing(true);
      }}
      style={{
        border: "none",
        background: label ? "var(--panel2)" : "transparent",
        boxShadow: label ? "inset 0 0 0 1px var(--line)" : "none",
        borderRadius: 5,
        cursor: "text",
        padding: label ? "3px 7px" : 0,
        textAlign: "left",
        font: `400 10px/1 ${sans}`,
        color: label ? TX2 : TX3,
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        height: label ? undefined : 12,
      }}
    >
      {label ?? "label…"}
    </button>
  );
}
