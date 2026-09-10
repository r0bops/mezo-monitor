/** Validators: full-width list with search, status filter and CSV export. */
import { useMemo, useState } from "react";
import type { Dashboard } from "../useDashboard";
import type { Validator, ValidatorStatus } from "../api";
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

const COLS = "36px 28px 300px 150px 150px 96px 160px 150px 96px";

type Filter = "all" | "active" | "degraded" | "watched";

export function Validators({
  d,
  selected,
  onSelect,
}: {
  d: Dashboard;
  selected: string | null;
  onSelect: (a: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

      <section style={{ ...panel, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COLS,
            alignItems: "center",
            padding: "0 16px",
            height: 38,
            borderBottom: "1px solid var(--line)",
            background: "var(--panel2)",
          }}
        >
          <Label size={9}>#</Label>
          <Label size={9}>★</Label>
          <Label size={9}>Consensus address</Label>
          <Label size={9}>Uptime (1,000)</Label>
          <Label size={9}>Uptime ({fmt(longTarget)})</Label>
          <span style={{ textAlign: "right", paddingRight: 24 }}>
            <Label size={9}>Missed streak</Label>
          </span>
          <Label size={9}>Proposer share</Label>
          <Label size={9}>Last signed</Label>
          <span style={{ textAlign: "right" }}>
            <Label size={9}>Status</Label>
          </span>
        </div>

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
          />
        ))}

        <div
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

function FullRow({
  v,
  selected,
  onSelect,
  longTarget,
  onWatch,
  onLabel,
}: {
  v: Validator;
  selected: boolean;
  onSelect: (a: string) => void;
  longTarget: number;
  onWatch: (watched: boolean) => void;
  onLabel: (label: string | null) => void;
}) {
  const partial = v.slots_10000 < longTarget;
  return (
    <div
      onClick={() => onSelect(v.address)}
      style={{
        display: "grid",
        gridTemplateColumns: COLS,
        alignItems: "center",
        padding: "0 16px",
        height: 48,
        borderBottom: "1px solid var(--line)",
        cursor: "pointer",
        background: selected ? "var(--brandSoft)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 0 var(--brand)" : "none",
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
          size={20}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ font: `500 12.5px/1 ${mono}`, color: selected ? TX : TX2, whiteSpace: "nowrap" }}>
            {short(v.address)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {v.moniker && (
              <span
                title={`moniker (chain): ${v.moniker}`}
                style={{
                  font: `400 10px/1 ${sans}`,
                  color: TX2,
                  padding: "3px 7px",
                  borderRadius: 5,
                  background: "var(--panel2)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 120,
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
                  `last seen peering: ${v.location.last_seen ? agoFrom(v.location.last_seen) : "—"}\n` +
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
          textAlign: "right",
          paddingRight: 24,
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
      <span style={{ justifySelf: "end" }}>
        <StatusPill status={v.status} size="md" />
      </span>
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
        background: "transparent",
        cursor: "text",
        padding: 0,
        textAlign: "left",
        font: `400 10.5px/1 ${sans}`,
        color: label ? TX2 : TX3,
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        height: 12,
      }}
    >
      {label ?? "label…"}
    </button>
  );
}
