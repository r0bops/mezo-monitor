/**
 * Validator node locations, observed from the P2P network.
 *
 * The chain publishes no geography, but CometBFT discloses it indirectly:
 * every peer announces its moniker and IP in the P2P handshake, and
 * /net_info on any RPC lists the peers currently connected to it. A sweep
 * across all configured RPCs, matched by moniker onto the indexed validator
 * set, yields each validator node's observed IP; geo-IP turns that into a
 * place.
 *
 * Honesty rules this file follows:
 * - Matching is by exact moniker against the chain-synced validator list —
 *   an unrecognised node ("mezo-mainnet-full-node-0", "sad") is ignored, not
 *   guessed onto a validator.
 * - A validator never observed stays absent (rendered as unknown), never
 *   defaulted.
 * - Geo-IP failure leaves the location fields null; the sighting itself is
 *   still recorded with its IP.
 */
import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { chainEndpoints, validatorLocationIps, validatorLocations, validators } from "@mezo/core";
import type { Database } from "@mezo/core";

const NET_INFO_TIMEOUT_MS = 8_000;
/** A validator missing from the peer view gets one short, polite attempt at
 *  its own RPC — this is a fallback probe, not a scan. */
const DIRECT_PROBE_TIMEOUT_MS = 3_000;
const GEO_BATCH_URL = "http://ip-api.com/batch";
/** ip-api free tier: 15 batch requests/min, 100 IPs per batch. One sweep of
 * ~50 peers costs one request; only IPs not seen before are looked up. */
const GEO_TIMEOUT_MS = 10_000;

export type PeerInfo = { moniker: string; ip: string; network: string };

/** Parse /net_info into the fields the sweep needs. Never throws. */
export function peersFromNetInfo(json: unknown): PeerInfo[] {
  const peers = (json as { result?: { peers?: unknown[] } })?.result?.peers;
  if (!Array.isArray(peers)) return [];
  const out: PeerInfo[] = [];
  for (const p of peers as Record<string, unknown>[]) {
    const ni = p?.node_info as Record<string, unknown> | undefined;
    const moniker = ni?.moniker;
    const network = ni?.network;
    const ip = p?.remote_ip;
    if (typeof moniker !== "string" || moniker.trim() === "") continue;
    if (typeof ip !== "string" || ip.trim() === "") continue;
    out.push({ moniker: moniker.trim(), ip: ip.trim(), network: typeof network === "string" ? network : "" });
  }
  return out;
}

/** Fetch peers from one RPC's /net_info. */
export async function fetchPeers(rpcUrl: string): Promise<PeerInfo[]> {
  const url = rpcUrl.replace(/\/+$/, "") + "/net_info";
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(NET_INFO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`net_info ${url}: HTTP ${res.status}`);
  return peersFromNetInfo(await res.json());
}

/** /status node_info from a raw IP — the fields a direct probe needs. */
export type NodeStatus = { moniker: string; network: string };

/**
 * Probe a node's own RPC (`http://ip:26657/status`) and, if it answers,
 * return what it calls itself. Identity is confirmed by the caller comparing
 * the moniker — an answering node that names itself differently must NOT be
 * recorded as the validator (the IP may have been reassigned).
 */
