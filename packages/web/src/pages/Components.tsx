/**
 * Component gallery — every state each primitive can be in, side by side.
 * Rendered from static props on purpose: this page documents the states, so it
 * must show all of them regardless of what the chain is currently doing.
 */
import {
  BAD,
  BRAND,
  Bar,
  Identicon,
  Label,
  OK,
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

const SAMPLE_ADDRESSES = [
  "4A287C1B9E5D3F0A2C8B6E4D1F7A9C3B5D8E6844",
  "56EA89B0C1D2E3F4A5B6C7D8E9F0A1B2C3D424EF",
  "A34F9C2E7B1D5A8F0C3E6B9D2F5A8C1E4B7021DB",
  "7B12E0A4C6E8B0D2F4A6C8E0B2D4F6A8C0E29F03",
];

const TILES = [
  { name: "Default", value: "11,058,306", vc: TX, sub: "+167 in last 10 min", sc: TX2, border: "var(--line)", skel: false },
  { name: "Loading", value: "", vc: TX, sub: "", sc: TX3, border: "var(--line)", skel: true },
  { name: "Empty / bootstrapping", value: "—", vc: TX3, sub: "no blocks indexed", sc: TX3, border: "var(--line)", skel: false },
  { name: "Warning · stale", value: "1,284", vc: WARN, sub: "behind chain head", sc: WARN, border: "var(--warn)", skel: false },
  { name: "Error · db unreachable", value: "—", vc: TX3, sub: "unavailable", sc: BAD, border: "var(--bad)", skel: false },
  { name: "Partial window", value: "3,412 / 10k", vc: WARN, sub: "backfill 34%", sc: WARN, border: "var(--line)", skel: false },
];

const ROWS = [
  {
    name: "Default",
    bg: "transparent",
    mark: "none",
    fg: TX2,
    up1: "99.8%",
    up1w: "90%",
    up1c: TX,
    up10: "99.68%",
    up10w: "84%",
    up10c: TX,
    up10bg: TX2,
    streak: "0",
    streakC: TX3,
    share: "4.5%",
    sharew: "45%",
    status: "active",
  },
  {
    name: "Selected",
    bg: "var(--brandSoft)",
    mark: "inset 2px 0 0 0 var(--brand)",
    fg: TX,
    up1: "100.0%",
    up1w: "100%",
    up1c: OK,
    up10: "99.90%",
    up10w: "95%",
    up10c: OK,
    up10bg: OK,
    streak: "0",
    streakC: TX3,
    share: "4.9%",
    sharew: "49%",
    status: "active",
  },
  {
    name: "Degraded",
    bg: "transparent",
    mark: "inset 2px 0 0 0 var(--warn)",
    fg: TX2,
    up1: "99.2%",
    up1w: "60%",
    up1c: WARN,
    up10: "98.94%",
    up10w: "47%",
    up10c: WARN,
    up10bg: WARN,
    streak: "4",
    streakC: BAD,
    share: "4.8%",
    sharew: "48%",
    status: "degraded",
  },
  {
    name: "Backfill · partial 10k window",
    bg: "transparent",
    mark: "none",
    fg: TX2,
    up1: "99.9%",
    up1w: "95%",
    up1c: TX,
    up10: "3,412 / 10k",
    up10w: "34%",
    up10c: WARN,
    up10bg: "repeating-linear-gradient(115deg,var(--warn) 0 3px,transparent 3px 6px)",
    streak: "0",
    streakC: TX3,
    share: "5.1%",
    sharew: "51%",
    status: "active",
  },
];

const COLS = "28px 132px 80px 80px 48px 80px 64px 24px";

export function Components() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <Group title="Stat tile" note="all states">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {TILES.map((t) => (
            <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <GalleryLabel>{t.name}</GalleryLabel>
              <div
                style={{
                  ...panel,
                  border: `1px solid ${t.border}`,
                  padding: "15px 16px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  minHeight: 104,
                }}
              >
                <Label>Latest Indexed Height</Label>
                {t.skel ? (
                  <>
                    <Skeleton h={26} w="78%" r={6} />
                    <Skeleton h={11} w="52%" />
                  </>
                ) : (
                  <>
                    <span style={{ font: `600 25px/1 ${mono}`, letterSpacing: "-.02em", color: t.vc }}>
                      {t.value}
                    </span>
                    <span style={{ font: `500 11px/1.3 ${sans}`, color: t.sc }}>{t.sub}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Table row" note="default · selected · degraded · partial window">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 606 }}>
          {ROWS.map((r, i) => (
            <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <GalleryLabel>{r.name}</GalleryLabel>
              <div style={{ ...panel, borderRadius: 10, overflow: "hidden", boxShadow: "none" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: COLS,
                    alignItems: "center",
                    padding: "0 16px",
                    height: 44,
                    background: r.bg,
                    boxShadow: r.mark,
                  }}
                >
                  <span style={{ font: `500 11px/1 ${mono}`, color: TX3 }}>{i + 1}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <Identicon address={SAMPLE_ADDRESSES[i]} size={16} />
                    <span style={{ font: `500 11.5px/1 ${mono}`, color: r.fg, whiteSpace: "nowrap" }}>
                      {`${SAMPLE_ADDRESSES[i].slice(0, 6)}…${SAMPLE_ADDRESSES[i].slice(-4)}`}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 12 }}>
                    <span style={{ font: `500 11.5px/1 ${mono}`, color: r.up1c }}>{r.up1}</span>
                    <Bar width={r.up1w} color={r.up1c} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 12 }}>
                    <span style={{ font: `500 11.5px/1 ${mono}`, color: r.up10c }}>{r.up10}</span>
                    <Bar width={r.up10w} color={r.up10bg} />
                  </div>
                  <span style={{ font: `500 11.5px/1 ${mono}`, color: r.streakC, textAlign: "right" }}>
                    {r.streak}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 12px" }}>
                    <span style={{ font: `500 11.5px/1 ${mono}`, color: TX2 }}>{r.share}</span>
                    <Bar width={r.sharew} color={BRAND} />
                  </div>
                  <span style={{ justifySelf: "end" }}>
                    <StatusPill status={r.status} />
                  </span>
                  <span style={{ justifySelf: "end", color: TX3 }}>
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 8l4 4 4-4" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Signing heatmap" note="healthy · degraded · 200-block excerpt, newest top-left">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 1000 }}>
          <Heat
            title="Healthy — 200 / 200 signed"
            titleColor={OK}
            cells={new Array(200).fill(0).map((_, i) => fade(i))}
          />
          <Heat
            title="Degraded — 6 missed · 12 not in set"
            titleColor={WARN}
            cells={new Array(200).fill(0).map((_, i) =>
              [7, 41, 42, 88, 129, 163].includes(i) ? BAD : i >= 188 ? "var(--line2)" : fade(i),
            )}
          />
        </div>
      </Group>
    </div>
  );
}

function fade(i: number): string {
  return `color-mix(in srgb, var(--ok) ${100 - Math.floor(i / 25) * 8}%, transparent)`;
}

function Heat({ title, titleColor, cells }: { title: string; titleColor: string; cells: string[] }) {
  return (
    <div style={{ ...panel, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ font: `600 11px/1 ${sans}`, color: titleColor }}>{title}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(25,1fr)", gap: 3 }}>
        {cells.map((bg, i) => (
          <span key={i} style={{ aspectRatio: "1", borderRadius: 2, background: bg }} />
        ))}
      </div>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0, font: `600 14px/1 ${sans}`, color: TX }}>{title}</h2>
        <span style={{ font: `400 11px/1 ${sans}`, color: TX3, whiteSpace: "nowrap" }}>{note}</span>
      </div>
      {children}
    </div>
  );
}

function GalleryLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        font: `600 9.5px/1 ${mono}`,
        letterSpacing: ".05em",
        color: TX3,
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}
