/**
 * The per-validator drop-down body shared by the Overview table and the
 * Validators page: identity facts, the signing-history heatmap with its
 * window toggle, and the trailing stat tiles.
 */
import type { Slot, Validator } from "../api";
import { EmptyState, Label, OK, BAD, TX, TX2, TX3, mono, sans } from "./ui";
import { agoFrom, fmt, pct } from "../lib";

export const WINDOWS = [100, 500, 1000];

export function metricColor(v: number | null): string {
  if (v === null) return TX3;
  return v >= 99.9 ? OK : v >= 99 ? TX : TX2;
}

export function ValidatorDrop({
  v,
  win,
  onWindow,
  slots,
  loading,
  tip,
  setTip,
  longTarget,
}: {
  v: Validator;
  /** Heatmap window in blocks (100 | 500 | 1000). */
  win: number;
  onWindow: (w: number) => void;
  slots: Slot[];
  loading: boolean;
  tip: { i: number; x: number; y: number } | null;
  setTip: (t: { i: number; x: number; y: number } | null) => void;
  /** Long uptime window target, for the second stat tile's label. */
  longTarget: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 11,
        padding: "4px 16px 14px 46px",
        background: "var(--panel2)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
        <Detail label="First seen" value={fmt(v.first_seen_height)} />
        <Detail label="Last seen" value={fmt(v.last_seen_height)} />
        <Detail label="Voting power" value={fmt(v.voting_power)} />
        <Detail label="Pub key" value={v.pub_key ?? "—"} truncate />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Label>Signing history · {fmt(win)} blocks</Label>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            borderRadius: 8,
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWindow(w)}
              style={{
                padding: "4px 9px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                font: `600 10.5px/1 ${mono}`,
                background: win === w ? "var(--brand)" : "transparent",
                color: win === w ? "#fff" : TX2,
              }}
            >
              {fmt(w)}
            </button>
          ))}
        </div>
      </div>
      <SigningHistoryGrid slots={slots} loading={loading} tip={tip} setTip={setTip} />
      <div style={{ display: "flex", gap: 1, background: "var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <Summary label="Uptime (1,000)" value={pct(v.uptime_1000, 2)} color={metricColor(v.uptime_1000)} />
        <Summary label={`Uptime (${fmt(longTarget)})`} value={pct(v.uptime_10000, 2)} color={metricColor(v.uptime_10000)} />
        <Summary
          label="Missed Streak"
          value={String(v.missed_streak)}
          color={v.missed_streak >= 3 ? BAD : v.missed_streak > 0 ? "var(--warn)" : TX}
        />
        <Summary label="Proposer Share" value={pct(v.proposer_share_1000)} color={TX} />
      </div>
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

/**
 * The per-validator signing-slot heatmap. Green = signed (fading with age),
 * red = missed, gray = not in the set; hover shows height + verdict.
 */
function SigningHistoryGrid({
  slots,
  loading,
  tip,
  setTip,
}: {
  slots: Slot[];
  loading: boolean;
  tip: { i: number; x: number; y: number } | null;
  setTip: (t: { i: number; x: number; y: number } | null) => void;
}) {
  const empty = slots.length === 0 && !loading;
  // Rows fade with age so the newest activity reads first.
  const rows = Math.max(1, Math.ceil(slots.length / 50));
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
  const tipCell = tip ? cells[tip.i] : null;

  if (empty) {
    return (
      <EmptyState
        dashed
        title="Awaiting selection"
        text="Signing slots load when this row is selected and blocks are ingested."
      />
    );
  }

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
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
      {!loading && (
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
    </div>
  );
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
            color: "var(--warn)",
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
