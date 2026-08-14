/**
 * Primitives shared across pages. Styling is inline and token-driven, matching
 * the mockup's structure so the rendered result is the same box model.
 */
import type { CSSProperties, ReactNode } from "react";
import { identicon } from "../lib";

export const OK = "var(--ok)";
export const WARN = "var(--warn)";
export const BAD = "var(--bad)";
export const TX = "var(--tx)";
export const TX2 = "var(--tx2)";
export const TX3 = "var(--tx3)";
export const BRAND = "var(--brand)";

export const panel: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  boxShadow: "var(--shadow)",
};

export const mono = "'JetBrains Mono',monospace";
export const sans = "Inter,sans-serif";

/** Uppercase micro-label used above every value in the design. */
export function Label({ children, size = 10 }: { children: ReactNode; size?: number }) {
  return (
    <span
      style={{
        font: `600 ${size}px/1 ${sans}`,
        letterSpacing: size <= 9 ? ".06em" : ".07em",
        color: TX3,
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

export function Skeleton({ h, w, r = 4 }: { h: number; w: string | number; r?: number }) {
  return (
    <span
      style={{
        display: "block",
        height: h,
        width: w,
        borderRadius: r,
        background:
          "linear-gradient(90deg,var(--skel) 25%,var(--line) 50%,var(--skel) 75%)",
        backgroundSize: "200% 100%",
        animation: "shim 1.4s linear infinite",
      }}
    />
  );
}

export function StatusPill({
  status,
  size = "sm",
}: {
  status: "active" | "degraded" | "inactive" | string;
  size?: "sm" | "md";
}) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active: { bg: "var(--okSoft)", fg: OK, label: "Active" },
    degraded: { bg: "var(--warnSoft)", fg: WARN, label: "Degraded" },
    inactive: { bg: "var(--badSoft)", fg: BAD, label: "Inactive" },
  };
  const s = map[status] ?? { bg: "var(--panel2)", fg: TX3, label: status };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: size === "md" ? "4px 8px" : "3px 7px",
        borderRadius: 20,
        font: `600 ${size === "md" ? 10 : 9.5}px/1 ${sans}`,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
      {s.label}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    critical: { bg: "var(--badSoft)", fg: BAD },
    warning: { bg: "var(--warnSoft)", fg: WARN },
    info: { bg: "var(--brandSoft)", fg: BRAND },
    resolved: { bg: "var(--okSoft)", fg: OK },
  };
  const s = map[severity.toLowerCase()] ?? { bg: "var(--panel2)", fg: TX3 };
  return (
    <span
      style={{
        padding: "3px 7px",
        borderRadius: 5,
        font: `600 9px/1 ${sans}`,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        background: s.bg,
        color: s.fg,
        height: "fit-content",
        flex: "none",
      }}
    >
      {severity}
    </span>
  );
}

export function Identicon({ address, size = 16 }: { address: string; size?: number }) {
  const ic = identicon(address);
  return (
    <span
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 1,
        width: size,
        height: size,
        padding: size >= 20 ? 2.5 : 2,
        borderRadius: size >= 20 ? 5 : 4,
        flex: "none",
        background: ic.chip,
      }}
    >
      {ic.cells.map((c, i) => (
        <span key={i} style={{ borderRadius: 0.5, background: c }} />
      ))}
    </span>
  );
}

/** Thin progress bar used for uptime and proposer share. */
export function Bar({ width, color, h = 3 }: { width: string; color: string; h?: number }) {
  return (
    <span
      style={{
        height: h,
        borderRadius: 2,
        background: "var(--line)",
        overflow: "hidden",
        display: "block",
      }}
    >
      <span
        style={{ display: "block", height: "100%", borderRadius: 2, width, background: color }}
      />
    </span>
  );
}

export function CopyButton({
  value,
  copied,
  onCopy,
  size = 18,
}: {
  value: string;
  copied: boolean;
  onCopy: (v: string) => void;
  size?: number;
}) {
  const d = copied
    ? "M4 10.5l4 4 8-9"
    : "M7 7V5.5A1.5 1.5 0 018.5 4h6A1.5 1.5 0 0116 5.5v6a1.5 1.5 0 01-1.5 1.5H13M4 8.5A1.5 1.5 0 015.5 7h6A1.5 1.5 0 0113 8.5v6a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 014 14.5z";
  return (
    <button
      type="button"
      title="Copy address"
      onClick={(e) => {
        e.stopPropagation();
        onCopy(value);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "none",
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        color: copied ? OK : TX3,
      }}
    >
      <svg
        width={size - 6}
        height={size - 6}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    </button>
  );
}

export function Section({
  title,
  aside,
  children,
  style,
  bodyStyle,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}) {
  return (
    <section style={{ ...panel, display: "flex", flexDirection: "column", overflow: "hidden", ...style }}>
      {title !== undefined && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 16px 12px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <h2 style={{ margin: 0, font: `600 13px/1 ${sans}`, color: TX }}>{title}</h2>
          {aside}
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  text,
  dashed,
}: {
  title: string;
  text: string;
  dashed?: boolean;
}) {
  return (
    <div
      style={{
        padding: dashed ? "48px 24px" : "64px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: dashed ? 8 : 10,
        textAlign: "center",
        border: dashed ? "1px dashed var(--line2)" : undefined,
        borderRadius: dashed ? 10 : undefined,
      }}
    >
      {!dashed && (
        <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke={TX3} strokeWidth="1.3" strokeLinecap="round">
          <path d="M3 6h14M3 10h14M3 14h14" />
        </svg>
      )}
      <span style={{ font: `600 ${dashed ? 12.5 : 13}px/1.3 ${sans}`, color: TX2 }}>{title}</span>
      <span
        style={{
          font: `400 ${dashed ? 11.5 : 12}px/1.5 ${sans}`,
          color: TX3,
          maxWidth: dashed ? 320 : 300,
        }}
      >
        {text}
      </span>
    </div>
  );
}

/** Line chart with dashed gridlines, matching the mockup's 5-line layout. */
export function LineChart({
  points,
  areaPath,
  stroke,
  fill,
  viewW,
  viewH,
  gridLines = 5,
  height,
}: {
  points: string;
  areaPath: string;
  stroke: string;
  fill: string;
  viewW: number;
  viewH: number;
  gridLines?: number;
  height?: number | string;
}) {
  const lines = Array.from({ length: gridLines }, (_, i) => (i / (gridLines - 1)) * viewH);
  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: height ?? "100%",
        overflow: "visible",
      }}
    >
      {lines.map((y, i) => (
        <line key={i} x1="0" y1={y} x2={viewW} y2={y} stroke="var(--grid)" strokeWidth="1" />
      ))}
      {areaPath && <path d={areaPath} fill={fill} />}
      {points && (
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

export function Meter({
  label,
  value,
  width,
  color,
  scale,
}: {
  label: string;
  value: string;
  width: string;
  color: string;
  scale: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: `500 11px/1 ${sans}`, color: TX2 }}>{label}</span>
        <span style={{ font: `500 11px/1 ${mono}`, color }}>{value}</span>
      </div>
      <Bar width={width} color={color} h={5} />
      <span style={{ font: `400 9.5px/1 ${mono}`, color: TX3 }}>{scale}</span>
    </div>
  );
}
