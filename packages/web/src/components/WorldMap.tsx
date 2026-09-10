/**
 * World map of observed validator node locations.
 *
 * Equirectangular projection (lon/lat → x/y linearly), which needs no
 * projection library. Landmasses are fetched once per session from a public
 * GeoJSON mirror; if that fetch fails the map degrades to a graticule so the
 * dots still render with honest, if sparser, context.
 *
 * Dot semantics match the table's honesty rules: only validators with
 * observed coordinates are drawn, colored by monitoring status. A validator
 * never observed is absent from the map and counted as unobserved in the
 * header — never placed at a guessed position.
 */
import { useEffect, useState } from "react";
import type { Validator } from "../api";
import { BAD, OK, TX3, WARN, mono, sans } from "./ui";

const W = 720;
const H = 360;
const GEOJSON_URL = "https://cdn.jsdelivr.net/gh/holtzy/D3-graph-gallery@master/DATA/world.geojson";

/** Fetched once per session; a failed fetch is permanent for the session. */
let landPaths: string[] | null = null;

type Ring = number[][];
type GeoFeature = {
  geometry: { type: string; coordinates: unknown };
};

/** Project one lon/lat ring to an SVG path segment. */
function ringToPath(ring: Ring): string {
  const d = ring
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    .map(([lon, lat]) => {
      const x = ((lon + 180) / 360) * W;
      const y = ((90 - lat) / 180) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  return d.length < 3 ? "" : `M${d.join("L")}Z`;
}

function featureToPaths(f: GeoFeature): string[] {
  const g = f.geometry;
  if (g.type === "Polygon") return (g.coordinates as Ring[]).map(ringToPath).filter(Boolean);
  if (g.type === "MultiPolygon")
    return (g.coordinates as Ring[][]).flatMap((poly) => poly.map(ringToPath)).filter(Boolean);
  return [];
}

export function statusColorOf(status: Validator["status"]): string {
  return status === "active" ? OK : status === "degraded" ? WARN : BAD;
}

export function WorldMap({ validators }: { validators: Validator[] }) {
  const [paths, setPaths] = useState<string[] | null>(landPaths);

  useEffect(() => {
    if (landPaths !== null) return;
    let cancelled = false;
    fetch(GEOJSON_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((geo: { features?: GeoFeature[] }) => {
        const p = (geo.features ?? []).flatMap(featureToPaths);
        if (!cancelled && p.length > 0) {
          landPaths = p;
          setPaths(p);
        }
      })
      .catch(() => {
        /* keep the graticule fallback; dots still render */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const placed = validators.filter((v) => v.location?.lat !== null && v.location?.lon !== null);
  const countries = new Set(placed.map((v) => v.location?.country).filter(Boolean)).size;
  const cities = new Set(placed.map((v) => v.location?.city).filter(Boolean)).size;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          padding: "10px 16px 0",
          flexWrap: "wrap",
        }}
      >
        <span style={{ font: `500 12px/1 ${sans}`, color: TX3 }}>validator network</span>
        <span style={{ font: `400 11px/1 ${mono}`, color: TX3 }}>
          {validators.length} validators · {countries} countries · {cities} cities
          {validators.length - placed.length > 0
            ? ` · ${validators.length - placed.length} unobserved`
            : ""}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, font: `400 10px/1 ${sans}`, color: TX3 }}>
          <span><Dot c={OK} /> active</span>
          <span><Dot c={WARN} /> degraded</span>
          <span><Dot c={BAD} /> inactive</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="validator node locations world map">
        <rect width={W} height={H} fill="var(--panel2)" rx={6} />
        {/* graticule: always drawn, the landmasses sit on top when available */}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`h${i}`} x1={0} x2={W} y1={(i * H) / 12 + H / 24} y2={(i * H) / 12 + H / 24} stroke="var(--line)" strokeWidth={0.4} />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} y1={0} y2={H} x1={(i * W) / 12 + W / 24} x2={(i * W) / 12 + W / 24} stroke="var(--line)" strokeWidth={0.4} />
        ))}
        {(paths ?? []).map((d, i) => (
          <path key={i} d={d} fill="var(--panel)" stroke="var(--line)" strokeWidth={0.5} />
        ))}
        {/* dots after land so they sit on top; later same-city dots offset by hash jitter */}
        {placed.map((v) => {
          const l = v.location!;
          const x = ((l.lon! + 180) / 360) * W;
          const y = ((90 - l.lat!) / 180) * H;
          // Same-city validators would overlap exactly; jitter deterministically.
          const j = jitter(v.address);
          return (
            <circle
              key={v.address}
              cx={x + j.dx}
              cy={y + j.dy}
              r={4}
              fill={statusColorOf(v.status)}
              fillOpacity={0.85}
              stroke="var(--panel2)"
              strokeWidth={1}
            >
              <title>
                {`${v.moniker ?? shortAddr(v.address)}\n` +
                  `${[l.city, l.country].filter(Boolean).join(", ")}\n` +
                  `${l.isp ?? ""}\nlast seen ${l.last_seen ?? "—"} (${l.source === "direct" ? "direct probe" : "P2P"})`}
              </title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: c, marginRight: 5 }} />;
}

function shortAddr(a: string) {
  return `${a.slice(0, 8)}…`;
}

/** Deterministic ±3px offset so co-located validators stay individually visible. */
function jitter(address: string): { dx: number; dy: number } {
  let x = 2166136261;
  for (let i = 0; i < address.length; i++) {
    x ^= address.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  const h = x >>> 0;
  return { dx: ((h % 7) - 3) * 1.5, dy: (((h >>> 8) % 7) - 3) * 1.5 };
}
