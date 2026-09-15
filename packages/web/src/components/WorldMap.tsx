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
import { agoFrom } from "../lib";
import { BAD, OK, StatusPill, TX, TX2, TX3, ValidatorAvatar, WARN, mono, sans } from "./ui";

const W = 720;
const H = 360;
/** Same-origin proxy (the public site's CSP allows no third-party connect-src). */
const GEOJSON_URL = "/api/v1/geo/land";

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

export function WorldMap({
  validators,
  maxSvgHeight,
  selected,
}: {
  validators: Validator[];
  /** Clamp the map so the whole Overview fold fits short viewports; the
   *  viewBox letterboxes inside the smaller box instead of clipping. */
  maxSvgHeight?: number;
  /** Consensus address of the validator selected in the table, if any —
   *  its marker is highlighted in the brand colour. */
  selected?: string | null;
}) {
  const [paths, setPaths] = useState<string[] | null>(landPaths);
  const [zoom, setZoom] = useState(1);
  /** Hovered validator + cursor position (px, relative to this container). */
  const [hover, setHover] = useState<{ v: Validator; x: number; y: number } | null>(null);
  const [litAddress, setLitAddress] = useState<string | null>(null);

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

  useEffect(() => {
    let timer: number | undefined;
    const onProduced = (event: Event) => {
      const address = (event as CustomEvent<{ address?: string }>).detail?.address;
      if (!address) return;
      setLitAddress(address);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setLitAddress(null), 2200);
    };
    window.addEventListener("mezo:block-produced", onProduced);
    return () => {
      window.removeEventListener("mezo:block-produced", onProduced);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const placed = validators.filter(
    (v): v is Validator & { location: NonNullable<Validator["location"]> } =>
      v.location !== null && v.location.lat !== null && v.location.lon !== null,
  );
  const countries = new Set(placed.map((v) => v.location?.country).filter(Boolean)).size;
  const cities = new Set(placed.map((v) => v.location?.city).filter(Boolean)).size;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          padding: "10px 16px 0",
          flexWrap: "wrap",
        }}
      >
        <span className="world-map-info" aria-hidden="true">i</span>
        <span style={{ font: `600 12px/1 ${sans}`, color: TX }}>Validator Network</span>
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
      <div className="world-map-canvas">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block", transform: `scale(${zoom})`, transformOrigin: "50% 50%", transition: "transform .2s ease", ...(maxSvgHeight !== undefined ? { maxHeight: maxSvgHeight } : {}) }}
        role="img"
        aria-label="validator node locations world map"
      >
        <defs>
          <linearGradient id="world-map-ocean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#122941" />
            <stop offset="0.52" stopColor="#0c2035" />
            <stop offset="1" stopColor="#081827" />
          </linearGradient>
          <radialGradient id="world-map-halo" cx="50%" cy="39%" r="65%">
            <stop offset="0" stopColor="#2f668e" stopOpacity=".2" />
            <stop offset=".58" stopColor="#173957" stopOpacity=".08" />
            <stop offset="1" stopColor="#071523" stopOpacity="0" />
          </radialGradient>
          <pattern id="world-map-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r=".7" fill="#9bb8d4" fillOpacity=".18" />
            <circle cx="14" cy="11" r=".45" fill="#6c91b1" fillOpacity=".14" />
          </pattern>
          <pattern id="world-map-land-texture" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M-5 18L2 11M3 22L22 3M14 24L24 14" fill="none" stroke="#8ca8c4" strokeOpacity=".16" strokeWidth=".55" />
            <circle cx="5" cy="5" r=".65" fill="#a9bfd5" fillOpacity=".2" />
            <circle cx="15" cy="14" r=".5" fill="#91abc4" fillOpacity=".16" />
          </pattern>
        </defs>
        {/* The letterbox-friendly backdrop: with preserveAspectRatio="meet"
            the panel can be wider/taller than the world box, so the ocean,
            halo and dot texture extend well past the viewBox and the bands
            around the world stay seamless. */}
        <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="url(#world-map-ocean)" />
        <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="url(#world-map-halo)" />
        <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="url(#world-map-dots)" opacity=".62" />
        {/* graticule: always drawn, the landmasses sit on top when available */}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`h${i}`} x1={-W} x2={W * 2} y1={(i * H) / 12 + H / 24} y2={(i * H) / 12 + H / 24} stroke="#2a4866" strokeOpacity=".5" strokeWidth={0.42} />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} y1={-H} y2={H * 2} x1={(i * W) / 12 + W / 24} x2={(i * W) / 12 + W / 24} stroke="#2a4866" strokeOpacity=".5" strokeWidth={0.42} />
        ))}
        {/* Land mixes the tertiary text token into the ocean colour, so it
            stays visible in BOTH themes — plain --panel is white-on-white in
            light mode. */}
        {(paths ?? []).map((d, i) => (
          <g key={i}>
            <path d={d} fill="color-mix(in srgb, #4b6381 62%, var(--panel2))" fillOpacity={0.9} stroke="#4b6683" strokeOpacity={0.62} strokeWidth={0.55} />
            <path d={d} fill="url(#world-map-land-texture)" fillOpacity={0.82} stroke="none" />
          </g>
        ))}
        {/* dots after land so they sit on top; later same-city dots offset by hash jitter */}
        {placed.map((v) => {
          const l = v.location!;
          const x = ((l.lon! + 180) / 360) * W;
          const y = ((90 - l.lat!) / 180) * H;
          // Same-city validators would overlap exactly; jitter deterministically.
          const j = jitter(v.address);
          const hovered = hover?.v.address === v.address;
          const lit = litAddress === v.address;
          const picked = selected === v.address;
          return (
            <g key={v.address} transform={`translate(${x + j.dx} ${y + j.dy})`}>
              <circle className="world-map-marker-glow" cx={0} cy={0} r={10} fill={picked ? "var(--brand)" : statusColorOf(v.status)} />
              <circle className="world-map-marker-ring" cx={0} cy={0} r={6.5} fill="none" stroke={picked ? "var(--brand)" : statusColorOf(v.status)} strokeOpacity={picked ? ".9" : ".55"} strokeWidth={picked ? 1.2 : .8} />
              {lit && <circle className="map-light-ring" cx={0} cy={0} r={6} fill="none" stroke={statusColorOf(v.status)} strokeWidth={1.5} />}
              {picked && <circle className="map-selected-ring" cx={0} cy={0} r={10.5} fill="none" stroke="var(--brand)" strokeWidth={1.4} />}
              <circle
                cx={0}
                cy={0}
                r={picked || lit || hovered ? 5.5 : 4}
                fill={picked ? "var(--brand)" : statusColorOf(v.status)}
                fillOpacity={0.95}
                stroke={picked ? "#fff" : "var(--panel2)"}
                strokeOpacity={picked ? 0.85 : 1}
                strokeWidth={1}
              />
              {/* generous invisible hit area so dense clusters stay hoverable */}
              <circle
                cx={0}
                cy={0}
                r={9}
                fill="transparent"
                onMouseMove={(e) => {
                  const r = (e.currentTarget.closest("svg")?.parentElement as HTMLElement)?.getBoundingClientRect();
                  setHover({ v, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
                }}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      <div className="world-map-controls" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.45, +(value + .12).toFixed(2)))}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.82, +(value - .12).toFixed(2)))}>−</button>
        <button type="button" aria-label="Reset map view" onClick={() => setZoom(1)}>◉</button>
      </div>
      <span className="world-map-distribution"><span aria-hidden="true">▥</span> Global validator distribution</span>
      </div>

      {hover && (
        <div
          style={{
            position: "absolute",
            zIndex: 5,
            pointerEvents: "none",
            // Keep the card inside the map however close the dot is to an edge.
            left: `min(${hover.x + 12}px, calc(100% - 246px))`,
            top: hover.y > 130 ? undefined : `${hover.y + 12}px`,
            bottom: hover.y > 130 ? `calc(100% - ${Math.max(hover.y - 12, 0)}px)` : undefined,
            width: 234,
            padding: "9px 11px",
            borderRadius: 8,
            background: "var(--panel2)",
            border: "1px solid var(--line2)",
            boxShadow: "var(--shadow)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ValidatorAvatar
              address={hover.v.address}
              avatarUrl={hover.v.avatar_url}
              title={hover.v.moniker ?? undefined}
              size={16}
            />
            <span style={{ font: `600 11.5px/1 ${mono}`, color: TX, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hover.v.moniker ?? shortAddr(hover.v.address)}
            </span>
            <span style={{ marginLeft: "auto", flex: "none" }}>
              <StatusPill status={hover.v.status} />
            </span>
          </div>
          <Row3 label="address" value={shortAddr(hover.v.address)} />
          <Row3 label="location" value={[hover.v.location!.city, hover.v.location!.country].filter(Boolean).join(", ") || "—"} />
          <Row3 label="provider" value={hover.v.location!.isp ?? "—"} />
          <Row3 label="ip" value={hover.v.location!.ip ?? "—"} />
          <Row3
            label="last seen"
            value={`${agoFrom(hover.v.location!.last_seen)} ago (${hover.v.location!.source === "direct" ? "direct" : "P2P"})`}
          />
        </div>
      )}
    </div>
  );
}

function Row3({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, font: `400 10.5px/1.3 ${sans}` }}>
      <span style={{ color: TX3, width: 52, flex: "none" }}>{label}</span>
      <span style={{ color: TX2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
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
