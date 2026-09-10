/** Formatting, identicon and SVG-geometry helpers ported from the mockup. */

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function secs(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}s`;
}

/** Consensus addresses are long hex; the mockup shows head-6 … tail-4. */
export function short(a: string | null | undefined): string {
  if (!a) return "—";
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function agoText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} d`;
}

export function agoFrom(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return agoText((now - t) / 1000);
}

/** Flag emoji for a 2-letter country code ("MT" → 🇲🇹); "" when unknown. */
export function flag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const base = 0x1f1e6 - 65; // 'A' → regional indicator A
  const cc = code.toUpperCase();
  return String.fromCodePoint(base + cc.charCodeAt(0), base + cc.charCodeAt(1));
}

/** FNV-1a — deterministic identicon seed from an address. */
export function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

export type Identicon = { hue: number; cells: string[]; chip: string };

/**
 * A 4×4 horizontally-mirrored bit grid keyed off the address hash — the same
 * construction the mockup uses, so a given address renders identically.
 */
export function identicon(address: string): Identicon {
  const h = hash(address);
  const hue = h % 340;
  const bits: number[] = [];
  for (let row = 0; row < 4; row++) {
    const a = (h >> (row * 4)) & 1;
    const b = (h >> (row * 4 + 2)) & 1;
    bits.push(a, b, b, a);
  }
  return {
    hue,
    cells: bits.map((b) => (b ? `hsl(${hue} 68% 58%)` : "transparent")),
    chip: `hsl(${hue} 60% 50% / .16)`,
  };
}

/**
 * Gaps in a bucketed series are carried forward rather than drawn as zero — a
 * minute with no blocks means "no sample", not "block time collapsed".
 */
export function fill(values: (number | null)[]): number[] {
  const out: number[] = [];
  let last: number | null = null;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) last = v;
    if (last !== null) out.push(last);
  }
  return out;
}

/** Polyline points for a series clamped into [min,max] over a w×h viewBox. */
export function pts(arr: number[], w: number, h: number, min: number, max: number): string {
  const n = arr.length;
  if (n === 0) return "";
  if (n === 1) {
    const y = h - ((clamp(arr[0], min, max) - min) / (max - min)) * h;
    return `0,${y.toFixed(1)} ${w},${y.toFixed(1)}`;
  }
  return arr
    .map((v, i) => {
      const x = ((i / (n - 1)) * w).toFixed(1);
      const y = (h - ((clamp(v, min, max) - min) / (max - min)) * h).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
}

/** Closed path under the same polyline, for the soft area fill. */
export function area(arr: number[], w: number, h: number, min: number, max: number): string {
  const p = pts(arr, w, h, min, max);
  if (!p) return "";
  return `M0,${h} L${p.split(" ").join(" L")} L${w},${h} Z`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function clampPct(v: number, min: number, max: number): string {
  const t = ((v - min) / (max - min)) * 100;
  return `${Math.max(2, Math.min(100, t)).toFixed(0)}%`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard blocked (insecure origin) — the copy affordance just no-ops */
  }
}

/** CSV escaping for the validators export. */
export function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c === null || c === undefined ? "" : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
