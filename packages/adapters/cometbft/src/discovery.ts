/**
 * RPC endpoint discovery from the chain's own P2P network.
 *
 * Every peer a node connects to shows up in /net_info; the subset whose RPC
 * port (26657) is open answers /status with its chain id, sync state and
 * history depth. Those are real, community-run RPC endpoints — the raw
 * material for a public directory (chainlist-style).
 *
 * Trust boundary: rows are evidence, not endorsements. The indexer's own
 * failover list stays human-verified (see schema note on
 * discovered_endpoints); this sweep only reports what nodes say about
 * themselves, and a node that stops answering flips healthy=false rather
 * than disappearing — history is part of the evidence.
 */
import { eq, sql } from "drizzle-orm";
import { chainEndpoints, discoveredEndpoints } from "@mezo/core";
import type { Database } from "@mezo/core";

const NET_INFO_TIMEOUT_MS = 8_000;
const PROBE_TIMEOUT_MS = 3_000;
/** Parallel probes: polite but quick — 54 peers finish in ~3 waves. */
const CONCURRENCY = 15;

/** Unique peer IPs across every configured endpoint's /net_info. */
async function peerIps(rpcUrls: string[]): Promise<string[]> {
  const ips = new Set<string>();
  await Promise.all(
    rpcUrls.map(async (rpcUrl) => {
      try {
        const res = await fetch(rpcUrl.replace(/\/+$/, "") + "/net_info", {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(NET_INFO_TIMEOUT_MS),
        });
        if (!res.ok) return;
        const peers = ((await res.json()) as { result?: { peers?: unknown[] } })?.result?.peers;
        if (!Array.isArray(peers)) return;
        for (const p of peers as { remote_ip?: unknown }[]) {
          if (typeof p?.remote_ip === "string" && p.remote_ip !== "") ips.add(p.remote_ip);
        }
      } catch {
        // an unreachable endpoint contributes no peers
      }
    }),
  );
  return [...ips];
}

export type ProbeOutcome = {
  url: string;
  network: string | null;
  moniker: string | null;
  catchingUp: boolean;
  earliestHeight: number | null;
  latestHeight: number | null;
  latencyMs: number | null;
};

/** Probe one peer's RPC. Never throws — no answer is a null network. */
async function probeRpc(ip: string): Promise<ProbeOutcome> {
  const url = `http://${ip}:26657`;
  const started = Date.now();
  try {
    const res = await fetch(url + "/status", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = (await res.json()) as {
      result?: { node_info?: { network?: unknown; moniker?: unknown }; sync_info?: Record<string, unknown> };
    };
    const ni = r.result?.node_info;
    const si = r.result?.sync_info;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    return {
      url,
      network: typeof ni?.network === "string" ? ni.network : null,
      moniker: typeof ni?.moniker === "string" && ni.moniker.trim() !== "" ? ni.moniker.trim() : null,
      catchingUp: si?.catching_up === true,
      earliestHeight: num(si?.earliest_block_height),
      latestHeight: num(si?.latest_block_height),
      latencyMs: Date.now() - started,
    };
  } catch {
    return { url, network: null, moniker: null, catchingUp: false, earliestHeight: null, latestHeight: null, latencyMs: null };
  }
}

/**
 * One discovery pass: peers → probes → upserts. Returns the number of
 * endpoints currently answering on our chain. Previously-seen URLs that
 * went silent keep their row with healthy=false.
 */
export async function sweepDiscovery(db: Database, chainId: number, chainNetwork: string): Promise<number> {
  const endpoints = await db
    .select({ rpcUrl: chainEndpoints.rpcUrl })
    .from(chainEndpoints)
    .where(eq(chainEndpoints.chainId, chainId));
  const ips = await peerIps(endpoints.map((e) => e.rpcUrl));
  // A configured endpoint shows up as its own peer — it is not "discovered".
  const configuredUrls = new Set(endpoints.map((e) => e.rpcUrl.replace(/\/+$/, "")));

  const outcomes: ProbeOutcome[] = [];
  for (let i = 0; i < ips.length; i += CONCURRENCY) {
    outcomes.push(...(await Promise.all(ips.slice(i, i + CONCURRENCY).map(probeRpc))));
  }
  const onChain = outcomes.filter(
    (o) => o.network === chainNetwork && !configuredUrls.has(o.url.replace(/\/+$/, "")),
  );

  const known = await db
    .select({ url: discoveredEndpoints.url })
    .from(discoveredEndpoints)
    .where(eq(discoveredEndpoints.chainId, chainId));
  const knownUrls = new Set(known.map((k) => k.url));

  const now = new Date();
  for (const o of onChain) {
    await db
      .insert(discoveredEndpoints)
      .values({
        chainId,
        url: o.url,
        moniker: o.moniker,
        network: o.network!,
        healthy: true,
        catchingUp: o.catchingUp,
        earliestHeight: o.earliestHeight,
        latestHeight: o.latestHeight,
        latencyMs: o.latencyMs,
        timesSeen: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [discoveredEndpoints.chainId, discoveredEndpoints.url],
        set: {
          moniker: o.moniker,
          healthy: true,
          catchingUp: o.catchingUp,
          earliestHeight: o.earliestHeight,
          latestHeight: o.latestHeight,
          latencyMs: o.latencyMs,
          timesSeen: sql`${discoveredEndpoints.timesSeen} + 1`,
          lastSeenAt: now,
        },
      });
  }
  // Rows that no longer answered: keep the history, mark unhealthy. A row
  // matching a configured endpoint is deleted outright — it was never a
  // discovery (its peer-view self-appearance), and it would duplicate the
  // directory's verified section.
  const seenUrls = new Set(onChain.map((o) => o.url));
  for (const url of knownUrls) {
    if (seenUrls.has(url)) continue;
    const matchesConfigured = [...configuredUrls].some((c) => url.replace(/\/+$/, "") === c);
    if (matchesConfigured) {
      await db.delete(discoveredEndpoints).where(eq(discoveredEndpoints.url, url));
      continue;
    }
    await db
      .update(discoveredEndpoints)
      .set({ healthy: false, catchingUp: false, lastSeenAt: now })
      .where(eq(discoveredEndpoints.url, url));
  }
  return onChain.length;
}