export async function probeNode(ip: string): Promise<NodeStatus | null> {
  try {
    const res = await fetch(`http://${ip}:26657/status`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(DIRECT_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ni = ((await res.json()) as { result?: { node_info?: Record<string, unknown> } })?.result?.node_info;
    const moniker = ni?.moniker;
    const network = ni?.network;
    if (typeof moniker !== "string" || typeof network !== "string") return null;
    return { moniker: moniker.trim(), network };
  } catch {
    return null; // closed port, firewall, timeout — all just "no answer"
  }
}

export type GeoInfo = {
  countryCode: string | null;
  country: string | null;
  city: string | null;
  isp: string | null;
  lat: number | null;
  lon: number | null;
};

/** In-memory geo cache; IPs are stable enough that one lookup per process is fine. */
const geoCache = new Map<string, GeoInfo>();

/**
 * Resolve IPs to places via ip-api's batch endpoint (free, no key). Unknown
 * and failed IPs resolve to null-fields rather than throwing, so a geo outage
 * costs the country column, not the sighting.
 */
export async function geolocate(ips: string[]): Promise<Map<string, GeoInfo>> {
  const out = new Map<string, GeoInfo>();
  const missing: string[] = [];
  for (const ip of ips) {
    const cached = geoCache.get(ip);
    if (cached) out.set(ip, cached);
    else missing.push(ip);
  }
  if (missing.length === 0) return out;
  try {
    const res = await fetch(GEO_BATCH_URL + "?fields=status,countryCode,country,city,isp,lat,lon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(missing.slice(0, 100)),
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    for (const [i, ip] of missing.slice(0, 100).entries()) {
      const r = rows[i];
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const geo: GeoInfo =
        r && r.status === "success"
          ? {
              countryCode: typeof r.countryCode === "string" ? r.countryCode : null,
              country: typeof r.country === "string" ? r.country : null,
              city: typeof r.city === "string" ? r.city : null,
              isp: typeof r.isp === "string" ? r.isp : null,
              lat: num(r.lat),
              lon: num(r.lon),
            }
          : { countryCode: null, country: null, city: null, isp: null, lat: null, lon: null };
      geoCache.set(ip, geo);
      out.set(ip, geo);
    }
  } catch {
    for (const ip of missing)
      out.set(ip, { countryCode: null, country: null, city: null, isp: null, lat: null, lon: null });
  }
  return out;
}

/**
 * One sweep: fetch /net_info from every configured endpoint, match peers onto
 * the validator set by moniker, and upsert the latest sighting per validator.
 * Returns the number of validators observed. Individual endpoint failures are
 * tolerated — the sweep proceeds with whatever answered.
 */
export async function sweepLocations(db: Database, chainId: number, chainNetwork: string): Promise<number> {
  const endpoints = await db
    .select({ rpcUrl: chainEndpoints.rpcUrl })
    .from(chainEndpoints)
    .where(eq(chainEndpoints.chainId, chainId));
  const vset = await db
    .select({ address: validators.address, moniker: validators.moniker })
    .from(validators)
    .where(eq(validators.chainId, chainId));
  // Moniker → address, case-insensitive; null monikers cannot match anything.
  const byMoniker = new Map<string, string>();
  for (const v of vset) {
    if (v.moniker) byMoniker.set(v.moniker.toLowerCase(), v.address);
  }

  // Latest sighting per validator across all endpoints this sweep.
  const sightings = new Map<string, { moniker: string; ip: string; source: "peer" | "direct" }>();
  for (const e of endpoints) {
    let peers: PeerInfo[];
    try {
      peers = await fetchPeers(e.rpcUrl);
    } catch {
      continue; // an unreachable endpoint contributes nothing
    }
    for (const p of peers) {
      if (p.network !== chainNetwork) continue; // wrong chain — cannot happen on our endpoints, but cheap
      const address = byMoniker.get(p.moniker.toLowerCase());
      if (address === undefined) continue;
      sightings.set(address, { moniker: p.moniker, ip: p.ip, source: "peer" });
    }
  }

  const existing = await db
    .select({
      address: validatorLocations.validatorAddress,
      ip: validatorLocations.ip,
      lat: validatorLocations.lat,
    })
    .from(validatorLocations)
    .where(eq(validatorLocations.chainId, chainId));
  const knownIp = new Map(existing.map((r) => [r.address, r.ip]));
  const storedLat = new Map(existing.map((r) => [r.address, r.lat]));

  // Fallback: a validator the peer view missed gets one direct probe of its
  // last-known node. The probe must name itself with the validator's moniker
  // and our chain before it counts — an answering stranger means the IP was
  // reassigned, and the old sighting stands (with a warning) rather than
  // being silently overwritten or deleted.
  for (const v of vset) {
    if (!v.moniker || sightings.has(v.address)) continue;
    const lastIp = knownIp.get(v.address);
    if (!lastIp) continue; // never observed — nothing to probe
    const status = await probeNode(lastIp);
    if (!status) continue; // node not answering RPC; next sweep tries again
    if (status.network !== chainNetwork || status.moniker.toLowerCase() !== v.moniker.toLowerCase()) {
      console.warn(
        `locations: last-known ip ${lastIp} for "${v.moniker}" now answers as ` +
          `"${status.moniker}" (${status.network}) — keeping previous sighting`,
      );
      continue;
    }
    sightings.set(v.address, { moniker: status.moniker, ip: lastIp, source: "direct" });
  }

  if (sightings.size === 0) return 0;

  // Geo lookups only for IPs we have never placed (per process), whose IP
  // changed, or whose stored row predates coordinates.
  const needGeo = [...new Set(
    [...sightings.entries()]
      .filter(
        ([addr, s]) =>
          geoCache.get(s.ip) === undefined || knownIp.get(addr) !== s.ip || storedLat.get(addr) === null,
      )
      .map(([, s]) => s.ip),
  )];
  const geo = await geolocate(needGeo);

  const now = new Date();
  for (const [address, s] of sightings) {
    const g =
      geo.get(s.ip) ??
      geoCache.get(s.ip) ??
      { countryCode: null, country: null, city: null, isp: null, lat: null, lon: null };
    const sameIp = knownIp.get(address) === s.ip;
    // Refresh geo fields on an unchanged IP too when the stored row predates
    // coordinates (lat null but geo now has them) — one-time backfill.
    const refreshGeo = !sameIp || (storedLat.get(address) === null && g.lat !== null);
    await db
      .insert(validatorLocations)
      .values({
        chainId,
        validatorAddress: address,
        monikerSeen: s.moniker,
        ip: s.ip,
        countryCode: g.countryCode,
        country: g.country,
        city: g.city,
        isp: g.isp,
        lat: g.lat,
        lon: g.lon,
        timesSeen: 1,
        source: s.source,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [validatorLocations.chainId, validatorLocations.validatorAddress],
        set: {
          monikerSeen: s.moniker,
          ip: s.ip,
          ...(refreshGeo
            ? {
                countryCode: g.countryCode,
                country: g.country,
                city: g.city,
                isp: g.isp,
                lat: g.lat,
                lon: g.lon,
                timesSeen: bump(validatorLocations.timesSeen),
                source: s.source,
                lastSeenAt: now,
              }
            : { timesSeen: bump(validatorLocations.timesSeen), source: s.source, lastSeenAt: now }),
        },
      });
    // History: one row per (validator, ip) ever observed; an IP change is
    // recorded, not overwritten.
    await db
      .insert(validatorLocationIps)
      .values({
        chainId,
        validatorAddress: address,
        ip: s.ip,
        countryCode: g.countryCode,
        country: g.country,
        city: g.city,
        isp: g.isp,
        lat: g.lat,
        lon: g.lon,
        timesSeen: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [validatorLocationIps.chainId, validatorLocationIps.validatorAddress, validatorLocationIps.ip],
        set: {
          countryCode: g.countryCode,
          country: g.country,
          city: g.city,
          isp: g.isp,
          lat: g.lat,
          lon: g.lon,
          timesSeen: bump(validatorLocationIps.timesSeen),
          lastSeenAt: now,
        },
      });
  }
  return sightings.size;
}

/** times_seen = <table>.times_seen + 1, in place in an upsert set clause. */
function bump(col: AnyPgColumn) {
  return sql`${col} + 1`;
}
