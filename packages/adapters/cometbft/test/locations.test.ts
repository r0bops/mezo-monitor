/**
 * Tests for the P2P location sweep: /net_info parsing, moniker matching onto
 * the validator set, geo-IP fail-softness, and the upsert semantics (new IP
 * refreshes the geo fields; same IP only bumps the observation counter).
 *
 * fetch is stubbed throughout — these tests assert the sweep's logic, not the
 * uptime of the endpoints or the geo service.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@mezo/core";
import { createTestDb, dropTestDb, seed } from "../../../api/test/setup.js";
import { geolocate, peersFromNetInfo, sweepLocations } from "../src/locations.js";

const A = "5add2eaac2cd5fa43ba5c62433912807215474a"; // voyage-through-time
const B = "919f0ac3136ce30a326bf5f549d10ea6cf598159"; // StakingCabin
const C = "143e66afe2a69bc2a4a2b3a088e82ed007e06f1b"; // Node.Monster

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let chainId: number;

const netInfo = (peers: unknown[]) => ({ result: { peers } });
const peer = (moniker: string, ip: string, network = "mezo_31612-1") => ({
  node_info: { moniker, network },
  remote_ip: ip,
});

beforeAll(async () => {
  pool = await createTestDb();
  db = drizzle(pool, { schema });
  chainId = await seed(pool, {
    head: 100,
    count: 10,
    validators: [A, B, C],
    monikers: {
      [A]: "voyage-through-time",
      [B]: "StakingCabin",
      [C]: "Node.Monster",
    },
  });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

afterEach(() => vi.unstubAllGlobals());

/** Seed one endpoint row and stub fetch to answer /net_info for it. */
async function stubSweep(peers: unknown[], geo: unknown[] = []) {
  await pool.query(
    `insert into chain_endpoints (chain_id, label, rpc_url, priority, is_active, healthy)
     values ($1, 'loc-test', 'http://rpc.test', 99, true, true)
     on conflict (chain_id, rpc_url) do nothing`,
    [chainId],
  );
  const f = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("/net_info")) return Promise.resolve({ ok: true, json: () => Promise.resolve(netInfo(peers)) });
    if (String(url).includes("ip-api.com")) return Promise.resolve({ ok: true, json: () => Promise.resolve(geo) });
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("peersFromNetInfo", () => {
  it("extracts moniker/ip/network and drops malformed peers", () => {
    const peers = peersFromNetInfo(
      netInfo([
        peer("Simply Staking", "80.64.211.35"),
        peer("  ", "1.2.3.4"), // blank moniker
        { node_info: { moniker: "NoIp" } }, // no remote_ip
        "nonsense",
      ]),
    );
    expect(peers).toEqual([{ moniker: "Simply Staking", ip: "80.64.211.35", network: "mezo_31612-1" }]);
  });

  it("returns empty for a non-net_info response", () => {
    expect(peersFromNetInfo({ error: "x" })).toEqual([]);
    expect(peersFromNetInfo(null)).toEqual([]);
  });
});

describe("geolocate", () => {
  it("maps success rows and leaves failures null rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { status: "success", countryCode: "MT", country: "Malta", city: "Valletta", isp: "Skoed" },
            { status: "fail" },
          ]),
      }),
    );
    const m = await geolocate(["9.9.9.9", "8.8.8.8"]);
    expect(m.get("9.9.9.9")).toMatchObject({ countryCode: "MT", country: "Malta" });
    expect(m.get("8.8.8.8")).toMatchObject({ countryCode: null, country: null });
  });

  it("resolves null-fields for every IP when the geo service is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("geo down")));
    const m = await geolocate(["1.1.1.1"]);
    expect(m.get("1.1.1.1")?.country).toBeNull();
  });
});

describe("sweepLocations", () => {
  it("records only peers whose moniker matches a known validator", async () => {
    await stubSweep(
      [peer("StakingCabin", "10.0.0.1"), peer("mezo-mainnet-full-node-0", "10.0.0.9"), peer("wrong-net", "10.0.0.8", "other-1")],
      [{ status: "success", countryCode: "DE", country: "Germany", city: "Falkenstein", isp: "Hetzner" }],
    );
    const observed = await sweepLocations(db, chainId, "mezo_31612-1");
    expect(observed).toBe(1);
    const r = await pool.query(
      `select validator_address, ip, country_code, country, times_seen from validator_locations where chain_id = $1`,
      [chainId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ validator_address: B, ip: "10.0.0.1", country_code: "DE", country: "Germany" });
  });

  it("same IP on a later sweep refreshes last_seen and bumps the counter; a changed IP refreshes the geo fields", async () => {
    await stubSweep([peer("StakingCabin", "10.0.0.1")], [
      { status: "success", countryCode: "DE", country: "Germany", city: "Falkenstein", isp: "Hetzner" },
    ]);
    await sweepLocations(db, chainId, "mezo_31612-1");
    let r = await pool.query<{ times_seen: number; ip: string; country_code: string }>(
      `select times_seen, ip, country_code from validator_locations where chain_id = $1`,
      [chainId],
    );
    expect(r.rows[0].times_seen).toBe(2);
    expect(r.rows[0].country_code).toBe("DE");

    await stubSweep([peer("StakingCabin", "10.0.0.2")], [
      { status: "success", countryCode: "MT", country: "Malta", city: "Valletta", isp: "Skoed" },
    ]);
    await sweepLocations(db, chainId, "mezo_31612-1");
    r = await pool.query<{ times_seen: number; ip: string; country_code: string }>(
      `select times_seen, ip, country_code from validator_locations where chain_id = $1`,
      [chainId],
    );
    expect(r.rows[0]).toMatchObject({ times_seen: 3, ip: "10.0.0.2", country_code: "MT" });
  });

  it("observes nothing when every endpoint is unreachable", async () => {
    await pool.query(`delete from validator_locations where chain_id = $1`, [chainId]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    expect(await sweepLocations(db, chainId, "mezo_31612-1")).toBe(0);
    const r = await pool.query(`select count(*)::int as n from validator_locations where chain_id = $1`, [chainId]);
    expect(r.rows[0].n).toBe(0);
  });
});
